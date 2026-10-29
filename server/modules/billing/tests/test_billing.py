import unittest
from unittest import mock

from app import accounts, clock
from app.errors import ApiError
from modules.billing import hooks, payments, service
from tests.helpers import HDRS, AppCase

NOW = 1_794_787_200.0          # 2026-11-16T00:00:00Z，固定时钟，赛季和周期不依赖跑测试的日期
DAY = 86400


class FakeAdapter:
    name = 'fake'

    def __init__(self):
        self.calls = []

    def create_checkout(self, order):
        self.calls.append(order['id'])
        return {'provider_ref': 'fake-' + order['id'][:8], 'checkout_url': None}

    def parse_webhook(self, headers, body):
        return {}

    def refund(self, order, amount_fen):
        return {}


class BillingCase(AppCase):
    def setUp(self):
        self.clock = mock.patch('app.clock.now_ts', return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        payments.unregister('fake')

    def at(self, ts):
        self.clock.stop()
        self.clock = mock.patch('app.clock.now_ts', return_value=ts)
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def sql(self, statement, params=()):
        with self.db.write() as conn:
            conn.execute(statement, params)

    def count(self, statement, params=()):
        return self.db.conn().execute(statement, params).fetchone()[0]

    def join(self, client, status=201, **body):
        body.setdefault('plan', 'pioneer')
        r = client.post('/api/billing/waitlist', headers=HDRS, json=body)
        self.assertEqual(r.status_code, status, r.text)
        return r

    def admin(self):
        return self.user('billing_admin', level=3, roles=('admin',), totp=True)

    def grant(self, admin, handle, status=200, **body):
        body.setdefault('plan', 'pioneer')
        body.setdefault('reason_code', 'pilot')
        r = admin.post('/api/admin/billing/subscriptions', headers=HDRS, json=dict(body, handle=handle))
        self.assertEqual(r.status_code, status, r.text)
        return r.json()

    def benefit(self, payload, key):
        return next(row for row in payload['benefits'] if row['key'] == key)


class PlansTest(BillingCase):
    def test_plans_are_draft_and_readable_without_login(self):
        r = self.client().get('/api/billing/plans')
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()['data']
        self.assertFalse(data['paymentsEnabled'])
        plans = {p['key']: p for p in data['plans']}
        self.assertEqual(list(plans), ['free', 'pioneer', 'team'])
        self.assertTrue(all(p['priceStatus'] == 'draft' for p in plans.values()))
        self.assertEqual(plans['pioneer']['price'], {'month': 39, 'year': 390})
        self.assertEqual((plans['team']['perSeat'], plans['team']['minSeats']), (True, 5))
        self.assertEqual(data['neverForSale'], ['等级', '成员邀请', '曝光与排名', '知识'])

    def test_entitlements_reference_existing_membership_keys_and_never_sell_trust(self):
        conn = self.db.conn()
        known = {r[0] for r in conn.execute('SELECT key FROM membership_benefit')}
        used = {r[0] for r in conn.execute('SELECT benefit_key FROM billing_entitlement')}
        self.assertTrue(used, 'seed entitlements missing')
        self.assertLessEqual(used, known)
        self.assertFalse(used & {'stage_rooms', 'member_invites'})
        pioneer = next(p for p in self.client().get('/api/billing/plans').json()['data']['plans']
                       if p['key'] == 'pioneer')
        upload = next(e for e in pioneer['entitlements'] if e['benefitKey'] == 'upload_megabytes')
        self.assertEqual((upload['name'], upload['amount'], upload['minLevel']), ('上传额度', 10240, 2))

    def test_flag_off_closes_the_module(self):
        self.sql("UPDATE feature_flag SET enabled = 0 WHERE key = 'billing.enabled'")
        self.assertEqual(self.client().get('/api/billing/plans').status_code, 501)


class WaitlistTest(BillingCase):
    def setUp(self):
        super().setUp()
        self.member = self.user('wait_member', level=2)

    def test_join_is_deduplicated_per_plan_and_updates_cycle(self):
        first = self.join(self.member, cycle='month').json()['data']
        self.assertEqual((first['duplicate'], first['charged']), (False, False))
        again = self.join(self.member, status=200, cycle='year').json()['data']
        self.assertTrue(again['duplicate'])
        self.assertEqual(again['entry']['id'], first['entry']['id'])
        self.assertEqual(again['entry']['cycle'], 'year')
        self.assertEqual(again['entry']['quote'], {'currency': 'CNY', 'amount': 390, 'priceStatus': 'draft'})
        self.join(self.member, plan='team', seats=6, source='teams')
        self.assertEqual(self.count('SELECT count(*) FROM billing_waitlist WHERE principal_id = ?',
                                    (self.member.pid,)), 2)
        self.assertEqual(self.count("SELECT count(*) FROM audit_event WHERE action = 'billing.waitlist.join'"), 2)
        self.assertEqual(self.count("SELECT count(*) FROM outbox_event WHERE event_type = 'billing.waitlist_joined'"), 2)

    def test_rate_limited_per_member(self):
        self.sql("UPDATE billing_config SET value = '3' WHERE key = 'waitlist.per_hour'")
        for cycle in ('month', 'year', 'month'):
            r = self.member.post('/api/billing/waitlist', headers=HDRS, json={'plan': 'pioneer', 'cycle': cycle})
            self.assertIn(r.status_code, (200, 201), r.text)
        r = self.member.post('/api/billing/waitlist', headers=HDRS, json={'plan': 'pioneer'})
        self.assertEqual((r.status_code, self.code(r)), (429, 'rate_limited'))
        other = self.user('wait_other', level=2)
        self.join(other)
        self.at(NOW + 3600)
        self.join(self.member, status=200)

    def test_validation_and_leave(self):
        self.assertEqual(self.code(self.join(self.member, status=422, plan='free')), 'validation_failed')
        self.assertEqual(self.code(self.join(self.member, status=404, plan='gold')), 'resource_not_found')
        self.assertEqual(self.code(self.join(self.member, status=422, plan='team', seats=3)), 'validation_failed')
        self.join(self.member, status=422, plan='pioneer', note='手机号')
        entry = self.join(self.member, seats=9).json()['data']['entry']
        self.assertEqual(entry['seats'], 1)
        r = self.member.post('/api/billing/waitlist/leave', headers=HDRS, json={'plan': 'pioneer'})
        self.assertEqual(r.json()['data'], {'left': True})
        r = self.member.post('/api/billing/waitlist/leave', headers=HDRS, json={'plan': 'pioneer'})
        self.assertEqual(r.json()['data'], {'left': False})

    def test_login_required(self):
        anon = self.client()
        self.assertEqual(anon.post('/api/billing/waitlist', headers=HDRS, json={'plan': 'pioneer'}).status_code, 401)
        self.assertEqual(anon.get('/api/billing/me').status_code, 401)


class OrderTest(BillingCase):
    def setUp(self):
        super().setUp()
        self.member = self.user('order_member', level=3)

    def order(self, status, key='order-key-0001', **body):
        body.setdefault('plan', 'pioneer')
        r = self.member.post('/api/billing/orders', headers=dict(HDRS, **{'Idempotency-Key': key}), json=body)
        self.assertEqual(r.status_code, status, r.text)
        return r

    def test_every_order_is_refused_while_payments_switch_is_off(self):
        for i, body in enumerate([{'plan': 'pioneer'}, {'plan': 'pioneer', 'cycle': 'year'},
                                  {'plan': 'team', 'seats': 5}, {'plan': 'free'}]):
            r = self.order(501, key=f'off-key-{i:04d}', **body)
            self.assertEqual(self.code(r), 'billing_payments_disabled')
            self.assertIn('不会扣款', r.json()['error']['message'])
        self.assertEqual(self.count('SELECT count(*) FROM billing_order'), 0)
        self.assertEqual(self.count("SELECT count(*) FROM audit_event WHERE action = 'billing.order.create' "
                                    "AND outcome = 'denied' AND reason_code = 'payments_disabled'"), 4)

    def test_switch_on_without_provider_is_still_an_explicit_error(self):
        self.sql("UPDATE feature_flag SET enabled = 1 WHERE key = 'billing.payments'")
        r = self.order(501)
        self.assertEqual(self.code(r), 'billing_provider_unavailable')
        self.assertEqual(self.count('SELECT count(*) FROM billing_order'), 0)

    def test_paid_order_activates_and_renews_through_the_state_machine(self):
        adapter = FakeAdapter()
        payments.register(adapter)
        self.sql("UPDATE feature_flag SET enabled = 1 WHERE key = 'billing.payments'")
        self.sql("UPDATE billing_config SET value = 'fake' WHERE key = 'payments.provider'")
        self.join(self.member)
        missing = self.member.post('/api/billing/orders', headers=HDRS, json={'plan': 'pioneer'})
        self.assertEqual(missing.status_code, 428)
        order = self.order(201).json()['data']
        self.assertEqual((order['state'], order['amount'], order['provider']), ('pending', 39, 'fake'))
        replay = self.order(201)
        self.assertEqual(replay.headers.get('Idempotent-Replayed'), 'true')
        self.assertEqual(len(adapter.calls), 1)

        with self.db.write() as conn:
            sub = service.mark_paid(conn, order['id'], provider_ref='fake-paid')
        self.assertEqual((sub['state'], sub['source']), ('active', 'payment'))
        self.assertEqual(clock.parse(sub['period_end']) - NOW, 30 * DAY)
        self.assertEqual(self.count('SELECT count(*) FROM billing_waitlist WHERE principal_id = ?',
                                    (self.member.pid,)), 0)
        me = self.member.get('/api/billing/me').json()['data']
        self.assertEqual((me['plan'], me['subscription']['state']), ('pioneer', 'active'))
        self.assertEqual(me['orders'][0]['state'], 'paid')

        second = self.order(201, key='order-key-0002', cycle='year').json()['data']
        with self.db.write() as conn:
            renewed = service.mark_paid(conn, second['id'])
            again = service.mark_paid(conn, second['id'])
        self.assertEqual(renewed['id'], sub['id'])
        self.assertEqual(again['id'], sub['id'])
        self.assertEqual(clock.parse(renewed['period_end']) - NOW, (30 + 365) * DAY)
        events = [r[0] for r in self.db.conn().execute(
            'SELECT to_state FROM billing_subscription_event WHERE subscription_id = ? ORDER BY at, rowid', (sub['id'],))]
        self.assertEqual(events, ['active', 'active'])


class StateMachineTest(BillingCase):
    def test_transition_table(self):
        self.assertTrue(service.can_transition(None, 'waitlist'))
        self.assertTrue(service.can_transition('waitlist', 'trial'))
        self.assertTrue(service.can_transition('trial', 'expired'))
        self.assertTrue(service.can_transition('active', 'active'))
        for terminal in ('expired', 'canceled'):
            for target in service.STATES:
                self.assertFalse(service.can_transition(terminal, target))
        self.assertFalse(service.can_transition('waitlist', 'expired'))
        with self.assertRaises(ApiError):
            service.check_transition('trial', 'active')
        service.check_transition('trial', 'active', paid=True)
        with self.assertRaises(ApiError):
            service.check_transition(None, 'active')

    def test_events_are_append_only(self):
        member = self.user('sm_member', level=2)
        with self.db.write() as conn:
            service.create_subscription(conn, principal_id=member.pid, plan_key='pioneer', cycle='month', seats=1,
                                        state='trial', source='admin', reason='admin.pilot', actor_id=None, days=7)
        with self.assertRaises(Exception):
            self.sql("UPDATE billing_subscription_event SET to_state = 'active'")


class AdminAndEntitlementTest(BillingCase):
    def test_admin_needs_role_and_totp(self):
        member = self.user('plain_member', level=5)
        self.assertEqual(member.get('/api/admin/billing/overview').status_code, 403)
        no_totp = self.user('admin_no_totp', roles=('admin',))
        r = no_totp.get('/api/admin/billing/overview')
        self.assertEqual((r.status_code, self.code(r)), (403, 'totp_setup_required'))
        admin = self.admin()
        r = admin.get('/api/admin/billing/overview')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['subscriptions']['trial'], 0)
        self.assertEqual(r.json()['data']['provider'], 'disabled')

    def test_trial_bonus_only_on_level_unlocked_benefits(self):
        admin = self.admin()
        newcomer = self.user('trial_l1', level=1)
        core = self.user('trial_l3', level=3)
        base = self.benefit(core.get('/api/billing/me').json()['data'], 'discussion_rooms')
        self.assertEqual((base['quota'], base['planBonus'], base['effectiveQuota']), (4, 0, 4))

        self.grant(admin, 'trial_l1', days=14)
        self.grant(admin, 'trial_l3', days=14)
        low = newcomer.get('/api/billing/me').json()['data']
        self.assertEqual((low['plan'], low['subscription']['state']), ('pioneer', 'trial'))
        upload = self.benefit(low, 'upload_megabytes')
        self.assertEqual((upload['available'], upload['planBonus'], upload['bonusWaitingForLevel'],
                          upload['effectiveQuota']), (False, 0, 10240, 0))
        high = core.get('/api/billing/me').json()['data']
        rooms = self.benefit(high, 'discussion_rooms')
        self.assertEqual((rooms['planBonus'], rooms['effectiveQuota'], rooms['remaining']), (4, 8, 8))
        self.assertEqual(self.benefit(high, 'stage_rooms')['planBonus'], 0)
        self.assertEqual(self.benefit(high, 'member_invites')['planBonus'], 0)
        self.assertIn('ad_free', [p['key'] for p in high['perks']])

    def test_admin_cannot_force_active_and_waitlist_seat_moves_to_trial(self):
        admin = self.admin()
        member = self.user('seat_member', level=2)
        sub = self.grant(admin, 'seat_member', state='waitlist')['data']['subscription']
        self.assertEqual((sub['state'], sub['periodEnd']), ('waitlist', None))
        self.assertEqual(member.get('/api/billing/me').json()['data']['plan'], 'free')
        self.assertEqual(self.grant(admin, 'seat_member', status=409)['error']['code'], 'billing_transition_invalid')
        url = f'/api/admin/billing/subscriptions/{sub["id"]}/transition'
        r = admin.post(url, headers=HDRS, json={'to': 'active', 'reason_code': 'support'})
        self.assertEqual((r.status_code, self.code(r)), (409, 'billing_transition_invalid'))
        r = admin.post(url, headers=HDRS, json={'to': 'expired', 'reason_code': 'support'})
        self.assertEqual(r.status_code, 409, r.text)
        r = admin.post(url, headers=HDRS, json={'to': 'trial', 'days': 91, 'reason_code': 'pilot'})
        self.assertEqual(r.status_code, 422, r.text)
        r = admin.post(url, headers=HDRS, json={'to': 'trial', 'days': 30, 'reason_code': 'pilot'})
        self.assertEqual(r.json()['data']['subscription']['state'], 'trial')
        r = admin.post(url, headers=HDRS, json={'to': 'expired', 'reason_code': 'correction'})
        self.assertEqual(r.json()['data']['subscription']['state'], 'expired')
        self.assertEqual(member.get('/api/billing/me').json()['data']['plan'], 'free')
        self.assertEqual(self.count("SELECT count(*) FROM audit_event WHERE action = 'billing.subscription.transition'"), 3)

    def test_cancel_keeps_the_paid_period_then_expiry_ends_it(self):
        admin = self.admin()
        member = self.user('cancel_member', level=3)
        self.grant(admin, 'cancel_member', days=10)
        r = member.post('/api/billing/subscription/cancel', headers=HDRS)
        self.assertEqual(r.json()['data']['subscription']['state'], 'canceled')
        me = member.get('/api/billing/me').json()['data']
        self.assertEqual((me['plan'], me['subscription']['state']), ('pioneer', 'canceled'))
        self.assertEqual(member.post('/api/billing/subscription/cancel', headers=HDRS).status_code, 404)
        self.at(NOW + 11 * DAY)
        self.assertEqual(member.get('/api/billing/me').json()['data']['plan'], 'free')

    def test_periodic_and_lazy_expiry(self):
        admin = self.admin()
        lazy = self.user('expire_lazy', level=2)
        self.user('expire_job', level=2)
        self.grant(admin, 'expire_lazy', days=3)
        self.grant(admin, 'expire_job', days=3)
        self.at(NOW + 4 * DAY)
        self.assertEqual(lazy.get('/api/billing/me').json()['data']['plan'], 'free')
        self.assertEqual(hooks.expire_due(self.db), 1)
        self.assertEqual(hooks.expire_due(self.db), 0)
        states = [r[0] for r in self.db.conn().execute('SELECT state FROM billing_subscription')]
        self.assertEqual(states, ['expired', 'expired'])


