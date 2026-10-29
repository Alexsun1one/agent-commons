"""公开层的数据库读写。所有「能对外看到」的判断都在这里收口：

    快照 status='live' 且未下线，且原对象还在 active。

原对象撤回或隐藏后，下一次请求立刻看不到（不依赖 worker）；worker 的 outbox 消费者
再把快照的 taken_down_at 补上并记审计。
"""
import json
import uuid

from app import clock

LIVE_WHERE = ("s.status = 'live' AND s.taken_down_at IS NULL AND h.lifecycle = 'active'")


def get_live(conn, kind, slug):
    return conn.execute(
        f'SELECT s.* FROM public_snapshot s JOIN object_head h ON h.id = s.object_id '
        f"WHERE s.kind = ? AND s.slug = ? AND {LIVE_WHERE} "
        'ORDER BY s.published_at DESC LIMIT 1', (kind, slug)).fetchone()


def ever_live(conn, kind, slug):
    return conn.execute(
        "SELECT 1 FROM public_snapshot WHERE kind = ? AND slug = ? AND status = 'live' LIMIT 1",
        (kind, slug)).fetchone() is not None


def get_live_by_id(conn, snapshot_id):
    return conn.execute(
        f'SELECT s.* FROM public_snapshot s JOIN object_head h ON h.id = s.object_id '
        f'WHERE s.id = ? AND {LIVE_WHERE}', (snapshot_id,)).fetchone()


def list_live(conn, limit=None, kind=None):
    sql = (f'SELECT s.* FROM public_snapshot s JOIN object_head h ON h.id = s.object_id WHERE {LIVE_WHERE}')
    params = []
    if kind:
        sql += ' AND s.kind = ?'
        params.append(kind)
    sql += ' ORDER BY s.published_at DESC, s.id'
    if limit:
        sql += ' LIMIT ?'
        params.append(int(limit))
    return conn.execute(sql, params).fetchall()


def search_live(conn, query, limit=10, kind=None):
    needle = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    sql = (f'SELECT s.* FROM public_snapshot s JOIN object_head h ON h.id = s.object_id '
           f"WHERE {LIVE_WHERE} AND (s.title LIKE ? ESCAPE '\\' OR s.search_text LIKE ? ESCAPE '\\')")
    params = [needle, needle]
    if kind:
        sql += ' AND s.kind = ?'
        params.append(kind)
    sql += ' ORDER BY s.published_at DESC, s.id LIMIT ?'
    params.append(int(limit))
    return conn.execute(sql, params).fetchall()


def supersede(conn, object_id, now):
    """同一对象的旧在线快照让位；留在表里，不算撤回。"""
    return conn.execute(
        "UPDATE public_snapshot SET taken_down_at = ?, takedown_reason = 'superseded' "
        "WHERE object_id = ? AND status = 'live' AND taken_down_at IS NULL",
        (now, object_id)).rowcount


def insert_snapshot(conn, *, object_id, object_version, kind, slug, title, summary, markdown, html, search_text,
                    license_code, license_consent, publisher_id, publisher_name, status, screen_result,
                    screen_reasons, jsonld_type, meta, source_hash, published_at, now):
    snapshot_id = str(uuid.uuid4())
    conn.execute(
        'INSERT INTO public_snapshot (id, object_id, object_version, kind, slug, title, summary, markdown, html, '
        'search_text, license, license_consent, publisher_id, publisher_name, status, screen_result, screen_reasons, '
        'jsonld_type, meta_json, source_hash, published_at, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (snapshot_id, object_id, object_version, kind, slug, title, summary, markdown, html, search_text,
         license_code, int(bool(license_consent)), publisher_id, publisher_name, status, screen_result,
         json.dumps(screen_reasons, ensure_ascii=False, sort_keys=True), jsonld_type,
         json.dumps(meta, ensure_ascii=False, sort_keys=True), source_hash, published_at, now))
    return snapshot_id


def snapshot_by_id(conn, snapshot_id):
    return conn.execute('SELECT * FROM public_snapshot WHERE id = ?', (snapshot_id,)).fetchone()


def live_slug_owner(conn, kind, slug):
    row = conn.execute(
        "SELECT object_id FROM public_snapshot WHERE kind = ? AND slug = ? AND status = 'live' "
        'AND taken_down_at IS NULL', (kind, slug)).fetchone()
    return row[0] if row else None


def take_down_object(conn, object_id, reason, now):
    return conn.execute(
        'UPDATE public_snapshot SET taken_down_at = ?, takedown_reason = ? '
        'WHERE object_id = ? AND taken_down_at IS NULL',
        (now, reason, object_id)).rowcount


def take_down_snapshot(conn, snapshot_id, reason, now):
    return conn.execute(
        'UPDATE public_snapshot SET taken_down_at = ?, takedown_reason = ? '
        'WHERE id = ? AND taken_down_at IS NULL',
        (now, reason, snapshot_id)).rowcount


