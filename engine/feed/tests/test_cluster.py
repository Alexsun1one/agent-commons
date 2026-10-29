import unittest

import _common as c
from engine.feed import cluster
from engine.feed.cluster import Lexicon

T = "2026-10-25T%02d:00:00Z"
SRC = {
    "openai": {"weight": 1.5, "direction": "model"},
    "jiqizhixin": {"weight": 1.0, "direction": "model"},
    "hn": {"weight": 0.8, "direction": "product"},
    "qbitai": {"weight": 1.0, "direction": "product"},
    "gh": {"weight": 0.9, "direction": "opensource"},
    "arxiv": {"weight": 0.7, "direction": "research"},
}


def ev_titles(events):
    return sorted(sorted(i["title"] for i in e["items"]) for e in events)


class TokenTest(unittest.TestCase):
    def test_chinese_bigrams_english_words(self):
        self.assertEqual(cluster.tokens("发布新模型"), ["发布", "布新", "新模", "模型"])
        self.assertEqual(cluster.tokens("The new GPT-5.5 is out"), ["gpt-5.5", "out"])

    def test_simhash_similar_titles_close(self):
        a = cluster.simhash(cluster.tokens("Acme releases Orion model with agent tools"))
        b = cluster.simhash(cluster.tokens("Acme releases Orion model with new agent tools"))
        z = cluster.simhash(cluster.tokens("Quarterly revenue rises on cloud demand"))
        self.assertGreater(cluster.similarity(a, b), cluster.similarity(a, z))
        self.assertEqual(cluster.hamming(a, a), 0)

    def test_versions(self):
        self.assertEqual(cluster.versions("OpenAI 发布 GPT-5.5"), {"5.5"})
        self.assertEqual(cluster.versions("Qwen3 released"), {"3"})
        self.assertEqual(cluster.versions("GPT-5.0 vs gpt 5"), {"5"})
        self.assertEqual(cluster.versions("5 个新功能"), set())


class LexiconTest(unittest.TestCase):
    def test_default_and_extension(self):
        lx = cluster.default_lexicon()
        self.assertEqual(set(lx.find("OpenAI 发布 GPT-5.5")), {"openai", "gpt"})
        self.assertEqual(set(lx.find("通义千问新版本")), {"qwen"})
        self.assertNotIn("meta", lx.find("metadata is useful"))  # 词边界
        lx.add("orion", ["orion", "猎户"], strong=True)
        self.assertEqual(lx.find("猎户座发布会"), {"orion": True})

    def test_model_name_followed_by_digits_still_matches(self):
        lx = cluster.default_lexicon()
        self.assertIn("qwen", lx.find("Qwen3.5 is now on the Hub"))
        self.assertIn("gpt", lx.find("gpt5 leak"))

    def test_direction_hint_overrides_source_direction(self):
        items = [
            c.item("jiqizhixin", "MCP 规范新增流式授权流程", T % 3),
            c.item("hn", "MCP spec update: streamable authorization", T % 4),
        ]
        events = cluster.cluster(items, SRC)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["direction"], "agent")  # 来源 jiqizhixin 是 model，但 mcp 的提示是 agent

    def test_strength(self):
        found = cluster.default_lexicon().find("Anthropic ships Claude Code")
        self.assertTrue(found["claude-code"])
        self.assertFalse(found["anthropic"])


