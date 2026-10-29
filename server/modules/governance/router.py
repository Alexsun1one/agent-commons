"""治理接口：/api/governance/*。

治理员接口（队列、事项、动作、规则、统计、先审后发）对非治理员一律 404，不暴露存在；
治理员没开动态验证码时是 403 totp_setup_required。举报和「我的治理通知 / 申诉」对所有登录成员开放。
案件内容地址接口也允许管理员，仍要求动态验证码并逐次审计。
"""
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, audit, authz, clock, flags, idempotency, outbox, pagination, worker
from app.context import Ctx, get_ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from app.security import limit
from modules.admin import access as admin_access

from . import chat, complaints, knowledge, service

def capability(ctx: Ctx = Depends(get_ctx)):
    flags.gate(ctx.db.conn(), 'governance.enabled')


router = APIRouter(prefix='/api/governance', dependencies=[Depends(capability)])
admin_router = APIRouter(prefix='/api/admin/governance', dependencies=[Depends(capability)])
HIDDEN = {'action_not_allowed', 'unauthenticated', 'session_expired', 'capability_unavailable'}


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


Reason = Field(min_length=1, max_length=1000)


class ActIn(Strict):
    type: str = Field(max_length=32)
    reason: str = Reason
    params: Optional[dict] = None
    rule_id: Optional[str] = Field(default=None, max_length=64)


class ReasonIn(Strict):
    reason: str = Reason


class AdminSanctionIn(Strict):
    action: Literal['mute', 'ban', 'unban']
    principal_id: Optional[str] = Field(default=None, max_length=64)
    handle: Optional[str] = Field(default=None, min_length=1, max_length=64)
    reason: str = Field(min_length=2, max_length=1000)
    duration_hours: int = Field(default=24, ge=1, le=8760)


class AssignIn(Strict):
    assignee_id: Optional[str] = Field(default=None, max_length=64)


class ManualCaseIn(Strict):
    target_id: str = Field(max_length=64)
    category: str = Field(pattern='^[a-z_]{2,32}$')
    note: str = Field(default='', max_length=500)


class RuleIn(Strict):
    reason: str = Reason
    enabled: Optional[bool] = None
    severity: Optional[str] = Field(default=None, max_length=16)
    threshold: Optional[float] = None
    auto_action: Optional[str] = Field(default=None, max_length=32)
    params: Optional[Any] = None


class PremodIn(Strict):
    enabled: bool
    reason: str = Reason
    confirm: str = Field(max_length=16)


class ReportIn(Strict):
    target_id: str = Field(max_length=64)
    reason_code: str = Field(max_length=32)
    note: str = Field(default='', max_length=500)


class AppealIn(Strict):
    action_id: str = Field(max_length=64)
    statement: str = Field(min_length=1, max_length=2000)


class DecideIn(Strict):
    outcome: str = Field(pattern='^(upheld|overturned)$')
    reason: str = Reason


class HideIn(Strict):
    object_id: str = Field(max_length=64)
    reason: str = Reason


# ---------------------------------------------------------------- 守卫

def _hidden(conn, actor, action):
    code = authz.check(conn, actor, action)
    if code in HIDDEN:
        raise ApiError('resource_not_found')
    if code:
        raise ApiError(code)


def governor_ctx(ctx: Ctx = Depends(get_ctx)) -> Ctx:
    """治理员读接口。顺带跑一次到期清扫（worker 还没有定时钩子，见回执）。"""
    _hidden(ctx.db.conn(), ctx.actor, 'gov.queue.read')
    _sweep(ctx)
    return ctx


def governor_write_ctx(ctx: Ctx = Depends(governor_ctx)) -> Ctx:
    limit(ctx.request, 'write', ctx.actor.id)
    return ctx


def reviewer_ctx(ctx: Ctx = Depends(get_ctx)) -> Ctx:
    _hidden(ctx.db.conn(), ctx.actor, 'gov.appeal.review')
    _sweep(ctx)
    return ctx


def volunteer_ctx(ctx: Ctx = Depends(get_ctx)) -> Ctx:
    _hidden(ctx.db.conn(), ctx.actor, 'gov.volunteer.hide')
    _sweep(ctx)
    return ctx


