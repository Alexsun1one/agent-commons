"""LG-3B cross-module gates and data rights, using only disposable test fixtures."""
import json

from app import accounts, clock, outbox
from app.authz import Actor
from app.errors import ApiError
from modules.growth import engine
from modules.achievements import service as achievements
from tests.helpers import AppCase, HDRS

MODULES = 'social orgs rooms events market bounty dm notify growth achievements economy farm parking pet games membership billing'.split()


class LG3BContracts(AppCase):
    def actor(self, client, level=3):
        return Actor(id=client.pid, level=level, status='active')

    def flag(self, module, on=True):
        key = module + ('.game' if module in ('parking', 'pet') else '.enabled')
        self.assertEqual(self.db.conn().execute('UPDATE feature_flag SET enabled = ? WHERE key = ?', (int(on), key)).rowcount, 1)

    def test_all_17_modules_register_and_execute_exporters_and_purgers(self):
        member = self.user('lg3b_exporter', level=3)
        actor = self.actor(member)
        exporters = dict(accounts._exporters_for(self.db.conn()))
        purgers = accounts._purgers_for(self.db)
        for name in MODULES:
            with self.subTest(module=name):
                self.assertIn(name, exporters)
                json.dumps(exporters[name](self.db.conn(), actor))
                owned = [fn for fn in purgers if fn.__module__.startswith('modules.' + name + '.')]
                self.assertTrue(owned, name)
                for fn in owned:
                    with self.db.write() as conn:
                        fn(conn, member.pid)
                        fn(conn, member.pid)
        self.assertEqual(self.db.conn().execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_all_17_member_surfaces_respect_disabled_flags(self):
        member = self.user('lg3b_flags', level=3)
        paths = {
            'social': '/api/social/feed', 'orgs': '/api/orgs', 'rooms': '/api/rooms',
            'events': '/api/events', 'market': '/api/market/listings', 'bounty': '/api/bounty/list',
            'dm': '/api/dm/threads', 'notify': '/api/notify/unread-count', 'growth': '/api/growth/me',
            'achievements': '/api/achievements/me', 'economy': '/api/economy/me', 'farm': '/api/farm/me',
            'parking': '/api/parking/me', 'pet': '/api/pet/me', 'games': '/api/games/home',
            'membership': '/api/membership/me', 'billing': '/api/billing/plans',
        }
        for name, path in paths.items():
            with self.subTest(module=name):
                self.flag(name, False)
                response = member.get(path)
                self.assertEqual(response.status_code, 501, response.text)
                self.assertEqual(self.code(response), 'capability_unavailable')
        # Disabled business features must never disable personal data rights.
        exported = accounts.export(self.db.conn(), self.actor(member))
        self.assertTrue(set(MODULES).issubset(exported))

    def test_metering_requires_consent_and_revocation_clears_both_counters(self):
        member = self.user('lg3b_consent')
        conn = self.db.conn()
        self.assertFalse(engine.touch_activity(conn, member.pid))
        self.assertFalse(achievements.record_metric(conn, member.pid, 'active_streak', 'day:no')['credited'])
        self.assertEqual(conn.execute('SELECT count(*) FROM achievement_activity_day').fetchone()[0], 0)
        self.assertEqual(member.post('/api/growth/consent', headers=HDRS, json={'consent': True}).status_code, 200)
        self.assertTrue(engine.touch_activity(conn, member.pid))
        self.assertTrue(achievements.record_metric(conn, member.pid, 'active_streak', 'day:yes')['credited'])
        self.assertEqual(conn.execute('SELECT count(*) FROM achievement_activity_day').fetchone()[0], 1)
        self.assertEqual(member.post('/api/growth/consent', headers=HDRS, json={'consent': False}).status_code, 200)
        for table in ('growth_activity', 'achievement_activity_day'):
            self.assertEqual(conn.execute(f'SELECT count(*) FROM {table} WHERE principal_id = ?', (member.pid,)).fetchone()[0], 0)
        self.assertFalse(engine.touch_activity(conn, member.pid))
        self.assertFalse(achievements.record_metric(conn, member.pid, 'active_streak', 'day:late')['credited'])
        self.assertFalse(accounts.EXPORTERS['growth'](conn, self.actor(member))['consentMetering'])

    def test_export_is_owner_scoped_and_does_not_expose_other_dm_bodies(self):
        a, b, stranger = self.user('lg3b_dm_a'), self.user('lg3b_dm_b'), self.user('lg3b_dm_c')
        from modules.dm import service
        conn = self.db.conn()
        for client in (a, b):
            service.put_settings(conn, self.actor(client), 'everyone')
        thread, _ = service.create_thread(conn, self.actor(a), [b.pid])
        service.send_message(conn, self.actor(a), thread['id'], text='export-my-message')
        service.decide_request(conn, self.actor(b), thread['id'], 'accept')
        service.send_message(conn, self.actor(b), thread['id'], text='other-private-message')
        exported = accounts.EXPORTERS['dm'](conn, self.actor(a))
        self.assertIn('export-my-message', json.dumps(exported))
        self.assertNotIn('other-private-message', json.dumps(exported))
        self.assertEqual(accounts.EXPORTERS['dm'](conn, self.actor(stranger))['messages'], [])
        for path in (f"/api/dm/threads/{thread['id']}", f"/api/dm/threads/{thread['id']}/messages"):
            self.assertEqual(stranger.get(path).status_code, 404)
        self.assertEqual(stranger.get('/api/dm/threads').json()['data']['items'], [])
        self.assertEqual(stranger.get('/api/dm/unread-count').json()['data']['count'], 0)
        # A declined request is absent from the same three surfaces for both participants.
        conn.execute("UPDATE dm_thread SET request_state = 'declined' WHERE id = ?", (thread['id'],))
        for client in (a, b):
            self.assertEqual(client.get('/api/dm/threads').json()['data']['items'], [])
            self.assertEqual(client.get('/api/dm/unread-count').json()['data']['count'], 0)
            self.assertEqual(client.get('/api/dm/threads/' + thread['id']).status_code, 404)
            self.assertEqual(client.get('/api/dm/threads/' + thread['id'] + '/messages').status_code, 404)
        with self.assertRaises(ApiError) as declined:
            service.create_thread(conn, self.actor(a), [b.pid])
        self.assertEqual(declined.exception.code, 'resource_not_found')

    def test_new_exporters_execute_on_populated_owner_scoped_rows(self):
        a, b = self.user('lg3b_owner'), self.user('lg3b_other')
        conn = self.db.conn()
        stamp = clock.now()
        # Independent module state: two owners with distinct marker values.
        for client, marker in ((a, 'owner-only'), (b, 'other-only')):
            conn.execute('INSERT INTO game_preference VALUES (?, 1, ?)', (client.pid, marker))
            conn.execute('INSERT INTO farm_member(owner_id, created_at, updated_at) VALUES (?, ?, ?)', (client.pid, stamp, marker))
            conn.execute('INSERT INTO parking_lot(owner_id, created_at, updated_at) VALUES (?, ?, ?)', (client.pid, stamp, marker))
            conn.execute('INSERT INTO achievement_activity_day VALUES (?, ?)', (client.pid, marker))
        for name in ('games', 'farm', 'parking', 'achievements'):
            with self.subTest(module=name):
                value = json.dumps(accounts.EXPORTERS[name](conn, self.actor(a)))
                self.assertIn('owner-only', value)
                self.assertNotIn('other-only', value)
                for fn in accounts._purgers_for(self.db):
                    if fn.__module__.startswith('modules.' + name + '.'):
                        fn(conn, a.pid)
                self.assertNotIn('owner-only', json.dumps(accounts.EXPORTERS[name](conn, self.actor(a))))
                self.assertIn('other-only', json.dumps(accounts.EXPORTERS[name](conn, self.actor(b))))

    def test_notification_export_redacts_revoked_content(self):
        owner, reader = self.user('lg3b_notice_owner'), self.user('lg3b_notice_reader')
        root = self.obj(owner, title='private-notice-title')
        self.obj(reader, type='reply', title='response', root_id=root['id'])
        outbox.dispatch(self.db, limit=1000)
        self.assertEqual(owner.post('/api/objects/' + root['id'] + '/withdraw', headers=HDRS, json={}).status_code, 200)
        exported = accounts.EXPORTERS['notify'](self.db.conn(), self.actor(owner))
        self.assertTrue(exported['notifications'])
        self.assertNotIn('private-notice-title', json.dumps(exported))
        self.assertTrue(exported['notifications'][0]['unavailable'])

    def test_economy_export_does_not_truncate_personal_history(self):
        member, other = self.user('lg3b_wallet'), self.user('lg3b_other_wallet')
        conn = self.db.conn()
        stamp = clock.now()
        conn.executemany('INSERT INTO wallet_entry(id, principal_id, currency, amount, requested_amount, reason, '
                         'idempotency_key, created_at) VALUES (?, ?, ?, 1, 1, ?, ?, ?)',
                         [(f'lg3b-{i}', member.pid, 'bamboo', 'test', f'lg3b-{i}', stamp) for i in range(1005)])
        exported = accounts.EXPORTERS['economy'](conn, self.actor(member))
        self.assertEqual(len(exported['entries']), 1005)
        self.assertEqual(accounts.EXPORTERS['economy'](conn, self.actor(other))['entries'], [])

    def test_background_metrics_cannot_bypass_disabled_switches(self):
        from modules.growth import router as growth_router, jobs
        from modules.games import service as games
        from modules.notify import router as notify
        member = self.user('lg3b_worker')
        conn = self.db.conn()
        engine.set_consent(conn, member.pid, True)
        event = {'id': 'lg3b-worker-event', 'event_type': 'object.created', 'aggregate_id': 'absent',
                 'actor_id': member.pid, 'occurred_at': clock.now(), 'payload': {'type': 'reply'}}
        for module, callback in (
            ('growth', lambda: growth_router.on_object(conn, event)),
            ('growth', lambda: jobs.recompute(self.db)),
            ('achievements', lambda: achievements.record_metric(conn, member.pid, 'active_streak', 'day:test')),
            ('games', lambda: games.on_object(conn, event)),
            ('notify', lambda: notify.handle_event(conn, {**event, 'event_type': 'notify.system.notice',
                                                        'payload': {'recipient_id': member.pid, 'message': 'test'}})),
        ):
            with self.subTest(module=module):
                self.flag(module, False)
                with self.assertRaises(ApiError) as denied:
                    callback()
                self.assertEqual(denied.exception.code, 'capability_unavailable')
        self.assertEqual(conn.execute('SELECT count(*) FROM growth_activity').fetchone()[0], 0)
        self.assertEqual(conn.execute('SELECT count(*) FROM achievement_activity_day').fetchone()[0], 0)
        self.assertEqual(conn.execute('SELECT count(*) FROM notification').fetchone()[0], 0)

    def test_seven_activity_days_still_unlock_after_explicit_consent(self):
        member = self.user('lg3b_consented_streak')
        conn = self.db.conn()
        engine.set_consent(conn, member.pid, True)
        for day in range(21, 28):
            stamp = f'2026-10-{day:02d}T08:00:00.000000Z'
            achievements.record_metric(conn, member.pid, 'active_streak', f'day:{day}', stamp)
        row = conn.execute("SELECT progress, unlocked_at FROM member_achievement WHERE principal_id = ? "
                           "AND achievement_key = 'streak-seven'", (member.pid,)).fetchone()
        self.assertEqual(row['progress'], 7)
        self.assertIsNotNone(row['unlocked_at'])
