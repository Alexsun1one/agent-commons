import json
import uuid

from app import flags
from modules.market import service
from tests.helpers import HDRS, AppCase


def key():
    return uuid.uuid4().hex


def hdr(k=None):
    return {**HDRS, 'Idempotency-Key': k or key()}


class MarketCase(AppCase):
    def listing(self, client, category='sell', title='出售一张显卡', status=201, **over):
        body = {
            'category': category,
            'title': title,
            'body': '自用，箱说全，可以先看再定。',
            'price': '¥3,200',
            'city': '杭州',
            'shipping': '可邮寄',
            'condition': '九成新',
        }
        body.update(over)
        r = client.post('/api/market/listings', headers=hdr(), json=body)
        assert r.status_code == status, r.text
        return r.json()['data'] if status == 201 else r.json()

    def detail(self, client, object_id, status=200):
        r = client.get(f'/api/market/listings/{object_id}')
        assert r.status_code == status, r.text
        return r.json()['data'] if status == 200 else r.json()

    def events(self, event_type):
        return self.db.conn().execute('SELECT * FROM outbox_event WHERE event_type = ? ORDER BY occurred_at',
                                      (event_type,)).fetchall()

    def set_expired(self, object_id, when='2020-01-01T00:00:00.000000Z'):
        with self.db.write() as conn:
            conn.execute('UPDATE market_listing SET expires_at = ? WHERE object_id = ?', (when, object_id))


