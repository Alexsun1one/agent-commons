"""公告选择、受众、时段、频控和聚合计数。"""

import re
import sqlite3
import uuid

from app import audit, clock, flags
from app.authz import require
from app.errors import ApiError


LEVELS = ('normal', 'important', 'maintenance')
LEVEL_RANK = {'important': 0, 'maintenance': 1, 'normal': 2}
AUDIENCES = ('site', 'level', 'group')
PLACEMENTS = ('hot-side', 'events', 'market-8', 'games-foot')
ITEM_STATUS = ('draft', 'active', 'archived')
CAMPAIGN_STATUS = ('draft', 'active', 'paused', 'ended')
PAID_STATUSES = ('active', 'trial')
SAFE_URL = re.compile(r'^(?:(?!//)[^:\\/?#]*(?:[/?#]|$)|https?:|mailto:|data:image/)', re.IGNORECASE)
BLOCKED_HEADS = {'read', 'write', 'exam'}


def ads_blocked(route):
    """阅读、写作、讲堂回看、考试过程不投放。route 是去掉 #/ 的路径。"""
    parts = [part for part in str(route or '').strip().strip('/').split('/') if part]
    if not parts:
        return False
    head, rest = parts[0], parts[1:]
    if head in BLOCKED_HEADS:
        return True
    if head == 'talk' and rest and rest[0] != 'new':
        return True
    if 'replay' in parts:
        return True
    return False


def paid_member(conn, principal_id):
    """会员 = BIZ-1 的 billing_subscription 处于 active 或 trial。表还没有时不是会员。

    正本列名是 state；早期草案写过 status，两列都认，避免和计费模块对不上。
    """
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'billing_subscription'").fetchone()
    if exists is None:
        return False
    columns = {row[1] for row in conn.execute('PRAGMA table_info(billing_subscription)')}
    column = 'state' if 'state' in columns else 'status' if 'status' in columns else ''
    if not column or 'principal_id' not in columns:
        return False
    return conn.execute(
        f'SELECT 1 FROM billing_subscription WHERE principal_id = ? AND {column} IN (?, ?)',
        (principal_id, *PAID_STATUSES)).fetchone() is not None


def can_hide_ads(conn, actor):
    return actor.level >= 3 or paid_member(conn, actor.id)


def purge(conn, principal_id):
    conn.execute('DELETE FROM announce_dismiss WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM announce_ad_cap WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM announce_pref WHERE principal_id = ?', (principal_id,))
    for table in ('announce_item', 'announce_ticker', 'announce_campaign'):
        conn.execute(f'UPDATE {table} SET created_by = NULL WHERE created_by = ?', (principal_id,))


def _now():
    return clock.now()


def _day(now=None):
    return (now or _now())[:10]


def _parse_time(value, label):
    if not isinstance(value, str):
        raise ApiError('validation_failed', label + '时间格式不对')
    text = value.strip()
    if len(text) == 16 and text[10] == 'T':
        text += ':00.000000Z'
    elif text.endswith('Z') and '.' not in text and 'T' in text:
        text = text[:-1] + '.000000Z'
    try:
        clock.parse(text)
    except (TypeError, ValueError):
        raise ApiError('validation_failed', label + '时间格式不对')
    return text


def _line(value, limit, label):
    if not isinstance(value, str):
        raise ApiError('validation_failed', label + '不正确')
    text = ' '.join(value.split())
    if not 1 <= len(text) <= limit:
        raise ApiError('validation_failed', label + '长度不对')
    return text


def _clean_url(value, label):
    if not isinstance(value, str):
        raise ApiError('validation_failed', label + '不正确')
    text = value.strip()
    if not text or any(ch.isspace() or ch in '<>"\'`' for ch in text) or not SAFE_URL.match(text):
        raise ApiError('validation_failed', label + '不被允许')
    return text


def _window(starts_at, ends_at, now):
    if starts_at > now:
        return False
    return ends_at is None or ends_at > now


