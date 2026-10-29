"""LG-8A R13 · 成员主页 / 作品页 / 我的权益 / 团队 / AI 工具提交：真实模式写路径。

离线 VM：mock CommonsAPI，断言 method + path + body + 幂等键，断言没有写 Commons.write。
同一批场景可以指向改前代码（docs/evidence/LG-8A/before/，来自 delivery-live-r13 的改前构建）反跑，必须失败。
"""
from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BEFORE = ROOT / 'docs' / 'evidence' / 'LG-8A' / 'before'

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1], beforeDir=process.argv[2]||'';
const source=name=>fs.readFileSync(beforeDir?beforeDir+'/'+name+'.js':root+'/preview/'+name+'.js','utf8');
const tick=async(n=40)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){[...(events[type]||[])].forEach(f=>f(ev))}}}
class FakeFormData{constructor(f){this.v=f.values||{}}entries(){return Object.entries(this.v)[Symbol.iterator]()}get(k){return this.v[k]}}
function context(o){
  const calls=[],writes=[],toasts=[],routes={},dm=[],renders=[];
  const rootNode={innerHTML:'',nodeType:1,dataset:{},setAttribute(){},closest(){return null},
    querySelector:s=>/data-people-html/.test(s)?{innerHTML:''}:null,querySelectorAll:()=>[],contains(){return true}};
  const c=Object.assign(eventTarget(),{
    console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,Error,
    setTimeout,clearTimeout,FormData:FakeFormData,
    location:{protocol:'https:',hash:o.hash,replace(){},assign(){}},
    matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
    calls,writes,toasts,dm,renders,rootNode,routes,page:''
  });
  c.document=Object.assign(eventTarget(),{
    activeElement:null,getElementById:()=>null,
    querySelector:s=>s.includes(o.rootSel)?rootNode:null,querySelectorAll:()=>[],
    body:{classList:{add(){},remove(){},toggle(){}}}
  });
  let depth=0;
  c.Commons={
    read:(k,fb)=>fb,write:(k,v)=>{writes.push({k,v});return true;},
    toast:m=>toasts.push(m),
    refresh(){ if(++depth>40){depth=0;throw new Error('render loop');} try{c.rerender&&c.rerender();}finally{depth--;} },
    go(r){c.location.hash='#/'+r;},icon:()=>'',esc:s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])),
    safeUrl:s=>/^(#\/|assets\/|https?:\/\/)/.test(String(s||''))?String(s):'#'
  };
  const answer=(method,path,body,opts)=>{
    calls.push({method,path,query:method==='GET'?(body||null):null,body:method==='GET'?null:(body||{}),opts:opts||{}});
    const key=method+' '+path;
    const r=key in routes?routes[key]:undefined;
    if(r===undefined){
      if(method==='GET')return Promise.reject(Object.assign(new Error('没有 '+path),{status:404}));
      return Promise.resolve({data:{},meta:{}});
    }
    const v=typeof r==='function'?r(body,opts):r;
    if(v instanceof Error)return Promise.reject(v);
    return Promise.resolve(v);
  };
  c.CommonsAPI={
    mode:'live',
    get:(p,q,opts)=>answer('GET',p,q,opts),
    post:(p,b,opts)=>answer('POST',p,b,opts),
    patch:(p,b,opts)=>answer('PATCH',p,b,opts),
    put:(p,b,opts)=>answer('PUT',p,b,opts),
    del:(p,b,opts)=>answer('DELETE',p,b,opts),
    newIdempotencyKey:()=>'idem-'+(calls.length+1)
  };
  c.COMMONS_BUILD={mode:'live'};
  c.CommonsSession={state:'member',me:o.me||{id:'me-1',handle:'me',display_name:'我',level:2}};
  c.CommonsDM={open(x){dm.push(x);return Promise.resolve({id:'t1'});}};
  c.CommonsHTML={render(host,opt){renders.push(opt);return {destroy(){},setDevice(){}};},thumbnail:()=>Promise.reject(new Error('no'))};
  c.window=c;c.self=c;
  vm.createContext(c);
  return c;
}
function btn(selector,dataset,extra){
  return Object.assign({dataset,disabled:false,setAttribute(){},closest(s){return s===selector?this:null}},extra||{});
}
const click=(c,btnObj)=>c.document.dispatchEvent('click',{target:btnObj,preventDefault(){}});
const find=(c,method,path)=>c.calls.filter(x=>x.method===method&&x.path===path);
'''

PROFILE = r'''
function aliceRoutes(c,state){
  c.routes['GET /social/profiles']={data:{items:[{id:'p1',handle:'alice',display_name:'爱丽丝',level:3,avatar:null},{id:'p2',handle:'bob',display_name:'鲍勃',level:1,avatar:null}]},meta:{cursor:null}};
  c.routes['GET /social/profiles/alice']={data:{id:'p1',handle:'alice',display_name:'爱丽丝',level:3,avatar:null},meta:{}};
  c.routes['GET /social/people/alice']=()=>({data:{person:{id:'p1'},self:!!state.self,
    relation:state.self?null:{following:state.following,followed_by:true,friends:false,starred:false,muted:false,blocked:state.blocked,poked_today:false},
    counts:{following:2,followers:state.following?6:5,friends:1},mutual_friends:1},meta:{}});
  c.routes['GET /objects']={data:[{id:'w1',type:'work',title:'我的第一个作品',excerpt:'摘要文字',created_at:'2026-01-01T00:00:00.000Z'}],meta:{next_cursor:null}};
  c.routes['GET /social/walls/alice']={data:{items:[{id:'s1',body:'动态正文在这里',scope:'members',created_at:'2026-01-02T00:00:00.000Z',comments:2,shares:1,images:[],status:'ok'}]},meta:{cursor:'next'}};
}
function start(c){
  vm.runInContext(source('people'),c);
  const P=c.CommonsPeople;
  c.rerender=()=>{c.page=P.routes.u();P.mount();};
  c.rerender();
}
'''

PROFILE_READ = PROFILE + r'''
(async()=>{
 const state={following:false,blocked:false};
 const c=context({hash:'#/u/alice',rootSel:'data-people-root'});
 aliceRoutes(c,state);
 start(c);
 await tick();
 assert.ok(c.page.includes('爱丽丝'),'name');
 assert.ok(c.page.includes('data-people-act="follow"'),'follow button');
 assert.ok(c.page.includes('data-people-act="dm"'),'dm button');
 assert.ok(c.page.includes('我的第一个作品'),'works from /objects');
 assert.ok(c.page.includes('动态正文在这里'),'wall post');
 assert.ok(c.page.includes('更多动态'),'wall cursor');
 assert.ok(c.page.includes('TA 关注了你'),'relation line');
 assert.ok(c.page.includes('被关注'),'counts');
 assert.ok(!c.page.includes('暂无公开作品资料'),'old skeleton gone');
 const objs=find(c,'GET','/objects')[0];
 assert.deepEqual({type:objs.query.type,author_id:objs.query.author_id},{type:'work',author_id:'p1'});
 assert.ok(find(c,'GET','/social/walls/alice').length>=1,'wall request');
 assert.equal(c.writes.length,0,'no Commons.write');
 console.log('PROFILE_READ_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

PROFILE_FOLLOW = PROFILE + r'''
(async()=>{
 const state={following:false,blocked:false};
 const c=context({hash:'#/u/alice',rootSel:'data-people-root'});
 aliceRoutes(c,state);
 c.routes['PUT /social/follows/alice']=()=>{state.following=true;return {data:{}};};
 c.routes['DELETE /social/follows/alice']=()=>{state.following=false;return {data:{}};};
 start(c);
 await tick();
 click(c,btn('[data-people-act]',{peopleAct:'follow',handle:'alice'}));
 await tick();
 const put=find(c,'PUT','/social/follows/alice');
 assert.equal(put.length,1,'PUT follow');
 assert.ok(put[0].opts.idempotencyKey,'idempotency key');
 assert.ok(c.page.includes('已关注'),'now followed');
 click(c,btn('[data-people-act]',{peopleAct:'follow',handle:'alice'}));
 await tick();
 assert.equal(find(c,'DELETE','/social/follows/alice').length,1,'DELETE follow');
 assert.ok(!c.page.includes('已关注<'),'unfollowed');
 assert.equal(c.writes.length,0,'no Commons.write');
 console.log('FOLLOW_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

PROFILE_FAIL = PROFILE + r'''
(async()=>{
 const state={following:false,blocked:false};
 const c=context({hash:'#/u/alice',rootSel:'data-people-root'});
 aliceRoutes(c,state);
 c.routes['PUT /social/follows/alice']=Object.assign(new Error('服务器说：今天关注太多了'),{status:429});
 start(c);
 await tick();
 click(c,btn('[data-people-act]',{peopleAct:'follow',handle:'alice'}));
 await tick();
 assert.ok(c.page.includes('今天关注太多了'),'server message shown');
 assert.ok(c.page.includes('aria-pressed="false"'),'state not flipped');
 c.routes['PUT /social/follows/alice']=Object.assign(new Error('x'),{status:501,code:'capability_unavailable'});
 click(c,btn('[data-people-act]',{peopleAct:'follow',handle:'alice'}));
 await tick();
 assert.ok(c.page.includes('这个功能还没开放'),'501 neutral');
 console.log('FAIL_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

PROFILE_DM_MORE = PROFILE + r'''
(async()=>{
 const state={following:true,blocked:false};
 const c=context({hash:'#/u/alice',rootSel:'data-people-root'});
 aliceRoutes(c,state);
 c.routes['PUT /social/blocks/alice']=()=>{state.blocked=true;state.following=false;return {data:{}};};
 start(c);
 await tick();
 click(c,btn('[data-people-act]',{peopleAct:'dm',handle:'alice'}));
 await tick();
 assert.deepEqual(c.dm,[{with:'p1'}],'dm opens with member id');
 assert.ok(c.page.includes('data-people-act="star"') && c.page.includes('data-people-act="mute"') && c.page.includes('data-people-act="poke"'),'more menu');
 click(c,btn('[data-people-act]',{peopleAct:'block',handle:'alice'}));
 await tick();
 assert.equal(find(c,'PUT','/social/blocks/alice').length,0,'first click only asks');
 assert.ok(c.page.includes('确认拉黑'),'confirm label');
 click(c,btn('[data-people-act]',{peopleAct:'block',handle:'alice'}));
 await tick();
 const blocks=find(c,'PUT','/social/blocks/alice');
 assert.equal(blocks.length,1,'second click blocks');
 assert.ok(blocks[0].opts.idempotencyKey);
 assert.ok(c.page.includes('解除拉黑'),'unblock shown after block');
 assert.ok(!c.page.includes('data-people-act="dm"'),'no dm when blocked');
 console.log('DM_MORE_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

PROFILE_SELF = PROFILE + r'''
(async()=>{
 const state={following:false,blocked:false,self:true};
 const c=context({hash:'#/u/alice',rootSel:'data-people-root',me:{id:'p1',handle:'alice',display_name:'爱丽丝',level:3}});
 aliceRoutes(c,state);
 start(c);
 await tick();
 assert.ok(!c.page.includes('data-people-act="follow"'),'no follow on own page');
 assert.ok(!c.page.includes('data-people-act="dm"'),'no dm on own page');
 assert.ok(c.page.includes('编辑资料'),'edit link');
 console.log('SELF_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

WORK = r'''
function startWork(c){
  vm.runInContext(source('people'),c);
  const P=c.CommonsPeople;
  c.rerender=()=>{c.page=P.routes.work();P.mount();};
  c.rerender();
}
(async()=>{
 let saved=false;
 const c=context({hash:'#/work/w1',rootSel:'data-people-root'});
 c.routes['GET /content/objects/w1']=()=>({data:{id:'w1',type:'work',title:'一个 HTML 作品',visibility:'members',min_level:1,created_at:'2026-01-01T00:00:00.000Z',
   author:{id:'p1',display_name:'爱丽丝',level:3,avatar:null},content:{summary:'一句话',body:'作品正文第一行',tags:['agent'],html_asset:'a1'},
   assets:{a1:{id:'a1',content_url:'https://content.example/a1'}},stats:{saves:2,useful:1,replies:3,reactions:{}},mine:{saved,useful:false}},meta:{}});
 c.routes['PUT /content/objects/w1/save']=()=>{saved=true;return {data:{}};};
 c.routes['DELETE /content/objects/w1/save']=()=>{saved=false;return {data:{}};};
 c.routes['POST /content/objects/w1/useful']={data:{useful:2,marked:true},meta:{}};
 startWork(c);
 await tick();
 assert.ok(c.page.includes('一个 HTML 作品'),'title');
 assert.ok(c.page.includes('作品正文第一行'),'body');
 assert.ok(c.page.includes('登录成员可见'),'visibility');
 assert.ok(c.page.includes('3 条回复'),'reply count');
 assert.ok(!c.page.includes('没有找到这个作品'),'not the skeleton');
 assert.equal(c.renders.length,1,'html preview mounted');
 assert.equal(c.renders[0].assetId,'a1');
 assert.equal(c.renders[0].contentUrl,'https://content.example/a1');
 click(c,btn('[data-people-act]',{peopleAct:'save',id:'w1'}));
 await tick();
 const put=find(c,'PUT','/content/objects/w1/save');
 assert.equal(put.length,1,'save');
 assert.ok(put[0].opts.idempotencyKey);
 assert.ok(c.page.includes('已收藏'),'saved label');
 click(c,btn('[data-people-act]',{peopleAct:'save',id:'w1'}));
 await tick();
 assert.equal(find(c,'DELETE','/content/objects/w1/save').length,1,'unsave');
 click(c,btn('[data-people-act]',{peopleAct:'useful',id:'w1'}));
 await tick();
 assert.equal(find(c,'POST','/content/objects/w1/useful').length,1,'useful');
 assert.ok(c.page.includes('已标有用'),'useful label');
 assert.equal(c.writes.length,0,'no Commons.write');
 // 找不到才写没有找到
 const d=context({hash:'#/work/nope',rootSel:'data-people-root'});
 startWork(d);
 await tick();
 assert.ok(d.page.includes('没有找到这个作品'),'404 copy');
 console.log('WORK_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

BENEFITS = r'''
(async()=>{
 const c=context({hash:'#/benefits',rootSel:'data-people-root'});
 c.routes['GET /membership/me']={data:{level:2,levelName:'队员',note:'用量按各权益分别计算。',benefits:[
   {key:'post',name:'每月发布',description:'发布作品',minLevel:1,available:true,quota:5,unit:'次',period:'month',periodLabel:'2026-10 月',used:3,remaining:2},
   {key:'room',name:'开房间',minLevel:3,available:false,quota:0,unit:'次',period:'month',periodLabel:'2026-10 月',used:0,remaining:0}]},meta:{}};
 c.routes['GET /membership/benefits']={data:{level:3,levelName:'骨干',benefits:[{key:'post',name:'每月发布',available:true,quota:10,unit:'次',minLevel:1}]},meta:{}};
 vm.runInContext(source('people'),c);
 const P=c.CommonsPeople;
 c.rerender=()=>{c.page=P.routes.benefits();P.mount();};
 c.rerender();
 await tick();
 assert.ok(c.page.includes('每月发布') && c.page.includes('3 / 5'),'usage row');
 assert.ok(c.page.includes('L3 起可用'),'locked row');
 assert.ok(c.page.includes('升到 L3'),'next level delta');
 assert.ok(!c.page.includes('暂无权益资料'),'old skeleton gone');
 const next=find(c,'GET','/membership/benefits')[0];
 assert.equal(next.query.level,3);
 const d=context({hash:'#/benefits',rootSel:'data-people-root'});
 d.routes['GET /membership/me']=Object.assign(new Error('off'),{status:501,code:'capability_unavailable'});
 vm.runInContext(source('people'),d);
 d.rerender=()=>{d.page=d.CommonsPeople.routes.benefits();d.CommonsPeople.mount();};
 d.rerender();
 await tick();
 assert.ok(d.page.includes('这个功能还没开放'),'501 neutral');
 assert.ok(!d.page.includes('重试'),'no retry on closed');
 console.log('BENEFITS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

ORGS_COMMON = r'''
function startOrgs(c,route){
  vm.runInContext(source('orgs'),c);
  const O=c.CommonsOrgs;
  c.rerender=()=>{c.page=O.routes[route]();O.mount();};
  c.rerender();
}
const teamRaw=(me,extra)=>Object.assign({id:'o1',slug:'team-a',name:'甲队',intro:'一起做事',type:'lab',typeLabel:'实验室',website:'https://a.example',banner:'',
  verified:false,joinPolicy:'apply',members:2,followers:3,activity:1,followed:false,me,
  membersList:[{id:'me-1',handle:'me',name:'我',level:2,role:'owner'},{id:'p2',handle:'bob',name:'鲍勃',level:1,role:'member'}],
  posts:[{id:'op1',title:'第一条团队动态',body:'正文',summary:'摘要',createdAt:'2026-01-01T00:00:00.000Z',author:{name:'我'}}],works:[],jobs:[],events:[]},extra||{});
const formObj=(sel,dataset,values)=>{const status={textContent:''},submit={disabled:false};return {values,dataset,status,submit,matches:s=>s===sel,closest:()=>null,
  querySelector:s=>s==='[data-org-form-status]'?status:(s==='[type="submit"]'?submit:null)};};
const submit=(c,form)=>c.document.dispatchEvent('submit',{target:form,preventDefault(){}});
'''

ORGS_DIR = ORGS_COMMON + r'''
(async()=>{
 const c=context({hash:'#/orgs',rootSel:'data-org-root'});
 c.routes['GET /orgs']={data:[teamRaw({state:'none',role:null})],meta:{types:[{id:'lab',label:'实验室'},{id:'company',label:'公司'}]}};
 startOrgs(c,'orgs');
 await tick();
 assert.ok(c.page.includes('甲队'),'org listed');
 assert.ok(c.page.includes('<option value="company">公司</option>'),'type options come from meta.types');
 assert.ok(!c.page.includes('示例'),'no sample chip');
 const form=formObj('[data-org-create-form]',{},{name:'乙队',intro:'新团队',type:'company',join_policy:'invite',website:''});
 form.closest=s=>s==='dialog'?{close(){}}:null;
 submit(c,form);
 await tick();
 const post=find(c,'POST','/orgs');
 assert.equal(post.length,1,'create team');
 assert.deepEqual(post[0].body,{name:'乙队',intro:'新团队',type:'company',website:'',join_policy:'invite'});
 assert.ok(post[0].opts.idempotencyKey);
 assert.ok(c.toasts.some(t=>t.includes('审核')),'honest toast');
 assert.ok(!c.location.hash.includes('org/'),'does not jump to a team that is not public yet');
 assert.equal(c.writes.length,0);
 console.log('ORGS_DIR_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

ORGS_DETAIL = ORGS_COMMON + r'''
(async()=>{
 const c=context({hash:'#/org/team-a',rootSel:'data-org-root'});
 let detail=teamRaw({state:'active',role:'owner'});
 c.routes['GET /orgs/team-a']=()=>({data:detail,meta:{}});
 c.routes['GET /objects']={data:[{id:'w1',type:'work',title:'我的作品一'},{id:'w2',type:'work',title:'我的作品二'}],meta:{}};
 c.routes['POST /orgs/team-a/follow']=(b)=>({data:{followed:b.on,followers:4}});
 startOrgs(c,'org');
 await tick();
 assert.ok(c.page.includes('甲队') && c.page.includes('第一条团队动态'),'detail loaded from GET /orgs/{slug}');
 assert.equal(find(c,'GET','/orgs/team-a').length,1,'one detail read, no loop');
 assert.ok(c.page.includes('data-org-post-form="team-a"'),'member can post');
 // 发团队动态
 const pf=formObj('[data-org-post-form]',{orgPostForm:'team-a'},{title:'新动态',body:'今天做了什么'});
 submit(c,pf);
 await tick();
 const post=find(c,'POST','/orgs/team-a/posts');
 assert.equal(post.length,1);
 assert.deepEqual(post[0].body,{title:'新动态',body:'今天做了什么'});
 assert.ok(post[0].opts.idempotencyKey);
 assert.ok(find(c,'GET','/orgs/team-a').length>=2,'re-read after post');
 // 改角色（所有者）
 click(c,btn('[data-org-act]',{orgAct:'tab',value:'members'}));
 await tick();
 assert.ok(c.page.includes('data-org-role-form="team-a"'),'owner sees role form');
 assert.ok(!c.page.includes('data-member="me-1"'),'no role form for self');
 const rf=formObj('[data-org-role-form]',{orgRoleForm:'team-a',member:'p2'},{role:'admin'});
 submit(c,rf);
 await tick();
 const role=find(c,'POST','/orgs/team-a/members/p2/role');
 assert.equal(role.length,1);
 assert.deepEqual(role[0].body,{role:'admin',state:'active'});
 // 挂作品
 click(c,btn('[data-org-act]',{orgAct:'tab',value:'works'}));
 await tick();
 assert.ok(find(c,'GET','/objects').length>=1,'loads my works');
 assert.deepEqual({type:find(c,'GET','/objects')[0].query.type,author:find(c,'GET','/objects')[0].query.author_id},{type:'work',author:'me-1'});
 assert.ok(c.page.includes('data-org-work-form="team-a"') && c.page.includes('我的作品二'),'attach form');
 const wf=formObj('[data-org-work-form]',{orgWorkForm:'team-a'},{object_id:'w2'});
 submit(c,wf);
 await tick();
 assert.equal(find(c,'POST','/orgs/team-a/works/w2').length,1,'attach work');
 // 关注
 const fb=btn('[data-org-act]',{orgAct:'follow',value:'team-a'});
 click(c,fb);
 await tick();
 const fol=find(c,'POST','/orgs/team-a/follow');
 assert.deepEqual(fol[0].body,{on:true});
 assert.ok(c.page.includes('已关注'));
 assert.equal(c.writes.length,0,'no Commons.write');
 console.log('ORGS_DETAIL_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

ORGS_GUEST = ORGS_COMMON + r'''
(async()=>{
 const c=context({hash:'#/org/team-a',rootSel:'data-org-root'});
 c.routes['GET /orgs/team-a']={data:teamRaw({state:'none',role:null}),meta:{}};
 c.routes['POST /orgs/team-a/join']={data:{state:'pending',role:null,showOnProfile:true}};
 startOrgs(c,'org');
 await tick();
 assert.ok(!c.page.includes('data-org-post-form'),'non-member cannot post');
 assert.ok(!c.page.includes('data-org-role-form'),'non-member cannot change roles');
 click(c,btn('[data-org-act]',{orgAct:'join',value:'team-a'}));
 await tick();
 const j=find(c,'POST','/orgs/team-a/join');
 assert.equal(j.length,1);
 assert.ok(j[0].opts.idempotencyKey);
 assert.ok(c.page.includes('申请中'),'pending label from server state');
 // 管理员不能改角色
 const d=context({hash:'#/org/team-a',rootSel:'data-org-root'});
 d.routes['GET /orgs/team-a']={data:teamRaw({state:'active',role:'admin'}),meta:{}};
 startOrgs(d,'org');
 await tick();
 click(d,btn('[data-org-act]',{orgAct:'tab',value:'members'}));
 await tick();
 assert.ok(d.page.includes('只有所有者能调整角色'),'admin hint');
 // 404
 const e=context({hash:'#/org/none',rootSel:'data-org-root'});
 startOrgs(e,'org');
 await tick();
 assert.ok(e.page.includes('没有找到这个团队'));
 console.log('ORGS_GUEST_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

TOOLS = r'''
(async()=>{
 const c=context({hash:'#/tools',rootSel:'tools-page'});
 c.routes['GET /tools']={data:[],meta:{}};
 vm.runInContext(source('tools'),c);
 const T=c.CommonsTools;
 const html=()=>c.rootNode.innerHTML;
 c.rootNode.innerHTML=T.routes.tools();
 T.mount();
 await tick();
 assert.ok(html().includes('data-tools-act="submit-toggle"'),'live submit button');
 click(c,btn('[data-tools-act]',{toolsAct:'submit-toggle'}));
 await tick();
 assert.ok(html().includes('data-tools-form="submit"'),'form opened');
 const mk=(over)=>{const status={textContent:''},sb={disabled:false};
  const el=k=>({value:over[k]===undefined?'':over[k]});
  return {status,sb,reportValidity:()=>true,closest:s=>s==='[data-tools-form="submit"]'?mk.self:null,
   elements:{slug:el('slug'),name:el('name'),vendor:el('vendor'),category:el('category'),official_url:el('official_url'),price_tier:el('price_tier'),tags:el('tags'),summary:el('summary')},
   querySelector:s=>s==='[data-tools-submit-status]'?status:(s==='[type="submit"]'?sb:null)};};
 const values={slug:'my-tool',name:'我的工具',vendor:'某厂',category:'知识管理',official_url:'https://t.example',price_tier:'免费',tags:'笔记, 本地 ,',summary:'一句话'};
 let form=mk(values); mk.self=form;
 c.routes['POST /tools/submissions']=Object.assign(new Error('这个工具已经提交过'),{status:409});
 c.document.dispatchEvent('submit',{target:form,preventDefault(){}});
 await tick();
 assert.equal(form.status.textContent,'这个工具已经提交过','server message kept in the form');
 assert.ok(html().includes('data-tools-form="submit"'),'form stays open on failure');
 assert.equal(form.sb.disabled,false);
 c.routes['POST /tools/submissions']={data:{slug:'my-tool',status:'pending_review'},meta:{}};
 form=mk(values); mk.self=form;
 c.document.dispatchEvent('submit',{target:form,preventDefault(){}});
 await tick();
 const posts=find(c,'POST','/tools/submissions');
 assert.equal(posts.length,2);
 assert.deepEqual(posts[1].body,{slug:'my-tool',name:'我的工具',vendor:'某厂',category:'知识管理',official_url:'https://t.example',price_tier:'免费',tags:['笔记','本地'],summary:'一句话'});
 assert.ok(posts[1].opts.idempotencyKey);
 assert.ok(html().includes('已提交，审核通过后会出现在工具榜里'),'honest notice after server ok');
 assert.ok(!html().includes('data-tools-form="submit"'),'form closed after success');
 // 取消在用走 CommonsAPI.del，不再手写 fetch
 c.routes['GET /tools/codex']={data:{slug:'codex',name:'Codex',vendor:'x',category:'编程 Agent',price_tier:'免费',official_url:'https://x.example',summary:'s',tags:[],use_count:1,month_new_count:0,rating:{median:null,count:0},reviews:[],mine:{started_at:'2026-01-01T00:00:00.000Z'},trend:[],related:{}},meta:{}};
 c.routes['DELETE /tools/codex/use']={data:{}};
 const d=context({hash:'#/tool/codex',rootSel:'tools-page'});
 d.routes['GET /tools/codex']=c.routes['GET /tools/codex'];
 d.routes['DELETE /tools/codex/use']=c.routes['DELETE /tools/codex/use'];
 vm.runInContext(source('tools'),d);
 d.rootNode.innerHTML=d.CommonsTools.routes.tool();
 d.CommonsTools.mount();
 await tick();
 click(d,btn('[data-tools-act]',{toolsAct:'use-toggle',id:'codex'}));
 await tick();
 const del=find(d,'DELETE','/tools/codex/use');
 assert.equal(del.length,1,'DELETE through CommonsAPI.del');
 assert.ok(del[0].opts.idempotencyKey);
 console.log('TOOLS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

SCENARIOS = {
    'profile_read': PROFILE_READ,
    'profile_follow': PROFILE_FOLLOW,
    'profile_fail': PROFILE_FAIL,
    'profile_dm_more': PROFILE_DM_MORE,
    'profile_self': PROFILE_SELF,
    'work': WORK,
    'benefits': BENEFITS,
    'orgs_dir': ORGS_DIR,
    'orgs_detail': ORGS_DETAIL,
    'orgs_guest': ORGS_GUEST,
    'tools': TOOLS,
}


def run_node(script, before=False):
    args = ['node', '-e', COMMON + script, str(ROOT)]
    if before:
        args.append(str(BEFORE))
    return subprocess.run(args, capture_output=True, text=True, timeout=120)


class Lg8aMembersTeams(unittest.TestCase):
    def check(self, name):
        result = run_node(SCENARIOS[name])
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS', result.stdout)

    def test_profile_reads_relation_works_and_wall(self):
        self.check('profile_read')

    def test_profile_follow_and_unfollow_hit_the_api(self):
        self.check('profile_follow')

    def test_profile_failure_shows_server_text_and_does_not_flip(self):
        self.check('profile_fail')

    def test_profile_dm_uses_member_id_and_block_asks_first(self):
        self.check('profile_dm_more')

    def test_own_profile_has_no_follow_or_dm(self):
        self.check('profile_self')

    def test_work_page_reads_object_and_saves(self):
        self.check('work')

    def test_benefits_page_reads_membership(self):
        self.check('benefits')

    def test_orgs_directory_and_create(self):
        self.check('orgs_dir')

    def test_org_detail_post_role_attach_follow(self):
        self.check('orgs_detail')

    def test_org_guest_and_admin_limits(self):
        self.check('orgs_guest')

    def test_tools_submit_and_delete_through_api(self):
        self.check('tools')

    def test_demo_paths_unchanged_markers(self):
        people = (ROOT / 'preview' / 'people.js').read_text(encoding='utf-8')
        self.assertIn("C().read('people.following', [])", people)
        self.assertIn("toggleStored('people.following', id)", people)
        self.assertIn('已保存在本机。', people)
        orgs = (ROOT / 'preview' / 'orgs.js').read_text(encoding='utf-8')
        self.assertIn("toggleStored('orgs.following', value)", orgs)
        self.assertIn("C().write('orgs.applications', rows)", orgs)
        tools = (ROOT / 'preview' / 'tools.js').read_text(encoding='utf-8')
        self.assertIn("write('uses', uses)", tools)
        self.assertIn('（本机示例）', tools)

    def test_scenarios_fail_on_old_code(self):
        if not BEFORE.is_dir():
            self.skipTest('改前构建不在')
        failed = {}
        for name, script in SCENARIOS.items():
            result = run_node(script, before=True)
            failed[name] = result.returncode != 0
        self.assertTrue(all(failed.values()), f'改前代码应当全部失败：{failed}')


if __name__ == '__main__':
    unittest.main()
