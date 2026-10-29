from unittest import mock

from tests.helpers import HDRS, AppCase


class SearchAllTest(AppCase):
    def setUp(self):
        super().setUp()
        self.author = self.user("search_author", level=3)
        self.reader = self.user("search_reader", level=2)

    def test_empty_query_and_kind_filter(self):
        self.assertEqual(self.reader.get("/api/search-all?q=").json()["data"], [])
        self.obj(self.author, type="knowledge", title="统一检索标记", content={"body": "共同正文"})
        self.obj(self.author, type="discussion", title="统一检索标记", content={"body": "共同正文"})
        response = self.reader.get("/api/search-all", params={"q": "统一检索", "kinds": "knowledge"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual({item["kind"] for item in response.json()["data"]}, {"knowledge"})

    def test_invisible_result_is_not_returned(self):
        visible = self.obj(self.author, title="隐私边界词", content={"body": "可见内容"})
        self.obj(self.author, title="隐私边界词", content={"body": "绝密片段"},
                 visibility="named", acl=[self.author.pid])
        response = self.reader.get("/api/search-all", params={"q": "隐私边界词"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item["id"] for item in response.json()["data"]], [visible["id"]])
        self.assertNotIn("绝密片段", response.text)

    def test_adjustable_synonym(self):
        made = self.obj(self.author, type="knowledge", title="Claude Code 上手", content={"body": "命令行工具"})
        response = self.reader.get("/api/search-all", params={"q": "cc"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn(made["id"], [item["id"] for item in response.json()["data"]])

    def test_rate_limit(self):
        self.obj(self.author, title="频率限制词", content={"body": "正文"})
        with mock.patch("modules.search.router.SEARCH_RATE_LIMIT", 2):
            self.assertEqual(self.reader.get("/api/search-all?q=频率限制").status_code, 200)
            self.assertEqual(self.reader.get("/api/search-all?q=频率限制").status_code, 200)
            response = self.reader.get("/api/search-all?q=频率限制")
        self.assertEqual(response.status_code, 429, response.text)
        self.assertIn("Retry-After", response.headers)

    def test_existing_module_searches_are_aggregated(self):
        problem = self.author.post("/api/kb/problems", headers=HDRS, json={
            "title": "并行聚合检索标记",
            "phenomenon": "运行后无法找到模块",
            "error_signature": "Cannot find module /tmp/search.js:42",
            "environments": [{"tool_key": "codex", "version": "1.0", "system": "macOS"}],
            "industry_key": "education",
            "root_cause": "入口路径错误",
            "solution_steps": ["改正入口路径"],
        })
        self.assertEqual(problem.status_code, 201, problem.text)
        response = self.author.get("/api/search-all", params={"q": "并行聚合检索", "kinds": "problem"})
        self.assertEqual(response.status_code, 200, response.text)
        hit = next(item for item in response.json()["data"] if item["id"] == problem.json()["data"]["id"])
        self.assertEqual(hit["meta"]["sources"], ["core", "kb"])

        item = self.author.post("/api/library/items", headers=HDRS, json={
            "type": "skill",
            "title": "并行资源协议",
            "category": "编程",
            "tags": ["检索"],
            "clients_or_stacks": ["Codex"],
            "license": "示例",
            "content": {"purpose": "验证模块聚合", "skill_md": "# Search\n并行资源协议"},
            "examples": [{"input": "搜索", "output": "找到资源"}],
            "installs": [{"client": "Codex", "instructions": "保存为 SKILL.md"}],
        })
        self.assertEqual(item.status_code, 201, item.text)
        response = self.author.get("/api/search-all", params={"q": "并行资源协议", "kinds": "skill"})
        self.assertEqual(response.status_code, 200, response.text)
        hit = next(result for result in response.json()["data"] if result["id"] == item.json()["data"]["id"])
        self.assertEqual(hit["meta"]["sources"], ["core", "library"])

