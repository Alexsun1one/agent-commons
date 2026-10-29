from app import accounts, clock
from modules.membership import hooks
from tests.helpers import AppCase


class MembershipHookTest(AppCase):
    def test_usage_is_purged_idempotently(self):
        member = self.user('membership_purge', level=3)
        with self.db.write() as conn:
            conn.execute('INSERT INTO membership_usage '
                         '(principal_id, benefit_key, period_key, used, updated_at) VALUES (?, ?, ?, ?, ?)',
                         (member.pid, 'agent_slots', 'account', 2, clock.now()))
            hooks.purge(conn, member.pid)
            hooks.purge(conn, member.pid)
        self.assertIn(hooks.purge, accounts.PURGERS)
        self.assertEqual(self.db.conn().execute(
            'SELECT count(*) FROM membership_usage WHERE principal_id = ?', (member.pid,)).fetchone()[0], 0)
