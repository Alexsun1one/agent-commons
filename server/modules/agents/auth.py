"""令牌 → Actor。给本模块和 AGENT-2（modules.agentchat）共用。

对外函数：
    actor_from_bearer(conn, token, required_scope) -> AgentActor | None
        token 可以是裸令牌，也可以带 "Bearer " 前缀。只读，不写库，可以在调用方的事务里用。
        返回 None 的情况一律不区分：令牌不存在、已吊销、已过期、scope 为空或不含 required_scope、
        Agent 已暂停或退役、Agent 主体被停用、主人不是 active、总开关 agents.enabled 关着。
        required_scope 必须是 scopes.ALL 里的一个；传空或不认识的值直接返回 None（fail-closed）。
    owner_of(conn, principal_id) -> str | None
        Agent → 主人 id；人 → 自己；找不到 → None。
    card(conn, agent_id) -> dict | None
        名片：id、name、owner_id、owner_name、blurb、skills、model_family、color（熊猫配色）、directions、status、useful_count。
    owner_actor(conn, agent_actor) -> Actor
        主人当前的身份（等级每次重读，不带角色）。读内容时用它拼 visible_predicate，
        再按 member_content_allowed() 去掉别的成员的内容，得到「主人能看到的 ∩ 规则允许给外部 Agent 的」。
    log_call(conn, agent_actor, tool, items=0, result='ok', transport='module', request_id=None)
        把一次调用记进 agent_call_log（只记令牌、工具名、条数、结果码），并更新令牌的最后使用时间和计数。
    reserve(conn, agent_actor) -> 剩余可返回条数；超过当日上限抛 429。finish(conn, agent_actor, items) 记条数。
"""
import json
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app import clock, errors, flags, security
from app.authz import Actor
from app.errors import ApiError

from . import scopes

TOKEN_PREFIX = 'vca_'
MAX_TOKEN_LEN = 128

DAILY_CALLS = 300
DAILY_ITEMS = 3000
BURST_PER_MINUTE = 30

errors.register('agent_scope_missing', 403, '这个令牌没有这项权限')


@dataclass(frozen=True)
class AgentActor(Actor):
    """kind='agent' 的 Actor。level 取主人当前等级（上限），roles 永远为空。"""
    owner_id: str = None
    token_id: str = None
    scopes: frozenset = field(default_factory=frozenset)
    agent_name: str = ''


def new_token():
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def parse_bearer(value):
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if raw[:7].lower() == 'bearer ':
        raw = raw[7:].strip()
    if not raw.startswith(TOKEN_PREFIX) or len(raw) > MAX_TOKEN_LEN or not raw.isascii():
        return None
    return raw


def _row(conn, token_hash):
    return conn.execute(
        'SELECT t.id, t.agent_id, t.scopes_json, t.expires_at, t.revoked_at, a.owner_id, a.name, '
        'a.status AS agent_status, ap.status AS agent_principal_status, op.status AS owner_status, '
        'opr.level AS owner_level FROM agent_token t '
        'JOIN agent_profile a ON a.principal_id = t.agent_id '
        'JOIN principal ap ON ap.id = a.principal_id '
        'JOIN principal op ON op.id = a.owner_id '
        'JOIN profile opr ON opr.principal_id = a.owner_id '
        'WHERE t.token_hash = ?', (token_hash,)).fetchone()


def authenticate(conn, token):
    """-> (AgentActor | None, reason)。reason 只给本模块决定要不要顺手吊销，不对外细分。"""
    raw = parse_bearer(token)
    if raw is None:
        return None, 'invalid'
    if not flags.enabled(conn, 'agents.enabled'):
        return None, 'disabled'
    row = _row(conn, security.token_hash(raw))
    if row is None:
        return None, 'invalid'
    if row['revoked_at'] is not None:
        return None, 'revoked'
    if row['expires_at'] <= clock.now():
        return None, 'expired'
    if row['owner_status'] != 'active':
        return None, 'owner_inactive'
    if row['agent_status'] != 'active' or row['agent_principal_status'] != 'active':
        return None, 'agent_inactive'
    granted = scopes.parse(row['scopes_json'])
    if not granted:
        return None, 'empty_scope'
    actor = AgentActor(id=row['agent_id'], level=row['owner_level'], roles=frozenset(), status='active',
                       totp_enabled=False, session_id=None, kind='agent', owner_id=row['owner_id'],
                       token_id=row['id'], scopes=granted, agent_name=row['name'])
    return actor, None


def actor_from_bearer(conn, token, required_scope):
    required_scope = scopes.canonical(required_scope)
    if required_scope not in scopes.ALL:
        return None
    actor, _ = authenticate(conn, token)
    if actor is None or required_scope not in actor.scopes:
        return None
    return actor


def owner_actor(conn, agent_actor):
    row = conn.execute('SELECT p.status, pr.level FROM principal p JOIN profile pr ON pr.principal_id = p.id '
                       'WHERE p.id = ?', (agent_actor.owner_id,)).fetchone()
    if row is None or row['status'] != 'active':
        return Actor()
    return Actor(id=agent_actor.owner_id, level=row['level'], roles=frozenset(), status=row['status'], kind='human')