def _audience_ok(conn, actor, row):
    kind = row['audience']
    if kind == 'site':
        return True
    if kind == 'level':
        return actor.level >= row['min_level']
    if kind == 'group':
        return conn.execute(
            "SELECT 1 FROM membership WHERE space_id = ? AND principal_id = ? AND state = 'active'",
            (row['group_id'], actor.id)).fetchone() is not None
    return False


def _pref_row(conn, principal_id):
    row = conn.execute('SELECT marquee_on, ads_on FROM announce_pref WHERE principal_id = ?', (principal_id,)).fetchone()
    if row is None:
        return {'marquee_on': True, 'ads_on': True}
    return {'marquee_on': bool(row['marquee_on']), 'ads_on': bool(row['ads_on'])}


def _item_out(row, dismissed=False, current=False):
    return {
        'id': row['id'],
        'level': row['level'],
        'title': row['title'],
        'body': row['body'],
        'audience': row['audience'],
        'min_level': row['min_level'],
        'group_id': row['group_id'],
        'starts_at': row['starts_at'],
        'ends_at': row['ends_at'],
        'dismissible': bool(row['dismissible']),
        'status': row['status'],
        'dismissed': dismissed,
        'current': current,
    }


def _public_item(row):
    return {
        'id': row['id'],
        'level': row['level'],
        'title': row['title'],
        'body': row['body'],
        'dismissible': bool(row['dismissible']),
        'starts_at': row['starts_at'],
        'ends_at': row['ends_at'],
    }


def _dismissed_ids(conn, principal_id):
    return {row[0] for row in conn.execute(
        'SELECT item_id FROM announce_dismiss WHERE principal_id = ?', (principal_id,))}


def _candidate_items(conn, actor, now, *, include_expired):
    rows = conn.execute(
        "SELECT * FROM announce_item WHERE status = 'active' AND starts_at <= ? ORDER BY starts_at DESC, id",
        (now,)).fetchall()
    picked = []
    for row in rows:
        if not include_expired and not _window(row['starts_at'], row['ends_at'], now):
            continue
        if _audience_ok(conn, actor, row):
            picked.append(row)
    return picked


def _current_item(conn, actor, now):
    dismissed = _dismissed_ids(conn, actor.id)
    rows = [row for row in _candidate_items(conn, actor, now, include_expired=False) if row['id'] not in dismissed]
    rows.sort(key=lambda row: row['id'])
    rows.sort(key=lambda row: row['starts_at'], reverse=True)
    rows.sort(key=lambda row: LEVEL_RANK[row['level']])
    return _public_item(rows[0]) if rows else None


def _ticker(conn, now):
    rows = conn.execute(
        'SELECT id, kind, body, starts_at, ends_at FROM announce_ticker '
        'WHERE enabled = 1 AND public = 1 ORDER BY position, created_at, id').fetchall()
    return [{'id': row['id'], 'kind': row['kind'], 'body': row['body']}
            for row in rows if _window(row['starts_at'], row['ends_at'], now)]


def _shown(conn, principal_id, campaign_id, day):
    row = conn.execute(
        'SELECT shown FROM announce_ad_cap WHERE principal_id = ? AND campaign_id = ? AND day = ?',
        (principal_id, campaign_id, day)).fetchone()
    return row['shown'] if row else 0


def _campaign_out(row, *, admin=False):
    data = {
        'id': row['id'],
        'name': row['name'],
        'placement': row['placement'],
        'image_url': row['image_url'],
        'line': row['line'],
        'link_url': row['link_url'],
        'why': row['why'],
        'starts_at': row['starts_at'],
        'ends_at': row['ends_at'],
        'sponsor': True,
    }
    if admin:
        data.update({
            'status': row['status'],
            'freq_cap': row['freq_cap'],
            'budget_cents': row['budget_cents'],
        })
    return data


