"""规则层单元测试：HTML 静态检查与前端 HTML_INSPECT_RULES 对齐、去标识复用、EXIF、举报权重、检测器注册约束。"""
import struct
import unittest
import zlib

from modules.governance import detectors, pii, rules, service
from modules.governance.detectors import Item, MediaRef, Signal

# 输入与 preview/html-render.js 的 CommonsHTML.inspect 跑出来的结果（node 实测后写死，见回执）
PARITY = [
    ('<html><head><script src="https://cdn.example.com/x.js"></script><base href="/"></head><body>ok</body></html>',
     [['block', 'base-tag', 1], ['block', 'external-script', 1]]),
    ('<form><input type="password" name="pw"><input name=\'username\'><input type=email placeholder="email"></form>',
     [['block', 'password-field', 1], ['warn', 'account-form', 1]]),
    ('<meta http-equiv="refresh" content="0;url=x">\n<script>window.location.href = \'x\'; eval(\'1\'); '
     'document.write(\'a\')</script>',
     [['block', 'meta-refresh', 1], ['block', 'location-redirect', 2], ['warn', 'eval-like', 2]]),
    ('<iframe src="//evil.test"></iframe>\n<img src="https://img.test/a.png">\n'
     '<style>@import url(//fonts.test/a.css)</style>\nvisit https://site.test/page',
     [['block', 'nested-iframe', 1], ['warn', 'external-resource', 1], ['warn', 'external-resource', 2],
      ['warn', 'external-resource', 3], ['warn', 'external-resource', 4]]),
    ("<script>var m = new CoinHive.Anonymous('x'); new Function('a','b')</script>",
     [['block', 'crypto-miner', 1], ['warn', 'eval-like', 1]]),
    ('plain <b>text</b> only', []),
    ('<div style="background:url(\'https://x.test/a.png\')"></div><a href=\'//x.test\'>x</a>'
     '<script src=//cdn.test/y.js></script>',
     [['block', 'external-script', 1], ['warn', 'external-resource', 1]]),
]


def png_chunk(ctype, data):
    return struct.pack('>I', len(data)) + ctype + data + struct.pack('>I', zlib.crc32(ctype + data))


class HtmlInspectTest(unittest.TestCase):
    def test_matches_front_end_rules(self):
        for html, expected in PARITY:
            got = [[f['level'], f['code'], f['line']] for f in rules.inspect_html(html)]
            self.assertEqual(got, expected, html)

    def test_findings_from_media_side_become_signals(self):
        signals = rules.html_signals(rules.inspect_html(PARITY[1][0]), {'level_score': {'block': 0.9, 'warn': 0.5}})
        by_code = {s.locator['code']: s for s in signals}
        self.assertEqual(by_code['password-field'].suggested_action, 'pending_review')
        self.assertIsNone(by_code['account-form'].suggested_action)
        self.assertEqual(rules.html_signals([{'junk': 1}, 'x'], {}), [])


class PiiTest(unittest.TestCase):
    def test_reuses_deid_rules_and_keeps_offsets(self):
        self.assertTrue(pii.available(), pii.LOAD_ERROR)
        text = '有事打 13812345678，或者加微信 abc_12345，版本 1.2.3，价格 199 元，日期 2026-10-25'
        masked, spans = pii.mask(text)
        self.assertEqual(len(masked), len(text))
        self.assertNotIn('13812345678', masked)
        cats = {c for _, _, c in spans}
        self.assertIn('phone', cats)
        for keep in ('1.2.3', '199', '2026-10-25'):
            self.assertIn(keep, masked)
        start, end, _ = next(s for s in spans if s[2] == 'phone')
        self.assertEqual(text[start:end], '13812345678')


class MediaTest(unittest.TestCase):
    def test_exif_detection(self):
        jpeg_exif = b'\xff\xd8' + b'\xff\xe1' + struct.pack('>H', 16) + b'Exif\x00\x00' + b'\x00' * 8 + b'\xff\xd9'
        jpeg_clean = b'\xff\xd8' + b'\xff\xe0' + struct.pack('>H', 16) + b'JFIF\x00' + b'\x00' * 9 + b'\xff\xd9'
        self.assertTrue(rules.has_exif(jpeg_exif, 'image/jpeg'))
        self.assertFalse(rules.has_exif(jpeg_clean, 'image/jpeg'))
        sig = b'\x89PNG\r\n\x1a\n'
        ihdr = png_chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
        png_exif = sig + ihdr + png_chunk(b'eXIf', b'MM\x00*') + png_chunk(b'IEND', b'')
        png_clean = sig + ihdr + png_chunk(b'IEND', b'')
        self.assertTrue(rules.has_exif(png_exif, 'image/png'))
        self.assertFalse(rules.has_exif(png_clean, 'image/png'))
        self.assertEqual(rules.sniff(jpeg_exif[:16]), 'image/jpeg')
        self.assertEqual(rules.sniff(b'<svg xmlns="x">'), 'image/svg+xml')

    def test_svg_and_oversize_flagged(self):
        book = {'file.type': {'params': {'allowed_mime': ['image/png'], 'max_bytes': {'image': 100}}},
                'image.check': {'params': {'max_px': 50}}}
        item = Item('upload', 'u1', 1, 'image', media=(MediaRef('image', 'image/svg+xml', 10),
                                                       MediaRef('image', 'image/png', 500, None, 60, 10, 1)))
        with detectors.rule_params(book):
            found = rules.MediaDetector().check(item)
        summaries = [(s.rule, s.locator['index']) for s in found]
        self.assertIn(('file.type', 0), summaries)
        self.assertIn(('file.type', 1), summaries)
        self.assertIn(('image.check', 1), summaries)


class WeightTest(unittest.TestCase):
    P = {'base': 1.0, 'level_bonus': {'1': -0.5, '2': 0.0, '3': 0.5, '4': 1.0, '5': 1.5}, 'accuracy_axis': 0.7,
         'accuracy_scale': 1.0, 'min_reviewed': 5, 'floor': 0.1, 'cap': 6.0}

    def test_level_and_accuracy(self):
        self.assertEqual(service.report_weight(1, 0, 0, self.P), 0.5)
        self.assertEqual(service.report_weight(5, 0, 0, self.P), 2.5)
        self.assertEqual(service.report_weight(1, 3, 0, self.P), 0.5)        # 样本不足不加分
        self.assertGreater(service.report_weight(1, 16, 0, self.P), 2.0)     # 全对加分
        self.assertEqual(service.report_weight(1, 0, 16, self.P), 0.1)       # 全错压到下限
        self.assertLessEqual(service.report_weight(5, 1000, 0, self.P), 6.0)


class RegistryTest(unittest.TestCase):
    def test_rule_detectors_cannot_egress(self):
        class Bad:
            name, version, kind, modalities, egress = 'rule.bad', '1', 'rule', {'text'}, True

            def check(self, item):
                return []
        with self.assertRaises(ValueError):
            detectors.register(Bad())
        self.assertIsNone(detectors.get('rule.bad'))

    def test_auto_actions_are_reversible_only(self):
        self.assertEqual(service.AUTO_ACTIONS, {'pending_review', 'rate_limit', 'require_source'})
        self.assertTrue(all(service.ACTIONS[a]['reversible'] for a in service.AUTO_ACTIONS))
        self.assertTrue(isinstance(Signal('x', 'y', 1.0), Signal))


if __name__ == '__main__':
    unittest.main()
