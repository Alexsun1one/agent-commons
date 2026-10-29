"""ADMIN-2 operating overview: today's numbers against yesterday, 14-day trends and a to-do queue.

Only counts and identifiers leave this module. Optional module tables are feature-detected and
every probe is wrapped so a module that changes shape degrades to "模块未上线" instead of a 500.
"""

import sqlite3
import time

from app import clock

from .metrics import table_exists

URGENCY = {'critical': 0, 'high': 1, 'normal': 2}
TREND_DAYS = 14


def _day(ts):
    return time.strftime('%Y-%m-%d', time.gmtime(ts))


def _start(day):
    return day + 'T00:00:00.000000Z'


def _scalar(conn, sql, args=()):
    try:
        value = conn.execute(sql, args).fetchone()[0]
    except sqlite3.Error:
        return None
    return 0 if value is None else value


def _series(conn, sql, args, days):
    try:
        rows = {row[0]: row[1] or 0 for row in conn.execute(sql, args)}
    except sqlite3.Error:
        return None
    return [{'day': day, 'value': rows.get(day, 0)} for day in days]


def _card(value, previous, note, unit=''):
    if value is None:
        return {'value': None, 'previous': None, 'status': '模块未上线', 'note': note, 'unit': unit}
    return {'value': value, 'previous': previous, 'status': 'ok', 'note': note, 'unit': unit}


def _offline(note, unit=''):
    return _card(None, None, note, unit)


