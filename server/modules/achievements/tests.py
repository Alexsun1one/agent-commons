import json
import unittest

from app import ledger, outbox, worker
from tests.helpers import AppCase

from . import hooks, service


STAMP = '2026-10-27T12:00:00.000000Z'


class AchievementTest(AppCase):
    def event(self, event_type, aggregate_id, *, actor_id=None, payload=None, at=STAMP):
        return {
            'id': f'event:{event_type}:{aggregate_id}',
            'event_type': event_type,
            'aggregate_type': 'object',
            'aggregate_id': aggregate_id,
            'actor_id': actor_id,
            'payload': payload or {},
            'occurred_at': at,
            'request_id': None,
        }

    def test_catalog_has_24_achievements_and_12_challenges(self):
        c = self.user('catalogue')
        response = c.get('/api/achievements/catalog')
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()['data']
        self.assertEqual(len(rows), 24)
        self.assertEqual({row['rarity'] for row in rows}, {'common', 'uncommon', 'rare', 'epic', 'legendary'})
        with self.db.read() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM weekly_challenge_definition').fetchone()[0], 12)
            actions = [row[0] for row in conn.execute(
                "SELECT action FROM action_rule WHERE action LIKE 'achievements.%' ORDER BY action"
            )]
        self.assertEqual(actions, ['achievements.read'])

    def test_endpoints_require_login_and_weekly_returns_three(self):
        self.assertEqual(self.client().get('/api/achievements/me').status_code, 401)
        c = self.user('weekly')
        for path in ('/api/achievements/me', '/api/achievements/catalog', '/api/achievements/weekly'):
            response = c.get(path)
            self.assertEqual(response.status_code, 200, response.text)
        weekly = c.get('/api/achievements/weekly').json()['data']
        self.assertEqual(len(weekly['challenges']), 3)
        self.assertEqual(len({row['metric'] for row in weekly['challenges']}), 3)

    def test_same_object_is_counted_once_and_unlock_event_is_once(self):
        c = self.user('dedupe')
        event = self.event('object.created', 'object-one', actor_id=c.pid, payload={'type': 'knowledge'})
        with self.db.write() as conn:
            service.on_object(conn, event)
            service.on_object(conn, dict(event, id='another-delivery'))
        with self.db.read() as conn:
            progress = conn.execute(
                "SELECT progress FROM member_achievement WHERE principal_id = ? AND achievement_key = 'knowledge-first'",
                (c.pid,),
            ).fetchone()[0]
            emitted = conn.execute(
                "SELECT count(*) FROM outbox_event WHERE event_type = 'achievements.unlocked' "
                "AND aggregate_id = ?",
                (c.pid,),
            ).fetchone()[0]
        self.assertEqual(progress, 1)
        self.assertEqual(emitted, 1)

    def test_ledger_source_ref_is_the_dedupe_object(self):
        c = self.user('ledger_source')
        with self.db.write() as conn:
            first = ledger.record(
                conn, event_type='adopted', subject_id=c.pid, points=20, rule_version='test',
                idempotency_key='adopted:first', source_ref='object:same', actor_id=c.pid,
            )
            second = ledger.record(
                conn, event_type='adopted', subject_id=c.pid, points=20, rule_version='test',
                idempotency_key='adopted:second', source_ref='object:same', actor_id=c.pid,
            )
            for entry_id in (first, second):
                service.on_ledger(conn, self.event(
                    'ledger.recorded', entry_id,
                    payload={'event_type': 'adopted', 'subject_id': c.pid, 'points': 20},
                ))
        with self.db.read() as conn:
            row = conn.execute(
                "SELECT progress FROM member_achievement WHERE principal_id = ? AND achievement_key = 'adopted-first'",
                (c.pid,),
            ).fetchone()
        self.assertEqual(row[0], 1)

    def test_seven_distinct_activity_days_unlock_streak(self):
        c = self.user('streak')
        from modules.growth.engine import set_consent
        with self.db.write() as conn:
            set_consent(conn, c.pid, True)
            for day in range(21, 28):
                stamp = f'2026-10-{day:02d}T08:00:00.000000Z'
                service.record_metric(conn, c.pid, 'active_streak', f'day:2026-10-{day:02d}', stamp)
            row = conn.execute(
                "SELECT progress, unlocked_at FROM member_achievement "
                "WHERE principal_id = ? AND achievement_key = 'streak-seven'",
                (c.pid,),
            ).fetchone()
        self.assertEqual(row['progress'], 7)
        self.assertIsNotNone(row['unlocked_at'])

    def test_weekly_progress_completes_and_duplicate_source_does_not_advance(self):
        c = self.user('challenge')
        with self.db.write() as conn:
            week = service.ensure_week(conn, STAMP)
            challenge = conn.execute(
                'SELECT d.* FROM weekly_challenge w JOIN weekly_challenge_definition d '
                'ON d.key = w.challenge_key WHERE w.week_start = ? ORDER BY w.slot LIMIT 1',
                (week,),
            ).fetchone()
            for index in range(challenge['threshold']):
                service.record_metric(conn, c.pid, challenge['metric'], f'weekly:{index}', STAMP)
            service.record_metric(conn, c.pid, challenge['metric'], 'weekly:0', STAMP)
            row = conn.execute(
                'SELECT progress, completed_at FROM member_weekly_challenge '
                'WHERE principal_id = ? AND week_start = ? AND challenge_key = ?',
                (c.pid, week, challenge['key']),
            ).fetchone()
        self.assertEqual(row['progress'], challenge['threshold'])
        self.assertIsNotNone(row['completed_at'])

    def test_week_rotation_is_idempotent_and_registers_periodic(self):
        first = service.rotate_week(self.db, STAMP)
        self.assertEqual(service.rotate_week(self.db, STAMP), first)
        second = service.rotate_week(self.db, '2026-11-03T12:00:00.000000Z')
        with self.db.read() as conn:
            self.assertEqual(conn.execute(
                'SELECT count(*) FROM weekly_challenge WHERE week_start = ?', (first,)
            ).fetchone()[0], 3)
            self.assertEqual(conn.execute(
                'SELECT count(*) FROM weekly_challenge WHERE week_start = ?', (second,)
            ).fetchone()[0], 3)
        self.assertEqual(worker.PERIODIC['achievements.weekly_rotate'].every_seconds, 300)

    def test_stage_room_end_credits_every_participant_once(self):
        host = self.user('host')
        guest = self.user('guest')
        with self.db.write() as conn:
            conn.execute(
                "INSERT INTO room (id, kind, title, summary, host_id, created_by, provider, starts_at, duration_min, "
                "state, capacity, created_at, updated_at) VALUES "
                "('room-achv', 'stage', '讲堂', '', ?, ?, 'livekit', ?, 30, 'ended', 20, ?, ?)",
                (host.pid, host.pid, STAMP, STAMP, STAMP),
            )
            for principal_id, role in ((host.pid, 'host'), (guest.pid, 'listener')):
                conn.execute(
                    'INSERT INTO room_participant '
                    '(room_id, principal_id, role, epoch, present, joined_at, left_at, updated_at) '
                    "VALUES ('room-achv', ?, ?, 1, 0, ?, ?, ?)",
                    (principal_id, role, STAMP, STAMP, STAMP),
                )
            event = self.event('rooms.room.ended', 'room-achv', payload={'kind': 'stage'})
            service.on_room_ended(conn, event)
            service.on_room_ended(conn, dict(event, id='duplicate-end'))
            counts = [conn.execute(
                "SELECT progress FROM member_achievement WHERE principal_id = ? AND achievement_key = 'room-first'",
                (principal_id,),
            ).fetchone()[0] for principal_id in (host.pid, guest.pid)]
        self.assertEqual(counts, [1, 1])

    def test_unlock_payload_is_ready_for_notification_consumer(self):
        c = self.user('notify_shape')
        with self.db.write() as conn:
            service.record_metric(conn, c.pid, 'work_shared', 'object:work-one', STAMP)
        with self.db.read() as conn:
            row = conn.execute(
                "SELECT payload_json FROM outbox_event WHERE event_type = 'achievements.unlocked' "
                'AND aggregate_id = ? ORDER BY occurred_at DESC LIMIT 1',
                (c.pid,),
            ).fetchone()
        payload = json.loads(row[0])
        self.assertEqual(payload['principal_id'], c.pid)
        self.assertEqual(payload['link'], '#/achievements')
        self.assertIn('message', payload)

    def test_purger_removes_member_rows(self):
        c = self.user('purged')
        with self.db.write() as conn:
            service.record_metric(conn, c.pid, 'knowledge_shared', 'object:purge', STAMP)
            hooks.purge(conn, c.pid)
            tables = (
                'member_achievement', 'achievement_credit', 'achievement_activity_day',
                'member_weekly_challenge', 'weekly_challenge_credit',
            )
            remaining = [conn.execute(
                f'SELECT count(*) FROM {table} WHERE principal_id = ?', (c.pid,)
            ).fetchone()[0] for table in tables]
        self.assertEqual(remaining, [0, 0, 0, 0, 0])

    def test_subscriptions_are_registered(self):
        names = {name: pattern for name, pattern, _ in outbox.CONSUMERS if name.startswith('achievements.')}
        self.assertEqual(names, {
            'achievements.objects': 'object.*',
            'achievements.ledger': 'ledger.recorded',
            'achievements.rooms': 'rooms.room.ended',
        })


if __name__ == '__main__':
    unittest.main()
