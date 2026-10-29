import importlib.util
import io
import json
import logging
import unittest

from app import clock, flags, outbox
from modules.ai import budget, catalog, gateway, prompts
from modules.ai.gateway import Gateway
from modules.ai.providers import ProviderError
from modules.ai.providers.anthropic import OFFICIAL_BASE_URL, AnthropicProvider
from modules.ai.providers.fake import FakeLLM
from modules.ai.providers.speech import FakeSpeech
from modules.ai.schema import check_api_subset
from tests.helpers import HDRS, AppCase

from .fakes import ENV, FAKE_KEY, fake_sdk, message

SUMMARY = {'headline': '某模型发布', 'summary': '回复标记ABC：发布了新版本。', 'why_it_matters': '', 'entities': ['X'],
           'source_ids': ['a']}
SCREEN = {'suggestion': 'likely_violation', 'categories': ['contact'], 'reasons': ['疑似留联系方式引流。'],
          'confidence': 0.9}
DRAFT = {'title': '构建失败', 'phenomenon': '构建时报错', 'error_signature': '', 'tools': [], 'industry': None,
         'suspected_cause': '', 'steps_tried': [], 'missing_info': []}
FEED_INPUTS = {'items': [{'id': 'a', 'title': '某模型发布', 'excerpt': '独角兽秘密内容XYZ。今天发布。'}]}


class RogueLLM(FakeLLM):
    """不守规矩的适配器：异常信息里带着密钥。网关必须兜住。"""

    def __init__(self, exc):
        super().__init__()
        self.exc = exc

    def complete(self, request, api_key):
        raise self.exc


def canned(request):
    if 'suggestion' in request.schema['properties']:
        return SCREEN
    if 'phenomenon' in request.schema['properties']:
        return DRAFT
    return SUMMARY


class GatewayCase(AppCase):
    def setUp(self):
        super().setUp()
        self.llm = FakeLLM(reply=canned)
        self.speech = FakeSpeech()
        self.gw = Gateway(env=dict(ENV, COMMONS_AI_FAKE_SPEECH_KEY='fake-speech-key-123'),
                          providers={'anthropic': self.llm, 'speech': self.speech})

    def enable(self, *features, everything=True):
        with self.db.write() as conn:
            if everything:
                flags.set_flag(conn, catalog.GLOBAL_FLAG, True, None)
            for name in features:
                flags.set_flag(conn, catalog.get(name).flag, True, None)

    def rows(self, sql, *params):
        return [dict(r) for r in self.db.conn().execute(sql, params).fetchall()]

    def table_counts(self):
        conn = self.db.conn()
        names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' "
                                            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%'")]
        return {n: conn.execute(f'SELECT count(*) FROM "{n}"').fetchone()[0] for n in names}


class SwitchesTest(GatewayCase):
    def test_global_switch_off_degrades_every_feature(self):
        with self.db.write() as conn:
            for spec in catalog.FEATURES.values():
                flags.set_flag(conn, spec.flag, True, None)
        samples = {
            'governance.screen_text': ('screen', {'text': '正文'}),
            'governance.screen_image': ('screen', {'images': [{'media_type': 'image/png', 'data': b'\x89PNG'}]}),
            'talks.transcribe': ('transcribe', {'audio': b'RIFF', 'media_type': 'audio/wav', 'consent': 'all_speakers'}),
            'talks.translate': ('translate', {'segments': [{'id': '1', 'text': '你好'}], 'target_lang': 'en'}),
            'talks.minutes': ('minutes', {'transcript': '今天讨论评测。待办：小王整理数据。'}),
            'feed.summarize': ('event', FEED_INPUTS),
            'kb.draft_problem': ('draft', {'text': '构建失败'}),
            'digest.summarize': ('brief', {'items': [{'id': 'n1', 'title': '有人回复了你'}]}),
            'search.assist': ('expand', {'query': '怎么评测智能体'}),
        }
        self.assertEqual(set(samples), set(catalog.FEATURES))
        for feature, (task, inputs) in samples.items():
            with self.subTest(feature=feature):
                result = self.gw.run(self.db, feature=feature, task=task, inputs=inputs)
                self.assertTrue(result.degraded)
                self.assertEqual(result.reason, 'disabled_global')
                prompts.task(feature, task)
                from modules.ai.schema import validate
                validate(result.data, prompts.task(feature, task).schema)
        self.assertEqual(self.llm.requests, [])
        self.assertEqual(self.speech.calls, [])
        calls = self.rows('SELECT result, reason_code FROM ai_call')
        self.assertEqual(len(calls), len(samples))
        self.assertTrue(all(c == {'result': 'fallback', 'reason_code': 'disabled_global'} for c in calls))
        audits = self.rows("SELECT outcome FROM audit_event WHERE action = 'ai.call'")
        self.assertEqual({a['outcome'] for a in audits}, {'denied'})

    def test_single_feature_switch(self):
        self.enable('feed.summarize')
        off = self.gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': '构建失败'})
        self.assertEqual((off.degraded, off.reason), (True, 'disabled_feature'))
        on = self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        self.assertEqual((on.degraded, on.source, on.data), (False, 'model', SUMMARY))
        self.assertEqual(len(self.llm.requests), 1)

    def test_unknown_feature_task_or_input_is_a_programming_error(self):
        with self.assertRaises(ValueError):
            self.gw.run(self.db, feature='nope', task='x', inputs={})
        with self.assertRaises(ValueError):
            self.gw.run(self.db, feature='feed.summarize', task='nope', inputs=FEED_INPUTS)
        with self.assertRaises(ValueError):
            self.gw.run(self.db, feature='feed.summarize', task='event', inputs=dict(FEED_INPUTS, author_email='a@b.c'))


