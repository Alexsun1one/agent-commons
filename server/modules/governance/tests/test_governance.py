"""治理模块端到端测试（BE-0 的 TestClient 夹具，时间可注入，不联网）。"""
import secrets
import sqlite3
import types
import unittest
from datetime import datetime, timezone
from unittest import mock

from app import flags, ledger, outbox
from modules.governance import detectors, model, screening, service
from modules.governance.detectors import Signal
from tests.helpers import HDRS, AppCase

NOW = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc).timestamp()
HOUR = 3600
PHONE = '13812345678'


class GovCase(AppCase):
    def setUp(self):
        self.now = NOW
        patcher = mock.patch('app.clock.now_ts', side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        no_gateway = mock.patch.object(model, 'gateway', return_value=None)
        no_gateway.start()
        self.addCleanup(no_gateway.stop)
        super().setUp()

    # ---- 小工具

    def user(self, handle, *args, **kwargs):
        return super().user(f'u_{handle}'.replace('-', '_'), *args, **kwargs)

    def gov(self, handle, level=2):
        return self.user(handle, level, roles=('governor',), totp=True)

    def send(self, client, method, path, body=None, key=True):
        headers = dict(HDRS)
        if key:
            headers['Idempotency-Key'] = secrets.token_hex(8)
        return client.request(method, path, headers=headers, json=body)

    def ok(self, client, method, path, body=None, status=200):
        r = self.send(client, method, path, body)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data']

    def get(self, client, path, status=200):
        r = client.get(path)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 200 else r.json()

    def dispatch(self):
        for _ in range(10):
            if not outbox.dispatch(self.db):
                return

    def post_obj(self, client, body='正常的讨论内容', title='标题', **kw):
        return self.obj(client, title=title, content={'body': body}, **kw)['id']

    def one(self, sql, *params):
        return self.db.conn().execute(sql, params).fetchone()

    def case_of(self, object_id):
        return self.one("SELECT * FROM gov_case WHERE target_id = ? ORDER BY opened_at DESC LIMIT 1", object_id)

    def lifecycle(self, object_id):
        return self.one('SELECT lifecycle FROM object_head WHERE id = ?', object_id)['lifecycle']

    def report(self, client, object_id, reason='spam', status=201):
        return self.ok(client, 'POST', '/api/governance/reports', {'target_id': object_id, 'reason_code': reason},
                       status)

    def notices(self, client):
        return self.get(client, '/api/governance/me/notices')


class AccessTest(GovCase):
    def test_non_governor_gets_404_everywhere(self):
        member = self.user('elder', 5)
        anon = self.client()
        paths = ('/api/governance/queue', '/api/governance/stats', '/api/governance/rules',
                 '/api/governance/cases/nope', '/api/governance/detectors', '/api/governance/rules/spam.ad/history')
        for c in (member, anon):
            for path in paths:
                r = c.get(path)
                self.assertEqual(r.status_code, 404, (path, r.text))
                self.assertEqual(self.code(r), 'resource_not_found')
            for method, path, body in (('POST', '/api/governance/premoderation',
                                        {'enabled': True, 'reason': 'x', 'confirm': '先审后发'}),
                                       ('PATCH', '/api/governance/rules/spam.ad', {'reason': 'x', 'enabled': False}),
                                       ('POST', '/api/governance/cases/x/actions', {'type': 'hide', 'reason': 'x'})):
                self.assertEqual(self.send(c, method, path, body).status_code, 404, path)
        self.assertEqual(self.code(self.user('plain', 2).get('/api/governance/appeals')), 'resource_not_found')
        no_totp = self.user('g-no-totp', 2, roles=('governor',))
        self.assertEqual(self.code(no_totp.get('/api/governance/queue')), 'totp_setup_required')
        g = self.gov('g1')
        self.get(g, '/api/governance/queue')
        self.assertTrue(self.get(g, '/api/governance/me')['governor'])
        self.assertFalse(self.get(member, '/api/governance/me')['governor'])
        self.assertTrue(self.get(member, '/api/governance/me')['reviewer'] is False)  # L5 也要开动态验证码


class ReportTest(GovCase):
    def test_reports_are_weighted_by_level(self):
        author = self.user('author', 2)
        oid = self.post_obj(author)
        newbie, vet = self.user('newbie', 1), self.user('vet', 4)
        first = self.report(newbie, oid)
        self.assertTrue(first['created'])
        again = self.report(newbie, oid, status=200)
        self.assertEqual(again, {'id': first['id'], 'created': False})
        self.report(vet, oid)
        self.assertEqual(self.code(self.send(author, 'POST', '/api/governance/reports',
                                             {'target_id': oid, 'reason_code': 'spam'})), 'state_conflict')
        self.assertEqual(self.code(self.send(newbie, 'POST', '/api/governance/reports',
                                             {'target_id': oid, 'reason_code': 'nonsense'})), 'validation_failed')
        weights = sorted(r['weight'] for r in self.db.conn().execute('SELECT weight FROM gov_report'))
        self.assertEqual(weights, [0.5, 2.0])
        case = self.case_of(oid)
        self.assertEqual((case['source'], case['risk'], case['risk_score']), ('report', 'high', 2.5))
        g = self.gov('g1')
        queue = self.get(g, '/api/governance/queue')
        self.assertEqual([c['report_count'] for c in queue], [2])

    def test_accuracy_history_changes_weight(self):
        p = {'base': 1.0, 'level_bonus': {'1': -0.5}, 'accuracy_axis': 0.7, 'accuracy_scale': 1.0,
             'min_reviewed': 5, 'floor': 0.1, 'cap': 6.0}
        self.assertGreater(service.report_weight(1, 20, 0, p), service.report_weight(1, 10, 10, p))


class ScreeningTest(GovCase):
    def test_l1_contact_goes_pending_review_and_author_still_sees_it(self):
        newbie, other = self.user('newbie', 1), self.user('other', 2)
        oid = self.post_obj(newbie, f'有事加我微信 abc_12345 或打 {PHONE}')
        self.dispatch()
        self.assertEqual(self.lifecycle(oid), 'pending_review')
        self.assertEqual(newbie.get(f'/api/objects/{oid}').status_code, 200)
        self.assertEqual(other.get(f'/api/objects/{oid}').status_code, 404)
        action = self.one("SELECT * FROM gov_action WHERE target_id = ? AND action_type = 'pending_review'", oid)
        self.assertEqual((action['automatic'], action['actor_kind'], action['rule_id']), (1, 'system', 'pii.contact'))
        sig = self.one("SELECT * FROM gov_signal WHERE target_id = ? AND rule_id = 'pii.contact'", oid)
        self.assertEqual(sig['over_threshold'], 1)
        self.assertNotIn(PHONE, sig['locator_json'] + sig['summary'] + sig['output_json'])
        notes = self.notices(newbie)
        self.assertEqual(notes[0]['title'], '你的一条内容正在等待审核')
        self.assertIn('联系方式与个人信息（第 1 版）', notes[0]['body'])

    def test_l2_contact_only_opens_a_case(self):
        author = self.user('author', 2)
        oid = self.post_obj(author, f'电话 {PHONE}')
        self.dispatch()
        self.assertEqual(self.lifecycle(oid), 'active')
        self.assertEqual(self.case_of(oid)['status'], 'open')
        self.assertIsNone(self.one('SELECT 1 FROM gov_action WHERE target_id = ?', oid))
        self.dispatch()
        self.assertEqual(self.one('SELECT count(*) AS n FROM gov_screening WHERE target_id = ?', oid)['n'], 1)

    def test_clean_content_opens_nothing(self):
        author = self.user('author', 1)
        oid = self.post_obj(author, '今天读了一篇关于检索增强的论文，版本 2.1.0 的实验做得很扎实。')
        self.dispatch()
        self.assertIsNone(self.case_of(oid))
        self.assertEqual(self.lifecycle(oid), 'active')

    def test_flood_rate_limits_then_holds_overflow(self):
        author = self.user('busy', 2)
        ids = []
        for i in range(10):
            self.now += 1
            ids.append(self.post_obj(author, f'第 {i} 条，各不相同的内容 {i * 7919}'))
        self.dispatch()
        limit = self.one("SELECT * FROM gov_action WHERE subject_id = ? AND action_type = 'rate_limit'", author.pid)
        self.assertEqual((limit['state'], limit['automatic'], limit['target_id']), ('executed', 1, ids[8]))
        self.assertEqual([self.lifecycle(i) for i in ids[:9]], ['active'] * 9)
        self.assertEqual(self.lifecycle(ids[9]), 'pending_review')
        self.now += 2 * HOUR
        self.notices(author)  # 顺带清扫
        self.assertEqual(self.one('SELECT state FROM gov_action WHERE id = ?', limit['id'])['state'], 'expired')

    def test_duplicate_content_signal(self):
        a, b = self.user('a', 2), self.user('b', 2)
        text = '这是一段足够长的、会被原样复制到别处的介绍文字，用来测试重复检测。'
        self.post_obj(a, text)
        self.dispatch()
        oid = self.post_obj(b, text)
        self.dispatch()
        self.assertIsNotNone(self.one("SELECT 1 FROM gov_signal WHERE target_id = ? AND rule_id = 'dup.content'", oid))

    def test_premoderation_switch_is_audited_and_holds_new_content(self):
        member, g = self.user('m', 4), self.gov('g1')
        body = {'enabled': True, 'reason': '外部投诉激增，先审后发一天', 'confirm': '先审后发'}
        self.assertEqual(self.send(member, 'POST', '/api/governance/premoderation', body).status_code, 404)
        self.assertEqual(self.code(self.send(g, 'POST', '/api/governance/premoderation', dict(body, confirm='好'))),
                         'validation_failed')
        self.ok(g, 'POST', '/api/governance/premoderation', body)
        self.assertTrue(flags.enabled(self.db.conn(), 'gov.premoderation'))
        actions = {r['action'] for r in self.db.conn().execute(
            "SELECT action FROM audit_event WHERE target_id = 'gov.premoderation'")}
        self.assertTrue({'flag.set', 'gov.premoderation.set'} <= actions)
        oid = self.post_obj(member, '资深成员的普通内容')
        self.dispatch()
        self.assertEqual(self.lifecycle(oid), 'pending_review')
        case = self.case_of(oid)
        self.assertEqual(case['source'], 'premoderation')
        self.ok(g, 'POST', f'/api/governance/cases/{case["id"]}/actions', {'type': 'restore', 'reason': '看过了，没问题'})
        self.assertEqual(self.lifecycle(oid), 'active')
        self.assertEqual(self.case_of(oid)['status'], 'dismissed')

    def test_upload_screening_blocks_svg(self):
        owner = self.user('owner', 2)
        with self.db.write() as conn:
            verdict = service.screen_upload(conn, upload_id='up-1', kind='image', mime='image/svg+xml', size=120,
                                            owner_id=owner.pid)
            clean = service.screen_upload(conn, upload_id='up-2', kind='image', mime='image/png', size=120,
                                          width=10, height=10, owner_id=owner.pid)
        self.assertTrue(verdict['blocked'])
        self.assertFalse(clean['blocked'])
        g = self.gov('g1')
        detail = self.get(g, f'/api/governance/cases/{verdict["case_id"]}')
        self.assertEqual(detail['preview']['state'], 'upload')

    def test_public_layer_hook(self):
        author = self.user('author', 2)
        oid = self.post_obj(author)
        conn = self.db.conn()
        head = {'id': oid, 'title': '标题', 'type': 'discussion'}
        self.assertEqual(screening.screen(conn, None, head, None, f'联系 {PHONE}')['result'], 'block')
        self.assertEqual(screening.screen(conn, None, head, None, '一段干净的正文')['result'], 'pass')
        self.report(self.user('r', 2), oid)
        verdict = screening.screen(conn, None, head, None, '一段干净的正文')
        self.assertEqual(verdict['result'], 'review')
        self.assertEqual(verdict['reasons'], [{'code': 'gov.case_open', 'severity': 'review'}])


class ActionTest(GovCase):
    def setUp(self):
        super().setUp()
        self.g1, self.g2 = self.gov('g1'), self.gov('g2')
        self.author = self.user('author', 2)
        self.reporter = self.user('reporter', 1)
        self.oid = self.post_obj(self.author, '有争议的内容')
        self.report(self.reporter, self.oid)
        self.case = self.case_of(self.oid)['id']

    def act(self, client, kind, reason='违反社区规则', status=200, case=None):
        r = self.send(client, 'POST', f'/api/governance/cases/{case or self.case}/actions',
                      {'type': kind, 'reason': reason})
        self.assertEqual(r.status_code, status, r.text)
        return r.json().get('data') or r.json()

    def test_ban_needs_a_second_governor(self):
        proposal = self.act(self.g1, 'ban', '多次骚扰其他成员')
        self.assertEqual(proposal['state'], 'awaiting_second')
        self.assertEqual(self.one('SELECT status FROM principal WHERE id = ?', self.author.pid)['status'], 'active')
        r = self.send(self.g1, 'POST', f'/api/governance/actions/{proposal["action_id"]}/confirm')
        self.assertEqual((r.status_code, self.code(r)), (403, 'action_not_allowed'))
        self.ok(self.g2, 'POST', f'/api/governance/actions/{proposal["action_id"]}/confirm')
        self.assertEqual(self.one('SELECT status FROM principal WHERE id = ?', self.author.pid)['status'], 'suspended')
        self.assertEqual(self.author.get('/api/me').status_code, 401)
        row = self.one('SELECT actor_id, second_actor_id FROM gov_action WHERE id = ?', proposal['action_id'])
        self.assertEqual((row['actor_id'], row['second_actor_id']), (self.g1.pid, self.g2.pid))

    def test_delete_needs_a_second_governor_and_idempotency_key(self):
        r = self.send(self.g1, 'POST', f'/api/governance/cases/{self.case}/actions',
                      {'type': 'delete', 'reason': '违法内容'}, key=False)
        self.assertEqual(self.code(r), 'precondition_required')
        proposal = self.act(self.g1, 'delete', '违法内容')
        self.assertEqual(self.lifecycle(self.oid), 'active')
        self.ok(self.g2, 'POST', f'/api/governance/actions/{proposal["action_id"]}/confirm')
        self.assertEqual(self.lifecycle(self.oid), 'withdrawn')
        with self.assertRaises(sqlite3.IntegrityError), self.db.write() as conn:
            conn.execute("UPDATE gov_action SET second_actor_id = NULL WHERE id = ?", (proposal['action_id'],))

    def test_reporter_cannot_process_their_own_report(self):
        self.report(self.g1, self.oid)
        r = self.send(self.g1, 'POST', f'/api/governance/cases/{self.case}/actions', {'type': 'hide', 'reason': 'x'})
        self.assertEqual((r.status_code, self.code(r)), (403, 'action_not_allowed'))
        detail = self.get(self.g1, f'/api/governance/cases/{self.case}')
        self.assertEqual(detail['viewer']['conflicts'], ['reporter'])
        proposal = self.act(self.g2, 'ban', '骚扰')
        r = self.send(self.g1, 'POST', f'/api/governance/actions/{proposal["action_id"]}/confirm')
        self.assertEqual(self.code(r), 'action_not_allowed')
        self.act(self.g2, 'hide', '骚扰')
        self.assertEqual(self.lifecycle(self.oid), 'hidden')

    def test_automatic_actions_can_only_be_reversible(self):
        with self.db.write() as conn:
            book = service.rulebook(conn)
            for kind in ('delete', 'ban', 'deduct', 'demote', 'hide'):
                with self.assertRaises(ValueError):
                    service.apply_auto(conn, book, self.case, kind, 'pii.contact', 'x')
        with self.assertRaises(sqlite3.IntegrityError), self.db.write() as conn:
            conn.execute("INSERT INTO gov_action (id, case_id, action_type, target_type, target_id, reversible, "
                         "automatic, state, actor_kind, reason, created_at) VALUES ('x', ?, 'delete', 'object', ?, 0, "
                         "1, 'executed', 'system', 'x', '2026-11-02T00:00:00.000000Z')", (self.case, self.oid))
        for rule_id, value in (('pii.contact', 'delete'), ('spam.ad', 'ban'), ('agent.default', 'pending_review')):
            r = self.send(self.g1, 'PATCH', f'/api/governance/rules/{rule_id}', {'reason': 'x', 'auto_action': value})
            self.assertEqual(self.code(r), 'validation_failed', rule_id)

    def test_deduct_goes_through_ledger_and_appeal_reverses_it(self):
        reason = '在讨论区反复发引流广告'
        self.act(self.g1, 'deduct', reason)
        conn = self.db.conn()
        entry = self.one("SELECT * FROM ledger_entry WHERE subject_id = ? AND event_type = 'violation'", self.author.pid)
        self.assertEqual(entry['points'], -50)
        self.assertEqual(ledger.balance(conn, self.author.pid), -50)
        self.assertEqual(ledger.balance(conn, self.reporter.pid), 3)
        self.assertEqual(self.one('SELECT outcome FROM gov_report WHERE case_id = ?', self.case)['outcome'], 'upheld')
        notice = next(n for n in self.notices(self.author) if n['kind'] == 'action')
        self.assertEqual(notice['title'], '你被扣除了贡献值')
        self.assertIn(reason, notice['body'])
        self.assertIn('扣除 50 分', notice['body'])
        self.assertTrue(notice['appeal']['can_appeal'])
        appeal = self.ok(self.author, 'POST', '/api/governance/me/appeals',
                         {'action_id': notice['action_id'], 'statement': '那是活动报名链接，不是广告'}, 201)
        r = self.send(self.author, 'POST', '/api/governance/me/appeals',
                      {'action_id': notice['action_id'], 'statement': '再申诉一次'})
        self.assertEqual(self.code(r), 'state_conflict')
        self.assertEqual(self.case_of(self.oid)['status'], 'appealed')
        self.assertEqual(self.author.get('/api/governance/appeals').status_code, 404)
        with self.db.write() as w:
            w.execute('UPDATE profile SET level = 5 WHERE principal_id = ?', (self.g1.pid,))
        self.assertEqual(len(self.get(self.g1, '/api/governance/appeals')), 1)
        r = self.send(self.g1, 'POST', f'/api/governance/appeals/{appeal["id"]}/decide',
                      {'outcome': 'overturned', 'reason': '确是活动链接'})
        self.assertEqual(self.code(r), 'action_not_allowed')
        judge = self.user('judge', 5, totp=True)
        self.ok(judge, 'POST', f'/api/governance/appeals/{appeal["id"]}/decide',
                {'outcome': 'overturned', 'reason': '确是活动链接'})
        self.assertEqual(ledger.balance(conn, self.author.pid), 0)
        self.assertEqual(ledger.balance(conn, self.reporter.pid), 0)
        self.assertEqual(self.one('SELECT state FROM gov_action WHERE id = ?', notice['action_id'])['state'],
                         'reverted')
        latest = self.notices(self.author)
        self.assertIn('申诉成立，处理已撤销', [n['title'] for n in latest])
        self.assertFalse(next(n for n in latest if n['kind'] == 'action')['appeal']['can_appeal'])

    def test_hide_notice_explains_reason_and_rule(self):
        self.act(self.g1, 'hide', '人身攻击')
        notice = self.notices(self.author)[0]
        self.assertEqual(notice['title'], '你的一条内容已被隐藏')
        for part in ('原因：人身攻击', '依据：', '申诉'):
            self.assertIn(part, notice['body'])
        self.assertEqual(self.reporter.get('/api/governance/me/notices').json()['data'], [])
        restore = self.ok(self.g1, 'POST', f'/api/governance/actions/{notice["action_id"]}/revert', {'reason': '误判'})
        self.assertEqual(self.lifecycle(self.oid), 'active')
        self.assertTrue(restore['restore_action_id'])

    def test_withdrawn_object_shows_withdrawn_preview(self):
        self.ok(self.author, 'POST', f'/api/objects/{self.oid}/withdraw')
        detail = self.get(self.g1, f'/api/governance/cases/{self.case}')
        self.assertEqual(detail['preview'], {'state': 'withdrawn', 'message': '已撤回',
                                             'withdrawn_at': detail['preview']['withdrawn_at']})
        self.assertEqual(detail['target']['title'], '（已撤回）')
        self.assertIsNotNone(self.one("SELECT 1 FROM audit_event WHERE action = 'gov.case.view' AND target_id = ?",
                                      self.case))

    def test_dismiss_rejects_reports_without_reward(self):
        self.ok(self.g1, 'POST', f'/api/governance/cases/{self.case}/dismiss', {'reason': '不违规'})
        self.assertEqual(self.case_of(self.oid)['status'], 'dismissed')
        self.assertEqual(self.one('SELECT outcome FROM gov_report WHERE case_id = ?', self.case)['outcome'], 'rejected')
        self.assertEqual(ledger.balance(self.db.conn(), self.reporter.pid), 0)

    def test_queue_pagination_and_stats(self):
        for i in range(2):
            oid = self.post_obj(self.author, f'另一条 {i}')
            self.report(self.reporter, oid)
        page = self.g1.get('/api/governance/queue?limit=2').json()
        self.assertEqual(len(page['data']), 2)
        cursor = page['meta']['next_cursor']
        rest = self.get(self.g1, f'/api/governance/queue?limit=2&cursor={cursor}')
        self.assertEqual(len(rest), 1)
        self.assertEqual(self.get(self.g1, '/api/governance/queue?risk=critical'), [])
        stats = self.get(self.g1, '/api/governance/stats')
        self.assertEqual(stats['pending'], 3)
        self.assertFalse(stats['flags']['gov.model_egress'])
        self.assertTrue(stats['pii_rules']['available'])
        self.assertIn('adoption_rate', stats['reviews']['agent'])

    def test_manual_case_assign_cancel_and_detectors(self):
        other = self.post_obj(self.author, '第三方投诉的内容')
        made = self.ok(self.g1, 'POST', '/api/governance/cases', {'target_id': other, 'category': 'copyright'}, 201)
        r = self.send(self.g1, 'POST', f'/api/governance/cases/{made["case_id"]}/assign', {'assignee_id': self.author.pid})
        self.assertEqual(self.code(r), 'validation_failed')
        self.ok(self.g1, 'POST', f'/api/governance/cases/{made["case_id"]}/assign', {'assignee_id': self.g2.pid})
        self.assertEqual(self.case_of(other)['status'], 'triaged')
        proposal = self.act(self.g1, 'delete', '版权方投诉', case=made['case_id'])
        self.ok(self.g1, 'POST', f'/api/governance/actions/{proposal["action_id"]}/cancel', {'reason': '版权方撤回投诉'})
        self.assertEqual(self.one('SELECT state FROM gov_action WHERE id = ?', proposal['action_id'])['state'], 'cancelled')
        names = {d['name']: d for d in self.get(self.g1, '/api/governance/detectors')}
        self.assertFalse(names['rule.pii']['egress'])
        self.assertEqual(names['agent.gateway.text']['status'], 'blocked_by_flag')

    def test_export_includes_governance_records(self):
        self.act(self.g1, 'hide', '人身攻击')
        data = self.get(self.author, '/api/me/export')
        self.assertEqual(len(data['governance']['notices']), 1)


class VolunteerTest(GovCase):
    def test_l3_hide_needs_second_l3_or_restores_after_24h(self):
        newbie, viewer = self.user('newbie', 1), self.user('viewer', 2)
        v1, v2, l2 = self.user('v1', 3), self.user('v2', 3), self.user('l2', 2)
        oid = self.post_obj(newbie, '一条普通内容')
        body = {'object_id': oid, 'reason': '疑似引战'}
        self.assertEqual(self.send(l2, 'POST', '/api/governance/volunteer/hide', body).status_code, 404)
        hidden = self.ok(v1, 'POST', '/api/governance/volunteer/hide', body)
        self.assertEqual(self.lifecycle(oid), 'hidden')
        self.assertEqual(viewer.get(f'/api/objects/{oid}').status_code, 404)
        self.assertEqual(newbie.get(f'/api/objects/{oid}').status_code, 200)
        r = self.send(v1, 'POST', f'/api/governance/volunteer/actions/{hidden["action_id"]}/confirm')
        self.assertEqual(self.code(r), 'action_not_allowed')
        self.now += 23 * HOUR
        self.notices(newbie)
        self.assertEqual(self.lifecycle(oid), 'hidden')
        self.now += 2 * HOUR
        notes = self.notices(newbie)
        self.assertEqual(self.lifecycle(oid), 'active')
        self.assertEqual(notes[0]['kind'], 'expired')
        self.assertIn('自动恢复', [n for n in notes if n['kind'] == 'action'][0]['body'])

        other = self.post_obj(newbie, '另一条普通内容')
        second = self.ok(v1, 'POST', '/api/governance/volunteer/hide', {'object_id': other, 'reason': '刷屏'})
        queue = self.get(v2, '/api/governance/volunteer/queue')
        self.assertEqual([q['action_id'] for q in queue], [second['action_id']])
        self.assertEqual(self.get(v1, '/api/governance/volunteer/queue'), [])
        self.ok(v2, 'POST', f'/api/governance/volunteer/actions/{second["action_id"]}/confirm')
        self.now += 30 * HOUR
        self.notices(newbie)
        self.assertEqual(self.lifecycle(other), 'hidden')

        senior = self.post_obj(l2, 'L2 成员的内容')
        r = self.send(v1, 'POST', '/api/governance/volunteer/hide', {'object_id': senior, 'reason': 'x'})
        self.assertEqual(self.code(r), 'state_conflict')

    def test_worker_periodic_task_restores_without_any_request(self):
        from app import worker
        self.assertIn('governance.sweep', worker.PERIODIC)
        self.assertIn('governance.agent_jobs', worker.PERIODIC)
        newbie, v1 = self.user('newbie', 1), self.user('v1', 3)
        oid = self.post_obj(newbie, '一条普通内容')
        self.ok(v1, 'POST', '/api/governance/volunteer/hide', {'object_id': oid, 'reason': '疑似引战'})
        self.now += 25 * HOUR
        worker.run_periodic(self.db)
        self.assertEqual(self.lifecycle(oid), 'active')


class RuleEditTest(GovCase):
    def test_rule_edit_is_versioned_and_audited(self):
        g = self.gov('g1')
        rules = {r['id']: r for r in self.get(g, '/api/governance/rules')}
        params = dict(rules['spam.ad']['params'])
        params['keywords'] = params['keywords'] + ['包邮代购']
        updated = self.ok(g, 'PATCH', '/api/governance/rules/spam.ad', {'reason': '新出现的引流话术', 'params': params})
        self.assertEqual(updated['version'], 2)
        audit = self.one("SELECT * FROM audit_event WHERE action = 'gov.rule.update' AND target_id = 'spam.ad'")
        self.assertEqual(audit['actor_id'], g.pid)
        history = self.get(g, '/api/governance/rules/spam.ad/history')
        self.assertEqual([h['version'] for h in history], [2, 1])
        same = self.ok(g, 'PATCH', '/api/governance/rules/spam.ad', {'reason': '重复提交', 'params': params})
        self.assertEqual(same['version'], 2)
        bad = (('spam.ad', {'params': {'keywords': 'x'}}), ('spam.ad', {'threshold': 2}),
               ('spam.ad', {'params': dict(params, extra=1)}),
               ('policy.violation', {'params': {'points': -50, 'event_type': 'other'}}),
               ('policy.violation', {'params': {'points': 10, 'event_type': 'violation'}}))
        for rule_id, change in bad:
            r = self.send(g, 'PATCH', f'/api/governance/rules/{rule_id}', dict(change, reason='x'))
            self.assertEqual(r.status_code, 422, (rule_id, change, r.text))
        author = self.user('seller', 2)
        oid = self.post_obj(author, '全场包邮代购，加微信详聊，刷单返利')
        self.dispatch()
        sig = self.one("SELECT rule_version FROM gov_signal WHERE target_id = ? AND rule_id = 'spam.ad'", oid)
        self.assertEqual(sig['rule_version'], 2)


class FakeEgress:
    name, version, kind, modalities, egress = 'agent.fake', '1', 'agent', {'text'}, True
    model, model_version = 'fake-model', '0'

    def __init__(self):
        self.calls = []

    def check(self, item):
        self.calls.append(item)
        return [Signal('agent.default', 'spam', 0.95, 0.9, {'field': 'text'}, '像广告', 'hide')]


class AgentTest(GovCase):
    def test_egress_detector_not_called_when_flag_off(self):
        fake = detectors.register(FakeEgress())
        self.addCleanup(detectors.unregister, fake.name)
        author = self.user('author', 2)
        oid = self.post_obj(author, f'打 {PHONE} 领优惠券')
        self.dispatch()
        self.assertEqual(service.run_agent_jobs(self.db), 0)
        self.assertEqual(fake.calls, [])
        self.assertIsNone(self.one('SELECT 1 FROM gov_agent_job WHERE detector_name = ?', fake.name))
        conn = self.db.conn()
        with self.assertRaises(detectors.EgressBlocked):
            detectors.call(conn, fake, service.object_item(conn, self.one('SELECT * FROM object_head WHERE id = ?', oid)))
        self.assertEqual(fake.calls, [])
        status = {d['name']: d['status'] for d in detectors.describe(conn)}
        self.assertEqual(status[fake.name], 'blocked_by_flag')

        with self.db.write() as w:
            flags.set_flag(w, 'gov.model_egress', True, None)
        oid2 = self.post_obj(author, f'再发一次 {PHONE} 领优惠券')
        self.dispatch()
        self.assertEqual(service.run_agent_jobs(self.db), 1)
        self.assertEqual(len(fake.calls), 1)
        item = fake.calls[0]
        self.assertNotIn(PHONE, item.title + item.text)
        self.assertFalse(hasattr(item, 'author_id'))
        sig = self.one("SELECT * FROM gov_signal WHERE target_id = ? AND detector_kind = 'agent'", oid2)
        self.assertEqual((sig['model_name'], sig['model_version'], sig['rule_id']), ('fake-model', '0', 'agent.default'))
        self.assertTrue(sig['input_hash'])
        self.assertIsNone(self.one("SELECT 1 FROM gov_action WHERE target_id = ? AND action_type = 'hide'", oid2))
        g = self.gov('g1')
        detail = self.get(g, f'/api/governance/cases/{self.case_of(oid2)["id"]}')
        self.assertEqual(detail['suggestion']['label'], 'Agent 建议，需人确认')

        oid3 = self.post_obj(author, '第三条内容，开关会在任务执行前关掉')
        self.dispatch()
        with self.db.write() as w:
            flags.set_flag(w, 'gov.model_egress', False, None)
        self.assertEqual(service.run_agent_jobs(self.db), 0)
        self.assertEqual(len(fake.calls), 1)
        self.assertEqual(self.one('SELECT error FROM gov_agent_job WHERE target_id = ?', oid3)['error'], 'egress_off')

    def test_model_layer_goes_through_the_gateway(self):
        calls = []

        def run(conn, *, feature, task, inputs, actor_id=None, object_id=None):
            calls.append(dict(feature=feature, task=task, inputs=inputs, actor_id=actor_id, object_id=object_id))
            if 'fallback' in inputs.get('text', ''):
                return {'fallback': True, 'output': None}
            return {'fallback': False, 'model': 'm-test', 'output': {'findings': [
                {'category': 'spam', 'score': 0.9, 'confidence': 0.8, 'suggestion': 'ban', 'reason': '疑似引流'}]}}

        fake = types.SimpleNamespace(run=run)
        with mock.patch.object(model, 'gateway', return_value=fake):
            with self.db.write() as w:
                flags.set_flag(w, 'gov.model_egress', True, None)
            author = self.user('author', 2)
            oid = self.post_obj(author, f'私信 {PHONE} 有好货')
            self.post_obj(author, 'fallback 测试内容')
            self.dispatch()
            with self.assertRaises(RuntimeError), self.db.write():
                service.run_agent_jobs(self.db)
            self.assertEqual(service.run_agent_jobs(self.db), 2)
        self.assertEqual({c['feature'] for c in calls}, {'governance.screen_text'})
        self.assertTrue(all(c['actor_id'] is None for c in calls))
        self.assertTrue(all(PHONE not in c['inputs']['text'] for c in calls))
        sigs = self.db.conn().execute("SELECT * FROM gov_signal WHERE detector_kind = 'agent'").fetchall()
        self.assertEqual(len(sigs), 1)
        self.assertEqual((sigs[0]['target_id'], sigs[0]['model_name'], sigs[0]['suggested_action']),
                         (oid, 'm-test', 'ban'))
        self.assertIsNone(self.one("SELECT 1 FROM gov_action WHERE action_type = 'ban'"))

    def test_gateway_absent_means_no_jobs(self):
        with self.db.write() as w:
            flags.set_flag(w, 'gov.model_egress', True, None)
        self.post_obj(self.user('author', 2), '内容')
        self.dispatch()
        self.assertIsNone(self.one("SELECT 1 FROM gov_agent_job WHERE detector_name LIKE 'agent.gateway.%'"))
        status = {d['name']: d['status'] for d in detectors.describe(self.db.conn())}
        self.assertEqual(status['agent.gateway.text'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
