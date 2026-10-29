"""导出 zip（异步，一次性链接 24 小时过期）、注销到期后的模块清理、头像。导出和注销冷静期的入口仍是核心 /api/me/*。"""
import hmac
import io
import json
import re
import uuid
import zipfile

from app import accounts, audit, clock, flags, outbox, security
from app.authz import Actor, require
from app.errors import ApiError

from modules.media import service as media

MIGRATION = 'account/account_0001.sql'
EXPORT_KIND = 'account_export'
EXPORT_TTL = 24 * 3600
EXPORTS_PER_DAY = 3
HOLDS = []
README = """智能体先锋队 · 个人数据导出

export.json      账号、你写的全部对象和全部版本、你的贡献流水、你操作的审计事件，以及各模块登记的数据
                 （content：反应、收藏、有用、关注、回复关系；media：上传记录和资产元数据；
                 account_related_audit：别人或系统对你的账号、你的内容做过的处理，处理人不具名）
originals/       你上传的原始文件，按资产编号命名，保持上传时的原样（含原始元数据，只给你本人）

这个包只含你本人的数据；别人的正文、别人的引用快照、别人的身份不在里面。
"""


def installed(conn):
    return conn.execute('SELECT 1 FROM schema_migration WHERE id = ?', (MIGRATION,)).fetchone() is not None


def register_hold(fn):
    """GOV-1 等模块登记保全：fn(conn, principal_id) -> bool，为真时不物理删除正文版本。"""
    if fn not in HOLDS:
        HOLDS.append(fn)


def actor_for(conn, principal_id):
    row = conn.execute('SELECT p.id, p.kind, p.status, pr.level, t.enabled_at FROM principal p JOIN profile pr ON '
                       'pr.principal_id = p.id LEFT JOIN totp_secret t ON t.principal_id = p.id WHERE p.id = ?',
                       (principal_id,)).fetchone()
    roles = frozenset(r[0] for r in conn.execute('SELECT role FROM role_assignment WHERE principal_id = ? AND '
                                                 'space_id IS NULL AND revoked_at IS NULL', (principal_id,)))
    return Actor(id=row['id'], level=row['level'], roles=roles, status=row['status'],
                 totp_enabled=row['enabled_at'] is not None, kind=row['kind'])


def related_audit(conn, actor):
    """别人或系统对我的账号、我的内容做过的处理；处理人不具名，只标 other / system。"""
    rows = conn.execute(
        "SELECT occurred_at, actor_id, action, target_type, target_id, outcome, reason_code FROM audit_event "
        "WHERE (actor_id IS NULL OR actor_id != :me) AND ((target_type = 'principal' AND target_id = :me) OR "
        "(target_type = 'object' AND target_id IN (SELECT id FROM object_head WHERE author_id = :me))) "
        'ORDER BY occurred_at DESC', {'me': actor.id}).fetchall()
    return [{**{k: r[k] for k in r.keys() if k != 'actor_id'}, 'by': 'system' if r['actor_id'] is None else 'other'}
            for r in rows]


def _expire(conn, storage, principal_id=None):
    sql = "SELECT id, file_key FROM account_export WHERE state = 'ready' AND expires_at <= ?"
    params = [clock.now()]
    if principal_id:
        sql += ' AND principal_id = ?'
        params.append(principal_id)
    for row in conn.execute(sql, params).fetchall():
        if row['file_key'] and storage is None:
            raise RuntimeError('storage unavailable for export cleanup')
        if storage is not None and row['file_key']:
            storage.delete(row['file_key'])
        conn.execute("UPDATE account_export SET state = 'expired', file_key = NULL WHERE id = ?", (row['id'],))


def request_export(conn, storage, actor, request_id=None):
    _expire(conn, storage, actor.id)
    day = clock.now()[:10]
    used = conn.execute('SELECT count(*) FROM account_export WHERE principal_id = ? AND day = ?',
                        (actor.id, day)).fetchone()[0]
    if used >= EXPORTS_PER_DAY:
        retry = int(86400 - clock.now_ts() % 86400) + 1
        raise ApiError('rate_limited', f'每天最多导出 {EXPORTS_PER_DAY} 次', headers={'Retry-After': str(retry)},
                       retry_after_seconds=retry)
    media.remember_storage(conn, storage)
    export_id, token = str(uuid.uuid4()), security.new_token()
    conn.execute("INSERT INTO account_export (id, principal_id, state, token_hash, day, created_at) "
                 "VALUES (?, ?, 'queued', ?, ?, ?)", (export_id, actor.id, security.token_hash(token), day, clock.now()))
    outbox.emit(conn, 'account.export_requested', 'account_export', export_id, {}, actor_id=actor.id,
                request_id=request_id)
    audit.record(conn, actor.id, 'account.export_requested', 'principal', actor.id, request_id=request_id,
                 meta={'export_id': export_id})
    return export_id, token


