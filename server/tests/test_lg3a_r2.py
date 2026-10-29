"""LG-3A R2: adult fixture consent and content-free withdrawal records."""
import json
from pathlib import Path

from app import withdrawals
from tests.helpers import AppCase, HDRS, PASSWORD


class AdultRegistrationMixin:
    """Explicit adult consent for this lane; shared helpers belong to LG-2."""

    def register(self, client, handle, code=None, password=PASSWORD):
        return client.post('/api/auth/register', headers=HDRS, json={
            'invite_code': code or self.invite(), 'handle': handle,
            'password': password, 'display_name': handle, 'adult_confirmed': True})


class LG3AR2Withdrawals(AdultRegistrationMixin, AppCase):
    def test_withdrawal_records_current_version_reason_and_no_content(self):
        owner = self.user('lg3a_r2_owner')
        item = self.obj(owner, title='Private title never logged', content={'body': 'Private body never logged'})
        edited = owner.patch('/api/objects/' + item['id'], headers={**HDRS, 'If-Match': item['etag']},
                             json={'content': {'body': 'Changed body never logged'}})
        self.assertEqual(edited.status_code, 200, edited.text)
        version = edited.json()['data']['version']
        for bad in ('not a code', 'a' * 41):
            r = owner.post('/api/objects/' + item['id'] + '/withdraw', headers=HDRS,
                           json={'reason_code': bad})
            self.assertEqual(r.status_code, 422, r.text)
        reason = 'author.withdraw'
        r = owner.post('/api/objects/' + item['id'] + '/withdraw', headers=HDRS,
                       json={'reason_code': reason})
        self.assertEqual(r.status_code, 200, r.text)
        lines = Path(self.settings.withdrawal_log).read_text().splitlines()
        record = json.loads(lines[-1])
        self.assertEqual(record['object_id'], item['id'])
        self.assertEqual(record['actor'], owner.pid)
        self.assertEqual((record['version'], record['reason'], record['ns']), (version, reason, 'object'))
        self.assertEqual(set(record), {'seq', 'ns', 'object_id', 'version', 'reason', 'at', 'actor'})
        self.assertNotIn('never logged', '\n'.join(lines))
        self.assertEqual(withdrawals.check_chain(self.settings.withdrawal_log, lines), [])
        audit = self.db.conn().execute("SELECT reason_code FROM audit_event WHERE action = 'object.withdraw' AND target_id = ?",
                                       (item['id'],)).fetchone()
        self.assertIsNotNone(audit)
        self.assertEqual(audit['reason_code'], reason)
