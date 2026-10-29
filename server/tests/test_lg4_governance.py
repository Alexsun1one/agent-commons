"""LG-4 gate evidence, using only disposable TestClient fixtures."""
import ast
import json
from pathlib import Path
from unittest import TestCase, mock

from app import accounts, flags, outbox
from app.authz import Actor
from app.errors import ApiError
from modules.admin import hooks as admin_hooks
from modules.announce import service as announce
from modules.governance import service
from tests.helpers import AppCase, HDRS


class ModuleGateCoverage(TestCase):
    def test_every_discovered_module_calls_flags_gate(self):
        """Static integration guard; runtime semantics are exercised separately."""
        root = Path(__file__).resolve().parents[1] / 'modules'
        missing = []
        for module in sorted(root.iterdir()):
            if not module.is_dir() or not (module / '__init__.py').exists():
                continue
            calls = []
            for path in module.rglob('*.py'):
                if 'tests' in path.parts:
                    continue
                tree = ast.parse(path.read_text(), filename=str(path))
                calls.extend(node for node in ast.walk(tree) if isinstance(node, ast.Call)
                             and isinstance(node.func, ast.Attribute) and node.func.attr == 'gate'
                             and isinstance(node.func.value, ast.Name) and node.func.value.id == 'flags')
            if not calls:
                missing.append(module.name)
        self.assertEqual(missing, [], 'Modules missing flags.gate: ' + ', '.join(missing))


