"""Tiptap JSON 白名单清洗。节点、标记、属性与 preview/editor.js 的 CommonsEditor.schema() 一一对应。

EDT-1 或其他模块可以直接复用：
    from modules.content.sanitize import sanitize_doc, doc_text
不认识的节点连同子树丢掉，不认识的属性和标记丢掉，链接只留 http(s)，图片只留站内媒体地址。
结构坏到无法修（不是对象、超深、超量）时抛 ApiError。
"""
import re
from urllib.parse import urlsplit

from app.errors import ApiError

MAX_DEPTH = 40
MAX_NODES = 20000
MAX_TEXT = 200_000
HTML_WORK_MAX = 2 * 1024 * 1024

LANGS = ('text', 'bash', 'javascript', 'typescript', 'python', 'json', 'html', 'css', 'sql', 'markdown', 'yaml')
EMOJI = ('up', 'useful', 'learned', 'spark', 'question', 'reproduced', 'favorite', 'cheer', 'smile', 'heart', 'seen',
         'rocket')
LINK_REL = 'noopener nofollow ugc'
REF_ID = re.compile(r'[A-Za-z0-9_-]{1,64}\Z')
MEDIA_SRC = re.compile(r'/api/media/f/[0-9a-f]{64}\.(webp|jpg|avif)\Z')
CONTROL = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
URL_JUNK = re.compile('[\x00-\x20\x7f]')

BLOCK = {'paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule', 'image',
         'knowledgeCard', 'htmlWork'}
INLINE = {'text', 'hardBreak', 'emoji', 'mention'}
CHILDREN = {
    'doc': BLOCK, 'paragraph': INLINE, 'heading': INLINE, 'bulletList': {'listItem'}, 'orderedList': {'listItem'},
    'listItem': BLOCK, 'blockquote': BLOCK, 'codeBlock': {'text'},
}
ATOMS = {'horizontalRule', 'image', 'knowledgeCard', 'htmlWork', 'hardBreak', 'emoji', 'mention'}
MARKS = ('bold', 'italic', 'code', 'highlight', 'link')

SCHEMA = {
    'version': 1,
    'nodes': sorted(set(CHILDREN) | BLOCK | INLINE | {'listItem'}),
    'marks': list(MARKS),
    'langs': list(LANGS),
    'emoji': list(EMOJI),
    'image_src': MEDIA_SRC.pattern,
    'link_protocols': ['http', 'https'],
    'link_rel': LINK_REL,
    'limits': {'max_depth': MAX_DEPTH, 'max_nodes': MAX_NODES, 'max_text': MAX_TEXT, 'html_work_bytes': HTML_WORK_MAX},
}


def clean_text(value, limit, keep_newlines=False):
    if not isinstance(value, str):
        return None
    value = CONTROL.sub('', value)
    if not keep_newlines:
        value = value.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
    return value[:limit]


def safe_href(value):
    if not isinstance(value, str) or len(value) > 2048:
        return None
    value = URL_JUNK.sub('', value)
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if parts.scheme.lower() not in ('http', 'https') or not parts.netloc or '@' in parts.netloc:
        return None
    return value


def _int(value, low, high, default):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        return default
    return value


def _opt_str(value, limit):
    text = clean_text(value, limit)
    return text if text else None


