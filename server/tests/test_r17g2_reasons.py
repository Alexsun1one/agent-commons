"""R17-G2 · 被 can() 挡住的入口：灰掉、title 和旁边小字写 CommonsSession.reason() 给的原因（离线 VM）。

每个文件至少一条：mock 的会话照真实形状——can(action) 为假，reason(action) 返回 api.js 里那句话。
没有 reason（老会话、示例模式）时仍退回原来的文案，由旧测试守着。
"""
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_lg6b_r14_gates as r14  # noqa: E402
import test_lg6c_r14_gates as ev14  # noqa: E402
import test_lg8a_r13_members_teams as orgs13  # noqa: E402
import test_lg8b_r13_knowledge_agent as ka  # noqa: E402
import test_r17a_wiring_js as r17a  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
L2 = '需要 L2（你现在是 L1）'
L3 = '需要 L3（你现在是 L1）'

SESSION = r'''
const L2='需要 L2（你现在是 L1）',L3='需要 L3（你现在是 L1）';
// 照真实形状：can 看 /api/me.capabilities，reason 看 /api/me.capability_reasons
const sess=(allowed,reasons)=>({me:{id:'me',display_name:'我',handle:'me',level:1},
  can:a=>allowed.includes(a),reason:a=>allowed.includes(a)?'':((reasons||{})[a]||'')});
'''


def node(script, *extra, cwd=None):
    done = subprocess.run(['node', '-e', script, str(ROOT), *extra], capture_output=True, text=True, timeout=90)
    if done.returncode != 0:
        raise AssertionError((done.stdout + done.stderr)[-3500:])
    return done.stdout


