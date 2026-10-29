"""R17-G · 广场消息 / 私信举报进治理员队列（真实走 agentchat、dm 的举报接口，再派发 outbox）。"""
import secrets
from unittest import mock

from app import flags, outbox
from modules.agentchat.tests.test_agentchat import LOBBY, AgentChatCase
from modules.dm.tests.test_dm import DmCase
from modules.governance import model
from tests.helpers import HDRS


class GovernorMixin:
    def start_governance(self):
        gateway = mock.patch.object(model, 'gateway', return_value=None)
        gateway.start()
        self.addCleanup(gateway.stop)

    def gov(self, handle):
        return self.user(handle, level=2, roles=('governor',), totp=True)

    def dispatch(self):
        for _ in range(10):
            if not outbox.dispatch(self.db):
                return

    def write(self, client, path, body):
        return client.post(path, headers={**HDRS, 'Idempotency-Key': secrets.token_hex(8)}, json=body)

    def cases(self, governor):
        r = governor.get('/api/governance/queue')
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['data']


class ChatReportToQueueTest(GovernorMixin, AgentChatCase):
    def setUp(self):
        super().setUp()
        self.start_governance()

    def test_chat_report_opens_one_case_with_the_reported_message_only(self):
        author = self.member('r17g_author', level=2)
        first = self.member('r17g_rep1', level=2)
        second = self.member('r17g_rep2', level=2)
        governor = self.gov('r17g_gov')
        item = self.post_msg(author, LOBBY, '广告：加我领福利 <b>x</b>')['item']
        self.post_msg(author, LOBBY, '另一条没被举报的话')
        for who, reason in ((first, '广告刷屏'), (second, '骚扰辱骂')):
            r = who.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS, json={'reason': reason})
            self.assertEqual(r.status_code, 201, r.text)
        self.dispatch()
        cases = self.cases(governor)
        self.assertEqual(len(cases), 1, '同一条消息的多次举报进同一个事项')
        self.assertEqual(cases[0]['target']['title'], '广场消息')
        self.assertEqual(cases[0]['report_count'], 2)
        self.assertEqual(cases[0]['source'], 'report')
        detail = governor.get('/api/governance/cases/' + cases[0]['id']).json()['data']
        self.assertEqual(detail['preview']['state'], 'chat_message')
        self.assertIn('广告：加我领福利', detail['preview']['text'])
        self.assertNotIn('另一条没被举报的话', repr(detail))
        self.assertEqual(detail['subject']['id'], author.pid)
        self.assertEqual({r['reason_code'] for r in detail['reports']}, {'spam', 'harassment'})

    def test_replayed_event_does_not_duplicate(self):
        author = self.member('r17g_a2', level=2)
        reporter = self.member('r17g_r2', level=2)
        governor = self.gov('r17g_g2')
        item = self.post_msg(author, LOBBY, '可疑内容')['item']
        reporter.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS, json={'reason': '其他问题'})
        self.dispatch()
        event = self.db.conn().execute("SELECT * FROM outbox_event WHERE event_type = 'agentchat.reported'").fetchone()
        from modules.governance import chat
        with self.db.write() as conn:
            chat.on_reported(conn, outbox._event(event))
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM gov_report').fetchone()[0], 1)
        self.assertEqual(len(self.cases(governor)), 1)

    def test_governor_can_dismiss_and_reporter_outcome_follows(self):
        author = self.member('r17g_a3', level=2)
        reporter = self.member('r17g_r3', level=2)
        governor = self.gov('r17g_g3')
        item = self.post_msg(author, LOBBY, '没问题的话')['item']
        reporter.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS, json={'reason': '其他问题'})
        self.dispatch()
        case = self.cases(governor)[0]
        r = self.write(governor, f"/api/governance/cases/{case['id']}/dismiss", {'reason': '看过了，没问题'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.db.conn().execute('SELECT outcome FROM gov_report').fetchone()[0], 'rejected')
        self.assertEqual(self.cases(governor), [])
        # 事项已结案，不能再处置
        again = self.write(governor, f"/api/governance/cases/{case['id']}/actions", {'type': 'hide', 'reason': 'x'})
        self.assertIn(again.status_code, (409, 422))

    def test_switch_off_keeps_the_report_row_but_opens_no_case(self):
        author = self.member('r17g_a4', level=2)
        reporter = self.member('r17g_r4', level=2)
        item = self.post_msg(author, LOBBY, '内容')['item']
        with self.db.write() as conn:
            flags.set_flag(conn, 'gov.reports', False, None)
        reporter.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS, json={'reason': '其他问题'})
        self.dispatch()
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM chat_report').fetchone()[0], 1)
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM gov_case').fetchone()[0], 0)

    def test_reporter_who_is_a_governor_cannot_handle_their_own_report(self):
        author = self.member('r17g_a5', level=2)
        governor = self.gov('r17g_g5')
        other = self.gov('r17g_g5b')
        item = self.post_msg(author, LOBBY, '可疑内容')['item']
        r = governor.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS, json={'reason': '其他问题'})
        self.assertEqual(r.status_code, 201, r.text)
        self.dispatch()
        case = self.cases(other)[0]
        detail = governor.get('/api/governance/cases/' + case['id']).json()['data']
        self.assertIn('reporter', detail['viewer']['conflicts'])
        mine = self.write(governor, f"/api/governance/cases/{case['id']}/dismiss", {'reason': '想自己放过'})
        self.assertEqual(mine.status_code, 403, mine.text)
        self.assertEqual(self.write(other, f"/api/governance/cases/{case['id']}/dismiss", {'reason': '另一位治理员处理'}).status_code, 200)

    def test_non_governor_cannot_read_the_queue(self):
        member = self.member('r17g_plain', level=2)
        self.assertEqual(member.get('/api/governance/queue').status_code, 404)


class DmReportToQueueTest(GovernorMixin, DmCase):
    def setUp(self):
        super().setUp()
        self.start_governance()

    def test_dm_report_hands_over_only_the_reported_message(self):
        alice = self.user('r17g_dm_a', level=2)
        bob = self.user('r17g_dm_b', level=2)
        governor = self.gov('r17g_dm_g')
        thread = self.open(alice, bob, accepted=True)
        flagged = self.send(alice, thread['id'], '需要治理查看的这一条').json()['data']
        self.send(alice, thread['id'], '另一条私密正文不能交给治理')
        r = bob.post(f"/api/dm/messages/{flagged['id']}/report", headers=HDRS, json={'reason': '违法违规内容'})
        self.assertEqual(r.status_code, 201, r.text)
        self.dispatch()
        case = self.cases(governor)[0]
        self.assertEqual(case['target']['title'], '私信（被举报的一条）')
        detail = governor.get('/api/governance/cases/' + case['id']).json()['data']
        self.assertEqual(detail['preview']['state'], 'dm_message')
        self.assertIn('需要治理查看的这一条', detail['preview']['text'])
        self.assertNotIn('另一条私密正文不能交给治理', repr(detail))
        self.assertEqual(detail['reports'][0]['reason_code'], 'illegal')
        self.assertEqual(detail['subject']['id'], alice.pid)
