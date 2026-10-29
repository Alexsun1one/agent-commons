from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, idempotency, outbox, security, worker
from app.context import Ctx, ok, user_ctx, write_ctx
from app.security import limit

from modules.media import service as media

from . import contribute, service

router = APIRouter(prefix='/api/account')
admin_router = APIRouter(prefix='/api/admin/account')
outbox.subscribe('account.export', 'account.export_requested', service.on_export_requested)
outbox.subscribe('account.purge', 'principal.deleted', service.on_principal_deleted)
accounts.register_exporter('account_related_audit', lambda conn, actor: service.related_audit(conn, actor)
                           if service.installed(conn) else [])
accounts.register_exporter('account_exports', service.export_rows)
accounts.register_exporter('account_contributions', contribute.export_rows)
accounts.register_purger(service.purge)
worker.register_periodic('account.expire_exports', 300, service.expire_exports)


class AvatarIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    asset_id: str = Field(max_length=64)


class SensitiveIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    totp_code: Optional[str] = Field(default=None, max_length=6)
    password: Optional[str] = Field(default=None, max_length=128)


class VisibilityIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    scope: str = Field(max_length=16)


class DraftIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(max_length=80)
    kind: str = Field(max_length=16)
    summary: str = Field(max_length=240)
    body: str = Field(max_length=20000)


class DecideIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    decision: str = Field(max_length=16)
    note: Optional[str] = Field(default=None, max_length=300)


@router.post('/exports', status_code=202)
def request_export(ctx: Ctx = Depends(user_ctx)):
    """冷静期内（pending_deletion）也能导出，所以不走 write_ctx 的动作规则，只限流。"""
    limit(ctx.request, 'write', ctx.actor.id)
    storage = media.require_storage(ctx.request)
    with ctx.db.write() as conn:
        export_id, token = service.request_export(conn, storage, ctx.actor, ctx.request_id)
        data = service.export_status(conn, ctx.actor, export_id)
    data['download_url'] = f'/api/account/exports/{export_id}/download?token={token}'
    return JSONResponse(ok(ctx, data), 202)


@router.get('/exports/{export_id}')
def export_status(export_id: str, ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.export_status(ctx.db.conn(), ctx.actor, export_id))


@router.get('/exports/{export_id}/download')
def download(export_id: str, token: str = '', ctx: Ctx = Depends(user_ctx)):
    storage = media.require_storage(ctx.request)
    blob = service.take_download(ctx.db, storage, ctx.actor, export_id, token)
    return Response(blob, media_type='application/zip', headers={
        'Content-Disposition': 'attachment; filename="commons-export.zip"'})


@router.get('/deletion')
def deletion(ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.deletion_status(ctx.db.conn(), ctx.actor, ctx.settings.delete_cooldown_days))


@router.put('/avatar')
def set_avatar(body: AvatarIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.set_avatar(conn, ctx.actor, body.asset_id, ctx.request_id))


@router.delete('/avatar')
def clear_avatar(ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.set_avatar(conn, ctx.actor, None, ctx.request_id))


def _sensitive(ctx, body, work):
    security.limit(ctx.request, 'auth', f'account-sensitive:{ctx.actor.id}')
    return idempotency.run(ctx, body.model_dump(), work)


@router.get('/sessions')
def sessions(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.list_sessions(conn, ctx.actor, service.clean_ua(ctx.request)))


@router.post('/sessions/others/revoke')
def revoke_other_sessions(body: SensitiveIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        data = service.revoke_other_sessions(conn, ctx.actor, body.totp_code, body.password, ctx.request_id)
        return 200, ok(ctx, data)
    return _sensitive(ctx, body, work)


@router.post('/sessions/{session_id}/revoke')
def revoke_session(session_id: str, body: SensitiveIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        data = service.revoke_session(conn, ctx.actor, session_id, body.totp_code, body.password, ctx.request_id)
        return 200, ok(ctx, data)
    return _sensitive(ctx, body, work)


@router.post('/tokens/{token_id}/revoke')
def revoke_token(token_id: str, body: SensitiveIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        data = service.revoke_token(conn, ctx.actor, token_id, body.totp_code, body.password, ctx.request_id)
        return 200, ok(ctx, data)
    return _sensitive(ctx, body, work)


@router.get('/visibility')
def get_visibility(ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.visibility(ctx.db.conn(), ctx.actor))


@router.put('/visibility')
def put_visibility(body: VisibilityIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.set_visibility(conn, ctx.actor, body.scope, ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@router.get('/cards/{handle}')
def card(handle: str, ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.card_for(ctx.db.conn(), ctx.actor, handle))


@router.get('/contributions')
def contributions(cursor: Optional[str] = None, limit: Optional[int] = None, ctx: Ctx = Depends(user_ctx)):
    items, next_cursor = contribute.list_page(ctx.db.conn(), ctx.settings, ctx.actor, cursor, limit)
    return ok(ctx, {'items': items}, cursor=next_cursor)


@router.post('/contributions', status_code=201)
def create_contribution(body: DraftIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 201, ok(ctx, contribute.create(conn, ctx.actor, body.model_dump(), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@router.get('/contributions/{contribution_id}')
def read_contribution(contribution_id: str, ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, contribute.read(ctx.db.conn(), ctx.actor, contribution_id))


@router.put('/contributions/{contribution_id}')
def update_contribution(contribution_id: str, body: DraftIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, contribute.update(conn, ctx.request, ctx.actor, contribution_id, body.model_dump(),
                                               ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/contributions/{contribution_id}/review')
def review_contribution(contribution_id: str, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, contribute.submit_review(conn, ctx.request, ctx.actor, contribution_id, ctx.request_id))
    return idempotency.run(ctx, {'id': contribution_id}, work)


@router.post('/contributions/{contribution_id}/withdraw')
def withdraw_contribution(contribution_id: str, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, contribute.withdraw(conn, ctx.request, ctx.actor, contribution_id, ctx.request_id))
    return idempotency.run(ctx, {'id': contribution_id}, work)


@router.delete('/contributions/{contribution_id}')
def delete_contribution(contribution_id: str, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, contribute.remove(conn, ctx.request, ctx.actor, contribution_id, ctx.request_id))
    return idempotency.run(ctx, {'id': contribution_id}, work)


@admin_router.get('/contributions')
def admin_contributions(status: str = 'review', cursor: Optional[str] = None, limit: Optional[int] = None,
                        ctx: Ctx = Depends(user_ctx)):
    items, next_cursor = contribute.admin_page(ctx.db.conn(), ctx.settings, ctx.actor, status, cursor, limit)
    return ok(ctx, {'items': items}, cursor=next_cursor)


@admin_router.post('/contributions/{contribution_id}/decide')
def decide_contribution(contribution_id: str, body: DecideIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, contribute.decide(conn, ctx.actor, contribution_id, body.decision, ctx.request_id,
                                              note=body.note))
    return idempotency.run(ctx, {'id': contribution_id, **body.model_dump()}, work)

