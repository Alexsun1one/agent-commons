"""热点读写：入库、增量聚类、中文化、热度、站内相关、接口形状。"""
import json
import re
import uuid
from datetime import timedelta

from app import audit, clock, outbox
from app.authz import visible_predicate
from app.errors import ApiError

from . import pathsetup  # noqa: F401

from engine.feed import cluster, digest, heat, sources
from engine.feed.cluster import parse_time
from engine.feed.fetch import Fetcher
from modules.admin import params as admin_params
from modules.ai import gateway as ai_gateway

WINDOW_H = cluster.WINDOW_H
RELATED_TYPES = (('knowledge', '知识'), ('work', '作品'), ('discussion', '讨论'))
SUMMARY_ZH_MAX = 40

admin_params.declare('feed', 'translate_enabled')


def ensure_sources(conn):
    """把 sources.py 白名单同步进 feed_source；不在白名单里的行停用。"""
    now = clock.now()
    known = set()
    for src in sources.SOURCES:
        known.add(src['id'])
        row = conn.execute('SELECT id FROM feed_source WHERE id = ?', (src['id'],)).fetchone()
        if row:
            conn.execute(
                'UPDATE feed_source SET name = ?, type = ?, url = ?, lang = ?, weight = ?, '
                'direction = ?, enabled = 1 WHERE id = ?',
                (src['name'], src['type'], src['url'], src['lang'], src['weight'], src['direction'], src['id']))
        else:
            conn.execute(
                'INSERT INTO feed_source (id, name, type, url, lang, weight, direction, enabled) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
                (src['id'], src['name'], src['type'], src['url'], src['lang'], src['weight'], src['direction']))
    if known:
        placeholders = ','.join('?' * len(known))
        conn.execute(f'UPDATE feed_source SET enabled = 0 WHERE id NOT IN ({placeholders})', tuple(known))
    return now


def source_catalog():
    return [{
        'id': s['id'], 'name': s['name'], 'initial': sources.initial(s['name']),
        'direction': s['direction'], 'lang': s['lang'],
    } for s in sources.SOURCES]


def direction_catalog():
    return [{'id': i, 'label': l} for i, l in sources.DIRECTIONS]


def _item_from_row(row):
    return {
        'source': row['source_id'],
        'url': row['url'],
        'canonical_url': row['canonical_url'],
        'title': row['title'],
        'title_zh': row['title_zh'] or '',
        'summary_zh': row['summary_zh'] or '',
        'excerpt': row['excerpt'] or '',
        'published_at': row['published_at'],
        'lang': row['lang'],
    }


def _clip(text, limit):
    text = ' '.join(str(text or '').split()).strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + '…'


def _one_sentence(text, limit=SUMMARY_ZH_MAX):
    """保留模型摘要第一句，并把最终展示值锁在 40 字以内。"""
    text = ' '.join(str(text or '').split()).strip()
    match = re.match(r'^.*?[。！？!?](?:[”’"])?', text)
    return _clip(match.group(0) if match else text, limit)


def _localized_from_items(title, items):
    lead = next((it for it in items if it.get('title') == title), None)
    lead = lead or next((it for it in items if it.get('title_zh')), None)
    return ((lead or {}).get('title_zh') or '', (lead or {}).get('summary_zh') or '')


def translate_enabled(conn):
    return int(admin_params.value(conn, 'feed', 'translate_enabled', 0) or 0) == 1


