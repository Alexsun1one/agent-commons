#!/usr/bin/env python3
"""Fixed, hand-written lexicon for fine-grained topic drift: public industry names and public app/tool/model names.

No term is ever discovered from data. Every entry has aliases, an optional mask list (phrases removed from the text
before this entry is matched, so a known false positive cannot fire), a group, and a parent (a DATA-1 topic key).

Alias syntax:
  plain text   literal, case-insensitive; a space matches an optional space, hyphen or underscore. An alias that
               starts or ends with an ASCII letter or digit gets a word boundary on that side.
  "re:<body>"  a regular expression body; word boundaries are always added on both sides.
"""

from __future__ import annotations

import re

PARENT_TOPICS = ("agents", "coding", "models", "knowledge", "design", "creation",
                 "office", "product", "learning", "prompting", "opensource", "practice")

GROUPS = (
    ("industry", "行业", "industry"),
    ("models", "模型", "app"),
    ("coding", "编程助手", "app"),
    ("agents", "智能体平台", "app"),
    ("workflow", "工作流和自动化", "app"),
    ("knowledge", "知识库和检索", "app"),
    ("design", "设计和多模态生成", "app"),
    ("opensource", "开源框架和本地运行", "app"),
)


def _e(group, key, label, parent, aliases, mask=()):
    return {"key": key, "label": label, "group": group, "parent": parent,
            "aliases": tuple(aliases), "mask": tuple(mask)}


def _industry(key, label, parent, aliases, mask=()):
    return _e("industry", key, label, parent, aliases, mask)


INDUSTRIES = [
    _industry("education", "教育", "learning",
              ["教育", "课堂", "教培", "k12", "高校", "留学", "教师", "网课", "学校", "学生"],
              ["教育经历", "教育背景", "教育程度"]),
    _industry("healthcare", "医疗健康", "product",
              ["医疗", "医院", "医生", "医药", "问诊", "病历", "临床", "看病"],
              ["医疗保险", "医疗险"]),
    _industry("ecommerce", "电商零售", "product",
              ["电商", "淘宝", "天猫", "京东", "拼多多", "亚马逊", "shopify", "temu", "shopee", "独立站", "带货", "网店"],
              ["亚马逊雨林", "亚马逊河", "亚马逊云"]),
    _industry("finance", "金融", "product",
              ["金融", "银行", "证券", "股票", "基金", "保险", "理财", "量化交易", "量化投资", "炒股", "fintech", "财报"],
              ["基金项目", "基金申请", "国家自然科学基金"]),
    _industry("manufacturing", "制造业", "product",
              ["制造业", "智能制造", "工厂", "生产线", "工业互联网", "工业软件", "数控"],
              ["工厂模式", "抽象工厂", "工厂函数", "工厂方法", "简单工厂"]),
    _industry("legal", "法律", "product",
              ["法律", "律师", "法务", "合同", "合规", "诉讼", "法院", "知识产权", "法规", "起诉"]),
    _industry("content", "内容创作", "creation",
              ["自媒体", "短视频", "公众号", "小红书", "抖音", "博主", "直播", "播客", "涨粉", "爆款",
               "youtube", "tiktok", "b站", "视频号", "up主"]),
    _industry("gaming", "游戏", "creation",
              ["游戏", "手游", "端游", "steam", "unity3d", "unity引擎", "unity 引擎", "re:unreal[\\s\\-_]?engine",
               "虚幻引擎", "godot", "原神", "王者荣耀", "玩家", "电竞", "我的世界", "minecraft"],
              ["游戏规则"]),
    _industry("realestate", "房地产", "product",
              ["房地产", "房产", "楼盘", "房价", "买房", "租房", "物业", "地产"]),
    _industry("travel", "旅游出行", "product",
              ["旅游", "旅行", "酒店", "机票", "民宿", "景区", "携程", "文旅", "出行"],
              ["时间旅行"]),
    _industry("agriculture", "农业", "product",
              ["农业", "农民", "种植", "养殖", "农村", "农产品", "果园", "大棚"]),
    _industry("energy", "能源", "product",
              ["能源", "电力", "光伏", "新能源", "储能", "风电", "石油", "电网", "充电桩", "碳中和", "碳排放"],
              ["新能源车", "新能源汽车"]),
    _industry("automotive", "汽车", "product",
              ["汽车", "新能源车", "特斯拉", "车企", "自动驾驶", "智能驾驶", "车载", "比亚迪", "蔚来", "小鹏", "理想汽车"]),
    _industry("logistics", "物流供应链", "product",
              ["物流", "供应链", "快递", "仓储", "货运", "配送", "顺丰", "海运", "运输"],
              ["软件供应链", "供应链攻击", "供应链安全"]),
    _industry("hr", "招聘人力", "office",
              ["招聘", "简历", "面试", "求职", "猎头", "人力资源", "人事", "入职", "跳槽", "裁员", "校招", "社招", "offer"]),
    _industry("media", "媒体出版", "creation",
              ["媒体", "新闻", "出版", "记者", "杂志", "报纸", "编辑部", "电子书", "小说", "网文", "剧本", "影视", "电影", "电视剧", "编剧"],
              ["自媒体", "多媒体", "流媒体", "富媒体", "社交媒体"]),
    _industry("customer-service", "客服", "office",
              ["客服", "售后", "呼叫中心", "工单", "客户服务"]),
    _industry("research", "科研学术", "learning",
              ["科研", "论文", "学术", "期刊", "实验室", "文献", "研究生", "博士", "导师", "课题", "arxiv", "综述"],
              ["创业导师", "人生导师"]),
    _industry("government", "政务公共", "office",
              ["政务", "政府", "公务员", "事业单位", "智慧城市", "招投标", "公共服务", "税务", "社保", "公安", "国企"]),
]


