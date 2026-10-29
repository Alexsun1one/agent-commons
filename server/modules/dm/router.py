"""Member private-message HTTP API."""

from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app import idempotency, security
from app.context import Ctx, get_ctx, ok

from . import hooks, privacy, service  # noqa: F401

router = APIRouter(prefix='/api/dm')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)


class ThreadIn(Strict):
    with_: Union[str, List[str]] = Field(alias='with')
    ref: Optional[Dict[str, Any]] = None
    title: Optional[str] = None


class MessageIn(Strict):
    text: Optional[str] = None
    image_ref: Optional[str] = None
    sticker_ref: Optional[str] = None
    ref: Optional[Dict[str, Any]] = None
    reply_to: Optional[str] = None


class EditIn(Strict):
    text: str


class ReadIn(Strict):
    seq: Optional[int] = None


class PreferenceIn(Strict):
    pinned: Optional[bool] = None
    muted: Optional[bool] = None


class SettingsIn(Strict):
    contact_policy: str


class ReportIn(Strict):
    reason: str


def _ready(ctx):
    service.gate(ctx.db.conn())
    return ctx.actor


def _write(ctx):
    actor = _ready(ctx)
    security.limit(ctx.request, 'write', actor.id or ctx.ip)
    return actor


@router.get('/threads')
def threads(requests: bool = False, ctx: Ctx = Depends(get_ctx)):
    actor = _ready(ctx)
    return ok(ctx, {'items': service.list_threads(ctx.db.conn(), actor, request_only=requests)})


@router.post('/threads')
def create_thread(body: ThreadIn, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)
    peers = [body.with_] if isinstance(body.with_, str) else body.with_

    def work(conn):
        item, created = service.create_thread(conn, actor, peers, ref=body.ref, title=body.title,
                                              request_id=ctx.request_id)
        return (201 if created else 200), ok(ctx, item)

    return idempotency.run(ctx, body.model_dump(by_alias=True), work)


@router.get('/threads/{thread_id}')
def get_thread(thread_id: str, ctx: Ctx = Depends(get_ctx)):
    actor = _ready(ctx)
    return ok(ctx, service.get_thread(ctx.db.conn(), actor, thread_id))


@router.get('/threads/{thread_id}/messages')
def messages(thread_id: str, limit: Optional[int] = None, cursor: Optional[str] = None,
             ctx: Ctx = Depends(get_ctx)):
    actor = _ready(ctx)
    items, next_cursor, thread = service.list_messages(
        ctx.db.conn(), ctx.settings, actor, thread_id, limit, cursor)
    return ok(ctx, {'items': items, 'thread': thread}, cursor=next_cursor)


@router.post('/threads/{thread_id}/messages')
def post_message(thread_id: str, body: MessageIn, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        item = service.send_message(conn, actor, thread_id, text=body.text,
                                    image_ref=body.image_ref, sticker_ref=body.sticker_ref,
                                    ref=body.ref, reply_to=body.reply_to,
                                    request_id=ctx.request_id)
        return 201, ok(ctx, item)

    return idempotency.run(ctx, {'thread_id': thread_id, **body.model_dump()}, work)


@router.post('/threads/{thread_id}/read')
def read_thread(thread_id: str, body: ReadIn, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        return 200, ok(ctx, service.mark_read(conn, actor, thread_id, body.seq,
                                              request_id=ctx.request_id))

    return idempotency.run(ctx, {'thread_id': thread_id, **body.model_dump()}, work)


@router.put('/threads/{thread_id}/preference')
def thread_preference(thread_id: str, body: PreferenceIn, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        return 200, ok(ctx, service.set_preference(
            conn, actor, thread_id, pinned=body.pinned, muted=body.muted,
            request_id=ctx.request_id))

    return idempotency.run(ctx, {'thread_id': thread_id, **body.model_dump()}, work)


@router.post('/requests/{thread_id}/accept')
def accept_request(thread_id: str, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        return 200, ok(ctx, service.decide_request(conn, actor, thread_id, 'accept',
                                                   request_id=ctx.request_id))

    return idempotency.run(ctx, {'thread_id': thread_id, 'decision': 'accept'}, work)


@router.post('/requests/{thread_id}/decline')
def decline_request(thread_id: str, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        return 200, ok(ctx, service.decide_request(conn, actor, thread_id, 'decline',
                                                   request_id=ctx.request_id))

    return idempotency.run(ctx, {'thread_id': thread_id, 'decision': 'decline'}, work)


@router.post('/messages/{message_id}/recall')
def recall(message_id: str, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        return 200, ok(ctx, service.recall_message(conn, actor, message_id,
                                                   request_id=ctx.request_id))

    return idempotency.run(ctx, {'message_id': message_id, 'action': 'recall'}, work)


@router.patch('/messages/{message_id}')
def edit(message_id: str, body: EditIn, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        return 200, ok(ctx, service.edit_message(conn, actor, message_id, body.text,
                                                 request_id=ctx.request_id))

    return idempotency.run(ctx, {'message_id': message_id, **body.model_dump()}, work)


@router.post('/messages/{message_id}/delete')
def delete_for_self(message_id: str, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        return 200, ok(ctx, service.delete_for_self(conn, actor, message_id,
                                                    request_id=ctx.request_id))

    return idempotency.run(ctx, {'message_id': message_id, 'action': 'delete'}, work)


@router.post('/messages/{message_id}/report')
def report(message_id: str, body: ReportIn, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        return 201, ok(ctx, service.report_message(conn, actor, message_id, body.reason,
                                                   request_id=ctx.request_id))

    return idempotency.run(ctx, {'message_id': message_id, **body.model_dump()}, work)


@router.get('/settings')
def settings(ctx: Ctx = Depends(get_ctx)):
    actor = _ready(ctx)
    return ok(ctx, service.get_settings(ctx.db.conn(), actor))


@router.put('/settings')
def update_settings(body: SettingsIn, ctx: Ctx = Depends(get_ctx)):
    actor = _write(ctx)

    def work(conn):
        return 200, ok(ctx, service.put_settings(conn, actor, body.contact_policy,
                                                 request_id=ctx.request_id))

    return idempotency.run(ctx, body.model_dump(), work)


@router.get('/unread-count')
def unread_count(ctx: Ctx = Depends(get_ctx)):
    actor = _ready(ctx)
    return ok(ctx, {'count': service.unread_count(ctx.db.conn(), actor)})
