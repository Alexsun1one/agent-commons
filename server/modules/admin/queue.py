"""ADMIN-2 unified review queue.

A read-only view over every source that produces "someone should look at this" items. Each item
carries a ``writeback`` map naming the owning module's endpoint; ``None`` means the source has no
resolution interface yet and the console shows it as 接口未接. Content text never leaves this
module: admins have no implicit read access to private objects, so items carry ids and categories.
"""

import json
import sqlite3

from app import clock

from .metrics import table_exists

RISK_RANK = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
SOURCES = {
    'governance': '治理队列',
    'content_report': '内容举报',
    'market': '市集举报',
    'campaign': '打榜异常',
    'economy': '经济异常',
}
REGISTRY = {}


def register_source(name, label, fn):
    """fn(conn, status, limit) -> list of queue items in the shape produced below."""
    SOURCES[name] = label
    REGISTRY[name] = fn


def _person(pid, handle, name):
    return {'id': pid, 'handle': handle, 'name': name} if pid else None


def _governance(conn, status, limit, now):
    statuses = ('open', 'triaged') if status == 'active' else ('actioned', 'dismissed', 'closed', 'appealed')
    marks = ','.join('?' * len(statuses))
    rows = conn.execute(
        "SELECT c.id, c.source, c.target_type, c.target_id, c.subject_id, c.status, c.risk, c.risk_score, c.category,"
        " c.assignee_id, c.sla_due_at, c.opened_at, c.resolved_at, c.resolution, h.type AS object_type,"
        " h.lifecycle AS object_lifecycle, cr.handle, pr.display_name,"
        " (SELECT count(*) FROM gov_report r WHERE r.case_id = c.id) AS reports"
        " FROM gov_case c LEFT JOIN object_head h ON c.target_type = 'object' AND h.id = c.target_id"
        " LEFT JOIN credential cr ON cr.principal_id = c.subject_id"
        " LEFT JOIN profile pr ON pr.principal_id = c.subject_id"
        f" WHERE c.status IN ({marks}) ORDER BY c.sla_due_at, c.id LIMIT ?", (*statuses, limit)).fetchall()
    items = []
    for row in rows:
        if row['object_type'] == 'market_listing':
            source = 'market'
        elif row['source'] == 'report':
            source = 'content_report'
        else:
            source = 'governance'
        items.append({
            'id': 'gov:' + row['id'], 'ref_id': row['id'], 'source': source, 'origin': row['source'],
            'category': row['category'], 'risk': row['risk'], 'score': row['risk_score'], 'status': row['status'],
            'target': {'type': row['target_type'], 'id': row['target_id'], 'object_type': row['object_type'],
                       'lifecycle': row['object_lifecycle']},
            'subject': _person(row['subject_id'], row['handle'], row['display_name']),
            'reports': row['reports'], 'opened_at': row['opened_at'], 'due_at': row['sla_due_at'],
            'overdue': status == 'active' and row['sla_due_at'] < now, 'assigned': row['assignee_id'] is not None,
            'resolution': row['resolution'],
            'writeback': {
                'dismiss': f"/api/governance/cases/{row['id']}/dismiss",
                'act': f"/api/governance/cases/{row['id']}/actions",
            },
        })
    return items


def _market(conn, status, limit, now):
    rows = conn.execute(
        "SELECT r.id, r.object_id, r.reason_code, r.status, r.created_at, r.closed_at, h.type AS object_type,"
        " h.lifecycle AS object_lifecycle, h.author_id, c.handle, p.display_name,"
        " (SELECT count(*) FROM market_report x WHERE x.object_id = r.object_id AND x.status = 'open') AS reports"
        " FROM market_report r JOIN object_head h ON h.id = r.object_id"
        " LEFT JOIN credential c ON c.principal_id = h.author_id LEFT JOIN profile p ON p.principal_id = h.author_id"
        " WHERE r.status = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?",
        ('open' if status == 'active' else 'closed', limit)).fetchall()
    return [{
        'id': 'mkt:' + row['id'], 'ref_id': row['id'], 'source': 'market', 'origin': 'market.report',
        'category': row['reason_code'], 'risk': 'high' if row['reason_code'] in ('forbidden', 'scam') else 'medium',
        'score': None, 'status': 'open' if row['status'] == 'open' else 'closed',
        'target': {'type': 'object', 'id': row['object_id'], 'object_type': row['object_type'],
                   'lifecycle': row['object_lifecycle']},
        'subject': _person(row['author_id'], row['handle'], row['display_name']), 'reports': row['reports'],
        'opened_at': row['created_at'], 'due_at': None, 'overdue': False, 'assigned': False,
        'resolution': 'closed' if row['status'] == 'closed' else None,
        'writeback': {'dismiss': f"/api/admin/market/reports/{row['id']}/close",
                      'act': None, 'reasonless': False,
                      'actions': ['close', 'hide', 'pending_review']},
    } for row in rows]


