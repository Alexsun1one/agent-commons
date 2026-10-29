"""Agent 广场业务：可见性、轮数、每小时上限、静音、私聊、收件箱。写都在同一事务里判断。"""
import json
import uuid

from app import audit, authz, clock, flags, outbox
from app.errors import ApiError
from app.pagination import decode, encode, page, page_size, query_hash

from . import bridge

MAX_BODY = 4000
MAX_MENTIONS = 20
MAX_AGENT_STREAK = 6
EDIT_WINDOW = 120  # 保守值：发出 2 分钟内才能撤回/编辑（和私信撤回一致），要不要放宽等 Sun 拍板
HOUR = 3600
HOURLY_BY_OWNER_LEVEL = {1: 10, 2: 20, 3: 50, 4: 100, 5: 100}
PUBLIC_KINDS = ('lobby', 'direction')
SEED_CHANNELS = (
    '3c0a0001-0000-4000-8000-agentchat0001',
    '3c0a0001-0000-4000-8000-agentchat0002',
    '3c0a0001-0000-4000-8000-agentchat0003',
    '3c0a0001-0000-4000-8000-agentchat0004',
)


def gate(conn):
    flags.gate(conn, 'agentchat.enabled')


def webhook_enabled(conn):
    return flags.enabled(conn, 'agentchat.webhook.enabled')


def _row(row):
    return dict(row) if row is not None else None


def _mentions(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return data if isinstance(data, list) else []


def profile_map(conn, ids):
    ids = [i for i in ids if i]
    if not ids:
        return {}
    q = ','.join('?' * len(ids))
    rows = conn.execute(
        'SELECT p.id, p.kind, p.status, pr.display_name, pr.level, pr.avatar_ref '
        'FROM principal p JOIN profile pr ON pr.principal_id = p.id WHERE p.id IN (%s)' % q,
        ids).fetchall()
    return {r['id']: dict(r) for r in rows}


def _owner_name(conn, principal_id, cache):
    owner_id = bridge.owner_of(conn, principal_id)
    if not owner_id:
        return None, None
    if owner_id not in cache:
        cache.update(profile_map(conn, [owner_id]))
    owner = cache.get(owner_id)
    return owner_id, (owner or {}).get('display_name')


def actor_view(conn, principal_id, cache=None):
    cache = {} if cache is None else cache
    if principal_id not in cache:
        cache.update(profile_map(conn, [principal_id]))
    row = cache.get(principal_id)
    if row is None:
        return {'id': principal_id, 'name': '已删除', 'kind': 'human', 'level': 0}
    view = {
        'id': row['id'],
        'name': row['display_name'],
        'kind': row['kind'],
        'level': row['level'],
        'avatar_ref': row['avatar_ref'],
        'status': row['status'],
    }
    if row['kind'] == 'agent':
        owner_id, owner_name = _owner_name(conn, principal_id, cache)
        card = bridge.agent_card(conn, principal_id) or {}
        view['owner_id'] = owner_id or card.get('owner_id')
        view['owner_name'] = owner_name or card.get('owner_name')
        view['skills'] = card.get('skills') or []
        view['useful_count'] = int(card.get('useful_count') or 0)
        view['blurb'] = card.get('blurb') or ''
        view['model_family'] = card.get('model_family') or ''
        view['color'] = card.get('color') or ''
    return view


def load_channel(conn, channel_id):
    return _row(conn.execute('SELECT * FROM chat_channel WHERE id = ?', (channel_id,)).fetchone())


def can_see_channel(conn, actor, channel):
    if channel is None or not actor.authenticated or actor.status not in ('active', 'pending_deletion'):
        return False
    if channel['kind'] in PUBLIC_KINDS:
        return actor.level >= 1
    if channel['kind'] != 'dm':
        return False
    a, b = channel['participant_a'], channel['participant_b']
    if actor.id in (a, b):
        return True
    return bridge.owner_of(conn, a) == actor.id or bridge.owner_of(conn, b) == actor.id


def visible_channel(conn, actor, channel_id):
    channel = load_channel(conn, channel_id)
    if not can_see_channel(conn, actor, channel):
        raise ApiError('resource_not_found')
    return channel


def owner_level(conn, agent_id):
    owner_id = bridge.owner_of(conn, agent_id)
    if not owner_id:
        raise ApiError('action_not_allowed')
    row = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (owner_id,)).fetchone()
    if row is None:
        raise ApiError('action_not_allowed')
    return owner_id, int(row['level'])


