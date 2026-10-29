"""R13 BOUNTY-1 · 求助悬赏、推广试用任务、积分。只有积分、外观奖励和自备权益记录；现金和实物返回 501。
积分只能花在悬赏和追加悬赏上，没有成员之间转账的接口。"""
import re
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, authz, clock, errors, flags, idempotency, outbox, pagination
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from modules.admin import params as admin_params
from modules.admin import access as admin_access

from . import hooks, jobs, logic, service  # noqa: F401 — register jobs and deletion cleanup

router = APIRouter(prefix='/api/bounty')
admin_router = APIRouter(prefix='/api/admin/bounty')

errors.register('credits_insufficient', 409, '可用积分不够')
errors.register('bounty_cap_exceeded', 422, '超过了你这个等级的悬赏上限')
errors.register('bounty_limit_reached', 409, '已经到了同时进行或每周发布的上限')
errors.register('promo_task_refused', 422, '这个任务不符合推广规则')


@admin_router.get('/credits')
def admin_credits(kind: Optional[str] = None, principal_id: Optional[str] = None,
                  from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                  limit: Optional[int] = None, cursor: Optional[str] = None,
                  ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    if kind and kind not in ('grant', 'hold', 'release', 'award', 'refund', 'reverse'):
        raise ApiError('validation_failed', '积分流水类型不在允许范围内')
    start, end = admin_access.window(from_, to)
    size, qhash, after = admin_access.page_state(
        ctx, 'bounty.credits', limit, cursor, kind, principal_id, start, end)
    where, args = ['1=1'], {}
    for clause, value, key in (("e.kind = :kind", kind, 'kind'),
                               ("e.principal_id = :principal", principal_id, 'principal'),
                               ("e.created_at >= :start", start, 'start'), ("e.created_at < :end", end, 'end')):
        if value:
            where.append(clause)
            args[key] = value
    if after:
        where.append('(e.created_at, e.id) < (:after_at, :after_id)')
        args.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT e.id, e.principal_id, c.handle, p.display_name, e.kind, e.amount, e.held_delta, e.bounty_id, '
        'e.source_type, e.source_ref, e.season, e.actor_id, e.reason_code, e.created_at '
        'FROM credit_entry e LEFT JOIN credential c ON c.principal_id = e.principal_id '
        'LEFT JOIN profile p ON p.principal_id = e.principal_id WHERE ' + ' AND '.join(where) +
        ' ORDER BY e.created_at DESC, e.id DESC LIMIT :n', {**args, 'n': size + 1}).fetchall()
    rows, next_cursor = admin_access.finish_page(ctx, qhash, rows, size,
                                                  lambda row: [row['created_at'], row['id']])
    summary = conn.execute('SELECT coalesce(sum(amount), 0) AS available, coalesce(sum(held_delta), 0) AS held, '
                           'count(DISTINCT principal_id) AS members FROM credit_entry').fetchone()
    admin_access.record_view(ctx, 'bounty.admin.credits.view', 'credit_entry',
                             meta={'kind': kind, 'principal_id': principal_id})
    return ok(ctx, {'summary': dict(summary), 'items': [dict(row) for row in rows]}, next_cursor=next_cursor)


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RewardIn(Strict):
    type: Literal['credits', 'cosmetic', 'perk', 'cash', 'goods']
    amount: Optional[int] = Field(default=None, ge=1, le=100000)
    id: Optional[str] = Field(default=None, max_length=40)
    note: Optional[str] = Field(default=None, max_length=200)


class CreateIn(Strict):
    kind: Literal['help', 'promo']
    object_id: str = Field(max_length=64)
    days: int = Field(ge=1, le=14)
    rewards: List[RewardIn] = Field(default_factory=list, max_length=5)


class TopupIn(Strict):
    amount: int = Field(ge=1, le=100000)


class PickIn(Strict):
    answer_id: str = Field(max_length=64)
    share: int = Field(ge=1, le=100)


class AwardIn(Strict):
    picks: List[PickIn] = Field(min_length=1, max_length=logic.MAX_SPLIT)


class TaskIn(Strict):
    title: str = Field(min_length=1, max_length=80)
    kind: Literal['feedback', 'bug', 'review', 'recording']
    description: str = Field(min_length=1, max_length=1000)
    max_claims: int = Field(ge=1, le=50)
    rewards: List[RewardIn] = Field(min_length=1, max_length=3)


class SubmitIn(Strict):
    body: str = Field(min_length=10, max_length=4000)
    evidence_object_id: Optional[str] = Field(default=None, max_length=64)


