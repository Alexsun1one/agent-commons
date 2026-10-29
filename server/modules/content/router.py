from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, clock, flags, idempotency, objects, outbox, pagination
from app.context import Ctx, ok, user_ctx, write_ctx
from app.core import search as core_search
from app.errors import ApiError

from . import sanitize, service, types

def gate(ctx: Ctx = Depends(user_ctx)):
    flags.gate(ctx.db.conn(), 'core.objects')


router = APIRouter(prefix='/api/content', dependencies=[Depends(gate)])
types.register()
accounts.register_purger(service.purge_principal)
outbox.subscribe('content.index', 'object.*', service.on_object_event)
outbox.subscribe('content.purge', 'principal.deleted', service.on_principal_deleted)
accounts.register_exporter('content', lambda conn, actor: service.export_rows(conn, actor)
                           if service.installed(conn) else {})


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ReplyIn(Strict):
    body: str = Field(max_length=service.QUOTE_CHARS * 100)
    reply_to: Optional[str] = Field(default=None, max_length=64)


class ReplyPatch(Strict):
    body: str = Field(max_length=service.QUOTE_CHARS * 100)


class HotDiscussIn(Strict):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default='', max_length=2000)


EventId = Annotated[str, Path(pattern=r'^[A-Za-z0-9_.:-]{1,80}$')]
DayStr = Annotated[str, Path(pattern=r'^\d{4}-\d{2}-\d{2}$')]


def _day(day):
    try:
        parsed = date.fromisoformat(day)
    except ValueError:
        raise ApiError('validation_failed', '日期无效') from None
    if parsed > datetime.fromtimestamp(clock.now_ts(), timezone.utc).date() + timedelta(days=1):
        raise ApiError('validation_failed', '日期无效')
    return day


def _types(type):
    return [t for t in (type or '').split(',') if t] or None


@router.get('/schema')
def schema(ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, {**sanitize.SCHEMA, 'types': {k: sorted(v) for k, v in types.FIELDS.items()},
                    'reply': {'fields': ['body'], 'max_chars': types.REPLY_MAX},
                    'reactions': list(service.REACTIONS)})


