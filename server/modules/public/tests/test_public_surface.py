"""公开层的站点级表面：开关、robots、sitemap、feed、llms、数据集、限流、机器发现。"""
import json
import unittest
import xml.etree.ElementTree as ET

from tests.helpers import HDRS

from .support import PublicCase


class SurfaceTest(PublicCase):
    def test_flag_off_all_routes_404(self):
        self.disable()
        client = self.client()
        paths = ['/api/public/robots.txt', '/api/public/sitemap.xml', '/api/public/sitemap-1.xml',
                 '/api/public/llms.txt', '/api/public/llms-full.txt', '/api/public/llms-full-1.txt',
                 '/api/public/feed.xml', '/api/public/feed.json', '/api/public/openapi.json',
                 '/api/public/well-known/agent.json', '/api/public/well-known/mcp.json',
                 '/api/public/mcp/tools.json', '/api/public/mcp/tools/get_tool_heat',
                 '/api/public/mcp/resources.json', '/api/public/mcp/resources/read?uri=commons://public/qa/x',
                 '/api/public/p/knowledge/hello', '/api/public/p/knowledge/hello.md',
                 '/api/public/p/knowledge/hello.json',
                 '/api/public/datasets/tool-heat.csv', '/api/public/datasets/tool-heat.json',
                 '/api/public/datasets/',
                 '/api/public/admin/config']
        for path in paths:
            response = client.get(path)
            self.assertEqual(response.status_code, 404, path)
            self.assertEqual(response.json()['error']['code'], 'resource_not_found', path)
        for path in ('/api/public/publish', '/api/public/unpublish'):
            response = client.post(path, headers=HDRS, json={})
            self.assertEqual(response.status_code, 404, path)
        rpc = client.post('/api/public/mcp', headers=HDRS, json={
            'jsonrpc': '2.0', 'id': 1, 'method': 'resources/list', 'params': {},
        })
        self.assertEqual(rpc.status_code, 404)

    def test_robots_welcomes_named_agents_and_disallows_private(self):
        user = self.user('alice', level=2)
        self.publish_ok(user, self.make(user)['id'])
        text = self.client().get('/api/public/robots.txt').text
        for token in ('GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
                      'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot',
                      'Bytespider', 'Amazonbot', 'meta-externalagent', 'DuckAssistBot'):
            self.assertIn(f'User-agent: {token}', text)
        self.assertIn('User-agent: *', text)
        self.assertIn('Allow: /p/', text)
        self.assertIn('Allow: /api/public/', text)
        self.assertIn('Disallow: /api/', text)
        self.assertIn('Disallow: /u/', text)
        self.assertIn('Disallow: /m/', text)
        self.assertIn('Disallow: /admin/', text)
        self.assertIn('Disallow: /login', text)
        self.assertIn('Sitemap: https://commons.test/sitemap.xml', text)
        self.assertNotIn('\nDisallow: /p/', text)
        # 长短匹配：/api/public/ 的 Allow 比 /api/ 的 Disallow 更长，公开接口不会被误伤
        star = [line.strip() for line in text.split('User-agent: *', 1)[1].split('\n')]
        self.assertLess(star.index('Allow: /api/public/'), star.index('Disallow: /api/'))
        self.assertLess(star.index('Disallow: /api/public/admin/'), star.index('Allow: /api/public/'))

    def test_sitemap_only_live_and_feed_and_llms_follow(self):
        user = self.user('alice', level=2)
        first = self.make(user, title='甲知识')
        second = self.make(user, title='乙知识')
        self.publish_ok(user, first['id'], slug='alpha')
        self.publish_ok(user, second['id'], slug='beta')
        client = self.client()
        index = client.get('/api/public/sitemap.xml')
        self.assertEqual(index.status_code, 200)
        self.assertIn('sitemap-knowledge-1.xml', index.text)
        shard = client.get('/api/public/sitemap-knowledge-1.xml')
        self.assertEqual(shard.status_code, 200)
        self.assertIn('<loc>https://commons.test/p/knowledge/alpha</loc>', shard.text)
        self.assertIn('<loc>https://commons.test/p/knowledge/beta</loc>', shard.text)
        self.assertRegex(shard.text, r'<lastmod>\d{4}-\d{2}-\d{2}T')

        atom = client.get('/api/public/feed.xml')
        self.assertEqual(atom.status_code, 200)
        root = ET.fromstring(atom.content)
        ns = {'a': 'http://www.w3.org/2005/Atom'}
        titles = [e.findtext('a:title', namespaces=ns) for e in root.findall('a:entry', ns)]
        self.assertEqual(sorted(titles), ['乙知识', '甲知识'])
        feed = client.get('/api/public/feed.json').json()
        self.assertEqual(feed['version'], 'https://jsonfeed.org/version/1.1')
        self.assertEqual(len(feed['items']), 2)

        llms = client.get('/api/public/llms.txt').text
        self.assertIn('https://commons.test/p/knowledge/alpha', llms)
        self.assertIn('甲知识', llms)
        self.assertIn('/sitemap.xml', llms)
        full = client.get('/api/public/llms-full.txt').text
        self.assertIn('# 甲知识', full)
        self.assertIn('正文内容', full)

        # 撤回当天即从三处消失
        response = user.post(f'/api/objects/{first["id"]}/withdraw', headers=HDRS, json={})
        self.assertEqual(response.status_code, 200, response.text)
        shard = client.get('/api/public/sitemap-knowledge-1.xml').text
        self.assertNotIn('alpha', shard)
        self.assertIn('beta', shard)
        self.assertNotIn('alpha', client.get('/api/public/llms.txt').text)
        self.assertNotIn('甲知识', client.get('/api/public/feed.xml').text)
        self.assertNotIn('甲知识', client.get('/api/public/feed.json').text)

    def test_llms_full_splits_by_size(self):
        user = self.user('alice', level=2)
        self.set_config('llms.max_bytes', 1024)
        for index in range(3):
            body = ('第%d篇正文。' % index) * 160
            item = self.make(user, title=f'长篇 {index}', content={'body': body, 'summary': ''})
            self.publish_ok(user, item['id'], slug=f'long-{index}')
        client = self.client()
        index_text = client.get('/api/public/llms-full.txt').text
        self.assertIn('llms-full-1.txt', index_text)
        self.assertIn('分成 3 卷', index_text)
        part1 = client.get('/api/public/llms-full-1.txt')
        part2 = client.get('/api/public/llms-full-2.txt')
        part3 = client.get('/api/public/llms-full-3.txt')
        self.assertEqual(part1.status_code, 200)
        self.assertEqual(part2.status_code, 200)
        self.assertEqual(part3.status_code, 200)
        self.assertIn('第 1/3 部分', part1.text)
        self.assertIn('第 3/3 部分', part3.text)
        self.assertEqual(client.get('/api/public/llms-full-4.txt').status_code, 404)

    def test_etag_304_and_markdown_representation(self):
        user = self.user('alice', level=2)
        self.publish_ok(user, self.make(user)['id'])
        client = self.client()
        page = client.get('/api/public/p/knowledge/hello')
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.headers['content-type'], 'text/html; charset=utf-8')
        self.assertEqual(page.headers['access-control-allow-origin'], '*')
        self.assertIn('canonical', page.text)
        etag = page.headers['etag']
        self.assertTrue(etag)
        fresh = client.get('/api/public/p/knowledge/hello', headers={'If-None-Match': etag})
        self.assertEqual(fresh.status_code, 304)
        self.assertEqual(fresh.content, b'')

        head = client.head('/api/public/p/knowledge/hello')
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head.content, b'')
        self.assertEqual(head.headers['etag'], etag)

        md = client.get('/api/public/p/knowledge/hello.md')
        self.assertEqual(md.headers['content-type'], 'text/markdown; charset=utf-8')
        negotiated = client.get('/api/public/p/knowledge/hello', headers={'Accept': 'text/markdown'})
        self.assertEqual(negotiated.headers['content-type'], 'text/markdown; charset=utf-8')
        self.assertEqual(md.content, negotiated.content)
        self.assertIn('# 公开知识', md.text)
        self.assertEqual(md.headers['vary'], 'Accept')

    def test_rate_limit_429_and_crawler_counting(self):
        self.set_config('rate.page_per_min', 2)
        self.set_config('rate.ua_per_min', 100000)
        client = self.client()
        self.assertEqual(client.get('/api/public/robots.txt').status_code, 200)
        self.assertEqual(client.get('/api/public/robots.txt').status_code, 200)
        limited = client.get('/api/public/robots.txt')
        self.assertEqual(limited.status_code, 429)
        self.assertIn('retry-after', {k.lower() for k in limited.headers})
        self.assertEqual(limited.json()['error']['code'], 'rate_limited')
        self.assertIn('retry_after_seconds', limited.json()['error'])

        with self.db.read() as conn:
            keys = [row[0] for row in conn.execute('SELECT key FROM rate_bucket')]
        self.assertTrue(keys)
        self.assertFalse(any('testclient' in key for key in keys), keys)

    def test_crawler_hits_counted_without_ip(self):
        bot = 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)'
        self.client().get('/api/public/robots.txt', headers={'User-Agent': bot})
        with self.db.read() as conn:
            row = conn.execute("SELECT count FROM public_crawler_hit WHERE crawler_key = 'gptbot'").fetchone()
            columns = [r[1] for r in conn.execute('PRAGMA table_info(public_crawler_hit)')]
        self.assertEqual(row[0], 1)
        self.assertEqual(columns, ['crawler_key', 'day', 'count'])

    def test_openapi_agent_card_and_mcp_tools(self):
        user = self.user('alice', level=2)
        self.publish_ok(user, self.make(user, title='向量检索实践')['id'], slug='vectors')
        client = self.client()
        spec = client.get('/api/public/openapi.json').json()
        self.assertEqual(spec['openapi'], '3.1.0')
        self.assertIn('/api/public/p/{kind}/{slug}', spec['paths'])
        self.assertIn('/api/public/p/{kind}/{slug}.json', spec['paths'])
        self.assertIn('/api/public/feed/{kind}.json', spec['paths'])
        self.assertIn('/api/public/mcp/resources/read', spec['paths'])
        self.assertIn('/api/public/datasets/{name}/{version}/manifest.json', spec['paths'])
        self.assertEqual(spec['servers'][0]['url'], 'https://commons.test')

        self.assertEqual(client.get('/api/public/.well-known/agent.json').json()['name'],
                         client.get('/api/public/well-known/agent.json').json()['name'])
        card = client.get('/api/public/well-known/agent.json').json()
        self.assertTrue(card['x-read-only'])
        self.assertEqual({skill['id'] for skill in card['skills']},
                         {'search_public_knowledge', 'get_tool_heat', 'get_hot_digest'})
        manifest = client.get('/api/public/mcp/tools.json').json()
        self.assertEqual(len(manifest['tools']), 3)
        for tool in manifest['tools']:
            self.assertIn('inputSchema', tool)
            self.assertTrue(tool['annotations']['readOnlyHint'])
        self.assertTrue(client.get('/api/public/well-known/mcp.json').json()['readOnly'])

        found = client.get('/api/public/mcp/tools/search_public_knowledge', params={'query': '向量'}).json()
        self.assertEqual(found['count'], 1)
        self.assertEqual(found['results'][0]['url'], 'https://commons.test/p/knowledge/vectors')
        self.assertEqual(client.get('/api/public/mcp/tools/search_public_knowledge').status_code, 422)
        self.assertEqual(client.get('/api/public/mcp/tools/nope').status_code, 404)
        digest = client.get('/api/public/mcp/tools/get_hot_digest').json()
        self.assertFalse(digest['available'])


