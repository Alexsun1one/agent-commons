"""ADMIN-2 global search, member list and member detail.

Content lookups go through ``authz.visible_predicate`` for the acting admin: roles carry no implicit
read access to private objects, so a title is only returned when the admin could read it anyway;
an exact id match on something invisible returns metadata without the title.
"""

import sqlite3

from app import authz, clock

from .metrics import table_exists

ORDER_SOURCES = {}
SEARCH_LIMIT = 8


def register_order_source(name, fn):
    """fn(conn, q) -> list of {id, kind, title, amount, principal, created_at} for exact or prefix id hits."""
    ORDER_SOURCES[name] = fn


def _like(q):
    return '%' + q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def _users(conn, q):
    pattern = _like(q.lower())
    rows = conn.execute(
        "SELECT p.id, p.kind, p.status, p.created_at, c.handle, pr.display_name AS name, pr.level"
        " FROM principal p LEFT JOIN credential c ON c.principal_id = p.id"
        " LEFT JOIN profile pr ON pr.principal_id = p.id"
        " WHERE p.id = ? OR c.handle LIKE ? ESCAPE '\\' OR lower(pr.display_name) LIKE ? ESCAPE '\\'"
        " ORDER BY (p.id = ?) DESC, (c.handle = ?) DESC, p.created_at DESC LIMIT ?",
        (q, pattern, pattern, q, q.lower(), SEARCH_LIMIT)).fetchall()
    return [dict(row) for row in rows]


def _content(conn, actor, q):
    pred = authz.visible_predicate(actor, 'h')
    params = dict(pred.params, q=q, pattern=_like(q), limit=SEARCH_LIMIT)
    rows = conn.execute(
        "SELECT h.id, h.type, h.lifecycle, h.visibility, h.created_at, h.author_id, s.title, c.handle AS author_handle"
        " FROM object_head h LEFT JOIN search_doc s ON s.object_id = h.id"
        " LEFT JOIN credential c ON c.principal_id = h.author_id"
        f" WHERE {pred.sql} AND (h.id = :q OR s.title LIKE :pattern ESCAPE '\\')"
        " ORDER BY (h.id = :q) DESC, h.created_at DESC LIMIT :limit", params).fetchall()
    found = [dict(row, visible=True) for row in rows]
    if not any(item['id'] == q for item in found):
        row = conn.execute(
            "SELECT h.id, h.type, h.lifecycle, h.visibility, h.created_at, h.author_id, c.handle AS author_handle"
            " FROM object_head h LEFT JOIN credential c ON c.principal_id = h.author_id WHERE h.id = ?",
            (q,)).fetchone()
        if row is not None:
            found.insert(0, dict(row, title=None, visible=False))
    return found[:SEARCH_LIMIT]


def _orders(conn, q):
    found, offline = [], []
    if len(q) >= 8 and table_exists(conn, 'economy_shop_purchase'):
        rows = conn.execute(
            "SELECT o.id, o.item_key, o.price, o.currency, o.created_at, o.principal_id, c.handle"
            " FROM economy_shop_purchase o LEFT JOIN credential c ON c.principal_id = o.principal_id"
            " WHERE o.id = ? OR o.id LIKE ? ORDER BY o.created_at DESC LIMIT ?",
            (q, q + '%', SEARCH_LIMIT)).fetchall()
        found.extend({'id': r['id'], 'kind': 'shop', 'title': r['item_key'], 'amount': r['price'],
                      'currency': r['currency'], 'principal': {'id': r['principal_id'], 'handle': r['handle']},
                      'created_at': r['created_at']} for r in rows)
    elif not table_exists(conn, 'economy_shop_purchase'):
        offline.append('shop')
    if len(q) >= 8 and table_exists(conn, 'billing_order'):
        rows = conn.execute(
            "SELECT o.id, o.plan_key, o.amount_fen, o.currency, o.state, o.created_at, o.principal_id, c.handle"
            " FROM billing_order o LEFT JOIN credential c ON c.principal_id = o.principal_id"
            " WHERE o.id = ? OR o.id LIKE ? ORDER BY o.created_at DESC LIMIT ?",
            (q, q + '%', SEARCH_LIMIT)).fetchall()
        found.extend({'id': r['id'], 'kind': 'billing', 'title': r['plan_key'], 'amount': r['amount_fen'] / 100,
                      'currency': r['currency'], 'state': r['state'],
                      'principal': {'id': r['principal_id'], 'handle': r['handle']},
                      'created_at': r['created_at']} for r in rows)
    elif not table_exists(conn, 'billing_order'):
        offline.append('billing')
    for name, fn in ORDER_SOURCES.items():
        try:
            found.extend(fn(conn, q))
        except Exception:
            offline.append(name)
    return found[:SEARCH_LIMIT], offline


