"""LG-6B R7 · 真实模式死循环、limit 上限、首页身份。"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'
SKIP = {'api.js', 'app.js', 'govern.js', 'admin.js', 'pwa.js', 'navigation.js'}

LOAD_LIVE = re.compile(r'(?:async\s+)?function\s+loadLive\s*\([^)]*\)\s*\{', re.M)
LIMIT = re.compile(r'\blimit\s*:\s*(\d+)')
HTML_ON = re.compile(
    r'''\bon(?:click|dblclick|error|load|change|submit|input|keyup|keydown|keypress|focus|blur|mouse\w+|pointer\w+|touch\w+)\s*=\s*["']''',
    re.I,
)
CRASH_MOUNT = re.compile(
    r'if\s*\(\s*isLive\(\)\s*&&\s*!state\.live\s*&&\s*!state\.liveError\s*&&\s*!state\.liveLoading\s*\)\s*loadLive\s*\(\s*\)'
)


def owned_js():
    return sorted(
        p for p in PREVIEW.glob('*.js')
        if not p.name.endswith('-sample.js')
        and p.name not in SKIP
        and not p.name.startswith('hubs.')
        and 'vendor' not in p.parts
    )


def load_live_body(text: str, start: int) -> str:
    depth = 0
    i = start
    while i < len(text):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
        i += 1
    return text[start:]


def head_before_request(body: str) -> str:
    stripped = re.sub(
        r'if\s*\([^;{]+\)\s*\{[^{}]*?(?:liveError|error)\s*=[^{}]*?(?:Commons\.refresh|refresh\(\))[^{}]*?return;?[^{}]*?\}',
        '',
        body,
        flags=re.S,
    )
    request = re.search(
        r'(?:CommonsAPI|\.get\(|\.post\(|fetchPaged\(|apiGet\(|\brequest\(|reloadLive\(|Promise\.(?:all|resolve))',
        stripped,
    )
    return stripped[:request.start()] if request else stripped


class Lg6bR7LiveFaults(unittest.TestCase):
    def test_load_live_does_not_sync_refresh_before_request(self):
        hits = []
        scanned = []
        for path in owned_js():
            text = path.read_text(encoding='utf-8')
            if 'function loadLive' not in text and 'async function loadLive' not in text:
                continue
            scanned.append(path.name)
            for match in LOAD_LIVE.finditer(text):
                head = head_before_request(load_live_body(text, match.end() - 1))
                if 'Commons.refresh' in head or 'C().refresh' in head:
                    hits.append(f'{path.name}: loadLive refreshes before request')
                if re.search(r'(?<!liveBag\.)(?<!function )refresh\(\)|rerender\(\)|paint\(\)|refreshPage\(\)|refreshLive\(\)', head):
                    after_guards = re.sub(r'if\s*\([^;{]+\)\s*return;?', '', head)
                    if re.search(r'(?<!liveBag\.)(?<!function )refresh\(\)|rerender\(\)|paint\(\)|refreshPage\(\)|refreshLive\(\)', after_guards):
                        hits.append(f'{path.name}: loadLive redraws before request')
        self.assertIn('orgs.js', scanned)
        self.assertIn('events.js', scanned)
        self.assertIn('market.js', scanned)
        self.assertEqual(hits, [])
        for name in ('orgs.js', 'events.js', 'market.js'):
            text = (PREVIEW / name).read_text(encoding='utf-8')
            self.assertIn('liveLoading', text)
            self.assertRegex(text, CRASH_MOUNT)

    def test_preview_live_requests_keep_limit_at_most_50(self):
        hits = []
        for path in owned_js():
            text = path.read_text(encoding='utf-8')
            for match in LIMIT.finditer(text):
                value = int(match.group(1))
                if value <= 50:
                    continue
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{path.name}:{line}:limit {value}')
        self.assertEqual(hits, [])
        social = (PREVIEW / 'social.js').read_text(encoding='utf-8')
        self.assertIn('PAGE_LIMIT = 50', social)
        self.assertIn('function fetchPaged', social)
        self.assertIn('meta.cursor', social)
        economy = (PREVIEW / 'economy.js').read_text(encoding='utf-8')
        self.assertIn('limit: 50', economy)

    def test_home_identity_reads_session_me_in_live(self):
        text = (PREVIEW / 'showcase.js').read_text(encoding='utf-8')
        self.assertIn('function homeMe()', text)
        self.assertIn('CommonsSession', text)
        self.assertIn('display_name', text)
        self.assertIn('avatar_ref', text)
        self.assertIn('const me=homeMe();', text)
        live_branch = text.split('function homeMe()')[1].split('function home()')[0]
        self.assertNotIn("'我'", live_branch)
        self.assertNotIn('"我"', live_branch)
        social = (PREVIEW / 'social.js').read_text(encoding='utf-8')
        self.assertIn('function sessionPerson()', social)
        self.assertIn('if (isLive()) return sessionPerson()', social)

    def test_owned_js_have_no_html_inline_events(self):
        hits = []
        for name in ('orgs.js', 'events.js', 'market.js', 'social.js', 'economy.js', 'showcase.js'):
            text = (PREVIEW / name).read_text(encoding='utf-8')
            for match in HTML_ON.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{name}:{line}:{match.group(0)}')
        self.assertEqual(hits, [])
