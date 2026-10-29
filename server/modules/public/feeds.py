"""sitemap（索引 + 分片）、Atom/JSON Feed、llms.txt 与分卷的 llms-full。

全部只列「现在真的能看到」的快照：快照在线、未下线、原对象 active。
"""
import json
import xml.etree.ElementTree as ET

from app import clock

from . import config, render, store

ATOM = 'http://www.w3.org/2005/Atom'
SITEMAP = 'http://www.sitemaps.org/schemas/sitemap/0.9'


def _one_line(value, limit=200):
    return ' '.join(render.text(value, limit).split())


def _link_text(value, limit=200):
    return _one_line(value, limit).replace('[', '（').replace(']', '）')


def canonical_path(row):
    return f'/p/{row["kind"]}/{row["slug"]}'


def canonical_url(origin, row):
    return config.public_url(origin, canonical_path(row))


def _ordered(rows):
    def key(row):
        info = config.kind_info(row['kind'])
        return (info['order'] if info else 999, row['kind'], row['published_at'], row['slug'])
    return sorted(rows, key=key)


# ---- sitemap ----

def sitemap_index(conn, cfg, origin):
    size = config.as_int(cfg, 'sitemap.shard_size')
    root = ET.Element('sitemapindex', {'xmlns': SITEMAP})
    for kind in config.KINDS:
        rows = store.list_live(conn, kind=kind)
        for start in range(0, len(rows), size):
            chunk = rows[start:start + size]
            node = ET.SubElement(root, 'sitemap')
            path = f'/sitemap-{kind}-{start // size + 1}.xml'
            ET.SubElement(node, 'loc').text = config.public_url(origin, path)
            ET.SubElement(node, 'lastmod').text = max(r['published_at'] for r in chunk)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True).decode('utf-8')


def sitemap_shard(conn, cfg, origin, shard, kind=None):
    rows = store.list_live(conn, kind=kind)
    size = config.as_int(cfg, 'sitemap.shard_size')
    total = (len(rows) + size - 1) // size
    if shard < 1 or shard > total:
        return None
    chunk = rows[(shard - 1) * size:shard * size]
    root = ET.Element('urlset', {'xmlns': SITEMAP})
    for row in chunk:
        node = ET.SubElement(root, 'url')
        ET.SubElement(node, 'loc').text = canonical_url(origin, row)
        ET.SubElement(node, 'lastmod').text = row['published_at']
        ET.SubElement(node, 'changefreq').text = 'weekly'
    return ET.tostring(root, encoding='utf-8', xml_declaration=True).decode('utf-8')


# ---- feed ----

def _feed_rows(conn, cfg, kind=None):
    return store.list_live(conn, limit=config.as_int(cfg, 'feed.max_items'), kind=kind)


def atom(conn, cfg, origin, kind=None):
    rows = _feed_rows(conn, cfg, kind)
    site = _one_line(cfg.get('site.name'), 60) or '智能体先锋队'
    info = config.kind_info(kind) if kind else None
    title = f'{site} · {info["label"]}' if info else site
    self_path = f'/feed/{kind}.xml' if kind else '/feed.xml'
    now = max((r['published_at'] for r in rows), default=clock.now())
    root = ET.Element('feed', {'xmlns': ATOM})
    ET.SubElement(root, 'id').text = origin + '/'
    ET.SubElement(root, 'title').text = title
    ET.SubElement(root, 'subtitle').text = _one_line(cfg.get('site.description'), 300)
    ET.SubElement(root, 'updated').text = now
    ET.SubElement(root, 'link', {'rel': 'self', 'type': 'application/atom+xml',
                                 'href': config.public_url(origin, self_path)})
    ET.SubElement(root, 'link', {'rel': 'alternate', 'type': 'text/html', 'href': origin + '/'})
    ET.SubElement(root, 'generator').text = 'commons-public'
    default_license = config.license_info(cfg.get('license.default'))
    if default_license['url']:
        ET.SubElement(root, 'link', {'rel': 'license', 'href': default_license['url']})
    for row in rows:
        entry = ET.SubElement(root, 'entry')
        ET.SubElement(entry, 'id').text = canonical_url(origin, row)
        ET.SubElement(entry, 'title').text = row['title']
        ET.SubElement(entry, 'link', {'rel': 'alternate', 'type': 'text/html',
                                      'href': canonical_url(origin, row)})
        ET.SubElement(entry, 'published').text = row['published_at']
        ET.SubElement(entry, 'updated').text = row['published_at']
        ET.SubElement(entry, 'summary', {'type': 'text'}).text = row['summary']
        info = config.kind_info(row['kind'])
        if info:
            ET.SubElement(entry, 'category', {'term': row['kind'], 'label': info['label']})
        author = ET.SubElement(entry, 'author')
        ET.SubElement(author, 'name').text = row['publisher_name']
    return ET.tostring(root, encoding='utf-8', xml_declaration=True).decode('utf-8')


def json_feed(conn, cfg, origin, kind=None):
    rows = _feed_rows(conn, cfg, kind)
    site = _one_line(cfg.get('site.name'), 60) or '智能体先锋队'
    info = config.kind_info(kind) if kind else None
    title = f'{site} · {info["label"]}' if info else site
    self_path = f'/feed/{kind}.json' if kind else '/feed.json'
    items = []
    for row in rows:
        items.append({
            'id': canonical_url(origin, row),
            'url': canonical_url(origin, row),
            'title': row['title'],
            'summary': row['summary'],
            'content_text': row['summary'],
            'date_published': row['published_at'],
            'date_modified': row['published_at'],
            'authors': [{'name': row['publisher_name']}],
            'tags': [config.kind_info(row['kind'])['label']] if config.kind_info(row['kind']) else [],
        })
    return {
        'version': 'https://jsonfeed.org/version/1.1',
        'title': title,
        'home_page_url': origin + '/',
        'feed_url': config.public_url(origin, self_path),
        'description': _one_line(cfg.get('site.description'), 300),
        'language': render.lang_tag(cfg.get('site.lang')),
        'items': items,
    }


