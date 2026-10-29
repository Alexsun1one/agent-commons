"""R13 MARKET-1 · 闲置与线索市集。

/挂 /api/market/*；管理队列在 /api/admin/market/*。
不碰站内支付、不做担保；只提供线索，交易由双方在站外自行确认。
"""

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import clock, errors, flags, idempotency, pagination
from app.authz import require
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from modules.admin import access as admin_access
from modules.admin import params as admin_params

from . import hooks, jobs, logic, service  # noqa: F401  hooks/jobs 注册清理与周期任务

from . import privacy  # noqa: F401 — register member export

router = APIRouter(prefix='/api/market')
admin_router = APIRouter(prefix='/api/admin/market')

errors.register('market_forbidden', 422, '这个品类不能在市集发布')
errors.register('market_daily_limit', 429, '今天的发布次数用完了')
errors.register('market_status_invalid', 409, '当前状态不能这样改')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ListingIn(Strict):
    category: Literal['sell', 'buy', 'collab', 'jobs', 'groupbuy', 'free']
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=5000)
    price: str = Field(default='', max_length=40)
    city: str = Field(default='', max_length=40)
    shipping: str = Field(default='', max_length=40)
    condition: str = Field(default='', max_length=40)
    budget: str = Field(default='', max_length=40)
    cycle: str = Field(default='', max_length=40)
    company: str = Field(default='', max_length=80)
    position: str = Field(default='', max_length=80)
    work_mode: str = Field(default='', max_length=40)
    target: str = Field(default='', max_length=80)
    deadline: str = Field(default='', max_length=40)
    images: List[str] = Field(default_factory=list, max_length=6)
    visibility: Literal['members', 'level', 'space', 'named'] = 'members'
    min_level: int = Field(default=1, ge=1, le=5)
    space_id: Optional[str] = Field(default=None, max_length=64)
    acl: List[str] = Field(default_factory=list, max_length=50)


class StatusIn(Strict):
    status: Literal['active', 'reserved', 'sold']


class ReportIn(Strict):
    reason_code: str = Field(max_length=32)
    note: str = Field(default='', max_length=500)


class CloseReportIn(Strict):
    reason: str = Field(default='兼容旧客户端关闭', min_length=2, max_length=500)
    disposition: Literal['close', 'hide', 'pending_review'] = 'close'


def gate(conn):
    flags.gate(conn, 'market.enabled')


def lazy_expire(ctx):
    conn = ctx.db.conn()
    if service.due_ids(conn, clock.now(), 1):
        with ctx.db.write() as w:
            service.expire_due(w)


def _detail(ctx, object_id):
    row = service.detail_row(ctx.db.conn(), ctx.actor, object_id)
    return service.dto(ctx.db.conn(), ctx.actor, row, full=True,
                       content_origin=ctx.settings.content_origin)


@router.get('/meta')
def meta(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    return ok(ctx, {
        'categories': [
            {
                'id': key,
                'label': value['label'],
                'active': value['active'],
                'glyph': value['glyph'],
                'fields': list(value['fields']),
                'required': list(value['required']),
            }
            for key, value in logic.CATEGORIES.items()
        ],
        'category_order': list(logic.CATEGORY_ORDER),
        'field_labels': logic.FIELD_LABELS,
        'status_labels': logic.STATUS_LABELS,
        'report_reasons': [{'id': key, 'label': label} for key, label in logic.REPORT_REASONS.items()],
        'max_images': logic.MAX_IMAGES,
        'expiry_days': int(admin_params.value(conn, 'market', 'expire_days', logic.EXPIRY_DAYS)),
        'daily_limits': logic.DAILY_LIMITS,
        'me': {'level': ctx.actor.level, 'daily_limit': logic.daily_limit(
            ctx.actor.level, admin_params.value(conn, 'market', 'l1_daily_listings', logic.DAILY_LIMITS[1]))},
    })


@router.get('/listings')
def listings(
        category: Optional[str] = Query(default=None, max_length=16),
        status: Optional[str] = Query(default=None, max_length=16),
        q: Optional[str] = Query(default=None, max_length=80),
        mine: bool = False,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    if category and category != 'all' and category not in logic.CATEGORIES:
        raise ApiError('validation_failed', '不认识的市集分类')
    if status and status not in ('all',) + logic.STATUSES:
        raise ApiError('validation_failed', '不认识的状态')
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('market.list', category, status, q, mine)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    lazy_expire(ctx)
    rows, total = service.page(conn, ctx.actor, category=category, status=status, q=q, mine=mine,
                               after=after, size=size)
    rows, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, rows, size,
                                        lambda row: [row['created_at'], row['id']])
    wanted, counts = service.interactions(conn, ctx.actor, [row['id'] for row in rows])
    data = [service.dto(conn, ctx.actor, row, content_origin=ctx.settings.content_origin,
                        wanted=wanted, counts=counts) for row in rows]
    return ok(ctx, data, next_cursor=next_cursor, count=total)


@router.get('/listings/{object_id}')
def listing(object_id: str, ctx: Ctx = Depends(user_ctx)):
    gate(ctx.db.conn())
    lazy_expire(ctx)
    return ok(ctx, _detail(ctx, object_id))


@router.post('/listings', status_code=201)
def create_listing(body: ListingIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())
    payload = body.model_dump()

    def work(conn):
        object_id = service.create(conn, ctx.actor, payload, ctx.request_id)
        data = _detail(ctx, object_id)
        return 201, ok(ctx, data, etag=data['etag'])

    return idempotency.run(ctx, payload, work)


@router.post('/listings/{object_id}/status')
def set_status(object_id: str, body: StatusIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())
    payload = body.model_dump()

    def work(conn):
        service.set_status(conn, ctx.actor, object_id, body.status, ctx.request_id)
        return 200, ok(ctx, _detail(ctx, object_id))

    return idempotency.run(ctx, payload, work)


@router.post('/listings/{object_id}/want')
def want(object_id: str, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())

    def work(conn):
        return 200, ok(ctx, service.want(conn, ctx.actor, object_id, ctx.request_id))

    return idempotency.run(ctx, {}, work)


@router.post('/listings/{object_id}/report', status_code=201)
def report(object_id: str, body: ReportIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())
    payload = body.model_dump()

    def work(conn):
        result = service.report(conn, ctx.actor, object_id, body.reason_code, body.note, ctx.request_id)
        return (201 if result['created'] else 200), ok(ctx, result)

    return idempotency.run(ctx, payload, work)


# ---------------------------------------------------------------- 治理队列


@admin_router.get('/reports')
def report_queue(status: Literal['open', 'closed'] = 'open', limit: Optional[int] = None,
                 cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'market.moderate')
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('market.reports', status)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    rows = service.reports(conn, ctx.actor, status=status, after=after, limit=size + 1)
    rows, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, rows, size,
                                        lambda row: [row['created_at'], row['id']])
    return ok(ctx, rows, next_cursor=next_cursor)


