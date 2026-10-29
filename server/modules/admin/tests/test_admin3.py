import json

from app import audit, clock
from modules.admin import params
from tests.helpers import HDRS, AppCase


READ_ENDPOINTS = {
    '/api/admin/farm/stats': 'farm.admin.stats.view',
    '/api/admin/parking/stats': 'parking.admin.stats.view',
    '/api/admin/games/questions': 'games.admin.questions.view',
    '/api/admin/market/listings': 'market.admin.listings.view',
    '/api/admin/market/rules': 'market.admin.rules.view',
    '/api/admin/bounty/credits': 'bounty.admin.credits.view',
    '/api/admin/agents/profiles': 'agents.admin.profiles.view',
    '/api/admin/agents/tokens': 'agents.admin.tokens.view',
    '/api/admin/public/crawlers': 'public.admin.crawlers.view',
    '/api/admin/billing/orders': 'billing.admin.orders.view',
    '/api/admin/economy/summary': 'economy.admin.summary.view',
}


class Admin3Test(AppCase):
    def admin(self, handle='root'):
        return self.user(handle, roles=['admin'], totp=True)

    def set_param(self, actor_id, namespace, key, value):
        with self.db.write() as conn:
            row = conn.execute(
                'SELECT version FROM admin_param WHERE namespace = ? AND key = ?', (namespace, key)
            ).fetchone()
            return params.set_value(
                conn, actor_id, namespace, key, value, 'ADMIN-3 行为测试', row['version']
            )

    def test_read_endpoints_require_operator_return_and_audit(self):
        member = self.user('member')
        admin = self.admin()
        for path, action in READ_ENDPOINTS.items():
            denied = member.get(path)
            self.assertEqual((denied.status_code, self.code(denied)), (403, 'action_not_allowed'), path)
            response = admin.get(path, params={'limit': 1} if path not in (
                '/api/admin/market/rules', '/api/admin/economy/summary') else None)
            self.assertEqual(response.status_code, 200, f'{path}: {response.text}')
            event = self.db.conn().execute(
                'SELECT actor_id FROM audit_event WHERE action = ? ORDER BY occurred_at DESC LIMIT 1', (action,)
            ).fetchone()
            self.assertIsNotNone(event, action)
            self.assertEqual(event['actor_id'], admin.pid)

    def test_agent_tokens_only_expose_first_and_last_four(self):
        owner = self.user('owner', level=3)
        created = owner.post('/api/agents', headers=HDRS, json={'name': '巡检助手'})
        self.assertEqual(created.status_code, 201, created.text)
        agent_id = created.json()['data']['id']
        issued = owner.post(f'/api/agents/{agent_id}/tokens', headers=HDRS, json={'preset': 'read'})
        self.assertEqual(issued.status_code, 201, issued.text)
        plaintext = issued.json()['data']['token']

        response = self.admin().get('/api/admin/agents/tokens')
        self.assertEqual(response.status_code, 200, response.text)
        text = response.text
        token = response.json()['data'][0]
        self.assertEqual(token['masked_token'], plaintext[:4] + '…' + plaintext[-4:])
        self.assertNotIn(plaintext, text)
        self.assertNotIn('token_hash', text)
        self.assertNotIn('hint', token)

    def test_sanctions_anomaly_resolutions_and_market_writeback(self):
        member = self.user('target')
        reporter = self.user('reporter')
        admin = self.admin()

        denied = reporter.post('/api/admin/governance/sanctions', headers=HDRS, json={
            'action': 'ban', 'principal_id': member.pid, 'reason': '越权尝试', 'duration_hours': 2,
        })
        self.assertEqual((denied.status_code, self.code(denied)), (403, 'action_not_allowed'))
        muted = admin.post('/api/admin/governance/sanctions', headers=HDRS, json={
            'action': 'mute', 'principal_id': member.pid, 'reason': '短时限制发言', 'duration_hours': 2,
        })
        self.assertEqual(muted.status_code, 200, muted.text)
        self.assertEqual(muted.json()['data']['action'], 'mute')
        banned = admin.post('/api/admin/governance/sanctions', headers=HDRS, json={
            'action': 'ban', 'principal_id': member.pid, 'reason': '自动化处置测试', 'duration_hours': 2,
        })
        self.assertEqual(banned.status_code, 200, banned.text)
        self.assertEqual(self.db.conn().execute(
            'SELECT status FROM principal WHERE id = ?', (member.pid,)
        ).fetchone()['status'], 'suspended')
        unbanned = admin.post('/api/admin/governance/sanctions', headers=HDRS, json={
            'action': 'unban', 'principal_id': member.pid, 'reason': '复核后解除', 'duration_hours': 1,
        })
        self.assertEqual(unbanned.status_code, 200, unbanned.text)

        with self.db.write() as conn:
            conn.execute(
                'INSERT INTO economy_anomaly_marker '
                '(id, kind, principal_id, peer_id, day, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                ('anom-admin3', 'daily_net_inflow', member.pid, '', clock.now()[:10], 500, clock.now()),
            )
            vote_audit = audit.record(
                conn, member.pid, 'events.vote_anomaly', 'event', 'event-admin3', meta={'reason': 'burst'}
            )
        denied_econ = reporter.post('/api/admin/economy/anomalies/anom-admin3/resolve', headers=HDRS,
                                    json={'reason': '越权尝试', 'outcome': 'resolved'})
        self.assertEqual((denied_econ.status_code, self.code(denied_econ)), (403, 'action_not_allowed'))
        denied_vote = reporter.post(f'/api/admin/events/vote-anomalies/{vote_audit}/resolve', headers=HDRS,
                                    json={'reason': '越权尝试', 'outcome': 'dismissed'})
        self.assertEqual((denied_vote.status_code, self.code(denied_vote)), (403, 'action_not_allowed'))
        econ = admin.post('/api/admin/economy/anomalies/anom-admin3/resolve', headers=HDRS,
                          json={'reason': '人工复核流水', 'outcome': 'resolved'})
        self.assertEqual(econ.status_code, 200, econ.text)
        vote = admin.post(f'/api/admin/events/vote-anomalies/{vote_audit}/resolve', headers=HDRS,
                          json={'reason': '人工复核投票', 'outcome': 'dismissed'})
        self.assertEqual(vote.status_code, 200, vote.text)

        seller = self.user('seller')
        listing = seller.post('/api/market/listings', headers={**HDRS, 'Idempotency-Key': 'admin3-listing'}, json={
            'category': 'sell', 'title': '闲置键盘', 'body': '自用闲置，成色良好。',
            'price': '¥100', 'city': '杭州', 'shipping': '可邮寄', 'condition': '八成新',
        })
        self.assertEqual(listing.status_code, 201, listing.text)
        object_id = listing.json()['data']['id']
        reported = reporter.post(
            f'/api/market/listings/{object_id}/report',
            headers={**HDRS, 'Idempotency-Key': 'admin3-report'},
            json={'reason_code': 'spam', 'note': '重复发布'},
        )
        self.assertEqual(reported.status_code, 201, reported.text)
        report_id = reported.json()['data']['id']
        denied_close = reporter.post(
            f'/api/admin/market/reports/{report_id}/close', headers=HDRS,
            json={'reason': '越权尝试', 'disposition': 'hide'},
        )
        self.assertEqual((denied_close.status_code, self.code(denied_close)), (403, 'action_not_allowed'))
        closed = admin.post(
            f'/api/admin/market/reports/{report_id}/close', headers=HDRS,
            json={'reason': '确认需要隐藏并复核', 'disposition': 'hide'},
        )
        self.assertEqual(closed.status_code, 200, closed.text)
        self.assertEqual(self.db.conn().execute(
            'SELECT lifecycle FROM object_head WHERE id = ?', (object_id,)
        ).fetchone()['lifecycle'], 'hidden')

        actions = {row['action'] for row in self.db.conn().execute(
            "SELECT action FROM audit_event WHERE action IN "
            "('governance.admin.sanction', 'economy.anomaly.resolve', "
            "'events.vote_anomaly.resolve', 'market.report.close')"
        ).fetchall()}
        self.assertEqual(actions, {
            'governance.admin.sanction', 'economy.anomaly.resolve',
            'events.vote_anomaly.resolve', 'market.report.close',
        })
        market_audit = self.db.conn().execute(
            "SELECT reason_code, meta_json FROM audit_event WHERE action = 'market.report.close'"
        ).fetchone()
        self.assertEqual(market_audit['reason_code'], '确认需要隐藏并复核')
        self.assertEqual(json.loads(market_audit['meta_json'])['disposition'], 'hide')

    def test_three_parameters_change_module_behaviour(self):
        admin = self.admin()
        member = self.user('player')

        self.set_param(admin.pid, 'economy', 'checkin_day_1', 17)
        checked = member.post('/api/economy/checkin', headers=HDRS, json={})
        self.assertEqual(checked.status_code, 200, checked.text)
        self.assertEqual(checked.json()['data']['last_reward'], 17)

        self.set_param(admin.pid, 'games', 'exam_questions', 5)
        exam = member.post('/api/games/exams', headers=HDRS, json={})
        self.assertEqual(exam.status_code, 201, exam.text)
        self.assertEqual(len(exam.json()['data']['questions']), 5)

        self.set_param(admin.pid, 'market', 'l1_daily_listings', 0)
        blocked = member.post('/api/market/listings', headers={**HDRS, 'Idempotency-Key': 'admin3-param'}, json={
            'category': 'sell', 'title': '不应发布', 'body': '参数设为零后一级成员不能发布。',
            'price': '¥1', 'city': '杭州', 'shipping': '自提', 'condition': '测试',
        })
        self.assertEqual((blocked.status_code, self.code(blocked)), (429, 'market_daily_limit'))

