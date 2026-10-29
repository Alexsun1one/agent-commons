"""LG-8A R15 · social.js / hot.js / tools.js：非 POST 写走 CommonsAPI、请求中禁用、私信失败有反馈、热点建讨论先确认。

离线 VM：mock CommonsAPI，断言 method + path + body + 幂等键；没有任何裸 fetch。
BEFORE_R15 是 R15 前的这三个文件（docs/evidence/LG-8A/before-r15/），反跑必须失败。
"""
from __future__ import annotations

import subprocess
import unittest

from tests.test_lg8a_r13_members_teams import COMMON, ROOT

BEFORE_R15 = ROOT / 'docs' / 'evidence' / 'LG-8A' / 'before-r15'

SOCIAL = r'''
function socialCtx(){
  const c=context({hash:'#/friends',rootSel:'data-soc-root'});
  c.rootNode.dataset.socRoot='friends';
  c.document.querySelectorAll=s=>s.includes('data-soc-root')?[c.rootNode]:[];
  c.Commons.modal=()=>{};c.Commons.closeModal=()=>{};c.queueMicrotask=()=>{};
  c.CommonsAPI.me=()=>Promise.resolve({id:'me-1',handle:'me',display_name:'我'});
  c.routes['GET /social/me']={data:{prefs:{},counts:{}},meta:{}};
  c.routes['GET /social/groups']={data:{items:[],categories:{}},meta:{}};
  c.routes['GET /social/suggestions']={data:{items:[]},meta:{}};
  c.routes['GET /social/relations']={data:[],meta:{}};
  c.routes['GET /social/feed']={data:{items:[]},meta:{}};
  c.fetch=()=>{c.rawFetch=(c.rawFetch||0)+1;return Promise.reject(new TypeError('Failed to fetch'));};
  vm.runInContext(source('social'),c);
  c.CommonsSocial.mount();
  return c;
}
const socBtn=(act,id,value)=>btn('[data-soc-act]',{socAct:act,id:id||'',value:value||''},{
  isConnected:true,tagName:'BUTTON',removeAttribute(){},setAttribute(){}});
'''

