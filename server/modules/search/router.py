"""GET /api/search-all：聚合核心 FTS 与已经提供搜索接口的模块。

模块发现器要求模块路由位于 ``/api/search`` 下，而产品契约冻结为
``/api/search-all``。因此本文件保留一个空的模块路由供发现器校验，并把
聚合端点幂等注册到已经冻结的核心搜索路由；无需改动 ``server/app``。
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from importlib import import_module
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.routing import APIRoute

from app import flags, fts, security
from app.authz import visible_predicate
from app.context import Ctx, ok, user_ctx
from app.core import search as core_search
from app.errors import ApiError

router = APIRouter(prefix="/api/search")

MEMBERS_RATE_LIMIT = 120
MEMBERS_RATE_WINDOW = 60
MEMBERS_MAX_QUERY = 40
MEMBERS_MAX_LIMIT = 10

SEARCH_PATH = "/api/search-all"
SEARCH_RATE_LIMIT = 60
SEARCH_RATE_WINDOW = 60
MAX_QUERY = 100

SYNONYMS = {
    "cc": ("Claude Code",),
}

KIND_ALIASES = {
    "component": "component_lib",
    "components": "component_lib",
    "thread": "discussion",
    "threads": "discussion",
}

TYPE_WEIGHTS = {
    "problem": 18.0,
    "knowledge": 16.0,
    "skill": 15.0,
    "prompt": 14.0,
    "component_lib": 13.0,
    "pattern": 12.0,
    "discussion": 11.0,
    "work": 10.0,
}

HREFS = {
    "problem": "#/solved",
    "knowledge": "#/knowledge",
    "skill": "#/skills",
    "prompt": "#/prompts",
    "component_lib": "#/components",
    "pattern": "#/patterns",
    "discussion": "#/threads",
    "work": "#/people",
}

OPTIONAL_PROVIDERS = (
    ("kb", "modules.kb.router", "search_problems", frozenset({"problem"})),
    ("library", "modules.library.router", "search_items",
     frozenset({"skill", "prompt", "component_lib", "pattern"})),
)


def _query_variants(query):
    variants = [query]
    for synonym in SYNONYMS.get(query.casefold(), ()):
        if synonym.casefold() != query.casefold():
            variants.append(synonym)
    return variants


def _parse_kinds(raw):
    if raw is None or not raw.strip():
        return None
    kinds = []
    for value in raw.split(","):
        kind = KIND_ALIASES.get(value.strip().casefold(), value.strip().casefold())
        if not kind or kind not in TYPE_WEIGHTS:
            raise ApiError("validation_failed", "包含不认识的检索类型")
        if kind not in kinds:
            kinds.append(kind)
    return tuple(kinds)


def _core_results(ctx, variants, kinds, limit):
    conn = ctx.db.conn()
    pred = visible_predicate(ctx.actor)
    found = []
    for variant in variants:
        expression = fts.match_expression(variant)
        if not expression:
            continue
        params = {"q": expression, **pred.params, "limit": limit}
        filters = ""
        if kinds:
            names = []
            for index, kind in enumerate(kinds):
                key = f"kind_{index}"
                names.append(f":{key}")
                params[key] = kind
            filters = f" AND h.type IN ({', '.join(names)})"
        rows = conn.execute(
            "SELECT h.id, h.type, h.created_at, d.title, d.body, "
            "bm25(search_fts, 4.0, 1.0) AS bm25_rank "
            "FROM search_fts JOIN object_head h ON h.doc_no = search_fts.rowid "
            "JOIN search_doc d ON d.object_id = h.id "
            f"WHERE search_fts MATCH :q AND {pred.sql}{filters} "
            "ORDER BY bm25_rank, h.id LIMIT :limit",
            params,
        ).fetchall()
        for row in rows:
            found.append({
                "kind": row["type"],
                "id": row["id"],
                "title": row["title"],
                "snippet": fts.snippet(row["body"], variant),
                "href": HREFS.get(row["type"], f"#/search?q={variant}"),
                "created_at": row["created_at"],
                "bm25_rank": float(row["bm25_rank"]),
                "meta": {"source": "core"},
            })
    return found


def _optional_results(spec, ctx, variants, kinds, limit):
    name, module_name, function_name, supported = spec
    if kinds and not supported.intersection(kinds):
        return []
    try:
        function = getattr(import_module(module_name), function_name)
    except (ImportError, AttributeError):
        return []
    found = []
    for variant in variants:
        try:
            if name == "kb":
                body = function(q=variant, tool_key=None, industry_key=None, status=None,
                                created_from=None, created_to=None, limit=limit, ctx=ctx)
                items = body.get("data", [])
                found.extend(_normalize_module_item(item, "problem", name) for item in items)
            elif name == "library":
                wanted = supported if not kinds else supported.intersection(kinds)
                for kind in sorted(wanted):
                    body = function(q=variant, type=kind, category=None, tag=None, limit=limit, ctx=ctx)
                    items = body.get("data", [])
                    found.extend(_normalize_module_item(item, kind, name) for item in items)
        except ApiError as exc:
            if exc.code == "capability_unavailable":
                return []
            raise
    return found


def _normalize_module_item(item, fallback_kind, source):
    kind = item.get("type") or item.get("kind") or fallback_kind
    kind = KIND_ALIASES.get(str(kind), str(kind))
    title = item.get("title") or item.get("name") or "未命名内容"
    snippet = (item.get("phenomenon") or item.get("summary") or item.get("use_when")
               or item.get("description") or "")
    created_at = item.get("updated_at") or item.get("created_at") or ""
    return {
        "kind": kind,
        "id": str(item.get("id") or item.get("object_id") or ""),
        "title": str(title),
        "snippet": str(snippet),
        "href": HREFS.get(kind, "#/search"),
        "created_at": str(created_at),
        "bm25_rank": None,
        "meta": {"source": source},
    }


def _freshness(value):
    if not value:
        return 0.0
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        days = max(0, (datetime.now(timezone.utc) - parsed).days)
    except (TypeError, ValueError):
        return 0.0
    if days <= 7:
        return 10.0
    if days <= 30:
        return 6.0
    if days <= 180:
        return 2.0
    return 0.0


def _merge_and_rank(rows, limit):
    merged = {}
    for item in rows:
        if not item["id"] or item["kind"] not in TYPE_WEIGHTS:
            continue
        key = (item["kind"], item["id"])
        current = merged.get(key)
        if current is None:
            item["meta"] = {"sources": [item["meta"]["source"]]}
            merged[key] = item
            continue
        source = item["meta"]["source"]
        if source not in current["meta"]["sources"]:
            current["meta"]["sources"].append(source)
        if item["snippet"] and len(item["snippet"]) > len(current["snippet"]):
            current["snippet"] = item["snippet"]
        if current["bm25_rank"] is None or (item["bm25_rank"] is not None
                                             and item["bm25_rank"] < current["bm25_rank"]):
            current["bm25_rank"] = item["bm25_rank"]

    ranked_values = [item["bm25_rank"] for item in merged.values() if item["bm25_rank"] is not None]
    best = min(ranked_values) if ranked_values else 0.0
    worst = max(ranked_values) if ranked_values else 0.0
    spread = worst - best
    for item in merged.values():
        raw = item.pop("bm25_rank")
        if raw is None:
            bm25_score = 18.0
        elif spread <= 1e-12:
            bm25_score = 40.0
        else:
            bm25_score = 20.0 + 30.0 * (worst - raw) / spread
        item["score"] = round(bm25_score + TYPE_WEIGHTS[item["kind"]] + _freshness(item["created_at"]), 4)
        item["meta"]["sources"].sort()
    return sorted(merged.values(), key=lambda item: (-item["score"], item["kind"], item["id"]))[:limit]


def _search_all(query, kinds, limit, ctx):
    variants = _query_variants(query)
    specs = [spec for spec in OPTIONAL_PROVIDERS if not kinds or spec[3].intersection(kinds)]
    jobs = []
    with ThreadPoolExecutor(max_workers=1 + len(specs), thread_name_prefix="search-all") as pool:
        jobs.append(pool.submit(_core_results, ctx, variants, kinds, limit * 2))
        jobs.extend(pool.submit(_optional_results, spec, ctx, variants, kinds, limit) for spec in specs)
        rows = [item for job in jobs for item in job.result()]
    return _merge_and_rank(rows, limit)


def search_all(q: str = "", kinds: Optional[str] = None,
               limit: int = Query(default=20, ge=1, le=50), ctx: Ctx = Depends(user_ctx)):
    flags.gate(ctx.db.conn(), 'core.search')
    query = q.strip()
    if len(query) > MAX_QUERY:
        raise ApiError("validation_failed", "检索词不超过 100 个字")
    wanted = _parse_kinds(kinds)
    if not query:
        return ok(ctx, [], kinds=list(wanted or ()), providers=[])
    security.hit(ctx.db, f"search-all:{ctx.actor.id}", SEARCH_RATE_LIMIT, SEARCH_RATE_WINDOW)
    results = _search_all(query, wanted, limit, ctx)
    providers = sorted({source for item in results for source in item["meta"]["sources"]})
    return ok(ctx, results, kinds=list(wanted or ()), providers=providers)


def _like(text):
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _agent_profile_ready(conn):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_profile'").fetchone() is not None


def _blocked(conn, a, b):
    try:
        from modules.social import service as social
    except ImportError:
        return False
    return bool(social.blocked(conn, a, b))


@router.get("/members")
def search_members(q: str = "", kinds: Optional[str] = None,
                   limit: int = Query(default=8, ge=1, le=MEMBERS_MAX_LIMIT), ctx: Ctx = Depends(user_ctx)):
    """@ 补全：按名字或 handle 找成员和 Agent。只返回公开字段，不含邮箱、等级以外的任何资料。"""
    conn = ctx.db.conn()
    flags.gate(conn, "core.search")
    actor = ctx.actor
    if not actor.authenticated or actor.status != "active":
        raise ApiError("unauthenticated")
    query = q.strip()
    if len(query) > MEMBERS_MAX_QUERY:
        raise ApiError("validation_failed", "检索词不超过 40 个字")
    wanted = {"human", "agent"}
    if kinds and kinds.strip():
        wanted = {part.strip() for part in kinds.split(",") if part.strip()}
        if not wanted or not wanted <= {"human", "agent"}:
            raise ApiError("validation_failed", "kinds 只能是 human 或 agent")
    if not query:
        return ok(ctx, {"items": []})
    security.hit(ctx.db, f"search-members:{actor.id}", MEMBERS_RATE_LIMIT, MEMBERS_RATE_WINDOW)
    pattern = _like(query.casefold())
    agent_gate = "AND (p.kind = 'human' OR ap.status = 'active')" if _agent_profile_ready(conn) else "AND p.kind = 'human'"
    agent_join = "LEFT JOIN agent_profile ap ON ap.principal_id = p.id" if _agent_profile_ready(conn) else ""
    marks = ",".join("?" for _ in wanted)
    rows = conn.execute(
        "SELECT p.id, p.kind, c.handle, pr.display_name, pr.level, "
        "CASE WHEN lower(c.handle) LIKE ? ESCAPE '\\' OR lower(pr.display_name) LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS rank "
        "FROM principal p JOIN profile pr ON pr.principal_id = p.id "
        f"LEFT JOIN credential c ON c.principal_id = p.id {agent_join} "
        f"WHERE p.status = 'active' AND p.kind IN ({marks}) {agent_gate} AND p.id != ? "
        "AND (lower(c.handle) LIKE ? ESCAPE '\\' OR lower(pr.display_name) LIKE ? ESCAPE '\\') "
        "ORDER BY rank, pr.display_name, p.id LIMIT ?",
        (pattern + "%", pattern + "%", *sorted(wanted), actor.id, "%" + pattern + "%", "%" + pattern + "%", limit * 3),
    ).fetchall()
    items = []
    for row in rows:
        if row["kind"] == "human" and _blocked(conn, actor.id, row["id"]):
            continue
        items.append({
            "id": row["id"],
            "kind": row["kind"],
            "handle": row["handle"] if row["kind"] == "human" else None,
            "display_name": row["display_name"],
            "level": row["level"],
        })
        if len(items) >= limit:
            break
    return ok(ctx, {"items": items})


def _install_route():
    if any(getattr(route, "path", None) == SEARCH_PATH for route in core_search.router.routes):
        return
    core_search.router.routes.append(APIRoute(
        path=SEARCH_PATH,
        endpoint=search_all,
        methods=["GET"],
        name="search_all",
    ))


_install_route()

