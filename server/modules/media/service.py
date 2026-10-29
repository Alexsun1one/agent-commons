"""上传状态机、资产、权限、挂接。分块走 JSON（核心层只收 JSON、请求体 ≤ 2 MiB），每块 1 MiB 原始字节。"""
import base64
import binascii
import hashlib
import importlib
import json
import math
import re
import uuid
from pathlib import Path

from app import audit, clock, outbox
from app.authz import require, visible_predicate
from app.errors import ApiError
from app.storage import KEY, LocalStorage

from . import pipeline

CHUNK = 1024 * 1024
HTML_MAX = 2 * 1024 * 1024
PURPOSE_BUCKET = {'image': 'file', 'html': 'file', 'thumbnail': 'file', 'avatar': 'avatar'}
BUCKET_ACTION = {'file': 'upload.create', 'avatar': 'upload.avatar'}
RAW_KIND = 'upload_raw'
HTML_KIND = 'html_work'
EXT_KIND = {'webp': 'img_webp', 'jpg': 'img_jpeg', 'avif': 'img_avif'}
SHA = re.compile(r'[0-9a-f]{64}\Z')
MEDIA_PATH = re.compile(r'/api/media/f/([0-9a-f]{64})\.(webp|jpg|avif)')
ASSET_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
MIGRATION = 'media/media_0001.sql'
CACHE_PRIVATE = 'private, max-age=86400, immutable'
FILES_PURGE_BATCH = 200


def installed(conn):
    return conn.execute('SELECT 1 FROM schema_migration WHERE id = ?', (MIGRATION,)).fetchone() is not None


def media_url(sha, ext):
    return f'/api/media/f/{sha}.{ext}'


def remember_storage(conn, storage):
    """outbox 消费者拿不到 app.state.storage（见 shared-requests），API 进程把存储根目录记进库，worker 按它找文件。"""
    root = str(Path(storage.root).resolve())
    conn.execute('INSERT INTO media_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET '
                 'value = excluded.value, updated_at = excluded.updated_at WHERE value != excluded.value',
                 ('storage_root', root, clock.now()))


def storage_for(conn):
    row = conn.execute("SELECT value FROM media_meta WHERE key = 'storage_root'").fetchone()
    return LocalStorage(row[0]) if row else None


def require_storage(request):
    storage = request.app.state.storage
    if storage is None:
        raise ApiError('capability_unavailable', '没有配置文件存储')
    return storage


def quota(conn, bucket, level):
    row = conn.execute('SELECT daily_count, max_bytes FROM media_quota WHERE bucket = ? AND level = ?',
                       (bucket, level)).fetchone()
    return (row['daily_count'], row['max_bytes']) if row else (0, 0)


def used_today(conn, owner_id, bucket, day):
    purposes = [p for p, b in PURPOSE_BUCKET.items() if b == bucket]
    marks = ','.join('?' * len(purposes))
    return conn.execute(f'SELECT count(*) FROM media_upload WHERE owner_id = ? AND day = ? AND purpose IN ({marks})',
                        (owner_id, day, *purposes)).fetchone()[0]


def quota_status(conn, actor):
    day = clock.now()[:10]
    out = {}
    for bucket in ('file', 'avatar'):
        count, max_bytes = quota(conn, bucket, actor.level)
        out[bucket] = {'daily_count': count, 'used_today': used_today(conn, actor.id, bucket, day),
                       'max_bytes': max_bytes}
    out['html_max_bytes'] = HTML_MAX
    out['chunk_bytes'] = CHUNK
    return out


def _seconds_to_midnight():
    now = clock.now_ts()
    return int(86400 - now % 86400) + 1


