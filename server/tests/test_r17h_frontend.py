"""R17-H · 前端：社区祝福、关掉推荐人、找搭子、赞助/讲师申请、房间文字讨论、能力门原因。

离线 VM：mock CommonsAPI，假数据的形状照真实路由写：
  分页接口 data: {items: [...]} + meta.cursor；/social/anniversaries data: {items: [...]}；
  /social/buddies、/social/buddy-invites data: {items: [...]}；/social/applications data: {items: [...]}；
  /rooms/{id}/messages data: {items: [...], more, state}；写接口返回 data = 一条记录。
R17H_BEFORE=docs/evidence/R17-H/before 时读改前的 preview_<名>.js，用来反跑（必须失败）。
"""
from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_lg6c_app_shell import COMMON as APP_SHELL  # noqa: E402

# 反跑：R17H_APP=改前的 app.js
APP_COMMON = APP_SHELL.replace("vm.runInContext(source('api'),c);vm.runInContext(original?BEFORE:source('app'),c);",
                               "vm.runInContext(source('api'),c);vm.runInContext(process.env.R17H_APP?fs.readFileSync(process.env.R17H_APP,'utf8'):(original?BEFORE:source('app')),c);")
assert 'R17H_APP' in APP_COMMON

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const before=process.env.R17H_BEFORE||'';
const source=name=>fs.readFileSync(before?root+'/'+before+'/preview_'+name+'.js':root+'/preview/'+name+'.js','utf8');
const tick=async(n=40)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){[...(events[type]||[])].forEach(f=>f(ev))}}}
class FakeFormData{constructor(f){this.v=f.values||{}}get(k){return this.v[k]}}
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function node(){const attrs={},kids=new Map();const n={innerHTML:'',value:'',dataset:{},style:{},scrollTop:0,scrollHeight:0,clientHeight:0,isConnected:true,attrs,disabled:false,
 classList:{add(){},remove(){},toggle(){},contains(){return false}},
 getAttribute:k=>attrs[k]??null,setAttribute:(k,v)=>{attrs[k]=String(v)},removeAttribute:k=>{delete attrs[k]},hasAttribute:k=>k in attrs,
 querySelector:s=>{if(!kids.has(s))kids.set(s,node());return kids.get(s)},querySelectorAll:()=>[],contains:()=>true,closest:()=>null,matches:()=>false,
 appendChild(){},removeChild(){},focus(){},blur(){},addEventListener(){},removeEventListener(){},kids};return n;}
function ctx(hash,session){
  const calls=[],toasts=[],routes={},writes=[],modals=[];
  const answer=(method,path,body,opts)=>{
    calls.push({method,path,body,opts:opts||{}});
    const key=method+' '+path;let r=routes[key];
    if(r===undefined){
      if(method==='GET')return Promise.reject(Object.assign(new Error('no route '+key),{status:404,code:'resource_not_found'}));
      return Promise.resolve({data:{}});
    }
    if(typeof r==='function')r=r(body,opts);
    if(r instanceof Error)return Promise.reject(r);
    return Promise.resolve(r);
  };
  const c=Object.assign(eventTarget(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,Error,RegExp,Intl,
    setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},FormData:FakeFormData,
    location:{protocol:'https:',hash,replace(){},assign(){}},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),navigator:{},
    calls,toasts,routes,writes,modals,page:''});
  c.document=Object.assign(eventTarget(),{activeElement:null,visibilityState:'visible',querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,body:node(),head:node(),createElement:()=>node()});
  c.Commons={esc,icon:()=>'',safeUrl:s=>/^(#\/|assets\/|https?:\/\/)/.test(String(s||''))?String(s):'#',toast:m=>toasts.push(m),
    read:(k,d)=>d,write:(k,v)=>{writes.push({k,v});return true},go(r){c.location.hash='#/'+r},
    modal:(title,html)=>modals.push({title,html}),closeModal(){c.closed=(c.closed||0)+1},refresh(){c.rerender&&c.rerender()}};
  c.CommonsAPI={mode:'live',get:(p,q,o)=>answer('GET',p,q,o),post:(p,b,o)=>answer('POST',p,b,o),patch:(p,b,o)=>answer('PATCH',p,b,o),
    put:(p,b,o)=>answer('PUT',p,b,o),del:(p,b,o)=>answer('DELETE',p,b,o),newIdempotencyKey:()=>'idem-'+(calls.length+1),
    me:()=>Promise.resolve({id:'me1',handle:'me',display_name:'我自己',level:2,roles:[]})};
  c.COMMONS_BUILD={mode:'live'};
  c.CommonsSession=session||{state:'member',me:{id:'me1',handle:'me',display_name:'我自己',level:2},can:()=>true,reason:()=>''};
  c.window=c;c.self=c;
  vm.createContext(c);
  return c;
}
const find=(c,method,path)=>c.calls.filter(x=>x.method===method&&x.path===path);
const fail=(message,status,code)=>Object.assign(new Error(message),{status:status||422,code:code||'validation_failed'});
const done=name=>{console.log('_PASS '+name);process.exit(0);};
const bail=e=>{console.error(e);process.exit(1);};
const blocked=(why)=>({state:'member',me:{id:'me1',handle:'me',display_name:'我自己',level:1},can:()=>false,reason:()=>why});
'''

SOCIAL = r'''
function socialCtx(extra,session){
  const c=ctx('#/friends',session);
  const rootNode=node();rootNode.dataset.socRoot='friends';
  c.document.querySelector=s=>s.includes('data-soc-root')?rootNode:null;
  c.document.querySelectorAll=s=>s.includes('data-soc-root')?[rootNode]:[];
  c.queueMicrotask=()=>{};
  c.routes['GET /social/me']={data:{prefs:{},counts:{}}};
  c.routes['GET /social/groups']={data:{items:[],categories:{}}};
  c.routes['GET /social/suggestions']={data:{items:[]}};
  c.routes['GET /social/relations']={data:{items:[]}};
  c.routes['GET /social/feed']={data:{items:[]}};
  c.routes['GET /social/anniversaries']={data:{items:[]}};
  if(extra)extra(c);
  vm.runInContext(source('social'),c);
  c.CommonsSocial.mount();
  return c;
}
const socBtn=(act,id)=>{const b=node();b.dataset={socAct:act,id:id||'',value:''};b.tagName='BUTTON';b.closest=s=>s==='[data-soc-act]'?b:null;return b;};
const click=(c,b)=>c.document.dispatchEvent('click',{target:b,preventDefault(){}});
const BOBBY={id:'p2',handle:'bobby',display_name:'鲍比',level:2,years:1,text:'入群一周年',blessed_today:false};
'''

BUDDIES = r'''
const POST={id:'bp1',kind:'project',title:'把检索原型做成可复现作品',outcome:'一个能跑的原型',schedule:'每周 3 小时',contribution:'我写评测',partner:'懂交互的伙伴',note:'',state:'open',
  created_at:'2026-10-28T01:00:00Z',updated_at:'2026-10-28T01:00:00Z',author:{id:'p2',handle:'bobby',display_name:'<img src=x>鲍比',level:2,avatar:null},contact_open:true,invited:false};
