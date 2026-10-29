"""Private-message domain logic.

All message reads start from an active ``dm_member`` row. Platform roles do not
grant access to thread bodies. Social checks are intentionally late imports so
SOCIAL-1 can land independently; missing social policy fails closed.
"""

import json
import re
import uuid

from app import audit, clock, flags, outbox, pagination
from app.authz import require
from app.errors import ApiError

MAX_MEMBERS = 20
MAX_TEXT = 4000
NEW_ACCOUNT_SECONDS = 7 * 86400
NEW_MESSAGE_LIMIT = 10
MESSAGE_LIMIT = 30
EDIT_WINDOW = 120  # 和撤回同一个 2 分钟窗口，保守值
NEW_THREAD_LIMIT = 2
THREAD_LIMIT = 10
REF_TYPES = {'knowledge', 'work', 'market', 'event'}
THREAD_VISIBLE = "m.principal_id = ? AND m.state = 'active' AND t.request_state != 'declined'"
ASSET = re.compile(r'(?:assets/[a-zA-Z0-9_./-]+|media:[a-zA-Z0-9-]{8,80})\Z')


def gate(conn):
    flags.gate(conn, 'dm.enabled')


def _social_blocked(conn, a, b):
    try:
        from modules.social import service as social
    except ImportError:
        return False
    return bool(social.blocked(conn, a, b))


def _social_can_see(conn, viewer, owner, scope):
    try:
        from modules.social import service as social
    except ImportError:
        return False
    return bool(social.can_see(conn, viewer, owner, scope))


def _relation(conn, sender_id, recipient_id):
    friends = _social_can_see(conn, sender_id, recipient_id, 'friends')
    following = friends or _social_can_see(conn, sender_id, recipient_id, 'following')
    return following, friends


def _principal(conn, principal_id):
    row = conn.execute(
        'SELECT p.id, p.status, p.created_at, pr.display_name, pr.avatar_ref, pr.level '
        'FROM principal p JOIN profile pr ON pr.principal_id = p.id WHERE p.id = ?',
        (principal_id,),
    ).fetchone()
    if row is None or row['status'] not in ('active', 'pending_deletion'):
        raise ApiError('resource_not_found')
    return row


def _is_new(row):
    return clock.parse(row['created_at']) > clock.now_ts() - NEW_ACCOUNT_SECONDS


def _fixed_limit(conn, key, maximum, seconds):
    now = int(clock.now_ts())
    start = now - (now % seconds)
    row = conn.execute('SELECT window_start, count FROM rate_bucket WHERE key = ?', (key,)).fetchone()
    count = 0 if row is None or row['window_start'] != start else row['count']
    retry = start + seconds - now
    if count >= maximum:
        raise ApiError('rate_limited', headers={'Retry-After': str(max(1, retry))},
                       retry_after_seconds=max(1, retry))
    conn.execute(
        'INSERT INTO rate_bucket (key, window_start, count) VALUES (?, ?, 1) '
        'ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, '
        'count = CASE WHEN rate_bucket.window_start = excluded.window_start '
        'THEN rate_bucket.count + 1 ELSE 1 END',
        (key, start),
    )


def _thread(conn, actor, thread_id):
    require(conn, actor, 'dm.read')
    row = conn.execute(
        'SELECT t.* FROM dm_thread t JOIN dm_member m ON m.thread_id = t.id '
        f'WHERE t.id = ? AND {THREAD_VISIBLE}',
        (thread_id, actor.id),
    ).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _members(conn, thread_id):
    return conn.execute(
        'SELECT m.*, p.status, pr.display_name, pr.avatar_ref, pr.level '
        'FROM dm_member m JOIN principal p ON p.id = m.principal_id '
        'JOIN profile pr ON pr.principal_id = p.id '
        "WHERE m.thread_id = ? AND m.state = 'active' ORDER BY m.joined_at, m.principal_id",
        (thread_id,),
    ).fetchall()


