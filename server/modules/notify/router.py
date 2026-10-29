import fnmatch
import json
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import audit, clock, flags, outbox, pagination
from app.authz import Actor, require, visible_predicate
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import ApiError

from . import hooks, jobs, templates  # noqa: F401

try:
    from modules.social import service as social
except ImportError:
    social = None


router = APIRouter(prefix='/api/notify')
TIME = re.compile(r'^(?:[01]\d|2[0-3]):[0-5]\d$')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class MarkAllIn(Strict):
    category: Optional[str] = None


class PreferenceIn(Strict):
    categories: dict[str, bool] = Field(default_factory=dict)
    quiet_start: Optional[str] = None
    quiet_end: Optional[str] = None
    timezone_offset_min: int = Field(default=0, ge=-840, le=840)
    daily_digest: bool = True

    @field_validator('categories')
    @classmethod
    def known_categories(cls, value):
        unknown = set(value) - set(templates.CATEGORIES)
        if unknown:
            raise ValueError('不认识的通知类别')
        return value

    @field_validator('quiet_start', 'quiet_end')
    @classmethod
    def valid_time(cls, value):
        if value is not None and not TIME.match(value):
            raise ValueError('免打扰时间必须是 HH:MM')
        return value


def _json(raw, fallback):
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return fallback
    return value


def _actor(conn, principal_id):
    row = conn.execute(
        'SELECT p.id, p.kind, p.status, pr.level FROM principal p '
        'JOIN profile pr ON pr.principal_id = p.id WHERE p.id = ?', (principal_id,)).fetchone()
    if row is None:
        return None
    roles = frozenset(r[0] for r in conn.execute(
        'SELECT role FROM role_assignment WHERE principal_id = ? AND revoked_at IS NULL', (principal_id,)))
    return Actor(id=row['id'], kind=row['kind'], status=row['status'], level=row['level'], roles=roles)


def _display_name(conn, principal_id):
    if not principal_id:
        return '系统'
    row = conn.execute('SELECT display_name FROM profile WHERE principal_id = ?', (principal_id,)).fetchone()
    return row[0] if row else '一位成员'


def _handle(conn, principal_id):
    if not principal_id:
        return ''
    row = conn.execute('SELECT handle FROM credential WHERE principal_id = ?', (principal_id,)).fetchone()
    return row[0] if row and row[0] else ''


def _preference(conn, principal_id):
    row = conn.execute('SELECT * FROM notify_pref WHERE principal_id = ?', (principal_id,)).fetchone()
    categories = {key: True for key in templates.CATEGORIES}
    if row:
        saved = _json(row['category_json'], {})
        if isinstance(saved, dict):
            categories.update({key: bool(value) for key, value in saved.items() if key in categories})
        return {
            'categories': categories,
            'quiet_start': row['quiet_start'],
            'quiet_end': row['quiet_end'],
            'timezone_offset_min': row['timezone_offset_min'],
            'daily_digest': bool(row['daily_digest']),
        }
    return {'categories': categories, 'quiet_start': None, 'quiet_end': None,
            'timezone_offset_min': 0, 'daily_digest': True}


def _minutes(value):
    hour, minute = (int(part) for part in value.split(':'))
    return hour * 60 + minute