const POST2=Object.assign({},POST,{id:'bp2',title:'互相评审周报',kind:'review',contact_open:false,author:{id:'p3',handle:'carol',display_name:'卡罗',level:1,avatar:null}});
const MINE={id:'bm1',kind:'learn',title:'一起读论文',outcome:'读书笔记',schedule:'每周 2 小时',contribution:'整理',partner:'1 位同学',note:'',state:'open',created_at:'2026-10-27T01:00:00Z',updated_at:'2026-10-27T01:00:00Z',author:{id:'me1',handle:'me',display_name:'我自己',level:2},contact_open:true,invited:false};
const SENT={id:'bi1',post_id:'bp1',kind:'project',title:'约你做原型',outcome:'原型',schedule:'每周 3 小时',contribution:'评测',note:'',state:'sent',created_at:'2026-10-28T02:00:00Z',updated_at:'2026-10-28T02:00:00Z',person:{id:'p2',handle:'bobby',display_name:'鲍比',level:2}};
const RECV={id:'bi2',post_id:null,kind:'review',title:'来约你互评',outcome:'两份评审',schedule:'每周 2 小时',contribution:'我评你',note:'谢谢',state:'sent',created_at:'2026-10-28T03:00:00Z',updated_at:'2026-10-28T03:00:00Z',person:{id:'p3',handle:'carol',display_name:'卡罗',level:1}};
function buddyCtx(extra,session){
  const c=ctx('#/buddies',session);
  c.routes['GET /social/buddies']=q=>q&&q.mine?{data:{items:[MINE]},meta:{cursor:null}}:{data:{items:[POST,POST2]},meta:{cursor:q&&q.cursor?null:'cur1'}};
  c.routes['GET /social/buddy-invites']=q=>q&&q.box==='received'?{data:{items:[RECV]},meta:{cursor:null}}:{data:{items:[SENT]},meta:{cursor:null}};
  c.routes['GET /social/me']={data:{prefs:{buddy_open:false},counts:{}}};
  if(extra)extra(c);
  vm.runInContext(source('buddies'),c);
  const B=c.CommonsBuddies;
  c.rerender=()=>{c.page=B.routes.buddies();};
  c.rerender();
  return c;
}
const form=(name,values,dataset)=>{const submit=node();return {values,dataset:dataset||{},reportValidity:()=>true,elements:{namedItem:()=>null},querySelector:()=>submit,submit};};
const act=(c,action,dataset)=>c.CommonsBuddies.handle(action,{dataset:dataset||{},disabled:false});
'''

BUSINESS = r'''
function bizCtx(route,items,session){
  const h={};
  const rootN={innerHTML:'',getAttribute:k=>k==='data-biz-root'?route:null,contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(k,f)=>h[k]=f,removeEventListener(){}};
  const c=ctx('#/'+route,session);
  c.document.activeElement=null;
  c.document.querySelector=s=>s==='[data-biz-root]'?rootN:null;
  c.rootN=rootN;c.h=h;
  c.routes['GET /social/applications']={data:{items:items||[]}};
  Object.defineProperty(c,'COMMONS_BUSINESS_SAMPLE',{get(){throw Error('LIVE_READ_SAMPLE')}});
  vm.runInContext(source('business'),c);
  c.CommonsBusiness.mount();
  return c;
}
const bizClick=(c,act,attrs)=>{const b={tagName:'BUTTON',attrs:Object.assign({'data-biz-act':act},attrs||{}),getAttribute(k){return this.attrs[k]??null},setAttribute(k,v){this.attrs[k]=v}};c.h.click({target:{closest:()=>b},preventDefault(){}});return b;};
const bizSubmit=(c,kind,values)=>{const submit={disabled:false};const f={getAttribute:k=>k==='data-biz-form'?kind:null,reportValidity:()=>true,elements:Object.entries(values).map(([name,value])=>({name,value})),querySelector:()=>submit,submit};
  c.h.submit({target:{closest:()=>f},preventDefault(){}});return f;};
