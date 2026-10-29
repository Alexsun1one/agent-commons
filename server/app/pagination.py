import hashlib
import hmac
import json

from . import clock
from .errors import ApiError
from .security import b64, unb64

DEFAULT_LIMIT = 20
MAX_LIMIT = 50
TTL = 900


def page_size(limit):
    if limit is None:
        return DEFAULT_LIMIT
    if not 1 <= limit <= MAX_LIMIT:
        raise ApiError('validation_failed', f'limit 必须在 1 到 {MAX_LIMIT} 之间')
    return limit


def query_hash(*parts):
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:32]


def _sign(settings, body):
    return hmac.new(settings.secret_key, body, hashlib.sha256).digest()[:16]


def encode(settings, actor_id, qhash, keys):
    body = json.dumps({'k': keys, 'q': qhash, 'a': actor_id, 'x': int(clock.now_ts()) + TTL},
                      separators=(',', ':'), ensure_ascii=False).encode()
    return f'{b64(body)}.{b64(_sign(settings, body))}'


def decode(settings, cursor, actor_id, qhash):
    if not cursor:
        return None
    try:
        body_part, sig_part = cursor.split('.')
        body, sig = unb64(body_part), unb64(sig_part)
    except ValueError:
        raise ApiError('malformed_request', '翻页位置无效') from None
    if not hmac.compare_digest(_sign(settings, body), sig):
        raise ApiError('malformed_request', '翻页位置无效')
    data = json.loads(body)
    if data['a'] != actor_id or data['q'] != qhash or data['x'] < clock.now_ts():
        raise ApiError('cursor_stale')
    return data['k']


def page(settings, actor_id, qhash, rows, limit, key):
    more = len(rows) > limit
    rows = rows[:limit]
    cursor = encode(settings, actor_id, qhash, key(rows[-1])) if more and rows else None
    return rows, cursor
