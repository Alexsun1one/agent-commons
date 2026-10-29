"""知识网 / 知识治理页的只读汇总：直接读 kb_problem、kb_link、kb_env，不另建表。

只给调用者看得见的问题（visible_predicate）；两端都看得见的关联才返回。
status：pending 待验证 · verified 已验证 · stale 已过期；stale_hint=1 是「可能过期」提示。
关联 kind：related 相关 · duplicate「from 是 to 的重复」· replacement「from 被 to 替代」。
"""
from app.authz import visible_predicate

NODE_LIMIT = 300
PENDING_DAYS = 14


def _parse(ts):
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except ValueError:
        return None


def graph(conn, actor, now_iso, limit=NODE_LIMIT):
    pred = visible_predicate(actor, 'h')
    base = (
        'FROM kb_problem kp JOIN object_head h ON h.id = kp.object_id '
        'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
        f"WHERE h.lifecycle = 'active' AND {pred.sql}")
    total = conn.execute(f'SELECT count(*) {base}', pred.params).fetchone()[0]
    rows = conn.execute(
        'SELECT kp.object_id AS id, v.title, kp.status, kp.stale_hint, kp.industry_key, kp.created_at, kp.updated_at, '
        '(SELECT count(*) FROM kb_verification x WHERE x.problem_id = kp.object_id AND x.success = 1) AS verified '
        f'{base} ORDER BY kp.updated_at DESC, kp.object_id DESC LIMIT :limit',
        {**pred.params, 'limit': limit}).fetchall()
    ids = [r['id'] for r in rows]
    tools = {}
    links = []
    if ids:
        marks = ','.join('?' * len(ids))
        for r in conn.execute(f'SELECT problem_id, tool_key FROM kb_env WHERE problem_id IN ({marks}) '
                              'ORDER BY tool_key', ids):
            slot = tools.setdefault(r['problem_id'], [])
            if r['tool_key'] not in slot:
                slot.append(r['tool_key'])
        links = [dict(r) for r in conn.execute(
            f'SELECT problem_id AS "from", target_problem_id AS "to", kind FROM kb_link '
            f'WHERE problem_id IN ({marks}) AND target_problem_id IN ({marks}) ORDER BY kind, problem_id',
            ids + ids)]
    now = _parse(now_iso)
    nodes, attention = [], []
    duplicate_of = {l['from']: l['to'] for l in links if l['kind'] == 'duplicate'}
    replaced_by = {l['from']: l['to'] for l in links if l['kind'] == 'replacement'}
    for r in rows:
        node = {'id': r['id'], 'title': r['title'], 'status': r['status'], 'stale_hint': bool(r['stale_hint']),
                'industry_key': r['industry_key'], 'tools': tools.get(r['id'], []),
                'verified': r['verified'], 'updated_at': r['updated_at']}
        nodes.append(node)
        reasons = []
        if r['status'] == 'stale':
            reasons.append('stale')
        elif r['stale_hint']:
            reasons.append('stale_hint')
        if r['status'] == 'pending' and r['created_at']:
            born = _parse(r['created_at'])
            if now and born and (now - born).days >= PENDING_DAYS:
                reasons.append('pending_long')
        if r['id'] in duplicate_of:
            reasons.append('duplicate')
        if r['id'] in replaced_by:
            reasons.append('replaced')
        for reason in reasons:
            attention.append({'id': r['id'], 'reason': reason})
    count = lambda status: sum(1 for n in nodes if n['status'] == status)  # noqa: E731
    return {
        'nodes': nodes, 'links': links, 'attention': attention,
        'summary': {'total': total, 'shown': len(nodes), 'truncated': total > len(nodes),
                    'pending': count('pending'), 'verified': count('verified'), 'stale': count('stale'),
                    'stale_hint': sum(1 for n in nodes if n['stale_hint'] and n['status'] != 'stale'),
                    'pending_days': PENDING_DAYS},
    }