def translate_pending(db, run=None, limit=50):
    """中文化尚未处理的公开来源条目；模型调用始终发生在数据库写事务之外。"""
    runner = run or ai_gateway.run
    with db.read() as conn:
        if not translate_enabled(conn):
            return {'translated': 0, 'chinese': 0, 'failed': 0, 'skipped': True}
        rows = [dict(row) for row in conn.execute(
            "SELECT id, source_id, canonical_url, title, excerpt, lang, event_id FROM feed_item "
            "WHERE title_zh = '' AND summary_zh = '' ORDER BY fetched_at, id LIMIT ?", (limit,)).fetchall()]

    stats = {'translated': 0, 'chinese': 0, 'failed': 0, 'skipped': False}
    for row in rows:
        if row['lang'] == 'zh':
            localized = _clip(row['title'], SUMMARY_ZH_MAX)
            with db.write() as conn:
                changed = conn.execute(
                    "UPDATE feed_item SET title_zh = ?, summary_zh = ? "
                    "WHERE id = ? AND title_zh = '' AND summary_zh = ''",
                    (localized, localized, row['id'])).rowcount
            stats['chinese'] += changed
            continue

        inputs = {
            'items': [{
                'id': row['canonical_url'],
                'title': row['title'],
                'excerpt': row['excerpt'],
                'source': row['source_id'],
            }],
            'event_title': row['title'],
        }
        try:
            result = runner(db, feature='feed.summarize', task='event', inputs=inputs,
                            object_id=row['event_id'] or row['id'])
        except Exception:
            stats['failed'] += 1
            continue
        if getattr(result, 'degraded', True):
            stats['failed'] += 1
            continue
        data = result.data if isinstance(getattr(result, 'data', None), dict) else {}
        title_zh = _clip(data.get('headline'), 60)
        summary_zh = _one_sentence(data.get('summary'))
        if not title_zh or not summary_zh:
            stats['failed'] += 1
            continue
        with db.write() as conn:
            changed = conn.execute(
                "UPDATE feed_item SET title_zh = ?, summary_zh = ? "
                "WHERE id = ? AND title_zh = '' AND summary_zh = ''",
                (title_zh, summary_zh, row['id'])).rowcount
        stats['translated'] += changed
    return stats


def ingest_items(conn, items, fetched_at=None):
    """写入解析后的条目。只收白名单 source id；同一 canonical_url 不重复。返回新插入条数。"""
    ensure_sources(conn)
    fetched_at = fetched_at or clock.now()
    added = 0
    for it in items:
        sid = it.get('source')
        if sid not in sources.SOURCE_BY_ID:
            continue
        canonical = it.get('canonical_url')
        if not canonical or not it.get('title'):
            continue
        exists = conn.execute('SELECT 1 FROM feed_item WHERE canonical_url = ?', (canonical,)).fetchone()
        if exists:
            continue
        conn.execute(
            'INSERT INTO feed_item (id, source_id, url, canonical_url, title, excerpt, published_at, lang, event_id, fetched_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
            (str(uuid.uuid4()), sid, it.get('url') or canonical, canonical, it['title'],
             (it.get('excerpt') or '')[:140], it.get('published_at'), it.get('lang') or 'en', fetched_at))
        added += 1
    return added


def _load_recent_events(conn, now_t, window_h=WINDOW_H):
    cutoff = (now_t - timedelta(hours=window_h)).strftime('%Y-%m-%dT%H:%M:%SZ')
    rows = conn.execute(
        'SELECT * FROM feed_event WHERE last_seen IS NULL OR last_seen >= ? ORDER BY last_seen, id',
        (cutoff,)).fetchall()
    events = []
    for row in rows:
        items = [_item_from_row(it) for it in conn.execute(
            'SELECT * FROM feed_item WHERE event_id = ? ORDER BY published_at, id', (row['id'],))]
        title_zh, summary_zh = _localized_from_items(row['title'], items)
        events.append({
            'id': row['id'],
            'title': row['title'],
            'direction': row['direction'],
            'items': items,
            'source_ids': sorted({it['source'] for it in items}),
            'first_seen': row['first_seen'],
            'last_seen': row['last_seen'],
            'entities': json.loads(row['entities_json'] or '[]'),
            'title_zh': title_zh,
            'summary_zh': summary_zh,
        })
    return events


def _refresh_event_row(conn, event, now):
    conn.execute(
        'UPDATE feed_event SET title = ?, direction = ?, first_seen = ?, last_seen = ?, '
        'entities_json = ?, updated_at = ? WHERE id = ?',
        (event['title'], event['direction'], event['first_seen'], event['last_seen'],
         json.dumps(event['entities'], ensure_ascii=False), now, event['id']))


def _features_map(items, lexicon):
    return {id(it): cluster.features(it, lexicon) for it in items}


