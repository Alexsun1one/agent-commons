"""R17-R3b：管理后台贡献审核，以及审核结果通知投稿人。

运行：cd server && python3 -m unittest tests.test_r17r3b_contributions -v
"""
import json
import os
import subprocess
import unittest
from pathlib import Path

from app import outbox
from tests.helpers import HDRS, AppCase

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'
FULL = {'title': '一周报表', 'kind': '方法笔记', 'summary': '把周报收成一张表', 'body': '先列出字段，再让 Agent 填。'}
EVENT = 'governance.contribution_decided'

ADMIN = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const ADMIN=fs.readFileSync(root+'/preview/admin.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const settle=async()=>{for(let i=0;i<12;i++)await tick();};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatch(e){for(const f of [...(events[e.type]||[])])f(e);}}}
const ROW={id:'c1',title:'一周<i>报表',kind:'方法笔记',summary:'摘要<b>',body:'正文',status:'review',handle:'maple',display_name:'枫<i>',last_event:'',updated_at:'2026-10-27T00:00:00Z',version:2};
function build({live=true,totp=true,roles=['governor']}={}){
  const doc=Object.assign(eventTarget(),{activeElement:null});
  const rootEl=Object.assign(eventTarget(),{innerHTML:'',contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[]});
  doc.querySelector=s=>s==='[data-admin-root]'?rootEl:null;
  const calls=[];const handlers={};
  const api={mode:live?'live':'demo',newIdempotencyKey:(()=>{let n=0;return()=>'key-'+(++n)})(),
    me:()=>Promise.resolve({handle:'boss',display_name:'管理员',roles,totp_enabled:totp,level:5}),
    get:(path,q)=>{calls.push({m:'GET',path,q});const h=handlers['GET '+path];return h?h(q):Promise.reject(Object.assign(new Error('nf'),{status:404}));},
    post:(path,body,opts)=>{calls.push({m:'POST',path,body,opts});const h=handlers['POST '+path];return h?h(body,opts):Promise.reject(Object.assign(new Error('nf'),{status:404}));}};
  const w={console,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,Map,Set,URLSearchParams,AbortController,setTimeout:()=>1,clearTimeout(){},
    document:doc,CommonsAPI:api,location:{hash:'#/admin/biz/contributions'},CommonsPages:[],Commons:{toast(){}}};
  w.window=w;vm.createContext(w);vm.runInContext(ADMIN,w);
  const el=(attrs,extra)=>Object.assign({tagName:'BUTTON',getAttribute:k=>attrs[k]==null?null:attrs[k],closest(){return this}},extra||{});
  const click=(attrs)=>{doc.dispatch({type:'click',target:el(attrs),preventDefault(){}});};
  const form=(values)=>{
    for(const [k,v] of Object.entries(values))rootEl.dispatch({type:'input',target:el({'data-adm-flow':k},{value:v})});
    rootEl.dispatch({type:'submit',target:el({'data-adm-form':'flow'}),preventDefault(){}});
  };
  const open=async()=>{rootEl.innerHTML=w.CommonsAdmin.routes.admin();w.CommonsAdmin.mount();await settle();};
  return {w,calls,handlers,rootEl,click,form,open};
}
const done=name=>{console.log('_PASS '+name);process.exit(0);};
const bail=e=>{console.error(e);process.exit(1);};
'''


class R17R3bSource(unittest.TestCase):
    def test_admin_section_reuses_the_application_review_pattern(self):
        text = (PREVIEW / 'admin.js').read_text(encoding='utf-8')
        self.assertIn("['contributions', '贡献审核']", text)
        self.assertIn("'/admin/account/contributions/' + encodeURIComponent(flow.id) + '/decide'", text)
        self.assertIn('flow.key = flow.key || window.CommonsAPI.newIdempotencyKey()', text)
        self.assertIn('entry.moreLoading', text)
        self.assertIn('data-adm="contrib-more"', text)
        self.assertIn('需要先开启两步验证', text)
        self.assertNotIn('onclick=', text)
        rule = (ROOT / 'server/modules/notify/migrations/notify_0006_contributions.sql').read_text(encoding='utf-8')
        self.assertIn("'governance'", rule)
        self.assertNotIn('CHECK', rule)
        self.assertNotIn('ALTER', rule)


class R17R3bBackend(AppCase):
    def submit(self, client, body=None):
        created = client.post('/api/account/contributions', headers=HDRS, json=body or FULL)
        self.assertEqual(created.status_code, 201, created.text)
        item = created.json()['data']
        reviewed = client.post(f"/api/account/contributions/{item['id']}/review",
                               headers={**HDRS, 'If-Match': str(item['version'])})
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        return reviewed.json()['data']

    def decide(self, gov, contribution_id, decision='accept', note='可以收进案例', key='decide-r3b-01', status=200):
        headers = dict(HDRS)
        if key:
            headers['Idempotency-Key'] = key
        body = {'decision': decision}
        if note is not None:
            body['note'] = note
        response = gov.post(f'/api/admin/account/contributions/{contribution_id}/decide', headers=headers, json=body)
        self.assertEqual(response.status_code, status, response.text)
        return response

    def events(self):
        with self.db.read() as conn:
            return [json.loads(row[0]) for row in conn.execute(
                'SELECT payload_json FROM outbox_event WHERE event_type = ? ORDER BY occurred_at, id', (EVENT,))]

    def notes(self, client):
        response = client.get('/api/notify/notifications', params={'limit': 50})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']['items']

    def test_accept_notifies_author_once_even_when_replayed(self):
        author = self.user('r3b_author')
        gov = self.user('r3b_gov', level=5, roles=('governor',), totp=True)
        item = self.submit(author)
        queue = gov.get('/api/admin/account/contributions', headers=HDRS, params={'status': 'review'})
        self.assertEqual(queue.status_code, 200, queue.text)
        listed = queue.json()['data']['items']
        self.assertEqual([(row['id'], row['handle'], row['display_name']) for row in listed],
                         [(item['id'], 'r3b_author', 'r3b_author')])
        done = self.decide(gov, item['id'])
        self.assertEqual(done.json()['data']['status'], 'accepted')
        replay = self.decide(gov, item['id'])
        self.assertEqual(replay.headers.get('idempotent-replayed'), 'true')
        self.assertEqual(len(self.events()), 1)
        payload = self.events()[0]
        self.assertEqual(payload['recipient_id'], author.pid)
        self.assertEqual(payload['contribution_id'], item['id'])
        self.assertIn('可以收进案例', payload['message'])
        again = self.decide(gov, item['id'], key='decide-r3b-02', status=409)
        self.assertEqual(again.json()['error']['code'], 'state_conflict')
        self.assertEqual(len(self.events()), 1)
        handled = outbox.dispatch(self.db, limit=100)
        self.assertGreaterEqual(handled, 1)
        with self.db.read() as conn:
            state = conn.execute('SELECT state, last_error FROM outbox_event WHERE event_type = ?', (EVENT,)).fetchone()
        self.assertEqual((state['state'], state['last_error']), ('done', None))
        inbox = self.notes(author)
        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]['category'], 'governance')
        self.assertEqual(inbox[0]['title'], '你的投稿有结果了')
        self.assertIn('《一周报表》通过了。', inbox[0]['body'])
        self.assertIn('可以收进案例', inbox[0]['body'])
        self.assertEqual(inbox[0]['link'], f"#/contribute/{item['id']}")
        self.assertEqual(self.notes(gov), [])
        detail = author.get(f"/api/account/contributions/{item['id']}", headers=HDRS)
        self.assertIn('审核通过：可以收进案例', json.dumps(detail.json()['data']['history'], ensure_ascii=False))

    def test_return_notifies_and_a_missing_note_still_decides(self):
        author = self.user('r3b_back')
        gov = self.user('r3b_gov2', level=5, roles=('governor',), totp=True)
        item = self.submit(author)
        returned = self.decide(gov, item['id'], decision='return', note='请补上具体步骤', key='decide-r3b-03')
        self.assertEqual(returned.json()['data']['status'], 'draft')
        bare = self.submit(author, {**FULL, 'title': '没有说明'})
        plain = self.decide(gov, bare['id'], note=None, key='decide-r3b-04')
        self.assertEqual(plain.json()['data']['status'], 'accepted')
        outbox.dispatch(self.db, limit=100)
        bodies = [row['body'] for row in self.notes(author)]
        self.assertTrue(any('退回了。' in body and '请补上具体步骤' in body for body in bodies))
        self.assertTrue(any('《没有说明》通过了。' == body for body in bodies))
        self.assertEqual(len(bodies), 2)

    def test_queue_filters_and_pages(self):
        author = self.user('r3b_page')
        gov = self.user('r3b_gov3', level=5, roles=('governor',), totp=True)
        first = self.submit(author, {**FULL, 'title': '第一份'})
        second = self.submit(author, {**FULL, 'title': '第二份'})
        page = gov.get('/api/admin/account/contributions', headers=HDRS, params={'status': 'review', 'limit': 1})
        self.assertEqual(page.status_code, 200, page.text)
        self.assertEqual(len(page.json()['data']['items']), 1)
        cursor = page.json()['meta']['cursor']
        self.assertTrue(cursor)
        rest = gov.get('/api/admin/account/contributions', headers=HDRS,
                       params={'status': 'review', 'limit': 1, 'cursor': cursor})
        ids = {page.json()['data']['items'][0]['id'], rest.json()['data']['items'][0]['id']}
        self.assertEqual(ids, {first['id'], second['id']})
        self.decide(gov, first['id'], key='decide-r3b-05')
        waiting = gov.get('/api/admin/account/contributions', headers=HDRS, params={'status': 'review'})
        self.assertEqual([row['id'] for row in waiting.json()['data']['items']], [second['id']])
        accepted = gov.get('/api/admin/account/contributions', headers=HDRS, params={'status': 'accepted'})
        self.assertEqual([row['id'] for row in accepted.json()['data']['items']], [first['id']])
        self.assertIn('审核通过', accepted.json()['data']['items'][0]['last_event'])

    def test_stranger_missing_totp_and_bad_input_are_rejected(self):
        author = self.user('r3b_deny')
        item = self.submit(author)
        stranger = author.post(f"/api/admin/account/contributions/{item['id']}/decide", headers=HDRS,
                               json={'decision': 'accept', 'note': '不行'})
        self.assertEqual(stranger.status_code, 403)
        self.assertEqual(stranger.json()['error']['code'], 'action_not_allowed')
        plain = self.user('r3b_nototp', level=5, roles=('governor',))
        blocked = plain.post(f"/api/admin/account/contributions/{item['id']}/decide", headers=HDRS,
                             json={'decision': 'accept', 'note': '不行'})
        self.assertEqual((blocked.status_code, blocked.json()['error']['code']), (403, 'totp_setup_required'))
        gov = self.user('r3b_gov4', level=5, roles=('governor',), totp=True)
        bad = gov.post(f"/api/admin/account/contributions/{item['id']}/decide", headers=HDRS,
                       json={'decision': 'maybe', 'note': '不行'})
        self.assertEqual(bad.status_code, 422)
        long_note = gov.post(f"/api/admin/account/contributions/{item['id']}/decide", headers=HDRS,
                             json={'decision': 'accept', 'note': '字' * 301})
        self.assertEqual(long_note.status_code, 422)
        missing = gov.post('/api/admin/account/contributions/missing-id/decide', headers=HDRS,
                           json={'decision': 'accept', 'note': '不行'})
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(self.events(), [])


class R17R3bAdmin(unittest.TestCase):
    def run_admin(self, script):
        result = subprocess.run(['node', '-e', ADMIN + script, str(ROOT)], capture_output=True, text=True,
                                env=dict(os.environ))
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def test_list_escapes_filters_and_blocks_without_totp(self):
        self.run_admin(r'''
(async()=>{
 const x=build();
 x.handlers['GET /admin/account/contributions']=q=>Promise.resolve({data:{items:q.status==='review'?[ROW]:[]},meta:{}});
 await x.open();
 let html=x.rootEl.innerHTML;
 const first=x.calls.find(c=>c.path==='/admin/account/contributions');
 assert.ok(first&&first.q.status==='review'&&first.q.limit===30,'默认读待审');
 assert.ok(html.includes('一周&lt;i&gt;报表')&&!html.includes('一周<i>报表'),'标题被转义');
 assert.ok(html.includes('枫&lt;i&gt;')&&html.includes('摘要&lt;b&gt;'),'名字和摘要被转义');
 assert.ok(html.includes('data-adm="contrib-decide"'),'待审可以处理');
 x.click({'data-adm':'contrib-state','data-value':'accepted'});await settle();
 html=x.rootEl.innerHTML;
 assert.ok(x.calls.some(c=>c.q&&c.q.status==='accepted'),'状态筛选带到接口');
 assert.ok(!html.includes('data-adm="contrib-decide"')&&html.includes('这里还没有记录'));
 const blocked=build({totp:false});
 blocked.handlers['GET /admin/account/contributions']=()=>Promise.resolve({data:{items:[ROW]},meta:{}});
 await blocked.open();
 const gate=blocked.rootEl.innerHTML;
 assert.ok(gate.includes('需要先开启两步验证')&&gate.includes('href="#/account"'));
 assert.ok(/data-adm="contrib-decide"[^>]*disabled/.test(gate),'没开验证码时按钮是灰的');
 blocked.click({'data-adm':'contrib-decide','data-id':'c1','data-value':'accept'});
 blocked.form({reason:'可以收'});
 assert.ok(!blocked.calls.some(c=>c.m==='POST'),'没开验证码绝不发请求');
 done('list-totp');
})().catch(bail);
''')

    def test_both_decisions_need_a_note_and_retry_keeps_the_key(self):
        self.run_admin(r'''
(async()=>{
 const x=build();
 let list=[ROW];
 x.handlers['GET /admin/account/contributions']=q=>Promise.resolve({data:{items:q.status==='review'?list:[]},meta:{}});
 let fail=true;
 x.handlers['POST /admin/account/contributions/c1/decide']=b=>fail?Promise.reject(Object.assign(new Error('服务器忙'),{status:500})):(list=[],Promise.resolve({data:{status:b.decision}}));
 await x.open();
 x.click({'data-adm':'contrib-decide','data-id':'c1','data-value':'accept'});
 assert.ok(x.rootEl.innerHTML.includes('name="reason"'));
 x.form({reason:' '});
 assert.ok(x.rootEl.innerHTML.includes('请写理由'),'说明必填');
 assert.ok(!x.calls.some(c=>c.m==='POST'));
 x.form({reason:'可以收进案例'});
 assert.ok(x.rootEl.innerHTML.includes('确认通过')&&x.rootEl.innerHTML.includes('会通知投稿人'));
 x.click({'data-adm':'flow-run'});await settle();
 let posts=x.calls.filter(c=>c.m==='POST');
 assert.equal(posts.length,1);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(posts[0].body)),{decision:'accept',note:'可以收进案例'});
 assert.equal(posts[0].opts.idempotencyKey,'key-1');
 assert.ok(x.rootEl.innerHTML.includes('服务器忙'));
 fail=false;
 x.click({'data-adm':'flow-run'});await settle();
 posts=x.calls.filter(c=>c.m==='POST');
 assert.equal(posts.length,2);
 assert.equal(posts[1].opts.idempotencyKey,'key-1','重试沿用同一个幂等键');
 assert.ok(x.rootEl.innerHTML.includes('已写入，并进入审计日志。'));
 x.click({'data-adm':'flow-close'});await settle();
 assert.ok(x.rootEl.innerHTML.includes('没有待审的投稿'));
 const back=build();
 back.handlers['GET /admin/account/contributions']=()=>Promise.resolve({data:{items:[ROW]},meta:{}});
 back.handlers['POST /admin/account/contributions/c1/decide']=b=>Promise.resolve({data:{status:b.decision}});
 await back.open();
 back.click({'data-adm':'contrib-decide','data-id':'c1','data-value':'return'});
 back.form({reason:''});
 assert.ok(back.rootEl.innerHTML.includes('请写理由'),'退回也要写说明');
 back.form({reason:'请补上具体步骤'});
 assert.ok(back.rootEl.innerHTML.includes('确认退回'));
 back.click({'data-adm':'flow-run'});await settle();
 const post=back.calls.find(c=>c.m==='POST');
 assert.equal(post.body.decision,'return');
 assert.equal(post.body.note,'请补上具体步骤');
 done('decide');
})().catch(bail);
''')

    def test_load_more_is_single_flight_and_appends(self):
        self.run_admin(r'''
