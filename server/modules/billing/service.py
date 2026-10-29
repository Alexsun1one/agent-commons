"""R13 BIZ-1 · 计划、权益映射、订阅状态机、订单、候补名单。

订阅状态机（`TRANSITIONS`）：
    新建 → 候补 waitlist | 试用 trial | 生效 active（只能由已付款订单触发）
    候补 → 试用 | 生效（付款）| 取消
    试用 → 生效（付款）| 过期 | 取消
    生效 → 生效（付款续期）| 过期 | 取消
    过期、取消是终态；再买就新开一条订阅。
取消不收回当期：取消后的订阅在 period_end 之前仍然有效。
权益只叠加在 membership 已经按等级解锁的能力上（`available` 为真才加），不替等级解锁任何能力。
"""
import uuid

from app import audit, clock, outbox
from app.errors import ApiError

from . import payments

STATES = ('waitlist', 'trial', 'active', 'expired', 'canceled')
OPEN_STATES = ('waitlist', 'trial', 'active')
GRANTING_STATES = ('trial', 'active', 'canceled')
TRANSITIONS = {
    None: frozenset({'waitlist', 'trial', 'active'}),
    'waitlist': frozenset({'trial', 'active', 'canceled'}),
    'trial': frozenset({'active', 'expired', 'canceled'}),
    'active': frozenset({'active', 'expired', 'canceled'}),
    'expired': frozenset(),
    'canceled': frozenset(),
}
PERIOD_DAYS = {'month': 30, 'year': 365}
DAY = 86400
ADMIN_REASONS = ('pilot', 'instructor', 'contributor', 'support', 'correction')
WAITLIST_SOURCES = ('pricing', 'teams', 'creator', 'sponsor', 'other')


def ready(conn):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'billing_subscription'").fetchone() is not None


def new_id():
    return str(uuid.uuid4())


def config(conn, key, default):
    row = conn.execute('SELECT value FROM billing_config WHERE key = ?', (key,)).fetchone()
    return row['value'] if row else default


def config_int(conn, key, default):
    try:
        return int(config(conn, key, str(default)))
    except ValueError:
        return default


# ---------------------------------------------------------------- 状态机


def can_transition(current, target):
    return target in TRANSITIONS.get(current, frozenset())


def check_transition(current, target, *, paid=False):
    if not can_transition(current, target):
        raise ApiError('billing_transition_invalid')
    if target == 'active' and not paid:
        raise ApiError('billing_transition_invalid', '生效只能由已付款的订单触发')


def _period_end(start_ts, days):
    return clock.iso(start_ts + days * DAY)