def _compose_event(items, lexicon, source_map):
    feats = _features_map(items, lexicon)
    epoch = parse_time('1970-01-01T00:00:00Z')
    lead = sorted(items, key=lambda m: (-cluster._weight(source_map, m), feats[id(m)]['t'] or epoch))[0]
    times = [feats[id(m)]['t'] for m in items if feats[id(m)]['t']]
    src = source_map.get(lead['source'])
    ents = {}
    for m in items:
        ents.update(feats[id(m)]['ents'])
    title_zh, summary_zh = _localized_from_items(lead['title'], items)
    return {
        'id': cluster.event_id_for(items[0]),
        'title': lead['title'],
        'direction': cluster._direction(lexicon, feats[id(lead)]['ents'], ents, src['direction'] if src else 'product'),
        'items': items,
        'source_ids': sorted({m['source'] for m in items}),
        'first_seen': min(times).strftime('%Y-%m-%dT%H:%M:%SZ') if times else None,
        'last_seen': max(times).strftime('%Y-%m-%dT%H:%M:%SZ') if times else None,
        'entities': sorted(ents),
        'title_zh': title_zh,
        'summary_zh': summary_zh,
    }


def cluster_pending(conn, now=None, window_h=WINDOW_H):
    """把还没挂事件的条目增量并进 72 小时内的事件。返回新事件数。"""
    now = now or clock.now()
    now_t = parse_time(now) or parse_time(now.replace('+00:00', 'Z') if now else None)
    if now_t is None:
        now_t = parse_time('2026-10-25T08:00:00Z')
    pending_rows = conn.execute(
        'SELECT * FROM feed_item WHERE event_id IS NULL ORDER BY published_at, canonical_url').fetchall()
    if not pending_rows:
        return 0
    lexicon = cluster.DEFAULT_LEXICON
    source_map = sources.SOURCE_BY_ID
    existing = _load_recent_events(conn, now_t, window_h)
    created = 0
    for row in pending_rows:
        item = _item_from_row(row)
        feat = cluster.features(item, lexicon)
        best, best_score = None, -1.0
        for ev in existing:
            members = ev['items']
            if not members:
                continue
            first_t = cluster.features(members[0], lexicon)['t']
            if feat['t'] and first_t and cluster._hours(feat['t'], first_t) > window_h:
                continue
            score = max(
                (cluster.similarity(feat['hash'], cluster.features(m, lexicon)['hash'])
                 for m in members if cluster.same_event(feat, cluster.features(m, lexicon), window_h)),
                default=-1.0,
            )
            if score > best_score:
                best, best_score = ev, score
        if best is None:
            composed = _compose_event([item], lexicon, source_map)
            conn.execute(
                'INSERT INTO feed_event (id, title, direction, first_seen, last_seen, entities_json, created_at, updated_at) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (composed['id'], composed['title'], composed['direction'], composed['first_seen'],
                 composed['last_seen'], json.dumps(composed['entities'], ensure_ascii=False), now, now))
            conn.execute('UPDATE feed_item SET event_id = ? WHERE id = ?', (composed['id'], row['id']))
            existing.append(composed)
            created += 1
        else:
            best['items'].append(item)
            composed = _compose_event(best['items'], lexicon, source_map)
            composed['id'] = best['id']
            _refresh_event_row(conn, composed, now)
            conn.execute('UPDATE feed_item SET event_id = ? WHERE id = ?', (best['id'], row['id']))
            best.update(composed)
    return created


def _site_rows(conn, event_id=None):
    sql = 'SELECT event_id, kind, at FROM feed_signal'
    args = ()
    if event_id:
        sql += ' WHERE event_id = ?'
        args = (event_id,)
    return [{'event_id': r['event_id'], 'kind': r['kind'], 'at': r['at']} for r in conn.execute(sql, args)]


def _site_counts(conn, event_id):
    rows = conn.execute(
        'SELECT kind, count(*) AS n FROM feed_signal WHERE event_id = ? GROUP BY kind', (event_id,)).fetchall()
    out = {'favorites': 0, 'comments': 0, 'rooms': 0}
    for r in rows:
        if r['kind'] == 'favorite':
            out['favorites'] = r['n']
        elif r['kind'] == 'comment':
            out['comments'] = r['n']
        elif r['kind'] == 'room':
            out['rooms'] = r['n']
    return out


