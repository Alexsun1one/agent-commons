"""抢车位业务规则。时间只从 app.clock 读取，测试可注入。"""
import importlib
import uuid

from app import audit, clock, flags, outbox
from app.authz import require
from app.errors import ApiError
from modules.admin import params as admin_params


MAX_HOURS = 12
MAX_RATE = 12
DAILY_TICKETS = 10
STARTER_MODELS = (('cloud', '小云'), ('pixel', '点点'))

admin_params.declare('parking', 'max_hours', 'max_rate', 'daily_tickets', 'ticket_fine_percent')


def _param(conn, key, fallback):
    return int(admin_params.value(conn, 'parking', key, fallback))


class _Economy:
    """ECON-1 并行施工时保持模块可加载；结算仍 fail closed。"""

    @staticmethod
    def _service():
        try:
            return importlib.import_module('modules.economy.service')
        except ModuleNotFoundError as exc:
            if exc.name not in ('modules.economy', 'modules.economy.service'):
                raise
            return None

    def balance(self, conn, principal_id, currency):
        target = self._service()
        return target.balance(conn, principal_id, currency) if target else 0

    def credit(self, *args, **kwargs):
        target = self._service()
        if target is None:
            raise ApiError('capability_unavailable', '竹子结算尚未接通')
        return target.credit(*args, **kwargs)

    def debit(self, *args, **kwargs):
        target = self._service()
        if target is None:
            raise ApiError('capability_unavailable', '竹子结算尚未接通')
        return target.debit(*args, **kwargs)

    def transfer_game(self, *args, **kwargs):
        target = self._service()
        if target is None:
            raise ApiError('capability_unavailable', '竹子结算尚未接通')
        return target.transfer_game(*args, **kwargs)


class _Social:
    """只消费 SOCIAL-1 的关系接口，不在本模块复制关系数据。"""

    @staticmethod
    def _service():
        try:
            return importlib.import_module('modules.social.service')
        except ModuleNotFoundError as exc:
            if exc.name not in ('modules.social', 'modules.social.service'):
                raise
            return None

    def blocked(self, conn, left, right):
        target = self._service()
        return bool(target and target.blocked(conn, left, right))

    def mutual(self, conn, left, right):
        target = self._service()
        if target is None:
            return False
        for name in ('mutual_follow', 'are_friends', 'friends_with'):
            fn = getattr(target, name, None)
            if fn:
                return bool(fn(conn, left, right))
        return False

    def friend_ids(self, conn, principal_id):
        target = self._service()
        if target is None:
            return []
        for name in ('friend_ids', 'friends'):
            fn = getattr(target, name, None)
            if fn:
                rows = fn(conn, principal_id)
                return [row.get('id') if isinstance(row, dict) else row for row in rows]
        return []


eco = _Economy()
social = _Social()


def _amount(value, fallback):
    return fallback if value is None else int(value)


def _player(conn, principal_id):
    row = conn.execute(
        'SELECT p.id, p.kind, p.status, c.handle, pr.display_name FROM principal p '
        'JOIN credential c ON c.principal_id = p.id JOIN profile pr ON pr.principal_id = p.id '
        'WHERE p.id = ?', (principal_id,)).fetchone()
    if row is None or row['status'] not in ('active', 'pending_deletion'):
        raise ApiError('resource_not_found')
    return row


def principal_for_handle(conn, handle):
    row = conn.execute(
        'SELECT p.id, p.kind, p.status, c.handle, pr.display_name FROM credential c '
        'JOIN principal p ON p.id = c.principal_id JOIN profile pr ON pr.principal_id = p.id '
        'WHERE lower(c.handle) = lower(?)', (handle.strip(),)).fetchone()
    if row is None or row['status'] != 'active':
        raise ApiError('resource_not_found')
    return row


