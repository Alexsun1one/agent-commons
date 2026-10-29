import json
from datetime import datetime, timezone
from unittest import mock

from app import accounts, clock
from modules.dm import service
from tests.helpers import HDRS, AppCase

NOW = datetime(2026, 10, 25, 18, 0, tzinfo=timezone.utc).timestamp()


class DmCase(AppCase):
    def setUp(self):
        self.now = NOW
        patcher = mock.patch('app.clock.now_ts', side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()

    def allow_all(self, client):
        response = client.put('/api/dm/settings', headers=HDRS, json={'contact_policy': 'everyone'})
        self.assertEqual(response.status_code, 200, response.text)

    def open(self, sender, recipient, *, accepted=False, ref=None, title=None, peers=None):
        if peers is None:
            peers = recipient.pid
        if not accepted:
            self.allow_all(recipient)
        with mock.patch('modules.dm.service._social_can_see', return_value=accepted):
            response = sender.post('/api/dm/threads', headers=HDRS,
                                   json={'with': peers, 'ref': ref, 'title': title})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['data']

    def send(self, client, thread_id, text, status=201, **extra):
        response = client.post(f'/api/dm/threads/{thread_id}/messages', headers=HDRS,
                               json={'text': text, **extra})
        self.assertEqual(response.status_code, status, response.text)
        return response


class SettingsAndRequestTest(DmCase):
    def test_default_policy_and_stranger_request_one_message(self):
        sender = self.user('sender', level=2)
        recipient = self.user('recipient', level=2)
        self.assertEqual(recipient.get('/api/dm/settings').json()['data']['contact_policy'], 'following')
        blocked = sender.post('/api/dm/threads', headers=HDRS, json={'with': recipient.pid})
        self.assertEqual(blocked.status_code, 403)

        thread = self.open(sender, recipient)
        self.assertEqual(thread['request_state'], 'pending')
        first = self.send(sender, thread['id'], '你好，想问一下市集里的键盘。')
        second = self.send(sender, thread['id'], '再补一句', status=409)
        self.assertEqual(self.code(second), 'state_conflict')
        cannot_reply = self.send(recipient, thread['id'], '还没接受', status=409)
        self.assertEqual(self.code(cannot_reply), 'state_conflict')
        requests = recipient.get('/api/dm/threads?requests=true').json()['data']['items']
        self.assertEqual([item['id'] for item in requests], [thread['id']])
        accepted = recipient.post(f"/api/dm/requests/{thread['id']}/accept", headers=HDRS, json={})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.send(recipient, thread['id'], '可以，继续聊。')
        self.assertEqual(first.json()['data']['seq'], 1)

    def test_following_and_friends_policy_use_social_visibility(self):
        sender = self.user('known_sender', level=2)
        recipient = self.user('known_recipient', level=2)
        with mock.patch('modules.dm.service._social_can_see', side_effect=lambda c, v, o, s: s == 'following'):
            response = sender.post('/api/dm/threads', headers=HDRS, json={'with': recipient.pid})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['data']['request_state'], 'accepted')

        other = self.user('friends_only', level=2)
        other.put('/api/dm/settings', headers=HDRS, json={'contact_policy': 'friends'})
        with mock.patch('modules.dm.service._social_can_see', side_effect=lambda c, v, o, s: s == 'following'):
            denied = sender.post('/api/dm/threads', headers=HDRS, json={'with': other.pid})
        self.assertEqual(denied.status_code, 403)


class PrivacyAndStateTest(DmCase):
    def test_admin_has_no_implicit_body_access_and_read_positions_work(self):
        alice = self.user('alice_dm', level=2)
        bob = self.user('bob_dm', level=2)
        admin = self.user('admin_dm', level=5, roles=('admin',))
        thread = self.open(alice, bob, accepted=True)
        sent = self.send(alice, thread['id'], '只给会话成员看的正文').json()['data']
        hidden = admin.get(f"/api/dm/threads/{thread['id']}/messages")
        self.assertEqual(hidden.status_code, 404)
        self.assertNotIn('只给会话成员看的正文', hidden.text)
        listing = bob.get('/api/dm/threads').json()['data']['items'][0]
        self.assertEqual(listing['unread'], 1)
        read = bob.post(f"/api/dm/threads/{thread['id']}/read", headers=HDRS,
                        json={'seq': sent['seq']})
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual(bob.get('/api/dm/unread-count').json()['data']['count'], 0)

    def test_block_stops_messages_and_never_exposes_presence(self):
        alice = self.user('block_a', level=2)
        bob = self.user('block_b', level=2)
        thread = self.open(alice, bob, accepted=True)
        pair = {alice.pid, bob.pid}
        with mock.patch('modules.dm.service._social_blocked', side_effect=lambda c, a, b: {a, b} == pair):
            denied = self.send(alice, thread['id'], '发不出去', status=403)
            self.assertEqual(self.code(denied), 'action_not_allowed')
            view = alice.get(f"/api/dm/threads/{thread['id']}").json()['data']
        bob_view = next(item for item in view['participants'] if item['id'] == bob.pid)
        self.assertTrue(bob_view['blocked'])
        self.assertIsNone(bob_view['online'])

    def test_recall_window_and_delete_for_self(self):
        alice = self.user('recall_a', level=2)
        bob = self.user('recall_b', level=2)
        thread = self.open(alice, bob, accepted=True)
        first = self.send(alice, thread['id'], '两分钟内撤回').json()['data']
        recalled = alice.post(f"/api/dm/messages/{first['id']}/recall", headers=HDRS, json={})
        self.assertEqual(recalled.status_code, 200, recalled.text)
        visible = bob.get(f"/api/dm/threads/{thread['id']}/messages").json()['data']['items']
        self.assertTrue(visible[0]['recalled'])
        self.assertNotIn('两分钟内撤回', json.dumps(visible, ensure_ascii=False))

        second = self.send(alice, thread['id'], '超过窗口').json()['data']
        self.now += 121
        late = alice.post(f"/api/dm/messages/{second['id']}/recall", headers=HDRS, json={})
        self.assertEqual(late.status_code, 409)
        deleted = bob.post(f"/api/dm/messages/{second['id']}/delete", headers=HDRS, json={})
        self.assertEqual(deleted.status_code, 200, deleted.text)
        bob_items = bob.get(f"/api/dm/threads/{thread['id']}/messages").json()['data']['items']
        alice_items = alice.get(f"/api/dm/threads/{thread['id']}/messages").json()['data']['items']
        self.assertNotIn('超过窗口', json.dumps(bob_items, ensure_ascii=False))
        self.assertIn('超过窗口', json.dumps(alice_items, ensure_ascii=False))


