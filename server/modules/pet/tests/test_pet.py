from collections import defaultdict
from unittest.mock import patch

from app import clock, discovery, outbox
from app.authz import Actor
from app.errors import ApiError
from modules.pet import service
from tests.helpers import AppCase, HDRS


class PetCase(AppCase):
    def setUp(self):
        # Another R13 lane currently exposes /api/tools.json from module tools,
        # which fails the frozen module-prefix gate before any PET test can run.
        # Keep this focused suite isolated; the unfiltered full suite is still
        # run and reported separately.
        real_discover = discovery.discover
        with patch('app.discovery.discover',
                   side_effect=lambda package: [m for m in real_discover(package) if m.name != 'tools']):
            super().setUp()
        self.db.conn().execute("UPDATE feature_flag SET enabled = 1 WHERE key = 'pet.game'")
        self.friend_map = defaultdict(list)
        self.blocked_pairs = set()
        patches = [
            patch.object(service.social, 'mutual', side_effect=self._mutual),
            patch.object(service.social, 'friend_ids', side_effect=self._friends),
            patch.object(service.social, 'blocked', side_effect=self._blocked),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def _mutual(self, conn, left, right):
        return right in self.friend_map[left] and left in self.friend_map[right]

    def _friends(self, conn, principal_id):
        return list(self.friend_map[principal_id])

    def _blocked(self, conn, left, right):
        return frozenset((left, right)) in self.blocked_pairs

    def befriend(self, *clients):
        for left in clients:
            self.friend_map[left.pid] = [right.pid for right in clients if right.pid != left.pid]

    def post(self, client, path, body=None, key='pet-test-key'):
        if len(key) < 8:
            key = f'pet-{key}'
        return client.post(path, headers={**HDRS, 'Idempotency-Key': key}, json=body)

    def adopt(self, client, name='团团', palette='brand-blue', key=None):
        response = self.post(client, '/api/pet/adopt', {'name': name, 'palette': palette},
                             key or f'adopt-{client.pid}')
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['data']

    def bamboo(self, client, amount=100, key='seed'):
        with self.db.write() as conn:
            return service.eco.credit(conn, client.pid, 'bamboo', amount, 'games.reward',
                                      f'{key}:{client.pid}')


class TestPet(PetCase):
    def test_new_member_can_open_the_home_before_adopting(self):
        client = self.user('newcomer')
        for path in ('/api/pet/me', '/api/pet/friends', '/api/pet/diary'):
            response = client.get(path)
            self.assertEqual(response.status_code, 200, path + ' ' + response.text)
        self.assertIsNone(client.get('/api/pet/me').json()['data']['pet'])
        self.assertEqual(client.get('/api/pet/diary').json()['data'], [])

    def test_adopt_name_palette_and_governance_character_gate(self):
        member = self.user('petowner')
        missing_key = member.post('/api/pet/adopt', headers=HDRS,
                                  json={'name': '团团', 'palette': 'brand-blue'})
        self.assertEqual(missing_key.status_code, 428)
        data = self.adopt(member)
        self.assertEqual((data['pet']['name'], data['pet']['stage_label']), ('团团', '幼崽'))
        self.assertTrue(data['pet']['asset_path'].endswith('panda-avatar-brand-blue-512.webp'))
        bad = self.post(self.user('badname'), '/api/pet/adopt', {'name': '加我@123', 'palette': 'classic'},
                        'adopt-bad-name')
        self.assertEqual(bad.status_code, 422)

    def test_feed_daily_limit_and_idempotency_never_double_debits(self):
        member = self.user('feeder')
        self.adopt(member)
        self.bamboo(member)
        first = self.post(member, '/api/pet/feed', {}, 'feed-same')
        second = self.post(member, '/api/pet/feed', {}, 'feed-same')
        self.assertEqual((first.status_code, second.status_code), (200, 200))
        self.assertEqual(second.headers.get('Idempotent-Replayed'), 'true')
        with self.db.read() as conn:
            self.assertEqual(service.eco.balance(conn, member.pid, 'bamboo'), 95)
            self.assertEqual(conn.execute("SELECT count(*) FROM pet_action WHERE kind = 'feed'").fetchone()[0], 1)
        for index in range(1, service.DAILY_FEEDS):
            self.assertEqual(self.post(member, '/api/pet/feed', {}, f'feed-{index}').status_code, 200)
        limited = self.post(member, '/api/pet/feed', {}, 'feed-too-many')
        self.assertEqual((limited.status_code, self.code(limited)), (429, 'pet_feed_limit'))

    def test_sleeping_is_a_floor_not_death(self):
        member = self.user('sleepy')
        self.adopt(member)
        base = clock.now_ts()
        with self.db.write() as conn:
            conn.execute('UPDATE pet_profile SET fullness = 1, mood = 1, affinity = 1, state_at = ? WHERE owner_id = ?',
                         (clock.iso(base), member.pid))
        with patch('app.clock.now_ts', return_value=base + 48 * 3600):
            pet = member.get('/api/pet/me').json()['data']['pet']
        self.assertEqual((pet['fullness'], pet['mood'], pet['affinity']), (0, 0, 0))
        self.assertTrue(pet['sleeping'])
        with self.db.read() as conn:
            self.assertIsNotNone(conn.execute('SELECT 1 FROM pet_profile WHERE owner_id = ?', (member.pid,)).fetchone())

    def test_growth_rewards_each_stage_only_once(self):
        member = self.user('grower')
        self.adopt(member)
        with self.db.write() as conn:
            conn.execute('UPDATE pet_profile SET affinity_total = 39 WHERE owner_id = ?', (member.pid,))
            service._boost(conn, member.pid, affinity=2, total=2)
            once = service.eco.balance(conn, member.pid, 'bamboo')
            service._grow(conn, member.pid)
            twice = service.eco.balance(conn, member.pid, 'bamboo')
            row = conn.execute('SELECT stage FROM pet_profile WHERE owner_id = ?', (member.pid,)).fetchone()
        self.assertEqual((row['stage'], once, twice), (1, service.STAGES[1]['reward'], once))

    def test_visit_requires_friend_hides_blocked_and_caps_five_homes(self):
        visitor = self.user('visitor')
        hosts = [self.user(f'host{index}') for index in range(6)]
        self.adopt(visitor)
        for host in hosts:
            self.adopt(host)
        denied = self.post(visitor, '/api/pet/visit', {'handle': 'host0'}, 'visit-denied')
        self.assertEqual((denied.status_code, self.code(denied)), (403, 'pet_not_friend'))
        self.befriend(visitor, *hosts)
        self.blocked_pairs.add(frozenset((visitor.pid, hosts[0].pid)))
        hidden = visitor.get('/api/pet/host0')
        self.assertEqual(hidden.status_code, 404)
        self.assertNotIn('host0', [row['owner']['handle'] for row in visitor.get('/api/pet/friends').json()['data']])
        self.blocked_pairs.clear()
        for index, host in enumerate(hosts[:5]):
            result = self.post(visitor, '/api/pet/visit', {'handle': f'host{index}'}, f'visit-{index}')
            self.assertEqual(result.status_code, 200, result.text)
        limited = self.post(visitor, '/api/pet/visit', {'handle': 'host5'}, 'visit-six')
        self.assertEqual((limited.status_code, self.code(limited)), (429, 'pet_visit_limit'))

    def test_agent_is_refused_at_service_layer(self):
        member = self.user('humanowner')
        self.adopt(member)
        agent = Actor(id=member.pid, level=1, status='active', kind='agent')
        with self.db.write() as conn:
            with self.assertRaisesRegex(ApiError, 'pet_agent_action'):
                service.care(conn, agent, 'pat', 'agent-pat')

    def test_community_events_are_private_idempotent_and_use_real_names(self):
        member = self.user('helper')
        self.adopt(member)
        event = {
            'id': 'award-event', 'event_type': 'bounty.awarded', 'aggregate_id': 'award-1',
            'occurred_at': clock.now(), 'payload': {'recipient_id': member.pid, 'answer_id': 'answer-1'},
        }
        with self.db.write() as conn:
            service.on_bounty_awarded(conn, event)
            service.on_bounty_awarded(conn, event)
            pet = conn.execute('SELECT affinity_total FROM pet_profile WHERE owner_id = ?', (member.pid,)).fetchone()
            rows = conn.execute("SELECT entry FROM pet_diary WHERE event_key = 'event:award-event'").fetchall()
        self.assertEqual(pet['affinity_total'], 16)
        self.assertEqual(len(rows), 1)
        self.assertIn('问题库帮了别人', rows[0]['entry'])
        self.assertNotIn('answer-1', rows[0]['entry'])

    def test_purger_removes_pet_owned_state(self):
        member = self.user('petpurge')
        self.adopt(member)
        with self.db.write() as conn:
            from modules.pet import hooks
            hooks.purge(conn, member.pid)
            self.assertIsNone(conn.execute('SELECT 1 FROM pet_profile WHERE owner_id = ?', (member.pid,)).fetchone())


if __name__ == '__main__':
    import unittest
    unittest.main()
