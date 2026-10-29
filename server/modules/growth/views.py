"""把引擎和流水整理成 GROW-FE §7 约定的数据形状。"""
import json
from datetime import datetime, timedelta, timezone

from app import clock, ledger

from . import engine, rules, tokens
from .antiabuse import LIVE

HIDDEN_ROLES = ('admin', 'governor')
DEFAULT_REASON = {
    'adopted': '知识条目被采纳或验证。', 'useful': '收到一次「有用」。', 'reproduced': '作品被别人复现。',
    'host': '主持房间。', 'curate': '整理被确认。', 'report': '举报成立。', 'violation': '违规成立，可申诉。',
}


def public_ranking(conn):
    row = conn.execute("SELECT enabled FROM feature_flag WHERE key = 'growth.public_ranking'").fetchone()
    return bool(row and row[0])


def seasons(conn):
    now = rules.season_row(conn)
    return [dict(rules.season_view(r), current=bool(now and now['id'] == r['id']))
            for r in conn.execute('SELECT * FROM growth_season ORDER BY starts_at DESC')]


def pick_season(conn, season_id=None):
    if season_id:
        return conn.execute('SELECT * FROM growth_season WHERE id = ?', (season_id,)).fetchone()
    return rules.season_row(conn) or conn.execute('SELECT * FROM growth_season ORDER BY starts_at DESC LIMIT 1').fetchone()


def is_hidden_role(conn, pid):
    return conn.execute(
        'SELECT 1 FROM role_assignment WHERE principal_id = ? AND revoked_at IS NULL AND role IN (?, ?) LIMIT 1',
        (pid, *HIDDEN_ROLES)).fetchone() is not None


def ledger_rows(conn, pid, season_id, limit=50):
    sql = ('SELECT e.*, m.reason AS m_reason, m.discount_factor, m.discount_why, m.confirmer_level, '
           '(SELECT rv.id FROM ledger_entry rv WHERE rv.reverses_id = e.id) AS reversed_by '
           'FROM ledger_entry e LEFT JOIN growth_entry_meta m ON m.entry_id = e.id WHERE e.subject_id = ?')
    params = [pid]
    if season_id:
        sql += ' AND e.season = ?'
        params.append(season_id)
    sql += ' ORDER BY e.created_at DESC, e.id DESC LIMIT ?'
    params.append(limit)
    out = []
    for r in conn.execute(sql, params):
        level = r['confirmer_level']
        if level is None and r['confirmed_by']:
            row = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (r['confirmed_by'],)).fetchone()
            level = row[0] if row else None
        if r['reverses_id']:
            reason = '冲正：撤回之前那一笔，原记录保留。'
        else:
            reason = r['m_reason'] or DEFAULT_REASON.get(r['event_type'], '')
        factor = r['discount_factor']
        out.append({
            'id': r['id'], 'at': r['created_at'], 'event': r['event_type'], 'points': r['points'],
            'ruleVersion': r['rule_version'], 'confirmer': {'level': level} if level else None, 'reason': reason,
            'discount': {'factor': factor, 'why': r['discount_why']} if factor is not None and factor < 1 else None,
            'reverses': r['reverses_id'], 'reversedBy': r['reversed_by'],
        })
    return out


def weekly(conn, pid, season):
    if season is None:
        return []
    start = datetime.fromtimestamp(clock.parse(season['starts_at']), timezone.utc).date()
    monday = start - timedelta(days=start.weekday())
    today = datetime.fromtimestamp(clock.now_ts(), timezone.utc).date()
    end = min(today, datetime.fromtimestamp(clock.parse(season['ends_at']) - 1, timezone.utc).date())
    result = []
    week = monday
    while week <= end and len(result) < 60:
        upto = clock.iso(datetime(week.year, week.month, week.day, tzinfo=timezone.utc).timestamp() + 7 * 86400)
        total = conn.execute('SELECT coalesce(sum(points), 0) FROM ledger_entry WHERE subject_id = ? AND season = ? '
                             'AND created_at < ?', (pid, season['id'], upto)).fetchone()[0]
        result.append({'week': week.isoformat(), 'total': total})
        week += timedelta(days=7)
    return result


