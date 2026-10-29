import json
import uuid
from unittest import mock

from app import clock
from modules.tools import hooks, service
from tests.helpers import HDRS, AppCase


def headers():
    return {**HDRS, 'Idempotency-Key': uuid.uuid4().hex}


class ToolsCase(AppCase):
    def proposal(self, slug='codex'):
        return {
            'slug': slug, 'name': slug.title(), 'vendor': '示例厂商', 'category': '编程 Agent',
            'official_url': f'https://example.com/{slug}', 'price_tier': '订阅',
            'tags': ['代码', 'Agent'], 'summary': '用于专项测试的工具条目。',
        }

    def approved(self, slug='codex', submitter=None):
        submitter = submitter or self.user('submit_' + slug.replace('-', '_'))
        r = submitter.post('/api/tools/submissions', headers=headers(), json=self.proposal(slug))
        self.assertEqual(r.status_code, 201, r.text)
        admin = self.user('admin_' + slug.replace('-', '_'), level=3, roles=('admin',), totp=True)
        r = admin.post(f'/api/admin/tools/submissions/{slug}/approve', headers=headers())
        self.assertEqual(r.status_code, 200, r.text)
        return submitter

    def mature_use(self, client, slug, days=4):
        r = client.post(f'/api/tools/{slug}/use', headers=headers(), json={'purpose': '日常编程'})
        self.assertEqual(r.status_code, 200, r.text)
        with self.db.write() as conn:
            conn.execute('UPDATE tool_use SET started_at = ? WHERE principal_id = ? AND tool_id = '
                         '(SELECT id FROM tool WHERE slug = ?)',
                         (clock.iso(clock.now_ts() - days * 86400), client.pid, slug))


