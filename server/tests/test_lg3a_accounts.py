"""Data rights registration and synchronous cleanup, with synthetic rows only."""
import importlib
from app import accounts, clock
from app.authz import Actor
from tests.helpers import AppCase, HDRS
from tests.test_lg3a_r2 import AdultRegistrationMixin


class LG3AAccounts(AdultRegistrationMixin, AppCase):
    def test_all_personal_modules_register_both_hooks(self):
        modules = ('content', 'kb', 'library', 'feed', 'public', 'tools', 'agents', 'agentchat', 'ai')
        member = self.user('lg3a_exports', level=2)
        actor = Actor(id=member.pid, level=2, status='active')
        with self.db.write() as conn:
            data = accounts.export(conn, actor)
            for module in modules:
                with self.subTest(module=module):
                    self.assertIn(module, data)
                    purgers = [fn for fn in accounts._purgers_for(self.db)
                               if fn.__module__.startswith('modules.' + module + '.')]
                    self.assertTrue(purgers, module)
                    for fn in purgers:
                        fn(conn, member.pid)
                        fn(conn, member.pid)  # durable-event replay must remain safe
        # Search persists no personal rows: no empty exporter/purger registered just for coverage.
        self.assertNotIn('search', accounts.EXPORTERS)

    def test_export_and_purge_are_scoped_to_member(self):
        member = self.user('lg3a_purge', level=2)
        peer = self.user('lg3a_keep', level=2)
        now = clock.now()
        with self.db.write() as conn:
            for pid in (member.pid, peer.pid):
                conn.execute('INSERT INTO content_follow VALUES (?, ?, ?)', (pid, 'codex', now))
                conn.execute('INSERT INTO feed_sub VALUES (?, ?, ?)', (pid, 'coding', now))
                conn.execute('INSERT INTO ai_member_pref VALUES (?, ?, 1, ?)', (pid, 'search.assist', now))
                conn.execute("INSERT INTO kb_capture (id, source_kind, source_id, title, phenomenon, requested_by, created_at) "
                             "VALUES (?, 'discussion', ?, '私密草稿', '正文', ?, ?)", (pid, pid, pid, now))
            for pid in (member.pid, peer.pid):
                data = accounts.export(conn, Actor(id=pid, level=2, status='active'))
                self.assertEqual(len(data['content']['follows']), 1)
                self.assertEqual(data['feed']['subscriptions'][0]['user_id'], pid)
                self.assertEqual(data['kb']['captures'][0]['requested_by'], pid)
                self.assertEqual(len(data['ai']['prefs']), 1)
            for module in ('content', 'feed', 'kb', 'ai'):
                for fn in accounts._purgers_for(self.db):
                    if fn.__module__.startswith('modules.' + module + '.'):
                        fn(conn, member.pid)
            for table, column in (('content_follow', 'principal_id'), ('feed_sub', 'user_id'),
                                  ('kb_capture', 'requested_by'), ('ai_member_pref', 'principal_id')):
                self.assertEqual(conn.execute(f'SELECT count(*) FROM {table} WHERE {column} = ?',
                                              (member.pid,)).fetchone()[0], 0)
                self.assertEqual(conn.execute(f'SELECT count(*) FROM {table} WHERE {column} = ?',
                                              (peer.pid,)).fetchone()[0], 1)

    def test_agent_cleanup_does_not_wait_for_worker_and_keeps_other_owner(self):
        owner = self.user('lg3a_agentowner', level=2)
        peer = self.user('lg3a_agentpeer', level=2)
        ids = {}
        for client in (owner, peer):
            r = client.post('/api/agents', headers=HDRS, json={'name': '私密名字', 'intro': '私密介绍'})
            self.assertEqual(r.status_code, 201, r.text)
            ids[client.pid] = r.json()['data']['id']
            r = client.post(f"/api/agents/{ids[client.pid]}/tokens", headers=HDRS, json={'preset': 'read'})
            self.assertEqual(r.status_code, 201, r.text)
        hook = importlib.import_module('modules.agents.hooks')
        with self.db.write() as conn:
            hook.purge(conn, owner.pid)
            hook.purge(conn, owner.pid)
            agent = conn.execute('SELECT * FROM agent_profile WHERE principal_id = ?', (ids[owner.pid],)).fetchone()
            self.assertEqual((agent['status'], agent['intro']), ('retired', ''))
            self.assertNotIn('私密', agent['name'])
            self.assertEqual(conn.execute('SELECT count(*) FROM agent_token WHERE agent_id = ? AND revoked_at IS NULL',
                                          (ids[owner.pid],)).fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT count(*) FROM agent_token WHERE agent_id = ? AND revoked_at IS NULL',
                                          (ids[peer.pid],)).fetchone()[0], 1)
        exported = owner.get('/api/me/export')
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertNotIn('token_hash', exported.text)

    def test_public_snapshot_publisher_cache_anonymised(self):
        from modules.public import hooks
        owner = self.user('lg3a_publisher', level=2)
        # Exercise cached name handling without opening the public capability or publishing.
        now = clock.now()
        with self.db.write() as conn:
            conn.execute("INSERT INTO public_snapshot (id, object_id, object_version, kind, slug, title, markdown, html, "
                         "license, publisher_id, publisher_name, status, source_hash, published_at, created_at) "
                         "VALUES ('snapshot', 'synthetic', 1, 'knowledge', 'synthetic', '示例', '', '', 'test', ?, "
                         "'私密名字', 'pending', 'synthetic', ?, ?)", (owner.pid, now, now))
            data = hooks.export(conn, Actor(id=owner.pid))
            self.assertEqual(data['snapshots'][0]['publisher_name'], '私密名字')
            hooks.purge(conn, owner.pid)
            self.assertEqual(conn.execute("SELECT publisher_name FROM public_snapshot WHERE id = 'snapshot'").fetchone()[0],
                             '已注销成员')
