import sqlite3
import threading
import unittest
import uuid
from datetime import datetime, timezone
from unittest import mock

from app import clock
from app.db import Database
from app.errors import ApiError
from modules.economy import hooks, jobs, service
from tests.helpers import HDRS, AppCase


NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc).timestamp()


def key():
    return uuid.uuid4().hex


def headers(value=None):
    return {**HDRS, 'Idempotency-Key': value or key()}


class EconomyCase(AppCase):
    def setUp(self):
        self.now = NOW
        patcher = mock.patch('app.clock.now_ts', side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()

    def age(self, pid, days=10):
        with self.db.write() as conn:
            conn.execute('UPDATE principal SET created_at = ? WHERE id = ?',
                         (clock.iso(self.now - days * service.DAY), pid))

    def credit(self, pid, amount, reason='games.reward', operation_key=None):
        with self.db.write() as conn:
            return service.credit(conn, pid, 'bamboo', amount, reason, operation_key or key())


class LedgerTest(EconomyCase):
    def test_append_only_cached_balance_and_idempotency(self):
        user = self.user('ledger_user')
        self.age(user.pid)
        operation_key = key()
        with self.db.write() as conn:
            self.assertEqual(service.credit(conn, user.pid, 'bamboo', 200, 'games.reward', operation_key), 200)
            self.assertEqual(service.credit(conn, user.pid, 'bamboo', 200, 'games.reward', operation_key), 200)
            self.assertEqual(service.balance(conn, user.pid), 200)
            with self.assertRaises(ApiError) as caught:
                service.credit(conn, user.pid, 'bamboo', 201, 'games.reward', operation_key)
            self.assertEqual(caught.exception.code, 'idempotency_conflict')
        row = self.db.conn().execute('SELECT balance FROM wallet_balance WHERE principal_id = ?',
                                     (user.pid,)).fetchone()
        self.assertEqual(row['balance'], 200)
        for sql in ('UPDATE wallet_entry SET amount = 999', 'DELETE FROM wallet_entry'):
            with self.assertRaises(sqlite3.DatabaseError):
                with self.db.write() as conn:
                    conn.execute(sql)

    def test_daily_caps_reason_cap_and_new_account_half(self):
        fresh = self.user('fresh_user')
        self.assertEqual(self.credit(fresh.pid, 300), 150)
        self.assertEqual(self.credit(fresh.pid, 20), 0)

        old = self.user('older_user')
        self.age(old.pid)
        with self.db.write() as conn:
            conn.execute("INSERT INTO economy_reason_limit (currency, reason, daily_cap, updated_at) "
                         "VALUES ('bamboo', 'farm.harvest', 120, ?)", (clock.now(),))
        self.assertEqual(self.credit(old.pid, 200, 'farm.harvest'), 120)
        self.assertEqual(self.credit(old.pid, 250, 'games.reward'), 180)
        self.assertEqual(service.today(self.db.conn(), old.pid)['remaining'], 0)
        self.now += service.DAY
        self.assertEqual(self.credit(old.pid, 300), 300)

    def test_insufficient_funds_and_two_concurrent_debits_never_go_negative(self):
        user = self.user('concurrent_user')
        self.age(user.pid)
        self.assertEqual(self.credit(user.pid, 100), 100)
        gate = threading.Barrier(2)
        results = []

        def spend(operation_key):
            gate.wait()
            isolated = Database(self.settings.db_path)
            try:
                with isolated.write() as conn:
                    service.debit(conn, user.pid, 'bamboo', 80, 'shop.purchase', operation_key)
                results.append('ok')
            except ApiError as exc:
                results.append(exc.code)
            finally:
                isolated.close()

        threads = [threading.Thread(target=spend, args=(key(),)) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertCountEqual(results, ['ok', 'insufficient_funds'])
        self.assertEqual(service.balance(self.db.conn(), user.pid), 20)

    def test_bidirectional_transfer_emits_governance_anomaly(self):
        first, second = self.user('pair_first'), self.user('pair_second')
        self.age(first.pid)
        self.age(second.pid)
        self.credit(first.pid, 140)
        self.credit(second.pid, 140)
        with self.db.write() as conn:
            self.assertEqual(service.transfer_game(conn, first.pid, second.pid, 'bamboo', 60,
                                                   'farm.steal', key()), 60)
            self.assertEqual(service.transfer_game(conn, second.pid, first.pid, 'bamboo', 60,
                                                   'farm.steal', key()), 60)
        rows = self.db.conn().execute("SELECT event_type, payload_json FROM outbox_event "
                                      "WHERE event_type = 'economy.anomaly'").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertIn('pair_roundtrip', rows[0]['payload_json'])


class ShopAndCheckinTest(EconomyCase):
    def test_shop_buy_replay_equip_and_wallet_routes(self):
        user = self.user('shopper')
        self.age(user.pid)
        self.credit(user.pid, 150)
        listing = user.get('/api/economy/shop')
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(len(listing.json()['data']), 20)

        replay_key = key()
        response = user.post('/api/economy/shop/frame-bamboo-mist/buy', headers=headers(replay_key), json={})
        self.assertEqual(response.status_code, 200, response.text)
        replay = user.post('/api/economy/shop/frame-bamboo-mist/buy', headers=headers(replay_key), json={})
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.headers.get('Idempotent-Replayed'), 'true')
        equipped = user.post('/api/economy/inventory/frame-bamboo-mist/equip', headers=HDRS, json={})
        self.assertEqual(equipped.status_code, 200, equipped.text)
        me = user.get('/api/economy/me').json()['data']
        self.assertEqual(me['balance'], 70)
        self.assertTrue(me['inventory'][0]['equipped'])
        entries = user.get('/api/economy/entries').json()['data']
        self.assertEqual([item['reason'] for item in entries[:2]], ['shop.purchase', 'games.reward'])

    def test_checkin_streak_reset_and_seventh_day_gift(self):
        user = self.user('checkin_user')
        self.age(user.pid)
        first = user.post('/api/economy/checkin', headers=HDRS, json={})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual((first.json()['data']['streak'], first.json()['data']['last_reward']), (1, 10))
        same = user.post('/api/economy/checkin', headers=HDRS, json={}).json()['data']
        self.assertEqual((same['streak'], same['last_reward']), (1, 10))

        for expected_day in range(2, 8):
            self.now += service.DAY
            data = user.post('/api/economy/checkin', headers=HDRS, json={}).json()['data']
            self.assertEqual(data['streak'], expected_day)
        self.assertEqual(data['last_reward'], 80)

        self.now += service.DAY * 2
        reset = user.post('/api/economy/checkin', headers=HDRS, json={}).json()['data']
        self.assertEqual((reset['streak'], reset['last_reward']), (1, 10))

    def test_admin_adjust_requires_admin_totp_and_audits_reason(self):
        target = self.user('adjust_target')
        ordinary = self.user('ordinary')
        denied = ordinary.post('/api/admin/economy/adjust', headers=headers(), json={
            'principal_id': target.pid, 'amount': 25, 'reason_code': 'support_fix',
        })
        self.assertEqual((denied.status_code, denied.json()['error']['code']), (403, 'action_not_allowed'))

        admin = self.user('economy_admin', roles=('admin',), totp=True)
        response = admin.post('/api/admin/economy/adjust', headers=headers(), json={
            'principal_id': target.pid, 'amount': 25, 'reason_code': 'support_fix', 'ref': 'case-17',
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['data']['balance'], 25)
        audit_row = self.db.conn().execute("SELECT reason_code FROM audit_event "
                                           "WHERE action = 'economy.admin_adjust'").fetchone()
        self.assertEqual(audit_row['reason_code'], 'support_fix')

    def test_purger_and_daily_reset_are_idempotent(self):
        user = self.user('purge_user')
        self.credit(user.pid, 10)
        user.post('/api/economy/checkin', headers=HDRS, json={})
        with self.db.write() as conn:
            hooks.purge(conn, user.pid)
            hooks.purge(conn, user.pid)
        for table in ('wallet_balance', 'wallet_daily_earning', 'economy_checkin', 'economy_inventory'):
            count = self.db.conn().execute(f'SELECT count(*) FROM {table} WHERE principal_id = ?',
                                           (user.pid,)).fetchone()[0]
            self.assertEqual(count, 0, table)
        self.assertGreater(self.db.conn().execute('SELECT count(*) FROM wallet_entry WHERE principal_id = ?',
                                                  (user.pid,)).fetchone()[0], 0)
        self.now += service.DAY
        self.assertEqual(jobs.reset_daily(self.db), 0)
        self.assertEqual(jobs.reset_daily(self.db), 0)


if __name__ == '__main__':
    unittest.main()
