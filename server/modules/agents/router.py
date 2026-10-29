"""/api/agents/... · 个人 Agent 接入。

主人用（Cookie 会话，走核心层的 CSRF 和 Origin 校验）：
    GET  /api/agents/catalog                       权限档位、scope、工具清单（不需登录）
    GET  /api/agents/mine                          我的 Agent、令牌（无明文）、最近调用、待确认草稿
    POST /api/agents                               登记 Agent
    PATCH /api/agents/{id}                         改名片、暂停/恢复
    POST /api/agents/{id}/retire                   退役（令牌全部吊销）
    POST /api/agents/{id}/tokens                   发令牌（明文只在这次响应里出现）
    POST /api/agents/{id}/tokens/{token_id}/revoke 吊销
    GET  /api/agents/{id}/calls                    调用记录（游标分页）
    GET  /api/agents/{id}/preview                  「试一下」：以这个 Agent 的视角看 whats_new（不计额度、不记调用）
    GET  /api/agents/drafts                        草稿
    POST /api/agents/drafts/{id}/confirm|discard   确认发出（标「Agent 协助」）或丢弃
    GET  /api/agents/assisted/{object_id}          这个对象是不是 Agent 协助发出的

Agent 用（只认 Authorization: Bearer，不看 Cookie）：
    POST /api/agents/mcp                           MCP（JSON-RPC 2.0）
    GET  /api/agents/v1/me                         这个令牌是谁、有什么权限、今天还剩多少额度
    GET  /api/agents/v1/tools                      工具清单（同 tools/list）
    GET  /api/agents/v1/tools/{name}?参数           只读工具
    POST /api/agents/v1/tools/{name}  {参数}        任意工具
"""
from types import SimpleNamespace
from typing import List, Literal, Optional

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app import accounts, clock, flags, idempotency, outbox
from app.context import Ctx, get_ctx, ok, user_ctx, write_ctx
from app.errors import ApiError
from modules.admin import access as admin_access

from . import auth, mcp, scopes, service, tools
from . import hooks  # noqa: F401 — account lifecycle registration

router = APIRouter(prefix='/api/agents')
admin_router = APIRouter(prefix='/api/admin/agents')

accounts.register_exporter('agents', service.export)
outbox.subscribe('agents.owner_lifecycle', 'principal.*', service.on_principal_event)

Family = Literal[service.MODEL_FAMILIES]
Client = Literal[service.CLIENTS]
Palette = Literal[service.PALETTES]
REALM = {'WWW-Authenticate': 'Bearer realm="vanguard-commons-agents"'}


@admin_router.get('/profiles')
def admin_profiles(status: Optional[str] = None,
                   from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                   limit: Optional[int] = None, cursor: Optional[str] = None,
                   ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    if status and status not in ('active', 'paused', 'retired'):
        raise ApiError('validation_failed', 'Agent 状态不在允许范围内')
    start, end = admin_access.window(from_, to)
    size, qhash, after = admin_access.page_state(ctx, 'agents.profiles', limit, cursor, status, start, end)
    where, args = ['1=1'], {}
    for clause, value, key in (("a.status = :status", status, 'status'),
                               ("a.created_at >= :start", start, 'start'), ("a.created_at < :end", end, 'end')):
        if value:
            where.append(clause)
            args[key] = value
    if after:
        where.append('(a.created_at, a.principal_id) < (:after_at, :after_id)')
        args.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT a.principal_id AS id, a.owner_id, c.handle AS owner_handle, p.display_name AS owner_name, '
        'a.name, a.intro, a.model_family, a.client, a.abilities_json, a.palette, a.status, a.created_at, '
        'a.updated_at, a.retired_at, '
        '(SELECT count(*) FROM agent_token t WHERE t.agent_id = a.principal_id AND t.revoked_at IS NULL) AS tokens, '
        '(SELECT count(*) FROM agent_call_log l WHERE l.agent_id = a.principal_id) AS calls '
        'FROM agent_profile a LEFT JOIN credential c ON c.principal_id = a.owner_id '
        'LEFT JOIN profile p ON p.principal_id = a.owner_id WHERE ' + ' AND '.join(where) +
        ' ORDER BY a.created_at DESC, a.principal_id DESC LIMIT :n', {**args, 'n': size + 1}).fetchall()
    rows, next_cursor = admin_access.finish_page(ctx, qhash, rows, size,
                                                  lambda row: [row['created_at'], row['id']])
    admin_access.record_view(ctx, 'agents.admin.profiles.view', 'agent_profile', meta={'status': status})
    return ok(ctx, [dict(row) for row in rows], next_cursor=next_cursor)