'''

ROOMS = r'''
const DETAIL={id:'r1',kind:'discussion',title:'周五验收',summary:'',provider:'livekit',host:{id:'h1',name:'主持',level:4},state:'live',starts_at:'2026-10-28T00:00:00Z',ends_at:'2026-10-28T01:00:00Z',duration_min:60,
  participants:[{id:'me1',name:'我自己',level:2,role:'listener'}],me:{role:'listener',present:true,muted:false,epoch:1,admitted:true},access:[{kind:'members'}],capacity:20,listener_count:1,present_count:1,queue:[],agenda:[],materials:[]};
const MSG=(id,text,who)=>({id,seq:+id.slice(1),text,at:'2026-10-28T08:00:00Z',author:who||{id:'h1',name:'主持',level:4}});
function roomCtx(extra,session,detail){
  const c=ctx('#/room/r1',session);
  const rootN=node();rootN.attrs['data-rm-view']='room';
  c.rootN=rootN;
  c.document.querySelector=s=>s==='[data-rooms-root]'?rootN:null;
  c.routes['GET /rooms/r1']={data:detail||DETAIL};
  c.routes['POST /rooms/r1/join']={data:{state:'joined',media:{provider:'external_link'}}};
  c.routes['GET /rooms/r1/messages']={data:{items:[MSG('m1','你好 <b>粗体</b>'),MSG('m2','我的话',{id:'me1',name:'我自己',level:2})],more:false,state:'live'}};
  if(extra)extra(c);
  vm.runInContext(source('rooms'),c);
  c.CommonsRooms.routes.room();
  c.CommonsRooms.mount();
  c.all=()=>JSON.stringify([c.rootN.innerHTML,[...c.rootN.kids].map(([k,v])=>v.innerHTML)]);
  return c;
}
const typing=(c,text)=>{const el=node();el.attrs['data-room-field']='chat';el.value=text;c.document.dispatchEvent('input',{target:el});};
const chatForm=()=>{const f=node();f.attrs['data-rm-chat']='';return f;};
const roomClick=(c,act,id)=>{const b=node();b.attrs['data-room-act']=act;b.attrs['data-id']=id;b.tagName='BUTTON';b.closest=s=>s==='[data-room-act]'?b:null;c.document.dispatchEvent('click',{target:b,preventDefault(){}});return b;};
'''


class R17HFrontend(unittest.TestCase):
    def run_node(self, script):
        env = dict(os.environ)
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    APP = r"""
const nodeOf=()=>{const kids={};const n=Object.assign(eventTarget(),{innerHTML:'',textContent:'',dataset:{},isConnected:true,disabled:false,inserted:[],kids,
  classList:{contains:()=>false,toggle(){},add(){},remove(){}},setAttribute(){},removeAttribute(){},getAttribute(){return null},focus(){},remove(){},
  querySelector:s=>kids[s]||null,querySelectorAll:()=>[],insertAdjacentHTML(where,t){n.inserted.push(t)},contains:()=>false});return n;};
"""

    def run_app(self, script, app=''):
        env = dict(os.environ)
        if app:
            env['R17H_APP'] = str(ROOT / app)
        result = subprocess.run(['node', '-e', APP_COMMON + self.APP + script, str(ROOT)], capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    # ---------------------------------------------------------- app.js：同行目录翻页、外壳头像
    def test_app_gallery_member_directory_pages_and_keeps_rows_on_error(self):
        self.run_app(r"""
const done=name=>{console.log('_PASS '+name);process.exit(0);};
(async()=>{
 const x=setup(false,false),{c,nodes}=x;await asMember(x);
 const person=(h)=>({id:'id-'+h,handle:h,display_name:'成员'+h+'<b>',level:2});
 const slot=nodeOf(),dir=nodeOf(),body=nodeOf(),host=nodeOf();
 slot.querySelector=q=>q==='button'?(slot.btn=nodeOf()):null;
 body.kids['[data-live-people-more]']=slot;body.kids['.member-directory']=dir;
 host.dataset.liveList='gallery';host.kids['[data-live-status]']=nodeOf();host.kids['[data-live-empty]']=nodeOf();host.kids['[data-live-body]']=body;
 nodes['#main'].querySelector=s=>s==='[data-live-list]'?host:null;
 const calls=[];let page2=()=>({data:{items:[person('c')]},meta:{cursor:null}});
 c.CommonsAPI={mode:'live',get:(p,q)=>{calls.push({p,q});
   if(p==='/objects')return Promise.resolve({data:[],meta:{}});
   if(p==='/social/profiles')return q&&q.cursor?Promise.resolve(page2()):Promise.resolve({data:{items:[person('a'),person('b')]},meta:{cursor:'cur-1'}});
   return Promise.reject(Error('no '+p));},newIdempotencyKey:()=>'k'};
 c.location.hash='#/people';c.dispatchEvent({type:'hashchange'});
 for(let i=0;i<30;i++)await tick();
 assert.ok(body.innerHTML.includes('同行目录')&&body.innerHTML.includes('data-live-people-more'),'目录后面留了翻页位置');
 assert.ok(body.innerHTML.includes('成员a&lt;b&gt;'),'名字被转义');
 assert.ok(slot.innerHTML.includes('更多成员'),'有 cursor 就画按钮');
  // 失败：已有成员保留，按钮旁写错误，按钮变「重试」
 page2=()=>{throw Object.assign(Error('服务器忙'),{status:500})};
 c.CommonsAPI.get=(p,q)=>{calls.push({p,q});if(q&&q.cursor)return Promise.reject(Object.assign(new Error('服务器忙'),{status:500}));return Promise.resolve({data:{items:[]},meta:{}});};
 slot.btn.dispatchEvent({type:'click'});
 for(let i=0;i<10;i++)await tick();
 assert.ok(slot.innerHTML.includes('服务器忙')&&slot.innerHTML.includes('重试'),'失败写错误并给重试');
 assert.equal(dir.inserted.length,0,'失败没有动已有成员');
 assert.ok(calls.some(k=>k.q&&k.q.cursor==='cur-1'&&k.q.limit===50),'带 cursor 读下一页');
 // 重试成功：追加到目录，没有 cursor 就不再画按钮
 c.CommonsAPI.get=(p,q)=>{calls.push({p,q});return Promise.resolve({data:{items:[person('c')]},meta:{cursor:null}});};
 slot.btn.dispatchEvent({type:'click'});
 for(let i=0;i<10;i++)await tick();
 assert.equal(dir.inserted.length,1);
 assert.ok(dir.inserted[0].includes('成员c&lt;b&gt;'));
 assert.equal(slot.innerHTML,'','没有下一页就不再画按钮');
 done('gallery-paging');
})().catch(e=>{console.error(e);process.exit(1)});
""")

    def test_app_shell_avatar_uses_asset_size_then_falls_back_to_initial(self):
        self.run_app(r"""
const done=name=>{console.log('_PASS '+name);process.exit(0);};
const UUID='3f2b8c1e-0a4d-4e7b-9c55-1d2e3f4a5b6c';
(async()=>{
 // 1) 直接路径：不用再查素材
 let x=setup(false,false);await asMember(x);
 let top=x.nodes['#topbar'].innerHTML;
 assert.ok(top.includes('<img class="member-self-avatar" src="/api/media/f/face.webp"'),'直接路径马上画图');
 assert.ok(!x.c.calls.some(k=>k.url.includes('/media/assets/')),'直接路径不查素材');
 // 2) 素材 id：先画首字，查到 64 尺寸后换图
 x=setup(false,false);
 await answer(x,200,Object.assign({},member,{avatar_ref:UUID}));
 top=x.nodes['#topbar'].innerHTML;
 assert.ok(top.includes('<span class="member-self-avatar member-color-blue" aria-hidden="true">真</span>'),'没查到之前先画首字');
 assert.ok(!top.includes('<img class="member-self-avatar"'),'没查到之前没有图');
 const asked=x.c.calls.filter(k=>k.url.includes('/media/assets/'));
 assert.equal(asked.length,1);assert.ok(asked[0].url.endsWith('/media/assets/'+UUID),'查的是这个素材');
 x.c.reply(200,{sizes:{'64':'/api/media/f/a64.webp','128':'/api/media/f/a128.webp'}});
 for(let i=0;i<10;i++)await tick();
 top=x.nodes['#topbar'].innerHTML;
 assert.ok(top.includes('<img class="member-self-avatar" src="/api/media/f/a64.webp"'),'查到后换成 64 尺寸头像');
 assert.equal(x.c.calls.filter(k=>k.url.includes('/media/assets/')).length,1,'同一个素材不重复查');
 // 3) 查不到：一直是首字，不画破图
 x=setup(false,false);
 await answer(x,200,Object.assign({},member,{avatar_ref:UUID}));
 x.c.reply(404,undefined);
 for(let i=0;i<10;i++)await tick();
 top=x.nodes['#topbar'].innerHTML;
 assert.ok(top.includes('member-self-avatar member-color-blue')&&!top.includes('<img class="member-self-avatar"'),'失败保持首字');
 // 4) 危险地址不进 src
 x=setup(false,false);
 await answer(x,200,Object.assign({},member,{avatar_ref:'javascript:alert(1)'}));
 top=x.nodes['#topbar'].innerHTML;
 assert.ok(!top.includes('javascript:')&&!top.includes('<img class="member-self-avatar"'),'危险地址退回首字');
 done('shell-avatar');
})().catch(e=>{console.error(e);process.exit(1)});
""")

    # ---------------------------------------------------------- social.js
    def test_bless_live_posts_with_stable_key_on_retry_and_updates_state(self):
        self.run_node(SOCIAL + r'''
