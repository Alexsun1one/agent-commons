"""LG-6B R13 · 评论、阅读页、编辑器、私信已读、热点讨论。"""
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
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){(events[type]||[]).forEach(f=>f(ev))}}}
function context(mode,hash){
  const posts=[],gets=[],toasts=[],writes=[];
  const store={};
  const rootNode={innerHTML:'',nodeType:1,dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},
    setAttribute(){},getAttribute(){return ''},closest(){return null},querySelector:()=>null,querySelectorAll:()=>[],
    contains(){return true},addEventListener(){},removeEventListener(){},appendChild(){},remove(){}};
  const c=Object.assign(eventTarget(),{
    console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
    AbortController,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},requestAnimationFrame:f=>setTimeout(f,0),
    cancelAnimationFrame:clearTimeout,CSS:{escape:s=>String(s)},
    fetch:()=>Promise.reject(Error('no fetch')),
    location:{protocol:'https:',hash:hash||'#/',replace(){},assign(){}},
    matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
    posts,gets,toasts,writes,rootNode,store,pageHTML:''
  });
  c.document=Object.assign(eventTarget(),{
    activeElement:null,
    getElementById:()=>null,
    querySelector:()=>null,
    querySelectorAll:()=>[],
    createElement:()=>({innerHTML:'',firstElementChild:null,classList:{add(){}},setAttribute(){},append(){},appendChild(){}}),
    body:{classList:{add(){},remove(){},toggle(){}},appendChild(){}}
  });
  c.Commons={
    read:(k,fb)=>k in store?store[k]:fb,write:(k,v)=>{store[k]=v;writes.push({k,v});return true;},
    toast:m=>toasts.push(m),
    refresh(){},
    go(r){c.location.hash='#/'+r;},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#')
  };
  const routes={};
  const record=(method,path,body,opts)=>{posts.push({method,path,body:body||{},opts:opts||{}});const r=routes[method+' '+path];if(r===undefined)return Promise.resolve({data:{id:'new-1',count:0,body:body&&body.body,author:{id:'me',display_name:'我',level:2},createdAt:'2026-01-02T00:00:00.000Z',status:'ok',etag:'"v1-p0"'},meta:{}});if(typeof r==='function')return r(body,opts);return r;};
  c.CommonsAPI={
    mode,
    get(path){gets.push(path);const r=routes[path];return r===undefined?Promise.reject(Object.assign(Error('no '+path),{status:404})):Promise.resolve(typeof r==='function'?r():(r&&r.data!==undefined&&r.meta!==undefined?r:{data:r,meta:{}}));},
    post(path,body,opts){return record('POST',path,body,opts);},
    patch(path,body,opts){return record('PATCH',path,body,opts);},
    put(path,body,opts){return record('PUT',path,body,opts);},
    del(path,body,opts){return record('DELETE',path,body,opts);},
    me(){return Promise.resolve({id:'me',display_name:'我',handle:'me',level:2});},
    newIdempotencyKey:()=>'idem-1'
  };
  c.COMMONS_BUILD={mode};
  c.CommonsSession={me:{id:'me',display_name:'我',handle:'me',level:2}};
  c.routes=routes;
  c.window=c;c.self=c;c.globalThis=c;
  vm.createContext(c);
  return c;
}
'''

EMBED = r'''
(async()=>{
 const host={nodeType:1,innerHTML:'',attrs:{},dataset:{},
  setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||'';},
  closest(s){return s==='[data-thread-live]'?this:null},
  querySelector(s){return /data-th-live-form/.test(s)?{value:this._draft||'第一句评论',closest(x){return x==='[data-th-live-form="draft"]'?this:null}}:null;},
  querySelectorAll:()=>[]};
 const c=context('live','#/social');
 c.routes['/content/objects/p9/replies']={data:[],meta:{}};
 vm.runInContext(source('thread'),c);
 c.CommonsThread.mount(host,{targetId:'p9',repliesOnly:true});
 await tick();
 assert.ok(host.innerHTML.includes('还没有回复，来说第一句。'),'embed empty copy');
 assert.ok(host.innerHTML.includes('data-th-live-form="draft"'),'embed compose');
 assert.equal(host.attrs['data-th-live-target'],'p9');
 host._draft='第一句评论';
 const send={getAttribute:n=>n==='data-th-act'?'send':'',dataset:{},closest(s){return s==='[data-th-act]'?this:s==='[data-thread-live]'?host:null}};
 c.document.dispatchEvent('click',{target:send,preventDefault(){}});
 await tick();
 const reply=c.posts.find(p=>p.method==='POST'&&p.path==='/content/objects/p9/replies');
 assert.ok(reply,'embed posts reply');
 assert.deepEqual(reply.body,{body:'第一句评论'});
 assert.ok(reply.opts.idempotencyKey);
 console.log('EMBED_PASS live thread embed GET/POST replies');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

READER = r'''
(async()=>{
 const followBtn={dataset:{rdrAct:'follow',tag:'RAG'},pressed:'false',disabled:false,textContent:'RAG · 关注',
  getAttribute(n){return n==='aria-pressed'?this.pressed:'';},setAttribute(n,v){if(n==='aria-pressed')this.pressed=String(v);},
  closest(s){return s==='[data-rdr-act]'?this:null}};
 const saveBtn={dataset:{rdrAct:'save'},pressed:'false',disabled:false,
  getAttribute(n){return n==='aria-pressed'?this.pressed:'';},setAttribute(n,v){if(n==='aria-pressed')this.pressed=String(v);},
  querySelector:s=>s==='span'?{textContent:'收藏'}:null,closest(s){return s==='[data-rdr-act]'?this:null}};
 const usefulBtn={dataset:{rdrAct:'useful'},pressed:'false',disabled:false,
  getAttribute(n){return n==='aria-pressed'?this.pressed:'';},setAttribute(n,v){if(n==='aria-pressed')this.pressed=String(v);},
  querySelector:s=>s==='span'?{textContent:'有用'}:null,closest(s){return s==='[data-rdr-act]'?this:null}};
 const reactBtn={dataset:{rdrAct:'react',kind:'up'},pressed:'false',disabled:false,
  getAttribute(n){return n==='aria-pressed'?this.pressed:'';},setAttribute(n,v){if(n==='aria-pressed')this.pressed=String(v);},
  querySelector:s=>s==='b'?{textContent:'0'}:null,closest(s){return s==='[data-rdr-act]'?this:null}};
 const threadHost={nodeType:1,innerHTML:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||'';},
  closest(s){return s==='[data-thread-live]'?this:null},querySelector:()=>null,querySelectorAll:()=>[]};
 const root={matches:s=>s==='[data-rdr-root]',dataset:{rdrId:'obj1'},contains(){return true},
  querySelector(s){if(s==='[data-rdr-bar]')return{style:{}};if(s==='[data-rdr-body]')return{getBoundingClientRect:()=>({height:80,top:0})};if(s==='[data-rdr-thread]')return threadHost;return null;},
  querySelectorAll(s){if(s==='[data-rdr-act="follow"]')return[followBtn];if(s==='[data-rdr-act="toc"]')return[];if(s==='.rdr-body .rdr-h')return[];if(s==='[data-rdr-html]')return[];return[];},
  addEventListener(t,f){if(t==='click')this._click=f;},removeEventListener(){}};
 const c=context('live','#/read/obj1');
 c.routes['/content/objects/obj1/replies']={data:[],meta:{}};
 c.routes['/content/follows']=['Agent'];
 vm.runInContext(source('thread'),c);
 vm.runInContext(source('reader'),c);
 const html=c.CommonsReader.html({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'正文'}]}]},{
  id:'obj1',title:'阅读',summary:'',kind:'knowledge',author:{id:'p1',name:'甲',handle:'jia',level:2},
  publishedAt:'2026-01-01T00:00:00.000Z',visibility:{scope:'members'},aigc:'none',saved:false,sample:false,
  useful:false,tags:['RAG'],reactions:{counts:{},mine:{}},related:[]
 });
 assert.ok(html.includes('data-rdr-act="save"'),'save btn');
 assert.ok(html.includes('data-rdr-act="useful"'),'useful btn');
 assert.ok(html.includes('data-rdr-act="react"'),'react btn');
 assert.ok(html.includes('data-rdr-act="follow"')&&html.includes('RAG'),'follow tag');
 assert.ok(html.includes('data-rdr-thread'),'thread host');
 assert.ok(!html.includes('已收藏到本机'),'no local save copy');
 assert.ok(!html.includes('佐证 0 人'),'hide zero corroboration');
 c.CommonsReader.mount(root,{});
 await tick();
 assert.ok(c.gets.includes('/content/objects/obj1/replies'),'mounts live thread');
 assert.ok(c.gets.includes('/content/follows'),'loads follows');
 const click=act=>{root._click({target:act,preventDefault(){}});};
 click(saveBtn); await tick();
 const save=c.posts.find(p=>p.path==='/content/objects/obj1/save');
 assert.ok(save&&save.method==='PUT'&&save.opts.idempotencyKey,'save PUT');
 click(usefulBtn); await tick();
 const useful=c.posts.find(p=>p.path==='/content/objects/obj1/useful');
 assert.ok(useful&&useful.method==='POST','useful POST');
 click(reactBtn); await tick();
 const react=c.posts.find(p=>p.path==='/content/objects/obj1/reactions/up');
 assert.ok(react&&react.method==='PUT','react PUT');
 click(followBtn); await tick();
 const fol=c.posts.find(p=>p.path==='/content/follows/RAG');
 assert.ok(fol&&fol.method==='PUT','follow PUT');
 console.log('READER_PASS save react useful follow thread');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

EDITOR = r'''
(async()=>{
 const c=context('live','#/read/obj1');
 c.routes['/content/objects/obj1']={id:'obj1',title:'自己的文章',type:'knowledge',author:{id:'me',display_name:'我',handle:'me',level:2},
  content:{doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'一段正文'}]}]},tags:['RAG'],aigc:'none'},
  visibility:'members',min_level:1,published_at:'2026-01-01T00:00:00.000Z',stats:{reactions:{}},mine:{saved:false,useful:false,reactions:{}},etag:'"e1"'};
 c.Commons.refresh=()=>{c.pageHTML=c.CommonsEditorPage.routes.read();};
 vm.runInContext(source('reader'),c);
 vm.runInContext(source('editor'),c);
 c.CommonsEditorPage.mount();
 await tick();
 c.pageHTML=c.CommonsEditorPage.routes.read();
 assert.ok(c.pageHTML.includes('自己的文章')||c.pageHTML.includes('一段正文')||c.pageHTML.includes('编辑'),'read rendered');
 assert.ok(c.pageHTML.includes('data-edt-act="edit-live"'),'edit btn');
 assert.ok(c.pageHTML.includes('data-edt-act="withdraw-live"'),'withdraw btn');
 assert.ok(!c.pageHTML.includes('约 860 人'),'no hardcoded members count');
 const ask={hidden:true};
 const startBtn={hidden:false,dataset:{edtAct:'withdraw-live'}};
 const yesBtn={hidden:false,disabled:false,dataset:{edtAct:'withdraw-yes'}};
 const noBtn={hidden:false,disabled:false,dataset:{edtAct:'withdraw-no'}};
 const readRoot={dataset:{id:'obj1'},contains(){return true},addEventListener(t,f){if(t==='click')this._c=f;},removeEventListener(){},
  querySelector(s){if(s==='[data-edt-withdraw-ask]')return ask;if(s==='[data-edt-act="withdraw-live"]')return startBtn;return null;},
  querySelectorAll(s){return /withdraw-yes|withdraw-no/.test(s)?[yesBtn,noBtn]:[];}};
 const prevQS=c.document.querySelector;
 c.document.querySelector=s=>s==='[data-edt-page="read"][data-id]'||s==='[data-edt-page="read"]'?readRoot:(prevQS?prevQS(s):null);
 c.CommonsEditorPage.mount();
 const click=act=>({target:{dataset:{edtAct:act},closest(s){return s==='[data-edt-act]'?this:s==='[data-edt-page="read"]'?readRoot:null}}});
 readRoot._c(click('withdraw-live'));
 await tick();
 assert.ok(!c.posts.some(p=>p.path==='/objects/obj1/withdraw'),'withdraw waits for confirm');
 assert.equal(ask.hidden,false,'ask shown');
 readRoot._c(click('withdraw-yes'));
 await tick();
 const wd=c.posts.find(p=>p.method==='POST'&&p.path==='/objects/obj1/withdraw');
 assert.ok(wd,'withdraw posts after confirm');
 assert.deepEqual(wd.body,{reason_code:'author_request'});
 assert.ok(wd.opts.idempotencyKey);
 assert.ok(yesBtn.disabled&&noBtn.disabled,'withdraw buttons disabled in flight');
 c.location.hash='#/write/obj1';
 c.routes['/objects/obj1']={id:'obj1',title:'自己的文章',type:'knowledge',content:{doc:{type:'doc',content:[{type:'paragraph'}]},aigc:'none'},visibility:'members',min_level:1,etag:'"e1"',acl:[]};
 const node=()=>({style:{},hidden:true,className:'',innerHTML:'',value:'',textContent:'',scrollHeight:24,addEventListener(){},querySelector:()=>node(),querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}},contains(){return true}});
 const edtRoot=Object.assign(node(),{querySelector:()=>node()});
 const host={innerHTML:'',appendChild(){return this;},querySelector:s=>s==='[data-edt]'?edtRoot:null};
 const writePage={addEventListener(){},removeEventListener(){}};
 c.document.querySelector=s=>{
  if(s==='[data-edt-page="write"] [data-edt-host]')return host;
  if(s==='[data-edt-page="write"]')return writePage;
  if(s==='[data-edt-live-error]')return {textContent:''};
  return null;
 };
 c.Commons.refresh=()=>{c.pageHTML=c.CommonsEditorPage.routes.write();};
 c.CommonsEditorPage.destroy();
 c.CommonsEditorPage.mount();
 await tick();
 c.CommonsEditorPage.mount();
 await tick();
 c.pageHTML=c.CommonsEditorPage.routes.write();
 assert.ok(c.pageHTML.includes('编辑'),'write edit title');
 assert.ok(c.gets.includes('/objects/obj1'),'loads object for patch');
 const inst=c.CommonsEditorPage.instance;
 assert.ok(inst&&typeof inst.opts.onPublish==='function','write instance');
 await inst.opts.onPublish({title:'自己的文章',kind:'knowledge',doc:{type:'doc',content:[]},aigc:'none',visibility:{scope:'members',level:null,space:null,people:[]}});
 await tick();
 const patch=c.posts.find(p=>p.method==='PATCH'&&p.path==='/objects/obj1');
 assert.ok(patch,'PATCH /objects/{id}');
 assert.equal(patch.body.title,'自己的文章');
 assert.equal(patch.body.visibility,'members');
 assert.ok(patch.body.content&&patch.body.content.doc,'patch body has doc');
 assert.equal(patch.body.content.aigc,'none');
 assert.equal(patch.opts.ifMatch,'"e1"','If-Match etag');
 assert.ok(patch.opts.idempotencyKey,'patch idempotency');
 console.log('EDITOR_PASS own edit/withdraw no 860');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

