"""R17-G · 热点「相关」优先给热点页已建好的那篇讨论（content_hot_link），其次才是关键词猜测。"""
from app.authz import Actor
from tests.helpers import HDRS, AppCase
from tests.test_feed import NOW  # noqa: F401  先导入：它把仓库根放进 sys.path

from engine.feed.tests._common import item as make_item  # noqa: E402
from modules.feed import service, transport  # noqa: E402


class FeedRelatedLinkedTest(AppCase):
    def setUp(self):
        super().setUp()
        transport.inject(None)
        with self.db.write() as conn:
            service.ingest_items(conn, [make_item('openai', 'OpenAI releases GPT-5.5', '2026-10-25T02:00:00Z')], NOW)
            service.cluster_pending(conn, NOW)
        self.event_id = self.db.conn().execute('SELECT id FROM feed_event').fetchone()[0]

    def tearDown(self):
        transport.inject(None)
        super().tearDown()

    def related(self, who, **kw):
        actor = Actor(id=who.pid, level=kw.get('level', 1), status='active')
        with self.db.write() as conn:
            return service.related_for(conn, actor, service.load_event(conn, self.event_id))

    def open_discussion(self, who, key, title='这条热点怎么看'):
        r = who.post('/api/content/hot-discussions/' + self.event_id, headers={**HDRS, 'Idempotency-Key': key},
                     json={'title': title, 'body': '摘要'})
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()['data']['id']

    def test_linked_discussion_beats_a_newer_keyword_match(self):
        opener = self.user('r17g_feed_a', level=2)
        reader = self.user('r17g_feed_b', level=1)
        linked = self.open_discussion(opener, 'r17g-feed-key-1')
        newer = self.obj(opener, type='discussion', title='GPT-5.5 值不值得换', content={'body': '另一篇'},
                         visibility='members')
        found = self.related(reader)['discussion']
        self.assertEqual(found['id'], linked)
        self.assertNotEqual(found['id'], newer['id'])
        self.assertTrue(found['meta'].startswith('讨论 · '))

    def test_linked_discussion_shows_even_without_keyword_overlap(self):
        opener = self.user('r17g_feed_c', level=2)
        linked = self.open_discussion(opener, 'r17g-feed-key-2', title='完全无关的标题')
        self.assertEqual(self.related(opener)['discussion']['id'], linked)

    def test_withdrawn_link_falls_back_to_keyword(self):
        opener = self.user('r17g_feed_d', level=2)
        linked = self.open_discussion(opener, 'r17g-feed-key-3')
        fallback = self.obj(opener, type='discussion', title='GPT-5.5 备选讨论', content={'body': 'x'},
                            visibility='members')
        self.assertEqual(opener.post(f'/api/objects/{linked}/withdraw', headers=HDRS, json={}).status_code, 200)
        self.assertEqual(self.related(opener)['discussion']['id'], fallback['id'])

    def test_anonymous_still_sees_nothing(self):
        opener = self.user('r17g_feed_e', level=2)
        self.open_discussion(opener, 'r17g-feed-key-4')
        with self.db.write() as conn:
            self.assertEqual(service.related_for(conn, Actor(), service.load_event(conn, self.event_id)), {})
