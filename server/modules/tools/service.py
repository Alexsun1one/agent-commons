"""Business rules and projections for R13 TOOLS-1."""

from __future__ import annotations

import html
import json
import re
import statistics
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from app import audit, clock, outbox
from app.authz import require
from app.errors import ApiError

CATEGORIES = ('编程 Agent', '对话模型', '本地模型', '自动化', '知识管理', '设计')
PRICE_TIERS = ('免费', '订阅', '按量')
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*\Z')
REVIEW_WAIT_SECONDS = 3 * 86400
RATING_THRESHOLD = 5


def _text(value, limit, label, *, required=True):
    if not isinstance(value, str):
        raise ApiError('validation_failed', f'{label}必须是文本')
    value = value.strip()
    if required and not value:
        raise ApiError('validation_failed', f'{label}要填')
    if len(value) > limit:
        raise ApiError('validation_failed', f'{label}最多 {limit} 个字')
    return value


def safe_url(value):
    value = _text(value, 500, '官网链接')
    parsed = urlsplit(value)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password:
        raise ApiError('validation_failed', '官网链接只接受完整的 http 或 https 地址')
    return value


def _tags(value):
    if not isinstance(value, list) or len(value) > 12:
        raise ApiError('validation_failed', '标签最多 12 个')
    tags = []
    for raw in value:
        tag = _text(raw, 32, '标签')
        if tag not in tags:
            tags.append(tag)
    return tags


def validate_tool(body):
    slug = _text(body.get('slug'), 80, 'slug')
    if not SLUG.fullmatch(slug):
        raise ApiError('validation_failed', 'slug 只能用小写字母、数字和连字符')
    category = body.get('category')
    if category not in CATEGORIES:
        raise ApiError('validation_failed', '不认识的工具类别')
    price_tier = body.get('price_tier')
    if price_tier not in PRICE_TIERS:
        raise ApiError('validation_failed', '价格档只能是免费、订阅或按量')
    return {
        'slug': slug,
        'name': _text(body.get('name'), 100, '名称'),
        'vendor': _text(body.get('vendor'), 100, '厂商'),
        'category': category,
        'official_url': safe_url(body.get('official_url')),
        'price_tier': price_tier,
        'tags': _tags(body.get('tags', [])),
        'summary': _text(body.get('summary', ''), 280, '一句话说明', required=False),
    }


def submit(conn, actor, body, request_id=None):
    require(conn, actor, 'tools.submit')
    data = validate_tool(body)
    if conn.execute('SELECT 1 FROM tool WHERE slug = ?', (data['slug'],)).fetchone():
        raise ApiError('state_conflict', '这个工具已经提交过')
    tool_id = str(uuid.uuid4())
    now = clock.now()
    conn.execute(
        'INSERT INTO tool (id, slug, name, vendor, category, official_url, price_tier, tags_json, summary, status, '
        'submitted_by, claimed_by, sponsored, created_at, updated_at) '
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, NULL, NULL, ?, ?)",
        (tool_id, data['slug'], data['name'], data['vendor'], data['category'], data['official_url'],
         data['price_tier'], json.dumps(data['tags'], ensure_ascii=False), data['summary'], actor.id, now, now),
    )
    outbox.emit(conn, 'tools.submitted', 'tool', tool_id, {'slug': data['slug']}, actor_id=actor.id,
                request_id=request_id)
    audit.record(conn, actor.id, 'tools.submit', 'tool', tool_id, request_id=request_id)
    return pending_dto(conn, data['slug'])


