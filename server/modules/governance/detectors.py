"""治理 Agent 接口：检测器协议、注册表和外发闸门。

规则层（本机）和以后的模型层都实现同一个 Detector 协议：
    name: str; version: str
    modalities: set[str]      # {'text','html','image'}，'audio','video' 已预留
    egress: bool              # 会不会把内容发到本机以外
    def check(self, item: Item) -> list[Signal]
可选属性：kind（'rule' 在初筛事务里同步跑；其余按 Agent 处理，排进 gov_agent_job 在事务外跑）、
model / model_version（写进每条 Agent 建议；每次调用不同时放进 Signal.output['model'/'model_version']）、
available()（依赖不在时返回 False，不排任务；check() 里也可以抛 Unavailable）。

egress=True 的检测器只有在 gov.model_egress 打开时才会被调用；所有调用都经过 call()。
模型层不直接连服务商，统一经 AI-1 的模型网关（见 model.py）；需要数据库连接时用 call_conn()。
"""
import hashlib
import json
import re
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from typing import Protocol, runtime_checkable

from app import flags

EGRESS_FLAG = 'gov.model_egress'
MODALITIES = frozenset({'text', 'html', 'image', 'audio', 'video'})
NAME = re.compile(r'[a-z][a-z0-9_.-]{1,63}\Z')
_RULE_PARAMS = ContextVar('gov_rule_params', default=None)
_CALL_CONN = ContextVar('gov_call_conn', default=None)


class EgressBlocked(RuntimeError):
    """外发检测器在 gov.model_egress 关闭时被调用。"""


class Unavailable(RuntimeError):
    """检测器依赖的东西不在（比如模型网关还没部署），这次不算失败，任务记为跳过。"""


@dataclass(frozen=True)
class MediaRef:
    kind: str                 # 'image' | 'html' | 'audio' | 'video' | 'file'
    mime: str
    size: int
    path: str = None          # 本机文件路径；只给本机检测器读
    width: int = None
    height: int = None
    index: int = 0


@dataclass(frozen=True)
class PiiSpan:
    field: str                # 'title' | 'text' | 'html'
    category: str             # phone / wechat / qq / email / idcard / private_link
    start: int
    end: int


@dataclass(frozen=True)
class Item:
    """检测器看到的一件东西。不带作者身份；文本已去标识（等长遮盖，偏移与原文一致）。"""
    target_type: str          # 'object' | 'upload'
    target_id: str
    version: int
    object_type: str          # discussion / knowledge / work / reply / image / html ...
    title: str = ''
    text: str = ''
    html: str = None          # HTML 源，只给本机检测器；外发时换成遮盖版
    masked_html: str = None
    media: tuple = ()
    pii: tuple = ()           # 去标识时找到的位置（不含原值）
    content_hash: str = ''

    @property
    def modalities(self):
        found = set()
        if self.title or self.text:
            found.add('text')
        if self.html is not None:
            found.add('html')
        for m in self.media:
            if m.kind in MODALITIES:
                found.add(m.kind)
        return frozenset(found)

    def input_hash(self):
        payload = {'type': self.object_type, 'version': self.version, 'title': self.title, 'text': self.text,
                   'html': self.masked_html if self.masked_html is not None else self.html,
                   'media': [[m.kind, m.mime, m.size, m.width, m.height] for m in self.media]}
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(raw.encode()).hexdigest()

    def for_egress(self):
        """外发版：HTML 换成去标识版，文件只留类型尺寸，不带本机路径。"""
        return replace(self, html=self.masked_html, media=tuple(replace(m, path=None) for m in self.media))


@dataclass(frozen=True)
class Signal:
    rule: str                 # gov_rule.id；模型用 'agent.<名字>'，没有对应规则时按 'agent.default'
    category: str
    score: float
    confidence: float = 1.0
    locator: dict = field(default_factory=dict)
    summary: str = ''         # 不含原文
    suggested_action: str = None
    output: dict = field(default_factory=dict)


@runtime_checkable
class Detector(Protocol):
    name: str
    version: str
    modalities: set
    egress: bool

    def check(self, item: Item) -> list:
        ...


_REGISTRY = {}


def register(detector):
    if not isinstance(detector, Detector):
        raise TypeError('detector must define name, version, modalities, egress and check()')
    if not NAME.match(detector.name) or not isinstance(detector.version, str) or not detector.version:
        raise ValueError(f'bad detector name/version: {detector.name!r}')
    mods = set(detector.modalities)
    if not mods or not mods <= MODALITIES:
        raise ValueError(f'unknown modalities for {detector.name}: {sorted(mods - MODALITIES)}')
    if not isinstance(detector.egress, bool):
        raise ValueError('egress must be a bool')
    if kind_of(detector) == 'rule' and detector.egress:
        raise ValueError('rule detectors must run locally (egress=False)')
    existing = _REGISTRY.get(detector.name)
    if existing is not None and existing is not detector:
        raise ValueError(f'detector {detector.name} already registered')
    _REGISTRY[detector.name] = detector
    return detector


def unregister(name):
    _REGISTRY.pop(name, None)


def get(name):
    return _REGISTRY.get(name)


def all_detectors():
    return [_REGISTRY[k] for k in sorted(_REGISTRY)]


def kind_of(detector):
    return 'rule' if getattr(detector, 'kind', 'agent') == 'rule' else 'agent'


def applicable(item, kind=None):
    mods = item.modalities
    return [d for d in all_detectors() if set(d.modalities) & mods and (kind is None or kind_of(d) == kind)]


def egress_allowed(conn):
    return flags.enabled(conn, EGRESS_FLAG)


def describe(conn):
    allowed = egress_allowed(conn)
    out = []
    for d in all_detectors():
        available = getattr(d, 'available', None)
        if d.egress and not allowed:
            status = 'blocked_by_flag'
        elif callable(available) and not available():
            status = 'unavailable'
        else:
            status = 'active'
        out.append({'name': d.name, 'version': d.version, 'kind': kind_of(d), 'modalities': sorted(d.modalities),
                    'egress': d.egress, 'model': getattr(d, 'model', None),
                    'model_version': getattr(d, 'model_version', None), 'feature': getattr(d, 'feature', None),
                    'status': status})
    return out


def call(conn, detector, item):
    """唯一的调用入口。返回 (signals, latency_ms)。conn 只用来读开关，不要在写事务里调用 Agent 检测器。"""
    if detector.egress:
        if not egress_allowed(conn):
            raise EgressBlocked(detector.name)
        item = item.for_egress()
    token = _CALL_CONN.set(conn)
    started = time.perf_counter()
    try:
        result = detector.check(item) or []
    finally:
        latency = int((time.perf_counter() - started) * 1000)
        _CALL_CONN.reset(token)
    signals = []
    for s in result:
        if not isinstance(s, Signal):
            raise TypeError(f'{detector.name} returned {type(s).__name__}, expected Signal')
        signals.append(s)
    return signals, latency


def call_conn():
    """检测器在 check() 里需要数据库连接时（比如经模型网关调用要记账）从这里拿；只在 call() 期间有效。"""
    conn = _CALL_CONN.get()
    if conn is None:
        raise RuntimeError('call_conn() is only available inside detectors.call()')
    return conn


@contextmanager
def rule_params(book):
    token = _RULE_PARAMS.set({k: v['params'] for k, v in book.items()})
    try:
        yield
    finally:
        _RULE_PARAMS.reset(token)


def params(rule_id):
    book = _RULE_PARAMS.get()
    if book is None:
        raise RuntimeError('rule params are only available inside rule_params()')
    return book.get(rule_id, {})
