"""回复与讨论串、反应、收藏、有用、关注方向、列表与热门缓存。读一律拼 visible_predicate。"""
import importlib
import json
import math
import re
import threading
import time

from app import audit, clock, ledger, objects, outbox
from app.authz import require, visible_predicate
from app.errors import ApiError

from modules.media import service as media

from . import sanitize

MIGRATION = 'content/content_0001.sql'
HOT_MIGRATION = 'content/content_0002_hot.sql'
FEED_TYPES = ('knowledge', 'discussion', 'work', 'agent_card')
REACTIONS = tuple(k for k in sanitize.EMOJI if k != 'useful')
QUOTE_CHARS = 80
MAX_DEPTH = 64
MAX_FOLLOWS = 50
FOLLOW_ROUNDS = 20
FOLLOW_BATCH = 100
HOT_EPOCH = clock.parse('2026-01-01T00:00:00.000000Z')
HOT_HALF_HOURS = 12.0
CACHE_TTL = 5.0
CACHE_MAX = 2000
LIST_COLUMNS = objects.LIST_COLUMNS
WS = re.compile(r'\s+')


def installed(conn):
    return conn.execute('SELECT 1 FROM schema_migration WHERE id = ?', (MIGRATION,)).fetchone() is not None


def has_hot_tables(conn):
    return conn.execute('SELECT 1 FROM schema_migration WHERE id = ?', (HOT_MIGRATION,)).fetchone() is not None


def excerpt(text, n):
    return WS.sub(' ', text or '').strip()[:n]


def norm_tag(tag):
    tag = WS.sub(' ', tag or '').strip().casefold()
    return tag if 1 <= len(tag) <= 32 else None


# ---------- 派生：统计、热度、标签、回复行 ----------

def hot_score(engagement, published_at):
    hours = (clock.parse(published_at) - HOT_EPOCH) / 3600
    return round(math.log2(1 + engagement) + hours / HOT_HALF_HOURS, 6)


def refresh_stat(conn, object_id):
    head = conn.execute('SELECT root_id, created_at, published_at FROM object_head WHERE id = ?',
                        (object_id,)).fetchone()
    if head is None:
        return
    q = lambda sql: conn.execute(sql, (object_id,)).fetchone()[0]
    reactions = q('SELECT count(*) FROM content_reaction WHERE object_id = ?')
    saves = q('SELECT count(*) FROM content_save WHERE object_id = ?')
    useful = q('SELECT count(*) FROM content_useful WHERE object_id = ?')
    replies = q("SELECT count(*) FROM object_head WHERE root_id = ? AND lifecycle = 'active'") if not head[
        'root_id'] else 0
    hot = hot_score(reactions + 2 * replies + 3 * useful + saves, head['published_at'] or head['created_at'])
    conn.execute('INSERT INTO content_stat (object_id, is_root, reactions, replies, useful, saves, hot, updated_at) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(object_id) DO UPDATE SET reactions = excluded.reactions, '
                 'replies = excluded.replies, useful = excluded.useful, saves = excluded.saves, hot = excluded.hot, '
                 'updated_at = excluded.updated_at',
                 (object_id, int(head['root_id'] is None), reactions, replies, useful, saves, hot, clock.now()))


def index_tags(conn, object_id):
    head = conn.execute('SELECT created_at, current_version FROM object_head WHERE id = ?', (object_id,)).fetchone()
    row = conn.execute('SELECT content_json FROM object_version WHERE object_id = ? AND version = ?',
                       (object_id, head['current_version'])).fetchone()
    tags = {t for t in (norm_tag(x) for x in json.loads(row['content_json']).get('tags', [])
                        if isinstance(x, str)) if t}
    conn.execute('DELETE FROM content_tag WHERE object_id = ?', (object_id,))
    conn.executemany('INSERT INTO content_tag (tag, object_id, created_at) VALUES (?, ?, ?)',
                     [(t, object_id, head['created_at']) for t in sorted(tags)])


def ensure_reply_row(conn, head):
    """经核心 POST /api/objects 建的回复没有引用信息：当作直接回原帖。"""
    if conn.execute('SELECT 1 FROM content_reply WHERE object_id = ?', (head['id'],)).fetchone():
        return
    conn.execute('INSERT INTO content_reply (object_id, target_id, thread_root, depth, path, created_at) '
                 'VALUES (?, ?, ?, 0, ?, ?)', (head['id'], head['root_id'], head['id'], f'{head["doc_no"]:010d}',
                                              head['created_at']))


def on_object_event(conn, event):
    if not installed(conn):
        return
    head = conn.execute('SELECT id, type, root_id, doc_no, created_at FROM object_head WHERE id = ?',
                        (event['aggregate_id'],)).fetchone()
    if head is None:
        return
    if head['root_id']:
        ensure_reply_row(conn, head)
        refresh_stat(conn, head['id'])
        refresh_stat(conn, head['root_id'])
        return
    kind, payload = event['event_type'], event['payload']
    if kind == 'object.created' or (kind == 'object.updated' and payload.get('version_changed')):
        index_tags(conn, head['id'])
    refresh_stat(conn, head['id'])