def collect(conn, now_ts=None):
    now_ts = clock.now_ts() if now_ts is None else float(now_ts)
    now = clock.iso(now_ts)
    today, yesterday = _day(now_ts), _day(now_ts - 86400)
    t0, y0 = _start(today), _start(yesterday)
    days = [_day(now_ts - (TREND_DAYS - 1 - i) * 86400) for i in range(TREND_DAYS)]
    first = _start(days[0])

    def pair(sql_today, sql_yesterday, args_today, args_yesterday):
        return _scalar(conn, sql_today, args_today), _scalar(conn, sql_yesterday, args_yesterday)

    cards, trends = {}, {}

    active_sql = ("SELECT count(DISTINCT s.principal_id) FROM session s JOIN principal p ON p.id = s.principal_id "
                  "WHERE p.kind = 'human' AND p.status = 'active' AND s.last_seen_at >= ? AND s.last_seen_at < ?")
    cards['active_today'] = _card(*pair(active_sql, active_sql, (t0, now), (y0, t0)),
                                  note='今天有会话活动的成员；昨日按会话最后活动时间计，会偏低')
    trends['active'] = _series(conn, (
        "SELECT substr(s.last_seen_at, 1, 10) AS d, count(DISTINCT s.principal_id) FROM session s "
        "JOIN principal p ON p.id = s.principal_id WHERE p.kind = 'human' AND s.last_seen_at >= ? GROUP BY d"),
        (first,), days)

    new_sql = "SELECT count(*) FROM principal WHERE kind = 'human' AND status != 'deleted' AND created_at >= ? AND created_at < ?"
    cards['new_members_today'] = _card(*pair(new_sql, new_sql, (t0, now), (y0, t0)), note='今天注册的成员')
    trends['new_members'] = _series(conn, (
        "SELECT substr(created_at, 1, 10) AS d, count(*) FROM principal WHERE kind = 'human' "
        "AND status != 'deleted' AND created_at >= ? GROUP BY d"), (first,), days)

    post_sql = ("SELECT count(*) FROM object_head WHERE root_id IS NULL AND lifecycle != 'withdrawn' "
                "AND created_at >= ? AND created_at < ?")
    cards['posts_today'] = _card(*pair(post_sql, post_sql, (t0, now), (y0, t0)), note='今天新建的顶层内容')
    trends['posts'] = _series(conn, (
        "SELECT substr(created_at, 1, 10) AS d, count(*) FROM object_head WHERE root_id IS NULL "
        "AND lifecycle != 'withdrawn' AND created_at >= ? GROUP BY d"), (first,), days)

    if table_exists(conn, 'kb_problem'):
        solved_sql = ("SELECT count(*) FROM kb_problem WHERE status = 'verified' "
                      "AND updated_at >= ? AND updated_at < ?")
        cards['solved_today'] = _card(*pair(solved_sql, solved_sql, (t0, now), (y0, t0)),
                                      note='今天被验证解决的问题卡')
    else:
        cards['solved_today'] = _offline('问题库模块未上线')

    if table_exists(conn, 'gov_case'):
        pending = _scalar(conn, "SELECT count(*) FROM gov_case WHERE status IN ('open', 'triaged')")
        opened_y = _scalar(conn, "SELECT count(*) FROM gov_case WHERE opened_at >= ? AND opened_at < ?", (y0, t0))
        cards['reports_pending'] = _card(pending, None, '治理队列里尚未处理的事项')
        cards['reports_pending']['opened_yesterday'] = opened_y
    else:
        cards['reports_pending'] = _offline('治理模块未上线')

    # 第三方投诉（访客提交，不经 gov_case）单列一个数，不并入举报待办。
    if table_exists(conn, 'gov_complaint'):
        cards['complaints_pending'] = _card(
            _scalar(conn, "SELECT count(*) FROM gov_complaint WHERE state = 'pending'"), None,
            '第三方投诉里尚未受理的条数')
        cards['complaints_pending']['opened_yesterday'] = _scalar(
            conn, "SELECT count(*) FROM gov_complaint WHERE created_at >= ? AND created_at < ?", (y0, t0))
    else:
        cards['complaints_pending'] = _offline('第三方投诉未上线')

    anomalies, anomalies_y, anomaly_sources = 0, 0, []
    if table_exists(conn, 'economy_anomaly_marker'):
        a = _scalar(conn, 'SELECT count(*) FROM economy_anomaly_marker WHERE day = ?', (today,))
        b = _scalar(conn, 'SELECT count(*) FROM economy_anomaly_marker WHERE day = ?', (yesterday,))
        if a is not None:
            anomalies += a
            anomalies_y += b or 0
            anomaly_sources.append('economy')
    a = _scalar(conn, "SELECT count(*) FROM audit_event WHERE action = 'events.vote_anomaly' AND occurred_at >= ?", (t0,))
    b = _scalar(conn, "SELECT count(*) FROM audit_event WHERE action = 'events.vote_anomaly' "
                      "AND occurred_at >= ? AND occurred_at < ?", (y0, t0))
    anomalies += a or 0
    anomalies_y += b or 0
    burst_sql = ("SELECT count(*) FROM (SELECT inviter_id, substr(created_at, 1, 13) AS h FROM invite_edge "
                 "WHERE inviter_id IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY inviter_id, h "
                 "HAVING count(*) >= 5)")
    anomalies += _scalar(conn, burst_sql, (t0, now)) or 0
    anomalies_y += _scalar(conn, burst_sql, (y0, t0)) or 0
    cards['anomalies_today'] = _card(anomalies, anomalies_y, '竹子异常、打榜异常与邀请注册突增')
    cards['anomalies_today']['sources'] = anomaly_sources + ['events', 'invites']

    if table_exists(conn, 'wallet_entry'):
        net_sql = ("SELECT coalesce(sum(amount), 0) FROM wallet_entry WHERE currency = 'bamboo' "
                   "AND created_at >= ? AND created_at < ?")
        cards['bamboo_net_today'] = _card(*pair(net_sql, net_sql, (t0, now), (y0, t0)),
                                          note='今天发放减去花费的竹子', unit='竹子')
        flow = conn.execute(
            "SELECT coalesce(sum(CASE WHEN amount > 0 THEN amount END), 0) AS issued, "
            "coalesce(-sum(CASE WHEN amount < 0 THEN amount END), 0) AS spent FROM wallet_entry "
            "WHERE currency = 'bamboo' AND created_at >= ?", (t0,)).fetchone()
        cards['bamboo_net_today'].update({'issued': flow['issued'], 'spent': flow['spent']})
        trends['bamboo_net'] = _series(conn, (
            "SELECT substr(created_at, 1, 10) AS d, sum(amount) FROM wallet_entry WHERE currency = 'bamboo' "
            "AND created_at >= ? GROUP BY d"), (first,), days)
    else:
        cards['bamboo_net_today'] = _offline('竹子经济模块未上线', '竹子')
        trends['bamboo_net'] = None

    if table_exists(conn, 'agent_usage_day'):
        calls = 'SELECT coalesce(sum(calls), 0) FROM agent_usage_day WHERE day = ?'
        cards['agent_calls_today'] = _card(*pair(calls, calls, (today,), (yesterday,)), note='今天 Agent 令牌调用次数')
        trends['agent_calls'] = _series(conn, 'SELECT day, sum(calls) FROM agent_usage_day WHERE day >= ? GROUP BY day',
                                        (days[0],), days)
    else:
        cards['agent_calls_today'] = _offline('Agent 调用计量未上线')
        trends['agent_calls'] = None

    if table_exists(conn, 'public_crawler_hit'):
        hits = 'SELECT coalesce(sum(count), 0) FROM public_crawler_hit WHERE day = ?'
        cards['crawler_today'] = _card(*pair(hits, hits, (today,), (yesterday,)), note='今天公开层已识别的爬虫请求')
        trends['crawler'] = _series(conn, 'SELECT day, sum(count) FROM public_crawler_hit WHERE day >= ? GROUP BY day',
                                    (days[0],), days)
    else:
        cards['crawler_today'] = _offline('公开层模块未上线')
        trends['crawler'] = None

    return {'as_of': now, 'day': today, 'cards': cards, 'trends': trends, 'todos': todos(conn, now_ts)}


