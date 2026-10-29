import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import accounts, audit, clock, discovery, ledger, migrate, outbox, storage
from app.db import Database
from app.errors import ApiError
from app.main import check_module_routes, create_app
from app.tools import replay_withdrawals
from tests.helpers import HDRS, AppCase, make_settings

SERVER = Path(__file__).resolve().parent.parent


class MigrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='commons-mig-')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_empty_to_latest_then_module_with_backup(self):
        db = Database(os.path.join(self.tmp, 'a.db'))
        done, snapshot = migrate.migrate(db, (), os.path.join(self.tmp, 'bk'))
        self.assertEqual((done, snapshot), (['core/0001_core.sql'], None))
        conn = db.conn()
        tables = conn.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL%' "
                              "AND name NOT LIKE 'search_fts_%'").fetchall()
        self.assertTrue(all('STRICT' in sql for _, sql in tables), [n for n, s in tables if 'STRICT' not in s])
        self.assertEqual(conn.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
        self.assertEqual(migrate.migrate(db, (), os.path.join(self.tmp, 'bk')), ([], None))
        modules = discovery.discover('tests.fixture_modules')
        done, snapshot = migrate.migrate(db, modules, os.path.join(self.tmp, 'bk'))
        self.assertEqual(done, ['demo/demo_0001.sql'])
        self.assertTrue(snapshot.exists())
        old = sqlite3.connect(snapshot)
        names = {r[0] for r in old.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertIn('object_head', names)
        self.assertNotIn('demo_note', names)
        old.close()
        db.close()

    def test_edited_migration_rejected(self):
        db = Database(os.path.join(self.tmp, 'b.db'))
        migrate.migrate(db)
        db.conn().execute("UPDATE schema_migration SET checksum = 'x'")
        with self.assertRaises(migrate.MigrationError):
            migrate.migrate(db)
        db.close()

    def test_foreign_database_refused(self):
        path = os.path.join(self.tmp, 'foreign.db')
        raw = sqlite3.connect(path)
        raw.execute('CREATE TABLE messages (id INTEGER)')
        raw.commit()
        raw.close()
        db = Database(path)
        with self.assertRaises(migrate.MigrationError):
            migrate.migrate(db)
        db.close()

    def test_transaction_statements_rejected(self):
        self.assertTrue(migrate.TXN.search('CREATE TABLE x (a);\nCOMMIT;'))
        self.assertFalse(migrate.TXN.search("CREATE TRIGGER t BEFORE UPDATE ON x\nBEGIN SELECT 1; END;"))


class ModuleTest(AppCase):
    overrides = {'module_package': 'tests.fixture_modules'}

    def test_outbox_dispatch_is_bound_to_the_app_modules(self):
        real_tmp = tempfile.mkdtemp(prefix='commons-real-modules-')
        real_app = None
        try:
            real_app = create_app(make_settings(real_tmp, db_path=os.path.join(real_tmp, 'real.db')))
            self.user('unused')
            l2 = self.user('isolated', level=2)
            item = self.obj(l2)
            self.assertEqual(outbox.dispatch(self.db), 3)
            note = self.db.conn().execute('SELECT body FROM demo_note WHERE id = ?', (item['id'],)).fetchone()
            self.assertEqual(note[0], 'object.created')
        finally:
            if real_app is not None:
                real_app.state.db.close()
            shutil.rmtree(real_tmp, ignore_errors=True)

    def test_module_router_rules_flags_and_outbox(self):
        self.assertEqual(self.client().get('/api/health').json()['data']['modules'], ['demo'])
        self.assertTrue(self.client().get('/api/flags').json()['data']['demo.enabled'])
        l1, l2 = self.user('low', level=1), self.user('high', level=2)
        self.assertEqual(self.code(l1.get('/api/demo/ping')), 'action_not_allowed')
        self.assertEqual(l2.get('/api/demo/ping').json()['data'], {'pong': True})
        item = self.obj(l2)
        self.assertEqual(outbox.dispatch(self.db), 3)
        self.assertEqual(self.db.conn().execute('SELECT body FROM demo_note WHERE id = ?', (item['id'],)).fetchone()[0],
                         'object.created')
        self.assertEqual(outbox.dispatch(self.db), 0)

    def test_route_prefix_enforced(self):
        from fastapi import APIRouter
        bad = APIRouter()
        bad.add_api_route('/api/objects/steal', lambda: None)
        with self.assertRaises(ValueError):
            check_module_routes(discovery.Module('demo', SERVER, router=bad))
        good = APIRouter(prefix='/api/demo')
        bad_admin = APIRouter(prefix='/api/admin/wrong')
        bad_admin.add_api_route('/ping', lambda: None)
        with self.assertRaises(ValueError):
            check_module_routes(discovery.Module('demo', SERVER, router=good, admin_router=bad_admin))


class LedgerAuditOutboxTest(AppCase):
    def test_ledger_append_only_and_reversal(self):
        u = self.user('earner')
        with self.db.write() as conn:
            first = ledger.record(conn, event_type='answer.useful', subject_id=u.pid, points=5, rule_version='r1',
                                  idempotency_key='useful:1', season='2026S1')
            again = ledger.record(conn, event_type='answer.useful', subject_id=u.pid, points=5, rule_version='r1',
                                  idempotency_key='useful:1', season='2026S1')
            self.assertEqual(first, again)
            ledger.record(conn, event_type='knowledge.adopted', subject_id=u.pid, points=20, rule_version='r1',
                          idempotency_key='adopt:1', season='2026S1')
            self.assertEqual(ledger.balance(conn, u.pid), 25)
            with self.assertRaises(ApiError):
                ledger.record(conn, event_type='answer.useful', subject_id=u.pid, points=50, rule_version='r1',
                              idempotency_key='useful:1')
            rev = ledger.reverse(conn, first, reason='fraud', actor_id=None, idempotency_key='rev:1')
            self.assertEqual(ledger.reverse(conn, first, reason='fraud', actor_id=None, idempotency_key='rev:1'), rev)
            self.assertEqual(ledger.balance(conn, u.pid, '2026S1'), 20)
            with self.assertRaises(ApiError):
                ledger.reverse(conn, rev, reason='x', actor_id=None, idempotency_key='rev:2')
        for sql in ('UPDATE ledger_entry SET points = 999', 'DELETE FROM ledger_entry',
                    'UPDATE audit_event SET action = 1', 'DELETE FROM audit_event'):
            with self.assertRaises(sqlite3.DatabaseError):
                with self.db.write() as conn:
                    conn.execute(sql)

    def test_outbox_retry_and_receipts(self):
        calls = []

        def flaky(conn, event):
            calls.append(event['id'])
            if len(calls) == 1:
                raise RuntimeError('boom')

        with mock.patch.object(outbox, 'CONSUMERS', []):
            outbox.subscribe('test.flaky', 'thing.*', flaky)
            with self.db.write() as conn:
                eid = outbox.emit(conn, 'thing.happened', 'thing', 't1', {'n': 1})
                audit.record(conn, None, 'thing.happen', 'thing', 't1')
            self.assertEqual(outbox.dispatch(self.db), 0)
            row = self.db.conn().execute('SELECT attempts, state, available_at FROM outbox_event WHERE id = ?',
                                         (eid,)).fetchone()
            self.assertEqual((row['attempts'], row['state']), (1, 'pending'))
            with self.db.write() as conn:
                conn.execute("UPDATE outbox_event SET available_at = '2000-01-01T00:00:00.000000Z'")
            self.assertEqual(outbox.dispatch(self.db), 1)
            self.assertEqual(outbox.dispatch(self.db), 0)
            self.assertEqual(len(calls), 2)


class WithdrawalReplayTest(AppCase):
    def test_restore_then_replay_keeps_withdrawn_absent(self):
        w = self.user('writer')
        keep = self.obj(w, title='保留 甲乙')
        gone = self.obj(w, title='撤回 丙丁')
        backup = migrate.backup(self.db, os.path.join(self.tmp, 'snap'), 'drill')
        self.assertEqual(w.post(f"/api/objects/{gone['id']}/withdraw", headers=HDRS, json={}).status_code, 200)
        log = self.settings.withdrawal_log
        record = json.loads(Path(log).read_text().splitlines()[0])
        self.assertEqual(set(record), {'seq', 'ns', 'object_id', 'version', 'reason', 'at', 'actor'})
        self.assertEqual(record['ns'], 'object')
        self.assertEqual((record['seq'], record['object_id'], record['actor']), (1, gone['id'], w.pid))
        out = subprocess.run([sys.executable, str(SERVER / 'bin' / 'replay-withdrawals'), '--database', str(backup),
                              '--log', log, '--fail-on-gap'], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn('newly_withdrawn=1', out.stdout)
        conn = sqlite3.connect(backup)
        state = dict(conn.execute('SELECT id, lifecycle FROM object_head').fetchall())
        self.assertEqual((state[keep['id']], state[gone['id']]), ('active', 'withdrawn'))
        indexed = {r[0] for r in conn.execute('SELECT object_id FROM search_doc')}
        self.assertEqual(indexed, {keep['id']})
        hits = conn.execute("SELECT count(*) FROM search_fts WHERE search_fts MATCH '\"丙丁\"'").fetchone()[0]
        self.assertEqual(hits, 0)
        conn.close()
        self.assertEqual(replay_withdrawals.main(['--database', str(backup), '--log', log, '--fail-on-gap']), 0)
        with open(log, 'a') as f:
            f.write(json.dumps({'seq': 3, 'object_id': keep['id'], 'at': record['at'], 'actor': None}) + '\n')
        self.assertEqual(replay_withdrawals.main(['--database', str(backup), '--log', log, '--fail-on-gap']), 2)
        conn = sqlite3.connect(backup)
        self.assertEqual(conn.execute('SELECT lifecycle FROM object_head WHERE id = ?', (keep['id'],)).fetchone()[0],
                         'active')
        conn.close()


class StorageTest(unittest.TestCase):
    def test_content_addressed_and_traversal_safe(self):
        tmp = tempfile.mkdtemp(prefix='commons-store-')
        try:
            store = storage.LocalStorage(tmp, 'https://usercontent.test')
            f = store.put(b'hello', 'image')
            self.assertEqual(store.read(f.key), b'hello')
            self.assertEqual(store.put(b'hello', 'image').key, f.key)
            self.assertTrue(store.content_url(f.key).startswith('https://usercontent.test/c/image/'))
            for bad in ('../etc/passwd', 'image/../../x', 'Image/' + 'a' * 64):
                with self.assertRaises(ValueError):
                    store.read(bad)
            self.assertTrue(store.delete(f.key))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class FactoryTest(unittest.TestCase):
    def test_settings_from_env_mapping(self):
        tmp = tempfile.mkdtemp(prefix='commons-env-')
        try:
            from app.settings import Settings
            s = Settings.from_env({'COMMONS_DATA_DIR': tmp, 'COMMONS_SITE_DOMAIN': 'commons.example',
                                   'COMMONS_CONTENT_DOMAIN': 'usercontent.example'})
            self.assertEqual(s.allowed_origins, ('https://commons.example',))
            self.assertEqual((s.cookie_name, s.content_origin), ('__Host-sid', 'https://usercontent.example'))
            self.assertTrue(s.db_path.startswith(tmp) and s.withdrawal_log.startswith(tmp))
            self.assertEqual(oct(os.stat(os.path.join(tmp, 'server-secret')).st_mode & 0o777), '0o600')
            self.assertEqual(Settings.from_env({'COMMONS_DATA_DIR': tmp}).secret_key, s.secret_key)
            app = create_app(make_settings(tmp, db_path=os.path.join(tmp, 'f.db')))
            app.state.db.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_readme_lists_every_env_var(self):
        from app.settings import ENV_VARS
        readme = (SERVER / 'README.md').read_text(encoding='utf-8')
        source = (SERVER / 'app' / 'settings.py').read_text(encoding='utf-8')
        used = set(__import__('re').findall(r"'(COMMONS_[A-Z_]+)'", source))
        self.assertEqual(used, set(ENV_VARS))
        self.assertTrue(all(f'`{name}`' in readme for name in ENV_VARS))

    def test_no_arg_factory_for_uvicorn(self):
        from fastapi.testclient import TestClient
        tmp = tempfile.mkdtemp(prefix='commons-factory-')
        env = {'COMMONS_DATA_DIR': tmp, 'COMMONS_ORIGIN': 'http://127.0.0.1:8000', 'COMMONS_INSECURE_COOKIE': '1'}
        try:
            with mock.patch.dict(os.environ, env, clear=True):
                app = create_app()
            r = TestClient(app).get('/api/health')
            self.assertEqual((r.status_code, r.json()['data']['status']), (200, 'ok'))
            self.assertEqual(app.state.settings.cookie_name, 'commons_sid')
            app.state.db.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class WorkerTest(AppCase):
    def test_periodic_tasks_are_leased_across_workers(self):
        from app import worker
        other = Database(self.settings.db_path)
        calls = []

        def tick(_db):
            calls.append(clock.now_ts())
            self.assertEqual(worker.run_periodic(other), 0)

        try:
            with mock.patch.object(worker, 'PERIODIC', {}):
                worker.register_periodic('test.tick', 60, tick)
                with mock.patch.object(clock, 'now_ts', return_value=1000), \
                        self.assertLogs('commons.worker', level='INFO') as logs:
                    self.assertEqual(worker.run_periodic(self.db), 1)
                    self.assertEqual(worker.run_periodic(other), 0)
                self.assertEqual(len(logs.output), 1)
                self.assertIn('periodic task=test.tick status=ok', logs.output[0])
                with mock.patch.object(clock, 'now_ts', return_value=1061):
                    self.assertEqual(worker.run_periodic(other), 1)
                self.assertEqual(calls, [1000, 1061])
        finally:
            other.close()

    def test_purge_calls_registered_module_hooks_before_core_cleanup(self):
        user = self.user('purgehook')
        seen = []

        def purge(conn, principal_id):
            credential_exists = conn.execute(
                'SELECT 1 FROM credential WHERE principal_id = ?', (principal_id,)).fetchone() is not None
            seen.append((principal_id, credential_exists))

        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'pending_deletion', delete_requested_at = ? WHERE id = ?",
                         ('2000-01-01T00:00:00.000000Z', user.pid))
        with mock.patch.object(accounts, 'PURGERS', []):
            accounts.register_purger(purge)
            self.assertEqual(accounts.purge_due(self.db, self.settings), [user.pid])
        self.assertEqual(seen, [(user.pid, True)])
        self.assertIsNone(self.db.conn().execute(
            'SELECT 1 FROM credential WHERE principal_id = ?', (user.pid,)).fetchone())

    def test_module_admin_router_is_mounted_and_still_protected(self):
        paths = {route.path for route in self.app.routes}
        self.assertIn('/api/admin/growth/recompute', paths)
        self.assertIn('/api/growth/admin/recompute', paths)
        response = self.client().post('/api/admin/growth/recompute', headers=HDRS, json={})
        self.assertEqual((response.status_code, self.code(response)), (401, 'unauthenticated'))

    def test_run_once_drains_and_purges(self):
        from app import worker
        self.user('someone')
        with mock.patch.object(outbox, 'CONSUMERS', []):
            self.assertEqual(worker.run_once(self.db, self.settings), 1)
        pending = self.db.conn().execute("SELECT count(*) FROM outbox_event WHERE state = 'pending'").fetchone()[0]
        self.assertEqual(pending, 0)


if __name__ == '__main__':
    unittest.main()
