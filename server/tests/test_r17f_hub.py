"""R17-F · 实战工坊、合作机会、共同项目、组织星图的只读聚合接口。"""
import unittest
import uuid

from app import objects
from tests.helpers import AppCase, HDRS


def hdr():
    return {**HDRS, 'Idempotency-Key': uuid.uuid4().hex}


class HubCase(AppCase):
    def make_org(self, owner, slug, join_policy='apply', name=None):
        response = owner.post('/api/orgs', headers=HDRS, json={
            'name': name or f'团队-{slug}', 'intro': '一起做可复现的作品。', 'type': 'lab', 'slug': slug,
            'join_policy': join_policy})
        self.assertEqual(response.status_code, 201, response.text)
        item = response.json()['data']
        governor = self.user('gov_' + slug.replace('-', '_'), level=5, roles=('governor',), totp=True)
        reviewed = governor.post(f'/api/admin/orgs/applications/{item["id"]}/review', headers=HDRS,
                                 json={'decision': 'approve', 'note': '资料完整'})
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        return item

    def join(self, owner, slug, person, show_on_profile=True):
        response = person.post(f'/api/orgs/{slug}/join', headers=HDRS,
                               json={'note': '', 'show_on_profile': show_on_profile})
        self.assertEqual(response.status_code, 200, response.text)
        done = owner.post(f'/api/orgs/{slug}/applications/{person.pid}/review', headers=HDRS,
                          json={'decision': 'approve'})
        self.assertEqual(done.status_code, 200, done.text)

    def attach_work(self, member, slug, title='团队作品', **over):
        work = self.obj(member, type='work', title=title, **over)
        response = member.post(f'/api/orgs/{slug}/works/{work["id"]}', headers=HDRS)
        self.assertEqual(response.status_code, 200, response.text)
        return work['id']

    def flag(self, key, enabled):
        with self.db.write() as conn:
            conn.execute('UPDATE feature_flag SET enabled = ? WHERE key = ?', (int(enabled), key))

    def hub(self, client, name, status=200):
        response = client.get(f'/api/orgs/hub/{name}')
        self.assertEqual(response.status_code, status, response.text)
        return response.json()


class OpportunitiesTest(HubCase):
    def setUp(self):
        super().setUp()
        self.owner = self.user('r17f_owner', level=3)
        self.make_org(self.owner, 'hire-team', name='招人实验室')
        self.make_org(self.owner, 'closed-team', join_policy='invite')
        self.poster = self.user('r17f_poster', level=2)

    def listing(self, category, **fields):
        body = {'category': category, 'title': fields.pop('title'), 'body': '细节见正文。', **fields}
        response = self.poster.post('/api/market/listings', headers=hdr(), json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['data']['id']

    def test_collects_collab_jobs_and_recruiting_teams(self):
        collab = self.listing('collab', title='找人做检索评测', budget='¥3000', cycle='两周')
        job = self.listing('jobs', title='招 Agent 工程师', company='招人实验室', position='工程师', city='杭州')
        viewer = self.user('r17f_viewer')
        reply = self.hub(viewer, 'opportunities')
        items = {item['id']: item for item in reply['data']}
        self.assertEqual(items[collab]['kindLabel'], '合作与外包')
        self.assertEqual({f['label']: f['value'] for f in items[collab]['facts']}, {'预算': '¥3000', '周期': '两周'})
        self.assertEqual(items[collab]['href'], f'#/market/{collab}')
        self.assertIsNone(items[job]['orgSlug'], '发帖人不是该团队成员，company 重名不能挂团队主页')
        teams = [item for item in reply['data'] if item['kind'] == 'team']
        self.assertEqual([t['orgSlug'] for t in teams], ['hire-team'])
        self.assertEqual(reply['meta']['sources'], {'collab': 'ok', 'jobs': 'ok', 'team': 'ok'})

    def test_company_link_requires_poster_to_be_an_active_member(self):
        job = self.listing('jobs', title='招 Agent 工程师', company='招人实验室', position='工程师', city='杭州')
        viewer = self.user('r17f_viewer_m')
        slug_of = lambda: {i['id']: i for i in self.hub(viewer, 'opportunities')['data']}[job]['orgSlug']
        self.assertIsNone(slug_of(), '冒充：非成员发帖')
        # 申请中（pending）还不算成员
        applicant = self.poster
        response = applicant.post('/api/orgs/hire-team/join', headers=HDRS, json={'note': '', 'show_on_profile': True})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(slug_of(), '申请中不算成员')
        done = self.owner.post(f'/api/orgs/hire-team/applications/{applicant.pid}/review', headers=HDRS,
                               json={'decision': 'approve'})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(slug_of(), 'hire-team', 'active 成员发帖才挂团队主页')

    def test_company_link_for_team_owner(self):
        owner_job = self.owner_listing('招 Agent 工程师', '招人实验室')
        viewer = self.user('r17f_viewer_o')
        items = {i['id']: i for i in self.hub(viewer, 'opportunities')['data']}
        self.assertEqual(items[owner_job]['orgSlug'], 'hire-team', '团队所有者发帖可以挂')

    def owner_listing(self, title, company):
        response = self.owner.post('/api/market/listings', headers=hdr(), json={
            'category': 'jobs', 'title': title, 'body': '细节见正文。', 'company': company,
            'position': '工程师', 'city': '杭州'})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['data']['id']

    def test_other_market_categories_are_left_out(self):
        self.listing('sell', title='卖显卡', condition='九成新', price='¥3,200', city='杭州', shipping='可邮寄')
        reply = self.hub(self.user('r17f_viewer2'), 'opportunities')
        self.assertEqual([item['kind'] for item in reply['data']], ['team'])

    def test_market_off_keeps_teams_and_marks_the_source(self):
        self.listing('collab', title='外包一个爬虫', budget='¥500', cycle='一周')
        self.flag('market.enabled', False)
        reply = self.hub(self.user('r17f_viewer3'), 'opportunities')
        self.assertEqual([item['kind'] for item in reply['data']], ['team'])
        self.assertEqual(reply['meta']['sources']['collab'], 'unavailable')
        self.assertEqual(reply['meta']['sources']['team'], 'ok')

    def test_requires_login_and_hides_blocked_owner_team(self):
        self.assertEqual(self.client().get('/api/orgs/hub/opportunities').status_code, 401)
        viewer = self.user('r17f_blocker')
        with self.db.write() as conn:
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (viewer.pid, self.owner.pid, '2026-10-28T08:00:00.000000Z'))
        self.assertEqual(self.hub(viewer, 'opportunities')['data'], [])


