import json
import unittest

from app import accounts
from tests.helpers import AppCase, HDRS

from modules.orgs import service


class OrgsCase(AppCase):
    def make(self, client, status=201, **over):
        body = {
            'name': over.pop('name', f'团队-{client.pid[:8]}'),
            'intro': '把可复现作品和成员协作放在一起。',
            'type': 'lab',
            'website': 'https://example.org/team',
            'slug': over.pop('slug', f'team-{client.pid[:8]}'),
            'banner': 'assets/samples/banner-grid.webp',
            'join_policy': 'apply',
        }
        body.update(over)
        response = client.post('/api/orgs', headers=HDRS, json=body)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()['data'] if status < 400 else response.json()

    def approve(self, item):
        suffix = ''.join(ch for ch in item['slug'] if ch.isalnum())[:8]
        governor = self.user(f'gov_{suffix}', level=5, roles=('governor',), totp=True)
        response = governor.post(
            f'/api/admin/orgs/applications/{item["id"]}/review', headers=HDRS,
            json={'decision': 'approve', 'note': '资料完整'},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return governor

    def role(self, client, slug, pid, role='member', state='active', status=200):
        response = client.post(
            f'/api/orgs/{slug}/members/{pid}/role', headers=HDRS,
            json={'role': role, 'state': state},
        )
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def events(self, kind):
        with self.db.read() as conn:
            return [json.loads(row[0]) for row in conn.execute(
                'SELECT payload_json FROM outbox_event WHERE event_type = ? ORDER BY occurred_at', (kind,)
            )]


class ApplicationTest(OrgsCase):
    def test_l2_cannot_create_and_website_is_safe(self):
        l2 = self.user('org_l2', level=2)
        denied = self.make(l2, status=403)
        self.assertEqual(denied['error']['code'], 'action_not_allowed')

        l3 = self.user('org_l3', level=3)
        response = l3.post('/api/orgs', headers=HDRS, json={
            'name': '坏网址团队', 'intro': '简介', 'type': 'company', 'website': 'javascript:alert(1)',
        })
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['error']['code'], 'validation_failed')

    def test_unapproved_org_is_not_public(self):
        owner = self.user('org_pending_owner', level=3)
        peer = self.user('org_pending_peer')
        item = self.make(owner, slug='pending-team')
        self.assertEqual(item['status'], 'pending')
        self.assertEqual(peer.get('/api/orgs').json()['data'], [])
        self.assertEqual(peer.get('/api/orgs/pending-team').status_code, 404)

        self.approve(item)
        detail = peer.get('/api/orgs/pending-team')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()['data']['name'], item['name'])


class MembershipTest(OrgsCase):
    def setUp(self):
        super().setUp()
        self.owner = self.user('org_owner', level=3)
        self.item = self.make(self.owner, slug='role-team', name='角色实验室')
        self.approve(self.item)

    def test_apply_approve_invite_and_role_permissions(self):
        applicant = self.user('org_applicant')
        response = applicant.post('/api/orgs/role-team/join', headers=HDRS,
                                  json={'note': '带着作品加入', 'show_on_profile': False})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['data']['state'], 'pending')
        self.assertEqual(self.events('org.join_requested')[-1]['principal_id'], applicant.pid)

        approved = self.role(self.owner, 'role-team', applicant.pid)
        self.assertEqual(approved['data']['state'], 'active')
        self.role(self.owner, 'role-team', applicant.pid, role='admin')

        invitee = self.user('org_invitee')
        self.role(applicant, 'role-team', invitee.pid, state='invited')
        joined = invitee.post('/api/orgs/role-team/join', headers=HDRS, json={'show_on_profile': True})
        self.assertEqual(joined.json()['data']['state'], 'active')

        another = self.user('org_another')
        denied = self.role(applicant, 'role-team', another.pid, role='admin', status=403)
        self.assertEqual(denied['error']['code'], 'action_not_allowed')

    def test_only_owner_can_transfer_ownership(self):
        admin = self.user('org_transfer_admin')
        self.role(self.owner, 'role-team', admin.pid)
        self.role(self.owner, 'role-team', admin.pid, role='admin')
        transferred = self.role(self.owner, 'role-team', admin.pid, role='owner')
        self.assertEqual(transferred['data']['role'], 'owner')
        with self.db.read() as conn:
            org = conn.execute("SELECT owner_id FROM org WHERE slug = 'role-team'").fetchone()
            old = conn.execute('SELECT role FROM org_member WHERE org_id = (SELECT id FROM org WHERE slug = ?) '
                               'AND principal_id = ?', ('role-team', self.owner.pid)).fetchone()
        self.assertEqual(org['owner_id'], admin.pid)
        self.assertEqual(old['role'], 'admin')