class CreateTest(MarketCase):
    def test_listing_created_listed_and_detailed(self):
        user = self.user('seller')
        data = self.listing(user, title='出售 RTX 4090')
        self.assertEqual((data['category'], data['status'], data['status_label']), ('sell', 'active', '在售'))
        self.assertEqual((data['price'], data['city'], data['condition']), ('¥3,200', '杭州', '九成新'))
        self.assertEqual(data['expires_at'] > data['created_at'], True)
        self.assertEqual(data['author']['level'], 1)
        self.assertEqual(self.events('market.listing.created')[0]['aggregate_id'], data['id'])

        r = user.get('/api/market/listings')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['meta']['count'], 1)
        self.assertEqual(r.json()['data'][0]['id'], data['id'])

        detail = self.detail(user, data['id'])
        self.assertEqual(detail['body'], '自用，箱说全，可以先看再定。')

    def test_forbidden_categories_are_blocked(self):
        user = self.user('seller')
        cases = [
            ('出售一个游戏账号', '账号买卖'),
            ('API key 转售，量大从优', 'API key 转售'),
            ('破解版软件和注册机', '破解软件'),
            ('代充服务，支持各种平台', '灰产代充'),
            ('银行卡出租，日结', '灰产代充'),
        ]
        for title, label in cases:
            r = user.post('/api/market/listings', headers=hdr(), json={
                'category': 'sell', 'title': title, 'body': '私聊', 'price': '面议',
                'city': '线上', 'shipping': '可邮寄', 'condition': '全新'})
            self.assertEqual(r.status_code, 422, r.text)
            self.assertEqual(r.json()['error']['code'], 'market_forbidden')
            self.assertIn(label, r.json()['error']['message'])
        self.assertEqual(user.get('/api/market/listings').json()['meta']['count'], 0)

        # 只是讨论账号安全，不是交易，不该误杀。
        ok = self.listing(user, title='账号安全自查清单', body='整理了一份账号安全检查表，免费分享。', price='免费')
        self.assertEqual(ok['status'], 'active')

    def test_daily_limit_l1_and_l2(self):
        one = self.user('one')
        self.listing(one, title='第一条')
        r = one.post('/api/market/listings', headers=hdr(), json={
            'category': 'sell', 'title': '第二条', 'body': '正文', 'price': '面议',
            'city': '杭州', 'shipping': '可邮寄', 'condition': '九成新'})
        self.assertEqual(r.status_code, 429, r.text)
        self.assertEqual(r.json()['error']['code'], 'market_daily_limit')
        self.assertGreater(r.json()['error']['retry_after_seconds'], 0)

        two = self.user('two', level=2)
        for i in range(3):
            self.listing(two, title=f'L2 第 {i} 条')
        r = two.post('/api/market/listings', headers=hdr(), json={
            'category': 'sell', 'title': 'L2 第四条', 'body': '正文', 'price': '面议',
            'city': '杭州', 'shipping': '可邮寄', 'condition': '九成新'})
        self.assertEqual(r.status_code, 429, r.text)

    def test_category_fields_are_required(self):
        user = self.user('fields', level=2)
        jobs = self.listing(user, category='jobs', title='内推 Agent 工程师',
                            company='某团队', position='Agent 工程师', city='远程', work_mode='远程')
        self.assertEqual((jobs['company'], jobs['position'], jobs['status_label']), ('某团队', 'Agent 工程师', '招聘中'))
        bad = user.post('/api/market/listings', headers=hdr(), json={
            'category': 'jobs', 'title': '招人', 'body': '正文', 'company': '某团队'})
        self.assertEqual(bad.status_code, 422, bad.text)
        self.assertEqual(bad.json()['error']['code'], 'validation_failed')

        free = self.listing(user, category='free', title='送旧键盘', **{'price': '',
                                                                        'condition': '八成新', 'city': '上海',
                                                                        'shipping': '仅同城'})
        self.assertEqual(free['price'], '免费')
        self.assertEqual(free['status_label'], '可领取')

    def test_images_are_limited_and_must_be_owned(self):
        user = self.user('images')
        body = {'category': 'sell', 'title': '带图', 'body': '正文', 'price': '面议',
                'city': '杭州', 'shipping': '可邮寄', 'condition': '九成新'}
        seven = ['00000000-0000-0000-0000-00000000000' + str(i) for i in range(7)]
        r = user.post('/api/market/listings', headers=hdr(), json={**body, 'images': seven})
        self.assertEqual(r.status_code, 422, r.text)
        six = ['00000000-0000-0000-0000-00000000000' + str(i) for i in range(6)]
        r = user.post('/api/market/listings', headers=hdr(), json={**body, 'images': six})
        self.assertEqual(r.status_code, 422, r.text)
        self.assertEqual(r.json()['error']['code'], 'validation_failed')


    def test_generic_object_endpoint_cannot_create_market_listing(self):
        user = self.user('bypass', level=2)
        r = user.post('/api/objects', headers=HDRS, json={
            'type': 'market_listing', 'title': '绕过市集', 'content': {
                'category': 'sell', 'body': '正文', 'price': '面议', 'city': '杭州',
                'shipping': '可邮寄', 'condition': '九成新', 'images': []}})
        self.assertEqual(r.status_code, 403, r.text)
        self.assertEqual(r.json()['error']['code'], 'action_not_allowed')

    def test_flag_off_returns_capability_unavailable(self):
        user = self.user('off')
        with self.db.write() as conn:
            flags.set_flag(conn, 'market.enabled', False, None)
        r = user.get('/api/market/listings')
        self.assertEqual(r.status_code, 501, r.text)
        self.assertEqual(r.json()['error']['code'], 'capability_unavailable')


