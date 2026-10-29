"""主人这一侧：登记 Agent、改名片、发令牌、吊销、看调用记录、确认或丢弃草稿、导出、注销联动。"""
import json
import uuid

from app import audit, clock, objects, outbox, pagination, security
from app.authz import require
from app.errors import ApiError

from . import auth, scopes

MODEL_FAMILIES = ('claude', 'gpt', 'gemini', 'grok', 'deepseek', 'qwen', 'kimi', 'glm', 'llama', 'hermes', 'local',
                  'other')
CLIENTS = ('claude_desktop', 'claude_code', 'chatgpt', 'cursor', 'grok', 'hermes', 'openclaw', 'generic')
PALETTES = ('classic', 'brand-blue', 'graphite', 'mint', 'mist-purple', 'night-sky')
MAX_AGENTS, MAX_AGENTS_L3 = 3, 5
MAX_ACTIVE_TOKENS = 3
ASSIST_TAG = 'Agent 协助'


def max_agents(level):
    return MAX_AGENTS_L3 if level >= 3 else MAX_AGENTS


def _clean_text(value, limit, field, required=False):
    value = ' '.join(str(value or '').split()) if field != 'body' else str(value or '').strip()
    if required and not value:
        raise ApiError('validation_failed', f'{field} 不能为空')
    if len(value) > limit:
        raise ApiError('validation_failed', f'{field} 不超过 {limit} 个字')
    if any(ord(ch) < 32 and ch not in '\n\t' for ch in value):
        raise ApiError('validation_failed', f'{field} 不能含控制字符')
    return value


def _abilities(values):
    out = []
    for v in values or []:
        v = _clean_text(v, 16, 'abilities', required=True)
        if v not in out:
            out.append(v)
    if len(out) > 8:
        raise ApiError('validation_failed', '能做什么最多写 8 项')
    return out


def card(row):
    return {
        'id': row['principal_id'], 'name': row['name'], 'intro': row['intro'], 'model_family': row['model_family'],
        'client': row['client'], 'abilities': json.loads(row['abilities_json']), 'palette': row['palette'],
        'status': row['status'], 'created_at': row['created_at'], 'updated_at': row['updated_at'],
        'owner': {'id': row['owner_id'], 'display_name': row['owner_name']},
    }


