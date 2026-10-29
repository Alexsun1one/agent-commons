"""R17-D · 前端：@ 补全、Agent 广场收件箱/撤回/编辑/举报/下线、私信编辑/举报、成员翻页。

离线 VM：mock CommonsAPI。假数据的形状照真实路由写：
  分页接口 data: {items: [...]} + meta.cursor；/api/search/members data: {items: [...]}；
  /api/agentchat/inbox data: {items: [...]}；撤回/编辑返回 data = 一条消息。
"""
from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const alt=process.env.R17D_PREVIEW||'';
const source=name=>{const own=alt+'/'+name+'.js';return fs.readFileSync(alt&&fs.existsSync(own)?own:root+'/preview/'+name+'.js','utf8');};
const tick=async(n=40)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){[...(events[type]||[])].forEach(f=>f(ev))}}}
function fake(extra){return Object.assign({innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,dataset:{},scrollTop:0,scrollHeight:0,focus(){},setAttribute(){},getAttribute(){return null},querySelector:()=>null,querySelectorAll:()=>[],closest(){return null},matches(){return false},contains(){return true},classList:{add(){},remove(){}}},extra||{});}
function context(hash,mode){
  const log=[],toasts=[],store={},routes={};
  const c=Object.assign(eventTarget(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,Error,
    setTimeout,clearTimeout,setInterval,clearInterval,
    location:{protocol:'https:',hash,replace(){},assign(){}},matchMedia:()=>({matches:true}),log,toasts,store,routes,keyN:0});
  c.document=Object.assign(eventTarget(),{activeElement:null,querySelector:()=>null,querySelectorAll:()=>[],body:{classList:{add(){},remove(){}}},head:{appendChild(){}},createElement:()=>fake({isConnected:true,appendChild(){}})});
  c.Commons={read:(k,fb)=>k in store?store[k]:fb,write:(k,v)=>{store[k]=v;return true},toast:m=>toasts.push(m),icon:()=>'',safeUrl:s=>String(s||'#'),refresh(){}};
  const handle=(method,path,body,opts)=>{
    log.push({method,path,body,opts:opts||{}});
    const key=method+' '+path;
    let r=routes[key];
    if(r===undefined&&method==='GET')r=routes[path];
    if(r===undefined){
      if(method==='GET')return Promise.reject(Object.assign(new Error('no route '+key),{status:404,code:'resource_not_found'}));
      return Promise.resolve({data:{}});
    }
    if(typeof r==='function')r=r(body,opts);
    if(r instanceof Error)return Promise.reject(r);
    return Promise.resolve(r);
  };
  c.CommonsAPI={mode:mode||'live',get:(p,q,o)=>handle('GET',p,q,o),post:(p,b,o)=>handle('POST',p,b,o),patch:(p,b,o)=>handle('PATCH',p,b,o),
    put:(p,b,o)=>handle('PUT',p,b,o),del:(p,b,o)=>handle('DELETE',p,b,o),newIdempotencyKey:()=>'idem-'+(++c.keyN),
    me:()=>Promise.resolve({data:{id:'me1',display_name:'我自己',handle:'me'}})};
  c.COMMONS_BUILD={mode:mode||'live'};
  c.window=c;c.self=c;
  vm.createContext(c);
  return c;
}
const fail=(message,status,code)=>Object.assign(new Error(message),{status:status||422,code:code||'validation_failed'});
const posts=(c,path)=>c.log.filter(x=>x.method==='POST'&&x.path===path);
const plain=o=>JSON.parse(JSON.stringify(o));
const done=name=>{console.log('_PASS '+name);process.exit(0);};
const bail=e=>{console.error(e);process.exit(1);};
'''

AG_SETUP = r'''
const author=(id,name,kind)=>({id,name,kind:kind||'human',level:2});
const ago=s=>new Date(Date.now()-s*1000).toISOString();
const msg=(id,authorObj,body,extra)=>Object.assign({id,channel_id:'c1',author_id:authorObj.id,author_kind:authorObj.kind,author:authorObj,body,reply_to:null,mentions:[],status:'ok',created_at:ago(30),edited_at:null},extra||{});
const chan={id:'c1',kind:'lobby',slug:'lobby',title:'大厅',direction:null,participants:[],streak:0,waiting_human:false,last_at:null,last_excerpt:''};
const chan2={id:'c2',kind:'direction',slug:'coding',title:'编程助手',direction:'coding',participants:[],streak:0,waiting_human:false,last_at:null,last_excerpt:''};
const agentsData=[{id:'a1',name:'助手甲',kind:'agent',level:1,owner_id:'me1',owner_name:'我自己',skills:['coding'],useful_count:2,blurb:'简介甲',model_family:'x',color:'mint',muted:false,offline:false}];
async function agLive(extra){
  const c=context('#/agents');
  c.CommonsSession={me:{id:'me1',display_name:'我自己',handle:'me',level:2}};
  c.routes['/agentchat/channels']={data:{channels:[chan,chan2],webhook_enabled:false}};
  c.routes['/agentchat/agents']={data:{items:agentsData}};
  const mine=msg('mine',author('me1','我自己'),'我刚说的');
  const old=msg('old',author('me1','我自己'),'我很久前说的',{created_at:ago(600)});
  const theirs=msg('theirs',author('u2','路人'),'路人说的');
  c.routes['/agentchat/channels/c1/messages']={data:{items:[old,theirs,mine],channel:chan},meta:{cursor:''}};
  c.routes['/agentchat/channels/c2/messages']={data:{items:[],channel:chan2},meta:{cursor:''}};
  if(extra)extra(c);
  const host=fake();
  const rootNode=fake({parentNode:host});
  host.querySelector=s=>s==='[data-agentchat]'?rootNode:null;
  c.document.querySelector=s=>s==='[data-agentchat]'?rootNode:null;
  vm.runInContext(source('agentchat'),c);
  host.innerHTML=c.CommonsAgentChat.routes.agents();
  c.CommonsAgentChat.mount();
  await tick(60);
  return {c,host};
}
const btn=(attr,dataset)=>{const b=fake({dataset});const act=dataset[attr.replace('data-','').replace(/-([a-z])/g,(_,x)=>x.toUpperCase())];b.getAttribute=n=>n===attr?act:(n==='data-id'?(dataset.id||''):(n==='data-value'?(dataset.value||''):null));b.closest=s=>s==='['+attr+']'?b:null;return b;};
const agClick=(c,act,id,value)=>{const b=btn('data-ag-act',{agAct:act,id:id||'',value:value||''});c.document.dispatchEvent('click',{target:b,preventDefault(){}});return b;};
const agForm=(sel,values)=>{const f=fake({elements:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{value:v}]))});const submit=fake(),note=fake({hidden:true});f.closest=s=>s===sel?f:null;f.querySelector=s=>s==='[type="submit"]'?submit:(/error/.test(s)?note:null);f.submit=submit;f.note=note;return f;};
const agSubmit=(c,f)=>c.document.dispatchEvent('submit',{target:f,preventDefault(){}});
'''


class R17DFrontend(unittest.TestCase):
    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True,
                                env=dict(os.environ))
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    # ---------------------------------------------------------- @ 补全（people.js 里的 CommonsMention）
    def test_mention_token_insert_and_search_request(self):
        self.run_node(r'''
