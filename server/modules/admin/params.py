"""Adjustable operating parameters (SilicoVille-style "physics" table).

Other modules read effective values with ``value(conn, namespace, key, fallback)`` and call
``declare(namespace, *keys)`` at import time so the console can show which rows are wired.
Every change appends a row to ``admin_param_version``; nothing is ever updated in place there.
The effective value is the highest version whose ``effective_at`` has passed, so a later edit
supersedes an earlier change that is still scheduled.
"""

import sqlite3
from datetime import datetime, timedelta, timezone

from app import audit, clock
from app.errors import ApiError

from . import metrics

DECLARED = set()
IMPACT = {}
MAX_SCHEDULE_DAYS = 30


def declare(namespace, *keys):
    for key in keys:
        DECLARED.add((namespace, key))


def register_impact(namespace, fn):
    """fn(conn) -> (count, basis_text). Lets a module give a precise "how many people" estimate."""
    IMPACT[namespace] = fn


def _effective_row(conn, namespace, key, now):
    return conn.execute(
        'SELECT version, value, effective_at FROM admin_param_version WHERE namespace = ? AND key = ? '
        'AND effective_at <= ? ORDER BY version DESC LIMIT 1',
        (namespace, key, now)).fetchone()


def value(conn, namespace, key, fallback=None):
    if not metrics.table_exists(conn, 'admin_param'):
        return fallback
    row = _effective_row(conn, namespace, key, clock.now())
    return fallback if row is None else row['value']


def _param(conn, namespace, key):
    row = conn.execute('SELECT * FROM admin_param WHERE namespace = ? AND key = ?', (namespace, key)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _describe(conn, row, now, loaded):
    item = dict(row)
    effective = _effective_row(conn, row['namespace'], row['key'], now)
    pending = conn.execute(
        'SELECT version, value, effective_at FROM admin_param_version WHERE namespace = ? AND key = ? '
        'AND effective_at > ? AND version > ? ORDER BY version',
        (row['namespace'], row['key'], now, effective['version'] if effective else 0)).fetchall()
    item['effective_value'] = effective['value'] if effective else row['default_value']
    item['effective_version'] = effective['version'] if effective else None
    item['pending'] = [dict(p) for p in pending]
    item['wired'] = (row['namespace'], row['key']) in DECLARED
    item['module_loaded'] = row['namespace'] in loaded
    item['handle'] = conn.execute('SELECT handle FROM credential WHERE principal_id = ?',
                                  (row['updated_by'],)).fetchone()[0] if row['updated_by'] else None
    return item


def list_params(conn, namespace=None, loaded=()):
    now = clock.now()
    sql = 'SELECT * FROM admin_param'
    args = ()
    if namespace:
        sql += ' WHERE namespace = ?'
        args = (namespace,)
    rows = conn.execute(sql + ' ORDER BY namespace, key', args).fetchall()
    return [_describe(conn, row, now, set(loaded)) for row in rows]


def history(conn, namespace, key):
    _param(conn, namespace, key)
    rows = conn.execute(
        'SELECT v.*, c.handle AS actor_handle FROM admin_param_version v '
        'LEFT JOIN credential c ON c.principal_id = v.actor_id '
        'WHERE v.namespace = ? AND v.key = ? ORDER BY v.version DESC', (namespace, key)).fetchall()
    return [dict(row) for row in rows]


def _count(conn, sql, args=()):
    try:
        return conn.execute(sql, args).fetchone()[0]
    except sqlite3.Error:
        return None


def _builtin_impact(conn, namespace):
    week = clock.iso(clock.now_ts() - 7 * 86400)
    month = clock.iso(clock.now_ts() - 30 * 86400)
    probes = {
        'economy': ('wallet_entry', 'SELECT count(DISTINCT principal_id) FROM wallet_entry WHERE created_at >= ?',
                    (week,), '最近 7 天有竹子流水的成员'),
        'farm': ('farm_member', 'SELECT count(*) FROM farm_member', (), '开通农场的成员'),
        'parking': ('parking_space', 'SELECT count(DISTINCT owner_id) FROM parking_space', (), '拥有车位的成员'),
        'games': ('game_reward', 'SELECT count(DISTINCT principal_id) FROM game_reward WHERE created_at >= ?',
                  (week,), '最近 7 天领过游戏奖励的成员'),
        'events': ('event_vote', 'SELECT count(DISTINCT voter_id) FROM event_vote WHERE created_at >= ?',
                   (month,), '最近 30 天投过票的成员'),
    }
    probe = probes.get(namespace)
    if probe and metrics.table_exists(conn, probe[0]):
        count = _count(conn, probe[1], probe[2])
        if count is not None:
            return count, probe[3]
    count = conn.execute(
        "SELECT count(DISTINCT s.principal_id) FROM session s JOIN principal p ON p.id = s.principal_id "
        "WHERE p.kind = 'human' AND p.status = 'active' AND s.last_seen_at >= ?", (week,)).fetchone()[0]
    return count, '最近 7 天活跃成员（模块未提供精确口径）'


def preview(conn, namespace, key, proposed):
    row = _param(conn, namespace, key)
    current = value(conn, namespace, key, row['default_value'])
    if namespace in IMPACT:
        try:
            affected, basis = IMPACT[namespace](conn)
        except Exception:
            affected, basis = _builtin_impact(conn, namespace)
    else:
        affected, basis = _builtin_impact(conn, namespace)
    delta = proposed - current
    return {
        'namespace': namespace, 'key': key, 'current': current, 'proposed': proposed, 'delta': delta,
        'delta_pct': round(delta * 100.0 / current, 1) if current else None,
        'within_range': row['min_value'] <= proposed <= row['max_value'],
        'min_value': row['min_value'], 'max_value': row['max_value'], 'unit': row['unit'],
        'direction': 'loosen' if delta > 0 else 'tighten' if delta < 0 else 'same',
        'affected': {'count': affected, 'basis': basis},
        'wired': (namespace, key) in DECLARED, 'risk': row['risk'],
    }


def _parse_effective(text):
    if not text:
        return clock.now()
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        raise ApiError('validation_failed', '生效时间格式不正确')
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    now = datetime.fromtimestamp(clock.now_ts(), timezone.utc)
    if parsed < now - timedelta(minutes=1):
        raise ApiError('validation_failed', '生效时间不能早于现在')
    if parsed > now + timedelta(days=MAX_SCHEDULE_DAYS):
        raise ApiError('validation_failed', f'生效时间最多排到 {MAX_SCHEDULE_DAYS} 天后')
    return clock.iso(max(parsed, now).timestamp())


def _append(conn, row, new_value, kind, reason, effective_at, actor_id, request_id, rollback_of=None):
    version = row['version'] + 1
    now = clock.now()
    conn.execute(
        'INSERT INTO admin_param_version (namespace, key, version, value, previous_value, kind, rollback_of, '
        'effective_at, reason, actor_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (row['namespace'], row['key'], version, new_value, row['value'], kind, rollback_of, effective_at, reason,
         actor_id, request_id, now))
    conn.execute('UPDATE admin_param SET value = ?, version = ?, updated_at = ?, updated_by = ? '
                 'WHERE namespace = ? AND key = ? AND version = ?',
                 (new_value, version, now, actor_id, row['namespace'], row['key'], row['version']))
    return version


