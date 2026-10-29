"""联系方式与个人信息：直接复用 ENG-2 修好的去标识规则（engine/pipeline/deid.py），不复制正则。

做法：用一个不认识任何成员的 Deidentifier 跑 deid_text，在 _rebuild 那一步把命中区间（已映射回原文位置）
收下来，再按原文长度遮盖，所以遮盖后的文本和原文偏移一致，证据定位可以直接用。
线上部署要把 engine/pipeline/deid.py 一起带上（见回执与 docs/shared-requests.md）；找不到时 available() 为 False，
初筛照常跑其他规则，统计接口会把它标成「不可用」。
"""
import importlib.util
import secrets
from pathlib import Path

DEID_PATH = Path(__file__).resolve().parents[3] / 'engine' / 'pipeline' / 'deid.py'
PLACEHOLDERS = {'[手机号]': 'phone', '[微信号]': 'wechat', '[邮箱]': 'email', '[私链]': 'private_link',
                '[QQ号]': 'qq', '[证件号]': 'idcard'}
LABELS = {'phone': '手机号', 'wechat': '微信号', 'email': '邮箱', 'private_link': '私人链接', 'qq': 'QQ 号',
          'idcard': '证件号'}
TOKENS = {v: k for k, v in PLACEHOLDERS.items()}
FILL = '＊'


def _load():
    spec = importlib.util.spec_from_file_location('commons_engine_deid', DEID_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(str(DEID_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


try:
    deid = _load()
    LOAD_ERROR = None
except (OSError, ImportError, SyntaxError) as exc:
    deid = None
    LOAD_ERROR = type(exc).__name__


def available():
    return deid is not None


if deid is not None:
    class _Finder(deid.Deidentifier):
        def __init__(self):
            super().__init__(secrets.token_bytes(32), ())
            self.found = []

        def _rebuild(self, text, ss, se, spans):
            for a, b, repl in spans:
                category = PLACEHOLDERS.get(repl)
                if category is None:
                    continue
                oa, ob = (a, b) if ss is None else (ss[a], se[b - 1])
                if ob > oa:
                    self.found.append((oa, ob, category))
            return ''


def find(text):
    """返回 [(start, end, category)]，按位置排序、互不重叠。"""
    if not text or deid is None:
        return []
    finder = _Finder()
    finder.deid_text(text)
    out, pos = [], 0
    for start, end, category in sorted(finder.found):
        start = max(start, pos)
        if end > start:
            out.append((start, end, category))
            pos = end
    return out


def mask(text, spans=None):
    """等长遮盖：'[手机号]＊＊＊＊＊＊'。区间比占位符短时全用＊。"""
    if not text:
        return text or '', []
    spans = find(text) if spans is None else spans
    parts, pos = [], 0
    for start, end, category in spans:
        parts.append(text[pos:start])
        n = end - start
        token = TOKENS[category]
        parts.append(token + FILL * (n - len(token)) if n >= len(token) else FILL * n)
        pos = end
    parts.append(text[pos:])
    return ''.join(parts), spans
