"""LG-6B R8 · 空状态、能力关闭、落地页与日历参数。"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'
SKIP = {'api.js', 'app.js', 'govern.js', 'admin.js', 'pwa.js', 'navigation.js'}

HTML_ON = re.compile(
    r'''\bon(?:click|dblclick|error|load|change|submit|input|keyup|keydown|keypress|focus|blur|mouse\w+|pointer\w+|touch\w+)\s*=\s*["']''',
    re.I,
)
RETRY_ON_501 = re.compile(
    r'''status\s*===\s*501[^;]{0,220}重试'''
)


def owned_js():
    return sorted(
        p for p in PREVIEW.glob('*.js')
        if not p.name.endswith('-sample.js')
        and p.name not in SKIP
        and not p.name.startswith('hubs.')
        and 'vendor' not in p.parts
    )


class Lg6bR8EmptyAndFlags(unittest.TestCase):
    def test_knowledge_net_live_is_empty_not_error(self):
        text = (PREVIEW / 'knowledge-net.js').read_text(encoding='utf-8')
        self.assertIn('function liveEmptyHTML()', text)
        self.assertIn('href="#/solved"', text)
        self.assertIn('href="#/skills"', text)
        self.assertIn('if (isLive()) {\n      sourceRef = null;\n      model = null;', text)
        live_empty = text.split('function liveEmptyHTML()')[1].split('function shell()')[0]
        self.assertNotIn('知识地图没有加载', live_empty)

    def test_calendar_sends_from_and_to_for_visible_month(self):
        text = (PREVIEW / 'calendar.js').read_text(encoding='utf-8')
        self.assertIn('function calendarQuery()', text)
        self.assertIn("CommonsAPI.get('/events/calendar', query)", text)
        self.assertIn('from:', text)
        self.assertIn('to:', text)
        self.assertIn('if (isLive()) loadLive();', text)

    def test_rooms_and_bounty_paint_closed_without_retry(self):
        rooms = (PREVIEW / 'rooms.js').read_text(encoding='utf-8')
        self.assertIn('function closedBox()', rooms)
        self.assertIn('需要部署方配置音视频服务', rooms)
        self.assertIn('这个功能还没开放', rooms)
        closed = rooms.split('function closedBox()')[1].split('function paintList()')[0]
        self.assertNotIn('重试', closed)
        bounty = (PREVIEW / 'bounty.js').read_text(encoding='utf-8')
        self.assertIn('function closedHTML()', bounty)
        self.assertIn('管理员还没打开', bounty)
        bounty_closed = bounty.split('function closedHTML()')[1].split('function errorHTML')[0]
        self.assertNotIn('重试', bounty_closed)
        self.assertNotIn('bty-error', bounty_closed)

    def test_owned_js_do_not_retry_on_501(self):
        hits = []
        for path in owned_js():
            text = path.read_text(encoding='utf-8')
            for match in RETRY_ON_501.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{path.name}:{line}')
        self.assertEqual(hits, [])
        rooms = (PREVIEW / 'rooms.js').read_text(encoding='utf-8')
        self.assertIn('isClosed(S.live.error) ? closedBox()', rooms)
        growth = (PREVIEW / 'growth.js').read_text(encoding='utf-8')
        self.assertIn("state.liveError === 'closed'", growth)

    def test_events_and_groups_use_one_panda_when_page_empty(self):
        events = (PREVIEW / 'events.js').read_text(encoding='utf-8')
        self.assertIn("function quietEmpty(text)", events)
        self.assertIn("var wholeEmpty = !live.length && !soon.length && !past.length;", events)
        self.assertIn("wholeEmpty ? empty('还没有活动'", events)
        self.assertIn("quietEmpty('这一栏还空着')", events)
        social = (PREVIEW / 'social.js').read_text(encoding='utf-8')
        self.assertIn("const any = specs.some(row => row.list.length);", social)
        self.assertIn("soc-card-empty", social)
        self.assertIn("还没有小组", social)

    def test_landing_live_drops_preview_words(self):
        text = (PREVIEW / 'landing.js').read_text(encoding='utf-8')
        self.assertIn("isLive() ? '邀请制内测' : '邀请制内测 · 交互预览'", text)
        self.assertIn("isLive() ? '' : '<span class=\"ld-tag\">内测预览</span>'", text)
        live_bits = [
            part.split(':')[0]
            for part in re.findall(r"isLive\(\)\s*\?\s*'([^']*)'", text)
        ]
        self.assertTrue(any(bit == '邀请制内测' for bit in live_bits))
        self.assertFalse(any('预览' in bit for bit in live_bits))

    def test_insights_live_skips_demo_path(self):
        text = (PREVIEW / 'insights.js').read_text(encoding='utf-8')
        self.assertIn("if (window.CommonsAPI && window.CommonsAPI.mode === 'live') return '';", text)
        empty = text.split('function emptyPageHTML()')[1].split('function errorHTML()')[0]
        self.assertNotIn('demoHTML()', empty)
        self.assertNotIn('示意', empty)

    def test_owned_js_have_no_html_inline_events(self):
        hits = []
        for name in (
            'knowledge-net.js', 'calendar.js', 'rooms.js', 'bounty.js',
            'events.js', 'social.js', 'landing.js', 'insights.js',
        ):
            text = (PREVIEW / name).read_text(encoding='utf-8')
            for match in HTML_ON.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{name}:{line}:{match.group(0)}')
        self.assertEqual(hits, [])
