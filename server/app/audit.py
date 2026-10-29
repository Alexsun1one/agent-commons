import json
import uuid

from . import clock


def record(conn, actor_id, action, target_type=None, target_id=None, outcome='ok', reason=None,
           request_id=None, meta=None):
    event_id = str(uuid.uuid4())
    conn.execute(
        'INSERT INTO audit_event (id, occurred_at, actor_id, action, target_type, target_id, outcome, reason_code, '
        'request_id, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (event_id, clock.now(), actor_id, action, target_type, target_id, outcome, reason, request_id,
         json.dumps(meta or {}, ensure_ascii=False, sort_keys=True)))
    return event_id


def record_now(db, *args, **kwargs):
    with db.write() as conn:
        return record(conn, *args, **kwargs)
