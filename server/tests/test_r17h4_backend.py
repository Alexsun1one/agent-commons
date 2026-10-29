"""R17-H4 · 广场消息治理员隐藏、找搭子需求 / 邀约举报与收起、私信举报与编辑收紧。
运行：cd server && python3 -m unittest tests.test_r17h4_backend -q"""
from modules.agentchat.tests.test_agentchat import LOBBY, AgentChatCase
from modules.dm.tests.test_dm import DmCase
from modules.social.tests import test_social as ts
from tests.helpers import HDRS
from tests.test_r17g_chat_reports import GovernorMixin
from tests.test_r17h_backend import BUDDY, INVITE


class ChatHideTest(GovernorMixin, AgentChatCase):
    def setUp(self):
        super().setUp()
        self.start_governance()

    def reported_case(self, author, reporter, governor, text='广告：加我领福利'):
        item = self.post_msg(author, LOBBY, text)['item']
        r = reporter.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS, json={'reason': '广告刷屏'})
        self.assertEqual(r.status_code, 201, r.text)
        self.dispatch()
        return item, self.cases(governor)[0]

    def status(self, message_id):
        return self.db.conn().execute('SELECT status FROM chat_message WHERE id = ?', (message_id,)).fetchone()[0]

    def test_governor_hides_the_message_and_it_is_audited_notified_and_reversible(self):
        author, reporter, other = self.member('h4_author', 2), self.member('h4_rep', 2), self.member('h4_other', 2)
        governor = self.gov('h4_gov')
        item, case = self.reported_case(author, reporter, governor)
        r = self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': 'hide', 'reason': '广告刷屏'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['state'], 'executed')
        self.assertEqual(self.status(item['id']), 'hidden')
        # 别的成员看不到正文，作者自己还能看到
        seen = {m['id']: m for m in other.get(f'/api/agentchat/channels/{LOBBY}/messages').json()['data']['items']}
        self.assertTrue(item['id'] not in seen or seen[item['id']]['status'] == 'hidden' and not seen[item['id']].get('body'))
        mine = {m['id']: m for m in author.get(f'/api/agentchat/channels/{LOBBY}/messages').json()['data']['items']}
        self.assertIn('领福利', mine[item['id']]['body'])
        # 审计 + 作者收到治理通知
        conn = self.db.conn()
        self.assertEqual(conn.execute("SELECT count(*) FROM audit_event WHERE action = 'gov.action.execute' AND actor_id = ? "
                                      "AND target_type = 'gov_action'", (governor.pid,)).fetchone()[0], 1)
        self.assertEqual(conn.execute('SELECT count(*) FROM gov_notice WHERE principal_id = ?', (author.pid,)).fetchone()[0], 1)
        # 作者不能再改 / 撤回被隐藏的消息
        self.assertEqual(author.patch(f"/api/agentchat/messages/{item['id']}", headers=HDRS, json={'body': '改一下'}).status_code, 409)
        # 治理员能恢复
        back = self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': 'restore', 'reason': '看错了'})
        self.assertEqual(back.status_code, 200, back.text)
        self.assertEqual(self.status(item['id']), 'ok')

    def test_only_governors_can_hide_and_other_content_actions_stay_closed(self):
        author, reporter, plain = self.member('h4_a2', 2), self.member('h4_r2', 2), self.member('h4_p2', 2)
        governor = self.gov('h4_g2')
        item, case = self.reported_case(author, reporter, governor)
        self.assertEqual(self.write(plain, f"/api/governance/cases/{case['id']}/actions", {'type': 'hide', 'reason': 'x'}).status_code, 404)
        self.assertEqual(self.status(item['id']), 'ok')
        for kind in ('pending_review', 'delete'):
            r = self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': kind, 'reason': 'x'})
            self.assertEqual(r.status_code, 409, kind + r.text)
        self.assertEqual(self.status(item['id']), 'ok')

    def test_recalled_message_cannot_be_hidden_and_closing_the_case_keeps_it_unhidden(self):
        author, reporter = self.member('h4_a3', 2), self.member('h4_r3', 2)
        governor = self.gov('h4_g3')
        item, case = self.reported_case(author, reporter, governor)
        # 作者在治理员处理前自己撤回了：不能再隐藏
        self.assertEqual(author.post(f"/api/agentchat/messages/{item['id']}/recall", headers=HDRS, json={}).status_code, 200)
        self.assertEqual(self.status(item['id']), 'deleted')
        r = self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': 'hide', 'reason': 'x'})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertEqual(self.status(item['id']), 'deleted')
        # 判为不成立：还没隐藏的消息保持原样
        item2 = self.post_msg(author, LOBBY, '第二条')['item']
        reporter.post(f"/api/agentchat/messages/{item2['id']}/report", headers=HDRS, json={'reason': '其他问题'})
        self.dispatch()
        case2 = [c for c in self.cases(governor) if c['id'] != case['id']][0]
        self.assertEqual(self.write(governor, f"/api/governance/cases/{case2['id']}/dismiss", {'reason': '没问题'}).status_code, 200)
        self.assertEqual(self.status(item2['id']), 'ok')


