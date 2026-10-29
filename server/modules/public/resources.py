"""Public MCP resources backed only by live public snapshots."""
import base64
from urllib.parse import urlsplit

from app.errors import ApiError

from . import config, documents, store

RESOURCE_KINDS = frozenset({'qa', 'skill', 'prompt', 'trend', 'hot'})
PREFIX = 'commons://public/'


def uri_for(row):
    return f'{PREFIX}{row["kind"]}/{row["slug"]}'


def _cursor(value):
    if not value:
        return 0
    try:
        raw = base64.urlsafe_b64decode(value.encode('ascii') + b'===').decode('ascii')
        offset = int(raw)
    except (ValueError, UnicodeError):
        raise ApiError('validation_failed', '不认识的资源游标')
    if offset < 0:
        raise ApiError('validation_failed', '不认识的资源游标')
    return offset


def _encode_cursor(offset):
    return base64.urlsafe_b64encode(str(offset).encode('ascii')).decode('ascii').rstrip('=')


def list_resources(conn, origin, cursor=None, limit=50):
    offset = _cursor(cursor)
    limit = min(100, max(1, int(limit)))
    rows = [row for row in store.list_live(conn) if row['kind'] in RESOURCE_KINDS]
    page = rows[offset:offset + limit]
    payload = {
        'resources': [{
            'uri': uri_for(row),
            'name': f'{row["kind"]}/{row["slug"]}',
            'title': row['title'],
            'description': row['summary'],
            'mimeType': 'text/markdown',
            '_meta': {
                'canonical_url': config.public_url(origin, f'/p/{row["kind"]}/{row["slug"]}'),
                'published_at': row['published_at'],
                'schema_version': config.SCHEMA_VERSION,
            },
        } for row in page],
    }
    if offset + limit < len(rows):
        payload['nextCursor'] = _encode_cursor(offset + limit)
    return payload


def parse_uri(uri):
    parsed = urlsplit(uri or '')
    parts = [part for part in parsed.path.split('/') if part]
    if parsed.scheme != 'commons' or parsed.netloc != 'public' or len(parts) != 2:
        raise ApiError('resource_not_found')
    kind, slug = parts
    if kind not in RESOURCE_KINDS:
        raise ApiError('resource_not_found')
    return kind, slug


def read_resource(conn, cfg, origin, uri):
    kind, slug = parse_uri(uri)
    row = store.get_live(conn, kind, slug)
    if row is None:
        raise ApiError('resource_not_found')
    return {
        'contents': [{
            'uri': uri_for(row),
            'mimeType': 'text/markdown',
            'text': row['markdown'].rstrip('\n') + '\n',
            '_meta': documents.normalized(row, cfg, origin),
        }],
    }