def _event(conn, sub_id, from_state, to_state, reason, actor_id, order_id=None):
    conn.execute(
        'INSERT INTO billing_subscription_event (id, subscription_id, from_state, to_state, reason, actor_id, order_id, at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (new_id(), sub_id, from_state, to_state, reason, actor_id, order_id, clock.now()))


def _announce(conn, sub, from_state, reason, actor_id, request_id):
    audit.record(conn, actor_id, 'billing.subscription.transition', 'billing_subscription', sub['id'],
                 reason=reason, request_id=request_id,
                 meta={'from': from_state, 'to': sub['state'], 'plan': sub['plan_key']})
    outbox.emit(conn, 'billing.subscription_changed', 'billing_subscription', sub['id'],
                {'principal_id': sub['principal_id'], 'plan': sub['plan_key'], 'from': from_state,
                 'to': sub['state'], 'period_end': sub['period_end']},
                actor_id=actor_id, request_id=request_id)


def subscription(conn, sub_id):
    row = conn.execute('SELECT * FROM billing_subscription WHERE id = ?', (sub_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return dict(row)


def open_subscription(conn, principal_id):
    row = conn.execute(
        "SELECT * FROM billing_subscription WHERE principal_id = ? AND state IN ('waitlist', 'trial', 'active')",
        (principal_id,)).fetchone()
    return dict(row) if row else None


def create_subscription(conn, *, principal_id, plan_key, cycle, seats, state, source, reason, actor_id,
                        days=None, order_id=None, request_id=None):
    check_transition(None, state, paid=source == 'payment')
    if open_subscription(conn, principal_id) is not None:
        raise ApiError('billing_transition_invalid', '已经有一条候补、试用或生效中的订阅')
    now_ts = clock.now_ts()
    start = end = None
    if state != 'waitlist':
        start, end = clock.iso(now_ts), _period_end(now_ts, days if days else PERIOD_DAYS[cycle])
    sub_id, now = new_id(), clock.now()
    conn.execute(
        'INSERT INTO billing_subscription (id, principal_id, plan_key, cycle, seats, state, source, period_start, '
        'period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (sub_id, principal_id, plan_key, cycle, seats, state, source, start, end, now, now))
    _event(conn, sub_id, None, state, reason, actor_id, order_id)
    sub = subscription(conn, sub_id)
    _announce(conn, sub, None, reason, actor_id, request_id)
    return sub


def transition(conn, sub, to_state, *, reason, actor_id, paid=False, days=None, order_id=None, request_id=None):
    from_state = sub['state']
    check_transition(from_state, to_state, paid=paid)
    now_ts = clock.now_ts()
    start, end = sub['period_start'], sub['period_end']
    if to_state in ('trial', 'active'):
        length = days if days else PERIOD_DAYS[sub['cycle']]
        if from_state == 'active' and to_state == 'active' and end and clock.parse(end) > now_ts:
            end = _period_end(clock.parse(end), length)          # 续期从当期末尾接上
        else:
            start, end = clock.iso(now_ts), _period_end(now_ts, length)
    elif to_state == 'expired' and (not end or clock.parse(end) > now_ts):
        end = clock.iso(now_ts)                                   # 提前过期：权益立即停止
    conn.execute('UPDATE billing_subscription SET state = ?, period_start = ?, period_end = ?, updated_at = ? '
                 'WHERE id = ?', (to_state, start, end, clock.now(), sub['id']))
    _event(conn, sub['id'], from_state, to_state, reason, actor_id, order_id)
    updated = subscription(conn, sub['id'])
    _announce(conn, updated, from_state, reason, actor_id, request_id)
    return updated


def current(conn, principal_id, now=None):
    """当前给权益的订阅：试用、生效，或已取消但当期未结束的。候补不给权益。"""
    row = conn.execute(
        "SELECT * FROM billing_subscription WHERE principal_id = ? AND state IN ('trial', 'active', 'canceled') "
        "AND period_end IS NOT NULL AND period_end > ? "
        "ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'trial' THEN 1 ELSE 2 END, period_end DESC LIMIT 1",
        (principal_id, now or clock.now())).fetchone()
    return dict(row) if row else None


def due_ids(conn, now=None, principal_id=None, limit=200):
    sql = ("SELECT id FROM billing_subscription WHERE state IN ('trial', 'active') AND period_end <= ?"
           + (' AND principal_id = ?' if principal_id else '') + ' ORDER BY period_end LIMIT ?')
    params = (now or clock.now(),) + ((principal_id,) if principal_id else ()) + (limit,)
    return [r['id'] for r in conn.execute(sql, params)]


def expire(conn, sub_id, request_id=None):
    sub = subscription(conn, sub_id)
    if sub['state'] not in ('trial', 'active') or (sub['period_end'] and sub['period_end'] > clock.now()):
        return None
    return transition(conn, sub, 'expired', reason='period.ended', actor_id=None, request_id=request_id)


# ---------------------------------------------------------------- 计划与权益


def _has_table(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def membership_benefits(conn):
    """从 membership 只读：权益名、单位、周期、各等级额度。membership 没装时返回空。"""
    if not _has_table(conn, 'membership_benefit'):
        return {}
    result = {}
    for row in conn.execute('SELECT key, name, action_key, quota_unit, quota_period FROM membership_benefit '
                            'ORDER BY sort_order, key'):
        levels = {str(q['level']): q['quota'] for q in conn.execute(
            'SELECT level, quota FROM membership_benefit_quota WHERE benefit_key = ? ORDER BY level', (row['key'],))}
        result[row['key']] = {'key': row['key'], 'name': row['name'], 'actionKey': row['action_key'],
                              'unit': row['quota_unit'], 'period': row['quota_period'], 'levels': levels}
    return result


def plan_row(conn, key, *, purchasable=False):
    row = conn.execute('SELECT * FROM billing_plan WHERE key = ? AND active = 1', (key,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found', '没有这个方案')
    if purchasable and row['price_month_fen'] == 0 and row['price_year_fen'] == 0:
        raise ApiError('validation_failed', '免费方案不用加入候补')
    return dict(row)


def entitlements(conn, plan_key):
    return [dict(r) for r in conn.execute(
        'SELECT benefit_key, mode, amount FROM billing_entitlement WHERE plan_key = ? ORDER BY benefit_key', (plan_key,))]


def perks(conn, plan_key):
    return [{'key': r['perk_key'], 'name': r['name'], 'description': r['description']} for r in conn.execute(
        'SELECT perk_key, name, description FROM billing_perk WHERE plan_key = ? ORDER BY sort_order', (plan_key,))]


def yuan(fen):
    return fen // 100 if fen % 100 == 0 else fen / 100


def plan_view(conn, row, benefits):
    items = []
    for ent in entitlements(conn, row['key']):
        info = benefits.get(ent['benefit_key'], {})
        levels = info.get('levels') or {}
        items.append({'benefitKey': ent['benefit_key'], 'name': info.get('name', ent['benefit_key']),
                      'unit': info.get('unit'), 'period': info.get('period'), 'mode': ent['mode'],
                      'amount': ent['amount'], 'minLevel': int(min(levels, key=int)) if levels else None})
    return {
        'key': row['key'], 'name': row['name'], 'tagline': row['tagline'], 'scope': row['scope'],
        'perSeat': bool(row['per_seat']), 'minSeats': row['min_seats'], 'currency': row['currency'],
        'price': {'month': yuan(row['price_month_fen']), 'year': yuan(row['price_year_fen'])},
        'priceStatus': row['price_status'], 'entitlements': items, 'perks': perks(conn, row['key']),
    }


def plans(conn):
    benefits = membership_benefits(conn)
    rows = conn.execute('SELECT * FROM billing_plan WHERE active = 1 ORDER BY sort_order').fetchall()
    return {
        'currency': 'CNY',
        'plans': [plan_view(conn, dict(r), benefits) for r in rows],
        'benefits': list(benefits.values()),
        'neverForSale': ['等级', '成员邀请', '曝光与排名', '知识'],
    }


def amount_fen(plan, cycle, seats):
    unit = plan['price_year_fen'] if cycle == 'year' else plan['price_month_fen']
    return unit * (seats if plan['per_seat'] else 1)


def normalize_seats(plan, seats):
    if not plan['per_seat']:
        return 1
    seats = seats or plan['min_seats']
    if seats < plan['min_seats']:
        raise ApiError('validation_failed', f'这个方案至少 {plan["min_seats"]} 席')
    return seats


def effective_benefits(conn, principal_id, level, sub):
    if not _has_table(conn, 'membership_benefit'):
        return []
    from modules.membership import router as membership   # 只读调用，权益以 membership 为准
    rows = membership.benefit_rows(conn, level, principal_id)
    bonus = {e['benefit_key']: e['amount'] for e in entitlements(conn, sub['plan_key'])} if sub else {}
    for row in rows:
        extra = bonus.get(row['key'], 0)
        row['planBonus'] = extra if row['available'] else 0
        row['bonusWaitingForLevel'] = 0 if row['available'] else extra
        row['effectiveQuota'] = row['quota'] + row['planBonus']
        if 'used' in row:
            row['remaining'] = max(0, row['effectiveQuota'] - row['used'])
    return rows


# ---------------------------------------------------------------- 候补名单


def waitlist_view(row, plan=None):
    view = {'id': row['id'], 'plan': row['plan_key'], 'cycle': row['cycle'], 'seats': row['seats'],
            'source': row['source'], 'joinedAt': row['created_at'], 'updatedAt': row['updated_at']}
    if plan is not None:
        view['planName'] = plan['name']
        view['quote'] = {'currency': plan['currency'], 'amount': yuan(amount_fen(plan, row['cycle'], row['seats'])),
                         'priceStatus': plan['price_status']}
    return view


def join_waitlist(conn, actor, *, plan_key, cycle, seats, source, request_id=None):
    plan = plan_row(conn, plan_key, purchasable=True)
    seats = normalize_seats(plan, seats)
    existing = conn.execute('SELECT * FROM billing_waitlist WHERE principal_id = ? AND plan_key = ?',
                            (actor.id, plan_key)).fetchone()
    now = clock.now()
    if existing is not None:
        if (existing['cycle'], existing['seats']) != (cycle, seats):
            conn.execute('UPDATE billing_waitlist SET cycle = ?, seats = ?, updated_at = ? WHERE id = ?',
                         (cycle, seats, now, existing['id']))
        row = conn.execute('SELECT * FROM billing_waitlist WHERE id = ?', (existing['id'],)).fetchone()
        return waitlist_view(row, plan), True
    entry_id = new_id()
    conn.execute('INSERT INTO billing_waitlist (id, principal_id, plan_key, cycle, seats, source, created_at, '
                 'updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                 (entry_id, actor.id, plan_key, cycle, seats, source, now, now))
    audit.record(conn, actor.id, 'billing.waitlist.join', 'billing_waitlist', entry_id, request_id=request_id,
                 meta={'plan': plan_key, 'cycle': cycle, 'seats': seats, 'source': source})
    outbox.emit(conn, 'billing.waitlist_joined', 'billing_waitlist', entry_id,
                {'principal_id': actor.id, 'plan': plan_key, 'cycle': cycle}, actor_id=actor.id, request_id=request_id)
    row = conn.execute('SELECT * FROM billing_waitlist WHERE id = ?', (entry_id,)).fetchone()
    return waitlist_view(row, plan), False


def leave_waitlist(conn, actor, plan_key, request_id=None):
    row = conn.execute('SELECT id FROM billing_waitlist WHERE principal_id = ? AND plan_key = ?',
                       (actor.id, plan_key)).fetchone()
    if row is None:
        return False
    conn.execute('DELETE FROM billing_waitlist WHERE id = ?', (row['id'],))
    audit.record(conn, actor.id, 'billing.waitlist.leave', 'billing_waitlist', row['id'], request_id=request_id,
                 meta={'plan': plan_key})
    return True


# ---------------------------------------------------------------- 订单


def order_view(row):
    return {'id': row['id'], 'plan': row['plan_key'], 'cycle': row['cycle'], 'seats': row['seats'],
            'amount': yuan(row['amount_fen']), 'currency': row['currency'], 'provider': row['provider'],
            'state': row['state'], 'subscriptionId': row['subscription_id'], 'createdAt': row['created_at']}


def create_order(conn, actor, *, plan_key, cycle, seats, request_id=None):
    """只有 billing.payments 打开、并且配置的渠道不是 disabled 时才会走到这里。"""
    plan = plan_row(conn, plan_key, purchasable=True)
    seats = normalize_seats(plan, seats)
    adapter = payments.get(config(conn, 'payments.provider', 'disabled'))
    order_id, now = new_id(), clock.now()
    order = {'id': order_id, 'principal_id': actor.id, 'plan_key': plan_key, 'cycle': cycle, 'seats': seats,
             'amount_fen': amount_fen(plan, cycle, seats), 'currency': plan['currency'], 'provider': adapter.name}
    checkout = adapter.create_checkout(dict(order))            # disabled 渠道在这里抛 billing_provider_unavailable
    conn.execute('INSERT INTO billing_order (id, principal_id, plan_key, cycle, seats, amount_fen, currency, provider, '
                 "provider_ref, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
                 (order_id, actor.id, plan_key, cycle, seats, order['amount_fen'], order['currency'], adapter.name,
                  checkout.get('provider_ref'), now, now))
    audit.record(conn, actor.id, 'billing.order.create', 'billing_order', order_id, request_id=request_id,
                 meta={'plan': plan_key, 'cycle': cycle, 'seats': seats, 'provider': adapter.name})
    row = conn.execute('SELECT * FROM billing_order WHERE id = ?', (order_id,)).fetchone()
    return dict(order_view(row), checkoutUrl=checkout.get('checkout_url'))


def mark_paid(conn, order_id, *, provider_ref=None, request_id=None):
    """渠道回调确认付款后调用：订单 → paid，订阅 → 生效（或续期）。"""
    row = conn.execute('SELECT * FROM billing_order WHERE id = ?', (order_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['state'] == 'paid':
        return subscription(conn, row['subscription_id'])
    if row['state'] not in ('created', 'pending'):
        raise ApiError('billing_transition_invalid', '订单当前状态不能确认付款')
    order = dict(row)
    sub = open_subscription(conn, order['principal_id'])
    days = PERIOD_DAYS[order['cycle']]
    if sub is not None and sub['plan_key'] != order['plan_key']:
        sub = transition(conn, sub, 'canceled', reason='plan.change', actor_id=None, request_id=request_id)
        sub = None
    if sub is None:
        sub = create_subscription(conn, principal_id=order['principal_id'], plan_key=order['plan_key'],
                                  cycle=order['cycle'], seats=order['seats'], state='active', source='payment',
                                  reason='order.paid', actor_id=None, days=days, order_id=order_id,
                                  request_id=request_id)
    else:
        conn.execute("UPDATE billing_subscription SET cycle = ?, seats = ?, source = 'payment' WHERE id = ?",
                     (order['cycle'], order['seats'], sub['id']))
        sub = transition(conn, subscription(conn, sub['id']), 'active', reason='order.paid', actor_id=None,
                         paid=True, days=days, order_id=order_id, request_id=request_id)
    conn.execute("UPDATE billing_order SET state = 'paid', provider_ref = COALESCE(?, provider_ref), "
                 'subscription_id = ?, updated_at = ? WHERE id = ?', (provider_ref, sub['id'], clock.now(), order_id))
    conn.execute('DELETE FROM billing_waitlist WHERE principal_id = ? AND plan_key = ?',
                 (order['principal_id'], order['plan_key']))
    return sub


# ---------------------------------------------------------------- 读视图


def subscription_view(sub):
    if sub is None:
        return None
    return {'id': sub['id'], 'plan': sub['plan_key'], 'cycle': sub['cycle'], 'seats': sub['seats'],
            'state': sub['state'], 'source': sub['source'], 'periodStart': sub['period_start'],
            'periodEnd': sub['period_end']}


def me(conn, actor, payments_enabled):
    live = current(conn, actor.id)
    opened = open_subscription(conn, actor.id)
    plan_key = live['plan_key'] if live else 'free'
    plan_cache = {}

    def plan_for(key):
        if key not in plan_cache:
            row = conn.execute('SELECT * FROM billing_plan WHERE key = ?', (key,)).fetchone()
            plan_cache[key] = dict(row) if row else None
        return plan_cache[key]

    level = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (actor.id,)).fetchone()
    level = int(level['level']) if level else 1
    waitlist = [waitlist_view(r, plan_for(r['plan_key'])) for r in conn.execute(
        'SELECT * FROM billing_waitlist WHERE principal_id = ? ORDER BY created_at', (actor.id,))]
    orders = [order_view(r) for r in conn.execute(
        'SELECT * FROM billing_order WHERE principal_id = ? ORDER BY created_at DESC LIMIT 10', (actor.id,))]
    return {
        'plan': plan_key,
        'planName': (plan_for(plan_key) or {}).get('name', '免费'),
        'level': level,
        'subscription': subscription_view(live),
        'openSubscription': subscription_view(opened) if opened and (not live or opened['id'] != live['id']) else None,
        'benefits': effective_benefits(conn, actor.id, level, live),
        'perks': perks(conn, plan_key) if live else [],
        'waitlist': waitlist,
        'orders': orders,
        'paymentsEnabled': payments_enabled,
    }


def overview(conn):
    waitlist = [dict(r) for r in conn.execute(
        'SELECT plan_key AS plan, cycle, count(*) AS people, sum(seats) AS seats FROM billing_waitlist '
        'GROUP BY plan_key, cycle ORDER BY plan_key, cycle')]
    subs = {r['state']: r['n'] for r in conn.execute(
        'SELECT state, count(*) AS n FROM billing_subscription GROUP BY state')}
    orders = {r['state']: r['n'] for r in conn.execute('SELECT state, count(*) AS n FROM billing_order GROUP BY state')}
    return {'waitlist': waitlist, 'subscriptions': {s: subs.get(s, 0) for s in STATES}, 'orders': orders,
            'provider': config(conn, 'payments.provider', 'disabled')}


def admin_waitlist(conn, plan_key=None, limit=50):
    sql = ('SELECT w.*, c.handle, p.level FROM billing_waitlist w LEFT JOIN credential c ON c.principal_id = w.principal_id '
           'LEFT JOIN profile p ON p.principal_id = w.principal_id')
    params = ()
    if plan_key:
        sql += ' WHERE w.plan_key = ?'
        params = (plan_key,)
    sql += ' ORDER BY w.created_at DESC LIMIT ?'
    return [dict(waitlist_view(r), handle=r['handle'], level=r['level'])
            for r in conn.execute(sql, params + (limit,))]


def admin_subscriptions(conn, state=None, limit=50):
    sql = ('SELECT s.*, c.handle FROM billing_subscription s '
           'LEFT JOIN credential c ON c.principal_id = s.principal_id')
    params = ()
    if state:
        sql += ' WHERE s.state = ?'
        params = (state,)
    sql += ' ORDER BY s.updated_at DESC LIMIT ?'
    return [dict(subscription_view(dict(r)), handle=r['handle']) for r in conn.execute(sql, params + (limit,))]


# ---------------------------------------------------------------- 导出与注销清理


def export(conn, actor):
    if not ready(conn):
        return {}
    pid = actor.id
    subs = [dict(r) for r in conn.execute('SELECT * FROM billing_subscription WHERE principal_id = ?', (pid,))]
    for sub in subs:
        sub['events'] = [dict(e) for e in conn.execute(
            'SELECT from_state, to_state, reason, at FROM billing_subscription_event WHERE subscription_id = ? '
            'ORDER BY at', (sub['id'],))]
    return {
        'waitlist': [dict(r) for r in conn.execute('SELECT plan_key, cycle, seats, source, created_at FROM '
                                                   'billing_waitlist WHERE principal_id = ?', (pid,))],
        'subscriptions': subs,
        'orders': [order_view(r) for r in conn.execute('SELECT * FROM billing_order WHERE principal_id = ?', (pid,))],
    }


def purge(conn, principal_id):
    """注销冷静期到期：删候补、订阅与流水、未成交订单；已付款和已退款的订单留作账务记录（主体已由核心匿名化）。"""
    if not ready(conn):
        return
    conn.execute('DELETE FROM billing_waitlist WHERE principal_id = ?', (principal_id,))
    conn.execute('UPDATE billing_order SET subscription_id = NULL WHERE principal_id = ?', (principal_id,))
    conn.execute("DELETE FROM billing_order WHERE principal_id = ? AND state NOT IN ('paid', 'refunded')",
                 (principal_id,))
    conn.execute('DELETE FROM billing_subscription_event WHERE subscription_id IN '
                 '(SELECT id FROM billing_subscription WHERE principal_id = ?)', (principal_id,))
    conn.execute('DELETE FROM billing_subscription WHERE principal_id = ?', (principal_id,))
