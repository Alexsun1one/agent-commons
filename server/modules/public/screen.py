"""发布前初筛：本机的规则层，加上留给 GOV-1 的调用点。

GOV-1 的治理模块合并后，只要在 `modules.governance.screening.screen(conn, actor, head, version, text)`
里返回 `{'result': 'pass'|'review'|'block', 'reasons': [...]}`（或直接返回字符串），就会自动接上。
在那之前用这里的本机规则；测试可以用 `register_screener` 注入替身。

结果只记代码和严重度，不把正文、联系方式写进审计。
"""
import logging
import re

LOG = logging.getLogger('commons.public')
SCREENERS = []
GOVERNANCE_HOOK = True  # 测试可以关掉，避免依赖治理规则阈值的变动
_HOOK = []

ORDER = {'pass': 0, 'review': 1, 'block': 2}

BLOCK_PATTERNS = (
    ('phone', re.compile(r'(?<!\d)1[3-9]\d{9}(?!\d)')),
    ('wxid', re.compile(r'wxid_[A-Za-z0-9_-]{4,}')),
    ('group_id', re.compile(r'@chatroom', re.I)),
    ('email', re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')),
)
MANY_LINKS = 5
MAX_CHARS = 40_000


def register_screener(fn):
    """给 GOV-1 和测试用的注入点。fn(conn, actor, head, version, text) -> dict|str。"""
    if fn not in SCREENERS:
        SCREENERS.append(fn)


def _governance_hook():
    if not GOVERNANCE_HOOK:
        return None
    if _HOOK:
        return _HOOK[0]
    try:
        from modules.governance import screening
    except Exception:  # 还没合并、或合并了但导入失败，都不该挡住公开层
        _HOOK.append(None)
        return None
    fn = getattr(screening, 'screen', None)
    _HOOK.append(fn if callable(fn) else None)
    return _HOOK[0]


def _collect(value):
    if isinstance(value, str):
        return (value, []) if value in ORDER else ('pass', [])
    if not isinstance(value, dict):
        return 'pass', []
    result = value.get('result') if value.get('result') in ORDER else 'pass'
    reasons = []
    for reason in value.get('reasons') or []:
        if isinstance(reason, str):
            reasons.append({'code': reason[:60], 'severity': result})
        elif isinstance(reason, dict):
            code = str(reason.get('code') or 'unspecified')[:60]
            severity = reason.get('severity') if reason.get('severity') in ORDER else result
            reasons.append({'code': code, 'severity': severity})
    return result, reasons


def builtin(head, text):
    result, reasons = 'pass', []
    title = (head.get('title') or '').strip() if isinstance(head, dict) else ''
    body = text or ''
    if not title:
        return 'block', [{'code': 'empty_title', 'severity': 'block'}]
    if not body.strip():
        return 'block', [{'code': 'empty_body', 'severity': 'block'}]
    if len(body) > MAX_CHARS:
        result = 'block'
        reasons.append({'code': 'too_long', 'severity': 'block'})
    for code, pattern in BLOCK_PATTERNS:
        if pattern.search(body):
            result = 'block'
            reasons.append({'code': code, 'severity': 'block'})
    if body.count('http://') + body.count('https://') > MANY_LINKS:
        reasons.append({'code': 'many_links', 'severity': 'review'})
        if ORDER['review'] > ORDER[result]:
            result = 'review'
    return result, reasons


def screen(conn, actor, head, version, text):
    result, reasons = builtin(head, text)
    hook = _governance_hook()
    checks = [fn for fn in [hook, *SCREENERS] if fn]
    for fn in checks:
        try:
            their_result, their_reasons = _collect(fn(conn, actor, head, version, text))
        except Exception:
            LOG.exception('public screener failed; treating as review')
            their_result, their_reasons = 'review', [{'code': 'screener_error', 'severity': 'review'}]
        if ORDER[their_result] > ORDER[result]:
            result = their_result
        reasons += their_reasons
    return {'result': result, 'reasons': reasons}
