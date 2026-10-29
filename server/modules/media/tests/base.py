import base64
import hashlib

from app import outbox
from tests.helpers import HDRS, PASSWORD, AppCase

from modules.content import service as content_service
from modules.media import service as media_service


class BE1Case(AppCase):
    def setUp(self):
        super().setUp()
        content_service.clear_cache()

    def register(self, client, handle, code=None, password=PASSWORD):
        # tests/helpers.py is frozen and predates the server-side 18+ confirmation (LG-2 R2); see requests/LG-5.md.
        return client.post('/api/auth/register', headers=HDRS, json={
            'invite_code': code or self.invite(), 'handle': handle, 'password': password, 'display_name': handle,
            'adult_confirmed': True})

    def drain(self):
        total = 0
        for _ in range(20):
            n = outbox.dispatch(self.db, limit=500)
            total += n
            if n == 0:
                break
        dead = self.db.conn().execute("SELECT event_type, last_error FROM outbox_event WHERE state != 'done' "
                                      "AND attempts > 0").fetchall()
        self.assertEqual([tuple(d) for d in dead], [])
        return total

    def upload(self, client, data, filename, purpose='image', status=None, **extra):
        body = {'purpose': purpose, 'filename': filename, 'size': len(data),
                'sha256': hashlib.sha256(data).hexdigest(), **extra}
        if len(data) <= media_service.CHUNK:
            body['data'] = base64.b64encode(data).decode()
            r = client.post('/api/media/uploads', headers=HDRS, json=body)
        else:
            r = client.post('/api/media/uploads', headers=HDRS, json=body)
            if r.status_code != 201:
                return r
            up = r.json()['data']
            for i in range(up['chunks']):
                piece = data[i * media_service.CHUNK:(i + 1) * media_service.CHUNK]
                c = client.put(f'/api/media/uploads/{up["id"]}/chunks/{i}', headers=HDRS,
                               json={'data': base64.b64encode(piece).decode()})
                self.assertEqual(c.status_code, 200, c.text)
            r = client.post(f'/api/media/uploads/{up["id"]}/complete', headers=HDRS)
        if status is not None:
            self.assertEqual(r.status_code, status, r.text)
        return r

    def asset(self, client, data, filename, purpose='image', **extra):
        r = self.upload(client, data, filename, purpose, status=202, **extra)
        up = r.json()['data']
        self.assertEqual(up['state'], 'processing')
        self.drain()
        r = client.get(f'/api/media/uploads/{up["id"]}')
        self.assertEqual(r.json()['data']['state'], 'ready', r.text)
        return r.json()['data']['asset']

    def rich(self, client, doc=None, status=201, content=None, **body):
        payload = {'doc': doc or {'type': 'doc', 'content': [
            {'type': 'paragraph', 'content': [{'type': 'text', 'text': '正文'}]}]}}
        payload.update(content or {})
        body.setdefault('type', 'knowledge')
        return self.obj(client, status=status, content=payload, **body)


def para(*nodes):
    return {'type': 'paragraph', 'content': list(nodes)}


def text(value, *marks):
    node = {'type': 'text', 'text': value}
    if marks:
        node['marks'] = list(marks)
    return node


def doc(*blocks):
    return {'type': 'doc', 'content': list(blocks)}


def image_node(src, **attrs):
    return {'type': 'image', 'attrs': {'src': src, **attrs}}
