"""Strict, text-only schemas for the four library object types."""

from __future__ import annotations

from copy import deepcopy

from app.errors import ApiError


ITEM_TYPES = frozenset({"skill", "prompt", "component_lib", "pattern"})
MAX_TEXT = 20_000
MAX_CODE = 50_000
MAX_LIST = 20

COMMON_FIELDS = frozenset({
    "category", "tags", "clients_or_stacks", "license", "examples", "installs",
})

TYPE_FIELDS = {
    "skill": {
        "required": {"purpose", "skill_md"},
        "optional": {"author", "version", "before", "after"},
        "code": {"skill_md"},
        "lists": set(),
    },
    "prompt": {
        "required": {"use_when", "template"},
        "optional": {"variables", "model_notes"},
        "code": {"template"},
        "lists": {"variables", "model_notes"},
    },
    "component_lib": {
        "required": {"strengths", "choose_when", "avoid_when", "usage_code"},
        "optional": {"demo_markup"},
        "code": {"usage_code", "demo_markup"},
        "lists": set(),
    },
    "pattern": {
        "required": {"use_when", "structure", "pitfalls", "site_route"},
        "optional": {"known_products"},
        "code": {"structure"},
        "lists": {"pitfalls", "known_products"},
    },
}

EXAMPLE_FIELDS = frozenset({"input", "output", "comparison_bad", "comparison_good", "caption"})
INSTALL_FIELDS = frozenset({"client", "instructions"})


def _fail(message):
    raise ApiError("validation_failed", message)


def _text(value, name, *, required=False, limit=MAX_TEXT):
    if not isinstance(value, str):
        _fail(f"{name} 必须是纯文本")
    value = value.strip()
    if required and not value:
        _fail(f"{name} 不能为空")
    if len(value) > limit:
        _fail(f"{name} 不超过 {limit} 字")
    return value


def _string_list(value, name, *, limit=MAX_LIST, item_limit=200):
    if not isinstance(value, list) or len(value) > limit:
        _fail(f"{name} 最多 {limit} 项")
    result = []
    for item in value:
        cleaned = _text(item, name, required=True, limit=item_limit)
        if cleaned not in result:
            result.append(cleaned)
    return result


def _examples(value):
    if not isinstance(value, list) or len(value) > MAX_LIST:
        _fail(f"examples 最多 {MAX_LIST} 项")
    result = []
    for entry in value:
        if not isinstance(entry, dict):
            _fail("example 必须是对象")
        unknown = set(entry) - EXAMPLE_FIELDS
        if unknown:
            raise ApiError("unknown_field", f"example 不认识的字段：{', '.join(sorted(unknown))}")
        cleaned = {key: _text(entry.get(key, ""), f"example.{key}") for key in EXAMPLE_FIELDS}
        if not any(cleaned.values()):
            _fail("example 至少要有一段文字")
        result.append(cleaned)
    return result


def _installs(value):
    if not isinstance(value, list) or len(value) > MAX_LIST:
        _fail(f"installs 最多 {MAX_LIST} 项")
    result, clients = [], set()
    for entry in value:
        if not isinstance(entry, dict):
            _fail("install 必须是对象")
        unknown = set(entry) - INSTALL_FIELDS
        if unknown:
            raise ApiError("unknown_field", f"install 不认识的字段：{', '.join(sorted(unknown))}")
        client = _text(entry.get("client"), "install.client", required=True, limit=80)
        instructions = _text(entry.get("instructions"), "install.instructions", required=True, limit=MAX_CODE)
        if client in clients:
            _fail("同一客户端只能有一份安装方法")
        clients.add(client)
        result.append({"client": client, "instructions": instructions})
    return result


def validate(item_type, content):
    if item_type not in ITEM_TYPES:
        _fail("不认识的资源类型")
    if not isinstance(content, dict):
        _fail("content 必须是对象")
    spec = TYPE_FIELDS[item_type]
    allowed = COMMON_FIELDS | spec["required"] | spec["optional"]
    unknown = set(content) - allowed
    if unknown:
        raise ApiError("unknown_field", f"{item_type} 不认识的字段：{', '.join(sorted(unknown))}")
    missing = spec["required"] - set(content)
    if missing:
        _fail(f"{item_type} 缺少字段：{', '.join(sorted(missing))}")

    category = _text(content.get("category"), "category", required=True, limit=80)
    tags = _string_list(content.get("tags", []), "tags", limit=12, item_limit=32)
    clients = _string_list(content.get("clients_or_stacks", []), "clients_or_stacks", limit=12, item_limit=80)
    license_name = _text(content.get("license", ""), "license", limit=80)
    examples = _examples(content.get("examples", []))
    installs = _installs(content.get("installs", []))
    if not examples:
        _fail("每个资源至少需要一个示例")

    result = {
        "category": category,
        "tags": tags,
        "clients_or_stacks": clients,
        "license": license_name,
        "examples": examples,
        "installs": installs,
    }
    for key in sorted(spec["required"] | spec["optional"]):
        if key not in content:
            continue
        if key in spec["lists"]:
            result[key] = _string_list(content[key], key)
        else:
            result[key] = _text(
                content[key], key, required=key in spec["required"],
                limit=MAX_CODE if key in spec["code"] else MAX_TEXT,
            )
    return result


def validator(item_type):
    return lambda content: validate(item_type, content)


def text(content):
    """Extract searchable plain text, including tags and example text."""
    parts = []

    def walk(value):
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)

    walk(deepcopy(content))
    return "\n".join(part for part in parts if part).strip()


def stored_content(item_type, *, category, tags, clients_or_stacks, license_name, examples, installs, content):
    if not isinstance(content, dict):
        _fail("content 必须是对象")
    merged = dict(content)
    merged.update({
        "category": category,
        "tags": tags,
        "clients_or_stacks": clients_or_stacks,
        "license": license_name,
        "examples": examples,
        "installs": installs,
    })
    return validate(item_type, merged)


def public_content(content):
    return {key: value for key, value in content.items() if key not in COMMON_FIELDS}

