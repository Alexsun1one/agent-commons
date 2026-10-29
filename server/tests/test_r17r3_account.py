"""R17-R3：登录设备、令牌吊销、名片可见范围，以及 #/contribute 的真草稿。"""
import json
import time
import unittest
from pathlib import Path

from app import accounts, flags, security
from app.authz import Actor
from modules.account import contribute, service
from tests.helpers import HDRS, PASSWORD, AppCase

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'
DRAFT = {'title': '', 'kind': '实践案例', 'summary': '', 'body': ''}
FULL = {'title': '一周报表', 'kind': '方法笔记', 'summary': '把周报收成一张表', 'body': '先列出字段，再让 Agent 填。'}


class R17R3Source(unittest.TestCase):
    def test_account_live_copy_is_real_and_demo_strings_stay(self):
        text = (PREVIEW / 'account.js').read_text(encoding='utf-8')
        for phrase in ('设备列表暂未开放', '令牌列表暂未开放', '公开范围在本版暂不开放'):
            self.assertNotIn(phrase, text)
        self.assertIn("get('/account/sessions'", text)
        self.assertIn("'/account/sessions/' + encodeURIComponent(pending.id) + '/revoke'", text)
        self.assertIn("'/account/sessions/others/revoke'", text)
        self.assertIn("get('/agents/mine'", text)
        self.assertIn("'/account/tokens/' + encodeURIComponent(pending.id) + '/revoke'", text)
        self.assertIn("put('/account/visibility'", text)
        self.assertIn('名片范围已保存。', text)
        self.assertIn('示例 · 仅存本机', text)
        self.assertIn('排名设置暂未开放。', text)
        self.assertNotIn('onclick=', text)

    def test_contribute_live_posts_but_keeps_the_closed_mark_outside_save(self):
        text = (PREVIEW / 'contributions.js').read_text(encoding='utf-8')
        self.assertIn('这个功能还没开放', text)
        self.assertIn('if(isLive())return closed();', text)
        save = text.split("async function save(status='draft')", 1)[1].split('async function addFiles', 1)[0]
        self.assertNotIn('if(isLive())return closed();', save)
        self.assertIn("if(state.mode==='server')return saveLive(status);", save)
        self.assertIn("post('/account/contributions'", text)
        self.assertIn('草稿已保存。', text)
        self.assertIn('已提交审核。', text)
        self.assertNotIn('onclick=', text)


