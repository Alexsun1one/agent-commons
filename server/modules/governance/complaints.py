"""Anonymous intake: no target lookup, external fetch, model call or sanction."""
import uuid

from app import audit, clock, flags
from app.errors import ApiError


def submit(conn, locator, category, statement, request_id=None):
    flags.gate(conn, 'governance.enabled')
    flags.gate(conn, 'gov.complaints')
    locator, statement = locator.strip(), statement.strip()
    if (not 1 <= len(locator) <= 500 or not 1 <= len(statement) <= 2000
            or category not in ('copyright', 'privacy', 'illegal', 'other')):
        raise ApiError('validation_failed')
    cid = str(uuid.uuid4())
    conn.execute('INSERT INTO gov_complaint (id, locator, category, statement, created_at) VALUES (?, ?, ?, ?, ?)',
                 (cid, locator, category, statement, clock.now()))
    audit.record(conn, None, 'gov.complaint.submit', 'gov_complaint', cid, request_id=request_id,
                 meta={'category': category})
    return {'id': cid, 'state': 'pending'}


def queue(conn, state='pending', limit=50):
    return [dict(r) for r in conn.execute(
        'SELECT * FROM gov_complaint WHERE state = ? ORDER BY created_at, id LIMIT ?', (state, limit))]


def decide(conn, actor, cid, state, reason, request_id=None):
    reason = reason.strip()
    if state not in ('reviewed', 'dismissed') or not 1 <= len(reason) <= 1000:
        raise ApiError('validation_failed')
    row = conn.execute('SELECT state FROM gov_complaint WHERE id = ?', (cid,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['state'] != 'pending':
        raise ApiError('state_conflict')
    conn.execute('UPDATE gov_complaint SET state = ?, reviewer_id = ?, decision_reason = ?, decided_at = ? WHERE id = ?',
                 (state, actor.id, reason, clock.now(), cid))
    audit.record(conn, actor.id, 'gov.complaint.decide', 'gov_complaint', cid, request_id=request_id,
                 meta={'state': state})
    return {'id': cid, 'state': state}