class ProjectsTest(HubCase):
    def setUp(self):
        super().setUp()
        self.owner = self.user('r17f_pown', level=3)
        self.make_org(self.owner, 'work-team')
        self.make_org(self.owner, 'empty-team')

    def test_only_teams_with_visible_works_are_projects(self):
        first = self.attach_work(self.owner, 'work-team', '检索评测台')
        self.attach_work(self.owner, 'work-team', '私密作品', visibility='named', acl=[self.owner.pid])
        viewer = self.user('r17f_pview')
        data = self.hub(viewer, 'projects')['data']
        self.assertEqual([row['org']['slug'] for row in data], ['work-team'])
        self.assertEqual(data[0]['workCount'], 1)
        self.assertEqual([w['id'] for w in data[0]['works']], [first])
        self.assertEqual(data[0]['works'][0]['authorHandle'], 'r17f_pown')
        mine = self.hub(self.owner, 'projects')['data']
        self.assertEqual(mine[0]['workCount'], 2)

    def test_no_works_means_empty_list_not_fake_rows(self):
        self.assertEqual(self.hub(self.user('r17f_pview2'), 'projects')['data'], [])
        self.assertEqual(self.client().get('/api/orgs/hub/projects').status_code, 401)


class WorkshopTest(HubCase):
    def event(self, kind, status, slug):
        stamp = '2026-10-28T08:00:00.000000Z'
        with self.db.write() as conn:
            conn.execute(
                'INSERT INTO community_event (id, slug, kind, title, summary, starts_at, ends_at, status, host_name, '
                'created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (str(uuid.uuid4()), slug, kind, f'{slug} 活动', '动手做一个小东西', '2026-10-28T09:00:00.000000Z',
                 '2026-10-30T09:00:00.000000Z', status, '陈墨', stamp, stamp))

    def skill(self, author, title, active=True):
        body = {'type': 'skill', 'title': title, 'category': '编程', 'tags': ['验证'], 'clients_or_stacks': ['Codex'],
                'license': '示例', 'content': {'purpose': '让改动可核验', 'skill_md': '# Verify'},
                'examples': [{'input': '检查接口', 'output': '通过'}], 'installs': [{'client': 'Codex', 'instructions': '复制'}]}
        response = author.post('/api/library/items', headers=HDRS, json=body)
        self.assertEqual(response.status_code, 201, response.text)
        item_id = response.json()['data']['id']
        if active:
            with self.db.write() as conn:
                objects.set_lifecycle(conn, author.pid, item_id, 'active', 'test_publish')
                conn.execute("UPDATE lib_item SET status = 'active' WHERE object_id = ?", (item_id,))
        return item_id

    def test_lists_practice_events_and_active_skills_only(self):
        self.event('camp', 'live', 'camp-live')
        self.event('challenge', 'upcoming', 'challenge-soon')
        self.event('camp', 'ended', 'camp-old')
        self.event('meetup', 'live', 'meetup-live')
        author = self.user('r17f_skill_author', level=2)
        shown = self.skill(author, '验证改动')
        self.skill(author, '还在审核', active=False)
        reply = self.hub(self.user('r17f_wview'), 'workshop')
        data = reply['data']
        self.assertEqual(sorted(event['title'] for event in data['events']), ['camp-live 活动', 'challenge-soon 活动'])
        self.assertEqual([skill['id'] for skill in data['skills']], [shown])
        self.assertEqual(data['skills'][0]['purpose'], '让改动可核验')
        self.assertEqual(data['skills'][0]['href'], f'#/skills/{shown}')
        self.assertEqual(reply['meta']['sources'], {'events': 'ok', 'skills': 'ok'})

    def test_empty_when_nothing_exists_and_sources_say_so_when_off(self):
        viewer = self.user('r17f_wview2')
        reply = self.hub(viewer, 'workshop')
        self.assertEqual(reply['data'], {'events': [], 'skills': []})
        self.flag('events.enabled', False)
        self.flag('library.enabled', False)
        off = self.hub(viewer, 'workshop')
        self.assertEqual(off['meta']['sources'], {'events': 'unavailable', 'skills': 'unavailable'})
        self.assertEqual(self.client().get('/api/orgs/hub/workshop').status_code, 401)


