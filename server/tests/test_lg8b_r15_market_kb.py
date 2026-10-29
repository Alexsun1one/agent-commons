"""LG-8B R15 · 市集留言接真实回复串、发布请求中禁用；问题库复现请求中禁用、缺环境说清缺什么。

离线 VM：mock CommonsAPI / CommonsThread，断言 method + path + body + 幂等键与按钮灰态；演示模式逐字不变。
环境变量 LG8B_PREVIEW 指向别的 preview 目录时，同一批断言用来反跑「改前」副本。
"""
from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = Path(os.environ.get('LG8B_PREVIEW') or ROOT / 'preview')

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const dir=process.env.LG8B_PREVIEW||(process.argv[1]+'/preview');
const source=name=>fs.readFileSync(dir+'/'+name+'.js','utf8');
const tick=async(n=30)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){[...(events[type]||[])].forEach(f=>f(ev))}}}
function fake(extra){return Object.assign({innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,dataset:{},focus(){},setAttribute(){},querySelector:()=>null,querySelectorAll:()=>[],closest(){return null},matches(){return false},contains(){return true}},extra||{});}
function context(mode,hash){
  const log=[],toasts=[],mounts=[];
  const c=Object.assign(eventTarget(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
    AbortController,setTimeout,clearTimeout,fetch:()=>Promise.reject(Error('no fetch')),
    location:{protocol:'https:',hash:hash||'#/',replace(){},assign(){}},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
    log,toasts,mounts,routes:{},keyN:0});
  c.document=Object.assign(eventTarget(),{activeElement:null,querySelector:()=>null,querySelectorAll:()=>[],body:{classList:{add(){},remove(){},toggle(){}}},createElement:()=>fake()});
  c.Commons={read:(k,fb)=>fb,write:()=>true,toast:m=>toasts.push(m),refresh(){},go(r){c.location.hash='#/'+r;c.went=r;},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#'),closeModal(){}};
  const handle=(method,path,body,opts)=>{
    log.push({method,path,body,opts:opts||{}});
    const key=method+' '+path;
    let r=c.routes[key];
    if(r===undefined&&method==='GET')r=c.routes[path];
    if(r===undefined)return Promise.reject(Object.assign(new Error('no route '+key),{status:404,code:'resource_not_found'}));
    if(typeof r==='function')return r(body,opts);
    return Promise.resolve(r);
  };
  c.CommonsAPI={mode,get:(p,q,o)=>handle('GET',p,q,o),post:(p,b,o)=>handle('POST',p,b,o),patch:(p,b,o)=>handle('PATCH',p,b,o),
    put:(p,b,o)=>handle('PUT',p,b,o),del:(p,b,o)=>handle('DELETE',p,b,o),newIdempotencyKey:()=>'idem-'+(++c.keyN)};
  c.CommonsThread={mount:(host,opts)=>{mounts.push({host,opts});}};
  c.COMMONS_BUILD={mode};
  c.window=c;c.self=c;
  vm.createContext(c);
  return c;
}
const posts=(c,path)=>c.log.filter(x=>x.method==='POST'&&x.path===path);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
'''

MARKET = r'''
const listing={id:'obj-mk1',category:'sell',status:'active',title:'旧显示器',body:'能用',author:'p2',mine:false,wanted:false,createdAt:'2026-10-01'};
const meta={categories:[{id:'sell',label:'闲置',active:'在售',fields:['price'],required:[]}],field_labels:{price:'价格'},status_labels:{active:'在售'},report_reasons:[{id:'spam',label:'垃圾'}],people:[]};
function live(hash){
  const c=context('live',hash);
  c.routes['/market/meta']={data:meta};
  c.routes['/market/listings']={data:[listing]};
  c.routes['/market/listings/obj-mk1']={data:Object.assign({},listing)};
  return c;
}
function click(c,act,data){
  const dataset=Object.assign({mtAct:act},data||{});
  const attr={'data-mt-act':act};
  Object.entries(data||{}).forEach(([k,v])=>{attr['data-'+k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())]=v;});
  const b=fake({dataset,getAttribute:n=>attr[n]||'',closest(s){return s==='[data-mt-act]'?this:null}});
  c.document.dispatchEvent('click',{target:b,preventDefault(){}});
  return b;
}
'''

THREAD_LIVE = MARKET + r'''
(async()=>{
 const c=live('#/market/obj-mk1');
 const host=fake();
 const root=fake({querySelector:s=>s==='[data-mt-thread]'?host:null});
 c.document.querySelector=s=>s==='[data-mt-root]'?root:null;
 vm.runInContext(source('market'),c);
 c.CommonsMarket.mount();
 await tick();
 c.CommonsMarket.mount();
 await tick();
 assert.equal(c.mounts.length,1,'live detail mounts the reply thread once');
 assert.strictEqual(c.mounts[0].host,host);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(c.mounts[0].opts)),{targetId:'obj-mk1',repliesOnly:true},'live thread uses the object id and repliesOnly');
 console.log('_PASS market-thread-live');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

