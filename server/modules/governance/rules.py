"""规则层检测器（本机，不外发）。全部实现 detectors.Detector，参数从 gov_rule 读（detectors.params）。

- rule.pii      联系方式和个人信息（位置来自 pii.py，复用 ENG-2 去标识规则）
- rule.spam     广告引流、刷屏
- rule.html     HTML 静态检查：preview/html-render.js 的 HTML_INSPECT_RULES 整表移植
- rule.media    文件类型与大小、图片尺寸和 EXIF 是否已去除
- rule.quality  知识条目缺来源（默认关）
上下文规则（发帖频率、重复内容）要查库，放在 service.py 的初筛流程里。
"""
import re
from collections import Counter

from . import detectors, pii
from .detectors import Signal

HTML_MAX_BYTES = 2 * 1024 * 1024
LOCATOR_SPANS = 20


def _paragraph(text, index):
    return text.count('\n', 0, index)


def _line(text, index):
    return text.count('\n', 0, index) + 1


def _clip(value, lo=0.0, hi=1.0):
    return max(lo, min(hi, round(float(value), 3)))


class PiiDetector:
    name, version, kind = 'rule.pii', '1', 'rule'
    modalities = {'text', 'html'}
    egress = False

    def check(self, item):
        p = detectors.params('pii.contact')
        allowed = set(p.get('categories', ()))
        strong = set(p.get('strong', ()))
        by_field = {}
        for span in item.pii:
            if span.category in allowed:
                by_field.setdefault(span.field, []).append(span)
        out = []
        sources = {'title': item.title, 'text': item.text, 'html': item.html or ''}
        for fname, spans in sorted(by_field.items()):
            source = sources.get(fname, '')
            counts = Counter(s.category for s in spans)
            score = 0.9 if counts.keys() & strong else 0.5
            summary = '含' + '、'.join(f'{pii.LABELS.get(c, c)} {n} 处' for c, n in sorted(counts.items()))
            locator = {'field': fname, 'spans': [
                {'start': s.start, 'end': s.end, 'category': s.category,
                 ('line' if fname == 'html' else 'paragraph'):
                     _line(source, s.start) if fname == 'html' else _paragraph(source, s.start)}
                for s in spans[:LOCATOR_SPANS]]}
            out.append(Signal('pii.contact', 'contact', score, 0.95, locator, summary[:200], 'pending_review'))
        return out


URL = re.compile(r'https?://[^\s<>"\'）)」』】，。]+', re.I)


class SpamDetector:
    name, version, kind = 'rule.spam', '1', 'rule'
    modalities = {'text'}
    egress = False

    def check(self, item):
        text = f'{item.title}\n{item.text}' if item.title else item.text
        out = []
        ad = detectors.params('spam.ad')
        lowered = text.lower()
        hits = []
        for word in ad.get('keywords', ()):
            w = word.lower()
            i = lowered.find(w)
            if i >= 0:
                hits.append((i, i + len(w)))
        links = len(URL.findall(text)) + text.count(pii.TOKENS['private_link'])
        score = len(hits) * ad.get('per_hit', 0.35)
        if links > ad.get('max_links', 5):
            score += ad.get('link_bonus', 0.3)
        if score > 0:
            hits.sort()
            offset = len(item.title) + 1 if item.title else 0
            spans = [{'field': 'title' if a < offset else 'text', 'start': a - (0 if a < offset else offset),
                      'end': b - (0 if a < offset else offset)} for a, b in hits[:LOCATOR_SPANS]]
            out.append(Signal('spam.ad', 'spam', _clip(score), 0.8, {'field': 'text', 'spans': spans},
                              f'广告用语 {len(hits)} 处，链接 {links} 个', 'pending_review'))
        rep = detectors.params('spam.repeat')
        run_at, run_len = self._longest_run(item.text)
        line_at, line_n = self._repeated_line(item.text)
        if run_len >= rep.get('max_char_run', 20) or line_n >= rep.get('max_line_repeat', 5):
            start = run_at if run_len >= rep.get('max_char_run', 20) else line_at
            out.append(Signal('spam.repeat', 'spam', 0.7, 0.9,
                              {'field': 'text', 'start': start, 'paragraph': _paragraph(item.text, start)},
                              f'同一字符连续 {run_len} 次，同一行重复 {line_n} 次', 'pending_review'))
        return out

    @staticmethod
    def _longest_run(text):
        best_at, best, at, n, prev = 0, 0, 0, 0, None
        for i, ch in enumerate(text):
            if ch == prev and not ch.isspace():
                n += 1
            else:
                at, n, prev = i, 1, ch
            if n > best:
                best_at, best = at, n
        return best_at, best

    @staticmethod
    def _repeated_line(text):
        counts, first, pos = Counter(), {}, 0
        for line in text.split('\n'):
            key = line.strip()
            if len(key) >= 2:
                counts[key] += 1
                first.setdefault(key, pos)
            pos += len(line) + 1
        if not counts:
            return 0, 0
        key, n = counts.most_common(1)[0]
        return first[key], n