def badges(conn, pid, level):
    first = {}
    for r in conn.execute(
            f'SELECT e.event_type, min(e.created_at) AS first FROM ledger_entry e WHERE e.subject_id = ? AND e.points > 0 '
            f'AND {LIVE} GROUP BY e.event_type', (pid,)):
        first[r['event_type']] = r['first']
    best = conn.execute('SELECT season, sum(points) AS total, max(created_at) AS last FROM ledger_entry '
                        'WHERE subject_id = ? AND season IS NOT NULL GROUP BY season HAVING total >= 100 '
                        'ORDER BY last LIMIT 1', (pid,)).fetchone()
    earned = {
        'first-useful': first.get('useful'), 'reproduced-once': first.get('reproduced'),
        'host-room': first.get('host'), 'curator': first.get('curate'),
        'season-100': best['last'] if best else None,
        'pioneer-mark': clock.now() if level >= 5 else None,
    }
    return [{'id': bid, 'name': name, 'earnedAt': earned[bid][:10] if earned.get(bid) else None, 'how': how,
             'icon': icon} for bid, name, how, icon in rules.BADGES]


def me_view(conn, pid):
    prof = conn.execute(
        'SELECT pr.display_name, pr.level, pr.metering_consent FROM profile pr WHERE pr.principal_id = ?',
        (pid,)).fetchone()
    level = prof['level']
    season = pick_season(conn)
    season_id = season['id'] if season else None
    state = engine.state_row(conn, pid)
    cfg = rules.load(conn)
    unlocks = rules.effective_unlocks(conn)
    nxt = nxt_alt = None
    review = None
    if level < 5:
        target = level + 1
        items, needs_review = engine.criteria(conn, pid, target, False, cfg)
        nxt = {'level': target, 'levelName': rules.LEVEL_NAMES[target], 'criteria': [
            dict(c, metered=c['key'] in engine.METERED) for c in items]}
        if target == 5:
            nxt.update(manual=True, how='只能由治理委员会授予')
        if target == 4:
            nxt.update(review=True, how='达标后由治理员复核')
            row = conn.execute("SELECT state FROM growth_review WHERE principal_id = ? AND target_level = 4 "
                               'ORDER BY created_at DESC LIMIT 1', (pid,)).fetchone()
            review = row['state'] if row else None
        elif target <= engine.AUTO_MAX:
            alt_items, _ = engine.criteria(conn, pid, target, True, cfg)
            nxt_alt = {'level': target, 'levelName': rules.LEVEL_NAMES[target], 'criteria': alt_items}
    points = ledger.balance(conn, pid, season_id) if season_id else 0
    return {
        'id': pid, 'name': prof['display_name'], 'level': level, 'levelName': rules.LEVEL_NAMES[level],
        'consentMetering': bool(prof['metering_consent']), 'season': rules.season_view(season),
        'optedOut': bool(state and state['opted_out']),
        'cooldownUntil': state['cooldown_until'] if state and state['cooldown_until'] and
        clock.parse(state['cooldown_until']) > clock.now_ts() else None,
        'next': nxt, 'nextAlt': nxt_alt, 'review': review,
        'unlocked': [k for k in rules.ACTION_KEYS if unlocks[k]['min_level'] <= level],
        'nextUnlocks': [k for k in rules.ACTION_KEYS if unlocks[k]['min_level'] == level + 1],
        'points': {'season': points, 'weekly': weekly(conn, pid, season)},
        'ledger': ledger_rows(conn, pid, season_id), 'badges': badges(conn, pid, level),
    }


