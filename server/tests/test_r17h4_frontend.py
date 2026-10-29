"""R17-H4 · govern.js 给广场消息和找搭子需求画「隐藏 / 收起」，私信和搭子邀约不画；buddies.js 能举报需求和邀约。
govern 夹具是真实后端对真实举报返回的队列和详情。运行：cd server && python3 -m unittest tests.test_r17h4_frontend -q
反跑：R17H4_BEFORE=改前文件所在目录（里面是 preview_govern.js / preview_buddies.js）。"""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_lg6c_r9_complaint_counts as r9  # noqa: E402
from modules.agentchat.tests.test_agentchat import LOBBY, AgentChatCase  # noqa: E402
from modules.social.tests import test_social as ts  # noqa: E402
from tests.helpers import HDRS  # noqa: E402
from tests.test_r17g_chat_reports import GovernorMixin  # noqa: E402
from tests.test_r17g3_govern_chat import fixture  # noqa: E402
from tests.test_r17h_frontend import BUDDIES, COMMON as H_COMMON  # noqa: E402
from tests.test_r17h_backend import BUDDY, INVITE  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SRC = r9.COMMON.replace("const source=name=>fs.readFileSync(root+'/preview/'+name+'.js','utf8');",
                        "const source=name=>fs.readFileSync(process.env.R17H4_BEFORE&&(name==='govern'||name==='buddies')?process.env.R17H4_BEFORE+'/preview_'+name+'.js':root+'/preview/'+name+'.js','utf8');")
assert 'R17H4_BEFORE' in SRC

BSRC = H_COMMON.replace("const source=name=>fs.readFileSync(before?root+'/'+before+'/preview_'+name+'.js':root+'/preview/'+name+'.js','utf8');",
                        "const source=name=>fs.readFileSync(process.env.R17H4_BEFORE?process.env.R17H4_BEFORE+'/preview_'+name+'.js':root+'/preview/'+name+'.js','utf8');")
assert 'R17H4_BEFORE' in BSRC

REPORT = r'''
const REPORT_RECV=Object.assign({},RECV,{id:'bi2'});
(async()=>{
 const c=buddyCtx();await tick();
 // 别人的需求有「举报」，自己的需求没有
 assert.ok(c.page.includes('data-action="buddy-report" data-kind="post" data-id="bp1"'),'需求行有举报');
 act(c,'buddy-report',{kind:'post',id:'bp1'});
 let m=c.modals[c.modals.length-1];
 assert.ok(m.html.includes('data-form="buddy-report"')&&m.html.includes('data-kind="post"')&&m.html.includes('data-id="bp1"'));
 assert.ok(['广告刷屏','骚扰辱骂','违法违规','其他'].every(r=>m.html.includes('value="'+r+'"')),'四个固定原因');
 // 没选原因不发请求
 assert.equal(c.CommonsBuddies.submit('buddy-report',form('r',{reason:''},{kind:'post',id:'bp1'})),true);await tick();
 assert.equal(find(c,'POST','/social/buddies/bp1/report').length,0);
 // 失败：原因提示、不关弹窗；重试沿用同一幂等键
 c.routes['POST /social/buddies/bp1/report']=fail('今天举报太多了',429,'rate_limited');
 c.CommonsBuddies.submit('buddy-report',form('r',{reason:'广告刷屏'},{kind:'post',id:'bp1'}));await tick();
 assert.ok(c.toasts.includes('今天举报太多了'));assert.equal(c.closed||0,0);
 c.routes['POST /social/buddies/bp1/report']={data:{id:'br1'}};
 c.CommonsBuddies.submit('buddy-report',form('r',{reason:'广告刷屏'},{kind:'post',id:'bp1'}));await tick();
 const p=find(c,'POST','/social/buddies/bp1/report');
 assert.equal(p.length,2);assert.deepStrictEqual(JSON.parse(JSON.stringify(p[1].body)),{reason:'广告刷屏'});
 assert.ok(p[0].opts.idempotencyKey&&p[1].opts.idempotencyKey===p[0].opts.idempotencyKey,'重试同一幂等键');
 assert.equal(c.closed,1);assert.ok(c.toasts.some(t=>t.includes('已举报')));
 // 收到的邀约：举报走 buddy-invites 路由
 act(c,'buddy-mine',{value:'received'});
 assert.ok(c.page.includes('data-action="buddy-report" data-kind="invite" data-id="bi2"'),'收到的邀约有举报');
 act(c,'buddy-report',{kind:'invite',id:'bi2'});
 assert.equal(c.modals[c.modals.length-1].title,'举报这条搭子邀约');
 c.routes['POST /social/buddy-invites/bi2/report']={data:{id:'br2'}};
 c.CommonsBuddies.submit('buddy-report',form('r',{reason:'骚扰辱骂'},{kind:'invite',id:'bi2'}));await tick();
 assert.deepStrictEqual(JSON.parse(JSON.stringify(find(c,'POST','/social/buddy-invites/bi2/report')[0].body)),{reason:'骚扰辱骂'});
 assert.equal(c.writes.length,0,'真实模式不写本机');
 // 没有举报权限：按钮灰掉并带原因，点了只提示
 const why='需要 L1';
 const d=buddyCtx(null,{state:'member',me:{id:'me1',handle:'me',display_name:'我',level:1},can:a=>a!=='social.buddy.report',reason:a=>a==='social.buddy.report'?why:''});await tick();
 assert.ok(d.page.includes('data-action="buddy-report" data-kind="post" data-id="bp1" disabled title="'+why+'"'));
 act(d,'buddy-report',{kind:'post',id:'bp1'});
 assert.equal(d.modals.length,0);assert.ok(d.toasts.includes(why));
 console.log('_PASS buddies-report');
})().catch(e=>{console.error(e);process.exit(1)});
'''

