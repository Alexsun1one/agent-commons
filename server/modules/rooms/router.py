"""R13 ROOM-1 · /api/rooms/*。全部挂在开关 rooms.enabled 后面（默认关，关时 501）；gate 关时一律 403。"""
import json
from typing import List, Literal, Optional
from urllib.parse import parse_qs, urlsplit

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, audit, clock, flags, idempotency, pagination, security, worker
from app.authz import require
from app.context import Ctx, get_ctx, ok, user_ctx, write_ctx
from app.errors import ApiError

from . import livekit, service
from .consent import ConsentError
from . import hooks  # noqa: F401 — register deletion cleanup
from modules.agents import providers

router = APIRouter(prefix='/api/rooms')
accounts.register_exporter('rooms', service.export)
providers.register('rooms.upcoming', service.upcoming)
BOARD_MAX_BYTES = 1024 * 1024


def remind_due(db):
    with db.write() as conn:
        service.remind_due(conn)


worker.register_periodic('rooms.reminders', 60, remind_due)


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class AccessIn(Strict):
    kind: Literal['members', 'level', 'space', 'invite', 'signup']
    min_level: Optional[int] = Field(default=None, ge=1, le=5)
    space_id: Optional[str] = Field(default=None, max_length=64)
    principal_ids: List[str] = Field(default_factory=list, max_length=200)


class ChatIn(Strict):
    text: str = Field(min_length=1, max_length=200)


class AgendaIn(Strict):
    title: str = Field(min_length=1, max_length=80)
    minutes: int = Field(ge=1, le=180)


class RoomIn(Strict):
    kind: str = Field(max_length=16)
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field(default='', max_length=500)
    starts_at: Optional[str] = Field(default=None, max_length=40)
    duration_min: int = Field(ge=5, le=600)
    provider: Literal['livekit', 'external_link'] = 'livekit'
    external_url: Optional[str] = Field(default=None, max_length=500)
    access: List[AccessIn] = Field(default_factory=list, max_length=5)
    self_unmute: bool = False
    repeat_weekly: int = Field(default=0, ge=0, le=52)
    agenda: List[AgendaIn] = Field(default_factory=list, max_length=20)


class EstimateIn(Strict):
    access: List[AccessIn] = Field(default_factory=list, max_length=5)


class SignupIn(Strict):
    withdraw: bool = False


class HandIn(Strict):
    action: Literal['raise', 'lower', 'accept', 'decline']


class HostIn(Strict):
    action: Literal[service.HOST_ACTIONS]
    principal_id: Optional[str] = Field(default=None, max_length=64)
    reason_code: Optional[str] = Field(default=None, pattern=r'^[a-z][a-z0-9_]{2,40}$')
    minutes: Optional[int] = Field(default=None, ge=5, le=180)
    mode: Optional[Literal['host', 'speakers', 'all']] = None
    surface: Optional[Literal['screen', 'board']] = None
    share_audio: Optional[bool] = None


class ScreenIn(Strict):
    action: Literal['request', 'stop']
    share_audio: bool = True


class AgendaSetIn(Strict):
    items: List[AgendaIn] = Field(default_factory=list, max_length=20)


class MaterialIn(Strict):
    kind: Literal['object', 'link']
    object_id: Optional[str] = Field(default=None, max_length=64)
    url: Optional[str] = Field(default=None, max_length=500)
    title: Optional[str] = Field(default=None, max_length=120)


class BoardIn(Strict):
    doc: dict
    title: Optional[str] = Field(default=None, max_length=80)


class ConsentIn(Strict):
    grant: bool
    tracks: List[Literal['microphone', 'screen_track', 'screen_share_audio']] = Field(
        default_factory=lambda: ['microphone'], min_length=1, max_length=3)


class RecordingIn(Strict):
    action: Literal['propose', 'start', 'stop']


def _on(conn):
    flags.gate(conn, service.FLAG)


