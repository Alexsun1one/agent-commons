import argparse
import random
import shutil
import statistics
import tempfile
import time

from fastapi.testclient import TestClient

from app import accounts, objects
from app.authz import Actor
from app.main import create_app
from tests.helpers import ORIGIN, make_settings

WORDS = ('模型 智能体 提示词 工作流 检索 向量 部署 评测 推理 微调 数据 开源 代码 知识库 多模态 语音 图像 编排 记忆 工具调用 '
         '上下文 幻觉 对齐 安全 成本 延迟 吞吐 缓存 索引 分词 排序 召回 复现 作品 讨论 房间 直播 教程 笔记 实践').split()
LATIN = 'agent RAG GPT Claude LLM token prompt MCP workflow embedding vector eval'.split()


def sentence(rng, n):
    return '，'.join(''.join(rng.choice(WORDS) for _ in range(3)) + ' ' + rng.choice(LATIN) for _ in range(n)) + '。'


def p(values, q):
    values = sorted(values)
    return values[min(len(values) - 1, int(round(q * (len(values) - 1))))]


def build(app, total, rng):
    db = app.state.db
    with db.write() as conn:
        users = []
        for i in range(200):
            pid = accounts.create_principal(conn, handle=f'u{i:03d}', password_hash='scrypt$x', display_name=f'成员{i}',
                                            level=1 + i % 5, level_source='founder')
            users.append(pid)
        spaces = [accounts.create_space(conn, users[i], f's{i}', f'空间{i}') for i in range(10)]
        for i, pid in enumerate(users):
            if i % 4 == 0:
                accounts.set_membership(conn, spaces[i % 10], pid)
    start = time.perf_counter()
    batch = 2000
    for offset in range(0, total, batch):
        with db.write() as conn:
            for i in range(offset, min(total, offset + batch)):
                author_idx = rng.randrange(40, 200)
                author = Actor(id=users[author_idx], level=5, status='active')
                roll = rng.random()
                kw = {}
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
                objects.create(conn, author, type=rng.choice(('knowledge', 'discussion', 'work')),
                               title=sentence(rng, 1)[:60], content={'body': sentence(rng, 8)}, **kw)
    return users, time.perf_counter() - start


def login(app, pid):
    c = TestClient(app, base_url=ORIGIN)
    with app.state.db.write() as conn:
        token = accounts.create_session(conn, app.state.settings, pid)
    c.cookies.set(app.state.settings.cookie_name, token)
    return c


def measure(client, url, runs):
    times = []
    first = client.get(url)
    assert first.status_code == 200, first.text
    for _ in range(runs):
        t = time.perf_counter()
        r = client.get(url)
        times.append((time.perf_counter() - t) * 1000)
        assert r.status_code == 200
    return times, first.json()


def main(argv=None):
    parser = argparse.ArgumentParser(prog='python3 -m tests.bench')
    parser.add_argument('--objects', type=int, default=50000)
    parser.add_argument('--runs', type=int, default=200)
    args = parser.parse_args(argv)
    rng = random.Random(13)
    tmp = tempfile.mkdtemp(prefix='commons-bench-')
    try:
        app = create_app(make_settings(tmp))
        users, build_s = build(app, args.objects, rng)
        conn = app.state.db.conn()
        conn.execute('ANALYZE')
        print(f'built {args.objects} objects in {build_s:.1f}s')
        actors = {'L1': users[5], 'L3 + space member': users[12], 'L5 + space member': users[4]}
        scenarios = [
            ('list first page', '/api/objects?limit=20'),
            ('list type filter', '/api/objects?type=knowledge&limit=20'),
            ('list + count', '/api/objects?limit=20&count=1'),
            ('search 模型 (very common)', '/api/search?q=模型&limit=20'),
            ('search 智能体 (phrase)', '/api/search?q=智能体&limit=20'),
            ('search 向量 检索 (2 terms)', '/api/search?q=向量%20检索&limit=20'),
            ('search agent (latin prefix)', '/api/search?q=agent&limit=20'),
            ('search rare word', '/api/search?q=幻觉对齐&limit=20'),
            ('search 模型 + count', '/api/search?q=模型&limit=20&count=1'),
        ]
        print('| actor | scenario | n | P50 ms | P95 ms | P99 ms | max ms |')
        print('|---|---|---|---|---|---|---|')
        for name, pid in actors.items():
            client = login(app, pid)
            for label, url in scenarios:
                times, body = measure(client, url, args.runs)
                print(f'| {name} | {label} | {len(times)} | {statistics.median(times):.1f} | {p(times, 0.95):.1f} '
                      f'| {p(times, 0.99):.1f} | {max(times):.1f} |')
            cursor = client.get('/api/objects?limit=20').json()['meta']['next_cursor']
            times, _ = measure(client, f'/api/objects?limit=20&cursor={cursor}', args.runs)
            print(f'| {name} | list page 2 (cursor) | {len(times)} | {statistics.median(times):.1f} '
                  f'| {p(times, 0.95):.1f} | {p(times, 0.99):.1f} | {max(times):.1f} |')
        app.state.db.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
