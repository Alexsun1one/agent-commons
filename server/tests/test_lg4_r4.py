"""Case-scoped HTML review does not grant general media visibility."""
import json
from unittest import mock

from app.storage import LocalStorage
from modules.governance.tests.test_governance import GovCase
from modules.media.tests.base import BE1Case
from tests.helpers import HDRS


class CasePreviewTest(GovCase, BE1Case):
    overrides = {'content_origin': 'https://commons-content.test'}

    def setUp(self):
        super().setUp()
        self.author, self.reporter, self.governor = self.user('author', 2), self.user('reporter', 2), self.gov('reviewer')
        self.asset1, self.work1, self.case1 = self.make_work('FIRST_PRIVATE_BODY')

    def make_work(self, marker):
        asset = self.asset(self.author, f'<!doctype html><html><body>{marker}</body></html>'.encode(), 'work.html', 'html')
        work = self.rich(self.author, type='work', title='PRIVATE_TITLE', content={'html_asset': asset['id']})
        self.drain()
        self.report(self.reporter, work['id'])
        case = self.case_of(work['id'])['id']
        self.ok(self.governor, 'POST', f'/api/governance/cases/{case}/actions', {'type': 'hide', 'reason': '审核'})
        return asset, work, case

    def read_preview(self, client, case=None, asset=None):
        return client.get(f'/api/governance/cases/{case or self.case1}/preview',
                          params={'asset_id': asset or self.asset1['id']})

    def audit_rows(self):
        return self.db.conn().execute("SELECT * FROM audit_event WHERE action = 'gov.case.preview' ORDER BY rowid").fetchall()

    def test_role_totp_gate_and_exact_per_request_audit(self):
        admin = self.user('admin', 1, roles=('admin',), totp=True)
        for client in (self.governor, self.governor, admin):
            with mock.patch.object(LocalStorage, 'read', side_effect=AssertionError('must not read HTML bytes')):
                response = self.read_preview(client)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(set(response.json()['data']), {'content_url'})
            self.assertRegex(response.json()['data']['content_url'],
                             r'^https://commons-content\.test/c/html_work/[a-f0-9]{64}$')
        for client, status in ((self.author, 404), (self.client(), 404),
                               (self.user('no_totp', roles=('governor',)), 403),
                               (self.user('admin_no_totp', roles=('admin',)), 403)):
            response = self.read_preview(client)
            self.assertEqual(response.status_code, status, response.text)
            if status == 403:
                self.assertEqual(self.code(response), 'totp_setup_required')
        rows = self.audit_rows()
        self.assertEqual(len(rows), 7)
        self.assertEqual([r['outcome'] for r in rows], ['ok'] * 3 + ['denied'] * 4)
        for row in rows[:3]:
            self.assertEqual((row['target_id'], row['reason_code']), (self.case1, 'case_review'))
            self.assertEqual(json.loads(row['meta_json']), {'object_id': self.work1['id'], 'asset_id': self.asset1['id']})
        for row in rows[3:]:
            self.assertIsNone(row['target_id'])
            self.assertEqual(json.loads(row['meta_json']), {})
        self.assertNotIn('PRIVATE', str([dict(r) for r in rows]))
        self.assertNotIn('https://', str([dict(r) for r in rows]))
        self.assertEqual(self.governor.get(f'/api/media/assets/{self.asset1["id"]}').status_code, 404)

    def test_other_case_and_old_version_assets_are_404(self):
        other, _, case2 = self.make_work('SECOND_PRIVATE_BODY')
        for case, asset in ((self.case1, other['id']), (case2, self.asset1['id']), ('missing-case', self.asset1['id'])):
            response = self.read_preview(self.governor, case, asset)
            self.assertEqual((response.status_code, self.code(response)), (404, 'resource_not_found'))
        # A report may refer to v1, but preview access always resolves the current object version.
        etag = self.get(self.author, f'/api/objects/{self.work1["id"]}')['etag']
        updated = self.author.patch(f'/api/objects/{self.work1["id"]}', headers={**HDRS, 'If-Match': etag},
                                    json={'content': {'html_asset': other['id']}})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(self.read_preview(self.governor).status_code, 404)
        self.assertEqual(self.read_preview(self.governor, asset=other['id']).status_code, 200)
        self.assertEqual(len(self.audit_rows()), 5)

    def test_withdrawn_missing_reference_and_wrong_storage_kind_are_404(self):
        row = self.db.conn().execute('SELECT file_key FROM media_asset WHERE id = ?', (self.asset1['id'],)).fetchone()
        with self.db.write() as conn:
            conn.execute('UPDATE media_asset SET file_key = ? WHERE id = ?', ('upload_raw/' + 'a' * 64, self.asset1['id']))
        self.assertEqual(self.read_preview(self.governor).status_code, 404)
        with self.db.write() as conn:
            conn.execute('UPDATE media_asset SET file_key = ? WHERE id = ?', (row['file_key'], self.asset1['id']))
        etag = self.get(self.author, f'/api/objects/{self.work1["id"]}')['etag']
        response = self.author.patch(f'/api/objects/{self.work1["id"]}', headers={**HDRS, 'If-Match': etag},
                                     json={'content': {}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.read_preview(self.governor).status_code, 404)
        response = self.author.post(f'/api/objects/{self.work1["id"]}/withdraw', headers=HDRS)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.read_preview(self.governor).status_code, 404)
        self.assertEqual(len(self.audit_rows()), 3)

    def test_missing_content_origin_fails_without_url_and_is_audited(self):
        with mock.patch.object(LocalStorage, 'content_url', wraps=LocalStorage.content_url) as build:
            with mock.patch.object(self.settings, 'content_origin', ''):
                response = self.read_preview(self.governor)
            self.assertEqual(response.status_code, 503, response.text)
            build.assert_not_called()
        self.assertEqual(self.audit_rows()[0]['reason_code'], 'service_unavailable')
