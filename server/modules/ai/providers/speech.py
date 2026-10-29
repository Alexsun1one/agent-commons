"""语音转文字（talks.transcribe）的接口和替身。

具体服务商待 部署者 选（候选见 RECEIPT-AI-1），选定后照 AnthropicProvider 的样子写一个适配器：
    name = '<服务商>'；env_key = 'COMMONS_AI_<服务商>_KEY'
    sdk_available()：延迟导入官方 SDK
    transcribe(SpeechRequest, api_key) -> Reply(data={'language', 'text', 'segments': [...]})
    cost_per_minute_usd：官方价，用于预算估算
再把 catalog 里 talks.transcribe 的 provider 换成它的注册名。
"""
from . import ProviderError, Reply, SpeechRequest


class UnconfiguredSpeech:
    """还没选服务商：网关看到 configured=False 直接降级，不外发。"""
    name = 'speech'
    env_key = None
    configured = False
    cost_per_minute_usd = 0.0

    def sdk_available(self):
        return False

    def transcribe(self, request: SpeechRequest, api_key):
        raise ProviderError('not_configured')


class FakeSpeech:
    """测试和开发用：不联网，按给定的段落返回。"""
    name = 'fake_speech'
    env_key = 'COMMONS_AI_FAKE_SPEECH_KEY'
    configured = True
    cost_per_minute_usd = 0.01

    def __init__(self, segments=None, language='zh', error=None):
        self.segments = segments or [{'start': 0.0, 'end': 2.5, 'speaker': 'S1', 'text': '大家好，今天聊智能体评测。'}]
        self.language = language
        self.error = error
        self.calls = []

    def sdk_available(self):
        return True

    def transcribe(self, request: SpeechRequest, api_key):
        self.calls.append(request)
        if self.error:
            raise ProviderError(self.error)
        text = ''.join(s['text'] for s in self.segments)
        minutes = (request.duration_s or 0) / 60
        return Reply(data={'language': request.language or self.language, 'text': text,
                           'segments': [dict(s) for s in self.segments]},
                     model='fake-stt', extra={'audio_minutes': minutes})
