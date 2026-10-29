#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R12-W2 LINT-1 · 档位检查（只读扫描，只报告，不改任何被扫描的文件）。

规则正本：docs/design/visual-system-v2.md；数值唯一来源：preview/tokens.css。

检查项（严重程度从高到低）：
  1. warm      暖色字面量（HSL 色相 15°–65°、饱和度 ≥12%、明度 8%–97%）
  2. color     CSS/JS 里的 #hex、rgb()/rgba()/hsl()/hsla() 字面量（暖色单列）
  3. root      tokens.css 以外模块写 :root
  4. font      档外字号（font-size 与 font 简写的非 line-height px）
  5. radius    档外圆角（border-radius px 不在 --radius-*；0/50%/999px 放行）
  6. duration  写死时长（transition/animation 的 ms/s 不在 --motion-*）
  7. spacing   档外间距（gap/padding/margin 的 px 不是 4 的倍数；0/1px/2px 放行）

默认扫描 preview/*.css + preview/*.js，排除 tokens.css、vendor/、*-data.js。
JS 只查颜色字面量；data.js 同样只查颜色。

用法：
  python3 tools/lint-tokens.py                     # 全量扫描，写两份报告
  python3 tools/lint-tokens.py --strict            # 有问题时退出 1
  python3 tools/lint-tokens.py --files preview/app.css preview/app.js
                                                  # 自查，只打印，不覆盖总报告
  python3 tools/lint-tokens.py --files a.css --md /tmp/x.md --json /tmp/x.json
"""

from __future__ import annotations

import argparse
import bisect
import datetime as _dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "preview"
TOKENS = PREVIEW / "tokens.css"
REPORT_DIR = ROOT / "docs" / "innovation" / "R12" / "w2"
DEFAULT_MD = REPORT_DIR / "LINT-report.md"
DEFAULT_JSON = REPORT_DIR / "LINT-report.json"

KIND_ORDER = ["warm", "color", "root", "font", "radius", "duration", "spacing"]
KIND_LABEL = {
    "warm": "暖色",
    "color": "颜色字面量",
    "root": ":root",
    "font": "字号",
    "radius": "圆角",
    "duration": "时长",
    "spacing": "间距",
}
KIND_RANK = {k: i for i, k in enumerate(KIND_ORDER)}

DETAILS_PER_FILE = 15


class UsageError(Exception):
    """参数/路径错误：main 统一退出 2。"""

# ---------------------------------------------------------------- 通用小工具


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def fmt_num(value: float):
    if abs(value - round(value)) < 1e-9:
        return int(round(value))
    return round(value, 2)


class LineIndex:
    """offset -> (line, column)，行列均从 1 开始。"""

    def __init__(self, text: str):
        starts = [0]
        for i, ch in enumerate(text):
            if ch == "\n":
                starts.append(i + 1)
        self.starts = starts

    def locate(self, offset: int):
        row = bisect.bisect_right(self.starts, offset) - 1
        return row + 1, offset - self.starts[row] + 1


# ---------------------------------------------------------------- tokons.css


def mask_css(text: str) -> str:
    """注释与字符串替换为空格，保留换行与长度，保证 offset/行列不变。"""
    out = list(text)
    n = len(text)
    i = 0
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
            continue
        if c in ('"', "'"):
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == c or text[j] == "\n":
                    break
                j += 1
            end = j + 1 if j < n and text[j] == c else j
            for k in range(i, end):
                if out[k] != "\n":
                    out[k] = " "
            i = end
            continue
        i += 1
    return "".join(out)


TOKEN_TEXT_RE = re.compile(r"--text-([a-z0-9-]+)\s*:\s*([0-9.]+)px")
TOKEN_RADIUS_RE = re.compile(r"--radius-([a-z0-9-]+)\s*:\s*([0-9.]+)(px|%)")
TOKEN_MOTION_RE = re.compile(r"--motion-([a-z0-9-]+)\s*:\s*([0-9.]+)(ms|s)")


def load_tokens(path: Path) -> dict:
    text = mask_css(path.read_text(encoding="utf-8", errors="replace"))
    text_scale = {}
    for m in TOKEN_TEXT_RE.finditer(text):
        text_scale[m.group(1)] = float(m.group(2))
    radius = {}
    for m in TOKEN_RADIUS_RE.finditer(text):
        radius[m.group(1)] = (float(m.group(2)), m.group(3))
    motion = {}
    for m in TOKEN_MOTION_RE.finditer(text):
        value = float(m.group(2))
        if m.group(3) == "s":
            value *= 1000.0
        motion[m.group(1)] = value
    if not text_scale or not radius:
        raise UsageError(f"无法从 {rel(path)} 读取 --text-* / --radius-*；基线缺失，终止。")
    return {
        "text": text_scale,
        "radius": radius,
        "motion": motion,
        "text_values": sorted(set(text_scale.values())),
        "radius_px": sorted({v for v, unit in radius.values() if unit == "px"}),
        "motion_ms": sorted(set(motion.values())),
    }


# ---------------------------------------------------------------- 颜色解析

HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])")
FUNC_RE = re.compile(r"\b(rgba?|hsla?)\s*\(", re.IGNORECASE)


def read_paren(text: str, open_idx: int):
    """从 '(' 开始取平衡内容，返回 (args, end_exclusive)。"""
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1:i], i + 1
    return text[open_idx + 1:], len(text)


def hex_to_rgb(raw: str):
    h = raw[1:]
    if len(h) in (3, 4):
        h = "".join(ch * 2 for ch in h[:3])
    elif len(h) in (6, 8):
        h = h[:6]
    else:
        return None
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def split_color_args(args: str):
    head = args.split("/")[0]
    return [p for p in re.split(r"[,\s]+", head.strip()) if p]


def parse_rgb(raw: str):
    args, _ = read_paren(raw, raw.find("("))
    parts = split_color_args(args)
    if len(parts) < 3:
        return None
    channels = []
    for p in parts[:3]:
        try:
            if p.endswith("%"):
                channels.append(float(p[:-1]) * 255.0 / 100.0)
            else:
                channels.append(float(p))
        except ValueError:
            return None
    return tuple(max(0.0, min(255.0, v)) for v in channels)


def parse_hsl(raw: str):
    args, _ = read_paren(raw, raw.find("("))
    parts = split_color_args(args)
    if len(parts) < 3:
        return None

    def pct(p, scale):
        try:
            if p.endswith("%"):
                return float(p[:-1])
            return float(p) * 100.0 / scale
        except ValueError:
            return None

    try:
        h = float(parts[0].rstrip("degturn").replace("deg", ""))
    except ValueError:
        return None
    s = pct(parts[1], 255.0)
    l = pct(parts[2], 255.0)
    if s is None or l is None:
        return None
    return (h % 360.0, max(0.0, min(100.0, s)), max(0.0, min(100.0, l)))


def rgb_to_hsl(rgb):
    r, g, b = (v / 255.0 for v in rgb)
    mx, mn = max(r, g, b), min(r, g, b)
    light = (mx + mn) / 2.0
    if mx == mn:
        return 0.0, 0.0, light * 100.0
    d = mx - mn
    sat = d / (2.0 - mx - mn) if light > 0.5 else d / (mx + mn)
    if mx == r:
        hue = (g - b) / d + (6.0 if g < b else 0.0)
    elif mx == g:
        hue = (b - r) / d + 2.0
    else:
        hue = (r - g) / d + 4.0
    return (hue * 60.0) % 360.0, sat * 100.0, light * 100.0


def hsl_of(raw: str):
    low = raw.lower()
    if low.startswith("#"):
        rgb = hex_to_rgb(raw)
        return rgb_to_hsl(rgb) if rgb else None
    if low.startswith("rgb"):
        rgb = parse_rgb(raw)
        return rgb_to_hsl(rgb) if rgb else None
    if low.startswith("hsl"):
        return parse_hsl(raw)
    return None


def is_warm(hsl) -> bool:
    if hsl is None:
        return False
    h, s, l = hsl
    return 15.0 <= h <= 65.0 and s >= 12.0 and 8.0 <= l <= 97.0


def hsl_text(hsl) -> str | None:
    if hsl is None:
        return None
    return f"hsl({hsl[0]:.0f}°, {hsl[1]:.0f}%, {hsl[2]:.0f}%)"


# ---------------------------------------------------------------- CSS 扫描

DECL_RE = re.compile(r"(?P<prop>[-A-Za-z_][-\w]*)\s*:\s*(?P<value>[^;{}]*)")
ROOT_RE = re.compile(r"(?<![\w-]):root\b")
PX_RE = re.compile(r"(?<![\w.\-])-?\d+(?:\.\d+)?px\b")
TIME_RE = re.compile(r"(?<![\w.\-])(\d+(?:\.\d+)?|\.\d+)(ms|s)\b")

SPACING_RE = re.compile(r"^(?:gap|row-gap|column-gap|padding|margin)(?:-[a-z]+)*$")


def iter_css_decls(masked: str):
    """产出 (prop, value, value_start, depth)。只保留声明块内部（depth ≥ 1）。"""
    depth = 0
    pos = 0
    for m in DECL_RE.finditer(masked):
        while pos < m.start():
            ch = masked[pos]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            pos += 1
        yield m.group("prop").lower(), m.group("value"), m.start("value"), depth


def css_style_snippet(prop: str, value: str, limit: int = 170) -> str:
    snippet = collapse(f"{prop}: {value}")
    if len(snippet) > limit:
        snippet = snippet[:limit - 1] + "…"
    return snippet


def scan_css(text: str, relpath: str, tokens: dict):
    masked = mask_css(text)
    idx = LineIndex(text)
    findings = []

    def add(kind, offset, value, snippet, prop=None, detail=None):
        line, col = idx.locate(offset)
        findings.append({
            "file": relpath,
            "line": line,
            "column": col,
            "kind": kind,
            "value": value,
            "property": prop,
            "snippet": snippet,
            "detail": detail,
        })

    # 8. tokens.css 以外的 :root
    for m in ROOT_RE.finditer(masked):
        line_start = text.rfind("\n", 0, m.start()) + 1
        line_end = text.find("\n", m.start())
        line_end = len(text) if line_end < 0 else line_end
        add("root", m.start(), ":root", collapse(text[line_start:line_end])[:170], detail="模块内自定义根变量")

    font_ok = set(tokens["text_values"])
    radius_ok = set(tokens["radius_px"]) | {0.0, 999.0}
    motion_ok = set(tokens["motion_ms"])

    for prop, value, vstart, depth in iter_css_decls(masked):
        if depth < 1:
            continue
        collapsed_value = collapse(value)
        if not collapsed_value:
            continue
        snippet = css_style_snippet(prop, value)

        # 1/3. 颜色字面量 + 暖色
        for m in HEX_RE.finditer(value):
            raw = m.group(0)
            hsl = hsl_of(raw)
            kind = "warm" if is_warm(hsl) else "color"
            add(kind, vstart + m.start(), raw, snippet, prop, hsl_text(hsl))

        for m in FUNC_RE.finditer(value):
            open_idx = m.end() - 1
            args, end = read_paren(value, open_idx)
            raw = value[m.start():end]
            hsl = hsl_of(raw)
            kind = "warm" if is_warm(hsl) else "color"
            add(kind, vstart + m.start(), collapse(raw), snippet, prop, hsl_text(hsl))

        # 4. 档外字号
        if prop in ("font-size", "font"):
            for m in PX_RE.finditer(value):
                if prop == "font":
                    prefix = value[:m.start()].rstrip()
                    if prefix.endswith("/"):
                        continue  # font 简写里的 line-height
                px = float(m.group(0)[:-2])
                if round(px, 2) not in {round(v, 2) for v in font_ok}:
                    add("font", vstart + m.start(), m.group(0), snippet, prop,
                        f"字阶：{', '.join(str(fmt_num(v)) + 'px' for v in tokens['text_values'])}")

        # 5. 档外圆角
        if prop.endswith("radius"):
            for m in PX_RE.finditer(value):
                px = float(m.group(0)[:-2])
                if round(px, 2) not in {round(v, 2) for v in radius_ok}:
                    add("radius", vstart + m.start(), m.group(0), snippet, prop,
                        f"圆角档：{', '.join(str(fmt_num(v)) + 'px' for v in tokens['radius_px'])}")

        # 6. 写死时长
        if prop.startswith("transition") or prop.startswith("animation"):
            for m in TIME_RE.finditer(value):
                amount = float(m.group(1))
                ms = amount * 1000.0 if m.group(2) == "s" else amount
                if abs(ms) < 1e-9:
                    continue
                if not any(abs(ms - v) < 0.01 for v in motion_ok):
                    add("duration", vstart + m.start(), m.group(0), snippet, prop,
                        f"时长档：{', '.join(str(fmt_num(v)) + 'ms' for v in tokens['motion_ms'])}")

        # 7. 档外间距
        if SPACING_RE.match(prop):
            for m in PX_RE.finditer(value):
                px = abs(float(m.group(0)[:-2]))
                if px in (0.0, 1.0, 2.0):
                    continue
                if abs(px / 4.0 - round(px / 4.0)) > 1e-9:
                    add("spacing", vstart + m.start(), m.group(0), snippet, prop,
                        "间距须为 4 的倍数（0 / 1px / 2px 放行）")

    return findings


# ---------------------------------------------------------------- JS 扫描

REGEX_PRECEDERS = set("(,=:[!&|?{};+-*%<>~^")
REGEX_KEYWORDS = {
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "yield", "await", "case", "do", "else", "throw",
}
JS_HEX_RE = re.compile(r"(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])")
JS_RGB_RE = re.compile(r"\brgba?\s*\(", re.IGNORECASE)


def mask_js(text: str):
    """注释与正则字面量置空（保留长度）；返回 (masked, 字符串内容区间列表)。"""
    n = len(text)
    out = list(text)
    strings = []
    i = 0
    prev = ""       # 上一个有意义字符；"w" 表示标识符/数字，"s" 表示字符串
    word = ""       # 上一个标识符
    while i < n:
        c = text[i]
        if c.isspace():
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = i
            while j < n and text[j] != "\n":
                j += 1
            for k in range(i, j):
                out[k] = " "
            i = j
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
            continue
        if c in ('"', "'"):
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == c or text[j] == "\n":
                    break
                j += 1
            strings.append((i + 1, j))
            i = j + 1 if j < n and text[j] == c else j
            prev, word = "s", ""
            continue
        if c == "`":
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "`":
                    break
                j += 1
            strings.append((i + 1, j))
            i = j + 1
            prev, word = "s", ""
            continue
        if c == "/" and (prev == "" or prev in REGEX_PRECEDERS or word in REGEX_KEYWORDS):
            j = i + 1
            in_class = False
            closed = False
            while j < n:
                ch = text[j]
                if ch == "\\":
                    j += 2
                    continue
                if ch == "\n":
                    break
                if ch == "[":
                    in_class = True
                elif ch == "]":
                    in_class = False
                elif ch == "/" and not in_class:
                    closed = True
                    break
                j += 1
            if closed:
                j += 1
                while j < n and text[j].isalpha():
                    j += 1
                for k in range(i, j):
                    out[k] = " "
                i = j
                prev, word = "r", ""
                continue
            # 不是正则字面量：按除号继续
        if c.isalnum() or c in "_$":
            j = i
            while j < n and (text[j].isalnum() or text[j] in "_$"):
                j += 1
            word = text[i:j]
            prev = "w"
            i = j
            continue
        prev, word = c, ""
        i += 1
    return "".join(out), strings


def js_snippet(content: str, start: int, end: int, limit: int = 150) -> str:
    left = max(0, start - 36)
    right = min(len(content), end + 36)
    piece = collapse(content[left:right])
    if left > 0:
        piece = "…" + piece
    if right < len(content):
        piece = piece + "…"
    if len(piece) > limit:
        piece = piece[:limit - 1] + "…"
    return piece


def scan_js(text: str, relpath: str, tokens: dict):
    _, strings = mask_js(text)
    idx = LineIndex(text)
    findings = []

    def add(kind, offset, value, snippet, detail=None):
        line, col = idx.locate(offset)
        findings.append({
            "file": relpath,
            "line": line,
            "column": col,
            "kind": kind,
            "value": value,
            "property": None,
            "snippet": snippet,
            "detail": detail,
        })

    for start, end in strings:
        content = text[start:end]
        for m in JS_HEX_RE.finditer(content):
            raw = m.group(0)
            hsl = hsl_of(raw)
            kind = "warm" if is_warm(hsl) else "color"
            add(kind, start + m.start(), raw,
                js_snippet(content, m.start(), m.end()), hsl_text(hsl))
        for m in JS_RGB_RE.finditer(content):
            open_idx = m.end() - 1
            _, fn_end = read_paren(content, open_idx)
            raw = content[m.start():fn_end]
            hsl = hsl_of(raw)
            kind = "warm" if is_warm(hsl) else "color"
            add(kind, start + m.start(), collapse(raw),
                js_snippet(content, m.start(), fn_end), hsl_text(hsl))
    return findings


# ---------------------------------------------------------------- 文件选择


def default_files():
    files = [p for p in sorted(PREVIEW.glob("*.css")) if p.name != TOKENS.name]
    for p in sorted(PREVIEW.glob("*.js")):
        if p.name.endswith("-data.js") or p.name == "knowledge-sample-data.js":
            continue
        files.append(p)
    return files


def resolve_files(raw_paths):
    resolved, missing, unsupported = [], [], []
    for raw in raw_paths:
        p = Path(raw)
        if not p.is_absolute():
            candidate = (Path.cwd() / p)
            if not candidate.exists():
                candidate = ROOT / p
            p = candidate
        p = p.resolve()
        if not p.exists():
            missing.append(raw)
            continue
        if p.suffix.lower() not in (".css", ".js"):
            unsupported.append(raw)
            continue
        if p.name == TOKENS.name:
            print(f"跳过基线文件（不作为检查对象）：{rel(p)}", file=sys.stderr)
            continue
        resolved.append(p)
    if missing:
        raise UsageError("找不到文件：" + ", ".join(missing))
    if unsupported:
        raise UsageError("只支持 .css / .js：" + ", ".join(unsupported))
    return resolved


# ---------------------------------------------------------------- 报告


def build_payload(files, findings, tokens, scope_mode: str):
    counts = {rel(p): {k: 0 for k in KIND_ORDER} for p in files}
    for f in findings:
        counts[f["file"]][f["kind"]] += 1
    by_kind = {k: sum(c[k] for c in counts.values()) for k in KIND_ORDER}
    files_meta = []
    for p in files:
        st = p.stat()
        files_meta.append({
            "file": rel(p),
            "kind": p.suffix.lstrip(".").lower(),
            "bytes": st.st_size,
            "mtime": _dt.datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(timespec="seconds"),
        })
    now = _dt.datetime.now().astimezone()
    return {
        "tool": "tools/lint-tokens.py",
        "version": "R12-W2 LINT-1 R1",
        "generated_at": now.isoformat(timespec="seconds"),
        "scope": scope_mode,
        "excluded": ["preview/tokens.css", "preview/vendor/", "preview/*-data.js", "preview/knowledge-sample-data.js"],
        "baseline": {
            "file": "preview/tokens.css",
            "text_px": {k: fmt_num(v) for k, v in sorted(tokens["text"].items(), key=lambda kv: kv[1], reverse=True)},
            "radius": {k: f"{fmt_num(v)}{unit}" for k, (v, unit) in sorted(tokens["radius"].items(), key=lambda kv: kv[1][0])},
            "motion_ms": {k: fmt_num(v) for k, v in sorted(tokens["motion"].items(), key=lambda kv: kv[1])},
        },
        "summary": {
            "files_total": len(files),
            "findings_total": len(findings),
            "color_literals_total": by_kind["warm"] + by_kind["color"],
            "by_kind": by_kind,
        },
        "files": files_meta,
        "counts": counts,
        "findings": sorted(findings, key=lambda f: (f["file"], KIND_RANK[f["kind"]], f["line"], f["column"])),
    }


def md_cell(text: str, limit: int = 150) -> str:
    text = collapse(text).replace("`", "'").replace("|", "\\|")
    if len(text) > limit:
        text = text[:limit - 1] + "…"
    return "`" + text + "`"


def render_markdown(payload: dict) -> str:
    counts = payload["counts"]
    summary = payload["summary"]
    by_kind = summary["by_kind"]
    baseline = payload["baseline"]

    def sort_key(name):
        return tuple(-counts[name][k] for k in KIND_ORDER) + (name,)

    order = sorted(counts, key=sort_key)

    lines = []
    lines.append("# LINT-1 · 档位检查报告")
    lines.append("")
    lines.append(f"- 扫描时刻：{payload['generated_at']}（preview/ 可能正被其他车道并行修改，本报告是该时刻快照）")
    lines.append(f"- 扫描范围：{payload['scope']}")
    lines.append(f"- 排除：{'、'.join(payload['excluded'])}")
    lines.append(f"- 基线：`preview/tokens.css`（只读解析，未写死数值）")
    lines.append("")
    lines.append("### 基线档位")
    lines.append("")
    lines.append("- 字阶：" + "、".join(
        f"--text-{k} {fmt_num(v)}px" for k, v in baseline["text_px"].items()))
    lines.append("- 圆角：" + "、".join(f"--radius-{k} {v}" for k, v in baseline["radius"].items()))
    lines.append("- 时长：" + "、".join(f"--motion-{k} {fmt_num(v)}ms" for k, v in baseline["motion_ms"].items()))
    lines.append("")
    lines.append(f"**合计 {summary['findings_total']} 条**：" + " · ".join(
        f"{KIND_LABEL[k]} {by_kind[k]}" for k in KIND_ORDER)
        + f"（颜色字面量合计 {summary['color_literals_total']}，含暖色）")
    lines.append("")
    lines.append("## 总表")
    lines.append("")
    header = "| 文件 | " + " | ".join(KIND_LABEL[k] for k in KIND_ORDER) + " | 合计 |"
    sep = "|" + "---|" * (len(KIND_ORDER) + 2)
    lines.append(header)
    lines.append(sep)
    for name in order:
        c = counts[name]
        total = sum(c.values())
        cells = [str(c[k]) for k in KIND_ORDER]
        lines.append(f"| `{name}` | " + " | ".join(cells) + f" | {total} |")
    totals = [str(by_kind[k]) for k in KIND_ORDER]
    lines.append("| **合计** | " + " | ".join(totals) + f" | {summary['findings_total']} |")
    lines.append("")
    lines.append("> 口径：暖色是颜色字面量的子集，单列后不再重复计入「颜色字面量」列；「合计」为各列之和。"
                 "列顺序即严重程度，从左到右递减；文件行按该优先级排序。")
    lines.append("")

    lines.append("## 明细（每文件前 15 条）")
    lines.append("")
    grouped = {}
    for f in payload["findings"]:
        grouped.setdefault(f["file"], []).append(f)
    for name in order:
        c = counts[name]
        total = sum(c.values())
        lines.append(f"### `{name}`（{total} 条）")
        lines.append("")
        if total == 0:
            lines.append("无问题。")
            lines.append("")
            continue
        lines.append("| 行:列 | 类别 | 属性 | 片段 |")
        lines.append("|---|---|---|---|")
        shown = 0
        for f in grouped.get(name, []):
            if shown >= DETAILS_PER_FILE:
                break
            prop = f["property"] or "—"
            detail = f["value"]
            lines.append(
                f"| {f['line']}:{f['column']} | {KIND_LABEL[f['kind']]} | {prop} | "
                f"{md_cell(f['snippet'])} ← `{detail}` |"
            )
            shown += 1
        hidden = total - shown
        if hidden > 0:
            lines.append("")
            lines.append(f"另有 {hidden} 条，见 `LINT-report.json`。")
        lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("只读扫描：未修改 `preview/` 下任何文件。生成器：`tools/lint-tokens.py`。")
    lines.append("")
    return "\n".join(lines)


def print_summary(payload: dict):
    summary = payload["summary"]
    by_kind = summary["by_kind"]
    print(f"LINT-1 档位检查 · {payload['generated_at']}")
    print(f"扫描 {summary['files_total']} 个文件 · 合计 {summary['findings_total']} 条："
          + " · ".join(f"{KIND_LABEL[k]} {by_kind[k]}" for k in KIND_ORDER))
    print()
    counts = payload["counts"]

    def sort_key(name):
        return tuple(-counts[name][k] for k in KIND_ORDER) + (name,)

    order = sorted(counts, key=sort_key)
    widths = [max(16, len(n)) for n in order] or [16]
    head = f"{'文件':<{widths[0]}} " + " ".join(f"{KIND_LABEL[k]:>4}" for k in KIND_ORDER) + f" {'合计':>5}"
    print(head)
    for name in order:
        c = counts[name]
        print(f"{name:<{widths[0]}} " + " ".join(f"{c[k]:>6}" for k in KIND_ORDER)
              + f" {sum(c.values()):>5}")
    print(f"{'合计':<{widths[0]}} " + " ".join(f"{by_kind[k]:>6}" for k in KIND_ORDER)
          + f" {summary['findings_total']:>5}")


# ---------------------------------------------------------------- main


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="R12-W2 LINT-1：只读扫描 preview 下的档位/颜色问题，只报告，不改文件。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "默认全量扫描写固定报告；--files 自查模式只打印，除非显式给 --md/--json。\n"
            "退出码：0 正常；--strict 且有问题时 1；用法/基线错误 2。"
        ),
    )
    parser.add_argument("--files", nargs="+", metavar="FILE",
                        help="只扫指定文件（相对项目根或当前目录），供单卡自查")
    parser.add_argument("--strict", action="store_true", help="有任一条问题即退出 1")
    parser.add_argument("--md", metavar="PATH", help="Markdown 报告路径")
    parser.add_argument("--json", metavar="PATH", help="JSON 报告路径")
    parser.add_argument("--quiet", action="store_true", help="不打印表格，只打印一行摘要")
    args = parser.parse_args(argv)

    if not TOKENS.exists():
        print(f"缺少基线 {TOKENS}", file=sys.stderr)
        return 2

    try:
        tokens = load_tokens(TOKENS)
    except UsageError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    self_check = bool(args.files)
    try:
        files = resolve_files(args.files) if self_check else default_files()
    except UsageError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if not files:
        print("没有可扫描的文件。", file=sys.stderr)
        return 2

    findings = []
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        if path.suffix.lower() == ".css":
            findings.extend(scan_css(text, rel(path), tokens))
        else:
            findings.extend(scan_js(text, rel(path), tokens))

    scope_mode = ("--files: " + " ".join(rel(p) for p in files)) if self_check else \
        "默认 preview/*.css + preview/*.js"
    payload = build_payload(files, findings, tokens, scope_mode)
    payload["passed"] = not findings

    if self_check:
        # 自查模式：只写显式指定的产物，避免覆盖全量报告
        md_path = Path(args.md) if args.md else None
        json_path = Path(args.json) if args.json else None
    else:
        md_path = Path(args.md) if args.md else DEFAULT_MD
        json_path = Path(args.json) if args.json else DEFAULT_JSON

    written = []
    if md_path is not None:
        md_path.parent.mkdir(parents=True, exist_ok=True)
        md_path.write_text(render_markdown(payload), encoding="utf-8")
        written.append(md_path)
    if json_path is not None:
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written.append(json_path)

    if args.quiet:
        s = payload["summary"]
        print(f"LINT-1 {s['findings_total']} 条 / {s['files_total']} 文件 · "
              f"暖色 {s['by_kind']['warm']} · 颜色 {s['by_kind']['color']}")
    else:
        print_summary(payload)
        print()
        if written:
            for p in written:
                print(f"报告：{rel(p)}")
        else:
            print("自查模式：未写报告文件（需要落盘请加 --md / --json）。")

    return 1 if (args.strict and findings) else 0


if __name__ == "__main__":
    sys.exit(main())
