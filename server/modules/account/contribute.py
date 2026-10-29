"""#/contribute 的草稿与审核。挂在 account 模块下，不另开发现模块。"""
import uuid

from app import audit, clock, flags, outbox, pagination
from app.authz import require
from app.errors import ApiError

MIGRATION = 'account/account_0004.sql'
FLAG = 'account.contributions.enabled'
ACTION = 'account.contribution.write'
KINDS = ('实践案例', '作品', '方法笔记')
STATUSES = ('draft', 'review', 'accepted')


def installed(conn):
    return conn.execute('SELECT 1 FROM schema_migration WHERE id = ?', (MIGRATION,)).fetchone() is not None


def _gate(conn):
    if not installed(conn):
        raise ApiError('capability_unavailable')
    flags.gate(conn, FLAG)


def _match(request, version):
    raw = request.headers.get('if-match')
    if raw is None or not str(raw).strip():
        raise ApiError('precondition_required')
    token = str(raw).strip()
    if token.startswith('W/'):
        token = token[2:].strip()
    if len(token) >= 2 and token[0] == '"' and token[-1] == '"':
        token = token[1:-1]
    if token != str(version):
        raise ApiError('version_conflict')


def _own(conn, actor, contribution_id):
    row = conn.execute('SELECT * FROM contribution WHERE id = ? AND author_id = ?',
                       (contribution_id, actor.id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _history(conn, contribution_id):
    rows = conn.execute(
        'SELECT version, event, title, kind, summary, body, at FROM contribution_history '
        'WHERE contribution_id = ? ORDER BY version ASC', (contribution_id,)).fetchall()
    return [{'version': r['version'], 'event': r['event'], 'title': r['title'], 'kind': r['kind'],
             'summary': r['summary'], 'body': r['body'], 'at': r['at'], 'files': []} for r in rows]


def _dto(conn, row, with_history=True):
    data = {
        'id': row['id'], 'title': row['title'], 'kind': row['kind'], 'summary': row['summary'],
        'body': row['body'], 'status': row['status'], 'version': row['version'],
        'created_at': row['created_at'], 'updated_at': row['updated_at'], 'files': [],
    }
    if with_history:
        data['history'] = _history(conn, row['id'])
    return data


def _remember(conn, row, event, at):
    conn.execute('INSERT INTO contribution_history (contribution_id, version, event, title, kind, summary, body, at) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                 (row['id'], row['version'], event, row['title'], row['kind'], row['summary'], row['body'], at))
    stale = conn.execute('SELECT version FROM contribution_history WHERE contribution_id = ? ORDER BY version DESC',
                         (row['id'],)).fetchall()[12:]
    if stale:
        marks = ','.join('?' * len(stale))
        conn.execute(f'DELETE FROM contribution_history WHERE contribution_id = ? AND version IN ({marks})',
                     (row['id'], *[item['version'] for item in stale]))


def _clean(body):
    title = body.get('title')
    kind = body.get('kind')
    summary = body.get('summary')
    text = body.get('body')
    if not isinstance(title, str) or len(title) > 80:
        raise ApiError('validation_failed', '标题不能超过 80 字')
    if kind not in KINDS:
        raise ApiError('validation_failed', '内容类型不对')
    if not isinstance(summary, str) or len(summary) > 240:
        raise ApiError('validation_failed', '一句话介绍不能超过 240 字')
    if not isinstance(text, str) or len(text) > 20000:
        raise ApiError('validation_failed', '正文不能超过 20000 字')
    return title, kind, summary, text


def list_page(conn, settings, actor, cursor, limit):
    _gate(conn)
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('account-contributions', actor.id)
    after = pagination.decode(settings, cursor, actor.id, qhash)
    params = [actor.id]
    where = 'author_id = ?'
    if after:
        where += ' AND (updated_at, id) < (?, ?)'
        params.extend(after)
    rows = conn.execute(f'SELECT * FROM contribution WHERE {where} ORDER BY updated_at DESC, id DESC LIMIT ?',
                        (*params, size + 1)).fetchall()
    page, next_cursor = pagination.page(settings, actor.id, qhash, rows, size, lambda r: [r['updated_at'], r['id']])
    return [_dto(conn, row, with_history=False) for row in page], next_cursor


def create(conn, actor, body, request_id=None):
    _gate(conn)
    require(conn, actor, ACTION)
    title, kind, summary, text = _clean(body)
    now = clock.now()
    contribution_id = str(uuid.uuid4())
    conn.execute('INSERT INTO contribution (id, author_id, title, kind, summary, body, status, version, created_at, '
                 "updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?)",
                 (contribution_id, actor.id, title, kind, summary, text, now, now))
    row = conn.execute('SELECT * FROM contribution WHERE id = ?', (contribution_id,)).fetchone()
    _remember(conn, row, '保存草稿', now)
    audit.record(conn, actor.id, 'account.contribution_create', 'contribution', contribution_id, request_id=request_id)
    return _dto(conn, row)


def read(conn, actor, contribution_id):
    _gate(conn)
    return _dto(conn, _own(conn, actor, contribution_id))


def update(conn, request, actor, contribution_id, body, request_id=None):
    _gate(conn)
    require(conn, actor, ACTION)
    row = _own(conn, actor, contribution_id)
    _match(request, row['version'])
    if row['status'] != 'draft':
        raise ApiError('state_conflict', '先撤回为草稿，再改内容')
    title, kind, summary, text = _clean(body)
    now = clock.now()
    version = row['version'] + 1
    conn.execute('UPDATE contribution SET title = ?, kind = ?, summary = ?, body = ?, version = ?, updated_at = ? '
                 'WHERE id = ? AND author_id = ? AND version = ?',
                 (title, kind, summary, text, version, now, contribution_id, actor.id, row['version']))
    fresh = conn.execute('SELECT * FROM contribution WHERE id = ?', (contribution_id,)).fetchone()
    _remember(conn, fresh, '保存草稿', now)
    audit.record(conn, actor.id, 'account.contribution_update', 'contribution', contribution_id, request_id=request_id)
    return _dto(conn, fresh)


def _transition(conn, request, actor, contribution_id, allowed, status, event, action, request_id):
    _gate(conn)
    require(conn, actor, ACTION)
    row = _own(conn, actor, contribution_id)
    _match(request, row['version'])
    if row['status'] not in allowed:
        raise ApiError('state_conflict', '这份投稿现在不能这样改')
    if status == 'review' and not (row['title'].strip() and row['summary'].strip() and row['body'].strip()):
        raise ApiError('validation_failed', '提交审核前，请补齐标题、一句话介绍和具体内容')
    now = clock.now()
    version = row['version'] + 1
    conn.execute('UPDATE contribution SET status = ?, version = ?, updated_at = ? WHERE id = ? AND author_id = ? '
                 'AND version = ?', (status, version, now, contribution_id, actor.id, row['version']))
    fresh = conn.execute('SELECT * FROM contribution WHERE id = ?', (contribution_id,)).fetchone()
    _remember(conn, fresh, event, now)
    audit.record(conn, actor.id, action, 'contribution', contribution_id, request_id=request_id,
                 meta={'status': status})
    return _dto(conn, fresh)


def submit_review(conn, request, actor, contribution_id, request_id=None):
    return _transition(conn, request, actor, contribution_id, ('draft',), 'review', '提交审核',
                       'account.contribution_review', request_id)


def withdraw(conn, request, actor, contribution_id, request_id=None):
    return _transition(conn, request, actor, contribution_id, ('review',), 'draft', '撤回为草稿',
                       'account.contribution_withdraw', request_id)


def remove(conn, request, actor, contribution_id, request_id=None):
    _gate(conn)
    require(conn, actor, ACTION)
    row = _own(conn, actor, contribution_id)
    _match(request, row['version'])
    conn.execute('DELETE FROM contribution WHERE id = ? AND author_id = ? AND version = ?',
                 (contribution_id, actor.id, row['version']))
    audit.record(conn, actor.id, 'account.contribution_delete', 'contribution', contribution_id, request_id=request_id)
    return {'id': contribution_id, 'deleted': True}


def admin_page(conn, settings, actor, status, cursor, limit):
    from modules.admin import access
    access.require_operator(conn, actor)
    _gate(conn)
    if status not in STATUSES:
        raise ApiError('validation_failed', '状态不对')
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('account-contributions-admin', status)
    after = pagination.decode(settings, cursor, actor.id, qhash)
    params = [status]
    where = 'c.status = ?'
    if after:
        where += ' AND (c.updated_at, c.id) < (?, ?)'
        params.extend(after)
    rows = conn.execute(
        'SELECT c.*, cr.handle, (SELECT display_name FROM profile WHERE principal_id = c.author_id) AS display_name '
        'FROM contribution c JOIN credential cr ON cr.principal_id = c.author_id '
        f'WHERE {where} ORDER BY c.updated_at DESC, c.id DESC LIMIT ?', (*params, size + 1)).fetchall()
    page, next_cursor = pagination.page(settings, actor.id, qhash, rows, size, lambda r: [r['updated_at'], r['id']])
    items = []
    for row in page:
        item = _dto(conn, row, with_history=False)
        item['handle'] = row['handle']
        item['display_name'] = row['display_name']
        last = conn.execute('SELECT event FROM contribution_history WHERE contribution_id = ? ORDER BY version DESC '
                            'LIMIT 1', (row['id'],)).fetchone()
        item['last_event'] = last['event'] if last else ''
        items.append(item)
    return items, next_cursor


def decide(conn, actor, contribution_id, decision, request_id=None, note=None):
    from modules.admin import access
    access.require_operator(conn, actor, write=True)
    _gate(conn)
    if decision not in ('accept', 'return'):
        raise ApiError('validation_failed', '决定只能是通过或退回')
    text = note.strip() if isinstance(note, str) else ''
    if note is not None and not isinstance(note, str):
        raise ApiError('validation_failed', '说明要是文字')
    if len(text) > 300:
        raise ApiError('validation_failed', '说明不能超过 300 字')
    row = conn.execute('SELECT * FROM contribution WHERE id = ?', (contribution_id,)).fetchone()
    if row is None or row['status'] != 'review':
        raise ApiError('resource_not_found' if row is None else 'state_conflict')
    status = 'accepted' if decision == 'accept' else 'draft'
    event = '审核通过' if decision == 'accept' else '退回修改'
    if text:
        event = event + '：' + text
    now = clock.now()
    version = row['version'] + 1
    conn.execute('UPDATE contribution SET status = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
                 (status, version, now, contribution_id, row['version']))
    fresh = conn.execute('SELECT * FROM contribution WHERE id = ?', (contribution_id,)).fetchone()
    _remember(conn, fresh, event, now)
    title = (row['title'] or '').strip() or '未命名投稿'
    message = f'《{title}》{"通过了" if decision == "accept" else "退回了"}。'
    if text:
        message += text
    outbox.emit(conn, 'governance.contribution_decided', 'contribution', contribution_id, {
        'recipient_id': row['author_id'], 'contribution_id': contribution_id, 'decision': decision,
        'title': row['title'], 'message': message,
    }, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'account.contribution_decide', 'contribution', contribution_id, request_id=request_id,
                 reason=text or None, meta={'decision': decision, 'note': text})
    return _dto(conn, fresh)


def export_rows(conn, actor):
    if not installed(conn):
        return []
    rows = conn.execute('SELECT * FROM contribution WHERE author_id = ? ORDER BY created_at, id', (actor.id,)).fetchall()
    return [_dto(conn, row) for row in rows]


def purge(conn, principal_id):
    if not installed(conn):
        return
    conn.execute('DELETE FROM contribution WHERE author_id = ?', (principal_id,))
