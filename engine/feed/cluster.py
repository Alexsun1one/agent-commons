"""把同一件事的多条报道聚成一个事件。

三个信号：
  1. 标题 SimHash（64 位；中文按相邻两字，英文按词），算相似度 = 1 - 汉明距离/64
  2. 实体重合：产品名、模型名、公司名，来自可扩充的词表（强实体 = 产品/模型，弱实体 = 公司）
  3. 时间窗：默认 72 小时；跨语言只靠实体时收紧到 24 小时
版本号冲突（GPT-5 对 GPT-5.5）直接判不同事件。事件标题取权威度最高的来源的标题。
"""
import hashlib
import re
from datetime import datetime, timezone

from . import sources as _sources

WINDOW_H = 72
CROSS_LANG_H = 24
SIM_STRONG = 0.60   # 共享强实体时，标题相似度的下限
SIM_WEAK = 0.75     # 只共享公司名时
SIM_NONE = 0.90     # 没有共享实体时（近乎重复的标题）

STOPWORDS = frozenset(
    "a an the of for to in on at by with and or is are was be as from its it this that new "
    "how why what who says say will can into over about after before more vs via".split()
)


class Lexicon:
    """实体词表。add() 可扩充；强实体 = 产品/模型，弱实体 = 公司/机构。"""

    def __init__(self):
        self._rules = []  # (key, strong, compiled regex)
        self.strength = {}
        self.direction = {}  # 实体 -> 方向提示（可选）

    def add(self, key, aliases, strong=True, direction=None):
        parts = []
        for a in aliases:
            a = a.lower()
            if re.search(r"[㐀-鿿]", a):
                parts.append(re.escape(a))
            else:
                parts.append(r"(?<![a-z0-9])" + re.escape(a) + r"(?![a-z])")
        self._rules.append((key, strong, re.compile("|".join(parts))))
        self.strength[key] = strong
        if direction:
            self.direction[key] = direction
        return self

    def find(self, text):
        low = (text or "").lower()
        return {key: strong for key, strong, rx in self._rules if rx.search(low)}


def default_lexicon():
    lx = Lexicon()
    for direction, rows in [
        ("model", [("gpt", ["gpt"]), ("chatgpt", ["chatgpt"]), ("sora", ["sora"]),
                   ("claude", ["claude", "克劳德"]), ("gemini", ["gemini"]), ("gemma", ["gemma"]),
                   ("deepseek", ["deepseek", "深度求索"]), ("qwen", ["qwen", "通义千问", "千问"]),
                   ("kimi", ["kimi"]), ("glm", ["glm"]), ("doubao", ["doubao", "豆包"]),
                   ("llama", ["llama"]), ("mistral", ["mistral"]), ("grok", ["grok"]),
                   ("midjourney", ["midjourney"])]),
        ("coding", [("codex", ["codex"]), ("claude-code", ["claude code"]), ("cursor", ["cursor"]),
                    ("copilot", ["copilot"])]),
        ("agent", [("mcp", ["mcp"]), ("langchain", ["langchain"])]),
    ]:
        for key, aliases in rows:
            lx.add(key, aliases, strong=True, direction=direction)
    for key, aliases in [
        ("openai", ["openai"]), ("anthropic", ["anthropic"]), ("google", ["google", "谷歌"]),
        ("meta", ["meta"]), ("microsoft", ["microsoft", "微软"]), ("nvidia", ["nvidia", "英伟达"]),
        ("apple", ["apple", "苹果"]), ("xai", ["xai"]), ("alibaba", ["alibaba", "阿里巴巴", "阿里"]),
        ("bytedance", ["bytedance", "字节跳动", "字节"]), ("moonshot", ["moonshot", "月之暗面"]),
        ("zhipu", ["zhipu", "智谱"]), ("huggingface", ["hugging face", "huggingface"]),
        ("github", ["github"]),
    ]:
        lx.add(key, aliases, strong=False)
    return lx


DEFAULT_LEXICON = default_lexicon()

_ASCII_WORD = re.compile(r"[a-z0-9][a-z0-9.+#_-]*[a-z0-9+#]|[a-z0-9]")
_CJK_RUN = re.compile(r"[㐀-鿿]+")
_VERSION = re.compile(r"(?<![0-9.])(?:[a-z]+[\s\-]?v?|v)(\d{1,2}(?:\.\d+)*)(?![0-9%])")
_DOTTED = re.compile(r"(?<![0-9.])(\d{1,2}\.\d+(?:\.\d+)*)(?![0-9])")


def tokens(title):
    """中文相邻两字、英文按词（去停用词）。"""
    low = (title or "").lower()
    out = []
    for run in _CJK_RUN.findall(low):
        if len(run) == 1:
            out.append(run)
        else:
            out.extend(run[i:i + 2] for i in range(len(run) - 1))
    for w in _ASCII_WORD.findall(_CJK_RUN.sub(" ", low)):
        if w not in STOPWORDS:
            out.append(w)
    return out