DM = r'''
(async()=>{
 const root={querySelector:()=>null,addEventListener(){},removeEventListener(){}};
 const c=context('live','#/messages/th1');
 c.document.querySelector=s=>/data-dm-root|dm-top-badge/.test(s)?root:null;
 c.routes['/dm/threads']={items:[{id:'th1',unread:2,participants:[{id:'me',name:'我'},{id:'p2',name:'乙'}],last_message:{text:'hi'},request_state:'accepted'}]};
 c.routes['/dm/settings']={contact_policy:'following'};
 c.routes['/dm/threads/th1/messages']={items:[{id:'m1',seq:3,text:'hi',created_at:'2026-01-01T00:00:00.000Z',sender_id:'p2'}]};
 c.routes['/dm/unread-count']={count:7};
 vm.runInContext(source('dm'),c);
 const firstBadge=c.CommonsDM.badge();
 c.CommonsDM.mount();
 await tick();
 const read=c.posts.find(p=>p.method==='POST'&&p.path==='/dm/threads/th1/read');
 assert.ok(read,'marks read');
 assert.deepEqual(read.body,{seq:3});
 assert.ok(read.opts.idempotencyKey);
 assert.ok(c.gets.includes('/dm/unread-count'),'gets unread-count');
  const badge=c.CommonsDM.badge();
  assert.ok(badge.includes('7'),'badge uses unread-count');
  assert.ok(!firstBadge.includes('约'),'badge has no hardcoded copy');
  c.CommonsDM.destroy();
  console.log('DM_PASS read seq and unread-count');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

HOT = r'''
(async()=>{
 const hotRoot={contains(){return true},querySelector:()=>null,querySelectorAll:()=>[]};
 const c=context('live','#/hot');
 c.document.querySelector=s=>s==='[data-hot]'?hotRoot:null;
 c.routes['/feed/events']={events:[{id:'e1',title:'某模型发布',title_zh:'某模型发布',related:{},direction:'model',sources:[],series:[],heat:1,first_seen:'2026-01-01T00:00:00.000Z',site:{}}],directions:[],sources:[]};
 c.routes['/feed/digest']={};
 c.routes['/feed/subscriptions']={directions:[]};
 c.Commons.refresh=()=>{c.pageHTML=c.CommonsHot.routes.hot();};
 vm.runInContext(source('hot'),c);
 c.CommonsHot.mount();
 await tick();
 const confirmBtn={dataset:{hotAct:'discuss-confirm',id:'e1'},disabled:false,focus(){}};
 const actions={_has:false,dataset:{key:'idem-1'},querySelector(s){if(s==='[data-hot-confirm]')return this._has?this:null;if(s==='[data-hot-act="discuss-confirm"]')return confirmBtn;return null;},querySelectorAll(){return [confirmBtn];},insertAdjacentHTML(){this._has=true;},closest(s){return s==='[data-hot-confirm]'?this:null}};
 const btn={dataset:{hotAct:'discuss',id:'e1'},closest(s){return s==='[data-hot-act]'?this:s==='.hot-actions'?actions:null}};
 c.document.dispatchEvent('click',{target:btn,preventDefault(){}});
 await tick();
 assert.ok(!c.posts.some(p=>p.path==='/objects'||p.path.startsWith('/content/hot-discussions/')),'discuss waits for confirm');
 confirmBtn.closest=s=>s==='[data-hot-act]'?confirmBtn:s==='[data-hot-confirm]'?actions:null;
 c.document.dispatchEvent('click',{target:confirmBtn,preventDefault(){}});
 await tick();
 const created=c.posts.find(p=>p.method==='POST'&&p.path==='/content/hot-discussions/e1');
 assert.ok(created,'creates discussion through the per-event endpoint');
 assert.ok(!c.posts.some(p=>p.path==='/objects'),'no longer posts a bare /objects');
 assert.equal(created.body.title,'某模型发布');
 assert.ok(created.opts.idempotencyKey);
 assert.equal(c.location.hash,'#/threads/new-1');
 const c2=context('live','#/hot');
 const hot2={contains(){return true},querySelector:()=>null,querySelectorAll:()=>[]};
 c2.document.querySelector=s=>s==='[data-hot]'?hot2:null;
 c2.routes['/feed/events']={events:[{id:'e2',title:'已有讨论',related:{discussion:{id:'d9',title:'串'}},sources:[],series:[],heat:1,first_seen:'2026-01-01T00:00:00.000Z',site:{}}],directions:[],sources:[]};
 c2.routes['/feed/digest']={};
 c2.routes['/feed/subscriptions']={directions:[]};
 c2.Commons.refresh=()=>{c2.pageHTML=c2.CommonsHot.routes.hot();};
 vm.runInContext(source('hot'),c2);
 c2.CommonsHot.mount();
 await tick();
 const btn2={dataset:{hotAct:'discuss',id:'e2'},closest(s){return s==='[data-hot-act]'?this:null}};
 c2.document.dispatchEvent('click',{target:btn2,preventDefault(){}});
 await tick();
 assert.equal(c2.location.hash,'#/threads/d9');
 assert.ok(!c2.posts.some(p=>p.path==='/objects'||p.path.startsWith('/content/hot-discussions/')),'existing does not create');
 console.log('HOT_PASS discuss create or jump');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class Lg6bR13Wires(unittest.TestCase):
    def test_source_wires_live_paths(self):
        social = (PREVIEW / 'social.js').read_text(encoding='utf-8')
        self.assertIn('repliesOnly: true', social)
        self.assertIn("CommonsThread.mount(host, { targetId: id, repliesOnly: true })", social)
        reader = (PREVIEW / 'reader.js').read_text(encoding='utf-8')
        self.assertIn("put(path, {}, apiOpts())", reader)
        self.assertIn("'/content/objects/'", reader)
        self.assertIn("'/save'", reader)
        self.assertIn("'/useful'", reader)
        self.assertIn("'/reactions/'", reader)
        self.assertIn("'/content/follows/'", reader)
        self.assertIn('data-rdr-thread', reader)
        self.assertIn('已收藏到本机', reader)
        editor = (PREVIEW / 'editor.js').read_text(encoding='utf-8')
        who = editor.split('function whoText(inst)')[1].split('function paintWho')[0]
        self.assertIn('if (!isLive())', who)
        self.assertIn('约 860 人', who)
        self.assertIn("patch('/objects/'", editor)
        self.assertIn("'/withdraw'", editor)
        self.assertIn("reason_code: 'author_request'", editor)
        self.assertIn('edit-live', editor)
        dm = (PREVIEW / 'dm.js').read_text(encoding='utf-8')
        self.assertIn("'/dm/threads/'", dm)
        self.assertIn("'/read'", dm)
        self.assertIn("get('/dm/unread-count')", dm)
        hot = (PREVIEW / 'hot.js').read_text(encoding='utf-8')
        # R17-C：建帖改走按事件去重的接口（同一热点只有一篇），确认步骤保留
        self.assertIn("post('/content/hot-discussions/'", hot)
        self.assertNotIn("post('/objects'", hot)
        self.assertIn('discuss-confirm', hot)
        self.assertIn('#/threads/', hot)
        self.assertNotIn('讨论串还没接上', hot)
        thread = (PREVIEW / 'thread.js').read_text(encoding='utf-8')
        self.assertIn('repliesOnly', thread)
        self.assertIn('mountLiveEmbed', thread)
        self.assertIn('data-th-live-target', thread)

    def test_demo_copy_untouched(self):
        editor = (PREVIEW / 'editor.js').read_text(encoding='utf-8')
        who = editor.split('function whoText(inst)')[1].split('function paintWho')[0]
        self.assertIn("extra = '（约 860 人）'", who)
        reader = (PREVIEW / 'reader.js').read_text(encoding='utf-8')
        demo = reader.split('function toggleSave(btn)')[1].split('function toggleUseful')[0]
        self.assertIn('已收藏到本机', demo)
        hot = (PREVIEW / 'hot.js').read_text(encoding='utf-8')
        self.assertIn('讨论串暂未接入。', hot)
        social = (PREVIEW / 'social.js').read_text(encoding='utf-8')
        self.assertIn('targetId: `social:${id}`', social)

    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def test_thread_embed_vm_posts_reply(self):
        self.run_node(EMBED)

    def test_reader_vm_save_react_useful_follow(self):
        self.run_node(READER)

    def test_editor_vm_withdraw_and_edit_route(self):
        self.run_node(EDITOR)

    def test_dm_vm_read_and_unread_count(self):
        self.run_node(DM)

    def test_hot_vm_discuss_create_or_jump(self):
        self.run_node(HOT)
