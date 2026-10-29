import json
from unittest.mock import patch

from app import accounts, clock
from app.authz import Actor
from modules.social import service
from tests.helpers import AppCase, HDRS


class SocialCase(AppCase):
    def setUp(self):
        super().setUp()
        self.keys = 0

    def key(self):
        self.keys += 1
        return f'social-test-{self.keys:04d}'

    def put(self, client, path, body=None):
        return client.put(path, headers=HDRS, json=body)

    def post(self, client, path, body=None, status=None):
        r = client.post(path, headers={**HDRS, 'Idempotency-Key': self.key()}, json=body)
        if status is not None:
            self.assertEqual(r.status_code, status, r.text)
        return r

    def delete(self, client, path):
        return client.delete(path, headers=HDRS)

    def follow(self, a, b_handle):
        r = self.put(a, f'/api/social/follows/{b_handle}')
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['data']

    def befriend(self, a, a_handle, b, b_handle):
        self.follow(a, b_handle)
        return self.follow(b, a_handle)

    def say(self, client, body='你好', **extra):
        r = self.post(client, '/api/social/posts', {'body': body, **extra})
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()['data']

    def feed(self, client, tab='all'):
        r = client.get(f'/api/social/feed?tab={tab}')
        self.assertEqual(r.status_code, 200, r.text)
        return [p['id'] for p in r.json()['data']['items']]

    def events(self, event_type):
        with self.db.read() as conn:
            rows = conn.execute('SELECT payload_json, actor_id FROM outbox_event WHERE event_type = ? ORDER BY '
                                'occurred_at', (event_type,)).fetchall()
        return [dict(json.loads(r[0]), actor_id=r[1]) for r in rows]

    def group(self, owner, slug='agent-lab', policy='open', name='Agent 实验室'):
        r = self.post(owner, '/api/social/groups', {'slug': slug, 'name': name, 'category': 'tech',
                                                     'join_policy': policy})
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()['data']


