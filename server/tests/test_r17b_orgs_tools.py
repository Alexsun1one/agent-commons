"""R17-B · 入组申请审批、我的申请、组织动态详情、我提交的工具。"""
import json
import unittest
import uuid

from tests.helpers import AppCase, HDRS


class R17BCase(AppCase):
    def make_org(self, owner, slug, join_policy='apply'):
        response = owner.post('/api/orgs', headers=HDRS, json={
            'name': f'团队-{slug}', 'intro': '一起做可复现的作品。', 'type': 'lab', 'slug': slug,
            'join_policy': join_policy})
        self.assertEqual(response.status_code, 201, response.text)
        item = response.json()['data']
        governor = self.user('gov_' + slug.replace('-', '_'), level=5, roles=('governor',), totp=True)
        reviewed = governor.post(f'/api/admin/orgs/applications/{item["id"]}/review', headers=HDRS,
                                 json={'decision': 'approve', 'note': '资料完整'})
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        return item

    def apply(self, client, slug, note='想一起做'):
        response = client.post(f'/api/orgs/{slug}/join', headers=HDRS, json={'note': note})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def review(self, manager, slug, pid, decision='approve', note='', status=200):
        response = manager.post(f'/api/orgs/{slug}/applications/{pid}/review', headers=HDRS,
                                json={'decision': decision, 'note': note})
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def events(self, kind):
        with self.db.read() as conn:
            return [json.loads(row[0]) for row in conn.execute(
                'SELECT payload_json FROM outbox_event WHERE event_type = ? ORDER BY occurred_at', (kind,))]


class ApplicationQueueTest(R17BCase):
    def setUp(self):
        super().setUp()
        self.owner = self.user('r17_owner', level=3)
        self.make_org(self.owner, 'queue-team')

    def test_only_managers_see_the_queue(self):
        applicant = self.user('r17_applicant')
        self.apply(applicant, 'queue-team', '带着作品来')

        queue = self.owner.get('/api/orgs/queue-team/applications')
        self.assertEqual(queue.status_code, 200, queue.text)
        rows = queue.json()['data']
        self.assertEqual([row['id'] for row in rows], [applicant.pid])
        self.assertEqual(rows[0]['note'], '带着作品来')
        self.assertEqual(rows[0]['handle'], 'r17_applicant')
        self.assertEqual(rows[0]['status'], 'pending')

        self.assertEqual(applicant.get('/api/orgs/queue-team/applications').status_code, 403)
        stranger = self.user('r17_stranger')
        self.assertEqual(stranger.get('/api/orgs/queue-team/applications').status_code, 403)
        self.assertEqual(self.client().get('/api/orgs/queue-team/applications').status_code, 401)
        self.assertEqual(self.owner.get('/api/orgs/queue-team/applications?status=frozen').status_code, 422)

    def test_plain_member_cannot_review_but_admin_can(self):
        member, admin, applicant = self.user('r17_member'), self.user('r17_admin'), self.user('r17_app2')
        for person in (member, admin):
            self.apply(person, 'queue-team')
            self.review(self.owner, 'queue-team', person.pid)
        self.owner.post(f'/api/orgs/queue-team/members/{admin.pid}/role', headers=HDRS,
                        json={'role': 'admin', 'state': 'active'})
        self.apply(applicant, 'queue-team')

        denied = self.review(member, 'queue-team', applicant.pid, status=403)
        self.assertEqual(denied['error']['code'], 'action_not_allowed')
        self.review(admin, 'queue-team', applicant.pid)

    def test_approve_and_reject_update_state_and_emit_outbox(self):
        yes, no = self.user('r17_yes'), self.user('r17_no')
        self.apply(yes, 'queue-team')
        self.apply(no, 'queue-team')

        approved = self.review(self.owner, 'queue-team', yes.pid, 'approve', '欢迎')['data']
        self.assertEqual(approved['status'], 'approved')
        rejected = self.review(self.owner, 'queue-team', no.pid, 'reject', '方向不合')['data']
        self.assertEqual(rejected['status'], 'rejected')

        self.assertEqual(self.owner.get('/api/orgs/queue-team/applications').json()['data'], [])
        done = self.owner.get('/api/orgs/queue-team/applications?status=approved').json()['data']
        self.assertEqual([row['id'] for row in done], [yes.pid])
        gone = self.owner.get('/api/orgs/queue-team/applications?status=rejected').json()['data']
        self.assertEqual(gone[0]['reviewNote'], '方向不合')

        decided = {event['recipient_id']: event['decision'] for event in self.events('org.join_decided')}
        self.assertEqual(decided, {yes.pid: 'approve', no.pid: 'reject'})
        detail = yes.get('/api/orgs/queue-team').json()['data']
        self.assertEqual(detail['me'], {'state': 'active', 'role': 'member', 'showOnProfile': True})
        self.assertEqual(no.get('/api/orgs/queue-team').json()['data']['me']['state'], 'rejected')

    def test_decided_application_cannot_be_decided_again(self):
        applicant = self.user('r17_twice')
        self.apply(applicant, 'queue-team')
        self.review(self.owner, 'queue-team', applicant.pid)
        again = self.review(self.owner, 'queue-team', applicant.pid, 'reject', status=409)
        self.assertEqual(again['error']['code'], 'state_conflict')
        self.assertEqual(self.owner.get('/api/orgs/queue-team').json()['data']['membersList'][-1]['id'], applicant.pid)

    def test_unknown_or_non_applicant_is_404(self):
        self.review(self.owner, 'queue-team', str(uuid.uuid4()), status=404)
        self.review(self.owner, 'queue-team', self.owner.pid, status=404)
        self.review(self.owner, 'no-such-team', self.owner.pid, status=404)

    def test_blocked_applicant_is_hidden_from_manager(self):
        applicant = self.user('r17_blocked')
        self.apply(applicant, 'queue-team')
        with self.db.write() as conn:
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (self.owner.pid, applicant.pid, '2026-10-28T08:00:00.000000Z'))
        self.assertEqual(self.owner.get('/api/orgs/queue-team/applications').json()['data'], [])
        self.review(self.owner, 'queue-team', applicant.pid, status=404)

    def test_pending_count_only_for_managers(self):
        applicant = self.user('r17_count')
        self.apply(applicant, 'queue-team')
        self.assertEqual(self.owner.get('/api/orgs/queue-team').json()['data']['pendingApplications'], 1)
        self.assertNotIn('pendingApplications', applicant.get('/api/orgs/queue-team').json()['data'])

    def test_reapply_after_reject_clears_the_old_decision(self):
        applicant = self.user('r17_retry')
        self.apply(applicant, 'queue-team', '第一次')
        self.review(self.owner, 'queue-team', applicant.pid, 'reject', '再准备一下')
        self.apply(applicant, 'queue-team', '补了作品')
        mine = applicant.get('/api/orgs/mine/applications').json()['data']
        self.assertEqual((mine[0]['status'], mine[0]['note'], mine[0]['reviewNote']), ('pending', '补了作品', ''))


