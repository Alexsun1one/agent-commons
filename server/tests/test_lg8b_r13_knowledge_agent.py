"""LG-8B R13 · 知识与 Agent：问题库提问/解法/沉淀、资源库详情/搜索/我用过/投稿/编辑、Agent 广场历史/发言/私聊。

离线 VM：mock CommonsAPI，断言真实模式发出的 method + path + body，不写共享数据到 Commons.write，失败会回滚；
演示模式逐字不变（仍读示例、仍写本地、不发请求）。
环境变量 LG8B_PREVIEW 指向别的 preview 目录时，同一批断言用来反跑「改前」副本。
"""
from __future__ import annotations

import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = Path(os.environ.get('LG8B_PREVIEW') or ROOT / 'preview')

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const dir=process.env.LG8B_PREVIEW||(root+'/preview');
const source=name=>fs.readFileSync(dir+'/'+name+'.js','utf8');
const tick=async(n=30)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){[...(events[type]||[])].forEach(f=>f(ev))}}}
function fake(extra){return Object.assign({innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,dataset:{},scrollTop:0,scrollHeight:0,focus(){},setAttribute(){},querySelector:()=>null,querySelectorAll:()=>[],closest(){return null},matches(){return false},contains(){return true}},extra||{});}
function button(attr,dataset){const b=fake({dataset});b.closest=s=>s==='['+attr+']'?b:null;return b;}
function form(selfSel,dataset,values){
  const submit=fake(),note=fake({hidden:true});
  const f=fake({dataset,elements:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{value:v}]))});
  f.closest=s=>s.split(',').map(x=>x.trim()).includes(selfSel)?f:null;
  f.matches=s=>s===selfSel||(selfSel==='[data-kb-form]'&&/^\[data-kb-form/.test(s)&&s.includes(f.dataset.kbForm));
  f.querySelector=s=>s==='[type="submit"]'?submit:(/error/.test(s)?note:null);
  f.submit=submit;f.note=note;return f;
}
function context(mode,hash){
  const log=[],writes=[],toasts=[],modals=[],store={},routes={};
  const c=Object.assign(eventTarget(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
    AbortController,setTimeout,clearTimeout,fetch:()=>Promise.reject(Error('no fetch')),
    location:{protocol:'https:',hash:hash||'#/',replace(){},assign(){}},matchMedia:()=>({matches:true}),
    log,writes,toasts,modals,store,routes,keyN:0});
  c.document=Object.assign(eventTarget(),{activeElement:null,querySelector:()=>null,querySelectorAll:()=>[],body:{classList:{add(){},remove(){}}},createElement:()=>fake()});
  c.Commons={read:(k,fb)=>k in store?store[k]:fb,write:(k,v)=>{store[k]=v;writes.push({k,v});return true},toast:m=>toasts.push(m),
    refresh(){if(c.onRefresh)c.onRefresh()},modal:(t,h)=>{modals.push({title:t,html:h})},closeModal(){c.modalClosed=(c.modalClosed||0)+1},
    icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#')};
  const handle=(method,path,body,opts)=>{
    log.push({method,path,body,opts:opts||{}});
    const key=method+' '+path;
    let r=routes[key];
    if(r===undefined&&method==='GET')r=routes[path];
    if(r===undefined)return Promise.reject(Object.assign(new Error('no route '+key),{status:404,code:'resource_not_found'}));
    if(typeof r==='function')r=r(body,opts);
    return Promise.resolve(r);
  };
  c.CommonsAPI={mode,get:(p,q,o)=>handle('GET',p,q,o),post:(p,b,o)=>handle('POST',p,b,o),patch:(p,b,o)=>handle('PATCH',p,b,o),
    put:(p,b,o)=>handle('PUT',p,b,o),del:(p,b,o)=>handle('DELETE',p,b,o),newIdempotencyKey:()=>'idem-'+(++c.keyN)};
  c.COMMONS_BUILD={mode};
  c.window=c;c.self=c;
  vm.createContext(c);
  return c;
}
const fail=(message,status,code)=>()=>Promise.reject(Object.assign(new Error(message),{status:status||422,code:code||'validation_failed'}));
const posts=(c,path)=>c.log.filter(x=>x.method==='POST'&&x.path===path);
'''

KB_SETUP = r'''
const prob={id:'p1',title:'标题一',phenomenon:'现象一',error_signature:'sig',status:'pending',stale_hint:false,industry_key:'education',
  environments:[{tool_key:'codex',version:'1',system:'mac'}],successful_verifications:0,updated_at:'2026-10-01T00:00:00Z'};
const detail=Object.assign({},prob,{etag:'e1',editable:true,author:{id:'u1',display_name:'某人'},
  solutions:[{root_cause:'根因一',steps:['步骤一','步骤二']}],verification:{success:2,failed:0,distribution:[]},links:[]});
async function kbLive(){
  const c=context('live','#/solved');
  c.routes['/kb/search']={data:[prob]};
  c.routes['/kb/problems/p1']={data:detail};
  const parts={list:fake(),detail:fake(),count:fake(),panel:fake(),capture:fake(),query:fake()};
  const host=fake();
  const map={'[data-kb-list]':parts.list,'[data-kb-detail]':parts.detail,'[data-kb-count]':parts.count,'[data-kb-panel]':parts.panel,'[data-kb-capture]':parts.capture,'[data-kb-query]':parts.query};
  const rootNode=fake({parentNode:host,querySelector:s=>map[s]||null});
  c.document.querySelector=s=>s==='[data-kb]'?rootNode:null;
  vm.runInContext(source('kb'),c);
  const first=c.CommonsKB.routes.solved();
  assert.ok(first.includes('正在读取问题库'));
  c.CommonsKB.mount();
  await tick();
  return {c,parts};
}
const click=(c,act,id)=>c.document.dispatchEvent('click',{target:button('data-kb-act',{kbAct:act,id:id||''}),preventDefault(){}});
const submit=(c,f)=>{let prevented=0;c.document.dispatchEvent('submit',{target:f,preventDefault(){prevented++}});return prevented;};
'''


class Lg8bKnowledgeAgent(unittest.TestCase):
    def run_node(self, script):
        env = dict(os.environ, LG8B_PREVIEW=str(PREVIEW))
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    # ------------------------------------------------------------------ kb.js
    def test_kb_live_lists_details_and_offers_member_actions(self):
        self.run_node(KB_SETUP + r'''
(async()=>{
 const {c,parts}=await kbLive();
 assert.ok(parts.list.innerHTML.includes('标题一'),'list');
 assert.ok(parts.detail.innerHTML.includes('根因一')&&parts.detail.innerHTML.includes('步骤二'),'detail 来自接口');
 assert.ok(parts.detail.innerHTML.includes('data-kb-act="panel-solve"'),'写解法入口');
 assert.ok(parts.detail.innerHTML.includes('data-kb-act="panel-edit"'),'作者可编辑');
 assert.equal(c.log.filter(x=>x.path==='/kb/problems/p1').length,1,'默认选中的问题读详情');
 assert.ok(c.log.every(x=>x.method==='GET'),'读页面不发写请求');
 console.log('_PASS kb-live');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_kb_ask_posts_problem_and_failure_keeps_form(self):
        self.run_node(KB_SETUP + r'''
(async()=>{
 const {c,parts}=await kbLive();
 click(c,'ask-open');
 assert.ok(parts.panel.innerHTML.includes('data-kb-form="ask"'),'提问表单');
 const values={title:'新问题',phenomenon:'打不开',error_signature:'E1',tool_key:'codex',version:'2.0',system:'macOS',industry_key:'education'};
 // 失败：服务器拒绝 → 不提示成功，表单与文字保留，按钮恢复
 c.routes['POST /kb/problems']=fail('标题太短了');
 const bad=form('[data-kb-form]',{kbForm:'ask'},values);
 assert.equal(submit(c,bad),1,'preventDefault');
 assert.equal(bad.submit.disabled,true,'请求中禁用');
 await tick();
 assert.ok(!c.toasts.includes('问题已提交。'),'失败不许说已提交');
 assert.equal(bad.note.textContent,'标题太短了');
 assert.equal(bad.note.hidden,false);
 assert.equal(bad.submit.disabled,false,'按钮恢复');
 // 成功
 c.routes['POST /kb/problems']=()=>({data:Object.assign({},detail,{id:'p2',title:'新问题',etag:'e2'})});
 const good=form('[data-kb-form]',{kbForm:'ask'},values);
 submit(c,good);
 await tick();
 const sent=posts(c,'/kb/problems');
 assert.equal(sent.length,2);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[1].body)),{title:'新问题',phenomenon:'打不开',error_signature:'E1',
   environments:[{tool_key:'codex',version:'2.0',system:'macOS'}],industry_key:'education'});
 assert.ok(/^idem-/.test(sent[1].opts.idempotencyKey),'幂等键');
 assert.ok(c.toasts.includes('问题已提交。'),'服务器确认后才提示');
 assert.ok(parts.list.innerHTML.includes('新问题'),'新问题出现在列表');
 assert.equal(c.writes.filter(w=>/kb\./.test(w.k)).length,0,'不写共享数据到 Commons.write');
 console.log('_PASS kb-ask');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_kb_solution_edit_and_link_hit_their_endpoints(self):
        self.run_node(KB_SETUP + r'''
(async()=>{
 const {c,parts}=await kbLive();
 // 写解法
 click(c,'panel-solve');
 assert.ok(parts.panel.innerHTML.includes('data-kb-form="solve"'));
 const withSolution=Object.assign({},detail,{solutions:[{root_cause:'新根因',steps:['甲']},{root_cause:'根因一',steps:['步骤一']}]});
 c.routes['POST /kb/problems/p1/solutions']=()=>({data:withSolution});
 submit(c,form('[data-kb-form]',{kbForm:'solve',id:'p1'},{root_cause:'新根因',steps:'甲\n\n乙\n'}));
 await tick();
 const solve=posts(c,'/kb/problems/p1/solutions');
 assert.equal(solve.length,1);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(solve[0].body)),{root_cause:'新根因',steps:['甲','乙']});
 assert.ok(solve[0].opts.idempotencyKey);
 assert.ok(c.toasts.includes('解法已提交。'));
 assert.ok(parts.detail.innerHTML.includes('另一种解法'),'多个解法都显示');
 // 编辑：带 If-Match，412 类冲突给出明确提示
 click(c,'panel-edit');
 assert.ok(parts.panel.innerHTML.includes('value="标题一"'),'编辑表单预填');
 c.routes['PATCH /kb/problems/p1']=fail('conflict',412,'version_conflict');
 const conflict=form('[data-kb-form]',{kbForm:'edit',id:'p1'},{title:'改后',phenomenon:'改后现象',error_signature:'s2'});
 submit(c,conflict);
 await tick();
 assert.equal(conflict.note.textContent,'内容已被改过，请刷新。');
 assert.ok(!c.toasts.includes('修改已保存。'));
 c.routes['PATCH /kb/problems/p1']=()=>({data:Object.assign({},detail,{title:'改后',etag:'e9'})});
 submit(c,form('[data-kb-form]',{kbForm:'edit',id:'p1'},{title:'改后',phenomenon:'改后现象',error_signature:'s2'}));
 await tick();
 const patch=c.log.filter(x=>x.method==='PATCH');
 assert.equal(patch.length,2);
 assert.equal(patch[1].opts.ifMatch,'e1');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(patch[1].body)),{title:'改后',phenomenon:'改后现象',error_signature:'s2'});
 assert.ok(c.toasts.includes('修改已保存。'));
 // 关联：列表里要有别的问题可选
 click(c,'panel-link');
 assert.ok(parts.panel.innerHTML.includes('当前列表里没有别的问题'),'只有一条时没得关联');
 console.log('_PASS kb-solve-edit');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_kb_link_uses_other_problem_in_list(self):
        self.run_node(KB_SETUP + r'''
(async()=>{
 const c=context('live','#/solved');
 const other=Object.assign({},prob,{id:'p7',title:'另一条'});
 c.routes['/kb/search']={data:[prob,other]};
 c.routes['/kb/problems/p1']={data:detail};
 const parts={list:fake(),detail:fake(),count:fake(),panel:fake(),capture:fake(),query:fake()};
 const host=fake();
 const map={'[data-kb-list]':parts.list,'[data-kb-detail]':parts.detail,'[data-kb-count]':parts.count,'[data-kb-panel]':parts.panel,'[data-kb-capture]':parts.capture,'[data-kb-query]':parts.query};
 c.document.querySelector=s=>s==='[data-kb]'?fake({parentNode:host,querySelector:s2=>map[s2]||null}):null;
 vm.runInContext(source('kb'),c);
 c.CommonsKB.routes.solved();c.CommonsKB.mount();await tick();
 click(c,'panel-link');
 assert.ok(parts.panel.innerHTML.includes('data-kb-form="link"')&&parts.panel.innerHTML.includes('另一条'));
 c.routes['POST /kb/problems/p1/links']=()=>({data:Object.assign({},detail,{links:[{id:'l1',kind:'related',target_id:'p7',target_title:'另一条'}]})});
 submit(c,form('[data-kb-form]',{kbForm:'link',id:'p1'},{target_id:'p7',kind:'duplicate'}));
 await tick();
 const sent=posts(c,'/kb/problems/p1/links');
 assert.equal(sent.length,1);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[0].body)),{target_id:'p7',kind:'duplicate'});
 assert.ok(sent[0].opts.idempotencyKey);
 assert.ok(c.toasts.includes('关联已提交。'));
 console.log('_PASS kb-link');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_kb_capture_panel_is_live_and_confirms_through_server(self):
        self.run_node(KB_SETUP + r'''
(async()=>{
 const {c,parts}=await kbLive();
 // 初始面板由 view() 渲染；直接触发来源表单
 c.routes['POST /kb/captures']=fail('来源不存在');
 const source1=form('[data-kb-form]',{kbForm:'capture-source'},{source_kind:'bounty',source_id:'b-1',title:'T',phenomenon:'P',error_signature:'E',answer_text:'A'});
 submit(c,source1);
 await tick();
 assert.equal(source1.note.textContent,'来源不存在');
 c.routes['POST /kb/captures']=()=>({data:{id:'cap1',title:'T',phenomenon:'P',error_raw:'E',answer_text:'A'}});
 submit(c,form('[data-kb-form]',{kbForm:'capture-source'},{source_kind:'bounty',source_id:'b-1',title:'T',phenomenon:'P',error_signature:'E',answer_text:'A'}));
 await tick();
 const first=posts(c,'/kb/captures');
 assert.equal(first.length,2);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(first[1].body)),{source_kind:'bounty',source_id:'b-1',title:'T',phenomenon:'P',error_signature:'E',answer_text:'A'});
 assert.ok(parts.capture.innerHTML.includes('data-kb-form="capture-confirm"'),'草稿待确认');
 assert.ok(parts.capture.innerHTML.includes('value="T"'));
 c.routes['POST /kb/captures/cap1/confirm']=()=>({data:Object.assign({},detail,{id:'p3',title:'T',etag:'e3'})});
 submit(c,form('[data-kb-form]',{kbForm:'capture-confirm'},{title:'T2',phenomenon:'P2',error_signature:'E2',root_cause:'C2'}));
 await tick();
 const confirm=posts(c,'/kb/captures/cap1/confirm');
 assert.equal(confirm.length,1);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(confirm[0].body)),{title:'T2',phenomenon:'P2',error_signature:'E2',root_cause:'C2'});
 assert.ok(confirm[0].opts.idempotencyKey);
 assert.ok(parts.capture.innerHTML.includes('问题卡已入库')&&parts.capture.innerHTML.includes('#/solved/p3'));
 assert.ok(c.toasts.includes('问题卡已入库。'));
 assert.ok(!c.toasts.includes('这个功能还没开放'),'沉淀不再是占位');
 console.log('_PASS kb-capture');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_kb_demo_mode_is_unchanged(self):
        self.run_node(KB_SETUP + r'''
(async()=>{
 const c=context('demo','#/solved');
 vm.runInContext(source('kb-sample'),c);
 vm.runInContext(source('kb'),c);
 const html=c.CommonsKB.routes.solved();
 assert.ok(html.includes('示例'),'演示仍有示例标签');
 assert.ok(!html.includes('data-kb-panel')&&!html.includes('提一个问题'),'演示没有真实模式入口');
 assert.ok(html.includes('data-kb-capture')&&html.includes('沉淀为问题卡'));
 const cap=fake();
 const rootNode=fake({parentNode:fake(),querySelector:s=>s==='[data-kb-capture]'?cap:null});
 c.document.querySelector=s=>s==='[data-kb]'?rootNode:null;
 c.CommonsKB.mount();
 click(c,'capture');
 assert.ok(cap.innerHTML.includes('data-kb-form="capture"'));
 let prevented=0;
 c.document.dispatchEvent('submit',{target:form('[data-kb-form]',{kbForm:'capture'},{}),preventDefault(){prevented++}});
 assert.equal(prevented,1);
 assert.ok(c.toasts.includes('问题卡已入库'),'演示仍是演示话术');
 assert.equal(c.log.length,0,'演示不发请求');
 console.log('_PASS kb-demo');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    # ------------------------------------------------------------- library.js
    LIB_SETUP = r'''
const skill={id:'s1',type:'skill',title:'写作助手',author:{id:'u9',display_name:'作者甲'},version:1,etag:'e1',lifecycle:'active',
  category:'写作',tags:['a'],clients_or_stacks:['Codex'],license:'MIT',status:'active',
  examples:[{input:'入',output:'出',comparison_bad:'',comparison_good:'',caption:''}],installs:[{client:'Codex',instructions:'装一下'}],
  content:{purpose:'用来写作',skill_md:'# SKILL\n正文'},usage:{count:3,useful_count:1,mine:null}};
function libLive(hash,session){
  const c=context('live',hash||'#/skills');
  if(session)c.CommonsSession=session;
  c.routes['/library/items']=q=>({data:q&&q.type==='skill'?[skill]:[]});
  const rootNode=Object.assign(eventTarget(),fake({dataset:{route:'skills'}}));
  c.document.querySelector=s=>s==='[data-library-page]'?rootNode:null;
  vm.runInContext(source('library'),c);
  c.onRefresh=()=>{rootNode.innerHTML=c.CommonsLibrary.routes.skills();c.CommonsLibrary.mount();};
  rootNode.innerHTML=c.CommonsLibrary.routes.skills();
  return {c,rootNode};
}
const libClick=(c,act,id,extra)=>{const b=button('data-lib-act',Object.assign({libAct:act,id:id||''},extra||{}));c.document.dispatchEvent('click',{target:b});return b;};
'''

    def test_library_live_renders_real_items_not_title_list(self):
        self.run_node(self.LIB_SETUP + r'''
(async()=>{
 const {c,rootNode}=libLive();
 assert.ok(rootNode.innerHTML.includes('正在读取资源库'));
 c.CommonsLibrary.mount();
 await tick();
 const html=rootNode.innerHTML;
 assert.deepStrictEqual(c.log.filter(x=>x.path==='/library/items').map(x=>x.body.type).sort(),['component_lib','pattern','prompt','skill']);
 assert.ok(html.includes('写作助手')&&html.includes('用来写作')&&html.includes('作者甲'),'列表+详情');
 assert.ok(html.includes('# SKILL'),'完整文件');
 assert.ok(html.includes('装一下'),'安装方法');
 assert.ok(html.includes('我用过 <span>3</span>'),'计数来自接口');
 assert.ok(!html.includes('示例</span>')&&!html.includes('已收藏'),'真实模式没有示例标签、本机收藏');
 assert.ok(html.includes('data-library-thread'),'R17-E：线上评论区是真实的讨论串挂载点（replies-only 由 test_r17e_wiring_js 断言）');
 assert.ok(html.includes('data-lib-act="submit-open"'),'投稿入口');
 assert.ok(!html.includes('data-lib-act="edit-open"'),'不是作者看不到编辑');
 assert.equal(c.writes.length,0,'读页面不写 Commons.write');
 console.log('_PASS lib-live');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_library_used_and_good_post_usage_and_roll_back_on_error(self):
        self.run_node(self.LIB_SETUP + r'''
(async()=>{
 const {c,rootNode}=libLive();
 c.CommonsLibrary.mount();await tick();
 c.routes['POST /library/items/s1/used']=fail('权限不足',403,'action_not_allowed');
 const bad=libClick(c,'used','s1');
 assert.equal(bad.disabled,true,'请求中禁用');
 await tick();
 assert.equal(bad.disabled,false,'失败恢复按钮');
 assert.ok(c.toasts.includes('权限不足'));
 assert.ok(rootNode.innerHTML.includes('我用过 <span>3</span>'),'失败计数不变');
 c.routes['POST /library/items/s1/used']=()=>({data:{count:4,useful_count:1,mine:false}});
 libClick(c,'used','s1');await tick();
 assert.ok(rootNode.innerHTML.includes('我用过 <span>4</span>'),'成功后用返回值');
 let sent=posts(c,'/library/items/s1/used');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[sent.length-1].body)),{useful:false});
 assert.ok(sent[sent.length-1].opts.idempotencyKey);
 c.routes['POST /library/items/s1/used']=()=>({data:{count:4,useful_count:2,mine:true}});
 libClick(c,'good','s1');await tick();
 sent=posts(c,'/library/items/s1/used');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[sent.length-1].body)),{useful:true});
 assert.ok(rootNode.innerHTML.includes('好用 <span>2</span>'));
 assert.equal(c.writes.length,0,'不再写本机计数');
 console.log('_PASS lib-used');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_library_search_hits_server_search(self):
        self.run_node(self.LIB_SETUP + r'''
(async()=>{
 const {c,rootNode}=libLive();
 c.CommonsLibrary.mount();await tick();
 const hit=Object.assign({},skill,{id:'s2',title:'搜到的资源'});
 c.routes['/library/search']=()=>({data:[hit]});
 const input={value:'写作',selectionStart:2,closest:s=>s==='[data-lib-form="search"]'?input:null};
 rootNode.dispatchEvent('input',{target:input});
 await wait(450);
 const gets=c.log.filter(x=>x.path==='/library/search');
 assert.equal(gets.length,1);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(gets[0].body)),{q:'写作',type:'skill',limit:50});
 assert.ok(rootNode.innerHTML.includes('搜到的资源'),'列表换成搜索结果');
 console.log('_PASS lib-search');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_library_submit_posts_item_and_failure_keeps_form(self):
        self.run_node(self.LIB_SETUP + r'''
(async()=>{
 const {c,rootNode}=libLive();
 c.CommonsLibrary.mount();await tick();
 libClick(c,'submit-open');
 assert.equal(c.modals.length,1);
 assert.ok(c.modals[0].html.includes('data-lib-form="live-submit"')&&c.modals[0].html.includes('name="skill_md"'),'真实投稿表单');
 assert.ok(!c.modals[0].html.includes('投稿先存在这台浏览器'),'不再是本机草稿');
 const values={name:'新技能',category:'编程',tags:'甲、乙',license:'MIT',purpose:'做事',clients:'Codex、Claude Code',skill_md:'# 新',install:'npm i',before:'',after:'',example_input:'入',example_output:'出'};
 const mk=()=>form('[data-lib-form="live-submit"]',{libForm:'live-submit',kind:'skills'},values);
 c.routes['POST /library/items']=fail('分类不对');
 const bad=mk();
 c.document.dispatchEvent('submit',{target:bad,preventDefault(){}});
 await tick();
 assert.equal(bad.note.textContent,'分类不对');
 assert.ok(!c.toasts.includes('投稿已提交，等待审核。'));
 assert.ok(!c.modalClosed,'失败不关弹窗');
 assert.equal(bad.submit.disabled,false);
 const created=Object.assign({},skill,{id:'s5',title:'新技能',status:'pending_review',lifecycle:'pending_review',etag:'n1',usage:{count:0,useful_count:0,mine:null}});
 c.routes['POST /library/items']=()=>({data:created});
 c.document.dispatchEvent('submit',{target:mk(),preventDefault(){}});
 await tick();
 const sent=posts(c,'/library/items');
 assert.equal(sent.length,2);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[1].body)),{type:'skill',title:'新技能',category:'编程',tags:['甲','乙'],license:'MIT',
   clients_or_stacks:['Codex','Claude Code'],content:{purpose:'做事',skill_md:'# 新'},examples:[{input:'入',output:'出'}],
   installs:[{client:'Codex',instructions:'npm i'},{client:'Claude Code',instructions:'npm i'}]});
 assert.ok(sent[1].opts.idempotencyKey);
 assert.ok(c.toasts.includes('投稿已提交，等待审核。'));
 assert.equal(c.modalClosed,1);
 assert.ok(rootNode.innerHTML.includes('新技能')&&rootNode.innerHTML.includes('审核中'),'投稿后出现并标审核中');
 assert.equal(c.writes.filter(w=>/library\./.test(w.k)).length,0,'不写本机投稿草稿');
 console.log('_PASS lib-submit');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_library_owner_edit_patches_with_if_match(self):
        self.run_node(self.LIB_SETUP + r'''
(async()=>{
 const {c,rootNode}=libLive('#/skills',{me:{id:'u9'}});
 c.CommonsLibrary.mount();await tick();
 assert.ok(rootNode.innerHTML.includes('data-lib-act="edit-open"'),'作者看到编辑');
 libClick(c,'edit-open','s1');
 const html=c.modals[0].html;
 assert.ok(html.includes('data-lib-form="live-edit"')&&html.includes('value="写作助手"')&&!html.includes('name="install"'));
 c.routes['PATCH /library/items/s1']=fail('conflict',412,'version_conflict');
 const mk=()=>form('[data-lib-form="live-edit"]',{libForm:'live-edit',kind:'skills',id:'s1'},
   {name:'写作助手 v2',category:'写作',tags:'a',license:'MIT',purpose:'用来写作 v2',clients:'Codex',skill_md:'# SKILL v2',before:'',after:'',example_input:'入2',example_output:'出2'});
 const bad=mk();
 c.document.dispatchEvent('submit',{target:bad,preventDefault(){}});
 await tick();
 assert.equal(bad.note.textContent,'内容已被改过，请刷新。');
 c.routes['PATCH /library/items/s1']=()=>({data:Object.assign({},skill,{title:'写作助手 v2',etag:'e2',content:{purpose:'用来写作 v2',skill_md:'# SKILL v2'}})});
 c.document.dispatchEvent('submit',{target:mk(),preventDefault(){}});
 await tick();
 const patch=c.log.filter(x=>x.method==='PATCH');
 assert.equal(patch.length,2);
 assert.equal(patch[1].opts.ifMatch,'e1');
 assert.equal(patch[1].body.title,'写作助手 v2');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(patch[1].body.content)),{purpose:'用来写作 v2',skill_md:'# SKILL v2'});
 assert.deepStrictEqual(JSON.parse(JSON.stringify(patch[1].body.examples)),[{input:'入2',output:'出2',comparison_bad:'',comparison_good:'',caption:''}]);
 assert.ok(!('installs' in patch[1].body),'编辑不动安装方法');
 assert.ok(c.toasts.includes('修改已保存。'));
 assert.ok(rootNode.innerHTML.includes('写作助手 v2'));
 console.log('_PASS lib-edit');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_library_deep_link_reads_item_detail_and_404_says_not_found(self):
        self.run_node(self.LIB_SETUP + r'''
(async()=>{
 let {c,rootNode}=libLive('#/skills/zz');
 c.routes['/library/items/zz']=()=>({data:Object.assign({},skill,{id:'zz',title:'深链资源'})});
 c.CommonsLibrary.mount();await tick(60);
 assert.equal(c.log.filter(x=>x.path==='/library/items/zz').length,1,'详情读 GET /library/items/{id}');
 assert.ok(rootNode.innerHTML.includes('深链资源'));
 ({c,rootNode}=libLive('#/skills/missing'));
 c.CommonsLibrary.mount();await tick(60);
 assert.ok(rootNode.innerHTML.includes('没有找到这个资源'),rootNode.innerHTML.slice(0,400));
 console.log('_PASS lib-deeplink');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_library_demo_mode_is_unchanged(self):
        self.run_node(self.LIB_SETUP + r'''
(async()=>{
 const c=context('demo','#/skills');
 vm.runInContext(source('library-sample'),c);
 vm.runInContext(source('library'),c);
 const rootNode=Object.assign(eventTarget(),fake({dataset:{route:'skills'}}));
 c.document.querySelector=s=>s==='[data-library-page]'?rootNode:null;
 rootNode.innerHTML=c.CommonsLibrary.routes.skills();
 c.CommonsLibrary.mount();
 const html=rootNode.innerHTML;
 assert.ok(html.includes('示例</span>'),'演示仍有示例标签');
 assert.ok(html.includes('data-lib-act="favorite"')&&html.includes('data-library-thread'),'演示仍有本机收藏与评论区');
 const id=(html.match(/data-lib-act="used" data-id="([^"]+)"/)||[])[1];
 assert.ok(id,'有「我用过」');
 libClick(c,'used',id);
 assert.ok(c.toasts.includes('已记下“我用过”（演示）。'),'演示话术不变');
 assert.ok(c.writes.some(w=>w.k==='library.used'),'演示仍写本机');
 assert.equal(c.log.length,0,'演示不发请求');
 console.log('_PASS lib-demo');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_r14_library_submit_entries_follow_can(self):
        self.run_node(self.LIB_SETUP + r'''
(async()=>{
 const gated=m=>m.includes('data-lib-act="submit-open" disabled')&&m.includes('你现在的等级还不能投稿')&&m.includes('href="#/growth"');
 // L1：can 为假 → 头部入口禁用 + 说明，点了不弹表单
 let {c,rootNode}=libLive('#/skills',{me:{id:'u1'},can:a=>a!=='library.submit'});
 c.CommonsLibrary.mount();await tick();
 assert.ok(gated(rootNode.innerHTML),'头部入口禁用并带说明');
 assert.ok(!/等级\s*[0-9一二三四五L]/.test(rootNode.innerHTML.replace(/Lv/g,'')),'不写死等级数字');
 libClick(c,'submit-open');
 assert.equal(c.modals.length,0,'被禁用时不弹投稿表');
 // 空状态入口同样禁用
 ({c,rootNode}=libLive('#/skills',{me:{id:'u1'},can:()=>false}));
 c.routes['/library/items']={data:[]};
 c.CommonsLibrary.mount();await tick();
 assert.ok(rootNode.innerHTML.includes('还没有人投稿'));
 assert.equal((rootNode.innerHTML.match(/lib-gate-note/g)||[]).length,2,'头部与空状态各一处说明');
 assert.equal((rootNode.innerHTML.match(/data-lib-act="submit-open" disabled/g)||[]).length,2);
 // 能投稿：行为不变
 ({c,rootNode}=libLive('#/skills',{me:{id:'u2'},can:()=>true}));
 c.CommonsLibrary.mount();await tick();
 assert.ok(!rootNode.innerHTML.includes('lib-gate-note')&&!rootNode.innerHTML.includes('submit-open" disabled'));
 libClick(c,'submit-open');
 assert.equal(c.modals.length,1);
 console.log('_PASS lib-r14');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_r14_library_demo_entry_is_unchanged(self):
        self.run_node(self.LIB_SETUP + r'''
(async()=>{
 const c=context('demo','#/skills');
 c.CommonsSession={can:()=>false};
 vm.runInContext(source('library-sample'),c);
 vm.runInContext(source('library'),c);
 const html=c.CommonsLibrary.routes.skills();
 assert.ok(html.includes('<button type="button" class="button primary" data-lib-act="submit-open">我要投稿</button>'));
 assert.ok(!html.includes('lib-gate-note'),'演示不受能力门影响');
 console.log('_PASS lib-r14-demo');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    # ---------------------------------------------------------- agentchat.js
    AG_SETUP = r'''
const author=(id,name,kind)=>({id,name,kind:kind||'human',level:2});
const msg=(id,authorObj,body,extra)=>Object.assign({id,channel_id:'c1',author_id:authorObj.id,author_kind:authorObj.kind,author:authorObj,body,reply_to:null,mentions:[],status:'ok',created_at:'2026-10-27T01:02:03.000Z',edited_at:null},extra||{});
const chan={id:'c1',kind:'lobby',slug:'lobby',title:'大厅',direction:null,participants:[],streak:0,waiting_human:false,last_at:null,last_excerpt:''};
const agentsData=[
 {id:'a1',name:'助手甲',kind:'agent',level:1,owner_id:'me1',owner_name:'我自己',skills:['coding'],useful_count:2,blurb:'简介甲',model_family:'x',color:'mint',muted:false,offline:false},
 {id:'a2',name:'助手乙',kind:'agent',level:1,owner_id:'u2',owner_name:'别人',skills:['coding'],useful_count:0,blurb:'简介乙',model_family:'x',color:'mint',muted:false,offline:false}];
async function agLive(){
  const c=context('live','#/agents');
  c.CommonsSession={me:{id:'me1',display_name:'我自己',handle:'me',level:2}};
  c.routes['/agentchat/channels']={data:{channels:[chan],webhook_enabled:false}};
  c.routes['/agentchat/agents']={data:{items:agentsData}};
  const m1=msg('m1',author('u2','路人'),'你好大家');
  const m2=msg('m2',author('a1','助手甲','agent'),'我是助手甲');
  c.routes['/agentchat/channels/c1/messages']=q=>({data:{items:q&&q.cursor?[msg('m0',author('u2','路人'),'更早的话')]:[m1,m2],channel:chan},meta:{cursor:q&&q.cursor?'':'cur1'}});
  const box=fake(),ta=fake();
  const host=fake();
  const rootNode=fake({parentNode:host,querySelector:s=>({'[data-ag-scroll]':box,'[data-ag-draft]':ta})[s]||null});
  host.querySelector=s=>s==='[data-agentchat]'?rootNode:null;
  c.document.querySelector=s=>s==='[data-agentchat]'?rootNode:null;
  vm.runInContext(source('agentchat'),c);
  host.innerHTML=c.CommonsAgentChat.routes.agents();
  c.CommonsAgentChat.mount();
  await tick(60);
  return {c,host,box};
}
const agClick=(c,act,id)=>{const b=button('data-ag-act',{agAct:act,id:id||''});b.getAttribute=n=>n==='data-ag-act'?act:(n==='data-id'?(id||''):null);c.document.dispatchEvent('click',{target:b,preventDefault(){}});return b;};
const agForm=(text)=>{const f=form('[data-ag-form="send"]',{},{body:text});f.elements.body={value:text};return f;};
'''

    def test_agentchat_live_reads_channel_history_with_real_authors(self):
        self.run_node(self.AG_SETUP + r'''
(async()=>{
 const {c,host}=await agLive();
 const html=host.innerHTML;
 assert.ok(html.includes('你好大家')&&html.includes('我是助手甲'),'频道历史来自接口');
 assert.ok(html.includes('路人')&&html.includes('助手甲'),'作者名');
 assert.ok(html.includes('data-ag-form="send"'),'发言框');
 assert.ok(html.includes('data-ag-act="older"'),'有下一页游标时给「加载更早」');
 assert.ok(!html.includes('示例</span>'));
 assert.equal(c.log.filter(x=>x.path==='/agentchat/channels/c1/messages').length,1);
 assert.ok(c.log.every(x=>x.method==='GET'),'读不写');
 const inbox=c.log.filter(x=>/inbox/.test(x.path));
 assert.equal(inbox.length,1,'R17-D：会话登录也能读收件箱，打开广场读一次');
 assert.equal(inbox[0].method,'GET');
 assert.equal(inbox[0].path,'/agentchat/inbox');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(inbox[0].body)),{limit:10});
 // 更早
 agClick(c,'older');await tick(60);
 const pages=c.log.filter(x=>x.path==='/agentchat/channels/c1/messages');
 assert.equal(pages.length,2);
 assert.equal(pages[1].body.cursor,'cur1');
 assert.ok(host.innerHTML.includes('更早的话'));
 console.log('_PASS ag-history');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_agentchat_send_posts_message_and_failure_keeps_text(self):
        self.run_node(self.AG_SETUP + r'''
(async()=>{
 const {c,host}=await agLive();
 c.routes['POST /agentchat/channels/c1/messages']=fail('今天说得太多了',429,'rate_limited');
 const bad=agForm('大家好');
 let prevented=0;
 c.document.dispatchEvent('submit',{target:bad,preventDefault(){prevented++}});
 assert.equal(prevented,1);
 assert.equal(bad.submit.disabled,true,'请求中禁用');
 await tick();
 assert.equal(bad.note.textContent,'今天说得太多了');
 assert.equal(bad.submit.disabled,false);
 assert.ok(!host.innerHTML.includes('大家好'),'失败不追加消息');
 c.routes['POST /agentchat/channels/c1/messages']=()=>({data:{item:msg('m3',author('me1','我自己'),'大家好'),channel:chan}});
 c.document.dispatchEvent('submit',{target:agForm('大家好'),preventDefault(){}});
 await tick(60);
 const sent=posts(c,'/agentchat/channels/c1/messages');
 assert.equal(sent.length,2);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[1].body)),{body:'大家好',mentions:[]});
 assert.ok(sent[1].opts.idempotencyKey);
 assert.ok(host.innerHTML.includes('大家好'),'成功后追加');
 // 回复带 reply_to
 agClick(c,'reply','m1');
 assert.ok(host.innerHTML.includes('回复 路人'));
 c.document.dispatchEvent('submit',{target:agForm('收到'),preventDefault(){}});
 await tick(60);
 const again=posts(c,'/agentchat/channels/c1/messages');
 assert.equal(again[2].body.reply_to,'m1');
 assert.equal(c.writes.filter(w=>/agentchat\.(messages|draft)/.test(w.k)).length,0);
 console.log('_PASS ag-send');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_agentchat_dm_mute_and_offline_use_real_endpoints(self):
        self.run_node(self.AG_SETUP + r'''
(async()=>{
 const {c,host}=await agLive();
 // 私聊
 const dm={id:'d1',kind:'dm',slug:'dm:a2:me1',title:'私聊',direction:null,streak:0,waiting_human:false,last_at:null,last_excerpt:'',
   participants:[{id:'me1',name:'我自己',kind:'human',level:2},{id:'a2',name:'助手乙',kind:'agent',level:1}]};
 c.routes['POST /agentchat/dms']=()=>({data:dm});
 c.routes['/agentchat/channels/d1/messages']={data:{items:[],channel:dm},meta:{cursor:''}};
 agClick(c,'dm','a2');await tick(60);
 const opened=posts(c,'/agentchat/dms');
 assert.equal(opened.length,1);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(opened[0].body)),{peer_id:'a2'});
 assert.ok(opened[0].opts.idempotencyKey);
 assert.ok(host.innerHTML.includes('这个频道还没有消息'),'进入私聊并读历史');
 assert.ok(host.innerHTML.includes('助手乙'));
 // 静音：失败不改状态
 c.routes['POST /agentchat/agents/a1/mute']=fail('不是你的 Agent',403,'action_not_allowed');
 const b=agClick(c,'mute','a1');
 assert.equal(b.disabled,true);
 await tick();
 assert.equal(b.disabled,false);
 assert.ok(c.toasts.includes('不是你的 Agent'));
 assert.ok(!host.innerHTML.includes('已静音'));
 c.routes['POST /agentchat/agents/a1/mute']=b2=>({data:{id:'a1',muted:b2.kind==='mute',offline:b2.kind==='offline',kinds:[b2.kind]}});
 agClick(c,'mute','a1');await tick(40);
 agClick(c,'offline','a1');await tick(40);
 const mutes=posts(c,'/agentchat/agents/a1/mute');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(mutes[1].body)),{kind:'mute',muted:true});
 assert.deepStrictEqual(JSON.parse(JSON.stringify(mutes[2].body)),{kind:'offline',muted:true});
 assert.ok(!c.toasts.includes('这个功能还没开放'),'下线不再是占位');
 assert.ok(host.innerHTML.includes('已下线'));
 console.log('_PASS ag-dm-mute');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    def test_agentchat_demo_mode_is_unchanged(self):
        self.run_node(self.AG_SETUP + r'''
(async()=>{
 const c=context('demo','#/agents');
 vm.runInContext(source('agentchat-sample'),c);
 vm.runInContext(source('agentchat'),c);
 const host=fake();
 const rootNode=fake({parentNode:host});
 host.querySelector=s=>s==='[data-agentchat]'?rootNode:null;
 c.document.querySelector=s=>s==='[data-agentchat]'?rootNode:null;
 const html=c.CommonsAgentChat.routes.agents();
 assert.ok(html.includes('示例')&&html.includes('data-ag-thread'));
 assert.ok(!html.includes('data-ag-form="send"'),'演示用讨论串组件，没有真实发言框');
 host.innerHTML=html;
 c.CommonsAgentChat.mount();
 const mute=html.match(/data-ag-act="mute" data-id="([^"]+)"/);
 if(mute){const b=button('data-ag-act',{});b.getAttribute=n=>n==='data-ag-act'?'mute':(n==='data-id'?mute[1]:null);c.document.dispatchEvent('click',{target:b,preventDefault(){}});
  assert.ok(c.toasts.some(t=>/示例/.test(t)),'演示话术不变');
  assert.ok(c.writes.some(w=>w.k==='agentchat.muted'),'演示仍写本机');}
 assert.equal(c.log.length,0,'演示不发请求');
 console.log('_PASS ag-demo');
})().catch(e=>{console.error(e);process.exit(1)});
''')

    # ------------------------------------------------------------- 静态闸门
    def test_no_inline_events_in_knowledge_and_agent_pages(self):
        inline = re.compile(r'<[^>]+\son[a-z]+\s*=', re.I)
        for name in ('kb.js', 'library.js', 'agentchat.js'):
            text = (PREVIEW / name).read_text(encoding='utf-8')
            self.assertIsNone(inline.search(text), name)


if __name__ == '__main__':
    unittest.main()