def _one_ad(conn, principal_id, placement, now, day):
    rows = conn.execute(
        "SELECT * FROM announce_campaign WHERE placement = ? AND status = 'active' AND starts_at <= ? AND ends_at > ? "
        'ORDER BY starts_at DESC, id', (placement, now, now)).fetchall()
    for row in rows:
        if _shown(conn, principal_id, row['id'], day) < row['freq_cap']:
            return _campaign_out(row)
    return None


def _slots(conn, actor, now, day):
    return {placement: _one_ad(conn, actor.id, placement, now, day) for placement in PLACEMENTS}


def active(conn, actor, route):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.read')
    now = _now()
    pref = _pref_row(conn, actor.id)
    blocked = ads_blocked(route)
    if blocked or not pref['ads_on']:
        slots = {placement: None for placement in PLACEMENTS}
    else:
        slots = _slots(conn, actor, now, _day(now))
    return {
        'announcement': _current_item(conn, actor, now),
        'marquee': {'enabled': pref['marquee_on'], 'items': _ticker(conn, now) if pref['marquee_on'] else []},
        'ads': {'blocked': blocked, 'hidden': not pref['ads_on'], 'slots': slots},
        'prefs': {
            'marquee_on': pref['marquee_on'],
            'ads_on': pref['ads_on'],
            'can_hide_ads': can_hide_ads(conn, actor),
        },
    }


def history(conn, actor):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.read')
    now = _now()
    dismissed = _dismissed_ids(conn, actor.id)
    rows = conn.execute(
        "SELECT * FROM announce_item WHERE status != 'draft' AND starts_at <= ? ORDER BY starts_at DESC, id",
        (now,)).fetchall()
    items = []
    for row in rows:
        if not _audience_ok(conn, actor, row):
            continue
        current = row['status'] == 'active' and _window(row['starts_at'], row['ends_at'], now)
        items.append(_item_out(row, dismissed=row['id'] in dismissed, current=current))
    return {'items': items}


def dismiss(conn, actor, item_id):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.pref')
    row = conn.execute('SELECT * FROM announce_item WHERE id = ?', (item_id,)).fetchone()
    now = _now()
    if row is None or row['status'] == 'draft' or row['starts_at'] > now or not _audience_ok(conn, actor, row):
        raise ApiError('resource_not_found')
    if not row['dismissible']:
        raise ApiError('state_conflict', '这条公告不能关闭')
    conn.execute(
        'INSERT INTO announce_dismiss (principal_id, item_id, dismissed_at) VALUES (?, ?, ?) '
        'ON CONFLICT(principal_id, item_id) DO NOTHING',
        (actor.id, item_id, now))
    return {'id': item_id, 'dismissed': True}


def save_pref(conn, actor, marquee_on, ads_on):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.pref')
    current = _pref_row(conn, actor.id)
    if ads_on is None:
        ads_on = current['ads_on']
    if marquee_on is None:
        marquee_on = current['marquee_on']
    if ads_on is False and current['ads_on'] is True and not can_hide_ads(conn, actor):
        raise ApiError('action_not_allowed', 'L3 或会员才能关闭广告')
    now = _now()
    conn.execute(
        'INSERT INTO announce_pref (principal_id, marquee_on, ads_on, updated_at) VALUES (?, ?, ?, ?) '
        'ON CONFLICT(principal_id) DO UPDATE SET marquee_on = excluded.marquee_on, ads_on = excluded.ads_on, '
        'updated_at = excluded.updated_at',
        (actor.id, int(bool(marquee_on)), int(bool(ads_on)), now))
    return {'marquee_on': bool(marquee_on), 'ads_on': bool(ads_on), 'can_hide_ads': can_hide_ads(conn, actor)}


def _active_campaign(conn, campaign_id, now):
    row = conn.execute('SELECT * FROM announce_campaign WHERE id = ?', (campaign_id,)).fetchone()
    if row is None or row['status'] != 'active' or not _window(row['starts_at'], row['ends_at'], now):
        raise ApiError('resource_not_found')
    return row