def build_zip(conn, storage, actor):
    data = accounts.export(conn, actor)
    buf = io.BytesIO()
    missing = []
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('README.txt', README, compress_type=zipfile.ZIP_DEFLATED)
        for row in media.originals(conn, actor.id):
            ext = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
                   'image/avif': 'avif', 'text/html': 'html'}.get(row['mime'], 'bin')
            try:
                z.writestr(f'originals/{row["id"]}.{ext}', storage.read(row['raw_key']),
                           compress_type=zipfile.ZIP_STORED)
            except FileNotFoundError:
                missing.append(row['id'])
        data['missing_originals'] = missing
        z.writestr('export.json', json.dumps(data, ensure_ascii=False, indent=1, default=str),
                   compress_type=zipfile.ZIP_DEFLATED)
    return buf.getvalue()


def on_export_requested(conn, event):
    if not installed(conn):
        return
    row = conn.execute('SELECT * FROM account_export WHERE id = ?', (event['aggregate_id'],)).fetchone()
    if row is None or row['state'] != 'queued':
        return
    storage = media.storage_for(conn)
    if storage is None:
        raise RuntimeError('storage root not recorded')
    principal = conn.execute('SELECT status FROM principal WHERE id = ?', (row['principal_id'],)).fetchone()
    if principal['status'] not in ('active', 'pending_deletion'):
        conn.execute("UPDATE account_export SET state = 'failed' WHERE id = ?", (row['id'],))
        return
    blob = build_zip(conn, storage, actor_for(conn, row['principal_id']))
    stored = storage.put(blob, EXPORT_KIND)
    ready = clock.now_ts()
    conn.execute("UPDATE account_export SET state = 'ready', file_key = ?, bytes = ?, ready_at = ?, expires_at = ? "
                 'WHERE id = ?', (stored.key, stored.size, clock.iso(ready), clock.iso(ready + EXPORT_TTL), row['id']))
    outbox.emit(conn, 'account.export_ready', 'account_export', row['id'], {}, actor_id=row['principal_id'])