def _sweep(ctx):
    with ctx.db.write() as conn:
        service.sweep(conn, ctx.settings)


def _require(conn, actor, action):
    _hidden(conn, actor, action)


def _run(ctx, body, action, fn, status=200):
    def work(conn):
        _require(conn, ctx.actor, action)
        return status, ok(ctx, fn(conn))
    return idempotency.run(ctx, body, work, required=True)


@admin_router.post('/sanctions')
def admin_sanction(body: AdminSanctionIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor, write=True)
    with ctx.db.write() as w:
        if body.principal_id:
            target = w.execute('SELECT id, status FROM principal WHERE id = ?', (body.principal_id,)).fetchone()
        elif body.handle:
            target = w.execute('SELECT p.id, p.status FROM credential c JOIN principal p ON p.id = c.principal_id '
                               'WHERE lower(c.handle) = lower(?)', (body.handle,)).fetchone()
        else:
            raise ApiError('validation_failed', 'principal_id 或 handle 至少填一个')
        if target is None:
            raise ApiError('resource_not_found')
        if target['id'] == ctx.actor.id:
            raise ApiError('action_not_allowed', '不能处置自己的账号')
        expires_at = clock.iso(clock.now_ts() + body.duration_hours * 3600)
        if body.action == 'mute':
            case_id, _ = service.open_case(
                w, service.rulebook(w), source='manual', target_type='object',
                target_id=f"principal:{target['id']}", target_version=None, subject_id=target['id'],
                category='admin_sanction', actor_id=ctx.actor.id, request_id=ctx.request_id)
            result = service.act(w, ctx.settings, ctx.actor, case_id, 'rate_limit', body.reason,
                                 {'hours': body.duration_hours}, 'policy.community', ctx.request_id)
            result.update(action='mute', principal_id=target['id'], expires_at=expires_at)
        elif body.action == 'ban':
            previous = accounts.suspend(w, target['id'], ctx.actor.id, body.reason)
            result = {'action': 'ban', 'principal_id': target['id'], 'previous_status': previous,
                      'expires_at': expires_at}
        else:
            restored = accounts.unsuspend(w, target['id'], ctx.actor.id, body.reason)
            result = {'action': 'unban', 'principal_id': target['id'], 'status': restored, 'expires_at': None}
        audit.record(w, ctx.actor.id, 'governance.admin.sanction', 'principal', target['id'],
                     reason=body.reason, request_id=ctx.request_id,
                     meta={'action': body.action, 'duration_hours': body.duration_hours,
                           'expires_at': result.get('expires_at')})
    return ok(ctx, result)


# ---------------------------------------------------------------- 谁能看什么（前端用来决定显示哪些入口）

