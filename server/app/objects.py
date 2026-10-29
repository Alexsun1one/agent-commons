import hashlib
import json
import uuid

from . import audit, clock, fts, outbox, withdrawals
from .authz import require, visible_predicate
from .errors import ApiError

VISIBILITIES = {'public', 'members', 'level', 'space', 'named'}
MAX_ACL = 50
TYPES = {}
PRE_PUBLISH = []
LIST_COLUMNS = ('h.id, h.type, h.author_id, h.space_id, h.root_id, h.visibility, h.min_level, h.lifecycle, '
                'h.current_version, h.policy_epoch, h.created_at, h.updated_at, h.published_at, '
                'v.title, v.content_json, p.display_name AS author_name')


def validate_default(content):
    if not isinstance(content, dict):
        raise ApiError('validation_failed', 'content 必须是对象')
    unknown = set(content) - {'body', 'summary', 'tags'}
    if unknown:
        raise ApiError('unknown_field', f'content 不认识的字段：{", ".join(sorted(unknown))}')
    body = content.get('body', '')
    summary = content.get('summary', '')
    tags = content.get('tags', [])
    if not isinstance(body, str) or len(body) > 200_000:
        raise ApiError('validation_failed', 'body 必须是不超过 20 万字的文本')
    if not isinstance(summary, str) or len(summary) > 500:
        raise ApiError('validation_failed', 'summary 不超过 500 字')
    if (not isinstance(tags, list) or len(tags) > 10
            or any(not isinstance(t, str) or not 1 <= len(t) <= 32 for t in tags)):
        raise ApiError('validation_failed', 'tags 最多 10 个，每个 1 到 32 字')
    return content


def text_default(content):
    return '\n'.join([content.get('summary', ''), content.get('body', ''), ' '.join(content.get('tags', []))]).strip()


def register_type(name, validate=validate_default, text=text_default):
    TYPES[name] = (validate, text)


def register_pre_publish(fn):
    if not callable(fn):
        raise TypeError('pre-publish hook must be callable')
    if fn not in PRE_PUBLISH:
        PRE_PUBLISH.append(fn)


def _pre_publish(conn, actor, head, version):
    decision = 'active'
    for fn in PRE_PUBLISH:
        value = fn(conn, actor, head, version)
        if value not in ('active', 'pending_review'):
            raise ValueError('pre-publish hook must return active or pending_review')
        if value == 'pending_review':
            decision = value
    return decision


def _apply_pre_publish(conn, actor, object_id, version):
    head = conn.execute('SELECT * FROM object_head WHERE id = ?', (object_id,)).fetchone()
    if head['lifecycle'] != 'active':
        return head
    decision = _pre_publish(conn, actor, head, version)
    current = conn.execute('SELECT * FROM object_head WHERE id = ?', (object_id,)).fetchone()
    if decision == 'pending_review' and current['lifecycle'] == 'active':
        conn.execute("UPDATE object_head SET lifecycle = 'pending_review', policy_epoch = policy_epoch + 1, "
                     'updated_at = ? WHERE id = ?', (clock.now(), object_id))
        current = conn.execute('SELECT * FROM object_head WHERE id = ?', (object_id,)).fetchone()
    return current


for _name in ('knowledge', 'discussion', 'work', 'reply'):
    register_type(_name)


def etag(row):
    return f'"v{row["current_version"]}-p{row["policy_epoch"]}"'


def canonical(content):
    return json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def load_visible(conn, actor, object_id):
    pred = visible_predicate(actor)
    row = conn.execute(f'SELECT h.* FROM object_head h WHERE h.id = :id AND {pred.sql}',
                       {'id': object_id, **pred.params}).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _title(title):
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 200:
        raise ApiError('validation_failed', '标题要有 1 到 200 个字')
    return title.strip()