def _owned_upload(conn, actor, upload_id):
    row = conn.execute('SELECT * FROM media_upload WHERE id = ? AND owner_id = ?', (upload_id, actor.id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def _crop(crop):
    if crop is None:
        return None
    if (not isinstance(crop, dict) or set(crop) != {'x', 'y', 'size'}
            or any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in crop.values()) or crop['size'] < 1):
        raise ApiError('validation_failed', 'crop 要给 {x, y, size}，单位是转正后的原图像素')
    return crop


def create_upload(conn, storage, actor, *, purpose, filename, size, sha256, crop=None, for_asset=None,
                  request_id=None):
    bucket = PURPOSE_BUCKET[purpose]
    require(conn, actor, BUCKET_ACTION[bucket])
    if not SHA.match(sha256):
        raise ApiError('validation_failed', 'sha256 必须是 64 位小写十六进制')
    count, max_bytes = quota(conn, bucket, actor.level)
    if purpose == 'html':
        max_bytes = min(max_bytes, HTML_MAX)
    if count < 1 or max_bytes < 1:
        raise ApiError('action_not_allowed', '你的等级还不能上传这类文件')
    if size > max_bytes:
        raise ApiError('payload_too_large', f'这个文件超过了单个 {max_bytes // (1024 * 1024)} MB 的上限')
    day = clock.now()[:10]
    if used_today(conn, actor.id, bucket, day) >= count:
        retry = _seconds_to_midnight()
        raise ApiError('rate_limited', f'今天的上传次数（{count} 个）已用完，明天再来',
                       headers={'Retry-After': str(retry)}, retry_after_seconds=retry)
    params = {}
    if purpose == 'avatar':
        params['crop'] = _crop(crop)
    elif crop is not None:
        raise ApiError('validation_failed', '只有头像可以带 crop')
    if purpose == 'thumbnail':
        parent = conn.execute("SELECT id FROM media_asset WHERE id = ? AND owner_id = ? AND purpose = 'html' "
                              "AND state = 'ready'", (for_asset or '', actor.id)).fetchone()
        if parent is None:
            raise ApiError('validation_failed', '缩略图要挂在你自己上传的 HTML 作品上（for_asset）')
        params['for_asset'] = parent['id']
    elif for_asset is not None:
        raise ApiError('validation_failed', '只有缩略图可以带 for_asset')
    remember_storage(conn, storage)
    upload_id = str(uuid.uuid4())
    now = clock.now()
    conn.execute('INSERT INTO media_upload (id, owner_id, purpose, filename, size, sha256, chunks, state, params_json, '
                 "day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'receiving', ?, ?, ?, ?)",
                 (upload_id, actor.id, purpose, filename, size, sha256, max(1, math.ceil(size / CHUNK)),
                  json.dumps(params, sort_keys=True), day, now, now))
    audit.record(conn, actor.id, 'upload.create', 'media_upload', upload_id, request_id=request_id,
                 meta={'purpose': purpose, 'bytes': size})
    return upload_id


def decode_chunk(data):
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError('validation_failed', 'data 必须是 base64') from None


def put_chunk(conn, actor, upload_id, idx, raw):
    up = _owned_upload(conn, actor, upload_id)
    if up['state'] != 'receiving':
        raise ApiError('state_conflict', '这个上传已经提交')
    if not 0 <= idx < up['chunks']:
        raise ApiError('validation_failed', f'分块序号要在 0 到 {up["chunks"] - 1} 之间')
    expected = CHUNK if idx < up['chunks'] - 1 else up['size'] - CHUNK * (up['chunks'] - 1)
    if len(raw) != expected:
        raise ApiError('validation_failed', f'第 {idx} 块应为 {expected} 字节')
    conn.execute('INSERT INTO media_chunk (upload_id, idx, data) VALUES (?, ?, ?) '
                 'ON CONFLICT(upload_id, idx) DO UPDATE SET data = excluded.data', (upload_id, idx, raw))
    received = conn.execute('SELECT count(*) FROM media_chunk WHERE upload_id = ?', (upload_id,)).fetchone()[0]
    return {'id': upload_id, 'state': 'receiving', 'received': received, 'chunks': up['chunks']}


def _assemble(conn, up):
    rows = conn.execute('SELECT idx, data FROM media_chunk WHERE upload_id = ? ORDER BY idx', (up['id'],)).fetchall()
    if [r['idx'] for r in rows] != list(range(up['chunks'])):
        raise ApiError('state_conflict', f'还差分块：收到 {len(rows)} / {up["chunks"]}')
    return b''.join(r['data'] for r in rows)


def precheck(up, data):
    """同步就能判的：大小、哈希、文件头类型、伪装扩展名、SVG、像素炸弹（只读文件头）。"""
    if len(data) != up['size'] or hashlib.sha256(data).hexdigest() != up['sha256']:
        raise pipeline.Rejected('checksum_mismatch')
    if up['purpose'] == 'html':
        pipeline.check_html(data, up['filename'])
        return 'html'
    allowed = ('png',) if up['purpose'] == 'thumbnail' else ('jpeg', 'png', 'gif', 'webp', 'avif')
    kind = pipeline.check_image_type(data, up['filename'], allowed)
    img = pipeline.open_image(data, kind)
    if up['purpose'] == 'avatar':
        pipeline.crop_box(pipeline.oriented_size(img), json.loads(up['params_json']).get('crop'))
    return kind


def complete(db, storage, actor, upload_id, request_id=None):
    conn = db.conn()
    up = _owned_upload(conn, actor, upload_id)
    if up['state'] != 'receiving':
        raise ApiError('state_conflict', '这个上传已经提交')
    data = _assemble(conn, up)
    reason, kind, raw_key = None, None, None
    try:
        kind = precheck(up, data)
        raw_key = storage.put(data, RAW_KIND).key
    except pipeline.Rejected as rej:
        reason = rej.reason
    with db.write() as conn:
        up = _owned_upload(conn, actor, upload_id)
        if up['state'] != 'receiving':
            raise ApiError('state_conflict', '这个上传已经提交')
        conn.execute('DELETE FROM media_chunk WHERE upload_id = ?', (upload_id,))
        state = 'rejected' if reason else 'processing'
        conn.execute('UPDATE media_upload SET state = ?, reject_code = ?, kind = ?, raw_key = ?, updated_at = ? '
                     'WHERE id = ?', (state, reason, kind, raw_key, clock.now(), upload_id))
        outbox.emit(conn, 'media.upload_rejected' if reason else 'media.upload_completed', 'media_upload', upload_id,
                    {'purpose': up['purpose'], 'reason': reason}, actor_id=actor.id, request_id=request_id)
        audit.record(conn, actor.id, 'upload.complete', 'media_upload', upload_id,
                     outcome='denied' if reason else 'ok', reason=reason, request_id=request_id)
    if reason:
        raise ApiError('upload_rejected', REJECT_MESSAGES.get(reason), reason=reason)
    return upload_status(db.conn(), actor, upload_id)


REJECT_MESSAGES = {
    'checksum_mismatch': '文件内容和声明的大小或 sha256 对不上',
    'svg_not_allowed': '不接受 SVG',
    'type_not_allowed': '只接受 JPEG、PNG、GIF、WebP、AVIF 图片或 UTF-8 的 HTML 文件',
    'extension_mismatch': '文件扩展名和实际内容不一致',
    'too_many_pixels': '图片像素太多（上限 4000 万像素、单边 20000）',
    'corrupt': '图片无法解码',
    'not_utf8': 'HTML 文件必须是 UTF-8 编码',
    'crop_out_of_bounds': '裁剪框超出了图片范围',
    'abandoned': '这次上传放了太久，已作废，请重新选择文件',
}


def html_check(text):
    """GOV-1 移植的 HTML 静态检查：modules.governance.rules.inspect_html(html) -> [{level, code, message, line, index}]。
    GOV-1 不在时记 pending，治理侧另经 outbox（media.asset_ready）补检。"""
    try:
        inspect = importlib.import_module('modules.governance.rules').inspect_html
    except (ImportError, AttributeError):
        return {'status': 'pending', 'checker': None, 'findings': [], 'blocked': False}
    findings = list(inspect(text))
    return {'status': 'checked', 'checker': 'governance.rules.inspect_html', 'findings': findings,
            'blocked': any(f.get('level') == 'block' for f in findings)}


def _store_variants(conn, storage, asset_id, processed):
    for v in processed.variants:
        stored = storage.put(v.data, EXT_KIND[v.ext])
        conn.execute('INSERT INTO media_variant (asset_id, name, ext, width, height, bytes, sha256) '
                     'VALUES (?, ?, ?, ?, ?, ?, ?)', (asset_id, v.name, v.ext, v.width, v.height, stored.size,
                                                      stored.sha256))


def process_upload(conn, storage, upload_id):
    up = conn.execute('SELECT * FROM media_upload WHERE id = ?', (upload_id,)).fetchone()
    if up is None or up['state'] != 'processing':
        return None
    data = storage.read(up['raw_key'])
    params = json.loads(up['params_json'])
    asset_id = str(uuid.uuid4())
    now = clock.now()
    try:
        if up['purpose'] == 'html':
            text = pipeline.check_html(data, up['filename'])
            stored = storage.put(data, HTML_KIND)
            conn.execute("INSERT INTO media_asset (id, owner_id, purpose, mime, bytes, raw_key, file_key, check_json, "
                         "state, created_at) VALUES (?, ?, 'html', 'text/html', ?, ?, ?, ?, 'ready', ?)",
                         (asset_id, up['owner_id'], len(data), up['raw_key'], stored.key,
                          json.dumps(html_check(text), ensure_ascii=False), now))
        else:
            if up['purpose'] == 'avatar':
                processed = pipeline.process_avatar(data, up['kind'], params.get('crop'))
            else:
                processed = pipeline.process_image(data, up['kind'])
            conn.execute('INSERT INTO media_asset (id, owner_id, purpose, mime, width, height, bytes, raw_key, color, '
                         "blur, parent_id, self_drawn, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
                         "'ready', ?)",
                         (asset_id, up['owner_id'], up['purpose'], pipeline.MIME[up['kind']], processed.width,
                          processed.height, len(data), up['raw_key'], processed.color, processed.blur,
                          params.get('for_asset'), int(up['purpose'] == 'thumbnail'), now))
            _store_variants(conn, storage, asset_id, processed)
    except pipeline.Rejected as rej:
        storage.delete(up['raw_key'])
        conn.execute("UPDATE media_upload SET state = 'rejected', reject_code = ?, raw_key = NULL, updated_at = ? "
                     'WHERE id = ?', (rej.reason, now, upload_id))
        outbox.emit(conn, 'media.upload_rejected', 'media_upload', upload_id,
                    {'purpose': up['purpose'], 'reason': rej.reason}, actor_id=up['owner_id'])
        return None
    conn.execute("UPDATE media_upload SET state = 'ready', asset_id = ?, updated_at = ? WHERE id = ?",
                 (asset_id, now, upload_id))
    outbox.emit(conn, 'media.asset_ready', 'media_asset', asset_id, {'purpose': up['purpose'], 'upload_id': upload_id},
                actor_id=up['owner_id'])
    return asset_id


def on_upload_completed(conn, event):
    if not installed(conn):
        return
    storage = storage_for(conn)
    if storage is None:
        raise RuntimeError('storage root not recorded')
    process_upload(conn, storage, event['aggregate_id'])


def upload_status(conn, actor, upload_id):
    up = _owned_upload(conn, actor, upload_id)
    data = {'id': up['id'], 'purpose': up['purpose'], 'state': up['state'], 'size': up['size'],
            'chunks': up['chunks'], 'created_at': up['created_at'], 'updated_at': up['updated_at']}
    if up['state'] == 'receiving':
        data['received'] = conn.execute('SELECT count(*) FROM media_chunk WHERE upload_id = ?',
                                        (upload_id,)).fetchone()[0]
    if up['state'] == 'rejected':
        data['reason'] = up['reject_code']
        data['message'] = REJECT_MESSAGES.get(up['reject_code'], '文件无法接受')
    if up['asset_id']:
        data['asset'] = assets_meta(conn, actor, [up['asset_id']]).get(up['asset_id'])
    return data


# ---------- 读权限 ----------

def access_sql(actor, alias='a'):
    """资产可读：本人；或现任头像（任何在册成员）；或挂在一个本人可见的对象上。全部经 visible_predicate。"""
    pred = visible_predicate(actor, 'mh')
    sql = (f"({alias}.state = 'ready' AND ({alias}.owner_id = :ac_me"
           f" OR ({alias}.purpose = 'avatar' AND :ac_member = 1 AND EXISTS ("
           f'SELECT 1 FROM profile pf WHERE pf.avatar_ref = {alias}.id))'
           f' OR EXISTS (SELECT 1 FROM media_attachment mt JOIN object_head mh ON mh.id = mt.object_id '
           f'WHERE mt.asset_id = {alias}.id AND {pred.sql})))')
    member = actor.authenticated and actor.status in ('active', 'pending_deletion')
    return sql, {**pred.params, 'ac_me': actor.id or '', 'ac_member': int(member)}


def readable_variant(conn, actor, sha, ext):
    if not actor.authenticated:
        return None
    sql, params = access_sql(actor)
    return conn.execute(f'SELECT v.bytes FROM media_variant v JOIN media_asset a ON a.id = v.asset_id '
                        f'WHERE v.sha256 = :sha AND v.ext = :ext AND {sql} LIMIT 1',
                        {**params, 'sha': sha, 'ext': ext}).fetchone()


def readable_asset(conn, actor, asset_id):
    if not actor.authenticated:
        return None
    sql, params = access_sql(actor)
    return conn.execute(f'SELECT a.* FROM media_asset a WHERE a.id = :id AND {sql}', {**params, 'id': asset_id}).fetchone()


def _srcset(variants, ext):
    return ', '.join(f'{media_url(v["sha256"], ext)} {v["width"]}w' for v in variants if v['ext'] == ext)


def asset_dto(row, variants, content_origin=''):
    data = {'id': row['id'], 'purpose': row['purpose'], 'mime': row['mime'], 'bytes': row['bytes'],
            'created_at': row['created_at']}
    if row['purpose'] == 'html':
        key = row['file_key']
        data['check'] = json.loads(row['check_json'])
        data['content_url'] = f'{content_origin}/c/{key}' if content_origin and key else None
        return data
    data.update(width=row['width'], height=row['height'], color=row['color'], blur=row['blur'],
                self_drawn=bool(row['self_drawn']), parent_id=row['parent_id'])
    variants = sorted(variants, key=lambda v: (v['width'], v['ext']))
    data['variants'] = [{'name': v['name'], 'width': v['width'], 'height': v['height'], 'bytes': v['bytes'],
                         'type': pipeline.MIME[v['ext']], 'url': media_url(v['sha256'], v['ext'])} for v in variants]
    webp = [v for v in variants if v['ext'] == 'webp']
    jpg = [v for v in variants if v['ext'] == 'jpg']
    if webp:
        mid = [v for v in webp if v['width'] <= 1280] or webp[:1]
        data['image'] = {'src': media_url(mid[-1]['sha256'], 'webp'), 'srcset': _srcset(variants, 'webp'),
                         'width': row['width'], 'height': row['height'], 'color': row['color'], 'blur': row['blur'],
                         'full': media_url(webp[-1]['sha256'], 'webp')}
        data['sources'] = [{'type': pipeline.MIME[ext], 'srcset': _srcset(variants, ext)}
                           for ext in ('avif', 'webp') if any(v['ext'] == ext for v in variants)]
        data['fallback'] = media_url(jpg[-1]['sha256'], 'jpg') if jpg else None
    if row['purpose'] == 'avatar':
        data['sizes'] = {str(v['width']): media_url(v['sha256'], 'webp') for v in webp}
    return data


def assets_meta(conn, actor, ids, content_origin=''):
    ids = [i for i in dict.fromkeys(ids) if isinstance(i, str) and ASSET_ID.match(i)]
    if not ids or not actor.authenticated:
        return {}
    sql, params = access_sql(actor)
    marks = ','.join(f':id{i}' for i in range(len(ids)))
    params.update({f'id{i}': v for i, v in enumerate(ids)})
    rows = conn.execute(f'SELECT a.* FROM media_asset a WHERE a.id IN ({marks}) AND {sql}', params).fetchall()
    if not rows:
        return {}
    found = [r['id'] for r in rows]
    vmarks = ','.join('?' * len(found))
    variants = {}
    for v in conn.execute(f'SELECT * FROM media_variant WHERE asset_id IN ({vmarks})', found):
        variants.setdefault(v['asset_id'], []).append(v)
    return {r['id']: asset_dto(r, variants.get(r['id'], []), content_origin) for r in rows}


def avatar_urls(conn, refs):
    """现任头像的 64/128/256 地址；头像对全体在册成员可读，调用方负责只给登录成员。"""
    refs = [r for r in dict.fromkeys(refs) if r]
    if not refs:
        return {}
    marks = ','.join('?' * len(refs))
    out = {}
    for v in conn.execute(f"SELECT v.asset_id, v.width, v.sha256 FROM media_variant v JOIN media_asset a ON "
                          f"a.id = v.asset_id WHERE v.asset_id IN ({marks}) AND v.ext = 'webp' AND a.state = 'ready' "
                          f"AND a.purpose = 'avatar'", refs):
        out.setdefault(v['asset_id'], {})[str(v['width'])] = media_url(v['sha256'], 'webp')
    return out


# ---------- 挂接：对象正文里引用了哪些资产 ----------

def _refs(value, out):
    if isinstance(value, str):
        if ASSET_ID.match(value):
            out['ids'].add(value)
        for m in MEDIA_PATH.finditer(value):
            out['shas'].add(m.group(1))
    elif isinstance(value, dict):
        for v in value.values():
            _refs(v, out)
    elif isinstance(value, list):
        for v in value:
            _refs(v, out)


def link_object(conn, object_id):
    """只挂作者本人的资产，别人的资产编号写进正文也不会因此变得可读。"""
    head = conn.execute('SELECT author_id, current_version FROM object_head WHERE id = ?', (object_id,)).fetchone()
    if head is None:
        return 0
    row = conn.execute('SELECT content_json FROM object_version WHERE object_id = ? AND version = ?',
                       (object_id, head['current_version'])).fetchone()
    refs = {'ids': set(), 'shas': set()}
    _refs(json.loads(row['content_json']) if row else {}, refs)
    owned = set()
    if refs['ids']:
        marks = ','.join('?' * len(refs['ids']))
        owned |= {r[0] for r in conn.execute(f"SELECT id FROM media_asset WHERE owner_id = ? AND state = 'ready' "
                                             f'AND id IN ({marks})', (head['author_id'], *refs['ids']))}
        owned |= {r[0] for r in conn.execute(f"SELECT id FROM media_asset WHERE owner_id = ? AND state = 'ready' "
                                             f"AND parent_id IN ({marks})", (head['author_id'], *refs['ids']))}
    if refs['shas']:
        marks = ','.join('?' * len(refs['shas']))
        owned |= {r[0] for r in conn.execute(f"SELECT DISTINCT a.id FROM media_variant v JOIN media_asset a ON "
                                             f"a.id = v.asset_id WHERE a.owner_id = ? AND a.state = 'ready' AND "
                                             f'v.sha256 IN ({marks})', (head['author_id'], *refs['shas']))}
    current = {r[0] for r in conn.execute('SELECT asset_id FROM media_attachment WHERE object_id = ?', (object_id,))}
    now = clock.now()
    conn.executemany('INSERT OR IGNORE INTO media_attachment (asset_id, object_id, created_at) VALUES (?, ?, ?)',
                     [(a, object_id, now) for a in owned - current])
    conn.executemany('DELETE FROM media_attachment WHERE asset_id = ? AND object_id = ?',
                     [(a, object_id) for a in current - owned])
    return len(owned)


def on_object_changed(conn, event):
    if not installed(conn):
        return
    if event['event_type'] == 'object.updated' and not event['payload'].get('version_changed'):
        return
    link_object(conn, event['aggregate_id'])


# ---------- 注销清理 ----------

def purge_rows(conn, principal_id):
    """库里的部分：资产标记删除、上传记录去掉原文件引用，返回要删的文件 key。文件本身不在这里删。"""
    rows = conn.execute("SELECT * FROM media_asset WHERE owner_id = ? AND state = 'ready'", (principal_id,)).fetchall()
    ids = [r['id'] for r in rows]
    keys = {r['raw_key'] for r in rows if r['raw_key']} | {r['file_key'] for r in rows if r['file_key']}
    for up in conn.execute('SELECT raw_key FROM media_upload WHERE owner_id = ? AND raw_key IS NOT NULL',
                           (principal_id,)):
        keys.add(up['raw_key'])
    if ids:
        marks = ','.join('?' * len(ids))
        for v in conn.execute(f'SELECT sha256, ext FROM media_variant WHERE asset_id IN ({marks})', ids):
            shared = conn.execute(f"SELECT 1 FROM media_variant v JOIN media_asset a ON a.id = v.asset_id "
                                  f"WHERE v.sha256 = ? AND a.state = 'ready' AND a.id NOT IN ({marks}) LIMIT 1",
                                  (v['sha256'], *ids)).fetchone()
            if not shared:
                keys.add(f'{EXT_KIND[v["ext"]]}/{v["sha256"]}')
        conn.execute(f'DELETE FROM media_attachment WHERE asset_id IN ({marks})', ids)
        conn.execute(f"UPDATE media_asset SET state = 'deleted', deleted_at = ?, raw_key = NULL, file_key = NULL, "
                     f'blur = NULL WHERE id IN ({marks})', (clock.now(), *ids))
    conn.execute('DELETE FROM media_chunk WHERE upload_id IN (SELECT id FROM media_upload WHERE owner_id = ?)',
                 (principal_id,))
    conn.execute("UPDATE media_upload SET raw_key = NULL, state = CASE WHEN state IN ('receiving', 'processing') "
                 "THEN 'rejected' ELSE state END, reject_code = coalesce(reject_code, 'account_deleted'), "
                 'updated_at = ? WHERE owner_id = ?', (clock.now(), principal_id))
    return ids, sorted(keys)


def purge_owner(conn, storage, principal_id):
    """删掉此人的上传、原图、衍生图文件（其他资产仍引用的同哈希文件保留）。"""
    ids, keys = purge_rows(conn, principal_id)
    removed = 0
    for key in keys:
        if storage is not None and storage.delete(key):
            removed += 1
    return {'assets': len(ids), 'files': removed}


def purge_for_account(conn, principal_id):
    """注销清理（accounts.register_purger）：库里的行和注销同一个事务；文件经 outbox 在提交后再删，事务回滚时不会丢文件。"""
    if not installed(conn):
        return {'assets': 0, 'files_queued': 0}
    ids, keys = purge_rows(conn, principal_id)
    for i in range(0, len(keys), FILES_PURGE_BATCH):
        outbox.emit(conn, 'media.files_purge', 'principal', principal_id, {'keys': keys[i:i + FILES_PURGE_BATCH]})
    return {'assets': len(ids), 'files_queued': len(keys)}


def on_files_purge(conn, event):
    if not installed(conn):
        return
    storage = storage_for(conn)
    if storage is None:
        return
    for key in event['payload'].get('keys', []):
        storage.delete(key)


# 其它模块把内容存储键记在这些列里；同一个键（内容寻址，同哈希同键）只要还有一处引用就不能删。
KEY_COLUMNS = (('room_material', 'storage_key'), ('room_recording', 'storage_key'),
               ('room_minutes', 'transcript_key'), ('room_minutes', 'translation_key'),
               ('media_asset', 'raw_key'), ('media_asset', 'file_key'), ('media_upload', 'raw_key'),
               ('account_export', 'file_key'))
KIND_EXT = {kind: ext for ext, kind in EXT_KIND.items()}


def key_referenced(conn, key):
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    for table, column in KEY_COLUMNS:
        if table in tables and conn.execute(f'SELECT 1 FROM {table} WHERE {column} = ? LIMIT 1', (key,)).fetchone():
            return True
    kind, _, sha = key.partition('/')
    if kind in KIND_EXT and 'media_variant' in tables:
        return conn.execute("SELECT 1 FROM media_variant v JOIN media_asset a ON a.id = v.asset_id "
                            "WHERE v.sha256 = ? AND v.ext = ? AND a.state = 'ready' LIMIT 1",
                            (sha, KIND_EXT[kind])).fetchone() is not None
    return False


def on_rooms_storage_cleanup(event, app):
    """rooms.storage_cleanup_requested：注销事务提交后才有这个事件。仍被引用的键保留，没有存储配置时抛错让 outbox 重试。"""
    storage = app.storage
    if storage is None:
        raise RuntimeError('storage is not configured')
    removed = 0
    for key in event['payload'].get('keys', []):
        if not isinstance(key, str) or not KEY.match(key):
            continue
        with app.db.write() as conn:
            if not key_referenced(conn, key) and storage.delete(key):
                removed += 1
    return removed


def on_principal_deleted(conn, event):
    """兜底：purge_for_account 已经清过的话这里什么也找不到。"""
    if not installed(conn):
        return
    purge_owner(conn, storage_for(conn), event['aggregate_id'])


def originals(conn, principal_id):
    return conn.execute("SELECT id, purpose, mime, raw_key, created_at FROM media_asset WHERE owner_id = ? "
                        "AND state = 'ready' AND raw_key IS NOT NULL ORDER BY created_at", (principal_id,)).fetchall()


def export_rows(conn, actor):
    rows = conn.execute('SELECT id, purpose, mime, width, height, bytes, color, self_drawn, parent_id, created_at '
                        "FROM media_asset WHERE owner_id = ? AND state = 'ready' ORDER BY created_at",
                        (actor.id,)).fetchall()
    uploads = conn.execute('SELECT id, purpose, filename, size, state, reject_code, asset_id, created_at '
                           'FROM media_upload WHERE owner_id = ? ORDER BY created_at', (actor.id,)).fetchall()
    return {'assets': [dict(r) for r in rows], 'uploads': [dict(u) for u in uploads]}