def _participant_views(conn, thread_id, actor_id):
    result = []
    for row in _members(conn, thread_id):
        blocked = row['principal_id'] != actor_id and _social_blocked(conn, actor_id, row['principal_id'])
        result.append({
            'id': row['principal_id'],
            'name': row['display_name'],
            'avatar_ref': row['avatar_ref'],
            'level': row['level'],
            'role': row['role'],
            'status': row['status'],
            'blocked': blocked,
            'online': None,
        })
    return result


def _json(value, default=None):
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def _message_view(row):
    recalled = bool(row['recalled_at'])
    return {
        'id': row['id'],
        'thread_id': row['thread_id'],
        'seq': row['seq'],
        'sender_id': row['sender_id'],
        'sender_name': row['sender_name'],
        'kind': 'text' if recalled else row['kind'],
        'text': '一条消息已撤回' if recalled else (row['text'] or ''),
        'image_ref': None if recalled else row['image_ref'],
        'sticker_ref': None if recalled else row['sticker_ref'],
        'ref': None if recalled else _json(row['ref_json']),
        'reply_to': None if recalled else row['reply_to'],
        'recalled': recalled,
        'edited_at': None if recalled else row['edited_at'],
        'created_at': row['created_at'],
    }


def _message(conn, actor, message_id):
    row = conn.execute(
        'SELECT msg.*, pr.display_name AS sender_name FROM dm_message msg '
        'JOIN dm_member member ON member.thread_id = msg.thread_id '
        'JOIN profile pr ON pr.principal_id = msg.sender_id '
        "WHERE msg.id = ? AND member.principal_id = ? AND member.state = 'active'",
        (message_id, actor.id),
    ).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _validate_asset(value, *, sticker=False):
    if value is None:
        return None
    value = str(value).strip()
    if not ASSET.fullmatch(value) or '..' in value or (sticker and not value.startswith('assets/mascot/')):
        raise ApiError('validation_failed', '图片或贴纸引用无效')
    return value


