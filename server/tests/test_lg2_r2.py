"""R2: adult declaration, CLI issuer and repeated deletion audit."""
import contextlib
import io
import json
from pathlib import Path
from unittest import mock
from app import accounts, clock, withdrawals
from app.__main__ import issue_cli_invite, main
from app.errors import ApiError
from modules.account import service as account
from tests.helpers import AppCase, HDRS, PASSWORD
from tests.test_lg2_fixtures import ConfirmedAdultFixture


class AdultRegistrationTest(ConfirmedAdultFixture, AppCase):
    def test_confirmation_strict_and_rejection_has_no_side_effects(self):
        code = self.invite()
        client = self.client()
        base = {'invite_code': code, 'handle': 'adultcheck', 'password': PASSWORD, 'display_name': '成年夹具'}
        for extra in ({}, {'adult_confirmed': False}, {'adult_confirmed': None}, {'adult_confirmed': 1},
                      {'adult_confirmed': 0}, {'adult_confirmed': 'true'}, {'adult_confirmed': 'false'}):
            with self.subTest(value=extra):
                response = client.post('/api/auth/register', headers=HDRS, json={**base, **extra})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertNotIn('set-cookie', response.headers)
                for table in ('principal', 'session'):
                    self.assertEqual(self.db.conn().execute(f'SELECT count(*) FROM {table}').fetchone()[0], 0)
                self.assertEqual(self.db.conn().execute('SELECT used_count FROM invite_code').fetchone()[0], 0)
        accepted = client.post('/api/auth/register', headers=HDRS, json={**base, 'adult_confirmed': True})
        self.assertEqual(accepted.status_code, 201, accepted.text)
        pid = accepted.json()['data']['id']
        row = self.db.conn().execute("SELECT actor_id,target_id,meta_json FROM audit_event WHERE action='auth.adult_confirmed'").fetchone()
        self.assertEqual((row['actor_id'], row['target_id']), (pid, pid))
        self.assertEqual(json.loads(row['meta_json']), {'minimum_age': 18, 'source': 'self_declaration'})