# —— HTML 静态检查：与 preview/html-render.js 的 HTML_INSPECT_RULES 同表（code / level / message 一字不差） ——

def _scan(pattern, flags=re.I):
    rx = re.compile(pattern, flags)
    return lambda html: [m.start() for m in rx.finditer(html)]


def _is_script_src(html, index):
    return re.search(r'<script\b[^>]*$', html[max(0, index - 80):index], re.I) is not None


def _external_resource(html):
    rx = re.compile(r'(?:\b(?:src|href|action|poster|srcset|data)\s*=\s*([\'"])\s*(?:https?:)?//'
                    r'|(?:url|@import)\s*\(\s*([\'"]?)\s*(?:https?:)?//|https?://[^\s"\'`<>]+)', re.I)
    return [m.start() for m in rx.finditer(html) if not _is_script_src(html, m.start())]


def _huge_inline(html):
    rx = re.compile(r'data:[^;,\s]+;base64,([A-Za-z0-9+/=]+)', re.I)
    return [m.start() for m in rx.finditer(html) if len(m.group(1)) > 50 * 1024]


HTML_INSPECT_RULES = (
    ('oversize', 'block', '单个 HTML 超过 2MB，渲染会被拒绝。请去掉超大的内联图片或把资源拆出去。',
     lambda html: [0] if len(html.encode('utf-8')) > HTML_MAX_BYTES else []),
    ('external-script', 'block', '引用了外部脚本。沙箱禁止网络请求，这段脚本不会加载。',
     _scan(r'<script\b[^>]*\bsrc\s*=\s*([\'"]?)\s*(?:https?:)?//')),
    ('external-resource', 'warn', '引用了外部资源地址（http(s):// 或协议相对 //）。CSP 会拦住这些请求。',
     _external_resource),
    ('password-field', 'block', '含有密码输入框，可能在收集凭据。',
     _scan(r'<input\b[^>]*\btype\s*=\s*([\'"]?)password\1')),
    ('account-form', 'warn', '表单在收集账号（用户名、邮箱或登录字段）。',
     _scan(r'<(?:input|form)\b[^>]*(?:\b(?:name|id|autocomplete|type|placeholder)\s*=\s*([\'"]?)'
           r'(?:user(?:name)?|e-?mail|login|account)\1)')),
    ('meta-refresh', 'block', '使用了 meta refresh，会尝试跳转离开当前页。',
     _scan(r'<meta\b[^>]*http-equiv\s*=\s*([\'"]?)refresh\1')),
    ('location-redirect', 'block', '脚本里写了 location 跳转。',
     _scan(r'(?:window\s*\.\s*)?(?:document\s*\.\s*)?location\s*(?:\.\s*(?:href|assign|replace)\s*=|\s*=)')),
    ('nested-iframe', 'block', '嵌套了 iframe。沙箱 CSP 的 frame-src 为 none，不会加载。',
     _scan(r'<iframe\b')),
    ('eval-like', 'warn', '使用了 eval、new Function 或 document.write，运行时行为难以预料。',
     _scan(r'\beval\s*\(|\bnew\s+Function\s*\(|\bdocument\s*\.\s*write(?:ln)?\s*\(')),
    ('crypto-miner', 'block', '疑似挖矿脚本特征（常见库名、CryptoNight、coinhive 一类字样）。',
     _scan(r'coinhive|coin-hive|cryptonight|crypto-night|jsecoin|cryptoloot|minero|deepminer|coinimp'
           r'|webmine(?:r|pool)?|wasmminer|monero-miner')),
    ('base-tag', 'block', '使用了 base 标签，会改写相对地址的解析起点。',
     _scan(r'<base\b')),
    ('huge-inline-data', 'info', '含有超大内联数据（单段 data: URI 超过 50KB）。',
     _huge_inline),
)
LEVEL_ORDER = {'block': 0, 'warn': 1, 'info': 2}


