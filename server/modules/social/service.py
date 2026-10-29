"""SOCIAL-1 · 关系、动态、反应、转发、投票、小组。读一律拼 visible_predicate，拉黑双向隔离。

给其他模块（游戏、市集、私信）用的关系接口，全部只读、不抛错：

    blocked(conn, a, b) -> bool             任一方拉黑了另一方
    can_see(conn, viewer, owner, scope) -> bool
        scope: 'members'（同 public / community / everyone）、
               'followers'（viewer 关注了 owner）、'following'（owner 关注了 viewer）、
               'friends'（互相关注）、'private'（只有本人）。拉黑时一律 False，本人一律 True。
    follows(conn, a, b) -> bool             a 关注了 b
    mutual(conn, a, b) -> bool              互相关注（别名 mutual_follow / are_friends / friends_with）
    friend_ids(conn, pid) -> [principal_id]
    muted(conn, a, b) -> bool               a 静音了 b

「好友」范围的动态挂在作者自己的好友圈空间（space.kind = 'social_friends'）上，
互关时把对方加进空间、取关或拉黑时移出，所以核心的 visible_predicate 直接能判对。
"""
import json
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from app import accounts, audit, clock, flags, objects, outbox
from app.authz import Predicate, require, visible_predicate
from app.errors import ApiError

MIGRATION = 'social/social_0001.sql'
TYPE = 'social_post'
REACTIONS = ('up', 'learned', 'reproduced', 'smile', 'cheer', 'question')
SCOPES = ('members', 'friends', 'group', 'private')
COMMUNITY = {'members', 'public', 'community', 'everyone'}
CATEGORIES = {'tech': '技术', 'career': '产品与职业', 'industry': '行业应用', 'community': '社区'}
BODY_MAX = 2000
NOTE_MAX = 500
IMAGES_MAX = 4
POLL_DAYS = (1, 3, 7)
OPTION_MAX = 40
PIN_MAX = 3
POST_BURST = (10, 600)
POST_DAY = (60, 86400)
FOLLOW_DAY = (200, 86400)
POKE_DAY = 30
TZ = timezone(timedelta(hours=8))
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
SLUG = re.compile(r'[a-z0-9][a-z0-9-]{1,39}\Z')
COVER = re.compile(r'assets/[a-z0-9][a-z0-9/_.-]{0,120}\.(webp|png|jpg)\Z')
WS = re.compile(r'\s+')
CONTENT_FIELDS = {'body', 'images', 'link', 'poll', 'quote', 'share_of'}

RULES = ['对事不对人，先看完再回', '求助写清环境、做法和报错', '推广和拉群先问管理员']
DEFAULT_BOARDS = (
    ('ai-coding', 'AI 编程', 'tech', '让模型写代码，也让人读得懂代码。', 'open'),
    ('agent-dev', 'Agent 开发', 'tech', '工具调用、记忆、编排与评测。', 'open'),
    ('prompt-eng', '提示词工程', 'tech', '能复用、能比较的提示词。', 'open'),
    ('model-eval', '模型与评测', 'tech', '新模型上手、评测集与对比。', 'open'),
    ('local-hw', '本地部署与硬件', 'tech', '显卡、量化、推理框架。', 'open'),
    ('product-design', '产品与设计', 'career', 'AI 产品的形态、交互与体验。', 'open'),
    ('global-growth', '出海与增长', 'career', '获客、定价、海外合规。', 'open'),
    ('jobs', '求职与内推', 'career', '岗位、面试与内推，需要申请。', 'apply'),
    ('ai-edu', 'AI 教育', 'career', '课堂里的 AI，和教 AI 的课。', 'open'),
    ('ind-commerce', '电商与零售', 'industry', '选品、客服、投放里的 AI。', 'open'),
    ('ind-content', '内容与媒体', 'industry', '写作、剪辑、配音的工作流。', 'open'),
    ('ind-research', '科研与数据', 'industry', '文献、实验与数据分析。', 'open'),
    ('lounge', '摸鱼闲聊', 'community', '不谈正事的地方。', 'open'),
    ('newcomers', '新人报到', 'community', '先打个招呼，再找组织。', 'open'),
)
DEFAULT_COVERS = {
    'ai-coding': 'assets/groups/claude-code.webp', 'agent-dev': 'assets/groups/agent-eng.webp',
    'prompt-eng': 'assets/groups/prompts.webp', 'model-eval': 'assets/groups/local-models.webp',
    'local-hw': 'assets/groups/hardware.webp', 'product-design': 'assets/groups/design.webp',
    'global-growth': 'assets/groups/product.webp', 'jobs': 'assets/groups/career.webp',
    'ai-edu': 'assets/groups/reading.webp', 'ind-commerce': 'assets/groups/automation.webp',
    'lounge': 'assets/groups/chitchat.webp', 'newcomers': 'assets/groups/newcomers.webp',
}


# ---------- 基础 ----------

def installed(conn):
    try:
        return conn.execute('SELECT 1 FROM schema_migration WHERE id = ?', (MIGRATION,)).fetchone() is not None
    except sqlite3.OperationalError:
        return False


def gate(conn):
    flags.gate(conn, 'social.enabled')


def today(ts=None):
    return datetime.fromtimestamp(clock.now_ts() if ts is None else ts, TZ).strftime('%Y-%m-%d')


def seconds_to_midnight():
    now = datetime.fromtimestamp(clock.now_ts(), TZ)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


def _one(conn, sql, params=()):
    return conn.execute(sql, params).fetchone() is not None


def _marks(items):
    return ','.join('?' * len(items))


def _active(conn, pid):
    row = conn.execute('SELECT status FROM principal WHERE id = ?', (pid,)).fetchone()
    return row is not None and row[0] in ('active', 'pending_deletion')


def principal_id(conn, handle):
    row = conn.execute('SELECT p.id, p.status FROM credential c JOIN principal p ON p.id = c.principal_id '
                       'WHERE c.handle = ?', (str(handle or '')[:64],)).fetchone()
    if row is None or row['status'] not in ('active', 'pending_deletion'):
        raise ApiError('resource_not_found')
    return row['id']


def _not_self(actor, other):
    if actor.id == other:
        raise ApiError('validation_failed', '不能对自己这样做')


def _media():
    try:
        from modules.media import service as media
    except ImportError:
        return None
    return media


def people(conn, ids):
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return {}
    rows = conn.execute(
        f'SELECT p.id, p.status, c.handle, pr.display_name, pr.level, pr.avatar_ref FROM principal p '
        f'JOIN profile pr ON pr.principal_id = p.id LEFT JOIN credential c ON c.principal_id = p.id '
        f'WHERE p.id IN ({_marks(ids)})', ids).fetchall()
    media = _media()
    avatars = media.avatar_urls(conn, [r['avatar_ref'] for r in rows]) if media and media.installed(conn) else {}
    return {r['id']: {'id': r['id'], 'handle': r['handle'], 'display_name': r['display_name'], 'level': r['level'],
                      'avatar': avatars.get(r['avatar_ref'], {}).get('128')} for r in rows}


# ---------- 关系：给其他模块的只读接口 ----------

def follows(conn, a, b):
    if not a or not b or a == b or not installed(conn):
        return False
    return _one(conn, 'SELECT 1 FROM social_follow WHERE follower_id = ? AND followee_id = ?', (a, b))


def mutual(conn, a, b):
    return follows(conn, a, b) and follows(conn, b, a)


mutual_follow = mutual
are_friends = mutual
friends_with = mutual


def blocked(conn, a, b):
    if not a or not b or a == b or not installed(conn):
        return False
    return _one(conn, 'SELECT 1 FROM social_block WHERE (blocker_id = ? AND blocked_id = ?) '
                      'OR (blocker_id = ? AND blocked_id = ?)', (a, b, b, a))


def muted(conn, a, b):
    if not a or not b or a == b or not installed(conn):
        return False
    return _one(conn, 'SELECT 1 FROM social_mute WHERE muter_id = ? AND muted_id = ?', (a, b))


def friend_ids(conn, pid):
    if not pid or not installed(conn):
        return []
    return [r[0] for r in conn.execute(
        'SELECT f.followee_id FROM social_follow f JOIN social_follow b ON b.follower_id = f.followee_id '
        'AND b.followee_id = f.follower_id WHERE f.follower_id = ? ORDER BY f.created_at DESC, f.followee_id',
        (pid,))]