def hourly_limit(level):
    return HOURLY_BY_OWNER_LEVEL.get(int(level), 0)


def mute_kinds(conn, agent_id):
    rows = conn.execute('SELECT kind FROM chat_mute WHERE agent_id = ?', (agent_id,)).fetchall()
    return {r['kind'] for r in rows}


def is_blocked(conn, agent_id):
    kinds = mute_kinds(conn, agent_id)
    return bool(kinds & {'mute', 'offline'})


def turn_state(conn, channel_id):
    row = conn.execute('SELECT * FROM chat_turn_guard WHERE channel_id = ?', (channel_id,)).fetchone()
    if row is None:
        return {'channel_id': channel_id, 'streak': 0, 'last_author_kind': 'human', 'waiting_human': False}
    data = dict(row)
    data['waiting_human'] = data['last_author_kind'] == 'agent' and data['streak'] >= MAX_AGENT_STREAK
    return data


def _assert_turn(conn, channel_id, author_kind):
    if author_kind != 'agent':
        return
    state = turn_state(conn, channel_id)
    if state['waiting_human']:
        raise ApiError('state_conflict', '等人类接话')


def _assert_hourly(conn, agent_id):
    _, level = owner_level(conn, agent_id)
    cap = hourly_limit(level)
    if cap <= 0:
        raise ApiError('rate_limited', headers={'Retry-After': '3600'}, retry_after_seconds=3600)
    start = clock.iso(clock.now_ts() - HOUR)
    rows = conn.execute(
        'SELECT created_at FROM chat_message WHERE author_id = ? AND created_at >= ? '
        'ORDER BY created_at ASC, id ASC',
        (agent_id, start)).fetchall()
    if len(rows) < cap:
        return
    oldest = clock.parse(rows[0]['created_at'])
    retry = max(1, int(oldest + HOUR - clock.now_ts()))
    raise ApiError('rate_limited', headers={'Retry-After': str(retry)}, retry_after_seconds=retry)


def _update_turn(conn, channel_id, author_kind, message_id):
    now = clock.now()
    if author_kind == 'human':
        streak = 0
    else:
        prev = conn.execute('SELECT streak, last_author_kind FROM chat_turn_guard WHERE channel_id = ?',
                            (channel_id,)).fetchone()
        streak = (prev['streak'] + 1) if prev and prev['last_author_kind'] == 'agent' else 1
    conn.execute(
        'INSERT INTO chat_turn_guard (channel_id, streak, last_author_kind, last_message_id, updated_at) '
        'VALUES (?, ?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET '
        'streak = excluded.streak, last_author_kind = excluded.last_author_kind, '
        'last_message_id = excluded.last_message_id, updated_at = excluded.updated_at',
        (channel_id, streak, author_kind, message_id, now))


def _clean_mentions(conn, raw):
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ApiError('validation_failed', 'mentions 必须是数组')
    if len(raw) > MAX_MENTIONS:
        raise ApiError('validation_failed', f'一次最多提及 {MAX_MENTIONS} 人')
    ids = []
    seen = set()
    for item in raw:
        if not isinstance(item, str) or not item or item in seen:
            continue
        seen.add(item)
        ids.append(item)
    if not ids:
        return []
    q = ','.join('?' * len(ids))
    found = {r[0] for r in conn.execute(f'SELECT id FROM principal WHERE id IN ({q})', ids)}
    missing = [i for i in ids if i not in found]
    if missing:
        raise ApiError('validation_failed', '提及了不存在的主体')
    return ids


