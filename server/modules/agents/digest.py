"""「最近发生了什么」：把几路来源拼成一份结构化简报，加一段模板生成的中文摘要（不调用任何模型）。

Agent 拿到后自己转述给主人。每一段的形状一样：
    {'available': bool, 'count': int, 'items': [...], 'note': str | None}
"""
from app import clock

from . import content, scopes

SECTION_ORDER = ('hot', 'knowledge', 'replies', 'bounties', 'rooms', 'notifications')
SECTION_LABELS = {
    'hot': '热点', 'knowledge': '新知识', 'replies': '回我的消息', 'bounties': '和我技能相关的悬赏',
    'rooms': '快开始的房间', 'notifications': '通知',
}
MEMBER_NOTE = '别的成员的非公开内容默认不提供给外部 Agent（开关 agents.read_member_content 关），只给条数，请到网站查看。'


def _section(items=None, count=None, note=None, available=True):
    items = items or []
    return {'available': available, 'count': len(items) if count is None else count, 'items': items, 'note': note}


def build(tctx, since, per_section=5):
    """tctx: tools.ToolCtx。返回 (简报, 条数)。"""
    conn, owner, agent = tctx.conn, tctx.owner, tctx.agent
    allow = tctx.allow_member
    per = max(1, min(per_section, tctx.budget // len(SECTION_ORDER) or 1))
    sections = {}

    hot, note = content.hot_events(conn, owner, tctx.settings, since=since, limit=per)
    sections['hot'] = _section(hot, note=note, available=note is None)

    public_items, public_note = content.provider_items('public.recent', owner.id, allow, per, conn, since, per)
    count, member_items = content.new_member_objects(conn, owner, since, ('knowledge',), per, allow)
    knowledge = public_items + [dict(m, kind='knowledge') for m in member_items]
    notes = [n for n in (public_note, None if allow or not count else MEMBER_NOTE) if n]
    sections['knowledge'] = _section(knowledge[:per], count=len(public_items) + count, note=' '.join(notes) or None)
    sections['knowledge']['member_count'] = count
    sections['knowledge']['withheld_count'] = 0 if allow else count

    if scopes.ME_READ in agent.scopes:
        rcount, replies = content.replies_to_owner(conn, owner, since, per, allow)
        sections['replies'] = _section(replies, count=rcount, note=None if allow or not rcount else
                                       '回复正文属于别的成员，默认不给外部 Agent；只告诉你谁回在了哪一帖。')
    else:
        sections['replies'] = _section(available=False, note='这个令牌没有 me.read，不读回我的消息。')

    skills = content.owner_skills(conn, agent.id, owner.id)
    items, note = content.provider_items('bounty.open', owner.id, allow, per, conn, owner, skills, per)
    sections['bounties'] = _section(items, note=note, available=note is None)
    sections['bounties']['skills'] = skills

    items, note = content.provider_items('rooms.upcoming', owner.id, allow, per, conn, owner, 48, per)
    sections['rooms'] = _section(items, note=note, available=note is None)

    if scopes.ME_READ in agent.scopes:
        dcount, drafts = content.pending_drafts(conn, owner.id, per)
        notices, ncount, source, note = content.owner_notifications(conn, owner, since, per, allow)
        if source == 'core':
            notices = [n for n in notices if n['kind'] != 'reply']
            ncount -= sections['replies']['count'] if sections['replies']['available'] else 0
        merged = sorted(notices + drafts, key=lambda n: n.get('at') or '', reverse=True)[:per]
        sections['notifications'] = _section(merged, count=max(0, ncount) + dcount, note=note)
        sections['notifications']['pending_drafts'] = dcount
        sections['notifications']['source'] = source
    else:
        sections['notifications'] = _section(available=False, note='这个令牌没有 me.read，不读通知。')

    until = clock.now()
    data = {
        'since': since,
        'until': until,
        'agent': {'id': agent.id, 'name': agent.agent_name},
        'sections': {k: sections[k] for k in SECTION_ORDER},
        'policy': {'member_content': allow, 'note': None if allow else MEMBER_NOTE},
        'summary_zh': summarize(since, sections, allow),
    }
    items = sum(len(s['items']) for s in sections.values())
    return data, items


def summarize(since, sections, allow_member):
    lines = [f'自 {content.local_label(since)}（北京时间）以来：']
    hot = sections['hot']
    if not hot['available']:
        lines.append(f'· 热点：{hot["note"]}')
    elif hot['items']:
        top = hot['items'][0]
        lines.append(f'· 热点 {len(hot["items"])} 条，最热的是「{top["title"]}」（{top["source_count"]} 个来源）。')
    else:
        lines.append('· 热点：这段时间没有新的。')

    kn = sections['knowledge']
    public_n = kn['count'] - kn['member_count']
    if kn['member_count'] and not allow_member:
        lines.append(f'· 新知识：公开层 {public_n} 条；成员写的 {kn["member_count"]} 条按规则不给 Agent，请到网站看。')
    elif kn['count']:
        lines.append(f'· 新知识 {kn["count"]} 条。')
    else:
        lines.append('· 新知识：暂时没有。')

    rp = sections['replies']
    if rp['available']:
        if rp['count']:
            first = rp['items'][0]['on']['title'] if rp['items'] else ''
            tail = f'，最近一条在《{first}》下' if first else ''
            lines.append(f'· 你的帖子收到 {rp["count"]} 条新回复{tail}。')
        else:
            lines.append('· 没有新回复。')

    for key in ('bounties', 'rooms'):
        sec = sections[key]
        if not sec['available']:
            lines.append(f'· {SECTION_LABELS[key]}：{sec["note"]}')
        elif sec['items']:
            lines.append(f'· {SECTION_LABELS[key]} {len(sec["items"])} 个。')
        else:
            lines.append(f'· {SECTION_LABELS[key]}：暂时没有。')

    nt = sections['notifications']
    if nt['available']:
        drafts = nt.get('pending_drafts') or 0
        others = nt['count'] - drafts
        bits = []
        if drafts:
            bits.append(f'{drafts} 份 Agent 草稿等你确认')
        if others > 0:
            bits.append(f'{others} 条其他通知')
        lines.append('· 通知：' + ('、'.join(bits) + '。' if bits else '没有新的。'))
    return '\n'.join(lines)
