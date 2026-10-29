"""活动专区与打榜接口。路径都在 /api/events/ 下。"""

from fastapi import APIRouter, Depends, Query

from app import audit, flags
from app.authz import require
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from modules.admin import access as admin_access
from pydantic import BaseModel, ConfigDict, Field

from . import hooks, jobs, service  # noqa: F401


from . import privacy  # noqa: F401 — register member export

router = APIRouter(prefix='/api/events')
admin_router = APIRouter(prefix='/api/admin/events')


class ResolveVoteAnomalyIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reason: str = Field(min_length=2, max_length=500)
    outcome: str = Field(default='resolved', pattern=r'^(resolved|dismissed)$')


@admin_router.post('/vote-anomalies/{event_audit_id}/resolve')
def resolve_vote_anomaly(event_audit_id: str, body: ResolveVoteAnomalyIn,
                         ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor, write=True)
    with ctx.db.write() as w:
        row = w.execute("SELECT id, target_id, actor_id, meta_json FROM audit_event "
                        "WHERE id = ? AND action = 'events.vote_anomaly'", (event_audit_id,)).fetchone()
        if row is None:
            raise ApiError('resource_not_found')
        if w.execute("SELECT 1 FROM audit_event WHERE action = 'events.vote_anomaly.resolve' "
                     "AND target_type = 'audit_event' AND target_id = ?", (event_audit_id,)).fetchone():
            raise ApiError('state_conflict', '这条异常已经结案')
        audit.record(w, ctx.actor.id, 'events.vote_anomaly.resolve', 'audit_event', event_audit_id,
                     reason=body.reason, request_id=ctx.request_id,
                     meta={'outcome': body.outcome, 'event_id': row['target_id'], 'actor_id': row['actor_id']})
    return ok(ctx, {'id': event_audit_id, 'status': 'closed', 'outcome': body.outcome})


def _gate(ctx, action):
    flags.gate(ctx.db.conn(), 'events.enabled')
    require(ctx.db.conn(), ctx.actor, action)


@router.get('')
def list_events(kind: str | None = None, status: str | None = None, ctx: Ctx = Depends(user_ctx)):
    _gate(ctx, 'events.read')
    if kind and kind not in service.KINDS:
        raise ApiError('validation_failed', '活动类型不在允许范围内')
    if status and status not in ('upcoming', 'live', 'ended'):
        raise ApiError('validation_failed', '状态不在允许范围内')
    return ok(ctx, service.list_events(ctx.db.conn(), ctx.actor, kind=kind, status=status))


@router.get('/calendar')
def calendar(from_: str | None = Query(None, alias='from'), to: str | None = None,
             ctx: Ctx = Depends(user_ctx)):
    _gate(ctx, 'events.read')
    if not from_ or not to:
        raise ApiError('validation_failed', '日历接口需要 from 和 to')
    try:
        start = service._iso(from_)
        end = service._iso(to)
    except (ValueError, TypeError):
        raise ApiError('validation_failed', 'from / to 必须是可解析的时间')
    if service._ts(end) <= service._ts(start):
        raise ApiError('validation_failed', 'to 必须晚于 from')
    return ok(ctx, service.calendar_events(ctx.db.conn(), ctx.actor, start, end))


@router.get('/campaigns')
def list_campaigns(ctx: Ctx = Depends(user_ctx)):
    _gate(ctx, 'events.read')
    return ok(ctx, service.list_events(ctx.db.conn(), ctx.actor, kind='campaign'))


@router.post('')
def create_event(body: dict, ctx: Ctx = Depends(write_ctx)):
    _gate(ctx, 'events.manage')
    with ctx.db.write() as conn:
        event = service.create_event(conn, ctx.actor, body, request_id=ctx.request_id)
        return ok(ctx, service.event_view(conn, event, ctx.actor, detail=True))


@router.get('/{event_id}')
def get_event(event_id: str, ctx: Ctx = Depends(user_ctx)):
    _gate(ctx, 'events.read')
    with ctx.db.write() as conn:
        service.refresh_statuses(conn)
        event = service.load_visible(conn, ctx.actor, event_id)
        return ok(ctx, service.event_view(conn, event, ctx.actor, detail=True))


@router.post('/{event_id}/signup')
def signup(event_id: str, ctx: Ctx = Depends(write_ctx)):
    _gate(ctx, 'events.signup')
    with ctx.db.write() as conn:
        return ok(ctx, service.signup(conn, ctx.actor, event_id, request_id=ctx.request_id))


@router.get('/{event_id}/signups')
def list_signups(event_id: str, ctx: Ctx = Depends(user_ctx)):
    _gate(ctx, 'events.read')
    return ok(ctx, service.signups(ctx.db.conn(), ctx.actor, event_id))


@router.post('/{event_id}/submissions')
def create_submission(event_id: str, body: dict, ctx: Ctx = Depends(write_ctx)):
    _gate(ctx, 'events.submit')
    with ctx.db.write() as conn:
        return ok(ctx, service.submit(conn, ctx.actor, event_id, body, request_id=ctx.request_id))


@router.get('/{event_id}/submissions')
def list_submissions(event_id: str, ctx: Ctx = Depends(user_ctx)):
    _gate(ctx, 'events.read')
    return ok(ctx, service.submissions(ctx.db.conn(), ctx.actor, event_id))


@router.get('/{event_id}/board')
def get_board(event_id: str, ctx: Ctx = Depends(user_ctx)):
    _gate(ctx, 'events.read')
    return ok(ctx, service.board(ctx.db.conn(), ctx.actor, event_id))


@router.post('/{event_id}/votes')
def cast_vote(event_id: str, body: dict, ctx: Ctx = Depends(write_ctx)):
    _gate(ctx, 'events.vote')
    with ctx.db.write() as conn:
        return ok(ctx, service.vote(conn, ctx.actor, event_id, body, request_id=ctx.request_id))


@router.get('/{event_id}/results')
def get_results(event_id: str, ctx: Ctx = Depends(user_ctx)):
    _gate(ctx, 'events.read')
    with ctx.db.write() as conn:
        return ok(ctx, service.results_view(conn, ctx.actor, event_id))