@router.get('/feed')
def feed(sort: Literal['new', 'hot', 'following'] = 'new', type: Optional[str] = None,
         space_id: Optional[str] = Query(default=None, max_length=64), limit: Optional[int] = None,
         cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size = pagination.page_size(limit)
    kinds = _types(type)
    qhash = pagination.query_hash('content.feed', sort, kinds, space_id)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    conn = ctx.db.conn()
    build = {'new': service.feed_new, 'hot': service.feed_hot, 'following': service.feed_following}[sort]
    meta = {}
    if sort == 'hot':
        key = service.cache_key(conn, ctx.db.path, ctx.actor,
                                ('hot', tuple(kinds or ()), space_id, tuple(after or ()), size))
        (items, next_key), meta['cached'] = service.cached(
            key, lambda: build(conn, ctx.actor, kinds, space_id, after, size))
    else:
        items, next_key = build(conn, ctx.actor, kinds, space_id, after, size)
    if sort == 'following':
        meta['follows'] = service.follows(conn, ctx.actor)
    next_cursor = pagination.encode(ctx.settings, ctx.actor.id, qhash, next_key) if next_key else None
    return ok(ctx, items, next_cursor=next_cursor, **meta)


@router.get('/saved')
def saved(limit: Optional[int] = None, cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('content.saved')
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    items, next_key = service.saved_list(ctx.db.conn(), ctx.actor, after, size)
    next_cursor = pagination.encode(ctx.settings, ctx.actor.id, qhash, next_key) if next_key else None
    return ok(ctx, items, next_cursor=next_cursor)


@router.get('/objects/{object_id}')
def detail(object_id: str, version: Optional[int] = None, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    row, data = objects.detail(conn, ctx.actor, object_id, version)
    data = service.enrich_detail(conn, ctx.actor, row, data, ctx.settings.content_origin)
    return ok(ctx, data, etag=data['etag'])


@router.get('/objects/{object_id}/replies')
def replies(object_id: str, order: Literal['time', 'tree'] = 'time', thread_root: Optional[str] = None,
            limit: Optional[int] = None, cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('content.replies', object_id, order, thread_root)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    items, next_key = service.list_replies(ctx.db.conn(), ctx.actor, object_id, order, thread_root, after, size)
    next_cursor = pagination.encode(ctx.settings, ctx.actor.id, qhash, next_key) if next_key else None
    return ok(ctx, items, next_cursor=next_cursor)


@router.post('/objects/{object_id}/replies', status_code=201)
def create_reply(object_id: str, body: ReplyIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        reply_id = service.create_reply(conn, ctx.actor, object_id, body.body, body.reply_to, ctx.request_id)
        data = service.reply_detail(conn, ctx.actor, reply_id)
        return 201, ok(ctx, data, etag=data['etag'])
    return idempotency.run(ctx, body.model_dump(), work)


@router.patch('/replies/{object_id}')
def edit_reply(object_id: str, body: ReplyPatch, if_match: Optional[str] = Header(default=None),
               ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        data = service.edit_reply(conn, ctx.actor, object_id, body.body, if_match, ctx.request_id)
        return 200, ok(ctx, data, etag=data['etag'])
    return idempotency.run(ctx, body.model_dump(), work)


@router.put('/objects/{object_id}/reactions/{kind}')
def add_reaction(object_id: str, kind: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.react(conn, ctx.actor, object_id, kind, True, ctx.request_id))


@router.delete('/objects/{object_id}/reactions/{kind}')
def remove_reaction(object_id: str, kind: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.react(conn, ctx.actor, object_id, kind, False, ctx.request_id))


@router.put('/objects/{object_id}/save')
def add_save(object_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.save(conn, ctx.actor, object_id, True, ctx.request_id))


@router.delete('/objects/{object_id}/save')
def remove_save(object_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.save(conn, ctx.actor, object_id, False, ctx.request_id))


@router.post('/objects/{object_id}/useful')
def mark_useful(object_id: str, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.mark_useful(conn, ctx.actor, object_id, ctx.request_id))
    return idempotency.run(ctx, {'object_id': object_id}, work)


@router.get('/follows')
def list_follows(ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.follows(ctx.db.conn(), ctx.actor))


@router.put('/follows/{tag}')
def add_follow(tag: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.follow(conn, ctx.actor, tag, True))


@router.delete('/follows/{tag}')
def remove_follow(tag: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.follow(conn, ctx.actor, tag, False))


def highlights(snippet, q):
    lowered = snippet.lower()
    spans = []
    for term in dict.fromkeys(t.lower() for t in q.split()[:8] if t):
        start = lowered.find(term)
        while start >= 0:
            spans.append([start, start + len(term)])
            start = lowered.find(term, start + len(term))
    merged = []
    for s, e in sorted(spans):
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return merged


@router.get('/search')
def search(q: str = '', type: Optional[str] = None, space_id: Optional[str] = None, limit: Optional[int] = None,
           cursor: Optional[str] = None, count: bool = False, ctx: Ctx = Depends(user_ctx)):
    """核心检索 + 片段高亮区间。片段本身只从调用者可见的行生成（核心保证），高亮只在片段里找。"""
    result = core_search.search(q=q, type=type, space_id=space_id, limit=limit, cursor=cursor, count=count, ctx=ctx)
    query = q.strip()
    for item in result['data']:
        item['highlights'] = highlights(item['snippet'], query)
        item['title_highlights'] = highlights(item['title'], query)
    return result


@router.get('/replies/{object_id}')
def reply(object_id: str, ctx: Ctx = Depends(user_ctx)):
    data = service.reply_detail(ctx.db.conn(), ctx.actor, object_id)
    if data['status'] == 'deleted':
        raise ApiError('resource_not_found')
    return ok(ctx, data, etag=data['etag'])


@router.get('/hot-discussions/{event_id}')
def get_hot_discussion(event_id: EventId, ctx: Ctx = Depends(user_ctx)):
    """热点事件已有的讨论；没有就是 data=null，前端据此决定要不要新开。"""
    return ok(ctx, service.hot_discussion(ctx.db.conn(), ctx.actor, event_id))


@router.post('/hot-discussions/{event_id}')
def open_hot_discussion(body: HotDiscussIn, event_id: EventId, ctx: Ctx = Depends(write_ctx)):
    """同一事件只有一篇讨论：已有就返回已有的，没有才建。"""
    def work(conn):
        found, created = service.open_hot_discussion(conn, ctx.actor, event_id, body.title.strip(), body.body.strip(),
                                                     ctx.request_id)
        return (201 if created else 200), ok(ctx, {**found, 'created': created})
    return idempotency.run(ctx, {'event_id': event_id, **body.model_dump()}, work)


@router.get('/digest-read/{day}')
def get_digest_read(day: DayStr, ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.digest_read(ctx.db.conn(), ctx.actor, _day(day)))


@router.put('/digest-read/{day}')
def mark_digest_read(day: DayStr, ctx: Ctx = Depends(write_ctx)):
    _day(day)
    with ctx.db.write() as conn:
        return ok(ctx, service.set_digest_read(conn, ctx.actor, day, True))


@router.delete('/digest-read/{day}')
def unmark_digest_read(day: DayStr, ctx: Ctx = Depends(write_ctx)):
    _day(day)
    with ctx.db.write() as conn:
        return ok(ctx, service.set_digest_read(conn, ctx.actor, day, False))