def _events(conn, q):
    found = []
    rows = conn.execute(
        "SELECT a.id, a.action, a.occurred_at, a.outcome, a.request_id, a.target_type, a.target_id, c.handle"
        " FROM audit_event a LEFT JOIN credential c ON c.principal_id = a.actor_id"
        " WHERE a.id = ? OR a.request_id = ? ORDER BY a.occurred_at DESC LIMIT ?",
        (q, q, SEARCH_LIMIT)).fetchall()
    found.extend(dict(row, kind='audit') for row in rows)
    if table_exists(conn, 'gov_case'):
        row = conn.execute('SELECT id, category, status, risk, opened_at FROM gov_case WHERE id = ?', (q,)).fetchone()
        if row is not None:
            found.append(dict(row, kind='gov_case'))
    return found


def search(conn, actor, q):
    orders, offline = _orders(conn, q)
    return {
        'query': q,
        'groups': {'users': _users(conn, q), 'content': _content(conn, actor, q), 'orders': orders,
                   'events': _events(conn, q)},
        'offline': offline,
    }


def _optional(conn, table, fragment, fallback='NULL'):
    return fragment if table_exists(conn, table) else fallback


def list_users(conn, q=None, status=None, role=None, level=None, after=None, limit=20):
    where = ["p.kind = 'human'"]
    args = []
    if q:
        pattern = _like(q.lower())
        where.append("(p.id = ? OR c.handle LIKE ? ESCAPE '\\' OR lower(pr.display_name) LIKE ? ESCAPE '\\')")
        args.extend([q, pattern, pattern])
    if status:
        where.append('p.status = ?')
        args.append(status)
    if level:
        where.append('pr.level = ?')
        args.append(level)
    if role:
        where.append('EXISTS (SELECT 1 FROM role_assignment ra WHERE ra.principal_id = p.id '
                     'AND ra.revoked_at IS NULL AND ra.role = ?)')
        args.append(role)
    if after:
        where.append('(p.created_at < ? OR (p.created_at = ? AND p.id < ?))')
        args.extend([after[0], after[0], after[1]])
    bamboo = _optional(conn, 'wallet_balance',
                       "(SELECT balance FROM wallet_balance w WHERE w.principal_id = p.id AND w.currency = 'bamboo')")
    sanctions = _optional(conn, 'gov_action',
                          "(SELECT count(*) FROM gov_action g WHERE g.subject_id = p.id AND g.state = 'executed' "
                          "AND g.action_type IN ('ban', 'rate_limit', 'deduct', 'demote'))", '0')
    sql = (
        "SELECT p.id, p.status, p.created_at, c.handle, pr.display_name AS name, pr.level,"
        " (SELECT group_concat(DISTINCT ra.role) FROM role_assignment ra WHERE ra.principal_id = p.id"
        "  AND ra.revoked_at IS NULL) AS roles,"
        " (SELECT max(s.last_seen_at) FROM session s WHERE s.principal_id = p.id) AS last_seen_at,"
        " (SELECT coalesce(sum(l.points), 0) FROM ledger_entry l WHERE l.subject_id = p.id) AS contribution,"
        f" {bamboo} AS bamboo,"
        " (SELECT count(*) FROM invite_edge e WHERE e.inviter_id = p.id) AS invitees,"
        f" {sanctions} AS sanctions"
        " FROM principal p LEFT JOIN credential c ON c.principal_id = p.id"
        " LEFT JOIN profile pr ON pr.principal_id = p.id"
        " WHERE " + ' AND '.join(where) + " ORDER BY p.created_at DESC, p.id DESC LIMIT ?")
    args.append(limit)
    rows = conn.execute(sql, args).fetchall()
    data = []
    for row in rows:
        item = dict(row)
        item['roles'] = [r for r in (item['roles'] or '').split(',') if r]
        data.append(item)
    return data


def resolve_principal(conn, ref):
    row = conn.execute(
        "SELECT p.id FROM principal p LEFT JOIN credential c ON c.principal_id = p.id WHERE p.id = ? OR c.handle = ?",
        (ref, ref.lower())).fetchone()
    return row['id'] if row else None


def _safe(conn, fn, fallback=None):
    try:
        return fn()
    except sqlite3.Error:
        return fallback


