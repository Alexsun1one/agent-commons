"""LG-6B R5 · 登录页、退出、注册后 refresh。"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'

HTML_ON = re.compile(
    r'''\bon(?:click|dblclick|error|load|change|submit|input|keyup|keydown|keypress|focus|blur|mouse\w+|pointer\w+|touch\w+)\s*=\s*["']''',
    re.I,
)
OWNED = ['auth.js', 'account.js', 'onboard.js', 'landing.js']


class Lg6bR5Auth(unittest.TestCase):
    def test_owned_js_have_no_html_inline_events(self):
        hits = []
        for name in OWNED:
            text = (PREVIEW / name).read_text(encoding='utf-8')
            for match in HTML_ON.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{name}:{line}:{match.group(0)}')
        self.assertEqual(hits, [])

    def test_auth_module_covers_login_totp_reset_and_legal(self):
        text = (PREVIEW / 'auth.js').read_text(encoding='utf-8')
        self.assertIn("routes: { login: view }", text)
        self.assertIn("bare: ['login']", text)
        self.assertIn("post('/auth/login'", text)
        self.assertIn("post('/auth/reset'", text)
        self.assertIn("totp_code: code", text)
        self.assertIn("演示版不连接账号", text)
        for code in ('invalid_credentials', 'totp_required', 'totp_invalid', 'rate_limited'):
            self.assertIn(code, text)
        self.assertIn('sess.refresh', text)
        self.assertIn('session.returnTo', text)
        self.assertIn('#/welcome', text)
        for href in ('legal/rules.html', 'legal/terms.html', 'legal/privacy.html',
                     'legal/age-18.html', 'legal/retention.html'):
            self.assertIn(href, text)
        self.assertIn('window.CommonsAuth', text)
        self.assertTrue((PREVIEW / 'auth.css').is_file())

    def test_account_onboard_landing_wire_session(self):
        account = (PREVIEW / 'account.js').read_text(encoding='utf-8')
        self.assertIn('data-acc-act="signout"', account)
        self.assertIn('session.signOut', account)

        onboard = (PREVIEW / 'onboard.js').read_text(encoding='utf-8')
        self.assertIn('session.refresh', onboard)
        self.assertIn("C().go('home')", onboard)

        landing = (PREVIEW / 'landing.js').read_text(encoding='utf-8')
        self.assertIn('href="#/login"', landing)
        self.assertIn('用邀请码加入', landing)
        self.assertNotIn('我有邀请码', landing)
        self.assertNotIn('href="#/hot"', landing)
