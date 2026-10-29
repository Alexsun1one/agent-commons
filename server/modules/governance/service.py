"""治理流程：规则簿、初筛、事项、举报、动作、申诉、通知、到期清扫、Agent 任务、统计。

写操作都在调用方的写事务里完成，并同时写 audit_event；对被处理的人写 gov_notice 并发 outbox 事件。
对象状态只经 objects.set_lifecycle / objects.withdraw 改，扣分只经 ledger.record / ledger.reverse。
"""
import json
import math
import uuid
from types import SimpleNamespace

from app import accounts, audit, clock, flags, ledger, objects, outbox
from app.authz import visible_predicate
from app.errors import ApiError
from app.storage import LocalStorage

from . import detectors, model, pii, rules  # noqa: F401  rules / model 导入时登记检测器
from .detectors import Item, MediaRef, PiiSpan

RISKS = ('low', 'medium', 'high', 'critical')
ACTIVE = ('open', 'triaged')
ACTIONS = {
    'hide': dict(reversible=True, two_person=False, auto=False, label='隐藏'),
    'pending_review': dict(reversible=True, two_person=False, auto=True, label='待审核'),
    'rate_limit': dict(reversible=True, two_person=False, auto=True, label='限速'),
    'require_source': dict(reversible=True, two_person=False, auto=True, label='要求补来源'),
    'delete': dict(reversible=False, two_person=True, auto=False, label='删除'),
    'ban': dict(reversible=True, two_person=True, auto=False, label='封禁'),
    'deduct': dict(reversible=True, two_person=False, auto=False, label='扣分'),
    'demote': dict(reversible=True, two_person=False, auto=False, label='降级'),
    'restore': dict(reversible=False, two_person=False, auto=False, label='恢复'),
}
AUTO_ACTIONS = frozenset(k for k, v in ACTIONS.items() if v['auto'])
assert all(ACTIONS[a]['reversible'] for a in AUTO_ACTIONS)
CONTENT_ACTIONS = ('hide', 'pending_review')
PUNITIVE = ('hide', 'pending_review', 'rate_limit', 'require_source', 'delete', 'ban', 'deduct', 'demote')
CONTEXT = SimpleNamespace(name='rule.context', version='1', kind='rule', egress=False)
REPORT_REASONS = ('spam', 'contact', 'harassment', 'illegal', 'misinformation', 'copyright', 'privacy', 'other')

TITLES = {
    'hide': '你的一条内容已被隐藏',
    'pending_review': '你的一条内容正在等待审核',
    'rate_limit': '你的发布暂时被限速',
    'require_source': '请为你的内容补充来源',
    'delete': '你的一条内容已被删除',
    'ban': '你的账号已暂停使用',
    'deduct': '你被扣除了贡献值',
    'demote': '你的信任等级被下调',
}
EFFECTS = {
    'hide': '这条内容已对其他成员隐藏，你自己仍能看到。',
    'pending_review': '这条内容暂时只有你自己能看到，治理员看过后会公开或说明原因。',
    'rate_limit': '接下来 {hours} 小时内，你每小时发布超过 {per_hour} 条时，多出的内容会先进入待审核。',
    'require_source': '请编辑这条内容，写明来源。',
    'delete': '这条内容已删除，无法恢复。',
    'ban': '你的账号已暂停使用，期间不能登录。',
    'deduct': '你的贡献值被扣除 {points} 分。',
    'demote': '你的信任等级从 L{level_from} 调整为 L{level_to}。',
}


def installed(conn):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'gov_case'").fetchone() is not None


def _id():
    return str(uuid.uuid4())


def _dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def _loads(text):
    return json.loads(text) if text else {}


def _later(hours):
    return clock.iso(clock.now_ts() + hours * 3600)


def _rank(risk):
    return RISKS.index(risk)


# ---------------------------------------------------------------- 规则簿

def rulebook(conn):
    return {r['id']: dict(r, params=json.loads(r['params_json'])) for r in conn.execute('SELECT * FROM gov_rule')}


def rule_dto(r):
    return {k: r[k] for k in ('id', 'version', 'kind', 'category', 'title', 'description', 'severity', 'threshold',
                              'auto_action', 'updated_at', 'updated_by')} | {'enabled': bool(r['enabled']),
                                                                              'params': r['params']}


def _snapshot(r):
    return {'enabled': int(r['enabled']), 'severity': r['severity'], 'threshold': r['threshold'],
            'auto_action': r['auto_action'], 'params': r['params'], 'title': r['title'],
            'description': r['description']}


def _same_shape(old, new):
    if isinstance(old, bool):
        return isinstance(new, bool)
    if isinstance(old, (int, float)):
        return isinstance(new, (int, float)) and not isinstance(new, bool) and math.isfinite(new)
    if isinstance(old, str):
        return isinstance(new, str) and len(new) <= 200
    if isinstance(old, list):
        return (isinstance(new, list) and len(new) <= 200 and all(
            (isinstance(x, str) and 0 < len(x) <= 60) or (isinstance(x, (int, float)) and not isinstance(x, bool))
            for x in new))
    if isinstance(old, dict):
        return isinstance(new, dict) and set(new) == set(old) and all(_same_shape(old[k], new[k]) for k in old)
    return False


def _check_policy(rule_id, params, old):
    def bad(msg):
        raise ApiError('validation_failed', msg)
    if params.get('event_type') != old.get('event_type'):
        bad('流水事件类型不能改，它和成长体系共用')
    if rule_id == 'policy.violation' and not -500 <= params['points'] < 0:
        bad('违规扣分要在 -500 到 -1 之间')
    if rule_id == 'policy.report_reward' and not 0 <= params['points'] <= 50:
        bad('举报奖励要在 0 到 50 之间')
    if rule_id == 'policy.sla' and any(not 0 < v <= 720 for v in params['hours'].values()):
        bad('处理时限要在 0 到 720 小时之间')
    if rule_id == 'policy.volunteer_hide' and not 1 <= params['restore_after_hours'] <= 168:
        bad('自动恢复时间要在 1 到 168 小时之间')
    if rule_id == 'policy.auto':
        if params['pending_review_min_risk'] not in RISKS:
            bad('pending_review_min_risk 只能是 low/medium/high/critical')
        if any(lvl not in (1, 2, 3, 4, 5) for lvl in params['pending_review_levels']):
            bad('pending_review_levels 只能是 1 到 5')
    if rule_id == 'policy.report_weight' and not 0 <= params['floor'] <= params['cap'] <= 10:
        bad('举报权重的上下限不合理')


def update_rule(conn, actor_id, rule_id, changes, reason, request_id=None):
    book = rulebook(conn)
    r = book.get(rule_id)
    if r is None:
        raise ApiError('resource_not_found')
    new = dict(r)
    if 'enabled' in changes:
        new['enabled'] = 1 if changes['enabled'] else 0
    if 'severity' in changes:
        if changes['severity'] not in RISKS:
            raise ApiError('validation_failed', '严重度只能是 low/medium/high/critical')
        new['severity'] = changes['severity']
    if 'threshold' in changes:
        t = changes['threshold']
        if not isinstance(t, (int, float)) or isinstance(t, bool) or not 0 <= t <= 1:
            raise ApiError('validation_failed', '阈值要在 0 到 1 之间')
        new['threshold'] = float(t)
    if 'auto_action' in changes:
        a = changes['auto_action']
        if a != 'none' and a not in AUTO_ACTIONS:
            raise ApiError('validation_failed', '自动动作只能是可逆的：pending_review、rate_limit、require_source')
        if a != 'none' and r['kind'] in ('agent', 'policy'):
            raise ApiError('validation_failed', 'Agent 建议和策略项不能配置自动动作')
        new['auto_action'] = a
    if 'params' in changes:
        if not _same_shape(r['params'], changes['params']):
            raise ApiError('validation_failed', 'params 的字段和类型要与当前版本一致')
        _check_policy(rule_id, changes['params'], r['params'])
        new['params'] = changes['params']
    if _snapshot(new) == _snapshot(r):
        return rule_dto(r)
    version = r['version'] + 1
    now = clock.now()
    conn.execute('UPDATE gov_rule SET version = ?, enabled = ?, severity = ?, threshold = ?, auto_action = ?, '
                 'params_json = ?, updated_at = ?, updated_by = ? WHERE id = ?',
                 (version, new['enabled'], new['severity'], new['threshold'], new['auto_action'],
                  _dumps(new['params']), now, actor_id, rule_id))
    conn.execute('INSERT INTO gov_rule_version (rule_id, version, snapshot_json, reason, changed_by, changed_at) '
                 'VALUES (?, ?, ?, ?, ?, ?)', (rule_id, version, _dumps(_snapshot(new)), reason, actor_id, now))
    changed = sorted(k for k in ('enabled', 'severity', 'threshold', 'auto_action', 'params') if new[k] != r[k])
    audit.record(conn, actor_id, 'gov.rule.update', 'gov_rule', rule_id, request_id=request_id,
                 meta={'version': version, 'fields': changed})
    return rule_dto(rulebook(conn)[rule_id])


def rule_history(conn, rule_id):
    rows = conn.execute('SELECT version, snapshot_json, reason, changed_by, changed_at FROM gov_rule_version '
                        'WHERE rule_id = ? ORDER BY version DESC', (rule_id,)).fetchall()
    if not rows:
        raise ApiError('resource_not_found')
    return [dict(r, snapshot=json.loads(r['snapshot_json'])) for r in rows]


# ---------------------------------------------------------------- 举报权重与风险

def accuracy_bonus(agreed, disagreed, p):
    """照 Discourse ReviewableScore：样本不足不加减；准确率高于轴线加分、低于扣分，按 log4(样本数) 放大。"""
    total = agreed + disagreed
    if total <= p['min_reviewed']:
        return 0.0
    axis = p['accuracy_axis']
    pct = agreed / total
    if pct >= axis:
        distance = (pct - axis) / (1 - axis)
    else:
        distance = -(axis - pct) / axis
    return round(distance * math.log(total, 4) * p['accuracy_scale'], 2)


def report_weight(level, agreed, disagreed, p):
    raw = p['base'] + p['level_bonus'].get(str(level), 0.0) + accuracy_bonus(agreed, disagreed, p)
    return round(min(p['cap'], max(p['floor'], raw)), 2)


def reporter_history(conn, reporter_id):
    counts = dict(conn.execute("SELECT outcome, count(*) FROM gov_report WHERE reporter_id = ? "
                               "AND outcome IN ('upheld', 'rejected') GROUP BY outcome", (reporter_id,)).fetchall())
    return counts.get('upheld', 0), counts.get('rejected', 0)


def risk_level(score, p):
    levels = p['levels']
    for name in ('critical', 'high', 'medium'):
        if score >= levels[name]:
            return name
    return 'low'


