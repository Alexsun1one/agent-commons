"""把对象版本变成公开快照：Markdown、渲染后的 HTML、JSON-LD 类型与结构化附加值。

快照在发布那一刻定稿，之后原对象再改也不影响它。这里不读数据库，只做纯转换。
"""
import json

from . import render, config

MAX_STEPS = 50
MAX_FAQ = 50
MAX_ITEMS = 100
MAX_TAGS = 20
MAX_EXAMPLES = 20


def _str(value, limit):
    return render.text(value, limit)


def _steps(value):
    out = []
    if not isinstance(value, list):
        return out
    for item in value[:MAX_STEPS]:
        if isinstance(item, str):
            body = _str(item, 4000)
            if body:
                out.append({'name': body[:60], 'text': body})
        elif isinstance(item, dict):
            body = _str(item.get('text') or item.get('body') or '', 4000)
            name = _str(item.get('title') or item.get('name') or '', 120) or body[:60]
            if body or name:
                out.append({'name': name, 'text': body or name})
    return out


def _faq(value):
    out = []
    if not isinstance(value, list):
        return out
    for item in value[:MAX_FAQ]:
        if not isinstance(item, dict):
            continue
        question = _str(item.get('q') or item.get('question') or '', 300)
        answer = _str(item.get('a') or item.get('answer') or '', 4000)
        if question and answer:
            out.append({'q': question, 'a': answer})
    return out


def _items(value):
    out = []
    if not isinstance(value, list):
        return out
    for item in value[:MAX_ITEMS]:
        if not isinstance(item, dict):
            continue
        name = _str(item.get('title') or item.get('name') or '', 200)
        url = render.safe_url(item.get('url'))
        if name:
            out.append({'name': name, 'url': url})
    return out


def _links(value):
    out = []
    if not isinstance(value, list):
        return out
    for item in value[:MAX_ITEMS]:
        if not isinstance(item, dict):
            continue
        label = _str(item.get('label') or item.get('title') or '', 200)
        url = render.safe_url(item.get('url'))
        if label and url:
            out.append({'label': label, 'url': url})
    return out


def _tags(value):
    out = []
    if not isinstance(value, list):
        return out
    for item in value[:MAX_TAGS]:
        tag = _str(item, 32)
        if tag:
            out.append(tag)
    return out


def _examples(value):
    out = []
    if not isinstance(value, list):
        return out
    for item in value[:MAX_EXAMPLES]:
        if not isinstance(item, dict):
            continue
        cleaned = {}
        for key in ('input', 'output', 'comparison_bad', 'comparison_good', 'caption'):
            text = render.block_text(item.get(key) or '', 8000)
            if text:
                cleaned[key] = text
        if cleaned:
            out.append(cleaned)
    return out


def _answer(content, faq):
    value = content.get('accepted_answer') or content.get('answer') or content.get('solution')
    if isinstance(value, dict):
        value = value.get('text') or value.get('body') or value.get('answer')
    answer = render.block_text(value or '', 20_000)
    if not answer and faq:
        answer = faq[0]['a']
    return answer


def _body_for(kind, content):
    explicit = content.get('body') or content.get('text')
    if explicit:
        return render.block_text(explicit, 200_000)
    fields = {
        'qa': ('phenomenon', 'error_signature'),
        'skill': ('purpose', 'skill_md', 'before', 'after'),
        'prompt': ('use_when', 'template'),
        'component': ('strengths', 'choose_when', 'avoid_when', 'usage_code', 'demo_markup'),
        'product': ('use_when', 'structure', 'pitfalls'),
    }.get(kind, ())
    parts = [render.block_text(content.get(key) or '', 50_000) for key in fields]
    return '\n\n'.join(part for part in parts if part)[:200_000]


def jsonld_type(kind, content):
    if kind == 'qa':
        return 'QAPage'
    if kind in ('knowledge', 'skill') and _steps(content.get('steps')):
        return 'HowTo'
    if kind in ('skill', 'prompt', 'component', 'product'):
        return 'CreativeWork'
    if kind == 'talk':
        return 'VideoObject' if render.safe_url(content.get('video_url') or content.get('video')) else 'Event'
    if kind == 'event':
        return 'Event'
    if kind == 'discussion':
        return 'DiscussionForumPosting'
    if kind == 'trend':
        return 'Dataset'
    if kind == 'term':
        return 'DefinedTerm'
    if kind == 'hot':
        return 'NewsArticle'
    if kind == 'tool':
        return 'SoftwareApplication'
    return 'Article'