class BuddyReportTest(GovernorMixin, ts.SocialCase):
    def setUp(self):
        super().setUp()
        self.start_governance()

    def prefs(self, client, **body):
        self.assertEqual(self.put(client, '/api/social/me/prefs', body).status_code, 200)

    def test_post_report_opens_case_and_governor_collapses_it(self):
        author, reporter, other = self.user('h4_ba', level=2), self.user('h4_br', level=2), self.user('h4_bo', level=2)
        governor = self.gov('h4_bg')
        post = self.post(author, '/api/social/buddies', BUDDY, status=201).json()['data']
        self.assertEqual(self.post(author, f"/api/social/buddies/{post['id']}/report", {'reason': '自己报自己'}).status_code, 409)
        self.assertEqual(self.post(reporter, f"/api/social/buddies/{post['id']}/report", {'reason': '短'}).status_code, 422)
        r = self.post(reporter, f"/api/social/buddies/{post['id']}/report", {'reason': '广告刷屏'}, status=201)
        self.assertTrue(r.json()['data']['report_id'])
        self.assertEqual(self.post(reporter, f"/api/social/buddies/{post['id']}/report", {'reason': '又报一次'}).status_code, 409)
        self.assertEqual(self.post(reporter, '/api/social/buddies/nope/report', {'reason': '广告刷屏'}).status_code, 404)
        self.dispatch()
        case = self.cases(governor)[0]
        self.assertEqual(case['target']['title'], '找搭子需求')
        detail = governor.get('/api/governance/cases/' + case['id']).json()['data']
        self.assertEqual(detail['preview']['state'], 'buddy_post')
        self.assertIn(BUDDY['title'], detail['preview']['text'])
        self.assertEqual(detail['subject']['id'], author.pid)
        # 收起：别人看不到，作者仍看得到并被告知，不能自己恢复
        self.assertEqual(self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': 'hide', 'reason': '广告'}).status_code, 200)
        self.assertEqual(other.get('/api/social/buddies').json()['data']['items'], [])
        self.assertEqual(other.get(f"/api/social/buddies?kind=project").json()['data']['items'], [])
        mine = author.get('/api/social/buddies?mine=true').json()['data']['items']
        self.assertEqual([(i['id'], i['collapsed']) for i in mine], [(post['id'], True)])
        resume = author.patch(f"/api/social/buddies/{post['id']}", headers=HDRS, json={'state': 'open'})
        self.assertEqual(resume.status_code, 409)
        self.assertEqual(self.post(reporter, f"/api/social/buddies/{post['id']}/report", {'reason': '广告刷屏'}).status_code, 404)
        # 被收起的需求不能再被约
        self.prefs(author, buddy_open=True)
        self.assertEqual(self.post(other, '/api/social/buddy-invites/h4_ba', {**INVITE, 'post_id': post['id']}).status_code, 404)
        # 恢复
        self.assertEqual(self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': 'restore', 'reason': '误判'}).status_code, 200)
        self.assertEqual(len(other.get('/api/social/buddies').json()['data']['items']), 1)
        self.assertFalse(author.get('/api/social/buddies?mine=true').json()['data']['items'][0]['collapsed'])

    def test_invite_report_only_by_receiver_and_governor_cannot_hide_it(self):
        sender, receiver, third = self.user('h4_is', level=2), self.user('h4_ir', level=2), self.user('h4_it', level=2)
        governor = self.gov('h4_ig')
        self.prefs(receiver, buddy_open=True)
        sent = self.post(sender, '/api/social/buddy-invites/h4_ir', INVITE, status=201).json()['data']
        url = f"/api/social/buddy-invites/{sent['id']}/report"
        self.assertEqual(self.post(sender, url, {'reason': '自己报自己'}).status_code, 404)
        self.assertEqual(self.post(third, url, {'reason': '不是收件人'}).status_code, 404)
        self.post(receiver, url, {'reason': '骚扰辱骂'}, status=201)
        self.assertEqual(self.post(receiver, url, {'reason': '再报一次'}).status_code, 409)
        self.dispatch()
        case = self.cases(governor)[0]
        self.assertEqual(case['target']['title'], '搭子邀约')
        detail = governor.get('/api/governance/cases/' + case['id']).json()['data']
        self.assertEqual(detail['preview']['state'], 'buddy_invite')
        self.assertEqual(detail['subject']['id'], sender.pid)
        self.assertEqual(self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': 'hide', 'reason': 'x'}).status_code, 409)
        # 对发起人的处理（降级之类）照常可用
        self.assertEqual(self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': 'require_source', 'reason': '请注意措辞'}).status_code, 200)

    def test_withdrawn_invite_cannot_be_reported_and_export_has_reports(self):
        from app.authz import Actor
        from modules.social import service
        sender, receiver = self.user('h4_ws', level=2), self.user('h4_wr', level=2)
        self.prefs(receiver, buddy_open=True)
        sent = self.post(sender, '/api/social/buddy-invites/h4_wr', INVITE, status=201).json()['data']
        self.assertEqual(self.delete(sender, f"/api/social/buddy-invites/{sent['id']}").status_code, 200)
        self.assertEqual(self.post(receiver, f"/api/social/buddy-invites/{sent['id']}/report", {'reason': '撤回后举报'}).status_code, 404)
        post = self.post(sender, '/api/social/buddies', BUDDY, status=201).json()['data']
        self.post(receiver, f"/api/social/buddies/{post['id']}/report", {'reason': '广告刷屏'}, status=201)
        with self.db.read() as conn:
            dump = service.export_rows(conn, Actor(id=receiver.pid, level=2, status='active'))
        self.assertEqual([(r['target_kind'], r['target_id']) for r in dump['buddy_reports']], [('post', post['id'])])


class DmTightenTest(GovernorMixin, DmCase):
    def setUp(self):
        super().setUp()
        self.start_governance()

    def test_cannot_report_own_or_recalled_messages(self):
        alice, bob = self.user('h4_dm_a', level=2), self.user('h4_dm_b', level=2)
        thread = self.open(alice, bob, accepted=True)
        mine = self.send(alice, thread['id'], '我自己的话').json()['data']
        own = alice.post(f"/api/dm/messages/{mine['id']}/report", headers=HDRS, json={'reason': '举报自己的话'})
        self.assertEqual(own.status_code, 409, own.text)
        gone = self.send(alice, thread['id'], '马上撤回').json()['data']
        self.assertEqual(alice.post(f"/api/dm/messages/{gone['id']}/recall", headers=HDRS, json={}).status_code, 200)
        rec = bob.post(f"/api/dm/messages/{gone['id']}/report", headers=HDRS, json={'reason': '举报已撤回的'})
        self.assertEqual(rec.status_code, 409, rec.text)
        ok = bob.post(f"/api/dm/messages/{mine['id']}/report", headers=HDRS, json={'reason': '广告刷屏'})
        self.assertEqual(ok.status_code, 201, ok.text)
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM dm_report').fetchone()[0], 1)

    def test_edit_blocked_after_the_other_side_blocks_you(self):
        alice, bob = self.user('h4_dm_c', level=2), self.user('h4_dm_d', level=2)
        thread = self.open(alice, bob, accepted=True)
        msg = self.send(alice, thread['id'], '原文').json()['data']
        edit = lambda text: alice.patch(f"/api/dm/messages/{msg['id']}", headers=HDRS, json={'text': text})
        self.assertEqual(edit('第一次修改').status_code, 200)
        self.assertEqual(bob.put('/api/social/blocks/h4_dm_c', headers=HDRS, json={}).status_code, 200)
        blocked = edit('拉黑后再改')
        self.assertEqual(blocked.status_code, 403, blocked.text)
        text = self.db.conn().execute('SELECT text FROM dm_message WHERE id = ?', (msg['id'],)).fetchone()[0]
        self.assertEqual(text, '第一次修改')
        self.assertEqual(bob.delete('/api/social/blocks/h4_dm_c', headers=HDRS).status_code, 200)
        self.assertEqual(edit('解除拉黑后可以').status_code, 200)

    def test_dm_case_cannot_be_hidden(self):
        alice, bob = self.user('h4_dm_e', level=2), self.user('h4_dm_f', level=2)
        governor = self.gov('h4_dm_g')
        thread = self.open(alice, bob, accepted=True)
        msg = self.send(alice, thread['id'], '被举报的这一条').json()['data']
        bob.post(f"/api/dm/messages/{msg['id']}/report", headers=HDRS, json={'reason': '骚扰辱骂'})
        self.dispatch()
        case = self.cases(governor)[0]
        r = self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': 'hide', 'reason': 'x'})
        self.assertEqual(r.status_code, 409, r.text)


if __name__ == '__main__':
    import unittest
    unittest.main()
