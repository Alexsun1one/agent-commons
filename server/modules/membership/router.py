from calendar import monthrange
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from app import clock, flags
from app.authz import require
from app.context import Ctx, ok, user_ctx

from modules.growth import rules as growth_rules

from . import hooks  # noqa: F401


from . import privacy  # noqa: F401 — register member export

router = APIRouter(prefix='/api/membership')


def gate(ctx: Ctx) -> None:
    flags.gate(ctx.db.conn(), 'membership.enabled')


def profile_level(conn, principal_id: str) -> int:
    row = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (principal_id,)).fetchone()
    return int(row['level']) if row else 1


def current_month() -> str:
    return datetime.fromtimestamp(clock.now_ts(), tz=timezone.utc).strftime('%Y-%m')


def period_details(conn, period: str) -> dict:
    if period == 'month':
        key = current_month()
        year, month = (int(part) for part in key.split('-'))
        return {'key': key, 'label': f'{key} 月', 'days': monthrange(year, month)[1]}
    if period == 'season':
        season = growth_rules.season_row(conn)
        if season is None:
            return {'key': None, 'label': '当前没有进行中的赛季'}
        view = growth_rules.season_view(season)
        return {'key': season['id'], 'label': view['name'], 'startsAt': view['startsAt'], 'endsAt': view['endsAt']}
    return {'key': 'account', 'label': '账号上限'}


def quota_for(conn, benefit_key: str, level: int):
    return conn.execute(
        'SELECT level, quota FROM membership_benefit_quota '
        'WHERE benefit_key = ? AND level <= ? ORDER BY level DESC LIMIT 1',
        (benefit_key, level),
    ).fetchone()


def benefit_rows(conn, level: int, principal_id: str | None = None) -> list[dict]:
    unlocks = growth_rules.effective_unlocks(conn)
    rows = conn.execute(
        'SELECT key, name, description, action_key, quota_unit, quota_period '
        'FROM membership_benefit ORDER BY sort_order, key'
    ).fetchall()
    result = []
    for row in rows:
        quota = quota_for(conn, row['key'], level)
        own_min = conn.execute(
            'SELECT min(level) FROM membership_benefit_quota WHERE benefit_key = ?', (row['key'],)
        ).fetchone()[0]
        action = unlocks.get(row['action_key']) if row['action_key'] else None
        min_level = max(int(own_min), int(action['min_level'])) if action else int(own_min)
        available = level >= min_level and quota is not None
        period = period_details(conn, row['quota_period'])
        used = 0
        if principal_id and period['key'] is not None:
            usage = conn.execute(
                'SELECT used FROM membership_usage '
                'WHERE principal_id = ? AND benefit_key = ? AND period_key = ?',
                (principal_id, row['key'], period['key']),
            ).fetchone()
            used = int(usage['used']) if usage else 0
        limit = int(quota['quota']) if quota is not None and available else 0
        item = {
            'key': row['key'],
            'name': row['name'],
            'description': row['description'],
            'actionKey': row['action_key'],
            'minLevel': min_level,
            'available': available,
            'quota': limit,
            'unit': row['quota_unit'],
            'period': row['quota_period'],
            'periodLabel': period['label'],
        }
        if principal_id:
            item.update({
                'used': used,
                'remaining': max(0, limit - used),
                'periodKey': period['key'],
            })
        result.append(item)
    return result


@router.get('/benefits')
def get_benefits(level: int = Query(ge=1, le=5), ctx: Ctx = Depends(user_ctx)):
    gate(ctx)
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'membership.benefits.read')
    return ok(ctx, {
        'level': level,
        'levelName': growth_rules.LEVEL_NAMES[level],
        'benefits': benefit_rows(conn, level),
        'note': '等级只解锁能力；会员权益不改等级、不给管理权、不能买贡献值。',
    })


@router.get('/me')
def get_me(ctx: Ctx = Depends(user_ctx)):
    gate(ctx)
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'membership.me.read')
    level = profile_level(conn, ctx.actor.id)
    return ok(ctx, {
        'level': level,
        'levelName': growth_rules.LEVEL_NAMES[level],
        'benefits': benefit_rows(conn, level, ctx.actor.id),
        'note': '用量按各权益的月、赛季或账号周期分别计算。',
    })