(async()=>{
 const x=build();
 const more=Object.assign({},ROW,{id:'c2',title:'第二份',display_name:'川'});
 let release,calls=0;
 x.handlers['GET /admin/account/contributions']=q=>{
  if(!q.cursor)return Promise.resolve({data:{items:[ROW]},meta:{cursor:'c-1'}});
  calls++;
  return new Promise(resolve=>{release=()=>resolve({data:{items:[ROW,more]},meta:{}});});
 };
 await x.open();
 assert.ok(x.rootEl.innerHTML.includes('data-adm="contrib-more"'));
 x.click({'data-adm':'contrib-more'});
 x.click({'data-adm':'contrib-more'});
 assert.equal(calls,1,'请求没回来时不能再点');
 assert.ok(x.rootEl.innerHTML.includes('正在加载')&&x.rootEl.innerHTML.includes('disabled'));
 release();await settle();
 const html=x.rootEl.innerHTML;
 assert.ok(html.includes('一周&lt;i&gt;报表')&&html.includes('第二份'),'追加而不是替换');
 assert.equal((html.match(/data-id="c1"/g)||[]).length,2,'已有的一行不重复');
 assert.ok(!html.includes('data-adm="contrib-more"'),'没有下一页就不画按钮');
 done('more');
})().catch(bail);
''')

    def test_demo_mode_stays_local(self):
        self.run_admin(r'''
(async()=>{
 const x=build({live:false});
 x.w.COMMONS_ADMIN_SAMPLE={viewer:{handle:'boss',display_name:'管理员',roles:['governor'],totp_enabled:true},users:[],audit:[]};
 await x.open();
 assert.ok(x.rootEl.innerHTML.includes('把周报交给 Agent')&&!x.calls.length,'示例不请求接口');
 x.click({'data-adm':'contrib-decide','data-id':'demo-contrib-1','data-value':'accept'});
 x.form({reason:'可以',totp:'12345'});
 assert.ok(x.rootEl.innerHTML.includes('6 位'));
 x.form({reason:'可以收进案例',totp:'123456'});
 x.click({'data-adm':'flow-run'});await settle();
 assert.ok(!x.calls.length,'示例模式不发请求');
 x.click({'data-adm':'flow-close'});await settle();
 assert.ok(x.rootEl.innerHTML.includes('没有待审的投稿'));
 done('demo');
})().catch(bail);
''')
