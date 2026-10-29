"""HTTP routes for bamboo balances, ledger entries, the cosmetic shop and check-in."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import errors, flags, idempotency
from app import audit
from app.authz import require
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from modules.admin import access as admin_access

from . import hooks, jobs, service  # noqa: F401


router = APIRouter(prefix='/api/economy')
admin_router = APIRouter(prefix='/api/admin/economy')

errors.register('insufficient_funds', 409, '竹子余额不足')
errors.register('already_owned', 409, '已经拥有这件物品')
errors.register('sold_out', 409, '这件限量物品已经售罄')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class EmptyIn(Strict):
    pass


class AdjustIn(Strict):
    principal_id: str = Field(min_length=1, max_length=64)
    currency: Literal['bamboo'] = 'bamboo'
    amount: int = Field(ge=-100000, le=100000)
    reason_code: str = Field(min_length=3, max_length=32, pattern=r'^[a-z][a-z0-9_]+$')
    ref: Optional[str] = Field(default=None, max_length=96)


class ResolveAnomalyIn(Strict):
    reason: str = Field(min_length=2, max_length=500)
    outcome: Literal['resolved', 'dismissed'] = 'resolved'


def gate(conn, actor=None):
    flags.gate(conn, 'economy.enabled')
    if actor is not None:
        require(conn, actor, 'economy.read')


def _business_key(ctx, prefix):
    return f'{prefix}:{ctx.actor.id}:{ctx.request.headers.get("idempotency-key", "")}'


@router.get('/me')
def get_me(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn, ctx.actor)
    return ok(ctx, service.me(conn, ctx.actor))


@router.get('/entries')
def get_entries(limit: int = Query(default=50, ge=1, le=100), ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn, ctx.actor)
    return ok(ctx, service.entries(conn, ctx.actor.id, limit=limit))


@router.get('/shop')
def get_shop(category: Optional[Literal['avatar_frame', 'panda_palette', 'farm_decor', 'vehicle',
                                        'sticker_pack']] = None,
             ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn, ctx.actor)
    return ok(ctx, service.shop(conn, ctx.actor.id, category), categories=[
        {'key': key, 'name': label} for key, label in service.CATEGORY_LABELS.items()
    ])


@router.post('/shop/{item_key}/buy')
def buy_item(item_key: str, body: EmptyIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())

    def work(conn):
        purchase_id = service.buy(conn, ctx.actor, item_key, _business_key(ctx, 'buy'), ctx.request_id)
        return 200, ok(ctx, {'purchase_id': purchase_id, 'item_key': item_key,
                             'balance': service.balance(conn, ctx.actor.id),
                             'inventory': service.inventory(conn, ctx.actor.id)})

    return idempotency.run(ctx, body.model_dump(), work, required=True)


@router.post('/inventory/{item_key}/equip')
def equip_item(item_key: str, body: EmptyIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())

    def work(conn):
        service.equip(conn, ctx.actor, item_key, ctx.request_id)
        return 200, ok(ctx, {'item_key': item_key, 'equipped': True,
                             'inventory': service.inventory(conn, ctx.actor.id)})

    return idempotency.run(ctx, body.model_dump(), work)


@router.get('/checkin')
def get_checkin(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn, ctx.actor)
    return ok(ctx, service.checkin_view(conn, ctx.actor.id))


@router.post('/checkin')
def post_checkin(body: EmptyIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())
    with ctx.db.write() as conn:
        data = service.checkin(conn, ctx.actor, ctx.request_id)
        return ok(ctx, data, balance=service.balance(conn, ctx.actor.id))


@admin_router.post('/adjust')
def adjust_wallet(body: AdjustIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())

    def work(conn):
        amount = service.admin_adjust(
            conn, ctx.actor, body.principal_id, body.currency, body.amount, body.reason_code,
            _business_key(ctx, 'admin-adjust'), body.ref, ctx.request_id)
        return 200, ok(ctx, {'principal_id': body.principal_id, 'currency': body.currency,
                             'amount': amount, 'balance': service.balance(conn, body.principal_id, body.currency)})

    return idempotency.run(ctx, body.model_dump(), work, required=True)


@admin_router.get('/summary')
def admin_summary(from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                  ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    start, end = admin_access.window(from_, to)
    where, args = ['1=1'], {}
    if start:
        where.append('created_at >= :start')
        args['start'] = start
    if end:
        where.append('created_at < :end')
        args['end'] = end
    rows = conn.execute(
        'SELECT reason, sum(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS granted, '
        'sum(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS spent, count(*) AS entries, '
        'count(DISTINCT principal_id) AS members FROM wallet_entry WHERE ' + ' AND '.join(where) +
        ' GROUP BY reason ORDER BY granted + spent DESC, reason', args).fetchall()
    data = {
        'currency': service.CURRENCY,
        'granted': sum(int(row['granted']) for row in rows),
        'spent': sum(int(row['spent']) for row in rows),
        'net': sum(int(row['granted']) - int(row['spent']) for row in rows),
        'reasons': [dict(row) for row in rows],
        'from': start, 'to': end,
    }
    admin_access.record_view(ctx, 'economy.admin.summary.view', 'wallet_entry', meta={'from': start, 'to': end})
    return ok(ctx, data)


@admin_router.post('/anomalies/{marker_id}/resolve')
def resolve_anomaly(marker_id: str, body: ResolveAnomalyIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor, write=True)
    with ctx.db.write() as w:
        marker = w.execute('SELECT id, principal_id, kind FROM economy_anomaly_marker WHERE id = ?',
                           (marker_id,)).fetchone()
        if marker is None:
            raise ApiError('resource_not_found')
        if w.execute("SELECT 1 FROM audit_event WHERE action = 'economy.anomaly.resolve' "
                     "AND target_type = 'economy_anomaly' AND target_id = ?", (marker_id,)).fetchone():
            raise ApiError('state_conflict', '这条异常已经结案')
        audit.record(w, ctx.actor.id, 'economy.anomaly.resolve', 'economy_anomaly', marker_id,
                     reason=body.reason, request_id=ctx.request_id,
                     meta={'outcome': body.outcome, 'principal_id': marker['principal_id'], 'kind': marker['kind']})
    return ok(ctx, {'id': marker_id, 'status': 'closed', 'outcome': body.outcome})