class ClusterTest(unittest.TestCase):
    def run_cluster(self, items):
        return cluster.cluster(items, SRC)

    def test_same_event_across_languages_and_sources(self):
        items = [
            c.item("openai", "OpenAI releases GPT-5.5 with stronger agent skills", T % 2),
            c.item("hn", "GPT-5.5 released by OpenAI", T % 3),
            c.item("jiqizhixin", "OpenAI 发布 GPT-5.5，智能体能力更强", T % 5),
            c.item("qbitai", "GPT-5.5 来了！OpenAI 最新模型实测", T % 6),
        ]
        events = self.run_cluster(items)
        self.assertEqual(len(events), 1)
        e = events[0]
        self.assertEqual(e["source_ids"], ["hn", "jiqizhixin", "openai", "qbitai"])
        self.assertEqual(e["title"], "OpenAI releases GPT-5.5 with stronger agent skills")  # 权威度最高
        self.assertEqual(e["direction"], "model")
        self.assertEqual(e["first_seen"], "2026-10-25T02:00:00Z")
        self.assertEqual(e["last_seen"], "2026-10-25T06:00:00Z")

    def test_different_events_not_merged(self):
        items = [
            c.item("openai", "OpenAI releases GPT-5.5 with stronger agent skills", T % 2),
            c.item("hn", "OpenAI announces new data center campus", T % 3),
            c.item("jiqizhixin", "OpenAI 与某银行签署企业合作协议", T % 3),
            c.item("gh", "acme/agent-kit: toolkit for tool-using agents", T % 4),
            c.item("arxiv", "A benchmark for long-horizon agent planning", T % 4),
        ]
        self.assertEqual(len(self.run_cluster(items)), 5)

    def test_version_conflict_splits_same_product(self):
        items = [
            c.item("openai", "OpenAI releases GPT-5 for everyone", T % 1),
            c.item("hn", "OpenAI releases GPT-5.5 for everyone", T % 2),
        ]
        self.assertEqual(len(self.run_cluster(items)), 2)

    def test_time_window_72h(self):
        a = c.item("openai", "OpenAI releases GPT-5.5 with stronger agent skills", "2026-10-20T02:00:00Z")
        b = c.item("hn", "GPT-5.5 released by OpenAI", "2026-10-25T02:00:00Z")
        self.assertEqual(len(self.run_cluster([a, b])), 2)
        b2 = c.item("hn", "GPT-5.5 released by OpenAI", "2026-10-22T20:00:00Z")  # 66 小时
        self.assertEqual(len(self.run_cluster([a, b2])), 1)

    def test_same_canonical_url_deduped(self):
        a = c.item("openai", "Same page", T % 1, url="https://x.test/p?utm_source=a")
        b = c.item("hn", "Same page again", T % 2, url="http://x.test/p/")
        events = self.run_cluster([a, b])
        self.assertEqual(sum(len(e["items"]) for e in events), 1)

    def test_near_duplicate_titles_without_entities(self):
        items = [
            c.item("arxiv", "A benchmark for long-horizon agent planning", T % 1),
            c.item("hn", "A benchmark for long-horizon agent planning", T % 2),
        ]
        self.assertEqual(len(self.run_cluster(items)), 1)

    def test_cross_language_entity_only_needs_24h(self):
        en = c.item("hn", "Anthropic ships Claude Code on the web", "2026-10-25T01:00:00Z")
        zh_near = c.item("qbitai", "新工具上线：不用装软件，打开浏览器就能同时跑好几个编程任务，开发者反馈很快（Claude Code）", "2026-10-25T10:00:00Z")
        zh_far = c.item("qbitai", "新工具上线：不用装软件，打开浏览器就能同时跑好几个编程任务，开发者反馈很快（Claude Code）", "2026-10-27T10:00:00Z")
        self.assertEqual(len(self.run_cluster([en, zh_near])), 1)
        self.assertEqual(len(self.run_cluster([en, zh_far])), 2)

    def test_deterministic(self):
        items = [
            c.item("openai", "OpenAI releases GPT-5.5 with stronger agent skills", T % 2, url="https://a.test/1"),
            c.item("hn", "GPT-5.5 released by OpenAI", T % 3, url="https://b.test/1"),
            c.item("gh", "acme/agent-kit", T % 4, url="https://c.test/1"),
        ]
        ids1 = [e["id"] for e in self.run_cluster(items)]
        ids2 = [e["id"] for e in self.run_cluster(list(reversed(items)))]
        self.assertEqual(ids1, ids2)

    def test_undated_items_do_not_crash(self):
        items = [c.item("hn", "GPT-5.5 released by OpenAI", None), c.item("openai", "OpenAI releases GPT-5.5", T % 1)]
        self.assertEqual(len(self.run_cluster(items)), 1)


if __name__ == "__main__":
    unittest.main()
