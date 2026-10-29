from dataclasses import dataclass

from fastapi import Depends, Request

from . import accounts, clock, security
from .authz import ANONYMOUS, Actor
from .errors import ApiError


@dataclass
class Ctx:
    request: Request
    settings: object
    db: object
    actor: Actor
    request_id: str
    stale_session: bool = False

    @property
    def ip(self):
        return security.client_ip(self.request, self.settings)


def get_ctx(request: Request) -> Ctx:
    cached = getattr(request.state, 'ctx', None)
    if cached is not None:
        return cached
    settings = request.app.state.settings
    db = request.app.state.db
    token = request.cookies.get(settings.cookie_name)
    actor = (accounts.resolve_actor(db, token) if token else None) or ANONYMOUS
    ctx = Ctx(request, settings, db, actor, request.state.request_id, stale_session=bool(token) and not actor.id)
    request.state.ctx = ctx
    return ctx


def user_ctx(ctx: Ctx = Depends(get_ctx)) -> Ctx:
    if not ctx.actor.authenticated:
        raise ApiError('session_expired' if ctx.stale_session else 'unauthenticated')
    return ctx


def write_ctx(ctx: Ctx = Depends(user_ctx)) -> Ctx:
    security.limit(ctx.request, 'write', ctx.actor.id)
    return ctx


def ok(ctx, data, **meta):
    return {'data': data, 'meta': {'request_id': ctx.request_id, 'server_time': clock.now(), **meta}}
