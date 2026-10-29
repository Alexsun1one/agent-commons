"""LG-2 identity and data-rights tests, synthetic fixtures only."""
import json
from contextlib import contextmanager
from unittest.mock import patch
from pydantic import ValidationError
from app import accounts, authz, clock, security
from app.core.admin import InviteIn
from app.errors import ApiError
from modules.account import service as account
from modules.invite import service as invite
from tests.helpers import AppCase, HDRS, PASSWORD
from tests.test_lg2_fixtures import ConfirmedAdultFixture


class IdentityGateTest(ConfirmedAdultFixture, AppCase):
    def test_all_issuers_reject_multi_use_codes(self):
        with self.assertRaises(ValidationError):
            InviteIn(max_uses=2)
        with self.assertRaises(ApiError) as raised:
            with self.db.write() as conn:
                accounts.issue_invite(conn, None, max_uses=2)
        self.assertEqual(raised.exception.code, 'validation_failed')

    def assert_code_not_stored(self, code):
        # Includes response cache, audit and outbox, using only this fixture DB.
        for row in self.db.conn().execute("SELECT name FROM sqlite_master WHERE type='table'"):
            name = row[0].replace('"', '""')
            for item in self.db.conn().execute(f'SELECT * FROM "{name}"'):
                self.assertNotIn(code, str(tuple(item)), row[0])
                self.assertNotIn(code.replace('-', ''), str(tuple(item)), row[0])

    def test_legacy_multi_use_row_is_consumed_only_once(self):
        with self.db.write() as conn:
            iid, code, _ = accounts.issue_invite(conn, None)
            conn.execute('UPDATE invite_code SET max_uses=50 WHERE id=?', (iid,))
        self.assertEqual(self.register(self.client(), 'lglegacy1', code).status_code, 201)
        self.assertEqual(self.code(self.register(self.client(), 'lglegacy2', code)), 'invite_invalid')

    def test_admin_code_hash_only_and_replay_checks_current_role(self):
        admin = self.user('lgadmin', roles=['admin'], totp=True)
        headers = dict(HDRS, **{'Idempotency-Key': 'lg2-invite-0001'})
        first = admin.post('/api/admin/invites', headers=headers, json={})
        self.assertEqual(first.status_code, 201, first.text)
        code = first.json()['data']['code']
        replay = admin.post('/api/admin/invites', headers=headers, json={})
        self.assertEqual(replay.json()['data']['code'], code)
        self.assertEqual(replay.headers.get('Idempotent-Replayed'), 'true')
        self.assertNotIn('_code_nonce', first.json())
        self.assert_code_not_stored(code)
        self.assertEqual(self.register(self.client(), 'lgchild', code).status_code, 201)
        self.assertEqual(self.code(self.register(self.client(), 'lgchild2', code)), 'invite_invalid')
        with self.db.write() as conn:
            accounts.set_role(conn, None, admin.pid, 'admin', grant=False)
        self.assertEqual(self.code(admin.post('/api/admin/invites', headers=headers, json={})), 'action_not_allowed')

    def test_member_code_hash_only_replay_and_conflict(self):
        member = self.user('lgmember', level=2)
        headers = dict(HDRS, **{'Idempotency-Key': 'lg2-member-0001'})
        body = {'note': '一起学习'}
        first = member.post('/api/invite/codes', headers=headers, json=body)
        self.assertEqual(first.status_code, 201, first.text)
        code = first.json()['data']['code']
        second = member.post('/api/invite/codes', headers=headers, json=body)
        self.assertEqual(second.json()['data'], first.json()['data'])
        self.assertEqual(second.headers.get('Idempotent-Replayed'), 'true')
        self.assert_code_not_stored(code)
        conflict = member.post('/api/invite/codes', headers=headers, json={'note': '另一个请求'})
        self.assertEqual(self.code(conflict), 'idempotency_conflict')
        self.assertEqual(invite.quota_view(self.db.conn(), member.pid)['used'], 1)

    def test_inactive_inviter_cannot_be_used_before_sweeper(self):
        member = self.user('lgblocked', level=4)
        for index, status in enumerate(('suspended', 'pending_deletion', 'deleted')):
            with self.db.write() as conn:
                conn.execute("UPDATE principal SET status='active' WHERE id=?", (member.pid,))
                _, code, _ = accounts.issue_invite(conn, member.pid)
                conn.execute('UPDATE principal SET status=? WHERE id=?', (status, member.pid))
            self.assertEqual(self.code(self.register(self.client(), f'lginactive{index}', code)), 'invite_invalid')

    def test_reset_hash_only_reissue_and_denial_audit(self):
        admin = self.user('lgroot', roles=['admin'], totp=True)
        victim = self.user('lgtarget')
        headers = dict(HDRS, **{'Idempotency-Key': 'lg2-reset-0001'})
        first = admin.post('/api/admin/reset-codes', headers=headers, json={'handle': 'lgtarget'})
        self.assertEqual(first.status_code, 201, first.text)
        old = first.json()['data']['code']
        again = admin.post('/api/admin/reset-codes', headers=headers, json={'handle': 'lgtarget'})
        self.assertEqual(again.json()['data']['code'], old)
        self.assert_code_not_stored(old)
        code = admin.post('/api/admin/reset-codes', headers=HDRS, json={'handle': 'lgtarget'}).json()['data']['code']
        self.assert_code_not_stored(code)
        anon = self.client()
        def reset(value):
            return anon.post('/api/auth/reset', headers=HDRS, json={
                'handle': 'lgtarget', 'reset_code': value, 'new_password': 'new password lg2'})
        self.assertEqual(self.code(reset(old)), 'reset_invalid')
        self.assertEqual(reset(code).status_code, 200)
        self.assertEqual(self.code(reset(code)), 'reset_invalid')
        self.assertEqual(self.code(victim.get('/api/me')), 'session_expired')
        outcomes = [r[0] for r in self.db.conn().execute("SELECT outcome FROM audit_event WHERE action='auth.reset'")]
        self.assertEqual(outcomes.count('denied'), 2)
        self.assertEqual(outcomes.count('ok'), 1)
        self.assert_code_not_stored(code)

    def test_protected_roles_cannot_disable_totp(self):
        for role in ('admin', 'governor'):
            member = self.user(f'lg{role}', roles=[role], totp=True)
            with self.db.write() as conn:
                conn.execute('UPDATE totp_secret SET last_step=0 WHERE principal_id=?', (member.pid,))
            response = member.post('/api/auth/totp/disable', headers=HDRS,
                                   json={'code': security.totp_now(member.totp_secret), 'password': PASSWORD})
            self.assertEqual(self.code(response), 'action_not_allowed')
            self.assertIsNotNone(self.db.conn().execute(
                'SELECT enabled_at FROM totp_secret WHERE principal_id=?', (member.pid,)).fetchone()[0])

    def test_governor_actions_require_totp_setup(self):
        member = self.user('lggovpending', roles=['governor'])
        actor = accounts.resolve_actor(self.db, member.cookies.get('__Host-sid'))
        rules = self.db.conn().execute("SELECT action FROM action_rule WHERE roles LIKE '%governor%' "
                                       'AND require_totp=1').fetchall()
        self.assertTrue(rules)
        for row in rules:
            with self.subTest(action=row[0]):
                self.assertEqual(authz.check(self.db.conn(), actor, row[0]), 'totp_setup_required')


