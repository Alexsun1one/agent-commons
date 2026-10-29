import types
from datetime import datetime, timezone
from unittest import mock

from app.authz import Actor
from tests.helpers import HDRS, AppCase

from modules.farm import service


NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc).timestamp()


class FakeEconomy:
    def __init__(self):
        self.balances = {}
        self.credit_cap = None

    def seed(self, *principal_ids):
        for principal_id in principal_ids:
            self.balances[principal_id] = 1000

    def balance(self, conn, principal_id, currency):
        return self.balances.get(principal_id, 0)

    def debit(self, conn, principal_id, currency, amount, reason, idempotency_key, ref=None):
        if self.balance(conn, principal_id, currency) < amount:
            from app.errors import ApiError
            raise ApiError('insufficient_funds')
        self.balances[principal_id] -= amount
        return amount

    def credit(self, conn, principal_id, currency, amount, reason, idempotency_key, ref=None):
        actual = min(amount, self.credit_cap) if self.credit_cap is not None else amount
        self.balances[principal_id] = self.balance(conn, principal_id, currency) + actual
        return actual

    def transfer_game(self, conn, source_id, target_id, currency, amount, reason, idempotency_key, ref=None):
        self.debit(conn, source_id, currency, amount, reason, idempotency_key, ref)
        self.credit(conn, target_id, currency, amount, reason, idempotency_key + ':credit', ref)
        return amount


class FarmCase(AppCase):
    def setUp(self):
        self.now = NOW
        clock_patch = mock.patch('app.clock.now_ts', side_effect=lambda: self.now)
        clock_patch.start()
        self.addCleanup(clock_patch.stop)
        self.economy = FakeEconomy()
        eco_patch = mock.patch('modules.farm.service._economy', return_value=self.economy)
        eco_patch.start()
        self.addCleanup(eco_patch.stop)
        super().setUp()

    def people(self, *names):
        clients = [self.user(name) for name in names]
        self.economy.seed(*(client.pid for client in clients))
        return clients

    def friend(self, left, right):
        with self.db.write() as conn:
            now = '2026-10-25T12:00:00.000000Z'
            conn.execute('INSERT INTO social_follow (follower_id, followee_id, created_at) VALUES (?, ?, ?)',
                         (left.pid, right.pid, now))
            conn.execute('INSERT INTO social_follow (follower_id, followee_id, created_at) VALUES (?, ?, ?)',
                         (right.pid, left.pid, now))

    def plant(self, client, index=1, crop='token_tomato'):
        response = client.post(f'/api/farm/plots/{index}/plant', headers=HDRS, json={'crop': crop})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']


class GrowthAndHelpTest(FarmCase):
    def test_initial_six_plots_and_server_clock(self):
        (owner,) = self.people('clock_owner')
        data = owner.get('/api/farm/me').json()['data']
        self.assertEqual((data['plotCount'], len(data['plots'])), (6, 12))
        planted = self.plant(owner)
        self.assertEqual((planted['stage'], planted['secondsRemaining']), (0, 1800))
        self.now += 1800
        mature = owner.get('/api/farm/me').json()['data']['plots'][0]
        self.assertEqual((mature['state'], mature['stageLabel']), ('mature', '可收获'))

    def test_friend_help_speeds_five_percent_and_has_daily_cap(self):
        owner, helper = self.people('help_owner', 'helper')
        self.friend(owner, helper)
        self.plant(owner)
        self.plant(owner, index=2, crop='prompt_greens')
        before = owner.get('/api/farm/me').json()['data']['plots'][0]['secondsRemaining']
        helped = helper.post('/api/farm/plots/1/water', headers=HDRS, json={'handle': 'help_owner'})
        self.assertEqual(helped.status_code, 200, helped.text)
        after = helped.json()['data']['secondsRemaining']
        self.assertEqual(before - after, 90)
        with self.db.write() as conn:
            for index in range(service.HELP_DAILY_LIMIT - 1):
                conn.execute('INSERT INTO farm_help_log '
                             '(id, cycle_id, plot_owner_id, plot_index, helper_id, action, day, created_at) '
                             'VALUES (?, ?, ?, 1, ?, ?, ?, ?)',
                             (f'h{index}', f'cycle-{index}', owner.pid, helper.pid,
                              'water' if index % 2 == 0 else 'weed', '2026-10-25', '2026-10-25T12:00:00.000000Z'))
        limited = helper.post('/api/farm/plots/2/water', headers=HDRS, json={'handle': 'help_owner'})
        self.assertEqual((limited.status_code, limited.json()['error']['code']), (429, 'rate_limited'))