class TestRelations(SocialCase):
    def test_follow_is_one_way_and_mutual_makes_friends(self):
        a, b = self.user('alice'), self.user('bobby')
        rel = self.follow(a, 'bobby')
        self.assertEqual((rel['following'], rel['followed_by'], rel['friends']), (True, False, False))
        rel = self.follow(b, 'alice')
        self.assertTrue(rel['friends'])
        with self.db.read() as conn:
            self.assertTrue(service.mutual(conn, a.pid, b.pid))
            self.assertTrue(service.mutual_follow(conn, b.pid, a.pid))
            self.assertEqual(service.friend_ids(conn, a.pid), [b.pid])
        followed = self.events('social.followed')
        self.assertEqual([e['recipient_id'] for e in followed], [b.pid, a.pid])
        self.assertEqual([e['mutual'] for e in followed], [False, True])
        r = self.delete(a, '/api/social/follows/bobby')
        self.assertFalse(r.json()['data']['friends'])
        self.assertEqual(self.code(self.put(a, '/api/social/follows/alice')), 'validation_failed')
        self.assertEqual(self.code(self.put(a, '/api/social/follows/nobody_here')), 'resource_not_found')

    def test_star_needs_follow_and_relations_list(self):
        a, _ = self.user('alice'), self.user('bobby')
        self.assertEqual(self.code(self.put(a, '/api/social/stars/bobby')), 'state_conflict')
        self.follow(a, 'bobby')
        self.assertTrue(self.put(a, '/api/social/stars/bobby').json()['data']['starred'])
        items = a.get('/api/social/relations?kind=starred').json()['data']['items']
        self.assertEqual([i['handle'] for i in items], ['bobby'])
        self.assertEqual(a.get('/api/social/relations?kind=nope').status_code, 422)

    def test_relations_paginate_with_signed_cursor(self):
        a = self.user('alice')
        for i in range(5):
            self.user(f'peer{i}')
            self.follow(a, f'peer{i}')
        first = a.get('/api/social/relations?kind=following&limit=2').json()
        self.assertEqual(len(first['data']['items']), 2)
        cursor = first['meta']['cursor']
        second = a.get(f'/api/social/relations?kind=following&limit=2&cursor={cursor}').json()
        seen = {i['handle'] for i in first['data']['items']} | {i['handle'] for i in second['data']['items']}
        self.assertEqual(len(seen), 4)
        stale = a.get(f'/api/social/relations?kind=followers&limit=2&cursor={cursor}')
        self.assertEqual(self.code(stale), 'cursor_stale')

    def test_block_breaks_follows_and_isolates_both_ways(self):
        a, b, c = self.user('alice'), self.user('bobby'), self.user('carol')
        self.befriend(a, 'alice', b, 'bobby')
        self.follow(c, 'alice')
        post = self.say(a, '只给社区看')
        rel = self.put(a, '/api/social/blocks/bobby').json()['data']
        self.assertEqual((rel['blocked'], rel['following'], rel['followed_by']), (True, False, False))
        with self.db.read() as conn:
            self.assertTrue(service.blocked(conn, a.pid, b.pid))
            self.assertTrue(service.blocked(conn, b.pid, a.pid))
            self.assertFalse(service.can_see(conn, b.pid, a.pid, 'members'))
            self.assertTrue(service.can_see(conn, c.pid, a.pid, 'members'))
            self.assertTrue(service.can_see(conn, c.pid, a.pid, 'followers'))
            self.assertFalse(service.can_see(conn, c.pid, a.pid, 'friends'))
            self.assertFalse(service.can_see(conn, c.pid, a.pid, 'private'))
            self.assertTrue(service.can_see(conn, a.pid, a.pid, 'private'))
        self.assertEqual(b.get(f'/api/social/posts/{post["id"]}').status_code, 404)
        self.assertEqual(b.get('/api/social/people/alice').status_code, 404)
        self.assertEqual(b.get('/api/social/walls/alice').status_code, 404)
        self.assertEqual(self.code(self.put(b, '/api/social/follows/alice')), 'resource_not_found')
        self.assertEqual(self.code(self.post(b, '/api/social/pokes/alice')), 'resource_not_found')
        self.assertNotIn(post['id'], self.feed(b))
        mine = a.get('/api/social/people/bobby').json()['data']
        self.assertTrue(mine['relation']['blocked'])
        self.assertNotIn('counts', mine)
        blocked = a.get('/api/social/relations?kind=blocked').json()['data']['items']
        self.assertEqual([i['handle'] for i in blocked], ['bobby'])
        self.assertFalse(self.delete(a, '/api/social/blocks/bobby').json()['data']['following'])
        self.assertEqual(b.get(f'/api/social/posts/{post["id"]}').status_code, 200)

    def test_can_see_scopes_for_dm_and_games(self):
        a, b = self.user('alice'), self.user('bobby')
        self.follow(b, 'alice')
        with self.db.read() as conn:
            self.assertTrue(service.can_see(conn, a.pid, b.pid, 'following'))
            self.assertFalse(service.can_see(conn, b.pid, a.pid, 'following'))
            self.assertTrue(service.can_see(conn, b.pid, a.pid, 'followers'))
            self.assertFalse(service.can_see(conn, a.pid, b.pid, 'friends'))
            self.assertFalse(service.can_see(conn, a.pid, None, 'members'))
            self.assertFalse(service.can_see(conn, a.pid, b.pid, 'unknown'))

    def test_mute_hides_from_feed_without_unfollowing(self):
        a, b = self.user('alice'), self.user('bobby')
        self.follow(a, 'bobby')
        post = self.say(b, '刷屏中')
        self.assertIn(post['id'], self.feed(a))
        rel = self.put(a, '/api/social/mutes/bobby').json()['data']
        self.assertEqual((rel['muted'], rel['following']), (True, True))
        self.assertNotIn(post['id'], self.feed(a))
        self.assertEqual(a.get(f'/api/social/posts/{post["id"]}').status_code, 200)
        self.delete(a, '/api/social/mutes/bobby')
        self.assertIn(post['id'], self.feed(a))

    def test_poke_once_per_person_per_day_and_daily_cap(self):
        a, _ = self.user('alice'), self.user('bobby')
        self.assertEqual(self.post(a, '/api/social/pokes/bobby').status_code, 200)
        again = self.post(a, '/api/social/pokes/bobby')
        self.assertEqual(self.code(again), 'state_conflict')
        self.assertEqual(again.json()['error']['message'], '今天已经戳过 TA 了')
        self.assertTrue(a.get('/api/social/people/bobby').json()['data']['relation']['poked_today'])
        events = self.events('social.poked')
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['actor_id'], a.pid)
        with patch.object(service, 'POKE_DAY', 1):
            self.user('carol')
            capped = self.post(a, '/api/social/pokes/carol')
        self.assertEqual(capped.status_code, 429)
        self.assertIn('Retry-After', capped.headers)
        tomorrow = clock.now_ts() + 86400
        with patch('app.clock.now_ts', return_value=tomorrow):
            self.assertEqual(self.post(a, '/api/social/pokes/bobby').status_code, 200)

    def test_suggestions_friends_of_friends_groups_and_opt_out(self):
        a, b, c = self.user('alice'), self.user('bobby'), self.user('carol')
        d = self.user('dave_', level=3)
        self.befriend(a, 'alice', b, 'bobby')
        self.befriend(b, 'bobby', c, 'carol')
        self.group(d, 'lounge-x')
        self.post(a, '/api/social/groups/lounge-x/join', status=200)
        items = a.get('/api/social/suggestions').json()['data']['items']
        reasons = {i['handle']: i['reason'] for i in items}
        self.assertEqual(reasons['carol'], '1 位共同好友')
        self.assertEqual(reasons['dave_'], '同在「Agent 实验室」')
        self.assertNotIn('bobby', reasons)
        self.put(c, '/api/social/me/prefs', {'suggestions': False})
        handles = [i['handle'] for i in a.get('/api/social/suggestions').json()['data']['items']]
        self.assertNotIn('carol', handles)
        self.put(a, '/api/social/me/prefs', {'suggestions': False})
        self.assertEqual(a.get('/api/social/suggestions').json()['data']['items'], [])
        self.assertFalse(a.get('/api/social/me').json()['data']['prefs']['suggestions'])

    def test_follow_rate_limit(self):
        a = self.user('alice')
        for i in range(3):
            self.user(f'peer{i}')
        with patch.object(service, 'FOLLOW_DAY', (2, 86400)):
            self.assertEqual(self.put(a, '/api/social/follows/peer0').status_code, 200)
            self.assertEqual(self.put(a, '/api/social/follows/peer1').status_code, 200)
            self.assertEqual(self.put(a, '/api/social/follows/peer2').status_code, 429)


