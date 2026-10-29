"""成员邀请：额度、一次性链接、竹子回报、封禁作废、邀请树互惠异常。

回报只走 ECON 的竹子。不写贡献账本，不改等级。
"""
import uuid
from datetime import datetime, timezone

from app import accounts, audit, clock, outbox, security
from app.errors import ApiError

DAY = 86400
ECON_DAILY_FALLBACK = 300
POLICY_KEYS = frozenset({
    'member_bonus', 'ttl_days', 'note_max', 'reward_onboarding', 'reward_first',
    'reward_monthly_extra', 'inactive_days',
})
POLICY_RANGE = {
    'member_bonus': (0, 100),
    'ttl_days': (1, 30),
    'note_max': (1, 200),
    'reward_onboarding': (0, 10000),
    'reward_first': (0, 10000),
    'reward_monthly_extra': (0, 1_000_000),
    'inactive_days': (1, 90),
}


def _id():
    return str(uuid.uuid4())


def _table(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def policy(conn, key):
    row = conn.execute('SELECT value FROM invite_policy WHERE key = ?', (key,)).fetchone()
    if row is None:
        raise ApiError('capability_unavailable', '邀请规则还没有装上')
    return int(row['value'])


def month_key(ts=None):
    moment = datetime.fromtimestamp(clock.now_ts() if ts is None else ts, timezone.utc)
    return f'{moment.year:04d}-{moment.month:02d}'


def previous_month_key(ts=None):
    moment = datetime.fromtimestamp(clock.now_ts() if ts is None else ts, timezone.utc)
    year, month = moment.year, moment.month - 1
    if month == 0:
        year, month = year - 1, 12
    return f'{year:04d}-{month:02d}'


def month_bounds(key):
    year, month = (int(part) for part in key.split('-'))
    start = datetime(year, month, 1, tzinfo=timezone.utc).timestamp()
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc).timestamp()
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc).timestamp()
    return clock.iso(start), clock.iso(end)


def level_quota(conn, level):
    row = conn.execute('SELECT monthly_quota FROM invite_quota_rule WHERE level = ?', (int(level),)).fetchone()
    return int(row['monthly_quota']) if row else 0


def is_member(conn, principal_id):
    """付费会员：试用、生效，或已取消但这一期还没结束。候补不算。"""
    try:
        from modules.billing import service as billing
    except ImportError:
        return False
    if not billing.ready(conn):
        return False
    return billing.current(conn, principal_id) is not None


def _profile(conn, principal_id):
    return conn.execute(
        'SELECT p.status, pr.display_name, pr.level FROM principal p '
        'JOIN profile pr ON pr.principal_id = p.id WHERE p.id = ?', (principal_id,)).fetchone()


def last_active(conn, principal_id):
    stamps = []
    row = conn.execute('SELECT max(last_seen_at) AS ts FROM session WHERE principal_id = ?',
                       (principal_id,)).fetchone()
    if row and row['ts']:
        stamps.append(row['ts'])
    if _table(conn, 'object_head'):
        row = conn.execute('SELECT max(created_at) AS ts FROM object_head WHERE author_id = ?',
                           (principal_id,)).fetchone()
        if row and row['ts']:
            stamps.append(row['ts'])
    if _table(conn, 'content_useful'):
        row = conn.execute('SELECT max(created_at) AS ts FROM content_useful WHERE giver_id = ?',
                           (principal_id,)).fetchone()
        if row and row['ts']:
            stamps.append(row['ts'])
    return max(stamps) if stamps else None


def penalty_active(conn, principal_id):
    """上一个自然月邀请来的人里，超过一半已满 7 天且仍不活跃，则这个月额度减半。"""
    start, end = month_bounds(previous_month_key())
    rows = conn.execute(
        'SELECT invitee_id, registered_at FROM invite_progress '
        'WHERE inviter_id = ? AND registered_at >= ? AND registered_at < ?',
        (principal_id, start, end)).fetchall()
    days = policy(conn, 'inactive_days')
    cutoff = clock.now_ts() - days * DAY
    eligible = [row for row in rows if clock.parse(row['registered_at']) <= cutoff]
    if not eligible:
        return False
    inactive = 0
    for row in eligible:
        last = last_active(conn, row['invitee_id'])
        if last is None or clock.parse(last) <= cutoff:
            inactive += 1
    return inactive * 2 > len(eligible)


