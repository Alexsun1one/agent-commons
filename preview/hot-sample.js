/* R13 FEED-1 · 热点示例数据。由 engine/feed/make_sample.py 生成（假传输 -> 抓取 -> 解析 -> 聚类 -> 热度 -> 日报），
   内容是虚构的示例，不是真实报道；形状就是将来 /api/feed 的形状。不要手改，改 make_sample.py 再生成。 */
window.COMMONS_HOT_SAMPLE = {
 "sample": true,
 "generated_at": "2026-10-25T08:00:00Z",
 "directions": [
  {
   "id": "model",
   "label": "模型"
  },
  {
   "id": "agent",
   "label": "智能体"
  },
  {
   "id": "coding",
   "label": "编程"
  },
  {
   "id": "opensource",
   "label": "开源"
  },
  {
   "id": "product",
   "label": "产品"
  },
  {
   "id": "research",
   "label": "研究"
  }
 ],
 "sources": [
  {
   "id": "openai",
   "name": "OpenAI 新闻",
   "initial": "O",
   "direction": "model",
   "lang": "en"
  },
  {
   "id": "google-ai",
   "name": "Google AI 博客",
   "initial": "G",
   "direction": "model",
   "lang": "en"
  },
  {
   "id": "deepmind",
   "name": "DeepMind 博客",
   "initial": "D",
   "direction": "research",
   "lang": "en"
  },
  {
   "id": "hf-blog",
   "name": "Hugging Face 博客",
   "initial": "H",
   "direction": "opensource",
   "lang": "en"
  },
  {
   "id": "qwen",
   "name": "通义千问博客",
   "initial": "通",
   "direction": "model",
   "lang": "en"
  },
  {
   "id": "langchain",
   "name": "LangChain 博客",
   "initial": "L",
   "direction": "agent",
   "lang": "en"
  },
  {
   "id": "simon",
   "name": "Simon Willison",
   "initial": "S",
   "direction": "coding",
   "lang": "en"
  },
  {
   "id": "latent-space",
   "name": "Latent Space",
   "initial": "L",
   "direction": "agent",
   "lang": "en"
  },
  {
   "id": "hn",
   "name": "Hacker News",
   "initial": "H",
   "direction": "product",
   "lang": "en"
  },
  {
   "id": "arxiv-ai",
   "name": "arXiv cs.AI",
   "initial": "A",
   "direction": "research",
   "lang": "en"
  },
  {
   "id": "gh-trending",
   "name": "GitHub Trending",
   "initial": "G",
   "direction": "opensource",
   "lang": "en"
  },
  {
   "id": "producthunt",
   "name": "Product Hunt",
   "initial": "P",
   "direction": "product",
   "lang": "en"
  },
  {
   "id": "jiqizhixin",
   "name": "机器之心",
   "initial": "机",
   "direction": "model",
   "lang": "zh"
  },
  {
   "id": "qbitai",
   "name": "量子位",
   "initial": "量",
   "direction": "product",
   "lang": "zh"
  },
  {
   "id": "sspai",
   "name": "少数派",
   "initial": "少",
   "direction": "product",
   "lang": "zh"
  },
  {
   "id": "ai-json",
   "name": "AI 周刊（JSON Feed）",
   "initial": "A",
   "direction": "research",
   "lang": "zh"
  }
 ],
 "failed_sources": [
  "sspai",
  "ai-json"
 ],
 "top": [
  "ev-3fad402197",
  "ev-bd451429fa",
  "ev-1707e585b2"
 ],
 "events": [
  {
   "id": "ev-3fad402197",
   "title": "OpenAI releases GPT-5.5 with steadier long-running agent skills",
   "title_zh": "OpenAI 发布 GPT-5.5，长任务智能体更稳",
   "summary_zh": "新模型重点提升长时间运行的智能体稳定性。",
   "direction": "model",
   "first_seen": "2026-10-25T03:00:00Z",
   "last_seen": "2026-10-25T06:00:00Z",
   "source_count": 5,
   "heat": 95.42,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    15.0,
    22.44,
    41.63,
    49.44,
    62.84,
    95.42
   ],
   "sources": [
    {
     "source": "openai",
     "name": "OpenAI 新闻",
     "title": "OpenAI releases GPT-5.5 with steadier long-running agent skills",
     "url": "https://openai.example/news/gpt-5-5",
     "published_at": "2026-10-25T03:00:00Z",
     "lang": "en"
    },
    {
     "source": "hn",
     "name": "Hacker News",
     "title": "GPT-5.5 released by OpenAI",
     "url": "https://hn.example/item/1001",
     "published_at": "2026-10-25T03:24:00Z",
     "lang": "en"
    },
    {
     "source": "jiqizhixin",
     "name": "机器之心",
     "title": "OpenAI 发布 GPT-5.5：长时间运行的智能体更稳了",
     "url": "https://jiqizhixin.example/articles/gpt-5-5",
     "published_at": "2026-10-25T04:24:00Z",
     "lang": "zh"
    },
    {
     "source": "qbitai",
     "name": "量子位",
     "title": "GPT-5.5 实测：OpenAI 新模型哪里变强了",
     "url": "https://qbitai.example/2026/10/gpt-5-5",
     "published_at": "2026-10-25T05:00:00Z",
     "lang": "zh"
    },
    {
     "source": "latent-space",
     "name": "Latent Space",
     "title": "Notes on GPT-5.5 and what changes for agent builders",
     "url": "https://latent-space.example/p/gpt-5-5",
     "published_at": "2026-10-25T06:00:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 14,
    "comments": 9,
    "rooms": 2
   },
   "related": {
    "knowledge": {
     "title": "长任务智能体怎么拆步骤、留检查点",
     "meta": "方法 · 智能体"
    },
    "work": {
     "title": "用新模型重跑的周报整理流程",
     "meta": "作品 · 复现 3 人"
    },
    "discussion": {
     "title": "新模型值不值得换？先跑哪三个任务",
     "meta": "讨论 · 18 条回复"
    }
   }
  },
  {
   "id": "ev-bd451429fa",
   "title": "Qwen3.5 open-weights family adds long-context variants",
   "title_zh": "Qwen3.5 开源系列新增长上下文版本",
   "summary_zh": "通义千问扩充了面向长上下文的开源模型系列。",
   "direction": "model",
   "first_seen": "2026-10-25T00:00:00Z",
   "last_seen": "2026-10-25T01:36:00Z",
   "source_count": 3,
   "heat": 45.15,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    13.0,
    22.57,
    40.29,
    46.05,
    48.67,
    49.23,
    47.83,
    46.47,
    45.15
   ],
   "sources": [
    {
     "source": "qwen",
     "name": "通义千问博客",
     "title": "Qwen3.5 open-weights family adds long-context variants",
     "url": "https://qwen.example/blog/qwen3-5",
     "published_at": "2026-10-25T00:00:00Z",
     "lang": "en"
    },
    {
     "source": "jiqizhixin",
     "name": "机器之心",
     "title": "通义千问 Qwen3.5 开源长上下文系列",
     "url": "https://jiqizhixin.example/articles/qwen3-5",
     "published_at": "2026-10-25T00:48:00Z",
     "lang": "zh"
    },
    {
     "source": "hf-blog",
     "name": "Hugging Face 博客",
     "title": "Qwen3.5 is now on the Hub",
     "url": "https://hf-blog.example/blog/qwen3-5",
     "published_at": "2026-10-25T01:36:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 6,
    "comments": 3,
    "rooms": 1
   },
   "related": {
    "knowledge": {
     "title": "本地跑开源模型的显存预算表",
     "meta": "方法 · 开源"
    },
    "work": {
     "title": "长文档问答的离线小工具",
     "meta": "作品 · 复现 1 人"
    },
    "discussion": {
     "title": "长上下文到底该不该用",
     "meta": "讨论 · 7 条回复"
    }
   }
  },
  {
   "id": "ev-1707e585b2",
   "title": "Notes on Cursor background agents",
   "title_zh": "Cursor 推出后台智能体",
   "summary_zh": "后台智能体可并行处理代码任务并提交修改。",
   "direction": "coding",
   "first_seen": "2026-10-24T20:00:00Z",
   "last_seen": "2026-10-24T22:00:00Z",
   "source_count": 3,
   "heat": 43.52,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    10.0,
    17.72,
    27.21,
    37.27,
    46.58,
    49.21,
    51.75,
    50.28,
    48.85,
    47.45,
    46.1,
    44.79,
    43.52
   ],
   "sources": [
    {
     "source": "simon",
     "name": "Simon Willison",
     "title": "Notes on Cursor background agents",
     "url": "https://simon.example/2026/Oct/cursor-background",
     "published_at": "2026-10-24T20:00:00Z",
     "lang": "en"
    },
    {
     "source": "hn",
     "name": "Hacker News",
     "title": "Cursor adds background agents that open pull requests",
     "url": "https://hn.example/item/1004",
     "published_at": "2026-10-24T21:00:00Z",
     "lang": "en"
    },
    {
     "source": "qbitai",
     "name": "量子位",
     "title": "Cursor 上线后台智能体，并行改代码、自动提 PR",
     "url": "https://qbitai.example/2026/10/cursor-background",
     "published_at": "2026-10-24T22:00:00Z",
     "lang": "zh"
    }
   ],
   "site": {
    "favorites": 9,
    "comments": 5,
    "rooms": 1
   },
   "related": {
    "knowledge": {
     "title": "让后台智能体提 PR 的评审清单",
     "meta": "方法 · 编程"
    },
    "work": {
     "title": "自动补测试的工作流",
     "meta": "作品 · 复现 4 人"
    },
    "discussion": {
     "title": "后台智能体会不会把仓库改乱",
     "meta": "讨论 · 11 条回复"
    }
   }
  },
  {
   "id": "ev-8be01a4559",
   "title": "LangChain ships durable execution for long-running agents",
   "title_zh": "LangChain 上线长任务持久执行",
   "summary_zh": "新运行时支持长时间智能体任务中断后续跑。",
   "direction": "agent",
   "first_seen": "2026-10-24T22:00:00Z",
   "last_seen": "2026-10-25T00:00:00Z",
   "source_count": 3,
   "heat": 29.73,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    10.0,
    18.72,
    26.18,
    32.35,
    35.35,
    34.35,
    33.37,
    32.42,
    31.5,
    30.6,
    29.73
   ],
   "sources": [
    {
     "source": "langchain",
     "name": "LangChain 博客",
     "title": "LangChain ships durable execution for long-running agents",
     "url": "https://langchain.example/durable-execution",
     "published_at": "2026-10-24T22:00:00Z",
     "lang": "en"
    },
    {
     "source": "latent-space",
     "name": "Latent Space",
     "title": "Durable agents: LangChain's new runtime",
     "url": "https://latent-space.example/p/durable-agents",
     "published_at": "2026-10-24T23:00:00Z",
     "lang": "en"
    },
    {
     "source": "hn",
     "name": "Hacker News",
     "title": "LangChain durable execution for agents",
     "url": "https://hn.example/item/1003",
     "published_at": "2026-10-25T00:00:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 4,
    "comments": 2,
    "rooms": 0
   },
   "related": {
    "knowledge": {
     "title": "智能体掉线后怎么续上",
     "meta": "方法 · 智能体"
    },
    "work": {
     "title": "带断点续跑的采集智能体",
     "meta": "作品 · 复现 2 人"
    }
   }
  },
  {
   "id": "ev-bb0efe79d6",
   "title": "acme-labs/agent-kit",
   "title_zh": "轻量智能体工具包 agent-kit 走红",
   "summary_zh": "这个小型开源工具包进入 GitHub 热门项目。",
   "direction": "opensource",
   "first_seen": "2026-10-25T02:00:00Z",
   "last_seen": "2026-10-25T03:00:00Z",
   "source_count": 2,
   "heat": 24.76,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    9.0,
    16.74,
    21.69,
    27.0,
    26.23,
    25.48,
    24.76
   ],
   "sources": [
    {
     "source": "gh-trending",
     "name": "GitHub Trending",
     "title": "acme-labs/agent-kit",
     "url": "https://gh-trending.example/acme-labs/agent-kit",
     "published_at": "2026-10-25T02:00:00Z",
     "lang": "en"
    },
    {
     "source": "hn",
     "name": "Hacker News",
     "title": "Show HN: acme-labs/agent-kit, a tiny toolkit for tool-using agents",
     "url": "https://hn.example/item/1006",
     "published_at": "2026-10-25T03:00:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 5,
    "comments": 1,
    "rooms": 0
   },
   "related": {
    "work": {
     "title": "拿 agent-kit 搭的日报机器人",
     "meta": "作品 · 复现 1 人"
    },
    "discussion": {
     "title": "小工具包怎么选",
     "meta": "讨论 · 4 条回复"
    }
   }
  },
  {
   "id": "ev-86cbbdb1f3",
   "title": "MCP 规范新增流式授权流程",
   "title_zh": "MCP 规范新增流式授权流程",
   "summary_zh": "MCP 规范新增流式授权流程",
   "direction": "agent",
   "first_seen": "2026-10-24T18:00:00Z",
   "last_seen": "2026-10-24T20:00:00Z",
   "source_count": 3,
   "heat": 23.98,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    9.0,
    16.74,
    26.27,
    30.94,
    32.01,
    31.1,
    30.21,
    29.35,
    28.52,
    27.71,
    26.92,
    26.15,
    25.41,
    24.68,
    23.98
   ],
   "sources": [
    {
     "source": "latent-space",
     "name": "Latent Space",
     "title": "MCP spec adds streamable auth flows",
     "url": "https://latent-space.example/p/mcp-auth",
     "published_at": "2026-10-24T18:00:00Z",
     "lang": "en"
    },
    {
     "source": "hn",
     "name": "Hacker News",
     "title": "MCP spec update: streamable authorization",
     "url": "https://hn.example/item/1005",
     "published_at": "2026-10-24T19:00:00Z",
     "lang": "en"
    },
    {
     "source": "jiqizhixin",
     "name": "机器之心",
     "title": "MCP 规范新增流式授权流程",
     "url": "https://jiqizhixin.example/articles/mcp-auth",
     "published_at": "2026-10-24T20:00:00Z",
     "lang": "zh"
    }
   ],
   "site": {
    "favorites": 3,
    "comments": 1,
    "rooms": 0
   },
   "related": {
    "knowledge": {
     "title": "给 MCP 工具加授权的最小做法",
     "meta": "方法 · 智能体"
    }
   }
  },
  {
   "id": "ev-59b5099fe8",
   "title": "Gemini 3 Flash brings faster responses to the Gemini app",
   "title_zh": "Gemini 3 Flash 提升应用响应速度",
   "summary_zh": "谷歌把更快的 Gemini 3 Flash 推向应用端。",
   "direction": "model",
   "first_seen": "2026-10-24T12:00:00Z",
   "last_seen": "2026-10-24T14:00:00Z",
   "source_count": 3,
   "heat": 18.42,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    14.0,
    21.6,
    30.99,
    30.1,
    29.25,
    28.41,
    27.61,
    26.82,
    26.06,
    25.31,
    24.59,
    23.89,
    23.21,
    22.55,
    21.91,
    21.29,
    20.68,
    20.09,
    19.52,
    18.96,
    18.42
   ],
   "sources": [
    {
     "source": "google-ai",
     "name": "Google AI 博客",
     "title": "Gemini 3 Flash brings faster responses to the Gemini app",
     "url": "https://google-ai.example/gemini-3-flash",
     "published_at": "2026-10-24T12:00:00Z",
     "lang": "en"
    },
    {
     "source": "hn",
     "name": "Hacker News",
     "title": "Gemini 3 Flash is rolling out",
     "url": "https://hn.example/item/1002",
     "published_at": "2026-10-24T13:00:00Z",
     "lang": "en"
    },
    {
     "source": "qbitai",
     "name": "量子位",
     "title": "谷歌 Gemini 3 Flash 上线，响应速度更快",
     "url": "https://qbitai.example/2026/10/gemini-3-flash",
     "published_at": "2026-10-24T14:00:00Z",
     "lang": "zh"
    }
   ],
   "site": {
    "favorites": 0,
    "comments": 0,
    "rooms": 0
   },
   "related": {
    "knowledge": {
     "title": "在低延迟场景选模型的几条经验",
     "meta": "方法 · 模型"
    },
    "discussion": {
     "title": "快模型做路由，慢模型做复核",
     "meta": "讨论 · 5 条回复"
    }
   }
  },
  {
   "id": "ev-14dfeb2150",
   "title": "A study on long-horizon agent reliability",
   "title_zh": "研究关注长程智能体可靠性",
   "summary_zh": "新研究分析智能体执行长任务时的可靠性问题。",
   "direction": "research",
   "first_seen": "2026-10-24T10:00:00Z",
   "last_seen": "2026-10-24T10:00:00Z",
   "source_count": 1,
   "heat": 7.42,
   "series": [
    0.0,
    0.0,
    14.0,
    13.6,
    13.21,
    12.84,
    12.47,
    12.12,
    11.77,
    11.44,
    11.11,
    10.8,
    10.49,
    10.19,
    9.9,
    9.62,
    9.34,
    9.08,
    8.82,
    8.57,
    8.32,
    8.09,
    7.86,
    7.63,
    7.42
   ],
   "sources": [
    {
     "source": "deepmind",
     "name": "DeepMind 博客",
     "title": "A study on long-horizon agent reliability",
     "url": "https://deepmind.example/blog/agent-reliability",
     "published_at": "2026-10-24T10:00:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 0,
    "comments": 0,
    "rooms": 0
   },
   "related": {}
  },
  {
   "id": "ev-6bb8a8ad5a",
   "title": "Show HN: A small CLI that turns meeting audio into notes",
   "title_zh": "小型命令行工具把会议音频转成笔记",
   "summary_zh": "这个命令行项目尝试自动整理会议录音。",
   "direction": "product",
   "first_seen": "2026-10-25T04:30:00Z",
   "last_seen": "2026-10-25T04:30:00Z",
   "source_count": 1,
   "heat": 7.23,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    7.89,
    7.66,
    7.44,
    7.23
   ],
   "sources": [
    {
     "source": "hn",
     "name": "Hacker News",
     "title": "Show HN: A small CLI that turns meeting audio into notes",
     "url": "https://hn.example/item/1007",
     "published_at": "2026-10-25T04:30:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 0,
    "comments": 0,
    "rooms": 0
   },
   "related": {}
  },
  {
   "id": "ev-e503aa4cac",
   "title": "Open small models for on-device agents: a practical guide",
   "title_zh": "端侧智能体小模型实践指南发布",
   "summary_zh": "指南讨论如何为端侧智能体选择开放小模型。",
   "direction": "opensource",
   "first_seen": "2026-10-24T17:00:00Z",
   "last_seen": "2026-10-24T17:00:00Z",
   "source_count": 1,
   "heat": 7.13,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    11.0,
    10.69,
    10.38,
    10.09,
    9.8,
    9.52,
    9.25,
    8.99,
    8.73,
    8.48,
    8.24,
    8.01,
    7.78,
    7.56,
    7.34,
    7.13
   ],
   "sources": [
    {
     "source": "hf-blog",
     "name": "Hugging Face 博客",
     "title": "Open small models for on-device agents: a practical guide",
     "url": "https://hf-blog.example/blog/on-device-agents",
     "published_at": "2026-10-24T17:00:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 0,
    "comments": 0,
    "rooms": 0
   },
   "related": {}
  },
  {
   "id": "ev-f7b5efcec1",
   "title": "demo-org/voice-notes",
   "title_zh": "开源语音笔记项目进入热门榜",
   "summary_zh": "voice-notes 项目登上 GitHub 热门列表。",
   "direction": "opensource",
   "first_seen": "2026-10-24T23:00:00Z",
   "last_seen": "2026-10-24T23:00:00Z",
   "source_count": 1,
   "heat": 6.94,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    9.0,
    8.74,
    8.49,
    8.25,
    8.02,
    7.79,
    7.57,
    7.35,
    7.14,
    6.94
   ],
   "sources": [
    {
     "source": "gh-trending",
     "name": "GitHub Trending",
     "title": "demo-org/voice-notes",
     "url": "https://gh-trending.example/demo-org/voice-notes",
     "published_at": "2026-10-24T23:00:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 0,
    "comments": 0,
    "rooms": 0
   },
   "related": {}
  },
  {
   "id": "ev-89fe82d857",
   "title": "Lumen: a voice-first notes app with agent summaries",
   "title_zh": "Lumen 用智能体整理语音笔记",
   "summary_zh": "这款语音优先的笔记应用加入智能体摘要。",
   "direction": "product",
   "first_seen": "2026-10-25T01:00:00Z",
   "last_seen": "2026-10-25T01:00:00Z",
   "source_count": 1,
   "heat": 5.72,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    7.0,
    6.8,
    6.61,
    6.42,
    6.24,
    6.06,
    5.89,
    5.72
   ],
   "sources": [
    {
     "source": "producthunt",
     "name": "Product Hunt",
     "title": "Lumen: a voice-first notes app with agent summaries",
     "url": "https://producthunt.example/posts/lumen",
     "published_at": "2026-10-25T01:00:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 0,
    "comments": 0,
    "rooms": 0
   },
   "related": {}
  },
  {
   "id": "ev-a9c3640b5b",
   "title": "Scaling test-time compute for code agents",
   "title_zh": "研究探索代码智能体的测试时计算扩展",
   "summary_zh": "论文研究增加测试时计算对代码智能体的影响。",
   "direction": "research",
   "first_seen": "2026-10-24T22:30:00Z",
   "last_seen": "2026-10-24T22:30:00Z",
   "source_count": 1,
   "heat": 5.32,
   "series": [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    6.9,
    6.7,
    6.51,
    6.33,
    6.15,
    5.97,
    5.8,
    5.64,
    5.48,
    5.32
   ],
   "sources": [
    {
     "source": "arxiv-ai",
     "name": "arXiv cs.AI",
     "title": "Scaling test-time compute for code agents",
     "url": "https://arxiv-ai.example/abs/2610.00001",
     "published_at": "2026-10-24T22:30:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 0,
    "comments": 0,
    "rooms": 0
   },
   "related": {}
  },
  {
   "id": "ev-3ea607288d",
   "title": "OpenAI updates its model spec",
   "title_zh": "OpenAI 更新模型规范",
   "summary_zh": "OpenAI 发布了模型行为规范的新版本。",
   "direction": "model",
   "first_seen": "2026-10-23T16:00:00Z",
   "last_seen": "2026-10-23T16:00:00Z",
   "source_count": 1,
   "heat": 4.72,
   "series": [
    9.45,
    9.18,
    8.92,
    8.67,
    8.42,
    8.18,
    7.95,
    7.72,
    7.5,
    7.29,
    7.08,
    6.88,
    6.68,
    6.49,
    6.31,
    6.13,
    5.95,
    5.78,
    5.62,
    5.46,
    5.3,
    5.15,
    5.01,
    4.86,
    4.72
   ],
   "sources": [
    {
     "source": "openai",
     "name": "OpenAI 新闻",
     "title": "OpenAI updates its model spec",
     "url": "https://openai.example/news/model-spec",
     "published_at": "2026-10-23T16:00:00Z",
     "lang": "en"
    }
   ],
   "site": {
    "favorites": 0,
    "comments": 0,
    "rooms": 0
   },
   "related": {}
  }
 ],
 "digest": {
  "date": "2026-10-25",
  "intro": "今天聚合了 13 个事件，来自 14 个来源。",
  "sections": [
   {
    "direction": "model",
    "label": "模型",
    "items": [
     {
      "event_id": "ev-3fad402197",
      "title": "OpenAI releases GPT-5.5 with steadier long-running agent skills",
      "title_zh": "OpenAI 发布 GPT-5.5，长任务智能体更稳",
      "summary_zh": "新模型重点提升长时间运行的智能体稳定性。",
      "text": "OpenAI 发布 GPT-5.5，长任务智能体更稳。5 个来源报道（Hacker News、机器之心、Latent Space 等），5 小时前首次出现。",
      "heat": 95.42
     },
     {
      "event_id": "ev-bd451429fa",
      "title": "Qwen3.5 open-weights family adds long-context variants",
      "title_zh": "Qwen3.5 开源系列新增长上下文版本",
      "summary_zh": "通义千问扩充了面向长上下文的开源模型系列。",
      "text": "Qwen3.5 开源系列新增长上下文版本。3 个来源报道（Hugging Face 博客、机器之心、通义千问博客），8 小时前首次出现。",
      "heat": 45.15
     }
    ]
   },
   {
    "direction": "agent",
    "label": "智能体",
    "items": [
     {
      "event_id": "ev-8be01a4559",
      "title": "LangChain ships durable execution for long-running agents",
      "title_zh": "LangChain 上线长任务持久执行",
      "summary_zh": "新运行时支持长时间智能体任务中断后续跑。",
      "text": "LangChain 上线长任务持久执行。3 个来源报道（Hacker News、LangChain 博客、Latent Space），10 小时前首次出现。",
      "heat": 29.73
     },
     {
      "event_id": "ev-86cbbdb1f3",
      "title": "MCP 规范新增流式授权流程",
      "title_zh": "MCP 规范新增流式授权流程",
      "summary_zh": "MCP 规范新增流式授权流程",
      "text": "MCP 规范新增流式授权流程。3 个来源报道（Hacker News、机器之心、Latent Space），14 小时前首次出现。",
      "heat": 23.98
     }
    ]
   },
   {
    "direction": "coding",
    "label": "编程",
    "items": [
     {
      "event_id": "ev-1707e585b2",
      "title": "Notes on Cursor background agents",
      "title_zh": "Cursor 推出后台智能体",
      "summary_zh": "后台智能体可并行处理代码任务并提交修改。",
      "text": "Cursor 推出后台智能体。3 个来源报道（Hacker News、量子位、Simon Willison），12 小时前首次出现。",
      "heat": 43.52
     }
    ]
   },
   {
    "direction": "opensource",
    "label": "开源",
    "items": [
     {
      "event_id": "ev-bb0efe79d6",
      "title": "acme-labs/agent-kit",
      "title_zh": "轻量智能体工具包 agent-kit 走红",
      "summary_zh": "这个小型开源工具包进入 GitHub 热门项目。",
      "text": "轻量智能体工具包 agent-kit 走红。2 个来源报道（GitHub Trending、Hacker News），6 小时前首次出现。",
      "heat": 24.76
     },
     {
      "event_id": "ev-e503aa4cac",
      "title": "Open small models for on-device agents: a practical guide",
      "title_zh": "端侧智能体小模型实践指南发布",
      "summary_zh": "指南讨论如何为端侧智能体选择开放小模型。",
      "text": "端侧智能体小模型实践指南发布。来自 Hugging Face 博客，15 小时前发布。",
      "heat": 7.13
     }
    ]
   },
   {
    "direction": "product",
    "label": "产品",
    "items": [
     {
      "event_id": "ev-6bb8a8ad5a",
      "title": "Show HN: A small CLI that turns meeting audio into notes",
      "title_zh": "小型命令行工具把会议音频转成笔记",
      "summary_zh": "这个命令行项目尝试自动整理会议录音。",
      "text": "小型命令行工具把会议音频转成笔记。来自 Hacker News，3 小时前发布。",
      "heat": 7.23
     },
     {
      "event_id": "ev-89fe82d857",
      "title": "Lumen: a voice-first notes app with agent summaries",
      "title_zh": "Lumen 用智能体整理语音笔记",
      "summary_zh": "这款语音优先的笔记应用加入智能体摘要。",
      "text": "Lumen 用智能体整理语音笔记。来自 Product Hunt，7 小时前发布。",
      "heat": 5.72
     }
    ]
   },
   {
    "direction": "research",
    "label": "研究",
    "items": [
     {
      "event_id": "ev-14dfeb2150",
      "title": "A study on long-horizon agent reliability",
      "title_zh": "研究关注长程智能体可靠性",
      "summary_zh": "新研究分析智能体执行长任务时的可靠性问题。",
      "text": "研究关注长程智能体可靠性。来自 DeepMind 博客，22 小时前发布。",
      "heat": 7.42
     },
     {
      "event_id": "ev-a9c3640b5b",
      "title": "Scaling test-time compute for code agents",
      "title_zh": "研究探索代码智能体的测试时计算扩展",
      "summary_zh": "论文研究增加测试时计算对代码智能体的影响。",
      "text": "研究探索代码智能体的测试时计算扩展。来自 arXiv cs.AI，9 小时前发布。",
      "heat": 5.32
     }
    ]
   }
  ],
  "text": "# AI 热点日报 · 2026-10-25\n\n今天聚合了 13 个事件，来自 14 个来源。\n\n## 模型\n1. OpenAI 发布 GPT-5.5，长任务智能体更稳。5 个来源报道（Hacker News、机器之心、Latent Space 等），5 小时前首次出现。\n2. Qwen3.5 开源系列新增长上下文版本。3 个来源报道（Hugging Face 博客、机器之心、通义千问博客），8 小时前首次出现。\n\n## 智能体\n1. LangChain 上线长任务持久执行。3 个来源报道（Hacker News、LangChain 博客、Latent Space），10 小时前首次出现。\n2. MCP 规范新增流式授权流程。3 个来源报道（Hacker News、机器之心、Latent Space），14 小时前首次出现。\n\n## 编程\n1. Cursor 推出后台智能体。3 个来源报道（Hacker News、量子位、Simon Willison），12 小时前首次出现。\n\n## 开源\n1. 轻量智能体工具包 agent-kit 走红。2 个来源报道（GitHub Trending、Hacker News），6 小时前首次出现。\n2. 端侧智能体小模型实践指南发布。来自 Hugging Face 博客，15 小时前发布。\n\n## 产品\n1. 小型命令行工具把会议音频转成笔记。来自 Hacker News，3 小时前发布。\n2. Lumen 用智能体整理语音笔记。来自 Product Hunt，7 小时前发布。\n\n## 研究\n1. 研究关注长程智能体可靠性。来自 DeepMind 博客，22 小时前发布。\n2. 研究探索代码智能体的测试时计算扩展。来自 arXiv cs.AI，9 小时前发布。"
 }
};
