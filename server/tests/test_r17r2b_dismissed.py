"""R17-R2b：已关闭推荐人由服务端提供，公开字段、拉黑过滤、分页和恢复。"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

from tests.helpers import AppCase, HDRS
from tests.test_r17h_frontend import COMMON as H_COMMON, SOCIAL

ROOT = Path(__file__).resolve().parents[2]


class DismissedSuggestionsApiTest(AppCase):
    def dismiss(self, client, handle):
        response = client.post(f'/api/social/suggestions/{handle}/dismiss', headers=HDRS)
        self.assertEqual(response.status_code, 200, response.text)

    def test_only_own_public_unblocked_records(self):
        owner = self.user('r2b_owner')
        first = self.user('r2b_first', level=2)
        second = self.user('r2b_second')
        other = self.user('r2b_other')
        self.dismiss(owner, 'r2b_first')
        self.dismiss(owner, 'r2b_second')
        self.dismiss(other, 'r2b_first')
        with self.db.write() as conn:
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (first.pid, owner.pid, '2026-10-28T00:00:00.000000Z'))
        response = owner.get('/api/social/suggestions/dismissed')
        self.assertEqual(response.status_code, 200, response.text)
        items = response.json()['data']['items']
        self.assertEqual([row['id'] for row in items], [second.pid])
        self.assertEqual(set(items[0]), {'id', 'handle', 'display_name', 'level', 'avatar', 'dismissed_at'})
        self.assertNotIn('status', items[0])
        self.assertNotIn('reason', items[0])
        other_items = other.get('/api/social/suggestions/dismissed').json()['data']['items']
        self.assertEqual([row['id'] for row in other_items], [first.pid])
        self.assertEqual(self.client().get('/api/social/suggestions/dismissed').status_code, 401)

    def test_keyset_pagination_and_both_block_directions(self):
        owner = self.user('r2b_page_owner')
        targets = [self.user(f'r2b_page_{i}') for i in range(3)]
        for index, target in enumerate(targets):
            self.dismiss(owner, f'r2b_page_{index}')
        seen = []
        cursor = None
        for page in range(3):
            query = {'limit': 1}
            if cursor:
                query['cursor'] = cursor
            response = owner.get('/api/social/suggestions/dismissed', params=query)
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            self.assertEqual(len(body['data']['items']), 1)
            seen.append(body['data']['items'][0]['id'])
            cursor = body['meta'].get('cursor')
            if page < 2:
                self.assertTrue(cursor)
        self.assertEqual(len(set(seen)), 3)
        self.assertFalse(cursor)
        with self.db.write() as conn:
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (owner.pid, targets[0].pid, '2026-10-28T00:00:00.000000Z'))
            conn.execute('INSERT INTO social_block (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
                         (targets[1].pid, owner.pid, '2026-10-28T00:00:00.000000Z'))
        items = owner.get('/api/social/suggestions/dismissed').json()['data']['items']
        self.assertEqual([row['id'] for row in items], [targets[2].pid])


class R17R2BFrontend(unittest.TestCase):
    def run_js(self, script):
        result = subprocess.run(['node', '-e', H_COMMON + SOCIAL + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def test_server_list_restore_and_no_local_mirror(self):
        self.run_js(r'''
(async()=>{
 const carol={id:'p9',handle:'carol',display_name:'卡罗',level:1,avatar:null,dismissed_at:'2026-10-28T00:00:00.000000Z'};
 const c=socialCtx(c=>{c.routes['GET /social/suggestions/dismissed']={data:{items:[carol]},meta:{cursor:null}};});await tick();
 c.rootN=c.document.querySelector('[data-soc-root]');c.location.hash='#/friends/suggest';c.rootN.innerHTML=c.CommonsSocial.routes.friends();
 assert.ok(c.rootN.innerHTML.includes('已关闭的推荐人')&&c.rootN.innerHTML.includes('卡罗'),'server row is rendered');
 assert.ok(c.writes.every(x=>!JSON.stringify(x.v).includes('dismissedLive')),'no browser mirror is written');
 c.routes['GET /social/suggestions/dismissed']={data:{items:[]},meta:{cursor:null}};
 click(c,socBtn('suggest-restore','p9'));await tick();
 assert.equal(find(c,'DELETE','/social/suggestions/carol/dismiss').length,1);
 assert.ok(!c.rootN.innerHTML.includes('已关闭的推荐人'),'restored row disappears after server reload');
 console.log('_PASS r2b-server-restore');
})().catch(bail);
''')

    def test_server_pagination_appends(self):
        self.run_js(r'''
(async()=>{
 const first={id:'p1',handle:'first',display_name:'第一人',level:1,avatar:null,dismissed_at:'2026-10-28T00:00:00.000000Z'};
 const second={id:'p2',handle:'second',display_name:'第二人',level:2,avatar:null,dismissed_at:'2026-10-27T00:00:00.000000Z'};
 const c=socialCtx(c=>{c.routes['GET /social/suggestions/dismissed']=q=>q&&q.cursor==='c1'
  ?{data:{items:[second]},meta:{cursor:null}}
  :{data:{items:[first]},meta:{cursor:'c1'}};});await tick();
 c.rootN=c.document.querySelector('[data-soc-root]');c.location.hash='#/friends/suggest';c.rootN.innerHTML=c.CommonsSocial.routes.friends();
 assert.ok(c.rootN.innerHTML.includes('suggest-dismissed-more'));
 click(c,socBtn('suggest-dismissed-more'));await tick();
 const calls=find(c,'GET','/social/suggestions/dismissed');
 assert.ok(calls.some(x=>x.body&&x.body.cursor==='c1'),'next page uses server cursor');
 assert.ok(c.rootN.innerHTML.includes('第一人')&&c.rootN.innerHTML.includes('第二人'),'both pages are present');
 console.log('_PASS r2b-server-pagination');
})().catch(bail);
''')

    def test_dismissed_source_has_no_sample_or_local_mirror(self):
        source = (ROOT / 'preview/social.js').read_text()
        self.assertNotIn('dismissedLive', source)
        helper = source.split('function dismissedPeople()', 1)[1].split('function mergeDismissed', 1)[0]
        self.assertNotIn('SAMPLE()', helper)
        self.assertIn("fetchPaged('/social/suggestions/dismissed'", source)


if __name__ == '__main__':
    unittest.main()