class CLIInviteTest(ConfirmedAdultFixture, AppCase):
    def issue(self, **kwargs):
        with self.db.write() as conn:
            return issue_cli_invite(conn, **kwargs)

    def test_one_bootstrap_then_named_issuer_required(self):
        iid, code, _ = self.issue()
        row = self.db.conn().execute('SELECT inviter_id,max_uses FROM invite_code WHERE id=?', (iid,)).fetchone()
        self.assertEqual(tuple(row), (None, 1))
        with self.assertRaises(ApiError) as error:
            self.issue()
        self.assertEqual(error.exception.code, 'state_conflict')
        self.assertEqual(self.register(self.client(), 'founder', code).status_code, 201)
        with self.assertRaises(ApiError) as error:
            self.issue()
        self.assertEqual(error.exception.code, 'action_not_allowed')
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM invite_code').fetchone()[0], 1)

    def test_expired_bootstrap_can_be_replaced(self):
        iid, _, _ = self.issue()
        with self.db.write() as conn:
            conn.execute('UPDATE invite_code SET expires_at=? WHERE id=?', (clock.iso(clock.now_ts()-1), iid))
        self.issue()
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM invite_code WHERE expires_at>?',
                                               (clock.now(),)).fetchone()[0], 1)

    def test_issuer_must_be_active_global_admin_and_is_audited(self):
        member = self.user('regular')
        admin = self.user('cliadmin', roles=['admin'])
        for name in (None, 'regular', 'unknown'):
            with self.subTest(issuer=name), self.assertRaises(ApiError):
                self.issue(issuer=name)
        iid, code, _ = self.issue(issuer=' CLIADMIN ')
        row = self.db.conn().execute('SELECT inviter_id,code_hash FROM invite_code WHERE id=?', (iid,)).fetchone()
        self.assertEqual(row['inviter_id'], admin.pid)
        self.assertNotEqual(row['code_hash'], code)
        entries = self.db.conn().execute('SELECT actor_id,action,meta_json FROM audit_event WHERE target_id=?', (iid,)).fetchall()
        self.assertEqual({r['action'] for r in entries}, {'invite.issue', 'invite.cli_issue'})
        self.assertTrue(all(r['actor_id'] == admin.pid for r in entries))
        self.assertNotIn(code, str([tuple(r) for r in entries]))
        with self.db.write() as conn:
            accounts.set_role(conn, None, admin.pid, 'admin', grant=False)
            space = accounts.create_space(conn, member.pid, 'cli-space', '测试空间')
            accounts.set_role(conn, None, member.pid, 'admin', space_id=space)
        for name in ('cliadmin', 'regular'):
            with self.subTest(issuer=name), self.assertRaises(ApiError):
                self.issue(issuer=name)

    def test_inactive_admin_is_not_an_issuer(self):
        admin = self.user('inactiveadmin', roles=['admin'])
        for status in ('pending_deletion', 'suspended', 'deleted'):
            with self.db.write() as conn:
                conn.execute('UPDATE principal SET status=? WHERE id=?', (status, admin.pid))
            with self.subTest(status=status), self.assertRaises(ApiError):
                self.issue(issuer='inactiveadmin')

    def test_parser_accepts_issuer_and_injected_settings(self):
        admin = self.user('cliowner', roles=['admin'])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as denied:
            main(['issue-invite'], settings=self.settings)
        self.assertEqual(denied.exception.code, 2)
        with mock.patch('app.__main__.Settings.from_env', side_effect=AssertionError('no environment')):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(main(['issue-invite', '--issuer', 'cliowner'], settings=self.settings), 0)
        self.assertIn('expires_at=', output.getvalue())
        self.assertEqual(self.db.conn().execute("SELECT inviter_id FROM invite_code WHERE note='cli'").fetchone()[0], admin.pid)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            main(['issue-invite', '--max-uses', '2'], settings=self.settings)
        self.assertEqual(error.exception.code, 2)

    def test_http_admin_quota_exception_is_audited(self):
        admin = self.user('httpadmin', roles=['admin'], totp=True)
        for _ in range(2):
            response = admin.post('/api/admin/invites', headers=HDRS, json={})
            self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.db.conn().execute("SELECT count(*) FROM audit_event WHERE actor_id=? AND action='invite.issue'",
                                               (admin.pid,)).fetchone()[0], 2)


class DeletionReplayTest(ConfirmedAdultFixture, AppCase):
    def deleted_draft(self):
        member = self.user('r2purge', level=2)
        draft = self.obj(member, title='R2-PRIVATE-TITLE', lifecycle='draft', content={'body': 'R2-PRIVATE-BODY'})
        self.assertEqual(member.post('/api/me/delete', headers=HDRS, json={'password': PASSWORD}).status_code, 200)
        with self.db.write() as conn:
            conn.execute('UPDATE principal SET delete_requested_at=? WHERE id=?',
                         (clock.iso(clock.now_ts()-8*86400), member.pid))
        self.assertEqual(accounts.purge_due(self.db, self.settings), [member.pid])
        return member, draft

    def test_sync_purger_and_outbox_replay_keep_single_audit(self):
        member, draft = self.deleted_draft()
        for _ in range(2):
            with self.db.write() as conn:
                account.on_principal_deleted(conn, {'aggregate_id': member.pid})
        self.assertEqual(self.db.conn().execute("SELECT count(*) FROM audit_event WHERE action='account.private_content_purged' "
                                               'AND target_id=?', (member.pid,)).fetchone()[0], 1)
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM object_version WHERE object_id=?',
                                               (draft['id'],)).fetchone()[0], 0)

    def test_account_log_has_version_reason_without_prose(self):
        _, draft = self.deleted_draft()
        records, problems = withdrawals.read(self.settings.withdrawal_log)
        self.assertEqual(problems, [])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['object_id'], draft['id'])
        self.assertEqual(records[0]['version'], 1)
        self.assertEqual(records[0]['reason'], 'account_deleted')
        text = Path(self.settings.withdrawal_log).read_text()
        for value in ('R2-PRIVATE-TITLE', 'R2-PRIVATE-BODY'):
            self.assertNotIn(value, text)