def _scope(conn, actor, visibility, min_level, space_id, acl):
    if visibility not in VISIBILITIES:
        raise ApiError('validation_failed', '不认识的可见范围')
    if visibility == 'public':
        raise ApiError('capability_unavailable', '公开范围本版不开放')
    if not isinstance(min_level, int) or not 1 <= min_level <= 5:
        raise ApiError('validation_failed', 'min_level 要在 1 到 5 之间')
    if visibility == 'level' and min_level < 2:
        raise ApiError('validation_failed', '按等级可见时 min_level 至少为 2')
    if visibility == 'space' and not space_id:
        raise ApiError('validation_failed', '空间可见需要 space_id')
    if space_id and not conn.execute("SELECT 1 FROM membership WHERE space_id = ? AND principal_id = ? "
                                     "AND state = 'active'", (space_id, actor.id)).fetchone():
        raise ApiError('resource_not_found')
    acl = sorted(set(acl or ()))
    if visibility == 'named':
        if not 1 <= len(acl) <= MAX_ACL:
            raise ApiError('validation_failed', f'指定人可见需要 1 到 {MAX_ACL} 位成员')
        marks = ','.join('?' * len(acl))
        found = conn.execute(f"SELECT count(*) FROM principal WHERE id IN ({marks}) AND status = 'active'",
                             acl).fetchone()[0]
        if found != len(acl):
            raise ApiError('validation_failed', '指定的成员不存在')
    elif acl:
        raise ApiError('validation_failed', '只有指定人可见才能带 acl')
    return acl


def _set_acl(conn, object_id, acl, granted_by):
    conn.execute('DELETE FROM object_acl WHERE object_id = ?', (object_id,))
    now = clock.now()
    conn.executemany('INSERT INTO object_acl (object_id, principal_id, granted_by, granted_at) VALUES (?, ?, ?, ?)',
                     [(object_id, pid, granted_by, now) for pid in acl])


