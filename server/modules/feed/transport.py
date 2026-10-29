"""采集传输层：只认 engine.feed.sources 白名单。默认实现用标准库 urllib；测试注入假传输。

本文件在 import 时不发起任何连接。urllib_transport 只有 feed.collect.enabled 打开且
worker 走到采集消费者时才会被调用；本卡测试从不调用它。
"""
from . import pathsetup  # noqa: F401

from engine.feed import sources
from engine.feed.fetch import Response, TransportError

ALLOWED_URLS = {s['url'] for s in sources.SOURCES}

# 测试注入：设成可调用对象后，worker 用它而不是 urllib。
_injected = None


def allowed_url(url):
    return url in ALLOWED_URLS


def inject(transport=None):
    """测试用。传入假传输；传 None 恢复默认（仍受 collect 开关约束）。"""
    global _injected
    _injected = transport


def current():
    return _injected if _injected is not None else urllib_transport


def urllib_transport(request):
    """标准库传输。先查白名单，不在表里的地址直接拒绝，不发请求。"""
    import urllib.error
    import urllib.request

    url = (request or {}).get('url') or ''
    if not allowed_url(url):
        raise TransportError('url not in sources whitelist')
    headers = dict((request or {}).get('headers') or {})
    timeout = float((request or {}).get('timeout') or 10)
    req = urllib.request.Request(url, headers=headers, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            hdrs = {k: v for k, v in resp.headers.items()}
            return Response(int(resp.status), body, hdrs)
    except urllib.error.HTTPError as exc:
        body = exc.read() if exc.fp is not None else b''
        hdrs = {k: v for k, v in exc.headers.items()} if exc.headers else {}
        return Response(int(exc.code), body, hdrs)
    except Exception as exc:
        raise TransportError(str(exc)) from exc
