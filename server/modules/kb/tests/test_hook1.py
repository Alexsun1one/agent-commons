from app import accounts
from modules.kb import hooks
from tests.helpers import AppCase


class KBHookTest(AppCase):
    def test_drafts_are_deleted_and_confirmed_capture_is_anonymised(self):
        member = self.user('kb_purge')
        with self.db.write() as conn:
            for ident, status in (('draft-cap', 'draft'), ('confirmed-cap', 'confirmed')):
                conn.execute('INSERT INTO kb_capture '
                             '(id, source_kind, source_id, title, phenomenon, requested_by, status, created_at) '
                             'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                             (ident, 'discussion', ident, '题目', '现象', member.pid, status,
                              '2026-10-25T00:00:00.000000Z'))
            hooks.purge(conn, member.pid)
        self.assertIn(hooks.purge, accounts.PURGERS)
        self.assertIsNone(self.db.conn().execute('SELECT 1 FROM kb_capture WHERE id = ?', ('draft-cap',)).fetchone())
        self.assertIsNone(self.db.conn().execute(
            'SELECT requested_by FROM kb_capture WHERE id = ?', ('confirmed-cap',)).fetchone()[0])
