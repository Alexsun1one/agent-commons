import json

from fastapi import APIRouter, Depends, Query
from fastapi.routing import APIRoute
from starlette.routing import compile_path

from app import flags, clock, pagination, security
from app.authz import require
from app.context import Ctx, ok, user_ctx

from . import hooks, metrics  # noqa: F401
from .console import admin_router  # noqa: F401  (ADMIN-2 console, mounted at /api/admin/admin/*)


class AdminConsoleRoute(APIRoute):
    """Keep module discovery's /api/admin/* invariant while serving the frozen URL."""

    def __init__(self, path, *args, **kwargs):
        super().__init__(path, *args, **kwargs)
        public_path = self.path.replace('/api/admin/console', '/api/admin-console', 1)
        self.path_regex, _, _ = compile_path(public_path)


router = APIRouter(prefix='/api/admin/console', route_class=AdminConsoleRoute)


def console_ctx(ctx: Ctx = Depends(user_ctx)) -> Ctx:
    flags.gate(ctx.db.conn(), 'admin.enabled')
    security.limit(ctx.request, 'admin', ctx.actor.id)
    return ctx


def _require(ctx, action):
    require(ctx.db.conn(), ctx.actor, action)


@router.get('/metrics')
def community_metrics(ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.metrics')
    return ok(ctx, metrics.collect(ctx.db.conn()))


@router.get('/flags')
def feature_flags(ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.flags.read')
    rows = ctx.db.conn().execute(
        "SELECT key, enabled, description, updated_at, updated_by FROM feature_flag ORDER BY key"
    ).fetchall()
    data = []
    for row in rows:
        item = dict(row)
        item['enabled'] = bool(item['enabled'])
        item['module'] = item['key'].split('.', 1)[0]
        data.append(item)
    return ok(ctx, data)


@router.get('/invites')
def invite_codes(limit: int = Query(default=20, ge=1, le=50), cursor: str = Query(default=None),
                 ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.invites.read')
    qhash = pagination.query_hash('admin-console.invites')
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    params = []
    where = ''
    if after:
        where = 'WHERE (i.created_at < ? OR (i.created_at = ? AND i.id < ?))'
        params.extend([after[0], after[0], after[1]])
    params.append(pagination.page_size(limit) + 1)
    rows = ctx.db.conn().execute(
        "SELECT i.id, i.created_at, i.expires_at, i.max_uses, i.used_count, i.revoked_at, i.note, "
        "i.inviter_id, c.handle AS inviter_handle, p.display_name AS inviter_name "
        "FROM invite_code i LEFT JOIN credential c ON c.principal_id = i.inviter_id "
        "LEFT JOIN profile p ON p.principal_id = i.inviter_id " + where +
        " ORDER BY i.created_at DESC, i.id DESC LIMIT ?", params
    ).fetchall()
    rows, next_cursor = pagination.page(
        ctx.settings, ctx.actor.id, qhash, rows, pagination.page_size(limit),
        lambda row: [row['created_at'], row['id']],
    )
    data = []
    for row in rows:
        item = dict(row)
        item['revoked'] = item['revoked_at'] is not None
        item['remaining'] = 0 if item['revoked'] or item['expires_at'] <= clock.now() else max(
            0, item['max_uses'] - item['used_count']
        )
        data.append(item)
    return ok(ctx, data, next_cursor=next_cursor)


def _suspicious(conn):
    flags = []
    for row in conn.execute(
        "SELECT e.inviter_id, substr(e.created_at, 1, 13) AS hour, count(*) AS n "
        "FROM invite_edge e WHERE e.inviter_id IS NOT NULL "
        "GROUP BY e.inviter_id, hour HAVING count(*) >= 5"
    ):
        flags.append({'kind': 'registration_burst', 'inviter_id': row['inviter_id'],
                      'count': row['n'], 'period': row['hour']})

    quiet_checks = [
        "NOT EXISTS (SELECT 1 FROM object_head h WHERE h.author_id = p.id)",
        "NOT EXISTS (SELECT 1 FROM session s WHERE s.principal_id = p.id "
        "AND julianday(s.last_seen_at) > julianday(p.created_at) + (1.0 / 24.0))",
    ]
    if metrics.table_exists(conn, 'growth_activity'):
        quiet_checks.append('NOT EXISTS (SELECT 1 FROM growth_activity g WHERE g.principal_id = p.id)')
    if metrics.table_exists(conn, 'chat_message'):
        quiet_checks.append('NOT EXISTS (SELECT 1 FROM chat_message m WHERE m.author_id = p.id)')
    sql = (
        "SELECT e.inviter_id, count(*) AS n FROM invite_edge e JOIN principal p ON p.id = e.invitee_id "
        "WHERE e.inviter_id IS NOT NULL AND " + ' AND '.join(quiet_checks) +
        " GROUP BY e.inviter_id HAVING count(*) >= 5"
    )
    for row in conn.execute(sql):
        flags.append({'kind': 'many_zero_activity', 'inviter_id': row['inviter_id'],
                      'count': row['n'], 'period': None})
    return flags


@router.get('/invite-tree')
def invite_tree(ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.invites.read')
    conn = ctx.db.conn()
    rows = conn.execute(
        "WITH RECURSIVE tree(id, depth, path) AS ("
        " SELECT p.id, 0, ',' || p.id || ',' FROM principal p"
        " LEFT JOIN invite_edge e ON e.invitee_id = p.id"
        " WHERE p.kind = 'human' AND e.inviter_id IS NULL"
        " UNION ALL"
        " SELECT e.invitee_id, tree.depth + 1, tree.path || e.invitee_id || ','"
        " FROM tree JOIN invite_edge e ON e.inviter_id = tree.id"
        " WHERE tree.depth < 50 AND instr(tree.path, ',' || e.invitee_id || ',') = 0"
        "), quota AS ("
        " SELECT inviter_id, sum(used_count) AS used,"
        " sum(CASE WHEN revoked_at IS NULL AND expires_at > ? THEN max_uses - used_count ELSE 0 END) AS remaining"
        " FROM invite_code WHERE inviter_id IS NOT NULL GROUP BY inviter_id"
        "), roles AS ("
        " SELECT principal_id, group_concat(DISTINCT role) AS names FROM role_assignment"
        " WHERE revoked_at IS NULL GROUP BY principal_id"
        ") SELECT p.id, c.handle, p2.display_name AS name, p2.avatar_ref, p2.level, p.created_at,"
        " e.inviter_id, e.invite_code_id, coalesce(t.depth, -1) AS depth,"
        " coalesce(q.used, 0) AS used, coalesce(q.remaining, 0) AS remaining, coalesce(r.names, '') AS roles"
        " FROM principal p JOIN profile p2 ON p2.principal_id = p.id"
        " LEFT JOIN credential c ON c.principal_id = p.id"
        " LEFT JOIN invite_edge e ON e.invitee_id = p.id"
        " LEFT JOIN tree t ON t.id = p.id LEFT JOIN quota q ON q.inviter_id = p.id"
        " LEFT JOIN roles r ON r.principal_id = p.id WHERE p.kind = 'human'"
        " ORDER BY t.depth, p.created_at, p.id"
    , (clock.now(),)).fetchall()
    suspicious = _suspicious(conn)
    marked = {}
    for flag in suspicious:
        marked.setdefault(flag['inviter_id'], []).append(flag['kind'])
    data = []
    for row in rows:
        item = dict(row)
        item['roles'] = [name for name in item['roles'].split(',') if name]
        item['suspicious'] = marked.get(item['id'], [])
        data.append(item)
    return ok(ctx, {'nodes': data, 'suspicious': suspicious})


def _audit_item(row):
    item = dict(row)
    try:
        item['meta'] = json.loads(item.pop('meta_json') or '{}')
    except (TypeError, ValueError):
        item['meta'] = {}
    item['actor'] = {
        'id': item.pop('actor_id'),
        'handle': item.pop('actor_handle'),
        'name': item.pop('actor_name'),
    }
    return item


@router.get('/audit')
def audit_events(actor: str = Query(default=None, max_length=64),
                 action: str = Query(default=None, max_length=96),
                 target: str = Query(default=None, max_length=128),
                 from_at: str = Query(default=None, max_length=32),
                 to_at: str = Query(default=None, max_length=32),
                 limit: int = Query(default=20, ge=1, le=50),
                 cursor: str = Query(default=None), ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.audit.read')
    filters = []
    params = []
    if actor:
        filters.append('(a.actor_id = ? OR c.handle = ?)')
        params.extend([actor, actor.lower()])
    if action:
        filters.append('(a.action = ? OR a.action LIKE ?)')
        params.extend([action, action + '.%'])
    if target:
        filters.append('(a.target_type = ? OR a.target_id = ?)')
        params.extend([target, target])
    if from_at:
        filters.append('a.occurred_at >= ?')
        params.append(from_at)
    if to_at:
        filters.append('a.occurred_at <= ?')
        params.append(to_at)
    qhash = pagination.query_hash('admin-console.audit', actor, action, target, from_at, to_at)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    if after:
        filters.append('(a.occurred_at < ? OR (a.occurred_at = ? AND a.id < ?))')
        params.extend([after[0], after[0], after[1]])
    where = ' WHERE ' + ' AND '.join(filters) if filters else ''
    size = pagination.page_size(limit)
    params.append(size + 1)
    rows = ctx.db.conn().execute(
        "SELECT a.id, a.occurred_at, a.actor_id, c.handle AS actor_handle, p.display_name AS actor_name,"
        " a.action, a.target_type, a.target_id, a.outcome, a.reason_code, a.request_id, a.meta_json"
        " FROM audit_event a LEFT JOIN credential c ON c.principal_id = a.actor_id"
        " LEFT JOIN profile p ON p.principal_id = a.actor_id" + where +
        " ORDER BY a.occurred_at DESC, a.id DESC LIMIT ?", params
    ).fetchall()
    rows, next_cursor = pagination.page(
        ctx.settings, ctx.actor.id, qhash, rows, size,
        lambda row: [row['occurred_at'], row['id']],
    )
    return ok(ctx, [_audit_item(row) for row in rows], next_cursor=next_cursor)
