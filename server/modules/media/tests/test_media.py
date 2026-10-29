import io
import unittest

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from PIL import Image

from tests.helpers import HDRS, ORIGIN

from modules.media import pipeline, router as media_router, service

from . import images
from .base import BE1Case, doc, image_node, para, text


def open_bytes(data):
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


class PipelineUnitTest(unittest.TestCase):
    def test_sniff_and_extension_rules(self):
        self.assertEqual(pipeline.check_image_type(images.png(), 'a.png'), 'png')
        self.assertEqual(pipeline.check_image_type(images.webp(), 'no-extension'), 'webp')
        cases = [(images.SVG, 'x.svg', 'svg_not_allowed'), (images.SVG, 'x.png', 'svg_not_allowed'),
                 (images.png(), 'x.svg', 'svg_not_allowed'), (images.HTML, 'photo.jpg', 'type_not_allowed'),
                 (images.EXE, 'photo.jpg', 'type_not_allowed'), (images.jpeg_with_gps(), 'photo.png',
                                                                 'extension_mismatch'),
                 (images.png(), 'photo.exe', 'extension_mismatch')]
        for data, name, reason in cases:
            with self.assertRaises(pipeline.Rejected) as caught:
                pipeline.check_image_type(data, name)
            self.assertEqual(caught.exception.reason, reason, name)

    def test_bomb_rejected_from_header(self):
        for side in (10000, 7000):
            with self.assertRaises(pipeline.Rejected) as caught:
                pipeline.open_image(images.bomb_png(side), 'png')
            self.assertEqual(caught.exception.reason, 'too_many_pixels')
        self.assertEqual(Image.MAX_IMAGE_PIXELS, pipeline.MAX_PIXELS)

    def test_widths_never_upscale(self):
        self.assertEqual(pipeline.target_widths(3000), [320, 640, 1280, 2048])
        self.assertEqual(pipeline.target_widths(1000), [320, 640, 1000])
        self.assertEqual(pipeline.target_widths(200), [200])

    def test_alpha_png_keeps_alpha_in_webp_and_flattens_jpeg(self):
        out = pipeline.process_image(images.png(400, 300, alpha=True), 'png')
        webp = open_bytes(next(v.data for v in out.variants if v.ext == 'webp'))
        jpg = open_bytes(next(v.data for v in out.variants if v.ext == 'jpg'))
        self.assertEqual((webp.mode, jpg.mode), ('RGBA', 'RGB'))
        self.assertTrue(out.blur.startswith('data:image/webp;base64,'))
        self.assertRegex(out.color, r'^#[0-9a-f]{6}$')
        self.assertEqual(open_bytes(__import__('base64').b64decode(out.blur.split(',')[1])).width, 16)


