"""R17-F · 只读聚合：实战工坊、合作机会、共同项目、组织星图。

数据全部来自已有模块（orgs、market、events、library），不新建表、不写入。
别的模块没装或功能开关关着时，对应的来源安静地缺席，并在 sources 里标出来。
"""

import json

from app import flags
from app.authz import require
from app.errors import ApiError

from . import service

PRACTICE_KINDS = ('camp', 'challenge')
PRACTICE_STATUS = ('live', 'upcoming')
MAX_ORGS = 24
MAX_ITEMS = 40
STAR_ORGS = 8
STAR_PEOPLE = 8
STAR_WORKS = 6


def _approved(conn, actor):
    rows = conn.execute("SELECT * FROM org WHERE status = 'approved' ORDER BY name").fetchall()
    return [row for row in rows if not service._blocked(conn, actor.id, row['owner_id'])]


def _excerpt(text, size=120):
    text = (text or '').strip()
    return text if len(text) <= size else text[:size] + '…'


def _facts(logic, row, category):
    facts = []
    for key in logic.category_fields(category):
        value = row.get(key) if isinstance(row, dict) else None
        if value not in (None, '', 0):
            facts.append({'label': logic.field_label(key), 'value': str(value)})
    return facts


def _owned_org_slug(conn, orgs, company, principal_id):
    """帖子里的 company 只是自己填的文字；发帖人是该团队的 active 成员才算这个团队的帖子。"""
    for row in orgs.get(company, ()):
        if conn.execute("SELECT 1 FROM org_member WHERE org_id = ? AND principal_id = ? AND state = 'active'",
                        (row['id'], principal_id)).fetchone():
            return row['slug']
    return None


def _market_items(conn, actor, orgs):
    sources, items = {}, []
    for category in ('collab', 'jobs'):
        try:
            if not service._table(conn, 'market_listing'):
                raise ApiError('capability_unavailable')
            flags.gate(conn, 'market.enabled')
            from modules.market import logic, service as market
            rows, _ = market.page(conn, actor, category=category, status='active', size=20)
            for row in rows[:20]:
                dto = market.dto(conn, actor, row)
                company = dto.get('company') or ''
                items.append({
                    'id': dto['id'], 'kind': category, 'kindLabel': dto['category_label'], 'title': dto['title'],
                    'excerpt': dto.get('excerpt', ''), 'facts': _facts(logic, dto, category),
                    'author': dto['author']['display_name'], 'createdAt': dto['created_at'],
                    'href': f'#/market/{dto["id"]}', 'orgSlug': _owned_org_slug(conn, orgs, company, dto['author']['id']),
                })
            sources[category] = 'ok'
        except ImportError:
            sources[category] = 'unavailable'
        except ApiError as error:
            if error.code != 'capability_unavailable' and error.status != 501:
                raise
            sources[category] = 'unavailable'
    return items, sources


def opportunities(conn, actor):
    """合作与外包、内推与招聘（市集）+ 正在招人的团队（orgs）。"""
    require(conn, actor, 'orgs.read')
    orgs = _approved(conn, actor)
    by_name = {}
    for row in orgs:
        by_name.setdefault(row['name'], []).append(row)
    items, sources = _market_items(conn, actor, by_name)
    recruiting = [row for row in orgs if row['join_policy'] == 'apply'][:MAX_ORGS]
    for row in recruiting:
        members = len(service._people(conn, actor, row['id']))
        items.append({
            'id': row['id'], 'kind': 'team', 'kindLabel': '团队招募', 'title': f'{row["name"]} 招募新成员',
            'excerpt': _excerpt(row['intro']),
            'facts': [{'label': '类型', 'value': service.KINDS[row['kind']]}, {'label': '成员', 'value': str(members)}],
            'author': '', 'createdAt': row['reviewed_at'] or row['created_at'], 'href': f'#/org/{row["slug"]}',
            'orgSlug': row['slug'],
        })
    sources['team'] = 'ok'
    items.sort(key=lambda item: (item['createdAt'], item['id']), reverse=True)
    return items[:MAX_ITEMS], sources


