"""等级引擎。只升不跳级；违规降级，冷却期后可回升；L4 进复核队列；L5 只能由委员会授予。"""
import json
import math
import uuid

from app import audit, clock, outbox
from app.errors import ApiError

from . import rules
from .antiabuse import LIVE

AUTO_MAX = 3
METERED = {'active-days', 'active-half'}


def _profile(conn, pid):
    return conn.execute(
        'SELECT p.status, p.kind, p.created_at, pr.level, pr.level_source, pr.level_updated_at, pr.metering_consent '
        'FROM principal p JOIN profile pr ON pr.principal_id = p.id WHERE p.id = ?', (pid,)).fetchone()


def state_row(conn, pid):
    return conn.execute('SELECT * FROM growth_state WHERE principal_id = ?', (pid,)).fetchone()


def ensure_state(conn, pid):
    conn.execute('INSERT OR IGNORE INTO growth_state (principal_id, updated_at) VALUES (?, ?)', (pid, clock.now()))
    return state_row(conn, pid)


def live_count(conn, pid, event, since=None):
    sql = (f'SELECT count(*) FROM ledger_entry e WHERE e.subject_id = ? AND e.event_type = ? AND e.points > 0 '
           f'AND {LIVE}')
    params = [pid, event]
    if since:
        sql += ' AND e.created_at >= ?'
        params.append(since)
    return conn.execute(sql, params).fetchone()[0]


def active_days(conn, pid, window_days=None, now_ts=None):
    sql = 'SELECT count(*) FROM growth_activity WHERE principal_id = ?'
    params = [pid]
    if window_days:
        cutoff = clock.iso((now_ts or clock.now_ts()) - window_days * 86400)[:10]
        sql += ' AND day > ?'
        params.append(cutoff)
    return conn.execute(sql, params).fetchone()[0]


def report_stats(conn, pid):
    upheld = live_count(conn, pid, 'report')
    counters = {r['key']: r['value'] for r in conn.execute(
        'SELECT key, value FROM growth_counter WHERE principal_id = ?', (pid,))}
    upheld = max(upheld, counters.get('reports_upheld', 0))
    total = max(upheld, counters.get('reports_total', 0))
    return upheld, total


def last_violation_age_days(conn, pid, now_ts):
    row = conn.execute(
        f"SELECT max(e.created_at) FROM ledger_entry e WHERE e.subject_id = ? AND e.event_type = 'violation' "
        f'AND e.points < 0 AND {LIVE}', (pid,)).fetchone()
    return None if row[0] is None else (now_ts - clock.parse(row[0])) / 86400


def _crit(key, label, have, need, unit):
    return {'key': key, 'label': label, 'have': have, 'need': need, 'unit': unit}


