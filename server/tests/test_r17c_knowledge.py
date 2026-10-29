"""R17-C 知识与讨论：问题库字典接口、作者 handle、热点讨论去重、日报已读、悬赏门槛。"""
from app import clock, flags
from modules.content import service
from modules.kb import router as kb_router
from tests.helpers import AppCase, HDRS


class R17CKnowledgeTest(AppCase):
    def event(self, event_id='ev-1', title='某模型发布'):
        now = clock.now()
        with self.db.write() as conn:
            conn.execute(
                'INSERT INTO feed_event (id, title, direction, first_seen, last_seen, created_at, updated_at) '
                "VALUES (?, ?, 'model', ?, ?, ?, ?)", (event_id, title, now, now, now, now))

    # ---- kb 字典 ----

    def test_taxonomy_matches_lexicon_and_needs_login(self):
        member = self.user('r17c_kb')
        data = member.get('/api/kb/taxonomy').json()['data']
        self.assertEqual({t['key'] for t in data['tools']}, kb_router.TOOL_KEYS)
        self.assertEqual({t['key'] for t in data['industries']}, kb_router.INDUSTRY_KEYS)
        claude = next(t for t in data['tools'] if t['key'] == 'claude')
        self.assertEqual(claude['label'], 'Claude')
        self.assertTrue(all(t['label'] and t['group'] for t in data['tools']))
        self.assertEqual(self.client().get('/api/kb/taxonomy').status_code, 401)

    def test_taxonomy_follows_kb_switch(self):
        member = self.user('r17c_kb_off')
        with self.db.write() as conn:
            flags.set_flag(conn, 'kb.enabled', False, None)
        response = member.get('/api/kb/taxonomy')
        self.assertEqual(self.code(response), 'capability_unavailable')

    # ---- 作者 handle ----

    def test_detail_and_replies_carry_author_handle(self):
        author = self.user('r17c_author')
        replier = self.user('r17c_replier')
        post = self.obj(author)
        detail = replier.get('/api/content/objects/' + post['id']).json()['data']
        self.assertEqual(detail['author']['handle'], 'r17c_author')
        reply = replier.post('/api/content/objects/' + post['id'] + '/replies', headers=HDRS, json={'body': '回复'})
        self.assertEqual(reply.status_code, 201, reply.text)
        rows = author.get('/api/content/objects/' + post['id'] + '/replies').json()['data']
        self.assertEqual(rows[0]['author']['handle'], 'r17c_replier')
        feed = author.get('/api/content/feed').json()['data']
        self.assertEqual(feed[0]['author']['handle'], 'r17c_author')

    def test_anonymous_actor_gets_no_handle(self):
        author = self.user('r17c_anon')
        post = self.obj(author)
        anonymous = type('A', (), {'authenticated': False})()
        people = service.people(self.db.conn(), anonymous, [author.pid])
        self.assertIsNone(people[author.pid]['handle'])
        self.assertTrue(post['id'])

    # ---- 热点讨论去重 ----

    def test_hot_event_gets_one_discussion_for_everyone(self):
        self.event()
        first = self.user('r17c_hot_a')
        second = self.user('r17c_hot_b')
        body = {'title': '某模型发布', 'body': '摘要'}
        self.assertIsNone(first.get('/api/content/hot-discussions/ev-1').json()['data'])
        made = first.post('/api/content/hot-discussions/ev-1', headers={**HDRS, 'Idempotency-Key': 'r17c-key-1-aaaa'}, json=body)
        self.assertEqual(made.status_code, 201, made.text)
        self.assertTrue(made.json()['data']['created'])
        again = second.post('/api/content/hot-discussions/ev-1', headers={**HDRS, 'Idempotency-Key': 'r17c-key-2-aaaa'}, json=body)
        self.assertEqual(again.status_code, 200, again.text)
        self.assertFalse(again.json()['data']['created'])
        self.assertEqual(again.json()['data']['id'], made.json()['data']['id'])
        self.assertEqual(second.get('/api/content/hot-discussions/ev-1').json()['data']['id'],
                         made.json()['data']['id'])
        count = self.db.conn().execute("SELECT count(*) FROM object_head WHERE type = 'discussion'").fetchone()[0]
        self.assertEqual(count, 1)

    def test_hot_discussion_unknown_event_and_bad_id(self):
        member = self.user('r17c_hot_none')
        body = {'title': 'x', 'body': ''}
        response = member.post('/api/content/hot-discussions/nope', headers={**HDRS, 'Idempotency-Key': 'r17c-key-3-aaaa'}, json=body)
        self.assertEqual(response.status_code, 404, response.text)
        response = member.get('/api/content/hot-discussions/' + 'x' * 81)
        self.assertEqual(response.status_code, 422, response.text)

    def test_withdrawn_discussion_is_replaced_not_resurrected(self):
        self.event()
        member = self.user('r17c_hot_gone')
        body = {'title': '某模型发布', 'body': ''}
        first = member.post('/api/content/hot-discussions/ev-1', headers={**HDRS, 'Idempotency-Key': 'r17c-key-4-aaaa'}, json=body)
        with self.db.write() as conn:
            conn.execute("UPDATE object_head SET lifecycle = 'withdrawn' WHERE id = ?", (first.json()['data']['id'],))
        self.assertIsNone(member.get('/api/content/hot-discussions/ev-1').json()['data'])
        second = member.post('/api/content/hot-discussions/ev-1', headers={**HDRS, 'Idempotency-Key': 'r17c-key-5-aaaa'}, json=body)
        self.assertEqual(second.status_code, 201, second.text)
        self.assertNotEqual(second.json()['data']['id'], first.json()['data']['id'])

    # ---- 日报已读 ----

    def test_digest_read_syncs_per_member_and_per_day(self):
        member = self.user('r17c_dg_a')
        other = self.user('r17c_dg_b')
        today = clock.now()[:10]
        self.assertFalse(member.get('/api/content/digest-read/' + today).json()['data']['read'])
        marked = member.put('/api/content/digest-read/' + today, headers=HDRS)
        self.assertTrue(marked.json()['data']['read'], marked.text)
        self.assertTrue(member.put('/api/content/digest-read/' + today, headers=HDRS).json()['data']['read'])
        self.assertTrue(member.get('/api/content/digest-read/' + today).json()['data']['read'])
        self.assertFalse(other.get('/api/content/digest-read/' + today).json()['data']['read'])
        cleared = member.delete('/api/content/digest-read/' + today, headers=HDRS)
        self.assertFalse(cleared.json()['data']['read'])

    def test_digest_read_rejects_bad_and_far_future_dates(self):
        member = self.user('r17c_dg_bad')
        for day in ('2026-13-40', '2999-01-01'):
            response = member.put('/api/content/digest-read/' + day, headers=HDRS)
            self.assertEqual(response.status_code, 422, (day, response.text))
        self.assertEqual(member.put('/api/content/digest-read/not-a-date', headers=HDRS).status_code, 422)

    def test_hot_tables_are_exported_and_purged(self):
        self.event()
        member = self.user('r17c_dg_rights')
        today = clock.now()[:10]
        member.put('/api/content/digest-read/' + today, headers=HDRS)
        member.post('/api/content/hot-discussions/ev-1', headers={**HDRS, 'Idempotency-Key': 'r17c-key-6-aaaa'},
                    json={'title': '某模型发布', 'body': ''})
        actor = type('A', (), {'id': member.pid})()
        with self.db.write() as conn:
            exported = service.export_rows(conn, actor)
            self.assertEqual([r['date'] for r in exported['digest_reads']], [today])
            self.assertEqual(len(exported['hot_discussions_opened']), 1)
            service.purge_principal(conn, member.pid)
            self.assertEqual(conn.execute('SELECT count(*) FROM content_digest_read').fetchone()[0], 0)
            self.assertIsNone(conn.execute('SELECT created_by FROM content_hot_link').fetchone()[0])

    # ---- 悬赏门槛 ----

    def test_bounty_rules_expose_levels_from_action_rule(self):
        with self.db.write() as conn:
            flags.set_flag(conn, 'bounty.enabled', True, None)
            conn.execute("UPDATE action_rule SET min_level = 3 WHERE action = 'bounty.create.help'")
        member = self.user('r17c_bounty', level=3)
        levels = member.get('/api/bounty/rules').json()['data']['min_levels']
        self.assertEqual(levels['create_help'], 3)
        self.assertEqual(levels['create_promo'], 2)
        self.assertEqual(levels['topup'], 2)
        self.assertEqual(levels['season_grant'], 2)
        self.assertEqual(levels['useful_giver'], 2)
        self.assertEqual(levels['useful_account_days'], 7)