def todos(conn, now_ts):
    now = clock.iso(now_ts)
    week = clock.iso(now_ts - 7 * 86400)
    day_ago = clock.iso(now_ts - 86400)
    items = []

    def add(key, title, count, urgency, link, oldest=None):
        if count:
            items.append({'key': key, 'title': title, 'count': count, 'urgency': urgency,
                          'oldest_at': oldest, 'link': link})

    if table_exists(conn, 'gov_case'):
        row = conn.execute(
            "SELECT count(*) AS n, min(opened_at) AS oldest, sum(risk IN ('high', 'critical')) AS severe "
            "FROM gov_case WHERE status IN ('open', 'triaged') AND sla_due_at < ?", (now,)).fetchone()
        add('gov_overdue', '治理事项已超时', row['n'], 'critical' if row['severe'] else 'high',
            '#/admin/reports', row['oldest'])
        row = conn.execute(
            "SELECT count(*) AS n, min(opened_at) AS oldest FROM gov_case WHERE status IN ('open', 'triaged') "
            "AND sla_due_at >= ? AND risk IN ('high', 'critical')", (now,)).fetchone()
        add('gov_severe', '高风险事项待处理', row['n'], 'high', '#/admin/reports', row['oldest'])
        row = conn.execute(
            "SELECT count(*) AS n, min(opened_at) AS oldest FROM gov_case WHERE status IN ('open', 'triaged') "
            "AND sla_due_at >= ? AND risk IN ('low', 'medium')", (now,)).fetchone()
        add('gov_open', '普通举报待处理', row['n'], 'normal', '#/admin/review', row['oldest'])
    if table_exists(conn, 'gov_complaint'):
        row = conn.execute("SELECT count(*) AS n, min(created_at) AS oldest FROM gov_complaint "
                           "WHERE state = 'pending'").fetchone()
        add('gov_complaint', '第三方投诉待处理', row['n'], 'normal', '#/govern?tab=complaints', row['oldest'])
    if table_exists(conn, 'gov_action'):
        row = conn.execute("SELECT count(*) AS n, min(created_at) AS oldest FROM gov_action "
                           "WHERE state = 'awaiting_second'").fetchone()
        add('gov_second', '封禁与删除待第二人确认', row['n'], 'high', '#/admin/reports', row['oldest'])
    if table_exists(conn, 'gov_appeal'):
        row = conn.execute("SELECT count(*) AS n, min(created_at) AS oldest FROM gov_appeal "
                           "WHERE state = 'submitted'").fetchone()
        add('gov_appeal', '申诉待复核', row['n'], 'normal', '#/admin/reports', row['oldest'])
    if table_exists(conn, 'economy_anomaly_marker'):
        n = _scalar(conn, 'SELECT count(*) FROM economy_anomaly_marker WHERE created_at >= ?', (week,))
        recent = _scalar(conn, 'SELECT count(*) FROM economy_anomaly_marker WHERE created_at >= ?', (day_ago,))
        add('economy_anomaly', '竹子流水异常', n, 'high' if recent else 'normal', '#/admin/economy/anomaly')
    n = _scalar(conn, "SELECT count(*) FROM audit_event WHERE action = 'events.vote_anomaly' AND occurred_at >= ?",
                (week,))
    add('vote_anomaly', '打榜投票异常', n, 'normal', '#/admin/reports?source=campaign')
    n = _scalar(conn, "SELECT count(*) FROM (SELECT inviter_id, substr(created_at, 1, 13) AS h FROM invite_edge "
                      "WHERE inviter_id IS NOT NULL AND created_at >= ? GROUP BY inviter_id, h HAVING count(*) >= 5)",
                (day_ago,))
    add('invite_burst', '邀请注册突增', n, 'normal', '#/admin/users')
    n = _scalar(conn, "SELECT count(*) FROM outbox_event WHERE state = 'dead'")
    add('outbox_dead', '事件投递失败', n, 'high', '#/admin/system/health')
    if table_exists(conn, 'admin_param_version'):
        n = _scalar(conn, 'SELECT count(*) FROM admin_param_version v JOIN admin_param p '
                          'ON p.namespace = v.namespace AND p.key = v.key '
                          'WHERE v.effective_at > ? AND v.version = p.version', (now,))
        add('param_pending', '参数变更待生效', n, 'normal', '#/admin/games/params')
    items.sort(key=lambda item: (URGENCY[item['urgency']], item['oldest_at'] or now, -item['count']))
    return items
