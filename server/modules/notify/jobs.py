"""Idempotent in-app delivery of each member's previous-local-day digest."""

import json
import uuid
from datetime import datetime, timedelta, timezone

from app import audit, clock, worker

from . import templates


def _preference(conn, principal_id):
    row = conn.execute('SELECT * FROM notify_pref WHERE principal_id = ?', (principal_id,)).fetchone()
    if row is None:
        return {'categories': {}, 'quiet_start': None, 'quiet_end': None,
                'timezone_offset_min': 0, 'daily_digest': True}
    try:
        categories = json.loads(row['category_json'] or '{}')
    except (TypeError, ValueError):
        categories = {}
    return {'categories': categories, 'quiet_start': row['quiet_start'], 'quiet_end': row['quiet_end'],
            'timezone_offset_min': row['timezone_offset_min'], 'daily_digest': bool(row['daily_digest'])}


def _minutes(value):
    hour, minute = (int(part) for part in value.split(':'))
    return hour * 60 + minute


def _available_at(now_dt, preference):
    start, end = preference['quiet_start'], preference['quiet_end']
    if not start or not end or start == end:
        return clock.iso(now_dt.timestamp())
    offset = timedelta(minutes=preference['timezone_offset_min'])
    local = now_dt + offset
    current, first, last = local.hour * 60 + local.minute, _minutes(start), _minutes(end)
    if first < last and first <= current < last:
        target = local.replace(hour=last // 60, minute=last % 60, second=0, microsecond=0)
    elif first > last and current >= first:
        target = (local + timedelta(days=1)).replace(
            hour=last // 60, minute=last % 60, second=0, microsecond=0)
    elif first > last and current < last:
        target = local.replace(hour=last // 60, minute=last % 60, second=0, microsecond=0)
    else:
        return clock.iso(now_dt.timestamp())
    return clock.iso((target - offset).timestamp())


def build_digest(conn, principal_id, local_day, preference):
    offset = timedelta(minutes=preference['timezone_offset_min'])
    start_dt = datetime.combine(local_day, datetime.min.time(), timezone.utc) - offset
    end_dt = start_dt + timedelta(days=1)
    rows = conn.execute(
        'SELECT id, category, title, body, link, occurred_at, read_at FROM notification '
        'WHERE recipient_id = ? AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at DESC',
        (principal_id, clock.iso(start_dt.timestamp()), clock.iso(end_dt.timestamp())),
    ).fetchall()
    return templates.build_daily_digest([dict(row) for row in rows], local_day)


def deliver_one(conn, principal_id, now_dt):
    preference = _preference(conn, principal_id)
    if not preference['daily_digest'] or not preference['categories'].get('system', True):
        return False
    offset = timedelta(minutes=preference['timezone_offset_min'])
    local_now = now_dt + offset
    if local_now.hour < 8:
        return False
    local_day = local_now.date() - timedelta(days=1)
    digest = build_digest(conn, principal_id, local_day, preference)
    if not digest['total']:
        return False
    notification_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f'commons:notify:digest:{principal_id}:{local_day}'))
    categories = '、'.join(f"{group['label']} {group['count']} 条" for group in digest['categories'])
    now = clock.iso(now_dt.timestamp())
    result = conn.execute(
        'INSERT OR IGNORE INTO notification '
        '(id, recipient_id, category, title, body, link, target_type, target_id, visibility_object_id, merge_key, '
        'actor_ids_json, occurred_at, available_at, created_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)',
        (notification_id, principal_id, 'system', digest['title'],
         f"昨天共有 {digest['total']} 条通知，{digest['unread']} 条未读。{categories}", '#/notifications',
         'notify_digest', str(local_day), f'digest:{local_day}', '[]', now,
         _available_at(now_dt, preference), now, now),
    )
    if result.rowcount:
        audit.record(conn, None, 'notify.daily_digest', 'notification', notification_id,
                     meta={'day': str(local_day), 'total': digest['total']})
        return True
    return False


def deliver_daily_digests(db, now=None):
    now_dt = datetime.fromtimestamp(clock.parse(now or clock.now()), timezone.utc)
    with db.read() as conn:
        ids = [row[0] for row in conn.execute(
            "SELECT id FROM principal WHERE kind = 'human' AND status = 'active' ORDER BY id")]
    delivered = 0
    for principal_id in ids:
        with db.write() as conn:
            delivered += int(deliver_one(conn, principal_id, now_dt))
    return delivered


worker.register_periodic('notify.daily_digest', 3600, deliver_daily_digests)