def refresh_case(conn, case_id, book=None):
    book = book or rulebook(conn)
    case = conn.execute('SELECT * FROM gov_case WHERE id = ?', (case_id,)).fetchone()
    rp = book['policy.risk']['params']
    weights = rp['severity_weight']
    top_signal, top_category = 0.0, None
    for s in conn.execute("SELECT rule_id, category, score FROM gov_signal WHERE case_id = ? AND over_threshold = 1 "
                          "AND review != 'rejected'", (case_id,)):
        rule = book.get(s['rule_id']) or book['agent.default']
        value = weights[rule['severity']] * s['score']
        if value > top_signal:
            top_signal, top_category = value, s['category']
    reports = conn.execute("SELECT reason_code, sum(weight) AS w FROM gov_report WHERE case_id = ? "
                           "AND outcome != 'rejected' GROUP BY reason_code ORDER BY w DESC", (case_id,)).fetchall()
    report_score = rp['report_factor'] * sum(r['w'] for r in reports)
    score = round(top_signal + report_score, 3)
    category = top_category if top_signal >= report_score and top_category else (
        reports[0]['reason_code'] if reports else case['category'])
    risk = risk_level(score, rp)
    hours = book['policy.sla']['params']['hours'][risk]
    due = clock.iso(clock.parse(case['opened_at']) + hours * 3600)
    due = min(due, case['sla_due_at'])
    conn.execute('UPDATE gov_case SET risk = ?, risk_score = ?, category = ?, sla_due_at = ?, updated_at = ? '
                 'WHERE id = ?', (risk, score, category, due, clock.now(), case_id))
    return risk


# ---------------------------------------------------------------- 事项与证据

def open_case(conn, book, *, source, target_type, target_id, target_version, subject_id, category, actor_id=None,
              request_id=None):
    row = conn.execute("SELECT * FROM gov_case WHERE target_type = ? AND target_id = ? AND status IN ('open', 'triaged')",
                       (target_type, target_id)).fetchone()
    if row is not None:
        if target_version and target_version > (row['target_version'] or 0):
            conn.execute('UPDATE gov_case SET target_version = ?, updated_at = ? WHERE id = ?',
                         (target_version, clock.now(), row['id']))
        return row['id'], False
    case_id = _id()
    now = clock.now()
    hours = book['policy.sla']['params']['hours']['low']
    conn.execute('INSERT INTO gov_case (id, source, target_type, target_id, target_version, subject_id, status, risk, '
                 "risk_score, category, sla_due_at, opened_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', 'low', 0, "
                 '?, ?, ?, ?)',
                 (case_id, source, target_type, target_id, target_version, subject_id, category, _later(hours), now, now))
    audit.record(conn, actor_id, 'gov.case.open', 'gov_case', case_id, reason=source, request_id=request_id,
                 meta={'target_type': target_type, 'target_id': target_id})
    outbox.emit(conn, 'governance.case_opened', 'gov_case', case_id,
                {'source': source, 'target_type': target_type, 'target_id': target_id},
                actor_id=actor_id, request_id=request_id)
    return case_id, True


def record_signal(conn, book, *, target_type, target_id, version, detector, signal, latency=0, input_hash='',
                  case_id=None):
    kind = detectors.kind_of(detector)
    rule_id = signal.rule if signal.rule in book else None
    if kind == 'agent' and (rule_id is None or book[rule_id]['kind'] != 'agent'):
        rule_id = 'agent.default'
    if rule_id is None:
        raise ValueError(f'unknown governance rule {signal.rule!r}')
    rule = book[rule_id]
    if not rule['enabled']:
        return None
    score = max(0.0, min(1.0, float(signal.score)))
    confidence = max(0.0, min(1.0, float(signal.confidence)))
    over = score >= rule['threshold']
    suggested = signal.suggested_action if signal.suggested_action in ACTIONS else None
    sid = _id()
    conn.execute(
        'INSERT INTO gov_signal (id, case_id, target_type, target_id, target_version, detector_kind, detector_name, '
        'detector_version, rule_id, rule_version, model_name, model_version, category, score, confidence, '
        'locator_json, summary, suggested_action, input_hash, output_json, latency_ms, over_threshold, review, '
        'created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (sid, case_id if over else None, target_type, target_id, version, kind, detector.name, detector.version,
         rule_id, rule['version'], (signal.output or {}).get('model') or getattr(detector, 'model', None),
         (signal.output or {}).get('model_version') or getattr(detector, 'model_version', None),
         signal.category[:40], score, confidence, _dumps({'version': version, **signal.locator}),
         (signal.summary or '')[:200], suggested, input_hash, _dumps(signal.output or {}), int(latency),
         1 if over else 0, 'pending' if over else 'none', clock.now()))
    return sid, over, rule_id


def _attach(conn, case_id, signal_ids):
    for sid in signal_ids:
        conn.execute('UPDATE gov_signal SET case_id = ? WHERE id = ?', (case_id, sid))


def _media_refs(content):
    out = []
    images = content.get('images') if isinstance(content, dict) else None
    for i, m in enumerate(images if isinstance(images, list) else []):
        if isinstance(m, dict):
            def num(key):
                v = m.get(key)
                return v if isinstance(v, int) and not isinstance(v, bool) else None
            out.append(MediaRef('image', str(m.get('mime') or '')[:80], num('size') or 0, None, num('width'),
                                num('height'), i))
    return tuple(out)


def object_item(conn, head, version=None, book=None):
    version = version or head['current_version']
    v = conn.execute('SELECT title, content_json, content_hash FROM object_version WHERE object_id = ? AND version = ?',
                     (head['id'], version)).fetchone()
    if v is None:
        return None
    content = json.loads(v['content_json'])
    text = objects.TYPES.get(head['type'], (None, objects.text_default))[1](content)
    html = content.get('html') if isinstance(content, dict) and isinstance(content.get('html'), str) else None
    title, tspans = pii.mask(v['title'])
    body, xspans = pii.mask(text)
    masked_html, hspans = None, []
    if html is not None:
        cap = ((book or {}).get('pii.contact') or {}).get('params', {}).get('html_scan_chars', 200000)
        hspans = pii.find(html[:cap])
        masked_html = pii.mask(html, hspans)[0]
    spans = tuple(PiiSpan(f, c, s, e) for f, found in (('title', tspans), ('text', xspans), ('html', hspans))
                  for s, e, c in found)
    return Item('object', head['id'], version, head['type'], title, body, html, masked_html, _media_refs(content),
                spans, v['content_hash'])


def context_signals(conn, head, item, book):
    out = []
    flood = book['spam.flood']
    if flood['enabled']:
        p = flood['params']
        at = head['created_at']
        since = clock.iso(clock.parse(at) - p['window_minutes'] * 60)
        n = conn.execute('SELECT count(*) FROM object_head WHERE author_id = ? AND created_at >= ? AND created_at <= ?',
                         (head['author_id'], since, at)).fetchone()[0]
        if n > p['max_objects']:
            out.append(detectors.Signal('spam.flood', 'spam', min(1.0, 0.5 + 0.05 * (n - p['max_objects'])), 1.0,
                                        {'field': 'activity', 'count': n, 'window_minutes': p['window_minutes']},
                                        f'{p["window_minutes"]} 分钟内发了 {n} 条', 'rate_limit'))
    dup = book['dup.content']
    if dup['enabled'] and len(item.text.strip()) >= dup['params']['min_length']:
        since = clock.iso(clock.now_ts() - dup['params']['window_days'] * 86400)
        same = conn.execute('SELECT count(DISTINCT target_id) FROM gov_fingerprint WHERE content_hash = ? '
                            'AND target_id != ? AND created_at >= ?',
                            (item.content_hash, head['id'], since)).fetchone()[0]
        if same:
            out.append(detectors.Signal('dup.content', 'duplicate', 0.95, 1.0, {'field': 'text', 'same_as': same},
                                        f'与另外 {same} 条内容完全相同'))
    return out


def screen_object(conn, object_id, request_id=None):
    """初筛一条对象的当前版本（每个版本只筛一次）。规则检测器同步跑；Agent 检测器排队到事务外。"""
    if not installed(conn) or not flags.enabled(conn, 'governance.enabled'):
        return None
    flags.gate(conn, 'governance.enabled')
    head = conn.execute('SELECT * FROM object_head WHERE id = ?', (object_id,)).fetchone()
    if head is None or head['lifecycle'] != 'active':
        return None
    version = head['current_version']
    if conn.execute("SELECT 1 FROM gov_screening WHERE target_type = 'object' AND target_id = ? AND target_version = ?",
                    (object_id, version)).fetchone():
        return None
    book = rulebook(conn)
    premod = flags.enabled(conn, 'gov.premoderation')
    item = object_item(conn, head, book=book)
    recorded = []
    if flags.enabled(conn, 'gov.screening'):
        with detectors.rule_params(book):
            found = []
            for d in detectors.applicable(item, kind='rule'):
                signals, latency = detectors.call(conn, d, item)
                found += [(d, s, latency) for s in signals]
        found += [(CONTEXT, s, 0) for s in context_signals(conn, head, item, book)]
        digest = item.input_hash()
        for d, s, latency in found:
            res = record_signal(conn, book, target_type='object', target_id=object_id, version=version, detector=d,
                                signal=s, latency=latency, input_hash=digest)
            if res:
                recorded.append(res)
        enqueue_agent_jobs(conn, item)
    over = [r for r in recorded if r[1]]
    limited = _rate_limited_overflow(conn, head)
    case_id = None
    if over or premod or limited:
        source = 'rule' if over else 'premoderation' if premod else 'rule'
        category = 'premoderation' if not over and premod else (
            book[over[0][2]]['category'] if over else 'spam')
        case_id, _ = open_case(conn, book, source=source, target_type='object', target_id=object_id,
                               target_version=version, subject_id=head['author_id'], category=category,
                               request_id=request_id)
        _attach(conn, case_id, [r[0] for r in over])
        risk = refresh_case(conn, case_id, book)
        _auto_actions(conn, book, case_id, head, risk, [r[2] for r in over], premod, limited, request_id)
    conn.execute('INSERT INTO gov_fingerprint (target_type, target_id, target_version, content_hash, created_at) '
                 "VALUES ('object', ?, ?, ?, ?)", (object_id, version, item.content_hash, clock.now()))
    conn.execute('INSERT INTO gov_screening (target_type, target_id, target_version, screened_at, signal_count, case_id) '
                 "VALUES ('object', ?, ?, ?, ?, ?)", (object_id, version, clock.now(), len(recorded), case_id))
    return case_id


def pre_publish(conn, actor, head, version):
    """Run the existing synchronous rules before the surrounding publish transaction commits."""
    screen_object(conn, head['id'])
    current = conn.execute('SELECT lifecycle FROM object_head WHERE id = ?', (head['id'],)).fetchone()
    return 'pending_review' if current is not None and current['lifecycle'] == 'pending_review' else 'active'


objects.register_pre_publish(pre_publish)


