"""LG-4 R2: governance uses the shared withdrawal writer exactly once."""
import json
from pathlib import Path
from unittest import mock

from app import objects, withdrawals
from modules.governance.tests.test_governance import GovCase
from tests.helpers import HDRS, PASSWORD


class GovernanceWithdrawalLogTest(GovCase):
    def register(self, client, handle, code=None, password=PASSWORD):
        return client.post('/api/auth/register', headers=HDRS, json={
            'invite_code': code or self.invite(), 'handle': handle, 'password': password,
            'display_name': handle, 'adult_confirmed': True})

    def test_confirmed_delete_logs_current_version_and_short_reason_once(self):
        first, second = self.gov('first'), self.gov('second')
        author, reporter = self.user('author', 2), self.user('reporter', 2)
        title, body, reason = 'PRIVATE_TITLE', 'PRIVATE_BODY', 'PRIVATE_OPERATOR_REASON'
        oid = self.post_obj(author, body=body, title=title)
        etag = self.get(author, f'/api/objects/{oid}')['etag']
        updated = author.patch(f'/api/objects/{oid}', headers={
            'Origin': 'https://commons.test', 'X-Commons-CSRF': '1', 'If-Match': etag,
        }, json={'content': {'body': body + '_UPDATED'}})
        self.assertEqual(updated.status_code, 200, updated.text)
        head = self.one('SELECT * FROM object_head WHERE id = ?', oid)
        self.assertEqual(head['current_version'], 2)
        self.report(reporter, oid)
        case = self.case_of(oid)['id']
        proposal = self.ok(first, 'POST', f'/api/governance/cases/{case}/actions',
                           {'type': 'delete', 'reason': reason})
        self.assertEqual(proposal['state'], 'awaiting_second')
        self.assertFalse(Path(self.settings.withdrawal_log).exists())
        with mock.patch.object(objects, 'withdraw', wraps=objects.withdraw) as writer:
            self.ok(second, 'POST', f'/api/governance/actions/{proposal["action_id"]}/confirm')
        writer.assert_called_once()
        self.assertEqual(writer.call_args.args[3]['current_version'], 2)
        self.assertEqual(writer.call_args.kwargs['reason'], 'gov_delete')
        payload = Path(self.settings.withdrawal_log).read_text()
        rows = [json.loads(line) for line in payload.splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['object_id'], rows[0]['ns'], rows[0]['version'], rows[0]['reason']),
                         (oid, 'object', 2, 'gov_delete'))
        for private_text in (title, body, reason):
            self.assertNotIn(private_text, payload)
        self.assertEqual(withdrawals.check_chain(self.settings.withdrawal_log, payload.splitlines()), [])
