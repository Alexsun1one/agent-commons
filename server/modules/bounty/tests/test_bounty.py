import sqlite3
import unittest
import uuid
from contextlib import contextmanager
from unittest import mock

from app import clock, flags, ledger, objects, outbox, worker
from app.authz import Actor
from modules.bounty import jobs, logic, service
from tests.helpers import HDRS, AppCase

DAY = 86400


def key():
    return uuid.uuid4().hex


def hdr(k=None):
    return {**HDRS, 'Idempotency-Key': k or key()}


class BountyCase(AppCase):
    def setUp(self):
        super().setUp()
        with self.db.write() as conn:
            flags.set_flag(conn, 'bounty.enabled', True, None)
            flags.set_flag(conn, 'bounty.promo.enabled', True, None)

    # ---- 夹具 ----

    def code(self, response):
        body = response if isinstance(response, dict) else response.json()
        return body['error']['code']

    def post(self, client, title='求助：向量检索怎么调', **kw):
        return self.obj(client, title=title, content={'body': '正文', 'tags': ['检索']}, **kw)['id']

    def reply(self, client, root_id, body='我的回答'):
        return self.obj(client, type='reply', title='回答', content={'body': body}, root_id=root_id)['id']

    def wallet(self, client):
        r = client.get('/api/bounty/wallet')
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['data']

    def create(self, client, object_id, credits=30, days=1, status=201, kind='help', rewards=None, k=None):
        if rewards is None:
            rewards = [{'type': 'credits', 'amount': credits}] if kind == 'help' else []
        r = client.post('/api/bounty', headers=hdr(k), json={'kind': kind, 'object_id': object_id, 'days': days,
                                                             'rewards': rewards})
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 201 else r.json()

    def detail(self, client, bounty_id):
        r = client.get(f'/api/bounty/{bounty_id}')
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['data']

    def age(self, pid, days=10):
        with self.db.write() as conn:
            conn.execute('UPDATE principal SET created_at = ? WHERE id = ?', (clock.iso(clock.now_ts() - days * DAY), pid))

    def dispatch(self):
        mine = [c for c in outbox.CONSUMERS if c[0].startswith('bounty.')]
        with mock.patch.object(outbox, 'CONSUMERS', mine):
            while outbox.dispatch(self.db):
                pass

    def mark(self, marker_pid, answer_id):
        with self.db.write() as conn:
            outbox.emit(conn, 'content.useful_marked', 'object', answer_id,
                        {'object_id': answer_id, 'marker_id': marker_pid}, actor_id=marker_pid)
        self.dispatch()

    @contextmanager
    def later(self, seconds):
        real = clock.now_ts
        with mock.patch.object(clock, 'now_ts', lambda: real() + seconds):
            yield

    def events(self, event_type):
        return self.db.conn().execute('SELECT * FROM outbox_event WHERE event_type = ? ORDER BY occurred_at',
                                      (event_type,)).fetchall()

    def ledger_count(self):
        return self.db.conn().execute('SELECT count(*) FROM ledger_entry').fetchone()[0]