@admin_router.get('/tokens')
def admin_tokens(status: Optional[str] = None,
                 from_: Optional[str] = Query(default=None, alias='from'), to: Optional[str] = None,
                 limit: Optional[int] = None, cursor: Optional[str] = None,
                 ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    admin_access.require_operator(conn, ctx.actor)
    if status and status not in ('active', 'revoked', 'expired'):
        raise ApiError('validation_failed', '令牌状态不在允许范围内')
    start, end = admin_access.window(from_, to)
    size, qhash, after = admin_access.page_state(ctx, 'agents.tokens', limit, cursor, status, start, end)
    where, args = ['1=1'], {'now': clock.now()}
    if status == 'active':
        where.append('t.revoked_at IS NULL AND t.expires_at > :now')
    elif status == 'revoked':
        where.append('t.revoked_at IS NOT NULL')
    elif status == 'expired':
        where.append('t.revoked_at IS NULL AND t.expires_at <= :now')
    for clause, value, key in (("t.created_at >= :start", start, 'start'), ("t.created_at < :end", end, 'end')):
        if value:
            where.append(clause)
            args[key] = value
    if after:
        where.append('(t.created_at, t.id) < (:after_at, :after_id)')
        args.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT t.id, t.agent_id, a.owner_id, a.name AS agent_name, t.hint, t.label, t.preset, t.scopes_json, '
        't.daily_call_cap, t.daily_item_cap, t.created_at, t.expires_at, t.revoked_at, t.revoke_reason, '
        't.last_used_at, t.call_count FROM agent_token t JOIN agent_profile a ON a.principal_id = t.agent_id '
        'WHERE ' + ' AND '.join(where) + ' ORDER BY t.created_at DESC, t.id DESC LIMIT :n',
        {**args, 'n': size + 1}).fetchall()
    rows, next_cursor = admin_access.finish_page(ctx, qhash, rows, size,
                                                  lambda row: [row['created_at'], row['id']])
    items = []
    for row in rows:
        item = dict(row)
        item['masked_token'] = f"vca_…{item.pop('hint')}"
        item['status'] = ('revoked' if item['revoked_at'] else
                          'expired' if item['expires_at'] <= args['now'] else 'active')
        items.append(item)
    admin_access.record_view(ctx, 'agents.admin.tokens.view', 'agent_token', meta={'status': status})
    return ok(ctx, items, next_cursor=next_cursor)


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class AgentIn(Strict):
    name: str = Field(min_length=1, max_length=24)
    intro: str = Field(default='', max_length=140)
    model_family: Family = 'other'
    client: Client = 'generic'
    abilities: List[str] = Field(default_factory=list, max_length=8)
    palette: Palette = 'classic'


class AgentPatch(Strict):
    name: Optional[str] = Field(default=None, min_length=1, max_length=24)
    intro: Optional[str] = Field(default=None, max_length=140)
    model_family: Optional[Family] = None
    client: Optional[Client] = None
    abilities: Optional[List[str]] = Field(default=None, max_length=8)
    palette: Optional[Palette] = None
    status: Optional[Literal['active', 'paused']] = None


class TokenIn(Strict):
    preset: Optional[Literal['read', 'draft', 'plaza']] = None
    scopes: Optional[List[str]] = Field(default=None, max_length=8)
    expires_in_days: int = Field(default=90, ge=1, le=365)
    label: str = Field(default='', max_length=40)
    daily_call_cap: Optional[int] = Field(default=None, ge=1, le=auth.DAILY_CALLS)
    daily_item_cap: Optional[int] = Field(default=None, ge=1, le=auth.DAILY_ITEMS)


class ConfirmIn(Strict):
    title: Optional[str] = Field(default=None, max_length=200)
    body: Optional[str] = Field(default=None, max_length=20000)


# ---------------------------------------------------------------- 主人用

