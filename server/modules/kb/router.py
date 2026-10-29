"""Structured, permission-aware problem knowledge base API."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import uuid
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app import audit, clock, flags, fts, idempotency, objects, outbox
from app.authz import require, visible_predicate
from app.context import Ctx, ok, user_ctx, write_ctx
from app.errors import ApiError

from . import hooks  # noqa: F401
from .signature import signature


router = APIRouter(prefix="/api/kb")


def _load_lexicon():
    path = Path(__file__).resolve().parents[3] / "tools" / "drift_lexicon.py"
    spec = importlib.util.spec_from_file_location("commons_kb_drift_lexicon", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load drift lexicon")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_lexicon_module = _load_lexicon()
LEXICON = _lexicon_module.Lexicon()
TOOL_KEYS = frozenset(e["key"] for e in _lexicon_module.APPS)
INDUSTRY_KEYS = frozenset(e["key"] for e in _lexicon_module.INDUSTRIES)
STATUSES = {"pending", "verified", "stale"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:T.*Z)?$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EnvIn(Strict):
    tool_key: str = Field(min_length=1, max_length=64)
    version: str = Field(default="", max_length=80)
    system: str = Field(default="", max_length=120)


class ProblemIn(Strict):
    title: str = Field(min_length=1, max_length=200)
    phenomenon: str = Field(min_length=1, max_length=20_000)
    error_signature: str = Field(default="", max_length=20_000)
    environments: list[EnvIn] = Field(default_factory=list, max_length=20)
    industry_key: Optional[str] = Field(default=None, max_length=64)
    root_cause: str = Field(default="", max_length=30_000)
    solution_steps: list[str] = Field(default_factory=list, max_length=50)
    status: Literal["pending", "verified", "stale"] = "pending"
    stale_hint: bool = False
    visibility: str = "members"
    min_level: int = 1
    space_id: Optional[str] = Field(default=None, max_length=64)
    acl: list[str] = Field(default_factory=list, max_length=50)


class ProblemPatch(Strict):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    phenomenon: Optional[str] = Field(default=None, min_length=1, max_length=20_000)
    error_signature: Optional[str] = Field(default=None, max_length=20_000)
    environments: Optional[list[EnvIn]] = Field(default=None, max_length=20)
    industry_key: Optional[str] = Field(default=None, max_length=64)
    status: Optional[Literal["pending", "verified", "stale"]] = None
    stale_hint: Optional[bool] = None
    visibility: Optional[str] = None
    min_level: Optional[int] = None
    space_id: Optional[str] = Field(default=None, max_length=64)
    acl: Optional[list[str]] = Field(default=None, max_length=50)


class SolutionIn(Strict):
    root_cause: str = Field(min_length=1, max_length=30_000)
    steps: list[str] = Field(min_length=1, max_length=50)


class VerificationIn(Strict):
    tool_key: str = Field(min_length=1, max_length=64)
    version: str = Field(default="", max_length=80)
    system: str = Field(default="", max_length=120)
    success: bool
    note: str = Field(default="", max_length=2000)


class LinkIn(Strict):
    target_id: str = Field(min_length=1, max_length=64)
    kind: Literal["duplicate", "related", "replacement"]


class SimilarIn(Strict):
    text: str = Field(min_length=1, max_length=20_000)


class CaptureIn(Strict):
    source_kind: Literal["discussion", "bounty"]
    source_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=200)
    phenomenon: str = Field(min_length=1, max_length=20_000)
    error_signature: str = Field(default="", max_length=20_000)
    answer_text: str = Field(default="", max_length=30_000)


class CaptureConfirm(Strict):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    phenomenon: Optional[str] = Field(default=None, min_length=1, max_length=20_000)
    error_signature: Optional[str] = Field(default=None, max_length=20_000)
    root_cause: str = Field(default="", max_length=30_000)
    solution_steps: list[str] = Field(default_factory=list, max_length=50)
    environments: list[EnvIn] = Field(default_factory=list, max_length=20)
    industry_key: Optional[str] = Field(default=None, max_length=64)
    visibility: str = "members"
    min_level: int = 1
    space_id: Optional[str] = Field(default=None, max_length=64)
    acl: list[str] = Field(default_factory=list, max_length=50)


def validate_problem_content(content):
    if not isinstance(content, dict):
        raise ApiError("validation_failed", "problem content 必须是对象")
    allowed = {"phenomenon", "error_signature", "industry_key", "tools"}
    unknown = set(content) - allowed
    if unknown:
        raise ApiError("unknown_field", f"problem content 不认识的字段：{', '.join(sorted(unknown))}")
    phenomenon = content.get("phenomenon")
    error = content.get("error_signature", "")
    tools = content.get("tools", [])
    if not isinstance(phenomenon, str) or not 1 <= len(phenomenon.strip()) <= 20_000:
        raise ApiError("validation_failed", "现象要有 1 到 20000 个字")
    if not isinstance(error, str) or len(error) > 20_000:
        raise ApiError("validation_failed", "报错特征不超过 20000 个字")
    if not isinstance(tools, list) or len(tools) > 20 or any(t not in TOOL_KEYS for t in tools):
        raise ApiError("validation_failed", "环境工具必须使用 drift_lexicon.py 的 key")
    industry = content.get("industry_key")
    if industry is not None and industry not in INDUSTRY_KEYS:
        raise ApiError("validation_failed", "行业必须使用 drift_lexicon.py 的 key")
    return {
        "phenomenon": phenomenon.strip(),
        "error_signature": error.strip(),
        "industry_key": industry,
        "tools": sorted(set(tools)),
    }


def problem_text(content):
    return "\n".join([
        content.get("phenomenon", ""),
        content.get("error_signature", ""),
        content.get("industry_key") or "",
        " ".join(content.get("tools", [])),
    ]).strip()


objects.register_type("problem", validate_problem_content, problem_text)


def _gate(conn):
    flags.gate(conn, "kb.enabled")


def _validate_taxonomy(industry_key, environments):
    if industry_key is not None and industry_key not in INDUSTRY_KEYS:
        raise ApiError("validation_failed", "行业必须使用 drift_lexicon.py 的 key")
    for env in environments:
        tool_key = env.tool_key if isinstance(env, EnvIn) else env.get("tool_key")
        if tool_key not in TOOL_KEYS:
            raise ApiError("validation_failed", f"不认识的工具 key：{tool_key}")


def _env_dict(env):
    return env.model_dump() if isinstance(env, BaseModel) else dict(env)


def _content(phenomenon, error_signature, industry_key, environments):
    return validate_problem_content({
        "phenomenon": phenomenon,
        "error_signature": error_signature,
        "industry_key": industry_key,
        "tools": sorted({e.tool_key if isinstance(e, EnvIn) else e["tool_key"] for e in environments}),
    })


def _replace_envs(conn, problem_id, environments):
    conn.execute("DELETE FROM kb_env WHERE problem_id = ?", (problem_id,))
    now = clock.now()
    rows = []
    seen = set()
    for source in environments:
        env = _env_dict(source)
        key = (env["tool_key"], env.get("version", "").strip(), env.get("system", "").strip())
        if key in seen:
            continue
        seen.add(key)
        rows.append((str(uuid.uuid4()), problem_id, *key, now))
    conn.executemany(
        "INSERT INTO kb_env (id, problem_id, tool_key, version, system, created_at) VALUES (?, ?, ?, ?, ?, ?)", rows
    )


def _insert_solution(conn, problem_id, actor_id, root_cause, steps):
    root_cause = root_cause.strip()
    cleaned = [step.strip() for step in steps if isinstance(step, str) and step.strip()]
    if not root_cause and not cleaned:
        return None
    if not root_cause or not cleaned or any(len(step) > 5000 for step in cleaned):
        raise ApiError("validation_failed", "解决方案需要根因和至少一个不超过 5000 字的步骤")
    version = conn.execute(
        "SELECT coalesce(max(version), 0) + 1 FROM kb_solution WHERE problem_id = ?", (problem_id,)
    ).fetchone()[0]
    solution_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO kb_solution (id, problem_id, root_cause, steps_json, version, author_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (solution_id, problem_id, root_cause, json.dumps(cleaned, ensure_ascii=False), version, actor_id, clock.now()),
    )
    return solution_id


def create_problem_record(conn, actor, data, request_id=None):
    """Create one problem and all structured rows in the caller's transaction."""
    environments = data.get("environments") or []
    industry_key = data.get("industry_key")
    _validate_taxonomy(industry_key, environments)
    require(conn, actor, "kb.create")
    phenomenon = data["phenomenon"].strip()
    error_raw = data.get("error_signature", "").strip()
    normalized, sig_hash = signature(error_raw or phenomenon)
    object_id = objects.create(
        conn,
        actor,
        type="problem",
        title=data["title"],
        content=_content(phenomenon, error_raw, industry_key, environments),
        visibility=data.get("visibility", "members"),
        min_level=data.get("min_level", 1),
        space_id=data.get("space_id"),
        acl=data.get("acl") or [],
        request_id=request_id,
    )
    now = clock.now()
    conn.execute(
        "INSERT INTO kb_problem (object_id, phenomenon, error_raw, error_normalized, signature_hash, status, "
        "stale_hint, industry_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (object_id, phenomenon, error_raw, normalized, sig_hash, data.get("status", "pending"),
         int(bool(data.get("stale_hint", False))), industry_key, now, now),
    )
    _replace_envs(conn, object_id, environments)
    _insert_solution(conn, object_id, actor.id, data.get("root_cause", ""), data.get("solution_steps") or [])
    outbox.emit(conn, "kb.problem.created", "problem", object_id, {"status": data.get("status", "pending")},
                actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, "kb.create", "problem", object_id, request_id=request_id)
    return object_id