def quota_view(conn, principal_id):
    profile = _profile(conn, principal_id)
    level = int(profile['level']) if profile else 1
    base = level_quota(conn, level)
    # L1 的表是 0。会员加成从 L2 起算，避免付费把「L1 不能邀」绕开。
    bonus = policy(conn, 'member_bonus') if level >= 2 and is_member(conn, principal_id) else 0
    penalty = penalty_active(conn, principal_id)
    total = (base + bonus) // 2 if penalty else base + bonus
    month = month_key()
    used = conn.execute(
        'SELECT count(*) FROM member_invite WHERE inviter_id = ? AND month_key = ?',
        (principal_id, month)).fetchone()[0]
    return {
        'level': level,
        'base': base,
        'memberBonus': bonus,
        'penalty': penalty,
        'total': total,
        'used': used,
        'remaining': max(0, total - used),
        'month': month,
    }


def _monthly_cap(conn):
    daily = ECON_DAILY_FALLBACK
    if _table(conn, 'economy_rule'):
        row = conn.execute("SELECT value FROM economy_rule WHERE key = 'daily_credit_cap'").fetchone()
        if row is not None:
            daily = int(row['value'])
    return daily + policy(conn, 'reward_monthly_extra')


def _month_rewarded(conn, inviter_id, month):
    row = conn.execute(
        'SELECT coalesce(sum(actual), 0) AS amount FROM invite_reward WHERE inviter_id = ? AND month_key = ?',
        (inviter_id, month)).fetchone()
    return int(row['amount'])


def clean_note(conn, note):
    text = '' if note is None else str(note).strip()
    limit = policy(conn, 'note_max')
    if len(text) > limit:
        raise ApiError('validation_failed', f'这句话最多 {limit} 个字')
    if text and _has_contact(text):
        raise ApiError('validation_failed', '这句话不能留联系方式')
    return text


def _has_contact(text):
    """有 GOV-1 的联系方式扫描就用；模块不在时只做字数检查，调用方已在回执说明。"""
    try:
        from modules.governance import pii
    except ImportError:
        return False
    if not pii.available():
        return False
    return bool(pii.find(text))


def issue(conn, actor, note, request_id=None, *, code=None):
    text = clean_note(conn, note)
    view = quota_view(conn, actor.id)
    if view['remaining'] < 1:
        raise ApiError('action_not_allowed', '这个月没有邀请额度')
    days = policy(conn, 'ttl_days')
    invite_id, code, expires = accounts.issue_invite(
        conn, actor.id, 1, days, text or None, request_id, code=code)
    conn.execute(
        'INSERT INTO member_invite (invite_code_id, inviter_id, note, month_key, created_at) '
        'VALUES (?, ?, ?, ?, ?)',
        (invite_id, actor.id, text, view['month'], clock.now()))
    return {
        'id': invite_id,
        'code': code,
        'url': f'#/hello?invite={code}',
        'expiresAt': expires,
        'note': text,
        'maxUses': 1,
    }


def ensure_progress(conn, invitee_id):
    row = conn.execute('SELECT * FROM invite_progress WHERE invitee_id = ?', (invitee_id,)).fetchone()
    if row is not None:
        return row
    edge = conn.execute('SELECT * FROM invite_edge WHERE invitee_id = ?', (invitee_id,)).fetchone()
    if edge is None:
        return None
    member = conn.execute(
        'SELECT * FROM member_invite WHERE invite_code_id = ?', (edge['invite_code_id'],)).fetchone()
    if member is None:
        return None
    conn.execute(
        'INSERT OR IGNORE INTO invite_progress (invitee_id, inviter_id, invite_code_id, registered_at) '
        'VALUES (?, ?, ?, ?)',
        (invitee_id, member['inviter_id'], edge['invite_code_id'], edge['created_at']))
    return conn.execute('SELECT * FROM invite_progress WHERE invitee_id = ?', (invitee_id,)).fetchone()