def _economy(conn, status, limit, now):
    if status != 'active':
        return []
    since = clock.iso(clock.now_ts() - 14 * 86400)
    rows = conn.execute(
        "SELECT m.id, m.kind, m.principal_id, m.peer_id, m.day, m.amount, m.created_at, c.handle, p.display_name"
        " FROM economy_anomaly_marker m LEFT JOIN credential c ON c.principal_id = m.principal_id"
        " LEFT JOIN profile p ON p.principal_id = m.principal_id"
        " WHERE m.created_at >= ? AND NOT EXISTS (SELECT 1 FROM audit_event a "
        "WHERE a.action = 'economy.anomaly.resolve' AND a.target_type = 'economy_anomaly' AND a.target_id = m.id) "
        "ORDER BY m.created_at DESC LIMIT ?", (since, limit)).fetchall()
    return [{
        'id': 'eco:' + row['id'], 'ref_id': row['id'], 'source': 'economy', 'origin': 'economy.anomaly',
        'category': row['kind'], 'risk': 'high' if row['amount'] >= 1000 else 'medium', 'score': None,
        'status': 'open', 'target': {'type': 'principal', 'id': row['principal_id'], 'peer_id': row['peer_id'] or None,
                                     'day': row['day'], 'amount': row['amount']},
        'subject': _person(row['principal_id'], row['handle'], row['display_name']), 'reports': 0,
        'opened_at': row['created_at'], 'due_at': None, 'overdue': False, 'assigned': False, 'resolution': None,
        'writeback': {'dismiss': f"/api/admin/economy/anomalies/{row['id']}/resolve", 'act': None,
                      'reasonless': False},
    } for row in rows]


def _campaign(conn, status, limit, now):
    if status != 'active':
        return []
    since = clock.iso(clock.now_ts() - 14 * 86400)
    rows = conn.execute(
        "SELECT id, occurred_at, actor_id, target_type, target_id, meta_json FROM audit_event"
        " WHERE action = 'events.vote_anomaly' AND occurred_at >= ? "
        "AND NOT EXISTS (SELECT 1 FROM audit_event x WHERE x.action = 'events.vote_anomaly.resolve' "
        "AND x.target_type = 'audit_event' AND x.target_id = audit_event.id) "
        "ORDER BY occurred_at DESC LIMIT ?",
        (since, limit)).fetchall()
    items = []
    for row in rows:
        try:
            meta = json.loads(row['meta_json'] or '{}')
        except ValueError:
            meta = {}
        items.append({
            'id': 'vote:' + row['id'], 'ref_id': row['id'], 'source': 'campaign', 'origin': 'events.vote_anomaly',
            'category': meta.get('reason') or 'vote_anomaly', 'risk': 'medium', 'score': None, 'status': 'open',
            'target': {'type': row['target_type'], 'id': row['target_id']},
            'subject': None, 'reports': 0, 'opened_at': row['occurred_at'], 'due_at': None, 'overdue': False,
            'assigned': False, 'resolution': None,
            'writeback': {'dismiss': f"/api/admin/events/vote-anomalies/{row['id']}/resolve",
                          'act': None, 'reasonless': False},
        })
    return items


BUILTIN = {
    'market_report': ('market_report', _market),
    'economy': ('economy_anomaly_marker', _economy),
    'campaign': ('audit_event', _campaign),
}
GOVERNANCE_KEYS = ('governance', 'content_report', 'market')
NO_WRITEBACK = set()


def collect(conn, source=None, status='active', limit=100):
    now = clock.now()
    items, state = [], {}

    def wanted(keys):
        return source is None or source in keys

    gov_ok = table_exists(conn, 'gov_case')
    if gov_ok and wanted(GOVERNANCE_KEYS):
        try:
            items.extend(_governance(conn, status, limit, now))
        except sqlite3.Error:
            gov_ok = False
    for key in GOVERNANCE_KEYS:
        state[key] = 'ok' if gov_ok else 'offline'
    for key, (table, fn) in BUILTIN.items():
        if key in REGISTRY:
            continue
        source_key = 'market' if key == 'market_report' else key
        if not table_exists(conn, table):
            state.setdefault(source_key, 'offline')
            continue
        state[source_key] = 'ok'
        if wanted((source_key,)):
            try:
                items.extend(fn(conn, status, limit, now))
            except sqlite3.Error:
                state[source_key] = 'offline'
    for key, fn in REGISTRY.items():
        state[key] = 'ok'
        if wanted((key,)):
            try:
                items.extend(fn(conn, status, limit))
            except Exception:
                state[key] = 'offline'
    if source:
        items = [item for item in items if item['source'] == source]
    counts = {}
    for item in items:
        counts[item['source']] = counts.get(item['source'], 0) + 1
    sources = [{
        'key': key, 'label': label, 'status': state.get(key, 'offline'),
        'count': counts.get(key, 0) if state.get(key) == 'ok' and wanted((key,)) else None,
        'writeback': key not in NO_WRITEBACK,
    } for key, label in SOURCES.items()]
    items.sort(key=lambda item: (not item['overdue'], RISK_RANK.get(item['risk'], 9),
                                 item['due_at'] or '9999', item['opened_at'] or ''))
    return {'items': items[:limit], 'sources': sources, 'total': len(items)}
