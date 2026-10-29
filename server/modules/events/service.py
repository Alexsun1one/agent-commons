"""活动、报名、提交、投票与结果。投票只追加；状态切换幂等。"""

import json
import uuid
from datetime import datetime, timedelta, timezone

from app import audit, clock, outbox
from app.errors import ApiError
from modules.admin import params as admin_params


KINDS = ('challenge', 'camp', 'meetup', 'talks', 'campaign')
VISIBILITIES = ('members', 'level', 'space', 'named')
SOURCE_KINDS = ('work', 'prompt', 'talk', 'other')
CAL_TYPE = {
    'challenge': 'workshop',
    'camp': 'workshop',
    'meetup': 'room',
    'talks': 'talk',
    'campaign': 'season',
}
KIND_LABEL = {
    'challenge': '挑战赛',
    'camp': '共学营',
    'meetup': '线下聚会',
    'talks': '讲堂周',
    'campaign': '打榜评选',
}
STATUS_LABEL = {'upcoming': '即将开始', 'live': '进行中', 'ended': '已结束'}
DAILY_VOTES = 3
NEW_ACCOUNT_DAYS = 7
BURST_WINDOW_SEC = 60
BURST_VOTES = 3

admin_params.declare('events', 'daily_votes', 'new_account_days', 'burst_votes')


def _param(conn, key, fallback):
    return int(admin_params.value(conn, 'events', key, fallback))
SHANGHAI = timezone(timedelta(hours=8))


def new_id():
    return str(uuid.uuid4())


def _ts(value=None):
    if value is None:
        return clock.now_ts()
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).timestamp()
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        if value.endswith('Z') and '.' in value:
            return clock.parse(value)
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    return clock.now_ts()


def _iso(value=None):
    return clock.iso(_ts(value))


