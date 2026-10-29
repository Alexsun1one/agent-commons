"""房间的业务规则：谁能建、谁能进、入场授权与 epoch、撤权、主持人工具、议程材料、提醒。路由在 router.py。

函数都接收调用方的连接，写操作由路由包在 `db.write()` 里；需要通知 LiveKit 的动作只返回 effects，
由路由在事务提交之后执行。"""
import json
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

from app import audit, clock, flags, outbox
from app.authz import can, check, require, rule, visible_predicate
from app.errors import ApiError, register

from . import consent

FLAG = 'rooms.enabled'
REC_FLAG = 'rooms.recording'
KINDS = ('discussion', 'stage')
LATER_KINDS = ('live', 'workshop')
OPEN_QUEUE = ('raised', 'invited', 'approved')
KIND_LABEL = {'discussion': '讨论室', 'stage': '舞台', 'live': '直播', 'workshop': '工作坊'}

register('room_not_live', 409, '房间还没开始')
register('room_ended', 409, '房间已经结束')
register('room_locked', 403, '房间已锁定，现在进不了')
register('room_removed', 403, '你已被主持人移出这个房间')
register('room_full', 409, '房间人数已满')
register('room_signup_rejected', 403, '主持人没有通过你的报名')
register('room_duration_cap', 422, '时长超过你能开的上限')
register('room_link_rejected', 422, '只接受白名单里的 https 会议链接（腾讯会议、飞书会议等）')


def new_id():
    return str(uuid.uuid4())


def policy(conn, key):
    row = conn.execute('SELECT value FROM room_policy WHERE key = ?', (key,)).fetchone()
    if row is None:
        raise RuntimeError(f'room_policy {key} missing')
    return row[0]


def plus_minutes(iso, minutes):
    return clock.iso(clock.parse(iso) + minutes * 60)


def ends_at(room):
    return plus_minutes(room['started_at'] or room['starts_at'], room['duration_min'] + room['extended_min'])


def duration_cap(conn, actor):
    """本人满足的各行里取最大；一行都不满足（例如治理员把建房门槛调低了）时取表里最小的上限。"""
    rows = conn.execute('SELECT min_level, role, max_minutes FROM room_duration_cap').fetchall()
    caps = [r['max_minutes'] for r in rows
            if (r['min_level'] is not None and actor.level >= r['min_level'])
            or (r['role'] is not None and r['role'] in actor.roles)]
    if caps:
        return max(caps)
    return min((r['max_minutes'] for r in rows), default=0)


def parse_time(value):
    if value is None:
        return clock.now()
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        raise ApiError('validation_failed', '开始时间格式不对') from None
    if dt.tzinfo is None:
        raise ApiError('validation_failed', '开始时间要带时区')
    return dt.astimezone(timezone.utc).strftime(clock.FORMAT)


# ---------------------------------------------------------------- 外部会议链接

def check_link(conn, url):
    """只认白名单域名的 https 链接；只存不抓。返回 (规范化 URL, 域名, 名称)。"""
    if not isinstance(url, str) or not 12 <= len(url) <= 500:
        raise ApiError('room_link_rejected')
    if any(c.isspace() or ord(c) < 32 or c in '\\"<>`\'' for c in url):
        raise ApiError('room_link_rejected')
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise ApiError('room_link_rejected') from None
    if parts.scheme != 'https' or parts.username or parts.password or port not in (None, 443):
        raise ApiError('room_link_rejected')
    host = (parts.hostname or '').lower()
    row = conn.execute('SELECT label FROM room_link_host WHERE host = ?', (host,)).fetchone()
    if row is None:
        raise ApiError('room_link_rejected')
    clean = f'https://{host}{parts.path or "/"}' + (f'?{parts.query}' if parts.query else '')
    return clean, host, row['label']


def check_file_link(url):
    if not isinstance(url, str) or not 12 <= len(url) <= 500:
        raise ApiError('validation_failed', '链接要以 https:// 开头')
    if any(c.isspace() or ord(c) < 32 or c in '\\"<>`\'' for c in url):
        raise ApiError('validation_failed', '链接里有不允许的字符')
    try:
        parts = urlsplit(url)
        parts.port
    except ValueError:
        raise ApiError('validation_failed', '链接格式不对') from None
    if parts.scheme != 'https' or parts.username or parts.password or not parts.hostname:
        raise ApiError('validation_failed', '链接要以 https:// 开头，不能带账号密码')
    return url


# ---------------------------------------------------------------- 谁能进

def eligible_clause(a='r'):
    """房间进入条件（不含报名审核）。房主永远满足；其余每一条 room_access 都要满足。"""
    return (f"({a}.host_id = :rm_me OR NOT EXISTS (SELECT 1 FROM room_access rac WHERE rac.room_id = {a}.id AND ("
            "(rac.kind = 'level' AND :rm_level < rac.min_level)"
            " OR (rac.kind = 'space' AND NOT EXISTS (SELECT 1 FROM membership rms WHERE rms.space_id = rac.space_id"
            " AND rms.principal_id = :rm_me AND rms.state = 'active'))"
            f" OR (rac.kind = 'invite' AND NOT EXISTS (SELECT 1 FROM room_invite rin WHERE rin.room_id = {a}.id"
            " AND rin.principal_id = :rm_me)))))")


def visible_sql(actor, a='r'):
    if not actor.authenticated or actor.status not in ('active', 'pending_deletion'):
        return '0', {}
    sql = (f'({eligible_clause(a)} AND NOT EXISTS (SELECT 1 FROM room_participant rrm WHERE rrm.room_id = {a}.id'
           ' AND rrm.principal_id = :rm_me AND rrm.removed_at IS NOT NULL))')
    return sql, {'rm_me': actor.id, 'rm_level': actor.level}


def eligible(conn, actor, room_id):
    if not actor.authenticated or actor.status not in ('active', 'pending_deletion'):
        return False
    return conn.execute(f'SELECT 1 FROM room r WHERE r.id = :rid AND {eligible_clause()}',
                        {'rid': room_id, 'rm_me': actor.id, 'rm_level': actor.level}).fetchone() is not None


def participant(conn, room_id, pid):
    return conn.execute('SELECT * FROM room_participant WHERE room_id = ? AND principal_id = ?',
                        (room_id, pid)).fetchone()


def access_rows(conn, room_id):
    return {r['kind']: r for r in conn.execute('SELECT * FROM room_access WHERE room_id = ?', (room_id,))}


def signup_row(conn, room_id, pid):
    return conn.execute('SELECT * FROM room_signup WHERE room_id = ? AND principal_id = ?', (room_id, pid)).fetchone()


def load_room(conn, actor, room_id):
    """Detail and list use the same predicate, including removed participants."""
    sql, params = visible_sql(actor)
    room = conn.execute(f'SELECT * FROM room r WHERE r.id = :id AND {sql}',
                        {**params, 'id': room_id}).fetchone()
    if room is None:
        raise ApiError('resource_not_found')
    return room


def normalize_access(conn, actor, items):
    rows, invitees, seen = [('members', None, None)], [], {'members'}
    for item in items:
        kind = item['kind']
        if kind == 'members':
            continue
        if kind in seen:
            raise ApiError('validation_failed', '同一种进入条件只能选一次')
        seen.add(kind)
        if kind == 'level':
            if not item.get('min_level'):
                raise ApiError('validation_failed', '等级门槛要选一个等级')
            rows.append(('level', item['min_level'], None))
        elif kind == 'space':
            space_id = item.get('space_id')
            ok = space_id and conn.execute(
                "SELECT 1 FROM membership WHERE space_id = ? AND principal_id = ? AND state = 'active'",
                (space_id, actor.id)).fetchone()
            if not ok:
                raise ApiError('validation_failed', '只能选你所在的空间')
            rows.append(('space', None, space_id))
        elif kind == 'invite':
            ids = list(dict.fromkeys(item.get('principal_ids') or []))
            if not ids or len(ids) > policy(conn, 'invite.max'):
                raise ApiError('validation_failed', f"邀请名单要有 1 到 {policy(conn, 'invite.max')} 人")
            marks = ','.join('?' * len(ids))
            found = {r[0] for r in conn.execute(
                f"SELECT id FROM principal WHERE status = 'active' AND id IN ({marks})", ids)}
            if found != set(ids):
                raise ApiError('validation_failed', '邀请名单里有找不到的成员')
            invitees = ids
            rows.append(('invite', None, None))
        elif kind == 'signup':
            rows.append(('signup', None, None))
    return rows, invitees


