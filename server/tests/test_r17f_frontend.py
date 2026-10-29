"""R17-F 前端 · 真实模式的实战工坊、合作机会、共同项目（hubs.js）和组织星图（constellation.js）。

假数据的形状照 orgs 模块 hub 路由写：列表是 data: [...]，工坊是 data: {events, skills}，来源状态在 meta.sources。
"""
from __future__ import annotations

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
const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function context(mode,routes){
  const gets=[],refreshes=[];
  const c=Object.assign(eventTarget(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,RegExp,Error,setTimeout,clearTimeout,gets,refreshes});
  c.document=eventTarget();
  c.matchMedia=()=>({matches:false});
  c.Commons={esc:escape,safeUrl:s=>/^(#\/|assets\/|https?:\/\/)/.test(String(s))?String(s):'#',icon:()=>'',avatar:()=>'<span class="avatar"></span>',
    refresh(){refreshes.push(1);},read:(k,fb)=>fb,write:()=>true,toast(){}};
  c.CommonsAPI={mode,get(path,query){gets.push({path,query});const r=routes[path];if(r===undefined)return reject(404,'no '+path);return typeof r==='function'?r():Promise.resolve(r);}};
  c.window=c;c.self=c;c.globalThis=c;
  vm.createContext(c);
  return c;
}
const btn=dataset=>({dataset,closest(s){return s==='[data-hubs-act]'&&dataset.hubsAct?this:null}});
'''

OPPS = r'''
(async()=>{
 const items=[
  {id:'m1',kind:'collab',kindLabel:'合作与外包',title:'找人做<检索>评测',excerpt:'细节见正文',facts:[{label:'预算',value:'¥3000'},{label:'周期',value:'两周'}],author:'甲',createdAt:'2026-10-27T08:00:00.000000Z',href:'#/market/m1',orgSlug:null},
  {id:'m2',kind:'jobs',kindLabel:'内推与招聘',title:'招 Agent 工程师',excerpt:'',facts:[{label:'公司',value:'招人实验室'}],author:'乙',createdAt:'2026-10-26T08:00:00.000000Z',href:'#/market/m2',orgSlug:'hire-team'},
  {id:'o1',kind:'team',kindLabel:'团队招募',title:'招人实验室 招募新成员',excerpt:'一起做作品',facts:[{label:'成员',value:'3'}],author:'',createdAt:'2026-10-25T08:00:00.000000Z',href:'#/org/hire-team',orgSlug:'hire-team'}];
 let mode='ok';
 const routes={'/orgs/hub/opportunities':()=>mode==='ok'?Promise.resolve({data:items,meta:{sources:{collab:'ok',jobs:'unavailable',team:'ok'}}}):(mode==='empty'?Promise.resolve({data:[],meta:{sources:{}}}):reject(500,'读取失败'))};
 const c=context('live',routes);
 vm.runInContext(source('hubs'),c);
 const H=c.CommonsHubs;
 assert.ok(H.livePage('opportunities').includes('正在读取'),'loading first');
 await tick();
 assert.equal(c.refreshes.length,1,'refresh once after load');
 let html=H.livePage('opportunities');
 assert.equal(c.gets.length,1,'no refetch while fresh');
 assert.ok(html.includes('找人做&lt;检索&gt;评测')&&!html.includes('<检索>'),'title escaped');
 assert.ok(html.includes('预算 ¥3000')&&html.includes('周期 两周'),'facts');
 assert.ok(html.includes('href="#/market/m1"')&&html.includes('href="#/org/hire-team"'),'links');
 assert.ok(html.includes('内推与招聘暂时没有开放'),'unavailable source is called out');
 assert.ok(html.includes('我想参与')&&html.includes('去看看'),'button wording by kind');
 assert.ok(html.includes('href="#/market/new"'),'publish entry');
 // 过滤
 c.document.dispatchEvent('click',{target:btn({hubsAct:'filter',value:'team'})});
 html=H.livePage('opportunities');
 assert.ok(html.includes('招人实验室 招募新成员')&&!html.includes('找人做'),'filter to teams');
 assert.ok(html.includes('data-value="team" aria-pressed="true"'),'chip pressed');
 // 空 / 错误 / 重试
 mode='empty';
 c.document.dispatchEvent('click',{target:btn({hubsAct:'retry',value:'opportunities'})});
 assert.ok(H.livePage('opportunities').includes('正在读取'));
 await tick();
 html=H.livePage('opportunities');
 assert.ok(html.includes('还没有合作机会')&&html.includes('href="#/market/new"'),'empty copy with where to start');
 mode='fail';
 c.document.dispatchEvent('click',{target:btn({hubsAct:'retry',value:'opportunities'})});
 H.livePage('opportunities');
 await tick();
 html=H.livePage('opportunities');
 assert.ok(html.includes('读取失败')&&html.includes('data-hubs-act="retry"'),'error with retry');
 console.log('OPPS_PASS list, escape, filter, sources, empty, error');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

PROJECTS = r'''
(async()=>{
 const routes={'/orgs/hub/projects':{data:[
  {org:{slug:'star-team',name:'星队<A>',typeLabel:'实验室',verified:true,intro:'做评测'},members:3,workCount:2,latestAt:'2026-10-28T08:00:00.000000Z',
   works:[{id:'w1',title:'检索评测台',summary:'',createdAt:'2026-10-28T08:00:00.000000Z',author:'甲',authorHandle:'jia'}]}],meta:{}}};
 const c=context('live',routes);
 vm.runInContext(source('hubs'),c);
 const H=c.CommonsHubs;
 H.livePage('project');
 await tick();
 const html=H.livePage('project');
 assert.ok(html.includes('星队&lt;A&gt;')&&!html.includes('星队<A>'),'team name escaped');
 assert.ok(html.includes('href="#/org/star-team"')&&html.includes('href="#/work/w1"'),'team and work links');
 assert.ok(html.includes('3 位成员')&&html.includes('2 件作品')&&html.includes('已认证'),'facts');
 // 空
 const d=context('live',{'/orgs/hub/projects':{data:[],meta:{}}});
 vm.runInContext(source('hubs'),d);
 d.CommonsHubs.livePage('project');
 await tick();
 const empty=d.CommonsHubs.livePage('project');
 assert.ok(empty.includes('还没有共同项目')&&empty.includes('href="#/orgs"'),'empty copy with where to start');
 assert.ok(!empty.includes('知识助手'),'no sample copy');
 console.log('PROJECTS_PASS cards, empty');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

WORKSHOP = r'''
(async()=>{
 let mode='ok';
 const full={data:{events:[{id:'e1',title:'三天检索 Agent',summary:'动手做',kindLabel:'挑战赛',statusLabel:'进行中',status:'live',startsAt:'2026-10-28T09:00:00.000000Z',endsAt:'2026-10-30T09:00:00.000000Z',place:'站内',host:'陈墨',signups:5,href:'#/event/e1'}],
   skills:[{id:'s1',title:'验证<改动>',category:'编程',purpose:'让改动可核验',author:'甲',href:'#/skills/s1'}]},meta:{sources:{events:'ok',skills:'ok'}}};
 const routes={'/orgs/hub/workshop':()=>mode==='ok'?Promise.resolve(full):(mode==='empty'?Promise.resolve({data:{events:[],skills:[]},meta:{sources:{events:'unavailable',skills:'ok'}}}):reject(501,'x'))};
 const c=context('live',routes);
 vm.runInContext(source('hubs'),c);
 const H=c.CommonsHubs;
 H.livePage('workshop');
 await tick();
 let html=H.livePage('workshop');
 assert.ok(html.includes('三天检索 Agent')&&html.includes('href="#/event/e1"')&&html.includes('5 人报名'),'event row');
 assert.ok(html.includes('验证&lt;改动&gt;')&&html.includes('href="#/skills/s1"')&&html.includes('照着做'),'skill row escaped');
 // R17-F2：行内的标签必须包在 .hubp-kind（flex）里，不能是网格 div 的直接子元素，否则会被拉成整行方框
 const rows=html.split('<li>').slice(1);
 assert.ok(rows.length>=2,'event and skill rows');
 for(const row of rows){
   assert.ok(/<li>/.test('<li>'+row)&&/^<div><div class="hubp-kind">(<span class="pill [^"]*">[^<]*<\/span>)+<\/div><h3>/.test(row),'pills wrapped in hubp-kind: '+row.slice(0,160));
 }
 assert.ok(rows[0].includes('挑战赛')&&rows[0].includes('进行中'),'both event tags stay together');
 mode='empty';
 c.document.dispatchEvent('click',{target:btn({hubsAct:'retry',value:'workshop'})});
 H.livePage('workshop');
 await tick();
 html=H.livePage('workshop');
 assert.ok(html.includes('还没有可练习的内容')&&html.includes('href="#/events"')&&html.includes('href="#/skills"'),'empty copy with where to start');
 assert.ok(html.includes('活动暂时没有开放'),'unavailable event source called out');
 mode='closed';
 c.document.dispatchEvent('click',{target:btn({hubsAct:'retry',value:'workshop'})});
 H.livePage('workshop');
 await tick();
 assert.ok(H.livePage('workshop').includes('这个功能还没开放'),'501 shows the closed copy');
 console.log('WORKSHOP_PASS events, skills, empty, closed');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

NAV = r'''
(async()=>{
 const live=context('live',{});
 vm.runInContext(source('hubs'),live);
 const demo=context('demo',{});
 vm.runInContext(source('hubs'),demo);
 const tabs=ctx=>ctx.CommonsHubs.HUBS.find(h=>h.id==='people').tabs.map(t=>t.route);
 assert.ok(tabs(live).includes('constellation'),'live has the 星图 tab');
 assert.ok(!tabs(demo).includes('constellation'),'demo nav unchanged');
 assert.equal(live.CommonsHubs.locate('constellation').hub.id,'people');
 assert.equal(demo.CommonsHubs.livePage('nope'),'');
 console.log('NAV_PASS live-only star tab');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

STAR = r'''
(async()=>{
 const rows=[
  {id:'o1',slug:'star-team',name:'星队<A>',typeLabel:'实验室',intro:'做评测',ownerId:'u1',verified:false,weight:9,
   people:[{id:'u1',handle:'jia',name:'甲',level:3,role:'owner'},{id:'u2',handle:'yi',name:'乙',level:2,role:'member'}],
   works:[{id:'w1',title:'检索评测台',authorId:'u1'}]},
  {id:'o2',slug:'side-team',name:'旁队',typeLabel:'公司',intro:'',ownerId:'u2',verified:false,weight:4,
   people:[{id:'u2',handle:'yi',name:'乙',level:2,role:'owner'}],works:[]}];
 let mode='ok';
 const routes={'/orgs/hub/constellation':()=>mode==='ok'?Promise.resolve({data:rows,meta:{}}):(mode==='empty'?Promise.resolve({data:[],meta:{}}):reject(500,'读取失败'))};
 const c=context('live',routes);
 vm.runInContext(source('constellation'),c);
 const S=c.CommonsConstellation;
 assert.ok(S.render().includes('正在读取'),'loading first');
 await tick();
 assert.equal(c.refreshes.length,1,'refresh once');
 const html=S.render();
 assert.equal(c.gets.length,1,'no refetch while fresh');
 assert.ok(html.includes('2 个团队 / 2 位成员 / 1 件团队作品'),'live data note counts people once');
 assert.ok(!html.includes('示例作品'),'no sample wording');
 assert.ok(html.includes('沿着团队，找到作品与成员')&&html.includes('内环 · 团队'),'live copy');
 assert.ok(html.includes('星队&lt;A&gt;')&&!html.includes('星队<A>'),'org name escaped');
 assert.ok(html.includes('atlas-initial'),'initial instead of sample avatar');
 const graph=S.buildGraph();
 const kinds=k=>graph.nodes.filter(n=>n.kind===k).length;
 assert.deepEqual([kinds('work'),kinds('method'),kinds('person')],[2,1,2],'two teams, one work, two distinct members');
 const edges=graph.edges.filter(e=>e.from==='person:u2').map(e=>e.to).sort();
 assert.deepEqual(edges,['work:o1','work:o2'],'a member in two teams links to both');
 assert.ok(html.includes('data-action="constellation-select"'),'nodes are selectable');
 // 空 / 错误 / 重试
 mode='empty';
 const d=context('live',routes);
 vm.runInContext(source('constellation'),d);
 d.CommonsConstellation.render();await tick();
 const empty=d.CommonsConstellation.render();
 assert.ok(empty.includes('还没有可展示的团队')&&empty.includes('href="#/orgs"'),'empty copy with where to start');
 mode='fail';
 const e=context('live',routes);
 vm.runInContext(source('constellation'),e);
 e.CommonsConstellation.render();await tick();
 let err=e.CommonsConstellation.render();
 assert.ok(err.includes('读取失败')&&err.includes('data-action="constellation-retry"'),'error with retry');
 mode='ok';
 assert.equal(e.CommonsConstellation.handle('constellation-retry',{dataset:{}}),true);
 await tick();
 assert.ok(e.CommonsConstellation.render().includes('2 个团队'),'retry recovers');
 // 路由与示例模式
 const page=c.CommonsPages.find(p=>p.routes&&p.routes.constellation);
 assert.ok(page,'registers the constellation route');
 const demo=context('demo',{});
 demo.COMMONS_DATA={people:[],works:[],methods:[]};
 vm.runInContext(source('constellation'),demo);
 const sample=demo.CommonsConstellation.render();
 assert.ok(sample.includes('示例作品 · 0 位同行')&&sample.includes('沿着作品，找到方法与同行'),'demo copy unchanged');
 assert.equal(demo.gets.length,0,'demo makes no request');
 console.log('STAR_PASS live graph, escape, states, demo unchanged');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class R17FFrontend(unittest.TestCase):
    def run_node(self, script, marker):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn(marker, result.stdout)

    def test_live_opportunities(self):
        self.run_node(OPPS, 'OPPS_PASS')

    def test_live_projects(self):
        self.run_node(PROJECTS, 'PROJECTS_PASS')

    def test_live_workshop(self):
        self.run_node(WORKSHOP, 'WORKSHOP_PASS')

    def test_star_tab_is_live_only(self):
        self.run_node(NAV, 'NAV_PASS')

    def test_live_constellation(self):
        self.run_node(STAR, 'STAR_PASS')


if __name__ == '__main__':
    unittest.main()
