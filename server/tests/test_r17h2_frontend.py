"""R17-H2 · 管理后台「赞助 / 讲师申请」审核页 + 阅读入口保存（离线 VM，不起服务）。
运行：cd server && python3 -m unittest tests.test_r17h2_frontend -q
反跑：R17H2_ADMIN=改前的 admin.js 路径、R17H2_APP=改前的 app.js 路径。"""
from pathlib import Path
import os
import subprocess
import unittest

from tests.test_lg6c_app_shell import COMMON as APP_SHELL

ROOT = Path(__file__).resolve().parents[2]

ADMIN_COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const ADMIN=fs.readFileSync(process.env.R17H2_ADMIN||(root+'/preview/admin.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const settle=async()=>{for(let i=0;i<12;i++)await tick();};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatch(e){for(const f of [...(events[e.type]||[])])f(e);}}}
const PEOPLE=[{id:'a1',kind:'sponsor',state:'submitted',applicant:{id:'u1',handle:'maple',display_name:'枫<i>'},fields:{brand:'示例科技<b>',types:['title','jobs'],budget:'¥5,000 以下',time:'本月',note:'想冠名'},decision_note:null,created_at:'2026-10-27T00:00:00Z'},
              {id:'a2',kind:'lecturer',state:'submitted',applicant:{id:'u2',handle:'river',display_name:'川'},fields:{title:'用 Agent 做周报',form:'workshop',length:'2 小时',price:'¥149 / 席',note:''},decision_note:null,created_at:'2026-10-26T00:00:00Z'}];
function build({live=true,totp=true,roles=['admin']}={}){
  const doc=Object.assign(eventTarget(),{activeElement:null});
  const rootEl=Object.assign(eventTarget(),{innerHTML:'',contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[]});
  doc.querySelector=s=>s==='[data-admin-root]'?rootEl:null;
  const calls=[];const handlers={};
  const api={mode:live?'live':'demo',newIdempotencyKey:(()=>{let n=0;return()=>'key-'+(++n)})(),
    me:()=>Promise.resolve({handle:'boss',display_name:'管理员',roles,totp_enabled:totp,level:5}),
    get:(path,q)=>{calls.push({m:'GET',path,q});const h=handlers['GET '+path];return h?h(q):Promise.reject(Object.assign(new Error('nf'),{status:404}));},
    post:(path,body,opts)=>{calls.push({m:'POST',path,body,opts});const h=handlers['POST '+path];return h?h(body):Promise.reject(Object.assign(new Error('nf'),{status:404}));}};
  const w={console,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,Map,Set,URLSearchParams,AbortController,setTimeout:()=>1,clearTimeout(){},
    document:doc,CommonsAPI:api,location:{hash:'#/admin/biz/applications'},CommonsPages:[],Commons:{toast(){}}};
  w.window=w;vm.createContext(w);vm.runInContext(ADMIN,w);
  const el=(attrs,extra)=>Object.assign({tagName:'BUTTON',getAttribute:k=>attrs[k]==null?null:attrs[k],closest(){return this}},extra||{});
  const click=(attrs)=>{const e=el(attrs);doc.dispatch({type:'click',target:e,preventDefault(){}});};
  const form=(values)=>{ // 用户在表单里输入，再提交
    for(const [k,v] of Object.entries(values))rootEl.dispatch({type:'input',target:el({'data-adm-flow':k},{value:v})});
    const f=el({'data-adm-form':'flow'});rootEl.dispatch({type:'submit',target:f,preventDefault(){}});};
  const open=async()=>{const html=w.CommonsAdmin.routes.admin();rootEl.innerHTML=html;w.CommonsAdmin.mount();await settle();};
  return {w,api,calls,handlers,rootEl,click,form,open,PEOPLE};
}
const decide=(id,value)=>({'data-adm':'app-decide','data-id':id,'data-value':value});
const done=name=>{console.log('_PASS '+name);process.exit(0);};
const bail=e=>{console.error(e);process.exit(1);};
'''

APP_COMMON = APP_SHELL.replace("vm.runInContext(source('api'),c);vm.runInContext(original?BEFORE:source('app'),c);",
    "vm.runInContext(source('api'),c);vm.runInContext(process.env.R17H2_APP?fs.readFileSync(process.env.R17H2_APP,'utf8'):(original?BEFORE:source('app')),c);")
assert 'R17H2_APP' in APP_COMMON


class R17H2Frontend(unittest.TestCase):
    def run_admin(self, script):
        result = subprocess.run(['node', '-e', ADMIN_COMMON + script, str(ROOT)], capture_output=True, text=True, env=dict(os.environ))
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def run_app(self, script):
        result = subprocess.run(['node', '-e', APP_COMMON + script, str(ROOT)], capture_output=True, text=True, env=dict(os.environ))
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    # ------------------------------------------------------------ admin.js
    def test_admin_lists_applications_escapes_and_filters(self):
        self.run_admin(r'''
(async()=>{
 const x=build();
 x.handlers['GET /admin/social/applications']=q=>Promise.resolve({data:{items:q.state==='submitted'?(q.kind==='lecturer'?[PEOPLE[1]]:PEOPLE):[]},meta:{}});
 await x.open();
 let html=x.rootEl.innerHTML;
 const first=x.calls.find(c=>c.path==='/admin/social/applications');
 assert.ok(first&&first.q.state==='submitted'&&first.q.limit===30,'默认读待审');
 assert.ok(html.includes('赞助合作')&&html.includes('讲师计划'),'两类申请都画出来');
 assert.ok(html.includes('枫&lt;i&gt;')&&!html.includes('枫<i>'),'申请人名字被转义');
 assert.ok(html.includes('示例科技&lt;b&gt;')&&html.includes('活动冠名、招聘'),'表单内容转义，类型用中文');
 assert.ok(html.includes('data-adm="app-decide"'),'待审有处理按钮');
 // 按类型筛
 x.click({'data-adm':'apps-kind','data-value':'lecturer'});await settle();
 html=x.rootEl.innerHTML;
 assert.ok(x.calls.some(c=>c.path==='/admin/social/applications'&&c.q.kind==='lecturer'),'类型筛选带到接口');
 assert.ok(html.includes('讲师计划')&&!html.includes('示例科技'),'只剩讲师申请');
 // 按状态筛：已通过里没有处理按钮，空态有话
 x.click({'data-adm':'apps-state','data-value':'approved'});await settle();
 html=x.rootEl.innerHTML;
 assert.ok(x.calls.some(c=>c.q&&c.q.state==='approved'),'状态筛选带到接口');
 assert.ok(!html.includes('data-adm="app-decide"')&&html.includes('这里还没有记录'));
 done('list-filter');
})().catch(bail);
''')

    def test_admin_decision_needs_note_posts_with_stable_key_and_refreshes(self):
        self.run_admin(r'''
(async()=>{
 const x=build();
 let list=[PEOPLE[0]];
 x.handlers['GET /admin/social/applications']=q=>Promise.resolve({data:{items:q.state==='submitted'?list:[]},meta:{}});
 let fail=true;
 x.handlers['POST /admin/social/applications/a1/decision']=b=>fail?Promise.reject(Object.assign(new Error('服务器忙'),{status:500})):(list=[],Promise.resolve({data:{state:b.decision}}));
 await x.open();
 x.click(decide('a1','approved'));
 assert.ok(x.rootEl.innerHTML.includes('name="reason"'),'点通过出现说明框');
 x.form({reason:' '});
 assert.ok(x.rootEl.innerHTML.includes('请写理由'),'说明必填');
 assert.ok(!x.calls.some(c=>c.m==='POST'),'没写说明不发请求');
 x.form({reason:'欢迎，稍后联系你'});
 assert.ok(x.rootEl.innerHTML.includes('确认通过')&&x.rootEl.innerHTML.includes('不能撤回'));
 x.click({'data-adm':'flow-run'});await settle();
 let posts=x.calls.filter(c=>c.m==='POST');
 assert.equal(posts.length,1);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(posts[0].body)),{decision:'approved',note:'欢迎，稍后联系你'});
 assert.ok(posts[0].opts.idempotencyKey,'带幂等键');
 assert.ok(x.rootEl.innerHTML.includes('服务器忙'),'失败如实写出来');
 assert.ok(x.rootEl.innerHTML.includes('确认通过'),'失败停在确认步，可再试');
 fail=false;
 x.click({'data-adm':'flow-run'});await settle();
 posts=x.calls.filter(c=>c.m==='POST');
 assert.equal(posts.length,2);
 assert.equal(posts[1].opts.idempotencyKey,posts[0].opts.idempotencyKey,'重试沿用同一个幂等键');
 assert.ok(x.rootEl.innerHTML.includes('已通过'),'成功显示已通过');
 x.click({'data-adm':'flow-close'});await settle();
 const lists=x.calls.filter(c=>c.m==='GET'&&c.path==='/admin/social/applications');
 assert.ok(lists.length>=2,'处理后重新读取列表');
 assert.ok(x.rootEl.innerHTML.includes('没有待审的申请'),'列表里不再有这份申请');
 done('decide');
})().catch(bail);
''')

    def test_admin_reject_also_needs_note_and_paging_appends(self):
        self.run_admin(r'''