# ---------- 热门短缓存：键里带主体、等级、空间成员关系和 outbox 水位，任何写入都会让它失效 ----------

_cache = {}
_cache_lock = threading.Lock()


def cache_key(conn, db_path, actor, query):
    mark = conn.execute('SELECT max(rowid) FROM outbox_event').fetchone()[0]
    spaces = tuple(r[0] for r in conn.execute("SELECT space_id FROM membership WHERE principal_id = ? "
                                              "AND state = 'active' ORDER BY space_id", (actor.id or '',)))
    return (db_path, actor.id, actor.level, actor.status, spaces, mark, query)


def cached(key, build):
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1], True
    value = build()
    with _cache_lock:
        if len(_cache) >= CACHE_MAX:
            for k in [k for k, v in _cache.items() if v[0] <= now] or list(_cache)[:CACHE_MAX // 4]:
                _cache.pop(k, None)
        _cache[key] = (now + CACHE_TTL, value)
    return value, False


def clear_cache():
    with _cache_lock:
        _cache.clear()


# ---------- 读：批量补充作者、头像、统计、我的状态 ----------

def people(conn, actor, ids):
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return {}
    marks = ','.join('?' * len(ids))
    rows = conn.execute(f'SELECT p.principal_id, p.display_name, p.level, p.avatar_ref, c.handle FROM profile p '
                        f'LEFT JOIN credential c ON c.principal_id = p.principal_id WHERE p.principal_id IN '
                        f'({marks})', ids).fetchall()
    avatars = media.avatar_urls(conn, [r['avatar_ref'] for r in rows]) if actor.authenticated else {}
    return {r['principal_id']: {'id': r['principal_id'], 'handle': r['handle'] if actor.authenticated else None,
                                'display_name': r['display_name'], 'level': r['level'],
                                'avatar': avatars.get(r['avatar_ref'])} for r in rows}


def social(conn, actor, ids):
    ids = list(dict.fromkeys(ids))
    out = {i: {'stats': {'reactions': {}, 'replies': 0, 'useful': 0, 'saves': 0},
               'mine': {'reactions': {}, 'useful': False, 'saved': False}} for i in ids}
    if not ids:
        return out
    marks = ','.join('?' * len(ids))
    for r in conn.execute(f'SELECT object_id, replies, useful, saves FROM content_stat WHERE object_id IN ({marks})',
                          ids):
        out[r['object_id']]['stats'].update(useful=r['useful'], saves=r['saves'])
    pred = visible_predicate(actor)
    named = ','.join(f':parent{i}' for i in range(len(ids)))
    params = {**pred.params, **{f'parent{i}': oid for i, oid in enumerate(ids)}}
    for r in conn.execute(f'SELECT h.root_id, count(*) AS n FROM object_head h '
                          f"WHERE h.root_id IN ({named}) AND h.lifecycle != 'draft' AND {pred.sql} "
                          'GROUP BY h.root_id', params):
        out[r['root_id']]['stats']['replies'] = r['n']
    for r in conn.execute(f'SELECT object_id, kind, count(*) AS n FROM content_reaction WHERE object_id IN ({marks}) '
                          'GROUP BY object_id, kind', ids):
        out[r['object_id']]['stats']['reactions'][r['kind']] = r['n']
    if actor.authenticated:
        me = (actor.id, *ids)
        for r in conn.execute(f'SELECT object_id, kind FROM content_reaction WHERE principal_id = ? '
                              f'AND object_id IN ({marks})', me):
            out[r['object_id']]['mine']['reactions'][r['kind']] = True
        for r in conn.execute(f'SELECT object_id FROM content_useful WHERE giver_id = ? AND object_id IN ({marks})', me):
            out[r['object_id']]['mine']['useful'] = True
        for r in conn.execute(f'SELECT object_id FROM content_save WHERE principal_id = ? AND object_id IN ({marks})',
                              me):
            out[r['object_id']]['mine']['saved'] = True
    for item in out.values():
        if item['stats']['useful']:
            item['stats']['reactions']['useful'] = item['stats']['useful']
        if item['mine']['useful']:
            item['mine']['reactions']['useful'] = True
    return out


def cards(conn, actor, rows):
    rows = list(rows)
    contents = {r['id']: json.loads(r['content_json']) for r in rows}
    socials = social(conn, actor, [r['id'] for r in rows])
    authors = people(conn, actor, [r['author_id'] for r in rows])
    covers = media.assets_meta(conn, actor, [c.get('cover') for c in contents.values() if c.get('cover')])
    out = []
    for r in rows:
        data = objects.dto(r, actor)
        content = contents[r['id']]
        data['author'] = authors.get(r['author_id'], data['author'])
        data['tags'] = content.get('tags', [])
        data['cover'] = covers.get(content.get('cover'))
        data.update(socials[r['id']])
        out.append(data)
    return out


def _page(rows, limit, key):
    more = len(rows) > limit
    rows = rows[:limit]
    return rows, (key(rows[-1]) if more and rows else None)


def _types(types):
    types = [t for t in (types or FEED_TYPES) if t in FEED_TYPES]
    if not types:
        raise ApiError('validation_failed', f'type 只能是 {", ".join(FEED_TYPES)}')
    return types


def _root_filter(types, space_id):
    marks = ','.join(f':t{i}' for i in range(len(types)))
    sql = f"h.root_id IS NULL AND h.lifecycle = 'active' AND h.type IN ({marks})"
    params = {f't{i}': t for i, t in enumerate(types)}
    if space_id:
        sql += ' AND h.space_id = :space'
        params['space'] = space_id
    return sql, params


def _join(inner, order):
    return (f'SELECT {LIST_COLUMNS}{", h.sort_key" if "sort_key" in inner else ""} FROM ({inner}) h '
            'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
            f'JOIN profile p ON p.principal_id = h.author_id ORDER BY {order}')


def feed_new(conn, actor, types, space_id, after, limit):
    pred = visible_predicate(actor)
    where, params = _root_filter(_types(types), space_id)
    if after:
        where += ' AND (h.created_at, h.id) < (:c_at, :c_id)'
        params.update(c_at=after[0], c_id=after[1])
    inner = (f'SELECT * FROM object_head h WHERE {where} AND {pred.sql} '
             'ORDER BY h.created_at DESC, h.id DESC LIMIT :n')
    rows = conn.execute(_join(inner, 'h.created_at DESC, h.id DESC'), {**pred.params, **params, 'n': limit + 1}).fetchall()
    rows, cursor = _page(rows, limit, lambda r: [r['created_at'], r['id']])
    return cards(conn, actor, rows), cursor


def feed_hot(conn, actor, types, space_id, after, limit):
    pred = visible_predicate(actor)
    where, params = _root_filter(_types(types), space_id)
    if after:
        where += ' AND (s.hot, s.object_id) < (:c_hot, :c_id)'
        params.update(c_hot=after[0], c_id=after[1])
    # CROSS JOIN 固定由 content_stat_hot 索引按热度倒序驱动，取够 limit 条就停；否则规划器会全表扫 object_head 再排序
    inner = (f'SELECT h.*, s.hot AS sort_key FROM content_stat s CROSS JOIN object_head h ON h.id = s.object_id '
             f'WHERE s.is_root = 1 AND {where} AND {pred.sql} ORDER BY s.hot DESC, s.object_id DESC LIMIT :n')
    rows = conn.execute(_join(inner, 'h.sort_key DESC, h.id DESC'), {**pred.params, **params, 'n': limit + 1}).fetchall()
    rows, cursor = _page(rows, limit, lambda r: [r['sort_key'], r['id']])
    return cards(conn, actor, rows), cursor


def _followed_candidates(conn, tags, after, size):
    """每个关注标签沿 content_tag_recent 索引各取最新 size 条，合并去重后取全局最新 size 条（这就是精确的前 size 条）。"""
    parts, args = [], {'b': size}
    for i, tag in enumerate(tags):
        cond = f't.tag = :g{i}' + (' AND (t.created_at, t.object_id) < (:c_at, :c_id)' if after else '')
        parts.append(f'SELECT * FROM (SELECT t.object_id, t.created_at FROM content_tag t WHERE {cond} '
                     'ORDER BY t.created_at DESC, t.object_id DESC LIMIT :b)')
        args[f'g{i}'] = tag
    if after:
        args.update(c_at=after[0], c_id=after[1])
    return conn.execute('SELECT DISTINCT object_id, created_at FROM (' + ' UNION ALL '.join(parts) + ') '
                        'ORDER BY created_at DESC, object_id DESC LIMIT :b', args).fetchall()


def feed_following(conn, actor, types, space_id, after, limit):
    """按关注标签分批取候选，再逐批过可见性；最多扫 FOLLOW_ROUNDS 批，扫不满一页就带着游标返回短页。"""
    tags = [r[0] for r in conn.execute('SELECT tag FROM content_follow WHERE principal_id = ? ORDER BY tag',
                                       (actor.id or '',))]
    if not tags:
        return [], None
    pred = visible_predicate(actor)
    where, params = _root_filter(_types(types), space_id)
    size = max(limit + 1, FOLLOW_BATCH)
    ids, scan, cursor = [], after, None
    for _ in range(FOLLOW_ROUNDS):
        batch = _followed_candidates(conn, tags, scan, size)
        if batch:
            marks = ','.join(f':i{k}' for k in range(len(batch)))
            keep = {r[0] for r in conn.execute(
                f'SELECT h.id FROM object_head h WHERE h.id IN ({marks}) AND {where} AND {pred.sql}',
                {**pred.params, **params, **{f'i{k}': r['object_id'] for k, r in enumerate(batch)}})}
            ids += [r['object_id'] for r in batch if r['object_id'] in keep]
        if len(ids) > limit or len(batch) < size:
            break
        scan = (batch[-1]['created_at'], batch[-1]['object_id'])
    else:
        cursor = list(scan) if len(ids) <= limit else None
    ids = ids[:limit + 1]
    if not ids:
        return [], cursor
    marks = ','.join(f':i{k}' for k in range(len(ids)))
    inner = f'SELECT h.* FROM object_head h WHERE h.id IN ({marks})'
    rows = conn.execute(_join(inner, 'h.created_at DESC, h.id DESC'),
                        {f'i{k}': v for k, v in enumerate(ids)}).fetchall()
    rows, more = _page(rows, limit, lambda r: [r['created_at'], r['id']])
    return cards(conn, actor, rows), more or cursor


def saved_list(conn, actor, after, limit):
    pred = visible_predicate(actor)
    where, params = '', {}
    if after:
        where = ' AND (s.created_at, s.object_id) < (:c_at, :c_id)'
        params.update(c_at=after[0], c_id=after[1])
    inner = (f'SELECT h.*, s.created_at AS sort_key FROM content_save s JOIN object_head h ON h.id = s.object_id '
             f'WHERE s.principal_id = :me{where} AND {pred.sql} ORDER BY s.created_at DESC, s.object_id DESC LIMIT :n')
    rows = conn.execute(_join(inner, 'h.sort_key DESC, h.id DESC'),
                        {**pred.params, **params, 'me': actor.id, 'n': limit + 1}).fetchall()
    rows, cursor = _page(rows, limit, lambda r: [r['sort_key'], r['id']])
    return cards(conn, actor, rows), cursor


# ---------- 回复与讨论串 ----------

def _body(conn, object_id, version):
    row = conn.execute('SELECT content_json FROM object_version WHERE object_id = ? AND version = ?',
                       (object_id, version)).fetchone()
    return json.loads(row['content_json']).get('body', '') if row else ''


def create_reply(conn, actor, target_id, body, reply_to=None, request_id=None):
    target = objects.load_visible(conn, actor, target_id)
    if target['root_id']:
        reply_to = reply_to or target['id']
        target = objects.load_visible(conn, actor, target['root_id'])
    parent = quoted = None
    if reply_to:
        quoted = objects.load_visible(conn, actor, reply_to)
        if quoted['root_id'] != target['id']:
            raise ApiError('validation_failed', 'reply_to 必须是同一个讨论串里的回复')
        if quoted['lifecycle'] != 'active':
            raise ApiError('state_conflict', '原消息已删除或在审核中，不能回复')
        ensure_reply_row(conn, quoted)
        parent = conn.execute('SELECT * FROM content_reply WHERE object_id = ?', (reply_to,)).fetchone()
        if parent['depth'] + 1 > MAX_DEPTH:
            raise ApiError('validation_failed', f'回复层级不能超过 {MAX_DEPTH} 层')
    content = objects.TYPES['reply'][0]({'body': body})
    object_id = objects.create(conn, actor, type='reply', title=excerpt(content['body'], 60) or '回复',
                               content=content, root_id=target['id'], request_id=request_id)
    head = conn.execute('SELECT * FROM object_head WHERE id = ?', (object_id,)).fetchone()
    seg = f'{head["doc_no"]:010d}'
    if parent:
        values = (target['id'], reply_to, parent['thread_root'], parent['depth'] + 1, f'{parent["path"]}.{seg}',
                  quoted['author_id'], excerpt(_body(conn, reply_to, quoted['current_version']), QUOTE_CHARS),
                  quoted['current_version'])
    else:
        values = (target['id'], None, object_id, 0, seg, None, None, None)
    conn.execute('INSERT INTO content_reply (object_id, target_id, reply_to, thread_root, depth, path, quote_author_id, '
                 'quote_excerpt, quote_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (object_id, *values, head['created_at']))
    refresh_stat(conn, object_id)
    refresh_stat(conn, target['id'])
    return object_id


REPLY_COLUMNS = ('h.id, h.author_id, h.lifecycle, h.current_version, h.policy_epoch, h.created_at, h.doc_no, '
                 'r.reply_to, r.thread_root, r.depth, r.path, r.quote_author_id, r.quote_excerpt, r.quote_version, '
                 "coalesce(r.path, printf('%010d', h.doc_no)) AS sort_path")


def list_replies(conn, actor, target_id, order='time', thread_root=None, after=None, limit=50):
    target = objects.load_visible(conn, actor, target_id)
    if target['root_id']:
        raise ApiError('validation_failed', '请用原帖编号取回复；子串用 thread_root 参数')
    pred = visible_predicate(actor)
    params = {**pred.params, 't': target['id'], 'n': limit + 1}
    seen = f"h.lifecycle != 'draft' AND {pred.sql}"
    select = f'SELECT {REPLY_COLUMNS}, CASE WHEN {pred.sql} THEN 1 ELSE 0 END AS readable'
    if thread_root:
        params['tr'] = thread_root
    if order == 'tree':
        # 按 content_reply_tree / content_reply_thread 索引的 path 顺序取，够一页就停；
        # 经核心接口新建、outbox 还没补关系行的回复按 doc_no 当顶层并进来
        cond = 'r.target_id = :t'
        orphan = 'h.root_id = :t AND NOT EXISTS (SELECT 1 FROM content_reply r0 WHERE r0.object_id = h.id)'
        if thread_root:
            cond += ' AND r.thread_root = :tr'
            orphan += ' AND h.id = :tr'
        if after:
            cond += ' AND r.path > :c_path'
            orphan += " AND printf('%010d', h.doc_no) > :c_path"
            params['c_path'] = after[0]
        sql = (f'SELECT * FROM ({select} FROM content_reply r CROSS JOIN object_head h ON h.id = r.object_id '
               f'WHERE {cond} AND {seen} ORDER BY r.path LIMIT :n) UNION ALL '
               f'SELECT * FROM ({select} FROM object_head h LEFT JOIN content_reply r ON r.object_id = h.id '
               f'WHERE {orphan} AND {seen} ORDER BY h.doc_no LIMIT :n) ORDER BY sort_path LIMIT :n')
        key = lambda r: [r['sort_path']]
    else:
        where = f'h.root_id = :t AND {seen}'
        if thread_root:
            where += ' AND coalesce(r.thread_root, h.id) = :tr'
        if after:
            where += ' AND (h.created_at, h.id) > (:c_at, :c_id)'
            params.update(c_at=after[0], c_id=after[1])
        sql = (f'{select} FROM object_head h LEFT JOIN content_reply r ON r.object_id = h.id WHERE {where} '
               'ORDER BY h.created_at, h.id LIMIT :n')
        key = lambda r: [r['created_at'], r['id']]
    rows = conn.execute(sql, params).fetchall()
    rows, cursor = _page(rows, limit, key)
    return messages(conn, actor, rows), cursor


def _status(lifecycle):
    return {'active': 'ok', 'withdrawn': 'deleted'}.get(lifecycle, 'hidden')


def messages(conn, actor, rows):
    readable = [r for r in rows if r['readable']]
    bodies, edited = {}, {}
    if readable:
        marks = ','.join('?' * len(readable))
        for v in conn.execute(f'SELECT v.object_id, v.content_json, v.created_at FROM object_version v JOIN object_head h '
                              f'ON h.id = v.object_id AND v.version = h.current_version WHERE v.object_id IN ({marks})',
                              [r['id'] for r in readable]):
            bodies[v['object_id']] = json.loads(v['content_json']).get('body', '')
            edited[v['object_id']] = v['created_at']
    quoted_ids = list({ref for r in rows for ref in (r['reply_to'], r['thread_root']) if ref})
    quoted = {}
    if quoted_ids:
        pred = visible_predicate(actor)
        marks = ','.join(f':ref{i}' for i in range(len(quoted_ids)))
        params = {**pred.params, **{f'ref{i}': ref for i, ref in enumerate(quoted_ids)}}
        quoted = {q['id']: q for q in conn.execute(
            f'SELECT h.id, h.author_id, h.lifecycle, h.current_version FROM object_head h '
            f'WHERE h.id IN ({marks}) AND {pred.sql}', params)}
    who = people(conn, actor, [r['author_id'] for r in readable] + [r['quote_author_id'] for r in rows])
    socials = social(conn, actor, [r['id'] for r in readable])
    out = []
    for r in rows:
        item = {'id': r['id'], 'createdAt': r['created_at'], 'reply_to': r['reply_to'],
                'thread_root': r['thread_root'] or r['id'], 'depth': r['depth'] or 0}
        if r['readable']:
            person = who.get(r['author_id'])
            s = socials[r['id']]
            item.update(authorId=r['author_id'], author=person, body=bodies.get(r['id'], ''),
                        editedAt=edited.get(r['id']) if r['current_version'] > 1 else None,
                        version=r['current_version'], etag=f'"v{r["current_version"]}-p{r["policy_epoch"]}"',
                        status=_status(r['lifecycle']), reactions=s['stats']['reactions'],
                        mine=s['mine']['reactions'], usefulCount=s['stats']['useful'], saved=s['mine']['saved'])
        else:
            item.update(authorId=None, author=None, body=None, editedAt=None, version=None, etag=None,
                        status=_status(r['lifecycle']), reactions={}, mine={}, usefulCount=0, saved=False)
        original = quoted.get(r['reply_to'])
        item['quote'] = _quote(actor, r, original, who) if original and r['readable'] else None
        if r['reply_to'] and original is None:
            item['reply_to'] = None
            item['depth'] = 0
        if r['thread_root'] and r['thread_root'] not in quoted:
            item['thread_root'] = r['id']
        out.append(item)
    return out


def _quote(actor, r, original, who):
    author = who.get(r['quote_author_id']) or {}
    if original is None or original['lifecycle'] == 'withdrawn':
        status = 'deleted'
    elif original['lifecycle'] != 'active' and original['author_id'] != actor.id:
        status = 'hidden'
    elif original['current_version'] > (r['quote_version'] or 0):
        status = 'edited'
    else:
        status = 'ok'
    return {'id': r['reply_to'], 'authorId': r['quote_author_id'], 'authorName': author.get('display_name'),
            'excerpt': r['quote_excerpt'] if status in ('ok', 'edited') else None, 'version': r['quote_version'],
            'status': status}


def reply_detail(conn, actor, object_id):
    pred = visible_predicate(actor)
    row = conn.execute(f'SELECT {REPLY_COLUMNS}, 1 AS readable FROM object_head h LEFT JOIN content_reply r '
                       f'ON r.object_id = h.id WHERE h.id = :id AND {pred.sql}', {**pred.params, 'id': object_id}
                       ).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return messages(conn, actor, [row])[0]


def edit_reply(conn, actor, object_id, body, if_match, request_id=None):
    row = objects.load_visible(conn, actor, object_id)
    if row['type'] != 'reply':
        raise ApiError('resource_not_found')
    content = objects.TYPES['reply'][0]({'body': body})
    objects.update(conn, actor, row, {'title': excerpt(content['body'], 60) or '回复', 'content': content}, if_match,
                   request_id)
    return reply_detail(conn, actor, object_id)


# ---------- 反应、收藏、有用、关注 ----------

def _active_visible(conn, actor, object_id):
    row = objects.load_visible(conn, actor, object_id)
    if row['lifecycle'] != 'active':
        raise ApiError('state_conflict', '这条内容现在不能互动')
    return row


def react(conn, actor, object_id, kind, on, request_id=None):
    if kind == 'useful':
        raise ApiError('validation_failed', '「有用」请用 POST /api/content/objects/{id}/useful')
    if kind not in REACTIONS:
        raise ApiError('validation_failed', '不认识的反应')
    row = _active_visible(conn, actor, object_id)
    require(conn, actor, 'content.react', dict(row))
    now = clock.now()
    if on:
        changed = conn.execute('INSERT OR IGNORE INTO content_reaction (object_id, principal_id, kind, created_at) '
                               'VALUES (?, ?, ?, ?)', (object_id, actor.id, kind, now)).rowcount
    else:
        changed = conn.execute('DELETE FROM content_reaction WHERE object_id = ? AND principal_id = ? AND kind = ?',
                               (object_id, actor.id, kind)).rowcount
    if changed:
        refresh_stat(conn, object_id)
        outbox.emit(conn, 'content.reaction_changed', 'object', object_id, {'kind': kind, 'on': on},
                    actor_id=actor.id, request_id=request_id)
    s = social(conn, actor, [object_id])[object_id]
    return {'object_id': object_id, 'reactions': s['stats']['reactions'], 'mine': s['mine']['reactions']}


def save(conn, actor, object_id, on, request_id=None):
    if on:
        row = _active_visible(conn, actor, object_id)
        require(conn, actor, 'content.save', dict(row))
        changed = conn.execute('INSERT OR IGNORE INTO content_save (principal_id, object_id, created_at) '
                               'VALUES (?, ?, ?)', (actor.id, object_id, clock.now())).rowcount
    else:
        changed = conn.execute('DELETE FROM content_save WHERE principal_id = ? AND object_id = ?',
                               (actor.id, object_id)).rowcount
    if changed:
        refresh_stat(conn, object_id)
        outbox.emit(conn, 'content.save_changed', 'object', object_id, {'on': on}, actor_id=actor.id,
                    request_id=request_id)
    return {'object_id': object_id, 'saved': on}


def _antiabuse():
    try:
        return importlib.import_module('modules.growth.antiabuse')
    except ImportError:
        return None


def award_useful(conn, *, giver_id, receiver_id, object_id, request_id=None):
    """优先用 growth 的 record_useful（判断 + 流水 + 折扣明细同一事务）；只有 assess_useful 时自己记流水；都没有就不计分。"""
    module = _antiabuse()
    if module is None:
        return {'allow': False, 'points': 0, 'reason': 'growth_unavailable', 'entry_id': None}
    if hasattr(module, 'record_useful'):
        return module.record_useful(conn, giver_id=giver_id, receiver_id=receiver_id, object_id=object_id,
                                    request_id=request_id)
    verdict = module.assess_useful(conn, giver_id=giver_id, receiver_id=receiver_id, object_id=object_id, now=None)
    result = {'allow': bool(verdict['allow']), 'points': int(verdict['points']), 'reason': verdict['reason'],
              'entry_id': None}
    if result['allow'] and result['points'] > 0:
        result['entry_id'] = ledger.record(conn, event_type='useful', subject_id=receiver_id, points=result['points'],
                                           rule_version='content-useful-v1',
                                           idempotency_key=f'useful:{giver_id}:{object_id}',
                                           source_ref=f'object:{object_id}', actor_id=giver_id, confirmed_by=giver_id,
                                           request_id=request_id)
    return result


def mark_useful(conn, actor, object_id, request_id=None):
    row = _active_visible(conn, actor, object_id)
    require(conn, actor, 'content.useful', dict(row))
    if row['author_id'] == actor.id:
        raise ApiError('state_conflict', '不能给自己的内容标「有用」')
    if conn.execute('SELECT 1 FROM content_useful WHERE object_id = ? AND giver_id = ?',
                    (object_id, actor.id)).fetchone():
        raise ApiError('state_conflict', '你已经标过「有用」了')
    result = award_useful(conn, giver_id=actor.id, receiver_id=row['author_id'], object_id=object_id,
                          request_id=request_id)
    counted = bool(result.get('allow') and result.get('entry_id'))
    conn.execute('INSERT INTO content_useful (object_id, giver_id, receiver_id, counted, points, reason, '
                 'ledger_entry_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                 (object_id, actor.id, row['author_id'], int(counted), result.get('points', 0) if counted else 0,
                  result.get('reason'), result.get('entry_id'), clock.now()))
    refresh_stat(conn, object_id)
    outbox.emit(conn, 'content.useful_marked', 'object', object_id, {'counted': counted}, actor_id=actor.id,
                request_id=request_id)
    audit.record(conn, actor.id, 'content.useful', 'object', object_id, request_id=request_id,
                 meta={'counted': counted, 'reason': result.get('reason')})
    return {'object_id': object_id, 'marked': True, 'counted': counted,
            'points': result.get('points', 0) if counted else 0, 'reason': result.get('reason'),
            'useful': social(conn, actor, [object_id])[object_id]['stats']['useful']}


def follow(conn, actor, tag, on):
    norm = norm_tag(tag)
    if norm is None:
        raise ApiError('validation_failed', '方向（标签）要有 1 到 32 个字')
    if on:
        require(conn, actor, 'content.follow')
        count = conn.execute('SELECT count(*) FROM content_follow WHERE principal_id = ?', (actor.id,)).fetchone()[0]
        if count >= MAX_FOLLOWS:
            raise ApiError('validation_failed', f'最多关注 {MAX_FOLLOWS} 个方向')
        conn.execute('INSERT OR IGNORE INTO content_follow (principal_id, tag, created_at) VALUES (?, ?, ?)',
                     (actor.id, norm, clock.now()))
    else:
        conn.execute('DELETE FROM content_follow WHERE principal_id = ? AND tag = ?', (actor.id, norm))
    return follows(conn, actor)


def follows(conn, actor):
    return [r[0] for r in conn.execute('SELECT tag FROM content_follow WHERE principal_id = ? ORDER BY created_at',
                                       (actor.id,))]


# ---------- 富详情：提及回填、知识卡按权限解析、图片和上传件元数据 ----------

def enrich_detail(conn, actor, row, data, content_origin=''):
    content = data.get('content') or {}
    doc = content.get('doc')
    if doc:
        mentions = [n['attrs']['id'] for n in sanitize.walk(doc, 'mention')]
        names = people(conn, actor, mentions)
        for node in sanitize.walk(doc, 'mention'):
            person = names.get(node['attrs']['id'])
            if person:
                node['attrs']['label'] = person['display_name']
        refs = list(dict.fromkeys(n['attrs']['refId'] for n in sanitize.walk(doc, 'knowledgeCard')))
        found = {}
        if refs:
            pred = visible_predicate(actor)
            marks = ','.join(f':r{i}' for i in range(len(refs)))
            for c in conn.execute(f'SELECT h.id, h.type, v.title FROM object_head h JOIN object_version v ON '
                                  f'v.object_id = h.id AND v.version = h.current_version WHERE h.id IN ({marks}) '
                                  f"AND h.lifecycle = 'active' AND {pred.sql}",
                                  {**pred.params, **{f'r{i}': r for i, r in enumerate(refs)}}):
                found[c['id']] = {'id': c['id'], 'type': c['type'], 'title': c['title']}
        data['cards'] = {r: found.get(r) for r in refs}
        srcs = [n['attrs']['src'] for n in sanitize.walk(doc, 'image')]
        data['images'] = images_for(conn, actor, srcs, content_origin)
    ids = [content.get('cover'), content.get('html_asset'), *content.get('demo', [])]
    ids += [n['attrs']['workId'] for n in sanitize.walk(doc, 'htmlWork')] if doc else []
    data['assets'] = media.assets_meta(conn, actor, [i for i in ids if i], content_origin)
    data['author'] = people(conn, actor, [row['author_id']]).get(row['author_id'], data['author'])
    data.update(social(conn, actor, [row['id']])[row['id']])
    if row['root_id']:
        data['reply'] = reply_detail(conn, actor, row['id'])
    return data


def images_for(conn, actor, srcs, content_origin=''):
    shas = {}
    for src in dict.fromkeys(srcs):
        m = media.MEDIA_PATH.fullmatch(src)
        if m:
            shas[m.group(1)] = src
    if not shas or not actor.authenticated:
        return {}
    sql, params = media.access_sql(actor)
    marks = ','.join(f':s{i}' for i in range(len(shas)))
    params.update({f's{i}': s for i, s in enumerate(shas)})
    pairs = conn.execute(f'SELECT DISTINCT v.sha256, v.asset_id FROM media_variant v JOIN media_asset a '
                         f'ON a.id = v.asset_id WHERE v.sha256 IN ({marks}) AND {sql}', params).fetchall()
    metas = media.assets_meta(conn, actor, [p['asset_id'] for p in pairs], content_origin)
    return {shas[p['sha256']]: metas[p['asset_id']] for p in pairs if p['asset_id'] in metas}


# ---------- 导出与注销 ----------

def export_rows(conn, actor):
    pid = actor.id
    rows = lambda sql: [dict(r) for r in conn.execute(sql, (pid,))]
    return {
        'reactions': rows('SELECT object_id, kind, created_at FROM content_reaction WHERE principal_id = ? '
                          'ORDER BY created_at'),
        'saved': rows('SELECT object_id, created_at FROM content_save WHERE principal_id = ? ORDER BY created_at'),
        'useful_given': rows('SELECT object_id, counted, points, reason, created_at FROM content_useful '
                             'WHERE giver_id = ? ORDER BY created_at'),
        'useful_received': rows('SELECT object_id, counted, points, created_at FROM content_useful '
                                'WHERE receiver_id = ? ORDER BY created_at'),
        'follows': rows('SELECT tag, created_at FROM content_follow WHERE principal_id = ? ORDER BY created_at'),
        'digest_reads': rows('SELECT date, read_at FROM content_digest_read WHERE principal_id = ? ORDER BY date')
        if has_hot_tables(conn) else [],
        'hot_discussions_opened': rows('SELECT event_id, object_id, created_at FROM content_hot_link '
                                       'WHERE created_by = ? ORDER BY created_at') if has_hot_tables(conn) else [],
        'replies': rows('SELECT r.object_id, r.target_id, r.reply_to, r.thread_root, r.depth, r.created_at '
                        'FROM content_reply r JOIN object_head h ON h.id = r.object_id WHERE h.author_id = ? '
                        'ORDER BY r.created_at'),
    }


def purge_principal(conn, principal_id):
    saved = [r[0] for r in conn.execute('SELECT object_id FROM content_save WHERE principal_id = ?', (principal_id,))]
    conn.execute('DELETE FROM content_save WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM content_follow WHERE principal_id = ?', (principal_id,))
    conn.execute('UPDATE content_reply SET quote_excerpt = NULL WHERE quote_author_id = ? OR object_id IN '
                 '(SELECT id FROM object_head WHERE author_id = ?)', (principal_id, principal_id))
    for object_id in saved:
        refresh_stat(conn, object_id)
    if has_hot_tables(conn):
        conn.execute('DELETE FROM content_digest_read WHERE principal_id = ?', (principal_id,))
        conn.execute('UPDATE content_hot_link SET created_by = NULL WHERE created_by = ?', (principal_id,))
    return {'saves': len(saved)}


def on_principal_deleted(conn, event):
    if installed(conn):
        purge_principal(conn, event['aggregate_id'])


# ---------- 热点事件 ↔ 讨论：同一事件只留一篇；日报按天已读 ----------

def hot_discussion(conn, actor, event_id):
    """事件已关联、且调用者看得见的讨论；没有、已删除或看不见都返回 None。"""
    pred = visible_predicate(actor, 'h')
    row = conn.execute(
        f'SELECT h.id, v.title FROM content_hot_link l JOIN object_head h ON h.id = l.object_id '
        f'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
        f"WHERE l.event_id = :event AND h.lifecycle = 'active' AND {pred.sql}",
        {'event': event_id, **pred.params}).fetchone()
    return {'id': row['id'], 'title': row['title']} if row else None


def _hot_event_exists(conn, event_id):
    try:
        return conn.execute('SELECT 1 FROM feed_event WHERE id = ?', (event_id,)).fetchone() is not None
    except Exception:  # feed 模块没装：没有事件可关联
        return False


def open_hot_discussion(conn, actor, event_id, title, body, request_id=None):
    """已有关联就直接返回；没有才以调用者的名义建帖并记下关联。返回 (讨论, 是否新建)。"""
    existing = hot_discussion(conn, actor, event_id)
    if existing:
        return existing, False
    if not _hot_event_exists(conn, event_id):
        raise ApiError('resource_not_found')
    object_id = objects.create(conn, actor, type='discussion', title=title, content={'body': body},
                               visibility='members', min_level=1, request_id=request_id)
    conn.execute('DELETE FROM content_hot_link WHERE event_id = ?', (event_id,))
    conn.execute('INSERT INTO content_hot_link (event_id, object_id, created_by, created_at) VALUES (?, ?, ?, ?)',
                 (event_id, object_id, actor.id, clock.now()))
    audit.record(conn, actor.id, 'content.hot_discussion', 'discussion', object_id, request_id=request_id)
    return {'id': object_id, 'title': title}, True


def digest_read(conn, actor, day):
    row = conn.execute('SELECT read_at FROM content_digest_read WHERE principal_id = ? AND date = ?',
                       (actor.id, day)).fetchone()
    return {'date': day, 'read': row is not None, 'read_at': row['read_at'] if row else None}


def set_digest_read(conn, actor, day, read):
    if read:
        conn.execute('INSERT OR IGNORE INTO content_digest_read (principal_id, date, read_at) VALUES (?, ?, ?)',
                     (actor.id, day, clock.now()))
    else:
        conn.execute('DELETE FROM content_digest_read WHERE principal_id = ? AND date = ?', (actor.id, day))
    return digest_read(conn, actor, day)
