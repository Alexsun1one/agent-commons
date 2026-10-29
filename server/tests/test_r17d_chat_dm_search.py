"""R17-D · 私信与 Agent 聊天：会话收件箱、撤回/编辑/举报、@ 补全接口、Agent 下线。"""
from datetime import datetime, timezone
from unittest import mock

from app import outbox
from modules.agentchat.tests.test_agentchat import (CODING, LOBBY, AgentChatCase, NOW as CHAT_NOW)
from modules.dm.tests.test_dm import DmCase
from tests.helpers import HDRS, AppCase


class InboxBySessionTest(AgentChatCase):
    def test_member_sees_only_messages_that_mention_them(self):
        asker = self.member('asker', level=2)
        reader = self.member('reader', level=2)
        bystander = self.member('bystander', level=2)
        asker.post(f'/api/agentchat/channels/{LOBBY}/messages', headers=HDRS,
                   json={'body': '@reader 来看一眼', 'mentions': [reader.pid]})
        asker.post(f'/api/agentchat/channels/{LOBBY}/messages', headers=HDRS, json={'body': '没人被提到'})
        got = reader.get('/api/agentchat/inbox')
        self.assertEqual(got.status_code, 200, got.text)
        items = got.json()['data']['items']
        self.assertEqual([i['body'] for i in items], ['@reader 来看一眼'])
        self.assertEqual(items[0]['channel_title'], '大厅')
        self.assertEqual(bystander.get('/api/agentchat/inbox').json()['data']['items'], [])
        self.assertEqual(self.client().get('/api/agentchat/inbox').status_code, 401)

    def test_pending_review_of_someone_else_is_not_in_inbox(self):
        asker = self.member('asker2', level=2)
        reader = self.member('reader2', level=2)
        from modules.agentchat import bridge
        bridge.install(auth=self.stub, owners=self.stub.owner_of, screen=lambda *a, **k: 'pending_review')
        asker.post(f'/api/agentchat/channels/{LOBBY}/messages', headers=HDRS,
                   json={'body': '待审的话', 'mentions': [reader.pid]})
        self.assertEqual(reader.get('/api/agentchat/inbox').json()['data']['items'], [])

    def test_owner_reads_own_agent_inbox_stranger_gets_404(self):
        owner = self.member('boxowner', level=3)
        stranger = self.member('boxstranger', level=3)
        aid = self.agent('mailbot', owner)
        owner.post(f'/api/agentchat/channels/{CODING}/messages', headers=HDRS,
                   json={'body': '@mailbot 在吗', 'mentions': [aid]})
        mine = owner.get('/api/agentchat/inbox', params={'agent_id': aid})
        self.assertEqual(mine.status_code, 200, mine.text)
        self.assertEqual(len(mine.json()['data']['items']), 1)
        self.assertEqual(owner.get('/api/agentchat/inbox').json()['data']['items'], [])
        denied = stranger.get('/api/agentchat/inbox', params={'agent_id': aid})
        self.assertEqual(denied.status_code, 404)

    def test_inbox_pages_with_cursor(self):
        asker = self.member('pager', level=2)
        reader = self.member('pagee', level=2)
        for i in range(3):
            self.now += 1
            asker.post(f'/api/agentchat/channels/{LOBBY}/messages', headers=HDRS,
                       json={'body': f'第 {i} 条', 'mentions': [reader.pid]})
        first = reader.get('/api/agentchat/inbox', params={'limit': 2}).json()
        self.assertEqual(len(first['data']['items']), 2)
        cursor = first['meta']['cursor']
        self.assertTrue(cursor)
        rest = reader.get('/api/agentchat/inbox', params={'limit': 2, 'cursor': cursor}).json()
        self.assertEqual(len(rest['data']['items']), 1)


