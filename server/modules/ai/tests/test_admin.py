from app import flags
from modules.ai import catalog, gateway
from modules.ai.gateway import Gateway
from modules.ai.providers.fake import FakeLLM
from tests.helpers import HDRS, AppCase

from .fakes import ENV, FAKE_KEY

FEED_INPUTS = {'items': [{'id': 'a', 'title': '某模型发布', 'excerpt': '原文内容'}]}


class AdminApiTest(AppCase):
    def setUp(self):
        super().setUp()
        self.llm = FakeLLM(error='rate_limited')
        self.gw = gateway.configure(env=ENV, providers={'anthropic': self.llm})

    def tearDown(self):
        gateway.reset()
        super().tearDown()

    def test_requires_admin_and_totp(self):
        member = self.user('member', level=5)
        self.assertEqual(self.code(member.get('/api/ai/status')), 'action_not_allowed')
        no_totp = self.user('admin_no_totp', roles=('admin',))
        self.assertEqual(self.code(no_totp.get('/api/ai/status')), 'totp_setup_required')
        r = no_totp.post('/api/ai/budgets/feed.summarize', headers=HDRS, json={'daily_calls': 5})
        self.assertEqual(self.code(r), 'totp_setup_required')

    def test_status_usage_failures_and_budget_edit(self):
        admin = self.user('admin', roles=('admin',), totp=True)
        with self.db.write() as conn:
            flags.set_flag(conn, catalog.GLOBAL_FLAG, True, None)
            flags.set_flag(conn, 'ai.feed.summarize.enabled', True, None)
        result = self.gw.run(self.db, feature='feed.summarize', task='event', inputs=FEED_INPUTS)
        self.assertEqual(result.reason, 'rate_limited')
        self.gw.run(self.db, feature='kb.draft_problem', task='draft', inputs={'text': '构建失败'})

        status = admin.get('/api/ai/status').json()['data']
        self.assertTrue(status['enabled'])
        feed = next(f for f in status['features'] if f['feature'] == 'feed.summarize')
        self.assertTrue(feed['enabled'])
        self.assertEqual(feed['model'], 'claude-opus-5-5')
        self.assertEqual(feed['today']['calls'], 1)
        self.assertEqual(feed['today']['failures'], 1)
        self.assertTrue(feed['ready'])
        transcribe = next(f for f in status['features'] if f['feature'] == 'talks.transcribe')
        self.assertEqual(transcribe['not_ready_reason'], 'not_configured')
        self.assertNotIn(FAKE_KEY, str(status))

        failures = admin.get('/api/ai/calls').json()['data']
        self.assertEqual([(c['feature'], c['reason_code']) for c in failures], [('feed.summarize', 'rate_limited')])
        self.assertNotIn('原文内容', str(failures))
        everything = admin.get('/api/ai/calls?kind=fallbacks').json()['data']
        self.assertEqual({c['reason_code'] for c in everything}, {'rate_limited', 'disabled_feature'})

        r = admin.post('/api/ai/budgets/feed.summarize', headers=HDRS,
                       json={'daily_calls': 7, 'daily_cost_usd': 1.5, 'cache_ttl_seconds': 60})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data'], {'feature': 'feed.summarize', 'daily_calls': 7, 'daily_cost_usd': 1.5,
                                            'cache_ttl_seconds': 60})
        feed = next(f for f in admin.get('/api/ai/status').json()['data']['features']
                    if f['feature'] == 'feed.summarize')
        self.assertEqual(feed['budget'], {'daily_calls': 7, 'daily_cost_usd': 1.5, 'cache_ttl_s': 60})
        audit = self.db.conn().execute("SELECT actor_id FROM audit_event WHERE action = 'ai.budget.set'").fetchall()
        self.assertEqual([a[0] for a in audit], [admin.pid])
        self.assertEqual(self.code(admin.post('/api/ai/budgets/nope', headers=HDRS, json={'daily_calls': 1})),
                         'resource_not_found')
        self.assertEqual(self.code(admin.post('/api/ai/budgets/feed.summarize', headers=HDRS, json={})),
                         'validation_failed')
        self.assertEqual(self.code(admin.post('/api/ai/budgets/feed.summarize', headers=HDRS,
                                              json={'daily_calls': -1})), 'validation_failed')


class MemberPrefsTest(AppCase):
    def tearDown(self):
        gateway.reset()
        super().tearDown()

    def test_member_can_opt_out_of_digest_but_not_governance(self):
        member = self.user('reader')
        prefs = member.get('/api/ai/me/prefs').json()['data']
        self.assertEqual({p['feature'] for p in prefs}, {'digest.summarize', 'search.assist'})
        self.assertFalse(any(p['available'] for p in prefs))
        r = member.post('/api/ai/me/prefs', headers=HDRS, json={'feature': 'governance.screen_text', 'opted_out': True})
        self.assertEqual(self.code(r), 'validation_failed')
        r = member.post('/api/ai/me/prefs', headers=HDRS, json={'feature': 'digest.summarize', 'opted_out': True})
        self.assertEqual(r.status_code, 200, r.text)

        llm = FakeLLM(reply={'headline': '简报', 'paragraphs': [], 'highlights': []})
        gw = Gateway(env=ENV, providers={'anthropic': llm})
        with self.db.write() as conn:
            flags.set_flag(conn, catalog.GLOBAL_FLAG, True, None)
            flags.set_flag(conn, 'ai.digest.summarize.enabled', True, None)
        items = {'items': [{'id': 'n1', 'title': '有人回复了你'}]}
        mine = gw.run(self.db, feature='digest.summarize', task='brief', inputs=items, actor_id=member.pid)
        self.assertEqual(mine.reason, 'member_opt_out')
        other = self.user('other')
        theirs = gw.run(self.db, feature='digest.summarize', task='brief', inputs=items, actor_id=other.pid)
        self.assertTrue(theirs.ok)
        self.assertEqual(len(llm.requests), 1)
        exported = member.get('/api/me/export')
        self.assertEqual(exported.status_code, 200)
        self.assertIn('"ai"', exported.text)