def approve(conn, actor, slug, request_id=None):
    require(conn, actor, 'tools.moderate')
    row = conn.execute('SELECT * FROM tool WHERE slug = ?', (slug,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['status'] != 'pending_review':
        raise ApiError('state_conflict', '这条投稿已经处理过')
    now = clock.now()
    conn.execute("UPDATE tool SET status = 'active', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?",
                 (actor.id, now, now, row['id']))
    outbox.emit(conn, 'tools.approved', 'tool', row['id'], {'slug': slug}, actor_id=actor.id,
                request_id=request_id)
    audit.record(conn, actor.id, 'tools.approve', 'tool', row['id'], request_id=request_id)
    return detail(conn, slug, actor.id)


def pending_dto(conn, slug):
    row = conn.execute('SELECT * FROM tool WHERE slug = ?', (slug,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return {
        'id': row['id'], 'slug': row['slug'], 'name': row['name'], 'vendor': row['vendor'],
        'category': row['category'], 'official_url': row['official_url'], 'price_tier': row['price_tier'],
        'tags': json.loads(row['tags_json']), 'summary': row['summary'], 'status': row['status'],
        'submitted_by': row['submitted_by'], 'created_at': row['created_at'], 'updated_at': row['updated_at'],
    }


def pending(conn, status='pending_review'):
    if status not in ('pending_review', 'active', 'hidden'):
        raise ApiError('validation_failed', '不认识的审核状态')
    return [pending_dto(conn, row['slug']) for row in conn.execute(
        'SELECT slug FROM tool WHERE status = ? ORDER BY created_at, slug', (status,))]


def my_submissions(conn, actor):
    rows = conn.execute('SELECT * FROM tool WHERE submitted_by = ? ORDER BY created_at DESC, slug',
                        (actor.id,)).fetchall()
    out = []
    for row in rows:
        item = pending_dto(conn, row['slug'])
        item.pop('submitted_by', None)
        item['approved_at'] = row['approved_at']
        item['use_count'] = _counts(conn, row['id'])[0] if row['status'] == 'active' else 0
        out.append(item)
    return out


def _active(conn, slug):
    row = conn.execute("SELECT * FROM tool WHERE slug = ? AND status = 'active'", (slug,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _rating(conn, tool_id):
    values = [row[0] for row in conn.execute(
        'SELECT rating FROM tool_review WHERE tool_id = ? ORDER BY rating', (tool_id,))]
    count = len(values)
    median = float(statistics.median(values)) if count >= RATING_THRESHOLD else None
    return {'count': count, 'median': median, 'label': None if median is not None else '评价不足'}


def _review_rows(conn, tool_id, limit=50):
    return conn.execute(
        'SELECT r.*, count(h.principal_id) AS helpful_count FROM tool_review r '
        'LEFT JOIN tool_review_helpful h ON h.review_id = r.id WHERE r.tool_id = ? '
        'GROUP BY r.id ORDER BY helpful_count DESC, r.updated_at DESC, r.id LIMIT ?',
        (tool_id, limit),
    ).fetchall()


def _review_dto(row):
    return {
        'id': row['id'], 'author': {'id': row['author_id'], 'display_name': row['author_name']},
        'rating': row['rating'], 'body': row['body'], 'helpful_count': row['helpful_count'],
        'created_at': row['created_at'], 'updated_at': row['updated_at'],
    }


def software_schema(tool, rating, reviews=()):
    schema = {
        '@context': 'https://schema.org', '@type': 'SoftwareApplication', 'name': tool['name'],
        'url': tool['official_url'], 'applicationCategory': tool['category'],
    }
    if rating['median'] is not None:
        schema['aggregateRating'] = {
            '@type': 'AggregateRating', 'ratingValue': rating['median'], 'ratingCount': rating['count'],
            'bestRating': 5, 'worstRating': 1,
        }
    if reviews:
        schema['review'] = [{
            '@type': 'Review',
            'author': {'@type': 'Person', 'name': row['author']['display_name']},
            'reviewRating': {'@type': 'Rating', 'ratingValue': row['rating'], 'bestRating': 5, 'worstRating': 1},
            'reviewBody': row['body'],
        } for row in reviews]
    return schema


def _counts(conn, tool_id):
    month = clock.now()[:7] + '-01T00:00:00.000000Z'
    row = conn.execute(
        'SELECT count(*) AS total, sum(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS month '
        'FROM tool_use WHERE tool_id = ?', (month, tool_id),
    ).fetchone()
    return row['total'], row['month'] or 0


def _base_dto(conn, row, current_principal=None, *, include_reviews=False):
    total, monthly = _counts(conn, row['id'])
    rating = _rating(conn, row['id'])
    reviews = [_review_dto(review) for review in _review_rows(conn, row['id'])] if include_reviews else []
    top = reviews[0] if reviews else None
    if not include_reviews:
        top_row = _review_rows(conn, row['id'], 1)
        top = _review_dto(top_row[0]) if top_row else None
    mine = None
    if current_principal:
        own = conn.execute('SELECT purpose, show_on_profile, started_at, updated_at FROM tool_use '
                           'WHERE tool_id = ? AND principal_id = ?', (row['id'], current_principal)).fetchone()
        mine = None if own is None else {**dict(own), 'show_on_profile': bool(own['show_on_profile'])}
    data = {
        'id': row['id'], 'slug': row['slug'], 'name': row['name'], 'vendor': row['vendor'],
        'category': row['category'], 'official_url': row['official_url'], 'price_tier': row['price_tier'],
        'tags': json.loads(row['tags_json']), 'summary': row['summary'],
        'use_count': total, 'month_new_count': monthly, 'rating': rating, 'top_review': top,
        'mine': mine, 'commercial': {'claimed_by': row['claimed_by'], 'sponsored': row['sponsored']},
        'updated_at': row['updated_at'],
    }
    data['schema'] = software_schema(data, rating, reviews if include_reviews else ([top] if top else []))
    if include_reviews:
        data['reviews'] = reviews
    return data


def list_tools(conn, *, category=None, sort='usage', current_principal=None):
    if category is not None and category not in CATEGORIES:
        raise ApiError('validation_failed', '不认识的工具类别')
    if sort not in ('usage', 'month', 'rating'):
        raise ApiError('validation_failed', '排序只能是在用人数、本月新增或评分')
    params = []
    where = "status = 'active'"
    if category:
        where += ' AND category = ?'
        params.append(category)
    rows = conn.execute(f'SELECT * FROM tool WHERE {where}', params).fetchall()
    data = [_base_dto(conn, row, current_principal) for row in rows]
    if sort == 'rating':
        data = [row for row in data if row['rating']['median'] is not None]
        data.sort(key=lambda row: (-row['rating']['median'], -row['rating']['count'], row['name']))
    elif sort == 'month':
        data.sort(key=lambda row: (-row['month_new_count'], -row['use_count'], row['name']))
    else:
        data.sort(key=lambda row: (-row['use_count'], -row['month_new_count'], row['name']))
    return data


def _trend(conn, tool_id):
    now = datetime.fromtimestamp(clock.now_ts(), timezone.utc)
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    starts = [monday - timedelta(weeks=offset) for offset in range(11, -1, -1)]
    rows = []
    for start in starts:
        end = start + timedelta(days=7)
        rows.append({
            'week': start.date().isoformat(),
            'new': conn.execute('SELECT count(*) FROM tool_use WHERE tool_id = ? AND started_at >= ? AND started_at < ?',
                                (tool_id, clock.iso(start.timestamp()), clock.iso(end.timestamp()))).fetchone()[0],
            'total': conn.execute('SELECT count(*) FROM tool_use WHERE tool_id = ? AND started_at < ?',
                                  (tool_id, clock.iso(end.timestamp()))).fetchone()[0],
        })
    return rows


def detail(conn, slug, current_principal=None):
    row = _active(conn, slug)
    data = _base_dto(conn, row, current_principal, include_reviews=True)
    data['trend'] = _trend(conn, row['id'])
    users = conn.execute(
        "SELECT c.handle, p.display_name FROM tool_use u JOIN principal x ON x.id = u.principal_id "
        'JOIN profile p ON p.principal_id = u.principal_id JOIN credential c ON c.principal_id = u.principal_id '
        "WHERE u.tool_id = ? AND u.show_on_profile = 1 AND x.status = 'active' ORDER BY u.started_at, c.handle LIMIT 50",
        (row['id'],),
    ).fetchall()
    data['public_users'] = [{'handle': user['handle'], 'display_name': user['display_name']} for user in users]
    return data


def compare(conn, slugs, current_principal=None):
    clean = []
    for slug in slugs:
        if slug and slug not in clean:
            clean.append(slug)
    if not 2 <= len(clean) <= 3:
        raise ApiError('validation_failed', '对比需要两到三个不同工具')
    return [detail(conn, slug, current_principal) for slug in clean]


def mark_use(conn, actor, slug, purpose='', show_on_profile=False, request_id=None):
    require(conn, actor, 'tools.use')
    row = _active(conn, slug)
    purpose = _text(purpose, 160, '用途', required=False)
    now = clock.now()
    conn.execute(
        'INSERT INTO tool_use (tool_id, principal_id, purpose, show_on_profile, started_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tool_id, principal_id) DO UPDATE SET '
        'purpose = excluded.purpose, show_on_profile = excluded.show_on_profile, updated_at = excluded.updated_at',
        (row['id'], actor.id, purpose, int(bool(show_on_profile)), now, now),
    )
    audit.record(conn, actor.id, 'tools.use', 'tool', row['id'], request_id=request_id)
    return detail(conn, slug, actor.id)


def unmark_use(conn, actor, slug, request_id=None):
    require(conn, actor, 'tools.use')
    row = _active(conn, slug)
    conn.execute('DELETE FROM tool_use WHERE tool_id = ? AND principal_id = ?', (row['id'], actor.id))
    audit.record(conn, actor.id, 'tools.unuse', 'tool', row['id'], request_id=request_id)
    return {'slug': slug, 'using': False}


def review(conn, actor, slug, rating, body, request_id=None):
    require(conn, actor, 'tools.review')
    row = _active(conn, slug)
    if not isinstance(rating, int) or isinstance(rating, bool) or not 1 <= rating <= 5:
        raise ApiError('validation_failed', '评分要在 1 到 5 之间')
    body = _text(body, 280, '短评')
    usage = conn.execute('SELECT started_at FROM tool_use WHERE tool_id = ? AND principal_id = ?',
                         (row['id'], actor.id)).fetchone()
    if usage is None:
        raise ApiError('tools_review_too_soon', '先标记“我在用”，满三天后再评分', days_remaining=3)
    elapsed = clock.now_ts() - clock.parse(usage['started_at'])
    if elapsed < REVIEW_WAIT_SECONDS:
        remaining = max(1, int((REVIEW_WAIT_SECONDS - elapsed + 86399) // 86400))
        raise ApiError('tools_review_too_soon', f'再用 {remaining} 天就能评分', days_remaining=remaining)
    current = conn.execute('SELECT * FROM tool_review WHERE tool_id = ? AND author_id = ?',
                           (row['id'], actor.id)).fetchone()
    now = clock.now()
    if current:
        conn.execute('INSERT INTO tool_review_history (id, review_id, rating, body, replaced_at) VALUES (?, ?, ?, ?, ?)',
                     (str(uuid.uuid4()), current['id'], current['rating'], current['body'], now))
        conn.execute('UPDATE tool_review SET rating = ?, body = ?, updated_at = ? WHERE id = ?',
                     (rating, body, now, current['id']))
        review_id, created = current['id'], False
    else:
        name = conn.execute('SELECT display_name FROM profile WHERE principal_id = ?', (actor.id,)).fetchone()[0]
        review_id = str(uuid.uuid4())
        conn.execute('INSERT INTO tool_review (id, tool_id, author_id, author_name, rating, body, created_at, updated_at) '
                     'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                     (review_id, row['id'], actor.id, name, rating, body, now, now))
        created = True
    outbox.emit(conn, 'tools.reviewed', 'tool', row['id'], {'review_id': review_id, 'rating': rating},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'tools.review', 'tool_review', review_id, request_id=request_id,
                 meta={'created': created})
    return {'review': next(_review_dto(item) for item in _review_rows(conn, row['id']) if item['id'] == review_id),
            'created': created, 'rating': _rating(conn, row['id'])}


def helpful(conn, actor, review_id, request_id=None):
    require(conn, actor, 'tools.helpful')
    review_row = conn.execute(
        "SELECT r.*, t.status FROM tool_review r JOIN tool t ON t.id = r.tool_id WHERE r.id = ? AND t.status = 'active'",
        (review_id,),
    ).fetchone()
    if review_row is None:
        raise ApiError('resource_not_found')
    if review_row['author_id'] == actor.id:
        raise ApiError('state_conflict', '不能给自己的短评点有用')
    now = clock.now()
    cur = conn.execute('INSERT OR IGNORE INTO tool_review_helpful (review_id, principal_id, created_at) VALUES (?, ?, ?)',
                       (review_id, actor.id, now))
    count = conn.execute('SELECT count(*) FROM tool_review_helpful WHERE review_id = ?', (review_id,)).fetchone()[0]
    if cur.rowcount:
        outbox.emit(conn, 'tools.review.helpful', 'tool_review', review_id, {'recipient_id': review_row['author_id']},
                    actor_id=actor.id, request_id=request_id)
        audit.record(conn, actor.id, 'tools.helpful', 'tool_review', review_id, request_id=request_id)
    return {'id': review_id, 'helpful': True, 'created': bool(cur.rowcount), 'count': count}


def markdown_list(rows):
    lines = ['# AI 工具榜', '']
    for row in rows:
        score = '评价不足' if row['rating']['median'] is None else f"{row['rating']['median']:g} / 5"
        lines.extend([f"## {row['name']}", '', f"- 类别：{row['category']}", f"- 厂商：{row['vendor']}",
                      f"- 在用人数：{row['use_count']}", f"- 评分：{score}", f"- URL：{row['official_url']}", ''])
    return '\n'.join(lines)


def markdown_detail(row):
    score = '评价不足' if row['rating']['median'] is None else f"{row['rating']['median']:g} / 5"
    lines = [f"# {row['name']}", '', row['summary'], '', f"- 厂商：{row['vendor']}", f"- 类别：{row['category']}",
             f"- 价格档：{row['price_tier']}", f"- 在用人数：{row['use_count']}", f"- 评分：{score}",
             f"- 官网：{row['official_url']}", '', '## 成员短评', '']
    lines.extend([f"- {review['rating']} / 5 · {review['body']} — {review['author']['display_name']}"
                  for review in row['reviews']] or ['- 暂无短评'])
    return '\n'.join(lines) + '\n'


def html_page(title, body, schema):
    jsonld = json.dumps(schema, ensure_ascii=False).replace('</', '<\\/')
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" '
            f'content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title>'
            f'<script type="application/ld+json">{jsonld}</script></head><body><main>{body}</main></body></html>')


def html_list(rows):
    body = '<h1>AI 工具榜</h1><ol>' + ''.join(
        f'<li><a href="/api/tools/{html.escape(row["slug"], quote=True)}">{html.escape(row["name"])}</a>'
        f'<span> · {html.escape(row["category"])} · {row["use_count"]} 人在用</span></li>' for row in rows) + '</ol>'
    return html_page('AI 工具榜', body, {'@context': 'https://schema.org', '@type': 'ItemList',
                                         'itemListElement': [row['schema'] for row in rows]})


def html_detail(row):
    score = '评价不足' if row['rating']['median'] is None else f"{row['rating']['median']:g} / 5"
    reviews = ''.join(f'<li><b>{review["rating"]} / 5</b> {html.escape(review["body"])} — '
                      f'{html.escape(review["author"]["display_name"])}</li>' for review in row['reviews'])
    body = (f'<h1>{html.escape(row["name"])}</h1><p>{html.escape(row["summary"])}</p><dl>'
            f'<dt>厂商</dt><dd>{html.escape(row["vendor"])}</dd><dt>类别</dt><dd>{html.escape(row["category"])}</dd>'
            f'<dt>评分</dt><dd>{html.escape(score)}</dd></dl><p><a href="{html.escape(row["official_url"], quote=True)}">官网</a></p>'
            f'<h2>成员短评</h2><ul>{reviews or "<li>暂无短评</li>"}</ul>')
    return html_page(row['name'], body, row['schema'])

