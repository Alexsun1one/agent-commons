import unittest

from app import fts
from tests.helpers import AppCase


class SegmentTest(unittest.TestCase):
    def test_bigrams(self):
        self.assertEqual(fts.segment('大模型').split(), ['大模', '模型'])
        self.assertEqual(fts.segment('用GPT写代码').split(), ['用', 'GPT', '写代', '代码'])

    def test_match_expression_escapes_syntax(self):
        self.assertEqual(fts.match_expression('模型'), '"模型"*')
        self.assertEqual(fts.match_expression('智能体'), '"智能 能体"')
        self.assertEqual(fts.match_expression('" AND OR NOT * ( ) : ^ NEAR'), '"AND"* "OR"* "NOT"* "NEAR"*')
        self.assertEqual(fts.match_expression('***'), '')


class SearchTest(AppCase):
    def setUp(self):
        super().setUp()
        self.writer = self.user('writer', level=2)
        self.reader = self.user('reader')
        self.obj(self.writer, title='大模型的智能体框架', content={'body': '这篇讲 agents 和提示词工程。'})
        self.obj(self.writer, title='向量检索', content={'body': '检索增强生成，适合知识库。'})
        self.obj(self.writer, title='智能手表评测', content={'body': '与模型无关的硬件。'})

    def titles(self, q, client=None):
        r = (client or self.reader).get('/api/search', params={'q': q})
        self.assertEqual(r.status_code, 200, r.text)
        return sorted(item['title'] for item in r.json()['data'])

    def test_chinese_two_char_words(self):
        self.assertEqual(self.titles('模型'), ['大模型的智能体框架', '智能手表评测'])
        self.assertEqual(self.titles('智能'), ['大模型的智能体框架', '智能手表评测'])
        self.assertEqual(self.titles('智能体'), ['大模型的智能体框架'])
        self.assertEqual(self.titles('检索 知识'), ['向量检索'])
        self.assertEqual(self.titles('提示词'), ['大模型的智能体框架'])
        self.assertEqual(self.titles('体智'), [])

    def test_latin_prefix_and_case(self):
        self.assertEqual(self.titles('AGENT'), ['大模型的智能体框架'])

    def test_fts_syntax_is_inert(self):
        for q in ('"', '模型"', 'AND', 'OR NOT', '*', 'title:模型', 'NEAR(模型 智能)', '(', '模型 -智能', "'; DROP"):
            r = self.reader.get('/api/search', params={'q': q})
            self.assertEqual(r.status_code, 200, (q, r.text))
        self.assertEqual(self.titles('NEAR(模型 智能)'), [])

    def test_query_too_long(self):
        r = self.reader.get('/api/search', params={'q': '模' * 101})
        self.assertEqual(self.code(r), 'validation_failed')

    def test_snippet_comes_from_text(self):
        r = self.reader.get('/api/search', params={'q': '知识库'})
        self.assertIn('知识库', r.json()['data'][0]['snippet'])

    def test_pagination_cursor(self):
        # This is a search pagination fixture, not a flood-governance scenario.
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 0 WHERE key = 'gov.screening'")
        for i in range(23):
            self.obj(self.writer, title=f'分页 条目 {i}')
        seen, cursor = [], None
        while True:
            params = {'q': '分页', 'limit': 10}
            if cursor:
                params['cursor'] = cursor
            body = self.reader.get('/api/search', params=params).json()
            seen += [item['id'] for item in body['data']]
            cursor = body['meta']['next_cursor']
            if not cursor:
                break
        self.assertEqual((len(seen), len(set(seen))), (23, 23))
        first = self.reader.get('/api/search', params={'q': '分页', 'limit': 5}).json()['meta']['next_cursor']
        r = self.writer.get('/api/search', params={'q': '分页', 'limit': 5, 'cursor': first})
        self.assertEqual((r.status_code, self.code(r)), (409, 'cursor_stale'))
        r = self.reader.get('/api/search', params={'q': '条目', 'limit': 5, 'cursor': first})
        self.assertEqual(self.code(r), 'cursor_stale')
        r = self.reader.get('/api/search', params={'q': '分页', 'cursor': first[:-3] + 'AAA'})
        self.assertEqual((r.status_code, self.code(r)), (400, 'malformed_request'))
        r = self.reader.get('/api/objects', params={'limit': 51})
        self.assertEqual(self.code(r), 'validation_failed')

    def test_edit_reindexes_in_same_transaction(self):
        item = self.obj(self.writer, title='旧标题 甲乙')
        r = self.writer.patch(f"/api/objects/{item['id']}", headers={'Origin': 'https://commons.test',
                              'X-Commons-CSRF': '1', 'If-Match': item['etag']}, json={'title': '新标题 丙丁'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.titles('甲乙'), [])
        self.assertEqual(self.titles('丙丁'), ['新标题 丙丁'])


if __name__ == '__main__':
    unittest.main()
