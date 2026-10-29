import os
import secrets
import shutil
import tempfile
import unittest

from fastapi.testclient import TestClient

from app import accounts, security
from app.main import create_app
from app.settings import Settings

ORIGIN = 'https://commons.test'
HDRS = {'Origin': ORIGIN, 'X-Commons-CSRF': '1'}
PASSWORD = 'correct horse 1'


def make_settings(tmp, **over):
    base = dict(
        db_path=os.path.join(tmp, 'commons.db'),
        secret_key=secrets.token_bytes(32),
        backup_dir=os.path.join(tmp, 'backups'),
        storage_dir=os.path.join(tmp, 'files'),
        withdrawal_log=os.path.join(tmp, 'withdrawals.jsonl'),
        public_origin=ORIGIN,
        scrypt_n=2 ** 8,
        rate_limits={'auth': (1000, 60), 'write': (10000, 60), 'admin': (1000, 60)},
    )
    base.update(over)
    return Settings(**base)


class AppCase(unittest.TestCase):
    overrides = {}

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='commons-test-')
        self.settings = make_settings(self.tmp, **self.overrides)
        self.app = create_app(self.settings)
        self.db = self.app.state.db

    def tearDown(self):
        self.db.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def client(self):
        return TestClient(self.app, base_url=ORIGIN)

    def invite(self, max_uses=1, days=7):
        with self.db.write() as conn:
            return accounts.issue_invite(conn, None, max_uses, days)[1]

    def register(self, client, handle, code=None, password=PASSWORD, adult_confirmed=True):
        return client.post('/api/auth/register', headers=HDRS, json={
            'invite_code': code or self.invite(), 'handle': handle, 'password': password, 'display_name': handle,
            'adult_confirmed': adult_confirmed})

    def user(self, handle, level=1, roles=(), totp=False):
        c = self.client()
        r = self.register(c, handle)
        self.assertEqual(r.status_code, 201, r.text)
        pid = r.json()['data']['id']
        with self.db.write() as conn:
            conn.execute('UPDATE profile SET level = ? WHERE principal_id = ?', (level, pid))
            for role in roles:
                accounts.set_role(conn, None, pid, role)
        if totp:
            secret = c.post('/api/auth/totp/setup', headers=HDRS).json()['data']['secret']
            r = c.post('/api/auth/totp/enable', headers=HDRS, json={'code': security.totp_now(secret)})
            self.assertEqual(r.status_code, 200, r.text)
            c.totp_secret = secret
        c.pid = pid
        return c

    def obj(self, client, status=201, **body):
        body.setdefault('type', 'discussion')
        body.setdefault('title', '标题')
        body.setdefault('content', {'body': '正文'})
        r = client.post('/api/objects', headers=HDRS, json=body)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 201 else r.json()

    def code(self, response):
        return response.json()['error']['code']
