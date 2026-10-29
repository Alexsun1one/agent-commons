import hashlib
import hmac
import json
import re
import uuid

from . import audit, clock, ledger, outbox, security
from .authz import Actor
from .errors import ApiError

HANDLE = re.compile(r'[a-z0-9_]{3,32}\Z')
ROLES = {'admin', 'governor', 'host', 'lecturer', 'space_owner'}
EXPORTERS = {}
EXPORTER_MODULES = {}
PURGERS = []
PURGER_MODULE_PREFIXES = set()
TOUCH_AFTER = 600


def register_exporter(name, fn):
    """Register fn(conn, actor) -> JSON data owned by actor; never export credentials."""
    if not callable(fn):
        raise TypeError('exporter must be callable')
    EXPORTERS[name] = fn
    EXPORTER_MODULES[name] = getattr(fn, '__module__', '')


def register_purger(fn):
    """Register idempotent fn(conn, principal_id), inside the deletion transaction.

    Do not commit, use the network, or suppress failures. Retained audit/ledger
    rows must be documented by the module; physical blob cleanup may use outbox.
    """
    if not callable(fn):
        raise TypeError('purger must be callable')
    if fn not in PURGERS:
        PURGERS.append(fn)


def bind_modules(db, package_name, modules):
    prefixes = tuple(f'{package_name}.{module.name}' for module in modules)
    PURGER_MODULE_PREFIXES.update(prefixes)
    db.account_module_prefixes = prefixes


def _belongs_to(module_name, prefix):
    return module_name == prefix or module_name.startswith(prefix + '.')


def _purgers_for(db):
    allowed = getattr(db, 'account_module_prefixes', None)
    if allowed is None:
        return PURGERS
    selected = []
    for fn in PURGERS:
        module_name = getattr(fn, '__module__', '')
        if any(_belongs_to(module_name, prefix) for prefix in allowed):
            selected.append(fn)
        elif not any(_belongs_to(module_name, prefix) for prefix in PURGER_MODULE_PREFIXES):
            selected.append(fn)
    return selected


def _exporters_for(conn):
    selected = []
    for name, fn in sorted(EXPORTERS.items()):
        module_name = EXPORTER_MODULES.get(name, getattr(fn, '__module__', ''))
        prefix = next((p for p in PURGER_MODULE_PREFIXES if _belongs_to(module_name, p)), None)
        if prefix is not None:
            module = prefix.rsplit('.', 1)[-1]
            installed = conn.execute('SELECT 1 FROM schema_migration WHERE id LIKE ? LIMIT 1',
                                     (f'{module}/%',)).fetchone()
            if installed is None:
                continue
        selected.append((name, fn))
    return selected


def check_password(password):
    if not isinstance(password, str) or not 10 <= len(password) <= 128:
        raise ApiError('validation_failed', '密码长度要在 10 到 128 个字符之间')


def create_principal(conn, *, handle, password_hash, display_name, level=1, level_source='invite', kind='human'):
    if not HANDLE.match(handle):
        raise ApiError('validation_failed', '用户名只能用 3 到 32 位小写字母、数字或下划线')
    if conn.execute('SELECT 1 FROM credential WHERE handle = ?', (handle,)).fetchone():
        raise ApiError('state_conflict', '用户名已被占用')
    pid = str(uuid.uuid4())
    now = clock.now()
    conn.execute("INSERT INTO principal (id, kind, status, created_at) VALUES (?, ?, 'active', ?)", (pid, kind, now))
    conn.execute('INSERT INTO credential (principal_id, handle, password_hash, password_changed_at) VALUES (?, ?, ?, ?)',
                 (pid, handle, password_hash, now))
    conn.execute('INSERT INTO profile (principal_id, display_name, level, level_source, level_updated_at, updated_at) '
                 'VALUES (?, ?, ?, ?, ?, ?)', (pid, display_name, level, level_source, now, now))
    return pid


def create_session(conn, settings, principal_id):
    token = security.new_token()
    now = clock.now_ts()
    conn.execute('INSERT INTO session (id, principal_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
                 (security.token_hash(token), principal_id, clock.iso(now), clock.iso(now + settings.session_ttl),
                  clock.iso(now)))
    return token