class CallTest(GatewayCase):
    def test_success_audit_has_sizes_not_content(self):
        self.enable('feed.summarize')
        result = self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS, actor_id=None,
                             object_id='obj-1')
        self.assertTrue(result.ok)
        self.assertEqual(result.model, 'claude-opus-5-5')
        self.assertGreater(result.cost_usd, 0)
        call = self.rows('SELECT * FROM ai_call')[0]
        self.assertEqual((call['result'], call['provider'], call['model'], call['object_id']),
                         ('ok', 'anthropic', 'claude-opus-5-5', 'obj-1'))
        self.assertEqual((call['input_tokens'], call['output_tokens']), (1000, 200))
        self.assertEqual(call['cost_micros'], catalog.cost_micros('claude-opus-5-5', 1000, 200))
        self.assertGreater(call['input_chars'], 0)
        self.assertGreater(call['output_chars'], 0)
        audit = self.rows("SELECT * FROM audit_event WHERE action = 'ai.call'")
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit[0]['outcome'], 'ok')
        dump = json.dumps([self.rows(f'SELECT * FROM {t}') for t in
                           ('ai_call', 'audit_event', 'ai_usage_daily', 'outbox_event')], ensure_ascii=False)
        for secret in ('独角兽秘密内容XYZ', '回复标记ABC', '今天发布'):
            self.assertNotIn(secret, dump)
        usage = budget.usage(self.db.conn())['feed.summarize']
        self.assertEqual((usage['calls'], usage['reserved_micros'], usage['cost_micros']), (1, 0, call['cost_micros']))

    def test_redaction_before_send_and_counts_recorded(self):
        self.enable('kb.draft_problem')
        text = '构建失败，联系我 13812345678 或 dev.zhang@example.com，微信：zhang_dev01'
        result = self.gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': text})
        sent = self.llm.requests[0].text
        for leaked in ('13812345678', 'dev.zhang@example.com', 'zhang_dev01'):
            self.assertNotIn(leaked, sent)
        self.assertIn('[手机号]', sent)
        self.assertEqual(result.redactions, {'phone': 1, 'email': 1, 'wechat': 1})
        stored = json.loads(self.rows('SELECT redactions_json FROM ai_call')[0]['redactions_json'])
        self.assertEqual(stored, {'phone': 1, 'email': 1, 'wechat': 1})

    def test_invalid_json_from_model_degrades(self):
        self.enable('feed.summarize')
        self.llm.reply = '这不是 JSON {'
        result = self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        self.assertEqual((result.degraded, result.reason), (True, 'invalid_output'))
        self.assertEqual(result.data['headline'], '某模型发布')
        usage = budget.usage(self.db.conn())['feed.summarize']
        self.assertEqual((usage['calls'], usage['failures'], usage['fallbacks']), (1, 1, 1))
        self.assertEqual(self.rows('SELECT count(*) AS n FROM ai_cache')[0]['n'], 0)
        audit = self.rows("SELECT outcome, reason_code FROM audit_event WHERE action = 'ai.call'")[0]
        self.assertEqual(audit, {'outcome': 'error', 'reason_code': 'invalid_output'})

    def test_schema_mismatch_degrades(self):
        self.enable('feed.summarize')
        self.llm.reply = {'headline': 'x'}
        self.assertEqual(self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS).reason,
                         'invalid_output')

    def test_input_too_large_is_not_sent(self):
        self.enable('kb.draft_problem')
        result = self.gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': '长' * 25000})
        self.assertEqual(result.reason, 'input_too_large')
        self.assertEqual(self.llm.requests, [])

    def test_raw_connection_outside_transaction_works(self):
        self.enable('feed.summarize')
        conn = self.db.conn()
        result = self.gw.run(conn, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        self.assertTrue(result.ok)
        self.assertFalse(conn.in_transaction)
        self.assertEqual(len(self.rows('SELECT id FROM ai_call')), 1)


class GovernanceTest(GatewayCase):
    def test_screening_is_not_redacted_and_never_acts(self):
        self.enable('governance.screen_text')
        author = self.user('author', level=2)
        item = self.obj(author, title='出售', content={'body': '加我 13812345678 领福利'})
        outbox.dispatch(self.db)
        before = self.table_counts()
        events_before = {r['event_type'] for r in self.rows('SELECT event_type FROM outbox_event')}
        result = self.gw.run(self.db, feature='governance.screen_text', task='screen',
                             inputs={'title': '出售', 'text': '加我 13812345678 领福利'}, object_id=item['id'])
        self.assertIn('13812345678', self.llm.requests[0].text)
        self.assertEqual(self.llm.requests[0].model, 'claude-haiku-5-5')
        self.assertTrue(result.advisory)
        self.assertEqual(result.data['suggestion'], 'likely_violation')
        changed = {t for t, n in self.table_counts().items() if before.get(t) != n}
        self.assertLessEqual(changed, {'ai_call', 'ai_usage_daily', 'audit_event', 'ai_cache'})
        head = self.rows('SELECT lifecycle FROM object_head WHERE id = ?', item['id'])[0]
        self.assertEqual(head['lifecycle'], 'active')
        self.assertEqual({r['event_type'] for r in self.rows('SELECT event_type FROM outbox_event')}, events_before)

    def test_punitive_or_extra_fields_are_rejected(self):
        self.enable('governance.screen_text')
        for bad in ({**SCREEN, 'suggestion': 'ban_user'}, {**SCREEN, 'action': 'delete'}, {**SCREEN, 'confidence': 3}):
            with self.subTest(bad=bad):
                self.llm.reply = bad
                result = self.gw.run(self.db, feature='governance.screen_text', task='screen',
                                     inputs={'text': f'正文 {bad}'})
                self.assertEqual(result.reason, 'invalid_output')
                self.assertIn(result.data['suggestion'], ('no_issue', 'human_review'))
                self.assertNotIn('action', result.data)

    def test_templates_only_offer_suggestions(self):
        for feature in ('governance.screen_text', 'governance.screen_image'):
            props = prompts.task(feature, 'screen').schema['properties']
            self.assertEqual(props['suggestion']['enum'], ['no_issue', 'human_review', 'likely_violation'])
            self.assertEqual(set(props), {'suggestion', 'categories', 'reasons', 'confidence'})
            self.assertTrue(catalog.get(feature).advisory)
            self.assertEqual(catalog.get(feature).redact, ())


class BudgetTest(GatewayCase):
    def test_call_limit_degrades_and_notifies_admins_once(self):
        admin = self.user('boss', roles=('admin',))
        self.enable('feed.summarize')
        with self.db.write() as conn:
            budget.set_budget(conn, 'feed.summarize', None, daily_calls=1)
        first = self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        second = self.gw.run(self.db, feature='feed.summarize', task='event',
                             inputs={'items': [{'id': 'b', 'title': '另一件事', 'excerpt': '内容'}]})
        third = self.gw.run(self.db, feature='feed.summarize', task='event',
                            inputs={'items': [{'id': 'c', 'title': '第三件事', 'excerpt': '内容'}]})
        self.assertEqual((first.ok, second.reason, third.reason), (True, 'budget_calls', 'budget_calls'))
        self.assertEqual(len(self.llm.requests), 1)
        events = self.rows("SELECT event_type, payload_json FROM outbox_event WHERE event_type LIKE '%budget%'")
        self.assertEqual(sorted(e['event_type'] for e in events), ['ai.budget_exceeded', 'notify.system.ai_budget'])
        notice = json.loads(next(e for e in events if e['event_type'] == 'notify.system.ai_budget')['payload_json'])
        self.assertEqual(notice['recipient_id'], [admin.pid])
        self.assertIn('feed.summarize', notice['message'])

    def test_cost_limit_degrades_before_calling(self):
        self.enable('talks.minutes')
        with self.db.write() as conn:
            budget.set_budget(conn, 'talks.minutes', None, daily_cost_usd=0.000001)
        result = self.gw.run(self.db, feature='talks.minutes', task='minutes', inputs={'transcript': '今天讨论评测。'})
        self.assertEqual(result.reason, 'budget_cost')
        self.assertEqual(self.llm.requests, [])
        self.assertTrue(result.data['summary'])

    def test_seeded_budgets_match_catalog(self):
        rows = {r['feature']: r for r in self.rows('SELECT * FROM ai_budget')}
        self.assertEqual(set(rows), set(catalog.FEATURES))
        for name, spec in catalog.FEATURES.items():
            self.assertEqual((rows[name]['daily_calls'], rows[name]['daily_cost_micros'], rows[name]['cache_ttl_s']),
                             (spec.daily_calls, int(spec.daily_cost_usd * 1e6), spec.cache_ttl_s), name)
        flag_rows = {r['key']: r['enabled'] for r in self.rows("SELECT key, enabled FROM feature_flag WHERE key LIKE 'ai.%'")}
        self.assertEqual(set(flag_rows), {catalog.GLOBAL_FLAG} | {s.flag for s in catalog.FEATURES.values()})
        self.assertFalse(any(flag_rows.values()))


class CacheTest(GatewayCase):
    def test_same_input_hits_cache(self):
        self.enable('feed.summarize')
        a = self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        b = self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        self.assertEqual((a.source, b.source, b.data), ('model', 'cache', SUMMARY))
        self.assertEqual(len(self.llm.requests), 1)
        usage = budget.usage(self.db.conn())['feed.summarize']
        self.assertEqual((usage['calls'], usage['cache_hits']), (1, 1))
        self.assertEqual([r['result'] for r in self.rows('SELECT result FROM ai_call ORDER BY occurred_at')],
                         ['ok', 'cache_hit'])
        self.gw.run(self.db, feature='feed.summarize', task='event',
                    inputs={'items': [{'id': 'a', 'title': '某模型发布', 'excerpt': '不同内容'}]})
        self.assertEqual(len(self.llm.requests), 2)

    def test_expired_or_disabled_cache_misses(self):
        self.enable('feed.summarize')
        self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        with self.db.write() as conn:
            conn.execute('UPDATE ai_cache SET expires_at = ?', (clock.iso(clock.now_ts() - 1),))
        self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        self.assertEqual(len(self.llm.requests), 2)
        with self.db.write() as conn:
            budget.set_budget(conn, 'feed.summarize', None, cache_ttl_s=0)
            conn.execute('DELETE FROM ai_cache')
        self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        self.assertEqual(len(self.llm.requests), 4)

    def test_global_switch_beats_cache(self):
        self.enable('feed.summarize')
        self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        with self.db.write() as conn:
            flags.set_flag(conn, catalog.GLOBAL_FLAG, False, None)
        self.assertEqual(self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS).reason,
                         'disabled_global')

    def test_withdrawn_object_purges_cached_output(self):
        self.enable('kb.draft_problem')
        author = self.user('writer', level=2)
        item = self.obj(author)
        self.gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': '构建失败'},
                    object_id=item['id'])
        self.assertEqual(len(self.rows('SELECT key FROM ai_cache WHERE object_id = ?', item['id'])), 1)
        r = author.post(f"/api/objects/{item['id']}/withdraw", headers=HDRS, json={})
        self.assertEqual(r.status_code, 200, r.text)
        for _ in range(3):
            outbox.dispatch(self.db)
        self.assertEqual(self.rows('SELECT key FROM ai_cache WHERE object_id = ?', item['id']), [])