def _validate_ref(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {'type', 'id', 'title', 'subtitle', 'href'}:
        raise ApiError('validation_failed', '引用卡片格式不正确')
    if value.get('type') not in REF_TYPES or not str(value.get('id', '')).strip():
        raise ApiError('validation_failed', '引用卡片类型或对象无效')
    title = str(value.get('title', '')).strip()
    subtitle = str(value.get('subtitle', '')).strip()
    href = str(value.get('href', '')).strip()
    if not title or len(title) > 120 or len(subtitle) > 160:
        raise ApiError('validation_failed', '引用卡片文字过长')
    if href and not href.startswith('#/'):
        raise ApiError('validation_failed', '引用卡片链接必须是站内地址')
    return {'type': value['type'], 'id': str(value['id']), 'title': title,
            'subtitle': subtitle, 'href': href}


def _contact_state(conn, sender_id, recipient_id):
    if _social_blocked(conn, sender_id, recipient_id):
        raise ApiError('action_not_allowed', '对方暂时无法接收你的消息')
    setting = conn.execute('SELECT contact_policy FROM dm_setting WHERE principal_id = ?',
                           (recipient_id,)).fetchone()
    policy = setting['contact_policy'] if setting else 'following'
    following, friends = _relation(conn, sender_id, recipient_id)
    allowed = (policy == 'everyone' or (policy == 'following' and following)
               or (policy == 'friends' and friends))
    if not allowed:
        raise ApiError('action_not_allowed', '对方暂时无法接收新的私信')
    return 'accepted' if following or friends else 'pending'


def _thread_view(conn, actor_id, row):
    pref = conn.execute('SELECT pinned_at, muted FROM dm_thread_pref WHERE thread_id = ? AND principal_id = ?',
                        (row['id'], actor_id)).fetchone()
    read = conn.execute('SELECT last_seq FROM dm_read WHERE thread_id = ? AND principal_id = ?',
                        (row['id'], actor_id)).fetchone()
    last = conn.execute(
        'SELECT msg.*, pr.display_name AS sender_name FROM dm_message msg '
        'JOIN profile pr ON pr.principal_id = msg.sender_id '
        'LEFT JOIN dm_message_hidden h ON h.message_id = msg.id AND h.principal_id = ? '
        'WHERE msg.thread_id = ? AND h.message_id IS NULL ORDER BY msg.seq DESC LIMIT 1',
        (actor_id, row['id']),
    ).fetchone()
    unread = max(0, row['last_seq'] - (read['last_seq'] if read else 0))
    return {
        'id': row['id'], 'kind': row['kind'], 'title': row['title'],
        'request_state': row['request_state'],
        'request_recipient_id': row['request_recipient_id'],
        'ref': _json(row['ref_json']), 'last_seq': row['last_seq'],
        'updated_at': row['updated_at'], 'unread': unread,
        'pinned': bool(pref and pref['pinned_at']), 'muted': bool(pref and pref['muted']),
        'participants': _participant_views(conn, row['id'], actor_id),
        'last_message': _message_view(last) if last else None,
    }


def list_threads(conn, actor, request_only=False):
    require(conn, actor, 'dm.read')
    where = " AND t.request_state = 'pending' AND t.request_recipient_id = ?" if request_only else ''
    params = (actor.id, actor.id) if request_only else (actor.id,)
    rows = conn.execute(
        'SELECT t.* FROM dm_thread t JOIN dm_member m ON m.thread_id = t.id '
        f'WHERE {THREAD_VISIBLE}' + where +
        ' ORDER BY EXISTS (SELECT 1 FROM dm_thread_pref p WHERE p.thread_id = t.id '
        'AND p.principal_id = ? AND p.pinned_at IS NOT NULL) DESC, t.updated_at DESC, t.id',
        params + (actor.id,),
    ).fetchall()
    return [_thread_view(conn, actor.id, row) for row in rows]


def get_thread(conn, actor, thread_id):
    return _thread_view(conn, actor.id, _thread(conn, actor, thread_id))


def create_thread(conn, actor, peers, ref=None, title=None, request_id=None):
    require(conn, actor, 'dm.thread.create')
    own = _principal(conn, actor.id)
    peer_ids = list(dict.fromkeys(str(value).strip() for value in peers if str(value).strip()))
    if actor.id in peer_ids:
        peer_ids.remove(actor.id)
    if not peer_ids or len(peer_ids) + 1 > MAX_MEMBERS:
        raise ApiError('validation_failed', f'会话人数必须在 2 到 {MAX_MEMBERS} 人之间')
    peer_rows = [_principal(conn, peer) for peer in peer_ids]
    ref = _validate_ref(ref)
    now = clock.now()
    kind = 'direct' if len(peer_ids) == 1 else 'group'
    if kind == 'direct':
        direct_key = ':'.join(sorted((actor.id, peer_ids[0])))
        existing = conn.execute('SELECT * FROM dm_thread WHERE direct_key = ?', (direct_key,)).fetchone()
        if existing is not None:
            return _thread_view(conn, actor.id, _thread(conn, actor, existing['id'])), False
        state = _contact_state(conn, actor.id, peer_ids[0])
        recipient = peer_ids[0] if state == 'pending' else None
    else:
        direct_key = None
        recipient = None
        state = 'accepted'
        for peer in peer_ids:
            if _contact_state(conn, actor.id, peer) != 'accepted':
                raise ApiError('action_not_allowed', '小群只能邀请已建立联系的成员')
    _fixed_limit(conn, f'dm:thread:{actor.id}', NEW_THREAD_LIMIT if _is_new(own) else THREAD_LIMIT, 86400)
    thread_id = str(uuid.uuid4())
    clean_title = str(title or '').strip()
    if kind == 'group' and (not clean_title or len(clean_title) > 60):
        raise ApiError('validation_failed', '小群名称要在 1 到 60 个字符之间')
    conn.execute(
        'INSERT INTO dm_thread (id, kind, direct_key, title, created_by, request_state, request_recipient_id, '
        'ref_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (thread_id, kind, direct_key, clean_title or None, actor.id, state, recipient,
         json.dumps(ref, ensure_ascii=False, sort_keys=True) if ref else None, now, now),
    )
    for principal_id in [actor.id, *peer_ids]:
        conn.execute('INSERT INTO dm_member (thread_id, principal_id, role, joined_at) VALUES (?, ?, ?, ?)',
                     (thread_id, principal_id, 'owner' if principal_id == actor.id else 'member', now))
        conn.execute('INSERT INTO dm_read (thread_id, principal_id, last_seq, updated_at) VALUES (?, ?, 0, ?)',
                     (thread_id, principal_id, now))
    audit.record(conn, actor.id, 'dm.thread.created', 'dm_thread', thread_id, request_id=request_id,
                 meta={'kind': kind, 'member_count': len(peer_rows) + 1, 'request_state': state})
    return _thread_view(conn, actor.id, conn.execute('SELECT * FROM dm_thread WHERE id = ?', (thread_id,)).fetchone()), True


