"""贡献流水的防刷：一律在调用 ledger.record 之前判断。

对外稳定接口：assess_useful(conn, *, giver_id, receiver_id, object_id, now) -> dict
返回恰好四个键：{'allow': bool, 'points': int, 'discount': float, 'reason': str | None}。
"""
import math
import random
from datetime import datetime, timezone

from app import clock, ledger

from . import rules

MAX_TREE_DEPTH = 24
DENY = {
    'self': '不能给自己标',
    'giver_inactive': '标记人账号不可用',
    'receiver_inactive': '接收人账号不可用',
    'giver_level_too_low': '标记人等级不够',
    'giver_account_too_new': '标记人账号不满 7 天',
    'invite_tree': '标记人和接收人在同一条邀请链上',
    'already_marked': '这个对象已经标过了',
    'pair_daily_cap': '同一人对同一接收人当天标记次数已到上限',
    'daily_cap': '接收人今天收到的「有用」已到上限',
}


def to_ts(now=None):
    if now is None:
        return clock.now_ts()
    if isinstance(now, datetime):
        return (now if now.tzinfo else now.replace(tzinfo=timezone.utc)).timestamp()
    if isinstance(now, str):
        return clock.parse(now)
    return float(now)


def ancestors(conn, pid):
    seen = []
    current = pid
    for _ in range(MAX_TREE_DEPTH):
        row = conn.execute('SELECT inviter_id FROM invite_edge WHERE invitee_id = ?', (current,)).fetchone()
        if row is None or row[0] is None or row[0] in seen or row[0] == pid:
            break
        seen.append(row[0])
        current = row[0]
    return seen


def in_invite_tree(conn, a, b):
    """a、b 任一方在另一方的邀请链上（祖先或后代）。"""
    return b in ancestors(conn, a) or a in ancestors(conn, b)


def conflict(conn, a, b):
    """利益关系：同一人、邀请链上下游、同一个邀请人拉进来的。"""
    if a == b:
        return True
    if in_invite_tree(conn, a, b):
        return True
    edge_a = conn.execute('SELECT inviter_id FROM invite_edge WHERE invitee_id = ?', (a,)).fetchone()
    edge_b = conn.execute('SELECT inviter_id FROM invite_edge WHERE invitee_id = ?', (b,)).fetchone()
    return bool(edge_a and edge_b and edge_a[0] is not None and edge_a[0] == edge_b[0])


LIVE = ('e.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM ledger_entry rv WHERE rv.reverses_id = e.id)')


def _principal(conn, pid):
    return conn.execute(
        'SELECT p.status, p.created_at, pr.level FROM principal p JOIN profile pr ON pr.principal_id = p.id '
        'WHERE p.id = ?', (pid,)).fetchone()


def _roles(conn, pid):
    return {r[0] for r in conn.execute(
        'SELECT role FROM role_assignment WHERE principal_id = ? AND revoked_at IS NULL', (pid,))}


def _day_bounds(ts):
    start = ts - ts % 86400
    return clock.iso(start), clock.iso(start + 86400)


def _season_window(conn, ts):
    season = rules.season_row(conn, ts)
    if season is None:
        return None, '', '9999'
    return season['id'], season['starts_at'], season['ends_at']


def _useful_detail(conn, giver_id, receiver_id, object_id, ts, cfg):
    def deny(code):
        return {'allow': False, 'points': 0, 'discount': 1.0, 'reason': code, 'weight': 1.0, 'discount_why': None}

    if giver_id == receiver_id:
        return deny('self')
    giver = _principal(conn, giver_id)
    receiver = _principal(conn, receiver_id)
    if giver is None or giver['status'] != 'active':
        return deny('giver_inactive')
    if receiver is None or receiver['status'] != 'active':
        return deny('receiver_inactive')
    if giver['level'] < cfg['useful.min_giver_level']:
        return deny('giver_level_too_low')
    if clock.parse(giver['created_at']) > ts - cfg['useful.min_account_days'] * 86400:
        return deny('giver_account_too_new')
    if in_invite_tree(conn, giver_id, receiver_id):
        return deny('invite_tree')
    if conn.execute('SELECT 1 FROM ledger_entry WHERE idempotency_key = ?', (f'useful:{giver_id}:{object_id}',)).fetchone():
        return deny('already_marked')
    day_start, day_end = _day_bounds(ts)
    pair_today = conn.execute(
        f"SELECT count(*) FROM ledger_entry e WHERE e.event_type = 'useful' AND e.actor_id = ? AND e.subject_id = ? "
        f'AND e.created_at >= ? AND e.created_at < ? AND {LIVE}', (giver_id, receiver_id, day_start, day_end)).fetchone()[0]
    if pair_today >= cfg['useful.pair_daily_cap']:
        return deny('pair_daily_cap')
    factor, why = 1.0, None
    _, window_start, window_end = _season_window(conn, ts)
    mutual = conn.execute(
        f"SELECT 1 FROM ledger_entry e WHERE e.event_type = 'useful' AND e.actor_id = ? AND e.subject_id = ? "
        f'AND e.created_at >= ? AND e.created_at < ? AND {LIVE} LIMIT 1',
        (receiver_id, giver_id, window_start, window_end)).fetchone()
    if mutual:
        factor, why = cfg['useful.mutual_factor'], f"互相标记，按 {cfg['useful.mutual_factor']:g} 计"
    weight = min(float(cfg['useful.weights'].get(str(giver['level']), 1.0)), cfg['useful.weight_max'])
    base = cfg['points.useful']
    ceiling = math.floor(base * factor * cfg['useful.weight_max'] + 1e-9)
    points = max(1, min(math.floor(base * factor * weight + 0.5), ceiling))
    today = conn.execute(
        f"SELECT coalesce(sum(e.points), 0) FROM ledger_entry e WHERE e.event_type = 'useful' AND e.subject_id = ? "
        f'AND e.created_at >= ? AND e.created_at < ? AND {LIVE}', (receiver_id, day_start, day_end)).fetchone()[0]
    if today + points > cfg['useful.daily_cap_points']:
        return deny('daily_cap')
    return {'allow': True, 'points': points, 'discount': factor, 'reason': None, 'weight': weight,
            'discount_why': why, 'giver_level': giver['level']}


