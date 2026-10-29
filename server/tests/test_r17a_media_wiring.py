"""R17-A · 前端上传接线依赖的真实路由形状。

前端（media.js / editor.js / market.js / account.js）的离线测试里所有假返回值都照这里断言过的形状写：
分块上传的四步、轮询结果里的 asset.image、/api/me.capabilities、市集 images、头像 sizes、排名开关。
"""
import base64
import hashlib

from app import flags
from tests.helpers import HDRS
from tests.test_lg2_fixtures import ConfirmedAdultFixture

from modules.media import service as media_service
from modules.media.tests import images
from modules.media.tests.base import BE1Case

HEX64 = '0123456789abcdef' * 4
SELL = {'category': 'sell', 'body': '自用，箱说全。', 'price': '¥100', 'city': '杭州', 'shipping': '可邮寄', 'condition': '九成新'}


class WiringCase(ConfirmedAdultFixture, BE1Case):
    def setUp(self):
        super().setUp()
        self.me = self.user('wirer', level=2)

    def chunked(self, client, data, filename='big.png', purpose='image', **extra):
        """和 CommonsMedia.upload 同一个顺序：创建（不带 data）→ 逐块 PUT → complete → 轮询。"""
        r = client.post('/api/media/uploads', headers=HDRS, json={
            'purpose': purpose, 'filename': filename, 'size': len(data),
            'sha256': hashlib.sha256(data).hexdigest(), **extra})
        self.assertEqual(r.status_code, 201, r.text)
        up = r.json()['data']
        self.assertEqual(up['state'], 'receiving')
        self.assertEqual(up['chunks'], -(-len(data) // media_service.CHUNK))
        for i in range(up['chunks']):
            piece = data[i * media_service.CHUNK:(i + 1) * media_service.CHUNK]
            c = client.put(f'/api/media/uploads/{up["id"]}/chunks/{i}', headers=HDRS,
                           json={'data': base64.b64encode(piece).decode()})
            self.assertEqual(c.status_code, 200, c.text)
            self.assertEqual(c.json()['data']['received'], i + 1)
        done = client.post(f'/api/media/uploads/{up["id"]}/complete', headers=HDRS)
        self.assertEqual(done.status_code, 202, done.text)
        self.assertEqual(done.json()['data']['state'], 'processing')
        return up['id']

    def poll_ready(self, client, upload_id):
        self.drain()
        r = client.get(f'/api/media/uploads/{upload_id}')
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()['data']
        self.assertEqual(data['state'], 'ready', r.text)
        return data


class UploadFlowShape(WiringCase):
    def test_multi_chunk_flow_and_poll_result(self):
        raw = images.noisy_png(1100, 800)
        self.assertGreater(len(raw), media_service.CHUNK)
        uid = self.chunked(self.me, raw)
        ready = self.poll_ready(self.me, uid)
        asset = ready['asset']
        self.assertEqual({'src', 'srcset', 'width', 'height', 'color', 'blur', 'full'} - set(asset['image']), set())
        self.assertRegex(asset['image']['src'], r'^/api/media/f/[0-9a-f]{64}\.webp$')
        self.assertGreater(asset['image']['width'], 0)
        self.assertGreater(asset['image']['height'], 0)
        got = self.me.get(asset['image']['src'])
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.headers['content-type'], 'image/webp')

    def test_status_while_receiving_has_received_count(self):
        raw = images.noisy_png(1100, 800)
        r = self.me.post('/api/media/uploads', headers=HDRS, json={
            'purpose': 'image', 'filename': 'a.png', 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        uid = r.json()['data']['id']
        self.me.put(f'/api/media/uploads/{uid}/chunks/0', headers=HDRS,
                    json={'data': base64.b64encode(raw[:media_service.CHUNK]).decode()})
        data = self.me.get(f'/api/media/uploads/{uid}').json()['data']
        self.assertEqual((data['state'], data['received']), ('receiving', 1))

    def test_resend_same_chunk_is_idempotent_and_complete_twice_conflicts(self):
        raw = images.png(300, 200)
        r = self.me.post('/api/media/uploads', headers=HDRS, json={
            'purpose': 'image', 'filename': 'a.png', 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        uid = r.json()['data']['id']
        for _ in range(2):
            c = self.me.put(f'/api/media/uploads/{uid}/chunks/0', headers=HDRS,
                            json={'data': base64.b64encode(raw).decode()})
            self.assertEqual(c.status_code, 200, c.text)
        self.assertEqual(self.me.post(f'/api/media/uploads/{uid}/complete', headers=HDRS).status_code, 202)
        again = self.me.post(f'/api/media/uploads/{uid}/complete', headers=HDRS)
        self.assertEqual((again.status_code, again.json()['error']['code']), (409, 'state_conflict'))

    def test_rejections_carry_reason_for_the_human_message(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"/>'
        r = self.me.post('/api/media/uploads', headers=HDRS, json={
            'purpose': 'image', 'filename': 'a.svg', 'size': len(svg), 'sha256': hashlib.sha256(svg).hexdigest(),
            'data': base64.b64encode(svg).decode()})
        self.assertEqual(r.status_code, 422, r.text)
        err = r.json()['error']
        self.assertEqual((err['code'], err['reason']), ('upload_rejected', 'svg_not_allowed'))

    def test_quota_and_level_errors(self):
        q = self.me.get('/api/media/quota').json()['data']
        self.assertEqual({'daily_count', 'used_today', 'max_bytes'}, set(q['file']))
        self.assertEqual(set(q['avatar']), set(q['file']))
        self.assertEqual(q['chunk_bytes'], media_service.CHUNK)
        l1 = self.user('rookie', level=1)
        raw = images.png(100, 100)
        r = l1.post('/api/media/uploads', headers=HDRS, json={
            'purpose': 'image', 'filename': 'a.png', 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        self.assertEqual((r.status_code, r.json()['error']['code']), (403, 'action_not_allowed'))
        l1q = l1.get('/api/media/quota').json()['data']
        self.assertEqual(l1q['file']['daily_count'], 0)
        self.assertGreater(l1q['avatar']['daily_count'], 0)

    def test_daily_count_exhausted_is_rate_limited_with_retry_after(self):
        with self.db.write() as conn:
            conn.execute("UPDATE media_quota SET daily_count = 1 WHERE bucket = 'file' AND level = 2")
        raw = images.png(100, 100)
        self.asset(self.me, raw, 'one.png')
        r = self.me.post('/api/media/uploads', headers=HDRS, json={
            'purpose': 'image', 'filename': 'two.png', 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        self.assertEqual(r.status_code, 429, r.text)
        err = r.json()['error']
        self.assertEqual(err['code'], 'rate_limited')
        self.assertGreater(err['retry_after_seconds'], 300)

    def test_oversize_declared_size_is_413_with_a_human_limit(self):
        with self.db.write() as conn:
            conn.execute("UPDATE media_quota SET max_bytes = 1048576 WHERE bucket = 'file' AND level = 2")
        r = self.me.post('/api/media/uploads', headers=HDRS, json={
            'purpose': 'image', 'filename': 'big.png', 'size': 3 * 1024 * 1024, 'sha256': HEX64})
        self.assertEqual(r.status_code, 413, r.text)
        self.assertTrue(r.json()['error']['message'].startswith('这个文件'))

    def test_abandoned_upload_has_a_human_reason(self):
        raw = images.png(100, 100)
        r = self.me.post('/api/media/uploads', headers=HDRS, json={
            'purpose': 'image', 'filename': 'a.png', 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        uid = r.json()['data']['id']
        with self.db.write() as conn:
            conn.execute("UPDATE media_upload SET state = 'rejected', reject_code = 'abandoned' WHERE id = ?", (uid,))
        data = self.me.get(f'/api/media/uploads/{uid}').json()['data']
        self.assertEqual((data['state'], data['reason']), ('rejected', 'abandoned'))
        self.assertIn('重新', data['message'])


class CapabilityShape(WiringCase):
    def test_me_capabilities_gate_upload_buttons(self):
        caps = self.me.get('/api/me').json()['data']['capabilities']
        for action in ('upload.create', 'upload.avatar', 'account.avatar.set'):
            self.assertIn(action, caps)
        l1 = self.user('newbie', level=1)
        caps1 = l1.get('/api/me').json()['data']['capabilities']
        self.assertNotIn('upload.create', caps1)
        self.assertIn('upload.avatar', caps1)

    def test_me_has_avatar_ref_not_url(self):
        me = self.me.get('/api/me').json()['data']
        self.assertIn('avatar_ref', me)
        self.assertIsNone(me['avatar_ref'])


class AvatarShape(WiringCase):
    def test_avatar_flow_put_returns_sizes_and_asset_meta_has_sizes(self):
        raw = images.noisy_png(900, 600)
        uid = self.chunked(self.me, raw, 'me.png', purpose='avatar')
        ready = self.poll_ready(self.me, uid)
        asset = ready['asset']
        self.assertEqual(asset['purpose'], 'avatar')
        self.assertRegex(asset['sizes']['128'], r'^/api/media/f/[0-9a-f]{64}\.webp$')
        put = self.me.put('/api/account/avatar', headers=HDRS, json={'asset_id': asset['id']})
        self.assertEqual(put.status_code, 200, put.text)
        data = put.json()['data']
        self.assertEqual(data['avatar_ref'], asset['id'])
        self.assertEqual(data['avatar']['128'], asset['sizes']['128'])
        me = self.me.get('/api/me').json()['data']
        self.assertEqual(me['avatar_ref'], asset['id'])
        meta = self.me.get(f'/api/media/assets/{asset["id"]}').json()['data']
        self.assertEqual(meta['sizes']['128'], asset['sizes']['128'])
        gone = self.me.delete('/api/account/avatar', headers=HDRS)
        self.assertEqual(gone.json()['data'], {'avatar_ref': None, 'avatar': None})

    def test_avatar_must_be_own_and_avatar_purpose(self):
        photo = self.asset(self.me, images.png(200, 200), 'p.png')
        r = self.me.put('/api/account/avatar', headers=HDRS, json={'asset_id': photo['id']})
        self.assertEqual(r.status_code, 422, r.text)


class MarketPhotoShape(WiringCase):
    def test_listing_with_uploaded_photos_returns_image_meta_for_cards(self):
        a = self.asset(self.me, images.png(400, 300), 'a.png')
        b = self.asset(self.me, images.png(500, 300), 'b.png')
        r = self.me.post('/api/market/listings', headers={**HDRS, 'Idempotency-Key': 'r17a-market-01'}, json={
            **SELL, 'title': '带图的闲置', 'images': [a['id'], b['id']]})
        self.assertEqual(r.status_code, 201, r.text)
        listing_id = r.json()['data']['id']
        rows = self.me.get('/api/market/listings').json()['data']
        row = next(x for x in (rows['items'] if isinstance(rows, dict) else rows) if x['id'] == listing_id)
        urls = [i['image']['src'] for i in row['images']]
        self.assertEqual(urls, [a['image']['src'], b['image']['src']])
        full = self.me.get(f'/api/market/listings/{listing_id}').json()['data']
        self.assertEqual([i['id'] for i in full['images']], [a['id'], b['id']])

    def test_listing_rejects_foreign_or_seven_photos(self):
        other = self.user('other', level=2)
        theirs = self.asset(other, images.png(200, 200), 't.png')
        r = self.me.post('/api/market/listings', headers={**HDRS, 'Idempotency-Key': 'r17a-market-02'}, json={
            **SELL, 'title': '偷别人的图', 'images': [theirs['id']]})
        self.assertEqual(r.status_code, 422, r.text)
        self.assertIn('图片', r.json()['error']['message'])


class RankingSwitchShape(WiringCase):
    """账号页「公开排名」开关 = 没退出榜单。默认值要 Sun 拍板，见 RECEIPT-R17-A。"""

    def test_defaults_and_toggle_shapes(self):
        me = self.me.get('/api/growth/me').json()['data']
        self.assertFalse(me['optedOut'])
        rules = self.me.get('/api/growth/rules').json()['data']
        self.assertFalse(rules['publicRanking'])
        off = self.me.post('/api/growth/optout', headers=HDRS, json={'optout': True})
        self.assertEqual(off.json()['data'], {'optedOut': True})
        self.assertTrue(self.me.get('/api/growth/me').json()['data']['optedOut'])
        on = self.me.post('/api/growth/optout', headers=HDRS, json={'optout': False})
        self.assertEqual(on.json()['data'], {'optedOut': False})

    def test_flag_flip_is_visible_to_the_switch_note(self):
        with self.db.write() as conn:
            flags.set_flag(conn, 'growth.public_ranking', True, None)
        self.assertTrue(self.me.get('/api/growth/rules').json()['data']['publicRanking'])