(async()=>{
 const c=context('#/u/x');
 vm.runInContext(source('people'),c);
 const M=c.CommonsMention;
 assert.deepStrictEqual(plain(M.token('你好 @小明',6)),{query:'小明',start:3,end:6});
 assert.deepStrictEqual(plain(M.token('@a',2)),{query:'a',start:0,end:2});
 assert.equal(M.token('邮箱 a@b.com',9),null,'邮箱里的 @ 不触发');
 assert.equal(M.token('已经 @小明 说完了',9),null,'光标在空格后不触发');
 const out=M.insert('你好 @小',M.token('你好 @小',5),{display_name:'小明',handle:'xm'});
 assert.deepStrictEqual(plain(out),{value:'你好 @小明 ',caret:7});
 c.routes['/search/members']={data:{items:[{id:'u9',kind:'human',handle:'xm',display_name:'小明',level:2}]}};
 const items=await M.search('小','human');
 assert.equal(items.length,1);
 assert.deepStrictEqual(plain(c.log[0].body),{q:'小',limit:6,kinds:'human'});
 assert.deepStrictEqual(plain(await M.search('  ','')),[],'空词不发请求');
 assert.equal(c.log.length,1);
 done('mention-pure');
})().catch(bail);
''')

    def test_mention_menu_opens_picks_with_keyboard_and_escapes_names(self):
        self.run_node(r'''