def set_value(conn, actor_id, namespace, key, new_value, reason, expected_version, effective_at=None,
              request_id=None):
    row = _param(conn, namespace, key)
    if expected_version is not None and expected_version != row['version']:
        raise ApiError('state_conflict', '参数已被别人修改，请刷新后再改')
    if not row['min_value'] <= new_value <= row['max_value']:
        raise ApiError('validation_failed', f'超出允许范围 {row["min_value"]}–{row["max_value"]}')
    if new_value == row['value']:
        raise ApiError('validation_failed', '新值与当前值相同')
    when = _parse_effective(effective_at)
    version = _append(conn, row, new_value, 'set', reason, when, actor_id, request_id)
    audit.record(conn, actor_id, 'admin_param.set', 'admin_param', f'{namespace}.{key}', request_id=request_id,
                 meta={'from': row['value'], 'to': new_value, 'version': version, 'effective_at': when,
                       'reason': reason})
    return {'namespace': namespace, 'key': key, 'value': new_value, 'version': version, 'effective_at': when}


def rollback(conn, actor_id, namespace, key, to_version, reason, expected_version, request_id=None):
    row = _param(conn, namespace, key)
    if expected_version is not None and expected_version != row['version']:
        raise ApiError('state_conflict', '参数已被别人修改，请刷新后再改')
    target = conn.execute('SELECT value FROM admin_param_version WHERE namespace = ? AND key = ? AND version = ?',
                          (namespace, key, to_version)).fetchone()
    if target is None:
        raise ApiError('resource_not_found')
    if not row['min_value'] <= target['value'] <= row['max_value']:
        raise ApiError('validation_failed', '目标版本的值已不在允许范围内')
    if target['value'] == row['value']:
        raise ApiError('validation_failed', '目标版本的值与当前值相同')
    when = clock.now()
    version = _append(conn, row, target['value'], 'rollback', reason, when, actor_id, request_id,
                      rollback_of=to_version)
    audit.record(conn, actor_id, 'admin_param.rollback', 'admin_param', f'{namespace}.{key}',
                 request_id=request_id, meta={'from': row['value'], 'to': target['value'], 'version': version,
                                              'rollback_of': to_version, 'reason': reason})
    return {'namespace': namespace, 'key': key, 'value': target['value'], 'version': version, 'effective_at': when}
