"""给 Agent 的数据来源。一律以「主人」的身份拼 visible_predicate，再按成员内容规则裁剪：

- 主人自己写的、已在公开层的、匿名聚合、热点、发给主人的通知：照给；
- 别的成员的非公开内容（正文、标题、摘要）：只有开关 agents.read_member_content 开着才给，否则只给条数
  （只有不带检索词的条数；检索结果连「有没有」都不透露）。
- 「谁回了我」按通知处理：给回复人的显示名和回在哪一帖（主人自己的帖），不给回复正文。
"""
import json
import re
from datetime import datetime, timedelta, timezone

from app import clock, flags, fts, objects
from app.authz import visible_predicate

from . import providers

ENUM_TEXT = re.compile(r'[a-z0-9_.-]{1,32}\Z')
CN = timezone(timedelta(hours=8))


def clip(text, n):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= n else text[:n - 1] + '…'


def iso_since(raw, default_hours=24, max_days=14):
    """since 参数 → 核心层时间格式；不传就默认往前 default_hours 小时；最多回看 max_days 天，不超过现在。"""
    now = clock.now_ts()
    if raw:
        dt = datetime.fromisoformat(raw.replace('Z', '+00:00')) if isinstance(raw, str) else None
        if dt is None:
            raise ValueError('since')
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        ts = dt.timestamp()
    else:
        ts = now - default_hours * 3600
    ts = min(max(ts, now - max_days * 86400), now)
    return clock.iso(ts)


def local_label(iso):
    try:
        return datetime.fromtimestamp(clock.parse(iso), CN).strftime('%m月%d日 %H:%M')
    except (TypeError, ValueError):
        return ''


def web(settings, fragment=''):
    return (settings.public_origin or '').rstrip('/') + '/#/' + fragment


def redact(item, owner_id, allow_member):
    """提供方条目 → 可以给外部 Agent 的形状。别的成员的非公开内容去掉标题和摘要，只留编号、类型和时间。"""
    if not isinstance(item, dict):
        return None
    mine = bool(owner_id) and item.get('author_id') == owner_id
    public = item.get('public') is True
    out = {'id': clip(item.get('id'), 64), 'kind': clip(item.get('kind'), 32), 'at': clip(item.get('at'), 40),
           'mine': mine, 'public': public}
    if public or mine or allow_member:
        out['title'] = clip(item.get('title'), 200)
        if item.get('excerpt'):
            out['excerpt'] = clip(item.get('excerpt'), 280)
    else:
        out['withheld'] = True
    url = item.get('url')
    if isinstance(url, str) and (url.startswith('/') or (public and url.startswith('https://'))):
        out['url'] = clip(url, 300)
    meta = {}
    for key, value in (item.get('meta') or {}).items():
        if not isinstance(key, str) or not ENUM_TEXT.match(key):
            continue
        if isinstance(value, bool) or (isinstance(value, (int, float)) and not isinstance(value, bool)):
            meta[key] = value
        elif isinstance(value, str) and ENUM_TEXT.match(value):
            meta[key] = value
    if meta:
        out['meta'] = meta
    return out


def redact_all(items, owner_id, allow_member, limit):
    out = []
    for item in items or []:
        r = redact(item, owner_id, allow_member)
        if r is not None:
            out.append(r)
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------- 站内对象

def _types_clause(types, params):
    marks = []
    for i, t in enumerate(types):
        params[f'ty{i}'] = t
        marks.append(f':ty{i}')
    return f"h.type IN ({', '.join(marks)})"