class ConstellationTest(HubCase):
    def test_graph_has_public_members_and_visible_works_only(self):
        owner = self.user('r17f_cown', level=3)
        self.make_org(owner, 'star-team')
        shy, open_ = self.user('r17f_shy'), self.user('r17f_open')
        self.join(owner, 'star-team', shy, show_on_profile=False)
        self.join(owner, 'star-team', open_, show_on_profile=True)
        work = self.attach_work(owner, 'star-team', '星图作品')
        self.attach_work(owner, 'star-team', '私密', visibility='named', acl=[owner.pid])
        self.make_org(owner, 'void-team')  # 只有所有者、没有作品：仍是一颗孤星

        viewer = self.user('r17f_cview')
        data = self.hub(viewer, 'constellation')['data']
        self.assertEqual([org['slug'] for org in data], ['star-team', 'void-team'])
        org = data[0]
        self.assertEqual(data[1]['works'], [])
        self.assertEqual([p['handle'] for p in data[1]['people']], ['r17f_cown'])
        self.assertEqual({p['handle'] for p in org['people']}, {'r17f_cown', 'r17f_open'})
        self.assertEqual([w['id'] for w in org['works']], [work])
        self.assertEqual(org['works'][0]['authorId'], owner.pid)
        self.assertEqual(self.client().get('/api/orgs/hub/constellation').status_code, 401)

    def test_hub_and_mine_cannot_be_team_addresses(self):
        owner = self.user('r17f_reserved', level=3)
        for slug in ('hub', 'mine'):
            response = owner.post('/api/orgs', headers=HDRS, json={
                'name': f'占位-{slug}', 'intro': '一起做可复现的作品。', 'type': 'lab', 'slug': slug,
                'join_policy': 'apply'})
            self.assertEqual(response.status_code, 422, (slug, response.text))
        self.assertEqual(self.db.conn().execute("SELECT count(*) FROM org WHERE slug IN ('hub','mine')").fetchone()[0], 0)
        ok = owner.post('/api/orgs', headers=HDRS, json={
            'name': '近似名', 'intro': '一起做可复现的作品。', 'type': 'lab', 'slug': 'hub-team', 'join_policy': 'apply'})
        self.assertEqual(ok.status_code, 201, ok.text)

    def test_route_is_not_swallowed_by_slug_detail(self):
        self.assertEqual(self.hub(self.user('r17f_cview2'), 'constellation')['data'], [])


if __name__ == '__main__':
    unittest.main()
