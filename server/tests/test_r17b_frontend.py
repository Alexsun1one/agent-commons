"""R17-B 前端 · 入组申请审批、我的申请、组织动态详情、我提交的工具。

假数据的形状照真实路由写：orgs 和 tools 的列表都是 data: [...]，详情是 data: {...}。
"""
from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const source=name=>fs.readFileSync(root+'/preview/'+name+'.js','utf8');
const tick=async(n=30)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const reject=(status,message)=>Promise.reject(Object.assign(new Error(message||'boom'),{status}));
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){[...(events[type]||[])].forEach(f=>f(ev))}}}

function context(mode,hash,routes,pageMarker,renderFn){
  const posts=[],gets=[],toasts=[];
  let keys=0;
  const rootNode={innerHTML:'',dataset:{},querySelector:()=>null,querySelectorAll:()=>[]};
  const c=Object.assign(eventTarget(),{
    console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,RegExp,Error,
    setTimeout,clearTimeout,posts,gets,toasts,rootNode,
    location:{protocol:'https:',hash}
  });
  c.document=Object.assign(eventTarget(),{
    querySelector:s=>(rootNode.innerHTML.includes(pageMarker)&&(s===pageMarker||s==='[data-org-root]'||s==='.tools-page'))?rootNode:null
  });
  c.Commons={
    read:(k,fb)=>fb,write:()=>true,toast:m=>toasts.push(m),icon:()=>'',
    safeUrl:s=>/^(#\/|assets\/|https?:\/\/)/.test(String(s))?String(s):'#',
    refresh(){rootNode.innerHTML=renderFn(c);c.CommonsOrgs&&c.CommonsOrgs.mount();}
  };
  const lookup=(method,path,arg)=>{
    const r=routes[method+' '+path];
    if(r===undefined)return reject(404,'no '+path);
    return typeof r==='function'?r(arg):Promise.resolve(r);
  };
  c.CommonsAPI={
    mode,
    get(path,query){gets.push({path,query});return lookup('GET',path,query);},
    post(path,body,opts){posts.push({path,body,opts});return lookup('POST',path,body);},
    del(path,body,opts){posts.push({path,body,opts,method:'DELETE'});return lookup('DELETE',path,body);},
    newIdempotencyKey:()=>'idem-'+(++keys)
  };
  c.CommonsSession={me:{id:'me',handle:'me',level:3}};
  c.window=c;c.self=c;c.globalThis=c;
  vm.createContext(c);
  return c;
}
const btn=(dataset,extra)=>Object.assign({dataset,disabled:false,closest(s){return s==='[data-org-act]'&&dataset.orgAct?this:(s==='[data-tools-act]'&&dataset.toolsAct?this:null)}},extra||{});
const orgRender=c=>{const r=c.CommonsOrgs.routes;const parts=c.location.hash.replace(/^#\/?/,'').split('/');return parts[0]==='org'?r.org():r.orgs();};

const DETAIL=(me,extra)=>({data:Object.assign({id:'o1',slug:'team',name:'实验室',intro:'简介',type:'lab',typeLabel:'实验室',website:'',banner:'',
  verified:false,joinPolicy:'apply',joinPolicyLabel:'申请加入',members:1,followers:0,activity:1,followed:false,me,
  membersList:[{id:'owner',name:'所有者',handle:'owner',level:3,role:'owner',showOnProfile:true}],
  posts:[{id:'p1',type:'org_post',title:'本周进展',body:'正文',summary:'摘要',createdAt:'2026-10-28T08:00:00.000000Z',author:{id:'owner',name:'所有者',level:3,handle:'owner'}}],
  works:[],jobs:[],events:[]},extra||{}),meta:{}});
'''

QUEUE = r'''
(async()=>{
 const pending={data:[{id:'p2',handle:'xiaoming',name:'小明',level:2,note:'带着<b>作品</b>来',status:'pending',appliedAt:'2026-10-27T08:00:00.000000Z',reviewedAt:null,reviewNote:''}],meta:{}};
 let fail=true;
 const routes={
  'GET /orgs/team':DETAIL({state:'active',role:'owner',showOnProfile:true},{pendingApplications:1}),
  'GET /orgs/team/applications':q=>Promise.resolve(q&&q.status==='approved'?{data:[],meta:{}}:pending),
  'POST /orgs/team/applications/p2/review':()=>{if(fail){fail=false;return reject(500,'服务器忙');}return Promise.resolve({data:{id:'p2',status:'approved'},meta:{}});}
 };
 const c=context('live','#/org/team',routes,'data-org-root',orgRender);
 vm.runInContext(source('orgs'),c);
 c.rootNode.innerHTML=orgRender(c);
 c.CommonsOrgs.mount();
 await tick();
 let html=c.rootNode.innerHTML;
 assert.ok(html.includes('入组申请'),'manager sees the applications tab');
 assert.ok(html.includes('href="#/org/team/post/p1"'),'post title links to the detail sub-route');
 // 切到「入组申请」页签
 c.document.dispatchEvent('click',{target:btn({orgAct:'tab',value:'applications'})});
 await tick();
 html=c.rootNode.innerHTML;
 const get=c.gets.find(g=>g.path==='/orgs/team/applications');
 assert.ok(get&&get.query.status==='pending','loads pending applications with status query');
 assert.ok(html.includes('data-org-app="p2"'),'pending row rendered');
 assert.ok(html.includes('带着&lt;b&gt;作品&lt;/b&gt;来')&&!html.includes('<b>作品</b>'),'applicant note is escaped');
 assert.ok(html.includes('data-org-act="app-decide"'),'has decide buttons');
 // 第一次失败，第二次成功，两次用同一个幂等键
 const status={textContent:''};
 const input={value:' 欢迎 '};
 const bA={dataset:{orgAct:'app-decide',value:'approve'},disabled:false};
 const bB={dataset:{orgAct:'app-decide',value:'reject'},disabled:false};
 const row={dataset:{orgApp:'p2'},querySelector:s=>s==='input[name="note"]'?input:(s==='[data-org-form-status]'?status:null),querySelectorAll:()=>[bA,bB]};
 for(const b of [bA,bB])b.closest=s=>s==='[data-org-act]'?b:(s==='[data-org-app]'?row:null);
 c.document.dispatchEvent('click',{target:bA});
 await tick();
 assert.equal(status.textContent,'服务器忙','failure shown in the row');
 assert.equal(bA.disabled,false,'buttons unlocked after failure');
 c.document.dispatchEvent('click',{target:bA});
 await tick();
 const reviews=c.posts.filter(p=>p.path==='/orgs/team/applications/p2/review');
 assert.equal(reviews.length,2);
 assert.deepEqual(reviews[1].body,{decision:'approve',note:'欢迎'});
 assert.equal(reviews[0].opts.idempotencyKey,'idem-1');
 assert.equal(reviews[1].opts.idempotencyKey,'idem-1','retry reuses the same idempotency key');
 html=c.rootNode.innerHTML;
 assert.ok(!html.includes('data-org-app="p2"'),'decided row leaves the pending list');
 assert.ok(html.includes('没有待审的申请'),'empty pending copy');
 assert.ok(c.toasts.some(t=>t.includes('已通过')),'success toast');
 console.log('QUEUE_PASS approve flow, escape, key reuse');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

QUEUE_MEMBER = r'''
(async()=>{
 const routes={'GET /orgs/team':DETAIL({state:'active',role:'member',showOnProfile:true})};
 const c=context('live','#/org/team',routes,'data-org-root',orgRender);
 vm.runInContext(source('orgs'),c);
 c.rootNode.innerHTML=orgRender(c);
 c.CommonsOrgs.mount();
 await tick();
 const html=c.rootNode.innerHTML;
 assert.ok(html.includes('本周进展'),'detail loaded');
 assert.ok(!html.includes('入组申请'),'plain member has no applications tab');
 assert.ok(!c.gets.some(g=>g.path.includes('/applications')),'no applications request for a plain member');
 console.log('QUEUE_MEMBER_PASS no tab for members');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MINE = r'''
(async()=>{
 const items=[
  {slug:'a',name:'甲团队',type:'lab',typeLabel:'实验室',status:'pending',note:'想加入',appliedAt:'2026-10-27T08:00:00.000000Z',reviewedAt:null,reviewNote:''},
  {slug:'b',name:'乙团队',type:'company',typeLabel:'公司',status:'approved',note:'',appliedAt:'2026-10-20T08:00:00.000000Z',reviewedAt:'2026-10-21T08:00:00.000000Z',reviewNote:''},
  {slug:'c',name:'丙<团队>',type:'lab',typeLabel:'实验室',status:'rejected',note:'',appliedAt:'2026-10-10T08:00:00.000000Z',reviewedAt:'2026-10-11T08:00:00.000000Z',reviewNote:'名额满了'}];
 let mode='ok';
 const routes={'GET /orgs/mine/applications':()=>mode==='ok'?Promise.resolve({data:items,meta:{}}):(mode==='empty'?Promise.resolve({data:[],meta:{}}):reject(500,'读取失败'))};
 const c=context('live','#/orgs/mine',routes,'data-org-root',orgRender);
 vm.runInContext(source('orgs'),c);
 c.rootNode.innerHTML=orgRender(c);
 assert.ok(c.rootNode.innerHTML.includes('正在读取申请'),'loading first');
 c.CommonsOrgs.mount();
 await tick();
 let html=c.rootNode.innerHTML;
 assert.ok(!c.gets.some(g=>g.path==='/orgs'),'mine page does not load the directory');
 assert.ok(html.includes('待审 · 实验室')&&html.includes('已通过 · 公司')&&html.includes('已拒绝 · 实验室'),'three statuses');
 assert.ok(html.includes('已于 2026-10-11 拒绝：名额满了'),'reject reason shown');
 assert.ok(html.includes('href="#/org/c"'),'links to the org page');
 assert.ok(html.includes('丙&lt;团队&gt;')&&!html.includes('丙<团队>'),'name escaped');
 // 失败 → 重试
 mode='fail';
 c.location.hash='#/orgs';
 c.CommonsOrgs.mount();
 c.location.hash='#/orgs/mine';
 c.rootNode.innerHTML=orgRender(c);
 c.CommonsOrgs.mount();
 await tick();
 html=c.rootNode.innerHTML;
 assert.ok(html.includes('读取失败')&&html.includes('data-org-act="retry"'),'error with retry');
 mode='empty';
 c.document.dispatchEvent('click',{target:btn({orgAct:'retry'})});
 await tick();
 assert.ok(c.rootNode.innerHTML.includes('还没有申请记录'),'empty state after retry');
 console.log('MINE_PASS list, error, retry, empty');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

POST = r'''
(async()=>{
 let mode='ok';
 const routes={'GET /orgs/team/posts/p1':()=>mode==='ok'?Promise.resolve({data:{id:'p1',title:'本周<进展>',body:'第一段\n第二行\n\n第二段',summary:'摘要',tags:['周报'],
   createdAt:'2026-10-28T08:00:00.000000Z',updatedAt:'2026-10-28T08:00:00.000000Z',org:{slug:'team',name:'实验室'},author:{id:'owner',name:'所有者',level:3,handle:'owner'}},meta:{}}):reject(404,'not found')};
 const c=context('live','#/org/team/post/p1',routes,'data-org-root',orgRender);
 vm.runInContext(source('orgs'),c);
 c.rootNode.innerHTML=orgRender(c);
 c.CommonsOrgs.mount();
 await tick();
 let html=c.rootNode.innerHTML;
 assert.ok(c.gets.some(g=>g.path==='/orgs/team/posts/p1'),'fetches the post');
 assert.ok(!c.gets.some(g=>g.path==='/orgs/team'),'does not load the org detail');
 assert.ok(html.includes('本周&lt;进展&gt;')&&!html.includes('<进展>'),'title escaped');
 assert.ok(html.includes('<p>第一段<br>第二行</p>')&&html.includes('<p>第二段</p>'),'paragraphs and line breaks');
 assert.ok(html.includes('周报')&&html.includes('href="#/org/team"'),'tags and back link');
 mode='missing';
 c.location.hash='#/org/team/post/p9';
 routes['GET /orgs/team/posts/p9']=()=>reject(404,'not found');
 c.rootNode.innerHTML=orgRender(c);
 c.CommonsOrgs.mount();
 await tick();
 assert.ok(c.rootNode.innerHTML.includes('没有找到这条动态'),'404 copy');
 console.log('POST_PASS detail render, escape, 404');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

SAMPLE = r'''
(async()=>{
 const c=context('demo','#/orgs/mine',{},'data-org-root',orgRender);
 vm.runInContext(source('orgs'),c);
 const html=c.CommonsOrgs.routes.orgs();
 assert.ok(!html.includes('我的申请'),'sample directory has no live-only entry');
 assert.ok(!html.includes('正在读取申请'),'sample mode ignores the mine sub-route');
 assert.equal(c.gets.length,0,'sample mode makes no requests');
 console.log('SAMPLE_PASS demo unchanged');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

TOOLS = r'''
(async()=>{
 const rows=[
  {id:'t1',slug:'alpha-tool',name:'Alpha',vendor:'甲厂',category:'编程 Agent',official_url:'https://example.com/a',price_tier:'订阅',tags:[],summary:'',status:'active',created_at:'2026-10-20T08:00:00.000000Z',updated_at:'2026-10-21T08:00:00.000000Z',approved_at:'2026-10-21T08:00:00.000000Z',use_count:7},
  {id:'t2',slug:'beta-tool',name:'Beta<i>',vendor:'乙厂',category:'设计',official_url:'https://example.com/b',price_tier:'免费',tags:[],summary:'',status:'pending_review',created_at:'2026-10-27T08:00:00.000000Z',updated_at:'2026-10-27T08:00:00.000000Z',approved_at:null,use_count:0},
  {id:'t3',slug:'gamma-tool',name:'Gamma',vendor:'丙厂',category:'自动化',official_url:'https://example.com/g',price_tier:'按量',tags:[],summary:'',status:'hidden',created_at:'2026-10-01T08:00:00.000000Z',updated_at:'2026-10-02T08:00:00.000000Z',approved_at:null,use_count:0}];
 let mode='fail';
 const routes={
  'GET /tools/mine/submissions':()=>mode==='fail'?reject(500,'boom'):Promise.resolve(mode==='empty'?{data:[],meta:{}}:{data:rows,meta:{}}),
  'GET /tools':{data:[],meta:{}}
 };
 const render=c=>{const info=c.location.hash.replace(/^#\/?/,'').split('/');return c.CommonsTools.routes.tools();};
 const c=context('live','#/tools/my-submissions',routes,'tools-page',render);
 vm.runInContext(source('tools'),c);
 c.rootNode.innerHTML=render(c);
 assert.ok(c.rootNode.innerHTML.includes('正在读取你的投稿'),'loading first');
 c.CommonsTools.mount();
 await tick();
 let html=c.rootNode.innerHTML;
 assert.ok(c.gets.some(g=>g.path==='/tools/mine/submissions'),'fetches own submissions');
 assert.ok(!c.gets.some(g=>g.path==='/tools'),'does not load the ranking');
 assert.ok(html.includes('投稿记录没有载入')&&html.includes('data-tools-act="retry"'),'error with retry');
 mode='ok';
 c.document.dispatchEvent('click',{target:btn({toolsAct:'retry'})});
 await tick();
 html=c.rootNode.innerHTML;
 assert.ok(html.includes('审核中')&&html.includes('已上榜')&&html.includes('已下架'),'three review states');
 assert.ok(html.includes('7 人在用'),'active tool shows usage');
 assert.ok(html.includes('href="#/tool/alpha-tool"'),'active tool links to its page');
 assert.ok(!html.includes('href="#/tool/beta-tool"'),'pending tool has no public page link');
 assert.ok(html.includes('Beta&lt;i&gt;')&&!html.includes('Beta<i>'),'name escaped');
 mode='empty';
 c.location.hash='#/tools';
 c.CommonsTools.mount();
 c.location.hash='#/tools/my-submissions';
 c.rootNode.innerHTML=render(c);
 c.CommonsTools.mount();
 await tick();
 assert.ok(c.rootNode.innerHTML.includes('你还没有提交过工具'),'empty state');
 console.log('TOOLS_PASS submissions list, retry, empty');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

TOOLS_RANKING = r'''
(async()=>{
 const routes={'GET /tools':{data:[],meta:{}}};
 const render=c=>c.CommonsTools.routes.tools();
 const c=context('live','#/tools',routes,'tools-page',render);
 vm.runInContext(source('tools'),c);
 c.rootNode.innerHTML=render(c);
 c.CommonsTools.mount();
 await tick();
 assert.ok(c.rootNode.innerHTML.includes('href="#/tools/my-submissions"'),'ranking links to my submissions in live mode');
 const d=context('demo','#/tools',{},'tools-page',render);
 vm.runInContext(source('tools'),d);
 assert.ok(!d.CommonsTools.routes.tools().includes('my-submissions'),'sample ranking unchanged');
 console.log('TOOLS_RANKING_PASS entry link live only');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class R17BFrontend(unittest.TestCase):
    def run_node(self, script, marker):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn(marker, result.stdout)

    def test_manager_reviews_applications(self):
        self.run_node(QUEUE, 'QUEUE_PASS')

    def test_plain_member_has_no_applications_tab(self):
        self.run_node(QUEUE_MEMBER, 'QUEUE_MEMBER_PASS')

    def test_my_applications_page(self):
        self.run_node(MINE, 'MINE_PASS')

    def test_org_post_detail_page(self):
        self.run_node(POST, 'POST_PASS')

    def test_sample_mode_unchanged(self):
        self.run_node(SAMPLE, 'SAMPLE_PASS')

    def test_my_tool_submissions_page(self):
        self.run_node(TOOLS, 'TOOLS_PASS')

    def test_tools_ranking_entry_link(self):
        self.run_node(TOOLS_RANKING, 'TOOLS_RANKING_PASS')

    def test_no_stub_copy_left_on_wired_actions(self):
        orgs = (ROOT / 'preview' / 'orgs.js').read_text(encoding='utf-8')
        tools = (ROOT / 'preview' / 'tools.js').read_text(encoding='utf-8')
        for source in (orgs, tools):
            # 「还没开放」只允许出现在功能开关关闭（501 / capability_unavailable）的分支里
            for match in re.finditer('还没开放', source):
                window = source[max(0, match.start() - 260):match.start()]
                self.assertTrue('capability_unavailable' in window or "'closed'" in window or 'closed' in window,
                                window[-120:])


if __name__ == '__main__':
    unittest.main()
