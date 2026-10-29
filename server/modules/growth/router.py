import re
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, audit, clock, flags, idempotency, outbox
from app.authz import require
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from app.security import limit

from . import engine, hooks, jobs, rules, tokens, views  # noqa: F401

router = APIRouter(prefix='/api/growth')
admin_router = APIRouter(prefix='/api/admin/growth')  # 主控接线后与 /api/growth/admin/* 等价，见回执

SEASON_ID = re.compile(r'[a-z0-9][a-z0-9_-]{1,31}\Z')
DATE = re.compile(r'\d{4}-\d{2}-\d{2}\Z')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class OptoutIn(Strict):
    optout: bool = True


class ConsentIn(Strict):
    consent: bool


class AppointIn(Strict):
    handle: str = Field(max_length=32)
    level: int = Field(ge=1, le=5)
    reason_code: str = Field(max_length=32)
    committee_ref: Optional[str] = Field(default=None, max_length=64)


class RuleIn(Strict):
    key: str = Field(max_length=64)
    value: Any
    reason_code: str = Field(max_length=32)


class UnlockIn(Strict):
    action: str = Field(max_length=96)
    min_level: int = Field(ge=1, le=5)
    reason_code: str = Field(max_length=32)


class SeasonIn(Strict):
    id: str = Field(max_length=32)
    name: str = Field(min_length=1, max_length=40)
    starts_on: str = Field(max_length=10)
    ends_on: str = Field(max_length=10)


class RecomputeIn(Strict):
    handle: Optional[str] = Field(default=None, max_length=32)


class ReviewIn(Strict):
    decision: str = Field(pattern='^(approve|reject)$')
    reason_code: str = Field(max_length=32)


def gate(ctx):
    flags.gate(ctx.db.conn(), 'growth.enabled')


def reason(code):
    if code not in rules.REASON_CODES:
        raise ApiError('validation_failed', '原因码不在允许范围内')
    return code


def admin_ctx(ctx: Ctx = Depends(user_ctx)) -> Ctx:
    limit(ctx.request, 'admin', ctx.actor.id)
    gate(ctx)
    return ctx


@router.get('/me')
def get_me(ctx: Ctx = Depends(user_ctx)):
    gate(ctx)
    return ok(ctx, views.me_view(ctx.db.conn(), ctx.actor.id))


@router.get('/board')
def get_board(season: Optional[str] = Query(default=None, max_length=32), ctx: Ctx = Depends(user_ctx)):
    gate(ctx)
    data = views.board_view(ctx.db.conn(), ctx.actor.id, season)
    if data is None:
        raise ApiError('resource_not_found')
    return ok(ctx, data)


@router.get('/tokens')
def get_tokens(season: Optional[str] = Query(default=None, max_length=32), ctx: Ctx = Depends(user_ctx)):
    gate(ctx)
    data = views.tokens_view(ctx.db.conn(), ctx.actor.id, season)
    if data is None:
        raise ApiError('resource_not_found')
    rows, extras = data
    return ok(ctx, rows, **extras)


@router.get('/rules')
def get_rules(ctx: Ctx = Depends(user_ctx)):
    gate(ctx)
    return ok(ctx, views.rules_view(ctx.db.conn()))


@router.post('/tokens/report')
def report_tokens(body: Any = Body(...), ctx: Ctx = Depends(write_ctx)):
    gate(ctx)
    try:
        tokens.scan(body)
    except ApiError:
        audit.record_now(ctx.db, ctx.actor.id, 'growth.token_report', 'principal', ctx.actor.id, outcome='denied',
                         reason='secret_detected', request_id=ctx.request_id)
        raise
    with ctx.db.write() as conn:
        season = rules.season_row(conn)
        if season is None:
            raise ApiError('state_conflict', '现在没有进行中的赛季')
        data = tokens.submit(conn, ctx.actor.id, season['id'], body, ctx.request_id)
    return ok(ctx, data)


