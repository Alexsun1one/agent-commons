"""R13 BIZ-1 · 会员方案、候补名单、订阅与订单。不接任何真实支付：billing.payments 默认关。"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, audit, errors, flags, idempotency, security
from app.authz import require
from app.context import Ctx, get_ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from modules.admin import access as admin_access

from . import hooks, service  # noqa: F401 — hooks 登记注销清理和到期任务

router = APIRouter(prefix='/api/billing')
admin_router = APIRouter(prefix='/api/admin/billing')

errors.register('billing_payments_disabled', 501, '支付还没有开通，现在只能加入候补名单，不会扣款')
errors.register('billing_provider_unavailable', 501, '支付渠道还没有配置，不能下单')
errors.register('billing_transition_invalid', 409, '订阅当前的状态不允许这个操作')

Cycle = Literal['month', 'year']


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class WaitlistIn(Strict):
    plan: str = Field(pattern=r'^[a-z][a-z0-9_]{1,31}$')
    cycle: Cycle = 'month'
    seats: Optional[int] = Field(default=None, ge=1, le=500)
    source: Literal[service.WAITLIST_SOURCES] = 'pricing'


class LeaveIn(Strict):
    plan: str = Field(pattern=r'^[a-z][a-z0-9_]{1,31}$')


class OrderIn(Strict):
    plan: str = Field(pattern=r'^[a-z][a-z0-9_]{1,31}$')
    cycle: Cycle = 'month'
    seats: Optional[int] = Field(default=None, ge=1, le=500)


class GrantIn(Strict):
    handle: str = Field(min_length=3, max_length=32)
    plan: str = Field(pattern=r'^[a-z][a-z0-9_]{1,31}$')
    cycle: Cycle = 'month'
    seats: Optional[int] = Field(default=None, ge=1, le=500)
    state: Literal['waitlist', 'trial'] = 'trial'
    days: Optional[int] = Field(default=None, ge=1, le=365)
    reason_code: Literal[service.ADMIN_REASONS]


class TransitionIn(Strict):
    to: Literal[service.STATES]
    days: Optional[int] = Field(default=None, ge=1, le=365)
    reason_code: Literal[service.ADMIN_REASONS]


def gate(conn):
    flags.gate(conn, 'billing.enabled')


def trial_days(conn, days):
    limit = service.config_int(conn, 'trial.max_days', 90)
    days = days or 30
    if days > limit:
        raise ApiError('validation_failed', f'试用最长 {limit} 天')
    return days


# ---------------------------------------------------------------- 成员


@router.get('/plans')
def get_plans(ctx: Ctx = Depends(get_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    data = service.plans(conn)
    data['paymentsEnabled'] = flags.enabled(conn, 'billing.payments')
    return ok(ctx, data)


@router.get('/me')
def get_me(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'billing.me.read')
    if service.due_ids(conn, principal_id=ctx.actor.id, limit=5):
        with ctx.db.write() as w:
            for sub_id in service.due_ids(w, principal_id=ctx.actor.id, limit=5):
                service.expire(w, sub_id, ctx.request_id)
    return ok(ctx, service.me(conn, ctx.actor, flags.enabled(conn, 'billing.payments')))


@router.post('/waitlist')
def post_waitlist(body: WaitlistIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'billing.waitlist.join')
    security.hit(ctx.db, f'billing.waitlist:{ctx.actor.id}', service.config_int(conn, 'waitlist.per_hour', 10), 3600)

    def work(w):
        entry, duplicate = service.join_waitlist(w, ctx.actor, plan_key=body.plan, cycle=body.cycle,
                                                 seats=body.seats, source=body.source, request_id=ctx.request_id)
        return (200 if duplicate else 201), ok(ctx, {'entry': entry, 'duplicate': duplicate, 'charged': False})

    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/waitlist/leave')
def post_waitlist_leave(body: LeaveIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'billing.waitlist.join')
    with ctx.db.write() as w:
        left = service.leave_waitlist(w, ctx.actor, body.plan, ctx.request_id)
    return ok(ctx, {'left': left})


@router.post('/orders')
def post_order(body: OrderIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    if not flags.enabled(conn, 'billing.payments'):
        audit.record_now(ctx.db, ctx.actor.id, 'billing.order.create', 'billing_plan', body.plan, outcome='denied',
                         reason='payments_disabled', request_id=ctx.request_id, meta={'cycle': body.cycle})
        raise ApiError('billing_payments_disabled')
    require(conn, ctx.actor, 'billing.order.create')

    def work(w):
        order = service.create_order(w, ctx.actor, plan_key=body.plan, cycle=body.cycle, seats=body.seats,
                                     request_id=ctx.request_id)
        return 201, ok(ctx, order)

    return idempotency.run(ctx, body.model_dump(), work, required=True)


@router.post('/subscription/cancel')
def post_cancel(ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'billing.subscription.cancel')
    with ctx.db.write() as w:
        sub = service.open_subscription(w, ctx.actor.id)
        if sub is None:
            raise ApiError('resource_not_found', '没有可以取消的订阅')
        sub = service.transition(w, sub, 'canceled', reason='member.cancel', actor_id=ctx.actor.id,
                                 request_id=ctx.request_id)
    return ok(ctx, {'subscription': service.subscription_view(sub)})


# ---------------------------------------------------------------- 管理（admin + TOTP）


@admin_router.get('/overview')
def admin_overview(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'billing.admin.read')
    data = service.overview(conn)
    data['paymentsEnabled'] = flags.enabled(conn, 'billing.payments')
    return ok(ctx, data)


@admin_router.get('/waitlist')
def admin_waitlist(plan: Optional[str] = Query(default=None, pattern=r'^[a-z][a-z0-9_]{1,31}$'),
                   limit: int = Query(default=50, ge=1, le=200), ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'billing.admin.read')
    return ok(ctx, service.admin_waitlist(conn, plan, limit))


@admin_router.get('/subscriptions')
def admin_subscriptions(state: Optional[Literal[service.STATES]] = None,
                        limit: int = Query(default=50, ge=1, le=200), ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'billing.admin.read')
    return ok(ctx, service.admin_subscriptions(conn, state, limit))


@admin_router.get('/orders')
def admin_orders(state: Optional[str] = None,
                 from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                 limit: Optional[int] = None, cursor: Optional[str] = None,
                 ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    allowed = ('created', 'pending', 'paid', 'failed', 'canceled', 'refunded')
    if state and state not in allowed:
        raise ApiError('validation_failed', '订单状态不在允许范围内')
    start, end = admin_access.window(from_, to)
    size, qhash, after = admin_access.page_state(ctx, 'billing.orders', limit, cursor, state, start, end)
    where, args = ['1=1'], {}
    for clause, value, key in (("o.state = :state", state, 'state'),
                               ("o.created_at >= :start", start, 'start'), ("o.created_at < :end", end, 'end')):
        if value:
            where.append(clause)
            args[key] = value
    if after:
        where.append('(o.created_at, o.id) < (:after_at, :after_id)')
        args.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT o.id, o.principal_id, c.handle, p.display_name, o.plan_key, bp.name AS plan_name, o.cycle, '
        'o.seats, o.amount_fen, o.currency, o.provider, o.provider_ref, o.state, o.subscription_id, '
        'o.created_at, o.updated_at FROM billing_order o JOIN billing_plan bp ON bp.key = o.plan_key '
        'LEFT JOIN credential c ON c.principal_id = o.principal_id LEFT JOIN profile p ON p.principal_id = o.principal_id '
        'WHERE ' + ' AND '.join(where) + ' ORDER BY o.created_at DESC, o.id DESC LIMIT :n',
        {**args, 'n': size + 1}).fetchall()
    rows, next_cursor = admin_access.finish_page(ctx, qhash, rows, size,
                                                  lambda row: [row['created_at'], row['id']])
    admin_access.record_view(ctx, 'billing.admin.orders.view', 'billing_order', meta={'state': state})
    return ok(ctx, [dict(row) for row in rows], next_cursor=next_cursor)


@admin_router.post('/subscriptions')
def admin_grant(body: GrantIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'billing.admin.manage')
    with ctx.db.write() as w:
        target = w.execute('SELECT principal_id FROM credential WHERE handle = ?', (body.handle,)).fetchone()
        if target is None:
            raise ApiError('resource_not_found', '没有这个成员')
        plan = service.plan_row(w, body.plan, purchasable=True)
        days = trial_days(w, body.days) if body.state == 'trial' else None
        sub = service.create_subscription(
            w, principal_id=target['principal_id'], plan_key=plan['key'], cycle=body.cycle,
            seats=service.normalize_seats(plan, body.seats), state=body.state, source='admin',
            reason=f'admin.{body.reason_code}', actor_id=ctx.actor.id, days=days, request_id=ctx.request_id)
    return ok(ctx, {'subscription': service.subscription_view(sub)})


@admin_router.post('/subscriptions/{sub_id}/transition')
def admin_transition(sub_id: str, body: TransitionIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'billing.admin.manage')
    if body.to == 'active':
        raise ApiError('billing_transition_invalid', '生效只能由已付款的订单触发')
    with ctx.db.write() as w:
        sub = service.subscription(w, sub_id)
        days = trial_days(w, body.days) if body.to == 'trial' else None
        sub = service.transition(w, sub, body.to, reason=f'admin.{body.reason_code}', actor_id=ctx.actor.id,
                                 days=days, request_id=ctx.request_id)
    return ok(ctx, {'subscription': service.subscription_view(sub)})


accounts.register_exporter('billing', service.export)