def _rate_limited_overflow(conn, head):
    limit = active_rate_limit(conn, head['author_id'])
    if limit is None:
        return None
    per_hour = _loads(limit['params_json']).get('per_hour', 3)
    at = head['created_at']
    since = clock.iso(clock.parse(at) - 3600)
    n = conn.execute('SELECT count(*) FROM object_head WHERE author_id = ? AND created_at >= ? AND created_at <= ?',
                     (head['author_id'], since, at)).fetchone()[0]
    return limit if n > per_hour else None


def active_rate_limit(conn, principal_id):
    return conn.execute("SELECT * FROM gov_action WHERE subject_id = ? AND action_type = 'rate_limit' "
                        "AND state = 'executed' AND (expires_at IS NULL OR expires_at > ?) "
                        'ORDER BY created_at DESC LIMIT 1', (principal_id, clock.now())).fetchone()


def _auto_actions(conn, book, case_id, head, risk, over_rules, premod, limited, request_id):
    auto = book['policy.auto']['params']
    level = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (head['author_id'],)).fetchone()[0]
    wanted = {}
    for rule_id in over_rules:
        action = book[rule_id]['auto_action']
        if action == 'pending_review':
            if level in auto['pending_review_levels'] and _rank(risk) >= _rank(auto['pending_review_min_risk']):
                wanted.setdefault('pending_review', rule_id)
        elif action in AUTO_ACTIONS:
            wanted.setdefault(action, rule_id)
    if premod:
        wanted.setdefault('pending_review', 'policy.premoderation')
    if limited is not None:
        wanted.setdefault('pending_review', 'spam.flood')
    for action, rule_id in sorted(wanted.items()):
        rule = book[rule_id]
        params = {}
        if action == 'rate_limit':
            p = book['spam.flood']['params']
            params = {'hours': p['limit_hours'], 'per_hour': p['limited_max_per_hour']}
        apply_auto(conn, book, case_id, action, rule_id, rule['description'], params, request_id)


def apply_auto(conn, book, case_id, action_type, rule_id, reason, params=None, request_id=None):
    if action_type not in AUTO_ACTIONS:
        raise ValueError(f'automatic action {action_type!r} is not allowed: only reversible actions run unattended')
    case = conn.execute('SELECT * FROM gov_case WHERE id = ?', (case_id,)).fetchone()
    if action_type == 'rate_limit':
        if active_rate_limit(conn, case['subject_id']) is not None:
            return None
    elif conn.execute("SELECT 1 FROM gov_action WHERE case_id = ? AND action_type = ? AND state = 'executed'",
                      (case_id, action_type)).fetchone():
        return None
    expires = _later(params['hours']) if action_type == 'rate_limit' else None
    action_id = _insert_action(conn, book, case, action_type, 'system', None, reason, rule_id, params or {},
                               automatic=True, expires_at=expires)
    execute(conn, None, action_id, actor_id=None, request_id=request_id)
    return action_id


# ---------------------------------------------------------------- 动作

def _insert_action(conn, book, case, action_type, actor_kind, actor_id, reason, rule_id, params, *, automatic=False,
                   state='executed', expires_at=None, reverts=None):
    rule = book.get(rule_id) if rule_id else None
    action_id = _id()
    target_type = case['target_type']
    conn.execute(
        'INSERT INTO gov_action (id, case_id, action_type, target_type, target_id, subject_id, reversible, automatic, '
        'state, actor_kind, actor_id, rule_id, rule_version, reason, params_json, reverts_action_id, expires_at, '
        'created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (action_id, case['id'], action_type, target_type, case['target_id'], case['subject_id'],
         1 if ACTIONS[action_type]['reversible'] else 0, 1 if automatic else 0, state, actor_kind, actor_id,
         rule_id if rule else None, rule['version'] if rule else None, reason[:1000], _dumps(params or {}), reverts,
         expires_at, clock.now()))
    return action_id


def _object_head(conn, object_id):
    return conn.execute('SELECT * FROM object_head WHERE id = ?', (object_id,)).fetchone()


def _effect(conn, settings, a, actor_id):
    t, subject = a['action_type'], a['subject_id']
    prev, entry, extra = {}, None, {}
    if t in CONTENT_ACTIONS or t == 'delete':
        if a['target_type'] != 'object':
            from . import chat
            if t != 'hide' or not chat.hideable(a['target_id']):
                raise ApiError('state_conflict', '这个动作只能用在内容上；广场消息和找搭子需求只能隐藏，私信不能隐藏')
            return chat.hide(conn, a['target_id']), None, {}
        head = _object_head(conn, a['target_id'])
        if head is None or head['lifecycle'] == 'withdrawn':
            raise ApiError('state_conflict', '内容已撤回')
        prev = {'lifecycle': head['lifecycle']}
        if t == 'delete':
            # The shared writer owns one log append; head carries current_version.
            # Keep only the short reason code here, never the operator's prose.
            objects.withdraw(conn, settings, actor_id, head, reason='gov_delete')
        else:
            target = 'hidden' if t == 'hide' else 'pending_review'
            if head['lifecycle'] != target:
                objects.set_lifecycle(conn, actor_id, head['id'], target, f'gov_{t}')
    elif t == 'ban':
        prev = {'status': accounts.suspend(conn, subject, actor_id, f'governance:{a["id"]}')}
        outbox.emit(conn, 'governance.principal_suspended', 'principal', subject, {'action_id': a['id']},
                    actor_id=actor_id)
    elif t == 'deduct':
        book = rulebook(conn)
        p = book['policy.violation']
        entry = ledger.record(conn, event_type=p['params']['event_type'], subject_id=subject,
                              points=int(p['params']['points']), rule_version=f'policy.violation@v{p["version"]}',
                              idempotency_key=f'gov:deduct:{a["id"]}', source_ref=f'gov_action:{a["id"]}',
                              actor_id=actor_id, confirmed_by=a['second_actor_id'] or actor_id)
        extra['points'] = -int(p['params']['points'])
    elif t == 'demote':
        row = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (subject,)).fetchone()
        if row is None or row['level'] <= 1:
            raise ApiError('state_conflict', '已经是最低等级')
        prev = {'level': row['level']}
        now = clock.now()
        conn.execute("UPDATE profile SET level = ?, level_source = 'governance', level_updated_at = ?, updated_at = ? "
                     'WHERE principal_id = ?', (row['level'] - 1, now, now, subject))
        outbox.emit(conn, 'governance.level_changed', 'principal', subject,
                    {'from': row['level'], 'to': row['level'] - 1, 'action_id': a['id']}, actor_id=actor_id)
        extra.update(level_from=row['level'], level_to=row['level'] - 1)
    return prev, entry, extra


def compose_notice(book, action_type, reason, rule_id, params=None, extra=None, volunteer=False):
    rule = book.get(rule_id) if rule_id else book['policy.community']
    rule = rule or book['policy.community']
    fields = {'hours': '?', 'per_hour': '?', 'points': '?', 'level_from': '?', 'level_to': '?'}
    fields.update(params or {})
    fields.update(extra or {})
    effect = EFFECTS[action_type].format(**fields)
    if volunteer:
        hours = book['policy.volunteer_hide']['params']['restore_after_hours']
        effect += f'{hours} 小时内没有第二位骨干同意，会自动恢复。'
    days = book['policy.appeal']['params']['window_days']
    body = (f'原因：{reason}\n依据：{rule["title"]}（第 {rule["version"]} 版）——{rule["description"]}\n'
            f'结果：{effect}\n如有异议，{days} 天内可以在「我的治理通知」里申诉，由 L5 成员复核。')
    return TITLES[action_type], body, rule


def _notify(conn, book, principal_id, kind, title, body, *, case_id=None, action_id=None, appeal_id=None, rule=None,
            appealable=False, request_id=None):
    if principal_id is None:
        return None
    notice_id = _id()
    deadline = _later(24 * book['policy.appeal']['params']['window_days']) if appealable else None
    conn.execute('INSERT INTO gov_notice (id, principal_id, case_id, action_id, appeal_id, kind, title, body, rule_id, '
                 'rule_version, rule_title, appealable, appeal_deadline, created_at) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (notice_id, principal_id, case_id, action_id, appeal_id, kind, title, body,
                  rule['id'] if rule else None, rule['version'] if rule else None, rule['title'] if rule else None,
                  1 if appealable else 0, deadline, clock.now()))
    outbox.emit(conn, 'governance.notice', 'gov_notice', notice_id,
                {'principal_id': principal_id, 'kind': kind, 'action_id': action_id}, request_id=request_id)
    return notice_id


def execute(conn, settings, action_id, *, actor_id, request_id=None):
    a = conn.execute('SELECT * FROM gov_action WHERE id = ?', (action_id,)).fetchone()
    book = rulebook(conn)
    prev, entry, extra = _effect(conn, settings, a, actor_id)
    params = _loads(a['params_json'])
    volunteer = a['actor_kind'] == 'volunteer'
    title, body, rule = compose_notice(book, a['action_type'], a['reason'], a['rule_id'], params, extra, volunteer)
    now = clock.now()
    conn.execute("UPDATE gov_action SET state = 'executed', executed_at = ?, prev_state_json = ?, ledger_entry_id = ?, "
                 'notice_text = ? WHERE id = ?', (now, _dumps(prev), entry, body, action_id))
    _notify(conn, book, a['subject_id'], 'action', title, body, case_id=a['case_id'], action_id=action_id, rule=rule,
            appealable=True, request_id=request_id)
    if a['actor_kind'] == 'governor':
        _review_signals(conn, a['case_id'], a['action_type'], actor_id)
        _resolve_reports(conn, book, a['case_id'], 'upheld', actor_id, request_id)
        conn.execute("UPDATE gov_case SET status = 'actioned', resolved_at = coalesce(resolved_at, ?), "
                     "resolution = ?, updated_at = ? WHERE id = ? AND status IN ('open', 'triaged', 'actioned')",
                     (now, a['action_type'], now, a['case_id']))
    audit.record(conn, actor_id, 'gov.action.execute', 'gov_action', action_id, reason=a['action_type'],
                 request_id=request_id, meta={'case_id': a['case_id'], 'automatic': bool(a['automatic']),
                                              'rule_id': a['rule_id'], 'rule_version': a['rule_version']})
    outbox.emit(conn, 'governance.action_executed', 'gov_action', action_id,
                {'type': a['action_type'], 'subject_id': a['subject_id'], 'target_id': a['target_id'],
                 'automatic': bool(a['automatic'])}, actor_id=actor_id, request_id=request_id)
    return action_id


def _review_signals(conn, case_id, action_type, actor_id):
    now = clock.now()
    conn.execute("UPDATE gov_signal SET review = CASE WHEN suggested_action = ? THEN 'accepted' ELSE 'modified' END, "
                 "reviewed_by = ?, reviewed_at = ? WHERE case_id = ? AND review = 'pending'",
                 (action_type, actor_id, now, case_id))


