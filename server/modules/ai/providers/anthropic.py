"""Anthropic 官方 API 适配器（文字和图片）。写法照 claude-api 技能的 Python 文档：

- 客户端 anthropic.Anthropic(api_key=..., base_url=官方地址, timeout=..., max_retries=...)；密钥只由网关传入，
  不让 SDK 自己去读 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL，保证只走官方接口、不走中转。
- 结构化输出用 output_config.format（json_schema）；深度用 output_config.effort；thinking 用 adaptive。
- 长输出用 messages.stream(...) + get_final_message()。
- Opus 5.5 / Sonnet 5.5 默认带服务端拒答兜底：client.beta.messages + betas=["server-side-fallback-2026-07-01"]
  + fallbacks="default"。Haiku 5.5 没有服务端兜底，不加。
- 先看 stop_reason：refusal / max_tokens 都按失败处理，不去读半截内容。
SDK 延迟导入：没装 anthropic 包时 sdk_available() 为 False，网关降级，应用照常启动。
"""
import base64
import importlib

from . import LLMRequest, ProviderError, Reply

OFFICIAL_BASE_URL = 'https://api.anthropic.com'
FALLBACK_BETA = 'server-side-fallback-2026-07-01'


def _import_sdk():
    return importlib.import_module('anthropic')


class AnthropicProvider:
    name = 'anthropic'
    env_key = 'COMMONS_AI_ANTHROPIC_KEY'

    def __init__(self, sdk_loader=None, timeout=120.0, max_retries=2):
        self._load = sdk_loader or _import_sdk
        self.timeout = timeout
        self.max_retries = max_retries
        self._clients = {}
        self._sdk_ok = None

    def _sdk(self):
        try:
            return self._load()
        except ImportError:
            raise ProviderError('sdk_missing') from None

    def sdk_available(self):
        if self._sdk_ok is None:
            try:
                self._sdk()
                self._sdk_ok = True
            except ProviderError:
                self._sdk_ok = False
        return self._sdk_ok

    def _client(self, sdk, api_key):
        slot = hash(api_key)
        client = self._clients.get(slot)
        if client is None:
            client = sdk.Anthropic(api_key=api_key, base_url=OFFICIAL_BASE_URL, timeout=self.timeout,
                                   max_retries=self.max_retries)
            self._clients = {slot: client}
        return client

    @staticmethod
    def params(request: LLMRequest):
        content = [{'type': 'image', 'source': {'type': 'base64', 'media_type': media_type,
                                                'data': base64.standard_b64encode(data).decode('ascii')}}
                   for media_type, data in request.images]
        content.append({'type': 'text', 'text': request.text})
        params = {
            'model': request.model,
            'max_tokens': request.max_tokens,
            'system': request.system,
            'messages': [{'role': 'user', 'content': content}],
            'thinking': {'type': 'adaptive'},
            'output_config': {'effort': request.effort,
                              'format': {'type': 'json_schema', 'schema': request.schema}},
        }
        if request.server_fallback:
            params['betas'] = [FALLBACK_BETA]
            params['fallbacks'] = 'default'
        return params

    def complete(self, request: LLMRequest, api_key):
        sdk = self._sdk()
        params = self.params(request)
        try:
            client = self._client(sdk, api_key)
            api = client.beta.messages if request.server_fallback else client.messages
            if request.stream:
                with api.stream(**params) as stream:
                    message = stream.get_final_message()
            else:
                message = api.create(**params)
        except ProviderError:
            raise
        except Exception as exc:
            raise _map_error(sdk, exc) from None
        return _reply(message)


def _map_error(sdk, exc):
    def isa(name):
        cls = getattr(sdk, name, None)
        return isinstance(cls, type) and isinstance(exc, cls)

    if isa('APITimeoutError'):
        return ProviderError('timeout')
    if isa('RateLimitError'):
        return ProviderError('rate_limited', '429')
    if isa('AuthenticationError') or isa('PermissionDeniedError'):
        return ProviderError('auth', str(getattr(exc, 'status_code', '')) or None)
    if isa('BadRequestError') or isa('NotFoundError'):
        return ProviderError('bad_request', str(getattr(exc, 'status_code', '')) or None)
    if isa('APIStatusError'):
        return ProviderError('provider_error', str(getattr(exc, 'status_code', '')) or None)
    if isa('APIConnectionError'):
        return ProviderError('network')
    return ProviderError('provider_error', type(exc).__name__)


def _reply(message):
    stop = getattr(message, 'stop_reason', None)
    if stop == 'refusal':
        details = getattr(message, 'stop_details', None)
        raise ProviderError('refusal', getattr(details, 'category', None) if details is not None else None)
    if stop == 'max_tokens':
        raise ProviderError('truncated')
    text = next((b.text for b in (getattr(message, 'content', None) or []) if getattr(b, 'type', None) == 'text'),
                None)
    if text is None:
        raise ProviderError('invalid_output', 'no_text_block')
    usage = getattr(message, 'usage', None)
    tokens_in = sum(int(getattr(usage, k, 0) or 0)
                    for k in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'))
    return Reply(text=text, model=getattr(message, 'model', None), input_tokens=tokens_in,
                 output_tokens=int(getattr(usage, 'output_tokens', 0) or 0),
                 request_id=getattr(message, '_request_id', None))