def rtc_config(app):
    """LiveKit 配置：测试注入 app.state.rooms_rtc；部署机从 Settings 的 livekit_* 字段读（见 shared-requests）。"""
    cfg = getattr(app.state, 'rooms_rtc', None)
    if cfg is not None:
        return cfg or None
    settings = app.state.settings
    key = getattr(settings, 'livekit_api_key', '') or ''
    secret = getattr(settings, 'livekit_api_secret', b'') or b''
    if not key or len(secret) < 32:
        app.state.rooms_rtc = False
        return None
    origin = settings.public_origin or ''
    ws = getattr(settings, 'livekit_ws_url', '') or origin.replace('https://', 'wss://', 1).replace('http://', 'ws://', 1)
    api = getattr(settings, 'livekit_api_url', '') or 'http://127.0.0.1:7880'
    cfg = livekit.RtcConfig(ws, api, key, secret if isinstance(secret, bytes) else secret.encode())
    app.state.rooms_rtc = cfg
    return cfg


def run_effects(ctx, effects):
    """事务提交之后再通知 LiveKit；失败只记审计，真正的撤权靠 gate 每次重连都查库。"""
    if not effects:
        return ''
    cfg = rtc_config(ctx.request.app)
    if cfg is None:
        return 'skipped'
    svc = livekit.RoomService(cfg)
    results = []
    for effect in effects:
        kind, room_id = effect[0], effect[1]
        if kind == 'remove':
            name, result = 'RemoveParticipant', svc.remove_participant(room_id, effect[2])
        elif kind == 'update':
            name, result = 'UpdateParticipant', svc.update_participant(room_id, *effect[2:])
        else:
            name, result = 'DeleteRoom', svc.delete_room(room_id)
        results.append(f'{name}:{result}')
        if result not in ('ok', 'absent'):
            audit.record_now(ctx.db, ctx.actor.id, 'rooms.rtc', 'room', room_id, outcome='error',
                             reason=result[:40], request_id=ctx.request_id, meta={'call': name})
    return ','.join(results)


def _with_rtc(response, rtc):
    if rtc:
        response.headers['X-Commons-RTC'] = rtc
    return response


@router.get('')
def list_rooms(state: Literal['live', 'scheduled', 'ended'] = 'live', limit: Optional[int] = None,
               cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _on(conn)
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('rooms', state)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    col, direction = {'live': ('started_at', 'DESC'), 'scheduled': ('starts_at', 'ASC'),
                      'ended': ('ended_at', 'DESC')}[state]
    sql, params = service.visible_sql(ctx.actor)
    where = ['r.state = :st', sql]
    if after:
        cmp = '<' if direction == 'DESC' else '>'
        where.append(f'(r.{col} {cmp} :k0 OR (r.{col} = :k0 AND r.id {cmp} :k1))')
        params.update(k0=after[0], k1=after[1])
    rows = conn.execute(f"SELECT r.* FROM room r WHERE {' AND '.join(where)} "
                        f'ORDER BY r.{col} {direction}, r.id {direction} LIMIT :lim',
                        {**params, 'st': state, 'lim': size + 1}).fetchall()
    rows, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, rows, size, lambda r: [r[col], r['id']])
    return ok(ctx, [service.summary(conn, ctx.actor, r) for r in rows], next_cursor=next_cursor)


