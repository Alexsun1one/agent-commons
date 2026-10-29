"""R13 PET-1 HTTP routes."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app import errors, idempotency
from app.context import Ctx, ok, user_ctx, write_ctx

from . import hooks  # noqa: F401
from . import service


from . import privacy  # noqa: F401 — register member export

router = APIRouter(prefix='/api/pet')

errors.register('pet_not_adopted', 409, '先领养一只熊猫')
errors.register('pet_already_adopted', 409, '你已经有一只熊猫了')
errors.register('pet_name_rejected', 422, '这个名字不能使用')
errors.register('pet_feed_limit', 429, '今天已经喂过 6 次了')
errors.register('pet_care_limit', 429, '今天的陪伴次数已经用完')
errors.register('pet_visit_limit', 429, '今天已经串过 5 家了')
errors.register('pet_already_visited', 409, '今天已经来过这家了')
errors.register('pet_not_friend', 403, '只有互相关注的好友才能串门')
errors.register('pet_agent_action', 403, 'Agent 只能提醒，不能替主人操作')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class AdoptIn(Strict):
    name: str = Field(min_length=1, max_length=8)
    palette: Literal['classic', 'brand-blue', 'mint', 'mist-purple', 'graphite', 'night-sky']


class CareIn(Strict):
    action: Literal['pat', 'play'] = 'pat'


class VisitIn(Strict):
    handle: str = Field(min_length=2, max_length=32)


def _key(ctx):
    return ctx.request.headers.get('idempotency-key') or ctx.request_id


@router.get('/me')
def mine(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, service.me(conn, ctx.actor))


@router.get('/friends')
def friend_pets(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, service.friends(conn, ctx.actor))


@router.get('/diary')
def my_diary(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, service.diary(conn, ctx.actor))


@router.get('/{handle}')
def member_pet(handle: str, ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        owner = service.principal_for_handle(conn, handle)
        return ok(ctx, service.member(conn, ctx.actor, owner['id']))


@router.post('/adopt')
def adopt(body: AdoptIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 201, ok(ctx, service.adopt(conn, ctx.actor, body.name, body.palette, ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work, required=True)


@router.post('/feed')
def feed(ctx: Ctx = Depends(write_ctx)):
    body = {}

    def work(conn):
        return 200, ok(ctx, service.feed(conn, ctx.actor, _key(ctx), ctx.request_id))
    return idempotency.run(ctx, body, work, required=True)


@router.post('/pat')
def care(body: CareIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.care(conn, ctx.actor, body.action, _key(ctx), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work, required=True)


@router.post('/visit')
def visit(body: VisitIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.visit(conn, ctx.actor, body.handle, _key(ctx), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work, required=True)
