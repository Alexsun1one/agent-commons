"""熊猫小窝业务规则。时间只读 ``app.clock``，跨模块能力保持窄接口。"""
import importlib
import re
import uuid
from datetime import datetime, timezone

from app import audit, clock, flags, outbox
from app.authz import require
from app.errors import ApiError


PALETTES = ('classic', 'brand-blue', 'mint', 'mist-purple', 'graphite', 'night-sky')
PALETTE_LABELS = {
    'classic': '经典黑白', 'brand-blue': '先锋蓝', 'mint': '薄荷青',
    'mist-purple': '雾紫', 'graphite': '石墨灰', 'night-sky': '夜空蓝',
}
STAGES = (
    {'key': 'cub', 'label': '幼崽', 'threshold': 0, 'reward': 0, 'unlock': '摸摸头'},
    {'key': 'youth', 'label': '少年', 'threshold': 40, 'reward': 8, 'unlock': '陪玩'},
    {'key': 'adult', 'label': '成年', 'threshold': 120, 'reward': 12, 'unlock': '竹林背景'},
    {'key': 'seasoned', 'label': '老练', 'threshold': 260, 'reward': 20, 'unlock': '星夜背景'},
)
FEED_COST = 5
DAILY_FEEDS = 6
DAILY_CARE = 10
DAILY_VISITS = 5
NAME = re.compile(r'[\u3400-\u9fffA-Za-z0-9·]{1,8}\Z')
DECAY_SECONDS = {'fullness': 3 * 3600, 'mood': 6 * 3600, 'affinity': 24 * 3600}


class _Economy:
    @staticmethod
    def _service():
        try:
            return importlib.import_module('modules.economy.service')
        except ModuleNotFoundError as exc:
            if exc.name not in ('modules.economy', 'modules.economy.service'):
                raise
            return None

    def balance(self, conn, principal_id, currency='bamboo'):
        target = self._service()
        return target.balance(conn, principal_id, currency) if target else 0

    def inventory(self, conn, principal_id):
        target = self._service()
        return target.inventory(conn, principal_id) if target else []

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


class _Social:
    """只消费 SOCIAL-1 的关系接口；模块缺席时 fail closed。"""
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


def _id():
    return str(uuid.uuid4())


def _human(actor):
    if actor.kind != 'human':
        raise ApiError('pet_agent_action')


def _day(ts=None):
    value = clock.now_ts() if ts is None else ts
    return datetime.fromtimestamp(value, timezone.utc).strftime('%Y-%m-%d')


