import unittest

from app import clock
from tests.helpers import AppCase


class MembershipTest(AppCase):
    def setUp(self):
        super().setUp()
        self.member = self.user('benefit_member', level=3)

    def benefit(self, payload, key):
        return next(row for row in payload['benefits'] if row['key'] == key)

    def test_benefits_by_level_follow_growth_unlocks(self):
        response = self.member.get('/api/membership/benefits?level=3')
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()['data']
        room = self.benefit(payload, 'discussion_rooms')
        self.assertEqual((room['minLevel'], room['available'], room['quota'], room['period']), (3, True, 4, 'month'))
        self.assertEqual(self.benefit(payload, 'upload_megabytes')['quota'], 4096)
        self.assertEqual(self.benefit(payload, 'agent_slots')['quota'], 3)

        with self.db.write() as conn:
            conn.execute("UPDATE action_rule SET min_level = 4 WHERE action = 'rooms.create.discussion'")
        payload = self.member.get('/api/membership/benefits?level=3').json()['data']
        room = self.benefit(payload, 'discussion_rooms')
        self.assertEqual((room['minLevel'], room['available'], room['quota']), (4, False, 0))

    def test_me_reports_usage_remaining_and_periods(self):
        first = self.member.get('/api/membership/me')
        self.assertEqual(first.status_code, 200, first.text)
        payload = first.json()['data']
        room = self.benefit(payload, 'discussion_rooms')
        upload = self.benefit(payload, 'upload_megabytes')
        self.assertEqual((room['used'], room['remaining']), (0, 4))
        self.assertIsNotNone(room['periodKey'])
        self.assertIsNotNone(upload['periodKey'])

        with self.db.write() as conn:
            conn.executemany(
                'INSERT INTO membership_usage '
                '(principal_id, benefit_key, period_key, used, updated_at) VALUES (?, ?, ?, ?, ?)',
                [
                    (self.member.pid, 'discussion_rooms', room['periodKey'], 1, clock.now()),
                    (self.member.pid, 'upload_megabytes', upload['periodKey'], 1260, clock.now()),
                    (self.member.pid, 'agent_slots', 'account', 2, clock.now()),
                ],
            )

        payload = self.member.get('/api/membership/me').json()['data']
        self.assertEqual((self.benefit(payload, 'discussion_rooms')['used'],
                          self.benefit(payload, 'discussion_rooms')['remaining']), (1, 3))
        self.assertEqual((self.benefit(payload, 'upload_megabytes')['used'],
                          self.benefit(payload, 'upload_megabytes')['remaining']), (1260, 2836))
        self.assertEqual((self.benefit(payload, 'agent_slots')['used'],
                          self.benefit(payload, 'agent_slots')['remaining']), (2, 1))

    def test_locked_and_invalid_levels(self):
        low = self.member.get('/api/membership/benefits?level=1').json()['data']
        self.assertFalse(self.benefit(low, 'discussion_rooms')['available'])
        self.assertFalse(self.benefit(low, 'upload_megabytes')['available'])
        self.assertEqual(self.member.get('/api/membership/benefits?level=6').status_code, 422)

    def test_rules_are_namespaced_and_auth_is_required(self):
        rows = self.db.conn().execute(
            "SELECT action FROM action_rule WHERE action LIKE 'membership.%' ORDER BY action"
        ).fetchall()
        self.assertEqual([row['action'] for row in rows], ['membership.benefits.read', 'membership.me.read'])
        self.assertEqual(self.client().get('/api/membership/me').status_code, 401)


if __name__ == '__main__':
    unittest.main()
