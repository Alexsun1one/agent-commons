"""R17-H · 社区祝福、关掉推荐人、阅读入口、找搭子、赞助/讲师申请、房间文字讨论。
运行：cd server && python3 -m unittest tests.test_r17h_backend -q"""
from datetime import timedelta

from app import clock, outbox
from app.authz import Actor
from modules.rooms.tests import test_rooms as tr
from modules.social import extras
from modules.social.tests import test_social as ts

BUDDY = {'kind': 'project', 'title': '把检索原型做成可复现作品', 'outcome': '一个能跑的原型', 'schedule': '每周 3 小时',
         'contribution': '我写评测脚本', 'partner': '一位懂交互的伙伴'}
INVITE = {'kind': 'review', 'title': '互相评审周报 Agent', 'outcome': '两份评审记录', 'schedule': '每周 2 小时',
          'contribution': '我评你的提示词'}


class Base(ts.SocialCase):
    def age(self, client, days_ago=365, shift=0):
        """把某人的注册时间改成「一年前（再偏移 shift 天）」，让入群纪念日落在今天前后。"""
        stamp = clock.iso(clock.now_ts() - (days_ago + shift) * 86400)
        with self.db.write() as conn:
            conn.execute('UPDATE principal SET created_at = ? WHERE id = ?', (stamp, client.pid))

    def prefs(self, client, **body):
        r = self.put(client, '/api/social/me/prefs', body)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['data']


class BlessingTest(Base):
    def test_anniversary_list_bless_once_and_notify(self):
        a, b = self.user('alice'), self.user('bobby')
        self.follow(a, 'bobby')
        self.assertEqual(a.get('/api/social/anniversaries').json()['data']['items'], [])
        self.age(b, 366)
        items = a.get('/api/social/anniversaries').json()['data']['items']
        self.assertEqual([(i['handle'], i['years'], i['text'], i['blessed_today']) for i in items],
                         [('bobby', 1, '入群一周年', False)])
        r = self.post(a, '/api/social/blessings/bobby', status=200)
        self.assertEqual(r.json()['data']['years'], 1)
        self.assertEqual(self.post(a, '/api/social/blessings/bobby').status_code, 409)
        self.assertTrue(a.get('/api/social/anniversaries').json()['data']['items'][0]['blessed_today'])
        events = self.events('social.blessed')
        self.assertEqual([(e['recipient_id'], e['actor_id']) for e in events], [(b.pid, a.pid)])
        self.assertIn('入群一周年', events[0]['message'])

    def test_rules_follow_first_real_anniversary_self_block_and_daily_cap(self):
        a, b, c, d = self.user('alice'), self.user('bobby'), self.user('carol'), self.user('dolly')
        self.age(b, 365)
        self.assertEqual(self.post(a, '/api/social/blessings/bobby').status_code, 409)  # 没关注
        self.follow(a, 'bobby')
        self.follow(a, 'carol')
        self.assertEqual(self.post(a, '/api/social/blessings/carol').status_code, 409)  # 今天刚注册，没有纪念日
        self.assertEqual(self.post(a, '/api/social/blessings/alice').status_code, 422)  # 自己
        self.age(d, 365)
        self.follow(a, 'dolly')
        old = extras.BLESS_DAY
        extras.BLESS_DAY = 1
        try:
            self.assertEqual(self.post(a, '/api/social/blessings/bobby').status_code, 200)
            self.assertEqual(self.post(a, '/api/social/blessings/dolly').status_code, 429)
        finally:
            extras.BLESS_DAY = old
        self.put(d, '/api/social/blocks/alice')
        self.assertEqual(self.post(a, '/api/social/blessings/dolly').status_code, 404)  # 拉黑后看不见
        self.assertEqual([i['handle'] for i in a.get('/api/social/anniversaries').json()['data']['items']], ['bobby'])