class RulesAndCleanupTest(BillingCase):
    def test_only_billing_rules_and_flags(self):
        rows = [r[0] for r in self.db.conn().execute(
            "SELECT action FROM action_rule WHERE action LIKE 'billing.%' ORDER BY action")]
        self.assertEqual(rows, ['billing.admin.manage', 'billing.admin.read', 'billing.me.read',
                                'billing.order.create', 'billing.subscription.cancel', 'billing.waitlist.join'])
        flags = dict(self.db.conn().execute("SELECT key, enabled FROM feature_flag WHERE key LIKE 'billing.%'"))
        self.assertEqual(flags, {'billing.enabled': 1, 'billing.payments': 0})

    def test_purge_and_export(self):
        admin = self.admin()
        member = self.user('purge_member', level=2)
        self.join(member)
        self.grant(admin, 'purge_member', days=5)
        now = clock.now()
        with self.db.write() as conn:
            for state in ('pending', 'paid'):
                conn.execute('INSERT INTO billing_order (id, principal_id, plan_key, cycle, seats, amount_fen, '
                             'provider, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                             (service.new_id(), member.pid, 'pioneer', 'month', 1, 3900, 'fake', state, now, now))
        exported = service.export(self.db.conn(), mock.Mock(id=member.pid))
        self.assertEqual((len(exported['waitlist']), len(exported['subscriptions']), len(exported['orders'])), (1, 1, 2))
        self.assertIn(hooks.purge, accounts.PURGERS)
        with self.db.write() as conn:
            hooks.purge(conn, member.pid)
            hooks.purge(conn, member.pid)
        left = {t: self.count(f'SELECT count(*) FROM {t} WHERE principal_id = ?', (member.pid,))
                for t in ('billing_waitlist', 'billing_subscription')}
        self.assertEqual(left, {'billing_waitlist': 0, 'billing_subscription': 0})
        self.assertEqual(self.count('SELECT count(*) FROM billing_subscription_event'), 0)
        self.assertEqual([r[0] for r in self.db.conn().execute(
            'SELECT state FROM billing_order WHERE principal_id = ?', (member.pid,))], ['paid'])


if __name__ == '__main__':
    unittest.main()
