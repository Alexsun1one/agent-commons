"""Permission-aware API for the structured resource library."""

from __future__ import annotations

import json
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, ConfigDict, Field

from app import audit, clock, flags, fts, idempotency, objects, outbox, pagination
from app.authz import require, visible_predicate
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import ApiError

from . import hooks, schemas  # noqa: F401


router = APIRouter(prefix="/api/library")

for _item_type in schemas.ITEM_TYPES:
    objects.register_type(_item_type, schemas.validator(_item_type), schemas.text)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExampleIn(Strict):
    input: str = Field(default="", max_length=schemas.MAX_TEXT)
    output: str = Field(default="", max_length=schemas.MAX_TEXT)
    comparison_bad: str = Field(default="", max_length=schemas.MAX_TEXT)
    comparison_good: str = Field(default="", max_length=schemas.MAX_TEXT)
    caption: str = Field(default="", max_length=1000)


class InstallIn(Strict):
    client: str = Field(min_length=1, max_length=80)
    instructions: str = Field(min_length=1, max_length=schemas.MAX_CODE)


class ItemIn(Strict):
    type: Literal["skill", "prompt", "component_lib", "pattern"]
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=80)
    tags: list[str] = Field(default_factory=list, max_length=12)
    clients_or_stacks: list[str] = Field(default_factory=list, max_length=12)
    license: str = Field(default="", max_length=80)
    content: dict
    examples: list[ExampleIn] = Field(min_length=1, max_length=schemas.MAX_LIST)
    installs: list[InstallIn] = Field(default_factory=list, max_length=schemas.MAX_LIST)
    visibility: str = "members"
    min_level: int = 1
    space_id: Optional[str] = Field(default=None, max_length=64)
    acl: list[str] = Field(default_factory=list, max_length=50)


class ItemPatch(Strict):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, min_length=1, max_length=80)
    tags: Optional[list[str]] = Field(default=None, max_length=12)
    clients_or_stacks: Optional[list[str]] = Field(default=None, max_length=12)
    license: Optional[str] = Field(default=None, max_length=80)
    content: Optional[dict] = None
    examples: Optional[list[ExampleIn]] = Field(default=None, min_length=1, max_length=schemas.MAX_LIST)
    installs: Optional[list[InstallIn]] = Field(default=None, max_length=schemas.MAX_LIST)


class UsageIn(Strict):
    useful: bool = True


def _gate(conn):
    flags.gate(conn, "library.enabled")


def _dicts(items):
    return [item.model_dump() if isinstance(item, BaseModel) else dict(item) for item in items]


def _content_from_body(body):
    return schemas.stored_content(
        body.type,
        category=body.category,
        tags=body.tags,
        clients_or_stacks=body.clients_or_stacks,
        license_name=body.license,
        examples=_dicts(body.examples),
        installs=_dicts(body.installs),
        content=body.content,
    )


def _sync_rows(conn, object_id, item_type, content, status, *, replace=False):
    now = clock.now()
    if replace:
        conn.execute(
            "UPDATE lib_item SET category = ?, tags_json = ?, clients_or_stacks_json = ?, license = ?, "
            "status = ?, updated_at = ? WHERE object_id = ?",
            (content["category"], json.dumps(content["tags"], ensure_ascii=False),
             json.dumps(content["clients_or_stacks"], ensure_ascii=False), content["license"], status, now,
             object_id),
        )
        conn.execute("DELETE FROM lib_example WHERE item_id = ?", (object_id,))
        conn.execute("DELETE FROM lib_install WHERE item_id = ?", (object_id,))
    else:
        conn.execute(
            "INSERT INTO lib_item (object_id, type, category, tags_json, clients_or_stacks_json, license, status, "
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (object_id, item_type, content["category"], json.dumps(content["tags"], ensure_ascii=False),
             json.dumps(content["clients_or_stacks"], ensure_ascii=False), content["license"], status, now, now),
        )
    conn.executemany(
        "INSERT INTO lib_example (id, item_id, position, input_text, output_text, comparison_bad, comparison_good, "
        "caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(str(uuid.uuid4()), object_id, position, example["input"], example["output"],
          example["comparison_bad"], example["comparison_good"], example["caption"], now)
         for position, example in enumerate(content["examples"])],
    )
    conn.executemany(
        "INSERT INTO lib_install (id, item_id, client, position, instructions, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [(str(uuid.uuid4()), object_id, install["client"], position, install["instructions"], now)
         for position, install in enumerate(content["installs"])],
    )


