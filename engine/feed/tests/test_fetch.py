import unittest

import _common as c
from engine.feed.fetch import Fetcher, Response, TransportError

RSS = c.fixture("rss_sample.xml").encode("utf-8")
SRC_A = {"id": "a", "type": "rss", "url": "https://a.example.test/feed", "lang": "en"}
SRC_B = {"id": "b", "type": "atom", "url": "https://b.example.test/feed", "lang": "en"}
ATOM = c.fixture("atom_sample.xml").encode("utf-8")


class Clock:
    def __init__(self):
        self.t = 1000.0
        self.slept = []

    def now(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


class FakeTransport:
    """按 URL 排队返回响应；Exception 实例会被抛出。记录每次请求。"""

    def __init__(self, script):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls = []

    def __call__(self, req):
        self.calls.append(req)
        queue = self.script[req["url"]]
        step = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(step, Exception):
            raise step
        return step


def make(script, sources=(SRC_A, SRC_B), **kw):
    clock = Clock()
    t = FakeTransport(script)
    f = Fetcher(t, sources=list(sources), clock=clock.now, sleep=clock.sleep, **kw)
    return f, t, clock


class FetchTest(unittest.TestCase):
    def test_ok_parses_and_remembers_validators(self):
        f, t, _ = make({SRC_A["url"]: [Response(200, RSS, {"ETag": '"v1"', "Last-Modified": "Sat, 25 Oct 2026 06:00:00 GMT"})]})
        r = f.fetch_source(SRC_A)
        self.assertEqual(r.status, "ok")
        self.assertEqual(len(r.items), 3)
        self.assertEqual(f.state["a"]["etag"], '"v1"')
        self.assertNotIn("If-None-Match", t.calls[0]["headers"])

    def test_conditional_request_and_304(self):
        f, t, clock = make({SRC_A["url"]: [
            Response(200, RSS, {"ETag": '"v1"', "Last-Modified": "Sat, 25 Oct 2026 06:00:00 GMT"}),
            Response(304),
        ]})
        f.fetch_source(SRC_A)
        r = f.fetch_source(SRC_A)
        self.assertEqual(r.status, "not_modified")
        self.assertEqual(r.items, [])
        h = t.calls[1]["headers"]
        self.assertEqual(h["If-None-Match"], '"v1"')
        self.assertEqual(h["If-Modified-Since"], "Sat, 25 Oct 2026 06:00:00 GMT")

    def test_timeout_is_passed_through(self):
        f, t, _ = make({SRC_A["url"]: [Response(200, RSS)]}, timeout=7.5)
        f.fetch_source(SRC_A)
        self.assertEqual(t.calls[0]["timeout"], 7.5)

    def test_retries_5xx_with_backoff_then_succeeds(self):
        f, t, clock = make({SRC_A["url"]: [Response(503), TransportError("reset"), Response(200, RSS)]}, retries=2, backoff=1.0, min_interval=0)
        r = f.fetch_source(SRC_A)
        self.assertEqual((r.status, r.attempts), ("ok", 3))
        self.assertEqual(clock.slept, [1.0, 2.0])

    def test_gives_up_after_retries(self):
        f, t, _ = make({SRC_A["url"]: [Response(500)]}, retries=2, min_interval=0, backoff=0)
        r = f.fetch_source(SRC_A)
        self.assertEqual((r.status, r.attempts, r.http_status), ("error", 3, 500))
        self.assertEqual(len(t.calls), 3)

    def test_4xx_not_retried(self):
        f, t, _ = make({SRC_A["url"]: [Response(404)]}, retries=3)
        r = f.fetch_source(SRC_A)
        self.assertEqual((r.status, r.attempts, r.error), ("error", 1, "http 404"))

    def test_429_honours_retry_after(self):
        f, t, clock = make({SRC_A["url"]: [Response(429, headers={"Retry-After": "5"}), Response(200, RSS)]}, min_interval=0)
        r = f.fetch_source(SRC_A)
        self.assertEqual(r.status, "ok")
        self.assertIn(5.0, clock.slept)

    def test_parse_failure_is_error_without_retry(self):
        f, t, _ = make({SRC_A["url"]: [Response(200, b"<rss><channel><item><title>x")]})
        r = f.fetch_source(SRC_A)
        self.assertEqual(r.status, "error")
        self.assertTrue(r.error.startswith("parse:"))
        self.assertEqual(len(t.calls), 1)

    def test_one_failing_source_does_not_stop_others(self):
        f, t, _ = make({
            SRC_A["url"]: [TransportError("dns")],
            SRC_B["url"]: [Response(200, ATOM)],
        }, retries=1, backoff=0, min_interval=0)
        results, summary = f.fetch_all()
        self.assertEqual([r.status for r in results], ["error", "ok"])
        self.assertEqual(summary["failed"], ["a"])
        self.assertEqual(summary["ok"], 1)
        self.assertEqual(len(results[1].items), 2)

    def test_crashing_transport_is_contained(self):
        f, t, _ = make({SRC_A["url"]: [ValueError("boom")], SRC_B["url"]: [Response(200, ATOM)]}, retries=0, min_interval=0)
        results, summary = f.fetch_all()
        self.assertEqual(summary["failed"], ["a"])
        self.assertEqual(results[1].status, "ok")

    def test_per_source_rate_limit_spacing(self):
        f, t, clock = make({SRC_A["url"]: [Response(500), Response(200, RSS)]}, retries=2, backoff=0.5, min_interval=2.0)
        f.fetch_source(SRC_A)
        # 退避 0.5 秒后，距上次请求仍不足 2 秒，再补 1.5 秒
        self.assertEqual(clock.slept, [0.5, 1.5])

    def test_other_sources_are_not_throttled_by_each_other(self):
        f, t, clock = make({SRC_A["url"]: [Response(200, RSS)], SRC_B["url"]: [Response(200, ATOM)]}, min_interval=2.0)
        f.fetch_all()
        self.assertEqual(clock.slept, [])

    def test_poll_interval_skips_recent_source(self):
        f, t, clock = make({SRC_A["url"]: [Response(200, RSS)]}, poll_interval=600)
        f.fetch_source(SRC_A)
        r = f.fetch_source(SRC_A)
        self.assertEqual(r.status, "skipped")
        self.assertEqual(len(t.calls), 1)
        clock.t += 601
        self.assertEqual(f.fetch_source(SRC_A).status, "ok")

    def test_charset_decoding(self):
        body = '<?xml version="1.0" encoding="gbk"?><rss><channel><item><title>标题</title><link>https://g.test/1</link></item></channel></rss>'.encode("gbk")
        f, t, _ = make({SRC_A["url"]: [Response(200, body, {"Content-Type": "application/rss+xml; charset=gbk"})]})
        r = f.fetch_source(SRC_A)
        self.assertEqual(r.items[0]["title"], "标题")


if __name__ == "__main__":
    unittest.main()
