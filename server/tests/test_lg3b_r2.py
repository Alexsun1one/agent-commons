"""LG-3B R2 public profile scope, cursor and withdrawal contracts."""
import json
from pathlib import Path

from tests.helpers import AppCase, HDRS, PASSWORD


class LG3BR2(AppCase):
    def register(self, client, handle, code=None, password=PASSWORD):
        # The frozen shared helper predates the R2 server-side 18+ requirement.
        return client.post('/api/auth/register', headers=HDRS, json={
            'invite_code': code or self.invite(), 'handle': handle, 'password': password,
            'display_name': handle, 'adult_confirmed': True})

    def setUp(self):
        super().setUp()
        self.viewer = self.user('r2_viewer', level=3)
        self.db.conn().execute("UPDATE feature_flag SET enabled = 1 WHERE key = 'social.enabled'")

    def listing(self, client=None, **params):
        response = (client or self.viewer).get('/api/social/profiles', params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_public_profiles_list_detail_share_status_and_block_scope(self):
        allowed = self.user('r2_allowed')
        outgoing = self.user('r2_outgoing')
        incoming = self.user('r2_incoming')
        deleted = self.user('r2_deleted')
        pending = self.user('r2_pending')
        suspended = self.user('r2_suspended')
        admin = self.user('r2_admin', level=5, roles=('admin',), totp=True)
        self.assertEqual(self.viewer.put('/api/social/blocks/r2_outgoing', headers=HDRS).status_code, 200)
        self.assertEqual(incoming.put('/api/social/blocks/r2_viewer', headers=HDRS).status_code, 200)
        conn = self.db.conn()
        for client, status in ((deleted, 'deleted'), (pending, 'pending_deletion'), (suspended, 'suspended')):
            conn.execute('UPDATE principal SET status = ? WHERE id = ?', (status, client.pid))
        expected = {'r2_admin', 'r2_allowed', 'r2_viewer'}
        items = self.listing()['data']['items']
        self.assertEqual({i['handle'] for i in items}, expected)
        for handle in expected:
            response = self.viewer.get('/api/social/profiles/' + handle)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['data'], next(i for i in items if i['handle'] == handle))
        for handle in ('r2_outgoing', 'r2_incoming', 'r2_deleted', 'r2_pending', 'r2_suspended', 'missing'):
            response = self.viewer.get('/api/social/profiles/' + handle)
            self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(self.code(response), 'resource_not_found')
        # Blocked profiles are absent in either direction, even for a high-level viewer.
        self.assertEqual(admin.put('/api/social/blocks/r2_allowed', headers=HDRS).status_code, 200)
        self.assertNotIn(allowed.pid, {i['id'] for i in self.listing(admin)['data']['items']})
        self.assertEqual(admin.get('/api/social/profiles/r2_allowed').status_code, 404)
        for item in items:
            self.assertEqual(set(item), {'id', 'handle', 'display_name', 'level', 'avatar'})
        # Relationship management still permits the blocker to find the unblock action.
        relation = self.viewer.get('/api/social/people/r2_outgoing').json()['data']
        self.assertTrue(relation['relation']['blocked'])
        self.assertNotIn('counts', relation)

    def test_cursor_is_stable_bound_to_viewer_and_filters_before_limit(self):
        for handle in ('a_public', 'b_blocked', 'c_public', 'd_public'):
            self.user(handle)
        self.viewer.put('/api/social/blocks/b_blocked', headers=HDRS)
        result, cursor = [], None
        while True:
            page = self.listing(limit=1, cursor=cursor)
            result.extend(page['data']['items'])
            cursor = page['meta']['cursor']
            if not cursor:
                break
            self.assertEqual(len(page['data']['items']), 1)
        self.assertEqual([i['handle'] for i in result], ['a_public', 'c_public', 'd_public', 'r2_viewer'])
        self.assertEqual(len({i['id'] for i in result}), len(result))
        first = self.listing(limit=1)
        cursor = first['meta']['cursor']
        other = self.user('r2_other')
        response = other.get('/api/social/profiles', params={'cursor': cursor})
        self.assertEqual(self.code(response), 'cursor_stale')
        response = self.viewer.get('/api/social/profiles', params={'cursor': 'invalid'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.viewer.get('/api/social/profiles?limit=51').status_code, 422)
        # Revocation between pages is evaluated by the current predicate.
        self.viewer.put('/api/social/blocks/c_public', headers=HDRS)
        remaining = self.listing(cursor=cursor)['data']['items']
        self.assertNotIn('c_public', {i['handle'] for i in remaining})

    def test_profiles_require_session_and_feature(self):
        anonymous = self.client()
        for path in ('/api/social/profiles', '/api/social/profiles/r2_viewer'):
            self.assertEqual(anonymous.get(path).status_code, 401)
        self.db.conn().execute("UPDATE feature_flag SET enabled = 0 WHERE key = 'social.enabled'")
        for path in ('/api/social/profiles', '/api/social/profiles/r2_viewer'):
            self.assertEqual(self.viewer.get(path).status_code, 501)

    def test_social_withdrawal_records_current_version_and_short_reason(self):
        created = self.viewer.post('/api/social/posts', headers={**HDRS, 'Idempotency-Key': 'lg3b-r2-withdraw'},
                                   json={'body': 'private body must never enter withdrawal log'})
        self.assertEqual(created.status_code, 201, created.text)
        post_id = created.json()['data']['id']
        version = self.db.conn().execute('SELECT current_version FROM object_head WHERE id = ?', (post_id,)).fetchone()[0]
        response = self.viewer.delete('/api/social/posts/' + post_id, headers=HDRS)
        self.assertEqual(response.status_code, 200, response.text)
        raw = Path(self.settings.withdrawal_log).read_text()
        row = json.loads(raw.splitlines()[-1])
        self.assertEqual(row['version'], version)
        self.assertEqual(row['reason'], 'author')
        self.assertNotIn('private body', raw)
