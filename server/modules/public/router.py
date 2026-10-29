"""公开层路由。全部在 /api/public/ 下，Caddy 把根路径的 robots.txt、sitemap、llms、feed、/p/、/datasets/ 转过来。

开关 public.enabled 关着时，本模块所有路由（含管理接口）一律 404。上线由 Sun 拍板（FZ-05）。
"""
import csv
import datetime
import email.utils
import hashlib
import io
import json
import math
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field

from app import audit, clock, errors, flags, objects, outbox
from app.authz import require
from app.context import Ctx, get_ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from modules.admin import access as admin_access

from . import config, crawlers, documents, descriptors, feeds, rate, render, resources, screen, store
from . import hooks  # noqa: F401 — account lifecycle registration

errors.register('public_gone', 410, '内容已从公开层下线')
errors.register('public_slug_conflict', 409, '这个公开链接已经被别的对象占用')
errors.register('public_crawler_conflict', 409, '这个爬虫已经在名单里')
errors.register('public_screen_blocked', 422, '没有通过公开前的治理初筛')
errors.register('public_dataset_conflict', 409, '这个数据集版本已经登记过')


class PublicRoute(APIRoute):
    """GET 路由同时接受 HEAD：爬虫做新鲜度检查时不用整页下载。"""

    def __init__(self, path, *args, **kwargs):
        super().__init__(path, *args, **kwargs)
        if 'GET' in self.methods:
            self.methods.add('HEAD')


def gate(ctx):
    try:
        flags.gate(ctx.db.conn(), 'public.enabled')
    except ApiError as exc:
        if exc.code != 'capability_unavailable':
            raise
        raise ApiError('resource_not_found') from None


def gate_dep(ctx: Ctx = Depends(get_ctx)):
    gate(ctx)


router = APIRouter(prefix='/api/public', dependencies=[Depends(gate_dep)], route_class=PublicRoute)
admin_router = APIRouter(prefix='/api/admin/public')


@admin_router.get('/crawlers')
def admin_crawlers(welcome: Optional[bool] = None,
                   from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                   limit: Optional[int] = None, cursor: Optional[str] = None,
                   ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    start, end = admin_access.window(from_, to)
    size, qhash, after = admin_access.page_state(ctx, 'public.crawlers', limit, cursor, welcome, start, end)
    where, args = ['1=1'], {}
    if welcome is not None:
        where.append('p.welcome = :welcome')
        args['welcome'] = int(welcome)
    for clause, value, key in (("p.updated_at >= :start", start, 'start'), ("p.updated_at < :end", end, 'end')):
        if value:
            where.append(clause)
            args[key] = value
    if after:
        where.append('(p.updated_at, p.crawler_key) < (:after_at, :after_id)')
        args.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT p.crawler_key AS id, p.user_agent, p.vendor, p.purpose, p.welcome, p.source_url, p.source_note, '
        'p.verified, p.updated_at AS created_at, p.updated_at, p.updated_by, '
        '(SELECT coalesce(sum(h.count), 0) FROM public_crawler_hit h WHERE h.crawler_key = p.crawler_key) AS hits '
        'FROM crawler_policy p WHERE ' + ' AND '.join(where) +
        ' ORDER BY p.updated_at DESC, p.crawler_key DESC LIMIT :n', {**args, 'n': size + 1}).fetchall()
    rows, next_cursor = admin_access.finish_page(ctx, qhash, rows, size,
                                                  lambda row: [row['created_at'], row['id']])
    admin_access.record_view(ctx, 'public.admin.crawlers.view', 'crawler_policy', meta={'welcome': welcome})
    return ok(ctx, [dict(row) for row in rows], next_cursor=next_cursor)

NAME = re.compile(config.NAME_PATTERN)
SLUG = re.compile(config.SLUG_PATTERN)
CRAWLER_KEY = re.compile(config.CRAWLER_KEY_PATTERN)
UA_TOKEN = re.compile(r'^[A-Za-z0-9._-]{2,80}$')
LANG_TAG = re.compile(r'^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})?$')
IDENTITY_COLUMNS = frozenset({
    'member_id', 'principal_id', 'user_id', 'account_id', 'author_id', 'publisher_id', 'owner_id',
    'display_name', 'real_name', 'handle', 'email', 'phone', 'mobile', 'wechat', 'wxid', 'contact',
    'ip', 'ip_address', 'user_agent',
})


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class PublishIn(Strict):
    object_id: str = Field(max_length=64)
    kind: str = Field(max_length=32)
    slug: str = Field(max_length=80)
    version: Optional[int] = Field(default=None, ge=1)
    license: Optional[str] = Field(default=None, max_length=32)
    license_consent: bool = False
    summary: Optional[str] = Field(default=None, max_length=500)


class UnpublishIn(Strict):
    object_id: str = Field(max_length=64)
    reason_code: str = Field(default='author_request', pattern=r'^[a-z][a-z0-9_]{2,40}$')


class TakeDownIn(Strict):
    reason_code: str = Field(default='policy', pattern=r'^[a-z][a-z0-9_]{2,40}$')


class CrawlerIn(Strict):
    user_agent: str = Field(max_length=80)
    vendor: str = Field(max_length=60)
    purpose: str = Field(max_length=120)
    welcome: bool = True
    source_url: str = Field(default='', max_length=300)
    source_note: str = Field(default='', max_length=200)


