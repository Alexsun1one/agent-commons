"""事件热度。算法参考开源项目 AIHOT（KKKKhazix/AIHOT，MIT），只借算法。

  - 同一事件里，每个独立来源在 DEDUPE_H（48 小时）内只计一次；
  - 信号按年龄衰减，半衰期 HALF_LIFE_H（24 小时：超过 24 小时减半，之后继续对半）；
  - 站内信号（收藏、讨论、开房间）另算，权重是参数，同样衰减；
  - hourly_series() 给热度曲线：每个整点按"当时能看到的信号"重算。
"""
from datetime import timedelta

from . import sources as _sources
from .cluster import parse_time

PARAMS = {
    "dedupe_h": 48.0,
    "half_life_h": 24.0,
    "source_base": 10.0,   # 一个权重 1.0 的来源刚发布时贡献的热度
    "w_favorite": 2.0,
    "w_comment": 1.5,
    "w_room": 4.0,
}

SITE_KINDS = {"favorite": "w_favorite", "comment": "w_comment", "room": "w_room"}


def decay(age_h, half_life_h):
    if age_h <= 0:
        return 1.0
    return 0.5 ** (age_h / half_life_h)


def counted_signals(event, source_map=None, params=None, until=None):
    """每个来源的有效信号：同源条目在 dedupe_h 内只计第一条。

    返回 [(时间, 来源 id, 权重)]。until 之后发布的信号不计。
    """
    p = dict(PARAMS, **(params or {}))
    source_map = source_map if source_map is not None else _sources.SOURCE_BY_ID
    by_source = {}
    for it in event["items"]:
        t = parse_time(it.get("published_at"))
        if t is None or (until is not None and t > until):
            continue
        by_source.setdefault(it["source"], []).append(t)
    out = []
    gap = timedelta(hours=p["dedupe_h"])
    for sid, times in by_source.items():
        w = source_map.get(sid, {}).get("weight", 1.0)
        last = None
        for t in sorted(times):
            if last is None or t - last >= gap:
                out.append((t, sid, w))
                last = t
    return out


def site_signals_for(event_id, site, until=None):
    """site: [{event_id, kind(favorite|comment|room), at(ISO)}]"""
    out = []
    for s in site or []:
        if s["event_id"] != event_id or s["kind"] not in SITE_KINDS:
            continue
        t = parse_time(s["at"])
        if until is not None and t > until:
            continue
        out.append((t, s["kind"]))
    return out


def heat(event, now, site=None, source_map=None, params=None):
    p = dict(PARAMS, **(params or {}))
    now = parse_time(now)
    total = 0.0
    for t, _sid, w in counted_signals(event, source_map, p, until=now):
        total += p["source_base"] * w * decay((now - t).total_seconds() / 3600.0, p["half_life_h"])
    for t, kind in site_signals_for(event["id"], site, until=now):
        total += p[SITE_KINDS[kind]] * decay(
            (now - t).total_seconds() / 3600.0, p["half_life_h"])
    return round(total, 2)


def hourly_series(event, now, hours=24, site=None, source_map=None, params=None):
    """最近 hours 小时每个整点的热度（含当前，共 hours+1 个点，旧 -> 新）。"""
    now = parse_time(now)
    return [
        heat(event, now - timedelta(hours=h), site, source_map, params)
        for h in range(hours, -1, -1)
    ]


def rank(events, now, site=None, source_map=None, params=None):
    """按当前热度降序，同热度按首次出现时间新者在前。返回 [(event, heat)]。"""
    scored = [(e, heat(e, now, site, source_map, params)) for e in events]
    scored.sort(key=lambda x: (-x[1], _neg(x[0]["first_seen"]), x[0]["id"]))
    return scored


def _neg(iso):
    # 新的在前：时间字符串取反排序
    return "".join(chr(0x10FFFF - ord(c)) for c in (iso or ""))