COLLAPSED = r'''
(async()=>{
 const gone=Object.assign({},MINE,{collapsed:true});
 const c=buddyCtx(x=>{x.routes['GET /social/buddies']=q=>q&&q.mine?{data:{items:[gone]},meta:{cursor:null}}:{data:{items:[POST]},meta:{cursor:null}};});await tick();
 act(c,'buddy-mine',{value:'drafts'});
 assert.ok(c.page.includes('已被治理员收起')&&c.page.includes('一起读论文'),'被治理员收起的有说明');
 assert.ok(!c.page.includes('data-action="buddy-pause-draft" data-id="bm1"')&&!c.page.includes('data-action="buddy-resume-draft" data-id="bm1"'),'不能自己收起或重新发布');
 // 没被收起的照旧
 const e=buddyCtx();await tick();act(e,'buddy-mine',{value:'drafts'});
 assert.ok(e.page.includes('data-action="buddy-pause-draft" data-id="bm1"')&&!e.page.includes('已被治理员收起'));
 // 演示模式不出现举报按钮，也不发请求
 const d=ctx('#/buddies');d.CommonsAPI.mode='sample';
 vm.runInContext(source('buddies'),d);
 const html=d.CommonsBuddies.routes.buddies();
 assert.ok(!html.includes('buddy-report'),'演示模式没有举报入口');assert.equal(d.calls.length,0);
 console.log('_PASS buddies-collapsed');
})().catch(e=>{console.error(e);process.exit(1)});
'''


def run_buddies(script):
    done = subprocess.run(['node', '-e', BSRC + BUDDIES + script, str(ROOT)], capture_output=True, text=True, timeout=90,
                          env=dict(os.environ))
    if done.returncode != 0:
        raise AssertionError((done.stdout + done.stderr)[-3500:])
    return done.stdout


class BuddiesJs(unittest.TestCase):
    def test_report_post_and_invite_with_stable_key_and_gate(self):
        self.assertIn('_PASS buddies-report', run_buddies(REPORT))

    def test_collapsed_own_post_and_sample_mode(self):
        self.assertIn('_PASS buddies-collapsed', run_buddies(COLLAPSED))


