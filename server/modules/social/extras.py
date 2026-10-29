"""R17-H · 社区祝福、关掉推荐人、阅读入口、找搭子、赞助与讲师申请。

申请表只存文字：预算、拟定价格都是申请人自己填的一句话，这里不收款、不报价、不定分成。
"""
import json
import re
import uuid
from datetime import datetime, timedelta

from app import audit, clock, outbox
from app.authz import require
from app.errors import ApiError

from . import service
from .service import TZ, blocked, follows, people

BLESS_DAY = 20
BLESS_WINDOW_DAYS = 3
SIGNAL_MAX = 200
SIGNAL_KEY = re.compile(r'[A-Za-z0-9_-]{1,40}\Z')
BUDDY_KINDS = ('project', 'learn', 'review')
BUDDY_OPEN_MAX = 5
BUDDY_DAY = 10
INVITE_DAY = 10
APPLY_DAY = 10
BUDDY_LIMITS = {'title': 100, 'outcome': 600, 'schedule': 120, 'contribution': 240, 'partner': 240, 'note': 1000}
APPLY_KINDS = ('sponsor', 'lecturer')


def _now_dt():
    return datetime.fromtimestamp(clock.now_ts(), TZ)


def _human(conn, pid):
    return conn.execute("SELECT 1 FROM principal WHERE id = ? AND kind = 'human' AND status = 'active'",
                        (pid,)).fetchone() is not None


# ---------- 社区祝福 ----------

def _years_text(n):
    return {1: '入群一周年', 2: '入群两周年'}.get(n, f'入群 {n} 周年')


def _anniversary(created_at, today):
    """入群纪念日在今天前后 3 天内，返回周年数；没有返回 None。"""
    try:
        created = datetime.fromisoformat(str(created_at).replace('Z', '+00:00')).astimezone(TZ).date()
    except ValueError:
        return None
    for delta in range(-BLESS_WINDOW_DAYS, BLESS_WINDOW_DAYS + 1):
        day = today + timedelta(days=delta)
        years = day.year - created.year
        if years >= 1 and (day.month, day.day) == (created.month, created.day):
            return years
    return None


def anniversaries(conn, actor):
    """我关注的人里，入群纪念日在这几天的人（最多 12 个）。"""
    service.gate(conn)
    require(conn, actor, 'social.read')
    today = _now_dt().date()
    day = service.today()
    rows = conn.execute(
        "SELECT p.id, p.created_at FROM social_follow f JOIN principal p ON p.id = f.followee_id "
        "WHERE f.follower_id = ? AND p.kind = 'human' AND p.status = 'active' ORDER BY f.created_at DESC, p.id",
        (actor.id,)).fetchall()
    hits = []
    for r in rows:
        years = _anniversary(r['created_at'], today)
        if years is not None and not blocked(conn, actor.id, r['id']):
            hits.append((r['id'], years))
        if len(hits) >= 12:
            break
    who = people(conn, [h[0] for h in hits])
    done = {r[0] for r in conn.execute('SELECT target_id FROM social_blessing WHERE sender_id = ? AND day = ?',
                                       (actor.id, day))}
    return [dict(who[pid], years=years, text=_years_text(years), blessed_today=pid in done)
            for pid, years in hits if pid in who]