def _eligible_rows(conn, season_id):
    """赛季内每位可上榜成员的总分：退出者、管理员、治理员、非活跃账号都不在内。"""
    rows = conn.execute(
        'SELECT e.subject_id AS id, sum(e.points) AS points, pr.display_name AS name, pr.level AS level '
        'FROM ledger_entry e JOIN principal p ON p.id = e.subject_id AND p.status = ? AND p.kind = ? '
        'JOIN profile pr ON pr.principal_id = e.subject_id '
        'LEFT JOIN growth_state s ON s.principal_id = e.subject_id '
        'WHERE e.season = ? AND coalesce(s.opted_out, 0) = 0 AND NOT EXISTS ('
        'SELECT 1 FROM role_assignment r WHERE r.principal_id = e.subject_id AND r.revoked_at IS NULL '
        'AND r.role IN (?, ?)) GROUP BY e.subject_id HAVING sum(e.points) > 0 '
        'ORDER BY sum(e.points) DESC, e.subject_id', ('active', 'human', season_id, *HIDDEN_ROLES)).fetchall()
    return [dict(r) for r in rows]


def board_view(conn, viewer_id, season_id=None):
    season = pick_season(conn, season_id)
    if season is None:
        return None
    public = public_ranking(conn)
    state = engine.state_row(conn, viewer_id)
    opted_out = bool(state and state['opted_out'])
    excluded = is_hidden_role(conn, viewer_id)
    ranked = _eligible_rows(conn, season['id'])
    week_ago = clock.iso(clock.now_ts() - 7 * 86400)
    recent = {r['subject_id']: r['d'] for r in conn.execute(
        'SELECT subject_id, sum(points) AS d FROM ledger_entry WHERE season = ? AND created_at >= ? '
        'GROUP BY subject_id', (season['id'], week_ago))}
    for i, row in enumerate(ranked, 1):
        row.update(rank=i, delta=recent.get(row['id'], 0), isMe=row['id'] == viewer_id)
    mine = next((r for r in ranked if r['id'] == viewer_id), None)
    self_row = None
    if not excluded:
        if mine is not None:
            self_row = dict(mine, rank=mine['rank'] if public else None)
        else:
            prof = conn.execute('SELECT display_name, level FROM profile WHERE principal_id = ?', (viewer_id,)).fetchone()
            total = conn.execute('SELECT coalesce(sum(points), 0) FROM ledger_entry WHERE subject_id = ? AND season = ?',
                                 (viewer_id, season['id'])).fetchone()[0]
            self_row = {'rank': None, 'id': viewer_id, 'name': prof['display_name'], 'level': prof['level'],
                        'points': total, 'delta': recent.get(viewer_id, 0), 'isMe': True}
    if public:
        contribution = ranked[:20]
    else:
        contribution = [self_row] if self_row is not None and mine is not None else []
    return {'season': rules.season_view(season), 'seasons': seasons(conn), 'publicRanking': public,
            'optedOut': opted_out, 'excluded': excluded, 'contribution': contribution, 'self': self_row}


