import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

ENV_VARS = (
    'COMMONS_DATA_DIR', 'COMMONS_DB_PATH', 'COMMONS_WITHDRAWAL_LOG', 'COMMONS_BACKUP_ROOT',
    'COMMONS_STORAGE_DIR', 'COMMONS_SECRET_FILE', 'COMMONS_SITE_DOMAIN', 'COMMONS_CONTENT_DOMAIN',
    'COMMONS_ORIGIN', 'COMMONS_INSECURE_COOKIE', 'COMMONS_STATIC_DIR', 'COMMONS_API_PORT',
    'COMMONS_LIVEKIT_API_KEY', 'COMMONS_LIVEKIT_API_SECRET_FILE', 'COMMONS_LIVEKIT_WS_URL',
    'COMMONS_LIVEKIT_API_URL',
)


@dataclass
class Settings:
    db_path: str
    secret_key: bytes
    backup_dir: str = ''
    storage_dir: str = ''
    withdrawal_log: str = ''
    allowed_origins: tuple = ()
    public_origin: str = ''
    content_origin: str = ''
    cookie_name: str = '__Host-sid'
    cookie_secure: bool = True
    session_ttl: int = 14 * 86400
    scrypt_n: int = 2 ** 14
    totp_issuer: str = '智能体先锋队'
    rate_limits: dict = field(default_factory=lambda: {
        'auth': (10, 300),
        'write': (120, 60),
        'admin': (30, 60),
    })
    trusted_proxies: tuple = ('127.0.0.1', '::1')
    module_package: str = 'modules'
    static_dir: str = ''
    max_body: int = 2 * 1024 * 1024
    auto_migrate: bool = True
    delete_cooldown_days: int = 7
    livekit_api_key: str = ''
    livekit_api_secret: bytes = b''
    livekit_ws_url: str = ''
    livekit_api_url: str = 'http://127.0.0.1:7880'

    def __post_init__(self):
        if len(self.secret_key) < 32:
            raise ValueError('secret_key must be at least 32 bytes')
        if self.cookie_name.startswith('__Host-') and not self.cookie_secure:
            raise ValueError('__Host- cookies require cookie_secure=True; pick another cookie_name for local http')
        if not self.allowed_origins and self.public_origin:
            self.allowed_origins = (self.public_origin,)
        if self.content_origin and self.public_origin:
            site_host = urlsplit(self.public_origin).hostname or ''
            content_host = urlsplit(self.content_origin).hostname or ''
            if (site_host == content_host or site_host.endswith('.' + content_host)
                    or content_host.endswith('.' + site_host)):
                raise ValueError('content_origin must be a different registrable domain from public_origin, '
                                 'not the same host or a subdomain of it')
        if self.livekit_api_secret and len(self.livekit_api_secret) < 32:
            raise ValueError('livekit_api_secret must be at least 32 bytes')
        if not self.livekit_ws_url and self.public_origin:
            origin = urlsplit(self.public_origin)
            if origin.netloc:
                self.livekit_ws_url = f'wss://{origin.netloc}'

    @classmethod
    def from_env(cls, env):
        data = Path(env.get('COMMONS_DATA_DIR') or 'data')
        site = env.get('COMMONS_SITE_DOMAIN') or ''
        content = env.get('COMMONS_CONTENT_DOMAIN') or ''
        origin = env.get('COMMONS_ORIGIN') or (f'https://{site}' if site else 'http://127.0.0.1:8000')
        secure = env.get('COMMONS_INSECURE_COOKIE') != '1'
        livekit_secret_file = env.get('COMMONS_LIVEKIT_API_SECRET_FILE') or ''
        return cls(
            db_path=env.get('COMMONS_DB_PATH') or str(data / 'commons.db'),
            secret_key=load_secret(Path(env.get('COMMONS_SECRET_FILE') or data / 'server-secret')),
            backup_dir=str(Path(env.get('COMMONS_BACKUP_ROOT') or data / 'backups') / 'pre-migrate'),
            storage_dir=env.get('COMMONS_STORAGE_DIR') or str(data / 'files'),
            withdrawal_log=env.get('COMMONS_WITHDRAWAL_LOG') or str(data / 'withdrawals.jsonl'),
            public_origin=origin,
            allowed_origins=(origin,),
            content_origin=f'https://{content}' if content else '',
            cookie_name='__Host-sid' if secure else 'commons_sid',
            cookie_secure=secure,
            static_dir=env.get('COMMONS_STATIC_DIR') or '',
            livekit_api_key=env.get('COMMONS_LIVEKIT_API_KEY') or '',
            livekit_api_secret=load_required_secret(Path(livekit_secret_file)) if livekit_secret_file else b'',
            livekit_ws_url=env.get('COMMONS_LIVEKIT_WS_URL') or '',
            livekit_api_url=env.get('COMMONS_LIVEKIT_API_URL') or 'http://127.0.0.1:7880',
        )


def load_secret(path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_hex(32))
    return path.read_bytes().strip()


def load_required_secret(path):
    secret = path.read_bytes().strip()
    if len(secret) < 32:
        raise ValueError('secret file must contain at least 32 bytes')
    return secret
