import json
import unittest
from datetime import datetime, timezone
from unittest import mock

from app import clock, outbox
from tests.helpers import HDRS, AppCase

from modules.notify import templates


NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc).timestamp()


class NotifyCase(AppCase):
    def setUp(self):
        self.now = NOW
        patcher = mock.patch('app.clock.now_ts', side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()

    def emit(self, event_type, aggregate_type, aggregate_id, payload, actor_id=None):
        with self.db.write() as conn:
            event_id = outbox.emit(conn, event_type, aggregate_type, aggregate_id, payload, actor_id=actor_id)
        outbox.dispatch(self.db, limit=1000)
        return event_id

    def prefs(self, client, **overrides):
        body = {'categories': {}, 'quiet_start': None, 'quiet_end': None,
                'timezone_offset_min': 0, 'daily_digest': True}
        body.update(overrides)
        response = client.put('/api/notify/preferences', headers=HDRS, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def reply(self, owner, replier, title='通知测试'):
        root = self.obj(owner, title=title)
        reply = self.obj(replier, type='reply', title='回复', root_id=root['id'])
        outbox.dispatch(self.db, limit=1000)
        return root, reply


class DeliveryTest(NotifyCase):
    def test_reply_event_generates_and_merges_notification(self):
        owner = self.user('owner')
        first = self.user('first')
        second = self.user('second')
        root = self.obj(owner, title='合并讨论')
        self.obj(first, type='reply', title='第一条', root_id=root['id'])
        self.obj(second, type='reply', title='第二条', root_id=root['id'])
        outbox.dispatch(self.db, limit=1000)

        response = owner.get('/api/notify/notifications')
        self.assertEqual(response.status_code, 200, response.text)
        items = response.json()['data']['items']
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]['category'], items[0]['event_count']), ('reply', 2))
        self.assertEqual(items[0]['title'], '2 人回复了你')
        self.assertEqual({person['id'] for person in items[0]['actors']}, {first.pid, second.pid})
        self.assertEqual(owner.get('/api/notify/unread-count').json()['data']['count'], 1)

    def test_single_reply_derives_actor_from_object(self):
        owner = self.user('single_owner')
        replier = self.user('single_replier')
        self.reply(owner, replier, title='单条讨论')
        item = owner.get('/api/notify/notifications').json()['data']['items'][0]
        self.assertEqual(item['title'], 'single_replier 回复了你')
        self.assertEqual([person['id'] for person in item['actors']], [replier.pid])

    def test_invisible_recipient_does_not_receive_notification(self):
        owner = self.user('private_owner')
        allowed = self.user('allowed')
        outsider = self.user('outsider')
        private = self.obj(owner, title='指定人内容', visibility='named', acl=[allowed.pid])
        self.emit('governance.case.closed', 'object', private['id'], {
            'recipient_id': outsider.pid, 'object_id': private['id'], 'message': '处置完成',
        })
        count = self.db.conn().execute('SELECT count(*) FROM notification WHERE recipient_id = ?',
                                       (outsider.pid,)).fetchone()[0]
        self.assertEqual(count, 0)

    def test_disabled_category_is_not_generated(self):
        recipient = self.user('pref_user')
        self.prefs(recipient, categories={'governance': False})
        self.emit('governance.case.closed', 'case', 'case-1', {
            'recipient_id': recipient.pid, 'message': '处置完成',
        })
        count = self.db.conn().execute('SELECT count(*) FROM notification WHERE recipient_id = ?',
                                       (recipient.pid,)).fetchone()[0]
        self.assertEqual(count, 0)

    def test_quiet_hours_delay_without_dropping(self):
        recipient = self.user('quiet_user')
        self.prefs(recipient, quiet_start='11:00', quiet_end='13:00')
        self.emit('notify.system.notice', 'system', 'maintenance', {
            'recipient_id': recipient.pid, 'message': '稍后维护',
        })
        row = self.db.conn().execute('SELECT available_at FROM notification WHERE recipient_id = ?',
                                     (recipient.pid,)).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row['available_at'], '2026-10-25T13:00:00.000000Z')
        self.assertEqual(recipient.get('/api/notify/unread-count').json()['data']['count'], 0)
        self.now += 3601
        self.assertEqual(recipient.get('/api/notify/unread-count').json()['data']['count'], 1)

    def test_growth_event_uses_aggregate_recipient(self):
        recipient = self.user('level_user')
        self.emit('growth.level_changed', 'principal', recipient.pid, {
            'from': 1, 'to': 2, 'message': '你升级了',
        })
        item = recipient.get('/api/notify/notifications').json()['data']['items'][0]
        self.assertEqual((item['category'], item['title']), ('achievement', '你升级到 L2'))


