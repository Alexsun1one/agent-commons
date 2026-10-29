import json
import re
import uuid
from urllib.parse import urlsplit, urlunsplit

from app import audit, clock, objects, outbox
from app.authz import require, visible_predicate
from app.errors import ApiError
from app.pagination import decode, page, page_size, query_hash


KINDS = {
    'company': '公司',
    'lab': '实验室',
    'school_club': '学校社团',
    'open_source': '开源项目',
    'interest_group': '兴趣小组',
}
JOIN_POLICIES = {'invite': '邀请加入', 'apply': '申请加入'}
SLUG = re.compile(r'[a-z0-9][a-z0-9-]{1,39}\Z')
# 与 /api/orgs/{slug} 同级的固定路径（hub/*、mine/*），团队地址不能占用，否则详情接口会吞掉它们
RESERVED_SLUGS = frozenset({'mine', 'hub'})


def _text(value, limit, label, required=False):
    if value is None:
        value = ''
    if not isinstance(value, str):
        raise ApiError('validation_failed', f'{label}格式不正确')
    value = value.strip()
    if required and not value:
        raise ApiError('validation_failed', f'{label}不能为空')
    if len(value) > limit:
        raise ApiError('validation_failed', f'{label}最多 {limit} 字')
    return value


def safe_website(value):
    value = _text(value, 300, '官网')
    if not value:
        return ''
    try:
        parsed = urlsplit(value)
    except ValueError as exc:
        raise ApiError('validation_failed', '官网地址不正确') from exc
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ApiError('validation_failed', '官网只接受 http 或 https 地址')
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path or '', parsed.query, ''))


def validate_post(content):
    if not isinstance(content, dict):
        raise ApiError('validation_failed', 'content 必须是对象')
    unknown = set(content) - {'body', 'summary', 'tags'}
    if unknown:
        raise ApiError('unknown_field', f'content 不认识的字段：{", ".join(sorted(unknown))}')
    body = _text(content.get('body'), 20_000, '正文', required=True)
    summary = _text(content.get('summary'), 240, '摘要')
    tags = content.get('tags') or []
    if not isinstance(tags, list) or len(tags) > 8 or any(not isinstance(v, str) or not 1 <= len(v) <= 24 for v in tags):
        raise ApiError('validation_failed', '标签最多 8 个，每个 1 到 24 字')
    return {'body': body, 'summary': summary, 'tags': tags}


def post_text(content):
    return '\n'.join((content.get('summary', ''), content.get('body', ''), ' '.join(content.get('tags', [])))).strip()


def _table(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _blocked(conn, first, second):
    if not first or not second or first == second or not _table(conn, 'social_block'):
        return False
    return conn.execute(
        'SELECT 1 FROM social_block WHERE (blocker_id = ? AND blocked_id = ?) '
        'OR (blocker_id = ? AND blocked_id = ?)',
        (first, second, second, first),
    ).fetchone() is not None


def _org(conn, slug, *, public=False):
    row = conn.execute('SELECT * FROM org WHERE slug = ?', (slug,)).fetchone()
    if row is None or (public and row['status'] != 'approved'):
        raise ApiError('resource_not_found')
    return row


def _member(conn, org_id, principal_id):
    return conn.execute('SELECT * FROM org_member WHERE org_id = ? AND principal_id = ?',
                        (org_id, principal_id)).fetchone()


def _manager(conn, actor, org, *, owner=False):
    require(conn, actor, 'orgs.manage')
    row = _member(conn, org['id'], actor.id)
    allowed = row and row['state'] == 'active' and row['role'] == 'owner' if owner else (
        row and row['state'] == 'active' and row['role'] in ('owner', 'admin'))
    if not allowed:
        raise ApiError('action_not_allowed')
    return row


def _slug(conn, value):
    value = _text(value, 40, '团队地址')
    if value and not SLUG.fullmatch(value):
        raise ApiError('validation_failed', '团队地址只用小写字母、数字和短横线')
    if value in RESERVED_SLUGS:
        raise ApiError('validation_failed', '这个团队地址是系统保留的，请换一个')
    if not value:
        value = f'org-{uuid.uuid4().hex[:10]}'
    if conn.execute('SELECT 1 FROM org WHERE slug = ?', (value,)).fetchone():
        raise ApiError('state_conflict', '这个团队地址已经被使用')
    return value


def create(conn, actor, data, request_id=None):
    require(conn, actor, 'orgs.create')
    kind = data.get('type')
    if kind not in KINDS:
        raise ApiError('validation_failed', '不认识的团队类型')
    policy = data.get('join_policy') or 'apply'
    if policy not in JOIN_POLICIES:
        raise ApiError('validation_failed', '加入方式只能是邀请或申请')
    org_id = str(uuid.uuid4())
    now = clock.now()
    slug = _slug(conn, data.get('slug'))
    name = _text(data.get('name'), 60, '名称', required=True)
    if conn.execute('SELECT 1 FROM org WHERE name = ?', (name,)).fetchone():
        raise ApiError('state_conflict', '这个团队名称已经被使用')
    conn.execute(
        'INSERT INTO org (id, slug, name, intro, kind, website, banner, join_policy, owner_id, created_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (org_id, slug, name, _text(data.get('intro'), 240, '简介', required=True), kind,
         safe_website(data.get('website')), _text(data.get('banner'), 160, '头图'), policy, actor.id, now, now),
    )
    conn.execute(
        "INSERT INTO org_member (org_id, principal_id, role, state, created_at, updated_at) "
        "VALUES (?, ?, 'owner', 'active', ?, ?)", (org_id, actor.id, now, now),
    )
    outbox.emit(conn, 'org.application_submitted', 'org', org_id,
                {'slug': slug, 'name': name}, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'org.create', 'org', org_id, request_id=request_id,
                 meta={'slug': slug, 'kind': kind})
    return application_view(conn, _org(conn, slug))


