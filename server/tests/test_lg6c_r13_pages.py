"""LG-6C R13: real-mode main pages draw server data instead of the empty skeleton (offline VM).

Pages: open discussion, works & members, person redirect (app.js), knowledge list/detail (knowledge-net.js),
work wheel (work-hub.js), events create / signup list / results (events.js), my-posts type labels (member.js).
Mutation tests run the same scripts against the pre-change copies in docs/evidence/LG-6C/r13/, which must FAIL.
"""
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_lg6c_app_shell import COMMON as APP_COMMON  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BEFORE = 'docs/evidence/LG-6C/r13/'

EVENTS = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=require('path').resolve(process.argv[1]);
const file=process.argv[1]+'/'+process.argv[2];
const tick=async(n=10)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function node(attrs={}){const n={attrs,innerHTML:'',value:'',children:[],getAttribute:k=>attrs[k]??null,setAttribute(k,v){attrs[k]=v},removeAttribute(k){delete attrs[k]},insertAdjacentHTML(w,h){n.innerHTML=h},remove(){},hasAttribute:k=>k in attrs,matches:()=>false,focus(){},addEventListener(k,f){(n.l??={})[k]=f},removeEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],contains:()=>true,closest:()=>null,classList:{add(){},remove(){},toggle(){}}};return n;}
function make(routes,hash){
 const calls=[],writes=[],toasts=[];
 const rootN=node({'data-evt-root':'','data-evt-id':'ev1'});
 const c={console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,AbortController,setTimeout,clearTimeout,Intl,
  location:{hash},calls,writes,toasts,rootN};
 c.document={querySelector:s=>s==='[data-evt-root]'?rootN:null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},body:node(),createElement:()=>node()};
 c.matchMedia=()=>({matches:false});
 c.CommonsAPI={mode:'live',newIdempotencyKey:()=>'K1',
  get(p){calls.push(['GET',p]);const r=routes.get[p];if(r instanceof Error)return Promise.reject(r);return r===undefined?Promise.reject(Object.assign(Error('nf '+p),{status:404})):Promise.resolve({data:r,meta:{}});},
  post(p,b,o){calls.push(['POST',p,b,o&&o.idempotencyKey]);const r=routes.post[p];if(r instanceof Error)return Promise.reject(r);return Promise.resolve({data:r||{},meta:{}});}};
 c.Commons={toast:m=>toasts.push(m),refresh(){c.refreshed=(c.refreshed||0)+1;try{rootN.innerHTML=c.CommonsEvents.routes.event()}catch(e){c.err=e}},write:(k,v)=>{writes.push([k,v]);return true},read:(k,d)=>d};
 c.window=c;c.self=c;vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;
}

