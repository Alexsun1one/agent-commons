import re
import uuid

from . import audit, clock, outbox
from .errors import ApiError

EVENT_TYPE = re.compile(r'[a-z][a-z0-9_.]{2,63}\Z')
FIELDS = ('event_type', 'subject_id', 'points', 'rule_version', 'source_ref', 'actor_id', 'confirmed_by', 'season')


def record(conn, *, event_type, subject_id, points, rule_version, idempotency_key, source_ref=None,
           actor_id=None, confirmed_by=None, season=None, request_id=None):
    if not EVENT_TYPE.match(event_type) or not isinstance(points, int) or not rule_version or not idempotency_key:
        raise ValueError('invalid ledger entry')
    values = dict(event_type=event_type, subject_id=subject_id, points=points, rule_version=rule_version,
                  source_ref=source_ref, actor_id=actor_id, confirmed_by=confirmed_by, season=season)
    existing = conn.execute('SELECT * FROM ledger_entry WHERE idempotency_key = ?', (idempotency_key,)).fetchone()
    if existing:
        if any(existing[k] != values[k] for k in FIELDS):
            raise ApiError('idempotency_conflict')
        return existing['id']
    entry_id = str(uuid.uuid4())
    conn.execute(
        'INSERT INTO ledger_entry (id, event_type, subject_id, points, rule_version, source_ref, actor_id, '
        'confirmed_by, season, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (entry_id, event_type, subject_id, points, rule_version, source_ref, actor_id, confirmed_by, season,
         idempotency_key, clock.now()))
    outbox.emit(conn, 'ledger.recorded', 'ledger_entry', entry_id,
                {'event_type': event_type, 'subject_id': subject_id, 'points': points, 'season': season},
                actor_id=actor_id, request_id=request_id)
    return entry_id


def reverse(conn, entry_id, *, reason, actor_id, idempotency_key, request_id=None):
    original = conn.execute('SELECT * FROM ledger_entry WHERE id = ?', (entry_id,)).fetchone()
    if original is None:
        raise ApiError('resource_not_found')
    if original['reverses_id'] is not None:
        raise ApiError('state_conflict', '冲正记录不能再冲正')
    existing = conn.execute('SELECT * FROM ledger_entry WHERE reverses_id = ?', (entry_id,)).fetchone()
    if existing:
        if existing['idempotency_key'] != idempotency_key:
            raise ApiError('state_conflict', '这笔流水已经冲正过')
        return existing['id']
    reversal_id = str(uuid.uuid4())
    conn.execute(
        'INSERT INTO ledger_entry (id, event_type, subject_id, points, rule_version, source_ref, actor_id, '
        'confirmed_by, season, idempotency_key, reverses_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (reversal_id, original['event_type'], original['subject_id'], -original['points'], original['rule_version'],
         original['source_ref'], actor_id, actor_id, original['season'], idempotency_key, entry_id, clock.now()))
    audit.record(conn, actor_id, 'ledger.reverse', 'ledger_entry', entry_id, reason=reason, request_id=request_id)
    outbox.emit(conn, 'ledger.reversed', 'ledger_entry', reversal_id,
                {'reverses_id': entry_id, 'subject_id': original['subject_id'], 'points': -original['points']},
                actor_id=actor_id, request_id=request_id)
    return reversal_id


def balance(conn, subject_id, season=None):
    sql = 'SELECT coalesce(sum(points), 0) FROM ledger_entry WHERE subject_id = ?'
    params = [subject_id]
    if season is not None:
        sql += ' AND season = ?'
        params.append(season)
    return conn.execute(sql, params).fetchone()[0]


def entries(conn, subject_id, limit=50):
    rows = conn.execute('SELECT id, event_type, points, rule_version, source_ref, confirmed_by, season, reverses_id, '
                        'created_at FROM ledger_entry WHERE subject_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
                        (subject_id, limit)).fetchall()
    return [dict(r) for r in rows]