@admin_router.get('/listings')
def admin_listings(category: Optional[str] = None, status: Optional[str] = None,
                   from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                   limit: Optional[int] = None, cursor: Optional[str] = None,
                   ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    if category and category not in logic.CATEGORIES:
        raise ApiError('validation_failed', '分类不在允许范围内')
    if status and status not in logic.STATUSES:
        raise ApiError('validation_failed', '状态不在允许范围内')
    start, end = admin_access.window(from_, to)
    size, qhash, after = admin_access.page_state(
        ctx, 'market.listings.admin', limit, cursor, category, status, start, end)
    where, args = ['1=1'], {}
    for clause, value, key in (("m.category = :category", category, 'category'),
                               ("m.status = :status", status, 'status'),
                               ("m.created_at >= :start", start, 'start'), ("m.created_at < :end", end, 'end')):
        if value:
            where.append(clause)
            args[key] = value
    if after:
        where.append('(m.created_at, m.object_id) < (:after_at, :after_id)')
        args.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT m.object_id AS id, m.category, m.status, m.price, m.city, m.expires_at, m.created_at, m.updated_at, '
        'h.author_id, h.lifecycle, c.handle, p.display_name, '
        '(SELECT count(*) FROM market_interest i WHERE i.object_id = m.object_id) AS want_count, '
        '(SELECT count(*) FROM market_report r WHERE r.object_id = m.object_id AND r.status = \'open\') AS report_count '
        'FROM market_listing m JOIN object_head h ON h.id = m.object_id '
        'LEFT JOIN credential c ON c.principal_id = h.author_id LEFT JOIN profile p ON p.principal_id = h.author_id '
        'WHERE ' + ' AND '.join(where) + ' ORDER BY m.created_at DESC, m.object_id DESC LIMIT :n',
        {**args, 'n': size + 1}).fetchall()
    rows, next_cursor = admin_access.finish_page(ctx, qhash, rows, size,
                                                  lambda row: [row['created_at'], row['id']])
    admin_access.record_view(ctx, 'market.admin.listings.view', 'market_listing',
                             meta={'category': category, 'status': status})
    return ok(ctx, [dict(row) for row in rows], next_cursor=next_cursor)


@admin_router.get('/rules')
def admin_rules(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    data = {
        'categories': [{'key': key, 'label': value['label'], 'required': list(value['required'])}
                       for key, value in logic.CATEGORIES.items()],
        'statuses': list(logic.STATUSES),
        'report_reasons': [{'key': key, 'label': value} for key, value in logic.REPORT_REASONS.items()],
        'forbidden': [{'key': key, 'label': label} for key, _pattern, label in logic.FORBIDDEN],
        'limits': {
            'l1_daily_listings': int(admin_params.value(
                conn, 'market', 'l1_daily_listings', logic.DAILY_LIMITS[1])),
            'expire_days': int(admin_params.value(conn, 'market', 'expire_days', logic.EXPIRY_DAYS)),
        },
    }
    admin_access.record_view(ctx, 'market.admin.rules.view', 'market_rule')
    return ok(ctx, data)


@admin_router.post('/reports/{report_id}/close')
def close_report(report_id: str, body: Optional[CloseReportIn] = None, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'market.moderate')

    body = body or CloseReportIn()

    def work(w):
        return 200, ok(ctx, service.close_report(
            w, ctx.actor, report_id, body.reason, body.disposition, ctx.request_id))

    return idempotency.run(ctx, body.model_dump(), work)