def _linked_discussion(conn, actor, event):
    """热点页「讨论」建好的那一篇（content_hot_link）；优先于关键词猜测，看不见或已删就当没有。"""
    from modules.content import service as content_service
    linked = content_service.hot_discussion(conn, actor, event.get('id'))
    if not linked:
        return None
    author = conn.execute(
        'SELECT p.display_name FROM object_head h JOIN profile p ON p.principal_id = h.author_id WHERE h.id = ?',
        (linked['id'],)).fetchone()
    return {'id': linked['id'], 'title': linked['title'], 'meta': f'讨论 · {author[0] if author else ""}'}


def related_for(conn, actor, event):
    """按实体/关键词找站内知识、作品、讨论各一条；一律拼 visible_predicate。"""
    pred = visible_predicate(actor, 'h')
    found = {}
    linked = _linked_discussion(conn, actor, event)
    if linked:
        found['discussion'] = linked
    needles = list(event.get('entities') or [])
    title = event.get('title') or ''
    for tok in cluster.tokens(title):
        if tok not in needles and len(tok) >= 2:
            needles.append(tok)
    if not needles:
        return found
    for typ, label in RELATED_TYPES:
        if typ in found:
            continue
        clauses = []
        params = dict(pred.params, typ=typ)
        for i, needle in enumerate(needles[:8]):
            key = f'n{i}'
            clauses.append(f'(v.title LIKE :{key} OR v.content_json LIKE :{key})')
            params[key] = f'%{needle}%'
        like = ' OR '.join(clauses)
        row = conn.execute(
            f'SELECT h.id, h.type, v.title, p.display_name AS author_name FROM object_head h '
            f'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
            f'JOIN profile p ON p.principal_id = h.author_id '
            f'WHERE {pred.sql} AND h.type = :typ AND ({like}) '
            f'ORDER BY h.updated_at DESC, h.id DESC LIMIT 1',
            params).fetchone()
        if row:
            found[typ] = {'id': row['id'], 'title': row['title'], 'meta': f'{label} · {row["author_name"]}'}
    return found


def _event_payload(conn, actor, event, now, site, include_related=True):
    h = heat.heat(event, now, site, sources.SOURCE_BY_ID)
    series = heat.hourly_series(event, now, 24, site, sources.SOURCE_BY_ID)
    srcmap = sources.SOURCE_BY_ID
    rows = sorted(event['items'], key=lambda it: it.get('published_at') or '')
    payload = {
        'id': event['id'],
        'title': event['title'],
        'title_zh': event.get('title_zh') or '',
        'summary_zh': event.get('summary_zh') or '',
        'direction': event['direction'],
        'first_seen': event['first_seen'],
        'last_seen': event['last_seen'],
        'source_count': len(event['source_ids']),
        'heat': h,
        'series': series,
        'sources': [{
            'source': it['source'],
            'name': srcmap[it['source']]['name'] if it['source'] in srcmap else it['source'],
            'title': it['title'],
            'title_zh': it.get('title_zh') or '',
            'summary_zh': it.get('summary_zh') or '',
            'url': it['canonical_url'],
            'published_at': it['published_at'],
            'lang': it['lang'],
        } for it in rows],
        'site': _site_counts(conn, event['id']),
        'related': related_for(conn, actor, event) if include_related else {},
    }
    return payload


def load_event(conn, event_id):
    row = conn.execute('SELECT * FROM feed_event WHERE id = ?', (event_id,)).fetchone()
    if row is None:
        return None
    items = [_item_from_row(it) for it in conn.execute(
        'SELECT * FROM feed_item WHERE event_id = ? ORDER BY published_at, id', (event_id,))]
    title_zh, summary_zh = _localized_from_items(row['title'], items)
    return {
        'id': row['id'],
        'title': row['title'],
        'direction': row['direction'],
        'items': items,
        'source_ids': sorted({it['source'] for it in items}),
        'first_seen': row['first_seen'],
        'last_seen': row['last_seen'],
        'entities': json.loads(row['entities_json'] or '[]'),
        'title_zh': title_zh,
        'summary_zh': summary_zh,
    }


