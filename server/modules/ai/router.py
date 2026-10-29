"""模型网关的 HTTP 接口：管理台（admin + TOTP）和成员自己的「关掉哪些模型功能」。

模型调用本身不走 HTTP：其他模块在 Python 里调 modules.ai.gateway.run(...)。
功能开关的切换沿用核心的 POST /api/admin/flags（键见 catalog：ai.enabled、ai.<功能>.enabled）。
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, audit, clock, flags, idempotency, outbox, security
from app.authz import require
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import ApiError

from . import budget, cache, catalog, gateway
from . import hooks  # noqa: F401 — account lifecycle registration

router = APIRouter(prefix='/api/ai')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class BudgetIn(Strict):
    daily_calls: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    daily_cost_usd: Optional[float] = Field(default=None, ge=0, le=10_000)
    cache_ttl_seconds: Optional[int] = Field(default=None, ge=0, le=90 * 86400)


class PrefIn(Strict):
    feature: str = Field(max_length=64)
    opted_out: bool


def admin_ctx(ctx: Ctx = Depends(user_ctx)) -> Ctx:
    security.limit(ctx.request, 'admin', ctx.actor.id)
    return ctx


@router.get('/status')
def status(ctx: Ctx = Depends(admin_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'ai.admin.read')
    return ok(ctx, gateway.default().describe(conn))


@router.get('/calls')
def recent_calls(kind: str = Query(default='failures', pattern='^(failures|fallbacks|all)$'),
                 feature: Optional[str] = Query(default=None, max_length=64),
                 limit: int = Query(default=20, ge=1, le=100), ctx: Ctx = Depends(admin_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'ai.admin.read')
    where, params = [], []
    if kind == 'failures':
        denied = sorted(gateway.DENIED)
        where.append(f"result = 'fallback' AND reason_code NOT IN ({','.join('?' * len(denied))})")
        params += denied
    elif kind == 'fallbacks':
        where.append("result = 'fallback'")
    if feature:
        where.append('feature = ?')
        params.append(feature)
    sql = ('SELECT id, occurred_at, feature, task, provider, model, result, reason_code, input_chars, output_chars, '
           'input_tokens, output_tokens, cost_micros, latency_ms, redactions_json FROM ai_call'
           + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY occurred_at DESC LIMIT ?')
    rows = conn.execute(sql, (*params, limit)).fetchall()
    data = []
    for r in rows:
        item = dict(r)
        item['cost_usd'] = item.pop('cost_micros') / 1e6
        item['redactions'] = json.loads(item.pop('redactions_json'))
        data.append(item)
    return ok(ctx, data)


@router.post('/budgets/{feature}')
def set_budget(feature: str, body: BudgetIn, ctx: Ctx = Depends(admin_ctx)):
    if feature not in catalog.FEATURES:
        raise ApiError('resource_not_found')
    if body.daily_calls is None and body.daily_cost_usd is None and body.cache_ttl_seconds is None:
        raise ApiError('validation_failed', '至少改一项：daily_calls、daily_cost_usd 或 cache_ttl_seconds')

    def work(conn):
        require(conn, ctx.actor, 'ai.admin.budget')
        new = budget.set_budget(conn, feature, ctx.actor.id, ctx.request_id, daily_calls=body.daily_calls,
                                daily_cost_usd=body.daily_cost_usd, cache_ttl_s=body.cache_ttl_seconds)
        return 200, ok(ctx, {'feature': feature, 'daily_calls': new['daily_calls'],
                             'daily_cost_usd': new['daily_cost_micros'] / 1e6, 'cache_ttl_seconds': new['cache_ttl_s']})
    return idempotency.run(ctx, body.model_dump(), work)


def _prefs(conn, actor_id):
    rows = {r[0]: bool(r[1]) for r in conn.execute(
        'SELECT feature, opted_out FROM ai_member_pref WHERE principal_id = ?', (actor_id,))}
    on = flags.enabled(conn, catalog.GLOBAL_FLAG)
    return [{'feature': name, 'opted_out': rows.get(name, False), 'available': on and flags.enabled(conn, spec.flag)}
            for name, spec in catalog.FEATURES.items() if spec.opt_out]


@router.get('/me/prefs')
def my_prefs(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    require(conn, ctx.actor, 'ai.member.prefs')
    return ok(ctx, _prefs(conn, ctx.actor.id))


@router.post('/me/prefs')
def set_my_pref(body: PrefIn, ctx: Ctx = Depends(write_ctx)):
    spec = catalog.FEATURES.get(body.feature)
    if spec is None or not spec.opt_out:
        raise ApiError('validation_failed', '这个功能不能由成员关闭')

    def work(conn):
        require(conn, ctx.actor, 'ai.member.prefs')
        conn.execute('INSERT INTO ai_member_pref (principal_id, feature, opted_out, updated_at) VALUES (?, ?, ?, ?) '
                     'ON CONFLICT(principal_id, feature) DO UPDATE SET opted_out = excluded.opted_out, '
                     'updated_at = excluded.updated_at', (ctx.actor.id, body.feature, int(body.opted_out), clock.now()))
        audit.record(conn, ctx.actor.id, 'ai.member.pref', 'ai_feature', body.feature, request_id=ctx.request_id,
                     meta={'opted_out': body.opted_out})
        return 200, ok(ctx, _prefs(conn, ctx.actor.id))
    return idempotency.run(ctx, body.model_dump(), work)


def on_object_event(conn, event):
    """对象改了、撤回了、隐藏了：删掉以它为输入的缓存结果，模型摘要不比原文活得久。"""
    if event['event_type'] != 'object.created':
        cache.purge_object(conn, event['aggregate_id'])


def export_member(conn, actor):
    prefs = [dict(r) for r in conn.execute(
        'SELECT feature, opted_out, updated_at FROM ai_member_pref WHERE principal_id = ? ORDER BY feature',
        (actor.id,))]
    calls = [dict(r) for r in conn.execute(
        'SELECT feature, count(*) AS calls FROM ai_call WHERE actor_id = ? GROUP BY feature ORDER BY feature',
        (actor.id,))]
    return {'prefs': prefs, 'calls_by_feature': calls}


outbox.subscribe('ai.cache_purge', 'object.*', on_object_event)
accounts.register_exporter('ai', export_member)