class DismissTest(Base):
    def test_dismiss_hides_suggestion_and_restore_brings_it_back(self):
        a, b, c = self.user('alice'), self.user('bobby'), self.user('carol')
        self.befriend(a, 'alice', b, 'bobby')
        self.befriend(b, 'bobby', c, 'carol')

        def names():
            return [i['handle'] for i in a.get('/api/social/suggestions').json()['data']['items']]
        self.assertEqual(names(), ['carol'])
        self.assertEqual(self.post(a, '/api/social/suggestions/carol/dismiss', status=200).json()['data'],
                         {'dismissed': True})
        self.assertEqual(names(), [])
        self.assertEqual(self.post(a, '/api/social/suggestions/carol/dismiss', status=200).status_code, 200)
        self.assertEqual(self.delete(a, '/api/social/suggestions/carol/dismiss').json()['data'], {'dismissed': False})
        self.assertEqual(names(), ['carol'])
        self.assertEqual(self.post(a, '/api/social/suggestions/alice/dismiss').status_code, 422)  # 不能对自己
        self.assertEqual(self.post(a, '/api/social/suggestions/nobody_here/dismiss').status_code, 404)


class SignalTest(Base):
    def test_save_list_drop_and_isolation(self):
        a, b = self.user('alice'), self.user('bobby')
        self.assertEqual(self.put(a, '/api/social/signals/W').json()['data'], {'key': 'W', 'saved': True})
        self.put(a, '/api/social/signals/W')
        self.put(a, '/api/social/signals/L')
        self.assertEqual(a.get('/api/social/signals').json()['data']['items'], ['W', 'L'])
        self.assertEqual(b.get('/api/social/signals').json()['data']['items'], [])
        self.assertEqual(self.put(a, '/api/social/signals/bad key!').status_code, 422)
        self.assertEqual(self.put(a, '/api/social/signals/' + 'x' * 41).status_code, 422)
        self.delete(a, '/api/social/signals/W')
        self.assertEqual(a.get('/api/social/signals').json()['data']['items'], ['L'])

    def test_cap(self):
        a = self.user('alice')
        old = extras.SIGNAL_MAX
        extras.SIGNAL_MAX = 2
        try:
            for key in ('a1', 'a2'):
                self.put(a, f'/api/social/signals/{key}')
            self.assertEqual(self.put(a, '/api/social/signals/a3').status_code, 409)
            self.assertEqual(self.put(a, '/api/social/signals/a1').status_code, 200)  # 已有的重复保存不算
        finally:
            extras.SIGNAL_MAX = old


