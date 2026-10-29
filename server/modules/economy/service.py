"""R13 ECON-1 bamboo ledger, shop, inventory and check-in services.

Every mutation accepts an existing SQLite connection. Callers are responsible for
opening ``Database.write()`` so ledger, cached balance and the business mutation
commit atomically.
"""
import re
import uuid
from datetime import datetime, timezone

from app import audit, clock, outbox
from app.authz import require
from app.errors import ApiError
from modules.admin import params as admin_params


CURRENCY = 'bamboo'
DAY = 86400
REASON = re.compile(r'(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*\Z')
CATEGORY_LABELS = {
    'avatar_frame': '头像框',
    'panda_palette': '熊猫配色',
    'farm_decor': '农场装饰',
    'vehicle': '车型',
    'sticker_pack': '表情包',
}
REASON_LABELS = {
    'economy.checkin': '每日签到',
    'shop.purchase': '竹子商店购买',
    'admin_adjust': '管理员调账',
    'farm.harvest': '农场收获',
    'farm.steal': '农场结算',
    'parking.fine': '车位结算',
    'games.reward': '游戏奖励',
}

admin_params.declare('economy', 'daily_credit_cap', 'new_account_days',
                     *(f'checkin_day_{day}' for day in range(1, 8)))


def _id():
    return str(uuid.uuid4())


def _amount(value):
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ApiError('validation_failed', '数量必须是正整数')
    return value


def _reason(value, *, admin=False):
    if admin and value == 'admin_adjust':
        return value
    if not isinstance(value, str) or len(value) > 96 or not REASON.fullmatch(value):
        raise ApiError('validation_failed', 'reason 要写成 module.action')
    return value


def _currency(conn, currency):
    row = conn.execute('SELECT enabled FROM economy_currency WHERE code = ?', (currency,)).fetchone()
    if row is None or not row['enabled']:
        raise ApiError('capability_unavailable', '这种货币还没有开放')
    return currency


def _day(ts=None):
    return datetime.fromtimestamp(clock.now_ts() if ts is None else ts, timezone.utc).strftime('%Y-%m-%d')


def _day_bounds(day):
    start = datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp()
    return clock.iso(start), clock.iso(start + DAY)


def _rule(conn, key):
    row = conn.execute('SELECT value FROM economy_rule WHERE key = ?', (key,)).fetchone()
    if row is None:
        raise RuntimeError(f'missing economy rule: {key}')
    # ADMIN-3 is authoritative. economy_rule remains a read-only migration source/fallback.
    return admin_params.value(conn, 'economy', key, row['value'])


def _checkin_reward(conn, cycle_day):
    row = conn.execute('SELECT amount FROM economy_checkin_reward WHERE cycle_day = ?', (cycle_day,)).fetchone()
    if row is None:
        raise RuntimeError(f'missing check-in reward: {cycle_day}')
    return admin_params.value(conn, 'economy', f'checkin_day_{cycle_day}', row['amount'])


def _operation(conn, key, *, kind, principal_id, counterparty_id, currency, requested, reason, ref):
    row = conn.execute('SELECT * FROM economy_operation WHERE idempotency_key = ?', (key,)).fetchone()
    if row is None:
        return None
    expected = (kind, principal_id, counterparty_id, currency, requested, reason, ref)
    actual = (row['kind'], row['principal_id'], row['counterparty_id'], row['currency'],
              row['requested_amount'], row['reason'], row['ref'])
    if actual != expected:
        raise ApiError('idempotency_conflict')
    return row['actual_amount']