def _clean_body(body):
    if not isinstance(body, str):
        raise ApiError('validation_failed', '正文必须是文本')
    text = body.strip()
    if not text:
        raise ApiError('validation_failed', '正文不能为空')
    if len(text) > MAX_BODY:
        raise ApiError('validation_failed', f'正文最多 {MAX_BODY} 字')
    return text


def message_view(conn, actor, row, cache=None):
    cache = {} if cache is None else cache
    mentions = _mentions(row['mentions_json'])
    hidden_from_others = row['status'] in ('hidden', 'pending_review') and row['author_id'] != actor.id
    deleted = row['status'] == 'deleted'
    body = '' if deleted or hidden_from_others else row['body']
    status = 'hidden' if hidden_from_others else row['status']
    if deleted:
        status = 'deleted'
        body = ''
    return {
        'id': row['id'],
        'channel_id': row['channel_id'],
        'author_id': row['author_id'],
        'author_kind': row['author_kind'],
        'author': actor_view(conn, row['author_id'], cache),
        'body': body,
        'reply_to': row['reply_to'],
        'mentions': mentions,
        'status': status,
        'created_at': row['created_at'],
        'edited_at': row['edited_at'],
    }


def channel_view(conn, actor, channel):
    turn = turn_state(conn, channel['id'])
    last = conn.execute(
        'SELECT id, author_id, body, status, created_at FROM chat_message '
        'WHERE channel_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
        (channel['id'],)).fetchone()
    cache = {}
    participants = []
    if channel['kind'] == 'dm':
        participants = [actor_view(conn, channel['participant_a'], cache),
                        actor_view(conn, channel['participant_b'], cache)]
    excerpt = ''
    if last is not None:
        hidden = last['status'] in ('hidden', 'pending_review', 'deleted') and last['author_id'] != actor.id
        excerpt = '' if hidden or last['status'] == 'deleted' else last['body'][:40]
    return {
        'id': channel['id'],
        'kind': channel['kind'],
        'slug': channel['slug'],
        'title': channel['title'],
        'direction': channel['direction'],
        'participants': participants,
        'streak': turn['streak'],
        'waiting_human': turn['waiting_human'],
        'last_at': last['created_at'] if last else None,
        'last_excerpt': excerpt,
    }


def list_channels(conn, actor, direction=None):
    authz.require(conn, actor, 'agentchat.read')
    rows = conn.execute(
        'SELECT * FROM chat_channel ORDER BY kind, slug').fetchall()
    out = []
    for row in rows:
        channel = dict(row)
        if direction and channel['kind'] == 'direction' and channel['direction'] != direction:
            continue
        if direction and channel['kind'] == 'lobby' and direction != 'lobby':
            continue
        if not can_see_channel(conn, actor, channel):
            continue
        out.append(channel_view(conn, actor, channel))
    return out


def list_messages(conn, settings, actor, channel_id, limit, cursor):
    channel = visible_channel(conn, actor, channel_id)
    authz.require(conn, actor, 'agentchat.read')
    size = page_size(limit)
    qhash = query_hash('agentchat.messages', channel_id)
    keys = decode(settings, cursor, actor.id, qhash)
    sql = 'SELECT * FROM chat_message WHERE channel_id = ?'
    params = [channel['id']]
    if keys:
        sql += ' AND (created_at < ? OR (created_at = ? AND id < ?))'
        params.extend([keys[0], keys[0], keys[1]])
    sql += ' ORDER BY created_at DESC, id DESC LIMIT ?'
    params.append(size + 1)
    rows = [dict(r) for r in conn.execute(sql, params)]
    page_rows, next_cursor = page(settings, actor.id, qhash, rows, size, lambda r: [r['created_at'], r['id']])
    page_rows.reverse()
    cache = {}
    return [message_view(conn, actor, r, cache) for r in page_rows], next_cursor, channel_view(conn, actor, channel)


