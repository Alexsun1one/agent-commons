"""Shared guards and pagination helpers for module-owned admin routers."""

from app import audit, clock, flags, pagination
from app.authz import require
from app.errors import ApiError


READ_ACTION = 'admin_console.queue.read'
WRITE_ACTION = 'admin_console.reason'


def require_operator(conn, actor, *, write=False):
    """Require an admin/governor session with TOTP through the frozen action rules."""
    flags.gate(conn, 'admin.enabled')
    require(conn, actor, WRITE_ACTION if write else READ_ACTION)


def window(start=None, end=None):
    """Validate optional UTC bounds and return normalized ISO strings."""
    try:
        start_ts = clock.parse(start) if start else None
        end_ts = clock.parse(end) if end else None
    except (TypeError, ValueError):
        raise ApiError('validation_failed', 'from / to 必须是可解析的时间') from None
    if start_ts is not None and end_ts is not None and start_ts >= end_ts:
        raise ApiError('validation_failed', 'to 必须晚于 from')
    return (clock.iso(start_ts) if start_ts is not None else None,
            clock.iso(end_ts) if end_ts is not None else None)


def page_state(ctx, name, limit, cursor, *filters):
    size = pagination.page_size(limit)
    qhash = pagination.query_hash(name, *filters)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    return size, qhash, after


def finish_page(ctx, qhash, rows, size, key=None):
    key = key or (lambda row: [row['created_at'], row['id']])
    rows, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, rows, size, key)
    return rows, next_cursor


def record_view(ctx, action, target_type, target_id='list', meta=None):
    audit.record_now(ctx.db, ctx.actor.id, action, target_type, target_id,
                     request_id=ctx.request_id, meta=meta or {})

