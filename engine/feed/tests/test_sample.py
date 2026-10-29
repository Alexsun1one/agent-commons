import json
import unittest

import _common  # noqa: F401  (把项目根放进 sys.path)
from engine.feed import make_sample


class SampleShapeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = make_sample.build()

    def test_top_level_shape(self):
        d = self.data
        self.assertTrue(d["sample"])
        self.assertEqual(len(d["top"]), 3)
        self.assertEqual(d["top"], [e["id"] for e in d["events"][:3]])
        self.assertEqual(d["failed_sources"], ["sspai", "ai-json"])  # 假传输让这两个源 503，抓取器把它们隔离掉了

    def test_events_sorted_by_heat_with_24h_series(self):
        heats = [e["heat"] for e in self.data["events"]]
        self.assertEqual(heats, sorted(heats, reverse=True))
        for e in self.data["events"]:
            self.assertEqual(len(e["series"]), 25)
            self.assertEqual(e["series"][-1], e["heat"])
            self.assertEqual(e["source_count"], len({s["source"] for s in e["sources"]}))
            self.assertTrue(e["title_zh"])
            self.assertTrue(e["summary_zh"])
            self.assertLessEqual(len(e["summary_zh"]), 40)
            for s in e["sources"]:
                self.assertTrue(s["url"].startswith("https://"))
                self.assertIn(".example/", s["url"])  # 全是示例域名

    def test_cross_language_event_present(self):
        top = self.data["events"][0]
        self.assertEqual({s["lang"] for s in top["sources"]}, {"en", "zh"})

    def test_chinese_lead_keeps_same_title_and_summary(self):
        event = next(e for e in self.data["events"] if e["title"] == "MCP 规范新增流式授权流程")
        self.assertEqual(event["title_zh"], event["summary_zh"])

    def test_json_serialisable_and_digest(self):
        json.dumps(self.data, ensure_ascii=False)
        self.assertTrue(self.data["digest"]["sections"])


if __name__ == "__main__":
    unittest.main()
