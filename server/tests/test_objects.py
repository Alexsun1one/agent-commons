import sqlite3
import unittest

from tests.helpers import HDRS, AppCase


class ObjectTest(AppCase):
    def setUp(self):
        super().setUp()
        self.w = self.user('writer', level=2)

    def test_create_get_patch_versions(self):
        item = self.obj(self.w, type='knowledge', title='第一版', content={'body': '内容一', 'tags': ['模型']})
        self.assertEqual((item['version'], item['etag']), (1, '"v1-p1"'))
        r = self.w.get(f"/api/objects/{item['id']}")
        self.assertEqual(r.headers['etag'], item['etag'])
        url = f"/api/objects/{item['id']}"
        r = self.w.patch(url, headers=HDRS, json={'title': '第二版'})
        self.assertEqual((r.status_code, self.code(r)), (428, 'precondition_required'))
        r = self.w.patch(url, headers={**HDRS, 'If-Match': '"v9-p1"'}, json={'title': '第二版'})
        self.assertEqual((r.status_code, self.code(r)), (412, 'version_conflict'))
        r = self.w.patch(url, headers={**HDRS, 'If-Match': item['etag']}, json={'title': '第二版'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()['data']['version'], r.headers['etag']), (2, '"v2-p1"'))
        r = self.w.patch(url, headers={**HDRS, 'If-Match': item['etag']}, json={'title': '第三版'})
        self.assertEqual(r.status_code, 412)
        old = self.w.get(url, params={'version': 1}).json()['data']
        self.assertEqual((old['title'], old['content']['body']), ('第一版', '内容一'))
        self.assertEqual(self.w.get(url, params={'version': 7}).status_code, 404)

    def test_state_conflicts_409(self):
        draft = self.obj(self.w, lifecycle='draft')
        r = self.obj(self.w, status=409, type='reply', root_id=draft['id'])
        self.assertEqual(r['error']['code'], 'state_conflict')
        with self.db.write() as conn:
            conn.execute("UPDATE object_head SET lifecycle = 'hidden' WHERE id = ?", (draft['id'],))
        r = self.w.patch(f"/api/objects/{draft['id']}", headers={**HDRS, 'If-Match': '"v1-p1"'},
                         json={'lifecycle': 'active'})
        self.assertEqual((r.status_code, self.code(r)), (409, 'state_conflict'))

    def test_publish_draft(self):
        draft = self.obj(self.w, lifecycle='draft')
        r = self.w.patch(f"/api/objects/{draft['id']}", headers={**HDRS, 'If-Match': draft['etag']},
                         json={'lifecycle': 'active'})
        self.assertEqual((r.json()['data']['lifecycle'], r.json()['data']['etag']), ('active', '"v1-p2"'))
        self.assertTrue(r.json()['data']['published_at'])

    def test_idempotent_create(self):
        headers = {**HDRS, 'Idempotency-Key': 'create-0001-abcdef'}
        body = {'type': 'discussion', 'title': '只建一次', 'content': {'body': 'x'}}
        a = self.w.post('/api/objects', headers=headers, json=body)
        b = self.w.post('/api/objects', headers=headers, json=body)
        self.assertEqual((a.status_code, b.status_code), (201, 201))
        self.assertEqual(a.json()['data']['id'], b.json()['data']['id'])
        self.assertEqual(b.headers.get('idempotent-replayed'), 'true')
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM object_head').fetchone()[0], 1)
        c = self.w.post('/api/objects', headers=headers, json={**body, 'title': '换了内容'})
        self.assertEqual((c.status_code, self.code(c)), (409, 'idempotency_conflict'))
        other = self.user('other')
        d = other.post('/api/objects', headers=headers, json=body)
        self.assertNotEqual(d.json()['data']['id'], a.json()['data']['id'])
        bad = self.w.post('/api/objects', headers={**HDRS, 'Idempotency-Key': 'short'}, json=body)
        self.assertEqual(self.code(bad), 'malformed_request')

    def test_idempotent_patch_replay(self):
        item = self.obj(self.w)
        headers = {**HDRS, 'If-Match': item['etag'], 'Idempotency-Key': 'patch-0001-abcdef'}
        a = self.w.patch(f"/api/objects/{item['id']}", headers=headers, json={'title': '改一次'})
        b = self.w.patch(f"/api/objects/{item['id']}", headers=headers, json={'title': '改一次'})
        self.assertEqual((a.status_code, b.status_code), (200, 200))
        self.assertEqual(a.json(), b.json())
        self.assertEqual(b.headers['etag'], '"v2-p1"')

    def test_action_rules_by_level(self):
        l1 = self.user('newbie', level=1)
        r = self.obj(l1, status=403, type='knowledge')
        self.assertEqual(r['error']['code'], 'action_not_allowed')
        self.obj(l1, type='discussion')
        self.obj(self.w, type='knowledge')
        r = self.obj(self.w, status=422, type='spaceship')
        self.assertEqual(r['error']['code'], 'validation_failed')
        r = self.obj(self.w, status=422, content={'body': 'x', 'html': '<b>'})
        self.assertEqual(r['error']['code'], 'unknown_field')

    def test_rule_rows_are_data(self):
        l1 = self.user('newbie', level=1)
        with self.db.write() as conn:
            conn.execute("UPDATE action_rule SET min_level = 1 WHERE action = 'object.create.knowledge'")
        self.obj(l1, type='knowledge')

    def test_flag_off_returns_501(self):
        admin = self.user('root', roles=['admin'], totp=True)
        r = admin.post('/api/admin/flags', headers=HDRS, json={'key': 'core.objects', 'enabled': False})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(self.client().get('/api/flags').json()['data']['core.objects'])
        r = self.obj(self.w, status=501)
        self.assertEqual(r['error']['code'], 'capability_unavailable')
        r = admin.post('/api/admin/flags', headers=HDRS, json={'key': 'nope', 'enabled': True})
        self.assertEqual(r.status_code, 404)

    def test_versions_immutable(self):
        self.obj(self.w)
        with self.assertRaises(sqlite3.DatabaseError):
            with self.db.write() as conn:
                conn.execute("UPDATE object_version SET title = 'tampered'")

    def test_replies_follow_root(self):
        root = self.obj(self.w, title='原帖')
        reader = self.user('reader')
        reply = self.obj(reader, type='reply', title='回复', root_id=root['id'])
        self.assertEqual((reply['root_id'], reply['visibility']), (root['id'], 'members'))
        nested = self.obj(reader, type='reply', title='楼中楼', root_id=reply['id'])
        self.assertEqual(nested['root_id'], root['id'])
        r = self.w.get('/api/objects', params={'root_id': root['id'], 'order': 'old', 'count': 1})
        self.assertEqual([i['title'] for i in r.json()['data']], ['回复', '楼中楼'])
        r = reader.patch(f"/api/objects/{reply['id']}", headers={**HDRS, 'If-Match': reply['etag']},
                         json={'visibility': 'level', 'min_level': 3})
        self.assertEqual(self.code(r), 'validation_failed')

    def test_withdraw_idempotent_and_logged(self):
        item = self.obj(self.w)
        url = f"/api/objects/{item['id']}/withdraw"
        r = self.w.post(url, headers={**HDRS, 'If-Match': '"v5-p5"'}, json={})
        self.assertEqual(r.status_code, 412)
        headers = {**HDRS, 'Idempotency-Key': 'withdraw-000001'}
        a = self.w.post(url, headers=headers, json={'reason_code': 'author_request'})
        b = self.w.post(url, headers=headers, json={'reason_code': 'author_request'})
        self.assertEqual((a.status_code, b.status_code), (200, 200))
        self.assertEqual(a.json()['data'], b.json()['data'])
        with open(self.settings.withdrawal_log) as f:
            self.assertEqual(len(f.read().splitlines()), 1)
        self.assertEqual(self.w.post(url, headers=HDRS, json={}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
