"""Import JSON-compatible LIB-1 samples into an explicitly supplied test database."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from ..router import ItemIn, create_record


FALLBACK_ITEMS = [
    {
        "type": "skill", "title": "提交前自查", "category": "编程", "tags": ["评审"],
        "clients_or_stacks": ["Codex"], "license": "示例",
        "content": {"purpose": "提交前检查边界、测试与残余风险", "skill_md": "# 提交前自查\n逐项核对改动与证据。"},
        "examples": [{"input": "检查这次修改", "output": "示例输出：列出风险和验证结果"}], "installs": [],
    },
    {
        "type": "prompt", "title": "约束优先的评审提示词", "category": "评审与自查", "tags": ["提示词"],
        "clients_or_stacks": ["通用模型"], "license": "示例",
        "content": {"use_when": "需要按明确契约评审产物时", "template": "目标：{goal}\n约束：{constraints}\n请只报告有证据的问题。"},
        "examples": [{"input": "目标：检查接口", "output": "示例输出：发现一处权限遗漏"}], "installs": [],
    },
    {
        "type": "component_lib", "title": "轻量表单组件集", "category": "设计", "tags": ["表单"],
        "clients_or_stacks": ["HTML", "CSS"], "license": "示例",
        "content": {"strengths": "低依赖的表单基础件", "choose_when": "需要快速建立一致表单时",
                    "avoid_when": "需要复杂数据网格时", "usage_code": "<button class=\"button\">保存</button>"},
        "examples": [{"input": "保存操作", "output": "示例输出：一致的主按钮"}], "installs": [],
    },
    {
        "type": "pattern", "title": "对话加工件", "category": "Agent 产品", "tags": ["工件"],
        "clients_or_stacks": ["Web"], "license": "示例",
        "content": {"use_when": "对话需要沉淀为可继续编辑的结果时", "structure": "对话 -> 工件 -> 版本",
                    "pitfalls": ["工件与对话状态不同步"], "site_route": "#/workshop"},
        "examples": [{"input": "生成计划", "output": "示例输出：右侧形成可编辑计划"}], "installs": [],
    },
]


def _frontend_item(raw):
    """Map the LIB-1 browser sample shape to the strict backend contract."""
    if "content" in raw and "examples" in raw and "type" in raw:
        return raw
    kind = raw.get("kind")
    common = {
        "title": raw.get("name", ""),
        "category": raw.get("category", "未分类"),
        "tags": [value for value in (raw.get("category"), raw.get("slug")) if value],
        "license": raw.get("license", ""),
    }
    if kind == "skill":
        installs = [{"client": client, "instructions": instructions}
                    for client, instructions in (raw.get("installs") or {}).items()]
        return {
            **common, "type": "skill", "clients_or_stacks": raw.get("clients", []),
            "content": {"purpose": raw.get("summary", ""), "skill_md": raw.get("example", ""),
                        "author": raw.get("author", ""), "version": raw.get("version", ""),
                        "before": raw.get("before", ""), "after": raw.get("after", "")},
            "examples": [{"input": raw.get("before", ""), "output": raw.get("after", ""),
                          "comparison_bad": raw.get("before", ""), "comparison_good": raw.get("after", ""),
                          "caption": raw.get("exampleLabel", "")}],
            "installs": installs,
        }
    if kind == "prompt":
        variables = ["｜".join(str(part) for part in variable) if isinstance(variable, list) else str(variable)
                     for variable in raw.get("variables", [])]
        notes = [raw["modelNotes"]] if raw.get("modelNotes") else []
        return {
            **common, "type": "prompt", "clients_or_stacks": [],
            "content": {"use_when": raw.get("when", ""), "template": raw.get("template", ""),
                        "variables": variables, "model_notes": notes},
            "examples": [{"input": raw.get("exampleInput", ""), "output": raw.get("exampleOutput", ""),
                          "comparison_bad": raw.get("bad", ""), "comparison_good": raw.get("good", "")}],
            "installs": [],
        }
    if kind == "component":
        return {
            **common, "type": "component_lib", "clients_or_stacks": [raw.get("stack", "")],
            "content": {"strengths": raw.get("specialty", ""), "choose_when": raw.get("choose", ""),
                        "avoid_when": raw.get("avoid", ""), "usage_code": raw.get("example", "")},
            "examples": [{"output": raw.get("example", ""), "caption": str(raw.get("preview", ""))}],
            "installs": [],
        }
    if kind == "pattern":
        diagram = json.dumps(raw.get("diagram", {}), ensure_ascii=False, sort_keys=True)
        return {
            **common, "type": "pattern", "clients_or_stacks": [],
            "content": {"use_when": raw.get("scene", ""), "structure": diagram,
                        "pitfalls": [raw.get("pitfalls", "")], "site_route": raw.get("route", ""),
                        "known_products": raw.get("products", [])},
            "examples": [{"output": raw.get("routeName", ""), "caption": diagram}], "installs": [],
        }
    raise ValueError(f"unsupported library sample kind: {kind!r}")


def _flatten(payload):
    if isinstance(payload, list):
        return [_frontend_item(item) for item in payload]
    if not isinstance(payload, dict):
        raise ValueError("library sample must be a list or object")
    if isinstance(payload.get("items"), list):
        return [_frontend_item(item) for item in payload["items"]]
    result = []
    for key, item_type in (("skills", "skill"), ("prompts", "prompt"),
                           ("components", "component_lib"), ("patterns", "pattern")):
        for item in payload.get(key, []):
            result.append({"type": item_type, **item})
    return [_frontend_item(item) for item in result]


def _read_javascript(path):
    """Evaluate only the trusted LIB-1 data builder in a context with no host APIs."""
    harness = r"""
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(process.argv[1], 'utf8');
const context = {window: Object.create(null)};
vm.createContext(context, {codeGeneration: {strings: false, wasm: false}});
new vm.Script(source, {filename: 'library-sample.js'}).runInContext(context, {timeout: 1000});
process.stdout.write(JSON.stringify(context.window.COMMONS_LIBRARY_SAMPLE));
"""
    try:
        result = subprocess.run(
            ["node", "-e", harness, str(path)], check=True, capture_output=True, text=True, timeout=3,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError("cannot read LIB-1 sample data with the local Node runtime") from exc
    return json.loads(result.stdout)


def load_items(sample_path=None):
    path = Path(sample_path) if sample_path else None
    if path is None or not path.is_file():
        return list(FALLBACK_ITEMS)
    source = path.read_text(encoding="utf-8").strip()
    try:
        payload = json.loads(source)
    except json.JSONDecodeError:
        payload = _read_javascript(path)
    return _flatten(payload)


def import_items(db, actor, sample_path=None):
    """Seed only the caller-provided database; callers own its test-only safety boundary."""
    created = []
    items = load_items(sample_path)
    with db.write() as conn:
        for raw in items:
            body = ItemIn.model_validate(raw)
            existing = conn.execute(
                "SELECT h.id FROM object_head h JOIN object_version v ON v.object_id = h.id "
                "AND v.version = h.current_version WHERE h.type = ? AND v.title = ? LIMIT 1",
                (body.type, body.title),
            ).fetchone()
            if existing is not None:
                continue
            created.append(create_record(conn, actor, body, status="active"))
    return created

