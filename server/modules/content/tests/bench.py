"""BE-1 性能：5 万对象（含回复）+ 2 万张图片元数据，量信息流、详情、回复列表、搜索高亮、图片路由的 P95。

    cd server && python3 -m modules.content.tests.bench [--objects 50000 --images 20000 --runs 200]

只在临时目录里建库，合成数据；派生数据（标签、统计、回复关系）用模块自己的处理函数生成，和 outbox 消费者是同一段代码。
"""
import argparse
import base64
import hashlib
import os
import random
import shutil
import statistics
import tempfile
import time
import uuid

from app import accounts, clock, objects
from app.authz import Actor
from app.main import create_app
from tests.bench import WORDS, login, p, sentence
from tests.helpers import HDRS, make_settings

from modules.content import service as content
from modules.media import pipeline
from modules.media import service as media
from modules.media.tests import images

TAGS = [w for w in WORDS][:40]
READ_SLO, SEARCH_SLO = 50.0, 150.0


def rid(rng):
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def sha(rng):
    return '%064x' % rng.getrandbits(256)


def add_asset(conn, rng, owner, now):
    asset_id = rid(rng)
    w, h = rng.choice(((4000, 3000), (3024, 4032), (1920, 1080), (1200, 800), (800, 800)))
    conn.execute('INSERT INTO media_asset (id, owner_id, purpose, mime, width, height, bytes, raw_key, color, blur, '
                 "state, created_at) VALUES (?, ?, 'image', 'image/jpeg', ?, ?, ?, ?, '#8899aa', ?, 'ready', ?)",
                 (asset_id, owner, w, h, rng.randrange(200_000, 8_000_000), f'upload_raw/{sha(rng)}',
                  'data:image/webp;base64,' + 'A' * 120, now))
    first = None
    for width in pipeline.target_widths(w):
        height = round(h * width / w)
        for ext in ('webp', 'jpg', 'avif'):
            digest = sha(rng)
            first = first or digest
            conn.execute('INSERT INTO media_variant (asset_id, name, ext, width, height, bytes, sha256) '
                         'VALUES (?, ?, ?, ?, ?, ?, ?)', (asset_id, f'w{width}.{ext}', ext, width, height,
                                                          rng.randrange(20_000, 900_000), digest))
    return asset_id, first