def _visible_head(conn, actor, problem_id):
    row = objects.load_visible(conn, actor, problem_id)
    if row["type"] != "problem" or conn.execute(
        "SELECT 1 FROM kb_problem WHERE object_id = ?", (problem_id,)
    ).fetchone() is None:
        raise ApiError("resource_not_found")
    return row


def _summary(conn, actor, problem_id, score=None, reason=None):
    _visible_head(conn, actor, problem_id)
    row = conn.execute(
        "SELECT kp.*, v.title FROM kb_problem kp JOIN object_head h ON h.id = kp.object_id "
        "JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version WHERE kp.object_id = ?",
        (problem_id,),
    ).fetchone()
    envs = [dict(r) for r in conn.execute(
        "SELECT tool_key, version, system FROM kb_env WHERE problem_id = ? ORDER BY tool_key, version, system",
        (problem_id,),
    )]
    solved = conn.execute(
        "SELECT count(*) FROM kb_verification WHERE problem_id = ? AND success = 1", (problem_id,)
    ).fetchone()[0]
    data = {
        "id": row["object_id"], "title": row["title"], "phenomenon": row["phenomenon"],
        "error_signature": row["error_raw"], "status": row["status"], "stale_hint": bool(row["stale_hint"]),
        "industry_key": row["industry_key"], "environments": envs, "successful_verifications": solved,
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }
    if score is not None:
        data.update(score=round(score, 4), match_reason=reason)
    return data


