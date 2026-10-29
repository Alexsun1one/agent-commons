"""Agent 工具：MCP 的 tools/list、tools/call 和 REST 的 /api/agents/v1/tools/* 共用这一份。

每个工具：名字、标题、中英文描述、所需 scope、输入 JSON Schema（只用下面 validate 认识的子集）、条数上限。
处理函数签名：handler(tctx, args) -> (结构化结果 dict, 返回条数, 给模型读的文本)。
"""
import json
import uuid
from dataclasses import dataclass

from app import audit, authz, clock, flags, objects, outbox
from app.errors import ApiError

from . import auth, content, digest, providers, scopes

MAX_ITEMS = 20


class ArgError(Exception):
    def __init__(self, fields):
        super().__init__('invalid arguments')
        self.fields = fields


@dataclass
class ToolCtx:
    conn: object
    db: object
    settings: object
    agent: object
    owner: object
    allow_member: bool
    budget: int
    transport: str
    request_id: str = None
    preview: bool = False


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    scope: str
    schema: dict
    handler: object
    read_only: bool = True


TOOLS = {}


def tool(name, title, description, scope, properties, required=(), read_only=True):
    schema = {'type': 'object', 'properties': properties, 'additionalProperties': False}
    if required:
        schema['required'] = list(required)

    def wrap(fn):
        TOOLS[name] = Tool(name, title, description, scope, schema, fn, read_only)
        return fn
    return wrap


def limit_prop(default=10, maximum=MAX_ITEMS):
    return {'type': 'integer', 'minimum': 1, 'maximum': maximum, 'default': default,
            'description': f'最多返回几条（1–{maximum}）/ max items (1–{maximum})'}


SINCE = {'type': 'string', 'format': 'date-time', 'maxLength': 40,
         'description': '从什么时候算起（ISO 8601，最多回看 14 天）；不传就从这个令牌上次调用算起，第一次默认 24 小时 / '
                        'ISO 8601 start time, at most 14 days back; defaults to the previous call of this token (24h on first call)'}


# ---------------------------------------------------------------- 参数校验（JSON Schema 子集）

def _check(spec, value, loc, errors):
    kind = spec.get('type')
    if kind == 'string':
        if not isinstance(value, str):
            errors.append({'loc': loc, 'type': 'string_type'})
            return None
        value = value.strip()
        if len(value) < spec.get('minLength', 0):
            errors.append({'loc': loc, 'type': 'string_too_short'})
        elif len(value) > spec.get('maxLength', 10_000):
            errors.append({'loc': loc, 'type': 'string_too_long'})
        elif 'enum' in spec and value not in spec['enum']:
            errors.append({'loc': loc, 'type': 'enum'})
        return value
    if kind == 'integer':
        if isinstance(value, bool) or not isinstance(value, int):
            errors.append({'loc': loc, 'type': 'int_type'})
            return None
        if value < spec.get('minimum', value) or value > spec.get('maximum', value):
            errors.append({'loc': loc, 'type': 'out_of_range'})
        return value
    if kind == 'boolean':
        if not isinstance(value, bool):
            errors.append({'loc': loc, 'type': 'bool_type'})
        return value
    if kind == 'array':
        if not isinstance(value, list):
            errors.append({'loc': loc, 'type': 'list_type'})
            return None
        if len(value) > spec.get('maxItems', 100):
            errors.append({'loc': loc, 'type': 'too_long'})
            return None
        return [_check(spec['items'], v, loc + [str(i)], errors) for i, v in enumerate(value)]
    errors.append({'loc': loc, 'type': 'unsupported'})
    return None


def validate(schema, args):
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise ArgError([{'loc': [], 'type': 'object_type'}])
    errors, out = [], {}
    props = schema.get('properties', {})
    for key in args:
        if key not in props:
            errors.append({'loc': [str(key)[:40]], 'type': 'extra_forbidden'})
    for key in schema.get('required', ()):
        if args.get(key) is None:
            errors.append({'loc': [key], 'type': 'missing'})
    for key, spec in props.items():
        if args.get(key) is None:
            if 'default' in spec:
                out[key] = spec['default']
            continue
        out[key] = _check(spec, args[key], [key], errors)
    if errors:
        raise ArgError(errors)
    return out