(async()=>{
 const c=socialCtx(c=>{c.routes['GET /social/anniversaries']={data:{items:[BOBBY]}};});
 await tick();
 const S=c.CommonsSocial;
 assert.deepStrictEqual(JSON.parse(JSON.stringify(S.data().anniversaries)),[{id:'p2',text:'入群一周年'}]);
 assert.equal(S.greeted('p2'),false);
 c.routes['POST /social/blessings/bobby']=fail('服务器忙',500,'internal_error');
 click(c,socBtn('greet','p2'));await tick();
 let posts=find(c,'POST','/social/blessings/bobby');
 assert.equal(posts.length,1);assert.ok(posts[0].opts.idempotencyKey);
 assert.ok(c.toasts.includes('服务器忙'),'失败如实提示');
 assert.equal(S.greeted('p2'),false,'失败不算送出');
 const firstKey=posts[0].opts.idempotencyKey;
 c.routes['POST /social/blessings/bobby']={data:{blessed:true,day:'2026-10-28',years:1}};
 c.routes['GET /social/anniversaries']={data:{items:[Object.assign({},BOBBY,{blessed_today:true})]}};
 click(c,socBtn('greet','p2'));await tick();
 posts=find(c,'POST','/social/blessings/bobby');
 assert.equal(posts.length,2);
 assert.equal(posts[1].opts.idempotencyKey,firstKey,'重试沿用同一个幂等键');
 assert.ok(c.toasts.some(t=>t.includes('已给 鲍比 送上祝福')));
 assert.equal(S.greeted('p2'),true,'重新读取后按钮变已送');
 assert.equal(c.writes.length,0,'真实模式不写本机');
 done('bless');
})().catch(bail);
''')

    def test_bless_and_dismiss_failures_do_not_break_page_and_gate_shows_reason(self):
        self.run_node(SOCIAL + r'''