class MessageActionsTest(AgentChatCase):
    def _say(self, client, body='原话', token=None):
        return self.post_msg(client, LOBBY, body, token=token)['item']

    def test_author_edits_within_two_minutes(self):
        me = self.member('editor1', level=2)
        item = self._say(me)
        self.now += 60
        r = me.patch(f"/api/agentchat/messages/{item['id']}", headers=HDRS, json={'body': '改过的话'})
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()['data']
        self.assertEqual(data['body'], '改过的话')
        self.assertTrue(data['edited_at'])
        listed = me.get(f'/api/agentchat/channels/{LOBBY}/messages').json()['data']['items']
        self.assertEqual(listed[0]['body'], '改过的话')

    def test_edit_rules(self):
        me = self.member('editor2', level=2)
        other = self.member('editor3', level=2)
        item = self._say(me)
        url = f"/api/agentchat/messages/{item['id']}"
        self.assertEqual(other.patch(url, headers=HDRS, json={'body': '偷改'}).status_code, 403)
        same = me.patch(url, headers=HDRS, json={'body': '原话'})
        self.assertEqual(same.status_code, 422)
        self.assertEqual(me.patch(url, headers=HDRS, json={'body': '   '}).status_code, 422)
        self.assertEqual(me.patch('/api/agentchat/messages/nope', headers=HDRS, json={'body': 'x'}).status_code, 404)
        self.now += 121
        late = me.patch(url, headers=HDRS, json={'body': '太晚了'})
        self.assertEqual(late.status_code, 409)
        self.assertIn('2 分钟', late.json()['error']['message'])

    def test_recall_hides_body_and_cannot_edit_afterwards(self):
        me = self.member('recaller', level=2)
        other = self.member('watcher', level=2)
        item = self._say(me, '说错了')
        url = f"/api/agentchat/messages/{item['id']}/recall"
        self.assertEqual(other.post(url, headers=HDRS).status_code, 403)
        r = me.post(url, headers=HDRS)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['status'], 'deleted')
        for who in (me, other):
            rows = who.get(f'/api/agentchat/channels/{LOBBY}/messages').json()['data']['items']
            self.assertEqual(rows[0]['status'], 'deleted')
            self.assertEqual(rows[0]['body'], '')
        again = me.post(url, headers=HDRS)
        self.assertEqual(again.status_code, 409)
        edit = me.patch(f"/api/agentchat/messages/{item['id']}", headers=HDRS, json={'body': '复活'})
        self.assertEqual(edit.status_code, 409)

    def test_recall_after_two_minutes_is_rejected(self):
        me = self.member('latecaller', level=2)
        item = self._say(me)
        self.now += 130
        r = me.post(f"/api/agentchat/messages/{item['id']}/recall", headers=HDRS)
        self.assertEqual(r.status_code, 409)

    def test_edit_goes_through_screening_again(self):
        from modules.agentchat import bridge
        me = self.member('rescreen', level=2)
        item = self._say(me)
        bridge.install(auth=self.stub, owners=self.stub.owner_of, screen=lambda *a, **k: 'pending_review')
        r = me.patch(f"/api/agentchat/messages/{item['id']}", headers=HDRS, json={'body': '换成待审'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['status'], 'pending_review')
        other = self.member('rescreen2', level=2)
        shown = other.get(f'/api/agentchat/channels/{LOBBY}/messages').json()['data']['items'][0]
        self.assertEqual(shown['status'], 'hidden')
        self.assertEqual(shown['body'], '')

    def test_agent_can_edit_own_but_not_when_muted(self):
        owner = self.member('agentowner', level=3)
        aid = self.agent('editbot', owner)
        tok = self.token(aid, 'speak-editbot')
        item = self._say(owner, '人先说', token=None)
        spoken = self.post_msg(owner, LOBBY, 'agent 说', token=tok)['item']
        url = f"/api/agentchat/messages/{spoken['id']}"
        ok = owner.patch(url, headers=self.headers(tok), json={'body': 'agent 改'})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(owner.patch(f"/api/agentchat/messages/{item['id']}", headers=self.headers(tok),
                                     json={'body': '改别人的'}).status_code, 403)
        owner.post(f'/api/agentchat/agents/{aid}/mute', headers=HDRS, json={'kind': 'mute', 'muted': True})
        blocked = owner.patch(url, headers=self.headers(tok), json={'body': '静音后还想改'})
        self.assertEqual(blocked.status_code, 403)

    def test_report_message(self):
        author = self.member('reported', level=2)
        reporter = self.member('reporter', level=2)
        item = self._say(author, '不太合适的话')
        url = f"/api/agentchat/messages/{item['id']}/report"
        self.assertEqual(author.post(url, headers=HDRS, json={'reason': '我自己报自己'}).status_code, 409)
        self.assertEqual(reporter.post(url, headers=HDRS, json={'reason': '短'}).status_code, 422)
        r = reporter.post(url, headers=HDRS, json={'reason': '广告刷屏'})
        self.assertEqual(r.status_code, 201, r.text)
        row = self.db.conn().execute('SELECT * FROM chat_report WHERE message_id = ?', (item['id'],)).fetchone()
        self.assertEqual(row['reporter_id'], reporter.pid)
        self.assertIn('不太合适的话', row['snapshot_json'])
        event = self.db.conn().execute(
            "SELECT payload_json FROM outbox_event WHERE event_type = 'agentchat.reported'").fetchone()
        self.assertIn('广告刷屏', event['payload_json'])
        dup = reporter.post(url, headers=HDRS, json={'reason': '又报一次'})
        self.assertEqual(dup.status_code, 409)
        self.assertEqual(reporter.post('/api/agentchat/messages/nope/report', headers=HDRS,
                                       json={'reason': '不存在的'}).status_code, 404)

    def test_report_is_hidden_from_non_participants_and_agents(self):
        a = self.member('dmowner', level=3)
        b = self.member('dmpeer', level=3)
        eve = self.member('dmeve', level=4)
        a1 = self.agent('dmbot1', a)
        a2 = self.agent('dmbot2', b)
        t1 = self.token(a1, 'speak-dmbot1')
        dm = a.post('/api/agentchat/dms', headers=self.headers(t1), json={'peer_id': a2}).json()['data']['id']
        msg = self.post_msg(a, dm, '私下对谈', token=t1)['item']
        url = f"/api/agentchat/messages/{msg['id']}/report"
        self.assertEqual(eve.post(url, headers=HDRS, json={'reason': '偷看并举报'}).status_code, 404)
        self.assertEqual(a.post(url, headers=self.headers(t1), json={'reason': 'agent 不能举报'}).status_code, 403)
        self.assertEqual(b.post(url, headers=HDRS, json={'reason': '对方的主人可以举报'}).status_code, 201)

    def test_hidden_message_cannot_be_reported(self):
        from modules.agentchat import bridge
        author = self.member('hiddenone', level=2)
        reporter = self.member('hiddentwo', level=2)
        bridge.install(auth=self.stub, owners=self.stub.owner_of, screen=lambda *a, **k: 'pending_review')
        item = self._say(author)
        r = reporter.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS, json={'reason': '我看不到它'})
        self.assertEqual(r.status_code, 404)

    def test_exporter_includes_reports(self):
        from app import accounts
        author = self.member('exp1', level=2)
        reporter = self.member('exp2', level=2)
        item = self._say(author)
        reporter.post(f"/api/agentchat/messages/{item['id']}/report", headers=HDRS, json={'reason': '导出里要有'})
        from app.authz import Actor
        actor = Actor(id=reporter.pid, level=2, status='active')
        exported = accounts.EXPORTERS['agentchat'](self.db.conn(), actor)
        self.assertEqual([r['reason'] for r in exported['reports']], ['导出里要有'])


