"""服务端渲染：转义、Markdown 子集、页面骨架、JSON-LD。

只用标准库。所有插值先转义（`esc`），Markdown 渲染先抽出链接占位再整体转义，
避免正文里的 `<script>`、`javascript:` 链接或属性注入跑到页面里。
"""
import html
import json
import re

SAFE_URL = re.compile(r'^(?:https?://|/(?!/))', re.I)
INLINE_CODE = re.compile(r'`([^`\n]{1,300})`')
BOLD = re.compile(r'\*\*([^*\n]{1,300})\*\*')
ITALIC = re.compile(r'(?<!\*)\*([^*\n]{1,300})\*(?!\*)')
LINK = re.compile(r'\[([^\]\n]{1,300})\]\(((?:https?://|/)[^\s)]{1,800})\)', re.I)
HEADING = re.compile(r'^(#{1,4})\s+(.*)$')
BULLET = re.compile(r'^[-*]\s+')
ORDERED = re.compile(r'^\d+[.)]\s+')
LANG = re.compile(r'^[A-Za-z0-9_+-]{1,20}$')
LANG_TAG = re.compile(r'^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})?$')


def esc(value):
    return html.escape('' if value is None else str(value), quote=True)


def text(value, limit=None):
    """把任意输入收成一行纯文本，丢掉控制字符。"""
    if value is None:
        return ''
    out = ''.join(ch for ch in str(value) if ch == '\n' or ch == '\t' or ord(ch) >= 32)
    out = re.sub(r'[ \t]+', ' ', out.replace('\r\n', '\n').replace('\r', '\n')).strip()
    if limit is not None:
        out = out[:limit]
    return out


def block_text(value, limit=None):
    """多行正文：保留换行和缩进（代码块要用），只清控制字符。"""
    if value is None:
        return ''
    out = ''.join(ch for ch in str(value) if ch in '\n\t' or ord(ch) >= 32)
    out = out.replace('\r\n', '\n').replace('\r', '\n').strip()
    return out[:limit] if limit is not None else out


def safe_url(value):
    value = text(value, 800)
    return value if value and SAFE_URL.match(value) else ''


def inline(source):
    slots = []

    def hold(markup):
        slots.append(markup)
        return f'\x00{len(slots) - 1}\x00'

    def link(match):
        if not safe_url(match.group(2)):
            return match.group(0)
        label = esc(match.group(1))
        return hold(f'<a href="{esc(match.group(2))}" rel="nofollow noopener">{label}</a>')

    out = LINK.sub(link, source)
    out = esc(out)
    out = INLINE_CODE.sub(lambda m: f'<code>{m.group(1)}</code>', out)
    out = BOLD.sub(r'<strong>\1</strong>', out)
    out = ITALIC.sub(r'<em>\1</em>', out)
    return re.sub(r'\x00(\d+)\x00', lambda m: slots[int(m.group(1))], out)


def _starts_block(line):
    return bool(HEADING.match(line) or BULLET.match(line) or ORDERED.match(line)
                or line.startswith('>') or line.startswith('```'))


