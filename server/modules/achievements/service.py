"""Achievement counters, weekly rotation, and read models."""

import json
from datetime import date, datetime, timedelta, timezone

from app import clock, flags, outbox


RARITY_LABELS = {
    'common': '常见',
    'uncommon': '少见',
    'rare': '稀有',
    'epic': '珍贵',
    'legendary': '传说',
}


def _datetime(value=None):
    if value is None:
        return datetime.fromtimestamp(clock.now_ts(), timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), timezone.utc)
    return datetime.fromtimestamp(clock.parse(value), timezone.utc)


def week_bounds(value=None):
    current = _datetime(value)
    monday = (current - timedelta(days=current.weekday())).date()
    return monday.isoformat(), (monday + timedelta(days=7)).isoformat()


def _active_human(conn, principal_id):
    return conn.execute(
        "SELECT 1 FROM principal WHERE id = ? AND kind = 'human' AND status = 'active'",
        (principal_id,),
    ).fetchone() is not None


def ensure_week(conn, value=None):
    week_start, _ = week_bounds(value)
    if conn.execute('SELECT count(*) FROM weekly_challenge WHERE week_start = ?', (week_start,)).fetchone()[0] == 3:
        return week_start
    definitions = [dict(row) for row in conn.execute(
        'SELECT * FROM weekly_challenge_definition ORDER BY sort_order'
    ).fetchall()]
    if len(definitions) < 3:
        return week_start
    anchor = date.fromisoformat(week_start).toordinal() // 7
    chosen = []
    used_metrics = set()
    for step in range(len(definitions) * 2):
        item = definitions[(anchor + step * 5) % len(definitions)]
        if item['metric'] in used_metrics or any(row['key'] == item['key'] for row in chosen):
            continue
        chosen.append(item)
        used_metrics.add(item['metric'])
        if len(chosen) == 3:
            break
    stamp = clock.now()
    for slot, item in enumerate(chosen, 1):
        conn.execute(
            'INSERT OR IGNORE INTO weekly_challenge (week_start, slot, challenge_key, created_at) '
            'VALUES (?, ?, ?, ?)',
            (week_start, slot, item['key'], stamp),
        )
    return week_start


def rotate_week(db, now=None):
    with db.write() as conn:
        return ensure_week(conn, now)


def _emit_unlock(conn, principal_id, definition, occurred_at):
    message = f"解锁成就「{definition['name']}」"
    outbox.emit(
        conn,
        'achievements.unlocked',
        'principal',
        principal_id,
        {
            'principal_id': principal_id,
            'achievement_key': definition['key'],
            'name': definition['name'],
            'message': message,
            'icon': definition['icon'],
            'rarity': definition['rarity'],
            'link': '#/achievements',
            'unlocked_at': occurred_at,
        },
    )


def _next_progress(current, metric, principal_id, conn, occurred_at):
    if metric != 'active_streak':
        return current + 1
    day = occurred_at[:10]
    conn.execute(
        'INSERT OR IGNORE INTO achievement_activity_day (principal_id, day) VALUES (?, ?)',
        (principal_id, day),
    )
    days = [date.fromisoformat(row[0]) for row in conn.execute(
        'SELECT day FROM achievement_activity_day WHERE principal_id = ? AND day <= ? ORDER BY day DESC',
        (principal_id, day),
    ).fetchall()]
    streak = 0
    expected = date.fromisoformat(day)
    for actual in days:
        if actual != expected:
            break
        streak += 1
        expected -= timedelta(days=1)
    return max(current, streak)


def _advance_achievements(conn, principal_id, metric, occurred_at):
    unlocked = 0
    definitions = conn.execute(
        'SELECT * FROM achievement_definition WHERE metric = ? ORDER BY threshold, sort_order',
        (metric,),
    ).fetchall()
    for definition in definitions:
        row = conn.execute(
            'SELECT progress, unlocked_at FROM member_achievement '
            'WHERE principal_id = ? AND achievement_key = ?',
            (principal_id, definition['key']),
        ).fetchone()
        previous = row['progress'] if row else 0
        progress = _next_progress(previous, metric, principal_id, conn, occurred_at)
        unlocked_at = row['unlocked_at'] if row else None
        newly_unlocked = unlocked_at is None and progress >= definition['threshold']
        if newly_unlocked:
            unlocked_at = occurred_at
        conn.execute(
            'INSERT INTO member_achievement '
            '(principal_id, achievement_key, progress, unlocked_at, updated_at) VALUES (?, ?, ?, ?, ?) '
            'ON CONFLICT(principal_id, achievement_key) DO UPDATE SET '
            'progress = excluded.progress, unlocked_at = excluded.unlocked_at, updated_at = excluded.updated_at',
            (principal_id, definition['key'], progress, unlocked_at, occurred_at),
        )
        if newly_unlocked:
            unlocked += 1
            _emit_unlock(conn, principal_id, definition, occurred_at)
    return unlocked