@router.get('/catalog')
def catalog(ctx: Ctx = Depends(get_ctx)):
    conn = ctx.db.conn()
    data = scopes.catalog()
    data['tools'] = tools.public_catalog()
    data['flags'] = {k: flags.enabled(conn, k) for k in
                     ('agents.enabled', 'agents.write.enabled', 'agents.read_member_content')}
    data['endpoints'] = {'mcp': '/api/agents/mcp', 'rest': '/api/agents/v1/tools/{name}'}
    data['limits'] = {'daily_calls': auth.DAILY_CALLS, 'daily_items': auth.DAILY_ITEMS,
                      'per_minute': auth.BURST_PER_MINUTE, 'max_items_per_call': tools.MAX_ITEMS}
    return ok(ctx, data)


@router.get('/mine')
def mine(ctx: Ctx = Depends(user_ctx)):
    flags.gate(ctx.db.conn(), 'agents.enabled')
    return ok(ctx, service.mine(ctx.db.conn(), ctx.actor))


@router.get('/drafts')
def drafts(status: str = 'pending', ctx: Ctx = Depends(user_ctx)):
    flags.gate(ctx.db.conn(), 'agents.enabled')
    return ok(ctx, service.list_drafts(ctx.db.conn(), ctx.actor, status))


@router.post('/drafts/{draft_id}/confirm')
def confirm(draft_id: str, body: Optional[ConfirmIn] = None, ctx: Ctx = Depends(write_ctx)):
    changes = (body or ConfirmIn()).model_dump(exclude_none=True)

    def work(conn):
        flags.gate(conn, 'agents.enabled')
        return 200, ok(ctx, service.confirm_draft(conn, ctx.actor, draft_id, changes, ctx.request_id))
    return idempotency.run(ctx, {'draft': draft_id, **changes}, work)


@router.post('/drafts/{draft_id}/discard')
def discard(draft_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.discard_draft(conn, ctx.actor, draft_id, ctx.request_id))


@router.get('/assisted/{object_id}')
def assisted(object_id: str, ctx: Ctx = Depends(user_ctx)):
    flags.gate(ctx.db.conn(), 'agents.enabled')
    return ok(ctx, service.assisted(ctx.db.conn(), ctx.actor, object_id))


# ---------------------------------------------------------------- Agent 用（Bearer）

def bearer_actor(request):
    """只看 Authorization 头。Origin 只要带了就必须在白名单里（挡浏览器里的跨站页面）。"""
    settings, db = request.app.state.settings, request.app.state.db
    origin = request.headers.get('origin')
    if origin and origin not in settings.allowed_origins:
        raise ApiError('origin_rejected')
    header = request.headers.get('authorization')
    actor, reason = auth.authenticate(db.conn(), header)
    if actor is not None:
        return actor
    if reason == 'owner_inactive':
        with db.write() as conn:
            auth.revoke_for_inactive_owner(conn, header)
    if reason == 'disabled':
        raise ApiError('capability_unavailable', 'Agent 接入的总开关关着')
    raise ApiError('unauthenticated', '令牌无效、已过期或已吊销', headers=dict(REALM))


def _agent_ctx(request):
    return SimpleNamespace(request_id=request.state.request_id)


@router.post('/mcp')
async def mcp_endpoint(request: Request):
    raw = await request.body()
    return await run_in_threadpool(_mcp, request, raw)


def _send(reply):
    if reply.body is None:
        return Response(status_code=reply.status, headers=reply.headers)
    return JSONResponse(reply.body, reply.status, headers=reply.headers)


def _mcp(request, raw):
    settings, db, rid = request.app.state.settings, request.app.state.db, request.state.request_id
    try:
        actor = bearer_actor(request)
    except ApiError as err:
        return _send(mcp.from_api_error(None, err, rid))
    if not mcp.check_version_header(request.headers.get('mcp-protocol-version')):
        return _send(mcp.error(None, mcp.INVALID_REQUEST, '不支持的 MCP-Protocol-Version', status=400))
    message, bad = mcp.parse(raw)
    if bad is not None:
        return _send(bad)
    try:
        reply = mcp.handle(db, settings, actor, message, rid)
    except ApiError as err:
        reply = mcp.from_api_error(message.get('id'), err, rid)
    return _send(reply)


