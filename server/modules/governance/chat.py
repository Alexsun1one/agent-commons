"""R17-G · 广场消息、私信的举报进治理员队列；R17-H4 · 找搭子的需求帖和邀约同样进队列。

agentchat / dm 各自只存一行举报（含被举报那一条的快照）并发 `*.reported` 事件。这里订阅事件，开一个
事项（target_type 用 `upload` 这一类「非内容」目标，target_id 带 `chat:` / `dm:` 前缀）和一条 gov_report，
治理员在同一个队列里处理。快照不复制进治理表：预览时回头读举报表里那一条。私信只交被举报的那一条。
"""
import json

from app import audit, clock, flags

from . import service

# 事件 -> (目标前缀, gov_report.target_type, 举报表, 举报表里指向被举报对象的列)
SOURCES = {
    'agentchat.reported': ('chat:', 'chat_message', 'chat_report', 'message_id'),
    'dm.reported': ('dm:', 'dm_message', 'dm_report', 'message_id'),
    'social.buddy_post_reported': ('buddy:', 'buddy_post', 'social_buddy_report', 'target_id'),
    'social.buddy_invite_reported': ('buddyinv:', 'buddy_invite', 'social_buddy_report', 'target_id'),
}
BUDDY_LABEL = {'buddy:': '找搭子需求', 'buddyinv:': '搭子邀约'}


def hideable(target_id):
    """治理员能「隐藏」的目标：广场消息和找搭子需求帖。私信、搭子邀约不行。"""
    target = str(target_id or '')
    return target.startswith('chat:') or target.startswith('buddy:')


def hide(conn, target_id):
    """隐藏 / 收起目标，返回撤销要用的旧状态。"""
    if target_id.startswith('chat:'):
        from modules.agentchat import service as chat_service
        return {'status': chat_service.gov_hide(conn, target_id[5:])}
    from modules.social import extras
    return {'gov_hidden': extras.gov_collapse(conn, target_id[6:])}


def unhide(conn, target_id, prev):
    if target_id.startswith('chat:'):
        from modules.agentchat import service as chat_service
        chat_service.gov_unhide(conn, target_id[5:], (prev or {}).get('status'))
    elif target_id.startswith('buddy:') and not (prev or {}).get('gov_hidden'):
        from modules.social import extras
        extras.gov_uncollapse(conn, target_id[6:])
REASON_WORDS = (('spam', ('广告', '刷屏', '垃圾')), ('harassment', ('骚扰', '辱骂', '攻击')),
                ('illegal', ('违法', '违规', '诈骗')), ('privacy', ('隐私', '泄露')),
                ('copyright', ('侵权', '盗用', '版权')))


def reason_code(text):
    for code, words in REASON_WORDS:
        if any(w in text for w in words):
            return code
    return 'other'


def _subject(conn, snapshot):
    sid = snapshot.get('author_id') or snapshot.get('sender_id')
    if not sid or snapshot.get('author_kind', 'human') != 'human':
        return None
    return sid if conn.execute('SELECT 1 FROM principal WHERE id = ?', (sid,)).fetchone() else None


def on_reported(conn, event):
    """幂等：gov_report 的 id 直接用举报表里的 id，事件重放不会开第二条。"""
    prefix, kind, _table, _col = SOURCES[event['event_type']]
    payload = event.get('payload') or {}
    report_id, reporter_id = payload.get('report_id'), payload.get('reporter_id')
    message_id = event['aggregate_id']
    if not report_id or not reporter_id:
        return
    if not (flags.enabled(conn, 'governance.enabled') and flags.enabled(conn, 'gov.reports')):
        return
    if conn.execute('SELECT 1 FROM gov_report WHERE id = ?', (report_id,)).fetchone():
        return
    note = str(payload.get('reason') or '')[:500]
    code = reason_code(note)
    book = service.rulebook(conn)
    level = conn.execute('SELECT level FROM profile WHERE principal_id = ?', (reporter_id,)).fetchone()
    level = level['level'] if level else 1
    policy = book['policy.report_weight']
    agreed, disagreed = service.reporter_history(conn, reporter_id)
    weight = service.report_weight(level, agreed, disagreed, policy['params'])
    case_id, _ = service.open_case(conn, book, source='report', target_type='upload', target_id=prefix + message_id,
                                   target_version=None, subject_id=_subject(conn, payload.get('message') or {}),
                                   category=code, actor_id=reporter_id)
    conn.execute('INSERT INTO gov_report (id, reporter_id, target_type, target_id, target_version, reason_code, note, '
                 'weight, reporter_level, weight_rule_version, case_id, created_at) '
                 'VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)',
                 (report_id, reporter_id, kind, message_id, code, note, weight, level, policy['version'], case_id,
                  clock.now()))
    service.refresh_case(conn, case_id, book)
    audit.record(conn, reporter_id, 'gov.report.create', 'gov_report', report_id, reason=code,
                 meta={'case_id': case_id, 'source': event['event_type']})


def snapshot_preview(conn, case):
    """案件预览：只读举报表里被举报的那一条，文字过一遍脱敏。不是聊天目标返回 None。"""
    for prefix, kind, table, col in SOURCES.values():
        if not str(case['target_id']).startswith(prefix):
            continue
        message_id = case['target_id'][len(prefix):]
        try:
            row = conn.execute(f'SELECT snapshot_json, created_at FROM {table} WHERE {col} = ? '
                               'ORDER BY created_at DESC LIMIT 1', (message_id,)).fetchone()
        except Exception:  # 对应模块没装
            row = None
        if row is None:
            return {'state': 'missing', 'message': '被举报的消息已经找不到了'}
        snap = json.loads(row['snapshot_json'])
        if prefix in BUDDY_LABEL:
            text = '\n'.join(f'{label}：{snap[key]}' for key, label in (
                ('title', '目标'), ('outcome', '产物'), ('schedule', '时间'), ('contribution', '负责'),
                ('partner', '想找'), ('note', '补充')) if snap.get(key))
        else:
            text = snap.get('body') if prefix == 'chat:' else snap.get('text')
        from . import pii
        return {'state': kind,
                'message': '只显示被举报的这一条' + ('，不含该私信会话的其他内容' if prefix == 'dm:' else ''),
                'text': pii.mask(text or '')[0][:2000], 'kind': snap.get('kind') or 'text',
                'has_image': bool(snap.get('image_ref')), 'has_sticker': bool(snap.get('sticker_ref')),
                'sent_at': snap.get('created_at'), 'reported_at': row['created_at']}
    return None


def target_title(case):
    target = str(case['target_id'])
    if target.startswith('chat:'):
        return '广场消息'
    if target.startswith('dm:'):
        return '私信（被举报的一条）'
    for prefix, label in BUDDY_LABEL.items():
        if target.startswith(prefix):
            return label
    return None