class ProviderReadinessTest(GatewayCase):
    def test_missing_key_degrades(self):
        self.enable('feed.summarize')
        gw = Gateway(env={}, providers={'anthropic': self.llm})
        self.assertEqual(gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS).reason, 'no_key')
        self.assertEqual(self.llm.requests, [])

    def test_sdk_missing_degrades_without_crashing(self):
        self.enable('feed.summarize')

        def missing():
            raise ImportError('No module named anthropic')

        gw = Gateway(env=ENV, providers={'anthropic': AnthropicProvider(sdk_loader=missing)})
        result = gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        self.assertEqual((result.degraded, result.reason), (True, 'sdk_missing'))
        self.assertEqual(budget.usage(self.db.conn())['feed.summarize']['calls'], 0)

    @unittest.skipIf(importlib.util.find_spec('anthropic') is not None, 'anthropic installed; would not be "missing"')
    def test_real_lazy_import_reports_missing_sdk(self):
        self.enable('feed.summarize')
        gw = Gateway(env=ENV, providers={'anthropic': AnthropicProvider()})
        self.assertEqual(gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS).reason,
                         'sdk_missing')

    def test_transcribe_needs_consent_and_a_chosen_provider(self):
        self.enable('talks.transcribe')
        audio = {'audio': b'RIFF....', 'media_type': 'audio/wav', 'duration_s': 120}
        self.assertEqual(self.gw.run(self.db, feature='talks.transcribe', task='transcribe',
                                     inputs=dict(audio, consent='host_only')).reason, 'consent_required')
        self.assertEqual(self.speech.calls, [])
        default = Gateway(env=ENV, providers={'anthropic': self.llm, 'speech': gateway.default_providers()['speech']})
        self.assertEqual(default.run(self.db, feature='talks.transcribe', task='transcribe',
                                     inputs=dict(audio, consent='all_speakers')).reason, 'not_configured')
        ok = self.gw.run(self.db, feature='talks.transcribe', task='transcribe',
                         inputs=dict(audio, consent='all_speakers'))
        self.assertTrue(ok.ok, ok.reason)
        self.assertEqual(ok.data['segments'][0]['speaker'], 'S1')
        self.assertEqual(len(self.speech.calls), 1)