def _version(conn, object_id, version, title, content, editor_id):
    body = canonical(content)
    conn.execute('INSERT INTO object_version (object_id, version, title, content_json, content_hash, editor_id, '
                 'created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                 (object_id, version, title, body, hashlib.sha256(body.encode()).hexdigest(), editor_id, clock.now()))


def reindex(conn, object_id):
    head = conn.execute('SELECT type, lifecycle, current_version FROM object_head WHERE id = ?', (object_id,)).fetchone()
    if head is None or head['lifecycle'] == 'withdrawn':
        fts.unindex(conn, object_id)
        return
    v = conn.execute('SELECT title, content_json FROM object_version WHERE object_id = ? AND version = ?',
                     (object_id, head['current_version'])).fetchone()
    text = TYPES.get(head['type'], (None, text_default))[1](json.loads(v['content_json']))
    fts.index(conn, object_id, head['current_version'], v['title'], text)


def create(conn, actor, *, type, title, content, visibility='members', min_level=1, space_id=None, acl=(),
           root_id=None, lifecycle='active', request_id=None):
    if type not in TYPES:
        raise ApiError('validation_failed', '不认识的内容类型')
    require(conn, actor, f'object.create.{type}')
    title = _title(title)
    content = TYPES[type][0](content)
    if lifecycle not in ('draft', 'active'):
        raise ApiError('validation_failed', '新建内容只能是 draft 或 active')
    if root_id:
        root = load_visible(conn, actor, root_id)
        if root['root_id']:
            root = load_visible(conn, actor, root['root_id'])
        if root['lifecycle'] != 'active':
            raise ApiError('state_conflict', '只能回复已发布的内容')
        root_id, visibility, min_level, space_id, acl = root['id'], 'members', 1, root['space_id'], []
    else:
        acl = _scope(conn, actor, visibility, min_level, space_id, acl)
    object_id = str(uuid.uuid4())
    now = clock.now()
    doc_no = conn.execute('SELECT coalesce(max(doc_no), 0) + 1 FROM object_head').fetchone()[0]
    conn.execute(
        'INSERT INTO object_head (id, type, author_id, space_id, root_id, visibility, min_level, lifecycle, '
        'current_version, policy_epoch, doc_no, created_at, updated_at, published_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)',
        (object_id, type, actor.id, space_id, root_id, visibility, min_level, lifecycle, doc_no, now, now,
         now if lifecycle == 'active' else None))
    _version(conn, object_id, 1, title, content, actor.id)
    _set_acl(conn, object_id, acl, actor.id)
    if lifecycle == 'active':
        _apply_pre_publish(conn, actor, object_id, 1)
    head = conn.execute('SELECT * FROM object_head WHERE id = ?', (object_id,)).fetchone()
    reindex(conn, object_id)
    outbox.emit(conn, 'object.created', 'object', object_id, {'type': type, 'lifecycle': head['lifecycle']},
                version=1, space_id=space_id, actor_id=actor.id, request_id=request_id,
                policy_epoch=head['policy_epoch'])
    audit.record(conn, actor.id, 'object.create', 'object', object_id, request_id=request_id, meta={'type': type})
    return object_id


def update(conn, actor, row, changes, if_match, request_id=None):
    if not if_match:
        raise ApiError('precondition_required')
    if if_match != etag(row):
        raise ApiError('version_conflict')
    require(conn, actor, 'object.edit', dict(row))
    version, epoch = row['current_version'], row['policy_epoch']
    current = conn.execute('SELECT title, content_json FROM object_version WHERE object_id = ? AND version = ?',
                           (row['id'], version)).fetchone()
    title = _title(changes['title']) if 'title' in changes else current['title']
    content = TYPES[row['type']][0](changes['content']) if 'content' in changes else json.loads(current['content_json'])
    if title != current['title'] or canonical(content) != current['content_json']:
        version += 1
        _version(conn, row['id'], version, title, content, actor.id)
    scope_keys = {'visibility', 'min_level', 'space_id', 'acl'}
    visibility, min_level, space_id = row['visibility'], row['min_level'], row['space_id']
    if scope_keys & set(changes):
        if row['root_id']:
            raise ApiError('validation_failed', '回复的可见范围跟随原帖')
        old_acl = [r[0] for r in conn.execute('SELECT principal_id FROM object_acl WHERE object_id = ? '
                                              'ORDER BY principal_id', (row['id'],))]
        visibility = changes.get('visibility', visibility)
        min_level = changes.get('min_level', min_level)
        space_id = changes.get('space_id', space_id)
        acl = _scope(conn, actor, visibility, min_level, space_id,
                     changes.get('acl', old_acl if visibility == 'named' else []))
        if (visibility, min_level, space_id, acl) != (row['visibility'], row['min_level'], row['space_id'], old_acl):
            epoch += 1
            _set_acl(conn, row['id'], acl, actor.id)
    lifecycle = row['lifecycle']
    if 'lifecycle' in changes and changes['lifecycle'] != lifecycle:
        if lifecycle not in ('draft', 'active') or changes['lifecycle'] not in ('draft', 'active'):
            raise ApiError('state_conflict', '当前状态不能这样切换')
        lifecycle = changes['lifecycle']
        epoch += 1
    if (version, epoch) == (row['current_version'], row['policy_epoch']):
        return row
    now = clock.now()
    conn.execute('UPDATE object_head SET current_version = ?, policy_epoch = ?, visibility = ?, min_level = ?, '
                 'space_id = ?, lifecycle = ?, updated_at = ?, published_at = coalesce(published_at, ?) WHERE id = ?',
                 (version, epoch, visibility, min_level, space_id, lifecycle, now,
                  now if lifecycle == 'active' else None, row['id']))
    current = _apply_pre_publish(conn, actor, row['id'], version) if lifecycle == 'active' else conn.execute(
        'SELECT * FROM object_head WHERE id = ?', (row['id'],)).fetchone()
    reindex(conn, row['id'])
    outbox.emit(conn, 'object.updated', 'object', row['id'],
                {'version_changed': version != row['current_version'],
                 'policy_changed': current['policy_epoch'] != row['policy_epoch']},
                version=version, space_id=space_id, actor_id=actor.id, request_id=request_id,
                policy_epoch=current['policy_epoch'])
    audit.record(conn, actor.id, 'object.update', 'object', row['id'], request_id=request_id,
                 meta={'version': version, 'policy_epoch': epoch})
    return current


def withdraw(conn, settings, actor_id, row, reason, request_id=None):
    if row['lifecycle'] == 'withdrawn':
        return row
    now = clock.now()
    conn.execute("UPDATE object_head SET lifecycle = 'withdrawn', withdrawn_at = ?, updated_at = ?, "
                 'policy_epoch = policy_epoch + 1 WHERE id = ?', (now, now, row['id']))
    fts.unindex(conn, row['id'])
    outbox.emit(conn, 'object.withdrawn', 'object', row['id'], {'reason': reason}, version=row['current_version'],
                space_id=row['space_id'], actor_id=actor_id, request_id=request_id,
                policy_epoch=row['policy_epoch'] + 1)
    audit.record(conn, actor_id, 'object.withdraw', 'object', row['id'], reason=reason, request_id=request_id)
    withdrawals.append(settings.withdrawal_log, row['id'], actor_id, now,
                       version=row['current_version'], reason=reason)
    return conn.execute('SELECT * FROM object_head WHERE id = ?', (row['id'],)).fetchone()


def set_lifecycle(conn, actor_id, object_id, lifecycle, reason, request_id=None):
    if lifecycle not in ('active', 'pending_review', 'hidden'):
        raise ApiError('validation_failed', '这里只能切换到 active、pending_review 或 hidden')
    row = conn.execute('SELECT * FROM object_head WHERE id = ?', (object_id,)).fetchone()
    if row is None or row['lifecycle'] == 'withdrawn':
        raise ApiError('resource_not_found')
    conn.execute('UPDATE object_head SET lifecycle = ?, updated_at = ?, policy_epoch = policy_epoch + 1 WHERE id = ?',
                 (lifecycle, clock.now(), object_id))
    outbox.emit(conn, 'object.lifecycle_changed', 'object', object_id, {'lifecycle': lifecycle, 'reason': reason},
                version=row['current_version'], space_id=row['space_id'], actor_id=actor_id, request_id=request_id,
                policy_epoch=row['policy_epoch'] + 1)
    audit.record(conn, actor_id, 'object.lifecycle', 'object', object_id, reason=reason, request_id=request_id,
                 meta={'from': row['lifecycle'], 'to': lifecycle})


def _filters(filters):
    sql, params = [], {}
    for key in ('type', 'space_id', 'author_id', 'root_id'):
        if filters.get(key) is not None:
            sql.append(f'h.{key} = :f_{key}')
            params[f'f_{key}'] = filters[key]
    return ''.join(f' AND {s}' for s in sql), params


def list_visible(conn, actor, filters, after=None, limit=20, newest_first=True):
    pred = visible_predicate(actor)
    where, params = _filters(filters)
    op, order = ('<', 'DESC') if newest_first else ('>', 'ASC')
    if after:
        where += f' AND (h.created_at, h.id) {op} (:c_at, :c_id)'
        params.update(c_at=after[0], c_id=after[1])
    sql = (f'SELECT {LIST_COLUMNS} FROM (SELECT * FROM object_head h WHERE {pred.sql}{where} '
           f'ORDER BY h.created_at {order}, h.id {order} LIMIT :n) h '
           'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
           'JOIN profile p ON p.principal_id = h.author_id '
           f'ORDER BY h.created_at {order}, h.id {order}')
    return conn.execute(sql, {**pred.params, **params, 'n': limit}).fetchall()


def count_visible(conn, actor, filters):
    pred = visible_predicate(actor)
    where, params = _filters(filters)
    return conn.execute(f'SELECT count(*) FROM object_head h WHERE {pred.sql}{where}',
                        {**pred.params, **params}).fetchone()[0]


def dto(row, actor, full=False, acl=None):
    content = json.loads(row['content_json'])
    data = {k: row[k] for k in ('id', 'type', 'space_id', 'root_id', 'visibility', 'min_level', 'lifecycle',
                                'policy_epoch', 'created_at', 'updated_at', 'published_at', 'title')}
    data['version'] = row['current_version'] if 'version' not in row.keys() else row['version']
    data['author'] = {'id': row['author_id'], 'display_name': row['author_name']}
    data['etag'] = etag(row)
    if full:
        data['content'] = content
        if acl is not None and actor.id == row['author_id']:
            data['acl'] = acl
    else:
        text = TYPES.get(row['type'], (None, text_default))[1](content)
        data['excerpt'] = text[:140]
    return data


def detail(conn, actor, object_id, version=None):
    head = load_visible(conn, actor, object_id)
    version = head['current_version'] if version is None else version
    row = conn.execute(
        'SELECT h.*, v.version, v.title, v.content_json, p.display_name AS author_name FROM object_head h '
        'JOIN object_version v ON v.object_id = h.id JOIN profile p ON p.principal_id = h.author_id '
        'WHERE h.id = ? AND v.version = ?', (object_id, version)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    acl = [r[0] for r in conn.execute('SELECT principal_id FROM object_acl WHERE object_id = ? ORDER BY principal_id',
                                      (object_id,))]
    return row, dto(row, actor, full=True, acl=acl)