def inspect_html(html):
    """与前端 CommonsHTML.inspect 同口径：[{level, code, message, line, index}]，同一规则同一行只报一次。"""
    source = '' if html is None else str(html)
    findings, seen = [], set()
    for code, level, message, match in HTML_INSPECT_RULES:
        for index in match(source):
            line = _line(source, index)
            if (code, line) in seen:
                continue
            seen.add((code, line))
            findings.append({'level': level, 'code': code, 'message': message, 'line': line, 'index': index})
    findings.sort(key=lambda f: (LEVEL_ORDER[f['level']], f['line'], f['code']))
    return findings


class HtmlInspectDetector:
    name, version, kind = 'rule.html', '1', 'rule'
    modalities = {'html'}
    egress = False

    def check(self, item):
        if item.html is None:
            return []
        return html_signals(inspect_html(item.html), detectors.params('html.inspect'))


def html_signals(findings, p):
    """inspect_html 的结果按 (code, level) 归并成证据；媒体侧已存的 findings 也走这里。"""
    level_score = p.get('level_score', {'block': 0.9, 'warn': 0.5, 'info': 0.2})
    grouped = {}
    for f in findings:
        if isinstance(f, dict) and f.get('code') and f.get('level') in LEVEL_ORDER:
            grouped.setdefault((str(f['code'])[:40], f['level'], str(f.get('message', ''))[:120]), []).append(f)
    out = []
    for (code, level, message), hits in grouped.items():
        out.append(Signal('html.inspect', 'html', _clip(level_score.get(level, 0.2)), 0.9,
                          {'field': 'html', 'code': code, 'level': level,
                           'lines': [h.get('line') for h in hits[:LOCATOR_SPANS]],
                           'start': hits[0].get('index')},
                          f'{code}（{level}）：{message}'[:200], 'pending_review' if level == 'block' else None))
    return out


SNIFF = (
    (b'\xff\xd8\xff', 'image/jpeg'),
    (b'\x89PNG\r\n\x1a\n', 'image/png'),
    (b'GIF87a', 'image/gif'),
    (b'GIF89a', 'image/gif'),
)


def sniff(head):
    for magic, mime in SNIFF:
        if head.startswith(magic):
            return mime
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'image/webp'
    if head[4:8] == b'ftyp' and head[8:12] in (b'avif', b'avis'):
        return 'image/avif'
    lowered = head.lstrip().lower()
    if lowered.startswith(b'<svg') or (lowered.startswith(b'<?xml') and b'<svg' in lowered):
        return 'image/svg+xml'
    if lowered.startswith((b'<!doctype html', b'<html')):
        return 'text/html'
    return None