class SearchTest(PublicCase):
    def test_like_wildcards_are_escaped(self):
        user = self.user('alice', level=2)
        item = self.make(user, title='100% 提示词 与 a_b', content={'body': '百分比和通配符', 'summary': ''})
        self.publish_ok(user, item['id'], slug='pct')
        client = self.client()
        for query, expected in (('100%', 1), ('a_b', 1), ('%', 1), ('_', 1), ('找不到', 0)):
            payload = client.get('/api/public/mcp/tools/search_public_knowledge', params={'query': query}).json()
            self.assertEqual(payload['count'], expected, query)


class DatasetTest(PublicCase):
    COLUMNS = [
        {'name': 'week', 'type': 'string', 'description': '自然周'},
        {'name': 'tool', 'type': 'string', 'description': '工具'},
        {'name': 'mentions', 'type': 'number', 'description': '提及数'},
        {'name': 'share', 'type': 'number', 'description': '份额'},
        {'name': 'rank', 'type': 'number', 'description': '排名'},
    ]

    def post_dataset(self, client, **over):
        body = {
            'name': 'tool-heat',
            'version': '2026-W43',
            'title': '工具热度周榜',
            'description': '已过抑制规则的匿名聚合格子',
            'columns': self.COLUMNS,
            'rows': [
                {'week': '2026-W43', 'tool': 'cursor', 'mentions': 120, 'share': 0.12, 'rank': 1},
                {'week': '2026-W43', 'tool': 'aider', 'mentions': None, 'share': None, 'rank': None},
            ],
            'license': 'cc-by-4.0',
            'reviewed': True,
        }
        body.update(over)
        return client.post('/api/public/admin/datasets', headers=HDRS, json=body)

    def admin(self):
        return self.user('admin', level=2, roles=('admin',), totp=True)

    def test_reviewed_only_and_suppressed_cells_are_empty_not_zero(self):
        admin = self.admin()
        created = self.post_dataset(admin)
        self.assertEqual(created.status_code, 201, created.text)
        client = self.client()
        data = client.get('/api/public/datasets/tool-heat.json').json()
        self.assertEqual(data['row_count'], 2)
        aider = [r for r in data['rows'] if r['tool'] == 'aider'][0]
        self.assertIsNone(aider['mentions'])
        self.assertIsNone(aider['share'])
        self.assertIsNone(aider['rank'])
        self.assertEqual(data['suppressed']['cells'], 3)
        self.assertEqual(data['license']['label'], 'CC BY 4.0')
        self.assertIn('etag', {k.lower() for k in client.get('/api/public/datasets/tool-heat.json').headers})

        directory = client.get('/api/public/datasets/').json()
        self.assertEqual(directory['datasets'][0]['version'], '2026-W43')
        manifest = client.get('/api/public/datasets/tool-heat/2026-W43/manifest.json')
        self.assertEqual(manifest.status_code, 200)
        self.assertEqual(manifest.json()['row_count'], 2)
        self.assertEqual(manifest.json()['fields'], self.COLUMNS)
        self.assertEqual(len(manifest.json()['sha256']), 64)
        self.assertEqual(client.get('/api/public/datasets/tool-heat/2026-W43/data.json').json()['rows'],
                         data['rows'])

        text = client.get('/api/public/datasets/tool-heat.csv').text
        rows = [line.split(',') for line in text.strip().split('\n')]
        self.assertEqual(rows[0][:3], ['week', 'tool', 'mentions'])
        aider_row = [r for r in rows if len(r) > 1 and r[1] == 'aider'][0]
        self.assertEqual(aider_row, ['2026-W43', 'aider', '', '', ''])

        # 未审核版本不对外
        pending = self.post_dataset(admin, version='2026-W44', reviewed=False)
        self.assertEqual(pending.status_code, 201)
        self.assertEqual(client.get('/api/public/datasets/tool-heat.json', params={'version': '2026-W44'}).status_code,
                         404)
        self.assertEqual(client.get('/api/public/datasets/tool-heat.json', params={'version': '2026-W43'}).status_code,
                         200)
        # 重复版本
        self.assertEqual(self.post_dataset(admin).status_code, 409)

    def test_dataset_rejects_contacts_and_bad_shapes(self):
        admin = self.admin()
        bad = self.post_dataset(admin, rows=[
            {'week': '2026-W43', 'tool': '我的微信 wxid_abc123', 'mentions': 1, 'share': 0.1, 'rank': 1}])
        self.assertEqual(bad.status_code, 422, bad.text)
        extra = self.post_dataset(admin, rows=[{'week': '2026-W43', 'nope': 1}])
        self.assertEqual(extra.status_code, 422)
        identity = self.post_dataset(admin, columns=[
            {'name': 'member_id', 'type': 'string', 'description': '成员'},
        ], rows=[{'member_id': 'anonymous-1'}])
        self.assertEqual(identity.status_code, 422)

    def test_tool_heat_tool_reads_reviewed_dataset(self):
        admin = self.admin()
        self.assertEqual(self.post_dataset(admin).status_code, 201)
        client = self.client()
        payload = client.get('/api/public/mcp/tools/get_tool_heat', params={'week': '2026-W43'}).json()
        self.assertTrue(payload['available'])
        self.assertEqual(len(payload['rows']), 2)
        one = client.get('/api/public/mcp/tools/get_tool_heat', params={'tool': 'cursor'}).json()
        self.assertEqual(len(one['rows']), 1)
        self.assertEqual(one['rows'][0]['tool'], 'cursor')
        self.assertIsNone(payload['rows'][1]['mentions'])