def assess_useful(conn, *, giver_id, receiver_id, object_id, now=None):
    detail = _useful_detail(conn, giver_id, receiver_id, object_id, to_ts(now), rules.load(conn))
    return {key: detail[key] for key in ('allow', 'points', 'discount', 'reason')}


def _useful_reason(detail):
    parts = [f"一位 L{detail['giver_level']} 队员标了「有用」。"]
    if detail['discount_why']:
        parts.append(f"{detail['discount_why']}，")
    parts.append(f"再按标记人等级权重 {detail['weight']:g} 倍，记 {detail['points']} 分。")
    return ''.join(parts)


def _insert_meta(conn, entry_id, *, event, subject_id, counterparty_id, season, base, factor=1.0, why=None,
                 weight=1.0, reason, confirmer_level):
    conn.execute(
        'INSERT OR IGNORE INTO growth_entry_meta (entry_id, event, subject_id, counterparty_id, season, base_points, '
        'discount_factor, discount_why, weight, reason, confirmer_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (entry_id, event, subject_id, counterparty_id, season, base, factor, why, weight, reason, confirmer_level))


def record_useful(conn, *, giver_id, receiver_id, object_id, request_id=None, now=None):
    """判断 + 写流水 + 写折扣明细。BE-1 优先调这个，个人页才能展示折扣来由。"""
    ts = to_ts(now)
    cfg = rules.load(conn)
    detail = _useful_detail(conn, giver_id, receiver_id, object_id, ts, cfg)
    result = {key: detail[key] for key in ('allow', 'points', 'discount', 'reason')}
    result['entry_id'] = None
    if not detail['allow']:
        return result
    season = rules.season_row(conn, ts)
    season_id = season['id'] if season else None
    entry_id = ledger.record(
        conn, event_type='useful', subject_id=receiver_id, points=detail['points'],
        rule_version=rules.rule_version(conn), idempotency_key=f'useful:{giver_id}:{object_id}',
        source_ref=f'object:{object_id}', actor_id=giver_id, confirmed_by=giver_id, season=season_id,
        request_id=request_id)
    _insert_meta(conn, entry_id, event='useful', subject_id=receiver_id, counterparty_id=giver_id, season=season_id,
                 base=cfg['points.useful'], factor=detail['discount'], why=detail['discount_why'],
                 weight=detail['weight'], reason=_useful_reason(detail), confirmer_level=detail['giver_level'])
    result['entry_id'] = entry_id
    return result


CONFIRMED_EVENTS = ('adopted', 'reproduced', 'curate')
GOVERNED_EVENTS = ('report', 'violation')


def _deny(code):
    return {'allow': False, 'points': 0, 'reason': code, 'entry_id': None}


def award(conn, *, event, subject_id, source_ref, confirmer_id=None, counterparty_id=None, participants=None,
          minutes=None, request_id=None, now=None):
    """其余六种事件：采纳、复现、整理、主持、举报成立、违规成立。判断通过才写流水。"""
    if event not in rules.EVENTS or event == 'useful':
        raise ValueError('award handles adopted/reproduced/curate/host/report/violation')
    ts = to_ts(now)
    cfg = rules.load(conn)
    key = f'{event}:{source_ref}:{subject_id}'
    existing = conn.execute('SELECT id, points FROM ledger_entry WHERE idempotency_key = ?', (key,)).fetchone()
    if existing:
        return {'allow': True, 'points': existing['points'], 'reason': None, 'entry_id': existing['id'], 'replayed': True}
    subject = _principal(conn, subject_id)
    if subject is None or subject['status'] != 'active':
        return _deny('subject_inactive')
    if event in ('adopted', 'reproduced') and not counterparty_id:
        return _deny('counterparty_required')
    season = rules.season_row(conn, ts)
    season_id, window_start, window_end = _season_window(conn, ts)
    confirmer_level = None
    if event in CONFIRMED_EVENTS + GOVERNED_EVENTS:
        if confirmer_id is None:
            return _deny('confirmer_required')
        confirmer = _principal(conn, confirmer_id)
        if confirmer is None or confirmer['status'] != 'active':
            return _deny('confirmer_inactive')
        confirmer_level = confirmer['level']
        if event in GOVERNED_EVENTS:
            if not _roles(conn, confirmer_id) & {'governor', 'admin'}:
                return _deny('confirmer_not_governor')
            if confirmer_id == subject_id:
                return _deny('confirmer_conflict')
        else:
            if confirmer['level'] < cfg['confirm.min_level']:
                return _deny('confirmer_level_too_low')
            if conflict(conn, confirmer_id, subject_id) or (counterparty_id and conflict(conn, confirmer_id, counterparty_id)):
                return _deny('confirmer_conflict')
            by_pair = conn.execute(
                f'SELECT count(*) FROM ledger_entry e WHERE e.confirmed_by = ? AND e.subject_id = ? AND e.season IS ? '
                f"AND e.event_type IN ('adopted', 'reproduced', 'curate') AND {LIVE}",
                (confirmer_id, subject_id, season_id)).fetchone()[0]
            if by_pair >= cfg['confirm.pair_season_cap']:
                return _deny('confirmer_pair_cap')
    if counterparty_id:
        if counterparty_id == subject_id:
            return _deny('counterparty_is_subject')
        other = _principal(conn, counterparty_id)
        if other is None or other['status'] != 'active':
            return _deny('counterparty_inactive')
        if event in CONFIRMED_EVENTS:
            if event == 'reproduced' and confirmer_id == counterparty_id:
                return _deny('confirmer_conflict')
            seen = conn.execute(
                f'SELECT 1 FROM ledger_entry e JOIN growth_entry_meta m ON m.entry_id = e.id WHERE m.event = ? '
                f'AND m.subject_id = ? AND m.counterparty_id = ? AND e.created_at >= ? AND e.created_at < ? AND {LIVE} '
                f'LIMIT 1', (event, subject_id, counterparty_id, window_start, window_end)).fetchone()
            if seen:
                return _deny('pair_once_per_season')
    if event == 'host':
        if not isinstance(participants, int) or participants < cfg['host.min_participants']:
            return _deny('host_participants_too_few')
        if not isinstance(minutes, (int, float)) or minutes < cfg['host.min_minutes']:
            return _deny('host_too_short')
        day_start, day_end = _day_bounds(ts)
        count = conn.execute(
            f"SELECT count(*) FROM ledger_entry e WHERE e.event_type = 'host' AND e.subject_id = ? "
            f'AND e.created_at >= ? AND e.created_at < ? AND {LIVE}', (subject_id, day_start, day_end)).fetchone()[0]
        if count >= cfg['host.daily_cap']:
            return _deny('host_daily_cap')
    points = cfg[f'points.{event}']
    entry_id = ledger.record(
        conn, event_type=event, subject_id=subject_id, points=points, rule_version=rules.rule_version(conn),
        idempotency_key=key, source_ref=source_ref, actor_id=confirmer_id, confirmed_by=confirmer_id,
        season=season['id'] if season else None, request_id=request_id)
    _insert_meta(conn, entry_id, event=event, subject_id=subject_id, counterparty_id=counterparty_id,
                 season=season['id'] if season else None, base=points, reason=_award_reason(event, confirmer_level, cfg,
                 participants, minutes), confirmer_level=confirmer_level)
    return {'allow': True, 'points': points, 'reason': None, 'entry_id': entry_id}


def _award_reason(event, level, cfg, participants, minutes):
    by = f'L{level} ' if level else ''
    return {
        'adopted': f'知识条目被采纳。确认人（{by}随机分派）与你无利益关系；本赛季这对人只计一次。',
        'reproduced': f'作品被别人带着自己的产物复现，{by}第三人确认。本赛季这对人只计一次。',
        'curate': f'整理（合并、补证据或标过期）被{by}确认人确认。',
        'host': f'主持房间 {minutes} 分钟，在场 {participants} 位 L2+。当天最多 {cfg["host.daily_cap"]} 次。',
        'report': '举报被治理员判定成立。',
        'violation': '违规成立，治理员确认，可申诉。',
    }[event]


def pick_confirmer(conn, subject_id, counterparty_id=None, seed=None):
    """随机分派确认人：L3+、活跃、与相关两人都没有利益关系。"""
    cfg = rules.load(conn)
    rows = conn.execute(
        "SELECT p.id FROM principal p JOIN profile pr ON pr.principal_id = p.id WHERE p.status = 'active' "
        "AND p.kind = 'human' AND pr.level >= ? ORDER BY p.id", (cfg['confirm.min_level'],)).fetchall()
    pool = [r[0] for r in rows if not conflict(conn, r[0], subject_id)
            and not (counterparty_id and conflict(conn, r[0], counterparty_id))]
    if not pool:
        return None
    return random.Random(seed).choice(pool)