def _pref_allows_ads(conn, actor, route):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.read')
    if ads_blocked(route):
        raise ApiError('state_conflict', '这个页面不投放')
    if not _pref_row(conn, actor.id)['ads_on']:
        raise ApiError('state_conflict', '广告已关闭')


def _add_stat(conn, campaign_id, day, placement, impressions=0, clicks=0):
    conn.execute(
        'INSERT INTO announce_ad_stat (campaign_id, day, placement, impressions, clicks) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT(campaign_id, day, placement) DO UPDATE SET '
        'impressions = impressions + excluded.impressions, clicks = clicks + excluded.clicks',
        (campaign_id, day, placement, impressions, clicks))
    row = conn.execute(
        'SELECT impressions, clicks FROM announce_ad_stat WHERE campaign_id = ? AND day = ? AND placement = ?',
        (campaign_id, day, placement)).fetchone()
    return {'impressions': row['impressions'], 'clicks': row['clicks']}


def record_impression(conn, actor, campaign_id, placement, route):
    _pref_allows_ads(conn, actor, route)
    now = _now()
    row = _active_campaign(conn, campaign_id, now)
    if placement != row['placement']:
        raise ApiError('validation_failed', '投放位置不对')
    day = _day(now)
    shown = _shown(conn, actor.id, campaign_id, day)
    if shown >= row['freq_cap']:
        raise ApiError('state_conflict', '今天这条已经看过了')
    conn.execute(
        'INSERT INTO announce_ad_cap (principal_id, campaign_id, day, shown) VALUES (?, ?, ?, 1) '
        'ON CONFLICT(principal_id, campaign_id, day) DO UPDATE SET shown = shown + 1',
        (actor.id, campaign_id, day))
    aggregate = _add_stat(conn, campaign_id, day, placement, impressions=1)
    return {'shown': shown + 1, 'cap': row['freq_cap'], 'aggregate': aggregate}


def record_click(conn, actor, campaign_id, placement, route):
    _pref_allows_ads(conn, actor, route)
    now = _now()
    row = _active_campaign(conn, campaign_id, now)
    if placement != row['placement']:
        raise ApiError('validation_failed', '投放位置不对')
    aggregate = _add_stat(conn, campaign_id, _day(now), placement, clicks=1)
    return {'aggregate': aggregate}


def _audience_fields(audience, min_level, group_id):
    if audience not in AUDIENCES:
        raise ApiError('validation_failed', '受众不正确')
    if audience == 'site':
        return None, None
    if audience == 'level':
        if not isinstance(min_level, int) or not 1 <= min_level <= 5:
            raise ApiError('validation_failed', '等级要在 1 到 5')
        return min_level, None
    if not isinstance(group_id, str) or not group_id.strip():
        raise ApiError('validation_failed', '要填写小组')
    return None, group_id.strip()


def _span(starts_at, ends_at, *, allow_open):
    start = _parse_time(starts_at, '开始')
    if ends_at in (None, ''):
        if not allow_open:
            raise ApiError('validation_failed', '要填写结束时间')
        return start, None
    end = _parse_time(ends_at, '结束')
    if end <= start:
        raise ApiError('validation_failed', '结束要晚于开始')
    return start, end