def coerce_query(schema, query):
    """REST GET 的查询串 → 参数 dict（按 schema 把数字、布尔、逗号分隔的数组转过来）。"""
    out = {}
    props = schema.get('properties', {})
    for key, raw in query.items():
        spec = props.get(key)
        if spec is None:
            out[key] = raw
        elif spec['type'] == 'integer':
            try:
                out[key] = int(raw)
            except ValueError:
                out[key] = raw
        elif spec['type'] == 'boolean':
            out[key] = raw.lower() in ('1', 'true', 'yes') if raw.lower() in ('1', 'true', 'yes', '0', 'false', 'no') \
                else raw
        elif spec['type'] == 'array':
            out[key] = [p for p in raw.split(',') if p]
        else:
            out[key] = raw
    return out


def catalog(granted=None):
    """MCP tools/list 的条目。granted 给了就只列这个令牌能调的。"""
    out = []
    for t in TOOLS.values():
        if granted is not None and t.scope not in granted:
            continue
        out.append({
            'name': t.name,
            'title': t.title,
            'description': t.description,
            'inputSchema': t.schema,
            'annotations': {'title': t.title, 'readOnlyHint': t.read_only, 'destructiveHint': False,
                            'idempotentHint': t.read_only, 'openWorldHint': False},
        })
    return out


def public_catalog():
    return [{'name': t.name, 'title': t.title, 'description': t.description, 'scope': t.scope,
             'read_only': t.read_only} for t in TOOLS.values()]


def _cap(tctx, n):
    return max(0, min(n, tctx.budget, MAX_ITEMS))


