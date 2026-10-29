from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, flags
from app.authz import require
from app.context import Ctx, ok, user_ctx, write_ctx
from modules.admin import access as admin_access

from . import service


from . import privacy  # noqa: F401 — register member export

router = APIRouter(prefix='/api/farm')
admin_router = APIRouter(prefix='/api/admin/farm')
accounts.register_purger(service.purge)


@admin_router.get('/stats')
def admin_stats(from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                limit: Optional[int] = None, cursor: Optional[str] = None,
                ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    start, end = admin_access.window(from_, to)
    size, qhash, after = admin_access.page_state(ctx, 'farm.stats', limit, cursor, start, end)
    where, args = ['1=1'], {}
    if start:
        where.append('m.created_at >= :start')
        args['start'] = start
    if end:
        where.append('m.created_at < :end')
        args['end'] = end
    if after:
        where.append('(m.created_at, m.owner_id) < (:after_at, :after_id)')
        args.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT m.owner_id AS id, c.handle, p.display_name, m.plot_count, m.watchdog_until, m.created_at, m.updated_at, '
        '(SELECT count(*) FROM farm_plot x WHERE x.owner_id = m.owner_id AND x.crop_key IS NOT NULL) AS planted, '
        '(SELECT count(*) FROM farm_steal_log s WHERE s.plot_owner_id = m.owner_id) AS stolen '
        'FROM farm_member m LEFT JOIN credential c ON c.principal_id = m.owner_id '
        'LEFT JOIN profile p ON p.principal_id = m.owner_id WHERE ' + ' AND '.join(where) +
        ' ORDER BY m.created_at DESC, m.owner_id DESC LIMIT :n', {**args, 'n': size + 1}).fetchall()
    rows, next_cursor = admin_access.finish_page(ctx, qhash, rows, size,
                                                  lambda row: [row['created_at'], row['id']])
    data = {'summary': {
        'members': conn.execute('SELECT count(*) FROM farm_member').fetchone()[0],
        'planted': conn.execute('SELECT count(*) FROM farm_plot WHERE crop_key IS NOT NULL').fetchone()[0],
        'steals': conn.execute('SELECT count(*) FROM farm_steal_log').fetchone()[0],
        'helps': conn.execute('SELECT count(*) FROM farm_help_log').fetchone()[0],
    }, 'items': [dict(row) for row in rows]}
    admin_access.record_view(ctx, 'farm.admin.stats.view', 'farm', meta={'from': start, 'to': end})
    return ok(ctx, data, next_cursor=next_cursor)


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class PlantIn(Strict):
    crop: str = Field(min_length=2, max_length=32)


class TargetIn(Strict):
    handle: Optional[str] = Field(default=None, min_length=1, max_length=64)


class MessageIn(Strict):
    body: str = Field(min_length=1, max_length=120)


class WatchdogIn(Strict):
    enabled: bool = True


def gate(conn, actor, action):
    flags.gate(conn, 'farm.enabled')
    require(conn, actor, action)


def target_owner(conn, actor, body):
    return service.person_by_handle(conn, body.handle) if body and body.handle else service._human_id(actor)


@router.get('/me')
def me(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn, ctx.actor, 'farm.read')
    return ok(ctx, service.view(conn, ctx.actor, ctx.actor.id))


@router.get('/friends')
def friends(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn, ctx.actor, 'farm.read')
    return ok(ctx, service.friend_farms(conn, ctx.actor))


@router.post('/plots/{index}/plant')
def plant(index: int, body: PlantIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn, ctx.actor, 'farm.play')
        return ok(ctx, service.plant(conn, ctx.actor, index, body.crop))


@router.post('/plots/{index}/water')
def water(index: int, body: Optional[TargetIn] = None, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn, ctx.actor, 'farm.help')
        owner_id = target_owner(conn, ctx.actor, body)
        return ok(ctx, service.help_plot(conn, ctx.actor, owner_id, index, 'water', ctx.request_id))


@router.post('/plots/{index}/weed')
def weed(index: int, body: Optional[TargetIn] = None, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn, ctx.actor, 'farm.help')
        owner_id = target_owner(conn, ctx.actor, body)
        return ok(ctx, service.help_plot(conn, ctx.actor, owner_id, index, 'weed', ctx.request_id))


@router.post('/plots/{index}/harvest')
def harvest(index: int, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn, ctx.actor, 'farm.play')
        return ok(ctx, service.harvest(conn, ctx.actor, index, ctx.request_id))


@router.post('/plots/{index}/steal')
def steal(index: int, body: TargetIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn, ctx.actor, 'farm.steal')
        owner_id = target_owner(conn, ctx.actor, body)
        return ok(ctx, service.steal(conn, ctx.actor, owner_id, index, ctx.request_id))


@router.post('/plots/{index}/unlock')
def unlock(index: int, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn, ctx.actor, 'farm.play')
        return ok(ctx, service.unlock(conn, ctx.actor, index))


@router.post('/watchdog')
def watchdog(body: WatchdogIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn, ctx.actor, 'farm.play')
        return ok(ctx, service.set_watchdog(conn, ctx.actor, body.enabled))


@router.get('/{handle}/messages')
def list_messages(handle: str, limit: int = Query(default=30, ge=1, le=50), ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn, ctx.actor, 'farm.read')
    owner_id = service.person_by_handle(conn, handle)
    return ok(ctx, service.messages(conn, ctx.actor, owner_id, limit))


@router.post('/{handle}/messages', status_code=201)
def post_message(handle: str, body: MessageIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn, ctx.actor, 'farm.message')
        owner_id = service.person_by_handle(conn, handle)
        return ok(ctx, service.leave_message(conn, ctx.actor, owner_id, body.body))


@router.get('/{handle}')
def by_handle(handle: str, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn, ctx.actor, 'farm.read')
    owner_id = service.person_by_handle(conn, handle)
    return ok(ctx, service.view(conn, ctx.actor, owner_id))


def _register_agent_tool():
    try:
        from modules.agents import scopes, tools
    except ImportError:
        return

    @tools.tool(
        'farm_help', '照料先锋农场',
        '替主人给自己或好友的作物浇水，或提醒主人收菜；不能偷菜。 / Water a crop or remind the owner.',
        scopes.ME_READ,
        {'action': {'type': 'string', 'enum': ['water', 'remind'], 'description': '浇水或提醒'},
         'handle': {'type': 'string', 'minLength': 1, 'maxLength': 64, 'description': '浇哪位成员的农场'},
         'plot': {'type': 'integer', 'minimum': 1, 'maximum': 12, 'default': 1, 'description': '地块编号'}},
        required=('action',), read_only=True,
    )
    def farm_help(tctx, args):
        with tctx.db.write() as conn:
            if args['action'] == 'remind':
                data = service.remind_owner(conn, tctx.agent, tctx.request_id)
                return data, 1, data['message']
            if not args.get('handle'):
                owner_id = tctx.owner.id
            else:
                owner_id = service.person_by_handle(conn, args['handle'])
            plot = service.help_plot(conn, tctx.agent, owner_id, args['plot'], 'water', tctx.request_id)
            data = {'watered': True, 'owner_id': owner_id, 'plot': plot}
            return data, 1, f"第 {args['plot']} 块地已经浇水。"


_register_agent_tool()

