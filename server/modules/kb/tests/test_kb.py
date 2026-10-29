import unittest

from modules.kb.signature import digest, normalize
from tests.helpers import HDRS, AppCase


class SignatureTest(unittest.TestCase):
    def test_machine_specific_fragments_collapse_across_error_families(self):
        pairs = [
            (
                "Traceback /Users/alice/app/main.py:42 line 42 RuntimeError: socket closed at 2026-10-25T12:34:56Z",
                "Traceback /home/bob/src/main.py:991 line 991 RuntimeError: socket closed at 2026-10-26T08:01:02Z",
            ),
            ("TypeError at C:\\Users\\alice\\app.js:19:7 id 123456", "TypeError at D:\\work\\app.js:82:3 id 998877"),
            ("thread 'main' panicked at /home/a/src/lib.rs:22:5 address 0x7ffee7a12abc", "thread 'main' panicked at /tmp/b/src/lib.rs:77:2 address 0x7fff1122aabb"),
            ("panic: dial tcp /home/alice/go/src/main.go:31 request 20231", "panic: dial tcp /Users/bob/go/src/main.go:98 request 90210"),
            ("Uncaught RangeError app.js:222:17 user=alice", "Uncaught RangeError app.js:19:3 user=bob"),
            ("fatal: command failed for @alice at 13:42:09 code 88001", "fatal: command failed for @bob at 21:02:33 code 99119"),
        ]
        for left, right in pairs:
            with self.subTest(left=left):
                self.assertEqual(digest(left), digest(right))
                self.assertEqual(normalize(left), normalize(right))


class KBApiTest(AppCase):
    def problem(self, client, **overrides):
        body = {
            "title": "Node 构建时找不到模块",
            "phenomenon": "运行构建命令后退出",
            "error_signature": "Cannot find module /Users/alice/app/index.js:42",
            "environments": [{"tool_key": "codex", "version": "1.0", "system": "macOS"}],
            "industry_key": "education",
            "root_cause": "入口路径错误",
            "solution_steps": ["改正入口路径", "重新构建"],
        }
        body.update(overrides)
        response = client.post("/api/kb/problems", headers=HDRS, json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["data"]

    def test_create_detail_search_and_exact_similar(self):
        author = self.user("kb_author")
        made = self.problem(author)
        self.assertEqual(made["status"], "pending")
        self.assertEqual(made["solutions"][0]["steps"], ["改正入口路径", "重新构建"])
        similar = author.post("/api/kb/similar", headers=HDRS, json={
            "text": "Cannot find module /home/bob/app/index.js:991"
        })
        self.assertEqual(similar.status_code, 200, similar.text)
        self.assertEqual(similar.json()["data"][0]["id"], made["id"])
        self.assertEqual(similar.json()["data"][0]["match_reason"], "signature")
        search = author.get("/api/kb/search?tool_key=codex&industry_key=education&status=pending")
        self.assertEqual([item["id"] for item in search.json()["data"]], [made["id"]])
        detail = author.get(f"/api/kb/problems/{made['id']}")
        self.assertEqual(detail.headers["ETag"], made["etag"])

    def test_invisible_problem_never_appears_in_similar(self):
        author = self.user("kb_private")
        outsider = self.user("kb_outsider")
        hidden = self.problem(author, visibility="named", acl=[author.pid])
        result = outsider.post("/api/kb/similar", headers=HDRS, json={
            "text": "Cannot find module /home/out/app/index.js:33"
        })
        self.assertEqual(result.status_code, 200, result.text)
        self.assertNotIn(hidden["id"], [item["id"] for item in result.json()["data"]])
        self.assertEqual(outsider.get(f"/api/kb/problems/{hidden['id']}").status_code, 404)

    def test_capture_confirmation_creates_problem_once(self):
        author = self.user("kb_capture")
        capture = author.post("/api/kb/captures", headers=HDRS, json={
            "source_kind": "discussion", "source_id": "thread-17", "title": "Python 启动失败",
            "phenomenon": "启动立即退出", "error_signature": "ValueError at /tmp/a.py:12",
            "answer_text": "修正配置文件",
        })
        self.assertEqual(capture.status_code, 201, capture.text)
        capture_id = capture.json()["data"]["id"]
        confirmed = author.post(f"/api/kb/captures/{capture_id}/confirm", headers=HDRS, json={
            "solution_steps": ["修正配置文件"],
            "environments": [{"tool_key": "claude-code", "version": "2", "system": "Linux"}],
        })
        self.assertEqual(confirmed.status_code, 201, confirmed.text)
        problem_id = confirmed.json()["data"]["id"]
        replay = author.post(f"/api/kb/captures/{capture_id}/confirm", headers=HDRS, json={
            "solution_steps": ["修正配置文件"],
            "environments": [{"tool_key": "claude-code", "version": "2", "system": "Linux"}],
        })
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["data"]["id"], problem_id)
        self.assertEqual(self.db.conn().execute("SELECT count(*) FROM kb_problem").fetchone()[0], 1)

    def test_three_successful_distinct_environments_mark_verified(self):
        author = self.user("kb_verify_owner")
        problem = self.problem(author)
        reporters = [self.user(f"kb_verify_{i}") for i in range(3)]
        envs = [
            {"tool_key": "codex", "version": "1", "system": "macOS"},
            {"tool_key": "codex", "version": "1", "system": "Linux"},
            {"tool_key": "claude-code", "version": "2", "system": "Windows"},
        ]
        for reporter, env in zip(reporters, envs):
            response = reporter.post(f"/api/kb/problems/{problem['id']}/verify", headers=HDRS,
                                     json={**env, "success": True, "note": "已复现"})
            self.assertEqual(response.status_code, 200, response.text)
        detail = author.get(f"/api/kb/problems/{problem['id']}").json()["data"]
        self.assertEqual(detail["status"], "verified")
        self.assertEqual(detail["verification"]["environment_count"], 3)

    def test_duplicate_link_points_to_visible_canonical_problem(self):
        author = self.user("kb_linker")
        duplicate = self.problem(author, title="重复问题")
        canonical = self.problem(author, title="标准问题", error_signature="A different error 444")
        linked = author.post(f"/api/kb/problems/{duplicate['id']}/links", headers=HDRS, json={
            "target_id": canonical["id"], "kind": "duplicate"
        })
        self.assertEqual(linked.status_code, 201, linked.text)
        self.assertEqual(linked.json()["data"]["duplicate_of"], canonical["id"])
        self.assertEqual(linked.json()["data"]["links"][0]["target_title"], "标准问题")

    def test_edit_requires_etag_and_valid_lexicon_key(self):
        author = self.user("kb_editor")
        problem = self.problem(author)
        no_etag = author.patch(f"/api/kb/problems/{problem['id']}", headers=HDRS, json={"status": "stale"})
        self.assertEqual((no_etag.status_code, self.code(no_etag)), (428, "precondition_required"))
        headers = {**HDRS, "If-Match": problem["etag"]}
        updated = author.patch(f"/api/kb/problems/{problem['id']}", headers=headers,
                               json={"status": "stale", "stale_hint": True})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["data"]["status"], "stale")
        invalid = author.post("/api/kb/problems", headers=HDRS, json={
            "title": "坏标签", "phenomenon": "标签不存在", "environments": [{"tool_key": "made-up"}]
        })
        self.assertEqual((invalid.status_code, self.code(invalid)), (422, "validation_failed"))