(async()=>{
 // 纪念日接口 404：页面照常
 let c=socialCtx(c=>{delete c.routes['GET /social/anniversaries'];});
 await tick();
 assert.deepStrictEqual(JSON.parse(JSON.stringify(c.CommonsSocial.data().anniversaries)),[]);
 assert.equal(c.toasts.length,0);
 // 能力门：social.bless 被挡 -> 不发请求，提示原因
 const why='需要 L3（你现在是 L1）';
 c=socialCtx(c=>{c.routes['GET /social/anniversaries']={data:{items:[BOBBY]}};},blocked(why));
 await tick();
 click(c,socBtn('greet','p2'));await tick();
 assert.equal(find(c,'POST','/social/blessings/bobby').length,0);
 assert.ok(c.toasts.includes(why),'toast 写出 reason()');
 done('bless-gate');
})().catch(bail);
''')

    def test_dismiss_suggestion_live_posts_and_reloads(self):
        self.run_node(SOCIAL + r'''
(async()=>{
 const carol={id:'p9',handle:'carol',display_name:'卡罗',level:1,reason:'1 位共同好友',score:3};
 const c=socialCtx(c=>{c.routes['GET /social/suggestions']={data:{items:[carol]}};});
 await tick();
 const before=find(c,'GET','/social/suggestions').length;
 c.routes['GET /social/suggestions']={data:{items:[]}};
 click(c,socBtn('suggest-dismiss','p9'));await tick();
 const posts=find(c,'POST','/social/suggestions/carol/dismiss');
 assert.equal(posts.length,1);assert.ok(posts[0].opts.idempotencyKey);
 assert.ok(find(c,'GET','/social/suggestions').length>before,'成功后重新读取');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(c.CommonsSocial.suggestions())),[]);
 assert.ok(c.toasts.some(t=>t.includes('不再推荐')));
 done('dismiss');
})().catch(bail);
''')

    def test_group_create_gate_shows_reason_text(self):
        self.run_node(SOCIAL + r'''
(async()=>{
 const why='需要 L3（你现在是 L1）';
 const c=socialCtx(null,blocked(why));
 await tick();
 const html=c.CommonsSocial.routes.groups();
 assert.ok(html.includes('disabled title="'+why),'按钮灰掉并带原因');
 assert.ok(html.includes('data-soc-locked')&&html.includes(why),'旁边一行小字写原因');
 done('group-gate');
})().catch(bail);
''')

    # ---------------------------------------------------------- buddies.js
    def test_buddies_list_more_and_escape(self):
        self.run_node(BUDDIES + r'''
(async()=>{
 const c=buddyCtx();
 assert.ok(c.page.includes('正在读取'));
 await tick();
 const html=c.page;
 assert.ok(html.includes('把检索原型做成可复现作品')&&html.includes('互相评审周报'));
 assert.ok(!html.includes('<img src=x>'),'名字被转义');
 assert.ok(html.includes('data-action="buddy-invite" data-id="bp1"'),'开放邀约的有按钮');
 assert.ok(html.includes('暂不接受邀约'),'没开放邀约的写明');
 assert.ok(html.includes('data-action="buddy-more"'),'有 cursor 就有「更多需求」');
 assert.ok(html.includes('我的意向')&&html.includes('收到的'));
 c.routes['GET /social/buddies']=q=>q&&q.cursor?{data:{items:[Object.assign({},POST,{id:'bp3',title:'第三页的需求'})]},meta:{cursor:null}}:{data:{items:[POST]},meta:{cursor:'cur1'}};
 act(c,'buddy-more');await tick();
 assert.ok(find(c,'GET','/social/buddies').some(x=>x.body&&x.body.cursor==='cur1'),'带 cursor 再读一页');
 assert.ok(c.page.includes('第三页的需求')&&!c.page.includes('data-action="buddy-more"'));
 assert.equal(c.writes.length,0);
 done('buddies-list');
})().catch(bail);
''')

    def test_buddies_publish_edit_pause_and_stable_key(self):
        self.run_node(BUDDIES + r'''