def criteria(conn, pid, target, alt=False, cfg=None, now_ts=None):
    """返回 (criteria, review)。review=True 表示达标后进复核队列而不是自动升级。"""
    cfg = cfg or rules.load(conn)
    now_ts = now_ts or clock.now_ts()
    prof = _profile(conn, pid)
    age_days = int((now_ts - clock.parse(prof['created_at'])) // 86400)
    consent = bool(prof['metering_consent'])
    useful = live_count(conn, pid, 'useful')
    adopted = live_count(conn, pid, 'adopted')
    if target == 2:
        if alt:
            return [_crit('account-age', '账号满天数', age_days, cfg['l2.account_days'], '天'),
                    _crit('useful-in', '收到合格的「有用」', useful, cfg['l2alt.useful_received'], '次')], False
        return [_crit('account-age', '账号满天数', age_days, cfg['l2.account_days'], '天'),
                _crit('active-days', '活跃天数', active_days(conn, pid, now_ts=now_ts) if consent else None,
                      cfg['l2.active_days'], '天'),
                _crit('useful-in', '收到合格的「有用」', useful, cfg['l2.useful_received'], '次')], False
    if target == 3:
        if alt:
            return [_crit('useful-in', '收到合格的「有用」', useful, cfg['l3alt.useful_received'], '次'),
                    _crit('adopted', '内容被采纳', adopted, cfg['l3alt.adopted'], '次')], False
        window = cfg['l3.window_days']
        upheld, total = report_stats(conn, pid)
        return [_crit('active-half', f'近 {window} 天过半活跃',
                      active_days(conn, pid, window, now_ts) if consent else None,
                      math.ceil(window * cfg['l3.active_ratio']), '天'),
                _crit('adopted', '内容被采纳', adopted, cfg['l3.adopted'], '次'),
                _crit('report-n', '有效举报样本', total, cfg['l3.report_min'], '次'),
                _crit('wilson', '举报准确率 Wilson 下界', int(rules.wilson_lower(upheld, total) * 100),
                      int(round(cfg['l3.wilson_min'] * 100)), '%')], False
    if target == 4:
        at_l3 = int((now_ts - clock.parse(prof['level_updated_at'])) // 86400) if prof['level'] == 3 else 0
        age = last_violation_age_days(conn, pid, now_ts)
        free = cfg['l4.violation_free_days'] if age is None else min(int(age), cfg['l4.violation_free_days'])
        high = sum(live_count(conn, pid, e) for e in ('reproduced', 'host', 'curate'))
        return [_crit('days-at-l3', '担任骨干天数', at_l3, cfg['l4.days_at_l3'], '天'),
                _crit('adopted', '内容被采纳', adopted, cfg['l4.adopted'], '次'),
                _crit('high-value', '复现、主持或整理被确认', high, cfg['l4.high_value'], '次'),
                _crit('violation-free', '无违规天数', free, cfg['l4.violation_free_days'], '天')], True
    return [], False


def met(items):
    return bool(items) and all(c['have'] is not None and c['have'] >= c['need'] for c in items)


def eligible(conn, pid, target, cfg=None, now_ts=None):
    """metered 路径需要本人同意；不同意只走 alt 路径。"""
    prof = _profile(conn, pid)
    if target == 4:
        return met(criteria(conn, pid, 4, cfg=cfg, now_ts=now_ts)[0])
    alt = met(criteria(conn, pid, target, True, cfg, now_ts)[0])
    if alt:
        return True
    return bool(prof['metering_consent']) and met(criteria(conn, pid, target, False, cfg, now_ts)[0])


def _unlock_keys(conn, level):
    return [k for k, v in rules.effective_unlocks(conn).items() if v['min_level'] <= level]


def set_level(conn, pid, new_level, source, actor_id=None, reason_code=None, request_id=None, extra=None):
    prof = _profile(conn, pid)
    old = prof['level']
    if old == new_level:
        return False
    now = clock.now()
    conn.execute('UPDATE profile SET level = ?, level_source = ?, level_updated_at = ?, updated_at = ? '
                 'WHERE principal_id = ?', (new_level, source, now, now, pid))
    meta = {'from': old, 'to': new_level, 'source': source}
    meta.update(extra or {})
    audit.record(conn, actor_id, 'growth.level_change', 'principal', pid, reason=reason_code, request_id=request_id,
                 meta=meta)
    gained = sorted(set(_unlock_keys(conn, new_level)) - set(_unlock_keys(conn, old)))
    name = rules.LEVEL_NAMES[new_level]
    if new_level > old:
        message = f'你升到 L{new_level} {name}了，多了这些能力：' + '、'.join(rules.UNLOCK_LABELS[k] for k in gained) \
            if gained else f'你升到 L{new_level} {name}了。'
    else:
        message = f'你的等级调整为 L{new_level} {name}。'
    outbox.emit(conn, 'growth.level_changed', 'principal', pid,
                {'from': old, 'to': new_level, 'source': source, 'levelName': name, 'newUnlocks': gained,
                 'message': message}, actor_id=actor_id, request_id=request_id)
    return True


def _queue_l4(conn, pid, cfg, now_ts, request_id):
    if conn.execute("SELECT 1 FROM growth_review WHERE principal_id = ? AND target_level = 4 AND state = 'pending'",
                    (pid,)).fetchone():
        return False
    rejected = conn.execute("SELECT max(decided_at) FROM growth_review WHERE principal_id = ? AND target_level = 4 "
                            "AND state = 'rejected'", (pid,)).fetchone()[0]
    if rejected and clock.parse(rejected) > now_ts - cfg['l4.reject_cooldown_days'] * 86400:
        return False
    snapshot = criteria(conn, pid, 4, cfg=cfg, now_ts=now_ts)[0]
    review_id = str(uuid.uuid4())
    conn.execute('INSERT INTO growth_review (id, principal_id, target_level, state, snapshot_json, created_at) '
                 "VALUES (?, ?, 4, 'pending', ?, ?)", (review_id, pid, json.dumps(snapshot, ensure_ascii=False),
                                                       clock.now()))
    audit.record(conn, None, 'growth.review_queued', 'growth_review', review_id, request_id=request_id,
                 meta={'principal_id': pid, 'target_level': 4})
    outbox.emit(conn, 'growth.review_queued', 'growth_review', review_id, {'principal_id': pid, 'target_level': 4},
                request_id=request_id)
    return True


def recompute(conn, pid, request_id=None, now_ts=None):
    prof = _profile(conn, pid)
    result = {'from': None, 'to': None, 'queued_review': False}
    if prof is None or prof['status'] != 'active' or prof['kind'] != 'human':
        return result
    now_ts = now_ts or clock.now_ts()
    cfg = rules.load(conn)
    state = state_row(conn, pid)
    result['from'] = result['to'] = prof['level']
    if state and state['cooldown_until'] and clock.parse(state['cooldown_until']) > now_ts:
        return result
    level = prof['level']
    while level < AUTO_MAX and eligible(conn, pid, level + 1, cfg, now_ts):
        level += 1
        set_level(conn, pid, level, 'auto', request_id=request_id)
        result['to'] = level
    if level == AUTO_MAX and eligible(conn, pid, 4, cfg, now_ts):
        result['queued_review'] = _queue_l4(conn, pid, cfg, now_ts, request_id)
    return result


def recompute_all(db, request_id=None, now_ts=None):
    with db.read() as conn:
        ids = [r[0] for r in conn.execute(
            "SELECT p.id FROM principal p JOIN profile pr ON pr.principal_id = p.id WHERE p.status = 'active' "
            "AND p.kind = 'human' AND pr.level < 5 ORDER BY p.id")]
    changed = queued = 0
    for pid in ids:
        with db.write() as conn:
            out = recompute(conn, pid, request_id, now_ts)
        changed += out['to'] != out['from']
        queued += out['queued_review']
    return {'checked': len(ids), 'promoted': changed, 'queued_review': queued}


def demote(conn, pid, entry_id, request_id=None):
    prof = _profile(conn, pid)
    if prof is None or prof['status'] != 'active':
        return False
    cfg = rules.load(conn)
    ensure_state(conn, pid)
    until = clock.iso(clock.now_ts() + cfg['demote.cooldown_days'] * 86400)
    old = prof['level']
    lowered = 1 < old < 5
    conn.execute('UPDATE growth_state SET cooldown_until = ?, demoted_from = ?, demotion_entry_id = ?, updated_at = ? '
                 'WHERE principal_id = ?', (until, old if lowered else None, entry_id, clock.now(), pid))
    if lowered:
        set_level(conn, pid, old - 1, 'demotion', reason_code='violation', request_id=request_id,
                  extra={'entry_id': entry_id, 'cooldown_until': until})
    else:
        audit.record(conn, None, 'growth.cooldown', 'principal', pid, reason='violation', request_id=request_id,
                     meta={'entry_id': entry_id, 'cooldown_until': until, 'level': old})
    return lowered


def restore_after_appeal(conn, pid, reversed_entry_id, request_id=None):
    state = state_row(conn, pid)
    if state is None or state['demotion_entry_id'] != reversed_entry_id:
        return False
    prof = _profile(conn, pid)
    restored = False
    if state['demoted_from'] and prof['level'] == state['demoted_from'] - 1 and prof['level_source'] == 'demotion':
        restored = set_level(conn, pid, state['demoted_from'], 'appeal', reason_code='appeal_upheld',
                             request_id=request_id, extra={'entry_id': reversed_entry_id})
    conn.execute('UPDATE growth_state SET cooldown_until = NULL, demoted_from = NULL, demotion_entry_id = NULL, '
                 'updated_at = ? WHERE principal_id = ?', (clock.now(), pid))
    return restored


def appoint(conn, actor_id, pid, level, reason_code, committee_ref=None, request_id=None):
    prof = _profile(conn, pid)
    if prof is None or prof['status'] != 'active':
        raise ApiError('resource_not_found')
    if actor_id == pid:
        raise ApiError('state_conflict', '不能任命自己')
    if level == prof['level']:
        raise ApiError('state_conflict', '等级没有变化')
    if (level == 5 or prof['level'] == 5) and not committee_ref:
        raise ApiError('validation_failed', 'L5 的授予和调整必须附治理委员会决议编号')
    source = 'committee' if level == 5 else 'appointed'
    extra = {'committee_ref': committee_ref} if committee_ref else {}
    set_level(conn, pid, level, source, actor_id=actor_id, reason_code=reason_code, request_id=request_id, extra=extra)
    ensure_state(conn, pid)
    return {'principal_id': pid, 'from': prof['level'], 'to': level, 'source': source}


def decide_review(conn, review_id, decision, actor_id, reason_code, request_id=None):
    row = conn.execute('SELECT * FROM growth_review WHERE id = ?', (review_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['state'] != 'pending':
        raise ApiError('state_conflict', '这条复核已经处理过')
    if row['principal_id'] == actor_id:
        raise ApiError('state_conflict', '不能复核自己')
    state = 'approved' if decision == 'approve' else 'rejected'
    prof = _profile(conn, row['principal_id'])
    if state == 'approved' and (prof is None or prof['level'] != row['target_level'] - 1):
        raise ApiError('state_conflict', '对方当前等级已变化，请重新发起复核')
    conn.execute('UPDATE growth_review SET state = ?, decided_by = ?, decided_at = ?, reason_code = ? WHERE id = ?',
                 (state, actor_id, clock.now(), reason_code, review_id))
    audit.record(conn, actor_id, 'growth.review_decided', 'growth_review', review_id, reason=reason_code,
                 request_id=request_id, meta={'decision': state, 'principal_id': row['principal_id']})
    if state == 'approved':
        set_level(conn, row['principal_id'], row['target_level'], 'review', actor_id=actor_id,
                  reason_code=reason_code, request_id=request_id, extra={'review_id': review_id})
    return {'id': review_id, 'state': state, 'principal_id': row['principal_id']}


def touch_activity(conn, pid, day=None):
    """记一个活跃日。只记同意行为计量的人。其他模块也可以直接调。"""
    prof = _profile(conn, pid)
    if prof is None or not prof['metering_consent']:
        return False
    conn.execute('INSERT OR IGNORE INTO growth_activity (principal_id, day) VALUES (?, ?)',
                 (pid, day or clock.now()[:10]))
    return True


def note_report(conn, pid, upheld):
    """举报结果计数（GOV-1 裁决后调，或由 governance.report_resolved 事件触发）。"""
    for key, add in (('reports_total', 1), ('reports_upheld', 1 if upheld else 0)):
        conn.execute('INSERT INTO growth_counter (principal_id, key, value) VALUES (?, ?, ?) '
                     'ON CONFLICT(principal_id, key) DO UPDATE SET value = value + excluded.value', (pid, key, add))


def set_consent(conn, pid, consent, request_id=None):
    now = clock.now()
    conn.execute('UPDATE profile SET metering_consent = ?, updated_at = ? WHERE principal_id = ?',
                 (int(consent), now, pid))
    if not consent:
        conn.execute('DELETE FROM growth_activity WHERE principal_id = ?', (pid,))
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'achievement_activity_day'").fetchone():
            conn.execute('DELETE FROM achievement_activity_day WHERE principal_id = ?', (pid,))
            conn.execute("DELETE FROM achievement_credit WHERE principal_id = ? AND metric = 'active_streak'", (pid,))
            conn.execute('DELETE FROM member_achievement WHERE principal_id = ? AND achievement_key IN '
                         "(SELECT key FROM achievement_definition WHERE metric = 'active_streak')", (pid,))
            for table in ('member_weekly_challenge', 'weekly_challenge_credit'):
                conn.execute(f'DELETE FROM {table} WHERE principal_id = ? AND challenge_key IN '
                             "(SELECT key FROM weekly_challenge_definition WHERE metric = 'active_streak')", (pid,))
    audit.record(conn, pid, 'growth.consent', 'principal', pid, request_id=request_id, meta={'consent': bool(consent)})