def can_see(conn, viewer, owner, scope='members'):
    if not viewer or not owner or not _active(conn, viewer) or not _active(conn, owner):
        return False
    if viewer == owner:
        return True
    if blocked(conn, viewer, owner):
        return False
    if scope in COMMUNITY:
        return True
    if scope == 'followers':
        return follows(conn, viewer, owner)
    if scope == 'following':
        return follows(conn, owner, viewer)
    if scope == 'friends':
        return mutual(conn, viewer, owner)
    return False


# ---------- 偏好与好友圈空间 ----------

def prefs(conn, pid):
    row = conn.execute('SELECT default_scope, suggestions, buddy_open FROM social_pref WHERE principal_id = ?',
                       (pid,)).fetchone()
    return {'default_scope': row['default_scope'] if row else 'members',
            'suggestions': bool(row['suggestions']) if row else True,
            'buddy_open': bool(row['buddy_open']) if row else False}


def _pref_row(conn, pid):
    conn.execute('INSERT OR IGNORE INTO social_pref (principal_id, updated_at) VALUES (?, ?)', (pid, clock.now()))


def set_prefs(conn, actor, default_scope=None, suggestions=None, request_id=None, buddy_open=None):
    require(conn, actor, 'social.prefs')
    if default_scope is not None and default_scope not in ('members', 'friends', 'private'):
        raise ApiError('validation_failed', '默认范围只能是社区、好友或仅自己')
    _pref_row(conn, actor.id)
    if default_scope is not None:
        conn.execute('UPDATE social_pref SET default_scope = ?, updated_at = ? WHERE principal_id = ?',
                     (default_scope, clock.now(), actor.id))
    if suggestions is not None:
        conn.execute('UPDATE social_pref SET suggestions = ?, updated_at = ? WHERE principal_id = ?',
                     (int(bool(suggestions)), clock.now(), actor.id))
    if buddy_open is not None:
        conn.execute('UPDATE social_pref SET buddy_open = ?, updated_at = ? WHERE principal_id = ?',
                     (int(bool(buddy_open)), clock.now(), actor.id))
    audit.record(conn, actor.id, 'social.prefs', 'principal', actor.id, request_id=request_id,
                 meta={'default_scope': default_scope, 'suggestions': suggestions, 'buddy_open': buddy_open})
    return prefs(conn, actor.id)


def _space_of(conn, pid):
    row = conn.execute('SELECT friends_space_id FROM social_pref WHERE principal_id = ?', (pid,)).fetchone()
    return row[0] if row and row[0] else None


def friends_space(conn, pid):
    sid = _space_of(conn, pid)
    if sid:
        return sid
    sid = accounts.create_space(conn, pid, f'friends-{pid}', '好友圈', kind='social_friends')
    _pref_row(conn, pid)
    conn.execute('UPDATE social_pref SET friends_space_id = ?, updated_at = ? WHERE principal_id = ?',
                 (sid, clock.now(), pid))
    for fid in friend_ids(conn, pid):
        accounts.set_membership(conn, sid, fid, 'active')
    return sid


def _sync_friendship(conn, a, b):
    state = 'active' if mutual(conn, a, b) else 'removed'
    for owner, other in ((a, b), (b, a)):
        sid = _space_of(conn, owner)
        if sid:
            accounts.set_membership(conn, sid, other, state)


# ---------- 关系：写 ----------

def relation(conn, me, other):
    rows = conn.execute('SELECT follower_id, starred FROM social_follow WHERE (follower_id = ? AND followee_id = ?) '
                        'OR (follower_id = ? AND followee_id = ?)', (me, other, other, me)).fetchall()
    mine = next((r for r in rows if r['follower_id'] == me), None)
    theirs = any(r['follower_id'] == other for r in rows)
    return {
        'following': mine is not None,
        'followed_by': theirs,
        'friends': mine is not None and theirs,
        'starred': bool(mine['starred']) if mine else False,
        'muted': muted(conn, me, other),
        'blocked': _one(conn, 'SELECT 1 FROM social_block WHERE blocker_id = ? AND blocked_id = ?', (me, other)),
        'poked_today': _one(conn, 'SELECT 1 FROM social_poke WHERE poker_id = ? AND target_id = ? AND day = ?',
                            (me, other, today())),
    }


def profile_predicate(actor, alias='p'):
    """Member-visible public profiles: active humans, excluding either-direction blocks.

    Profiles are principal rows, not object_head rows, so the object ACL predicate
    does not apply. List and public detail deliberately share this predicate.
    /people/{handle} remains the existing relationship-management surface.
    """
    if not actor.authenticated or actor.status != 'active':
        return Predicate('0', {})
    return Predicate(
        f"{alias}.kind = 'human' AND {alias}.status = 'active' AND NOT EXISTS ("
        f'SELECT 1 FROM social_block b WHERE '
        f'(b.blocker_id = :profile_actor AND b.blocked_id = {alias}.id) OR '
        f'(b.blocked_id = :profile_actor AND b.blocker_id = {alias}.id))',
        {'profile_actor': actor.id})


def profiles(conn, actor, after=None, limit=20, handle=None):
    gate(conn)
    require(conn, actor, 'social.read')
    pred = profile_predicate(actor)
    params = {**pred.params, 'n': limit + 1}
    where = pred.sql
    if handle is not None:
        where += ' AND c.handle = :handle'
        params['handle'] = handle
    if after:
        where += ' AND (c.handle, p.id) > (:after_handle, :after_id)'
        params.update(after_handle=after[0], after_id=after[1])
    rows = conn.execute(
        'SELECT p.id, c.handle FROM principal p JOIN credential c ON c.principal_id = p.id '
        'JOIN profile pr ON pr.principal_id = p.id '
        f'WHERE {where} ORDER BY c.handle, p.id LIMIT :n', params).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    who = people(conn, [r['id'] for r in rows])
    return ([who[r['id']] for r in rows],
            [rows[-1]['handle'], rows[-1]['id']] if more and rows else None)


def public_profile(conn, actor, handle):
    items, _ = profiles(conn, actor, handle=handle, limit=1)
    if not items:
        raise ApiError('resource_not_found')
    return items[0]


def profile_relation(conn, actor, target_id):
    """看一个成员：对方拉黑了我就当不存在；我拉黑了对方只回最小信息，方便解除。"""
    require(conn, actor, 'social.read')
    if _one(conn, 'SELECT 1 FROM social_block WHERE blocker_id = ? AND blocked_id = ?', (target_id, actor.id)):
        raise ApiError('resource_not_found')
    person = people(conn, [target_id]).get(target_id)
    if person is None:
        raise ApiError('resource_not_found')
    rel = relation(conn, actor.id, target_id) if actor.id != target_id else None
    data = {'person': person, 'relation': rel, 'self': actor.id == target_id}
    if not (rel and rel['blocked']):
        data['counts'] = counts(conn, target_id)
        data['mutual_friends'] = len(set(friend_ids(conn, actor.id)) & set(friend_ids(conn, target_id)))
    return data


def counts(conn, pid):
    q = lambda sql: conn.execute(sql, (pid,)).fetchone()[0]
    return {'following': q('SELECT count(*) FROM social_follow WHERE follower_id = ?'),
            'followers': q('SELECT count(*) FROM social_follow WHERE followee_id = ?'),
            'friends': len(friend_ids(conn, pid))}


def follow(conn, actor, target_id, on=True, request_id=None):
    require(conn, actor, 'social.follow')
    _not_self(actor, target_id)
    if on:
        if blocked(conn, actor.id, target_id):
            raise ApiError('resource_not_found')
        cur = conn.execute('INSERT OR IGNORE INTO social_follow (follower_id, followee_id, starred, created_at) '
                           'VALUES (?, ?, 0, ?)', (actor.id, target_id, clock.now()))
        if cur.rowcount:
            friends = follows(conn, target_id, actor.id)
            if friends:
                _sync_friendship(conn, actor.id, target_id)
            outbox.emit(conn, 'social.followed', 'principal', target_id,
                        {'recipient_id': target_id, 'mutual': friends,
                         'message': '和你互相关注了，你们现在是好友' if friends else '关注了你'},
                        actor_id=actor.id, request_id=request_id)
            audit.record(conn, actor.id, 'social.follow', 'principal', target_id, request_id=request_id)
    else:
        was = mutual(conn, actor.id, target_id)
        cur = conn.execute('DELETE FROM social_follow WHERE follower_id = ? AND followee_id = ?',
                           (actor.id, target_id))
        if cur.rowcount:
            if was:
                _sync_friendship(conn, actor.id, target_id)
            audit.record(conn, actor.id, 'social.unfollow', 'principal', target_id, request_id=request_id)
    return relation(conn, actor.id, target_id)