class AnthropicAdapterTest(GatewayCase):
    def gateway_with(self, sdk):
        provider = AnthropicProvider(sdk_loader=lambda: sdk)
        return Gateway(env=ENV, providers={'anthropic': provider})

    def test_request_shape_follows_claude_api_docs(self):
        self.enable('feed.summarize', 'kb.draft_problem', 'governance.screen_text', 'governance.screen_image')
        sdk = fake_sdk(reply=lambda p: message(json.dumps(
            SCREEN if 'suggestion' in p['output_config']['format']['schema']['properties']
            else DRAFT if 'phenomenon' in p['output_config']['format']['schema']['properties'] else SUMMARY),
            model=p['model']))
        gw = self.gateway_with(sdk)
        self.assertTrue(gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS).ok)
        self.assertTrue(gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': '构建失败'}).ok)
        self.assertTrue(gw.run(self.db, feature='governance.screen_text', task='screen', inputs={'text': '正文'}).ok)
        self.assertTrue(gw.run(self.db, feature='governance.screen_image', task='screen',
                               inputs={'images': [{'media_type': 'image/png', 'data': b'\x89PNG'}]}).ok)
        client = [c for c in sdk.calls if c[0] == 'client']
        self.assertEqual(len(client), 1)
        self.assertEqual(client[0][1]['api_key'], FAKE_KEY)
        self.assertEqual(client[0][1]['base_url'], OFFICIAL_BASE_URL)
        paths = [c[0] for c in sdk.calls if c[0] != 'client']
        self.assertEqual(paths, ['beta.messages.create', 'beta.messages.stream', 'messages.create',
                                 'beta.messages.create'])
        feed, draft, screen, image = [c[1] for c in sdk.calls if c[0] != 'client']
        self.assertEqual(feed['model'], 'claude-opus-5-5')
        self.assertEqual(feed['thinking'], {'type': 'adaptive'})
        self.assertEqual(feed['output_config']['effort'], 'low')
        self.assertEqual(feed['output_config']['format']['type'], 'json_schema')
        self.assertEqual((feed['betas'], feed['fallbacks']), (['server-side-fallback-2026-07-01'], 'default'))
        self.assertNotIn('temperature', feed)
        self.assertEqual(draft['output_config']['effort'], 'medium')
        self.assertEqual(screen['model'], 'claude-haiku-5-5')
        self.assertNotIn('fallbacks', screen)
        self.assertNotIn('betas', screen)
        blocks = image['messages'][0]['content']
        self.assertEqual(blocks[0]['type'], 'image')
        self.assertEqual(blocks[0]['source'], {'type': 'base64', 'media_type': 'image/png', 'data': 'iVBORw=='})
        self.assertEqual(blocks[-1]['type'], 'text')
        self.assertEqual(image['model'], 'claude-sonnet-5-5')

    def test_refusal_truncation_and_errors_degrade(self):
        self.enable('governance.screen_text', 'feed.summarize')
        cases = [
            (fake_sdk(reply=message('', stop='refusal', category='cyber')), 'refusal'),
            (fake_sdk(reply=message('{"headline"', stop='max_tokens')), 'truncated'),
            (fake_sdk(error=lambda s: s.RateLimitError('slow down', 429)), 'rate_limited'),
            (fake_sdk(error=lambda s: s.APITimeoutError('timed out')), 'timeout'),
            (fake_sdk(error=lambda s: s.APIConnectionError('down')), 'network'),
            (fake_sdk(error=lambda s: s.AuthenticationError('bad key', 401)), 'auth'),
            (fake_sdk(error=lambda s: s.APIStatusError('overloaded', 529)), 'provider_error'),
            (fake_sdk(error=lambda s: RuntimeError('boom')), 'provider_error'),
        ]
        for i, (sdk, reason) in enumerate(cases):
            with self.subTest(reason=reason):
                result = self.gateway_with(sdk).run(self.db, feature='governance.screen_text', task='screen',
                                                    inputs={'text': f'第 {i} 条'})
                self.assertEqual((result.degraded, result.reason), (True, reason))
        refused = self.rows("SELECT reason_code FROM ai_call WHERE reason_code = 'refusal'")
        self.assertEqual(len(refused), 1)
        first = self.gateway_with(cases[0][0]).run(self.db, feature='governance.screen_text', task='screen',
                                                   inputs={'text': '再来一条'})
        self.assertEqual(first.data['suggestion'], 'human_review')


class SecretTest(GatewayCase):
    def test_key_never_appears_in_db_logs_results_or_api(self):
        self.enable('feed.summarize', 'kb.draft_problem')
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        root = logging.getLogger()
        old_level = root.level
        root.addHandler(handler)
        root.setLevel(logging.DEBUG)
        try:
            leaky = fake_sdk(error=lambda s: s.AuthenticationError(f'invalid x-api-key {FAKE_KEY}', 401))
            gw = gateway.configure(env=ENV, providers={'anthropic': AnthropicProvider(sdk_loader=lambda: leaky),
                                                       'speech': self.speech})
            results = [gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)]
            crashing = fake_sdk(error=lambda s: ValueError(FAKE_KEY))
            gw.providers['anthropic'] = AnthropicProvider(sdk_loader=lambda: crashing)
            results.append(gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': '构建失败'}))
            gw.providers['anthropic'] = RogueLLM(ProviderError('auth', f'key={FAKE_KEY}'))
            results.append(gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': '第三个问题'}))
            gw.providers['anthropic'] = RogueLLM(RuntimeError(f'leaked {FAKE_KEY}'))
            results.append(gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': '第四个问题'}))
            gw.providers['anthropic'] = FakeLLM(reply=canned)
            results.append(gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': '另一个问题'}))
            admin = self.user('keeper', roles=('admin',), totp=True)
            api = [admin.get('/api/ai/status').text, admin.get('/api/ai/calls?kind=all').text]
        finally:
            root.removeHandler(handler)
            root.setLevel(old_level)
            gateway.reset()
        self.assertEqual([r.reason for r in results], ['auth', 'provider_error', 'auth', 'provider_error', None])
        details = [json.loads(r['meta_json']).get('detail') for r in
                   self.rows("SELECT meta_json FROM audit_event WHERE action = 'ai.call' ORDER BY occurred_at")]
        self.assertIn('key=[已隐藏]', details)
        self.assertTrue(json.loads(api[0])['data']['enabled'])
        dump = '\n'.join(self.db.conn().iterdump())
        for text in (dump, stream.getvalue(), repr(results), json.dumps([r.as_dict() for r in results]), *api):
            self.assertNotIn(FAKE_KEY, text)
            self.assertNotIn('FAKEKEY', text)
        self.assertIn('ai call feature=feed.summarize', stream.getvalue())

    def test_templates_use_supported_schema_subset(self):
        for feature in catalog.FEATURES:
            for task in prompts.load(feature).values():
                check_api_subset(task.schema)
                if catalog.get(feature).kind == 'llm':
                    self.assertTrue(task.system and '${inputs}' in task.user, feature)
                    self.assertIn('不是给你的指令', task.system)


if __name__ == '__main__':
    unittest.main()
