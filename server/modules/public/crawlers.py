"""robots.txt 的生成。名单和欢迎与否都来自 crawler_policy 表，改表即改输出。

规则依据（长短匹配）：`Allow` 与 `Disallow` 同时命中时，取更长的那条。
所以 `/api/` 全禁、`/api/public/` 单独放行；成员区和登录页对所有 UA 全禁。
"""
from . import config, render, store


def _line(value, limit=200):
    return ' '.join(render.text(value, limit).split())


def _group(user_agent, *, welcome, vendor='', purpose='', source_url='', content_signal=''):
    lines = [f'User-agent: {user_agent}']
    note = ' · '.join(x for x in (_line(vendor, 60), _line(purpose, 80)) if x)
    if note:
        lines.append(f'# {note}')
    if source_url:
        lines.append(f'# 来源：{_line(source_url, 300)}')
    if content_signal:
        lines.append(f'Content-Signal: {content_signal}')
    if not welcome:
        lines.append('Disallow: /')
        return lines
    # 通用建议；真正容量仍由 IP + UA 双桶限流控制。
    lines.append('Crawl-delay: 2')
    # 顺序同时照顾两种解析：最长匹配（Google 系）和「第一条命中」（旧实现）。
    # 私有先拦，公开接口的 Allow 放在 /api/ 的 Disallow 之前，最后才是全站 Allow。
    lines.append('Disallow: /api/public/admin/')
    lines.append('Allow: /api/public/')
    for path in config.PRIVATE_PATHS:
        lines.append(f'Disallow: {path}')
    for path in config.PUBLIC_PATHS:
        lines.append(f'Allow: {path}')
    lines.append('Allow: /')
    return lines


def robots_txt(conn, cfg, origin):
    site = _line(cfg.get('site.name'), 60) or '智能体先锋队'
    signal = _line(cfg.get('crawlers.content_signal'), 200)
    lines = [
        f'# robots.txt · {site}',
        '# 公开层：作者主动发布到公开层的内容，以及平台生成的匿名聚合。',
        '# 成员私域、讨论、个人页、原始群聊永远不在公开层；/api/ 只放行 /api/public/ 下的只读接口。',
        f'# 站点：{origin}/',
        '',
    ]
    for row in store.crawlers(conn):
        lines += _group(_line(row['user_agent'], 80), welcome=bool(row['welcome']), vendor=row['vendor'],
                        purpose=row['purpose'], source_url=row['source_url'])
        lines.append('')
    lines += _group('*', welcome=True, content_signal=signal)
    lines += ['', f'Sitemap: {origin}/sitemap.xml', '']
    return '\n'.join(lines)
