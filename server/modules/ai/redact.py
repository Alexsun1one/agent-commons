"""发出去之前在本机去标识：手机号、座机、邮箱、微信号、QQ 号、身份证号、银行卡号。

换成「[手机号]」这类占位词，只回传每类的个数，不回传原值。按功能配置要去哪些类（catalog.Feature.redact），
治理初筛不去标识。中文和数字之间没有词边界，所以一律用「前后不是数字/字母」的环视来界定。
"""
import re
from collections import Counter

PLACEHOLDER = {
    'phone': '[手机号]',
    'landline': '[座机号]',
    'email': '[邮箱]',
    'wechat': '[微信号]',
    'qq': '[QQ号]',
    'idcard': '[身份证号]',
    'bankcard': '[银行卡号]',
}
# 先认长的、带结构的，再认短的：邮箱里的数字、身份证里的手机号段都不会被重复切。
ORDER = ('email', 'idcard', 'bankcard', 'phone', 'landline', 'qq', 'wechat')

_NB = r'(?<![0-9A-Za-z])'
_NA = r'(?![0-9A-Za-z])'
_DATE = r'(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])'
PATTERNS = {
    'email': re.compile(r'(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'),
    'idcard': re.compile(_NB + r'(?:[1-9]\d{5}(?:18|19|20)\d{2}' + _DATE + r'\d{3}[\dXx]|[1-9]\d{7}' + _DATE + r'\d{3})'
                         + _NA),
    'bankcard': re.compile(r'(?<!\d)\d{4}(?:[ -]?\d{4}){2,3}(?:[ -]?\d{1,3})?(?!\d)'),
    'phone': re.compile(r'(?<!\d)(?:(?:\+|00)?86[ -]?)?1[3-9]\d(?:[ -]?\d{4}){2}(?!\d)'),
    'landline': re.compile(r'(?<!\d)(?:0\d{2,3}-\d{7,8}|[（(]0\d{2,3}[)）][ -]?\d{7,8})(?:-\d{1,5})?(?!\d)'),
    'qq': re.compile(r'(?i)(?<![a-z])(?:qq|扣扣|企鹅号?)\s*号?\s*(?:[:：]|是|为)?\s*([1-9]\d{4,10})(?!\d)'),
    'wechat': re.compile(r'(?i)(?:微信号?|威信|薇信|v信|(?<![a-z])(?:wechat|weixin|vx|wx))\s*号?\s*(?:[:：]|是|为)?\s*'
                         r'([a-z][-_a-z0-9]{5,19})(?![-_a-z0-9])'),
}
_ID_WEIGHTS = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
_ID_CHECK = '10X98765432'


def _idcard_ok(raw):
    if len(raw) == 15:
        return True
    total = sum(int(d) * w for d, w in zip(raw[:17], _ID_WEIGHTS))
    return _ID_CHECK[total % 11] == raw[17].upper()


def _luhn_ok(digits):
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _accept(category, match):
    raw = match.group(0)
    if category == 'idcard':
        return _idcard_ok(raw)
    if category == 'bankcard':
        digits = re.sub(r'[ -]', '', raw)
        return 16 <= len(digits) <= 19 and (_luhn_ok(digits) or digits.startswith('62'))
    return True


def find(text, categories=ORDER):
    """返回 [(类别, 起, 止)]，按位置排序、互不重叠。"""
    wanted = [c for c in ORDER if c in set(categories)]
    taken = []
    for category in wanted:
        for match in PATTERNS[category].finditer(text):
            if not _accept(category, match):
                continue
            start, end = match.span(1) if match.re.groups else match.span()
            if any(start < e and s < end for _, s, e in taken):
                continue
            taken.append((category, start, end))
    return sorted(taken, key=lambda t: t[1])


def redact_text(text, categories=ORDER):
    counts = Counter()
    if not text or not categories:
        return text, counts
    out, last = [], 0
    for category, start, end in find(text, categories):
        out.append(text[last:start])
        out.append(PLACEHOLDER[category])
        counts[category] += 1
        last = end
    out.append(text[last:])
    return ''.join(out), counts


# 编号、类型、语言这类字段不是正文，不动（否则引用的 id 会被误伤）。
SKIP_KEYS = frozenset({'id', 'media_type', 'consent', 'language', 'source_lang', 'target_lang', 'object_type'})


def _skip(key):
    return key in SKIP_KEYS or key.endswith(('_id', '_ids', '_keys'))


def redact(value, categories=ORDER):
    """递归处理字符串、列表、字典里的字符串；bytes（图片、音频）原样返回。返回 (新值, 各类个数)。"""
    counts = Counter()
    if not categories:
        return value, counts
    if isinstance(value, str):
        return redact_text(value, categories)
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if isinstance(k, str) and _skip(k):
                out[k] = v
                continue
            out[k], c = redact(v, categories)
            counts.update(c)
        return out, counts
    if isinstance(value, (list, tuple)):
        out = []
        for v in value:
            nv, c = redact(v, categories)
            out.append(nv)
            counts.update(c)
        return out, counts
    return value, counts
