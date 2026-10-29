""" /api/feed/... · 热点接口。开关 feed.enabled；采集不走这条路径。"""
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app import flags, idempotency
from app.authz import require
from app.context import Ctx, get_ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from app.pagination import page_size

from . import hooks, jobs, service, workers  # noqa: F401  — 顶层注册 worker/outbox/account 钩子

router = APIRouter(prefix='/api/feed')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class SubsIn(Strict):
    directions: List[str] = Field(default_factory=list)


def _gate(ctx):
    flags.gate(ctx.db.conn(), 'feed.enabled')


@router.get('/events')
def list_events(directions: Optional[str] = None, limit: Optional[int] = None, ctx: Ctx = Depends(get_ctx)):
    _gate(ctx)
    size = page_size(limit)
    dirs = service.parse_directions(directions)
    conn = ctx.db.conn()
    service.ensure_sources(conn)
    return ok(ctx, service.page_payload(conn, ctx.actor, dirs, size))


@router.get('/events/{event_id}')
def get_event(event_id: str, ctx: Ctx = Depends(get_ctx)):
    _gate(ctx)
    return ok(ctx, service.event_detail(ctx.db.conn(), ctx.actor, event_id))


@router.get('/digest')
def get_digest(date: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    _gate(ctx)
    if date is not None and (len(date) != 10 or date[4] != '-' or date[7] != '-'):
        raise ApiError('validation_failed', 'date 用 YYYY-MM-DD')
    return ok(ctx, service.load_digest(ctx.db.conn(), date))


@router.get('/subscriptions')
def get_subs(ctx: Ctx = Depends(user_ctx)):
    _gate(ctx)
    require(ctx.db.conn(), ctx.actor, 'feed.subscribe')
    return ok(ctx, {'directions': service.list_subs(ctx.db.conn(), ctx.actor.id)})


def _write_subs(body: SubsIn, ctx: Ctx):
    def work(conn):
        require(conn, ctx.actor, 'feed.subscribe')
        directions = service.replace_subs(conn, ctx.actor, body.directions, ctx.request_id)
        return 200, ok(ctx, {'directions': directions})

    return idempotency.run(ctx, body.model_dump(), work)


@router.put('/subscriptions')
def put_subs(body: SubsIn, ctx: Ctx = Depends(write_ctx)):
    _gate(ctx)
    return _write_subs(body, ctx)


@router.patch('/subscriptions')
def patch_subs(body: SubsIn, ctx: Ctx = Depends(write_ctx)):
    """CommonsAPI 只有 patch，没有 put；语义与 PUT 相同。"""
    _gate(ctx)
    return _write_subs(body, ctx)


@router.post('/events/{event_id}/favorite')
def favorite(event_id: str, ctx: Ctx = Depends(write_ctx)):
    _gate(ctx)

    def work(conn):
        require(conn, ctx.actor, 'feed.favorite')
        return 200, ok(ctx, service.toggle_favorite(conn, ctx.actor, event_id, ctx.request_id))

    return idempotency.run(ctx, {'event_id': event_id}, work)


@router.post('/events/{event_id}/room')
def room(event_id: str, ctx: Ctx = Depends(write_ctx)):
    _gate(ctx)

    def work(conn):
        require(conn, ctx.actor, 'feed.room')
        return 200, ok(ctx, service.request_room(conn, ctx.actor, event_id, ctx.request_id))

    return idempotency.run(ctx, {'event_id': event_id}, work)
