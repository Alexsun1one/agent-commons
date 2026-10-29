import base64
import hashlib
import hmac
import secrets
import struct
from urllib.parse import quote, urlsplit

from . import clock
from .errors import ApiError

CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
SAFE_METHODS = {'GET', 'HEAD', 'OPTIONS'}


def binary_media_chunk(request):
    """The one API route allowed to carry a raw request body."""
    parts = request.url.path.split('/')
    return (request.method == 'PUT' and len(parts) == 7 and parts[:4] == ['', 'api', 'media', 'uploads']
            and parts[5] == 'chunks' and bool(parts[4]) and parts[6].isdigit())


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def unb64(text):
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))


def hash_password(password, n=2 ** 14):
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=n, r=8, p=1, maxmem=256 * 1024 * 1024, dklen=32)
    return f'scrypt${n}$8$1${b64(salt)}${b64(dk)}'


def verify_password(password, stored):
    try:
        scheme, n, r, p, salt, expected = stored.split('$')
        if scheme != 'scrypt':
            return False
        dk = hashlib.scrypt(password.encode(), salt=unb64(salt), n=int(n), r=int(r), p=int(p),
                            maxmem=256 * 1024 * 1024, dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk, unb64(expected))


_dummy = {}


def dummy_verify(password, n):
    if n not in _dummy:
        _dummy[n] = hash_password(secrets.token_hex(8), n)
    verify_password(password, _dummy[n])


def new_token():
    return secrets.token_urlsafe(32)


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def new_code(groups=4):
    raw = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(groups * 4))
    return '-'.join(raw[i:i + 4] for i in range(0, len(raw), 4))


def code_hash(code):
    normalized = ''.join(ch for ch in code.upper() if ch.isalnum())
    return hashlib.sha256(normalized.encode()).hexdigest()


def new_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')


def totp_at(secret, step, digits=6):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8), casefold=True)
    mac = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    value = struct.unpack('>I', mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10 ** digits).zfill(digits)


def totp_now(secret, ts=None):
    return totp_at(secret, int((clock.now_ts() if ts is None else ts) // 30))


def totp_match(secret, code, last_step, ts=None, window=1):
    if not isinstance(code, str) or not code.isdigit() or len(code) != 6:
        return None
    current = int((clock.now_ts() if ts is None else ts) // 30)
    for step in range(current - window, current + window + 1):
        if step > last_step and hmac.compare_digest(totp_at(secret, step), code):
            return step
    return None


def otpauth_uri(secret, account, issuer):
    label = quote(f'{issuer}:{account}')
    return f'otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30'


def client_ip(request, settings):
    host = request.client.host if request.client else ''
    if host in settings.trusted_proxies:
        forwarded = request.headers.get('x-forwarded-for', '')
        if forwarded:
            return forwarded.split(',')[-1].strip()
    return host


def hit(db, key, limit, window):
    now = int(clock.now_ts())
    start = now - now % window
    with db.write() as conn:
        row = conn.execute('SELECT window_start, count FROM rate_bucket WHERE key = ?', (key,)).fetchone()
        if row is None or row['window_start'] != start:
            conn.execute('INSERT INTO rate_bucket (key, window_start, count) VALUES (?, ?, 1) '
                         'ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1',
                         (key, start))
            return
        if row['count'] >= limit:
            retry = start + window - now
            raise ApiError('rate_limited', headers={'Retry-After': str(retry)}, retry_after_seconds=retry)
        conn.execute('UPDATE rate_bucket SET count = count + 1 WHERE key = ?', (key,))


def limit(request, bucket, key):
    settings = request.app.state.settings
    count, window = settings.rate_limits[bucket]
    hit(request.app.state.db, f'{bucket}:{key}', count, window)


def check_request(request, settings):
    if request.method in SAFE_METHODS or not request.url.path.startswith('/api/'):
        return
    agent_path = request.url.path == '/api/agents/mcp' or request.url.path.startswith('/api/agents/v1/')
    authorization = request.headers.get('authorization', '')
    scheme, _, token = authorization.partition(' ')
    bearer_only = (agent_path and scheme.lower() == 'bearer' and bool(token.strip())
                   and settings.cookie_name not in request.cookies)
    if not bearer_only:
        origin = request.headers.get('origin')
        if not origin or origin not in settings.allowed_origins:
            raise ApiError('origin_rejected')
        if not request.headers.get('x-commons-csrf'):
            raise ApiError('csrf_failed')
    length = request.headers.get('content-length')
    has_body = (length is not None and length != '0') or 'transfer-encoding' in request.headers
    if has_body:
        ctype = request.headers.get('content-type', '').split(';')[0].strip().lower()
        if ctype != 'application/json' and not (ctype == 'application/octet-stream' and binary_media_chunk(request)):
            raise ApiError('unsupported_media_type')
    if length is not None and length.isdigit() and int(length) > settings.max_body:
        raise ApiError('payload_too_large')


def build_csp(content_origin='', ws_origin=''):
    """主站内容安全策略。deploy/Caddyfile 里同一条必须和这里逐字一致（tests/test_lg5_security.py 比对）。"""
    connect = "'self'" + (f' {ws_origin}' if ws_origin else '')
    frame = content_origin or "'none'"
    return (f"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            f"connect-src {connect}; frame-src {frame}; object-src 'none'; "
            f"frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


def response_headers(settings):
    """每个响应都带的安全头。Caddy 在前面时用 header 指令覆盖同名头，本机直连 127.0.0.1 时由这里兜底。"""
    ws = settings.livekit_ws_url
    same_host = bool(ws) and urlsplit(ws).netloc == urlsplit(settings.public_origin).netloc
    headers = {
        'Content-Security-Policy': build_csp(settings.content_origin, '' if same_host else ws),
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(self), microphone=(self)',
        'X-Content-Type-Options': 'nosniff',
    }
    if settings.cookie_secure:
        headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return headers


def set_session_cookie(response, settings, token):
    response.set_cookie(settings.cookie_name, token, max_age=settings.session_ttl, path='/',
                        secure=settings.cookie_secure, httponly=True, samesite='lax')


def clear_session_cookie(response, settings):
    response.delete_cookie(settings.cookie_name, path='/', secure=settings.cookie_secure,
                           httponly=True, samesite='lax')

