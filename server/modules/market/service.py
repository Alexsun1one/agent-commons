"""R13 MARKET-1 · 市集服务。

对象仍由核心 objects 管理：类型、版本、ACL、检索、撤回、outbox、审计都在同一条事务里。
市集表只放分类、状态、结构化字段和到期时间；读一律先过 visible_predicate，看不见就 404。
"""

from __future__ import annotations

import json
import re
import uuid
from contextvars import ContextVar

from app import audit, clock, objects, outbox, pagination
from app.authz import require, visible_predicate
from app.errors import ApiError
from modules.admin import params as admin_params

admin_params.declare('market', 'l1_daily_listings', 'expire_days')


def _param(conn, key, fallback):
    return int(admin_params.value(conn, 'market', key, fallback))

from modules.media import service as media_service

from . import logic

TYPE = 'market_listing'
_ALLOW_CREATE = ContextVar('market_allow_create', default=False)
ASSET_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')

CONTENT_KEYS = ('body', 'category', 'price', 'city', 'shipping', 'condition', 'budget', 'cycle',
                'company', 'position', 'work_mode', 'target', 'deadline', 'images')
TEXT_LIMITS = {
    'price': 40, 'city': 40, 'shipping': 40, 'condition': 40, 'budget': 40, 'cycle': 40,
    'company': 80, 'position': 80, 'work_mode': 40, 'target': 80, 'deadline': 40,
}

LIST_COLUMNS = (
    'h.id, h.type, h.author_id, h.space_id, h.root_id, h.visibility, h.min_level, h.lifecycle, '
    'h.current_version, h.policy_epoch, h.created_at, h.updated_at, h.published_at, '
    'v.title, v.content_json, p.display_name AS author_name, p.level AS author_level, '
    'm.category AS category, m.status AS market_status, m.price, m.city, m.shipping, m.condition, '
    'm.budget, m.cycle, m.company, m.position, m.work_mode, m.target, m.deadline, '
    'm.expires_at, m.created_at AS listed_at, m.updated_at AS market_updated_at'
)

FROM_JOIN = (
    'FROM object_head h '
    'JOIN market_listing m ON m.object_id = h.id '
    'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
    'JOIN profile p ON p.principal_id = h.author_id'
)


def _text(value, limit, *, required=False, label='这个字段'):
    if value is None:
        value = ''
    if not isinstance(value, str):
        raise ApiError('validation_failed', f'{label}必须是文本')
    value = value.strip()
    if len(value) > limit:
        raise ApiError('validation_failed', f'{label}最多 {limit} 个字')
    if required and not value:
        raise ApiError('validation_failed', f'{label}要填')
    return value


def _title(value):
    if not isinstance(value, str):
        raise ApiError('validation_failed', '标题必须是文本')
    value = value.strip()
    if not 1 <= len(value) <= 200:
        raise ApiError('validation_failed', '标题要有 1 到 200 个字')
    return value


