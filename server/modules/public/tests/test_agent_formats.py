"""AGENT-FMT-1 acceptance: representations, typed discovery, datasets and MCP resources."""
import json
import re
import unittest

from modules.public import screen
from tests.helpers import HDRS

from .support import PublicCase


class RepresentationTest(PublicCase):
    def test_html_json_markdown_share_key_fields_and_cache_validators(self):
        user = self.user('alice', level=2)
        item = self.make(user, title='稳定表示', content={
            'summary': '同一份摘要', 'body': '同一份正文', 'tags': ['Agent'],
        })
        self.publish_ok(user, item['id'], slug='stable')
        client = self.client()
        html = client.get('/api/public/p/knowledge/stable')
        markdown = client.get('/api/public/p/knowledge/stable.md')
        json_suffix = client.get('/api/public/p/knowledge/stable.json')
        json_accept = client.get('/api/public/p/knowledge/stable', headers={'Accept': 'application/json'})

        self.assertEqual(html.status_code, 200)
        self.assertIn('<h1>稳定表示</h1>', html.text)
        self.assertIn('type="application/json"', html.text)
        self.assertIn('# 稳定表示', markdown.text)
        self.assertEqual(json_suffix.json(), json_accept.json())
        payload = json_suffix.json()
        self.assertEqual(payload['schema_version'], '1.0')
        self.assertEqual(payload['title'], '稳定表示')
        self.assertEqual(payload['summary'], '同一份摘要')
        self.assertEqual(payload['content']['markdown'], markdown.text)
        self.assertEqual(payload['attribution']['required_text'], '来源：先锋')
        self.assertEqual(payload['canonical_url'], 'https://commons.test/p/knowledge/stable')

        last_modified = html.headers['last-modified']
        cached = client.get('/api/public/p/knowledge/stable', headers={'If-Modified-Since': last_modified})
        self.assertEqual(cached.status_code, 304)
        self.assertEqual(cached.content, b'')

        agent = client.get('/api/public/p/knowledge/stable', headers={
            'User-Agent': 'Mozilla/5.0 GPTBot/1.0', 'Accept': '*/*',
        })
        self.assertEqual(agent.headers['content-type'], 'text/markdown; charset=utf-8')
        self.assertEqual(agent.content, markdown.content)

    def test_unpublished_object_is_404_in_every_representation(self):
        user = self.user('alice', level=2)
        screen.register_screener(lambda *args: {'result': 'review', 'reasons': ['human_review']})
        item = self.make(user)
        self.publish_ok(user, item['id'], slug='waiting')
        client = self.client()
        requests = [
            client.get('/api/public/p/knowledge/waiting'),
            client.get('/api/public/p/knowledge/waiting.md'),
            client.get('/api/public/p/knowledge/waiting.json'),
            client.get('/api/public/p/knowledge/waiting', headers={'Accept': 'application/json'}),
        ]
        self.assertEqual([response.status_code for response in requests], [404, 404, 404, 404])