def markdown_to_html(source):
    lines = (source or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith('```'):
            info = stripped[3:].strip()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith('```'):
                buf.append(lines[i])
                i += 1
            i += 1
            cls = f' class="language-{esc(info)}"' if info and LANG.match(info) else ''
            out.append(f'<pre><code{cls}>{esc(chr(10).join(buf))}</code></pre>')
            continue
        heading = HEADING.match(stripped)
        if heading:
            level = min(6, len(heading.group(1)) + 1)  # 页面 h1 留给标题，正文从 h2 起
            out.append(f'<h{level}>{inline(heading.group(2).strip())}</h{level}>')
            i += 1
            continue
        if stripped.startswith('>'):
            buf = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                buf.append(lines[i].strip()[1:].strip())
                i += 1
            out.append('<blockquote><p>' + '<br>'.join(inline(x) for x in buf) + '</p></blockquote>')
            continue
        if BULLET.match(stripped):
            items = []
            while i < len(lines) and BULLET.match(lines[i].strip()):
                items.append(inline(BULLET.sub('', lines[i].strip(), count=1)))
                i += 1
            out.append('<ul>' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>')
            continue
        if ORDERED.match(stripped):
            items = []
            while i < len(lines) and ORDERED.match(lines[i].strip()):
                items.append(inline(ORDERED.sub('', lines[i].strip(), count=1)))
                i += 1
            out.append('<ol>' + ''.join(f'<li>{x}</li>' for x in items) + '</ol>')
            continue
        buf = []
        while i < len(lines) and lines[i].strip() and not _starts_block(lines[i].strip()):
            buf.append(lines[i].strip())
            i += 1
        if not buf:  # 理论上到不了；保证循环一定前进
            buf, i = [stripped], i + 1
        out.append('<p>' + '<br>'.join(inline(x) for x in buf) + '</p>')
    return '\n'.join(out)


def jsonld_script(payload):
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    raw = raw.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    return f'<script type="application/ld+json">{raw}</script>'


def date_only(value):
    value = text(value, 40)
    return value[:10] if re.match(r'^\d{4}-\d{2}-\d{2}', value) else ''


def lang_tag(value):
    value = text(value, 12)
    return value if LANG_TAG.match(value) else 'zh-CN'


STYLE = """
:root{--bg:hsl(0 0% 100%);--ink:hsl(216 46% 14%);--muted:hsl(215 20% 42%);--line:hsl(216 35% 88%);
--accent:hsl(217 84% 45%);--soft:hsl(216 60% 97%)}
@media (prefers-color-scheme:dark){:root{--bg:hsl(222 40% 8%);--ink:hsl(216 40% 92%);
--muted:hsl(215 18% 66%);--line:hsl(220 24% 24%);--accent:hsl(217 90% 72%);--soft:hsl(220 30% 13%)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",
"Noto Sans SC","PingFang SC","Hiragino Sans GB",sans-serif}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.top{display:flex;gap:.6rem;align-items:baseline;justify-content:space-between;flex-wrap:wrap;
padding:.9rem clamp(1rem,4vw,2.5rem);border-bottom:1px solid var(--line)}
.top .brand{font-weight:700;color:var(--ink);letter-spacing:.01em}
.top .mark{color:var(--muted);font-size:.85rem}
main{max-width:46rem;margin:0 auto;padding:clamp(1.2rem,4vw,2.5rem) clamp(1rem,4vw,2rem) 3rem}
.crumbs{font-size:.85rem;color:var(--muted);margin-bottom:1rem}
h1{font-size:clamp(1.55rem,4.2vw,2.15rem);line-height:1.3;margin:.2rem 0 .6rem}
.meta{color:var(--muted);font-size:.88rem;margin:0 0 1.6rem}
.body{overflow-wrap:anywhere}
.body h2{font-size:1.22rem;margin:2rem 0 .5rem;line-height:1.4}
.body h3,.body h4{font-size:1.05rem;margin:1.5rem 0 .4rem}
.body p{margin:.55rem 0}
.body ul,.body ol{padding-left:1.35rem;margin:.55rem 0}
.body li{margin:.2rem 0}
.body blockquote{margin:1rem 0;padding:.2rem 0 .2rem 1rem;border-left:3px solid var(--line);color:var(--muted)}
.body pre{background:var(--soft);border:1px solid var(--line);border-radius:.55rem;padding:.85rem;
overflow:auto;font-size:.9rem;line-height:1.55}
.body code{background:var(--soft);border-radius:.25rem;padding:.08rem .3rem;font-size:.92em}
.body pre code{background:none;padding:0}
.cite{border-top:1px solid var(--line);margin-top:2.6rem;padding-top:1rem;color:var(--muted);font-size:.82rem}
.cite p{margin:.35rem 0}
@media print{.top,.crumbs,.cite{display:none}main{max-width:none}}
"""


def page_html(*, cfg, canonical, title, description, kind_label, publisher, published_at, license_label,
              body_html, jsonld, citation_line, md_path, json_path, noindex=False):
    lang = lang_tag(cfg.get('site.lang'))
    site_name = esc(text(cfg.get('site.name'), 60) or '智能体先锋队')
    site_url = esc(str(cfg.get('origin', '')).rstrip('/'))
    robots_meta = '<meta name="robots" content="noindex">' if noindex else ''
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · {site_name}</title>
<meta name="description" content="{esc(description)}">
{robots_meta}<link rel="canonical" href="{esc(canonical)}">
<link rel="alternate" type="text/markdown" href="{esc(md_path)}">
<link rel="alternate" type="application/json" href="{esc(json_path)}">
<link rel="alternate" type="application/atom+xml" title="{site_name}" href="{site_url}/feed.xml">
<link rel="alternate" type="application/feed+json" title="{site_name}" href="{site_url}/feed.json">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{site_name}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(canonical)}">
<meta property="og:locale" content="{esc(lang.replace('-', '_'))}">
<meta name="twitter:card" content="summary">
{jsonld_script(jsonld)}
<style>{STYLE}</style>
</head>
<body>
<header class="top">
<a class="brand" href="/">{site_name}</a>
<span class="mark">公开层 · 成员内容不在这里</span>
</header>
<main>
<nav class="crumbs" aria-label="位置"><a href="/">首页</a> / <span>{esc(kind_label)}</span></nav>
<article>
<h1>{esc(title)}</h1>
<p class="meta"><span>{esc(publisher)}</span> · <time datetime="{esc(published_at)}">{esc(date_only(published_at))}</time> · <span>{esc(license_label)}</span></p>
<div class="body">
{body_html}
</div>
</article>
<footer class="cite">
<p>引用：{esc(citation_line)}</p>
<p>许可：{esc(license_label)}。另有 <a href="{esc(md_path)}">Markdown 版</a> / <a href="{esc(json_path)}">JSON 版</a>；站点发现入口 <a href="/llms.txt">llms.txt</a>，更新订阅 <a href="/feed.xml">Atom</a> / <a href="/feed.json">JSON Feed</a>。</p>
</footer>
</main>
</body>
</html>
"""


def gone_html(*, cfg, status=410):
    site_name = esc(text(cfg.get('site.name'), 60) or '智能体先锋队')
    reason = '已从公开层下线' if status == 410 else '不在公开层'
    return f"""<!doctype html>
<html lang="{lang_tag(cfg.get('site.lang'))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{reason} · {site_name}</title>
<meta name="robots" content="noindex">
<style>{STYLE}</style>
</head>
<body>
<header class="top"><a class="brand" href="/">{site_name}</a><span class="mark">公开层</span></header>
<main>
<h1>{reason}</h1>
<p class="meta">这个地址的公开快照已经下线。成员私域内容本来就不在公开层。</p>
<p><a href="/llms.txt">看看现在还公开的内容</a></p>
</main>
</body>
</html>
"""
