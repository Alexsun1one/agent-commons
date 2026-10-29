import unittest
import uuid

from app import accounts, objects
from app.authz import Actor, visible_predicate
from tests.helpers import HDRS, AppCase


class VisibilityTest(AppCase):
    def setUp(self):
        super().setUp()
        self.author = self.user('author', level=2)
        self.l1 = self.user('lone', level=1)
        self.l3 = self.user('senior', level=3)
        self.member = self.user('member', level=1)
        self.named = self.user('named', level=1)
        with self.db.write() as conn:
            self.space = accounts.create_space(conn, self.author.pid, 'lab', '实验室')
            accounts.set_membership(conn, self.space, self.member.pid)
        a = self.author
        self.ids = {
            'members': self.obj(a, title='成员可见 模型 alpha')['id'],
            'level3': self.obj(a, title='三级可见 模型 beta', visibility='level', min_level=3)['id'],
            'space': self.obj(a, title='空间可见 模型 gamma', visibility='space', space_id=self.space)['id'],
            'named': self.obj(a, title='指定人 模型 delta', visibility='named', acl=[self.named.pid])['id'],
            'draft': self.obj(a, title='草稿 模型 epsilon', lifecycle='draft')['id'],
            'hidden': self.obj(a, title='待审 模型 zeta')['id'],
            'space_l3': self.obj(a, title='空间三级 模型 theta', visibility='space', space_id=self.space,
                                 min_level=3)['id'],
        }
        with self.db.write() as conn:
            objects.set_lifecycle(conn, None, self.ids['hidden'], 'hidden', 'test')
        self.ids['reply'] = self.obj(self.member, type='reply', title='回复 模型 eta', root_id=self.ids['space'])['id']
        self.expected = {
            'author': {'members', 'level3', 'space', 'named', 'draft', 'hidden', 'space_l3', 'reply'},
            'lone': {'members'},
            'senior': {'members', 'level3'},
            'member': {'members', 'space', 'reply'},
            'named': {'members', 'named'},
        }
        self.clients = {'author': self.author, 'lone': self.l1, 'senior': self.l3, 'member': self.member,
                        'named': self.named}

    def names(self, ids):
        reverse = {v: k for k, v in self.ids.items()}
        return {reverse[i] for i in ids}

    def collect(self, client, path):
        ids, cursor = [], None
        while True:
            url = path + ('&' if '?' in path else '?') + 'limit=2&count=1' + (f'&cursor={cursor}' if cursor else '')
            r = client.get(url)
            self.assertEqual(r.status_code, 200, r.text)
            body = r.json()
            ids += [item['id'] for item in body['data']]
            count = body['meta']['count']
            cursor = body['meta']['next_cursor']
            if not cursor:
                return ids, count

    def test_list_search_count_agree(self):
        for name, client in self.clients.items():
            listed, list_count = self.collect(client, '/api/objects')
            found, search_count = self.collect(client, '/api/search?q=模型')
            self.assertEqual(len(listed), len(set(listed)), name)
            self.assertEqual(self.names(listed), self.expected[name], name)
            self.assertEqual(set(found), set(listed), name)
            self.assertEqual(list_count, len(listed), name)
            self.assertEqual(search_count, len(found), name)

    def test_anonymous_sees_nothing(self):
        anon = self.client()
        r = anon.get('/api/objects?count=1')
        self.assertEqual((r.json()['data'], r.json()['meta']['count']), ([], 0))
        self.assertEqual(anon.get('/api/search?q=模型').status_code, 401)
        self.assertEqual(anon.get(f"/api/objects/{self.ids['members']}").status_code, 404)

    def test_hidden_read_is_404_like_missing(self):
        missing = self.l1.get(f'/api/objects/{uuid.uuid4()}')
        for key in ('level3', 'space', 'named', 'draft', 'hidden', 'reply'):
            r = self.l1.get(f'/api/objects/{self.ids[key]}')
            self.assertEqual(r.status_code, 404, key)
            self.assertEqual(r.json()['error']['message'], missing.json()['error']['message'])
            p = self.l1.patch(f'/api/objects/{self.ids[key]}', headers={**HDRS, 'If-Match': '"v1-p1"'},
                              json={'title': 'x'})
            self.assertEqual(p.status_code, 404, key)
        self.assertEqual(self.l1.get(f"/api/objects/{self.ids['members']}").status_code, 200)

    def test_visible_but_not_owner_is_403(self):
        r = self.l3.patch(f"/api/objects/{self.ids['level3']}", headers={**HDRS, 'If-Match': '"v1-p1"'},
                          json={'title': '改'})
        self.assertEqual((r.status_code, self.code(r)), (403, 'action_not_allowed'))
        r = self.l3.post(f"/api/objects/{self.ids['level3']}/withdraw", headers=HDRS, json={})
        self.assertEqual(r.status_code, 403)

    def test_search_snippets_do_not_leak(self):
        for marker in ('beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'):
            r = self.l1.get(f'/api/search?q={marker}&count=1')
            self.assertEqual((r.json()['data'], r.json()['meta']['count']), ([], 0), marker)
        r = self.l1.get('/api/search?q=模型')
        self.assertTrue(all('alpha' in item['snippet'] or '成员可见' in item['title'] for item in r.json()['data']))

    def test_withdraw_takes_effect_immediately(self):
        r = self.author.post(f"/api/objects/{self.ids['members']}/withdraw", headers=HDRS, json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.l1.get('/api/search?q=alpha&count=1').json()['meta']['count'], 0)
        self.assertEqual(self.l1.get(f"/api/objects/{self.ids['members']}").status_code, 404)
        self.assertEqual(self.author.get(f"/api/objects/{self.ids['members']}").status_code, 404)
        self.author.post(f"/api/objects/{self.ids['space']}/withdraw", headers=HDRS, json={})
        self.assertEqual(self.member.get(f"/api/objects/{self.ids['reply']}").status_code, 404)
        found, _ = self.collect(self.member, '/api/search?q=模型')
        self.assertEqual(self.names(found), set())

    def test_policy_changes_apply_on_next_request(self):
        with self.db.write() as conn:
            accounts.set_membership(conn, self.space, self.member.pid, 'left')
            conn.execute('UPDATE profile SET level = 3 WHERE principal_id = ?', (self.l1.pid,))
        listed, _ = self.collect(self.member, '/api/objects')
        self.assertEqual(self.names(listed), {'members'})
        listed, _ = self.collect(self.l1, '/api/objects')
        self.assertEqual(self.names(listed), {'members', 'level3'})

    def test_named_acl_change_bumps_epoch(self):
        r = self.author.get(f"/api/objects/{self.ids['named']}")
        self.assertEqual(r.json()['data']['acl'], [self.named.pid])
        self.assertNotIn('acl', self.named.get(f"/api/objects/{self.ids['named']}").json()['data'])
        r = self.author.patch(f"/api/objects/{self.ids['named']}", headers={**HDRS, 'If-Match': r.headers['etag']},
                              json={'acl': [self.l1.pid]})
        self.assertEqual(r.json()['data']['policy_epoch'], 2)
        self.assertEqual(self.named.get(f"/api/objects/{self.ids['named']}").status_code, 404)
        self.assertEqual(self.l1.get(f"/api/objects/{self.ids['named']}").status_code, 200)

    def test_public_scope_is_501(self):
        r = self.obj(self.author, status=501, visibility='public')
        self.assertEqual(r['error']['code'], 'capability_unavailable')

    def test_space_scope_requires_membership(self):
        r = self.obj(self.l1, status=404, visibility='space', space_id=self.space)
        self.assertEqual(r['error']['code'], 'resource_not_found')

    def test_suspended_actor_gets_false_predicate(self):
        pred = visible_predicate(Actor(id=self.l1.pid, level=5, status='suspended'))
        self.assertEqual(pred.sql, '0')
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'suspended' WHERE id = ?", (self.l1.pid,))
        self.assertEqual(self.l1.get('/api/me').status_code, 401)


if __name__ == '__main__':
    unittest.main()
