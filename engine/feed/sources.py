"""公开源配置表。地址只在这里登记；本模块和 A 段任何代码都不发请求。

`verified` 全部为 False：A 段没有联网，地址写的是常见公开订阅地址，B 段上线前要逐个确认
能取到、许可允许、站点 robots/条款不禁止。
"""

# 方向：id -> 显示名
DIRECTIONS = [
    ("model", "模型"),
    ("agent", "智能体"),
    ("coding", "编程"),
    ("opensource", "开源"),
    ("product", "产品"),
    ("research", "研究"),
]
DIRECTION_LABELS = dict(DIRECTIONS)


def _s(id, name, type, url, lang, weight, direction, **extra):
    d = {
        "id": id,
        "name": name,
        "type": type,  # rss | atom | json | html-list
        "url": url,
        "lang": lang,
        "weight": weight,  # 权威度 0.5–1.5：厂商官方 > 媒体 > 社区
        "direction": direction,
        "verified": False,
    }
    d.update(extra)
    return d


SOURCES = [
    _s("openai", "OpenAI 新闻", "rss", "https://openai.com/news/rss.xml", "en", 1.5, "model"),
    _s("google-ai", "Google AI 博客", "rss", "https://blog.google/technology/ai/rss/", "en", 1.4, "model"),
    _s("deepmind", "DeepMind 博客", "rss", "https://deepmind.google/blog/rss.xml", "en", 1.4, "research"),
    _s("hf-blog", "Hugging Face 博客", "rss", "https://huggingface.co/blog/feed.xml", "en", 1.1, "opensource"),
    _s("qwen", "通义千问博客", "rss", "https://qwenlm.github.io/blog/index.xml", "en", 1.3, "model"),
    _s("langchain", "LangChain 博客", "rss", "https://blog.langchain.dev/rss/", "en", 1.0, "agent"),
    _s("simon", "Simon Willison", "atom", "https://simonwillison.net/atom/everything/", "en", 1.0, "coding"),
    _s("latent-space", "Latent Space", "rss", "https://www.latent.space/feed", "en", 0.9, "agent"),
    _s("hn", "Hacker News", "rss", "https://hnrss.org/newest?q=LLM+OR+agent+OR+GPT&points=100", "en", 0.8, "product"),
    _s("arxiv-ai", "arXiv cs.AI", "rss", "https://rss.arxiv.org/rss/cs.AI", "en", 0.7, "research"),
    _s("gh-trending", "GitHub Trending", "html-list", "https://github.com/trending?since=daily", "en", 0.9, "opensource"),
    _s("producthunt", "Product Hunt", "atom", "https://www.producthunt.com/feed", "en", 0.7, "product"),
    _s("jiqizhixin", "机器之心", "rss", "https://www.jiqizhixin.com/rss", "zh", 1.0, "model"),
    _s("qbitai", "量子位", "rss", "https://www.qbitai.com/feed", "zh", 1.0, "product"),
    _s("sspai", "少数派", "rss", "https://sspai.com/feed", "zh", 0.8, "product"),
    _s("ai-json", "AI 周刊（JSON Feed）", "json", "https://example.org/ai-weekly/feed.json", "zh", 0.8, "research",
       note="占位地址，B 段换成真实的 JSON Feed 源"),
]

SOURCE_BY_ID = {s["id"]: s for s in SOURCES}


def get(source_id):
    return SOURCE_BY_ID.get(source_id)


def initial(name):
    """来源头像上的首字：取名称第一个非空白字符，西文大写。"""
    for ch in name.strip():
        return ch.upper()
    return "?"
