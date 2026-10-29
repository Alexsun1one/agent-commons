import unittest

from modules.ai import redact


def idcard(body17):
    weights = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
    return body17 + '10X98765432'[sum(int(d) * w for d, w in zip(body17, weights)) % 11]


class RedactTest(unittest.TestCase):
    def masked(self, text, **kw):
        return redact.redact_text(text, **kw)

    def test_mobile_numbers_in_chinese_sentences(self):
        for raw in ('我的手机13812345678，有事打', '电话：138-1234-5678。', '联系+86 138 1234 5678吧', '号码是8613912345678呢'):
            with self.subTest(raw=raw):
                out, counts = self.masked(raw)
                self.assertEqual(counts['phone'], 1, out)
                self.assertIn('[手机号]', out)
                self.assertNotRegex(out, r'1[3-9]\d')

    def test_numbers_that_are_not_contacts_stay(self):
        for raw in ('版本 1.3.8 修复了问题', '2026年10月25日开会', '价格 13800 元', '编号1380012345', '端口 8000'):
            with self.subTest(raw=raw):
                out, counts = self.masked(raw)
                self.assertEqual(out, raw)
                self.assertFalse(counts)

    def test_landline_email_qq_wechat(self):
        out, counts = self.masked('座机010-12345678，或（021）87654321；邮箱 zhang.san@example.com，QQ：123456789，'
                                  '加我微信：abc_12345，vx: Hello-World9')
        self.assertEqual(counts, {'landline': 2, 'email': 1, 'qq': 1, 'wechat': 2})
        self.assertIn('加我微信：[微信号]', out)
        self.assertIn('QQ：[QQ号]', out)
        for leaked in ('12345678', '87654321', 'zhang.san', '123456789', 'abc_12345', 'Hello-World9'):
            self.assertNotIn(leaked, out)

    def test_wechat_needs_a_keyword(self):
        raw = '我用 python3_tool 和 agent_runner 跑评测'
        self.assertEqual(self.masked(raw)[0], raw)

    def test_idcard_with_checksum(self):
        valid = idcard('11010519900307123')
        out, counts = self.masked(f'身份证号{valid}，请保密')
        self.assertEqual(out, '身份证号[身份证号]，请保密')
        self.assertEqual(counts, {'idcard': 1})

    def test_bank_cards(self):
        out, counts = self.masked('卡号 6222 0212 3456 7890 123，另一张4111111111111111')
        self.assertEqual(counts, {'bankcard': 2})
        self.assertNotIn('6222', out)
        self.assertNotIn('4111', out)

    def test_email_wins_over_phone_digits(self):
        out, counts = self.masked('发到13812345678@163.com就行')
        self.assertEqual(out, '发到[邮箱]就行')
        self.assertEqual(counts, {'email': 1})

    def test_categories_are_configurable(self):
        out, counts = self.masked('邮箱 a@b.cn 手机13812345678', categories=('email',))
        self.assertEqual(out, '邮箱 [邮箱] 手机13812345678')
        self.assertEqual(redact.redact_text('手机13812345678', categories=())[0], '手机13812345678')

    def test_recursive_and_ids_untouched(self):
        value = {'items': [{'id': '13812345678', 'title': '找我 13812345678'}], 'source_ids': ['13912345678'],
                 'audio': b'13812345678'}
        out, counts = redact.redact(value)
        self.assertEqual(out['items'][0]['id'], '13812345678')
        self.assertEqual(out['items'][0]['title'], '找我 [手机号]')
        self.assertEqual(out['source_ids'], ['13912345678'])
        self.assertEqual(out['audio'], b'13812345678')
        self.assertEqual(counts, {'phone': 1})


if __name__ == '__main__':
    unittest.main()
