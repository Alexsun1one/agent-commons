"""发布到公开层之前的初筛（OPEN-1 的 modules/public/screen.py 会自动找到这里的 screen）。

只读、不落库：跑同一套本机规则检测器，返回 {'result': 'pass'|'review'|'block', 'reasons': [{'code','severity'}]}。
联系方式和私人链接在公开页上一律 block；其他越过阈值的证据、或这条内容有未结的治理事项，都是 review。
理由里只放规则编号，不放正文。
"""
from . import detectors, pii, service
from .detectors import Item, PiiSpan

BLOCKING = frozenset({'pii.contact', 'html.inspect', 'file.type'})
ORDER = {'pass': 0, 'review': 1, 'block': 2}


def _get(row, key, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return default


def screen(conn, actor, head, version, text):
    if not service.installed(conn):
        return {'result': 'pass', 'reasons': []}
    book = service.rulebook(conn)
    title, tspans = pii.mask(_get(head, 'title') or '')
    body, xspans = pii.mask(text or '')
    spans = tuple(PiiSpan(f, c, s, e) for f, found in (('title', tspans), ('text', xspans)) for s, e, c in found)
    item = Item('object', _get(head, 'id') or '', _get(version, 'version') or _get(head, 'current_version') or 0,
                _get(head, 'type') or '', title, body, pii=spans)
    result, reasons, seen = 'pass', [], set()
    with detectors.rule_params(book):
        for d in detectors.applicable(item, kind='rule'):
            signals, _ = detectors.call(conn, d, item)
            for s in signals:
                rule = book.get(s.rule)
                if rule is None or not rule['enabled'] or s.score < rule['threshold'] or s.rule in seen:
                    continue
                seen.add(s.rule)
                severity = 'block' if s.rule in BLOCKING else 'review'
                reasons.append({'code': f'gov.{s.rule}', 'severity': severity})
                if ORDER[severity] > ORDER[result]:
                    result = severity
    object_id = _get(head, 'id')
    if object_id and conn.execute("SELECT 1 FROM gov_case WHERE target_type = 'object' AND target_id = ? "
                                  "AND status IN ('open', 'triaged', 'appealed')", (object_id,)).fetchone():
        reasons.append({'code': 'gov.case_open', 'severity': 'review'})
        if ORDER['review'] > ORDER[result]:
            result = 'review'
    return {'result': result, 'reasons': reasons}
