"""生成 preview/hot-sample.js：手写假报道 -> 假传输 -> 抓取器 -> 解析 -> 聚类 -> 热度 -> 日报。

用法（项目根目录）：python3 -m engine.feed.make_sample [输出路径]
整个过程不联网。报道内容是虚构的示例，网址用 .example 域名。输出的形状就是将来接口的形状。
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from xml.sax.saxutils import escape

from . import cluster, digest, heat, sources
from .fetch import Fetcher, Response

NOW = datetime(2026, 10, 25, 8, 0, 0, tzinfo=timezone.utc)

# (来源, 标题, 几小时前, 路径)
RAW = [
    ("openai", "OpenAI releases GPT-5.5 with steadier long-running agent skills", 5.0, "news/gpt-5-5"),
    ("hn", "GPT-5.5 released by OpenAI", 4.6, "item/1001"),
    ("jiqizhixin", "OpenAI 发布 GPT-5.5：长时间运行的智能体更稳了", 3.6, "articles/gpt-5-5"),
    ("qbitai", "GPT-5.5 实测：OpenAI 新模型哪里变强了", 3.0, "2026/10/gpt-5-5"),
    ("latent-space", "Notes on GPT-5.5 and what changes for agent builders", 2.0, "p/gpt-5-5"),

    ("qwen", "Qwen3.5 open-weights family adds long-context variants", 8.0, "blog/qwen3-5"),
    ("jiqizhixin", "通义千问 Qwen3.5 开源长上下文系列", 7.2, "articles/qwen3-5"),
    ("hf-blog", "Qwen3.5 is now on the Hub", 6.4, "blog/qwen3-5"),

    ("google-ai", "Gemini 3 Flash brings faster responses to the Gemini app", 20.0, "gemini-3-flash"),
    ("hn", "Gemini 3 Flash is rolling out", 19.0, "item/1002"),
    ("qbitai", "谷歌 Gemini 3 Flash 上线，响应速度更快", 18.0, "2026/10/gemini-3-flash"),

    ("langchain", "LangChain ships durable execution for long-running agents", 10.0, "durable-execution"),
    ("latent-space", "Durable agents: LangChain's new runtime", 9.0, "p/durable-agents"),
    ("hn", "LangChain durable execution for agents", 8.0, "item/1003"),

    ("simon", "Notes on Cursor background agents", 12.0, "2026/Oct/cursor-background"),
    ("hn", "Cursor adds background agents that open pull requests", 11.0, "item/1004"),
    ("qbitai", "Cursor 上线后台智能体，并行改代码、自动提 PR", 10.0, "2026/10/cursor-background"),

    ("latent-space", "MCP spec adds streamable auth flows", 14.0, "p/mcp-auth"),
    ("hn", "MCP spec update: streamable authorization", 13.0, "item/1005"),
    ("jiqizhixin", "MCP 规范新增流式授权流程", 12.0, "articles/mcp-auth"),

    ("gh-trending", "acme-labs/agent-kit", 6.0, "acme-labs/agent-kit"),
    ("hn", "Show HN: acme-labs/agent-kit, a tiny toolkit for tool-using agents", 5.0, "item/1006"),

    ("hf-blog", "Open small models for on-device agents: a practical guide", 15.0, "blog/on-device-agents"),
    ("gh-trending", "demo-org/voice-notes", 9.0, "demo-org/voice-notes"),

    ("deepmind", "A study on long-horizon agent reliability", 22.0, "blog/agent-reliability"),
    ("arxiv-ai", "Scaling test-time compute for code agents", 9.5, "abs/2610.00001"),

    ("producthunt", "Lumen: a voice-first notes app with agent summaries", 7.0, "posts/lumen"),
    ("hn", "Show HN: A small CLI that turns meeting audio into notes", 3.5, "item/1007"),

    ("openai", "OpenAI updates its model spec", 40.0, "news/model-spec"),
]

# 聚类主标题 ->（中文标题，一句中文摘要）。全为人工示例，不调用模型。
LOCALIZED = {
    "OpenAI releases GPT-5.5 with steadier long-running agent skills":
        ("OpenAI 发布 GPT-5.5，长任务智能体更稳", "新模型重点提升长时间运行的智能体稳定性。"),
    "Qwen3.5 open-weights family adds long-context variants":
        ("Qwen3.5 开源系列新增长上下文版本", "通义千问扩充了面向长上下文的开源模型系列。"),
    "Notes on Cursor background agents":
        ("Cursor 推出后台智能体", "后台智能体可并行处理代码任务并提交修改。"),
    "LangChain ships durable execution for long-running agents":
        ("LangChain 上线长任务持久执行", "新运行时支持长时间智能体任务中断后续跑。"),
    "acme-labs/agent-kit":
        ("轻量智能体工具包 agent-kit 走红", "这个小型开源工具包进入 GitHub 热门项目。"),
    "MCP 规范新增流式授权流程":
        ("MCP 规范新增流式授权流程", "MCP 规范新增流式授权流程"),
    "Gemini 3 Flash brings faster responses to the Gemini app":
        ("Gemini 3 Flash 提升应用响应速度", "谷歌把更快的 Gemini 3 Flash 推向应用端。"),
    "A study on long-horizon agent reliability":
        ("研究关注长程智能体可靠性", "新研究分析智能体执行长任务时的可靠性问题。"),
    "Show HN: A small CLI that turns meeting audio into notes":
        ("小型命令行工具把会议音频转成笔记", "这个命令行项目尝试自动整理会议录音。"),
    "Open small models for on-device agents: a practical guide":
        ("端侧智能体小模型实践指南发布", "指南讨论如何为端侧智能体选择开放小模型。"),
    "demo-org/voice-notes":
        ("开源语音笔记项目进入热门榜", "voice-notes 项目登上 GitHub 热门列表。"),
    "Lumen: a voice-first notes app with agent summaries":
        ("Lumen 用智能体整理语音笔记", "这款语音优先的笔记应用加入智能体摘要。"),
    "Scaling test-time compute for code agents":
        ("研究探索代码智能体的测试时计算扩展", "论文研究增加测试时计算对代码智能体的影响。"),
    "OpenAI updates its model spec":
        ("OpenAI 更新模型规范", "OpenAI 发布了模型行为规范的新版本。"),
}

UNREACHABLE = ["sspai", "ai-json"]  # 假传输让这两个源返回 503

# 站内信号：(事件内第一条的来源+路径关键词, 收藏, 评论, 房间, 最近几小时内)
SITE = {
    "news/gpt-5-5": (14, 9, 2),
    "blog/qwen3-5": (6, 3, 1),
    "durable-execution": (4, 2, 0),
    "2026/Oct/cursor-background": (9, 5, 1),
    "p/mcp-auth": (3, 1, 0),
    "acme-labs/agent-kit": (5, 1, 0),
}

RELATED = {
    "news/gpt-5-5": {
        "knowledge": ("长任务智能体怎么拆步骤、留检查点", "方法 · 智能体"),
        "work": ("用新模型重跑的周报整理流程", "作品 · 复现 3 人"),
        "discussion": ("新模型值不值得换？先跑哪三个任务", "讨论 · 18 条回复"),
    },
    "blog/qwen3-5": {
        "knowledge": ("本地跑开源模型的显存预算表", "方法 · 开源"),
        "work": ("长文档问答的离线小工具", "作品 · 复现 1 人"),
        "discussion": ("长上下文到底该不该用", "讨论 · 7 条回复"),
    },
    "gemini-3-flash": {
        "knowledge": ("在低延迟场景选模型的几条经验", "方法 · 模型"),
        "discussion": ("快模型做路由，慢模型做复核", "讨论 · 5 条回复"),
    },
    "durable-execution": {
        "knowledge": ("智能体掉线后怎么续上", "方法 · 智能体"),
        "work": ("带断点续跑的采集智能体", "作品 · 复现 2 人"),
    },
    "2026/Oct/cursor-background": {
        "knowledge": ("让后台智能体提 PR 的评审清单", "方法 · 编程"),
        "work": ("自动补测试的工作流", "作品 · 复现 4 人"),
        "discussion": ("后台智能体会不会把仓库改乱", "讨论 · 11 条回复"),
    },
    "p/mcp-auth": {
        "knowledge": ("给 MCP 工具加授权的最小做法", "方法 · 智能体"),
    },
    "acme-labs/agent-kit": {
        "work": ("拿 agent-kit 搭的日报机器人", "作品 · 复现 1 人"),
        "discussion": ("小工具包怎么选", "讨论 · 4 条回复"),
    },
}


def build_rss(source_id, rows):
    out = ['<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>demo</title>']
    for title, hours_ago, path in rows:
        when = (NOW - timedelta(hours=hours_ago)).strftime("%a, %d %b %Y %H:%M:%S GMT")
        out.append(
            "<item><title>%s</title><link>http://%s.example/%s/?utm_source=rss</link>"
            "<description>示例摘录：%s</description><pubDate>%s</pubDate></item>"
            % (escape(title), source_id, path, escape(title), when))
    out.append("</channel></rss>")
    return "".join(out).encode("utf-8")


def make_transport():
    by_source = {}
    for sid, title, hours_ago, path in RAW:
        by_source.setdefault(sid, []).append((title, hours_ago, path))
    by_url = {}
    for s in sources.SOURCES:
        if s["id"] in UNREACHABLE:
            by_url[s["url"]] = Response(503)
        elif s["id"] in by_source:
            body = build_rss(s["id"], by_source[s["id"]])
            by_url[s["url"]] = Response(200, body, {"Content-Type": "application/xml; charset=utf-8"})
        else:
            by_url[s["url"]] = Response(200, build_rss(s["id"], []))
    return lambda req: by_url[req["url"]]


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def build():
    srcs = [dict(s, type="rss") for s in sources.SOURCES]  # 假传输一律回 RSS
    fetcher = Fetcher(make_transport(), sources=srcs, retries=1, backoff=0, min_interval=0,
                      sleep=lambda s: None, now=NOW)
    results, summary = fetcher.fetch_all()
    items = [it for r in results for it in r.items]

    lx = cluster.default_lexicon().add("agent-kit", ["agent-kit"], strong=True, direction="opensource")
    events = cluster.cluster(items, sources.SOURCE_BY_ID, lx)
    for event in events:
        event["title_zh"], event["summary_zh"] = LOCALIZED[event["title"]]

    # 站内信号：按每个事件里出现的路径关键词匹配，时间散在最近几小时
    site = []
    for e in events:
        for key, (fav, com, room) in SITE.items():
            if any(key in it["url"] for it in e["items"]):
                latest = cluster.parse_time(e["last_seen"])
                for kind, n in (("favorite", fav), ("comment", com), ("room", room)):
                    for i in range(n):
                        at = min(NOW, latest + timedelta(minutes=20 + 25 * i))
                        site.append({"event_id": e["id"], "kind": kind, "at": iso(at)})

    ranked = heat.rank(events, NOW, site, sources.SOURCE_BY_ID)
    out_events = []
    for e, h in ranked:
        counts = {"favorites": 0, "comments": 0, "rooms": 0}
        for s in site:
            if s["event_id"] == e["id"]:
                counts[{"favorite": "favorites", "comment": "comments", "room": "rooms"}[s["kind"]]] += 1
        related = {}
        for key, rel in RELATED.items():
            if any(key in it["url"] for it in e["items"]):
                related = {k: {"title": v[0], "meta": v[1]} for k, v in rel.items()}
        rows = sorted(e["items"], key=lambda it: it["published_at"] or "")
        srcmap = sources.SOURCE_BY_ID
        out_events.append({
            "id": e["id"],
            "title": e["title"],
            "title_zh": e["title_zh"],
            "summary_zh": e["summary_zh"],
            "direction": e["direction"],
            "first_seen": e["first_seen"],
            "last_seen": e["last_seen"],
            "source_count": len(e["source_ids"]),
            "heat": h,
            "series": heat.hourly_series(e, NOW, 24, site, sources.SOURCE_BY_ID),
            "sources": [{
                "source": it["source"], "name": srcmap[it["source"]]["name"], "title": it["title"],
                "url": it["canonical_url"], "published_at": it["published_at"], "lang": it["lang"],
            } for it in rows],
            "site": counts,
            "related": related,
        })

    d = digest.build(events, NOW, per_direction=2, site=site, source_map=sources.SOURCE_BY_ID)
    return {
        "sample": True,
        "generated_at": iso(NOW),
        "directions": [{"id": i, "label": l} for i, l in sources.DIRECTIONS],
        "sources": [{"id": s["id"], "name": s["name"], "initial": sources.initial(s["name"]),
                     "direction": s["direction"], "lang": s["lang"]} for s in sources.SOURCES],
        "failed_sources": summary["failed"],
        "top": [e["id"] for e in out_events[:3]],
        "events": out_events,
        "digest": d,
    }


def main(argv):
    path = argv[1] if len(argv) > 1 else "preview/hot-sample.js"
    data = build()
    body = json.dumps(data, ensure_ascii=False, indent=1)
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* R13 FEED-1 · 热点示例数据。由 engine/feed/make_sample.py 生成（假传输 -> 抓取 -> 解析 -> 聚类 -> 热度 -> 日报），\n"
                "   内容是虚构的示例，不是真实报道；形状就是将来 /api/feed 的形状。不要手改，改 make_sample.py 再生成。 */\n")
        f.write("window.COMMONS_HOT_SAMPLE = " + body + ";\n")
    print("wrote %s: %d events, %d failed sources" % (path, len(data["events"]), len(data["failed_sources"])))


if __name__ == "__main__":
    main(sys.argv)