def _resolve_reports(conn, book, case_id, outcome, actor_id, request_id=None):
    now = clock.now()
    rows = conn.execute("SELECT * FROM gov_report WHERE case_id = ? AND outcome = 'pending'", (case_id,)).fetchall()
    reward = book['policy.report_reward']
    for r in rows:
        entry = None
        if outcome == 'upheld' and reward['params']['points'] > 0:
            entry = ledger.record(conn, event_type=reward['params']['event_type'], subject_id=r['reporter_id'],
                                  points=int(reward['params']['points']),
                                  rule_version=f'policy.report_reward@v{reward["version"]}',
                                  idempotency_key=f'gov:report:{r["id"]}', source_ref=f'gov_report:{r["id"]}',
                                  actor_id=actor_id, confirmed_by=actor_id)
        conn.execute('UPDATE gov_report SET outcome = ?, resolved_at = ?, reward_entry_id = ? WHERE id = ?',
                     (outcome, now, entry, r['id']))
        outbox.emit(conn, 'governance.report_resolved', 'gov_report', r['id'],
                    {'reporter_id': r['reporter_id'], 'outcome': outcome, 'upheld': outcome == 'upheld'}, actor_id=actor_id, request_id=request_id)


def _unreward_reports(conn, case_id, actor_id, request_id=None):
    for r in conn.execute("SELECT * FROM gov_report WHERE case_id = ? AND outcome = 'upheld'", (case_id,)).fetchall():
        if r['reward_entry_id']:
            ledger.reverse(conn, r['reward_entry_id'], reason='appeal_overturned', actor_id=actor_id,
                           idempotency_key=f'gov:report-revert:{r["id"]}', request_id=request_id)
        conn.execute("UPDATE gov_report SET outcome = 'rejected', resolved_at = ? WHERE id = ?", (clock.now(), r['id']))


def revert(conn, settings, action_id, *, actor_id, reason, mode='governor', request_id=None):
    """撤销一个已执行的动作并恢复原状。mode: governor（治理员）/ appeal（申诉成立）/ expiry（到期自动）。"""
    a = conn.execute('SELECT * FROM gov_action WHERE id = ?', (action_id,)).fetchone()
    if a is None:
        raise ApiError('resource_not_found')
    if a['state'] != 'executed':
        raise ApiError('state_conflict', '这个动作不在生效状态')
    if not a['reversible'] and mode != 'appeal':
        raise ApiError('state_conflict', '这个动作不可撤销')
    book = rulebook(conn)
    prev = _loads(a['prev_state_json'])
    t, subject = a['action_type'], a['subject_id']
    if t in CONTENT_ACTIONS and a['target_type'] != 'object':
        if t == 'hide':
            from . import chat
            chat.unhide(conn, a['target_id'], prev)
    elif t in CONTENT_ACTIONS:
        head = _object_head(conn, a['target_id'])
        resulting = 'hidden' if t == 'hide' else 'pending_review'
        if head is not None and head['lifecycle'] == resulting:
            back = prev.get('lifecycle')
            back = back if back in ('active', 'pending_review', 'hidden') and back != resulting else 'active'
            objects.set_lifecycle(conn, actor_id, head['id'], back, f'gov_revert_{t}')
    elif t == 'ban':
        row = conn.execute('SELECT status FROM principal WHERE id = ?', (subject,)).fetchone()
        if row is not None and row['status'] == 'suspended':
            accounts.unsuspend(conn, subject, actor_id, f'governance:{mode}', prev.get('status', 'active'))
    elif t == 'deduct' and a['ledger_entry_id']:
        ledger.reverse(conn, a['ledger_entry_id'], reason=f'gov_{mode}', actor_id=actor_id,
                       idempotency_key=f'gov:revert:{a["id"]}', request_id=request_id)
    elif t == 'demote':
        row = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (subject,)).fetchone()
        if row is not None and 'level' in prev and row['level'] == prev['level'] - 1:
            now = clock.now()
            conn.execute("UPDATE profile SET level = ?, level_source = 'governance', level_updated_at = ?, "
                         'updated_at = ? WHERE principal_id = ?', (prev['level'], now, now, subject))
            outbox.emit(conn, 'governance.level_changed', 'principal', subject,
                        {'from': prev['level'] - 1, 'to': prev['level'], 'action_id': a['id']}, actor_id=actor_id)
    state = 'expired' if mode == 'expiry' else 'reverted'
    now = clock.now()
    conn.execute('UPDATE gov_action SET state = ?, closed_at = ?, closed_by = ?, close_reason = ? WHERE id = ?',
                 (state, now, actor_id, reason[:1000], action_id))
    case = conn.execute('SELECT * FROM gov_case WHERE id = ?', (a['case_id'],)).fetchone()
    restore_id = _insert_action(conn, book, case, 'restore', 'system' if mode == 'expiry' else (
        'reviewer' if mode == 'appeal' else 'governor'), actor_id, reason, a['rule_id'], {}, reverts=action_id)
    conn.execute('UPDATE gov_action SET executed_at = ? WHERE id = ?', (now, restore_id))
    label = ACTIONS[t]['label']
    if mode == 'expiry':
        title, body = f'「{label}」已到期解除', f'「{label}」已到期自动解除。{reason}'
    elif t == 'delete':
        title, body = '删除处理已更正', f'这次删除已更正为不成立：{reason}。被删除的内容无法恢复，你可以重新发布。'
    else:
        title, body = f'「{label}」已撤销', f'对你的「{label}」处理已撤销，一切已恢复原状。理由：{reason}'
    _notify(conn, book, subject, 'expired' if mode == 'expiry' else 'reverted', title, body, case_id=a['case_id'],
            action_id=action_id, request_id=request_id)
    audit.record(conn, actor_id, 'gov.action.expire' if mode == 'expiry' else 'gov.action.revert', 'gov_action',
                 action_id, reason=mode, request_id=request_id, meta={'case_id': a['case_id'], 'type': t})
    outbox.emit(conn, 'governance.action_reverted', 'gov_action', action_id,
                {'type': t, 'subject_id': subject, 'mode': mode}, actor_id=actor_id, request_id=request_id)
    return restore_id


# ---------------------------------------------------------------- 治理员处置

def conflicts(conn, actor_id, case):
    out = []
    if case['subject_id'] == actor_id:
        out.append('subject')
    # 聊天/私信的举报行记的是消息本身（target_type=chat_message/dm_message），事项的目标另带前缀，所以也按 case_id 对。
    if conn.execute('SELECT 1 FROM gov_report WHERE reporter_id = ? AND (case_id = ? OR (target_type = ? AND target_id = ?))',
                    (actor_id, case['id'], case['target_type'], case['target_id'])).fetchone():
        out.append('reporter')
    return out


def _require_no_conflict(conn, actor_id, case):
    found = conflicts(conn, actor_id, case)
    if 'reporter' in found:
        raise ApiError('action_not_allowed', '你举报了这条内容，不能同时处理它')
    if 'subject' in found:
        raise ApiError('action_not_allowed', '不能处理和自己有关的事项')


