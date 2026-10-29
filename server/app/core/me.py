from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .. import accounts, audit, security
from ..context import Ctx, ok, user_ctx, write_ctx
from ..errors import ApiError
from .auth import me_payload

router = APIRouter(prefix='/api/me')


class DeleteIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    password: str = Field(max_length=128)


@router.get('')
def me(ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, me_payload(ctx.db.conn(), ctx.actor))


@router.get('/export')
def export(ctx: Ctx = Depends(user_ctx)):
    security.limit(ctx.request, 'write', ctx.actor.id)
    data = accounts.export(ctx.db.conn(), ctx.actor)
    audit.record_now(ctx.db, ctx.actor.id, 'account.export', 'principal', ctx.actor.id, request_id=ctx.request_id)
    return JSONResponse(ok(ctx, data), headers={'Content-Disposition': 'attachment; filename="commons-export.json"'})


@router.post('/delete')
def request_delete(body: DeleteIn, ctx: Ctx = Depends(write_ctx)):
    if ctx.actor.status != 'active':
        raise ApiError('state_conflict', '账号已在注销冷静期')
    with ctx.db.write() as conn:
        cred = conn.execute('SELECT password_hash FROM credential WHERE principal_id = ?', (ctx.actor.id,)).fetchone()
        if not security.verify_password(body.password, cred[0]):
            raise ApiError('invalid_credentials')
        purge_after = accounts.request_deletion(conn, ctx.settings, ctx.actor, ctx.request_id)
        accounts.revoke_sessions(conn, ctx.actor.id, keep=ctx.actor.session_id)
    return ok(ctx, {'status': 'pending_deletion', 'purge_after': purge_after})


@router.post('/delete/cancel')
def cancel_delete(ctx: Ctx = Depends(write_ctx)):
    if ctx.actor.status != 'pending_deletion':
        raise ApiError('state_conflict', '账号不在注销冷静期')
    with ctx.db.write() as conn:
        accounts.cancel_deletion(conn, ctx.actor, ctx.request_id)
    return ok(ctx, {'status': 'active'})
