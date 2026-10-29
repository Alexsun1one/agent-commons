import json
import math

from app import audit, clock, outbox
from app.errors import ApiError

RULESET_BASE = 'contrib-2026.10'

LEVEL_NAMES = {1: '新队员', 2: '队员', 3: '骨干', 4: '领航员', 5: '先锋'}
EVENTS = ('adopted', 'useful', 'reproduced', 'host', 'curate', 'report', 'violation')
EVENT_LABELS = {
    'adopted': '知识条目被采纳或验证', 'useful': '回答被标「有用」', 'reproduced': '作品被别人复现',
    'host': '主持房间', 'curate': '整理被确认', 'report': '举报成立', 'violation': '违规成立',
}

# 初值。迁移里的种子行与这里逐项一致（测试会比对）；线上以 growth_rule 表为准。
DEFAULTS = {
    'points.adopted': 20,
    'points.useful': 5,
    'points.reproduced': 30,
    'points.host': 15,
    'points.curate': 10,
    'points.report': 3,
    'points.violation': -50,
    'useful.min_giver_level': 2,
    'useful.min_account_days': 7,
    'useful.daily_cap_points': 30,
    'useful.pair_daily_cap': 2,
    'useful.mutual_factor': 0.5,
    'useful.weight_max': 1.5,
    'useful.weights': {'2': 1.0, '3': 1.2, '4': 1.35, '5': 1.5},
    'confirm.min_level': 3,
    'confirm.pair_season_cap': 2,
    'host.min_participants': 5,
    'host.min_minutes': 10,
    'host.daily_cap': 2,
    'l2.account_days': 7,
    'l2.active_days': 5,
    'l2.useful_received': 3,
    'l2alt.useful_received': 5,
    'l3.window_days': 60,
    'l3.active_ratio': 0.5,
    'l3.adopted': 5,
    'l3.report_min': 10,
    'l3.wilson_min': 0.6,
    'l3alt.useful_received': 10,
    'l3alt.adopted': 5,
    'l4.days_at_l3': 30,
    'l4.adopted': 15,
    'l4.high_value': 3,
    'l4.violation_free_days': 90,
    'l4.reject_cooldown_days': 30,
    'demote.cooldown_days': 14,
}

ACTION_KEYS = ('read', 'discuss', 'favorite', 'report', 'listen', 'knowledge', 'upload', 'hand', 'invite', 'room',
               'suggest', 'hide', 'volunteer', 'stage', 'curate', 'host', 'vote', 'appeal')
UNLOCK_LEVELS = {
    'read': 1, 'discuss': 1, 'favorite': 1, 'report': 1, 'listen': 1,
    'knowledge': 2, 'upload': 2, 'hand': 2, 'invite': 2,
    'room': 3, 'suggest': 3, 'hide': 3, 'volunteer': 3,
    'stage': 4, 'curate': 4, 'host': 4,
    'vote': 5, 'appeal': 5,
}
UNLOCK_LABELS = {
    'read': '读成员可见内容', 'discuss': '发讨论和回复', 'favorite': '收藏', 'report': '举报（权重低）',
    'listen': '进公开房间收听', 'knowledge': '建知识条目', 'upload': '上传附件和 HTML 作品', 'hand': '房间里举手',
    'invite': '邀请（每月 2 个）', 'room': '建讨论室（≤ 20 人）', 'suggest': '对知识提修改建议',
    'hide': '隐藏 L1 内容（需第二位 L3+ 同意）', 'volunteer': '接治理志愿队列', 'stage': '建舞台房',
    'curate': '整理知识（合并、标过期）', 'host': '主持活动', 'vote': '规则修订投票', 'appeal': '复核申诉',
}
# 其他模块已经拥有的动作规则：展示解锁等级时以它们的当前值为准（管理员在运行时调过的也会跟着变）。
UNLOCK_ALIASES = {
    'discuss': 'object.create.discussion', 'knowledge': 'object.create.knowledge', 'upload': 'upload.create',
    'invite': 'invite.create', 'room': 'rooms.create.discussion', 'stage': 'rooms.create.stage',
}

BANDS = (
    ('lt_1m', '不足 100 万', 0, 1_000_000, 0.5),
    ('1m_10m', '100 万–1000 万', 1_000_000, 10_000_000, 5.5),
    ('10m_50m', '1000 万–5000 万', 10_000_000, 50_000_000, 30.0),
    ('50m_100m', '5000 万–1 亿', 50_000_000, 100_000_000, 75.0),
    ('100m_500m', '1–5 亿', 100_000_000, 500_000_000, 300.0),
    ('gte_500m', '5 亿以上', 500_000_000, None, 750.0),
)
FAMILIES = (('claude', 'Claude'), ('gpt', 'GPT'), ('gemini', 'Gemini'), ('local', '本地开源'), ('other', '其他'))
TRUST = ('self', 'gateway')

BADGES = (
    ('first-useful', '第一次被标有用', '收到一次合格的「有用」。', 'appreciation'),
    ('reproduced-once', '被人复现', '作品被别人带着产物复现一次。', 'reproduced'),
    ('host-room', '把房间撑满', '主持一场 ≥ 5 位 L2+、在场 ≥ 10 分钟的房间。', 'discussion'),
    ('season-100', '赛季百分', '单个赛季贡献值达到 100。', 'trending'),
    ('curator', '把知识理顺', '一次整理（合并、补证据或标过期）被确认。', 'organized'),
    ('pioneer-mark', '先锋印记', '由治理委员会授予 L5。不能自己攒。', 'milestone'),
)

REASON_CODES = ('founding_cadre', 'committee', 'correction', 'tuning', 'season_start', 'beta_adjustment')