def star(conn, actor, target_id, on=True, request_id=None):
    require(conn, actor, 'social.follow')
    _not_self(actor, target_id)
    cur = conn.execute('UPDATE social_follow SET starred = ? WHERE follower_id = ? AND followee_id = ?',
                       (int(on), actor.id, target_id))
    if not cur.rowcount:
        raise ApiError('state_conflict', '先关注，再设特别关注')
    audit.record(conn, actor.id, 'social.star' if on else 'social.unstar', 'principal', target_id,
                 request_id=request_id)
    return relation(conn, actor.id, target_id)


def mute(conn, actor, target_id, on=True, request_id=None):
    require(conn, actor, 'social.mute')
    _not_self(actor, target_id)
    if on:
        conn.execute('INSERT OR IGNORE INTO social_mute (muter_id, muted_id, created_at) VALUES (?, ?, ?)',
                     (actor.id, target_id, clock.now()))
    else:
        conn.execute('DELETE FROM social_mute WHERE muter_id = ? AND muted_id = ?', (actor.id, target_id))
    audit.record(conn, actor.id, 'social.mute' if on else 'social.unmute', 'principal', target_id,
                 request_id=request_id)
    return relation(conn, actor.id, target_id)


def block(conn, actor, target_id, on=True, request_id=None):
    """拉黑：双向取关（好友圈随之移出），不通知对方。解除拉黑不恢复关注。"""
    require(conn, actor, 'social.block')
    _not_self(actor, target_id)
    if on:
        conn.execute('INSERT OR IGNORE INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                     (actor.id, target_id, clock.now()))
        was = mutual(conn, actor.id, target_id)
        conn.execute('DELETE FROM social_follow WHERE (follower_id = ? AND followee_id = ?) '
                     'OR (follower_id = ? AND followee_id = ?)', (actor.id, target_id, target_id, actor.id))
        if was:
            _sync_friendship(conn, actor.id, target_id)
    else:
        conn.execute('DELETE FROM social_block WHERE blocker_id = ? AND blocked_id = ?', (actor.id, target_id))
    audit.record(conn, actor.id, 'social.block' if on else 'social.unblock', 'principal', target_id,
                 request_id=request_id)
    return relation(conn, actor.id, target_id)


def poke(conn, actor, target_id, request_id=None):
    require(conn, actor, 'social.poke')
    _not_self(actor, target_id)
    if blocked(conn, actor.id, target_id):
        raise ApiError('resource_not_found')
    day = today()
    sent = conn.execute('SELECT count(*) FROM social_poke WHERE poker_id = ? AND day = ?', (actor.id, day)).fetchone()[0]
    if sent >= POKE_DAY:
        retry = seconds_to_midnight()
        raise ApiError('rate_limited', '今天戳得够多了，明天再来', headers={'Retry-After': str(retry)},
                       retry_after_seconds=retry)
    cur = conn.execute('INSERT OR IGNORE INTO social_poke (poker_id, target_id, day, created_at) VALUES (?, ?, ?, ?)',
                       (actor.id, target_id, day, clock.now()))
    if not cur.rowcount:
        raise ApiError('state_conflict', '今天已经戳过 TA 了')
    outbox.emit(conn, 'social.poked', 'principal', target_id, {'recipient_id': target_id, 'message': '戳了你一下'},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'social.poke', 'principal', target_id, request_id=request_id)
    return {'poked': True, 'day': day}


REL_SQL = {
    'following': 'SELECT followee_id AS pid, created_at FROM social_follow WHERE follower_id = :me',
    'followers': 'SELECT follower_id AS pid, created_at FROM social_follow WHERE followee_id = :me',
    'friends': ('SELECT f.followee_id AS pid, max(f.created_at, b.created_at) AS created_at FROM social_follow f '
                'JOIN social_follow b ON b.follower_id = f.followee_id AND b.followee_id = f.follower_id '
                'WHERE f.follower_id = :me'),
    'starred': 'SELECT followee_id AS pid, created_at FROM social_follow WHERE follower_id = :me AND starred = 1',
    'muted': 'SELECT muted_id AS pid, created_at FROM social_mute WHERE muter_id = :me',
    'blocked': 'SELECT blocked_id AS pid, created_at FROM social_block WHERE blocker_id = :me',
}


def relations(conn, actor, kind, after=None, limit=20):
    require(conn, actor, 'social.read')
    if kind not in REL_SQL:
        raise ApiError('validation_failed', '不认识的关系类型')
    where = ' WHERE (r.created_at, r.pid) < (:a_at, :a_id)' if after else ''
    rows = conn.execute(f'SELECT * FROM ({REL_SQL[kind]}) r{where} ORDER BY r.created_at DESC, r.pid DESC '
                        'LIMIT :n', {'me': actor.id, 'n': limit + 1,
                                     **({'a_at': after[0], 'a_id': after[1]} if after else {})}).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    who = people(conn, [r['pid'] for r in rows])
    mine = set(friend_ids(conn, actor.id))
    items = []
    for r in rows:
        if r['pid'] not in who:
            continue
        item = dict(who[r['pid']], since=r['created_at'], relation=relation(conn, actor.id, r['pid']))
        if kind != 'blocked':
            item['mutual_friends'] = len(mine & set(friend_ids(conn, r['pid'])))
        items.append(item)
    return items, ([rows[-1]['created_at'], rows[-1]['pid']] if more and rows else None)


def suggestions(conn, actor, limit=12):
    """可能认识的人：互关好友的好友、同小组、同活动。成员可以关掉（关掉后既不看推荐，也不被推荐）。"""
    require(conn, actor, 'social.read')
    if not flags.enabled(conn, 'social.suggestions') or not prefs(conn, actor.id)['suggestions']:
        return []
    me = actor.id
    exclude = {me}
    exclude |= {r[0] for r in conn.execute('SELECT followee_id FROM social_follow WHERE follower_id = ?', (me,))}
    exclude |= {r[0] for r in conn.execute('SELECT blocked_id FROM social_block WHERE blocker_id = ? UNION '
                                           'SELECT blocker_id FROM social_block WHERE blocked_id = ?', (me, me))}
    exclude |= {r[0] for r in conn.execute('SELECT target_id FROM social_suggestion_dismiss WHERE principal_id = ?',
                                           (me,))}
    score, reasons = {}, {}

    def add(pid, points, reason):
        if pid in exclude:
            return
        score[pid] = score.get(pid, 0) + points
        reasons.setdefault(pid, reason)

    friends = friend_ids(conn, me)
    if friends:
        for pid, n in conn.execute(
                f'SELECT f.followee_id, count(*) FROM social_follow f JOIN social_follow b ON b.follower_id = '
                f'f.followee_id AND b.followee_id = f.follower_id WHERE f.follower_id IN ({_marks(friends)}) '
                f'GROUP BY f.followee_id', friends):
            add(pid, 3 * n, f'{n} 位共同好友')
    for pid, n, name in conn.execute(
            "SELECT m2.principal_id, count(*), min(g.name) FROM social_group_member m1 JOIN social_group_member m2 "
            "ON m2.group_id = m1.group_id JOIN social_group g ON g.id = m1.group_id WHERE m1.principal_id = ? "
            "AND m1.state = 'active' AND m2.state = 'active' AND m2.principal_id != ? GROUP BY m2.principal_id",
            (me, me)):
        add(pid, 2 * n, f'同在「{name}」')
    if _one(conn, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_signup'"):
        for pid, n in conn.execute(
                'SELECT s2.principal_id, count(*) FROM event_signup s1 JOIN event_signup s2 ON s2.event_id = '
                's1.event_id WHERE s1.principal_id = ? AND s2.principal_id != ? GROUP BY s2.principal_id', (me, me)):
            add(pid, 2 * n, '报名了同一个活动')
    if not score:
        return []
    ids = list(score)
    off = {r[0] for r in conn.execute(f'SELECT principal_id FROM social_pref WHERE suggestions = 0 AND principal_id '
                                      f'IN ({_marks(ids)})', ids)}
    alive = {r[0] for r in conn.execute(f"SELECT id FROM principal WHERE status = 'active' AND kind = 'human' "
                                        f'AND id IN ({_marks(ids)})', ids)}
    ranked = sorted((p for p in ids if p in alive and p not in off), key=lambda p: (-score[p], p))[:limit]
    who = people(conn, ranked)
    return [dict(who[p], reason=reasons[p], score=score[p]) for p in ranked if p in who]


def dismissed_suggestions(conn, actor, after=None, limit=20):
    gate(conn)
    require(conn, actor, 'social.read')
    where = ['d.principal_id = :me',
             "p.kind = 'human' AND p.status = 'active'",
             'NOT EXISTS (SELECT 1 FROM social_block b WHERE (b.blocker_id = :me AND b.blocked_id = d.target_id) '
             'OR (b.blocker_id = d.target_id AND b.blocked_id = :me))']
    params = {'me': actor.id, 'n': limit + 1}
    if after:
        where.append('(d.created_at, d.target_id) < (:a_at, :a_id)')
        params.update(a_at=after[0], a_id=after[1])
    rows = conn.execute(
        'SELECT d.target_id, d.created_at FROM social_suggestion_dismiss d '
        'JOIN principal p ON p.id = d.target_id WHERE ' + ' AND '.join(where) +
        ' ORDER BY d.created_at DESC, d.target_id DESC LIMIT :n', params).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    who = people(conn, [r['target_id'] for r in rows])
    items = [dict(who[r['target_id']], dismissed_at=r['created_at']) for r in rows if r['target_id'] in who]
    return items, ([rows[-1]['created_at'], rows[-1]['target_id']] if more and rows else None)


# ---------- 动态：内容类型 ----------

def _text(value, limit, name):
    if value is None:
        return ''
    if not isinstance(value, str) or len(value) > limit:
        raise ApiError('validation_failed', f'{name}最多 {limit} 字')
    return value.strip()


def _link(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {'url', 'title', 'domain'}:
        raise ApiError('validation_failed', '链接只认 url 和 title')
    url = _text(value.get('url'), 500, '链接')
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or '@' in parts.netloc or WS.search(url):
        raise ApiError('validation_failed', '链接只收 http 或 https 地址')
    title = _text(value.get('title'), 120, '链接标题') or parts.hostname
    return {'url': url, 'title': title, 'domain': parts.hostname.lower()}


def _poll(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {'options', 'days', 'closes_at'}:
        raise ApiError('validation_failed', '投票只认 options 和 days')
    options = value.get('options')
    if not isinstance(options, list) or not 2 <= len(options) <= 4:
        raise ApiError('validation_failed', '投票要有 2 到 4 个选项')
    labels = [_text(o, OPTION_MAX, '选项') for o in options]
    if any(not o for o in labels) or len(set(labels)) != len(labels):
        raise ApiError('validation_failed', '选项不能为空，也不能重复')
    days = value.get('days', 3)
    if days not in POLL_DAYS:
        raise ApiError('validation_failed', '投票时长只能是 1、3 或 7 天')
    poll = {'options': labels, 'days': days}
    closes_at = value.get('closes_at')
    if closes_at is not None:
        try:
            clock.parse(closes_at)
        except (TypeError, ValueError):
            raise ApiError('validation_failed', '投票截止时间格式不对') from None
        poll['closes_at'] = closes_at
    return poll


def _ref(value, name):
    if value is None:
        return None
    if not isinstance(value, str) or not UUID.match(value):
        raise ApiError('validation_failed', f'{name}的编号不对')
    return value


def validate_post(content):
    if not isinstance(content, dict):
        raise ApiError('validation_failed', 'content 必须是对象')
    unknown = set(content) - CONTENT_FIELDS
    if unknown:
        raise ApiError('unknown_field', f'content 不认识的字段：{", ".join(sorted(unknown))}')
    images = content.get('images') or []
    if not isinstance(images, list) or len(images) > IMAGES_MAX or any(
            not isinstance(i, str) or not UUID.match(i) for i in images):
        raise ApiError('validation_failed', f'图片最多 {IMAGES_MAX} 张，只收上传后的资产编号')
    quote = content.get('quote')
    if quote is not None and (not isinstance(quote, dict) or set(quote) != {'id'}):
        raise ApiError('validation_failed', '引用只认 id')
    clean = {
        'body': _text(content.get('body'), BODY_MAX, '正文'),
        'images': list(dict.fromkeys(images)),
        'link': _link(content.get('link')),
        'poll': _poll(content.get('poll')),
        'quote': {'id': _ref(quote['id'], '引用')} if quote else None,
        'share_of': _ref(content.get('share_of'), '转发'),
    }
    if not (clean['body'] or clean['images'] or clean['link'] or clean['poll'] or clean['quote']
            or clean['share_of']):
        raise ApiError('validation_failed', '写点什么，或者加一张图、一个链接、一个投票')
    return {k: v for k, v in clean.items() if v not in (None, [], '')}


def post_text(content):
    parts = [content.get('body', '')]
    if content.get('link'):
        parts.append(content['link'].get('title', ''))
    if content.get('poll'):
        parts.extend(content['poll'].get('options', []))
    return '\n'.join(p for p in parts if p).strip()


def _title(content):
    body = WS.sub(' ', content.get('body', '')).strip()
    if body:
        return body[:60]
    for key, label in (('share_of', '转发'), ('poll', '投票'), ('images', '图片'), ('link', '链接'), ('quote', '引用')):
        if content.get(key):
            return label
    return '动态'


# ---------- 动态：写 ----------

def _group_row(conn, slug):
    row = conn.execute('SELECT * FROM social_group WHERE slug = ? AND archived_at IS NULL', (str(slug or '')[:64],)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _member(conn, gid, pid):
    return conn.execute('SELECT role, state FROM social_group_member WHERE group_id = ? AND principal_id = ?',
                        (gid, pid)).fetchone()


def is_member(conn, gid, pid):
    m = _member(conn, gid, pid)
    return m is not None and m['state'] == 'active'


def is_admin(conn, gid, pid):
    m = _member(conn, gid, pid)
    return m is not None and m['state'] == 'active' and m['role'] in ('owner', 'admin')


def create_post(conn, actor, data, request_id=None):
    gate(conn)
    scope = data.get('scope') or prefs(conn, actor.id)['default_scope']
    if scope not in SCOPES:
        raise ApiError('validation_failed', '可见范围只能是社区、好友、小组或仅自己')
    group = None
    if scope == 'group':
        group = _group_row(conn, data.get('group'))
        if not is_member(conn, group['id'], actor.id):
            raise ApiError('action_not_allowed', '先加入小组再发')
    elif data.get('group'):
        raise ApiError('validation_failed', '只有小组范围才带 group')
    content = validate_post({k: data[k] for k in CONTENT_FIELDS if data.get(k) is not None})
    if content.get('quote'):
        objects.load_visible(conn, actor, content['quote']['id'])
    if content.get('poll'):
        content['poll']['closes_at'] = clock.iso(clock.now_ts() + content['poll']['days'] * 86400)
    space_id, acl, visibility = None, (), 'members'
    if scope == 'friends':
        visibility, space_id = 'space', friends_space(conn, actor.id)
    elif scope == 'group':
        space_id = group['space_id']
        visibility = 'space' if group['join_policy'] == 'apply' else 'members'
    elif scope == 'private':
        visibility, acl = 'named', [actor.id]
    object_id = objects.create(conn, actor, type=TYPE, title=_title(content), content=content,
                               visibility=visibility, min_level=1, space_id=space_id, acl=acl,
                               request_id=request_id)
    conn.execute('INSERT INTO social_post (object_id, author_id, scope, group_id, share_of, created_at) '
                 'VALUES (?, ?, ?, ?, ?, ?)', (object_id, actor.id, scope, group['id'] if group else None,
                                               content.get('share_of'), clock.now()))
    audit.record(conn, actor.id, 'social.post', 'object', object_id, request_id=request_id,
                 meta={'scope': scope, 'group_id': group['id'] if group else None})
    return object_id


def _post_head(conn, actor, post_id, active=True):
    """动态可见 = 核心谓词可见 + 是本模块的动态 + 与作者没有拉黑关系。不可见一律 404。"""
    head = objects.load_visible(conn, actor, post_id)
    post = conn.execute('SELECT * FROM social_post WHERE object_id = ?', (post_id,)).fetchone()
    if post is None or blocked(conn, actor.id, post['author_id']):
        raise ApiError('resource_not_found')
    if active and head['lifecycle'] != 'active':
        raise ApiError('state_conflict', '这条动态现在不能互动')
    return head, post


def share(conn, actor, post_id, note=None, scope=None, group=None, request_id=None):
    require(conn, actor, 'social.share')
    head, post = _post_head(conn, actor, post_id)
    if post['share_of']:
        head, post = _post_head(conn, actor, post['share_of'])
    if head['visibility'] != 'members':
        raise ApiError('state_conflict', '这条动态只给特定的人看，不能转发')
    new_id = create_post(conn, actor, {'body': note, 'share_of': head['id'], 'scope': scope, 'group': group},
                         request_id=request_id)
    if post['author_id'] != actor.id:
        outbox.emit(conn, 'social.shared', 'object', new_id,
                    {'recipient_id': post['author_id'], 'object_id': head['id'], 'message': '转发了你的动态'},
                    actor_id=actor.id, request_id=request_id)
    return new_id


def react(conn, actor, post_id, kind, request_id=None):
    require(conn, actor, 'social.react')
    head, post = _post_head(conn, actor, post_id)
    if kind is None:
        conn.execute('DELETE FROM social_reaction WHERE object_id = ? AND principal_id = ?', (post_id, actor.id))
    else:
        if kind not in REACTIONS:
            raise ApiError('validation_failed', '不认识的反应')
        before = conn.execute('SELECT kind FROM social_reaction WHERE object_id = ? AND principal_id = ?',
                              (post_id, actor.id)).fetchone()
        conn.execute('INSERT INTO social_reaction (object_id, principal_id, kind, created_at) VALUES (?, ?, ?, ?) '
                     'ON CONFLICT(object_id, principal_id) DO UPDATE SET kind = excluded.kind',
                     (post_id, actor.id, kind, clock.now()))
        if before is None and post['author_id'] != actor.id:
            outbox.emit(conn, 'social.reacted', 'object', post_id,
                        {'recipient_id': post['author_id'], 'object_id': post_id, 'kind': kind,
                         'message': '对你的动态有了反应'}, actor_id=actor.id, request_id=request_id)
    return reaction_summary(conn, actor, post_id)


def reaction_summary(conn, actor, post_id):
    rows = conn.execute('SELECT r.kind, count(*) FROM social_reaction r WHERE r.object_id = :id AND NOT EXISTS ('
                        'SELECT 1 FROM social_block b WHERE (b.blocker_id = :me AND b.blocked_id = r.principal_id) '
                        'OR (b.blocker_id = r.principal_id AND b.blocked_id = :me)) GROUP BY r.kind',
                        {'id': post_id, 'me': actor.id}).fetchall()
    mine = conn.execute('SELECT kind FROM social_reaction WHERE object_id = ? AND principal_id = ?',
                        (post_id, actor.id)).fetchone()
    found = {r[0]: r[1] for r in rows}
    return {'counts': {k: found[k] for k in REACTIONS if k in found}, 'total': sum(found.values()),
            'mine': mine[0] if mine else None}


def reactors(conn, actor, post_id, limit=50):
    _post_head(conn, actor, post_id, active=False)
    rows = conn.execute('SELECT r.principal_id, r.kind FROM social_reaction r WHERE r.object_id = :id AND NOT EXISTS ('
                        'SELECT 1 FROM social_block b WHERE (b.blocker_id = :me AND b.blocked_id = r.principal_id) '
                        'OR (b.blocker_id = r.principal_id AND b.blocked_id = :me)) ORDER BY r.created_at DESC '
                        'LIMIT :n', {'id': post_id, 'me': actor.id, 'n': limit}).fetchall()
    who = people(conn, [r[0] for r in rows])
    return [dict(who[r[0]], kind=r[1]) for r in rows if r[0] in who]


def vote(conn, actor, post_id, option, request_id=None):
    require(conn, actor, 'social.vote')
    head, _ = _post_head(conn, actor, post_id)
    content = _content(conn, head)
    poll = content.get('poll')
    if not poll:
        raise ApiError('state_conflict', '这条动态没有投票')
    if poll.get('closes_at') and poll['closes_at'] <= clock.now():
        raise ApiError('state_conflict', '投票已经结束')
    if not isinstance(option, int) or isinstance(option, bool) or not 0 <= option < len(poll['options']):
        raise ApiError('validation_failed', '没有这个选项')
    cur = conn.execute('INSERT OR IGNORE INTO social_vote (object_id, principal_id, option, created_at) '
                       'VALUES (?, ?, ?, ?)', (post_id, actor.id, option, clock.now()))
    if not cur.rowcount:
        raise ApiError('state_conflict', '已经投过了')
    audit.record(conn, actor.id, 'social.vote', 'object', post_id, request_id=request_id)
    return _poll_dto(conn, actor, post_id, poll)


def delete_post(conn, settings, actor, post_id, request_id=None):
    head, post = _post_head(conn, actor, post_id, active=False)
    if post['author_id'] == actor.id:
        # The shared withdrawal writer records head.current_version and this short reason.
        objects.withdraw(conn, settings, actor.id, head, reason='author', request_id=request_id)
        return {'id': post_id, 'status': 'deleted'}
    require(conn, actor, 'social.group.moderate')
    if not post['group_id'] or not is_admin(conn, post['group_id'], actor.id):
        raise ApiError('action_not_allowed')
    objects.set_lifecycle(conn, actor.id, post_id, 'hidden', 'group_admin', request_id=request_id)
    conn.execute('DELETE FROM social_group_pin WHERE object_id = ?', (post_id,))
    audit.record(conn, actor.id, 'social.group.hide_post', 'object', post_id, request_id=request_id,
                 meta={'group_id': post['group_id']})
    return {'id': post_id, 'status': 'hidden'}


# ---------- 动态：读 ----------

def _content(conn, head):
    row = conn.execute('SELECT content_json FROM object_version WHERE object_id = ? AND version = ?',
                       (head['id'], head['current_version'])).fetchone()
    return json.loads(row[0]) if row else {}


def _poll_dto(conn, actor, post_id, poll):
    tally = {r[0]: r[1] for r in conn.execute('SELECT option, count(*) FROM social_vote WHERE object_id = ? '
                                              'GROUP BY option', (post_id,))}
    mine = conn.execute('SELECT option FROM social_vote WHERE object_id = ? AND principal_id = ?',
                        (post_id, actor.id)).fetchone()
    closes = poll.get('closes_at')
    return {'options': [{'label': label, 'votes': tally.get(i, 0)} for i, label in enumerate(poll['options'])],
            'total': sum(tally.values()), 'mine': mine[0] if mine else None, 'closes_at': closes,
            'closed': bool(closes and closes <= clock.now())}


def _quote(conn, actor, ref):
    try:
        head = objects.load_visible(conn, actor, ref['id'])
    except ApiError:
        return {'visible': False}
    if head['lifecycle'] != 'active' or blocked(conn, actor.id, head['author_id']):
        return {'visible': False}
    row = conn.execute('SELECT title FROM object_version WHERE object_id = ? AND version = ?',
                       (head['id'], head['current_version'])).fetchone()
    return {'visible': True, 'id': head['id'], 'type': head['type'], 'title': row[0] if row else ''}


FEED_BASE = ('SELECT sp.object_id, sp.author_id, sp.scope, sp.group_id, sp.share_of, sp.created_at '
             'FROM social_post sp JOIN object_head h ON h.id = sp.object_id WHERE {pred} '
             'AND NOT EXISTS (SELECT 1 FROM social_block b WHERE (b.blocker_id = :me AND b.blocked_id = sp.author_id) '
             'OR (b.blocker_id = sp.author_id AND b.blocked_id = :me)){where}')
MY_GROUPS = "SELECT group_id FROM social_group_member WHERE principal_id = :me AND state = 'active'"
NOT_MUTED = ('(sp.author_id = :me OR NOT EXISTS (SELECT 1 FROM social_mute m WHERE m.muter_id = :me '
             'AND m.muted_id = sp.author_id))')
FEED_WHERE = {
    'all': (f' AND {NOT_MUTED} AND (sp.author_id = :me OR sp.author_id IN (SELECT followee_id FROM social_follow '
            f'WHERE follower_id = :me) OR sp.group_id IN ({MY_GROUPS}))'),
    'friends': (f' AND {NOT_MUTED} AND sp.author_id IN (SELECT f.followee_id FROM social_follow f JOIN social_follow '
                'x ON x.follower_id = f.followee_id AND x.followee_id = f.follower_id WHERE f.follower_id = :me)'),
    'groups': f' AND {NOT_MUTED} AND sp.group_id IN ({MY_GROUPS})',
}


def _rows(conn, actor, where, params, after=None, limit=20, since=None):
    pred = visible_predicate(actor, 'h')
    sql = FEED_BASE.format(pred=pred.sql, where=where)
    args = {**pred.params, **params, 'me': actor.id}
    if after:
        sql += ' AND (sp.created_at, sp.object_id) < (:a_at, :a_id)'
        args.update(a_at=after[0], a_id=after[1])
    if since:
        sql += ' AND sp.created_at > :since AND sp.author_id != :me'
        args['since'] = since
        return conn.execute(f'SELECT count(*) FROM ({sql})', args).fetchone()[0]
    sql += ' ORDER BY sp.created_at DESC, sp.object_id DESC LIMIT :n'
    args['n'] = limit + 1
    rows = conn.execute(sql, args).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    return rows, ([rows[-1]['created_at'], rows[-1]['object_id']] if more and rows else None)


def feed(conn, actor, tab='all', after=None, limit=20, content_origin=''):
    require(conn, actor, 'social.read')
    if tab not in FEED_WHERE:
        raise ApiError('validation_failed', '只有全部、好友、小组三种')
    rows, next_key = _rows(conn, actor, FEED_WHERE[tab], {}, after, limit)
    return hydrate(conn, actor, rows, content_origin), next_key


def new_count(conn, actor, since, tab='all'):
    require(conn, actor, 'social.read')
    try:
        clock.parse(since)
    except (TypeError, ValueError):
        raise ApiError('validation_failed', 'since 要用 UTC 时间') from None
    return _rows(conn, actor, FEED_WHERE.get(tab, FEED_WHERE['all']), {}, since=since)


def wall(conn, actor, owner_id, after=None, limit=20, content_origin=''):
    require(conn, actor, 'social.read')
    if blocked(conn, actor.id, owner_id):
        raise ApiError('resource_not_found')
    rows, next_key = _rows(conn, actor, " AND sp.author_id = :owner AND sp.scope != 'group'", {'owner': owner_id},
                           after, limit)
    return hydrate(conn, actor, rows, content_origin), next_key


def post_detail(conn, actor, post_id, content_origin=''):
    require(conn, actor, 'social.read')
    _post_head(conn, actor, post_id, active=False)
    row = conn.execute('SELECT object_id, author_id, scope, group_id, share_of, created_at FROM social_post '
                       'WHERE object_id = ?', (post_id,)).fetchone()
    return hydrate(conn, actor, [row], content_origin)[0]


def hydrate(conn, actor, rows, content_origin='', depth=0):
    if not rows:
        return []
    ids = [r['object_id'] for r in rows]
    m = _marks(ids)
    heads = {h['id']: h for h in conn.execute(
        f'SELECT h.id, h.lifecycle, h.visibility, h.current_version, h.policy_epoch, v.content_json FROM object_head h '
        f'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version WHERE h.id IN ({m})', ids)}
    who = people(conn, [r['author_id'] for r in rows])
    gids = [r['group_id'] for r in rows if r['group_id']]
    groups = {g['id']: g for g in conn.execute(
        f'SELECT id, slug, name, join_policy FROM social_group WHERE id IN ({_marks(gids)})', gids)} if gids else {}
    comments = {r[0]: r[1] for r in conn.execute(
        f"SELECT root_id, count(*) FROM object_head WHERE root_id IN ({m}) AND lifecycle = 'active' GROUP BY root_id",
        ids)}
    shares = {r[0]: r[1] for r in conn.execute(
        f"SELECT sp.share_of, count(*) FROM social_post sp JOIN object_head h ON h.id = sp.object_id "
        f"AND h.lifecycle = 'active' WHERE sp.share_of IN ({m}) GROUP BY sp.share_of", ids)}
    pins = {}
    for r in conn.execute(f'SELECT object_id, kind FROM social_group_pin WHERE object_id IN ({m})', ids):
        pins.setdefault(r[0], set()).add(r[1])
    admin_of = {g for g in groups if is_admin(conn, g, actor.id)}
    media = _media()
    out = []
    for r in rows:
        head = heads.get(r['object_id'])
        if head is None:
            continue
        content = json.loads(head['content_json'])
        images = []
        if content.get('images') and media and media.installed(conn):
            found = media.assets_meta(conn, actor, content['images'], content_origin)
            images = [found[i] for i in content['images'] if i in found]
        group = groups.get(r['group_id'])
        item = {
            'id': r['object_id'], 'author': who.get(r['author_id']), 'scope': r['scope'],
            'group': {'slug': group['slug'], 'name': group['name']} if group else None,
            'created_at': r['created_at'], 'status': 'ok' if head['lifecycle'] == 'active' else 'hidden',
            'etag': f'"v{head["current_version"]}-p{head["policy_epoch"]}"',
            'body': content.get('body', ''), 'images': images, 'link': content.get('link'),
            'poll': _poll_dto(conn, actor, r['object_id'], content['poll']) if content.get('poll') else None,
            'quote': _quote(conn, actor, content['quote']) if content.get('quote') else None,
            'share_of': None, 'reactions': reaction_summary(conn, actor, r['object_id']),
            'comments': comments.get(r['object_id'], 0), 'shares': shares.get(r['object_id'], 0),
            'pinned': 'pin' in pins.get(r['object_id'], ()), 'featured': 'featured' in pins.get(r['object_id'], ()),
            'can': {'delete': r['author_id'] == actor.id or r['group_id'] in admin_of,
                    'moderate': r['group_id'] in admin_of,
                    'share': head['visibility'] == 'members' and head['lifecycle'] == 'active'},
        }
        if r['share_of']:
            item['share_of'] = _shared(conn, actor, r['share_of'], content_origin) if depth == 0 else {'visible': False}
        out.append(item)
    return out


def _shared(conn, actor, post_id, content_origin):
    try:
        head, _ = _post_head(conn, actor, post_id, active=True)
    except ApiError:
        return {'visible': False}
    row = conn.execute('SELECT object_id, author_id, scope, group_id, share_of, created_at FROM social_post '
                       'WHERE object_id = ?', (head['id'],)).fetchone()
    found = hydrate(conn, actor, [row], content_origin, depth=1)
    return dict(found[0], visible=True) if found else {'visible': False}


# ---------- 小组 ----------

def _rules(value):
    if value is None:
        return list(RULES)
    if not isinstance(value, list) or len(value) > 8:
        raise ApiError('validation_failed', '组规最多 8 条')
    rules = [_text(v, 60, '每条组规') for v in value]
    return [r for r in rules if r]


def create_group(conn, actor, data, request_id=None, seeded=False):
    if not seeded:
        require(conn, actor, 'social.group.create')
    slug = str(data.get('slug') or '')
    if not SLUG.match(slug):
        raise ApiError('validation_failed', '地址只用小写字母、数字和短横线，2 到 40 位')
    if _one(conn, 'SELECT 1 FROM social_group WHERE slug = ?', (slug,)):
        raise ApiError('state_conflict', '这个地址已经有小组了')
    name = _text(data.get('name'), 24, '组名')
    if not name:
        raise ApiError('validation_failed', '组名不能为空')
    category = data.get('category') or 'community'
    if category not in CATEGORIES:
        raise ApiError('validation_failed', '不认识的板块分类')
    policy = data.get('join_policy') or 'open'
    if policy not in ('open', 'apply'):
        raise ApiError('validation_failed', '加入方式只能是直接加入或申请')
    cover = data.get('cover')
    if cover is not None and (not isinstance(cover, str) or not COVER.match(cover) or '..' in cover):
        raise ApiError('validation_failed', '封面只能用站内 assets 图')
    space_id = accounts.create_space(conn, actor.id, f'group-{slug}', name, kind='social_group')
    gid = str(uuid.uuid4())
    now = clock.now()
    conn.execute('INSERT INTO social_group (id, space_id, slug, name, category, intro, rules_json, cover, join_policy, '
                 'created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (gid, space_id, slug, name, category, _text(data.get('intro'), 80, '简介'),
                  json.dumps(_rules(data.get('rules')), ensure_ascii=False), cover, policy, actor.id, now))
    conn.execute("INSERT INTO social_group_member (group_id, principal_id, role, state, created_at, updated_at) "
                 "VALUES (?, ?, 'owner', 'active', ?, ?)", (gid, actor.id, now, now))
    audit.record(conn, actor.id, 'social.group.create', 'social_group', gid, request_id=request_id,
                 meta={'slug': slug, 'seeded': seeded})
    return slug


def seed_boards(conn, actor, request_id=None):
    require(conn, actor, 'social.admin.seed')
    made = []
    for slug, name, category, intro, policy in DEFAULT_BOARDS:
        if not _one(conn, 'SELECT 1 FROM social_group WHERE slug = ?', (slug,)):
            made.append(create_group(conn, actor, {'slug': slug, 'name': name, 'category': category, 'intro': intro,
                                                   'join_policy': policy, 'cover': DEFAULT_COVERS.get(slug)},
                                      request_id=request_id, seeded=True))
    return made


def _set_member(conn, group, pid, state, role=None):
    now = clock.now()
    conn.execute('INSERT INTO social_group_member (group_id, principal_id, role, state, created_at, updated_at) '
                 'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(group_id, principal_id) DO UPDATE SET state = excluded.state, '
                 'role = coalesce(?, social_group_member.role), updated_at = excluded.updated_at',
                 (group['id'], pid, role or 'member', state, now, now, role))
    core = {'active': 'active', 'left': 'left', 'removed': 'removed'}.get(state)
    if core:
        accounts.set_membership(conn, group['space_id'], pid, core)


def _admins(conn, gid):
    return [r[0] for r in conn.execute("SELECT principal_id FROM social_group_member WHERE group_id = ? AND state = "
                                       "'active' AND role IN ('owner', 'admin') ORDER BY role DESC, created_at", (gid,))]


def join_group(conn, actor, slug, note=None, request_id=None):
    require(conn, actor, 'social.group.join')
    group = _group_row(conn, slug)
    current = _member(conn, group['id'], actor.id)
    if current and current['state'] in ('active', 'pending'):
        return membership_state(conn, group, actor.id)
    if group['join_policy'] == 'open':
        _set_member(conn, group, actor.id, 'active')
    else:
        _set_member(conn, group, actor.id, 'pending')
        conn.execute('UPDATE social_group_member SET note = ? WHERE group_id = ? AND principal_id = ?',
                     (_text(note, 140, '申请理由') or None, group['id'], actor.id))
        for admin_id in _admins(conn, group['id']):
            if not blocked(conn, admin_id, actor.id):
                outbox.emit(conn, 'social.group.join_requested', 'social_group', group['id'],
                            {'recipient_id': admin_id, 'group': group['slug'],
                             'message': f'申请加入「{group["name"]}」'}, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'social.group.join', 'social_group', group['id'], request_id=request_id,
                 meta={'policy': group['join_policy']})
    return membership_state(conn, group, actor.id)


def leave_group(conn, actor, slug, request_id=None):
    require(conn, actor, 'social.group.join')
    group = _group_row(conn, slug)
    current = _member(conn, group['id'], actor.id)
    if current is None or current['state'] not in ('active', 'pending'):
        return membership_state(conn, group, actor.id)
    if current['role'] == 'owner' and current['state'] == 'active':
        raise ApiError('state_conflict', '先把组长交给别人再退出')
    _set_member(conn, group, actor.id, 'left', role='member')
    audit.record(conn, actor.id, 'social.group.leave', 'social_group', group['id'], request_id=request_id)
    return membership_state(conn, group, actor.id)


def membership_state(conn, group, pid):
    m = _member(conn, group['id'], pid)
    return {'state': m['state'] if m and m['state'] in ('active', 'pending') else 'none',
            'role': m['role'] if m and m['state'] == 'active' else None}


def _moderator(conn, actor, group):
    require(conn, actor, 'social.group.moderate')
    if not is_admin(conn, group['id'], actor.id):
        raise ApiError('action_not_allowed')


def review(conn, actor, slug, target_id, approve, request_id=None):
    group = _group_row(conn, slug)
    _moderator(conn, actor, group)
    m = _member(conn, group['id'], target_id)
    if m is None or m['state'] != 'pending':
        raise ApiError('state_conflict', '这条申请已经处理过了')
    _set_member(conn, group, target_id, 'active' if approve else 'rejected')
    if approve:
        outbox.emit(conn, 'social.group.join_approved', 'social_group', group['id'],
                    {'recipient_id': target_id, 'group': group['slug'], 'message': f'你已加入「{group["name"]}」'},
                    actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'social.group.approve' if approve else 'social.group.reject', 'principal', target_id,
                 request_id=request_id, meta={'group_id': group['id']})
    return membership_state(conn, group, target_id)


def remove_member(conn, actor, slug, target_id, request_id=None):
    group = _group_row(conn, slug)
    _moderator(conn, actor, group)
    m = _member(conn, group['id'], target_id)
    if m is None or m['state'] != 'active':
        raise ApiError('resource_not_found')
    if m['role'] == 'owner' or (m['role'] == 'admin' and not _is_owner(conn, group, actor.id)):
        raise ApiError('action_not_allowed')
    _set_member(conn, group, target_id, 'removed', role='member')
    audit.record(conn, actor.id, 'social.group.remove', 'principal', target_id, request_id=request_id,
                 meta={'group_id': group['id']})
    return membership_state(conn, group, target_id)


def _is_owner(conn, group, pid):
    m = _member(conn, group['id'], pid)
    return m is not None and m['state'] == 'active' and m['role'] == 'owner'


def set_admin(conn, actor, slug, target_id, on=True, request_id=None):
    group = _group_row(conn, slug)
    _moderator(conn, actor, group)
    if not _is_owner(conn, group, actor.id):
        raise ApiError('action_not_allowed', '只有组长能任命管理员')
    m = _member(conn, group['id'], target_id)
    if m is None or m['state'] != 'active' or m['role'] == 'owner':
        raise ApiError('state_conflict', '只能任命组里的普通成员')
    conn.execute('UPDATE social_group_member SET role = ?, updated_at = ? WHERE group_id = ? AND principal_id = ?',
                 ('admin' if on else 'member', clock.now(), group['id'], target_id))
    audit.record(conn, actor.id, 'social.group.admin' if on else 'social.group.unadmin', 'principal', target_id,
                 request_id=request_id, meta={'group_id': group['id']})
    return membership_state(conn, group, target_id)


def pin(conn, actor, slug, post_id, kind='pin', on=True, request_id=None):
    if kind not in ('pin', 'featured'):
        raise ApiError('validation_failed', '只有置顶和精华')
    group = _group_row(conn, slug)
    _moderator(conn, actor, group)
    head, post = _post_head(conn, actor, post_id)
    if post['group_id'] != group['id']:
        raise ApiError('resource_not_found')
    if on:
        if kind == 'pin' and conn.execute("SELECT count(*) FROM social_group_pin WHERE group_id = ? AND kind = 'pin'",
                                          (group['id'],)).fetchone()[0] >= PIN_MAX:
            raise ApiError('state_conflict', f'最多置顶 {PIN_MAX} 条')
        conn.execute('INSERT OR IGNORE INTO social_group_pin (group_id, object_id, kind, pinned_by, created_at) '
                     'VALUES (?, ?, ?, ?, ?)', (group['id'], post_id, kind, actor.id, clock.now()))
    else:
        conn.execute('DELETE FROM social_group_pin WHERE group_id = ? AND object_id = ? AND kind = ?',
                     (group['id'], post_id, kind))
    audit.record(conn, actor.id, f'social.group.{kind}' if on else f'social.group.un{kind}', 'object', post_id,
                 request_id=request_id, meta={'group_id': group['id']})
    return {'pinned': _one(conn, "SELECT 1 FROM social_group_pin WHERE object_id = ? AND kind = 'pin'", (post_id,)),
            'featured': _one(conn, "SELECT 1 FROM social_group_pin WHERE object_id = ? AND kind = 'featured'",
                             (post_id,))}


def _group_dto(row, members, mine):
    return {'slug': row['slug'], 'name': row['name'], 'category': row['category'],
            'category_label': CATEGORIES[row['category']], 'intro': row['intro'],
            'cover': row['cover'] or DEFAULT_COVERS.get(row['slug']),
            'join_policy': row['join_policy'], 'members': members, 'me': mine}


def list_groups(conn, actor, category=None):
    require(conn, actor, 'social.read')
    if category is not None and category not in CATEGORIES:
        raise ApiError('validation_failed', '不认识的板块分类')
    rows = conn.execute(
        "SELECT g.*, (SELECT count(*) FROM social_group_member m WHERE m.group_id = g.id AND m.state = 'active') AS n, "
        "mm.state AS my_state, mm.role AS my_role FROM social_group g LEFT JOIN social_group_member mm ON "
        "mm.group_id = g.id AND mm.principal_id = ? WHERE g.archived_at IS NULL AND (? IS NULL OR g.category = ?) "
        "ORDER BY g.category, g.created_at", (actor.id, category, category)).fetchall()
    out = []
    for r in rows:
        state = r['my_state'] if r['my_state'] in ('active', 'pending') else 'none'
        out.append(_group_dto(r, r['n'], {'state': state, 'role': r['my_role'] if state == 'active' else None}))
    return out


def group_detail(conn, actor, slug, content_origin=''):
    require(conn, actor, 'social.read')
    group = _group_row(conn, slug)
    members = conn.execute("SELECT count(*) FROM social_group_member WHERE group_id = ? AND state = 'active'",
                           (group['id'],)).fetchone()[0]
    mine = membership_state(conn, group, actor.id)
    data = _group_dto(group, members, mine)
    data['rules'] = json.loads(group['rules_json'])
    admins = _admins(conn, group['id'])
    who = people(conn, admins)
    data['admins'] = [dict(who[a], role=_member(conn, group['id'], a)['role']) for a in admins
                      if a in who and not blocked(conn, actor.id, a)]
    preview = [r[0] for r in conn.execute("SELECT principal_id FROM social_group_member WHERE group_id = ? AND state = "
                                          "'active' ORDER BY updated_at DESC LIMIT 12", (group['id'],))]
    faces = people(conn, preview)
    data['member_preview'] = [faces[p] for p in preview if p in faces and not blocked(conn, actor.id, p)][:8]
    pinned = conn.execute("SELECT sp.object_id, sp.author_id, sp.scope, sp.group_id, sp.share_of, sp.created_at "
                          "FROM social_group_pin gp JOIN social_post sp ON sp.object_id = gp.object_id "
                          "WHERE gp.group_id = ? AND gp.kind = 'pin' ORDER BY gp.created_at DESC", (group['id'],)).fetchall()
    visible = []
    for row in pinned:
        try:
            _post_head(conn, actor, row['object_id'])
        except ApiError:
            continue
        visible.append(row)
    data['pinned'] = hydrate(conn, actor, visible, content_origin)
    admin = mine['role'] in ('owner', 'admin')
    data['pending'] = conn.execute("SELECT count(*) FROM social_group_member WHERE group_id = ? AND state = 'pending'",
                                   (group['id'],)).fetchone()[0] if admin else None
    data['events'] = _group_events(conn, actor, group) if mine['state'] == 'active' else []
    data['can_post'] = mine['state'] == 'active'
    return data


def _group_events(conn, actor, group):
    if not _one(conn, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'community_event'"):
        return []
    rows = conn.execute("SELECT slug, title, starts_at, ends_at, status FROM community_event WHERE space_id = ? AND "
                        "status != 'ended' AND visibility IN ('members', 'space') AND min_level <= ? "
                        "ORDER BY starts_at LIMIT 5", (group['space_id'], actor.level)).fetchall()
    return [dict(r) for r in rows]


def group_feed(conn, actor, slug, view='all', after=None, limit=20, content_origin=''):
    require(conn, actor, 'social.read')
    group = _group_row(conn, slug)
    where = ' AND sp.group_id = :gid'
    if view == 'featured':
        where += " AND EXISTS (SELECT 1 FROM social_group_pin gp WHERE gp.object_id = sp.object_id AND gp.kind = 'featured')"
    elif view != 'all':
        raise ApiError('validation_failed', '只有全部和精华')
    rows, next_key = _rows(conn, actor, where, {'gid': group['id']}, after, limit)
    return hydrate(conn, actor, rows, content_origin), next_key


def group_members(conn, actor, slug, state='active', after=None, limit=20):
    require(conn, actor, 'social.read')
    group = _group_row(conn, slug)
    if state not in ('active', 'pending'):
        raise ApiError('validation_failed', '只有成员和待审核')
    if state == 'pending':
        _moderator(conn, actor, group)
    where = ' AND (m.updated_at, m.principal_id) < (?, ?)' if after else ''
    rows = conn.execute(f'SELECT m.principal_id, m.role, m.note, m.updated_at FROM social_group_member m WHERE '
                        f'm.group_id = ? AND m.state = ?{where} ORDER BY m.updated_at DESC, m.principal_id DESC LIMIT ?',
                        (group['id'], state, *(after or ()), limit + 1)).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    who = people(conn, [r['principal_id'] for r in rows])
    items = [dict(who[r['principal_id']], role=r['role'], note=r['note'] if state == 'pending' else None)
             for r in rows if r['principal_id'] in who and not blocked(conn, actor.id, r['principal_id'])]
    return items, ([rows[-1]['updated_at'], rows[-1]['principal_id']] if more and rows else None)


# ---------- 导出与注销清理 ----------

def export_rows(conn, actor):
    if not installed(conn):
        return {}
    pid = actor.id
    rows = lambda sql: [dict(r) for r in conn.execute(sql, (pid,))]
    return {
        'prefs': prefs(conn, pid),
        'following': rows('SELECT followee_id, starred, created_at FROM social_follow WHERE follower_id = ?'),
        'followers_count': counts(conn, pid)['followers'],
        'muted': rows('SELECT muted_id, created_at FROM social_mute WHERE muter_id = ?'),
        'blocked': rows('SELECT blocked_id, created_at FROM social_block WHERE blocker_id = ?'),
        'pokes_sent': rows('SELECT target_id, day FROM social_poke WHERE poker_id = ?'),
        'blessings_sent': rows('SELECT target_id, day, years, created_at FROM social_blessing WHERE sender_id = ?'),
        'suggestions_dismissed': rows('SELECT target_id, created_at FROM social_suggestion_dismiss '
                                      'WHERE principal_id = ?'),
        'reading_entries': rows('SELECT key, created_at FROM social_signal WHERE principal_id = ?'),
        'buddy_posts': rows('SELECT id, kind, title, outcome, schedule, contribution, partner, note, state, '
                            'created_at FROM social_buddy_post WHERE author_id = ?'),
        'buddy_invites_sent': rows('SELECT target_id, post_id, kind, title, outcome, schedule, contribution, note, '
                                   'state, created_at FROM social_buddy_invite WHERE sender_id = ?'),
        'buddy_invites_received': rows('SELECT sender_id, kind, title, state, created_at FROM social_buddy_invite '
                                       'WHERE target_id = ?'),
        'applications': rows('SELECT kind, body_json, state, created_at FROM social_application '
                             'WHERE applicant_id = ?'),
        'buddy_reports': rows('SELECT target_kind, target_id, reason, created_at FROM social_buddy_report '
                              'WHERE reporter_id = ?'),
        'reactions': rows('SELECT object_id, kind, created_at FROM social_reaction WHERE principal_id = ?'),
        'votes': rows('SELECT object_id, option, created_at FROM social_vote WHERE principal_id = ?'),
        'posts': rows('SELECT object_id, scope, group_id, share_of, created_at FROM social_post WHERE author_id = ?'),
        'groups': rows('SELECT g.slug, m.role, m.state, m.created_at FROM social_group_member m JOIN social_group g '
                       'ON g.id = m.group_id WHERE m.principal_id = ?'),
    }


def purge(conn, pid):
    """注销到期：关系、反应、投票、组成员身份全部清掉；组长身份交给最早的管理员或成员，没人就归档。"""
    if not installed(conn):
        return
    friends = friend_ids(conn, pid)
    conn.execute('DELETE FROM social_follow WHERE follower_id = ? OR followee_id = ?', (pid, pid))
    for fid in friends:
        _sync_friendship(conn, pid, fid)
    for table, a, b in (('social_mute', 'muter_id', 'muted_id'), ('social_block', 'blocker_id', 'blocked_id'),
                        ('social_poke', 'poker_id', 'target_id')):
        conn.execute(f'DELETE FROM {table} WHERE {a} = ? OR {b} = ?', (pid, pid))
    conn.execute('DELETE FROM social_reaction WHERE principal_id = ?', (pid,))
    conn.execute('DELETE FROM social_vote WHERE principal_id = ?', (pid,))
    from . import extras
    extras.purge(conn, pid)
    for g in conn.execute("SELECT g.* FROM social_group g JOIN social_group_member m ON m.group_id = g.id WHERE "
                          "m.principal_id = ? AND m.role = 'owner' AND m.state = 'active'", (pid,)).fetchall():
        heir = conn.execute("SELECT principal_id FROM social_group_member WHERE group_id = ? AND state = 'active' AND "
                            "principal_id != ? ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at LIMIT 1",
                            (g['id'], pid)).fetchone()
        if heir:
            conn.execute("UPDATE social_group_member SET role = 'owner', updated_at = ? WHERE group_id = ? AND "
                         'principal_id = ?', (clock.now(), g['id'], heir[0]))
        else:
            conn.execute('UPDATE social_group SET archived_at = ? WHERE id = ?', (clock.now(), g['id']))
    for g in conn.execute("SELECT g.* FROM social_group g JOIN social_group_member m ON m.group_id = g.id WHERE "
                          "m.principal_id = ? AND m.state IN ('active', 'pending')", (pid,)).fetchall():
        _set_member(conn, g, pid, 'left', role='member')
    sid = _space_of(conn, pid)
    if sid:
        conn.execute("UPDATE membership SET state = 'removed', updated_at = ? WHERE space_id = ?", (clock.now(), sid))
    conn.execute('DELETE FROM social_pref WHERE principal_id = ?', (pid,))
