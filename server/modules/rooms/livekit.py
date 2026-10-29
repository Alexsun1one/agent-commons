"""LiveKit 访问令牌（HS256 JWT，标准库 hmac 签）与服务端 API 客户端（RemoveParticipant 等）。

测试注入假的传输层；本模块自己不在导入或事务里发任何网络请求。"""
import hashlib
import hmac
import json
import secrets
import urllib.request
from dataclasses import dataclass

from app import clock
from app.security import b64, unb64

GRANT_ATTR = 'commons.grant'
EPOCH_ATTR = 'commons.epoch'
ROLE_ATTR = 'commons.role'
PUBLISH_SOURCES = {'host': ['microphone'], 'speaker': ['microphone'], 'listener': []}
SCREEN_SOURCES = ['screen_share', 'screen_share_audio']


@dataclass
class RtcConfig:
    ws_url: str
    api_url: str
    api_key: str
    api_secret: bytes
    transport: object = None

    def __post_init__(self):
        if len(self.api_secret) < 32:
            raise ValueError('LiveKit api_secret must be at least 32 bytes')


def sign(claims, secret):
    header = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    payload = b64(json.dumps(claims, separators=(',', ':'), ensure_ascii=False, sort_keys=True).encode())
    signing_input = f'{header}.{payload}'.encode()
    sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
    return f'{header}.{payload}.{b64(sig)}'


def verify(token, secret, leeway=5):
    """返回 claims；签名、算法、nbf/exp 任何一项不对都返回 None。"""
    if not isinstance(token, str) or token.count('.') != 2 or len(token) > 8192:
        return None
    header_part, payload_part, sig_part = token.split('.')
    try:
        header = json.loads(unb64(header_part))
        claims = json.loads(unb64(payload_part))
        sig = unb64(sig_part)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(header, dict) or header.get('alg') != 'HS256' or not isinstance(claims, dict):
        return None
    expected = hmac.new(secret, f'{header_part}.{payload_part}'.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, sig):
        return None
    now = clock.now_ts()
    exp, nbf = claims.get('exp'), claims.get('nbf', 0)
    if not isinstance(exp, (int, float)) or exp + leeway < now:
        return None
    if isinstance(nbf, (int, float)) and nbf - leeway > now:
        return None
    return claims


def permission(role, can_publish, can_screen_share=False, api=False):
    sources = list(PUBLISH_SOURCES[role]) if can_publish else []
    if can_screen_share:
        sources.extend(SCREEN_SOURCES)
    return {
        'canSubscribe': True,
        'canPublish': bool(can_publish),
        'canPublishData': True,
        # 令牌里写小写来源名；Twirp JSON 里是 TrackSource 枚举名
        'canPublishSources': [s.upper() for s in sources] if api else list(sources),
        'canUpdateMetadata': False,
    }


def access_token(cfg, *, identity, name, room, grant_id, epoch, role, can_publish,
                 can_screen_share=False, ttl):
    now = int(clock.now_ts())
    attributes = {GRANT_ATTR: grant_id, EPOCH_ATTR: str(epoch), ROLE_ATTR: role}
    perm = permission(role, can_publish, can_screen_share)
    claims = {
        'iss': cfg.api_key,
        'sub': identity,
        'nbf': now,
        'exp': now + ttl,
        'jti': secrets.token_hex(12),
        'name': name,
        'metadata': json.dumps(attributes, separators=(',', ':')),
        'attributes': attributes,
        'video': {
            'room': room,
            'roomJoin': True,
            'canSubscribe': perm['canSubscribe'],
            'canPublish': perm['canPublish'],
            'canPublishData': perm['canPublishData'],
            'canPublishSources': perm['canPublishSources'],
            'canUpdateOwnMetadata': False,
            'roomAdmin': False,
            'hidden': False,
        },
    }
    return sign(claims, cfg.api_secret), now + ttl


def grant_ref(claims):
    """从令牌里取 (grant_id, epoch)。LiveKit 续发的令牌保留 attributes 和 metadata，两处都看。"""
    attrs = claims.get('attributes') if isinstance(claims.get('attributes'), dict) else {}
    if GRANT_ATTR not in attrs:
        try:
            meta = json.loads(claims.get('metadata') or '{}')
            attrs = meta if isinstance(meta, dict) else {}
        except ValueError:
            attrs = {}
    grant_id = attrs.get(GRANT_ATTR)
    try:
        epoch = int(attrs.get(EPOCH_ATTR))
    except (TypeError, ValueError):
        epoch = None
    return (grant_id if isinstance(grant_id, str) else None), epoch


class UrllibTransport:
    """部署机上用：只连配置里的 LiveKit 服务端 API（默认 127.0.0.1:7880）。"""

    def __init__(self, timeout=3):
        self.timeout = timeout

    def post(self, url, headers, body):
        req = urllib.request.Request(url, data=body, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return resp.status, resp.read()


class RoomService:
    """LiveKit RoomService 的 Twirp JSON 接口。调用一律放在数据库事务之外。"""

    def __init__(self, cfg):
        self.cfg = cfg
        self.transport = cfg.transport or UrllibTransport()

    def _admin_token(self, room):
        now = int(clock.now_ts())
        claims = {'iss': self.cfg.api_key, 'sub': 'commons-api', 'nbf': now, 'exp': now + 60,
                  'video': {'room': room, 'roomAdmin': True}}
        return sign(claims, self.cfg.api_secret)

    def _call(self, method, room, payload):
        url = f"{self.cfg.api_url.rstrip('/')}/twirp/livekit.RoomService/{method}"
        headers = {'Authorization': f'Bearer {self._admin_token(room)}', 'Content-Type': 'application/json'}
        body = json.dumps(payload, separators=(',', ':')).encode()
        try:
            status, _ = self.transport.post(url, headers, body)
        except Exception as exc:  # 网络或对方故障只记结果，撤权靠 gate 兜底
            return f'failed:{type(exc).__name__}'
        if status == 404 and method in ('RemoveParticipant', 'UpdateParticipant', 'DeleteRoom'):
            return 'absent'
        return 'ok' if 200 <= status < 300 else f'failed:{status}'

    def remove_participant(self, room, identity):
        return self._call('RemoveParticipant', room, {'room': room, 'identity': identity})

    def update_participant(self, room, identity, role, can_publish, can_screen_share, grant_id, epoch):
        return self._call('UpdateParticipant', room, {
            'room': room, 'identity': identity,
            'permission': permission(role, can_publish, can_screen_share, api=True),
            'attributes': {GRANT_ATTR: grant_id, EPOCH_ATTR: str(epoch), ROLE_ATTR: role}})

    def delete_room(self, room):
        return self._call('DeleteRoom', room, {'room': room})
