"""LG-8B R16 · editor.js 旧文可见范围不被放宽、发布幂等键复用；market.js 发布幂等键复用。

离线 VM：断言 PATCH / POST 的 method + path + body + 幂等键。环境变量 LG8B_PREVIEW 指向别的 preview 目录时，
同一批断言用来反跑「改前」副本（docs/evidence/LG-8B/before-r16/preview）。
"""
from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path

from tests.test_lg8b_r15_market_kb import COMMON as MARKET_COMMON, MARKET as MARKET_SETUP

ROOT = Path(__file__).resolve().parents[2]

EDITOR_COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const dir=process.env.LG8B_PREVIEW||(root+'/preview');
const source=name=>fs.readFileSync(dir+'/'+name+'.js','utf8');
const tick=async(n=24)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){(events[type]||new Set()).forEach(f=>f(ev))}}}
function context(mode,hash){
  const posts=[],gets=[],toasts=[];
  let html='',keyN=0;
  const host={
    appendChild(){return this;},
    set innerHTML(v){html=String(v||'');},
    get innerHTML(){return html;},
    querySelector(){const n={style:{},hidden:false,className:'',innerHTML:'',value:'',textContent:'',scrollHeight:24,addEventListener(){},querySelector(){return n;},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}},contains(){return true}};return n;}
  };
  const c=Object.assign(eventTarget(),{
    console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
    AbortController,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},
    fetch:()=>Promise.reject(Error('no fetch')),
    location:{protocol:'https:',hash:hash||'#/write',replace(){},assign(){}},
    matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
    posts,gets,toasts,host,failPosts:0
  });
  c.document=Object.assign(eventTarget(),{
    activeElement:null,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],
    createElement:()=>({innerHTML:'',firstElementChild:null,classList:{add(){}},setAttribute(){}}),
    head:{appendChild(){}},body:{classList:{add(){},remove(){}}}
  });
  c.Commons={read:(_k,fb)=>fb,write(){return true;},toast:m=>toasts.push(m),refresh(){},go(){},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#')};
  const routes={};
  const record=(method,path,body,opts)=>{
    posts.push({method,path,body:body||{},opts:opts||{}});
    if(c.failPosts>0){c.failPosts--;return Promise.reject(Object.assign(new Error('Failed to fetch'),{status:0}));}
    return Promise.resolve({data:{id:'new-1'},meta:{}});
  };
  c.CommonsAPI={
    mode,
    get(path){gets.push(path);const r=routes[path];return r===undefined?Promise.reject(Object.assign(Error('no '+path),{status:404})):Promise.resolve({data:r,meta:{}});},
    post(path,body,opts){return record('POST',path,body,opts);},
    patch(path,body,opts){return record('PATCH',path,body,opts);},
    me(){return Promise.resolve({id:'me',display_name:'我',handle:'me',level:2});},
    newIdempotencyKey:()=>'idem-'+(++keyN)
  };
  c.COMMONS_BUILD={mode};
  c.CommonsSession={me:{id:'me',display_name:'我',handle:'me',level:2},can:()=>true};
  c.CommonsReader={esc:s=>String(s==null?'':s),levels:{2:'熟手',3:'骨干',4:'导师',5:'理事'},visibility:()=>({who:'',label:''})};
  c.routes=routes;
  c.window=c;c.self=c;c.globalThis=c;
  Object.defineProperty(c,'capturedHTML',{get(){return html;}});
  vm.createContext(c);
  return c;
}
async function openEdit(row){
  const c=context('live','#/write/obj1');
  c.routes['/objects/obj1']=Object.assign({id:'obj1',title:'旧文',type:'knowledge',content:{doc:{type:'doc',content:[{type:'paragraph'}]},aigc:'none'},min_level:1,etag:'"e1"',acl:[],space_id:null},row);
  vm.runInContext(source('editor'),c);
  const host=c.host;
  c.document.querySelector=s=>s==='[data-edt-page="write"] [data-edt-host]'?host:s==='[data-edt-page="write"]'?{addEventListener(){},removeEventListener(){}}:s==='[data-edt-live-error]'?{textContent:''}:null;
  c.CommonsEditorPage.mount();
  await tick();
  c.CommonsEditorPage.mount();
  await tick();
  const inst=c.CommonsEditorPage.instance;
  assert.ok(inst&&typeof inst.opts.onPublish==='function','edit instance mounted');
  return {c,inst};
}
const envOf=(scope,extra)=>Object.assign({title:'旧文改',kind:'knowledge',doc:{type:'doc',content:[]},aigc:'none',visibility:{scope,level:null,space:null,people:[]}},extra||{});
'''

SCOPE_LOCKED = r'''
(async()=>{
 const cases=[
  ['space',{visibility:'space',space_id:'sp1'},/空间成员可见/],
  ['named',{visibility:'named',acl:['p2']},/点名的成员可见/],
  ['public',{visibility:'public'},/公开/]
 ];
 for(const [name,row,label] of cases){
  const {c,inst}=await openEdit(row);
  const html=c.capturedHTML;
  assert.ok(html.includes('data-edt-scope-locked'),name+': read-only scope shown');
  assert.ok(html.includes('这篇的可见范围在这里改不了'),name+': says it cannot be changed here');
  assert.ok(label.test(html),name+': shows the current scope');
  assert.ok(!/type="radio" name="edt-scope-/.test(html),name+': no scope radios');
  // 面板里即使被改成 members 的信封，也不能把可见范围发出去
  await inst.opts.onPublish(envOf('members'));
  const patch=c.posts.find(p=>p.method==='PATCH'&&p.path==='/objects/obj1');
  assert.ok(patch,name+': PATCH /objects/obj1');
  const body=JSON.parse(JSON.stringify(patch.body));
  assert.deepStrictEqual(Object.keys(body).sort(),['content','title'],name+': PATCH body carries no visibility fields');
  assert.equal(body.title,'旧文改');
  assert.equal(patch.opts.ifMatch,'"e1"');
  assert.ok(patch.opts.idempotencyKey);
 }
 console.log('_PASS editor-scope-locked');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

SCOPE_EDITABLE = r'''
(async()=>{
 const a=await openEdit({visibility:'members'});
 assert.ok(!a.c.capturedHTML.includes('data-edt-scope-locked'),'members keeps the radios');
 assert.ok(a.c.capturedHTML.includes('value="members"')&&a.c.capturedHTML.includes('value="level"'));
 await a.inst.opts.onPublish(envOf('members'));
 let body=JSON.parse(JSON.stringify(a.c.posts.find(p=>p.method==='PATCH').body));
 assert.equal(body.visibility,'members');
 assert.equal(body.min_level,1);
 assert.equal(body.space_id,null);
 assert.deepStrictEqual(body.acl,[]);
 const b=await openEdit({visibility:'level',min_level:3});
 assert.ok(!b.c.capturedHTML.includes('data-edt-scope-locked'),'level keeps the radios');
 await b.inst.opts.onPublish(envOf('level',{visibility:{scope:'level',level:4,space:null,people:[]}}));
 body=JSON.parse(JSON.stringify(b.c.posts.find(p=>p.method==='PATCH').body));
 assert.equal(body.visibility,'level');
 assert.equal(body.min_level,4);
 console.log('_PASS editor-scope-editable');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

EDITOR_KEY = r'''
(async()=>{
 const c=context('live','#/write');
 vm.runInContext(source('editor'),c);
 const host=c.host;
 c.document.querySelector=s=>s==='[data-edt-page="write"] [data-edt-host]'?host:s==='[data-edt-page="write"]'?{addEventListener(){},removeEventListener(){}}:s==='[data-edt-live-error]'?{textContent:''}:null;
 c.CommonsEditorPage.mount();
 await tick();
 const pub=c.CommonsEditorPage.instance.opts.onPublish;
 const env=title=>({kind:'discussion',title,doc:{type:'doc',content:[]},aigc:'none',visibility:{scope:'members',level:null,space:null,people:[]}});
 const keys=()=>c.posts.filter(p=>p.path==='/objects').map(p=>p.opts.idempotencyKey);
 c.failPosts=1;
 await pub(env('一篇')).catch(()=>{});
 await pub(env('一篇'));
 let k=keys();
 assert.equal(k.length,2);
 assert.equal(k[0],k[1],'retry of the same draft reuses the key');
 await pub(env('一篇'));
 k=keys();
 assert.notEqual(k[2],k[1],'after success the next publish gets a new key');
 c.failPosts=1;
 await pub(env('另一篇')).catch(()=>{});
 await pub(env('另一篇改了')).catch(()=>{});
 k=keys();
 assert.notEqual(k[3],k[4],'changed content gets a new key');
 console.log('_PASS editor-publish-key');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MARKET_KEY = MARKET_SETUP + r'''
(async()=>{
 const c=live('#/market/new');
 c.FormData=function(f){this.m=f.values;};
 c.FormData.prototype.has=function(k){return k in this.m};
 c.FormData.prototype.get=function(k){return this.m[k]};
 c.document.querySelector=s=>s==='[data-mt-root]'?fake():null;
 vm.runInContext(source('market'),c);
 c.CommonsMarket.mount();
 await tick();
 const submitBtn=fake();
 const confirmBox=fake({checked:true});
 const f=fake({values:{title:'旧显示器',body:'能用',category:'sell',price:'¥300'},reportValidity:()=>true,
  querySelector:s=>s==='[data-mt-confirm]'?confirmBox:s==='[type="submit"]'?submitBtn:null});
 f.closest=s=>s==='[data-mt-form="new"]'?f:null;
 const submit=()=>c.document.dispatchEvent('submit',{target:f,preventDefault(){}});
 const toStep3=()=>{click(c,'category',{category:'sell'});submit();};
 const keys=()=>posts(c,'/market/listings').map(p=>p.opts.idempotencyKey);
 toStep3();
 const netFail=()=>Promise.reject(Object.assign(new Error('Failed to fetch'),{status:0}));
 c.routes['POST /market/listings']=netFail;
 submit(); await tick();
 submit(); await tick();
 let k=keys();
 assert.equal(k.length,2,'two attempts');
 assert.ok(k[0]&&k[0]===k[1],'retry of the same form reuses the key');
 f.values.title='旧显示器 九成新';
 submit(); await tick();
 k=keys();
 assert.notEqual(k[2],k[1],'changed content gets a new key');
 c.routes['POST /market/listings']={data:{id:'obj-new'}};
 submit(); await tick();
 k=keys();
 assert.equal(k[3],k[2],'success reuses the key of the failed attempt');
 assert.equal(c.went,'market/obj-new');
 f.values.title='旧显示器 九成新';
 toStep3();
 submit(); await tick();
 k=keys();
 assert.notEqual(k[4],k[3],'after success the next publish gets a new key');
 console.log('_PASS market-publish-key');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class Lg8bR16EditorMarket(unittest.TestCase):
    def run_node(self, common, script, marker):
        result = subprocess.run(['node', '-e', common + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn(marker, result.stdout)

    def test_editor_own_article_with_other_scope_is_read_only_and_patch_has_no_visibility(self):
        self.run_node(EDITOR_COMMON, SCOPE_LOCKED, '_PASS editor-scope-locked')

    def test_editor_own_article_with_option_scope_patches_as_before(self):
        self.run_node(EDITOR_COMMON, SCOPE_EDITABLE, '_PASS editor-scope-editable')

    def test_editor_publish_reuses_key_until_success_or_edit(self):
        self.run_node(EDITOR_COMMON, EDITOR_KEY, '_PASS editor-publish-key')

    def test_market_publish_reuses_key_until_success_or_edit(self):
        self.run_node(MARKET_COMMON, MARKET_KEY, '_PASS market-publish-key')


if __name__ == '__main__':
    unittest.main()
