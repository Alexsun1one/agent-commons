"""R17-R2 修补：账号隔离、撤销、翻页、幂等、真实头像、星图和错误透传。"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from app import accounts
from app.errors import ApiError
from modules.orgs import hub
from tests.test_r17e_wiring_js import LIBRARY
from tests.test_r17f_frontend import COMMON as F_COMMON
from tests.test_r17f_hub import HubCase
from tests.test_r17h2_frontend import ADMIN_COMMON
from tests.test_r17h_frontend import BUSINESS, COMMON as H_COMMON, ROOMS, SOCIAL
from tests.test_lg6c_app_shell import COMMON as APP_SHELL

ROOT = Path(__file__).resolve().parents[2]


class R17R2Frontend(unittest.TestCase):
    def run_js(self, script, common=H_COMMON):
        result = subprocess.run(['node', '-e', common + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def test_signals_are_isolated_and_stale_response_is_dropped(self):
        self.run_js(r'''
(async()=>{
 const A=Object.assign({},member,{id:'account-a',handle:'account-a',capabilities:['social.signal']});
 const B=Object.assign({},member,{id:'account-b',handle:'account-b',capabilities:['social.signal']});
 const x=setup(false,false),{c,nodes}=x;await answer(x,200,A);
 c.CommonsAPI.get=path=>path==='/social/signals'?Promise.resolve({data:{items:c.CommonsSession.me.id==='account-a'?['W']:[]}}):Promise.reject(new Error('unexpected '+path));
 c.location.hash='#/sources';c.Commons.refresh();for(let i=0;i<12;i++)await tick();
 assert.ok(nodes['#main'].innerHTML.includes('已保存'),'A sees saved source');
 await answer(x,200,B);c.location.hash='#/sources';c.Commons.refresh();for(let i=0;i<12;i++)await tick();
 const html=nodes['#main'].innerHTML;
 assert.ok(/data-action="signal-save" data-id="W"/.test(html),'B does not inherit A saved source');
 const y=setup(false,false);await answer(y,200,A);
 let oldResolve;
 y.c.CommonsAPI.get=path=>{
  if(y.c.CommonsSession.me.id==='account-a')return new Promise(resolve=>{oldResolve=resolve});
  return Promise.resolve({data:{items:[]}});
 };
 y.c.location.hash='#/sources';y.c.Commons.refresh();
 await answer(y,200,B);oldResolve({data:{items:['W']}});for(let i=0;i<12;i++)await tick();
 assert.ok(/data-action="signal-save" data-id="W"/.test(y.nodes['#main'].innerHTML),'late A response cannot overwrite B');
 console.log('_PASS signals-account-isolation');
})().catch(e=>{console.error(e);process.exit(1)});
''', APP_SHELL)

    def test_dismissed_people_can_be_listed_and_restored(self):
        self.run_js(SOCIAL + r'''
(async()=>{
 const carol={id:'p9',handle:'carol',display_name:'卡罗',level:1,reason:'1 位共同好友',score:3};
 const c=socialCtx(c=>{c.routes['GET /social/suggestions']={data:{items:[carol]}};});await tick();
 c.rootN=c.document.querySelector('[data-soc-root]');
 c.location.hash='#/friends/suggest';c.CommonsSocial.routes.friends();
 click(c,socBtn('suggest-dismiss','p9'));c.routes['GET /social/suggestions']={data:{items:[]}};await tick();
 let html=c.rootN.innerHTML;
 assert.ok(html.includes('已关闭的推荐人')&&html.includes('卡罗')&&html.includes('suggest-restore'),'closed list has restore entry');
 c.routes['GET /social/suggestions']={data:{items:[carol]}};
 click(c,socBtn('suggest-restore','p9'));await tick();
 assert.equal(find(c,'DELETE','/social/suggestions/carol/dismiss').length,1);
 html=c.rootN.innerHTML;
 assert.ok(!html.includes('已关闭的推荐人')&&html.includes('suggest-dismiss'),'restored person returns to suggestions');
 console.log('_PASS suggestion-restore');
})().catch(bail);
''')

    def test_group_faces_use_real_members_only(self):
        self.run_js(SOCIAL + r'''
(async()=>{
 const admin={id:'admin-real',handle:'admin-real',display_name:'真实管理员',level:3};
 const member={id:'member-real',handle:'member-real',display_name:'真实成员',level:1};
 const group={slug:'real-group',name:'真实小组',category:'tech',join_policy:'open',members:2,today:0,me:{state:'active',role:'owner'},
  admins:[admin],member_preview:[member],pending:[],pinned:[],featured:[],events:[],rules:[],can_post:true};
 const c=ctx('#/group/real-group');
 const rootNode=node();rootNode.dataset.socRoot='group';
 c.document.querySelector=s=>s.includes('data-soc-root')?rootNode:null;
 c.document.querySelectorAll=s=>s.includes('data-soc-root')?[rootNode]:[];
 c.queueMicrotask=()=>{};
 c.CommonsAvatar={stack:people=>{c.faces=people;return ''}};
 c.routes['GET /social/me']={data:{prefs:{},counts:{}}};
 c.routes['GET /social/groups']={data:{items:[group],categories:{}}};
 c.routes['GET /social/groups/real-group']={data:group};
 c.routes['GET /social/groups/real-group/feed']={data:{items:[]}};
 c.routes['GET /social/groups/real-group/members']={data:{items:[admin,member]}};
 c.routes['GET /social/suggestions']={data:{items:[]}};
 c.routes['GET /social/relations']={data:{items:[]}};
 c.routes['GET /social/anniversaries']={data:{items:[]}};
 vm.runInContext(source('social'),c);c.CommonsSocial.mount();await tick();
 c.CommonsSocial.routes.group();
 assert.deepStrictEqual(JSON.parse(JSON.stringify(c.faces.map(p=>p.id))),['admin-real','member-real']);
 assert.ok(!JSON.stringify(c.faces).includes('yu-lan')&&!JSON.stringify(c.faces).includes('su-wan'));
 console.log('_PASS group-real-faces');
})().catch(bail);
''')

    def test_room_history_scroll_failure_and_delete_key(self):
        self.run_js(ROOMS + r'''
(async()=>{
 const latest=[MSG('m50','第五十条'),MSG('m51','第五十一条')];
 const c=roomCtx(c=>{c.routes['GET /rooms/r1/messages']=q=>{
  if(q&&q.before===50){
   if(!c.allowOld)return Promise.reject(fail('网络断了',0,'network_error'));
   return Promise.resolve({data:{items:[MSG('m49','更早的一条')],more:false,state:'live'}});
  }
  return Promise.resolve({data:{items:latest,more:true,state:'live'}});
 };});
 await tick();
 const list=node(),box=node();box.scrollHeight=1000;box.scrollTop=400;box.clientHeight=200;
 list.querySelector=s=>s==='.rm-chat-list'?box:null;
 Object.defineProperty(list,'innerHTML',{get(){return this._html||''},set(v){this._html=String(v);box.scrollHeight=this._html.length}});
 c.rootN.kids['[data-rm-chat-list]']=list;
 roomClick(c,'chat-more');await tick();
 assert.ok(c.all().includes('第五十一条')&&!c.all().includes('更早的一条'),'failure keeps loaded messages');
 assert.ok(c.all().includes('重试更早的消息'),'failure has retry');
 c.allowOld=true;roomClick(c,'chat-more');await tick();
 assert.ok(c.all().includes('更早的一条'),'older page is prepended');
 assert.equal(box.scrollTop,400+(box.scrollHeight-1000),'scroll follows the previously visible message');
 let deletes=0;
 c.routes['DELETE /rooms/r1/messages/m51']=()=>{deletes++;return deletes===1?Promise.reject(fail('网络断了',0,'network_error')):Promise.resolve({data:{deleted:true}})};
 roomClick(c,'chat-delete','m51');await tick();roomClick(c,'chat-delete','m51');await tick();
 const calls=find(c,'DELETE','/rooms/r1/messages/m51');
 assert.equal(calls.length,2);assert.equal(calls[0].opts.idempotencyKey,calls[1].opts.idempotencyKey,'delete retry keeps key');
 console.log('_PASS room-history-and-delete');
})().catch(bail);
''')

    def test_library_retry_key_and_saved_view_removal(self):
        self.run_js(LIBRARY + r'''
(async()=>{
 const t=await boot();let attempts=0;
 t.c.CommonsAPI.put=(path,body,o)=>{
  attempts++;t.calls.push(['PUT',path,body,o.idempotencyKey]);
  return attempts===1?Promise.reject(new Error('offline')):Promise.resolve({data:{saved:true}});
 };
 click(t,'favorite','skill-1');await tick();click(t,'favorite','skill-1');await tick();
 const puts=t.calls.filter(c=>c[0]==='PUT');assert.equal(puts.length,2);assert.equal(puts[0][3],puts[1][3],'save retry keeps key');
 const saved=await boot();click(saved,'only-saved');await tick();click(saved,'favorite','skill-2');await tick();
 assert.equal(rows(saved.html),0,'unsaved row disappears from saved-only view immediately');
 assert.ok(saved.html.includes('这一类里你还没有收藏'));
 console.log('_PASS library-r2');
})().catch(e=>{console.error(e);process.exitCode=1});
''', common='')

    def test_application_withdraw_retry_keeps_key(self):
        self.run_js(BUSINESS + r'''
(async()=>{
 const app={kind:'sponsor',state:'submitted',fields:{brand:'某某科技',types:['title'],budget:'',time:'本月',note:''}};
 const c=bizCtx('sponsor',[app]);await tick();let attempts=0;
 c.routes['DELETE /social/applications/sponsor']=()=>{attempts++;return attempts===1?Promise.reject(fail('网络断了',0,'network_error')):Promise.resolve({data:{state:'withdrawn'}})};
 bizClick(c,'sponsor-clear');await tick();bizClick(c,'sponsor-clear');await tick();
 const calls=find(c,'DELETE','/social/applications/sponsor');
 assert.equal(calls.length,2);assert.equal(calls[0].opts.idempotencyKey,calls[1].opts.idempotencyKey);
 console.log('_PASS application-withdraw-key');
})().catch(bail);
''')

    def test_admin_more_is_single_flight_and_deduplicated(self):
        self.run_js(r'''
(async()=>{
 const x=build();let release,calls=0;
 x.handlers['GET /admin/social/applications']=q=>{
  if(!q.cursor)return Promise.resolve({data:{items:[PEOPLE[0]]},meta:{cursor:'c-1'}});
  calls++;return new Promise(resolve=>{release=()=>resolve({data:{items:[PEOPLE[0],PEOPLE[1]]},meta:{}})});
 };
 await x.open();x.click({'data-adm':'apps-more'});x.click({'data-adm':'apps-more'});
 assert.equal(calls,1,'second click is blocked while loading');
 assert.ok(x.rootEl.innerHTML.includes('正在加载'));
 release();await settle();
 const html=x.rootEl.innerHTML;
 assert.equal((html.match(/data-id="a1"/g)||[]).length,2,'existing row is not duplicated');
 assert.ok(html.includes('川'),'new row is appended');
 console.log('_PASS admin-more-single-flight');
})().catch(bail);
''', ADMIN_COMMON)

    def test_constellation_uses_all_memberships_and_live_overview(self):
        self.run_js(r'''
(async()=>{
 const rows=[
  {id:'o1',slug:'a-team',name:'甲队',typeLabel:'实验室',intro:'',ownerId:'u1',verified:false,weight:5,
   people:[{id:'u2',handle:'yi',name:'乙',level:2,role:'member'}],works:[{id:'w1',title:'作品一',authorId:'u2'}]},
  {id:'o2',slug:'b-team',name:'乙队',typeLabel:'实验室',intro:'',ownerId:'u2',verified:false,weight:5,
   people:[{id:'u2',handle:'yi',name:'乙',level:2,role:'owner'}],works:[{id:'w2',title:'作品二',authorId:'u2'}]}];
 const c=context('live',{'/orgs/hub/constellation':{data:rows,meta:{}}});
 vm.runInContext(source('constellation'),c);const S=c.CommonsConstellation;S.render();await tick();
 const graph=S.buildGraph(),person=graph.nodes.find(n=>n.key==='person:u2');
 assert.ok(Math.abs(person.x-642)<0.01&&Math.abs(person.y-320)<0.01,'member is placed using both teams, not only the first');
 assert.deepEqual(graph.edges.filter(e=>e.from==='person:u2'&&e.to.startsWith('work:')).map(e=>e.to).sort(),['work:o1','work:o2']);
 const pane={innerHTML:''},root={dataset:{},querySelector:s=>s==='[data-atlas-detail]'?pane:{toggleAttribute(){}},querySelectorAll:()=>[]};
 c.document.querySelector=s=>s==='.constellation'?root:null;
 S.handle('constellation-overview',{dataset:{},closest:()=>null});
 const overview=pane.innerHTML;
 assert.ok(overview.includes('从团队认识作品与成员')&&overview.includes('<dd>团队作品</dd>'));
 assert.ok(!overview.includes('从一件作品认识同行'));
 console.log('_PASS constellation-memberships');
})().catch(e=>{console.error(e);process.exitCode=1});
''', F_COMMON)

    def test_growth_links_to_account_ranking_settings(self):
        source = (ROOT / 'preview/growth.js').read_text()
        self.assertIn('href="#/account">去账号页设置公开排名</a>', source)
        self.assertNotIn("switchBtn('public', false, '排名设置还没开放'", source)


class R17R2HubErrors(HubCase):
    def test_upstream_error_is_not_misreported_as_feature_off(self):
        viewer = self.user('r17r2_hub_error')
        with patch('modules.market.service.page', side_effect=ApiError('internal_error')):
            with self.assertRaises(ApiError) as caught:
                hub.opportunities(self.db.conn(), accounts.resolve_actor(self.db, viewer.cookies.get('__Host-sid')))
        self.assertEqual(caught.exception.code, 'internal_error')


if __name__ == '__main__':
    unittest.main()
