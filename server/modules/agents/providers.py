"""别的模块给 Agent 工具供数的登记处（延迟接入：模块没合并时，对应的一段返回空并注明）。

别的模块在自己的 router.py 顶层登记即可，不需要改本模块：

    from modules.agents import providers
    providers.register('bounty.open', fn)

已约定的名字和签名（返回的条目都是 dict，形状见 ITEM_KEYS；本模块会再按「成员内容」规则裁剪一遍）：

    'public.search'          fn(conn, query, kind, limit)            -> [item]   公开层检索（OPEN-1），kind: knowledge|problem|None
    'public.recent'          fn(conn, since, limit)                  -> [item]   公开层新发布（OPEN-1）
    'public.trends'          fn(conn, limit)                         -> dict     已审聚合数据（OPEN-1 public_dataset）：
                                                                                {'title', 'week', 'rows': [{'label', 'value', 'delta'}], 'url'}
    'kb.search'              fn(conn, owner_actor, query, limit)     -> [item]   问题库检索（KB-1），已按 visible_predicate 过滤
    'bounty.open'            fn(conn, owner_actor, skills, limit)    -> [item]   进行中的悬赏（BOUNTY-1）；skills 是关键词列表
    'rooms.upcoming'         fn(conn, owner_actor, hours, limit)     -> [item]   主人能进、hours 小时内开始的房间（ROOM-1）
    'notifications.for_owner' fn(conn, owner_actor, since, limit)    -> [item]   发给主人的通知（谁做都行）

item 键：id、kind、title、excerpt、author_id、public（是否已在公开层）、at（UTC 时间文本）、url、meta（只放数字/布尔/枚举）。
"""
import importlib.util
import logging

log = logging.getLogger('commons.agents')
PROVIDERS = {}

MODULE_OF = {
    'public': ('modules.public', 'OPEN-1 公开层'),
    'kb': ('modules.kb', 'KB-1 问题库'),
    'bounty': ('modules.bounty', 'BOUNTY-1 悬赏'),
    'rooms': ('modules.rooms', 'ROOM-1 房间'),
    'notifications': (None, '通知中心'),
}

ITEM_KEYS = ('id', 'kind', 'title', 'excerpt', 'author_id', 'public', 'at', 'url', 'meta')


def register(name, fn):
    if not callable(fn):
        raise TypeError('provider must be callable')
    PROVIDERS[name] = fn


def unregister(name):
    PROVIDERS.pop(name, None)


def _module_present(module_name):
    if not module_name:
        return False
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


def lookup(name):
    """-> (fn | None, note | None)。没有登记时 note 说明是「模块未合并」还是「已合并未接入」。"""
    fn = PROVIDERS.get(name)
    if fn is not None:
        return fn, None
    module_name, label = MODULE_OF.get(name.split('.', 1)[0], (None, name))
    if module_name is None:
        return None, f'{label}还没有模块接入（{name}），这一项先返回空。'
    if _module_present(module_name):
        return None, f'{label}已在库里，但还没登记给 Agent 的数据接口（{name}），这一项先返回空。'
    return None, f'{label}还没合并，这一项先返回空。'


def call(name, *args, **kwargs):
    """-> (结果 | None, note | None)。提供方抛错时不连累整份简报，记一句说明。"""
    fn, note = lookup(name)
    if fn is None:
        return None, note
    try:
        return fn(*args, **kwargs), None
    except Exception as exc:  # noqa: BLE001 — 单个来源坏了只影响这一段
        code = getattr(exc, 'code', type(exc).__name__)
        log.warning('agents provider failed name=%s error=%s', name, type(exc).__name__)
        return None, f'{name} 这一项暂时取不到（{code}）。'