class CrawlerPolicyTest(PublicCase):
    def test_admin_can_turn_a_bot_off_and_change_is_audited(self):
        admin = self.user('admin', level=2, roles=('admin',), totp=True)
        before = admin.get('/api/public/admin/crawlers').json()['data']
        self.assertIn('gptbot', [row['crawler_key'] for row in before])
        response = admin.patch('/api/public/admin/crawlers/gptbot', headers=HDRS, json={'welcome': False})
        self.assertEqual(response.status_code, 200, response.text)
        text = self.client().get('/api/public/robots.txt').text
        section = text.split('User-agent: GPTBot', 1)[1].split('User-agent:', 1)[0]
        self.assertIn('Disallow: /', section)
        self.assertNotIn('Allow: /p/', section)
        with self.db.read() as conn:
            actions = [row[0] for row in conn.execute('SELECT action FROM audit_event')]
            meta = conn.execute("SELECT meta_json FROM audit_event WHERE action = 'public.crawler'").fetchone()[0]
        self.assertIn('public.crawler', actions)
        self.assertFalse(json.loads(meta)['welcome'])

    def test_config_change_license_and_content_signal(self):
        admin = self.user('admin', level=2, roles=('admin',), totp=True)
        self.assertEqual(admin.patch('/api/public/admin/config', headers=HDRS,
                                     json={'key': 'license.default', 'value': 'cc-by-4.0'}).status_code, 200)
        self.assertEqual(admin.patch('/api/public/admin/config', headers=HDRS,
                                     json={'key': 'crawlers.content_signal',
                                           'value': 'search=yes, ai-train=no'}).status_code, 200)
        self.assertEqual(admin.patch('/api/public/admin/config', headers=HDRS,
                                     json={'key': 'license.default', 'value': 'nope'}).status_code, 422)
        text = self.client().get('/api/public/robots.txt').text
        self.assertIn('Content-Signal: search=yes, ai-train=no', text)
        user = self.user('bob', level=2)
        self.publish_ok(user, self.make(user)['id'])
        page = self.client().get('/api/public/p/knowledge/hello').text
        self.assertIn('CC BY 4.0', page)


if __name__ == '__main__':
    unittest.main()