def resolve_actor(db, token):
    conn = db.conn()
    sid = security.token_hash(token)
    row = conn.execute(
        'SELECT s.expires_at, s.last_seen_at, p.id, p.kind, p.status, pr.level, t.enabled_at AS totp '
        'FROM session s JOIN principal p ON p.id = s.principal_id JOIN profile pr ON pr.principal_id = p.id '
        'LEFT JOIN totp_secret t ON t.principal_id = p.id WHERE s.id = ? AND s.revoked_at IS NULL', (sid,)).fetchone()
    now = clock.now()
    if row is None or row['expires_at'] <= now or row['status'] not in ('active', 'pending_deletion'):
        return None
    if clock.parse(row['last_seen_at']) < clock.now_ts() - TOUCH_AFTER:
        with db.write() as wconn:
            wconn.execute('UPDATE session SET last_seen_at = ? WHERE id = ?', (now, sid))
    roles = frozenset(r[0] for r in conn.execute(
        'SELECT role FROM role_assignment WHERE principal_id = ? AND space_id IS NULL AND revoked_at IS NULL',
        (row['id'],)))
    return Actor(id=row['id'], level=row['level'], roles=roles, status=row['status'],
                 totp_enabled=row['totp'] is not None, session_id=sid, kind=row['kind'])


def revoke_sessions(conn, principal_id, keep=None):
    conn.execute('UPDATE session SET revoked_at = ? WHERE principal_id = ? AND revoked_at IS NULL AND id IS NOT ?',
                 (clock.now(), principal_id, keep))


