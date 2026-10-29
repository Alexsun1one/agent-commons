"""每功能每天的调用次数和费用上限（表 ai_budget），当天用量（表 ai_usage_daily）。

外部调用前先「占额」：次数 +1、按预估费用占一笔；调用后按实际费用结算、释放占额。超了就降级，
并且每个功能每天只通知一次管理员（outbox：ai.budget_exceeded + notify.system.ai_budget）。
「一天」按北京时间切（UTC+8）。费用单位是百万分之一美元（micros）。
"""
import time

from app import audit, clock, outbox
from app.errors import ApiError

from . import catalog

DAY_OFFSET_S = 8 * 3600
USAGE_FIELDS = ('calls', 'failures', 'fallbacks', 'cache_hits', 'input_tokens', 'output_tokens', 'cost_micros',
                'reserved_micros')


def today(ts=None):
    return time.strftime('%Y-%m-%d', time.gmtime((clock.now_ts() if ts is None else ts) + DAY_OFFSET_S))


def limits(conn, feature):
    row = conn.execute('SELECT daily_calls, daily_cost_micros, cache_ttl_s FROM ai_budget WHERE feature = ?',
                       (feature,)).fetchone()
    if row is not None:
        return {'daily_calls': row[0], 'daily_cost_micros': row[1], 'cache_ttl_s': row[2]}
    spec = catalog.get(feature)
    return {'daily_calls': spec.daily_calls, 'daily_cost_micros': int(spec.daily_cost_usd * 1_000_000),
            'cache_ttl_s': spec.cache_ttl_s}


def _usage(conn, feature, day):
    conn.execute('INSERT OR IGNORE INTO ai_usage_daily (feature, day) VALUES (?, ?)', (feature, day))
    return conn.execute('SELECT * FROM ai_usage_daily WHERE feature = ? AND day = ?', (feature, day)).fetchone()


def reserve(conn, feature, estimate_micros):
    """在写事务里调用。返回 (拒绝原因或 None, day)。"""
    day = today()
    lim = limits(conn, feature)
    row = _usage(conn, feature, day)
    reason = None
    if row['calls'] >= lim['daily_calls']:
        reason = 'budget_calls'
    elif row['cost_micros'] + row['reserved_micros'] + estimate_micros > lim['daily_cost_micros']:
        reason = 'budget_cost'
    if reason:
        _notify_once(conn, feature, day, reason, lim, row)
        return reason, day
    conn.execute('UPDATE ai_usage_daily SET calls = calls + 1, reserved_micros = reserved_micros + ? '
                 'WHERE feature = ? AND day = ?', (estimate_micros, feature, day))
    return None, day


def settle(conn, feature, day, estimate_micros, cost_micros, input_tokens, output_tokens, failed):
    _usage(conn, feature, day)
    conn.execute('UPDATE ai_usage_daily SET reserved_micros = max(0, reserved_micros - ?), '
                 'cost_micros = cost_micros + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, '
                 'failures = failures + ? WHERE feature = ? AND day = ?',
                 (estimate_micros, cost_micros, input_tokens, output_tokens, int(bool(failed)), feature, day))


def bump(conn, feature, column):
    if column not in ('fallbacks', 'cache_hits'):
        raise ValueError(column)
    day = today()
    _usage(conn, feature, day)
    conn.execute(f'UPDATE ai_usage_daily SET {column} = {column} + 1 WHERE feature = ? AND day = ?', (feature, day))


def usage(conn, day=None):
    day = day or today()
    rows = conn.execute('SELECT * FROM ai_usage_daily WHERE day = ?', (day,)).fetchall()
    found = {r['feature']: {k: r[k] for k in USAGE_FIELDS} for r in rows}
    return {name: found.get(name, dict.fromkeys(USAGE_FIELDS, 0)) for name in catalog.FEATURES}


def set_budget(conn, feature, actor_id, request_id=None, daily_calls=None, daily_cost_usd=None, cache_ttl_s=None):
    if feature not in catalog.FEATURES:
        raise ApiError('resource_not_found')
    old = limits(conn, feature)
    new = dict(old)
    if daily_calls is not None:
        new['daily_calls'] = int(daily_calls)
    if daily_cost_usd is not None:
        new['daily_cost_micros'] = int(round(float(daily_cost_usd) * 1_000_000))
    if cache_ttl_s is not None:
        new['cache_ttl_s'] = int(cache_ttl_s)
    conn.execute('INSERT INTO ai_budget (feature, daily_calls, daily_cost_micros, cache_ttl_s, updated_at, updated_by) '
                 'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(feature) DO UPDATE SET daily_calls = excluded.daily_calls, '
                 'daily_cost_micros = excluded.daily_cost_micros, cache_ttl_s = excluded.cache_ttl_s, '
                 'updated_at = excluded.updated_at, updated_by = excluded.updated_by',
                 (feature, new['daily_calls'], new['daily_cost_micros'], new['cache_ttl_s'], clock.now(), actor_id))
    # 预算放宽后，当天可以再通知一次。
    conn.execute('UPDATE ai_usage_daily SET notified_at = NULL WHERE feature = ? AND day = ?', (feature, today()))
    audit.record(conn, actor_id, 'ai.budget.set', 'ai_feature', feature, request_id=request_id,
                 meta={'before': old, 'after': new})
    return new


def _notify_once(conn, feature, day, reason, lim, row):
    if row['notified_at']:
        return
    conn.execute('UPDATE ai_usage_daily SET notified_at = ? WHERE feature = ? AND day = ?', (clock.now(), feature, day))
    payload = {'feature': feature, 'day': day, 'reason': reason, 'calls': row['calls'],
               'daily_calls': lim['daily_calls'], 'cost_micros': row['cost_micros'],
               'daily_cost_micros': lim['daily_cost_micros']}
    outbox.emit(conn, 'ai.budget_exceeded', 'ai_feature', feature, payload)
    admins = [r[0] for r in conn.execute(
        "SELECT DISTINCT ra.principal_id FROM role_assignment ra JOIN principal p ON p.id = ra.principal_id "
        "WHERE ra.role = 'admin' AND ra.space_id IS NULL AND ra.revoked_at IS NULL AND p.status = 'active' "
        'ORDER BY ra.principal_id')]
    if admins:
        what = '调用次数' if reason == 'budget_calls' else '费用'
        message = f'模型功能 {feature} 今天的{what}已到上限，已自动改用本机规则。可在管理台调整预算。'
        outbox.emit(conn, 'notify.system.ai_budget', 'ai_feature', feature,
                    {'recipient_id': admins, 'message': message, 'feature': feature, 'reason': reason})
