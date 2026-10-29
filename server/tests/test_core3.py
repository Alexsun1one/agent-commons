import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from app import accounts, audit, clock, ledger, objects, outbox, worker
from app.authz import Actor
from app.settings import Settings
from tests.helpers import AppCase


class ExternalConsumerTest(AppCase):
    def context(self):
        return outbox.AppContext(self.db, self.settings, self.app.state.storage)

    def test_external_consumer_does_not_hold_the_write_lock(self):
        started = threading.Event()
        release = threading.Event()
        writer_done = threading.Event()

        def heavy(event, app_context):
            self.assertIs(app_context.db, self.db)
            self.assertIs(app_context.settings, self.settings)
            self.assertIs(app_context.storage, self.app.state.storage)
            started.set()
            self.assertTrue(release.wait(5))
            with app_context.db.write() as conn:
                conn.execute('INSERT INTO rate_bucket (key, window_start, count) VALUES (?, 0, 1)',
                             ('external-result',))

        def write_elsewhere():
            with self.db.write() as conn:
                conn.execute('INSERT INTO rate_bucket (key, window_start, count) VALUES (?, 0, 1)',
                             ('concurrent-write',))
            writer_done.set()

        with mock.patch.object(outbox, 'CONSUMERS', []), \
                mock.patch.object(outbox, 'EXTERNAL_CONSUMERS', []), \
                mock.patch.object(outbox, 'EXTERNAL_CONSUMER_MODULES', {}):
            outbox.subscribe_external('test.heavy', 'heavy.*', heavy)
            with self.db.write() as conn:
                outbox.emit(conn, 'heavy.started', 'test', '1')
            dispatch = threading.Thread(target=outbox.dispatch, args=(self.db,),
                                        kwargs={'app_context': self.context()})
            dispatch.start()
            self.assertTrue(started.wait(2))
            writer = threading.Thread(target=write_elsewhere)
            writer.start()
            try:
                self.assertTrue(writer_done.wait(1), 'heavy handler held the database write lock')
            finally:
                release.set()
                writer.join(5)
                dispatch.join(5)
            self.assertFalse(dispatch.is_alive())
        keys = {r[0] for r in self.db.conn().execute(
            "SELECT key FROM rate_bucket WHERE key IN ('concurrent-write', 'external-result')")}
        self.assertEqual(keys, {'concurrent-write', 'external-result'})

    def test_external_consumer_keeps_retry_and_receipt_semantics(self):
        calls = []

        def flaky(event, app_context):
            calls.append(event['id'])
            if len(calls) == 1:
                raise RuntimeError('boom')
            with app_context.db.write() as conn:
                conn.execute('INSERT INTO rate_bucket (key, window_start, count) VALUES (?, 0, 1)',
                             ('external-retry-result',))

        with mock.patch.object(outbox, 'CONSUMERS', []), \
                mock.patch.object(outbox, 'EXTERNAL_CONSUMERS', []), \
                mock.patch.object(outbox, 'EXTERNAL_CONSUMER_MODULES', {}):
            outbox.subscribe_external('test.flaky_external', 'heavy.*', flaky)
            with self.db.write() as conn:
                event_id = outbox.emit(conn, 'heavy.retry', 'test', '2')
            self.assertEqual(outbox.dispatch(self.db, app_context=self.context()), 0)
            row = self.db.conn().execute('SELECT attempts, state FROM outbox_event WHERE id = ?',
                                         (event_id,)).fetchone()
            self.assertEqual((row['attempts'], row['state']), (1, 'pending'))
            with self.db.write() as conn:
                conn.execute("UPDATE outbox_event SET available_at = '2000-01-01T00:00:00.000000Z' WHERE id = ?",
                             (event_id,))
            self.assertEqual(outbox.dispatch(self.db, app_context=self.context()), 1)
            self.assertEqual(len(calls), 2)
            self.assertIsNotNone(self.db.conn().execute(
                'SELECT 1 FROM outbox_receipt WHERE consumer = ? AND event_id = ?',
                ('test.flaky_external', event_id)).fetchone())


