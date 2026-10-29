import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path

KIND = re.compile(r'[a-z][a-z0-9_]{1,31}\Z')
KEY = re.compile(r'([a-z][a-z0-9_]{1,31})/([0-9a-f]{64})\Z')


@dataclass(frozen=True)
class StoredFile:
    key: str
    sha256: str
    size: int


class LocalStorage:
    def __init__(self, root, content_origin=''):
        self.root = Path(root)
        self.content_origin = content_origin.rstrip('/')

    def _path(self, key):
        m = KEY.match(key)
        if not m:
            raise ValueError('invalid storage key')
        return self.root / m.group(1) / m.group(2)[:2] / m.group(2)

    def put(self, data, kind):
        if not KIND.match(kind):
            raise ValueError('invalid storage kind')
        digest = hashlib.sha256(data).hexdigest()
        key = f'{kind}/{digest}'
        path = self._path(key)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix('.part')
            with open(tmp, 'wb') as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        return StoredFile(key, digest, len(data))

    def read(self, key):
        return self._path(key).read_bytes()

    def exists(self, key):
        return self._path(key).exists()

    def delete(self, key):
        path = self._path(key)
        if path.exists():
            path.unlink()
            return True
        return False

    def content_url(self, key):
        self._path(key)
        if not self.content_origin:
            raise RuntimeError('content_origin is not configured')
        return f'{self.content_origin}/c/{key}'