def ensure_player(conn, principal_id):
    _player(conn, principal_id)
    now = clock.now()
    conn.execute('INSERT OR IGNORE INTO parking_lot (owner_id, capacity, created_at, updated_at) '
                 'VALUES (?, 4, ?, ?)', (principal_id, now, now))
    capacity = conn.execute('SELECT capacity FROM parking_lot WHERE owner_id = ?', (principal_id,)).fetchone()[0]
    conn.executemany('INSERT OR IGNORE INTO parking_space (owner_id, slot_no, updated_at) VALUES (?, ?, ?)',
                     [(principal_id, slot, now) for slot in range(1, capacity + 1)])
    count = conn.execute('SELECT count(*) FROM parking_vehicle WHERE owner_id = ?', (principal_id,)).fetchone()[0]
    if count == 0:
        for index, (model, nickname) in enumerate(STARTER_MODELS, 1):
            vehicle_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f'commons:parking:{principal_id}:{index}'))
            conn.execute('INSERT OR IGNORE INTO parking_vehicle '
                         '(id, owner_id, model_key, nickname, acquired_at) VALUES (?, ?, ?, ?, ?)',
                         (vehicle_id, principal_id, model, nickname, now))


def expand_lot(conn, principal_id, capacity):
    """给商店/等级系统的窄接口；扩容费用由调用方结算。"""
    if capacity < 4 or capacity > 8:
        raise ApiError('validation_failed', '车位数只能是 4 到 8')
    ensure_player(conn, principal_id)
    current = conn.execute('SELECT capacity FROM parking_lot WHERE owner_id = ?', (principal_id,)).fetchone()[0]
    if capacity < current:
        raise ApiError('state_conflict', '不能缩减已有车位')
    now = clock.now()
    conn.execute('UPDATE parking_lot SET capacity = ?, updated_at = ? WHERE owner_id = ?',
                 (capacity, now, principal_id))
    conn.executemany('INSERT OR IGNORE INTO parking_space (owner_id, slot_no, updated_at) VALUES (?, ?, ?)',
                     [(principal_id, slot, now) for slot in range(current + 1, capacity + 1)])
    return capacity


def grant_vehicle(conn, principal_id, model_key, nickname, vehicle_id=None):
    """给 ECON-1 商店发车型的窄接口，收益率只取受控模型表。"""
    ensure_player(conn, principal_id)
    if conn.execute('SELECT 1 FROM parking_vehicle_model WHERE key = ?', (model_key,)).fetchone() is None:
        raise ApiError('validation_failed', '车型不存在')
    vehicle_id = vehicle_id or str(uuid.uuid4())
    conn.execute('INSERT INTO parking_vehicle (id, owner_id, model_key, nickname, acquired_at) '
                 'VALUES (?, ?, ?, ?, ?)', (vehicle_id, principal_id, model_key, nickname[:24], clock.now()))
    return vehicle_id


