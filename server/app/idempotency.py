import hashlib
import json
import re

from fastapi.responses import JSONResponse

from . import clock
from .errors import ApiError

KEY = re.compile(r'[A-Za-z0-9_-]{8,128}\Z')
RETENTION = 72 * 3600


def run(ctx, body, work, required=False):
    request = ctx.request
    key = request.headers.get('idempotency-key')
    if key is None:
        if required:
            raise ApiError('precondition_required', '缺少 Idempotency-Key')
        with ctx.db.write() as conn:
            status, payload = work(conn)
        return respond(status, payload)
    if not KEY.match(key):
        raise ApiError('malformed_request', 'Idempotency-Key 格式不正确')
    route = f'{request.method} {request.url.path}'
    digest = hashlib.sha256(json.dumps({'body': body, 'if_match': request.headers.get('if-match')},
                                       sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
    cutoff = clock.iso(clock.now_ts() - RETENTION)
    replay = False
    with ctx.db.write() as conn:
        row = conn.execute('SELECT * FROM idempotency_key WHERE principal_id = ? AND route = ? AND key = ?',
                           (ctx.actor.id, route, key)).fetchone()
        if row is not None and row['created_at'] < cutoff:
            conn.execute('DELETE FROM idempotency_key WHERE principal_id = ? AND route = ? AND key = ?',
                         (ctx.actor.id, route, key))
            row = None
        if row is not None:
            if row['request_hash'] != digest:
                raise ApiError('idempotency_conflict')
            status, payload, replay = row['status_code'], json.loads(row['response_json']), True
        else:
            status, payload = work(conn)
            conn.execute('INSERT INTO idempotency_key (principal_id, route, key, request_hash, status_code, '
                         'response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                         (ctx.actor.id, route, key, digest, status, json.dumps(payload, ensure_ascii=False),
                          clock.now()))
    response = respond(status, payload)
    if replay:
        response.headers['Idempotent-Replayed'] = 'true'
    return response


def respond(status, payload):
    response = JSONResponse(payload, status)
    etag = (payload.get('meta') or {}).get('etag')
    if etag:
        response.headers['ETag'] = etag
    return response


def purge(conn):
    return conn.execute('DELETE FROM idempotency_key WHERE created_at < ?',
                        (clock.iso(clock.now_ts() - RETENTION),)).rowcount