class TypedDiscoveryTest(PublicCase):
    def setUp(self):
        super().setUp()
        self.add_rich_types()

    def test_typed_feeds_sitemaps_and_llms_directory(self):
        user = self.user('alice', level=2)
        skill = self.make(user, type_='skill', title='验收 Skill', content={
            'purpose': '验收改动', 'skill_md': '# 步骤',
            'steps': ['跑测试'], 'examples': [{'input': '改动', 'output': '证据'}],
        })
        prompt = self.make(user, type_='prompt', title='评审提示词', content={
            'use_when': '需要评审', 'template': '检查 {target}',
            'examples': [{'input': '代码', 'output': '问题清单'}],
        })
        self.publish_ok(user, skill['id'], kind='skill', slug='verify-skill')
        self.publish_ok(user, prompt['id'], kind='prompt', slug='review-prompt')
        client = self.client()

        sitemap = client.get('/api/public/sitemap.xml').text
        self.assertIn('/sitemap-skill-1.xml', sitemap)
        self.assertIn('/sitemap-prompt-1.xml', sitemap)
        self.assertIn('/p/skill/verify-skill', client.get('/api/public/sitemap-skill-1.xml').text)

        skill_feed = client.get('/api/public/feed/skill.json').json()
        prompt_feed = client.get('/api/public/feed/prompt.json').json()
        self.assertEqual([item['title'] for item in skill_feed['items']], ['验收 Skill'])
        self.assertEqual([item['title'] for item in prompt_feed['items']], ['评审提示词'])
        llms = client.get('/api/public/llms.txt').text
        for heading in ('## 问答', '## Skill', '## 提示词', '## 话题数据', '## 讲堂'):
            self.assertIn(heading, llms)
        self.assertIn('更新：', llms)
        self.assertIn('来源：先锋', llms)

    def test_jsonld_contract_for_agent_content_types(self):
        user = self.user('alice', level=2)
        cases = [
            ('skill', 'skill', {'steps': ['执行'], 'purpose': '目的'}, 'HowTo', 'step'),
            ('prompt', 'prompt', {'template': '审查 {x}', 'use_when': '评审'}, 'CreativeWork', None),
            ('talk', 'talk', {'transcript': '逐字稿', 'video_url': 'https://example.com/v.mp4'},
             'VideoObject', 'transcript'),
            ('event', 'event', {'body': '活动', 'start_date': '2026-11-01T10:00:00Z'}, 'Event', 'startDate'),
            ('discussion', 'discussion', {'body': '讨论正文'}, 'DiscussionForumPosting', None),
        ]
        client = self.client()
        for type_, kind, content, expected, required in cases:
            item = self.make(user, type_=type_, title=f'{kind} 标题', content=content)
            self.publish_ok(user, item['id'], kind=kind, slug=f'{kind}-case')
            page = client.get(f'/api/public/p/{kind}/{kind}-case').text
            raw = re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S).group(1)
            data = json.loads(raw)
            self.assertEqual(data['@type'], expected)
            for field in ('name', 'url', 'datePublished', 'author', 'publisher', 'citation'):
                self.assertIn(field, data)
            if required:
                self.assertIn(required, data)


class McpResourceTest(PublicCase):
    def setUp(self):
        super().setUp()
        self.add_rich_types()

    def test_resources_list_and_read_are_public_and_fail_closed(self):
        user = self.user('alice', level=2)
        qa = self.make(user, type_='faq', title='已解决问题', content={
            'question': '怎么验收？', 'accepted_answer': '跑测试并保留证据',
        })
        self.publish_ok(user, qa['id'], kind='qa', slug='verify-answer')
        private = self.make(user, title='未发布内容')
        client = self.client()

        listed = client.get('/api/public/mcp/resources.json').json()
        self.assertEqual(len(listed['resources']), 1)
        uri = listed['resources'][0]['uri']
        self.assertEqual(uri, 'commons://public/qa/verify-answer')
        read = client.get('/api/public/mcp/resources/read', params={'uri': uri}).json()
        self.assertIn('跑测试并保留证据', read['contents'][0]['text'])
        self.assertEqual(read['contents'][0]['_meta']['canonical_url'],
                         'https://commons.test/p/qa/verify-answer')

        rpc = client.post('/api/public/mcp', headers=HDRS, json={
            'jsonrpc': '2.0', 'id': 1, 'method': 'resources/list', 'params': {},
        })
        self.assertEqual(rpc.status_code, 200, rpc.text)
        self.assertEqual(rpc.json()['result']['resources'][0]['uri'], uri)
        missing = client.post('/api/public/mcp', headers=HDRS, json={
            'jsonrpc': '2.0', 'id': 2, 'method': 'resources/read',
            'params': {'uri': 'commons://public/qa/not-public'},
        }).json()
        self.assertEqual(missing['error']['code'], -32002)
        self.assertEqual(client.get('/api/public/p/knowledge/not-public.json').status_code, 404)
        self.assertIsNotNone(private['id'])


if __name__ == '__main__':
    unittest.main()
