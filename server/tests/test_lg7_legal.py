"""LG-7 gates: the four public legal drafts stay present, scoped, and consistent.

These assertions check the facts the deployment and the product copy depend on:
the 18+ gate, the closed public scope, the seven-day deletion cooldown, the
retention values frozen in the LG-2 table, the PIPL markers, and the
cross-document links. They are not a re-statement of prose.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEGAL = ROOT / "docs" / "legal"
PUBLIC = ("privacy.md", "terms.md", "community-rules.md", "age-18.md")
DRAFT_MARK = "初稿 · 待律师审阅 · 不构成法律意见"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class LegalDocumentGateTest(unittest.TestCase):
    def test_four_public_drafts_exist_and_keep_the_gate_limits(self):
        for name in PUBLIC:
            with self.subTest(document=name):
                body = read(LEGAL / name)
                self.assertIn(DRAFT_MARK, body)
                self.assertLessEqual(len(re.sub(r"\s", "", body)), 1500, name)
                self.assertLessEqual(len(re.findall(r"^## ", body, re.M)), 8, name)

    def test_retention_appendix_is_a_draft(self):
        body = read(LEGAL / "retention.md")
        self.assertIn(DRAFT_MARK, body)
        self.assertIn("未定义", body)

    def test_all_documents_cover_the_same_age_threshold(self):
        privacy = read(LEGAL / "privacy.md")
        terms = read(LEGAL / "terms.md")
        rules = read(LEGAL / "community-rules.md")
        age = read(LEGAL / "age-18.md")
        for name, body in (("privacy.md", privacy), ("terms.md", terms), ("community-rules.md", rules)):
            with self.subTest(document=name):
                self.assertIn("18 岁以上", body)
        self.assertIn("你已满 18 周岁", age)
        self.assertIn("停用账号", age)
        self.assertIn("清理资料", age)
        self.assertIn("停用账号", privacy)
        self.assertIn("清理资料", privacy)

    def test_documents_reference_each_other(self):
        references = {
            "privacy.md": ("十八岁以上声明", "数据保留期限表"),
            "terms.md": ("十八岁以上声明", "隐私政策", "社区规则"),
            "community-rules.md": ("用户协议", "隐私政策", "十八岁以上声明"),
            "age-18.md": ("隐私政策", "用户协议", "社区规则"),
        }
        for name, titles in references.items():
            body = read(LEGAL / name)
            for title in titles:
                with self.subTest(document=name, reference=title):
                    self.assertIn(f"《{title}》", body)

    def test_public_visibility_stays_closed_in_both_documents(self):
        self.assertIn("公开本版不开放", read(LEGAL / "privacy.md"))
        self.assertIn("公开范围本版不开放", read(LEGAL / "terms.md"))

    def test_pipl_paragraphs_are_marked_and_mapped(self):
        privacy = read(LEGAL / "privacy.md")
        self.assertGreaterEqual(privacy.count("〔PIPL〕"), 5)
        review = read(LEGAL / "lawyer-review.md")
        for needle in ("PIPL 第 3 条第 2 款", "第 38", "第 39", "55、56"):
            self.assertIn(needle, review)
        for number in range(1, 16):
            self.assertIn(f"L-{number:02d}", review)
        readme = read(LEGAL / "README.md")
        self.assertIn("lawyer-review.md", readme)
        for name in PUBLIC + ("retention.md",):
            self.assertIn(name, readme)

    def test_deletion_cooloff_matches_server_setting(self):
        settings = read(ROOT / "server" / "app" / "settings.py")
        match = re.search(r"delete_cooldown_days:\s*int\s*=\s*(\d+)", settings)
        self.assertIsNotNone(match)
        days = match.group(1)
        self.assertIn(f"注销后 {days} 天冷静期", read(LEGAL / "privacy.md"))

    def test_retention_summary_matches_appendix(self):
        privacy = read(LEGAL / "privacy.md")
        appendix = read(LEGAL / "retention.md")
        for phrase in ("会话 14 天", "导出包 24 小时", "幂等缓存 72 小时", "48 份小时备份和 14 份日备份"):
            self.assertIn(phrase, privacy)
        for phrase in ("会话", "14 天", "导出包", "24 小时", "幂等缓存", "72 小时", "48 份小时备份", "14 份日备份"):
            self.assertIn(phrase, appendix)

    def test_retention_values_match_lg2_table_when_present(self):
        table = ROOT / "docs" / "evidence" / "LG-2" / "retention.md"
        if not table.exists():
            self.skipTest("LG-2 retention.md not delivered yet")
        body = read(table)
        days = set(re.findall(r"(\d+)\s*(?:天|小时)", body))
        for expected in ("7", "14", "24", "48", "72"):
            self.assertIn(expected, days, f"LG-2 table lacks a {expected} retention row")


if __name__ == "__main__":
    unittest.main()