class CrawlerPatch(Strict):
    welcome: bool


class ConfigIn(Strict):
    key: str = Field(max_length=60)
    value: str = Field(max_length=500)


class ColumnIn(Strict):
    name: str = Field(max_length=40)
    type: str = Field(default='number', max_length=20)
    description: str = Field(default='', max_length=200)


class DatasetIn(Strict):
    name: str = Field(max_length=60)
    version: str = Field(max_length=32)
    title: str = Field(default='', max_length=120)
    description: str = Field(default='', max_length=500)
    columns: List[ColumnIn]
    rows: List[Dict[str, Any]] = Field(max_length=5000)
    license: Optional[str] = Field(default=None, max_length=32)
    reviewed: bool = False


class Gone(Exception):
    pass


def _origin(ctx):
    return str(ctx.settings.public_origin).rstrip('/')


def _cfg(ctx):
    conn = ctx.db.conn()
    cfg = config.load(conn)
    cfg['origin'] = _origin(ctx)
    return cfg


def _serve(ctx, bucket='page'):
    rate.enforce(ctx, bucket)


def _fresh(request, etag):
    header = request.headers.get('if-none-match')
    if not header:
        return False
    return any(token.strip().removeprefix('W/') == etag for token in header.split(',') if token.strip())


def _http_date(value):
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return email.utils.format_datetime(parsed.astimezone(datetime.timezone.utc), usegmt=True)


def _not_modified_since(request, last_modified):
    raw = request.headers.get('if-modified-since')
    if not raw or not last_modified:
        return False
    try:
        requested = email.utils.parsedate_to_datetime(raw)
        current = email.utils.parsedate_to_datetime(last_modified)
    except (TypeError, ValueError, OverflowError):
        return False
    return current <= requested


def _respond(ctx, body, media_type, *, cache=config.CACHE_PAGE, extra=None, last_modified=None):
    data = body.encode('utf-8')
    etag = '"' + hashlib.sha256(data).hexdigest()[:32] + '"'
    headers = {'ETag': etag, 'Cache-Control': cache, 'Vary': 'Accept',
               'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD',
               'Access-Control-Expose-Headers': 'ETag, Last-Modified, Retry-After'}
    http_last_modified = _http_date(last_modified)
    if http_last_modified:
        headers['Last-Modified'] = http_last_modified
    if extra:
        headers.update(extra)
    if _fresh(ctx.request, etag) or _not_modified_since(ctx.request, http_last_modified):
        return Response(status_code=304, headers=headers)
    return Response(content=data, media_type=media_type, headers=headers)


def _json(ctx, payload, *, cache=config.CACHE_PAGE, extra=None, media='application/json', last_modified=None):
    return _respond(ctx, json.dumps(payload, ensure_ascii=False) + '\n', media, cache=cache, extra=extra,
                    last_modified=last_modified)


def _wants_markdown(request):
    if request.query_params.get('format') == 'markdown':
        return True
    return 'text/markdown' in request.headers.get('accept', '').lower()


def _wants_json(request):
    if request.query_params.get('format') == 'json':
        return True
    return 'application/json' in request.headers.get('accept', '').lower()


def _agent_prefers_markdown(ctx):
    accept = ctx.request.headers.get('accept', '').strip().lower()
    if accept not in ('', '*/*'):
        return False
    user_agent = ctx.request.headers.get('user-agent', '')
    return bool(store.match_ua(ctx.db.conn(), user_agent))


def _load_page(ctx, kind, slug):
    if kind not in config.KINDS or not SLUG.match(slug or ''):
        raise ApiError('resource_not_found')
    conn = ctx.db.conn()
    row = store.get_live(conn, kind, slug)
    if row is not None:
        return row
    if store.ever_live(conn, kind, slug):
        raise Gone()
    raise ApiError('resource_not_found')


def _gone(ctx, markdown=False):
    cfg = _cfg(ctx)
    headers = {'X-Robots-Tag': 'noindex', 'Cache-Control': 'public, max-age=60',
               'Access-Control-Allow-Origin': '*'}
    if _wants_json(ctx.request):
        return JSONResponse({'schema_version': config.SCHEMA_VERSION, 'status': 410,
                             'message': '这个公开快照已经下线'}, status_code=410, headers=headers)
    if markdown or _wants_markdown(ctx.request) or _agent_prefers_markdown(ctx):
        return Response('410：这个公开快照已经下线。\n', status_code=410, media_type='text/plain; charset=utf-8',
                        headers=headers)
    return Response(render.gone_html(cfg=cfg), status_code=410, media_type='text/html; charset=utf-8',
                    headers=headers)


def _page_body(ctx, row):
    origin = _origin(ctx)
    cfg = _cfg(ctx)
    info = config.kind_info(row['kind'])
    canonical = config.public_url(origin, f'/p/{row["kind"]}/{row["slug"]}')
    md_path = canonical + '.md'
    json_path = canonical + '.json'
    license_info = config.license_info(row['license'])
    citation_line = config.citation(cfg.get('citation.format') or '', publisher=row['publisher_name'],
                                    title=row['title'], date=render.date_only(row['published_at']), url=canonical)
    page = render.page_html(
        cfg=cfg, canonical=canonical, title=row['title'],
        description=row['summary'] or render.text(cfg.get('site.description'), 300),
        kind_label=info['label'], publisher=row['publisher_name'], published_at=row['published_at'],
        license_label=license_info['label'], body_html=row['html'],
        jsonld=documents.jsonld(row, cfg, origin, info['label'], canonical), citation_line=citation_line,
        md_path=md_path, json_path=json_path)
    return page