def tokens_view(conn, viewer_id, season_id=None):
    season = pick_season(conn, season_id)
    if season is None:
        return None
    public = public_ranking(conn)
    rows = conn.execute(
        'SELECT t.*, pr.display_name AS name, pr.level AS level FROM growth_token_report t '
        'JOIN principal p ON p.id = t.principal_id AND p.status = ? AND p.kind = ? '
        'JOIN profile pr ON pr.principal_id = t.principal_id LEFT JOIN growth_state s ON s.principal_id = t.principal_id '
        'WHERE t.season_id = ? AND coalesce(s.opted_out, 0) = 0 AND NOT EXISTS ('
        'SELECT 1 FROM role_assignment r WHERE r.principal_id = t.principal_id AND r.revoked_at IS NULL '
        'AND r.role IN (?, ?))', ('active', 'human', season['id'], *HIDDEN_ROLES)).fetchall()
    order = [b[0] for b in rules.BANDS]
    out = []
    for r in sorted(rows, key=lambda r: (-order.index(r['band']), r['principal_id'])):
        if not public and r['principal_id'] != viewer_id:
            continue
        mid = tokens.band_mid_millions(r['band'])
        works = conn.execute("SELECT count(*) FROM object_head WHERE author_id = ? AND type = 'work' "
                             "AND lifecycle = 'active' AND created_at >= ? AND created_at < ?",
                             (r['principal_id'], season['starts_at'], season['ends_at'])).fetchone()[0]
        counts = {e: conn.execute(
            f'SELECT count(*) FROM ledger_entry e WHERE e.subject_id = ? AND e.event_type = ? AND e.points > 0 '
            f'AND e.season = ? AND {LIVE}', (r['principal_id'], e, season['id'])).fetchone()[0]
            for e in ('adopted', 'reproduced')}
        out.append({
            'id': r['principal_id'], 'name': r['name'], 'level': r['level'], 'band': tokens.band_label(r['band']),
            'bandKey': r['band'], 'family': tokens.family_label(r['family']), 'trust': r['trust'],
            'fromFile': bool(r['from_file']), 'isMe': r['principal_id'] == viewer_id,
            'perMillion': {'works': round(works / mid, 2), 'adopted': round(counts['adopted'] / mid, 2),
                           'reproduced': round(counts['reproduced'] / mid, 2)},
        })
    mine = conn.execute('SELECT * FROM growth_token_report WHERE principal_id = ? AND season_id = ?',
                        (viewer_id, season['id'])).fetchone()
    extras = {
        'season': rules.season_view(season), 'publicRanking': public,
        'mine': {'family': tokens.family_label(mine['family']), 'familyKey': mine['family'],
                 'band': tokens.band_label(mine['band']), 'bandKey': mine['band'], 'trust': mine['trust'],
                 'reportedAt': mine['reported_at']} if mine else None,
        'bands': [{'key': b[0], 'label': b[1]} for b in rules.BANDS],
        'families': [{'key': k, 'label': v} for k, v in rules.FAMILIES],
        'note': 'A 档（平台网关计量）还没上线：现在全部是自报，只展示量级区间，不评奖。',
    }
    return out, extras


def rules_view(conn):
    cfg = rules.load(conn)
    unlocks = rules.effective_unlocks(conn)
    return {
        'ruleVersion': rules.rule_version(conn), 'revision': rules.revision(conn), 'params': cfg,
        'levels': [{'level': n, 'name': name} for n, name in rules.LEVEL_NAMES.items()],
        'events': [{'event': e, 'label': rules.EVENT_LABELS[e], 'points': cfg[f'points.{e}']} for e in rules.EVENTS],
        'unlocks': [{'actionKey': k, 'label': rules.UNLOCK_LABELS[k], 'action': unlocks[k]['action'],
                     'minLevel': unlocks[k]['min_level']} for k in rules.ACTION_KEYS],
        'season': rules.season_view(rules.season_row(conn)), 'seasons': seasons(conn),
        'publicRanking': public_ranking(conn),
        'tokenBands': [{'key': b[0], 'label': b[1]} for b in rules.BANDS],
        'families': [{'key': k, 'label': v} for k, v in rules.FAMILIES],
        'trust': list(rules.TRUST), 'trustImplemented': ['self'],
    }


def review_queue(conn):
    rows = conn.execute(
        "SELECT g.id, g.principal_id, g.target_level, g.snapshot_json, g.created_at, pr.display_name AS name "
        "FROM growth_review g JOIN profile pr ON pr.principal_id = g.principal_id WHERE g.state = 'pending' "
        'ORDER BY g.created_at').fetchall()
    return [{'id': r['id'], 'principalId': r['principal_id'], 'name': r['name'], 'targetLevel': r['target_level'],
             'criteria': json.loads(r['snapshot_json']), 'queuedAt': r['created_at']} for r in rows]
