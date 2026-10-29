import types as pytypes
import itertools
from datetime import datetime, timezone
import unittest
from unittest import mock

from app import objects
from app.errors import ApiError
from tests.helpers import HDRS
from tests.test_lg3a_r2 import AdultRegistrationMixin

from modules.content import sanitize, service
from modules.media.tests import images
from modules.media.tests.base import BE1Case, doc, image_node, para, text

MEDIA = '/api/media/f/' + 'a' * 64 + '.webp'


class SanitizeTest(unittest.TestCase):
    def test_scripts_events_and_javascript_links_removed(self):
        dirty = {'type': 'doc', 'attrs': {'onload': 'x'}, 'content': [
            {'type': 'script', 'content': [{'type': 'text', 'text': 'alert(1)'}]},
            {'type': 'html', 'attrs': {'html': '<img src=x onerror=alert(1)>'}},
            {'type': 'paragraph', 'attrs': {'onclick': 'steal()', 'style': 'x'}, 'content': [
                {'type': 'text', 'text': '坏链接', 'marks': [{'type': 'link', 'attrs': {'href': 'javascript:alert(1)'}}]},
                {'type': 'text', 'text': '藏起来', 'marks': [{'type': 'link', 'attrs': {'href': ' JaVa\tScRiPt:alert(1)'}}]},
                {'type': 'text', 'text': '数据', 'marks': [{'type': 'link', 'attrs': {'href': 'data:text/html,<b>'}}]},
                {'type': 'text', 'text': '冒名', 'marks': [{'type': 'link', 'attrs': {'href': 'https://a@evil.test/'}}]},
                {'type': 'text', 'text': '好链接', 'marks': [
                    {'type': 'link', 'attrs': {'href': 'https://example.com/a', 'target': '_self', 'rel': 'opener',
                                               'onmouseover': 'x'}},
                    {'type': 'bold'}, {'type': 'underline'}, {'type': 'bold'}]},
                {'type': 'text', 'text': '<script>alert(1)</script>'},
                {'type': 'emoji', 'attrs': {'name': 'skull'}},
                {'type': 'emoji', 'attrs': {'name': 'spark'}},
                {'type': 'mention', 'attrs': {'id': 'p1', 'label': '某人', 'onclick': 'x'}},
                {'type': 'paragraph', 'content': [{'type': 'text', 'text': '块级不该在行内'}]},
            ]},
            {'type': 'heading', 'attrs': {'level': 1}, 'content': [{'type': 'text', 'text': '一级'}]},
            {'type': 'heading', 'attrs': {'level': 6}, 'content': [{'type': 'text', 'text': '六级'}]},
            {'type': 'codeBlock', 'attrs': {'language': 'brainfuck'}, 'content': [
                {'type': 'text', 'text': 'a\nb', 'marks': [{'type': 'bold'}]}]},
            {'type': 'image', 'attrs': {'src': 'https://tracker.example/pixel.gif'}},
            {'type': 'image', 'attrs': {'src': 'data:image/png;base64,AAAA'}},
            {'type': 'image', 'attrs': {'src': MEDIA, 'alt': '图', 'onerror': 'x', 'width': 99999}},
            {'type': 'bulletList', 'content': [{'type': 'listItem', 'content': [{'type': 'heading', 'attrs': {
                'level': 2}, 'content': [{'type': 'text', 'text': '列表里的标题'}]}]}]},
            {'type': 'orderedList', 'content': []},
            {'type': 'knowledgeCard', 'attrs': {'refId': '../../etc'}},
            {'type': 'htmlWork', 'attrs': {'workId': 'w-1', 'title': 'x' * 100, 'bytes': 10 ** 9}},
        ]}
        clean = sanitize.sanitize_doc(dirty)
        flat = repr(clean)
        for bad in ('script', 'javascript', 'JaVa', 'onclick', 'onerror', 'onload', 'onmouseover', 'style',
                    'data:', 'tracker', 'evil', 'underline', 'skull', 'brainfuck', '_self', "'opener'", '../'):
            self.assertNotIn(bad, flat.replace('<script>alert(1)</script>', ''), bad)
        para_node = clean['content'][0]
        link = [t for t in para_node['content'] if t.get('text') == '好链接'][0]
        self.assertEqual(link['marks'], [
            {'type': 'link', 'attrs': {'href': 'https://example.com/a', 'target': '_blank',
                                       'rel': 'noopener nofollow ugc', 'class': None}}, {'type': 'bold'}])
        self.assertEqual([t.get('marks') for t in para_node['content'] if t.get('text') == '坏链接'], [None])
        self.assertIn({'type': 'text', 'text': '<script>alert(1)</script>'}, para_node['content'])
        self.assertEqual([c['attrs']['level'] for c in clean['content'] if c['type'] == 'heading'], [2, 3])
        code = [c for c in clean['content'] if c['type'] == 'codeBlock'][0]
        self.assertEqual(code, {'type': 'codeBlock', 'attrs': {'language': 'text'},
                                'content': [{'type': 'text', 'text': 'a\nb'}]})
        imgs = [c for c in clean['content'] if c['type'] == 'image']
        self.assertEqual(len(imgs), 1)
        self.assertEqual(imgs[0]['attrs']['width'], None)
        item = [c for c in clean['content'] if c['type'] == 'bulletList'][0]['content'][0]
        self.assertEqual(item['content'][0], {'type': 'paragraph'})
        self.assertNotIn('orderedList', [c['type'] for c in clean['content']])
        work = [c for c in clean['content'] if c['type'] == 'htmlWork'][0]['attrs']
        self.assertEqual((len(work['title']), work['bytes']), (60, 0))
        self.assertIn('@某人', sanitize.doc_text(clean))

    def test_limits(self):
        deep = {'type': 'paragraph'}
        node = {'type': 'blockquote', 'content': [deep]}
        for _ in range(50):
            node = {'type': 'blockquote', 'content': [node]}
        with self.assertRaises(ApiError):
            sanitize.sanitize_doc({'type': 'doc', 'content': [node]})
        with self.assertRaises(ApiError):
            sanitize.sanitize_doc({'type': 'paragraph'})
        many = {'type': 'doc', 'content': [{'type': 'horizontalRule'}] * (sanitize.MAX_NODES + 1)}
        with self.assertRaises(ApiError):
            sanitize.sanitize_doc(many)
        self.assertEqual(sanitize.sanitize_doc({'type': 'doc', 'content': []})['content'], [{'type': 'paragraph'}])


