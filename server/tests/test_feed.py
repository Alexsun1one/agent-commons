import os
import sys
import unittest
from pathlib import Path
from unittest import mock

from app import flags, outbox
from app.authz import Actor
from tests.helpers import HDRS, AppCase

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.feed import heat, sources
from engine.feed.fetch import Response, TransportError
from engine.feed.tests._common import item as make_item
from modules.feed import service, transport

FIXTURES = ROOT / 'engine' / 'feed' / 'tests' / 'fixtures'
NOW = '2026-10-25T08:00:00.000000Z'


def _rss(name):
    return (FIXTURES / name).read_bytes()


def fixture_transport(request):
    url = request['url']
    by_id = {s['url']: s['id'] for s in sources.SOURCES}
    sid = by_id.get(url)
    if sid == 'openai':
        return Response(200, _rss('rss_sample.xml'), {'Content-Type': 'application/rss+xml; charset=utf-8'})
    if sid == 'simon':
        return Response(200, _rss('atom_sample.xml'), {'Content-Type': 'application/atom+xml; charset=utf-8'})
    if sid == 'ai-json':
        return Response(200, _rss('json_feed_sample.json'), {'Content-Type': 'application/feed+json'})
    if sid == 'sspai':
        return Response(503, b'nope', {})
    return Response(200, b'<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>',
                    {'Content-Type': 'application/rss+xml'})


def drain(db):
    total = 0
    while True:
        n = outbox.dispatch(db)
        total += n
        if n == 0:
            break
    return total


class TransportGuardTest(unittest.TestCase):
    def test_adapter_rejects_non_whitelist_without_network(self):
        with mock.patch('urllib.request.urlopen') as opener:
            with self.assertRaises(TransportError):
                transport.urllib_transport({'url': 'https://evil.example/rss', 'headers': {}, 'timeout': 1})
            opener.assert_not_called()
        self.assertTrue(transport.allowed_url(sources.SOURCES[0]['url']))
        self.assertFalse(transport.allowed_url('https://evil.example/rss'))


class FeedFlagTest(AppCase):
    def test_disabled_module_is_501(self):
        with self.db.write() as conn:
            flags.set_flag(conn, 'feed.enabled', False, None)
        r = self.client().get('/api/feed/events')
        self.assertEqual(r.status_code, 501)
        self.assertEqual(self.code(r), 'capability_unavailable')


