import unittest
from datetime import datetime, timezone

import _common as c
from engine.feed import parse


class CanonicalizeTest(unittest.TestCase):
    def test_strips_tracking_and_normalises(self):
        self.assertEqual(
            parse.canonicalize("http://Feed.Example.test/posts/a/?utm_source=x&id=7&fbclid=z#frag"),
            "https://feed.example.test/posts/a?id=7",
        )

    def test_trailing_slash_root_and_port(self):
        self.assertEqual(parse.canonicalize("https://a.test/"), "https://a.test")
        self.assertEqual(parse.canonicalize("https://a.test:443/x/"), "https://a.test/x")
        self.assertEqual(parse.canonicalize("http://a.test:8080/x"), "https://a.test:8080/x")

    def test_query_sorted_so_order_does_not_matter(self):
        self.assertEqual(parse.canonicalize("https://a.test/p?b=2&a=1"), parse.canonicalize("https://a.test/p?a=1&b=2"))

    def test_empty(self):
        self.assertEqual(parse.canonicalize(""), "")


class ExcerptTest(unittest.TestCase):
    def test_limit_140_with_ellipsis(self):
        out = parse.excerpt("字" * 300)
        self.assertEqual(len(out), 140)
        self.assertTrue(out.endswith("…"))

    def test_short_text_untouched_and_html_stripped(self):
        self.assertEqual(parse.excerpt("<p>a <b>b</b> &amp; c</p>"), "a b & c")


class DateTest(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(parse.parse_date("Sat, 25 Oct 2026 06:30:00 GMT"), "2026-10-25T06:30:00Z")
        self.assertEqual(parse.parse_date("2026-10-25T08:15:00+08:00"), "2026-10-25T00:15:00Z")
        self.assertEqual(parse.parse_date("2026-10-25T00:00:00Z"), "2026-10-25T00:00:00Z")
        self.assertIsNone(parse.parse_date("not a date"))
        self.assertIsNone(parse.parse_date(""))


class RssTest(unittest.TestCase):
    def setUp(self):
        self.items = parse.parse_rss({"id": "t", "lang": "en"}, c.fixture("rss_sample.xml"))

    def test_dedupe_empty_title_dropped(self):
        titles = [i["title"] for i in self.items]
        self.assertEqual(titles, ["Acme releases Orion-5.5 model", "中文标题：智能体评测基准发布", "No date item"])

    def test_unified_shape(self):
        first = self.items[0]
        self.assertEqual(set(first), {"source", "url", "canonical_url", "title", "excerpt", "published_at", "lang"})
        self.assertEqual(first["source"], "t")
        self.assertEqual(first["canonical_url"], "https://feed.example.test/posts/orion-5-5?id=7")
        self.assertEqual(first["published_at"], "2026-10-25T06:30:00Z")
        self.assertLessEqual(len(first["excerpt"]), 140)
        self.assertNotIn("<", first["excerpt"])

    def test_content_encoded_dc_date_and_lang(self):
        zh = self.items[1]
        self.assertEqual(zh["lang"], "zh")
        self.assertEqual(zh["published_at"], "2026-10-25T00:15:00Z")
        self.assertEqual(zh["excerpt"], "评测集覆盖 工具调用 与长任务。")

    def test_missing_date_is_none(self):
        self.assertIsNone(self.items[2]["published_at"])

    def test_broken_xml_raises(self):
        with self.assertRaises(Exception):
            parse.parse_rss({"id": "t"}, c.fixture("rss_broken.xml"))


class AtomTest(unittest.TestCase):
    def test_atom(self):
        items = parse.parse_atom({"id": "a", "lang": "en"}, c.fixture("atom_sample.xml"))
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["title"], "Agent SDK & tools overview")
        self.assertEqual(items[0]["canonical_url"], "https://atom.example.test/posts/agent-sdk")
        self.assertEqual(items[0]["published_at"], "2026-10-24T22:00:00Z")
        self.assertEqual(items[1]["published_at"], "2026-10-25T01:00:00Z")  # 只有 updated，带时区
        self.assertEqual(items[1]["excerpt"], "Body text")


class JsonFeedTest(unittest.TestCase):
    def test_json_feed(self):
        items = parse.parse_json_feed({"id": "j", "lang": "zh"}, c.fixture("json_feed_sample.json"))
        self.assertEqual(len(items), 2)  # 没有 url 的第三条被丢
        self.assertEqual(items[0]["lang"], "zh")
        self.assertEqual(items[1]["canonical_url"], "https://other.example.test/post?k=v")
        self.assertEqual(items[1]["published_at"], "2026-10-24T12:00:00Z")

    def test_not_a_feed(self):
        with self.assertRaises(ValueError):
            parse.parse_json_feed({"id": "j"}, '{"hello": 1}')


class TrendingTest(unittest.TestCase):
    def test_trending(self):
        now = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
        items = parse.parse_github_trending({"id": "gh", "lang": "en"}, c.fixture("trending_sample.html"), now)
        self.assertEqual([i["title"] for i in items], ["acme-labs/agent-kit", "someone/notes"])
        self.assertEqual(items[0]["canonical_url"], "https://github.com/acme-labs/agent-kit")
        self.assertEqual(items[0]["excerpt"], "A tiny toolkit for building tool-using agents.")
        self.assertEqual(items[0]["published_at"], "2026-10-25T08:00:00Z")
        self.assertEqual(items[1]["excerpt"], "")


class DispatchTest(unittest.TestCase):
    def test_parse_feed_by_type_and_sniff(self):
        self.assertEqual(len(parse.parse_feed({"id": "x", "type": "rss"}, c.fixture("rss_sample.xml"))), 3)
        self.assertEqual(len(parse.parse_feed({"id": "x", "type": "atom"}, c.fixture("atom_sample.xml"))), 2)
        # 配置写错了类型：按内容嗅探
        self.assertEqual(len(parse.parse_feed({"id": "x", "type": "rss"}, c.fixture("atom_sample.xml"))), 2)
        self.assertEqual(len(parse.parse_feed({"id": "x", "type": "json"}, c.fixture("json_feed_sample.json"))), 2)
        self.assertEqual(len(parse.parse_feed({"id": "x", "type": "html-list"}, c.fixture("trending_sample.html"))), 2)


if __name__ == "__main__":
    unittest.main()
