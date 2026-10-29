"""R17-E · 文库收藏（复用内容收藏）、评论（复用内容回复）、翻页。前端假数据的形状以这里断言的为准。"""
from app.authz import Actor
from modules.library import router as lib_router
from tests.helpers import HDRS, AppCase

from modules.library.tests import test_library as base


class Helpers:
    payload = staticmethod(base.LibraryTest.payload)
    create_item = base.LibraryTest.create_item
    activate = base.LibraryTest.activate

    def setUp(self):
        super().setUp()
        self.author = self.user('lib_author', level=2)


class LibraryPaging(Helpers, AppCase):
    def seed(self, n, item_type="skill"):
        actor = Actor(id=self.author.pid, level=2, status="active")
        ids = []
        with self.db.write() as conn:
            for i in range(n):
                body = lib_router.ItemIn(**self.payload(item_type, f"批量 {i:03d}"))
                ids.append(lib_router.create_record(conn, actor, body, status="active"))
            # 发帖频率限制会把超出的几条改成待审；这里要的是 N 条都已上线的资源
            conn.execute("UPDATE object_head SET lifecycle = 'active' WHERE lifecycle != 'active'")
            conn.execute("UPDATE lib_item SET status = 'active'")
        return ids

    def test_list_pages_past_fifty_without_duplicates_or_gaps(self):
        ids = self.seed(57)
        reader = self.user("lib_pager", level=2)
        seen, cursor, pages = [], None, 0
        while True:
            params = {"type": "skill", "limit": 50}
            if cursor:
                params["cursor"] = cursor
            r = reader.get("/api/library/items", params=params)
            self.assertEqual(r.status_code, 200, r.text)
            seen += [x["id"] for x in r.json()["data"]]
            cursor = r.json()["meta"]["next_cursor"]
            pages += 1
            if not cursor:
                break
        self.assertEqual((pages, len(seen), len(set(seen))), (2, 57, 57))
        self.assertEqual(set(seen), set(ids))

    def test_first_page_has_cursor_only_when_more_exist(self):
        self.seed(3)
        reader = self.user("lib_pager2", level=2)
        r = reader.get("/api/library/items", params={"type": "skill", "limit": 50}).json()
        self.assertIsNone(r["meta"]["next_cursor"])
        r = reader.get("/api/library/items", params={"type": "skill", "limit": 2}).json()
        self.assertTrue(r["meta"]["next_cursor"])

    def test_used_sort_pages_stably(self):
        ids = self.seed(5)
        for i, uid in enumerate(ids[:3]):
            for j in range(3 - i):
                u = self.user(f"lib_user_{i}_{j}", level=2)
                u.post(f"/api/library/items/{uid}/used", headers=HDRS, json={"useful": True})
        reader = self.user("lib_pager3", level=2)
        got, cursor = [], None
        for _ in range(5):
            params = {"type": "skill", "sort": "used", "limit": 2}
            if cursor:
                params["cursor"] = cursor
            r = reader.get("/api/library/items", params=params).json()
            got += [x["id"] for x in r["data"]]
            cursor = r["meta"]["next_cursor"]
            if not cursor:
                break
        self.assertEqual(len(got), 5)
        self.assertEqual(len(set(got)), 5)
        self.assertEqual(got[:3], ids[:3])

    def test_cursor_is_bound_to_the_query_and_the_member(self):
        self.seed(4)
        a = self.user("lib_cur_a", level=2)
        b = self.user("lib_cur_b", level=2)
        cursor = a.get("/api/library/items", params={"type": "skill", "limit": 2}).json()["meta"]["next_cursor"]
        other_type = a.get("/api/library/items", params={"type": "prompt", "limit": 2, "cursor": cursor})
        self.assertEqual(other_type.status_code, 409)
        stolen = b.get("/api/library/items", params={"type": "skill", "limit": 2, "cursor": cursor})
        self.assertEqual(stolen.status_code, 409)

    def test_search_pages(self):
        self.seed(7)
        reader = self.user("lib_searcher", level=2)
        first = reader.get("/api/library/search", params={"q": "银杏协议", "type": "skill", "limit": 3}).json()
        self.assertEqual(len(first["data"]), 3)
        self.assertTrue(first["meta"]["next_cursor"])
        second = reader.get("/api/library/search", params={"q": "银杏协议", "type": "skill", "limit": 3,
                                                          "cursor": first["meta"]["next_cursor"]}).json()
        third = reader.get("/api/library/search", params={"q": "银杏协议", "type": "skill", "limit": 3,
                                                         "cursor": second["meta"]["next_cursor"]}).json()
        ids = [x["id"] for page in (first, second, third) for x in page["data"]]
        self.assertEqual((len(ids), len(set(ids))), (7, 7))
        self.assertIsNone(third["meta"]["next_cursor"])


class LibrarySaveAndComment(Helpers, AppCase):
    def setUp(self):
        super().setUp()
        item = self.create_item("prompt", "可收藏的提示词")
        self.activate(item["id"])
        self.item_id = item["id"]
        self.reader = self.user("lib_saver", level=2)

    def test_save_reuses_content_save_and_shows_up_in_detail_and_filter(self):
        d = self.reader.get(f"/api/library/items/{self.item_id}").json()["data"]
        self.assertIs(d["saved"], False)
        r = self.reader.put(f"/api/content/objects/{self.item_id}/save", headers=HDRS)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["data"], {"object_id": self.item_id, "saved": True})
        d = self.reader.get(f"/api/library/items/{self.item_id}").json()["data"]
        self.assertIs(d["saved"], True)
        rows = self.reader.get("/api/library/items", params={"type": "prompt", "saved": "true"}).json()["data"]
        self.assertEqual([x["id"] for x in rows], [self.item_id])
        self.assertTrue(rows[0]["saved"])
        other = self.user("lib_other", level=2)
        self.assertEqual(other.get("/api/library/items", params={"type": "prompt", "saved": "true"}).json()["data"], [])
        self.assertIs(other.get(f"/api/library/items/{self.item_id}").json()["data"]["saved"], False)
        r = self.reader.delete(f"/api/content/objects/{self.item_id}/save", headers=HDRS)
        self.assertEqual(r.json()["data"]["saved"], False)
        self.assertEqual(self.reader.get("/api/library/items", params={"type": "prompt", "saved": "true"}).json()["data"], [])

    def test_pending_item_cannot_be_saved(self):
        pending = self.create_item("prompt", "还在审核")
        r = self.reader.put(f"/api/content/objects/{pending['id']}/save", headers=HDRS)
        self.assertIn(r.status_code, (404, 409), r.text)

    def test_comments_reuse_content_replies(self):
        r = self.reader.post(f"/api/content/objects/{self.item_id}/replies", headers={**HDRS, "Idempotency-Key": "r17e-reply-01"},
                             json={"body": "这个提示词我用过，很顺手"})
        self.assertEqual(r.status_code, 201, r.text)
        listed = self.reader.get(f"/api/content/objects/{self.item_id}/replies", params={"order": "tree"})
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([m["body"] if "body" in m else m.get("excerpt") for m in listed.json()["data"]][0:1],
                         ["这个提示词我用过，很顺手"])
