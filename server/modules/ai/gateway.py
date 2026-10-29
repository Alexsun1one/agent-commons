"""模型网关：所有功能调外部模型的唯一出口（D-R13-01 / FZ-08）。

    from modules.ai import gateway
    result = gateway.run(db, feature='feed.summarize', task='event', inputs={...}, actor_id=None, object_id=None)
    if result.degraded: ...            # 走了本机降级，result.reason 是原因码
    result.data                        # 和模板 JSON Schema 同结构（降级时是本机规则的保守结果）

第一个参数传 app.state.db（Database）最好：网关自己开短事务记账，外部调用在事务之外进行。
也可以传 sqlite3 连接；如果它正处在写事务里，外部调用会在事务里等，占着写锁，尽量别这样用。

每次 run 恰好留下一行 ai_call 和一条 BE-0 审计（ai.call），都不含输入输出内容。
顺序：功能开关 → 成员关闭 → 同意/大小 → 去标识 → 缓存 → 密钥/SDK → 预算占额 → 外部调用 → 校验 → 结算。
治理类结果只是建议（Result.advisory=True）；网关不改任何对象、不扣分、不建处置。
"""
import json
import logging
import math
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field

from app import audit, clock, flags
from app.errors import ApiError

from . import budget, cache, catalog, fallback, keys, prompts, redact
from .providers import LLMRequest, ProviderError, SpeechRequest, default_providers
from .schema import SchemaError, validate

log = logging.getLogger('commons.ai')

DENIED = frozenset({'disabled_global', 'disabled_feature', 'member_opt_out', 'consent_required', 'input_too_large',
                    'budget_calls', 'budget_cost', 'no_key', 'sdk_missing', 'not_configured'})
IMAGE_TOKENS = 1600


@dataclass(frozen=True)
class Result:
    feature: str
    task: str
    data: dict
    source: str                     # 'model' | 'cache' | 'fallback'
    reason: str = None              # 降级原因码；正常时为 None
    provider: str = None
    model: str = None
    call_id: str = None
    advisory: bool = False          # 治理类：只是建议，进复核队列
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    redactions: dict = field(default_factory=dict)

    @property
    def degraded(self):
        return self.source == 'fallback'

    @property
    def ok(self):
        return not self.degraded

    def as_dict(self):
        out = asdict(self)
        out['degraded'] = self.degraded
        return out


def _is_db(target):
    return hasattr(target, 'write') and hasattr(target, 'conn')


@contextmanager
def _reading(target):
    yield target.conn() if _is_db(target) else target


@contextmanager
def _writing(target):
    if _is_db(target):
        with target.write() as conn:
            yield conn
    elif target.in_transaction:
        yield target
    else:
        target.execute('BEGIN IMMEDIATE')
        try:
            yield target
        except BaseException:
            target.execute('ROLLBACK')
            raise
        target.execute('COMMIT')


@dataclass
class _Call:
    spec: catalog.Feature
    task: prompts.Task
    actor_id: str
    object_id: str
    started: float
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    input_chars: int = 0
    redactions: dict = field(default_factory=dict)