THREAD_DEMO = r'''
(async()=>{
 const c=context('demo','#/market/mk1');
 c.COMMONS_MARKET_SAMPLE={people:[{id:'me',name:'我',level:3},{id:'p2',name:'乙',level:2},{id:'p3',name:'丙',level:2}],
  categories:[{id:'sell',label:'闲置',active:'在售',fields:['price'],required:[]}],fieldLabels:{},statusLabels:{},reportReasons:[],
  listings:[{id:'mk1',category:'sell',status:'active',title:'旧显示器',body:'能用',author:'p2',createdAt:'2026-10-01T00:00:00Z'}],
  comments:{sell:['甲','乙','丙']}};
 const host=fake();
 const root=fake({querySelector:s=>s==='[data-mt-thread]'?host:null});
 c.document.querySelector=s=>s==='[data-mt-root]'?root:null;
 vm.runInContext(source('market'),c);
 c.CommonsMarket.mount();
 await tick();
 assert.equal(c.mounts.length,1);
 const o=c.mounts[0].opts;
 assert.equal(o.repliesOnly,undefined,'demo keeps the full demo shell');
 assert.equal(o.mode,'chat');
 assert.equal(o.targetId,'mk1');
 assert.equal(o.messages.length,3);
 assert.equal(c.log.length,0,'demo sends no request');
 console.log('_PASS market-thread-demo');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

PUBLISH = MARKET + r'''
(async()=>{
 const c=live('#/market/new');
 c.FormData=function(f){this.m=f.values;};
 c.FormData.prototype.has=function(k){return k in this.m};
 c.FormData.prototype.get=function(k){return this.m[k]};
 c.document.querySelector=s=>s==='[data-mt-root]'?fake():null;
 vm.runInContext(source('market'),c);
 c.CommonsMarket.mount();
 await tick();
 click(c,'category',{category:'sell'});
 const submitBtn=fake();
 const confirmBox=fake({checked:true});
 const f=fake({values:{title:'旧显示器',body:'能用',category:'sell',price:'¥300'},reportValidity:()=>true,
  querySelector:s=>s==='[data-mt-confirm]'?confirmBox:s==='[type="submit"]'?submitBtn:null});
 f.closest=s=>s==='[data-mt-form="new"]'?f:null;
 const submit=()=>c.document.dispatchEvent('submit',{target:f,preventDefault(){}});
 submit();  // 第 2 步 → 第 3 步
 assert.equal(c.log.filter(x=>x.method==='POST').length,0);
 const gate=deferred();
 c.routes['POST /market/listings']=()=>gate.promise;
 submit();
 assert.equal(submitBtn.disabled,true,'publish button is disabled while the request is in flight');
 submit();
 await tick();
 const sent=posts(c,'/market/listings');
 assert.equal(sent.length,1,'double submit sends one request');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[0].body)),{category:'sell',title:'旧显示器',body:'能用',price:'¥300'});
 assert.ok(sent[0].opts.idempotencyKey,'publish carries an idempotency key');
 gate.reject(Object.assign(new Error('今天最多发布 3 条'),{status:429,code:'market_daily_limit'}));
 await tick();
 assert.equal(submitBtn.disabled,false,'failure re-enables the button');
 assert.ok(c.toasts.includes('今天最多发布 3 条'),'failure shows the server message');
 console.log('_PASS market-publish-busy');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