def list_messages(conn, settings, actor, thread_id, limit=None, cursor=None):
    thread = _thread(conn, actor, thread_id)
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('dm.messages', thread_id)
    after = pagination.decode(settings, cursor, actor.id, qhash)
    where = ' AND msg.seq < ?' if after else ''
    params = [actor.id, thread_id]
    if after:
        params.append(after[0])
    rows = conn.execute(
        'SELECT msg.*, pr.display_name AS sender_name FROM dm_message msg '
        'JOIN profile pr ON pr.principal_id = msg.sender_id '
        'LEFT JOIN dm_message_hidden h ON h.message_id = msg.id AND h.principal_id = ? '
        'WHERE msg.thread_id = ? AND h.message_id IS NULL' + where +
        ' ORDER BY msg.seq DESC, msg.id DESC LIMIT ?', (*params, size + 1),
    ).fetchall()
    rows, next_cursor = pagination.page(settings, actor.id, qhash, rows, size, lambda item: [item['seq']])
    return [_message_view(row) for row in reversed(rows)], next_cursor, _thread_view(conn, actor.id, thread)


def send_message(conn, actor, thread_id, *, text=None, image_ref=None, sticker_ref=None,
                 ref=None, reply_to=None, request_id=None):
    require(conn, actor, 'dm.message.send')
    thread = _thread(conn, actor, thread_id)
    if thread['request_state'] == 'declined':
        raise ApiError('state_conflict', '消息请求已被拒绝')
    others = [row['principal_id'] for row in _members(conn, thread_id) if row['principal_id'] != actor.id]
    if any(_social_blocked(conn, actor.id, other) for other in others):
        raise ApiError('action_not_allowed', '对方暂时无法接收你的消息')
    if thread['request_state'] == 'pending':
        if actor.id != thread['created_by']:
            raise ApiError('state_conflict', '接受消息请求后才能回复')
        count = conn.execute('SELECT count(*) FROM dm_message WHERE thread_id = ?', (thread_id,)).fetchone()[0]
        if count >= 1:
            raise ApiError('state_conflict', '对方接受前只能发送一条消息')
    sender = _principal(conn, actor.id)
    _fixed_limit(conn, f'dm:message:{actor.id}', NEW_MESSAGE_LIMIT if _is_new(sender) else MESSAGE_LIMIT, 60)
    clean_text = str(text or '').strip()
    if len(clean_text) > MAX_TEXT:
        raise ApiError('validation_failed', f'消息不能超过 {MAX_TEXT} 个字符')
    image_ref = _validate_asset(image_ref)
    sticker_ref = _validate_asset(sticker_ref, sticker=True)
    ref = _validate_ref(ref)
    if not any((clean_text, image_ref, sticker_ref, ref)):
        raise ApiError('validation_failed', '消息不能为空')
    if reply_to:
        reply = conn.execute('SELECT thread_id FROM dm_message WHERE id = ?', (reply_to,)).fetchone()
        if reply is None or reply['thread_id'] != thread_id:
            raise ApiError('validation_failed', '引用的消息不在当前会话')
    kind_parts = [bool(clean_text), bool(image_ref), bool(sticker_ref), bool(ref)]
    if sum(kind_parts) > 1:
        kind = 'mixed'
    else:
        kind = 'text' if clean_text else 'image' if image_ref else 'sticker' if sticker_ref else 'ref'
    seq = thread['last_seq'] + 1
    message_id = str(uuid.uuid4())
    now = clock.now()
    conn.execute(
        'INSERT INTO dm_message (id, thread_id, seq, sender_id, kind, text, image_ref, sticker_ref, ref_json, '
        'reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (message_id, thread_id, seq, actor.id, kind, clean_text or None, image_ref, sticker_ref,
         json.dumps(ref, ensure_ascii=False, sort_keys=True) if ref else None, reply_to, now),
    )
    conn.execute('UPDATE dm_thread SET last_seq = ?, updated_at = ? WHERE id = ?', (seq, now, thread_id))
    conn.execute('UPDATE dm_read SET last_seq = ?, updated_at = ? WHERE thread_id = ? AND principal_id = ?',
                 (seq, now, thread_id, actor.id))
    for recipient_id in others:
        pref = conn.execute('SELECT muted FROM dm_thread_pref WHERE thread_id = ? AND principal_id = ?',
                            (thread_id, recipient_id)).fetchone()
        if not pref or not pref['muted']:
            outbox.emit(conn, 'notify.system.dm', 'dm_message', message_id,
                        {'recipient_id': recipient_id, 'message': '你有一条新私信',
                         'target_id': thread_id}, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'dm.message.sent', 'dm_message', message_id, request_id=request_id,
                 meta={'thread_id': thread_id, 'kind': kind})
    row = conn.execute(
        'SELECT msg.*, pr.display_name AS sender_name FROM dm_message msg '
        'JOIN profile pr ON pr.principal_id = msg.sender_id WHERE msg.id = ?', (message_id,)).fetchone()
    return _message_view(row)