# ---- llms.txt ----

def _license_line(cfg):
    info = config.license_info(cfg.get('license.default'))
    if info['label'] == config.LICENSES['undecided']['label']:
        return '许可：待定（每篇页面标注各自许可）'
    return f'许可：{info["label"]}' + (f'（{info["url"]}）' if info['url'] else '')


def llms_txt(conn, cfg, origin):
    rows = _ordered(store.list_live(conn))
    site = _one_line(cfg.get('site.name'), 60) or '智能体先锋队'
    lines = [f'# {site}', '',
             f'> {_one_line(cfg.get("site.description"), 500)}', '',
             f'站点：{origin}/', _license_line(cfg),
             '引用时请保留每条的 canonical URL，并标注「来源：先锋」。',
             '只收录作者主动公开的内容和匿名聚合；成员私域、身份和原始群聊不在这里。', '']
    groups = {}
    for row in rows:
        groups.setdefault(row['kind'], []).append(row)
    covered = set()
    for title, kinds, frequency, description in config.LLMS_SECTIONS:
        covered.update(kinds)
        lines += [f'## {title}', f'更新：{frequency}。{description}。']
        for kind in kinds:
            if kind in config.KINDS:
                lines.append(f'- [{config.KINDS[kind]["label"]} JSON Feed]('
                             f'{config.public_url(origin, f"/feed/{kind}.json")})')
            for row in groups.get(kind, []):
                suffix = f'：{_one_line(row["summary"], 200)}' if row['summary'] else ''
                lines.append(f'- [{_link_text(row["title"])}]({canonical_url(origin, row)}){suffix}')
        if not any(groups.get(kind) for kind in kinds):
            lines.append('- 暂无已公开内容')
        lines.append('')
    remaining = [row for row in rows if row['kind'] not in covered]
    if remaining:
        lines += ['## 其他公开内容', '更新：内容通过治理初筛后。']
        for row in remaining:
            suffix = f'：{_one_line(row["summary"], 200)}' if row['summary'] else ''
            lines.append(f'- [{_link_text(row["title"])}]({canonical_url(origin, row)}){suffix}')
        lines.append('')
    datasets = store.datasets_latest(conn)
    if datasets:
        lines.append('## 开放数据集')
        for row in datasets:
            name = row['name']
            title = _link_text(f'{name} {row["version"]}')
            csv_url = config.public_url(origin, f'/datasets/{name}.csv')
            json_url = config.public_url(origin, f'/datasets/{name}.json')
            lines.append(f'- [{title}]({csv_url})：CSV；另有 [JSON]({json_url})，{row["row_count"]} 行')
        lines.append('')
    lines += ['## 发现',
              f'- [llms-full.txt]({config.public_url(origin, "/llms-full.txt")})：全部公开内容的 Markdown 合集',
              f'- [sitemap.xml]({config.public_url(origin, "/sitemap.xml")})：按类型拆分的页面清单',
              f'- [feed.xml]({config.public_url(origin, "/feed.xml")})：Atom 订阅；'
              f'[feed.json]({config.public_url(origin, "/feed.json")})：JSON Feed',
              f'- [openapi.json]({config.public_url(origin, "/openapi.json")})：公开只读 API',
              f'- [MCP 资源]({config.public_url(origin, "/mcp/resources.json")})：问题、Skill、提示词与话题数据',
              f'- [mcp/tools.json]({config.public_url(origin, "/mcp/tools.json")})：给 Agent 的只读工具描述',
              f'- [agent.json]({config.public_url(origin, "/.well-known/agent.json")})：Agent 能力卡片', '']
    return '\n'.join(lines)


def _full_header(cfg, origin, part=None, total=None):
    site = _one_line(cfg.get('site.name'), 60) or '智能体先锋队'
    title = f'# {site} · 公开内容合集'
    if part:
        title += f'（第 {part}/{total} 部分）'
    return '\n'.join([title, '', f'> {_one_line(cfg.get("site.description"), 500)}', '',
                      f'站点：{origin}/', _license_line(cfg), ''])


def llms_full_parts(conn, cfg, origin):
    """按字节上限分卷。单篇超过上限时自己占一卷，不切断正文。"""
    rows = _ordered(store.list_live(conn))
    cap = config.as_int(cfg, 'llms.max_bytes')
    header = _full_header(cfg, origin)
    blocks = ['\n' + row['markdown'].rstrip() + '\n\n---\n\n' for row in rows]
    bodies, current = [], ''
    for block in blocks:
        if current and len((header + current + block).encode('utf-8')) > cap:
            bodies.append(current)
            current = block
        else:
            current += block
    if current or not bodies:
        bodies.append(current)
    total = len(bodies)
    if total == 1:
        return [header + bodies[0]]
    return [_full_header(cfg, origin, i, total) + body for i, body in enumerate(bodies, 1)]


def llms_full_index(cfg, origin, total):
    lines = [_full_header(cfg, origin), f'公开内容超过单卷上限，分成 {total} 卷：', '']
    for i in range(1, total + 1):
        lines.append(f'- [llms-full-{i}.txt]({config.public_url(origin, f"/llms-full-{i}.txt")})')
    return '\n'.join(lines) + '\n'