@router.get('/me')
def me(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    governor = authz.check(conn, ctx.actor, 'gov.queue.read')
    return ok(ctx, {'id': ctx.actor.id, 'governor': governor is None,
                    'totp_required': governor == 'totp_setup_required',
                    'reviewer': authz.can(conn, ctx.actor, 'gov.appeal.review'),
                    'volunteer': authz.can(conn, ctx.actor, 'gov.volunteer.hide'),
                    'can_report': authz.can(conn, ctx.actor, 'gov.report.create')})


# ---------------------------------------------------------------- 知识网 / 知识治理页（所有登录成员只读）

@router.get('/knowledge-graph')
def knowledge_graph(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    flags.gate(conn, 'kb.enabled')
    return ok(ctx, knowledge.graph(conn, ctx.actor, clock.now()))


# ---------------------------------------------------------------- 治理员：队列与事项

@router.get('/queue')
def queue(status: str = Query(default='active', max_length=16), risk: Optional[str] = Query(default=None, max_length=16),
          category: Optional[str] = Query(default=None, max_length=32),
          cursor: Optional[str] = Query(default=None, max_length=1024),
          limit_: Optional[int] = Query(default=None, alias='limit'), ctx: Ctx = Depends(governor_ctx)):
    size = pagination.page_size(limit_)
    qhash = pagination.query_hash('gov.queue', status, risk, category)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    conn = ctx.db.conn()
    rows = service.queue(conn, status, risk, category, after, size + 1)
    rows, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, rows, size,
                                        lambda r: [r['sla_due_at'], r['id']])
    return ok(ctx, [service.case_summary(conn, r) for r in rows], next_cursor=next_cursor)


@router.get('/cases/{case_id}')
def case_detail(case_id: str, ctx: Ctx = Depends(governor_ctx)):
    with ctx.db.write() as conn:
        data = service.case_detail(conn, ctx.actor, case_id)
        audit.record(conn, ctx.actor.id, 'gov.case.view', 'gov_case', case_id, request_id=ctx.request_id)
    return ok(ctx, data)


@router.get('/cases/{case_id}/preview')
def case_preview(case_id: str, asset_id: str = Query(min_length=1, max_length=64),
                 ctx: Ctx = Depends(get_ctx)):
    error = None
    with ctx.db.write() as conn:
        try:
            _hidden(conn, ctx.actor, 'gov.case.preview')
            url, object_id = service.case_preview_url(conn, ctx.settings, case_id, asset_id)
        except ApiError as exc:
            error = exc
            # Do not copy unverified caller-supplied identifiers or exception text into the audit.
            audit.record(conn, ctx.actor.id, 'gov.case.preview', 'gov_case', outcome='denied',
                         reason=exc.code, request_id=ctx.request_id)
        else:
            audit.record(conn, ctx.actor.id, 'gov.case.preview', 'gov_case', case_id,
                         reason='case_review', request_id=ctx.request_id,
                         meta={'object_id': object_id, 'asset_id': asset_id})
    if error:
        raise error
    return ok(ctx, {'content_url': url})


@router.post('/cases', status_code=201)
def manual_case(body: ManualCaseIn, ctx: Ctx = Depends(governor_write_ctx)):
    return _run(ctx, body.model_dump(), 'gov.case.act',
                lambda conn: {'case_id': service.manual_case(conn, ctx.actor, body.target_id, body.category,
                                                             body.note, ctx.request_id)}, 201)


@router.post('/cases/{case_id}/assign')
def assign(case_id: str, body: AssignIn, ctx: Ctx = Depends(governor_write_ctx)):
    def fn(conn):
        service.assign(conn, ctx.actor, case_id, body.assignee_id, ctx.request_id)
        return {'case_id': case_id, 'assigned': True}
    return _run(ctx, body.model_dump(), 'gov.case.act', fn)


@router.post('/cases/{case_id}/actions')
def act(case_id: str, body: ActIn, ctx: Ctx = Depends(governor_write_ctx)):
    return _run(ctx, body.model_dump(), 'gov.case.act',
                lambda conn: service.act(conn, ctx.settings, ctx.actor, case_id, body.type, body.reason, body.params,
                                         body.rule_id, ctx.request_id))


@router.post('/cases/{case_id}/dismiss')
def dismiss(case_id: str, body: ReasonIn, ctx: Ctx = Depends(governor_write_ctx)):
    def fn(conn):
        service.dismiss(conn, ctx.settings, ctx.actor, case_id, body.reason, ctx.request_id)
        return {'case_id': case_id, 'status': 'dismissed'}
    return _run(ctx, body.model_dump(), 'gov.case.act', fn)


@router.post('/actions/{action_id}/confirm')
def confirm(action_id: str, ctx: Ctx = Depends(governor_write_ctx)):
    return _run(ctx, {}, 'gov.case.act',
                lambda conn: service.confirm(conn, ctx.settings, ctx.actor, action_id, ctx.request_id))


@router.post('/actions/{action_id}/cancel')
def cancel(action_id: str, body: ReasonIn, ctx: Ctx = Depends(governor_write_ctx)):
    def fn(conn):
        service.cancel(conn, ctx.actor, action_id, body.reason, ctx.request_id)
        return {'action_id': action_id, 'state': 'cancelled'}
    return _run(ctx, body.model_dump(), 'gov.case.act', fn)


@router.post('/actions/{action_id}/revert')
def revert(action_id: str, body: ReasonIn, ctx: Ctx = Depends(governor_write_ctx)):
    def fn(conn):
        row = conn.execute('SELECT case_id FROM gov_action WHERE id = ?', (action_id,)).fetchone()
        if row is None:
            raise ApiError('resource_not_found')
        service._require_no_conflict(conn, ctx.actor.id, service._case(conn, row['case_id']))
        restore_id = service.revert(conn, ctx.settings, action_id, actor_id=ctx.actor.id, reason=body.reason,
                                    request_id=ctx.request_id)
        return {'action_id': action_id, 'state': 'reverted', 'restore_action_id': restore_id}
    return _run(ctx, body.model_dump(), 'gov.case.act', fn)


# ---------------------------------------------------------------- 治理员：规则、统计、开关、检测器

@router.get('/rules')
def rules_list(ctx: Ctx = Depends(governor_ctx)):
    book = service.rulebook(ctx.db.conn())
    order = {'detector': 0, 'context': 1, 'agent': 2, 'policy': 3}
    return ok(ctx, [service.rule_dto(r) for r in sorted(book.values(), key=lambda r: (order[r['kind']], r['id']))])


@router.patch('/rules/{rule_id}')
def rule_edit(rule_id: str, body: RuleIn, ctx: Ctx = Depends(governor_write_ctx)):
    changes = body.model_dump(exclude_unset=True)
    reason = changes.pop('reason')
    return _run(ctx, body.model_dump(), 'gov.rule.edit',
                lambda conn: service.update_rule(conn, ctx.actor.id, rule_id, changes, reason, ctx.request_id))


@router.get('/rules/{rule_id}/history')
def rule_history(rule_id: str, ctx: Ctx = Depends(governor_ctx)):
    return ok(ctx, service.rule_history(ctx.db.conn(), rule_id))


@router.get('/stats')
def stats(ctx: Ctx = Depends(governor_ctx)):
    return ok(ctx, service.stats(ctx.db.conn()))


@router.get('/detectors')
def detector_list(ctx: Ctx = Depends(governor_ctx)):
    from . import detectors
    return ok(ctx, detectors.describe(ctx.db.conn()))


@router.post('/premoderation')
def premoderation(body: PremodIn, ctx: Ctx = Depends(governor_write_ctx)):
    if body.confirm != '先审后发':
        raise ApiError('validation_failed', '请输入「先审后发」确认')
    return _run(ctx, body.model_dump(), 'gov.premoderation.set',
                lambda conn: service.set_premoderation(conn, ctx.actor, body.enabled, body.reason, ctx.request_id))


# ---------------------------------------------------------------- L5 申诉复核

@router.get('/appeals')
def appeal_list(state: str = Query(default='submitted', pattern='^(submitted|upheld|overturned)$'),
                ctx: Ctx = Depends(reviewer_ctx)):
    rows = service.appeals(ctx.db.conn(), state)
    for r in rows:
        r['viewer_involved'] = ctx.actor.id in (r['appellant']['id'], r['action']['actor_id'],
                                                r['action']['second_actor_id'])
    return ok(ctx, rows)


@router.post('/appeals/{appeal_id}/decide')
def appeal_decide(appeal_id: str, body: DecideIn, ctx: Ctx = Depends(reviewer_ctx)):
    limit(ctx.request, 'write', ctx.actor.id)
    return _run(ctx, body.model_dump(), 'gov.appeal.review',
                lambda conn: service.decide_appeal(conn, ctx.settings, ctx.actor, appeal_id, body.outcome, body.reason,
                                                   ctx.request_id))


# ---------------------------------------------------------------- L3 骨干隐藏 L1 内容（需第二人）

@router.get('/volunteer/queue')
def volunteer_queue(ctx: Ctx = Depends(volunteer_ctx)):
    return ok(ctx, service.volunteer_queue(ctx.db.conn(), ctx.actor))


@router.post('/volunteer/hide')
def volunteer_hide(body: HideIn, ctx: Ctx = Depends(volunteer_ctx)):
    limit(ctx.request, 'write', ctx.actor.id)
    return _run(ctx, body.model_dump(), 'gov.volunteer.hide',
                lambda conn: service.volunteer_hide(conn, ctx.actor, body.object_id, body.reason, ctx.request_id))


@router.post('/volunteer/actions/{action_id}/confirm')
def volunteer_confirm(action_id: str, ctx: Ctx = Depends(volunteer_ctx)):
    limit(ctx.request, 'write', ctx.actor.id)
    return _run(ctx, {}, 'gov.volunteer.hide',
                lambda conn: service.volunteer_confirm(conn, ctx.actor, action_id, ctx.request_id))


# ---------------------------------------------------------------- 所有成员：举报、通知、申诉

@router.post('/reports', status_code=201)
def report(body: ReportIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        authz.require(conn, ctx.actor, 'gov.report.create')
        report_id, created = service.create_report(conn, ctx.actor, body.target_id, body.reason_code, body.note,
                                                   ctx.request_id)
        return (201 if created else 200), ok(ctx, {'id': report_id, 'created': created})
    return idempotency.run(ctx, body.model_dump(), work)


@router.get('/me/notices')
def my_notices(ctx: Ctx = Depends(user_ctx)):
    _sweep(ctx)
    return ok(ctx, service.my_notices(ctx.db.conn(), ctx.actor))


@router.post('/me/appeals', status_code=201)
def my_appeal(body: AppealIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        appeal_id = service.submit_appeal(conn, ctx.actor, body.action_id, body.statement, ctx.request_id)
        return 201, ok(ctx, {'id': appeal_id, 'state': 'submitted'})
    return idempotency.run(ctx, body.model_dump(), work)


class ComplaintIn(Strict):
    locator: str = Field(min_length=1, max_length=500)
    category: Literal['copyright', 'privacy', 'illegal', 'other']
    statement: str = Field(min_length=1, max_length=2000)


class ComplaintDecisionIn(Strict):
    state: Literal['reviewed', 'dismissed']
    reason: str = Reason


@router.post('/complaints', status_code=201)
def submit_complaint(body: ComplaintIn, ctx: Ctx = Depends(get_ctx)):
    # Origin/CSRF remain enforced by core middleware, including for anonymous users.
    limit(ctx.request, 'auth', 'complaint:' + ctx.ip)
    with ctx.db.write() as conn:
        return ok(ctx, complaints.submit(conn, body.locator, body.category, body.statement, ctx.request_id))


@router.get('/complaints')
def complaint_queue(state: Literal['pending', 'reviewed', 'dismissed'] = 'pending',
                    limit: int = Query(default=50, ge=1, le=200), ctx: Ctx = Depends(governor_ctx)):
    return ok(ctx, complaints.queue(ctx.db.conn(), state, limit))


@router.post('/complaints/{complaint_id}/decide')
def decide_complaint(complaint_id: str, body: ComplaintDecisionIn, ctx: Ctx = Depends(governor_write_ctx)):
    return _run(ctx, body.model_dump(), 'gov.case.act', lambda conn: complaints.decide(
        conn, ctx.actor, complaint_id, body.state, body.reason, ctx.request_id))


# ---------------------------------------------------------------- outbox 消费者与导出

def on_object(conn, event):
    if not service.installed(conn):
        return
    service.sweep(conn)
    if event['event_type'] in ('object.created', 'object.updated'):
        service.screen_object(conn, event['aggregate_id'], event.get('request_id'))


def on_media(conn, event):
    if service.installed(conn):
        service.screen_media_asset(conn, event['aggregate_id'], event.get('request_id'))


def sweep_due(db):
    with db.write() as conn:
        service.sweep(conn)


def run_agents(db):
    service.run_agent_jobs(db)


outbox.subscribe('governance.screen', 'object.*', on_object)
outbox.subscribe('governance.media', 'media.asset_ready', on_media)
outbox.subscribe('governance.chat_report', 'agentchat.reported', chat.on_reported)
outbox.subscribe('governance.dm_report', 'dm.reported', chat.on_reported)
outbox.subscribe('governance.buddy_post_report', 'social.buddy_post_reported', chat.on_reported)
outbox.subscribe('governance.buddy_invite_report', 'social.buddy_invite_reported', chat.on_reported)
accounts.register_exporter('governance', service.export)
accounts.register_purger(service.purge)
if hasattr(worker, 'register_periodic'):
    worker.register_periodic('governance.sweep', 60, sweep_due)
    worker.register_periodic('governance.agent_jobs', 30, run_agents)