(async()=>{
 const c=buddyCtx();await tick();
 act(c,'buddy-publish');
 assert.ok(c.modals[0].html.includes('data-form="buddy-draft"'));
 assert.ok(c.modals[0].html.includes('所有成员都能'),'真实模式的说明：发布后成员可见');
 const values={kind:'project',title:' 做一个评测台 ',outcome:'可跑',schedule:'每周 3 小时',partner:'懂前端',contribution:'后端',note:''};
 c.routes['POST /social/buddies']=fail('最多同时发布 5 个需求，先收起一个',409,'state_conflict');
 assert.equal(c.CommonsBuddies.submit('buddy-draft',form('d',values)),true);await tick();
 let posts=find(c,'POST','/social/buddies');
 assert.equal(posts.length,1);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(posts[0].body)),{kind:'project',title:'做一个评测台',outcome:'可跑',schedule:'每周 3 小时',contribution:'后端',note:'',partner:'懂前端'});
 assert.ok(c.toasts.includes('最多同时发布 5 个需求，先收起一个'));
 assert.equal(c.closed||0,0,'失败不关弹窗，输入还在');
 c.routes['POST /social/buddies']={data:POST};
 c.CommonsBuddies.submit('buddy-draft',form('d',values));await tick();
 posts=find(c,'POST','/social/buddies');
 assert.equal(posts.length,2);assert.equal(posts[1].opts.idempotencyKey,posts[0].opts.idempotencyKey,'重试沿用同一幂等键');
 assert.equal(c.closed,1);
 assert.ok(find(c,'GET','/social/buddies').length>=4,'成功后重读我的与全部');
 // 收起 / 重新发布 / 编辑
 act(c,'buddy-pause-draft',{id:'bm1'});await tick();
 assert.deepStrictEqual(JSON.parse(JSON.stringify(find(c,'PATCH','/social/buddies/bm1')[0].body)),{state:'paused'});
 act(c,'buddy-resume-draft',{id:'bm1'});await tick();
 assert.equal(find(c,'PATCH','/social/buddies/bm1')[1].body.state,'open');
 act(c,'buddy-edit-draft',{id:'bm1'});
 assert.ok(c.modals[c.modals.length-1].html.includes('data-id="bm1"'));
 c.CommonsBuddies.submit('buddy-draft',form('d',values,{id:'bm1'}));await tick();
 assert.equal(find(c,'PATCH','/social/buddies/bm1').length,3,'编辑走 PATCH');
 assert.equal(c.writes.length,0);
 done('buddies-publish');
})().catch(bail);
''')

    def test_buddies_invite_send_edit_withdraw_answer_and_preference(self):
        self.run_node(BUDDIES + r'''
(async()=>{
 const c=buddyCtx();await tick();
 act(c,'buddy-invite',{id:'bp1'});
 const html=c.modals[0].html;
 assert.ok(html.includes('data-person="bobby"')&&html.includes('data-post="bp1"'));
 const values={kind:'project',title:'约你做原型',outcome:'原型',schedule:'每周 3 小时',contribution:'评测',note:'先聊聊'};
 c.routes['POST /social/buddy-invites/bobby']=fail('对方暂不接受搭子邀约',409,'state_conflict');
 c.CommonsBuddies.submit('buddy-intent',form('i',values,{person:'bobby',post:'bp1'}));await tick();
 assert.ok(c.toasts.includes('对方暂不接受搭子邀约'),'服务器的原因原样提示');
 const sent=find(c,'POST','/social/buddy-invites/bobby');
 assert.equal(sent[0].body.post_id,'bp1');
 c.routes['POST /social/buddy-invites/bobby']={data:SENT};
 c.CommonsBuddies.submit('buddy-intent',form('i',values,{person:'bobby',post:'bp1'}));await tick();
 const again=find(c,'POST','/social/buddy-invites/bobby');
 assert.equal(again[1].opts.idempotencyKey,again[0].opts.idempotencyKey);
 // 编辑 / 撤回
 c.CommonsBuddies.submit('buddy-intent',form('i',values,{id:'bi1',person:'bobby'}));await tick();
 assert.equal(find(c,'PATCH','/social/buddy-invites/bi1').length,1);
 act(c,'buddy-withdraw',{id:'bi1'});await tick();
 assert.equal(find(c,'DELETE','/social/buddy-invites/bi1').length,1);
 // 收到的：接受 / 婉拒
 act(c,'buddy-mine',{value:'received'});
 assert.ok(c.page.includes('来约你互评')&&c.page.includes('data-accept="1"'));
 act(c,'buddy-answer',{id:'bi2',accept:'1'});await tick();
 assert.deepStrictEqual(JSON.parse(JSON.stringify(find(c,'POST','/social/buddy-invites/bi2/answer')[0].body)),{accept:true});
 act(c,'buddy-answer',{id:'bi2',accept:'0'});await tick();
 assert.equal(find(c,'POST','/social/buddy-invites/bi2/answer')[1].body.accept,false);
 // 联系偏好
 c.CommonsBuddies.submit('buddy-preference',form('p',{contactPreference:'open'}));await tick();
 assert.deepStrictEqual(JSON.parse(JSON.stringify(find(c,'PUT','/social/me/prefs')[0].body)),{buddy_open:true});
 assert.ok(c.page.includes('value="open" checked'));
 assert.equal(c.writes.length,0,'真实模式不写本机');
 done('buddies-invite');
})().catch(bail);
''')

    def test_buddies_gate_shows_reason_and_sample_mode_unchanged(self):
        self.run_node(BUDDIES + r'''
