"""Governance HTML preview exposes the current asset reference, not HTML bytes."""
from modules.governance.tests.test_governance import GovCase
from modules.media.tests.base import BE1Case
from tests.helpers import HDRS


class GovernanceHtmlPreviewTest(GovCase, BE1Case):
    overrides = {'content_origin': 'https://commons-content.test'}

    def test_current_work_asset_id_and_media_url_without_html_body(self):
        author, reporter, governor = self.user('author', 2), self.user('reporter', 2), self.gov('governor')
        secret = '<!doctype html><html><body>PRIVATE_HTML_ASSET_BODY</body></html>'
        first = self.asset(author, secret.encode(), 'first.html', 'html')
        work = self.rich(author, type='work', content={'html_asset': first['id']})
        self.drain()
        self.report(reporter, work['id'])
        path = f'/api/governance/cases/{self.case_of(work["id"])["id"]}'
        preview = self.get(governor, path)['preview']
        self.assertEqual((preview['asset_id'], preview['version'], preview['has_html']), (first['id'], 1, True))
        self.assertNotIn('html', preview)
        self.assertNotIn('PRIVATE_HTML_ASSET_BODY', str(preview))
        meta = self.get(governor, f'/api/media/assets/{first["id"]}')
        self.assertTrue(meta['content_url'].startswith('https://commons-content.test/c/html_work/'))
        self.assertNotIn('html', meta)
        for client in (author, reporter, self.client()):
            self.assertEqual(client.get(path).status_code, 404)

        second = self.asset(author, secret.replace('BODY', 'V2').encode(), 'second.html', 'html')
        etag = self.get(author, f'/api/objects/{work["id"]}')['etag']
        updated = author.patch(f'/api/objects/{work["id"]}', headers={**HDRS, 'If-Match': etag},
                               json={'content': {'html_asset': second['id']}})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.drain()
        preview = self.get(governor, path)['preview']
        self.assertEqual((preview['asset_id'], preview['version']), (second['id'], 2))

    def test_missing_asset_and_withdrawn_work_do_not_leak_preview_source(self):
        author, reporter, governor = self.user('author', 2), self.user('reporter', 2), self.gov('governor')
        work = self.rich(author, type='work')
        self.report(reporter, work['id'])
        path = f'/api/governance/cases/{self.case_of(work["id"])["id"]}'
        preview = self.get(governor, path)['preview']
        self.assertIsNone(preview['asset_id'])
        self.assertFalse(preview['has_html'])
        self.assertNotIn('html', preview)
        withdrawn = author.post(f'/api/objects/{work["id"]}/withdraw', headers=HDRS)
        self.assertEqual(withdrawn.status_code, 200, withdrawn.text)
        preview = self.get(governor, path)['preview']
        self.assertEqual(preview['state'], 'withdrawn')
        self.assertNotIn('asset_id', preview)
        self.assertNotIn('html', preview)

    def test_hidden_work_keeps_media_access_policy(self):
        author, reporter, governor = self.user('author', 2), self.user('reporter', 2), self.gov('governor')
        asset = self.asset(author, b'<!doctype html><html><body>Hidden work</body></html>', 'hidden.html', 'html')
        work = self.rich(author, type='work', content={'html_asset': asset['id']})
        self.drain()
        self.report(reporter, work['id'])
        path = f'/api/governance/cases/{self.case_of(work["id"])["id"]}'
        self.ok(governor, 'POST', path + '/actions', {'type': 'hide', 'reason': '待核查'})
        preview = self.get(governor, path)['preview']
        self.assertEqual((preview['state'], preview['asset_id']), ('hidden', asset['id']))
        # Passing an id does not grant content access. Cross-module permission changes need a separate decision.
        self.assertEqual(governor.get(f'/api/media/assets/{asset["id"]}').status_code, 404)