def list_events(conn, actor, directions=None, limit=20, now=None):
    now = now or clock.now()
    rows = conn.execute('SELECT id FROM feed_event').fetchall()
    site = _site_rows(conn)
    scored = []
    for row in rows:
        ev = load_event(conn, row['id'])
        if not ev or not ev['items']:
            continue
        if directions and ev['direction'] not in directions:
            continue
        scored.append(_event_payload(conn, actor, ev, now, site))
    scored.sort(key=lambda e: (-(e['heat'] or 0), e.get('first_seen') or '', e['id']))
    return scored[:limit]


def failed_source_ids(conn):
    rows = conn.execute(
        'SELECT id FROM feed_source WHERE consecutive_failures > 0 AND enabled = 1 ORDER BY id').fetchall()
    return [r['id'] for r in rows]


def page_payload(conn, actor, directions=None, limit=20, now=None):
    now = now or clock.now()
    events = list_events(conn, actor, directions, limit, now)
    return {
        'sample': False,
        'generated_at': now if now.endswith('Z') else clock.now(),
        'directions': direction_catalog(),
        'sources': source_catalog(),
        'failed_sources': failed_source_ids(conn),
        'top': [e['id'] for e in events[:3]],
        'events': events,
    }


def event_detail(conn, actor, event_id, now=None):
    ev = load_event(conn, event_id)
    if ev is None:
        raise ApiError('resource_not_found')
    now = now or clock.now()
    return _event_payload(conn, actor, ev, now, _site_rows(conn, event_id))


def collect(conn, transport, now=None, source_ids=None):
    """用注入的传输层抓取白名单源并入库。transport 必须由调用方提供。"""
    if transport is None:
        return {'ok': 0, 'failed': [], 'skipped': [], 'added': 0}
    ensure_sources(conn)
    allowed = [s for s in sources.SOURCES if source_ids is None or s['id'] in source_ids]
    state = {}
    for row in conn.execute('SELECT id, etag, last_modified FROM feed_source').fetchall():
        state[row['id']] = {
            'etag': row['etag'],
            'last_modified': row['last_modified'],
        }
    fetcher = Fetcher(transport, sources=allowed, state=state, retries=1, backoff=0,
                      min_interval=0, sleep=lambda _s: None, now=parse_time(now) if now else None)
    results, summary = fetcher.fetch_all()
    stamp = now or clock.now()
    added = 0
    for result in results:
        src = sources.get(result.source_id)
        if src is None:
            continue
        st = state.get(result.source_id) or {}
        if result.status in ('ok', 'not_modified'):
            conn.execute(
                'UPDATE feed_source SET etag = ?, last_modified = ?, last_ok_at = ?, last_request_at = ?, '
                'consecutive_failures = 0, last_error = NULL WHERE id = ?',
                (st.get('etag'), st.get('last_modified'), stamp, stamp, result.source_id))
        elif result.status == 'error':
            conn.execute(
                'UPDATE feed_source SET last_request_at = ?, consecutive_failures = consecutive_failures + 1, '
                'last_error = ? WHERE id = ?',
                (stamp, (result.error or 'error')[:200], result.source_id))
        if result.status == 'ok' and result.items:
            added += ingest_items(conn, result.items, stamp)
    return {**summary, 'added': added}


def persist_digest(conn, now=None, per_direction=3):
    now = now or clock.now()
    rows = conn.execute('SELECT id FROM feed_event').fetchall()
    events = [load_event(conn, r['id']) for r in rows]
    events = [e for e in events if e and e['items']]
    site = _site_rows(conn)
    built = digest.build(events, now, per_direction=per_direction, site=site, source_map=sources.SOURCE_BY_ID)
    conn.execute('DELETE FROM feed_digest WHERE date = ?', (built['date'],))
    conn.execute(
        'INSERT INTO feed_digest (date, direction, body, generated_at) VALUES (?, ?, ?, ?)',
        (built['date'], '_all', json.dumps(built, ensure_ascii=False), now))
    for sec in built['sections']:
        conn.execute(
            'INSERT INTO feed_digest (date, direction, body, generated_at) VALUES (?, ?, ?, ?)',
            (built['date'], sec['direction'], json.dumps(sec, ensure_ascii=False), now))
    return built