class AgentOfflineTest(AgentChatCase):
    def test_owner_offline_blocks_posting_and_shows_in_agent_list(self):
        owner = self.member('offowner', level=3)
        aid = self.agent('sleepybot', owner)
        tok = self.token(aid, 'speak-sleepy')
        r = owner.post(f'/api/agentchat/agents/{aid}/mute', headers=HDRS, json={'kind': 'offline', 'muted': True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()['data']['offline'])
        self.assertFalse(r.json()['data']['muted'])
        listed = owner.get('/api/agentchat/agents').json()['data']['items']
        self.assertTrue([a for a in listed if a['id'] == aid][0]['offline'])
        blocked = owner.post(f'/api/agentchat/channels/{LOBBY}/messages', headers=self.headers(tok),
                             json={'body': '下线了还说话'})
        self.assertEqual(blocked.status_code, 403)
        owner.post(f'/api/agentchat/agents/{aid}/mute', headers=HDRS, json={'kind': 'offline', 'muted': False})
        self.post_msg(owner, LOBBY, '重新上线', token=tok)


class DmEditTest(DmCase):
    def _pair(self):
        sender = self.user('dmedit_a', level=2)
        recipient = self.user('dmedit_b', level=2)
        thread = self.open(sender, recipient, accepted=True)
        return sender, recipient, thread

    def test_sender_edits_text_within_window(self):
        sender, recipient, thread = self._pair()
        sent = self.send(sender, thread['id'], '原来的话').json()['data']
        self.now += 90
        r = sender.patch(f"/api/dm/messages/{sent['id']}", headers=HDRS, json={'text': '改后的话'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['text'], '改后的话')
        self.assertTrue(r.json()['data']['edited_at'])
        seen = recipient.get(f"/api/dm/threads/{thread['id']}/messages").json()['data']['items'][-1]
        self.assertEqual(seen['text'], '改后的话')
        self.assertTrue(seen['edited_at'])

    def test_edit_rules(self):
        sender, recipient, thread = self._pair()
        sent = self.send(sender, thread['id'], '原来的话').json()['data']
        url = f"/api/dm/messages/{sent['id']}"
        self.assertEqual(recipient.patch(url, headers=HDRS, json={'text': '替人改'}).status_code, 403)
        self.assertEqual(sender.patch(url, headers=HDRS, json={'text': '原来的话'}).status_code, 422)
        self.assertEqual(sender.patch(url, headers=HDRS, json={'text': ' '}).status_code, 422)
        sticker = self.send(sender, thread['id'], '', sticker_ref='assets/mascot/panda-wave.webp')
        self.assertEqual(sticker.status_code, 201, sticker.text)
        sid = sticker.json()['data']['id']
        self.assertEqual(sender.patch(f'/api/dm/messages/{sid}', headers=HDRS, json={'text': '贴纸改字'}).status_code, 409)
        self.now += 121
        late = sender.patch(url, headers=HDRS, json={'text': '太晚'})
        self.assertEqual(late.status_code, 409)

    def test_recalled_message_cannot_be_edited(self):
        sender, _recipient, thread = self._pair()
        sent = self.send(sender, thread['id'], '要撤回的').json()['data']
        self.assertEqual(sender.post(f"/api/dm/messages/{sent['id']}/recall", headers=HDRS).status_code, 200)
        r = sender.patch(f"/api/dm/messages/{sent['id']}", headers=HDRS, json={'text': '撤回后改'})
        self.assertEqual(r.status_code, 409)

    def test_outsider_sees_404(self):
        sender, _recipient, thread = self._pair()
        eve = self.user('dmedit_eve', level=3)
        sent = self.send(sender, thread['id'], '私下的话').json()['data']
        self.assertEqual(eve.patch(f"/api/dm/messages/{sent['id']}", headers=HDRS, json={'text': 'x'}).status_code, 404)


class MemberSearchTest(AppCase):
    def setUp(self):
        super().setUp()
        self.me = self.user('searcher', level=2)
        self.ann = self.user('annabel', level=3)
        self.bob = self.user('annbob', level=1)
        with self.db.write() as conn:
            conn.execute("UPDATE profile SET display_name = ? WHERE principal_id = ?", ('安娜', self.ann.pid))
            conn.execute("UPDATE profile SET display_name = ? WHERE principal_id = ?", ('小鲍勃', self.bob.pid))

    def _names(self, **params):
        r = self.me.get('/api/search/members', params=params)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['data']['items']

    def test_matches_handle_prefix_and_display_name(self):
        by_handle = self._names(q='ann')
        self.assertEqual([i['handle'] for i in by_handle], ['annabel', 'annbob'])
        by_name = self._names(q='安娜')
        self.assertEqual([i['handle'] for i in by_name], ['annabel'])
        self.assertEqual(by_name[0]['kind'], 'human')

    def test_only_public_fields_and_no_self(self):
        item = self._names(q='ann')[0]
        self.assertEqual(set(item), {'id', 'kind', 'handle', 'display_name', 'level'})
        self.assertEqual(self._names(q='searcher'), [])

    def test_wildcards_are_literal_and_empty_query_is_empty(self):
        self.assertEqual(self._names(q='%'), [])
        self.assertEqual(self._names(q='_'), [])
        self.assertEqual(self._names(q=''), [])

    def test_blocked_members_are_left_out(self):
        with mock.patch('modules.search.router._blocked', side_effect=lambda conn, a, b: b == self.bob.pid):
            self.assertEqual([i['handle'] for i in self._names(q='ann')], ['annabel'])

    def test_inactive_members_are_left_out(self):
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'suspended' WHERE id = ?", (self.bob.pid,))
        self.assertEqual([i['handle'] for i in self._names(q='ann')], ['annabel'])

    def test_agents_have_no_handle_and_kind_filter_works(self):
        import uuid
        from app import clock
        aid = str(uuid.uuid4())
        now = clock.now()
        with self.db.write() as conn:
            conn.execute("INSERT INTO principal (id, kind, status, created_at) VALUES (?, 'agent', 'active', ?)", (aid, now))
            conn.execute('INSERT INTO profile (principal_id, display_name, level, level_source, level_updated_at, updated_at) '
                         'VALUES (?, ?, 2, ?, ?, ?)', (aid, 'annbot', 'agent', now, now))
            conn.execute("INSERT INTO agent_profile (principal_id, owner_id, name, created_at, updated_at) "
                         "VALUES (?, ?, 'annbot', ?, ?)", (aid, self.ann.pid, now, now))
        both = self._names(q='annbot')
        self.assertEqual([(i['kind'], i['handle']) for i in both], [('agent', None)])
        self.assertEqual(self._names(q='ann', kinds='agent')[0]['display_name'], 'annbot')
        self.assertEqual([i['kind'] for i in self._names(q='ann', kinds='human')], ['human', 'human'])
        bad = self.me.get('/api/search/members', params={'q': 'ann', 'kinds': 'robot'})
        self.assertEqual(bad.status_code, 422)

    def test_limit_login_and_rate_limit(self):
        self.assertEqual(self.client().get('/api/search/members', params={'q': 'ann'}).status_code, 401)
        self.assertEqual(self.me.get('/api/search/members', params={'q': 'ann', 'limit': 99}).status_code, 422)
        self.assertEqual(len(self._names(q='ann', limit=1)), 1)
        fresh = self.user('typist', level=2)
        with mock.patch('modules.search.router.MEMBERS_RATE_LIMIT', 2):
            self.assertEqual(fresh.get('/api/search/members', params={'q': 'ann'}).status_code, 200)
            self.assertEqual(fresh.get('/api/search/members', params={'q': 'ann'}).status_code, 200)
            r = fresh.get('/api/search/members', params={'q': 'ann'})
            self.assertEqual(r.status_code, 429)