(async()=>{
 const why='需要 L2（你现在是 L1）';
 const c=buddyCtx(null,blocked(why));await tick();
 assert.ok(c.page.includes('data-action="buddy-publish" disabled title="'+why+'"'),'发起组队灰掉并带原因');
 assert.ok(c.page.includes(why)&&!c.page.includes('data-action="buddy-invite"'),'约搭子灰掉，原因写在旁边');
 act(c,'buddy-publish');
 assert.equal(c.modals.length,0);assert.ok(c.toasts.includes(why));
 // 演示模式：仍然只写本机，不发请求
 const d=ctx('#/buddies');d.CommonsAPI.mode='sample';
 vm.runInContext(source('buddies'),d);
 d.CommonsBuddies.submit('buddy-preference',form('p',{contactPreference:'open'}));
 assert.equal(d.calls.length,0,'演示模式没有请求');
 assert.equal(d.writes.length,1);assert.equal(d.writes[0].k,'buddies.state');
 done('buddies-gate');
})().catch(bail);
''')

    # ---------------------------------------------------------- business.js
    def test_sponsor_application_live_put_retry_key_and_withdraw(self):
        self.run_node(BUSINESS + r'''
(async()=>{
 const c=bizCtx('sponsor',[]);await tick();
 let html=c.rootN.innerHTML;
 assert.ok(html.includes('data-biz-form="sponsor"'),'真实模式画出表单');
 assert.ok(!html.includes('只存本机'),'不再说只存本机');
 assert.ok(html.includes('不收款、不报价'));
 bizClick(c,'chip',{'data-group':'types','data-value':'title'});
 bizClick(c,'chip',{'data-group':'types','data-value':'jobs'});
 const values={brand:' 某某科技 ',budget:'¥5,000 以下',time:'本月',note:'想冠名'};
 c.routes['PUT /social/applications/sponsor']=fail('服务器忙',500,'internal_error');
 bizSubmit(c,'sponsor',values);await tick();
 let puts=find(c,'PUT','/social/applications/sponsor');
 assert.equal(puts.length,1);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(puts[0].body)),{brand:'某某科技',types:['title','jobs'],budget:'¥5,000 以下',time:'本月',note:'想冠名'});
 assert.ok(c.toasts.includes('服务器忙'));
 assert.ok(c.rootN.innerHTML.includes('data-biz-form="sponsor"'),'失败后表单还在');
 const saved={id:'a1',kind:'sponsor',state:'submitted',fields:{brand:'某某科技',types:['title','jobs'],budget:'¥5,000 以下',time:'本月',note:'想冠名'},decision_note:null,created_at:'2026-10-28T01:00:00Z',updated_at:'2026-10-28T01:00:00Z'};
 c.routes['PUT /social/applications/sponsor']={data:saved};
 bizSubmit(c,'sponsor',values);await tick();
 puts=find(c,'PUT','/social/applications/sponsor');
 assert.equal(puts[1].opts.idempotencyKey,puts[0].opts.idempotencyKey,'重试沿用同一幂等键');
 html=c.rootN.innerHTML;
 assert.ok(html.includes('已提交，等待审核')&&html.includes('某某科技')&&html.includes('活动冠名、招聘'));
 bizClick(c,'sponsor-clear');await tick();
 assert.equal(find(c,'DELETE','/social/applications/sponsor').length,1);
 assert.ok(c.rootN.innerHTML.includes('data-biz-form="sponsor"'),'撤回后回到表单');
 assert.equal(c.writes.length,0,'不写本机');
 done('sponsor');
})().catch(bail);
''')

    def test_lecturer_application_live_and_decided_state(self):
        self.run_node(BUSINESS + r'''
(async()=>{
 let c=bizCtx('creator',[]);await tick();
 assert.ok(c.rootN.innerHTML.includes('data-biz-act="instructor-open"'));
 assert.ok(c.rootN.innerHTML.includes('不涉及付款'));
 bizClick(c,'instructor-open');
 assert.ok(c.rootN.innerHTML.includes('data-biz-form="instructor"')&&c.rootN.innerHTML.includes('提交申请'));
 const saved={id:'l1',kind:'lecturer',state:'submitted',fields:{title:'用 Agent 做周报',form:'workshop',length:'2 小时 × 1 次',price:'¥149 / 席',note:''},decision_note:null,created_at:'2026-10-28T01:00:00Z',updated_at:'2026-10-28T01:00:00Z'};
 c.routes['PUT /social/applications/lecturer']={data:saved};
 bizSubmit(c,'instructor',{title:'用 Agent 做周报',length:'2 小时 × 1 次',price:'¥149 / 席',note:''});await tick();
 const put=find(c,'PUT','/social/applications/lecturer')[0];
 assert.deepStrictEqual(JSON.parse(JSON.stringify(put.body)),{title:'用 Agent 做周报',form:'workshop',length:'2 小时 × 1 次',price:'¥149 / 席',note:''});
 assert.ok(put.opts.idempotencyKey);
 assert.ok(c.rootN.innerHTML.includes('已提交，等待审核'));
 // 已有结果：显示审核说明，只能重新申请
 c=bizCtx('creator',[Object.assign({},saved,{state:'rejected',decision_note:'再积累几场讲堂'})]);await tick();
 const html=c.rootN.innerHTML;
 assert.ok(html.includes('这次没有通过')&&html.includes('再积累几场讲堂')&&html.includes('重新申请'));
 assert.ok(!html.includes('data-biz-act="instructor-clear"'),'有结果后不能撤回');
 // 501：功能没开
 c=bizCtx('sponsor',[]);await tick();
 bizClick(c,'chip',{'data-group':'types','data-value':'slot'});
 c.routes['PUT /social/applications/sponsor']=fail('x',501,'capability_unavailable');
 bizSubmit(c,'sponsor',{brand:'甲',budget:'',time:'',note:''});await tick();
 assert.ok(c.toasts.includes('这个功能还没开放'));
 done('lecturer');
})().catch(bail);
''')

    def test_applications_gate_shows_reason_and_disables_button(self):
        self.run_node(BUSINESS + r'''
