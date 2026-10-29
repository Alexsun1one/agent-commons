"""ADMIN-2 operations console API, mounted by the core as this module's admin_router.

Every route is admin/governor-only through action_rule; everything except the overview also needs
TOTP. Writes (parameter changes, rollbacks, operator reasons) always land in audit_event, and a
refused parameter write is audited as ``denied`` in its own transaction.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Path, Query
from pydantic import BaseModel, ConfigDict, Field

from app import flags, audit, idempotency, pagination, security
from app.authz import require
from app.context import Ctx, ok, user_ctx
from app.errors import ApiError

from . import lookup, overview, params, queue, system

admin_router = APIRouter(prefix='/api/admin/admin')

Namespace = Path(pattern=r'^[a-z][a-z0-9_]{1,31}$')
Key = Path(pattern=r'^[a-z][a-z0-9_]{1,63}$')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ParamSetIn(Strict):
    value: int = Field(ge=-1_000_000_000, le=1_000_000_000)
    reason: str = Field(min_length=2, max_length=500)
    expected_version: Optional[int] = Field(default=None, ge=1)
    effective_at: Optional[str] = Field(default=None, max_length=40)


class ParamRollbackIn(Strict):
    to_version: int = Field(ge=1)
    reason: str = Field(min_length=2, max_length=500)
    expected_version: Optional[int] = Field(default=None, ge=1)


class ReasonIn(Strict):
    action: str = Field(pattern=r'^[a-z][a-z0-9_.]{2,63}$')
    target_type: str = Field(pattern=r'^[a-z][a-z0-9_]{1,31}$')
    target_id: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=2, max_length=500)
    summary: Optional[str] = Field(default=None, max_length=200)


def console_ctx(ctx: Ctx = Depends(user_ctx)) -> Ctx:
    flags.gate(ctx.db.conn(), 'admin.enabled')
    security.limit(ctx.request, 'admin', ctx.actor.id)
    return ctx


def _require(ctx, action):
    require(ctx.db.conn(), ctx.actor, action)


def _loaded(ctx):
    return [module.name for module in ctx.request.app.state.modules]


@admin_router.get('/overview')
def get_overview(ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.overview')
    return ok(ctx, overview.collect(ctx.db.conn()))


@admin_router.get('/search')
def global_search(q: str = Query(min_length=1, max_length=64), ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.search')
    return ok(ctx, lookup.search(ctx.db.conn(), ctx.actor, q.strip()))


@admin_router.get('/users')
def users(q: Optional[str] = Query(default=None, max_length=64),
          status: Optional[Literal['active', 'pending_deletion', 'suspended', 'deleted']] = None,
          role: Optional[str] = Query(default=None, max_length=32),
          level: Optional[int] = Query(default=None, ge=1, le=5),
          limit: int = Query(default=20, ge=1, le=50), cursor: Optional[str] = Query(default=None, max_length=1024),
          ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.users.read')
    qhash = pagination.query_hash('admin-console.users', q, status, role, level)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    size = pagination.page_size(limit)
    rows = lookup.list_users(ctx.db.conn(), q.strip() if q else None, status, role, level, after, size + 1)
    rows, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, rows, size,
                                        lambda row: [row['created_at'], row['id']])
    return ok(ctx, rows, next_cursor=next_cursor)


@admin_router.get('/users/{ref}')
def user_detail(ref: str = Path(min_length=1, max_length=64), ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.users.read')
    with ctx.db.write() as conn:
        pid = lookup.resolve_principal(conn, ref)
        if pid is None:
            raise ApiError('resource_not_found')
        data = lookup.user_detail(conn, pid)
        audit.record(conn, ctx.actor.id, 'admin_console.user.view', 'principal', pid, request_id=ctx.request_id)
    return ok(ctx, data)


@admin_router.get('/queue')
def review_queue(source: Optional[str] = Query(default=None, max_length=32),
                 status: Literal['active', 'done'] = 'active',
                 limit: int = Query(default=100, ge=1, le=200), ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.queue.read')
    if source and source not in queue.SOURCES:
        raise ApiError('validation_failed', '未知的队列来源')
    return ok(ctx, queue.collect(ctx.db.conn(), source, status, limit))


@admin_router.get('/params')
def list_params(namespace: Optional[str] = Query(default=None, max_length=32), ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.params.read')
    return ok(ctx, params.list_params(ctx.db.conn(), namespace, _loaded(ctx)))


@admin_router.get('/params/{namespace}/{key}/history')
def param_history(namespace: str = Namespace, key: str = Key, ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.params.read')
    return ok(ctx, params.history(ctx.db.conn(), namespace, key))


@admin_router.get('/params/{namespace}/{key}/preview')
def param_preview(namespace: str = Namespace, key: str = Key,
                  value: int = Query(ge=-1_000_000_000, le=1_000_000_000), ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.params.read')
    return ok(ctx, params.preview(ctx.db.conn(), namespace, key, value))


def _audited_write(ctx, action, target, meta, run):
    try:
        return run()
    except ApiError as err:
        audit.record_now(ctx.db, ctx.actor.id, action, 'admin_param', target, outcome='denied', reason=err.code,
                         request_id=ctx.request_id, meta=meta)
        raise


@admin_router.post('/params/{namespace}/{key}')
def set_param(body: ParamSetIn, namespace: str = Namespace, key: str = Key, ctx: Ctx = Depends(console_ctx)):
    def work(conn):
        require(conn, ctx.actor, 'admin_console.params.write')
        data = params.set_value(conn, ctx.actor.id, namespace, key, body.value, body.reason.strip(),
                                body.expected_version, body.effective_at, ctx.request_id)
        return 200, ok(ctx, data)
    return _audited_write(ctx, 'admin_param.set', f'{namespace}.{key}', {'to': body.value},
                          lambda: idempotency.run(ctx, body.model_dump(), work))


@admin_router.post('/params/{namespace}/{key}/rollback')
def rollback_param(body: ParamRollbackIn, namespace: str = Namespace, key: str = Key,
                   ctx: Ctx = Depends(console_ctx)):
    def work(conn):
        require(conn, ctx.actor, 'admin_console.params.write')
        data = params.rollback(conn, ctx.actor.id, namespace, key, body.to_version, body.reason.strip(),
                               body.expected_version, ctx.request_id)
        return 200, ok(ctx, data)
    return _audited_write(ctx, 'admin_param.rollback', f'{namespace}.{key}', {'to_version': body.to_version},
                          lambda: idempotency.run(ctx, body.model_dump(), work))


@admin_router.post('/reasons', status_code=201)
def operator_reason(body: ReasonIn, ctx: Ctx = Depends(console_ctx)):
    def work(conn):
        require(conn, ctx.actor, 'admin_console.reason')
        event_id = audit.record(conn, ctx.actor.id, 'admin_console.reason', body.target_type, body.target_id,
                                request_id=ctx.request_id,
                                meta={'for_action': body.action, 'reason': body.reason.strip(),
                                      'summary': body.summary})
        return 201, ok(ctx, {'audit_id': event_id})
    return idempotency.run(ctx, body.model_dump(), work)


@admin_router.get('/system')
def system_view(ctx: Ctx = Depends(console_ctx)):
    _require(ctx, 'admin_console.system.read')
    return ok(ctx, system.collect(ctx.request.app, ctx.db, ctx.db.conn()))