def simhash(toks):
    """64 位 SimHash。只吃标题记号，实体不进哈希（否则实体权重会盖过标题本身）。"""
    acc = [0] * 64
    if not toks:
        return 0
    for tok in toks:
        h = int.from_bytes(hashlib.blake2b(tok.encode("utf-8"), digest_size=8).digest(), "big")
        for i in range(64):
            acc[i] += 1 if (h >> i) & 1 else -1
    out = 0
    for i in range(64):
        if acc[i] > 0:
            out |= 1 << i
    return out


def hamming(a, b):
    return bin(a ^ b).count("1")


def similarity(a, b):
    return 1 - hamming(a, b) / 64


def versions(title):
    low = (title or "").lower()
    found = set(_VERSION.findall(low)) | set(_DOTTED.findall(low))
    out = set()
    for v in found:
        while v.endswith(".0"):
            v = v[:-2]
        out.add(v)
    return out


def parse_time(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def features(item, lexicon=None):
    lx = lexicon or DEFAULT_LEXICON
    ents = lx.find(item["title"])
    toks = tokens(item["title"])
    return {
        "ents": ents,
        "vers": versions(item["title"]),
        "hash": simhash(toks),
        "t": parse_time(item.get("published_at")),
        "lang": item.get("lang", "en"),
    }


def _hours(a, b):
    if a is None or b is None:
        return 0.0
    return abs((a - b).total_seconds()) / 3600.0


def same_event(fa, fb, window_h=WINDOW_H):
    dt = _hours(fa["t"], fb["t"])
    if dt > window_h:
        return False
    va, vb = fa["vers"], fb["vers"]
    shared_ver = bool(va & vb)
    if va and vb and not shared_ver:
        return False
    shared = set(fa["ents"]) & set(fb["ents"])
    strong = [k for k in shared if fa["ents"][k]]
    sim = similarity(fa["hash"], fb["hash"])
    same_lang = fa["lang"] == fb["lang"]
    if strong:
        if shared_ver or sim >= SIM_STRONG:
            return True
        return (not same_lang) and dt <= CROSS_LANG_H
    if shared:
        return same_lang and sim >= SIM_WEAK
    return sim >= SIM_NONE


def event_id_for(item):
    """稳定事件 id：由该组第一条的 canonical_url 决定。B 段入库复用。"""
    return "ev-" + hashlib.sha1(item["canonical_url"].encode("utf-8")).hexdigest()[:10]


def _event_id(item):
    return event_id_for(item)


def _weight(source_map, item):
    s = source_map.get(item["source"])
    return s["weight"] if s else 1.0


def _direction(lexicon, lead_ents, all_ents, source_dir):
    """方向：先看词表里强实体的方向提示（标题里的优先），没有再用最权威来源的方向。"""
    for pool in (lead_ents, all_ents):
        for key in sorted(pool):
            if pool[key] and key in lexicon.direction:
                return lexicon.direction[key]
    return source_dir


def cluster(items, source_map=None, lexicon=None, window_h=WINDOW_H):
    """items: parse 产出的统一条目。返回事件列表（按首次出现时间升序）。

    同一 canonical_url 只留一条。贪心：按时间顺序，把条目放进和它最像的事件，
    没有就新开一个事件。
    """
    source_map = source_map if source_map is not None else _sources.SOURCE_BY_ID
    lexicon = lexicon or DEFAULT_LEXICON
    seen, uniq = set(), []
    for it in items:
        if it["canonical_url"] not in seen:
            seen.add(it["canonical_url"])
            uniq.append(it)
    feats = {id(it): features(it, lexicon) for it in uniq}
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    uniq.sort(key=lambda it: (feats[id(it)]["t"] or epoch, it["canonical_url"]))

    groups = []  # list of list[item]
    for it in uniq:
        f = feats[id(it)]
        best, best_score = None, -1.0
        for g in groups:
            first_t = feats[id(g[0])]["t"]
            if f["t"] and first_t and _hours(f["t"], first_t) > window_h:
                continue
            score = max(
                (similarity(f["hash"], feats[id(m)]["hash"]) for m in g if same_event(f, feats[id(m)], window_h)),
                default=-1.0,
            )
            if score > best_score:
                best, best_score = g, score
        if best is None:
            groups.append([it])
        else:
            best.append(it)

    events = []
    for g in groups:
        lead = sorted(g, key=lambda m: (-_weight(source_map, m), feats[id(m)]["t"] or epoch))[0]
        times = [feats[id(m)]["t"] for m in g if feats[id(m)]["t"]]
        src = source_map.get(lead["source"])
        ents = {}
        for m in g:
            ents.update(feats[id(m)]["ents"])
        events.append({
            "id": _event_id(g[0]),
            "title": lead["title"],
            "direction": _direction(lexicon, feats[id(lead)]["ents"], ents, src["direction"] if src else "product"),
            "items": g,
            "source_ids": sorted({m["source"] for m in g}),
            "first_seen": min(times).strftime("%Y-%m-%dT%H:%M:%SZ") if times else None,
            "last_seen": max(times).strftime("%Y-%m-%dT%H:%M:%SZ") if times else None,
            "entities": sorted(ents),
        })
    events.sort(key=lambda e: (e["first_seen"] or "", e["id"]))
    return events