def _advance_weekly(conn, principal_id, metric, source_key, occurred_at):
    week_start = ensure_week(conn, occurred_at)
    rows = conn.execute(
        'SELECT d.* FROM weekly_challenge w JOIN weekly_challenge_definition d ON d.key = w.challenge_key '
        'WHERE w.week_start = ? AND d.metric = ? ORDER BY w.slot',
        (week_start, metric),
    ).fetchall()
    for challenge in rows:
        inserted = conn.execute(
            'INSERT OR IGNORE INTO weekly_challenge_credit '
            '(principal_id, week_start, challenge_key, source_key, occurred_at) VALUES (?, ?, ?, ?, ?)',
            (principal_id, week_start, challenge['key'], source_key, occurred_at),
        ).rowcount
        if not inserted:
            continue
        current = conn.execute(
            'SELECT progress, completed_at FROM member_weekly_challenge '
            'WHERE principal_id = ? AND week_start = ? AND challenge_key = ?',
            (principal_id, week_start, challenge['key']),
        ).fetchone()
        progress = (current['progress'] if current else 0) + 1
        completed_at = current['completed_at'] if current else None
        if completed_at is None and progress >= challenge['threshold']:
            completed_at = occurred_at
        conn.execute(
            'INSERT INTO member_weekly_challenge '
            '(principal_id, week_start, challenge_key, progress, completed_at, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?) '
            'ON CONFLICT(principal_id, week_start, challenge_key) DO UPDATE SET '
            'progress = excluded.progress, completed_at = excluded.completed_at, updated_at = excluded.updated_at',
            (principal_id, week_start, challenge['key'], progress, completed_at, occurred_at),
        )


def record_metric(conn, principal_id, metric, source_key, occurred_at=None):
    occurred_at = occurred_at or clock.now()
    if not principal_id or not _active_human(conn, principal_id):
        return {'credited': False, 'unlocked': 0}
    flags.gate(conn, 'achievements.enabled')
    if metric == 'active_streak':
        profile = conn.execute('SELECT metering_consent FROM profile WHERE principal_id = ?',
                               (principal_id,)).fetchone()
        if not profile or not profile['metering_consent']:
            return {'credited': False, 'unlocked': 0}
    inserted = conn.execute(
        'INSERT OR IGNORE INTO achievement_credit '
        '(principal_id, metric, source_key, occurred_at) VALUES (?, ?, ?, ?)',
        (principal_id, metric, source_key, occurred_at),
    ).rowcount
    if not inserted:
        return {'credited': False, 'unlocked': 0}
    unlocked = _advance_achievements(conn, principal_id, metric, occurred_at)
    _advance_weekly(conn, principal_id, metric, source_key, occurred_at)
    return {'credited': True, 'unlocked': unlocked}


def on_object(conn, event):
    principal_id = event.get('actor_id')
    if not principal_id:
        return
    occurred_at = event['occurred_at']
    record_metric(conn, principal_id, 'active_streak', f"day:{occurred_at[:10]}", occurred_at)
    if event['event_type'] != 'object.created':
        return
    metric = {
        'knowledge': 'knowledge_shared',
        'work': 'work_shared',
        'reply': 'reply_shared',
        'discussion': 'discussion_started',
    }.get((event.get('payload') or {}).get('type'))
    if metric:
        record_metric(conn, principal_id, metric, f"object:{event['aggregate_id']}", occurred_at)