def create_item(conn, actor, payload, request_id):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    level = payload['level']
    if level not in LEVELS:
        raise ApiError('validation_failed', '级别不正确')
    status = payload.get('status') or 'active'
    if status not in ITEM_STATUS:
        raise ApiError('validation_failed', '状态不正确')
    min_level, group_id = _audience_fields(payload['audience'], payload.get('min_level'), payload.get('group_id'))
    starts_at, ends_at = _span(payload['starts_at'], payload.get('ends_at'), allow_open=True)
    now = _now()
    item_id = str(uuid.uuid4())
    try:
        conn.execute(
            'INSERT INTO announce_item (id, level, title, body, audience, min_level, group_id, starts_at, ends_at, '
            'dismissible, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (item_id, level, _line(payload['title'], 40, '标题'), _line(payload['body'], 160, '正文'),
             payload['audience'], min_level, group_id, starts_at, ends_at, int(bool(payload['dismissible'])),
             status, actor.id, now, now))
    except sqlite3.IntegrityError:
        raise ApiError('validation_failed', '小组不存在')
    audit.record(conn, actor.id, 'announce.item_create', 'announce_item', item_id, request_id=request_id,
                 meta={'level': level, 'audience': payload['audience']})
    row = conn.execute('SELECT * FROM announce_item WHERE id = ?', (item_id,)).fetchone()
    return _item_out(row)


