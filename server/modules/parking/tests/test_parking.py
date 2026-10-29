from collections import defaultdict
from unittest.mock import patch

from app import clock
from app.authz import Actor
from app.errors import ApiError
from modules.parking import service
from tests.helpers import AppCase, HDRS


class ParkingCase(AppCase):
    def setUp(self):
        super().setUp()
        self.db.conn().execute("UPDATE feature_flag SET enabled = 1 WHERE key = 'parking.game'")
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

    def car(self, client, index=0):
        data = client.get('/api/parking/me').json()['data']
        return data['vehicles'][index]

    def park(self, client, vehicle_id, owner, slot=1, message='给你留个脚印'):
        return client.post('/api/parking/park', headers=HDRS, json={
            'vehicle_id': vehicle_id, 'owner_handle': owner, 'slot_no': slot, 'message': message})


class TestParking(ParkingCase):
    def test_starter_lot_cars_expansion_and_rate_cap(self):
        member = self.user('starter')
        data = member.get('/api/parking/me').json()['data']
        self.assertEqual(len(data['spaces']), 4)
        self.assertEqual(len(data['vehicles']), 2)
        self.assertTrue(all(vehicle['hourly_rate'] <= service.MAX_RATE for vehicle in data['vehicles']))
        with self.db.write() as conn:
            self.assertEqual(service.expand_lot(conn, member.pid, 8), 8)
        self.assertEqual(len(member.get('/api/parking/me').json()['data']['spaces']), 8)

    def test_only_mutual_friends_and_never_own_lot(self):
        one, two = self.user('one'), self.user('two')
        vehicle_id = self.car(one)['vehicle_id']
        own = self.park(one, vehicle_id, 'one')
        self.assertEqual(own.status_code, 409)
        not_friend = self.park(one, vehicle_id, 'two')
        self.assertEqual(not_friend.status_code, 403)
        self.befriend(one, two)
        parked = self.park(one, vehicle_id, 'two')
        self.assertEqual(parked.status_code, 201, parked.text)
        busy = self.park(one, vehicle_id, 'two', 2)
        self.assertEqual(busy.status_code, 409)
        lot = two.get('/api/parking/two').json()['data']
        self.assertEqual(lot['spaces'][0]['vehicle']['message'], '给你留个脚印')

    def test_move_caps_at_twelve_hours_and_welcome_halves_income(self):
        parker, owner = self.user('parker'), self.user('owner')
        self.befriend(parker, owner)
        chosen = self.car(parker)
        vehicle = chosen['vehicle_id']
        base = clock.now_ts()
        with patch('app.clock.now_ts', return_value=base):
            owner.post('/api/parking/welcome', headers=HDRS, json={'slot_no': 1, 'enabled': True})
            self.assertEqual(self.park(parker, vehicle, 'owner').status_code, 201)
            owner.post('/api/parking/welcome', headers=HDRS, json={'slot_no': 1, 'enabled': False})
        with patch('app.clock.now_ts', return_value=base + 30 * 3600):
            protected = owner.post('/api/parking/ticket', headers=HDRS, json={'slot_no': 1})
            self.assertEqual(protected.status_code, 409)
            moved = parker.post('/api/parking/move', headers=HDRS, json={'vehicle_id': vehicle})
        data = moved.json()['data']
        self.assertEqual(data['hours'], 12)
        self.assertEqual(data['gross'], chosen['hourly_rate'] * 12)
        self.assertEqual(data['earned'], chosen['hourly_rate'] * 6)

    def test_ticket_waits_one_hour_splits_income_and_emits_events(self):
        parker, owner = self.user('driver'), self.user('host')
        self.befriend(parker, owner)
        chosen = self.car(parker)
        vehicle = chosen['vehicle_id']
        base = clock.now_ts()
        with patch('app.clock.now_ts', return_value=base):
            self.park(parker, vehicle, 'host')
        with patch('app.clock.now_ts', return_value=base + 3599):
            early = owner.post('/api/parking/ticket', headers=HDRS, json={'slot_no': 1})
        self.assertEqual(early.status_code, 409)
        with patch('app.clock.now_ts', return_value=base + 3600):
            result = owner.post('/api/parking/ticket', headers=HDRS, json={'slot_no': 1})
        self.assertEqual(result.status_code, 200, result.text)
        fine = chosen['hourly_rate'] // 2
        self.assertEqual(result.json()['data']['fine'], fine)
        with self.db.read() as conn:
            self.assertEqual(service.eco.balance(conn, parker.pid, 'bamboo'), chosen['hourly_rate'] - fine)
            self.assertEqual(service.eco.balance(conn, owner.pid, 'bamboo'), fine)
            events = [row[0] for row in conn.execute(
                "SELECT event_type FROM outbox_event WHERE event_type LIKE 'parking.%' ORDER BY occurred_at")]
        self.assertIn('parking.parked', events)
        self.assertIn('parking.ticketed', events)
        self.assertIsNone(owner.get('/api/parking/me').json()['data']['spaces'][0]['vehicle'])

    def test_ticket_daily_limit_and_agent_denial(self):
        parker, owner = self.user('repeat'), self.user('warden')
        self.befriend(parker, owner)
        vehicle = self.car(parker)['vehicle_id']
        base = int(clock.now_ts()) // 86400 * 86400 + 43200
        with self.db.write() as conn:
            service.ensure_player(conn, parker.pid)
            service.ensure_player(conn, owner.pid)
            for index in range(service.DAILY_TICKETS):
                conn.execute(
                    "INSERT INTO parking_stay (id, vehicle_id, lot_owner_id, slot_no, parked_at, ended_at, "
                    "end_reason, gross_earned, parker_share, owner_share) VALUES (?, ?, ?, 1, ?, ?, 'ticket', 8, 4, 4)",
                    (f'past-{index}', vehicle, owner.pid, clock.iso(base - 7200), clock.iso(base - 3600)))
        with patch('app.clock.now_ts', return_value=base):
            self.park(parker, vehicle, 'warden')
        with patch('app.clock.now_ts', return_value=base + 3600):
            limited = owner.post('/api/parking/ticket', headers=HDRS, json={'slot_no': 1})
        self.assertEqual(limited.status_code, 429)
        with self.db.write() as conn:
            actor = Actor(id=owner.pid, level=1, status='active', kind='agent')
            with self.assertRaisesRegex(ApiError, 'parking_agent_ticket'):
                service.ticket(conn, actor, 1)

    def test_blocked_members_are_invisible_and_absent_from_friends(self):
        one, two = self.user('visible'), self.user('hidden')
        self.befriend(one, two)
        self.blocked_pairs.add(frozenset((one.pid, two.pid)))
        hidden = one.get('/api/parking/hidden')
        self.assertEqual(hidden.status_code, 404)
        self.assertEqual(one.get('/api/parking/friends').json()['data'], [])

    def test_friends_expose_free_spaces_and_my_car_marker(self):
        me, here, other = self.user('mepark'), self.user('carhere'), self.user('otherlot')
        self.befriend(me, here, other)
        vehicle = self.car(me)['vehicle_id']
        self.park(me, vehicle, 'carhere')
        rows = me.get('/api/parking/friends').json()['data']
        self.assertEqual(rows[0]['handle'], 'carhere')
        self.assertTrue(rows[0]['my_car_here'])
        self.assertGreater(rows[0]['free_spaces'], 0)

