"""RSS / Atom / JSON Feed / GitHub Trending 列表页 -> 统一条目。

条目：{source, url, canonical_url, title, excerpt(<=140), published_at(ISO UTC 或 None), lang}
只存标题、链接、来源、时间和短摘录；正文一律丢弃。
"""
import html
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

EXCERPT_MAX = 140

TRACKING_EXACT = {
    "fbclid", "gclid", "dclid", "msclkid", "igshid", "mc_cid", "mc_eid", "ref", "ref_src",
    "ref_url", "spm", "share_token", "yclid", "_hsenc", "_hsmi", "mkt_tok",
}


def _is_tracking(key):
    k = key.lower()
    return k.startswith("utm_") or k.startswith("hsa_") or k in TRACKING_EXACT


def canonicalize(url):
    """去跟踪参数和片段、http->https、域名小写、去尾斜杠、剩余参数排序。"""
    url = (url or "").strip()
    if not url:
        return ""
    parts = urlsplit(url)
    if not parts.netloc:
        return url
    scheme = "https" if parts.scheme in ("http", "https") else parts.scheme
    host = parts.hostname or ""
    netloc = host.lower()
    port = parts.port
    if port and port not in (80, 443):
        netloc += ":%d" % port
    if parts.username:
        netloc = parts.username + "@" + netloc
    path = parts.path
    if len(path) > 1:
        path = path.rstrip("/")
    elif path == "/":
        path = ""
    query = sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _is_tracking(k))
    return urlunsplit((scheme, netloc, path, urlencode(query), ""))


_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def clean_text(text):
    text = html.unescape(_TAG.sub(" ", text or ""))
    return _WS.sub(" ", text).strip()


def excerpt(text, limit=EXCERPT_MAX):
    text = clean_text(text)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


_CJK = re.compile(r"[\u3400-\u9fff]")


def detect_lang(text, default="en"):
    letters = len(re.sub(r"\s", "", text or ""))
    if not letters:
        return default
    return "zh" if len(_CJK.findall(text)) / letters >= 0.2 else "en"


def parse_date(value):
    """RFC 822 / ISO 8601 -> ISO UTC 字符串；失败返回 None。"""
    if not value:
        return None
    value = value.strip()
    dt = None
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        dt = None
    if dt is None:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _entry(source, url, title, summary, published, base_url=None):
    title = clean_text(title)
    url = (url or "").strip()
    if base_url and url and not urlsplit(url).netloc:
        parts = urlsplit(base_url)
        url = "%s://%s%s" % (parts.scheme, parts.netloc, url if url.startswith("/") else "/" + url)
    if not title or not url:
        return None
    sid = source["id"] if isinstance(source, dict) else str(source)
    default_lang = source.get("lang", "en") if isinstance(source, dict) else "en"
    return {
        "source": sid,
        "url": url,
        "canonical_url": canonicalize(url),
        "title": title,
        "excerpt": excerpt(summary),
        "published_at": parse_date(published),
        "lang": detect_lang(title, default_lang),
    }


def _local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _children(node, name):
    return [c for c in node if _local(c.tag) == name]


def _text(node, *names):
    for n in names:
        for c in _children(node, n):
            if c.text and c.text.strip():
                return c.text
    return ""


def _dedupe(entries):
    seen, out = set(), []
    for e in entries:
        if e and e["canonical_url"] not in seen:
            seen.add(e["canonical_url"])
            out.append(e)
    return out


def parse_rss(source, text):
    root = ET.fromstring(text)
    items = [n for n in root.iter() if _local(n.tag) == "item"]
    out = []
    for it in items:
        link = _text(it, "link") or _text(it, "guid")
        out.append(_entry(
            source, link, _text(it, "title"),
            _text(it, "description") or _text(it, "encoded") or _text(it, "summary"),
            _text(it, "pubDate") or _text(it, "date") or _text(it, "published"),
        ))
    return _dedupe(out)


def parse_atom(source, text):
    root = ET.fromstring(text)
    out = []
    for it in [n for n in root.iter() if _local(n.tag) == "entry"]:
        href = ""
        for link in _children(it, "link"):
            rel = link.get("rel", "alternate")
            if rel == "alternate" and link.get("href"):
                href = link.get("href")
                break
            if not href and link.get("href"):
                href = link.get("href")
        out.append(_entry(
            source, href, _text(it, "title"),
            _text(it, "summary") or _text(it, "content"),
            _text(it, "published") or _text(it, "updated"),
        ))
    return _dedupe(out)


def parse_json_feed(source, text):
    data = json.loads(text)
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError("not a JSON Feed: missing items")
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        out.append(_entry(
            source, it.get("url") or it.get("external_url") or "", it.get("title") or "",
            it.get("summary") or it.get("content_text") or it.get("content_html") or "",
            it.get("date_published") or it.get("date_modified") or "",
        ))
    return _dedupe(out)


class _TrendingParser(HTMLParser):
    """GitHub Trending：<article class="Box-row"> 里 h2 > a[href=/owner/repo]，p 是描述。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self._row = None
        self._in_h2 = False
        self._in_p = False
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "article" and "Box-row" in (a.get("class") or ""):
            self._row = {"href": "", "name": [], "desc": []}
        elif self._row is not None:
            if tag == "h2":
                self._in_h2 = True
            elif tag == "a" and self._in_h2 and not self._row["href"]:
                self._row["href"] = a.get("href") or ""
            elif tag == "p" and not self._row["desc"]:
                self._in_p = True

    def handle_endtag(self, tag):
        if self._row is None:
            return
        if tag == "h2":
            self._in_h2 = False
        elif tag == "p":
            self._in_p = False
        elif tag == "article":
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._row is None:
            return
        if self._in_h2:
            self._row["name"].append(data)
        elif self._in_p:
            self._row["desc"].append(data)


def parse_github_trending(source, text, now=None):
    p = _TrendingParser()
    p.feed(text)
    stamp = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if now else None
    out = []
    for row in p.rows:
        href = row["href"].strip()
        name = re.sub(r"\s+", "", "".join(row["name"]))
        if not href or not name:
            continue
        e = _entry(source, href, name, " ".join(row["desc"]), None, base_url="https://github.com")
        if e:
            e["published_at"] = stamp
            out.append(e)
    return _dedupe(out)


def sniff(text):
    head = text.lstrip()[:400].lower()
    if head.startswith("{"):
        return "json"
    if "<feed" in head:
        return "atom"
    if "<rss" in head or "<rdf" in head or "<channel" in head:
        return "rss"
    return "html-list"


def parse_feed(source, text, now=None):
    """按 source['type'] 解析；类型和内容对不上时按内容嗅探一次。"""
    kind = source.get("type") if isinstance(source, dict) else None
    if kind not in ("rss", "atom", "json", "html-list"):
        kind = sniff(text)
    sniffed = sniff(text)
    if kind != sniffed and sniffed != "html-list":
        kind = sniffed
    if kind == "rss":
        return parse_rss(source, text)
    if kind == "atom":
        return parse_atom(source, text)
    if kind == "json":
        return parse_json_feed(source, text)
    return parse_github_trending(source, text, now)