class EscrowTest(BountyCase):
    def test_escrow_balance_correct_and_never_negative(self):
        owner = self.user('owner', level=2)
        self.assertEqual((self.wallet(owner)['available'], self.wallet(owner)['held']), (100, 0))
        data = self.create(owner, self.post(owner), credits=30)
        self.assertEqual((data['credits'], data['held'], data['status']), (30, 30, 'active'))
        w = self.wallet(owner)
        self.assertEqual((w['available'], w['held']), (70, 30))
        self.assertEqual([e['kind'] for e in w['entries']], ['hold', 'grant'])

        rich = self.user('rich', level=3)
        before = self.wallet(rich)
        self.assertEqual(self.code(self.create(rich, self.post(rich), credits=150, status=409)), 'credits_insufficient')
        self.assertEqual(self.wallet(rich)['available'], before['available'])

        with self.assertRaises(sqlite3.DatabaseError):
            with self.db.write() as conn:
                conn.execute("INSERT INTO credit_entry (id, principal_id, kind, amount, held_delta, bounty_id, source_type, "
                             "season, idempotency_key, created_at) VALUES ('x', ?, 'hold', -500, 500, ?, 'bounty', 's', 'k', ?)",
                             (owner.pid, data['id'], clock.now()))
        for sql in ('UPDATE credit_entry SET amount = 999', 'DELETE FROM credit_entry'):
            with self.assertRaises(sqlite3.DatabaseError):
                with self.db.write() as conn:
                    conn.execute(sql)
        row = self.db.conn().execute('SELECT min(s) FROM (SELECT sum(amount) AS s FROM credit_entry '
                                     'GROUP BY principal_id)').fetchone()
        self.assertGreaterEqual(row[0], 0)

    def test_topup_and_split_award(self):
        owner, topper = self.user('owner', level=2), self.user('topper', level=3)
        a1, a2 = self.user('ans1'), self.user('ans2')
        post_id = self.post(owner)
        bounty = self.create(owner, post_id, credits=50)
        r = topper.post(f"/api/bounty/{bounty['id']}/topup", headers=hdr(), json={'amount': 40})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()['data']['credits'], r.json()['data']['contributors']), (90, 2))
        self.assertEqual(self.wallet(topper)['held'], 40)
        r1, r2 = self.reply(a1, post_id), self.reply(a2, post_id)
        own = self.reply(owner, post_id, '我自己补一句')

        picks = {'picks': [{'answer_id': r1, 'share': 70}, {'answer_id': r2, 'share': 30}]}
        self.assertEqual(topper.post(f"/api/bounty/{bounty['id']}/award", headers=hdr(), json=picks).status_code, 403)
        bad = {'picks': [{'answer_id': own, 'share': 100}]}
        r = owner.post(f"/api/bounty/{bounty['id']}/award", headers=hdr(), json=bad)
        self.assertEqual((r.status_code, r.json()['error']['message']), (422, '不能发给自己'))
        r = owner.post(f"/api/bounty/{bounty['id']}/award", headers=hdr(),
                       json={'picks': [{'answer_id': r1, 'share': 70}, {'answer_id': r2, 'share': 20}]})
        self.assertEqual(self.code(r), 'validation_failed')

        r = owner.post(f"/api/bounty/{bounty['id']}/award", headers=hdr(), json=picks)
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()['data']
        self.assertEqual((data['state'], data['held'], r.json()['meta']['awarded']), ('awarded', 0, 90))
        self.assertEqual(sorted(a['credits'] for a in data['awards']), [27, 63])
        self.assertEqual(self.wallet(a1)['available'], 63)
        self.assertEqual(self.wallet(a2)['available'], 27)
        self.assertEqual((self.wallet(owner)['held'], self.wallet(topper)['held']), (0, 0))
        self.assertEqual(self.wallet(topper)['available'], 60)
        r = topper.post(f"/api/bounty/{bounty['id']}/topup", headers=hdr(), json={'amount': 5})
        self.assertEqual(self.code(r), 'state_conflict')