class DataRightsGateTest(ConfirmedAdultFixture, AppCase):
    def test_cancellation_between_scan_and_write_prevents_purge(self):
        member = self.user('lgcancelrace')
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status='pending_deletion', delete_requested_at=? WHERE id=?",
                         (clock.iso(clock.now_ts()-8*86400), member.pid))
        write = self.db.write
        @contextmanager
        def cancel_then_lock():
            with write() as conn:
                conn.execute("UPDATE principal SET status='active', delete_requested_at=NULL WHERE id=?",
                             (member.pid,))
            with write() as conn:
                yield conn
        with patch.object(self.db, 'write', cancel_then_lock):
            self.assertEqual(accounts.purge_due(self.db, self.settings), [])
        self.assertIsNotNone(self.db.conn().execute('SELECT 1 FROM credential WHERE principal_id=?',
                                                   (member.pid,)).fetchone())

    def test_avatar_switch_does_not_disable_data_rights(self):
        member = self.user('lgavatar')
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled=0 WHERE key='account.avatar.enabled'")
        for response in (member.delete('/api/account/avatar', headers=HDRS),
                         member.put('/api/account/avatar', headers=HDRS, json={'asset_id': 'missing'})):
            self.assertEqual(self.code(response), 'capability_unavailable')
        self.assertEqual(member.get('/api/me/export').status_code, 200)
        self.assertEqual(member.post('/api/account/exports', headers=HDRS).status_code, 202)
        self.assertEqual(member.post('/api/me/delete', headers=HDRS, json={'password': PASSWORD}).status_code, 200)
        self.assertEqual(member.post('/api/me/delete/cancel', headers=HDRS).status_code, 200)

    def test_export_does_not_truncate_audit_at_one_thousand(self):
        member = self.user('lgaudit')
        from app import audit
        with self.db.write() as conn:
            for index in range(1001):
                audit.record(conn, member.pid, 'lg2.fixture', 'principal', member.pid)
        response = member.get('/api/me/export')
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()['data']['audit']
        self.assertEqual(sum(r['action'] == 'lg2.fixture' for r in rows), 1001)

    def test_invite_export_owns_rows_and_excludes_secrets_and_peers(self):
        first, other = self.user('lgfirst', level=2), self.user('lgother', level=2)
        issued = first.post('/api/invite/codes', headers=HDRS, json={'note': '自己的附言'}).json()['data']
        other.post('/api/invite/codes', headers=HDRS, json={'note': 'OTHERS-NOTE'})
        result = first.get('/api/me/export')
        self.assertEqual(result.status_code, 200, result.text)
        own = result.json()['data']['invite']
        self.assertEqual([r['id'] for r in own['issued']], [issued['id']])
        for forbidden in (other.pid, 'OTHERS-NOTE', issued['code'], 'code_hash'):
            self.assertNotIn(forbidden, json.dumps(own))

    def test_deletion_clears_reset_cache_invites_and_is_repeatable(self):
        member = self.user('lgdelete', level=2)
        headers = dict(HDRS, **{'Idempotency-Key': 'lg2-delete-0001'})
        issued = member.post('/api/invite/codes', headers=headers, json={'note': '消除附言'}).json()['data']
        with self.db.write() as conn:
            accounts.issue_reset_code(conn, member.pid, member.pid)
        self.assertEqual(member.post('/api/me/delete', headers=HDRS, json={'password': PASSWORD}).status_code, 200)
        self.assertEqual(accounts.purge_due(self.db, self.settings), [])
        with self.db.write() as conn:
            conn.execute('UPDATE principal SET delete_requested_at=? WHERE id=?',
                         (clock.iso(clock.now_ts()-8*86400), member.pid))
        self.assertEqual(accounts.purge_due(self.db, self.settings), [member.pid])
        self.assertEqual(accounts.purge_due(self.db, self.settings), [])
        for table in ('reset_code', 'idempotency_key', 'credential', 'session', 'totp_secret'):
            self.assertEqual(self.db.conn().execute(f'SELECT count(*) FROM {table} WHERE principal_id=?',
                                                    (member.pid,)).fetchone()[0], 0, table)
        row = self.db.conn().execute('SELECT revoked_at, note FROM invite_code WHERE id=?', (issued['id'],)).fetchone()
        self.assertTrue(row['revoked_at'])
        self.assertIsNone(row['note'])
        self.assertEqual(self.db.conn().execute('SELECT note FROM member_invite WHERE invite_code_id=?',
                                                (issued['id'],)).fetchone()[0], '')

    def test_failed_purger_rolls_back_account_deletion(self):
        member = self.user('lgrollback')
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status='pending_deletion', delete_requested_at=? WHERE id=?",
                         (clock.iso(clock.now_ts()-8*86400), member.pid))
        def broken(conn, principal_id):
            raise RuntimeError('LG2 fixture purger failed')
        accounts.register_purger(broken)
        try:
            with self.assertRaisesRegex(RuntimeError, 'LG2 fixture'):
                accounts.purge_due(self.db, self.settings)
        finally:
            accounts.PURGERS.remove(broken)
        self.assertEqual(self.db.conn().execute('SELECT status FROM principal WHERE id=?',
                                                (member.pid,)).fetchone()[0], 'pending_deletion')
        self.assertIsNotNone(self.db.conn().execute('SELECT 1 FROM credential WHERE principal_id=?',
                                                   (member.pid,)).fetchone())

    def test_expired_export_is_swept_without_another_user_request(self):
        member = self.user('lgsweep')
        storage = self.app.state.storage
        from modules.media import service as media
        with self.db.write() as conn:
            media.remember_storage(conn, storage)
            stored = storage.put(b'LG2 synthetic zip bytes', account.EXPORT_KIND)
            conn.execute("INSERT INTO account_export(id,principal_id,state,token_hash,file_key,day,created_at,expires_at) "
                         "VALUES('lg2-expired',?,'ready','fixture-hash',?,'2026-01-01',?,?)",
                         (member.pid, stored.key, clock.now(), clock.iso(clock.now_ts()-1)))
        account.expire_exports(self.db)
        row = self.db.conn().execute("SELECT state,file_key FROM account_export WHERE id='lg2-expired'").fetchone()
        self.assertEqual(tuple(row), ('expired', None))
        self.assertFalse(storage.exists(stored.key))
        account.expire_exports(self.db)
