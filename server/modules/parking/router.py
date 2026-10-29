"""R13 PARK-1 HTTP 接口。"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import errors, idempotency
from app.context import Ctx, ok, user_ctx, write_ctx
from modules.admin import access as admin_access

from . import hooks  # noqa: F401
from . import service


from . import privacy  # noqa: F401 — register member export

router = APIRouter(prefix='/api/parking')
admin_router = APIRouter(prefix='/api/admin/parking')


@admin_router.get('/stats')
def admin_stats(from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                limit: Optional[int] = None, cursor: Optional[str] = None,
                ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    start, end = admin_access.window(from_, to)
    size, qhash, after = admin_access.page_state(ctx, 'parking.stats', limit, cursor, start, end)
    where, args = ['1=1'], {}
    if start:
        where.append('s.parked_at >= :start')
        args['start'] = start
    if end:
        where.append('s.parked_at < :end')
        args['end'] = end
    if after:
        where.append('(s.parked_at, s.id) < (:after_at, :after_id)')
        args.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT s.id, s.vehicle_id, s.lot_owner_id, s.slot_no, s.parked_at AS created_at, s.ended_at, '
        's.end_reason, s.gross_earned, s.parker_share, s.owner_share, s.welcome_at_park, v.owner_id AS parker_id '
        'FROM parking_stay s JOIN parking_vehicle v ON v.id = s.vehicle_id WHERE ' + ' AND '.join(where) +
        ' ORDER BY s.parked_at DESC, s.id DESC LIMIT :n', {**args, 'n': size + 1}).fetchall()
    rows, next_cursor = admin_access.finish_page(ctx, qhash, rows, size,
                                                  lambda row: [row['created_at'], row['id']])
    data = {'summary': {
        'lots': conn.execute('SELECT count(*) FROM parking_lot').fetchone()[0],
        'vehicles': conn.execute('SELECT count(*) FROM parking_vehicle').fetchone()[0],
        'active_stays': conn.execute('SELECT count(*) FROM parking_stay WHERE ended_at IS NULL').fetchone()[0],
        'tickets': conn.execute("SELECT count(*) FROM parking_stay WHERE end_reason = 'ticket'").fetchone()[0],
    }, 'items': [dict(row) for row in rows]}
    admin_access.record_view(ctx, 'parking.admin.stats.view', 'parking', meta={'from': start, 'to': end})
    return ok(ctx, data, next_cursor=next_cursor)

errors.register('parking_own_lot', 409, '不能停进自己的车位')
errors.register('parking_not_friend', 403, '只有互相关注的好友能互相停车')
errors.register('parking_vehicle_busy', 409, '这辆车已经停在别处')
errors.register('parking_space_busy', 409, '这个车位已经有车')
errors.register('parking_not_parked', 409, '这辆车现在没有停在外面')
errors.register('parking_space_empty', 409, '这个车位现在是空的')
errors.register('parking_welcome_protected', 409, '欢迎停车位不能贴条')
errors.register('parking_ticket_early', 409, '停满一小时才能贴条')
errors.register('parking_ticket_limit', 429, '今天贴条次数已经用完')
errors.register('parking_agent_ticket', 403, 'Agent 不能贴条')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ParkIn(Strict):
    vehicle_id: str = Field(min_length=8, max_length=64)
    owner_handle: str = Field(min_length=2, max_length=32)
    slot_no: int = Field(ge=1, le=8)
    message: Optional[str] = Field(default='', max_length=80)


class MoveIn(Strict):
    vehicle_id: str = Field(min_length=8, max_length=64)


class TicketIn(Strict):
    slot_no: int = Field(ge=1, le=8)


class WelcomeIn(Strict):
    slot_no: int = Field(ge=1, le=8)
    enabled: bool


@router.get('/me')
def mine(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.me(conn, ctx.actor))


@router.get('/friends')
def friend_lots(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.friends(conn, ctx.actor))


@router.get('/{handle}')
def member_lot(handle: str, ctx: Ctx = Depends(user_ctx)):
    with ctx.db.write() as conn:
        owner = service.principal_for_handle(conn, handle)
        return ok(ctx, service.lot(conn, ctx.actor, owner['id']))


@router.post('/park')
def park(body: ParkIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        data = service.park(conn, ctx.actor, body.vehicle_id, body.owner_handle, body.slot_no,
                            body.message or '', ctx.request_id)
        return 201, ok(ctx, data)
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/move')
def move(body: MoveIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.move(conn, ctx.actor, body.vehicle_id, ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/ticket')
def ticket(body: TicketIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.ticket(conn, ctx.actor, body.slot_no, ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/welcome')
def welcome(body: WelcomeIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.set_welcome(conn, ctx.actor, body.slot_no, body.enabled, ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)