def _day_key(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%d')


def _shanghai(iso_utc):
    dt = datetime.fromtimestamp(_ts(iso_utc), SHANGHAI)
    return dt.strftime('%Y-%m-%dT%H:%M:%S+08:00')


def desired_status(starts_at, ends_at, now=None):
    now_ts = _ts(now)
    if now_ts < _ts(starts_at):
        return 'upcoming'
    if now_ts < _ts(ends_at):
        return 'live'
    return 'ended'


def visible_sql(actor, alias='e'):
    if not actor.authenticated or actor.status not in ('active', 'pending_deletion'):
        return '0', []
    sql = (
        f'(({alias}.visibility IN (\'members\', \'level\') AND ? >= {alias}.min_level)'
        f' OR ({alias}.visibility = \'space\' AND ? >= {alias}.min_level AND EXISTS ('
        f'SELECT 1 FROM membership evm WHERE evm.space_id = {alias}.space_id'
        f' AND evm.principal_id = ? AND evm.state = \'active\'))'
        f' OR ({alias}.visibility = \'named\' AND EXISTS ('
        f'SELECT 1 FROM event_acl eva WHERE eva.event_id = {alias}.id AND eva.principal_id = ?))'
        f' OR {alias}.host_id = ?)'
    )
    return sql, [actor.level, actor.level, actor.id, actor.id, actor.id]


def is_visible(conn, actor, event):
    sql, params = visible_sql(actor)
    row = conn.execute(
        f'SELECT 1 FROM community_event e WHERE e.id = ? AND {sql}',
        [event['id'], *params],
    ).fetchone()
    return row is not None


def load_visible(conn, actor, event_id):
    row = conn.execute('SELECT * FROM community_event WHERE id = ?', (event_id,)).fetchone()
    if row is None or not is_visible(conn, actor, row):
        raise ApiError('resource_not_found')
    return dict(row)


def _ancestors(conn, pid):
    seen = []
    current = pid
    for _ in range(24):
        row = conn.execute('SELECT inviter_id FROM invite_edge WHERE invitee_id = ?', (current,)).fetchone()
        if row is None or row[0] is None or row[0] in seen or row[0] == pid:
            break
        seen.append(row[0])
        current = row[0]
    return seen


def in_invite_tree(conn, a, b):
    return a == b or b in _ancestors(conn, a) or a in _ancestors(conn, b)


def account_age_days(conn, pid, now=None):
    row = conn.execute('SELECT created_at FROM principal WHERE id = ?', (pid,)).fetchone()
    if row is None:
        return 0
    return max(0, (_ts(now) - _ts(row['created_at'])) / 86400)


def vote_power(conn, actor, now=None):
    if actor.level <= 1 and account_age_days(conn, actor.id, now) < _param(conn, 'new_account_days', NEW_ACCOUNT_DAYS):
        return 0.0
    return 1.0


def _parse_json(value, fallback):
    if not value:
        return fallback
    if isinstance(value, (list, dict)):
        return value
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if isinstance(parsed, type(fallback)) else fallback


def _counts(conn, event_id):
    signups = conn.execute(
        'SELECT count(*) FROM event_signup WHERE event_id = ?', (event_id,)
    ).fetchone()[0]
    submissions = conn.execute(
        'SELECT count(*) FROM event_submission WHERE event_id = ?', (event_id,)
    ).fetchone()[0]
    return int(signups), int(submissions)


def _awards(conn, event_id):
    result = conn.execute('SELECT winners_json FROM event_result WHERE event_id = ?', (event_id,)).fetchone()
    if result is None:
        return []
    return _parse_json(result['winners_json'], [])


def event_view(conn, event, actor=None, *, detail=False):
    signups, submissions = _counts(conn, event['id'])
    view = {
        'id': event['id'],
        'slug': event['slug'],
        'kind': event['kind'],
        'kindLabel': KIND_LABEL[event['kind']],
        'title': event['title'],
        'summary': event['summary'],
        'cover': event['cover'],
        'place': event['place'],
        'hostId': event['host_id'],
        'host': event['host_name'],
        'startsAt': event['starts_at'],
        'endsAt': event['ends_at'],
        'status': event['status'],
        'statusLabel': STATUS_LABEL[event['status']],
        'visibility': event['visibility'],
        'minLevel': event['min_level'],
        'signups': signups,
        'submissions': submissions,
        'href': f"#/{'campaign' if event['kind'] == 'campaign' else 'event'}/{event['id']}",
    }
    if event['status'] == 'ended':
        view['awards'] = _awards(conn, event['id'])
    if detail:
        view['rules'] = event['rules']
        view['rewards'] = _parse_json(event['rewards_json'], [])
        view['timeline'] = _parse_json(event['timeline_json'], [])
        view['signedUp'] = False
        view['submitted'] = False
        view['vote'] = None
        if actor and actor.authenticated:
            view['signedUp'] = conn.execute(
                'SELECT 1 FROM event_signup WHERE event_id = ? AND principal_id = ?',
                (event['id'], actor.id),
            ).fetchone() is not None
            mine = conn.execute(
                'SELECT id FROM event_submission WHERE event_id = ? AND principal_id = ?',
                (event['id'], actor.id),
            ).fetchone()
            view['submitted'] = mine is not None
            view['vote'] = vote_state(conn, actor, event)
    return view


def list_events(conn, actor, *, kind=None, status=None):
    sql, params = visible_sql(actor)
    clauses = [sql]
    args = list(params)
    if kind:
        clauses.append('e.kind = ?')
        args.append(kind)
    if status:
        clauses.append('e.status = ?')
        args.append(status)
    rows = conn.execute(
        'SELECT e.* FROM community_event e WHERE ' + ' AND '.join(clauses) +
        ' ORDER BY e.starts_at ASC, e.id',
        args,
    ).fetchall()
    return [event_view(conn, row, actor) for row in rows]


def calendar_events(conn, actor, start, end):
    sql, params = visible_sql(actor)
    rows = conn.execute(
        'SELECT e.* FROM community_event e WHERE e.starts_at < ? AND e.ends_at > ? AND ' + sql +
        ' ORDER BY e.starts_at ASC, e.id',
        (end, start, *params),
    ).fetchall()
    out = []
    for row in rows:
        href = f"#/{'campaign' if row['kind'] == 'campaign' else 'event'}/{row['id']}"
        out.append({
            'id': f"evt-{row['id']}",
            'type': CAL_TYPE[row['kind']],
            'title': row['title'],
            'summary': row['summary'],
            'start': _shanghai(row['starts_at']),
            'end': _shanghai(row['ends_at']),
            'place': row['place'] or KIND_LABEL[row['kind']],
            'href': href,
            'host': row['host_name'],
            'sample': False,
        })
    return out


def _validate_body(body, *, creating=True):
    if not isinstance(body, dict):
        raise ApiError('validation_failed', '请求体必须是对象')
    allowed = {
        'slug', 'kind', 'title', 'summary', 'cover', 'rules', 'rewards', 'timeline',
        'place', 'host_name', 'starts_at', 'ends_at', 'visibility', 'min_level',
        'space_id', 'acl',
    }
    unknown = set(body) - allowed
    if unknown:
        raise ApiError('unknown_field', '包含不认识的字段')
    kind = body.get('kind')
    if creating and kind not in KINDS:
        raise ApiError('validation_failed', '活动类型不在允许范围内')
    title = (body.get('title') or '').strip()
    if creating and not title:
        raise ApiError('validation_failed', '标题不能空')
    starts = body.get('starts_at')
    ends = body.get('ends_at')
    if creating and (not starts or not ends):
        raise ApiError('validation_failed', '必须写开始和结束时间')
    if starts and ends and _ts(ends) <= _ts(starts):
        raise ApiError('validation_failed', '结束时间必须晚于开始时间')
    visibility = body.get('visibility', 'members')
    if visibility not in VISIBILITIES:
        raise ApiError('validation_failed', '可见范围不在允许范围内')
    min_level = int(body.get('min_level') or 1)
    if min_level < 1 or min_level > 5:
        raise ApiError('validation_failed', '最低等级必须在 1 到 5')
    if visibility == 'space' and not body.get('space_id'):
        raise ApiError('validation_failed', '空间范围必须指定空间')
    rewards = body.get('rewards') or []
    timeline = body.get('timeline') or []
    if not isinstance(rewards, list) or not isinstance(timeline, list):
        raise ApiError('validation_failed', '奖励和时间线必须是数组')
    return {
        'slug': (body.get('slug') or new_id())[:64],
        'kind': kind,
        'title': title[:80],
        'summary': (body.get('summary') or '')[:160],
        'cover': (body.get('cover') or '')[:200],
        'rules': (body.get('rules') or '')[:4000],
        'rewards_json': json.dumps(rewards, ensure_ascii=False),
        'timeline_json': json.dumps(timeline, ensure_ascii=False),
        'place': (body.get('place') or '')[:80],
        'host_name': (body.get('host_name') or '')[:40],
        'starts_at': _iso(starts) if starts else None,
        'ends_at': _iso(ends) if ends else None,
        'visibility': visibility,
        'min_level': min_level,
        'space_id': body.get('space_id'),
        'acl': list(body.get('acl') or []),
    }


def create_event(conn, actor, body, *, request_id=None, now=None):
    data = _validate_body(body, creating=True)
    event_id = new_id()
    stamp = _iso(now)
    status = desired_status(data['starts_at'], data['ends_at'], now)
    conn.execute(
        'INSERT INTO community_event (id, slug, kind, title, summary, cover, rules, rewards_json, '
        'timeline_json, place, host_id, host_name, starts_at, ends_at, visibility, min_level, '
        'space_id, status, created_at, updated_at) VALUES '
        '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (event_id, data['slug'], data['kind'], data['title'], data['summary'], data['cover'],
         data['rules'], data['rewards_json'], data['timeline_json'], data['place'], actor.id,
         data['host_name'] or _display_name(conn, actor.id), data['starts_at'], data['ends_at'], data['visibility'],
         data['min_level'], data['space_id'], status, stamp, stamp),
    )
    for pid in data['acl']:
        conn.execute(
            'INSERT OR IGNORE INTO event_acl (event_id, principal_id) VALUES (?, ?)',
            (event_id, pid),
        )
    audit.record(conn, actor.id, 'events.create', 'event', event_id, request_id=request_id,
                 meta={'kind': data['kind']})
    outbox.emit(conn, 'events.created', 'event', event_id,
                {'kind': data['kind'], 'status': status}, actor_id=actor.id, request_id=request_id)
    return load_visible(conn, actor, event_id)