@router.post('/optout')
def optout(body: OptoutIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx)

    def work(conn):
        engine.ensure_state(conn, ctx.actor.id)
        conn.execute('UPDATE growth_state SET opted_out = ?, updated_at = ? WHERE principal_id = ?',
                     (int(body.optout), clock.now(), ctx.actor.id))
        audit.record(conn, ctx.actor.id, 'growth.optout', 'principal', ctx.actor.id, request_id=ctx.request_id,
                     meta={'optout': body.optout})
        return 200, ok(ctx, {'optedOut': body.optout})
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/consent')
def consent(body: ConsentIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx)

    def work(conn):
        engine.set_consent(conn, ctx.actor.id, body.consent, ctx.request_id)
        engine.recompute(conn, ctx.actor.id, ctx.request_id)
        return 200, ok(ctx, {'consentMetering': body.consent})
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/admin/appoint')
@admin_router.post('/appoint')
def appoint(body: AppointIn, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        require(conn, ctx.actor, 'growth.appoint')
        pid = accounts.principal_by_handle(conn, body.handle.strip().lower())
        data = engine.appoint(conn, ctx.actor.id, pid, body.level, reason(body.reason_code), body.committee_ref,
                              ctx.request_id)
        return 200, ok(ctx, data)
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/admin/rules')
@admin_router.post('/rules')
def edit_rule(body: RuleIn, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        require(conn, ctx.actor, 'growth.rules.edit')
        return 200, ok(ctx, rules.update(conn, body.key, body.value, ctx.actor.id, reason(body.reason_code),
                                         ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/admin/unlock')
@admin_router.post('/unlock')
def edit_unlock(body: UnlockIn, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        require(conn, ctx.actor, 'growth.rules.edit')
        return 200, ok(ctx, rules.set_unlock(conn, body.action, body.min_level, ctx.actor.id, reason(body.reason_code),
                                             ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/admin/seasons', status_code=201)
@admin_router.post('/seasons', status_code=201)
def create_season(body: SeasonIn, ctx: Ctx = Depends(admin_ctx)):
    if not SEASON_ID.match(body.id) or not DATE.match(body.starts_on) or not DATE.match(body.ends_on):
        raise ApiError('validation_failed', '赛季编号或日期格式不对')

    def work(conn):
        require(conn, ctx.actor, 'growth.season.manage')
        try:
            start = clock.parse(body.starts_on + 'T00:00:00.000000Z')
            end = clock.parse(body.ends_on + 'T00:00:00.000000Z') + 86400
        except ValueError:
            raise ApiError('validation_failed', '日期不存在')
        if end <= start:
            raise ApiError('validation_failed', '结束日期要晚于开始日期')
        starts, ends = clock.iso(start), clock.iso(end)
        if conn.execute('SELECT 1 FROM growth_season WHERE id = ? OR (starts_at < ? AND ends_at > ?)',
                        (body.id, ends, starts)).fetchone():
            raise ApiError('state_conflict', '赛季编号重复，或和已有赛季时间重叠')
        conn.execute('INSERT INTO growth_season (id, name, starts_at, ends_at, created_at, created_by) '
                     'VALUES (?, ?, ?, ?, ?, ?)', (body.id, body.name.strip(), starts, ends, clock.now(), ctx.actor.id))
        audit.record(conn, ctx.actor.id, 'growth.season_create', 'growth_season', body.id, request_id=ctx.request_id,
                     meta={'starts_on': body.starts_on, 'ends_on': body.ends_on})
        return 201, ok(ctx, {'id': body.id, 'startsAt': body.starts_on, 'endsAt': body.ends_on})
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/admin/recompute')
@admin_router.post('/recompute')
def recompute(body: RecomputeIn, ctx: Ctx = Depends(admin_ctx)):
    require(ctx.db.conn(), ctx.actor, 'growth.recompute')
    if not body.handle:
        return ok(ctx, engine.recompute_all(ctx.db, ctx.request_id))

    def work(conn):
        pid = accounts.principal_by_handle(conn, body.handle.strip().lower())
        return 200, ok(ctx, engine.recompute(conn, pid, ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@router.get('/review')
def list_review(ctx: Ctx = Depends(user_ctx)):
    gate(ctx)
    require(ctx.db.conn(), ctx.actor, 'growth.review.decide')
    return ok(ctx, views.review_queue(ctx.db.conn()))


@router.post('/review/{review_id}')
def decide_review(review_id: str, body: ReviewIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx)
    code = body.reason_code
    if code not in ('review_passed', 'review_rejected', 'needs_more_time'):
        raise ApiError('validation_failed', '原因码不在允许范围内')

    def work(conn):
        require(conn, ctx.actor, 'growth.review.decide')
        return 200, ok(ctx, engine.decide_review(conn, review_id, body.decision, ctx.actor.id, code, ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


# ---- 事件消费（worker 的 outbox 投递里运行） ----

def _ready(conn):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'growth_state'").fetchone() is not None


def on_ledger(conn, event):
    if not _ready(conn):
        return
    flags.gate(conn, 'growth.enabled')
    payload = event['payload']
    subject = payload.get('subject_id')
    if not subject:
        return
    if event['event_type'] == 'ledger.recorded':
        if payload.get('event_type') == 'violation' and payload.get('points', 0) < 0:
            engine.demote(conn, subject, event['aggregate_id'], event.get('request_id'))
            return
    elif event['event_type'] == 'ledger.reversed':
        original = conn.execute('SELECT event_type FROM ledger_entry WHERE id = ?', (payload.get('reverses_id'),)).fetchone()
        if original and original['event_type'] == 'violation':
            engine.restore_after_appeal(conn, subject, payload['reverses_id'], event.get('request_id'))
    engine.recompute(conn, subject, event.get('request_id'))


def on_object(conn, event):
    if not _ready(conn) or not event.get('actor_id'):
        return
    flags.gate(conn, 'growth.enabled')
    if engine.touch_activity(conn, event['actor_id'], event['occurred_at'][:10]):
        engine.recompute(conn, event['actor_id'], event.get('request_id'))


def on_report_resolved(conn, event):
    if not _ready(conn):
        return
    flags.gate(conn, 'growth.enabled')
    payload = event['payload']
    if payload.get('reporter_id'):
        engine.note_report(conn, payload['reporter_id'], bool(payload.get('upheld')))
        engine.recompute(conn, payload['reporter_id'], event.get('request_id'))


outbox.subscribe('growth.levels', 'ledger.*', on_ledger)
outbox.subscribe('growth.activity', 'object.*', on_object)
outbox.subscribe('growth.reports', 'governance.report_resolved', on_report_resolved)


def export_growth(conn, actor):
    if not _ready(conn):
        return {}
    state = engine.state_row(conn, actor.id)
    return {
        'consentMetering': bool(conn.execute('SELECT metering_consent FROM profile WHERE principal_id = ?',
                                            (actor.id,)).fetchone()[0]),
        'optedOut': bool(state and state['opted_out']),
        'state': dict(state) if state else None,
        'counters': [dict(r) for r in conn.execute(
            'SELECT key, value FROM growth_counter WHERE principal_id = ?', (actor.id,))],
        'reviews': [dict(r) for r in conn.execute(
            'SELECT id, target_level, state, snapshot_json, created_at, decided_at, reason_code '
            'FROM growth_review WHERE principal_id = ?', (actor.id,))],
        'activityDays': [r[0] for r in conn.execute('SELECT day FROM growth_activity WHERE principal_id = ? ORDER BY day',
                                                    (actor.id,))],
        'tokenReports': [dict(r) for r in conn.execute(
            'SELECT season_id, family, band, trust, from_file, reported_at FROM growth_token_report '
            'WHERE principal_id = ?', (actor.id,))],
    }


accounts.register_exporter('growth', export_growth)