def mark_read(conn, actor, thread_id, seq=None, request_id=None):
    thread = _thread(conn, actor, thread_id)
    target = thread['last_seq'] if seq is None else int(seq)
    if target < 0 or target > thread['last_seq']:
        raise ApiError('validation_failed', '已读位置无效')
    now = clock.now()
    conn.execute(
        'INSERT INTO dm_read (thread_id, principal_id, last_seq, updated_at) VALUES (?, ?, ?, ?) '
        'ON CONFLICT(thread_id, principal_id) DO UPDATE SET last_seq = max(dm_read.last_seq, excluded.last_seq), '
        'updated_at = excluded.updated_at', (thread_id, actor.id, target, now))
    audit.record(conn, actor.id, 'dm.thread.read', 'dm_thread', thread_id, request_id=request_id,
                 meta={'last_seq': target})
    return {'thread_id': thread_id, 'last_seq': target}


def decide_request(conn, actor, thread_id, decision, request_id=None):
    thread = _thread(conn, actor, thread_id)
    if thread['request_state'] != 'pending' or thread['request_recipient_id'] != actor.id:
        raise ApiError('resource_not_found')
    state = 'accepted' if decision == 'accept' else 'declined'
    conn.execute('UPDATE dm_thread SET request_state = ?, request_recipient_id = NULL, updated_at = ? WHERE id = ?',
                 (state, clock.now(), thread_id))
    audit.record(conn, actor.id, f'dm.request.{state}', 'dm_thread', thread_id, request_id=request_id)
    return {'id': thread_id, 'request_state': state}