def signup(conn, actor, event_id, *, request_id=None, now=None):
    event = load_visible(conn, actor, event_id)
    if event['status'] == 'ended':
        raise ApiError('state_conflict', '活动已经结束')
    stamp = _iso(now)
    existing = conn.execute(
        'SELECT created_at FROM event_signup WHERE event_id = ? AND principal_id = ?',
        (event_id, actor.id),
    ).fetchone()
    if existing:
        return {'eventId': event_id, 'signedUp': True, 'createdAt': existing['created_at']}
    conn.execute(
        'INSERT INTO event_signup (event_id, principal_id, created_at) VALUES (?, ?, ?)',
        (event_id, actor.id, stamp),
    )
    audit.record(conn, actor.id, 'events.signup', 'event', event_id, request_id=request_id)
    outbox.emit(conn, 'events.signed_up', 'event', event_id,
                {'principal_id': actor.id}, actor_id=actor.id, request_id=request_id)
    return {'eventId': event_id, 'signedUp': True, 'createdAt': stamp}


def submit(conn, actor, event_id, body, *, request_id=None, now=None):
    event = load_visible(conn, actor, event_id)
    if event['status'] != 'live':
        raise ApiError('state_conflict', '只有进行中的活动可以提交')
    if not isinstance(body, dict):
        raise ApiError('validation_failed', '请求体必须是对象')
    unknown = set(body) - {'title', 'summary', 'source_kind', 'source_ref'}
    if unknown:
        raise ApiError('unknown_field', '包含不认识的字段')
    title = (body.get('title') or '').strip()
    if not title:
        raise ApiError('validation_failed', '标题不能空')
    source_kind = body.get('source_kind') or 'other'
    if source_kind not in SOURCE_KINDS:
        raise ApiError('validation_failed', '提交来源不在允许范围内')
    source_ref = (body.get('source_ref') or title)[:80]
    stamp = _iso(now)
    existing = conn.execute(
        'SELECT * FROM event_submission WHERE event_id = ? AND principal_id = ? '
        'AND source_kind = ? AND source_ref = ?',
        (event_id, actor.id, source_kind, source_ref),
    ).fetchone()
    if existing:
        return submission_view(conn, existing, event)
    submission_id = new_id()
    conn.execute(
        'INSERT INTO event_submission (id, event_id, principal_id, title, summary, source_kind, '
        'source_ref, created_at, last_rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
        (submission_id, event_id, actor.id, title[:80], (body.get('summary') or '')[:160],
         source_kind, source_ref, stamp),
    )
    audit.record(conn, actor.id, 'events.submit', 'event', event_id, request_id=request_id,
                 meta={'submission': submission_id})
    outbox.emit(conn, 'events.submitted', 'event', event_id,
                {'submission_id': submission_id, 'principal_id': actor.id},
                actor_id=actor.id, request_id=request_id)
    row = conn.execute('SELECT * FROM event_submission WHERE id = ?', (submission_id,)).fetchone()
    return submission_view(conn, row, event)