class BuddyTest(Base):
    def test_post_list_filter_pause_and_cap(self):
        a, b = self.user('alice'), self.user('bobby')
        r = self.post(b, '/api/social/buddies', BUDDY, status=201).json()['data']
        self.assertEqual((r['state'], r['author']['handle'], r['contact_open']), ('open', 'bobby', False))
        listed = a.get('/api/social/buddies').json()['data']['items']
        self.assertEqual([i['id'] for i in listed], [r['id']])
        self.assertEqual(a.get('/api/social/buddies?kind=learn').json()['data']['items'], [])
        self.assertEqual(b.get('/api/social/buddies').json()['data']['items'], [])  # 自己的不在广场列表里
        self.assertEqual([i['id'] for i in b.get('/api/social/buddies?mine=true').json()['data']['items']], [r['id']])
        paused = b.patch(f"/api/social/buddies/{r['id']}", headers=ts.HDRS, json={'state': 'paused'}).json()['data']
        self.assertEqual(paused['state'], 'paused')
        self.assertEqual(a.get('/api/social/buddies').json()['data']['items'], [])
        self.assertEqual(a.patch(f"/api/social/buddies/{r['id']}", headers=ts.HDRS, json={'title': 'x'}).status_code, 404)
        edited = b.patch(f"/api/social/buddies/{r['id']}", headers=ts.HDRS, json={'title': '改过的标题', 'state': 'open'})
        self.assertEqual(edited.json()['data']['title'], '改过的标题')
        old = extras.BUDDY_OPEN_MAX
        extras.BUDDY_OPEN_MAX = 1
        try:
            self.assertEqual(self.post(b, '/api/social/buddies', BUDDY).status_code, 409)
        finally:
            extras.BUDDY_OPEN_MAX = old

    def test_validation_and_block_isolation(self):
        a, b = self.user('alice'), self.user('bobby')
        self.assertEqual(self.post(b, '/api/social/buddies', {**BUDDY, 'title': '   '}).status_code, 422)
        self.assertEqual(self.post(b, '/api/social/buddies', {**BUDDY, 'kind': 'dating'}).status_code, 422)
        self.assertEqual(self.post(b, '/api/social/buddies', {k: v for k, v in BUDDY.items() if k != 'partner'}).status_code, 422)
        self.assertEqual(self.post(b, '/api/social/buddies', {**BUDDY, 'note': 'x' * 1001}).status_code, 422)
        post = self.post(b, '/api/social/buddies', BUDDY, status=201).json()['data']
        self.put(a, '/api/social/blocks/bobby')
        self.assertEqual(a.get('/api/social/buddies').json()['data']['items'], [])
        self.assertEqual(self.post(a, '/api/social/buddy-invites/bobby', {**INVITE, 'post_id': post['id']}).status_code, 404)

    def test_invite_needs_open_preference_then_full_lifecycle(self):
        a, b = self.user('alice'), self.user('bobby')
        post = self.post(b, '/api/social/buddies', BUDDY, status=201).json()['data']
        self.assertEqual(self.post(a, '/api/social/buddy-invites/bobby', {**INVITE, 'post_id': post['id']}).status_code, 409)
        self.assertFalse(self.prefs(b)['buddy_open'])
        self.assertTrue(self.prefs(b, buddy_open=True)['buddy_open'])
        self.assertTrue(b.get('/api/social/me').json()['data']['prefs']['buddy_open'])
        self.assertTrue(a.get('/api/social/buddies').json()['data']['items'][0]['contact_open'])
        sent = self.post(a, '/api/social/buddy-invites/bobby', {**INVITE, 'post_id': post['id']}, status=201).json()['data']
        self.assertEqual((sent['state'], sent['person']['handle']), ('sent', 'bobby'))
        self.assertTrue(a.get('/api/social/buddies').json()['data']['items'][0]['invited'])
        self.assertEqual(self.post(a, '/api/social/buddy-invites/bobby', {**INVITE, 'post_id': post['id']}).status_code, 409)
        self.assertEqual(self.post(a, '/api/social/buddy-invites/alice', INVITE).status_code, 422)
        events = self.events('social.buddy_invited')
        self.assertEqual([(e['recipient_id'], e['actor_id']) for e in events], [(b.pid, a.pid)])
        got = b.get('/api/social/buddy-invites?box=received').json()['data']['items']
        self.assertEqual([(i['id'], i['person']['handle']) for i in got], [(sent['id'], 'alice')])
        self.assertEqual(a.get('/api/social/buddy-invites?box=received').json()['data']['items'], [])
        edited = a.patch(f"/api/social/buddy-invites/{sent['id']}", headers=ts.HDRS, json={'note': '先聊聊'})
        self.assertEqual(edited.json()['data']['note'], '先聊聊')
        self.assertEqual(b.patch(f"/api/social/buddy-invites/{sent['id']}", headers=ts.HDRS, json={'note': 'x'}).status_code, 404)
        answered = self.post(b, f"/api/social/buddy-invites/{sent['id']}/answer", {'accept': True}, status=200).json()['data']
        self.assertEqual(answered['state'], 'accepted')
        self.assertEqual(self.post(b, f"/api/social/buddy-invites/{sent['id']}/answer", {'accept': False}).status_code, 409)
        self.assertEqual([e['recipient_id'] for e in self.events('social.buddy_answered')], [a.pid])
        self.assertEqual(self.delete(a, f"/api/social/buddy-invites/{sent['id']}").status_code, 409)  # 有结果后不能撤回

    def test_withdraw_then_invite_again(self):
        a, b = self.user('alice'), self.user('bobby')
        self.prefs(b, buddy_open=True)
        first = self.post(a, '/api/social/buddy-invites/bobby', INVITE, status=201).json()['data']
        gone = self.delete(a, f"/api/social/buddy-invites/{first['id']}").json()['data']
        self.assertEqual(gone['state'], 'withdrawn')
        self.assertEqual(b.get('/api/social/buddy-invites?box=received').json()['data']['items'], [])
        self.assertEqual(a.get('/api/social/buddy-invites').json()['data']['items'][0]['state'], 'withdrawn')
        again = self.post(a, '/api/social/buddy-invites/bobby', INVITE, status=201).json()['data']
        self.assertNotEqual(again['id'], first['id'])

    def test_idempotent_create_and_daily_invite_cap(self):
        a, b = self.user('alice'), self.user('bobby')
        headers = {**ts.HDRS, 'Idempotency-Key': 'r17h-buddy-create-0001'}
        one = a.post('/api/social/buddies', headers=headers, json=BUDDY)
        two = a.post('/api/social/buddies', headers=headers, json=BUDDY)
        self.assertEqual((one.status_code, two.status_code), (201, 201))
        self.assertEqual(one.json()['data']['id'], two.json()['data']['id'])
        self.assertEqual(len(a.get('/api/social/buddies?mine=true').json()['data']['items']), 1)
        self.prefs(b, buddy_open=True)
        old = extras.INVITE_DAY
        extras.INVITE_DAY = 0
        try:
            self.assertEqual(self.post(a, '/api/social/buddy-invites/bobby', INVITE).status_code, 429)
        finally:
            extras.INVITE_DAY = old