def _available_at(occurred_at, preference):
    start = preference['quiet_start']
    end = preference['quiet_end']
    if not start or not end or start == end:
        return occurred_at
    offset = timedelta(minutes=preference['timezone_offset_min'])
    local = datetime.fromtimestamp(clock.parse(occurred_at), timezone.utc) + offset
    current = local.hour * 60 + local.minute
    first, last = _minutes(start), _minutes(end)
    if first < last:
        if not first <= current < last:
            return occurred_at
        target = local.replace(hour=last // 60, minute=last % 60, second=0, microsecond=0)
    elif current >= first:
        target = (local + timedelta(days=1)).replace(hour=last // 60, minute=last % 60, second=0, microsecond=0)
    elif current < last:
        target = local.replace(hour=last // 60, minute=last % 60, second=0, microsecond=0)
    else:
        return occurred_at
    return clock.iso((target - offset).timestamp())


def _table(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _object_title(conn, object_id):
    if not object_id:
        return ''
    row = conn.execute(
        'SELECT v.title FROM object_head h JOIN object_version v ON v.object_id = h.id '
        'AND v.version = h.current_version WHERE h.id = ?', (object_id,)).fetchone()
    return row[0] if row else ''


def _event_title(conn, event_id):
    if not event_id or not _table(conn, 'community_event'):
        return ''
    row = conn.execute('SELECT title FROM community_event WHERE id = ?', (event_id,)).fetchone()
    return row[0] if row else ''


def _blocked(conn, actor_id, recipient_id):
    if not actor_id or not recipient_id or actor_id == recipient_id:
        return False
    if social is not None and social.installed(conn):
        return bool(social.blocked(conn, actor_id, recipient_id))
    if _table(conn, 'farm_relationship'):
        return conn.execute(
            'SELECT 1 FROM farm_relationship WHERE blocked = 1 AND '
            '((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))',
            (actor_id, recipient_id, recipient_id, actor_id)).fetchone() is not None
    return False


def _park_open(conn, principal_id):
    if not _table(conn, 'game_preference'):
        return True
    row = conn.execute('SELECT playground_enabled FROM game_preference WHERE principal_id = ?',
                       (principal_id,)).fetchone()
    return True if row is None else bool(row['playground_enabled'])


def _gov_notice(conn, notice_id):
    if not notice_id or not _table(conn, 'gov_notice'):
        return {}
    row = conn.execute('SELECT title, body, kind FROM gov_notice WHERE id = ?', (notice_id,)).fetchone()
    if row is None:
        return {}
    return {'title': row['title'], 'message': row['body'], 'kind': row['kind']}


def _object_visible(conn, principal_id, object_id):
    if not object_id:
        return True
    actor = _actor(conn, principal_id)
    if actor is None:
        return False
    predicate = visible_predicate(actor, 'h')
    return conn.execute(f'SELECT 1 FROM object_head h WHERE h.id = :id AND {predicate.sql}',
                        {'id': object_id, **predicate.params}).fetchone() is not None


def _rule(conn, event_type):
    rows = conn.execute('SELECT * FROM notify_rule WHERE enabled = 1 ORDER BY length(event_pattern) DESC, id').fetchall()
    return next((row for row in rows if fnmatch.fnmatchcase(event_type, row['event_pattern'])), None)


def _chat_recipients(conn, event):
    row = conn.execute('SELECT channel_id, author_id, reply_to, mentions_json, status FROM chat_message WHERE id = ?',
                       (event['aggregate_id'],)).fetchone()
    if row is None or row['status'] != 'ok':
        return []
    recipients = list(_json(row['mentions_json'], []))
    if row['reply_to']:
        reply = conn.execute('SELECT author_id FROM chat_message WHERE id = ?', (row['reply_to'],)).fetchone()
        if reply:
            recipients.append(reply[0])
    channel = conn.execute('SELECT kind, participant_a, participant_b FROM chat_channel WHERE id = ?',
                           (row['channel_id'],)).fetchone()
    if channel and channel['kind'] == 'dm':
        recipients.extend((channel['participant_a'], channel['participant_b']))
    return [value for value in recipients if value and value != row['author_id']]


def _recipients(conn, event, rule):
    payload = event['payload']
    strategy = rule['recipient_strategy']
    if strategy.startswith('payload:'):
        value = payload.get(strategy.split(':', 1)[1])
        values = value if isinstance(value, list) else [value]
    elif strategy == 'aggregate_principal':
        values = [event['aggregate_id']]
    elif strategy == 'reply_author':
        head = conn.execute('SELECT type, author_id, root_id FROM object_head WHERE id = ?',
                            (event['aggregate_id'],)).fetchone()
        if head is None or head['type'] != 'reply' or not head['root_id']:
            return []
        root = conn.execute('SELECT author_id FROM object_head WHERE id = ?', (head['root_id'],)).fetchone()
        values = [root[0] if root else None]
    elif strategy == 'kb_author':
        object_id = payload.get('object_id') or event['aggregate_id']
        row = conn.execute('SELECT author_id FROM object_head WHERE id = ?', (object_id,)).fetchone()
        values = [row[0] if row else None]
    elif strategy == 'chat_recipients':
        values = _chat_recipients(conn, event)
    elif strategy == 'event_signups':
        if payload.get('to') != 'live' or not _table(conn, 'event_signup'):
            return []
        values = [row[0] for row in conn.execute(
            'SELECT principal_id FROM event_signup WHERE event_id = ?', (event['aggregate_id'],))]
    elif strategy == 'event_candidate':
        if not _table(conn, 'event_submission'):
            return []
        row = conn.execute('SELECT principal_id FROM event_submission WHERE id = ?',
                           (payload.get('candidate_id'),)).fetchone()
        values = [row[0] if row else None]
    elif strategy == 'event_winners':
        if not _table(conn, 'event_result'):
            return []
        row = conn.execute('SELECT winners_json FROM event_result WHERE event_id = ?',
                           (event['aggregate_id'],)).fetchone()
        winners = _json(row['winners_json'], []) if row else []
        values = [item.get('authorId') for item in winners if isinstance(item, dict)]
    elif strategy == 'bounty_owner':
        if not _table(conn, 'bounty'):
            return []
        bounty_id = payload.get('bounty_id') or event['aggregate_id']
        row = conn.execute('SELECT owner_id FROM bounty WHERE id = ?', (bounty_id,)).fetchone()
        values = [row[0] if row else None]
    elif strategy == 'bounty_submitter':
        if not payload.get('accepted') or not _table(conn, 'promo_submission'):
            return []
        row = conn.execute('SELECT submitter_id FROM promo_submission WHERE id = ?',
                           (event['aggregate_id'],)).fetchone()
        values = [row[0] if row else None]
    else:
        return []
    result = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


def _targets(conn, event, rule):
    payload = event['payload']
    target_type = event['aggregate_type']
    target_id = event['aggregate_id']
    visibility_object_id = payload.get('object_id')
    merge_id = target_id
    if rule['recipient_strategy'] == 'reply_author':
        row = conn.execute('SELECT root_id FROM object_head WHERE id = ?', (target_id,)).fetchone()
        visibility_object_id = target_id
        merge_id = row['root_id'] if row and row['root_id'] else target_id
        target_type = 'object'
        target_id = merge_id
    elif event['aggregate_type'] in ('object', 'problem'):
        visibility_object_id = visibility_object_id or event['aggregate_id']
    elif rule['recipient_strategy'] == 'kb_author':
        visibility_object_id = visibility_object_id or event['aggregate_id']
        target_type = 'object'
        target_id = visibility_object_id
        merge_id = target_id
    return target_type, target_id, visibility_object_id, merge_id


def _context(conn, event, target_id, merge_id, visibility_object_id):
    values = dict(event['payload'])
    values.update({
        'actor': _display_name(conn, event.get('actor_id')),
        'actor_handle': _handle(conn, event.get('actor_id')),
        'target_id': target_id,
        'merge_id': merge_id,
        'title': _object_title(conn, visibility_object_id or values.get('object_id')),
        'event_title': _event_title(conn, event['aggregate_id'] if event.get('aggregate_type') == 'event'
                                   else values.get('event_id')),
    })
    if event.get('event_type') in ('governance.notice', 'governance.action_executed'):
        notice = _gov_notice(conn, event['aggregate_id'] if event['event_type'] == 'governance.notice' else None)
        kind = notice.get('kind') or values.get('kind') or values.get('type')
        values['title'] = notice.get('title') or templates.gov_title(kind, values.get('title', ''))
        values['message'] = notice.get('message') or values.get('message') or values.get('outcome') or ''
    return values


def _specialize(conn, event, rule):
    """object.created 在悬赏帖或市集帖上改走对应分类，不另编事件。"""
    if event.get('event_type') != 'object.created' or rule['recipient_strategy'] != 'reply_author':
        return rule
    head = conn.execute('SELECT type, root_id FROM object_head WHERE id = ?', (event['aggregate_id'],)).fetchone()
    if head is None or head['type'] != 'reply' or not head['root_id']:
        return rule
    root = conn.execute('SELECT type FROM object_head WHERE id = ?', (head['root_id'],)).fetchone()
    specialized = dict(rule)
    if root and root['type'] == 'market_listing':
        specialized.update(category='market', title_template='{actor} 回复了你的市集帖子',
                           body_template='《{title}》有了新回复', link_template='#/market/{target_id}',
                           merge_key_template='market:{merge_id}', merge_minutes=10)
        return specialized
    if _table(conn, 'bounty') and conn.execute('SELECT 1 FROM bounty WHERE object_id = ?', (head['root_id'],)).fetchone():
        specialized.update(category='bounty', title_template='{actor} 回答了你的悬赏',
                           body_template='《{title}》收到一条新回答', link_template='#/opportunities',
                           merge_key_template='bounty:{merge_id}', merge_minutes=10)
        return specialized
    return rule


def _event_actor(conn, event):
    if event.get('actor_id'):
        return event['actor_id']
    if event['aggregate_type'] in ('object', 'problem'):
        row = conn.execute('SELECT author_id FROM object_head WHERE id = ?', (event['aggregate_id'],)).fetchone()
        if row:
            return row[0]
    return None


def _merge(conn, rule, recipient_id, values, event, available_at, target):
    template = rule['merge_key_template']
    if not template or not rule['merge_minutes']:
        return None
    merge_key = templates.render(template, values)
    cutoff = clock.iso(clock.parse(event['occurred_at']) - rule['merge_minutes'] * 60)
    row = conn.execute(
        'SELECT * FROM notification WHERE recipient_id = ? AND category = ? AND merge_key = ? '
        'AND read_at IS NULL AND updated_at >= ? ORDER BY updated_at DESC, id DESC LIMIT 1',
        (recipient_id, rule['category'], merge_key, cutoff)).fetchone()
    if row is None:
        return None
    actors = _json(row['actor_ids_json'], [])
    if event.get('actor_id') and event['actor_id'] not in actors:
        actors.append(event['actor_id'])
    count = row['event_count'] + 1
    title, body = row['title'], row['body']
    if rule['category'] == 'reply':
        title, body = templates.merge_reply(len(actors), count, values.get('title', ''))
    elif rule['category'] == 'park':
        family = (rule['merge_key_template'] or '').split(':')[-1]
        title, body = templates.merge_park(len(actors), count, family)
    elif rule['category'] == 'dm':
        title, body = templates.merge_dm(count)
    conn.execute(
        'UPDATE notification SET title = ?, body = ?, event_count = ?, actor_ids_json = ?, occurred_at = ?, '
        'available_at = ?, updated_at = ?, target_type = ?, target_id = ?, visibility_object_id = ? WHERE id = ?',
        (title, body, count, json.dumps(actors, ensure_ascii=False), event['occurred_at'],
         max(row['available_at'], available_at), event['occurred_at'], *target, row['id']))
    return row['id']


def handle_event(conn, event):
    # 测试与维护工具可以只加载部分模块；对应迁移未安装时消费者必须保持惰性。
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notify_rule'").fetchone() is None:
        return 0
    if event['event_type'] in templates.FARM_BRIDGE:
        return 0
    rule = _rule(conn, event['event_type'])
    if rule is None:
        return 0
    flags.gate(conn, 'notify.enabled')
    event = dict(event)
    event['actor_id'] = _event_actor(conn, event)
    rule = _specialize(conn, event, rule)
    target_type, target_id, visibility_object_id, merge_id = _targets(conn, event, rule)
    values = _context(conn, event, target_id, merge_id, visibility_object_id)
    made = 0
    for recipient_id in _recipients(conn, event, rule):
        if recipient_id == event.get('actor_id') and not rule['allow_self']:
            continue
        if conn.execute('SELECT 1 FROM notification_source WHERE event_id = ? AND recipient_id = ?',
                        (event['id'], recipient_id)).fetchone():
            continue
        actor = _actor(conn, recipient_id)
        if actor is None or actor.status not in ('active', 'pending_deletion'):
            continue
        preference = _preference(conn, recipient_id)
        if not preference['categories'].get(rule['category'], True):
            continue
        if rule['category'] == 'park' and not _park_open(conn, recipient_id):
            continue
        if _blocked(conn, event.get('actor_id'), recipient_id):
            continue
        if visibility_object_id and not _object_visible(conn, recipient_id, visibility_object_id):
            continue
        available_at = _available_at(event['occurred_at'], preference)
        target = (target_type, target_id, visibility_object_id)
        notification_id = _merge(conn, rule, recipient_id, values, event, available_at, target)
        if notification_id is None:
            notification_id = str(uuid.uuid4())
            actor_ids = [event['actor_id']] if event.get('actor_id') else []
            title = templates.render(rule['title_template'], values)
            body = templates.render(rule['body_template'], values)
            link = templates.render(rule['link_template'], values) if rule['link_template'] else None
            merge_key = templates.render(rule['merge_key_template'], values) if rule['merge_key_template'] else None
            conn.execute(
                'INSERT INTO notification (id, recipient_id, category, title, body, link, target_type, target_id, '
                'visibility_object_id, merge_key, actor_ids_json, occurred_at, available_at, created_at, updated_at) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (notification_id, recipient_id, rule['category'], title, body, link, target_type, target_id,
                 visibility_object_id, merge_key, json.dumps(actor_ids, ensure_ascii=False), event['occurred_at'],
                 available_at, event['occurred_at'], event['occurred_at']))
        conn.execute('INSERT INTO notification_source (event_id, recipient_id, notification_id, created_at) '
                     'VALUES (?, ?, ?, ?)', (event['id'], recipient_id, notification_id, clock.now()))
        audit.record(conn, None, 'notify.generate', 'notification', notification_id, request_id=event.get('request_id'),
                     meta={'event_type': event['event_type'], 'category': rule['category']})
        made += 1
    return made


for _consumer_name, _pattern in (
    ('notify.object', 'object.*'),
    ('notify.growth', 'growth.*'),
    ('notify.bounty', 'bounty.*'),
    ('notify.rooms', 'rooms.*'),
    ('notify.agents', 'agents.*'),
    ('notify.agentchat', 'agentchat.*'),
    ('notify.kb', 'kb.*'),
    ('notify.governance', 'governance.*'),
    ('notify.system', 'notify.system.*'),
    ('notify.farm', 'farm.*'),
    ('notify.parking', 'parking.*'),
    ('notify.events', 'events.*'),
    ('notify.market', 'market.*'),
    ('notify.games', 'games.*'),
    ('notify.social', 'social.*'),
):
    outbox.subscribe(_consumer_name, _pattern, handle_event)


def _gate(conn, actor, action):
    flags.gate(conn, 'notify.enabled')
    require(conn, actor, action)


def _people(conn, actor_ids):
    ids = [value for value in actor_ids if value]
    if not ids:
        return []
    marks = ','.join('?' * len(ids))
    rows = conn.execute(
        f'SELECT p.principal_id AS id, p.display_name AS name, p.avatar_ref FROM profile p WHERE p.principal_id IN ({marks})',
        ids).fetchall()
    found = {row['id']: {'id': row['id'], 'name': row['name'], 'avatar_ref': row['avatar_ref']} for row in rows}
    return [found[value] for value in ids if value in found]


def _view(conn, actor, row):
    unavailable = bool(row['visibility_object_id'] and not _object_visible(conn, actor.id, row['visibility_object_id']))
    if unavailable:
        title, body, link, people = '内容已不可见', '原内容已撤回、隐藏，或你的访问范围已经变化。', None, []
    else:
        title, body, link = row['title'], row['body'], row['link']
        people = _people(conn, _json(row['actor_ids_json'], []))
    return {
        'id': row['id'], 'category': row['category'], 'title': title, 'body': body, 'link': link,
        'target': {'type': row['target_type'], 'id': row['target_id']}, 'unavailable': unavailable,
        'event_count': row['event_count'], 'actors': people, 'occurred_at': row['occurred_at'],
        'available_at': row['available_at'], 'read_at': row['read_at'],
    }


@router.get('/unread-count')
def unread_count(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn, ctx.actor, 'notify.read')
    count = conn.execute('SELECT count(*) FROM notification WHERE recipient_id = ? AND read_at IS NULL '
                         'AND available_at <= ?', (ctx.actor.id, clock.now())).fetchone()[0]
    return ok(ctx, {'count': count})


@router.get('/notifications')
def list_notifications(category: Optional[str] = None, limit: Optional[int] = None, cursor: Optional[str] = None,
                       ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn, ctx.actor, 'notify.read')
    if category is not None and category not in templates.CATEGORIES:
        raise ApiError('validation_failed', '不认识的通知类别')
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('notify', category)
    keys = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    params = [ctx.actor.id, clock.now()]
    where = ''
    if category:
        where += ' AND category = ?'
        params.append(category)
    if keys:
        where += ' AND (updated_at < ? OR (updated_at = ? AND id < ?))'
        params.extend((keys[0], keys[0], keys[1]))
    params.append(size + 1)
    rows = conn.execute('SELECT * FROM notification WHERE recipient_id = ? AND available_at <= ?' + where +
                        ' ORDER BY updated_at DESC, id DESC LIMIT ?', params).fetchall()
    rows, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, rows, size,
                                        lambda row: [row['updated_at'], row['id']])
    return ok(ctx, {'items': [_view(conn, ctx.actor, row) for row in rows]}, cursor=next_cursor)


@router.post('/notifications/read-all')
def mark_all(body: MarkAllIn, ctx: Ctx = Depends(write_ctx)):
    if body.category is not None and body.category not in templates.CATEGORIES:
        raise ApiError('validation_failed', '不认识的通知类别')
    with ctx.db.write() as conn:
        _gate(conn, ctx.actor, 'notify.mark_read')
        params = [clock.now(), ctx.actor.id, clock.now()]
        where = ''
        if body.category:
            where = ' AND category = ?'
            params.append(body.category)
        result = conn.execute('UPDATE notification SET read_at = ?, updated_at = ? WHERE recipient_id = ? '
                              'AND read_at IS NULL AND available_at <= ?' + where,
                              [params[0], params[0], *params[1:]])
        audit.record(conn, ctx.actor.id, 'notify.mark_all_read', 'principal', ctx.actor.id,
                     request_id=ctx.request_id, meta={'category': body.category, 'count': result.rowcount})
    return ok(ctx, {'updated': result.rowcount})


@router.post('/notifications/{notification_id}/read')
def mark_one(notification_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        _gate(conn, ctx.actor, 'notify.mark_read')
        row = conn.execute('SELECT id, read_at FROM notification WHERE id = ? AND recipient_id = ?',
                           (notification_id, ctx.actor.id)).fetchone()
        if row is None:
            raise ApiError('resource_not_found')
        stamp = row['read_at'] or clock.now()
        if row['read_at'] is None:
            conn.execute('UPDATE notification SET read_at = ?, updated_at = ? WHERE id = ?',
                         (stamp, stamp, notification_id))
            audit.record(conn, ctx.actor.id, 'notify.mark_read', 'notification', notification_id,
                         request_id=ctx.request_id)
    return ok(ctx, {'id': notification_id, 'read_at': stamp})


@router.get('/preferences')
def get_preferences(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn, ctx.actor, 'notify.read')
    return ok(ctx, _preference(conn, ctx.actor.id))


@router.put('/preferences')
def put_preferences(body: PreferenceIn, ctx: Ctx = Depends(write_ctx)):
    if (body.quiet_start is None) != (body.quiet_end is None):
        raise ApiError('validation_failed', '免打扰开始和结束时间要同时填写')
    with ctx.db.write() as conn:
        _gate(conn, ctx.actor, 'notify.preferences')
        categories = {key: bool(body.categories.get(key, True)) for key in templates.CATEGORIES}
        conn.execute(
            'INSERT INTO notify_pref (principal_id, category_json, quiet_start, quiet_end, timezone_offset_min, '
            'daily_digest, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(principal_id) DO UPDATE SET '
            'category_json = excluded.category_json, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, '
            'timezone_offset_min = excluded.timezone_offset_min, daily_digest = excluded.daily_digest, '
            'updated_at = excluded.updated_at',
            (ctx.actor.id, json.dumps(categories, ensure_ascii=False, sort_keys=True), body.quiet_start, body.quiet_end,
             body.timezone_offset_min, int(body.daily_digest), clock.now()))
        audit.record(conn, ctx.actor.id, 'notify.preferences', 'principal', ctx.actor.id, request_id=ctx.request_id,
                     meta={'daily_digest': body.daily_digest, 'quiet': bool(body.quiet_start)})
    return ok(ctx, _preference(ctx.db.conn(), ctx.actor.id))


@router.get('/daily-digest')
def daily_digest(day: Optional[str] = Query(default=None, pattern=r'^\d{4}-\d{2}-\d{2}$'),
                 ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn, ctx.actor, 'notify.read')
    preference = _preference(conn, ctx.actor.id)
    if day:
        try:
            selected = date.fromisoformat(day)
        except ValueError:
            raise ApiError('validation_failed', '日期无效') from None
    else:
        selected = datetime.fromtimestamp(clock.now_ts(), timezone.utc).date() - timedelta(days=1)
    offset = timedelta(minutes=preference['timezone_offset_min'])
    start_dt = datetime.combine(selected, datetime.min.time(), timezone.utc) - offset
    end_dt = start_dt + timedelta(days=1)
    start, end = clock.iso(start_dt.timestamp()), clock.iso(end_dt.timestamp())
    rows = conn.execute('SELECT * FROM notification '
                        'WHERE recipient_id = ? AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at DESC',
                        (ctx.actor.id, start, end)).fetchall()
    data = templates.build_daily_digest([_view(conn, ctx.actor, row) for row in rows], selected)
    data['enabled'] = preference['daily_digest']
    return ok(ctx, data)

