#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R13 SEC-1 · 前端转义门禁（只读静态检查，标准库）。

扫描 preview/*.js 里会进 HTML 的字符串：模板字符串的 `${}` 插值，以及 `'<b>' + x + '</b>'` 式的拼接，
找出没转义就进 HTML 的位置，输出「文件:行:列  表达式  建议」。

判定为「安全」：
  1. 被 esc(...) / C.esc(...) / escapeHtml(...) / escape*(...) 包住（后面只许接 replace/slice/trim 等字符串方法）；
  2. 纯数字/布尔表达式：.length、toFixed、Math.*、算术、比较、索引变量 i/idx/index、Number()/parseInt()；
  3. 来自本文件写死的常量表/枚举/字面量，或「返回值本身安全」的本文件函数（如 icon(name) 的 SVG）；
     遍历常量表的 map/forEach/for-of，回调参数同样视为常量；
  4. 三元/&&/|| 的各分支都安全；`.map(cb).join()` 要求回调返回值都安全；
  5. 插值里写了 `/* safe: 理由 */`。
另有两种函数级标注（写在函数声明正前方）：
  /* safe-fn: 理由 */          函数返回值整体可信（如 URL.createObjectURL 的结果、过白名单的属性串）；
  /* safe-slot: a, b — 理由 */  形参 a、b 是「HTML 槽」，函数里可原样插入，但每个调用点传进来的实参必须自己安全。
属性位置更严：
  - href/src/action/formaction/poster 等 URL 属性：值的开头若是插值，必须经过 safeUrl(...)
    （只放行 #/、https:、http:、mailto:、data:image/ 与无协议的相对路径）；值前已有 `#/x/` 之类写死前缀时只要 esc；
  - on*= / srcdoc= 属性里出现任何插值直接报错（/* safe */ 也不放行）；
  - 标签名/属性名/无引号属性值位置，只允许写死的常量或 HTML 片段。

用法：
  python3 tools/lint-xss.py                         # 扫描 preview/*.js（排除数据/样例文件与 sw.js）
  python3 tools/lint-xss.py --files preview/app.js  # 指定文件
  python3 tools/lint-xss.py --json                  # 机器可读（含 start/end 偏移）
  python3 tools/lint-xss.py --summary               # 只打印每个文件的条数
退出码：0 无问题；1 有问题；2 用法/读文件错误。