class SettlementTest(BountyCase):
    def test_deadline_auto_awards_most_qualified_useful(self):
        owner, u1, u2 = self.user('owner', level=2), self.user('usr_u1'), self.user('usr_u2')
        q1, q2, q3 = self.user('usr_q1', level=2), self.user('usr_q2', level=3), self.user('usr_q3', level=2)
        n1, n2, fresh = self.user('usr_n1', level=1), self.user('usr_n2', level=1), self.user('fresh', level=2)
        for c in (q1, q2, q3, n1, n2):
            self.age(c.pid)
        post_id = self.post(owner)
        bounty = self.create(owner, post_id, credits=40, days=1)
        a1, a2 = self.reply(u1, post_id), self.reply(u2, post_id)
        own = self.reply(owner, post_id)
        self.mark(q1.pid, a1)
        with self.db.write() as conn:
            ledger.record(conn, event_type='useful', subject_id=u1.pid, points=5, rule_version='t1',
                          idempotency_key=f'useful:{q2.pid}:{a1}', source_ref=f'object:{a1}', actor_id=q2.pid)
        self.dispatch()
        for c in (n1, n2, fresh, q3):
            self.mark(c.pid, a2)
        for c in (q1, q2, q3):
            self.mark(c.pid, own)
        self.assertEqual(self.detail(owner, bounty['id'])['useful'], {a1: 2, a2: 1, own: 3})

        with self.later(DAY + 3600):
            d = self.detail(owner, bounty['id'])
            self.assertEqual((d['status'], d['state']), ('judging', 'open'))
        with self.later(DAY + 72 * 3600 + 60):
            d = self.detail(u2, bounty['id'])
            self.assertEqual((d['status'], d['state'], d['settle_reason']), ('closed', 'awarded', 'auto'))
            self.assertEqual([(a['answer_id'], a['credits'], a['mode']) for a in d['awards']], [(a1, 40, 'auto')])
            self.assertEqual(self.wallet(u1)['available'], 45)
            self.assertEqual(self.wallet(owner)['held'], 0)

    def test_no_qualified_answer_refunds_each_contributor(self):
        owner, topper, u1, n1 = (self.user('owner', level=2), self.user('topper', level=3), self.user('usr_u1'),
                                 self.user('usr_n1', level=1))
        post_id = self.post(owner)
        bounty = self.create(owner, post_id, credits=30)
        self.assertEqual(topper.post(f"/api/bounty/{bounty['id']}/topup", headers=hdr(),
                                     json={'amount': 20}).status_code, 200)
        a1 = self.reply(u1, post_id)
        self.age(n1.pid)
        self.mark(n1.pid, a1)
        with self.later(DAY + 72 * 3600 + 60):
            w = self.wallet(owner)
            self.assertEqual((w['available'], w['held']), (100, 0))
            self.assertEqual(self.wallet(topper)['available'], 100)
            d = self.detail(owner, bounty['id'])
            self.assertEqual((d['state'], d['settle_reason'], d['awards']), ('refunded', 'no_qualified', []))
            self.assertEqual(self.wallet(u1)['available'], 0)
        refunds = self.db.conn().execute("SELECT principal_id, amount FROM credit_entry WHERE kind = 'refund' "
                                         'ORDER BY amount').fetchall()
        self.assertEqual([(r[0], r[1]) for r in refunds], [(topper.pid, 20), (owner.pid, 30)])

    def test_be1_useful_event_shape_is_captured(self):
        owner, u1, n1 = self.user('owner', level=2), self.user('usr_u1'), self.user('usr_n1', level=2)
        post_id = self.post(owner)
        a1 = self.reply(u1, post_id)
        with self.db.write() as conn:
            outbox.emit(conn, 'content.useful_marked', 'object', a1, {'counted': True}, actor_id=n1.pid)
        self.dispatch()
        row = self.db.conn().execute('SELECT marker_id, source FROM bounty_useful_mark WHERE object_id = ?',
                                     (a1,)).fetchone()
        self.assertEqual(tuple(row), (n1.pid, 'content'))

    def test_worker_job_settles_without_reads(self):
        owner = self.user('owner', level=2)
        bounty = self.create(owner, self.post(owner), credits=30)
        self.assertIn('bounty.settle', worker.PERIODIC)
        self.assertEqual(jobs.settle(self.db), 0)
        with self.later(DAY + 72 * 3600 + 60):
            self.assertEqual(jobs.settle(self.db), 1)
            self.assertEqual(jobs.settle(self.db), 0)
        row = self.db.conn().execute('SELECT status, settle_reason FROM bounty WHERE id = ?', (bounty['id'],)).fetchone()
        self.assertEqual(tuple(row), ('refunded', 'no_qualified'))
        self.assertEqual(self.wallet(owner)['available'], 100)

    def test_hidden_or_withdrawn_post_refunds(self):
        owner, topper = self.user('owner', level=3), self.user('topper', level=3)
        hidden_post, gone_post = self.post(owner), self.post(owner, title='另一个求助')
        b1 = self.create(owner, hidden_post, credits=30)
        b2 = self.create(owner, gone_post, credits=20)
        topper.post(f"/api/bounty/{b1['id']}/topup", headers=hdr(), json={'amount': 25})
        with self.db.write() as conn:
            objects.set_lifecycle(conn, None, hidden_post, 'hidden', 'gov_test')
        self.dispatch()
        self.assertEqual(self.db.conn().execute('SELECT status, settle_reason FROM bounty WHERE id = ?',
                                                (b1['id'],)).fetchone()[:], ('cancelled', 'hidden'))
        self.assertEqual(self.wallet(topper)['available'], 100)
        self.assertEqual(self.code(topper.get(f"/api/bounty/{b1['id']}")), 'resource_not_found')
        r = owner.post(f'/api/objects/{gone_post}/withdraw', headers=HDRS, json={})
        self.assertEqual(r.status_code, 200)
        w = self.wallet(owner)
        self.assertEqual((w['available'], w['held']), (100, 0))
        self.assertEqual(self.db.conn().execute('SELECT status FROM bounty WHERE id = ?', (b2['id'],)).fetchone()[0],
                         'cancelled')


