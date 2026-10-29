"""抓取器：只定义接口、超时、重试、条件请求、单源隔离、每源限速。

本模块不含任何真实网络调用。传输层由调用方注入：
    transport(request) -> Response
    request = {"url", "headers", "timeout"}
B 段在 server/modules/feed/ 里提供基于标准库的真实传输；测试里用假传输。
传输层抛 TransportError 表示网络层失败（可重试）。
"""
import time
from dataclasses import dataclass, field

from . import parse as _parse
from . import sources as _sources

USER_AGENT = "AgentCommonsFeedBot/0.1 (+title-link-excerpt-only)"


class TransportError(Exception):
    pass


@dataclass
class Response:
    status: int
    body: bytes = b""
    headers: dict = field(default_factory=dict)


@dataclass
class FetchResult:
    source_id: str
    status: str            # ok | not_modified | error | skipped
    items: list = field(default_factory=list)
    error: str = ""
    attempts: int = 0
    http_status: int = 0


def decode_body(resp):
    ctype = ""
    for k, v in resp.headers.items():
        if k.lower() == "content-type":
            ctype = v
    charset = "utf-8"
    if "charset=" in ctype.lower():
        charset = ctype.lower().split("charset=", 1)[1].split(";")[0].strip() or "utf-8"
    try:
        return resp.body.decode(charset)
    except (LookupError, UnicodeDecodeError):
        return resp.body.decode("utf-8", errors="replace")


class Fetcher:
    def __init__(self, transport, sources=None, state=None, timeout=10.0, retries=2,
                 backoff=0.5, min_interval=2.0, poll_interval=0.0, clock=time.monotonic,
                 sleep=time.sleep, now=None):
        """
        state: dict，按来源 id 存 etag / last_modified / last_request_at / last_ok_at，调用方持久化。
        min_interval: 同一来源两次请求（含重试）之间至少隔这么多秒。
        poll_interval: 距上次成功抓取不足这么多秒的来源直接跳过（skipped）。
        """
        self.transport = transport
        self.sources = list(sources if sources is not None else _sources.SOURCES)
        self.state = state if state is not None else {}
        self.timeout = timeout
        self.retries = retries
        self.backoff = backoff
        self.min_interval = min_interval
        self.poll_interval = poll_interval
        self.clock = clock
        self.sleep = sleep
        self.now = now

    def _throttle(self, st):
        last = st.get("last_request_at")
        if last is not None:
            wait = self.min_interval - (self.clock() - last)
            if wait > 0:
                self.sleep(wait)
        st["last_request_at"] = self.clock()

    def _request(self, source, st):
        headers = {"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/json, text/html;q=0.8"}
        if st.get("etag"):
            headers["If-None-Match"] = st["etag"]
        if st.get("last_modified"):
            headers["If-Modified-Since"] = st["last_modified"]
        return {"url": source["url"], "headers": headers, "timeout": self.timeout}

    def fetch_source(self, source):
        sid = source["id"]
        st = self.state.setdefault(sid, {})
        if self.poll_interval and st.get("last_ok_at") is not None \
                and self.clock() - st["last_ok_at"] < self.poll_interval:
            return FetchResult(sid, "skipped", error="polled recently")
        attempts, last_error, http_status = 0, "", 0
        while attempts <= self.retries:
            attempts += 1
            self._throttle(st)
            try:
                resp = self.transport(self._request(source, st))
            except TransportError as e:
                last_error = "transport: %s" % e
            except Exception as e:  # 传输层写坏了也不能拖垮其他源
                last_error = "transport crashed: %s" % e
            else:
                http_status = resp.status
                hdr = {k.lower(): v for k, v in resp.headers.items()}
                if resp.status == 304:
                    st["last_ok_at"] = self.clock()
                    return FetchResult(sid, "not_modified", attempts=attempts, http_status=304)
                if 200 <= resp.status < 300:
                    try:
                        items = _parse.parse_feed(source, decode_body(resp), self.now)
                    except Exception as e:  # 解析失败不重试：重试拿到的是同样的内容
                        return FetchResult(sid, "error", error="parse: %s" % e,
                                           attempts=attempts, http_status=resp.status)
                    if hdr.get("etag"):
                        st["etag"] = hdr["etag"]
                    if hdr.get("last-modified"):
                        st["last_modified"] = hdr["last-modified"]
                    st["last_ok_at"] = self.clock()
                    return FetchResult(sid, "ok", items=items, attempts=attempts, http_status=resp.status)
                last_error = "http %d" % resp.status
                if resp.status not in (408, 425, 429) and resp.status < 500:
                    return FetchResult(sid, "error", error=last_error, attempts=attempts, http_status=resp.status)
                retry_after = hdr.get("retry-after", "")
                if retry_after.isdigit() and attempts <= self.retries:
                    self.sleep(min(float(retry_after), 30.0))
                    continue
            if attempts <= self.retries:
                self.sleep(self.backoff * (2 ** (attempts - 1)))
        return FetchResult(sid, "error", error=last_error, attempts=attempts, http_status=http_status)

    def fetch_all(self):
        """逐源抓取，单源失败（含意外异常）只记在自己名下。返回 (results, summary)。"""
        results = []
        for source in self.sources:
            try:
                results.append(self.fetch_source(source))
            except Exception as e:
                results.append(FetchResult(source["id"], "error", error="crashed: %s" % e))
        summary = {
            "ok": sum(r.status in ("ok", "not_modified") for r in results),
            "failed": [r.source_id for r in results if r.status == "error"],
            "skipped": [r.source_id for r in results if r.status == "skipped"],
        }
        return results, summary
