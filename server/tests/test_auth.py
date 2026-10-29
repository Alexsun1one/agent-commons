import time
import unittest

from app import accounts, clock, security
from app.errors import ApiError
from tests.helpers import HDRS, PASSWORD, AppCase
from tests.test_lg2_fixtures import ConfirmedAdultFixture


class PrimitivesTest(unittest.TestCase):
    def test_rfc6238_vector(self):
        import base64
        secret = base64.b32encode(b'12345678901234567890').decode()
        self.assertEqual(security.totp_at(secret, 59 // 30), '287082')
        self.assertEqual(security.totp_at(secret, 1111111109 // 30), '081804')

    def test_scrypt_roundtrip(self):
        stored = security.hash_password('pässword-123', n=2 ** 8)
        self.assertTrue(stored.startswith('scrypt$256$8$1$'))
        self.assertTrue(security.verify_password('pässword-123', stored))
        self.assertFalse(security.verify_password('password-123', stored))
        self.assertFalse(security.verify_password('x', 'garbage'))

    def test_code_hash_normalizes(self):
        self.assertEqual(security.code_hash('abcd-efgh'), security.code_hash('ABCDEFGH'))


class RegisterTest(ConfirmedAdultFixture, AppCase):
    def test_register_sets_host_cookie_and_me(self):
        c = self.client()
        r = self.register(c, 'alice')
        self.assertEqual(r.status_code, 201, r.text)
        cookie = r.headers['set-cookie']
        for part in ('__Host-sid=', 'HttpOnly', 'Secure', 'Path=/', 'SameSite=lax'):
            self.assertIn(part.lower(), cookie.lower())
        self.assertNotIn('domain', cookie.lower())
        me = c.get('/api/me').json()['data']
        self.assertEqual((me['handle'], me['level']), ('alice', 1))
        self.assertIn('object.create.discussion', me['capabilities'])
        self.assertNotIn('object.create.knowledge', me['capabilities'])

    def test_invite_single_use_replay(self):
        code = self.invite()
        self.assertEqual(self.register(self.client(), 'first', code).status_code, 201)
        r = self.register(self.client(), 'second', code)
        self.assertEqual((r.status_code, self.code(r)), (422, 'invite_invalid'))

    def test_invite_max_uses(self):
        with self.assertRaises(ApiError) as raised:
            self.invite(max_uses=2)
        self.assertEqual(raised.exception.code, 'validation_failed')
        code = self.invite()
        self.assertEqual(self.register(self.client(), 'one', code).status_code, 201)
        self.assertEqual(self.code(self.register(self.client(), 'two', code)), 'invite_invalid')

    def test_invite_expired(self):
        code = self.invite()
        with self.db.write() as conn:
            conn.execute('UPDATE invite_code SET expires_at = ?', (clock.iso(time.time() - 1),))
        self.assertEqual(self.code(self.register(self.client(), 'late', code)), 'invite_invalid')

    def test_invite_revoked_by_admin(self):
        admin = self.user('root', roles=['admin'], totp=True)
        issued = admin.post('/api/admin/invites', headers=HDRS, json={'max_uses': 1}).json()['data']
        r = admin.post(f"/api/admin/invites/{issued['id']}/revoke", headers=HDRS)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.code(self.register(self.client(), 'blocked', issued['code'])), 'invite_invalid')

    def test_invite_tree_records_inviter(self):
        admin = self.user('root', roles=['admin'], totp=True)
        code = admin.post('/api/admin/invites', headers=HDRS, json={}).json()['data']['code']
        r = self.register(self.client(), 'child', code)
        pid = r.json()['data']['id']
        edge = self.db.conn().execute('SELECT inviter_id FROM invite_edge WHERE invitee_id = ?', (pid,)).fetchone()
        self.assertEqual(edge[0], admin.pid)

    def test_invite_stored_as_hash_only(self):
        code = self.invite()
        rows = self.db.conn().execute('SELECT * FROM invite_code').fetchall()
        self.assertFalse(any(code in str(tuple(r)) for r in rows))

    def test_bad_handle_and_short_password(self):
        r = self.register(self.client(), 'Bad Name!')
        self.assertEqual(self.code(r), 'validation_failed')
        r = self.register(self.client(), 'okname', password='short')
        self.assertEqual(self.code(r), 'validation_failed')

    def test_duplicate_handle_keeps_invite_unused(self):
        self.user('taken')
        code = self.invite()
        self.assertEqual(self.code(self.register(self.client(), 'taken', code)), 'state_conflict')
        self.assertEqual(self.register(self.client(), 'fresh', code).status_code, 201)


class LoginTest(ConfirmedAdultFixture, AppCase):
    def login(self, handle, password=PASSWORD, totp=None):
        c = self.client()
        body = {'handle': handle, 'password': password}
        if totp:
            body['totp_code'] = totp
        return c, c.post('/api/auth/login', headers=HDRS, json=body)

    def test_login_logout(self):
        self.user('bob')
        c, r = self.login('bob')
        self.assertEqual(r.status_code, 200, r.text)
        token = c.cookies.get('__Host-sid')
        self.assertEqual(c.get('/api/me').status_code, 200)
        self.assertEqual(c.post('/api/auth/logout', headers=HDRS).status_code, 200)
        self.assertEqual(self.code(c.get('/api/me')), 'unauthenticated')
        stale = self.client()
        stale.cookies.set('__Host-sid', token)
        r = stale.get('/api/me')
        self.assertEqual((r.status_code, self.code(r)), (401, 'session_expired'))

    def test_wrong_password_and_unknown_user(self):
        self.user('bob')
        _, r = self.login('bob', 'wrong password!')
        self.assertEqual((r.status_code, self.code(r)), (401, 'invalid_credentials'))
        _, r2 = self.login('nobody')
        self.assertEqual(r2.json()['error']['message'], r.json()['error']['message'])
        denied = self.db.conn().execute("SELECT count(*) FROM audit_event WHERE action = 'auth.login' "
                                        "AND outcome = 'denied'").fetchone()[0]
        self.assertEqual(denied, 1)

    def test_session_expiry(self):
        c = self.user('bob')
        with self.db.write() as conn:
            conn.execute('UPDATE session SET expires_at = ?', (clock.iso(time.time() - 1),))
        self.assertEqual(self.code(c.get('/api/me')), 'session_expired')

    def test_totp_flow(self):
        c = self.user('carol')
        secret = c.post('/api/auth/totp/setup', headers=HDRS).json()['data']['secret']
        r = c.post('/api/auth/totp/enable', headers=HDRS, json={'code': '000000' if security.totp_now(secret) != '000000' else '111111'})
        self.assertEqual(self.code(r), 'totp_invalid')
        now_code = security.totp_now(secret)
        self.assertEqual(c.post('/api/auth/totp/enable', headers=HDRS, json={'code': now_code}).status_code, 200)
        self.assertEqual(self.code(c.post('/api/auth/totp/setup', headers=HDRS)), 'state_conflict')
        _, r = self.login('carol')
        self.assertEqual((r.status_code, self.code(r)), (401, 'totp_required'))
        _, r = self.login('carol', totp=now_code)
        self.assertEqual(self.code(r), 'totp_invalid')
        next_code = security.totp_now(secret, time.time() + 30)
        _, r = self.login('carol', totp=next_code)
        self.assertEqual(r.status_code, 200, r.text)
        _, r = self.login('carol', totp=next_code)
        self.assertEqual(self.code(r), 'totp_invalid')
        with self.db.write() as conn:
            conn.execute('UPDATE totp_secret SET last_step = 0')
        later = security.totp_now(secret)
        r = c.post('/api/auth/totp/disable', headers=HDRS, json={'code': later, 'password': 'nope nope nope'})
        self.assertEqual(self.code(r), 'invalid_credentials')
        r = c.post('/api/auth/totp/disable', headers=HDRS, json={'code': later, 'password': PASSWORD})
        self.assertEqual(r.status_code, 200, r.text)
        _, r = self.login('carol')
        self.assertEqual(r.status_code, 200)


class AdminAndResetTest(ConfirmedAdultFixture, AppCase):
    def test_admin_requires_role_and_totp(self):
        self.assertEqual(self.client().post('/api/admin/invites', headers=HDRS, json={}).status_code, 401)
        member = self.user('member')
        self.assertEqual(self.code(member.post('/api/admin/invites', headers=HDRS, json={})), 'action_not_allowed')
        no_totp = self.user('admin1', roles=['admin'])
        self.assertEqual(self.code(no_totp.post('/api/admin/invites', headers=HDRS, json={})), 'totp_setup_required')
        admin = self.user('admin2', roles=['admin'], totp=True)
        self.assertEqual(admin.post('/api/admin/invites', headers=HDRS, json={}).status_code, 201)

    def test_reset_code_flow(self):
        admin = self.user('root', roles=['admin'], totp=True)
        victim = self.user('dave')
        r = admin.post('/api/admin/reset-codes', headers=HDRS, json={'handle': 'dave'})
        self.assertEqual(r.status_code, 201, r.text)
        code = r.json()['data']['code']
        anon = self.client()
        r = anon.post('/api/auth/reset', headers=HDRS, json={'handle': 'root', 'reset_code': code,
                                                              'new_password': 'new password 22'})
        self.assertEqual(self.code(r), 'reset_invalid')
        r = anon.post('/api/auth/reset', headers=HDRS, json={'handle': 'dave', 'reset_code': code,
                                                              'new_password': 'new password 22'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.code(victim.get('/api/me')), 'session_expired')
        r = anon.post('/api/auth/reset', headers=HDRS, json={'handle': 'dave', 'reset_code': code,
                                                              'new_password': 'another pass 33'})
        self.assertEqual(self.code(r), 'reset_invalid')
        login = self.client().post('/api/auth/login', headers=HDRS, json={'handle': 'dave', 'password': 'new password 22'})
        self.assertEqual(login.status_code, 200)
        actions = {r[0] for r in self.db.conn().execute('SELECT action FROM audit_event')}
        self.assertTrue({'auth.reset_code.issue', 'auth.reset'} <= actions)

    def test_reset_code_expired(self):
        self.user('erin')
        with self.db.write() as conn:
            pid = accounts.principal_by_handle(conn, 'erin')
            code, _ = accounts.issue_reset_code(conn, pid, pid)
            conn.execute('UPDATE reset_code SET expires_at = ?', (clock.iso(time.time() - 1),))
        r = self.client().post('/api/auth/reset', headers=HDRS, json={'handle': 'erin', 'reset_code': code,
                                                                       'new_password': 'new password 22'})
        self.assertEqual(self.code(r), 'reset_invalid')

    def test_roles_endpoint(self):
        admin = self.user('root', roles=['admin'], totp=True)
        self.user('frank')
        r = admin.post('/api/admin/roles', headers=HDRS, json={'handle': 'frank', 'role': 'governor'})
        self.assertEqual(r.status_code, 200, r.text)
        frank = self.client()
        frank.post('/api/auth/login', headers=HDRS, json={'handle': 'frank', 'password': PASSWORD})
        self.assertIn('governor', frank.get('/api/me').json()['data']['roles'])
        r = admin.post('/api/admin/roles', headers=HDRS, json={'handle': 'frank', 'role': 'emperor'})
        self.assertEqual(self.code(r), 'validation_failed')


class AccountTest(ConfirmedAdultFixture, AppCase):
    def test_export_delete_cancel_purge(self):
        c = self.user('gina', level=2)
        self.obj(c, title='我的知识', type='knowledge')
        r = c.get('/api/me/export')
        self.assertEqual(r.status_code, 200)
        self.assertIn('attachment', r.headers['content-disposition'])
        self.assertEqual(len(r.json()['data']['objects']), 1)
        r = c.post('/api/me/delete', headers=HDRS, json={'password': 'wrong password'})
        self.assertEqual(self.code(r), 'invalid_credentials')
        r = c.post('/api/me/delete', headers=HDRS, json={'password': PASSWORD})
        self.assertEqual(r.json()['data']['status'], 'pending_deletion')
        self.assertEqual(self.obj(c, status=403)['error']['code'], 'action_not_allowed')
        self.assertEqual(c.post('/api/me/delete/cancel', headers=HDRS).status_code, 200)
        c.post('/api/me/delete', headers=HDRS, json={'password': PASSWORD})
        with self.db.write() as conn:
            conn.execute('UPDATE principal SET delete_requested_at = ?', (clock.iso(time.time() - 8 * 86400),))
        purged = accounts.purge_due(self.db, self.settings)
        self.assertEqual(purged, [c.pid])
        conn = self.db.conn()
        self.assertEqual(conn.execute('SELECT status FROM principal WHERE id = ?', (c.pid,)).fetchone()[0], 'deleted')
        kept = conn.execute("SELECT lifecycle, visibility FROM object_head WHERE author_id = ?", (c.pid,)).fetchone()
        self.assertEqual((kept['lifecycle'], kept['visibility']), ('active', 'members'))
        self.assertEqual(conn.execute('SELECT display_name FROM profile WHERE principal_id = ?',
                                      (c.pid,)).fetchone()[0], '已注销成员')
        self.assertEqual(conn.execute('SELECT count(*) FROM search_doc').fetchone()[0], 1)
        self.assertEqual(self.code(c.get('/api/me')), 'session_expired')


if __name__ == '__main__':
    unittest.main()