def _json(data):
    return json.dumps(data, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------- 读

@tool('whats_new', '最近发生了什么',
      '一次拿到「自上次以来」的社区动态：热点、新知识、回我的消息、和我技能相关的悬赏、快开始的房间、通知，'
      '外加一段可以直接念给主人听的中文摘要。别的成员的非公开内容默认只给条数。 / '
      "Everything new since this token's previous call: AI news, new knowledge, replies to the owner, matching "
      'bounties, upcoming rooms and notifications, plus a ready-to-read Chinese summary. Other members\' '
      'non-public content is reduced to counts by default.',
      scopes.NEWS_READ,
      {'since': SINCE, 'limit_per_section': limit_prop(5, 10)})
def whats_new(tctx, args):
    try:
        default_since = None
        if not args.get('since') and not tctx.preview:
            row = tctx.conn.execute('SELECT whats_new_at FROM agent_token WHERE id = ?',
                                    (tctx.agent.token_id,)).fetchone()
            default_since = row['whats_new_at'] if row else None
        since = content.iso_since(args.get('since') or default_since)
    except ValueError:
        raise ApiError('validation_failed', 'since 要用 ISO 8601 时间，例如 2026-10-25T08:00:00Z') from None
    data, items = digest.build(tctx, since, args['limit_per_section'])
    return data, items, data['summary_zh'] + '\n\n' + _json(data['sections'])


@tool('search_knowledge', '搜知识',
      '按关键词搜社区知识。给公开层的知识和主人自己写的；别的成员可见的知识默认不给，请主人到网站搜。 / '
      "Search community knowledge by keyword. Returns public-layer entries and the owner's own entries; other "
      'members\' entries are withheld by default (ask the owner to search on the site).',
      scopes.NEWS_READ,
      {'query': {'type': 'string', 'minLength': 1, 'maxLength': 100, 'description': '关键词 / keywords'},
       'limit': limit_prop()},
      required=('query',))
def search_knowledge(tctx, args):
    n = _cap(tctx, args['limit'])
    public, note = content.provider_items('public.search', tctx.owner.id, tctx.allow_member, n,
                                          tctx.conn, args['query'], 'knowledge', n)
    own = content.search_objects(tctx.conn, tctx.owner, args['query'], ('knowledge',), n - len(public),
                                 tctx.allow_member)
    results = (public + own)[:n]
    notes = [x for x in (note, None if tctx.allow_member else digest.MEMBER_NOTE) if x]
    data = {'query': args['query'], 'results': results, 'notes': notes,
            'site_search': content.web(tctx.settings, 'knowledge')}
    return data, len(results), _json(data)


@tool('search_solved', '查解决过的问题',
      '拿报错或现象去问题库里找「已经解决过」的问题（KB-1）。给公开层和主人自己的问题卡。 / '
      'Look up already-solved problems by error message or symptom (problem library). Returns public-layer and '
      "the owner's own problem cards.",
      scopes.NEWS_READ,
      {'query': {'type': 'string', 'minLength': 1, 'maxLength': 200,
                 'description': '报错原文或现象 / error text or symptom'},
       'limit': limit_prop()},
      required=('query',))
def search_solved(tctx, args):
    n = _cap(tctx, args['limit'])
    notes = []
    public, note = content.provider_items('public.search', tctx.owner.id, tctx.allow_member, n,
                                          tctx.conn, args['query'], 'problem', n)
    if note:
        notes.append(note)
    kb, kb_note = content.provider_items('kb.search', tctx.owner.id, tctx.allow_member, n - len(public),
                                         tctx.conn, tctx.owner, args['query'], n)
    if kb_note:
        if content.type_registered('problem'):
            kb = content.search_objects(tctx.conn, tctx.owner, args['query'], ('problem',), n - len(public),
                                        tctx.allow_member)
        else:
            notes.append(kb_note)
    if not tctx.allow_member:
        notes.append(digest.MEMBER_NOTE)
    results = (public + kb)[:n]
    data = {'query': args['query'], 'results': results, 'notes': notes,
            'site_search': content.web(tctx.settings, 'solved')}
    return data, len(results), _json(data)


@tool('hot_today', '今天的 AI 热点',
      '最近 48 小时最热的 AI 事件（多源去重、热度排序），带原文链接；主人订阅的方向排在前面。 / '
      "Hottest AI events of the last 48 hours (deduplicated across sources, ranked by heat) with source links; "
      "the owner's subscribed directions come first.",
      scopes.NEWS_READ,
      {'direction': {'type': 'string', 'enum': ['model', 'agent', 'coding', 'opensource', 'product', 'research'],
                     'description': '只看一个方向 / filter by direction'},
       'limit': limit_prop()})
def hot_today(tctx, args):
    n = _cap(tctx, args['limit'])
    since = clock.iso(clock.now_ts() - 48 * 3600)
    events, note = content.hot_events(tctx.conn, tctx.owner, tctx.settings, since=since,
                                      direction=args.get('direction'), limit=n)
    data = {'events': events, 'note': note, 'site': content.web(tctx.settings, 'hot')}
    return data, len(events), _json(data)


@tool('trends', '趋势',
      '社区的匿名趋势：已审的聚合数据（话题和工具热度，OPEN-1 上线后提供），以及各方向热点数的周对比。 / '
      'Anonymous community trends: reviewed aggregate datasets (once the public layer ships) and week-over-week '
      'counts of AI news per direction.',
      scopes.NEWS_READ,
      {'limit': limit_prop()})
def trends(tctx, args):
    n = _cap(tctx, args['limit'])
    reviewed, note = providers.call('public.trends', tctx.conn, n)
    dataset = None
    if isinstance(reviewed, dict):
        rows = []
        for r in (reviewed.get('rows') or [])[:n]:
            if isinstance(r, dict):
                rows.append({'label': content.clip(r.get('label'), 60),
                             'value': r.get('value') if isinstance(r.get('value'), (int, float)) else None,
                             'delta': r.get('delta') if isinstance(r.get('delta'), (int, float)) else None})
        dataset = {'title': content.clip(reviewed.get('title'), 120), 'week': content.clip(reviewed.get('week'), 20),
                   'rows': rows}
    directions, dir_note = content.direction_counts(tctx.conn, tctx.owner, tctx.settings)
    directions = directions[:max(0, n - (len(dataset['rows']) if dataset else 0))]
    data = {'reviewed_dataset': dataset, 'hot_by_direction': directions,
            'notes': [x for x in (note, dir_note) if x]}
    items = len(directions) + (len(dataset['rows']) if dataset else 0)
    return data, items, _json(data)


@tool('list_bounties', '悬赏',
      '进行中的悬赏（BOUNTY-1），默认按主人和这个 Agent 的技能挑。别的成员发的悬赏默认只给编号、积分和截止时间。 / '
      "Open bounties, matched to the owner's and this agent's skills by default. Bounties posted by other "
      'members are reduced to id, reward and deadline unless member content is enabled.',
      scopes.NEWS_READ,
      {'limit': limit_prop(),
       'match_my_skills': {'type': 'boolean', 'default': True, 'description': '按技能挑 / match my skills'}})
def list_bounties(tctx, args):
    n = _cap(tctx, args['limit'])
    skills = content.owner_skills(tctx.conn, tctx.agent.id, tctx.owner.id) if args['match_my_skills'] else []
    items, note = content.provider_items('bounty.open', tctx.owner.id, tctx.allow_member, n,
                                         tctx.conn, tctx.owner, skills, n)
    data = {'bounties': items, 'skills': skills, 'note': note, 'site': content.web(tctx.settings, 'bounty')}
    return data, len(items), _json(data)


@tool('my_notifications', '我的通知',
      '发给主人的通知：别人回了主人的哪一帖、等级变化、等主人确认的 Agent 草稿等。 / '
      "Notifications for the owner: replies to the owner's posts, level changes, agent drafts awaiting "
      'confirmation, and more.',
      scopes.ME_READ,
      {'since': SINCE, 'limit': limit_prop()})
def my_notifications(tctx, args):
    n = _cap(tctx, args['limit'])
    try:
        since = content.iso_since(args.get('since'), default_hours=72)
    except ValueError:
        raise ApiError('validation_failed', 'since 要用 ISO 8601 时间') from None
    owner = tctx.owner
    notices, count, source, note = content.owner_notifications(tctx.conn, owner, since, n, tctx.allow_member)
    dcount, drafts = content.pending_drafts(tctx.conn, owner.id, n)
    merged = sorted(notices + drafts, key=lambda x: x.get('at') or '', reverse=True)[:n]
    withheld = any(x.get('withheld') for x in notices)
    data = {'since': since, 'notifications': merged, 'source': source,
            'counts': {'notifications': count, 'pending_drafts': dcount},
            'notes': [x for x in (note, '回复正文属于别的成员，默认不给外部 Agent。' if withheld else None) if x]}
    return data, len(merged), _json(data)


# ---------------------------------------------------------------- 起草（主人确认后才发）

MAX_PENDING = 20


def _draft_gate(conn, agent):
    if not flags.enabled(conn, 'agents.write.enabled'):
        raise ApiError('capability_unavailable', 'Agent 起草功能还没开放（agents.write.enabled 关着）')
    pending = conn.execute("SELECT count(*) FROM agent_draft WHERE agent_id = ? AND status = 'pending'",
                           (agent.id,)).fetchone()[0]
    if pending >= MAX_PENDING:
        raise ApiError('state_conflict', f'这个 Agent 已有 {MAX_PENDING} 份草稿等主人确认，先请主人处理')


def _save_draft(tctx, kind, object_type, title, body, tags, root_id=None):
    draft_id = str(uuid.uuid4())
    with tctx.db.write() as conn:
        _draft_gate(conn, tctx.agent)
        conn.execute('INSERT INTO agent_draft (id, agent_id, owner_id, token_id, kind, object_type, root_id, title, '
                     "body, tags_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
                     (draft_id, tctx.agent.id, tctx.agent.owner_id, tctx.agent.token_id, kind, object_type, root_id,
                      title, body, json.dumps(tags, ensure_ascii=False), clock.now()))
        audit.record(conn, tctx.agent.id, 'agents.draft.create', 'agent_draft', draft_id,
                     request_id=tctx.request_id, meta={'kind': kind, 'owner': tctx.agent.owner_id})
        what = '回复' if kind == 'reply' else '帖子'
        outbox.emit(conn, 'agents.draft_created', 'agent', tctx.agent.id,
                    {'recipient_id': tctx.agent.owner_id, 'draft_id': draft_id, 'kind': kind,
                     'message': f'你的 Agent「{tctx.agent.agent_name}」起草了一份{what}，等你在「接入 Agent」页确认。'},
                    actor_id=tctx.agent.id, request_id=tctx.request_id)
    data = {'draft_id': draft_id, 'status': 'pending', 'confirm_at': content.web(tctx.settings, 'connect'),
            'note': '草稿已保存。主人在网页上点确认后，才会以主人的名义发出，并标「Agent 协助」。'}
    return data, 1, _json(data)


@tool('draft_post', '起草帖子',
      '替主人起草一篇讨论或知识。不会直接发出：主人要在网页「接入 Agent」里确认，发出后标「Agent 协助」。 / '
      'Draft a discussion or knowledge post for the owner. Nothing is published until the owner confirms it on '
      "the site; confirmed posts are labelled 'Agent-assisted'.",
      scopes.DRAFTS_WRITE,
      {'title': {'type': 'string', 'minLength': 1, 'maxLength': 200, 'description': '标题 / title'},
       'body': {'type': 'string', 'minLength': 1, 'maxLength': 20000, 'description': '正文（纯文本）/ body text'},
       'type': {'type': 'string', 'enum': ['discussion', 'knowledge'], 'default': 'discussion',
                'description': '讨论还是知识 / discussion or knowledge'},
       'tags': {'type': 'array', 'maxItems': 5, 'items': {'type': 'string', 'minLength': 1, 'maxLength': 32},
                'description': '标签，最多 5 个 / up to 5 tags'}},
      required=('title', 'body'), read_only=False)
def draft_post(tctx, args):
    if not authz.can(tctx.conn, tctx.owner, f'object.create.{args["type"]}'):
        raise ApiError('action_not_allowed', '主人现在还不能发这类内容')
    tags = [t for t in (args.get('tags') or []) if t][:5]
    return _save_draft(tctx, 'post', args['type'], args['title'], args['body'], tags)


@tool('draft_reply', '起草回复',
      '替主人起草一条回复。target_id 是主人看得到的帖子或回复的编号（比如 my_notifications 里的 on.id）。'
      '主人确认后才发出。 / Draft a reply for the owner to a post the owner can see (e.g. on.id from '
      'my_notifications). Published only after the owner confirms.',
      scopes.DRAFTS_WRITE,
      {'target_id': {'type': 'string', 'minLength': 1, 'maxLength': 64, 'description': '回复哪一帖 / target id'},
       'body': {'type': 'string', 'minLength': 1, 'maxLength': 10000, 'description': '回复内容 / reply text'}},
      required=('target_id', 'body'), read_only=False)
def draft_reply(tctx, args):
    target = objects.load_visible(tctx.conn, tctx.owner, args['target_id'])
    root_id = target['root_id'] or target['id']
    root = objects.load_visible(tctx.conn, tctx.owner, root_id)
    if root['lifecycle'] != 'active':
        raise ApiError('state_conflict', '只能回复已发布的内容')
    if not authz.can(tctx.conn, tctx.owner, 'object.create.reply'):
        raise ApiError('action_not_allowed', '主人现在还不能回复')
    return _save_draft(tctx, 'reply', 'reply', '', args['body'], [], root_id=root_id)


# ---------------------------------------------------------------- 执行（计量、留痕）

def run(db, settings, agent, name, args, transport, request_id=None, preview=False):
    """校验 → scope → 限流和当日额度 → 执行 → 记调用。返回 (data, items, text)。
    抛 KeyError（不认识的工具）、ArgError（参数不对）、ApiError（其余）。"""
    t = TOOLS[name]
    cleaned = validate(t.schema, args)

    def log(result, items=0):
        if preview:
            return
        with db.write() as wc:
            auth.log_call(wc, agent, name, items, result, transport, request_id)

    if t.scope not in agent.scopes:
        log('agent_scope_missing')
        raise ApiError('agent_scope_missing', f'这个令牌没有「{scopes.LABELS[t.scope]}」权限（{t.scope}）')
    budget = MAX_ITEMS * 3
    if not preview:
        try:
            auth.burst(db, agent)
            with db.write() as wc:
                budget = auth.reserve(wc, agent)
        except ApiError as err:
            log(err.code)
            raise
    conn = db.conn()
    owner = auth.owner_actor(conn, agent)
    tctx = ToolCtx(conn, db, settings, agent, owner, auth.member_content_allowed(conn), budget, transport,
                   request_id, preview)
    try:
        data, items, text = t.handler(tctx, cleaned)
    except ApiError as err:
        log(err.code)
        raise
    if not preview:
        with db.write() as wc:
            auth.finish(wc, agent, items)
            auth.log_call(wc, agent, name, items, 'ok', transport, request_id)
            if name == 'whats_new':
                wc.execute('UPDATE agent_token SET whats_new_at = ? WHERE id = ?', (data['until'], agent.token_id))
    return data, items, text