GOVERN = r'''
const fx=JSON.parse(process.env.R17H4_FIXTURE);
const open=async(detail,hooks)=>{
 const routes={'/governance/me':fx.me,'/governance/stats':fx.stats,'/governance/queue':fx.queue,'/governance/complaints':[]};
 routes['/governance/cases/'+detail.id]=detail;
 const c=context({mode:'live',hash:'#/govern',routes});
 if(hooks)hooks(c);
 vm.runInContext(source('govern'),c);c.CommonsGovern.routes.govern();c.CommonsGovern.mount();await tick(16);
 return c;
};
const picks=html=>[...html.matchAll(/data-gov-act="pick" data-value="([a-z_]+)"[^>]*>([^<]*)</g)].map(m=>[m[1],m[2]]);
const fire=(c,type,el)=>{for(const f of [...(c.document.events[type]||[])])f({target:el,preventDefault(){}});};
const btn=(attrs)=>{const el={disabled:false,getAttribute:k=>attrs[k]??null,closest:s=>s==='[data-gov-act]'||s==='[data-gov-root]'?el:null};return el;};
(async()=>{
 let c=await open(fx.detail);let html=c.rootNode.innerHTML;
 const p=picks(html),names=p.map(x=>x[0]);
 if(fx.expect==='hideable'){
  assert.ok(names.includes('hide')&&names.includes('restore'),'有隐藏 / 恢复');
  for(const g of ['delete','pending_review'])assert.ok(!names.includes(g),'不画 '+g);
  const label=p.find(x=>x[0]==='hide')[1];
  assert.equal(label,fx.hideLabel,'按钮文字：'+fx.hideLabel);
  assert.ok(html.includes(fx.note),'说明写清楚能做什么');
  // 点隐藏 → 写理由 → 执行：POST 到 actions，带幂等键，理由原样
  const posts=[];
  c.CommonsAPI.post=(path,body,opts)=>{posts.push({path,body,key:opts&&opts.idempotencyKey});return Promise.resolve({data:{state:'executed'}});};
  fire(c,'click',btn({'data-gov-act':'pick','data-value':'hide'}));
  const reason={getAttribute:k=>k==='data-gov-input'?'reason':null,value:'广告刷屏',closest:s=>s==='[data-gov-root]'?reason:null};
  fire(c,'input',reason);
  fire(c,'click',btn({'data-gov-act':'submit'}));await tick(16);
  assert.equal(posts.length,1);
  assert.equal(posts[0].path,'/governance/cases/'+fx.detail.id+'/actions');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(posts[0].body)),{type:'hide',reason:'广告刷屏'});
  assert.ok(posts[0].key,'带幂等键');
 }else{
  for(const g of ['hide','restore','delete','pending_review'])assert.ok(!names.includes(g),'不画 '+g);
  assert.ok(html.includes('这类事项没有「隐藏」「删除」'),'说明为什么没有隐藏');
 }
 for(const k of ['rate_limit','require_source','deduct','demote','ban'])assert.ok(names.includes(k),'保留 '+k);
 assert.ok(html.includes('data-gov-chat="'+fx.detail.preview.state+'"')&&html.includes('<h3>'+fx.title+'</h3>'),'预览块和标题');
 assert.ok(html.includes(fx.text),'正文');
 console.log('_PASS govern-h4');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def run_govern(fx):
    done = subprocess.run(['node', '-e', SRC + GOVERN, str(ROOT)], capture_output=True, text=True, timeout=90,
                          env=dict(os.environ, R17H4_FIXTURE=json.dumps(fx)))
    if done.returncode != 0:
        raise AssertionError((done.stdout + done.stderr)[-3500:])
    return done.stdout


class ChatHideInGovernJs(GovernorMixin, AgentChatCase):
    def setUp(self):
        super().setUp()
        self.start_governance()

    def test_chat_message_case_has_hide_and_posts_it(self):
        author, reporter, governor = self.member('r17h4_a', 2), self.member('r17h4_r', 2), self.gov('r17h4_g')
        item = self.post_msg(author, LOBBY, '广告：加我领福利')['item']
        self.assertEqual(reporter.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS,
                                       json={'reason': '广告刷屏'}).status_code, 201)
        self.dispatch()
        fx = fixture(self, 'chat', governor, '广告：加我领福利')
        fx.update(expect='hideable', hideLabel='隐藏', title='广场消息', note='这条消息可以「隐藏」')
        self.assertIn('_PASS govern-h4', run_govern(fx))


class BuddyCasesInGovernJs(GovernorMixin, ts.SocialCase):
    def setUp(self):
        super().setUp()
        self.start_governance()

    def test_buddy_post_case_has_collapse_and_invite_case_has_none(self):
        author, reporter, governor = self.user('r17h4_ba', level=2), self.user('r17h4_br', level=2), self.gov('r17h4_bg')
        post = self.post(author, '/api/social/buddies', BUDDY, status=201).json()['data']
        self.post(reporter, f"/api/social/buddies/{post['id']}/report", {'reason': '广告刷屏'}, status=201)
        self.dispatch()
        fx = fixture(self, 'buddy', governor, BUDDY['title'])
        fx.update(expect='hideable', hideLabel='收起', title='找搭子需求', note='这条需求可以「收起」')
        self.assertEqual(fx['detail']['preview']['state'], 'buddy_post')
        self.assertIn('_PASS govern-h4', run_govern(fx))

    def test_buddy_invite_case_has_no_hide(self):
        sender, receiver, governor = self.user('r17h4_bs', level=2), self.user('r17h4_bt', level=2), self.gov('r17h4_bh')
        self.put(receiver, '/api/social/me/prefs', {'buddy_open': True})
        sent = self.post(sender, '/api/social/buddy-invites/r17h4_bt', INVITE, status=201).json()['data']
        self.post(receiver, f"/api/social/buddy-invites/{sent['id']}/report", {'reason': '骚扰辱骂'}, status=201)
        self.dispatch()
        fx = fixture(self, 'buddy', governor, INVITE['title'])
        fx.update(expect='none', title='搭子邀约')
        self.assertEqual(fx['detail']['preview']['state'], 'buddy_invite')
        self.assertIn('_PASS govern-h4', run_govern(fx))


if __name__ == '__main__':
    unittest.main()
