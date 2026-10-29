"""LG-6C R9: third-party complaints get their own count in the admin overview (to-do + card)."""
from tests.helpers import HDRS, AppCase

BASE = '/api/admin/admin'
SECRET_TEXT = '第三方作品被转载，请人工核查-SECRET'


class ComplaintOverviewTest(AppCase):
    def overview(self, admin):
        response = admin.get(BASE + '/overview')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def complain(self, client, **changes):
        body = {'locator': '#/threads/external', 'category': 'copyright', 'statement': SECRET_TEXT}
        body.update(changes)
        response = client.post('/api/governance/complaints', headers=HDRS, json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['data']['id']

    def complaint_todos(self, data):
        return [todo for todo in data['todos'] if todo['key'] == 'gov_complaint']

    def test_pending_complaints_have_their_own_card_and_todo(self):
        admin = self.user('root', roles=['admin'], totp=True)
        data = self.overview(admin)
        self.assertEqual((data['cards']['complaints_pending']['value'], data['cards']['complaints_pending']['status']), (0, 'ok'))
        self.assertEqual(self.complaint_todos(data), [])

        anon = self.client()
        first, second = self.complain(anon), self.complain(anon, category='privacy')
        data = self.overview(admin)
        self.assertEqual(data['cards']['complaints_pending']['value'], 2)
        self.assertEqual(data['cards']['reports_pending']['value'], 0, 'complaints are not folded into report counts')
        todo, = self.complaint_todos(data)
        self.assertEqual((todo['count'], todo['urgency'], todo['link']), (2, 'normal', '#/govern?tab=complaints'))
        self.assertEqual(todo['title'], '第三方投诉待处理')
        self.assertTrue(todo['oldest_at'])
        self.assertEqual([t['key'] for t in data['todos'] if t['key'].startswith('gov_') and t['key'] != 'gov_complaint'], [])
        self.assertNotIn(SECRET_TEXT, str(data))

        governor = self.user('gov', roles=['governor'], totp=True)
        decide = lambda cid, state: governor.post(  # noqa: E731
            f'/api/governance/complaints/{cid}/decide', headers=dict(HDRS, **{'Idempotency-Key': 'k-' + cid}),
            json={'state': state, 'reason': '已核对'})
        self.assertEqual(decide(first, 'reviewed').status_code, 200)
        data = self.overview(admin)
        self.assertEqual((data['cards']['complaints_pending']['value'], self.complaint_todos(data)[0]['count']), (1, 1))
        self.assertEqual(decide(second, 'dismissed').status_code, 200)
        data = self.overview(admin)
        self.assertEqual(data['cards']['complaints_pending']['value'], 0)
        self.assertEqual(self.complaint_todos(data), [])

    def test_report_cases_do_not_change_the_complaint_count(self):
        admin = self.user('root', roles=['admin'], totp=True)
        author, reporter = self.user('author'), self.user('reporter', level=2)
        post = self.obj(author)
        self.assertIn(reporter.post('/api/governance/reports', headers=HDRS,
                                    json={'target_id': post['id'], 'reason_code': 'spam', 'note': ''}).status_code, (200, 201))
        data = self.overview(admin)
        self.assertEqual((data['cards']['reports_pending']['value'], data['cards']['complaints_pending']['value']), (1, 0))
        self.assertEqual(self.complaint_todos(data), [])

    def test_missing_complaint_table_degrades_instead_of_failing(self):
        admin = self.user('root', roles=['admin'], totp=True)
        with self.db.write() as conn:
            conn.execute('DROP TABLE gov_complaint')
        data = self.overview(admin)
        card = data['cards']['complaints_pending']
        self.assertEqual((card['value'], card['status']), (None, '模块未上线'))
        self.assertEqual(self.complaint_todos(data), [])