def _save_operation(conn, key, *, kind, principal_id, counterparty_id, currency, requested, actual, reason, ref):
    conn.execute(
        'INSERT INTO economy_operation (idempotency_key, kind, principal_id, counterparty_id, currency, '
        'requested_amount, actual_amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (key, kind, principal_id, counterparty_id, currency, requested, actual, reason, ref, clock.now()))


def _entry(conn, *, principal_id, currency, amount, requested, reason, key, ref=None, counterparty_id=None):
    entry_id = _id()
    try:
        conn.execute(
            'INSERT INTO wallet_entry (id, principal_id, currency, amount, requested_amount, reason, '
            'idempotency_key, ref, counterparty_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (entry_id, principal_id, currency, amount, requested, reason, key, ref, counterparty_id, clock.now()))
    except Exception as exc:
        if ('wallet balance would be negative' in str(exc)
                or 'CHECK constraint failed: balance >= 0' in str(exc)):
            raise ApiError('insufficient_funds') from exc
        raise
    return entry_id


def balance(conn, principal_id, currency=CURRENCY):
    _currency(conn, currency)
    row = conn.execute('SELECT balance FROM wallet_balance WHERE principal_id = ? AND currency = ?',
                       (principal_id, currency)).fetchone()
    return row['balance'] if row else 0


def _account_cap(conn, principal_id, currency, reason, ts=None):
    cap = _rule(conn, 'daily_credit_cap')
    specific = conn.execute('SELECT daily_cap FROM economy_reason_limit WHERE currency = ? AND reason = ?',
                            (currency, reason)).fetchone()
    if specific is not None:
        cap = min(cap, specific['daily_cap'])
    principal = conn.execute('SELECT created_at FROM principal WHERE id = ?', (principal_id,)).fetchone()
    if principal is None:
        raise ApiError('resource_not_found')
    now = clock.now_ts() if ts is None else ts
    if clock.parse(principal['created_at']) > now - _rule(conn, 'new_account_days') * DAY:
        cap //= 2
    return cap


def _earned(conn, principal_id, currency, day):
    row = conn.execute('SELECT amount FROM wallet_daily_earning WHERE principal_id = ? AND currency = ? AND day = ?',
                       (principal_id, currency, day)).fetchone()
    return row['amount'] if row else 0


def _awardable(conn, principal_id, currency, reason, requested, ts=None):
    day = _day(ts)
    cap = _account_cap(conn, principal_id, currency, reason, ts)
    return max(0, min(requested, cap - _earned(conn, principal_id, currency, day))), day


def _count_earning(conn, principal_id, currency, day, amount):
    if not amount:
        return
    conn.execute(
        'INSERT INTO wallet_daily_earning (principal_id, currency, day, amount, updated_at) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT(principal_id, currency, day) DO UPDATE SET amount = wallet_daily_earning.amount + excluded.amount, '
        'updated_at = excluded.updated_at',
        (principal_id, currency, day, amount, clock.now()))


def _mark_anomaly(conn, kind, principal_id, peer_id, day, amount, payload):
    marker_id = _id()
    try:
        conn.execute('INSERT INTO economy_anomaly_marker (id, kind, principal_id, peer_id, day, amount, created_at) '
                     'VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (marker_id, kind, principal_id, peer_id or '', day, amount, clock.now()))
    except Exception as exc:
        if 'UNIQUE constraint failed' in str(exc):
            return None
        raise
    outbox.emit(conn, 'economy.anomaly', 'principal', principal_id,
                {'kind': kind, 'principal_id': principal_id, 'peer_id': peer_id, 'day': day,
                 'amount': amount, **payload})
    return marker_id


def _check_daily_anomaly(conn, principal_id, currency, day):
    start, end = _day_bounds(day)
    amount = conn.execute(
        'SELECT coalesce(sum(amount), 0) AS amount FROM wallet_entry '
        'WHERE principal_id = ? AND currency = ? AND created_at >= ? AND created_at < ?',
        (principal_id, currency, start, end)).fetchone()['amount']
    if amount >= _rule(conn, 'anomaly_daily_net'):
        _mark_anomaly(conn, 'daily_net_inflow', principal_id, '', day, amount,
                      {'currency': currency, 'signals': ['daily_net_inflow']})


def _check_pair_anomaly(conn, first, second, currency, day):
    low, high = sorted((first, second))
    start, end = _day_bounds(day)
    rows = conn.execute(
        'SELECT from_id, to_id, coalesce(sum(amount), 0) AS amount FROM economy_transfer '
        'WHERE currency = ? AND created_at >= ? AND created_at < ? '
        'AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) '
        'GROUP BY from_id, to_id',
        (currency, start, end, low, high, high, low)).fetchall()
    directions = {(r['from_id'], r['to_id']): r['amount'] for r in rows}
    if not directions.get((low, high)) or not directions.get((high, low)):
        return
    amount = directions[(low, high)] + directions[(high, low)]
    if amount >= _rule(conn, 'anomaly_pair_roundtrip'):
        _mark_anomaly(conn, 'pair_roundtrip', low, high, day, amount,
                      {'currency': currency, 'signals': ['bidirectional_transfer']})


def credit(conn, principal_id, currency, amount, reason, idempotency_key, ref=None):
    """Award currency and return the actual amount after daily caps."""
    amount = _amount(amount)
    currency = _currency(conn, currency)
    reason = _reason(reason)
    replay = _operation(conn, idempotency_key, kind='credit', principal_id=principal_id,
                        counterparty_id=None, currency=currency, requested=amount, reason=reason, ref=ref)
    if replay is not None:
        return replay
    actual, day = _awardable(conn, principal_id, currency, reason, amount)
    if actual:
        entry_id = _entry(conn, principal_id=principal_id, currency=currency, amount=actual, requested=amount,
                          reason=reason, key=idempotency_key, ref=ref)
        _count_earning(conn, principal_id, currency, day, actual)
        outbox.emit(conn, 'economy.credited', 'wallet_entry', entry_id,
                    {'principal_id': principal_id, 'currency': currency, 'amount': actual, 'reason': reason})
        _check_daily_anomaly(conn, principal_id, currency, day)
    _save_operation(conn, idempotency_key, kind='credit', principal_id=principal_id, counterparty_id=None,
                    currency=currency, requested=amount, actual=actual, reason=reason, ref=ref)
    return actual


def debit(conn, principal_id, currency, amount, reason, idempotency_key, ref=None):
    """Spend currency atomically; insufficient funds raises the frozen error code."""
    amount = _amount(amount)
    currency = _currency(conn, currency)
    reason = _reason(reason)
    replay = _operation(conn, idempotency_key, kind='debit', principal_id=principal_id,
                        counterparty_id=None, currency=currency, requested=amount, reason=reason, ref=ref)
    if replay is not None:
        return replay
    if balance(conn, principal_id, currency) < amount:
        raise ApiError('insufficient_funds')
    entry_id = _entry(conn, principal_id=principal_id, currency=currency, amount=-amount, requested=amount,
                      reason=reason, key=idempotency_key, ref=ref)
    _save_operation(conn, idempotency_key, kind='debit', principal_id=principal_id, counterparty_id=None,
                    currency=currency, requested=amount, actual=amount, reason=reason, ref=ref)
    outbox.emit(conn, 'economy.debited', 'wallet_entry', entry_id,
                {'principal_id': principal_id, 'currency': currency, 'amount': amount, 'reason': reason})
    return amount


def transfer_game(conn, from_id, to_id, currency, amount, reason, idempotency_key, ref=None):
    """Move the capped actual amount between two members for game settlement only."""
    amount = _amount(amount)
    currency = _currency(conn, currency)
    reason = _reason(reason)
    if from_id == to_id:
        raise ApiError('validation_failed', '不能转给自己')
    replay = _operation(conn, idempotency_key, kind='transfer', principal_id=from_id,
                        counterparty_id=to_id, currency=currency, requested=amount, reason=reason, ref=ref)
    if replay is not None:
        return replay
    actual, day = _awardable(conn, to_id, currency, reason, amount)
    if actual and balance(conn, from_id, currency) < actual:
        raise ApiError('insufficient_funds')
    if actual:
        transfer_id = _id()
        now = clock.now()
        conn.execute('INSERT INTO economy_transfer (id, from_id, to_id, currency, amount, reason, idempotency_key, '
                     'ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                     (transfer_id, from_id, to_id, currency, actual, reason, idempotency_key, ref, now))
        _entry(conn, principal_id=from_id, currency=currency, amount=-actual, requested=amount, reason=reason,
               key=f'{idempotency_key}:out', ref=ref or transfer_id, counterparty_id=to_id)
        _entry(conn, principal_id=to_id, currency=currency, amount=actual, requested=amount, reason=reason,
               key=f'{idempotency_key}:in', ref=ref or transfer_id, counterparty_id=from_id)
        _count_earning(conn, to_id, currency, day, actual)
        outbox.emit(conn, 'economy.transferred', 'economy_transfer', transfer_id,
                    {'from_id': from_id, 'to_id': to_id, 'currency': currency,
                     'amount': actual, 'reason': reason})
        _check_daily_anomaly(conn, to_id, currency, day)
        _check_pair_anomaly(conn, from_id, to_id, currency, day)
    _save_operation(conn, idempotency_key, kind='transfer', principal_id=from_id, counterparty_id=to_id,
                    currency=currency, requested=amount, actual=actual, reason=reason, ref=ref)
    return actual


def admin_adjust(conn, actor, principal_id, currency, amount, reason_code, idempotency_key, ref=None,
                 request_id=None):
    require(conn, actor, 'economy.admin.adjust')
    if isinstance(amount, bool) or not isinstance(amount, int) or amount == 0:
        raise ApiError('validation_failed', '调账数量不能为 0')
    if not isinstance(reason_code, str) or not re.fullmatch(r'[a-z][a-z0-9_]{2,31}', reason_code):
        raise ApiError('validation_failed', '调账必须写原因码')
    currency = _currency(conn, currency)
    requested = abs(amount)
    operation_reason = 'admin_adjust.credit' if amount > 0 else 'admin_adjust.debit'
    replay = _operation(conn, idempotency_key, kind='admin_adjust', principal_id=principal_id,
                        counterparty_id=None, currency=currency, requested=requested,
                        reason=operation_reason, ref=ref)
    if replay is not None:
        return replay if amount > 0 else -replay
    if amount < 0 and balance(conn, principal_id, currency) < requested:
        raise ApiError('insufficient_funds')
    entry_id = _entry(conn, principal_id=principal_id, currency=currency, amount=amount, requested=requested,
                      reason='admin_adjust', key=idempotency_key, ref=ref)
    _save_operation(conn, idempotency_key, kind='admin_adjust', principal_id=principal_id,
                    counterparty_id=None, currency=currency, requested=requested, actual=requested,
                    reason=operation_reason, ref=ref)
    audit.record(conn, actor.id, 'economy.admin_adjust', 'principal', principal_id, reason=reason_code,
                 request_id=request_id, meta={'currency': currency, 'amount': amount, 'ref': ref})
    outbox.emit(conn, 'economy.admin_adjusted', 'wallet_entry', entry_id,
                {'principal_id': principal_id, 'currency': currency, 'amount': amount,
                 'reason_code': reason_code}, actor_id=actor.id, request_id=request_id)
    return amount


def today(conn, principal_id, currency=CURRENCY):
    day = _day()
    cap = _account_cap(conn, principal_id, currency, 'games.reward')
    earned = _earned(conn, principal_id, currency, day)
    return {'day': day, 'earned': earned, 'cap': cap, 'remaining': max(0, cap - earned)}


def entries(conn, principal_id, currency=CURRENCY, limit=100):
    rows = conn.execute(
        'SELECT id, amount, reason, ref, counterparty_id, created_at FROM wallet_entry '
        'WHERE principal_id = ? AND currency = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
        (principal_id, currency, limit)).fetchall()
    return [{**dict(row), 'reason_label': REASON_LABELS.get(row['reason'], row['reason'])} for row in rows]


def inventory(conn, principal_id):
    rows = conn.execute(
        'SELECT i.item_key, i.equipped, i.acquired_at, s.name, s.category '
        'FROM economy_inventory i JOIN economy_shop_item s ON s.item_key = i.item_key '
        'WHERE i.principal_id = ? ORDER BY s.sort_order, s.item_key', (principal_id,)).fetchall()
    return [{**dict(row), 'equipped': bool(row['equipped']),
             'category_label': CATEGORY_LABELS[row['category']]} for row in rows]


def shop(conn, principal_id, category=None):
    params = [principal_id, clock.now()]
    clause = ''
    if category:
        if category not in CATEGORY_LABELS:
            raise ApiError('validation_failed', '商店分类不存在')
        clause = ' AND s.category = ?'
        params.append(category)
    rows = conn.execute(
        'SELECT s.*, i.equipped, p.id AS purchase_id, '
        '(SELECT count(*) FROM economy_shop_purchase x WHERE x.item_key = s.item_key) AS sold '
        'FROM economy_shop_item s '
        'LEFT JOIN economy_inventory i ON i.item_key = s.item_key AND i.principal_id = ? '
        'LEFT JOIN economy_shop_purchase p ON p.item_key = s.item_key AND p.principal_id = ? '
        'WHERE s.active = 1 AND s.available_at <= ?' + clause + ' ORDER BY s.sort_order, s.item_key',
        [principal_id, *params]).fetchall()
    result = []
    for row in rows:
        remaining = None if row['limited_total'] is None else max(0, row['limited_total'] - row['sold'])
        result.append({
            'key': row['item_key'], 'name': row['name'], 'category': row['category'],
            'category_label': CATEGORY_LABELS[row['category']], 'price': row['price'],
            'limited': row['limited_total'], 'remaining': remaining, 'owned': row['purchase_id'] is not None,
            'equipped': bool(row['equipped']), 'available_at': row['available_at'],
        })
    return result


def buy(conn, actor, item_key, idempotency_key, request_id=None):
    require(conn, actor, 'economy.shop.buy')
    item = conn.execute('SELECT * FROM economy_shop_item WHERE item_key = ? AND active = 1 AND available_at <= ?',
                        (item_key, clock.now())).fetchone()
    if item is None:
        raise ApiError('resource_not_found')
    previous = conn.execute('SELECT id FROM economy_shop_purchase WHERE idempotency_key = ?',
                            (idempotency_key,)).fetchone()
    if previous:
        return previous['id']
    if conn.execute('SELECT 1 FROM economy_inventory WHERE principal_id = ? AND item_key = ?',
                    (actor.id, item_key)).fetchone():
        raise ApiError('already_owned')
    if item['limited_total'] is not None:
        sold = conn.execute('SELECT count(*) FROM economy_shop_purchase WHERE item_key = ?', (item_key,)).fetchone()[0]
        if sold >= item['limited_total']:
            raise ApiError('sold_out')
    debit(conn, actor.id, CURRENCY, item['price'], 'shop.purchase', f'shop:{idempotency_key}', ref=item_key)
    purchase_id = _id()
    now = clock.now()
    conn.execute('INSERT INTO economy_shop_purchase (id, principal_id, item_key, price, currency, idempotency_key, '
                 'created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                 (purchase_id, actor.id, item_key, item['price'], CURRENCY, idempotency_key, now))
    conn.execute('INSERT INTO economy_inventory (principal_id, item_key, equipped, acquired_at, updated_at) '
                 'VALUES (?, ?, 0, ?, ?)', (actor.id, item_key, now, now))
    audit.record(conn, actor.id, 'economy.shop.buy', 'shop_item', item_key,
                 request_id=request_id, meta={'price': item['price'], 'currency': CURRENCY})
    outbox.emit(conn, 'economy.item_purchased', 'shop_item', item_key,
                {'principal_id': actor.id, 'item_key': item_key, 'category': item['category'],
                 'price': item['price']}, actor_id=actor.id, request_id=request_id)
    return purchase_id


def equip(conn, actor, item_key, request_id=None):
    require(conn, actor, 'economy.inventory.equip')
    item = conn.execute(
        'SELECT s.category FROM economy_inventory i JOIN economy_shop_item s ON s.item_key = i.item_key '
        'WHERE i.principal_id = ? AND i.item_key = ?', (actor.id, item_key)).fetchone()
    if item is None:
        raise ApiError('resource_not_found')
    now = clock.now()
    conn.execute('UPDATE economy_inventory SET equipped = 0, updated_at = ? WHERE principal_id = ? AND item_key IN '
                 '(SELECT item_key FROM economy_shop_item WHERE category = ?)',
                 (now, actor.id, item['category']))
    conn.execute('UPDATE economy_inventory SET equipped = 1, updated_at = ? '
                 'WHERE principal_id = ? AND item_key = ?', (now, actor.id, item_key))
    audit.record(conn, actor.id, 'economy.inventory.equip', 'shop_item', item_key, request_id=request_id)
    outbox.emit(conn, 'economy.item_equipped', 'shop_item', item_key,
                {'principal_id': actor.id, 'item_key': item_key, 'category': item['category']},
                actor_id=actor.id, request_id=request_id)
    return item_key


def checkin_view(conn, principal_id):
    row = conn.execute('SELECT * FROM economy_checkin WHERE principal_id = ?', (principal_id,)).fetchone()
    today_key = _day()
    yesterday = _day(clock.now_ts() - DAY)
    streak = row['streak'] if row else 0
    cycle_day = (streak % 7) + 1 if row and row['last_day'] in (today_key, yesterday) else 1
    reward = _checkin_reward(conn, cycle_day)
    rewards = [_checkin_reward(conn, day) for day in range(1, 8)]
    return {
        'day': today_key, 'streak': streak, 'total_days': row['total_days'] if row else 0,
        'claimed_today': bool(row and row['last_day'] == today_key),
        'last_reward': row['last_reward'] if row else 0, 'next_cycle_day': cycle_day,
        'next_reward': reward, 'rewards': rewards,
    }


def checkin(conn, actor, request_id=None):
    require(conn, actor, 'economy.checkin')
    today_key = _day()
    row = conn.execute('SELECT * FROM economy_checkin WHERE principal_id = ?', (actor.id,)).fetchone()
    if row and row['last_day'] == today_key:
        return checkin_view(conn, actor.id)
    yesterday = _day(clock.now_ts() - DAY)
    streak = row['streak'] + 1 if row and row['last_day'] == yesterday else 1
    cycle_day = ((streak - 1) % 7) + 1
    reward = _checkin_reward(conn, cycle_day)
    actual = credit(conn, actor.id, CURRENCY, reward, 'economy.checkin',
                    f'checkin:{actor.id}:{today_key}', ref=today_key)
    now = clock.now()
    if row:
        conn.execute('UPDATE economy_checkin SET last_day = ?, streak = ?, total_days = total_days + 1, '
                     'last_reward = ?, updated_at = ? WHERE principal_id = ?',
                     (today_key, streak, actual, now, actor.id))
    else:
        conn.execute('INSERT INTO economy_checkin (principal_id, last_day, streak, total_days, last_reward, updated_at) '
                     'VALUES (?, ?, ?, 1, ?, ?)', (actor.id, today_key, streak, actual, now))
    outbox.emit(conn, 'economy.checked_in', 'principal', actor.id,
                {'principal_id': actor.id, 'streak': streak, 'cycle_day': cycle_day, 'amount': actual},
                actor_id=actor.id, request_id=request_id)
    return checkin_view(conn, actor.id)


def me(conn, actor):
    return {
        'currency': CURRENCY,
        'currency_name': '竹子',
        'balance': balance(conn, actor.id),
        'today': today(conn, actor.id),
        'inventory': inventory(conn, actor.id),
        'checkin': checkin_view(conn, actor.id),
    }


def export(conn, actor):
    return {'balance': balance(conn, actor.id), 'entries': entries(conn, actor.id, limit=-1),
            'inventory': inventory(conn, actor.id), 'checkin': checkin_view(conn, actor.id)}
