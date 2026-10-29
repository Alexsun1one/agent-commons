import json
import logging
import sqlite3
import unittest
from unittest import mock

from app import clock, flags, outbox
from app.authz import Actor
from modules.agents import auth, providers, scopes
from tests.helpers import HDRS, ORIGIN, AppCase


class CaptureLogs(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


def drain(db):
    while outbox.dispatch(db):
        pass


class AgentCase(AppCase):
    def setUp(self):
        super().setUp()
        self.alice = self.user('alice', level=2)

    # ---- 小工具

    def set_flag(self, key, value):
        with self.db.write() as conn:
            flags.set_flag(conn, key, value, None)

    def make_agent(self, who=None, status=201, **body):
        who = who or self.alice
        body.setdefault('name', '小助手')
        r = who.post('/api/agents', headers=HDRS, json=body)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 201 else r.json()

    def issue(self, agent_id, client=None, status=201, **body):
        client = client or self.alice
        body.setdefault('preset', 'read')
        r = client.post(f'/api/agents/{agent_id}/tokens', headers=HDRS, json=body)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 201 else r.json()

    def token(self, client=None, **body):
        agent = self.make_agent(client)
        return agent['id'], self.issue(agent['id'], client, **body)['token']

    def bare(self):
        return self.client()

    def bearer(self, token, csrf=True):
        h = {'Authorization': f'Bearer {token}'}
        if csrf:  # 核心层补丁（docs/shared-requests.md [AGENT-1]）落地前，POST 仍要带 CSRF 头和 Origin
            h.update(HDRS)
        return h

    def rest(self, token, name, method='get', **args):
        c = self.bare()
        if method == 'get':
            return c.get(f'/api/agents/v1/tools/{name}', params=args, headers=self.bearer(token, csrf=False))
        return c.post(f'/api/agents/v1/tools/{name}', json=args, headers=self.bearer(token))

    def rpc(self, token, method, params=None, msg_id=1, headers=None):
        body = {'jsonrpc': '2.0', 'method': method}
        if msg_id is not None:
            body['id'] = msg_id
        if params is not None:
            body['params'] = params
        h = self.bearer(token) if token else dict(HDRS)
        h.update(headers or {})
        return self.bare().post('/api/agents/mcp', json=body, headers=h)

    def call(self, token, name, **args):
        r = self.rpc(token, 'tools/call', {'name': name, 'arguments': args})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['result']

    def knowledge(self, client, title, body, **kw):
        return self.obj(client, type='knowledge', title=title, content={'body': body}, **kw)


class TokenTest(AgentCase):
    def test_token_shown_once_and_only_hash_stored(self):
        agent = self.make_agent()
        r = self.alice.post(f'/api/agents/{agent["id"]}/tokens', json={'preset': 'read'},
                            headers={**HDRS, 'Idempotency-Key': 'issue-token-0001'})
        self.assertEqual(r.status_code, 201, r.text)
        data = r.json()['data']
        token = data['token']
        self.assertTrue(token.startswith(auth.TOKEN_PREFIX))
        self.assertEqual(data['meta']['hint'], '…' + token[-4:])
        self.assertEqual(data['meta']['scopes'], [scopes.NEWS_READ, scopes.ME_READ])
        listing = self.alice.get('/api/agents/mine').json()['data']
        self.assertNotIn(token, json.dumps(listing, ensure_ascii=False))
        self.assertEqual(self.rest(token, 'hot_today').status_code, 200)
        dump = '\n'.join(self.db.conn().iterdump())
        self.assertNotIn(token, dump)
        self.assertNotIn(token[len(auth.TOKEN_PREFIX):], dump)
        with open(self.settings.db_path, 'rb') as f:
            self.assertNotIn(token.encode(), f.read())

    def test_token_never_logged(self):
        capture = CaptureLogs()
        root = logging.getLogger()
        old = root.level
        root.addHandler(capture)
        root.setLevel(logging.DEBUG)
        try:
            agent_id, token = self.token()
            self.rest(token, 'whats_new')
            self.rpc(token, 'tools/call', {'name': 'search_knowledge', 'arguments': {'query': '测试'}})
            self.rpc(token + 'x', 'tools/list')
        finally:
            root.removeHandler(capture)
            root.setLevel(old)
        self.assertTrue(capture.lines)
        for line in capture.lines:
            self.assertNotIn(token, line)

    def test_empty_scope_rejected(self):
        agent = self.make_agent()
        r = self.alice.post(f'/api/agents/{agent["id"]}/tokens', headers=HDRS, json={'scopes': []})
        self.assertEqual(r.status_code, 422)
        r = self.alice.post(f'/api/agents/{agent["id"]}/tokens', headers=HDRS, json={'scopes': ['admin.all']})
        self.assertEqual(r.status_code, 422)
        token = self.issue(agent['id'])['token']
        with self.db.write() as conn:
            conn.execute("UPDATE agent_token SET scopes_json = '[\"bogus\", 1]'")
        self.assertEqual(self.rest(token, 'hot_today').status_code, 401)
        self.assertIsNone(auth.actor_from_bearer(self.db.conn(), token, scopes.NEWS_READ))
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db.write() as conn:
                conn.execute("UPDATE agent_token SET scopes_json = '[]'")

    def test_required_scope_is_fail_closed(self):
        _, token = self.token()
        conn = self.db.conn()
        self.assertIsNone(auth.actor_from_bearer(conn, token, None))
        self.assertIsNone(auth.actor_from_bearer(conn, token, ''))
        self.assertIsNone(auth.actor_from_bearer(conn, token, 'news.*'))
        self.assertIsNone(auth.actor_from_bearer(conn, token, scopes.PLAZA_POST))
        actor = auth.actor_from_bearer(conn, 'Bearer ' + token, scopes.NEWS_READ)
        self.assertIsInstance(actor, Actor)
        self.assertEqual(actor.kind, 'agent')
        self.assertEqual(actor.owner_id, self.alice.pid)
        self.assertEqual(actor.level, 2)
        self.assertEqual(actor.roles, frozenset())

    def test_plaza_scope_for_agentchat(self):
        _, token = self.token(preset='plaza')
        actor = auth.actor_from_bearer(self.db.conn(), token, scopes.PLAZA_POST)
        self.assertIsNotNone(actor)
        self.assertIn(scopes.DRAFTS_WRITE, actor.scopes)

    def test_agentchat_helpers(self):
        agent_id, token = self.token(preset='plaza')
        conn = self.db.conn()
        self.assertIsNotNone(auth.actor_from_bearer(conn, token, 'agents.plaza.speak'))
        self.assertEqual(auth.owner_of(conn, agent_id), self.alice.pid)
        self.assertEqual(auth.owner_of(conn, self.alice.pid), self.alice.pid)
        self.assertIsNone(auth.owner_of(conn, 'nobody'))
        card = auth.card(conn, agent_id)
        self.assertEqual((card['owner_id'], card['owner_name'], card['color']), (self.alice.pid, 'alice', 'classic'))
        self.assertIsNone(auth.card(conn, self.alice.pid))
        _, read_token = self.token(preset='read')
        self.assertIsNone(auth.actor_from_bearer(conn, read_token, 'agents.plaza.speak'))

    def test_revoke_takes_effect_immediately(self):
        agent_id, token = self.token()
        self.assertEqual(self.rest(token, 'hot_today').status_code, 200)
        token_id = self.alice.get('/api/agents/mine').json()['data']['agents'][0]['tokens'][0]['id']
        r = self.alice.post(f'/api/agents/{agent_id}/tokens/{token_id}/revoke', headers=HDRS)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(r.json()['data']['active'])
        r = self.rest(token, 'hot_today')
        self.assertEqual(r.status_code, 401)
        self.assertIn('Bearer', r.headers['WWW-Authenticate'])
        self.assertEqual(self.rpc(token, 'tools/list').status_code, 401)

    def test_expired_token_rejected(self):
        _, token = self.token(expires_in_days=1)
        with self.db.write() as conn:
            conn.execute('UPDATE agent_token SET expires_at = ?', (clock.iso(clock.now_ts() - 1),))
        self.assertEqual(self.rest(token, 'hot_today').status_code, 401)
        self.assertIsNone(auth.actor_from_bearer(self.db.conn(), token, scopes.NEWS_READ))

    def test_other_member_cannot_manage_my_agent(self):
        agent_id, token = self.token()
        bob = self.user('bob', level=3)
        self.assertEqual(bob.post(f'/api/agents/{agent_id}/tokens', headers=HDRS, json={'preset': 'read'}).status_code, 404)
        self.assertEqual(bob.patch(f'/api/agents/{agent_id}', headers=HDRS, json={'name': 'x'}).status_code, 404)
        self.assertEqual(bob.get(f'/api/agents/{agent_id}/calls').status_code, 404)
        self.assertEqual(bob.get('/api/agents/mine').json()['data']['agents'], [])

    def test_cookie_does_not_authenticate_agent_endpoints(self):
        self.token()
        self.assertEqual(self.alice.get('/api/agents/v1/me').status_code, 401)
        self.assertEqual(self.alice.get('/api/agents/v1/tools/hot_today').status_code, 401)

    def test_foreign_origin_rejected_for_bearer(self):
        _, token = self.token()
        r = self.bare().get('/api/agents/v1/me', headers={**self.bearer(token, csrf=False), 'Origin': 'https://evil.test'})
        self.assertEqual(r.status_code, 403)

    def test_owner_suspended_kills_all_tokens(self):
        _, t1 = self.token()
        agent2 = self.make_agent(name='第二个')
        t2 = self.issue(agent2['id'])['token']
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'suspended' WHERE id = ?", (self.alice.pid,))
        self.assertEqual(self.rest(t1, 'hot_today').status_code, 401)
        self.assertIsNone(auth.actor_from_bearer(self.db.conn(), t2, scopes.NEWS_READ))
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'active' WHERE id = ?", (self.alice.pid,))
        self.assertEqual(self.rest(t1, 'hot_today').status_code, 401)
        self.assertEqual(self.rest(t2, 'hot_today').status_code, 401)

    def test_owner_deletion_revokes_tokens(self):
        _, token = self.token()
        r = self.alice.post('/api/me/delete', headers=HDRS, json={'password': 'correct horse 1'})
        self.assertEqual(r.status_code, 200, r.text)
        drain(self.db)
        row = self.db.conn().execute('SELECT revoked_at, revoke_reason FROM agent_token').fetchone()
        self.assertIsNotNone(row['revoked_at'])
        self.assertEqual(row['revoke_reason'], 'owner_inactive')

    def test_paused_and_retired_agent_rejected(self):
        agent_id, token = self.token()
        r = self.alice.patch(f'/api/agents/{agent_id}', headers=HDRS, json={'status': 'paused'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.rest(token, 'hot_today').status_code, 401)
        self.alice.patch(f'/api/agents/{agent_id}', headers=HDRS, json={'status': 'active'})
        self.assertEqual(self.rest(token, 'hot_today').status_code, 200)
        self.assertEqual(self.alice.post(f'/api/agents/{agent_id}/retire', headers=HDRS).status_code, 200)
        self.assertEqual(self.rest(token, 'hot_today').status_code, 401)
        self.assertEqual(self.issue(agent_id, status=409)['error']['code'], 'state_conflict')

    def test_master_switch(self):
        _, token = self.token()
        self.set_flag('agents.enabled', False)
        self.assertEqual(self.rest(token, 'hot_today').status_code, 501)
        self.assertEqual(self.make_agent(status=501)['error']['code'], 'capability_unavailable')

    def test_agent_caps_per_member(self):
        for i in range(3):
            self.make_agent(name=f'a{i}')
        self.assertEqual(self.make_agent(status=409)['error']['code'], 'state_conflict')
        carol = self.user('carol', level=3)
        for i in range(5):
            self.make_agent(carol, name=f'c{i}')
        self.make_agent(carol, status=409)

    def test_active_token_cap(self):
        agent = self.make_agent()
        for _ in range(3):
            self.issue(agent['id'])
        self.issue(agent['id'], status=409)

    def test_agent_principal_cannot_log_in(self):
        agent = self.make_agent()
        row = self.db.conn().execute('SELECT kind FROM principal WHERE id = ?', (agent['id'],)).fetchone()
        self.assertEqual(row['kind'], 'agent')
        self.assertIsNone(self.db.conn().execute('SELECT 1 FROM credential WHERE principal_id = ?',
                                                 (agent['id'],)).fetchone())
        self.assertEqual(agent['owner']['id'], self.alice.pid)


class VisibilityTest(AgentCase):
    def setUp(self):
        super().setUp()
        self.bob = self.user('bob', level=3)
        self.carol = self.user('carol', level=2)
        self.mine = self.knowledge(self.alice, '我的向量检索笔记', '向量检索要先切块')
        self.members = self.knowledge(self.bob, '成员可见的向量检索', '向量检索的召回率')
        self.level = self.knowledge(self.bob, '三级可见的向量检索', '向量检索高级技巧', visibility='level', min_level=3)
        self.named = self.knowledge(self.bob, '只给卡罗尔的向量检索', '向量检索私房话', visibility='named',
                                    acl=[self.carol.pid])
        _, self.tok = self.token()

    def ids(self, token):
        r = self.rest(token, 'search_knowledge', query='向量检索', limit=20)
        self.assertEqual(r.status_code, 200, r.text)
        return {x['id'] for x in r.json()['data']['results']}, r.json()['data']

    def test_member_content_withheld_by_default(self):
        ids, data = self.ids(self.tok)
        self.assertEqual(ids, {self.mine['id']})
        self.assertTrue(any('agents.read_member_content' in n for n in data['notes']))
        self.assertNotIn('成员可见的向量检索', json.dumps(data, ensure_ascii=False))

    def test_never_more_than_owner_can_see(self):
        self.set_flag('agents.read_member_content', True)
        ids, _ = self.ids(self.tok)
        self.assertEqual(ids, {self.mine['id'], self.members['id']})
        self.assertNotIn(self.level['id'], ids)
        self.assertNotIn(self.named['id'], ids)

    def test_owner_level_change_applies_next_call(self):
        self.set_flag('agents.read_member_content', True)
        with self.db.write() as conn:
            conn.execute('UPDATE profile SET level = 3 WHERE principal_id = ?', (self.alice.pid,))
        ids, _ = self.ids(self.tok)
        self.assertIn(self.level['id'], ids)
        self.assertNotIn(self.named['id'], ids)

    def test_whats_new_counts_but_withholds(self):
        self.obj(self.bob, type='reply', title='回', content={'body': '鲍勃的私密回复内容'}, root_id=self.mine['id'])
        r = self.rest(self.tok, 'whats_new')
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()['data']
        kn, rp = data['sections']['knowledge'], data['sections']['replies']
        self.assertEqual(kn['member_count'], 1)
        self.assertEqual(kn['withheld_count'], 1)
        self.assertEqual(kn['items'], [])
        self.assertEqual(rp['count'], 1)
        self.assertEqual(rp['items'][0]['from'], 'bob')  # 「谁回了我」按通知给显示名
        self.assertTrue(rp['items'][0]['withheld'])
        self.assertNotIn('excerpt', rp['items'][0])
        self.assertEqual(rp['items'][0]['on']['id'], self.mine['id'])
        text = json.dumps(data, ensure_ascii=False)
        for secret in ('鲍勃的私密回复内容', '成员可见的向量检索', '向量检索的召回率'):
            self.assertNotIn(secret, text)
        self.assertIn('summary_zh', data)
        self.assertIn('1 条新回复', data['summary_zh'])

    def test_whats_new_with_member_content_on(self):
        self.set_flag('agents.read_member_content', True)
        self.obj(self.bob, type='reply', title='回', content={'body': '鲍勃的回复'}, root_id=self.mine['id'])
        data = self.rest(self.tok, 'whats_new').json()['data']
        self.assertEqual([x['id'] for x in data['sections']['knowledge']['items']], [self.members['id']])
        self.assertEqual(data['sections']['replies']['items'][0]['excerpt'], '鲍勃的回复')

    def test_providers_are_redacted(self):
        def fake(conn, owner, skills, limit):
            return [
                {'id': 'b1', 'kind': 'bounty', 'title': '别人的悬赏标题', 'author_id': self.bob.pid, 'public': False,
                 'at': clock.now(), 'meta': {'reward': 50, 'secret_text': '不该出现的文字 with spaces'}},
                {'id': 'b2', 'kind': 'bounty', 'title': '公开悬赏', 'author_id': self.bob.pid, 'public': True,
                 'at': clock.now(), 'url': 'https://commons.test/p/x'},
                {'id': 'b3', 'kind': 'bounty', 'title': '我自己的悬赏', 'author_id': self.alice.pid, 'at': clock.now()},
            ]
        providers.register('bounty.open', fake)
        self.addCleanup(providers.unregister, 'bounty.open')
        data = self.rest(self.tok, 'list_bounties').json()['data']
        by_id = {b['id']: b for b in data['bounties']}
        self.assertTrue(by_id['b1']['withheld'])
        self.assertNotIn('title', by_id['b1'])
        self.assertEqual(by_id['b1']['meta'], {'reward': 50})
        self.assertEqual(by_id['b2']['title'], '公开悬赏')
        self.assertEqual(by_id['b3']['title'], '我自己的悬赏')
        self.assertNotIn('别人的悬赏标题', json.dumps(data, ensure_ascii=False))

    def test_notification_provider(self):
        providers.register('notifications.for_owner', lambda conn, owner, since, limit: [
            {'id': 'n1', 'category': 'reply', 'title': 'bob 回复了你', 'body': '在《我的向量检索笔记》里有新回复',
             'link': '#/discuss/x', 'at': clock.now()},
            {'id': 'n2', 'category': 'system', 'title': '链接', 'body': 'b', 'link': 'javascript:alert(1)', 'at': clock.now()}])
        self.addCleanup(providers.unregister, 'notifications.for_owner')
        data = self.rest(self.tok, 'my_notifications').json()['data']
        self.assertEqual(data['source'], 'provider')
        by_id = {n['id']: n for n in data['notifications']}
        self.assertEqual(by_id['n1']['title'], 'bob 回复了你')
        self.assertIsNone(by_id['n2']['link'])

    def test_unmerged_modules_return_empty_with_note(self):
        # 模拟「供数方都还没登记」，别的车道合并后登记了也不影响这条。
        with mock.patch.dict(providers.PROVIDERS, clear=True):
            data = self.rest(self.tok, 'whats_new').json()['data']
            solved = self.rest(self.tok, 'search_solved', query='ModuleNotFoundError').json()['data']
        for key in ('bounties',):
            self.assertFalse(data['sections'][key]['available'])
            self.assertEqual(data['sections'][key]['items'], [])
            self.assertTrue(data['sections'][key]['note'])
        self.assertEqual(solved['results'], [])
        self.assertTrue(solved['notes'])


class QuotaAndAuditTest(AgentCase):
    def test_daily_call_cap_429(self):
        _, token = self.token(daily_call_cap=2)
        self.assertEqual(self.rest(token, 'hot_today').status_code, 200)
        self.assertEqual(self.rest(token, 'trends').status_code, 200)
        r = self.rest(token, 'hot_today')
        self.assertEqual(r.status_code, 429)
        self.assertEqual(r.json()['error']['code'], 'rate_limited')
        self.assertIn('Retry-After', r.headers)
        r = self.rpc(token, 'tools/call', {'name': 'hot_today', 'arguments': {}})
        self.assertEqual(r.status_code, 429)
        self.assertEqual(r.json()['error']['code'], -32029)
        self.assertEqual(r.json()['error']['data']['code'], 'rate_limited')
        self.assertEqual(self.rpc(token, 'tools/list').status_code, 200)
        results = [r['result'] for r in self.db.conn().execute('SELECT result FROM agent_call_log ORDER BY at')]
        self.assertEqual(results, ['ok', 'ok', 'rate_limited', 'rate_limited'])

    def test_daily_item_cap(self):
        _, token = self.token(daily_item_cap=1)
        self.knowledge(self.alice, '额度一', '额度测试内容')
        self.knowledge(self.alice, '额度二', '额度测试内容')
        r = self.rest(token, 'search_knowledge', query='额度测试', limit=20)
        self.assertEqual(len(r.json()['data']['results']), 1)
        self.assertEqual(self.rest(token, 'search_knowledge', query='额度测试').status_code, 429)

    def test_page_size_hard_cap(self):
        _, token = self.token()
        r = self.rest(token, 'search_knowledge', query='x', limit=500)
        self.assertEqual(r.status_code, 422)

    def test_call_log_has_no_content(self):
        self.set_flag('agents.write.enabled', True)
        agent_id, token = self.token(preset='draft')
        self.rest(token, 'search_knowledge', query='zqxj独特检索词')
        self.call(token, 'draft_post', title='独特标题qwv', body='独特正文mnb')
        self.rest(token, 'whats_new', since='2026-10-20T00:00:00Z')
        rows = self.db.conn().execute('SELECT * FROM agent_call_log').fetchall()
        self.assertEqual([r['tool'] for r in rows].count('search_knowledge'), 1)
        self.assertEqual({r['result'] for r in rows}, {'ok'})
        log_text = json.dumps([dict(r) for r in rows], ensure_ascii=False)
        audit_text = json.dumps([dict(r) for r in self.db.conn().execute('SELECT * FROM audit_event')],
                                ensure_ascii=False)
        for secret in ('zqxj独特检索词', '独特标题qwv', '独特正文mnb', token):
            self.assertNotIn(secret, log_text)
            self.assertNotIn(secret, audit_text)
        calls = self.alice.get(f'/api/agents/{agent_id}/calls?limit=2').json()
        self.assertEqual(len(calls['data']), 2)
        self.assertIsNotNone(calls['meta']['next_cursor'])
        self.assertEqual(set(calls['data'][0]), {'id', 'token_id', 'tool', 'transport', 'at', 'items', 'result'})

    def test_call_log_append_only(self):
        _, token = self.token()
        self.rest(token, 'hot_today')
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db.write() as conn:
                conn.execute('DELETE FROM agent_call_log')

    def test_usage_and_last_used(self):
        agent_id, token = self.token()
        self.rest(token, 'trends')
        me = self.bare().get('/api/agents/v1/me', headers=self.bearer(token, csrf=False)).json()['data']
        self.assertEqual(me['usage_today']['calls'], 1)
        self.assertEqual(me['token']['call_count'], 1)
        self.assertIsNotNone(me['token']['last_used_at'])
        self.assertNotIn('draft_post', me['tools'])

    def test_preview_does_not_count(self):
        agent_id, token = self.token()
        r = self.alice.get(f'/api/agents/{agent_id}/preview')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn('summary_zh', r.json()['data'])
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM agent_call_log').fetchone()[0], 0)
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM agent_usage_day').fetchone()[0], 0)


class DraftTest(AgentCase):
    def setUp(self):
        super().setUp()
        self.agent_id, self.tok = self.token(preset='draft')

    def test_write_switch_defaults_off(self):
        res = self.call(self.tok, 'draft_post', title='标题', body='正文')
        self.assertTrue(res['isError'])
        self.assertEqual(res['structuredContent']['error']['code'], 'capability_unavailable')

    def test_read_token_cannot_draft(self):
        self.set_flag('agents.write.enabled', True)
        _, read_token = self.token(preset='read')
        self.assertNotIn('draft_post', [t['name'] for t in self.rpc(read_token, 'tools/list').json()['result']['tools']])
        res = self.call(read_token, 'draft_post', title='标题', body='正文')
        self.assertTrue(res['isError'])
        self.assertEqual(res['structuredContent']['error']['code'], 'agent_scope_missing')
        r = self.rest(read_token, 'draft_post', method='post', title='标题', body='正文')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.code(r), 'agent_scope_missing')

    def test_draft_hidden_until_confirmed(self):
        self.set_flag('agents.write.enabled', True)
        res = self.call(self.tok, 'draft_post', title='Agent 起草的帖子', body='一段草稿正文草稿词', tags=['RAG'])
        self.assertFalse(res['isError'], res)
        draft_id = res['structuredContent']['draft_id']
        bob = self.user('bob', level=2)
        for client in (self.alice, bob):
            listed = client.get('/api/objects').json()['data']
            self.assertNotIn('Agent 起草的帖子', json.dumps(listed, ensure_ascii=False))
            self.assertEqual(client.get('/api/search', params={'q': '草稿词'}).json()['data'], [])
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM object_head').fetchone()[0], 0)
        self.assertEqual(bob.post(f'/api/agents/drafts/{draft_id}/confirm', headers=HDRS).status_code, 404)
        pending = self.alice.get('/api/agents/drafts').json()['data']
        self.assertEqual([d['id'] for d in pending], [draft_id])
        r = self.alice.post(f'/api/agents/drafts/{draft_id}/confirm', headers=HDRS, json={'title': '主人改过的标题'})
        self.assertEqual(r.status_code, 200, r.text)
        object_id = r.json()['data']['object_id']
        detail = bob.get(f'/api/objects/{object_id}').json()['data']
        self.assertEqual(detail['title'], '主人改过的标题')
        self.assertEqual(detail['author']['id'], self.alice.pid)
        self.assertIn('Agent 协助', detail['content']['tags'])
        mark = bob.get(f'/api/agents/assisted/{object_id}').json()['data']
        self.assertTrue(mark['assisted'])
        self.assertEqual(mark['agent']['name'], '小助手')
        self.assertEqual(self.alice.post(f'/api/agents/drafts/{draft_id}/confirm', headers=HDRS).status_code, 409)

    def test_reply_draft_and_discard(self):
        self.set_flag('agents.write.enabled', True)
        post = self.obj(self.alice, title='我的问题')
        res = self.call(self.tok, 'draft_reply', target_id=post['id'], body='替主人补充一句')
        draft_id = res['structuredContent']['draft_id']
        bob = self.user('bob', level=2)
        hidden = self.obj(bob, title='只给鲍勃自己', visibility='named', acl=[bob.pid])
        res = self.call(self.tok, 'draft_reply', target_id=hidden['id'], body='x')
        self.assertTrue(res['isError'])
        self.assertEqual(res['structuredContent']['error']['code'], 'resource_not_found')
        r = self.alice.post(f'/api/agents/drafts/{draft_id}/discard', headers=HDRS)
        self.assertEqual(r.json()['data']['status'], 'discarded')
        self.assertEqual(self.alice.get('/api/agents/drafts').json()['data'], [])

    def test_draft_notification_for_owner(self):
        self.set_flag('agents.write.enabled', True)
        self.call(self.tok, 'draft_post', title='待确认', body='正文')
        res = self.call(self.tok, 'my_notifications')
        self.assertEqual(res['structuredContent']['counts']['pending_drafts'], 1)


class McpTest(AgentCase):
    def setUp(self):
        super().setUp()
        _, self.tok = self.token()

    def test_initialize(self):
        r = self.rpc(self.tok, 'initialize', {'protocolVersion': '2025-03-26', 'capabilities': {},
                                              'clientInfo': {'name': 't', 'version': '1'}})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body['jsonrpc'], '2.0')
        self.assertEqual(body['id'], 1)
        self.assertEqual(body['result']['protocolVersion'], '2025-03-26')
        self.assertIn('tools', body['result']['capabilities'])
        self.assertEqual(body['result']['serverInfo']['name'], 'vanguard-commons')
        r = self.rpc(self.tok, 'initialize', {'protocolVersion': '1999-01-01'}, msg_id='a')
        self.assertEqual(r.json()['result']['protocolVersion'], '2025-06-18')
        self.assertEqual(r.json()['id'], 'a')

    def test_notification_gets_202(self):
        r = self.rpc(self.tok, 'notifications/initialized', msg_id=None)
        self.assertEqual(r.status_code, 202)
        self.assertEqual(r.content, b'')

    def test_tools_list_shape(self):
        tools = self.rpc(self.tok, 'tools/list').json()['result']['tools']
        names = [t['name'] for t in tools]
        for name in ('whats_new', 'search_knowledge', 'search_solved', 'hot_today', 'trends', 'list_bounties',
                     'my_notifications'):
            self.assertIn(name, names)
        for t in tools:
            self.assertEqual(t['inputSchema']['type'], 'object')
            self.assertFalse(t['inputSchema']['additionalProperties'])
            self.assertIn(' / ', t['description'])
            self.assertTrue(t['annotations']['readOnlyHint'])
            for prop in t['inputSchema']['properties'].values():
                if prop.get('type') == 'integer':
                    self.assertLessEqual(prop['maximum'], 20)

    def test_tools_call_shape(self):
        res = self.call(self.tok, 'whats_new')
        self.assertFalse(res['isError'])
        self.assertEqual(res['content'][0]['type'], 'text')
        self.assertTrue(res['content'][0]['text'].startswith('自 '))
        self.assertIn('sections', res['structuredContent'])
        first_until = res['structuredContent']['until']
        second = self.call(self.tok, 'whats_new')['structuredContent']
        self.assertEqual(second['since'], first_until)

    def test_protocol_errors(self):
        c = self.bare()
        h = self.bearer(self.tok)
        r = c.post('/api/agents/mcp', content=b'{not json', headers={**h, 'Content-Type': 'application/json'})
        self.assertEqual((r.status_code, r.json()['error']['code']), (400, -32700))
        self.assertIsNone(r.json()['id'])
        r = c.post('/api/agents/mcp', json=[{'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}], headers=h)
        self.assertEqual((r.status_code, r.json()['error']['code']), (400, -32600))
        r = c.post('/api/agents/mcp', json={'jsonrpc': '1.0', 'id': 1, 'method': 'ping'}, headers=h)
        self.assertEqual(r.json()['error']['code'], -32600)
        r = c.post('/api/agents/mcp', json={'jsonrpc': '2.0', 'id': True, 'method': 'ping'}, headers=h)
        self.assertEqual(r.json()['error']['code'], -32600)
        r = self.rpc(self.tok, 'resources/list')
        self.assertEqual((r.status_code, r.json()['error']['code']), (200, -32601))
        r = self.rpc(self.tok, 'tools/call', {'name': 'drop_tables', 'arguments': {}})
        self.assertEqual(r.json()['error']['code'], -32602)
        r = self.rpc(self.tok, 'tools/call', {'name': 'search_knowledge', 'arguments': {'limit': 3}})
        self.assertEqual(r.json()['error']['code'], -32602)
        self.assertEqual(r.json()['error']['data']['fields'][0]['loc'], ['query'])
        r = self.rpc(self.tok, 'tools/call', {'name': 'hot_today', 'arguments': {'bogus': 1}})
        self.assertEqual(r.json()['error']['code'], -32602)
        r = self.rpc(self.tok, 'ping', headers={'MCP-Protocol-Version': '1999-01-01'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.rpc(self.tok, 'ping').json()['result'], {})

    def test_unauthenticated(self):
        r = self.rpc(None, 'tools/list')
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json()['error']['code'], -32001)
        self.assertEqual(r.json()['jsonrpc'], '2.0')
        self.assertIn('Bearer', r.headers['WWW-Authenticate'])
        r = self.rpc('vca_' + 'x' * 43, 'tools/list')
        self.assertEqual(r.status_code, 401)
        r = self.bare().post('/api/agents/mcp', json={'jsonrpc': '2.0', 'id': 1, 'method': 'ping'},
                             headers={**self.bearer(self.tok), 'Origin': 'https://evil.test'})
        self.assertEqual(r.status_code, 403)

    def test_get_on_mcp_is_405(self):
        r = self.bare().get('/api/agents/mcp', headers=self.bearer(self.tok, csrf=False))
        self.assertEqual(r.status_code, 405)

    def test_post_needs_csrf_until_core_patch(self):
        r = self.bare().post('/api/agents/mcp', json={'jsonrpc': '2.0', 'id': 1, 'method': 'ping'},
                             headers=self.bearer(self.tok, csrf=False))
        self.assertIn(r.status_code, (200, 403))
        if r.status_code == 200:  # 主控应用 [AGENT-1] 核心补丁之后
            self.assertEqual(r.json()['result'], {})


class HotAndTrendsTest(AgentCase):
    def seed_feed(self):
        from modules.feed import service
        from engine.feed.tests._common import item
        now = clock.now()
        items = [item('openai', 'OpenAI 发布新的推理模型 o9', now), item('simon', 'OpenAI 发布新的推理模型 o9 解读', now)]
        with self.db.write() as conn:
            service.ingest_items(conn, items, now)
            service.cluster_pending(conn, now)

    def test_hot_today_has_no_member_content(self):
        bob = self.user('bob', level=2)
        self.obj(bob, title='成员讨论：推理模型 o9 体验', content={'body': '推理模型 o9 OpenAI'})
        self.seed_feed()
        _, token = self.token()
        r = self.rest(token, 'hot_today')
        self.assertEqual(r.status_code, 200, r.text)
        events = r.json()['data']['events']
        self.assertTrue(events)
        self.assertNotIn('related', events[0])
        self.assertTrue(events[0]['sources'])
        self.assertTrue(all(s['url'] is None or s['url'].startswith('http') for s in events[0]['sources']))
        self.assertNotIn('成员讨论', json.dumps(r.json(), ensure_ascii=False))
        trends = self.rest(token, 'trends').json()['data']
        self.assertTrue(trends['hot_by_direction'])
        self.assertIsNone(trends['reviewed_dataset'])


class OwnerApiTest(AgentCase):
    def test_catalog_and_mine(self):
        cat = self.bare().get('/api/agents/catalog').json()['data']
        self.assertEqual([p['id'] for p in cat['presets']], ['read', 'draft', 'plaza'])
        self.assertFalse(cat['flags']['agents.read_member_content'])
        self.assertFalse(cat['flags']['agents.write.enabled'])
        agent = self.make_agent(name='Hermes 小管家', model_family='hermes', client='hermes', palette='mint',
                                abilities=['RAG', '日报'])
        self.assertEqual(agent['palette'], 'mint')
        r = self.alice.patch(f'/api/agents/{agent["id"]}', headers=HDRS, json={'name': '改名了', 'palette': 'night-sky'})
        self.assertEqual(r.json()['data']['name'], '改名了')
        prof = self.db.conn().execute('SELECT display_name, avatar_ref FROM profile WHERE principal_id = ?',
                                      (agent['id'],)).fetchone()
        self.assertEqual((prof['display_name'], prof['avatar_ref']), ('改名了', 'panda:night-sky'))
        mine = self.alice.get('/api/agents/mine').json()['data']
        self.assertEqual(mine['limits']['max_agents'], 3)
        self.assertEqual(mine['agents'][0]['name'], '改名了')

    def test_validation(self):
        r = self.alice.post('/api/agents', headers=HDRS, json={'name': '', 'palette': 'yellow'})
        self.assertEqual(r.status_code, 422)
        r = self.alice.post('/api/agents', headers=HDRS, json={'name': 'x', 'abilities': ['一' * 17]})
        self.assertEqual(r.status_code, 422)
        agent = self.make_agent()
        r = self.alice.post(f'/api/agents/{agent["id"]}/tokens', headers=HDRS, json={'preset': 'read', 'scopes': ['me.read']})
        self.assertEqual(r.status_code, 422)
        self.issue(agent['id'], status=422, expires_in_days=400)

    def test_export_includes_agents_without_secrets(self):
        agent_id, token = self.token()
        data = self.alice.get('/api/me/export').json()['data']
        self.assertEqual(data['agents']['agents'][0]['id'], agent_id)
        text = json.dumps(data, ensure_ascii=False)
        self.assertNotIn(token, text)
        self.assertNotIn('token_hash', text)


if __name__ == '__main__':
    unittest.main()
