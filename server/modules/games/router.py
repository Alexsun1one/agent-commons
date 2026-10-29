"""GAMES-1 API：乐园、模拟考场、猜提示词、抽签与抢沙发。"""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app import audit, flags, idempotency, outbox
from app.authz import require
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import register
from modules.admin import access as admin_access

from . import hooks, jobs, service  # noqa: F401


from . import privacy  # noqa: F401 — register member export

router = APIRouter(prefix='/api/games')
admin_router = APIRouter(prefix='/api/admin/games')

register('game_expired', 409, '考试时间已经结束')
register('game_already_submitted', 409, '这份试卷已经交过了')
register('game_already_played', 409, '今天这题已经答过了')


@admin_router.get('/questions')
def admin_questions(direction: Optional[str] = None, review_status: Optional[str] = None,
                    from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                    limit: Optional[int] = None, cursor: Optional[str] = None,
                    ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    if direction and direction not in service.DIRECTIONS:
        from app.errors import ApiError
        raise ApiError('validation_failed', '题目方向不在允许范围内')
    if review_status and review_status not in ('draft', 'reviewed'):
        from app.errors import ApiError
        raise ApiError('validation_failed', '题目状态不在允许范围内')
    start, end = admin_access.window(from_, to)
    size, qhash, after = admin_access.page_state(
        ctx, 'games.questions', limit, cursor, direction, review_status, start, end)
    where, args = ['1=1'], {}
    for clause, value, key in (("q.direction = :direction", direction, 'direction'),
                               ("q.review_status = :status", review_status, 'status'),
                               ("q.created_at >= :start", start, 'start'), ("q.created_at < :end", end, 'end')):
        if value:
            where.append(clause)
            args[key] = value
    if after:
        where.append('(q.created_at, q.id) < (:after_at, :after_id)')
        args.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT q.id, q.direction, q.kind, q.prompt, q.options_json, q.explanation, q.source_kind, q.source_id, '
        'q.source_route, q.review_status, q.sample, q.created_at FROM game_question q WHERE ' +
        ' AND '.join(where) + ' ORDER BY q.created_at DESC, q.id DESC LIMIT :n',
        {**args, 'n': size + 1}).fetchall()
    rows, next_cursor = admin_access.finish_page(ctx, qhash, rows, size,
                                                  lambda row: [row['created_at'], row['id']])
    admin_access.record_view(ctx, 'games.admin.questions.view', 'game_question',
                             meta={'direction': direction, 'status': review_status})
    return ok(ctx, [dict(row) for row in rows], next_cursor=next_cursor)


class ExamStartIn(BaseModel):
    direction: Optional[str] = None


class ExamSubmitIn(BaseModel):
    answers: Dict[str, List[str]]


class GuessIn(BaseModel):
    option_id: str = Field(min_length=1, max_length=80)


class PreferenceIn(BaseModel):
    playground_enabled: bool


def _gate(conn, actor, action='games.read'):
    flags.gate(conn, 'games.enabled')
    require(conn, actor, action)


@router.get('/home')
def get_home(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn, ctx.actor)
    return ok(ctx, service.home(conn, ctx.actor.id))


@router.get('/preferences')
def get_preferences(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn, ctx.actor)
    return ok(ctx, service.preference(conn, ctx.actor.id))


@router.post('/preferences')
def update_preferences(body: PreferenceIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _gate(conn, ctx.actor, 'games.preference')
        data = service.set_preference(conn, ctx.actor.id, body.playground_enabled)
        audit.record(conn, ctx.actor.id, 'games.preference', 'principal', ctx.actor.id,
                     request_id=ctx.request_id, meta={'playground_enabled': body.playground_enabled})
        return 200, ok(ctx, data)

    return idempotency.run(ctx, payload, work)


@router.get('/exams/leaderboard')
def get_exam_leaderboard(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn, ctx.actor)
    return ok(ctx, service.exam_leaderboard(conn))


@router.post('/exams', status_code=201)
def create_exam(body: Optional[ExamStartIn] = None, ctx: Ctx = Depends(write_ctx)):
    body = body or ExamStartIn()
    payload = body.model_dump()

    def work(conn):
        _gate(conn, ctx.actor, 'games.play')
        data = service.start_exam(conn, ctx.actor.id, body.direction)
        audit.record(conn, ctx.actor.id, 'games.exam.start', 'exam', data['id'], request_id=ctx.request_id,
                     meta={'direction': body.direction})
        return 201, ok(ctx, data)

    return idempotency.run(ctx, payload, work)


@router.get('/exams/{exam_id}')
def get_exam(exam_id: str, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn, ctx.actor)
    return ok(ctx, service.exam_view(conn, ctx.actor.id, exam_id))


@router.post('/exams/{exam_id}/submit')
def submit_exam(exam_id: str, body: ExamSubmitIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _gate(conn, ctx.actor, 'games.play')
        data = service.submit_exam(conn, ctx.actor.id, exam_id, body.answers)
        audit.record(conn, ctx.actor.id, 'games.exam.submit', 'exam', exam_id, request_id=ctx.request_id,
                     meta={'score': data['score']})
        return 200, ok(ctx, data)

    return idempotency.run(ctx, payload, work)


@router.get('/guess/today')
def get_guess(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.write() as conn:
        _gate(conn, ctx.actor)
        data = service.guess_today(conn, ctx.actor.id)
    return ok(ctx, data)


@router.post('/guess/{slot}')
def answer_guess(slot: int, body: GuessIn, ctx: Ctx = Depends(write_ctx)):
    if slot < 1 or slot > 5:
        from app.errors import ApiError
        raise ApiError('resource_not_found')
    payload = body.model_dump()

    def work(conn):
        _gate(conn, ctx.actor, 'games.play')
        data = service.answer_guess(conn, ctx.actor.id, slot, body.option_id)
        return 200, ok(ctx, data)

    return idempotency.run(ctx, payload, work)


@router.get('/draw')
def get_draw(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.write() as conn:
        _gate(conn, ctx.actor)
        data = service.draw_fortune(conn, ctx.actor.id)
    return ok(ctx, data)


@router.post('/draw')
def draw(ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        _gate(conn, ctx.actor, 'games.play')
        return 200, ok(ctx, service.draw_fortune(conn, ctx.actor.id))

    return idempotency.run(ctx, {}, work)


@router.get('/sofas/today')
def get_sofas(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn, ctx.actor)
    return ok(ctx, service.sofa_today(conn))


outbox.subscribe('games.sofa', 'object.created', service.on_object)

