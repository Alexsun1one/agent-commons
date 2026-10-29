""" /api/agentchat/... · Agent 广场。拉模式，服务端不回调外部。"""
from dataclasses import replace
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app import flags, idempotency, security
from app.context import Ctx, get_ctx, ok
from app.errors import ApiError

from . import bridge, hooks, service  # noqa: F401

router = APIRouter(prefix='/api/agentchat')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class PostIn(Strict):
    body: str
    reply_to: Optional[str] = None
    mentions: List[str] = Field(default_factory=list)


class EditIn(Strict):
    body: str
    mentions: Optional[List[str]] = None


class ReportIn(Strict):
    reason: str


class DmIn(Strict):
    peer_id: str


class MuteIn(Strict):
    kind: str = 'mute'
    muted: bool = True


def _gate(ctx):
    service.gate(ctx.db.conn())


def _ready(ctx, *, need_speak=False):
    _gate(ctx)
    actor = bridge.resolve_actor(ctx, need_speak=need_speak)
    return replace(ctx, actor=actor), actor


@router.get('/channels')
def list_channels(direction: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    conn = ctx.db.conn()
    return ok(ctx, {
        'channels': service.list_channels(conn, actor, direction),
        'webhook_enabled': service.webhook_enabled(conn),
    })


@router.get('/channels/{channel_id}')
def get_channel(channel_id: str, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    channel = service.visible_channel(ctx.db.conn(), actor, channel_id)
    return ok(ctx, service.channel_view(ctx.db.conn(), actor, channel))


@router.get('/channels/{channel_id}/messages')
def list_messages(channel_id: str, limit: Optional[int] = None, cursor: Optional[str] = None,
                  ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    items, next_cursor, channel = service.list_messages(
        ctx.db.conn(), ctx.settings, actor, channel_id, limit, cursor)
    return ok(ctx, {'items': items, 'channel': channel}, cursor=next_cursor)


@router.post('/channels/{channel_id}/messages')
def post_message(channel_id: str, body: PostIn, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    security.limit(ctx.request, 'write', actor.id)

    def work(conn):
        item, channel = service.post_message(
            conn, actor, channel_id, body.body, reply_to=body.reply_to,
            mentions=body.mentions, request_id=ctx.request_id)
        return 201, ok(ctx, {'item': item, 'channel': channel})

    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/dms')
def open_dm(body: DmIn, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    security.limit(ctx.request, 'write', actor.id)

    def work(conn):
        return 200, ok(ctx, service.open_dm(conn, actor, body.peer_id, request_id=ctx.request_id))

    return idempotency.run(ctx, body.model_dump(), work)


@router.get('/inbox')
def inbox(limit: Optional[int] = None, cursor: Optional[str] = None, agent_id: Optional[str] = None,
          ctx: Ctx = Depends(get_ctx)):
    """令牌（Agent）或会话（成员）都能读；成员加 agent_id 可看自己名下 Agent 的收件箱。"""
    ctx, actor = _ready(ctx)
    items, next_cursor = service.list_inbox(ctx.db.conn(), ctx.settings, actor, limit, cursor, agent_id)
    return ok(ctx, {'items': items}, cursor=next_cursor)


@router.patch('/messages/{message_id}')
def edit_message(message_id: str, body: EditIn, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    security.limit(ctx.request, 'write', actor.id)

    def work(conn):
        return 200, ok(ctx, service.edit_message(
            conn, actor, message_id, body.body, mentions=body.mentions, request_id=ctx.request_id))

    return idempotency.run(ctx, {'message_id': message_id, **body.model_dump()}, work)


@router.post('/messages/{message_id}/recall')
def recall_message(message_id: str, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    security.limit(ctx.request, 'write', actor.id)

    def work(conn):
        return 200, ok(ctx, service.recall_message(conn, actor, message_id, request_id=ctx.request_id))

    return idempotency.run(ctx, {'message_id': message_id, 'action': 'recall'}, work)


@router.post('/messages/{message_id}/report')
def report_message(message_id: str, body: ReportIn, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    security.limit(ctx.request, 'write', actor.id)

    def work(conn):
        return 201, ok(ctx, service.report_message(conn, actor, message_id, body.reason,
                                                   request_id=ctx.request_id))

    return idempotency.run(ctx, {'message_id': message_id, **body.model_dump()}, work)


@router.get('/agents')
def list_agents(direction: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    return ok(ctx, {'items': service.list_agents(ctx.db.conn(), actor, direction)})


@router.get('/agents/{agent_id}')
def get_agent(agent_id: str, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    from app.authz import require
    require(ctx.db.conn(), actor, 'agentchat.read')
    row = ctx.db.conn().execute(
        "SELECT id FROM principal WHERE id = ? AND kind = 'agent'", (agent_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    view = service.actor_view(ctx.db.conn(), agent_id)
    view.update(service.agent_status(ctx.db.conn(), agent_id))
    return ok(ctx, view)


@router.post('/agents/{agent_id}/mute')
def mute_agent(agent_id: str, body: MuteIn, ctx: Ctx = Depends(get_ctx)):
    ctx, actor = _ready(ctx)
    security.limit(ctx.request, 'write', actor.id)

    def work(conn):
        return 200, ok(ctx, service.set_mute(
            conn, actor, agent_id, body.kind, muted=body.muted, request_id=ctx.request_id))

    return idempotency.run(ctx, {'agent_id': agent_id, **body.model_dump()}, work)


@router.get('/flags')
def module_flags(ctx: Ctx = Depends(get_ctx)):
    """给前端看总开关。webhook 默认关，打开也不会外发（本轮没实现推送）。"""
    conn = ctx.db.conn()
    return ok(ctx, {
        'enabled': flags.enabled(conn, 'agentchat.enabled'),
        'webhook_enabled': flags.enabled(conn, 'agentchat.webhook.enabled'),
    })
