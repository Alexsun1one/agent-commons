"""LG-6B R4 · 阅读页 HTML 作品：真实模式传资产地址，演示仍传 html。"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'
READER = (PREVIEW / 'reader.js').read_text(encoding='utf-8')

HTML_ON = re.compile(
    r'''\bon(?:click|dblclick|error|load|change|submit|input|keyup|keydown|keypress|focus|blur|mouse\w+|pointer\w+|touch\w+)\s*=\s*["']''',
    re.I,
)


class Lg6bR4ReaderHtml(unittest.TestCase):
    def test_no_html_inline_events(self):
        hits = []
        for match in HTML_ON.finditer(READER):
            line = READER.count('\n', 0, match.start()) + 1
            hits.append(f'reader.js:{line}:{match.group(0)}')
        self.assertEqual(hits, [])

    def test_live_preview_uses_asset_id_or_content_url(self):
        self.assertIn('function isLive()', READER)
        self.assertIn('CommonsAPI.mode === \'live\'', READER)
        self.assertIn('function workPreview(work)', READER)
        self.assertIn('liveOpts.assetId = assetId', READER)
        self.assertIn('liveOpts.contentUrl = contentUrl', READER)
        self.assertIn('work.content_url', READER)
        compact = re.sub(r'\s+', '', READER)
        self.assertIn('if(isLive()){', compact)
        self.assertIn('if(!assetId&&!contentUrl)returnnull;', compact)
        self.assertNotIn('if(isLive()){liveOpts.html', compact)

    def test_demo_still_passes_html_and_missing_keeps_prompt(self):
        self.assertIn('if (typeof work.html !== \'string\') return null;', READER)
        self.assertIn('return { html: work.html, title: title };', READER)
        self.assertIn('作品内容没有找到。', READER)
        self.assertIn('这个 HTML 作品你现在看不到', READER)
        self.assertIn('H.render(frame, options)', READER)
        self.assertNotIn('H.render(frame, { html: work.html', READER)