def owner_of(conn, principal_id):
    row = conn.execute('SELECT p.kind, a.owner_id FROM principal p LEFT JOIN agent_profile a ON a.principal_id = p.id '
                       'WHERE p.id = ?', (principal_id,)).fetchone()
    if row is None:
        return None
    return principal_id if row['kind'] == 'human' else row['owner_id']


def card(conn, agent_id):
    row = conn.execute('SELECT a.*, p.display_name AS owner_name FROM agent_profile a '
                       'JOIN profile p ON p.principal_id = a.owner_id WHERE a.principal_id = ?', (agent_id,)).fetchone()
    if row is None:
        return None
    try:
        skills = [s for s in json.loads(row['abilities_json']) if isinstance(s, str)]
    except ValueError:
        skills = []
    directions = []
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'feed_sub'").fetchone():
        directions = [r[0] for r in conn.execute('SELECT direction FROM feed_sub WHERE user_id = ? ORDER BY direction',
                                                 (row['owner_id'],))]
    return {'id': row['principal_id'], 'name': row['name'], 'owner_id': row['owner_id'], 'owner_name': row['owner_name'],
            'blurb': row['intro'], 'skills': skills, 'model_family': row['model_family'], 'color': row['palette'],
            'directions': directions, 'status': row['status'], 'useful_count': 0}


def member_content_allowed(conn):
    return flags.enabled(conn, 'agents.read_member_content')


def revoke_owner_tokens(conn, owner_id, reason, actor_id=None):
    now = clock.now()
    return conn.execute(
        'UPDATE agent_token SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE revoked_at IS NULL '
        'AND agent_id IN (SELECT principal_id FROM agent_profile WHERE owner_id = ?)',
        (now, actor_id, reason, owner_id)).rowcount


def revoke_for_inactive_owner(conn, token):
    """主人已不是 active 时，把他名下全部令牌吊销（停用后恢复也不会自动复活）。"""
    raw = parse_bearer(token)
    if raw is None:
        return 0
    row = conn.execute('SELECT a.owner_id, p.status FROM agent_token t '
                       'JOIN agent_profile a ON a.principal_id = t.agent_id JOIN principal p ON p.id = a.owner_id '
                       'WHERE t.token_hash = ?', (security.token_hash(raw),)).fetchone()
    if row is None or row['status'] == 'active':
        return 0
    return revoke_owner_tokens(conn, row['owner_id'], 'owner_inactive')


def utc_day(ts=None):
    return datetime.fromtimestamp(clock.now_ts() if ts is None else ts, timezone.utc).strftime('%Y-%m-%d')


def _caps(conn, token_id):
    row = conn.execute('SELECT daily_call_cap, daily_item_cap FROM agent_token WHERE id = ?', (token_id,)).fetchone()
    return min(row['daily_call_cap'], DAILY_CALLS), min(row['daily_item_cap'], DAILY_ITEMS)


def _retry_after():
    now = clock.now_ts()
    return max(1, int(86400 - now % 86400))


def burst(db, agent_actor):
    security.hit(db, f'agents:{agent_actor.token_id}', BURST_PER_MINUTE, 60)


def usage(conn, agent_actor):
    call_cap, item_cap = _caps(conn, agent_actor.token_id)
    row = conn.execute('SELECT calls, items FROM agent_usage_day WHERE token_id = ? AND day = ?',
                       (agent_actor.token_id, utc_day())).fetchone()
    calls, items = (row['calls'], row['items']) if row else (0, 0)
    return {'day': utc_day(), 'calls': calls, 'call_cap': call_cap, 'items': items, 'item_cap': item_cap}


def reserve(conn, agent_actor):
    """记一次调用；超过当日调用或条数上限抛 429。返回今天还能返回多少条。"""
    u = usage(conn, agent_actor)
    if u['calls'] >= u['call_cap'] or u['items'] >= u['item_cap']:
        retry = _retry_after()
        raise ApiError('rate_limited', '这个令牌今天的调用额度用完了，明天（UTC 0 点）恢复',
                       headers={'Retry-After': str(retry)}, retry_after_seconds=retry)
    conn.execute('INSERT INTO agent_usage_day (token_id, day, calls, items) VALUES (?, ?, 1, 0) '
                 'ON CONFLICT(token_id, day) DO UPDATE SET calls = calls + 1',
                 (agent_actor.token_id, u['day']))
    return u['item_cap'] - u['items']


def finish(conn, agent_actor, items):
    if items:
        conn.execute('UPDATE agent_usage_day SET items = items + ? WHERE token_id = ? AND day = ?',
                     (int(items), agent_actor.token_id, utc_day()))


def log_call(conn, agent_actor, tool, items=0, result='ok', transport='module', request_id=None):
    now = clock.now()
    conn.execute('INSERT INTO agent_call_log (id, token_id, agent_id, owner_id, tool, transport, at, items, result, '
                 'request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (str(uuid.uuid4()), agent_actor.token_id, agent_actor.id, agent_actor.owner_id, str(tool)[:64],
                  transport, now, max(0, int(items)), str(result)[:40], request_id))
    conn.execute('UPDATE agent_token SET last_used_at = ?, call_count = call_count + 1 WHERE id = ?',
                 (now, agent_actor.token_id))


def scopes_json(values):
    return json.dumps(list(values), ensure_ascii=False)