def _stored(conn, object_id):
    row = conn.execute(
        "SELECT v.content_json FROM object_head h JOIN object_version v ON v.object_id = h.id "
        "AND v.version = h.current_version WHERE h.id = ?", (object_id,),
    ).fetchone()
    if row is None:
        raise ApiError("resource_not_found")
    return json.loads(row["content_json"])


def _detail(conn, actor, object_id, version=None):
    _, data = objects.detail(conn, actor, object_id, version)
    item = conn.execute("SELECT * FROM lib_item WHERE object_id = ?", (object_id,)).fetchone()
    if item is None or data["type"] not in schemas.ITEM_TYPES:
        raise ApiError("resource_not_found")
    content = data.pop("content")
    data.update({
        "category": content["category"],
        "tags": content["tags"],
        "clients_or_stacks": content["clients_or_stacks"],
        "license": content["license"],
        "status": item["status"],
        "examples": content["examples"],
        "installs": content["installs"],
        "content": schemas.public_content(content),
    })
    usage = conn.execute(
        "SELECT count(*) AS uses, coalesce(sum(useful), 0) AS useful FROM lib_usage WHERE item_id = ?", (object_id,),
    ).fetchone()
    own = conn.execute(
        "SELECT useful FROM lib_usage WHERE item_id = ? AND principal_id = ?", (object_id, actor.id),
    ).fetchone()
    data["usage"] = {"count": usage["uses"], "useful_count": usage["useful"],
                     "mine": None if own is None else bool(own["useful"])}
    data["saved"] = _is_saved(conn, actor, object_id)
    return data


def _is_saved(conn, actor, object_id):
    """收藏复用内容模块的 content_save（PUT/DELETE /api/content/objects/{id}/save）；这里只读，给列表和详情带 saved。"""
    if not actor.authenticated:
        return False
    try:
        return conn.execute("SELECT 1 FROM content_save WHERE principal_id = ? AND object_id = ?",
                            (actor.id, object_id)).fetchone() is not None
    except Exception:  # content 模块没装时没有这张表
        return False


def create_record(conn, actor, body, request_id=None, *, status="pending_review"):
    """Create an API submission or an active seed inside the caller's transaction."""
    _gate(conn)
    require(conn, actor, "library.submit")
    content = _content_from_body(body)
    lifecycle = "active" if status == "active" else "draft"
    object_id = objects.create(
        conn, actor, type=body.type, title=body.title, content=content, visibility=body.visibility,
        min_level=body.min_level, space_id=body.space_id, acl=body.acl, lifecycle=lifecycle,
        request_id=request_id,
    )
    if status == "pending_review":
        objects.set_lifecycle(conn, actor.id, object_id, "pending_review", "library_submission", request_id)
    _sync_rows(conn, object_id, body.type, content, status)
    outbox.emit(
        conn, "library.submitted" if status == "pending_review" else "library.seeded", "library_item", object_id,
        {"type": body.type, "status": status}, version=1, actor_id=actor.id, request_id=request_id,
    )
    audit.record(conn, actor.id, "library.submit", "library_item", object_id, request_id=request_id,
                 meta={"type": body.type, "status": status})
    return object_id