class ApplicationTest(Base):
    SPONSOR = {'brand': '某某科技', 'types': ['title', 'jobs', 'title'], 'budget': '¥5,000 以下', 'time': '本月', 'note': '想冠名一场活动'}
    LECTURER = {'title': '用 Agent 做周报', 'form': 'workshop', 'length': '2 小时 × 1 次', 'price': '¥149 / 席', 'note': ''}

    def test_sponsor_submit_edit_withdraw(self):
        a = self.user('alice')
        r = self.put(a, '/api/social/applications/sponsor', self.SPONSOR)
        self.assertEqual(r.status_code, 200, r.text)
        first = r.json()['data']
        self.assertEqual((first['kind'], first['state'], first['fields']['types']), ('sponsor', 'submitted', ['title', 'jobs']))
        second = self.put(a, '/api/social/applications/sponsor', {**self.SPONSOR, 'brand': '改名了'}).json()['data']
        self.assertEqual((second['id'], second['fields']['brand']), (first['id'], '改名了'))
        mine = a.get('/api/social/applications').json()['data']['items']
        self.assertEqual([(i['kind'], i['fields']['brand']) for i in mine], [('sponsor', '改名了')])
        self.assertEqual(self.delete(a, '/api/social/applications/sponsor').json()['data']['state'], 'withdrawn')
        self.assertEqual(a.get('/api/social/applications').json()['data']['items'], [])
        self.assertEqual(self.delete(a, '/api/social/applications/sponsor').status_code, 404)
        again = self.put(a, '/api/social/applications/sponsor', self.SPONSOR).json()['data']
        self.assertNotEqual(again['id'], first['id'])

    def test_validation(self):
        a = self.user('alice')
        self.assertEqual(self.put(a, '/api/social/applications/sponsor', {**self.SPONSOR, 'brand': '  '}).status_code, 422)
        self.assertEqual(self.put(a, '/api/social/applications/sponsor', {**self.SPONSOR, 'types': []}).status_code, 422)
        self.assertEqual(self.put(a, '/api/social/applications/sponsor', {**self.SPONSOR, 'types': ['cash']}).status_code, 422)
        self.assertEqual(self.put(a, '/api/social/applications/sponsor', {**self.SPONSOR, 'extra': 1}).status_code, 422)
        self.assertEqual(self.delete(a, '/api/social/applications/other').status_code, 404)

    def test_lecturer_needs_level_three(self):
        low, high = self.user('lowbie', level=2), self.user('highbie', level=3)
        self.assertEqual(self.put(low, '/api/social/applications/lecturer', self.LECTURER).status_code, 403)
        r = self.put(high, '/api/social/applications/lecturer', self.LECTURER)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['fields']['price'], '¥149 / 席')
        self.assertEqual(self.put(high, '/api/social/applications/lecturer', {**self.LECTURER, 'form': 'group'}).status_code, 422)

    def test_admin_review_and_notification_event(self):
        a = self.user('alice')
        admin = self.user('admin_', roles=('admin',), totp=True)
        saved = self.put(a, '/api/social/applications/sponsor', self.SPONSOR).json()['data']
        self.assertEqual(a.get('/api/admin/social/applications').status_code, 403)
        queue = admin.get('/api/admin/social/applications').json()['data']['items']
        self.assertEqual([(i['id'], i['applicant']['handle']) for i in queue], [(saved['id'], 'alice')])
        self.assertEqual(admin.get('/api/admin/social/applications?kind=lecturer').json()['data']['items'], [])
        bad = self.post(admin, f"/api/admin/social/applications/{saved['id']}/decision", {'decision': 'maybe'})
        self.assertEqual(bad.status_code, 422)
        done = self.post(admin, f"/api/admin/social/applications/{saved['id']}/decision",
                         {'decision': 'approved', 'note': '欢迎'}, status=200).json()['data']
        self.assertEqual((done['state'], done['decision_note']), ('approved', '欢迎'))
        self.assertEqual(self.post(admin, f"/api/admin/social/applications/{saved['id']}/decision",
                                   {'decision': 'rejected'}).status_code, 409)
        self.assertEqual([e['recipient_id'] for e in self.events('social.application_decided')], [a.pid])
        self.assertEqual(self.put(a, '/api/social/applications/sponsor', self.SPONSOR).status_code, 200)  # 有结果后可再申请
        self.assertEqual(admin.get('/api/admin/social/applications').json()['data']['items'][0]['id'] != saved['id'], True)


