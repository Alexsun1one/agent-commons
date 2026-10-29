"""发布、快照、撤回、初筛、JSON-LD 与转义。"""
import json
import re
import unittest
import xml.etree.ElementTree as ET

from app import outbox
from modules.public import screen

from .support import PublicCase

LD = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


class PublishTest(PublicCase):
    def ld(self, html):
        match = LD.search(html)
        self.assertIsNotNone(match, '页面缺 JSON-LD')
        return json.loads(match.group(1))

    def test_page_markdown_jsonld_and_escaping(self):
        user = self.user('alice', level=2)
        title = '<script>alert(1)</script> 提示词'
        item = self.make(user, title=title, content={
            'body': '<img src=x onerror=alert(2)>\n\n**加粗** 和 [坏链接](javascript:alert(3))\n\n'
                    '```python\n    x = 1\n    y = 2\n```',
            'summary': '一句摘要'})
        published = self.publish_ok(user, item['id'])
        self.assertEqual(published['status'], 'live')
        self.assertEqual(published['url'], 'https://commons.test/p/knowledge/hello')
        page = self.client().get('/api/public/p/knowledge/hello')
        self.assertEqual(page.status_code, 200)
        html = page.text
        self.assertNotIn('<script>alert', html)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', html)
        self.assertNotIn('<img src=x', html)
        self.assertIn('&lt;img', html)
        self.assertIn('<strong>加粗</strong>', html)
        self.assertIn('<pre><code class="language-python">    x = 1\n    y = 2</code></pre>', html)
        self.assertNotIn('href="javascript:', html)
        self.assertIn('rel="canonical" href="https://commons.test/p/knowledge/hello"', html)
        self.assertIn('property="og:title"', html)
        self.assertIn('type="text/markdown"', html)
        data = self.ld(html)
        self.assertEqual(data['@type'], 'Article')
        self.assertEqual(data['name'], title)
        self.assertEqual(data['url'], 'https://commons.test/p/knowledge/hello')
        self.assertEqual(data['isAccessibleForFree'], True)
        self.assertIn('license', data)
        self.assertIn('citation', data)

        md = self.client().get('/api/public/p/knowledge/hello.md')
        self.assertIn(f'# {title}', md.text)
        self.assertEqual(md.headers['content-type'], 'text/markdown; charset=utf-8')

    def test_snapshot_does_not_follow_later_edits_and_republish_replaces(self):
        user = self.user('alice', level=2)
        item = self.make(user, title='旧标题', content={'body': '旧正文', 'summary': '旧摘要'})
        self.publish_ok(user, item['id'])
        self.assertEqual(self.snapshot_count(), 1)
        patched = user.patch(f'/api/objects/{item["id"]}', headers={'Origin': 'https://commons.test',
                                                                  'X-Commons-CSRF': '1',
                                                                  'If-Match': item['etag']},
                             json={'title': '新标题', 'content': {'body': '新正文', 'summary': '新摘要'}})
        self.assertEqual(patched.status_code, 200, patched.text)
        page = self.client().get('/api/public/p/knowledge/hello').text
        self.assertIn('旧标题', page)
        self.assertIn('旧正文', page)
        self.assertNotIn('新正文', page)

        again = self.publish_ok(user, item['id'])
        self.assertEqual(again['status'], 'live')
        self.assertEqual(self.snapshot_count(), 2)
        page = self.client().get('/api/public/p/knowledge/hello').text
        self.assertIn('新标题', page)
        self.assertIn('新正文', page)
        with self.db.read() as conn:
            old = conn.execute("SELECT taken_down_at, takedown_reason FROM public_snapshot "
                               "WHERE title = '旧标题'").fetchone()
        self.assertIsNotNone(old['taken_down_at'])
        self.assertEqual(old['takedown_reason'], 'superseded')

    def test_republish_other_object_slug_conflict(self):
        alice = self.user('alice', level=2)
        bob = self.user('bob', level=2)
        first = self.make(alice)
        second = self.make(bob)
        self.publish_ok(alice, first['id'])
        conflict = self.publish(bob, second['id'])
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['error']['code'], 'public_slug_conflict')

    def test_withdraw_takes_page_down_410_and_outbox_marks_snapshot(self):
        user = self.user('alice', level=2)
        item = self.make(user)
        self.publish_ok(user, item['id'])
        response = user.post(f'/api/objects/{item["id"]}/withdraw',
                                 headers={'Origin': 'https://commons.test', 'X-Commons-CSRF': '1'}, json={})
        self.assertEqual(response.status_code, 200, response.text)
        client = self.client()
        page = client.get('/api/public/p/knowledge/hello')
        self.assertEqual(page.status_code, 410)
        self.assertIn('下线', page.text)
        self.assertIn('noindex', page.text)
        md = client.get('/api/public/p/knowledge/hello.md')
        self.assertEqual(md.status_code, 410)
        self.assertEqual(md.headers['content-type'], 'text/plain; charset=utf-8')
        self.assertEqual(client.get('/api/public/p/knowledge/hello', headers={'Accept': 'text/markdown'}).status_code,
                         410)
        self.assertNotIn('hello', client.get('/api/public/sitemap.xml').text)
        with self.db.read() as conn:
            self.assertIsNone(conn.execute(
                "SELECT taken_down_at FROM public_snapshot WHERE slug = 'hello'").fetchone()[0])
        outbox.dispatch(self.db)
        with self.db.read() as conn:
            row = conn.execute("SELECT taken_down_at, takedown_reason FROM public_snapshot WHERE slug = 'hello'"
                               ).fetchone()
            audits = [r[0] for r in conn.execute("SELECT action FROM audit_event WHERE action = 'public.takedown'")]
        self.assertIsNotNone(row['taken_down_at'])
        self.assertEqual(row['takedown_reason'], 'withdrawn')
        self.assertIn('public.takedown', audits)
        self.assertEqual(client.get('/api/public/p/knowledge/hello').status_code, 410)

    def test_hidden_object_is_taken_down(self):
        user = self.user('alice', level=2)
        item = self.make(user)
        self.publish_ok(user, item['id'])
        with self.db.write() as conn:
            conn.execute("UPDATE object_head SET lifecycle = 'hidden' WHERE id = ?", (item['id'],))
        self.assertEqual(self.client().get('/api/public/p/knowledge/hello').status_code, 410)

    def test_unpublished_and_pending_are_404(self):
        user = self.user('alice', level=2)
        self.assertEqual(self.client().get('/api/public/p/knowledge/nothing').status_code, 404)
        screen.register_screener(lambda *args: {'result': 'review', 'reasons': ['needs_human']})
        item = self.make(user)
        pending = self.publish(user, item['id'])
        self.assertEqual(pending.status_code, 202)
        self.assertEqual(pending.json()['data']['status'], 'pending')
        client = self.client()
        self.assertEqual(client.get('/api/public/p/knowledge/hello').status_code, 404)
        self.assertEqual(client.get('/api/public/p/knowledge/hello.md').status_code, 404)
        self.assertNotIn('hello', client.get('/api/public/sitemap.xml').text)
        self.assertNotIn('公开知识', client.get('/api/public/llms.txt').text)
        self.assertEqual(client.get('/api/public/feed.json').json()['items'], [])

        snapshot_id = pending.json()['data']['id']
        admin = self.user('admin', level=2, roles=('admin',), totp=True)
        approved = admin.post(f'/api/public/admin/snapshots/{snapshot_id}/approve', headers={
            'Origin': 'https://commons.test', 'X-Commons-CSRF': '1'}, json={})
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()['data']['status'], 'live')
        self.assertEqual(client.get('/api/public/p/knowledge/hello').status_code, 200)

    def test_screener_block_and_builtin_contact_rules(self):
        user = self.user('alice', level=2)
        screen.register_screener(lambda *args: {'result': 'block',
                                                'reasons': [{'code': 'test_block', 'severity': 'block'}]})
        blocked = self.publish(user, self.make(user, title='会被拦')['id'], slug='blocked')
        self.assertEqual(blocked.status_code, 422)
        self.assertEqual(blocked.json()['error']['code'], 'public_screen_blocked')
        self.assertEqual(self.snapshot_count(), 0)
        del screen.SCREENERS[:]

        contact = self.make(user, title='联系方式', content={'body': '加我 wxid_abc12345', 'summary': ''})
        builtin = self.publish(user, contact['id'], slug='contact')
        self.assertEqual(builtin.status_code, 422)
        with self.db.read() as conn:
            denied = conn.execute("SELECT outcome, reason_code FROM audit_event WHERE action = 'public.publish' "
                                  "AND outcome = 'denied'").fetchone()
        self.assertEqual(denied['reason_code'], 'screen_blocked')

    def test_jsonld_type_follows_content(self):
        self.add_rich_types()
        user = self.user('alice', level=2)
        cases = [
            ('howto', 'knowledge', {'body': '照着做', 'steps': [
                {'title': '准备', 'text': '装好环境'}, {'title': '执行', 'text': '跑起来'}]}, 'HowTo'),
            ('faq', 'qa', {'body': '问答', 'faq': [{'q': '能跑吗', 'a': '能'}]}, 'QAPage'),
            ('talk', 'talk', {'body': '讲稿', 'transcript': '逐字稿内容'}, 'Event'),
            ('term', 'term', {'body': '术语定义'}, 'DefinedTerm'),
            ('trend', 'trend', {'body': '周报', 'dataset': 'tool-heat'}, 'Dataset'),
            ('hot', 'hot', {'summary': '我们自己写的摘要',
                            'links': [{'title': '新闻 A', 'url': 'https://example.com/a'}]}, 'NewsArticle'),
            ('tool', 'tool', {'body': '工具页', 'application_category': 'DeveloperApplication'},
             'SoftwareApplication'),
        ]
        client = self.client()
        for type_, kind, content, expected in cases:
            slug = f'case-{type_}'
            item = self.make(user, type_=type_, title=f'{expected} 标题', content=content)
            self.publish_ok(user, item['id'], kind=kind, slug=slug)
            data = self.ld(client.get(f'/api/public/p/{kind}/{slug}').text)
            self.assertEqual(data['@type'], expected, type_)
        steps = self.ld(client.get('/api/public/p/knowledge/case-howto').text)
        self.assertEqual(len(steps['step']), 2)
        self.assertEqual(steps['step'][0]['name'], '准备')
        faq = self.ld(client.get('/api/public/p/qa/case-faq').text)
        self.assertEqual(faq['mainEntity']['name'], '能跑吗')
        self.assertEqual(faq['mainEntity']['acceptedAnswer']['text'], '能')
        talk = self.ld(client.get('/api/public/p/talk/case-talk').text)
        self.assertEqual(talk['subjectOf']['text'], '逐字稿内容')
        term = self.ld(client.get('/api/public/p/term/case-term').text)
        self.assertEqual(term['termCode'], 'case-term')
        trend = self.ld(client.get('/api/public/p/trend/case-trend').text)
        self.assertTrue(trend['distribution'][0]['contentUrl'].endswith('/datasets/tool-heat.csv'))
        hot = self.ld(client.get('/api/public/p/hot/case-hot').text)
        self.assertEqual(hot['articleBody'], '我们自己写的摘要')
        self.assertEqual(hot['citation'], ['https://example.com/a'])
        tool = self.ld(client.get('/api/public/p/tool/case-tool').text)
        self.assertEqual(tool['operatingSystem'], 'Web')

    def test_publish_validation_and_license_default(self):
        alice = self.user('alice', level=2)
        bob = self.user('bob', level=2)
        item = self.make(alice)
        other = self.publish(bob, item['id'])
        self.assertEqual(other.status_code, 403)
        self.assertEqual(self.publish(alice, item['id'], slug='Bad Slug').status_code, 422)
        self.assertEqual(self.publish(alice, item['id'], kind='nope').status_code, 422)
        self.assertEqual(self.publish(alice, item['id'], license='nope').status_code, 422)
        self.assertEqual(self.publish(alice, item['id'], version=99).status_code, 404)
        draft = self.obj(alice, lifecycle='draft')
        self.assertEqual(self.publish(alice, draft['id'], slug='draft-one').status_code, 409)

        self.assertEqual(self.publish(alice, item['id'], license='cc-by-4.0').status_code, 422)
        consent = self.publish(alice, item['id'], slug='licensed-cc', license='cc-by-4.0',
                               license_consent=True)
        self.assertEqual(consent.status_code, 201, consent.text)
        self.assertEqual(consent.json()['data']['license']['label'], 'CC BY 4.0')
        self.assertIn('CC BY 4.0', self.client().get('/api/public/p/knowledge/licensed-cc').text)
        published = self.publish(alice, item['id'], slug='licensed')
        self.assertEqual(published.status_code, 201, published.text)
        self.assertEqual(published.json()['data']['license']['label'], '许可待定')
        page = self.client().get('/api/public/p/knowledge/licensed').text
        self.assertIn('许可待定', page)
        self.assertIn('许可：待定', self.client().get('/api/public/llms.txt').text)


class FeedConsistencyTest(PublicCase):
    def test_feed_and_sitemap_exclude_pending_and_taken_down(self):
        user = self.user('alice', level=2)
        live = self.make(user, title='留下的')
        self.publish_ok(user, live['id'], slug='stay')
        screen.register_screener(lambda *args: {'result': 'review', 'reasons': ['x']})
        waiting = self.make(user, title='待审的')
        self.publish_ok(user, waiting['id'], slug='wait')
        del screen.SCREENERS[:]
        client = self.client()
        root = ET.fromstring(client.get('/api/public/feed.xml').content)
        ns = {'a': 'http://www.w3.org/2005/Atom'}
        self.assertEqual([e.findtext('a:title', namespaces=ns) for e in root.findall('a:entry', ns)], ['留下的'])
        self.assertIn('stay', client.get('/api/public/sitemap-1.xml').text)
        self.assertNotIn('wait', client.get('/api/public/sitemap-1.xml').text)


if __name__ == '__main__':
    unittest.main()