@router.post("/items", status_code=201)
def submit_item(body: ItemIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        object_id = create_record(conn, ctx.actor, body, ctx.request_id)
        data = _detail(conn, ctx.actor, object_id)
        return 201, ok(ctx, data, etag=data["etag"])

    return idempotency.run(ctx, payload, work)


@router.get("/items")
def list_items(type: Optional[Literal["skill", "prompt", "component_lib", "pattern"]] = None,
               category: Optional[str] = Query(default=None, max_length=80),
               tag: Optional[str] = Query(default=None, max_length=32),
               sort: Literal["latest", "used"] = "latest", saved: bool = False,
               limit: int = Query(default=20, ge=1, le=50), cursor: Optional[str] = None,
               ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn)
    qhash = pagination.query_hash("library.items", type, category, tag, sort, saved)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    pred = visible_predicate(ctx.actor)
    where, params = [pred.sql], dict(pred.params)
    for name, value, column in (("type", type, "li.type"), ("category", category, "li.category")):
        if value is not None:
            where.append(f"{column} = :{name}")
            params[name] = value
    if tag is not None:
        where.append("EXISTS (SELECT 1 FROM json_each(li.tags_json) WHERE value = :tag)")
        params["tag"] = tag
    if saved:
        where.append("EXISTS (SELECT 1 FROM content_save cs WHERE cs.object_id = h.id AND cs.principal_id = :me)")
        params["me"] = ctx.actor.id
    having, order = "", "h.created_at DESC, h.id DESC"
    if sort == "used":
        order = "usage_count DESC, h.created_at DESC, h.id DESC"
    if after:
        if sort == "used":
            having = " HAVING (count(lu.id), h.created_at, h.id) < (:c_n, :c_at, :c_id)"
            params.update(c_n=after[0], c_at=after[1], c_id=after[2])
        else:
            where.append("(h.created_at, h.id) < (:c_at, :c_id)")
            params.update(c_at=after[0], c_id=after[1])
    rows = conn.execute(
        "SELECT h.id, h.created_at, count(lu.id) AS usage_count FROM lib_item li JOIN object_head h ON h.id = li.object_id "
        "LEFT JOIN lib_usage lu ON lu.item_id = li.object_id WHERE " + " AND ".join(where) +
        f" GROUP BY h.id{having} ORDER BY {order} LIMIT :limit", {**params, "limit": limit + 1},
    ).fetchall()
    rows, next_cursor = pagination.page(
        ctx.settings, ctx.actor.id, qhash, rows, limit,
        lambda row: [row["usage_count"], row["created_at"], row["id"]] if sort == "used" else [row["created_at"], row["id"]])
    return ok(ctx, [_detail(conn, ctx.actor, row["id"]) for row in rows], next_cursor=next_cursor)


@router.get("/items/{item_id}")
def get_item(item_id: str, version: Optional[int] = Query(default=None, ge=1), ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn)
    data = _detail(conn, ctx.actor, item_id, version)
    return ok(ctx, data, etag=data["etag"])


@router.get("/search")
def search_items(q: str = Query(min_length=1, max_length=100),
                 type: Optional[Literal["skill", "prompt", "component_lib", "pattern"]] = None,
                 category: Optional[str] = Query(default=None, max_length=80),
                 tag: Optional[str] = Query(default=None, max_length=32),
                 limit: int = Query(default=20, ge=1, le=50), cursor: Optional[str] = None,
                 ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn)
    expression = fts.match_expression(q.strip())
    if not expression:
        return ok(ctx, [], next_cursor=None)
    qhash = pagination.query_hash("library.search", q.strip(), type, category, tag)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    offset = int(after[0]) if after else 0
    pred = visible_predicate(ctx.actor)
    where = ["search_fts MATCH :q", pred.sql]
    params = {"q": expression, **pred.params}
    for name, value, column in (("type", type, "li.type"), ("category", category, "li.category")):
        if value is not None:
            where.append(f"{column} = :{name}")
            params[name] = value
    if tag is not None:
        where.append("EXISTS (SELECT 1 FROM json_each(li.tags_json) WHERE value = :tag)")
        params["tag"] = tag
    rows = conn.execute(
        "SELECT h.id FROM search_fts JOIN object_head h ON h.doc_no = search_fts.rowid "
        "JOIN lib_item li ON li.object_id = h.id WHERE " + " AND ".join(where) +
        " ORDER BY bm25(search_fts, 4.0, 1.0), h.id LIMIT :limit OFFSET :offset",
        {**params, "limit": limit + 1, "offset": offset},
    ).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = pagination.encode(ctx.settings, ctx.actor.id, qhash, [offset + limit]) if more else None
    return ok(ctx, [_detail(conn, ctx.actor, row["id"]) for row in rows], next_cursor=next_cursor)


@router.patch("/items/{item_id}")
def edit_item(item_id: str, body: ItemPatch, if_match: Optional[str] = Header(default=None),
              ctx: Ctx = Depends(write_ctx)):
    changes = body.model_dump(exclude_unset=True)

    def work(conn):
        _gate(conn)
        row = objects.load_visible(conn, ctx.actor, item_id)
        item = conn.execute("SELECT * FROM lib_item WHERE object_id = ?", (item_id,)).fetchone()
        if item is None or row["type"] not in schemas.ITEM_TYPES:
            raise ApiError("resource_not_found")
        require(conn, ctx.actor, "library.edit", dict(row))
        current = _stored(conn, item_id)
        specific = schemas.public_content(current) if body.content is None else body.content
        content = schemas.stored_content(
            row["type"],
            category=current["category"] if body.category is None else body.category,
            tags=current["tags"] if body.tags is None else body.tags,
            clients_or_stacks=(current["clients_or_stacks"] if body.clients_or_stacks is None
                               else body.clients_or_stacks),
            license_name=current["license"] if body.license is None else body.license,
            examples=current["examples"] if body.examples is None else _dicts(body.examples),
            installs=current["installs"] if body.installs is None else _dicts(body.installs),
            content=specific,
        )
        object_changes = {"content": content}
        if body.title is not None:
            object_changes["title"] = body.title
        updated = objects.update(conn, ctx.actor, row, object_changes, if_match, ctx.request_id)
        _sync_rows(conn, item_id, row["type"], content, item["status"], replace=True)
        outbox.emit(conn, "library.updated", "library_item", item_id, {"type": row["type"]},
                    version=updated["current_version"], actor_id=ctx.actor.id, request_id=ctx.request_id)
        audit.record(conn, ctx.actor.id, "library.edit", "library_item", item_id, request_id=ctx.request_id,
                     meta={"version": updated["current_version"]})
        data = _detail(conn, ctx.actor, item_id)
        return 200, ok(ctx, data, etag=data["etag"])

    return idempotency.run(ctx, changes, work)


@router.post("/items/{item_id}/used")
def mark_used(item_id: str, body: UsageIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _gate(conn)
        objects.load_visible(conn, ctx.actor, item_id)
        if conn.execute("SELECT 1 FROM lib_item WHERE object_id = ?", (item_id,)).fetchone() is None:
            raise ApiError("resource_not_found")
        require(conn, ctx.actor, "library.use")
        now = clock.now()
        conn.execute(
            "INSERT INTO lib_usage (id, item_id, principal_id, useful, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(item_id, principal_id) DO UPDATE SET useful = excluded.useful, "
            "updated_at = excluded.updated_at",
            (str(uuid.uuid4()), item_id, ctx.actor.id, int(body.useful), now, now),
        )
        outbox.emit(conn, "library.used", "library_item", item_id, {"useful": body.useful},
                    actor_id=ctx.actor.id, request_id=ctx.request_id)
        audit.record(conn, ctx.actor.id, "library.use", "library_item", item_id, request_id=ctx.request_id,
                     meta={"useful": body.useful})
        return 200, ok(ctx, _detail(conn, ctx.actor, item_id)["usage"])

    return idempotency.run(ctx, payload, work)