def bless(conn, actor, target_id, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.bless')
    service._not_self(actor, target_id)
    if blocked(conn, actor.id, target_id) or not _human(conn, target_id):
        raise ApiError('resource_not_found')
    if not follows(conn, actor.id, target_id):
        raise ApiError('state_conflict', '先关注 TA，再送祝福')
    row = conn.execute('SELECT created_at FROM principal WHERE id = ?', (target_id,)).fetchone()
    years = _anniversary(row['created_at'], _now_dt().date())
    if years is None:
        raise ApiError('state_conflict', '这几天 TA 没有入群纪念日')
    day = service.today()
    sent = conn.execute('SELECT count(*) FROM social_blessing WHERE sender_id = ? AND day = ?',
                        (actor.id, day)).fetchone()[0]
    if sent >= BLESS_DAY:
        retry = service.seconds_to_midnight()
        raise ApiError('rate_limited', '今天送的祝福够多了，明天再来', headers={'Retry-After': str(retry)},
                       retry_after_seconds=retry)
    cur = conn.execute('INSERT OR IGNORE INTO social_blessing (sender_id, target_id, day, years, created_at) '
                       'VALUES (?, ?, ?, ?, ?)', (actor.id, target_id, day, years, clock.now()))
    if not cur.rowcount:
        raise ApiError('state_conflict', '今天已经祝福过 TA 了')
    outbox.emit(conn, 'social.blessed', 'principal', target_id,
                {'recipient_id': target_id, 'message': f'祝你{_years_text(years)}快乐', 'years': years},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'social.bless', 'principal', target_id, request_id=request_id)
    return {'blessed': True, 'day': day, 'years': years}


# ---------- 关掉推荐人 ----------

def dismiss_suggestion(conn, actor, target_id, on=True, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.prefs')
    service._not_self(actor, target_id)
    if on:
        conn.execute('INSERT OR IGNORE INTO social_suggestion_dismiss (principal_id, target_id, created_at) '
                     'VALUES (?, ?, ?)', (actor.id, target_id, clock.now()))
    else:
        conn.execute('DELETE FROM social_suggestion_dismiss WHERE principal_id = ? AND target_id = ?',
                     (actor.id, target_id))
    audit.record(conn, actor.id, 'social.suggestion_dismiss' if on else 'social.suggestion_restore',
                 'principal', target_id, request_id=request_id)
    return {'dismissed': on}


# ---------- 阅读入口 ----------

def signals(conn, actor):
    service.gate(conn)
    require(conn, actor, 'social.signal')
    return [r[0] for r in conn.execute('SELECT key FROM social_signal WHERE principal_id = ? ORDER BY created_at, key',
                                       (actor.id,))]


def save_signal(conn, actor, key, on=True):
    service.gate(conn)
    require(conn, actor, 'social.signal')
    if not SIGNAL_KEY.match(str(key or '')):
        raise ApiError('validation_failed', '阅读入口编号不对')
    if on:
        have = conn.execute('SELECT count(*) FROM social_signal WHERE principal_id = ?', (actor.id,)).fetchone()[0]
        exists = conn.execute('SELECT 1 FROM social_signal WHERE principal_id = ? AND key = ?',
                              (actor.id, key)).fetchone()
        if not exists and have >= SIGNAL_MAX:
            raise ApiError('state_conflict', f'最多保存 {SIGNAL_MAX} 个阅读入口')
        conn.execute('INSERT OR IGNORE INTO social_signal (principal_id, key, created_at) VALUES (?, ?, ?)',
                     (actor.id, key, clock.now()))
    else:
        conn.execute('DELETE FROM social_signal WHERE principal_id = ? AND key = ?', (actor.id, key))
    return {'key': key, 'saved': on}


# ---------- 找搭子 ----------

def _clean(data, required):
    out = {}
    for key, limit in BUDDY_LIMITS.items():
        if key not in data or data[key] is None:
            continue
        value = str(data[key]).strip()
        if len(value) > limit:
            raise ApiError('validation_failed', f'{key} 最多 {limit} 字')
        out[key] = value
    if data.get('kind') is not None:
        if data['kind'] not in BUDDY_KINDS:
            raise ApiError('validation_failed', '搭子类型不对')
        out['kind'] = data['kind']
    if any(not out.get(key) for key in required):
        raise ApiError('validation_failed', '必填项没有填')
    return out


def _post_item(row, who, contact_open, invited=False):
    return {'id': row['id'], 'kind': row['kind'], 'title': row['title'], 'outcome': row['outcome'],
            'schedule': row['schedule'], 'contribution': row['contribution'], 'partner': row['partner'],
            'note': row['note'], 'state': row['state'], 'created_at': row['created_at'],
            'updated_at': row['updated_at'], 'author': who.get(row['author_id']),
            'contact_open': contact_open, 'invited': invited, 'collapsed': bool(row['gov_hidden'])}


def _contact_open(conn, ids):
    ids = list(ids)
    if not ids:
        return set()
    return {r[0] for r in conn.execute(
        f'SELECT principal_id FROM social_pref WHERE buddy_open = 1 AND principal_id IN ({service._marks(ids)})', ids)}


def create_buddy_post(conn, actor, data, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.buddy.post')
    fields = _clean(data, ('kind', 'title', 'outcome', 'schedule', 'contribution', 'partner'))
    opened = conn.execute("SELECT count(*) FROM social_buddy_post WHERE author_id = ? AND state = 'open' AND gov_hidden = 0",
                          (actor.id,)).fetchone()[0]
    if opened >= BUDDY_OPEN_MAX:
        raise ApiError('state_conflict', f'最多同时发布 {BUDDY_OPEN_MAX} 个需求，先收起一个')
    pid, now = str(uuid.uuid4()), clock.now()
    conn.execute('INSERT INTO social_buddy_post (id, author_id, kind, title, outcome, schedule, contribution, '
                 'partner, note, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (pid, actor.id, fields['kind'], fields['title'], fields['outcome'], fields['schedule'],
                  fields['contribution'], fields['partner'], fields.get('note', ''), 'open', now, now))
    audit.record(conn, actor.id, 'social.buddy_post', 'buddy_post', pid, request_id=request_id)
    return get_buddy_post(conn, actor, pid)


def _own_post(conn, actor, post_id):
    row = conn.execute('SELECT * FROM social_buddy_post WHERE id = ? AND author_id = ?',
                       (post_id, actor.id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def get_buddy_post(conn, actor, post_id):
    row = conn.execute('SELECT * FROM social_buddy_post WHERE id = ?', (post_id,)).fetchone()
    if row is None or (row['author_id'] != actor.id and (row['state'] != 'open' or row['gov_hidden'] or blocked(conn, actor.id, row['author_id']))):
        raise ApiError('resource_not_found')
    who = people(conn, [row['author_id']])
    return _post_item(row, who, row['author_id'] in _contact_open(conn, [row['author_id']]))


def update_buddy_post(conn, actor, post_id, data, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.buddy.post')
    row = _own_post(conn, actor, post_id)
    state = data.get('state')
    fields = _clean({k: v for k, v in data.items() if k != 'state'}, ())
    for key in ('title', 'outcome', 'schedule', 'contribution', 'partner'):
        if key in fields and not fields[key]:
            raise ApiError('validation_failed', '必填项不能只有空格')
    if state is not None and state not in ('open', 'paused'):
        raise ApiError('validation_failed', '状态只能是发布中或已收起')
    if state == 'open' and row['gov_hidden']:
        raise ApiError('state_conflict', '这个需求被治理员收起了，不能自己重新发布')
    if state == 'open' and row['state'] != 'open':
        opened = conn.execute("SELECT count(*) FROM social_buddy_post WHERE author_id = ? AND state = 'open' AND gov_hidden = 0",
                              (actor.id,)).fetchone()[0]
        if opened >= BUDDY_OPEN_MAX:
            raise ApiError('state_conflict', f'最多同时发布 {BUDDY_OPEN_MAX} 个需求，先收起一个')
    if state:
        fields['state'] = state
    if fields:
        sets = ', '.join(f'{k} = ?' for k in fields)
        conn.execute(f'UPDATE social_buddy_post SET {sets}, updated_at = ? WHERE id = ?',
                     [*fields.values(), clock.now(), post_id])
        audit.record(conn, actor.id, 'social.buddy_post_update', 'buddy_post', post_id, request_id=request_id)
    return get_buddy_post(conn, actor, post_id)


def buddy_posts(conn, actor, kind=None, mine=False, after=None, limit=20):
    service.gate(conn)
    require(conn, actor, 'social.read')
    where, params = [], {'n': limit + 1, 'me': actor.id}
    if mine:
        where.append('b.author_id = :me')
    else:
        where.append("b.state = 'open' AND b.gov_hidden = 0 AND b.author_id != :me")
        where.append("EXISTS (SELECT 1 FROM principal p WHERE p.id = b.author_id AND p.kind = 'human' AND p.status = 'active')")
        where.append('NOT EXISTS (SELECT 1 FROM social_block k WHERE (k.blocker_id = :me AND k.blocked_id = b.author_id) '
                     'OR (k.blocker_id = b.author_id AND k.blocked_id = :me))')
    if kind:
        if kind not in BUDDY_KINDS:
            raise ApiError('validation_failed', '搭子类型不对')
        where.append('b.kind = :kind')
        params['kind'] = kind
    if after:
        where.append('(b.created_at, b.id) < (:after_at, :after_id)')
        params.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(f"SELECT b.* FROM social_buddy_post b WHERE {' AND '.join(where)} "
                        'ORDER BY b.created_at DESC, b.id DESC LIMIT :n', params).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    who = people(conn, [r['author_id'] for r in rows])
    opened = _contact_open(conn, [r['author_id'] for r in rows])
    live = {(r['target_id'], r['post_id']) for r in conn.execute(
        "SELECT target_id, post_id FROM social_buddy_invite WHERE sender_id = ? AND state = 'sent'", (actor.id,))}
    items = [_post_item(r, who, r['author_id'] in opened, (r['author_id'], r['id']) in live) for r in rows]
    return items, ([rows[-1]['created_at'], rows[-1]['id']] if more and rows else None)


def _invite_item(row, who):
    other = row['target_id'] if row['_box'] == 'sent' else row['sender_id']
    return {'id': row['id'], 'post_id': row['post_id'], 'kind': row['kind'], 'title': row['title'],
            'outcome': row['outcome'], 'schedule': row['schedule'], 'contribution': row['contribution'],
            'note': row['note'], 'state': row['state'], 'created_at': row['created_at'],
            'updated_at': row['updated_at'], 'person': who.get(other)}


def buddy_invites(conn, actor, box='sent', after=None, limit=20):
    service.gate(conn)
    require(conn, actor, 'social.read')
    if box not in ('sent', 'received'):
        raise ApiError('validation_failed', '只能看发出的或收到的邀约')
    col, other = ('sender_id', 'target_id') if box == 'sent' else ('target_id', 'sender_id')
    where = [f'i.{col} = :me']
    params = {'me': actor.id, 'n': limit + 1}
    if box == 'received':
        where.append("i.state != 'withdrawn'")
        where.append(f'NOT EXISTS (SELECT 1 FROM social_block k WHERE (k.blocker_id = :me AND k.blocked_id = i.{other}) '
                     f'OR (k.blocker_id = i.{other} AND k.blocked_id = :me))')
    if after:
        where.append('(i.created_at, i.id) < (:after_at, :after_id)')
        params.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(f"SELECT i.*, '{box}' AS _box FROM social_buddy_invite i WHERE {' AND '.join(where)} "
                        'ORDER BY i.created_at DESC, i.id DESC LIMIT :n', params).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    who = people(conn, [r[other] for r in rows])
    return [_invite_item(r, who) for r in rows], ([rows[-1]['created_at'], rows[-1]['id']] if more and rows else None)


def _invite_row(conn, invite_id):
    row = conn.execute("SELECT i.*, 'sent' AS _box FROM social_buddy_invite i WHERE i.id = ?", (invite_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def send_invite(conn, actor, target_id, data, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.buddy.invite')
    service._not_self(actor, target_id)
    if blocked(conn, actor.id, target_id) or not _human(conn, target_id):
        raise ApiError('resource_not_found')
    if target_id not in _contact_open(conn, [target_id]):
        raise ApiError('state_conflict', '对方暂不接受搭子邀约')
    fields = _clean(data, ('kind', 'title', 'outcome', 'schedule', 'contribution'))
    post_id = data.get('post_id') or None
    if post_id is not None:
        post = conn.execute("SELECT 1 FROM social_buddy_post WHERE id = ? AND author_id = ? AND state = 'open' AND gov_hidden = 0",
                            (post_id, target_id)).fetchone()
        if post is None:
            raise ApiError('resource_not_found')
    sent = conn.execute('SELECT count(*) FROM social_buddy_invite WHERE sender_id = ? AND substr(created_at, 1, 10) = ?',
                        (actor.id, clock.now()[:10])).fetchone()[0]
    if sent >= INVITE_DAY:
        raise ApiError('rate_limited', '今天约得够多了，明天再来', headers={'Retry-After': '3600'}, retry_after_seconds=3600)
    iid, now = str(uuid.uuid4()), clock.now()
    try:
        conn.execute('INSERT INTO social_buddy_invite (id, sender_id, target_id, post_id, kind, title, outcome, '
                     'schedule, contribution, note, state, created_at, updated_at) '
                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)",
                     (iid, actor.id, target_id, post_id, fields['kind'], fields['title'], fields['outcome'],
                      fields['schedule'], fields['contribution'], fields.get('note', ''), now, now))
    except service.sqlite3.IntegrityError:
        raise ApiError('state_conflict', '已经约过 TA 了，可以在「我的意向」里修改')
    outbox.emit(conn, 'social.buddy_invited', 'principal', target_id,
                {'recipient_id': target_id, 'message': fields['title'], 'invite_id': iid},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'social.buddy_invite', 'principal', target_id, request_id=request_id)
    return _invite_with_person(conn, iid, 'sent')


def _invite_with_person(conn, iid, box):
    row = dict(_invite_row(conn, iid))
    row['_box'] = box
    other = row['target_id'] if box == 'sent' else row['sender_id']
    return _invite_item(row, people(conn, [other]))


def update_invite(conn, actor, invite_id, data, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.buddy.invite')
    row = _invite_row(conn, invite_id)
    if row['sender_id'] != actor.id:
        raise ApiError('resource_not_found')
    if row['state'] != 'sent':
        raise ApiError('state_conflict', '这条邀约已经有结果，不能再改')
    fields = _clean({k: v for k, v in data.items() if k not in ('post_id', 'partner')}, ())
    for key in ('title', 'outcome', 'schedule', 'contribution'):
        if key in fields and not fields[key]:
            raise ApiError('validation_failed', '必填项不能只有空格')
    if fields:
        sets = ', '.join(f'{k} = ?' for k in fields)
        conn.execute(f'UPDATE social_buddy_invite SET {sets}, updated_at = ? WHERE id = ?',
                     [*fields.values(), clock.now(), invite_id])
        audit.record(conn, actor.id, 'social.buddy_invite_update', 'buddy_invite', invite_id, request_id=request_id)
    return _invite_with_person(conn, invite_id, 'sent')


def withdraw_invite(conn, actor, invite_id, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.buddy.invite')
    row = _invite_row(conn, invite_id)
    if row['sender_id'] != actor.id:
        raise ApiError('resource_not_found')
    if row['state'] == 'sent':
        conn.execute("UPDATE social_buddy_invite SET state = 'withdrawn', updated_at = ? WHERE id = ?",
                     (clock.now(), invite_id))
        audit.record(conn, actor.id, 'social.buddy_invite_withdraw', 'buddy_invite', invite_id, request_id=request_id)
    elif row['state'] != 'withdrawn':
        raise ApiError('state_conflict', '这条邀约已经有结果，不能撤回')
    return _invite_with_person(conn, invite_id, 'sent')


def answer_invite(conn, actor, invite_id, accept, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.buddy.invite')
    row = _invite_row(conn, invite_id)
    if row['target_id'] != actor.id or blocked(conn, actor.id, row['sender_id']):
        raise ApiError('resource_not_found')
    state = 'accepted' if accept else 'declined'
    if row['state'] == state:
        return _invite_with_person(conn, invite_id, 'received')
    if row['state'] != 'sent':
        raise ApiError('state_conflict', '这条邀约已经有结果')
    conn.execute('UPDATE social_buddy_invite SET state = ?, updated_at = ? WHERE id = ?',
                 (state, clock.now(), invite_id))
    outbox.emit(conn, 'social.buddy_answered', 'principal', row['sender_id'],
                {'recipient_id': row['sender_id'], 'message': row['title'], 'accepted': accept, 'invite_id': invite_id},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'social.buddy_answer', 'buddy_invite', invite_id, request_id=request_id,
                 meta={'accepted': accept})
    return _invite_with_person(conn, invite_id, 'received')


# ---------- 赞助与讲师申请 ----------

def _application_item(row):
    return {'id': row['id'], 'kind': row['kind'], 'state': row['state'], 'fields': json.loads(row['body_json']),
            'decision_note': row['decision_note'], 'created_at': row['created_at'], 'updated_at': row['updated_at']}


def my_applications(conn, actor):
    service.gate(conn)
    require(conn, actor, 'social.read')
    items = []
    for kind in APPLY_KINDS:
        row = conn.execute("SELECT * FROM social_application WHERE applicant_id = ? AND kind = ? AND state != 'withdrawn' "
                           'ORDER BY created_at DESC, id DESC LIMIT 1', (actor.id, kind)).fetchone()
        if row:
            items.append(_application_item(row))
    return items


def save_application(conn, actor, kind, fields, request_id=None):
    service.gate(conn)
    if kind not in APPLY_KINDS:
        raise ApiError('resource_not_found')
    require(conn, actor, f'social.apply.{kind}')
    body = json.dumps(fields, ensure_ascii=False, sort_keys=True)
    if len(body) > 4000:
        raise ApiError('validation_failed', '内容太长')
    now = clock.now()
    row = conn.execute("SELECT id FROM social_application WHERE applicant_id = ? AND kind = ? AND state = 'submitted'",
                       (actor.id, kind)).fetchone()
    if row:
        conn.execute('UPDATE social_application SET body_json = ?, updated_at = ? WHERE id = ?', (body, now, row['id']))
        aid = row['id']
    else:
        aid = str(uuid.uuid4())
        conn.execute('INSERT INTO social_application (id, kind, applicant_id, body_json, state, created_at, updated_at) '
                     "VALUES (?, ?, ?, ?, 'submitted', ?, ?)", (aid, kind, actor.id, body, now, now))
    audit.record(conn, actor.id, f'social.apply_{kind}', 'application', aid, request_id=request_id)
    return _application_item(conn.execute('SELECT * FROM social_application WHERE id = ?', (aid,)).fetchone())


def withdraw_application(conn, actor, kind, request_id=None):
    service.gate(conn)
    if kind not in APPLY_KINDS:
        raise ApiError('resource_not_found')
    require(conn, actor, f'social.apply.{kind}')
    row = conn.execute("SELECT id FROM social_application WHERE applicant_id = ? AND kind = ? AND state = 'submitted'",
                       (actor.id, kind)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    conn.execute("UPDATE social_application SET state = 'withdrawn', updated_at = ? WHERE id = ?", (clock.now(), row['id']))
    audit.record(conn, actor.id, f'social.apply_{kind}_withdraw', 'application', row['id'], request_id=request_id)
    return {'kind': kind, 'state': 'withdrawn'}


def review_list(conn, actor, kind=None, state='submitted', after=None, limit=20):
    service.gate(conn)
    require(conn, actor, 'social.application.review')
    where, params = ['a.state = :state'], {'state': state, 'n': limit + 1}
    if kind:
        where.append('a.kind = :kind')
        params['kind'] = kind
    if after:
        where.append('(a.created_at, a.id) > (:after_at, :after_id)')
        params.update(after_at=after[0], after_id=after[1])
    rows = conn.execute(f"SELECT a.* FROM social_application a WHERE {' AND '.join(where)} "
                        'ORDER BY a.created_at, a.id LIMIT :n', params).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    who = people(conn, [r['applicant_id'] for r in rows])
    return ([dict(_application_item(r), applicant=who.get(r['applicant_id'])) for r in rows],
            [rows[-1]['created_at'], rows[-1]['id']] if more and rows else None)


def review_decide(conn, actor, app_id, decision, note=None, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.application.review')
    if decision not in ('approved', 'rejected'):
        raise ApiError('validation_failed', '结论只能是通过或不通过')
    row = conn.execute('SELECT * FROM social_application WHERE id = ?', (app_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['state'] != 'submitted':
        raise ApiError('state_conflict', '这份申请已经处理过了')
    now = clock.now()
    conn.execute('UPDATE social_application SET state = ?, decided_by = ?, decision_note = ?, decided_at = ?, '
                 'updated_at = ? WHERE id = ?', (decision, actor.id, (note or '').strip()[:300] or None, now, now, app_id))
    outbox.emit(conn, 'social.application_decided', 'principal', row['applicant_id'],
                {'recipient_id': row['applicant_id'], 'kind': row['kind'], 'decision': decision,
                 'message': '赞助合作意向有结果了' if row['kind'] == 'sponsor' else '讲师计划申请有结果了'},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'social.application_decide', 'application', app_id, request_id=request_id,
                 meta={'decision': decision})
    return _application_item(conn.execute('SELECT * FROM social_application WHERE id = ?', (app_id,)).fetchone())


# ---------- 注销清理 ----------

def purge(conn, pid):
    for table, col in (('social_blessing', 'sender_id'), ('social_blessing', 'target_id'),
                       ('social_suggestion_dismiss', 'principal_id'), ('social_suggestion_dismiss', 'target_id'),
                       ('social_signal', 'principal_id'), ('social_buddy_invite', 'sender_id'),
                       ('social_buddy_invite', 'target_id')):
        conn.execute(f'DELETE FROM {table} WHERE {col} = ?', (pid,))
    conn.execute('UPDATE social_buddy_invite SET post_id = NULL WHERE post_id IN '
                 '(SELECT id FROM social_buddy_post WHERE author_id = ?)', (pid,))
    conn.execute('DELETE FROM social_buddy_post WHERE author_id = ?', (pid,))
    conn.execute('UPDATE social_application SET decided_by = NULL WHERE decided_by = ?', (pid,))
    conn.execute('DELETE FROM social_application WHERE applicant_id = ?', (pid,))


# ---------- R17-H4：举报与治理员收起 ----------

REPORT_DAY = 20


def _clean_reason(reason):
    clean = str(reason or '').strip()
    if not 2 <= len(clean) <= 200:
        raise ApiError('validation_failed', '举报原因要在 2 到 200 个字符之间')
    return clean


def _file_report(conn, actor, kind, target_id, reason, snapshot, event, aggregate, request_id):
    sent = conn.execute('SELECT count(*) FROM social_buddy_report WHERE reporter_id = ? AND substr(created_at, 1, 10) = ?',
                        (actor.id, clock.now()[:10])).fetchone()[0]
    if sent >= REPORT_DAY:
        raise ApiError('rate_limited', '今天举报得够多了，明天再来', headers={'Retry-After': '3600'}, retry_after_seconds=3600)
    if conn.execute('SELECT 1 FROM social_buddy_report WHERE target_kind = ? AND target_id = ? AND reporter_id = ?',
                    (kind, target_id, actor.id)).fetchone():
        raise ApiError('state_conflict', '你已经举报过了')
    report_id = str(uuid.uuid4())
    conn.execute('INSERT INTO social_buddy_report (id, target_kind, target_id, reporter_id, reason, snapshot_json, created_at) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?)',
                 (report_id, kind, target_id, actor.id, reason, json.dumps(snapshot, ensure_ascii=False, sort_keys=True),
                  clock.now()))
    outbox.emit(conn, event, aggregate, target_id,
                {'report_id': report_id, 'reporter_id': actor.id, 'reason': reason, 'message': snapshot},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, f'social.buddy_{kind}_report', aggregate, target_id, request_id=request_id,
                 meta={'report_id': report_id})
    return {'report_id': report_id, 'target_id': target_id}


def report_buddy_post(conn, actor, post_id, reason, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.buddy.report')
    clean = _clean_reason(reason)
    row = conn.execute('SELECT * FROM social_buddy_post WHERE id = ?', (post_id,)).fetchone()
    if row is None or row['state'] != 'open' or row['gov_hidden'] or blocked(conn, actor.id, row['author_id']):
        raise ApiError('resource_not_found')
    if row['author_id'] == actor.id:
        raise ApiError('state_conflict', '不能举报自己的需求')
    snapshot = {key: row[key] for key in ('kind', 'title', 'outcome', 'schedule', 'contribution', 'partner', 'note', 'created_at')}
    snapshot['author_id'] = row['author_id']
    return _file_report(conn, actor, 'post', post_id, clean, snapshot, 'social.buddy_post_reported', 'buddy_post', request_id)


def report_buddy_invite(conn, actor, invite_id, reason, request_id=None):
    service.gate(conn)
    require(conn, actor, 'social.buddy.report')
    clean = _clean_reason(reason)
    row = conn.execute('SELECT * FROM social_buddy_invite WHERE id = ?', (invite_id,)).fetchone()
    # 只有收到邀约的人能举报；撤回了的邀约对收件人已经看不到
    if row is None or row['target_id'] != actor.id or row['state'] == 'withdrawn':
        raise ApiError('resource_not_found')
    snapshot = {key: row[key] for key in ('kind', 'title', 'outcome', 'schedule', 'contribution', 'note', 'created_at')}
    snapshot['sender_id'] = row['sender_id']
    return _file_report(conn, actor, 'invite', invite_id, clean, snapshot, 'social.buddy_invite_reported', 'buddy_invite', request_id)


def gov_collapse(conn, post_id):
    """治理员收起需求帖：返回收起前的 gov_hidden，给撤销用。"""
    row = conn.execute('SELECT gov_hidden FROM social_buddy_post WHERE id = ?', (post_id,)).fetchone()
    if row is None:
        raise ApiError('state_conflict', '这个需求已经找不到了')
    conn.execute('UPDATE social_buddy_post SET gov_hidden = 1, updated_at = ? WHERE id = ?', (clock.now(), post_id))
    return row['gov_hidden']


def gov_uncollapse(conn, post_id):
    conn.execute('UPDATE social_buddy_post SET gov_hidden = 0, updated_at = ? WHERE id = ?', (clock.now(), post_id))