class ContentTest(AdultRegistrationMixin, BE1Case):
    def setUp(self):
        # Ordering assertions require distinct timestamps, including when another
        # suite's failed setUp has left a frozen clock patch active.
        ticks = itertools.count(datetime.now(timezone.utc).timestamp(), 0.001)
        patcher = mock.patch('app.clock.now_ts', side_effect=lambda: next(ticks))
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()
        self.a = self.user('alice', level=3)
        self.b = self.user('bob', level=2)
        self.c = self.user('carol', level=1)
        self.d = self.user('dave', level=1)

    def reply(self, client, target, body, reply_to=None, status=201):
        r = client.post(f'/api/content/objects/{target}/replies', headers=HDRS,
                        json={'body': body, **({'reply_to': reply_to} if reply_to else {})})
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 201 else r.json()

    def replies(self, client, target, **params):
        r = client.get(f'/api/content/objects/{target}/replies', params=params)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_rich_content_cleaned_through_core_and_indexed(self):
        body = doc(para(text('模型评测', {'type': 'link', 'attrs': {'href': 'javascript:alert(1)'}}),
                        {'type': 'mention', 'attrs': {'id': self.b.pid, 'label': '旧名字'}}),
                   {'type': 'knowledgeCard', 'attrs': {'refId': 'x'}})
        item = self.rich(self.a, doc=body, title='富文本', content={'tags': ['Agent', 'agent', ' 评测 '],
                                                                     'aigc': 'assist'})
        self.assertNotIn('javascript', repr(item['content']))
        self.assertEqual(item['content']['tags'], ['Agent', 'agent', '评测'])
        hits = self.b.get('/api/search', params={'q': '评测'}).json()['data']
        self.assertEqual([h['id'] for h in hits], [item['id']])
        self.assertEqual(self.code(self.b.post('/api/objects', headers=HDRS, json={
            'type': 'discussion', 'title': 't', 'content': {'body': 'x', 'cover': 'nope'}})), 'unknown_field')
        self.assertEqual(self.code(self.c.post('/api/objects', headers=HDRS, json={
            'type': 'agent_card', 'title': 'bot', 'content': {'what': '写周报'}})), 'action_not_allowed')
        card = self.obj(self.b, type='agent_card', title='周报助手', content={
            'what': '每周五自动汇总', 'model': 'local-model', 'links': ['https://example.com/bot'], 'tags': ['agent']})
        self.assertEqual(card['content']['what'], '每周五自动汇总')
        self.assertEqual(self.code(self.b.post('/api/objects', headers=HDRS, json={
            'type': 'agent_card', 'title': 'bad', 'content': {'what': 'x', 'links': ['javascript:1']}})),
            'validation_failed')
        self.drain()
        detail = self.b.get(f'/api/content/objects/{item["id"]}').json()['data']
        mention = detail['content']['doc']['content'][0]['content'][1]
        self.assertEqual(mention['attrs']['label'], 'bob')
        self.assertEqual(detail['cards'], {'x': None})
        self.assertEqual(detail['author']['level'], 3)

    def test_discord_thread_quotes_edits_deletes_and_two_orders(self):
        post = self.obj(self.a, title='讨论帖', content={'body': '开个头'})
        r1 = self.reply(self.b, post['id'], '第一条：' + '很长的内容' * 30)
        r2 = self.reply(self.c, post['id'], '回第一条', reply_to=r1['id'])
        r4 = self.reply(self.d, post['id'], '另起一条')
        r3 = self.reply(self.a, post['id'], '回第二条', reply_to=r2['id'])
        r5 = self.reply(self.b, r2['id'], '直接对回复编号回复')
        self.assertEqual((r1['depth'], r1['thread_root'], r1['reply_to'], r1['quote']), (0, r1['id'], None, None))
        self.assertEqual((r2['depth'], r2['thread_root'], r2['reply_to']), (1, r1['id'], r1['id']))
        self.assertEqual(r2['quote']['excerpt'], ('第一条：' + '很长的内容' * 30)[:80])
        self.assertEqual((r2['quote']['authorId'], r2['quote']['authorName'], r2['quote']['status']),
                         (self.b.pid, 'bob', 'ok'))
        self.assertEqual((r3['depth'], r3['thread_root']), (2, r1['id']))
        self.assertEqual((r5['reply_to'], r5['depth']), (r2['id'], 2))
        time_order = [m['id'] for m in self.replies(self.d, post['id'])['data']]
        self.assertEqual(time_order, [r1['id'], r2['id'], r4['id'], r3['id'], r5['id']])
        tree = [m['id'] for m in self.replies(self.d, post['id'], order='tree')['data']]
        self.assertEqual(tree, [r1['id'], r2['id'], r3['id'], r5['id'], r4['id']])
        sub = [m['id'] for m in self.replies(self.d, post['id'], order='tree', thread_root=r1['id'])['data']]
        self.assertEqual(sub, [r1['id'], r2['id'], r3['id'], r5['id']])
        pages, cursor = [], None
        while True:
            page = self.replies(self.d, post['id'], order='tree', limit=2, **({'cursor': cursor} if cursor else {}))
            pages += [m['id'] for m in page['data']]
            cursor = page['meta']['next_cursor']
            if not cursor:
                break
        self.assertEqual(pages, tree)

        r = self.b.patch(f'/api/content/replies/{r1["id"]}', headers={**HDRS, 'If-Match': r1['etag']},
                         json={'body': '改过了'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()['data']['version'], r.json()['data']['body']), (2, '改过了'))
        self.assertIsNotNone(r.json()['data']['editedAt'])
        stale = self.b.patch(f'/api/content/replies/{r1["id"]}', headers={**HDRS, 'If-Match': r1['etag']},
                             json={'body': '再改'})
        self.assertEqual(stale.status_code, 412)
        self.assertEqual(self.c.patch(f'/api/content/replies/{r1["id"]}', headers={
            **HDRS, 'If-Match': r.json()['data']['etag']}, json={'body': '冒改'}).status_code, 403)
        quote = {m['id']: m for m in self.replies(self.d, post['id'])['data']}[r2['id']]['quote']
        self.assertEqual((quote['status'], quote['excerpt'][:4]), ('edited', '第一条：'))

        self.assertEqual(self.b.post(f'/api/objects/{r1["id"]}/withdraw', headers=HDRS, json={}).status_code, 200)
        listed = {m['id']: m for m in self.replies(self.d, post['id'], order='tree')['data']}
        self.assertEqual(list(listed), [oid for oid in tree if oid != r1['id']])
        self.assertNotIn(r1['id'], repr(listed))
        self.assertIsNone(listed[r2['id']]['quote'])
        self.assertIsNone(listed[r2['id']]['reply_to'])
        self.assertEqual(listed[r2['id']]['thread_root'], r2['id'])
        self.assertEqual(listed[r3['id']]['thread_root'], r3['id'])
        self.assertEqual(listed[r3['id']]['status'], 'ok')
        self.reply(self.c, post['id'], '回已删的', reply_to=r1['id'], status=404)
        self.assertEqual(self.d.get(f'/api/content/replies/{r1["id"]}').status_code, 404)

        with self.db.write() as conn:
            objects.set_lifecycle(conn, None, r4['id'], 'hidden', 'gov_test')
        for order in ('time', 'tree'):
            pages, cursor = [], None
            while True:
                page = self.replies(self.a, post['id'], order=order, limit=2,
                                    **({'cursor': cursor} if cursor else {}))
                pages.extend(page['data'])
                cursor = page['meta']['next_cursor']
                if not cursor:
                    break
            expected = tree if order == 'tree' else time_order
            self.assertEqual([m['id'] for m in pages],
                             [oid for oid in expected if oid not in (r1['id'], r4['id'])])
            self.assertNotIn(r4['id'], repr(pages))
            self.assertNotIn(r1['id'], repr(pages))
        hidden = self.a.get(f'/api/content/replies/{r4["id"]}')
        missing = self.a.get('/api/content/replies/missing')
        self.assertEqual(hidden.status_code, 404)
        self.assertEqual(hidden.json()['error']['code'], missing.json()['error']['code'])
        self.assertEqual(hidden.json()['error']['message'], missing.json()['error']['message'])
        seen_by_author = {m['id']: m for m in self.replies(self.d, post['id'])['data']}[r4['id']]
        self.assertEqual((seen_by_author['status'], seen_by_author['body']), ('hidden', '另起一条'))

        self.drain()
        stats = self.a.get(f'/api/content/objects/{post["id"]}').json()['data']['stats']
        self.assertEqual(stats['replies'], 3)

    def test_thread_follows_root_visibility(self):
        secret = self.obj(self.a, title='点名', content={'body': '只给 bob'}, visibility='named', acl=[self.b.pid])
        r = self.reply(self.b, secret['id'], 'bob 回复')
        self.assertEqual(self.c.get(f'/api/content/objects/{secret["id"]}/replies').status_code, 404)
        self.assertEqual(self.c.get(f'/api/content/replies/{r["id"]}').status_code, 404)
        self.reply(self.c, secret['id'], '偷偷回', status=404)
        other = self.obj(self.a, title='另一帖', content={'body': 'x'})
        self.assertEqual(self.reply(self.b, other['id'], '跨串', reply_to=r['id'], status=422)['error']['code'],
                         'validation_failed')

    def test_reactions_one_per_kind_and_saves(self):
        post = self.obj(self.a, title='反应', content={'body': 'x'})
        url = f'/api/content/objects/{post["id"]}/reactions'
        for _ in range(2):
            r = self.b.put(f'{url}/up', headers=HDRS)
        self.b.put(f'{url}/spark', headers=HDRS)
        self.c.put(f'{url}/up', headers=HDRS)
        self.assertEqual(r.json()['data']['reactions'], {'up': 1})
        data = self.b.get(f'/api/content/objects/{post["id"]}').json()['data']
        self.assertEqual(data['stats']['reactions'], {'up': 2, 'spark': 1})
        self.assertEqual(data['mine']['reactions'], {'up': True, 'spark': True})
        self.assertEqual(self.b.delete(f'{url}/up', headers=HDRS).json()['data']['reactions'], {'up': 1, 'spark': 1})
        self.assertEqual(self.code(self.b.put(f'{url}/useful', headers=HDRS)), 'validation_failed')
        self.assertEqual(self.code(self.b.put(f'{url}/skull', headers=HDRS)), 'validation_failed')
        self.assertEqual(self.b.put(f'/api/content/objects/{post["id"]}/save', headers=HDRS).status_code, 200)
        self.assertEqual(self.b.put(f'/api/content/objects/{post["id"]}/save', headers=HDRS).status_code, 200)
        saved = self.b.get('/api/content/saved').json()['data']
        self.assertEqual([s['id'] for s in saved], [post['id']])
        self.assertTrue(saved[0]['mine']['saved'])
        self.assertEqual(self.c.get('/api/content/saved').json()['data'], [])
        self.a.post(f'/api/objects/{post["id"]}/withdraw', headers=HDRS, json={})
        self.assertEqual(self.b.get('/api/content/saved').json()['data'], [])
        self.assertEqual(self.b.put(f'{url}/up', headers=HDRS).status_code, 404)

    def test_useful_calls_growth_and_records_ledger_only_if_allowed(self):
        post = self.obj(self.a, title='有用', content={'body': 'x'})
        other = self.obj(self.a, title='有用二', content={'body': 'y'})
        calls = []

        def assess(conn, *, giver_id, receiver_id, object_id, now=None):
            calls.append((giver_id, receiver_id, object_id))
            return {'allow': object_id == post['id'], 'points': 5, 'discount': 1.0,
                    'reason': None if object_id == post['id'] else 'giver_account_too_new'}

        fake = pytypes.SimpleNamespace(assess_useful=assess)
        with mock.patch.object(service, '_antiabuse', lambda: fake):
            ok = self.b.post(f'/api/content/objects/{post["id"]}/useful', headers=HDRS)
            self.assertEqual(ok.status_code, 200, ok.text)
            self.assertEqual((ok.json()['data']['counted'], ok.json()['data']['points']), (True, 5))
            no = self.b.post(f'/api/content/objects/{other["id"]}/useful', headers=HDRS).json()['data']
            self.assertEqual((no['counted'], no['reason']), (False, 'giver_account_too_new'))
            self.assertEqual(self.code(self.b.post(f'/api/content/objects/{post["id"]}/useful', headers=HDRS)),
                             'state_conflict')
            self.assertEqual(self.code(self.a.post(f'/api/content/objects/{post["id"]}/useful', headers=HDRS)),
                             'state_conflict')
        self.assertEqual(calls, [(self.b.pid, self.a.pid, post['id']), (self.b.pid, self.a.pid, other['id'])])
        rows = self.db.conn().execute("SELECT subject_id, points, idempotency_key FROM ledger_entry "
                                      "WHERE event_type = 'useful'").fetchall()
        self.assertEqual([tuple(r) for r in rows], [(self.a.pid, 5, f'useful:{self.b.pid}:{post["id"]}')])

        recorded = []

        def record_useful(conn, *, giver_id, receiver_id, object_id, request_id=None, now=None):
            recorded.append(object_id)
            return {'allow': True, 'points': 7, 'discount': 1.0, 'reason': None, 'entry_id': 'e-1'}

        with mock.patch.object(service, '_antiabuse', lambda: pytypes.SimpleNamespace(
                record_useful=record_useful, assess_useful=assess)):
            r = self.c.post(f'/api/content/objects/{post["id"]}/useful', headers=HDRS).json()['data']
        self.assertEqual((recorded, r['counted'], r['points'], r['useful']), ([post['id']], True, 7, 2))
        with mock.patch.object(service, '_antiabuse', lambda: None):
            r = self.d.post(f'/api/content/objects/{post["id"]}/useful', headers=HDRS).json()['data']
        self.assertEqual((r['counted'], r['reason']), (False, 'growth_unavailable'))
        listed = self.a.get(f'/api/content/objects/{post["id"]}').json()['data']
        self.assertEqual((listed['stats']['useful'], listed['stats']['reactions'].get('useful')), (3, 3))

    def test_useful_with_real_growth_module_if_present(self):
        if service._antiabuse() is None:
            self.skipTest('GROW-1 模块不在')
        post = self.obj(self.a, title='真实防刷', content={'body': 'x'})
        r = self.b.post(f'/api/content/objects/{post["id"]}/useful', headers=HDRS)
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()['data']
        self.assertFalse(data['counted'])
        self.assertTrue(data['reason'])
        count = self.db.conn().execute("SELECT count(*) FROM ledger_entry WHERE event_type = 'useful'").fetchone()[0]
        self.assertEqual(count, 0)

    def test_feeds_new_hot_following_and_cache_scope(self):
        low = self.obj(self.a, title='大家能看', content={'body': 'x', 'tags': ['RAG']})
        high = self.obj(self.a, title='三级以上', content={'body': 'x', 'tags': ['rag']}, visibility='level',
                        min_level=3)
        draft = self.obj(self.a, title='草稿', content={'body': 'x', 'tags': ['rag']}, lifecycle='draft')
        quiet = self.obj(self.b, title='没人理', content={'body': 'x', 'tags': ['other']})
        self.reply(self.b, low['id'], '回复不进列表')
        self.drain()
        ids = lambda client, **p: [i['id'] for i in client.get('/api/content/feed', params=p).json()['data']]
        self.assertEqual(ids(self.a, sort='new'), [quiet['id'], high['id'], low['id']])
        self.assertEqual(ids(self.c, sort='new'), [quiet['id'], low['id']])
        self.assertNotIn(draft['id'], ids(self.a, sort='hot'))
        for _ in range(1):
            self.c.put(f'/api/content/objects/{low["id"]}/reactions/up', headers=HDRS)
            self.d.put(f'/api/content/objects/{low["id"]}/reactions/up', headers=HDRS)
        self.assertEqual(ids(self.a, sort='hot')[0], low['id'])
        first = self.a.get('/api/content/feed', params={'sort': 'hot'}).json()
        again = self.a.get('/api/content/feed', params={'sort': 'hot'}).json()
        self.assertEqual((first['meta']['cached'], again['meta']['cached']), (True, True))
        low_view = self.c.get('/api/content/feed', params={'sort': 'hot'}).json()
        self.assertFalse(low_view['meta']['cached'])
        self.assertNotIn(high['id'], [i['id'] for i in low_view['data']])
        self.b.put(f'/api/content/objects/{quiet["id"]}/save', headers=HDRS)
        after_write = self.a.get('/api/content/feed', params={'sort': 'hot'}).json()
        self.assertFalse(after_write['meta']['cached'])
        self.assertEqual(self.a.put('/api/content/follows/ rag ', headers=HDRS).json()['data'], ['rag'])
        self.assertEqual(ids(self.a, sort='following'), [high['id'], low['id']])
        self.c.put('/api/content/follows/RAG', headers=HDRS)
        self.assertEqual(ids(self.c, sort='following'), [low['id']])
        self.assertEqual(ids(self.a, sort='new', type='work'), [])
        page = self.a.get('/api/content/feed', params={'sort': 'hot', 'limit': 1}).json()
        nxt = self.a.get('/api/content/feed', params={'sort': 'hot', 'limit': 1,
                                                      'cursor': page['meta']['next_cursor']}).json()
        self.assertNotEqual(page['data'][0]['id'], nxt['data'][0]['id'])
        self.assertEqual(self.a.get('/api/content/feed', params={'sort': 'new', 'cursor':
                                                                 page['meta']['next_cursor']}).status_code, 409)
        card = [i for i in self.c.get('/api/content/feed').json()['data'] if i['id'] == low['id']][0]
        self.assertEqual((card['stats']['reactions'], card['mine']['reactions'], card['tags']),
                         ({'up': 2}, {'up': True}, ['RAG']))

    def test_following_feed_pages_through_small_batches_with_hidden_items(self):
        made = []
        for i in range(9):
            hidden = 2 <= i <= 7
            made.append((self.obj(self.a, title=f'方向{i}', content={'body': 'x', 'tags': ['MCP']},
                                  **({'visibility': 'level', 'min_level': 3} if hidden else {}))['id'], hidden))
        self.obj(self.a, title='别的方向', content={'body': 'x', 'tags': ['other']})
        self.drain()
        self.c.put('/api/content/follows/mcp', headers=HDRS)
        want = [oid for oid, hidden in reversed(made) if not hidden]
        with mock.patch.object(service, 'FOLLOW_BATCH', 2), mock.patch.object(service, 'FOLLOW_ROUNDS', 2):
            got, cursor, pages = [], None, 0
            while True:
                params = {'sort': 'following', 'limit': 2, **({'cursor': cursor} if cursor else {})}
                page = self.c.get('/api/content/feed', params=params).json()
                got += [i['id'] for i in page['data']]
                cursor, pages = page['meta']['next_cursor'], pages + 1
                if not cursor:
                    break
        self.assertEqual(got, want)
        self.assertEqual(pages, 2)  # 第一页扫满两批只找到 1 条，带游标返回短页
        everything = [i['id'] for i in self.a.get('/api/content/feed', params={'sort': 'following'}).json()['data']]
        self.assertEqual(everything, [])

    def test_search_highlights_only_visible(self):
        self.obj(self.a, title='模型路由', content={'body': '讲大模型路由和评测。'})
        self.obj(self.a, title='高阶模型', content={'body': '只给三级的模型笔记'}, visibility='level', min_level=3)
        hits = self.c.get('/api/content/search', params={'q': '模型'}).json()['data']
        self.assertEqual(len(hits), 1)
        snippet, spans = hits[0]['snippet'], hits[0]['highlights']
        self.assertTrue(spans)
        self.assertTrue(all(snippet[s:e] == '模型' for s, e in spans))
        self.assertEqual(hits[0]['title_highlights'], [[0, 2]])
        self.assertEqual(len(self.a.get('/api/content/search', params={'q': '模型'}).json()['data']), 2)

    def test_core_created_reply_is_threaded_after_outbox(self):
        post = self.obj(self.a, title='核心建的回复', content={'body': 'x'})
        raw = self.obj(self.b, type='reply', title='r', content={'body': '经核心接口'}, root_id=post['id'])
        listed = self.replies(self.c, post['id'])['data']
        self.assertEqual((listed[0]['id'], listed[0]['thread_root'], listed[0]['depth']), (raw['id'], raw['id'], 0))
        self.drain()
        child = self.reply(self.c, post['id'], '接着回', reply_to=raw['id'])
        self.assertEqual((child['thread_root'], child['depth']), (raw['id'], 1))

    def test_detail_images_and_types_registered(self):
        maker = self.user('maker', level=2)
        asset = self.asset(maker, images.png(320, 200), 'x.png')
        item = self.rich(maker, title='图文', doc=doc(para(text('看')), image_node(asset['image']['src'])),
                         content={'cover': asset['id']})
        self.drain()
        data = self.b.get(f'/api/content/objects/{item["id"]}').json()['data']
        self.assertEqual(data['images'][asset['image']['src']]['image']['width'], 320)
        self.assertEqual(data['assets'][asset['id']]['id'], asset['id'])
        card = [i for i in self.b.get('/api/content/feed').json()['data'] if i['id'] == item['id']][0]
        self.assertEqual(card['cover']['id'], asset['id'])
        schema = self.b.get('/api/content/schema').json()['data']
        self.assertIn('agent_card', schema['types'])
        self.assertEqual(objects.TYPES['reply'][0].__module__, 'modules.content.types')


if __name__ == '__main__':
    unittest.main()