(async()=>{
 const x=build();
 const more=Object.assign({},PEOPLE[1],{id:'a3',applicant:{id:'u3',handle:'pine',display_name:'松'}});
 x.handlers['GET /admin/social/applications']=q=>Promise.resolve(q.cursor?{data:{items:[more]},meta:{}}:{data:{items:[PEOPLE[0]]},meta:{cursor:'c-1'}});
 x.handlers['POST /admin/social/applications/a1/decision']=b=>Promise.resolve({data:{state:b.decision}});
 await x.open();
 assert.ok(x.rootEl.innerHTML.includes('data-adm="apps-more"'),'有下一页就给按钮');
 x.click({'data-adm':'apps-more'});await settle();
 assert.ok(x.calls.some(c=>c.q&&c.q.cursor==='c-1'),'带 cursor 读下一页');
 assert.ok(x.rootEl.innerHTML.includes('松')&&x.rootEl.innerHTML.includes('枫'),'追加而不是替换');
 assert.ok(!x.rootEl.innerHTML.includes('data-adm="apps-more"'),'没有下一页就不画按钮');
 x.click(decide('a1','rejected'));
 x.form({reason:''});
 assert.ok(x.rootEl.innerHTML.includes('请写理由'),'不通过也要写说明');
 x.form({reason:'目前不合适'});
 assert.ok(x.rootEl.innerHTML.includes('确认不通过'));
 x.click({'data-adm':'flow-run'});await settle();
 const post=x.calls.find(c=>c.m==='POST');
 assert.equal(post.body.decision,'rejected');assert.equal(post.body.note,'目前不合适');
 done('reject-paging');
})().catch(bail);
''')

    def test_admin_without_totp_says_enable_first_and_blocks_decisions(self):
        self.run_admin(r'''