def build(app, total, n_images, rng):
    db = app.state.db
    with db.write() as conn:
        users = [accounts.create_principal(conn, handle=f'u{i:03d}', password_hash='scrypt$x', display_name=f'成员{i}',
                                           level=1 + i % 5, level_source='founder') for i in range(200)]
        spaces = [accounts.create_space(conn, users[i], f's{i}', f'空间{i}') for i in range(10)]
        for i, pid in enumerate(users):
            if i % 4 == 0:
                accounts.set_membership(conn, spaces[i % 10], pid)
    start = time.perf_counter()
    n_replies = max(0, total // 6)
    n_roots = total - n_replies
    rich_every = max(1, n_roots // max(1, n_images // 2)) if n_images else 0
    roots, open_roots, rich = [], [], []
    images_made = 0
    for offset in range(0, n_roots, 2000):
        with db.write() as conn:
            now = clock.now()
            for i in range(offset, min(n_roots, offset + 2000)):
                author = Actor(id=users[rng.randrange(40, 200)], level=5, status='active')
                roll, kw = rng.random(), {}
                if roll < 0.6:
                    kw['visibility'] = 'members'
                elif roll < 0.75:
                    kw.update(visibility='level', min_level=rng.choice((2, 3, 4)))
                elif roll < 0.9:
                    space = rng.choice(spaces)
                    accounts.set_membership(conn, space, author.id)
                    kw.update(visibility='space', space_id=space)
                else:
                    kw.update(visibility='named', acl=rng.sample(users[:40], rng.randint(1, 3)))
                kind = rng.choice(('knowledge', 'discussion', 'work'))
                body = {'tags': rng.sample(TAGS, 2)}
                if rich_every and kind != 'discussion' and i % rich_every == 0 and images_made + 2 <= n_images:
                    cover, _ = add_asset(conn, rng, author.id, now)
                    inline, inline_sha = add_asset(conn, rng, author.id, now)
                    images_made += 2
                    body['cover'] = cover
                    body['doc'] = {'type': 'doc', 'content': [
                        {'type': 'paragraph', 'content': [{'type': 'text', 'text': sentence(rng, 8)},
                                                          {'type': 'mention', 'attrs': {'id': rng.choice(users)}}]},
                        {'type': 'image', 'attrs': {'src': f'/api/media/f/{inline_sha}.webp', 'alt': '图'}},
                        {'type': 'knowledgeCard', 'attrs': {'refId': rng.choice(roots)[0] if roots else 'x'}}]}
                else:
                    cover = inline = None
                    body['body'] = sentence(rng, 8)
                oid = objects.create(conn, author, type=kind, title=sentence(rng, 1)[:60], content=body, **kw)
                content.index_tags(conn, oid)
                for asset_id in (cover, inline):
                    if asset_id:
                        conn.execute('INSERT INTO media_attachment (asset_id, object_id, created_at) VALUES (?, ?, ?)',
                                     (asset_id, oid, now))
                roots.append((oid, author.id))
                if kw['visibility'] == 'members':
                    open_roots.append(oid)
                    if cover:
                        rich.append(oid)
    while images_made < n_images:
        with db.write() as conn:
            for _ in range(min(2000, n_images - images_made)):
                add_asset(conn, rng, rng.choice(users), clock.now())
                images_made += 1
    big = open_roots[0]
    replies = []
    big_n = min(2000, n_replies // 3)
    for offset in range(0, n_replies, 1000):
        with db.write() as conn:
            for i in range(offset, min(n_replies, offset + 1000)):
                actor = Actor(id=users[rng.randrange(40, 200)], level=5, status='active')
                target = big if i < big_n else rng.choice(open_roots[1:2000])
                same = [r for r in replies[-30:] if r[1] == target]
                reply_to = rng.choice(same)[0] if same and rng.random() < 0.6 else None
                oid = content.create_reply(conn, actor, target, sentence(rng, 2), reply_to=reply_to)
                replies.append((oid, target))
    with db.write() as conn:
        for oid, _ in rng.sample(roots, min(len(roots), 8000)):
            for who in rng.sample(users, rng.randint(1, 15)):
                conn.execute('INSERT OR IGNORE INTO content_reaction (object_id, principal_id, kind, created_at) '
                             'VALUES (?, ?, ?, ?)', (oid, who, rng.choice(content.REACTIONS), clock.now()))
        for oid, _ in rng.sample(roots, min(len(roots), 6000)):
            for who in rng.sample(users, rng.randint(1, 4)):
                conn.execute('INSERT OR IGNORE INTO content_save (principal_id, object_id, created_at) VALUES (?, ?, ?)',
                             (who, oid, clock.now()))
        for pid in users:
            for tag in rng.sample(TAGS, 3):
                conn.execute('INSERT OR IGNORE INTO content_follow (principal_id, tag, created_at) VALUES (?, ?, ?)',
                             (pid, content.norm_tag(tag), clock.now()))
    for offset in range(0, len(roots), 5000):
        with db.write() as conn:
            for oid, _ in roots[offset:offset + 5000]:
                content.refresh_stat(conn, oid)
    return users, rich, big, time.perf_counter() - start, images_made, len(replies)


def timed(client, url, runs, before=None, headers=None, status=200):
    times = []
    first = client.get(url, headers=headers)
    assert first.status_code == status, (url, first.status_code, first.text[:300])
    for _ in range(runs):
        if before:
            before()
        t = time.perf_counter()
        r = client.get(url, headers=headers)
        times.append((time.perf_counter() - t) * 1000)
        assert r.status_code == status, (url, r.status_code)
    return times, first


def in_process(app, actors, rich, big, runs):
    """不经 HTTP，直接调模块的读函数：看查询本身花多少，和 TestClient、线程调度的开销分开。"""
    conn = app.state.db.conn()
    rows = []
    for name, pid in actors.items():
        level = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (pid,)).fetchone()[0]
        actor = Actor(id=pid, level=level, status='active')
        deep = None
        for _ in range(25):
            _, deep = content.list_replies(conn, actor, big, 'tree', None, deep, 40)
        hot_cursor = content.feed_hot(conn, actor, None, None, None, 20)[1]

        def detail(oid):
            row, data = objects.detail(conn, actor, oid)
            return content.enrich_detail(conn, actor, row, data)
        cases = [
            ('feed new', lambda: content.feed_new(conn, actor, None, None, None, 20)),
            ('feed hot (uncached)', lambda: content.feed_hot(conn, actor, None, None, None, 20)),
            ('feed hot p2 (uncached)', lambda: content.feed_hot(conn, actor, None, None, hot_cursor, 20)),
            ('feed following', lambda: content.feed_following(conn, actor, None, None, None, 20)),
            ('saved', lambda: content.saved_list(conn, actor, None, 20)),
            ('detail rich', lambda: detail(rich[0])),
            ('replies time (2k thread)', lambda: content.list_replies(conn, actor, big, 'time', None, None, 50)),
            ('replies tree (2k thread)', lambda: content.list_replies(conn, actor, big, 'tree', None, None, 50)),
            ('replies tree deep page', lambda: content.list_replies(conn, actor, big, 'tree', None, deep, 40)),
        ]
        for label, fn in cases:
            times = []
            fn()
            for _ in range(runs):
                t = time.perf_counter()
                fn()
                times.append((time.perf_counter() - t) * 1000)
            rows.append((name, label, len(times), statistics.median(times), p(times, 0.95), max(times)))
    print('| actor | in-process read | n | P50 ms | P95 ms | max ms |')
    print('|---|---|---|---|---|---|')
    for r in rows:
        print(f'| {r[0]} | {r[1]} | {r[2]} | {r[3]:.1f} | {r[4]:.1f} | {r[5]:.1f} |')


def real_image(app, client, owner):
    """走真实管线处理一张 12MP 合成照片：量处理耗时（也就是写锁占用时长），并给图片路由准备真实文件。"""
    raw = images.jpeg_with_gps(4000, 3000)
    storage = app.state.storage
    timings = []
    for _ in range(3):
        t = time.perf_counter()
        pipeline.process_image(raw, 'jpeg')
        timings.append((time.perf_counter() - t) * 1000)
    body = {'purpose': 'image', 'filename': 'big.jpg', 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    up = client.post('/api/media/uploads', headers=HDRS, json=body).json()['data']
    for i in range(up['chunks']):
        piece = raw[i * media.CHUNK:(i + 1) * media.CHUNK]
        client.put(f'/api/media/uploads/{up["id"]}/chunks/{i}', headers=HDRS,
                   json={'data': base64.b64encode(piece).decode()})
    client.post(f'/api/media/uploads/{up["id"]}/complete', headers=HDRS)
    t = time.perf_counter()
    with app.state.db.write() as conn:
        media.process_upload(conn, storage, up['id'])
    locked = (time.perf_counter() - t) * 1000
    asset = client.get(f'/api/media/uploads/{up["id"]}').json()['data']['asset']
    return asset, statistics.median(timings), locked, len(raw)


def main(argv=None):
    parser = argparse.ArgumentParser(prog='python3 -m modules.content.tests.bench')
    parser.add_argument('--objects', type=int, default=50000)
    parser.add_argument('--images', type=int, default=20000)
    parser.add_argument('--runs', type=int, default=200)
    args = parser.parse_args(argv)
    rng = random.Random(13)
    tmp = tempfile.mkdtemp(prefix='commons-be1-bench-')
    try:
        app = create_app(make_settings(tmp))
        users, rich, big, build_s, n_images, n_replies = build(app, args.objects, args.images, rng)
        conn = app.state.db.conn()
        conn.execute('ANALYZE')
        count = lambda sql: conn.execute(sql).fetchone()[0]
        print(f'built {count("SELECT count(*) FROM object_head")} objects ({n_replies} replies), '
              f'{count("SELECT count(*) FROM media_asset")} image assets, '
              f'{count("SELECT count(*) FROM media_variant")} variants, '
              f'{count("SELECT count(*) FROM content_reaction")} reactions in {build_s:.1f}s')
        print('load average (1/5/15 min) at start: %.1f / %.1f / %.1f on %d cores' % (*os.getloadavg(), os.cpu_count()))
        uploader = users[2]
        with app.state.db.write() as w:
            w.execute('UPDATE profile SET level = 3 WHERE principal_id = ?', (uploader,))
        asset, pipe_ms, lock_ms, raw_bytes = real_image(app, login(app, uploader), uploader)
        print(f'pipeline 12MP JPEG ({raw_bytes // 1024} KB): process_image median {pipe_ms:.0f} ms; '
              f'outbox handler write-lock hold {lock_ms:.0f} ms; AVIF={pipeline.AVIF}')
        with app.state.db.write() as w:
            w.execute('INSERT INTO media_attachment (asset_id, object_id, created_at) VALUES (?, ?, ?)',
                      (asset['id'], big, clock.now()))
        file_url = asset['image']['src']
        some_assets = ','.join(r[0] for r in conn.execute(
            "SELECT a.id FROM media_asset a JOIN media_attachment m ON m.asset_id = a.id JOIN object_head h ON "
            "h.id = m.object_id WHERE h.visibility = 'members' LIMIT 20"))
        actors = {'L1': users[5], 'L3 + space member': users[12], 'L5 + space member': users[4]}
        cold = content.clear_cache
        rows = []
        for name, pid in actors.items():
            client = login(app, pid)
            hot2 = client.get('/api/content/feed?sort=hot&limit=20').json()['meta']['next_cursor']
            new2 = client.get('/api/content/feed?sort=new&limit=20').json()['meta']['next_cursor']
            deep, cursor = None, None
            for _ in range(25):
                page = client.get(f'/api/content/objects/{big}/replies?order=tree&limit=40'
                                  + (f'&cursor={cursor}' if cursor else '')).json()
                cursor = page['meta']['next_cursor'] or cursor
            deep = cursor
            scenarios = [
                ('read', 'baseline core GET /api/me', '/api/me', None, None),
                ('read', 'baseline core list /api/objects', '/api/objects?limit=20', None, None),
                ('search', 'baseline core /api/search 模型', '/api/search?q=模型&limit=20', None, None),
                ('read', 'feed new p1', '/api/content/feed?sort=new&limit=20', None, None),
                ('read', 'feed new p2 (cursor)', f'/api/content/feed?sort=new&limit=20&cursor={new2}', None, None),
                ('read', 'feed hot p1 (cache miss)', '/api/content/feed?sort=hot&limit=20', cold, None),
                ('read', 'feed hot p1 (cache hit)', '/api/content/feed?sort=hot&limit=20', None, None),
                ('read', 'feed hot p2 (cache miss)', f'/api/content/feed?sort=hot&limit=20&cursor={hot2}', cold, None),
                ('read', 'feed following p1', '/api/content/feed?sort=following&limit=20', None, None),
                ('read', 'feed type=work', '/api/content/feed?sort=new&type=work&limit=20', None, None),
                ('read', 'saved list', '/api/content/saved?limit=20', None, None),
                ('read', 'detail rich (doc+images+cards)', f'/api/content/objects/{rich[0]}', None, None),
                ('read', 'detail plain + stats', f'/api/content/objects/{big}', None, None),
                ('read', 'replies time p1 (2k thread)', f'/api/content/objects/{big}/replies?limit=50', None, None),
                ('read', 'replies tree p1 (2k thread)', f'/api/content/objects/{big}/replies?order=tree&limit=50',
                 None, None),
                ('read', 'replies tree deep page', f'/api/content/objects/{big}/replies?order=tree&limit=40'
                 f'&cursor={deep}', None, None),
                ('read', 'assets meta x20', f'/api/media/assets?ids={some_assets}', None, None),
                ('read', 'image file 200', file_url, None, None),
                ('read', 'image file 304 (If-None-Match)', file_url, None, 'etag'),
                ('search', 'search 模型 + highlights', '/api/content/search?q=模型&limit=20', None, None),
                ('search', 'search 向量 检索 + highlights', '/api/content/search?q=向量%20检索&limit=20', None, None),
                ('search', 'search agent + highlights', '/api/content/search?q=agent&limit=20', None, None),
            ]
            for kind, label, url, before, special in scenarios:
                if 'cursor=None' in url:
                    continue
                headers, status = None, 200
                if special == 'etag':
                    headers, status = {'If-None-Match': f'"{url.rsplit("/", 1)[1].split(".")[0]}"'}, 304
                times, _ = timed(client, url, args.runs, before, headers, status)
                slo = READ_SLO if kind == 'read' else SEARCH_SLO
                p95 = p(times, 0.95)
                rows.append((name, label, len(times), statistics.median(times), p95, p(times, 0.99), max(times), slo,
                             'ok' if p95 <= slo else 'OVER'))
        print('load average (1/5/15 min) at end: %.1f / %.1f / %.1f on %d cores' % (*os.getloadavg(), os.cpu_count()))
        print('| actor | scenario | n | P50 ms | P95 ms | P99 ms | max ms | SLO P95 | |')
        print('|---|---|---|---|---|---|---|---|---|')
        for r in rows:
            print(f'| {r[0]} | {r[1]} | {r[2]} | {r[3]:.1f} | {r[4]:.1f} | {r[5]:.1f} | {r[6]:.1f} | ≤{r[7]:.0f} | {r[8]} |')
        in_process(app, actors, rich, big, args.runs)
        print('load average (1/5/15 min) after in-process: %.1f / %.1f / %.1f' % os.getloadavg())
        app.state.db.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
