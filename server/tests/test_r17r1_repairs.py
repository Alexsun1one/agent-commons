"""R17-R1 · 复查应修：收件箱先滤后翻页、入组申请游标、收藏与日报已读幂等、开房只记一次、传图入口提前灰掉、上传失败不再写死 L2。"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

from modules.agentchat import bridge
from modules.agentchat.tests.test_agentchat import LOBBY, AgentChatCase
from tests.helpers import HDRS
from tests.test_lg8a_r13_members_teams import COMMON as HOT_COMMON
from tests.test_lg8a_r13_members_teams import ROOT
from tests.test_lg8a_r15_writes import HOT
from tests.test_r17b_frontend import COMMON as ORGS_JS
from tests.test_r17b_orgs_tools import R17BCase

PREVIEW = ROOT / 'preview'


class InboxScanTest(AgentChatCase):
    def test_invisible_window_does_not_drop_older_mentions(self):
        asker = self.member('gap_asker', level=2)
        reader = self.member('gap_reader', level=2)
        for body in ('更早的', '稍早的'):
            self.now += 1
            asker.post(f'/api/agentchat/channels/{LOBBY}/messages', headers=HDRS,
                       json={'body': body, 'mentions': [reader.pid]})
        bridge.install(auth=self.stub, owners=self.stub.owner_of,
                       screen=lambda *a, **k: 'pending_review')
        for i in range(3):
            self.now += 1
            asker.post(f'/api/agentchat/channels/{LOBBY}/messages', headers=HDRS,
                       json={'body': f'待审 {i}', 'mentions': [reader.pid]})

        first = reader.get('/api/agentchat/inbox', params={'limit': 1})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual([row['body'] for row in first.json()['data']['items']], ['稍早的'])
        cursor = first.json()['meta']['cursor']
        self.assertTrue(cursor)
        second = reader.get('/api/agentchat/inbox', params={'limit': 1, 'cursor': cursor})
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual([row['body'] for row in second.json()['data']['items']], ['更早的'])
        self.assertFalse(second.json()['meta'].get('cursor'))


class ApplicationPageTest(R17BCase):
    def setUp(self):
        super().setUp()
        self.owner = self.user('r17r1_owner', level=3)
        self.make_org(self.owner, 'page-team')

    def stamp(self, pid, when):
        with self.db.write() as conn:
            conn.execute('UPDATE org_member SET applied_at = ? WHERE principal_id = ?', (when, pid))

    def test_pending_pages_after_filter_and_badge_counts_the_same_set(self):
        people = [self.user(f'r17r1_p{i}') for i in range(3)]
        for i, person in enumerate(people):
            self.apply(person, 'page-team', f'说明 {i}')
            self.stamp(person.pid, f'2026-10-28T08:00:0{i}.000000Z')
        with self.db.write() as conn:
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (self.owner.pid, people[1].pid, '2026-10-28T09:00:00.000000Z'))

        detail = self.owner.get('/api/orgs/page-team').json()['data']
        self.assertEqual(detail['pendingApplications'], 2)

        first = self.owner.get('/api/orgs/page-team/applications', params={'limit': 1})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual([row['id'] for row in first.json()['data']], [people[0].pid])
        cursor = first.json()['meta']['cursor']
        self.assertTrue(cursor)
        second = self.owner.get('/api/orgs/page-team/applications', params={'limit': 1, 'cursor': cursor})
        self.assertEqual([row['id'] for row in second.json()['data']], [people[2].pid])
        self.assertFalse(second.json()['meta'].get('cursor'))
        self.assertNotIn(people[1].pid, [row['id'] for row in first.json()['data'] + second.json()['data']])

    def test_decided_list_pages_newest_first(self):
        people = [self.user(f'r17r1_d{i}') for i in range(3)]
        for person in people:
            self.apply(person, 'page-team')
            self.review(self.owner, 'page-team', person.pid, 'approve')
        with self.db.write() as conn:
            for i, person in enumerate(people):
                conn.execute('UPDATE org_member SET reviewed_at = ? WHERE principal_id = ?',
                             (f'2026-10-28T10:00:0{i}.000000Z', person.pid))
        first = self.owner.get('/api/orgs/page-team/applications', params={'status': 'approved', 'limit': 2})
        ids = [row['id'] for row in first.json()['data']]
        self.assertEqual(ids, [people[2].pid, people[1].pid])
        cursor = first.json()['meta']['cursor']
        rest = self.owner.get('/api/orgs/page-team/applications',
                              params={'status': 'approved', 'limit': 2, 'cursor': cursor})
        self.assertEqual([row['id'] for row in rest.json()['data']], [people[0].pid])


def node(script, *extra):
    done = subprocess.run(['node', '-e', script, str(ROOT), *extra], capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise AssertionError((done.stdout + done.stderr)[-4000:])
    return done.stdout


ORGS_MORE = r'''
(async()=>{
 const row=(id,name)=>({id,handle:id,name,level:2,note:'',status:'pending',appliedAt:'2026-10-27T08:00:00.000000Z',reviewedAt:null,reviewNote:''});
 const routes={
  'GET /orgs/team':DETAIL({state:'active',role:'owner',showOnProfile:true},{pendingApplications:2}),
  'GET /orgs/team/applications':q=>Promise.resolve(q&&q.cursor==='c2'
    ?{data:[row('p3','红')],meta:{}}
    :{data:[row('p2','小明')],meta:{cursor:'c2'}})
 };
 const c=context('live','#/org/team',routes,'data-org-root',orgRender);
 vm.runInContext(source('orgs'),c);
 c.rootNode.innerHTML=orgRender(c);
 c.CommonsOrgs.mount();
 await tick();
 c.document.dispatchEvent('click',{target:btn({orgAct:'tab',value:'applications'})});
 await tick();
 let html=c.rootNode.innerHTML;
 const first=c.gets.find(g=>g.path==='/orgs/team/applications');
 assert.equal(first.query.limit,20);
 assert.equal(first.query.status,'pending');
 assert.ok(html.includes('data-org-act="apps-more"'),'load more when the server sends a cursor');
 assert.ok(html.includes('加载更多'));
 c.document.dispatchEvent('click',{target:btn({orgAct:'apps-more'})});
 await tick();
 const second=c.gets.filter(g=>g.path==='/orgs/team/applications').pop();
 assert.equal(second.query.cursor,'c2');
 html=c.rootNode.innerHTML;
 assert.ok(html.includes('data-org-app="p2"')&&html.includes('data-org-app="p3"'),'second page is appended');
 assert.ok(!html.includes('apps-more'),'no more button after the last page');
 console.log('ORGS_MORE_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

HOT_FAV = HOT + r'''
(async()=>{
 const c=hotCtx([{id:'e1',title:'Evt',related:{}}]); await tick();
 const span={textContent:'收藏'};
 const col={querySelector(){return null}};
 const b=hotBtn('fav','e1',{'.hot-detail-col':col});
 b.querySelector=sel=>sel==='span'?span:null;
 let release, mode='fail';
 c.routes['POST /feed/events/e1/favorite']=()=>mode==='fail'
   ? Promise.reject(Object.assign(new Error('服务器忙'),{status:500}))
   : new Promise(r=>{release=()=>r({data:{favorited:true,site:{favorites:1}}});});
 click(c,b); click(c,b); await tick();
 let posts=find(c,'POST','/feed/events/e1/favorite');
 assert.equal(posts.length,1,'disabled while the first favorite is in flight');
 assert.equal(b.disabled,false,'failure unlocks the button');
 const key=posts[0].opts.idempotencyKey;
 click(c,b); await tick();
 posts=find(c,'POST','/feed/events/e1/favorite');
 assert.equal(posts.length,2);
 assert.equal(posts[1].opts.idempotencyKey,key,'retry keeps the same key');
 mode='hang';
 click(c,b); click(c,b); await tick();
 posts=find(c,'POST','/feed/events/e1/favorite');
 assert.equal(posts.length,3,'a second click while it is in flight does not post again');
 assert.equal(posts[2].opts.idempotencyKey,key,'the same attempt still uses the first key');
 release(); await tick();
 assert.equal(b.disabled,false);
 click(c,b); await tick();
 posts=find(c,'POST','/feed/events/e1/favorite');
 assert.equal(posts.length,4,'a finished toggle may be clicked again');
 assert.notEqual(posts[3].opts.idempotencyKey,key);
 console.log('HOT_FAV_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

HOT_ROOM_ONCE = HOT + r'''
(async()=>{
 const c=hotCtx([{id:'e1',title:'Evt',related:{}}]); await tick();
 const span={textContent:'开个房间聊'};
 const col={querySelector(){return {textContent:''}}};
 const b=hotBtn('room','e1',{'.hot-detail-col':col});
 b.querySelector=sel=>sel==='span'?span:null;
 c.routes['POST /feed/events/e1/room']=()=>Promise.resolve({data:{site:{rooms:1}}});
 click(c,b); await tick();
 assert.equal(find(c,'POST','/feed/events/e1/room').length,1);
 assert.equal(span.textContent,'已记下');
 assert.ok(c.toasts.some(t=>t.includes('已记下开房意向')));
 assert.ok(!c.toasts.some(t=>t.includes('房间模块接上后会开讨论房')));
 assert.ok(c.toasts.some(t=>t.includes('不会马上开出房间')));
 click(c,b); await tick();
 assert.equal(find(c,'POST','/feed/events/e1/room').length,1,'the same button does not insert again');
 console.log('HOT_ROOM_ONCE_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

EDITOR_GATE = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const SRC=fs.readFileSync(root+'/preview/editor.js','utf8');
function boot(canUpload){
  let html='';
  const host={appendChild(){return this},set innerHTML(v){html=String(v)},get innerHTML(){return html},
    querySelector(){const n={style:{},hidden:false,className:'',innerHTML:'',value:'',textContent:'',scrollHeight:24,addEventListener(){},querySelector(){return n},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}},contains(){return true}};return n}};
  const ev=()=>({addEventListener(){},removeEventListener(){}});
  const c=Object.assign(ev(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,AbortController,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},
    fetch:()=>Promise.reject(Error('no')),location:{protocol:'https:',hash:'#/write'},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}})});
  c.document=Object.assign(ev(),{activeElement:null,getElementById:()=>null,querySelector:s=>s==='[data-edt-page="write"] [data-edt-host]'?host:(s==='[data-edt-page="write"]'?ev():null),querySelectorAll:()=>[],createElement:()=>({innerHTML:'',classList:{add(){}},setAttribute(){}}),head:{appendChild(){}},body:{classList:{add(){},remove(){}}}});
  c.Commons={read:(k,f)=>f,write:()=>true,toast(){},refresh(){},go(){},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#')};
  c.CommonsAPI={mode:'live',get:()=>Promise.reject(Object.assign(Error('x'),{status:404})),post:()=>Promise.resolve({data:{}}),newIdempotencyKey:()=>'idem-key-1'};
  c.COMMONS_BUILD={mode:'live'};
  c.CommonsSession={me:{id:'me',display_name:'我',handle:'me',level:1},can:a=>a==='upload.create'?canUpload:true,reason:a=>a==='upload.create'&&!canUpload?'需要 L2（你现在是 L1）':''};
  c.CommonsReader={esc:s=>String(s==null?'':s),levels:{2:'熟手'},visibility:()=>({who:'',label:''}),safeImage:s=>String(s||'')};
  c.window=c;c.self=c;c.globalThis=c;vm.createContext(c);vm.runInContext(SRC,c);
  c.CommonsEditorPage.mount();
  return html;
}
const locked=boot(false);
assert.ok(/data-edt-act="insert-image"[^>]*disabled[^>]*title="需要 L2（你现在是 L1）"/.test(locked),'image button is disabled and carries the reason');
assert.ok(!locked.includes('data-edt-img-input'),'no file input while upload is closed');
const open=boot(true);
assert.ok(open.includes('data-edt-img-input'),'file input stays when upload is allowed');
assert.ok(!/insert-image"[^>]*disabled/.test(open),'allowed button is not disabled');
console.log('EDITOR_GATE_PASS');
'''

HOT_DIGEST = HOT + r'''
(async()=>{
 const c=hotCtx([{id:'e1',title:'Evt',related:{}}]); await tick();
 const day='2026-10-28';
 const b=btn('[data-hot-act]',{hotAct:'digest-read',day},{closest(s){return s==='[data-hot-act]'?this:null;}});
 let release, mode='fail';
 c.routes['PUT /content/digest-read/'+day]=()=>mode==='fail'
   ? Promise.reject(Object.assign(new Error('忙'),{status:500}))
   : new Promise(r=>{release=()=>r({data:{read:true}});});
 click(c,b); click(c,b); await tick();
 let puts=find(c,'PUT','/content/digest-read/'+day);
 assert.equal(puts.length,1,'disabled while the first mark-read is in flight');
 assert.equal(b.disabled,false,'failure unlocks the button');
 const key=puts[0].opts.idempotencyKey;
 click(c,b); await tick();
 puts=find(c,'PUT','/content/digest-read/'+day);
 assert.equal(puts.length,2);
 assert.equal(puts[1].opts.idempotencyKey,key,'retry keeps the same key');
 mode='hang';
 click(c,b); click(c,b); await tick();
 puts=find(c,'PUT','/content/digest-read/'+day);
 assert.equal(puts.length,3,'a second click while it is in flight does not put again');
 assert.equal(puts[2].opts.idempotencyKey,key);
 release(); await tick();
 click(c,b); await tick();
 const dels=find(c,'DELETE','/content/digest-read/'+day);
 assert.equal(dels.length,1,'the next intentional toggle is the opposite call');
 assert.notEqual(dels[0].opts.idempotencyKey,key);
 console.log('HOT_DIGEST_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MEDIA_REASON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const src=fs.readFileSync(root+'/preview/media.js','utf8');
function load(session){
  const quota={data:{file:{daily_count:0,used_today:0,max_bytes:0},avatar:{daily_count:1,used_today:0,max_bytes:1024},html_max_bytes:1024,chunk_bytes:1024}};
  const c={console,Promise,Object,String,Number,Array,Math,JSON,Date,Uint8Array,Error,setTimeout,clearTimeout,
    location:{protocol:'https:',hash:'#/'},btoa:s=>Buffer.from(s,'binary').toString('base64'),crypto:globalThis.crypto,
    document:{readyState:'complete',querySelectorAll:()=>[],body:{appendChild(){}},head:{appendChild(){}},createElement:()=>({style:{},setAttribute(){}})},
    matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},removeEventListener(){}};
  c.window=c;c.self=c;c.globalThis=c;c.COMMONS_BUILD={mode:'live'};
  c.CommonsAPI={mode:'live',newIdempotencyKey:()=>'k',get:p=>p==='/media/quota'?Promise.resolve(quota):Promise.reject(Error('x'))};
  if(session)c.CommonsSession=session;
  vm.createContext(c);vm.runInContext(src,c);
  return c;
}
(async()=>{
  const plain=load(null).CommonsMedia.describeUploadError({code:'action_not_allowed'},'image');
  assert.match(plain.text,/等级还不能上传/);
  assert.ok(!/L\d/.test(plain.text),plain.text);
  const told=load({reason:a=>a==='upload.create'?'管理员把上传调到了别的等级':''}).CommonsMedia.describeUploadError({code:'action_not_allowed'},'image');
  assert.equal(told.text,'管理员把上传调到了别的等级');
  const file={name:'a.png',type:'image/png',size:100,arrayBuffer:()=>Promise.resolve(new ArrayBuffer(100))};
  let err;try{await load({reason:()=>'规则原因'}).CommonsMedia.upload(file,{purpose:'image'});}catch(e){err=e;}
  assert.equal(err&&err.message,'规则原因');
  console.log('MEDIA_REASON_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MARKET_REASON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const SRC=fs.readFileSync(root+'/preview/market.js','utf8');
function boot(session){
  const handlers={};const toasts=[];let html='';
  const api={mode:'live',newIdempotencyKey:()=>'k',
    get(path){
      if(path==='/market/meta')return Promise.resolve({data:{people:[],categories:[],field_labels:{},status_labels:{},report_reasons:[]}});
      if(path==='/market/listings')return Promise.resolve({data:[]});
      return Promise.reject(Object.assign(Error('x'),{status:404}));
    }};
  const rootEl={querySelector:()=>null,querySelectorAll:()=>[],set innerHTML(v){html=String(v)},get innerHTML(){return html}};
  const c={console,Promise,Object,String,Number,Array,Math,JSON,Date,Error,setTimeout,clearTimeout,URL,Set,Map,
    location:{protocol:'https:',hash:'#/market'},
    document:{querySelector:s=>s==='[data-mt-root]'?rootEl:null,addEventListener(t,f){(handlers[t]||(handlers[t]=[])).push(f)},removeEventListener(){}},
    matchMedia:()=>({matches:false}),
    Commons:{toast:m=>toasts.push(m),read:(k,f)=>f,write:()=>true,refresh(){},go(){},esc:s=>String(s==null?'':s),safeUrl:s=>String(s||'#'),icon:()=>''},
    CommonsAPI:api,CommonsSession:session,CommonsMedia:{upload:()=>Promise.reject(Error('should not upload'))}};
  c.window=c;c.self=c;c.globalThis=c;c.COMMONS_BUILD={mode:'live'};
  vm.createContext(c);vm.runInContext(SRC,c);
  return {c,handlers,toasts};
}
(async()=>{
  const tick=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
  async function fire(session){
    const t=boot(session);
    t.c.CommonsMarket.mount();
    const input={files:[{name:'a.png',size:10,type:'image/png'}],value:'x'};
    (t.handlers.change||[]).forEach(f=>f({target:{matches:s=>s==='[data-mt-photos]',files:input.files,get value(){return input.value},set value(v){input.value=v}}}));
    await tick();
    return t.toasts;
  }
  const generic=await fire({can:()=>false});
  assert.ok(generic.some(m=>m==='你现在还不能上传图片。'),JSON.stringify(generic));
  assert.ok(!generic.some(m=>/L\d/.test(m)),JSON.stringify(generic));
  const told=await fire({can:()=>false,reason:()=>'需要另外的等级'});
  assert.ok(told.some(m=>m==='需要另外的等级'),JSON.stringify(told));
  console.log('MARKET_REASON_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class RepairFrontendTest(unittest.TestCase):
    def test_application_list_appends_the_next_page(self):
        self.assertIn('ORGS_MORE_PASS', node(ORGS_JS + ORGS_MORE))

    def test_favorite_disables_and_reuses_the_key_until_it_lands(self):
        self.assertIn('HOT_FAV_PASS', node(HOT_COMMON + HOT_FAV))

    def test_room_intent_is_recorded_once_and_does_not_promise_a_room(self):
        self.assertIn('HOT_ROOM_ONCE_PASS', node(HOT_COMMON + HOT_ROOM_ONCE))

    def test_editor_image_button_is_gated_before_the_file_dialog(self):
        self.assertIn('EDITOR_GATE_PASS', node(EDITOR_GATE))

    def test_join_result_category_is_not_worded_as_approval(self):
        text = (PREVIEW / 'notify.js').read_text(encoding='utf-8')
        self.assertIn("['social_join_approved', '申请结果']", text)
        self.assertIn("social_join_approved: '申请有了结果'", text)
        self.assertNotIn('入组通过', text)
        self.assertNotIn('你的入组申请已通过', text)

    def test_digest_read_reuses_the_key_until_it_lands(self):
        self.assertIn('HOT_DIGEST_PASS', node(HOT_COMMON + HOT_DIGEST))

    def test_upload_denial_follows_reason_and_drops_the_level_number(self):
        self.assertIn('MEDIA_REASON_PASS', node(MEDIA_REASON))
        self.assertIn('MARKET_REASON_PASS', node(MARKET_REASON))
        editor = (PREVIEW / 'editor.js').read_text(encoding='utf-8')
        self.assertNotIn('升到队员（L2）', editor)
        self.assertIn('你现在还不能上传图片。', editor)


if __name__ == '__main__':
    unittest.main()