class DecideIn(Strict):
    reason_code: Optional[str] = Field(default=None, max_length=32)


class RuleIn(Strict):
    category: Optional[str] = Field(default=None, pattern=r'^[a-z][a-z_]{2,23}$')
    pattern: Optional[str] = Field(default=None, min_length=1, max_length=400)
    message: Optional[str] = Field(default=None, min_length=4, max_length=200)
    enabled: Optional[bool] = None
    reason_code: str = Field(max_length=32)


def gate(conn, promo=False):
    flags.gate(conn, 'bounty.enabled')
    if promo:
        flags.gate(conn, 'bounty.promo.enabled')


def lazy_settle(ctx, bounty_ids=None):
    conn = ctx.db.conn()
    if service.due_ids(conn, clock.now(), 1, bounty_ids):
        with ctx.db.write() as w:
            service.settle_due(w, limit=50, request_id=ctx.request_id)


def money(ctx, body, work):
    return idempotency.run(ctx, body, work, required=True)


# ---------------------------------------------------------------- 读

@router.get('/wallet')
def get_wallet(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    lazy_settle(ctx)
    if service.season_grant_due(conn, ctx.actor.id, ctx.actor.level):
        with ctx.db.write() as w:
            service.ensure_season_grant(w, ctx.actor.id, ctx.actor.level)
    return ok(ctx, service.wallet(conn, ctx.actor))


def _min_levels(conn):
    """发布、推广、追加的等级门槛读 action_rule；赛季积分、「有用」资格是 logic 里的常量，一并给前端。"""
    out = {}
    for key, action in (('create_help', 'bounty.create.help'), ('create_promo', 'bounty.create.promo'),
                        ('topup', 'bounty.topup')):
        rule = authz.rule(conn, action)
        out[key] = rule['min_level'] if rule else None
    out.update(season_grant=logic.SEASON_GRANT_MIN_LEVEL, useful_giver=logic.USEFUL_MIN_LEVEL,
               useful_account_days=logic.USEFUL_MIN_ACCOUNT_DAYS)
    return out


@router.get('/rules')
def get_rules(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    governor = bool({'admin', 'governor'} & set(ctx.actor.roles))
    rules = [{k: r[k] for k in ('id', 'category', 'message', 'enabled', 'version')}
             | ({'pattern': r['pattern']} if governor else {}) for r in service.promo_rules(conn)]
    return ok(ctx, {
        'caps': {f'L{k}': v for k, v in logic.CAPS.items()},
        'concurrent': {f'L{k}': v for k, v in logic.CONCURRENT.items()},
        'min_credits': int(admin_params.value(conn, 'bounty', 'minimum_credits', logic.MIN_CREDITS)),
        'max_split': logic.MAX_SPLIT, 'grace_hours': logic.GRACE_SECONDS // 3600,
        'promo_per_week': logic.PROMO_PER_WEEK, 'season_grant': logic.SEASON_GRANT,
        'reward_types': [{'type': t, 'available': t not in logic.UNAVAILABLE_REWARDS} for t in logic.REWARD_TYPES],
        'cosmetics': [{'id': k, 'kind': v[0], 'label': v[1]} for k, v in logic.COSMETICS.items()],
        'task_kinds': [{'id': k, 'label': v} for k, v in logic.TASK_KINDS.items()],
        'promo_rules': rules,
        'min_levels': _min_levels(conn),
    })


@router.get('/list')
def list_bounties(kind: Optional[Literal['help', 'promo']] = None,
                  status: Optional[Literal['active', 'judging', 'closed']] = None,
                  object_id: Optional[str] = None, mine: bool = False, limit: Optional[int] = None,
                  cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('bounty.list', kind, status, object_id, mine)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    lazy_settle(ctx)
    now = clock.now()
    rows = service.list_rows(conn, ctx.actor, kind=kind, status=status, object_id=object_id, mine=mine, after=after,
                             limit=size + 1, now=now)
    rows, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, rows, size,
                                        lambda r: [r['created_at'], r['id']])
    return ok(ctx, [service.dto(r, ctx.actor, now) for r in rows], next_cursor=next_cursor)


@router.get('/{bounty_id}')
def get_bounty(bounty_id: str, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    service.load(conn, ctx.actor, bounty_id)
    lazy_settle(ctx, [bounty_id])
    return ok(ctx, service.detail(conn, ctx.actor, bounty_id))


# ---------------------------------------------------------------- 写（托管和发放必须带 Idempotency-Key）

@router.post('', status_code=201)
def create_bounty(body: CreateIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn(), promo=body.kind == 'promo')

    def work(conn):
        bounty_id = service.create(conn, ctx.actor, body.model_dump(), ctx.request_id)
        return 201, ok(ctx, service.detail(conn, ctx.actor, bounty_id))
    return money(ctx, body.model_dump(), work)


@router.post('/{bounty_id}/topup')
def topup_bounty(bounty_id: str, body: TopupIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())

    def work(conn):
        service.topup(conn, ctx.actor, bounty_id, body.amount, ctx.request_id)
        return 200, ok(ctx, service.detail(conn, ctx.actor, bounty_id))
    return money(ctx, body.model_dump(), work)


@router.post('/{bounty_id}/award')
def award_bounty(bounty_id: str, body: AwardIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn())

    def work(conn):
        awards, pool = service.award(conn, ctx.actor, bounty_id, body.model_dump()['picks'], ctx.request_id)
        return 200, ok(ctx, service.detail(conn, ctx.actor, bounty_id), awarded=pool)
    return money(ctx, body.model_dump(), work)


@router.post('/{bounty_id}/promo/tasks', status_code=201)
def add_task(bounty_id: str, body: TaskIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn(), promo=True)

    def work(conn):
        task_id = service.add_task(conn, ctx.actor, bounty_id, body.model_dump(), ctx.request_id)
        return 201, ok(ctx, service.detail(conn, ctx.actor, bounty_id), task_id=task_id)
    return money(ctx, body.model_dump(), work)


@router.post('/tasks/{task_id}/submit', status_code=201)
def submit_task(task_id: str, body: SubmitIn, ctx: Ctx = Depends(write_ctx)):
    gate(ctx.db.conn(), promo=True)

    def work(conn):
        sub_id = service.submit(conn, ctx.actor, task_id, body.model_dump(), ctx.request_id)
        return 201, ok(ctx, {'id': sub_id, 'task_id': task_id, 'status': 'pending'})
    return idempotency.run(ctx, body.model_dump(), work)


def _decide(ctx, sub_id, accept, body):
    gate(ctx.db.conn(), promo=True)

    def work(conn):
        award_id = service.decide_submission(conn, ctx.actor, sub_id, accept, body.reason_code, ctx.request_id)
        return 200, ok(ctx, {'id': sub_id, 'status': 'accepted' if accept else 'rejected', 'award_id': award_id})
    return money(ctx, body.model_dump(), work)


@router.post('/submissions/{sub_id}/accept')
def accept_submission(sub_id: str, body: Optional[DecideIn] = None, ctx: Ctx = Depends(write_ctx)):
    return _decide(ctx, sub_id, True, body or DecideIn())


@router.post('/submissions/{sub_id}/reject')
def reject_submission(sub_id: str, body: DecideIn, ctx: Ctx = Depends(write_ctx)):
    return _decide(ctx, sub_id, False, body)


def _respond(ctx, promise_id, confirm, body):
    gate(ctx.db.conn())

    def work(conn):
        status = service.respond_promise(conn, ctx.actor, promise_id, confirm, body.reason_code, ctx.request_id)
        return 200, ok(ctx, {'id': promise_id, 'status': status})
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/promises/{promise_id}/confirm')
def confirm_promise(promise_id: str, body: Optional[DecideIn] = None, ctx: Ctx = Depends(write_ctx)):
    return _respond(ctx, promise_id, True, body or DecideIn())


@router.post('/promises/{promise_id}/dispute')
def dispute_promise(promise_id: str, body: DecideIn, ctx: Ctx = Depends(write_ctx)):
    return _respond(ctx, promise_id, False, body)


@router.post('/rules/{rule_id}')
def update_rule(rule_id: str, body: RuleIn, ctx: Ctx = Depends(write_ctx)):
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,40}', rule_id):
        raise ApiError('validation_failed', '规则编号格式不对')

    def work(conn):
        version = service.update_rule(conn, ctx.actor, rule_id, body.model_dump(), ctx.request_id)
        return 200, ok(ctx, {'id': rule_id, 'version': version})
    return idempotency.run(ctx, body.model_dump(), work)


# ---------------------------------------------------------------- 事件与导出

outbox.subscribe('bounty.credits', 'ledger.*', service.on_ledger)
outbox.subscribe('bounty.object_state', 'object.*', service.on_object)
outbox.subscribe('bounty.useful', 'content.useful_*', service.on_useful)
accounts.register_exporter('bounty', service.export)