@router.get('/v1/me')
def v1_me(request: Request):
    actor = bearer_actor(request)
    conn = request.app.state.db.conn()
    row = service._load(conn, actor.owner_id, actor.id)
    token = conn.execute('SELECT * FROM agent_token WHERE id = ?', (actor.token_id,)).fetchone()
    data = {'agent': service.card(row), 'token': service.token_meta(token), 'usage_today': auth.usage(conn, actor),
            'tools': [t['name'] for t in tools.catalog(actor.scopes)],
            'member_content': auth.member_content_allowed(conn)}
    return ok(_agent_ctx(request), data)


@router.get('/v1/tools')
def v1_tools(request: Request):
    actor = bearer_actor(request)
    return ok(_agent_ctx(request), tools.catalog(actor.scopes))


def _run_rest(request, name, args):
    actor = bearer_actor(request)
    if name not in tools.TOOLS:
        raise ApiError('resource_not_found')
    try:
        data, items, _ = tools.run(request.app.state.db, request.app.state.settings, actor, name, args, 'rest',
                                   request.state.request_id)
    except tools.ArgError as exc:
        raise ApiError('validation_failed', fields=exc.fields) from None
    return ok(_agent_ctx(request), data, items=items)


@router.get('/v1/tools/{name}')
def v1_tool_get(name: str, request: Request):
    t = tools.TOOLS.get(name)
    if t is not None and not t.read_only:
        raise ApiError('method_not_allowed', '这个工具要用 POST')
    args = tools.coerce_query(t.schema, dict(request.query_params)) if t else {}
    return _run_rest(request, name, args)


@router.post('/v1/tools/{name}')
def v1_tool_post(name: str, request: Request, args: Optional[dict] = Body(default=None)):
    return _run_rest(request, name, args or {})


# ---------------------------------------------------------------- 主人用（带 Agent 编号）

@router.post('', status_code=201)
def create(body: AgentIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 201, ok(ctx, service.create_agent(conn, ctx.actor, body.model_dump(), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@router.patch('/{agent_id}')
def update(agent_id: str, body: AgentPatch, ctx: Ctx = Depends(write_ctx)):
    flags.gate(ctx.db.conn(), 'agents.enabled')
    changes = body.model_dump(exclude_none=True)
    with ctx.db.write() as conn:
        return ok(ctx, service.update_agent(conn, ctx.actor, agent_id, changes, ctx.request_id))


@router.post('/{agent_id}/retire')
def retire(agent_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.retire_agent(conn, ctx.actor, agent_id, ctx.request_id))


@router.post('/{agent_id}/tokens', status_code=201)
def issue(agent_id: str, body: TokenIn, ctx: Ctx = Depends(write_ctx)):
    # 不走 idempotency.run：它会把响应体（含令牌明文）存进 idempotency_key 表。
    with ctx.db.write() as conn:
        token, meta = service.issue_token(conn, ctx.actor, agent_id, body.model_dump(exclude_none=True),
                                          ctx.request_id)
    data = {'token': token, 'shown_once': True, 'meta': meta,
            'env': {'name': 'VC_AGENT_TOKEN', 'hint': '只放在你自己电脑的环境变量里，不要贴进对话或提示词。'}}
    return JSONResponse(ok(ctx, data), 201)


@router.post('/{agent_id}/tokens/{token_id}/revoke')
def revoke(agent_id: str, token_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.revoke_token(conn, ctx.actor, agent_id, token_id, ctx.request_id))


@router.get('/{agent_id}/calls')
def calls(agent_id: str, limit: Optional[int] = None, cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    flags.gate(ctx.db.conn(), 'agents.enabled')
    rows, next_cursor = service.calls_page(ctx.db.conn(), ctx.settings, ctx.actor, agent_id, cursor, limit)
    return ok(ctx, rows, next_cursor=next_cursor)


@router.get('/{agent_id}/preview')
def preview(agent_id: str, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    flags.gate(conn, 'agents.enabled')
    row = service._load(conn, ctx.actor.id, agent_id)
    if row['status'] == 'retired':
        raise ApiError('state_conflict', '这个 Agent 已经退役')
    agent = auth.AgentActor(id=agent_id, level=ctx.actor.level, status='active', kind='agent',
                            owner_id=ctx.actor.id, scopes=frozenset((scopes.NEWS_READ, scopes.ME_READ)),
                            agent_name=row['name'])
    data, items, _ = tools.run(ctx.db, ctx.settings, agent, 'whats_new', {}, 'rest', ctx.request_id, preview=True)
    return ok(ctx, data, items=items, preview=True)