def _load(conn, owner_id, agent_id):
    row = conn.execute('SELECT a.*, p.display_name AS owner_name FROM agent_profile a '
                       'JOIN profile p ON p.principal_id = a.owner_id WHERE a.principal_id = ? AND a.owner_id = ?',
                       (agent_id, owner_id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def create_agent(conn, actor, data, request_id=None):
    require(conn, actor, 'agents.create')
    name = _clean_text(data.get('name'), 24, 'name', required=True)
    intro = _clean_text(data.get('intro'), 140, 'intro')
    family = data.get('model_family') or 'other'
    client = data.get('client') or 'generic'
    palette = data.get('palette') or 'classic'
    if family not in MODEL_FAMILIES or client not in CLIENTS or palette not in PALETTES:
        raise ApiError('validation_failed', '模型家族、客户端或配色不认识')
    abilities = _abilities(data.get('abilities'))
    have = conn.execute("SELECT count(*) FROM agent_profile WHERE owner_id = ? AND status != 'retired'",
                        (actor.id,)).fetchone()[0]
    cap = max_agents(actor.level)
    if have >= cap:
        raise ApiError('state_conflict', f'你已经有 {cap} 个 Agent 了（L3 起最多 {MAX_AGENTS_L3} 个）')
    agent_id = str(uuid.uuid4())
    now = clock.now()
    conn.execute("INSERT INTO principal (id, kind, status, created_at) VALUES (?, 'agent', 'active', ?)", (agent_id, now))
    conn.execute('INSERT INTO profile (principal_id, display_name, avatar_ref, level, level_source, level_updated_at, '
                 "updated_at) VALUES (?, ?, ?, 1, 'agent', ?, ?)", (agent_id, name, f'panda:{palette}', now, now))
    conn.execute('INSERT INTO agent_profile (principal_id, owner_id, name, intro, model_family, client, abilities_json, '
                 'palette, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (agent_id, actor.id, name, intro, family, client, json.dumps(abilities, ensure_ascii=False), palette,
                  'active', now, now))
    audit.record(conn, actor.id, 'agents.create', 'agent', agent_id, request_id=request_id,
                 meta={'model_family': family, 'client': client})
    outbox.emit(conn, 'agents.created', 'agent', agent_id, {'owner_id': actor.id}, actor_id=actor.id,
                request_id=request_id)
    return card(_load(conn, actor.id, agent_id))


def update_agent(conn, actor, agent_id, changes, request_id=None):
    row = _load(conn, actor.id, agent_id)
    if row['status'] == 'retired':
        raise ApiError('state_conflict', '这个 Agent 已经退役')
    sets = {}
    if 'name' in changes:
        sets['name'] = _clean_text(changes['name'], 24, 'name', required=True)
    if 'intro' in changes:
        sets['intro'] = _clean_text(changes['intro'], 140, 'intro')
    if 'model_family' in changes:
        if changes['model_family'] not in MODEL_FAMILIES:
            raise ApiError('validation_failed', '不认识的模型家族')
        sets['model_family'] = changes['model_family']
    if 'client' in changes:
        if changes['client'] not in CLIENTS:
            raise ApiError('validation_failed', '不认识的客户端')
        sets['client'] = changes['client']
    if 'palette' in changes:
        if changes['palette'] not in PALETTES:
            raise ApiError('validation_failed', '不认识的配色')
        sets['palette'] = changes['palette']
    if 'abilities' in changes:
        sets['abilities_json'] = json.dumps(_abilities(changes['abilities']), ensure_ascii=False)
    if 'status' in changes:
        if changes['status'] not in ('active', 'paused'):
            raise ApiError('validation_failed', '状态只能是 active 或 paused')
        sets['status'] = changes['status']
    if not sets:
        return card(row)
    now = clock.now()
    sets['updated_at'] = now
    cols = ', '.join(f'{k} = ?' for k in sets)
    conn.execute(f'UPDATE agent_profile SET {cols} WHERE principal_id = ?', (*sets.values(), agent_id))
    if 'name' in sets or 'palette' in sets:
        new = _load(conn, actor.id, agent_id)
        conn.execute('UPDATE profile SET display_name = ?, avatar_ref = ?, updated_at = ? WHERE principal_id = ?',
                     (new['name'], f'panda:{new["palette"]}', now, agent_id))
    audit.record(conn, actor.id, 'agents.update', 'agent', agent_id, request_id=request_id,
                 meta={'fields': sorted(k for k in sets if k != 'updated_at')})
    return card(_load(conn, actor.id, agent_id))


def retire_agent(conn, actor, agent_id, request_id=None):
    row = _load(conn, actor.id, agent_id)
    if row['status'] == 'retired':
        return card(row)
    now = clock.now()
    conn.execute("UPDATE agent_profile SET status = 'retired', retired_at = ?, updated_at = ? WHERE principal_id = ?",
                 (now, now, agent_id))
    conn.execute("UPDATE agent_token SET revoked_at = ?, revoked_by = ?, revoke_reason = 'agent_retired' "
                 'WHERE agent_id = ? AND revoked_at IS NULL', (now, actor.id, agent_id))
    conn.execute("UPDATE agent_draft SET status = 'discarded', decided_at = ? WHERE agent_id = ? AND status = 'pending'",
                 (now, agent_id))
    audit.record(conn, actor.id, 'agents.retire', 'agent', agent_id, request_id=request_id)
    outbox.emit(conn, 'agents.retired', 'agent', agent_id, {'owner_id': actor.id}, actor_id=actor.id,
                request_id=request_id)
    return card(_load(conn, actor.id, agent_id))


def token_meta(row):
    now = clock.now()
    active = row['revoked_at'] is None and row['expires_at'] > now
    return {
        'id': row['id'], 'hint': '…' + row['hint'], 'label': row['label'], 'preset': row['preset'],
        'scopes': [s for s in json.loads(row['scopes_json']) if isinstance(s, str)],
        'created_at': row['created_at'], 'expires_at': row['expires_at'], 'revoked_at': row['revoked_at'],
        'revoke_reason': row['revoke_reason'], 'last_used_at': row['last_used_at'], 'call_count': row['call_count'],
        'daily_call_cap': row['daily_call_cap'], 'daily_item_cap': row['daily_item_cap'], 'active': active,
    }


def issue_token(conn, actor, agent_id, body, request_id=None):
    """返回 (令牌明文, 元数据)。明文不进库、不进审计、不进幂等表。"""
    require(conn, actor, 'agents.token.issue')
    row = _load(conn, actor.id, agent_id)
    if row['status'] == 'retired':
        raise ApiError('state_conflict', '这个 Agent 已经退役，不能再发令牌')
    preset, granted = scopes.requested(body.get('preset'), body.get('scopes'))
    days = body.get('expires_in_days') or 90
    if not isinstance(days, int) or not 1 <= days <= 365:
        raise ApiError('validation_failed', '有效期要在 1 到 365 天之间')
    now_ts = clock.now_ts()
    now = clock.iso(now_ts)
    active = conn.execute('SELECT count(*) FROM agent_token WHERE agent_id = ? AND revoked_at IS NULL AND expires_at > ?',
                          (agent_id, now)).fetchone()[0]
    if active >= MAX_ACTIVE_TOKENS:
        raise ApiError('state_conflict', f'每个 Agent 同时最多 {MAX_ACTIVE_TOKENS} 个有效令牌，先吊销一个')
    call_cap = min(body.get('daily_call_cap') or auth.DAILY_CALLS, auth.DAILY_CALLS)
    item_cap = min(body.get('daily_item_cap') or auth.DAILY_ITEMS, auth.DAILY_ITEMS)
    label = _clean_text(body.get('label'), 40, 'label')
    token = auth.new_token()
    token_id = str(uuid.uuid4())
    conn.execute('INSERT INTO agent_token (id, agent_id, token_hash, hint, label, preset, scopes_json, daily_call_cap, '
                 'daily_item_cap, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (token_id, agent_id, security.token_hash(token), token[-4:], label, preset,
                  auth.scopes_json(granted), call_cap, item_cap, actor.id, now, clock.iso(now_ts + days * 86400)))
    audit.record(conn, actor.id, 'agents.token.issue', 'agent_token', token_id, request_id=request_id,
                 meta={'agent': agent_id, 'scopes': granted, 'days': days})
    meta = token_meta(conn.execute('SELECT * FROM agent_token WHERE id = ?', (token_id,)).fetchone())
    return token, meta


