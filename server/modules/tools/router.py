"""HTTP API and content negotiation for R13 TOOLS-1."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field

from app import errors, flags, idempotency
from app.authz import require
from app.context import Ctx, get_ctx, ok, user_ctx, write_ctx

from . import hooks, service  # noqa: F401  register account purger

router = APIRouter(prefix='/api/tools')
admin_router = APIRouter(prefix='/api/admin/tools')

errors.register('tools_review_too_soon', 409, '标记在用满三天后才能评分')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ToolIn(Strict):
    slug: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    vendor: str = Field(min_length=1, max_length=100)
    category: Literal['编程 Agent', '对话模型', '本地模型', '自动化', '知识管理', '设计']
    official_url: str = Field(min_length=1, max_length=500)
    price_tier: Literal['免费', '订阅', '按量']
    tags: list[str] = Field(default_factory=list, max_length=12)
    summary: str = Field(default='', max_length=280)


class UseIn(Strict):
    purpose: str = Field(default='', max_length=160)
    show_on_profile: bool = False


class ReviewIn(Strict):
    rating: int = Field(ge=1, le=5)
    body: str = Field(min_length=1, max_length=280)


def gate(conn):
    flags.gate(conn, 'tools.enabled')


def _format(request, suffix=None):
    if suffix:
        return suffix
    accept = request.headers.get('accept', '').lower()
    if 'text/markdown' in accept:
        return 'md'
    if 'text/html' in accept:
        return 'html'
    return 'json'


def _list_response(request, ctx, rows, suffix=None):
    fmt = _format(request, suffix)
    if fmt == 'md':
        response = PlainTextResponse(service.markdown_list(rows), media_type='text/markdown; charset=utf-8')
    elif fmt == 'html':
        response = HTMLResponse(service.html_list(rows))
    else:
        return JSONResponse(
            ok(ctx, rows, categories=list(service.CATEGORIES), schema_version='tools.v1'),
            headers={'Vary': 'Accept'},
        )
    response.headers['Vary'] = 'Accept'
    return response


def _detail_response(request, ctx, row, suffix=None):
    fmt = _format(request, suffix)
    if fmt == 'md':
        response = PlainTextResponse(service.markdown_detail(row), media_type='text/markdown; charset=utf-8')
    elif fmt == 'html':
        response = HTMLResponse(service.html_detail(row))
    else:
        return JSONResponse(ok(ctx, row, schema_version='tools.v1'), headers={'Vary': 'Accept'})
    response.headers['Vary'] = 'Accept'
    return response


def _rows(ctx, category=None, sort='usage'):
    gate(ctx.db.conn())
    return service.list_tools(ctx.db.conn(), category=category, sort=sort,
                              current_principal=ctx.actor.id if ctx.actor.authenticated else None)


@router.get('')
def tools(request: Request, category: Optional[str] = Query(default=None, max_length=40),
          sort: Literal['usage', 'month', 'rating'] = 'usage', ctx: Ctx = Depends(get_ctx)):
    return _list_response(request, ctx, _rows(ctx, category, sort))


@router.get('/index.json')
def tools_json(request: Request, category: Optional[str] = Query(default=None, max_length=40),
               sort: Literal['usage', 'month', 'rating'] = 'usage', ctx: Ctx = Depends(get_ctx)):
    return _list_response(request, ctx, _rows(ctx, category, sort), 'json')


@router.get('/index.md')
def tools_md(request: Request, category: Optional[str] = Query(default=None, max_length=40),
             sort: Literal['usage', 'month', 'rating'] = 'usage', ctx: Ctx = Depends(get_ctx)):
    return _list_response(request, ctx, _rows(ctx, category, sort), 'md')


@router.get('/compare')
def compare(request: Request, a: str = Query(max_length=80), b: str = Query(max_length=80),
            c: Optional[str] = Query(default=None, max_length=80), ctx: Ctx = Depends(get_ctx)):
    gate(ctx.db.conn())
    rows = service.compare(ctx.db.conn(), [a, b, c], ctx.actor.id if ctx.actor.authenticated else None)
    return _list_response(request, ctx, rows)


@router.post('/submissions', status_code=201)
def submit(body: ToolIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        gate(conn)
        return 201, ok(ctx, service.submit(conn, ctx.actor, payload, ctx.request_id))

    return idempotency.run(ctx, payload, work)


@router.post('/reviews/{review_id}/helpful')
def helpful(review_id: str, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        gate(conn)
        return 200, ok(ctx, service.helpful(conn, ctx.actor, review_id, ctx.request_id))

    return idempotency.run(ctx, {}, work)


@router.post('/{slug}/use')
def mark_use(slug: str, body: Optional[UseIn] = None, ctx: Ctx = Depends(write_ctx)):
    body = body or UseIn()
    payload = body.model_dump()

    def work(conn):
        gate(conn)
        return 200, ok(ctx, service.mark_use(conn, ctx.actor, slug, body.purpose, body.show_on_profile,
                                             ctx.request_id))

    return idempotency.run(ctx, payload, work)


@router.delete('/{slug}/use')
def unmark_use(slug: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn)
        return ok(ctx, service.unmark_use(conn, ctx.actor, slug, ctx.request_id))


@router.post('/{slug}/review')
def review(slug: str, body: ReviewIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        gate(conn)
        data = service.review(conn, ctx.actor, slug, body.rating, body.body, ctx.request_id)
        return (201 if data['created'] else 200), ok(ctx, data)

    return idempotency.run(ctx, payload, work)


@router.get('/mine/submissions')
def my_submissions(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    return ok(ctx, service.my_submissions(conn, ctx.actor))


@router.get('/{slug}.json')
def detail_json(slug: str, request: Request, ctx: Ctx = Depends(get_ctx)):
    gate(ctx.db.conn())
    row = service.detail(ctx.db.conn(), slug, ctx.actor.id if ctx.actor.authenticated else None)
    return _detail_response(request, ctx, row, 'json')


@router.get('/{slug}.md')
def detail_md(slug: str, request: Request, ctx: Ctx = Depends(get_ctx)):
    gate(ctx.db.conn())
    row = service.detail(ctx.db.conn(), slug, ctx.actor.id if ctx.actor.authenticated else None)
    return _detail_response(request, ctx, row, 'md')


@router.get('/{slug}')
def detail(slug: str, request: Request, ctx: Ctx = Depends(get_ctx)):
    gate(ctx.db.conn())
    row = service.detail(ctx.db.conn(), slug, ctx.actor.id if ctx.actor.authenticated else None)
    return _detail_response(request, ctx, row)


@admin_router.get('/submissions')
def submissions(status: Literal['pending_review', 'active', 'hidden'] = 'pending_review',
                ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'tools.moderate')
    return ok(ctx, service.pending(conn, status))


@admin_router.post('/submissions/{slug}/approve')
def approve(slug: str, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        gate(conn)
        return 200, ok(ctx, service.approve(conn, ctx.actor, slug, ctx.request_id))

    return idempotency.run(ctx, {}, work)