class GovernanceGateTest(AppCase):
    def setUp(self):
        super().setUp()
        no_gateway = mock.patch('modules.governance.model.gateway', return_value=None)
        no_gateway.start()
        self.addCleanup(no_gateway.stop)

    def complaint(self, client=None, **changes):
        body = {'locator': '#/threads/external-reference', 'category': 'copyright',
                'statement': '第三方作品被转载，请人工核查。'}
        body.update(changes)
        return (client or self.client()).post('/api/governance/complaints', headers=HDRS, json=body)

    def switch(self, key, value):
        with self.db.write() as conn:
            flags.set_flag(conn, key, value, None)

    def test_all_five_levels_can_report_and_each_is_audited(self):
        author = self.user('lg4_author', 2)
        oid = self.obj(author)['id']
        for level in range(1, 6):
            client = self.user(f'lg4_level{level}', level)
            r = client.post('/api/governance/reports', headers=HDRS,
                            json={'target_id': oid, 'reason_code': 'spam'})
            self.assertEqual(r.status_code, 201, r.text)
        conn = self.db.conn()
        self.assertEqual(conn.execute('SELECT count(*) FROM gov_report').fetchone()[0], 5)
        self.assertEqual(conn.execute("SELECT count(*) FROM audit_event WHERE action = 'gov.report.create'").fetchone()[0], 5)
        self.assertEqual(conn.execute('SELECT count(*) FROM gov_action').fetchone()[0], 0)

    def test_anonymous_intake_private_queue_human_decision_and_audit(self):
        anon = self.client()
        response = self.complaint(anon)
        self.assertEqual(response.status_code, 201, response.text)
        receipt = response.json()['data']
        self.assertEqual(set(receipt), {'id', 'state'})
        self.assertEqual(anon.get('/api/governance/complaints').status_code, 404)
        member = self.user('lg4_member', 5)
        self.assertEqual(member.get('/api/governance/complaints').status_code, 404)
        governor = self.user('lg4_governor', 2, roles=('governor',), totp=True)
        rows = governor.get('/api/governance/complaints').json()['data']
        self.assertEqual(rows[0]['id'], receipt['id'])
        path = '/api/governance/complaints/' + receipt['id'] + '/decide'
        decision = {'state': 'reviewed', 'reason': '已核对来源，转内容事项处理'}
        self.assertEqual(member.post(path, headers=HDRS, json=decision).status_code, 404)
        headers = dict(HDRS, **{'Idempotency-Key': 'lg4-complaint-decision'})
        done = governor.post(path, headers=headers, json=decision)
        self.assertEqual(done.status_code, 200, done.text)
        replay = governor.post(path, headers=headers, json=decision)
        self.assertEqual(replay.headers['Idempotent-Replayed'], 'true')
        self.assertEqual(governor.get('/api/governance/complaints').json()['data'], [])
        conn = self.db.conn()
        events = conn.execute("SELECT action, meta_json FROM audit_event WHERE target_type = 'gov_complaint' ORDER BY occurred_at").fetchall()
        self.assertEqual([r['action'] for r in events], ['gov.complaint.submit', 'gov.complaint.decide'])
        self.assertNotIn('第三方作品', json.dumps([dict(r) for r in events], ensure_ascii=False))
        self.assertEqual(conn.execute('SELECT count(*) FROM gov_action').fetchone()[0], 0)

    def test_complaint_no_target_enumeration_validation_csrf_and_limit(self):
        anon = self.client()
        self.assertEqual(self.complaint(anon, locator='missing-private-object').status_code, 201)
        self.assertEqual(self.complaint(anon, statement='  ').status_code, 422)
        self.assertEqual(self.complaint(anon, category='invalid').status_code, 422)
        self.assertEqual(self.complaint(anon, statement='x' * 2001).status_code, 422)
        self.assertEqual(anon.post('/api/governance/complaints', json={}).status_code, 403)
        with mock.patch.dict(self.settings.rate_limits, {'auth': (1, 60)}):
            with self.db.write() as conn:
                conn.execute('DELETE FROM rate_bucket')
            self.assertEqual(self.complaint(anon).status_code, 201)
            self.assertEqual(self.complaint(anon).status_code, 429)

    def test_switches_fail_closed_and_do_not_break_core_recovery(self):
        admin = self.user('lg4_admin', 5, roles=('admin',), totp=True)
        self.switch('gov.complaints', False)
        self.assertEqual(self.complaint().status_code, 501)
        self.switch('governance.enabled', False)
        self.assertEqual(admin.get('/api/governance/me').status_code, 501)
        self.switch('admin.enabled', False)
        self.assertEqual(admin.get('/api/admin-console/metrics').status_code, 501)
        self.assertEqual(admin.get('/api/admin/admin/overview').status_code, 501)
        self.assertEqual(admin.get('/api/flags').status_code, 200)
        restored = admin.post('/api/admin/flags', headers=HDRS,
                              json={'key': 'admin.enabled', 'enabled': True})
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(admin.get('/api/admin/admin/overview').status_code, 200)
        with self.assertRaises(ApiError) as caught:
            flags.gate(self.db.conn(), 'missing.lg4.switch')
        self.assertEqual(caught.exception.code, 'capability_unavailable')
        self.assertIsInstance(accounts.export(self.db.conn(), Actor(id=admin.pid, level=5)), dict)

    def test_screening_switch_stops_new_jobs_but_recovery_sweep_remains(self):
        author = self.user('lg4_screen', 1)
        self.switch('governance.enabled', False)
        oid = self.obj(author, content={'body': '联系我 13812345678'})['id']
        for _ in range(5):
            outbox.dispatch(self.db)
        conn = self.db.conn()
        self.assertEqual(conn.execute('SELECT count(*) FROM gov_case WHERE target_id = ?', (oid,)).fetchone()[0], 0)
        self.assertEqual(service.run_agent_jobs(self.db), 0)

    def test_export_and_purge_hooks_registered_and_preserve_other_member(self):
        first, other = self.user('lg4_first', 2), self.user('lg4_other', 2)
        oid = self.obj(other)['id']
        r = first.post('/api/governance/reports', headers=HDRS,
                       json={'target_id': oid, 'reason_code': 'spam', 'note': '私人举报说明'})
        self.assertEqual(r.status_code, 201, r.text)
        actor = Actor(id=first.pid, level=2)
        with self.db.write() as conn:
            for pid in (first.pid, other.pid):
                conn.execute('INSERT INTO announce_pref VALUES (?, 1, 1, ?)', (pid, '2026-10-27T00:00:00.000000Z'))
            export = accounts.export(conn, actor)
            for name in ('governance', 'announce', 'admin'):
                self.assertIn(name, export)
            self.assertEqual(export['governance']['reports'][0]['note'], '私人举报说明')
            self.assertEqual(len(export['announce']['preferences']), 1)
            before = conn.execute('SELECT count(*) FROM audit_event').fetchone()[0]
            for purge in (service.purge, announce.purge, admin_hooks.purge):
                self.assertIn(purge, accounts.PURGERS)
                purge(conn, first.pid)
                purge(conn, first.pid)  # repeatable for recovery
            self.assertEqual(conn.execute('SELECT note FROM gov_report WHERE reporter_id = ?', (first.pid,)).fetchone()[0], '')
            self.assertEqual(conn.execute('SELECT count(*) FROM announce_pref WHERE principal_id = ?', (first.pid,)).fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT count(*) FROM announce_pref WHERE principal_id = ?', (other.pid,)).fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT count(*) FROM audit_event').fetchone()[0], before)