class ReadTest(MarketCase):
    def test_named_visibility_filters_list_and_detail(self):
        owner, allowed, other = self.user('owner'), self.user('allowed'), self.user('other')
        data = self.listing(owner, title='只给一个人看的键盘', visibility='named', acl=[allowed.pid])
        self.detail(allowed, data['id'])
        self.detail(other, data['id'], status=404)
        self.assertEqual(allowed.get('/api/market/listings').json()['meta']['count'], 1)
        self.assertEqual(other.get('/api/market/listings').json()['meta']['count'], 0)
        anon = self.client()
        self.assertEqual(anon.get('/api/market/listings').status_code, 401)

    def test_filters_search_and_cursor_free_page(self):
        user = self.user('filter', level=2)
        sell = self.listing(user, category='sell', title='100% 机械键盘', city='上海')
        buy = self.listing(user, category='buy', title='求购显示器', budget='1,800', city='广州')
        free = self.listing(user, category='free', title='送书', price='免费', condition='八成新',
                            city='北京', shipping='可邮寄')
        r = user.get('/api/market/listings', params={'category': 'buy'})
        self.assertEqual([x['id'] for x in r.json()['data']], [buy['id']])
        r = user.get('/api/market/listings', params={'q': '100%'})
        self.assertEqual([x['id'] for x in r.json()['data']], [sell['id']])
        self.assertEqual(free['price'], '免费')

        r = user.get('/api/market/listings', params={'limit': 1})
        self.assertEqual(len(r.json()['data']), 1)
        self.assertEqual(r.json()['meta']['count'], 3)
        cursor = r.json()['meta']['next_cursor']
        self.assertTrue(cursor)
        r2 = user.get('/api/market/listings', params={'limit': 1, 'cursor': cursor})
        self.assertEqual(len(r2.json()['data']), 1)
        self.assertNotEqual(r.json()['data'][0]['id'], r2.json()['data'][0]['id'])

    def test_status_owner_only_and_transitions(self):
        owner, other = self.user('owner'), self.user('other')
        data = self.listing(owner)
        r = other.post(f"/api/market/listings/{data['id']}/status", headers=hdr(), json={'status': 'reserved'})
        self.assertEqual(r.status_code, 403, r.text)
        r = owner.post(f"/api/market/listings/{data['id']}/status", headers=hdr(), json={'status': 'reserved'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['status_label'], '已预订')
        r = owner.post(f"/api/market/listings/{data['id']}/status", headers=hdr(), json={'status': 'sold'})
        self.assertEqual(r.json()['data']['status'], 'sold')
        self.assertEqual(owner.get('/api/market/listings').json()['meta']['count'], 0)
        self.assertEqual(owner.get('/api/market/listings', params={'status': 'sold'}).json()['meta']['count'], 1)
        r = owner.post(f"/api/market/listings/{data['id']}/status", headers=hdr(), json={'status': 'active'})
        self.assertEqual(r.json()['data']['status'], 'active')
        self.assertEqual(r.json()['data']['status_label'], '在售')

    def test_expiry_hides_from_browse_but_detail_keeps_history(self):
        owner = self.user('expiry')
        data = self.listing(owner)
        self.set_expired(data['id'])
        with self.db.write() as conn:
            self.assertEqual(service.expire_due(conn), 1)
        detail = self.detail(owner, data['id'])
        self.assertEqual(detail['status'], 'expired')
        self.assertEqual(detail['status_label'], '已过期')
        self.assertEqual(owner.get('/api/market/listings').json()['meta']['count'], 0)
        mine = owner.get('/api/market/listings', params={'mine': 'true'}).json()
        self.assertEqual(mine['meta']['count'], 1)
        self.assertEqual(mine['data'][0]['status'], 'expired')
        self.assertEqual(len(self.events('market.listing.expired')), 1)


    def test_read_triggers_expiry_without_worker(self):
        owner = self.user('lazy')
        data = self.listing(owner)
        self.set_expired(data['id'])
        r = owner.get('/api/market/listings')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['meta']['count'], 0)
        detail = self.detail(owner, data['id'])
        self.assertEqual(detail['status'], 'expired')

    def test_mine_includes_all_statuses(self):
        owner = self.user('mine', level=2)
        first = self.listing(owner, title='一')
        second = self.listing(owner, title='二')
        owner.post(f"/api/market/listings/{first['id']}/status", headers=hdr(), json={'status': 'sold'})
        self.set_expired(second['id'])
        with self.db.write() as conn:
            service.expire_due(conn)
        mine = owner.get('/api/market/listings', params={'mine': 'true'}).json()
        self.assertEqual(mine['meta']['count'], 2)
        self.assertEqual({row['status'] for row in mine['data']}, {'sold', 'expired'})


