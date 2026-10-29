import json
from unittest import mock

from app import accounts, worker
from modules.notify import hooks, jobs
from tests.helpers import AppCase


def add_notification(conn, ident, recipient, occurred, title='提醒', body='正文', actor_ids='[]'):
    conn.execute(
        'INSERT INTO notification '
        '(id, recipient_id, category, title, body, actor_ids_json, occurred_at, available_at, created_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (ident, recipient, 'reply', title, body, actor_ids, occurred, occurred, occurred, occurred),
    )


class NotifyHookTest(AppCase):
    def test_daily_digest_is_preference_aware_quiet_and_idempotent(self):
        member = self.user('digest_member')
        with self.db.write() as conn:
            add_notification(conn, 'digest-source', member.pid, '2026-10-24T12:00:00.000000Z')
            conn.execute('INSERT INTO notify_pref '
                         '(principal_id, category_json, quiet_start, quiet_end, timezone_offset_min, daily_digest, updated_at) '
                         "VALUES (?, '{\"system\":true}', '07:00', '09:00', 0, 1, '2026-10-25T00:00:00.000000Z')",
                         (member.pid,))
        self.assertEqual(worker.PERIODIC['notify.daily_digest'].every_seconds, 3600)
        self.assertEqual(jobs.deliver_daily_digests(self.db, '2026-10-25T07:59:00.000000Z'), 0)
        self.assertEqual(jobs.deliver_daily_digests(self.db, '2026-10-25T08:30:00.000000Z'), 1)
        self.assertEqual(jobs.deliver_daily_digests(self.db, '2026-10-25T08:31:00.000000Z'), 0)
        row = self.db.conn().execute(
            "SELECT target_id, available_at FROM notification WHERE recipient_id = ? AND category = 'system'",
            (member.pid,)).fetchone()
        self.assertEqual((row['target_id'], row['available_at']),
                         ('2026-10-24', '2026-10-25T09:00:00.000000Z'))

    def test_delivery_failure_rolls_back_and_purge_anonymises_other_inboxes(self):
        member = self.user('notify_actor')
        other = self.user('notify_other')
        with self.db.write() as conn:
            add_notification(conn, 'daily-source', member.pid, '2026-10-24T12:00:00.000000Z')
        with mock.patch.object(jobs.audit, 'record', side_effect=RuntimeError('boom')), self.assertRaises(RuntimeError):
            with self.db.write() as conn:
                jobs.deliver_one(conn, member.pid, jobs.datetime.fromisoformat('2026-10-25T08:30:00+00:00'))
        self.assertEqual(self.db.conn().execute(
            "SELECT count(*) FROM notification WHERE recipient_id = ? AND category = 'system'",
            (member.pid,)).fetchone()[0], 0)

        with self.db.write() as conn:
            add_notification(conn, 'other-inbox', other.pid, '2026-10-25T10:00:00.000000Z',
                             title='notify_actor 回复了你', body='notify_actor 留言',
                             actor_ids=json.dumps([member.pid]))
            hooks.purge(conn, member.pid)
            hooks.purge(conn, member.pid)
        self.assertIn(hooks.purge, accounts.PURGERS)
        self.assertEqual(self.db.conn().execute(
            'SELECT count(*) FROM notification WHERE recipient_id = ?', (member.pid,)).fetchone()[0], 0)
        row = self.db.conn().execute('SELECT title, body, actor_ids_json FROM notification WHERE id = ?',
                                     ('other-inbox',)).fetchone()
        self.assertEqual((row['title'], row['body'], json.loads(row['actor_ids_json'])),
                         ('已注销成员 回复了你', '已注销成员 留言', []))