def revoke_token(conn, actor, agent_id, token_id, request_id=None):
    _load(conn, actor.id, agent_id)
    row = conn.execute('SELECT * FROM agent_token WHERE id = ? AND agent_id = ?', (token_id, agent_id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['revoked_at'] is None:
        conn.execute("UPDATE agent_token SET revoked_at = ?, revoked_by = ?, revoke_reason = 'owner' WHERE id = ?",
                     (clock.now(), actor.id, token_id))
        audit.record(conn, actor.id, 'agents.token.revoke', 'agent_token', token_id, request_id=request_id,
                     meta={'agent': agent_id})
    return token_meta(conn.execute('SELECT * FROM agent_token WHERE id = ?', (token_id,)).fetchone())


def call_rows(conn, agent_id, after=None, limit=20):
    where, params = 'agent_id = ?', [agent_id]
    if after:
        where += ' AND (at, id) < (?, ?)'
        params += [after[0], after[1]]
    return conn.execute(f'SELECT id, token_id, tool, transport, at, items, result FROM agent_call_log WHERE {where} '
                        'ORDER BY at DESC, id DESC LIMIT ?', (*params, limit)).fetchall()


def call_dto(row):
    return {'id': row['id'], 'token_id': row['token_id'], 'tool': row['tool'], 'transport': row['transport'],
            'at': row['at'], 'items': row['items'], 'result': row['result']}


def calls_page(conn, settings, actor, agent_id, cursor, limit):
    _load(conn, actor.id, agent_id)
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('agent_calls', agent_id)
    after = pagination.decode(settings, cursor, actor.id, qhash)
    rows = call_rows(conn, agent_id, after, size + 1)
    rows, next_cursor = pagination.page(settings, actor.id, qhash, rows, size, lambda r: [r['at'], r['id']])
    return [call_dto(r) for r in rows], next_cursor


def draft_dto(row):
    return {'id': row['id'], 'agent': {'id': row['agent_id'], 'name': row['agent_name'], 'palette': row['palette']},
            'kind': row['kind'], 'object_type': row['object_type'], 'root_id': row['root_id'],
            'root_title': row['root_title'], 'title': row['title'], 'body': row['body'],
            'tags': json.loads(row['tags_json']), 'status': row['status'], 'created_at': row['created_at'],
            'decided_at': row['decided_at'], 'object_id': row['object_id']}


DRAFT_SELECT = ('SELECT d.*, a.name AS agent_name, a.palette, rv.title AS root_title FROM agent_draft d '
                'JOIN agent_profile a ON a.principal_id = d.agent_id '
                'LEFT JOIN object_head rh ON rh.id = d.root_id '
                'LEFT JOIN object_version rv ON rv.object_id = rh.id AND rv.version = rh.current_version ')


def list_drafts(conn, actor, status='pending', limit=50):
    if status not in ('pending', 'all'):
        raise ApiError('validation_failed', 'status 只能是 pending 或 all')
    where = 'd.owner_id = ?' + (" AND d.status = 'pending'" if status == 'pending' else '')
    rows = conn.execute(f'{DRAFT_SELECT}WHERE {where} ORDER BY d.created_at DESC LIMIT ?', (actor.id, limit)).fetchall()
    return [draft_dto(r) for r in rows]


def _draft(conn, actor, draft_id):
    row = conn.execute(f'{DRAFT_SELECT}WHERE d.id = ? AND d.owner_id = ?', (draft_id, actor.id)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    if row['status'] != 'pending':
        raise ApiError('state_conflict', '这份草稿已经处理过了')
    return row


def confirm_draft(conn, actor, draft_id, changes, request_id=None):
    """以主人身份发出草稿，标签里加「Agent 协助」。权限照核心层规则判断（主人当前能不能发这类内容）。"""
    row = _draft(conn, actor, draft_id)
    body = _clean_text(changes.get('body') if changes.get('body') is not None else row['body'], 20000, 'body',
                       required=True)
    tags = [t for t in json.loads(row['tags_json']) if isinstance(t, str) and t != ASSIST_TAG][:9] + [ASSIST_TAG]
    if row['kind'] == 'reply':
        root_title = row['root_title'] or ''
        title = ('回复：' + root_title)[:200] if root_title else '回复'
        object_id = objects.create(conn, actor, type='reply', title=title, content={'body': body, 'tags': [ASSIST_TAG]},
                                   root_id=row['root_id'], request_id=request_id)
    else:
        title = _clean_text(changes.get('title') if changes.get('title') is not None else row['title'], 200,
                            'title', required=True)
        object_id = objects.create(conn, actor, type=row['object_type'], title=title,
                                   content={'body': body, 'tags': tags}, request_id=request_id)
    now = clock.now()
    conn.execute("UPDATE agent_draft SET status = 'confirmed', decided_at = ?, object_id = ? WHERE id = ?",
                 (now, object_id, draft_id))
    audit.record(conn, actor.id, 'agents.draft.confirm', 'agent_draft', draft_id, request_id=request_id,
                 meta={'object': object_id, 'agent': row['agent_id']})
    outbox.emit(conn, 'agents.draft_confirmed', 'object', object_id, {'agent_id': row['agent_id'], 'draft_id': draft_id},
                actor_id=actor.id, request_id=request_id)
    return {'draft_id': draft_id, 'status': 'confirmed', 'object_id': object_id, 'assisted_by': row['agent_name']}


def discard_draft(conn, actor, draft_id, request_id=None):
    row = _draft(conn, actor, draft_id)
    conn.execute("UPDATE agent_draft SET status = 'discarded', decided_at = ? WHERE id = ?", (clock.now(), draft_id))
    audit.record(conn, actor.id, 'agents.draft.discard', 'agent_draft', draft_id, request_id=request_id,
                 meta={'agent': row['agent_id']})
    return {'draft_id': draft_id, 'status': 'discarded'}


def assisted(conn, actor, object_id):
    """某个对象是不是 Agent 协助发出的（先过可见性，看不见一律 404）。"""
    objects.load_visible(conn, actor, object_id)
    row = conn.execute("SELECT a.name, a.palette, a.principal_id FROM agent_draft d JOIN agent_profile a "
                       "ON a.principal_id = d.agent_id WHERE d.object_id = ? AND d.status = 'confirmed'",
                       (object_id,)).fetchone()
    if row is None:
        return {'object_id': object_id, 'assisted': False}
    return {'object_id': object_id, 'assisted': True, 'label': ASSIST_TAG,
            'agent': {'id': row['principal_id'], 'name': row['name'], 'palette': row['palette']}}


def mine(conn, actor):
    rows = conn.execute('SELECT a.*, p.display_name AS owner_name FROM agent_profile a '
                        'JOIN profile p ON p.principal_id = a.owner_id WHERE a.owner_id = ? '
                        "ORDER BY a.status = 'retired', a.created_at", (actor.id,)).fetchall()
    agents = []
    for row in rows:
        data = card(row)
        data['tokens'] = [token_meta(t) for t in conn.execute(
            'SELECT * FROM agent_token WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20', (row['principal_id'],))]
        data['recent_calls'] = [call_dto(c) for c in call_rows(conn, row['principal_id'], limit=10)]
        today = conn.execute('SELECT coalesce(sum(u.calls), 0), coalesce(sum(u.items), 0) FROM agent_usage_day u '
                             'JOIN agent_token t ON t.id = u.token_id WHERE t.agent_id = ? AND u.day = ?',
                             (row['principal_id'], auth.utc_day())).fetchone()
        data['usage_today'] = {'calls': today[0], 'items': today[1]}
        agents.append(data)
    return {
        'agents': agents,
        'drafts': list_drafts(conn, actor),
        'limits': {'max_agents': max_agents(actor.level), 'max_active_tokens': MAX_ACTIVE_TOKENS,
                   'daily_calls': auth.DAILY_CALLS, 'daily_items': auth.DAILY_ITEMS},
    }


def export(conn, actor):
    agents = conn.execute('SELECT * FROM agent_profile WHERE owner_id = ? ORDER BY created_at', (actor.id,)).fetchall()
    out = []
    for a in agents:
        tokens = conn.execute('SELECT * FROM agent_token WHERE agent_id = ? ORDER BY created_at',
                              (a['principal_id'],)).fetchall()
        out.append({
            'id': a['principal_id'], 'name': a['name'], 'intro': a['intro'], 'model_family': a['model_family'],
            'client': a['client'], 'abilities': json.loads(a['abilities_json']), 'palette': a['palette'],
            'status': a['status'], 'created_at': a['created_at'],
            'tokens': [token_meta(t) for t in tokens],
            'calls': [call_dto(c) for c in call_rows(conn, a['principal_id'], limit=1000)],
        })
    drafts = conn.execute(f'{DRAFT_SELECT}WHERE d.owner_id = ? ORDER BY d.created_at', (actor.id,)).fetchall()
    return {'agents': out, 'drafts': [draft_dto(d) for d in drafts]}


def on_principal_event(conn, event):
    """主人进入注销冷静期或被清理：令牌全部吊销；清理后 Agent 一并退役。"""
    kind = event['event_type']
    owner_id = event['aggregate_id']
    if kind in ('principal.deletion_requested', 'principal.deleted'):
        auth.revoke_owner_tokens(conn, owner_id, 'owner_inactive')
    if kind == 'principal.deleted':
        now = clock.now()
        ids = [r[0] for r in conn.execute('SELECT principal_id FROM agent_profile WHERE owner_id = ?', (owner_id,))]
        conn.execute("UPDATE agent_profile SET status = 'retired', retired_at = coalesce(retired_at, ?), updated_at = ? "
                     'WHERE owner_id = ?', (now, now, owner_id))
        conn.execute("UPDATE agent_draft SET status = 'discarded', decided_at = ? WHERE owner_id = ? AND status = 'pending'",
                     (now, owner_id))
        for agent_id in ids:
            conn.execute("UPDATE principal SET status = 'deleted', deleted_at = ? WHERE id = ? AND status != 'deleted'",
                         (now, agent_id))