def _images(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ApiError('validation_failed', '图片必须是列表')
    if len(value) > logic.MAX_IMAGES:
        raise ApiError('validation_failed', f'最多 {logic.MAX_IMAGES} 张图片')
    out = []
    for item in value:
        if not isinstance(item, str) or not ASSET_ID.match(item):
            raise ApiError('validation_failed', '图片编号不对')
        if item not in out:
            out.append(item)
    return out


def validate(content):
    """objects.register_type('market_listing') 的校验器。

    只允许市集服务自己走 objects.create；通用 /api/objects 入口不能绕过
    禁止品类初筛、每日额度和市集行创建。
    """
    if not _ALLOW_CREATE.get():
        raise ApiError('action_not_allowed', '请从市集发布')
    if not isinstance(content, dict):
        raise ApiError('validation_failed', 'content 必须是对象')
    unknown = set(content) - set(CONTENT_KEYS)
    if unknown:
        raise ApiError('unknown_field', f'content 不认识的字段：{", ".join(sorted(unknown))}')
    category = content.get('category')
    if category not in logic.CATEGORIES:
        raise ApiError('validation_failed', '不认识的市集分类')
    body = content.get('body')
    if not isinstance(body, str):
        raise ApiError('validation_failed', '说明必须是文本')
    body = body.strip()
    if not body:
        raise ApiError('validation_failed', '说明要写一点')
    if len(body) > logic.MAX_BODY:
        raise ApiError('validation_failed', f'说明最多 {logic.MAX_BODY} 个字')
    out = {'body': body, 'category': category, 'images': _images(content.get('images'))}
    for key, limit in TEXT_LIMITS.items():
        out[key] = _text(content.get(key), limit, label=logic.field_label(key))
    for key in logic.required_fields(category):
        if not out[key]:
            raise ApiError('validation_failed', f'{logic.field_label(key)}要填')
    if category == 'free' and not out['price']:
        out['price'] = '免费'
    return out


def text(content):
    parts = [logic.category_label(content.get('category', ''))]
    parts.append(content.get('body', ''))
    for key in logic.FIELD_LABELS:
        value = content.get(key)
        if value:
            parts.append(str(value))
    return '\n'.join(part for part in parts if part)


objects.register_type(TYPE, validate, text)


# ---------------------------------------------------------------- 读


def _like(value):
    return value.replace('!', '!!').replace('%', '!%').replace('_', '!_')


def _where(actor, *, category=None, status=None, q=None, mine=False):
    pred = visible_predicate(actor)
    clauses = [pred.sql, "h.type = 'market_listing'"]
    params = dict(pred.params)
    if category and category != 'all':
        clauses.append('m.category = :category')
        params['category'] = category
    if status and status != 'all':
        clauses.append('m.status = :status')
        params['status'] = status
    elif not mine:
        clauses.append("m.status IN ('active', 'reserved')")
    if mine:
        clauses.append('h.author_id = :author_id')
        params['author_id'] = actor.id
    needle = logic.normalize_text(q)
    if needle:
        clauses.append(
            "(v.title LIKE :q ESCAPE '!' OR v.content_json LIKE :q ESCAPE '!' OR m.city LIKE :q ESCAPE '!' "
            "OR m.company LIKE :q ESCAPE '!' OR m.position LIKE :q ESCAPE '!' OR m.target LIKE :q ESCAPE '!')")
        params['q'] = f'%{_like(needle)}%'
    return ' AND '.join(clauses), params


def list_rows(conn, actor, *, category=None, status=None, q=None, mine=False, after=None, limit=20):
    where, params = _where(actor, category=category, status=status, q=q, mine=mine)
    if after:
        where += ' AND (h.created_at, h.id) < (:c_at, :c_id)'
        params.update(c_at=after[0], c_id=after[1])
    sql = f'SELECT {LIST_COLUMNS} {FROM_JOIN} WHERE {where} ORDER BY h.created_at DESC, h.id DESC LIMIT :n'
    return conn.execute(sql, {**params, 'n': limit}).fetchall()


def count_rows(conn, actor, *, category=None, status=None, q=None, mine=False):
    where, params = _where(actor, category=category, status=status, q=q, mine=mine)
    sql = (f'SELECT count(*) FROM object_head h JOIN market_listing m ON m.object_id = h.id '
           f'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version WHERE {where}')
    return conn.execute(sql, params).fetchone()[0]


def detail_row(conn, actor, object_id):
    head = objects.load_visible(conn, actor, object_id)
    if head['type'] != TYPE:
        raise ApiError('resource_not_found')
    row = conn.execute(f'SELECT {LIST_COLUMNS} {FROM_JOIN} WHERE h.id = ?', (object_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def interactions(conn, actor, ids):
    ids = [object_id for object_id in dict.fromkeys(ids) if object_id]
    wanted, counts = set(), {}
    if not ids:
        return wanted, counts
    marks = ','.join('?' * len(ids))
    for row in conn.execute(f'SELECT object_id, count(*) AS n FROM market_interest '
                            f'WHERE object_id IN ({marks}) GROUP BY object_id', ids):
        counts[row['object_id']] = row['n']
    for row in conn.execute(f'SELECT object_id FROM market_interest WHERE principal_id = ? '
                            f'AND object_id IN ({marks})', (actor.id, *ids)):
        wanted.add(row['object_id'])
    return wanted, counts


def _images_meta(conn, actor, content, content_origin=''):
    ids = content.get('images') or []
    if not ids or not actor.authenticated or not media_service.installed(conn):
        return []
    metas = media_service.assets_meta(conn, actor, ids, content_origin)
    return [metas[asset_id] for asset_id in ids if asset_id in metas]


def _report_count(conn, object_id):
    return conn.execute("SELECT count(*) FROM market_report WHERE object_id = ? AND status = 'open'",
                        (object_id,)).fetchone()[0]


def dto(conn, actor, row, *, full=False, content_origin='', wanted=None, counts=None):
    content = json.loads(row['content_json'])
    category = row['category']
    images = _images_meta(conn, actor, content, content_origin)
    if wanted is None or counts is None:
        wanted, counts = interactions(conn, actor, [row['id']])
    mine = row['author_id'] == actor.id
    body = content.get('body', '')
    data = {
        'id': row['id'],
        'type': TYPE,
        'title': row['title'],
        'category': category,
        'category_label': logic.category_label(category),
        'status': row['market_status'],
        'status_label': logic.status_label(category, row['market_status']),
        'active_label': logic.active_label(category),
        'price': row['price'],
        'city': row['city'],
        'shipping': row['shipping'],
        'condition': row['condition'],
        'budget': row['budget'],
        'cycle': row['cycle'],
        'company': row['company'],
        'position': row['position'],
        'work_mode': row['work_mode'],
        'target': row['target'],
        'deadline': row['deadline'],
        'images': images,
        'cover': images[0] if images else None,
        'author': {'id': row['author_id'], 'display_name': row['author_name'], 'level': row['author_level']},
        'visibility': row['visibility'],
        'min_level': row['min_level'],
        'created_at': row['created_at'],
        'listed_at': row['listed_at'],
        'expires_at': row['expires_at'],
        'updated_at': row['market_updated_at'],
        'etag': objects.etag(row),
        'mine': mine,
        'wanted': row['id'] in wanted,
        'want_count': counts.get(row['id'], 0),
    }
    if full:
        data['body'] = body
    else:
        data['excerpt'] = body[:120]
    if mine or {'admin', 'governor'} & set(actor.roles):
        data['report_count'] = _report_count(conn, row['id'])
    return data


# ---------------------------------------------------------------- 写


def daily_count(conn, author_id, now):
    start = f'{now[:10]}T00:00:00.000000Z'
    return conn.execute(
        'SELECT count(*) FROM market_listing m JOIN object_head h ON h.id = m.object_id '
        "WHERE h.author_id = ? AND h.type = ? AND h.created_at >= ?", (author_id, TYPE, start)).fetchone()[0]


def _check_images(conn, actor, ids):
    if not ids:
        return []
    if not media_service.installed(conn):
        raise ApiError('capability_unavailable', '图片上传还没开放')
    marks = ','.join('?' * len(ids))
    rows = conn.execute(
        f"SELECT id FROM media_asset WHERE owner_id = ? AND state = 'ready' "
        f"AND purpose IN ('image', 'thumbnail') AND id IN ({marks})", (actor.id, *ids)).fetchall()
    if {row['id'] for row in rows} != set(ids):
        raise ApiError('validation_failed', '图片还没处理好，或者不是你的')
    return ids


def create(conn, actor, body, request_id=None):
    title = _title(body.get('title'))
    token = _ALLOW_CREATE.set(True)
    try:
        content = validate({
            'body': body.get('body'), 'category': body.get('category'), 'images': body.get('images'),
            **{key: body.get(key) for key in TEXT_LIMITS if key in body},
        })
        probe = '\n'.join([title, content['body']] + [content[key] for key in logic.FIELD_LABELS if content.get(key)])
        hit = logic.screen(probe)
        if hit:
            raise ApiError('market_forbidden', f"这个品类不能发布：{hit['label']}", rule=hit['rule'])
        now = clock.now()
        used = daily_count(conn, actor.id, now)
        limit = logic.daily_limit(actor.level, _param(conn, 'l1_daily_listings', logic.DAILY_LIMITS[1]))
        if used >= limit:
            raise ApiError('market_daily_limit', f'今天最多发布 {limit} 条',
                           retry_after_seconds=logic.seconds_to_midnight(now))
        content['images'] = _check_images(conn, actor, content['images'])
        object_id = objects.create(
            conn, actor, type=TYPE, title=title, content=content,
            visibility=body.get('visibility', 'members'), min_level=body.get('min_level', 1),
            space_id=body.get('space_id'), acl=body.get('acl', []), lifecycle='active',
            request_id=request_id)
        expires_at = clock.iso(clock.parse(now) + _param(conn, 'expire_days', logic.EXPIRY_DAYS) * 86400)
        conn.execute(
            'INSERT INTO market_listing (object_id, category, status, price, city, shipping, condition, budget, '
            'cycle, company, position, work_mode, target, deadline, expires_at, created_at, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (object_id, content['category'], 'active', content['price'], content['city'], content['shipping'],
             content['condition'], content['budget'], content['cycle'], content['company'], content['position'],
             content['work_mode'], content['target'], content['deadline'], expires_at, now, now))
        if media_service.installed(conn):
            media_service.link_object(conn, object_id)
        outbox.emit(conn, 'market.listing.created', TYPE, object_id,
                    {'category': content['category'], 'status': 'active'}, version=1,
                    space_id=body.get('space_id'), actor_id=actor.id, request_id=request_id)
        audit.record(conn, actor.id, 'market.publish', TYPE, object_id, request_id=request_id,
                     meta={'category': content['category']})
        return object_id
    finally:
        _ALLOW_CREATE.reset(token)


def set_status(conn, actor, object_id, target, request_id=None):
    row = detail_row(conn, actor, object_id)
    require(conn, actor, 'market.status', {'author_id': row['author_id']})
    if target not in ('active', 'reserved', 'sold'):
        raise ApiError('validation_failed', '只能标为在售、已预订或已成交')
    current = row['market_status']
    if target == current:
        return object_id
    if current == 'expired' and target != 'active':
        raise ApiError('market_status_invalid', '已经过期，只能重新上架')
    if current == 'sold' and target != 'active':
        raise ApiError('market_status_invalid', '已经成交，只能重新上架')
    if target == 'reserved' and current != 'active':
        raise ApiError('market_status_invalid', '只有在售的帖子可以标为已预订')
    if target == 'sold' and current not in ('active', 'reserved'):
        raise ApiError('market_status_invalid', '当前状态不能标为已成交')
    if target == 'active' and current not in ('reserved', 'sold', 'expired'):
        raise ApiError('market_status_invalid', '当前状态不能改回在售')
    now = clock.now()
    expires_at = row['expires_at']
    if current in ('sold', 'expired') and target == 'active':
        expires_at = clock.iso(clock.parse(now) + _param(conn, 'expire_days', logic.EXPIRY_DAYS) * 86400)
    conn.execute('UPDATE market_listing SET status = ?, expires_at = ?, updated_at = ? WHERE object_id = ?',
                 (target, expires_at, now, object_id))
    outbox.emit(conn, 'market.listing.status', TYPE, object_id, {'from': current, 'to': target},
                version=row['current_version'], space_id=row['space_id'], actor_id=actor.id,
                request_id=request_id, policy_epoch=row['policy_epoch'])
    audit.record(conn, actor.id, 'market.status', TYPE, object_id, request_id=request_id,
                 meta={'from': current, 'to': target})
    return object_id


def want(conn, actor, object_id, request_id=None):
    require(conn, actor, 'market.want')
    row = detail_row(conn, actor, object_id)
    if row['author_id'] == actor.id:
        raise ApiError('state_conflict', '不能对自己的帖子表达想要')
    if row['market_status'] != 'active':
        raise ApiError('state_conflict', '这条帖子已经不在征集中')
    now = clock.now()
    cur = conn.execute('INSERT OR IGNORE INTO market_interest (object_id, principal_id, created_at) '
                       'VALUES (?, ?, ?)', (object_id, actor.id, now))
    created = cur.rowcount > 0
    if created:
        outbox.emit(conn, 'market.wanted', TYPE, object_id,
                    {'recipient_id': row['author_id'], 'actor_id': actor.id}, version=row['current_version'],
                    space_id=row['space_id'], actor_id=actor.id, request_id=request_id,
                    policy_epoch=row['policy_epoch'])
        audit.record(conn, actor.id, 'market.want', TYPE, object_id, request_id=request_id)
    count = conn.execute('SELECT count(*) FROM market_interest WHERE object_id = ?', (object_id,)).fetchone()[0]
    return {'wanted': True, 'created': created, 'count': count}


def report(conn, actor, object_id, reason_code, note='', request_id=None):
    require(conn, actor, 'market.report')
    row = detail_row(conn, actor, object_id)
    if row['author_id'] == actor.id:
        raise ApiError('state_conflict', '不能举报自己的帖子')
    if reason_code not in logic.REPORT_REASONS:
        raise ApiError('validation_failed', '不认识的举报理由')
    note = _text(note, 500, label='补充说明')
    report_id = str(uuid.uuid4())
    cur = conn.execute(
        'INSERT OR IGNORE INTO market_report (id, object_id, reporter_id, reason_code, note, status, created_at) '
        "VALUES (?, ?, ?, ?, ?, 'open', ?)",
        (report_id, object_id, actor.id, reason_code, note, clock.now()))
    if cur.rowcount:
        outbox.emit(conn, 'market.reported', TYPE, object_id,
                    {'object_id': object_id, 'reporter_id': actor.id, 'reason_code': reason_code},
                    version=row['current_version'], space_id=row['space_id'], actor_id=actor.id,
                    request_id=request_id, policy_epoch=row['policy_epoch'])
        audit.record(conn, actor.id, 'market.report', TYPE, object_id, reason=reason_code,
                     request_id=request_id)
        return {'id': report_id, 'created': True}
    existing = conn.execute(
        "SELECT id FROM market_report WHERE object_id = ? AND reporter_id = ? AND status = 'open'",
        (object_id, actor.id)).fetchone()
    return {'id': existing['id'] if existing else report_id, 'created': False}


# ---------------------------------------------------------------- 到期与治理队列


def due_ids(conn, now=None, limit=200):
    now = now or clock.now()
    return [row[0] for row in conn.execute(
        "SELECT object_id FROM market_listing WHERE status IN ('active', 'reserved') AND expires_at <= ? "
        'ORDER BY expires_at LIMIT ?', (now, limit))]


def expire_due(conn, now=None, limit=200):
    now = now or clock.now()
    done = 0
    for object_id in due_ids(conn, now, limit):
        row = conn.execute('SELECT category, status FROM market_listing WHERE object_id = ?',
                           (object_id,)).fetchone()
        if row is None:
            continue
        cur = conn.execute("UPDATE market_listing SET status = 'expired', updated_at = ? "
                           "WHERE object_id = ? AND status IN ('active', 'reserved')", (now, object_id))
        if cur.rowcount:
            outbox.emit(conn, 'market.listing.expired', TYPE, object_id, {'category': row['category']},
                        actor_id=None)
            audit.record(conn, None, 'market.expire', TYPE, object_id, meta={'from': row['status']})
            done += 1
    return done


def reports(conn, actor, status='open', after=None, limit=20):
    pred = visible_predicate(actor, 'h')
    where = 'r.status = :status'
    params = {**pred.params, 'status': status}
    if after:
        where += ' AND (r.created_at, r.id) < (:c_at, :c_id)'
        params.update(c_at=after[0], c_id=after[1])
    sql = (f'SELECT r.*, p.display_name AS reporter_name, '
           f'CASE WHEN {pred.sql} THEN v.title ELSE NULL END AS title '
           f'FROM market_report r JOIN object_head h ON h.id = r.object_id '
           f'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
           f'JOIN profile p ON p.principal_id = r.reporter_id '
           f'WHERE {where} ORDER BY r.created_at DESC, r.id DESC LIMIT :n')
    rows = conn.execute(sql, {**params, 'n': limit}).fetchall()
    return [{
        'id': row['id'],
        'object_id': row['object_id'],
        'reason_code': row['reason_code'],
        'reason_label': logic.REPORT_REASONS.get(row['reason_code'], row['reason_code']),
        'note': row['note'],
        'status': row['status'],
        'created_at': row['created_at'],
        'title': row['title'],
        'reporter': {'id': row['reporter_id'], 'display_name': row['reporter_name']},
    } for row in rows]


def close_report(conn, actor, report_id, reason='兼容旧客户端关闭', disposition='close', request_id=None):
    row = conn.execute("SELECT object_id FROM market_report WHERE id = ? AND status = 'open'", (report_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if disposition not in ('close', 'hide', 'pending_review'):
        raise ApiError('validation_failed', '处理方式不在允许范围内')
    reason = (reason or '').strip()
    if len(reason) < 2:
        raise ApiError('validation_failed', '处理理由至少 2 个字')
    if disposition in ('hide', 'pending_review'):
        head = conn.execute('SELECT lifecycle FROM object_head WHERE id = ?', (row['object_id'],)).fetchone()
        if head is None:
            raise ApiError('resource_not_found')
        lifecycle = 'hidden' if disposition == 'hide' else disposition
        if head['lifecycle'] != lifecycle:
            objects.set_lifecycle(conn, actor.id, row['object_id'], lifecycle, f'market_report:{report_id}')
    cur = conn.execute("UPDATE market_report SET status = 'closed', closed_at = ?, closed_by = ? "
                       "WHERE id = ? AND status = 'open'", (clock.now(), actor.id, report_id))
    if not cur.rowcount:
        raise ApiError('resource_not_found')
    audit.record(conn, actor.id, 'market.report.close', 'market_report', report_id, reason=reason,
                 request_id=request_id, meta={'disposition': disposition, 'object_id': row['object_id']})
    return {'id': report_id, 'status': 'closed', 'disposition': disposition, 'reason': reason}


def page(conn, actor, *, category=None, status=None, q=None, mine=False, after=None, size=20):
    rows = list_rows(conn, actor, category=category, status=status, q=q, mine=mine, after=after, limit=size + 1)
    return rows, count_rows(conn, actor, category=category, status=status, q=q, mine=mine)