class TestPosts(SocialCase):
    def test_scopes_follow_core_visibility(self):
        a, b, c = self.user('alice'), self.user('bobby'), self.user('carol')
        self.befriend(a, 'alice', b, 'bobby')
        public = self.say(a, '大家好')
        friends = self.say(a, '只给好友', scope='friends')
        private = self.say(a, '只给自己', scope='private')
        self.assertEqual((public['scope'], friends['scope'], private['scope']), ('members', 'friends', 'private'))
        self.assertEqual(b.get(f'/api/social/posts/{friends["id"]}').status_code, 200)
        self.assertEqual(c.get(f'/api/social/posts/{friends["id"]}').status_code, 404)
        self.assertEqual(c.get(f'/api/objects/{friends["id"]}').status_code, 404)
        self.assertEqual(b.get(f'/api/social/posts/{private["id"]}').status_code, 404)
        self.assertEqual(c.get(f'/api/social/posts/{public["id"]}').status_code, 200)
        wall = [p['id'] for p in c.get('/api/social/walls/alice').json()['data']['items']]
        self.assertEqual(wall, [public['id']])
        own = [p['id'] for p in a.get('/api/social/walls/alice').json()['data']['items']]
        self.assertEqual(set(own), {public['id'], friends['id'], private['id']})
        self.delete(b, '/api/social/follows/alice')
        self.assertEqual(b.get(f'/api/social/posts/{friends["id"]}').status_code, 404)
        self.follow(b, 'alice')
        self.assertEqual(b.get(f'/api/social/posts/{friends["id"]}').status_code, 200)

    def test_friends_space_created_lazily_includes_existing_friends(self):
        a, b = self.user('alice'), self.user('bobby')
        self.befriend(a, 'alice', b, 'bobby')
        post = self.say(a, '晚点见', scope='friends')
        self.assertEqual(b.get(f'/api/social/posts/{post["id"]}').status_code, 200)
        with self.db.read() as conn:
            kind = conn.execute('SELECT s.kind FROM social_pref p JOIN space s ON s.id = p.friends_space_id '
                                'WHERE p.principal_id = ?', (a.pid,)).fetchone()[0]
        self.assertEqual(kind, 'social_friends')

    def test_comments_follow_post_visibility(self):
        a, b, c = self.user('alice'), self.user('bobby'), self.user('carol')
        self.befriend(a, 'alice', b, 'bobby')
        post = self.say(a, '好友可评论', scope='friends')
        r = self.post(b, f'/api/content/objects/{post["id"]}/replies', {'body': '收到'})
        self.assertEqual(r.status_code, 201, r.text)
        denied = self.post(c, f'/api/content/objects/{post["id"]}/replies', {'body': '我也来'})
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(a.get(f'/api/social/posts/{post["id"]}').json()['data']['comments'], 1)

    def test_feed_tabs_order_cursor_and_new_count(self):
        a, b, c = self.user('alice'), self.user('bobby'), self.user('carol')
        owner = self.user('owner', level=3)
        self.befriend(a, 'alice', b, 'bobby')
        self.follow(a, 'carol')
        self.group(owner)
        self.post(a, '/api/social/groups/agent-lab/join', status=200)
        stranger = self.say(self.user('dave_'), '陌生人')
        mine = self.say(a, '我自己')
        friend = self.say(b, '好友说')
        followee = self.say(c, '关注的人说')
        grouped = self.say(owner, '组里说', scope='group', group='agent-lab')
        everything = self.feed(a)
        self.assertEqual(everything, [grouped['id'], followee['id'], friend['id'], mine['id']])
        self.assertNotIn(stranger['id'], everything)
        self.assertEqual(self.feed(a, 'friends'), [friend['id']])
        self.assertEqual(self.feed(a, 'groups'), [grouped['id']])
        first = a.get('/api/social/feed?limit=2').json()
        self.assertEqual([p['id'] for p in first['data']['items']], everything[:2])
        rest = a.get(f'/api/social/feed?limit=2&cursor={first["meta"]["cursor"]}').json()
        self.assertEqual([p['id'] for p in rest['data']['items']], everything[2:4])
        since = clock.now()
        self.say(b, '新的一条')
        self.say(a, '我自己发的不算')
        count = a.get('/api/social/feed/new-count', params={'since': since}).json()['data']['count']
        self.assertEqual(count, 1)
        self.assertEqual(a.get('/api/social/feed/new-count?since=yesterday').status_code, 422)

    def test_content_validation_link_poll_images_quote(self):
        a = self.user('alice')
        self.assertEqual(self.post(a, '/api/social/posts', {}).status_code, 422)
        bad_link = self.post(a, '/api/social/posts', {'link': {'url': 'javascript:alert(1)'}})
        self.assertEqual(bad_link.status_code, 422)
        link = self.say(a, '', link={'url': 'https://example.com/a?b=1'})
        self.assertEqual(link['link'], {'url': 'https://example.com/a?b=1', 'title': 'example.com',
                                        'domain': 'example.com'})
        self.assertEqual(self.post(a, '/api/social/posts', {'poll': {'options': ['只有一个']}}).status_code, 422)
        dup = self.post(a, '/api/social/posts', {'poll': {'options': ['一样', '一样']}})
        self.assertEqual(dup.status_code, 422)
        self.assertEqual(self.post(a, '/api/social/posts', {'images': ['not-a-uuid']}).status_code, 422)
        self.assertEqual(self.post(a, '/api/social/posts', {'body': 'x', 'extra': 1}).status_code, 422)
        self.assertEqual(self.post(a, '/api/social/posts', {'body': 'x' * 2001}).status_code, 422)
        missing = self.post(a, '/api/social/posts', {'quote': {'id': '00000000-0000-4000-8000-000000000000'}})
        self.assertEqual(missing.status_code, 404)

    def test_quote_shows_title_only_when_visible(self):
        a, b = self.user('alice'), self.user('bobby')
        knowledge = self.obj(a, title='向量库选型笔记')
        post = self.say(a, '推荐一下', quote={'id': knowledge['id']})
        self.assertEqual(b.get(f'/api/social/posts/{post["id"]}').json()['data']['quote'],
                         {'visible': True, 'id': knowledge['id'], 'type': 'discussion', 'title': '向量库选型笔记'})
        secret = self.obj(a, title='只给自己的草稿', visibility='named', acl=[a.pid])
        own = self.say(a, '引用私密', quote={'id': secret['id']})
        seen = b.get(f'/api/social/posts/{own["id"]}').json()['data']['quote']
        self.assertEqual(seen, {'visible': False})
        self.assertEqual(self.post(b, '/api/social/posts', {'quote': {'id': secret['id']}}).status_code, 404)

    def test_poll_vote_once_and_closes(self):
        a, b = self.user('alice'), self.user('bobby')
        post = self.say(a, '周末去哪', poll={'options': ['爬山', '写代码'], 'days': 1})
        self.assertEqual(post['poll']['total'], 0)
        voted = self.put(b, f'/api/social/posts/{post["id"]}/vote', {'option': 1}).json()['data']
        self.assertEqual((voted['total'], voted['mine'], voted['options'][1]['votes']), (1, 1, 1))
        self.assertEqual(self.code(self.put(b, f'/api/social/posts/{post["id"]}/vote', {'option': 0})),
                         'state_conflict')
        self.assertEqual(self.put(a, f'/api/social/posts/{post["id"]}/vote', {'option': 3}).status_code, 422)
        later = clock.now_ts() + 2 * 86400
        with patch('app.clock.now_ts', return_value=later):
            closed = self.put(a, f'/api/social/posts/{post["id"]}/vote', {'option': 0})
        self.assertEqual(self.code(closed), 'state_conflict')
        plain = self.say(a, '没有投票')
        self.assertEqual(self.code(self.put(b, f'/api/social/posts/{plain["id"]}/vote', {'option': 0})),
                         'state_conflict')

    def test_reactions_one_per_person_and_notify_once(self):
        a, b, c = self.user('alice'), self.user('bobby'), self.user('carol')
        post = self.say(a, '跑通了')
        r = self.put(b, f'/api/social/posts/{post["id"]}/reaction', {'kind': 'reproduced'}).json()['data']
        self.assertEqual((r['counts'], r['mine'], r['total']), ({'reproduced': 1}, 'reproduced', 1))
        r = self.put(b, f'/api/social/posts/{post["id"]}/reaction', {'kind': 'cheer'}).json()['data']
        self.assertEqual((r['counts'], r['total']), ({'cheer': 1}, 1))
        self.put(c, f'/api/social/posts/{post["id"]}/reaction', {'kind': 'cheer'})
        self.put(a, f'/api/social/posts/{post["id"]}/reaction', {'kind': 'up'})
        self.assertEqual(len(self.events('social.reacted')), 2)
        self.assertEqual(self.put(b, f'/api/social/posts/{post["id"]}/reaction', {'kind': 'heart'}).status_code, 422)
        who = a.get(f'/api/social/posts/{post["id"]}/reactions').json()['data']
        self.assertEqual(who['summary']['counts'], {'up': 1, 'cheer': 2})
        self.put(a, '/api/social/blocks/carol')
        self.assertEqual(a.get(f'/api/social/posts/{post["id"]}/reactions').json()['data']['summary']['counts'],
                         {'up': 1, 'cheer': 1})
        cleared = self.delete(b, f'/api/social/posts/{post["id"]}/reaction').json()['data']
        self.assertIsNone(cleared['mine'])

    def test_share_with_note_only_for_community_posts(self):
        a, b, c = self.user('alice'), self.user('bobby'), self.user('carol')
        self.befriend(a, 'alice', b, 'bobby')
        post = self.say(a, '原帖')
        shared = self.post(b, f'/api/social/posts/{post["id"]}/shares', {'note': '值得一看'}, status=201).json()['data']
        self.assertEqual((shared['body'], shared['share_of']['id'], shared['share_of']['visible']),
                         ('值得一看', post['id'], True))
        again = self.post(c, f'/api/social/posts/{shared["id"]}/shares', {}, status=201).json()['data']
        self.assertEqual(again['share_of']['id'], post['id'])
        self.assertEqual(a.get(f'/api/social/posts/{post["id"]}').json()['data']['shares'], 2)
        self.assertEqual([e['recipient_id'] for e in self.events('social.shared')], [a.pid, a.pid])
        friends_only = self.say(a, '好友帖', scope='friends')
        self.assertFalse(friends_only['can']['share'])
        denied = self.post(b, f'/api/social/posts/{friends_only["id"]}/shares', {})
        self.assertEqual(self.code(denied), 'state_conflict')
        self.delete(a, f'/api/social/posts/{post["id"]}')
        self.assertEqual(c.get(f'/api/social/posts/{shared["id"]}').json()['data']['share_of'], {'visible': False})

    def test_delete_own_post_and_post_rate_limit(self):
        a, b = self.user('alice'), self.user('bobby')
        post = self.say(a, '删掉我')
        self.assertEqual(self.delete(b, f'/api/social/posts/{post["id"]}').status_code, 403)
        self.assertEqual(self.delete(a, f'/api/social/posts/{post["id"]}').json()['data']['status'], 'deleted')
        self.assertEqual(a.get(f'/api/social/posts/{post["id"]}').status_code, 404)
        with patch.object(service, 'POST_BURST', (2, 600)):
            self.say(b, '一')
            self.say(b, '二')
            self.assertEqual(self.post(b, '/api/social/posts', {'body': '三'}).status_code, 429)

    def test_idempotent_post_does_not_duplicate(self):
        a = self.user('alice')
        hdrs = {**HDRS, 'Idempotency-Key': 'same-key-001'}
        first = a.post('/api/social/posts', headers=hdrs, json={'body': '一次'})
        second = a.post('/api/social/posts', headers=hdrs, json={'body': '一次'})
        self.assertEqual(first.json()['data']['id'], second.json()['data']['id'])
        self.assertEqual(second.headers.get('Idempotent-Replayed'), 'true')

    def test_default_scope_pref_and_flag_off(self):
        a = self.user('alice')
        self.put(a, '/api/social/me/prefs', {'default_scope': 'private'})
        self.assertEqual(self.say(a, '默认仅自己')['scope'], 'private')
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 0 WHERE key = 'social.enabled'")
        self.assertEqual(self.post(a, '/api/social/posts', {'body': '关了'}).status_code, 501)
        self.assertEqual(a.get('/api/social/feed').status_code, 501)