def user_detail(conn, pid):
    base = conn.execute(
        "SELECT p.id, p.kind, p.status, p.created_at, p.delete_requested_at, c.handle, pr.display_name AS name,"
        " pr.avatar_ref, pr.level, pr.level_source, pr.level_updated_at,"
        " (SELECT enabled_at IS NOT NULL FROM totp_secret t WHERE t.principal_id = p.id) AS totp_enabled"
        " FROM principal p LEFT JOIN credential c ON c.principal_id = p.id"
        " LEFT JOIN profile pr ON pr.principal_id = p.id WHERE p.id = ?", (pid,)).fetchone()
    detail = dict(base)
    detail['totp_enabled'] = bool(detail['totp_enabled'])
    detail['roles'] = [dict(r) for r in conn.execute(
        'SELECT role, space_id, granted_at FROM role_assignment WHERE principal_id = ? AND revoked_at IS NULL '
        'ORDER BY granted_at', (pid,))]
    sessions = conn.execute(
        'SELECT max(last_seen_at) AS last_seen_at, sum(revoked_at IS NULL AND expires_at > ?) AS active '
        'FROM session WHERE principal_id = ?', (clock.now(), pid)).fetchone()
    detail['last_seen_at'] = sessions['last_seen_at']
    detail['active_sessions'] = sessions['active'] or 0
    contribution = conn.execute(
        'SELECT coalesce(sum(points), 0) AS total, count(*) AS entries FROM ledger_entry WHERE subject_id = ?',
        (pid,)).fetchone()
    detail['contribution'] = {'value': contribution['total'], 'entries': contribution['entries'], 'status': 'ok'}
    if table_exists(conn, 'credit_entry'):
        row = _safe(conn, lambda: conn.execute(
            'SELECT coalesce(sum(amount), 0) AS available, coalesce(sum(held_delta), 0) AS held '
            'FROM credit_entry WHERE principal_id = ?', (pid,)).fetchone())
        detail['points'] = ({'value': row['available'], 'held': row['held'], 'status': 'ok'} if row
                            else {'value': None, 'status': '模块未上线'})
    else:
        detail['points'] = {'value': None, 'status': '模块未上线'}
    if table_exists(conn, 'wallet_balance'):
        row = _safe(conn, lambda: conn.execute(
            "SELECT balance FROM wallet_balance WHERE principal_id = ? AND currency = 'bamboo'", (pid,)).fetchone())
        detail['bamboo'] = {'value': row['balance'] if row else 0, 'status': 'ok'}
    else:
        detail['bamboo'] = {'value': None, 'status': '模块未上线'}
    inviter = conn.execute(
        "SELECT e.inviter_id AS id, e.created_at, c.handle, pr.display_name AS name FROM invite_edge e"
        " LEFT JOIN credential c ON c.principal_id = e.inviter_id"
        " LEFT JOIN profile pr ON pr.principal_id = e.inviter_id WHERE e.invitee_id = ?", (pid,)).fetchone()
    detail['inviter'] = dict(inviter) if inviter and inviter['id'] else None
    children = conn.execute(
        "SELECT e.invitee_id AS id, e.created_at, c.handle, pr.display_name AS name, pr.level, p.status,"
        " (SELECT count(*) FROM invite_edge g WHERE g.inviter_id = e.invitee_id) AS invitees"
        " FROM invite_edge e JOIN principal p ON p.id = e.invitee_id"
        " LEFT JOIN credential c ON c.principal_id = e.invitee_id"
        " LEFT JOIN profile pr ON pr.principal_id = e.invitee_id"
        " WHERE e.inviter_id = ? ORDER BY e.created_at DESC LIMIT 20", (pid,)).fetchall()
    total = conn.execute('SELECT count(*) FROM invite_edge WHERE inviter_id = ?', (pid,)).fetchone()[0]
    detail['invitees'] = {'total': total, 'items': [dict(r) for r in children]}
    detail['recent'] = [dict(r) for r in conn.execute(
        'SELECT id, occurred_at, action, target_type, target_id, outcome FROM audit_event WHERE actor_id = ? '
        'ORDER BY occurred_at DESC, id DESC LIMIT 20', (pid,))]
    if table_exists(conn, 'gov_action'):
        detail['sanctions'] = {'status': 'ok', 'items': [dict(r) for r in conn.execute(
            'SELECT id, case_id, action_type, state, reason, actor_kind, created_at, executed_at, expires_at, closed_at '
            'FROM gov_action WHERE subject_id = ? ORDER BY created_at DESC LIMIT 20', (pid,))]}
    else:
        detail['sanctions'] = {'status': '模块未上线', 'items': []}
    return detail
