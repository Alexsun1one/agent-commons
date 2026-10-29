"""LG-5 gate 5: security baseline. Disposable TestClient fixtures only; no server, no network."""
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from app import security
from app.settings import Settings
from tests.helpers import HDRS, PASSWORD, AppCase, make_settings

ROOT = Path(__file__).resolve().parents[2]
CADDYFILE = (ROOT / 'deploy' / 'Caddyfile').read_text()
PREVIEW = ROOT / 'preview'
CONTENT = 'https://content.example.invalid'
LIVEKIT = 'wss://rtc.example.invalid'


def caddy_block(name):
    start = CADDYFILE.index('{$' + name + '} {')
    return CADDYFILE[start:CADDYFILE.index('\n}\n', start)]


def directive(block, field):
    return re.search(rf'^\s*{re.escape(field)} "([^"]*)"', block, re.M).group(1)


class SessionCookieTest(AppCase):
    def register(self, client, handle, code=None, password=PASSWORD):
        # tests/helpers.py is frozen and predates the server-side 18+ confirmation (LG-2 R2); see requests/LG-5.md.
        return client.post('/api/auth/register', headers=HDRS, json={
            'invite_code': code or self.invite(), 'handle': handle, 'password': password, 'display_name': handle,
            'adult_confirmed': True})

    def test_host_prefixed_cookie_is_secure_httponly_and_host_only(self):
        r = self.register(self.client(), 'lg5cookie')
        self.assertEqual(r.status_code, 201, r.text)
        raw = r.headers['set-cookie']
        self.assertTrue(raw.startswith('__Host-sid='), raw)
        attrs = [part.strip().lower() for part in raw.split(';')[1:]]
        for needed in ('secure', 'httponly', 'path=/', 'samesite=lax'):
            self.assertIn(needed, attrs)
        self.assertFalse([a for a in attrs if a.startswith('domain')], 'a __Host- cookie must not carry Domain')

    def test_host_prefix_without_secure_is_refused_at_construction(self):
        with self.assertRaises(ValueError):
            make_settings(self.tmp, cookie_secure=False)

    def test_logout_clears_the_same_cookie_scope(self):
        c = self.client()
        self.register(c, 'lg5logout')
        r = c.post('/api/auth/logout', headers=HDRS)
        self.assertEqual(r.status_code, 200, r.text)
        cleared = r.headers['set-cookie'].lower()
        self.assertIn('__host-sid=', cleared)
        self.assertIn('path=/', cleared)
        self.assertIn('secure', cleared)


class ResponseHeaderTest(AppCase):
    def test_media_file_has_a_single_url_under_api(self):
        paths = {getattr(r, 'path', '') for r in self.app.routes}
        self.assertIn('/api/media/f/{name}', paths)
        self.assertNotIn('/media/f/{name}', paths)

    def test_csp_and_friends_on_api_and_error_responses(self):
        c = self.client()
        for r in (c.get('/api/flags'), c.get('/api/me'), c.get('/api/unknown')):
            csp = r.headers['content-security-policy']
            self.assertIn("script-src 'self';", csp)
            self.assertEqual(r.headers['x-content-type-options'], 'nosniff')
            self.assertEqual(r.headers['referrer-policy'], 'strict-origin-when-cross-origin')
            self.assertIn('max-age=31536000', r.headers['strict-transport-security'])
            self.assertEqual(r.headers['cache-control'], 'no-store')

    def test_csp_forbids_inline_and_eval_scripts(self):
        csp = self.client().get('/api/flags').headers['content-security-policy']
        script = next(d for d in csp.split('; ') if d.startswith('script-src'))
        self.assertEqual(script, "script-src 'self'")
        for banned in ("'unsafe-eval'", "'unsafe-inline'", 'data:', 'http:', 'https:', '*'):
            self.assertNotIn(banned, script)
        for needed in ("object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"):
            self.assertIn(needed, csp)

    def test_frame_src_follows_content_origin(self):
        self.assertIn("frame-src 'none'", security.build_csp())
        self.assertIn(f'frame-src {CONTENT};', security.build_csp(CONTENT))