def vote_state(conn, actor, event, now=None):
    power = vote_power(conn, actor, now)
    used = daily_votes_used(conn, actor.id, event['id'], now)
    return {
        'remaining': 0 if power == 0 else max(0, _param(conn, 'daily_votes', DAILY_VOTES) - used),
        'dailyCap': _param(conn, 'daily_votes', DAILY_VOTES),
        'weight': power,
        'canVote': event['status'] == 'live' and event['kind'] == 'campaign' and power > 0 and used < _param(conn, 'daily_votes', DAILY_VOTES),
        'reason': None if power > 0 else 'new_account',
    }


def daily_votes_used(conn, voter_id, event_id, now=None):
    day = _day_key(_ts(now))
    start = f'{day}T00:00:00.000000Z'
    end = clock.iso(_ts(start) + 86400)
    return conn.execute(
        'SELECT count(*) FROM event_vote WHERE event_id = ? AND voter_id = ? '
        'AND created_at >= ? AND created_at < ?',
        (event_id, voter_id, start, end),
    ).fetchone()[0]


def _board_rows(conn, event_id):
    return [dict(row) for row in conn.execute(
        'SELECT s.*, coalesce(sum(v.weight), 0) AS votes, count(v.id) AS ballots '
        'FROM event_submission s LEFT JOIN event_vote v ON v.candidate_id = s.id '
        'WHERE s.event_id = ? GROUP BY s.id ORDER BY votes DESC, s.created_at ASC, s.id',
        (event_id,),
    )]


def _display_name(conn, pid):
    row = conn.execute('SELECT display_name FROM profile WHERE principal_id = ?', (pid,)).fetchone()
    return row['display_name'] if row else pid


def submission_view(conn, row, event, *, rank=None, previous=None, votes=None):
    return {
        'id': row['id'],
        'eventId': row['event_id'],
        'authorId': row['principal_id'],
        'author': _display_name(conn, row['principal_id']),
        'title': row['title'],
        'summary': row['summary'],
        'sourceKind': row['source_kind'],
        'sourceRef': row['source_ref'],
        'createdAt': row['created_at'],
        'votes': 0 if votes is None else votes,
        'rank': rank,
        'delta': None if previous is None or rank is None else previous - rank,
    }


