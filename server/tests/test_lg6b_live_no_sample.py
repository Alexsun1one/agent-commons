"""LG-6B · 真实模式不退回示例数据，也不写 HTML 内联事件。"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'

EXCLUDED = {
    'api.js', 'app.js', 'index.html',
    'hubs.js', 'hubs.css', 'navigation.js', 'navigation.css',
    'govern.js', 'govern.css', 'govern-sample.js',
}
EXCLUDED_PREFIXES = ('admin',)

HTML_ON = re.compile(
    r'''\bon(?:click|dblclick|error|load|change|submit|input|keyup|keydown|keypress|focus|blur|mouse\w+|pointer\w+|touch\w+)\s*=\s*["']''',
    re.I,
)
FALLBACK = re.compile(
    r'''isLive\(\)\s*&&\s*state\.live\s*\?\s*state\.live\s*:\s*sample\(\)'''
)
OWNED = [
    'avatar.js', 'digest.js', 'agentchat.js', 'kb.js', 'parking.js', 'pet.js',
    'growth.js', 'farm.js', 'market.js', 'library.js', 'events.js', 'notify.js',
    'orgs.js', 'calendar.js', 'talks.js', 'people.js', 'showcase.js', 'insights.js',
    'achievements.js', 'thread.js', 'buddies.js',
]


def owned_js():
    files = []
    for path in sorted(PREVIEW.glob('*.js')):
        name = path.name
        if name in EXCLUDED or name.endswith('-sample.js') or name.endswith('-data.js'):
            continue
        if name.startswith(EXCLUDED_PREFIXES):
            continue
        files.append(path)
    return files


class Lg6bLiveNoSample(unittest.TestCase):
    def test_owned_js_have_no_html_inline_events(self):
        hits = []
        for path in owned_js():
            text = path.read_text(encoding='utf-8')
            for match in HTML_ON.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{path.name}:{line}:{match.group(0)}')
        self.assertEqual(hits, [], 'HTML 内联事件还在: ' + '; '.join(hits))

    def test_known_inline_targets_are_clean(self):
        for name in ('avatar.js', 'digest.js', 'contributions.js'):
            text = (PREVIEW / name).read_text(encoding='utf-8')
            self.assertIsNone(HTML_ON.search(text), name)

    def test_agentchat_does_not_fall_back_to_sample_in_live(self):
        text = (PREVIEW / 'agentchat.js').read_text(encoding='utf-8')
        self.assertIsNone(FALLBACK.search(text))
        self.assertIn('if (isLive()) return state.live || emptyLive();', text)
        self.assertIn("me: payload.me || {}", text)
        self.assertNotIn('channels: channels.length ? channels : sample().channels', text)

    def test_owned_page_modules_detect_live(self):
        missing = []
        for name in OWNED:
            text = (PREVIEW / name).read_text(encoding='utf-8')
            if 'CommonsAPI.mode' not in text and 'function isLive' not in text and 'function live(' not in text:
                missing.append(name)
        self.assertEqual(missing, [])

    def test_digest_live_skips_sample_cards(self):
        text = (PREVIEW / 'digest.js').read_text(encoding='utf-8')
        self.assertIn('if (isLive()) return Array.isArray(live.cards) ? live.cards : [];', text)
        self.assertIn("data-digest-action=\"retry\"", text)
        self.assertNotIn('onerror=', text)

    def test_kb_live_does_not_read_sample_problems(self):
        text = (PREVIEW / 'kb.js').read_text(encoding='utf-8')
        self.assertIn('if (isLive()) return state.remote || [];', text)
        self.assertIn("data-kb-act=\"retry\"", text)

    def test_people_and_farm_skip_sample_lookups_in_live(self):
        people = (PREVIEW / 'people.js').read_text(encoding='utf-8')
        farm = (PREVIEW / 'farm.js').read_text(encoding='utf-8')
        buddies = (PREVIEW / 'buddies.js').read_text(encoding='utf-8')
        self.assertIn('if (isLive()) return null;', people)
        self.assertIn("if (isLive()) return null;", farm)
        self.assertIn('if (isLive()) return [];', buddies)
        self.assertIn('COMMONS_BUDDIES_SAMPLE', buddies)
