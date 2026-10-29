"""LG-6B R6 · 登录跳转与换账号缓存。"""
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
OWNED = ['auth.js', 'social.js', 'dm.js', 'notify.js', 'growth.js', 'economy.js']


class Lg6bR6SessionCache(unittest.TestCase):
    def test_owned_js_have_no_html_inline_events(self):
        hits = []
        for name in OWNED:
            text = (PREVIEW / name).read_text(encoding='utf-8')
            for match in HTML_ON.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{name}:{line}:{match.group(0)}')
        self.assertEqual(hits, [])

    def test_auth_waits_for_member_and_keeps_full_hash(self):
        text = (PREVIEW / 'auth.js').read_text(encoding='utf-8')
        self.assertIn('stillOnLogin', text)
        self.assertIn("sess.state !== 'member'", text)
        self.assertIn('账号信息没有加载出来，请重试。', text)
        self.assertIn('takeReturnHash', text)
        self.assertIn('location.hash = hash', text)
        self.assertIn('(?:\\/[A-Za-z0-9._~-]+)*', text)
        self.assertNotIn('.then(finish, finish)', text)

    def test_account_modules_reset_live_cache_on_session(self):
        for name in ('social.js', 'dm.js', 'notify.js', 'growth.js', 'economy.js'):
            text = (PREVIEW / name).read_text(encoding='utf-8')
            self.assertIn("addEventListener('commons:session'", text, name)
            self.assertIn('function sessionAccount', text, name)
            self.assertIn('function resetLiveAccount', text, name)
            self.assertIn('me.id || me.handle', text, name)

        social = (PREVIEW / 'social.js').read_text(encoding='utf-8')
        self.assertIn('${sessionAccount()}:', social)
        self.assertIn('live.data = null', social)
        self.assertIn('live.request += 1', social)