class RulesTest(BountyCase):
    def test_level_caps_and_concurrency(self):
        l1, l2, l3 = self.user('usr_l1', level=1), self.user('usr_l2', level=2), self.user('usr_l3', level=3)
        self.assertEqual(self.code(self.create(l1, self.post(l1), credits=10, status=403)), 'action_not_allowed')
        self.assertEqual(self.code(self.create(l2, self.post(l2), credits=51, status=422)), 'bounty_cap_exceeded')
        self.create(l2, self.post(l2), credits=50)
        self.assertEqual(self.code(self.create(l2, self.post(l2), credits=10, status=409)), 'bounty_limit_reached')
        self.create(l2, self.post(l2, type='work'), kind='promo')  # 推广不占求助悬赏的并发名额，只受每周 1 条约束
        for _ in range(3):
            self.create(l3, self.post(l3), credits=10)
        self.assertEqual(self.code(self.create(l3, self.post(l3), credits=10, status=409)), 'bounty_limit_reached')
        target = self.create(l3, self.post(self.user('l3b', level=3)), credits=10, status=403)
        self.assertEqual(self.code(target), 'action_not_allowed')
        other = self.user('owner', level=2)
        b = self.create(other, self.post(other), credits=10)
        self.assertEqual(l2.post(f"/api/bounty/{b['id']}/topup", headers=hdr(), json={'amount': 40}).status_code, 200)
        self.assertEqual(self.code(l2.post(f"/api/bounty/{b['id']}/topup", headers=hdr(), json={'amount': 11})),
                         'bounty_cap_exceeded')
        self.assertEqual(l1.post(f"/api/bounty/{b['id']}/topup", headers=hdr(), json={'amount': 1}).status_code, 403)

    def test_cash_goods_unavailable_and_perk_code_rejected(self):
        owner = self.user('owner', level=2)
        post_id = self.post(owner)
        for kind in ('cash', 'goods'):
            r = self.create(owner, post_id, rewards=[{'type': 'credits', 'amount': 10}, {'type': kind, 'amount': 5}],
                            status=501)
            self.assertEqual(self.code(r), 'capability_unavailable')
        r = self.create(owner, post_id, rewards=[{'type': 'credits', 'amount': 10},
                                                 {'type': 'perk', 'note': '兑换码 AB12-CD34-EF56-GH78'}], status=422)
        self.assertIn('不保存兑换码', r['error']['message'])
        ok = self.create(owner, post_id, rewards=[{'type': 'credits', 'amount': 10},
                                                  {'type': 'cosmetic', 'id': 'lifeline'},
                                                  {'type': 'perk', 'note': '一个月会员'}])
        self.assertEqual((ok['cosmetic'], ok['has_perk']), ('及时雨', True))

    def test_no_member_transfer_endpoint(self):
        routes = sorted((sorted(r.methods)[0], r.path) for r in self.app.routes
                        if getattr(r, 'path', '').startswith('/api/bounty'))
        self.assertTrue(all('transfer' not in p and 'send' not in p and 'gift' not in p for _, p in routes))
        self.assertEqual(len(routes), 14)
        u = self.user('usr_u', level=2)
        for path in ('/api/bounty/transfer', '/api/bounty/wallet/transfer'):
            self.assertIn(u.post(path, headers=hdr(), json={'to': u.pid, 'amount': 1}).status_code, (404, 405))
        kinds = self.db.conn().execute("SELECT sql FROM sqlite_master WHERE name = 'credit_entry'").fetchone()[0]
        self.assertNotIn('transfer', kinds)
        self.assertIn("kind = 'award' AND amount > 0 AND held_delta = 0 AND bounty_id IS NOT NULL", kinds)

    def test_flags_off_is_501(self):
        u = self.user('usr_u', level=2)
        with self.db.write() as conn:
            flags.set_flag(conn, 'bounty.promo.enabled', False, None)
        work = self.post(u, title='推广：我的小工具', type='work')
        self.assertEqual(self.code(self.create(u, work, kind='promo', status=501)), 'capability_unavailable')
        with self.db.write() as conn:
            flags.set_flag(conn, 'bounty.enabled', False, None)
        self.assertEqual(self.code(u.get('/api/bounty/wallet')), 'capability_unavailable')


