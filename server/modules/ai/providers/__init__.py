"""服务商适配层的公共约定。

每个适配器：
    name: str                      # 注册名，也是密钥变量名的一段：COMMONS_AI_<NAME>_KEY
    env_key: str                   # 密钥环境变量名
    def sdk_available(self) -> bool    # SDK 能不能导入（延迟导入，导入失败不让应用起不来）
    def complete(self, request, api_key) -> Reply      # LLM；失败只抛 ProviderError
    def transcribe(self, request, api_key) -> Reply    # 语音转文字
适配器不读环境变量、不记日志正文；密钥只在调用时由网关传入。
"""
from dataclasses import dataclass, field


class ProviderError(Exception):
    """code 是固定的原因码；detail 只放类别/状态码这类不含内容、不含密钥的短串。"""

    CODES = frozenset({'sdk_missing', 'not_configured', 'timeout', 'rate_limited', 'network', 'auth', 'bad_request',
                       'provider_error', 'refusal', 'truncated', 'invalid_output'})

    def __init__(self, code, detail=None):
        if code not in self.CODES:
            code = 'provider_error'
        super().__init__(code)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class LLMRequest:
    model: str
    system: str
    text: str
    schema: dict
    max_tokens: int
    effort: str = 'medium'
    stream: bool = False
    server_fallback: bool = False
    images: tuple = ()               # ((media_type, bytes), ...)


@dataclass(frozen=True)
class SpeechRequest:
    audio: bytes
    media_type: str
    language: str = None
    duration_s: float = None
    speakers: tuple = ()


@dataclass
class Reply:
    text: str = None                 # 模型返回的 JSON 文本
    data: dict = None                # 已解析好的结构（转写替身直接给）
    model: str = None
    input_tokens: int = 0
    output_tokens: int = 0
    request_id: str = None
    extra: dict = field(default_factory=dict)


def default_providers():
    from .anthropic import AnthropicProvider
    from .speech import UnconfiguredSpeech
    return {'anthropic': AnthropicProvider(), 'speech': UnconfiguredSpeech()}