def board(conn, actor, event_id, *, limit=10):
    event = load_visible(conn, actor, event_id)
    rows = _board_rows(conn, event_id)
    items = []
    for index, row in enumerate(rows[: max(1, min(int(limit), 50))], 1):
        items.append(submission_view(
            conn, row, event, rank=index, previous=row['last_rank'], votes=float(row['votes']),
        ))
    return {
        'event': event_view(conn, event, actor, detail=True),
        'items': items,
        'total': len(rows),
    }


def _refresh_ranks(conn, event_id):
    for index, row in enumerate(_board_rows(conn, event_id), 1):
        conn.execute('UPDATE event_submission SET last_rank = ? WHERE id = ?', (index, row['id']))


def _emit_anomaly(conn, event_id, reason, payload, actor_id, request_id=None):
    outbox.emit(
        conn, 'events.vote_anomaly', 'event', event_id,
        {'reason': reason, **payload},
        actor_id=actor_id, request_id=request_id,
    )
    audit.record(conn, actor_id, 'events.vote_anomaly', 'event', event_id,
                 request_id=request_id, meta={'reason': reason})


def vote(conn, actor, event_id, body, *, request_id=None, now=None):
    event = load_visible(conn, actor, event_id)
    if event['kind'] != 'campaign':
        raise ApiError('state_conflict', '只有打榜活动可以投票')
    if event['status'] != 'live':
        raise ApiError('state_conflict', '投票已经结束')
    if not isinstance(body, dict):
        raise ApiError('validation_failed', '请求体必须是对象')
    unknown = set(body) - {'candidate_id'}
    if unknown:
        raise ApiError('unknown_field', '包含不认识的字段')
    candidate_id = body.get('candidate_id')
    candidate = conn.execute(
        'SELECT * FROM event_submission WHERE id = ? AND event_id = ?',
        (candidate_id, event_id),
    ).fetchone()
    if candidate is None:
        raise ApiError('resource_not_found')
    if candidate['principal_id'] == actor.id:
        raise ApiError('action_not_allowed', '不能投自己')
    power = vote_power(conn, actor, now)
    if power <= 0:
        raise ApiError('action_not_allowed', '新号前 7 天只能看榜')
    used = daily_votes_used(conn, actor.id, event_id, now)
    daily_votes = _param(conn, 'daily_votes', DAILY_VOTES)
    if used >= daily_votes:
        raise ApiError('state_conflict', f'今天的 {daily_votes} 票已经用完')
    existing = conn.execute(
        'SELECT id FROM event_vote WHERE event_id = ? AND voter_id = ? AND candidate_id = ?',
        (event_id, actor.id, candidate_id),
    ).fetchone()
    if existing:
        raise ApiError('state_conflict', '已经投过这个候选')
    stamp = _iso(now)
    vote_id = new_id()
    conn.execute(
        'INSERT INTO event_vote (id, event_id, candidate_id, voter_id, weight, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (vote_id, event_id, candidate_id, actor.id, power, stamp),
    )
    if in_invite_tree(conn, actor.id, candidate['principal_id']):
        _emit_anomaly(conn, event_id, 'invite_tree', {
            'voter_id': actor.id, 'candidate_id': candidate_id, 'author_id': candidate['principal_id'],
        }, actor.id, request_id)
    window_start = clock.iso(_ts(now) - BURST_WINDOW_SEC)
    burst = conn.execute(
        'SELECT count(*) FROM event_vote WHERE candidate_id = ? AND created_at >= ?',
        (candidate_id, window_start),
    ).fetchone()[0]
    burst_votes = _param(conn, 'burst_votes', BURST_VOTES)
    if burst >= burst_votes:
        _emit_anomaly(conn, event_id, 'burst', {
            'candidate_id': candidate_id, 'votes': int(burst), 'window_sec': BURST_WINDOW_SEC,
        }, actor.id, request_id)
    _refresh_ranks(conn, event_id)
    audit.record(conn, actor.id, 'events.vote', 'event', event_id, request_id=request_id,
                 meta={'candidate': candidate_id})
    outbox.emit(conn, 'events.voted', 'event', event_id,
                {'vote_id': vote_id, 'candidate_id': candidate_id, 'weight': power},
                actor_id=actor.id, request_id=request_id)
    return board(conn, actor, event_id)