def on_ledger(conn, event):
    if event['event_type'] != 'ledger.recorded':
        return
    payload = event.get('payload') or {}
    event_type = payload.get('event_type')
    metric = {
        'adopted': 'adopted',
        'reproduced': 'reproduced',
        'useful': 'useful_received',
        'curate': 'curated',
        'host': 'hosted',
    }.get(event_type)
    if not metric or not payload.get('subject_id'):
        return
    row = conn.execute('SELECT source_ref FROM ledger_entry WHERE id = ?', (event['aggregate_id'],)).fetchone()
    source = row['source_ref'] if row and row['source_ref'] else event['aggregate_id']
    record_metric(conn, payload['subject_id'], metric, f"ledger:{event_type}:{source}", event['occurred_at'])


def on_room_ended(conn, event):
    room = conn.execute('SELECT kind FROM room WHERE id = ?', (event['aggregate_id'],)).fetchone()
    if room is None or room['kind'] != 'stage':
        return
    participants = conn.execute(
        'SELECT principal_id FROM room_participant WHERE room_id = ? ORDER BY principal_id',
        (event['aggregate_id'],),
    ).fetchall()
    for participant in participants:
        record_metric(
            conn,
            participant['principal_id'],
            'room_attended',
            f"room:{event['aggregate_id']}",
            event['occurred_at'],
        )


def _definition(row, progress, unlocked_at, site_percent):
    return {
        'key': row['key'],
        'name': row['name'],
        'description': row['description'],
        'icon': row['icon'],
        'rarity': row['rarity'],
        'rarityLabel': RARITY_LABELS[row['rarity']],
        'condition': {'metric': row['metric'], 'threshold': row['threshold'], 'events': json.loads(row['events_json'])},
        'progress': min(progress, row['threshold']),
        'unlocked': unlocked_at is not None,
        'unlockedAt': unlocked_at,
        'sitePercent': site_percent,
    }


def catalog_view(conn, principal_id):
    active = conn.execute(
        "SELECT count(*) FROM principal WHERE kind = 'human' AND status = 'active'"
    ).fetchone()[0]
    rows = conn.execute(
        'SELECT d.*, coalesce(m.progress, 0) AS progress, m.unlocked_at, '
        '(SELECT count(*) FROM member_achievement a WHERE a.achievement_key = d.key '
        'AND a.unlocked_at IS NOT NULL) AS unlocked_count '
        'FROM achievement_definition d LEFT JOIN member_achievement m '
        'ON m.achievement_key = d.key AND m.principal_id = ? ORDER BY d.sort_order',
        (principal_id,),
    ).fetchall()
    return [
        _definition(row, row['progress'], row['unlocked_at'], round(row['unlocked_count'] * 100 / active) if active else 0)
        for row in rows
    ]


def me_view(conn, principal_id):
    achievements = catalog_view(conn, principal_id)
    unlocked = [item for item in achievements if item['unlocked']]
    recent = sorted(unlocked, key=lambda item: item['unlockedAt'] or '', reverse=True)[:3]
    return {
        'summary': {'unlocked': len(unlocked), 'total': len(achievements)},
        'recent': recent,
        'achievements': achievements,
    }


def weekly_view(conn, principal_id, value=None):
    week_start = ensure_week(conn, value)
    start, end = week_bounds(value)
    rows = conn.execute(
        'SELECT w.slot, d.*, coalesce(m.progress, 0) AS progress, m.completed_at '
        'FROM weekly_challenge w JOIN weekly_challenge_definition d ON d.key = w.challenge_key '
        'LEFT JOIN member_weekly_challenge m ON m.week_start = w.week_start '
        'AND m.challenge_key = w.challenge_key AND m.principal_id = ? '
        'WHERE w.week_start = ? ORDER BY w.slot',
        (principal_id, week_start),
    ).fetchall()
    now_dt = _datetime(value)
    end_dt = datetime.combine(date.fromisoformat(end), datetime.min.time(), timezone.utc)
    remaining = max(0, int((end_dt - now_dt).total_seconds()))
    return {
        'weekStart': start,
        'endsAt': end,
        'daysRemaining': (remaining + 86399) // 86400,
        'challenges': [
            {
                'key': row['key'],
                'name': row['name'],
                'description': row['description'],
                'metric': row['metric'],
                'progress': min(row['progress'], row['threshold']),
                'target': row['threshold'],
                'completedAt': row['completed_at'],
                'complete': row['completed_at'] is not None,
            }
            for row in rows
        ],
    }
