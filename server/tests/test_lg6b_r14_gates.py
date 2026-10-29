"""LG-6B R14 · 真实模式入口走 CommonsSession.can，演示文案不动。"""
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
function sessionCan(c, allowed){
  const set=new Set(allowed||[]);
  c.CommonsSession={me:{id:'me',display_name:'我',handle:'me',level:1},can:a=>set.has(a)};
}
function context(mode,hash){
  const posts=[],gets=[],toasts=[],writes=[],modals=[];
  const store={};
  const rootNode={innerHTML:'',nodeType:1,dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},
    setAttribute(){},getAttribute(){return ''},closest(){return null},querySelector:()=>null,querySelectorAll:()=>[],
    contains(){return true},addEventListener(){},removeEventListener(){},appendChild(){},remove(){},isConnected:true};
  const c=Object.assign(eventTarget(),{
    console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
    AbortController,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},requestAnimationFrame:f=>setTimeout(f,0),
    cancelAnimationFrame:clearTimeout,CSS:{escape:s=>String(s)},
    fetch:()=>Promise.reject(Error('no fetch')),
    location:{protocol:'https:',hash:hash||'#/',replace(){},assign(){}},
    matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
    posts,gets,toasts,writes,modals,rootNode,store,pageHTML:''
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
    go(r){c.location.hash='#/'+r;},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#'),
    modal(title,html){modals.push({title,html});c.modalHTML=html;},
    closeModal(){}
  };
  const routes={};
  const record=(method,path,body,opts)=>{posts.push({method,path,body:body||{},opts:opts||{}});const r=routes[method+' '+path];if(r===undefined)return Promise.resolve({data:{id:'new-1',count:0,body:body&&body.body,text:body&&body.text,author:{id:'me',display_name:'我',level:2},createdAt:'2026-01-02T00:00:00.000Z',status:'ok',etag:'"v1-p0"'},meta:{}});if(typeof r==='function')return r(body,opts);return r;};
  c.CommonsAPI={
    mode,
    get(path){gets.push(path);const r=routes[path];return r===undefined?Promise.reject(Object.assign(Error('no '+path),{status:404})):Promise.resolve(typeof r==='function'?r():(r&&r.data!==undefined&&r.meta!==undefined?r:{data:r,meta:{}}));},
    post(path,body,opts){return record('POST',path,body,opts);},
    patch(path,body,opts){return record('PATCH',path,body,opts);},
    put(path,body,opts){return record('PUT',path,body,opts);},
    del(path,body,opts){return record('DELETE',path,body,opts);},
    me(){return Promise.resolve({id:'me',display_name:'我',handle:'me',level:1});},
    newIdempotencyKey:()=>'idem-1'
  };
  c.COMMONS_BUILD={mode};
  c.CommonsSession={me:{id:'me',display_name:'我',handle:'me',level:1},can:()=>true};
  c.CommonsReader={esc:s=>String(s==null?'':s)};
  c.routes=routes;
  c.window=c;c.self=c;c.globalThis=c;
  vm.createContext(c);
  return c;
}
function wireSocial(c,root){
  c.document.querySelector=s=>{
    if(s==='#main [data-soc-root]'||s==='#main [data-soc-root="groups"]')return root;
    return null;
  };
  c.document.querySelectorAll=s=>{
    if(s==='#main [data-soc-root]')return[root];
    return [];
  };
  c.routes['/social/relations']={items:[]};
  c.routes['/social/me']={prefs:{},counts:{}};
  c.routes['/social/groups']={items:[],categories:{}};
  c.routes['/social/suggestions']={items:[]};
}
function wireBountySquare(c,root){
  c.document.querySelector=s=>s==='[data-bounty]'?root:null;
  c.routes['/bounty/list']=[];
  c.routes['/bounty/rules']={caps:{1:20,2:50},cosmetics:[],task_kinds:[{id:'bug',label:'报 bug'}]};
  c.routes['/bounty/wallet']={available:10,held:0};
  c.routes['/objects']=[];
}
'''

SOCIAL = r'''
(async()=>{
 const denied=context('live','#/groups');
 sessionCan(denied,[]);
 const deniedRoot={innerHTML:'',dataset:{socRoot:'groups'},querySelector:()=>null,querySelectorAll:()=>[],contains(){return true}};
 wireSocial(denied,deniedRoot);
 vm.runInContext(source('social'),denied);
 denied.CommonsSocial.mount();
 await tick();
 const no=denied.CommonsSocial.routes.groups();
 assert.ok(no.includes('data-soc-act="group-create"'),'create stays');
 assert.ok(/data-soc-act="group-create"[^>]*disabled/.test(no),'denied disabled');
 assert.ok(no.includes('你现在的等级还不能建小组'),'denied note');
 assert.ok(no.includes('href="#/growth"'),'growth link');
 assert.ok(!no.includes('L3 起可以建小组'),'no hardcoded L3 in live');

 const allowed=context('live','#/groups');
 sessionCan(allowed,['social.group.create']);
 const allowedRoot={innerHTML:'',dataset:{socRoot:'groups'},querySelector:()=>null,querySelectorAll:()=>[],contains(){return true}};
 wireSocial(allowed,allowedRoot);
 vm.runInContext(source('social'),allowed);
 allowed.CommonsSocial.mount();
 await tick();
 const yes=allowed.CommonsSocial.routes.groups();
 assert.ok(yes.includes('data-soc-act="group-create"'),'allowed create');
 assert.ok(!/data-soc-act="group-create"[^>]*disabled/.test(yes),'allowed enabled');
 assert.ok(!yes.includes('你现在的等级还不能建小组'),'no gate when allowed');

 const demo=context('demo','#/groups');
 vm.runInContext(source('social'),demo);
 const d=demo.CommonsSocial.routes.groups();
 assert.ok(d.includes('title="L3 起可以建小组"'),'demo L3 title stays');
 assert.ok(/data-soc-act="group-create"[^>]*disabled/.test(d),'demo L1 still locked');
 assert.ok(!d.includes('看看怎么升级'),'demo has no live gate');
 console.log('SOCIAL_PASS group create can()');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

BOUNTY = r'''
(async()=>{
 const denied=context('live','#/bounties');
 sessionCan(denied,[]);
 const deniedRoot={innerHTML:'',dataset:{},isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
 wireBountySquare(denied,deniedRoot);
 vm.runInContext(source('bounty'),denied);
 denied.location.hash='#/bounties';
 deniedRoot.innerHTML=denied.CommonsBounty.routes.bounties();
 denied.CommonsBounty.mount();
 await tick();
 const no=deniedRoot.innerHTML;
 assert.ok(no.includes('data-bty-act="publish"'),'publish stays');
 assert.ok(/data-bty-act="publish"[^>]*disabled/.test(no),'publish disabled');
 assert.ok(no.includes('你现在的等级还不能发悬赏'),'publish note');
 assert.ok(no.includes('href="#/growth"'),'growth link');
 denied.document.dispatchEvent('click',{target:{dataset:{btyAct:'publish'},closest:s=>s==='[data-bty-act]'?{dataset:{btyAct:'publish',id:''}}:null},preventDefault(){}});
 await tick();
 assert.equal(denied.modals.length,0,'disabled publish does not open');

 const allowed=context('live','#/bounties');
 sessionCan(allowed,['bounty.create.help','bounty.create.promo']);
 const allowedRoot={innerHTML:'',dataset:{},isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
 wireBountySquare(allowed,allowedRoot);
 vm.runInContext(source('bounty'),allowed);
 allowedRoot.innerHTML=allowed.CommonsBounty.routes.bounties();
 allowed.CommonsBounty.mount();
 await tick();
 const yes=allowedRoot.innerHTML;
 assert.ok(yes.includes('data-bty-act="publish"'),'allowed publish');
 assert.ok(!/data-bty-act="publish"[^>]*disabled/.test(yes.split('data-bty-act="publish"')[1].slice(0,80)),'allowed enabled');
 assert.ok(!yes.includes('你现在的等级还不能发悬赏'),'no gate when allowed');
 allowed.document.dispatchEvent('click',{target:{dataset:{btyAct:'publish'},closest:s=>s==='[data-bty-act]'?{dataset:{btyAct:'publish',id:''}}:null},preventDefault(){}});
 await tick();
 assert.ok(allowed.modalHTML,'opens publish');
 assert.ok(allowed.modalHTML.includes('data-bty-act="pub-kind"'),'kind switch');
 assert.ok(!allowed.modalHTML.includes('L2 及以上才能发悬赏和推广'),'live form has no L2 copy');

 const helpOnly=context('live','#/bounties');
 sessionCan(helpOnly,['bounty.create.help']);
 const helpRoot={innerHTML:'',dataset:{},isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
 wireBountySquare(helpOnly,helpRoot);
 vm.runInContext(source('bounty'),helpOnly);
 helpRoot.innerHTML=helpOnly.CommonsBounty.routes.bounties();
 helpOnly.CommonsBounty.mount();
 await tick();
 helpOnly.document.dispatchEvent('click',{target:{dataset:{btyAct:'publish'},closest:s=>s==='[data-bty-act]'?{dataset:{btyAct:'publish',id:''}}:null},preventDefault(){}});
 await tick();
 assert.ok(helpOnly.modalHTML.includes('data-id="promo"') && helpOnly.modalHTML.includes('disabled'),'promo kind disabled');
 assert.ok(/data-id="help"[^>]*aria-pressed="true"/.test(helpOnly.modalHTML),'defaults to help');

 const topDenied=context('live','#/bounties/b1');
 sessionCan(topDenied,['bounty.create.help']);
 const topRoot={innerHTML:'',dataset:{},isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
 topDenied.document.querySelector=s=>s==='[data-bounty]'?topRoot:null;
 topDenied.routes['/bounty/b1']={id:'b1',kind:'help',status:'active',state:'open',mine:false,credits:20,contributors:1,my_stake:0,held:20,deadline_at:'2026-12-01T00:00:00.000Z',object:{id:'p1',title:'求助'},owner:{id:'p2',display_name:'乙'},tags:[],answers:[]};
 topDenied.routes['/bounty/rules']={caps:{1:20},cosmetics:[],task_kinds:[]};
 topDenied.routes['/objects/p1']={id:'p1',content:{body:'正文'},author:{id:'p2',display_name:'乙'}};
 topDenied.routes['/objects']=[];
 vm.runInContext(source('bounty'),topDenied);
 topRoot.innerHTML=topDenied.CommonsBounty.routes.bounties();
 topDenied.CommonsBounty.mount();
 await tick();
 assert.ok(/data-bty-act="topup"[^>]*disabled/.test(topRoot.innerHTML),'topup disabled');
 assert.ok(topRoot.innerHTML.includes('你现在的等级还不能追加赏金'),'topup note');

 const topOk=context('live','#/bounties/b1');
 sessionCan(topOk,['bounty.topup']);
 const topOkRoot={innerHTML:'',dataset:{},isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
 topOk.document.querySelector=s=>s==='[data-bounty]'?topOkRoot:null;
 topOk.routes['/bounty/b1']=topDenied.routes['/bounty/b1'];
 topOk.routes['/bounty/rules']=topDenied.routes['/bounty/rules'];
 topOk.routes['/objects/p1']=topDenied.routes['/objects/p1'];
 topOk.routes['/objects']=[];
 vm.runInContext(source('bounty'),topOk);
 topOkRoot.innerHTML=topOk.CommonsBounty.routes.bounties();
 topOk.CommonsBounty.mount();
 await tick();
 assert.ok(topOkRoot.innerHTML.includes('data-bty-act="topup"'),'topup present');
 assert.ok(!/data-bty-act="topup"[^>]*disabled/.test(topOkRoot.innerHTML),'topup enabled');
 assert.ok(!topOkRoot.innerHTML.includes('你现在的等级还不能追加赏金'),'no topup note');

 const closed=context('live','#/bounties');
 sessionCan(closed,['bounty.create.help']);
 const closedRoot={innerHTML:'',dataset:{},isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
 closed.document.querySelector=s=>s==='[data-bounty]'?closedRoot:null;
 closed.routes['/bounty/list']=()=>{const e=Object.assign(Error('capability_unavailable'),{status:501,code:'capability_unavailable'});throw e;};
 closed.CommonsAPI.get=function(path){closed.gets.push(path);if(path==='/bounty/list')return Promise.reject(Object.assign(Error('capability_unavailable'),{status:501,code:'capability_unavailable'}));return Promise.resolve({data:{},meta:{}});};
 vm.runInContext(source('bounty'),closed);
 closedRoot.innerHTML=closed.CommonsBounty.routes.bounties();
 closed.CommonsBounty.mount();
 await tick();
 assert.ok(closedRoot.innerHTML.includes('这个功能还没开放'),'501 stays closed');

 const demo=context('demo','#/bounties');
 vm.runInContext(source('bounty'),demo);
 const demoHtml=demo.CommonsBounty.routes.bounties();
 assert.ok(demoHtml.includes('data-bty-act="publish"'),'demo publish');
 assert.ok(!demoHtml.includes('看看怎么升级'),'demo square has no live gate');
 demo.document.querySelector=s=>s==='[data-bounty]'?demo.rootNode:null;
 demo.rootNode.innerHTML=demoHtml;
 demo.rootNode.isConnected=true;
 demo.CommonsBounty.mount();
 demo.document.dispatchEvent('click',{target:{dataset:{btyAct:'publish'},closest:s=>s==='[data-bty-act]'?{dataset:{btyAct:'publish',id:''}}:null},preventDefault(){}});
 await tick();
 assert.ok(demo.modalHTML.includes('L2 及以上才能发悬赏和推广。先去攒几次合格的「有用」吧。'),'demo L2 copy stays');
 console.log('BOUNTY_PASS publish/topup can()');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

EDITOR = r'''
(async()=>{
 const denied=context('live','#/write');
 sessionCan(denied,['object.create.discussion']);
 vm.runInContext(source('editor'),denied);
 const no=denied.CommonsEditorPage.routes.write();
 assert.ok(no.includes('data-edt-act="write-kind"'),'type picker');
 assert.ok(no.includes('data-kind="discussion"') && no.includes('aria-pressed="true"'),'defaults to discussion');
 assert.ok(/data-kind="knowledge"[^>]*disabled/.test(no),'knowledge disabled');
 assert.ok(/data-kind="work"[^>]*disabled/.test(no),'work disabled');
 assert.ok(no.includes('你现在的等级还不能发这种内容'),'type note');
 assert.ok(no.includes('href="#/growth"'),'growth link');

 const allowed=context('live','#/write');
 sessionCan(allowed,['object.create.discussion','object.create.knowledge','object.create.work','object.create.skill','object.create.prompt','object.create.component_lib','object.create.pattern','object.create.agent_card']);
 vm.runInContext(source('editor'),allowed);
 const yes=allowed.CommonsEditorPage.routes.write();
 assert.ok(yes.includes('data-kind="discussion"'),'discussion present');
 assert.ok(!yes.includes('disabled'),'all types enabled');
 assert.ok(!yes.includes('你现在的等级还不能发这种内容'),'no note when all allowed');

 const demo=context('demo','#/write');
 vm.runInContext(source('editor'),demo);
 const d=demo.CommonsEditorPage.routes.write();
 assert.ok(!d.includes('data-edt-act="write-kind"'),'demo write has no type picker');
 assert.ok(d.includes('示例'),'demo pill stays');
 console.log('EDITOR_PASS write types can()');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

DM = r'''
(async()=>{
 const badgeNode={replaceWith(){}};
 const root={innerHTML:'',className:'',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(t,f){this['on'+t]=f;},removeEventListener(){}};
 const c=context('live','#/messages/th1');
 c.document.querySelector=s=>/data-dm-root/.test(s)?root:/dm-top-badge/.test(s)?badgeNode:null;
 c.routes['/dm/threads']={items:[{id:'th1',unread:0,participants:[{id:'me',name:'我'},{id:'p2',name:'乙'}],last_message:null,request_state:'accepted',updated_at:'2026-01-01T00:00:00.000Z'}]};
 c.routes['/dm/settings']={contact_policy:'following'};
 c.routes['/dm/threads/th1/messages']={items:[]};
 c.routes['/dm/unread-count']={count:0};
 c.routes['POST /dm/threads/th1/messages']=(body)=>{
  const msg={id:'m2',seq:1,text:body.text,created_at:'2026-01-02T00:00:00.000Z',sender_id:'me'};
  c.routes['/dm/threads/th1/messages']={items:[msg]};
  return Promise.resolve({data:msg,meta:{}});
 };
 vm.runInContext(source('dm'),c);
 c.CommonsDM.mount();
 await tick();
 const before=c.CommonsDM.routes.messages();
 assert.ok(before.includes('还没有消息'),'empty preview before send');
 const form={closest:s=>s==='[data-dm-form]'?form:null,elements:{message:{value:'今晚见'}}};
 root.onsubmit({target:form,preventDefault(){}});
 await tick();
 const after=c.CommonsDM.routes.messages();
 assert.ok(after.includes('今晚见'),'preview follows send');
 assert.ok(!after.includes('还没有消息'),'empty copy gone');
 const sent=c.posts.find(p=>p.method==='POST'&&p.path==='/dm/threads/th1/messages');
 assert.ok(sent&&sent.body.text==='今晚见','posts message');
 c.CommonsDM.destroy();
 console.log('DM_PASS thread preview after send');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class Lg6bR14Gates(unittest.TestCase):
    def test_source_uses_session_can(self):
        social = (PREVIEW / 'social.js').read_text(encoding='utf-8')
        self.assertIn("canDo('social.group.create')", social)
        self.assertIn('你现在的等级还不能建小组', social)
        self.assertIn('href="#/growth"', social)
        self.assertIn('title="L3 起可以建小组"', social)
        bounty = (PREVIEW / 'bounty.js').read_text(encoding='utf-8')
        self.assertIn("canDo('bounty.create.help')", bounty)
        self.assertIn("canDo('bounty.create.promo')", bounty)
        self.assertIn("canDo('bounty.topup')", bounty)
        self.assertNotIn("canDo('bounty.promo.task')", bounty)
        self.assertIn('L2 及以上才能发悬赏和推广。先去攒几次合格的「有用」吧。', bounty)
        self.assertIn("status === 501", bounty)
        self.assertIn('capability_unavailable', bounty)
        editor = (PREVIEW / 'editor.js').read_text(encoding='utf-8')
        self.assertIn('object.create.', editor)
        self.assertIn('write-kind', editor)
        self.assertIn('你现在的等级还不能发这种内容', editor)
        dm = (PREVIEW / 'dm.js').read_text(encoding='utf-8')
        self.assertIn('applyLastMessage', dm)
        self.assertIn('patchThreadPreview', dm)

    def test_demo_copy_untouched(self):
        social = (PREVIEW / 'social.js').read_text(encoding='utf-8')
        self.assertIn('title="L3 起可以建小组"', social)
        self.assertIn('viewer().level >= 3', social)
        bounty = (PREVIEW / 'bounty.js').read_text(encoding='utf-8')
        self.assertIn('L2 及以上才能发悬赏和推广。先去攒几次合格的「有用」吧。', bounty)
        editor = (PREVIEW / 'editor.js').read_text(encoding='utf-8')
        demo = editor.split("function writeRoute()")[1].split("var liveRead")[0]
        self.assertIn("pill outline", demo)
        self.assertIn('写点什么', demo)

    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def test_social_vm_group_create_gate(self):
        self.run_node(SOCIAL)

    def test_bounty_vm_publish_and_topup_gate(self):
        self.run_node(BOUNTY)

    def test_editor_vm_write_types(self):
        self.run_node(EDITOR)

    def test_dm_vm_thread_preview_after_send(self):
        self.run_node(DM)
