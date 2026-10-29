import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, audit, clock, errors, flags, outbox
from app.authz import require
from app.context import Ctx, get_ctx, ok, user_ctx, write_ctx
from app.errors import ApiError

from . import jobs, pipeline, service  # noqa: F401

router = APIRouter(prefix='/api/media')
errors.register('upload_rejected', 422, '文件无法接受')
outbox.subscribe('media.process', 'media.upload_completed', service.on_upload_completed)
outbox.subscribe('media.attach', 'object.*', service.on_object_changed)
outbox.subscribe('media.purge', 'principal.deleted', service.on_principal_deleted)
outbox.subscribe('media.files', 'media.files_purge', service.on_files_purge)
outbox.subscribe_external('media.rooms_cleanup', 'rooms.storage_cleanup_requested',
                          service.on_rooms_storage_cleanup)
accounts.register_exporter('media', lambda conn, actor: service.export_rows(conn, actor)
                           if service.installed(conn) else {})
accounts.register_purger(service.purge_for_account)
FILE = re.compile(r'([0-9a-f]{64})\.(webp|jpg|avif)\Z')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Crop(Strict):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    size: int = Field(ge=1)


class UploadIn(Strict):
    purpose: Literal['image', 'avatar', 'html', 'thumbnail']
    filename: str = Field(min_length=1, max_length=200)
    size: int = Field(ge=1, le=64 * 1024 * 1024)
    sha256: str = Field(min_length=64, max_length=64)
    crop: Optional[Crop] = None
    for_asset: Optional[str] = Field(default=None, max_length=64)
    data: Optional[str] = Field(default=None, max_length=1_500_000)


class ChunkIn(Strict):
    data: str = Field(max_length=1_500_000)


class QuotaIn(Strict):
    daily_count: int = Field(ge=0, le=10000)
    max_bytes: int = Field(ge=0, le=64 * 1024 * 1024)


@router.get('/quota')
def my_quota(ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.quota_status(ctx.db.conn(), ctx.actor))


@router.post('/uploads', status_code=201)
def create_upload(body: UploadIn, ctx: Ctx = Depends(write_ctx)):
    flags.gate(ctx.db.conn(), 'media.uploads')
    storage = service.require_storage(ctx.request)
    raw = service.decode_chunk(body.data) if body.data is not None else None
    if raw is not None and len(raw) != body.size:
        raise ApiError('validation_failed', '随创建一起带 data 时，data 必须是整个文件（≤ 1 MiB）')
    with ctx.db.write() as conn:
        upload_id = service.create_upload(conn, storage, ctx.actor, purpose=body.purpose, filename=body.filename,
                                          size=body.size, sha256=body.sha256,
                                          crop=body.crop.model_dump() if body.crop else None,
                                          for_asset=body.for_asset, request_id=ctx.request_id)
        if raw is not None:
            service.put_chunk(conn, ctx.actor, upload_id, 0, raw)
    if raw is not None:
        data = service.complete(ctx.db, storage, ctx.actor, upload_id, ctx.request_id)
        return JSONResponse(ok(ctx, data), 202)
    return JSONResponse(ok(ctx, service.upload_status(ctx.db.conn(), ctx.actor, upload_id)), 201)


@router.put('/uploads/{upload_id}/chunks/{idx}')
def put_chunk(upload_id: str, idx: int, body: ChunkIn, ctx: Ctx = Depends(write_ctx)):
    flags.gate(ctx.db.conn(), 'media.uploads')
    raw = service.decode_chunk(body.data)
    with ctx.db.write() as conn:
        return ok(ctx, service.put_chunk(conn, ctx.actor, upload_id, idx, raw))


@router.post('/uploads/{upload_id}/complete', status_code=202)
def complete_upload(upload_id: str, ctx: Ctx = Depends(write_ctx)):
    flags.gate(ctx.db.conn(), 'media.uploads')
    storage = service.require_storage(ctx.request)
    return ok(ctx, service.complete(ctx.db, storage, ctx.actor, upload_id, ctx.request_id))


@router.get('/uploads/{upload_id}')
def upload_status(upload_id: str, ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.upload_status(ctx.db.conn(), ctx.actor, upload_id))


@router.get('/assets')
def assets(ids: str = '', ctx: Ctx = Depends(user_ctx)):
    wanted = [i for i in ids.split(',') if i][:50]
    return ok(ctx, service.assets_meta(ctx.db.conn(), ctx.actor, wanted, ctx.settings.content_origin))


@router.get('/assets/{asset_id}')
def asset(asset_id: str, ctx: Ctx = Depends(user_ctx)):
    found = service.assets_meta(ctx.db.conn(), ctx.actor, [asset_id], ctx.settings.content_origin)
    if asset_id not in found:
        raise ApiError('resource_not_found')
    return ok(ctx, found[asset_id])


@router.get('/assets/{asset_id}/html')
def asset_html(asset_id: str, request: Request, ctx: Ctx = Depends(user_ctx)):
    row = service.readable_asset(ctx.db.conn(), ctx.actor, asset_id)
    if row is None or row['purpose'] != 'html':
        raise ApiError('resource_not_found')
    storage = service.require_storage(request)
    html = storage.read(row['file_key']).decode('utf-8-sig')
    meta = service.asset_dto(row, [], ctx.settings.content_origin)
    return ok(ctx, {'id': asset_id, 'html': html, 'bytes': row['bytes'], 'check': meta['check'],
                    'content_url': meta['content_url']})


def _etag_matches(header, etag):
    if not header:
        return False
    return header.strip() == '*' or etag in [t.strip().removeprefix('W/') for t in header.split(',')]


@router.get('/f/{name}')
def media_file(name: str, request: Request, ctx: Ctx = Depends(get_ctx)):
    m = FILE.match(name)
    if not m or service.readable_variant(ctx.db.conn(), ctx.actor, m.group(1), m.group(2)) is None:
        raise ApiError('resource_not_found')
    sha, ext = m.groups()
    headers = {'ETag': f'"{sha}"', 'Cache-Control': service.CACHE_PRIVATE, 'Content-Disposition': 'inline',
               'Cross-Origin-Resource-Policy': 'same-origin', 'Vary': 'Cookie'}
    if _etag_matches(request.headers.get('if-none-match'), headers['ETag']):
        return Response(status_code=304, headers=headers)
    storage = service.require_storage(request)
    try:
        body = storage.read(f'{service.EXT_KIND[ext]}/{sha}')
    except FileNotFoundError:
        raise ApiError('resource_not_found') from None
    return Response(body, media_type=pipeline.MIME[ext], headers=headers)


@router.put('/quotas/{bucket}/{level}')
def set_quota(bucket: Literal['file', 'avatar'], level: int, body: QuotaIn, ctx: Ctx = Depends(write_ctx)):
    if not 1 <= level <= 5:
        raise ApiError('validation_failed', 'level 要在 1 到 5 之间')
    with ctx.db.write() as conn:
        require(conn, ctx.actor, 'media.quota.edit')
        conn.execute('UPDATE media_quota SET daily_count = ?, max_bytes = ?, updated_at = ?, updated_by = ? '
                     'WHERE bucket = ? AND level = ?',
                     (body.daily_count, body.max_bytes, clock.now(), ctx.actor.id, bucket, level))
        audit.record(conn, ctx.actor.id, 'media.quota.edit', 'media_quota', f'{bucket}:{level}',
                     request_id=ctx.request_id, meta={'daily_count': body.daily_count, 'max_bytes': body.max_bytes})
    return ok(ctx, {'bucket': bucket, 'level': level, **body.model_dump()})