(async()=>{
 const x=build({totp:false});
 x.handlers['GET /admin/social/applications']=()=>Promise.resolve({data:{items:[PEOPLE[0]]},meta:{}});
 await x.open();
 const html=x.rootEl.innerHTML;
 assert.ok(html.includes('需要先开启两步验证')&&html.includes('href="#/account"'),'页面顶部提示先开动态验证码并给入口');
 assert.ok(/data-adm="app-decide"[^>]*disabled/.test(html),'没开验证码时通过 / 不通过按钮是灰的');
 x.click(decide('a1','approved'));
 x.form({reason:'欢迎'});
 assert.ok(!x.calls.some(c=>c.m==='POST'),'没开验证码绝不发请求');
 assert.ok(x.rootEl.innerHTML.includes('需要先开启两步验证'));
 done('totp-gate');
})().catch(bail);
''')

    def test_admin_non_admin_and_api_errors_are_not_faked(self):
        self.run_admin(r'''
(async()=>{
 let x=build();
 x.handlers['GET /admin/social/applications']=()=>Promise.reject(Object.assign(new Error('没有权限'),{status:403}));
 await x.open();
 assert.ok(x.rootEl.innerHTML.includes('没有权限'),'403 如实显示');
 assert.ok(!x.rootEl.innerHTML.includes('示例科技'),'live 读不到不回退示例');
 x=build();
 x.handlers['GET /admin/social/applications']=()=>Promise.reject(Object.assign(new Error('服务器忙'),{status:500}));
 await x.open();
 assert.ok(x.rootEl.innerHTML.includes('没有读出来')&&x.rootEl.innerHTML.includes('重试'));
 done('errors');
})().catch(bail);
''')

    def test_admin_demo_mode_uses_local_rows_and_never_posts(self):
        self.run_admin(r'''
(async()=>{
 const x=build({live:false});
 x.w.COMMONS_ADMIN_SAMPLE={viewer:{handle:'boss',display_name:'管理员',roles:['admin'],totp_enabled:true},users:[],audit:[],overview:{cards:{},todos:[]}};
 await x.open();
 let html=x.rootEl.innerHTML;
 assert.ok(html.includes('示例科技')&&html.includes('data-adm="app-decide"'),'示例模式有本地示例');
 x.click(decide('demo-app-1','approved'));
 x.form({reason:'欢迎',totp:'12'});
 assert.ok(x.rootEl.innerHTML.includes('6 位'),'示例模式也要 6 位验证码');
 x.form({reason:'欢迎',totp:'123456'});
 x.click({'data-adm':'flow-run'});await settle();
 assert.ok(!x.calls.some(c=>c.m==='POST'||c.m==='GET'),'示例模式不碰接口');
 x.click({'data-adm':'flow-close'});
 assert.ok(!x.rootEl.innerHTML.includes('示例科技')||!x.rootEl.innerHTML.includes('data-id="demo-app-1"'),'处理后从待审里消失');
 done('demo');
})().catch(bail);
''')

    # ------------------------------------------------------------ app.js：阅读入口保存
    SIG = r'''
