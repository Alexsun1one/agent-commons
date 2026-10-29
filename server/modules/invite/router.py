"""R13 INVITE-1 · 成员邀请。成员路由在 /api/invite，规则调整在 /api/admin/invite。"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, flags, security
from fastapi.responses import JSONResponse
from app.authz import require
from app.context import Ctx, get_ctx, ok, user_ctx, write_ctx
from app.errors import ApiError

from . import hooks, service  # noqa: F401 — 导入即登记 outbox、清扫和注销清理

router = APIRouter(prefix='/api/invite')
admin_router = APIRouter(prefix='/api/admin/invite')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class IssueIn(Strict):
    note: Optional[str] = Field(default=None, max_length=200)


class RuleIn(Strict):
    level: Optional[int] = Field(default=None, ge=1, le=5)
    monthly_quota: Optional[int] = Field(default=None, ge=0, le=10000)
    key: Optional[str] = Field(default=None, max_length=64)
    value: Optional[int] = Field(default=None, ge=0, le=1_000_000)


def gate(conn):
    flags.gate(conn, 'invite.enabled')


@router.get('/me')
def get_me(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'invite.me.read')
    with ctx.db.write() as w:
        return ok(ctx, service.overview(w, ctx.actor))


@router.post('/codes', status_code=201)
def post_code(body: IssueIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'invite.issue')

    def work(w, code):
        issued = service.issue(w, ctx.actor, body.note, ctx.request_id, code=code)
        issued.pop('code')
        issued.pop('url')
        return 201, ok(ctx, issued)

    response = accounts.issue_code_response(ctx, body.model_dump(), work)
    payload = json.loads(response.body)
    payload['data']['url'] = f'#/hello?invite={payload["data"]["code"]}'
    headers = {'Idempotent-Replayed': 'true'} if response.headers.get('Idempotent-Replayed') else {}
    return JSONResponse(payload, response.status_code, headers=headers)


@router.get('/preview')
def get_preview(code: str = Query(min_length=1, max_length=64), ctx: Ctx = Depends(get_ctx)):
    gate(ctx.db.conn())
    security.hit(ctx.db, f'invite.preview:{ctx.ip}', 60, 60)
    with ctx.db.write() as w:
        data = service.preview(w, code)
    if data is None:
        raise ApiError('invite_invalid')
    return ok(ctx, data)


@router.post('/onboarding')
def post_onboarding(ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'invite.onboarding')
    with ctx.db.write() as w:
        return ok(ctx, service.note_onboarding(w, ctx.actor.id, ctx.request_id))


@admin_router.get('/rules')
def admin_rules(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    security.limit(ctx.request, 'admin', ctx.actor.id)
    require(conn, ctx.actor, 'invite.admin')
    return ok(ctx, service.rules(conn))


@admin_router.patch('/rules')
def admin_patch_rules(body: RuleIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    security.limit(ctx.request, 'admin', ctx.actor.id)
    require(conn, ctx.actor, 'invite.admin')
    with ctx.db.write() as w:
        return ok(ctx, service.update_rule(w, ctx.actor, body.model_dump(), ctx.request_id))