class _Walker:
    def __init__(self):
        self.nodes = 0
        self.chars = 0

    def marks(self, marks):
        out, seen = [], set()
        for mark in marks if isinstance(marks, list) else ():
            kind = mark.get('type') if isinstance(mark, dict) else None
            if kind not in MARKS or kind in seen:
                continue
            if kind == 'link':
                href = safe_href((mark.get('attrs') or {}).get('href'))
                if href is None:
                    continue
                out.append({'type': 'link', 'attrs': {'href': href, 'target': '_blank', 'rel': LINK_REL,
                                                      'class': None}})
            else:
                out.append({'type': kind})
            seen.add(kind)
        if 'code' in seen:
            out = [m for m in out if m['type'] in ('code', 'link')]
        return out

    def attrs(self, kind, attrs):
        a = attrs if isinstance(attrs, dict) else {}
        if kind == 'heading':
            level = a.get('level')
            level = level if level in (2, 3) else (3 if isinstance(level, int) and level > 3 else 2)
            return {'level': level}
        if kind == 'orderedList':
            return {'start': _int(a.get('start'), 1, 9999, 1), 'type': None}
        if kind == 'codeBlock':
            return {'language': a.get('language') if a.get('language') in LANGS else 'text'}
        if kind == 'image':
            src = a.get('src')
            if not isinstance(src, str) or not MEDIA_SRC.match(src):
                return None
            return {'src': src, 'alt': _opt_str(a.get('alt'), 120), 'title': _opt_str(a.get('title'), 120),
                    'width': _int(a.get('width'), 1, 20000, None), 'height': _int(a.get('height'), 1, 20000, None),
                    'caption': clean_text(a.get('caption'), 200) or ''}
        if kind == 'knowledgeCard':
            ref = a.get('refId')
            return {'refId': ref} if isinstance(ref, str) and REF_ID.match(ref) else None
        if kind == 'htmlWork':
            work = a.get('workId')
            if not isinstance(work, str) or not REF_ID.match(work):
                return None
            return {'workId': work, 'title': clean_text(a.get('title'), 60) or '',
                    'bytes': _int(a.get('bytes'), 0, HTML_WORK_MAX, 0)}
        if kind == 'emoji':
            return {'name': a['name']} if a.get('name') in EMOJI else None
        if kind == 'mention':
            ref = a.get('id')
            if not isinstance(ref, str) or not REF_ID.match(ref):
                return None
            return {'id': ref, 'label': clean_text(a.get('label'), 32) or ''}
        return {}

    def node(self, node, allowed, depth, in_code=False):
        if not isinstance(node, dict):
            return None
        kind = node.get('type')
        if kind not in allowed:
            return None
        if depth > MAX_DEPTH:
            raise ApiError('validation_failed', f'正文嵌套超过 {MAX_DEPTH} 层')
        self.nodes += 1
        if self.nodes > MAX_NODES:
            raise ApiError('validation_failed', f'正文节点超过 {MAX_NODES} 个')
        if kind == 'text':
            text = clean_text(node.get('text'), MAX_TEXT, keep_newlines=in_code)
            if not text:
                return None
            self.chars += len(text)
            if self.chars > MAX_TEXT:
                raise ApiError('validation_failed', '正文不超过 20 万字')
            out = {'type': 'text', 'text': text}
            marks = [] if in_code else self.marks(node.get('marks'))
            if marks:
                out['marks'] = marks
            return out
        attrs = self.attrs(kind, node.get('attrs'))
        if attrs is None:
            return None
        out = {'type': kind}
        if attrs:
            out['attrs'] = attrs
        if kind in ATOMS:
            return out
        children = []
        for child in node.get('content') if isinstance(node.get('content'), list) else ():
            cleaned = self.node(child, CHILDREN[kind], depth + 1, in_code=kind == 'codeBlock')
            if cleaned is not None:
                children.append(cleaned)
        if kind == 'listItem' and (not children or children[0]['type'] != 'paragraph'):
            children.insert(0, {'type': 'paragraph'})
        if kind in ('bulletList', 'orderedList', 'blockquote') and not children:
            return None
        if children:
            out['content'] = children
        return out


def sanitize_doc(doc):
    if not isinstance(doc, dict) or doc.get('type') != 'doc':
        raise ApiError('validation_failed', 'doc 必须是 Tiptap 文档（type 为 doc）')
    walker = _Walker()
    cleaned = walker.node(doc, {'doc'}, 0)
    if not cleaned.get('content'):
        cleaned['content'] = [{'type': 'paragraph'}]
    return cleaned


def _text(node, out):
    kind = node.get('type')
    if kind == 'text':
        out.append(node['text'])
    elif kind == 'hardBreak':
        out.append('\n')
    elif kind == 'mention':
        out.append('@' + node['attrs'].get('label', ''))
    elif kind == 'image':
        out.append(' '.join(filter(None, (node['attrs'].get('alt'), node['attrs'].get('caption')))))
    elif kind == 'htmlWork':
        out.append(node['attrs'].get('title', ''))
    for child in node.get('content', ()):
        _text(child, out)
        if child.get('type') in BLOCK or child.get('type') == 'listItem':
            out.append('\n')


def doc_text(doc):
    out = []
    _text(doc, out)
    return re.sub(r'\n{2,}', '\n', ''.join(out)).strip()


def walk(doc, kind):
    """按顺序产出某类节点（只读，给图片、提及、知识卡解析用）。"""
    stack = [doc]
    while stack:
        node = stack.pop()
        if node.get('type') == kind:
            yield node
        stack.extend(reversed(node.get('content', ())))
