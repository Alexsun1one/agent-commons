import time

from app import audit, clock
from modules.admin import params
from tests.helpers import HDRS, AppCase

BASE = '/api/admin/admin'
READS = ['/overview', '/search?q=root', '/users', '/queue', '/params', '/params/farm/steal_daily_limit/history',
         '/params/farm/steal_daily_limit/preview?value=12', '/system']


class ConsoleTest(AppCase):
    def admin(self, handle='root', totp=True):
        return self.user(handle, roles=['admin'], totp=totp)

    def audits(self, action, outcome=None):
        sql = 'SELECT * FROM audit_event WHERE action = ?'
        args = [action]
        if outcome:
            sql += ' AND outcome = ?'
            args.append(outcome)
        return self.db.conn().execute(sql, args).fetchall()

    def set_param(self, client, value, reason='调参测试', **extra):
        return client.post(f'{BASE}/params/farm/steal_daily_limit', headers=HDRS,
                           json={'value': value, 'reason': reason, **extra})

    def test_non_admin_gets_403_everywhere(self):
        member = self.user('member', level=5)
        for path in READS:
            response = member.get(BASE + path)
            self.assertEqual((response.status_code, self.code(response)), (403, 'action_not_allowed'), path)
        writes = [(f'{BASE}/params/farm/steal_daily_limit', {'value': 12, 'reason': '越权尝试'}),
                  (f'{BASE}/params/farm/steal_daily_limit/rollback', {'to_version': 1, 'reason': '越权尝试'}),
                  (f'{BASE}/reasons', {'action': 'admin.roles', 'target_type': 'principal', 'target_id': 'x',
                                       'reason': '越权尝试'})]
        for path, body in writes:
            response = member.post(path, headers=HDRS, json=body)
            self.assertEqual((response.status_code, self.code(response)), (403, 'action_not_allowed'), path)
        self.assertEqual(len(self.audits('admin_param.set', 'denied')), 1)
        self.assertEqual(len(self.audits('admin_param.rollback', 'denied')), 1)

    def test_totp_gates_sensitive_reads_and_every_write(self):
        admin = self.admin('admin_no_totp', totp=False)
        self.assertEqual(admin.get(BASE + '/overview').status_code, 200)
        for path in READS[1:]:
            response = admin.get(BASE + path)
            self.assertEqual((response.status_code, self.code(response)), (403, 'totp_setup_required'), path)
        denied = self.set_param(admin, 12)
        self.assertEqual((denied.status_code, self.code(denied)), (403, 'totp_setup_required'))
        rows = self.audits('admin_param.set', 'denied')
        self.assertEqual((len(rows), rows[0]['reason_code']), (1, 'totp_setup_required'))
        with self.db.write() as conn:
            self.assertEqual(params.value(conn, 'farm', 'steal_daily_limit'), 20)

        governor = self.user('gov', roles=['governor'], totp=True)
        self.assertEqual(governor.get(BASE + '/params').status_code, 200)
        refused = self.set_param(governor, 12)
        self.assertEqual((refused.status_code, self.code(refused)), (403, 'action_not_allowed'))

    def test_param_range_versioning_rollback_and_audit(self):
        admin = self.admin()
        listed = admin.get(BASE + '/params', params={'namespace': 'farm'}).json()['data']
        row = next(item for item in listed if item['key'] == 'steal_daily_limit')
        self.assertEqual((row['value'], row['effective_value'], row['version'], row['min_value'], row['max_value']),
                         (20, 20, 1, 0, 50))
        self.assertTrue(row['module_loaded'])

        for bad in (51, -1):
            response = self.set_param(admin, bad)
            self.assertEqual((response.status_code, self.code(response)), (422, 'validation_failed'), bad)
        self.assertEqual(len(self.audits('admin_param.set', 'denied')), 2)
        missing_reason = admin.post(f'{BASE}/params/farm/steal_daily_limit', headers=HDRS, json={'value': 12})
        self.assertEqual(missing_reason.status_code, 422)

        changed = self.set_param(admin, 12, expected_version=1)
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json()['data']['version'], 2)
        stale = self.set_param(admin, 15, expected_version=1)
        self.assertEqual((stale.status_code, self.code(stale)), (409, 'state_conflict'))
        same = self.set_param(admin, 12)
        self.assertEqual(same.status_code, 422)
        with self.db.write() as conn:
            self.assertEqual(params.value(conn, 'farm', 'steal_daily_limit'), 12)

        history = admin.get(BASE + '/params/farm/steal_daily_limit/history').json()['data']
        self.assertEqual([(h['version'], h['value'], h['kind']) for h in history], [(2, 12, 'set'), (1, 20, 'seed')])
        self.assertEqual(history[0]['actor_handle'], 'root')

        back = admin.post(f'{BASE}/params/farm/steal_daily_limit/rollback', headers=HDRS,
                          json={'to_version': 1, 'reason': '回到初始值', 'expected_version': 2})
        self.assertEqual(back.status_code, 200, back.text)
        self.assertEqual((back.json()['data']['value'], back.json()['data']['version']), (20, 3))
        with self.db.write() as conn:
            self.assertEqual(params.value(conn, 'farm', 'steal_daily_limit'), 20)

        ok_set = self.audits('admin_param.set', 'ok')
        ok_back = self.audits('admin_param.rollback', 'ok')
        self.assertEqual((len(ok_set), len(ok_back)), (1, 1))
        self.assertIn('"reason": "回到初始值"', ok_back[0]['meta_json'])
        writes = self.db.conn().execute('SELECT count(*) FROM admin_param_version WHERE kind != ?',
                                        ('seed',)).fetchone()[0]
        self.assertEqual(writes, len(ok_set) + len(ok_back))
        with self.assertRaises(Exception):
            with self.db.write() as conn:
                conn.execute("UPDATE admin_param_version SET value = 1 WHERE namespace = 'farm'")

    def test_scheduled_change_and_preview(self):
        admin = self.admin()
        future = clock.iso(clock.now_ts() + 3600)
        scheduled = self.set_param(admin, 30, effective_at=future)
        self.assertEqual(scheduled.status_code, 200, scheduled.text)
        row = next(item for item in admin.get(BASE + '/params').json()['data'] if item['key'] == 'steal_daily_limit')
        self.assertEqual((row['value'], row['effective_value']), (30, 20))
        self.assertEqual([p['value'] for p in row['pending']], [30])
        past = self.set_param(admin, 25, effective_at=clock.iso(clock.now_ts() - 7200))
        self.assertEqual((past.status_code, self.code(past)), (422, 'validation_failed'))
        too_far = self.set_param(admin, 25, effective_at=clock.iso(clock.now_ts() + 40 * 86400))
        self.assertEqual(too_far.status_code, 422)

        preview = admin.get(BASE + '/params/farm/steal_daily_limit/preview', params={'value': 60}).json()['data']
        self.assertEqual((preview['current'], preview['proposed'], preview['within_range']), (20, 60, False))
        self.assertEqual(preview['direction'], 'loosen')
        self.assertIsInstance(preview['affected']['count'], int)
        self.assertTrue(preview['affected']['basis'])
        self.assertEqual(admin.get(BASE + '/params/farm/nope/preview', params={'value': 1}).status_code, 404)

        params.declare('farm', 'steal_daily_limit')
        try:
            row = next(item for item in admin.get(BASE + '/params').json()['data']
                       if item['key'] == 'steal_daily_limit')
            self.assertTrue(row['wired'])
        finally:
            params.DECLARED.discard(('farm', 'steal_daily_limit'))

    def test_overview_queue_and_search(self):
        admin = self.admin()
        author = self.user('author')
        reporter = self.user('reporter', level=2)
        post = self.obj(author, type='discussion', title='可以举报的帖子')
        report = reporter.post('/api/governance/reports', headers=HDRS,
                               json={'target_id': post['id'], 'reason_code': 'spam', 'note': ''})
        self.assertIn(report.status_code, (200, 201), report.text)

        data = admin.get(BASE + '/overview').json()['data']
        for key in ('active_today', 'new_members_today', 'posts_today', 'solved_today', 'reports_pending',
                    'anomalies_today', 'bamboo_net_today', 'agent_calls_today', 'crawler_today'):
            self.assertIn(key, data['cards'])
        self.assertGreaterEqual(data['cards']['posts_today']['value'], 1)
        self.assertEqual(data['cards']['reports_pending']['value'], 1)
        self.assertEqual(len(data['trends']['posts']), 14)
        self.assertTrue(any(todo['key'].startswith('gov_') for todo in data['todos']))

        q = admin.get(BASE + '/queue').json()['data']
        item = next(i for i in q['items'] if i['source'] == 'content_report')
        self.assertEqual((item['target']['id'], item['reports'], item['subject']['handle']), (post['id'], 1, 'author'))
        self.assertIn('/api/governance/cases/', item['writeback']['dismiss'])
        self.assertNotIn('可以举报的帖子', str(q))
        self.assertEqual({s['key'] for s in q['sources']} >= {'governance', 'content_report', 'market', 'campaign',
                                                             'economy'}, True)
        only = admin.get(BASE + '/queue', params={'source': 'content_report'}).json()['data']
        self.assertTrue(all(i['source'] == 'content_report' for i in only['items']))
        self.assertEqual(admin.get(BASE + '/queue', params={'source': 'nope'}).status_code, 422)

        hidden = self.obj(author, type='discussion', title='只给自己看', visibility='named', acl=[reporter.pid])
        found = admin.get(BASE + '/search', params={'q': hidden['id']}).json()['data']['groups']['content']
        self.assertEqual((found[0]['id'], found[0]['visible'], found[0]['title']), (hidden['id'], False, None))
        self.assertNotIn('只给自己看', str(found))
        users = admin.get(BASE + '/search', params={'q': 'repo'}).json()['data']['groups']['users']
        self.assertEqual([u['handle'] for u in users], ['reporter'])
        with self.db.write() as conn:
            audit.record(conn, admin.pid, 'admin.test.lookup', 'widget', 'w1', request_id='req-lookup-1')
        events = admin.get(BASE + '/search', params={'q': 'req-lookup-1'}).json()['data']['groups']['events']
        self.assertEqual(events[0]['action'], 'admin.test.lookup')

    def test_market_reports_join_queue_and_billing_orders_are_searchable(self):
        owner, reporter, admin = self.user('seller1'), self.user('reporter1'), self.admin()
        r = owner.post('/api/market/listings', headers={**HDRS, 'Idempotency-Key': 'adm2-listing-1'},
                       json={'category': 'sell', 'title': '出售一张旧显卡', 'body': '自用，箱说全，可以先看再定。',
                             'price': '¥300', 'city': '杭州', 'shipping': '可邮寄', 'condition': '九成新'})
        self.assertEqual(r.status_code, 201, r.text)
        listing = r.json()['data']['id']
        r = reporter.post(f'/api/market/listings/{listing}/report', headers={**HDRS, 'Idempotency-Key': 'adm2-rep-1'},
                          json={'reason_code': 'scam', 'note': '要求先转账'})
        self.assertEqual(r.status_code, 201, r.text)
        report_id = r.json()['data']['id']
        q = admin.get(f'{BASE}/queue?source=market').json()['data']
        item = next(i for i in q['items'] if i['id'] == 'mkt:' + report_id)
        self.assertEqual(item['writeback']['dismiss'], f'/api/admin/market/reports/{report_id}/close')
        self.assertIsNone(item['writeback']['act'])
        self.assertEqual((item['subject']['handle'], item['risk']), ('seller1', 'high'))
        self.assertNotIn('旧显卡', str(item))
        self.assertNotIn('先转账', str(item))
        with self.db.write() as conn:
            plan = conn.execute('SELECT key FROM billing_plan LIMIT 1').fetchone()
            now = clock.now()
            conn.execute("INSERT INTO billing_order (id, principal_id, plan_key, cycle, seats, amount_fen, provider, state,"
                         " created_at, updated_at) VALUES ('ord-adm2-0001', ?, ?, 'month', 1, 2900, 'manual', 'created', ?, ?)",
                         (owner.pid, plan['key'], now, now))
        found = admin.get(f'{BASE}/search?q=ord-adm2').json()['data']
        self.assertEqual([o['kind'] for o in found['groups']['orders']], ['billing'])
        self.assertNotIn('billing', found['offline'])

    def test_users_list_detail_and_view_audit(self):
        admin = self.admin()
        for i in range(3):
            self.user(f'mem{i}', level=2)
        first = admin.get(BASE + '/users', params={'limit': 2})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(len(first.json()['data']), 2)
        cursor = first.json()['meta']['next_cursor']
        rest = admin.get(BASE + '/users', params={'limit': 2, 'cursor': cursor}).json()['data']
        self.assertEqual(len(rest), 2)
        filtered = admin.get(BASE + '/users', params={'role': 'admin'}).json()['data']
        self.assertEqual([u['handle'] for u in filtered], ['root'])

        detail = admin.get(BASE + '/users/mem1')
        self.assertEqual(detail.status_code, 200, detail.text)
        data = detail.json()['data']
        self.assertEqual((data['handle'], data['level'], data['status']), ('mem1', 2, 'active'))
        for key in ('contribution', 'points', 'bamboo', 'inviter', 'invitees', 'recent', 'sanctions'):
            self.assertIn(key, data)
        views = self.audits('admin_console.user.view')
        self.assertEqual((len(views), views[0]['target_id']), (1, data['id']))
        self.assertEqual(admin.get(BASE + '/users/nobody').status_code, 404)

    def test_system_masks_secrets_and_reason_notes_are_audited(self):
        admin = self.admin()
        response = admin.get(BASE + '/system')
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()['data']
        secret = next(item for item in data['config'] if item['key'] == 'secret_key')
        self.assertEqual((secret['is_secret'], secret['set'], secret['value']), (True, True, None))
        self.assertNotIn(self.settings.secret_key.hex(), response.text)
        self.assertNotIn(self.settings.db_path, response.text)
        flag = next(item for item in data['flags'] if item['key'] == 'gov.reports')
        self.assertIn('gov.report.create', flag['gates'])
        self.assertEqual(data['health']['status'], 'ok')
        self.assertIn('admin', data['health']['modules'])
        self.assertIsInstance(data['jobs'], list)

        note = admin.post(f'{BASE}/reasons', headers=HDRS, json={
            'action': 'admin.roles', 'target_type': 'principal', 'target_id': admin.pid, 'reason': '季度轮值'})
        self.assertEqual(note.status_code, 201, note.text)
        rows = self.audits('admin_console.reason')
        self.assertEqual((len(rows), rows[0]['id']), (1, note.json()['data']['audit_id']))
        self.assertIn('季度轮值', rows[0]['meta_json'])


if __name__ == '__main__':
    import unittest
    unittest.main()