class InboxTest(NotifyCase):
    def test_mark_read_and_cross_user_isolation(self):
        recipient = self.user('reader')
        stranger = self.user('stranger')
        self.emit('notify.system.notice', 'system', 'one', {
            'recipient_id': recipient.pid, 'message': '只给本人',
        })
        item = recipient.get('/api/notify/notifications').json()['data']['items'][0]
        self.assertEqual(stranger.get('/api/notify/notifications').json()['data']['items'], [])
        denied = stranger.post(f"/api/notify/notifications/{item['id']}/read", headers=HDRS, json={})
        self.assertEqual((denied.status_code, denied.json()['error']['code']), (404, 'resource_not_found'))
        marked = recipient.post(f"/api/notify/notifications/{item['id']}/read", headers=HDRS, json={})
        self.assertEqual(marked.status_code, 200, marked.text)
        self.assertEqual(recipient.get('/api/notify/unread-count').json()['data']['count'], 0)

    def test_mark_all_can_filter_category(self):
        recipient = self.user('all_reader')
        self.emit('notify.system.notice', 'system', 'system-one', {
            'recipient_id': recipient.pid, 'message': '系统消息',
        })
        self.emit('governance.case.closed', 'case', 'gov-one', {
            'recipient_id': recipient.pid, 'message': '治理消息',
        })
        response = recipient.post('/api/notify/notifications/read-all', headers=HDRS, json={'category': 'system'})
        self.assertEqual(response.json()['data']['updated'], 1)
        self.assertEqual(recipient.get('/api/notify/unread-count').json()['data']['count'], 1)

    def test_list_uses_user_bound_cursor(self):
        recipient = self.user('cursor_reader')
        stranger = self.user('cursor_stranger')
        for index in range(3):
            self.emit('notify.system.notice', 'system', f'system-{index}', {
                'recipient_id': recipient.pid, 'message': f'系统消息 {index}',
            })
            self.now += 1
        first = recipient.get('/api/notify/notifications?category=system&limit=2')
        self.assertEqual(len(first.json()['data']['items']), 2)
        cursor = first.json()['meta']['cursor']
        second = recipient.get('/api/notify/notifications', params={
            'category': 'system', 'limit': 2, 'cursor': cursor,
        })
        self.assertEqual(len(second.json()['data']['items']), 1)
        denied = stranger.get('/api/notify/notifications', params={
            'category': 'system', 'limit': 2, 'cursor': cursor,
        })
        self.assertEqual((denied.status_code, denied.json()['error']['code']), (409, 'cursor_stale'))

    def test_withdrawn_target_becomes_unavailable(self):
        owner = self.user('withdraw_owner')
        replier = self.user('withdraw_replier')
        root, _ = self.reply(owner, replier, title='稍后撤回')
        response = owner.post(f"/api/objects/{root['id']}/withdraw", headers=HDRS, json={})
        self.assertEqual(response.status_code, 200, response.text)
        item = owner.get('/api/notify/notifications').json()['data']['items'][0]
        self.assertTrue(item['unavailable'])
        self.assertEqual((item['title'], item['link']), ('内容已不可见', None))
        digest = owner.get('/api/notify/daily-digest?day=2026-10-25').json()['data']
        self.assertEqual(digest['categories'][0]['items'][0]['title'], '内容已不可见')

    def test_preferences_round_trip_and_reject_partial_quiet_hours(self):
        recipient = self.user('settings_user')
        saved = self.prefs(recipient, categories={'room': False}, quiet_start='22:30', quiet_end='07:00',
                           timezone_offset_min=480, daily_digest=False)
        self.assertFalse(saved['categories']['room'])
        self.assertTrue(saved['categories']['reply'])
        self.assertEqual((saved['quiet_start'], saved['quiet_end'], saved['timezone_offset_min']),
                         ('22:30', '07:00', 480))
        bad = recipient.put('/api/notify/preferences', headers=HDRS, json={
            'categories': {}, 'quiet_start': '22:00', 'quiet_end': None,
            'timezone_offset_min': 0, 'daily_digest': True,
        })
        self.assertEqual((bad.status_code, bad.json()['error']['code']), (422, 'validation_failed'))