class UploadTest(BE1Case):
    def setUp(self):
        super().setUp()
        self.l1 = self.user('newbie', level=1)
        self.l2 = self.user('maker', level=2)
        self.other = self.user('reader', level=2)
        self.outsider = self.user('outsider', level=3)

    def test_l1_cannot_upload_files(self):
        r = self.upload(self.l1, images.png(), 'a.png')
        self.assertEqual((r.status_code, self.code(r)), (403, 'action_not_allowed'))
        quota = self.l1.get('/api/media/quota').json()['data']
        self.assertEqual(quota['file']['daily_count'], 0)

    def test_jpeg_reencoded_oriented_and_stripped(self):
        raw = images.jpeg_with_gps(1200, 800, orientation=6)
        self.assertIn(images.GPS_IFD, open_bytes(raw).getexif())
        asset = self.asset(self.l2, raw, 'IMG_0001.JPG')
        self.assertEqual((asset['width'], asset['height']), (800, 1200))
        self.assertEqual(sorted({v['width'] for v in asset['variants']}), [320, 640, 800])
        exts = {v['name'].split('.')[1] for v in asset['variants']}
        self.assertEqual(exts, {'webp', 'jpg', 'avif'} if pipeline.AVIF else {'webp', 'jpg'})
        self.assertRegex(asset['color'], r'^#[0-9a-f]{6}$')
        self.assertTrue(asset['blur'].startswith('data:image/webp;base64,'))
        self.assertTrue(asset['image']['srcset'].startswith('/api/media/f/'))
        for v in asset['variants']:
            r = self.l2.get(v['url'])
            self.assertEqual(r.status_code, 200, v)
            self.assertEqual(r.headers['content-type'], v['type'])
            img = open_bytes(r.content)
            self.assertEqual(img.size, (v['width'], v['height']))
            self.assertGreater(img.height, img.width)
            exif = img.getexif()
            self.assertNotIn(images.GPS_IFD, exif)
            self.assertNotIn(0x010F, exif)
            self.assertNotIn('exif', img.info)
            self.assertNotIn(b'SyntheticCam', r.content)

    def test_large_image_widths_and_chunked_upload(self):
        raw = images.noisy_png(1400, 900)
        self.assertGreater(len(raw), service.CHUNK * 2)
        asset = self.asset(self.l2, raw, 'noise.png')
        self.assertEqual(sorted({v['width'] for v in asset['variants']}), [320, 640, 1280, 1400])
        big = self.asset(self.l2, images.encode(images.picture(3000, 1500), 'JPEG'), 'wide.jpg')
        self.assertEqual(sorted({v['width'] for v in big['variants']}), [320, 640, 1280, 2048])
        self.assertEqual((big['width'], big['height']), (3000, 1500))

    def test_chunk_rules(self):
        raw = images.noisy_png(900, 900)
        r = self.l2.post('/api/media/uploads', headers=HDRS, json={
            'purpose': 'image', 'filename': 'n.png', 'size': len(raw),
            'sha256': __import__('hashlib').sha256(raw).hexdigest()})
        up = r.json()['data']
        self.assertEqual(up['state'], 'receiving')
        bad = self.l2.put(f'/api/media/uploads/{up["id"]}/chunks/0', headers=HDRS, json={'data': 'AAAA'})
        self.assertEqual(self.code(bad), 'validation_failed')
        piece = raw[:service.CHUNK]
        binary = self.l2.put(f'/api/media/uploads/{up["id"]}/chunks/0',
                             headers={**HDRS, 'Content-Type': 'application/octet-stream'}, content=piece)
        self.assertEqual(binary.status_code, 200, binary.text)
        self.assertEqual(binary.json()['data']['received'], 1)
        self.assertEqual(self.code(self.l2.post(f'/api/media/uploads/{up["id"]}/complete', headers=HDRS)),
                         'state_conflict')
        self.assertEqual(self.other.get(f'/api/media/uploads/{up["id"]}').status_code, 404)

    def test_rejections(self):
        cases = [(images.SVG, 'logo.svg', 'svg_not_allowed'), (images.SVG, 'logo.png', 'svg_not_allowed'),
                 (images.HTML, 'cat.jpg', 'type_not_allowed'), (images.EXE, 'cat.jpg', 'type_not_allowed'),
                 (images.jpeg_with_gps(300, 200), 'cat.png', 'extension_mismatch'),
                 (images.bomb_png(), 'bomb.png', 'too_many_pixels')]
        for data, name, reason in cases:
            r = self.upload(self.l2, data, name)
            self.assertEqual((r.status_code, self.code(r), r.json()['error']['reason']), (422, 'upload_rejected', reason))
        states = {r[0] for r in self.db.conn().execute('SELECT state FROM media_upload')}
        self.assertEqual(states, {'rejected'})
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM media_chunk').fetchone()[0], 0)

    def test_checksum_mismatch(self):
        raw = images.png()
        r = self.l2.post('/api/media/uploads', headers=HDRS, json={
            'purpose': 'image', 'filename': 'a.png', 'size': len(raw), 'sha256': '0' * 64,
            'data': __import__('base64').b64encode(raw).decode()})
        self.assertEqual(r.json()['error']['reason'], 'checksum_mismatch')

    def test_quota_429_and_size_413_and_admin_tuning(self):
        admin = self.user('root', roles=['admin'], totp=True)
        self.assertEqual(self.l2.put('/api/media/quotas/file/2', headers=HDRS,
                                     json={'daily_count': 1, 'max_bytes': 10}).status_code, 403)
        r = admin.put('/api/media/quotas/file/2', headers=HDRS, json={'daily_count': 2, 'max_bytes': 300_000})
        self.assertEqual(r.status_code, 200, r.text)
        self.upload(self.l2, images.png(100, 100), 'a.png', status=202)
        self.upload(self.l2, images.png(120, 100), 'b.png', status=202)
        r = self.upload(self.l2, images.png(140, 100), 'c.png')
        self.assertEqual((r.status_code, self.code(r)), (429, 'rate_limited'))
        self.assertGreater(int(r.headers['retry-after']), 0)
        big = images.noisy_png(400, 400)
        r = self.upload(self.other, big, 'big.png')
        self.assertEqual((r.status_code, self.code(r)), (413, 'payload_too_large'))
        quota = self.l2.get('/api/media/quota').json()['data']['file']
        self.assertEqual((quota['daily_count'], quota['used_today']), (2, 2))

    def test_private_image_404_for_others_until_attached_to_visible_object(self):
        asset = self.asset(self.l2, images.jpeg_with_gps(700, 500, orientation=1), 'p.jpg')
        url = asset['image']['src']
        for client in (self.other, self.outsider, self.client()):
            self.assertEqual(client.get(url).status_code, 404)
            self.assertEqual(client.get(f'/api/media/assets/{asset["id"]}').status_code,
                             401 if client.cookies.get(self.settings.cookie_name) is None else 404)
        body = doc(para(text('看图')), image_node(url, alt='示意', width=700, height=500))
        item = self.rich(self.l2, doc=body, title='带图', visibility='named', acl=[self.other.pid])
        self.drain()
        self.assertEqual(self.other.get(url).status_code, 200)
        self.assertEqual(self.outsider.get(url).status_code, 404)
        self.assertEqual(self.client().get(url).status_code, 404)
        detail = self.other.get(f'/api/content/objects/{item["id"]}').json()['data']
        self.assertEqual(detail['images'][url]['id'], asset['id'])
        self.assertEqual(self.outsider.get(f'/api/content/objects/{item["id"]}').status_code, 404)
        r = self.l2.post(f"/api/objects/{item['id']}/withdraw", headers=HDRS, json={})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.other.get(url).status_code, 404)
        self.assertEqual(self.l2.get(url).status_code, 200)

    def test_someone_elses_asset_id_does_not_grant_access(self):
        asset = self.asset(self.l2, images.png(300, 200), 'mine.png')
        thief = self.user('thief', level=2)
        self.rich(thief, title='借图', content={'cover': asset['id']},
                  doc=doc(image_node(asset['image']['src'])))
        self.drain()
        self.assertEqual(self.other.get(asset['image']['src']).status_code, 404)

    def test_etag_304_and_cache_headers(self):
        asset = self.asset(self.l2, images.png(300, 200), 'a.png')
        url = asset['image']['src']
        r = self.l2.get(url)
        etag = r.headers['etag']
        self.assertEqual(etag, f'"{url.rsplit("/", 1)[1].split(".")[0]}"')
        self.assertEqual(r.headers['cross-origin-resource-policy'], 'same-origin')
        again = self.l2.get(url, headers={'If-None-Match': etag})
        self.assertEqual((again.status_code, again.content), (304, b''))
        self.assertEqual(self.other.get(url, headers={'If-None-Match': etag}).status_code, 404)
        self.assertEqual(r.headers['cache-control'], service.CACHE_PRIVATE)
        alias = url.removeprefix('/api')
        self.assertEqual(self.l2.get(alias).status_code, 404, 'the /media/f alias was removed (R2); only /api/media/f serves files')

    def test_route_sets_private_long_cache_before_core_guard(self):
        asset = self.asset(self.l2, images.png(300, 200), 'a.png')
        bare = FastAPI()
        bare.state.settings, bare.state.db, bare.state.storage = self.settings, self.db, self.app.state.storage

        @bare.middleware('http')
        async def rid(request: Request, call_next):
            request.state.request_id = 'test'
            return await call_next(request)

        bare.include_router(media_router.router)
        c = TestClient(bare, base_url=ORIGIN)
        c.cookies.update(self.l2.cookies)
        r = c.get(asset['image']['src'])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers['cache-control'], 'private, max-age=86400, immutable')
        self.assertEqual(r.headers['vary'], 'Cookie')

    def test_avatar_crop_sizes_profile_and_member_visibility(self):
        raw = images.jpeg_with_gps(900, 600, orientation=1)
        bad = self.upload(self.l1, raw, 'me.jpg', 'avatar', crop={'x': 800, 'y': 0, 'size': 400})
        self.assertEqual(bad.json()['error']['reason'], 'crop_out_of_bounds')
        asset = self.asset(self.l1, raw, 'me.jpg', 'avatar', crop={'x': 100, 'y': 50, 'size': 500})
        self.assertEqual(sorted(asset['sizes']), ['128', '256', '64'])
        self.assertEqual((asset['width'], asset['height']), (500, 500))
        url = asset['sizes']['64']
        self.assertEqual(open_bytes(self.l1.get(url).content).size, (64, 64))
        self.assertEqual(self.other.get(url).status_code, 404)
        r = self.l1.put('/api/account/avatar', headers=HDRS, json={'asset_id': asset['id']})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.other.get(url).status_code, 200)
        self.assertEqual(self.client().get(url).status_code, 404)
        me = self.l1.get('/api/me').json()['data']
        self.assertEqual(me['avatar_ref'], asset['id'])
        self.assertEqual(self.other.put('/api/account/avatar', headers=HDRS,
                                        json={'asset_id': asset['id']}).status_code, 422)
        self.assertEqual(self.l1.delete('/api/account/avatar', headers=HDRS).status_code, 200)
        self.assertEqual(self.other.get(url).status_code, 404)

    def test_html_work_check_srcdoc_and_self_drawn_thumbnail(self):
        html = self.asset(self.l2, images.HTML, 'demo.html', 'html')
        self.assertEqual(html['mime'], 'text/html')
        self.assertIn(html['check']['status'], ('checked', 'pending'))
        if html['check']['status'] == 'checked':
            self.assertIn('nested-iframe', [f['code'] for f in html['check']['findings']])
            self.assertTrue(html['check']['blocked'])
        source = self.l2.get(f'/api/media/assets/{html["id"]}/html').json()['data']
        self.assertEqual(source['html'], images.HTML.decode())
        self.assertIsNone(source['content_url'])
        self.assertEqual(self.other.get(f'/api/media/assets/{html["id"]}/html').status_code, 404)
        r = self.upload(self.l2, images.jpeg_with_gps(300, 200), 'thumb.jpg', 'thumbnail', for_asset=html['id'])
        self.assertEqual(r.json()['error']['reason'], 'type_not_allowed')
        self.assertEqual(self.code(self.upload(self.other, images.png(), 't.png', 'thumbnail', for_asset=html['id'])),
                         'validation_failed')
        thumb = self.asset(self.l2, images.png(1200, 750), 'thumb.png', 'thumbnail', for_asset=html['id'])
        self.assertTrue(thumb['self_drawn'])
        self.assertEqual(thumb['parent_id'], html['id'])
        work = self.rich(self.l2, type='work', title='HTML 作品', content={'html_asset': html['id']})
        self.drain()
        self.assertEqual(self.other.get(f'/api/media/assets/{html["id"]}/html').status_code, 200)
        self.assertEqual(self.other.get(thumb['image']['src']).status_code, 200)
        detail = self.other.get(f'/api/content/objects/{work["id"]}').json()['data']
        self.assertEqual(detail['assets'][html['id']]['purpose'], 'html')
        too_big = b'<html>' + b'x' * (2 * 1024 * 1024)
        r = self.upload(self.l2, too_big, 'big.html', 'html')
        self.assertEqual((r.status_code, self.code(r)), (413, 'payload_too_large'))

    def test_attachment_follows_edits(self):
        a = self.asset(self.l2, images.png(300, 200), 'a.png')
        b = self.asset(self.l2, images.png(310, 200), 'b.png')
        item = self.rich(self.l2, title='换图', doc=doc(image_node(a['image']['src'])))
        self.drain()
        self.assertEqual(self.other.get(a['image']['src']).status_code, 200)
        etag = self.l2.get(f'/api/objects/{item["id"]}').headers['etag']
        r = self.l2.patch(f'/api/objects/{item["id"]}', headers={**HDRS, 'If-Match': etag},
                          json={'content': {'doc': doc(image_node(b['image']['src']))}})
        self.assertEqual(r.status_code, 200, r.text)
        self.drain()
        self.assertEqual(self.other.get(a['image']['src']).status_code, 404)
        self.assertEqual(self.other.get(b['image']['src']).status_code, 200)


if __name__ == '__main__':
    unittest.main()