class StaticShellHeaderTest(AppCase):
    def setUp(self):
        static = Path(tempfile.mkdtemp(prefix='commons-site-'))
        self.addCleanup(shutil.rmtree, static, True)
        (static / 'index.html').write_text('<!doctype html><title>x</title>')
        self.overrides = {'static_dir': str(static), 'content_origin': CONTENT, 'livekit_ws_url': LIVEKIT}
        super().setUp()

    def test_shell_served_by_the_app_carries_the_same_csp(self):
        r = self.client().get('/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers['content-security-policy'], security.build_csp(CONTENT, LIVEKIT))
        self.assertIn(f'connect-src \'self\' {LIVEKIT};', r.headers['content-security-policy'])

    def test_same_host_livekit_url_is_not_repeated_in_connect_src(self):
        headers = security.response_headers(make_settings(self.tmp, livekit_ws_url='wss://commons.test'))
        self.assertIn("connect-src 'self';", headers['Content-Security-Policy'])


class InsecureLocalModeTest(unittest.TestCase):
    def test_local_http_mode_has_no_hsts_and_no_host_prefix(self):
        settings = Settings(db_path=':memory:', secret_key=b'x' * 32, public_origin='http://127.0.0.1:8000',
                            cookie_name='commons_sid', cookie_secure=False)
        headers = security.response_headers(settings)
        self.assertNotIn('Strict-Transport-Security', headers)
        self.assertIn("script-src 'self'", headers['Content-Security-Policy'])


class DomainSeparationTest(unittest.TestCase):
    def build(self, site, content):
        return Settings(db_path=':memory:', secret_key=b'x' * 32, public_origin=f'https://{site}',
                        content_origin=f'https://{content}')

    def test_user_content_must_not_share_the_site_registrable_domain(self):
        self.build('commons.example', 'usercontent.example')
        for site, content in (('commons.example', 'commons.example'), ('commons.example', 'c.commons.example'),
                              ('www.commons.example', 'commons.example')):
            with self.subTest(site=site, content=content), self.assertRaises(ValueError):
                self.build(site, content)

    def test_a_suffix_lookalike_is_not_a_subdomain(self):
        self.build('commons.example', 'xcommons.example')


class CaddyfileConsistencyTest(unittest.TestCase):
    def test_main_site_csp_matches_the_app_builder(self):
        main = caddy_block('COMMONS_SITE_DOMAIN')
        csp = (directive(main, 'Content-Security-Policy')
               .replace('{$COMMONS_CONTENT_DOMAIN}', 'content.example.invalid')
               .replace('{$COMMONS_LIVEKIT_DOMAIN}', 'rtc.example.invalid'))
        self.assertEqual(csp, security.build_csp(CONTENT, LIVEKIT))

    def test_main_site_other_headers_match_the_app(self):
        main = caddy_block('COMMONS_SITE_DOMAIN')
        settings = Settings(db_path=':memory:', secret_key=b'x' * 32, public_origin='https://commons.example')
        app_headers = security.response_headers(settings)
        for field in ('Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy'):
            self.assertEqual(directive(main, field), app_headers[field], field)
        self.assertIn('header Cache-Control "no-store"', main)

    def test_user_content_domain_is_sandboxed_cookieless_and_html_only(self):
        block = caddy_block('COMMONS_CONTENT_DOMAIN')
        csp = directive(block, 'Content-Security-Policy')
        self.assertTrue(csp.startswith('sandbox allow-scripts;'))
        self.assertNotIn('allow-same-origin', csp)
        self.assertIn("connect-src 'none'", csp)
        self.assertIn('frame-ancestors https://{$COMMONS_SITE_DOMAIN}', csp)
        self.assertIn('-Set-Cookie', block)
        self.assertIn('nosniff', block)
        route = re.search(r'path_regexp work (\S+)', block).group(1)
        self.assertRegex('/c/html_work/' + 'ab' * 32, route)
        for kind in ('upload_raw', 'img_webp', 'img_jpeg', 'img_avif', 'account_export'):
            self.assertNotRegex(f'/c/{kind}/' + 'ab' * 32, route, kind)
        self.assertRegex(block, r'handle \{\s*respond 404\s*\}')

    def test_caddy_route_maps_to_the_storage_layout(self):
        from app.storage import LocalStorage
        sha = 'ab' * 32
        storage = LocalStorage('/srv/commons-user-content', CONTENT)
        block = caddy_block('COMMONS_CONTENT_DOMAIN')
        route = re.search(r'path_regexp work (\S+)', block).group(1)
        m = re.match(route, f'/c/html_work/{sha}')
        rewritten = f'/html_work/{m.group(1)}/{m.group(1)}{m.group(2)}'
        self.assertEqual(str(storage.root) + rewritten, str(storage._path(f'html_work/{sha}')))
        self.assertEqual(storage.content_url(f'html_work/{sha}'), f'{CONTENT}/c/html_work/{sha}')


class FrontendCspTest(unittest.TestCase):
    """Under script-src 'self' inline handler attributes never run. LG-5 found avatar.js:211 and digest.js:403/412
    (img onerror); LG-6B replaced them with property handlers, so the allowed set is now empty."""
    HANDLER = re.compile(r'''\s(on[a-z]{3,})\s*=\s*\\?["']''')

    def test_shell_pages_have_no_inline_script_or_handler(self):
        for name in ('index.html', 'offline.html'):
            text = (PREVIEW / name).read_text()
            with self.subTest(page=name):
                self.assertEqual(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>', text, re.I), [])
                self.assertEqual(re.findall(r'\son[a-z]+\s*=', text, re.I), [])
                self.assertNotIn('javascript:', text.lower())

    def test_scripts_do_not_emit_inline_event_handler_attributes(self):
        found = set()
        for path in PREVIEW.glob('*.js'):
            for line in path.read_text().splitlines():
                if '<' in line:
                    found |= {(path.name, m.group(1)) for m in self.HANDLER.finditer(line)}
        self.assertEqual(found, set(), 'inline handler attributes break script-src self')

    def test_html_render_keeps_sample_data_out_of_the_live_script(self):
        live = (PREVIEW / 'html-render.js').read_text()
        for demo_only in ('陈墨', '林栖', '余岚', '松原', '周迭代看板'):
            self.assertNotIn(demo_only, live)
        self.assertIn('COMMONS_HTML_RENDER_SAMPLE', live)
        self.assertTrue((PREVIEW / 'html-render-sample.js').exists())

    def test_live_html_preview_loads_content_url_not_srcdoc(self):
        live = (PREVIEW / 'html-render.js').read_text()
        start = live.index('function loadLive()')
        body = live[start:live.index('function load()', start)]
        self.assertNotIn('srcdoc', body)
        self.assertIn('iframe.src = url.href', body)
        self.assertIn("event.origin !== 'null'", live)
        self.assertIn('event.source !== iframe.contentWindow', live)

    def test_no_eval_in_first_party_scripts(self):
        offenders = []
        for path in PREVIEW.glob('*.js'):
            text = path.read_text()
            if re.search(r'(?<![\w.$])eval\(|new Function\(', text) and path.name not in ('html-render.js', 'html-render-sample.js'):
                offenders.append(path.name)
        self.assertEqual(offenders, [])


if __name__ == '__main__':
    unittest.main()