class SocialNotificationTest(NotifyCase):
    def test_six_social_events_generate_direct_links(self):
        recipient = self.user('social_recipient')
        actor = self.user('social_actor')
        post = self.obj(recipient, title='社交动态')
        cases = (
            ('social.followed', 'principal', recipient.pid, {}, 'social_follow', '#/u/social_actor'),
            ('social.poked', 'principal', recipient.pid, {}, 'social_poke', '#/u/social_actor'),
            ('social.reacted', 'object', post['id'], {'object_id': post['id']},
             'social_reaction', f"#/feed/{post['id']}"),
            ('social.shared', 'object', post['id'], {'object_id': post['id']},
             'social_share', f"#/feed/{post['id']}"),
            ('social.group.join_requested', 'social_group', 'group-one', {'group': 'agent-eng'},
             'social_join_request', '#/group/agent-eng/members'),
            ('social.group.join_approved', 'social_group', 'group-one', {'group': 'agent-eng'},
             'social_join_approved', '#/group/agent-eng'),
        )
        for event_type, aggregate_type, aggregate_id, extra, _, _ in cases:
            self.emit(event_type, aggregate_type, aggregate_id, {
                'recipient_id': recipient.pid, 'message': '社交通知', **extra,
            }, actor_id=actor.pid)
            self.now += 1

        items = recipient.get('/api/notify/notifications?limit=50').json()['data']['items']
        actual = {item['category']: item['link'] for item in items}
        expected = {category: link for _, _, _, _, category, link in cases}
        self.assertEqual(actual, expected)

    def test_social_preferences_are_independent(self):
        recipient = self.user('social_pref_recipient')
        actor = self.user('social_pref_actor')
        self.prefs(recipient, categories={'social_poke': False})
        self.emit('social.followed', 'principal', recipient.pid, {
            'recipient_id': recipient.pid, 'message': '关注了你',
        }, actor_id=actor.pid)
        self.emit('social.poked', 'principal', recipient.pid, {
            'recipient_id': recipient.pid, 'message': '戳了你一下',
        }, actor_id=actor.pid)

        items = recipient.get('/api/notify/notifications?limit=50').json()['data']['items']
        self.assertEqual([item['category'] for item in items], ['social_follow'])
        prefs = recipient.get('/api/notify/preferences').json()['data']['categories']
        self.assertFalse(prefs['social_poke'])
        for category in (
            'social_follow', 'social_reaction', 'social_share',
            'social_join_request', 'social_join_approved',
        ):
            self.assertTrue(prefs[category])


