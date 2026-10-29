"""Object x visitor x API matrix for LG-3B; no listening socket or real data."""
import uuid
import json

from app import clock
from app.authz import Actor
from modules.bounty.tests import test_bounty as bounty_cases
from modules.events.tests import test_events as event_cases
from modules.market.tests import test_market as market_cases
from modules.orgs.tests import test_orgs as org_cases
from modules.rooms.tests import test_rooms as room_cases
from tests.helpers import AppCase, HDRS


class LG3BPermissions(AppCase):
    def setUp(self):
        super().setUp()
        self.owner = self.user('lg3b_host', level=3)
        self.allowed = self.user('lg3b_allowed', level=3)
        self.denied = self.user('lg3b_denied', level=1)
        self.admin = self.user('lg3b_admin', level=5, roles=('admin',), totp=True)
        self.db.conn().execute("UPDATE feature_flag SET enabled = 1 WHERE key IN ('bounty.enabled', 'rooms.enabled')")

    def actor(self, client, level=3):
        return Actor(id=client.pid, level=level, status='active')

    def post(self, client, path, body=None, status=200):
        response = client.post(path, headers={**HDRS, 'Idempotency-Key': str(uuid.uuid4())}, json=body or {})
        self.assertEqual(response.status_code, status, response.text)
        return response.json()['data']

    def named(self, object_id):
        conn = self.db.conn()
        conn.execute("UPDATE object_head SET visibility = 'named' WHERE id = ?", (object_id,))
        conn.execute('INSERT INTO object_acl(object_id, principal_id, granted_by, granted_at) VALUES (?, ?, ?, ?)', (object_id, self.allowed.pid, self.owner.pid, clock.now()))

    def test_market_list_search_count_detail_share_named_scope(self):
        item = market_cases.MarketCase.listing(self, self.owner, title='lg3b private market')
        self.named(item['id'])
        for client, visible in ((self.owner, True), (self.allowed, True), (self.denied, False), (self.admin, False)):
            with self.subTest(object='market', visitor=client.pid):
                detail = client.get('/api/market/listings/' + item['id'])
                self.assertEqual(detail.status_code, 200 if visible else 404, detail.text)
                for path in ('/api/market/listings', '/api/market/listings?q=lg3b'):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual([r['id'] for r in response.json()['data']], [item['id']] if visible else [])
                    self.assertEqual(response.json()['meta']['count'], int(visible))

    def test_bounty_named_scope_and_answer_counts_follow_answer_visibility(self):
        root = self.obj(self.owner, title='lg3b bounty parent')
        bounty = bounty_cases.BountyCase.create(self, self.owner, root['id'], credits=10)
        answer = self.obj(self.allowed, type='reply', title='hidden answer', root_id=root['id'])
        conn = self.db.conn()
        conn.execute("UPDATE object_head SET visibility = 'named' WHERE id = ?", (answer['id'],))
        conn.execute('INSERT INTO bounty_award(id, bounty_id, kind, mode, answer_id, payer_id, recipient_id, '
                     'share_pct, credits, season, pair_counted, flagged, created_at) '
                     "VALUES (?, ?, 'help', 'owner', ?, ?, ?, 100, 1, 'test', 1, 0, ?)",
                     (str(uuid.uuid4()), bounty['id'], answer['id'], self.owner.pid, self.allowed.pid, clock.now()))
        for client, count in ((self.owner, 0), (self.allowed, 1), (self.denied, 0), (self.admin, 0)):
            with self.subTest(visitor=client.pid, api='answer-count'):
                data = client.get('/api/bounty/' + bounty['id']).json()['data']
                self.assertEqual(data['answer_count'], count)
                self.assertEqual(len(data['awards']), count)
                self.assertEqual(bool(data['useful']), bool(count))
                listed = client.get('/api/bounty/list').json()['data']
                self.assertEqual(listed[0]['answer_count'], count)
        self.named(root['id'])
        for client, visible in ((self.owner, True), (self.allowed, True), (self.denied, False), (self.admin, False)):
            with self.subTest(object='bounty', visitor=client.pid):
                self.assertEqual(client.get('/api/bounty/' + bounty['id']).status_code, 200 if visible else 404)
                response = client.get('/api/bounty/list')
                self.assertEqual([r['id'] for r in response.json()['data']], [bounty['id']] if visible else [])

    def test_social_private_detail_feed_new_count_and_reactions(self):
        item = self.post(self.owner, '/api/social/posts', {'body': 'private social', 'scope': 'private'}, 201)
        for client, visible in ((self.owner, True), (self.allowed, False), (self.denied, False), (self.admin, False)):
            with self.subTest(object='social', visitor=client.pid):
                for suffix in ('', '/reactions'):
                    self.assertEqual(client.get('/api/social/posts/' + item['id'] + suffix).status_code,
                                     200 if visible else 404)
                items = client.get('/api/social/feed').json()['data']['items']
                self.assertEqual([r['id'] for r in items], [item['id']] if visible else [])
                response = client.get('/api/social/feed/new-count', params={'since': '2000-01-01T00:00:00.000000Z'})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['data']['count'], 0)  # Own posts are excluded from new-count.

    def test_events_named_detail_list_calendar_and_subresources(self):
        item = event_cases.EventsTest.make(self, self.admin, visibility='named', acl=[self.allowed.pid])
        for client, visible in ((self.admin, True), (self.allowed, True), (self.owner, False), (self.denied, False)):
            with self.subTest(object='event', visitor=client.pid):
                for suffix in ('', '/signups', '/submissions'):
                    self.assertEqual(client.get('/api/events/' + item['id'] + suffix).status_code, 200 if visible else 404)
                listed = client.get('/api/events').json()['data']
                self.assertEqual([r['id'] for r in listed], [item['id']] if visible else [])
                # Service calendar uses the same predicate as list/detail, before grouping.
                from modules.events import service
                data = service.calendar_events(self.db.conn(), self.actor(client),
                                               clock.iso(clock.now_ts() - 86400), clock.iso(clock.now_ts() + 4 * 86400))
                self.assertEqual(item['id'] in str(data), visible)

    def room(self):
        return room_cases.RoomCase.room(self, self.owner, provider='external_link',
                                       external_url='https://meeting.tencent.com/dm/test',
                                       access=[{'kind': 'level', 'min_level': 3}])

    def test_rooms_list_detail_and_removed_member_use_one_predicate(self):
        room = self.room()
        for client, visible in ((self.owner, True), (self.allowed, True), (self.denied, False), (self.admin, True)):
            with self.subTest(object='room', visitor=client.pid):
                self.assertEqual(client.get('/api/rooms/' + room['id']).status_code, 200 if visible else 404)
                listed = client.get('/api/rooms?state=scheduled').json()['data']
                self.assertEqual(room['id'] in [r['id'] for r in listed], visible)
        stamp = clock.now()
        self.db.conn().execute('INSERT INTO room_participant(room_id, principal_id, role, joined_at, removed_at, updated_at) '
                               "VALUES (?, ?, 'listener', ?, ?, ?)", (room['id'], self.allowed.pid, stamp, stamp, stamp))
        hidden = self.allowed.get('/api/rooms/' + room['id'])
        absent = self.allowed.get('/api/rooms/' + str(uuid.uuid4()))
        self.assertEqual((hidden.status_code, self.code(hidden)), (404, 'resource_not_found'))
        self.assertEqual(self.code(hidden), self.code(absent))
        self.assertEqual(self.allowed.post('/api/rooms/' + room['id'] + '/join', headers=HDRS).status_code, 404)
        self.assertEqual(self.allowed.get('/api/rooms?state=scheduled').json()['data'], [])

    def test_org_activity_counts_only_visible_attached_objects(self):
        org = org_cases.OrgsCase.make(self, self.owner)
        conn = self.db.conn()
        conn.execute("UPDATE org SET status = 'approved' WHERE id = ?", (org['id'],))
        obj = self.obj(self.owner, type='work', title='private org work', visibility='named', acl=[self.allowed.pid])
        conn.execute('INSERT INTO org_object(org_id, object_id, kind, attached_by, created_at) VALUES (?, ?, ?, ?, ?)',
                     (org['id'], obj['id'], 'work', self.owner.pid, clock.now()))
        for client, count in ((self.owner, 1), (self.allowed, 1), (self.denied, 0), (self.admin, 0)):
            with self.subTest(object='org', visitor=client.pid):
                for path in ('/api/orgs', '/api/orgs?q=' + org['slug']):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 200, response.text)
                detail = client.get('/api/orgs/' + org['slug']).json()['data']
                self.assertEqual(detail['activity'], count)

    def test_rooms_purge_ends_owned_room_and_cleans_participation(self):
        room = self.room()
        conn = self.db.conn()
        stamp = clock.now()
        for client in (self.owner, self.allowed):
            conn.execute('INSERT INTO room_signup(room_id, principal_id, state, created_at) VALUES (?, ?, ?, ?)',
                         (room['id'], client.pid, 'approved', stamp))
            conn.execute('INSERT INTO room_recording_track_consent VALUES (?, ?, 1, ?, ?, 0, ?)',
                         (room['id'], client.pid, 'screen_track', 'granted', stamp))
        from modules.rooms import hooks
        conn.execute('UPDATE room_recording SET storage_key = ?, talk_id = ? WHERE room_id = ?',
                     ('recording/' + 'a' * 64, 'lg3b-talk', room['id']))
        # Clearing references must roll back with the account-deletion transaction.
        try:
            with self.db.write() as transaction:
                hooks.purge(transaction, self.owner.pid)
                raise RuntimeError('rollback probe')
        except RuntimeError:
            pass
        self.assertIsNotNone(conn.execute('SELECT storage_key FROM room_recording WHERE room_id = ?', (room['id'],)).fetchone()[0])
        hooks.purge(conn, self.owner.pid)
        hooks.purge(conn, self.owner.pid)
        self.assertEqual(conn.execute('SELECT state FROM room WHERE id = ?', (room['id'],)).fetchone()[0], 'ended')
        cleanup = conn.execute("SELECT payload_json FROM outbox_event WHERE event_type = 'rooms.storage_cleanup_requested'").fetchall()
        self.assertEqual(len(cleanup), 1)
        self.assertEqual(json.loads(cleanup[0][0])['keys'], ['recording/' + 'a' * 64])
        self.assertEqual(json.loads(cleanup[0][0])['talk_ids'], ['lg3b-talk'])
        for table in ('room_signup', 'room_recording_track_consent'):
            self.assertEqual(conn.execute(f'SELECT principal_id FROM {table}').fetchall()[0][0], self.allowed.pid)
        self.assertEqual(conn.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_bounty_purge_refunds_once_and_keeps_append_only_ledger(self):
        root = self.obj(self.owner)
        bounty = bounty_cases.BountyCase.create(self, self.owner, root['id'], credits=10)
        from modules.bounty import hooks, service
        conn = self.db.conn()
        held = service.balances(conn, self.owner.pid)
        self.assertEqual(held[1], 10)
        hooks.purge(conn, self.owner.pid)
        hooks.purge(conn, self.owner.pid)
        self.assertEqual(service.balances(conn, self.owner.pid), (held[0] + 10, 0))
        self.assertEqual(conn.execute('SELECT status FROM bounty WHERE id = ?', (bounty['id'],)).fetchone()[0], 'refunded')
        self.assertEqual(conn.execute("SELECT count(*) FROM credit_entry WHERE bounty_id = ? AND kind = 'refund'",
                                      (bounty['id'],)).fetchone()[0], 1)
        self.assertEqual(conn.execute('PRAGMA foreign_key_check').fetchall(), [])