class NotifyRulesTest(Base):
    """R17-H2：notify_0005 的四条规则真的把事件变成站内通知。"""

    def inbox(self, client):
        items = client.get('/api/notify/notifications?limit=50').json()['data']['items']
        return {i['category']: i for i in items}

    def test_four_events_become_notifications_with_links(self):
        a, b = self.user('alice'), self.user('bobby')
        admin = self.user('admin_', roles=('admin',), totp=True)
        self.follow(a, 'bobby')
        self.age(b, 365)
        self.prefs(b, buddy_open=True)
        self.post(a, '/api/social/blessings/bobby', status=200)
        sent = self.post(a, '/api/social/buddy-invites/bobby', INVITE, status=201).json()['data']
        self.post(b, f"/api/social/buddy-invites/{sent['id']}/answer", {'accept': True}, status=200)
        saved = self.put(a, '/api/social/applications/sponsor', ApplicationTest.SPONSOR).json()['data']
        self.post(admin, f"/api/admin/social/applications/{saved['id']}/decision", {'decision': 'approved', 'note': '欢迎'}, status=200)
        outbox.dispatch(self.db, limit=1000)
        got_b = self.inbox(b)
        self.assertEqual(got_b['social_poke']['link'], '#/u/alice')
        self.assertIn('入群一周年', got_b['social_poke']['body'])
        self.assertEqual(got_b['social_join_request']['link'], '#/buddies')
        self.assertIn('想约你做搭子', got_b['social_join_request']['title'])
        links = sorted(i['link'] for i in a.get('/api/notify/notifications?limit=50').json()['data']['items'])
        self.assertEqual(links, ['#/buddies', '#/home'])
        self.assertEqual(sorted(self.inbox(admin)), [])