class TestGroups(SocialCase):
    def test_create_needs_level_three_and_unique_slug(self):
        low = self.user('lowlvl')
        r = self.post(low, '/api/social/groups', {'slug': 'mine', 'name': '我的组'})
        self.assertEqual(r.status_code, 403)
        owner = self.user('owner', level=3)
        data = self.group(owner)
        self.assertEqual((data['me']['role'], data['members'], data['can_post']), ('owner', 1, True))
        dup = self.post(owner, '/api/social/groups', {'slug': 'agent-lab', 'name': '重名'})
        self.assertEqual(self.code(dup), 'state_conflict')
        bad = self.post(owner, '/api/social/groups', {'slug': 'x', 'name': '短', 'cover': 'https://evil/x.png'})
        self.assertEqual(bad.status_code, 422)

    def test_open_group_join_post_leave(self):
        owner, m, outsider = self.user('owner', level=3), self.user('member'), self.user('outsider')
        self.group(owner)
        denied = self.post(m, '/api/social/posts', {'body': '先发', 'scope': 'group', 'group': 'agent-lab'})
        self.assertEqual(denied.status_code, 403)
        joined = self.post(m, '/api/social/groups/agent-lab/join', status=200).json()['data']
        self.assertEqual(joined['state'], 'active')
        post = self.say(m, '组内讨论', scope='group', group='agent-lab')
        self.assertEqual(post['group'], {'slug': 'agent-lab', 'name': 'Agent 实验室'})
        self.assertEqual(outsider.get(f'/api/social/posts/{post["id"]}').status_code, 200)
        items = outsider.get('/api/social/groups/agent-lab/feed').json()['data']['items']
        self.assertEqual([p['id'] for p in items], [post['id']])
        self.assertEqual(self.post(m, '/api/social/groups/agent-lab/leave', status=200).json()['data']['state'],
                         'none')
        self.assertEqual(self.code(self.post(owner, '/api/social/groups/agent-lab/leave')), 'state_conflict')

    def test_apply_group_review_and_space_visibility(self):
        owner, m, outsider = self.user('owner', level=3), self.user('member'), self.user('outsider')
        self.group(owner, 'jobs-x', 'apply', '求职与内推')
        secret = self.say(owner, '内推名额', scope='group', group='jobs-x')
        self.assertEqual(outsider.get(f'/api/social/posts/{secret["id"]}').status_code, 404)
        pending = self.post(m, '/api/social/groups/jobs-x/join', {'note': '在找后端'}, status=200).json()['data']
        self.assertEqual(pending['state'], 'pending')
        self.assertEqual(m.get(f'/api/social/posts/{secret["id"]}').status_code, 404)
        requested = self.events('social.group.join_requested')
        self.assertEqual([e['recipient_id'] for e in requested], [owner.pid])
        self.assertEqual(m.get('/api/social/groups/jobs-x/members?state=pending').status_code, 403)
        queue = owner.get('/api/social/groups/jobs-x/members?state=pending').json()['data']['items']
        self.assertEqual([(i['handle'], i['note']) for i in queue], [('member', '在找后端')])
        self.assertEqual(owner.get('/api/social/groups/jobs-x').json()['data']['pending'], 1)
        self.post(owner, '/api/social/groups/jobs-x/requests/member/approve', status=200)
        self.assertEqual(m.get(f'/api/social/posts/{secret["id"]}').status_code, 200)
        self.assertEqual(len(self.events('social.group.join_approved')), 1)
        self.assertEqual(self.code(self.post(owner, '/api/social/groups/jobs-x/requests/member/approve')),
                         'state_conflict')
        self.delete(owner, '/api/social/groups/jobs-x/members/member')
        self.assertEqual(m.get(f'/api/social/posts/{secret["id"]}').status_code, 404)

    def test_pins_featured_admins_and_moderation(self):
        owner, admin, m = self.user('owner', level=3), self.user('helper'), self.user('member')
        self.group(owner)
        for c in (admin, m):
            self.post(c, '/api/social/groups/agent-lab/join', status=200)
        self.assertEqual(self.put(admin, '/api/social/groups/agent-lab/admins/member').status_code, 403)
        self.put(owner, '/api/social/groups/agent-lab/admins/helper')
        post = self.say(m, '好问题', scope='group', group='agent-lab')
        other = self.say(m, '不在组里', scope='members')
        self.assertEqual(self.put(m, f'/api/social/groups/agent-lab/pins/{post["id"]}').status_code, 403)
        pinned = self.put(admin, f'/api/social/groups/agent-lab/pins/{post["id"]}').json()['data']
        self.assertEqual(pinned, {'pinned': True, 'featured': False})
        self.put(admin, f'/api/social/groups/agent-lab/pins/{post["id"]}?kind=featured')
        self.assertEqual(self.put(admin, f'/api/social/groups/agent-lab/pins/{other["id"]}').status_code, 404)
        detail = m.get('/api/social/groups/agent-lab').json()['data']
        self.assertEqual([p['id'] for p in detail['pinned']], [post['id']])
        self.assertEqual({a['handle'] for a in detail['admins']}, {'owner', 'helper'})
        self.assertIsNone(detail['pending'])
        featured = m.get('/api/social/groups/agent-lab/feed?view=featured').json()['data']['items']
        self.assertEqual([p['id'] for p in featured], [post['id']])
        self.assertTrue(featured[0]['featured'])
        hidden = self.delete(admin, f'/api/social/posts/{post["id"]}').json()['data']
        self.assertEqual(hidden['status'], 'hidden')
        self.assertEqual(self.user('viewer').get(f'/api/social/posts/{post["id"]}').status_code, 404)
        self.assertEqual(m.get('/api/social/groups/agent-lab').json()['data']['pinned'], [])
        self.assertEqual(self.delete(admin, f'/api/social/posts/{other["id"]}').status_code, 403)

    def test_list_groups_by_category_and_seed_boards(self):
        admin = self.user('admin_', level=1, roles=('admin',), totp=True)
        self.assertEqual(self.post(self.user('member'), '/api/admin/social/boards').status_code, 403)
        made = self.post(admin, '/api/admin/social/boards', status=200).json()['data']['created']
        self.assertEqual(len(made), len(service.DEFAULT_BOARDS))
        self.assertEqual(self.post(admin, '/api/admin/social/boards', status=200).json()['data']['created'], [])
        everything = admin.get('/api/social/groups').json()['data']
        self.assertEqual(len(everything['items']), 14)
        self.assertEqual(everything['categories']['industry'], '行业应用')
        tech = admin.get('/api/social/groups?category=tech').json()['data']['items']
        self.assertEqual({g['slug'] for g in tech}, {'ai-coding', 'agent-dev', 'prompt-eng', 'model-eval', 'local-hw'})
        jobs = admin.get('/api/social/groups/jobs').json()['data']
        self.assertEqual((jobs['join_policy'], jobs['rules'][0]), ('apply', service.RULES[0]))


