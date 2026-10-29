import io
import json
import types as pytypes
import unittest
import zipfile
from unittest import mock

from app import accounts, clock
from tests.helpers import HDRS, PASSWORD
from tests.test_lg2_fixtures import ConfirmedAdultFixture

from modules.account import service
from modules.content import service as content_service
from modules.media.tests import images
from modules.media.tests.base import BE1Case


def allow_useful(conn, *, giver_id, receiver_id, object_id, now=None):
    return {'allow': True, 'points': 5, 'discount': 1.0, 'reason': None}


class AccountTest(ConfirmedAdultFixture, BE1Case):
    def setUp(self):
        super().setUp()
        self.g = self.user('gina', level=2)
        self.h = self.user('hank', level=2)
        self.storage = self.app.state.storage

    def request_export(self, client, status=202):
        r = client.post('/api/account/exports', headers=HDRS)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 202 else r.json()

    def scene(self):
        """gina 发帖、上传带 GPS 的照片、点反应收藏关注、回 hank；hank 的正文和被引用的话不该出现在 gina 的导出里。"""
        hank_post = self.obj(self.h, title='hank 的帖子', content={'body': 'HANK-SECRET-BODY'})
        hank_reply = self.h.post(f'/api/content/objects/{hank_post["id"]}/replies', headers=HDRS,
                                 json={'body': 'HANK-QUOTED-TEXT'}).json()['data']
        raw = images.jpeg_with_gps(900, 600)
        photo = self.asset(self.g, raw, 'trip.jpg')
        mine = self.rich(self.g, title='gina 的知识', doc={'type': 'doc', 'content': [
            {'type': 'paragraph', 'content': [{'type': 'text', 'text': '看图'}]},
            {'type': 'image', 'attrs': {'src': photo['image']['src']}}]})
        named = self.obj(self.g, title='只给指定的人', content={'body': 'GINA-NAMED'}, visibility='named',
                         acl=[self.h.pid])
        draft = self.obj(self.g, title='草稿', content={'body': 'GINA-DRAFT'}, lifecycle='draft')
        gina_reply = self.g.post(f'/api/content/objects/{hank_post["id"]}/replies', headers=HDRS,
                                 json={'body': 'GINA-REPLY', 'reply_to': hank_reply['id']}).json()['data']
        self.assertEqual(gina_reply['quote']['excerpt'], 'HANK-QUOTED-TEXT')
        hank_quotes_gina = self.h.post(f'/api/content/objects/{hank_post["id"]}/replies', headers=HDRS,
                                       json={'body': '回 gina', 'reply_to': gina_reply['id']}).json()['data']
        self.g.put(f'/api/content/objects/{hank_post["id"]}/reactions/up', headers=HDRS)
        self.g.put(f'/api/content/objects/{hank_post["id"]}/save', headers=HDRS)
        self.g.put('/api/content/follows/agent', headers=HDRS)
        with mock.patch.object(content_service, '_antiabuse',
                               lambda: pytypes.SimpleNamespace(assess_useful=allow_useful)):
            r = self.h.post(f'/api/content/objects/{mine["id"]}/useful', headers=HDRS)
        self.assertTrue(r.json()['data']['counted'], r.text)
        self.drain()
        return pytypes.SimpleNamespace(raw=raw, photo=photo, mine=mine, named=named, draft=draft,
                                       hank_post=hank_post, gina_reply=gina_reply, hank_quotes_gina=hank_quotes_gina)

    def test_export_zip_complete_one_time_and_only_mine(self):
        s = self.scene()
        job = self.request_export(self.g)
        self.assertEqual(job['state'], 'queued')
        url = job['download_url']
        self.assertEqual(self.code(self.g.get(url)), 'state_conflict')
        self.drain()
        status = self.g.get(f'/api/account/exports/{job["id"]}').json()['data']
        self.assertEqual(status['state'], 'ready')
        self.assertEqual(clock.parse(status['expires_at']) - clock.parse(status['ready_at']), 24 * 3600)
        self.assertEqual(self.h.get(url).status_code, 404)
        self.assertEqual(self.h.get(f'/api/account/exports/{job["id"]}').status_code, 404)
        self.assertEqual(self.g.get(url.split('?')[0] + '?token=wrong').status_code, 404)
        self.assertEqual(self.g.get(url.split('?')[0]).status_code, 404)

        r = self.g.get(url)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.headers['content-type'], 'application/zip')
        self.assertIn('attachment', r.headers['content-disposition'])
        z = zipfile.ZipFile(io.BytesIO(r.content))
        self.assertEqual(sorted(z.namelist()), sorted(['README.txt', 'export.json', f'originals/{s.photo["id"]}.jpg']))
        self.assertEqual(z.read(f'originals/{s.photo["id"]}.jpg'), s.raw)
        text = z.read('export.json').decode()
        data = json.loads(text)
        self.assertEqual({o['id'] for o in data['objects']},
                         {s.mine['id'], s.named['id'], s.draft['id'], s.gina_reply['id']})
        self.assertEqual(data['account']['id'], self.g.pid)
        self.assertEqual([x['kind'] for x in data['content']['reactions']], ['up'])
        self.assertEqual([x['object_id'] for x in data['content']['saved']], [s.hank_post['id']])
        self.assertEqual([x['tag'] for x in data['content']['follows']], ['agent'])
        self.assertEqual([x['object_id'] for x in data['content']['replies']], [s.gina_reply['id']])
        self.assertEqual([x['object_id'] for x in data['content']['useful_received']], [s.mine['id']])
        self.assertEqual([a['id'] for a in data['media']['assets']], [s.photo['id']])
        self.assertTrue(data['contributions'])
        self.assertEqual(data['missing_originals'], [])
        for leaked in ('HANK-SECRET-BODY', 'HANK-QUOTED-TEXT', '回 gina', 'hank'):
            self.assertNotIn(leaked, text, leaked)
        # 唯一出现 hank 编号的地方是核心贡献流水的 confirmed_by（账本字段，见 shared-requests [BE-1]）
        self.assertEqual({c['confirmed_by'] for c in data['contributions']}, {None})
        rest = json.dumps({k: v for k, v in data.items() if k != 'contributions'}, ensure_ascii=False, default=str)
        self.assertNotIn(self.h.pid, rest)
        for row in data['account_related_audit']:
            self.assertIn(row['by'], ('other', 'system'))
            self.assertNotIn('actor_id', row)

        self.assertEqual(self.g.get(url).status_code, 404)
        self.assertEqual(self.g.get(f'/api/account/exports/{job["id"]}').json()['data']['state'], 'downloaded')
        key = self.db.conn().execute('SELECT file_key FROM account_export WHERE id = ?', (job['id'],)).fetchone()[0]
        self.assertIsNone(key)

        second = self.request_export(self.g)
        self.drain()
        key = self.db.conn().execute('SELECT file_key FROM account_export WHERE id = ?',
                                     (second['id'],)).fetchone()[0]
        self.assertTrue(self.storage.exists(key))
        later = clock.now_ts() + 25 * 3600
        with mock.patch('app.clock.now_ts', lambda: later):
            self.assertEqual(self.g.get(f'/api/account/exports/{second["id"]}').json()['data']['state'], 'expired')
            self.assertEqual(self.g.get(second['download_url']).status_code, 404)
        self.assertFalse(self.storage.exists(key))
        self.request_export(self.g)
        r = self.request_export(self.g, status=429)
        self.assertEqual(r['error']['code'], 'rate_limited')

    def test_deletion_cooldown_cancel_and_export_during_cooldown(self):
        post = self.obj(self.h, title='有人', content={'body': 'x'})
        self.assertEqual(self.g.get('/api/account/deletion').json()['data']['status'], 'active')
        r = self.g.post('/api/me/delete', headers=HDRS, json={'password': PASSWORD})
        self.assertEqual(r.status_code, 200, r.text)
        info = self.g.get('/api/account/deletion').json()['data']
        self.assertEqual((info['status'], info['cooldown_days']), ('pending_deletion', 7))
        self.assertEqual(clock.parse(info['purge_after']) - clock.parse(info['requested_at']), 7 * 86400)
        self.assertTrue(info['effects'])
        self.assertEqual(self.code(self.g.put(f'/api/content/objects/{post["id"]}/reactions/up', headers=HDRS)),
                         'action_not_allowed')
        self.assertEqual(self.code(self.upload(self.g, images.png(64, 64), 'x.png')), 'action_not_allowed')
        job = self.request_export(self.g)
        self.drain()
        self.assertEqual(self.g.get(job['download_url']).status_code, 200)
        self.assertEqual(accounts.purge_due(self.db, self.settings), [])
        self.assertEqual(self.g.post('/api/me/delete/cancel', headers=HDRS).status_code, 200)
        info = self.g.get('/api/account/deletion').json()['data']
        self.assertEqual((info['status'], info['purge_after']), ('active', None))
        self.assertEqual(self.g.put(f'/api/content/objects/{post["id"]}/reactions/up', headers=HDRS).status_code, 200)

    def purge_gina(self):
        self.assertEqual(self.g.post('/api/me/delete', headers=HDRS, json={'password': PASSWORD}).status_code, 200)
        with self.db.write() as conn:
            conn.execute('UPDATE principal SET delete_requested_at = ? WHERE id = ?',
                         (clock.iso(clock.now_ts() - 8 * 86400), self.g.pid))
        self.assertEqual(accounts.purge_due(self.db, self.settings), [self.g.pid])
        self.drain()

    def test_purge_removes_private_traces_keeps_ledger_anonymised(self):
        s = self.scene()
        avatar = self.asset(self.g, images.png(300, 300), 'me.png', 'avatar', crop={'x': 0, 'y': 0, 'size': 300})
        self.assertEqual(self.g.put('/api/account/avatar', headers=HDRS, json={'asset_id': avatar['id']}).status_code,
                         200)
        pending = self.request_export(self.g)
        self.drain()
        conn = self.db.conn()
        export_key = conn.execute('SELECT file_key FROM account_export WHERE id = ?', (pending['id'],)).fetchone()[0]
        raw_keys = [r[0] for r in conn.execute('SELECT raw_key FROM media_asset WHERE owner_id = ?', (self.g.pid,))]
        variants = [f'/api/media/f/{r[0]}.{r[1]}' for r in conn.execute(
            'SELECT v.sha256, v.ext FROM media_variant v JOIN media_asset a ON a.id = v.asset_id WHERE a.owner_id = ?',
            (self.g.pid,))]
        self.assertEqual(self.h.get(variants[0]).status_code, 200)

        self.purge_gina()
        conn = self.db.conn()
        one = lambda sql, *p: conn.execute(sql, p).fetchone()[0]
        self.assertEqual(one('SELECT display_name FROM profile WHERE principal_id = ?', self.g.pid), '已注销成员')
        self.assertIsNone(one('SELECT avatar_ref FROM profile WHERE principal_id = ?', self.g.pid))
        self.assertEqual(one('SELECT count(*) FROM content_save WHERE principal_id = ?', self.g.pid), 0)
        self.assertEqual(one('SELECT count(*) FROM content_follow WHERE principal_id = ?', self.g.pid), 0)
        self.assertIsNone(one('SELECT quote_excerpt FROM content_reply WHERE object_id = ?', s.hank_quotes_gina['id']))
        self.assertIsNone(one('SELECT quote_excerpt FROM content_reply WHERE object_id = ?', s.gina_reply['id']))
        listed = {m['id']: m for m in self.h.get(f'/api/content/objects/{s.hank_post["id"]}/replies').json()['data']}
        self.assertEqual((listed[s.gina_reply['id']]['status'], listed[s.gina_reply['id']]['author']['display_name']),
                         ('ok', '已注销成员'))
        self.assertEqual(listed[s.hank_quotes_gina['id']]['quote']['excerpt'], None)
        self.assertEqual(listed[s.hank_quotes_gina['id']]['status'], 'ok')
        for oid in (s.named['id'], s.draft['id']):
            self.assertEqual(one('SELECT count(*) FROM object_version WHERE object_id = ?', oid), 0)
        self.assertGreater(one('SELECT count(*) FROM object_version WHERE object_id = ?', s.mine['id']), 0)
        self.assertEqual(one("SELECT count(*) FROM media_asset WHERE owner_id = ? AND state != 'deleted'", self.g.pid),
                         0)
        for key in raw_keys:
            self.assertFalse(self.storage.exists(key), key)
        for path in variants:
            self.assertEqual(self.h.get(path).status_code, 404, path)
        self.assertFalse(self.storage.exists(export_key))
        self.assertEqual(one('SELECT state FROM account_export WHERE id = ?', pending['id']), 'expired')
        self.assertGreater(one("SELECT count(*) FROM ledger_entry WHERE subject_id = ?", self.g.pid), 0)
        self.assertEqual(one("SELECT count(*) FROM audit_event WHERE action = 'account.private_content_purged' "
                             'AND target_id = ?', self.g.pid), 1)

    def test_purge_respects_hold(self):
        s = self.scene()
        hold = lambda conn, pid: pid == self.g.pid
        service.register_hold(hold)
        try:
            self.purge_gina()
        finally:
            service.HOLDS.remove(hold)
        conn = self.db.conn()
        for oid in (s.named['id'], s.draft['id']):
            self.assertGreater(conn.execute('SELECT count(*) FROM object_version WHERE object_id = ?',
                                            (oid,)).fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
