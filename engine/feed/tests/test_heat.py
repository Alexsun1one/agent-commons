import unittest

import _common as c
from engine.feed import cluster, heat

NOW = "2026-10-25T12:00:00Z"
SRC = {
    "openai": {"weight": 1.5, "direction": "model"},
    "hn": {"weight": 1.0, "direction": "product"},
    "qbitai": {"weight": 1.0, "direction": "product"},
}


def event(items):
    return cluster.cluster(items, SRC)[0]


class HeatTest(unittest.TestCase):
    def test_single_source_value(self):
        e = event([c.item("hn", "GPT-5.5 released by OpenAI", NOW)])
        self.assertEqual(heat.heat(e, NOW, source_map=SRC), 10.0)

    def test_same_source_repeats_within_48h_count_once(self):
        one = event([c.item("hn", "GPT-5.5 released by OpenAI", "2026-10-25T10:00:00Z")])
        many = event([
            c.item("hn", "GPT-5.5 released by OpenAI", "2026-10-25T10:00:00Z"),
            c.item("hn", "GPT-5.5 released by OpenAI today", "2026-10-25T11:00:00Z"),
            c.item("hn", "OpenAI GPT-5.5 released", "2026-10-26T09:00:00Z"),
        ])
        # 第三条在未来，不计；前两条同源 48h 内只算第一条
        self.assertEqual(heat.heat(one, NOW, source_map=SRC), heat.heat(many, NOW, source_map=SRC))

    def test_same_source_after_48h_counts_again(self):
        e = {"id": "ev-x", "items": [
            c.item("hn", "a", "2026-10-22T00:00:00Z"),
            c.item("hn", "b", "2026-10-23T00:00:00Z"),
            c.item("hn", "c", "2026-10-24T01:00:00Z"),
        ]}
        sig = heat.counted_signals(e, SRC)
        self.assertEqual([s[0].day for s in sig], [22, 24])

    def test_independent_sources_add_up_with_weights(self):
        e = event([
            c.item("openai", "OpenAI releases GPT-5.5", NOW),
            c.item("hn", "GPT-5.5 released by OpenAI", NOW),
            c.item("qbitai", "GPT-5.5 released OpenAI 发布", NOW),
        ])
        self.assertEqual(len(e["source_ids"]), 3)
        self.assertEqual(heat.heat(e, NOW, source_map=SRC), 35.0)

    def test_half_after_24h_and_quarter_after_48h(self):
        e = event([c.item("hn", "GPT-5.5 released by OpenAI", "2026-10-24T12:00:00Z")])
        self.assertAlmostEqual(heat.heat(e, NOW, source_map=SRC), 5.0, places=2)
        e2 = event([c.item("hn", "GPT-5.5 released by OpenAI", "2026-10-23T12:00:00Z")])
        self.assertAlmostEqual(heat.heat(e2, NOW, source_map=SRC), 2.5, places=2)

    def test_signals_in_the_future_ignored(self):
        e = event([c.item("hn", "GPT-5.5 released by OpenAI", "2026-10-25T13:00:00Z")])
        self.assertEqual(heat.heat(e, NOW, source_map=SRC), 0.0)

    def test_site_signals_weights_and_decay(self):
        e = event([c.item("hn", "GPT-5.5 released by OpenAI", NOW)])
        site = [
            {"event_id": e["id"], "kind": "favorite", "at": NOW},
            {"event_id": e["id"], "kind": "comment", "at": NOW},
            {"event_id": e["id"], "kind": "room", "at": "2026-10-24T12:00:00Z"},
            {"event_id": "other", "kind": "room", "at": NOW},
            {"event_id": e["id"], "kind": "bogus", "at": NOW},
        ]
        base = heat.heat(e, NOW, source_map=SRC)
        got = heat.heat(e, NOW, site, SRC)
        self.assertAlmostEqual(got - base, 2.0 + 1.5 + 4.0 * 0.5, places=2)

    def test_site_weights_are_parameters(self):
        e = event([c.item("hn", "GPT-5.5 released by OpenAI", NOW)])
        site = [{"event_id": e["id"], "kind": "room", "at": NOW}]
        self.assertAlmostEqual(heat.heat(e, NOW, site, SRC, {"w_room": 10.0}) - 10.0, 10.0, places=2)

    def test_hourly_series(self):
        e = event([
            c.item("hn", "GPT-5.5 released by OpenAI", "2026-10-25T06:00:00Z"),
            c.item("openai", "OpenAI releases GPT-5.5", "2026-10-25T09:00:00Z"),
        ])
        series = heat.hourly_series(e, NOW, 24, source_map=SRC)
        self.assertEqual(len(series), 25)
        self.assertEqual(series[0], 0.0)           # 24 小时前还没有信号
        self.assertEqual(series[-1], heat.heat(e, NOW, source_map=SRC))
        self.assertGreater(series[19], series[17])  # 09:00 之后第二个来源进来
        peak = max(series)
        self.assertGreater(peak, 0)

    def test_rank_order(self):
        hot = event([c.item("openai", "OpenAI releases GPT-5.5", NOW), c.item("hn", "GPT-5.5 OpenAI", NOW)])
        cold = event([c.item("hn", "Quarterly cloud report", "2026-10-24T00:00:00Z")])
        ranked = heat.rank([cold, hot], NOW, source_map=SRC)
        self.assertEqual([r[0]["id"] for r in ranked], [hot["id"], cold["id"]])


if __name__ == "__main__":
    unittest.main()
