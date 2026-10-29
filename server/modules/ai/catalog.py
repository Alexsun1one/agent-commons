"""功能清单：每个功能走哪家、哪个模型、去不去标识、默认预算。改模型只改这里。

价格是 claude-api 技能 2026-10-06 缓存的官方价（美元 / 百万 token），上线前主控按官网核对。
"""
from dataclasses import dataclass

# 去标识类别（见 redact.py）。治理初筛不去标识：它就是要识别这些。
DEFAULT_REDACT = ('phone', 'landline', 'email', 'wechat', 'qq', 'idcard', 'bankcard')

# (输入价, 输出价) 美元 / 百万 token；Haiku 5.5 超过 10 万输入 token 换高档价。
PRICES = {
    'claude-opus-5-5': ((4.00, 20.00), None),
    'claude-sonnet-5-5': ((2.00, 10.00), None),
    'claude-haiku-5-5': ((0.10, 0.50), (100_000, (0.50, 2.50))),
}
# 只给这些模型加服务端拒答兜底（fallbacks: "default"）；Haiku 5.5 没有服务端兜底，加了反而 400。
SERVER_FALLBACK_MODELS = frozenset({'claude-opus-5-5', 'claude-sonnet-5-5'})


@dataclass(frozen=True)
class Feature:
    name: str
    kind: str                    # 'llm' | 'stt'
    provider: str                # providers 注册名；'speech' 表示转录服务商待 部署者 选
    model: str = None
    effort: str = 'medium'
    stream: bool = False
    max_tokens: int = 16000
    redact: tuple = DEFAULT_REDACT
    advisory: bool = False       # 治理类：结论只是建议，进复核队列
    opt_out: bool = False        # 成员可以自己关掉（个人简报、搜索辅助）
    max_input_chars: int = 20000
    daily_calls: int = 200
    daily_cost_usd: float = 5.0
    cache_ttl_s: int = 86400
    needs_consent: bool = False  # 录音转写：调用方必须声明全体发言人已同意

    @property
    def flag(self):
        return f'ai.{self.name}.enabled'


FEATURES = {f.name: f for f in (
    Feature('governance.screen_text', 'llm', 'anthropic', 'claude-haiku-5-5', effort='low', max_tokens=4096,
            redact=(), advisory=True, max_input_chars=20000, daily_calls=5000, daily_cost_usd=5.0,
            cache_ttl_s=7 * 86400),
    Feature('governance.screen_image', 'llm', 'anthropic', 'claude-sonnet-5-5', effort='low', max_tokens=4096,
            redact=(), advisory=True, max_input_chars=2000, daily_calls=1000, daily_cost_usd=10.0,
            cache_ttl_s=7 * 86400),
    Feature('talks.transcribe', 'stt', 'speech', None, redact=(), max_input_chars=0, daily_calls=50,
            daily_cost_usd=10.0, cache_ttl_s=30 * 86400, needs_consent=True),
    Feature('talks.translate', 'llm', 'anthropic', 'claude-opus-5-5', effort='low', stream=True, max_tokens=32000,
            max_input_chars=30000, daily_calls=300, daily_cost_usd=10.0, cache_ttl_s=30 * 86400),
    Feature('talks.minutes', 'llm', 'anthropic', 'claude-opus-5-5', effort='high', stream=True, max_tokens=32000,
            max_input_chars=200000, daily_calls=50, daily_cost_usd=10.0, cache_ttl_s=30 * 86400),
    Feature('feed.summarize', 'llm', 'anthropic', 'claude-opus-5-5', effort='low', max_tokens=8000,
            max_input_chars=20000, daily_calls=300, daily_cost_usd=5.0, cache_ttl_s=86400),
    Feature('kb.draft_problem', 'llm', 'anthropic', 'claude-opus-5-5', effort='medium', stream=True,
            max_tokens=16000, max_input_chars=20000, daily_calls=200, daily_cost_usd=5.0, cache_ttl_s=86400),
    Feature('digest.summarize', 'llm', 'anthropic', 'claude-opus-5-5', effort='low', max_tokens=8000,
            opt_out=True, max_input_chars=30000, daily_calls=500, daily_cost_usd=5.0, cache_ttl_s=12 * 3600),
    Feature('search.assist', 'llm', 'anthropic', 'claude-opus-5-5', effort='low', max_tokens=8000,
            opt_out=True, max_input_chars=20000, daily_calls=1000, daily_cost_usd=5.0, cache_ttl_s=3600),
)}

GLOBAL_FLAG = 'ai.enabled'


def get(name):
    try:
        return FEATURES[name]
    except KeyError:
        raise ValueError(f'unknown AI feature {name!r}') from None


def cost_micros(model, input_tokens, output_tokens):
    """按官方价估算费用，单位百万分之一美元。未知模型按 Opus 价保守估算。"""
    base, tier = PRICES.get(model, PRICES['claude-opus-5-5'])
    price_in, price_out = base
    if tier is not None and input_tokens > tier[0]:
        price_in, price_out = tier[1]
    return int(round(input_tokens * price_in + output_tokens * price_out))