def search_objects(conn, owner, query, types, limit, allow_member):
    """站内全文检索。成员内容不放行时，SQL 里就只查主人自己的，排序和条数都不受别人内容影响。"""
    expr = fts.match_expression(query or '')
    if not expr or not owner.authenticated or limit <= 0:
        return []
    pred = visible_predicate(owner, 'h')
    params = {**pred.params, 'q': expr, 'n': limit, 'owner': owner.id}
    own = '' if allow_member else ' AND h.author_id = :owner'
    rows = conn.execute(
        'SELECT h.id, h.type, h.author_id, h.created_at, d.title, d.body, p.display_name, '
        'bm25(search_fts, 4.0, 1.0) AS rank FROM search_fts JOIN object_head h ON h.doc_no = search_fts.rowid '
        'JOIN search_doc d ON d.object_id = h.id JOIN profile p ON p.principal_id = h.author_id '
        f'WHERE search_fts MATCH :q AND {pred.sql} AND {_types_clause(types, params)}{own} '
        'ORDER BY rank, h.id LIMIT :n', params).fetchall()
    out = []
    for r in rows:
        mine = r['author_id'] == owner.id
        out.append({'id': r['id'], 'type': r['type'], 'title': clip(r['title'], 200),
                    'snippet': clip(fts.snippet(r['body'], query), 160), 'created_at': r['created_at'],
                    'mine': mine, 'author': '我' if mine else r['display_name'], 'public': False})
    return out


def type_registered(name):
    return name in objects.TYPES


def new_member_objects(conn, owner, since, types, limit, allow_member):
    """since 之后别的成员新写、主人看得到的对象：放行时给列表，不放行时只给条数。"""
    pred = visible_predicate(owner, 'h')
    params = {**pred.params, 'since': since, 'owner': owner.id}
    where = (f'{pred.sql} AND {_types_clause(types, params)} AND h.author_id != :owner '
             "AND h.created_at > :since AND h.lifecycle = 'active'")
    count = conn.execute(f'SELECT count(*) FROM object_head h WHERE {where}', params).fetchone()[0]
    items = []
    if allow_member and limit > 0:
        rows = conn.execute(
            'SELECT h.id, h.type, h.created_at, v.title, v.content_json, p.display_name FROM object_head h '
            'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
            f'JOIN profile p ON p.principal_id = h.author_id WHERE {where} '
            'ORDER BY h.created_at DESC, h.id DESC LIMIT :n', {**params, 'n': limit}).fetchall()
        for r in rows:
            text = objects.TYPES.get(r['type'], (None, objects.text_default))[1](json.loads(r['content_json']))
            items.append({'id': r['id'], 'type': r['type'], 'title': clip(r['title'], 200),
                          'excerpt': clip(text, 140), 'created_at': r['created_at'], 'author': r['display_name']})
    return count, items


def replies_to_owner(conn, owner, since, limit, allow_member):
    """别人回在主人帖子下的回复。标题是主人自己的帖子，回复人按通知给显示名；回复正文按成员内容规则处理。"""
    pred = visible_predicate(owner, 'r')
    params = {**pred.params, 'since': since, 'owner': owner.id}
    where = (f'root.author_id = :owner AND r.author_id != :owner AND r.created_at > :since '
             f"AND r.lifecycle = 'active' AND {pred.sql}")
    base = 'FROM object_head r JOIN object_head root ON root.id = r.root_id '
    count = conn.execute(f'SELECT count(*) {base}WHERE {where}', params).fetchone()[0]
    if limit <= 0:
        return count, []
    rows = conn.execute(
        'SELECT r.id, r.type, r.created_at, r.root_id, rv.title AS root_title, v.content_json, p.display_name '
        f'{base}JOIN object_version rv ON rv.object_id = root.id AND rv.version = root.current_version '
        'JOIN object_version v ON v.object_id = r.id AND v.version = r.current_version '
        f'JOIN profile p ON p.principal_id = r.author_id WHERE {where} '
        'ORDER BY r.created_at DESC, r.id DESC LIMIT :n', {**params, 'n': limit}).fetchall()
    items = []
    for r in rows:
        item = {'kind': 'reply', 'id': r['id'], 'at': r['created_at'],
                'on': {'id': r['root_id'], 'title': clip(r['root_title'], 200)}}
        item['from'] = r['display_name']
        if allow_member:
            text = objects.TYPES.get(r['type'], (None, objects.text_default))[1](json.loads(r['content_json']))
            item['excerpt'] = clip(text, 140)
        else:
            item['withheld'] = True
        items.append(item)
    return count, items


