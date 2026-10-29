import time

from app import accounts, audit, clock
from tests.helpers import HDRS, PASSWORD, AppCase


class AdminConsoleTest(AppCase):
    def register(self, client, handle, code=None, password=PASSWORD):
        # The shared AppCase fixture is frozen; explicitly satisfy R2 consent here.
        return client.post('/api/auth/register', headers=HDRS, json={
            'invite_code': code or self.invite(), 'handle': handle, 'password': password,
            'display_name': handle, 'adult_confirmed': True})

    def admin(self, handle='root', totp=True):
        return self.user(handle, roles=['admin'], totp=totp)

    def test_permissions_and_sensitive_reads_require_totp(self):
        member = self.user('member')
        denied = member.get('/api/admin-console/metrics')
        self.assertEqual((denied.status_code, self.code(denied)), (403, 'action_not_allowed'))

        governor = self.user('governor', roles=['governor'])
        self.assertEqual(governor.get('/api/admin-console/metrics').status_code, 200)

        admin = self.admin('admin_no_totp', totp=False)
        self.assertEqual(admin.get('/api/admin-console/metrics').status_code, 200)
        self.assertEqual(admin.get('/api/admin/console/metrics').status_code, 404)
        sensitive = admin.get('/api/admin-console/invite-tree')
        self.assertEqual((sensitive.status_code, self.code(sensitive)), (403, 'totp_setup_required'))

    def test_empty_and_populated_metrics(self):
        admin = self.admin()
        empty = admin.get('/api/admin-console/metrics')
        self.assertEqual(empty.status_code, 200, empty.text)
        self.assertIsNone(empty.json()['data']['cards']['median_first_answer_hours']['value'])

        author = self.user('author')
        root = self.obj(author, type='discussion')
        reply = self.obj(author, type='reply', root_id=root['id'], title='回答', content={'body': '回答'})
        with self.db.write() as conn:
            now = clock.now_ts()
            conn.execute('UPDATE object_head SET created_at = ? WHERE id = ?', (clock.iso(now - 7200), root['id']))
            conn.execute('UPDATE object_head SET created_at = ? WHERE id = ?', (clock.iso(now), reply['id']))
            audit.record(conn, author.pid, 'kb.duplicate_blocked', 'problem', 'duplicate-1', outcome='denied')
        data = admin.get('/api/admin-console/metrics').json()['data']
        self.assertGreaterEqual(data['cards']['weekly_active_members']['value'], 2)
        self.assertGreaterEqual(data['cards']['new_members_week']['value'], 2)
        self.assertAlmostEqual(data['cards']['median_first_answer_hours']['value'], 2.0, places=1)
        self.assertEqual(data['cards']['kb_duplicate_blocked_week']['value'], 1)

    def test_missing_optional_table_returns_null(self):
        admin = self.admin()
        with self.db.write() as conn:
            conn.execute('DROP TABLE public_crawler_hit')
        data = admin.get('/api/admin-console/metrics').json()['data']
        metric = data['cards']['crawler_hits_week']
        self.assertIsNone(metric['value'])
        self.assertEqual(metric['status'], '模块未上线')

    def test_invite_tree_depth_quota_and_suspicious_patterns(self):
        admin = self.admin()
        with self.db.write() as conn:
            codes = [accounts.issue_invite(conn, admin.pid, 1, 7)[1] for _ in range(6)]
        children = []
        for i in range(6):
            child = self.client()
            response = self.register(child, f'child{i}', codes[i])
            self.assertEqual(response.status_code, 201, response.text)
            children.append((child, response.json()['data']['id']))
        with self.db.write() as conn:
            grand_code = accounts.issue_invite(conn, children[0][1], 1, 7)[1]
        grand = self.client()
        self.assertEqual(self.register(grand, 'grandchild', grand_code).status_code, 201)

        replay = self.register(self.client(), 'reusedchild', codes[0])
        self.assertEqual((replay.status_code, self.code(replay)), (422, 'invite_invalid'))
        response = admin.get('/api/admin-console/invite-tree')
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()['data']
        by_handle = {node['handle']: node for node in data['nodes']}
        self.assertEqual(by_handle['grandchild']['depth'], by_handle['child0']['depth'] + 1)
        self.assertEqual((by_handle['root']['used'], by_handle['root']['remaining']), (6, 0))
        kinds = {flag['kind'] for flag in data['suspicious'] if flag['inviter_id'] == admin.pid}
        self.assertEqual(kinds, {'registration_burst', 'many_zero_activity'})

    def test_audit_filters_and_cursor(self):
        admin = self.admin()
        with self.db.write() as conn:
            for i in range(3):
                audit.record(conn, admin.pid, f'admin.test.{i}', 'widget', f'w{i}', request_id=f'r{i}')
        first = admin.get('/api/admin-console/audit', params={'action': 'admin.test', 'limit': 2})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(len(first.json()['data']), 2)
        cursor = first.json()['meta']['next_cursor']
        self.assertTrue(cursor)
        second = admin.get('/api/admin-console/audit', params={
            'action': 'admin.test', 'limit': 2, 'cursor': cursor,
        })
        self.assertEqual(len(second.json()['data']), 1)
        target = admin.get('/api/admin-console/audit', params={'target': 'w1'}).json()['data']
        self.assertEqual([row['target_id'] for row in target], ['w1'])

    def test_invites_and_flags_do_not_expose_code_hashes(self):
        admin = self.admin()
        issued = admin.post('/api/admin/invites', headers=HDRS, json={'max_uses': 1, 'note': '内测'}).json()['data']
        invites = admin.get('/api/admin-console/invites').json()['data']
        row = next(item for item in invites if item['id'] == issued['id'])
        self.assertNotIn('code_hash', row)
        self.assertEqual((row['max_uses'], row['used_count'], row['remaining']), (1, 0, 1))
        self.assertNotIn(issued['code'], str(invites))
        flags = admin.get('/api/admin-console/flags').json()['data']
        self.assertTrue(any(item['key'] == 'core.objects' for item in flags))


if __name__ == '__main__':
    import unittest
    unittest.main()
