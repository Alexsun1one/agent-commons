"""LG-3A: object x visitor x interface matrix, entirely in-process test fixtures."""
from app import accounts, objects
from tests.helpers import AppCase, HDRS
from tests.test_lg3a_r2 import AdultRegistrationMixin


class LG3APermissions(AdultRegistrationMixin, AppCase):
    def setUp(self):
        super().setUp()
        self.owner = self.user('lg3a_owner', level=3)
        self.reader = self.user('lg3a_reader')
        self.high = self.user('lg3a_high', level=3)
        self.admin = self.user('lg3a_admin', level=5, roles=('admin',), totp=True)
        with self.db.write() as conn:
            self.space = accounts.create_space(conn, self.owner.pid, 'lg3a', '矩阵空间')
            accounts.set_membership(conn, self.space, self.reader.pid)

    def make(self, kind, scope):
        attrs = {'visibility': scope}
        if scope == 'level':
            attrs['min_level'] = 3
        if scope == 'space':
            attrs['space_id'] = self.space
        if scope == 'named':
            attrs['acl'] = [self.reader.pid]
        title = 'matrixneedle ' + kind + ' ' + scope
        if kind == 'problem':
            response = self.owner.post('/api/kb/problems', headers=HDRS, json={
                'title': title, 'phenomenon': 'matrixneedle', **attrs})
        elif kind == 'skill':
            response = self.owner.post('/api/library/items', headers=HDRS, json={
                'type': kind, 'title': title, 'category': '编程', 'tags': [], 'clients_or_stacks': [],
                'license': '示例', 'content': {'purpose': 'matrixneedle', 'skill_md': '# matrixneedle'},
                'examples': [{'input': '输入', 'output': '输出'}], 'installs': [], **attrs})
        else:
            return self.obj(self.owner, type=kind, title=title, content={'body': 'matrixneedle'}, **attrs)['id']
        self.assertEqual(response.status_code, 201, response.text)
        oid = response.json()['data']['id']
        if kind == 'skill':
            with self.db.write() as conn:
                objects.set_lifecycle(conn, self.owner.pid, oid, 'active', 'fixture')
                conn.execute("UPDATE lib_item SET status = 'active' WHERE object_id = ?", (oid,))
        return oid

    def test_object_visitor_interface_matrix(self):
        kinds = ('knowledge', 'discussion', 'work', 'problem', 'skill')
        scopes = ('members', 'level', 'space', 'named')
        ids = {(kind, scope): self.make(kind, scope) for kind in kinds for scope in scopes}
        # Fix the lifecycle dimension explicitly: rapid fixture creation can trigger spam screening.
        with self.db.write() as conn:
            for oid in ids.values():
                objects.set_lifecycle(conn, self.owner.pid, oid, 'active', 'matrix_fixture')
        visitors = ((self.owner, set(scopes)), (self.reader, {'members', 'space', 'named'}),
                    (self.high, {'members', 'level'}), (self.admin, {'members', 'level'}))
        for client, allowed in visitors:
            expected = {oid for (kind, scope), oid in ids.items() if scope in allowed}
            for path in ('/api/objects', '/api/search?q=matrixneedle', '/api/content/search?q=matrixneedle'):
                with self.subTest(visitor=client.pid, interface=path):
                    join = '&' if '?' in path else '?'
                    response = client.get(path + join + 'limit=50&count=true')
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual({r['id'] for r in response.json()['data']}, expected,
                                     {str(key): oid for key, oid in ids.items()})
                    self.assertEqual(response.json()['meta']['count'], len(expected))
            response = client.get('/api/search-all?q=matrixneedle&limit=50')
            self.assertEqual({r['id'] for r in response.json()['data']}, expected,
                                     {str(key): oid for key, oid in ids.items()})
            for (kind, scope), oid in ids.items():
                paths = [f'/api/objects/{oid}', f'/api/content/objects/{oid}']
                if kind == 'problem':
                    paths.append(f'/api/kb/problems/{oid}')
                if kind == 'skill':
                    paths.append(f'/api/library/items/{oid}')
                for path in paths:
                    with self.subTest(visitor=client.pid, object=(kind, scope), interface=path):
                        response = client.get(path)
                        self.assertEqual(response.status_code, 200 if scope in allowed else 404, response.text)
                        if scope not in allowed:
                            missing = client.get(path.rsplit('/', 1)[0] + '/missing')
                            self.assertEqual(response.json()['error']['code'], missing.json()['error']['code'])
                            self.assertEqual(response.json()['error']['message'], missing.json()['error']['message'])
            for kind, path in (('problem', '/api/kb/search?q=matrixneedle&limit=50'),
                               ('skill', '/api/library/search?q=matrixneedle&limit=50')):
                response = client.get(path)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual({r['id'] for r in response.json()['data']},
                                 {oid for (k, scope), oid in ids.items() if k == kind and scope in allowed})
        anon = self.client()
        self.assertEqual(anon.get('/api/objects?count=true').json()['meta']['count'], 0)
        for oid in ids.values():
            self.assertEqual(anon.get(f'/api/objects/{oid}').status_code, 404)

    def test_replies_counts_and_detail_share_permission(self):
        root = self.obj(self.owner, title='matrixneedle root')['id']
        replies = {}
        for lifecycle in ('active', 'hidden', 'pending_review', 'draft', 'withdrawn'):
            oid = self.obj(self.owner, type='reply', root_id=root, title='matrixneedle reply')['id']
            with self.db.write() as conn:
                conn.execute('UPDATE object_head SET lifecycle = ? WHERE id = ?', (lifecycle, oid))
            replies[lifecycle] = oid
        for client, states in ((self.reader, {'active'}), (self.owner, {'active', 'hidden', 'pending_review'})):
            expected = {replies[state] for state in states}
            for order in ('time', 'tree'):
                r = client.get(f'/api/content/objects/{root}/replies?order={order}')
                self.assertEqual({item['id'] for item in r.json()['data']}, expected)
            detail = client.get(f'/api/content/objects/{root}').json()['data']
            self.assertEqual(detail['stats']['replies'], len(expected))
            for state in ('hidden', 'pending_review', 'withdrawn'):
                r = client.get('/api/content/replies/' + replies[state])
                self.assertEqual(r.status_code, 200 if state in states else 404)

    def test_acl_and_parent_revocation_apply_without_worker(self):
        root = self.make('discussion', 'named')
        reply = self.obj(self.reader, type='reply', root_id=root, title='matrixneedle reply')['id']
        self.assertEqual(self.reader.get(f'/api/objects/{reply}').status_code, 200)
        with self.db.write() as conn:
            conn.execute('DELETE FROM object_acl WHERE object_id = ?', (root,))
        for oid in (root, reply):
            self.assertEqual(self.reader.get(f'/api/objects/{oid}').status_code, 404)
        self.assertEqual(self.reader.get('/api/search?q=matrixneedle&count=true').json()['meta']['count'], 0)
        self.assertEqual(self.reader.get('/api/objects?count=true').json()['meta']['count'], 0)

    def test_disabled_search_and_content_capabilities(self):
        for flag, paths in (
            ('core.search', ('/api/search?q=matrixneedle', '/api/search-all?q=matrixneedle', '/api/search-all?q=')),
            ('core.objects', ('/api/content/feed', '/api/content/schema', '/api/content/saved')),
        ):
            with self.db.write() as conn:
                conn.execute('UPDATE feature_flag SET enabled = 0 WHERE key = ?', (flag,))
            for path in paths:
                r = self.reader.get(path)
                self.assertEqual(r.status_code, 501, r.text)
            with self.db.write() as conn:
                conn.execute('UPDATE feature_flag SET enabled = 1 WHERE key = ?', (flag,))

    def test_hidden_reply_cannot_leak_through_quote_or_thread_pointer(self):
        root = self.obj(self.owner)['id']
        first = self.reader.post(f'/api/content/objects/{root}/replies', headers=HDRS,
                                 json={'body': 'invisible quote secret'}).json()['data']
        second = self.owner.post(f'/api/content/objects/{root}/replies', headers=HDRS,
                                 json={'body': 'visible answer', 'reply_to': first['id']}).json()['data']
        with self.db.write() as conn:
            objects.set_lifecycle(conn, None, first['id'], 'hidden', 'fixture')
        for path in (f'/api/content/objects/{root}/replies', f"/api/content/replies/{second['id']}"):
            r = self.high.get(path)
            self.assertEqual(r.status_code, 200, r.text)
            self.assertNotIn(first['id'], r.text)
            self.assertNotIn('invisible quote secret', r.text)

    def test_feed_switch_stops_background_consumers(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        from modules.feed import workers
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 0 WHERE key = 'feed.enabled'")
            with patch.object(workers.service, 'collect') as collect, \
                    patch.object(workers.service, 'cluster_pending') as cluster, \
                    patch.object(workers.service, 'persist_digest') as digest, \
                    patch.object(workers.service, 'translate_pending') as translate:
                workers.on_fetch(conn, {})
                workers.on_cluster(conn, {})
                workers.on_digest(conn, {})
                workers.on_translate({}, SimpleNamespace(db=self.db))
                for fn in (collect, cluster, digest, translate):
                    fn.assert_not_called()

    def test_owned_module_gates_block_data_but_keep_account_rights(self):
        from modules.ai.gateway import Gateway
        from modules.ai import catalog
        cases = (
            ('kb.enabled', '/api/kb/search', 501),
            ('library.enabled', '/api/library/items', 501),
            ('feed.enabled', '/api/feed/events', 501),
            ('tools.enabled', '/api/tools', 501),
            ('agents.enabled', '/api/agents/mine', 501),
            ('agentchat.enabled', '/api/agentchat/channels', 501),
            ('public.enabled', '/api/public/robots.txt', 404),
        )
        with self.db.write() as conn:
            for key, _, _ in cases:
                conn.execute('UPDATE feature_flag SET enabled = 0 WHERE key = ?', (key,))
            conn.execute("UPDATE feature_flag SET enabled = 0 WHERE key = 'ai.enabled'")
            gateway = Gateway(env={}, providers={})
            self.assertEqual(gateway._gate(conn, catalog.get('search.assist'), self.reader.pid), 'disabled_global')
        for key, path, status in cases:
            with self.subTest(flag=key):
                response = self.reader.get(path)
                self.assertEqual(response.status_code, status, response.text)
        exported = self.reader.get('/api/me/export')
        self.assertEqual(exported.status_code, 200, exported.text)

    def test_module_switch_cannot_be_bypassed_through_core_or_aggregate_search(self):
        problem = self.make('problem', 'members')
        skill = self.make('skill', 'members')
        for oid in (problem, skill):
            self.assertEqual(self.reader.get(f'/api/objects/{oid}').status_code, 200)
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 0 WHERE key IN ('kb.enabled', 'library.enabled')")
        for client in (self.owner, self.reader):
            for oid in (problem, skill):
                self.assertEqual(client.get(f'/api/objects/{oid}').status_code, 404)
            for path in ('/api/objects?count=true', '/api/search?q=matrixneedle&count=true',
                         '/api/content/search?q=matrixneedle&count=true', '/api/search-all?q=matrixneedle'):
                response = client.get(path)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['data'], [])
                if 'count=true' in path:
                    self.assertEqual(response.json()['meta']['count'], 0)
        # Parent switches also hide otherwise enabled reply types.
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 1 WHERE key = 'kb.enabled'")
        reply = self.obj(self.reader, type='reply', root_id=problem)['id']
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 0 WHERE key = 'kb.enabled'")
        self.assertEqual(self.reader.get(f'/api/objects/{reply}').status_code, 404)
