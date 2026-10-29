"""INVITE-1 · 额度、一次性、过期、竹子回报、封禁作废、L1 不能邀。"""
import unittest

from app import accounts, clock, outbox

from tests.helpers import HDRS, AppCase
from tests.test_lg2_fixtures import ConfirmedAdultFixture


class InviteTests(ConfirmedAdultFixture, AppCase):
    def me(self, client):
        response = client.get('/api/invite/me', headers=HDRS)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def issue(self, client, note=''):
        response = client.post('/api/invite/codes', headers=HDRS, json={'note': note})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['data']

    def accept(self, code, handle, name=None):
        guest = self.client()
        response = self.register(guest, handle, code)
        self.assertEqual(response.status_code, 201, response.text)
        guest.pid = response.json()['data']['id']
        if name:
            with self.db.write() as conn:
                conn.execute('UPDATE profile SET display_name = ? WHERE principal_id = ?', (name, guest.pid))
        return guest

    def scalar(self, sql, args=()):
        with self.db.read() as conn:
            return conn.execute(sql, args).fetchone()[0]

    def grant_trial(self, client):
        from modules.billing import service as billing
        with self.db.write() as conn:
            billing.create_subscription(
                conn, principal_id=client.pid, plan_key='pioneer', cycle='month', seats=1,
                state='trial', source='admin', reason='pilot', actor_id=client.pid)

    def bamboo(self, principal_id):
        from modules.economy import service as eco
        with self.db.read() as conn:
            return eco.balance(conn, principal_id, 'bamboo')

    def test_quota_follows_level_and_membership(self):
        expected = {1: 0, 2: 1, 3: 3, 4: 5, 5: 10}
        for level, total in expected.items():
            client = self.user(f'invlv{level}', level=level)
            quota = self.me(client)['quota']
            self.assertEqual(quota['total'], total, level)
            self.assertEqual(quota['remaining'], total)
            self.assertEqual(quota['memberBonus'], 0)
            self.assertFalse(quota['penalty'])
        member = self.user('invmem', level=2)
        self.grant_trial(member)
        quota = self.me(member)['quota']
        self.assertEqual(quota['total'], 3)
        self.assertEqual(quota['memberBonus'], 2)
        locked = self.user('invl1m', level=1)
        self.grant_trial(locked)
        self.assertEqual(self.me(locked)['quota']['total'], 0)

    def test_l1_cannot_issue(self):
        client = self.user('invl1no', level=1)
        response = client.post('/api/invite/codes', headers=HDRS, json={'note': '一起来'})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.code(response), 'action_not_allowed')

    def test_one_time_expiry_and_spent_quota(self):
        host = self.user('invonce', level=4)
        issued = self.issue(host, '一起来写方法')
        self.assertTrue(issued['url'].startswith('#/hello?invite='))
        self.assertEqual(issued['maxUses'], 1)
        self.accept(issued['code'], 'invused')
        again = self.register(self.client(), 'invused2', issued['code'])
        self.assertEqual(again.status_code, 422, again.text)
        self.assertEqual(self.code(again), 'invite_invalid')

        stale = self.issue(host)
        with self.db.write() as conn:
            conn.execute('UPDATE invite_code SET expires_at = ? WHERE id = ?',
                         (clock.iso(clock.now_ts() - 60), stale['id']))
        expired = self.register(self.client(), 'invexpg', stale['code'])
        self.assertEqual(self.code(expired), 'invite_invalid')

        limited = self.user('invl2cap', level=2)
        first = self.issue(limited)
        with self.db.write() as conn:
            conn.execute('UPDATE invite_code SET expires_at = ? WHERE id = ?',
                         (clock.iso(clock.now_ts() - 60), first['id']))
        second = limited.post('/api/invite/codes', headers=HDRS, json={'note': ''})
        self.assertEqual(second.status_code, 403, second.text)
        self.assertEqual(self.code(second), 'action_not_allowed')

    def test_note_rejects_contact_and_replay_keeps_the_code(self):
        host = self.user('invnote', level=2)
        for note in ('请加微信 pioneer', '电话 13812348000', '啊' * 61):
            response = host.post('/api/invite/codes', headers=HDRS, json={'note': note})
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(self.code(response), 'validation_failed')
        headers = dict(HDRS, **{'Idempotency-Key': 'invite-key-01'})
        body = {'note': '一起来写清楚'}
        first = host.post('/api/invite/codes', headers=headers, json=body)
        second = host.post('/api/invite/codes', headers=headers, json=body)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(second.status_code, 201, second.text)
        self.assertEqual(first.json()['data']['code'], second.json()['data']['code'])
        self.assertEqual(second.headers.get('idempotent-replayed'), 'true')
        self.assertEqual(self.me(host)['quota']['used'], 1)

    def test_preview_returns_only_name_and_note(self):
        host = self.user('invprv', level=2)
        issued = self.issue(host, '一起来写方法')
        with self.db.write() as conn:
            conn.execute("UPDATE profile SET display_name = ? WHERE principal_id = ?", ('阿树', host.pid))
        anon = self.client()
        response = anon.get('/api/invite/preview', params={'code': issued['code']})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['data'], {'name': '阿树', 'note': '一起来写方法'})
        missing = anon.get('/api/invite/preview', params={'code': 'NO-SUCH-CODE'})
        self.assertEqual(self.code(missing), 'invite_invalid')
        with self.db.write() as conn:
            accounts.suspend(conn, host.pid, host.pid, 'abuse')
        blocked = anon.get('/api/invite/preview', params={'code': issued['code']})
        self.assertEqual(self.code(blocked), 'invite_invalid')
        self.assertIsNotNone(self.scalar('SELECT revoked_at FROM invite_code WHERE id = ?', (issued['id'],)))

    def test_people_show_public_name_and_level_only(self):
        host = self.user('invppl', level=3)
        issued = self.issue(host, '来写方法')
        self.accept(issued['code'], 'invguest', '小林')
        data = self.me(host)
        self.assertEqual(data['people'], [{'name': '小林', 'level': 1}])
        self.assertEqual(data['accepted'], 1)
        self.assertEqual(data['sent'], 1)
        for person in data['people']:
            self.assertEqual(set(person), {'name', 'level'})
        for item in data['invites']:
            self.assertNotIn('handle', item)
            self.assertNotIn('code', item)
            self.assertEqual(item['status'], 'registered')

    def test_rewards_are_bamboo_only_and_idempotent(self):
        host = self.user('invrew', level=2)
        issued = self.issue(host)
        guest = self.accept(issued['code'], 'invrewg')
        level = self.scalar('SELECT level FROM profile WHERE principal_id = ?', (host.pid,))
        ledger = self.scalar('SELECT count(*) FROM ledger_entry WHERE subject_id = ?', (host.pid,))
        first = guest.post('/api/invite/onboarding', headers=HDRS)
        second = guest.post('/api/invite/onboarding', headers=HDRS)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()['data']['rewarded'], 20)
        self.assertEqual(second.json()['data']['reason'], 'already')
        self.assertEqual(second.json()['data']['rewarded'], 20)
        self.assertEqual(self.bamboo(host.pid), 20)
        with self.db.write() as conn:
            conn.execute('UPDATE profile SET level = 2 WHERE principal_id = ?', (guest.pid,))
        self.obj(guest, type='knowledge', title='一条方法', content={'body': '先写步骤'})
        outbox.dispatch(self.db)
        self.obj(guest, type='knowledge', title='另一条方法', content={'body': '再写边界'})
        outbox.dispatch(self.db)
        from modules.invite import service
        with self.db.write() as conn:
            again = service.note_first(conn, guest.pid, 'useful')
        self.assertEqual(again['reason'], 'already')
        self.assertEqual(self.bamboo(host.pid), 70)
        self.assertEqual(self.scalar('SELECT count(*) FROM invite_reward WHERE inviter_id = ?', (host.pid,)), 2)
        self.assertEqual(self.scalar('SELECT level FROM profile WHERE principal_id = ?', (host.pid,)), level)
        self.assertEqual(self.scalar('SELECT count(*) FROM ledger_entry WHERE subject_id = ?', (host.pid,)), ledger)
        stranger = self.user('invstr', level=2)
        alone = stranger.post('/api/invite/onboarding', headers=HDRS)
        self.assertEqual(alone.status_code, 200, alone.text)
        self.assertEqual(alone.json()['data'], {'rewarded': 0, 'reason': 'not_invited'})

    def test_monthly_bamboo_cap_clips_the_second_grant(self):
        host = self.user('invcap', level=2)
        issued = self.issue(host)
        guest = self.accept(issued['code'], 'invcapg')
        with self.db.write() as conn:
            conn.execute('UPDATE principal SET created_at = ? WHERE id = ?',
                         (clock.iso(clock.now_ts() - 8 * 86400), host.pid))
            conn.execute("UPDATE economy_rule SET value = 40 WHERE key = 'daily_credit_cap'")
            conn.execute("UPDATE invite_policy SET value = 0 WHERE key = 'reward_monthly_extra'")
            conn.execute('UPDATE profile SET level = 2 WHERE principal_id = ?', (guest.pid,))
        done = guest.post('/api/invite/onboarding', headers=HDRS)
        self.assertEqual(done.json()['data']['rewarded'], 20)
        self.obj(guest, type='knowledge', title='一条方法', content={'body': '步骤'})
        outbox.dispatch(self.db)
        self.assertEqual(self.bamboo(host.pid), 40)
        self.assertEqual(self.scalar(
            'SELECT actual FROM invite_reward WHERE invitee_id = ? AND kind = ?', (guest.pid, 'first')), 20)

    def test_ban_voids_unused_codes(self):
        host = self.user('invban', level=3)
        first = self.issue(host)
        second = self.issue(host)
        with self.db.write() as conn:
            accounts.suspend(conn, host.pid, host.pid, 'abuse')
            outbox.emit(conn, 'governance.principal_suspended', 'principal', host.pid, {})
        outbox.dispatch(self.db)
        for item in (first, second):
            self.assertIsNotNone(self.scalar('SELECT revoked_at FROM invite_code WHERE id = ?', (item['id'],)))
        response = self.register(self.client(), 'invbang', first['code'])
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.code(response), 'invite_invalid')

    def test_inactive_majority_halves_next_month(self):
        from modules.invite import service
        host = self.user('invpen', level=3)
        guests = []
        for index in range(2):
            issued = self.issue(host)
            guests.append(self.accept(issued['code'], f'invpen{index}').pid)
        start, _end = service.month_bounds(service.previous_month_key())
        with self.db.write() as conn:
            for guest_id in guests:
                edge = conn.execute('SELECT invite_code_id, inviter_id FROM invite_edge WHERE invitee_id = ?',
                                    (guest_id,)).fetchone()
                conn.execute(
                    'INSERT INTO invite_progress (invitee_id, inviter_id, invite_code_id, registered_at) '
                    'VALUES (?, ?, ?, ?) ON CONFLICT(invitee_id) DO UPDATE SET registered_at = excluded.registered_at',
                    (guest_id, edge['inviter_id'], edge['invite_code_id'], start))
                conn.execute('UPDATE session SET last_seen_at = ? WHERE principal_id = ?', (start, guest_id))
        quota = self.me(host)['quota']
        self.assertTrue(quota['penalty'])
        self.assertEqual(quota['total'], 1)

    def test_mutual_useful_and_votes_emit_anomaly(self):
        from modules.invite import service
        host = self.user('invano', level=3)
        issued = self.issue(host)
        guest = self.accept(issued['code'], 'invanog')
        host_post = self.obj(host)
        guest_post = self.obj(guest)
        now = clock.now()
        with self.db.write() as conn:
            conn.execute(
                'INSERT INTO content_useful (object_id, giver_id, receiver_id, counted, points, reason, '
                'ledger_entry_id, created_at) VALUES (?, ?, ?, 0, 0, NULL, NULL, ?)',
                (guest_post['id'], host.pid, guest.pid, now))
            conn.execute(
                'INSERT INTO content_useful (object_id, giver_id, receiver_id, counted, points, reason, '
                'ledger_entry_id, created_at) VALUES (?, ?, ?, 0, 0, NULL, NULL, ?)',
                (host_post['id'], guest.pid, host.pid, now))
            outbox.emit(conn, 'content.useful_marked', 'object', guest_post['id'], {'counted': False},
                        actor_id=host.pid)
        outbox.dispatch(self.db)
        self.assertEqual(self.scalar("SELECT count(*) FROM outbox_event WHERE event_type = 'invite.anomaly'"), 1)

        event_id, left, right = 'evt-invite-1', 'sub-invite-host', 'sub-invite-guest'
        later = clock.iso(clock.now_ts() + 86400)
        with self.db.write() as conn:
            conn.execute(
                'INSERT INTO community_event (id, slug, kind, title, summary, cover, rules, rewards_json, '
                'timeline_json, place, host_name, starts_at, ends_at, visibility, min_level, status, created_at, '
                'updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (event_id, 'invite-anomaly', 'challenge', '邀请互投', '', '', '', '[]', '[]', '', '',
                 now, later, 'members', 1, 'live', now, now))
            conn.execute(
                'INSERT INTO event_submission (id, event_id, principal_id, title, summary, source_kind, source_ref, '
                'created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (left, event_id, host.pid, '甲方', '', 'other', 'a', now))
            conn.execute(
                'INSERT INTO event_submission (id, event_id, principal_id, title, summary, source_kind, source_ref, '
                'created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (right, event_id, guest.pid, '乙方', '', 'other', 'b', now))
            conn.execute(
                'INSERT INTO event_vote (id, event_id, candidate_id, voter_id, weight, created_at) '
                'VALUES (?, ?, ?, ?, 1, ?)',
                ('vote-invite-1', event_id, right, host.pid, now))
            conn.execute(
                'INSERT INTO event_vote (id, event_id, candidate_id, voter_id, weight, created_at) '
                'VALUES (?, ?, ?, ?, 1, ?)',
                ('vote-invite-2', event_id, left, guest.pid, now))
            outbox.emit(conn, 'events.voted', 'event', event_id, {'candidate_id': right}, actor_id=host.pid)
        outbox.dispatch(self.db)
        self.assertEqual(self.scalar(
            "SELECT count(*) FROM invite_anomaly WHERE kind = 'mutual_vote'"), 1)
        self.assertEqual(service.month_key(), self.scalar(
            'SELECT month_key FROM invite_anomaly WHERE kind = ?', ('mutual_vote',)))

    def test_admin_can_change_quota_and_flag_closes_the_api(self):
        admin = self.user('invadm', level=5, roles=('admin',), totp=True)
        member = self.user('invmem2', level=3)
        denied = member.get('/api/admin/invite/rules', headers=HDRS)
        self.assertEqual(denied.status_code, 403, denied.text)
        bare = self.user('invadm2', roles=('admin',))
        no_totp = bare.get('/api/admin/invite/rules', headers=HDRS)
        self.assertEqual(self.code(no_totp), 'totp_setup_required')
        changed = admin.patch('/api/admin/invite/rules', headers=HDRS, json={'level': 2, 'monthly_quota': 4})
        self.assertEqual(changed.status_code, 200, changed.text)
        row = next(item for item in changed.json()['data']['levels'] if item['level'] == 2)
        self.assertEqual(row['monthlyQuota'], 4)
        both = admin.patch('/api/admin/invite/rules', headers=HDRS,
                           json={'level': 2, 'monthly_quota': 4, 'key': 'ttl_days', 'value': 7})
        self.assertEqual(self.code(both), 'validation_failed')
        fresh = self.user('invl2b', level=2)
        self.assertEqual(self.me(fresh)['quota']['total'], 4)
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 0 WHERE key = 'invite.enabled'")
        closed = fresh.get('/api/invite/me', headers=HDRS)
        self.assertEqual(closed.status_code, 501, closed.text)
        self.assertEqual(self.code(closed), 'capability_unavailable')


if __name__ == '__main__':
    unittest.main()
