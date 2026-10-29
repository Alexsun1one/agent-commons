from . import audit, clock
from .errors import ApiError


def enabled(conn, key):
    row = conn.execute('SELECT enabled FROM feature_flag WHERE key = ?', (key,)).fetchone()
    return bool(row and row[0])


def all_flags(conn):
    return {r['key']: bool(r['enabled']) for r in conn.execute('SELECT key, enabled FROM feature_flag ORDER BY key')}


def set_flag(conn, key, value, actor_id, request_id=None):
    cur = conn.execute('UPDATE feature_flag SET enabled = ?, updated_at = ?, updated_by = ? WHERE key = ?',
                       (int(bool(value)), clock.now(), actor_id, key))
    if cur.rowcount == 0:
        raise ApiError('resource_not_found')
    audit.record(conn, actor_id, 'flag.set', 'feature_flag', key, request_id=request_id, meta={'enabled': bool(value)})


def gate(conn, key):
    """Enforce a capability switch at its request/worker boundary.

    Missing keys fail closed, exactly like disabled keys. Call before reading
    capability data or making side effects; the caller owns the transaction.
    Account export/purge and the core switch-management API remain available
    when a module is off, so operators can restore it and users keep their rights.
    """
    if not enabled(conn, key):
        raise ApiError('capability_unavailable')
