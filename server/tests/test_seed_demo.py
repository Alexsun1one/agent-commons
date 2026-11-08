import contextlib
import io
import json
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import accounts, clock, discovery, migrate, security
from app.__main__ import main
from app.db import Database
from app.errors import ApiError
from tests.helpers import HDRS, ORIGIN, make_settings


class SeedDemoTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='commons-seed-test-')
        self.addCleanup(self.tmp.cleanup)
        self.settings = make_settings(self.tmp.name)
        self.db = Database(self.settings.db_path)
        self.addCleanup(self.db.close)
        migrate.migrate(self.db, discovery.discover(self.settings.module_package), self.settings.backup_dir)

    def seed(self):
        from app.seed_demo import seed_demo
        return seed_demo(self.db, self.settings)

    def count(self, table):
        return self.db.conn().execute(f'SELECT count(*) FROM {table}').fetchone()[0]

    def test_cli_seed_counts_and_fictional_content(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(main(['seed-demo'], settings=self.settings), 0)
        self.assertIn('demo_admin', output.getvalue())
        self.assertIn('一次性重置码', output.getvalue())
        expected = {'credential': 12, 'agent_profile': 8, 'org': 3, 'org_member': 36,
                    'community_event': 4, 'market_listing': 3, 'announce_item': 2,
                    'social_follow': 24, 'achievement_credit': 8, 'growth_state': 12}
        for table, number in expected.items():
            with self.subTest(table=table):
                self.assertEqual(self.count(table), number)
        conn = self.db.conn()
        self.assertEqual(conn.execute("SELECT count(*) FROM object_head WHERE type = 'work' "
                                      "AND lifecycle = 'active'").fetchone()[0], 8)
        self.assertEqual(conn.execute("SELECT count(*) FROM org WHERE status = 'approved'").fetchone()[0], 3)
        self.assertEqual(conn.execute("SELECT count(*) FROM role_assignment WHERE role = 'admin' "
                                      'AND revoked_at IS NULL').fetchone()[0], 1)
        self.assertTrue(all(row[0].startswith('demo_') for row in conn.execute('SELECT handle FROM credential')))
        self.assertTrue(all(row[0].startswith('虚构成员·') for row in conn.execute(
            'SELECT p.display_name FROM profile p JOIN credential c ON c.principal_id = p.principal_id')))
        for table, column in (('agent_profile', 'intro'), ('org', 'intro'),
                              ('community_event', 'summary'), ('announce_item', 'body')):
            self.assertTrue(all('虚构' in row[0] for row in conn.execute(f'SELECT {column} FROM {table}')))
        for row in conn.execute('SELECT content_json FROM object_version'):
            self.assertIn('虚构', json.loads(row[0])['body'])
        self.assertEqual(conn.execute('SELECT count(*) FROM community_event WHERE starts_at > ?',
                                      (clock.now(),)).fetchone()[0], 3)
        self.assertEqual(conn.execute('SELECT count(*) FROM member_achievement WHERE unlocked_at IS NOT NULL')
                         .fetchone()[0], 8)
        self.assertEqual(conn.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_repeat_refuses_without_mutation(self):
        self.seed()
        before = list(self.db.conn().iterdump())
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as failure:
            main(['seed-demo'], settings=self.settings)
        self.assertNotEqual(failure.exception.code, 0)
        self.assertEqual(list(self.db.conn().iterdump()), before)

    def test_existing_user_refuses_without_mutation(self):
        with self.db.write() as conn:
            accounts.create_principal(conn, handle='existing_member', password_hash='unusable', display_name='已有成员')
        before = list(self.db.conn().iterdump())
        with self.assertRaises(ApiError):
            self.seed()
        self.assertEqual(list(self.db.conn().iterdump()), before)

    def test_failure_rolls_back_all_seed_writes(self):
        before = list(self.db.conn().iterdump())
        with patch('app.seed_demo.announce.create_item', side_effect=RuntimeError('injected failure')):
            with self.assertRaisesRegex(RuntimeError, 'injected failure'):
                self.seed()
        self.assertEqual(list(self.db.conn().iterdump()), before)
        self.seed()
        self.assertEqual(self.count('credential'), 12)

    def test_no_network_model_or_worker_dispatch(self):
        with patch('socket.socket.connect', side_effect=AssertionError('network forbidden')), \
                patch('modules.ai.gateway.run', side_effect=AssertionError('model forbidden')), \
                patch('app.outbox.dispatch', side_effect=AssertionError('worker forbidden')):
            self.seed()
        self.assertGreater(self.count('outbox_event'), 0)
        self.assertEqual(self.count('agent_token'), 0)
        self.assertEqual(self.count('agent_call_log'), 0)

    def test_reset_code_single_use_and_not_persisted_as_plaintext(self):
        result = self.seed()
        self.assertNotIn(result['reset_code'], '\n'.join(self.db.conn().iterdump()))
        password = security.new_token()
        with self.db.write() as conn:
            pid = accounts.reset_password(conn, self.settings, handle=result['handle'],
                                          code=result['reset_code'], new_password=password)
        cred = accounts.credential_for(self.db.conn(), result['handle'])
        self.assertEqual(pid, cred['principal_id'])
        self.assertTrue(security.verify_password(password, cred['password_hash']))
        with self.assertRaises(ApiError), self.db.write() as conn:
            accounts.reset_password(conn, self.settings, handle=result['handle'],
                                    code=result['reset_code'], new_password=security.new_token())

    def test_no_force_option(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as failure:
            main(['seed-demo', '--force'], settings=self.settings)
        self.assertNotEqual(failure.exception.code, 0)
        self.assertEqual(self.count('principal'), 0)

    def test_unmigrated_database_has_actionable_error(self):
        settings = replace(self.settings, db_path=self.tmp.name + '/unmigrated.db')
        error = io.StringIO()
        with contextlib.redirect_stderr(error), self.assertRaises(SystemExit) as failure:
            main(['seed-demo'], settings=settings)
        self.assertNotEqual(failure.exception.code, 0)
        self.assertIn('python3 -m app migrate', error.getvalue())

    def test_reset_login_real_reads_and_admin_totp_gate(self):
        from app.main import create_app
        result = self.seed()
        app = create_app(replace(self.settings, auto_migrate=False))
        self.addCleanup(app.state.db.close)
        with TestClient(app, base_url=ORIGIN) as client:
            self.assertEqual(client.get('/api/objects?type=work').json()['data'], [])
            password = security.new_token()
            reset = client.post('/api/auth/reset', headers=HDRS, json={
                'handle': result['handle'], 'reset_code': result['reset_code'], 'new_password': password,
            })
            self.assertEqual(reset.status_code, 200)
            login = client.post('/api/auth/login', headers=HDRS, json={
                'handle': result['handle'], 'password': password,
            })
            self.assertEqual(login.status_code, 200)
            for path, number in (('/api/objects?type=work', 8), ('/api/events', 4), ('/api/orgs', 3)):
                response = client.get(path)
                self.assertEqual(response.status_code, 200, path)
                self.assertEqual(len(response.json()['data']), number, path)
            response = client.get('/api/search/members?q=虚构&kinds=agent&limit=10')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()['data']['items']), 8)
            profiles = client.get('/api/social/profiles?limit=20')
            self.assertEqual(profiles.status_code, 200)
            self.assertEqual(len(profiles.json()['data']['items']), 12)
            self.assertEqual(client.get('/api/agents/catalog').status_code, 200)
            feed = client.get('/api/feed/events')
            self.assertEqual(feed.status_code, 200)
            self.assertEqual(feed.json()['data']['events'], [])
            me = client.get('/api/me').json()['data']
            self.assertIn('admin', me['roles'])
            self.assertFalse(me['totp_enabled'])
            denied = client.post('/api/events', headers=HDRS, json={})
            self.assertEqual(denied.json()['error']['code'], 'totp_setup_required')

    def test_semantic_seed_is_deterministic_but_credentials_are_not(self):
        def snapshot(conn):
            queries = (
                'SELECT c.handle, p.display_name, p.level FROM credential c JOIN profile p '
                'ON p.principal_id = c.principal_id ORDER BY c.handle',
                'SELECT a.name, a.intro, a.palette, c.handle FROM agent_profile a JOIN credential c '
                'ON c.principal_id = a.owner_id ORDER BY a.name',
                'SELECT a.handle, b.handle FROM social_follow f '
                'JOIN credential a ON a.principal_id = f.follower_id '
                'JOIN credential b ON b.principal_id = f.followee_id ORDER BY a.handle, b.handle',
                'SELECT title, starts_at, ends_at FROM community_event ORDER BY slug',
                'SELECT v.title, v.content_json, c.handle FROM object_version v '
                'JOIN object_head h ON h.id = v.object_id JOIN credential c ON c.principal_id = h.author_id '
                'ORDER BY v.title',
            )
            return [[tuple(row) for row in conn.execute(sql)] for sql in queries]

        from app.seed_demo import seed_demo
        with patch('app.clock.now_ts', return_value=clock.parse('2030-01-02T12:00:00.000000Z')):
            first = self.seed()
            with tempfile.TemporaryDirectory(prefix='commons-seed-second-') as directory:
                settings = make_settings(directory)
                db = Database(settings.db_path)
                try:
                    migrate.migrate(db, discovery.discover(settings.module_package), settings.backup_dir)
                    second = seed_demo(db, settings)
                    self.assertEqual(snapshot(self.db.conn()), snapshot(db.conn()))
                    self.assertNotEqual(first['reset_code'], second['reset_code'])
                finally:
                    db.close()


if __name__ == '__main__':
    unittest.main()