const click=(c,act,attrs={})=>{const t={getAttribute:k=>k==='data-evt-act'?act:(attrs[k]??null),closest:()=>t};c.rootN.l.click({target:t});};
const remount=async(c)=>{c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.event();c.CommonsEvents.mount();await tick();};
(async()=>{
 const sess=roles=>({hasRole:r=>roles.includes(r),can:a=>a==='events.manage'&&roles.includes('admin')});
 const ended={id:'ev9',kind:'challenge',title:'已结束活动',summary:'s',startsAt:'2020-01-01',endsAt:'2020-01-02',status:'ended',signups:2};
 const mk=(routes,hash,roles=[])=>{const c=make(routes,hash);c.CommonsSession=sess(roles);c.Commons.refresh=function(){c.rootN.innerHTML=c.CommonsEvents.routes[hash.startsWith('#/event/')?'event':'events']();c.CommonsEvents.mount();};return c;};
 // signup names + results on an ended event come from the server
 let c=mk({get:{'/events':[JSON.parse(JSON.stringify(ended))],'/events/campaigns':[],'/events/ev9':ended,'/events/ev9/signups':[{id:'u1',name:'甲同学',at:'2020-01-01'},{id:'u2',name:'乙同学',at:'2020-01-01'}],
  '/events/ev9/results':{stats:{signups:2,submissions:1,voters:1,ballots:3},winners:[{rank:1,title:'冠军作品',author:'甲同学',votes:3}]}},post:{}},'#/event/ev9');
 c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.event();c.CommonsEvents.mount();await tick();
 let html=c.CommonsEvents.routes.event();
 assert(c.calls.some(x=>x[1]==='/events/ev9/signups')&&c.calls.some(x=>x[1]==='/events/ev9/results'),'signups and results are read');
 assert(html.includes('甲同学')&&html.includes('乙同学')&&html.includes('共 2 人'),'signup names listed');
 assert(!html.includes('还没有人报名'));
 assert(html.includes('data-evt-results')&&html.includes('冠军作品')&&html.includes('3 票')&&html.includes('<dt>总票</dt><dd>3</dd>'),'results shown');
 // results unreadable: detail still renders
 c=mk({get:{'/events':[JSON.parse(JSON.stringify(ended))],'/events/campaigns':[],'/events/ev9':ended},post:{}},'#/event/ev9');
 c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.event();c.CommonsEvents.mount();await tick();
 html=c.CommonsEvents.routes.event();assert(html.includes('已结束活动')&&!html.includes('data-evt-results'));
 // create: only admins / hosts see the button
 const list=roles=>{const c=mk({get:{'/events':[],'/events/campaigns':[]},post:{'/events':{id:'new1',kind:'challenge',title:'新活动',status:'upcoming'}}},'#/events',roles);return c;};
 c=list([]);c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.events();assert(!c.rootN.innerHTML.includes('data-evt-act="create-open"'),'members do not see create');
 c=list(['admin']);c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.events();c.CommonsEvents.mount();
 assert(c.rootN.innerHTML.includes('data-evt-act="create-open"'));
 click(c,'create-open');assert(c.rootN.innerHTML.includes('data-evt-act="create-send"'),'form opens');
 const fields={kind:{value:'meetup'},title:{value:'  线下聚会 '},summary:{value:'一起聊'},place:{value:'会议室'},starts:{value:'2099-01-01T10:00'},ends:{value:'2099-01-01T12:00'},rules:{value:''}};
 c.rootN.querySelector=sel=>{const m=/data-evt-create="(\w+)"/.exec(sel);return m?fields[m[1]]:null;};
 click(c,'create-send');
 const posts=c.calls.filter(x=>x[0]==='POST');
 assert.equal(posts.length,1);assert.equal(posts[0][1],'/events');assert.equal(posts[0][3],'K1');
 const b=posts[0][2];assert.equal(b.kind,'meetup');assert.equal(b.title,'线下聚会');assert.equal(b.place,'会议室');assert.equal(b.visibility,'members');
 assert.equal(b.starts_at,new Date('2099-01-01T10:00').toISOString());assert.equal(b.ends_at,new Date('2099-01-01T12:00').toISOString());
 assert(!c.toasts.includes('活动已创建'),'no success before the server answers');
 await tick();assert(c.toasts.includes('活动已创建'));assert.equal(c.writes.length,0);assert.equal(c.location.hash,'#/event/new1');
 // client-side validation does not post
 c=list(['admin']);c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.events();c.CommonsEvents.mount();click(c,'create-open');
 c.rootN.querySelector=sel=>{const m=/data-evt-create="(\w+)"/.exec(sel);return m?{kind:{value:'meetup'},title:{value:'x'},summary:{value:''},place:{value:''},starts:{value:'2099-01-02T10:00'},ends:{value:'2099-01-01T10:00'},rules:{value:''}}[m[1]]:null;};
 click(c,'create-send');assert.equal(c.calls.filter(x=>x[0]==='POST').length,0);assert(c.rootN.innerHTML.includes('结束时间必须晚于开始时间'));
 // server refusal is shown, form stays open
 c=mk({get:{'/events':[],'/events/campaigns':[]},post:{'/events':Object.assign(Error('没有权限创建活动'),{status:403})}},'#/events',['admin']);c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.events();c.CommonsEvents.mount();click(c,'create-open');
 c.rootN.querySelector=sel=>{const m=/data-evt-create="(\w+)"/.exec(sel);return m?{kind:{value:'meetup'},title:{value:'x'},summary:{value:''},place:{value:''},starts:{value:'2099-01-01T10:00'},ends:{value:'2099-01-02T10:00'},rules:{value:''}}[m[1]]:null;};
 click(c,'create-send');await tick();assert(c.toasts.includes('没有权限创建活动')&&!c.toasts.includes('活动已创建'));assert(c.rootN.innerHTML.includes('没有权限创建活动')&&c.rootN.innerHTML.includes('data-evt-act="create-send"'));
 console.log('EVENTS_R13_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

KNET = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const file=process.argv[1]+'/'+process.argv[2];
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const mkNode=()=>{const n={innerHTML:'',hidden:false,removed:false,remove(){n.removed=true},querySelector:()=>null,addEventListener(){},insertAdjacentHTML(w,h){n.innerHTML+=h},getAttribute:()=>null};return n;};
function make(routes,hash){
 const calls=[],parts={};
 const sub=k=>parts[k]??=mkNode();
 parts.empty=mkNode();parts.empty.hidden=true;
 const body=mkNode(),rows=mkNode(),more=mkNode(),status=mkNode();
 body.querySelector=s=>({'[data-knet-live-rows]':rows,'[data-knet-live-more]':more}[s]||null);
 const host={isConnected:true,getAttribute:k=>k==='data-id'?((/#\/knowledge\/([^/?#]+)/.exec(hash)||[])[1]||null):null,
  querySelector:s=>({'.knet-live-status':status,'[data-knet-live-empty]':parts.empty,'[data-knet-live-body]':body}[s]||null)};
 const root={querySelector:s=>s==='[data-knet-live]'?host:null,addEventListener(){},removeEventListener(){},isConnected:true,innerHTML:''};
 const c={console,Promise,Date,Math,Number,String,Array,Object,JSON,Boolean,Map,Set,Intl,RegExp,URL,setTimeout,clearTimeout,performance:{now:()=>0},calls,parts,body,rows,more,status,host,
  requestAnimationFrame:()=>1,cancelAnimationFrame(){},innerWidth:1440,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=>''}),
  location:{hash,search:''},document:{querySelector:s=>s==='[data-knet-root]'?root:null,documentElement:{},addEventListener(){},removeEventListener(){}},
  Commons:{esc,icon:()=>'',safeUrl:u=>u},
  CommonsAPI:{mode:'live',get(p,q){calls.push([p,q]);const r=routes[p];if(r instanceof Error)return Promise.reject(r);return Promise.resolve({data:r,meta:{next_cursor:null}})}}};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;
}
(async()=>{
 let c=make({'/objects':[{id:'k1',type:'knowledge',title:'怎样写好提示词',excerpt:'先说清目标',author:{display_name:'甲'},created_at:'2026-10-20T10:00:00Z'}]},'#/knowledge');
 const html=c.CommonsKnowledge.view('');
 assert(html.includes('data-knet-live')&&html.includes('正在读取…'),'placeholder');
 assert(html.includes('知识网还没长出来')&&html.includes('<div hidden data-knet-live-empty>'),'old empty state kept but hidden');
 c.CommonsKnowledge.mount();await tick();
 assert.deepEqual(c.calls,[['/objects',{type:'knowledge',limit:30}]]);
 assert(c.rows.innerHTML.includes('href="#/read/k1"')&&c.rows.innerHTML.includes('怎样写好提示词')&&c.rows.innerHTML.includes('知识条目'),c.rows.innerHTML);
 assert(c.body.innerHTML.includes('href="#/write"'));assert.equal(c.parts.empty.hidden,true);
 // empty -> old empty state revealed
 c=make({'/objects':[]},'#/knowledge');c.CommonsKnowledge.view('');c.CommonsKnowledge.mount();await tick();assert.equal(c.parts.empty.hidden,false);
 // error / 501
 c=make({'/objects':Object.assign(Error('服务暂时不可用'),{status:503})},'#/knowledge');c.CommonsKnowledge.view('');c.CommonsKnowledge.mount();await tick();
 assert(c.body.innerHTML.includes('服务暂时不可用')&&c.body.innerHTML.includes('data-knet-live-retry'));
 c=make({'/objects':Object.assign(Error('x'),{status:501,code:'capability_unavailable'})},'#/knowledge');c.CommonsKnowledge.view('');c.CommonsKnowledge.mount();await tick();assert(c.body.innerHTML.includes('这个功能还没开放'));
 // article detail
 c=make({'/content/objects/k1':{id:'k1',type:'knowledge',title:'怎样写好提示词',excerpt:'先说清目标',author:{display_name:'甲'},content:{summary:'一句话摘要'}}},'#/knowledge/k1');
 c.CommonsKnowledge.view('k1');c.CommonsKnowledge.mount();await tick();
 assert.deepEqual(c.calls,[['/content/objects/k1',undefined]]);
 assert(c.body.innerHTML.includes('怎样写好提示词')&&c.body.innerHTML.includes('一句话摘要')&&c.body.innerHTML.includes('href="#/read/k1"'),c.body.innerHTML);
 c=make({'/content/objects/gone':Object.assign(Error('nf'),{status:404})},'#/knowledge/gone');c.CommonsKnowledge.view('gone');c.CommonsKnowledge.mount();await tick();
 assert(c.body.innerHTML.includes('没有找到这篇内容'));
 console.log('KNET_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

WORKHUB = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const file=process.argv[1]+'/'+process.argv[2];
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function node(){const kids={};const n={nodeType:1,getElementById:k=>kids[k]??=node(),innerHTML:'',isConnected:true,dataset:{},attrs:{},getAttribute:k=>n.attrs[k]??null,setAttribute(k,v){n.attrs[k]=v},removeAttribute(){},querySelector:k=>kids[k]??=node(),querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},appendChild(){},contains:()=>true,focus(){},classList:{add(){},remove(){},toggle(){}},style:{setProperty(){}},getBoundingClientRect:()=>({width:600,height:600,left:0,top:0})};return n;}
function make(routes){
 const calls=[];
 const c={console,Promise,Date,Math,Number,String,Array,Object,JSON,Boolean,Map,Set,Intl,RegExp,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){},calls,
  requestAnimationFrame:()=>1,cancelAnimationFrame(){},innerWidth:1200,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=>''}),
  document:{documentElement:node(),body:node(),createElement:node,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},getElementById:()=>node()},
  Commons:{esc,icon:()=>'',safeUrl:u=>u},COMMONS_DATA:{people:[],works:[]},
  CommonsAPI:{mode:'live',get(p,q){calls.push([p,q]);const r=routes[p];if(r instanceof Error)return Promise.reject(r);return Promise.resolve({data:r,meta:{}})}}};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;
}
(async()=>{
 const works=[{id:'w1',type:'work',title:'我的作品',excerpt:'一段说明',author:{display_name:'乙同学'}}];
 let c=make({'/objects':works});const el=node();
 c.CommonsWorkHub.render(el);
 assert(el.innerHTML.includes('正在把实践摆上轮盘'),'loading first');
 await tick();
 assert.deepEqual(c.calls,[['/objects',{type:'work',limit:30}]]);
 assert(el.innerHTML.includes('id="wh-n-real">1<')&&el.innerHTML.includes('件作品'),'one real work counted');
 assert(!el.innerHTML.includes('示例'),'no sample wording in live');
 // empty and failing
 c=make({'/objects':[]});const e2=node();c.CommonsWorkHub.render(e2);await tick();assert(e2.innerHTML.includes('还没有可转的作品'));
 c=make({'/objects':Object.assign(Error('x'),{status:500})});const e3=node();c.CommonsWorkHub.render(e3);await tick();assert(e3.innerHTML.includes('作品没有加载出来'));
 // explicit items still win (no request)
 c=make({});const e4=node();c.CommonsWorkHub.render(e4,[{id:'a',title:'直接传入',summary:'s',category:'作品',who:'丙'}]);assert.equal(c.calls.length,0);assert(e4.innerHTML.includes('id="wh-n-real">1<'));
 console.log('WORKHUB_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

MEMBER = r'''

const fs=require('fs'),vm=require('vm'),assert=require('assert');
const file=process.argv[1]+'/'+process.argv[2];
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function make(mode,routes={}){
 const calls=[],listeners={};
 const slots={};
 const slot=sel=>slots[sel]??={innerHTML:'',textContent:'',setAttribute(){}};
 const root={dataset:{memberWorkspace:'dashboard'},isConnected:true,querySelector:sel=>/^\[data-member-(posts|saved|post-count|saved-count|drafts|activity|draft-count)\]$/.test(sel)?slot(sel):null};
 const c={console,Promise,Date,Math,Number,String,Array,Object,JSON,Boolean,Map,Set,Intl,RegExp,URL,Blob,setTimeout,clearTimeout,calls,slots,root,
  crypto:{randomUUID:()=>'id'},FormData:class{},
  document:{querySelector:s=>s==='[data-member-workspace]'?root:null,addEventListener(k,f){listeners[k]=f}},
  Commons:{esc,safeUrl:u=>/^(\/|#|https?:)/.test(String(u))?esc(u):'#',icon:n=>'',avatar:()=>'',read:(k,d)=>d,write:()=>true,refresh(){},toast(){}},
  COMMONS_DATA:{people:[],methods:[],works:[]},COMMONS_FIELDWORK:{items:[]},
  CommonsContributions:{listSummary:()=>Promise.resolve([])},
  CommonsAPI:{mode,get(p,q){calls.push([p,q]);const r=routes[p];if(r instanceof Error)return Promise.reject(r);return Promise.resolve({data:r||[],meta:{next_cursor:null}})}},
  CommonsSession:{state:'member',me:{id:'u1',handle:'real-user',display_name:'真实队员',avatar_ref:'/api/media/f/face.webp',level:3,roles:[]}}};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;
}
(async()=>{
 const obj={id:'o1',type:'discussion',title:'我的第一篇',lifecycle:'active',created_at:'2026-10-20T10:00:00Z',published_at:'2026-10-20T10:00:00Z'};
 const sav={id:'s1',type:'knowledge',title:'收藏的条目',lifecycle:'active',created_at:'2026-10-21T10:00:00Z',author:{display_name:'某人'}};
 const rep={id:'r1',type:'reply',title:'一条回复',root_id:'o1',lifecycle:'active',created_at:'2026-10-22T10:00:00Z'},soc={id:'p1',type:'social_post',title:'一条动态',lifecycle:'active',created_at:'2026-10-23T10:00:00Z'},odd={id:'x1',type:'weird_type',title:'奇怪类型',lifecycle:'active',created_at:'2026-10-24T10:00:00Z'};
 let c=make('live',{'/objects':[obj,rep,soc,odd],'/content/saved':[sav]});
 let html=c.CommonsMember.dashboard();
 assert(!html.includes('本机'),'no 本机 wording in live dashboard');
 assert(html.includes('href="#/write"'),'write link is #/write');
 assert(html.includes('href="#/account"'),'edit profile points to #/account');
 for(const bad of ['#/join','#/profile','#/contribute','data-scroll="member-notes"','member-practice','export-local','reset-local'])assert(!html.includes(bad),'live dashboard must not contain '+bad);
 assert(html.includes('真实队员')&&html.includes('@real-user')&&html.includes('L3')&&html.includes('/api/media/f/face.webp'),'identity from session');
 c.CommonsMember.mount();await tick();
 assert.deepEqual(c.calls,[['/objects',{author_id:'u1',limit:50}],['/content/saved',{limit:20}]]);
 const posts=c.slots['[data-member-posts]'].innerHTML,saved=c.slots['[data-member-saved]'].innerHTML;
 assert(posts.includes('href="#/read/o1"')&&posts.includes('我的第一篇')&&posts.includes('讨论')&&posts.includes('已发布'),posts);
 assert(!posts.includes('一条回复')&&!posts.includes('href="#/read/r1"'),'replies are not listed as posts');
 assert(posts.includes('动态')&&!posts.includes('social_post')&&!posts.includes('weird_type')&&posts.includes('内容'),'type codes are mapped to Chinese, unknown -> 内容');
 assert(saved.includes('href="#/read/s1"')&&saved.includes('收藏的条目')&&saved.includes('某人'),saved);
 assert.equal(c.slots['[data-member-post-count]'].textContent,3);assert.equal(c.slots['[data-member-saved-count]'].textContent,1);
 assert(!posts.includes('本机')&&!saved.includes('本机'));
 // empty states
 c=make('live',{'/objects':[],'/content/saved':[]});c.CommonsMember.mount();await tick();
 assert(c.slots['[data-member-posts]'].innerHTML.includes('href="#/write"')&&c.slots['[data-member-posts]'].innerHTML.includes('写第一篇'));
 assert(!c.slots['[data-member-posts]'].innerHTML.includes('本机'));
 // errors: server message + retry; 501 neutral
 c=make('live',{'/objects':Object.assign(Error('服务暂时不可用'),{status:503}),'/content/saved':Object.assign(Error('x'),{status:501,code:'capability_unavailable'})});c.CommonsMember.mount();await tick();
 assert(c.slots['[data-member-posts]'].innerHTML.includes('服务暂时不可用')&&c.slots['[data-member-posts]'].innerHTML.includes('data-action="member-retry"'));
 assert(c.slots['[data-member-saved]'].innerHTML.includes('这个功能还没开放')&&!c.slots['[data-member-saved]'].innerHTML.includes('member-retry'));
 // profile / setup never show the local form in live
 for(const page of ['profile','setup']){const h=c.CommonsMember[page]();assert(h.includes('href="#/account"')&&!h.includes('本机')&&!h.includes('<form'),page);}
 assert.equal(c.CommonsMember.welcome(),'');assert.equal(c.CommonsMember.identity().name,'真实队员');
 // demo unchanged
 const d=make('demo');html=d.CommonsMember.dashboard();
 assert(html.includes('本机工作区 · 内容只保存在本机，尚未连接社区账号或消息服务。')&&html.includes('href="#/join"')&&html.includes('href="#/contribute"'),'demo keeps the local workspace');
 assert(d.CommonsMember.setup().includes('本机试用资料'));
 console.log('MEMBER_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});


'''

APP_LIVE = r'''
const mkNode=()=>{const n={innerHTML:'',hidden:false,dataset:{},removed:false,remove(){n.removed=true},querySelector:()=>null,addEventListener(){},insertAdjacentHTML(w,h){n.innerHTML+=h}};return n;};
function attachHost(x,c){
 // fake the page host so the async fill can be observed
 const main=x.nodes['#main'];const subs={};
 const sub=sel=>subs[sel]??=mkNode();
 main.querySelector=sel=>{
  if(sel!=='[data-live-list]')return null;
  const m=/data-live-list="([^"]+)"(?: data-live-id="([^"]+)")?/.exec(main.innerHTML);if(!m)return null;
  const body=mkNode(),status=mkNode(),empty=mkNode();empty.hidden=true;const rows=mkNode(),more=mkNode(),wh=mkNode();
  const bodyQ=s=>({'[data-live-rows]':rows,'[data-live-more]':more,'[data-live-wh]':wh}[s]||null);
  body.querySelector=bodyQ;
  const host={dataset:{liveList:m[1],liveId:m[2]||''},isConnected:true,querySelector:s=>({'[data-live-status]':status,'[data-live-empty]':empty,'[data-live-body]':body}[s]||null),parts:{body,status,empty,rows,more,wh}};
  subs.host=host;return host;
 };
 return subs;
}
async function open(hash,answers,opts={}){
 const x=setup(false,ORIG);const {c,nodes}=x;await asMember(x);
 c.CommonsMotion.reveal=()=>{};c.CommonsWorkHub={render(el,items){c.hubItems=items;c.hubEl=el;},destroy(){}};
 const subs=attachHost(x,c);
 c.location.hash=hash;c.Commons.refresh();
 const host=subs.host;
 for(const a of answers){await tick();while(c.pending.length){const url=c.calls[c.calls.length-c.pending.length].url;const r=a(url);c.reply(r[0],r[1],0);}await tick();await tick();}
 await tick();await tick();
 return {c,nodes,host,html:nodes['#main'].innerHTML};
}
const ok=data=>[200,data],bad=(status,msg)=>[status,undefined];
(async()=>{
 // discussion list
 let r=await open('#/discuss',[url=>ok([{id:'d1',type:'discussion',title:'失败的版本值得放进作品集吗',excerpt:'想公开一个没达到预期的版本',author:{display_name:'甲'},created_at:'2026-10-20T10:00:00Z'}])]);
 assert(r.html.includes('data-live-list="discuss"')&&r.html.includes('正在读取…'),'sync placeholder');
 assert(r.html.includes('class="empty"')&&r.html.includes('<div hidden data-live-empty>'),'empty card present but hidden');
 assert(r.c.calls.some(x=>/\/api\/objects\?/.test(x.url)&&x.url.includes('type=discussion')),'asks for discussion objects: '+r.c.calls.map(x=>x.url));
 const rows=r.host.parts.rows.innerHTML;
 assert(rows.includes('href="#/threads/d1"')&&rows.includes('失败的版本值得放进作品集吗')&&rows.includes('讨论')&&rows.includes('甲'),rows);
 assert.equal(r.host.parts.empty.hidden,true,'empty stays hidden when there are rows');
 assert(r.host.parts.body.innerHTML.includes('href="#/threads"'),'toolbar with the threads link');
 // empty -> R8 empty card shown
 r=await open('#/discuss',[url=>ok([])]);assert.equal(r.host.parts.empty.hidden,false,'empty card revealed');
 // errors
 r=await open('#/discuss',[url=>[500,undefined]]);assert(r.host.parts.body.innerHTML.includes('没有读出来')&&r.host.parts.body.innerHTML.includes('data-live-retry'),r.host.parts.body.innerHTML);
 // gallery: works + members
 r=await open('#/people',[url=>url.includes('/objects')?ok([{id:'w1',type:'work',title:'我的作品',excerpt:'说明',author:{display_name:'乙'},created_at:'2026-10-21T10:00:00Z'}]):ok({items:[{id:'u1',handle:'amy',display_name:'艾米',level:2},{id:'u2',handle:null,display_name:'无名'}]})]);
 assert(r.c.calls.some(x=>x.url.includes('/api/objects?')&&x.url.includes('type=work')),'works asked');
 assert(r.c.calls.some(x=>x.url.includes('/api/social/profiles')),'members asked');
 const g=r.host.parts.body.innerHTML;
 assert(g.includes('href="#/work/w1"')&&g.includes('我的作品'),g);
 assert(g.includes('href="#/u/amy"')&&g.includes('艾米')&&g.includes('@amy · L2')&&!g.includes('无名'),g);
 assert(g.includes('data-live-wh')&&r.c.hubItems&&r.c.hubItems[0].id==='w1'&&r.c.hubItems[0].who==='乙','work hub gets the real works');
 // person: existing handle jumps to the public page, missing keeps the empty card
 r=await open('#/people/amy',[url=>ok({handle:'amy'})]);assert.equal(r.c.location.hash,'#/u/amy');
 r=await open('#/people/nobody',[url=>[404,undefined]]);assert.equal(r.host.parts.empty.hidden,false);assert(r.html.includes('没有找到这位成员'));
 // demo untouched
 const d=setup(true,false);d.c.location.hash='#/discuss';try{d.c.Commons.refresh();}catch(e){}
 assert(!d.nodes['#main'].innerHTML.includes('data-live-list'),'demo has no live host');
 console.log('APP_LIVE_PAGES_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''



def node(script, *args, common=''):
    return subprocess.run(['node', '-e', common + script, str(ROOT), *args], capture_output=True, text=True)


def app_common(original):
    return APP_COMMON.replace('LG-6C/before-app.js', 'LG-6C/r13/before-app.js') if original else APP_COMMON


class LG6CR13Pages(unittest.TestCase):
    def passes(self, script, marker, rel, common=''):
        result = node(script, rel, common=common)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn(marker, result.stdout)

    def fails_before(self, script, rel, common=''):
        result = node(script, rel, common=common)
        self.assertNotEqual(result.returncode, 0, 'the pre-change file must fail this test')

    def test_app_live_pages(self):
        self.passes(APP_LIVE.replace('ORIG', 'false'), 'APP_LIVE_PAGES_PASS', '', common=app_common(False))

    def test_app_live_pages_pre_change_fails(self):
        self.fails_before(APP_LIVE.replace('ORIG', 'true'), '', common=app_common(True))

    def test_knowledge_list_and_detail(self):
        self.passes(KNET, 'KNET_PASS', 'preview/knowledge-net.js')

    def test_knowledge_pre_change_fails(self):
        self.fails_before(KNET, BEFORE + 'before-knowledge-net.js')

    def test_work_hub_reads_real_works(self):
        self.passes(WORKHUB, 'WORKHUB_PASS', 'preview/work-hub.js')

    def test_work_hub_pre_change_fails(self):
        self.fails_before(WORKHUB, BEFORE + 'before-work-hub.js')

    def test_events_create_signups_results(self):
        self.passes(EVENTS, 'EVENTS_R13_PASS', 'preview/events.js')

    def test_events_pre_change_fails(self):
        self.fails_before(EVENTS, BEFORE + 'before-events.js')

    def test_member_post_types_and_replies(self):
        self.passes(MEMBER, 'MEMBER_PASS', 'preview/member.js')

    def test_member_pre_change_fails(self):
        self.fails_before(MEMBER, BEFORE + 'before-member.js')


if __name__ == '__main__':
    unittest.main()