def suspend(conn, principal_id, actor_id, reason):
    row = conn.execute('SELECT status FROM principal WHERE id = ?', (principal_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['status'] not in ('active', 'pending_deletion'):
        raise ApiError('state_conflict', '这个账号现在不能暂停')
    conn.execute("UPDATE principal SET status = 'suspended' WHERE id = ?", (principal_id,))
    revoke_sessions(conn, principal_id)
    audit.record(conn, actor_id, 'account.suspend', 'principal', principal_id, reason=reason)
    return row['status']


def unsuspend(conn, principal_id, actor_id, reason, restore_status='active'):
    if restore_status not in ('active', 'pending_deletion'):
        raise ValueError('restore_status must be active or pending_deletion')
    row = conn.execute('SELECT status FROM principal WHERE id = ?', (principal_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['status'] != 'suspended':
        raise ApiError('state_conflict', '这个账号现在没有暂停')
    conn.execute('UPDATE principal SET status = ? WHERE id = ?', (restore_status, principal_id))
    audit.record(conn, actor_id, 'account.unsuspend', 'principal', principal_id, reason=reason,
                 meta={'status': restore_status})
    return restore_status


def issue_invite(conn, inviter_id, max_uses=1, days=7, note=None, request_id=None, *, code=None):
    if max_uses != 1 or not 1 <= days <= 30:
        raise ApiError('validation_failed', '邀请码只能使用一次，有效期为 1 到 30 天')
    if inviter_id is not None:
        inviter = conn.execute('SELECT status FROM principal WHERE id = ?', (inviter_id,)).fetchone()
        if inviter is None or inviter['status'] != 'active':
            raise ApiError('action_not_allowed')
    code = code or security.new_code()
    invite_id = str(uuid.uuid4())
    expires = clock.iso(clock.now_ts() + days * 86400)
    conn.execute('INSERT INTO invite_code (id, code_hash, inviter_id, created_at, expires_at, max_uses, note) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?)',
                 (invite_id, security.code_hash(code), inviter_id, clock.now(), expires, max_uses, note))
    audit.record(conn, inviter_id, 'invite.issue', 'invite_code', invite_id, request_id=request_id,
                 meta={'max_uses': max_uses, 'days': days})
    return invite_id, code, expires


def revoke_invite(conn, invite_id, actor_id, request_id=None):
    cur = conn.execute('UPDATE invite_code SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL',
                       (clock.now(), actor_id, invite_id))
    if cur.rowcount == 0:
        raise ApiError('resource_not_found')
    audit.record(conn, actor_id, 'invite.revoke', 'invite_code', invite_id, request_id=request_id)


def register(conn, settings, *, invite_code, handle, password, display_name, request_id=None):
    check_password(password)
    now = clock.now()
    invite = conn.execute('SELECT id, inviter_id FROM invite_code WHERE code_hash = ? AND revoked_at IS NULL '
                          'AND expires_at > ? AND used_count = 0',
                          (security.code_hash(invite_code), now)).fetchone()
    if invite is None:
        raise ApiError('invite_invalid')
    if invite['inviter_id'] is not None:
        inviter = conn.execute('SELECT status FROM principal WHERE id = ?', (invite['inviter_id'],)).fetchone()
        if inviter is None or inviter['status'] != 'active':
            raise ApiError('invite_invalid')
    conn.execute('UPDATE invite_code SET used_count = used_count + 1 WHERE id = ?', (invite['id'],))
    pid = create_principal(conn, handle=handle, password_hash=security.hash_password(password, settings.scrypt_n),
                           display_name=display_name)
    conn.execute('INSERT INTO invite_edge (invitee_id, inviter_id, invite_code_id, created_at) VALUES (?, ?, ?, ?)',
                 (pid, invite['inviter_id'], invite['id'], now))
    audit.record(conn, pid, 'auth.register', 'principal', pid, request_id=request_id, meta={'invite': invite['id']})
    outbox.emit(conn, 'principal.registered', 'principal', pid, {'inviter_id': invite['inviter_id']},
                actor_id=pid, request_id=request_id)
    return pid


def credential_for(conn, handle):
    return conn.execute(
        'SELECT c.principal_id, c.password_hash, p.status, t.secret, t.enabled_at, t.last_step FROM credential c '
        'JOIN principal p ON p.id = c.principal_id LEFT JOIN totp_secret t ON t.principal_id = c.principal_id '
        'WHERE c.handle = ?', (handle,)).fetchone()


def issue_reset_code(conn, issuer_id, principal_id, hours=24, request_id=None, *, code=None):
    code = code or security.new_code()
    expires = clock.iso(clock.now_ts() + hours * 3600)
    conn.execute('UPDATE reset_code SET used_at = ? WHERE principal_id = ? AND used_at IS NULL',
                 (clock.now(), principal_id))
    conn.execute('INSERT INTO reset_code (id, code_hash, principal_id, issued_by, created_at, expires_at) '
                 'VALUES (?, ?, ?, ?, ?, ?)',
                 (str(uuid.uuid4()), security.code_hash(code), principal_id, issuer_id, clock.now(), expires))
    audit.record(conn, issuer_id, 'auth.reset_code.issue', 'principal', principal_id, request_id=request_id)
    return code, expires


def reset_password(conn, settings, *, handle, code, new_password, request_id=None):
    check_password(new_password)
    row = conn.execute(
        'SELECT r.id, r.principal_id FROM reset_code r JOIN credential c ON c.principal_id = r.principal_id '
        'JOIN principal p ON p.id = r.principal_id WHERE r.code_hash = ? AND c.handle = ? AND r.used_at IS NULL '
        "AND r.expires_at > ? AND p.status IN ('active', 'pending_deletion')",
        (security.code_hash(code), handle, clock.now())).fetchone()
    if row is None:
        raise ApiError('reset_invalid')
    now = clock.now()
    conn.execute('UPDATE reset_code SET used_at = ? WHERE id = ?', (now, row['id']))
    conn.execute('UPDATE credential SET password_hash = ?, password_changed_at = ? WHERE principal_id = ?',
                 (security.hash_password(new_password, settings.scrypt_n), now, row['principal_id']))
    revoke_sessions(conn, row['principal_id'])
    audit.record(conn, row['principal_id'], 'auth.reset', 'principal', row['principal_id'], request_id=request_id)
    return row['principal_id']


def issue_code_response(ctx, body, work):
    """Idempotent issuance without persisting the bearer code in response_json.

    work(conn, code) returns (status, envelope) without a code or URL. A random
    nonce is stored; HMAC derives a 128-bit code using the server secret plus
    issuer and route. Permission checks must run before calling this helper,
    including on replay. Existing plaintext cache entries fail closed.
    """
    from . import idempotency

    def derive(nonce):
        message = json.dumps(['account-code-v1', ctx.actor.id, ctx.request.method,
                              ctx.request.url.path, nonce], separators=(',', ':')).encode()
        raw = hmac.new(ctx.settings.secret_key, message, hashlib.sha256).hexdigest()[:32].upper()
        return '-'.join(raw[i:i + 4] for i in range(0, len(raw), 4))

    def issue(conn):
        nonce = security.new_token()
        status, payload = work(conn, derive(nonce))
        payload['_code_nonce'] = nonce
        return status, payload

    response = idempotency.run(ctx, body, issue)
    payload = json.loads(response.body)
    nonce = payload.pop('_code_nonce', None)
    if nonce is None:
        raise ApiError('state_conflict', '请使用新的请求编号重新签发')
    payload['data']['code'] = derive(nonce)
    result = idempotency.respond(response.status_code, payload)
    if response.headers.get('Idempotent-Replayed'):
        result.headers['Idempotent-Replayed'] = 'true'
    return result


def principal_by_handle(conn, handle):
    row = conn.execute('SELECT principal_id FROM credential WHERE handle = ?', (handle,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row[0]


def set_role(conn, actor_id, principal_id, role, grant=True, space_id=None, request_id=None):
    if role not in ROLES:
        raise ApiError('validation_failed', '不认识的角色')
    now = clock.now()
    if grant:
        conn.execute('INSERT INTO role_assignment (id, principal_id, role, space_id, granted_by, granted_at) '
                     'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
                     (str(uuid.uuid4()), principal_id, role, space_id, actor_id, now))
    else:
        conn.execute('UPDATE role_assignment SET revoked_at = ?, revoked_by = ? WHERE principal_id = ? AND role = ? '
                     'AND space_id IS ? AND revoked_at IS NULL', (now, actor_id, principal_id, role, space_id))
    audit.record(conn, actor_id, 'role.grant' if grant else 'role.revoke', 'principal', principal_id,
                 request_id=request_id, meta={'role': role, 'space_id': space_id})
    outbox.emit(conn, 'principal.roles_changed', 'principal', principal_id, {'role': role, 'grant': grant},
                actor_id=actor_id, request_id=request_id)


def create_space(conn, owner_id, slug, name, kind='project'):
    sid = str(uuid.uuid4())
    now = clock.now()
    conn.execute('INSERT INTO space (id, slug, name, kind, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                 (sid, slug, name, kind, owner_id, now))
    set_membership(conn, sid, owner_id, 'active', role='owner')
    return sid


def set_membership(conn, space_id, principal_id, state='active', role='member'):
    now = clock.now()
    conn.execute('INSERT INTO membership (space_id, principal_id, role, state, joined_at, updated_at) '
                 'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(space_id, principal_id) DO UPDATE SET '
                 'role = excluded.role, state = excluded.state, updated_at = excluded.updated_at',
                 (space_id, principal_id, role, state, now, now))


def me(conn, actor):
    row = conn.execute(
        'SELECT c.handle, pr.display_name, pr.avatar_ref, pr.level, pr.level_source, pr.metering_consent, '
        'p.status, p.kind, p.created_at, p.delete_requested_at FROM principal p '
        'JOIN profile pr ON pr.principal_id = p.id LEFT JOIN credential c ON c.principal_id = p.id WHERE p.id = ?',
        (actor.id,)).fetchone()
    spaces = conn.execute(
        "SELECT s.id, s.slug, s.name, s.kind, m.role FROM membership m JOIN space s ON s.id = m.space_id "
        "WHERE m.principal_id = ? AND m.state = 'active' AND s.archived_at IS NULL ORDER BY s.name",
        (actor.id,)).fetchall()
    data = dict(row)
    data.update(id=actor.id, roles=sorted(actor.roles), totp_enabled=actor.totp_enabled,
                metering_consent=bool(row['metering_consent']), spaces=[dict(s) for s in spaces])
    return data


def export(conn, actor):
    pid = actor.id
    objects = []
    for head in conn.execute("SELECT * FROM object_head WHERE author_id = ? AND lifecycle != 'withdrawn' "
                             'ORDER BY created_at', (pid,)):
        versions = conn.execute('SELECT version, title, content_json, created_at FROM object_version '
                                'WHERE object_id = ? ORDER BY version', (head['id'],)).fetchall()
        objects.append(dict(head, versions=[dict(v) for v in versions]))
    data = {
        'exported_at': clock.now(),
        'account': me(conn, actor),
        'invited_by': (conn.execute('SELECT inviter_id FROM invite_edge WHERE invitee_id = ?', (pid,)).fetchone()
                       or [None])[0],
        'objects': objects,
        'contributions': [{**entry, 'confirmed_by': None}
                          for entry in ledger.entries(conn, pid, limit=-1)],
        'audit': [dict(r) for r in conn.execute(
            'SELECT occurred_at, action, target_type, target_id, outcome FROM audit_event WHERE actor_id = ? '
            'ORDER BY occurred_at DESC', (pid,))],
    }
    for name, fn in _exporters_for(conn):
        data[name] = fn(conn, actor)
    return data


def request_deletion(conn, settings, actor, request_id=None):
    now = clock.now()
    conn.execute("UPDATE principal SET status = 'pending_deletion', delete_requested_at = ? WHERE id = ?",
                 (now, actor.id))
    audit.record(conn, actor.id, 'account.delete_requested', 'principal', actor.id, request_id=request_id)
    outbox.emit(conn, 'principal.deletion_requested', 'principal', actor.id, {}, actor_id=actor.id,
                request_id=request_id)
    return clock.iso(clock.parse(now) + settings.delete_cooldown_days * 86400)


def cancel_deletion(conn, actor, request_id=None):
    conn.execute("UPDATE principal SET status = 'active', delete_requested_at = NULL WHERE id = ?", (actor.id,))
    audit.record(conn, actor.id, 'account.delete_cancelled', 'principal', actor.id, request_id=request_id)


def purge_due(db, settings):
    from . import objects
    cutoff = clock.iso(clock.now_ts() - settings.delete_cooldown_days * 86400)
    with db.read() as conn:
        due = [r[0] for r in conn.execute("SELECT id FROM principal WHERE status = 'pending_deletion' "
                                          'AND delete_requested_at <= ?', (cutoff,))]
    purged = []
    for pid in due:
        with db.write() as conn:
            # A cancellation may have committed after the candidate read.
            still_due = conn.execute("SELECT 1 FROM principal WHERE id = ? AND status = 'pending_deletion' "
                                     'AND delete_requested_at <= ?', (pid, cutoff)).fetchone()
            if still_due is None:
                continue
            for row in conn.execute("SELECT * FROM object_head WHERE author_id = ? AND lifecycle != 'withdrawn' "
                                    "AND (lifecycle = 'draft' OR visibility IN ('named', 'space'))",
                                    (pid,)).fetchall():
                # Pass the versioned row and reason to the shared log writer;
                # the account path must not append a second withdrawal record.
                objects.withdraw(conn, settings, pid, row, reason='account_deleted')
            for purger in _purgers_for(db):
                purger(conn, pid)
            conn.execute('DELETE FROM session WHERE principal_id = ?', (pid,))
            conn.execute('DELETE FROM totp_secret WHERE principal_id = ?', (pid,))
            conn.execute('DELETE FROM credential WHERE principal_id = ?', (pid,))
            conn.execute('DELETE FROM reset_code WHERE principal_id = ?', (pid,))
            conn.execute('DELETE FROM idempotency_key WHERE principal_id = ?', (pid,))
            conn.execute('UPDATE invite_code SET revoked_at = coalesce(revoked_at, ?), note = NULL '
                         'WHERE inviter_id = ?', (clock.now(), pid))
            conn.execute("UPDATE profile SET display_name = '已注销成员', avatar_ref = NULL, updated_at = ? "
                         'WHERE principal_id = ?', (clock.now(), pid))
            conn.execute("UPDATE principal SET status = 'deleted', deleted_at = ? WHERE id = ?", (clock.now(), pid))
            audit.record(conn, None, 'account.purged', 'principal', pid)
            outbox.emit(conn, 'principal.deleted', 'principal', pid, {})
        purged.append(pid)
    return purged
