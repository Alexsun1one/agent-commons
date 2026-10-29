import json
import os
import re
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from app import accounts, authz, clock, flags, ledger, outbox
from modules.growth import antiabuse, engine, rules, tokens
from modules.growth import router as growth_router
from tests.helpers import HDRS, AppCase

NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc).timestamp()
DAY = 86400
MIGRATION = Path(__file__).resolve().parent.parent / 'migrations' / 'growth_0001.sql'


class GrowthCase(AppCase):
    def setUp(self):
        self.now = NOW
        patcher = mock.patch('app.clock.now_ts', side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()

    def member(self, handle, level=2, age_days=30, inviter=None, consent=False, roles=(), totp=False):
        with self.db.write() as conn:
            code = accounts.issue_invite(conn, inviter)[1]
        c = self.client()
        r = self.register(c, handle, code)
        self.assertEqual(r.status_code, 201, r.text)
        c.pid = r.json()['data']['id']
        with self.db.write() as conn:
            conn.execute('UPDATE profile SET level = ?, metering_consent = ? WHERE principal_id = ?',
                         (level, int(consent), c.pid))
            conn.execute('UPDATE principal SET created_at = ? WHERE id = ?',
                         (clock.iso(self.now - age_days * DAY), c.pid))
            for role in roles:
                accounts.set_role(conn, None, c.pid, role)
        if totp:
            from app import security
            secret = c.post('/api/auth/totp/setup', headers=HDRS).json()['data']['secret']
            self.assertEqual(c.post('/api/auth/totp/enable', headers=HDRS,
                                    json={'code': security.totp_now(secret)}).status_code, 200)
        return c

    def admin(self, handle='root'):
        return self.member(handle, level=1, roles=['admin'], totp=True)

    def level(self, pid):
        return self.db.conn().execute('SELECT level FROM profile WHERE principal_id = ?', (pid,)).fetchone()[0]

    def useful(self, giver, receiver, obj):
        with self.db.write() as conn:
            return antiabuse.record_useful(conn, giver_id=giver.pid, receiver_id=receiver.pid, object_id=obj)

    def raw_entry(self, pid, event, key, points=None, season='s2026q4', confirmed_by=None, actor=None):
        with self.db.write() as conn:
            return ledger.record(conn, event_type=event, subject_id=pid, points=points if points is not None else
                                 rules.DEFAULTS[f'points.{event}'], rule_version=rules.rule_version(conn),
                                 idempotency_key=key, season=season, actor_id=actor, confirmed_by=confirmed_by)

    def audits(self, action):
        return [dict(r) for r in self.db.conn().execute('SELECT * FROM audit_event WHERE action = ? ORDER BY occurred_at',
                                                       (action,))]

    def outbox_events(self, kind):
        return [json.loads(r[0]) for r in self.db.conn().execute(
            'SELECT payload_json FROM outbox_event WHERE event_type = ?', (kind,))]

    def keep_sessions(self):
        with self.db.write() as conn:
            conn.execute("UPDATE session SET expires_at = '2099-01-01T00:00:00.000000Z'")

    def get(self, client, path):
        r = client.get(path)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['data']


class RulesAndMigrationTest(GrowthCase):
    def test_seeds_match_defaults_and_only_growth_actions_inserted(self):
        conn = self.db.conn()
        seeded = {r['key']: json.loads(r['value_json']) for r in conn.execute('SELECT key, value_json FROM growth_rule')}
        self.assertEqual(seeded, rules.DEFAULTS)
        sql = MIGRATION.read_text(encoding='utf-8')
        block = sql[sql.index('INSERT OR IGNORE INTO action_rule'):]
        block = block[:block.index(';')]
        actions = re.findall(r"^\s+\('([a-z_.]+)'", block, re.M)
        self.assertTrue(actions and all(a.startswith('growth.') for a in actions), actions)
        self.assertEqual({a for a in actions if a.startswith('growth.unlock.')},
                         {f'growth.unlock.{k}' for k in rules.ACTION_KEYS})
        self.assertNotIn('UPDATE action_rule', sql)

    def test_unlock_rules_work_with_require(self):
        l1, l3 = self.member('low', level=1), self.member('mid', level=3)
        caps1 = self.get(l1, '/api/me')['capabilities']
        caps3 = self.get(l3, '/api/me')['capabilities']
        self.assertIn('growth.unlock.read', caps1)
        self.assertNotIn('growth.unlock.room', caps1)
        self.assertIn('growth.unlock.room', caps3)
        self.assertNotIn('growth.unlock.stage', caps3)

    def test_rules_endpoint_shape(self):
        c = self.member('reader')
        data = self.get(c, '/api/growth/rules')
        self.assertEqual(data['ruleVersion'], 'contrib-2026.10')
        self.assertEqual([e['event'] for e in data['events']], list(rules.EVENTS))
        self.assertEqual({u['actionKey'] for u in data['unlocks']}, set(rules.ACTION_KEYS))
        self.assertEqual(data['trustImplemented'], ['self'])
        self.assertEqual(self.client().get('/api/growth/rules').status_code, 401)

    def test_rule_change_is_audited_versioned_and_gated(self):
        admin = self.admin()
        member = self.member('plain')
        body = {'key': 'points.useful', 'value': 6, 'reason_code': 'tuning'}
        self.assertEqual(self.code(member.post('/api/growth/admin/rules', headers=HDRS, json=body)), 'action_not_allowed')
        no_totp = self.member('nototp', roles=['admin'])
        self.assertEqual(self.code(no_totp.post('/api/growth/admin/rules', headers=HDRS, json=body)), 'totp_setup_required')
        r = admin.post('/api/growth/admin/rules', headers=HDRS, json=body)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data'], {'key': 'points.useful', 'old': 5, 'new': 6, 'rule_version': 'contrib-2026.10.1'})
        audit = self.audits('growth.rule_change')
        self.assertEqual(len(audit), 1)
        meta = json.loads(audit[0]['meta_json'])
        self.assertEqual((meta['old'], meta['new'], audit[0]['actor_id']), (5, 6, admin.pid))
        self.assertTrue(self.outbox_events('growth.rule_changed'))
        giver, receiver = self.member('giver1'), self.member('recv1')
        result = self.useful(giver, receiver, 'o1')
        self.assertEqual(result['points'], 6)
        entry = self.db.conn().execute('SELECT rule_version, points FROM ledger_entry').fetchone()
        self.assertEqual((entry['rule_version'], entry['points']), ('contrib-2026.10.1', 6))
        self.assertEqual(self.get(member, '/api/growth/rules')['params']['points.useful'], 6)

    def test_rule_validation(self):
        admin = self.admin()
        for body in ({'key': 'nope', 'value': 1}, {'key': 'points.useful', 'value': -1},
                     {'key': 'useful.weight_max', 'value': 2.0}, {'key': 'points.violation', 'value': 5},
                     {'key': 'useful.weights', 'value': {'2': 1, '3': 1.2, '4': 1.3, '5': 1.9}},
                     {'key': 'points.useful', 'value': 5}):
            r = admin.post('/api/growth/admin/rules', headers=HDRS, json=dict(body, reason_code='tuning'))
            self.assertIn(r.status_code, (409, 422), (body, r.text))
        r = admin.post('/api/growth/admin/rules', headers=HDRS, json={'key': 'points.useful', 'value': 7, 'reason_code': 'x'})
        self.assertEqual(self.code(r), 'validation_failed')
        self.assertEqual(self.audits('growth.rule_change'), [])

    def test_unlock_change_updates_action_rule_and_takes_effect(self):
        admin = self.admin()
        l2 = self.member('lv2', level=2)
        self.assertEqual(l2.post('/api/objects', headers=HDRS, json={'type': 'knowledge', 'title': 't', 'content': {'body': 'x'}}
                                 ).status_code, 201)
        self.assertIn('knowledge', self.get(l2, '/api/growth/me')['unlocked'])
        r = admin.post('/api/growth/admin/unlock', headers=HDRS,
                       json={'action': 'object.create.knowledge', 'min_level': 3, 'reason_code': 'beta_adjustment'})
        self.assertEqual(r.status_code, 200, r.text)
        row = self.db.conn().execute("SELECT min_level FROM action_rule WHERE action = 'object.create.knowledge'").fetchone()
        self.assertEqual(row[0], 3)
        self.assertEqual(self.code(l2.post('/api/objects', headers=HDRS,
                                           json={'type': 'knowledge', 'title': 't', 'content': {'body': 'x'}})),
                         'action_not_allowed')
        me = self.get(l2, '/api/growth/me')
        self.assertNotIn('knowledge', me['unlocked'])
        self.assertIn('knowledge', me['nextUnlocks'])
        self.assertEqual(len(self.audits('growth.unlock_change')), 1)
        role_only = admin.post('/api/growth/admin/unlock', headers=HDRS,
                               json={'action': 'admin.invite', 'min_level': 1, 'reason_code': 'tuning'})
        self.assertEqual(self.code(role_only), 'state_conflict')
        missing = admin.post('/api/growth/admin/unlock', headers=HDRS,
                             json={'action': 'no.such', 'min_level': 1, 'reason_code': 'tuning'})
        self.assertEqual(self.code(missing), 'resource_not_found')

    def test_admin_alias_router_matches_primary(self):
        self.app.include_router(growth_router.admin_router)
        admin = self.admin()
        target = self.member('target', level=1)
        r = admin.post('/api/admin/growth/appoint', headers=HDRS,
                       json={'handle': 'target', 'level': 3, 'reason_code': 'founding_cadre'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.level(target.pid), 3)

    def test_feature_flag_off_returns_501(self):
        c = self.member('flagged')
        with self.db.write() as conn:
            flags.set_flag(conn, 'growth.enabled', False, None)
        self.assertEqual(self.code(c.get('/api/growth/me')), 'capability_unavailable')


class UsefulAntiAbuseTest(GrowthCase):
    def test_assess_shape_and_allow(self):
        giver, receiver = self.member('giver'), self.member('receiver')
        with self.db.write() as conn:
            result = antiabuse.assess_useful(conn, giver_id=giver.pid, receiver_id=receiver.pid, object_id='o1',
                                             now=self.now)
            as_iso = antiabuse.assess_useful(conn, giver_id=giver.pid, receiver_id=receiver.pid, object_id='o1',
                                             now=clock.iso(self.now))
            as_dt = antiabuse.assess_useful(conn, giver_id=giver.pid, receiver_id=receiver.pid, object_id='o1',
                                            now=datetime.fromtimestamp(self.now, timezone.utc))
        self.assertEqual(set(result), {'allow', 'points', 'discount', 'reason'})
        self.assertEqual(result, {'allow': True, 'points': 5, 'discount': 1.0, 'reason': None})
        self.assertEqual(result, as_iso)
        self.assertEqual(result, as_dt)

    def test_only_l2_plus_and_account_age(self):
        receiver = self.member('receiver')
        low = self.member('lowlevel', level=1)
        young = self.member('young', level=2, age_days=3)
        edge = self.member('edge', level=2, age_days=7)
        self.assertEqual(self.useful(low, receiver, 'o1')['reason'], 'giver_level_too_low')
        self.assertEqual(self.useful(young, receiver, 'o1')['reason'], 'giver_account_too_new')
        self.assertTrue(self.useful(edge, receiver, 'o1')['allow'])
        self.assertEqual(ledger.balance(self.db.conn(), receiver.pid), 5)
        with self.db.write() as conn:
            self.assertEqual(antiabuse.assess_useful(conn, giver_id=receiver.pid, receiver_id=receiver.pid,
                                                     object_id='x', now=self.now)['reason'], 'self')

    def test_invite_tree_is_not_scored(self):
        root = self.member('rootmember')
        child = self.member('child', inviter=root.pid)
        grandchild = self.member('grandchild', inviter=child.pid)
        stranger = self.member('stranger')
        down = self.useful(child, root, 'o1')
        up = self.useful(root, grandchild, 'o2')
        self.assertEqual((down['allow'], down['points'], down['reason']), (False, 0, 'invite_tree'))
        self.assertEqual((up['allow'], up['reason']), (False, 'invite_tree'))
        self.assertEqual(self.useful(grandchild, root, 'o3')['reason'], 'invite_tree')
        self.assertTrue(self.useful(stranger, root, 'o4')['allow'])
        self.assertEqual(self.db.conn().execute("SELECT count(*) FROM ledger_entry WHERE event_type = 'useful'").fetchone()[0], 1)

    def test_daily_cap_per_receiver_and_next_day(self):
        receiver = self.member('receiver')
        givers = [self.member(f'giver{i}') for i in range(7)]
        results = [self.useful(g, receiver, f'o{i}') for i, g in enumerate(givers)]
        self.assertEqual([r['allow'] for r in results], [True] * 6 + [False])
        self.assertEqual(results[-1]['reason'], 'daily_cap')
        self.assertEqual(ledger.balance(self.db.conn(), receiver.pid), 30)
        self.now += DAY
        self.assertTrue(self.useful(givers[6], receiver, 'o6')['allow'])

    def test_pair_daily_cap_and_duplicate(self):
        giver, receiver = self.member('giver'), self.member('receiver')
        self.assertTrue(self.useful(giver, receiver, 'o1')['allow'])
        self.assertEqual(self.useful(giver, receiver, 'o1')['reason'], 'already_marked')
        self.assertTrue(self.useful(giver, receiver, 'o2')['allow'])
        self.assertEqual(self.useful(giver, receiver, 'o3')['reason'], 'pair_daily_cap')

    def test_mutual_marking_discount_and_level_weight(self):
        a, b = self.member('alice'), self.member('bob')
        first = self.useful(a, b, 'o1')
        back = self.useful(b, a, 'o2')
        self.assertEqual((first['points'], first['discount']), (5, 1.0))
        self.assertEqual((back['points'], back['discount']), (3, 0.5))
        shown = self.get(a, '/api/growth/me')['ledger'][0]
        self.assertEqual(shown['event'], 'useful')
        self.assertEqual(shown['points'], 3)
        self.assertEqual(shown['discount']['factor'], 0.5)
        self.assertIn('互相标记', shown['discount']['why'])
        self.assertIsNone(self.get(b, '/api/growth/me')['ledger'][0]['discount'])
        weights = {}
        for level in (2, 3, 4, 5):
            giver, receiver = self.member(f'wg{level}', level=level), self.member(f'wr{level}')
            weights[level] = self.useful(giver, receiver, f'w{level}')['points']
        self.assertEqual(weights, {2: 5, 3: 6, 4: 7, 5: 7})
        self.assertTrue(all(p <= 5 * 1.5 for p in weights.values()))

    def test_reversal_keeps_original_and_points_back(self):
        giver, receiver = self.member('giver'), self.member('receiver')
        entry_id = self.useful(giver, receiver, 'o1')['entry_id']
        mod = self.member('mod', roles=['governor'])
        with self.db.write() as conn:
            reversal = ledger.reverse(conn, entry_id, reason='abuse', actor_id=mod.pid, idempotency_key='rev-1')
        conn = self.db.conn()
        self.assertEqual(conn.execute('SELECT count(*) FROM ledger_entry').fetchone()[0], 2)
        self.assertEqual(conn.execute('SELECT reverses_id FROM ledger_entry WHERE id = ?', (reversal,)).fetchone()[0], entry_id)
        self.assertEqual(ledger.balance(conn, receiver.pid), 0)
        rows = {r['id']: r for r in self.get(receiver, '/api/growth/me')['ledger']}
        self.assertEqual(rows[reversal]['reverses'], entry_id)
        self.assertEqual(rows[entry_id]['reversedBy'], reversal)
        self.assertEqual(rows[entry_id]['points'], 5)
        self.assertEqual(rows[reversal]['points'], -5)
        self.assertEqual(self.get(receiver, '/api/growth/me')['points']['season'], 0)
        self.assertEqual(engine.live_count(conn, receiver.pid, 'useful'), 0)
        with self.assertRaises(Exception):
            conn.execute('DELETE FROM ledger_entry')
        self.assertEqual(self.useful(giver, receiver, 'o1')['reason'], 'already_marked')

    def test_reversed_mark_frees_daily_cap(self):
        receiver = self.member('receiver')
        givers = [self.member(f'giver{i}') for i in range(7)]
        ids = [self.useful(g, receiver, f'o{i}')['entry_id'] for i, g in enumerate(givers[:6])]
        self.assertEqual(self.useful(givers[6], receiver, 'o6')['reason'], 'daily_cap')
        with self.db.write() as conn:
            ledger.reverse(conn, ids[0], reason='abuse', actor_id=receiver.pid, idempotency_key='rev-cap')
        self.assertTrue(self.useful(givers[6], receiver, 'o6')['allow'])


class AwardTest(GrowthCase):
    def award(self, **kw):
        with self.db.write() as conn:
            return antiabuse.award(conn, **kw)

    def test_adopted_pair_once_and_confirmer_rules(self):
        subject, c1, c2, c3 = (self.member(n) for n in ('subject', 'cp1', 'cp2', 'cp3'))
        conf = self.member('confirmer', level=3)
        low = self.member('lowconf', level=2)
        under = self.member('kid', inviter=subject.pid, level=3)
        base = dict(event='adopted', subject_id=subject.pid, confirmer_id=conf.pid)
        self.assertEqual(self.award(source_ref='k1', counterparty_id=c1.pid, **dict(base, confirmer_id=low.pid))['reason'],
                         'confirmer_level_too_low')
        self.assertEqual(self.award(source_ref='k1', counterparty_id=c1.pid, **dict(base, confirmer_id=under.pid))['reason'],
                         'confirmer_conflict')
        ok = self.award(source_ref='k1', counterparty_id=c1.pid, **base)
        self.assertEqual((ok['allow'], ok['points']), (True, 20))
        self.assertEqual(self.award(source_ref='k1', counterparty_id=c1.pid, **base)['replayed'], True)
        self.assertEqual(self.award(source_ref='k2', counterparty_id=c1.pid, **base)['reason'], 'pair_once_per_season')
        self.assertTrue(self.award(source_ref='k3', counterparty_id=c2.pid, **base)['allow'])
        self.assertEqual(self.award(source_ref='k4', counterparty_id=c3.pid, **base)['reason'], 'confirmer_pair_cap')
        self.assertEqual(self.award(source_ref='k5', counterparty_id=None, **base)['reason'], 'counterparty_required')
        self.assertEqual(ledger.balance(self.db.conn(), subject.pid), 40)

    def test_pair_slot_resets_next_season(self):
        subject, other, conf = self.member('subject'), self.member('other'), self.member('conf', level=3)
        admin = self.admin()
        self.assertTrue(self.award(event='reproduced', subject_id=subject.pid, confirmer_id=conf.pid, counterparty_id=other.pid,
                                   source_ref='r1')['allow'])
        self.assertEqual(self.award(event='reproduced', subject_id=subject.pid, confirmer_id=conf.pid,
                                    counterparty_id=other.pid, source_ref='r2')['reason'], 'pair_once_per_season')
        r = admin.post('/api/growth/admin/seasons', headers=HDRS,
                       json={'id': 's2027q1', 'name': '2027 春赛季', 'starts_on': '2027-01-01', 'ends_on': '2027-03-31'})
        self.assertEqual(r.status_code, 201, r.text)
        self.now = datetime(2027, 1, 10, 12, tzinfo=timezone.utc).timestamp()
        again = self.award(event='reproduced', subject_id=subject.pid, confirmer_id=conf.pid, counterparty_id=other.pid,
                           source_ref='r3')
        self.assertTrue(again['allow'], again)

    def test_host_rules(self):
        host, conf = self.member('host', level=3), self.member('observer', level=3)
        few = self.award(event='host', subject_id=host.pid, source_ref='h1', participants=4, minutes=30)
        short = self.award(event='host', subject_id=host.pid, source_ref='h1', participants=6, minutes=9)
        self.assertEqual((few['reason'], short['reason']), ('host_participants_too_few', 'host_too_short'))
        self.assertTrue(self.award(event='host', subject_id=host.pid, source_ref='h1', participants=6, minutes=42)['allow'])
        self.assertTrue(self.award(event='host', subject_id=host.pid, source_ref='h2', participants=6, minutes=42)['allow'])
        self.assertEqual(self.award(event='host', subject_id=host.pid, source_ref='h3', participants=9, minutes=60)['reason'],
                         'host_daily_cap')
        self.now += DAY
        self.assertTrue(self.award(event='host', subject_id=host.pid, source_ref='h3', participants=9, minutes=60)['allow'])
        self.assertEqual(conf.pid != host.pid, True)

    def test_report_and_violation_need_governor(self):
        subject, plain = self.member('subject'), self.member('plain', level=4)
        gov = self.member('gov', roles=['governor'])
        self.assertEqual(self.award(event='violation', subject_id=subject.pid, confirmer_id=plain.pid,
                                    source_ref='v1')['reason'], 'confirmer_not_governor')
        ok = self.award(event='report', subject_id=subject.pid, confirmer_id=gov.pid, source_ref='p1')
        self.assertEqual(ok['points'], 3)
        bad = self.award(event='violation', subject_id=subject.pid, confirmer_id=gov.pid, source_ref='v1')
        self.assertEqual(bad['points'], -50)

    def test_pick_confirmer_avoids_conflicts(self):
        subject = self.member('subject')
        kid = self.member('kid', inviter=subject.pid, level=3)
        fine = self.member('fine', level=3)
        self.member('junior', level=2)
        picks = {antiabuse.pick_confirmer(self.db.conn(), subject.pid, seed=s) for s in range(20)}
        self.assertEqual(picks, {fine.pid})
        self.assertNotIn(kid.pid, picks)


class LevelEngineTest(GrowthCase):
    def give_useful(self, receiver, count, prefix='u'):
        for i in range(count):
            giver = self.member(f'{prefix}giver{receiver.pid[:4]}{i}')
            self.assertTrue(self.useful(giver, receiver, f'{prefix}{receiver.pid}{i}')['allow'])

    def activity(self, pid, days):
        with self.db.write() as conn:
            for i in range(days):
                conn.execute('INSERT OR IGNORE INTO growth_activity (principal_id, day) VALUES (?, ?)',
                             (pid, clock.iso(self.now - i * DAY)[:10]))

    def recompute(self, pid):
        with self.db.write() as conn:
            return engine.recompute(conn, pid)

    def test_l2_auto_promotion_conditions(self):
        a = self.member('alice', level=1, age_days=8, consent=True)
        self.activity(a.pid, 5)
        self.give_useful(a, 2)
        self.assertEqual(self.recompute(a.pid)['to'], 1)
        self.give_useful(a, 1, 'more')
        out = self.recompute(a.pid)
        self.assertEqual((out['from'], out['to']), (1, 2))
        row = self.db.conn().execute('SELECT level_source FROM profile WHERE principal_id = ?', (a.pid,)).fetchone()
        self.assertEqual(row[0], 'auto')
        audit = self.audits('growth.level_change')
        self.assertEqual(json.loads(audit[-1]['meta_json'])['to'], 2)
        note = self.outbox_events('growth.level_changed')[-1]
        self.assertEqual((note['from'], note['to']), (1, 2))
        self.assertIn('你升到 L2 队员了', note['message'])
        self.assertIn('knowledge', note['newUnlocks'])

    def test_each_l2_condition_is_required(self):
        young = self.member('young', level=1, age_days=6, consent=True)
        self.activity(young.pid, 5)
        self.give_useful(young, 3)
        self.assertEqual(self.recompute(young.pid)['to'], 1)
        lazy = self.member('lazy', level=1, age_days=20, consent=True)
        self.activity(lazy.pid, 4)
        self.give_useful(lazy, 3)
        self.assertEqual(self.recompute(lazy.pid)['to'], 1)

    def test_no_consent_uses_alternate_route(self):
        b = self.member('bob', level=1, age_days=10, consent=False)
        with self.db.write() as conn:
            self.assertFalse(engine.touch_activity(conn, b.pid))
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM growth_activity').fetchone()[0], 0)
        self.give_useful(b, 3)
        self.assertEqual(self.recompute(b.pid)['to'], 1)
        me = self.get(b, '/api/growth/me')
        self.assertFalse(me['consentMetering'])
        active = next(c for c in me['next']['criteria'] if c['key'] == 'active-days')
        self.assertIsNone(active['have'])
        self.assertEqual({c['key'] for c in me['nextAlt']['criteria']}, {'account-age', 'useful-in'})
        self.give_useful(b, 2, 'more')
        self.assertEqual(self.recompute(b.pid)['to'], 2)

    def test_consent_toggle_clears_activity(self):
        c = self.member('carol', level=1, consent=False)
        r = c.post('/api/growth/consent', headers=HDRS, json={'consent': True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.obj(c)['id'] and 1, 1)
        outbox.dispatch(self.db)
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM growth_activity WHERE principal_id = ?',
                                                (c.pid,)).fetchone()[0], 1)
        c.post('/api/growth/consent', headers=HDRS, json={'consent': False})
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM growth_activity').fetchone()[0], 0)
        self.assertEqual(len(self.audits('growth.consent')), 2)

    def test_l3_promotion_and_one_step_at_a_time(self):
        d = self.member('dora', level=2, age_days=90, consent=True)
        self.activity(d.pid, 30)
        for i in range(5):
            self.raw_entry(d.pid, 'adopted', f'ad{i}')
        with self.db.write() as conn:
            for _ in range(10):
                engine.note_report(conn, d.pid, True)
        self.assertEqual(self.recompute(d.pid)['to'], 3)
        weak = self.member('weak', level=2, age_days=90, consent=True)
        self.activity(weak.pid, 30)
        for i in range(5):
            self.raw_entry(weak.pid, 'adopted', f'wad{i}')
        with self.db.write() as conn:
            for upheld in [True] * 5 + [False] * 5:
                engine.note_report(conn, weak.pid, upheld)
        self.assertEqual(self.recompute(weak.pid)['to'], 2)
        skipper = self.member('skipper', level=1, age_days=90, consent=False)
        for i in range(10):
            self.raw_entry(skipper.pid, 'useful', f'sk{i}', points=5)
        for i in range(5):
            self.raw_entry(skipper.pid, 'adopted', f'ska{i}')
        out = self.recompute(skipper.pid)
        self.assertEqual((out['from'], out['to']), (1, 3))
        steps = [json.loads(a['meta_json']) for a in self.audits('growth.level_change') if a['target_id'] == skipper.pid]
        self.assertEqual([(s['from'], s['to']) for s in steps], [(1, 2), (2, 3)])

    def l4_candidate(self, handle='lead'):
        e = self.member(handle, level=3, age_days=200, consent=False)
        with self.db.write() as conn:
            conn.execute('UPDATE profile SET level_updated_at = ? WHERE principal_id = ?',
                         (clock.iso(self.now - 40 * DAY), e.pid))
        for i in range(15):
            self.raw_entry(e.pid, 'adopted', f'{handle}-ad{i}')
        for i, event in enumerate(('reproduced', 'host', 'curate')):
            self.raw_entry(e.pid, event, f'{handle}-hv{i}')
        return e

    def test_l4_goes_to_review_never_auto(self):
        e = self.l4_candidate()
        out = self.recompute(e.pid)
        self.assertEqual((out['to'], out['queued_review']), (3, True))
        self.assertEqual(self.level(e.pid), 3)
        self.assertFalse(self.recompute(e.pid)['queued_review'])
        gov = self.member('gov', roles=['governor'], totp=True)
        queue = self.get(gov, '/api/growth/review')
        self.assertEqual([q['principalId'] for q in queue], [e.pid])
        self.assertTrue(all(c['have'] >= c['need'] for c in queue[0]['criteria']))
        me = self.get(e, '/api/growth/me')
        self.assertEqual((me['next']['level'], me['next'].get('review'), me['review']), (4, True, 'pending'))
        plain = self.member('plain', level=3)
        self.assertEqual(self.code(plain.get('/api/growth/review')), 'action_not_allowed')
        self.assertEqual(self.level(e.pid), 3)
        r = gov.post(f"/api/growth/review/{queue[0]['id']}", headers=HDRS,
                     json={'decision': 'approve', 'reason_code': 'review_passed'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.level(e.pid), 4)
        again = gov.post(f"/api/growth/review/{queue[0]['id']}", headers=HDRS,
                         json={'decision': 'approve', 'reason_code': 'review_passed'})
        self.assertIn(again.status_code, (200, 409))
        self.assertEqual(len(self.audits('growth.review_decided')), 1)

    def test_review_reject_cooldown_and_no_self_review(self):
        e = self.l4_candidate('lead2')
        self.recompute(e.pid)
        gov = self.member('gov2', roles=['governor'], totp=True)
        review_id = self.get(gov, '/api/growth/review')[0]['id']
        r = gov.post(f'/api/growth/review/{review_id}', headers=HDRS, json={'decision': 'reject', 'reason_code': 'needs_more_time'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.level(e.pid), 3)
        self.assertFalse(self.recompute(e.pid)['queued_review'])
        self.now += 31 * DAY
        self.assertTrue(self.recompute(e.pid)['queued_review'])
        selfgov = self.member('selfgov', level=3, roles=['governor'], totp=True)
        with self.db.write() as conn:
            conn.execute("INSERT INTO growth_review (id, principal_id, target_level, state, created_at) "
                         "VALUES ('rv-self', ?, 4, 'pending', ?)", (selfgov.pid, clock.now()))
        r = selfgov.post('/api/growth/review/rv-self', headers=HDRS, json={'decision': 'approve', 'reason_code': 'review_passed'})
        self.assertEqual(self.code(r), 'state_conflict')

    def test_l5_never_automatic(self):
        e = self.l4_candidate('top')
        with self.db.write() as conn:
            conn.execute('UPDATE profile SET level = 4 WHERE principal_id = ?', (e.pid,))
        self.assertEqual(self.recompute(e.pid)['to'], 4)
        me = self.get(e, '/api/growth/me')
        self.assertEqual((me['next']['level'], me['next']['manual']), (5, True))

    def test_recompute_all_via_admin_endpoint(self):
        admin = self.admin()
        a = self.member('alice', level=1, age_days=10)
        self.give_useful(a, 5)
        r = admin.post('/api/growth/admin/recompute', headers=HDRS, json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['promoted'], 1)
        self.assertEqual(self.level(a.pid), 2)
        self.assertEqual(self.code(a.post('/api/growth/admin/recompute', headers=HDRS, json={})), 'action_not_allowed')

    def test_ledger_events_trigger_recompute_through_outbox(self):
        a = self.member('alice', level=1, age_days=10)
        for i in range(5):
            self.raw_entry(a.pid, 'useful', f'ev{i}', points=5)
        self.assertEqual(self.level(a.pid), 1)
        outbox.dispatch(self.db)
        self.assertEqual(self.level(a.pid), 2)

    def test_violation_demotes_with_cooldown_then_regain(self):
        e = self.member('erin', level=3, age_days=90, consent=False)
        for i in range(10):
            self.raw_entry(e.pid, 'useful', f'e-u{i}', points=5)
        for i in range(5):
            self.raw_entry(e.pid, 'adopted', f'e-a{i}')
        gov = self.member('gov', roles=['governor'])
        violation = self.raw_entry(e.pid, 'violation', 'v1', actor=gov.pid, confirmed_by=gov.pid)
        outbox.dispatch(self.db)
        self.assertEqual(self.level(e.pid), 2)
        source = self.db.conn().execute('SELECT level_source FROM profile WHERE principal_id = ?', (e.pid,)).fetchone()[0]
        self.assertEqual(source, 'demotion')
        me = self.get(e, '/api/growth/me')
        self.assertIsNotNone(me['cooldownUntil'])
        self.assertEqual(self.recompute(e.pid)['to'], 2)
        self.now += 13 * DAY
        self.assertEqual(self.recompute(e.pid)['to'], 2)
        self.keep_sessions()
        self.now += 2 * DAY
        self.assertEqual(self.recompute(e.pid)['to'], 3)
        self.assertIsNone(self.get(e, '/api/growth/me')['cooldownUntil'])
        self.assertTrue(violation)

    def test_appeal_restores_level(self):
        f = self.member('fay', level=3)
        gov = self.member('gov', roles=['governor'])
        violation = self.raw_entry(f.pid, 'violation', 'v1', actor=gov.pid, confirmed_by=gov.pid)
        outbox.dispatch(self.db)
        self.assertEqual(self.level(f.pid), 2)
        with self.db.write() as conn:
            ledger.reverse(conn, violation, reason='appeal', actor_id=gov.pid, idempotency_key='rev-v1')
        outbox.dispatch(self.db)
        self.assertEqual(self.level(f.pid), 3)
        state = self.db.conn().execute('SELECT * FROM growth_state WHERE principal_id = ?', (f.pid,)).fetchone()
        self.assertIsNone(state['cooldown_until'])

    def test_violation_at_l1_or_l5_does_not_lower(self):
        low, top = self.member('lowbie', level=1), self.member('topper', level=5)
        gov = self.member('gov', roles=['governor'])
        self.raw_entry(low.pid, 'violation', 'v-low', actor=gov.pid, confirmed_by=gov.pid)
        self.raw_entry(top.pid, 'violation', 'v-top', actor=gov.pid, confirmed_by=gov.pid)
        outbox.dispatch(self.db)
        self.assertEqual((self.level(low.pid), self.level(top.pid)), (1, 5))


class AppointTest(GrowthCase):
    def test_appoint_needs_admin_totp_and_writes_audit_and_outbox(self):
        admin = self.admin()
        target = self.member('target', level=1)
        body = {'handle': 'target', 'level': 3, 'reason_code': 'founding_cadre'}
        self.assertEqual(self.client().post('/api/growth/admin/appoint', headers=HDRS, json=body).status_code, 401)
        self.assertEqual(self.code(target.post('/api/growth/admin/appoint', headers=HDRS, json=body)), 'action_not_allowed')
        gov = self.member('gov', roles=['governor'], totp=True)
        self.assertEqual(self.code(gov.post('/api/growth/admin/appoint', headers=HDRS, json=body)), 'action_not_allowed')
        no_totp = self.member('nototp', roles=['admin'])
        self.assertEqual(self.code(no_totp.post('/api/growth/admin/appoint', headers=HDRS, json=body)), 'totp_setup_required')
        r = admin.post('/api/growth/admin/appoint', headers=HDRS, json=body)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.level(target.pid), 3)
        self.assertEqual(self.get(target, '/api/me')['level_source'], 'appointed')
        audit = [a for a in self.audits('growth.level_change') if a['target_id'] == target.pid]
        self.assertEqual(len(audit), 1)
        self.assertEqual((audit[0]['actor_id'], audit[0]['reason_code']), (admin.pid, 'founding_cadre'))
        note = [n for n in self.outbox_events('growth.level_changed') if n['to'] == 3][0]
        self.assertIn('你升到 L3 骨干了', note['message'])
        self.assertIn('room', note['newUnlocks'])
        same = admin.post('/api/growth/admin/appoint', headers=HDRS, json=body)
        self.assertEqual(self.code(same), 'state_conflict')

    def test_l5_needs_committee_reference_and_no_self_appointment(self):
        admin = self.admin()
        target = self.member('target', level=4)
        r = admin.post('/api/growth/admin/appoint', headers=HDRS,
                       json={'handle': 'target', 'level': 5, 'reason_code': 'committee'})
        self.assertEqual(self.code(r), 'validation_failed')
        r = admin.post('/api/growth/admin/appoint', headers=HDRS,
                       json={'handle': 'target', 'level': 5, 'reason_code': 'committee', 'committee_ref': 'res-2026-01'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.get(target, '/api/me')['level_source'], 'committee')
        meta = json.loads([a for a in self.audits('growth.level_change') if a['target_id'] == target.pid][0]['meta_json'])
        self.assertEqual(meta['committee_ref'], 'res-2026-01')
        r = admin.post('/api/growth/admin/appoint', headers=HDRS, json={'handle': 'root', 'level': 2, 'reason_code': 'correction'})
        self.assertEqual(self.code(r), 'state_conflict')
        r = admin.post('/api/growth/admin/appoint', headers=HDRS, json={'handle': 'target', 'level': 2, 'reason_code': 'bogus'})
        self.assertEqual(self.code(r), 'validation_failed')


class BoardTest(GrowthCase):
    def setUp(self):
        super().setUp()
        self.users = [self.member(f'user{i}') for i in range(3)]
        for i, u in enumerate(self.users):
            self.raw_entry(u.pid, 'adopted', f'b{i}', points=20 * (3 - i))

    def public(self, on=True):
        with self.db.write() as conn:
            flags.set_flag(conn, 'growth.public_ranking', on, None)

    def test_public_ranking_off_returns_only_own_row(self):
        board = self.get(self.users[1], '/api/growth/board')
        self.assertFalse(board['publicRanking'])
        self.assertEqual([r['id'] for r in board['contribution']], [self.users[1].pid])
        self.assertEqual(board['contribution'][0]['points'], 40)
        self.assertIsNone(board['contribution'][0]['rank'])
        self.assertEqual(board['self']['points'], 40)
        newcomer = self.member('newcomer', level=1)
        quiet = self.get(newcomer, '/api/growth/board')
        self.assertEqual(quiet['contribution'], [])
        self.assertEqual(quiet['self']['points'], 0)

    def test_public_ranking_on_ranks_and_flags_me(self):
        self.public()
        board = self.get(self.users[1], '/api/growth/board')
        self.assertEqual([r['rank'] for r in board['contribution']], [1, 2, 3])
        self.assertEqual([r['points'] for r in board['contribution']], [60, 40, 20])
        self.assertEqual([r['isMe'] for r in board['contribution']], [False, True, False])
        self.assertEqual(set(board['contribution'][0]), {'rank', 'id', 'name', 'level', 'points', 'delta', 'isMe'})
        self.assertEqual(board['contribution'][0]['delta'], 60)
        self.assertEqual(board['season']['id'], 's2026q4')

    def test_opt_out_hides_from_public_but_not_from_self(self):
        self.public()
        me = self.users[0]
        r = me.post('/api/growth/optout', headers=HDRS, json={})
        self.assertEqual(r.json()['data'], {'optedOut': True})
        others = self.get(self.users[1], '/api/growth/board')
        self.assertEqual([r['id'] for r in others['contribution']], [self.users[1].pid, self.users[2].pid])
        self.assertEqual([r['rank'] for r in others['contribution']], [1, 2])
        mine = self.get(me, '/api/growth/board')
        self.assertTrue(mine['optedOut'])
        self.assertEqual(mine['self']['points'], 60)
        self.assertIsNone(mine['self']['rank'])
        self.assertNotIn(me.pid, [r['id'] for r in mine['contribution']])
        self.assertTrue(self.get(me, '/api/growth/me')['optedOut'])
        me.post('/api/growth/optout', headers=HDRS, json={'optout': False})
        back = self.get(self.users[1], '/api/growth/board')
        self.assertEqual(len(back['contribution']), 3)

    def test_admin_and_governor_never_on_board(self):
        self.public()
        admin, gov = self.admin(), self.member('gov', roles=['governor'])
        self.raw_entry(admin.pid, 'adopted', 'adm', points=500)
        self.raw_entry(gov.pid, 'adopted', 'gv', points=400)
        board = self.get(self.users[2], '/api/growth/board')
        ids = [r['id'] for r in board['contribution']]
        self.assertNotIn(admin.pid, ids)
        self.assertNotIn(gov.pid, ids)
        self.assertEqual(len(ids), 3)
        own = self.get(admin, '/api/growth/board')
        self.assertTrue(own['excluded'])
        self.assertIsNone(own['self'])

    def test_season_scoped(self):
        self.public()
        admin = self.admin()
        r = admin.post('/api/growth/admin/seasons', headers=HDRS,
                       json={'id': 's2027q1', 'name': '2027 春赛季', 'starts_on': '2027-01-01', 'ends_on': '2027-03-31'})
        self.assertEqual(r.status_code, 201, r.text)
        clash = admin.post('/api/growth/admin/seasons', headers=HDRS,
                           json={'id': 'mid', 'name': '重叠', 'starts_on': '2026-12-01', 'ends_on': '2027-01-15'})
        self.assertEqual(self.code(clash), 'state_conflict')
        self.keep_sessions()
        self.now = datetime(2027, 1, 10, 12, tzinfo=timezone.utc).timestamp()
        self.raw_entry(self.users[2].pid, 'adopted', 'new-season', points=20, season='s2027q1')
        now_board = self.get(self.users[0], '/api/growth/board')
        self.assertEqual(now_board['season']['id'], 's2027q1')
        self.assertEqual([(r['id'], r['points']) for r in now_board['contribution']], [(self.users[2].pid, 20)])
        old = self.get(self.users[0], '/api/growth/board?season=s2026q4')
        self.assertEqual([r['points'] for r in old['contribution']], [60, 40, 20])
        self.assertEqual(self.get(self.users[0], '/api/growth/me')['points']['season'], 0)
        self.assertEqual(self.client_status(self.users[0], '/api/growth/board?season=nope'), 404)

    def client_status(self, client, path):
        return client.get(path).status_code


class MeShapeTest(GrowthCase):
    def test_me_matches_fe_contract(self):
        a = self.member('alice', level=2, age_days=30, consent=True)
        giver = self.member('giver')
        self.useful(giver, a, 'o1')
        self.raw_entry(a.pid, 'reproduced', 'rp1')
        data = self.get(a, '/api/growth/me')
        for key in ('id', 'name', 'level', 'levelName', 'consentMetering', 'season', 'next', 'nextAlt', 'unlocked',
                    'nextUnlocks', 'points', 'ledger', 'badges'):
            self.assertIn(key, data)
        self.assertEqual((data['level'], data['levelName']), (2, '队员'))
        self.assertEqual(set(data['season']), {'id', 'name', 'startsAt', 'endsAt'})
        self.assertEqual((data['season']['startsAt'], data['season']['endsAt']), ('2026-10-01', '2026-12-31'))
        self.assertEqual(data['next']['level'], 3)
        self.assertEqual({c['key'] for c in data['next']['criteria']}, {'active-half', 'adopted', 'report-n', 'wilson'})
        self.assertEqual(set(data['next']['criteria'][0]), {'key', 'label', 'have', 'need', 'unit', 'metered'})
        self.assertEqual(set(data['unlocked']) | set(data['nextUnlocks']) <= set(rules.ACTION_KEYS), True)
        self.assertIn('knowledge', data['unlocked'])
        self.assertEqual(data['nextUnlocks'], ['room', 'suggest', 'hide', 'volunteer'])
        self.assertEqual(data['points']['season'], 35)
        self.assertEqual(data['points']['weekly'][-1]['total'], 35)
        entry = data['ledger'][0]
        self.assertEqual(set(entry), {'id', 'at', 'event', 'points', 'ruleVersion', 'confirmer', 'reason', 'discount',
                                      'reverses', 'reversedBy'})
        self.assertIn(entry['event'], rules.EVENTS)
        self.assertTrue({b['id'] for b in data['badges']} >= {'first-useful', 'reproduced-once'})
        earned = {b['id']: b['earnedAt'] for b in data['badges']}
        self.assertEqual(earned['first-useful'], '2026-11-15')
        self.assertIsNone(earned['host-room'])
        self.assertEqual(set(data['badges'][0]), {'id', 'name', 'earnedAt', 'how', 'icon'})

    def test_ledger_never_derived_from_chat_and_only_other_modules_write(self):
        sql = (Path(__file__).resolve().parent.parent / 'engine.py').read_text(encoding='utf-8')
        self.assertNotIn('INSERT INTO ledger_entry', sql)
        for name in ('antiabuse.py', 'views.py', 'router.py', 'tokens.py', 'rules.py'):
            text = (Path(__file__).resolve().parent.parent / name).read_text(encoding='utf-8')
            self.assertNotIn('INSERT INTO ledger_entry', text)
            self.assertNotIn('UPDATE ledger_entry', text)

    def test_export_includes_growth(self):
        a = self.member('alice')
        a.post('/api/growth/optout', headers=HDRS, json={})
        data = self.get(a, '/api/me/export')
        self.assertTrue(data['growth']['optedOut'])


class TokenTest(GrowthCase):
    def setUp(self):
        super().setUp()
        self.a = self.member('alice')

    def report(self, client, **body):
        return client.post('/api/growth/tokens/report', headers=HDRS, json=body)

    def db_bytes(self):
        data = b''
        for path in Path(self.tmp).rglob('*'):
            if path.is_file():
                data += path.read_bytes()
        return data

    def test_self_report_stores_only_range(self):
        r = self.report(self.a, family='Claude', band='1–5 亿')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['trust'], 'self')
        row = self.db.conn().execute('SELECT * FROM growth_token_report').fetchone()
        self.assertEqual({k: row[k] for k in row.keys() if k != 'reported_at'},
                         {'principal_id': self.a.pid, 'season_id': 's2026q4', 'family': 'claude', 'band': '100m_500m',
                          'trust': 'self', 'from_file': 0})
        again = self.report(self.a, family='gpt', band='lt_1m')
        self.assertEqual(again.status_code, 200)
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM growth_token_report').fetchone()[0], 1)
        r = self.a.get('/api/growth/tokens')
        rows, meta = r.json()['data'], r.json()['meta']
        self.assertEqual(meta['mine']['band'], '不足 100 万')
        self.assertEqual(rows[0]['trust'], 'self')
        self.assertEqual(set(rows[0]), {'id', 'name', 'level', 'band', 'bandKey', 'family', 'trust', 'fromFile', 'isMe',
                                        'perMillion'})
        self.assertEqual(set(rows[0]['perMillion']), {'works', 'adopted', 'reproduced'})

    def test_visibility_follows_public_ranking_flag(self):
        b = self.member('bob')
        self.report(self.a, family='Claude', band='lt_1m')
        self.report(b, family='GPT', band='gte_500m')
        self.assertEqual([t['id'] for t in self.get(self.a, '/api/growth/tokens')], [self.a.pid])
        with self.db.write() as conn:
            flags.set_flag(conn, 'growth.public_ranking', True, None)
        rows = self.get(self.a, '/api/growth/tokens')
        self.assertEqual([t['id'] for t in rows], [b.pid, self.a.pid])
        self.assertTrue(all(t['trust'] == 'self' for t in rows))
        b.post('/api/growth/optout', headers=HDRS, json={})
        self.assertEqual([t['id'] for t in self.get(self.a, '/api/growth/tokens')], [self.a.pid])

    def test_trust_gateway_and_unknown_fields_rejected(self):
        self.assertEqual(self.code(self.report(self.a, family='Claude', band='lt_1m', trust='gateway')), 'validation_failed')
        self.assertEqual(self.code(self.report(self.a, family='Claude', band='lt_1m', total=123)), 'unknown_field')
        self.assertEqual(self.code(self.report(self.a, family='Nope', band='lt_1m')), 'validation_failed')
        self.assertEqual(self.code(self.report(self.a, family='Claude')), 'validation_failed')
        self.assertEqual(self.client().post('/api/growth/tokens/report', headers=HDRS, json={}).status_code, 401)
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM growth_token_report').fetchone()[0], 0)

    def test_usage_file_parsed_to_range_and_original_not_kept(self):
        marker = 'MARKER-USAGE-FILE-7f3a91'
        usage = {'daily': [{'date': '2026-11-01', 'project': marker, 'inputTokens': 1000, 'outputTokens': 2000,
                            'totalTokens': 30_000_000},
                           {'date': '2026-11-02', 'project': marker, 'totalTokens': 31_000_000}],
                 'note': 'task-implementation-details-for-sk-demo'}
        before = {p for p in Path(self.tmp).rglob('*') if p.is_file()}
        r = self.report(self.a, family='Claude', band='lt_1m', usage_file={'name': 'ccusage.json', 'text': json.dumps(usage)})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['bandKey'], '50m_100m')
        self.assertTrue(r.json()['data']['fromFile'])
        self.assertNotIn(marker, r.text)
        row = self.db.conn().execute('SELECT band, from_file FROM growth_token_report').fetchone()
        self.assertEqual((row['band'], row['from_file']), ('50m_100m', 1))
        self.db.conn().execute('PRAGMA wal_checkpoint(TRUNCATE)')
        self.assertNotIn(marker.encode(), self.db_bytes())
        self.assertNotIn(b'ccusage.json', self.db_bytes())
        dump = '\n'.join(self.db.conn().iterdump())
        self.assertNotIn(marker, dump)
        after = {p for p in Path(self.tmp).rglob('*') if p.is_file()}
        new = {p.name for p in after - before}
        self.assertTrue(all(n.startswith('commons.db') for n in new), new)
        self.assertFalse([p for p in Path(self.settings.storage_dir).rglob('*') if p.is_file()]
                         if os.path.isdir(self.settings.storage_dir) else [])

    def test_usage_file_formats(self):
        totals = json.dumps({'daily': [{'totalTokens': 1}], 'totals': {'totalTokens': 250_000_000}})
        r = self.report(self.a, family='Claude', usage_file={'text': totals})
        self.assertEqual(r.json()['data']['bandKey'], '100m_500m')
        csv_text = 'date,input_tokens,output_tokens\n2026-11-01,400000,100000\n2026-11-02,300000,100000\n'
        r = self.report(self.a, family='GPT', usage_file={'text': csv_text})
        self.assertEqual(r.json()['data']['bandKey'], 'lt_1m')
        bad = self.report(self.a, family='GPT', usage_file={'text': 'hello world'})
        self.assertEqual(self.code(bad), 'validation_failed')
        wrong = self.report(self.a, family='GPT', usage_file='not-an-object')
        self.assertEqual(self.code(wrong), 'validation_failed')

    def test_api_keys_are_rejected_everywhere_without_echo(self):
        secrets = ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
                   'sk-proj-ABCDEFGHIJKLMNOPQRSTUV1234567890',
                   'AKIAABCDEFGHIJKLMNOP',
                   'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
                   'Bearer abcdefghijklmnopqrstuvwxyz012345',
                   'api_key = "q9Zx8Yw7Vv6Uu5Tt4Ss3Rr2Qq1"',
                   'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz']
        for secret in secrets:
            for body in ({'family': secret, 'band': 'lt_1m'},
                         {'family': 'Claude', 'band': 'lt_1m', 'note': secret},
                         {'family': 'Claude', 'usage_file': {'name': 'u.json', 'text': json.dumps({'totalTokens': 5, 'k': secret})}},
                         {'family': 'Claude', secret: 'x'}):
                r = self.report(self.a, **body)
                self.assertEqual((r.status_code, self.code(r)), (422, 'secret_detected'), (secret, body, r.text))
                self.assertNotIn(secret, r.text)
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM growth_token_report').fetchone()[0], 0)
        denied = self.audits('growth.token_report')
        self.assertTrue(denied and all(d['outcome'] == 'denied' and d['reason_code'] == 'secret_detected' for d in denied))
        self.assertNotIn('sk-ant', json.dumps([d['meta_json'] for d in denied]))
        self.assertNotIn(b'sk-ant-api03', self.db_bytes())


class SurfaceTest(GrowthCase):
    def test_all_documented_endpoints_exist_and_require_login(self):
        anon = self.client()
        for method, path in (('get', '/api/growth/me'), ('get', '/api/growth/board'), ('get', '/api/growth/tokens'),
                             ('get', '/api/growth/rules'), ('post', '/api/growth/tokens/report'),
                             ('post', '/api/growth/optout'), ('post', '/api/growth/admin/appoint')):
            r = getattr(anon, method)(path, **({} if method == 'get' else {'headers': HDRS, 'json': {}}))
            self.assertEqual(r.status_code, 401, (path, r.text))

    def test_only_growth_routes_and_prefix(self):
        for route in growth_router.router.routes:
            self.assertTrue(route.path.startswith('/api/growth/'), route.path)


if __name__ == '__main__':
    unittest.main()