class LimitsReportingAndPurgeTest(DmCase):
    def test_new_account_thread_and_message_limits(self):
        sender = self.user('limited_sender', level=2)
        peers = [self.user(f'limited_peer_{index}', level=2) for index in range(3)]
        for peer in peers:
            self.allow_all(peer)
        for peer in peers[:2]:
            response = sender.post('/api/dm/threads', headers=HDRS, json={'with': peer.pid})
            self.assertEqual(response.status_code, 201, response.text)
        limited = sender.post('/api/dm/threads', headers=HDRS, json={'with': peers[2].pid})
        self.assertEqual(limited.status_code, 429)
        self.assertTrue(limited.headers.get('Retry-After'))

        talker = self.user('limited_talker', level=2)
        listener = self.user('limited_listener', level=2)
        thread = self.open(talker, listener, accepted=True)
        for index in range(10):
            self.send(talker, thread['id'], f'消息 {index}')
        overflow = self.send(talker, thread['id'], '第 11 条', status=429)
        self.assertEqual(self.code(overflow), 'rate_limited')

    def test_report_outbox_contains_only_reported_message(self):
        alice = self.user('report_a', level=2)
        bob = self.user('report_b', level=2)
        thread = self.open(alice, bob, accepted=True)
        flagged = self.send(alice, thread['id'], '需要治理查看的这一条').json()['data']
        self.send(alice, thread['id'], '另一条私密正文不能随举报提交')
        reported = bob.post(f"/api/dm/messages/{flagged['id']}/report", headers=HDRS,
                            json={'reason': '疑似骚扰'})
        self.assertEqual(reported.status_code, 201, reported.text)
        event = self.db.conn().execute(
            "SELECT payload_json FROM outbox_event WHERE event_type = 'dm.reported'"
        ).fetchone()
        self.assertIsNotNone(event)
        self.assertIn('需要治理查看的这一条', event['payload_json'])
        self.assertNotIn('另一条私密正文不能随举报提交', event['payload_json'])

    def test_account_purge_replaces_message_body(self):
        alice = self.user('purge_a', level=2)
        bob = self.user('purge_b', level=2)
        thread = self.open(alice, bob, accepted=True)
        self.send(alice, thread['id'], '注销后不应保留这段正文')
        old = clock.iso(self.now - 8 * 86400)
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'pending_deletion', delete_requested_at = ? WHERE id = ?",
                         (old, alice.pid))
        accounts.purge_due(self.db, self.settings)
        items = bob.get(f"/api/dm/threads/{thread['id']}/messages").json()['data']['items']
        encoded = json.dumps(items, ensure_ascii=False)
        self.assertIn('已注销成员的消息', encoded)
        self.assertNotIn('注销后不应保留这段正文', encoded)

    def test_group_limit_reference_and_preferences(self):
        owner = self.user('group_owner', level=3)
        members = [self.user(f'group_member_{index}', level=2) for index in range(19)]
        ref = {'type': 'event', 'id': 'event-1', 'title': '周末共创', 'subtitle': '活动组队',
               'href': '#/events/event-1'}
        group = self.open(owner, members[0], accepted=True, peers=[member.pid for member in members],
                          title='周末共创小队', ref=ref)
        self.assertEqual(group['kind'], 'group')
        self.assertEqual(len(group['participants']), 20)
        pref = owner.put(f"/api/dm/threads/{group['id']}/preference", headers=HDRS,
                         json={'pinned': True, 'muted': True})
        self.assertEqual(pref.status_code, 200, pref.text)
        view = owner.get(f"/api/dm/threads/{group['id']}").json()['data']
        self.assertTrue(view['pinned'])
        self.assertTrue(view['muted'])
        extra = self.user('group_extra', level=2)
        too_many = owner.post('/api/dm/threads', headers=HDRS,
                              json={'with': [member.pid for member in members] + [extra.pid], 'title': '太多人'})
        self.assertEqual(too_many.status_code, 422)
