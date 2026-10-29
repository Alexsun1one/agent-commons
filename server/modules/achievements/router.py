"""Read APIs and existing-event subscriptions for ACHV-1."""

from fastapi import APIRouter, Depends

from app import flags, outbox
from app.authz import require
from app.context import Ctx, ok, user_ctx

from . import hooks, jobs, service  # noqa: F401


from . import privacy  # noqa: F401 — register member export

router = APIRouter(prefix='/api/achievements')


def _gate(ctx):
    flags.gate(ctx.db.conn(), 'achievements.enabled')
    require(ctx.db.conn(), ctx.actor, 'achievements.read')


@router.get('/me')
def get_me(ctx: Ctx = Depends(user_ctx)):
    _gate(ctx)
    return ok(ctx, service.me_view(ctx.db.conn(), ctx.actor.id))


@router.get('/catalog')
def get_catalog(ctx: Ctx = Depends(user_ctx)):
    _gate(ctx)
    return ok(ctx, service.catalog_view(ctx.db.conn(), ctx.actor.id))


@router.get('/weekly')
def get_weekly(ctx: Ctx = Depends(user_ctx)):
    _gate(ctx)
    with ctx.db.write() as conn:
        data = service.weekly_view(conn, ctx.actor.id)
    return ok(ctx, data)


outbox.subscribe('achievements.objects', 'object.*', service.on_object)
outbox.subscribe('achievements.ledger', 'ledger.recorded', service.on_ledger)
outbox.subscribe('achievements.rooms', 'rooms.room.ended', service.on_room_ended)
