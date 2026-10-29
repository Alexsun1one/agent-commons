from app import accounts
from modules.library import hooks
from tests.helpers import HDRS, AppCase


class LibraryHookTest(AppCase):
    def test_usage_is_purged_without_deleting_public_item(self):
        member = self.user('library_purge', level=2)
        payload = {
            'type': 'skill', 'title': '保留资源', 'category': '编程', 'tags': ['验证'],
            'clients_or_stacks': ['Codex'], 'license': '示例',
            'content': {'purpose': '验证', 'skill_md': '# Verify'},
            'examples': [{'input': 'a', 'output': 'b'}], 'installs': [],
        }
        item = member.post('/api/library/items', headers=HDRS, json=payload).json()['data']
        response = member.post(f"/api/library/items/{item['id']}/used", headers=HDRS, json={'useful': True})
        self.assertEqual(response.status_code, 200, response.text)
        with self.db.write() as conn:
            hooks.purge(conn, member.pid)
        self.assertIn(hooks.purge, accounts.PURGERS)
        self.assertEqual(self.db.conn().execute(
            'SELECT count(*) FROM lib_usage WHERE principal_id = ?', (member.pid,)).fetchone()[0], 0)
        self.assertIsNotNone(self.db.conn().execute(
            'SELECT 1 FROM lib_item WHERE object_id = ?', (item['id'],)).fetchone())
