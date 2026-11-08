"""Optional fictional community data for a new local database."""

import random
import secrets
from datetime import datetime, timezone

from . import accounts, audit, clock, discovery, objects, security
from .authz import require
from .errors import ApiError
from modules.account.service import actor_for
from modules.achievements import service as achievements
from modules.agents import service as agents
from modules.announce import service as announce
from modules.content import service as content
from modules.events import service as events
from modules.growth import engine as growth
from modules.market import service as market
from modules.orgs import service as orgs
from modules.social import service as social


SEED = 20261107
ADMIN_HANDLE = 'demo_admin'
MEMBER_NAMES = ('纸月', '云勺', '苔灯', '雾盒', '星扣', '雨笛',
                '雪帆', '墨芽', '风罐', '砂铃', '露舟', '光栈')
WORK_NAMES = ('纸月词典', '云勺笔记', '苔灯索引', '雾盒图谱',
              '星扣清单', '雨笛画板', '雪帆日历', '墨芽手册')
ORG_NAMES = ('纸月实验室', '云勺开源社', '苔灯共学组')


def seed_demo(db, settings):
    """Commit the entire seed together; never replace existing principals."""
    with db.write() as conn:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'principal'").fetchone():
            raise ApiError('state_conflict', '请先运行 python3 -m app migrate，再写入虚构示例')
        if conn.execute('SELECT 1 FROM principal LIMIT 1').fetchone():
            raise ApiError('state_conflict', 'seed-demo 只允许无用户的空库，请使用新的 COMMONS_DATA_DIR')
        discovery.discover(settings.module_package)
        members = []
        for index, name in enumerate(MEMBER_NAMES):
            handle = ADMIN_HANDLE if index == 0 else f'demo_member_{index:02d}'
            _, invite, _ = accounts.issue_invite(conn, None, note='虚构成员：本机种子数据')
            pid = accounts.register(conn, settings, invite_code=invite, handle=handle,
                                    password=secrets.token_urlsafe(32), display_name=f'虚构成员·{name}')
            growth.set_level(conn, pid, 3 if index < 3 else 2, 'demo', reason_code='虚构成员演示')
            growth.ensure_state(conn, pid)
            members.append(actor_for(conn, pid))
        admin_id = members[0].id
        accounts.set_role(conn, None, admin_id, 'admin')

        # TOTP has only HTTP handlers, no repository helper. Bootstrap uses the
        # core schema in this transaction; no enrollment survives the seed.
        stamp = clock.now()
        secret = security.new_totp_secret()
        step = security.totp_match(secret, security.totp_now(secret), 0)
        if step is None:
            raise ApiError('state_conflict', '本机初始化验证码已过期，请重试')
        conn.execute('INSERT INTO totp_secret (principal_id, secret, created_at, enabled_at, last_step) '
                     'VALUES (?, ?, ?, ?, ?)', (admin_id, secret, stamp, stamp, step))
        audit.record(conn, admin_id, 'demo.bootstrap.begin', 'principal', admin_id,
                     reason='虚构数据初始化；临时 TOTP 仅用于本事务')
        operator = actor_for(conn, admin_id)
        day = datetime.fromtimestamp(clock.now_ts(), timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0).timestamp()
        _community(conn, members, operator, day)
        conn.execute('DELETE FROM totp_secret WHERE principal_id = ?', (admin_id,))
        audit.record(conn, admin_id, 'demo.bootstrap.end', 'principal', admin_id,
                     reason='虚构数据初始化完成；管理员须自行开启 TOTP')
        reset_code, expires = accounts.issue_reset_code(conn, admin_id, admin_id, hours=24)
    return {'handle': ADMIN_HANDLE, 'reset_code': reset_code, 'expires_at': expires}


def _community(conn, members, operator, day):
    rng = random.Random(SEED)
    owners = list(members)
    rng.shuffle(owners)
    for index, owner in enumerate(owners[:8]):
        agents.create_agent(conn, owner, {
            'name': f'虚构 Agent·{MEMBER_NAMES[index]}',
            'intro': f'虚构 Agent：演示{WORK_NAMES[index]}的整理助手，未连接模型。',
            'model_family': 'other', 'client': 'generic',
            'abilities': ['虚构资料整理'], 'palette': agents.PALETTES[index % len(agents.PALETTES)],
        })

    for index, member in enumerate(members):
        other = members[(index + 1) % len(members)]
        social.follow(conn, member, other.id)
        social.follow(conn, other, member.id)

    teams = []
    for index, name in enumerate(ORG_NAMES):
        owner = members[index]
        team = orgs.create(conn, owner, {
            'slug': f'demo-team-{index + 1}', 'name': f'虚构团队·{name}',
            'intro': f'虚构团队：{name}，用于本机协作流程演示。',
            'type': ('lab', 'open_source', 'interest_group')[index], 'join_policy': 'apply',
        })
        orgs.review(conn, operator, team['id'], 'approve', '虚构团队演示')
        teams.append(team)
        for member in members:
            if member.id != owner.id:
                orgs.join(conn, member, team['slug'], note='虚构成员加入演示')
                orgs.review_application(conn, owner, team['slug'], member.id, 'approve', '虚构成员演示')

    for index, name in enumerate(WORK_NAMES):
        author = members[index]
        object_id = objects.create(conn, author, type='work', title=f'虚构作品·{name}', content={
            'body': f'虚构作品：{name}。用虚构材料练习整理、复查和分享，不代表真实项目成果。',
            'summary': f'虚构作品：{name}的本机演示。', 'tags': ['虚构示例'], 'aigc': 'generated',
        })
        content.index_tags(conn, object_id)
        content.refresh_stat(conn, object_id)
        orgs.attach_work(conn, author, teams[index % len(teams)]['slug'], object_id)
        achievements.record_metric(conn, author.id, 'work_shared', f'object:{object_id}')

    require(conn, operator, 'events.manage')
    for index, offset in enumerate((-3, 2, 7, 14)):
        starts = day + offset * 86400 + 10 * 3600
        events.create_event(conn, operator, {
            'slug': f'demo-event-{index + 1}', 'kind': ('meetup', 'camp', 'challenge', 'talks')[index],
            'title': f'虚构活动·{MEMBER_NAMES[index]}共学',
            'summary': '虚构活动：仅演示报名和日程，没有实际举办安排。',
            'rules': '虚构活动规则：使用虚构材料练习，不提供实际报名服务。',
            'place': '虚构空间', 'starts_at': clock.iso(starts), 'ends_at': clock.iso(starts + 7200),
        })

    for index, team in enumerate(teams):
        market.create(conn, members[index], {
            'title': f'虚构招募·{ORG_NAMES[index]}资料整理', 'category': 'jobs',
            'body': f'虚构招募：{ORG_NAMES[index]}用于展示合作入口，没有实际岗位。',
            'company': team['name'], 'position': '虚构资料整理员', 'work_mode': '虚构远程协作',
        })

    for title, body in (
        ('虚构公告·欢迎体验', '虚构公告：这里的成员、团队、作品和活动均为本机生成的虚构示例。'),
        ('虚构公告·共学说明', '虚构公告：招募和活动仅供流程体验，不对应真实岗位或举办安排。'),
    ):
        announce.create_item(conn, operator, {
            'level': 'normal', 'title': title, 'body': body, 'audience': 'site',
            'starts_at': clock.iso(day), 'dismissible': True,
        }, request_id=None)