class VisibilityAndCleanupTest(OrgsCase):
    def test_blocked_owner_makes_org_invisible(self):
        owner = self.user('org_block_owner', level=3)
        viewer = self.user('org_block_viewer')
        item = self.make(owner, slug='blocked-team')
        self.approve(item)
        with self.db.write() as conn:
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (viewer.pid, owner.pid, '2026-10-25T12:00:00.000000Z'))
        self.assertEqual(viewer.get('/api/orgs').json()['data'], [])
        self.assertEqual(viewer.get('/api/orgs/blocked-team').status_code, 404)

    def test_purge_transfers_to_earliest_admin_or_freezes(self):
        owner = self.user('org_purge_owner', level=3)
        item = self.make(owner, slug='heir-team')
        self.approve(item)
        early = self.user('org_early_admin')
        late = self.user('org_late_admin')
        self.role(owner, 'heir-team', early.pid)
        self.role(owner, 'heir-team', early.pid, role='admin')
        self.role(owner, 'heir-team', late.pid)
        self.role(owner, 'heir-team', late.pid, role='admin')
        with self.db.write() as conn:
            service.purge(conn, owner.pid)
        with self.db.read() as conn:
            org = conn.execute("SELECT owner_id, status FROM org WHERE slug = 'heir-team'").fetchone()
            relation = conn.execute('SELECT 1 FROM org_member WHERE principal_id = ?', (owner.pid,)).fetchone()
        self.assertEqual(org['owner_id'], early.pid)
        self.assertEqual(org['status'], 'approved')
        self.assertIsNone(relation)

        alone = self.user('org_alone_owner', level=3)
        solo = self.make(alone, slug='solo-team')
        self.approve(solo)
        with self.db.write() as conn:
            service.purge(conn, alone.pid)
        with self.db.read() as conn:
            frozen = conn.execute("SELECT owner_id, status FROM org WHERE slug = 'solo-team'").fetchone()
        self.assertIsNone(frozen['owner_id'])
        self.assertEqual(frozen['status'], 'frozen')
        self.assertEqual(self.events('org.owner_missing')[-1]['notify'], 'governance')


class CoreObjectTest(OrgsCase):
    def test_team_post_reuses_core_object(self):
        owner = self.user('org_post_owner', level=3)
        item = self.make(owner, slug='post-team')
        self.approve(item)
        response = owner.post('/api/orgs/post-team/posts', headers=HDRS, json={
            'title': '本周进展', 'body': '完成了检索工作台。', 'summary': '一条团队动态',
        })
        self.assertEqual(response.status_code, 201, response.text)
        object_id = response.json()['data']['id']
        with self.db.read() as conn:
            head = conn.execute('SELECT type, visibility FROM object_head WHERE id = ?', (object_id,)).fetchone()
            link = conn.execute('SELECT kind FROM org_object WHERE object_id = ?', (object_id,)).fetchone()
        self.assertEqual(dict(head), {'type': 'org_post', 'visibility': 'members'})
        self.assertEqual(link['kind'], 'post')
        detail = owner.get('/api/orgs/post-team').json()['data']
        self.assertEqual(detail['posts'][0]['title'], '本周进展')


if __name__ == '__main__':
    unittest.main()
