"""先锋农场规则与读模型；所有生长判断都使用服务端可注入时钟。"""

import importlib
import uuid
from datetime import datetime, timezone

from app import clock, outbox
from app.errors import ApiError
from modules.admin import params as admin_params


HELP_DAILY_LIMIT = 10
STEAL_DAILY_LIMIT = 20
STEAL_LIMIT_PER_CYCLE = 2
STEAL_PERCENT = 10
MIN_OWNER_PERCENT = 70
WATCHDOG_HOURS = 8
LEVEL_PLOTS = {1: 6, 2: 7, 3: 9, 4: 10, 5: 12}
PLOT_PRICES = {7: 60, 8: 90, 9: 130, 10: 180, 11: 240, 12: 320}
STAGES = ('刚播种', '发芽', '生长中', '快成熟', '可收获')

admin_params.declare('farm', 'steal_daily_limit', 'steal_percent', 'min_owner_percent',
                     'steal_limit_per_cycle', 'help_daily_limit', 'watchdog_hours')


def _param(conn, key, fallback):
    return int(admin_params.value(conn, 'farm', key, fallback))


def _economy():
    return importlib.import_module('modules.economy.service')


def _social():
    try:
        return importlib.import_module('modules.social.service')
    except ModuleNotFoundError:
        return None


def _day():
    return datetime.fromtimestamp(clock.now_ts(), timezone.utc).strftime('%Y-%m-%d')


def _human_id(actor):
    return getattr(actor, 'owner_id', None) if getattr(actor, 'kind', 'human') == 'agent' else actor.id


def _person(conn, principal_id):
    row = conn.execute(
        'SELECT p.id, p.kind, p.status, c.handle, pr.display_name, pr.avatar_ref, pr.level '
        'FROM principal p LEFT JOIN credential c ON c.principal_id = p.id '
        'JOIN profile pr ON pr.principal_id = p.id WHERE p.id = ?', (principal_id,)
    ).fetchone()
    if row is None or row['status'] != 'active' or row['kind'] != 'human':
        raise ApiError('resource_not_found')
    return row


def person_by_handle(conn, handle):
    row = conn.execute(
        'SELECT p.id FROM credential c JOIN principal p ON p.id = c.principal_id '
        "WHERE lower(c.handle) = lower(?) AND p.kind = 'human' AND p.status = 'active'", (handle,)
    ).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row['id']


def ensure_farm(conn, owner_id):
    person = _person(conn, owner_id)
    now = clock.now()
    target = LEVEL_PLOTS.get(int(person['level']), 6)
    conn.execute(
        'INSERT OR IGNORE INTO farm_member (owner_id, plot_count, created_at, updated_at) VALUES (?, ?, ?, ?)',
        (owner_id, target, now, now),
    )
    conn.execute(
        'UPDATE farm_member SET plot_count = max(plot_count, ?), updated_at = ? WHERE owner_id = ?',
        (target, now, owner_id),
    )
    for index in range(1, 13):
        conn.execute(
            'INSERT OR IGNORE INTO farm_plot (owner_id, plot_index, updated_at) VALUES (?, ?, ?)',
            (owner_id, index, now),
        )
    return conn.execute('SELECT * FROM farm_member WHERE owner_id = ?', (owner_id,)).fetchone()


def set_relationship(conn, source_id, target_id, *, following=None, blocked=None):
    """SOCIAL-1 不可用时的兼容镜像；新请求优先读社交正本。"""
    current = conn.execute(
        'SELECT following, blocked FROM farm_relationship WHERE source_id = ? AND target_id = ?',
        (source_id, target_id),
    ).fetchone()
    follow_value = int(following if following is not None else (current['following'] if current else 0))
    block_value = int(blocked if blocked is not None else (current['blocked'] if current else 0))
    conn.execute(
        'INSERT INTO farm_relationship (source_id, target_id, following, blocked, updated_at) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT(source_id, target_id) DO UPDATE SET following = excluded.following, '
        'blocked = excluded.blocked, updated_at = excluded.updated_at',
        (source_id, target_id, follow_value, block_value, clock.now()),
    )


def _blocked(conn, left, right):
    social = _social()
    if social is not None and social.installed(conn):
        return social.blocked(conn, left, right)
    return conn.execute(
        'SELECT 1 FROM farm_relationship WHERE ((source_id = ? AND target_id = ?) '
        'OR (source_id = ? AND target_id = ?)) AND blocked = 1 LIMIT 1',
        (left, right, right, left),
    ).fetchone() is not None


