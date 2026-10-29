import json
import unittest
from unittest import mock

from app.errors import ApiError
from tests.helpers import AppCase, HDRS

from modules.games import hooks, jobs, service


class FakeEconomy:
    def __init__(self):
        self.calls = []

    def credit(self, conn, principal_id, currency, amount, reason, idempotency_key, ref=None):
        self.calls.append((principal_id, currency, amount, reason, idempotency_key, ref))
        return amount

    def balance(self, conn, principal_id, currency):
        return 88


class GamesTest(AppCase):
    def setUp(self):
        super().setUp()
        self.economy = FakeEconomy()
        self.patch = mock.patch.object(service, 'eco', self.economy)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        super().tearDown()

    def test_question_bank_has_sixty_reviewed_questions_and_all_kinds(self):
        c = self.user('questions')
        response = c.post('/api/games/exams', headers=HDRS, json={})
        self.assertEqual(response.status_code, 201, response.text)
        data = response.json()['data']
        self.assertEqual(len(data['questions']), 10)
        self.assertNotIn('explanation', data['questions'][0])
        with self.db.read() as conn:
            rows = conn.execute(
                "SELECT kind, count(*) AS n FROM game_question WHERE review_status = 'reviewed' GROUP BY kind"
            ).fetchall()
        self.assertEqual({row['kind']: row['n'] for row in rows}, {
            'single': 15, 'multiple': 15, 'boolean': 15, 'order': 15,
        })

    def test_each_direction_can_start_a_ten_question_exam(self):
        c = self.user('directions')
        for direction in sorted(service.DIRECTIONS):
            response = c.post('/api/games/exams', headers=HDRS, json={'direction': direction})
            self.assertEqual(response.status_code, 201, (direction, response.text))
            self.assertEqual(len(response.json()['data']['questions']), 10)
            self.assertEqual({q['direction'] for q in response.json()['data']['questions']}, {direction})

    def test_exam_scores_server_side_and_keeps_only_best(self):
        c = self.user('exam')
        started = c.post('/api/games/exams', headers=HDRS, json={}).json()['data']
        with self.db.read() as conn:
            answer_rows = conn.execute(
                'SELECT slot, answer_json FROM game_exam_question WHERE exam_id = ? ORDER BY slot',
                (started['id'],),
            ).fetchall()
        answers = {str(row['slot']): json.loads(row['answer_json']) for row in answer_rows}
        response = c.post(f"/api/games/exams/{started['id']}/submit", headers=HDRS, json={'answers': answers})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()['data']
        self.assertEqual(result['score'], 100)
        self.assertEqual(result['correctCount'], 10)
        self.assertTrue(all('explanation' in q and 'source' in q for q in result['questions']))
        repeated = c.post(f"/api/games/exams/{started['id']}/submit", headers=HDRS, json={'answers': answers})
        self.assertEqual(repeated.status_code, 409, repeated.text)
        self.assertEqual(self.code(repeated), 'game_already_submitted')
        board = c.get('/api/games/exams/leaderboard').json()['data']
        self.assertEqual(board[0]['score'], 100)

    def test_exam_rejects_submission_after_server_deadline(self):
        c = self.user('expired')
        with self.db.write() as conn:
            exam = service.start_exam(conn, c.pid, now='2026-10-25T00:00:00.000000Z')
            answers = {str(row['slot']): json.loads(row['answer_json']) for row in conn.execute(
                'SELECT slot, answer_json FROM game_exam_question WHERE exam_id = ?', (exam['id'],)
            ).fetchall()}
            with self.assertRaises(ApiError) as raised:
                service.submit_exam(conn, c.pid, exam['id'], answers, now='2026-10-25T00:10:01.000000Z')
        self.assertEqual(raised.exception.code, 'game_expired')

    def test_guess_reward_is_once_and_rotation_is_idempotent(self):
        c = self.user('guess')
        first = c.get('/api/games/guess/today')
        self.assertEqual(first.status_code, 200, first.text)
        day = first.json()['data']['day']
        with self.db.read() as conn:
            item_id = conn.execute(
                "SELECT item_id FROM game_daily_rotation WHERE day = ? AND kind = 'guess' AND slot = 1", (day,)
            ).fetchone()[0]
        answer = next(item['answer'] for item in service.GUESS_ITEMS if item['id'] == item_id)
        response = c.post('/api/games/guess/1', headers=HDRS, json={'option_id': answer})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['data']['correct'])
        self.assertEqual(response.json()['data']['reward'], 3)
        repeated = c.post('/api/games/guess/1', headers=HDRS, json={'option_id': answer})
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertTrue(repeated.json()['data']['replayed'])
        self.assertEqual(len(self.economy.calls), 1)
        with self.db.write() as conn:
            service.ensure_daily_rotation(conn, day)
            service.ensure_daily_rotation(conn, day)
            self.assertEqual(conn.execute(
                "SELECT count(*) FROM game_daily_rotation WHERE day = ? AND kind = 'guess'", (day,)
            ).fetchone()[0], 5)

    def test_pending_reward_delivers_when_economy_arrives(self):
        c = self.user('pending')
        with mock.patch.object(service, 'eco', None):
            with self.db.write() as conn:
                granted = service._deliver_reward(conn, c.pid, 'games:test:pending', 'games.guess', 5, ref='test')
            self.assertEqual(granted, 0)
        with self.db.write() as conn:
            self.assertEqual(service.deliver_pending_rewards(conn), 1)
            row = conn.execute(
                'SELECT granted, delivered FROM game_reward WHERE principal_id = ? AND reward_key = ?',
                (c.pid, 'games:test:pending'),
            ).fetchone()
        self.assertEqual((row['granted'], row['delivered']), (5, 1))

    def test_pending_guess_reward_updates_attempt_after_delivery(self):
        c = self.user('pending_guess')
        with self.db.write() as conn:
            day = service.ensure_daily_rotation(conn, '2026-10-25')
            item_id = conn.execute(
                "SELECT item_id FROM game_daily_rotation WHERE day = ? AND kind = 'guess' AND slot = 1", (day,)
            ).fetchone()[0]
            answer = next(item['answer'] for item in service.GUESS_ITEMS if item['id'] == item_id)
            with mock.patch.object(service, 'eco', None):
                result = service.answer_guess(conn, c.pid, 1, answer, day)
            self.assertEqual(result['reward'], 0)
            self.assertEqual(service.deliver_pending_rewards(conn), 1)
            stored = conn.execute(
                'SELECT reward FROM game_guess_attempt WHERE principal_id = ? AND day = ? AND slot = 1',
                (c.pid, day),
            ).fetchone()
        self.assertEqual(stored['reward'], 3)

    def test_fortune_is_stable_for_the_day_and_has_sixty_entries(self):
        c = self.user('fortune')
        self.assertEqual(len(service.FORTUNES), 60)
        with self.db.write() as conn:
            first = service.draw_fortune(conn, c.pid, '2026-10-25T08:00:00.000000Z')
            second = service.draw_fortune(conn, c.pid, '2026-10-25T18:00:00.000000Z')
        self.assertEqual(first, second)
        self.assertIn('今日宜：', first['text'])

    def test_sofa_only_rewards_first_three_valid_replies(self):
        owner = self.user('sofa_owner')
        root = self.obj(owner, type='discussion', title='测试讨论', content={'body': '讨论正文'})
        responders = [self.user(f'sofa_{i}') for i in range(4)]
        for index, responder in enumerate(responders):
            reply = self.obj(
                responder, type='reply', root_id=root['id'], title='回复',
                content={'body': f'这是第 {index + 1} 条有效回复，包含足够多的中文内容用于测试。'},
            )
            with self.db.write() as conn:
                service.on_object(conn, {
                    'event_type': 'object.created', 'aggregate_id': reply['id'], 'actor_id': responder.pid,
                    'payload': {'type': 'reply'}, 'occurred_at': '2026-10-25T08:00:00.000000Z',
                })
        with self.db.read() as conn:
            rows = conn.execute(
                'SELECT position, reward FROM game_sofa_reply WHERE root_id = ? ORDER BY position', (root['id'],)
            ).fetchall()
        self.assertEqual([row['position'] for row in rows], [1, 2, 3])
        self.assertEqual([row['reward'] for row in rows], [3, 3, 3])
        self.assertEqual(len(self.economy.calls), 3)

    def test_short_or_emoji_only_reply_does_not_take_a_sofa(self):
        owner = self.user('short_owner')
        responder = self.user('short_reply')
        root = self.obj(owner, type='discussion', title='短回复', content={'body': '正文'})
        reply = self.obj(responder, type='reply', root_id=root['id'], title='回复', content={'body': '😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀'})
        with self.db.write() as conn:
            service.on_object(conn, {
                'event_type': 'object.created', 'aggregate_id': reply['id'], 'actor_id': responder.pid,
                'payload': {'type': 'reply'}, 'occurred_at': '2026-10-25T08:00:00.000000Z',
            })
            count = conn.execute('SELECT count(*) FROM game_sofa_reply WHERE root_id = ?', (root['id'],)).fetchone()[0]
        self.assertEqual(count, 0)

    def test_preference_and_account_purge(self):
        c = self.user('preference')
        changed = c.post('/api/games/preferences', headers=HDRS, json={'playground_enabled': False})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertFalse(changed.json()['data']['playgroundEnabled'])
        with self.db.write() as conn:
            service.draw_fortune(conn, c.pid)
            hooks.purge(conn, c.pid)
        with self.db.read() as conn:
            self.assertEqual(conn.execute(
                'SELECT count(*) FROM game_preference WHERE principal_id = ?', (c.pid,)
            ).fetchone()[0], 0)
            self.assertEqual(conn.execute(
                'SELECT count(*) FROM game_fortune WHERE principal_id = ?', (c.pid,)
            ).fetchone()[0], 0)

    def test_periodic_registration_is_idempotent(self):
        c = self.user('periodic')
        jobs.rotate(self.db)
        jobs.rotate(self.db)
        with self.db.read() as conn:
            self.assertEqual(conn.execute(
                "SELECT count(*) FROM game_daily_rotation WHERE day = ? AND kind = 'guess'",
                (service.day_key(),),
            ).fetchone()[0], 5)
        self.assertIsNotNone(c.pid)

class GamesEconomyIntegrationTest(AppCase):
    def test_guess_reward_uses_real_economy_contract(self):
        c = self.user('games_economy')
        with self.db.write() as conn:
            day = service.ensure_daily_rotation(conn, '2026-10-25')
            item_id = conn.execute(
                "SELECT item_id FROM game_daily_rotation WHERE day = ? AND kind = 'guess' AND slot = 1", (day,)
            ).fetchone()[0]
            answer = next(item['answer'] for item in service.GUESS_ITEMS if item['id'] == item_id)
            result = service.answer_guess(conn, c.pid, 1, answer, day)
            balance = service.eco.balance(conn, c.pid, 'bamboo')
        self.assertEqual(result['reward'], 3)
        self.assertEqual(balance, 3)


if __name__ == '__main__':
    unittest.main()