def _m(key, label, aliases, mask=(), parent="models"):
    return _e("models", key, label, parent, aliases, mask)


def _c(key, label, aliases, mask=(), parent="coding"):
    return _e("coding", key, label, parent, aliases, mask)


def _a(key, label, aliases, mask=(), parent="agents"):
    return _e("agents", key, label, parent, aliases, mask)


def _w(key, label, aliases, mask=(), parent="office"):
    return _e("workflow", key, label, parent, aliases, mask)


def _k(key, label, aliases, mask=(), parent="knowledge"):
    return _e("knowledge", key, label, parent, aliases, mask)


def _d(key, label, aliases, mask=(), parent="design"):
    return _e("design", key, label, parent, aliases, mask)


def _o(key, label, aliases, mask=(), parent="opensource"):
    return _e("opensource", key, label, parent, aliases, mask)


APPS = [
    # models
    _m("openai-gpt", "ChatGPT / GPT", ["chatgpt", "openai", "gpt", "re:gpt[- ]?[345](?:\\.\\d)?[a-z]?"],
       ["openai codex", "openai agents", "re:gpt[- ]?[0-9.]*-codex", "re:gpt[- ]?image"]),
    _m("claude", "Claude", ["claude", "anthropic"],
       ["claude code", "claude agent sdk"]),
    _m("gemini", "Gemini", ["gemini"], ["gemini cli"]),
    _m("deepseek", "DeepSeek", ["deepseek", "深度求索"]),
    _m("qwen", "通义千问 / Qwen", ["qwen", "通义千问", "通义", "千问"],
       ["通义万相", "通义灵码", "qwen code"]),
    _m("kimi", "Kimi", ["kimi", "月之暗面", "moonshot ai", "moonshotai"]),
    _m("doubao", "豆包", ["豆包", "doubao"], ["豆包marscode"]),
    _m("glm", "智谱 GLM", ["glm", "智谱", "chatglm", "清言", "z.ai"]),
    _m("grok", "Grok", ["grok"]),
    _m("llama", "Llama", ["llama"],
       ["llama.cpp", "llama cpp", "llama factory", "llama index"]),
    _m("ernie", "文心 / ERNIE", ["文心一言", "文心大模型", "ernie"]),
    _m("hunyuan", "腾讯混元", ["腾讯混元", "hunyuan", "混元大模型", "混元图", "混元3d", "腾讯元宝"]),
    _m("minimax", "MiniMax", ["minimax", "稀宇科技"]),
    _m("spark", "讯飞星火", ["讯飞星火", "星火大模型", "星火认知"]),
    # coding assistants
    _c("cursor", "Cursor", ["cursor"],
       ["cursor:", "cursor.execute", "cursor.fetch", "cursor.commit", "cursor.close", "cursor()",
        "mouse cursor", "text cursor", "cursor pointer", "光标"]),
    _c("claude-code", "Claude Code", ["claude code"]),
    _c("codex", "Codex", ["codex"]),
    _c("copilot", "GitHub Copilot", ["copilot"]),
    _c("windsurf", "Windsurf", ["windsurf", "codeium"]),
    _c("trae", "Trae", ["trae"]),
    _c("cline-roo", "Cline / Roo Code", ["cline", "roo code", "kilo code"]),
    _c("aider", "Aider", ["aider"]),
    _c("gemini-cli", "Gemini CLI", ["gemini cli"]),
    _c("antigravity", "Antigravity", ["antigravity"], ["import antigravity"]),
    _c("kiro", "Kiro", ["kiro"]),
    _c("qwen-code", "通义灵码 / Qwen Code", ["通义灵码", "lingma", "qwen code"]),
    _c("codebuddy", "CodeBuddy", ["codebuddy", "腾讯云代码助手"]),
    _c("marscode", "MarsCode", ["marscode"]),
    _c("replit", "Replit", ["replit"]),
    _c("app-builders", "Lovable / Bolt / v0",
       ["lovable.dev", "lovable ai", "bolt.new", "bolt.diy", "v0.dev", "v0.app", "vercel v0"]),
    _c("devin", "Devin", ["devin ai", "devin.ai", "cognition labs"]),
    _c("qoder", "Qoder", ["qoder"]),
    # agent platforms
    _a("dify", "Dify", ["dify"]),
    _a("coze", "Coze / 扣子", ["coze", "扣子"], ["衣服扣子", "纽扣", "扣子掉"]),
    _a("fastgpt", "FastGPT", ["fastgpt"]),
    _a("mcp", "MCP", ["mcp", "model context protocol"]),
    _a("langchain", "LangChain / LangGraph", ["langchain", "langgraph", "langsmith"]),
    _a("autogen", "AutoGen", ["autogen"]),
    _a("crewai", "CrewAI", ["crewai"]),
    _a("manus", "Manus", ["manus"]),
    _a("openclaw", "OpenClaw", ["openclaw", "clawdbot", "moltbot"]),
    _a("flowise", "Flowise", ["flowise"]),
    _a("agents-sdk", "Agents SDK / ADK", ["agents sdk", "agent sdk", "google adk"]),
    _a("cloud-agent-platforms", "云厂商智能体平台", ["阿里云百炼", "百炼", "百度千帆", "千帆", "腾讯元器"],
       ["百炼成钢", "千帆竞发"]),
    _a("genspark", "Genspark", ["genspark"]),
    # workflow and automation
    _w("n8n", "n8n", ["n8n"]),
    _w("zapier", "Zapier", ["zapier"]),
    _w("make", "Make", ["make.com", "integromat"]),
    _w("power-automate", "Power Automate", ["power automate"]),
    _w("feishu", "飞书 / 多维表格", ["飞书", "多维表格", "larksuite"]),
    _w("airtable", "Airtable", ["airtable"]),
    _w("rpa", "RPA 工具", ["影刀", "uipath", "按键精灵", "rpa"]),
    _w("dingtalk-wecom", "钉钉 / 企业微信", ["钉钉", "dingtalk", "企业微信", "wecom"]),
    _w("shortcuts", "快捷指令", ["快捷指令", "ios shortcuts", "apple shortcuts"]),
    _w("ifttt", "IFTTT / Pipedream", ["ifttt", "pipedream"]),
    # knowledge and retrieval
    _k("obsidian", "Obsidian", ["obsidian"]),
    _k("notion", "Notion", ["notion"], ["notion of", "the notion", "a notion", "no notion"]),
    _k("notebooklm", "NotebookLM", ["notebooklm"]),
    _k("ragflow", "RAGFlow", ["ragflow"]),
    _k("ima", "腾讯 ima", ["腾讯ima", "ima知识库"]),
    _k("perplexity", "Perplexity", ["perplexity", "pplx"]),
    _k("metaso", "秘塔", ["秘塔", "metaso"]),
    _k("logseq-family", "Logseq / 思源笔记 / Flowus", ["logseq", "思源笔记", "flowus"]),
    _k("yuque", "语雀", ["语雀", "yuque"]),
    _k("llamaindex", "LlamaIndex", ["llamaindex", "llama index"]),
    _k("vector-db", "向量数据库", ["milvus", "pinecone", "weaviate", "qdrant", "chromadb", "pgvector", "faiss"]),
    _k("zotero", "Zotero", ["zotero"]),
    _k("anythingllm-maxkb", "AnythingLLM / MaxKB", ["anythingllm", "maxkb"]),
    # design and multimodal generation
    _d("midjourney", "Midjourney", ["midjourney", "mid journey"], parent="creation"),
    _d("stable-diffusion", "Stable Diffusion", ["stable diffusion", "sdxl", "sd webui", "stable-diffusion-webui"],
       parent="creation"),
    _d("comfyui", "ComfyUI", ["comfyui", "comfy ui"], parent="creation"),
    _d("flux", "Flux", ["flux.1", "flux.2", "flux kontext", "flux dev", "flux schnell", "black forest labs"],
       parent="creation"),
    _d("dalle", "DALL-E / GPT Image", ["dall-e", "dalle", "gpt-image"], parent="creation"),
    _d("jimeng", "即梦 / Seedream", ["即梦", "jimeng", "dreamina", "seedream", "seedance"], parent="creation"),
    _d("kling", "可灵 Kling", ["可灵", "kling"], parent="creation"),
    _d("sora", "Sora", ["sora"], parent="creation"),
    _d("veo", "Veo", ["re:veo ?[23]?"], parent="creation"),
    _d("runway", "Runway", ["runwayml", "runway ml", "runway gen", "runway 视频"], parent="creation"),
    _d("wan", "通义万相 / Wan", ["通义万相", "万相", "re:wan ?2(?:\\.\\d)?"], parent="creation"),
    _d("pika-vidu", "Pika / Vidu / 海螺视频", ["pika", "vidu", "hailuo", "海螺ai", "海螺视频", "pixverse"],
       parent="creation"),
    _d("audio-gen", "Suno / Udio / ElevenLabs", ["suno", "udio", "elevenlabs"], parent="creation"),
    _d("figma", "Figma", ["figma"]),
    _d("canva", "Canva", ["canva"]),
    _d("framer", "Framer", ["framer"], ["framer motion"]),
    _d("jianying", "剪映 / CapCut", ["剪映", "capcut"], parent="creation"),
    _d("nano-banana", "Nano Banana", ["nano banana"], parent="creation"),
    # open source and local running
    _o("ollama", "Ollama", ["ollama"]),
    _o("lm-studio", "LM Studio", ["lm studio"]),
    _o("vllm", "vLLM", ["vllm"]),
    _o("llama-cpp", "llama.cpp", ["llama.cpp", "llamacpp", "llama-cpp"]),
    _o("huggingface", "Hugging Face", ["hugging face", "抱抱脸"]),
    _o("modelscope", "魔搭 ModelScope", ["魔搭", "modelscope"]),
    _o("open-webui", "Open WebUI", ["open webui"]),
    _o("cherry-studio", "Cherry Studio", ["cherry studio"]),
    _o("llama-factory", "LLaMA-Factory", ["llama factory"]),
    _o("openrouter", "OpenRouter", ["openrouter"]),
    _o("siliconflow", "硅基流动", ["siliconflow", "硅基流动"]),
    _o("pytorch", "PyTorch", ["pytorch"]),
]