class Notif2Test(NotifyCase):
    def seed_event(self, host, event_id, title='先锋挑战'):
        stamp = clock.now()
        with self.db.write() as conn:
            conn.execute(
                "INSERT INTO community_event (id, slug, kind, title, summary, host_id, host_name, "
                "starts_at, ends_at, status, created_at, updated_at) "
                "VALUES (?, ?, 'challenge', ?, '', ?, ?, ?, ?, 'upcoming', ?, ?)",
                (event_id, f'slug-{event_id}', title, host.pid, host.pid,
                 '2026-10-25T13:00:00.000000Z', '2026-10-26T13:00:00.000000Z', stamp, stamp))

    def seed_bounty(self, owner, bounty_id):
        post = self.obj(owner, title='悬赏帖')
        stamp = clock.now()
        with self.db.write() as conn:
            conn.execute(
                "INSERT INTO bounty (id, kind, object_id, owner_id, status, credits, deadline_at, "
                "settle_after, season, created_at, updated_at) "
                "VALUES (?, 'help', ?, ?, 'open', 20, ?, ?, '2026-10', ?, ?)",
                (bounty_id, post['id'], owner.pid, '2026-10-26T00:00:00.000000Z',
                 '2026-10-29T00:00:00.000000Z', stamp, stamp))
        return post

    def test_park_stolen_notifies_owner_not_thief(self):
        owner = self.user('farm_owner')
        thief = self.user('farm_thief')
        self.emit('farm.stolen', 'farm', owner.pid, {
            'recipient_id': owner.pid, 'thief_id': thief.pid, 'plot_index': 1, 'amount': 3,
            'crop': 'bamboo', 'message': '抱走了 3 根竹子份的青菜',
        }, actor_id=thief.pid)
        items = owner.get('/api/notify/notifications').json()['data']['items']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['category'], 'park')
        self.assertEqual(thief.get('/api/notify/notifications').json()['data']['items'], [])

    def test_event_live_notifies_signups(self):
        host = self.user('event_host')
        guest = self.user('event_guest')
        event_id = 'evt-live-1'
        self.seed_event(host, event_id)
        with self.db.write() as conn:
            conn.execute('INSERT INTO event_signup (event_id, principal_id, created_at) VALUES (?, ?, ?)',
                         (event_id, guest.pid, clock.now()))
        self.emit('events.status_changed', 'event', event_id, {'from': 'upcoming', 'to': 'live'})
        items = guest.get('/api/notify/notifications').json()['data']['items']
        self.assertEqual((items[0]['category'], items[0]['title']), ('event', '你报名的活动开始了'))
        self.assertEqual(host.get('/api/notify/notifications').json()['data']['items'], [])

    def test_bounty_submission_notifies_owner(self):
        owner = self.user('bounty_owner')
        helper = self.user('bounty_helper')
        bounty_id = 'bty-sub-1'
        self.seed_bounty(owner, bounty_id)
        self.emit('bounty.submission_created', 'promo_submission', 'sub-1',
                  {'bounty_id': bounty_id, 'task_id': 'task-1'}, actor_id=helper.pid)
        items = owner.get('/api/notify/notifications').json()['data']['items']
        self.assertEqual(items[0]['category'], 'bounty')
        self.assertIn('回答了你的悬赏', items[0]['title'])

    def test_market_wanted_notifies_author(self):
        author = self.user('market_author')
        buyer = self.user('market_buyer')
        self.emit('market.wanted', 'market_listing', 'listing-1', {
            'recipient_id': author.pid, 'actor_id': buyer.pid,
        }, actor_id=buyer.pid)
        items = author.get('/api/notify/notifications').json()['data']['items']
        self.assertEqual(items[0]['category'], 'market')
        self.assertEqual(buyer.get('/api/notify/notifications').json()['data']['items'], [])

    def test_dm_count_only_has_no_body(self):
        recipient = self.user('dm_reader')
        sender = self.user('dm_sender')
        self.emit('notify.system.dm', 'dm_message', 'msg-1', {
            'recipient_id': recipient.pid, 'message': '秘密正文不该出现', 'target_id': 'thread-1',
        }, actor_id=sender.pid)
        item = recipient.get('/api/notify/notifications').json()['data']['items'][0]
        self.assertEqual(item['category'], 'dm')
        self.assertEqual(item['title'], '你有一条新私信')
        self.assertEqual(item['body'], '')
        self.assertNotIn('秘密正文', item['title'] + item['body'])

    def test_announce_category_is_known_without_invented_event(self):
        member = self.user('announce_user')
        prefs = member.get('/api/notify/preferences').json()['data']
        self.assertTrue(prefs['categories']['announce'])
        listing = member.get('/api/notify/notifications?category=announce')
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(listing.json()['data']['items'], [])

    def test_park_events_merge_within_thirty_minutes(self):
        owner = self.user('merge_owner')
        first = self.user('merge_a')
        second = self.user('merge_b')
        third = self.user('merge_c')
        for actor in (first, second, third):
            self.emit('farm.stolen', 'farm', owner.pid, {
                'recipient_id': owner.pid, 'thief_id': actor.pid, 'amount': 1,
                'message': '抱走了一点菜',
            }, actor_id=actor.pid)
            self.now += 60
        items = owner.get('/api/notify/notifications').json()['data']['items']
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]['category'], items[0]['event_count']), ('park', 3))
        self.assertEqual(items[0]['title'], '3 位好友来过你的农场')
        self.assertEqual({person['id'] for person in items[0]['actors']}, {first.pid, second.pid, third.pid})

    def test_blocked_actor_does_not_notify(self):
        owner = self.user('block_owner')
        stranger = self.user('block_stranger')
        with self.db.write() as conn:
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (owner.pid, stranger.pid, clock.now()))
        self.emit('farm.stolen', 'farm', owner.pid, {
            'recipient_id': owner.pid, 'thief_id': stranger.pid, 'amount': 2, 'message': '不该看见',
        }, actor_id=stranger.pid)
        self.assertEqual(self.db.conn().execute(
            'SELECT count(*) FROM notification WHERE recipient_id = ?', (owner.pid,)).fetchone()[0], 0)

    def test_closed_playground_skips_park(self):
        owner = self.user('quiet_park')
        visitor = self.user('park_visitor')
        with self.db.write() as conn:
            conn.execute(
                'INSERT INTO game_preference (principal_id, playground_enabled, updated_at) VALUES (?, 0, ?)',
                (owner.pid, clock.now()))
        self.emit('parking.ticketed', 'parking_stay', 'stay-1', {
            'recipient_id': owner.pid, 'lot_owner_id': visitor.pid, 'slot_no': 2, 'fine': 4,
        }, actor_id=visitor.pid)
        self.assertEqual(self.db.conn().execute(
            'SELECT count(*) FROM notification WHERE recipient_id = ?', (owner.pid,)).fetchone()[0], 0)


class DigestTest(unittest.TestCase):
    def test_daily_digest_is_pure_structured_data(self):
        rows = [
            {'id': 'n1', 'category': 'reply', 'title': '有人回复你', 'body': '正文', 'link': '#/x',
             'occurred_at': '2026-10-24T08:00:00.000000Z', 'read_at': None},
            {'id': 'n2', 'category': 'system', 'title': '系统消息', 'body': '正文', 'link': None,
             'occurred_at': '2026-10-24T09:00:00.000000Z', 'read_at': '2026-10-24T10:00:00.000000Z'},
        ]
        first = templates.build_daily_digest(rows, '2026-10-24')
        second = templates.build_daily_digest(rows, '2026-10-24')
        self.assertEqual(first, second)
        self.assertEqual((first['title'], first['total'], first['unread']), ('昨天你错过了什么', 2, 1))
        self.assertEqual([group['category'] for group in first['categories']], ['reply', 'system'])


if __name__ == '__main__':
    unittest.main()