def set_preference(conn, actor, thread_id, *, pinned=None, muted=None, request_id=None):
    _thread(conn, actor, thread_id)
    old = conn.execute('SELECT pinned_at, muted FROM dm_thread_pref WHERE thread_id = ? AND principal_id = ?',
                       (thread_id, actor.id)).fetchone()
    pin = (clock.now() if pinned else None) if pinned is not None else (old['pinned_at'] if old else None)
    mute = int(bool(muted)) if muted is not None else int(bool(old and old['muted']))
    now = clock.now()
    conn.execute(
        'INSERT INTO dm_thread_pref (thread_id, principal_id, pinned_at, muted, updated_at) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT(thread_id, principal_id) DO UPDATE SET pinned_at = excluded.pinned_at, '
        'muted = excluded.muted, updated_at = excluded.updated_at',
        (thread_id, actor.id, pin, mute, now))
    audit.record(conn, actor.id, 'dm.thread.preference', 'dm_thread', thread_id, request_id=request_id,
                 meta={'pinned': bool(pin), 'muted': bool(mute)})
    return {'id': thread_id, 'pinned': bool(pin), 'muted': bool(mute)}


def recall_message(conn, actor, message_id, request_id=None):
    row = _message(conn, actor, message_id)
    if row['sender_id'] != actor.id:
        raise ApiError('action_not_allowed')
    if row['recalled_at']:
        raise ApiError('state_conflict', '消息已经撤回')
    if clock.now_ts() - clock.parse(row['created_at']) > 120:
        raise ApiError('state_conflict', '消息发出超过 2 分钟，不能撤回')
    now = clock.now()
    conn.execute('UPDATE dm_message SET recalled_at = ? WHERE id = ?', (now, message_id))
    audit.record(conn, actor.id, 'dm.message.recalled', 'dm_message', message_id, request_id=request_id)
    return {'id': message_id, 'recalled': True}


def edit_message(conn, actor, message_id, text, request_id=None):
    require(conn, actor, 'dm.message.send')
    row = _message(conn, actor, message_id)
    if row['sender_id'] != actor.id:
        raise ApiError('action_not_allowed')
    if row['recalled_at']:
        raise ApiError('state_conflict', '消息已经撤回，不能再改')
    # 被对方拉黑后不能再改：改动会让对方在拉黑后仍收到你的新内容
    if any(_social_blocked(conn, actor.id, member['principal_id'])
           for member in _members(conn, row['thread_id']) if member['principal_id'] != actor.id):
        raise ApiError('action_not_allowed', '对方暂时无法接收你的消息')
    if row['kind'] not in ('text', 'mixed') or not row['text']:
        raise ApiError('state_conflict', '只能改文字消息')
    if clock.now_ts() - clock.parse(row['created_at']) > EDIT_WINDOW:
        raise ApiError('state_conflict', '消息发出超过 2 分钟，不能再改')
    clean = str(text or '').strip()
    if not clean:
        raise ApiError('validation_failed', '消息不能为空')
    if len(clean) > MAX_TEXT:
        raise ApiError('validation_failed', f'消息不能超过 {MAX_TEXT} 个字符')
    if clean == row['text']:
        raise ApiError('validation_failed', '内容没有变化')
    now = clock.now()
    conn.execute('UPDATE dm_message SET text = ?, edited_at = ? WHERE id = ?', (clean, now, message_id))
    audit.record(conn, actor.id, 'dm.message.edited', 'dm_message', message_id, request_id=request_id)
    fresh = conn.execute(
        'SELECT msg.*, pr.display_name AS sender_name FROM dm_message msg '
        'JOIN profile pr ON pr.principal_id = msg.sender_id WHERE msg.id = ?', (message_id,)).fetchone()
    return _message_view(fresh)


def delete_for_self(conn, actor, message_id, request_id=None):
    _message(conn, actor, message_id)
    conn.execute('INSERT OR IGNORE INTO dm_message_hidden (message_id, principal_id, hidden_at) VALUES (?, ?, ?)',
                 (message_id, actor.id, clock.now()))
    audit.record(conn, actor.id, 'dm.message.deleted_for_self', 'dm_message', message_id,
                 request_id=request_id)
    return {'id': message_id, 'deleted_for_self': True}


