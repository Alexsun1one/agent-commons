from typing import Optional

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from .. import accounts, audit, authz, clock, flags, security
from ..context import Ctx, get_ctx, ok, write_ctx
from ..errors import ApiError

router = APIRouter(prefix='/api/auth')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RegisterIn(Strict):
    invite_code: str = Field(max_length=64)
    handle: str = Field(max_length=32)
    password: str = Field(max_length=128)
    display_name: str = Field(min_length=1, max_length=40)
    adult_confirmed: StrictBool

    @field_validator('adult_confirmed')
    @classmethod
    def require_adult_confirmation(cls, value):
        if not value:
            raise ValueError('注册须确认已满 18 周岁')
        return value


class LoginIn(Strict):
    handle: str = Field(max_length=32)
    password: str = Field(max_length=128)
    totp_code: Optional[str] = Field(default=None, max_length=6)


class ResetIn(Strict):
    handle: str = Field(max_length=32)
    reset_code: str = Field(max_length=64)
    new_password: str = Field(max_length=128)


class CodeIn(Strict):
    code: str = Field(max_length=6)


class DisableIn(Strict):
    code: str = Field(max_length=6)
    password: str = Field(max_length=128)


def me_payload(conn, actor):
    data = accounts.me(conn, actor)
    data['capabilities'] = authz.capabilities(conn, actor)
    data['capability_reasons'] = authz.capability_reasons(conn, actor)
    return data


@router.post('/register', status_code=201)
def register(body: RegisterIn, response: Response, ctx: Ctx = Depends(get_ctx)):
    security.limit(ctx.request, 'auth', f'ip:{ctx.ip}')
    flags.gate(ctx.db.conn(), 'core.registration')
    with ctx.db.write() as conn:
        pid = accounts.register(conn, ctx.settings, invite_code=body.invite_code, handle=body.handle.strip().lower(),
                                password=body.password, display_name=body.display_name.strip(),
                                request_id=ctx.request_id)
        audit.record(conn, pid, 'auth.adult_confirmed', 'principal', pid, request_id=ctx.request_id,
                     meta={'minimum_age': 18, 'source': 'self_declaration'})
        token = accounts.create_session(conn, ctx.settings, pid)
    security.set_session_cookie(response, ctx.settings, token)
    actor = accounts.resolve_actor(ctx.db, token)
    return ok(ctx, me_payload(ctx.db.conn(), actor))


@router.post('/login')
def login(body: LoginIn, response: Response, ctx: Ctx = Depends(get_ctx)):
    handle = body.handle.strip().lower()
    security.limit(ctx.request, 'auth', f'ip:{ctx.ip}')
    security.limit(ctx.request, 'auth', f'handle:{handle}')
    cred = accounts.credential_for(ctx.db.conn(), handle)
    if cred is None:
        security.dummy_verify(body.password, ctx.settings.scrypt_n)
        raise ApiError('invalid_credentials')
    if not security.verify_password(body.password, cred['password_hash']) or \
            cred['status'] not in ('active', 'pending_deletion'):
        audit.record_now(ctx.db, cred['principal_id'], 'auth.login', 'principal', cred['principal_id'],
                         outcome='denied', reason='bad_password', request_id=ctx.request_id)
        raise ApiError('invalid_credentials')
    step = None
    if cred['enabled_at']:
        if not body.totp_code:
            raise ApiError('totp_required')
        step = security.totp_match(cred['secret'], body.totp_code, cred['last_step'])
        if step is None:
            audit.record_now(ctx.db, cred['principal_id'], 'auth.login', 'principal', cred['principal_id'],
                             outcome='denied', reason='bad_totp', request_id=ctx.request_id)
            raise ApiError('totp_invalid')
    with ctx.db.write() as conn:
        if step is not None:
            used = conn.execute('UPDATE totp_secret SET last_step = ? WHERE principal_id = ? AND last_step < ?',
                                (step, cred['principal_id'], step)).rowcount
            if not used:
                raise ApiError('totp_invalid')
        if ctx.actor.session_id:
            conn.execute('UPDATE session SET revoked_at = ? WHERE id = ?', (clock.now(), ctx.actor.session_id))
        token = accounts.create_session(conn, ctx.settings, cred['principal_id'])
        audit.record(conn, cred['principal_id'], 'auth.login', 'principal', cred['principal_id'],
                     request_id=ctx.request_id)
    security.set_session_cookie(response, ctx.settings, token)
    return ok(ctx, me_payload(ctx.db.conn(), accounts.resolve_actor(ctx.db, token)))