def _friends(conn, left, right):
    if left == right:
        return True
    social = _social()
    if social is not None and social.installed(conn):
        return social.mutual(conn, left, right)
    if _blocked(conn, left, right):
        return False
    count = conn.execute(
        'SELECT count(*) FROM farm_relationship WHERE following = 1 '
        'AND ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))',
        (left, right, right, left),
    ).fetchone()[0]
    return count == 2


def _require_visible(conn, viewer_id, owner_id):
    if viewer_id != owner_id and _blocked(conn, viewer_id, owner_id):
        raise ApiError('resource_not_found')


def _crop(conn, key):
    row = conn.execute('SELECT * FROM farm_crop WHERE key = ?', (key,)).fetchone()
    if row is None:
        raise ApiError('validation_failed', '没有这种作物')
    return row


def crop_catalog(conn):
    return [dict(row) for row in conn.execute('SELECT * FROM farm_crop ORDER BY sort_order').fetchall()]


def _plot(conn, owner_id, index):
    ensure_farm(conn, owner_id)
    row = conn.execute(
        'SELECT p.*, c.name, c.grow_seconds, c.seed_cost, c.harvest_bamboo, c.asset '
        'FROM farm_plot p LEFT JOIN farm_crop c ON c.key = p.crop_key '
        'WHERE p.owner_id = ? AND p.plot_index = ?', (owner_id, index),
    ).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _plot_view(conn, row, unlocked):
    base = {'index': row['plot_index'], 'unlocked': bool(unlocked), 'state': 'locked' if not unlocked else 'empty'}
    if not unlocked or row['crop_key'] is None:
        return base
    elapsed = max(0, int(clock.now_ts() - clock.parse(row['planted_at']) + row['speed_seconds']))
    duration = int(row['grow_seconds'])
    ratio = min(1, elapsed / duration)
    stage_index = 4 if ratio >= 1 else min(3, int(ratio * 4))
    ready_ts = clock.parse(row['planted_at']) + duration - row['speed_seconds']
    stolen = conn.execute(
        'SELECT coalesce(sum(amount), 0) FROM farm_steal_log WHERE cycle_id = ?', (row['cycle_id'],)
    ).fetchone()[0]
    gross = int(row['settled_bamboo']) if row['yield_settled'] else int(row['harvest_bamboo'])
    remaining = max(0, gross - int(stolen))
    base.update({
        'state': 'mature' if stage_index == 4 else 'growing',
        'crop': {'key': row['crop_key'], 'name': row['name'], 'asset': row['asset'],
                 'grow_seconds': duration, 'seed_cost': row['seed_cost'], 'harvest_bamboo': row['harvest_bamboo']},
        'cycleId': row['cycle_id'], 'stage': stage_index, 'stageLabel': STAGES[stage_index],
        'progress': round(ratio, 4), 'readyAt': clock.iso(ready_ts),
        'secondsRemaining': max(0, int(ready_ts - clock.now_ts())),
        'needsWater': row['watered_at'] is None and stage_index < 4,
        'needsWeed': row['weeded_at'] is None and ratio >= 0.25 and stage_index < 4,
        'stealCount': row['steal_count'], 'remainingBamboo': remaining,
        'remainingPercent': round(remaining * 100 / int(row['harvest_bamboo'])),
    })
    return base


def view(conn, viewer, owner_id):
    viewer_id = _human_id(viewer)
    _require_visible(conn, viewer_id, owner_id)
    member = ensure_farm(conn, owner_id)
    person = _person(conn, owner_id)
    plots = [_plot_view(conn, row, row['plot_index'] <= member['plot_count']) for row in conn.execute(
        'SELECT p.*, c.name, c.grow_seconds, c.seed_cost, c.harvest_bamboo, c.asset '
        'FROM farm_plot p LEFT JOIN farm_crop c ON c.key = p.crop_key '
        'WHERE p.owner_id = ? ORDER BY p.plot_index', (owner_id,)
    ).fetchall()]
    watchdog = bool(member['watchdog_until'] and clock.parse(member['watchdog_until']) > clock.now_ts())
    try:
        bamboo = int(_economy().balance(conn, owner_id, 'bamboo'))
    except (ImportError, ModuleNotFoundError):
        bamboo = None
    return {
        'owner': {'id': person['id'], 'handle': person['handle'], 'name': person['display_name'],
                  'avatar': person['avatar_ref'], 'level': person['level']},
        'mine': viewer_id == owner_id, 'friend': _friends(conn, viewer_id, owner_id),
        'plotCount': member['plot_count'], 'watchdog': watchdog, 'watchdogUntil': member['watchdog_until'],
        'bamboo': bamboo, 'plots': plots, 'crops': crop_catalog(conn) if viewer_id == owner_id else [],
    }