class Gateway:
    def __init__(self, env=None, providers=None):
        self.env = env                  # None = 部署时从 os.environ 读密钥；测试一律注入
        self.providers = providers if providers is not None else default_providers()

    # ---- 对外 ----
    def run(self, conn, *, feature, task, inputs, actor_id=None, object_id=None):
        spec = catalog.get(feature)
        tpl = prompts.task(feature, task)
        clean = tpl.check(inputs)
        call = _Call(spec, tpl, actor_id, object_id, time.perf_counter())
        call.input_chars = len(json.dumps(tpl.text_inputs(clean), ensure_ascii=False))
        if not _is_db(conn) and conn.in_transaction:
            log.warning('ai gateway called inside a write transaction feature=%s', feature)

        with _reading(conn) as c:
            reason = self._gate(c, spec, actor_id)
            ttl = budget.limits(c, feature)['cache_ttl_s']
        reason = reason or self._precheck(spec, clean, call)
        if reason:
            return self._degrade(conn, call, clean, reason)

        sent, counts = redact.redact(clean, spec.redact)
        call.redactions = dict(counts)
        provider = self.providers.get(spec.provider)
        cache_key = cache.key(feature, task, tpl.version, spec.provider, spec.model, spec.effort, sent)
        if ttl > 0:
            with _reading(conn) as c:
                hit = cache.get(c, cache_key)
            if hit is not None:
                return self._cached(conn, call, cache_key, hit)

        reason = self._ready(provider)
        if reason:
            return self._degrade(conn, call, clean, reason)
        estimate = self._estimate(spec, tpl, sent, provider)
        with _writing(conn) as c:
            reason, day = budget.reserve(c, feature, estimate)
        if reason:
            return self._degrade(conn, call, clean, reason)

        reply, data, detail = None, None, None
        try:
            reply = self._invoke(spec, tpl, provider, sent, keys.lookup(provider.env_key, self.env))
            data = self._parse(tpl, reply)
        except ProviderError as exc:
            reason, detail = exc.code, exc.detail
        except Exception as exc:                       # 适配器的意外错误也不能把调用方拖垮
            reason, detail = 'provider_error', type(exc).__name__
        tokens_in = reply.input_tokens if reply else 0
        tokens_out = reply.output_tokens if reply else 0
        model = (reply.model if reply and reply.model else None) or spec.model
        cost = self._cost(spec, provider, model, reply)
        output_chars = len(reply.text) if reply and reply.text else (
            len(json.dumps(data, ensure_ascii=False)) if data else 0)
        detail = keys.scrub(str(detail), self._secrets())[:40] if detail is not None else None

        with _writing(conn) as c:
            budget.settle(c, feature, day, estimate, cost, tokens_in, tokens_out, failed=reason is not None)
            if reason is None:
                cache.purge_expired(c)
                cache.put(c, cache_key, feature, task, data, model, ttl, object_id)
                source = 'model'
            else:
                budget.bump(c, feature, 'fallbacks')
                data = fallback.local(feature, task, clean, reason)
                source = 'fallback'
            self._record(c, call, source, reason, spec.provider, model, output_chars, tokens_in, tokens_out, cost,
                         reply.request_id if reply else None, detail)
        return self._result(call, data, source, reason, spec.provider, model, tokens_in, tokens_out, cost)

    def describe(self, conn):
        """管理台用：开关、预算、今日用量、服务商是否就绪（只给布尔值，不给密钥）。"""
        all_flags = flags.all_flags(conn)
        today = budget.usage(conn)
        features = []
        for name, spec in catalog.FEATURES.items():
            provider = self.providers.get(spec.provider)
            lim = budget.limits(conn, name)
            features.append({
                'feature': name, 'kind': spec.kind, 'provider': spec.provider, 'model': spec.model,
                'effort': spec.effort if spec.kind == 'llm' else None, 'enabled': all_flags.get(spec.flag, False),
                'flag': spec.flag, 'advisory': spec.advisory, 'member_opt_out': spec.opt_out,
                'redact': list(spec.redact),
                'budget': {'daily_calls': lim['daily_calls'], 'daily_cost_usd': lim['daily_cost_micros'] / 1e6,
                           'cache_ttl_s': lim['cache_ttl_s']},
                'today': dict(today[name], cost_usd=today[name]['cost_micros'] / 1e6),
                'ready': self._ready(provider) is None, 'not_ready_reason': self._ready(provider),
            })
        return {'enabled': all_flags.get(catalog.GLOBAL_FLAG, False), 'flag': catalog.GLOBAL_FLAG,
                'day': budget.today(), 'features': features}

    # ---- 步骤 ----
    def _gate(self, conn, spec, actor_id):
        for key, reason in ((catalog.GLOBAL_FLAG, 'disabled_global'), (spec.flag, 'disabled_feature')):
            try:
                flags.gate(conn, key)
            except ApiError as exc:
                if exc.code != 'capability_unavailable':
                    raise
                return reason
        if spec.opt_out and actor_id:
            row = conn.execute('SELECT opted_out FROM ai_member_pref WHERE principal_id = ? AND feature = ?',
                               (actor_id, spec.name)).fetchone()
            if row and row[0]:
                return 'member_opt_out'
        return None

    @staticmethod
    def _precheck(spec, clean, call):
        if spec.needs_consent and clean.get('consent') != 'all_speakers':
            return 'consent_required'
        if spec.max_input_chars and call.input_chars > spec.max_input_chars:
            return 'input_too_large'
        return None

    def _ready(self, provider):
        if provider is None or not getattr(provider, 'configured', True):
            return 'not_configured'
        if not keys.configured(provider.env_key, self.env):
            return 'no_key'
        if not provider.sdk_available():
            return 'sdk_missing'
        return None

    @staticmethod
    def _estimate(spec, tpl, sent, provider):
        if spec.kind == 'stt':
            minutes = (sent.get('duration_s') or 600) / 60
            return int(math.ceil(minutes * getattr(provider, 'cost_per_minute_usd', 0.0) * 1_000_000))
        text = tpl.system + tpl.render(sent)
        tokens_in = math.ceil(len(text.encode('utf-8')) / 3) + IMAGE_TOKENS * len(sent.get(tpl.images) or ())
        return catalog.cost_micros(spec.model, tokens_in, tpl.expected_output_tokens * 2)

    @staticmethod
    def _invoke(spec, tpl, provider, sent, api_key):
        if spec.kind == 'stt':
            request = SpeechRequest(audio=bytes(sent['audio']), media_type=sent['media_type'],
                                    language=sent.get('language'), duration_s=sent.get('duration_s'),
                                    speakers=tuple(sent.get('speakers') or ()))
            return provider.transcribe(request, api_key)
        request = LLMRequest(
            model=spec.model, system=tpl.system, text=tpl.render(sent), schema=tpl.schema, max_tokens=spec.max_tokens,
            effort=spec.effort, stream=spec.stream, server_fallback=spec.model in catalog.SERVER_FALLBACK_MODELS,
            images=tuple((img['media_type'], bytes(img['data'])) for img in sent.get(tpl.images) or ()))
        return provider.complete(request, api_key)

    @staticmethod
    def _parse(tpl, reply):
        if reply.data is not None:
            data = reply.data
        else:
            try:
                data = json.loads(reply.text or '')
            except ValueError:
                raise ProviderError('invalid_output', 'json') from None
        try:
            validate(data, tpl.schema)
        except SchemaError:
            raise ProviderError('invalid_output', 'schema') from None
        return data

    @staticmethod
    def _cost(spec, provider, model, reply):
        if reply is None:
            return 0
        if spec.kind == 'stt':
            minutes = float(reply.extra.get('audio_minutes') or 0)
            return int(math.ceil(minutes * getattr(provider, 'cost_per_minute_usd', 0.0) * 1_000_000))
        return catalog.cost_micros(model, reply.input_tokens, reply.output_tokens)

    def _secrets(self):
        out = []
        for provider in self.providers.values():
            value = keys.lookup(getattr(provider, 'env_key', None), self.env)
            if value:
                out.append(value)
        return out

    # ---- 收尾 ----
    def _degrade(self, conn, call, clean, reason):
        data = fallback.local(call.spec.name, call.task.name, clean, reason)
        with _writing(conn) as c:
            budget.bump(c, call.spec.name, 'fallbacks')
            self._record(c, call, 'fallback', reason, call.spec.provider, call.spec.model, 0, 0, 0, 0, None, None)
        return self._result(call, data, 'fallback', reason, call.spec.provider, call.spec.model, 0, 0, 0)

    def _cached(self, conn, call, cache_key, hit):
        with _writing(conn) as c:
            cache.touch(c, cache_key)
            budget.bump(c, call.spec.name, 'cache_hits')
            self._record(c, call, 'cache', None, call.spec.provider, hit['model'],
                         len(json.dumps(hit['data'], ensure_ascii=False)), 0, 0, 0, None, None)
        return self._result(call, hit['data'], 'cache', None, call.spec.provider, hit['model'], 0, 0, 0)

    def _record(self, conn, call, source, reason, provider, model, output_chars, tokens_in, tokens_out, cost,
                provider_request_id, detail):
        result = {'model': 'ok', 'cache': 'cache_hit', 'fallback': 'fallback'}[source]
        latency = int((time.perf_counter() - call.started) * 1000)
        conn.execute(
            'INSERT INTO ai_call (id, occurred_at, feature, task, provider, model, template_version, actor_id, object_id, '
            'result, reason_code, input_chars, output_chars, input_tokens, output_tokens, cost_micros, latency_ms, '
            'redactions_json, provider_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (call.id, clock.now(), call.spec.name, call.task.name, provider, model, call.task.version, call.actor_id,
             call.object_id, result, reason, call.input_chars, output_chars, tokens_in, tokens_out, cost, latency,
             json.dumps(call.redactions, sort_keys=True), provider_request_id))
        outcome = 'ok' if reason is None else ('denied' if reason in DENIED else 'error')
        meta = {'feature': call.spec.name, 'task': call.task.name, 'result': result, 'provider': provider,
                'model': model, 'cost_micros': cost, 'object_id': call.object_id}
        if detail:
            meta['detail'] = detail
        audit.record(conn, call.actor_id, 'ai.call', 'ai_call', call.id, outcome, reason, meta=meta)
        log.info('ai call feature=%s task=%s result=%s reason=%s latency_ms=%s', call.spec.name, call.task.name,
                 result, reason, latency)

    @staticmethod
    def _result(call, data, source, reason, provider, model, tokens_in, tokens_out, cost):
        return Result(feature=call.spec.name, task=call.task.name, data=data, source=source, reason=reason,
                      provider=provider, model=model, call_id=call.id, advisory=call.spec.advisory,
                      input_tokens=tokens_in, output_tokens=tokens_out, cost_usd=cost / 1e6,
                      redactions=dict(call.redactions))


_default = None


def default():
    global _default
    if _default is None:
        _default = Gateway()
    return _default


def configure(env=None, providers=None):
    """换掉进程内默认网关（测试注入替身和假密钥用）。返回新网关。"""
    global _default
    _default = Gateway(env=env, providers=providers)
    return _default


def reset():
    global _default
    _default = None


def run(conn, *, feature, task, inputs, actor_id=None, object_id=None):
    return default().run(conn, feature=feature, task=task, inputs=inputs, actor_id=actor_id, object_id=object_id)