class R17R3Account(AppCase):
    def sid(self, client):
        return client.cookies.get('__Host-sid')

    def login(self, handle, totp=None):
        body = {'handle': handle, 'password': PASSWORD}
        if totp:
            body['totp_code'] = totp
        client = self.client()
        response = client.post('/api/auth/login', headers=HDRS, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return client

    def sessions(self, client, ua='AlphaBrowser/1'):
        response = client.get('/api/account/sessions', headers={**HDRS, 'User-Agent': ua})
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def test_sessions_list_own_devices_and_revoke_with_password(self):
        alice = self.user('r17_dev')
        other = self.login('r17_dev')
        secret = self.sid(alice)
        other_secret = self.sid(other)
        listed = self.sessions(alice)
        body = listed.json()['data']['items']
        self.assertEqual(len(body), 2)
        self.assertNotIn(secret, listed.text)
        self.assertNotIn(other_secret, listed.text)
        current = next(row for row in body if row['current'])
        stranger_device = next(row for row in body if not row['current'])
        self.assertEqual(current['id'], security.token_hash(secret))
        self.assertNotEqual(current['id'], secret)
        self.assertEqual(current['name'], '这台设备')
        self.assertEqual(current['client'], 'AlphaBrowser/1')
        self.assertEqual(stranger_device['name'], '另一台设备')
        self.assertEqual(stranger_device['client'], '')
        missing = alice.post(f"/api/account/sessions/{stranger_device['id']}/revoke", headers=HDRS, json={})
        self.assertEqual((missing.status_code, self.code(missing)), (422, 'validation_failed'))
        self.assertIn('需要当前密码。', missing.text)
        wrong = alice.post(f"/api/account/sessions/{stranger_device['id']}/revoke", headers=HDRS,
                           json={'password': 'wrong password'})
        self.assertEqual(self.code(wrong), 'invalid_credentials')
        bob = self.user('r17_other')
        stolen = bob.post(f"/api/account/sessions/{stranger_device['id']}/revoke", headers=HDRS,
                          json={'password': PASSWORD})
        self.assertEqual(stolen.status_code, 404)
        gone = alice.post(f"/api/account/sessions/{stranger_device['id']}/revoke", headers=HDRS,
                          json={'password': PASSWORD})
        self.assertEqual(gone.status_code, 200, gone.text)
        self.assertEqual(gone.json()['data']['id'], stranger_device['id'])
        self.assertNotIn(other_secret, gone.text)
        left = self.sessions(alice).json()['data']['items']
        self.assertEqual([row['id'] for row in left], [current['id']])
        third = self.login('r17_dev')
        others = alice.post('/api/account/sessions/others/revoke', headers=HDRS, json={'password': PASSWORD})
        self.assertEqual(others.status_code, 200, others.text)
        kept = self.sessions(alice).json()['data']['items']
        self.assertEqual([row['id'] for row in kept], [current['id']])
        self.assertEqual(third.get('/api/me', headers=HDRS).status_code, 401)
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'pending_deletion' WHERE id = ?", (alice.pid,))
        again = self.login('r17_dev')
        pending = alice.post(f"/api/account/sessions/{security.token_hash(self.sid(again))}/revoke", headers=HDRS,
                             json={'password': PASSWORD})
        self.assertEqual(pending.status_code, 200, pending.text)
        blocked = alice.put('/api/account/visibility', headers=HDRS, json={'scope': 'self'})
        self.assertEqual(blocked.status_code, 403)

    def test_session_revoke_requires_totp_and_replays_without_reusing_the_code(self):
        alice = self.user('r17_totp', totp=True)
        with self.db.write() as conn:
            other_token = accounts.create_session(conn, self.settings, alice.pid)
        other_id = security.token_hash(other_token)
        path = f'/api/account/sessions/{other_id}/revoke'
        missing = alice.post(path, headers=HDRS, json={})
        self.assertEqual(self.code(missing), 'totp_required')
        bad = alice.post(path, headers=HDRS, json={'totp_code': '000000'})
        self.assertEqual(self.code(bad), 'totp_invalid')
        code = security.totp_now(alice.totp_secret, time.time() + 30)
        headers = {**HDRS, 'Idempotency-Key': 'revoke-session-1'}
        first = alice.post(path, headers=headers, json={'totp_code': code})
        self.assertEqual(first.status_code, 200, first.text)
        with self.db.write() as conn:
            step = conn.execute('SELECT last_step FROM totp_secret WHERE principal_id = ?', (alice.pid,)).fetchone()[0]
        replay = alice.post(path, headers=headers, json={'totp_code': code})
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.headers.get('idempotent-replayed'), 'true')
        with self.db.write() as conn:
            self.assertEqual(conn.execute('SELECT last_step FROM totp_secret WHERE principal_id = ?',
                                          (alice.pid,)).fetchone()[0], step)
        again = alice.post(path, headers={**HDRS, 'Idempotency-Key': 'revoke-session-2'}, json={'totp_code': code})
        self.assertEqual(self.code(again), 'totp_invalid')

    def test_token_revoke_hides_plaintext_and_rejects_other_owners(self):
        alice = self.user('r17_tok', level=2)
        bob = self.user('r17_tok_b', level=2)
        agent = alice.post('/api/agents', headers=HDRS, json={'name': '小助手'})
        self.assertEqual(agent.status_code, 201, agent.text)
        issued = alice.post(f"/api/agents/{agent.json()['data']['id']}/tokens", headers=HDRS, json={'preset': 'read'})
        self.assertEqual(issued.status_code, 201, issued.text)
        plaintext = issued.json()['data']['token']
        token_id = issued.json()['data']['meta']['id']
        mine = alice.get('/api/agents/mine', headers=HDRS)
        self.assertEqual(mine.status_code, 200, mine.text)
        self.assertNotIn(plaintext, mine.text)
        self.assertNotIn('token_hash', mine.text)
        hint = mine.json()['data']['agents'][0]['tokens'][0]['hint']
        self.assertTrue(hint.endswith(plaintext[-4:]))
        self.assertNotIn(plaintext, hint)
        stolen = bob.post(f'/api/account/tokens/{token_id}/revoke', headers=HDRS, json={'password': PASSWORD})
        self.assertEqual(stolen.status_code, 404)
        revoked = alice.post(f'/api/account/tokens/{token_id}/revoke', headers=HDRS, json={'password': PASSWORD})
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertNotIn(plaintext, revoked.text)
        self.assertNotIn('token_hash', revoked.text)
        self.assertTrue(revoked.json()['data']['revoked_at'])
        self.assertTrue(revoked.json()['data']['hint'].endswith(plaintext[-4:]))

    def test_card_visibility_defaults_members_and_social_directory_still_ignores_it(self):
        owner = self.user('r17_card')
        stranger = self.user('r17_see')
        current = owner.get('/api/account/visibility', headers=HDRS)
        self.assertEqual(current.json()['data']['scope'], 'members')
        bad = owner.put('/api/account/visibility', headers=HDRS, json={'scope': 'public'})
        self.assertEqual(bad.status_code, 422)
        open_card = stranger.get('/api/account/cards/r17_card', headers=HDRS)
        self.assertEqual(open_card.status_code, 200, open_card.text)
        self.assertNotIn('scope', open_card.json()['data'])
        hidden = owner.put('/api/account/visibility', headers=HDRS, json={'scope': 'self'})
        self.assertEqual(hidden.status_code, 200, hidden.text)
        self.assertEqual(stranger.get('/api/account/cards/r17_card', headers=HDRS).status_code, 404)
        own = owner.get('/api/account/cards/r17_card', headers=HDRS)
        self.assertEqual(own.status_code, 200, own.text)
        self.assertEqual(own.json()['data']['scope'], 'self')
        self.assertEqual(stranger.get('/api/account/cards/no', headers=HDRS).status_code, 404)
        social = stranger.get('/api/social/profiles/r17_card', headers=HDRS)
        self.assertEqual(social.status_code, 200, social.text)
        self.assertIn('r17_card', social.text)
        with self.db.write() as conn:
            code = accounts.issue_invite(conn, owner.pid, 1, 7)[1]
        friend = self.client()
        self.assertEqual(self.register(friend, 'r17_inv', code=code).status_code, 201)
        invited = owner.put('/api/account/visibility', headers=HDRS, json={'scope': 'invited'})
        self.assertEqual(invited.status_code, 200, invited.text)
        self.assertEqual(friend.get('/api/account/cards/r17_card', headers=HDRS).status_code, 200)
        self.assertEqual(stranger.get('/api/account/cards/r17_card', headers=HDRS).status_code, 404)
        friend.put('/api/account/visibility', headers=HDRS, json={'scope': 'invited'})
        self.assertEqual(owner.get('/api/account/cards/r17_inv', headers=HDRS).status_code, 200)
        self.assertEqual(stranger.get('/api/account/cards/r17_inv', headers=HDRS).status_code, 404)

    def draft(self, client, body=None, status=201):
        response = client.post('/api/account/contributions', headers=HDRS, json=body or DRAFT)
        self.assertEqual(response.status_code, status, response.text)
        return response

    def test_contributions_round_trip_version_admin_and_purge(self):
        alice = self.user('r17_note')
        bob = self.user('r17_note_b')
        created = self.draft(alice)
        item = created.json()['data']
        self.assertEqual(item['status'], 'draft')
        self.assertEqual(item['files'], [])
        self.assertEqual(item['version'], 1)
        self.assertEqual(bob.get(f"/api/account/contributions/{item['id']}", headers=HDRS).status_code, 404)
        bare = alice.put(f"/api/account/contributions/{item['id']}", headers=HDRS, json=FULL)
        self.assertEqual(self.code(bare), 'precondition_required')
        clash = alice.put(f"/api/account/contributions/{item['id']}", headers={**HDRS, 'If-Match': '9'}, json=FULL)
        self.assertEqual(clash.status_code, 412)
        early = alice.post(f"/api/account/contributions/{item['id']}/review", headers={**HDRS, 'If-Match': '1'})
        self.assertEqual(early.status_code, 422)
        saved = alice.put(f"/api/account/contributions/{item['id']}", headers={**HDRS, 'If-Match': '1'}, json=FULL)
        self.assertEqual(saved.status_code, 200, saved.text)
        version = saved.json()['data']['version']
        reviewed = alice.post(f"/api/account/contributions/{item['id']}/review",
                              headers={**HDRS, 'If-Match': str(version)})
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        self.assertEqual(reviewed.json()['data']['status'], 'review')
        self.assertEqual(reviewed.json()['data']['files'], [])
        withdrawn = alice.post(f"/api/account/contributions/{item['id']}/withdraw",
                               headers={**HDRS, 'If-Match': str(reviewed.json()['data']['version'])})
        self.assertEqual(withdrawn.json()['data']['status'], 'draft')
        reviewed = alice.post(f"/api/account/contributions/{item['id']}/review",
                              headers={**HDRS, 'If-Match': str(withdrawn.json()['data']['version'])})
        second = self.draft(alice, FULL)
        second_id = second.json()['data']['id']
        sent = alice.post(f'/api/account/contributions/{second_id}/review', headers={**HDRS, 'If-Match': '1'})
        self.assertEqual(sent.status_code, 200, sent.text)
        page = alice.get('/api/account/contributions', headers=HDRS, params={'limit': 1})
        self.assertEqual(page.status_code, 200, page.text)
        self.assertEqual(len(page.json()['data']['items']), 1)
        self.assertTrue(page.json()['meta']['cursor'])
        nxt = alice.get('/api/account/contributions', headers=HDRS,
                        params={'limit': 1, 'cursor': page.json()['meta']['cursor']})
        self.assertEqual(len(nxt.json()['data']['items']), 1)
        self.assertNotEqual(page.json()['data']['items'][0]['id'], nxt.json()['data']['items'][0]['id'])
        stranger = alice.post(f"/api/admin/account/contributions/{item['id']}/decide", headers=HDRS,
                              json={'decision': 'accept'})
        self.assertEqual(stranger.status_code, 403)
        gov = self.user('r17_gov', level=5, roles=('governor',), totp=True)
        queue = gov.get('/api/admin/account/contributions', headers=HDRS, params={'status': 'review'})
        self.assertEqual(queue.status_code, 200, queue.text)
        ids = {row['id'] for row in queue.json()['data']['items']}
        self.assertIn(item['id'], ids)
        self.assertIn(second_id, ids)
        accepted = gov.post(f"/api/admin/account/contributions/{item['id']}/decide", headers=HDRS,
                            json={'decision': 'accept'})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()['data']['status'], 'accepted')
        returned = gov.post(f'/api/admin/account/contributions/{second_id}/decide', headers=HDRS,
                            json={'decision': 'return'})
        self.assertEqual(returned.json()['data']['status'], 'draft')
        detail = alice.get(f"/api/account/contributions/{item['id']}", headers=HDRS)
        self.assertIn('审核通过', json.dumps(detail.json()['data']['history'], ensure_ascii=False))
        removed = alice.delete(f"/api/account/contributions/{second_id}",
                               headers={**HDRS, 'If-Match': str(returned.json()['data']['version'])})
        self.assertEqual(removed.status_code, 200, removed.text)
        self.assertEqual(alice.get(f'/api/account/contributions/{second_id}', headers=HDRS).status_code, 404)
        actor = Actor(id=alice.pid, level=1, status='active')
        exported = contribute.export_rows(self.db.conn(), actor)
        self.assertEqual([row['id'] for row in exported], [item['id']])
        self.assertEqual(contribute.export_rows(self.db.conn(), Actor(id=bob.pid, level=1, status='active')), [])
        self.assertEqual(alice.put('/api/account/visibility', headers=HDRS, json={'scope': 'self'}).status_code, 200)
        self.sessions(alice)
        with self.db.write() as conn:
            flags.set_flag(conn, 'account.contributions.enabled', 0, None)
        off = alice.get('/api/account/contributions', headers=HDRS)
        self.assertEqual((off.status_code, self.code(off)), (501, 'capability_unavailable'))
        with self.db.write() as conn:
            flags.set_flag(conn, 'account.contributions.enabled', 1, None)
            service.purge(conn, alice.pid)
        self.assertEqual(alice.get(f"/api/account/contributions/{item['id']}", headers=HDRS).status_code, 404)
        with self.db.write() as conn:
            self.assertIsNone(conn.execute('SELECT 1 FROM contribution WHERE author_id = ?', (alice.pid,)).fetchone())
            self.assertIsNone(conn.execute('SELECT 1 FROM account_card_visibility WHERE principal_id = ?',
                                           (alice.pid,)).fetchone())

    def test_contribution_history_keeps_twelve_versions(self):
        alice = self.user('r17_hist')
        created = self.draft(alice, FULL).json()['data']
        version = created['version']
        for n in range(12):
            body = dict(FULL, title=f'第{n}稿')
            saved = alice.put(f"/api/account/contributions/{created['id']}",
                              headers={**HDRS, 'If-Match': str(version)}, json=body)
            self.assertEqual(saved.status_code, 200, saved.text)
            version = saved.json()['data']['version']
        history = alice.get(f"/api/account/contributions/{created['id']}", headers=HDRS).json()['data']['history']
        self.assertEqual(len(history), 12)
        self.assertEqual(history[0]['version'], 2)
        self.assertEqual(history[-1]['version'], 13)