def update_item(conn, actor, item_id, payload, request_id):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    row = conn.execute('SELECT * FROM announce_item WHERE id = ?', (item_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    level = payload.get('level', row['level'])
    if level not in LEVELS:
        raise ApiError('validation_failed', '级别不正确')
    status = payload.get('status', row['status'])
    if status not in ITEM_STATUS:
        raise ApiError('validation_failed', '状态不正确')
    audience = payload.get('audience', row['audience'])
    min_level, group_id = _audience_fields(
        audience, payload['min_level'] if 'min_level' in payload else row['min_level'],
        payload['group_id'] if 'group_id' in payload else row['group_id'])
    starts_at, ends_at = _span(
        payload.get('starts_at', row['starts_at']),
        payload['ends_at'] if 'ends_at' in payload else row['ends_at'], allow_open=True)
    title = _line(payload.get('title', row['title']), 40, '标题')
    body = _line(payload.get('body', row['body']), 160, '正文')
    dismissible = int(bool(payload['dismissible'])) if 'dismissible' in payload else row['dismissible']
    try:
        conn.execute(
            'UPDATE announce_item SET level = ?, title = ?, body = ?, audience = ?, min_level = ?, group_id = ?, '
            'starts_at = ?, ends_at = ?, dismissible = ?, status = ?, updated_at = ? WHERE id = ?',
            (level, title, body, audience, min_level, group_id, starts_at, ends_at, dismissible, status, _now(), item_id))
    except sqlite3.IntegrityError:
        raise ApiError('validation_failed', '小组不存在')
    audit.record(conn, actor.id, 'announce.item_update', 'announce_item', item_id, request_id=request_id,
                 meta={'status': status})
    return _item_out(conn.execute('SELECT * FROM announce_item WHERE id = ?', (item_id,)).fetchone())


def list_items(conn, actor):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    rows = conn.execute('SELECT * FROM announce_item ORDER BY starts_at DESC, id').fetchall()
    return {'items': [_item_out(row) for row in rows]}


def _next_position(conn):
    row = conn.execute('SELECT coalesce(max(position), 0) + 1 FROM announce_ticker').fetchone()
    return row[0]


def record_system_line(conn, actor, body, *, public, starts_at=None, ends_at=None, request_id=None):
    """系统短讯只收公开或示例句子。public 为假时不落库。"""
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    if not public:
        raise ApiError('action_not_allowed', '系统短讯只能收录公开或示例事件')
    return _insert_ticker(conn, actor, 'system', body, True, starts_at, ends_at, request_id)


def create_ticker(conn, actor, payload, request_id):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    kind = payload.get('kind') or 'manual'
    if kind not in ('manual', 'system'):
        raise ApiError('validation_failed', '短讯类型不正确')
    public = True if kind == 'manual' else bool(payload.get('public'))
    if kind == 'system':
        return record_system_line(conn, actor, payload['body'], public=public, starts_at=payload.get('starts_at'),
                                  ends_at=payload.get('ends_at'), request_id=request_id)
    return _insert_ticker(conn, actor, 'manual', payload['body'], public, payload.get('starts_at'),
                          payload.get('ends_at'), request_id)


def _insert_ticker(conn, actor, kind, body, public, starts_at, ends_at, request_id):
    start, end = _span(starts_at or _now(), ends_at, allow_open=True)
    ticker_id = str(uuid.uuid4())
    conn.execute(
        'INSERT INTO announce_ticker (id, kind, body, public, starts_at, ends_at, enabled, position, created_by, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
        (ticker_id, kind, _line(body, 80, '短讯'), int(bool(public)), start, end, _next_position(conn), actor.id, _now()))
    audit.record(conn, actor.id, 'announce.ticker_create', 'announce_ticker', ticker_id, request_id=request_id,
                 meta={'kind': kind})
    row = conn.execute('SELECT * FROM announce_ticker WHERE id = ?', (ticker_id,)).fetchone()
    return _ticker_out(row)


def _ticker_out(row):
    return {
        'id': row['id'], 'kind': row['kind'], 'body': row['body'], 'public': bool(row['public']),
        'starts_at': row['starts_at'], 'ends_at': row['ends_at'], 'enabled': bool(row['enabled']),
        'position': row['position'],
    }


def update_ticker(conn, actor, ticker_id, payload, request_id):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    row = conn.execute('SELECT * FROM announce_ticker WHERE id = ?', (ticker_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    enabled = int(bool(payload['enabled'])) if 'enabled' in payload else row['enabled']
    body = _line(payload.get('body', row['body']), 80, '短讯')
    if row['kind'] == 'system' and 'public' in payload and not payload['public']:
        raise ApiError('action_not_allowed', '系统短讯只能收录公开或示例事件')
    starts_at, ends_at = _span(
        payload.get('starts_at', row['starts_at']),
        payload['ends_at'] if 'ends_at' in payload else row['ends_at'], allow_open=True)
    conn.execute(
        'UPDATE announce_ticker SET body = ?, enabled = ?, starts_at = ?, ends_at = ? WHERE id = ?',
        (body, enabled, starts_at, ends_at, ticker_id))
    audit.record(conn, actor.id, 'announce.ticker_update', 'announce_ticker', ticker_id, request_id=request_id,
                 meta={'enabled': bool(enabled)})
    return _ticker_out(conn.execute('SELECT * FROM announce_ticker WHERE id = ?', (ticker_id,)).fetchone())


def list_ticker(conn, actor):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    rows = conn.execute('SELECT * FROM announce_ticker ORDER BY position, created_at, id').fetchall()
    return {'items': [_ticker_out(row) for row in rows]}


def create_campaign(conn, actor, payload, request_id):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    placement = payload['placement']
    if placement not in PLACEMENTS:
        raise ApiError('validation_failed', '投放位置不正确')
    status = payload.get('status') or 'active'
    if status not in CAMPAIGN_STATUS:
        raise ApiError('validation_failed', '状态不正确')
    freq_cap = payload.get('freq_cap', 3)
    if not isinstance(freq_cap, int) or not 1 <= freq_cap <= 3:
        raise ApiError('validation_failed', '频控要在 1 到 3 次')
    starts_at, ends_at = _span(payload['starts_at'], payload.get('ends_at'), allow_open=False)
    now = _now()
    campaign_id = str(uuid.uuid4())
    conn.execute(
        'INSERT INTO announce_campaign (id, name, placement, image_url, line, link_url, why, status, starts_at, ends_at, '
        'freq_cap, budget_cents, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
        (campaign_id, _line(payload['name'], 40, '名称'), placement, _clean_url(payload['image_url'], '图片'),
         _line(payload['line'], 36, '一行字'), _clean_url(payload['link_url'], '链接'), _line(payload['why'], 40, '说明'),
         status, starts_at, ends_at, freq_cap, actor.id, now, now))
    audit.record(conn, actor.id, 'announce.campaign_create', 'announce_campaign', campaign_id, request_id=request_id,
                 meta={'placement': placement})
    row = conn.execute('SELECT * FROM announce_campaign WHERE id = ?', (campaign_id,)).fetchone()
    return _campaign_out(row, admin=True)


def update_campaign(conn, actor, campaign_id, payload, request_id):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    row = conn.execute('SELECT * FROM announce_campaign WHERE id = ?', (campaign_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    placement = payload.get('placement', row['placement'])
    if placement not in PLACEMENTS:
        raise ApiError('validation_failed', '投放位置不正确')
    status = payload.get('status', row['status'])
    if status not in CAMPAIGN_STATUS:
        raise ApiError('validation_failed', '状态不正确')
    freq_cap = payload.get('freq_cap', row['freq_cap'])
    if not isinstance(freq_cap, int) or not 1 <= freq_cap <= 3:
        raise ApiError('validation_failed', '频控要在 1 到 3 次')
    starts_at, ends_at = _span(
        payload.get('starts_at', row['starts_at']),
        payload.get('ends_at', row['ends_at']), allow_open=False)
    conn.execute(
        'UPDATE announce_campaign SET name = ?, placement = ?, image_url = ?, line = ?, link_url = ?, why = ?, '
        'status = ?, starts_at = ?, ends_at = ?, freq_cap = ?, budget_cents = NULL, updated_at = ? WHERE id = ?',
        (_line(payload.get('name', row['name']), 40, '名称'), placement,
         _clean_url(payload.get('image_url', row['image_url']), '图片'),
         _line(payload.get('line', row['line']), 36, '一行字'),
         _clean_url(payload.get('link_url', row['link_url']), '链接'),
         _line(payload.get('why', row['why']), 40, '说明'),
         status, starts_at, ends_at, freq_cap, _now(), campaign_id))
    audit.record(conn, actor.id, 'announce.campaign_update', 'announce_campaign', campaign_id, request_id=request_id,
                 meta={'status': status})
    return _campaign_out(conn.execute('SELECT * FROM announce_campaign WHERE id = ?', (campaign_id,)).fetchone(), admin=True)


def list_campaigns(conn, actor):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    rows = conn.execute('SELECT * FROM announce_campaign ORDER BY starts_at DESC, id').fetchall()
    return {'items': [_campaign_out(row, admin=True) for row in rows]}


def calendar(conn, actor, start_on, end_on):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    start = _parse_time(start_on + 'T00:00' if len(start_on) == 10 else start_on, '开始')
    end = _parse_time(end_on + 'T00:00' if len(end_on) == 10 else end_on, '结束')
    if end <= start:
        raise ApiError('validation_failed', '结束要晚于开始')
    rows = conn.execute(
        'SELECT * FROM announce_campaign WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at, id',
        (end, start)).fetchall()
    return {'start': start[:10], 'end': end[:10], 'items': [_campaign_out(row, admin=True) for row in rows]}


def stats(conn, actor):
    flags.gate(conn, 'announce.enabled')
    require(conn, actor, 'announce.admin')
    rows = conn.execute(
        'SELECT campaign_id, day, placement, impressions, clicks FROM announce_ad_stat '
        'ORDER BY day, placement, campaign_id').fetchall()
    return {'rows': [dict(row) for row in rows]}


def export(conn, actor):
    return {name: [dict(row) for row in conn.execute(
        f'SELECT {columns} FROM {table} WHERE principal_id = ?', (actor.id,))]
        for name, table, columns in (
            ('dismissals', 'announce_dismiss', 'item_id, dismissed_at'),
            ('frequency_caps', 'announce_ad_cap', 'campaign_id, day, shown'),
            ('preferences', 'announce_pref', 'marquee_on, ads_on, updated_at'))} | {
        'authored': {table: [dict(row) for row in conn.execute(
            f'SELECT * FROM {table} WHERE created_by = ?', (actor.id,))]
            for table in ('announce_item', 'announce_ticker', 'announce_campaign')}}