KB = r'''
const prob={id:'p1',title:'标题一',phenomenon:'现象一',error_signature:'sig',status:'pending',stale_hint:false,industry_key:'education',
  environments:[{tool_key:'codex',version:'1',system:'mac'}],successful_verifications:0,updated_at:'2026-10-01T00:00:00Z'};
const detail=Object.assign({},prob,{etag:'e1',editable:true,author:{id:'u1',display_name:'某人'},
  solutions:[{root_cause:'根因一',steps:['步骤一','步骤二']}],verification:{success:2,failed:0,distribution:[]},links:[]});
async function kbLive(p,d){
  const c=context('live','#/solved');
  c.routes['/kb/search']={data:[p]};
  c.routes['/kb/problems/'+p.id]={data:d};
  const btns=[fake({dataset:{kbAct:'verify-success'}}),fake({dataset:{kbAct:'verify-fail'}})];
  const parts={list:fake(),detail:fake(),count:fake(),panel:fake(),capture:fake(),query:fake()};
  const map={'[data-kb-list]':parts.list,'[data-kb-detail]':parts.detail,'[data-kb-count]':parts.count,'[data-kb-panel]':parts.panel,'[data-kb-capture]':parts.capture,'[data-kb-query]':parts.query};
  const rootNode=fake({parentNode:fake(),querySelector:s=>map[s]||null,querySelectorAll:s=>/verify-success/.test(s)?btns:[]});
  c.document.querySelector=s=>s==='[data-kb]'?rootNode:null;
  vm.runInContext(source('kb'),c);
  c.CommonsKB.routes.solved();
  c.CommonsKB.mount();
  await tick();
  return {c,btns,parts};
}
const kbClick=(c,act)=>{const b=fake({dataset:{kbAct:act,id:''}});b.closest=s=>s==='[data-kb-act]'?b:null;c.document.dispatchEvent('click',{target:b,preventDefault(){}});};
'''

KB_VERIFY = KB + r'''
(async()=>{
 const {c,btns}=await kbLive(prob,detail);
 const gate=deferred();
 c.routes['POST /kb/problems/p1/verify']=()=>gate.promise;
 kbClick(c,'verify-success');
 assert.ok(btns.every(b=>b.disabled),'verify buttons are disabled while the request is in flight');
 kbClick(c,'verify-fail');
 await tick();
 const sent=posts(c,'/kb/problems/p1/verify');
 assert.equal(sent.length,1,'second click while in flight sends nothing');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[0].body)),{tool_key:'codex',version:'1',system:'mac',success:true,note:''});
 assert.ok(sent[0].opts.idempotencyKey);
 gate.reject(Object.assign(new Error('等级还不够'),{status:403,code:'forbidden'}));
 await tick();
 assert.ok(btns.every(b=>!b.disabled),'failure re-enables the buttons');
 assert.ok(c.toasts.includes('等级还不够'),'failure shows the server message');
 // 失败后可以再试
 c.routes['POST /kb/problems/p1/verify']={data:detail};
 kbClick(c,'verify-fail');
 await tick();
 assert.equal(posts(c,'/kb/problems/p1/verify').length,2,'retry after failure is allowed');
 console.log('_PASS kb-verify-busy');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

KB_NO_ENV = KB + r'''
(async()=>{
 const bare=Object.assign({},prob,{environments:[]});
 const {c}=await kbLive(bare,Object.assign({},detail,{environments:[]}));
 kbClick(c,'verify-success');
 await tick();
 assert.equal(posts(c,'/kb/problems/p1/verify').length,0,'no request without a tool environment');
 const text=c.toasts.join('|');
 assert.ok(!text.includes('还没开放'),'missing env is not reported as "not open yet"');
 assert.ok(/工具/.test(text),'message says the tool environment is missing');
 console.log('_PASS kb-verify-no-env');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class Lg8bR15MarketKb(unittest.TestCase):
    def run_node(self, script, marker):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn(marker, result.stdout)

    def test_market_live_thread_is_replies_only_on_object_id(self):
        self.run_node(THREAD_LIVE, '_PASS market-thread-live')

    def test_market_demo_thread_unchanged(self):
        self.run_node(THREAD_DEMO, '_PASS market-thread-demo')

    def test_market_publish_disables_button_in_flight(self):
        self.run_node(PUBLISH, '_PASS market-publish-busy')

    def test_kb_verify_disables_buttons_in_flight(self):
        self.run_node(KB_VERIFY, '_PASS kb-verify-busy')

    def test_kb_verify_without_env_explains_what_is_missing(self):
        self.run_node(KB_NO_ENV, '_PASS kb-verify-no-env')


if __name__ == '__main__':
    unittest.main()
