import uuid
from datetime import datetime, timezone
from unittest import mock

from app import authz, clock, flags
from app.authz import Actor
from app.errors import ApiError
from modules.agentchat import bridge, service
from tests.helpers import HDRS, AppCase

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc).timestamp()
LOBBY = '3c0a0001-0000-4000-8000-agentchat0001'
CODING = '3c0a0001-0000-4000-8000-agentchat0002'
MISSING = '3c0a0001-0000-4000-8000-agentchatdead'


class StubAuth:
    def __init__(self, tokens, owners):
        self.tokens = tokens
        self.owners = owners

    def actor_from_bearer(self, conn, token, required_scope):
        rec = self.tokens.get(token)
        if rec is None:
            raise ApiError('unauthenticated')
        scopes = rec['scopes']
        if required_scope and required_scope not in scopes:
            raise ApiError('action_not_allowed')
        row = conn.execute(
            'SELECT p.id, p.kind, p.status, pr.level FROM principal p '
            'JOIN profile pr ON pr.principal_id = p.id WHERE p.id = ?',
            (rec['id'],)).fetchone()
        if row is None or row['status'] != 'active':
            raise ApiError('unauthenticated')
        return Actor(id=row['id'], level=row['level'], roles=frozenset(), status=row['status'],
                     kind=row['kind'])

    def owner_of(self, conn, principal_id):
        if principal_id in self.owners:
            return self.owners[principal_id]
        row = conn.execute('SELECT kind FROM principal WHERE id = ?', (principal_id,)).fetchone()
        if row and row['kind'] == 'human':
            return principal_id
        return None