def level_notices(conn, owner_id, since, limit):
    rows = conn.execute(
        "SELECT occurred_at, payload_json FROM outbox_event WHERE event_type = 'growth.level_changed' "
        "AND aggregate_type = 'principal' AND aggregate_id = ? AND occurred_at > ? "
        'ORDER BY occurred_at DESC LIMIT ?', (owner_id, since, limit)).fetchall()
    out = []
    for r in rows:
        try:
            payload = json.loads(r['payload_json'])
        except ValueError:
            payload = {}
        level = payload.get('to')
        text = payload.get('message') if isinstance(payload.get('message'), str) else ''
        out.append({'kind': 'level', 'at': r['occurred_at'], 'level': level if isinstance(level, int) else None,
                    'text': clip(text or '你的等级有变化。', 200)})
    return out


def _has_table(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _notice(item):
    """发给主人的通知：原样给（裁长度、只留白名单字段）。"""
    if not isinstance(item, dict):
        return None
    link = item.get('link') or item.get('url')
    return {'kind': 'notice', 'id': clip(item.get('id'), 64), 'category': clip(item.get('category'), 32),
            'title': clip(item.get('title'), 120), 'body': clip(item.get('body'), 200), 'at': clip(item.get('at'), 40),
            'read': bool(item.get('read')),
            'link': clip(link, 200) if isinstance(link, str) and link.startswith(('#/', '/')) else None}


def owner_notifications(conn, owner, since, limit, allow_member):
    """-> (items, count, source, note)。优先用登记的提供方，其次通知中心（modules.notify 的 notification 表），
    都没有时用核心层能推出来的：回我的消息、等级变化。"""
    fn = providers.PROVIDERS.get('notifications.for_owner')
    if fn is not None:
        result, note = providers.call('notifications.for_owner', conn, owner, since, limit)
        items = [n for n in (_notice(x) for x in (result or [])) if n][:limit]
        return items, len(items), 'provider', note
    if _has_table(conn, 'notification') and flags.enabled(conn, 'notify.enabled'):
        where = 'recipient_id = ? AND available_at <= ? AND occurred_at > ?'
        params = (owner.id, clock.now(), since)
        count = conn.execute(f'SELECT count(*) FROM notification WHERE {where}', params).fetchone()[0]
        rows = conn.execute(f'SELECT id, category, title, body, link, occurred_at, read_at FROM notification '
                            f'WHERE {where} ORDER BY occurred_at DESC, id DESC LIMIT ?', (*params, limit)).fetchall()
        items = [_notice({'id': r['id'], 'category': r['category'], 'title': r['title'], 'body': r['body'],
                          'link': r['link'], 'at': r['occurred_at'], 'read': r['read_at'] is not None}) for r in rows]
        return items, count, 'notify', None
    rcount, replies = replies_to_owner(conn, owner, since, limit, allow_member)
    levels = level_notices(conn, owner.id, since, limit)
    items = sorted(replies + levels, key=lambda x: x.get('at') or '', reverse=True)[:limit]
    return items, rcount + len(levels), 'core', None


def pending_drafts(conn, owner_id, limit=5):
    count = conn.execute("SELECT count(*) FROM agent_draft WHERE owner_id = ? AND status = 'pending'",
                         (owner_id,)).fetchone()[0]
    rows = conn.execute(
        "SELECT d.id, d.kind, d.title, d.created_at, a.name FROM agent_draft d "
        "JOIN agent_profile a ON a.principal_id = d.agent_id WHERE d.owner_id = ? AND d.status = 'pending' "
        'ORDER BY d.created_at DESC LIMIT ?', (owner_id, limit)).fetchall()
    return count, [{'kind': 'draft_pending', 'id': r['id'], 'at': r['created_at'], 'draft_kind': r['kind'],
                    'title': clip(r['title'], 200), 'agent': r['name']} for r in rows]


# ---------------------------------------------------------------- 热点（FEED-1）

def _feed():
    try:
        from modules.feed import service
    except Exception:  # noqa: BLE001 — 热点模块缺失或坏了只让这一段为空
        return None
    return service


def feed_directions():
    service = _feed()
    if service is None:
        return []
    try:
        return [d['id'] if isinstance(d, dict) else d[0] for d in service.direction_catalog()]
    except Exception:  # noqa: BLE001
        return []


def hot_events(conn, owner, settings, since=None, direction=None, limit=10):
    """-> (events, note)。只给热点自己的字段（标题、方向、热度、来源链接、站内匿名计数），不带「站内相关」。"""
    service = _feed()
    if service is None:
        return [], '热点模块（FEED-1）不可用，这一项先返回空。'
    if not flags.enabled(conn, 'feed.enabled'):
        return [], '热点模块的开关 feed.enabled 关着。'
    try:
        events = service.list_events(conn, owner, [direction] if direction else None, limit=500)
        subs = set(service.list_subs(conn, owner.id)) if owner.authenticated else set()
        labels = {d['id']: d['label'] for d in service.direction_catalog() if isinstance(d, dict)}
    except Exception:  # noqa: BLE001
        return [], '热点暂时取不到。'
    out = []
    for e in events:
        if since and (e.get('last_seen') or '') <= since:
            continue
        sources = []
        for s in (e.get('sources') or [])[:3]:
            url = s.get('url') if isinstance(s.get('url'), str) and s['url'].startswith(('https://', 'http://')) else None
            sources.append({'name': clip(s.get('name'), 60), 'title': clip(s.get('title'), 200), 'url': url,
                            'published_at': s.get('published_at')})
        site = e.get('site') or {}
        out.append({
            'id': e.get('id'), 'title': clip(e.get('title'), 200), 'direction': e.get('direction'),
            'direction_label': labels.get(e.get('direction'), e.get('direction')),
            'heat': round(float(e.get('heat') or 0), 2), 'source_count': int(e.get('source_count') or 0),
            'first_seen': e.get('first_seen'), 'last_seen': e.get('last_seen'),
            'subscribed': e.get('direction') in subs, 'sources': sources,
            'site': {k: int(site.get(k) or 0) for k in ('favorites', 'comments', 'rooms')},
            'url': web(settings, 'hot'),
        })
    out.sort(key=lambda x: (not x['subscribed'], -x['heat'], x['id'] or ''))
    return out[:limit], None


def direction_counts(conn, owner, settings):
    """按方向数最近 7 天和前 7 天的热点事件数（来自公开源，匿名）。"""
    events, note = hot_events(conn, owner, settings, limit=10_000)
    if note:
        return [], note
    now = clock.now_ts()
    week, prev = clock.iso(now - 7 * 86400), clock.iso(now - 14 * 86400)
    rows = {}
    for e in events:
        first = e.get('first_seen') or ''
        row = rows.setdefault(e['direction'], {'direction': e['direction'], 'label': e['direction_label'],
                                               'this_week': 0, 'last_week': 0})
        if first > week:
            row['this_week'] += 1
        elif first > prev:
            row['last_week'] += 1
    out = sorted(rows.values(), key=lambda r: (-r['this_week'], r['direction'] or ''))
    for r in out:
        r['delta'] = r['this_week'] - r['last_week']
    return out, None


def owner_skills(conn, agent_id, owner_id):
    row = conn.execute('SELECT abilities_json FROM agent_profile WHERE principal_id = ?', (agent_id,)).fetchone()
    skills = []
    try:
        skills = [s for s in json.loads(row['abilities_json']) if isinstance(s, str)] if row else []
    except ValueError:
        skills = []
    service = _feed()
    if service is not None:
        try:
            labels = {d['id']: d['label'] for d in service.direction_catalog() if isinstance(d, dict)}
            skills += [labels.get(d, d) for d in service.list_subs(conn, owner_id)]
        except Exception:  # noqa: BLE001
            pass
    seen = []
    for s in skills:
        if s not in seen:
            seen.append(s)
    return seen[:12]


def provider_items(name, owner_id, allow_member, limit, *args):
    result, note = providers.call(name, *args)
    if result is None:
        return [], note
    return redact_all(result, owner_id, allow_member, limit), None