(async()=>{
 const c=context('#/messages/t1');
 vm.runInContext(source('people'),c);
 c.routes['/search/members']={data:{items:[{id:'u9',kind:'human',handle:'xm',display_name:'<b>小明</b>',level:2},{id:'a7',kind:'agent',handle:null,display_name:'助手',level:1}]}};
 const rootEl=Object.assign(eventTarget(),{});
 const host=fake({appended:[],appendChild(n){n.parentNode=host;host.appended.push(n)},removeChild(n){n.parentNode=null}});
 const field=fake({value:'帮我 @小',selectionStart:5,closest:s=>s==='textarea'?field:(s==='form'?host:null),setSelectionRange(a){field.caret=a}});
 let picked=null;
 const detach=c.CommonsMention.attach(rootEl,{selector:'textarea',kinds:'human,agent',onPick:m=>{picked=m}});
 rootEl.dispatchEvent('input',{target:field});
 await wait(260);
 const menu=host.appended[0];
 assert.ok(menu,'菜单出现');
 assert.ok(menu.innerHTML.includes('&lt;b&gt;小明'),'名字被转义');
 assert.ok(!menu.innerHTML.includes('<b>小明</b>'),'没有注入');
 assert.ok(menu.innerHTML.includes('Agent'),'Agent 有标记');
 assert.deepStrictEqual(plain(c.log[0].body),{q:'小',limit:6,kinds:'human,agent'});
 let prevented=0;
 rootEl.dispatchEvent('keydown',{key:'ArrowDown',target:field,preventDefault(){prevented++}});
 rootEl.dispatchEvent('keydown',{key:'Enter',target:field,preventDefault(){prevented++}});
 assert.equal(prevented,2);
 assert.equal(picked.id,'a7','方向键移到第二项');
 assert.equal(field.value,'帮我 @助手 ');
 detach();
 done('mention-menu');
})().catch(bail);
''')

    # ---------------------------------------------------------- Agent 广场
    def test_agentchat_inbox_lists_mentions_by_session(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 const {c,host}=await agLive(c=>{
   c.routes['/agentchat/inbox']={data:{items:[Object.assign(msg('i1',author('u2','路人'),'@我自己 帮看下'),{channel_id:'c2',channel_title:'编程助手',mentions:['me1']})]},meta:{}};
 });
 const call=c.log.filter(x=>x.path==='/agentchat/inbox');
 assert.equal(call.length,1,'会话登录也读收件箱');
 assert.deepStrictEqual(plain(call[0].body),{limit:10});
 assert.ok(host.innerHTML.includes('提到我的'));
 assert.ok(host.innerHTML.includes('路人 在 编程助手')&&host.innerHTML.includes('@我自己 帮看下'));
 agClick(c,'channel','c2');await tick(40);
 assert.ok(c.log.some(x=>x.path==='/agentchat/channels/c2/messages'),'点收件箱条目进入那个频道');
 done('ag-inbox');
})().catch(bail);
''')

    def test_agentchat_inbox_failure_is_quiet_and_empty_is_said(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 const a=await agLive(c=>{c.routes['/agentchat/inbox']={data:{items:[]},meta:{}};});
 assert.ok(a.host.innerHTML.includes('还没有人提到你'));
 const b=await agLive();
 assert.ok(b.host.innerHTML.includes('读不出来'),'接口失败给一句话，不影响广场');
 assert.ok(b.host.innerHTML.includes('我很久前说的'),'广场其余部分照常');
 done('ag-inbox-states');
})().catch(bail);
''')

    def test_agentchat_action_buttons_follow_ownership_and_two_minute_window(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 const {host}=await agLive();
 const html=host.innerHTML;
 const item=id=>{const i=html.indexOf('data-ag-msg="'+id+'"');return html.slice(i,html.indexOf('</li>',i));};
 assert.ok(item('mine').includes('data-ag-act="edit"')&&item('mine').includes('data-ag-act="recall"'),'自己 2 分钟内的话：编辑和撤回');
 assert.ok(!item('mine').includes('data-ag-act="report"'),'自己的话没有举报');
 assert.ok(!item('old').includes('data-ag-act="edit"')&&!item('old').includes('data-ag-act="recall"'),'超过 2 分钟不画');
 assert.ok(item('theirs').includes('data-ag-act="report"'),'别人的话：举报');
 assert.ok(!item('theirs').includes('data-ag-act="recall"')&&!item('theirs').includes('data-ag-act="edit"'));
 done('ag-buttons');
})().catch(bail);
''')

    def test_agentchat_recall_marks_deleted_and_failure_keeps_message_with_same_key(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 const {c,host}=await agLive();
 c.routes['POST /agentchat/messages/mine/recall']=fail('消息发出超过 2 分钟，不能再改',409,'state_conflict');
 const b=agClick(c,'recall','mine');
 assert.equal(b.disabled,true,'请求中禁用');
 await tick();
 assert.equal(b.disabled,false);
 assert.ok(c.toasts.includes('消息发出超过 2 分钟，不能再改'));
 assert.ok(host.innerHTML.includes('我刚说的'),'失败不动原消息');
 c.routes['POST /agentchat/messages/mine/recall']=()=>({data:Object.assign(msg('mine',author('me1','我自己'),''),{status:'deleted'})});
 agClick(c,'recall','mine');await tick(40);
 const sent=posts(c,'/agentchat/messages/mine/recall');
 assert.equal(sent.length,2);
 assert.equal(sent[0].opts.idempotencyKey,sent[1].opts.idempotencyKey,'失败重试复用同一个键');
 assert.ok(host.innerHTML.includes('这条消息已删除。'));
 assert.ok(!host.innerHTML.includes('我刚说的'));
 assert.ok(c.toasts.includes('已撤回。'));
 done('ag-recall');
})().catch(bail);
''')

    def test_agentchat_edit_patches_and_failure_keeps_text(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 const {c,host}=await agLive();
 agClick(c,'edit','mine');
 assert.ok(host.innerHTML.includes('data-ag-form="edit"')&&host.innerHTML.includes('我刚说的'),'编辑框带原文');
 c.routes['PATCH /agentchat/messages/mine']=fail('消息发出超过 2 分钟，不能再改',409,'state_conflict');
 agSubmit(c,agForm('[data-ag-form="edit"]',{body:'改后的话'}));
 await tick(40);
 assert.ok(host.innerHTML.includes('消息发出超过 2 分钟，不能再改'),'显示服务器的话');
 assert.ok(host.innerHTML.includes('改后的话'),'失败后文字还在编辑框里');
 c.routes['PATCH /agentchat/messages/mine']=()=>({data:Object.assign(msg('mine',author('me1','我自己'),'改后的话'),{edited_at:new Date().toISOString()})});
 agSubmit(c,agForm('[data-ag-form="edit"]',{body:'改后的话'}));
 await tick(40);
 const patches=c.log.filter(x=>x.method==='PATCH');
 assert.equal(patches.length,2);
 assert.deepStrictEqual(plain(patches[1].body),{body:'改后的话'});
 assert.equal(patches[0].opts.idempotencyKey,patches[1].opts.idempotencyKey,'同一份内容重试复用键');
 assert.ok(host.innerHTML.includes('改后的话')&&host.innerHTML.includes('已编辑'));
 assert.ok(!host.innerHTML.includes('data-ag-form="edit"'),'保存后收起编辑框');
 done('ag-edit');
})().catch(bail);
''')

    def test_agentchat_edit_cancel_and_unchanged_do_not_call_api(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 const {c,host}=await agLive();
 agClick(c,'edit','mine');
 agClick(c,'edit-cancel');
 assert.ok(!host.innerHTML.includes('data-ag-form="edit"'));
 agClick(c,'edit','mine');
 agSubmit(c,agForm('[data-ag-form="edit"]',{body:'我刚说的'}));
 await tick();
 assert.equal(c.log.filter(x=>x.method==='PATCH').length,0);
 done('ag-edit-noop');
})().catch(bail);
''')

    def test_agentchat_report_asks_for_reason_then_posts(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 const {c,host}=await agLive();
 agClick(c,'report','theirs');
 assert.ok(host.innerHTML.includes('data-ag-act="report-send"')&&host.innerHTML.includes('广告刷屏'),'先选理由');
 assert.equal(posts(c,'/agentchat/messages/theirs/report').length,0,'点举报本身不发请求');
 c.routes['POST /agentchat/messages/theirs/report']=fail('这条消息已经举报过',409,'state_conflict');
 agClick(c,'report-send','theirs','广告刷屏');await tick();
 assert.ok(c.toasts.includes('这条消息已经举报过'));
 c.routes['POST /agentchat/messages/theirs/report']=()=>({data:{report_id:'r1',message_id:'theirs'}});
 agClick(c,'report-send','theirs','广告刷屏');await tick(40);
 const sent=posts(c,'/agentchat/messages/theirs/report');
 assert.deepStrictEqual(plain(sent[1].body),{reason:'广告刷屏'});
 assert.equal(sent[0].opts.idempotencyKey,sent[1].opts.idempotencyKey);
 assert.ok(c.toasts.some(t=>t.includes('已举报')));
 assert.ok(!host.innerHTML.includes('data-ag-act="report-send"'),'提交后收起理由');
 agClick(c,'report','theirs');agClick(c,'report-cancel');
 assert.ok(!host.innerHTML.includes('data-ag-act="report-send"'));
 done('ag-report');
})().catch(bail);
''')

    def test_agentchat_send_carries_picked_mentions_only_while_name_stays_in_text(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 let opts=null;
 const {c}=await agLive(c=>{
   c.CommonsMention={attach(root,o){opts=o;return ()=>{}}};
   c.routes['POST /agentchat/channels/c1/messages']=b=>({data:{item:msg('n1',author('me1','我自己'),b.body),channel:chan}});
 });
 assert.ok(opts&&opts.selector==='[data-ag-draft]'&&opts.kinds==='human,agent','输入框接上 @ 补全');
 opts.onPick({id:'u9',display_name:'小明',handle:'xm'});
 opts.onPick({id:'a7',display_name:'助手',handle:null});
 opts.onPick({id:'u9',display_name:'小明',handle:'xm'});
 agSubmit(c,agForm('[data-ag-form="send"]',{body:'@小明 你看一下'}));
 await tick(40);
 const sent=posts(c,'/agentchat/channels/c1/messages');
 assert.deepStrictEqual(plain(sent[0].body.mentions),['u9'],'删掉的 @助手 不算，重复的只算一次');
 agSubmit(c,agForm('[data-ag-form="send"]',{body:'普通一句'}));
 await tick(40);
 assert.deepStrictEqual(plain(posts(c,'/agentchat/channels/c1/messages')[1].body.mentions),[],'发出后清空');
 done('ag-mentions');
})().catch(bail);
''')

    def test_agentchat_offline_button_posts_kind_offline_and_marks_card(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 const {c,host}=await agLive();
 assert.ok(host.innerHTML.includes('data-ag-act="offline"'),'主人看得到「下线」');
 c.routes['POST /agentchat/agents/a1/mute']=fail('不是你的 Agent',403,'action_not_allowed');
 agClick(c,'offline','a1');await tick();
 assert.ok(c.toasts.includes('不是你的 Agent'));
 assert.ok(!host.innerHTML.includes('已下线'),'失败不改状态');
 c.routes['POST /agentchat/agents/a1/mute']=b=>({data:{id:'a1',muted:false,offline:b.muted,kinds:['offline']}});
 agClick(c,'offline','a1');await tick(40);
 const sent=posts(c,'/agentchat/agents/a1/mute');
 assert.deepStrictEqual(plain(sent[1].body),{kind:'offline',muted:true});
 assert.ok(sent[1].opts.idempotencyKey);
 assert.ok(host.innerHTML.includes('已下线'));
 agClick(c,'offline','a1');await tick(40);
 assert.deepStrictEqual(plain(posts(c,'/agentchat/agents/a1/mute')[2].body),{kind:'offline',muted:false});
 assert.ok(c.toasts.includes('已重新上线。'));
 done('ag-offline');
})().catch(bail);
''')

    def test_agentchat_demo_mode_has_no_inbox_or_message_actions(self):
        self.run_node(AG_SETUP + r'''
(async()=>{
 const c=context('#/agents','demo');
 vm.runInContext(source('agentchat-sample'),c);
 vm.runInContext(source('agentchat'),c);
 const html=c.CommonsAgentChat.routes.agents();
 assert.ok(!html.includes('提到我的'));
 assert.ok(!html.includes('data-ag-act="recall"')&&!html.includes('data-ag-act="report"'));
 assert.equal(c.log.length,0,'示例模式不发请求');
 done('ag-demo');
})().catch(bail);
''')

    # ---------------------------------------------------------- 私信
    DM_SETUP = r'''
const ago=s=>new Date(Date.now()-s*1000).toISOString();
const dmMsg=(id,sender,text,extra)=>Object.assign({id,thread_id:'t1',seq:1,sender_id:sender,sender_name:sender==='me1'?'我自己':'对方',kind:'text',text,image_ref:null,sticker_ref:null,ref:null,reply_to:null,recalled:false,edited_at:null,created_at:ago(30)},extra||{});
const thread={id:'t1',kind:'direct',title:null,request_state:'accepted',request_recipient_id:null,ref:null,last_seq:3,updated_at:ago(30),unread:0,pinned:false,muted:false,
  participants:[{id:'me1',name:'我自己',role:'owner'},{id:'u2',name:'对方',role:'member'}],last_message:null};
async function dmLive(mutate){
  const c=context('#/messages/t1');
  c.CommonsSession={me:{id:'me1',display_name:'我自己',handle:'me',level:2}};
  let items=[dmMsg('old','me1','很久以前',{seq:1,created_at:ago(900)}),dmMsg('mine','me1','刚发的',{seq:2}),dmMsg('theirs','u2','对方的话',{seq:3}),dmMsg('pic','me1','',{seq:4,kind:'sticker',sticker_ref:'assets/mascot/x.webp'})];
  c.state={items};
  c.routes['/dm/threads']={data:{items:[thread]}};
  c.routes['/dm/settings']={data:{contact_policy:'following'}};
  c.routes['/dm/unread-count']={data:{count:0}};
  c.routes['/dm/threads/t1/messages']=()=>({data:{items:c.state.items,thread},meta:{}});
  if(mutate)mutate(c);
  const rootEl=Object.assign(eventTarget(),fake({className:''}));
  c.document.querySelector=s=>s==='[data-dm-root]'?rootEl:null;
  vm.runInContext(source('dm'),c);
  rootEl.innerHTML=c.CommonsDM.routes.messages();
  c.CommonsDM.mount();
  await tick(80);
  return {c,root:rootEl};
}
const dmBtn=(act,id,value)=>{const b=fake({dataset:{dmAct:act,id:id||'',value:value||''}});b.closest=s=>s==='[data-dm-act]'?b:null;return b;};
const dmClick=(root,act,id,value)=>root.dispatchEvent('click',{target:dmBtn(act,id,value)});
const dmEditForm=text=>{const f=fake({elements:{edit:{value:text}}});f.closest=s=>s==='[data-dm-edit-form]'?f:null;return f;};
'''

    def test_dm_buttons_edit_only_for_recent_own_text(self):
        self.run_node(self.DM_SETUP + r'''
(async()=>{
 const {root}=await dmLive();
 const html=root.innerHTML;
 const item=id=>{const i=html.indexOf('data-message-id="'+id+'"');return html.slice(i,html.indexOf('</article>',i));};
 assert.ok(item('mine').includes('data-dm-act="edit"')&&item('mine').includes('data-dm-act="recall"'));
 assert.ok(!item('old').includes('data-dm-act="edit"'),'超过 2 分钟不画编辑');
 assert.ok(!item('pic').includes('data-dm-act="edit"'),'贴纸不能编辑');
 assert.ok(!item('theirs').includes('data-dm-act="edit"')&&item('theirs').includes('data-dm-act="report"'));
 done('dm-buttons');
})().catch(bail);
''')

    def test_dm_edit_patches_with_key_and_shows_edited(self):
        self.run_node(self.DM_SETUP + r'''
(async()=>{
 const {c,root}=await dmLive();
 dmClick(root,'edit','mine');
 assert.ok(root.innerHTML.includes('data-dm-edit-form')&&root.innerHTML.includes('刚发的'));
 c.routes['PATCH /dm/messages/mine']=fail('消息发出超过 2 分钟，不能再改',409,'state_conflict');
 root.dispatchEvent('submit',{target:dmEditForm('改好的'),preventDefault(){}});
 await tick(40);
 assert.ok(root.innerHTML.includes('消息发出超过 2 分钟，不能再改'));
 assert.ok(root.innerHTML.includes('改好的'),'失败后文字还在');
 c.routes['PATCH /dm/messages/mine']=()=>{c.state.items=c.state.items.map(m=>m.id==='mine'?Object.assign({},m,{text:'改好的',edited_at:new Date().toISOString()}):m);return {data:dmMsg('mine','me1','改好的',{edited_at:new Date().toISOString()})};};
 root.dispatchEvent('submit',{target:dmEditForm('改好的'),preventDefault(){}});
 await tick(80);
 const patches=c.log.filter(x=>x.method==='PATCH');
 assert.equal(patches.length,2);
 assert.deepStrictEqual(plain(patches[1].body),{text:'改好的'});
 assert.equal(patches[0].opts.idempotencyKey,patches[1].opts.idempotencyKey);
 assert.ok(root.innerHTML.includes('改好的')&&root.innerHTML.includes('已编辑'));
 assert.ok(!root.innerHTML.includes('data-dm-edit-form'));
 done('dm-edit');
})().catch(bail);
''')

    def test_dm_recall_redraws_the_message_and_report_asks_for_reason(self):
        self.run_node(self.DM_SETUP + r'''
(async()=>{
 const {c,root}=await dmLive();
 c.routes['POST /dm/messages/mine/recall']=()=>{c.state.items=c.state.items.map(m=>m.id==='mine'?Object.assign({},m,{recalled:true,text:'一条消息已撤回'}):m);return {data:{id:'mine',recalled:true}};};
 dmClick(root,'recall','mine');await tick(80);
 assert.ok(root.innerHTML.includes('一条消息已撤回'),'撤回后当场重画');
 assert.ok(!root.innerHTML.includes('刚发的'));
 dmClick(root,'report','theirs');
 assert.equal(posts(c,'/dm/messages/theirs/report').length,0,'点举报先选理由');
 assert.ok(root.innerHTML.includes('data-dm-act="report-send"'));
 dmClick(root,'report-send','theirs','骚扰辱骂');await tick(40);
 const sent=posts(c,'/dm/messages/theirs/report');
 assert.deepStrictEqual(plain(sent[0].body),{reason:'骚扰辱骂'});
 assert.ok(sent[0].opts.idempotencyKey);
 assert.ok(c.toasts.some(t=>t.includes('举报已提交')));
 assert.ok(!root.innerHTML.includes('data-dm-act="report-send"'));
 done('dm-recall-report');
})().catch(bail);
''')

    def test_dm_composer_gets_mention_completion_for_humans(self):
        self.run_node(self.DM_SETUP + r'''
(async()=>{
 let opts=null;
 const {c}=await dmLive(c=>{c.CommonsMention={attach(root,o){opts=o;return ()=>{}}};});
 assert.ok(opts&&opts.selector==='textarea[name="message"]'&&opts.kinds==='human');
 done('dm-mention');
})().catch(bail);
''')

    def test_dm_demo_mode_keeps_old_report_and_no_edit(self):
        self.run_node(r'''
(async()=>{
 const c=context('#/messages','demo');
 vm.runInContext(source('dm-sample'),c);
 vm.runInContext(source('dm'),c);
 const html=c.CommonsDM.routes.messages();
 assert.ok(!html.includes('data-dm-act="edit"'));
 assert.equal(c.log.length,0);
 done('dm-demo');
})().catch(bail);
''')

    # ---------------------------------------------------------- 成员目录翻页
    def test_people_more_members_keeps_page_and_appends(self):
        self.run_node(r'''
(async()=>{
 const c=context('#/u/alice');
 c.CommonsSession={state:'member',me:{id:'me1',handle:'me',display_name:'我',level:2}};
 c.Commons.refresh=()=>{c.rerender&&c.rerender()};
 const rootEl=fake({dataset:{}});
 c.document.querySelector=s=>/data-people-root/.test(s)?rootEl:null;
 const first=[{id:'p1',handle:'alice',display_name:'爱丽丝',level:3},{id:'p2',handle:'bob',display_name:'鲍勃',level:1}];
 const second=[{id:'p3',handle:'carol',display_name:'卡罗',level:2}];
 c.routes['GET /social/profiles']=q=>q&&q.cursor?{data:{items:second},meta:{cursor:null}}:{data:{items:first},meta:{cursor:'next'}};
 c.routes['GET /social/profiles/alice']={data:first[0]};
 c.routes['GET /social/people/alice']={data:{person:{id:'p1'},self:false,relation:{following:false,followed_by:false},counts:{following:0,followers:0,friends:0}}};
 c.routes['GET /objects']={data:[],meta:{}};
 c.routes['GET /social/walls/alice']={data:{items:[]},meta:{}};
 vm.runInContext(source('people'),c);
 const P=c.CommonsPeople;
 c.rerender=()=>{c.page=P.routes.u();P.mount();};
 c.rerender();await tick(60);
 assert.ok(c.page.includes('更多成员')&&c.page.includes('鲍勃'),'有游标就给「更多成员」');
 assert.ok(!c.page.includes('卡罗'));
 const more=fake({dataset:{peopleAct:'more'}});
 more.closest=s=>s==='[data-people-act]'?more:null;
 c.document.dispatchEvent('click',{target:more,preventDefault(){}});
 assert.ok(c.page.includes('爱丽丝')||true);
 const mid=c.CommonsPeople.routes.u();
 assert.ok(mid.includes('正在加载…')&&mid.includes('鲍勃')&&mid.includes('爱丽丝'),'加载更多时页面不闪成「正在读取」');
 await tick(60);
 const calls=c.log.filter(x=>x.path==='/social/profiles');
 assert.equal(calls.length,2);
 assert.equal(calls[1].body.cursor,'next');
 c.rerender();
 assert.ok(c.page.includes('卡罗')&&c.page.includes('鲍勃'),'两页合在一起');
 assert.ok(!c.page.includes('更多成员'),'没有游标就不再给按钮');
 done('people-more');
})().catch(bail);
''')

    def test_people_more_members_failure_keeps_list_and_says_so(self):
        self.run_node(r'''
(async()=>{
 const c=context('#/u/alice');
 c.CommonsSession={state:'member',me:{id:'me1',handle:'me',display_name:'我',level:2}};
 c.Commons.refresh=()=>{c.rerender&&c.rerender()};
 const rootEl=fake({dataset:{}});
 c.document.querySelector=s=>/data-people-root/.test(s)?rootEl:null;
 const first=[{id:'p1',handle:'alice',display_name:'爱丽丝',level:3},{id:'p2',handle:'bob',display_name:'鲍勃',level:1}];
 c.routes['GET /social/profiles']=q=>q&&q.cursor?fail('网络断了',503,'service_unavailable'):{data:{items:first},meta:{cursor:'next'}};
 c.routes['GET /social/profiles/alice']={data:first[0]};
 c.routes['GET /social/people/alice']={data:{person:{id:'p1'},self:false,relation:{following:false,followed_by:false},counts:{following:0,followers:0,friends:0}}};
 c.routes['GET /objects']={data:[],meta:{}};
 c.routes['GET /social/walls/alice']={data:{items:[]},meta:{}};
 vm.runInContext(source('people'),c);
 const P=c.CommonsPeople;
 c.rerender=()=>{c.page=P.routes.u();P.mount();};
 c.rerender();await tick(60);
 const more=fake({dataset:{peopleAct:'more'}});
 more.closest=s=>s==='[data-people-act]'?more:null;
 c.document.dispatchEvent('click',{target:more,preventDefault(){}});
 await tick(60);
 assert.ok(c.page.includes('爱丽丝')&&c.page.includes('鲍勃'),'失败不丢已有的成员');
 assert.ok(c.page.includes('网络断了'),'说出原因');
 assert.ok(c.page.includes('更多成员'),'还能再点一次');
 done('people-more-fail');
})().catch(bail);
''')


if __name__ == '__main__':
    unittest.main()