def _detail(conn, actor, problem_id):
    head = _visible_head(conn, actor, problem_id)
    data = _summary(conn, actor, problem_id)
    _, object_data = objects.detail(conn, actor, problem_id)
    data.update(
        visibility=object_data["visibility"], min_level=object_data["min_level"], space_id=object_data["space_id"],
        author=object_data["author"], etag=object_data["etag"], version=object_data["version"],
    )
    data["solutions"] = [
        {**dict(row), "steps": json.loads(row["steps_json"])} for row in conn.execute(
            "SELECT id, root_cause, steps_json, version, author_id, created_at FROM kb_solution "
            "WHERE problem_id = ? ORDER BY version DESC", (problem_id,)
        )
    ]
    for solution in data["solutions"]:
        solution.pop("steps_json", None)
    verifications = conn.execute(
        "SELECT success, env_json FROM kb_verification WHERE problem_id = ?", (problem_id,)
    ).fetchall()
    distribution = {}
    for row in verifications:
        env = json.loads(row["env_json"])
        key = " / ".join(filter(None, (env.get("tool_key"), env.get("version"), env.get("system")))) or "未说明环境"
        slot = distribution.setdefault(key, {"environment": env, "success": 0, "failed": 0})
        slot["success" if row["success"] else "failed"] += 1
    data["verification"] = {
        "success": sum(1 for r in verifications if r["success"]),
        "failed": sum(1 for r in verifications if not r["success"]),
        "environment_count": len({json.dumps(json.loads(r["env_json"]), sort_keys=True) for r in verifications if r["success"]}),
        "distribution": list(distribution.values()),
    }
    pred = visible_predicate(actor, "th")
    data["links"] = [dict(row) for row in conn.execute(
        "SELECT kl.id, kl.kind, kl.target_problem_id AS target_id, tv.title AS target_title "
        "FROM kb_link kl JOIN object_head th ON th.id = kl.target_problem_id "
        "JOIN object_version tv ON tv.object_id = th.id AND tv.version = th.current_version "
        f"WHERE kl.problem_id = :problem_id AND {pred.sql} ORDER BY kl.kind, tv.title",
        {"problem_id": problem_id, **pred.params},
    )]
    data["duplicate_of"] = next((link["target_id"] for link in data["links"] if link["kind"] == "duplicate"), None)
    data["editable"] = head["author_id"] == actor.id or bool(actor.roles & {"admin", "governor"})
    return data