def _md_body(row):
    return row['markdown'].rstrip('\n') + '\n'


def _json_body(ctx, row):
    return documents.normalized(row, _cfg(ctx), _origin(ctx))


# ---- 站点级发现文件 ----

@router.get('/robots.txt')
def robots_txt(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    cfg = _cfg(ctx)
    return _respond(ctx, crawlers.robots_txt(ctx.db.conn(), cfg, _origin(ctx)), 'text/plain; charset=utf-8')


@router.get('/sitemap.xml')
def sitemap_index(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    cfg = _cfg(ctx)
    return _respond(ctx, feeds.sitemap_index(ctx.db.conn(), cfg, _origin(ctx)), 'application/xml; charset=utf-8')


@router.get('/sitemap-{kind}-{shard}.xml')
def sitemap_kind_shard(kind: str, shard: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    if kind not in config.KINDS or not shard.isdigit():
        raise ApiError('resource_not_found')
    cfg = _cfg(ctx)
    body = feeds.sitemap_shard(ctx.db.conn(), cfg, _origin(ctx), int(shard), kind=kind)
    if body is None:
        raise ApiError('resource_not_found')
    return _respond(ctx, body, 'application/xml; charset=utf-8')


@router.get('/sitemap-{shard}.xml')
def sitemap_shard(shard: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    if not shard.isdigit():
        raise ApiError('resource_not_found')
    cfg = _cfg(ctx)
    body = feeds.sitemap_shard(ctx.db.conn(), cfg, _origin(ctx), int(shard))
    if body is None:
        raise ApiError('resource_not_found')
    return _respond(ctx, body, 'application/xml; charset=utf-8')


@router.get('/llms.txt')
def llms_txt(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    cfg = _cfg(ctx)
    return _respond(ctx, feeds.llms_txt(ctx.db.conn(), cfg, _origin(ctx)), 'text/plain; charset=utf-8')


@router.get('/llms-full.txt')
def llms_full(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    cfg = _cfg(ctx)
    origin = _origin(ctx)
    parts = feeds.llms_full_parts(ctx.db.conn(), cfg, origin)
    body = parts[0] if len(parts) == 1 else feeds.llms_full_index(cfg, origin, len(parts))
    return _respond(ctx, body, 'text/plain; charset=utf-8')


@router.get('/llms-full-{part}.txt')
def llms_full_part(part: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    if not part.isdigit():
        raise ApiError('resource_not_found')
    cfg = _cfg(ctx)
    parts = feeds.llms_full_parts(ctx.db.conn(), cfg, _origin(ctx))
    index = int(part)
    if index < 1 or index > len(parts):
        raise ApiError('resource_not_found')
    return _respond(ctx, parts[index - 1], 'text/plain; charset=utf-8')


@router.get('/feed.xml')
def feed_atom(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    cfg = _cfg(ctx)
    return _respond(ctx, feeds.atom(ctx.db.conn(), cfg, _origin(ctx)), 'application/atom+xml; charset=utf-8')


@router.get('/feed.json')
def feed_json(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    cfg = _cfg(ctx)
    return _json(ctx, feeds.json_feed(ctx.db.conn(), cfg, _origin(ctx)), media='application/feed+json')


@router.get('/feed/{kind}.xml')
def feed_kind_atom(kind: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    if kind not in config.KINDS:
        raise ApiError('resource_not_found')
    cfg = _cfg(ctx)
    return _respond(ctx, feeds.atom(ctx.db.conn(), cfg, _origin(ctx), kind=kind),
                    'application/atom+xml; charset=utf-8')


@router.get('/feed/{kind}.json')
def feed_kind_json(kind: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    if kind not in config.KINDS:
        raise ApiError('resource_not_found')
    cfg = _cfg(ctx)
    return _json(ctx, feeds.json_feed(ctx.db.conn(), cfg, _origin(ctx), kind=kind),
                 media='application/feed+json')


# ---- 服务端渲染的公开页 ----

@router.get('/p/{kind}/{slug}.md')
def page_markdown(kind: str, slug: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    try:
        row = _load_page(ctx, kind, slug)
    except Gone:
        return _gone(ctx, markdown=True)
    return _respond(ctx, _md_body(row), 'text/markdown; charset=utf-8', last_modified=row['published_at'])


@router.get('/p/{kind}/{slug}.json')
def page_json(kind: str, slug: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    try:
        row = _load_page(ctx, kind, slug)
    except Gone:
        return _gone(ctx)
    return _json(ctx, _json_body(ctx, row), last_modified=row['published_at'])


@router.get('/p/{kind}/{slug}')
def page_html(kind: str, slug: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx)
    try:
        row = _load_page(ctx, kind, slug)
    except Gone:
        return _gone(ctx)
    if _wants_json(ctx.request):
        return _json(ctx, _json_body(ctx, row), last_modified=row['published_at'])
    if _wants_markdown(ctx.request) or _agent_prefers_markdown(ctx):
        return _respond(ctx, _md_body(row), 'text/markdown; charset=utf-8', last_modified=row['published_at'])
    return _respond(ctx, _page_body(ctx, row), 'text/html; charset=utf-8', last_modified=row['published_at'])


# ---- 开放数据集 ----

def _dataset_or_404(conn, name, version=None):
    if not NAME.match(name or ''):
        raise ApiError('resource_not_found')
    row = store.dataset_get(conn, name, version)
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _dataset_parts(row):
    columns = json.loads(row['columns_json'])
    rows = json.loads(row['rows_json'])
    return columns, rows


def _dataset_manifest(row, origin):
    columns, _ = _dataset_parts(row)
    base = config.public_url(origin, f'/datasets/{row["name"]}/{row["version"]}')
    return {
        'schema_version': config.SCHEMA_VERSION,
        'name': row['name'],
        'version': row['version'],
        'title': row['title'],
        'description': row['description'],
        'published_at': row['reviewed_at'] or row['created_at'],
        'row_count': row['row_count'],
        'fields': columns,
        'license': config.license_info(row['license']),
        'sha256': row['sha256'],
        'files': {
            'json': base + '/data.json',
            'csv': base + '/data.csv',
            'manifest': base + '/manifest.json',
        },
        'privacy': '只含已公开或聚合脱敏数据；不含成员身份字段。',
        'attribution': {'source': '先锋', 'required_text': '来源：先锋'},
    }


@router.get('/datasets/')
def datasets_index(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    rows = store.datasets_reviewed(ctx.db.conn())
    origin = _origin(ctx)
    return _json(ctx, {
        'schema_version': config.SCHEMA_VERSION,
        'datasets': [_dataset_manifest(row, origin) for row in rows],
    })


@router.get('/datasets/{name}/{version}/manifest.json')
def dataset_manifest(name: str, version: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    row = _dataset_or_404(ctx.db.conn(), name, version)
    return _json(ctx, _dataset_manifest(row, _origin(ctx)), cache=config.CACHE_IMMUTABLE,
                 last_modified=row['reviewed_at'] or row['created_at'])


@router.get('/datasets/{name}/{version}/data.json')
def dataset_version_json(name: str, version: str, ctx: Ctx = Depends(get_ctx)):
    return dataset_json(name, version, ctx)


@router.get('/datasets/{name}/{version}/data.csv')
def dataset_version_csv(name: str, version: str, ctx: Ctx = Depends(get_ctx)):
    return dataset_csv(name, version, ctx)


@router.get('/datasets/{name}.csv')
def dataset_csv(name: str, version: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    row = _dataset_or_404(ctx.db.conn(), name, version)
    columns, rows = _dataset_parts(row)
    names = [c['name'] for c in columns]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator='\n')
    writer.writerow(names)
    for item in rows:
        writer.writerow(['' if item.get(key) is None else item.get(key) for key in names])
    headers = {'Content-Disposition': f'attachment; filename="{row["name"]}-{row["version"]}.csv"'}
    cache = config.CACHE_IMMUTABLE if version else config.CACHE_PAGE
    return _respond(ctx, buf.getvalue(), 'text/csv; charset=utf-8', cache=cache, extra=headers,
                    last_modified=row['reviewed_at'] or row['created_at'])


@router.get('/datasets/{name}.json')
def dataset_json(name: str, version: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    row = _dataset_or_404(ctx.db.conn(), name, version)
    columns, rows = _dataset_parts(row)
    nulls = sum(1 for item in rows for value in item.values() if value is None)
    payload = {
        'name': row['name'],
        'version': row['version'],
        'title': row['title'],
        'description': row['description'],
        'license': config.license_info(row['license']),
        'columns': columns,
        'rows': rows,
        'row_count': row['row_count'],
        'suppressed': {'cells': nulls},
        'sha256': row['sha256'],
        'published_at': row['reviewed_at'] or row['created_at'],
        'source': '智能体先锋队匿名聚合（已过 ≥10 条消息且 ≥10 人的抑制规则；抑制格子是 null，不是 0）',
    }
    return _json(ctx, payload, cache=config.CACHE_IMMUTABLE if version else config.CACHE_PAGE,
                 last_modified=row['reviewed_at'] or row['created_at'])


# ---- 机器发现 ----

@router.get('/openapi.json')
def openapi(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    return _json(ctx, descriptors.openapi(_cfg(ctx), _origin(ctx)))


@router.get('/.well-known/agent.json')
@router.get('/well-known/agent.json')
def agent_card(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    return _json(ctx, descriptors.agent_card(_cfg(ctx), _origin(ctx)))


@router.get('/.well-known/mcp.json')
@router.get('/well-known/mcp.json')
def mcp_well_known(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    return _json(ctx, descriptors.mcp_manifest(_cfg(ctx), _origin(ctx)))


@router.get('/mcp/tools.json')
def mcp_tools(ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    return _json(ctx, descriptors.mcp_manifest(_cfg(ctx), _origin(ctx)))


@router.get('/mcp/resources.json')
def mcp_resources(cursor: Optional[str] = None, limit: int = 50, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    return _json(ctx, resources.list_resources(ctx.db.conn(), _origin(ctx), cursor=cursor, limit=limit))


@router.get('/mcp/resources/read')
def mcp_resource_read(uri: str, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    return _json(ctx, resources.read_resource(ctx.db.conn(), _cfg(ctx), _origin(ctx), uri))


def _rpc_error(request_id, code, message, status=200):
    return JSONResponse({'jsonrpc': '2.0', 'id': request_id,
                         'error': {'code': code, 'message': message}}, status_code=status,
                        headers={'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*'})


@router.post('/mcp')
def mcp_rpc(payload: Dict[str, Any] = Body(...), ctx: Ctx = Depends(get_ctx)):
    """Minimal read-only MCP JSON-RPC endpoint; no session or login is required."""
    _serve(ctx, 'api')
    if not isinstance(payload, dict) or payload.get('jsonrpc') != '2.0' or not isinstance(payload.get('method'), str):
        return _rpc_error(payload.get('id') if isinstance(payload, dict) else None,
                          -32600, 'Invalid Request', 400)
    request_id = payload.get('id')
    method = payload['method']
    params = payload.get('params') or {}
    if not isinstance(params, dict):
        return _rpc_error(request_id, -32602, 'Invalid params')
    try:
        if method == 'initialize':
            result = {
                'protocolVersion': '2025-06-18',
                'capabilities': {'resources': {'listChanged': False}},
                'serverInfo': {'name': 'commons-public', 'title': '智能体先锋队公开层',
                               'version': '1.0.0'},
                'instructions': '只读公开资源。引用时保留 canonical URL 并标注「来源：先锋」。',
            }
        elif method == 'ping':
            result = {}
        elif method == 'resources/list':
            result = resources.list_resources(ctx.db.conn(), _origin(ctx), cursor=params.get('cursor'))
        elif method == 'resources/read':
            if not isinstance(params.get('uri'), str):
                return _rpc_error(request_id, -32602, 'uri is required')
            result = resources.read_resource(ctx.db.conn(), _cfg(ctx), _origin(ctx), params['uri'])
        else:
            return _rpc_error(request_id, -32601, 'Method not found')
    except ApiError as err:
        if err.code == 'resource_not_found':
            return _rpc_error(request_id, -32002, 'Resource not found')
        return _rpc_error(request_id, -32602, err.message or 'Invalid params')
    if request_id is None:
        return Response(status_code=202, headers={'Cache-Control': 'no-store'})
    return JSONResponse({'jsonrpc': '2.0', 'id': request_id, 'result': result},
                        headers={'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*'})


@router.get('/mcp/tools/search_public_knowledge')
def mcp_search(query: str, kind: Optional[str] = None, limit: int = 10, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    query = (query or '').strip()
    if not 1 <= len(query) <= 100:
        raise ApiError('validation_failed', 'query 要有 1 到 100 个字')
    if kind is not None and kind not in config.KINDS:
        raise ApiError('validation_failed', '不认识的公开类型')
    limit = min(50, max(1, int(limit)))
    rows = store.search_live(ctx.db.conn(), query, limit, kind)
    origin = _origin(ctx)
    return _json(ctx, {
        'tool': 'search_public_knowledge',
        'query': query,
        'count': len(rows),
        'results': [{'title': r['title'], 'url': config.public_url(origin, f'/p/{r["kind"]}/{r["slug"]}'),
                     'summary': r['summary'], 'kind': r['kind'], 'published_at': r['published_at'],
                     'license': config.license_info(r['license'])} for r in rows],
    })


@router.get('/mcp/tools/get_tool_heat')
def mcp_tool_heat(week: Optional[str] = None, tool: Optional[str] = None, limit: int = 20,
                  ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    cfg = _cfg(ctx)
    name = cfg.get('dataset.tool_heat') or 'tool-heat'
    row = store.dataset_latest(ctx.db.conn(), name)
    if row is None:
        return _json(ctx, {'tool': 'get_tool_heat', 'available': False, 'reason': 'no_reviewed_dataset',
                           'dataset': name})
    columns, rows = _dataset_parts(row)
    selected = []
    for item in rows:
        if week is not None and str(item.get('week')) != week:
            continue
        if tool is not None and tool not in (item.get('tool'), item.get('key'), item.get('entry')):
            continue
        selected.append(item)
    selected = selected[:min(200, max(1, int(limit)))]
    return _json(ctx, {
        'tool': 'get_tool_heat',
        'available': True,
        'dataset': name,
        'version': row['version'],
        'license': config.license_info(row['license']),
        'columns': columns,
        'rows': selected,
        'noise': '抑制格子是 null（不是 0）；只含已审版本',
    })


@router.get('/mcp/tools/get_hot_digest')
def mcp_hot_digest(date: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    _serve(ctx, 'api')
    conn = ctx.db.conn()
    origin = _origin(ctx)
    candidates = store.list_live(conn, kind='hot', limit=60)
    chosen = None
    if date:
        if len(date) != 10 or date[4] != '-' or date[7] != '-':
            raise ApiError('validation_failed', 'date 用 YYYY-MM-DD')
        for row in candidates:
            if row['slug'] == date or row['published_at'][:10] == date:
                chosen = row
                break
    elif candidates:
        chosen = candidates[0]
    if chosen is None:
        return _json(ctx, {'tool': 'get_hot_digest', 'available': False, 'date': date})
    return _json(ctx, {
        'tool': 'get_hot_digest',
        'available': True,
        'date': chosen['published_at'][:10],
        'title': chosen['title'],
        'summary': chosen['summary'],
        'markdown': chosen['markdown'],
        'url': config.public_url(origin, f'/p/{chosen["kind"]}/{chosen["slug"]}'),
        'published_at': chosen['published_at'],
        'license': config.license_info(chosen['license']),
    })


# ---- 发布与下线 ----

def _slug_owner_blocked(conn, kind, slug, object_id):
    owner = store.live_slug_owner(conn, kind, slug)
    if owner and owner != object_id:
        raise ApiError('public_slug_conflict')


@router.post('/publish', status_code=201)
def publish(body: PublishIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    cfg = config.load(conn)
    origin = _origin(ctx)
    kind = body.kind
    if kind not in config.KINDS:
        raise ApiError('validation_failed', '不认识的公开类型')
    if not SLUG.match(body.slug or ''):
        raise ApiError('validation_failed', 'slug 只能用小写字母、数字和连字符，1 到 80 位')
    license_code = body.license or cfg.get('license.default') or 'undecided'
    if license_code not in config.LICENSES:
        raise ApiError('validation_failed', '不认识的许可代码')
    if body.license and license_code != 'undecided' and not body.license_consent:
        raise ApiError('validation_failed', '选择具体许可要同时勾选同意（license_consent=true）')
    verdict = None
    try:
        with ctx.db.write() as conn:
            head = objects.load_visible(conn, ctx.actor, body.object_id)
            require(conn, ctx.actor, 'public.publish', dict(head))
            if head['lifecycle'] != 'active':
                raise ApiError('state_conflict', '只能发布 active 状态的对象')
            version_no = body.version or head['current_version']
            version = conn.execute('SELECT * FROM object_version WHERE object_id = ? AND version = ?',
                                   (head['id'], version_no)).fetchone()
            if version is None:
                raise ApiError('resource_not_found')
            _slug_owner_blocked(conn, kind, body.slug, head['id'])
            content = json.loads(version['content_json'])
            built = documents.build(kind, version['title'], content, body.summary)
            if kind == 'qa' and not built['meta'].get('accepted_answer'):
                raise ApiError('validation_failed', '公开问答必须有采纳解法')
            verdict = screen.screen(conn, ctx.actor, dict(head, title=version['title']), version,
                                    built['markdown'])
            if verdict['result'] == 'block':
                raise ApiError('public_screen_blocked')
            status = 'live' if verdict['result'] == 'pass' else 'pending'
            now = clock.now()
            if status == 'live':
                store.supersede(conn, head['id'], now)
            snapshot_id = store.insert_snapshot(
                conn, object_id=head['id'], object_version=version_no, kind=kind, slug=body.slug,
                title=' '.join(version['title'].split()), summary=built['summary'],
                markdown=built['markdown'], html=built['html'],
                search_text=built['search_text'], license_code=license_code,
                license_consent=body.license_consent, publisher_id=head['author_id'],
                publisher_name=conn.execute('SELECT display_name FROM profile WHERE principal_id = ?',
                                            (head['author_id'],)).fetchone()[0],
                status=status, screen_result=verdict['result'], screen_reasons=verdict['reasons'],
                jsonld_type=built['jsonld_type'], meta=built['meta'], source_hash=version['content_hash'],
                published_at=now, now=now)
            audit.record(conn, ctx.actor.id, 'public.publish', 'public_snapshot', snapshot_id,
                         request_id=ctx.request_id,
                         meta={'kind': kind, 'object_version': version_no, 'screen': verdict['result']})
            outbox.emit(conn, 'public.published', 'public_snapshot', snapshot_id,
                        {'kind': kind, 'slug': body.slug, 'status': status}, version=version_no,
                        actor_id=ctx.actor.id, request_id=ctx.request_id)
    except ApiError as err:
        if err.code == 'public_screen_blocked' and verdict is not None:
            # 被拦的审计要在回滚之后再写一笔，否则跟着事务一起消失
            with ctx.db.write() as conn:
                audit.record(conn, ctx.actor.id, 'public.publish', 'object', head['id'], outcome='denied',
                             reason='screen_blocked', request_id=ctx.request_id,
                             meta={'kind': kind, 'codes': [r['code'] for r in verdict['reasons']]})
        raise
    data = {'id': snapshot_id, 'kind': kind, 'slug': body.slug, 'status': status,
            'url': config.public_url(origin, f'/p/{kind}/{body.slug}'),
            'license': config.license_info(license_code), 'screen': verdict['result']}
    return JSONResponse(ok(ctx, data), status_code=201 if status == 'live' else 202)


@router.post('/unpublish')
def unpublish(body: UnpublishIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        head = objects.load_visible(conn, ctx.actor, body.object_id)
        require(conn, ctx.actor, 'public.unpublish', dict(head))
        count = store.take_down_object(conn, head['id'], body.reason_code, clock.now())
        audit.record(conn, ctx.actor.id, 'public.unpublish', 'object', head['id'], request_id=ctx.request_id,
                     reason=body.reason_code, meta={'snapshots': count})
        if count:
            outbox.emit(conn, 'public.unpublished', 'object', head['id'], {'reason': body.reason_code},
                        actor_id=ctx.actor.id, request_id=ctx.request_id)
    return ok(ctx, {'object_id': body.object_id, 'taken_down': count})


@router.post('/admin/snapshots/{snapshot_id}/approve')
def approve_snapshot(snapshot_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        require(conn, ctx.actor, 'public.moderate')
        row = store.snapshot_by_id(conn, snapshot_id)
        if row is None:
            raise ApiError('resource_not_found')
        if row['taken_down_at'] is not None:
            raise ApiError('state_conflict', '这个快照已经下线')
        head = conn.execute('SELECT * FROM object_head WHERE id = ?', (row['object_id'],)).fetchone()
        if head is None or head['lifecycle'] != 'active':
            raise ApiError('state_conflict', '原对象已撤回或隐藏，不能放行')
        if row['status'] == 'pending':
            _slug_owner_blocked(conn, row['kind'], row['slug'], row['object_id'])
        snapshot = store.approve(conn, snapshot_id, clock.now())
        audit.record(conn, ctx.actor.id, 'public.approve', 'public_snapshot', snapshot_id,
                     request_id=ctx.request_id, meta={'kind': row['kind']})
        if snapshot is not None and snapshot['status'] == 'live':
            outbox.emit(conn, 'public.published', 'public_snapshot', snapshot_id,
                        {'kind': snapshot['kind'], 'slug': snapshot['slug'], 'status': 'live'},
                        version=snapshot['object_version'], actor_id=ctx.actor.id, request_id=ctx.request_id)
    return ok(ctx, {'id': snapshot_id, 'status': snapshot['status'] if snapshot else 'missing'})


@router.post('/admin/snapshots/{snapshot_id}/take-down')
def take_down_snapshot(snapshot_id: str, body: TakeDownIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        require(conn, ctx.actor, 'public.moderate')
        row = store.snapshot_by_id(conn, snapshot_id)
        if row is None:
            raise ApiError('resource_not_found')
        count = store.take_down_snapshot(conn, snapshot_id, body.reason_code, clock.now())
        audit.record(conn, ctx.actor.id, 'public.takedown', 'public_snapshot', snapshot_id,
                     request_id=ctx.request_id, reason=body.reason_code, meta={'snapshots': count})
        if count:
            outbox.emit(conn, 'public.unpublished', 'public_snapshot', snapshot_id, {'reason': body.reason_code},
                        actor_id=ctx.actor.id, request_id=ctx.request_id)
    return ok(ctx, {'id': snapshot_id, 'taken_down': count})


# ---- 管理：爬虫名单 ----

@router.get('/admin/crawlers')
def list_crawlers(ctx: Ctx = Depends(user_ctx)):
    require(ctx.db.conn(), ctx.actor, 'public.crawlers')
    return ok(ctx, [dict(row) for row in store.crawlers(ctx.db.conn())])


@router.post('/admin/crawlers', status_code=201)
def add_crawler(body: CrawlerIn, ctx: Ctx = Depends(write_ctx)):
    if not UA_TOKEN.match(body.user_agent):
        raise ApiError('validation_failed', 'user_agent 只能用字母、数字、点、下划线、连字符')
    key = re.sub(r'[^a-z0-9-]+', '-', body.user_agent.lower()).strip('-')[:40] or 'bot'
    with ctx.db.write() as conn:
        require(conn, ctx.actor, 'public.crawlers')
        if store.crawler_by_key(conn, key) is not None:
            raise ApiError('public_crawler_conflict')
        now = clock.now()
        store.crawler_insert(conn, key=key, user_agent=body.user_agent, vendor=body.vendor,
                             purpose=body.purpose, welcome=body.welcome, source_url=body.source_url,
                             source_note=body.source_note, now=now, actor_id=ctx.actor.id)
        audit.record(conn, ctx.actor.id, 'public.crawler', 'crawler_policy', key, request_id=ctx.request_id,
                     meta={'welcome': body.welcome})
    return ok(ctx, {'crawler_key': key, 'user_agent': body.user_agent, 'welcome': body.welcome})


@router.patch('/admin/crawlers/{crawler_key}')
def set_crawler(crawler_key: str, body: CrawlerPatch, ctx: Ctx = Depends(write_ctx)):
    if not CRAWLER_KEY.match(crawler_key or ''):
        raise ApiError('resource_not_found')
    with ctx.db.write() as conn:
        require(conn, ctx.actor, 'public.crawlers')
        before = store.crawler_by_key(conn, crawler_key)
        if before is None:
            raise ApiError('resource_not_found')
        store.crawler_set_welcome(conn, crawler_key, body.welcome, clock.now(), ctx.actor.id)
        audit.record(conn, ctx.actor.id, 'public.crawler', 'crawler_policy', crawler_key, request_id=ctx.request_id,
                     meta={'welcome': body.welcome, 'was': bool(before['welcome'])})
    return ok(ctx, {'crawler_key': crawler_key, 'welcome': body.welcome})


# ---- 管理：站点配置 ----

@router.get('/admin/config')
def get_config(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'public.config')
    cfg = config.load(conn)
    return ok(ctx, {key: cfg.get(key) for key in sorted(config.WRITABLE)})


@router.patch('/admin/config')
def set_config(body: ConfigIn, ctx: Ctx = Depends(write_ctx)):
    key = body.key
    if key not in config.WRITABLE:
        raise ApiError('validation_failed', '这个配置项不允许改')
    value = body.value.strip()
    if key in config.INT_LIMITS:
        if not re.fullmatch(r'\d{1,9}', value):
            raise ApiError('validation_failed', '这个配置项要填整数')
        low, high = config.INT_LIMITS[key]
        if not low <= int(value) <= high:
            raise ApiError('validation_failed', f'取值范围是 {low} 到 {high}')
        value = str(int(value))
    elif key == 'license.default':
        if value not in config.LICENSES:
            raise ApiError('validation_failed', '不认识的许可代码')
    elif key == 'site.lang':
        if not LANG_TAG.match(value):
            raise ApiError('validation_failed', '语言标签格式不对')
    elif key == 'dataset.tool_heat':
        if not NAME.match(value):
            raise ApiError('validation_failed', '数据集名字只能用小写字母、数字和连字符')
    else:
        if key == 'crawlers.content_signal':
            value = value[:config.STR_LIMITS[key]]
        elif not value:
            raise ApiError('validation_failed', '值不能为空')
        elif len(value) > config.STR_LIMITS[key]:
            raise ApiError('validation_failed', '值太长')
    with ctx.db.write() as conn:
        require(conn, ctx.actor, 'public.config')
        conn.execute(
            'INSERT INTO public_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) '
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, '
            'updated_by = excluded.updated_by', (key, value, clock.now(), ctx.actor.id))
        audit.record(conn, ctx.actor.id, 'public.config', 'public_config', key, request_id=ctx.request_id,
                     meta={'key': key, 'value': value})
    return ok(ctx, {'key': key, 'value': value})


# ---- 管理：开放数据集 ----

def _cell_ok(value):
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, str):
        if len(value) > 120 or any(ord(ch) < 32 for ch in value):
            return False
        if value[:1] in ('=', '+', '-', '@'):
            return False
        low = value.lower()
        return not any(bad in low for bad in ('@', 'http://', 'https://', 'www.', 'wxid_'))
    return False


@router.get('/admin/datasets')
def list_datasets(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'public.dataset')
    return ok(ctx, [dict(row) for row in store.dataset_versions(conn)])


@router.post('/admin/datasets', status_code=201)
def add_dataset(body: DatasetIn, ctx: Ctx = Depends(write_ctx)):
    if not NAME.match(body.name or ''):
        raise ApiError('validation_failed', 'name 只能用小写字母、数字和连字符，2 到 41 位')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,31}', body.version or ''):
        raise ApiError('validation_failed', 'version 只能用字母、数字、点、下划线、连字符')
    names = [c.name for c in body.columns]
    if not names or len(names) > 40 or len(set(names)) != len(names):
        raise ApiError('validation_failed', 'columns 要有 1 到 40 个不重名的列')
    for column in body.columns:
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,39}', column.name):
            raise ApiError('validation_failed', '列名用小写字母开头，只含小写字母、数字、下划线')
        if column.name in IDENTITY_COLUMNS:
            raise ApiError('validation_failed', '开放数据集不允许成员身份字段')
    clean_rows = []
    for raw in body.rows:
        extra = set(raw) - set(names)
        if extra:
            raise ApiError('validation_failed', '行里有不认识的列')
        row = {}
        for name in names:
            value = raw.get(name)
            if not _cell_ok(value):
                raise ApiError('validation_failed', f'列 {name} 的值不合规（不许联系方式、链接和超长文本）')
            row[name] = value
        clean_rows.append(row)
    cfg = config.load(ctx.db.conn())
    license_code = body.license or cfg.get('license.default') or 'undecided'
    if license_code not in config.LICENSES:
        raise ApiError('validation_failed', '不认识的许可代码')
    sha = hashlib.sha256(json.dumps({'name': body.name, 'version': body.version, 'columns': [c.model_dump()
                                                                                           for c in body.columns],
                                     'rows': clean_rows}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    with ctx.db.write() as conn:
        require(conn, ctx.actor, 'public.dataset')
        if store.dataset_get(conn, body.name, body.version, reviewed_only=False) is not None:
            raise ApiError('public_dataset_conflict')
        dataset_id = store.dataset_insert(
            conn, name=body.name, version=body.version, title=body.title, description=body.description,
            license_code=license_code, columns=[c.model_dump() for c in body.columns], rows=clean_rows,
            sha256=sha, reviewed=body.reviewed, creator_id=ctx.actor.id, now=clock.now())
        audit.record(conn, ctx.actor.id, 'public.dataset', 'public_dataset', dataset_id, request_id=ctx.request_id,
                     meta={'name': body.name, 'version': body.version, 'reviewed': body.reviewed,
                           'rows': len(clean_rows)})
    return ok(ctx, {'id': dataset_id, 'name': body.name, 'version': body.version, 'sha256': sha,
                    'reviewed': body.reviewed, 'row_count': len(clean_rows)})


# ---- outbox：撤回/隐藏时把快照一起下线 ----

def _takedown(conn, event, reason, count):
    if not count:
        return
    audit.record(conn, event.get('actor_id'), 'public.takedown', 'object', event['aggregate_id'],
                 reason=reason, request_id=event.get('request_id'), meta={'snapshots': count})


def on_object_withdrawn(conn, event):
    count = store.take_down_object(conn, event['aggregate_id'], 'withdrawn', clock.now())
    _takedown(conn, event, 'withdrawn', count)


def on_lifecycle_changed(conn, event):
    lifecycle = (event.get('payload') or {}).get('lifecycle')
    if lifecycle not in ('hidden', 'pending_review'):
        return
    count = store.take_down_object(conn, event['aggregate_id'], lifecycle, clock.now())
    _takedown(conn, event, lifecycle, count)


outbox.subscribe('public.takedown', 'object.withdrawn', on_object_withdrawn)
outbox.subscribe('public.lifecycle', 'object.lifecycle_changed', on_lifecycle_changed)