def plant(conn, actor, index, crop_key):
    if getattr(actor, 'kind', 'human') != 'human':
        raise ApiError('action_not_allowed')
    member = ensure_farm(conn, actor.id)
    if index > member['plot_count']:
        raise ApiError('action_not_allowed', '这块地还没有解锁')
    row = _plot(conn, actor.id, index)
    if row['crop_key'] is not None:
        raise ApiError('state_conflict', '这块地已经种了作物')
    crop = _crop(conn, crop_key)
    cycle = str(uuid.uuid4())
    _economy().debit(conn, actor.id, 'bamboo', int(crop['seed_cost']), 'farm.plant', f'farm:plant:{cycle}',
                     ref=cycle)
    now = clock.now()
    conn.execute(
        'UPDATE farm_plot SET crop_key = ?, cycle_id = ?, planted_at = ?, speed_seconds = 0, watered_at = NULL, '
        'weeded_at = NULL, yield_settled = 0, settled_bamboo = 0, steal_count = 0, updated_at = ? '
        'WHERE owner_id = ? AND plot_index = ?', (crop_key, cycle, now, now, actor.id, index),
    )
    return _plot_view(conn, _plot(conn, actor.id, index), True)


def _emit_help(conn, owner_id, helper_id, action, index, request_id=None):
    person = _person(conn, helper_id)
    verb = '浇了水' if action == 'water' else '除掉了虫'
    payload = {'recipient_id': owner_id, 'helper_id': helper_id, 'plot_index': index,
               'action': action, 'message': f"{person['display_name']}替第 {index} 块地{verb}，成熟又近了一点。"}
    outbox.emit(conn, 'farm.helped', 'farm', owner_id, payload, actor_id=helper_id, request_id=request_id)
    outbox.emit(conn, 'notify.system.farm_helped', 'farm', owner_id, payload,
                actor_id=helper_id, request_id=request_id)


def help_plot(conn, actor, owner_id, index, action, request_id=None):
    if action not in ('water', 'weed'):
        raise ApiError('validation_failed')
    if getattr(actor, 'kind', 'human') == 'agent' and action != 'water':
        raise ApiError('action_not_allowed', 'Agent 只能浇水和提醒')
    helper_owner = _human_id(actor)
    _require_visible(conn, helper_owner, owner_id)
    if helper_owner != owner_id and not _friends(conn, helper_owner, owner_id):
        raise ApiError('action_not_allowed', '只有好友能帮忙照料')
    row = _plot(conn, owner_id, index)
    if row['crop_key'] is None:
        raise ApiError('state_conflict', '空地不需要照料')
    view_row = _plot_view(conn, row, True)
    if view_row['state'] == 'mature':
        raise ApiError('state_conflict', '作物已经成熟')
    needed = view_row['needsWater'] if action == 'water' else view_row['needsWeed']
    if not needed:
        raise ApiError('state_conflict', '这块地现在不需要这项照料')
    helper_id = actor.id
    if conn.execute('SELECT 1 FROM farm_help_log WHERE cycle_id = ? AND helper_id = ? AND action = ?',
                    (row['cycle_id'], helper_id, action)).fetchone():
        raise ApiError('state_conflict', '这块地已经帮过一次了')
    if helper_owner != owner_id:
        used = conn.execute('SELECT count(*) FROM farm_help_log WHERE helper_id = ? AND day = ?',
                            (helper_id, _day())).fetchone()[0]
        if used >= _param(conn, 'help_daily_limit', HELP_DAILY_LIMIT):
            raise ApiError('rate_limited', '今天帮忙次数已经用完')
    now = clock.now()
    conn.execute(
        'INSERT INTO farm_help_log (id, cycle_id, plot_owner_id, plot_index, helper_id, action, day, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (str(uuid.uuid4()), row['cycle_id'], owner_id, index, helper_id, action, _day(), now),
    )
    field = 'watered_at' if action == 'water' else 'weeded_at'
    bonus = round(int(row['grow_seconds']) * 0.05) if helper_owner != owner_id else 0
    conn.execute(
        f'UPDATE farm_plot SET {field} = ?, speed_seconds = speed_seconds + ?, updated_at = ? '
        'WHERE owner_id = ? AND plot_index = ?', (now, bonus, now, owner_id, index),
    )
    if helper_owner != owner_id:
        _emit_help(conn, owner_id, helper_owner, action, index, request_id)
    return _plot_view(conn, _plot(conn, owner_id, index), True)


