import json
from dataclasses import dataclass, field

from . import flags
from .errors import ApiError

LIFECYCLES_FOR_AUTHOR = "('draft', 'active', 'pending_review', 'hidden')"


@dataclass(frozen=True)
class Actor:
    id: str = None
    level: int = 0
    roles: frozenset = field(default_factory=frozenset)
    status: str = 'anonymous'
    totp_enabled: bool = False
    session_id: str = None
    kind: str = 'human'

    @property
    def authenticated(self):
        return self.id is not None


ANONYMOUS = Actor()


@dataclass(frozen=True)
class Predicate:
    sql: str
    params: dict


def _clause(a):
    return (
        f"(({a}.author_id = :vp_actor AND {a}.lifecycle IN {LIFECYCLES_FOR_AUTHOR})"
        f" OR ({a}.lifecycle = 'active' AND ("
        f"({a}.visibility IN ('members', 'level') AND :vp_level >= {a}.min_level)"
        f" OR ({a}.visibility = 'space' AND :vp_level >= {a}.min_level AND EXISTS ("
        f"SELECT 1 FROM membership vm WHERE vm.space_id = {a}.space_id"
        f" AND vm.principal_id = :vp_actor AND vm.state = 'active'))"
        f" OR ({a}.visibility = 'named' AND EXISTS ("
        f"SELECT 1 FROM object_acl va WHERE va.object_id = {a}.id AND va.principal_id = :vp_actor)))))"
        # Core list/search/detail must not bypass a module's disabled capability.
        f" AND NOT EXISTS (SELECT 1 FROM action_rule vr LEFT JOIN feature_flag vf ON vf.key = vr.flag"
        f" WHERE vr.action = 'object.create.' || {a}.type AND vr.flag IS NOT NULL"
        f" AND coalesce(vf.enabled, 0) = 0)"
    )


def visible_predicate(actor, alias='h'):
    if not actor.authenticated or actor.status not in ('active', 'pending_deletion'):
        return Predicate('0', {})
    root = f'{alias}_root'
    sql = (f'({_clause(alias)} AND ({alias}.root_id IS NULL OR EXISTS ('
           f'SELECT 1 FROM object_head {root} WHERE {root}.id = {alias}.root_id AND {_clause(root)})))')
    return Predicate(sql, {'vp_actor': actor.id, 'vp_level': actor.level})


def space_roles(conn, actor, space_id):
    if not space_id or not actor.authenticated:
        return set()
    rows = conn.execute('SELECT role FROM role_assignment WHERE principal_id = ? AND space_id = ? AND revoked_at IS NULL',
                        (actor.id, space_id)).fetchall()
    return {r[0] for r in rows}


def rule(conn, action):
    row = conn.execute('SELECT * FROM action_rule WHERE action = ?', (action,)).fetchone()
    if row is None:
        return None
    return dict(row, roles=set(json.loads(row['roles'])))


def check(conn, actor, action, resource=None):
    r = rule(conn, action)
    if r is None:
        return 'action_not_allowed'
    if r['flag'] and not flags.enabled(conn, r['flag']):
        return 'capability_unavailable'
    if not actor.authenticated:
        return 'unauthenticated'
    if actor.status != 'active':
        return 'action_not_allowed'
    roles = set(actor.roles)
    if r['roles'] and resource is not None:
        roles |= space_roles(conn, actor, resource.get('space_id'))
    role_ok = bool(roles & r['roles'])
    level_ok = r['min_level'] is not None and actor.level >= r['min_level']
    if not (level_ok or role_ok):
        return 'action_not_allowed'
    if r['owner_only'] and not role_ok and (resource is None or resource.get('author_id') != actor.id):
        return 'action_not_allowed'
    if r['require_totp'] and not actor.totp_enabled:
        return 'totp_setup_required'
    return None


def require(conn, actor, action, resource=None):
    code = check(conn, actor, action, resource)
    if code:
        raise ApiError(code)


def can(conn, actor, action, resource=None):
    return check(conn, actor, action, resource) is None


def capabilities(conn, actor):
    actions = [r[0] for r in conn.execute('SELECT action FROM action_rule WHERE owner_only = 0 ORDER BY action')]
    return [a for a in actions if can(conn, actor, a)]


def explain(conn, actor, action):
    """动作不可用的原因；可用返回 None。顺序与 check() 一致，给 /api/me 的 capability_reasons 用。

    reason：feature_off 功能没开 · unauthenticated 没登录 · status 账号状态不允许 ·
    level 等级不够（带 min_level / level）· role 角色不对（带 roles）· totp 要先开动态验证码。
    """
    r = rule(conn, action)
    if r is None:
        return {'reason': 'unknown_action'}
    if r['flag'] and not flags.enabled(conn, r['flag']):
        return {'reason': 'feature_off'}
    if not actor.authenticated:
        return {'reason': 'unauthenticated'}
    if actor.status != 'active':
        return {'reason': 'status'}
    roles = set(actor.roles)
    role_ok = bool(roles & r['roles'])
    level_ok = r['min_level'] is not None and actor.level >= r['min_level']
    if not (level_ok or role_ok):
        if r['min_level'] is not None:
            out = {'reason': 'level', 'min_level': r['min_level'], 'level': actor.level}
            if r['roles']:
                out['roles'] = sorted(r['roles'])
            return out
        return {'reason': 'role', 'roles': sorted(r['roles'])}
    if r['require_totp'] and not actor.totp_enabled:
        return {'reason': 'totp'}
    return None


def capability_reasons(conn, actor):
    """capabilities() 里没列出的每个动作为什么不可用：{动作: {reason, ...}}。"""
    out = {}
    for (action,) in conn.execute('SELECT action FROM action_rule WHERE owner_only = 0 ORDER BY action').fetchall():
        why = explain(conn, actor, action)
        if why:
            out[action] = why
    return out