class ExportPurgeTest(Base):
    def test_export_and_purge_cover_new_tables(self):
        from modules.social import service
        a, b = self.user('alice'), self.user('bobby')
        self.follow(a, 'bobby')
        self.age(b, 365)
        self.prefs(b, buddy_open=True)
        self.post(a, '/api/social/blessings/bobby', status=200)
        self.put(a, '/api/social/signals/W')
        self.post(a, '/api/social/suggestions/bobby/dismiss')
        mine = self.post(a, '/api/social/buddies', BUDDY, status=201).json()['data']
        self.post(a, '/api/social/buddy-invites/bobby', INVITE, status=201)
        self.put(a, '/api/social/applications/sponsor', ApplicationTest.SPONSOR)
        with self.db.read() as conn:
            dump = service.export_rows(conn, Actor(id=a.pid, level=1, status='active'))
        for key in ('blessings_sent', 'suggestions_dismissed', 'reading_entries', 'buddy_posts', 'buddy_invites_sent', 'applications'):
            self.assertTrue(dump[key], key)
        self.assertEqual(dump['buddy_posts'][0]['id'], mine['id'])
        with self.db.write() as conn:
            service.purge(conn, a.pid)
        with self.db.read() as conn:
            for table, col in (('social_blessing', 'sender_id'), ('social_suggestion_dismiss', 'principal_id'),
                               ('social_signal', 'principal_id'), ('social_buddy_post', 'author_id'),
                               ('social_buddy_invite', 'sender_id'), ('social_application', 'applicant_id')):
                self.assertEqual(conn.execute(f'SELECT count(*) FROM {table} WHERE {col} = ?', (a.pid,)).fetchone()[0], 0, table)