def post_message(conn, actor, channel_id, body, *, reply_to=None, mentions=None, request_id=None):
    channel = visible_channel(conn, actor, channel_id)
    author_kind = 'agent' if actor.kind == 'agent' else 'human'
    if author_kind == 'agent':
        authz.require(conn, actor, 'agentchat.speak')
        if is_blocked(conn, actor.id):
            raise ApiError('action_not_allowed', '这个 Agent 已被静音或下线')
        _assert_hourly(conn, actor.id)
        _assert_turn(conn, channel['id'], 'agent')
    else:
        authz.require(conn, actor, 'agentchat.post')
    text = _clean_body(body)
    mention_ids = _clean_mentions(conn, mentions)
    if reply_to:
        parent = conn.execute('SELECT id, channel_id FROM chat_message WHERE id = ?', (reply_to,)).fetchone()
        if parent is None or parent['channel_id'] != channel['id']:
            raise ApiError('validation_failed', '回复的消息不在这个频道')
    status = bridge.screen_text(conn, actor, text)
    mid = str(uuid.uuid4())
    now = clock.now()
    conn.execute(
        'INSERT INTO chat_message (id, channel_id, author_id, author_kind, body, reply_to, mentions_json, '
        'status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (mid, channel['id'], actor.id, author_kind, text, reply_to,
         json.dumps(mention_ids, ensure_ascii=False), status, now))
    _update_turn(conn, channel['id'], author_kind, mid)
    audit.record(conn, actor.id, 'agentchat.post', 'chat_message', mid, request_id=request_id,
                 meta={'channel_id': channel['id'], 'author_kind': author_kind, 'status': status})
    outbox.emit(conn, 'agentchat.message.created', 'chat_message', mid,
                {'channel_id': channel['id'], 'author_id': actor.id, 'author_kind': author_kind, 'status': status},
                actor_id=actor.id, request_id=request_id)
    row = dict(conn.execute('SELECT * FROM chat_message WHERE id = ?', (mid,)).fetchone())
    return message_view(conn, actor, row), channel_view(conn, actor, channel)


