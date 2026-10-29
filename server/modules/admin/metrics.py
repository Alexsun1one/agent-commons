"""Community-health aggregates for ADMIN-1.

Only counts, ratios, dates, and category keys leave this module. Optional module
tables are feature-detected so a partially deployed stack remains inspectable.
"""

import time

from app import clock


def table_exists(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone() is not None


def _metric(value, note, status='ok'):
    return {'value': value, 'status': status, 'note': note}


def _offline(note):
    return _metric(None, note, '模块未上线')


def _iso(ts):
    return clock.iso(ts)


def _week_start(expression):
    return (
        "date(" + expression + ", '-' || "
        "((cast(strftime('%w', " + expression + ") as integer) + 6) % 7) || ' days')"
    )


def collect(conn, now_ts=None):
    now_ts = clock.now_ts() if now_ts is None else float(now_ts)
    now = _iso(now_ts)
    week_ago = _iso(now_ts - 7 * 86400)
    month_ago = _iso(now_ts - 30 * 86400)
    eight_weeks_ago = _iso(now_ts - 56 * 86400)
    year_ago = _iso(now_ts - 366 * 86400)
    today = time.strftime('%Y-%m-%d', time.gmtime(now_ts))
    two_weeks_ago_day = time.strftime('%Y-%m-%d', time.gmtime(now_ts - 13 * 86400))

    active = conn.execute(
        "SELECT count(DISTINCT s.principal_id) FROM session s "
        "JOIN principal p ON p.id = s.principal_id "
        "WHERE p.kind = 'human' AND p.status = 'active' AND s.last_seen_at >= ?",
        (week_ago,),
    ).fetchone()[0]
    new_members = conn.execute(
        "SELECT count(*) FROM principal WHERE kind = 'human' AND status != 'deleted' AND created_at >= ?",
        (week_ago,),
    ).fetchone()[0]

    active_week = _week_start('s.last_seen_at')
    active_trend = [dict(row) for row in conn.execute(
        f"SELECT {active_week} AS week, count(DISTINCT s.principal_id) AS value "
        "FROM session s JOIN principal p ON p.id = s.principal_id "
        "WHERE p.kind = 'human' AND s.last_seen_at >= ? GROUP BY week ORDER BY week",
        (eight_weeks_ago,),
    )]

    retention = [dict(row) for row in conn.execute(
        "WITH cohorts AS ("
        " SELECT p.id, substr(p.created_at, 1, 7) AS cohort,"
        " EXISTS(SELECT 1 FROM session s WHERE s.principal_id = p.id AND s.last_seen_at >= ?) AS retained"
        " FROM principal p WHERE p.kind = 'human' AND p.status != 'deleted' AND p.created_at >= ?"
        ") SELECT cohort, count(*) AS members, sum(retained) AS retained,"
        " round(1.0 * sum(retained) / count(*), 4) AS rate"
        " FROM cohorts GROUP BY cohort ORDER BY cohort",
        (month_ago, year_ago),
    )]

    content_week = _week_start('created_at')
    content = [dict(row) for row in conn.execute(
        f"SELECT {content_week} AS week, type, count(*) AS value FROM object_head "
        "WHERE created_at >= ? AND lifecycle != 'withdrawn' "
        "GROUP BY week, type ORDER BY week, type",
        (eight_weeks_ago,),
    )]

    median_row = conn.execute(
        "WITH first_reply AS ("
        " SELECT root.id, min(reply.created_at) AS answered_at, root.created_at"
        " FROM object_head root JOIN object_head reply ON reply.root_id = root.id"
        " WHERE root.root_id IS NULL AND root.type IN ('discussion', 'problem')"
        " AND root.lifecycle != 'withdrawn' AND reply.lifecycle NOT IN ('hidden', 'withdrawn')"
        " GROUP BY root.id"
        "), durations AS ("
        " SELECT (julianday(answered_at) - julianday(created_at)) * 24.0 AS hours"
        " FROM first_reply WHERE answered_at >= created_at"
        "), ranked AS ("
        " SELECT hours, row_number() OVER (ORDER BY hours) AS rn, count(*) OVER () AS n FROM durations"
        ") SELECT round(avg(hours), 2) FROM ranked WHERE rn IN ((n + 1) / 2, (n + 2) / 2)"
    ).fetchone()[0]

    result = {
        'as_of': now,
        'cards': {
            'weekly_active_members': _metric(active, '最近 7 天有会话活动的活跃人类成员去重数'),
            'new_members_week': _metric(new_members, '最近 7 天新注册且未删除的人类成员数'),
            'median_first_answer_hours': _metric(
                median_row, '讨论或问题卡从创建到首条可见回复的中位小时数'
            ),
        },
        'weekly_active': _metric(active_trend, '按会话最后活动时间归入自然周，成员去重'),
        'retention': _metric(retention, '按注册月分组，最近 30 天仍有会话活动的成员比例'),
        'weekly_content': _metric(content, '最近 8 周未撤回对象，按创建周和对象类型计数'),
    }

    if table_exists(conn, 'bounty') and table_exists(conn, 'bounty_award'):
        row = conn.execute(
            "SELECT count(*) AS total, sum(EXISTS(SELECT 1 FROM bounty_award a WHERE a.bounty_id = b.id)) AS done "
            "FROM bounty b WHERE b.status != 'cancelled'"
        ).fetchone()
        total, done = row['total'], row['done'] or 0
        rate = round(done / total, 4) if total else 0.0
        result['cards']['bounty_completion_rate'] = _metric(
            rate, '未取消悬赏中已经产生 bounty_award 的比例'
        )
    else:
        result['cards']['bounty_completion_rate'] = _offline('悬赏模块未上线')

    if table_exists(conn, 'kb_problem'):
        added = conn.execute('SELECT count(*) FROM kb_problem WHERE created_at >= ?', (week_ago,)).fetchone()[0]
        duplicate = conn.execute(
            "SELECT count(*) FROM audit_event WHERE action = 'kb.duplicate_blocked' "
            "AND outcome = 'denied' AND occurred_at >= ?", (week_ago,)
        ).fetchone()[0]
        result['cards']['kb_new_week'] = _metric(added, '最近 7 天新增问题卡数')
        result['cards']['kb_duplicate_blocked_week'] = _metric(
            duplicate, '最近 7 天审计动作为 kb.duplicate_blocked 的拒绝次数'
        )
    else:
        result['cards']['kb_new_week'] = _offline('问题库模块未上线')
        result['cards']['kb_duplicate_blocked_week'] = _offline('问题库模块未上线')

    if table_exists(conn, 'agent_profile'):
        connected = conn.execute("SELECT count(*) FROM agent_profile WHERE status = 'active'").fetchone()[0]
        result['cards']['connected_agents'] = _metric(connected, '状态为 active 的已接入 Agent 数')
        if table_exists(conn, 'agent_usage_day'):
            calls = conn.execute(
                'SELECT coalesce(sum(calls), 0) FROM agent_usage_day WHERE day = ?', (today,)
            ).fetchone()[0]
            daily = [dict(row) for row in conn.execute(
                "SELECT day, sum(calls) AS value FROM agent_usage_day WHERE day >= ? "
                "GROUP BY day ORDER BY day", (two_weeks_ago_day,)
            )]
            result['cards']['agent_calls_today'] = _metric(calls, 'UTC 今日全部 Agent 令牌调用次数')
            result['agent_calls'] = _metric(daily, '最近 14 个 UTC 日的 Agent 调用次数')
        else:
            result['cards']['agent_calls_today'] = _offline('Agent 调用计量模块未上线')
            result['agent_calls'] = _offline('Agent 调用计量模块未上线')
    else:
        result['cards']['connected_agents'] = _offline('个人 Agent 模块未上线')
        result['cards']['agent_calls_today'] = _offline('个人 Agent 模块未上线')
        result['agent_calls'] = _offline('个人 Agent 模块未上线')

    if table_exists(conn, 'public_crawler_hit'):
        hits = conn.execute(
            'SELECT coalesce(sum(count), 0) FROM public_crawler_hit WHERE day >= date(?)', (week_ago,)
        ).fetchone()[0]
        crawler_rows = [dict(row) for row in conn.execute(
            "SELECT crawler_key, day, count AS value FROM public_crawler_hit "
            "WHERE day >= date(?) ORDER BY day, value DESC, crawler_key", (two_weeks_ago_day,)
        )]
        result['cards']['crawler_hits_week'] = _metric(hits, '最近 7 个 UTC 日的公开层已识别爬虫请求数')
        result['crawler_hits'] = _metric(crawler_rows, '最近 14 个 UTC 日按爬虫和日期计数')
    else:
        result['cards']['crawler_hits_week'] = _offline('公开层模块未上线')
        result['crawler_hits'] = _offline('公开层模块未上线')

    return result
