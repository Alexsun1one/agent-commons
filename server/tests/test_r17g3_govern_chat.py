"""R17-G3 · govern.js 认得聊天 / 私信事项：夹具是真实后端对真实举报返回的队列和详情（不手写形状），再交给 VM 里的 govern.js 渲染。"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_lg6c_r9_complaint_counts as r9  # noqa: E402
from modules.agentchat.tests.test_agentchat import LOBBY, AgentChatCase  # noqa: E402
from modules.dm.tests.test_dm import DmCase  # noqa: E402
from tests.helpers import HDRS  # noqa: E402
from tests.test_r17g_chat_reports import GovernorMixin  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

SCRIPT = r'''
const fx=JSON.parse(process.env.R17G3_FIXTURE);
const open=async(detail,queue)=>{
 const routes={'/governance/me':fx.me,'/governance/stats':fx.stats,'/governance/queue':queue||fx.queue,'/governance/complaints':[]};
 routes['/governance/cases/'+detail.id]=detail;
 const c=context({mode:'live',hash:'#/govern',routes});
 vm.runInContext(source('govern'),c);c.CommonsGovern.routes.govern();c.CommonsGovern.mount();await tick(16);
 return c;
};
const actions=html=>[...html.matchAll(/data-gov-act="pick" data-value="([a-z_]+)"[^>]*?(disabled)?>/g)].map(m=>m[1]);
(async()=>{
 const want=fx.kind==='chat'?{title:'广场消息',state:'chat_message'}:{title:'私信（被举报的一条）',state:'dm_message'};
 let c=await open(fx.detail);
 let html=c.rootNode.innerHTML;
 assert.ok(html.includes('data-gov-chat="'+want.state+'"'),'聊天预览块');
 assert.ok(html.includes('<h3>'+want.title+'</h3>'),'标题：'+want.title);
 assert.ok(html.includes(fx.text),'正文显示 preview.text');
 assert.ok(html.includes(fx.detail.preview.message),'旁边是 preview.message 那句说明');
 assert.ok(!html.includes('第 1 版'),'没有内容版本号');
 assert.ok(!html.includes('chat_message')||html.includes('data-gov-chat="chat_message"'),'英文状态名不外露');
 assert.ok(!html.includes('dm_message')||html.includes('data-gov-chat="dm_message"'));
 const picks=actions(html);
 // R17-H4：广场消息可以「隐藏」和「通过并恢复」，私信一个都没有；转待审核、删除对两者都不画
 const gone=fx.kind==='chat'?['delete','pending_review']:['hide','delete','pending_review','restore'];
 for(const g of gone)assert.ok(!picks.includes(g),'不画 '+g+' 按钮');
 if(fx.kind==='chat')for(const k of ['hide','restore'])assert.ok(picks.includes(k),'广场消息有 '+k);
 for(const kept of ['rate_limit','require_source','deduct','demote','ban'])assert.ok(picks.includes(kept),'保留 '+kept);
 assert.ok(html.includes('data-gov-chat-note'),'说明为什么没有隐藏/删除');
 assert.ok(!/data-value="ban"[^>]*disabled/.test(html),'有对应成员时可以对人处理');
 // 没有对应成员（发消息的是 Agent）：针对成员的动作灰掉并写原因
 const noSubject=JSON.parse(JSON.stringify(fx.detail));noSubject.subject=null;
 c=await open(noSubject);html=c.rootNode.innerHTML;
 assert.ok(/data-value="ban"[^>]*title="这条消息没有对应的成员，不能对人处理"[^>]*disabled/.test(html),'ban 灰掉并写原因');
 assert.ok(!/data-value="require_source"[^>]*disabled/.test(html),'不需要成员的动作不受影响');
 // 文本里的 HTML 被转义
 const evil=JSON.parse(JSON.stringify(fx.detail));evil.preview.text='<img src=x onerror=alert(1)>';
 c=await open(evil);html=c.rootNode.innerHTML;
 assert.ok(!html.includes('<img src=x')&&html.includes('&lt;img src=x'),'正文转义');
 // 图片 / 表情标记
 const media=JSON.parse(JSON.stringify(fx.detail));media.preview.has_image=true;media.preview.has_sticker=true;
 c=await open(media);html=c.rootNode.innerHTML;
 assert.ok(html.includes('含图片')&&html.includes('含表情'));
 // Agent 建议的是内容类动作：不给「按建议填入」
 const sug=JSON.parse(JSON.stringify(fx.detail));sug.suggestion={action:'hide',confidence:0.9,basis:['x'],label:'Agent 建议，需人确认'};
 c=await open(sug);html=c.rootNode.innerHTML;
 if(fx.kind==='chat')assert.ok(html.includes('按建议填入')&&!html.includes('这个动作只能用在内容上'),'广场消息的隐藏建议可以填入');
 else assert.ok(html.includes('这个动作只能用在内容上')&&!html.includes('data-value="hide"'),'私信不给内容类建议');
 // 对照：普通内容事项照旧画隐藏和删除
 const obj=JSON.parse(JSON.stringify(fx.detail));
 obj.preview={state:'active',title:'一篇讨论',version:2,text:'正文',message:null};
 c=await open(obj);html=c.rootNode.innerHTML;
 const objPicks=actions(html);
 assert.ok(objPicks.includes('hide')&&objPicks.includes('delete')&&objPicks.includes('restore'),'内容事项仍有隐藏/删除/恢复');
 assert.ok(html.includes('第 2 版')&&!html.includes('data-gov-chat'));
 console.log('_PASS govern-chat');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def fixture(case, kind, governor, text):
    me = governor.get('/api/governance/me').json()['data']
    stats = governor.get('/api/governance/stats').json()['data']
    queue = case.cases(governor)
    detail = governor.get('/api/governance/cases/' + queue[0]['id']).json()['data']
    return {'kind': kind, 'me': me, 'stats': stats, 'queue': queue, 'detail': detail, 'text': text}


def run(fx):
    import os
    done = subprocess.run(['node', '-e', r9.COMMON + SCRIPT, str(ROOT)], capture_output=True, text=True, timeout=90,
                          env=dict(os.environ, R17G3_FIXTURE=json.dumps(fx)))
    if done.returncode != 0:
        raise AssertionError((done.stdout + done.stderr)[-3500:])
    return done.stdout


class ChatCaseInGovernJs(GovernorMixin, AgentChatCase):
    def setUp(self):
        super().setUp()
        self.start_governance()

    def test_chat_message_case_renders_and_hides_content_actions(self):
        author = self.member('r17g3_a', level=2)
        reporter = self.member('r17g3_r', level=2)
        governor = self.gov('r17g3_g')
        item = self.post_msg(author, LOBBY, '广告：加我领福利')['item']
        self.assertEqual(reporter.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS,
                                       json={'reason': '广告刷屏'}).status_code, 201)
        self.dispatch()
        fx = fixture(self, 'chat', governor, '广告：加我领福利')
        self.assertEqual(fx['queue'][0]['target']['title'], '广场消息')
        self.assertIn('_PASS govern-chat', run(fx))


class DmCaseInGovernJs(GovernorMixin, DmCase):
    def setUp(self):
        super().setUp()
        self.start_governance()

    def test_dm_case_renders_only_the_reported_message(self):
        alice = self.user('r17g3_dm_a', level=2)
        bob = self.user('r17g3_dm_b', level=2)
        governor = self.gov('r17g3_dm_g')
        thread = self.open(alice, bob, accepted=True)
        flagged = self.send(alice, thread['id'], '被举报的这一条').json()['data']
        self.send(alice, thread['id'], '同会话里别的私密话')
        self.assertEqual(bob.post(f"/api/dm/messages/{flagged['id']}/report", headers=HDRS,
                                  json={'reason': '违法违规内容'}).status_code, 201)
        self.dispatch()
        fx = fixture(self, 'dm', governor, '被举报的这一条')
        self.assertNotIn('同会话里别的私密话', json.dumps(fx, ensure_ascii=False))
        self.assertIn('_PASS govern-chat', run(fx))


if __name__ == '__main__':
    unittest.main()