已知边界：只看「模板字符串」与「含 HTML 字面量的 + 拼接」；不跟踪 `el.innerHTML = someVar` 这类纯变量赋值，
也不跟踪经别名/回调穿过多层函数的数据流；遇到看不懂的写法一律按「不安全」报，宁可多报。
"""

from __future__ import annotations

import argparse
import bisect
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "preview"

# ---------------------------------------------------------------- 配置

ESC_RE = re.compile(r"^(esc|escHtml|escapeHtml|escAttr|escapeAttr|escape[A-Z]\w*|escape)$")
URL_FNS = {"safeUrl", "encodeURIComponent", "encodeURI"}
# 返回写死/已转义 HTML 的公共函数（按末尾名字识别，包括 C.icon / window.Commons.icon）
HTML_FNS = {"icon", "avatar", "brandMark", "svg"}
# window.CommonsXxx.<method>(...) 里会返回已拼好 HTML 的方法名（对应模块自己的模板由本检查另行扫描）
HTML_METHODS = {"render", "preview", "view", "directory", "homePreview", "postActions", "welcome", "home", "panel", "stage", "mount_"}
NUMERIC_FNS = {"Number", "parseInt", "parseFloat", "Boolean", "isNaN", "isFinite"}
NUMERIC_METHODS = {
    "toFixed", "toPrecision", "indexOf", "lastIndexOf", "findIndex", "findLastIndex", "charCodeAt",
    "getTime", "getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes",
    "getSeconds", "getMilliseconds", "getTimezoneOffset", "localeCompare", "includes", "some",
    "every", "startsWith", "endsWith", "test", "hasOwnProperty", "has", "toISOString",
    "toLocaleDateString", "toLocaleTimeString", "toLocaleString", "isArray", "isInteger", "format",
}
PASSTHROUGH_METHODS = {
    "join", "filter", "slice", "concat", "flat", "reverse", "sort", "splice", "at", "find",
    "findLast", "pop", "shift", "toSorted", "toReversed", "with", "fill", "trim", "trimStart",
    "trimEnd", "toUpperCase", "toLowerCase", "padStart", "padEnd", "repeat", "normalize",
    "substring", "substr", "charAt", "toString", "split", "keys", "values", "entries", "flatMap_",
}
INDEX_NAMES = {"i", "j", "idx", "index", "ii", "jj"}
URL_ATTRS = {"href", "src", "action", "formaction", "xlink:href", "poster", "data", "background", "cite", "ping", "manifest"}
KEYWORDS_BEFORE_REGEX = {
    "return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do",
    "instanceof", "yield", "await",
}
NOT_METHOD_NAMES = {"if", "for", "while", "switch", "catch", "with", "function", "return", "typeof"}
DEFAULT_SKIP = re.compile(r"(^|/)(data|archive-data|insights-data|fieldwork-data|knowledge-sample-data|[\w-]+-sample)\.js$|(^|/)sw\.js$")

PUNCTS = sorted(
    [">>>=", "...", "===", "!==", "**=", "<<=", ">>=", "&&=", "||=", "??=", ">>>", "=>", "==", "!=", "<=", ">=",
     "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>"],
    key=len, reverse=True)
OPEN = {"(": ")", "[": "]", "{": "}"}
CLOSE = {")", "]", "}"}
NUM_RE = re.compile(r"0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?")
ID_RE = re.compile(r"[A-Za-z_$\u0080-￿][\w$\u0080-￿]*")
SAFE_FN_RE = re.compile(r"/\*\s*safe-fn\b", re.I)
SAFE_SLOT_RE = re.compile(r"/\*\s*safe-slot\s*:(.*?)\*/", re.I | re.S)
SAFE_COMMENT_RE = re.compile(r"/\*\s*safe\b[^*]*\*/|/\*\s*safe\s*:", re.I)
ASSIGN_OPS = {"=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>=", "&&=", "||=", "??=", "++", "--"}
CONT_TOKENS = {".", "?.", "?", ":", "+", "-", "*", "/", "%", "&&", "||", "??", "==", "===", "!=", "!==", "<", ">",
               "<=", ">=", "=", "(", "[", ",", "&", "|", "^", "=>", "+=", "-=", "*=", "/=", "**", "<<", ">>"}
MUTATORS = {"push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "set", "add", "delete", "clear", "assign"}


# ---------------------------------------------------------------- 词法

class Tok:
    __slots__ = ("k", "t", "s", "e", "nl", "tpl")

    def __init__(self, k, t, s, e, nl, tpl=None):
        self.k, self.t, self.s, self.e, self.nl, self.tpl = k, t, s, e, nl, tpl


class Template:
    __slots__ = ("s", "e", "parts", "exprs")

    def __init__(self, s, e, parts, exprs):
        self.s, self.e, self.parts, self.exprs = s, e, parts, exprs


class Lexer:
    def __init__(self, src):
        self.src = src
        self.n = len(src)

    def lex(self, i, end=None, until_brace=False):
        """返回 (tokens, comments, 结束位置)。until_brace 时遇到未配对的 } 停下（不消耗）。"""
        src = self.src
        end = self.n if end is None else end
        toks, comments = [], []
        depth = 0
        nl = False
        while i < end:
            c = src[i]
            if c == "\n":
                nl = True
                i += 1
                continue
            if c in " \t\r\f\v ﻿":
                i += 1
                continue
            if c == "/" and i + 1 < end and src[i + 1] == "/":
                j = src.find("\n", i)
                i = end if j < 0 or j > end else j
                continue
            if c == "/" and i + 1 < end and src[i + 1] == "*":
                j = src.find("*/", i + 2)
                j = end if j < 0 else j + 2
                comments.append((i, src[i:j]))
                if "\n" in src[i:j]:
                    nl = True
                i = j
                continue
            if c in "'\"":
                j = i + 1
                while j < end and src[j] != c:
                    j += 2 if src[j] == "\\" else 1
                toks.append(Tok("str", src[i:j + 1], i, j + 1, nl))
                nl = False
                i = j + 1
                continue
            if c == "`":
                tpl = self.template(i)
                toks.append(Tok("tmpl", src[i:tpl.e], i, tpl.e, nl, tpl))
                nl = False
                i = tpl.e
                continue
            if c == "/":
                prev = toks[-1] if toks else None
                is_re = (prev is None or (prev.k == "p" and prev.t not in (")", "]", "}")) or
                         (prev.k == "id" and prev.t in KEYWORDS_BEFORE_REGEX))
                if is_re:
                    j = i + 1
                    in_cls = False
                    while j < end:
                        d = src[j]
                        if d == "\\":
                            j += 2
                            continue
                        if d == "[":
                            in_cls = True
                        elif d == "]":
                            in_cls = False
                        elif d == "/" and not in_cls:
                            break
                        elif d == "\n":
                            break
                        j += 1
                    j += 1
                    while j < end and (src[j].isalpha()):
                        j += 1
                    toks.append(Tok("re", src[i:j], i, j, nl))
                    nl = False
                    i = j
                    continue
            m = NUM_RE.match(src, i) if (c.isdigit() or (c == "." and i + 1 < end and src[i + 1].isdigit())) else None
            if m:
                toks.append(Tok("num", m.group(), i, m.end(), nl))
                nl = False
                i = m.end()
                continue
            m = ID_RE.match(src, i)
            if m:
                toks.append(Tok("id", m.group(), i, m.end(), nl))
                nl = False
                i = m.end()
                continue
            if until_brace:
                if c == "{":
                    depth += 1
                elif c == "}":
                    if depth == 0:
                        return toks, comments, i
                    depth -= 1
            p = None
            for cand in PUNCTS:
                if src.startswith(cand, i):
                    p = cand
                    break
            if p == "?." and i + 2 < end and src[i + 2].isdigit():
                p = None
            if p is None:
                p = c
            toks.append(Tok("p", p, i, i + len(p), nl))
            nl = False
            i += len(p)
        return toks, comments, i

    def template(self, i):
        src, n = self.src, self.n
        parts, exprs = [], []
        j = i + 1
        cur = j
        while j < n:
            c = src[j]
            if c == "\\":
                j += 2
            elif c == "`":
                parts.append(src[cur:j])
                return Template(i, j + 1, parts, exprs)
            elif c == "$" and j + 1 < n and src[j + 1] == "{":
                parts.append(src[cur:j])
                es = j + 2
                _, _, k = self.lex(es, until_brace=True)
                exprs.append((es, k))
                j = k + 1
                cur = j
            else:
                j += 1
        parts.append(src[cur:n])
        return Template(i, n, parts, exprs)


# ---------------------------------------------------------------- 种类

# 种类 = (level, const)。level: 0 字面量/数字  1 已校验 URL  2 已转义文本  3 受信 HTML
def comb(ks):
    lvl, const = 0, True
    for k in ks:
        if k is None:
            return None
        lvl = max(lvl, k[0])
        const = const and k[1]
    return (lvl, const)


LITC = (0, True)
LIT = (0, False)
HTML = (3, False)


class FuncVal:
    def __init__(self, toks, a, b):
        self.toks, self.a, self.b = toks, a, b


# ---------------------------------------------------------------- 分析

class Analyzer:
    def __init__(self, src, rel):
        self.src = src
        self.rel = rel
        self.lx = Lexer(src)
        self.top, self.top_comments, _ = self.lx.lex(0)
        self.stream_comments = {id(self.top): self.top_comments}
        self._mt = {}
        self._range_cache = {}
        self.funcs = {}        # name -> [(toks, a, b)]
        self.memo_f = {}
        self.fn_busy = set()
        self.safe_fns = set()
        self.slot_fns = {}
        self.slot_ranges = []
        self.fn_memo = {}
        self.fn_busy2 = set()
        self.index_cache = None
        self.collect(self.top)
        self.line_starts = [0] + [m.end() for m in re.finditer("\n", src)]

    # ---- 括号匹配
    def mt(self, toks):
        key = id(toks)
        m = self._mt.get(key)
        if m is None:
            m, stack = {}, []
            for i, t in enumerate(toks):
                if t.k != "p":
                    continue
                if t.t in OPEN:
                    stack.append(i)
                elif t.t in CLOSE and stack:
                    o = stack.pop()
                    m[o] = i
                    m[i] = o
            self._mt[key] = m
        return m

    def lex_range(self, s, e):
        key = (s, e)
        v = self._range_cache.get(key)
        if v is None:
            toks, comments, _ = self.lx.lex(s, e)
            v = (toks, comments)
            self.stream_comments[id(toks)] = comments
            self._range_cache[key] = v
        return v

    def is_open(self, t):
        return t.k == "p" and t.t in OPEN

    def skip(self, toks, i):
        """如果 i 是开括号，跳到配对括号之后。"""
        t = toks[i]
        if t.k == "p" and t.t in OPEN:
            return self.mt(toks).get(i, i) + 1
        return i + 1

    def split_top(self, toks, lo, hi, pred):
        out, start, i = [], lo, lo
        while i < hi:
            t = toks[i]
            if pred(i, t):
                out.append((start, i))
                start = i + 1
                i += 1
                continue
            i = self.skip(toks, i)
        out.append((start, hi))
        return out

    def find_top(self, toks, lo, hi, pred):
        i = lo
        while i < hi:
            if pred(i, toks[i]):
                return i
            i = self.skip(toks, i)
        return -1

    def operand_end(self, tok):
        if tok.k in ("str", "num", "tmpl", "re"):
            return True
        if tok.k == "id":
            return tok.t not in KEYWORDS_BEFORE_REGEX
        return tok.t in (")", "]", "}")

    def init_end(self, toks, i, hi):
        k = i
        while k < hi:
            t = toks[k]
            if t.k == "p":
                if t.t in OPEN:
                    k = self.mt(toks).get(k, k) + 1
                    continue
                if t.t in CLOSE or t.t in (";", ","):
                    return k
            if k > i and t.nl and self.boundary(toks[k - 1], t):
                return k
            k += 1
        return hi

    def boundary(self, prev, cur):
        if prev.k == "p" and prev.t not in (")", "]", "}", "++", "--"):
            return False
        if cur.k == "p" and cur.t in CONT_TOKENS:
            return False
        if cur.k == "id" and cur.t in ("in", "instanceof", "of"):
            return False
        if cur.k == "tmpl":
            return False
        return True

    # ---- 全局收集：作用域、声明、赋值、函数、变异
    def collect(self, toks):
        mt = self.mt(toks)
        n = len(toks)
        raw_assigns = []   # (name, offset, a, b)
        mut_events = []
        decl_list = []     # (offset, name, a, b)  a/b 为 None 表示无初值或解构
        fn_scopes = []

        def new_scope(lo, hi, params):
            sc = {"lo": lo, "hi": hi, "params": params, "decls": {}, "unsafe": set(), "assigns": {}, "memo": {}, "busy": set(), "mutated": set()}
            fn_scopes.append(sc)

        def ids_in(a, b):
            return {toks[q].t for q in range(a, b) if toks[q].k == "id"}

        for i, t in enumerate(toks):
            prev = toks[i - 1] if i else None
            nxt = toks[i + 1] if i + 1 < n else None
            if t.k == "id" and t.t in ("const", "let", "var"):
                j = i + 1
                while j < n:
                    tj = toks[j]
                    if tj.k == "p" and tj.t in ("[", "{"):
                        e = mt.get(j, j)
                        for q in range(j, e):
                            if toks[q].k == "id":
                                decl_list.append((tj.s, toks[q].t, None, None))
                        j = e + 1
                        if j < n and toks[j].t == "=":
                            j = self.init_end(toks, j + 1, n)
                    elif tj.k == "id":
                        j += 1
                        if j < n and toks[j].t == "=":
                            e = self.init_end(toks, j + 1, n)
                            decl_list.append((tj.s, tj.t, j + 1, e))
                            if self.looks_fn(toks, j + 1, e):
                                self.funcs.setdefault(tj.t, []).append((toks, j + 1, e))
                                if self.has_safe_fn(toks, i):
                                    self.safe_fns.add(tj.t)
                                self.note_slots(toks, i, tj.t, j + 1, e)
                            j = e
                        else:
                            decl_list.append((tj.s, tj.t, None, None))
                    else:
                        break
                    if j < n and toks[j].t == ",":
                        j += 1
                        continue
                    break
            elif t.k == "id" and nxt is not None and nxt.k == "p" and nxt.t in ASSIGN_OPS \
                    and not (prev is not None and prev.k == "p" and prev.t in (".", "?.")) \
                    and not (prev is not None and prev.k == "id" and prev.t in ("const", "let", "var")):
                if nxt.t not in ("-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>=", "++", "--"):
                    b = self.init_end(toks, i + 2, n)
                    raw_assigns.append((t.t, t.s, i + 2, b))
                    if self.looks_fn(toks, i + 2, b):
                        self.funcs.setdefault(t.t, []).append((toks, i + 2, b))
            if t.k == "id" and t.t == "function":
                j = i + 1
                if j < n and toks[j].t == "*":
                    j += 1
                name = None
                if j < n and toks[j].k == "id":
                    name = toks[j].t
                    j += 1
                if j < n and toks[j].t == "(":
                    pe = mt.get(j, j)
                    if pe + 1 < n and toks[pe + 1].t == "{":
                        be = mt.get(pe + 1, pe + 1)
                        new_scope(toks[pe + 1].s, toks[be].e, ids_in(j + 1, pe))
                        if name:
                            self.funcs.setdefault(name, []).append((toks, i, be + 1))
                            if self.has_safe_fn(toks, i):
                                self.safe_fns.add(name)
                            self.note_slots(toks, i, name, i, be + 1)
            elif t.k == "id" and t.t == "catch" and nxt is not None and nxt.t == "(":
                pe = mt.get(i + 1, i + 2)
                if pe + 1 < n and toks[pe + 1].t == "{":
                    be = mt.get(pe + 1, pe + 1)
                    new_scope(toks[pe + 1].s, toks[be].e, ids_in(i + 2, pe))
            elif t.k == "p" and t.t == "=>":
                if prev is not None and prev.k == "id":
                    params = {prev.t}
                elif prev is not None and prev.t == ")":
                    o = mt.get(i - 1)
                    params = ids_in(o + 1, i - 1) if o is not None else set()
                else:
                    params = set()
                if i + 1 < n:
                    if toks[i + 1].t == "{":
                        be = mt.get(i + 1, i + 1)
                        new_scope(toks[i + 1].s, toks[be].e, params)
                    else:
                        e = self.init_end(toks, i + 1, n)
                        if e > i + 1:
                            new_scope(toks[i + 1].s, toks[e - 1].e, params)
            elif t.k == "id" and t.t not in NOT_METHOD_NAMES and nxt is not None and nxt.t == "(":
                pe = mt.get(i + 1)
                if pe is not None and pe + 1 < n and toks[pe + 1].t == "{" and not (prev is not None and prev.k == "p" and prev.t == "."):
                    be = mt.get(pe + 1, pe + 1)
                    new_scope(toks[pe + 1].s, toks[be].e, ids_in(i + 2, pe))
            # 变异：NAME.x.y = / NAME.push( / NAME[..] =
            if t.k == "id" and not (prev is not None and prev.k == "p" and prev.t in (".", "?.")):
                j, last, segs = i + 1, None, 0
                while j < n:
                    tj = toks[j]
                    if tj.k == "p" and tj.t in (".", "?.") and j + 1 < n and toks[j + 1].k == "id":
                        last = toks[j + 1].t
                        segs += 1
                        j += 2
                    elif tj.k == "p" and tj.t == "[":
                        last = None
                        segs += 1
                        j = mt.get(j, j) + 1
                    else:
                        break
                if segs and j < n:
                    tj = toks[j]
                    if tj.k == "p" and tj.t in ASSIGN_OPS:
                        mut_events.append((t.t, t.s))
                    elif tj.t == "(" and last in ("push", "unshift") and segs == 1:
                        pe = mt.get(j, j)
                        for a2, b2 in self.split_top(toks, j + 1, pe, lambda k, x: x.k == "p" and x.t == ","):
                            if a2 < b2:
                                raw_assigns.append((t.t, t.s, a2, b2))
                    elif tj.t == "(" and last in MUTATORS:
                        mut_events.append((t.t, t.s))
                if t.t == "Object" and i + 4 < n and toks[i + 1].t == "." and toks[i + 2].t == "assign" and toks[i + 3].t == "(" \
                        and toks[i + 4].k == "id":
                    mut_events.append((toks[i + 4].t, toks[i + 4].s))
        self.fn_scopes = fn_scopes
        self.module = {"lo": 0, "hi": 1 << 60, "params": set(), "decls": {}, "unsafe": set(), "assigns": {}, "memo": {}, "busy": set(), "mutated": set()}
        for off, name, a, b in decl_list:
            sc = self.chain_at(off)[0]
            if a is None:
                sc["unsafe"].add(name)
            else:
                sc["decls"].setdefault(name, []).append((toks, a, b))
        for name, off in mut_events:
            for sc in self.chain_at(off):
                if name in sc["params"]:
                    break
                if name in sc["decls"] or name in sc["unsafe"] or sc is self.module:
                    sc["mutated"].add(name)
                    break
        for name, off, a, b in raw_assigns:
            for sc in self.chain_at(off):
                if name in sc["params"]:
                    break
                if name in sc["decls"] or name in sc["unsafe"] or sc is self.module:
                    sc["assigns"].setdefault(name, []).append((toks, a, b))
                    break

    def note_slots(self, toks, i, name, a, b):
        lo = toks[i - 1].e if i else 0
        hi = toks[i].s
        for c in self.top_comments:
            if lo <= c[0] < hi:
                m = SAFE_SLOT_RE.match(c[1])
                if m:
                    names = set(re.findall(r"[A-Za-z_$][\w$]*", re.split(r"[—;]|--", m.group(1))[0]))
                    self.slot_fns[name] = names
                    self.slot_ranges.append((toks[a].s, toks[b - 1].e, names))

    def has_safe_fn(self, toks, i):
        lo = toks[i - 1].e if i else 0
        hi = toks[i].s
        if i and toks[i - 1].t in ("export", "async"):
            lo = toks[i - 2].e if i > 1 else 0
        return any(lo <= c[0] < hi and SAFE_FN_RE.match(c[1]) for c in self.top_comments)

    def looks_fn(self, toks, a, b):
        return (a < b and toks[a].t == "function") or self.looks_arrow(toks, a, b)

    def chain_at(self, off):
        """包含 off 的函数作用域，由内到外，最后是模块层。"""
        hits = [sc for sc in self.fn_scopes if sc["lo"] <= off <= sc["hi"]]
        hits.sort(key=lambda sc: sc["hi"] - sc["lo"])
        hits.append(self.module)
        return hits

    def looks_arrow(self, toks, a, b):
        j = a
        if j < b and toks[j].t == "async":
            j += 1
        if j < b and toks[j].k == "id" and j + 1 < b and toks[j + 1].t == "=>":
            return True
        if j < b and toks[j].t == "(":
            pe = self.mt(toks).get(j)
            return pe is not None and pe + 1 < b and toks[pe + 1].t == "=>"
        return False

    # ---- 标识符
    def ident_kind(self, name, env, off):
        if name in env:
            v = env[name]
            return None if v == "U" else v
        if name in ("true", "false", "null", "undefined", "NaN", "Infinity"):
            return LITC
        for sc in self.chain_at(off):
            if name in sc["params"]:
                for lo, hi, names in self.slot_ranges:
                    if lo <= off <= hi and name in names:
                        return HTML
                return LIT if name in INDEX_NAMES else None
            if name in sc["unsafe"]:
                return None
            if name in sc["decls"] or (sc is self.module and name in sc["assigns"]):
                return self.scope_kind(sc, name)
        return None

    def scope_kind(self, sc, name):
        if name in sc["memo"]:
            return sc["memo"][name]
        if name in sc["busy"]:
            return LIT
        sc["busy"].add(name)
        rngs = sc["decls"].get(name, []) + sc["assigns"].get(name, [])
        ks = [self.an(toks, a, b, {}) for toks, a, b in rngs]
        sc["busy"].discard(name)
        kind = comb(ks)
        if kind is not None and kind[1] and name in sc["mutated"]:
            kind = None
        sc["memo"][name] = kind
        return kind

    # ---- 表达式
    def an(self, toks, lo, hi, env):
        if lo >= hi:
            return LITC
        parts = self.split_top(toks, lo, hi, lambda i, t: t.k == "p" and t.t == ",")
        if len(parts) > 1:
            lo, hi = parts[-1]
            if lo >= hi:
                return LITC
        if self.find_top(toks, lo, hi, lambda i, t: t.k == "p" and t.t in ("=>",)) >= 0:
            return None
        if self.find_top(toks, lo, hi, lambda i, t: t.k == "p" and t.t in ASSIGN_OPS and t.t not in ("++", "--")) >= 0:
            return None
        q = self.find_top(toks, lo, hi, lambda i, t: t.k == "p" and t.t == "?")
        if q >= 0:
            depth, colon = 0, -1
            i = q + 1
            while i < hi:
                t = toks[i]
                if t.k == "p" and t.t == "?":
                    depth += 1
                elif t.k == "p" and t.t == ":":
                    if depth == 0:
                        colon = i
                        break
                    depth -= 1
                i = self.skip(toks, i)
            if colon < 0:
                return None
            return comb([self.an(toks, q + 1, colon, env), self.an(toks, colon + 1, hi, env)])
        parts = self.split_top(toks, lo, hi, lambda i, t: t.k == "p" and t.t in ("||", "??"))
        if len(parts) > 1:
            return comb([self.an(toks, a, b, env) for a, b in parts])
        parts = self.split_top(toks, lo, hi, lambda i, t: t.k == "p" and t.t == "&&")
        if len(parts) > 1:
            return self.an(toks, parts[-1][0], parts[-1][1], env)
        cmp_ops = {"==", "===", "!=", "!==", "<", ">", "<=", ">="}
        if self.find_top(toks, lo, hi, lambda i, t: (t.k == "p" and t.t in cmp_ops) or (t.k == "id" and t.t in ("instanceof", "in"))) >= 0:
            return LIT

        def binary(sym_set):
            return lambda i, t: (t.k == "p" and t.t in sym_set and i > lo and self.operand_end(toks[i - 1]))

        parts = self.split_top(toks, lo, hi, binary({"+"}))
        if len(parts) > 1:
            lits = "".join(toks[a].t[1:-1] for a, b in parts if b - a == 1 and toks[a].k == "str")
            if self.is_html(Template(0, 0, [lits], []), empty_rule=False):
                return HTML     # 拼出来的 HTML 片段：里面的动态项由拼接检查逐个把关
            return comb([self.an(toks, a, b, env) for a, b in parts])
        if self.find_top(toks, lo, hi, binary({"-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"})) >= 0:
            return LIT
        t0 = toks[lo]
        if t0.k == "p" and t0.t in ("!", "~"):
            return LIT
        if t0.k == "p" and t0.t in ("-", "+"):
            return LIT
        if t0.k == "id" and t0.t in ("typeof", "void"):
            return LIT
        if t0.k == "p" and t0.t == "...":
            return self.an(toks, lo + 1, hi, env)
        return self.chain(toks, lo, hi, env)

    def chain(self, toks, lo, hi, env):
        mt = self.mt(toks)
        i = lo
        t = toks[i]
        cur, callee, ismethod = None, None, False
        path = []
        if t.k in ("str", "num"):
            cur = LITC
            i += 1
        elif t.k == "re":
            cur = LIT
            i += 1
        elif t.k == "tmpl":
            cur = self.tmpl_kind(t.tpl, env)
            i += 1
        elif t.k == "p" and t.t == "(":
            j = mt.get(i)
            if j is None:
                return None
            if self.looks_arrow(toks, i + 1, j) or (i + 1 < j and toks[i + 1].t in ("function", "async")):
                cur = FuncVal(toks, i + 1, j)
            else:
                cur = self.an(toks, i + 1, j, env)
            i = j + 1
        elif t.k == "p" and t.t == "[":
            j = mt.get(i)
            if j is None:
                return None
            cur = comb([self.an(toks, a, b, env) for a, b in self.split_top(toks, i + 1, j, lambda k, x: x.k == "p" and x.t == ",") if a < b])
            i = j + 1
        elif t.k == "p" and t.t == "{":
            j = mt.get(i)
            if j is None:
                return None
            cur = self.object_kind(toks, i + 1, j, env)
            i = j + 1
        elif t.k == "id":
            name = t.t
            if name == "new":
                k = i + 1
                while k < hi and (toks[k].k == "id" or toks[k].t == "."):
                    k += 1
                if k < hi and toks[k].t == "(":
                    k = mt.get(k, k) + 1
                cur = None
                i = k
            elif name in ("function", "async"):
                return None
            else:
                path = [name]
                nxt = toks[i + 1] if i + 1 < hi else None
                if nxt is not None and nxt.k == "p" and nxt.t == "(":
                    callee, ismethod = name, False
                    cur = None
                else:
                    cur = self.ident_kind(name, env, t.s)
                i += 1
        else:
            return None
        while i < hi:
            t = toks[i]
            if t.k == "p" and t.t == "?." and i + 1 < hi and toks[i + 1].t in ("[", "("):
                i += 1
                continue
            if t.k == "p" and t.t in (".", "?."):
                if i + 1 >= hi or toks[i + 1].k != "id":
                    return None
                name = toks[i + 1].t
                if i + 2 < hi and toks[i + 2].t == "(":
                    callee, ismethod = name, True
                    recv = cur
                    i += 2
                    continue
                path.append(name)
                if name in ("length", "size"):
                    cur = LIT
                elif isinstance(cur, FuncVal):
                    cur = None
                i += 2
            elif t.k == "p" and t.t == "(":
                j = mt.get(i)
                if j is None:
                    return None
                cur = self.call(toks, cur if ismethod else None, callee, ismethod, path, (i + 1, j), env, recv if ismethod else cur)
                path = []
                callee, ismethod = None, False
                i = j + 1
            elif t.k == "p" and t.t == "[":
                j = mt.get(i)
                if j is None:
                    return None
                if isinstance(cur, FuncVal):
                    cur = None
                i = j + 1
            else:
                return None
        return cur

    def object_kind(self, toks, lo, hi, env):
        ks = []
        for a, b in self.split_top(toks, lo, hi, lambda k, x: x.k == "p" and x.t == ","):
            if a >= b:
                continue
            if toks[a].t == "...":
                ks.append(self.an(toks, a + 1, b, env))
                continue
            c = self.find_top(toks, a, b, lambda k, x: x.k == "p" and x.t == ":")
            if c >= 0:
                ks.append(self.an(toks, c + 1, b, env))
            elif b - a == 1 and toks[a].k == "id":
                ks.append(self.ident_kind(toks[a].t, env, toks[a].s))
            else:
                ks.append(None)
        return comb(ks)

    def tmpl_kind(self, tpl, env):
        if self.is_html(tpl):
            return HTML
        ks = []
        for s, e in tpl.exprs:
            ks.append(self.expr_kind(s, e, env))
        kind = comb(ks)
        if kind is None:
            return None
        if kind[0] == 2 and tpl.parts and url_prefix_ok(tpl.parts[0]):
            return (1, False)
        return (kind[0], False)

    def expr_kind(self, s, e, env):
        toks, _ = self.lex_range(s, e)
        return self.an(toks, 0, len(toks), env)

    # ---- 调用
    def call(self, toks, recv_state, callee, ismethod, path, rng, env, recv):
        a, b = rng
        if isinstance(recv, FuncVal) and not ismethod:
            return self.fn_return(recv.toks, recv.a, recv.b, env, [])
        name = callee
        if name is None:
            return None
        if ESC_RE.match(name):
            return (2, False)
        if name in URL_FNS:
            return (1, False)
        if name in HTML_FNS:
            return HTML
        if ismethod and name in HTML_METHODS and any(re.match(r"^Commons[A-Z]\w*$", x) for x in path):
            return HTML
        if name in self.safe_fns:
            return LIT
        root = path[0] if path else None
        if root in ("Math", "Number", "performance") or (root == "Date" and name == "now") or name in NUMERIC_FNS and not ismethod:
            return LIT
        args = [(x, y) for x, y in self.split_top(toks, a, b, lambda k, t: t.k == "p" and t.t == ",") if x < y]
        if root == "Array" and ismethod:
            if name == "isArray":
                return LIT
            if name == "from":
                if not args:
                    return LITC
                src_k = self.an(toks, args[0][0], args[0][1], env)
                const = src_k is not None and src_k[1] or self.is_length_obj(toks, args[0])
                if len(args) > 1:
                    r = self.fn_return(toks, args[1][0], args[1][1], env, [LITC if const else "U", LIT])
                    return None if r is None else (r[0], r[1] and const)
                return LITC if const else src_k
            return None
        if root == "Object" and ismethod and name in ("keys", "values", "entries") and args:
            k = self.an(toks, args[0][0], args[0][1], env)
            return k if (k is not None and k[1]) else None
        if root == "String" and not ismethod and args:
            return self.an(toks, args[0][0], args[0][1], env)
        if not ismethod:
            if name == "Array" or name == "Symbol":
                return LITC
            if name == "String" and args:
                return self.an(toks, args[0][0], args[0][1], env)
            if name in self.funcs:
                aks = [None if self.is_fn_arg(toks, x, y) else self.an(toks, x, y, env) for x, y in args]
                if name in self.slot_fns:
                    for ftoks, fa, fb in self.funcs[name][:1]:
                        pf = self.parse_fn(ftoks, fa, fb)
                        if pf:
                            groups = self.split_top(ftoks, pf[0], pf[1], lambda k, t: t.k == "p" and t.t == ",")
                            for gi, (ga, gb) in enumerate(groups):
                                pname = next((ftoks[q].t for q in range(ga, gb) if ftoks[q].k == "id"), None)
                                if pname in self.slot_fns[name] and gi < len(aks) and aks[gi] is None:
                                    return None
                return self.func_kind(name, aks)
            return None
        # 方法调用
        cur = recv
        if isinstance(cur, FuncVal):
            cur = None
        if name in ("map", "flatMap") and args:
            if args[0][1] - args[0][0] == 1 and toks[args[0][0]].k == "id" and ESC_RE.match(toks[args[0][0]].t):
                return (2, False)
            if args[0][1] - args[0][0] == 1 and toks[args[0][0]].k == "id":
                refs = self.fn_refs(toks[args[0][0]].t, toks[args[0][0]].s)
                if refs:
                    return comb([self.func_kind(r, [LITC if (cur is not None and cur[1]) else None, LIT]) for r in refs])
            const = cur is not None and cur[1]
            r = self.fn_return(toks, args[0][0], args[0][1], env, [LITC if const else "U", LIT])
            return None if r is None else (r[0], r[1] and const)
        if name in NUMERIC_METHODS:
            return LIT
        if name in ("replace", "replaceAll"):
            if cur is None:
                return None
            extra = []
            if len(args) > 1:
                a2 = args[1]
                if toks[a2[0]].k in ("str", "tmpl", "num") and a2[1] - a2[0] == 1:
                    extra.append(self.an(toks, a2[0], a2[1], env))
            return comb([cur] + extra)
        if name == "reduce":
            if len(args) > 1:
                k = self.an(toks, args[1][0], args[1][1], env)
                if k is not None and k[0] == 0 and toks[args[1][0]].k == "num":
                    return LIT
            return None
        if name == "concat":
            if cur is None:
                return None
            return comb([cur] + [self.an(toks, x, y, env) for x, y in args])
        if name in PASSTHROUGH_METHODS:
            return cur
        if cur is not None and cur[1]:
            ks = [cur] + [self.an(toks, x, y, env) for x, y in args if toks[x].t != "=>" and not self.looks_arrow(toks, x, y)]
            k = comb(ks)
            return k
        return None

    def is_length_obj(self, toks, rng):
        a, b = rng
        return toks[a].t == "{" and a + 1 < b and toks[a + 1].t == "length"

    # ---- 函数返回
    def fn_refs(self, name, off):
        """map(row) 里的 row：要么是本文件函数，要么是由 cond ? f : g 之类赋值而来。"""
        if name in self.funcs:
            return [name]
        for sc in self.chain_at(off):
            if name in sc["params"]:
                return []
            rngs = sc["decls"].get(name, []) + sc["assigns"].get(name, [])
            if rngs:
                refs = []
                for toks, a, b in rngs:
                    if b - a == 0:
                        return []
                    for q in range(a, b):
                        if toks[q].k == "id" and toks[q].t in self.funcs:
                            refs.append(toks[q].t)
                return refs
        return []

    def is_fn_arg(self, toks, x, y):
        return self.find_top(toks, x, y, lambda k, t: t.k == "p" and t.t == "=>") >= 0 or (x < y and toks[x].t == "function")

    def func_kind(self, name, argkinds):
        ks = [self.fn_return(toks, a, b, {}, argkinds, LIT) for toks, a, b in self.funcs[name]]
        return comb(ks)

    def parse_fn(self, toks, a, b):
        """返回 (params_lo, params_hi, body_lo, body_hi, is_block)，失败 None。"""
        mt = self.mt(toks)
        j = a
        if j < b and toks[j].t == "async":
            j += 1
        if j < b and toks[j].k == "id" and toks[j].t == "function":
            j += 1
            if j < b and toks[j].t == "*":
                j += 1
            if j < b and toks[j].k == "id":
                j += 1
            if j < b and toks[j].t == "(":
                pe = mt.get(j)
                if pe is not None and pe + 1 < b and toks[pe + 1].t == "{":
                    be = mt.get(pe + 1, b)
                    return (j + 1, pe, pe + 2, be, True)
            return None
        if j < b and toks[j].k == "id" and j + 1 < b and toks[j + 1].t == "=>":
            ps, pe, body = j, j + 1, j + 2
        elif j < b and toks[j].t == "(":
            pe_ = mt.get(j)
            if pe_ is None or pe_ + 1 >= b or toks[pe_ + 1].t != "=>":
                return None
            ps, pe, body = j + 1, pe_, pe_ + 2
        else:
            return None
        if body < b and toks[body].t == "{":
            be = mt.get(body, b)
            return (ps, pe, body + 1, be, True)
        return (ps, pe, body, b, False)

    def fn_return(self, toks, a, b, env, argkinds, default="U"):
        """argkinds: 逐个形参绑定的种类（None 或 'U' 表示不可信）；缺省形参用 default。"""
        pf = self.parse_fn(toks, a, b)
        if pf is None:
            return None
        key = (id(toks), a, tuple("U" if k is None else k for k in argkinds), default)
        if key in self.fn_memo:
            return self.fn_memo[key]
        if key in self.fn_busy2:
            return LIT
        self.fn_busy2.add(key)
        r = self.fn_return_body(toks, pf, env, argkinds, default)
        self.fn_busy2.discard(key)
        if not env:
            self.fn_memo[key] = r
        return r

    def fn_return_body(self, toks, pf, env, argkinds, default):
        ps, pe, bl, bh, is_block = pf
        env2 = dict(env)
        groups = self.split_top(toks, ps, pe, lambda k, t: t.k == "p" and t.t == ",")
        for gi, (ga, gb) in enumerate(groups):
            val = argkinds[gi] if gi < len(argkinds) else default
            if val is None:
                val = "U"
            for q in range(ga, gb):
                if toks[q].k == "id":
                    env2[toks[q].t] = val
        if not is_block:
            return self.an(toks, bl, bh, env2)
        ks = []
        i = bl
        mt = self.mt(toks)
        while i < bh:
            t = toks[i]
            # 跳过嵌套函数体：它们的 return 不是本函数的返回值
            if t.k == "p" and t.t == "=>" and i + 1 < bh and toks[i + 1].t == "{":
                i = mt.get(i + 1, i + 1) + 1
                continue
            if t.k == "id" and t.t == "function":
                j = i + 1
                while j < bh and toks[j].t != "(":
                    j += 1
                j = mt.get(j, j) + 1
                if j < bh and toks[j].t == "{":
                    i = mt.get(j, j) + 1
                    continue
            if t.k == "id" and t.t == "return":
                if i + 1 >= bh or (toks[i + 1].k == "p" and toks[i + 1].t in (";", "}")) or toks[i + 1].nl:
                    ks.append(LITC)
                    i += 1
                    continue
                e = self.init_end(toks, i + 1, bh)
                ks.append(self.an(toks, i + 1, e, env2))
                i = max(e, i + 1)
                continue
            i += 1
        return comb(ks) if ks else LITC

    # ---- 回调参数绑定（遍历常量表的 map/forEach/for-of）
    def bindings(self, toks, env):
        out = []
        mt = self.mt(toks)
        n = len(toks)
        for j, t in enumerate(toks):
            if t.k == "p" and t.t in (".", "?.") and j + 2 < n and toks[j + 1].t in ("map", "flatMap", "forEach") and toks[j + 2].t == "(":
                pe = mt.get(j + 2)
                if pe is None:
                    continue
                args = [(x, y) for x, y in self.split_top(toks, j + 3, pe, lambda k, x: x.k == "p" and x.t == ",") if x < y]
                if not args:
                    continue
                pf = self.parse_fn(toks, args[0][0], args[0][1])
                if pf is None:
                    continue
                start = self.chain_start(toks, j)
                recv = self.an(toks, start, j, env) if start is not None else None
                const = recv is not None and recv[1]
                self.add_binding(out, toks, pf, LITC if const else "U")
            elif t.k == "id" and t.t == "for" and j + 1 < n and toks[j + 1].t == "(":
                pe = mt.get(j + 1)
                if pe is None:
                    continue
                of = self.find_top(toks, j + 2, pe, lambda k, x: x.k == "id" and x.t == "of")
                if of < 0:
                    continue
                recv = self.an(toks, of + 1, pe, env)
                const = recv is not None and recv[1]
                if pe + 1 < n and toks[pe + 1].t == "{":
                    body = (pe + 2, mt.get(pe + 1, n))
                else:
                    body = (pe + 1, self.init_end(toks, pe + 1, n))
                names = {toks[q].t: (LITC if const else "U") for q in range(j + 2, of) if toks[q].k == "id" and toks[q].t not in ("const", "let", "var")}
                out.append((body[0], body[1], names))
        return out

    def add_binding(self, out, toks, pf, first):
        ps, pe, bl, bh, _ = pf
        groups = self.split_top(toks, ps, pe, lambda k, t: t.k == "p" and t.t == ",")
        names = {}
        for gi, (ga, gb) in enumerate(groups):
            val = first if gi == 0 else (LIT if gi == 1 else "U")
            for q in range(ga, gb):
                if toks[q].k == "id":
                    names[toks[q].t] = val
        out.append((bl, bh, names))

    def chain_start(self, toks, j):
        """从下标 j（一个 '.'）往回找到接收者表达式的起点。"""
        mt = self.mt(toks)
        p = j - 1
        while p >= 0:
            t = toks[p]
            if t.k == "p" and t.t in (")", "]"):
                o = mt.get(p)
                if o is None:
                    return None
                p = o - 1
                if p >= 0 and (toks[p].k == "id" and toks[p].t not in KEYWORDS_BEFORE_REGEX or toks[p].t in (")", "]")):
                    if toks[p].k == "id":
                        if p >= 1 and toks[p - 1].t in (".", "?."):
                            p -= 2
                            continue
                        return p
                    continue
                return o
            if t.k in ("id", "str", "tmpl", "num"):
                if p >= 1 and toks[p - 1].k == "p" and toks[p - 1].t in (".", "?."):
                    p -= 2
                    continue
                return p
            return None
        return None

    # ---- 模板 HTML 判定与上下文
    def is_html(self, tpl, empty_rule=True):
        static = "".join(tpl.parts)
        if re.search(r"<[A-Za-z/!]", static):
            return True
        if re.search(r"""(?<![\[\w-])[\w:@-]+\s*=\s*["']""", static):
            return True
        if re.search(r"&#?\w+;", static):
            return True
        if empty_rule and not static.strip() and tpl.exprs:
            return True
        return False

    def contexts(self, tpl):
        """返回每个插值的上下文 dict。"""
        parts = tpl.parts
        first = parts[0]
        state = "text"
        if "<" not in first and re.search(r"""(?<![\[\w-])[\w:@-]+\s*=\s*["']""", first):
            state = "tag"
        attr = ""
        quote = None
        prefix = ""
        prior = False
        tag = ""
        out = []
        for idx, part in enumerate(parts):
            i, n = 0, len(part)
            while i < n:
                c = part[i]
                if c == "\\":
                    i += 2
                    continue
                if state == "text":
                    if c == "<":
                        if part.startswith("<!--", i):
                            j = part.find("-->", i)
                            i = n if j < 0 else j + 3
                            continue
                        if i + 1 < n and (part[i + 1].isalpha() or part[i + 1] == "/"):
                            state, tag = "tagname", ""
                            i += 1
                            continue
                    i += 1
                elif state == "tagname":
                    if c.isspace():
                        state = "tag"
                    elif c == ">":
                        state = "text"
                    else:
                        tag += c
                    i += 1
                elif state == "tag":
                    if c == ">":
                        state = "text"
                    elif c.isspace() or c == "/":
                        pass
                    else:
                        state, attr = "attrname", c
                    i += 1
                elif state == "attrname":
                    if c == "=":
                        state = "eq"
                    elif c.isspace():
                        state = "attrend"
                    elif c == ">":
                        state = "text"
                    else:
                        attr += c
                    i += 1
                elif state == "attrend":
                    if c == "=":
                        state = "eq"
                        i += 1
                    elif c.isspace():
                        i += 1
                    else:
                        state = "tag"
                elif state == "eq":
                    if c.isspace():
                        i += 1
                    elif c in "\"'":
                        state, quote, prefix, prior = "val", c, "", False
                        i += 1
                    else:
                        state, quote, prefix, prior = "val", None, "", False
                elif state == "val":
                    if quote is not None and c == quote:
                        state = "tag"
                    elif quote is None and (c.isspace() or c == ">"):
                        state = "text" if c == ">" else "tag"
                    else:
                        prefix += c
                    i += 1
            if idx < len(tpl.exprs):
                out.append({"state": state, "attr": attr.lower(), "quote": quote, "prefix": prefix, "prior": prior, "tag": tag.lower()})
                # 占位符推进状态机
                if state == "tag":
                    state, attr = "attrname", "\0"
                elif state == "eq":
                    state, quote, prefix, prior = "val", None, "", True
                elif state == "val":
                    prior = True
        return out

    # ---- 扫描
    def pos(self, offset):
        ln = bisect.bisect_right(self.line_starts, offset) - 1
        return ln + 1, offset - self.line_starts[ln] + 1

    def scan(self):
        findings = []
        self.scan_stream(self.top, {}, findings)
        # 外层表达式里已有更里面的问题时只报最里面那条（根因）
        findings = [f for f in findings if not any(g is not f and g["start"] >= f["start"] and g["end"] <= f["end"] and
                                                   (g["start"], g["end"]) != (f["start"], f["end"]) for g in findings)]
        seen, uniq = set(), []
        for f in findings:
            key = (f["start"], f["end"])
            if key not in seen:
                seen.add(key)
                uniq.append(f)
        uniq.sort(key=lambda f: (f["line"], f["col"]))
        return uniq

    def scan_stream(self, toks, env, findings):
        binds = sorted(self.bindings(toks, env), key=lambda b: b[0])

        def env_at(k):
            env_k = dict(env)
            for lo, hi, names in binds:
                if lo <= k < hi:
                    env_k.update(names)
            return env_k

        for k, t in enumerate(toks):
            if t.k == "tmpl":
                self.scan_template(t.tpl, env_at(k), findings)
        self.scan_concat(toks, 0, len(toks), env_at, findings)

    # ---- 字符串拼接：'<b>' + x + '</b>' 当作虚拟模板检查
    CHAIN_BREAK = {",", ";", "?", ":", "&&", "||", "??", "=", "+=", "==", "===", "!=", "!==", "<", ">", "<=", ">=", "=>", "-", "*", "/", "%",
                   "-=", "*=", "/=", "%=", "||=", "&&=", "??=", "!", "..."}
    CHAIN_WORDS = {"return", "case", "throw", "else", "do", "in", "of", "instanceof", "yield", "await", "typeof", "void", "new_"}

    def scan_concat(self, toks, lo, hi, env_at, findings):
        mt = self.mt(toks)
        operands, cur = [], lo
        i = lo

        def flush(end):
            nonlocal operands, cur
            if operands or end > cur:
                operands.append((cur, end))
            if len(operands) >= 2:
                self.chain_done(toks, operands, env_at, findings)
            operands = []

        while i < hi:
            t = toks[i]
            if i > lo and t.nl and cur < i and self.boundary(toks[i - 1], t):
                flush(i)
                cur = i
            if t.k == "p" and t.t in OPEN:
                j = mt.get(i, i)
                self.scan_concat(toks, i + 1, j, env_at, findings)
                i = j + 1
                continue
            if t.k == "p" and t.t == "+" and i > cur and self.operand_end(toks[i - 1]):
                operands.append((cur, i))
                cur = i + 1
            elif (t.k == "p" and t.t in self.CHAIN_BREAK) or (t.k == "id" and t.t in self.CHAIN_WORDS):
                flush(i)
                cur = i + 1
            i += 1
        flush(hi)

    def chain_done(self, toks, operands, env_at, findings):
        parts, exprs, buf = [], [], ""
        has_str = False
        for a, b in operands:
            if a >= b:
                return
            if b - a == 1 and toks[a].k == "str":
                buf += toks[a].t[1:-1]
                has_str = True
            elif b - a == 1 and toks[a].k == "num":
                buf += toks[a].t
            else:
                parts.append(buf)
                buf = ""
                near = [c for c in self.stream_comments.get(id(toks), [])
                        if (toks[a - 1].s if a > 0 else toks[a].s) <= c[0] < (toks[b].s if b < len(toks) else toks[b - 1].e)]
                exprs.append((toks[a].s, toks[b - 1].e, a, any(SAFE_COMMENT_RE.match(c[1]) for c in near)))
        parts.append(buf)
        if not has_str or not exprs:
            return
        vt = Template(0, 0, parts, [(x, y) for x, y, _, _ in exprs])
        if not self.is_html(vt, empty_rule=False):
            return
        ctxs = self.contexts(vt)
        for idx, (s, e, k, near_safe) in enumerate(exprs):
            etoks, comments = self.lex_range(s, e)
            safe_comment = near_safe or any(SAFE_COMMENT_RE.match(c[1]) for c in comments)
            f = self.judge(etoks, ctxs[idx], env_at(k), safe_comment)
            if f:
                line, col = self.pos(s)
                expr = " ".join(self.src[s:e].split())
                findings.append({"file": self.rel, "line": line, "col": col, "start": s, "end": e,
                                 "expr": expr if len(expr) <= 90 else expr[:87] + "...",
                                 "context": f[0], "rule": f[1], "suggestion": f[2], "form": "concat"})

    def scan_template(self, tpl, env, findings):
        html = self.is_html(tpl)
        ctxs = self.contexts(tpl) if html else None
        for idx, (s, e) in enumerate(tpl.exprs):
            toks, comments = self.lex_range(s, e)
            # 嵌套模板先递归（无论外层是否 HTML）
            self.scan_stream(toks, env, findings)
            if not html:
                continue
            ctx = ctxs[idx]
            safe_comment = any(SAFE_COMMENT_RE.match(c[1]) for c in comments)
            f = self.judge(toks, ctx, env, safe_comment)
            if f:
                line, col = self.pos(s - 2)
                expr = " ".join(self.src[s:e].split())
                findings.append({"file": self.rel, "line": line, "col": col, "start": s, "end": e, "expr": expr if len(expr) <= 90 else expr[:87] + "...",
                                 "context": f[0], "rule": f[1], "suggestion": f[2]})

    def judge(self, toks, ctx, env, safe_comment):
        state, attr = ctx["state"], ctx["attr"]
        if state == "val" and (re.match(r"^on[a-z]+$", attr) or attr == "srcdoc"):
            return ("attr:" + attr, "event", "事件属性里不允许插值：改用 data-action + 事件委托")
        if safe_comment:
            return None
        kind = self.an(toks, 0, len(toks), env)
        if state in ("tag", "attrname", "tagname", "attrend", "eq") or (state == "val" and ctx["quote"] is None and attr != "\0"):
            where = "tag" if state != "val" else "attr:" + attr + "(unquoted)"
            if kind is None or kind[0] in (1, 2):
                return (where, "tag-position", "标签名/属性名/无引号属性值里只能放写死的常量：加引号并 esc()，或标 /* safe: 理由 */")
            return None
        if state == "val" and attr in URL_ATTRS:
            if ctx["prior"] or url_prefix_ok(ctx["prefix"]):
                if kind is None:
                    return ("attr:" + attr, "unescaped", "用 esc(...) 包住；若值是整段 URL 用 window.Commons.safeUrl(...)")
                return None
            if kind is None or kind[0] > 1:
                return ("attr:" + attr, "url", "URL 开头的插值要过白名单：window.Commons.safeUrl(...)（只放行 #/、https:、http:、mailto:、data:image/）")
            return None
        if kind is None:
            where = "text" if state == "text" else "attr:" + attr
            return (where, "unescaped", "用 esc(...) 包住；确属写死常量则加 /* safe: 理由 */")
        return None


def url_prefix_ok(p):
    if not p:
        return False
    return bool(re.match(r"(#|/|\./|\.\./|\?|https?://|mailto:|data:image/|[\w.~-]+/)", p, re.I))


# ---------------------------------------------------------------- 入口

def lint_source(src, rel="<memory>"):
    return Analyzer(src, rel).scan()


def default_files():
    return [p for p in sorted(PREVIEW.glob("*.js")) if not DEFAULT_SKIP.search(p.as_posix())]


def main(argv=None):
    ap = argparse.ArgumentParser(description="R13 SEC-1 前端转义门禁")
    ap.add_argument("--files", nargs="+", help="只扫描这些文件（默认 preview/*.js，排除数据/样例）")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--summary", action="store_true", help="只打印每个文件的条数")
    args = ap.parse_args(argv)
    if args.files:
        files = [Path(f) for f in args.files]
    else:
        files = default_files()
    findings, counts = [], {}
    for p in files:
        try:
            src = p.read_text(encoding="utf-8")
        except OSError as exc:
            print(f"lint-xss: 读不了 {p}: {exc}", file=sys.stderr)
            return 2
        try:
            rel = p.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            rel = p.as_posix()
        fs = lint_source(src, rel)
        counts[rel] = len(fs)
        findings.extend(fs)
    if args.json:
        print(json.dumps({"total": len(findings), "files": counts, "findings": findings}, ensure_ascii=False, indent=2))
    elif args.summary:
        for rel, c in counts.items():
            print(f"{c:4d}  {rel}")
        print(f"{len(findings):4d}  合计")
    else:
        for f in findings:
            print(f"{f['file']}:{f['line']}:{f['col']}  {f['expr']}  [{f['context']}/{f['rule']}] {f['suggestion']}")
        print(f"lint-xss: {len(findings)} 条 / {len(files)} 个文件", file=sys.stderr)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