class EventsTest(BountyCase):
    def test_awarded_event_without_ledger_write_and_pair_rule(self):
        owner, helper = self.user('owner', level=4), self.user('helper')
        awarded = []
        for i in range(3):
            post_id = self.post(owner, title=f'求助 {i}')
            b = self.create(owner, post_id, credits=10)
            answer = self.reply(helper, post_id)
            before = self.ledger_count()
            r = owner.post(f"/api/bounty/{b['id']}/award", headers=hdr(),
                           json={'picks': [{'answer_id': answer, 'share': 100}]})
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(self.ledger_count(), before)
            awarded.append(b['id'])
        events = self.events('bounty.awarded')
        self.assertEqual(len(events), 3)
        import json
        payloads = [json.loads(e['payload_json']) for e in events]
        self.assertEqual([(p['counted'], p['flagged']) for p in payloads], [(True, False), (False, True), (False, True)])
        self.assertEqual(payloads[0]['recipient_id'], helper.pid)
        self.assertEqual(payloads[0]['answer_id'] is not None, True)
        self.assertEqual(len(self.events('bounty.review_requested')), 1)
        self.assertEqual(self.db.conn().execute("SELECT count(*) FROM ledger_entry WHERE event_type LIKE 'bounty%' "
                                                "OR event_type = 'adopted'").fetchone()[0], 0)

    def test_ledger_mirror_reverse_and_violation_clamp(self):
        u = self.user('earner', level=1)
        with self.db.write() as conn:
            first = ledger.record(conn, event_type='adopted', subject_id=u.pid, points=20, rule_version='t',
                                  idempotency_key='adopt:1', season='s2026q4')
        self.dispatch()
        self.assertEqual(self.wallet(u)['available'], 20)
        entry = self.wallet(u)['entries'][0]
        self.assertEqual((entry['kind'], entry['source_type'], entry['ledger_label']), ('grant', 'ledger', '知识被采纳或验证'))
        with self.db.write() as conn:
            ledger.reverse(conn, first, reason='fraud', actor_id=None, idempotency_key='rev:1')
        self.dispatch()
        self.assertEqual(self.wallet(u)['available'], 0)

        v = self.user('violator', level=2)
        owner_post = self.post(v)
        self.create(v, owner_post, credits=50)
        self.assertEqual(self.wallet(v)['available'], 50)
        with self.db.write() as conn:
            ledger.record(conn, event_type='violation', subject_id=v.pid, points=-80, rule_version='t',
                          idempotency_key='vio:1', season='s2026q4')
        self.dispatch()
        w = self.wallet(v)
        self.assertEqual((w['available'], w['held']), (0, 50))
        self.assertEqual(self.db.conn().execute("SELECT count(*) FROM audit_event WHERE action = 'bounty.credit.shortfall'")
                         .fetchone()[0], 1)

    def test_idempotent_replay(self):
        owner = self.user('owner', level=2)
        post_id = self.post(owner)
        k = key()
        body = {'kind': 'help', 'object_id': post_id, 'days': 2, 'rewards': [{'type': 'credits', 'amount': 20}]}
        first = owner.post('/api/bounty', headers=hdr(k), json=body)
        again = owner.post('/api/bounty', headers=hdr(k), json=body)
        self.assertEqual((first.status_code, again.status_code), (201, 201))
        self.assertEqual(again.headers.get('Idempotent-Replayed'), 'true')
        self.assertEqual(first.json()['data']['id'], again.json()['data']['id'])
        self.assertEqual(self.wallet(owner)['held'], 20)
        changed = owner.post('/api/bounty', headers=hdr(k), json={**body, 'days': 3})
        self.assertEqual(self.code(changed), 'idempotency_conflict')
        missing = owner.post('/api/bounty', headers=HDRS, json=body)
        self.assertEqual(self.code(missing), 'precondition_required')
        self.assertEqual(self.db.conn().execute('SELECT count(*) FROM bounty').fetchone()[0], 1)

    def test_invisible_post_is_404(self):
        owner, friend, outsider = self.user('owner', level=3), self.user('friend', level=2), self.user('out', level=3)
        secret = self.post(owner, visibility='named', acl=[friend.pid])
        b = self.create(owner, secret, credits=10)
        missing = outsider.get('/api/bounty/00000000-0000-0000-0000-000000000000').json()['error']
        hidden = outsider.get(f"/api/bounty/{b['id']}").json()['error']
        self.assertEqual((hidden['code'], hidden['message']), (missing['code'], missing['message']))
        self.assertEqual(self.code(outsider.post(f"/api/bounty/{b['id']}/topup", headers=hdr(), json={'amount': 5})),
                         'resource_not_found')
        self.assertEqual(outsider.get('/api/bounty/list').json()['data'], [])
        self.assertEqual([x['id'] for x in friend.get('/api/bounty/list').json()['data']], [b['id']])
        self.assertEqual(self.code(self.create(outsider, secret, credits=10, status=404)), 'resource_not_found')
        self.assertEqual(friend.get(f"/api/bounty/list?object_id={secret}").json()['data'][0]['label'], '求助')


