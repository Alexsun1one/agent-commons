"""LG-6B R10 · 真实模式写操作不许假成功。"""
from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'

HTML_ON = re.compile(
    r'''\bon(?:click|dblclick|error|load|change|submit|input|keyup|keydown|keypress|focus|blur|mouse\w+|pointer\w+|touch\w+)\s*=\s*["']''',
    re.I,
)
OWNED = [
    'market.js', 'bounty.js', 'thread.js', 'agentchat.js', 'library.js', 'tools.js',
    'kb.js', 'hot.js', 'editor.js', 'social.js', 'dm.js', 'notify.js', 'orgs.js',
    'people.js', 'buddies.js', 'contributions.js', 'connect.js', 'avatar.js',
    'invite.js', 'announce.js', 'account.js',
]

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const source=name=>fs.readFileSync(root+'/preview/'+name+'.js','utf8');
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){(events[type]||[]).forEach(f=>f(ev))}}}
function context(mode){
  const posts=[],writes=[],toasts=[];
  const rootNode={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],contains:()=>true};
  const c=Object.assign(eventTarget(),{
    console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
    AbortController,setTimeout,clearTimeout,fetch:()=>Promise.reject(Error('no fetch')),
    location:{hash:'#/market/mk1',replace(){},assign(){}},
    matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
    posts,writes,toasts,rootNode
  });
  c.document=Object.assign(eventTarget(),{
    activeElement:null,
    querySelector:s=>s==='[data-mt-root]'||s==='[data-org-root]'||s==='[data-notify-root]'?rootNode:null,
    querySelectorAll:()=>[],
    body:{classList:{add(){},remove(){},toggle(){}}}
  });
  c.Commons={
    read:(k,fb)=>fb,write:(k,v)=>{writes.push({k,v});return true;},toast:m=>toasts.push(m),
    refresh(){},go(r){c.location.hash='#/'+r;},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#')
  };
  const routes={};
  c.CommonsAPI={
    mode,
    get(path){const r=routes[path];return r===undefined?Promise.reject(Object.assign(Error('no '+path),{status:404})):Promise.resolve({data:typeof r==='function'?r():r,meta:{}});},
    post(path,body,opts){posts.push({method:'POST',path,body:body||{},opts:opts||{}});const r=routes['POST '+path];if(r===undefined)return Promise.resolve({data:{id:'new-1',wanted:true,followed:true,consentMetering:true}});if(typeof r==='function')return r(body,opts);return r;},
    patch(path,body,opts){posts.push({method:'PATCH',path,body:body||{},opts:opts||{}});return Promise.resolve({data:{}});},
    newIdempotencyKey:()=>'idem-1'
  };
  c.routes=routes;
  c.window=c;c.self=c;
  vm.createContext(c);
  return c;
}
'''

MARKET = r'''
(async()=>{
 const listing={id:'mk1',category:'sell',status:'active',title:'旧显示器',body:'能用',author:'p2',mine:false,wanted:false,createdAt:'2026-10-01'};
 const c=context('live');
 c.routes['/market/meta']={categories:[{id:'sell',label:'闲置',fields:['price'],required:[]}],field_labels:{price:'价格'},status_labels:{active:'在售'},report_reasons:[{id:'spam',label:'垃圾'}],people:[]};
 c.routes['/market/listings']=[listing];
 c.routes['/market/listings/mk1']=Object.assign({body:'能用'},listing);
 vm.runInContext(source('market'),c);
 c.location.hash='#/market/mk1';
 c.CommonsMarket.mount();
 await tick();
 const wantBtn={disabled:false,textContent:'我想要',getAttribute:n=>n==='data-mt-act'?'want':n==='data-id'?'mk1':'',dataset:{mtAct:'want',id:'mk1'},closest(s){return s==='[data-mt-act]'?this:null}};
 c.document.dispatchEvent('click',{target:wantBtn,preventDefault(){}});
 await tick();
 assert.equal(c.posts.length,1,'want posts once');
 assert.equal(c.posts[0].path,'/market/listings/mk1/want');
 assert.ok(c.posts[0].opts.idempotencyKey,'want sends idempotencyKey');
 assert.equal(c.writes.length,0,'want does not Commons.write');
 assert.ok(c.toasts.includes('已记下。先留言，再决定怎么联系。'));
 // fail rolls back
 const f=context('live');
 f.routes['/market/meta']=c.routes['/market/meta'];
 f.routes['/market/listings']=[Object.assign({},listing)];
 f.routes['/market/listings/mk1']=Object.assign({},listing,{body:'能用'});
 f.routes['POST /market/listings/mk1/want']=()=>Promise.reject(Object.assign(Error('冲突'),{code:'state_conflict'}));
 vm.runInContext(source('market'),f);
 f.CommonsMarket.mount();
 await tick();
 const btn={disabled:false,textContent:'我想要',getAttribute:n=>n==='data-mt-act'?'want':n==='data-id'?'mk1':'',dataset:{mtAct:'want',id:'mk1'},closest(s){return s==='[data-mt-act]'?this:null}};
 f.document.dispatchEvent('click',{target:btn,preventDefault(){}});
 await tick();
 assert.ok(f.toasts.some(t=>String(t).includes('冲突')||String(t).includes('没有记下')),'fail toasts');
 assert.equal(btn.textContent,'我想要','fail restores label');
 assert.equal(f.writes.length,0);
 // demo still writes locally
 const d=context('demo');
 vm.runInContext(source('market'),d);
 d.CommonsMarket.mount();
 const demoBtn={disabled:false,textContent:'我想要',getAttribute:n=>n==='data-mt-act'?'want':n==='data-id'?'mk1':'',dataset:{mtAct:'want',id:'mk1'},closest(s){return s==='[data-mt-act]'?this:null}};
 d.document.dispatchEvent('click',{target:demoBtn,preventDefault(){}});
 await tick();
 assert.equal(d.posts.length,0,'demo does not post');
 console.log('MARKET_PASS want live posts, fail rollback, demo local');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MARKET_PUBLISH = r'''
(async()=>{
 const c=context('live');
 c.location.hash='#/market/new';
 c.FormData=function(f){this.m=f.values;};
 c.FormData.prototype.has=function(k){return k in this.m};
 c.FormData.prototype.get=function(k){return this.m[k]};
 c.routes['/market/meta']={categories:[{id:'sell',label:'闲置',active:'在售',fields:['price'],required:[]}],field_labels:{price:'价格'},status_labels:{active:'在售'},report_reasons:[],people:[]};
 c.routes['/market/listings']=[];
 vm.runInContext(source('market'),c);
 c.CommonsMarket.mount();
 await tick();
 const node=(extra)=>Object.assign({disabled:false,checked:false,value:'',dataset:{},getAttribute:()=>'',closest:()=>null,querySelector:()=>null},extra||{});
 const catBtn=node({dataset:{mtAct:'category',category:'sell'},getAttribute:n=>n==='data-mt-act'?'category':n==='data-category'?'sell':'',closest(s){return s==='[data-mt-act]'?this:null}});
 c.document.dispatchEvent('click',{target:catBtn,preventDefault(){}});
 const submitBtn=node();
 const f=node({values:{title:'旧显示器',body:'能用',category:'sell',price:'¥300'},reportValidity:()=>true,
  querySelector:s=>s==='[data-mt-confirm]'?node({checked:true}):s==='[type="submit"]'?submitBtn:null});
 f.closest=s=>s==='[data-mt-form="new"]'?f:null;
 const submit=()=>c.document.dispatchEvent('submit',{target:f,preventDefault(){}});
 submit();
 submit();
 await tick();
 const sent=c.posts.filter(p=>p.method==='POST'&&p.path==='/market/listings');
 assert.equal(sent.length,1,'live publish posts /market/listings once');
 assert.deepEqual(JSON.parse(JSON.stringify(sent[0].body)),{category:'sell',title:'旧显示器',body:'能用',price:'¥300'});
 assert.ok(sent[0].opts.idempotencyKey,'publish sends idempotencyKey');
 assert.equal(c.writes.length,0,'live publish does not write local posts');
 console.log('MARKET_PUBLISH_PASS live publish posts with idempotency key');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

ORGS = r'''
(async()=>{
 const c=context('live');
 c.location.hash='#/orgs/alpha';
 c.routes['/orgs']=[{slug:'alpha',name:'甲',followed:false,intro:'',typeLabel:'实验室',joinPolicy:'apply',members:1,followers:0,activity:1,banner:'',website:'',membersList:[],posts:[],works:[],jobs:[],events:[]}];
 vm.runInContext(source('orgs'),c);
 c.CommonsOrgs.mount();
 await tick();
 const btn={disabled:false,dataset:{orgAct:'follow',value:'alpha'},closest(s){return s==='[data-org-act]'?this:null}};
 c.document.dispatchEvent('click',{target:btn,preventDefault(){}});
 await tick();
 assert.equal(c.posts[0].path,'/orgs/alpha/follow');
 assert.deepEqual(c.posts[0].body,{on:true});
 assert.ok(c.posts[0].opts.idempotencyKey);
 assert.equal(c.writes.length,0,'follow does not write local following');
 console.log('ORGS_PASS follow live posts');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class Lg6bR10Writes(unittest.TestCase):
    def test_owned_js_have_no_html_inline_events(self):
        hits = []
        for name in OWNED:
            text = (PREVIEW / name).read_text(encoding='utf-8')
            for match in HTML_ON.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{name}:{line}:{match.group(0)}')
        self.assertEqual(hits, [])

    def test_market_live_posts_listings_want_status_report(self):
        text = (PREVIEW / 'market.js').read_text(encoding='utf-8')
        self.assertIn("'/want'", text)
        self.assertIn("'/status'", text)
        self.assertIn("'/report'", text)
        self.assertIn('reason_code', text)
        self.assertIn('idempotencyKey', text)
        self.assertIn('这个功能还没开放。管理员还没打开。', text)

    def test_orgs_kb_dm_notify_live_posts(self):
        orgs = (PREVIEW / 'orgs.js').read_text(encoding='utf-8')
        self.assertIn("post('/orgs/'", orgs)
        self.assertIn("'/follow'", orgs)
        self.assertIn("'/join'", orgs)
        self.assertIn("post('/orgs'", orgs)
        kb = (PREVIEW / 'kb.js').read_text(encoding='utf-8')
        self.assertIn("post('/kb/problems/'", kb)
        self.assertIn("'/verify'", kb)
        self.assertNotIn('writeVerifications(saved)', kb.split("if (window.CommonsAPI && window.CommonsAPI.mode === 'live')")[1].split('var saved = readVerifications()')[0])
        dm = (PREVIEW / 'dm.js').read_text(encoding='utf-8')
        self.assertIn("'/recall'", dm)
        self.assertIn("'/delete'", dm)
        self.assertIn("'/report'", dm)
        notify = (PREVIEW / 'notify.js').read_text(encoding='utf-8')
        self.assertIn("post('/notify/notifications/'", notify)
        self.assertIn('/notify/notifications/read-all', notify)
        self.assertIn("put('/notify/preferences'", notify)
        self.assertNotIn("fetch('/api/notify/preferences'", notify)

    def test_no_api_actions_are_closed_not_fake_success(self):
        social = (PREVIEW / 'social.js').read_text(encoding='utf-8')
        greet = social.split("case 'greet':")[1].split("case 'suggest-toggle'")[0]
        live_greet = greet.split('if (isLive())')[1].split('st.greeted')[0]
        self.assertIn('/social/blessings/', live_greet)
        self.assertNotIn('这个功能还没开放', live_greet)
        self.assertNotIn('已送祝福', live_greet)
        thread = (PREVIEW / 'thread.js').read_text(encoding='utf-8')
        self.assertIn("/governance/reports", thread)
        self.assertIn("reason_code: 'other'", thread)
        buddies = (PREVIEW / 'buddies.js').read_text(encoding='utf-8')
        self.assertIn("if (isLive()) { api().toast('这个功能还没开放'); return true; }", buddies)
        contrib = (PREVIEW / 'contributions.js').read_text(encoding='utf-8')
        self.assertIn("这个功能还没开放", contrib)
        self.assertIn('if(isLive())return closed();', contrib)

    def test_demo_market_still_writes_local(self):
        text = (PREVIEW / 'market.js').read_text(encoding='utf-8')
        self.assertIn("write('posts', posts)", text)
        self.assertIn("write('wanted', rows)", text)
        self.assertIn("write('reports', list)", text)
        self.assertIn('已发布。交易在站外进行。', text)
        self.assertIn('已提交，治理员会看到。', text)

    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def test_market_publish_vm_posts_listings_with_idempotency_key(self):
        self.run_node(MARKET_PUBLISH)

    def test_market_want_vm_posts_and_rolls_back(self):
        self.run_node(MARKET)

    def test_orgs_follow_vm_posts(self):
        self.run_node(ORGS)