class ToolRulesTest(ToolsCase):
    def test_pending_is_not_listed_and_admin_approval_publishes(self):
        member = self.user('member')
        r = member.post('/api/tools/submissions', headers=headers(), json=self.proposal('pending-tool'))
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()['data']['status'], 'pending_review')
        self.assertEqual(self.client().get('/api/tools').json()['data'], [])
        self.assertEqual(self.client().get('/api/tools/pending-tool').status_code, 404)
        self.assertEqual(member.get('/api/admin/tools/submissions').status_code, 403)
        admin = self.user('moderator', level=3, roles=('admin',), totp=True)
        queue = admin.get('/api/admin/tools/submissions').json()['data']
        self.assertEqual([row['slug'] for row in queue], ['pending-tool'])
        self.assertEqual(admin.post('/api/admin/tools/submissions/pending-tool/approve',
                                    headers=headers()).status_code, 200)
        self.assertEqual([row['slug'] for row in self.client().get('/api/tools').json()['data']], ['pending-tool'])

    def test_review_requires_three_days(self):
        self.approved('wait-rule')
        reviewer = self.user('reviewer')
        reviewer.post('/api/tools/wait-rule/use', headers=headers(), json={})
        r = reviewer.post('/api/tools/wait-rule/review', headers=headers(),
                          json={'rating': 5, 'body': '短评'})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertEqual(r.json()['error']['code'], 'tools_review_too_soon')
        with self.db.write() as conn:
            conn.execute('UPDATE tool_use SET started_at = ? WHERE principal_id = ?',
                         (clock.iso(clock.now_ts() - 3 * 86400 - 1), reviewer.pid))
        self.assertEqual(reviewer.post('/api/tools/wait-rule/review', headers=headers(),
                                       json={'rating': 5, 'body': '连续用了三天。'}).status_code, 201)

    def test_one_review_per_member_updates_and_keeps_history(self):
        self.approved('one-review')
        member = self.user('one_review_member')
        self.mature_use(member, 'one-review')
        first = member.post('/api/tools/one-review/review', headers=headers(),
                            json={'rating': 3, 'body': '第一版短评'})
        second = member.post('/api/tools/one-review/review', headers=headers(),
                             json={'rating': 5, 'body': '更新后的短评'})
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        conn = self.db.conn()
        self.assertEqual(conn.execute('SELECT count(*) FROM tool_review').fetchone()[0], 1)
        history = conn.execute('SELECT rating, body FROM tool_review_history').fetchone()
        self.assertEqual((history['rating'], history['body']), (3, '第一版短评'))
        detail = member.get('/api/tools/one-review').json()['data']
        self.assertEqual((detail['reviews'][0]['rating'], detail['reviews'][0]['body']), (5, '更新后的短评'))

    def test_fewer_than_five_hides_score_then_schema_adds_aggregate_rating(self):
        self.approved('rating-gate')
        scores = [5, 4, 2, 5, 3]
        for index, score in enumerate(scores):
            member = self.user(f'rater_{index}')
            self.mature_use(member, 'rating-gate')
            r = member.post('/api/tools/rating-gate/review', headers=headers(),
                            json={'rating': score, 'body': f'第 {index + 1} 条短评'})
            self.assertIn(r.status_code, (200, 201), r.text)
            detail = member.get('/api/tools/rating-gate').json()['data']
            if index < 4:
                self.assertIsNone(detail['rating']['median'])
                self.assertEqual(detail['rating']['label'], '评价不足')
                self.assertNotIn('aggregateRating', detail['schema'])
        self.assertEqual(detail['rating']['median'], 4.0)
        self.assertEqual(detail['schema']['aggregateRating']['ratingCount'], 5)
        ranked = self.client().get('/api/tools', params={'sort': 'rating'}).json()['data']
        self.assertEqual([row['slug'] for row in ranked], ['rating-gate'])

    def test_account_purge_deletes_usage_and_anonymises_review(self):
        self.approved('purge-tool')
        author = self.user('purge_author')
        other = self.user('purge_other')
        self.mature_use(author, 'purge-tool')
        review = author.post('/api/tools/purge-tool/review', headers=headers(),
                             json={'rating': 4, 'body': '会保留但要匿名'}).json()['data']['review']
        other.post(f"/api/tools/reviews/{review['id']}/helpful", headers=headers())
        with self.db.write() as conn:
            hooks.purge(conn, author.pid)
        conn = self.db.conn()
        self.assertEqual(conn.execute('SELECT count(*) FROM tool_use WHERE principal_id = ?',
                                      (author.pid,)).fetchone()[0], 0)
        row = conn.execute('SELECT author_id, author_name FROM tool_review WHERE id = ?', (review['id'],)).fetchone()
        self.assertEqual((row['author_id'], row['author_name']), (None, '已注销成员'))
        self.assertEqual(self.client().get('/api/tools/purge-tool').json()['data']['reviews'][0]['author']['display_name'],
                         '已注销成员')

    def test_safe_url_compare_and_content_negotiation(self):
        member = self.user('safe_url_member')
        bad = self.proposal('unsafe-url')
        bad['official_url'] = 'javascript:alert(1)'
        self.assertEqual(member.post('/api/tools/submissions', headers=headers(), json=bad).status_code, 422)
        self.approved('first-tool')
        self.approved('second-tool')
        comparison = self.client().get('/api/tools/compare', params={'a': 'first-tool', 'b': 'second-tool'})
        self.assertEqual(len(comparison.json()['data']), 2)
        self.assertEqual(self.client().get('/api/tools/first-tool').headers['vary'], 'Accept')
        md = self.client().get('/api/tools/first-tool', headers={'Accept': 'text/markdown'})
        self.assertEqual(md.status_code, 200, md.text)
        self.assertIn('# First-Tool', md.text)
        page = self.client().get('/api/tools/first-tool', headers={'Accept': 'text/html'})
        self.assertIn('application/ld+json', page.text)
        schema_text = page.text.split('application/ld+json">', 1)[1].split('</script>', 1)[0]
        self.assertEqual(json.loads(schema_text)['@type'], 'SoftwareApplication')


if __name__ == '__main__':
    import unittest
    unittest.main()