class AgentProviderTest(BountyCase):
    def test_agent_open_lists_visible_active_matching_skills(self):
        owner, viewer = self.user('asker', level=3), self.user('agent_owner', level=2)
        hit = self.create(owner, self.post(owner, title='向量检索召回总漏掉长文档'), credits=20)
        self.create(owner, self.post(owner, title='别的问题'), credits=10)
        friend = self.user('friend', level=2)
        named = self.post(owner, title='长文档切分（指定人可见）', visibility='named', acl=[friend.pid])
        self.create(owner, named, credits=10)
        actor = Actor(id=viewer.pid, level=2, status='active')
        conn = self.db.conn()
        items = service.agent_open(conn, actor, ['长文档'], 10)
        self.assertEqual([i['id'] for i in items], [hit['id']])
        self.assertEqual(items[0]['meta']['credits'], 20)
        self.assertFalse(items[0]['public'])
        self.assertTrue(all(isinstance(v, (int, str)) for v in items[0]['meta'].values()))
        self.assertEqual(len(service.agent_open(conn, actor, [], 10)), 2)
        with self.db.write() as w:
            flags.set_flag(w, 'bounty.enabled', False, None)
        self.assertEqual(service.agent_open(self.db.conn(), actor, ['长文档'], 10), [])


class PromoTest(BountyCase):
    def promo(self, owner, title='推广：命令行小工具'):
        work = self.post(owner, title=title, type='work')
        return work, self.create(owner, work, kind='promo', days=3)

    def task(self, owner, bounty_id, title, description, kind='feedback', per=10, claims=2, rewards=None, status=201):
        r = owner.post(f'/api/bounty/{bounty_id}/promo/tasks', headers=hdr(), json={
            'title': title, 'kind': kind, 'description': description, 'max_claims': claims,
            'rewards': rewards or [{'type': 'credits', 'amount': per}]})
        self.assertEqual(r.status_code, status, r.text)
        return r.json()

    def test_engagement_tasks_refused_and_rules_editable(self):
        owner, gov = self.user('maker', level=2), self.user('gov', level=3, roles=('governor',), totp=True)
        _, b = self.promo(owner)
        cases = {
            '帮我点个赞再转发一下': 'no-like',
            '关注我们的公众号就送积分': 'no-follow',
            '去应用商店给个五星好评': 'no-offsite-review',
            '邀请 3 个朋友注册': 'no-traffic',
            '给仓库点 star': 'no-favorite',
            '加我微信领取': 'no-contact',
        }
        for text, rule in cases.items():
            r = self.task(owner, b['id'], '试用任务', text, status=422)
            self.assertEqual((r['error']['code'], r['error']['rule_id']), ('promo_task_refused', rule), text)
            self.assertTrue(r['error']['message'].startswith(('奖励不能', '不能', '任务说明')), r['error']['message'])
        self.assertEqual(self.wallet(owner)['held'], 0)
        ok = self.task(owner, b['id'], '导出功能找 bug', '装好以后试一下导出 CSV，把遇到的问题写清楚复现步骤', kind='bug')
        self.assertEqual(ok['data']['tasks'][0]['kind'], 'bug')
        self.assertEqual(self.wallet(owner)['held'], 20)

        vote_task = '试用投票组件，写下你的体验'
        self.assertEqual(self.task(owner, b['id'], '体验', vote_task, kind='review', status=422)['error']['rule_id'],
                         'no-vote')
        r = owner.post('/api/bounty/rules/no-vote', headers=HDRS, json={'enabled': False, 'reason_code': 'false_positive'})
        self.assertEqual(r.status_code, 403)
        r = gov.post('/api/bounty/rules/no-vote', headers=HDRS,
                     json={'pattern': r'拉票|打榜|帮.{0,4}投票|\bupvotes?\b', 'reason_code': 'false_positive'})
        self.assertEqual((r.status_code, r.json()['data']['version']), (200, 2))
        self.task(owner, b['id'], '体验', vote_task, kind='review', per=5, claims=1)
        audit = self.db.conn().execute("SELECT reason_code, meta_json FROM audit_event WHERE action = 'bounty.rule.update'"
                                       ).fetchall()
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit[0]['reason_code'], 'false_positive')
        changes = self.db.conn().execute("SELECT version FROM bounty_rule_change WHERE rule_id = 'no-vote' ORDER BY version"
                                         ).fetchall()
        self.assertEqual([c[0] for c in changes], [1, 2])
        self.assertNotIn('pattern', owner.get('/api/bounty/rules').json()['data']['promo_rules'][0])
        self.assertIn('pattern', gov.get('/api/bounty/rules').json()['data']['promo_rules'][0])

    def test_promo_limits(self):
        l1, owner = self.user('usr_l1', level=1), self.user('maker', level=3)
        work = self.post(l1, title='推广')
        self.assertEqual(self.code(self.create(l1, work, kind='promo', status=403)), 'action_not_allowed')
        self.promo(owner)
        second = self.post(owner, title='推广二', type='work')
        self.assertEqual(self.code(self.create(owner, second, kind='promo', status=409)), 'bounty_limit_reached')

    def test_accept_before_award_and_hidden_keeps_accepted(self):
        owner = self.user('maker', level=2)
        t1, t2, t3 = self.user('usr_t1'), self.user('usr_t2'), self.user('usr_t3')
        work, b = self.promo(owner)
        task = self.task(owner, b['id'], '试用反馈', '用一周后说说哪里不顺手', per=10, claims=3)['data']['tasks'][0]
        self.assertEqual(self.wallet(owner)['held'], 30)
        submit = lambda c: c.post(f"/api/bounty/tasks/{task['id']}/submit", headers=HDRS,  # noqa: E731
                                  json={'body': '导入大文件时进度条不动，重试三次都一样。'})
        s1 = submit(t1).json()['data']['id']
        self.assertEqual(self.wallet(t1)['available'], 0)
        self.assertEqual(self.code(submit(t1)), 'state_conflict')
        self.assertEqual(self.code(submit(owner)), 'validation_failed')
        r = owner.post(f'/api/bounty/submissions/{s1}/reject', headers=hdr(), json={'reason_code': 'low_effort'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.wallet(t1)['available'], 0)
        s1b = submit(t1).json()['data']['id']
        self.assertEqual(self.code(t2.post(f'/api/bounty/submissions/{s1b}/accept', headers=hdr(), json={})),
                         'resource_not_found')
        r = owner.post(f'/api/bounty/submissions/{s1b}/accept', headers=hdr(), json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.wallet(t1)['available'], 10)
        self.assertEqual(self.wallet(owner)['held'], 20)
        s2 = submit(t2).json()['data']['id']
        self.assertEqual(self.wallet(t2)['available'], 0)
        with self.db.write() as conn:
            objects.set_lifecycle(conn, None, work, 'hidden', 'gov_ad')
        self.dispatch()
        w = self.wallet(owner)
        self.assertEqual((w['available'], w['held']), (90, 0))
        self.assertEqual(self.wallet(t1)['available'], 10)
        self.assertEqual(self.db.conn().execute('SELECT status FROM promo_submission WHERE id = ?', (s2,)).fetchone()[0],
                         'expired')
        self.assertEqual(self.code(t3.post(f"/api/bounty/tasks/{task['id']}/submit", headers=HDRS,
                                           json={'body': '我也来试一下，这里有问题。'})), 'resource_not_found')

    def test_claim_limit_and_perk_promise(self):
        owner, t1, t2, other = self.user('maker', level=2), self.user('usr_t1'), self.user('usr_t2'), self.user('other')
        _, b = self.promo(owner)
        task = self.task(owner, b['id'], '录一段使用过程', '录三分钟以内的上手过程，讲讲卡在哪', kind='recording', claims=1,
                         rewards=[{'type': 'perk', 'note': '三个月专业版'},
                                  {'type': 'cosmetic', 'id': 'early-tester'}])['data']['tasks'][0]
        self.assertEqual(self.wallet(owner)['held'], 0)
        ids = [c.post(f"/api/bounty/tasks/{task['id']}/submit", headers=HDRS,
                      json={'body': '录好了，作品页里能看到，第二步卡住了。'}).json()['data']['id'] for c in (t1, t2)]
        self.assertEqual(owner.post(f'/api/bounty/submissions/{ids[0]}/accept', headers=hdr(), json={}).status_code, 200)
        self.assertEqual(self.code(owner.post(f'/api/bounty/submissions/{ids[1]}/accept', headers=hdr(), json={})),
                         'state_conflict')
        promises = self.wallet(t1)['promises']
        self.assertEqual([(p['note'], p['status']) for p in promises], [('三个月专业版', 'owed')])
        pid = promises[0]['id']
        self.assertEqual(self.code(other.post(f'/api/bounty/promises/{pid}/confirm', headers=HDRS, json={})),
                         'resource_not_found')
        r = t1.post(f'/api/bounty/promises/{pid}/dispute', headers=HDRS, json={'reason_code': 'not_received'})
        self.assertEqual((r.status_code, r.json()['data']['status']), (200, 'disputed'))
        self.assertEqual(len(self.events('bounty.promise_disputed')), 1)
        self.assertEqual(self.code(t1.post(f'/api/bounty/promises/{pid}/confirm', headers=HDRS, json={})),
                         'state_conflict')
        award = self.db.conn().execute('SELECT cosmetic_id, credits FROM bounty_award').fetchone()
        self.assertEqual((award[0], award[1]), ('early-tester', 0))


class LogicTest(unittest.TestCase):
    def test_split_always_sums_to_pool(self):
        for pool in (1, 2, 7, 90, 101, 999):
            for shares in ([100], [50, 50], [70, 30], [34, 33, 33], [1, 1, 98]):
                parts = logic.split(pool, shares)
                self.assertEqual(sum(parts), pool)
                self.assertTrue(all(p >= 0 for p in parts))
        self.assertEqual(logic.split(90, [70, 30]), [63, 27])
        self.assertTrue(logic.valid_shares([60, 40]))
        self.assertFalse(logic.valid_shares([60, 30]))
        self.assertFalse(logic.valid_shares([25, 25, 25, 25]))

    def test_auto_pick_and_decide(self):
        answers = [{'id': 'a', 'author_id': 'x', 'created_at': '2', 'useful': 2},
                   {'id': 'b', 'author_id': 'y', 'created_at': '1', 'useful': 2},
                   {'id': 'c', 'author_id': 'owner', 'created_at': '0', 'useful': 9}]
        self.assertEqual(logic.auto_pick(answers, 'owner'), 'b')
        self.assertIsNone(logic.auto_pick([{'id': 'a', 'author_id': 'x', 'created_at': '1', 'useful': 0}], 'owner'))
        b = {'status': 'open', 'kind': 'help', 'owner_id': 'owner', 'settle_after': '5'}
        self.assertEqual(logic.decide(b, 'active', '4', answers), ('wait', None))
        self.assertEqual(logic.decide(b, 'hidden', '1', answers), ('cancel', 'hidden'))
        self.assertEqual(logic.decide(b, 'withdrawn', '1', answers), ('cancel', 'withdrawn'))
        self.assertEqual(logic.decide(b, 'pending_review', '6', answers), ('wait', None))
        self.assertEqual(logic.decide(b, 'active', '6', answers), ('auto_award', 'b'))
        self.assertEqual(logic.decide(b, 'active', '6', []), ('refund', 'no_qualified'))
        self.assertEqual(logic.decide(dict(b, kind='promo'), 'active', '6'), ('close', 'expired'))
        self.assertEqual(logic.decide(dict(b, status='awarded'), 'hidden', '6'), ('none', None))
        self.assertEqual(logic.display_status('open', '3', '5', '2'), 'active')
        self.assertEqual(logic.display_status('open', '3', '5', '4'), 'judging')
        self.assertEqual(logic.display_status('refunded', '3', '5', '1'), 'closed')

    def test_marker_and_code_detection(self):
        self.assertTrue(logic.marker_qualifies(2, 0, 8 * DAY))
        self.assertFalse(logic.marker_qualifies(1, 0, 8 * DAY))
        self.assertFalse(logic.marker_qualifies(3, 2 * DAY, 8 * DAY))
        self.assertTrue(logic.looks_like_code('WXYZ-1234-ABCD'))
        self.assertTrue(logic.looks_like_code('code 9F8E7D6C5B4A3'))
        self.assertFalse(logic.looks_like_code('一个月会员 + 内测资格'))
        self.assertEqual(logic.quarter_season(service.clock.parse('2026-10-25T00:00:00.000000Z')), 's2026q4')


if __name__ == '__main__':
    unittest.main()