def publish_results(conn, event, *, now=None, request_id=None):
    existing = conn.execute('SELECT * FROM event_result WHERE event_id = ?', (event['id'],)).fetchone()
    if existing:
        return dict(existing)
    rows = _board_rows(conn, event['id'])
    winners = [submission_view(conn, row, event, rank=index, previous=row['last_rank'],
                               votes=float(row['votes']))
               for index, row in enumerate(rows[:10], 1)]
    signups, submissions = _counts(conn, event['id'])
    voters = conn.execute(
        'SELECT count(DISTINCT voter_id) FROM event_vote WHERE event_id = ?', (event['id'],)
    ).fetchone()[0]
    ballots = conn.execute(
        'SELECT count(*) FROM event_vote WHERE event_id = ?', (event['id'],)
    ).fetchone()[0]
    stamp = _iso(now)
    stats = {
        'signups': signups,
        'submissions': submissions,
        'voters': int(voters),
        'ballots': int(ballots),
    }
    conn.execute(
        'INSERT INTO event_result (event_id, published_at, stats_json, winners_json) VALUES (?, ?, ?, ?)',
        (event['id'], stamp, json.dumps(stats, ensure_ascii=False),
         json.dumps(winners, ensure_ascii=False)),
    )
    outbox.emit(conn, 'events.results_published', 'event', event['id'],
                {'winners': len(winners), 'ballots': int(ballots)}, request_id=request_id)
    return {
        'event_id': event['id'],
        'published_at': stamp,
        'stats_json': json.dumps(stats, ensure_ascii=False),
        'winners_json': json.dumps(winners, ensure_ascii=False),
    }


def results_view(conn, actor, event_id):
    event = load_visible(conn, actor, event_id)
    if event['status'] != 'ended':
        raise ApiError('state_conflict', '结果在活动结束后公示')
    row = conn.execute('SELECT * FROM event_result WHERE event_id = ?', (event_id,)).fetchone()
    if row is None:
        row = publish_results(conn, event)
        if not isinstance(row, dict) or 'published_at' not in row:
            row = conn.execute('SELECT * FROM event_result WHERE event_id = ?', (event_id,)).fetchone()
    return {
        'event': event_view(conn, event, actor, detail=True),
        'publishedAt': row['published_at'],
        'stats': _parse_json(row['stats_json'], {}),
        'winners': _parse_json(row['winners_json'], []),
    }


def refresh_statuses(conn, now=None, request_id=None):
    stamp = _iso(now)
    changed = []
    for row in conn.execute('SELECT * FROM community_event').fetchall():
        nxt = desired_status(row['starts_at'], row['ends_at'], now)
        if nxt == row['status']:
            if nxt == 'ended':
                publish_results(conn, dict(row), now=now, request_id=request_id)
            continue
        conn.execute(
            'UPDATE community_event SET status = ?, updated_at = ? WHERE id = ? AND status = ?',
            (nxt, stamp, row['id'], row['status']),
        )
        if nxt == 'ended':
            publish_results(conn, dict(row, status=nxt), now=now, request_id=request_id)
        outbox.emit(conn, 'events.status_changed', 'event', row['id'],
                    {'from': row['status'], 'to': nxt}, request_id=request_id)
        changed.append({'id': row['id'], 'from': row['status'], 'to': nxt})
    return changed


def tick(db, now=None):
    with db.write() as conn:
        return refresh_statuses(conn, now=now)


def submissions(conn, actor, event_id):
    event = load_visible(conn, actor, event_id)
    rows = conn.execute(
        'SELECT * FROM event_submission WHERE event_id = ? ORDER BY created_at ASC, id',
        (event_id,),
    ).fetchall()
    return [submission_view(conn, row, event) for row in rows]


def signups(conn, actor, event_id):
    load_visible(conn, actor, event_id)
    rows = conn.execute(
        'SELECT s.principal_id, s.created_at, p.display_name FROM event_signup s '
        'JOIN profile p ON p.principal_id = s.principal_id WHERE s.event_id = ? '
        'ORDER BY s.created_at ASC',
        (event_id,),
    ).fetchall()
    return [{'id': row['principal_id'], 'name': row['display_name'], 'at': row['created_at']} for row in rows]
