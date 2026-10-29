from unittest import mock

from app import accounts, clock, worker
from modules.feed import hooks, jobs, service
from tests.helpers import AppCase


class FeedHookTest(AppCase):
    def test_registered_intervals_and_digest_utc_gate_are_idempotent(self):
        self.assertEqual(worker.PERIODIC['feed.fetch'].every_seconds, 1800)
        self.assertEqual(worker.PERIODIC['feed.cluster'].every_seconds, 600)
        self.assertEqual(worker.PERIODIC['feed.digest'].every_seconds, 300)
        task = worker.PERIODIC['feed.fetch']
        with mock.patch.object(worker, 'PERIODIC', {task.name: task}), \
                mock.patch.object(clock, 'now_ts', return_value=1000):
            self.assertEqual(worker.run_periodic(self.db), 1)
            self.assertEqual(worker.run_periodic(self.db), 0)
        self.assertTrue(jobs.enqueue_fetch(self.db, '2026-10-25T08:00:00.000000Z'))
        self.assertFalse(jobs.enqueue_fetch(self.db, '2026-10-25T08:01:00.000000Z'))
        self.assertTrue(jobs.enqueue_cluster(self.db, '2026-10-25T08:00:00.000000Z'))
        self.assertFalse(jobs.enqueue_cluster(self.db, '2026-10-25T08:01:00.000000Z'))
        self.assertFalse(jobs.enqueue_digest(self.db, '2026-10-25T07:59:00.000000Z'))
        self.assertTrue(jobs.enqueue_digest(self.db, '2026-10-25T08:00:00.000000Z'))
        self.assertFalse(jobs.enqueue_digest(self.db, '2026-10-25T08:01:00.000000Z'))
        self.assertEqual(service.load_digest(self.db.conn(), '2026-10-25')['date'], '2026-10-25')

    def test_enqueue_failure_rolls_back_and_personal_rows_are_purged(self):
        def broken(conn, *_args, **_kwargs):
            conn.execute("INSERT INTO feed_digest (date, direction, body, generated_at) VALUES "
                         "('2099-01-01', '_all', '{}', '2099-01-01T00:00:00.000000Z')")
            raise RuntimeError('boom')

        with mock.patch.object(jobs.outbox, 'emit', side_effect=broken), self.assertRaises(RuntimeError):
            jobs.enqueue_fetch(self.db, '2099-01-01T00:00:00.000000Z')
        self.assertIsNone(self.db.conn().execute(
            "SELECT 1 FROM feed_digest WHERE date = '2099-01-01'").fetchone())

        member = self.user('feed_purge')
        with self.db.write() as conn:
            conn.execute('INSERT INTO feed_sub (user_id, direction, updated_at) VALUES (?, ?, ?)',
                         (member.pid, 'model', '2026-10-25T00:00:00.000000Z'))
        self.assertIn(hooks.purge, accounts.PURGERS)
        with self.db.write() as conn:
            hooks.purge(conn, member.pid)
            hooks.purge(conn, member.pid)
        self.assertEqual(self.db.conn().execute(
            'SELECT count(*) FROM feed_sub WHERE user_id = ?', (member.pid,)).fetchone()[0], 0)