class RoomChatTest(tr.RoomCase):
    def chat(self, client, rid, text='大家好', status=201):
        r = client.post(f'/api/rooms/{rid}/messages', headers={**tr.HDRS, 'Idempotency-Key': f'r17h-chat-{self.n()}'}, json={'text': text})
        self.assertEqual(r.status_code, status, r.text)
        return r.json()

    def n(self):
        self._n = getattr(self, '_n', 0) + 1
        return f'{self._n:06d}-abcdef'

    def listed(self, client, rid, status=200, **query):
        qs = '&'.join(f'{k}={v}' for k, v in query.items())
        r = client.get(f'/api/rooms/{rid}/messages' + (f'?{qs}' if qs else ''))
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 200 else r.json()

    def test_post_list_and_order(self):
        h, rid = self.live_room()
        g = self.user('guest_a', level=2)
        self.join(g, rid)
        first = self.chat(h, rid, '开始了')['data']
        self.chat(g, rid, '收到')
        out = self.listed(g, rid)
        self.assertEqual([(m['text'], m['author']['name']) for m in out['items']][0][0], '开始了')
        self.assertEqual([m['text'] for m in out['items']], ['开始了', '收到'])
        self.assertEqual((out['more'], out['state']), (False, 'live'))
        self.assertEqual(first['author']['id'], h.pid)

    def test_idempotent_replay_and_validation(self):
        h, rid = self.live_room()
        key = {**tr.HDRS, 'Idempotency-Key': 'r17h-chat-replay-01'}
        one = h.post(f'/api/rooms/{rid}/messages', headers=key, json={'text': '一条'})
        two = h.post(f'/api/rooms/{rid}/messages', headers=key, json={'text': '一条'})
        self.assertEqual(one.json()['data']['id'], two.json()['data']['id'])
        self.assertEqual(len(self.listed(h, rid)['items']), 1)
        self.chat(h, rid, '   ', status=422)
        self.chat(h, rid, 'x' * 201, status=422)

    def test_only_present_members_can_write_and_removed_cannot_read(self):
        h, rid = self.live_room()
        outsider = self.user('outsider_1', level=2)
        self.chat(outsider, rid, '我没进房', status=409)
        self.listed(outsider, rid, status=403)
        g = self.user('guest_b', level=2)
        self.join(g, rid)
        self.chat(g, rid, '在场')
        self.host(h, rid, action='remove', principal_id=g.pid, reason_code='disruptive')
        self.chat(g, rid, '被移出后', status=404)  # 被移出的人，房间对 TA 已不可见（和详情同一条规则）
        self.listed(g, rid, status=404)
        self.assertEqual([m['text'] for m in self.listed(h, rid)['items']], ['在场'])

    def test_leave_blocks_writing_but_not_reading(self):
        h, rid = self.live_room()
        g = self.user('guest_c', level=2)
        self.join(g, rid)
        self.chat(g, rid, '先说一句')
        g.post(f'/api/rooms/{rid}/leave', headers=tr.HDRS)
        self.chat(g, rid, '离开后', status=409)
        self.assertEqual([m['text'] for m in self.listed(g, rid)['items']], ['先说一句'])

    def test_ended_room_is_readable_not_writable(self):
        h, rid = self.live_room()
        self.chat(h, rid, '收个尾')
        self.host(h, rid, action='end')
        self.chat(h, rid, '结束后', status=409)
        out = self.listed(h, rid)
        self.assertEqual(([m['text'] for m in out['items']], out['state']), (['收个尾'], 'ended'))

    def test_delete_by_author_or_host_only(self):
        h, rid = self.live_room()
        g, other = self.user('guest_d', level=2), self.user('guest_e', level=2)
        self.join(g, rid)
        self.join(other, rid)
        mine = self.chat(g, rid, '我的话')['data']
        keep = self.chat(g, rid, '另一句')['data']
        self.assertEqual(other.delete(f"/api/rooms/{rid}/messages/{mine['id']}", headers=tr.HDRS).status_code, 403)
        self.assertEqual(g.delete(f"/api/rooms/{rid}/messages/{mine['id']}", headers=tr.HDRS).status_code, 200)
        self.assertEqual(h.delete(f"/api/rooms/{rid}/messages/{keep['id']}", headers=tr.HDRS).status_code, 200)
        self.assertEqual(h.delete(f"/api/rooms/{rid}/messages/nope", headers=tr.HDRS).status_code, 404)
        self.assertEqual(self.listed(h, rid)['items'], [])

    def test_paging_before_and_rate_limit(self):
        h, rid = self.live_room()
        for i in range(53):
            with self.db.write() as conn:
                conn.execute("INSERT INTO room_message (id, room_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
                             (f'm{i:03d}', rid, h.pid, f'第{i}句', clock.now()))
        page = self.listed(h, rid)
        self.assertEqual((len(page['items']), page['more'], page['items'][0]['text'], page['items'][-1]['text']),
                         (50, True, '第3句', '第52句'))
        older = self.listed(h, rid, before=page['items'][0]['seq'])
        self.assertEqual(([m['text'] for m in older['items']], older['more']), (['第0句', '第1句', '第2句'], False))
        for i in range(20):
            self.chat(h, rid, f'连发{i}')
        self.chat(h, rid, '第 21 条', status=429)

    def test_flag_off_and_export_purge(self):
        h, rid = self.live_room()
        self.chat(h, rid, '要被导出')
        with self.db.read() as conn:
            dump = tr.service.export(conn, Actor(id=h.pid, level=4, status='active'))
        self.assertEqual([c['body'] for c in dump['chat']], ['要被导出'])
        self.flag(tr.service.FLAG, False)
        self.chat(h, rid, '关了', status=501)
        self.flag(tr.service.FLAG, True)
        from modules.rooms import hooks
        with self.db.write() as conn:
            hooks.purge(conn, h.pid)
        with self.db.read() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM room_message WHERE author_id = ?', (h.pid,)).fetchone()[0], 0)
