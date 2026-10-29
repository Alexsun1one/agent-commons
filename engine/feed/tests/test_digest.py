import unittest

import _common as c
from engine.feed import cluster, digest

NOW = "2026-10-25T08:00:00Z"
SRC = {
    "openai": {"name": "OpenAI 新闻", "weight": 1.5, "direction": "model"},
    "qbitai": {"name": "量子位", "weight": 1.0, "direction": "product"},
    "hn": {"name": "Hacker News", "weight": 0.8, "direction": "product"},
    "arxiv": {"name": "arXiv", "weight": 0.7, "direction": "research"},
}
DIRS = [("model", "模型"), ("product", "产品"), ("research", "研究"), ("agent", "智能体")]


def make():
    items = [
        c.item("openai", "OpenAI releases GPT-5.5", "2026-10-25T05:00:00Z"),
        c.item("hn", "GPT-5.5 released by OpenAI", "2026-10-25T06:00:00Z"),
        c.item("qbitai", "Cursor 上线新的后台智能体", "2026-10-25T02:00:00Z"),
        c.item("hn", "Show: tiny notes app", "2026-10-25T03:00:00Z"),
        c.item("hn", "Another small launch", "2026-10-25T04:00:00Z"),
        c.item("hn", "Old news", "2026-10-22T04:00:00Z"),
        c.item("arxiv", "A benchmark for long-horizon planning", "2026-10-25T01:00:00Z"),
    ]
    return cluster.cluster(items, SRC)


class DigestTest(unittest.TestCase):
    def test_groups_by_direction_in_order_and_skips_stale(self):
        d = digest.build(make(), NOW, per_direction=2, source_map=SRC, directions=DIRS)
        self.assertEqual([s["direction"] for s in d["sections"]], ["model", "product", "research"])
        titles = [i["title"] for s in d["sections"] for i in s["items"]]
        self.assertNotIn("Old news", titles)
        self.assertEqual(d["date"], "2026-10-25")

    def test_top_n_per_direction(self):
        d = digest.build(make(), NOW, per_direction=1, source_map=SRC, directions=DIRS)
        product = [s for s in d["sections"] if s["direction"] == "product"][0]
        self.assertEqual(len(product["items"]), 1)

    def test_template_text_has_sources_and_age(self):
        d = digest.build(make(), NOW, per_direction=3, source_map=SRC, directions=DIRS)
        model = d["sections"][0]["items"][0]
        self.assertIn("2 个来源报道（Hacker News、OpenAI 新闻）", model["text"])
        self.assertIn("3 小时前首次出现", model["text"])
        self.assertIn("# AI 热点日报 · 2026-10-25", d["text"])
        self.assertIn("## 模型", d["text"])
        self.assertIn("1. ", d["text"])

    def test_empty(self):
        d = digest.build([], NOW, source_map=SRC, directions=DIRS)
        self.assertEqual(d["sections"], [])
        self.assertIn("0 个事件", d["intro"])

    def test_no_model_call_is_pure(self):
        a = digest.build(make(), NOW, source_map=SRC, directions=DIRS)
        b = digest.build(make(), NOW, source_map=SRC, directions=DIRS)
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
