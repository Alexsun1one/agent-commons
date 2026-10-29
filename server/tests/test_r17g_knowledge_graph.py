"""R17-G · 知识网 / 知识治理页的汇总接口 GET /api/governance/knowledge-graph。"""
from app import flags
from modules.kb.tests import test_kb
from tests.helpers import HDRS, AppCase


class KnowledgeGraphTest(AppCase):
    problem = test_kb.KBApiTest.problem

    def link(self, who, source, target, kind):
        r = who.post(f"/api/kb/problems/{source['id']}/links", headers=HDRS, json={'target_id': target['id'], 'kind': kind})
        self.assertEqual(r.status_code, 201, r.text)

    def graph(self, who):
        r = who.get('/api/governance/knowledge-graph')
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['data']

    def test_nodes_links_and_attention(self):
        author = self.user('r17g_kg_a', level=2)
        reader = self.user('r17g_kg_b')
        canon = self.problem(author, title='标准问题', error_signature='canon error 1')
        dup = self.problem(author, title='重复问题', error_signature='dup error 2')
        old = self.problem(author, title='旧办法', error_signature='old error 3')
        new = self.problem(author, title='新办法', error_signature='new error 4')
        rel = self.problem(author, title='相关问题', error_signature='rel error 5')
        self.link(author, dup, canon, 'duplicate')
        self.link(author, old, new, 'replacement')
        self.link(author, rel, canon, 'related')
        with self.db.write() as conn:
            conn.execute("UPDATE kb_problem SET stale_hint = 1 WHERE object_id = ?", (rel['id'],))
            conn.execute("UPDATE kb_problem SET status = 'stale' WHERE object_id = ?", (old['id'],))
            conn.execute("UPDATE kb_problem SET created_at = '2020-01-01T00:00:00.000000Z' WHERE object_id = ?", (canon['id'],))
        data = self.graph(reader)
        self.assertEqual({n['id'] for n in data['nodes']}, {canon['id'], dup['id'], old['id'], new['id'], rel['id']})
        node = {n['id']: n for n in data['nodes']}
        self.assertEqual(node[canon['id']]['tools'], ['codex'])
        self.assertEqual({(l['from'], l['to'], l['kind']) for l in data['links']},
                         {(dup['id'], canon['id'], 'duplicate'), (old['id'], new['id'], 'replacement'),
                          (rel['id'], canon['id'], 'related')})
        reasons = {(a['id'], a['reason']) for a in data['attention']}
        self.assertEqual(reasons, {(old['id'], 'stale'), (rel['id'], 'stale_hint'), (canon['id'], 'pending_long'),
                                   (dup['id'], 'duplicate'), (old['id'], 'replaced')})
        s = data['summary']
        self.assertEqual((s['total'], s['shown'], s['truncated']), (5, 5, False))
        self.assertEqual((s['pending'], s['stale'], s['stale_hint']), (4, 1, 1))

    def test_invisible_problem_and_its_links_are_left_out(self):
        author = self.user('r17g_kg_c', level=2)
        outsider = self.user('r17g_kg_d')
        shown = self.problem(author, title='公开问题', error_signature='shown err 1')
        hidden = self.problem(author, title='私有问题', error_signature='hidden err 2', visibility='named', acl=[author.pid])
        self.link(author, hidden, shown, 'related')
        data = self.graph(outsider)
        self.assertEqual([n['id'] for n in data['nodes']], [shown['id']])
        self.assertEqual(data['links'], [])
        self.assertNotIn('私有问题', repr(data))
        self.assertEqual(self.graph(author)['summary']['total'], 2)

    def test_empty_login_and_switches(self):
        member = self.user('r17g_kg_e')
        data = self.graph(member)
        self.assertEqual((data['nodes'], data['links'], data['attention']), ([], [], []))
        self.assertEqual(data['summary']['total'], 0)
        self.assertEqual(self.client().get('/api/governance/knowledge-graph').status_code, 401)
        with self.db.write() as conn:
            flags.set_flag(conn, 'kb.enabled', False, None)
        self.assertEqual(self.code(member.get('/api/governance/knowledge-graph')), 'capability_unavailable')
