"""结果缓存：同一功能、同一模板版本、同一模型、同一（去标识后的）输入，按哈希复用结果，减少重复花费。

键是 SHA-256，不存输入原文；值是模型输出（可能含成员内容的摘要），所以带 object_id，
对象撤回或隐藏时由 router.py 的 outbox 消费者按 object_id 删掉。有效期按功能配置（ai_budget.cache_ttl_s，0 表示不缓存）。
"""
import hashlib
import json

from app import clock


def key(feature, task, version, provider, model, effort, inputs):
    def default(value):
        if isinstance(value, (bytes, bytearray)):
            return 'sha256:' + hashlib.sha256(value).hexdigest()
        raise TypeError(type(value).__name__)

    raw = json.dumps({'f': feature, 't': task, 'v': version, 'p': provider, 'm': model, 'e': effort, 'i': inputs},
                     ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=default)
    return hashlib.sha256(raw.encode()).hexdigest()


def get(conn, cache_key):
    row = conn.execute('SELECT output_json, model, expires_at FROM ai_cache WHERE key = ?', (cache_key,)).fetchone()
    if row is None or row['expires_at'] <= clock.now():
        return None
    return {'data': json.loads(row['output_json']), 'model': row['model']}


def touch(conn, cache_key):
    conn.execute('UPDATE ai_cache SET hits = hits + 1 WHERE key = ?', (cache_key,))


def put(conn, cache_key, feature, task, data, model, ttl_s, object_id=None):
    if ttl_s <= 0:
        return
    now = clock.now_ts()
    conn.execute('INSERT INTO ai_cache (key, feature, task, object_id, output_json, model, created_at, expires_at) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET output_json = excluded.output_json, '
                 'model = excluded.model, object_id = excluded.object_id, created_at = excluded.created_at, '
                 'expires_at = excluded.expires_at, hits = 0',
                 (cache_key, feature, task, object_id, json.dumps(data, ensure_ascii=False, sort_keys=True), model,
                  clock.iso(now), clock.iso(now + ttl_s)))


def purge_object(conn, object_id):
    return conn.execute('DELETE FROM ai_cache WHERE object_id = ?', (object_id,)).rowcount


def purge_expired(conn):
    return conn.execute('DELETE FROM ai_cache WHERE expires_at <= ?', (clock.now(),)).rowcount