@router.get('/abilities')
def abilities(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _on(conn)
    return ok(ctx, service.abilities(conn, ctx.actor))


@router.post('/estimate')
def estimate(body: EstimateIn, ctx: Ctx = Depends(write_ctx)):
    conn = ctx.db.conn()
    _on(conn)
    if not service.can_create_any(conn, ctx.actor):
        raise ApiError('action_not_allowed')
    rows, invitees = service.normalize_access(conn, ctx.actor, [a.model_dump() for a in body.access])
    return ok(ctx, {'count': service.estimate(conn, rows, invitees), 'approx': True})


@router.get('/gate')
def gate(request: Request, ctx: Ctx = Depends(get_ctx)):
    """Caddy forward_auth：每次 /rtc 信令连接与重连都先问这里。2xx 放行，其余一律 403。"""
    conn = ctx.db.conn()
    reason, grant = 'disabled', None
    if flags.enabled(conn, service.FLAG):
        cfg = rtc_config(request.app)
        token = _gate_token(request)
        claims = livekit.verify(token, cfg.api_secret) if cfg and token else None
        if cfg is None:
            reason = 'rtc_unconfigured'
        elif claims is None:
            reason = 'token_invalid'
        else:
            grant_id, epoch = livekit.grant_ref(claims)
            reason, grant = service.gate_check(conn, ctx.actor, claims, grant_id, epoch)
    if reason:
        try:
            security.limit(request, 'write', f'rooms-gate:{ctx.ip}')
        except ApiError:
            raise ApiError('action_not_allowed') from None
        audit.record_now(ctx.db, ctx.actor.id, 'rooms.gate', 'room', None, outcome='denied', reason=reason,
                         request_id=ctx.request_id)
        raise ApiError('action_not_allowed')
    response = JSONResponse(ok(ctx, {'room_id': grant['room_id'], 'role': grant['role'], 'epoch': grant['epoch']}))
    response.headers['X-Commons-Principal'] = ctx.actor.id
    response.headers['X-Commons-Room-Grant'] = grant['id']
    return response


def _gate_token(request):
    uri = request.headers.get('x-forwarded-uri') or ''
    token = (parse_qs(urlsplit(uri).query).get('access_token') or [None])[0]
    if not token:
        auth = request.headers.get('authorization') or ''
        if auth[:7].lower() == 'bearer ':
            token = auth[7:].strip()
    return token


@router.post('', status_code=201)
def create_room(body: RoomIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _on(conn)
        ids = service.create_room(conn, ctx.actor, payload, ctx.request_id)
        room = conn.execute('SELECT * FROM room WHERE id = ?', (ids[0],)).fetchone()
        return 201, ok(ctx, dict(service.detail(conn, ctx.actor, room), occurrences=ids))
    return idempotency.run(ctx, payload, work)


@router.get('/{room_id}')
def get_room(room_id: str, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _on(conn)
    room = service.load_room(conn, ctx.actor, room_id)
    return ok(ctx, service.detail(conn, ctx.actor, room))


@router.post('/{room_id}/join')
def join_room(room_id: str, ctx: Ctx = Depends(write_ctx)):
    """进房；已在场时再调一次就是续发令牌（令牌 10 分钟有效）。"""
    cfg = rtc_config(ctx.request.app)
    with ctx.db.write() as conn:
        _on(conn)
        state, room, p, grant = service.join(conn, ctx.actor, room_id, media_ready=cfg is not None)
        if state == 'waiting':
            return JSONResponse(ok(ctx, {'state': 'waiting', 'room_id': room_id, 'message': '等待主持人批准'}),
                                status_code=202)
        if room['provider'] == 'livekit':
            name = conn.execute('SELECT display_name FROM profile WHERE principal_id = ?',
                                (ctx.actor.id,)).fetchone()[0]
            token, exp = livekit.access_token(
                cfg, identity=ctx.actor.id, name=name, room=room_id, grant_id=grant['id'], epoch=grant['epoch'],
                role=grant['role'], can_publish=bool(grant['can_publish']),
                can_screen_share=bool(grant['can_screen_share']), ttl=service.policy(conn, 'token.ttl_s'))
            media = {'provider': 'livekit', 'url': cfg.ws_url, 'token': token, 'expires_at': clock.iso(exp)}
        else:
            media = {'provider': 'external_link', 'url': room['external_url'],
                     'label': conn.execute('SELECT label FROM room_link_host WHERE host = ?',
                                           (room['external_host'],)).fetchone()[0]}
        data = {'state': 'joined', 'room_id': room_id, 'role': p['role'], 'muted': bool(p['muted']),
                'epoch': p['epoch'], 'grant_id': grant['id'], 'can_publish': bool(grant['can_publish']),
                'can_screen_share': bool(grant['can_screen_share']),
                'media': media}
    return ok(ctx, data)


@router.post('/{room_id}/leave')
def leave_room(room_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        _on(conn)
        service.leave(conn, ctx.actor, room_id)
    return ok(ctx, {'state': 'left', 'room_id': room_id})


@router.post('/{room_id}/signup')
def signup(room_id: str, body: Optional[SignupIn] = None, ctx: Ctx = Depends(write_ctx)):
    body = body or SignupIn()
    with ctx.db.write() as conn:
        _on(conn)
        state = service.signup(conn, ctx.actor, room_id, body.withdraw)
    return ok(ctx, {'room_id': room_id, 'signup': state})


@router.post('/{room_id}/hand')
def hand(room_id: str, body: HandIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        _on(conn)
        effects = service.hand(conn, ctx.actor, room_id, body.action)
        data = service.detail(conn, ctx.actor, conn.execute('SELECT * FROM room WHERE id = ?', (room_id,)).fetchone())
    return _with_rtc(JSONResponse(ok(ctx, data)), run_effects(ctx, effects))


@router.get('/{room_id}/messages')
def chat_messages(room_id: str, before: Optional[int] = None, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _on(conn)
    return ok(ctx, service.chat_messages(conn, ctx.actor, room_id, before))


@router.post('/{room_id}/messages', status_code=201)
def post_chat(room_id: str, body: ChatIn, ctx: Ctx = Depends(write_ctx)):
    security.hit(ctx.db, f'rooms.chat:{room_id}:{ctx.actor.id}', 20, 60)

    def work(conn):
        _on(conn)
        return 201, ok(ctx, service.post_chat(conn, ctx.actor, room_id, body.text, ctx.request_id))
    return idempotency.run(ctx, {'room': room_id, 'text': body.text}, work)


@router.delete('/{room_id}/messages/{message_id}')
def delete_chat(room_id: str, message_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        _on(conn)
        return ok(ctx, service.delete_chat(conn, ctx.actor, room_id, message_id, ctx.request_id))


@router.post('/{room_id}/screen')
def screen(room_id: str, body: ScreenIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        _on(conn)
        effects = service.screen_share(conn, ctx.actor, room_id, body.action, body.share_audio, ctx.request_id)
        data = service.detail(conn, ctx.actor, conn.execute('SELECT * FROM room WHERE id = ?', (room_id,)).fetchone())
    return _with_rtc(JSONResponse(ok(ctx, data)), run_effects(ctx, effects))


@router.post('/{room_id}/host')
def host(room_id: str, body: HostIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()
    effects = []

    def work(conn):
        _on(conn)
        effects.extend(service.host_action(conn, ctx.actor, room_id, payload, ctx.request_id))
        room = conn.execute('SELECT * FROM room WHERE id = ?', (room_id,)).fetchone()
        return 200, ok(ctx, service.detail(conn, ctx.actor, room))
    response = idempotency.run(ctx, payload, work)
    return _with_rtc(response, run_effects(ctx, effects))


@router.post('/{room_id}/agenda')
def set_agenda(room_id: str, body: AgendaSetIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        _on(conn)
        service.set_agenda(conn, ctx.actor, room_id, [i.model_dump() for i in body.items])
        data = service.detail(conn, ctx.actor, conn.execute('SELECT * FROM room WHERE id = ?', (room_id,)).fetchone())
    return ok(ctx, data)


@router.post('/{room_id}/materials', status_code=201)
def add_material(room_id: str, body: MaterialIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        _on(conn)
        mid = service.add_material(conn, ctx.actor, room_id, body.model_dump())
        items = service.materials(conn, ctx.actor, room_id)
    return JSONResponse(ok(ctx, {'id': mid, 'materials': items}), status_code=201)


@router.post('/{room_id}/board', status_code=201)
def save_board(room_id: str, body: BoardIn, ctx: Ctx = Depends(write_ctx)):
    """会后白板存成房间附件（BOARD-1 的 getDoc() 结果）。只存 JSON，不渲染。"""
    storage = ctx.request.app.state.storage
    if storage is None:
        raise ApiError('service_unavailable')
    raw = json.dumps(body.doc, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()
    if len(raw) > BOARD_MAX_BYTES:
        raise ApiError('payload_too_large')
    with ctx.db.read() as conn:
        _on(conn)
        room = service.load_room(conn, ctx.actor, room_id)
        require(conn, ctx.actor, 'rooms.moderate', {'author_id': room['host_id']})
    stored = storage.put(raw, 'room_board')
    title = (body.title or '').strip() or f"白板 · {clock.now()[:10]}"
    with ctx.db.write() as conn:
        mid = service.add_board(conn, ctx.actor, room_id, stored.key, title)
    return JSONResponse(ok(ctx, {'id': mid, 'title': title, 'sha256': stored.sha256}), status_code=201)


@router.get('/{room_id}/board/{material_id}')
def read_board(room_id: str, material_id: str, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _on(conn)
    service.load_room(conn, ctx.actor, room_id)
    row = conn.execute("SELECT * FROM room_material WHERE id = ? AND room_id = ? AND kind = 'board'",
                       (material_id, room_id)).fetchone()
    storage = ctx.request.app.state.storage
    if row is None or storage is None:
        raise ApiError('resource_not_found')
    return ok(ctx, {'id': row['id'], 'title': row['title'], 'doc': json.loads(storage.read(row['storage_key']))})


@router.post('/{room_id}/recording')
def recording(room_id: str, body: RecordingIn, ctx: Ctx = Depends(write_ctx)):
    """第二步。开关 rooms.recording 关着（内测默认）时 501；就算开了，也没有录制器，start 一律 501。"""
    with ctx.db.write() as conn:
        _on(conn)
        flags.gate(conn, service.REC_FLAG)
        room = service.load_room(conn, ctx.actor, room_id)
        require(conn, ctx.actor, 'rooms.moderate', {'author_id': room['host_id']})
        if body.action == 'start':
            raise ApiError('capability_unavailable', '录制器还没有接入，本场不录制')
        machine = service.recording_machine(conn, room)
        try:
            machine.propose(ctx.actor.id) if body.action == 'propose' else machine.stop(ctx.actor.id)
        except ConsentError as err:
            raise ApiError('state_conflict', err.code) from None
        service.save_machine(conn, room_id, machine)
        audit.record(conn, ctx.actor.id, f'rooms.recording.{body.action}', 'room', room_id,
                     request_id=ctx.request_id, meta={'state': machine.state, 'version': machine.version})
    return ok(ctx, {'room_id': room_id, 'state': machine.state, 'consent_version': machine.version})


@router.post('/{room_id}/consent')
def give_consent(room_id: str, body: ConsentIn, ctx: Ctx = Depends(write_ctx)):
    """只记本人的同意：请求体里没有「替谁同意」的字段，主持人也只能改自己的。"""
    with ctx.db.write() as conn:
        _on(conn)
        flags.gate(conn, service.REC_FLAG)
        room = service.load_room(conn, ctx.actor, room_id)
        machine = service.recording_machine(conn, room)
        try:
            machine.consent_tracks(ctx.actor.id, ctx.actor.id, body.tracks, body.grant)
        except ConsentError as err:
            raise ApiError('state_conflict', err.code) from None
        changed = ctx.actor.id if 'microphone' in body.tracks else None
        changed_tracks = [(ctx.actor.id, kind) for kind in body.tracks if kind != 'microphone']
        service.save_machine(conn, room_id, machine, changed=changed, changed_tracks=changed_tracks)
        audit.record(conn, ctx.actor.id, 'rooms.recording.consent', 'room', room_id, request_id=ctx.request_id,
                     meta={'granted': body.grant, 'tracks': body.tracks, 'version': machine.version})
    mine = {'microphone': machine.consents.get(ctx.actor.id)}
    mine.update({kind: machine.track_consents.get((ctx.actor.id, kind))
                 for kind in ('screen_track', 'screen_share_audio')
                 if (ctx.actor.id, kind) in machine.extra_tracks})
    return ok(ctx, {'room_id': room_id, 'state': machine.state, 'my_consent': mine})