const done=name=>{console.log('_PASS '+name);process.exit(0);};
const bail=e=>{console.error(e);process.exit(1);};
const click=(c,attrs)=>{const el=Object.assign({disabled:false,tagName:'BUTTON',focus(){},dataset:attrs,closest:s=>s==='[data-action]'?el:null,getAttribute:k=>attrs[k.replace('data-','')]??null},{});
  c.document.dispatch?c.document.dispatch({type:'click',target:el,preventDefault(){}}):c.document.dispatchEvent({type:'click',target:el,preventDefault(){}});return el;};
'''

    def test_signal_save_live_reads_saved_posts_with_stable_key_and_gates(self):
        self.run_app(self.SIG + r'''
(async()=>{
 const x=setup(false,false),{c,nodes}=x;c.CommonsMotion.reveal=()=>{};await answer(x,200,Object.assign({},member,{capabilities:['social.signal']}));
 const gets=[],puts=[];let saved=['W'],failPut=true;
 c.CommonsAPI.mode='live';
 c.CommonsAPI.get=p=>{gets.push(p);return p==='/social/signals'?Promise.resolve({data:{items:saved}}):Promise.reject(Object.assign(new Error('nf'),{status:404}));};
 c.CommonsAPI.put=(p,b,o)=>{puts.push({p,b,o});return failPut?Promise.reject(Object.assign(new Error('服务器忙'),{status:500})):Promise.resolve({data:{}});};
 c.location.hash='#/sources';c.Commons.refresh();
 for(let i=0;i<10;i++)await tick();
 let html=nodes['#main'].innerHTML;
 assert.ok(gets.includes('/social/signals'),'进来读已保存的入口');
 assert.equal(gets.filter(p=>p==='/social/signals').length,1,'只读一次，不循环刷新');
 assert.ok(!html.includes('这个功能还没开放'),'不再写死关闭');
assert.ok(/data-action="signal-save" data-id="L"/.test(html)&&/data-action="signal-save" data-id="X"/.test(html),'没存过的来源有保存按钮');
 assert.ok(!/data-action="signal-save" data-id="W"/.test(html)&&html.includes('已保存'),'已存的显示已保存且不能再点');
 // 失败：如实提示，按钮可再点
 const b1=click(c,{action:'signal-save',id:'L'});
 await tick();await tick();
 assert.equal(puts.length,1);assert.equal(puts[0].p,'/social/signals/L');
 assert.ok(puts[0].o.idempotencyKey,'带幂等键');
 assert.equal(b1.disabled,false,'失败后按钮恢复');
 failPut=false;
 click(c,{action:'signal-save',id:'L'});
 for(let i=0;i<10;i++)await tick();
 assert.equal(puts.length,2);
 assert.equal(puts[1].o.idempotencyKey,puts[0].o.idempotencyKey,'重试沿用同一个幂等键');
 html=nodes['#main'].innerHTML;
 assert.ok(!/data-action="signal-save" data-id="L"/.test(html),'保存成功后 L 变成已保存');
 // 被权限挡住：按钮灰掉并写出原因
 await answer(x,200,Object.assign({},member,{capabilities:[],capability_reasons:{'social.signal':{reason:'level',min_level:2,level:1,roles:[]}}}));
 c.location.hash='#/sources';c.Commons.refresh();
 for(let i=0;i<5;i++)await tick();
 html=nodes['#main'].innerHTML;
 assert.ok(html.includes('需要 L2（你现在是 L1）')&&/disabled title="需要 L2/.test(html),'灰掉并显示 reason()');
 done('signal-live');
})().catch(bail);
''')

    def test_signal_save_sample_mode_unchanged(self):
        self.run_app(self.SIG + r'''
(async()=>{
 const x=setup(true,false),{c,nodes,stored}=x;c.CommonsMotion.reveal=()=>{};
 c.location.hash='#/sources';c.Commons.refresh();
 const html=nodes['#main'].innerHTML;
 assert.ok(/data-action="signal-save" data-id="W"/.test(html)&&!html.includes('这个功能还没开放'),'示例模式保留原按钮');
 click(c,{action:'signal-save',id:'W'});
 assert.equal(stored['commons.prototype.signals'],'["W"]','示例模式仍写本机');
 done('signal-sample');
})().catch(bail);
''')


if __name__ == '__main__':
    unittest.main()
