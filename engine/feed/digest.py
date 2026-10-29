"""每日日报：按方向分组取前 N 个事件，用模板生成文字，不调模型。"""
from datetime import timedelta

from . import sources as _sources
from .cluster import parse_time
from .heat import rank

INTRO = "今天聚合了 {events} 个事件，来自 {sources} 个来源。"
LINE = "{title}。{count} 个来源报道（{names}），{ago}前首次出现。"
LINE_ONE = "{title}。来自 {names}，{ago}前发布。"


def _ago(first_seen, now):
    t = parse_time(first_seen)
    if t is None:
        return "不久"
    hours = max(0, int((now - t).total_seconds() // 3600))
    return "不到 1 小时" if hours < 1 else "%d 小时" % hours


def build(events, now, per_direction=3, window_h=36, site=None, source_map=None, directions=None):
    """返回 {date, intro, sections:[{direction, label, items:[{event_id,title,text,heat}]}], text}。"""
    source_map = source_map if source_map is not None else _sources.SOURCE_BY_ID
    directions = directions if directions is not None else _sources.DIRECTIONS
    now_t = parse_time(now)
    fresh = [
        e for e in events
        if e["last_seen"] and parse_time(e["last_seen"]) >= now_t - timedelta(hours=window_h)
    ]
    ranked = rank(fresh, now_t, site, source_map)
    sections = []
    for did, label in directions:
        items = []
        for e, h in ranked:
            if e["direction"] != did or len(items) >= per_direction:
                continue
            names = [source_map[s]["name"] if s in source_map else s for s in e["source_ids"]]
            tpl = LINE if len(names) > 1 else LINE_ONE
            display_title = e.get("title_zh") or e["title"]
            items.append({
                "event_id": e["id"],
                "title": e["title"],
                "title_zh": e.get("title_zh") or "",
                "summary_zh": e.get("summary_zh") or "",
                "text": tpl.format(
                    title=display_title.rstrip("。.!！"), count=len(names),
                    names="、".join(names[:3]) + (" 等" if len(names) > 3 else ""),
                    ago=_ago(e["first_seen"], now_t)),
                "heat": h,
            })
        if items:
            sections.append({"direction": did, "label": label, "items": items})
    date = now_t.strftime("%Y-%m-%d")
    intro = INTRO.format(events=len(fresh), sources=len({s for e in fresh for s in e["source_ids"]}))
    lines = ["# AI 热点日报 · %s" % date, "", intro]
    for sec in sections:
        lines += ["", "## " + sec["label"]]
        lines += ["%d. %s" % (i + 1, it["text"]) for i, it in enumerate(sec["items"])]
    return {"date": date, "intro": intro, "sections": sections, "text": "\n".join(lines)}
