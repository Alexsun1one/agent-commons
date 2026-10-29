import json
import unittest
from unittest import mock

from app import accounts, clock, outbox, worker
from tests.helpers import HDRS, AppCase

from modules.events import hooks, service


DAY = 86400
STAMP = '2026-10-25T12:00:00.000000Z'


class EventsTest(AppCase):
    def setUp(self):
        super().setUp()
        self._clock = mock.patch('app.clock.now_ts', return_value=clock.parse(STAMP))
        self._clock.start()

    def tearDown(self):
        self._clock.stop()
        super().tearDown()

    def post(self, client, path, body=None, status=200):
        response = client.post(path, headers=HDRS, json=body or {})
        self.assertEqual(response.status_code, status, response.text)
        return response.json()['data'] if status < 400 else response.json()

    def age(self, pid, days=10):
        with self.db.write() as conn:
            conn.execute(
                'UPDATE principal SET created_at = ? WHERE id = ?',
                (clock.iso(clock.now_ts() - days * DAY), pid),
            )

    def make(self, client, **over):
        body = {
            'slug': over.pop('slug', f'slug-{client.pid[:8]}'),
            'kind': 'challenge',
            'title': '限时做一个检索 Agent',
            'summary': '三天内交出可复现的检索助手。',
            'cover': 'assets/illus/cover-agent-plaza.webp',
            'rules': '只交可复现说明。',
            'rewards': [{'kind': 'bamboo', 'label': '20 竹子', 'note': '拟定'}],
            'timeline': [{'at': '开始', 'text': '公布题目'}],
            'place': '站内',
            'host_name': '陈墨',
            'starts_at': clock.iso(clock.now_ts() - 3600),
            'ends_at': clock.iso(clock.now_ts() + 2 * DAY),
            'visibility': 'members',
            'min_level': 1,
        }
        body.update(over)
        return self.post(client, '/api/events', body, status=201 if False else 200)

    def campaign(self, admin, **over):
        body = {
            'kind': 'campaign',
            'title': '本月最佳 Agent 作品',
            'summary': '投票选出最能复现的作品。',
            'starts_at': clock.iso(clock.now_ts() - 3600),
            'ends_at': clock.iso(clock.now_ts() + DAY),
        }
        body.update(over)
        return self.make(admin, **body)

    def submit_as(self, client, event_id, title='评审实验台', source_ref=None):
        return self.post(client, f'/api/events/{event_id}/submissions', {
            'title': title,
            'summary': '可复现说明',
            'source_kind': 'work',
            'source_ref': source_ref or title,
        })

    def vote_as(self, client, event_id, candidate_id, status=200):
        return self.post(client, f'/api/events/{event_id}/votes', {
            'candidate_id': candidate_id,
        }, status=status)

    def test_action_rules_only_events(self):
        admin = self.user('evt_admin', level=5, roles=('admin',), totp=True)
        self.make(admin)
        with self.db.read() as conn:
            actions = [row[0] for row in conn.execute(
                "SELECT action FROM action_rule WHERE action LIKE 'events.%' ORDER BY action"
            )]
        self.assertEqual(actions, [
            'events.manage', 'events.read', 'events.signup', 'events.submit', 'events.vote',
        ])

    def test_host_defaults_to_creator_display_name(self):
        admin = self.user('evt_host_admin', level=5, roles=('admin',), totp=True)
        created = self.make(admin, slug='no-host-name', host_name='')
        with self.db.read() as conn:
            name = conn.execute('SELECT display_name FROM profile WHERE principal_id = ?',
                                (admin.pid,)).fetchone()[0]
        detail = admin.get(f"/api/events/{created['id']}").json()['data']
        self.assertEqual(detail['host'], name)
        self.assertNotEqual(detail['host'], admin.pid)

    def test_endpoints_require_login(self):
        self.assertEqual(self.client().get('/api/events').status_code, 401)
        self.assertEqual(self.client().get('/api/events/calendar?from=2026-10-01&to=2026-11-01').status_code, 401)

    def test_visibility_level_and_named(self):
        admin = self.user('evt_vis_admin', level=5, roles=('admin',), totp=True)
        hidden = self.make(admin, slug='l3-only', visibility='level', min_level=3, title='骨干共学')
        guest = self.user('evt_vis_l1')
        peer = self.user('evt_vis_l3', level=3)
        r1 = guest.get(f"/api/events/{hidden['id']}")
        self.assertEqual(r1.status_code, 404, r1.text)
        listed = guest.get('/api/events').json()['data']
        self.assertFalse(any(item['id'] == hidden['id'] for item in listed))
        r3 = peer.get(f"/api/events/{hidden['id']}")
        self.assertEqual(r3.status_code, 200, r3.text)
        named = self.make(
            admin, slug='named-one', visibility='named', title='指定人活动',
            acl=[guest.pid],
        )
        self.assertEqual(peer.get(f"/api/events/{named['id']}").status_code, 404)
        self.assertEqual(guest.get(f"/api/events/{named['id']}").status_code, 200)

    def test_signup_and_submit_state(self):
        admin = self.user('evt_live_admin', level=5, roles=('admin',), totp=True)
        member = self.user('evt_live_l2', level=2)
        self.age(member.pid)
        live = self.make(admin, slug='live-sprint')
        upcoming = self.make(
            admin, slug='soon-camp', kind='camp', title='七日共学',
            starts_at=clock.iso(clock.now_ts() + DAY),
            ends_at=clock.iso(clock.now_ts() + 8 * DAY),
        )
        ended = self.make(
            admin, slug='old-talks', kind='talks', title='讲堂周回顾',
            starts_at=clock.iso(clock.now_ts() - 10 * DAY),
            ends_at=clock.iso(clock.now_ts() - DAY),
        )
        self.post(member, f"/api/events/{live['id']}/signup")
        again = self.post(member, f"/api/events/{live['id']}/signup")
        self.assertTrue(again['signedUp'])
        self.submit_as(member, live['id'])
        self.assertEqual(
            self.post(member, f"/api/events/{upcoming['id']}/submissions", {
                'title': '太早', 'source_kind': 'other', 'source_ref': 'x',
            }, status=409)['error']['code'],
            'state_conflict',
        )
        self.assertEqual(
            self.post(member, f"/api/events/{ended['id']}/signup", {}, status=409)['error']['code'],
            'state_conflict',
        )

    def test_cannot_vote_self(self):
        admin = self.user('evt_self_admin', level=5, roles=('admin',), totp=True)
        author = self.user('evt_self_author', level=2)
        self.age(author.pid)
        camp = self.campaign(admin, slug='self-camp')
        item = self.submit_as(author, camp['id'])
        body = self.vote_as(author, camp['id'], item['id'], status=403)
        self.assertEqual(body['error']['code'], 'action_not_allowed')

    def test_daily_vote_cap(self):
        admin = self.user('evt_cap_admin', level=5, roles=('admin',), totp=True)
        voter = self.user('evt_cap_voter', level=2)
        self.age(voter.pid)
        camp = self.campaign(admin, slug='cap-camp')
        candidates = []
        for index in range(4):
            author = self.user(f'evt_cap_a{index}', level=2)
            self.age(author.pid)
            candidates.append(self.submit_as(author, camp['id'], title=f'作品 {index}', source_ref=f'w{index}'))
        for item in candidates[:3]:
            self.vote_as(voter, camp['id'], item['id'])
        fourth = self.vote_as(voter, camp['id'], candidates[3]['id'], status=409)
        self.assertEqual(fourth['error']['code'], 'state_conflict')
        with mock.patch('app.clock.now_ts', return_value=clock.parse(STAMP) + DAY):
            self.vote_as(voter, camp['id'], candidates[3]['id'])

    def test_new_account_cannot_vote(self):
        admin = self.user('evt_new_admin', level=5, roles=('admin',), totp=True)
        author = self.user('evt_new_author', level=2)
        newbie = self.user('evt_new_l1', level=1)
        self.age(author.pid)
        camp = self.campaign(admin, slug='new-camp')
        item = self.submit_as(author, camp['id'])
        denied = self.vote_as(newbie, camp['id'], item['id'], status=403)
        self.assertEqual(denied['error']['code'], 'action_not_allowed')
        self.age(newbie.pid, days=8)
        self.vote_as(newbie, camp['id'], item['id'])

    def test_status_tick_is_idempotent(self):
        admin = self.user('evt_tick_admin', level=5, roles=('admin',), totp=True)
        event = self.make(
            admin, slug='tick-one',
            starts_at=clock.iso(clock.now_ts() + 120),
            ends_at=clock.iso(clock.now_ts() + 240),
        )
        self.assertEqual(event['status'], 'upcoming')
        first = service.tick(self.db)
        second = service.tick(self.db)
        self.assertEqual(first, [])
        self.assertEqual(second, [])
        with mock.patch('app.clock.now_ts', return_value=clock.parse(STAMP) + 180):
            moved = service.tick(self.db)
        self.assertEqual([(row['id'], row['to']) for row in moved], [(event['id'], 'live')])
        with mock.patch('app.clock.now_ts', return_value=clock.parse(STAMP) + 180):
            self.assertEqual(service.tick(self.db), [])
        with mock.patch('app.clock.now_ts', return_value=clock.parse(STAMP) + 300):
            ended = service.tick(self.db)
        self.assertEqual(ended[0]['to'], 'ended')
        with self.db.read() as conn:
            result = conn.execute(
                'SELECT 1 FROM event_result WHERE event_id = ?', (event['id'],)
            ).fetchone()
        self.assertIsNotNone(result)
        self.assertEqual(worker.PERIODIC['events.status_tick'].every_seconds, 60)

    def test_calendar_shape_matches_home2(self):
        admin = self.user('evt_cal_admin', level=5, roles=('admin',), totp=True)
        event = self.make(admin, slug='cal-sprint', kind='challenge', title='检索挑战')
        start = clock.iso(clock.now_ts() - DAY)
        end = clock.iso(clock.now_ts() + 3 * DAY)
        rows = self.client_of(admin).get(
            f'/api/events/calendar?from={start}&to={end}'
        ).json()['data']
        item = next(row for row in rows if row['href'] == f"#/event/{event['id']}")
        self.assertEqual(set(item), {
            'id', 'type', 'title', 'summary', 'start', 'end', 'place', 'href', 'host', 'sample',
        })
        self.assertEqual(item['type'], 'workshop')
        self.assertTrue(item['start'].endswith('+08:00'))
        self.assertFalse(item['sample'])

    def test_invite_tree_and_burst_emit_anomaly(self):
        admin = self.user('evt_ab_admin', level=5, roles=('admin',), totp=True)
        root = self.user('evt_ab_root', level=3)
        self.age(root.pid)
        with self.db.write() as conn:
            codes = [accounts.issue_invite(conn, root.pid, 1, 7)[1] for _ in range(2)]
            self.assertNotEqual(codes[0], codes[1])
            code = codes[0]
        child = self.client()
        self.register(child, 'evt_ab_child', code=code)
        child.pid = child.get('/api/me').json()['data']['id']
        with self.db.write() as conn:
            conn.execute('UPDATE profile SET level = 2 WHERE principal_id = ?', (child.pid,))
        self.age(child.pid)
        camp = self.campaign(admin, slug='ab-camp')
        item = self.submit_as(root, camp['id'], title='根的作品', source_ref='root-work')
        self.vote_as(child, camp['id'], item['id'])
        with self.db.read() as conn:
            anomalies = [row['event_type'] for row in conn.execute(
                "SELECT event_type FROM outbox_event WHERE event_type = 'events.vote_anomaly' "
                'AND aggregate_id = ?', (camp['id'],)
            )]
        self.assertIn('events.vote_anomaly', anomalies)
        extra = []
        for index in range(2):
            if index == 0:
                voter = self.client()
                registered = self.register(voter, f'evt_ab_b{index}', code=codes[1])
                self.assertEqual(registered.status_code, 201, registered.text)
                voter.pid = registered.json()['data']['id']
                self.db.conn().execute('UPDATE profile SET level = 2 WHERE principal_id = ?', (voter.pid,))
            else:
                voter = self.user(f'evt_ab_b{index}', level=2)
            self.age(voter.pid)
            extra.append(voter)
        for voter in extra:
            self.vote_as(voter, camp['id'], item['id'])
        with self.db.read() as conn:
            reasons = [
                json.loads(row[0])['reason']
                for row in conn.execute(
                    "SELECT payload_json FROM outbox_event WHERE event_type = 'events.vote_anomaly' "
                    'AND aggregate_id = ?', (camp['id'],)
                )
            ]
        self.assertIn('invite_tree', reasons)
        self.assertIn('burst', reasons)

    def test_votes_are_append_only(self):
        admin = self.user('evt_ap_admin', level=5, roles=('admin',), totp=True)
        author = self.user('evt_ap_author', level=2)
        voter = self.user('evt_ap_voter', level=2)
        self.age(author.pid)
        self.age(voter.pid)
        camp = self.campaign(admin, slug='ap-camp')
        item = self.submit_as(author, camp['id'])
        self.vote_as(voter, camp['id'], item['id'])
        with self.db.write() as conn:
            with self.assertRaises(Exception):
                conn.execute('UPDATE event_vote SET weight = 9 WHERE candidate_id = ?', (item['id'],))

    def test_results_after_end_and_rank_delta(self):
        admin = self.user('evt_res_admin', level=5, roles=('admin',), totp=True)
        a = self.user('evt_res_a', level=2)
        b = self.user('evt_res_b', level=2)
        v1 = self.user('evt_res_v1', level=2)
        v2 = self.user('evt_res_v2', level=2)
        for client in (a, b, v1, v2):
            self.age(client.pid)
        camp = self.campaign(admin, slug='res-camp')
        first = self.submit_as(a, camp['id'], title='甲', source_ref='a')
        second = self.submit_as(b, camp['id'], title='乙', source_ref='b')
        self.vote_as(v1, camp['id'], first['id'])
        board = self.vote_as(v2, camp['id'], second['id'])
        self.assertEqual(len(board['items']), 2)
        with mock.patch('app.clock.now_ts', return_value=clock.parse(STAMP) + 2 * DAY):
            service.tick(self.db)
            results = self.client_of(admin).get(f"/api/events/{camp['id']}/results").json()['data']
        self.assertIn('stats', results)
        self.assertEqual(results['stats']['ballots'], 2)
        self.assertEqual(len(results['winners']), 2)
        again = self.client_of(admin).get(f"/api/events/{camp['id']}/results").json()['data']
        self.assertEqual(again['publishedAt'], results['publishedAt'])

    def test_purger_removes_member_rows(self):
        admin = self.user('evt_pg_admin', level=5, roles=('admin',), totp=True)
        member = self.user('evt_pg_member', level=2)
        other = self.user('evt_pg_other', level=2)
        self.age(member.pid)
        self.age(other.pid)
        camp = self.campaign(admin, slug='pg-camp')
        self.post(member, f"/api/events/{camp['id']}/signup")
        mine = self.submit_as(member, camp['id'], title='将被清理', source_ref='purge')
        self.vote_as(other, camp['id'], mine['id'])
        with self.db.write() as conn:
            hooks.purge(conn, member.pid)
            leftover = [
                conn.execute('SELECT count(*) FROM event_signup WHERE principal_id = ?', (member.pid,)).fetchone()[0],
                conn.execute('SELECT count(*) FROM event_submission WHERE principal_id = ?', (member.pid,)).fetchone()[0],
                conn.execute('SELECT count(*) FROM event_vote WHERE voter_id = ? OR candidate_id = ?',
                             (member.pid, mine['id'])).fetchone()[0],
            ]
        self.assertEqual(leftover, [0, 0, 0])

    def client_of(self, client):
        return client


if __name__ == '__main__':
    unittest.main()