class InteractionTest(MarketCase):
    def test_want_is_idempotent_and_emits_event(self):
        owner, buyer = self.user('owner'), self.user('buyer')
        data = self.listing(owner)
        r = buyer.post(f"/api/market/listings/{data['id']}/want", headers=HDRS)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()['data']['wanted'], r.json()['data']['count']), (True, 1))
        r = buyer.post(f"/api/market/listings/{data['id']}/want", headers=HDRS)
        self.assertEqual((r.json()['data']['created'], r.json()['data']['count']), (False, 1))
        self.assertEqual(self.detail(buyer, data['id'])['wanted'], True)
        self.assertEqual(self.detail(owner, data['id'])['want_count'], 1)
        event = self.events('market.wanted')[0]
        self.assertEqual(json.loads(event['payload_json'])['recipient_id'], owner.pid)
        r = owner.post(f"/api/market/listings/{data['id']}/want", headers=HDRS)
        self.assertEqual(r.status_code, 409, r.text)

    def test_report_enters_queue_once_and_emits_event(self):
        owner, reporter = self.user('owner'), self.user('reporter')
        data = self.listing(owner)
        r = reporter.post(f"/api/market/listings/{data['id']}/report", headers=hdr(),
                          json={'reason_code': 'scam', 'note': '要求先转账'})
        self.assertEqual(r.status_code, 201, r.text)
        report_id = r.json()['data']['id']
        self.assertEqual(r.json()['data']['created'], True)
        r = reporter.post(f"/api/market/listings/{data['id']}/report", headers=hdr(),
                          json={'reason_code': 'scam', 'note': '再报一次'})
        self.assertEqual((r.status_code, r.json()['data']['created']), (200, False))
        self.assertEqual(self.events('market.reported')[0]['aggregate_id'], data['id'])
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM market_report').fetchone()[0], 1)
        r = owner.post(f"/api/market/listings/{data['id']}/report", headers=hdr(),
                       json={'reason_code': 'other'})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertEqual(reporter.post(f"/api/market/listings/{data['id']}/report", headers=HDRS,
                                       json={'reason_code': 'nope'}).status_code, 422)

        admin = self.user('mod', level=3, roles=('admin',), totp=True)
        r = admin.get('/api/admin/market/reports')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data'][0]['id'], report_id)
        self.assertEqual(r.json()['data'][0]['title'], data['title'])
        r = admin.post(f'/api/admin/market/reports/{report_id}/close', headers=hdr())
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['status'], 'closed')
        self.assertEqual(admin.post(f'/api/admin/market/reports/{report_id}/close', headers=hdr()).status_code, 404)

    def test_report_queue_requires_governance_role(self):
        user = self.user('plain')
        r = user.get('/api/admin/market/reports')
        self.assertEqual(r.status_code, 403, r.text)
        self.assertEqual(r.json()['error']['code'], 'action_not_allowed')


class ExpiryTaskTest(MarketCase):
    def test_due_ids_only_active_or_reserved(self):
        owner = self.user('due', level=3)
        first = self.listing(owner, title='到期一')
        second = self.listing(owner, title='到期二')
        third = self.listing(owner, title='到期三')
        self.set_expired(first['id'])
        self.set_expired(second['id'])
        owner.post(f"/api/market/listings/{third['id']}/status", headers=hdr(), json={'status': 'sold'})
        with self.db.write() as conn:
            ids = service.due_ids(conn)
        self.assertEqual(ids, [first['id'], second['id']])
        with self.db.write() as conn:
            self.assertEqual(service.expire_due(conn), 2)
        self.assertEqual(owner.get('/api/market/listings', params={'status': 'expired'}).json()['meta']['count'], 2)