def sync_progress(conn, inviter_id):
    rows = conn.execute(
        'SELECT e.invitee_id FROM invite_edge e '
        'JOIN member_invite m ON m.invite_code_id = e.invite_code_id WHERE m.inviter_id = ?',
        (inviter_id,)).fetchall()
    for row in rows:
        ensure_progress(conn, row['invitee_id'])


def _stored_reward(conn, invitee_id, kind):
    row = conn.execute(
        'SELECT actual FROM invite_reward WHERE invitee_id = ? AND kind = ?', (invitee_id, kind)).fetchone()
    return int(row['actual']) if row else 0


def _grant(conn, inviter_id, invitee_id, kind, requested):
    """发竹子。同一个被邀请人、同一种回报只发一次。返回实际到账，邀请人不可用时返回 None。"""
    key = f'invite:{kind}:{invitee_id}'
    existing = conn.execute('SELECT actual FROM invite_reward WHERE idempotency_key = ?', (key,)).fetchone()
    if existing is not None:
        return int(existing['actual'])
    profile = _profile(conn, inviter_id)
    if profile is None or profile['status'] != 'active':
        return None
    if requested <= 0:
        actual = 0
    else:
        month = month_key()
        room = max(0, _monthly_cap(conn) - _month_rewarded(conn, inviter_id, month))
        clipped = min(int(requested), room)
        actual = 0
        if clipped > 0:
            from modules.economy import service as eco
            actual = int(eco.credit(
                conn, inviter_id, 'bamboo', clipped, f'invite.{kind}', key, ref=invitee_id))
        conn.execute(
            'INSERT INTO invite_reward (idempotency_key, inviter_id, invitee_id, kind, requested, actual, '
            'month_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (key, inviter_id, invitee_id, kind, int(requested), actual, month, clock.now()))
    return actual


def note_onboarding(conn, invitee_id, request_id=None):
    progress = ensure_progress(conn, invitee_id)
    if progress is None or not progress['inviter_id']:
        return {'rewarded': 0, 'reason': 'not_invited'}
    if progress['onboarded_at']:
        return {'rewarded': _stored_reward(conn, invitee_id, 'onboarding'), 'reason': 'already'}
    actual = _grant(conn, progress['inviter_id'], invitee_id, 'onboarding', policy(conn, 'reward_onboarding'))
    if actual is None:
        return {'rewarded': 0, 'reason': 'inviter_inactive'}
    conn.execute('UPDATE invite_progress SET onboarded_at = ? WHERE invitee_id = ?', (clock.now(), invitee_id))
    audit.record(conn, invitee_id, 'invite.onboarding', 'principal', progress['inviter_id'],
                 request_id=request_id, meta={'rewarded': actual})
    return {'rewarded': actual, 'reason': 'ok'}


def note_first(conn, invitee_id, contribution_kind, request_id=None):
    if contribution_kind not in ('useful', 'knowledge'):
        raise ApiError('validation_failed', '不认识这种第一次贡献')
    progress = ensure_progress(conn, invitee_id)
    if progress is None or not progress['inviter_id']:
        return {'rewarded': 0, 'reason': 'not_invited'}
    if progress['first_contribution_at']:
        return {'rewarded': _stored_reward(conn, invitee_id, 'first'), 'reason': 'already'}
    actual = _grant(conn, progress['inviter_id'], invitee_id, 'first', policy(conn, 'reward_first'))
    if actual is None:
        return {'rewarded': 0, 'reason': 'inviter_inactive'}
    conn.execute(
        'UPDATE invite_progress SET first_contribution_at = ?, first_contribution_kind = ? WHERE invitee_id = ?',
        (clock.now(), contribution_kind, invitee_id))
    audit.record(conn, invitee_id, 'invite.first', 'principal', progress['inviter_id'],
                 request_id=request_id, meta={'rewarded': actual, 'kind': contribution_kind})
    return {'rewarded': actual, 'reason': 'ok'}


def _public_person(row):
    if row is None or row['status'] == 'deleted':
        return None
    return {'name': row['display_name'], 'level': int(row['level'])}


def _invite_status(code, progress, now):
    if code['revoked_at']:
        return 'revoked'
    if progress is not None and progress['first_contribution_at']:
        return 'contributed'
    if progress is not None and progress['onboarded_at']:
        return 'onboarded'
    if progress is not None or code['used_count'] >= 1:
        return 'registered'
    if code['expires_at'] <= now:
        return 'expired'
    return 'pending'


def overview(conn, actor):
    sync_progress(conn, actor.id)
    void_all_suspended(conn)
    now = clock.now()
    view = quota_view(conn, actor.id)
    rows = conn.execute(
        'SELECT i.id, i.expires_at, i.revoked_at, i.used_count, i.max_uses, i.created_at, m.note, '
        'g.invitee_id, g.onboarded_at, g.first_contribution_at, g.registered_at '
        'FROM member_invite m JOIN invite_code i ON i.id = m.invite_code_id '
        'LEFT JOIN invite_progress g ON g.invite_code_id = m.invite_code_id '
        'WHERE m.inviter_id = ? ORDER BY m.created_at DESC LIMIT 50',
        (actor.id,)).fetchall()
    invites = []
    people = []
    for row in rows:
        person = _public_person(_profile(conn, row['invitee_id'])) if row['invitee_id'] else None
        invites.append({
            'id': row['id'],
            'createdAt': row['created_at'],
            'expiresAt': row['expires_at'],
            'status': _invite_status(row, row if row['registered_at'] else None, now),
            'note': row['note'],
            'name': person['name'] if person else None,
            'level': person['level'] if person else None,
        })
        if person is not None:
            people.append(person)
    sent = conn.execute(
        'SELECT count(*) FROM member_invite WHERE inviter_id = ?', (actor.id,)).fetchone()[0]
    accepted = conn.execute(
        'SELECT count(*) FROM invite_progress WHERE inviter_id = ?', (actor.id,)).fetchone()[0]
    me = _profile(conn, actor.id)
    return {
        'quota': view,
        'sent': sent,
        'accepted': accepted,
        'invites': invites,
        'people': people,
        'me': {'name': me['display_name'], 'level': int(me['level'])} if me else {'name': '成员', 'level': 1},
        'rewards': {
            'onboarding': policy(conn, 'reward_onboarding'),
            'first': policy(conn, 'reward_first'),
        },
    }


def preview(conn, code):
    """落地页只拿公开名字和那句话。过期、用过、作废、封禁一律当作无效，不区分原因。

    邀请人已封禁时作废其未用邀请并返回 None。调用方要等写事务提交后再抛 invite_invalid，
    否则异常回滚会把作废一起撤掉。
    """
    if not code or not str(code).strip():
        raise ApiError('invite_invalid')
    row = conn.execute(
        'SELECT i.id, i.inviter_id, i.expires_at, i.revoked_at, i.used_count, i.max_uses, m.note '
        'FROM invite_code i JOIN member_invite m ON m.invite_code_id = i.id WHERE i.code_hash = ?',
        (security.code_hash(code),)).fetchone()
    if row is None:
        raise ApiError('invite_invalid')
    profile = _profile(conn, row['inviter_id'])
    if profile is not None and profile['status'] == 'suspended':
        void_principal(conn, row['inviter_id'])
        return None
    now = clock.now()
    if (row['revoked_at'] or row['used_count'] >= 1 or row['expires_at'] <= now
            or profile is None or profile['status'] != 'active'):
        raise ApiError('invite_invalid')
    return {'name': profile['display_name'], 'note': row['note']}


def void_principal(conn, principal_id, request_id=None):
    rows = conn.execute(
        'SELECT id FROM invite_code WHERE inviter_id = ? AND revoked_at IS NULL AND used_count < max_uses',
        (principal_id,)).fetchall()
    now = clock.now()
    for row in rows:
        conn.execute(
            'UPDATE invite_code SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL',
            (now, principal_id, row['id']))
        audit.record(conn, principal_id, 'invite.revoke', 'invite_code', row['id'],
                     request_id=request_id, reason='banned', meta={'source': 'invite.ban'})
    return len(rows)


def void_all_suspended(conn):
    rows = conn.execute(
        'SELECT DISTINCT i.inviter_id FROM invite_code i JOIN principal p ON p.id = i.inviter_id '
        "WHERE p.status = 'suspended' AND i.revoked_at IS NULL AND i.used_count < i.max_uses").fetchall()
    return sum(void_principal(conn, row['inviter_id']) for row in rows)


def rules(conn):
    levels = [dict(level=row['level'], monthlyQuota=row['monthly_quota']) for row in conn.execute(
        'SELECT level, monthly_quota FROM invite_quota_rule ORDER BY level')]
    policies = [dict(key=row['key'], value=row['value'], description=row['description']) for row in conn.execute(
        'SELECT key, value, description FROM invite_policy ORDER BY key')]
    return {'levels': levels, 'policies': policies, 'monthlyCap': _monthly_cap(conn)}


def update_rule(conn, actor, body, request_id=None):
    level, quota = body.get('level'), body.get('monthly_quota')
    key, value = body.get('key'), body.get('value')
    if level is not None or quota is not None:
        if level is None or quota is None or key is not None or value is not None:
            raise ApiError('validation_failed', '改等级额度时只提交 level 和 monthly_quota')
        if conn.execute('SELECT 1 FROM invite_quota_rule WHERE level = ?', (level,)).fetchone() is None:
            raise ApiError('resource_not_found')
        conn.execute(
            'UPDATE invite_quota_rule SET monthly_quota = ?, updated_at = ?, updated_by = ? WHERE level = ?',
            (quota, clock.now(), actor.id, level))
        audit.record(conn, actor.id, 'invite.rule', 'invite_quota_rule', str(level),
                     request_id=request_id, meta={'monthly_quota': quota})
        return rules(conn)
    if key is None or value is None:
        raise ApiError('validation_failed', '要改等级额度，或改一条规则')
    if key not in POLICY_KEYS:
        raise ApiError('validation_failed', '没有这条邀请规则')
    low, high = POLICY_RANGE[key]
    if not low <= int(value) <= high:
        raise ApiError('validation_failed', f'{key} 要在 {low} 到 {high} 之间')
    conn.execute(
        'UPDATE invite_policy SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?',
        (int(value), clock.now(), actor.id, key))
    audit.record(conn, actor.id, 'invite.rule', 'invite_policy', key, request_id=request_id,
                 meta={'value': int(value)})
    return rules(conn)


def _related(conn, left, right):
    if not left or not right or left == right:
        return False
    try:
        from modules.growth.antiabuse import conflict
    except ImportError:
        return False
    return bool(conflict(conn, left, right))


def _emit_anomaly(conn, kind, left, right):
    low, high = sorted((left, right))
    month = month_key()
    if conn.execute(
            'SELECT 1 FROM invite_anomaly WHERE kind = ? AND principal_id = ? AND peer_id = ? AND month_key = ?',
            (kind, low, high, month)).fetchone():
        return
    conn.execute(
        'INSERT INTO invite_anomaly (id, kind, principal_id, peer_id, month_key, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (_id(), kind, low, high, month, clock.now()))
    outbox.emit(conn, 'invite.anomaly', 'principal', low, {
        'kind': kind, 'principal_id': low, 'peer_id': high, 'month': month, 'signals': [kind],
    })


def _maybe_mutual_useful(conn, giver_id, receiver_id):
    if not _table(conn, 'content_useful') or not _related(conn, giver_id, receiver_id):
        return
    reverse = conn.execute(
        'SELECT 1 FROM content_useful WHERE giver_id = ? AND receiver_id = ? LIMIT 1',
        (receiver_id, giver_id)).fetchone()
    if reverse:
        _emit_anomaly(conn, 'mutual_useful', giver_id, receiver_id)


def _maybe_mutual_vote(conn, voter_id, author_id):
    if not _table(conn, 'event_vote') or not _related(conn, voter_id, author_id):
        return
    reverse = conn.execute(
        'SELECT 1 FROM event_vote v JOIN event_submission s ON s.id = v.candidate_id '
        'WHERE v.voter_id = ? AND s.principal_id = ? LIMIT 1',
        (author_id, voter_id)).fetchone()
    if reverse:
        _emit_anomaly(conn, 'mutual_vote', voter_id, author_id)


def on_registered(conn, event):
    ensure_progress(conn, event['aggregate_id'])


def on_onboarding(conn, event):
    payload = event.get('payload') or {}
    principal_id = payload.get('principal_id') or event.get('aggregate_id')
    if principal_id:
        note_onboarding(conn, principal_id, event.get('request_id'))


def on_object(conn, event):
    payload = event.get('payload') or {}
    if event['event_type'] == 'object.created':
        if payload.get('type') != 'knowledge' or payload.get('lifecycle') != 'active':
            return
        author = event.get('actor_id')
    else:
        if payload.get('lifecycle') != 'active':
            return
        head = conn.execute('SELECT type, author_id, lifecycle FROM object_head WHERE id = ?',
                            (event['aggregate_id'],)).fetchone()
        if head is None or head['type'] != 'knowledge' or head['lifecycle'] != 'active':
            return
        author = head['author_id']
    if author:
        note_first(conn, author, 'knowledge', event.get('request_id'))


def on_useful(conn, event):
    object_id = event.get('aggregate_id')
    giver = event.get('actor_id')
    if not object_id or not giver:
        return
    counted = bool((event.get('payload') or {}).get('counted'))
    receiver = None
    if _table(conn, 'content_useful'):
        row = conn.execute(
            'SELECT receiver_id, counted FROM content_useful WHERE object_id = ? AND giver_id = ?',
            (object_id, giver)).fetchone()
        if row is not None:
            receiver = row['receiver_id']
            counted = bool(row['counted'])
    if receiver is None and _table(conn, 'object_head'):
        head = conn.execute('SELECT author_id FROM object_head WHERE id = ?', (object_id,)).fetchone()
        receiver = head['author_id'] if head else None
    if not receiver or receiver == giver:
        return
    if counted:
        note_first(conn, receiver, 'useful', event.get('request_id'))
    _maybe_mutual_useful(conn, giver, receiver)


def on_voted(conn, event):
    voter = event.get('actor_id')
    candidate_id = (event.get('payload') or {}).get('candidate_id')
    if not voter or not candidate_id or not _table(conn, 'event_submission'):
        return
    submission = conn.execute(
        'SELECT principal_id FROM event_submission WHERE id = ?', (candidate_id,)).fetchone()
    if submission is None:
        return
    _maybe_mutual_vote(conn, voter, submission['principal_id'])


def on_suspended(conn, event):
    principal_id = event.get('aggregate_id')
    if not principal_id:
        return
    row = conn.execute('SELECT status FROM principal WHERE id = ?', (principal_id,)).fetchone()
    if row is not None and row['status'] == 'suspended':
        void_principal(conn, principal_id, event.get('request_id'))


def sweep(db):
    with db.write() as conn:
        return void_all_suspended(conn)


def purge(conn, principal_id):
    conn.execute("UPDATE member_invite SET note = '' WHERE inviter_id = ?", (principal_id,))


def export_rows(conn, actor):
    """Own invitations and reward history, without bearer hashes or peer identities."""
    issued = [dict(r) for r in conn.execute(
        'SELECT i.id, i.created_at, i.expires_at, i.used_count, i.revoked_at, m.note, m.month_key '
        'FROM member_invite m JOIN invite_code i ON i.id = m.invite_code_id WHERE m.inviter_id = ? '
        'ORDER BY i.created_at, i.id', (actor.id,))]
    progress = [dict(r) for r in conn.execute(
        'SELECT registered_at, onboarded_at, first_contribution_at, first_contribution_kind '
        'FROM invite_progress WHERE invitee_id = ?', (actor.id,))]
    rewards = [dict(r) for r in conn.execute(
        'SELECT kind, requested, actual, month_key, created_at FROM invite_reward '
        'WHERE inviter_id = ? ORDER BY created_at', (actor.id,))]
    return {'issued': issued, 'progress': progress, 'rewards': rewards}
