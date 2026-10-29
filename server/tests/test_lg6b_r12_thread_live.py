"""LG-6B R12 · 讨论串真实模式可看可回。"""
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
const tick=async(n=20)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){(events[type]||[]).forEach(f=>f(ev))}}}
function context(mode,hash){
  const posts=[],writes=[],toasts=[];
  const store={};
  const rootNode={innerHTML:'',nodeType:1,setAttribute(){},closest(){return null},querySelector:()=>null,querySelectorAll:()=>[],contains(){return true}};
  const c=Object.assign(eventTarget(),{
    console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
    AbortController,setTimeout,clearTimeout,fetch:()=>Promise.reject(Error('no fetch')),
    location:{protocol:'https:',hash:hash||'#/threads/t1',replace(){},assign(){}},
    matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
    posts,writes,toasts,rootNode,store,pageHTML:''
  });
  c.document=Object.assign(eventTarget(),{
    activeElement:null,
    getElementById:()=>null,
    querySelector:s=>/data-thread-live|data-th-live-form/.test(s)?rootNode:null,
    querySelectorAll:()=>[],
    body:{classList:{add(){},remove(){},toggle(){}}}
  });
  c.Commons={
    read:(k,fb)=>k in store?store[k]:fb,write:(k,v)=>{store[k]=v;writes.push({k,v});return true;},
    toast:m=>toasts.push(m),
    refresh(){c.pageHTML=c.CommonsThread.routes.threads();},
    go(r){c.location.hash='#/'+r;},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#')
  };
  const routes={};
  const record=(method,path,body,opts)=>{posts.push({method,path,body:body||{},opts:opts||{}});const r=routes[method+' '+path];if(r===undefined)return Promise.resolve({data:{id:'new-1',body:body&&body.body,author:{id:'me',display_name:'我',level:2},createdAt:'2026-01-02T00:00:00.000Z',status:'ok',etag:'"v1-p0"'},meta:{}});if(typeof r==='function')return r(body,opts);return r;};
  c.CommonsAPI={
    mode,
    get(path){const r=routes[path];return r===undefined?Promise.reject(Object.assign(Error('no '+path),{status:404})):Promise.resolve(typeof r==='function'?r():(r&&r.data!==undefined?r:{data:r,meta:{}}));},
    post(path,body,opts){return record('POST',path,body,opts);},
    patch(path,body,opts){return record('PATCH',path,body,opts);},
    put(path,body,opts){return record('PUT',path,body,opts);},
    del(path,body,opts){return record('DELETE',path,body,opts);},
    newIdempotencyKey:()=>'idem-1'
  };
  c.COMMONS_BUILD={mode};
  c.CommonsSession={me:{id:'me',display_name:'我',handle:'me',level:2}};
  c.routes=routes;
  c.window=c;c.self=c;
  vm.createContext(c);
  return c;
}
'''

DETAIL = r'''
(async()=>{
 const post={id:'t1',title:'怎么接回复',content:{body:'主楼正文在这里'},author:{id:'p1',display_name:'甲',level:3},created_at:'2026-01-01T00:00:00.000Z',mine:{saved:false,useful:false}};
 const c=context('live','#/threads/t1');
 c.routes['/content/objects/t1']=post;
 c.routes['/content/objects/t1/replies']={data:[],meta:{}};
 vm.runInContext(source('thread'),c);
 c.pageHTML=c.CommonsThread.routes.threads();
 c.CommonsThread.mount();
 await tick();
 assert.ok(c.pageHTML.includes('主楼正文在这里'),'main body');
 assert.ok(c.pageHTML.includes('怎么接回复'),'title');
 assert.ok(c.pageHTML.includes('甲'),'author');
 assert.ok(c.pageHTML.includes('还没有回复，来说第一句。'),'empty replies copy');
 assert.ok(!c.pageHTML.includes('暂无可见讨论'),'old empty gone');
 assert.ok(c.pageHTML.includes('data-th-live-form="draft"'),'compose');
 assert.ok(c.pageHTML.includes('>发布<'),'send');
 assert.ok(c.pageHTML.includes('>有用<') && c.pageHTML.includes('>收藏<') && c.pageHTML.includes('>举报<') && c.pageHTML.includes('>回复<'),'acts');
 const liveRoot={closest(s){return s==='[data-thread-live]'?this:null}};
 const ta={value:'第一句回复',closest(s){return s==='[data-th-live-form="draft"]'?this:null}};
 c.document.dispatchEvent('input',{target:ta});
 const send={getAttribute:n=>n==='data-th-act'?'send':'',dataset:{},closest(s){return s==='[data-th-act]'?this:s==='[data-thread-live]'?liveRoot:null}};
 c.document.dispatchEvent('click',{target:send,preventDefault(){}});
 await tick();
 const reply=c.posts.find(p=>p.method==='POST'&&p.path==='/content/objects/t1/replies');
 assert.ok(reply,'posts reply');
 assert.deepEqual(reply.body,{body:'第一句回复'});
 assert.ok(reply.opts.idempotencyKey);
 const report={getAttribute:n=>n==='data-th-act'?'report':'',dataset:{id:'t1'},closest(s){return s==='[data-th-act]'?this:s==='[data-thread-live]'?liveRoot:null}};
 c.document.dispatchEvent('click',{target:report,preventDefault(){}});
 await tick();
 const gov=c.posts.find(p=>p.path==='/governance/reports');
 assert.ok(gov,'posts report');
 assert.deepEqual(gov.body,{target_id:'t1',reason_code:'other',note:''});
 console.log('DETAIL_PASS body compose reply report empty copy');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

NESTED = r'''
(async()=>{
 const post={id:'t1',title:'串',content:{body:'楼'},author:{id:'p1',display_name:'甲',level:2},created_at:'2026-01-01T00:00:00.000Z',mine:{}};
 const reply={id:'r1',authorId:'me',author:{id:'me',display_name:'我',level:2},body:'旧文',createdAt:'2026-01-01T01:00:00.000Z',status:'ok',etag:'"v1-p0"',reply_to:null,quote:null};
 const c=context('live','#/threads/t1');
 c.routes['/content/objects/t1']=post;
 c.routes['/content/objects/t1/replies']={data:[reply],meta:{}};
 vm.runInContext(source('thread'),c);
 c.CommonsThread.mount();
 await tick();
 assert.ok(c.pageHTML.includes('旧文'),'reply body');
 assert.ok(c.pageHTML.includes('>编辑<'),'own reply editable');
 const liveRoot={closest(s){return s==='[data-thread-live]'?this:null}};
 const edit={getAttribute:n=>n==='data-th-act'?'edit':'',dataset:{id:'r1'},closest(s){return s==='[data-th-act]'?this:s==='[data-thread-live]'?liveRoot:null}};
 c.document.dispatchEvent('click',{target:edit,preventDefault(){}});
 await tick();
 const ta={value:'改过了',closest(s){return s==='[data-th-live-form="draft"]'?this:null}};
 c.document.dispatchEvent('input',{target:ta});
 const send={getAttribute:n=>n==='data-th-act'?'send':'',dataset:{},closest(s){return s==='[data-th-act]'?this:s==='[data-thread-live]'?liveRoot:null}};
 c.document.dispatchEvent('click',{target:send,preventDefault(){}});
 await tick();
 const patch=c.posts.find(p=>p.method==='PATCH'&&p.path==='/content/replies/r1');
 assert.ok(patch,'patches reply');
 assert.deepEqual(patch.body,{body:'改过了'});
 assert.equal(patch.opts.ifMatch,'"v1-p0"');
 const f=context('live','#/threads/t1');
 f.routes['/content/objects/t1']=post;
 f.routes['/content/objects/t1/replies']={data:[Object.assign({},reply)],meta:{}};
 f.routes['PATCH /content/replies/r1']=()=>Promise.reject(Object.assign(Error('冲突'),{status:412}));
 vm.runInContext(source('thread'),f);
 f.CommonsThread.mount();
 await tick();
 const fRoot={closest(s){return s==='[data-thread-live]'?this:null}};
 f.document.dispatchEvent('click',{target:{getAttribute:n=>n==='data-th-act'?'edit':'',dataset:{id:'r1'},closest(s){return s==='[data-th-act]'?this:s==='[data-thread-live]'?fRoot:null}},preventDefault(){}});
 await tick();
 f.document.dispatchEvent('input',{target:{value:'再改',closest(s){return s==='[data-th-live-form="draft"]'?this:null}}});
 f.document.dispatchEvent('click',{target:{getAttribute:n=>n==='data-th-act'?'send':'',dataset:{},closest(s){return s==='[data-th-act]'?this:s==='[data-thread-live]'?fRoot:null}},preventDefault(){}});
 await tick();
 assert.ok(f.pageHTML.includes('内容已被改过，请刷新'),'412 copy');
 assert.ok(f.pageHTML.includes('再改'),'keeps draft');
 console.log('NESTED_PASS edit if-match and 412');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

INDEX = r'''
(async()=>{
 const c=context('live','#/threads');
 c.routes['/content/feed']={data:[{id:'t9',title:'列表帖',excerpt:'摘要一句',author:{id:'p1',display_name:'乙'},created_at:'2026-01-03T00:00:00.000Z'}],meta:{}};
 vm.runInContext(source('thread'),c);
 c.CommonsThread.mount();
 await tick();
 assert.ok(c.pageHTML.includes('列表帖'),'list title');
 assert.ok(c.pageHTML.includes('摘要一句'),'list excerpt');
 assert.ok(c.pageHTML.includes('乙'),'list author');
 assert.ok(c.pageHTML.includes('#/threads/t9'),'list link');
 assert.ok(!c.pageHTML.includes('暂无可见讨论'));
 console.log('INDEX_PASS feed list');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class Lg6bR12ThreadLive(unittest.TestCase):
    def test_live_page_wires_detail_compose_and_empty_copy(self):
        text = (PREVIEW / 'thread.js').read_text(encoding='utf-8')
        self.assertIn("还没有回复，来说第一句。", text)
        self.assertNotIn('暂无可见讨论', text)
        self.assertIn("post('/content/objects/'", text)
        self.assertIn("'/replies'", text)
        self.assertIn("patch('/content/replies/'", text)
        self.assertIn('ifMatch', text)
        self.assertIn('内容已被改过，请刷新', text)
        self.assertIn("get('/content/feed'", text)
        self.assertIn("post('/governance/reports'", text)
        self.assertIn('data-th-live-form="draft"', text)
        self.assertNotIn("get('/objects'", text)
        css = (PREVIEW / 'thread.css').read_text(encoding='utf-8')
        self.assertIn('[data-thread-live]', css)
        self.assertIn('overflow-wrap:anywhere', css)

    def test_demo_compose_and_lab_untouched(self):
        text = (PREVIEW / 'thread.js').read_text(encoding='utf-8')
        demo = text.split('function composeHTML(st)')[1].split('function listHTML')[0]
        self.assertIn('写一条评论，回车发送，Shift+回车换行', demo)
        self.assertIn("data-th-act=\"send\"", demo)
        self.assertIn('模拟新消息', text.split('function labPage()')[1].split('function paintLabChrome')[0])

    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def test_live_detail_vm_posts_reply_and_report(self):
        self.run_node(DETAIL)

    def test_live_edit_vm_sends_if_match(self):
        self.run_node(NESTED)

    def test_live_index_vm_uses_feed(self):
        self.run_node(INDEX)