def _settle_yield(conn, owner_id, row):
    if row['yield_settled']:
        return int(row['settled_bamboo'])
    credited = int(_economy().credit(
        conn, owner_id, 'bamboo', int(row['harvest_bamboo']), 'farm.harvest',
        f"farm:mature:{row['cycle_id']}", ref=row['cycle_id'],
    ))
    conn.execute('UPDATE farm_plot SET yield_settled = 1, settled_bamboo = ? '
                 'WHERE owner_id = ? AND plot_index = ?', (credited, owner_id, row['plot_index']))
    return credited


def steal(conn, actor, owner_id, index, request_id=None):
    if getattr(actor, 'kind', 'human') != 'human':
        raise ApiError('action_not_allowed', 'Agent 不能偷菜')
    if actor.id == owner_id or not _friends(conn, actor.id, owner_id):
        raise ApiError('action_not_allowed', '只有互相关注的好友能偷菜')
    _require_visible(conn, actor.id, owner_id)
    row = _plot(conn, owner_id, index)
    current = _plot_view(conn, row, True)
    if current['state'] != 'mature':
        raise ApiError('state_conflict', '作物还没有成熟')
    member = ensure_farm(conn, owner_id)
    if member['watchdog_until'] and clock.parse(member['watchdog_until']) > clock.now_ts():
        thief = _person(conn, actor.id)
        message = f"{thief['display_name']}来过，第 {index} 块地的看门熊猫请他喝了杯水。"
        conn.execute(
            'INSERT INTO farm_message (id, farm_owner_id, author_id, body, kind, created_at) '
            "VALUES (?, ?, ?, ?, 'watchdog', ?)",
            (str(uuid.uuid4()), owner_id, actor.id, message, clock.now()),
        )
        return {'stolen': False, 'guarded': True, 'message': message, 'plot': current}
    if row['steal_count'] >= _param(conn, 'steal_limit_per_cycle', STEAL_LIMIT_PER_CYCLE):
        raise ApiError('state_conflict', '这块地今天已经很热闹了')
    if conn.execute('SELECT 1 FROM farm_steal_log WHERE cycle_id = ? AND thief_id = ?',
                    (row['cycle_id'], actor.id)).fetchone():
        raise ApiError('state_conflict', '同一块地只能偷一次')
    used = conn.execute('SELECT count(*) FROM farm_steal_log WHERE thief_id = ? AND day = ?',
                        (actor.id, _day())).fetchone()[0]
    daily_limit = _param(conn, 'steal_daily_limit', STEAL_DAILY_LIMIT)
    if used >= daily_limit:
        raise ApiError('rate_limited', f'今天已经偷满 {daily_limit} 次了')
    steal_percent = _param(conn, 'steal_percent', STEAL_PERCENT)
    owner_percent = _param(conn, 'min_owner_percent', MIN_OWNER_PERCENT)
    amount = max(1, int(row['harvest_bamboo']) * steal_percent // 100)
    stolen_before = int(row['harvest_bamboo']) - current['remainingBamboo']
    max_stolen = int(row['harvest_bamboo']) * (100 - owner_percent) // 100
    amount = min(amount, max_stolen - stolen_before)
    if amount <= 0:
        raise ApiError('state_conflict', '要给主人留够收成')
    settled = _settle_yield(conn, owner_id, row)
    amount = min(amount, max(0, settled - stolen_before - int(row['harvest_bamboo']) * owner_percent // 100))
    if amount <= 0:
        raise ApiError('rate_limited', '今天的收获额度不足，不能再分走')
    paid = int(_economy().transfer_game(
        conn, owner_id, actor.id, 'bamboo', amount, 'farm.steal',
        f"farm:steal:{row['cycle_id']}:{actor.id}", ref=row['cycle_id'],
    ))
    if paid <= 0:
        raise ApiError('rate_limited', '今天的游戏结算额度用完了')
    now = clock.now()
    conn.execute(
        'INSERT INTO farm_steal_log (id, cycle_id, plot_owner_id, plot_index, thief_id, amount, day, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (str(uuid.uuid4()), row['cycle_id'], owner_id, index, actor.id, paid, _day(), now),
    )
    conn.execute('UPDATE farm_plot SET steal_count = steal_count + 1, updated_at = ? '
                 'WHERE owner_id = ? AND plot_index = ?', (now, owner_id, index))
    thief = _person(conn, actor.id)
    crop_name = row['name']
    payload = {'recipient_id': owner_id, 'thief_id': actor.id, 'plot_index': index, 'amount': paid,
               'crop': row['crop_key'], 'message': f"{thief['display_name']}抱走了 {paid} 根竹子份的{crop_name}，给你留足了收成。"}
    outbox.emit(conn, 'farm.stolen', 'farm', owner_id, payload, actor_id=actor.id, request_id=request_id)
    outbox.emit(conn, 'notify.system.farm_stolen', 'farm', owner_id, payload,
                actor_id=actor.id, request_id=request_id)
    return {'stolen': True, 'guarded': False, 'amount': paid,
            'plot': _plot_view(conn, _plot(conn, owner_id, index), True)}


def harvest(conn, actor, index, request_id=None):
    if getattr(actor, 'kind', 'human') != 'human':
        raise ApiError('action_not_allowed')
    row = _plot(conn, actor.id, index)
    current = _plot_view(conn, row, True)
    if current['state'] != 'mature':
        raise ApiError('state_conflict', '作物还没有成熟')
    settled = _settle_yield(conn, actor.id, row)
    stolen = conn.execute('SELECT coalesce(sum(amount), 0) FROM farm_steal_log WHERE cycle_id = ?',
                          (row['cycle_id'],)).fetchone()[0]
    kept = max(0, settled - int(stolen))
    crop_name = row['name']
    cycle_id = row['cycle_id']
    now = clock.now()
    conn.execute(
        'UPDATE farm_plot SET crop_key = NULL, cycle_id = NULL, planted_at = NULL, speed_seconds = 0, '
        'watered_at = NULL, weeded_at = NULL, yield_settled = 0, settled_bamboo = 0, '
        'steal_count = 0, updated_at = ? '
        'WHERE owner_id = ? AND plot_index = ?', (now, actor.id, index),
    )
    payload = {'recipient_id': actor.id, 'plot_index': index, 'crop': row['crop_key'],
               'bamboo': kept, 'message': f'收获了{crop_name}，竹子到账。'}
    outbox.emit(conn, 'farm.harvested', 'farm', actor.id, payload, actor_id=actor.id, request_id=request_id)
    outbox.emit(conn, 'achievement.progress', 'principal', actor.id,
                {'principal_id': actor.id, 'metric': 'farm.harvest', 'value': 1, 'ref': cycle_id},
                actor_id=actor.id, request_id=request_id)
    return {'crop': row['crop_key'], 'cropName': crop_name, 'bamboo': kept,
            'plot': _plot_view(conn, _plot(conn, actor.id, index), True)}


def unlock(conn, actor, index):
    if getattr(actor, 'kind', 'human') != 'human':
        raise ApiError('action_not_allowed')
    member = ensure_farm(conn, actor.id)
    if index != member['plot_count'] + 1 or index not in PLOT_PRICES:
        raise ApiError('state_conflict', '只能按顺序扩建下一块地')
    price = PLOT_PRICES[index]
    _economy().debit(conn, actor.id, 'bamboo', price, 'farm.unlock', f'farm:unlock:{actor.id}:{index}',
                     ref=str(index))
    conn.execute('UPDATE farm_member SET plot_count = ?, updated_at = ? WHERE owner_id = ?',
                 (index, clock.now(), actor.id))
    return {'plotCount': index, 'price': price}


def set_watchdog(conn, actor, enabled):
    if getattr(actor, 'kind', 'human') != 'human':
        raise ApiError('action_not_allowed')
    ensure_farm(conn, actor.id)
    hours = _param(conn, 'watchdog_hours', WATCHDOG_HOURS)
    until = clock.iso(clock.now_ts() + hours * 3600) if enabled else None
    conn.execute('UPDATE farm_member SET watchdog_until = ?, updated_at = ? WHERE owner_id = ?',
                 (until, clock.now(), actor.id))
    return {'watchdog': bool(enabled), 'watchdogUntil': until}


def messages(conn, viewer, owner_id, limit=30):
    _require_visible(conn, _human_id(viewer), owner_id)
    ensure_farm(conn, owner_id)
    rows = conn.execute(
        'SELECT m.id, m.body, m.kind, m.created_at, m.author_id, p.display_name '
        'FROM farm_message m JOIN profile p ON p.principal_id = m.author_id '
        'WHERE m.farm_owner_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?',
        (owner_id, min(50, max(1, int(limit)))),
    ).fetchall()
    return [{'id': r['id'], 'body': r['body'], 'kind': r['kind'], 'createdAt': r['created_at'],
             'author': {'id': r['author_id'], 'name': r['display_name']}} for r in rows]


def leave_message(conn, actor, owner_id, body):
    if getattr(actor, 'kind', 'human') != 'human':
        raise ApiError('action_not_allowed')
    _require_visible(conn, actor.id, owner_id)
    text = ' '.join(str(body).split())
    if not text or len(text) > 120:
        raise ApiError('validation_failed', '留言需要 1–120 个字')
    message_id = str(uuid.uuid4())
    created_at = clock.now()
    conn.execute(
        'INSERT INTO farm_message (id, farm_owner_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
        (message_id, owner_id, actor.id, text, created_at),
    )
    author = _person(conn, actor.id)
    return {'id': message_id, 'body': text, 'kind': 'message', 'createdAt': created_at,
            'author': {'id': actor.id, 'name': author['display_name']}}


def friend_farms(conn, actor):
    owner_id = _human_id(actor)
    social = _social()
    if social is not None and social.installed(conn):
        candidate_ids = social.friend_ids(conn, owner_id)
    else:
        candidates = conn.execute(
            'SELECT r.target_id FROM farm_relationship r JOIN farm_relationship back '
            'ON back.source_id = r.target_id AND back.target_id = r.source_id '
            'WHERE r.source_id = ? AND r.following = 1 AND back.following = 1 '
            'AND r.blocked = 0 AND back.blocked = 0 ORDER BY r.target_id', (owner_id,),
        ).fetchall()
        candidate_ids = [candidate['target_id'] for candidate in candidates]
    farms = []
    for candidate_id in candidate_ids:
        data = view(conn, actor, candidate_id)
        stealable = sum(1 for p in data['plots'] if p.get('state') == 'mature' and p.get('stealCount', 0) < 2)
        needs_help = sum(1 for p in data['plots'] if p.get('needsWater') or p.get('needsWeed'))
        farms.append({'owner': data['owner'], 'stealable': stealable, 'needsHelp': needs_help,
                      'watchdog': data['watchdog']})
    farms.sort(key=lambda item: (-int(item['stealable'] > 0), -item['stealable'],
                                 -int(item['needsHelp'] > 0), -item['needsHelp'], item['owner']['handle']))
    return farms


def remind_owner(conn, actor, request_id=None):
    owner_id = _human_id(actor)
    data = view(conn, actor, owner_id)
    ready = sum(1 for p in data['plots'] if p.get('state') == 'mature')
    needs = sum(1 for p in data['plots'] if p.get('needsWater') or p.get('needsWeed'))
    message = f'你的农场有 {ready} 块可收获、{needs} 块需要照料。'
    payload = {'recipient_id': owner_id, 'message': message, 'ready': ready, 'needs_help': needs}
    outbox.emit(conn, 'farm.reminded', 'farm', owner_id, payload, actor_id=actor.id, request_id=request_id)
    outbox.emit(conn, 'notify.system.farm_reminder', 'farm', owner_id, payload,
                actor_id=actor.id, request_id=request_id)
    return payload


def purge(conn, principal_id):
    conn.execute('DELETE FROM farm_relationship WHERE source_id = ? OR target_id = ?',
                 (principal_id, principal_id))
    conn.execute('DELETE FROM farm_message WHERE farm_owner_id = ? OR author_id = ?',
                 (principal_id, principal_id))
    conn.execute('DELETE FROM farm_help_log WHERE plot_owner_id = ? OR helper_id = ?',
                 (principal_id, principal_id))
    conn.execute('DELETE FROM farm_steal_log WHERE plot_owner_id = ? OR thief_id = ?',
                 (principal_id, principal_id))
    conn.execute('DELETE FROM farm_plot WHERE owner_id = ?', (principal_id,))
    conn.execute('DELETE FROM farm_member WHERE owner_id = ?', (principal_id,))

