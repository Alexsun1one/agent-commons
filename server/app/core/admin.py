from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from .. import accounts, flags, idempotency, security
from ..authz import require
from ..context import Ctx, ok, user_ctx

router = APIRouter(prefix='/api/admin')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class InviteIn(Strict):
    max_uses: int = Field(default=1, ge=1, le=1)
    expires_in_days: int = Field(default=7, ge=1, le=30)
    note: Optional[str] = Field(default=None, max_length=200)


class ResetCodeIn(Strict):
    handle: str = Field(max_length=32)


class RoleIn(Strict):
    handle: str = Field(max_length=32)
    role: str = Field(max_length=32)
    grant: bool = True
    space_id: Optional[str] = Field(default=None, max_length=64)


class FlagIn(Strict):
    key: str = Field(max_length=64)
    enabled: bool


def admin_ctx(ctx: Ctx = Depends(user_ctx)) -> Ctx:
    security.limit(ctx.request, 'admin', ctx.actor.id)
    return ctx


@router.post('/invites', status_code=201)
def issue_invite(body: InviteIn, ctx: Ctx = Depends(admin_ctx)):
    require(ctx.db.conn(), ctx.actor, 'admin.invite')
    def work(conn, code):
        require(conn, ctx.actor, 'admin.invite')
        invite_id, code, expires = accounts.issue_invite(conn, ctx.actor.id, body.max_uses, body.expires_in_days,
                                                         body.note, ctx.request_id, code=code)
        return 201, ok(ctx, {'id': invite_id, 'expires_at': expires, 'max_uses': body.max_uses})
    return accounts.issue_code_response(ctx, body.model_dump(), work)


@router.post('/invites/{invite_id}/revoke')
def revoke_invite(invite_id: str, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        require(conn, ctx.actor, 'admin.invite')
        accounts.revoke_invite(conn, invite_id, ctx.actor.id, ctx.request_id)
        return 200, ok(ctx, {'id': invite_id, 'revoked': True})
    return idempotency.run(ctx, {}, work)


@router.post('/reset-codes', status_code=201)
def issue_reset_code(body: ResetCodeIn, ctx: Ctx = Depends(admin_ctx)):
    require(ctx.db.conn(), ctx.actor, 'admin.reset_code')
    def work(conn, code):
        require(conn, ctx.actor, 'admin.reset_code')
        pid = accounts.principal_by_handle(conn, body.handle.strip().lower())
        code, expires = accounts.issue_reset_code(conn, ctx.actor.id, pid, request_id=ctx.request_id, code=code)
        return 201, ok(ctx, {'principal_id': pid, 'expires_at': expires})
    return accounts.issue_code_response(ctx, body.model_dump(), work)


@router.post('/roles')
def set_role(body: RoleIn, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        require(conn, ctx.actor, 'admin.roles')
        pid = accounts.principal_by_handle(conn, body.handle.strip().lower())
        accounts.set_role(conn, ctx.actor.id, pid, body.role, body.grant, body.space_id, ctx.request_id)
        return 200, ok(ctx, {'principal_id': pid, 'role': body.role, 'granted': body.grant})
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/flags')
def set_flag(body: FlagIn, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        require(conn, ctx.actor, 'admin.flags')
        flags.set_flag(conn, body.key, body.enabled, ctx.actor.id, ctx.request_id)
        return 200, ok(ctx, {'key': body.key, 'enabled': body.enabled})
    return idempotency.run(ctx, body.model_dump(), work)
