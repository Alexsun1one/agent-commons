from unittest import mock

from app import accounts, clock, worker
from modules.growth import hooks, jobs
from tests.helpers import AppCase


class GrowthHookTest(AppCase):
    def test_periodic_registration_runs_only_when_due(self):
        task = worker.PERIODIC['growth.recompute']
        self.assertEqual(task.every_seconds, 3600)
        with mock.patch.object(worker, 'PERIODIC', {task.name: task}), \
                mock.patch.object(clock, 'now_ts', return_value=1000):
            self.assertEqual(worker.run_periodic(self.db), 1)
            self.assertEqual(worker.run_periodic(self.db), 0)

    def test_recompute_is_idempotent_and_member_failure_rolls_back(self):
        member = self.user('growth_job')
        first = jobs.recompute(self.db)
        second = jobs.recompute(self.db)
        self.assertEqual((first['promoted'], second['promoted']), (0, 0))

        def broken(conn, principal_id, *_args, **_kwargs):
            conn.execute('UPDATE profile SET level = 2 WHERE principal_id = ?', (principal_id,))
            raise RuntimeError('boom')

        with mock.patch.object(jobs.engine, 'recompute', side_effect=broken), self.assertRaises(RuntimeError):
            jobs.recompute(self.db)
        level = self.db.conn().execute(
            'SELECT level FROM profile WHERE principal_id = ?', (member.pid,)).fetchone()[0]
        self.assertEqual(level, 1)

    def test_purge_is_registered_idempotent_and_transactional(self):
        member = self.user('growth_purge')
        season = self.db.conn().execute('SELECT id FROM growth_season LIMIT 1').fetchone()[0]
        with self.db.write() as conn:
            conn.execute('INSERT INTO growth_state (principal_id, updated_at) VALUES (?, ?)',
                         (member.pid, clock.now()))
            conn.execute('INSERT INTO growth_activity (principal_id, day) VALUES (?, ?)',
                         (member.pid, '2026-10-24'))
            conn.execute('INSERT INTO growth_counter (principal_id, key, value) VALUES (?, ?, 1)',
                         (member.pid, 'reports_total'))
            conn.execute('INSERT INTO growth_token_report '
                         '(principal_id, season_id, family, band, reported_at) VALUES (?, ?, ?, ?, ?)',
                         (member.pid, season, 'openai', 'under_1m', clock.now()))
        self.assertIn(hooks.purge, accounts.PURGERS)
        with self.assertRaises(RuntimeError):
            with self.db.write() as conn:
                hooks.purge(conn, member.pid)
                raise RuntimeError('rollback')
        self.assertEqual(self.db.conn().execute(
            'SELECT count(*) FROM growth_activity WHERE principal_id = ?', (member.pid,)).fetchone()[0], 1)
        with self.db.write() as conn:
            hooks.purge(conn, member.pid)
            hooks.purge(conn, member.pid)
        for table in ('growth_state', 'growth_activity', 'growth_counter', 'growth_token_report'):
            self.assertEqual(self.db.conn().execute(
                f'SELECT count(*) FROM {table} WHERE principal_id = ?', (member.pid,)).fetchone()[0], 0)