def load(conn):
    values = dict(DEFAULTS)
    for row in conn.execute('SELECT key, value_json FROM growth_rule'):
        if row['key'] in DEFAULTS:
            values[row['key']] = json.loads(row['value_json'])
    return values


def revision(conn):
    row = conn.execute("SELECT value FROM growth_meta WHERE key = 'revision'").fetchone()
    return int(row[0]) if row else 0


def rule_version(conn):
    rev = revision(conn)
    return RULESET_BASE if rev == 0 else f'{RULESET_BASE}.{rev}'


def validate(key, value):
    if key not in DEFAULTS:
        raise ApiError('validation_failed', '不认识的规则项')
    default = DEFAULTS[key]
    if isinstance(default, dict):
        if not isinstance(value, dict) or set(value) != set(default):
            raise ApiError('validation_failed', '权重表必须包含 2 到 5 级')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 < v <= 1.5 for v in value.values()):
            raise ApiError('validation_failed', '等级权重必须在 0 到 1.5 之间')
        return {k: float(v) for k, v in value.items()}
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError('validation_failed', '规则值必须是数字')
    if isinstance(default, int):
        if not isinstance(value, int) and not float(value).is_integer():
            raise ApiError('validation_failed', '规则值必须是整数')
        value = int(value)
    else:
        value = float(value)
    if key == 'points.violation':
        ok = value <= 0
    elif key.startswith('points.'):
        ok = value >= 0
    elif key == 'useful.mutual_factor':
        ok = 0 < value <= 1
    elif key == 'useful.weight_max':
        ok = 1 <= value <= 1.5
    elif key == 'l3.wilson_min' or key == 'l3.active_ratio':
        ok = 0 < value <= 1
    elif key == 'useful.min_giver_level' or key == 'confirm.min_level':
        ok = 1 <= value <= 5
    else:
        ok = value >= 0
    if not ok:
        raise ApiError('validation_failed', '规则值超出允许范围')
    return value


def update(conn, key, value, actor_id, reason_code, request_id=None):
    value = validate(key, value)
    current = load(conn)[key]
    if current == value:
        raise ApiError('state_conflict', '规则值没有变化')
    now = clock.now()
    conn.execute('INSERT INTO growth_rule (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?) '
                 'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, '
                 'updated_by = excluded.updated_by', (key, json.dumps(value, sort_keys=True), now, actor_id))
    conn.execute("INSERT INTO growth_meta (key, value) VALUES ('revision', '1') "
                 "ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)")
    version = rule_version(conn)
    audit.record(conn, actor_id, 'growth.rule_change', 'growth_rule', key, reason=reason_code, request_id=request_id,
                 meta={'key': key, 'old': current, 'new': value, 'rule_version': version})
    outbox.emit(conn, 'growth.rule_changed', 'growth_rule', key, {'key': key, 'rule_version': version},
                actor_id=actor_id, request_id=request_id)
    return {'key': key, 'old': current, 'new': value, 'rule_version': version}


def effective_unlocks(conn):
    """actionKey -> {'action', 'min_level'}；有别名且别名规则存在时以别名为准。"""
    rows = {r['action']: r['min_level'] for r in conn.execute('SELECT action, min_level FROM action_rule')}
    result = {}
    for key in ACTION_KEYS:
        action = f'growth.unlock.{key}'
        alias = UNLOCK_ALIASES.get(key)
        if alias and rows.get(alias) is not None:
            action = alias
        result[key] = {'action': action, 'min_level': rows.get(action, UNLOCK_LEVELS[key])}
    return result


def set_unlock(conn, action, min_level, actor_id, reason_code, request_id=None):
    if isinstance(min_level, bool) or not isinstance(min_level, int) or not 1 <= min_level <= 5:
        raise ApiError('validation_failed', '等级必须在 1 到 5 之间')
    row = conn.execute('SELECT min_level FROM action_rule WHERE action = ?', (action,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['min_level'] is None:
        raise ApiError('state_conflict', '这条规则只按角色放行，不能改等级')
    if row['min_level'] == min_level:
        raise ApiError('state_conflict', '等级没有变化')
    conn.execute('UPDATE action_rule SET min_level = ?, updated_at = ? WHERE action = ?',
                 (min_level, clock.now(), action))
    audit.record(conn, actor_id, 'growth.unlock_change', 'action_rule', action, reason=reason_code,
                 request_id=request_id, meta={'action': action, 'old': row['min_level'], 'new': min_level})
    outbox.emit(conn, 'growth.unlock_changed', 'action_rule', action,
                {'action': action, 'old': row['min_level'], 'new': min_level}, actor_id=actor_id,
                request_id=request_id)
    return {'action': action, 'old': row['min_level'], 'new': min_level}


def season_row(conn, ts=None):
    """赛季区间为 [starts_at, ends_at)，均为 UTC。"""
    stamp = clock.iso(clock.now_ts() if ts is None else ts)
    return conn.execute('SELECT * FROM growth_season WHERE starts_at <= ? AND ends_at > ? ORDER BY starts_at DESC LIMIT 1',
                        (stamp, stamp)).fetchone()


def season_view(row):
    if row is None:
        return None
    end = clock.parse(row['ends_at']) - 86400
    return {'id': row['id'], 'name': row['name'], 'startsAt': row['starts_at'][:10], 'endsAt': clock.iso(end)[:10]}


def wilson_lower(upheld, total, z=1.96):
    if total <= 0:
        return 0.0
    p = upheld / total
    denom = 1 + z * z / total
    centre = p + z * z / (2 * total)
    margin = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)
    return max(0.0, (centre - margin) / denom)
