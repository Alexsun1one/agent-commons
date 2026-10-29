"""降级时的本机规则：不外发，给出和模板同结构的保守结果。调用方看 Result.degraded 区分。"""
import re

from . import redact

_SENTENCE = re.compile(r'[^。！？!?\n]+[。！？!?]?')
_TODO = re.compile(r'(待办|TODO|todo|负责|截止|下周|跟进|action item)')


def _sentences(text, limit):
    found = [s.strip() for s in _SENTENCE.findall(text or '') if s.strip()]
    return found[:limit]


def _clip(text, n):
    text = (text or '').strip()
    return text if len(text) <= n else text[:n - 1] + '…'


def _as_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return '\n'.join(_as_text(v.get('text', '') if isinstance(v, dict) else v) for v in value)
    if isinstance(value, dict):
        return _as_text(value.get('text', ''))
    return ''


def _screen(inputs, reason):
    text = '\n'.join(_as_text(inputs.get(k)) for k in ('title', 'text', 'context_text'))
    sensitive = {c for c, _, _ in redact.find(text, ('idcard', 'bankcard'))}
    if reason == 'refusal':
        return {'suggestion': 'human_review', 'categories': ['other'],
                'reasons': ['模型拒绝处理这条内容，建议治理员人工看一下。'], 'confidence': 0.5}
    if sensitive:
        return {'suggestion': 'human_review', 'categories': ['privacy'],
                'reasons': ['本机规则发现疑似证件号或银行卡号，建议人工复核。'], 'confidence': 0.6}
    return {'suggestion': 'no_issue', 'categories': [],
            'reasons': [f'模型层未运行（{reason}），只做了本机规则检查，以治理规则层的结果为准。'], 'confidence': 0.0}


def local(feature, task, inputs, reason):
    inputs = inputs or {}
    if feature in ('governance.screen_text', 'governance.screen_image'):
        return _screen(inputs, reason)
    if feature == 'talks.transcribe':
        return {'language': inputs.get('language') or 'und', 'text': '', 'segments': []}
    if feature == 'talks.translate':
        segments = inputs.get('segments') or []
        return {'target_lang': inputs.get('target_lang', ''),
                'segments': [{'id': str(s.get('id', i)), 'text': s.get('text', '')} if isinstance(s, dict)
                             else {'id': str(i), 'text': str(s)} for i, s in enumerate(segments)]}
    if feature == 'talks.minutes':
        text = _as_text(inputs.get('transcript'))
        sentences = _sentences(text, 200)
        return {'summary': _clip(''.join(sentences[:3]), 200), 'chapters': [],
                'key_points': [_clip(s, 80) for s in sentences[:5]],
                'action_items': [{'task': _clip(s, 80), 'owner': None, 'due': None}
                                 for s in sentences if _TODO.search(s)][:10],
                'open_questions': []}
    if feature == 'feed.summarize':
        items = inputs.get('items') or []
        first = items[0] if items and isinstance(items[0], dict) else {}
        title = inputs.get('event_title') or first.get('title', '')
        excerpt = first.get('excerpt') or first.get('summary') or ''
        return {'headline': _clip(title, 30), 'summary': _clip(' '.join(_sentences(excerpt, 2)) or title, 200),
                'why_it_matters': '', 'entities': [],
                'source_ids': [str(i.get('id')) for i in items if isinstance(i, dict) and i.get('id') is not None]}
    if feature == 'kb.draft_problem':
        text = _as_text(inputs.get('text'))
        first = (_sentences(text, 1) or [''])[0]
        return {'title': _clip(first, 40), 'phenomenon': _clip(text, 2000), 'error_signature': '', 'tools': [],
                'industry': None, 'suspected_cause': '', 'steps_tried': [],
                'missing_info': ['自动整理暂时不可用，请按问题卡的格式补全环境、报错和复现步骤。']}
    if feature == 'digest.summarize':
        items = [i for i in (inputs.get('items') or []) if isinstance(i, dict)]
        titles = [i.get('title', '') for i in items if i.get('title')]
        head = f'最近有 {len(items)} 条和你有关的动态' if items else '最近没有新的动态'
        return {'headline': head, 'paragraphs': ['、'.join(_clip(t, 30) for t in titles[:5])] if titles else [],
                'highlights': [{'item_id': str(i.get('id')), 'reason': '最新'} for i in items[:3]
                               if i.get('id') is not None]}
    if feature == 'search.assist':
        if task == 'expand':
            query = _clip(str(inputs.get('query', '')), 200)
            return {'queries': [query] if query else [], 'keywords': []}
        return {'answer': '', 'citations': [], 'confidence': 0.0}
    raise ValueError(f'no local fallback for {feature}')