class StealRulesTest(FarmCase):
    def mature(self, owner, index=1, crop='token_tomato'):
        self.plant(owner, index, crop)
        self.now += 86400

    def test_two_steals_once_each_and_owner_keeps_at_least_seventy_percent(self):
        owner, first, second, third = self.people('crop_owner', 'first_thief', 'second_thief', 'third_thief')
        for thief in (first, second, third):
            self.friend(owner, thief)
        self.mature(owner)
        for thief in (first, second):
            response = thief.post('/api/farm/plots/1/steal', headers=HDRS, json={'handle': 'crop_owner'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()['data']['stolen'])
        blocked = third.post('/api/farm/plots/1/steal', headers=HDRS, json={'handle': 'crop_owner'})
        self.assertEqual((blocked.status_code, blocked.json()['error']['code']), (409, 'state_conflict'))
        plot = owner.get('/api/farm/me').json()['data']['plots'][0]
        self.assertGreaterEqual(plot['remainingPercent'], 70)
        repeat = first.post('/api/farm/plots/1/steal', headers=HDRS, json={'handle': 'crop_owner'})
        self.assertEqual((repeat.status_code, repeat.json()['error']['code']), (409, 'state_conflict'))

    def test_daily_twenty_limit(self):
        owner, thief = self.people('daily_owner', 'daily_thief')
        self.friend(owner, thief)
        self.mature(owner)
        with self.db.write() as conn:
            for index in range(20):
                conn.execute('INSERT INTO farm_steal_log '
                             '(id, cycle_id, plot_owner_id, plot_index, thief_id, amount, day, created_at) '
                             'VALUES (?, ?, ?, 1, ?, 1, ?, ?)',
                             (f's{index}', f'old-{index}', owner.pid, thief.pid, '2026-10-26',
                              '2026-10-26T12:00:00.000000Z'))
        limited = thief.post('/api/farm/plots/1/steal', headers=HDRS, json={'handle': 'daily_owner'})
        self.assertEqual((limited.status_code, limited.json()['error']['code']), (429, 'rate_limited'))

    def test_watchdog_blocks_and_leaves_message(self):
        owner, thief = self.people('guard_owner', 'guard_thief')
        self.friend(owner, thief)
        self.mature(owner)
        enabled = owner.post('/api/farm/watchdog', headers=HDRS, json={'enabled': True})
        self.assertEqual(enabled.status_code, 200, enabled.text)
        blocked = thief.post('/api/farm/plots/1/steal', headers=HDRS, json={'handle': 'guard_owner'})
        self.assertEqual(blocked.status_code, 200, blocked.text)
        self.assertEqual((blocked.json()['data']['stolen'], blocked.json()['data']['guarded']), (False, True))
        board = owner.get('/api/farm/guard_owner/messages').json()['data']
        self.assertEqual((len(board), board[0]['kind']), (1, 'watchdog'))

    def test_blocked_invisible_and_agent_cannot_steal(self):
        owner, viewer = self.people('hidden_owner', 'viewer')
        self.friend(owner, viewer)
        with self.db.write() as conn:
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (owner.pid, viewer.pid, '2026-10-25T12:00:00.000000Z'))
        hidden = viewer.get('/api/farm/hidden_owner')
        self.assertEqual((hidden.status_code, hidden.json()['error']['code']), (404, 'resource_not_found'))
        agent = types.SimpleNamespace(id='agent-x', owner_id=viewer.pid, kind='agent')
        with self.db.write() as conn:
            with self.assertRaisesRegex(Exception, 'action_not_allowed'):
                service.steal(conn, agent, owner.pid, 1)


class HarvestAndFriendsTest(FarmCase):
    def test_harvest_credits_and_emits_events(self):
        (owner,) = self.people('harvester')
        start = self.economy.balance(None, owner.pid, 'bamboo')
        self.plant(owner)
        self.now += 1800
        harvested = owner.post('/api/farm/plots/1/harvest', headers=HDRS, json={})
        self.assertEqual(harvested.status_code, 200, harvested.text)
        self.assertEqual(harvested.json()['data']['bamboo'], 8)
        self.assertEqual(self.economy.balance(None, owner.pid, 'bamboo'), start - 3 + 8)
        events = {row[0] for row in self.db.conn().execute(
            "SELECT event_type FROM outbox_event WHERE event_type IN ('farm.harvested', 'achievement.progress')"
        ).fetchall()}
        self.assertEqual(events, {'farm.harvested', 'achievement.progress'})

    def test_harvest_reports_economy_actual_credit(self):
        (owner,) = self.people('capped_harvester')
        self.plant(owner)
        self.economy.credit_cap = 4
        self.now += 1800
        harvested = owner.post('/api/farm/plots/1/harvest', headers=HDRS, json={})
        self.assertEqual(harvested.status_code, 200, harvested.text)
        self.assertEqual(harvested.json()['data']['bamboo'], 4)

    def test_friends_sort_stealable_before_needs_help(self):
        me, ripe, thirsty = self.people('farm_me', 'ripe_friend', 'thirsty_friend')
        self.friend(me, ripe)
        self.friend(me, thirsty)
        self.plant(ripe)
        self.plant(thirsty)
        self.now += 1800
        friends = me.get('/api/farm/friends').json()['data']
        self.assertEqual(friends[0]['owner']['handle'], 'ripe_friend')
        self.assertGreater(friends[0]['stealable'], 0)


class AgentRuleTest(FarmCase):
    def test_agent_can_water_but_not_weed(self):
        owner, friend = self.people('agent_owner', 'agent_friend')
        self.friend(owner, friend)
        self.plant(friend)
        with self.db.write() as conn:
            conn.execute("INSERT INTO principal (id, kind, status, created_at) VALUES ('agent-water', 'agent', 'active', ?)",
                         (clock_value := '2026-10-25T12:00:00.000000Z',))
            agent = types.SimpleNamespace(id='agent-water', owner_id=owner.pid, kind='agent')
            watered = service.help_plot(conn, agent, friend.pid, 1, 'water')
            self.assertFalse(watered['needsWater'])
            with self.assertRaisesRegex(Exception, 'action_not_allowed'):
                service.help_plot(conn, agent, friend.pid, 1, 'weed')


if __name__ == '__main__':
    import unittest
    unittest.main()

