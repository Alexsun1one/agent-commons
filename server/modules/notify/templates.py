from collections import OrderedDict


CATEGORIES = OrderedDict((
    ('reply', '回复我'),
    ('mention', '提到我'),
    ('reward', '采纳和奖励'),
    ('achievement', '等级和成就'),
    ('room', '房间和讲堂'),
    ('agent', 'Agent'),
    ('governance', '治理结果'),
    ('system', '系统'),
    ('park', '乐园'),
    ('event', '活动'),
    ('bounty', '悬赏'),
    ('market', '市集'),
    ('dm', '私信'),
    ('announce', '公告'),
    ('social_follow', '新关注'),
    ('social_poke', '戳一戳'),
    ('social_reaction', '动态反应'),
    ('social_share', '动态转发'),
    ('social_join_request', '入组申请'),
    ('social_join_approved', '入组通过'),
))

# 与 GOV-1 compose_notice 的 TITLES 一字不差。
GOV_TITLES = {
    'hide': '你的一条内容已被隐藏',
    'pending_review': '你的一条内容正在等待审核',
    'rate_limit': '你的发布暂时被限速',
    'require_source': '请为你的内容补充来源',
    'delete': '你的一条内容已被删除',
    'ban': '你的账号已暂停使用',
    'deduct': '你被扣除了贡献值',
    'demote': '你的信任等级被下调',
}

FARM_BRIDGE = frozenset((
    'notify.system.farm_stolen',
    'notify.system.farm_helped',
    'notify.system.farm_reminder',
))


class _Safe(dict):
    def __missing__(self, key):
        return ''


def render(source, values):
    """用可信模板渲染事件字段；缺字段留空，不执行表达式。"""
    return source.format_map(_Safe({key: str(value) for key, value in values.items() if value is not None})).strip()


def merge_reply(actor_count, event_count, title):
    people = max(1, int(actor_count))
    events = max(1, int(event_count))
    heading = f'{people} 人回复了你'
    body = f'《{title}》有 {events} 条新回复' if title else f'同一讨论有 {events} 条新回复'
    return heading, body


def merge_park(actor_count, event_count, family):
    people = max(1, int(actor_count))
    events = max(1, int(event_count))
    if family == 'ticket':
        return f'你的车被贴了 {events} 次条', '同类贴条已合并'
    if family == 'visit':
        return f'{people} 位好友停在你的车位', f'共 {events} 次串门'
    return f'{people} 位好友来过你的农场', f'共 {events} 条乐园动态'


def merge_dm(event_count):
    events = max(1, int(event_count))
    return f'你有 {events} 条新私信', ''


def gov_title(kind, fallback=''):
    return GOV_TITLES.get(kind, fallback or '治理结果已更新')


def build_daily_digest(notifications, day):
    """把一天的通知变成可复用结构；无数据库、时钟或外发副作用。"""
    groups = []
    total = 0
    unread = 0
    by_category = {key: [] for key in CATEGORIES}
    for source in notifications:
        item = dict(source)
        category = item.get('category')
        if category not in by_category:
            continue
        total += 1
        unread += int(not bool(item.get('read_at')))
        by_category[category].append({
            'id': item.get('id'),
            'title': item.get('title', ''),
            'body': item.get('body', ''),
            'link': item.get('link'),
            'occurred_at': item.get('occurred_at'),
        })
    for category, label in CATEGORIES.items():
        items = by_category[category]
        if items:
            groups.append({'category': category, 'label': label, 'count': len(items), 'items': items[:5]})
    return {
        'date': str(day),
        'title': '昨天你错过了什么',
        'total': total,
        'unread': unread,
        'categories': groups,
    }
