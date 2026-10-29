"""LG-5 gate 5 / gate 7: media kill switch, account purge, originals never public. Synthetic files only."""
import base64
import hashlib

from app import accounts, clock, outbox
from tests.helpers import HDRS

from modules.media import jobs, service

from . import images
from .base import BE1Case


class MediaGateAndPurgeTest(BE1Case):
    def setUp(self):
        super().setUp()
        self.maker = self.user('lg5maker', level=2)
        self.other = self.user('lg5other', level=2)

    def set_flag(self, value):
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = ? WHERE key = 'media.uploads'", (int(value),))

    def make_deletion_due(self, pid):
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'pending_deletion', delete_requested_at = ? WHERE id = ?",
                         (clock.iso(clock.now_ts() - 8 * 86400), pid))

    def test_kill_switch_stops_every_upload_step_but_not_reads(self):
        asset = self.asset(self.maker, images.png(), 'before.png')
        data = images.png(200, 100)
        body = {'purpose': 'image', 'filename': 'x.png', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        self.set_flag(False)
        for r in (self.maker.post('/api/media/uploads', headers=HDRS, json=body),
                  self.maker.put('/api/media/uploads/nope/chunks/0', headers=HDRS, json={'data': 'AAAA'}),
                  self.maker.post('/api/media/uploads/nope/complete', headers=HDRS)):
            self.assertEqual((r.status_code, self.code(r)), (501, 'capability_unavailable'))
        self.assertEqual(self.maker.get(asset['variants'][0]['url']).status_code, 200)
        self.set_flag(True)
        self.assertEqual(self.maker.post('/api/media/uploads', headers=HDRS, json=body).status_code, 201)

    def test_original_with_metadata_is_never_served(self):
        raw = images.jpeg_with_gps()
        asset = self.asset(self.maker, raw, 'IMG_0002.jpg')
        raw_sha = hashlib.sha256(raw).hexdigest()
        self.assertTrue(self.app.state.storage.exists(f'{service.RAW_KIND}/{raw_sha}'))
        for ext in ('webp', 'jpg', 'avif'):
            r = self.maker.get(f'/api/media/f/{raw_sha}.{ext}')
            self.assertEqual(r.status_code, 404, ext)
        self.assertNotIn(raw_sha, str(asset))

    def test_html_purpose_rejects_svg_and_image_purpose_rejects_html(self):
        for filename, data, purpose, reason in (('logo.svg', images.SVG, 'html', 'extension_mismatch'),
                                                ('page.html', images.HTML, 'image', 'type_not_allowed')):
            r = self.upload(self.maker, data, filename, purpose)
            self.assertEqual(r.status_code, 422, r.text)
            self.assertEqual(r.json()['error']['reason'], reason, filename)

    def test_account_purge_is_registered_and_defers_file_deletion_to_the_outbox(self):
        fns = [fn for fn in accounts.PURGERS if getattr(fn, '__module__', '').startswith('modules.media')]
        self.assertIn(service.purge_for_account, fns)
        asset = self.asset(self.maker, images.jpeg_with_gps(), 'IMG_0003.jpg')
        storage = self.app.state.storage
        conn = self.db.conn()
        keys = [r[0] for r in conn.execute('SELECT raw_key FROM media_asset WHERE owner_id = ?', (self.maker.pid,))]
        variant_keys = [f'{service.EXT_KIND[v["ext"]]}/{v["sha256"]}' for v in
                        conn.execute('SELECT ext, sha256 FROM media_variant')]
        self.assertTrue(keys and variant_keys)
        self.make_deletion_due(self.maker.pid)
        self.assertEqual(accounts.purge_due(self.db, self.settings), [self.maker.pid])
        conn = self.db.conn()
        self.assertEqual(conn.execute("SELECT count(*) FROM media_asset WHERE owner_id = ? AND state = 'ready'",
                                      (self.maker.pid,)).fetchone()[0], 0)
        self.assertTrue(all(storage.exists(k) for k in keys + variant_keys), 'files go only after the outbox runs')
        self.drain()
        self.assertFalse(any(storage.exists(k) for k in keys + variant_keys))
        self.assertEqual(self.other.get(asset['variants'][0]['url']).status_code, 404)

    def test_shared_variant_files_survive_the_owner_purge(self):
        same = images.png(300, 200)
        mine = self.asset(self.maker, same, 'same.png')
        theirs = self.asset(self.other, same, 'same.png')
        storage = self.app.state.storage
        shared = [f'{service.EXT_KIND[v["ext"]]}/{v["sha256"]}' for v in
                  self.db.conn().execute('SELECT ext, sha256 FROM media_variant WHERE asset_id = ?', (theirs['id'],))]
        self.assertTrue(shared)
        self.assertEqual({v['url'] for v in mine['variants']}, {v['url'] for v in theirs['variants']})
        self.make_deletion_due(self.maker.pid)
        accounts.purge_due(self.db, self.settings)
        self.drain()
        self.assertTrue(all(storage.exists(k) for k in shared))
        self.assertEqual(self.other.get(theirs['variants'][0]['url']).status_code, 200)

    def test_failed_later_purger_leaves_files_in_place(self):
        asset = self.asset(self.maker, images.png(), 'keep.png')
        storage = self.app.state.storage
        keys = [f'{service.EXT_KIND[v["ext"]]}/{v["sha256"]}' for v in
                self.db.conn().execute('SELECT ext, sha256 FROM media_variant WHERE asset_id = ?', (asset['id'],))]
        self.assertTrue(keys)
        self.make_deletion_due(self.maker.pid)

        def broken(conn, principal_id):
            raise RuntimeError('LG5 fixture purger failed')

        accounts.register_purger(broken)
        try:
            with self.assertRaisesRegex(RuntimeError, 'LG5 fixture'):
                accounts.purge_due(self.db, self.settings)
        finally:
            accounts.PURGERS.remove(broken)
        self.drain()
        self.assertTrue(all(storage.exists(k) for k in keys))
        self.assertEqual(self.maker.get(asset['variants'][0]['url']).status_code, 200)

    def test_export_lists_assets_without_file_keys(self):
        asset = self.asset(self.maker, images.png(), 'mine.png')
        rows = service.export_rows(self.db.conn(), type('A', (), {'id': self.maker.pid})())
        self.assertEqual([r['id'] for r in rows['assets']], [asset['id']])
        for row in rows['assets'] + rows['uploads']:
            self.assertFalse({'raw_key', 'file_key', 'blur'} & set(row))


class AbandonedUploadSweepTest(BE1Case):
    def test_old_unfinished_uploads_lose_their_chunks_and_fresh_ones_do_not(self):
        maker = self.user('lg5sweep', level=2)
        data = images.noisy_png(1400, 900)
        body = {'purpose': 'image', 'filename': 'big.png', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        up = [maker.post('/api/media/uploads', headers=HDRS, json=body).json()['data']['id'] for _ in range(2)]
        for upload_id in up:
            chunk = base64.b64encode(data[:service.CHUNK]).decode()
            r = maker.put(f'/api/media/uploads/{upload_id}/chunks/0', headers=HDRS, json={'data': chunk})
            self.assertEqual(r.status_code, 200, r.text)
        with self.db.write() as conn:
            conn.execute('UPDATE media_upload SET updated_at = ? WHERE id = ?',
                         (clock.iso(clock.now_ts() - jobs.ABANDON_AFTER - 60), up[0]))
        self.assertEqual(jobs.sweep_abandoned(self.db), 1)
        conn = self.db.conn()
        self.assertEqual(conn.execute('SELECT state, reject_code FROM media_upload WHERE id = ?', (up[0],)).fetchone()[:],
                         ('rejected', 'abandoned'))
        self.assertEqual(conn.execute('SELECT count(*) FROM media_chunk WHERE upload_id = ?', (up[0],)).fetchone()[0], 0)
        self.assertEqual(conn.execute('SELECT state FROM media_upload WHERE id = ?', (up[1],)).fetchone()[0], 'receiving')
        self.assertEqual(conn.execute('SELECT count(*) FROM media_chunk WHERE upload_id = ?', (up[1],)).fetchone()[0], 1)
        self.assertEqual(jobs.sweep_abandoned(self.db), 0)


class RoomsStorageCleanupTest(BE1Case):
    """rooms.storage_cleanup_requested: delete only after commit, only when nothing else still points at the key."""
    DOC = {'type': 'board', 'items': [{'id': 'n1', 'text': '合成白板'}]}

    def setUp(self):
        super().setUp()
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 1 WHERE key = 'rooms.enabled'")
        self.a = self.user('lg5hosta', level=3)
        self.b = self.user('lg5hostb', level=3)
        self.storage = self.app.state.storage

    def board(self, client, doc=None):
        r = client.post('/api/rooms', headers=HDRS, json={'kind': 'discussion', 'title': '合成房间', 'duration_min': 30})
        self.assertEqual(r.status_code, 201, r.text)
        rid = r.json()['data']['id']
        r = client.post(f'/api/rooms/{rid}/board', headers=HDRS, json={'doc': doc or self.DOC})
        self.assertEqual(r.status_code, 201, r.text)
        return f'room_board/{r.json()["data"]["sha256"]}'

    def delete(self, client):
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'pending_deletion', delete_requested_at = ? WHERE id = ?",
                         (clock.iso(clock.now_ts() - 8 * 86400), client.pid))
        self.assertEqual(accounts.purge_due(self.db, self.settings), [client.pid])

    def events(self):
        return self.db.conn().execute("SELECT id, state, attempts FROM outbox_event "
                                      "WHERE event_type = 'rooms.storage_cleanup_requested'").fetchall()

    def test_file_survives_until_the_outbox_runs_then_goes(self):
        key = self.board(self.a)
        self.assertTrue(self.storage.exists(key))
        self.delete(self.a)
        self.assertTrue(self.storage.exists(key), 'no deletion inside the purge transaction')
        self.drain()
        self.assertFalse(self.storage.exists(key))
        self.assertEqual([e['state'] for e in self.events()], ['done'])

    def test_shared_key_is_kept_until_its_last_reference_is_gone(self):
        key = self.board(self.a)
        self.assertEqual(self.board(self.b), key, 'identical boards share one content-addressed key')
        self.delete(self.a)
        self.drain()
        self.assertTrue(self.storage.exists(key), 'the other host still points at it')
        self.delete(self.b)
        self.drain()
        self.assertFalse(self.storage.exists(key))

    def test_media_reference_also_protects_the_key(self):
        key = self.board(self.a)
        sha = key.split('/')[1]
        with self.db.write() as conn:
            conn.execute("INSERT INTO media_asset (id, owner_id, purpose, mime, bytes, raw_key, state, created_at) "
                         "VALUES ('00000000-0000-4000-8000-000000000001', ?, 'image', 'image/png', 1, ?, 'ready', ?)",
                         (self.b.pid, key, clock.now()))
        self.assertTrue(service.key_referenced(self.db.conn(), key))
        self.delete(self.a)
        self.drain()
        self.assertTrue(self.storage.exists(key), sha)

    def test_rolled_back_purge_deletes_nothing_and_emits_nothing(self):
        key = self.board(self.a)
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'pending_deletion', delete_requested_at = ? WHERE id = ?",
                         (clock.iso(clock.now_ts() - 8 * 86400), self.a.pid))

        def broken(conn, principal_id):
            raise RuntimeError('LG5 fixture purger failed')

        accounts.register_purger(broken)
        try:
            with self.assertRaisesRegex(RuntimeError, 'LG5 fixture'):
                accounts.purge_due(self.db, self.settings)
        finally:
            accounts.PURGERS.remove(broken)
        self.drain()
        self.assertEqual(self.events(), [])
        self.assertTrue(self.storage.exists(key))

    def test_missing_storage_keeps_the_event_pending_for_retry(self):
        key = self.board(self.a)
        self.delete(self.a)
        real = self.db.outbox_app_context
        self.db.outbox_app_context = outbox.AppContext(self.db, self.settings, None)
        outbox.dispatch(self.db)
        pending = self.events()
        self.assertEqual([(e['state'], e['attempts']) for e in pending], [('pending', 1)])
        self.assertTrue(self.storage.exists(key))
        with self.db.write() as conn:
            conn.execute("UPDATE outbox_event SET available_at = '2000-01-01T00:00:00.000000Z'")
        self.db.outbox_app_context = real
        self.drain()
        self.assertEqual([e['state'] for e in self.events()], ['done'])
        self.assertFalse(self.storage.exists(key))

    def test_redelivery_is_idempotent(self):
        key = self.board(self.a)
        self.delete(self.a)
        self.drain()
        event = self.db.conn().execute("SELECT * FROM outbox_event WHERE event_type = "
                                       "'rooms.storage_cleanup_requested'").fetchone()
        payload = {'keys': [key, 'room_board/' + 'f' * 64, 'not a key', 7]}
        again = {'payload': payload, 'id': event['id']}
        ctx = self.db.outbox_app_context
        self.assertEqual(service.on_rooms_storage_cleanup(again, ctx), 0)
        self.assertEqual(service.on_rooms_storage_cleanup(again, ctx), 0)