def has_exif(data, mime):
    """图片里是否还留着 EXIF（可能含拍摄位置）。只认 JPEG APP1、PNG eXIf、WebP EXIF 三处。"""
    if mime == 'image/jpeg':
        i = 2
        while i + 4 <= len(data) and data[i] == 0xFF:
            marker = data[i + 1]
            if marker in (0xD9, 0xDA):
                break
            length = int.from_bytes(data[i + 2:i + 4], 'big')
            if marker == 0xE1 and data[i + 4:i + 10] == b'Exif\x00\x00':
                return True
            i += 2 + length
        return False
    if mime == 'image/png':
        i = 8
        while i + 8 <= len(data):
            length = int.from_bytes(data[i:i + 4], 'big')
            ctype = data[i + 4:i + 8]
            if ctype == b'eXIf':
                return True
            if ctype == b'IEND':
                break
            i += 12 + length
        return False
    if mime == 'image/webp':
        i = 12
        while i + 8 <= len(data):
            ctype = data[i:i + 4]
            length = int.from_bytes(data[i + 4:i + 8], 'little')
            if ctype == b'EXIF':
                return True
            i += 8 + length + (length & 1)
        return False
    return False


class MediaDetector:
    name, version, kind = 'rule.media', '1', 'rule'
    modalities = {'image', 'html', 'audio', 'video'}
    egress = False

    def check(self, item):
        ft = detectors.params('file.type')
        ic = detectors.params('image.check')
        allowed = set(ft.get('allowed_mime', ()))
        limits = ft.get('max_bytes', {})
        out = []
        for m in item.media:
            loc = {'field': 'media', 'index': m.index, 'kind': m.kind}
            data = None
            if m.path:
                try:
                    with open(m.path, 'rb') as f:
                        data = f.read(min(m.size or 0, 32 * 1024 * 1024) or 32 * 1024 * 1024)
                except OSError:
                    data = None
            sniffed = sniff(data[:512]) if data else None
            declared = (m.mime or '').lower()
            if 'svg' in declared or sniffed == 'image/svg+xml':
                out.append(Signal('file.type', 'file', 1.0, 1.0, loc, 'SVG 图片不接受（可能带脚本）', 'pending_review'))
                continue
            if declared not in allowed:
                out.append(Signal('file.type', 'file', 0.9, 1.0, loc, f'不接受的文件类型 {declared[:60]}',
                                  'pending_review'))
            elif sniffed and sniffed != declared:
                out.append(Signal('file.type', 'file', 0.8, 0.9, loc, f'声明 {declared} 与实际内容 {sniffed} 不符',
                                  'pending_review'))
            cap = limits.get(m.kind)
            if cap and (m.size or 0) > cap:
                out.append(Signal('file.type', 'file', 0.9, 1.0, loc,
                                  f'{m.kind} 超过 {cap // (1024 * 1024)}MB 上限', 'pending_review'))
            if m.kind != 'image':
                continue
            max_px = ic.get('max_px', 20000)
            if m.width is not None and m.height is not None and not (0 < m.width <= max_px and 0 < m.height <= max_px):
                out.append(Signal('image.check', 'image', 0.6, 1.0, loc, f'图片尺寸 {m.width}×{m.height} 超出范围'))
            if ic.get('require_exif_stripped', True) and data and has_exif(data, sniffed or declared):
                out.append(Signal('image.check', 'image', 0.7, 1.0, loc, 'EXIF 元数据还在（可能含拍摄位置）'))
        return out


class QualityDetector:
    name, version, kind = 'rule.quality', '1', 'rule'
    modalities = {'text'}
    egress = False

    def check(self, item):
        p = detectors.params('quality.no_source')
        if item.object_type not in set(p.get('types', ())):
            return []
        text = f'{item.title}\n{item.text}'
        if URL.search(text) or '来源' in text or pii.TOKENS['private_link'] in text:
            return []
        return [Signal('quality.no_source', 'quality', 0.6, 0.6, {'field': 'text'}, '没有找到来源链接或来源说明',
                       'require_source')]


RULE_DETECTORS = (PiiDetector(), SpamDetector(), HtmlInspectDetector(), MediaDetector(), QualityDetector())
for _d in RULE_DETECTORS:
    detectors.register(_d)