class ReasonWiringTest(unittest.TestCase):
    def test_bounty_publish_promo_and_topup_show_reason(self):
        out = node(r14.COMMON + SESSION + r'''
(async()=>{
 const denied=context('live','#/bounties');
 denied.CommonsSession=sess([],{'bounty.create.help':L2,'bounty.create.promo':L3,'bounty.topup':L2});
 const root={innerHTML:'',dataset:{},isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
 wireBountySquare(denied,root);
 vm.runInContext(source('bounty'),denied);
 root.innerHTML=denied.CommonsBounty.routes.bounties();
 denied.CommonsBounty.mount();await tick();
 const no=root.innerHTML;
 assert.ok(/data-bty-act="publish"[^>]*disabled[^>]*title="需要 L2（你现在是 L1）"/.test(no),'按钮 title 写原因');
 assert.ok(no.includes('data-bty-locked="publish">需要 L2（你现在是 L1）'),'旁边小字写原因');
 assert.ok(no.includes('href="#/growth"'),'等级不够仍给升级入口');
 assert.ok(!no.includes('你现在的等级还不能发悬赏'),'有原因就不用笼统的话');
 // 追加赏金
 const top=context('live','#/bounties/b1');
 top.CommonsSession=sess(['bounty.create.help'],{'bounty.topup':'这个功能还没开放'});
 const troot={innerHTML:'',dataset:{},isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
 top.document.querySelector=s=>s==='[data-bounty]'?troot:null;
 top.routes['/bounty/b1']={id:'b1',kind:'help',status:'active',state:'open',mine:false,credits:20,contributors:1,my_stake:0,held:20,deadline_at:'2026-12-01T00:00:00.000Z',object:{id:'p1',title:'求助'},owner:{id:'p2',display_name:'乙'}};
 top.routes['/bounty/rules']={caps:{1:20},cosmetics:[],task_kinds:[]};
 top.routes['/objects/p1']={id:'p1',content:{body:'正文'},author:{id:'p2',display_name:'乙'}};
 top.routes['/objects']=[];
 vm.runInContext(source('bounty'),top);
 troot.innerHTML=top.CommonsBounty.routes.bounties();top.CommonsBounty.mount();await tick();
 assert.ok(/data-bty-act="topup"[^>]*disabled[^>]*title="这个功能还没开放"/.test(troot.innerHTML),'追加赏金 title');
 assert.ok(troot.innerHTML.includes('data-bty-locked="topup">这个功能还没开放'),'功能没开放：写原因，不带升级链接');
 assert.ok(!troot.innerHTML.split('data-bty-locked="topup"')[1].split('</p>')[0].includes('#/growth'));
 console.log('_PASS bounty-reason');
})().catch(e=>{console.error(e);process.exitCode=1});
''')
        self.assertIn('_PASS bounty-reason', out)

    def test_editor_write_types_show_reason(self):
        out = node(r14.COMMON + SESSION + r'''
(async()=>{
 const c=context('live','#/write');
 c.CommonsSession=sess(['object.create.discussion'],{'object.create.knowledge':L2,'object.create.work':L2});
 vm.runInContext(source('editor'),c);
 const html=c.CommonsEditorPage.routes.write();
 assert.ok(/data-kind="knowledge"[^>]*disabled[^>]*title="需要 L2（你现在是 L1）"/.test(html),'灰掉的类型 title 写原因');
 assert.ok(/data-edt-locked>[^<]*知识条目：需要 L2（你现在是 L1）/.test(html),'小字逐项写原因');
 assert.ok(html.includes('href="#/growth"'));
 console.log('_PASS editor-reason');
})().catch(e=>{console.error(e);process.exitCode=1});
''')
        self.assertIn('_PASS editor-reason', out)

    def test_events_submit_shows_reason(self):
        out = node(ev14.HARNESS + SESSION + r'''
(async()=>{
 const live={id:'ev1',kind:'challenge',title:'进行中活动',summary:'s',startsAt:'2020-01-01',endsAt:'2099-01-02',status:'live',signups:2,signedUp:false,submitted:false};
 const e=JSON.parse(JSON.stringify(live));
 const c=make({get:{'/events':[e],'/events/campaigns':[],'/events/ev1':e},post:{}},'#/event/ev1');
 c.CommonsSession=sess([],{'events.submit':L2});
 c.CommonsEvents.mount();await tick();
 c.rootN.innerHTML=c.CommonsEvents.routes.event();c.CommonsEvents.mount();
 const html=c.rootN.innerHTML;
 assert.ok(/data-evt-act="submit"[^>]*disabled[^>]*title="需要 L2（你现在是 L1）"/.test(html),'提交作品 title');
 assert.ok(html.includes('data-evt-locked="submit">需要 L2（你现在是 L1），<a href="#/growth">'),'小字写原因并给升级入口');
 assert.ok(!html.includes('你现在的等级还不能提交作品'));
 // events.manage 是管理员专用：不给原因，照旧藏起来
 c.rootN.innerHTML=c.CommonsEvents.routes.events();c.CommonsEvents.mount();
 assert.ok(!c.rootN.innerHTML.includes('create-open'),'管理员专用入口仍然隐藏');
 console.log('_PASS events-reason');
})().catch(e=>{console.error(e);process.exitCode=1});
''', 'preview/events.js')
        self.assertIn('_PASS events-reason', out)

    def test_orgs_create_shows_reason(self):
        script = orgs13.COMMON + orgs13.ORGS_COMMON + r'''
(async()=>{
 const c=context({hash:'#/orgs',rootSel:'data-org-root'});
 c.routes['GET /orgs']={data:[],meta:{types:[{id:'lab',label:'实验室'}]}};
 c.CommonsSession.can=a=>false;
 c.CommonsSession.reason=a=>a==='orgs.create'?'需要 L3（你现在是 L1）':'';
 startOrgs(c,'orgs');await tick();
 assert.ok(/data-org-act="create" disabled title="需要 L3（你现在是 L1）"/.test(c.page),'title 写原因');
 assert.ok(c.page.includes('data-org-locked>需要 L3（你现在是 L1），<a href="#/growth">'),'小字写原因');
 console.log('_PASS orgs-reason');
})().catch(e=>{console.error(e);process.exitCode=1});
'''
        done = subprocess.run(['node', '-e', script, str(ROOT)], capture_output=True, text=True, timeout=90)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn('_PASS orgs-reason', done.stdout)

    def test_account_avatar_shows_reason(self):
        script = r17a.ACCOUNT.replace(
            "CommonsSession:{can:a=>(opts.caps||['upload.avatar','account.avatar.set','upload.create']).indexOf(a)>=0}",
            "CommonsSession:{can:a=>(opts.caps||['upload.avatar','account.avatar.set','upload.create']).indexOf(a)>=0,"
            "reason:a=>(opts.caps||['upload.avatar']).indexOf(a)>=0?'':(a==='account.avatar.set'?'这个功能还没开放':'')}") + r'''
(async()=>{
 const locked=await boot({caps:[]});
 assert.ok(!locked.html.includes('data-acc-avatar-file'));
 assert.ok(locked.html.includes('现在还不能换头像：这个功能还没开放。'),'写出原因');
 console.log('_PASS account-reason');
})().catch(e=>{console.error(e);process.exitCode=1});
'''
        self.assertIn("reason:a=>", script)
        self.assertIn('_PASS account-reason', node(script))

    def test_market_photo_upload_shows_reason(self):
        script = r17a.MARKET.replace(
            "CommonsSession:{can:a=>opts.canUpload!==false}",
            "CommonsSession:{can:a=>opts.canUpload!==false,reason:a=>opts.canUpload===false?'需要 L2（你现在是 L1）':''}") + r'''
(async()=>{
 const t=make({canUpload:false});
 t.c.location.hash='#/market/new';
 t.c.CommonsMarket.mount();await tick();
 const pick=el=>(t.handlers.click||[]).forEach(f=>f({target:{closest:s=>s==='[data-mt-act]'?el:null},preventDefault(){}}));
 pick({dataset:{mtAct:'category',category:'sell'},getAttribute:k=>({'data-mt-act':'category','data-category':'sell'})[k]||null});await tick();
 const html=t.c.CommonsMarket.routes.market();
 assert.ok(/mt-photo-add is-disabled" title="需要 L2（你现在是 L1）"/.test(html),'添加图片灰掉并带 title');
 assert.ok(html.includes('data-mt-why="upload">需要 L2（你现在是 L1）'),'旁边小字写原因');
 assert.ok(!/data-mt-photos[^>]*accept=/.test(html),'灰掉的输入不再接受文件');
 const input={files:[{name:'a.png',size:10,type:'image/png'}],value:'x'};
 (t.handlers.change||[]).forEach(f=>f({target:{matches:s=>s==='[data-mt-photos]',files:input.files,get value(){return input.value},set value(v){input.value=v}}}));
 await tick();
 assert.equal(t.uploads.length,0);
 assert.ok(t.toasts.includes('需要 L2（你现在是 L1）'),'强行触发时 toast 也是原因');
 const ok=make({canUpload:true});
 ok.c.location.hash='#/market/new';ok.c.CommonsMarket.mount();await tick();
 (ok.handlers.click||[]).forEach(f=>f({target:{closest:s=>s==='[data-mt-act]'?{dataset:{mtAct:'category',category:'sell'},getAttribute:k=>({'data-mt-act':'category','data-category':'sell'})[k]||null}:null},preventDefault(){}}));await tick();
 const okHtml=ok.c.CommonsMarket.routes.market();
 assert.ok(okHtml.includes('mt-photo-add')&&!okHtml.includes('is-disabled'),'能上传时不变');
 console.log('_PASS market-reason');
})().catch(e=>{console.error(e);process.exitCode=1});
'''
        self.assertIn('_PASS market-reason', node(script))

    def test_library_submit_and_favorite_show_reason(self):
        script = ka.COMMON + ka.Lg8bKnowledgeAgent.LIB_SETUP + SESSION + r'''
(async()=>{
 // 不能投稿
 let {c,rootNode}=libLive('#/skills',sess(['content.save'],{'library.submit':L2}));
 c.CommonsLibrary.mount();await tick();
 let html=rootNode.innerHTML;
 assert.ok(/data-lib-act="submit-open" disabled aria-disabled="true" title="需要 L2（你现在是 L1）"/.test(html),'投稿按钮 title');
 assert.ok(html.includes('lib-gate-note')&&html.includes('需要 L2（你现在是 L1），<a href="#/growth">'),'小字写原因');
 assert.ok(!html.includes('你现在的等级还不能投稿'));
 // 不能收藏：灰掉并写原因
 ({c,rootNode}=libLive('#/skills',sess(['library.submit'],{'content.save':'这个功能还没开放'})));
 c.CommonsLibrary.mount();await tick();
 html=rootNode.innerHTML;
 assert.ok(/data-lib-act="favorite"[^>]*disabled aria-disabled="true" title="这个功能还没开放"/.test(html),'收藏灰掉并带 title');
 assert.ok(html.includes('data-lib-why="favorite">收藏：这个功能还没开放'),'收藏旁边小字');
 console.log('_PASS library-reason');
})().catch(e=>{console.error(e);process.exit(1)});
'''
        done = subprocess.run(['node', '-e', script, str(ROOT)], capture_output=True, text=True, timeout=90,
                              env=dict(__import__('os').environ, LG8B_PREVIEW=str(ROOT / 'preview')))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn('_PASS library-reason', done.stdout)

    def test_kb_actions_show_reason(self):
        kb_setup = ka.KB_SETUP.replace(
            "const c=context('live','#/solved');",
            "const c=context('live','#/solved');if(globalThis.__sess)c.CommonsSession=globalThis.__sess;")
        kb_setup = kb_setup.replace("const first=c.CommonsKB.routes.solved();", "const first=c.CommonsKB.routes.solved();globalThis.__host=host;")
        script = ka.COMMON + kb_setup + SESSION + r'''
(async()=>{
 globalThis.__sess=sess([],{'kb.create':L2,'kb.verify':L2,'kb.solve':'这个功能还没开放','kb.link':'这个功能还没开放'});
 const {c,parts}=await kbLive();
 const top=c.CommonsKB.routes.solved();
 assert.ok(/data-kb-act="ask-open" disabled aria-disabled="true" title="需要 L2（你现在是 L1）"/.test(top),'提问入口灰掉 + title');
 assert.ok(top.includes('data-kb-why>需要 L2（你现在是 L1）'),'提问入口旁边小字');
 const d=parts.detail.innerHTML;
 assert.ok(/data-kb-act="verify-success" disabled aria-disabled="true" title="需要 L2（你现在是 L1）"/.test(d),'我也解决了 灰掉');
 assert.ok(/data-kb-act="panel-solve" disabled aria-disabled="true" title="这个功能还没开放"/.test(d),'写解法灰掉');
 assert.ok(d.includes('我也解决了：需要 L2（你现在是 L1）')&&d.includes('关联问题：这个功能还没开放'),'小字逐项写原因');
 // 全部允许：和原来一样
 globalThis.__sess=sess(['kb.create','kb.verify','kb.solve','kb.link','kb.capture'],{});
 const ok=await kbLive();
 const okTop=ok.c.CommonsKB.routes.solved();
 assert.ok(okTop.includes('data-kb-act="ask-open"')&&!okTop.includes('data-kb-why')&&!ok.parts.detail.innerHTML.includes('data-kb-why'));
 assert.ok(!/data-kb-act="verify-success" disabled/.test(ok.parts.detail.innerHTML));
 console.log('_PASS kb-reason');
})().catch(e=>{console.error(e);process.exit(1)});
'''
        done = subprocess.run(['node', '-e', script, str(ROOT)], capture_output=True, text=True, timeout=90,
                              env=dict(__import__('os').environ, LG8B_PREVIEW=str(ROOT / 'preview')))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn('_PASS kb-reason', done.stdout)


if __name__ == '__main__':
    unittest.main()
