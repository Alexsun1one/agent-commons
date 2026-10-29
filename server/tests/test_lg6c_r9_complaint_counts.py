"""LG-6C R9: governance first screen and admin overview surface the third-party complaint count (offline VM)."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const source=name=>fs.readFileSync(root+'/preview/'+name+'.js','utf8');
const tick=async(n=8)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)}}}
function context({mode,hash,routes={},complaints=[]}){
 const calls=[],rootNode={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],contains:()=>false};
 const c=Object.assign(eventTarget(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,AbortController,setTimeout,clearTimeout,
  location:{hash},calls,rootNode});
 c.document=Object.assign(eventTarget(),{activeElement:null,querySelector:s=>s==='[data-gov-root]'||s==='[data-admin-root]'?rootNode:null,querySelectorAll:()=>[],body:{classList:{add(){},remove(){},toggle(){}}}});
 c.CommonsAPI={mode,
  get(path,query){calls.push(path);const r=routes[path];return r===undefined?Promise.reject(Object.assign(Error('no fixture '+path),{status:404})):Promise.resolve({data:typeof r==='function'?r():r,meta:{}});},
  post(){return Promise.reject(Error('no write in this test'))},newIdempotencyKey:()=>'k'};
 c.window=c;c.self=c;vm.createContext(c);return c;
}
const stats={pending:3,opened_today:1,overdue:0,appeals_pending:0,awaiting_second:0,reviews:{},flags:{}};
const complaintRow=i=>({id:'gc-'+i,locator:'#/threads/x'+i,category:'copyright',statement:'第三方投诉说明 '+i,state:'pending',created_at:'2026-10-27T00:00:0'+i+'.000000Z'});
'''

GOVERN = r'''
(async()=>{
 const live=(complaints,hash)=>{
  const c=context({mode:'live',hash,complaints,routes:{'/governance/me':{governor:true,handle:'gov'},'/governance/stats':stats,'/governance/queue':[],'/governance/complaints':()=>complaints}});
  vm.runInContext(source('govern'),c);return c;
 };
 // first screen: own stat, separate from the case count, button goes straight to the tab
 let c=live([complaintRow(1),complaintRow(2)],'#/govern');
 c.CommonsGovern.routes.govern();c.CommonsGovern.mount();await tick();
 let html=c.rootNode.innerHTML;
 assert(html.includes('<span class="gov-stat-label">第三方投诉</span><strong>2</strong>'),'complaint stat shows 2');
 assert(html.includes('<span class="gov-stat-label">待处理</span><strong>3</strong>'),'case count untouched');
 assert(html.includes('data-gov-act="tab" data-value="complaints">待处理，点此查看'));
 assert(html.includes('aria-selected="true"')&&/id="gov-tab-queue" aria-selected="true"/.test(html),'plain #/govern opens the queue tab');
 c.CommonsGovern.destroy();
 // none pending
 c=live([],'#/govern');c.CommonsGovern.routes.govern();c.CommonsGovern.mount();await tick();
 html=c.rootNode.innerHTML;assert(html.includes('<strong>0</strong><small>没有待处理</small>'));assert(!html.includes('点此查看'));c.CommonsGovern.destroy();
 // count endpoint failing must not take the governance screen down
 c=context({mode:'live',hash:'#/govern',routes:{'/governance/me':{governor:true},'/governance/stats':stats,'/governance/queue':[]}});
 vm.runInContext(source('govern'),c);c.CommonsGovern.routes.govern();c.CommonsGovern.mount();await tick();
 html=c.rootNode.innerHTML;assert(html.includes('<span class="gov-stat-label">待处理</span><strong>3</strong>'));assert(!html.includes('第三方投诉</span><strong>'),'no stat when the count is unknown');c.CommonsGovern.destroy();
 // deep link from the admin overview
 c=live([complaintRow(1)],'#/govern?tab=complaints');c.CommonsGovern.routes.govern();c.CommonsGovern.mount();await tick();
 html=c.rootNode.innerHTML;
 assert(/id="gov-tab-complaints" aria-selected="true"/.test(html),'deep link selects the complaints tab');
 assert(html.includes('第三方投诉说明 1')||html.includes('gov-complaint-queue'),'complaint list is loaded');
 assert(c.calls.filter(p=>p==='/governance/complaints').length>=2);
 c.CommonsGovern.destroy();
 // a non-governor never gets the tab forced open on data they cannot read
 c=context({mode:'live',hash:'#/govern?tab=complaints',routes:{'/governance/me':{governor:false}}});
 vm.runInContext(source('govern'),c);c.CommonsGovern.routes.govern();c.CommonsGovern.mount();await tick();
 assert(!c.calls.includes('/governance/complaints'),'no complaint request for non-governors');c.CommonsGovern.destroy();
 // demo: no stat, no request
 const d=context({mode:'demo',hash:'#/govern',routes:{}});vm.runInContext(source('govern-sample'),d);vm.runInContext(source('govern'),d);
 const page=d.CommonsGovern.routes.govern();d.CommonsGovern.mount();await tick();
 assert(!page.includes('第三方投诉</span>')&&!d.rootNode.innerHTML.includes('点此查看'));assert.equal(d.calls.length,0);d.CommonsGovern.destroy();
 console.log('GOVERN_PASS own stat, button, empty, count failure, deep link, non-governor, demo');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

ADMIN = r'''
(async()=>{
 const render=(mutate)=>{
  const c=context({mode:'demo',hash:'#/admin',routes:{}});vm.runInContext(source('admin-sample'),c);
  if(mutate)mutate(c.COMMONS_ADMIN_SAMPLE.overview);
  vm.runInContext(source('admin'),c);const html=c.CommonsAdmin.routes.admin();return {html,c};
 };
 const base=render().html;
 assert(!base.includes('govern?tab=complaints'),'demo overview unchanged when the card is absent');
 const withCard=render(o=>{o.cards.complaints_pending={value:2,previous:null,status:'ok'};}).html;
 assert(withCard.includes('<a class="adm-text-danger" href="#/govern?tab=complaints">第三方投诉 2 件待处理</a>'),'KPI foot links to the tab');
 assert(withCard.includes('举报待办'),'report KPI still there');
 const zero=render(o=>{o.cards.complaints_pending={value:0,previous:null,status:'ok'};}).html;
 assert.equal(zero,base,'zero pending adds nothing');
 const todo=render(o=>{o.todos=(o.todos||[]).concat([{key:'gov_complaint',title:'第三方投诉待处理',count:2,urgency:'normal',oldest_at:o.as_of,link:'#/govern?tab=complaints'}]);}).html;
 assert(todo.includes('href="#/govern?tab=complaints"')&&todo.includes('第三方投诉待处理'),'todo row links straight to the tab');
 console.log('ADMIN_PASS KPI link only when pending, todo row deep link, demo unchanged');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class R9ComplaintCountTests(unittest.TestCase):
    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('_PASS ', result.stdout)

    def test_govern_first_screen_shows_complaint_count_and_deep_link(self):
        self.run_node(GOVERN)

    def test_admin_overview_links_complaints_to_the_tab(self):
        self.run_node(ADMIN)


if __name__ == '__main__':
    unittest.main()