def build(kind, title, content, summary_override=None):
    """返回 markdown / html / summary / search_text / jsonld_type / meta。"""
    content = content if isinstance(content, dict) else {}
    title = ' '.join(_str(title, 200).split())
    summary = _str(summary_override or content.get('summary') or '', 500)
    body = _body_for(kind, content)
    steps = _steps(content.get('steps'))
    faq = _faq(content.get('faq'))
    items = _items(content.get('items'))
    links = _links(content.get('links'))
    tags = _tags(content.get('tags'))
    examples = _examples(content.get('examples'))
    accepted_answer = _answer(content, faq)
    transcript = render.block_text(content.get('transcript') or '', 200_000)

    blocks = []
    if summary:
        blocks.append(summary)
    if body:
        blocks.append(body)
    if steps:
        blocks.append('## 步骤\n\n' + '\n'.join(f'{i}. {s["text"]}' for i, s in enumerate(steps, 1)))
    if faq:
        blocks.append('## 常见问题\n\n' + '\n\n'.join(f'### {f["q"]}\n\n{f["a"]}' for f in faq))
    if accepted_answer and kind == 'qa':
        blocks.append('## 采纳解法\n\n' + accepted_answer)
    if items:
        lines = [f'- {i["name"]}' + (f'（[链接]({i["url"]})）' if i['url'] else '') for i in items]
        blocks.append('## 条目\n\n' + '\n'.join(lines))
    if transcript:
        blocks.append('## 逐字稿\n\n' + transcript)
    if examples:
        example_blocks = []
        for index, example in enumerate(examples, 1):
            lines = [f'### 示例 {index}']
            for key, label in (('input', '输入'), ('output', '输出'),
                               ('comparison_bad', '反例'), ('comparison_good', '改进后')):
                if example.get(key):
                    lines.append(f'**{label}**\n\n{example[key]}')
            if example.get('caption'):
                lines.append(example['caption'])
            example_blocks.append('\n\n'.join(lines))
        blocks.append('## 输入输出示例\n\n' + '\n\n'.join(example_blocks))
    if links:
        blocks.append('## 参考链接\n\n' + '\n'.join(f'- [{ln["label"]}]({ln["url"]})' for ln in links))
    if tags:
        blocks.append('标签：' + ' '.join(f'`{t}`' for t in tags))
    body_markdown = '\n\n'.join(blocks).strip()
    if not summary:
        summary = _str(body_markdown.lstrip('# ').split('\n', 1)[0], 200)

    markdown = f'# {title}\n\n{body_markdown}\n' if body_markdown else f'# {title}\n'
    html = render.markdown_to_html(body_markdown)
    search = ' '.join([title, body_markdown, ' '.join(tags)]).lower()

    meta = {
        'steps': steps,
        'faq': faq,
        'items': items,
        'links': links,
        'tags': tags,
        'examples': examples,
        'question': _str(content.get('question') or content.get('phenomenon')
                         or (faq[0]['q'] if faq else '') or title, 500),
        'accepted_answer': accepted_answer,
        'transcript': transcript[:20000],
        'thumbnail_url': render.safe_url(content.get('thumbnail_url') or content.get('thumbnail')),
        'video_url': render.safe_url(content.get('video_url') or content.get('video')),
        'application_category': _str(content.get('application_category') or '', 80),
        'operating_system': _str(content.get('operating_system') or '', 80),
        'dataset': _str(content.get('dataset') or '', 60),
        'start_date': _str(content.get('start_date') or content.get('start_at') or '', 40),
        'end_date': _str(content.get('end_date') or content.get('end_at') or '', 40),
        'location': _str(content.get('location') or '', 200),
    }
    return {
        'markdown': markdown,
        'html': html,
        'summary': summary,
        'search_text': search,
        'jsonld_type': jsonld_type(kind, content),
        'meta': meta,
    }


def _base(row, cfg, origin, kind_label, canonical):
    license_info = config.license_info(row['license'])
    licensed = {'@type': 'CreativeWork', 'name': license_info['label']}
    if license_info['url']:
        licensed = {'@type': 'CreativeWork', 'name': license_info['label'], 'url': license_info['url']}
    site = render.text(cfg.get('site.name'), 60) or '智能体先锋队'
    citation_line = config.citation(cfg.get('citation.format') or '', publisher=row['publisher_name'],
                                    title=row['title'], date=render.date_only(row['published_at']),
                                    url=canonical)
    return {
        '@context': 'https://schema.org',
        '@type': row['jsonld_type'],
        'name': row['title'],
        'headline': row['title'],
        'description': row['summary'],
        'url': canonical,
        'mainEntityOfPage': {'@type': 'WebPage', '@id': canonical},
        'datePublished': row['published_at'],
        'dateModified': row['published_at'],
        'inLanguage': render.lang_tag(cfg.get('site.lang')),
        'author': {'@type': 'Person', 'name': row['publisher_name']},
        'publisher': {'@type': 'Organization', 'name': site, 'url': origin},
        'isPartOf': {'@type': 'WebSite', 'name': site, 'url': origin},
        'isAccessibleForFree': True,
        'license': licensed['url'] if licensed.get('url') else licensed,
        'citation': citation_line,
        'articleSection': kind_label,
    }