def report_message(conn, actor, message_id, reason, request_id=None):
    require(conn, actor, 'dm.report')
    row = _message(conn, actor, message_id)
    if row['sender_id'] == actor.id:
        raise ApiError('state_conflict', '不能举报自己的消息')
    if row['recalled_at']:
        raise ApiError('state_conflict', '已撤回的消息不能举报')
    clean_reason = str(reason or '').strip()
    if not 2 <= len(clean_reason) <= 200:
        raise ApiError('validation_failed', '举报原因要在 2 到 200 个字符之间')
    snapshot = {
        'kind': row['kind'], 'text': row['text'], 'image_ref': row['image_ref'],
        'sticker_ref': row['sticker_ref'], 'ref': _json(row['ref_json']),
        'sender_id': row['sender_id'], 'created_at': row['created_at'],
    }
    report_id = str(uuid.uuid4())
    try:
        conn.execute('INSERT INTO dm_report (id, message_id, reporter_id, reason, snapshot_json, created_at) '
                     'VALUES (?, ?, ?, ?, ?, ?)',
                     (report_id, message_id, actor.id, clean_reason,
                      json.dumps(snapshot, ensure_ascii=False, sort_keys=True), clock.now()))
    except Exception as exc:
        if 'UNIQUE constraint failed' in str(exc):
            raise ApiError('state_conflict', '这条消息已经举报过') from None
        raise
    outbox.emit(conn, 'dm.reported', 'dm_message', message_id,
                {'report_id': report_id, 'thread_id': row['thread_id'], 'reporter_id': actor.id,
                 'reason': clean_reason, 'message': snapshot}, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'dm.message.reported', 'dm_message', message_id, request_id=request_id,
                 meta={'report_id': report_id})
    return {'report_id': report_id, 'message_id': message_id}


def get_settings(conn, actor):
    require(conn, actor, 'dm.settings')
    row = conn.execute('SELECT contact_policy FROM dm_setting WHERE principal_id = ?', (actor.id,)).fetchone()
    return {'contact_policy': row['contact_policy'] if row else 'following'}


def put_settings(conn, actor, contact_policy, request_id=None):
    require(conn, actor, 'dm.settings')
    if contact_policy not in {'everyone', 'following', 'friends', 'closed'}:
        raise ApiError('validation_failed', '私信范围无效')
    now = clock.now()
    conn.execute('INSERT INTO dm_setting (principal_id, contact_policy, updated_at) VALUES (?, ?, ?) '
                 'ON CONFLICT(principal_id) DO UPDATE SET contact_policy = excluded.contact_policy, '
                 'updated_at = excluded.updated_at', (actor.id, contact_policy, now))
    audit.record(conn, actor.id, 'dm.settings.updated', 'principal', actor.id, request_id=request_id,
                 meta={'contact_policy': contact_policy})
    return {'contact_policy': contact_policy}


def unread_count(conn, actor):
    require(conn, actor, 'dm.read')
    row = conn.execute(
        'SELECT coalesce(sum(max(0, t.last_seq - coalesce(r.last_seq, 0))), 0) '
        'FROM dm_thread t JOIN dm_member m ON m.thread_id = t.id '
        'LEFT JOIN dm_read r ON r.thread_id = t.id AND r.principal_id = ? '
        f'WHERE {THREAD_VISIBLE}',
        (actor.id, actor.id),
    ).fetchone()
    return int(row[0])


def purge(conn, principal_id):
    replacement = '已注销成员的消息'
    conn.execute(
        "UPDATE dm_message SET kind = 'text', text = ?, image_ref = NULL, sticker_ref = NULL, "
        'ref_json = NULL, reply_to = NULL, recalled_at = NULL, edited_at = NULL WHERE sender_id = ?',
        (replacement, principal_id))
    conn.execute('DELETE FROM dm_message_hidden WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM dm_read WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM dm_thread_pref WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM dm_setting WHERE principal_id = ?', (principal_id,))