def _case(conn, case_id):
    row = conn.execute('SELECT * FROM gov_case WHERE id = ?', (case_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def assign(conn, actor, case_id, assignee_id=None, request_id=None):
    case = _case(conn, case_id)
    if case['status'] not in ACTIVE:
        raise ApiError('state_conflict', '事项已处理')
    assignee = assignee_id or actor.id
    if not conn.execute("SELECT 1 FROM role_assignment WHERE principal_id = ? AND role = 'governor' "
                        'AND space_id IS NULL AND revoked_at IS NULL', (assignee,)).fetchone():
        raise ApiError('validation_failed', '只能分派给治理员')
    if conflicts(conn, assignee, case):
        raise ApiError('action_not_allowed', '这位治理员和事项有关，不能分派给他')
    conn.execute("UPDATE gov_case SET assignee_id = ?, status = 'triaged', updated_at = ? WHERE id = ?",
                 (assignee, clock.now(), case_id))
    audit.record(conn, actor.id, 'gov.case.assign', 'gov_case', case_id, request_id=request_id,
                 meta={'assignee_id': assignee})


def act(conn, settings, actor, case_id, action_type, reason, params=None, rule_id=None, request_id=None):
    if action_type not in ACTIONS:
        raise ApiError('validation_failed', '不认识的动作')
    reason = (reason or '').strip()
    if not reason:
        raise ApiError('validation_failed', '理由必填，会原样展示给被处理的人')
    case = _case(conn, case_id)
    if case['status'] not in ('open', 'triaged', 'actioned'):
        raise ApiError('state_conflict', '事项已结案或在申诉中')
    _require_no_conflict(conn, actor.id, case)
    book = rulebook(conn)
    if action_type == 'restore':
        return {'restored': restore(conn, settings, actor, case, reason, request_id)}
    if action_type in ('hide', 'pending_review', 'delete') and case['target_type'] != 'object':
        from . import chat
        if action_type != 'hide' or not chat.hideable(case['target_id']):
            raise ApiError('state_conflict', '这个动作只能用在内容上；广场消息和找搭子需求只能隐藏，私信不能隐藏')
    if action_type in ('ban', 'deduct', 'demote', 'rate_limit') and not case['subject_id']:
        raise ApiError('state_conflict', '这个事项没有对应的成员')
    params = dict(params or {})
    clean = {}
    if action_type == 'rate_limit':
        p = book['spam.flood']['params']
        hours = params.get('hours', p['limit_hours'])
        if not isinstance(hours, int) or isinstance(hours, bool) or not 1 <= hours <= 168:
            raise ApiError('validation_failed', '限速时长要在 1 到 168 小时之间')
        clean = {'hours': hours, 'per_hour': p['limited_max_per_hour']}
    elif params:
        raise ApiError('unknown_field', '这个动作不需要参数')
    if rule_id is not None and rule_id not in book:
        raise ApiError('validation_failed', '不认识的规则')
    if rule_id is None:
        top = conn.execute('SELECT rule_id FROM gov_signal WHERE case_id = ? AND over_threshold = 1 '
                           'ORDER BY score DESC, created_at LIMIT 1', (case_id,)).fetchone()
        rule_id = top['rule_id'] if top else 'policy.community'
    if ACTIONS[action_type]['two_person']:
        action_id = _insert_action(conn, book, case, action_type, 'governor', actor.id, reason, rule_id, clean,
                                   state='awaiting_second')
        audit.record(conn, actor.id, 'gov.action.propose', 'gov_action', action_id, reason=action_type,
                     request_id=request_id, meta={'case_id': case_id})
        return {'action_id': action_id, 'state': 'awaiting_second'}
    expires = _later(clean['hours']) if action_type == 'rate_limit' else None
    action_id = _insert_action(conn, book, case, action_type, 'governor', actor.id, reason, rule_id, clean,
                               expires_at=expires)
    execute(conn, settings, action_id, actor_id=actor.id, request_id=request_id)
    return {'action_id': action_id, 'state': 'executed'}


def confirm(conn, settings, actor, action_id, request_id=None):
    a = conn.execute('SELECT * FROM gov_action WHERE id = ?', (action_id,)).fetchone()
    if a is None:
        raise ApiError('resource_not_found')
    if a['state'] != 'awaiting_second':
        raise ApiError('state_conflict', '这个动作不在等待第二位确认')
    if a['actor_id'] == actor.id:
        raise ApiError('action_not_allowed', '双人原则：需要另一位治理员确认')
    case = _case(conn, a['case_id'])
    _require_no_conflict(conn, actor.id, case)
    conn.execute('UPDATE gov_action SET second_actor_id = ? WHERE id = ?', (actor.id, action_id))
    audit.record(conn, actor.id, 'gov.action.confirm', 'gov_action', action_id, reason=a['action_type'],
                 request_id=request_id, meta={'case_id': a['case_id']})
    execute(conn, settings, action_id, actor_id=actor.id, request_id=request_id)
    return {'action_id': action_id, 'state': 'executed'}


def cancel(conn, actor, action_id, reason, request_id=None):
    a = conn.execute('SELECT * FROM gov_action WHERE id = ?', (action_id,)).fetchone()
    if a is None:
        raise ApiError('resource_not_found')
    if a['state'] != 'awaiting_second':
        raise ApiError('state_conflict', '只能撤回还没确认的提议')
    conn.execute("UPDATE gov_action SET state = 'cancelled', closed_at = ?, closed_by = ?, close_reason = ? WHERE id = ?",
                 (clock.now(), actor.id, reason[:1000], action_id))
    audit.record(conn, actor.id, 'gov.action.cancel', 'gov_action', action_id, request_id=request_id)


def restore(conn, settings, actor, case, reason, request_id=None):
    """通过 / 恢复：撤销事项上生效中的内容动作（隐藏、待审核）；没有处罚类动作时按「不成立」结案。"""
    content = conn.execute("SELECT id FROM gov_action WHERE case_id = ? AND state = 'executed' "
                           "AND action_type IN ('hide', 'pending_review') ORDER BY created_at", (case['id'],)).fetchall()
    restored = [revert(conn, settings, r['id'], actor_id=actor.id, reason=reason, request_id=request_id)
                for r in content]
    if case['target_type'] == 'object' and not content:
        head = _object_head(conn, case['target_id'])
        if head is not None and head['lifecycle'] in ('pending_review', 'hidden'):
            objects.set_lifecycle(conn, actor.id, head['id'], 'active', 'gov_restore')
    punitive = conn.execute("SELECT 1 FROM gov_action WHERE case_id = ? AND state = 'executed' AND action_type IN "
                            "('delete', 'ban', 'deduct', 'demote')", (case['id'],)).fetchone()
    if not punitive and case['status'] in ACTIVE:
        _close_dismissed(conn, case['id'], actor.id, 'restored')
    audit.record(conn, actor.id, 'gov.case.restore', 'gov_case', case['id'], request_id=request_id,
                 meta={'reverted': len(restored)})
    return restored


def _close_dismissed(conn, case_id, actor_id, resolution):
    now = clock.now()
    conn.execute("UPDATE gov_signal SET review = 'rejected', reviewed_by = ?, reviewed_at = ? "
                 "WHERE case_id = ? AND review = 'pending'", (actor_id, now, case_id))
    conn.execute("UPDATE gov_report SET outcome = 'rejected', resolved_at = ? WHERE case_id = ? AND outcome = 'pending'",
                 (now, case_id))
    conn.execute("UPDATE gov_action SET state = 'cancelled', closed_at = ?, closed_by = ?, close_reason = 'case_dismissed' "
                 "WHERE case_id = ? AND state = 'awaiting_second'", (now, actor_id, case_id))
    conn.execute("UPDATE gov_case SET status = 'dismissed', resolved_at = ?, resolution = ?, updated_at = ? WHERE id = ?",
                 (now, resolution, now, case_id))


def dismiss(conn, settings, actor, case_id, reason, request_id=None):
    case = _case(conn, case_id)
    if case['status'] not in ACTIVE:
        raise ApiError('state_conflict', '事项已处理')
    _require_no_conflict(conn, actor.id, case)
    for r in conn.execute("SELECT id FROM gov_action WHERE case_id = ? AND state = 'executed' AND reversible = 1",
                          (case_id,)).fetchall():
        revert(conn, settings, r['id'], actor_id=actor.id, reason=reason, request_id=request_id)
    _close_dismissed(conn, case_id, actor.id, 'dismissed')
    audit.record(conn, actor.id, 'gov.case.dismiss', 'gov_case', case_id, request_id=request_id)


def manual_case(conn, actor, target_id, category, note, request_id=None):
    head = _object_head(conn, target_id)
    if head is None:
        raise ApiError('resource_not_found')
    book = rulebook(conn)
    case_id, _ = open_case(conn, book, source='manual', target_type='object', target_id=target_id,
                           target_version=head['current_version'], subject_id=head['author_id'],
                           category=category, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'gov.case.manual', 'gov_case', case_id, reason=category, request_id=request_id)
    return case_id


def set_premoderation(conn, actor, enabled, reason, request_id=None):
    flags.set_flag(conn, 'gov.premoderation', enabled, actor.id, request_id)
    audit.record(conn, actor.id, 'gov.premoderation.set', 'feature_flag', 'gov.premoderation',
                 request_id=request_id, meta={'enabled': bool(enabled)})
    return {'enabled': bool(enabled)}


# ---------------------------------------------------------------- 举报

def create_report(conn, actor, target_id, reason_code, note='', request_id=None):
    flags.gate(conn, 'governance.enabled')
    flags.gate(conn, 'gov.reports')
    if reason_code not in REPORT_REASONS:
        raise ApiError('validation_failed', '不认识的举报理由')
    head = objects.load_visible(conn, actor, target_id)
    if head['author_id'] == actor.id:
        raise ApiError('state_conflict', '不能举报自己的内容')
    existing = conn.execute("SELECT * FROM gov_report WHERE reporter_id = ? AND target_type = 'object' "
                            "AND target_id = ? AND outcome = 'pending'", (actor.id, target_id)).fetchone()
    if existing is not None:
        return existing['id'], False
    book = rulebook(conn)
    p = book['policy.report_weight']
    agreed, disagreed = reporter_history(conn, actor.id)
    weight = report_weight(actor.level, agreed, disagreed, p['params'])
    case_id, _ = open_case(conn, book, source='report', target_type='object', target_id=target_id,
                           target_version=head['current_version'], subject_id=head['author_id'],
                           category=reason_code, actor_id=actor.id, request_id=request_id)
    report_id = _id()
    conn.execute('INSERT INTO gov_report (id, reporter_id, target_type, target_id, target_version, reason_code, note, '
                 "weight, reporter_level, weight_rule_version, case_id, created_at) VALUES (?, ?, 'object', ?, ?, ?, ?, "
                 '?, ?, ?, ?, ?)',
                 (report_id, actor.id, target_id, head['current_version'], reason_code, (note or '')[:500], weight,
                  actor.level, p['version'], case_id, clock.now()))
    refresh_case(conn, case_id, book)
    audit.record(conn, actor.id, 'gov.report.create', 'gov_report', report_id, reason=reason_code,
                 request_id=request_id, meta={'case_id': case_id, 'weight': weight})
    return report_id, True


# ---------------------------------------------------------------- L3 志愿隐藏

def visible_if_active(conn, actor, object_id):
    """如果这条内容是 active，这个人能不能看到？复用唯一的权限谓词，只把 lifecycle 换成 active。"""
    pred = visible_predicate(actor, 'h')
    sql = (f"SELECT 1 FROM (SELECT id, type, author_id, space_id, root_id, visibility, min_level, 'active' AS lifecycle "
           f'FROM object_head WHERE id = :gov_oid) h WHERE {pred.sql}')
    return conn.execute(sql, {'gov_oid': object_id, **pred.params}).fetchone() is not None


def volunteer_hide(conn, actor, object_id, reason, request_id=None):
    reason = (reason or '').strip()
    if not reason:
        raise ApiError('validation_failed', '理由必填，会原样展示给被处理的人')
    head = objects.load_visible(conn, actor, object_id)
    book = rulebook(conn)
    p = book['policy.volunteer_hide']['params']
    if actor.level < p['min_level']:
        raise ApiError('resource_not_found')
    if head['author_id'] == actor.id:
        raise ApiError('state_conflict', '不能隐藏自己的内容')
    if head['lifecycle'] != 'active':
        raise ApiError('state_conflict', '这条内容已经不是公开状态')
    level = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (head['author_id'],)).fetchone()[0]
    if level > p['target_max_level']:
        raise ApiError('state_conflict', f'骨干只能隐藏 L{p["target_max_level"]} 成员的内容，其他请举报给治理员')
    case_id, _ = open_case(conn, book, source='volunteer', target_type='object', target_id=object_id,
                           target_version=head['current_version'], subject_id=head['author_id'], category='volunteer',
                           actor_id=actor.id, request_id=request_id)
    case = _case(conn, case_id)
    action_id = _insert_action(conn, book, case, 'hide', 'volunteer', actor.id, reason, 'policy.volunteer_hide', {},
                               expires_at=_later(p['restore_after_hours']))
    execute(conn, None, action_id, actor_id=actor.id, request_id=request_id)
    refresh_case(conn, case_id, book)
    return {'action_id': action_id, 'case_id': case_id, 'expires_at': _later(p['restore_after_hours'])}


def _pending_volunteer(conn, action_id):
    a = conn.execute("SELECT * FROM gov_action WHERE id = ? AND action_type = 'hide' AND actor_kind = 'volunteer' "
                     "AND state = 'executed' AND second_actor_id IS NULL AND expires_at > ?",
                     (action_id, clock.now())).fetchone()
    if a is None:
        raise ApiError('resource_not_found')
    return a


def volunteer_confirm(conn, actor, action_id, request_id=None):
    a = _pending_volunteer(conn, action_id)
    book = rulebook(conn)
    if actor.level < book['policy.volunteer_hide']['params']['min_level']:
        raise ApiError('resource_not_found')
    if a['actor_id'] == actor.id:
        raise ApiError('action_not_allowed', '需要第二位骨干同意')
    if a['subject_id'] == actor.id or not visible_if_active(conn, actor, a['target_id']):
        raise ApiError('resource_not_found')
    if conflicts(conn, actor.id, _case(conn, a['case_id'])):
        raise ApiError('action_not_allowed', '你举报了这条内容，不能同时确认隐藏')
    conn.execute('UPDATE gov_action SET second_actor_id = ?, expires_at = NULL WHERE id = ?', (actor.id, action_id))
    _notify(conn, book, a['subject_id'], 'confirmed', '隐藏已由第二位骨干确认',
            '对你内容的隐藏已经第二位骨干确认，不会自动恢复。如有异议，可以申诉。', case_id=a['case_id'],
            action_id=action_id, request_id=request_id)
    audit.record(conn, actor.id, 'gov.volunteer.confirm', 'gov_action', action_id, request_id=request_id,
                 meta={'case_id': a['case_id']})
    return {'action_id': action_id, 'confirmed': True}


def volunteer_queue(conn, actor, limit=20):
    rows = conn.execute("SELECT a.*, v.title FROM gov_action a JOIN object_head h ON h.id = a.target_id "
                        'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
                        "WHERE a.action_type = 'hide' AND a.actor_kind = 'volunteer' AND a.state = 'executed' "
                        'AND a.second_actor_id IS NULL AND a.expires_at > ? AND a.actor_id != ? AND a.subject_id != ? '
                        'ORDER BY a.expires_at LIMIT ?', (clock.now(), actor.id, actor.id, limit * 3)).fetchall()
    out = []
    for r in rows:
        if visible_if_active(conn, actor, r['target_id']):
            out.append({'action_id': r['id'], 'case_id': r['case_id'], 'object_id': r['target_id'],
                        'title': pii.mask(r['title'])[0], 'reason': r['reason'], 'expires_at': r['expires_at']})
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------- 申诉

def submit_appeal(conn, actor, action_id, statement, request_id=None):
    statement = (statement or '').strip()
    if not 1 <= len(statement) <= 2000:
        raise ApiError('validation_failed', '申诉陈述要有 1 到 2000 字')
    a = conn.execute('SELECT * FROM gov_action WHERE id = ?', (action_id,)).fetchone()
    if a is None or a['subject_id'] != actor.id or a['action_type'] == 'restore':
        raise ApiError('resource_not_found')
    if a['state'] != 'executed':
        raise ApiError('state_conflict', '这个处理已经不在生效状态')
    book = rulebook(conn)
    window = book['policy.appeal']['params']['window_days'] * 86400
    if clock.parse(a['executed_at']) + window < clock.now_ts():
        raise ApiError('state_conflict', '已经超过申诉时限')
    if conn.execute('SELECT 1 FROM gov_appeal WHERE action_id = ?', (action_id,)).fetchone():
        raise ApiError('state_conflict', '这个处理已经申诉过')
    appeal_id = _id()
    conn.execute("INSERT INTO gov_appeal (id, action_id, case_id, appellant_id, statement, state, created_at) "
                 "VALUES (?, ?, ?, ?, ?, 'submitted', ?)", (appeal_id, action_id, a['case_id'], actor.id, statement,
                                                            clock.now()))
    conn.execute("UPDATE gov_case SET status = 'appealed', updated_at = ? WHERE id = ?", (clock.now(), a['case_id']))
    _notify(conn, book, actor.id, 'appeal_received', '申诉已收到', '你的申诉已收到，会由一位 L5 成员复核。',
            case_id=a['case_id'], action_id=action_id, appeal_id=appeal_id, request_id=request_id)
    audit.record(conn, actor.id, 'gov.appeal.submit', 'gov_appeal', appeal_id, request_id=request_id,
                 meta={'action_id': action_id})
    return appeal_id


def decide_appeal(conn, settings, reviewer, appeal_id, outcome, reason, request_id=None):
    if outcome not in ('upheld', 'overturned'):
        raise ApiError('validation_failed', '复核结果只能是 upheld 或 overturned')
    reason = (reason or '').strip()
    if not reason:
        raise ApiError('validation_failed', '复核理由必填')
    ap = conn.execute('SELECT * FROM gov_appeal WHERE id = ?', (appeal_id,)).fetchone()
    if ap is None:
        raise ApiError('resource_not_found')
    if ap['state'] != 'submitted':
        raise ApiError('state_conflict', '这个申诉已经复核过')
    a = conn.execute('SELECT * FROM gov_action WHERE id = ?', (ap['action_id'],)).fetchone()
    case = _case(conn, ap['case_id'])
    involved = {a['actor_id'], a['second_actor_id'], ap['appellant_id']}
    if reviewer.id in involved or 'reporter' in conflicts(conn, reviewer.id, case):
        raise ApiError('action_not_allowed', '复核人不能是原处理人、举报人或申诉人')
    book = rulebook(conn)
    now = clock.now()
    if outcome == 'overturned':
        if a['state'] == 'executed':
            revert(conn, settings, a['id'], actor_id=reviewer.id, reason=f'申诉成立：{reason}', mode='appeal',
                   request_id=request_id)
        conn.execute("UPDATE gov_signal SET review = 'rejected', reviewed_by = ?, reviewed_at = ? "
                     "WHERE case_id = ? AND review IN ('pending', 'accepted', 'modified')", (reviewer.id, now, case['id']))
        _unreward_reports(conn, case['id'], reviewer.id, request_id)
    conn.execute('UPDATE gov_appeal SET state = ?, reviewer_id = ?, decision_reason = ?, decided_at = ? WHERE id = ?',
                 (outcome, reviewer.id, reason[:1000], now, appeal_id))
    conn.execute("UPDATE gov_case SET status = 'closed', resolved_at = coalesce(resolved_at, ?), updated_at = ? "
                 'WHERE id = ?', (now, now, case['id']))
    title = '申诉成立，处理已撤销' if outcome == 'overturned' else '申诉复核结果：维持原处理'
    _notify(conn, book, ap['appellant_id'], 'appeal_decided', title, f'复核意见：{reason}', case_id=case['id'],
            action_id=a['id'], appeal_id=appeal_id, request_id=request_id)
    audit.record(conn, reviewer.id, 'gov.appeal.decide', 'gov_appeal', appeal_id, reason=outcome,
                 request_id=request_id, meta={'action_id': a['id']})
    return {'appeal_id': appeal_id, 'state': outcome}


def appeals(conn, state='submitted', limit=50):
    rows = conn.execute('SELECT ap.*, a.action_type, a.reason AS action_reason, a.actor_id AS action_actor_id, '
                        'a.second_actor_id AS action_second_actor_id, a.rule_id, a.rule_version, p.display_name '
                        'FROM gov_appeal ap JOIN gov_action a ON a.id = ap.action_id '
                        'JOIN profile p ON p.principal_id = ap.appellant_id WHERE ap.state = ? '
                        'ORDER BY ap.created_at LIMIT ?', (state, limit)).fetchall()
    return [{'id': r['id'], 'action_id': r['action_id'], 'case_id': r['case_id'], 'state': r['state'],
             'statement': r['statement'], 'created_at': r['created_at'], 'decided_at': r['decided_at'],
             'decision_reason': r['decision_reason'],
             'appellant': {'id': r['appellant_id'], 'display_name': r['display_name']},
             'action': {'type': r['action_type'], 'reason': r['action_reason'], 'rule_id': r['rule_id'],
                        'rule_version': r['rule_version'], 'actor_id': r['action_actor_id'],
                        'second_actor_id': r['action_second_actor_id']}} for r in rows]


# ---------------------------------------------------------------- 到期清扫

def sweep(conn, settings=None):
    """到期未获第二人同意的志愿隐藏自动恢复；到期的限速解除。worker 接定时钩子前，由初筛和治理接口顺带调用。"""
    if not installed(conn):
        return 0
    due = conn.execute("SELECT id, action_type FROM gov_action WHERE state = 'executed' AND expires_at IS NOT NULL "
                       'AND expires_at <= ? ORDER BY expires_at', (clock.now(),)).fetchall()
    for row in due:
        reason = '24 小时内没有第二位骨干同意，内容已恢复。' if row['action_type'] == 'hide' else '时限已到。'
        revert(conn, settings, row['id'], actor_id=None, reason=reason, mode='expiry')
    expired_bans = conn.execute(
        "SELECT b.id, b.target_id FROM audit_event b JOIN principal p ON p.id = b.target_id "
        "WHERE b.action = 'governance.admin.sanction' AND b.target_type = 'principal' "
        "AND json_extract(b.meta_json, '$.action') = 'ban' "
        "AND json_extract(b.meta_json, '$.expires_at') <= ? AND p.status = 'suspended' "
        "AND NOT EXISTS (SELECT 1 FROM audit_event x WHERE x.action = 'governance.admin.sanction' "
        "AND x.target_type = 'principal' AND x.target_id = b.target_id AND x.occurred_at > b.occurred_at "
        "AND json_extract(x.meta_json, '$.action') IN ('ban', 'unban')) ORDER BY b.occurred_at",
        (clock.now(),)).fetchall()
    for row in expired_bans:
        accounts.unsuspend(conn, row['target_id'], None, 'governance:admin_sanction_expired')
        audit.record(conn, None, 'governance.admin.sanction.expire', 'principal', row['target_id'],
                     reason='时限已到', meta={'ban_audit_id': row['id']})
    return len(due) + len(expired_bans)


# ---------------------------------------------------------------- Agent 任务（事务外执行）

def enqueue_agent_jobs(conn, item):
    allowed = detectors.egress_allowed(conn)
    for d in detectors.applicable(item, kind='agent'):
        if d.egress and not allowed:
            continue
        available = getattr(d, 'available', None)
        if callable(available) and not available():
            continue
        conn.execute("INSERT OR IGNORE INTO gov_agent_job (id, detector_name, target_type, target_id, target_version, "
                     "state, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
                     (_id(), d.name, item.target_type, item.target_id, item.version, clock.now()))


def _finish_job(db, job_id, state, error=None):
    with db.write() as conn:
        conn.execute('UPDATE gov_agent_job SET state = ?, finished_at = ?, error = ?, attempts = attempts + 1 '
                     'WHERE id = ?', (state, clock.now(), error, job_id))


def run_agent_jobs(db, limit=20):
    """取待办任务，在写事务之外调用 Agent 检测器，再用短事务写回建议。外发检测器每次调用前重新检查开关。"""
    conn = db.conn()
    if conn.in_transaction:
        raise RuntimeError('run_agent_jobs must run outside a write transaction')
    if not installed(conn) or not flags.enabled(conn, 'governance.enabled'):
        return 0
    flags.gate(conn, 'governance.enabled')
    jobs = conn.execute("SELECT * FROM gov_agent_job WHERE state = 'pending' ORDER BY created_at LIMIT ?",
                        (limit,)).fetchall()
    done = 0
    for job in jobs:
        d = detectors.get(job['detector_name'])
        if job['target_type'] == 'object':
            head = _object_head(conn, job['target_id'])
            gone = head is None or head['lifecycle'] == 'withdrawn'
            item = None if gone else object_item(conn, head, job['target_version'], rulebook(conn))
            subject = None if gone else head['author_id']
        else:
            item, subject = _upload_item(conn, job['target_id'])
        if d is None or item is None:
            _finish_job(db, job['id'], 'skipped', 'detector_missing' if d is None else 'target_gone')
            continue
        try:
            signals, latency = detectors.call(conn, d, item)
        except detectors.EgressBlocked:
            _finish_job(db, job['id'], 'skipped', 'egress_off')
            continue
        except detectors.Unavailable:
            _finish_job(db, job['id'], 'skipped', 'unavailable')
            continue
        except Exception as exc:
            state = 'failed' if job['attempts'] + 1 >= 3 else 'pending'
            with db.write() as w:
                w.execute('UPDATE gov_agent_job SET state = ?, attempts = attempts + 1, error = ? WHERE id = ?',
                          (state, type(exc).__name__, job['id']))
            continue
        digest = (item.for_egress() if d.egress else item).input_hash()
        with db.write() as w:
            book = rulebook(w)
            over = []
            for s in signals:
                res = record_signal(w, book, target_type=job['target_type'], target_id=job['target_id'],
                                    version=job['target_version'], detector=d, signal=s, latency=latency,
                                    input_hash=digest)
                if res and res[1]:
                    over.append(res)
            if over:
                case_id, _ = open_case(w, book, source='agent', target_type=job['target_type'],
                                       target_id=job['target_id'], target_version=job['target_version'],
                                       subject_id=subject,
                                       category=book[over[0][2]]['category'])
                _attach(w, case_id, [r[0] for r in over])
                refresh_case(w, case_id, book)
            w.execute("UPDATE gov_agent_job SET state = 'done', finished_at = ?, attempts = attempts + 1 WHERE id = ?",
                      (clock.now(), job['id']))
        done += 1
    return done


# ---------------------------------------------------------------- 上传文件（给 BE-1 调用）

def screen_upload(conn, *, upload_id, kind, mime, size, path=None, width=None, height=None, owner_id=None,
                  html_findings=None, request_id=None):
    """上传落盘后调用：返回 {'case_id', 'blocked', 'signals'}。blocked=True 时上传方应拒收或不对外提供。
    html_findings：上传方已经跑过 rules.inspect_html 时直接传结果，不再读文件。"""
    if (not installed(conn) or not flags.enabled(conn, 'governance.enabled')
            or not flags.enabled(conn, 'gov.screening')):
        return {'case_id': None, 'blocked': False, 'signals': 0}
    if conn.execute("SELECT case_id FROM gov_screening WHERE target_type = 'upload' AND target_id = ?",
                    (upload_id,)).fetchone():
        return {'case_id': None, 'blocked': False, 'signals': 0, 'repeat': True}
    book = rulebook(conn)
    html = None
    if kind == 'html' and path and size <= book['html.inspect']['params']['max_bytes']:
        try:
            with open(path, 'rb') as f:
                html = f.read().decode('utf-8', errors='replace')
        except OSError:
            html = None
    hspans = pii.find(html[:book['pii.contact']['params']['html_scan_chars']]) if html else []
    item = Item('upload', upload_id, 1, kind, html=html, masked_html=pii.mask(html, hspans)[0] if html else None,
                media=(MediaRef(kind, mime or '', int(size or 0), path, width, height, 0),),
                pii=tuple(PiiSpan('html', c, s, e) for s, e, c in hspans))
    found = []
    with detectors.rule_params(book):
        for d in detectors.applicable(item, kind='rule'):
            signals, latency = detectors.call(conn, d, item)
            found += [(d, s, latency) for s in signals]
    if html is None and html_findings:
        html_rule = detectors.get('rule.html')
        found += [(html_rule, s, 0) for s in rules.html_signals(html_findings, book['html.inspect']['params'])]
    recorded = []
    for d, s, latency in found:
        res = record_signal(conn, book, target_type='upload', target_id=upload_id, version=1, detector=d,
                            signal=s, latency=latency, input_hash=item.input_hash())
        if res:
            recorded.append(res)
    over = [r for r in recorded if r[1]]
    case_id = None
    if over:
        case_id, _ = open_case(conn, book, source='rule', target_type='upload', target_id=upload_id, target_version=1,
                               subject_id=owner_id, category=book[over[0][2]]['category'], request_id=request_id)
        _attach(conn, case_id, [r[0] for r in over])
        refresh_case(conn, case_id, book)
    if kind == 'image':
        enqueue_agent_jobs(conn, item)
    blocked = any(r[2] == 'file.type' for r in over)
    conn.execute("INSERT OR IGNORE INTO gov_screening (target_type, target_id, target_version, screened_at, "
                 "signal_count, case_id) VALUES ('upload', ?, 1, ?, ?, ?)", (upload_id, clock.now(), len(recorded),
                                                                             case_id))
    return {'case_id': case_id, 'blocked': blocked, 'signals': len(recorded)}


def _media_asset(conn, asset_id):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'media_asset'").fetchone():
        return None
    row = conn.execute('SELECT * FROM media_asset WHERE id = ?', (asset_id,)).fetchone()
    if row is None:
        return None
    keys = row.keys()
    return {'owner_id': row['owner_id'], 'kind': 'html' if row['purpose'] == 'html' else 'image',
            'mime': row['mime'], 'size': row['bytes'], 'width': row['width'] if 'width' in keys else None,
            'height': row['height'] if 'height' in keys else None,
            'check': _loads(row['check_json']) if 'check_json' in keys else {},
            'deleted': 'state' in keys and row['state'] == 'deleted'}


def _upload_item(conn, asset_id):
    a = _media_asset(conn, asset_id)
    if a is None or a['deleted']:
        return None, None
    return Item('upload', asset_id, 1, a['kind'], media=(MediaRef(a['kind'], a['mime'] or '', int(a['size'] or 0),
                                                                    None, a['width'], a['height'], 0),)), a['owner_id']


def screen_media_asset(conn, asset_id, request_id=None):
    """media.asset_ready 的补检：只读 BE-1 已登记的元数据和 HTML 检查结果，不读文件。"""
    a = _media_asset(conn, asset_id)
    if a is None:
        return None
    check = a['check']
    findings = check.get('findings') if isinstance(check, dict) and check.get('status') == 'checked' else None
    return screen_upload(conn, upload_id=asset_id, kind=a['kind'], mime=a['mime'], size=a['size'], width=a['width'],
                         height=a['height'], owner_id=a['owner_id'],
                         html_findings=findings if isinstance(findings, list) else None, request_id=request_id)


# ---------------------------------------------------------------- 读：队列、详情、通知、统计

def _name(conn, principal_id):
    if not principal_id:
        return None
    row = conn.execute('SELECT p.display_name, p.level FROM profile p WHERE p.principal_id = ?',
                       (principal_id,)).fetchone()
    return {'id': principal_id, 'display_name': row['display_name'] if row else '未知成员',
            'level': row['level'] if row else None}


def _target_title(conn, case):
    if case['target_type'] != 'object':
        from . import chat
        return chat.target_title(case) or '上传文件'
    row = conn.execute('SELECT v.title, h.type, h.lifecycle FROM object_head h JOIN object_version v '
                       'ON v.object_id = h.id AND v.version = h.current_version WHERE h.id = ?',
                       (case['target_id'],)).fetchone()
    if row is None:
        return '（不存在）'
    if row['lifecycle'] == 'withdrawn':
        return '（已撤回）'
    return pii.mask(row['title'])[0]


def case_summary(conn, case):
    now = clock.now()
    counts = conn.execute('SELECT (SELECT count(*) FROM gov_signal WHERE case_id = :c) AS signals, '
                          '(SELECT count(*) FROM gov_report WHERE case_id = :c) AS reports, '
                          "(SELECT count(*) FROM gov_action WHERE case_id = :c AND state = 'awaiting_second') AS waiting",
                          {'c': case['id']}).fetchone()
    obj_type = None
    if case['target_type'] == 'object':
        row = conn.execute('SELECT type FROM object_head WHERE id = ?', (case['target_id'],)).fetchone()
        obj_type = row['type'] if row else None
    return {'id': case['id'], 'source': case['source'], 'status': case['status'], 'risk': case['risk'],
            'risk_score': case['risk_score'], 'category': case['category'], 'sla_due_at': case['sla_due_at'],
            'overdue': case['status'] in ACTIVE and case['sla_due_at'] < now, 'opened_at': case['opened_at'],
            'updated_at': case['updated_at'], 'assignee': _name(conn, case['assignee_id']),
            'target': {'type': case['target_type'], 'id': case['target_id'], 'version': case['target_version'],
                       'object_type': obj_type, 'title': _target_title(conn, case)},
            'signal_count': counts['signals'], 'report_count': counts['reports'],
            'awaiting_second': counts['waiting']}


QUEUE_STATUSES = {'active': ACTIVE, 'open': ('open',), 'triaged': ('triaged',), 'actioned': ('actioned',),
                  'dismissed': ('dismissed',), 'appealed': ('appealed',), 'closed': ('closed',),
                  'all': ('open', 'triaged', 'actioned', 'dismissed', 'appealed', 'closed')}


def queue(conn, status='active', risk=None, category=None, after=None, limit=20):
    statuses = QUEUE_STATUSES.get(status)
    if statuses is None:
        raise ApiError('validation_failed', '不认识的状态筛选')
    if risk is not None and risk not in RISKS:
        raise ApiError('validation_failed', '不认识的风险等级')
    where = [f"status IN ({','.join('?' * len(statuses))})"]
    params = list(statuses)
    if risk:
        where.append('risk = ?')
        params.append(risk)
    if category:
        where.append('category = ?')
        params.append(category)
    if after:
        where.append('(sla_due_at, id) > (?, ?)')
        params += after
    rows = conn.execute(f'SELECT * FROM gov_case WHERE {" AND ".join(where)} ORDER BY sla_due_at, id LIMIT ?',
                        params + [limit]).fetchall()
    return rows


def preview(conn, case):
    if case['target_type'] != 'object':
        from . import chat
        shown = chat.snapshot_preview(conn, case)
        if shown is not None:
            return shown
        media = conn.execute("SELECT locator_json FROM gov_signal WHERE case_id = ? LIMIT 1", (case['id'],)).fetchone()
        return {'state': 'upload', 'message': '上传文件只显示检测结果，不在治理台打开原文件。',
                'locator': json.loads(media['locator_json']) if media else None}
    head = _object_head(conn, case['target_id'])
    if head is None:
        return {'state': 'missing', 'message': '内容不存在'}
    if head['lifecycle'] == 'withdrawn':
        return {'state': 'withdrawn', 'message': '已撤回', 'withdrawn_at': head['withdrawn_at']}
    item = object_item(conn, head, book=rulebook(conn))
    version = conn.execute('SELECT content_json FROM object_version WHERE object_id = ? AND version = ?',
                           (head['id'], head['current_version'])).fetchone()
    content = json.loads(version['content_json'])
    asset_id = content.get('html_asset') if head['type'] == 'work' and isinstance(content, dict) else None
    asset_id = asset_id if isinstance(asset_id, str) and asset_id else None
    limit = 20000
    return {'state': head['lifecycle'], 'object_type': head['type'], 'version': head['current_version'],
            'visibility': head['visibility'], 'min_level': head['min_level'], 'title': item.title,
            'text': item.text[:limit], 'truncated': len(item.text) > limit,
            # HTML bytes stay on the content origin; metadata access is checked by the media endpoint.
            'asset_id': asset_id, 'has_html': bool(asset_id or item.html),
            'media': [{'kind': m.kind, 'mime': m.mime, 'size': m.size, 'width': m.width, 'height': m.height,
                       'index': m.index} for m in item.media]}


def case_preview_url(conn, settings, case_id, asset_id):
    """Resolve only this case's current HTML asset. Caller enforces and audits review access."""
    case = _case(conn, case_id)
    head = _object_head(conn, case['target_id']) if case['target_type'] == 'object' else None
    if head is None or head['type'] != 'work' or head['lifecycle'] == 'withdrawn':
        raise ApiError('resource_not_found')
    version = conn.execute('SELECT content_json FROM object_version WHERE object_id = ? AND version = ?',
                           (head['id'], head['current_version'])).fetchone()
    content = json.loads(version['content_json']) if version else None
    if not isinstance(content, dict) or not asset_id or content.get('html_asset') != asset_id:
        raise ApiError('resource_not_found')
    asset = conn.execute("SELECT file_key FROM media_asset WHERE id = ? AND purpose = 'html' AND state = 'ready'",
                         (asset_id,)).fetchone()
    if asset is None or not asset['file_key'] or not asset['file_key'].startswith('html_work/'):
        raise ApiError('resource_not_found')
    if not settings.storage_dir or not settings.content_origin:
        raise ApiError('service_unavailable')
    try:
        url = LocalStorage(settings.storage_dir, settings.content_origin).content_url(asset['file_key'])
    except ValueError:
        raise ApiError('resource_not_found') from None
    return url, head['id']


def case_detail(conn, actor, case_id):
    case = _case(conn, case_id)
    book = rulebook(conn)
    signals = []
    for s in conn.execute('SELECT * FROM gov_signal WHERE case_id = ? ORDER BY score DESC, created_at', (case_id,)):
        rule = book.get(s['rule_id'], {})
        signals.append({'id': s['id'], 'detector': {'kind': s['detector_kind'], 'name': s['detector_name'],
                                                    'version': s['detector_version'], 'model': s['model_name'],
                                                    'model_version': s['model_version']},
                        'rule': {'id': s['rule_id'], 'version': s['rule_version'], 'title': rule.get('title'),
                                 'severity': rule.get('severity')},
                        'category': s['category'], 'score': s['score'], 'confidence': s['confidence'],
                        'locator': json.loads(s['locator_json']), 'summary': s['summary'],
                        'suggested_action': s['suggested_action'], 'review': s['review'],
                        'latency_ms': s['latency_ms'], 'input_hash': s['input_hash'],
                        'output': json.loads(s['output_json']), 'created_at': s['created_at']})
    reports = [{'id': r['id'], 'reason_code': r['reason_code'], 'note': r['note'], 'weight': r['weight'],
                'reporter': _name(conn, r['reporter_id']), 'outcome': r['outcome'], 'created_at': r['created_at']}
               for r in conn.execute('SELECT * FROM gov_report WHERE case_id = ? ORDER BY created_at', (case_id,))]
    actions = [{'id': a['id'], 'type': a['action_type'], 'state': a['state'], 'automatic': bool(a['automatic']),
                'reversible': bool(a['reversible']), 'actor_kind': a['actor_kind'], 'actor': _name(conn, a['actor_id']),
                'second_actor': _name(conn, a['second_actor_id']), 'rule_id': a['rule_id'],
                'rule_version': a['rule_version'], 'reason': a['reason'], 'notice_text': a['notice_text'],
                'params': json.loads(a['params_json']), 'expires_at': a['expires_at'], 'created_at': a['created_at'],
                'executed_at': a['executed_at'], 'closed_at': a['closed_at'], 'close_reason': a['close_reason'],
                'reverts_action_id': a['reverts_action_id']}
               for a in conn.execute('SELECT * FROM gov_action WHERE case_id = ? ORDER BY created_at', (case_id,))]
    appeal_rows = [dict(r) for r in conn.execute('SELECT id, action_id, state, statement, reviewer_id, decision_reason, '
                                                 'created_at, decided_at FROM gov_appeal WHERE case_id = ? '
                                                 'ORDER BY created_at', (case_id,))]
    suggestion = None
    ranked = [s for s in signals if s['suggested_action'] and s['review'] != 'none']
    if ranked:
        weights = book['policy.risk']['params']['severity_weight']
        top = max(ranked, key=lambda s: weights.get(s['rule']['severity'] or 'low', 1) * s['score'])
        suggestion = {'action': top['suggested_action'], 'confidence': top['confidence'],
                      'detector_kind': top['detector']['kind'], 'basis': sorted({s['rule']['title'] or s['rule']['id']
                                                                                 for s in ranked}),
                      'label': 'Agent 建议，需人确认'}
    templates = {}
    rule_id = signals[0]['rule']['id'] if signals and signals[0]['review'] != 'none' else 'policy.community'
    subject = _name(conn, case['subject_id'])
    level = subject['level'] if subject and subject['level'] else None
    fill = {'hours': book['spam.flood']['params']['limit_hours'],
            'per_hour': book['spam.flood']['params']['limited_max_per_hour'],
            'points': -int(book['policy.violation']['params']['points']),
            'level_from': level or '?', 'level_to': max(1, level - 1) if level else '?'}
    for t in PUNITIVE:
        title, body, _ = compose_notice(book, t, '{reason}', rule_id, fill)
        templates[t] = {'title': title, 'body': body}
    return {**case_summary(conn, case), 'subject': subject, 'preview': preview(conn, case),
            'signals': signals, 'reports': reports, 'actions': actions, 'appeals': appeal_rows,
            'suggestion': suggestion, 'notice_templates': templates,
            'viewer': {'conflicts': conflicts(conn, actor.id, case)}}


def my_notices(conn, actor, limit=50):
    now = clock.now()
    out = []
    for n in conn.execute('SELECT * FROM gov_notice WHERE principal_id = ? ORDER BY created_at DESC LIMIT ?',
                          (actor.id, limit)):
        can_appeal = False
        appeal_state = None
        if n['action_id']:
            ap = conn.execute('SELECT state FROM gov_appeal WHERE action_id = ?', (n['action_id'],)).fetchone()
            appeal_state = ap['state'] if ap else None
            st = conn.execute('SELECT state FROM gov_action WHERE id = ?', (n['action_id'],)).fetchone()
            can_appeal = bool(n['appealable'] and ap is None and st and st['state'] == 'executed'
                              and (n['appeal_deadline'] or '') > now)
        out.append({'id': n['id'], 'kind': n['kind'], 'title': n['title'], 'body': n['body'],
                    'rule': {'id': n['rule_id'], 'version': n['rule_version'], 'title': n['rule_title']}
                    if n['rule_id'] else None,
                    'action_id': n['action_id'], 'appeal': {'can_appeal': can_appeal, 'deadline': n['appeal_deadline'],
                                                            'state': appeal_state},
                    'created_at': n['created_at']})
    return out


def stats(conn):
    now = clock.now()
    today = now[:10] + 'T00:00:00.000000Z'
    since = clock.iso(clock.now_ts() - 30 * 86400)
    one = lambda sql, *p: conn.execute(sql, p).fetchone()[0]  # noqa: E731
    active = "status IN ('open', 'triaged')"
    reviews = {}
    for kind in ('rule', 'agent'):
        counts = dict(conn.execute("SELECT review, count(*) FROM gov_signal WHERE detector_kind = ? "
                                   "AND review IN ('accepted', 'modified', 'rejected') GROUP BY review",
                                   (kind,)).fetchall())
        total = sum(counts.values())
        reviews[kind] = {'reviewed': total, 'accepted': counts.get('accepted', 0),
                         'modified': counts.get('modified', 0), 'rejected': counts.get('rejected', 0),
                         'adoption_rate': round(counts.get('accepted', 0) / total, 3) if total else None,
                         'false_positive_rate': round(counts.get('rejected', 0) / total, 3) if total else None}
    avg = conn.execute('SELECT avg((julianday(resolved_at) - julianday(opened_at)) * 1440) FROM gov_case '
                       'WHERE resolved_at IS NOT NULL AND resolved_at >= ?', (since,)).fetchone()[0]
    return {
        'pending': one(f'SELECT count(*) FROM gov_case WHERE {active}'),
        'opened_today': one('SELECT count(*) FROM gov_case WHERE opened_at >= ?', today),
        'overdue': one(f'SELECT count(*) FROM gov_case WHERE {active} AND sla_due_at < ?', now),
        'appeals_pending': one("SELECT count(*) FROM gov_appeal WHERE state = 'submitted'"),
        'awaiting_second': one("SELECT count(*) FROM gov_action WHERE state = 'awaiting_second'"),
        'by_category': {r[0]: r[1] for r in conn.execute(
            f'SELECT category, count(*) FROM gov_case WHERE {active} GROUP BY category ORDER BY 2 DESC')},
        'by_category_30d': {r[0]: r[1] for r in conn.execute(
            'SELECT category, count(*) FROM gov_case WHERE opened_at >= ? GROUP BY category ORDER BY 2 DESC', (since,))},
        'avg_handle_minutes': round(avg, 1) if avg is not None else None,
        'reviews': reviews,
        'flags': {k: flags.enabled(conn, k) for k in ('gov.reports', 'gov.screening', 'gov.premoderation',
                                                      'gov.model_egress', 'gov.volunteer_hide')},
        'detectors': detectors.describe(conn),
        'pii_rules': {'available': pii.available(), 'error': pii.LOAD_ERROR},
        'agent_jobs_pending': one("SELECT count(*) FROM gov_agent_job WHERE state = 'pending'"),
    }


def export(conn, actor):
    if not installed(conn):
        return {}
    return {
        'reports': [dict(r) for r in conn.execute('SELECT id, target_type, target_id, reason_code, note, outcome, '
                                                  'created_at, resolved_at FROM gov_report WHERE reporter_id = ? '
                                                  'ORDER BY created_at', (actor.id,))],
        'notices': my_notices(conn, actor, limit=1000),
        'actions': [dict(r) for r in conn.execute(
            'SELECT id, case_id, action_type, state, reason, notice_text, created_at FROM gov_action '
            'WHERE subject_id = ? OR actor_id = ? OR second_actor_id = ? ORDER BY created_at',
            (actor.id, actor.id, actor.id))],
        'complaint_reviews': [dict(r) for r in conn.execute(
            'SELECT id, state, decision_reason, decided_at FROM gov_complaint WHERE reviewer_id = ?', (actor.id,))],
        'appeals': [dict(r) for r in conn.execute('SELECT id, action_id, statement, state, decision_reason, created_at, '
                                                  'decided_at FROM gov_appeal WHERE appellant_id = ? ORDER BY created_at',
                                                  (actor.id,))],
    }


def purge(conn, principal_id):
    """Remove member-submitted prose and notifications; keep minimal decision history.

    Sanctions, rule versions and append-only audit records retain tombstoned IDs
    for appeals/recovery. No retention durations are changed here.
    """
    if not installed(conn):
        return
    conn.execute('DELETE FROM gov_notice WHERE principal_id = ?', (principal_id,))
    conn.execute("UPDATE gov_report SET note = '' WHERE reporter_id = ?", (principal_id,))
    conn.execute("UPDATE gov_appeal SET statement = '已注销成员' WHERE appellant_id = ?", (principal_id,))
    conn.execute('UPDATE gov_case SET assignee_id = NULL WHERE assignee_id = ?', (principal_id,))