def jsonld(row, cfg, origin, kind_label, canonical):
    meta = {}
    try:
        meta = json.loads(row['meta_json'] or '{}')
    except ValueError:
        meta = {}
    data = _base(row, cfg, origin, kind_label, canonical)
    typ = row['jsonld_type']
    if typ == 'HowTo':
        data['step'] = [{'@type': 'HowToStep', 'position': i, 'name': s['name'], 'text': s['text']}
                        for i, s in enumerate(meta.get('steps', []), 1)]
    elif typ == 'QAPage':
        question = meta.get('question') or row['title']
        answer = meta.get('accepted_answer') or row['summary']
        data['mainEntity'] = {'@type': 'Question', 'name': question,
                              'acceptedAnswer': {'@type': 'Answer', 'text': answer}}
    elif typ == 'VideoObject':
        data['uploadDate'] = row['published_at']
        if meta.get('transcript'):
            data['transcript'] = meta['transcript']
        if meta.get('thumbnail_url'):
            data['thumbnailUrl'] = meta['thumbnail_url']
        if meta.get('video_url'):
            data['contentUrl'] = meta['video_url']
    elif typ == 'NewsArticle':
        # 热点只放本站写的摘要和来源链接，不镜像原文。
        data['articleBody'] = row['summary']
        data['citation'] = [link['url'] for link in meta.get('links', []) if link.get('url')]
    elif typ == 'Event':
        data['startDate'] = meta.get('start_date') or row['published_at']
        if meta.get('end_date'):
            data['endDate'] = meta['end_date']
        if meta.get('location'):
            data['location'] = {'@type': 'VirtualLocation', 'name': meta['location'], 'url': canonical}
        if meta.get('transcript'):
            data['subjectOf'] = {'@type': 'CreativeWork', 'name': f'{row["title"]}逐字稿',
                                 'text': meta['transcript']}
    elif typ == 'Dataset':
        data['creator'] = {'@type': 'Organization', 'name': render.text(cfg.get('site.name'), 60) or '智能体先锋队'}
        name = meta.get('dataset') or ''
        if name:
            data['distribution'] = [
                {'@type': 'DataDownload', 'contentUrl': config.public_url(origin, f'/datasets/{name}.csv'),
                 'encodingFormat': 'text/csv'},
                {'@type': 'DataDownload', 'contentUrl': config.public_url(origin, f'/datasets/{name}.json'),
                 'encodingFormat': 'application/json'},
            ]
    elif typ == 'DefinedTerm':
        data['termCode'] = row['slug']
        data['inDefinedTermSet'] = {'@type': 'DefinedTermSet', 'name': render.text(cfg.get('site.name'), 60),
                                    'url': origin}
    elif typ == 'SoftwareApplication':
        data['applicationCategory'] = meta.get('application_category') or 'DeveloperApplication'
        data['operatingSystem'] = meta.get('operating_system') or 'Web'
    tags = meta.get('tags') or []
    if tags:
        data['keywords'] = ', '.join(tags)
    return data


def normalized(row, cfg, origin):
    """同一对象的稳定 JSON 表示；只用公开快照字段。"""
    canonical = config.public_url(origin, f'/p/{row["kind"]}/{row["slug"]}')
    try:
        structured = json.loads(row['meta_json'] or '{}')
    except ValueError:
        structured = {}
    citation_line = config.citation(cfg.get('citation.format') or '', publisher=row['publisher_name'],
                                    title=row['title'], date=render.date_only(row['published_at']),
                                    url=canonical)
    return {
        'schema_version': config.SCHEMA_VERSION,
        'id': canonical,
        'type': row['kind'],
        'title': row['title'],
        'summary': row['summary'],
        'canonical_url': canonical,
        'representations': {
            'html': canonical,
            'json': canonical + '.json',
            'markdown': canonical + '.md',
        },
        'published_at': row['published_at'],
        'updated_at': row['published_at'],
        'author': {'name': row['publisher_name']},
        'license': config.license_info(row['license']),
        'attribution': {
            'source': '先锋',
            'required_text': '来源：先锋',
            'citation': citation_line,
            'canonical_url': canonical,
        },
        'content': {'markdown': row['markdown'], 'structured': structured},
    }