class AccountCoreTest(AppCase):
    def actor(self, client):
        return Actor(id=client.pid, level=1, roles=frozenset(), status='active', kind='human')

    def test_export_hides_confirmer_and_skips_uninstalled_module_exporter(self):
        member = self.user('exporter')
        confirmer = self.user('confirmer')
        with self.db.write() as conn:
            ledger.record(conn, event_type='answer.useful', subject_id=member.pid, points=5, rule_version='r1',
                          idempotency_key='core3-export', confirmed_by=confirmer.pid)

        def ghost(conn, actor):
            return {'leak': True}

        ghost.__module__ = 'modules.ghost.service'
        with mock.patch.dict(accounts.EXPORTERS, {}, clear=True), \
                mock.patch.dict(accounts.EXPORTER_MODULES, {}, clear=True), \
                mock.patch.object(accounts, 'PURGER_MODULE_PREFIXES', {'modules.ghost'}):
            accounts.register_exporter('ghost', ghost)
            data = accounts.export(self.db.conn(), self.actor(member))
        self.assertNotIn('ghost', data)
        self.assertEqual([row['confirmed_by'] for row in data['contributions']], [None])

    def test_purge_withdraws_only_private_scopes_and_anonymises_the_rest(self):
        member = self.user('departing')
        other = self.user('recipient')
        kept = {
            'members': self.obj(member, title='members')['id'],
            'level': self.obj(member, title='level', visibility='level', min_level=2)['id'],
            'public': self.obj(member, title='public')['id'],
        }
        removed = {
            'draft': self.obj(member, title='draft', lifecycle='draft')['id'],
            'named': self.obj(member, title='named', visibility='named', acl=[other.pid])['id'],
        }
        with self.db.write() as conn:
            now = clock.now()
            conn.execute("UPDATE object_head SET visibility = 'public' WHERE id = ?", (kept['public'],))
            conn.execute("INSERT INTO space (id, slug, name, kind, owner_id, created_at) "
                         "VALUES ('core3-space', 'core3-space', 'Core 3', 'group', ?, ?)", (member.pid, now))
            conn.execute("INSERT INTO membership (space_id, principal_id, role, state, joined_at, updated_at) "
                         "VALUES ('core3-space', ?, 'owner', 'active', ?, ?)", (member.pid, now, now))
        removed['space'] = self.obj(member, title='space', visibility='space', space_id='core3-space')['id']
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'pending_deletion', delete_requested_at = ? WHERE id = ?",
                         ('2000-01-01T00:00:00.000000Z', member.pid))
        self.assertEqual(accounts.purge_due(self.db, self.settings), [member.pid])
        states = {r['id']: r['lifecycle'] for r in self.db.conn().execute(
            'SELECT id, lifecycle FROM object_head WHERE author_id = ?', (member.pid,))}
        self.assertTrue(all(states[oid] == 'active' for oid in kept.values()))
        self.assertTrue(all(states[oid] == 'withdrawn' for oid in removed.values()))
        profile = self.db.conn().execute('SELECT display_name FROM profile WHERE principal_id = ?',
                                         (member.pid,)).fetchone()
        self.assertEqual(profile['display_name'], '已注销成员')

    def test_suspend_and_unsuspend_own_state_sessions_and_audit(self):
        governor = self.user('governor')
        member = self.user('pauseme')
        with self.db.write() as conn:
            previous = accounts.suspend(conn, member.pid, governor.pid, 'core3_test')
        self.assertEqual(previous, 'active')
        self.assertEqual(self.db.conn().execute('SELECT status FROM principal WHERE id = ?',
                                                (member.pid,)).fetchone()['status'], 'suspended')
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM session WHERE principal_id = ? '
                                                'AND revoked_at IS NULL', (member.pid,)).fetchone()[0], 0)
        with self.db.write() as conn:
            accounts.unsuspend(conn, member.pid, governor.pid, 'core3_test_done')
        actions = [r[0] for r in self.db.conn().execute(
            "SELECT action FROM audit_event WHERE target_id = ? AND action LIKE 'account.%suspend' ORDER BY occurred_at",
            (member.pid,))]
        self.assertEqual(actions, ['account.suspend', 'account.unsuspend'])


class PublishAndConfigTest(AppCase):
    def test_strictest_pre_publish_hook_wins(self):
        member = self.user('publisher')
        active = lambda conn, actor, head, version: 'active'
        review = lambda conn, actor, head, version: 'pending_review'
        with mock.patch.object(objects, 'PRE_PUBLISH', [active, review]):
            created = self.obj(member)
        self.assertEqual(created['lifecycle'], 'pending_review')

    def test_governance_screening_runs_before_publish_returns(self):
        member = self.user('screened', level=1)
        created = self.obj(member, content={'body': '请打电话 13800138000 联系我'})
        self.assertEqual(created['lifecycle'], 'pending_review')
        self.assertIsNotNone(self.db.conn().execute(
            "SELECT 1 FROM gov_screening WHERE target_type = 'object' AND target_id = ?", (created['id'],)).fetchone())

    def test_rooms_hooks_are_registered(self):
        task = worker.PERIODIC['rooms.reminders']
        self.assertEqual(task.every_seconds, 60)
        self.assertEqual(task.fn.__module__, 'modules.rooms.router')


class LiveKitSettingsTest(unittest.TestCase):
    def test_secret_is_loaded_from_file_and_defaults_are_derived(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'server-secret').write_bytes(b's' * 32)
            (root / 'livekit-secret').write_bytes(b'l' * 32)
            settings = Settings.from_env({
                'COMMONS_DATA_DIR': tmp,
                'COMMONS_SECRET_FILE': str(root / 'server-secret'),
                'COMMONS_ORIGIN': 'https://commons.test',
                'COMMONS_LIVEKIT_API_KEY': 'livekit-key',
                'COMMONS_LIVEKIT_API_SECRET_FILE': str(root / 'livekit-secret'),
            })
        self.assertEqual(settings.livekit_api_secret, b'l' * 32)
        self.assertEqual(settings.livekit_ws_url, 'wss://commons.test')
        self.assertEqual(settings.livekit_api_url, 'http://127.0.0.1:7880')

    def test_short_livekit_secret_is_rejected(self):
        with self.assertRaises(ValueError):
            Settings(db_path=':memory:', secret_key=b's' * 32, livekit_api_secret=b'short')


if __name__ == '__main__':
    unittest.main()