def export_status(conn, actor, export_id):
    row = conn.execute('SELECT * FROM account_export WHERE id = ? AND principal_id = ?',
                       (export_id, actor.id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    state = row['state']
    if state == 'ready' and row['expires_at'] <= clock.now():
        state = 'expired'
    return {'id': row['id'], 'state': state, 'bytes': row['bytes'], 'created_at': row['created_at'],
            'ready_at': row['ready_at'], 'expires_at': row['expires_at'], 'downloaded_at': row['downloaded_at']}


def take_download(db, storage, actor, export_id, token):
    with db.write() as conn:
        row = conn.execute('SELECT * FROM account_export WHERE id = ? AND principal_id = ?',
                           (export_id, actor.id)).fetchone()
        if (row is None or not token
                or not hmac.compare_digest(row['token_hash'], security.token_hash(token))):
            raise ApiError('resource_not_found')
        if row['state'] == 'queued':
            raise ApiError('state_conflict', '导出包还在生成')
        if row['state'] != 'ready' or row['expires_at'] <= clock.now():
            _expire(conn, storage, actor.id)
            raise ApiError('resource_not_found')
        blob = storage.read(row['file_key'])
        conn.execute("UPDATE account_export SET state = 'downloaded', downloaded_at = ?, file_key = NULL WHERE id = ?",
                     (clock.now(), export_id))
        audit.record(conn, actor.id, 'account.export_downloaded', 'principal', actor.id,
                     meta={'export_id': export_id})
    storage.delete(row['file_key'])
    return blob


def deletion_status(conn, actor, cooldown_days):
    row = conn.execute('SELECT status, delete_requested_at FROM principal WHERE id = ?', (actor.id,)).fetchone()
    data = {'status': row['status'], 'requested_at': row['delete_requested_at'], 'purge_after': None,
            'cooldown_days': cooldown_days}
    if row['delete_requested_at']:
        data['purge_after'] = clock.iso(clock.parse(row['delete_requested_at']) + cooldown_days * 86400)
    data['effects'] = [
        '冷静期内可以随时撤销，账号照常登录、可以导出；冷静期内不能发帖和互动',
        '到期后删除：登录凭据、会话、动态验证码、头像、收藏、关注、上传的原图和衍生图、导出包',
        '到期后草稿、指定人可见和空间内内容撤回；草稿和指定人可见正文在没有保全时删除',
        '公开参与过的讨论里你的名字显示为「已注销成员」，别人回复里引用你的那段文字一并清掉',
        '成员可见内容和贡献流水保留账号编号，姓名显示为「已注销成员」',
    ]
    return data


def purge_private_versions(conn, principal_id):
    if not flags.enabled(conn, 'account.purge_private_content') or any(h(conn, principal_id) for h in HOLDS):
        return 0
    ids = [r[0] for r in conn.execute("SELECT id FROM object_head WHERE author_id = ? AND lifecycle = 'withdrawn' "
                                      "AND (visibility = 'named' OR published_at IS NULL) "
                                      'AND EXISTS (SELECT 1 FROM object_version v WHERE v.object_id = object_head.id)',
                                      (principal_id,))]
    for object_id in ids:
        conn.execute('DELETE FROM object_version WHERE object_id = ?', (object_id,))
        conn.execute('DELETE FROM object_acl WHERE object_id = ?', (object_id,))
    if ids:
        audit.record(conn, None, 'account.private_content_purged', 'principal', principal_id,
                     meta={'objects': len(ids)})
    return len(ids)


def on_principal_deleted(conn, event):
    if not installed(conn):
        return
    pid = event['aggregate_id']
    storage = media.storage_for(conn)
    for row in conn.execute("SELECT id, file_key FROM account_export WHERE principal_id = ? AND file_key IS NOT NULL",
                            (pid,)).fetchall():
        if storage is None:
            raise RuntimeError('storage unavailable for export cleanup')
        storage.delete(row['file_key'])
    conn.execute("UPDATE account_export SET state = CASE WHEN state IN ('queued', 'ready') THEN 'expired' ELSE state "
                 'END, file_key = NULL WHERE principal_id = ?', (pid,))
    purge_private_versions(conn, pid)


def purge(conn, principal_id):
    """Revoke download tokens transactionally; blob cleanup follows via outbox."""
    conn.execute("UPDATE account_export SET token_hash = '' WHERE principal_id = ?", (principal_id,))
    purge_private_versions(conn, principal_id)
    if security_ready(conn):
        conn.execute('DELETE FROM account_session_label WHERE session_id IN '
                     '(SELECT id FROM session WHERE principal_id = ?)', (principal_id,))
        conn.execute('DELETE FROM account_card_visibility WHERE principal_id = ?', (principal_id,))
    from . import contribute
    contribute.purge(conn, principal_id)


def expire_exports(db):
    with db.write() as conn:
        _expire(conn, media.storage_for(conn))


def export_rows(conn, actor):
    return [dict(r) for r in conn.execute(
        'SELECT id, state, bytes, created_at, ready_at, expires_at, downloaded_at FROM account_export '
        'WHERE principal_id = ? ORDER BY created_at, id', (actor.id,))]


def set_avatar(conn, actor, asset_id, request_id=None):
    flags.gate(conn, 'account.avatar.enabled')
    require(conn, actor, 'account.avatar.set')
    if asset_id is not None:
        ok = conn.execute("SELECT 1 FROM media_asset WHERE id = ? AND owner_id = ? AND purpose = 'avatar' "
                          "AND state = 'ready'", (asset_id, actor.id)).fetchone()
        if not ok:
            raise ApiError('validation_failed', '头像要用你自己上传、已处理完成的头像文件')
    conn.execute('UPDATE profile SET avatar_ref = ?, updated_at = ? WHERE principal_id = ?',
                 (asset_id, clock.now(), actor.id))
    audit.record(conn, actor.id, 'account.avatar_set' if asset_id else 'account.avatar_cleared', 'principal', actor.id,
                 request_id=request_id, meta={'asset_id': asset_id})
    outbox.emit(conn, 'account.avatar_changed', 'principal', actor.id, {'asset_id': asset_id}, actor_id=actor.id,
                request_id=request_id)
    return {'avatar_ref': asset_id, 'avatar': media.avatar_urls(conn, [asset_id]).get(asset_id) if asset_id else None}


SECURITY_MIGRATION = 'account/account_0003.sql'
SCOPES = ('self', 'invited', 'members')
_SESSION_ID = re.compile(r'[0-9a-f]{64}\Z')
_TOKEN_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')


def security_ready(conn):
    return conn.execute('SELECT 1 FROM schema_migration WHERE id = ?', (SECURITY_MIGRATION,)).fetchone() is not None


def _ready(conn, flag):
    if not security_ready(conn):
        raise ApiError('capability_unavailable')
    flags.gate(conn, flag)


def clean_ua(request):
    raw = request.headers.get('user-agent') or ''
    cleaned = ''.join(ch for ch in raw if ch.isprintable() and ch not in '\r\n')
    return cleaned[:160]


def confirm_sensitive(conn, actor, totp_code, password):
    """已开启动态验证码就核销一组验证码；否则核验当前密码。不把验证码或密码写进审计。"""
    row = conn.execute('SELECT secret, enabled_at, last_step FROM totp_secret WHERE principal_id = ?',
                       (actor.id,)).fetchone()
    if row is not None and row['enabled_at']:
        if not totp_code:
            raise ApiError('totp_required')
        step = security.totp_match(row['secret'], totp_code, row['last_step'])
        if step is None:
            raise ApiError('totp_invalid')
        conn.execute('UPDATE totp_secret SET last_step = ? WHERE principal_id = ?', (step, actor.id))
        return
    if not password:
        raise ApiError('validation_failed', '需要当前密码。')
    cred = conn.execute('SELECT password_hash FROM credential WHERE principal_id = ?', (actor.id,)).fetchone()
    if cred is None or not security.verify_password(password, cred[0]):
        raise ApiError('invalid_credentials')


def _device_name(ua, current):
    if current:
        return '这台设备'
    if ua:
        return ua[:48]
    return '另一台设备'


def list_sessions(conn, actor, user_agent):
    _ready(conn, 'account.sessions.enabled')
    now = clock.now()
    if user_agent and actor.session_id:
        conn.execute('INSERT INTO account_session_label (session_id, user_agent, updated_at) VALUES (?, ?, ?) '
                     'ON CONFLICT(session_id) DO UPDATE SET user_agent = excluded.user_agent, updated_at = excluded.updated_at',
                     (actor.session_id, user_agent, now))
    rows = conn.execute(
        'SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, l.user_agent FROM session s '
        'LEFT JOIN account_session_label l ON l.session_id = s.id '
        'WHERE s.principal_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? '
        'ORDER BY s.last_seen_at DESC, s.id', (actor.id, now)).fetchall()
    items = []
    for row in rows:
        current = row['id'] == actor.session_id
        ua = row['user_agent'] or ''
        items.append({
            'id': row['id'], 'current': current, 'name': _device_name(ua, current),
            'client': ua[:48], 'created_at': row['created_at'], 'last_seen_at': row['last_seen_at'],
            'expires_at': row['expires_at'],
        })
    return {'items': items}


def _own_session(conn, actor, session_id):
    if not _SESSION_ID.match(session_id or ''):
        raise ApiError('resource_not_found')
    row = conn.execute('SELECT id, revoked_at FROM session WHERE id = ? AND principal_id = ?',
                       (session_id, actor.id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def revoke_session(conn, actor, session_id, totp_code, password, request_id=None):
    _ready(conn, 'account.sessions.enabled')
    row = _own_session(conn, actor, session_id)
    confirm_sensitive(conn, actor, totp_code, password)
    if row['revoked_at'] is None:
        conn.execute('UPDATE session SET revoked_at = ? WHERE id = ? AND principal_id = ? AND revoked_at IS NULL',
                     (clock.now(), session_id, actor.id))
        audit.record(conn, actor.id, 'account.session_revoke', 'session', session_id, request_id=request_id,
                     meta={'current': session_id == actor.session_id})
    return {'id': session_id, 'revoked': True}


def revoke_other_sessions(conn, actor, totp_code, password, request_id=None):
    _ready(conn, 'account.sessions.enabled')
    confirm_sensitive(conn, actor, totp_code, password)
    accounts.revoke_sessions(conn, actor.id, keep=actor.session_id)
    audit.record(conn, actor.id, 'account.sessions_revoke_others', 'principal', actor.id, request_id=request_id)
    return {'revoked_others': True}


def revoke_token(conn, actor, token_id, totp_code, password, request_id=None):
    _ready(conn, 'account.sessions.enabled')
    if not _TOKEN_ID.match(token_id or ''):
        raise ApiError('resource_not_found')
    row = conn.execute(
        'SELECT t.id, t.hint, t.revoked_at, t.agent_id FROM agent_token t '
        'JOIN agent_profile a ON a.principal_id = t.agent_id WHERE t.id = ? AND a.owner_id = ?',
        (token_id, actor.id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    confirm_sensitive(conn, actor, totp_code, password)
    if row['revoked_at'] is None:
        conn.execute("UPDATE agent_token SET revoked_at = ?, revoked_by = ?, revoke_reason = 'owner' WHERE id = ?",
                     (clock.now(), actor.id, token_id))
        audit.record(conn, actor.id, 'account.token_revoke', 'agent_token', token_id, request_id=request_id,
                     meta={'agent': row['agent_id']})
    fresh = conn.execute('SELECT revoked_at, hint FROM agent_token WHERE id = ?', (token_id,)).fetchone()
    return {'id': token_id, 'hint': '…' + fresh['hint'], 'revoked_at': fresh['revoked_at'], 'agent_id': row['agent_id']}


def _scope_row(conn, principal_id):
    row = conn.execute('SELECT scope FROM account_card_visibility WHERE principal_id = ?', (principal_id,)).fetchone()
    return row['scope'] if row else 'members'


def visibility(conn, actor):
    _ready(conn, 'account.card_visibility.enabled')
    return {'scope': _scope_row(conn, actor.id)}


def set_visibility(conn, actor, scope, request_id=None):
    _ready(conn, 'account.card_visibility.enabled')
    require(conn, actor, 'account.visibility.set')
    if scope not in SCOPES:
        raise ApiError('validation_failed', '可见范围只能是仅自己、受邀成员或社区成员')
    now = clock.now()
    conn.execute('INSERT INTO account_card_visibility (principal_id, scope, updated_at) VALUES (?, ?, ?) '
                 'ON CONFLICT(principal_id) DO UPDATE SET scope = excluded.scope, updated_at = excluded.updated_at',
                 (actor.id, scope, now))
    audit.record(conn, actor.id, 'account.visibility_set', 'principal', actor.id, request_id=request_id,
                 meta={'scope': scope})
    return {'scope': scope}


def _invited(conn, owner_id, viewer_id):
    return conn.execute(
        'SELECT 1 FROM invite_edge WHERE (invitee_id = ? AND inviter_id = ?) OR (invitee_id = ? AND inviter_id = ?) '
        'LIMIT 1', (viewer_id, owner_id, owner_id, viewer_id)).fetchone() is not None


def card_for(conn, actor, handle):
    _ready(conn, 'account.card_visibility.enabled')
    if not re.fullmatch(r'[a-z0-9_]{3,32}', handle or ''):
        raise ApiError('resource_not_found')
    row = conn.execute(
        'SELECT p.id, p.status, c.handle, pr.display_name, pr.level, pr.avatar_ref FROM principal p '
        'JOIN credential c ON c.principal_id = p.id JOIN profile pr ON pr.principal_id = p.id WHERE c.handle = ?',
        (handle,)).fetchone()
    if row is None or row['status'] in ('deleted', 'suspended'):
        raise ApiError('resource_not_found')
    own = row['id'] == actor.id
    scope = _scope_row(conn, row['id'])
    if not own:
        if row['status'] != 'active':
            raise ApiError('resource_not_found')
        if scope == 'self' or (scope == 'invited' and not _invited(conn, row['id'], actor.id)):
            raise ApiError('resource_not_found')
        if scope not in SCOPES:
            raise ApiError('resource_not_found')
    data = {'id': row['id'], 'handle': row['handle'], 'display_name': row['display_name'],
            'level': row['level'], 'avatar_ref': row['avatar_ref']}
    if own:
        data['scope'] = scope
    return data
