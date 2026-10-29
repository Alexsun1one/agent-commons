"""内容类型的校验与抽文本。正文二选一：`body`（纯文本，兼容 BE-0）或 `doc`（Tiptap JSON，走白名单清洗）。"""
import re

from app import objects
from app.errors import ApiError

from .sanitize import clean_text, doc_text, safe_href, sanitize_doc

ASSET_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
AIGC = ('none', 'assist', 'generated')
REPLY_MAX = 4000
BODY_MAX = 200_000
COMMON = {'body', 'doc', 'summary', 'tags', 'aigc'}
FIELDS = {
    'knowledge': COMMON | {'cover'},
    'discussion': COMMON,
    'work': COMMON | {'cover', 'html_asset', 'links'},
    'agent_card': {'doc', 'summary', 'tags', 'aigc', 'cover', 'what', 'model', 'how', 'reproduce', 'demo', 'links'},
}
CARD_TEXT = (('what', 500, True), ('model', 80, False), ('how', 4000, False), ('reproduce', 8000, False))


def _unknown(content, allowed):
    if not isinstance(content, dict):
        raise ApiError('validation_failed', 'content 必须是对象')
    unknown = set(content) - allowed
    if unknown:
        raise ApiError('unknown_field', f'content 不认识的字段：{", ".join(sorted(unknown))}')


def _asset(value, name):
    if value is None:
        return None
    if not isinstance(value, str) or not ASSET_ID.match(value):
        raise ApiError('validation_failed', f'{name} 必须是上传后得到的编号')
    return value


def _tags(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 10:
        raise ApiError('validation_failed', 'tags 最多 10 个，每个 1 到 32 字')
    out = []
    for tag in value:
        text = clean_text(tag, 64)
        text = text.strip() if text else ''
        if not 1 <= len(text) <= 32:
            raise ApiError('validation_failed', 'tags 最多 10 个，每个 1 到 32 字')
        if text not in out:
            out.append(text)
    return out


def _links(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 10:
        raise ApiError('validation_failed', 'links 最多 10 个')
    out = []
    for link in value:
        href = safe_href(link)
        if href is None:
            raise ApiError('validation_failed', '链接只允许 http 或 https')
        out.append(href)
    return out


def _common(content, allowed):
    _unknown(content, allowed)
    out = {}
    if 'body' in content:
        body = content['body']
        if not isinstance(body, str) or len(body) > BODY_MAX:
            raise ApiError('validation_failed', 'body 必须是不超过 20 万字的文本')
        out['body'] = clean_text(body, BODY_MAX, keep_newlines=True)
    if content.get('doc') is not None:
        out['doc'] = sanitize_doc(content['doc'])
    summary = content.get('summary', '')
    if not isinstance(summary, str) or len(summary) > 500:
        raise ApiError('validation_failed', 'summary 不超过 500 字')
    if summary:
        out['summary'] = clean_text(summary, 500, keep_newlines=True)
    tags = _tags(content.get('tags'))
    if tags or 'tags' in content:
        out['tags'] = tags
    if 'aigc' in content:
        if content['aigc'] not in AIGC:
            raise ApiError('validation_failed', 'aigc 只能是 none、assist 或 generated')
        out['aigc'] = content['aigc']
    for key in ('cover', 'html_asset'):
        if key in allowed and content.get(key) is not None:
            out[key] = _asset(content[key], key)
    if 'links' in allowed and content.get('links'):
        out['links'] = _links(content['links'])
    return out


def validator(kind):
    def validate(content):
        return _common(content, FIELDS[kind])
    return validate


def validate_card(content):
    out = _common(content, FIELDS['agent_card'])
    for key, limit, required in CARD_TEXT:
        value = content.get(key)
        if value is None and not required:
            continue
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ApiError('validation_failed', f'{key} 要有 1 到 {limit} 个字' if required else f'{key} 不超过 {limit} 字')
        out[key] = clean_text(value, limit, keep_newlines=True).strip()
    demo = content.get('demo') or []
    if not isinstance(demo, list) or len(demo) > 8:
        raise ApiError('validation_failed', 'demo 最多 8 个上传件')
    if demo:
        out['demo'] = [_asset(d, 'demo') for d in demo]
    return out


def validate_reply(content):
    _unknown(content, {'body'})
    body = content.get('body')
    if not isinstance(body, str):
        raise ApiError('validation_failed', '回复正文必须是文本')
    body = clean_text(body, REPLY_MAX + 1, keep_newlines=True).strip()
    if not 1 <= len(body) <= REPLY_MAX:
        raise ApiError('validation_failed', f'回复要有 1 到 {REPLY_MAX} 个字')
    return {'body': body}


def main_text(content):
    if 'doc' in content:
        return doc_text(content['doc'])
    return content.get('body', '')


def text(content):
    parts = [content.get('summary', '')]
    parts += [content.get(key, '') for key, _, _ in CARD_TEXT]
    parts += [main_text(content), ' '.join(content.get('tags', []))]
    return '\n'.join(p for p in parts if p).strip()


def reply_text(content):
    return content.get('body', '')


def register():
    """knowledge 若已被别的模块（EDT-1）换掉就不覆盖；模块按名字母序加载，editor 在 content 之后。"""
    for kind in ('discussion', 'work'):
        objects.register_type(kind, validator(kind), text)
    objects.register_type('agent_card', validate_card, text)
    objects.register_type('reply', validate_reply, reply_text)
    current = objects.TYPES.get('knowledge')
    if current is None or current[0] is objects.validate_default:
        objects.register_type('knowledge', validator('knowledge'), text)
