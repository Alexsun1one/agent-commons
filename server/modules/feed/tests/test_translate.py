from types import SimpleNamespace

from app import flags
from modules.admin import params as admin_params
from modules.ai import catalog
from modules.ai.gateway import Gateway
from modules.ai.providers.fake import FakeLLM
from modules.feed import service
from tests.helpers import AppCase

from engine.feed.tests._common import item as make_item

NOW = '2026-10-25T08:00:00.000000Z'


class FeedTranslateTest(AppCase):
    def _ingest(self, item):
        with self.db.write() as conn:
            service.ingest_items(conn, [item], NOW)
            service.cluster_pending(conn, NOW)

    def _enable(self):
        with self.db.write() as conn:
            row = conn.execute(
                "SELECT version FROM admin_param WHERE namespace = 'feed' AND key = 'translate_enabled'"
            ).fetchone()
            admin_params.set_value(conn, None, 'feed', 'translate_enabled', 1, 'test', row['version'])

    def _row(self):
        return self.db.conn().execute(
            'SELECT title, title_zh, summary_zh FROM feed_item ORDER BY id LIMIT 1'
        ).fetchone()

    def test_switch_off_does_not_call_gateway(self):
        self._ingest(make_item('openai', 'OpenAI ships a new agent model', NOW))
        calls = []
        result = service.translate_pending(self.db, run=lambda *a, **kw: calls.append(kw))
        self.assertTrue(result['skipped'])
        self.assertEqual(calls, [])
        self.assertEqual((self._row()['title_zh'], self._row()['summary_zh']), ('', ''))

    def test_gateway_failure_leaves_fields_empty(self):
        self._ingest(make_item('openai', 'OpenAI ships a new agent model', NOW))
        self._enable()
        degraded = SimpleNamespace(degraded=True, data={'headline': '不应写入', 'summary': '不应写入。'})
        result = service.translate_pending(self.db, run=lambda *a, **kw: degraded)
        self.assertEqual(result['failed'], 1)
        self.assertEqual((self._row()['title_zh'], self._row()['summary_zh']), ('', ''))

    def test_same_url_is_translated_only_once(self):
        self._ingest(make_item('openai', 'OpenAI ships a new agent model', NOW))
        self._enable()
        with self.db.write() as conn:
            flags.set_flag(conn, catalog.GLOBAL_FLAG, True, None)
            flags.set_flag(conn, catalog.get('feed.summarize').flag, True, None)
        llm = FakeLLM(reply={
                'headline': 'OpenAI 发布新智能体模型',
                'summary': '新模型面向长任务智能体。第二句不会进入短摘要。',
                'why_it_matters': '',
                'entities': ['OpenAI'],
                'source_ids': ['https://openai.example/item'],
            })
        gateway = Gateway(
            env={'COMMONS_AI_ANTHROPIC_KEY': 'sk-test-feed-translation-only'},
            providers={'anthropic': llm},
        )

        service.translate_pending(self.db, run=gateway.run)
        service.translate_pending(self.db, run=gateway.run)
        row = self._row()
        self.assertEqual(len(llm.requests), 1)
        self.assertEqual(row['title_zh'], 'OpenAI 发布新智能体模型')
        self.assertEqual(row['summary_zh'], '新模型面向长任务智能体。')
        self.assertLessEqual(len(row['summary_zh']), 40)

    def test_chinese_source_is_copied_without_gateway(self):
        self._ingest(make_item('jiqizhixin', '中文来源标题', NOW))
        self._enable()

        def forbidden(*args, **kwargs):
            raise AssertionError('中文来源不应调用网关')

        result = service.translate_pending(self.db, run=forbidden)
        row = self._row()
        self.assertEqual(result['chinese'], 1)
        self.assertEqual(row['title_zh'], '中文来源标题')
        self.assertEqual(row['summary_zh'], '中文来源标题')