@router.post("/problems", status_code=201)
def create_problem(body: ProblemIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _gate(conn)
        object_id = create_problem_record(conn, ctx.actor, payload, ctx.request_id)
        data = _detail(conn, ctx.actor, object_id)
        return 201, ok(ctx, data, etag=data["etag"])

    return idempotency.run(ctx, payload, work)


@router.patch("/problems/{problem_id}")
def update_problem(problem_id: str, body: ProblemPatch, if_match: Optional[str] = Header(default=None),
                   ctx: Ctx = Depends(write_ctx)):
    changes = body.model_dump(exclude_unset=True)

    def work(conn):
        _gate(conn)
        head = _visible_head(conn, ctx.actor, problem_id)
        require(conn, ctx.actor, "kb.edit", dict(head))
        current = conn.execute("SELECT * FROM kb_problem WHERE object_id = ?", (problem_id,)).fetchone()
        envs = (changes.get("environments") if "environments" in changes else [
            dict(r) for r in conn.execute(
                "SELECT tool_key, version, system FROM kb_env WHERE problem_id = ?", (problem_id,)
            )
        ])
        envs = [EnvIn(**e) if isinstance(e, dict) else e for e in envs]
        industry = changes.get("industry_key", current["industry_key"])
        _validate_taxonomy(industry, envs)
        object_changes = {}
        if "title" in changes:
            object_changes["title"] = changes["title"]
        if any(k in changes for k in ("phenomenon", "error_signature", "industry_key", "environments")):
            object_changes["content"] = _content(
                changes.get("phenomenon", current["phenomenon"]),
                changes.get("error_signature", current["error_raw"]), industry, envs,
            )
        for key in ("visibility", "min_level", "space_id", "acl"):
            if key in changes:
                object_changes[key] = changes[key]
        if object_changes:
            head = objects.update(conn, ctx.actor, head, object_changes, if_match, ctx.request_id)
        elif not if_match or if_match != objects.etag(head):
            raise ApiError("precondition_required" if not if_match else "version_conflict")
        phenomenon = changes.get("phenomenon", current["phenomenon"])
        error_raw = changes.get("error_signature", current["error_raw"])
        normalized, sig_hash = signature(error_raw or phenomenon)
        conn.execute(
            "UPDATE kb_problem SET phenomenon = ?, error_raw = ?, error_normalized = ?, signature_hash = ?, "
            "status = ?, stale_hint = ?, industry_key = ?, updated_at = ? WHERE object_id = ?",
            (phenomenon, error_raw, normalized, sig_hash, changes.get("status", current["status"]),
             int(changes.get("stale_hint", bool(current["stale_hint"]))), industry, clock.now(), problem_id),
        )
        if "environments" in changes:
            _replace_envs(conn, problem_id, envs)
        audit.record(conn, ctx.actor.id, "kb.edit", "problem", problem_id, request_id=ctx.request_id)
        data = _detail(conn, ctx.actor, problem_id)
        return 200, ok(ctx, data, etag=data["etag"])

    return idempotency.run(ctx, changes, work)


@router.post("/problems/{problem_id}/solutions", status_code=201)
def add_solution(problem_id: str, body: SolutionIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _gate(conn)
        head = _visible_head(conn, ctx.actor, problem_id)
        require(conn, ctx.actor, "kb.solve", dict(head))
        solution_id = _insert_solution(conn, problem_id, ctx.actor.id, body.root_cause, body.steps)
        conn.execute("UPDATE kb_problem SET updated_at = ? WHERE object_id = ?", (clock.now(), problem_id))
        outbox.emit(conn, "kb.solution.added", "problem", problem_id, {"solution_id": solution_id},
                    actor_id=ctx.actor.id, request_id=ctx.request_id)
        audit.record(conn, ctx.actor.id, "kb.solve", "problem", problem_id, request_id=ctx.request_id)
        return 201, ok(ctx, _detail(conn, ctx.actor, problem_id))

    return idempotency.run(ctx, payload, work)


@router.post("/problems/{problem_id}/verify")
def verify_problem(problem_id: str, body: VerificationIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _gate(conn)
        _visible_head(conn, ctx.actor, problem_id)
        require(conn, ctx.actor, "kb.verify")
        _validate_taxonomy(None, [EnvIn(tool_key=body.tool_key, version=body.version, system=body.system)])
        env = {"tool_key": body.tool_key, "version": body.version.strip(), "system": body.system.strip()}
        encoded = json.dumps(env, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        fingerprint = hashlib.sha256(encoded.encode()).hexdigest()
        now = clock.now()
        existing = conn.execute(
            "SELECT id FROM kb_verification WHERE problem_id = ? AND principal_id = ?", (problem_id, ctx.actor.id)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE kb_verification SET env_json = ?, env_fingerprint = ?, success = ?, note = ?, updated_at = ? "
                "WHERE id = ?", (encoded, fingerprint, int(body.success), body.note.strip(), now, existing["id"]),
            )
        else:
            conn.execute(
                "INSERT INTO kb_verification (id, problem_id, principal_id, env_json, env_fingerprint, success, note, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), problem_id, ctx.actor.id, encoded, fingerprint, int(body.success),
                 body.note.strip(), now, now),
            )
        successful_envs = conn.execute(
            "SELECT count(DISTINCT env_fingerprint) FROM kb_verification WHERE problem_id = ? AND success = 1",
            (problem_id,),
        ).fetchone()[0]
        if successful_envs >= 3:
            conn.execute("UPDATE kb_problem SET status = 'verified', stale_hint = 0, updated_at = ? WHERE object_id = ?",
                         (now, problem_id))
        else:
            conn.execute("UPDATE kb_problem SET updated_at = ? WHERE object_id = ?", (now, problem_id))
        outbox.emit(conn, "kb.problem.verified", "problem", problem_id,
                    {"success": body.success, "successful_environments": successful_envs},
                    actor_id=ctx.actor.id, request_id=ctx.request_id)
        audit.record(conn, ctx.actor.id, "kb.verify", "problem", problem_id, request_id=ctx.request_id,
                     meta={"success": body.success})
        return 200, ok(ctx, _detail(conn, ctx.actor, problem_id))

    return idempotency.run(ctx, payload, work)


@router.post("/problems/{problem_id}/links", status_code=201)
def link_problem(problem_id: str, body: LinkIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _gate(conn)
        head = _visible_head(conn, ctx.actor, problem_id)
        _visible_head(conn, ctx.actor, body.target_id)
        require(conn, ctx.actor, "kb.link", dict(head))
        if body.target_id == problem_id:
            raise ApiError("validation_failed", "问题不能关联自己")
        if body.kind == "duplicate":
            conn.execute("DELETE FROM kb_link WHERE problem_id = ? AND kind = 'duplicate'", (problem_id,))
        link_id = str(uuid.uuid4())
        conn.execute(
            "INSERT OR IGNORE INTO kb_link (id, problem_id, target_problem_id, kind, created_by, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (link_id, problem_id, body.target_id, body.kind, ctx.actor.id, clock.now()),
        )
        outbox.emit(conn, "kb.problem.linked", "problem", problem_id,
                    {"target_id": body.target_id, "kind": body.kind}, actor_id=ctx.actor.id,
                    request_id=ctx.request_id)
        audit.record(conn, ctx.actor.id, "kb.link", "problem", problem_id, request_id=ctx.request_id,
                     meta={"kind": body.kind})
        return 201, ok(ctx, _detail(conn, ctx.actor, problem_id))

    return idempotency.run(ctx, payload, work)


@router.post("/similar")
def similar(body: SimilarIn, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn)
    normalized, sig_hash = signature(body.text)
    inferred = set(LEXICON.keys(body.text)) & TOOL_KEYS
    pred = visible_predicate(ctx.actor)
    exact = conn.execute(
        "SELECT kp.object_id FROM kb_problem kp JOIN object_head h ON h.id = kp.object_id "
        f"WHERE kp.signature_hash = :sig AND {pred.sql} ORDER BY kp.updated_at DESC LIMIT 20",
        {"sig": sig_hash, **pred.params},
    ).fetchall()
    candidates = {row["object_id"]: (100.0, "signature") for row in exact}
    expr = fts.match_expression(body.text)
    if expr:
        rows = conn.execute(
            "SELECT h.id, bm25(search_fts, 4.0, 1.0) AS rank FROM search_fts "
            "JOIN object_head h ON h.doc_no = search_fts.rowid JOIN kb_problem kp ON kp.object_id = h.id "
            f"WHERE search_fts MATCH :q AND {pred.sql} ORDER BY rank, h.id LIMIT 40",
            {"q": expr, **pred.params},
        ).fetchall()
        for row in rows:
            tools = {r[0] for r in conn.execute("SELECT tool_key FROM kb_env WHERE problem_id = ?", (row["id"],))}
            overlap = len(tools & inferred)
            score = max(1.0, 70.0 - min(50.0, abs(float(row["rank"])))) + overlap * 8.0
            current = candidates.get(row["id"])
            if current is None or score > current[0]:
                candidates[row["id"]] = (score, "fts+tool" if overlap else "fts")
    ordered = sorted(candidates.items(), key=lambda item: (-item[1][0], item[0]))[:10]
    return ok(ctx, [_summary(conn, ctx.actor, pid, score, reason) for pid, (score, reason) in ordered],
              normalized_signature=normalized, inferred_tools=sorted(inferred))


@router.get("/search")
def search_problems(q: str = "", tool_key: Optional[str] = None, industry_key: Optional[str] = None,
                    status: Optional[Literal["pending", "verified", "stale"]] = None,
                    created_from: Optional[str] = None, created_to: Optional[str] = None,
                    limit: int = Query(default=20, ge=1, le=50), ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn)
    if tool_key is not None and tool_key not in TOOL_KEYS:
        raise ApiError("validation_failed", "不认识的工具 key")
    if industry_key is not None and industry_key not in INDUSTRY_KEYS:
        raise ApiError("validation_failed", "不认识的行业 key")
    if any(value is not None and not DATE.match(value) for value in (created_from, created_to)):
        raise ApiError("validation_failed", "时间筛选用 YYYY-MM-DD 或 UTC ISO 时间")
    if created_to is not None and len(created_to) == 10:
        created_to += "T23:59:59.999999Z"
    if len(q) > 200:
        raise ApiError("validation_failed", "检索词不超过 200 个字")
    pred = visible_predicate(ctx.actor)
    joins = "JOIN object_head h ON h.id = kp.object_id"
    where = [pred.sql]
    params = dict(pred.params)
    if tool_key:
        where.append("EXISTS (SELECT 1 FROM kb_env ke WHERE ke.problem_id = kp.object_id AND ke.tool_key = :tool)")
        params["tool"] = tool_key
    for key, value, column, op in (
        ("industry", industry_key, "kp.industry_key", "="), ("status", status, "kp.status", "="),
        ("created_from", created_from, "kp.created_at", ">="), ("created_to", created_to, "kp.created_at", "<="),
    ):
        if value is not None:
            where.append(f"{column} {op} :{key}")
            params[key] = value
    expr = fts.match_expression(q.strip())
    if expr:
        joins = "JOIN object_head h ON h.id = kp.object_id JOIN search_fts ON search_fts.rowid = h.doc_no"
        where.insert(0, "search_fts MATCH :q")
        params["q"] = expr
        order = "bm25(search_fts, 4.0, 1.0), kp.object_id"
    else:
        order = "kp.updated_at DESC, kp.object_id"
    rows = conn.execute(
        f"SELECT kp.object_id FROM kb_problem kp {joins} WHERE {' AND '.join(where)} ORDER BY {order} LIMIT :limit",
        {**params, "limit": limit},
    ).fetchall()
    return ok(ctx, [_summary(conn, ctx.actor, row["object_id"]) for row in rows])


@router.get("/taxonomy")
def taxonomy(ctx: Ctx = Depends(user_ctx)):
    """工具和行业字典，唯一来源是 tools/drift_lexicon.py；前端不再镜像。"""
    _gate(ctx.db.conn())
    return ok(ctx, {
        "tools": [{"key": e["key"], "label": e["label"], "group": e["group"]} for e in _lexicon_module.APPS],
        "industries": [{"key": e["key"], "label": e["label"]} for e in _lexicon_module.INDUSTRIES],
    })


@router.get("/problems/{problem_id}")
def get_problem(problem_id: str, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    _gate(conn)
    data = _detail(conn, ctx.actor, problem_id)
    return JSONResponse(ok(ctx, data, etag=data["etag"]), headers={"ETag": data["etag"]})


@router.post("/captures", status_code=201)
def create_capture(body: CaptureIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _gate(conn)
        require(conn, ctx.actor, "kb.capture")
        capture_id = str(uuid.uuid4())
        try:
            conn.execute(
                "INSERT INTO kb_capture (id, source_kind, source_id, title, phenomenon, error_raw, answer_text, "
                "requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (capture_id, body.source_kind, body.source_id, body.title.strip(), body.phenomenon.strip(),
                 body.error_signature.strip(), body.answer_text.strip(), ctx.actor.id, clock.now()),
            )
        except Exception as exc:
            if "UNIQUE constraint failed" not in str(exc):
                raise
            row = conn.execute(
                "SELECT id FROM kb_capture WHERE source_kind = ? AND source_id = ? AND requested_by = ?",
                (body.source_kind, body.source_id, ctx.actor.id),
            ).fetchone()
            capture_id = row["id"]
        audit.record(conn, ctx.actor.id, "kb.capture", "kb_capture", capture_id, request_id=ctx.request_id)
        row = conn.execute("SELECT * FROM kb_capture WHERE id = ?", (capture_id,)).fetchone()
        return 201, ok(ctx, dict(row))

    return idempotency.run(ctx, payload, work)


@router.post("/captures/{capture_id}/confirm", status_code=201)
def confirm_capture(capture_id: str, body: CaptureConfirm, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()

    def work(conn):
        _gate(conn)
        require(conn, ctx.actor, "kb.capture")
        capture = conn.execute(
            "SELECT * FROM kb_capture WHERE id = ? AND requested_by = ?", (capture_id, ctx.actor.id)
        ).fetchone()
        if capture is None:
            raise ApiError("resource_not_found")
        if capture["status"] == "confirmed":
            data = _detail(conn, ctx.actor, capture["problem_id"])
            return 200, ok(ctx, data, etag=data["etag"])
        problem_data = {
            **payload,
            "title": body.title or capture["title"],
            "phenomenon": body.phenomenon or capture["phenomenon"],
            "error_signature": body.error_signature if body.error_signature is not None else capture["error_raw"],
            "root_cause": body.root_cause or capture["answer_text"],
        }
        if problem_data["root_cause"] and not problem_data["solution_steps"]:
            problem_data["solution_steps"] = [problem_data["root_cause"]]
        problem_id = create_problem_record(conn, ctx.actor, problem_data, ctx.request_id)
        now = clock.now()
        conn.execute(
            "UPDATE kb_capture SET status = 'confirmed', problem_id = ?, confirmed_at = ? WHERE id = ?",
            (problem_id, now, capture_id),
        )
        outbox.emit(conn, "kb.capture.confirmed", "kb_capture", capture_id, {"problem_id": problem_id},
                    actor_id=ctx.actor.id, request_id=ctx.request_id)
        data = _detail(conn, ctx.actor, problem_id)
        return 201, ok(ctx, data, etag=data["etag"])

    return idempotency.run(ctx, payload, work)


def _capture_bounty_award(conn, event):
    payload = event.get("payload") or {}
    question = str(payload.get("question") or payload.get("phenomenon") or "").strip()
    answer = str(payload.get("answer") or payload.get("solution") or "").strip()
    title = str(payload.get("title") or "悬赏解决记录").strip()[:200]
    source_id = str(payload.get("bounty_id") or event.get("aggregate_id") or event.get("id"))
    conn.execute(
        "INSERT OR IGNORE INTO kb_capture (id, source_kind, source_id, title, phenomenon, error_raw, answer_text, "
        "requested_by, created_at) VALUES (?, 'bounty', ?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), source_id, title, question or title, str(payload.get("error_signature") or "")[:20_000],
         answer[:30_000], event.get("actor_id"), event.get("occurred_at") or clock.now()),
    )


outbox.subscribe("kb.capture.bounty_awarded", "bounty.awarded", _capture_bounty_award)
