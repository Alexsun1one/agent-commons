"""LG-6C R10: real-mode write actions go to the server first, never fake success (offline VM).

Each script runs against the current preview file and, in the mutation tests, against the
pre-change copy saved in docs/evidence/LG-6C/r10/before-*.js, which must FAIL.
"""
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_lg6c_app_shell import COMMON as APP_COMMON  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BEFORE = 'docs/evidence/LG-6C/r10/'

EVENTS = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
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
 const ev={id:'ev1',kind:'event',title:'测试活动',summary:'s',startsAt:'2099-01-01',endsAt:'2099-01-02',signups:2,status:'open',signedUp:false};
 const mk=(post)=>{const e=JSON.parse(JSON.stringify(ev));const c=make({get:{'/events':[e],'/events/campaigns':[],'/events/ev1':e},post},'#/event/ev1');c.Commons.refresh=function(){c.refreshed=(c.refreshed||0)+1;c.rootN.innerHTML=c.CommonsEvents.routes.event();};return c;};
 // live shows no 示例 tag on real events (R11 label sweep)
 // signup success: POST first, button flips only after the server answers
 let c=mk({'/events/ev1/signup':{}});
 c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.event();
 assert(c.rootN.innerHTML.includes('data-evt-act="signup"'));
 assert(!c.rootN.innerHTML.includes('示例'),'no 示例 tag on live events');
 click(c,'signup');
 assert.deepEqual(c.calls.filter(x=>x[0]==='POST'),[['POST','/events/ev1/signup',{},'K1']],'signup posts with idempotency key');
 assert.equal(c.writes.length,0,'no shared Commons.write');
 assert(!c.toasts.includes('已报名'),'no success toast before the server answers');
 await tick();
 assert(c.toasts.includes('已报名'),'success toast after confirm');
 assert(!c.CommonsEvents.routes.event().includes('data-evt-act="signup"'),'signed up state after reread');
 // signup failure: server message, nothing flips
 const bad=Object.assign(Error('报名已截止'),{status:409,code:'conflict'});
 c=mk({'/events/ev1/signup':bad});c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.event();
 click(c,'signup');await tick();
 assert(c.toasts.includes('报名已截止')&&!c.toasts.includes('已报名'),'server error shown, no success');
 assert(c.CommonsEvents.routes.event().includes('data-evt-act="signup"'),'still not signed up after failure');
 assert.equal(c.writes.length,0);
 // 501 -> neutral copy
 c=mk({'/events/ev1/signup':Object.assign(Error('not implemented'),{status:501,code:'capability_unavailable'})});c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.event();
 click(c,'signup');await tick();assert(c.toasts.includes('这个功能还没开放'),'501 neutral copy');
 // demo unchanged: local write, no POST
 const d=make({get:{},post:{}},'#/event/ev1');d.CommonsAPI.mode='demo';
 // submission: title/summary/kind go to the server; form closes only after confirm
 const live=JSON.parse(JSON.stringify(ev));live.status='live';
 const mkLive=(post)=>{const e=JSON.parse(JSON.stringify(live));const c=make({get:{'/events':[e],'/events/campaigns':[],'/events/ev1':e},post},'#/event/ev1');c.Commons.refresh=function(){c.rootN.innerHTML=c.CommonsEvents.routes.event();};
  const f=v=>({value:v,focus(){}});const fields={title:f('我的作品'),summary:f(' 一句话 '),kind:f('repo')};
  c.rootN.querySelector=sel=>{const m=/data-evt-field="(\w+)"/.exec(sel);return m?fields[m[1]]:null;};return c;};
 c=mkLive({'/events/ev1/submissions':{}});c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.event();c.CommonsEvents.mount();
 click(c,'submit');
 assert(c.rootN.innerHTML.includes('data-evt-act="submit-send"'),'live submit opens the form instead of faking success');
 assert(!c.toasts.includes('已提交'));
 click(c,'submit-send');
 assert.deepEqual(c.calls.filter(x=>x[0]==='POST'),[['POST','/events/ev1/submissions',{title:'我的作品',summary:'一句话',source_kind:'repo'},'K1']]);
 assert(!c.toasts.includes('已提交'),'no toast before confirm');
 await tick();assert(c.toasts.includes('已提交'));assert.equal(c.writes.length,0);
 c=mkLive({'/events/ev1/submissions':Object.assign(Error('今天已提交过'),{status:409})});c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.event();c.CommonsEvents.mount();
 click(c,'submit');click(c,'submit-send');await tick();
 assert(c.toasts.includes('今天已提交过')&&!c.toasts.includes('已提交'));assert(c.rootN.innerHTML.includes('今天已提交过'),'error stays visible in the form');
 // vote on a campaign
 const camp={id:'cp1',kind:'campaign',title:'评选',summary:'s',startsAt:'2099-01-01',endsAt:'2099-01-02',status:'live',vote:{canVote:true,remaining:3}};
 const board={event:{},items:[{id:'cand1',authorId:'u2',title:'作品甲',rank:1,delta:0,votes:3}]};
 const mkC=(post)=>{const e=JSON.parse(JSON.stringify(camp));const c=make({get:{'/events':[],'/events/campaigns':[e],'/events/cp1':e,'/events/cp1/board':board},post},'#/campaign/cp1');c.rootN.attrs['data-evt-id']='cp1';c.Commons.refresh=function(){c.rootN.innerHTML=c.CommonsEvents.routes.campaign();};return c;};
 c=mkC({'/events/cp1/votes':{}});c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.campaign();c.CommonsEvents.mount();await tick();
 assert(c.calls.some(x=>x[1]==='/events/cp1/board'),'board is read from the server');
 c.rootN.innerHTML=c.CommonsEvents.routes.campaign();assert(c.rootN.innerHTML.includes('data-evt-act="vote"'),'vote button rendered');
 click(c,'vote',{'data-evt-id':'cand1','data-evt-campaign':'cp1'});
 assert.deepEqual(c.calls.filter(x=>x[0]==='POST'),[['POST','/events/cp1/votes',{candidate_id:'cand1'},'K1']]);
 assert(!c.toasts.length,'no toast before the server confirms');await tick();assert.equal(c.writes.length,0);
 assert.equal(c.calls.filter(x=>x[1]==='/events/cp1/board').length,2,'board re-read after the vote');
 c=mkC({'/events/cp1/votes':Object.assign(Error('票数用完了'),{status:409})});c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.campaign();c.CommonsEvents.mount();await tick();
 click(c,'vote',{'data-evt-id':'cand1','data-evt-campaign':'cp1'});await tick();assert(c.toasts.includes('票数用完了'));
 console.log('EVENTS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

FARM = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const file=process.argv[1]+'/'+process.argv[2];
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function node(attrs={}){const n={attrs,dataset:{},innerHTML:'',value:'',getAttribute:k=>attrs[k]??null,setAttribute(k,v){attrs[k]=v},querySelector:()=>null,querySelectorAll:()=>[],focus(){},matches:()=>false,classList:{add(){},remove(){},toggle(){}}};return n;}
function make(routes,hash){
 const calls=[],writes=[],toasts=[],h={};
 const rootN=node({'data-farm-root':''});
 const c={console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},Intl,location:{hash},calls,writes,toasts,rootN,h};
 c.document={querySelector:s=>s==='[data-farm-root]'?rootN:null,querySelectorAll:()=>[],addEventListener(k,f){h[k]=f},removeEventListener(){},activeElement:null,body:node()};
 c.CommonsAPI={mode:'live',newIdempotencyKey:()=>'K1',
  get(p){calls.push(['GET',p]);const r=routes.get[p];if(r instanceof Error)return Promise.reject(r);return r===undefined?Promise.reject(Object.assign(Error('nf '+p),{status:404})):Promise.resolve({data:JSON.parse(JSON.stringify(r)),meta:{}});},
  post(p,b,o){calls.push(['POST',p,b,o&&o.idempotencyKey]);const r=routes.post[p];if(r instanceof Error)return Promise.reject(r);return Promise.resolve({data:r||{},meta:{}});}};
 c.Commons={esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),safeUrl:u=>String(u||''),icon:()=>'',avatar:()=>'',toast:m=>toasts.push(m),write:(k,v)=>{writes.push([k,v]);return true},read:(k,d)=>d};
 c.window=c;c.self=c;vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;
}
const click=(c,attrs)=>{const ds={};for(const k in attrs)ds[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=attrs[k];const t={dataset:ds,closest:()=>t,getAttribute:k=>attrs[k]??null};c.h.click({target:t});};
const view=()=>({owner:{id:'u1',handle:'me',name:'我',level:2},mine:true,bamboo:100,plotCount:2,watchdog:false,
 plots:[{index:1,state:'empty'},{index:2,state:'empty'}],crops:[{key:'radish',name:'萝卜',seed_cost:5,grow_seconds:600,harvest_bamboo:8}]});
(async()=>{
 const mk=(post)=>{const c=make({get:{'/farm/me':view(),'/farm/friends':[],'/farm/me/messages':[]},post},'#/farm');c.CommonsFarm.mount();return c;};
 let c=mk({'/farm/plots/1/plant':{}});await tick();
 assert(c.rootN.innerHTML.includes('data-farm-action="plot"'),'live farm renders from server view');
 click(c,{'data-farm-action':'plot','data-index':'1'});
 assert(c.rootN.innerHTML.includes('data-farm-action="plant"'),'plant choices');
 const posts=()=>c.calls.filter(x=>x[0]==='POST');
 click(c,{'data-farm-action':'plant','data-crop':'radish'});
 assert.deepEqual(posts(),[['POST','/farm/plots/1/plant',{crop:'radish'},'K1']]);
 assert(!c.toasts.includes('已种下'),'no toast before reread');
 await tick();assert(c.toasts.includes('已种下'));assert.equal(c.writes.length,0);
 assert.equal(c.calls.filter(x=>x[1]==='/farm/me').length,2,'farm reread after the write');
 // failure
 c=mk({'/farm/plots/1/plant':Object.assign(Error('竹子不够'),{status:402})});await tick();
 click(c,{'data-farm-action':'plot','data-index':'1'});click(c,{'data-farm-action':'plant','data-crop':'radish'});await tick();
 assert(c.toasts.includes('竹子不够')&&!c.toasts.includes('已种下'));assert.equal(c.writes.length,0);
 // 501
 c=mk({'/farm/plots/1/plant':Object.assign(Error('x'),{status:501,code:'capability_unavailable'})});await tick();
 click(c,{'data-farm-action':'plot','data-index':'1'});click(c,{'data-farm-action':'plant','data-crop':'radish'});await tick();
 assert(c.toasts.includes('这个功能还没开放'));
 console.log('FARM_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

GROWTH = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const file=process.argv[1]+'/'+process.argv[2];
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function node(attrs={}){const n={attrs,dataset:{page:'leaderboard'},innerHTML:'',value:'',getAttribute:k=>attrs[k]??null,setAttribute(k,v){attrs[k]=v},removeAttribute(){},querySelector:()=>null,querySelectorAll:()=>[],focus(){},matches:()=>false,contains:()=>true,classList:{add(){},remove(){},toggle(){}}};return n;}
function make(routes,hash){
 const calls=[],writes=[],toasts=[],h={};
 const rootN=node({'data-growth':''});
 const c={console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,setTimeout,clearTimeout,Intl,location:{hash},calls,writes,toasts,rootN,h,
  addEventListener(){},removeEventListener(){},dispatchEvent(){return true},CustomEvent:function(){},Event:function(){}};
 c.document={querySelector:s=>s==='[data-growth]'?rootN:null,querySelectorAll:()=>[],getElementById:()=>null,addEventListener(k,f){h[k]=f},removeEventListener(){},activeElement:null,body:node()};
 c.CommonsAPI={mode:'live',newIdempotencyKey:()=>'K1',
  get(p){calls.push(['GET',p]);const r=routes.get[p];if(r instanceof Error)return Promise.reject(r);return r===undefined?Promise.reject(Object.assign(Error('nf '+p),{status:404})):Promise.resolve({data:JSON.parse(JSON.stringify(r)),meta:{}});},
  post(p,b,o){calls.push(['POST',p,b,o&&o.idempotencyKey]);const r=routes.post[p];if(r instanceof Error)return Promise.reject(r);return Promise.resolve({data:typeof r==='function'?r(b):(r||{}),meta:{}});}};
 c.Commons={esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),safeUrl:u=>String(u||''),icon:()=>'',toast:m=>toasts.push(m),write:(k,v)=>{writes.push([k,v]);return true},read:(k,d)=>d,modal(){},closeModal(){}};
 c.window=c;c.self=c;vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;
}
const click=(c,attrs)=>{const ds={};for(const k in attrs)ds[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=attrs[k];const t={dataset:ds,closest:()=>t,getAttribute:k=>attrs[k]??null};c.h.click({target:t});};
const me=()=>({level:2,optedOut:false,consentMetering:false,season:{name:'S1',startsAt:'2026-10-01',endsAt:'2026-12-31'},points:3});
(async()=>{
 const mk=(post)=>{const c=make({get:{'/growth/me':me(),'/growth/board':{contribution:[]},'/growth/tokens':[]},post},'#/leaderboard');c.CommonsGrowth.mount();return c;};
 let c=mk({'/growth/optout':{optedOut:true}});await tick();
 const posts=()=>c.calls.filter(x=>x[0]==='POST');
 click(c,{'data-grow-act':'optout'});
 assert.deepEqual(posts(),[['POST','/growth/optout',{optout:true},'K1']]);
 assert(!c.toasts.length,'no toast before the server confirms');
 await tick();assert(c.toasts[0].includes('已退出赛季榜'));assert.equal(c.writes.length,0,'no shared Commons.write');
 // failure keeps old setting and says so
 c=mk({'/growth/optout':Object.assign(Error('稍后再试'),{status:500})});await tick();
 click(c,{'data-grow-act':'optout'});await tick();
 assert(!c.toasts.some(t=>t.includes('已退出')));assert.equal(c.writes.length,0);
 // 501
 c=mk({'/growth/optout':Object.assign(Error('x'),{status:501,code:'capability_unavailable'})});await tick();
 click(c,{'data-grow-act':'optout'});await tick();assert(c.toasts.some(t=>t.includes('这个功能还没开放')),JSON.stringify(c.toasts));
 // public ranking switch has no endpoint: no request, no write
 c=mk({});await tick();click(c,{'data-grow-act':'public'});await tick();
 assert.equal(posts().length,0);assert.equal(c.writes.length,0);
 const form=()=>{const f={closest:()=>f,elements:{namedItem:n=>({value:n==='family'?'claude':'1m-10m'})},querySelector:()=>null};return f;};
 c=mk({'/growth/tokens/report':{}});await tick();
 c.h.submit({target:form(),preventDefault(){}});
 assert.deepEqual(c.calls.filter(x=>x[0]==='POST'),[['POST','/growth/tokens/report',{family:'claude',band:'1m-10m',trust:'self'},'K1']]);
 assert(!c.toasts.length);await tick();assert(c.toasts.some(t=>t.includes('已记为自报')));assert.equal(c.writes.length,0);
 assert.equal(c.calls.filter(x=>x[1]==='/growth/me').length,2,'re-read after report');
 c=mk({'/growth/tokens/report':Object.assign(Error('频率太高'),{status:429})});await tick();
 c.h.submit({target:form(),preventDefault(){}});await tick();assert(c.toasts.includes('频率太高')&&!c.toasts.some(t=>t.includes('已记为自报')));
 console.log('GROWTH_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

BUSINESS = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const file=process.argv[1]+'/'+process.argv[2];
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function make(post,hash='#/teams'){
 const calls=[],writes=[],toasts=[],h={};
 const root={innerHTML:'',getAttribute:()=>'teams',contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(k,f)=>h[k]=f,removeEventListener(){}};
 const c={console,Promise,Date,Math,Number,String,Array,Object,JSON,Boolean,Map,Set,setTimeout,clearTimeout,Intl,calls,writes,toasts,h,root,
  document:{activeElement:null,querySelector:s=>s==='[data-biz-root]'?root:null,querySelectorAll:()=>[]},location:{hash},
  Commons:{esc:v=>String(v??''),safeUrl:v=>v,icon:()=>'',read:(k,v)=>v,write:(k,v)=>{writes.push([k,v]);return true},toast:m=>toasts.push(m)},
  CommonsAPI:{mode:'live',newIdempotencyKey:()=>'K1',
   get:p=>Promise.resolve({data:p==='/billing/plans'?{plans:[{key:'team',id:'team',name:'团队版',price:{month:30,year:300}}],benefits:[]}:{waitlist:[],orders:[],subscription:null}}),
   post:(p,b,o)=>{calls.push([p,b,o&&o.idempotencyKey]);const r=post[p];if(r instanceof Error)return Promise.reject(r);return Promise.resolve({data:r})}}};
 Object.defineProperty(c,'COMMONS_BUSINESS_SAMPLE',{get(){throw Error('LIVE_READ_SAMPLE')}});c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;
}
const click=(c,act)=>{const b={tagName:'BUTTON',getAttribute:k=>k==='data-biz-act'?act:null,dataset:{bizAct:act}};c.h.click({target:{closest:()=>b},preventDefault(){}});};
(async()=>{
 let c=make({'/billing/waitlist':{entry:{plan:'team',seats:5,cycle:'month'},duplicate:false}});
 c.CommonsBusiness.mount();await tick();
 assert(c.root.innerHTML.includes('data-biz-act="team-join"'),'live team page offers waitlist');
 click(c,'team-join');
 assert.equal(c.calls.length,1);assert.equal(c.calls[0][0],'/billing/waitlist');assert.equal(c.calls[0][1].plan,'team');assert.equal(c.calls[0][1].source,'teams');assert.equal(c.calls[0][2],'K1');
 assert(!c.toasts.length);await tick();assert(c.toasts[0].includes('候补名单'));assert.equal(c.writes.length,0,'nothing shared goes to Commons.write');
 assert(c.root.innerHTML.includes('已加入团队版候补名单'));
 c=make({'/billing/waitlist':Object.assign(Error('请先登录'),{status:401})});c.CommonsBusiness.mount();await tick();
 click(c,'team-join');await tick();assert(c.toasts.includes('请先登录'));assert(!c.root.innerHTML.includes('已加入团队版候补名单'));assert.equal(c.writes.length,0);
 c=make({'/billing/waitlist':Object.assign(Error('x'),{status:501,code:'capability_unavailable'})});c.CommonsBusiness.mount();await tick();
 click(c,'team-join');await tick();assert(c.toasts.includes('这个功能还没开放'));
 // sponsor / creator application forms are not drawn in live (no endpoint)
 c=make({},'#/sponsor');c.CommonsBusiness.mount();await tick();
 assert(!/<form/.test(c.CommonsBusiness.routes.sponsor()),'no sponsor form in live');assert(!c.root.innerHTML.includes('只存本机'));
 console.log('BUSINESS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

GAMES = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const file=process.argv[1]+'/'+process.argv[2];
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function make(post){
 const calls=[],writes=[],toasts=[],h={},events=[];
 const small={textContent:'已显示'};
 const root={dataset:{gamesView:'home'},addEventListener(k,f){h[k]=f},removeEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],contains:()=>true};
 const c={console,Promise,Date,Math,Number,String,Array,Object,JSON,Boolean,Map,Set,setTimeout,clearTimeout,AbortController,Intl,RegExp,calls,writes,toasts,h,events,small,
  requestAnimationFrame:()=>1,cancelAnimationFrame(){},CustomEvent:function(n,o){this.type=n;this.detail=o&&o.detail},dispatchEvent(e){events.push(e.detail);return true},
  document:{querySelector:s=>s==='[data-games-root]'?root:null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},activeElement:null},location:{hash:'#/games'},
  Commons:{esc:v=>String(v??''),safeUrl:v=>v,icon:()=>'',read:(k,d)=>d,write:(k,v)=>{writes.push([k,v]);return true},toast:m=>toasts.push(m)},
  CommonsAPI:{mode:'live',newIdempotencyKey:()=>'K1',get:p=>Promise.reject(Object.assign(Error('nf'),{status:404})),
   post:(p,b,o)=>{calls.push([p,b,o&&o.idempotencyKey]);const r=post[p];if(r instanceof Error)return Promise.reject(r);return Promise.resolve({data:r||{}})}}};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;
}
const input=(c,checked)=>{const i={checked,disabled:false,matches:s=>s==='[data-games-toggle]',closest:()=>({querySelector:()=>c.small})};return i;};
(async()=>{
 let c=make({'/games/preferences':{}});c.CommonsGames.mount();await tick();
 let i=input(c,false);c.h.change({target:i});
 assert.deepEqual(c.calls.filter(x=>x[0]==='/games/preferences'),[['/games/preferences',{playground_enabled:false},'K1']]);
 assert.equal(c.writes.length,0,'local cache not written before the server confirms');assert.equal(c.events.length,0);assert.equal(i.disabled,true,'switch disabled during the request');
 await tick();assert.equal(c.writes.length,1);assert.equal(c.small.textContent,'已隐藏');assert.equal(i.disabled,false);
 c=make({'/games/preferences':Object.assign(Error('保存失败'),{status:500})});c.CommonsGames.mount();await tick();
 i=input(c,false);c.h.change({target:i});await tick();
 assert.equal(i.checked,true,'switch rolled back');assert.equal(c.writes.length,0);assert.equal(c.events.length,0);assert(c.toasts.includes('保存失败'));
 c=make({'/games/preferences':Object.assign(Error('x'),{status:501,code:'capability_unavailable'})});c.CommonsGames.mount();await tick();
 i=input(c,false);c.h.change({target:i});await tick();assert(c.toasts.includes('这个功能还没开放'));assert.equal(i.checked,true);
 console.log('GAMES_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

CALENDAR = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1],rel=process.argv[2];
const read=f=>fs.readFileSync(root+'/preview/'+f,'utf8');
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function make(mode,events){
 const calls=[];
 const rootN={innerHTML:'',getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},contains:()=>true,focus(){},appendChild(){},setAttribute(){},removeAttribute(){},classList:{add(){},remove(){},toggle(){}}};
 const c={console,Promise,Date,Math,Number,String,Array,Object,JSON,Boolean,Map,Set,setTimeout,clearTimeout,Intl,RegExp,URL,URLSearchParams,calls,rootN,
  innerWidth:1440,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),addEventListener(){},removeEventListener(){},
  document:{activeElement:null,querySelector:s=>s==='[data-calendar-root]'?rootN:null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},getElementById:()=>null,createElement:()=>({innerHTML:'',setAttribute(){},appendChild(){},remove(){},addEventListener(){},querySelector:()=>null,classList:{add(){},remove(){},toggle(){}},style:{}}),body:{appendChild(){},classList:{add(){},remove(){},toggle(){}}}},
  location:{hash:'#/calendar',protocol:'https:'},
  Commons:{esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),safeUrl:v=>String(v||''),icon:()=>'',read:(k,d)=>d,write:()=>true,toast(){}},
  CommonsAPI:{mode,get:p=>{calls.push(p);return Promise.resolve({data:{events,types:[]}})}}};
 c.window=c;vm.createContext(c);
 if(mode!=='live')vm.runInContext(read('calendar-sample.js'),c);
 vm.runInContext(fs.readFileSync(root+'/'+rel,'utf8'),c);return c;
}
(async()=>{
 const ev=[{id:'e1',type:'room',title:'真实活动',summary:'说明',start:'2099-01-05T10:00:00Z',end:'2099-01-05T11:00:00Z',place:'房间'}];
 const live=make('live',ev);live.CommonsCalendar.mount();await tick();
 let html=live.CommonsCalendar.routes.calendar();
 assert(html.includes('真实活动')||html.includes('cal-head'),'live calendar renders');
 assert(!html.includes('示例'),'no 示例 label in live: '+(html.match(/.{20}示例.{10}/)||[''])[0]);
 assert(!html.includes('cal-kicker'),'no kicker in live');
 const demo=make('demo');demo.CommonsCalendar.mount();await tick();
 html=demo.CommonsCalendar.routes.calendar();
 assert(html.includes('<span class="cal-kicker">示例</span>'),'demo keeps its 示例 label');
 console.log('CALENDAR_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

APP_SIGNAL = r'''
(async()=>{
 const run=async(demo,original)=>{
  const x=setup(demo,original),{c,nodes,stored}=x;c.CommonsMotion.reveal=()=>{};if(!demo)await asMember(x);
  c.location.hash='#/sources';c.Commons.refresh();const html=nodes['#main'].innerHTML;
  const el={dataset:{action:'signal-save',id:'W'},getAttribute:()=>null,closest:()=>null,focus(){},setAttribute(){},removeAttribute(){},classList:{add(){},remove(){},toggle(){}}};
  const target={closest:s=>s==='[data-action]'?el:null,getAttribute:()=>null};
  let prevented=false;
  for(const f of [...(c.document.events.click||[])])f({target,preventDefault(){prevented=true},stopPropagation(){}});
  await tick();
  return {html,stored,toast:nodes['#toast'].innerHTML+nodes['#toast'].textContent};
 };
 const live=await run(false,false);
 // R17-H2：保存阅读入口已接真接口（见 test_r17h2_frontend）；这里只守住「被权限挡住时不假装成功」
 assert(!live.html.includes('这个功能还没开放'),'live sources page no longer says it is not open');
 assert(!live.html.includes('data-action="signal-save"'),'a member without social.signal gets no live save button');
 assert(live.html.includes('disabled title="现在还不能保存"'),'blocked button is greyed out with a reason');
 assert(!Object.keys(live.stored).some(k=>k.includes('signals')),'nothing written locally: '+Object.keys(live.stored));
 assert(!live.toast.includes('已'),'no success toast: '+live.toast);
 const demo=await run(true,false);
 assert(demo.html.includes('data-action="signal-save" data-id="W">保存阅读入口</button>'),'demo button unchanged');
 assert(!demo.html.includes('这个功能还没开放'));
 console.log('APP_SIGNAL_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''



def node(script, *args, common=''):
    return subprocess.run(['node', '-e', common + script, str(ROOT), *args], capture_output=True, text=True)


class LG6CR10Writes(unittest.TestCase):
    def passes(self, script, marker, rel, common=''):
        result = node(script, rel, common=common)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn(marker, result.stdout)

    def fails_before(self, script, rel, common=''):
        result = node(script, rel, common=common)
        self.assertNotEqual(result.returncode, 0, 'the pre-change file must fail this test')

    def test_events_signup_submit_vote_post_first(self):
        self.passes(EVENTS, 'EVENTS_PASS', 'preview/events.js')

    def test_events_pre_change_fails(self):
        self.fails_before(EVENTS, BEFORE + 'before-events.js')

    def test_farm_actions_post_then_reread(self):
        self.passes(FARM, 'FARM_PASS', 'preview/farm.js')

    def test_farm_pre_change_fails(self):
        self.fails_before(FARM, BEFORE + 'before-farm.js')

    def test_growth_optout_and_token_report(self):
        self.passes(GROWTH, 'GROWTH_PASS', 'preview/growth.js')

    def test_growth_pre_change_fails(self):
        self.fails_before(GROWTH, BEFORE + 'before-growth.js')

    def test_business_team_waitlist_and_no_local_forms(self):
        self.passes(BUSINESS, 'BUSINESS_PASS', 'preview/business.js')

    def test_business_pre_change_fails(self):
        self.fails_before(BUSINESS, BEFORE + 'before-business.js')

    def test_games_playground_toggle_posts_first_and_rolls_back(self):
        self.passes(GAMES, 'GAMES_PASS', 'preview/games.js')

    def test_games_pre_change_fails(self):
        self.fails_before(GAMES, BEFORE + 'before-games.js')

    def test_calendar_live_has_no_sample_label_demo_keeps_it(self):
        self.passes(CALENDAR, 'CALENDAR_PASS', 'preview/calendar.js')

    def test_calendar_pre_change_fails(self):
        self.fails_before(CALENDAR, BEFORE + 'before-calendar.js')

    def test_sources_signal_save_not_faked_in_live_demo_unchanged(self):
        self.passes(APP_SIGNAL, 'APP_SIGNAL_PASS', '', common=APP_COMMON)

    def test_sources_signal_save_pre_change_fails(self):
        common = APP_COMMON.replace('LG-6C/before-app.js', 'LG-6C/r10/before-app.js')
        script = APP_SIGNAL.replace('run(false,false)', 'run(false,true)').replace('run(true,false)', 'run(true,true)')
        self.fails_before(script, '', common=common)


if __name__ == '__main__':
    unittest.main()