class MyApplicationsTest(R17BCase):
    def test_lists_pending_approved_rejected_and_skips_non_applications(self):
        owner = self.user('r17_my_owner', level=3)
        self.make_org(owner, 'mine-a')
        self.make_org(owner, 'mine-b')
        self.make_org(owner, 'mine-c')
        invite_only = self.make_org(owner, 'mine-d', join_policy='invite')
        me = self.user('r17_me')
        self.apply(me, 'mine-a')
        self.apply(me, 'mine-b')
        self.apply(me, 'mine-c')
        self.review(owner, 'mine-b', me.pid, 'approve')
        self.review(owner, 'mine-c', me.pid, 'reject', '名额满了')
        owner.post(f'/api/orgs/{invite_only["slug"]}/members/{me.pid}/role', headers=HDRS,
                   json={'role': 'member', 'state': 'invited'})

        rows = me.get('/api/orgs/mine/applications')
        self.assertEqual(rows.status_code, 200, rows.text)
        by_slug = {row['slug']: row for row in rows.json()['data']}
        self.assertEqual({slug: row['status'] for slug, row in by_slug.items()},
                         {'mine-a': 'pending', 'mine-b': 'approved', 'mine-c': 'rejected'})
        self.assertEqual(by_slug['mine-c']['reviewNote'], '名额满了')
        self.assertEqual(by_slug['mine-c']['typeLabel'], '实验室')

        self.assertEqual(owner.get('/api/orgs/mine/applications').json()['data'], [])
        self.assertEqual(self.client().get('/api/orgs/mine/applications').status_code, 401)

    def test_unapproved_org_application_is_not_listed(self):
        owner = self.user('r17_hide_owner', level=3)
        self.make_org(owner, 'hide-me')
        me = self.user('r17_hide_me')
        self.apply(me, 'hide-me')
        with self.db.write() as conn:
            conn.execute("UPDATE org SET status = 'frozen' WHERE slug = 'hide-me'")
        self.assertEqual(me.get('/api/orgs/mine/applications').json()['data'], [])