class AgentChatCase(AppCase):
    def setUp(self):
        self.now = NOW
        patcher = mock.patch('app.clock.now_ts', side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()
        self.owners = {}
        self.tokens = {}
        self.stub = StubAuth(self.tokens, self.owners)
        bridge.install(auth=self.stub, owners=self.stub.owner_of)
        self.addCleanup(bridge.reset)

    def member(self, handle, level=2, roles=()):
        return self.user(handle, level=level, roles=roles)

    def agent(self, handle, owner, level=None):
        pid = str(uuid.uuid4())
        now = clock.now()
        if level is None:
            lv = self.db.conn().execute(
                'SELECT level FROM profile WHERE principal_id = ?', (owner.pid,)).fetchone()[0]
        else:
            lv = level
        with self.db.write() as conn:
            conn.execute("INSERT INTO principal (id, kind, status, created_at) VALUES (?, 'agent', 'active', ?)",
                         (pid, now))
            conn.execute(
                'INSERT INTO profile (principal_id, display_name, level, level_source, level_updated_at, updated_at) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                (pid, handle, lv, 'agent', now, now))
        self.owners[pid] = owner.pid
        return pid

    def token(self, agent_id, name, scopes=('agents.plaza.speak',)):
        self.tokens[name] = {'id': agent_id, 'scopes': set(scopes)}
        return name

    def headers(self, token=None):
        h = dict(HDRS)
        if token:
            h['Authorization'] = f'Bearer {token}'
        return h

    def post_msg(self, client, channel, body, token=None, mentions=None, status=201):
        payload = {'body': body}
        if mentions:
            payload['mentions'] = mentions
        r = client.post(f'/api/agentchat/channels/{channel}/messages',
                        headers=self.headers(token), json=payload)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status < 400 else r.json()


class FlagAndAuthTest(AgentChatCase):
    def test_disabled_module_is_501(self):
        human = self.member('reader')
        with self.db.write() as conn:
            flags.set_flag(conn, 'agentchat.enabled', False, None)
        r = human.get('/api/agentchat/channels')
        self.assertEqual(r.status_code, 501)
        self.assertEqual(self.code(r), 'capability_unavailable')

    def test_anonymous_is_401(self):
        r = self.client().get('/api/agentchat/channels')
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.code(r), 'unauthenticated')

    def test_webhook_flag_default_off_and_unused(self):
        human = self.member('flagger')
        r = human.get('/api/agentchat/flags')
        self.assertEqual(r.status_code, 200)
        data = r.json()['data']
        self.assertTrue(data['enabled'])
        self.assertFalse(data['webhook_enabled'])
        channels = human.get('/api/agentchat/channels').json()['data']
        self.assertFalse(channels['webhook_enabled'])


class TurnAndHourlyTest(AgentChatCase):
    def test_six_agent_turns_then_wait_for_human(self):
        owner = self.member('host', level=3)
        peer = self.member('peer', level=3)
        a1 = self.agent('ink', owner)
        a2 = self.agent('mist', peer)
        t1 = self.token(a1, 'speak-ink')
        t2 = self.token(a2, 'speak-mist')
        c = owner
        for i in range(3):
            self.post_msg(c, LOBBY, f'ink-{i}', token=t1)
            self.post_msg(c, LOBBY, f'mist-{i}', token=t2)
        blocked = c.post(f'/api/agentchat/channels/{LOBBY}/messages',
                         headers=self.headers(t1), json={'body': '第七轮'})
        self.assertEqual(blocked.status_code, 409, blocked.text)
        self.assertEqual(self.code(blocked), 'state_conflict')
        self.assertIn('等人类接话', blocked.json()['error']['message'])
        ch = c.get(f'/api/agentchat/channels/{LOBBY}').json()['data']
        self.assertTrue(ch['waiting_human'])
        self.assertEqual(ch['streak'], 6)
        self.post_msg(owner, LOBBY, '人来接话了')
        self.post_msg(c, LOBBY, '可以继续', token=t1)
        ch = c.get(f'/api/agentchat/channels/{LOBBY}').json()['data']
        self.assertFalse(ch['waiting_human'])
        self.assertEqual(ch['streak'], 1)

    def test_hourly_cap_by_owner_level_is_429(self):
        owner = self.member('meter', level=2)
        aid = self.agent('capbot', owner)
        tok = self.token(aid, 'speak-cap')
        with self.db.write() as conn:
            for i in range(20):
                conn.execute(
                    'INSERT INTO chat_message (id, channel_id, author_id, author_kind, body, mentions_json, '
                    'status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    (str(uuid.uuid4()), LOBBY, aid, 'agent', f'n{i}', '[]', 'ok', clock.now()))
        r = owner.post(f'/api/agentchat/channels/{LOBBY}/messages',
                       headers=self.headers(tok), json={'body': '第 21 条'})
        self.assertEqual(r.status_code, 429, r.text)
        self.assertEqual(self.code(r), 'rate_limited')
        self.assertTrue(r.headers.get('Retry-After'))
        self.assertIn('retry_after_seconds', r.json()['error'])
        self.now = NOW + 3601
        self.post_msg(owner, LOBBY, '新窗口可以发', token=tok)


class MuteAndDmTest(AgentChatCase):
    def test_owner_mute_blocks_agent_post(self):
        owner = self.member('keeper', level=3)
        aid = self.agent('quiet', owner)
        tok = self.token(aid, 'speak-quiet')
        r = owner.post(f'/api/agentchat/agents/{aid}/mute', headers=HDRS,
                       json={'kind': 'mute', 'muted': True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()['data']['muted'])
        blocked = owner.post(f'/api/agentchat/channels/{LOBBY}/messages',
                             headers=self.headers(tok), json={'body': '不该发出'})
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(self.code(blocked), 'action_not_allowed')
        owner.post(f'/api/agentchat/agents/{aid}/mute', headers=HDRS,
                   json={'kind': 'mute', 'muted': False})
        self.post_msg(owner, LOBBY, '解除后可以', token=tok)

    def test_stranger_cannot_mute(self):
        owner = self.member('own', level=3)
        other = self.member('nosy', level=4)
        aid = self.agent('mine', owner)
        r = other.post(f'/api/agentchat/agents/{aid}/mute', headers=HDRS,
                       json={'kind': 'mute', 'muted': True})
        self.assertEqual(r.status_code, 403)
        gov = self.member('gov', level=2, roles=('governor',))
        r = gov.post(f'/api/agentchat/agents/{aid}/mute', headers=HDRS,
                     json={'kind': 'offline', 'muted': True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()['data']['offline'])

    def test_dm_visible_to_owners_hidden_from_others(self):
        alice = self.member('alice', level=3)
        bob = self.member('bob', level=3)
        stranger = self.member('eve', level=4)
        a1 = self.agent('one', alice)
        a2 = self.agent('two', bob)
        t1 = self.token(a1, 'speak-one')
        opened = alice.post('/api/agentchat/dms', headers=self.headers(t1), json={'peer_id': a2})
        self.assertEqual(opened.status_code, 200, opened.text)
        dm_id = opened.json()['data']['id']
        self.post_msg(alice, dm_id, '两台 Agent 对谈', token=t1, mentions=[a2])
        for who in (alice, bob):
            r = who.get(f'/api/agentchat/channels/{dm_id}')
            self.assertEqual(r.status_code, 200, r.text)
            msgs = who.get(f'/api/agentchat/channels/{dm_id}/messages').json()['data']['items']
            self.assertEqual(len(msgs), 1)
            self.assertEqual(msgs[0]['body'], '两台 Agent 对谈')
        hidden = stranger.get(f'/api/agentchat/channels/{dm_id}')
        self.assertEqual(hidden.status_code, 404)
        self.assertEqual(self.code(hidden), 'resource_not_found')
        hidden_msgs = stranger.get(f'/api/agentchat/channels/{dm_id}/messages')
        self.assertEqual(hidden_msgs.status_code, 404)
        self.assertEqual(self.code(hidden_msgs), hidden.json()['error']['code'])

    def test_human_human_dm_rejected(self):
        a = self.member('left')
        b = self.member('right')
        r = a.post('/api/agentchat/dms', headers=HDRS, json={'peer_id': b.pid})
        self.assertEqual(r.status_code, 422)


class VisibilityAndInboxTest(AgentChatCase):
    def test_missing_channel_is_404(self):
        human = self.member('seeker')
        r = human.get(f'/api/agentchat/channels/{MISSING}')
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.code(r), 'resource_not_found')
        r = human.get(f'/api/agentchat/channels/{MISSING}/messages')
        self.assertEqual(r.status_code, 404)

    def test_inbox_requires_speak_scope_token(self):
        owner = self.member('mail', level=3)
        aid = self.agent('box', owner)
        speak = self.token(aid, 'speak-box')
        readonly = self.token(aid, 'read-box', scopes=('agents.read',))
        owner.post(f'/api/agentchat/channels/{CODING}/messages', headers=HDRS,
                   json={'body': '@box 看一下', 'mentions': [aid]})
        none = self.client().get('/api/agentchat/inbox')
        self.assertEqual(none.status_code, 401)
        # R17-D：成员用会话登录也能读自己的收件箱（只看被 @ 到自己的消息，不看 Agent 的）
        cookie_only = owner.get('/api/agentchat/inbox')
        self.assertEqual(cookie_only.status_code, 200, cookie_only.text)
        self.assertEqual(cookie_only.json()['data']['items'], [])
        denied = owner.get('/api/agentchat/inbox', headers=self.headers(readonly))
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(self.code(denied), 'action_not_allowed')
        ok = owner.get('/api/agentchat/inbox', headers=self.headers(speak))
        self.assertEqual(ok.status_code, 200, ok.text)
        items = ok.json()['data']['items']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['mentions'], [aid])

    def test_seeded_channels_and_human_post(self):
        human = self.member('talk', level=2)
        data = human.get('/api/agentchat/channels').json()['data']
        slugs = {c['slug'] for c in data['channels']}
        self.assertEqual(slugs, {'lobby', 'coding', 'platform', 'design'})
        posted = self.post_msg(human, LOBBY, '人先问一句')
        self.assertEqual(posted['item']['author_kind'], 'human')
        self.assertEqual(posted['item']['status'], 'ok')
        page = human.get(f'/api/agentchat/channels/{LOBBY}/messages').json()['data']
        self.assertEqual(len(page['items']), 1)
        self.assertEqual(page['items'][0]['body'], '人先问一句')

    def test_governance_timeout_goes_pending(self):
        human = self.member('govhook')

        def boom(*args, **kwargs):
            raise TimeoutError('moderation timeout')

        bridge.install(auth=self.stub, owners=self.stub.owner_of, screen=boom)
        posted = self.post_msg(human, LOBBY, '超时进待审')
        self.assertEqual(posted['item']['status'], 'pending_review')
        other = self.member('other')
        items = other.get(f'/api/agentchat/channels/{LOBBY}/messages').json()['data']['items']
        self.assertEqual(items[0]['status'], 'hidden')
        self.assertEqual(items[0]['body'], '')
        mine = human.get(f'/api/agentchat/channels/{LOBBY}/messages').json()['data']['items']
        self.assertEqual(mine[0]['status'], 'pending_review')
        self.assertEqual(mine[0]['body'], '超时进待审')


class RuleSeedTest(AgentChatCase):
    def test_only_agentchat_actions_seeded(self):
        rows = self.db.conn().execute(
            "SELECT action FROM action_rule WHERE action LIKE 'agentchat.%' ORDER BY action").fetchall()
        self.assertEqual([r[0] for r in rows], [
            'agentchat.mute', 'agentchat.mute.any', 'agentchat.post', 'agentchat.read', 'agentchat.report',
            'agentchat.speak'])
        self.assertTrue(authz.can(self.db.conn(), Actor(id='x', level=1, status='active'), 'agentchat.read'))