def set_welcome(conn, actor, slot_no, enabled, request_id=None):
    flags.gate(conn, 'parking.game')
    require(conn, actor, 'parking.welcome')
    ensure_player(conn, actor.id)
    row = conn.execute('SELECT 1 FROM parking_space WHERE owner_id = ? AND slot_no = ?',
                       (actor.id, slot_no)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    conn.execute('UPDATE parking_space SET is_welcome = ?, updated_at = ? WHERE owner_id = ? AND slot_no = ?',
                 (int(enabled), clock.now(), actor.id, slot_no))
    audit.record(conn, actor.id, 'parking.welcome', 'parking_space', f'{actor.id}:{slot_no}',
                 request_id=request_id, meta={'enabled': bool(enabled)})
    return {'slot_no': slot_no, 'welcome': bool(enabled)}


def _elapsed(stay, now_ts=None):
    current = clock.now_ts() if now_ts is None else now_ts
    # Persisted timestamps have microsecond precision. Canonicalize the current
    # instant to the same precision so an exact one-hour boundary cannot become
    # 3599.999999 seconds through float/ISO round-tripping.
    current = clock.parse(clock.iso(current))
    return max(0, current - clock.parse(stay['parked_at']))


def earnings(stay, now_ts=None, conn=None):
    max_hours = _param(conn, 'max_hours', MAX_HOURS) if conn is not None else MAX_HOURS
    max_rate = _param(conn, 'max_rate', MAX_RATE) if conn is not None else MAX_RATE
    hours = min(max_hours, int(_elapsed(stay, now_ts) // 3600))
    gross = hours * min(max_rate, int(stay['hourly_rate']))
    return {'hours': hours, 'gross': gross, 'projected': gross // 2 if stay['is_welcome'] else gross}


def _stay_dto(conn, row, now_ts=None):
    item = dict(row)
    item['welcome'] = bool(item.pop('is_welcome'))
    item['earnings'] = earnings(row, now_ts, conn)
    item['can_ticket'] = not item['welcome'] and _elapsed(row, now_ts) >= 3600
    return item


def _assert_visible(conn, viewer_id, owner_id):
    if viewer_id != owner_id and social.blocked(conn, viewer_id, owner_id):
        raise ApiError('resource_not_found')


def lot(conn, actor, owner_id):
    flags.gate(conn, 'parking.game')
    require(conn, actor, 'parking.read')
    _assert_visible(conn, actor.id, owner_id)
    ensure_player(conn, owner_id)
    owner = _player(conn, owner_id)
    rows = conn.execute(
        'SELECT s.owner_id, s.slot_no, s.is_welcome AS space_welcome, st.id AS stay_id, st.message, st.parked_at, '
        'st.welcome_at_park AS is_welcome, '
        'v.id AS vehicle_id, v.owner_id AS vehicle_owner_id, v.nickname, m.key AS model_key, '
        'm.name AS model_name, m.hourly_rate, m.asset_path, c.handle AS vehicle_owner_handle, '
        'p.display_name AS vehicle_owner_name '
        'FROM parking_space s LEFT JOIN parking_stay st ON st.lot_owner_id = s.owner_id '
        'AND st.slot_no = s.slot_no AND st.ended_at IS NULL '
        'LEFT JOIN parking_vehicle v ON v.id = st.vehicle_id '
        'LEFT JOIN parking_vehicle_model m ON m.key = v.model_key '
        'LEFT JOIN credential c ON c.principal_id = v.owner_id '
        'LEFT JOIN profile p ON p.principal_id = v.owner_id '
        'WHERE s.owner_id = ? ORDER BY s.slot_no', (owner_id,)).fetchall()
    spaces = []
    now_ts = clock.now_ts()
    for row in rows:
        base = {'slot_no': row['slot_no'], 'welcome': bool(row['space_welcome']), 'vehicle': None}
        if row['stay_id']:
            base['vehicle'] = _stay_dto(conn, row, now_ts)
        spaces.append(base)
    return {'owner': {'id': owner['id'], 'handle': owner['handle'], 'display_name': owner['display_name']},
            'capacity': len(spaces), 'spaces': spaces}


def me(conn, actor):
    flags.gate(conn, 'parking.game')
    require(conn, actor, 'parking.read')
    ensure_player(conn, actor.id)
    base = lot(conn, actor, actor.id)
    rows = conn.execute(
        'SELECT v.id AS vehicle_id, v.nickname, m.key AS model_key, m.name AS model_name, m.hourly_rate, '
        'm.asset_path, st.id AS stay_id, st.lot_owner_id, st.slot_no, st.parked_at, st.message, '
        'st.welcome_at_park AS is_welcome, c.handle AS lot_handle, p.display_name AS lot_name '
        'FROM parking_vehicle v JOIN parking_vehicle_model m ON m.key = v.model_key '
        'LEFT JOIN parking_stay st ON st.vehicle_id = v.id AND st.ended_at IS NULL '
        'LEFT JOIN parking_space s ON s.owner_id = st.lot_owner_id AND s.slot_no = st.slot_no '
        'LEFT JOIN credential c ON c.principal_id = st.lot_owner_id '
        'LEFT JOIN profile p ON p.principal_id = st.lot_owner_id '
        'WHERE v.owner_id = ? ORDER BY v.acquired_at, v.id', (actor.id,)).fetchall()
    now_ts = clock.now_ts()
    vehicles = []
    for row in rows:
        item = dict(row)
        item['parked'] = bool(row['stay_id'])
        item['welcome'] = bool(row['is_welcome']) if row['stay_id'] else False
        item['earnings'] = earnings(row, now_ts, conn) if row['stay_id'] else {'hours': 0, 'gross': 0, 'projected': 0}
        vehicles.append(item)
    base.update(vehicles=vehicles, bamboo=eco.balance(conn, actor.id, 'bamboo'))
    return base


def park(conn, actor, vehicle_id, owner_handle, slot_no, message='', request_id=None):
    flags.gate(conn, 'parking.game')
    require(conn, actor, 'parking.park')
    ensure_player(conn, actor.id)
    target = principal_for_handle(conn, owner_handle)
    if target['id'] == actor.id:
        raise ApiError('parking_own_lot')
    _assert_visible(conn, actor.id, target['id'])
    if not social.mutual(conn, actor.id, target['id']):
        raise ApiError('parking_not_friend')
    ensure_player(conn, target['id'])
    vehicle = conn.execute('SELECT id FROM parking_vehicle WHERE id = ? AND owner_id = ?',
                           (vehicle_id, actor.id)).fetchone()
    if vehicle is None:
        raise ApiError('resource_not_found')
    if conn.execute('SELECT 1 FROM parking_stay WHERE vehicle_id = ? AND ended_at IS NULL',
                    (vehicle_id,)).fetchone():
        raise ApiError('parking_vehicle_busy')
    space = conn.execute('SELECT is_welcome FROM parking_space WHERE owner_id = ? AND slot_no = ?',
                         (target['id'], slot_no)).fetchone()
    if space is None:
        raise ApiError('resource_not_found')
    if conn.execute('SELECT 1 FROM parking_stay WHERE lot_owner_id = ? AND slot_no = ? AND ended_at IS NULL',
                    (target['id'], slot_no)).fetchone():
        raise ApiError('parking_space_busy')
    stay_id = str(uuid.uuid4())
    conn.execute('INSERT INTO parking_stay '
                 '(id, vehicle_id, lot_owner_id, slot_no, message, welcome_at_park, parked_at) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?)',
                 (stay_id, vehicle_id, target['id'], slot_no, message.strip()[:80], space['is_welcome'], clock.now()))
    outbox.emit(conn, 'parking.parked', 'parking_stay', stay_id,
                {'recipient_id': target['id'], 'vehicle_owner_id': actor.id, 'slot_no': slot_no},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'parking.park', 'parking_stay', stay_id, request_id=request_id,
                 meta={'lot_owner_id': target['id'], 'slot_no': slot_no})
    return {'stay_id': stay_id, 'lot_handle': target['handle'], 'slot_no': slot_no}


def _active_for_vehicle(conn, vehicle_id, owner_id):
    return conn.execute(
        'SELECT st.*, v.owner_id AS vehicle_owner_id, m.hourly_rate, st.welcome_at_park AS is_welcome '
        'FROM parking_stay st JOIN parking_vehicle v ON v.id = st.vehicle_id '
        'JOIN parking_vehicle_model m ON m.key = v.model_key '
        'JOIN parking_space s ON s.owner_id = st.lot_owner_id AND s.slot_no = st.slot_no '
        'WHERE st.vehicle_id = ? AND v.owner_id = ? AND st.ended_at IS NULL',
        (vehicle_id, owner_id)).fetchone()


def move(conn, actor, vehicle_id, request_id=None):
    flags.gate(conn, 'parking.game')
    require(conn, actor, 'parking.move')
    stay = _active_for_vehicle(conn, vehicle_id, actor.id)
    if stay is None:
        raise ApiError('parking_not_parked')
    calc = earnings(stay, conn=conn)
    wanted = calc['projected']
    paid = _amount(eco.credit(conn, actor.id, 'bamboo', wanted, 'parking.earn',
                              f'parking:move:{stay["id"]}', ref=stay['id']), wanted) if wanted else 0
    ended = clock.now()
    conn.execute("UPDATE parking_stay SET ended_at = ?, end_reason = 'move', gross_earned = ?, "
                 'parker_share = ? WHERE id = ?', (ended, calc['gross'], paid, stay['id']))
    audit.record(conn, actor.id, 'parking.move', 'parking_stay', stay['id'], request_id=request_id,
                 meta={'gross': calc['gross'], 'paid': paid, 'welcome': bool(stay['is_welcome'])})
    return {'stay_id': stay['id'], 'gross': calc['gross'], 'earned': paid,
            'welcome': bool(stay['is_welcome']), 'hours': calc['hours']}


def ticket(conn, actor, slot_no, request_id=None):
    flags.gate(conn, 'parking.game')
    require(conn, actor, 'parking.ticket')
    if actor.kind == 'agent':
        raise ApiError('parking_agent_ticket')
    ensure_player(conn, actor.id)
    stay = conn.execute(
        'SELECT st.*, v.owner_id AS vehicle_owner_id, m.hourly_rate, st.welcome_at_park AS is_welcome '
        'FROM parking_stay st JOIN parking_vehicle v ON v.id = st.vehicle_id '
        'JOIN parking_vehicle_model m ON m.key = v.model_key '
        'JOIN parking_space s ON s.owner_id = st.lot_owner_id AND s.slot_no = st.slot_no '
        'WHERE st.lot_owner_id = ? AND st.slot_no = ? AND st.ended_at IS NULL',
        (actor.id, slot_no)).fetchone()
    if stay is None:
        raise ApiError('parking_space_empty')
    if stay['is_welcome']:
        raise ApiError('parking_welcome_protected')
    if _elapsed(stay) < 3600:
        raise ApiError('parking_ticket_early')
    today = clock.now()[:10]
    count = conn.execute("SELECT count(*) FROM parking_stay WHERE lot_owner_id = ? AND end_reason = 'ticket' "
                         'AND substr(ended_at, 1, 10) = ?', (actor.id, today)).fetchone()[0]
    if count >= _param(conn, 'daily_tickets', DAILY_TICKETS):
        raise ApiError('parking_ticket_limit')
    calc = earnings(stay, conn=conn)
    credited = _amount(eco.credit(conn, stay['vehicle_owner_id'], 'bamboo', calc['gross'], 'parking.earn',
                                  f'parking:ticket:earn:{stay["id"]}', ref=stay['id']), calc['gross'])
    fine_percent = _param(conn, 'ticket_fine_percent', 50)
    wanted = min(calc['gross'] * fine_percent // 100, credited)
    fined = _amount(eco.transfer_game(conn, stay['vehicle_owner_id'], actor.id, 'bamboo', wanted,
                                      'parking.fine', f'parking:ticket:fine:{stay["id"]}', ref=stay['id']),
                    wanted) if wanted else 0
    ended = clock.now()
    conn.execute("UPDATE parking_stay SET ended_at = ?, end_reason = 'ticket', gross_earned = ?, "
                 'parker_share = ?, owner_share = ? WHERE id = ?',
                 (ended, calc['gross'], max(0, credited - fined), fined, stay['id']))
    outbox.emit(conn, 'parking.ticketed', 'parking_stay', stay['id'],
                {'recipient_id': stay['vehicle_owner_id'], 'lot_owner_id': actor.id, 'slot_no': slot_no,
                 'fine': fined}, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'parking.ticket', 'parking_stay', stay['id'], request_id=request_id,
                 meta={'fine': fined, 'gross': calc['gross']})
    return {'stay_id': stay['id'], 'gross': calc['gross'], 'fine': fined,
            'earned': max(0, credited - fined), 'hours': calc['hours']}


def friends(conn, actor):
    flags.gate(conn, 'parking.game')
    require(conn, actor, 'parking.read')
    ensure_player(conn, actor.id)
    items = []
    for friend_id in dict.fromkeys(i for i in social.friend_ids(conn, actor.id) if i and i != actor.id):
        if social.blocked(conn, actor.id, friend_id):
            continue
        try:
            ensure_player(conn, friend_id)
            person = _player(conn, friend_id)
        except ApiError:
            continue
        free = conn.execute(
            'SELECT count(*) FROM parking_space s WHERE s.owner_id = ? AND NOT EXISTS '
            '(SELECT 1 FROM parking_stay st WHERE st.lot_owner_id = s.owner_id '
            'AND st.slot_no = s.slot_no AND st.ended_at IS NULL)', (friend_id,)).fetchone()[0]
        mine = conn.execute(
            'SELECT count(*) FROM parking_stay st JOIN parking_vehicle v ON v.id = st.vehicle_id '
            'WHERE st.lot_owner_id = ? AND v.owner_id = ? AND st.ended_at IS NULL',
            (friend_id, actor.id)).fetchone()[0]
        items.append({'id': friend_id, 'handle': person['handle'], 'display_name': person['display_name'],
                      'free_spaces': free, 'my_car_here': bool(mine)})
    items.sort(key=lambda item: (item['free_spaces'] == 0, not item['my_car_here'], item['handle'].casefold()))
    return items

