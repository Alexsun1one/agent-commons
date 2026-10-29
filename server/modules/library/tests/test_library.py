import unittest
from pathlib import Path

from app import objects
from app.authz import Actor
from modules.library.seed.import_seed import FALLBACK_ITEMS, import_items, load_items
from tests.helpers import HDRS, AppCase


class LibraryTest(AppCase):
    def setUp(self):
        super().setUp()
        self.author = self.user("lib_author", level=2)

    @staticmethod
    def payload(item_type="skill", title="资源条目"):
        content = {
            "skill": {"purpose": "让改动可核验", "skill_md": "# Verify\n运行测试并报告结果。"},
            "prompt": {"use_when": "需要严谨评审时", "template": "检查 {target}", "variables": ["target"]},
            "component_lib": {"strengths": "清晰表单", "choose_when": "后台表单", "avoid_when": "三维画布",
                              "usage_code": "<button>保存</button>"},
            "pattern": {"use_when": "要保留产物时", "structure": "chat -> artifact",
                        "pitfalls": ["状态漂移"], "site_route": "#/workshop"},
        }[item_type]
        return {
            "type": item_type, "title": title, "category": "编程", "tags": ["验证", "Agent"],
            "clients_or_stacks": ["Codex"], "license": "示例", "content": content,
            "examples": [{"input": "检查接口", "output": "藏在示例里的检索词：银杏协议"}],
            "installs": ([{"client": "Codex", "instructions": "复制为 SKILL.md"}]
                         if item_type == "skill" else []),
        }

    def create_item(self, item_type="skill", title="资源条目", client=None, **changes):
        body = self.payload(item_type, title)
        body.update(changes)
        response = (client or self.author).post("/api/library/items", headers=HDRS, json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["data"]

    def activate(self, item_id):
        with self.db.write() as conn:
            objects.set_lifecycle(conn, self.author.pid, item_id, "active", "test_publish")
            conn.execute("UPDATE lib_item SET status = 'active' WHERE object_id = ?", (item_id,))

    def test_four_types_validate_and_store_structured_rows(self):
        for item_type in ("skill", "prompt", "component_lib", "pattern"):
            item = self.create_item(item_type, f"{item_type} 条目")
            self.assertEqual((item["type"], item["status"]), (item_type, "pending_review"))
        conn = self.db.conn()
        self.assertEqual(conn.execute("SELECT count(*) FROM lib_item").fetchone()[0], 4)
        self.assertEqual(conn.execute("SELECT count(*) FROM lib_example").fetchone()[0], 4)
        self.assertEqual(conn.execute("SELECT count(*) FROM lib_install").fetchone()[0], 1)

    def test_each_type_rejects_missing_oversized_and_unknown_content_fields(self):
        required = {
            "skill": ("skill_md", "skill_md"),
            "prompt": ("template", "template"),
            "component_lib": ("usage_code", "usage_code"),
            "pattern": ("structure", "structure"),
        }
        for item_type, (missing_key, code_key) in required.items():
            with self.subTest(item_type=item_type, case="missing"):
                missing = self.payload(item_type)
                missing["content"].pop(missing_key)
                response = self.author.post("/api/library/items", headers=HDRS, json=missing)
                self.assertEqual((response.status_code, self.code(response)), (422, "validation_failed"))
            with self.subTest(item_type=item_type, case="oversized"):
                oversized = self.payload(item_type)
                oversized["content"][code_key] = "x" * 50_001
                response = self.author.post("/api/library/items", headers=HDRS, json=oversized)
                self.assertEqual((response.status_code, self.code(response)), (422, "validation_failed"))
            with self.subTest(item_type=item_type, case="unknown"):
                unknown = self.payload(item_type)
                unknown["content"]["html"] = "<script>bad()</script>"
                response = self.author.post("/api/library/items", headers=HDRS, json=unknown)
                self.assertEqual((response.status_code, self.code(response)), (422, "unknown_field"))

    def test_l1_cannot_submit(self):
        newbie = self.user("lib_newbie", level=1)
        response = newbie.post("/api/library/items", headers=HDRS, json=self.payload())
        self.assertEqual((response.status_code, self.code(response)), (403, "action_not_allowed"))

    def test_list_filters_and_used_sort(self):
        first = self.create_item("skill", "第一项")
        second = self.create_item("skill", "第二项", category="设计", tags=["界面"])
        self.activate(first["id"])
        self.activate(second["id"])
        users = [self.user(f"lib_reader_{i}") for i in range(2)]
        for user in users:
            response = user.post(f"/api/library/items/{first['id']}/used", headers=HDRS, json={"useful": True})
            self.assertEqual(response.status_code, 200, response.text)
        response = users[0].post(f"/api/library/items/{second['id']}/used", headers=HDRS, json={"useful": False})
        self.assertEqual(response.status_code, 200, response.text)
        latest = users[0].get("/api/library/items", params={"type": "skill", "sort": "latest"}).json()["data"]
        self.assertEqual([item["id"] for item in latest[:2]], [second["id"], first["id"]])
        data = users[0].get("/api/library/items", params={"type": "skill", "sort": "used"}).json()["data"]
        self.assertEqual([item["id"] for item in data[:2]], [first["id"], second["id"]])
        filtered = users[0].get("/api/library/items", params={"category": "设计", "tag": "界面"}).json()["data"]
        self.assertEqual([item["id"] for item in filtered], [second["id"]])

    def test_search_indexes_example_text_and_hides_invisible_items(self):
        visible = self.create_item("prompt", "可见提示词")
        self.activate(visible["id"])
        outsider = self.user("lib_outsider")
        response = outsider.get("/api/library/search", params={"q": "银杏协议"})
        self.assertEqual([item["id"] for item in response.json()["data"]], [visible["id"]])
        hidden = self.create_item("prompt", "私有提示词", visibility="named", acl=[self.author.pid])
        self.activate(hidden["id"])
        self.assertEqual(outsider.get(f"/api/library/items/{hidden['id']}").status_code, 404)
        response = outsider.get("/api/library/search", params={"q": "银杏协议"})
        self.assertNotIn(hidden["id"], [item["id"] for item in response.json()["data"]])

    def test_used_is_one_row_per_person(self):
        item = self.create_item()
        for useful in (True, False, True):
            response = self.author.post(f"/api/library/items/{item['id']}/used", headers=HDRS,
                                        json={"useful": useful})
            self.assertEqual(response.status_code, 200, response.text)
        row = self.db.conn().execute("SELECT count(*) AS n, useful FROM lib_usage WHERE item_id = ?", (item["id"],)).fetchone()
        self.assertEqual((row["n"], row["useful"]), (1, 1))

    def test_author_edit_leaves_object_version(self):
        item = self.create_item()
        response = self.author.patch(
            f"/api/library/items/{item['id']}", headers={**HDRS, "If-Match": item["etag"]},
            json={"category": "自动化"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["data"]["version"], response.json()["data"]["category"]), (2, "自动化"))
        versions = self.db.conn().execute(
            "SELECT count(*) FROM object_version WHERE object_id = ?", (item["id"],)
        ).fetchone()[0]
        self.assertEqual(versions, 2)

    def test_non_author_cannot_edit_and_code_is_returned_as_plain_text(self):
        payload = self.payload()
        payload["content"]["skill_md"] = "# 文本\n<script>never-run()</script>"
        response = self.author.post("/api/library/items", headers=HDRS, json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        item = response.json()["data"]
        self.assertEqual(item["content"]["skill_md"], payload["content"]["skill_md"])
        self.activate(item["id"])
        other = self.user("lib_other_editor", level=2)
        response = other.patch(
            f"/api/library/items/{item['id']}", headers={**HDRS, "If-Match": item["etag"]},
            json={"category": "越权修改"},
        )
        self.assertEqual((response.status_code, self.code(response)), (403, "action_not_allowed"))

    def test_fallback_seed_imports_all_four_types_into_test_db(self):
        actor = Actor(id=self.author.pid, level=2, status="active")
        created = import_items(self.db, actor)
        self.assertEqual(len(created), len(FALLBACK_ITEMS))
        rows = self.db.conn().execute(
            "SELECT type, status FROM lib_item WHERE object_id IN (%s) ORDER BY type" % ",".join("?" * len(created)),
            created,
        ).fetchall()
        self.assertEqual({row["type"] for row in rows}, {"skill", "prompt", "component_lib", "pattern"})
        self.assertTrue(all(row["status"] == "active" for row in rows))

    def test_lib1_javascript_samples_are_mapped_and_imported(self):
        sample = Path(__file__).resolve().parents[4] / "preview" / "library-sample.js"
        items = load_items(sample)
        self.assertEqual((len(items), {item["type"] for item in items}),
                         (56, {"skill", "prompt", "component_lib", "pattern"}))
        actor = Actor(id=self.author.pid, level=2, status="active")
        created = import_items(self.db, actor, sample)
        self.assertEqual(len(created), 56)
        skill = self.db.conn().execute(
            "SELECT v.content_json FROM object_head h JOIN object_version v ON v.object_id = h.id "
            "AND v.version = h.current_version WHERE h.type = 'skill' ORDER BY h.created_at LIMIT 1"
        ).fetchone()[0]
        self.assertIn("完整 SKILL.md", skill)


if __name__ == "__main__":
    unittest.main()