def load_digest(conn, date=None, now=None):
    now = now or clock.now()
    date = date or parse_time(now).strftime('%Y-%m-%d')
    row = conn.execute(
        'SELECT body FROM feed_digest WHERE date = ? AND direction = ?', (date, '_all')).fetchone()
    if row:
        return json.loads(row['body'])
    return digest.build([], now, source_map=sources.SOURCE_BY_ID) | {'date': date, 'sections': [],
                                                                    'intro': '今天还没有日报。', 'text': ''}


def list_subs(conn, user_id):
    rows = conn.execute('SELECT direction FROM feed_sub WHERE user_id = ? ORDER BY direction', (user_id,)).fetchall()
    return [r['direction'] for r in rows]


def replace_subs(conn, actor, directions, request_id=None):
    allowed = {i for i, _ in sources.DIRECTIONS}
    cleaned = []
    for d in directions:
        if d not in allowed:
            raise ApiError('validation_failed', f'不认识的方向：{d}')
        if d not in cleaned:
            cleaned.append(d)
    now = clock.now()
    conn.execute('DELETE FROM feed_sub WHERE user_id = ?', (actor.id,))
    for d in cleaned:
        conn.execute('INSERT INTO feed_sub (user_id, direction, updated_at) VALUES (?, ?, ?)',
                     (actor.id, d, now))
    audit.record(conn, actor.id, 'feed.subscribe', 'feed_sub', actor.id, request_id=request_id,
                 meta={'directions': cleaned})
    return cleaned


def toggle_favorite(conn, actor, event_id, request_id=None):
    ev = load_event(conn, event_id)
    if ev is None:
        raise ApiError('resource_not_found')
    now = clock.now()
    existing = conn.execute(
        "SELECT id FROM feed_signal WHERE event_id = ? AND user_id = ? AND kind = 'favorite'",
        (event_id, actor.id)).fetchone()
    if existing:
        conn.execute('DELETE FROM feed_signal WHERE id = ?', (existing['id'],))
        favorited = False
        audit.record(conn, actor.id, 'feed.unfavorite', 'feed_event', event_id, request_id=request_id)
        outbox.emit(conn, 'feed.unfavorited', 'feed_event', event_id, {'user_id': actor.id},
                    actor_id=actor.id, request_id=request_id)
    else:
        conn.execute(
            'INSERT INTO feed_signal (id, event_id, user_id, kind, at) VALUES (?, ?, ?, ?, ?)',
            (str(uuid.uuid4()), event_id, actor.id, 'favorite', now))
        favorited = True
        audit.record(conn, actor.id, 'feed.favorite', 'feed_event', event_id, request_id=request_id)
        outbox.emit(conn, 'feed.favorited', 'feed_event', event_id, {'user_id': actor.id},
                    actor_id=actor.id, request_id=request_id)
    return {'event_id': event_id, 'favorited': favorited, 'site': _site_counts(conn, event_id)}


def request_room(conn, actor, event_id, request_id=None):
    ev = load_event(conn, event_id)
    if ev is None:
        raise ApiError('resource_not_found')
    now = clock.now()
    conn.execute(
        'INSERT INTO feed_signal (id, event_id, user_id, kind, at) VALUES (?, ?, ?, ?, ?)',
        (str(uuid.uuid4()), event_id, actor.id, 'room', now))
    audit.record(conn, actor.id, 'feed.room', 'feed_event', event_id, request_id=request_id)
    outbox.emit(conn, 'feed.room.requested', 'feed_event', event_id,
                {'user_id': actor.id, 'title': ev['title']}, actor_id=actor.id, request_id=request_id)
    return {
        'event_id': event_id,
        'title': ev['title'],
        'site': _site_counts(conn, event_id),
        'next': {'module': 'rooms', 'action': 'rooms.create.discussion', 'title': ev['title']},
    }


def parse_directions(raw):
    if raw is None or raw == '':
        return None
    if isinstance(raw, (list, tuple)):
        parts = [str(x).strip() for x in raw]
    else:
        parts = [p.strip() for p in str(raw).split(',')]
    allowed = {i for i, _ in sources.DIRECTIONS}
    out = [p for p in parts if p]
    unknown = [p for p in out if p not in allowed]
    if unknown:
        raise ApiError('validation_failed', f'不认识的方向：{", ".join(unknown)}')
    return out or None