def estimate(conn, rows, invitees):
    sql = ["SELECT count(*) FROM principal p JOIN profile pr ON pr.principal_id = p.id WHERE p.status = 'active'"
           " AND p.kind = 'human'"]
    params = []
    for kind, level, space_id in rows:
        if kind == 'level':
            sql.append('AND pr.level >= ?')
            params.append(level)
        elif kind == 'space':
            sql.append("AND EXISTS (SELECT 1 FROM membership m WHERE m.space_id = ? AND m.principal_id = p.id"
                       " AND m.state = 'active')")
            params.append(space_id)
        elif kind == 'invite':
            sql.append(f"AND p.id IN ({','.join('?' * len(invitees))})")
            params.extend(invitees)
    return conn.execute(' '.join(sql), params).fetchone()[0]


# ---------------------------------------------------------------- 谁能建

def abilities(conn, actor):
    out = []
    for kind in KINDS + LATER_KINDS:
        if kind in LATER_KINDS:
            out.append({'kind': kind, 'label': KIND_LABEL[kind], 'allowed': False, 'reason': 'step_two',
                        'need': None, 'duration_cap': None})
            continue
        r = rule(conn, f'rooms.create.{kind}')
        code = check(conn, actor, f'rooms.create.{kind}')
        out.append({'kind': kind, 'label': KIND_LABEL[kind], 'allowed': code is None, 'reason': code,
                    'need': {'level': r['min_level'], 'roles': sorted(r['roles'])},
                    'duration_cap': duration_cap(conn, actor) if code is None else None,
                    'capacity': policy(conn, f'capacity.{kind}')})
    return {'level': actor.level, 'roles': sorted(actor.roles), 'kinds': out,
            'link_hosts': [dict(r) for r in conn.execute('SELECT host, label FROM room_link_host ORDER BY host')]}


def create_room(conn, actor, body, request_id=None):
    kind = body['kind']
    if kind in LATER_KINDS:
        raise ApiError('capability_unavailable', '直播和工作坊是第二步，这一版还没开放')
    if kind not in KINDS:
        raise ApiError('validation_failed', '房间类型只能是讨论室或舞台')
    require(conn, actor, f'rooms.create.{kind}')
    cap = duration_cap(conn, actor)
    duration = body['duration_min']
    if duration < policy(conn, 'duration.min'):
        raise ApiError('validation_failed', f"单场至少 {policy(conn, 'duration.min')} 分钟")
    if duration > cap:
        raise ApiError('room_duration_cap', f'你现在单场最长 {cap} 分钟', cap=cap)
    starts = parse_time(body.get('starts_at'))
    now = clock.now_ts()
    if clock.parse(starts) < now - 300:
        raise ApiError('validation_failed', '开始时间不能早于现在')
    if clock.parse(starts) > now + policy(conn, 'schedule.max_days_ahead') * 86400:
        raise ApiError('validation_failed', f"最远只能约 {policy(conn, 'schedule.max_days_ahead')} 天以后")
    provider = body.get('provider') or 'livekit'
    url = host = None
    if provider == 'external_link':
        url, host, _ = check_link(conn, body.get('external_url'))
    elif body.get('external_url'):
        raise ApiError('validation_failed', '站内音视频不用填外部链接')
    rows, invitees = normalize_access(conn, actor, body.get('access') or [])
    agenda = body.get('agenda') or []
    if sum(i['minutes'] for i in agenda) > duration:
        raise ApiError('validation_failed', '议程加起来超过了本场时长')
    repeat = body.get('repeat_weekly') or 0
    if repeat == 1 or repeat > policy(conn, 'series.max_occurrences'):
        raise ApiError('validation_failed', f"每周例会一次排 2 到 {policy(conn, 'series.max_occurrences')} 场")
    title = body['title'].strip()
    if not title:
        raise ApiError('validation_failed', '标题不能为空')
    stamp = clock.now()
    series_id = None
    if repeat:
        series_id = new_id()
        conn.execute("INSERT INTO room_series (id, host_id, cadence, occurrences, created_at) "
                     "VALUES (?, ?, 'weekly', ?, ?)", (series_id, actor.id, repeat, stamp))
    ids = []
    for index in range(repeat or 1):
        room_id = new_id()
        ids.append(room_id)
        conn.execute(
            'INSERT INTO room (id, kind, title, summary, host_id, created_by, provider, external_url, external_host, '
            'starts_at, duration_min, state, self_unmute, capacity, series_id, series_index, created_at, updated_at) '
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)",
            (room_id, kind, title, body.get('summary', '').strip(), actor.id, actor.id, provider, url, host,
             plus_minutes(starts, index * 7 * 24 * 60), duration,
             int(kind == 'discussion' and bool(body.get('self_unmute'))), policy(conn, f'capacity.{kind}'),
             series_id, index + 1 if series_id else None, stamp, stamp))
        for akind, level, space_id in rows:
            conn.execute('INSERT INTO room_access (room_id, kind, min_level, space_id) VALUES (?, ?, ?, ?)',
                         (room_id, akind, level, space_id))
        for pid in invitees:
            conn.execute('INSERT INTO room_invite (room_id, principal_id, invited_by, invited_at) VALUES (?, ?, ?, ?)',
                         (room_id, pid, actor.id, stamp))
        for pos, item in enumerate(agenda, 1):
            conn.execute("INSERT INTO room_agenda_item (id, room_id, position, title, minutes, state) "
                         "VALUES (?, ?, ?, ?, ?, 'pending')", (new_id(), room_id, pos, item['title'].strip(),
                                                               item['minutes']))
        conn.execute("INSERT INTO room_recording (room_id, state, reason_code, updated_at) "
                     "VALUES (?, 'not_recorded', 'beta_no_recording', ?)", (room_id, stamp))
        conn.execute("INSERT INTO room_minutes (room_id, state, updated_at) VALUES (?, 'none', ?)", (room_id, stamp))
        outbox.emit(conn, 'rooms.room.created', 'room', room_id, {'kind': kind, 'provider': provider,
                                                                   'series_id': series_id},
                    actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'rooms.room.create', 'room', ids[0], request_id=request_id,
                 meta={'kind': kind, 'provider': provider, 'occurrences': len(ids),
                       'access': [r[0] for r in rows], 'series_id': series_id})
    return ids


# ---------------------------------------------------------------- 入场、授权、令牌

def present_count(conn, room_id, host_id=None):
    return conn.execute('SELECT count(*) FROM room_participant WHERE room_id = ? AND present = 1 '
                        'AND principal_id IS NOT ?', (room_id, host_id)).fetchone()[0]


def _start(conn, room):
    stamp = clock.now()
    conn.execute("UPDATE room SET state = 'live', started_at = ?, updated_at = ? WHERE id = ?",
                 (stamp, stamp, room['id']))
    first = conn.execute("SELECT id FROM room_agenda_item WHERE room_id = ? AND state = 'pending' "
                         'ORDER BY position LIMIT 1', (room['id'],)).fetchone()
    if first and not conn.execute("SELECT 1 FROM room_agenda_item WHERE room_id = ? AND state = 'current'",
                                  (room['id'],)).fetchone():
        conn.execute("UPDATE room_agenda_item SET state = 'current', started_at = ? WHERE id = ?", (stamp, first[0]))


def _check_open_time(conn, room):
    if clock.now_ts() < clock.parse(room['starts_at']) - policy(conn, 'open.early_min') * 60:
        raise ApiError('room_not_live', f"还没到开房时间（开始前 {policy(conn, 'open.early_min')} 分钟可以开）")


def _default_role(room, is_host):
    if is_host:
        return 'host'
    return 'speaker' if room['kind'] == 'discussion' and room['self_unmute'] else 'listener'


def can_publish(p):
    return p['role'] in ('host', 'speaker') and not p['muted']