(async()=>{
 const why='需要 L3（你现在是 L1）';
 let c=bizCtx('creator',[],blocked(why));await tick();
 let html=c.rootN.innerHTML;
 assert.ok(html.includes(why),'原因写出来');
 assert.ok(html.includes('disabled title="'+why+'"'),'按钮灰掉并带 title');
 assert.ok(!html.includes('data-biz-act="instructor-open"'));
 c=bizCtx('sponsor',[],blocked('请先登录'));await tick();
 html=c.rootN.innerHTML;
 assert.ok(html.includes('请先登录')&&html.includes('disabled title="请先登录"')&&!html.includes('data-biz-form="sponsor"'));
 done('apps-gate');
})().catch(bail);
''')

    # ---------------------------------------------------------- rooms.js
    def test_room_chat_live_list_send_retry_delete(self):
        self.run_node(ROOMS + r'''
(async()=>{
 const c=roomCtx();await tick(80);
 let html=c.all();
 assert.ok(find(c,'GET','/rooms/r1/messages').length>=1);
 assert.ok(html.includes('文字讨论')&&html.includes('data-rm-chat'),'有输入框');
 assert.ok(!html.includes('THREAD-1')&&!html.includes('示例，不会发出去'));
 assert.ok(html.includes('你好 &lt;b&gt;粗体&lt;/b&gt;')&&!html.includes('<b>粗体</b>'),'正文被转义');
 assert.ok(html.includes('data-room-act=\\"chat-delete\\" data-id=\\"m2\\"'),'自己的话可撤回');
 assert.ok(!html.includes('data-id=\\"m1\\"')||!html.includes('chat-delete\\" data-id=\\"m1'),'别人的话非主持人不能删');
 // 发送：失败保留输入，重试沿用同一幂等键
 typing(c,'  收到  ');
 c.routes['POST /rooms/r1/messages']=fail('每分钟最多 20 条',429,'rate_limited');
 c.document.dispatchEvent('submit',{target:chatForm(),preventDefault(){}});await tick();
 let posts=find(c,'POST','/rooms/r1/messages');
 assert.equal(posts.length,1);assert.deepStrictEqual(JSON.parse(JSON.stringify(posts[0].body)),{text:'收到'});
 assert.ok(posts[0].opts.idempotencyKey);
 assert.ok(c.toasts.includes('每分钟最多 20 条'));
 c.routes['POST /rooms/r1/messages']={data:MSG('m3','收到',{id:'me1',name:'我自己',level:2})};
 c.document.dispatchEvent('submit',{target:chatForm(),preventDefault(){}});await tick();
 posts=find(c,'POST','/rooms/r1/messages');
 assert.equal(posts.length,2);assert.equal(posts[1].opts.idempotencyKey,posts[0].opts.idempotencyKey,'重试沿用同一幂等键');
 assert.ok(c.all().includes('收到'),'发出的话立刻出现在列表里');
 // 空内容不发
 typing(c,'   ');
 c.document.dispatchEvent('submit',{target:chatForm(),preventDefault(){}});await tick();
 assert.equal(find(c,'POST','/rooms/r1/messages').length,2);
 // 撤回
 roomClick(c,'chat-delete','m2');await tick();
 assert.equal(find(c,'DELETE','/rooms/r1/messages/m2').length,1);
 assert.equal(c.writes.length,0);
 done('room-chat');
})().catch(bail);
''')

    def test_room_chat_host_can_delete_others_and_gate_shows_reason(self):
        self.run_node(ROOMS + r'''
(async()=>{
 // 主持人能删别人的
 const hostDetail=Object.assign({},DETAIL,{is_host:true,me:Object.assign({},DETAIL.me,{role:'host',is_host:true})});
 let c=roomCtx(null,null,hostDetail);await tick(80);
 let html=c.all();
 assert.ok(html.includes('chat-delete\\" data-id=\\"m1'),'主持人看得到别人那条的删除');
 // 能力门：rooms.chat 被挡，输入框灰掉并写原因，不发请求
 const why='这个功能还没开放';
 c=roomCtx(null,blocked(why));await tick(80);
 html=c.all();
 assert.ok(html.includes(why),'原因写出来');
 assert.ok(html.includes('disabled title=\\"'+why+'\\"'),'输入框和按钮灰掉');
 typing(c,'想说话');
 c.document.dispatchEvent('submit',{target:chatForm(),preventDefault(){}});await tick();
 assert.equal(find(c,'POST','/rooms/r1/messages').length,0);
 done('room-chat-gate');
})().catch(bail);
''')

    def test_room_chat_not_present_or_ended_is_read_only(self):
        self.run_node(ROOMS + r'''
(async()=>{
 const away=Object.assign({},DETAIL,{me:Object.assign({},DETAIL.me,{present:false})});
 const c=roomCtx(c=>{c.routes['POST /rooms/r1/join']=new Error('wait');},null,away);await tick(80);
 const html=c.all();
 assert.ok(!html.includes('data-rm-chat')||!html.includes('placeholder=\\"说点什么\\"'),'不在房间里没有输入框');
 done('room-chat-readonly');
})().catch(bail);
''')


if __name__ == '__main__':
    unittest.main()
