"""LG-6B R15 · 编辑器合约修补：发布说明、可见范围、斜杠菜单、撤回确认、幂等键。"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const source=name=>fs.readFileSync(root+'/preview/'+name+'.js','utf8');
const tick=async(n=24)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){(events[type]||new Set()).forEach(f=>f(ev))}}}
function context(mode,hash){
  const posts=[],gets=[],toasts=[];
  let html='';
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
    posts,gets,toasts,host,pageHTML:''
  });
  c.document=Object.assign(eventTarget(),{
    activeElement:null,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],
    createElement:()=>({innerHTML:'',firstElementChild:null,classList:{add(){}},setAttribute(){}}),
    head:{appendChild(){}},body:{classList:{add(){},remove(){}}}
  });
  c.Commons={read:(_k,fb)=>fb,write(){return true;},toast:m=>toasts.push(m),refresh(){},go(){},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#')};
  const routes={};
  const record=(method,path,body,opts)=>{posts.push({method,path,body:body||{},opts:opts||{}});return Promise.resolve({data:{id:'new-1'},meta:{}});};
  c.CommonsAPI={
    mode,
    get(path){gets.push(path);const r=routes[path];return r===undefined?Promise.reject(Object.assign(Error('no '+path),{status:404})):Promise.resolve({data:r,meta:{}});},
    post(path,body,opts){return record('POST',path,body,opts);},
    patch(path,body,opts){return record('PATCH',path,body,opts);},
    me(){return Promise.resolve({id:'me',display_name:'我',handle:'me',level:2});},
    newIdempotencyKey:()=>'idem-1'
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
'''

PANEL = r'''
(async()=>{
 const live=context('live','#/write');
 vm.runInContext(source('editor'),live);
 live.CommonsEditor.mount(live.host,{kind:'discussion',sample:false,draft:false,onPublish:()=>Promise.resolve({})});
 const html=live.capturedHTML;
 assert.ok(html.includes('发布后登录成员都能看到'),'live note');
 assert.ok(!html.includes('发布只存在本机，不通知任何人。'),'no local-only note');
 assert.ok(!html.includes('value="private"'),'no private');
 assert.ok(!html.includes('value="people"'),'no people');
 assert.ok(!/value="space"/.test(html),'no space');
 assert.ok(html.includes('value="members"'),'members stays');
 assert.ok(!html.includes('用示例图'),'no demo image');
 assert.ok(!html.includes('提及成员'),'no mention hint');

 const demo=context('demo','#/write');
 vm.runInContext(source('editor'),demo);
 demo.CommonsEditor.mount(demo.host,{kind:'knowledge',sample:false,draft:false});
 const d=demo.capturedHTML;
 assert.ok(d.includes('发布只存在本机，不通知任何人。'),'demo note stays');
 assert.ok(d.includes('value="private"')&&d.includes('仅自己'),'demo private');
 assert.ok(d.includes('value="people"')&&d.includes('受邀成员'),'demo people');
 assert.ok(d.includes('value="space"')&&d.includes('空间'),'demo space');
 assert.ok(d.includes('用示例图')||d.includes('data-img-demo')||source('editor').includes('用示例图'),'demo image control remains in source');
 assert.ok(d.includes('提及成员'),'demo mention hint');
 console.log('PANEL_PASS live note/scopes vs demo');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

PUBLISH = r"""
(async()=>{
 const c=context("live","#/write");
 vm.runInContext(source("editor"),c);
 const host=c.host;
 c.document.querySelector=s=>s==="[data-edt-page=\"write\"] [data-edt-host]"?host:s==="[data-edt-page=\"write\"]"?{addEventListener(){},removeEventListener(){}}:s==="[data-edt-live-error]"?{textContent:""}:null;
 c.CommonsEditorPage.mount();
 await tick();
 const wr=c.CommonsEditorPage.instance;
 assert.ok(wr,"write instance");
 assert.equal(typeof wr.opts.onPublish,"function","onPublish");
 await wr.opts.onPublish({kind:"discussion",title:"一篇讨论",doc:{type:"doc",content:[]},aigc:"none",visibility:{scope:"members",level:null,space:null,people:[]}});
 await tick();
 const post=c.posts.find(p=>p.method==="POST"&&p.path==="/objects");
 assert.ok(post,"POST /objects");
 assert.equal(post.body.type,"discussion");
 assert.equal(post.body.visibility,"members");
 assert.ok(post.opts.idempotencyKey,"publish idempotency");
 console.log("PUBLISH_PASS live post idempotent");
})().catch(e=>{console.error(e);process.exitCode=1});
"""


class Lg6bR15Editor(unittest.TestCase):
    def test_source_blocking_note_and_gates(self):
        editor = (PREVIEW / 'editor.js').read_text(encoding='utf-8')
        self.assertIn('发布只存在本机，不通知任何人。', editor)
        self.assertIn('发布后登录成员都能看到。', editor)
        self.assertIn('function livePubNote', editor)
        self.assertIn("isLive() ? livePubNote", editor)
        self.assertIn('LIVE_SLASH_HIDE', editor)
        self.assertIn('snapLiveScope', editor)
        self.assertIn("vis.scope === 'private'", editor)
        self.assertIn('writeOpts()', editor)
        self.assertIn('withdraw-yes', editor)
        self.assertNotIn('window.confirm', editor)
        self.assertNotIn('confirm(', editor.split('function withdrawLive')[1].split('function publishLive')[0])

    def test_demo_copy_untouched(self):
        editor = (PREVIEW / 'editor.js').read_text(encoding='utf-8')
        self.assertIn("opt('private', '仅自己', '先存着，只有你能看到')", editor)
        self.assertIn("opt('people', '受邀成员', '你点名的人', people)", editor)
        self.assertIn("opt('space', '空间', '课程、项目或会馆的成员', space)", editor)
        self.assertIn("'发布只存在本机，不通知任何人。'", editor)
        self.assertIn('用示例图', editor)
        self.assertIn('提及成员', editor)

    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def test_vm_live_panel_hides_broken_scopes(self):
        self.run_node(PANEL)

    def test_vm_publish_live_sends_idempotency(self):
        self.run_node(PUBLISH)