ENTRIES = INDUSTRIES + APPS
FORBIDDEN_IN_LEXICON = ("wxid_", "@", "http", "www.", "sender")
DOMAIN_LIKE = re.compile(r"\b[a-z0-9-]+\.(?:com|cn|net|org|io|dev|app)\b", re.I)


def _is_alnum(char: str) -> bool:
    return char.isascii() and char.isalnum()


def _piece(term: str) -> str:
    if term.startswith("re:"):
        return r"(?<![a-z0-9])(?:" + term[3:] + r")(?![a-z0-9])"
    body = r"[\s\-_]?".join(re.escape(part) for part in term.split(" "))
    before = r"(?<![a-z0-9])" if _is_alnum(term[0]) else ""
    after = r"(?![a-z0-9])" if _is_alnum(term[-1]) else ""
    return before + body + after


def _anchor(term: str) -> str:
    """Lowercase literal fragment that must occur in the text for the alias to match (cheap pre-filter)."""
    if term.startswith("re:"):
        found = re.match(r"[a-z0-9一-鿿]+", term[3:], re.I)
        return found.group(0).lower() if found else ""
    return term.split(" ")[0].lower()


def validate(entries=ENTRIES) -> None:
    seen = set()
    groups = {key for key, _, _ in GROUPS}
    for entry in entries:
        assert entry["key"] not in seen, f"duplicate key {entry['key']}"
        seen.add(entry["key"])
        assert entry["group"] in groups, entry["key"]
        assert entry["parent"] in PARENT_TOPICS, entry["key"]
        assert entry["aliases"], entry["key"]
        for text in (entry["label"], entry["key"], *entry["aliases"], *entry["mask"]):
            assert text and not any(token in text.lower() for token in FORBIDDEN_IN_LEXICON), (entry["key"], text)
        assert not DOMAIN_LIKE.search(entry["label"]), entry["key"]
        for alias in entry["aliases"]:
            if not alias.startswith("re:") and alias.isascii():
                assert len(alias) >= 3, f"ASCII alias too short: {alias}"
            assert _anchor(alias), alias


class Lexicon:
    def __init__(self, entries=ENTRIES) -> None:
        self.entries = list(entries)
        validate(self.entries)
        self._alias = [re.compile("|".join(_piece(a) for a in e["aliases"]), re.I) for e in self.entries]
        self._mask = [re.compile("|".join(_piece(m) for m in e["mask"]), re.I) if e["mask"] else None
                      for e in self.entries]
        self._anchors = [tuple({_anchor(a) for a in e["aliases"]}) for e in self.entries]
        self.index = {e["key"]: i for i, e in enumerate(self.entries)}

    def match(self, text: str) -> list[int]:
        """Indexes of every entry the text hits (each entry at most once)."""
        low = text.lower()
        hits = []
        for index, anchors in enumerate(self._anchors):
            if not any(anchor in low for anchor in anchors):
                continue
            mask = self._mask[index]
            subject = mask.sub(" ", text) if mask else text
            if self._alias[index].search(subject):
                hits.append(index)
        return hits

    def keys(self, text: str) -> set[str]:
        return {self.entries[i]["key"] for i in self.match(text)}


def counts_by_group() -> dict[str, int]:
    result = {key: 0 for key, _, _ in GROUPS}
    for entry in ENTRIES:
        result[entry["group"]] += 1
    return result