@router.post('/logout')
def logout(response: Response, ctx: Ctx = Depends(get_ctx)):
    if ctx.actor.authenticated:
        with ctx.db.write() as conn:
            conn.execute('UPDATE session SET revoked_at = ? WHERE id = ?', (clock.now(), ctx.actor.session_id))
            audit.record(conn, ctx.actor.id, 'auth.logout', 'principal', ctx.actor.id, request_id=ctx.request_id)
    security.clear_session_cookie(response, ctx.settings)
    return ok(ctx, {'signed_out': True})


@router.post('/reset')
def reset(body: ResetIn, ctx: Ctx = Depends(get_ctx)):
    security.limit(ctx.request, 'auth', f'ip:{ctx.ip}')
    try:
        with ctx.db.write() as conn:
            accounts.reset_password(conn, ctx.settings, handle=body.handle.strip().lower(), code=body.reset_code,
                                    new_password=body.new_password, request_id=ctx.request_id)
    except ApiError as exc:
        # Record outside the rolled-back transaction; no handle, password or code.
        audit.record_now(ctx.db, None, 'auth.reset', 'principal', None, outcome='denied',
                         reason=exc.code, request_id=ctx.request_id)
        raise
    return ok(ctx, {'reset': True})


def _totp(conn, actor):
    return conn.execute('SELECT * FROM totp_secret WHERE principal_id = ?', (actor.id,)).fetchone()


@router.post('/totp/setup')
def totp_setup(ctx: Ctx = Depends(write_ctx)):
    secret = security.new_totp_secret()
    with ctx.db.write() as conn:
        row = _totp(conn, ctx.actor)
        if row is not None and row['enabled_at']:
            raise ApiError('state_conflict', '动态验证码已经开启')
        conn.execute('INSERT INTO totp_secret (principal_id, secret, created_at) VALUES (?, ?, ?) '
                     'ON CONFLICT(principal_id) DO UPDATE SET secret = excluded.secret, created_at = excluded.created_at, '
                     'last_step = 0', (ctx.actor.id, secret, clock.now()))
        handle = conn.execute('SELECT handle FROM credential WHERE principal_id = ?', (ctx.actor.id,)).fetchone()[0]
    return ok(ctx, {'secret': secret, 'otpauth_uri': security.otpauth_uri(secret, handle, ctx.settings.totp_issuer)})


@router.post('/totp/enable')
def totp_enable(body: CodeIn, ctx: Ctx = Depends(write_ctx)):
    security.limit(ctx.request, 'auth', f'totp:{ctx.actor.id}')
    with ctx.db.write() as conn:
        row = _totp(conn, ctx.actor)
        if row is None or row['enabled_at']:
            raise ApiError('state_conflict', '请先获取新的动态验证码密钥')
        step = security.totp_match(row['secret'], body.code, row['last_step'])
        if step is None:
            raise ApiError('totp_invalid')
        conn.execute('UPDATE totp_secret SET enabled_at = ?, last_step = ? WHERE principal_id = ?',
                     (clock.now(), step, ctx.actor.id))
        audit.record(conn, ctx.actor.id, 'auth.totp_enable', 'principal', ctx.actor.id, request_id=ctx.request_id)
    return ok(ctx, {'totp_enabled': True})


@router.post('/totp/disable')
def totp_disable(body: DisableIn, ctx: Ctx = Depends(write_ctx)):
    security.limit(ctx.request, 'auth', f'totp:{ctx.actor.id}')
    with ctx.db.write() as conn:
        protected_role = conn.execute(
            "SELECT 1 FROM role_assignment WHERE principal_id = ? AND role IN ('admin', 'governor') "
            'AND revoked_at IS NULL LIMIT 1', (ctx.actor.id,)).fetchone()
        if protected_role:
            raise ApiError('action_not_allowed', '管理员和治理员需要保留动态验证码')
        row = _totp(conn, ctx.actor)
        if row is None or not row['enabled_at']:
            raise ApiError('state_conflict', '动态验证码没有开启')
        cred = conn.execute('SELECT password_hash FROM credential WHERE principal_id = ?', (ctx.actor.id,)).fetchone()
        if not security.verify_password(body.password, cred[0]):
            raise ApiError('invalid_credentials')
        if security.totp_match(row['secret'], body.code, row['last_step']) is None:
            raise ApiError('totp_invalid')
        conn.execute('DELETE FROM totp_secret WHERE principal_id = ?', (ctx.actor.id,))
        audit.record(conn, ctx.actor.id, 'auth.totp_disable', 'principal', ctx.actor.id, request_id=ctx.request_id)
    return ok(ctx, {'totp_enabled': False})

