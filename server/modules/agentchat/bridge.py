"""对 AGENT-1（modules.agents）的延迟导入。测试可 install() 替身。"""
from app.errors import ApiError

SPEAK_SCOPE = 'agents.plaza.speak'

_auth = None
_owners = None
_cards = None
_screen = None


def install(*, auth=None, owners=None, cards=None, screen=None):
    global _auth, _owners, _cards, _screen
    _auth = auth
    _owners = owners
    _cards = cards
    _screen = screen


def reset():
    install()


def agents_auth():
    if _auth is not None:
        return _auth
    try:
        from modules.agents import auth as real
        return real
    except ImportError:
        return None


def actor_from_bearer(conn, token, required_scope):
    auth = agents_auth()
    if auth is None:
        return None
    return auth.actor_from_bearer(conn, token, required_scope)


def owner_of(conn, principal_id):
    if _owners is not None:
        return _owners(conn, principal_id)
    auth = agents_auth()
    fn = getattr(auth, 'owner_of', None) if auth is not None else None
    if fn is not None:
        return fn(conn, principal_id)
    row = conn.execute('SELECT kind FROM principal WHERE id = ?', (principal_id,)).fetchone()
    if row is None:
        return None
    if row['kind'] == 'human':
        return principal_id
    return None


def agent_card(conn, principal_id):
    if _cards is not None:
        return _cards(conn, principal_id)
    auth = agents_auth()
    fn = getattr(auth, 'card', None) if auth is not None else None
    if fn is not None:
        return fn(conn, principal_id)
    return None


def screen_text(conn, actor, body):
    """GOV-1 未合并时的调用点。超时进待审，不降级放行（和 SilicoVille 相反）。"""
    fn = _screen
    if fn is None:
        try:
            from modules.governance import screen as gov
        except ImportError:
            return 'ok'
        fn = getattr(gov, 'review_text', None) or getattr(gov, 'screen_text', None)
        if fn is None:
            return 'ok'
    try:
        result = fn(conn, actor=actor, text=body, source='agentchat')
    except TimeoutError:
        return 'pending_review'
    if result in ('ok', 'pending_review', 'hidden'):
        return result
    if result is True:
        return 'ok'
    if result is False:
        return 'hidden'
    return 'pending_review'


def bearer_token(request):
    header = request.headers.get('authorization') or request.headers.get('Authorization') or ''
    if header[:7].lower() != 'bearer ':
        return None
    token = header[7:].strip()
    return token or None


def resolve_actor(ctx, *, need_speak=False):
    """Bearer 优先走 AGENT-1；否则用 Cookie 会话。收件箱必须带令牌。"""
    token = bearer_token(ctx.request)
    if token:
        try:
            actor = actor_from_bearer(ctx.db.conn(), token, SPEAK_SCOPE)
        except ApiError:
            raise
        if actor is None:
            raise ApiError('unauthenticated')
        if getattr(actor, 'kind', None) != 'agent':
            raise ApiError('action_not_allowed')
        return actor
    if need_speak:
        raise ApiError('unauthenticated')
    if not ctx.actor.authenticated:
        raise ApiError('session_expired' if ctx.stale_session else 'unauthenticated')
    return ctx.actor