class OrgPostDetailTest(R17BCase):
    def setUp(self):
        super().setUp()
        self.owner = self.user('r17_post_owner', level=3)
        self.make_org(self.owner, 'post-team')
        self.make_org(self.owner, 'other-team')

    def post(self, slug='post-team', **over):
        body = {'title': '本周进展', 'body': '第一段\n\n第二段', 'summary': '摘要', 'tags': ['周报']}
        body.update(over)
        response = self.owner.post(f'/api/orgs/{slug}/posts', headers=HDRS, json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['data']['id']

    def test_detail_returns_full_post_for_a_member(self):
        post_id = self.post()
        viewer = self.user('r17_post_viewer')
        response = viewer.get(f'/api/orgs/post-team/posts/{post_id}')
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()['data']
        self.assertEqual((data['title'], data['body'], data['tags']), ('本周进展', '第一段\n\n第二段', ['周报']))
        self.assertEqual(data['org'], {'slug': 'post-team', 'name': '团队-post-team'})
        self.assertEqual(data['author']['handle'], 'r17_post_owner')

    def test_detail_hides_wrong_org_missing_and_unlinked_objects(self):
        post_id = self.post()
        viewer = self.user('r17_post_viewer2')
        self.assertEqual(viewer.get(f'/api/orgs/other-team/posts/{post_id}').status_code, 404)
        self.assertEqual(viewer.get(f'/api/orgs/post-team/posts/{uuid.uuid4()}').status_code, 404)
        loose = self.obj(self.owner)['id']
        self.assertEqual(viewer.get(f'/api/orgs/post-team/posts/{loose}').status_code, 404)
        self.assertEqual(self.client().get(f'/api/orgs/post-team/posts/{post_id}').status_code, 401)

    def test_level_gated_post_is_404_below_the_level(self):
        post_id = self.post(visibility='level', min_level=3)
        low, high = self.user('r17_low'), self.user('r17_high', level=3)
        self.assertEqual(low.get(f'/api/orgs/post-team/posts/{post_id}').status_code, 404)
        self.assertEqual(high.get(f'/api/orgs/post-team/posts/{post_id}').status_code, 200)

    def test_blocked_author_post_is_404(self):
        post_id = self.post()
        viewer = self.user('r17_post_blocker')
        with self.db.write() as conn:
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (viewer.pid, self.owner.pid, '2026-10-28T08:00:00.000000Z'))
        self.assertEqual(viewer.get(f'/api/orgs/post-team/posts/{post_id}').status_code, 404)


class MySubmissionsTest(AppCase):
    def proposal(self, slug):
        return {'slug': slug, 'name': slug.title(), 'vendor': '示例厂商', 'category': '编程 Agent',
                'official_url': f'https://example.com/{slug}', 'price_tier': '订阅', 'tags': ['代码'],
                'summary': '专项测试条目。'}

    def write_headers(self):
        return {**HDRS, 'Idempotency-Key': uuid.uuid4().hex}

    def test_lists_only_my_submissions_with_review_state(self):
        mine, other = self.user('r17_tool_mine'), self.user('r17_tool_other')
        for slug in ('alpha-tool', 'beta-tool'):
            self.assertEqual(mine.post('/api/tools/submissions', headers=self.write_headers(),
                                       json=self.proposal(slug)).status_code, 201)
        self.assertEqual(other.post('/api/tools/submissions', headers=self.write_headers(),
                                    json=self.proposal('gamma-tool')).status_code, 201)
        admin = self.user('r17_tool_admin', level=3, roles=('admin',), totp=True)
        self.assertEqual(admin.post('/api/admin/tools/submissions/alpha-tool/approve',
                                    headers=self.write_headers()).status_code, 200)

        response = mine.get('/api/tools/mine/submissions')
        self.assertEqual(response.status_code, 200, response.text)
        rows = {row['slug']: row for row in response.json()['data']}
        self.assertEqual({slug: row['status'] for slug, row in rows.items()},
                         {'alpha-tool': 'active', 'beta-tool': 'pending_review'})
        self.assertIsNotNone(rows['alpha-tool']['approved_at'])
        self.assertIsNone(rows['beta-tool']['approved_at'])
        self.assertNotIn('submitted_by', rows['alpha-tool'])
        self.assertEqual([row['slug'] for row in other.get('/api/tools/mine/submissions').json()['data']],
                         ['gamma-tool'])

    def test_requires_login_and_does_not_collide_with_detail(self):
        self.assertEqual(self.client().get('/api/tools/mine/submissions').status_code, 401)
        member = self.user('r17_tool_empty')
        self.assertEqual(member.get('/api/tools/mine/submissions').json()['data'], [])
        self.assertEqual(member.get('/api/tools/mine').status_code, 404)


if __name__ == '__main__':
    unittest.main()