def principal_for_handle(conn, handle):
    row = conn.execute(
        'SELECT p.id, c.handle, pr.display_name FROM credential c '
        'JOIN principal p ON p.id = c.principal_id JOIN profile pr ON pr.principal_id = p.id '
        'WHERE lower(c.handle) = lower(?) AND p.status = \'active\'', (handle.strip(),)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _profile(conn, owner_id):
    return conn.execute('SELECT * FROM pet_profile WHERE owner_id = ?', (owner_id,)).fetchone()


def _required(conn, owner_id):
    row = _profile(conn, owner_id)
    if row is None:
        raise ApiError('pet_not_adopted')
    return row


def _state(row, now_ts=None):
    now_ts = clock.now_ts() if now_ts is None else now_ts
    elapsed = max(0, now_ts - clock.parse(row['state_at']))
    values = {}
    for key in ('fullness', 'mood', 'affinity'):
        values[key] = max(0, int(row[key]) - int(elapsed // DECAY_SECONDS[key]))
    values['sleeping'] = values['fullness'] == 0 or values['mood'] == 0
    return values


def _settle(conn, owner_id):
    row = _required(conn, owner_id)
    state = _state(row)
    stamp = clock.now()
    conn.execute('UPDATE pet_profile SET fullness = ?, mood = ?, affinity = ?, state_at = ?, updated_at = ? '
                 'WHERE owner_id = ?',
                 (state['fullness'], state['mood'], state['affinity'], stamp, stamp, owner_id))
    return _required(conn, owner_id)


def _outfit(conn, owner_id):
    try:
        items = eco.inventory(conn, owner_id)
    except Exception as exc:
        if 'no such table' in str(exc):
            return []
        raise
    return [item for item in items if item.get('equipped') and item.get('category') in ('panda_palette', 'avatar_frame')]


def _owner(conn, owner_id):
    row = conn.execute(
        'SELECT p.id, c.handle, pr.display_name FROM principal p JOIN credential c ON c.principal_id = p.id '
        'JOIN profile pr ON pr.principal_id = p.id WHERE p.id = ?', (owner_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return dict(row)


def view(conn, owner_id):
    row = _profile(conn, owner_id)
    owner = _owner(conn, owner_id)
    if row is None:
        return {'owner': owner, 'pet': None, 'bamboo': eco.balance(conn, owner_id), 'outfit': []}
    state = _state(row)
    stage = STAGES[row['stage']]
    return {
        'owner': owner,
        'pet': {
            'name': row['name'], 'palette': row['palette'], 'palette_label': PALETTE_LABELS[row['palette']],
            'asset_path': f"assets/mascot/panda-avatar-{row['palette']}-512.webp",
            'fullness': state['fullness'], 'mood': state['mood'], 'affinity': state['affinity'],
            'affinity_total': row['affinity_total'], 'sleeping': state['sleeping'],
            'stage': row['stage'], 'stage_key': stage['key'], 'stage_label': stage['label'],
            'unlock': stage['unlock'], 'next_threshold': STAGES[row['stage'] + 1]['threshold'] if row['stage'] < 3 else None,
            'adopted_at': row['adopted_at'],
        },
        'bamboo': eco.balance(conn, owner_id),
        'outfit': _outfit(conn, owner_id),
    }


def me(conn, actor):
    flags.gate(conn, 'pet.game')
    require(conn, actor, 'pet.read')
    return view(conn, actor.id)


def _name(value):
    value = value.strip() if isinstance(value, str) else ''
    if not NAME.fullmatch(value):
        raise ApiError('validation_failed', '名字限 1 到 8 个中英文、数字或间隔点')
    try:
        pii = importlib.import_module('modules.governance.pii')
    except ModuleNotFoundError:
        pii = None
    if pii and pii.find(value):
        raise ApiError('pet_name_rejected')
    return value


def _diary(conn, owner_id, event_key, entry, occurred_at=None):
    return conn.execute(
        'INSERT OR IGNORE INTO pet_diary (id, owner_id, event_key, entry, created_at) VALUES (?, ?, ?, ?, ?)',
        (_id(), owner_id, event_key, entry, occurred_at or clock.now())).rowcount


def adopt(conn, actor, name, palette, request_id=None):
    _human(actor)
    flags.gate(conn, 'pet.game')
    require(conn, actor, 'pet.adopt')
    if palette not in PALETTES:
        raise ApiError('validation_failed', '没有这种熊猫配色')
    if _profile(conn, actor.id):
        raise ApiError('pet_already_adopted')
    stamp = clock.now()
    conn.execute('INSERT INTO pet_profile (owner_id, name, palette, fullness, mood, affinity, affinity_total, stage, '
                 'state_at, adopted_at, updated_at) VALUES (?, ?, ?, 72, 70, 10, 10, 0, ?, ?, ?)',
                 (actor.id, _name(name), palette, stamp, stamp, stamp))
    _diary(conn, actor.id, f'adopt:{actor.id}', '今天我们第一次见面，我有名字啦。', stamp)
    audit.record(conn, actor.id, 'pet.adopt', 'pet', actor.id, request_id=request_id, meta={'palette': palette})
    return view(conn, actor.id)


def _action_replay(conn, key, owner_id, kind, target_owner_id=None):
    row = conn.execute('SELECT owner_id, kind, target_owner_id FROM pet_action WHERE idempotency_key = ?',
                       (key,)).fetchone()
    if row is None:
        return None
    if (row['owner_id'], row['kind'], row['target_owner_id']) != (owner_id, kind, target_owner_id):
        raise ApiError('idempotency_conflict')
    return view(conn, owner_id)


def _count(conn, owner_id, day, kinds):
    marks = ','.join('?' * len(kinds))
    return conn.execute(f'SELECT count(*) FROM pet_action WHERE owner_id = ? AND day = ? AND kind IN ({marks})',
                        (owner_id, day, *kinds)).fetchone()[0]


def _insert_action(conn, owner_id, kind, key, target_owner_id=None):
    conn.execute('INSERT INTO pet_action (id, owner_id, kind, target_owner_id, day, idempotency_key, created_at) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?)',
                 (_id(), owner_id, kind, target_owner_id, _day(), key, clock.now()))


def _grow(conn, owner_id):
    row = _required(conn, owner_id)
    target = max(index for index, stage in enumerate(STAGES) if row['affinity_total'] >= stage['threshold'])
    if target <= row['stage']:
        return []
    unlocked = []
    for stage_no in range(row['stage'] + 1, target + 1):
        stage = STAGES[stage_no]
        eco.credit(conn, owner_id, 'bamboo', stage['reward'], 'pet.growth',
                   f'pet:stage:{owner_id}:{stage_no}', ref=str(stage_no))
        _diary(conn, owner_id, f'stage:{owner_id}:{stage_no}',
               f"今天我长成{stage['label']}啦，还解锁了{stage['unlock']}。")
        unlocked.append(stage_no)
    conn.execute('UPDATE pet_profile SET stage = ?, updated_at = ? WHERE owner_id = ?',
                 (target, clock.now(), owner_id))
    return unlocked


def _boost(conn, owner_id, *, fullness=0, mood=0, affinity=0, total=0):
    row = _settle(conn, owner_id)
    conn.execute('UPDATE pet_profile SET fullness = ?, mood = ?, affinity = ?, affinity_total = affinity_total + ?, '
                 'updated_at = ? WHERE owner_id = ?',
                 (min(100, row['fullness'] + fullness), min(100, row['mood'] + mood),
                  min(100, row['affinity'] + affinity), total, clock.now(), owner_id))
    return _grow(conn, owner_id)


def feed(conn, actor, key, request_id=None):
    _human(actor)
    flags.gate(conn, 'pet.game')
    require(conn, actor, 'pet.care')
    replay = _action_replay(conn, key, actor.id, 'feed')
    if replay is not None:
        return replay
    if _count(conn, actor.id, _day(), ('feed',)) >= DAILY_FEEDS:
        raise ApiError('pet_feed_limit')
    _required(conn, actor.id)
    eco.debit(conn, actor.id, 'bamboo', FEED_COST, 'pet.feed', f'pet:feed:{actor.id}:{key}', ref=actor.id)
    _insert_action(conn, actor.id, 'feed', key)
    _boost(conn, actor.id, fullness=18, mood=2, affinity=2, total=2)
    _diary(conn, actor.id, f'action:{key}', '今天主人喂了我一份竹子，肚子暖暖的。')
    audit.record(conn, actor.id, 'pet.feed', 'pet', actor.id, request_id=request_id)
    return view(conn, actor.id)


def care(conn, actor, kind, key, request_id=None):
    _human(actor)
    flags.gate(conn, 'pet.game')
    require(conn, actor, 'pet.care')
    if kind not in ('pat', 'play'):
        raise ApiError('validation_failed', '照料动作不存在')
    replay = _action_replay(conn, key, actor.id, kind)
    if replay is not None:
        return replay
    if _count(conn, actor.id, _day(), ('pat', 'play')) >= DAILY_CARE:
        raise ApiError('pet_care_limit')
    _required(conn, actor.id)
    _insert_action(conn, actor.id, kind, key)
    if kind == 'pat':
        _boost(conn, actor.id, mood=12, affinity=2, total=2)
        entry = '今天主人摸了摸我的头，我心情好多了。'
    else:
        _boost(conn, actor.id, mood=18, affinity=3, total=3)
        entry = '今天主人陪我玩了一会儿，我开心地打了个滚。'
    _diary(conn, actor.id, f'action:{key}', entry)
    audit.record(conn, actor.id, f'pet.{kind}', 'pet', actor.id, request_id=request_id)
    return view(conn, actor.id)


def member(conn, actor, owner_id):
    flags.gate(conn, 'pet.game')
    require(conn, actor, 'pet.read')
    if actor.id != owner_id and social.blocked(conn, actor.id, owner_id):
        raise ApiError('resource_not_found')
    data = view(conn, owner_id)
    if data['pet'] is None:
        raise ApiError('resource_not_found')
    return data


def visit(conn, actor, handle, key, request_id=None):
    _human(actor)
    flags.gate(conn, 'pet.game')
    require(conn, actor, 'pet.visit')
    owner = principal_for_handle(conn, handle)
    replay = _action_replay(conn, key, actor.id, 'visit', owner['id'])
    if replay is not None:
        return {'visited': member(conn, actor, owner['id']), 'rewards': {'visitor': 0, 'owner': 0}}
    if owner['id'] == actor.id or social.blocked(conn, actor.id, owner['id']):
        raise ApiError('resource_not_found')
    if not social.mutual(conn, actor.id, owner['id']):
        raise ApiError('pet_not_friend')
    _required(conn, actor.id)
    _required(conn, owner['id'])
    day = _day()
    if conn.execute("SELECT 1 FROM pet_action WHERE owner_id = ? AND target_owner_id = ? AND day = ? AND kind = 'visit'",
                    (actor.id, owner['id'], day)).fetchone():
        raise ApiError('pet_already_visited')
    if _count(conn, actor.id, day, ('visit',)) >= DAILY_VISITS:
        raise ApiError('pet_visit_limit')
    _insert_action(conn, actor.id, 'visit', key, owner['id'])
    _boost(conn, owner['id'], mood=8)
    visitor_award = eco.credit(conn, actor.id, 'bamboo', 1, 'pet.visit',
                               f'pet:visit:{actor.id}:{owner["id"]}:{day}:visitor', ref=owner['id'])
    owner_award = eco.credit(conn, owner['id'], 'bamboo', 1, 'pet.visit',
                             f'pet:visit:{actor.id}:{owner["id"]}:{day}:owner', ref=actor.id)
    _diary(conn, actor.id, f'visit:{actor.id}:{owner["id"]}:{day}:out', '今天我去好友家串门，还带回了一根竹子。')
    _diary(conn, owner['id'], f'visit:{actor.id}:{owner["id"]}:{day}:in', '今天有好友来摸了摸我的头，我收到了一根竹子。')
    audit.record(conn, actor.id, 'pet.visit', 'pet', owner['id'], request_id=request_id)
    return {'visited': member(conn, actor, owner['id']), 'rewards': {'visitor': visitor_award, 'owner': owner_award}}


def friends(conn, actor):
    flags.gate(conn, 'pet.game')
    require(conn, actor, 'pet.read')
    rows = []
    for owner_id in dict.fromkeys(i for i in social.friend_ids(conn, actor.id) if i and i != actor.id):
        if social.blocked(conn, actor.id, owner_id) or not social.mutual(conn, actor.id, owner_id):
            continue
        item = view(conn, owner_id)
        if item['pet'] is None:
            continue
        pet = item['pet']
        rows.append({
            'owner': item['owner'], 'name': pet['name'], 'palette': pet['palette'],
            'asset_path': pet['asset_path'], 'fullness': pet['fullness'], 'mood': pet['mood'],
            'sleeping': pet['sleeping'], 'hungry': pet['fullness'] <= 30, 'stage_label': pet['stage_label'],
        })
    return sorted(rows, key=lambda item: (not item['sleeping'], not item['hungry'], item['owner']['handle']))


def diary(conn, actor, limit=30):
    flags.gate(conn, 'pet.game')
    require(conn, actor, 'pet.read')
    if _profile(conn, actor.id) is None:
        return []
    return [dict(row) for row in conn.execute(
        'SELECT id, entry, created_at FROM pet_diary WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        (actor.id, limit)).fetchall()]


def _community(conn, owner_id, event_key, entry, mood, affinity, occurred_at):
    if _profile(conn, owner_id) is None:
        return False
    if not _diary(conn, owner_id, event_key, entry, occurred_at):
        return False
    _boost(conn, owner_id, mood=mood, affinity=affinity, total=affinity)
    return True


def on_object(conn, event):
    payload = event.get('payload') or {}
    if payload.get('type') == 'knowledge' and payload.get('lifecycle') == 'active' and event.get('actor_id'):
        _community(conn, event['actor_id'], f"event:{event['id']}",
                   '今天主人发布了一张知识卡，我把它记进小本子。', 8, 5, event['occurred_at'])


def on_room_ended(conn, event):
    room = conn.execute('SELECT kind FROM room WHERE id = ?', (event['aggregate_id'],)).fetchone()
    if room is None or room['kind'] != 'stage':
        return
    participants = conn.execute('SELECT principal_id FROM room_participant WHERE room_id = ? ORDER BY principal_id',
                                (event['aggregate_id'],)).fetchall()
    for participant in participants:
        _community(conn, participant['principal_id'], f"event:{event['id']}:{participant['principal_id']}",
                   '今天主人参加了一场讲堂，我陪着听到了散场。', 7, 4, event['occurred_at'])


def on_bounty_awarded(conn, event):
    payload = event.get('payload') or {}
    owner_id = payload.get('recipient_id')
    if not owner_id:
        return
    accepted = bool(payload.get('answer_id'))
    entry = ('今天主人在问题库帮了别人一次，我开心地打了个滚。' if accepted
             else '今天主人完成了一次悬赏，我把好消息记下来了。')
    _community(conn, owner_id, f"event:{event['id']}", entry, 10, 6, event['occurred_at'])


outbox.subscribe('pet.objects', 'object.created', on_object)
outbox.subscribe('pet.rooms', 'rooms.room.ended', on_room_ended)
outbox.subscribe('pet.bounties', 'bounty.awarded', on_bounty_awarded)
