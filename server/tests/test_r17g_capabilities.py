"""R17-G · 动作不可用的原因：explain() 与 can() 一致，/api/me 带 capability_reasons。"""
from app import authz, flags
from tests.helpers import AppCase


def actor(pid, level, roles=(), status='active', totp=False):
    return authz.Actor(id=pid, level=level, roles=frozenset(roles), status=status, totp_enabled=totp)


class CapabilityReasonsTest(AppCase):
    def test_explain_agrees_with_can_for_every_rule(self):
        samples = [authz.ANONYMOUS, actor('p1', 1), actor('p2', 3), actor('p3', 9, ('governor',)),
                   actor('p4', 9, ('admin', 'governor'), totp=True), actor('p5', 3, status='suspended')]
        conn = self.db.conn()
        actions = [r[0] for r in conn.execute('SELECT action FROM action_rule WHERE owner_only = 0')]
        self.assertTrue(actions)
        for who in samples:
            for action in actions:
                with self.subTest(actor=who.id, action=action):
                    self.assertEqual(authz.check(conn, who, action) is None,
                                     authz.explain(conn, who, action) is None)

    def test_level_reason_carries_the_threshold(self):
        with self.db.write() as conn:
            conn.execute("UPDATE action_rule SET min_level = 3, roles = '[]' WHERE action = 'bounty.create.help'")
            flags.set_flag(conn, 'bounty.enabled', True, None)
        conn = self.db.conn()
        why = authz.explain(conn, actor('p1', 1), 'bounty.create.help')
        self.assertEqual(why, {'reason': 'level', 'min_level': 3, 'level': 1})
        self.assertIsNone(authz.explain(conn, actor('p1', 3), 'bounty.create.help'))

    def test_role_reason_when_no_level_route(self):
        with self.db.write() as conn:
            conn.execute("UPDATE action_rule SET min_level = NULL, roles = '[\"governor\"]' WHERE action = 'bounty.create.help'")
            flags.set_flag(conn, 'bounty.enabled', True, None)
        why = authz.explain(self.db.conn(), actor('p1', 9), 'bounty.create.help')
        self.assertEqual(why, {'reason': 'role', 'roles': ['governor']})

    def test_feature_off_beats_level(self):
        with self.db.write() as conn:
            flags.set_flag(conn, 'bounty.enabled', False, None)
        why = authz.explain(self.db.conn(), actor('p1', 1), 'bounty.create.help')
        self.assertEqual(why, {'reason': 'feature_off'})

    def test_totp_reason(self):
        with self.db.write() as conn:
            conn.execute("UPDATE action_rule SET require_totp = 1, min_level = 1 WHERE action = 'bounty.create.help'")
            flags.set_flag(conn, 'bounty.enabled', True, None)
        conn = self.db.conn()
        self.assertEqual(authz.explain(conn, actor('p1', 1), 'bounty.create.help'), {'reason': 'totp'})
        self.assertIsNone(authz.explain(conn, actor('p1', 1, totp=True), 'bounty.create.help'))

    def test_me_lists_reasons_only_for_unavailable_actions(self):
        member = self.user('r17g_me', level=1)
        data = member.get('/api/me').json()['data']
        caps, reasons = set(data['capabilities']), data['capability_reasons']
        self.assertTrue(caps)
        self.assertTrue(reasons)
        self.assertFalse(caps & set(reasons), '可用的动作不该出现在原因表里')
        allowed = {'feature_off', 'level', 'role', 'totp', 'status'}
        self.assertTrue(all(v['reason'] in allowed for v in reasons.values()), reasons)
        # 与 capabilities 合起来正好覆盖全部非 owner_only 动作
        total = self.db.conn().execute('SELECT count(*) FROM action_rule WHERE owner_only = 0').fetchone()[0]
        self.assertEqual(len(caps) + len(reasons), total)

    def test_me_reason_changes_when_level_rises(self):
        member = self.user('r17g_rise', level=1)
        before = member.get('/api/me').json()['data']['capability_reasons']
        levels = {a: v for a, v in before.items() if v['reason'] == 'level'}
        self.assertTrue(levels, '1 级成员应当有一些等级不够的动作')
        with self.db.write() as conn:
            conn.execute('UPDATE profile SET level = 5 WHERE principal_id = ?', (member.pid,))
        after = member.get('/api/me').json()['data']['capability_reasons']
        for action in levels:
            self.assertNotEqual(after.get(action, {}).get('reason'), 'level', action)