FOLLOW_PENDING = SOCIAL + r'''
(async()=>{
 const c=socialCtx(); await tick();
 let release;
 c.routes['PUT /social/follows/alice']=()=>new Promise(r=>{release=()=>r({data:{}});});
 const b=socBtn('follow','alice');
 click(c,b); await tick();
 let puts=find(c,'PUT','/social/follows/alice');
 assert.equal(puts.length,1,'PUT goes through CommonsAPI.put');
 assert.ok(puts[0].opts.idempotencyKey,'idempotency key');
 assert.equal(b.disabled,true,'button disabled while pending');
 click(c,b); click(c,socBtn('follow','alice')); await tick();
 assert.equal(find(c,'PUT','/social/follows/alice').length,1,'no second request while pending');
 const loadsBefore=find(c,'GET','/social/relations').length;
 release(); await tick();
 assert.equal(b.disabled,false,'button released after reload');
 assert.ok(find(c,'GET','/social/relations').length>loadsBefore,'reloaded after success');
 assert.ok(c.toasts.some(t=>t.includes('已关注')),'success toast');
 assert.ok(!c.rawFetch,'no raw fetch');
 console.log('FOLLOW_PENDING_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

METHODS = SOCIAL + r'''
(async()=>{
 const cases=[
  ['unfollow','alice','DELETE','/social/follows/alice'],
  ['star','alice','PUT','/social/stars/alice'],
  ['mute','alice','PUT','/social/mutes/alice'],
  ['unmute','alice','DELETE','/social/mutes/alice'],
  ['block-confirm','alice','PUT','/social/blocks/alice'],
  ['unblock','alice','DELETE','/social/blocks/alice'],
  ['post-delete-confirm','p9','DELETE','/social/posts/p9'],
  ['suggest-toggle','','PUT','/social/me/prefs']
 ];
 for(const [act,id,method,path] of cases){
  const c=socialCtx(); await tick();
  click(c,socBtn(act,id)); await tick();
  const hit=find(c,method,path);
  assert.equal(hit.length,1,act+' -> '+method+' '+path);
  assert.ok(hit[0].opts.idempotencyKey,act+' idempotency key');
  assert.deepEqual(hit[0].body,act==='suggest-toggle'?hit[0].body:{},act+' body');
  assert.ok(!c.rawFetch,act+' no raw fetch');
 }
 console.log('METHODS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

ERRORS = SOCIAL + r'''
(async()=>{
 const cases=[
  [Object.assign(new Error('服务器说：今天关注太多了'),{status:429,code:'rate_limited'}),'今天关注太多了'],
  [Object.assign(new Error('x'),{status:501,code:'capability_unavailable'}),'这个功能还没开放'],
  [Object.assign(new Error('x'),{status:501}),'这个功能还没开放'],
  [Object.assign(new Error('网络连接失败，请稍后再试'),{status:0,code:'network_error'}),'网络连接失败，请稍后再试'],
  [Object.assign(new Error('服务器返回了无法识别的错误'),{status:502,code:'http_502'}),'服务器返回了无法识别的错误']
 ];
 for(const [err,want] of cases){
  const c=socialCtx(); await tick();
  c.routes['PUT /social/follows/alice']=err;
  const b=socBtn('follow','alice');
  click(c,b); await tick();
  assert.ok(c.toasts.some(t=>t.includes(want)),'toast '+want+' got '+JSON.stringify(c.toasts));
  assert.ok(!c.toasts.some(t=>/Failed to fetch|SyntaxError|Unexpected token/.test(t)),'no raw English error');
  assert.equal(b.disabled,false,'button re-enabled after failure');
  click(c,socBtn('follow','alice')); await tick();
  assert.equal(find(c,'PUT','/social/follows/alice').length,2,'can retry after failure');
 }
 console.log('ERRORS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

DM = SOCIAL + r'''
(async()=>{
 let c=socialCtx(); await tick();
 c.CommonsDM.open=x=>{c.dm.push(x);return Promise.reject(Object.assign(new Error('私信暂时用不了'),{status:503}));};
 let b=socBtn('dm','alice');
 click(c,b); await tick();
 assert.equal(c.dm.length,1,'dm open attempted');
 assert.ok(c.toasts.some(t=>t.includes('私信暂时用不了')),'failure toast '+JSON.stringify(c.toasts));
 assert.equal(b.disabled,false,'dm button re-enabled');
 c=socialCtx(); await tick();
 c.CommonsDM.open=()=>Promise.reject(Object.assign(new Error('x'),{status:501,code:'capability_unavailable'}));
 b=socBtn('dm','alice'); click(c,b); await tick();
 assert.ok(c.toasts.some(t=>t.includes('这个功能还没开放')),'501 mapped');
 c=socialCtx(); await tick();
 b=socBtn('dm','alice'); click(c,b); await tick();
 assert.equal(c.dm.length,1,'dm opened');
 assert.equal(c.toasts.length,0,'no toast on success');
 assert.equal(b.disabled,false);
 console.log('DM_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

HOT = r'''
process.on('unhandledRejection',()=>{});
function hotCtx(events){
  const c=context({hash:'#/hot',rootSel:'data-hot'});
  c.routes['GET /feed/events']={data:{events,directions:[],sources:[]},meta:{}};
  c.routes['GET /feed/digest']=new Error('x');
  c.routes['GET /feed/subscriptions']={data:{directions:[]},meta:{}};
  c.rootNode.contains=()=>true;
  vm.runInContext(source('hot'),c);
  c.CommonsHot.mount();
  return c;
}
function actionsBox(){
  return {html:'',inserted:0,querySelector(s){return /discuss-confirm/.test(s)&&this.html?{focus(){}}:(/data-hot-confirm/.test(s)&&this.html?{}:null);},
    insertAdjacentHTML(pos,html){this.html+=html;this.inserted++;}};
}
const hotBtn=(act,id,closest)=>btn('[data-hot-act]',{hotAct:act,id},{
  closest(s){return s==='[data-hot-act]'?this:(closest&&closest[s])||null;}});
'''

HOT_CONFIRM = HOT + r'''
(async()=>{
 const c=hotCtx([{id:'e1',title:'Evt',title_zh:'事件',summary_zh:'摘要',related:{}}]); await tick();
 const box=actionsBox();
 click(c,hotBtn('discuss','e1',{'.hot-actions':box})); await tick();
 assert.equal(find(c,'POST','/objects').length+find(c,'POST','/content/hot-discussions/e1').length,0,'first click must not create anything');
 assert.equal(box.inserted,1,'confirm shown');
 assert.ok(box.html.includes('会以你的名义发起一篇讨论'),'confirm copy');
 click(c,hotBtn('discuss','e1',{'.hot-actions':box})); await tick();
 assert.equal(box.inserted,1,'no second confirm panel');
 const key=/data-key="([^"]+)"/.exec(box.html)[1];
 let release;
 c.routes['POST /content/hot-discussions/e1']=()=>new Promise(r=>{release=()=>r({data:{id:'d77',created:true}});});
 const ok=btn('x',{},{}), cancel=btn('x',{},{});
 let removed=0;
 const panel={dataset:{key},remove(){removed++;},querySelectorAll:()=>[ok,cancel]};
 const confirm=hotBtn('discuss-confirm','e1',{'[data-hot-confirm]':panel});
 Object.assign(confirm,{closest(s){return s==='[data-hot-act]'?confirm:s==='[data-hot-confirm]'?panel:null;}});
 click(c,confirm); await tick();
 let posts=find(c,'POST','/content/hot-discussions/e1');
 assert.equal(posts.length,1,'created after confirm');
 assert.equal(posts[0].opts.idempotencyKey,key,'idempotency key from the confirm panel');
 assert.equal(posts[0].body.title,'事件');
 assert.equal(find(c,'POST','/objects').length,0,'never a bare /objects any more');
 assert.equal(ok.disabled&&cancel.disabled,true,'buttons disabled while pending');
 confirm.disabled=true;
 click(c,confirm); await tick();
 assert.equal(find(c,'POST','/content/hot-discussions/e1').length,1,'no second POST while pending');
 release(); await tick();
 assert.equal(c.location.hash,'#/threads/d77','navigates to the new thread');
 console.log('HOT_CONFIRM_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

HOT_CANCEL_ERROR = HOT + r'''
(async()=>{
 const c=hotCtx([{id:'e1',title:'Evt',related:{}}]); await tick();
 let removed=0;
 const panel={dataset:{key:'K'},remove(){removed++;},querySelectorAll:()=>[]};
 const cancel=hotBtn('discuss-cancel','e1');
 Object.assign(cancel,{closest(s){return s==='[data-hot-act]'?cancel:s==='[data-hot-confirm]'?panel:null;}});
 click(c,cancel); await tick();
 assert.equal(removed,1,'cancel closes panel');
 assert.equal(find(c,'POST','/objects').length+find(c,'POST','/content/hot-discussions/e1').length,0,'cancel creates nothing');
 const a=btn('x',{},{}), b=btn('x',{},{});
 const panel2={dataset:{key:'K2'},remove(){},querySelectorAll:()=>[a,b]};
 const go=hotBtn('discuss-confirm','e1');
 Object.assign(go,{closest(s){return s==='[data-hot-act]'?go:s==='[data-hot-confirm]'?panel2:null;}});
 c.routes['POST /content/hot-discussions/e1']=Object.assign(new Error('x'),{status:501,code:'capability_unavailable'});
 click(c,go); await tick();
 assert.ok(c.toasts.some(t=>t.includes('这个功能还没开放')),'501 mapped');
 assert.equal(a.disabled||b.disabled,false,'buttons back after failure');
 c.routes['POST /content/hot-discussions/e1']=Object.assign(new Error('服务器说：讨论太多了'),{status:429});
 click(c,go); await tick();
 assert.ok(c.toasts.some(t=>t.includes('讨论太多了')),'server message');
 console.log('HOT_CANCEL_ERROR_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

HOT_EXISTING = HOT + r'''
(async()=>{
 const c=hotCtx([{id:'e1',title:'Evt',related:{discussion:{id:'d5'}}}]); await tick();
 click(c,hotBtn('discuss','e1',{'.hot-actions':actionsBox()})); await tick();
 assert.equal(c.location.hash,'#/threads/d5','existing discussion opens directly');
 assert.equal(find(c,'POST','/objects').length,0);
 console.log('HOT_EXISTING_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

TOOLS = r'''
(async()=>{
 const c=context({hash:'#/tool/codex',rootSel:'tools-page'});
 c.routes['GET /tools/codex']={data:{slug:'codex',name:'Codex',vendor:'x',category:'编程 Agent',price_tier:'免费',official_url:'https://x.example',summary:'s',tags:[],use_count:1,month_new_count:0,rating:{median:null,count:0},reviews:[{id:'r1',rating:5,body:'好用',helpful_count:1,author:{handle:'bob',display_name:'鲍勃'}}],mine:null,trend:[],related:{}},meta:{}};
 vm.runInContext(source('tools'),c);
 c.CommonsTools.mount();
 await tick();
 let release;
 c.routes['POST /tools/reviews/r1/helpful']=()=>new Promise(r=>{release=()=>r({data:{}});});
 const b=btn('[data-tools-act]',{toolsAct:'helpful',id:'r1'});
 click(c,b); await tick();
 assert.equal(find(c,'POST','/tools/reviews/r1/helpful').length,1,'helpful POST');
 assert.equal(b.disabled,true,'disabled while pending');
 click(c,b); await tick();
 assert.equal(find(c,'POST','/tools/reviews/r1/helpful').length,1,'no second POST while pending');
 release(); await tick();
 const b2=btn('[data-tools-act]',{toolsAct:'helpful',id:'r1'});
 c.routes['POST /tools/reviews/r1/helpful']=Object.assign(new Error('服务器说：已经点过了'),{status:409});
 click(c,b2); await tick();
 assert.equal(b2.disabled,false,'re-enabled after failure');
 assert.ok(c.toasts.some(t=>t.includes('已经点过了')),'server message');
 console.log('TOOLS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def run(script, before=False):
    args = ['node', '-e', COMMON + script, str(ROOT)] + ([str(BEFORE_R15)] if before else [])
    return subprocess.run(args, capture_output=True, text=True, timeout=120)


CASES = {
    'follow_pending': (FOLLOW_PENDING, 'FOLLOW_PENDING_PASS'),
    'methods': (METHODS, 'METHODS_PASS'),
    'errors': (ERRORS, 'ERRORS_PASS'),
    'dm': (DM, 'DM_PASS'),
    'hot_confirm': (HOT_CONFIRM, 'HOT_CONFIRM_PASS'),
    'hot_cancel_error': (HOT_CANCEL_ERROR, 'HOT_CANCEL_ERROR_PASS'),
    'hot_existing': (HOT_EXISTING, 'HOT_EXISTING_PASS'),
    'tools': (TOOLS, 'TOOLS_PASS'),
}
# 不依赖改动的回归场景，改前代码也应通过
UNCHANGED = {'hot_existing'}


class Lg8aR15Writes(unittest.TestCase):
    def test_current_code_passes(self):
        for name, (script, marker) in CASES.items():
            with self.subTest(name):
                r = run(script)
                self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
                self.assertIn(marker, r.stdout)

    def test_fails_on_old_code(self):
        for name, (script, _marker) in CASES.items():
            if name in UNCHANGED:
                continue
            with self.subTest(name):
                self.assertNotEqual(run(script, before=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