def can_screen_share(conn, room_id, p):
    if p['role'] not in ('host', 'speaker') or not p['present'] or p['removed_at']:
        return False
    return conn.execute("SELECT 1 FROM room_screen_share WHERE room_id = ? AND principal_id = ? "
                        "AND state = 'active'", (room_id, p['principal_id'])).fetchone() is not None


def _revoke(conn, room_id, pid, reason):
    conn.execute('UPDATE join_grant SET revoked_at = ?, revoke_reason = ? WHERE room_id = ? AND principal_id = ? '
                 'AND revoked_at IS NULL', (clock.now(), reason, room_id, pid))


def ensure_grant(conn, room_id, p):
    pub = int(can_publish(p))
    screen = int(can_screen_share(conn, room_id, p))
    g = conn.execute('SELECT * FROM join_grant WHERE room_id = ? AND principal_id = ? AND revoked_at IS NULL '
                     'ORDER BY issued_at DESC LIMIT 1', (room_id, p['principal_id'])).fetchone()
    if (g and g['epoch'] == p['epoch'] and g['role'] == p['role'] and g['can_publish'] == pub
            and g['can_screen_share'] == screen):
        return g
    _revoke(conn, room_id, p['principal_id'], 'superseded')
    gid = new_id()
    conn.execute('INSERT INTO join_grant (id, room_id, principal_id, role, can_publish, can_screen_share, epoch, '
                 'issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                 (gid, room_id, p['principal_id'], p['role'], pub, screen, p['epoch'], clock.now()))
    return conn.execute('SELECT * FROM join_grant WHERE id = ?', (gid,)).fetchone()


def _admit(conn, room, actor_id, is_host):
    stamp = clock.now()
    p = participant(conn, room['id'], actor_id)
    role = _default_role(room, is_host)
    if p is None:
        conn.execute('INSERT INTO room_participant (room_id, principal_id, role, epoch, present, joined_at, updated_at) '
                     'VALUES (?, ?, ?, 1, 1, ?, ?)', (room['id'], actor_id, role, stamp, stamp))
    elif not p['present']:
        conn.execute('UPDATE room_participant SET present = 1, left_at = NULL, role = ?, epoch = epoch + 1, '
                     'updated_at = ? WHERE room_id = ? AND principal_id = ?', (role, stamp, room['id'], actor_id))
    elif is_host and p['role'] != 'host':
        conn.execute("UPDATE room_participant SET role = 'host', epoch = epoch + 1, updated_at = ? "
                     'WHERE room_id = ? AND principal_id = ?', (stamp, room['id'], actor_id))
    return participant(conn, room['id'], actor_id)


def join(conn, actor, room_id, media_ready):
    """进房；对已在场的人就是续发令牌。返回 ('waiting', room, None, None) 或 ('joined', room, p, grant)。"""
    require(conn, actor, 'rooms.join')
    room = load_room(conn, actor, room_id)
    if room['state'] == 'ended':
        raise ApiError('room_ended')
    is_host = room['host_id'] == actor.id
    if is_host:
        if room['state'] == 'scheduled':
            _check_open_time(conn, room)
    else:
        if 'signup' in access_rows(conn, room_id):
            s = signup_row(conn, room_id, actor.id)
            if s is not None and s['state'] == 'rejected':
                raise ApiError('room_signup_rejected')
            if s is None or s['state'] != 'approved':
                _signup(conn, room_id, actor.id, 'pending')
                return 'waiting', room, None, None
        if room['state'] != 'live':
            raise ApiError('room_not_live')
        p = participant(conn, room_id, actor.id)
        present = p is not None and p['present']
        if room['locked_at'] and not present:
            raise ApiError('room_locked')
        if not present and present_count(conn, room_id, room['host_id']) >= room['capacity']:
            raise ApiError('room_full')
    if room['provider'] == 'livekit' and not media_ready:
        raise ApiError('capability_unavailable', '站内音视频服务还没有接上')
    if is_host and room['state'] == 'scheduled':
        _start(conn, room)
        room = conn.execute('SELECT * FROM room WHERE id = ?', (room_id,)).fetchone()
    p = _admit(conn, room, actor.id, is_host)
    return 'joined', room, p, ensure_grant(conn, room_id, p)


def leave(conn, actor, room_id):
    room = load_room(conn, actor, room_id)
    p = participant(conn, room_id, actor.id)
    if p is None or not p['present']:
        return room
    stamp = clock.now()
    conn.execute('UPDATE room_participant SET present = 0, left_at = ?, updated_at = ? WHERE room_id = ? '
                 'AND principal_id = ?', (stamp, stamp, room_id, actor.id))
    _revoke(conn, room_id, actor.id, 'left')
    _end_screen_share(conn, room_id, actor.id, 'stopped', actor.id, 'left')
    conn.execute("UPDATE speak_queue SET state = 'withdrawn', decided_at = ? WHERE room_id = ? AND principal_id = ? "
                 "AND state IN ('raised', 'invited')", (stamp, room_id, actor.id))
    conn.execute("UPDATE speak_queue SET state = 'ended', decided_at = ? WHERE room_id = ? AND principal_id = ? "
                 "AND state = 'approved'", (stamp, room_id, actor.id))
    return room


def _signup(conn, room_id, pid, state, decided_by=None):
    stamp = clock.now()
    conn.execute('INSERT INTO room_signup (room_id, principal_id, state, created_at, decided_at, decided_by) '
                 'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (room_id, principal_id) DO UPDATE SET state = excluded.state, '
                 'decided_at = excluded.decided_at, decided_by = excluded.decided_by',
                 (room_id, pid, state, stamp, stamp if decided_by else None, decided_by))


def signup(conn, actor, room_id, withdraw=False):
    require(conn, actor, 'rooms.join')
    room = load_room(conn, actor, room_id)
    if room['state'] == 'ended':
        raise ApiError('room_ended')
    s = signup_row(conn, room_id, actor.id)
    if withdraw:
        if s is not None and s['state'] in ('pending', 'approved'):
            _signup(conn, room_id, actor.id, 'withdrawn')
        return 'withdrawn'
    if s is not None and s['state'] == 'rejected':
        raise ApiError('room_signup_rejected')
    if s is not None and s['state'] in ('pending', 'approved'):
        return s['state']
    state = 'pending' if 'signup' in access_rows(conn, room_id) and room['host_id'] != actor.id else 'approved'
    _signup(conn, room_id, actor.id, state)
    return state


def gate_check(conn, actor, claims, grant_id, epoch):
    """信令连接（首次和每次重连）都按此刻的数据库判断。返回 (拒绝原因, grant)。"""
    if not actor.authenticated or actor.status != 'active':
        return 'no_session', None
    if claims.get('sub') != actor.id:
        return 'identity_mismatch', None
    video = claims.get('video') if isinstance(claims.get('video'), dict) else {}
    room_id = video.get('room')
    if not isinstance(room_id, str) or not grant_id:
        return 'token_incomplete', None
    room = conn.execute('SELECT * FROM room WHERE id = ?', (room_id,)).fetchone()
    if room is None or room['provider'] != 'livekit':
        return 'room_unknown', None
    if room['state'] != 'live':
        return 'room_' + ('ended' if room['state'] == 'ended' else 'not_live'), None
    g = conn.execute('SELECT * FROM join_grant WHERE id = ?', (grant_id,)).fetchone()
    if g is None or g['room_id'] != room_id or g['principal_id'] != actor.id:
        return 'grant_unknown', None
    if g['revoked_at']:
        return 'grant_revoked', None
    p = participant(conn, room_id, actor.id)
    if p is None or p['removed_at']:
        return 'removed', None
    if not p['present']:
        return 'not_present', None
    if g['epoch'] != p['epoch'] or (epoch is not None and epoch != g['epoch']):
        return 'epoch_stale', None
    if video.get('canPublish') and not g['can_publish']:
        return 'publish_not_granted', None
    sources = video.get('canPublishSources') if isinstance(video.get('canPublishSources'), list) else []
    if any(s in ('screen_share', 'screen_share_audio') for s in sources) and not g['can_screen_share']:
        return 'screen_share_not_granted', None
    if room['host_id'] != actor.id:
        if not eligible(conn, actor, room_id):
            return 'not_eligible', None
        if 'signup' in access_rows(conn, room_id):
            s = signup_row(conn, room_id, actor.id)
            if s is None or s['state'] != 'approved':
                return 'signup_missing', None
    return None, g


# ---------------------------------------------------------------- 发言、主持人工具

def _set_role(conn, room_id, pid, role=None, muted=None):
    """改角色或静音：epoch 加一、旧授权吊销、在场的人立即拿新授权。返回给 LiveKit 的 effect。"""
    p = participant(conn, room_id, pid)
    role = p['role'] if role is None else role
    muted = p['muted'] if muted is None else int(muted)
    if role == 'listener':
        _end_screen_share(conn, room_id, pid, 'revoked', None, 'role_changed')
    conn.execute('UPDATE room_participant SET role = ?, muted = ?, epoch = epoch + 1, updated_at = ? '
                 'WHERE room_id = ? AND principal_id = ?', (role, muted, clock.now(), room_id, pid))
    _revoke(conn, room_id, pid, 'role_changed')
    p = participant(conn, room_id, pid)
    if not p['present']:
        return None
    g = ensure_grant(conn, room_id, p)
    return ('update', room_id, pid, p['role'], bool(g['can_publish']), bool(g['can_screen_share']),
            g['id'], g['epoch'])


def _refresh_grant(conn, room_id, pid, reason):
    p = participant(conn, room_id, pid)
    if p is None:
        return None
    conn.execute('UPDATE room_participant SET epoch = epoch + 1, updated_at = ? WHERE room_id = ? '
                 'AND principal_id = ?', (clock.now(), room_id, pid))
    _revoke(conn, room_id, pid, reason)
    p = participant(conn, room_id, pid)
    if not p['present']:
        return None
    g = ensure_grant(conn, room_id, p)
    return ('update', room_id, pid, p['role'], bool(g['can_publish']), bool(g['can_screen_share']),
            g['id'], g['epoch'])


def _end_screen_share(conn, room_id, pid, state='revoked', by=None, reason='host_stopped'):
    row = conn.execute("SELECT * FROM room_screen_share WHERE room_id = ? AND principal_id = ? AND state = 'active'",
                       (room_id, pid)).fetchone()
    if row is None:
        return False
    conn.execute('UPDATE room_screen_share SET state = ?, ended_at = ?, decided_by = coalesce(?, decided_by), '
                 'reason_code = ? WHERE id = ?', (state, clock.now(), by, reason, row['id']))
    return True


def _activate_screen_share(conn, room_id, pid, by, share_audio=True, reason='approved'):
    current = conn.execute("SELECT * FROM room_screen_share WHERE room_id = ? AND state = 'active'", (room_id,)).fetchone()
    effects = []
    if current and current['principal_id'] != pid:
        _end_screen_share(conn, room_id, current['principal_id'], 'revoked', by, 'taken_over')
        effects.append(_refresh_grant(conn, room_id, current['principal_id'], 'screen_share_revoked'))
    row = conn.execute("SELECT * FROM room_screen_share WHERE room_id = ? AND principal_id = ? "
                       "AND state = 'pending' ORDER BY requested_at DESC LIMIT 1", (room_id, pid)).fetchone()
    stamp = clock.now()
    if current and current['principal_id'] == pid:
        return [e for e in effects if e]
    if row:
        conn.execute("UPDATE room_screen_share SET state = 'active', share_audio = ?, decided_at = ?, decided_by = ?, "
                     "reason_code = ? WHERE id = ?", (int(share_audio), stamp, by, reason, row['id']))
    else:
        conn.execute("INSERT INTO room_screen_share (id, room_id, principal_id, state, share_audio, requested_at, "
                     "decided_at, decided_by, reason_code) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)",
                     (new_id(), room_id, pid, int(share_audio), stamp, stamp, by, reason))
    effects.append(_refresh_grant(conn, room_id, pid, 'screen_share_changed'))
    return [e for e in effects if e]


def screen_share(conn, actor, room_id, action, share_audio=True, request_id=None):
    room = load_room(conn, actor, room_id)
    if room['state'] != 'live':
        raise ApiError('room_not_live')
    p = _present(conn, room_id, actor.id)
    if p['role'] != 'speaker':
        raise ApiError('action_not_allowed', '只有发言人可以申请投屏')
    effects = []
    if action == 'request':
        active = conn.execute("SELECT 1 FROM room_screen_share WHERE room_id = ? AND principal_id = ? "
                              "AND state = 'active'", (room_id, actor.id)).fetchone()
        pending = conn.execute("SELECT 1 FROM room_screen_share WHERE room_id = ? AND principal_id = ? "
                               "AND state = 'pending'", (room_id, actor.id)).fetchone()
        if not active and not pending:
            conn.execute("INSERT INTO room_screen_share (id, room_id, principal_id, state, share_audio, requested_at) "
                         "VALUES (?, ?, ?, 'pending', ?, ?)",
                         (new_id(), room_id, actor.id, int(share_audio), clock.now()))
    elif action == 'stop':
        if not _end_screen_share(conn, room_id, actor.id, 'stopped', actor.id, 'self_stopped'):
            raise ApiError('state_conflict', '你现在没有在投屏')
        effects.append(_refresh_grant(conn, room_id, actor.id, 'screen_share_stopped'))
    audit.record(conn, actor.id, f'rooms.screen_share.{action}', 'room', room_id, request_id=request_id,
                 meta={'share_audio': bool(share_audio)})
    return [e for e in effects if e]


def _open_entry(conn, room_id, pid, states=OPEN_QUEUE):
    marks = ','.join('?' * len(states))
    return conn.execute(f'SELECT * FROM speak_queue WHERE room_id = ? AND principal_id = ? AND state IN ({marks})',
                        (room_id, pid, *states)).fetchone()


def _queue_entry(conn, room_id, pid, state):
    pos = conn.execute('SELECT coalesce(max(position), 0) + 1 FROM speak_queue WHERE room_id = ?',
                       (room_id,)).fetchone()[0]
    conn.execute('INSERT INTO speak_queue (id, room_id, principal_id, state, position, created_at) '
                 'VALUES (?, ?, ?, ?, ?, ?)', (new_id(), room_id, pid, state, pos, clock.now()))


def _decide(conn, entry_id, state, by=None):
    conn.execute('UPDATE speak_queue SET state = ?, decided_at = ?, decided_by = ? WHERE id = ?',
                 (state, clock.now(), by, entry_id))


def _present(conn, room_id, pid):
    p = participant(conn, room_id, pid)
    if p is None or not p['present'] or p['removed_at']:
        raise ApiError('state_conflict', '这个人现在不在房间里')
    return p


def hand(conn, actor, room_id, action):
    room = load_room(conn, actor, room_id)
    if room['state'] != 'live':
        raise ApiError('room_not_live')
    p = _present(conn, room_id, actor.id)
    effects = []
    if action == 'raise':
        require(conn, actor, 'rooms.raise_hand')
        if p['role'] != 'listener':
            raise ApiError('state_conflict', '你现在已经可以发言')
        if _open_entry(conn, room_id, actor.id) is None:
            _queue_entry(conn, room_id, actor.id, 'raised')
    elif action == 'lower':
        entry = _open_entry(conn, room_id, actor.id, ('raised',))
        if entry:
            _decide(conn, entry['id'], 'withdrawn')
    elif action in ('accept', 'decline'):
        entry = _open_entry(conn, room_id, actor.id, ('invited',))
        if entry is None:
            raise ApiError('state_conflict', '主持人没有邀请你发言')
        if action == 'accept':
            _decide(conn, entry['id'], 'approved')
            effects.append(_set_role(conn, room_id, actor.id, role='speaker'))
        else:
            _decide(conn, entry['id'], 'declined')
    return [e for e in effects if e]


HOST_ACTIONS = ('start', 'approve', 'reject', 'invite', 'down', 'mute', 'unmute', 'remove', 'lock', 'unlock',
                'transfer', 'end', 'extend', 'board', 'stage', 'agenda_next', 'signup_approve', 'signup_reject',
                'screen_approve', 'screen_reject', 'screen_takeover', 'screen_stop')
NEEDS_TARGET = ('approve', 'reject', 'invite', 'down', 'mute', 'unmute', 'remove', 'transfer', 'signup_approve',
                'signup_reject', 'screen_approve', 'screen_reject', 'screen_stop')


def host_action(conn, actor, room_id, body, request_id=None):
    action = body['action']
    room = load_room(conn, actor, room_id)
    require(conn, actor, 'rooms.moderate', {'author_id': room['host_id']})
    if room['state'] == 'ended':
        raise ApiError('room_ended')
    pid = body.get('principal_id')
    if action in NEEDS_TARGET and not pid:
        raise ApiError('validation_failed', '要指定成员')
    if pid == actor.id and action in ('remove', 'mute', 'down', 'transfer', 'invite'):
        raise ApiError('validation_failed', '不能对自己做这个操作')
    stamp = clock.now()
    effects = []
    if action == 'start':
        if room['state'] != 'scheduled':
            raise ApiError('state_conflict', '房间已经开始了')
        _check_open_time(conn, room)
        _start(conn, room)
    elif action in ('approve', 'reject'):
        entry = _open_entry(conn, room_id, pid, ('raised',))
        if entry is None:
            raise ApiError('state_conflict', '这个人没有在举手')
        _decide(conn, entry['id'], 'approved' if action == 'approve' else 'declined', actor.id)
        if action == 'approve':
            _present(conn, room_id, pid)
            effects.append(_set_role(conn, room_id, pid, role='speaker'))
    elif action == 'invite':
        p = _present(conn, room_id, pid)
        if p['role'] != 'listener':
            raise ApiError('state_conflict', '这个人已经可以发言')
        entry = _open_entry(conn, room_id, pid)
        if entry is not None and entry['state'] == 'raised':
            _decide(conn, entry['id'], 'approved', actor.id)
            effects.append(_set_role(conn, room_id, pid, role='speaker'))
        elif entry is None:
            _queue_entry(conn, room_id, pid, 'invited')
    elif action == 'down':
        p = _present(conn, room_id, pid)
        if p['role'] != 'speaker':
            raise ApiError('state_conflict', '这个人现在不是发言人')
        entry = _open_entry(conn, room_id, pid, ('approved',))
        if entry:
            _decide(conn, entry['id'], 'ended', actor.id)
        effects.append(_set_role(conn, room_id, pid, role='listener'))
    elif action in ('mute', 'unmute'):
        p = _present(conn, room_id, pid)
        if p['role'] == 'host':
            raise ApiError('validation_failed', '不能静音主持人')
        want = action == 'mute'
        if bool(p['muted']) != want:
            effects.append(_set_role(conn, room_id, pid, muted=want))
    elif action == 'remove':
        p = participant(conn, room_id, pid)
        if p is None or p['removed_at']:
            raise ApiError('state_conflict', '这个人不在房间里')
        reason = body.get('reason_code') or 'host_decision'
        conn.execute('UPDATE room_participant SET present = 0, left_at = coalesce(left_at, ?), removed_at = ?, '
                     'removed_by = ?, removed_reason = ?, epoch = epoch + 1, updated_at = ? '
                     'WHERE room_id = ? AND principal_id = ?', (stamp, stamp, actor.id, reason, stamp, room_id, pid))
        _revoke(conn, room_id, pid, 'removed')
        _end_screen_share(conn, room_id, pid, 'revoked', actor.id, 'removed')
        conn.execute("UPDATE speak_queue SET state = 'ended', decided_at = ?, decided_by = ? WHERE room_id = ? "
                     "AND principal_id = ? AND state IN ('raised', 'invited', 'approved')",
                     (stamp, actor.id, room_id, pid))
        outbox.emit(conn, 'rooms.participant.removed', 'room', room_id, {'principal_id': pid, 'reason': reason},
                    actor_id=actor.id, request_id=request_id)
        if room['provider'] == 'livekit':
            effects.append(('remove', room_id, pid))
    elif action in ('lock', 'unlock'):
        conn.execute('UPDATE room SET locked_at = ?, updated_at = ? WHERE id = ?',
                     (stamp if action == 'lock' else None, stamp, room_id))
        outbox.emit(conn, f'rooms.room.{action}ed', 'room', room_id, {}, actor_id=actor.id, request_id=request_id)
    elif action == 'transfer':
        _present(conn, room_id, pid)
        conn.execute('UPDATE room SET host_id = ?, updated_at = ? WHERE id = ?', (pid, stamp, room_id))
        effects.append(_set_role(conn, room_id, pid, role='host', muted=False))
        if participant(conn, room_id, actor.id) is not None:
            effects.append(_set_role(conn, room_id, actor.id, role='speaker'))
        outbox.emit(conn, 'rooms.room.host_transferred', 'room', room_id, {'from': actor.id, 'to': pid},
                    actor_id=actor.id, request_id=request_id)
    elif action == 'end':
        end_room(conn, room, actor.id, request_id)
        if room['provider'] == 'livekit':
            effects.append(('delete_room', room_id))
    elif action == 'extend':
        minutes = body.get('minutes')
        if not minutes:
            raise ApiError('validation_failed', '要写延长几分钟')
        if room['extensions'] >= policy(conn, 'extend.max_times'):
            raise ApiError('state_conflict', '这一场已经延长过了')
        cap = duration_cap(conn, actor)
        if room['duration_min'] + room['extended_min'] + minutes > cap:
            raise ApiError('room_duration_cap', f'延长后会超过你的单场上限 {cap} 分钟', cap=cap)
        conn.execute('UPDATE room SET extended_min = extended_min + ?, extensions = extensions + 1, updated_at = ? '
                     'WHERE id = ?', (minutes, stamp, room_id))
        conn.execute("DELETE FROM room_reminder WHERE room_id = ? AND kind = 'overtime_soon'", (room_id,))
    elif action == 'board':
        if not body.get('mode'):
            raise ApiError('validation_failed', '要选谁能画')
        conn.execute('UPDATE room SET board_mode = ?, updated_at = ? WHERE id = ?', (body['mode'], stamp, room_id))
    elif action == 'stage':
        if body.get('surface') not in ('screen', 'board'):
            raise ApiError('validation_failed', '要选投屏或白板')
        conn.execute('UPDATE room SET stage_mode = ?, updated_at = ? WHERE id = ?',
                     (body['surface'], stamp, room_id))
    elif action in ('screen_approve', 'screen_reject'):
        p = _present(conn, room_id, pid)
        if p['role'] != 'speaker':
            raise ApiError('state_conflict', '只有发言人可以投屏')
        req = conn.execute("SELECT * FROM room_screen_share WHERE room_id = ? AND principal_id = ? "
                           "AND state = 'pending' ORDER BY requested_at DESC LIMIT 1", (room_id, pid)).fetchone()
        if req is None:
            raise ApiError('state_conflict', '这个人没有申请投屏')
        if action == 'screen_approve':
            effects.extend(_activate_screen_share(conn, room_id, pid, actor.id, bool(req['share_audio'])))
        else:
            conn.execute("UPDATE room_screen_share SET state = 'rejected', decided_at = ?, decided_by = ?, "
                         "reason_code = 'host_rejected' WHERE id = ?", (stamp, actor.id, req['id']))
    elif action == 'screen_takeover':
        effects.extend(_activate_screen_share(
            conn, room_id, actor.id, actor.id,
            True if body.get('share_audio') is None else bool(body['share_audio']), 'host_takeover'))
    elif action == 'screen_stop':
        if not _end_screen_share(conn, room_id, pid, 'revoked', actor.id, 'host_stopped'):
            raise ApiError('state_conflict', '这个人现在没有在投屏')
        effects.append(_refresh_grant(conn, room_id, pid, 'screen_share_stopped'))
    elif action == 'agenda_next':
        cur = conn.execute("SELECT id FROM room_agenda_item WHERE room_id = ? AND state = 'current'",
                           (room_id,)).fetchone()
        if cur:
            conn.execute("UPDATE room_agenda_item SET state = 'done' WHERE id = ?", (cur[0],))
        nxt = conn.execute("SELECT id FROM room_agenda_item WHERE room_id = ? AND state = 'pending' "
                           'ORDER BY position LIMIT 1', (room_id,)).fetchone()
        if nxt:
            conn.execute("UPDATE room_agenda_item SET state = 'current', started_at = ? WHERE id = ?", (stamp, nxt[0]))
    elif action in ('signup_approve', 'signup_reject'):
        s = signup_row(conn, room_id, pid)
        if s is None or s['state'] == 'withdrawn':
            raise ApiError('state_conflict', '这个人没有报名')
        _signup(conn, room_id, pid, 'approved' if action == 'signup_approve' else 'rejected', actor.id)
    meta = {k: body[k] for k in ('principal_id', 'minutes', 'mode', 'surface', 'share_audio')
            if body.get(k) is not None}
    audit.record(conn, actor.id, f'rooms.host.{action}', 'room', room_id, reason=body.get('reason_code'),
                 request_id=request_id, meta=meta)
    return [e for e in effects if e]


def end_room(conn, room, actor_id, request_id=None):
    stamp = clock.now()
    room_id = room['id']
    conn.execute("UPDATE room SET state = 'ended', ended_at = ?, updated_at = ? WHERE id = ?", (stamp, stamp, room_id))
    conn.execute('UPDATE room_participant SET present = 0, left_at = coalesce(left_at, ?), updated_at = ? '
                 'WHERE room_id = ? AND present = 1', (stamp, stamp, room_id))
    conn.execute('UPDATE join_grant SET revoked_at = ?, revoke_reason = ? WHERE room_id = ? AND revoked_at IS NULL',
                 (stamp, 'ended', room_id))
    conn.execute("UPDATE speak_queue SET state = 'ended', decided_at = ? WHERE room_id = ? "
                 "AND state IN ('raised', 'invited', 'approved')", (stamp, room_id))
    conn.execute("UPDATE room_screen_share SET state = 'revoked', ended_at = ?, reason_code = 'room_ended' "
                 "WHERE room_id = ? AND state IN ('pending', 'active')", (stamp, room_id))
    conn.execute("UPDATE room_agenda_item SET state = 'done' WHERE room_id = ? AND state = 'current'", (room_id,))
    outbox.emit(conn, 'rooms.room.ended', 'room', room_id, {'kind': room['kind']}, actor_id=actor_id,
                request_id=request_id)


# ---------------------------------------------------------------- 议程、材料、白板附件

def _host_only(conn, actor, room):
    require(conn, actor, 'rooms.moderate', {'author_id': room['host_id']})


def set_agenda(conn, actor, room_id, items):
    room = load_room(conn, actor, room_id)
    _host_only(conn, actor, room)
    if room['state'] == 'ended':
        raise ApiError('room_ended')
    if sum(i['minutes'] for i in items) > room['duration_min'] + room['extended_min']:
        raise ApiError('validation_failed', '议程加起来超过了本场时长')
    conn.execute('DELETE FROM room_agenda_item WHERE room_id = ?', (room_id,))
    for pos, item in enumerate(items, 1):
        state = 'current' if pos == 1 and room['state'] == 'live' else 'pending'
        conn.execute('INSERT INTO room_agenda_item (id, room_id, position, title, minutes, state, started_at) '
                     'VALUES (?, ?, ?, ?, ?, ?, ?)', (new_id(), room_id, pos, item['title'].strip(), item['minutes'],
                                                      state, clock.now() if state == 'current' else None))
    audit.record(conn, actor.id, 'rooms.agenda.set', 'room', room_id, meta={'items': len(items)})


def add_material(conn, actor, room_id, body):
    room = load_room(conn, actor, room_id)
    _host_only(conn, actor, room)
    mid = new_id()
    if body['kind'] == 'object':
        from app.objects import load_visible
        obj = load_visible(conn, actor, body.get('object_id') or '')
        conn.execute("INSERT INTO room_material (id, room_id, kind, object_id, added_by, added_at) "
                     "VALUES (?, ?, 'object', ?, ?, ?)", (mid, room_id, obj['id'], actor.id, clock.now()))
    else:
        title = (body.get('title') or '').strip()
        if not title:
            raise ApiError('validation_failed', '链接要写个标题')
        conn.execute("INSERT INTO room_material (id, room_id, kind, url, title, added_by, added_at) "
                     "VALUES (?, ?, 'link', ?, ?, ?, ?)", (mid, room_id, check_file_link(body.get('url')), title,
                                                          actor.id, clock.now()))
    audit.record(conn, actor.id, 'rooms.material.add', 'room', room_id, meta={'material_id': mid,
                                                                             'kind': body['kind']})
    return mid


def add_board(conn, actor, room_id, storage_key, title):
    room = load_room(conn, actor, room_id)
    _host_only(conn, actor, room)
    mid = new_id()
    conn.execute("INSERT INTO room_material (id, room_id, kind, storage_key, title, added_by, added_at) "
                 "VALUES (?, ?, 'board', ?, ?, ?, ?)", (mid, room_id, storage_key, title, actor.id, clock.now()))
    audit.record(conn, actor.id, 'rooms.board.save', 'room', room_id, meta={'material_id': mid})
    return mid


def materials(conn, actor, room_id):
    pred = visible_predicate(actor, 'h')
    out = []
    rows = conn.execute(
        f"SELECT m.*, v.title AS object_title, h.type AS object_type FROM room_material m "
        f"LEFT JOIN object_head h ON h.id = m.object_id AND {pred.sql} "
        f"LEFT JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version "
        f"WHERE m.room_id = :room ORDER BY m.added_at, m.id", {'room': room_id, **pred.params}).fetchall()
    for r in rows:
        if r['kind'] == 'object':
            if r['object_title'] is None:
                continue
            out.append({'id': r['id'], 'kind': 'object', 'object_id': r['object_id'], 'type': r['object_type'],
                        'title': r['object_title']})
        elif r['kind'] == 'link':
            out.append({'id': r['id'], 'kind': 'link', 'url': r['url'], 'title': r['title']})
        else:
            out.append({'id': r['id'], 'kind': 'board', 'title': r['title'], 'added_at': r['added_at']})
    return out


# ---------------------------------------------------------------- 录制同意（第二步；开关关着时路由直接 501）

def recording_machine(conn, room):
    rec = conn.execute('SELECT * FROM room_recording WHERE room_id = ?', (room['id'],)).fetchone()
    m = consent.Recording(host_id=room['host_id'], state=rec['state'], version=rec['consent_version'])
    m.publishers = {r[0] for r in conn.execute(
        "SELECT principal_id FROM room_participant WHERE room_id = ? AND present = 1 AND role IN ('host', 'speaker')",
        (room['id'],))}
    screen = conn.execute("SELECT principal_id FROM room_screen_share WHERE room_id = ? AND state = 'active'",
                          (room['id'],)).fetchone()
    if screen:
        m.require_track(screen['principal_id'], 'screen_track')
        m.require_track(screen['principal_id'], 'screen_share_audio')
    for r in conn.execute('SELECT * FROM room_recording_consent WHERE room_id = ? AND consent_version = ?',
                          (room['id'], rec['consent_version'])):
        m.consents[r['principal_id']] = r['state']
        if r['state'] == 'withdrawn':
            m.excluded.add(r['principal_id'])
    for r in conn.execute('SELECT * FROM room_recording_track_consent WHERE room_id = ? AND consent_version = ?',
                          (room['id'], rec['consent_version'])):
        key = (r['principal_id'], r['track_kind'])
        m.track_consents[key] = r['state']
        if r['state'] == 'withdrawn':
            m.excluded_tracks.add(key)
    m.settle()
    return m


def save_machine(conn, room_id, m, changed=None, changed_tracks=()):
    stamp = clock.now()
    conn.execute('UPDATE room_recording SET state = ?, consent_version = ?, reason_code = NULL, updated_at = ? '
                 'WHERE room_id = ?', (m.state, m.version, stamp, room_id))
    for pid in ([changed] if changed else []):
        conn.execute('INSERT INTO room_recording_consent (room_id, principal_id, consent_version, state, '
                     'track_recorded, decided_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (room_id, principal_id) '
                     'DO UPDATE SET consent_version = excluded.consent_version, state = excluded.state, '
                     'track_recorded = excluded.track_recorded, decided_at = excluded.decided_at',
                     (room_id, pid, m.version, m.consents[pid], int(pid in m.recorded_tracks()), stamp))
    for pid, kind in changed_tracks:
        state = m.track_consents[(pid, kind)]
        conn.execute('INSERT INTO room_recording_track_consent (room_id, principal_id, consent_version, '
                     'track_kind, state, track_recorded, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?) '
                     'ON CONFLICT (room_id, principal_id, track_kind) DO UPDATE SET '
                     'consent_version = excluded.consent_version, state = excluded.state, '
                     'track_recorded = excluded.track_recorded, decided_at = excluded.decided_at',
                     (room_id, pid, m.version, kind, state,
                      int((pid, kind) in m.recorded_media_tracks()), stamp))


# ---------------------------------------------------------------- 视图

def _people(conn, ids):
    if not ids:
        return {}
    marks = ','.join('?' * len(ids))
    return {r[0]: {'id': r[0], 'name': r[1], 'level': r[2]} for r in conn.execute(
        f'SELECT principal_id, display_name, level FROM profile WHERE principal_id IN ({marks})', list(ids))}


def _person(people, pid):
    return people.get(pid) or {'id': pid, 'name': '成员', 'level': 1}


def access_view(conn, room_id):
    out = []
    for kind, r in access_rows(conn, room_id).items():
        item = {'kind': kind}
        if kind == 'level':
            item['min_level'] = r['min_level']
        elif kind == 'space':
            sp = conn.execute('SELECT id, name FROM space WHERE id = ?', (r['space_id'],)).fetchone()
            item['space'] = {'id': sp['id'], 'name': sp['name']} if sp else None
        elif kind == 'invite':
            item['count'] = conn.execute('SELECT count(*) FROM room_invite WHERE room_id = ?', (room_id,)).fetchone()[0]
        out.append(item)
    order = ('members', 'level', 'space', 'invite', 'signup')
    return sorted(out, key=lambda i: order.index(i['kind']))


def summary(conn, actor, room):
    rid = room['id']
    speakers = conn.execute("SELECT principal_id, role, muted FROM room_participant WHERE room_id = ? AND present = 1 "
                            "AND role IN ('host', 'speaker') ORDER BY role = 'host' DESC, joined_at LIMIT 8",
                            (rid,)).fetchall()
    people = _people(conn, {room['host_id'], *(s[0] for s in speakers)})
    s = signup_row(conn, rid, actor.id)
    access = access_rows(conn, rid)
    return {
        'id': rid, 'kind': room['kind'], 'title': room['title'], 'summary': room['summary'],
        'host': _person(people, room['host_id']), 'provider': room['provider'],
        'external_label': room['external_host'] and conn.execute(
            'SELECT label FROM room_link_host WHERE host = ?', (room['external_host'],)).fetchone()[0],
        'state': room['state'], 'starts_at': room['starts_at'], 'ends_at': ends_at(room),
        'duration_min': room['duration_min'] + room['extended_min'], 'started_at': room['started_at'],
        'ended_at': room['ended_at'], 'locked': bool(room['locked_at']),
        'present_count': present_count(conn, rid), 'capacity': room['capacity'],
        'speakers': [dict(_person(people, sp[0]), role=sp[1], muted=bool(sp[2])) for sp in speakers],
        'signup_required': 'signup' in access, 'my_signup': s['state'] if s else None,
        'series': {'id': room['series_id'], 'index': room['series_index']} if room['series_id'] else None,
        'is_host': room['host_id'] == actor.id,
    }


def detail(conn, actor, room):
    rid = room['id']
    data = summary(conn, actor, room)
    is_host = data['is_host']
    me = participant(conn, rid, actor.id)
    rows = conn.execute('SELECT principal_id, role, muted, joined_at FROM room_participant WHERE room_id = ? '
                        "AND present = 1 ORDER BY role = 'host' DESC, role = 'speaker' DESC, joined_at",
                        (rid,)).fetchall()
    listeners = [r for r in rows if r['role'] == 'listener']
    shown = rows if is_host else [r for r in rows if r['role'] != 'listener'] + listeners[:30]
    queue_rows = conn.execute("SELECT * FROM speak_queue WHERE room_id = ? AND state IN ('raised', 'invited') "
                              'ORDER BY position', (rid,)).fetchall()
    screen_active = conn.execute("SELECT * FROM room_screen_share WHERE room_id = ? AND state = 'active'",
                                 (rid,)).fetchone()
    screen_pending = conn.execute("SELECT * FROM room_screen_share WHERE room_id = ? AND state = 'pending' "
                                  'ORDER BY requested_at, id', (rid,)).fetchall()
    signups = conn.execute("SELECT principal_id, state FROM room_signup WHERE room_id = ? AND state = 'pending' "
                           'ORDER BY created_at', (rid,)).fetchall() if is_host else []
    screen_ids = ({screen_active['principal_id']} if screen_active else set()) | {
        x['principal_id'] for x in screen_pending}
    people = _people(conn, {r['principal_id'] for r in shown} | {q['principal_id'] for q in queue_rows}
                     | {s['principal_id'] for s in signups} | screen_ids)
    mine = [q for q in queue_rows if q['principal_id'] == actor.id]
    rec = conn.execute('SELECT state, reason_code, screen_track_json, audio_tracks_json, talk_id '
                       'FROM room_recording WHERE room_id = ?', (rid,)).fetchone()
    minutes = conn.execute('SELECT state FROM room_minutes WHERE room_id = ?', (rid,)).fetchone()
    signup_state = data['my_signup']
    admitted = is_host or not data['signup_required'] or signup_state == 'approved'
    present = bool(me and me['present'])
    end_ts = clock.parse(data['ends_at'])
    now = clock.now_ts()
    cap = duration_cap(conn, actor) if is_host else None
    data.update({
        'access': access_view(conn, rid),
        'self_unmute': bool(room['self_unmute']),
        'board_mode': room['board_mode'],
        'stage_mode': room['stage_mode'],
        'participants': [dict(_person(people, r['principal_id']), role=r['role'], muted=bool(r['muted']))
                         for r in shown],
        'listener_count': len(listeners),
        'queue': [{'principal': _person(people, q['principal_id']), 'state': q['state'], 'position': q['position']}
                  for q in (queue_rows if is_host else mine)],
        'raised_count': sum(1 for q in queue_rows if q['state'] == 'raised'),
        'signups': [_person(people, s['principal_id']) for s in signups],
        'agenda': [dict(r) for r in conn.execute(
            'SELECT id, position, title, minutes, state, started_at FROM room_agenda_item WHERE room_id = ? '
            'ORDER BY position', (rid,))],
        'materials': materials(conn, actor, rid),
        'me': {'role': me['role'] if me else None, 'present': present, 'muted': bool(me and me['muted']),
               'epoch': me['epoch'] if me else None, 'hand': mine[0]['state'] if mine else None,
               'signup': signup_state, 'admitted': admitted, 'is_host': is_host},
        'external': ({'url': room['external_url'], 'label': data['external_label']}
                     if room['provider'] == 'external_link' and admitted and room['state'] != 'ended' else None),
        'screen_share': {
            'active': (dict(principal=_person(people, screen_active['principal_id']),
                            share_audio=bool(screen_active['share_audio']), started_at=screen_active['decided_at'])
                       if screen_active else None),
            'requests': ([dict(principal=_person(people, x['principal_id']),
                               share_audio=bool(x['share_audio']), requested_at=x['requested_at'])
                          for x in screen_pending] if is_host else []),
            'mine': ('active' if screen_active and screen_active['principal_id'] == actor.id else
                     'pending' if any(x['principal_id'] == actor.id for x in screen_pending) else 'none'),
        },
        'recording': {'state': rec['state'], 'reason_code': rec['reason_code'],
                      'screen_track': json.loads(rec['screen_track_json']),
                      'audio_tracks': json.loads(rec['audio_tracks_json']), 'talk_id': rec['talk_id'],
                      'replay_draft': {'schema': 'commons.talk.review/1', 'gateway': 'AI-1', 'enabled': False}},
        'minutes': {'state': minutes['state']},
        'policy': {'duration_cap': cap,
                   'can_extend': bool(is_host and room['state'] != 'ended'
                                      and room['extensions'] < policy(conn, 'extend.max_times')
                                      and cap and cap > room['duration_min'] + room['extended_min']),
                   'extend_left_min': max(0, (cap or 0) - room['duration_min'] - room['extended_min']) if is_host else 0},
        'reminders': {
            'starts_in_min': (max(0, int((clock.parse(room['starts_at']) - now) // 60))
                              if room['state'] == 'scheduled'
                              and clock.parse(room['starts_at']) - now <= policy(conn, 'remind.before_start_min') * 60
                              else None),
            'ends_in_min': (max(0, int((end_ts - now) // 60))
                            if is_host and room['state'] == 'live'
                            and end_ts - now <= policy(conn, 'remind.before_end_min') * 60 else None),
        },
    })
    return data


# ---------------------------------------------------------------- 给 Agent 工具供数（AGENT-1 providers 的 rooms.upcoming）

def upcoming(conn, actor, hours, limit):
    """主人能进、hours 小时内开始的房间。功能开关关着时返回空；只给标题和时间，不给外部会议链接。"""
    if not flags.enabled(conn, FLAG):
        return []
    sql, params = visible_sql(actor)
    now = clock.now_ts()
    params.update(lo=clock.iso(now - 300), hi=clock.iso(now + max(1, min(int(hours), 24 * 14)) * 3600),
                  lim=max(1, min(int(limit), 50)))
    rows = conn.execute(f"SELECT r.* FROM room r WHERE r.state = 'scheduled' AND r.starts_at BETWEEN :lo AND :hi "
                        f'AND {sql} ORDER BY r.starts_at, r.id LIMIT :lim', params).fetchall()
    out = []
    for r in rows:
        access = access_rows(conn, r['id'])
        out.append({'id': r['id'], 'kind': 'room', 'title': r['title'], 'excerpt': (r['summary'] or '')[:140],
                    'author_id': r['host_id'], 'public': False, 'at': r['starts_at'], 'url': f"#/room/{r['id']}",
                    'meta': {'room_kind': r['kind'], 'duration_min': r['duration_min'] + r['extended_min'],
                             'signup_required': 'signup' in access, 'external': r['provider'] == 'external_link'}})
    return out


# ---------------------------------------------------------------- 提醒（给 worker 定时调用；见 shared-requests）

def remind_due(conn):
    now = clock.now_ts()
    sent = []
    before_start = policy(conn, 'remind.before_start_min') * 60
    before_end = policy(conn, 'remind.before_end_min') * 60
    for room in conn.execute("SELECT * FROM room WHERE state IN ('scheduled', 'live')").fetchall():
        if room['state'] == 'scheduled':
            kind, due = 'starts_soon', clock.parse(room['starts_at'])
            window = before_start
        else:
            kind, due = 'overtime_soon', clock.parse(ends_at(room))
            window = before_end
        if not (due - window <= now < due):
            continue
        if conn.execute('SELECT 1 FROM room_reminder WHERE room_id = ? AND kind = ?', (room['id'], kind)).fetchone():
            continue
        conn.execute('INSERT INTO room_reminder (room_id, kind, sent_at) VALUES (?, ?, ?)',
                     (room['id'], kind, clock.now()))
        outbox.emit(conn, f'rooms.reminder.{kind}', 'room', room['id'],
                    {'host_id': room['host_id'], 'due_at': clock.iso(due)})
        sent.append((room['id'], kind))
    return sent


# ---------------------------------------------------------------- 导出

def export(conn, actor):
    pid = actor.id
    return {
        'hosted': [dict(r) for r in conn.execute(
            'SELECT id, kind, title, starts_at, duration_min, state FROM room WHERE created_by = ? ORDER BY created_at',
            (pid,))],
        'participation': [dict(r) for r in conn.execute(
            'SELECT room_id, role, joined_at, left_at, removed_at, removed_reason FROM room_participant '
            'WHERE principal_id = ? ORDER BY joined_at', (pid,))],
        'signups': [dict(r) for r in conn.execute(
            'SELECT room_id, state, created_at, decided_at FROM room_signup WHERE principal_id = ?', (pid,))],
        'hands': [dict(r) for r in conn.execute(
            'SELECT room_id, state, created_at, decided_at FROM speak_queue WHERE principal_id = ?', (pid,))],
        'recording_consents': [dict(r) for r in conn.execute(
            'SELECT room_id, consent_version, state, decided_at FROM room_recording_consent WHERE principal_id = ?',
            (pid,))],
        'track_consents': [dict(r) for r in conn.execute(
            'SELECT room_id, consent_version, track_kind, state, track_recorded, decided_at '
            'FROM room_recording_track_consent WHERE principal_id = ?', (pid,))],
        'screen_shares': [dict(r) for r in conn.execute(
            'SELECT room_id, state, share_audio, requested_at, ended_at, reason_code '
            'FROM room_screen_share WHERE principal_id = ?', (pid,))],
        'chat': [dict(r) for r in conn.execute(
            'SELECT room_id, body, created_at, deleted_at FROM room_message WHERE author_id = ? ORDER BY seq',
            (pid,))],
    }


def can_create_any(conn, actor):
    return any(can(conn, actor, f'rooms.create.{k}') for k in KINDS)


def json_size(doc):
    return len(json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode())


# ---------------------------------------------------------------- 文字讨论

CHAT_MAX = 200
CHAT_PAGE = 50


def _chat_item(row, people):
    return {'id': row['id'], 'seq': row['seq'], 'text': row['body'], 'at': row['created_at'],
            'author': _person(people, row['author_id'])}


def chat_messages(conn, actor, room_id, before=None):
    """最近 50 条（旧到新）。在场过且没被移出的人、房主能看；before 是 seq，往前翻页。"""
    room = load_room(conn, actor, room_id)
    p = participant(conn, room_id, actor.id)
    if actor.id != room['host_id'] and (p is None or p['removed_at']):
        raise ApiError('action_not_allowed')
    params = [room_id]
    sql = 'SELECT * FROM room_message WHERE room_id = ? AND deleted_at IS NULL'
    if before is not None:
        sql += ' AND seq < ?'
        params.append(int(before))
    rows = conn.execute(sql + ' ORDER BY seq DESC LIMIT ?', [*params, CHAT_PAGE + 1]).fetchall()
    more = len(rows) > CHAT_PAGE
    rows = list(reversed(rows[:CHAT_PAGE]))
    people = _people(conn, {r['author_id'] for r in rows})
    return {'items': [_chat_item(r, people) for r in rows], 'more': more, 'state': room['state']}


def post_chat(conn, actor, room_id, text, request_id=None):
    room = load_room(conn, actor, room_id)
    require(conn, actor, 'rooms.chat')
    if room['state'] == 'ended':
        raise ApiError('room_ended')
    if room['state'] != 'live':
        raise ApiError('room_not_live')
    _present(conn, room_id, actor.id)
    text = (text or '').strip()
    if not text or len(text) > CHAT_MAX:
        raise ApiError('validation_failed', f'文字要在 1 到 {CHAT_MAX} 字之间')
    mid = new_id()
    cur = conn.execute('INSERT INTO room_message (id, room_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
                       (mid, room_id, actor.id, text, clock.now()))
    row = conn.execute('SELECT * FROM room_message WHERE seq = ?', (cur.lastrowid,)).fetchone()
    return _chat_item(row, _people(conn, {actor.id}))


def delete_chat(conn, actor, room_id, message_id, request_id=None):
    """作者撤回自己的，或主持人删任何一条。"""
    room = load_room(conn, actor, room_id)
    row = conn.execute('SELECT * FROM room_message WHERE id = ? AND room_id = ?', (message_id, room_id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['author_id'] != actor.id and actor.id != room['host_id']:
        raise ApiError('action_not_allowed')
    if row['deleted_at'] is None:
        conn.execute('UPDATE room_message SET deleted_at = ?, deleted_by = ? WHERE id = ?',
                     (clock.now(), actor.id, message_id))
        audit.record(conn, actor.id, 'rooms.chat_delete', 'room', room_id, request_id=request_id,
                     meta={'message_id': message_id, 'by_host': row['author_id'] != actor.id})
    return {'id': message_id, 'deleted': True}
