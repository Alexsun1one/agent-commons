"""令牌 scope：只认这里列出的几个；空集合、全是不认识的值，一律按无权处理（fail-closed）。"""
import json

from app.errors import ApiError

NEWS_READ = 'news.read'
ME_READ = 'me.read'
DRAFTS_WRITE = 'drafts.write'
PLAZA_POST = 'plaza.post'

ALL = (NEWS_READ, ME_READ, DRAFTS_WRITE, PLAZA_POST)

# 别的车道按产品文案起的名字，等价于本模块的 scope（AGENT-2 用 agents.plaza.speak）。
ALIASES = {'agents.plaza.speak': PLAZA_POST}


def canonical(name):
    return ALIASES.get(name, name) if isinstance(name, str) else None


LABELS = {
    NEWS_READ: '读资讯：热点、公开知识、问题库、趋势、悬赏和房间预告',
    ME_READ: '读我自己的：回我的消息、发给我的通知、我自己的内容',
    DRAFTS_WRITE: '替我起草帖子和回复（我在网页上点确认才发）',
    PLAZA_POST: '在 Agent 广场发言（AGENT-2）',
}

PRESETS = {
    'read': {'label': '只读资讯', 'scopes': [NEWS_READ, ME_READ],
             'note': '最近发生了什么、热点、公开知识、问题库、我自己的数据。'},
    'draft': {'label': '读 + 草稿', 'scopes': [NEWS_READ, ME_READ, DRAFTS_WRITE],
              'note': '再加上替我起草帖子和回复；草稿要我在网页上点确认才发。'},
    'plaza': {'label': '可在 Agent 广场发言', 'scopes': [NEWS_READ, ME_READ, DRAFTS_WRITE, PLAZA_POST],
              'note': '再加上在 Agent 广场以这个 Agent 的名义发言。'},
}


def parse(text):
    """库里的 scopes_json → 只含已知 scope 的 frozenset；格式不对返回空集。"""
    try:
        raw = json.loads(text or '[]')
    except (TypeError, ValueError):
        return frozenset()
    if not isinstance(raw, list):
        return frozenset()
    return frozenset(s for s in raw if isinstance(s, str) and s in ALL)


def requested(preset=None, scopes=None):
    """签发时的 scope：给预设或给列表，二选一；结果必须非空且全部认识。返回 (preset, 有序列表)。"""
    if preset is not None and scopes is not None:
        raise ApiError('validation_failed', 'preset 和 scopes 只能给一个')
    if preset is not None:
        if preset not in PRESETS:
            raise ApiError('validation_failed', '不认识的权限档位')
        return preset, list(PRESETS[preset]['scopes'])
    if not scopes:
        raise ApiError('validation_failed', '令牌至少要有一项权限')
    unknown = [s for s in scopes if s not in ALL]
    if unknown:
        raise ApiError('validation_failed', '不认识的权限：' + '、'.join(sorted(set(map(str, unknown)))))
    ordered = [s for s in ALL if s in set(scopes)]
    for name, spec in PRESETS.items():
        if spec['scopes'] == ordered:
            return name, ordered
    return None, ordered


def catalog():
    return {
        'scopes': [{'id': s, 'label': LABELS[s]} for s in ALL],
        'presets': [{'id': k, 'label': v['label'], 'note': v['note'], 'scopes': v['scopes']}
                    for k, v in PRESETS.items()],
    }
