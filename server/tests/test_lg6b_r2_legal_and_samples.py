"""LG-6B R2 · 法务入口、18+ 字段，以及前端样例拆出原文件。"""
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

OWNED = [
    'onboard.js', 'landing.js', 'account.js',
    'showcase.js', 'constellation.js', 'work-hub.js', 'work-stage.js',
    'buddies.js', 'extensions.js', 'ui-kit.js',
    'buddies-sample.js', 'showcase-sample.js', 'work-hub-sample.js',
    'work-stage-sample.js', 'constellation-sample.js', 'landing-sample.js',
    'ui-kit-sample.js', 'extensions-sample.js',
]


class Lg6bR2LegalAndSamples(unittest.TestCase):
    def test_owned_js_have_no_html_inline_events(self):
        hits = []
        for name in OWNED:
            text = (PREVIEW / name).read_text(encoding='utf-8')
            for match in HTML_ON.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{name}:{line}:{match.group(0)}')
        self.assertEqual(hits, [])

    def test_onboard_covers_four_docs_and_retention(self):
        text = (PREVIEW / 'onboard.js').read_text(encoding='utf-8')
        for doc in ('age', 'rules', 'terms', 'privacy', 'retention'):
            self.assertIn(f'data-doc="{doc}"', text)
        self.assertIn('legal/age-18.html', text)
        self.assertIn('legal/rules.html', text)
        self.assertIn('legal/terms.html', text)
        self.assertIn('legal/privacy.html', text)
        self.assertIn('legal/retention.html', text)
        self.assertIn('行为计量可单独选择', text)
        self.assertIn('adult_confirmed', text)

    def test_landing_and_account_link_legal_pages(self):
        landing = (PREVIEW / 'landing.js').read_text(encoding='utf-8')
        account = (PREVIEW / 'account.js').read_text(encoding='utf-8')
        for name in ('legal/terms.html', 'legal/age-18.html', 'legal/retention.html'):
            self.assertIn(name, landing)
            self.assertIn(name, account)
        self.assertIn("legalNav('terms'", landing)
        self.assertIn('生效日期待填', account)

    def test_sample_files_hold_fiction_originals_do_not(self):
        buddies = (PREVIEW / 'buddies.js').read_text(encoding='utf-8')
        self.assertIn('COMMONS_BUDDIES_SAMPLE', buddies)
        self.assertNotIn('把知识库做成可复现的小样', buddies)
        self.assertIn('把知识库做成可复现的小样', (PREVIEW / 'buddies-sample.js').read_text(encoding='utf-8'))

        extensions = (PREVIEW / 'extensions.js').read_text(encoding='utf-8')
        sample = (PREVIEW / 'extensions-sample.js').read_text(encoding='utf-8')
        self.assertNotIn('顾澄', extensions)
        self.assertNotIn('林杉', extensions)
        self.assertIn('顾澄', sample)
        self.assertIn('COMMONS_EXTENSIONS_SAMPLE', extensions)

        landing = (PREVIEW / 'landing.js').read_text(encoding='utf-8')
        landing_sample = (PREVIEW / 'landing-sample.js').read_text(encoding='utf-8')
        self.assertNotIn('墨白', landing)
        self.assertIn('墨白', landing_sample)
        self.assertIn('COMMONS_LANDING_SAMPLE', landing)

        hub = (PREVIEW / 'work-hub.js').read_text(encoding='utf-8')
        self.assertNotIn('先用扣子做跟单', hub)
        self.assertIn('COMMONS_WORK_HUB_SAMPLE', hub)

        stage = (PREVIEW / 'work-stage.js').read_text(encoding='utf-8')
        self.assertNotIn('直接联系潜在客户', stage)
        self.assertIn('COMMONS_WORK_STAGE_SAMPLE', stage)

        atlas = (PREVIEW / 'constellation.js').read_text(encoding='utf-8')
        self.assertIn('COMMONS_CONSTELLATION_SAMPLE', atlas)
        self.assertIn('if(isLive())return{people:[],works:[],methods:[]}', atlas.replace(' ', ''))
