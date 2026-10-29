"""Token 自报：只留量级区间。上传的用量文件只在内存里解析出数字，原文不落盘、不入库。"""
import csv
import io
import json
import re

from app import audit, clock
from app.errors import ApiError, register

from . import rules

register('secret_detected', 422, '内容里有像 API key 或令牌的字符串，已拒绝。请不要提交任何密钥，只填模型家族和量级区间。')

MAX_FILE_CHARS = 1_000_000
MAX_TOKENS = 10 ** 13
KEY_PATTERNS = [re.compile(p) for p in (
    r'(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]{16,}',
    r'(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}',
    r'(?<![A-Za-z0-9])AIza[0-9A-Za-z_\-]{30,}',
    r'(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}',
    r'(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}',
    r'(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9\-]{10,}',
    r'eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}',
    r'-----BEGIN [A-Z ]*PRIVATE KEY-----',
    r'(?i)bearer\s+[A-Za-z0-9._\-]{20,}',
    r'(?i)(?:api[_\- ]?key|secret|passwd|password|access[_\- ]?token|auth[_\- ]?token|authorization)'
    r'["\'\s:=\\]+(?=[A-Za-z0-9_\-./+=]*[A-Za-z])[A-Za-z0-9_\-./+=]{16,}',
)]
TOTAL_KEYS = ('totalTokens', 'total_tokens')
PART_KEYS = ('inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens',
             'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens')


def looks_like_secret(text):
    return any(p.search(text) for p in KEY_PATTERNS)


def scan(value, depth=0):
    """递归检查所有字符串（含键名）。命中就抛 secret_detected，不回显内容。"""
    if depth > 8:
        raise ApiError('validation_failed', '提交的内容嵌套太深')
    if isinstance(value, str):
        if looks_like_secret(value):
            raise ApiError('secret_detected')
    elif isinstance(value, dict):
        for k, v in value.items():
            scan(str(k), depth + 1)
            scan(v, depth + 1)
    elif isinstance(value, (list, tuple)):
        for v in value:
            scan(v, depth + 1)


def band_for(total):
    for key, _, low, high, _ in rules.BANDS:
        if total >= low and (high is None or total < high):
            return key
    return rules.BANDS[0][0]


def band_label(key):
    return next(b[1] for b in rules.BANDS if b[0] == key)


def band_mid_millions(key):
    return next(b[4] for b in rules.BANDS if b[0] == key)


def resolve_band(value):
    for key, label, *_ in rules.BANDS:
        if value in (key, label):
            return key
    raise ApiError('validation_failed', '量级区间不在可选范围内')


def resolve_family(value):
    for key, label in rules.FAMILIES:
        if value in (key, label):
            return key
    raise ApiError('validation_failed', '模型家族不在可选范围内')


def family_label(key):
    return next((label for k, label in rules.FAMILIES if k == key), key)


def _num(value):
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None


def _from_json(data):
    if isinstance(data, dict):
        totals = data.get('totals')
        if isinstance(totals, dict):
            for key in TOTAL_KEYS:
                if _num(totals.get(key)) is not None:
                    return _num(totals[key])
    found = []

    def walk(node):
        if isinstance(node, dict):
            total = next((_num(node[k]) for k in TOTAL_KEYS if k in node and _num(node[k]) is not None), None)
            if total is not None:
                found.append(total)
                return
            parts = [_num(node[k]) for k in PART_KEYS if k in node and _num(node[k]) is not None]
            if parts:
                found.append(sum(parts))
                return
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    return sum(found) if found else None


def _from_csv(text):
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        return None
    header = [h.strip().lower().replace(' ', '').replace('_', '') for h in rows[0]]
    cols = [i for i, h in enumerate(header) if h in ('totaltokens', 'tokens')]
    if not cols:
        cols = [i for i, h in enumerate(header) if h in ('inputtokens', 'outputtokens', 'cachecreationtokens',
                                                         'cachereadtokens')]
    if not cols:
        return None
    total = 0
    for row in rows[1:]:
        for i in cols:
            try:
                total += max(0, int(float(row[i].replace(',', ''))))
            except (IndexError, ValueError):
                continue
    return total


def parse_usage(text):
    """只返回一个整数总量；原文不保留。"""
    if len(text) > MAX_FILE_CHARS:
        raise ApiError('payload_too_large')
    total = None
    stripped = text.lstrip()
    if stripped[:1] in '{[':
        try:
            total = _from_json(json.loads(text))
        except ValueError:
            total = None
    if total is None:
        total = _from_csv(text)
    if total is None or total > MAX_TOKENS:
        raise ApiError('validation_failed', '没能从文件里识别出用量数字，请改为手动选择量级区间')
    return total


def submit(conn, ctx_actor_id, season_id, body, request_id=None):
    allowed = {'family', 'band', 'usage_file', 'trust'}
    if not isinstance(body, dict) or set(body) - allowed:
        raise ApiError('unknown_field')
    if body.get('trust', 'self') != 'self':
        raise ApiError('validation_failed', '现在只收自报（trust 只能是 self）')
    if 'family' not in body:
        raise ApiError('validation_failed', '请选择模型家族')
    family = resolve_family(body['family'])
    band = resolve_band(body['band']) if body.get('band') is not None else None
    from_file = 0
    upload = body.get('usage_file')
    if upload is not None:
        if not isinstance(upload, dict) or set(upload) - {'name', 'text'} or not isinstance(upload.get('text'), str):
            raise ApiError('validation_failed', 'usage_file 需要 {name?, text}')
        total = parse_usage(upload['text'])
        band = band_for(total)
        from_file = 1
        del upload['text'], total
    if band is None:
        raise ApiError('validation_failed', '请选择量级区间，或上传用量文件')
    conn.execute(
        'INSERT INTO growth_token_report (principal_id, season_id, family, band, trust, from_file, reported_at) '
        "VALUES (?, ?, ?, ?, 'self', ?, ?) ON CONFLICT(principal_id, season_id) DO UPDATE SET "
        'family = excluded.family, band = excluded.band, from_file = excluded.from_file, '
        'reported_at = excluded.reported_at', (ctx_actor_id, season_id, family, band, from_file, clock.now()))
    audit.record(conn, ctx_actor_id, 'growth.token_report', 'growth_season', season_id, request_id=request_id,
                 meta={'family': family, 'band': band, 'from_file': bool(from_file)})
    return {'family': family_label(family), 'familyKey': family, 'band': band_label(band), 'bandKey': band,
            'trust': 'self', 'fromFile': bool(from_file), 'seasonId': season_id}
