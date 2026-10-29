from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .. import idempotency, objects, pagination
from ..authz import require
from ..context import Ctx, get_ctx, ok, write_ctx
from ..errors import ApiError

router = APIRouter(prefix='/api/objects')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ObjectIn(Strict):
    type: str = Field(max_length=32)
    title: str = Field(max_length=200)
    content: dict
    visibility: str = 'members'
    min_level: int = 1
    space_id: Optional[str] = Field(default=None, max_length=64)
    acl: List[str] = Field(default_factory=list, max_length=50)
    root_id: Optional[str] = Field(default=None, max_length=64)
    lifecycle: Literal['draft', 'active'] = 'active'


class ObjectPatch(Strict):
    title: Optional[str] = Field(default=None, max_length=200)
    content: Optional[dict] = None
    visibility: Optional[str] = None
    min_level: Optional[int] = None
    space_id: Optional[str] = Field(default=None, max_length=64)
    acl: Optional[List[str]] = Field(default=None, max_length=50)
    lifecycle: Optional[Literal['draft', 'active']] = None


class WithdrawIn(Strict):
    reason_code: str = Field(default='author_request', pattern=r'^[a-z][a-z0-9_.]{0,39}$')


def _filters(type, space_id, author_id, root_id):
    return {'type': type, 'space_id': space_id, 'author_id': author_id, 'root_id': root_id}


@router.get('')
def list_objects(type: Optional[str] = None, space_id: Optional[str] = None, author_id: Optional[str] = None,
                 root_id: Optional[str] = None, order: Literal['new', 'old'] = 'new', limit: Optional[int] = None,
                 cursor: Optional[str] = None, count: bool = False, ctx: Ctx = Depends(get_ctx)):
    size = pagination.page_size(limit)
    filters = _filters(type, space_id, author_id, root_id)
    qhash = pagination.query_hash('objects', filters, order)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    conn = ctx.db.conn()
    rows = objects.list_visible(conn, ctx.actor, filters, after, size + 1, newest_first=order == 'new')
    rows, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, rows, size,
                                        lambda r: [r['created_at'], r['id']])
    meta = {'next_cursor': next_cursor}
    if count:
        meta['count'] = objects.count_visible(conn, ctx.actor, filters)
    return ok(ctx, [objects.dto(r, ctx.actor) for r in rows], **meta)


@router.post('', status_code=201)
def create_object(body: ObjectIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        object_id = objects.create(conn, ctx.actor, request_id=ctx.request_id, **body.model_dump())
        row, data = objects.detail(conn, ctx.actor, object_id)
        return 201, ok(ctx, data, etag=data['etag'])
    return idempotency.run(ctx, body.model_dump(), work)


@router.get('/{object_id}')
def get_object(object_id: str, version: Optional[int] = None, ctx: Ctx = Depends(get_ctx)):
    row, data = objects.detail(ctx.db.conn(), ctx.actor, object_id, version)
    return JSONResponse(ok(ctx, data, etag=data['etag']), headers={'ETag': data['etag']})


@router.patch('/{object_id}')
def patch_object(object_id: str, body: ObjectPatch, if_match: Optional[str] = Header(default=None),
                 ctx: Ctx = Depends(write_ctx)):
    changes = body.model_dump(exclude_unset=True)

    def work(conn):
        row = objects.load_visible(conn, ctx.actor, object_id)
        objects.update(conn, ctx.actor, row, changes, if_match, ctx.request_id)
        _, data = objects.detail(conn, ctx.actor, object_id)
        return 200, ok(ctx, data, etag=data['etag'])
    return idempotency.run(ctx, changes, work)


@router.post('/{object_id}/withdraw')
def withdraw_object(object_id: str, body: Optional[WithdrawIn] = None, if_match: Optional[str] = Header(default=None),
                    ctx: Ctx = Depends(write_ctx)):
    body = body or WithdrawIn()

    def work(conn):
        row = objects.load_visible(conn, ctx.actor, object_id)
        require(conn, ctx.actor, 'object.withdraw', dict(row))
        if if_match and if_match != objects.etag(row):
            raise ApiError('version_conflict')
        row = objects.withdraw(conn, ctx.settings, ctx.actor.id, row, body.reason_code, ctx.request_id)
        return 200, ok(ctx, {'id': object_id, 'lifecycle': row['lifecycle'], 'withdrawn_at': row['withdrawn_at']})
    return idempotency.run(ctx, body.model_dump(), work)
