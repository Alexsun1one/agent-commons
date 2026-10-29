"""LG-6B R9 · 账号页行为计量同意接 POST /growth/consent。"""
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
OWNED = ['account.js', 'growth.js']


class Lg6bR9Consent(unittest.TestCase):
    def test_owned_js_have_no_html_inline_events(self):
        hits = []
        for name in OWNED:
            text = (PREVIEW / name).read_text(encoding='utf-8')
            for match in HTML_ON.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                hits.append(f'{name}:{line}:{match.group(0)}')
        self.assertEqual(hits, [])

    def test_account_live_posts_growth_consent_and_reads_me(self):
        text = (PREVIEW / 'account.js').read_text(encoding='utf-8')
        self.assertIn("post('/growth/consent'", text)
        self.assertIn('{ consent: !!next }', text)
        self.assertIn('metering_consent', text)
        self.assertIn("state.prefs.metering = !!state.me.metering_consent", text)
        self.assertIn("addEventListener('commons:consent-metering'", text)
        self.assertIn("new CustomEvent('commons:consent-metering'", text)
        self.assertIn('行为计量没有改成。原设置没有变化。', text)
        self.assertNotIn('行为计量修改接口尚未冻结', text)
        self.assertNotIn('暂时只能查看', text)

    def test_account_live_ranking_switch_writes_optout(self):
        """R17-A：线上开关 = 没退出榜单，走 POST /growth/optout，带幂等键；读不到成长模块时开关禁用并说明，不假装成功。"""
        text = (PREVIEW / 'account.js').read_text(encoding='utf-8')
        self.assertNotIn('排名设置还没开放', text)
        self.assertIn("switchButton('ranking', rankPublic(), '公开排名', state.rank.state !== 'ready' || state.rank.busy)", text)
        self.assertIn('排名设置暂未开放。', text)
        ranking = text.split("function togglePreference(key)")[1].split('function revokeExport()')[0]
        self.assertIn("if (key === 'ranking')", ranking)
        self.assertIn('postRank()', ranking)
        post = text.split('function postRank()')[1].split('function privacyPanel()')[0]
        self.assertIn("post('/growth/optout', { optout: wantOut }, writeOptions())", post)
        self.assertIn('state.rank.busy = false', post)  # 失败时回到原状
        self.assertNotIn('暂时只能查看', ranking)

    def test_account_demo_still_flips_local_prefs(self):
        text = (PREVIEW / 'account.js').read_text(encoding='utf-8')
        demo = text.split('function togglePreference(key)')[1].split('function revokeExport()')[0]
        self.assertIn('state.prefs[key] = !state.prefs[key]', demo)
        self.assertIn('savePrefs()', demo)
        self.assertIn('示例 · 仅存本机', demo)
        self.assertIn("postConsent(!state.prefs.metering)", demo)

    def test_growth_live_posts_same_endpoint_and_listens(self):
        text = (PREVIEW / 'growth.js').read_text(encoding='utf-8')
        self.assertIn("post('/growth/consent'", text)
        self.assertIn('{ consent: !!next }', text)
        self.assertIn('function postConsent(next)', text)
        self.assertIn('me.consentMetering === true', text)
        self.assertIn("addEventListener('commons:consent-metering'", text)
        self.assertIn("new CustomEvent('commons:consent-metering'", text)
        self.assertIn('if (isLive()) {\n        postConsent(!consentOn());', text)
        self.assertIn("setPref('consentMetering', !consentOn())", text)
        self.assertIn('已按行为计量演示。', text)
        self.assertIn('行为计量没有改成。原设置没有变化。', text)
        live_read = text.split('function consentOn()')[1].split('const me = sample().me')[0]
        self.assertIn('if (isLive())', live_read)
        self.assertNotIn('pref(', live_read)