class TestLifecycle(SocialCase):
    def test_export_includes_relations(self):
        a, _ = self.user('alice'), self.user('bobby')
        self.follow(a, 'bobby')
        self.say(a, '导出我')
        data = a.get('/api/me/export').json()['data']
        self.assertEqual(len(data['social']['following']), 1)
        self.assertEqual(len(data['social']['posts']), 1)

    def test_purge_removes_relations_and_hands_over_groups(self):
        a, b = self.user('alice', level=3), self.user('bobby')
        self.befriend(a, 'alice', b, 'bobby')
        self.say(b, '给好友', scope='friends')
        self.group(a)
        self.post(b, '/api/social/groups/agent-lab/join', status=200)
        post = self.say(b, '我的帖')
        self.put(a, f'/api/social/posts/{post["id"]}/reaction', {'kind': 'up'})
        self.put(a, '/api/social/mutes/bobby')
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'pending_deletion', delete_requested_at = ? WHERE id = ?",
                         (clock.iso(clock.now_ts() - 365 * 86400), a.pid))
        self.assertEqual(accounts.purge_due(self.db, self.settings), [a.pid])
        with self.db.read() as conn:
            for table, col in (('social_follow', 'follower_id'), ('social_follow', 'followee_id'),
                               ('social_mute', 'muter_id'), ('social_reaction', 'principal_id'),
                               ('social_pref', 'principal_id')):
                self.assertEqual(conn.execute(f'SELECT count(*) FROM {table} WHERE {col} = ?', (a.pid,)).fetchone()[0],
                                 0, table)
            role = conn.execute("SELECT m.role FROM social_group_member m JOIN social_group g ON g.id = m.group_id "
                                "WHERE g.slug = 'agent-lab' AND m.principal_id = ?", (b.pid,)).fetchone()[0]
            self.assertEqual(role, 'owner')
            self.assertEqual(service.friend_ids(conn, b.pid), [])
            actor = Actor(id=a.pid, level=3, status='deleted')
            self.assertFalse(service.can_see(conn, actor.id, b.pid, 'members'))

    def test_module_absent_helpers_fail_closed(self):
        with self.db.write() as conn:
            conn.execute("DELETE FROM schema_migration WHERE id = 'social/social_0001.sql'")
            self.assertFalse(service.blocked(conn, 'a', 'b'))
            self.assertFalse(service.follows(conn, 'a', 'b'))
            self.assertEqual(service.friend_ids(conn, 'a'), [])