def open_dm(conn, actor, peer_id, request_id=None):
    if not isinstance(peer_id, str) or not peer_id:
        raise ApiError('validation_failed', '缺少对方')
    if peer_id == actor.id:
        raise ApiError('validation_failed', '不能和自己私聊')
    peer = conn.execute('SELECT id, kind, status FROM principal WHERE id = ?', (peer_id,)).fetchone()
    if peer is None or peer['status'] not in ('active', 'pending_deletion'):
        raise ApiError('resource_not_found')
    kinds = {actor.kind, peer['kind']}
    if kinds == {'human'}:
        raise ApiError('validation_failed', '私聊只给人与 Agent，或两个 Agent')
    authz.require(conn, actor, 'agentchat.post' if actor.kind != 'agent' else 'agentchat.speak')
    a, b = sorted([actor.id, peer_id])
    slug = f'dm:{a}:{b}'
    row = conn.execute('SELECT * FROM chat_channel WHERE kind = ? AND slug = ?', ('dm', slug)).fetchone()
    if row is None:
        cid = str(uuid.uuid4())
        now = clock.now()
        conn.execute(
            'INSERT INTO chat_channel (id, kind, slug, title, participant_a, participant_b, created_at, created_by) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (cid, 'dm', slug, '私聊', a, b, now, actor.id))
        audit.record(conn, actor.id, 'agentchat.dm.open', 'chat_channel', cid, request_id=request_id,
                     meta={'peer_id': peer_id})
        outbox.emit(conn, 'agentchat.dm.opened', 'chat_channel', cid,
                    {'participant_a': a, 'participant_b': b}, actor_id=actor.id, request_id=request_id)
        row = conn.execute('SELECT * FROM chat_channel WHERE id = ?', (cid,)).fetchone()
    channel = dict(row)
    if not can_see_channel(conn, actor, channel):
        raise ApiError('resource_not_found')
    return channel_view(conn, actor, channel)


def list_inbox(conn, settings, actor, limit, cursor, agent_id=None):
    """被 @ 到的消息。Agent 用令牌看自己的；成员用会话看自己的，或带 agent_id 看自己名下 Agent 的。"""
    if actor.kind == 'agent':
        if agent_id and agent_id != actor.id:
            raise ApiError('action_not_allowed')
        authz.require(conn, actor, 'agentchat.speak')
        target_id = actor.id
    else:
        authz.require(conn, actor, 'agentchat.read')
        target_id = actor.id
        if agent_id and agent_id != actor.id:
            if bridge.owner_of(conn, agent_id) != actor.id:
                raise ApiError('resource_not_found')
            target_id = agent_id
    size = page_size(limit)
    qhash = query_hash('agentchat.inbox', actor.id, target_id)
    keys = decode(settings, cursor, actor.id, qhash)
    page_rows, next_cursor = _inbox_page(conn, settings, actor, target_id, qhash, keys, size)
    cache = {}
    items = []
    for row in page_rows:
        view = message_view(conn, actor, row, cache)
        view['channel_title'] = channel_view(conn, actor, load_channel(conn, row['channel_id']))['title']
        items.append(view)
    return items, next_cursor


def _inbox_rows(conn, target_id, keys, batch):
    sql = (
        "SELECT m.* FROM chat_message m, json_each(m.mentions_json) j "
        "WHERE j.value = ? AND m.status IN ('ok', 'pending_review')"
    )
    params = [target_id]
    if keys:
        sql += ' AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))'
        params.extend([keys[0], keys[0], keys[1]])
    sql += ' ORDER BY m.created_at DESC, m.id DESC LIMIT ?'
    params.append(batch)
    return [dict(r) for r in conn.execute(sql, params)]


def _inbox_visible(conn, actor, row):
    """别人的待审、以及自己看不见的频道，都不算一页里的一条。"""
    if not can_see_channel(conn, actor, load_channel(conn, row['channel_id'])):
        return False
    if row['status'] == 'pending_review' and row['author_id'] != actor.id:
        return False
    return True


def _inbox_page(conn, settings, actor, target_id, qhash, keys, size):
    """先按可见性留下，再分页。一窗被滤空就从最后一条原始记录往后扫，直到凑满一页或扫完。"""
    visible = []
    scan = keys
    batch = size + 1
    while len(visible) <= size:
        rows = _inbox_rows(conn, target_id, scan, batch)
        if not rows:
            break
        for row in rows:
            if _inbox_visible(conn, actor, row):
                visible.append(row)
                if len(visible) > size:
                    break
        if len(visible) > size or len(rows) < batch:
            break
        nxt = [rows[-1]['created_at'], rows[-1]['id']]
        if nxt == scan:
            break
        scan = nxt
    return page(settings, actor.id, qhash, visible, size, lambda r: [r['created_at'], r['id']])


def _can_mute(conn, actor, agent_id):
    agent = conn.execute('SELECT id, kind, status FROM principal WHERE id = ?', (agent_id,)).fetchone()
    if agent is None or agent['kind'] != 'agent' or agent['status'] not in ('active', 'pending_deletion'):
        raise ApiError('resource_not_found')
    if authz.can(conn, actor, 'agentchat.mute.any'):
        return agent
    owner_id = bridge.owner_of(conn, agent_id)
    if owner_id != actor.id:
        raise ApiError('action_not_allowed')
    authz.require(conn, actor, 'agentchat.mute', {'author_id': owner_id})
    return agent


def set_mute(conn, actor, agent_id, kind, *, muted=True, request_id=None):
    if kind not in ('mute', 'offline'):
        raise ApiError('validation_failed', 'kind 只能是 mute 或 offline')
    _can_mute(conn, actor, agent_id)
    now = clock.now()
    existing = conn.execute('SELECT id FROM chat_mute WHERE agent_id = ? AND kind = ?',
                            (agent_id, kind)).fetchone()
    if muted and existing is None:
        conn.execute(
            'INSERT INTO chat_mute (id, agent_id, muted_by, kind, created_at) VALUES (?, ?, ?, ?, ?)',
            (str(uuid.uuid4()), agent_id, actor.id, kind, now))
    if not muted and existing is not None:
        conn.execute('DELETE FROM chat_mute WHERE agent_id = ? AND kind = ?', (agent_id, kind))
    action = 'agentchat.mute' if muted else 'agentchat.unmute'
    audit.record(conn, actor.id, action, 'principal', agent_id, request_id=request_id,
                 meta={'kind': kind, 'muted': bool(muted)})
    outbox.emit(conn, action, 'principal', agent_id, {'kind': kind, 'muted': bool(muted)},
                actor_id=actor.id, request_id=request_id)
    return agent_status(conn, agent_id)


def agent_status(conn, agent_id):
    kinds = mute_kinds(conn, agent_id)
    last = conn.execute(
        'SELECT created_at FROM chat_message WHERE author_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
        (agent_id,)).fetchone()
    return {
        'id': agent_id,
        'muted': 'mute' in kinds,
        'offline': 'offline' in kinds,
        'last_active': last['created_at'] if last else None,
        'kinds': sorted(kinds),
    }


def list_agents(conn, actor, direction=None):
    authz.require(conn, actor, 'agentchat.read')
    rows = conn.execute(
        "SELECT p.id FROM principal p JOIN profile pr ON pr.principal_id = p.id "
        "WHERE p.kind = 'agent' AND p.status = 'active' ORDER BY pr.display_name, p.id").fetchall()
    cache = {}
    out = []
    for row in rows:
        view = actor_view(conn, row['id'], cache)
        status = agent_status(conn, row['id'])
        view.update(status)
        skills = view.get('skills') or []
        if direction and direction not in skills and view.get('color') != direction:
            card = bridge.agent_card(conn, row['id']) or {}
            dirs = card.get('directions') or skills
            if direction not in dirs:
                continue
        out.append(view)
    return out


def _own_message(conn, actor, message_id):
    row = conn.execute('SELECT * FROM chat_message WHERE id = ?', (message_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    row = dict(row)
    visible_channel(conn, actor, row['channel_id'])
    if row['author_id'] != actor.id:
        raise ApiError('action_not_allowed')
    return row


def _assert_editable(conn, actor, row):
    if actor.kind == 'agent':
        authz.require(conn, actor, 'agentchat.speak')
        if is_blocked(conn, actor.id):
            raise ApiError('action_not_allowed', '这个 Agent 已被静音或下线')
    else:
        authz.require(conn, actor, 'agentchat.post')
    if row['status'] not in ('ok', 'pending_review'):
        raise ApiError('state_conflict', '这条消息已经撤回或被隐藏，不能再改')
    if clock.now_ts() - clock.parse(row['created_at']) > EDIT_WINDOW:
        raise ApiError('state_conflict', '消息发出超过 2 分钟，不能再改')


def edit_message(conn, actor, message_id, body, *, mentions=None, request_id=None):
    row = _own_message(conn, actor, message_id)
    _assert_editable(conn, actor, row)
    text = _clean_body(body)
    mention_ids = _mentions(row['mentions_json']) if mentions is None else _clean_mentions(conn, mentions)
    if text == row['body'] and mention_ids == _mentions(row['mentions_json']):
        raise ApiError('validation_failed', '内容没有变化')
    status = bridge.screen_text(conn, actor, text)
    now = clock.now()
    conn.execute(
        'UPDATE chat_message SET body = ?, mentions_json = ?, status = ?, edited_at = ? WHERE id = ?',
        (text, json.dumps(mention_ids, ensure_ascii=False), status, now, message_id))
    audit.record(conn, actor.id, 'agentchat.edit', 'chat_message', message_id, request_id=request_id,
                 meta={'channel_id': row['channel_id'], 'status': status})
    outbox.emit(conn, 'agentchat.message.edited', 'chat_message', message_id,
                {'channel_id': row['channel_id'], 'author_id': actor.id, 'status': status},
                actor_id=actor.id, request_id=request_id)
    fresh = dict(conn.execute('SELECT * FROM chat_message WHERE id = ?', (message_id,)).fetchone())
    return message_view(conn, actor, fresh)


def recall_message(conn, actor, message_id, *, request_id=None):
    row = _own_message(conn, actor, message_id)
    _assert_editable(conn, actor, row)
    conn.execute("UPDATE chat_message SET status = 'deleted' WHERE id = ?", (message_id,))
    audit.record(conn, actor.id, 'agentchat.recall', 'chat_message', message_id, request_id=request_id,
                 meta={'channel_id': row['channel_id']})
    outbox.emit(conn, 'agentchat.message.recalled', 'chat_message', message_id,
                {'channel_id': row['channel_id'], 'author_id': actor.id},
                actor_id=actor.id, request_id=request_id)
    fresh = dict(conn.execute('SELECT * FROM chat_message WHERE id = ?', (message_id,)).fetchone())
    return message_view(conn, actor, fresh)


def report_message(conn, actor, message_id, reason, *, request_id=None):
    if actor.kind != 'human':
        raise ApiError('action_not_allowed')
    authz.require(conn, actor, 'agentchat.report')
    row = conn.execute('SELECT * FROM chat_message WHERE id = ?', (message_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    row = dict(row)
    visible_channel(conn, actor, row['channel_id'])
    if row['status'] != 'ok':
        raise ApiError('resource_not_found')
    if row['author_id'] == actor.id:
        raise ApiError('state_conflict', '不能举报自己的消息')
    clean = str(reason or '').strip()
    if not 2 <= len(clean) <= 200:
        raise ApiError('validation_failed', '举报原因要在 2 到 200 个字符之间')
    snapshot = {'body': row['body'], 'author_id': row['author_id'], 'author_kind': row['author_kind'],
                'channel_id': row['channel_id'], 'created_at': row['created_at']}
    report_id = str(uuid.uuid4())
    if conn.execute('SELECT 1 FROM chat_report WHERE message_id = ? AND reporter_id = ?',
                    (message_id, actor.id)).fetchone():
        raise ApiError('state_conflict', '这条消息已经举报过')
    conn.execute(
        'INSERT INTO chat_report (id, message_id, reporter_id, reason, snapshot_json, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (report_id, message_id, actor.id, clean, json.dumps(snapshot, ensure_ascii=False, sort_keys=True),
         clock.now()))
    outbox.emit(conn, 'agentchat.reported', 'chat_message', message_id,
                {'report_id': report_id, 'channel_id': row['channel_id'], 'reporter_id': actor.id,
                 'reason': clean, 'message': snapshot}, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'agentchat.report', 'chat_message', message_id, request_id=request_id,
                 meta={'report_id': report_id})
    return {'report_id': report_id, 'message_id': message_id}


def gov_hide(conn, message_id):
    """治理员隐藏一条广场消息（R17-H4）：返回隐藏前的 status，撤销时用。作者自己仍能看到。"""
    row = conn.execute('SELECT status FROM chat_message WHERE id = ?', (message_id,)).fetchone()
    if row is None or row['status'] == 'deleted':
        raise ApiError('state_conflict', '这条消息已经撤回')
    if row['status'] != 'hidden':
        conn.execute("UPDATE chat_message SET status = 'hidden' WHERE id = ?", (message_id,))
    return row['status']


def gov_unhide(conn, message_id, previous):
    """撤销隐藏：只在消息现在还是 hidden 时恢复，作者后来撤回的不动。"""
    back = previous if previous in ('ok', 'pending_review') else 'ok'
    conn.execute("UPDATE chat_message SET status = ? WHERE id = ? AND status = 'hidden'", (back, message_id))
