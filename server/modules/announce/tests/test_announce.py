import json
import unittest
from datetime import datetime, timezone
from unittest import mock

from app import accounts, clock
from tests.helpers import HDRS, AppCase


NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc).timestamp()
DAY = 86400
OPEN = '2026-10-20T00:00:00.000000Z'
CLOSE = '2026-10-30T00:00:00.000000Z'


class AnnounceTest(AppCase):
    def setUp(self):
        self.now = NOW
        patcher = mock.patch('app.clock.now_ts', side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()

    def admin(self, handle='root'):
        return self.user(handle, roles=['admin'], totp=True)

    def post(self, client, path, body, status=201):
        response = client.post(path, headers=HDRS, json=body)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()['data'] if status < 300 else response

    def item(self, **over):
        body = {
            'level': 'normal', 'title': '周六短暂停机', 'body': '凌晨一点到两点。',
            'audience': 'site', 'starts_at': OPEN, 'ends_at': CLOSE, 'dismissible': True,
        }
        body.update(over)
        return body

    def campaign(self, **over):
        body = {
            'name': '方法小课', 'placement': 'hot-side', 'image_url': 'assets/illus/cover-hot.webp',
            'line': '本周方法小课', 'link_url': '#/talks', 'why': '热点页的赞助位',
            'starts_at': OPEN, 'ends_at': CLOSE,
        }
        body.update(over)
        return body

    def active(self, client, route=''):
        response = client.get('/api/announce/active', params={'route': route})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def test_rules_are_only_announce(self):
        with self.db.read() as conn:
            actions = [row[0] for row in conn.execute(
                "SELECT action FROM action_rule WHERE action LIKE 'announce.%' ORDER BY action")]
        self.assertEqual(actions, ['announce.admin', 'announce.pref', 'announce.read'])

    def test_audience_level_and_group(self):
        admin = self.admin()
        outsider = self.user('outsider', level=2)
        senior = self.user('senior', level=3)
        insider = self.user('insider', level=1)
        with self.db.write() as conn:
            space_id = accounts.create_space(conn, admin.pid, 'farm-group', '农场小组', 'group')
            accounts.set_membership(conn, space_id, insider.pid, 'active')
        self.post(admin, '/api/admin/announce/items', self.item(title='全站通知', body='所有人都能看见。'))
        self.post(admin, '/api/admin/announce/items', self.item(
            title='等级通知', body='L3 才能看见。', audience='level', min_level=3,
            starts_at='2026-10-22T00:00:00.000000Z'))
        self.post(admin, '/api/admin/announce/items', self.item(
            title='小组通知', body='只给农场小组。', audience='group', group_id=space_id, level='important'))

        self.assertEqual(self.active(outsider)['announcement']['title'], '全站通知')
        self.assertEqual(self.active(senior)['announcement']['title'], '等级通知')
        self.assertEqual(self.active(insider)['announcement']['title'], '小组通知')
        titles = {row['title'] for row in outsider.get('/api/announce/history').json()['data']['items']}
        self.assertEqual(titles, {'全站通知'})
        denied = self.post(admin, '/api/admin/announce/items', self.item(
            audience='group', group_id='missing-space', title='不存在的小组', body='不会写入。'), status=422)
        self.assertEqual(self.code(denied), 'validation_failed')

    def test_time_window_and_priority(self):
        admin = self.admin()
        member = self.user('reader')
        self.post(admin, '/api/admin/announce/items', self.item(
            title='已经结束', body='不该再出现。', ends_at='2026-10-25T00:00:00.000000Z'))
        self.post(admin, '/api/admin/announce/items', self.item(
            title='尚未开始', body='不该提前出现。', starts_at='2026-10-26T00:00:00.000000Z',
            ends_at='2026-10-28T00:00:00.000000Z'))
        self.post(admin, '/api/admin/announce/items', self.item(title='普通通知', body='级别较低。', level='normal'))
        important = self.post(admin, '/api/admin/announce/items', self.item(
            title='重要通知', body='同一时间只留这一条。', level='important'))
        self.post(admin, '/api/admin/announce/items', self.item(
            title='维护通知', body='排在重要后面。', level='maintenance'))
        self.post(admin, '/api/admin/announce/items', self.item(
            title='还是草稿', body='读者看不见。', status='draft'))
        open_ended = self.post(admin, '/api/admin/announce/items', self.item(
            title='一直有效', body='没有结束时间。', ends_at=None, level='normal'))

        shown = self.active(member)['announcement']
        self.assertEqual(shown['id'], important['id'])
        self.assertIsNone(open_ended['ends_at'])
        history = {row['title']: row for row in member.get('/api/announce/history').json()['data']['items']}
        self.assertNotIn('尚未开始', history)
        self.assertNotIn('还是草稿', history)
        self.assertIn('已经结束', history)
        self.assertFalse(history['已经结束']['current'])
        self.assertTrue(history['重要通知']['current'])

    def test_dismiss_is_personal_and_respects_the_flag(self):
        admin = self.admin()
        first = self.user('first')
        second = self.user('second')
        locked = self.post(admin, '/api/admin/announce/items', self.item(
            title='不能关', body='维护期间留着。', level='maintenance', dismissible=False))
        closable = self.post(admin, '/api/admin/announce/items', self.item(
            title='可以关', body='关掉后换下一条。', level='important', dismissible=True))
        self.assertEqual(self.active(first)['announcement']['id'], closable['id'])
        blocked = first.post(f"/api/announce/items/{locked['id']}/dismiss", headers=HDRS, json={})
        self.assertEqual((blocked.status_code, self.code(blocked)), (409, 'state_conflict'))
        self.assertEqual(self.post(first, f"/api/announce/items/{closable['id']}/dismiss", {}, status=200)['dismissed'], True)
        self.assertEqual(self.active(first)['announcement']['id'], locked['id'])
        self.assertEqual(self.active(second)['announcement']['id'], closable['id'])
        again = self.post(first, f"/api/announce/items/{closable['id']}/dismiss", {}, status=200)
        self.assertTrue(again['dismissed'])

    def test_frequency_cap_is_per_person_per_day_and_stats_stay_aggregate(self):
        admin = self.admin()
        viewer = self.user('viewer')
        other = self.user('other')
        ad = self.post(admin, '/api/admin/announce/campaigns', self.campaign(freq_cap=3))
        self.assertIsNone(ad['budget_cents'])
        newer = self.post(admin, '/api/admin/announce/campaigns', self.campaign(
            name='较新的一条', line='只留这一条', starts_at='2026-10-24T00:00:00.000000Z'))
        slot = self.active(viewer, 'home')['ads']['slots']['hot-side']
        self.assertEqual(slot['id'], newer['id'])
        self.assertEqual(len([value for value in self.active(viewer, 'home')['ads']['slots'].values() if value]), 1)
        for _ in range(4):
            self.assertEqual(self.active(viewer, 'home')['ads']['slots']['hot-side']['id'], newer['id'])
        for index in range(3):
            seen = self.post(viewer, f"/api/announce/campaigns/{newer['id']}/impression",
                             {'placement': 'hot-side', 'route': 'home'}, status=200)
            self.assertEqual(seen['shown'], index + 1)
            self.assertNotIn('principal_id', seen)
        self.assertEqual(self.active(viewer, 'home')['ads']['slots']['hot-side']['id'], ad['id'])
        blocked = viewer.post(f"/api/announce/campaigns/{newer['id']}/impression", headers=HDRS,
                              json={'placement': 'hot-side', 'route': 'home'})
        self.assertEqual((blocked.status_code, self.code(blocked)), (409, 'state_conflict'))
        self.assertEqual(self.active(other, 'home')['ads']['slots']['hot-side']['id'], newer['id'])
        self.now += DAY
        self.assertEqual(self.active(viewer, 'home')['ads']['slots']['hot-side']['id'], newer['id'])
        clicked = self.post(other, f"/api/announce/campaigns/{newer['id']}/click",
                            {'placement': 'hot-side', 'route': 'home'}, status=200)
        self.assertEqual(clicked['aggregate']['clicks'], 1)
        self.assertNotIn('principal_id', json.dumps(clicked))
        with self.db.read() as conn:
            cap = conn.execute('SELECT shown FROM announce_ad_cap WHERE principal_id = ? AND campaign_id = ?',
                               (other.pid, newer['id'])).fetchone()
        self.assertIsNone(cap)
        stats = admin.get('/api/admin/announce/stats')
        self.assertEqual(stats.status_code, 200, stats.text)
        text = stats.text
        self.assertNotIn('principal_id', text)
        self.assertNotIn(viewer.pid, text)
        self.assertGreaterEqual(sum(row['impressions'] for row in stats.json()['data']['rows']), 3)

    def test_blocked_routes_and_hide_preferences(self):
        admin = self.admin()
        member = self.user('member', level=1)
        senior = self.user('senior', level=3)
        paid = self.user('paid', level=1)
        ad = self.post(admin, '/api/admin/announce/campaigns', self.campaign())
        self.post(admin, '/api/admin/announce/ticker', {'body': '林栖在打榜里冲到第 2', 'kind': 'manual'})
        notice = self.post(admin, '/api/admin/announce/items', self.item(title='仍要显示', body='关广告不影响公告。'))

        for route in ('read', 'read/post-1', 'write', 'write/new', 'talk/demo', 'exam', 'exam/1', 'rooms/1/replay'):
            payload = self.active(member, route)
            self.assertTrue(payload['ads']['blocked'], route)
            self.assertTrue(all(value is None for value in payload['ads']['slots'].values()), route)
            rejected = member.post(f"/api/announce/campaigns/{ad['id']}/impression", headers=HDRS,
                                   json={'placement': 'hot-side', 'route': route})
            self.assertEqual(rejected.status_code, 409, route)
        for route in ('', 'home', 'talks', 'talk/new', 'hot', 'events', 'market', 'games'):
            payload = self.active(member, route)
            self.assertFalse(payload['ads']['blocked'], route)
            self.assertEqual(payload['ads']['slots']['hot-side']['id'], ad['id'])

        denied = self.post(member, '/api/announce/prefs', {'ads_on': False}, status=403)
        self.assertEqual(self.code(denied), 'action_not_allowed')
        self.assertTrue(self.active(member)['prefs']['ads_on'])
        self.assertFalse(self.post(member, '/api/announce/prefs', {'marquee_on': False}, status=200)['marquee_on'])
        quiet = self.active(member)
        self.assertEqual(quiet['marquee']['items'], [])
        self.assertFalse(quiet['marquee']['enabled'])
        self.assertEqual(quiet['announcement']['id'], notice['id'])

        self.assertTrue(self.post(senior, '/api/announce/prefs', {'ads_on': False}, status=200)['ads_on'] is False)
        hidden = self.active(senior, 'home')
        self.assertTrue(hidden['ads']['hidden'])
        self.assertIsNone(hidden['ads']['slots']['hot-side'])
        self.assertFalse(hidden['ads']['blocked'])

        with self.db.write() as conn:
            conn.execute(
                'INSERT INTO billing_subscription (id, principal_id, plan_key, cycle, seats, state, source, '
                'period_start, period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                ('sub-paid', paid.pid, 'pioneer', 'month', 1, 'active', 'admin', OPEN, CLOSE, OPEN, OPEN))
        self.assertFalse(self.post(paid, '/api/announce/prefs', {'ads_on': False}, status=200)['ads_on'])
        self.assertTrue(self.active(paid, 'home')['ads']['hidden'])

    def test_system_lines_reject_private_events(self):
        admin = self.admin()
        member = self.user('passer')
        rejected = self.post(admin, '/api/admin/announce/ticker', {
            'body': '某人不该被点名', 'kind': 'system', 'public': False,
        }, status=403)
        self.assertEqual(self.code(rejected), 'action_not_allowed')
        with self.db.read() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM announce_ticker').fetchone()[0], 0)
        self.post(admin, '/api/admin/announce/ticker', {'body': '本周新解决 18 个问题', 'kind': 'system', 'public': True})
        self.post(admin, '/api/admin/announce/ticker', {'body': '农场今晚 10 点双倍收成', 'kind': 'manual'})
        bodies = [row['body'] for row in self.active(member)['marquee']['items']]
        self.assertEqual(bodies, ['本周新解决 18 个问题', '农场今晚 10 点双倍收成'])
        queued = admin.get('/api/admin/announce/ticker').json()['data']['items']
        self.assertTrue(all(row['public'] for row in queued))
        locked = admin.patch(f"/api/admin/announce/ticker/{queued[0]['id']}", headers=HDRS, json={'public': False})
        self.assertEqual((locked.status_code, self.code(locked)), (403, 'action_not_allowed'))

    def test_admin_guard_calendar_and_purge(self):
        member = self.user('plain')
        denied = member.post('/api/admin/announce/items', headers=HDRS, json=self.item())
        self.assertEqual((denied.status_code, self.code(denied)), (403, 'action_not_allowed'))
        bare = self.user('bareadmin', roles=['admin'], totp=False)
        needs_totp = bare.post('/api/admin/announce/items', headers=HDRS, json=self.item())
        self.assertEqual((needs_totp.status_code, self.code(needs_totp)), (403, 'totp_setup_required'))
        self.assertEqual(self.client().get('/api/announce/active').status_code, 401)

        admin = self.admin('calendaradmin')
        bad = self.post(admin, '/api/admin/announce/campaigns', self.campaign(link_url='javascript:alert(1)'), status=422)
        self.assertEqual(self.code(bad), 'validation_failed')
        ad = self.post(admin, '/api/admin/announce/campaigns', self.campaign())
        self.assertIsNone(ad['budget_cents'])
        days = admin.get('/api/admin/announce/calendar', params={'start': '2026-10-01', 'end': '2026-11-01'})
        self.assertEqual(days.status_code, 200, days.text)
        self.assertEqual(days.json()['data']['items'][0]['id'], ad['id'])
        viewer = self.user('capowner')
        self.post(viewer, f"/api/announce/campaigns/{ad['id']}/impression",
                  {'placement': 'hot-side', 'route': 'home'}, status=200)
        self.post(viewer, f"/api/announce/items/{self.post(admin, '/api/admin/announce/items', self.item())['id']}/dismiss",
                  {}, status=200)
        self.post(viewer, '/api/announce/prefs', {'marquee_on': False}, status=200)
        from app import accounts as account_api
        from modules.announce.service import purge
        self.assertIn(purge, account_api.PURGERS)
        with self.db.write() as conn:
            purge(conn, viewer.pid)
            self.assertIsNone(conn.execute('SELECT 1 FROM announce_ad_cap WHERE principal_id = ?', (viewer.pid,)).fetchone())
            self.assertIsNone(conn.execute('SELECT 1 FROM announce_dismiss WHERE principal_id = ?', (viewer.pid,)).fetchone())
            self.assertIsNone(conn.execute('SELECT 1 FROM announce_pref WHERE principal_id = ?', (viewer.pid,)).fetchone())
            self.assertEqual(conn.execute('SELECT impressions FROM announce_ad_stat').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