def approve(conn, snapshot_id, now):
    row = snapshot_by_id(conn, snapshot_id)
    if row is None:
        return None
    if row['status'] != 'pending' or row['taken_down_at'] is not None:
        return row
    supersede(conn, row['object_id'], now)
    conn.execute("UPDATE public_snapshot SET status = 'live', published_at = ? WHERE id = ?", (now, snapshot_id))
    return snapshot_by_id(conn, snapshot_id)


# ---- 数据集 ----

def dataset_insert(conn, *, name, version, title, description, license_code, columns, rows, sha256, reviewed,
                   creator_id, now):
    dataset_id = str(uuid.uuid4())
    conn.execute(
        'INSERT INTO public_dataset (id, name, version, title, description, license, columns_json, rows_json, '
        'row_count, sha256, reviewed, reviewed_by, reviewed_at, created_at, created_by) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (dataset_id, name, version, title, description, license_code,
         json.dumps(columns, ensure_ascii=False, sort_keys=True),
         json.dumps(rows, ensure_ascii=False, sort_keys=True), len(rows), sha256, int(bool(reviewed)),
         creator_id if reviewed else None, now if reviewed else None, now, creator_id))
    return dataset_id


def dataset_get(conn, name, version=None, reviewed_only=True):
    sql = 'SELECT * FROM public_dataset WHERE name = ?'
    params = [name]
    if version:
        sql += ' AND version = ?'
        params.append(version)
    if reviewed_only:
        sql += ' AND reviewed = 1'
    sql += ' ORDER BY created_at DESC, version DESC LIMIT 1'
    return conn.execute(sql, params).fetchone()


def dataset_latest(conn, name):
    return conn.execute(
        'SELECT * FROM public_dataset WHERE name = ? AND reviewed = 1 '
        'ORDER BY created_at DESC, version DESC LIMIT 1', (name,)).fetchone()


def datasets_latest(conn):
    return conn.execute(
        'SELECT d.* FROM public_dataset d JOIN ('
        'SELECT name, max(created_at) AS newest FROM public_dataset WHERE reviewed = 1 GROUP BY name'
        ') x ON x.name = d.name AND x.newest = d.created_at AND d.reviewed = 1 ORDER BY d.name').fetchall()


def datasets_reviewed(conn, name=None):
    sql = 'SELECT * FROM public_dataset WHERE reviewed = 1'
    params = []
    if name:
        sql += ' AND name = ?'
        params.append(name)
    sql += ' ORDER BY name, created_at DESC, version DESC'
    return conn.execute(sql, params).fetchall()


def dataset_versions(conn, limit=50):
    return conn.execute(
        'SELECT id, name, version, title, reviewed, reviewed_at, created_at FROM public_dataset '
        'ORDER BY created_at DESC LIMIT ?', (limit,)).fetchall()


# ---- 爬虫策略 ----

def crawlers(conn):
    return conn.execute('SELECT * FROM crawler_policy ORDER BY crawler_key').fetchall()


def crawler_by_key(conn, key):
    return conn.execute('SELECT * FROM crawler_policy WHERE crawler_key = ?', (key,)).fetchone()


def crawler_insert(conn, *, key, user_agent, vendor, purpose, welcome, source_url, source_note, now, actor_id):
    conn.execute(
        'INSERT INTO crawler_policy (id, crawler_key, user_agent, vendor, purpose, welcome, source_url, '
        'source_note, verified, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
        (str(uuid.uuid4()), key, user_agent, vendor, purpose, int(bool(welcome)), source_url, source_note, now,
         actor_id))


def crawler_set_welcome(conn, key, welcome, now, actor_id):
    return conn.execute(
        'UPDATE crawler_policy SET welcome = ?, updated_at = ?, updated_by = ? WHERE crawler_key = ?',
        (int(bool(welcome)), now, actor_id, key)).rowcount


def match_ua(conn, user_agent):
    """返回这个 UA 自称匹配到的爬虫 key 列表；只看 DB 里的 token，不做外部查询。"""
    ua = (user_agent or '').lower()
    if not ua:
        return []
    return [r['crawler_key'] for r in crawlers(conn) if r['user_agent'].lower() in ua]


def count_crawler(conn, key, day):
    conn.execute(
        'INSERT INTO public_crawler_hit (crawler_key, day, count) VALUES (?, ?, 1) '
        'ON CONFLICT(crawler_key, day) DO UPDATE SET count = count + 1', (key, day))


def crawler_hits(conn, day=None):
    if day:
        return conn.execute('SELECT crawler_key, day, count FROM public_crawler_hit WHERE day = ? '
                            'ORDER BY count DESC, crawler_key', (day,)).fetchall()
    return conn.execute('SELECT crawler_key, day, count FROM public_crawler_hit '
                        'ORDER BY day DESC, count DESC, crawler_key').fetchall()


def now():
    return clock.now()