class FeedReadTest(AppCase):
    def setUp(self):
        super().setUp()
        transport.inject(None)

    def tearDown(self):
        transport.inject(None)
        super().tearDown()

    def _ingest(self, items, cluster=True):
        with self.db.write() as conn:
            service.ingest_items(conn, items, NOW)
            if cluster:
                service.cluster_pending(conn, NOW)

    def test_empty_page_shape(self):
        r = self.client().get('/api/feed/events')
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()['data']
        self.assertEqual(data['sample'], False)
        self.assertEqual(data['events'], [])
        self.assertEqual(data['failed_sources'], [])
        self.assertEqual([d['id'] for d in data['directions']], [i for i, _ in sources.DIRECTIONS])
        self.assertEqual(len(data['sources']), len(sources.SOURCES))
        flags_body = self.client().get('/api/flags').json()['data']
        self.assertTrue(flags_body['feed.enabled'])
        self.assertFalse(flags_body['feed.collect.enabled'])

    def test_cluster_zh_en_same_event_and_keep_apart(self):
        items = [
            make_item('openai', 'OpenAI releases GPT-5.5 with stronger agent skills', '2026-10-25T02:00:00Z'),
            make_item('hn', 'GPT-5.5 released by OpenAI', '2026-10-25T03:00:00Z'),
            make_item('jiqizhixin', 'OpenAI 发布 GPT-5.5，智能体能力更强', '2026-10-25T05:00:00Z'),
            make_item('qwen', 'Qwen3.5 open-weights family adds long-context variants', '2026-10-25T01:00:00Z'),
            make_item('hf-blog', 'Qwen3.5 is now on the Hub', '2026-10-25T01:30:00Z'),
        ]
        self._ingest(items)
        r = self.client().get('/api/feed/events?limit=20')
        events = r.json()['data']['events']
        titles = [e['title'] for e in events]
        gpt = [e for e in events if 'GPT-5.5' in e['title'] or 'GPT-5.5' in ''.join(s['title'] for s in e['sources'])]
        qwen = [e for e in events if 'Qwen' in e['title'] or any('Qwen' in s['title'] for s in e['sources'])]
        self.assertEqual(len(gpt), 1, titles)
        self.assertEqual(len(qwen), 1, titles)
        self.assertEqual(gpt[0]['source_count'], 3)
        self.assertEqual(qwen[0]['source_count'], 2)
        one = self.client().get(f"/api/feed/events/{gpt[0]['id']}")
        self.assertEqual(one.status_code, 200)
        self.assertEqual(len(one.json()['data']['sources']), 3)
        missing = self.client().get('/api/feed/events/ev-doesnotexist')
        self.assertEqual(self.code(missing), 'resource_not_found')

    def test_heat_same_source_counts_once(self):
        items = [
            make_item('openai', 'OpenAI releases GPT-5.5', '2026-10-25T02:00:00Z',
                      url='https://openai.example/a'),
            make_item('openai', 'OpenAI releases GPT-5.5 again', '2026-10-25T03:00:00Z',
                      url='https://openai.example/b'),
        ]
        self._ingest(items)
        ev = service.load_event(self.db.conn(), self.db.conn().execute('SELECT id FROM feed_event').fetchone()[0])
        h = heat.heat(ev, NOW)
        single = dict(ev, items=ev['items'][:1], source_ids=['openai'])
        self.assertEqual(h, heat.heat(single, NOW))

    def test_related_uses_visible_predicate(self):
        author = self.user('writer', level=2)
        other = self.user('reader', level=1)
        visible = self.obj(author, type='knowledge', title='GPT-5.5 长任务怎么拆',
                           content={'body': '检查点'}, visibility='members')
        hidden = self.obj(author, type='discussion', title='GPT-5.5 值不值得换',
                          content={'body': '讨论'}, visibility='named', acl=[author.pid])
        gone = self.obj(author, type='work', title='GPT-5.5 复现小工具',
                        content={'body': '作品'}, visibility='members')
        self.assertEqual(author.post(f"/api/objects/{gone['id']}/withdraw", headers=HDRS, json={}).status_code, 200)
        self._ingest([make_item('openai', 'OpenAI releases GPT-5.5', '2026-10-25T02:00:00Z')])
        eid = self.db.conn().execute('SELECT id FROM feed_event').fetchone()[0]
        with self.db.write() as conn:
            related = service.related_for(conn, Actor(id=other.pid, level=1, status='active'),
                                          service.load_event(conn, eid))
        self.assertEqual(related.get('knowledge', {}).get('id'), visible['id'])
        self.assertNotIn('discussion', related)
        self.assertNotIn('work', related)
        # 匿名谓词为假，站内相关必须空
        with self.db.write() as conn:
            anon = service.related_for(conn, Actor(), service.load_event(conn, eid))
        self.assertEqual(anon, {})

    def test_favorite_and_subscribe_need_login_and_persist(self):
        self._ingest([make_item('openai', 'OpenAI releases GPT-5.5', '2026-10-25T02:00:00Z')])
        eid = self.db.conn().execute('SELECT id FROM feed_event').fetchone()[0]
        anon = self.client()
        self.assertEqual(self.code(anon.post(f'/api/feed/events/{eid}/favorite', headers=HDRS, json={})),
                         'unauthenticated')
        self.assertEqual(self.code(anon.get('/api/feed/subscriptions')), 'unauthenticated')
        u = self.user('fan', level=1)
        fav = u.post(f'/api/feed/events/{eid}/favorite', headers=HDRS, json={})
        self.assertEqual(fav.status_code, 200, fav.text)
        self.assertTrue(fav.json()['data']['favorited'])
        self.assertEqual(fav.json()['data']['site']['favorites'], 1)
        again = u.post(f'/api/feed/events/{eid}/favorite', headers=HDRS, json={})
        self.assertFalse(again.json()['data']['favorited'])
        sub = u.put('/api/feed/subscriptions', headers=HDRS, json={'directions': ['model', 'agent']})
        self.assertEqual(sub.status_code, 200, sub.text)
        self.assertEqual(u.get('/api/feed/subscriptions').json()['data']['directions'], ['agent', 'model'])
        patched = u.patch('/api/feed/subscriptions', headers=HDRS, json={'directions': ['model']})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(u.get('/api/feed/subscriptions').json()['data']['directions'], ['model'])
        listed = u.get('/api/feed/events?directions=model').json()['data']['events']
        self.assertTrue(all(e['direction'] == 'model' for e in listed))

    def test_room_handoff_does_not_touch_rooms_module(self):
        self._ingest([make_item('openai', 'OpenAI releases GPT-5.5', '2026-10-25T02:00:00Z')])
        eid = self.db.conn().execute('SELECT id FROM feed_event').fetchone()[0]
        u = self.user('host', level=1)
        r = u.post(f'/api/feed/events/{eid}/room', headers=HDRS, json={})
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()['data']
        self.assertEqual(data['next']['module'], 'rooms')
        self.assertEqual(data['next']['action'], 'rooms.create.discussion')
        self.assertEqual(data['site']['rooms'], 1)
        pending = [row['event_type'] for row in self.db.conn().execute(
            'SELECT event_type FROM outbox_event WHERE event_type LIKE ?', ('feed.%',))]
        self.assertIn('feed.room.requested', pending)

    def test_digest_from_clustered_events(self):
        self._ingest([
            make_item('openai', 'OpenAI releases GPT-5.5', '2026-10-25T06:00:00Z'),
            make_item('qwen', 'Qwen3.5 open-weights family', '2026-10-25T05:00:00Z'),
        ])
        with self.db.write() as conn:
            built = service.persist_digest(conn, NOW)
        self.assertEqual(built['date'], '2026-10-25')
        r = self.client().get('/api/feed/digest?date=2026-10-25')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['data']['date'], '2026-10-25')
        self.assertTrue(r.json()['data']['sections'])

    def test_collect_disabled_does_not_use_transport(self):
        calls = []

        def spy(req):
            calls.append(req['url'])
            return Response(200, b'', {})

        transport.inject(spy)
        with self.db.write() as conn:
            outbox.emit(conn, 'feed.fetch', 'feed', 'all', {'now': NOW})
        drain(self.db)
        self.assertEqual(calls, [])
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM feed_item').fetchone()[0], 0)

    def test_collect_with_injected_fixtures_then_cluster(self):
        transport.inject(fixture_transport)
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 1 WHERE key = 'feed.collect.enabled'")
            outbox.emit(conn, 'feed.fetch', 'feed', 'all', {'now': NOW})
        drain(self.db)
        items = self.db.conn().execute('SELECT source_id, title FROM feed_item').fetchall()
        self.assertGreater(len(items), 0)
        self.assertTrue(all(r['source_id'] in sources.SOURCE_BY_ID for r in items))
        events = self.db.conn().execute('SELECT count(*) FROM feed_event').fetchone()[0]
        self.assertGreater(events, 0)
        failed = self.client().get('/api/feed/events').json()['data']['failed_sources']
        self.assertIn('sspai', failed)
        # 采集开关打开时仍不得打白名单以外的地址
        self.assertTrue(all(transport.allowed_url(s['url']) for s in sources.SOURCES))

    def test_unknown_source_id_is_dropped(self):
        self._ingest([
            make_item('openai', 'OpenAI releases GPT-5.5', '2026-10-25T02:00:00Z'),
            {'source': 'not-a-source', 'url': 'https://evil.example/x', 'canonical_url': 'https://evil.example/x',
             'title': 'should drop', 'excerpt': '', 'published_at': '2026-10-25T02:00:00Z', 'lang': 'en'},
        ])
        sources_used = {r[0] for r in self.db.conn().execute('SELECT source_id FROM feed_item')}
        self.assertEqual(sources_used, {'openai'})


if __name__ == '__main__':
    unittest.main()