def application_view(conn, row):
    return {
        'id': row['id'], 'slug': row['slug'], 'name': row['name'], 'type': row['kind'],
        'typeLabel': KINDS[row['kind']], 'status': row['status'], 'verified': bool(row['verified']),
        'joinPolicy': row['join_policy'], 'website': row['website'], 'createdAt': row['created_at'],
    }


def review(conn, actor, org_id, decision, note='', request_id=None):
    require(conn, actor, 'orgs.review')
    if decision not in ('approve', 'reject'):
        raise ApiError('validation_failed', '审核结果只能是通过或拒绝')
    row = conn.execute('SELECT * FROM org WHERE id = ?', (org_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['status'] != 'pending':
        raise ApiError('state_conflict', '这条申请已经处理过了')
    status = 'approved' if decision == 'approve' else 'rejected'
    now = clock.now()
    conn.execute('UPDATE org SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ?, updated_at = ? '
                 'WHERE id = ?', (status, now, actor.id, _text(note, 300, '审核说明'), now, org_id))
    outbox.emit(conn, 'org.application_reviewed', 'org', org_id,
                {'recipient_id': row['owner_id'], 'slug': row['slug'], 'decision': decision},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'org.review', 'org', org_id, request_id=request_id,
                 meta={'decision': decision})
    return application_view(conn, conn.execute('SELECT * FROM org WHERE id = ?', (org_id,)).fetchone())


def set_verified(conn, actor, slug, verified, request_id=None):
    require(conn, actor, 'orgs.verify')
    row = _org(conn, slug)
    if row['status'] != 'approved':
        raise ApiError('state_conflict', '只有已上线团队可以认证')
    conn.execute('UPDATE org SET verified = ?, updated_at = ? WHERE id = ?',
                 (int(bool(verified)), clock.now(), row['id']))
    audit.record(conn, actor.id, 'org.verify', 'org', row['id'], request_id=request_id,
                 meta={'verified': bool(verified)})
    return {'slug': slug, 'verified': bool(verified)}


def _visible_objects(conn, actor):
    pred = visible_predicate(actor, 'h')
    sql, params = pred.sql, {**pred.params, 'me': actor.id}
    if _table(conn, 'social_block'):
        sql += (' AND NOT EXISTS (SELECT 1 FROM social_block sb '
                'WHERE (sb.blocker_id = :me AND sb.blocked_id = h.author_id) '
                'OR (sb.blocked_id = :me AND sb.blocker_id = h.author_id))')
    return sql, params


def _counts(conn, actor, org_id):
    members = len(_people(conn, actor, org_id))
    followers = conn.execute('SELECT count(*) FROM org_follow WHERE org_id = ?', (org_id,)).fetchone()[0]
    sql, params = _visible_objects(conn, actor)
    activity = conn.execute(
        'SELECT count(*) FROM org_object oo JOIN object_head h ON h.id = oo.object_id '
        f'WHERE oo.org_id = :org AND {sql}', {**params, 'org': org_id}).fetchone()[0]
    return int(members), int(followers), int(activity)


def _base_view(conn, actor, row):
    members, followers, activity = _counts(conn, actor, row['id'])
    mine = _member(conn, row['id'], actor.id)
    return {
        'id': row['id'], 'slug': row['slug'], 'name': row['name'], 'intro': row['intro'],
        'type': row['kind'], 'typeLabel': KINDS[row['kind']], 'website': row['website'],
        'banner': row['banner'], 'verified': bool(row['verified']), 'joinPolicy': row['join_policy'],
        'joinPolicyLabel': JOIN_POLICIES[row['join_policy']], 'members': members, 'followers': followers,
        'activity': activity, 'followed': conn.execute('SELECT 1 FROM org_follow WHERE org_id = ? AND principal_id = ?',
                                                      (row['id'], actor.id)).fetchone() is not None,
        'me': {'state': mine['state'] if mine else 'none', 'role': mine['role'] if mine and mine['state'] == 'active' else None,
               'showOnProfile': bool(mine['show_on_profile']) if mine else False},
    }


def list_orgs(conn, actor, kind=None, q=None, sort='activity'):
    require(conn, actor, 'orgs.read')
    if kind and kind not in KINDS:
        raise ApiError('validation_failed', '不认识的团队类型')
    if sort not in ('activity', 'followers'):
        raise ApiError('validation_failed', '排序只能是活跃度或关注数')
    q = _text(q, 80, '搜索') if q else ''
    rows = conn.execute(
        "SELECT o.* FROM org o WHERE o.status = 'approved' AND (? IS NULL OR o.kind = ?) "
        "AND (? = '' OR o.name LIKE ? ESCAPE '!' OR o.intro LIKE ? ESCAPE '!') ORDER BY o.name",
        (kind, kind, q, f'%{q.replace("!", "!!").replace("%", "!%").replace("_", "!_")}%',
         f'%{q.replace("!", "!!").replace("%", "!%").replace("_", "!_")}%'),
    ).fetchall()
    data = [_base_view(conn, actor, row) for row in rows if not _blocked(conn, actor.id, row['owner_id'])]
    data.sort(key=lambda item: (-item['followers'] if sort == 'followers' else -(item['activity'] * 3 + item['members']),
                                item['name']))
    return data


def _people(conn, actor, org_id):
    rows = conn.execute(
        "SELECT m.principal_id AS id, m.role, m.show_on_profile, m.created_at, p.display_name AS name, "
        "p.level, p.avatar_ref AS avatar, c.handle FROM org_member m JOIN profile p ON p.principal_id = m.principal_id "
        "LEFT JOIN credential c ON c.principal_id = m.principal_id WHERE m.org_id = ? AND m.state = 'active' "
        "ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at",
        (org_id,),
    ).fetchall()
    return [dict(row, showOnProfile=bool(row['show_on_profile'])) for row in rows
            if not _blocked(conn, actor.id, row['id'])]


def _objects(conn, actor, org_id, kind):
    sql, params = _visible_objects(conn, actor)
    rows = conn.execute(
        'SELECT h.id, h.type, h.author_id, h.created_at, v.title, v.content_json, p.display_name AS author_name, '
        'p.level AS author_level, c.handle AS author_handle FROM org_object oo JOIN object_head h ON h.id = oo.object_id '
        'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
        'JOIN profile p ON p.principal_id = h.author_id LEFT JOIN credential c ON c.principal_id = h.author_id '
        f'WHERE oo.org_id = :org AND oo.kind = :kind AND {sql} ORDER BY oo.created_at DESC LIMIT 40',
        {'org': org_id, 'kind': kind, **params},
    ).fetchall()
    out = []
    for row in rows:
        content = json.loads(row['content_json'])
        out.append({'id': row['id'], 'type': row['type'], 'title': row['title'], 'body': content.get('body', ''),
                    'summary': content.get('summary', ''), 'createdAt': row['created_at'],
                    'author': {'id': row['author_id'], 'name': row['author_name'], 'level': row['author_level'],
                               'handle': row['author_handle']}})
    return out


def _market_jobs(conn, actor, name):
    if not _table(conn, 'market_listing'):
        return []
    try:
        from modules.market import service as market
        rows, _ = market.page(conn, actor, category='jobs', status='active', q=name, size=40)
        return [market.dto(conn, actor, row) for row in rows if row['company'] == name]
    except (ImportError, ApiError):
        return []


def _events(conn, actor, name):
    if not _table(conn, 'community_event'):
        return []
    try:
        from modules.events import service as events
        return [row for row in events.list_events(conn, actor) if row.get('host') == name]
    except (ImportError, ApiError):
        return []


def detail(conn, actor, slug):
    require(conn, actor, 'orgs.read')
    row = _org(conn, slug, public=True)
    if _blocked(conn, actor.id, row['owner_id']):
        raise ApiError('resource_not_found')
    data = _base_view(conn, actor, row)
    data.update(membersList=_people(conn, actor, row['id']), posts=_objects(conn, actor, row['id'], 'post'),
                works=_objects(conn, actor, row['id'], 'work'), jobs=_market_jobs(conn, actor, row['name']),
                events=_events(conn, actor, row['name']))
    mine = _member(conn, row['id'], actor.id)
    if mine and mine['state'] == 'active' and mine['role'] in ('owner', 'admin'):
        data['pendingApplications'] = len(_visible_application_rows(conn, actor, row['id'], 'pending'))
    return data


def join(conn, actor, slug, note='', show_on_profile=True, request_id=None):
    require(conn, actor, 'orgs.join')
    org = _org(conn, slug, public=True)
    if _blocked(conn, actor.id, org['owner_id']):
        raise ApiError('resource_not_found')
    current = _member(conn, org['id'], actor.id)
    now = clock.now()
    if current and current['state'] == 'active':
        conn.execute('UPDATE org_member SET show_on_profile = ?, updated_at = ? WHERE org_id = ? AND principal_id = ?',
                     (int(bool(show_on_profile)), now, org['id'], actor.id))
    elif current and current['state'] == 'invited':
        conn.execute("UPDATE org_member SET state = 'active', show_on_profile = ?, updated_at = ? "
                     'WHERE org_id = ? AND principal_id = ?',
                     (int(bool(show_on_profile)), now, org['id'], actor.id))
        outbox.emit(conn, 'org.invitation_accepted', 'org', org['id'],
                    {'recipient_id': current['invited_by'], 'principal_id': actor.id, 'slug': slug},
                    actor_id=actor.id, request_id=request_id)
    elif current and current['state'] == 'pending':
        return {'state': 'pending', 'role': None, 'showOnProfile': bool(current['show_on_profile'])}
    else:
        if org['join_policy'] != 'apply':
            raise ApiError('action_not_allowed', '这个团队只接受邀请加入')
        conn.execute(
            "INSERT INTO org_member (org_id, principal_id, role, state, show_on_profile, note, applied_at, created_at, "
            "updated_at) VALUES (?, ?, 'member', 'pending', ?, ?, ?, ?, ?) ON CONFLICT(org_id, principal_id) DO UPDATE SET "
            "role = 'member', state = 'pending', show_on_profile = excluded.show_on_profile, note = excluded.note, "
            "applied_at = excluded.applied_at, reviewed_by = NULL, reviewed_at = NULL, review_note = '', "
            'updated_at = excluded.updated_at',
            (org['id'], actor.id, int(bool(show_on_profile)), _text(note, 200, '申请说明'), now, now, now),
        )
        recipients = [row[0] for row in conn.execute(
            "SELECT principal_id FROM org_member WHERE org_id = ? AND state = 'active' AND role IN ('owner', 'admin') "
            'ORDER BY created_at', (org['id'],)) if not _blocked(conn, actor.id, row[0])]
        outbox.emit(conn, 'org.join_requested', 'org', org['id'],
                    {'recipient_id': recipients, 'principal_id': actor.id, 'slug': slug, 'message': f'申请加入「{org["name"]}」'},
                    actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'org.join', 'org', org['id'], request_id=request_id)
    member = _member(conn, org['id'], actor.id)
    return {'state': member['state'], 'role': member['role'] if member['state'] == 'active' else None,
            'showOnProfile': bool(member['show_on_profile'])}


def set_member(conn, actor, slug, principal_id, role='member', state='active', request_id=None):
    org = _org(conn, slug, public=True)
    manager = _manager(conn, actor, org)
    if role not in ('owner', 'admin', 'member') or state not in ('active', 'invited', 'rejected'):
        raise ApiError('validation_failed', '成员角色或状态不正确')
    target = conn.execute("SELECT 1 FROM principal WHERE id = ? AND status = 'active'", (principal_id,)).fetchone()
    if target is None or principal_id == actor.id or _blocked(conn, actor.id, principal_id):
        raise ApiError('resource_not_found')
    current = _member(conn, org['id'], principal_id)
    if manager['role'] != 'owner':
        if role != 'member' or (current and current['role'] in ('owner', 'admin')):
            raise ApiError('action_not_allowed')
    now = clock.now()
    if role == 'owner':
        _manager(conn, actor, org, owner=True)
        if state != 'active' or not current or current['state'] != 'active':
            raise ApiError('state_conflict', '只能把所有权转给在任成员')
        conn.execute("UPDATE org_member SET role = 'admin', updated_at = ? WHERE org_id = ? AND principal_id = ?",
                     (now, org['id'], actor.id))
        conn.execute("UPDATE org_member SET role = 'owner', updated_at = ? WHERE org_id = ? AND principal_id = ?",
                     (now, org['id'], principal_id))
        conn.execute('UPDATE org SET owner_id = ?, updated_at = ? WHERE id = ?', (principal_id, now, org['id']))
    else:
        if state == 'invited' and current and current['state'] == 'active':
            raise ApiError('state_conflict', '成员已经加入')
        conn.execute(
            'INSERT INTO org_member (org_id, principal_id, role, state, invited_by, created_at, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(org_id, principal_id) DO UPDATE SET role = excluded.role, '
            'state = excluded.state, invited_by = excluded.invited_by, updated_at = excluded.updated_at',
            (org['id'], principal_id, role, state, actor.id if state == 'invited' else None, now, now),
        )
    event = 'org.member_invited' if state == 'invited' else 'org.member_updated'
    outbox.emit(conn, event, 'org', org['id'],
                {'recipient_id': principal_id, 'slug': slug, 'role': role, 'state': state},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'org.member.role', 'principal', principal_id, request_id=request_id,
                 meta={'org_id': org['id'], 'role': role, 'state': state})
    member = _member(conn, org['id'], principal_id)
    return {'id': principal_id, 'role': member['role'], 'state': member['state']}


def follow(conn, actor, slug, on=True, request_id=None):
    require(conn, actor, 'orgs.follow')
    org = _org(conn, slug, public=True)
    if _blocked(conn, actor.id, org['owner_id']):
        raise ApiError('resource_not_found')
    if on:
        conn.execute('INSERT OR IGNORE INTO org_follow (org_id, principal_id, created_at) VALUES (?, ?, ?)',
                     (org['id'], actor.id, clock.now()))
    else:
        conn.execute('DELETE FROM org_follow WHERE org_id = ? AND principal_id = ?', (org['id'], actor.id))
    audit.record(conn, actor.id, 'org.follow' if on else 'org.unfollow', 'org', org['id'], request_id=request_id)
    return {'followed': bool(on), 'followers': _counts(conn, actor, org['id'])[1]}


def create_post(conn, actor, slug, data, request_id=None):
    org = _org(conn, slug, public=True)
    member = _member(conn, org['id'], actor.id)
    if not member or member['state'] != 'active':
        raise ApiError('action_not_allowed')
    object_id = objects.create(conn, actor, type='org_post', title=data.get('title'), content=data.get('content'),
                               visibility=data.get('visibility', 'members'), min_level=data.get('min_level', 1),
                               request_id=request_id)
    conn.execute("INSERT INTO org_object (org_id, object_id, kind, attached_by, created_at) VALUES (?, ?, 'post', ?, ?)",
                 (org['id'], object_id, actor.id, clock.now()))
    return object_id


def attach_work(conn, actor, slug, object_id, request_id=None):
    org = _org(conn, slug, public=True)
    member = _member(conn, org['id'], actor.id)
    if not member or member['state'] != 'active':
        raise ApiError('action_not_allowed')
    head = objects.load_visible(conn, actor, object_id)
    if head['author_id'] != actor.id or head['type'] != 'work':
        raise ApiError('action_not_allowed')
    conn.execute("INSERT OR IGNORE INTO org_object (org_id, object_id, kind, attached_by, created_at) "
                 "VALUES (?, ?, 'work', ?, ?)", (org['id'], object_id, actor.id, clock.now()))
    audit.record(conn, actor.id, 'org.work.attach', 'object', object_id, request_id=request_id,
                 meta={'org_id': org['id']})
    return {'id': object_id, 'attached': True}


APPLICATION_STATES = {'pending': 'pending', 'approved': 'active', 'rejected': 'rejected'}
APPLICATION_STATUS = {state: status for status, state in APPLICATION_STATES.items()}


def _visible_application_rows(conn, actor, org_id, status):
    """拉黑滤完再交给分页。待审按申请时间从早到晚，已处理的按处理时间从新到旧。"""
    order = 'm.applied_at, m.principal_id' if status == 'pending' else 'm.reviewed_at DESC, m.principal_id'
    rows = conn.execute(
        'SELECT m.principal_id AS id, m.note, m.applied_at, m.reviewed_at, m.review_note, p.display_name AS name, '
        'p.level, c.handle FROM org_member m JOIN profile p ON p.principal_id = m.principal_id '
        'LEFT JOIN credential c ON c.principal_id = m.principal_id '
        f'WHERE m.org_id = ? AND m.state = ? AND m.applied_at IS NOT NULL ORDER BY {order}',
        (org_id, APPLICATION_STATES[status]),
    ).fetchall()
    return [row for row in rows if not _blocked(conn, actor.id, row['id'])]


def _application_mark(status, row):
    if status == 'pending':
        return (row['applied_at'] or '', row['id'])
    return (row['reviewed_at'] or '', row['id'])


def _applications_after(rows, status, keys):
    if not keys:
        return list(rows)
    mark = (keys[0], keys[1])
    if status == 'pending':
        return [row for row in rows if _application_mark(status, row) > mark]
    return [row for row in rows
            if (row['reviewed_at'] or '') < mark[0]
            or ((row['reviewed_at'] or '') == mark[0] and row['id'] > mark[1])]


def _application_view(row, status):
    return {'id': row['id'], 'handle': row['handle'], 'name': row['name'], 'level': row['level'],
            'note': row['note'], 'status': status, 'appliedAt': row['applied_at'],
            'reviewedAt': row['reviewed_at'], 'reviewNote': row['review_note']}


def applications(conn, actor, slug, status='pending', limit=None, cursor=None, settings=None):
    org = _org(conn, slug, public=True)
    _manager(conn, actor, org)
    if status not in APPLICATION_STATES:
        raise ApiError('validation_failed', '申请状态只能是待审、已通过或已拒绝')
    visible = _visible_application_rows(conn, actor, org['id'], status)
    size = page_size(limit)
    qhash = query_hash('orgs.applications', actor.id, org['id'], status)
    keys = decode(settings, cursor, actor.id, qhash) if cursor else None
    page_rows, next_cursor = page(
        settings, actor.id, qhash, _applications_after(visible, status, keys), size,
        lambda row: list(_application_mark(status, row)))
    return [_application_view(row, status) for row in page_rows], next_cursor


def review_application(conn, actor, slug, principal_id, decision, note='', request_id=None):
    org = _org(conn, slug, public=True)
    _manager(conn, actor, org)
    if decision not in ('approve', 'reject'):
        raise ApiError('validation_failed', '审核结果只能是通过或拒绝')
    note = _text(note, 300, '处理说明')
    row = _member(conn, org['id'], principal_id)
    if row is None or principal_id == actor.id or _blocked(conn, actor.id, principal_id):
        raise ApiError('resource_not_found')
    if row['state'] != 'pending':
        raise ApiError('state_conflict', '这条申请已经处理过了')
    state = 'active' if decision == 'approve' else 'rejected'
    now = clock.now()
    conn.execute('UPDATE org_member SET state = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? '
                 'WHERE org_id = ? AND principal_id = ?', (state, actor.id, now, note, now, org['id'], principal_id))
    outbox.emit(conn, 'org.join_decided', 'org', org['id'],
                {'recipient_id': principal_id, 'slug': slug, 'decision': decision,
                 'message': f'你申请加入「{org["name"]}」{"已通过" if decision == "approve" else "未通过"}'},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'org.join.review', 'principal', principal_id, request_id=request_id,
                 meta={'org_id': org['id'], 'decision': decision})
    return {'id': principal_id, 'status': APPLICATION_STATUS[state], 'reviewedAt': now, 'reviewNote': note}


def my_applications(conn, actor):
    require(conn, actor, 'orgs.read')
    rows = conn.execute(
        'SELECT m.state, m.note, m.applied_at, m.reviewed_at, m.review_note, o.slug, o.name, o.kind, o.owner_id '
        "FROM org_member m JOIN org o ON o.id = m.org_id WHERE m.principal_id = ? AND o.status = 'approved' "
        "AND m.applied_at IS NOT NULL AND m.state IN ('pending', 'active', 'rejected') ORDER BY m.applied_at DESC, o.slug",
        (actor.id,),
    ).fetchall()
    return [{'slug': row['slug'], 'name': row['name'], 'type': row['kind'], 'typeLabel': KINDS[row['kind']],
             'status': APPLICATION_STATUS[row['state']], 'note': row['note'], 'appliedAt': row['applied_at'],
             'reviewedAt': row['reviewed_at'], 'reviewNote': row['review_note']}
            for row in rows if not _blocked(conn, actor.id, row['owner_id'])]


def post_detail(conn, actor, slug, object_id):
    require(conn, actor, 'orgs.read')
    org = _org(conn, slug, public=True)
    if _blocked(conn, actor.id, org['owner_id']):
        raise ApiError('resource_not_found')
    sql, params = _visible_objects(conn, actor)
    row = conn.execute(
        'SELECT h.id, h.author_id, h.created_at, v.title, v.content_json, v.created_at AS updated_at, '
        'p.display_name AS author_name, p.level AS author_level, c.handle AS author_handle '
        'FROM org_object oo JOIN object_head h ON h.id = oo.object_id '
        'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
        'JOIN profile p ON p.principal_id = h.author_id LEFT JOIN credential c ON c.principal_id = h.author_id '
        f"WHERE oo.org_id = :org AND oo.object_id = :oid AND oo.kind = 'post' AND h.type = 'org_post' AND {sql}",
        {'org': org['id'], 'oid': object_id, **params},
    ).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    content = json.loads(row['content_json'])
    return {'id': row['id'], 'title': row['title'], 'body': content.get('body', ''),
            'summary': content.get('summary', ''), 'tags': content.get('tags', []),
            'createdAt': row['created_at'], 'updatedAt': row['updated_at'],
            'org': {'slug': org['slug'], 'name': org['name']},
            'author': {'id': row['author_id'], 'name': row['author_name'], 'level': row['author_level'],
                       'handle': row['author_handle']}}


def purge(conn, principal_id):
    owned = conn.execute(
        "SELECT o.* FROM org o JOIN org_member m ON m.org_id = o.id WHERE m.principal_id = ? "
        "AND m.role = 'owner' AND m.state = 'active'", (principal_id,),
    ).fetchall()
    now = clock.now()
    for org in owned:
        heir = conn.execute(
            "SELECT principal_id FROM org_member WHERE org_id = ? AND principal_id != ? AND role = 'admin' "
            "AND state = 'active' ORDER BY created_at, principal_id LIMIT 1", (org['id'], principal_id),
        ).fetchone()
        if heir:
            conn.execute("UPDATE org_member SET role = 'owner', updated_at = ? WHERE org_id = ? AND principal_id = ?",
                         (now, org['id'], heir[0]))
            conn.execute('UPDATE org SET owner_id = ?, updated_at = ? WHERE id = ?', (heir[0], now, org['id']))
            outbox.emit(conn, 'org.ownership_transferred', 'org', org['id'],
                        {'recipient_id': heir[0], 'slug': org['slug'], 'reason': 'owner_deleted'})
        else:
            conn.execute("UPDATE org SET owner_id = NULL, status = 'frozen', updated_at = ? WHERE id = ?",
                         (now, org['id']))
            outbox.emit(conn, 'org.owner_missing', 'org', org['id'],
                        {'slug': org['slug'], 'reason': 'owner_deleted', 'notify': 'governance'})
    conn.execute('DELETE FROM org_follow WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM org_member WHERE principal_id = ?', (principal_id,))