def projects(conn, actor):
    """各团队挂在主页上的作品：有作品的团队才算在做共同项目。"""
    require(conn, actor, 'orgs.read')
    out = []
    for row in _approved(conn, actor)[:MAX_ORGS * 2]:
        works = service._objects(conn, actor, row['id'], 'work')
        if not works:
            continue
        out.append({
            'org': {'slug': row['slug'], 'name': row['name'], 'typeLabel': service.KINDS[row['kind']],
                    'verified': bool(row['verified']), 'intro': _excerpt(row['intro'])},
            'members': len(service._people(conn, actor, row['id'])),
            'workCount': len(works),
            'latestAt': works[0]['createdAt'],
            'works': [{'id': work['id'], 'title': work['title'], 'summary': _excerpt(work['summary'], 80),
                       'createdAt': work['createdAt'], 'author': work['author']['name'],
                       'authorHandle': work['author']['handle']} for work in works[:3]],
        })
    out.sort(key=lambda item: (item['latestAt'], item['org']['slug']), reverse=True)
    return out[:MAX_ORGS]


def _practice_events(conn, actor):
    try:
        if not service._table(conn, 'community_event'):
            return None
        flags.gate(conn, 'events.enabled')
        from modules.events import service as events
        rows = [row for row in events.list_events(conn, actor)
                if row['kind'] in PRACTICE_KINDS and row['status'] in PRACTICE_STATUS]
    except ImportError:
        return None
    except ApiError as error:
        if error.code != 'capability_unavailable' and error.status != 501:
            raise
        return None
    return [{'id': row['id'], 'title': row['title'], 'summary': _excerpt(row['summary']),
             'kindLabel': row['kindLabel'], 'statusLabel': row['statusLabel'], 'status': row['status'],
             'startsAt': row['startsAt'], 'endsAt': row['endsAt'], 'place': row['place'], 'host': row['host'],
             'signups': row['signups'], 'href': row['href']} for row in rows[:MAX_ITEMS]]


def _skills(conn, actor):
    try:
        if not service._table(conn, 'lib_item'):
            return None
        flags.gate(conn, 'library.enabled')
        sql, params = service._visible_objects(conn, actor)
        rows = conn.execute(
            'SELECT h.id, h.created_at, v.title, v.content_json, p.display_name AS author_name, i.category '
            'FROM lib_item i JOIN object_head h ON h.id = i.object_id '
            'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
            'JOIN profile p ON p.principal_id = h.author_id '
            f"WHERE i.type = 'skill' AND i.status = 'active' AND {sql} ORDER BY h.created_at DESC LIMIT 12",
            params,
        ).fetchall()
    except ImportError:
        return None
    except ApiError as error:
        if error.code != 'capability_unavailable' and error.status != 501:
            raise
        return None
    return [{'id': row['id'], 'title': row['title'], 'category': row['category'],
             'purpose': _excerpt(json.loads(row['content_json']).get('purpose', ''), 100),
             'author': row['author_name'], 'href': f'#/skills/{row["id"]}'} for row in rows]


def workshop(conn, actor):
    """能动手练的东西：进行中/即将开始的训练营与挑战，以及可以照着装的 Skill。"""
    require(conn, actor, 'orgs.read')
    events, skills = _practice_events(conn, actor), _skills(conn, actor)
    return {'events': events or [], 'skills': skills or []}, {
        'events': 'ok' if events is not None else 'unavailable',
        'skills': 'ok' if skills is not None else 'unavailable'}


def constellation(conn, actor):
    """团队 → 团队作品 → 成员，供组织星图画三圈。只带愿意在主页展示的成员。"""
    require(conn, actor, 'orgs.read')
    out = []
    for row in _approved(conn, actor):
        people = [person for person in service._people(conn, actor, row['id']) if person['showOnProfile']]
        works = service._objects(conn, actor, row['id'], 'work')
        if not people and not works:
            continue
        out.append({
            'id': row['id'], 'slug': row['slug'], 'name': row['name'], 'typeLabel': service.KINDS[row['kind']],
            'intro': _excerpt(row['intro'], 80), 'ownerId': row['owner_id'], 'verified': bool(row['verified']),
            'people': [{'id': p['id'], 'handle': p['handle'] or '', 'name': p['name'], 'level': p['level'],
                        'role': p['role']} for p in people[:STAR_PEOPLE]],
            'works': [{'id': w['id'], 'title': w['title'], 'authorId': w['author']['id']} for w in works[:STAR_WORKS]],
            'weight': len(people) * 2 + len(works) * 3,
        })
    out.sort(key=lambda item: (-item['weight'], item['name']))
    return out[:STAR_ORGS]
