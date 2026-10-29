"""测试替身：不联网、不导入任何 SDK。按 (功能/模型无关) 预设返回文本，或抛指定的 ProviderError。"""
import json

from . import ProviderError, Reply


class FakeLLM:
    name = 'anthropic'
    env_key = 'COMMONS_AI_ANTHROPIC_KEY'
    configured = True

    def __init__(self, reply=None, error=None, input_tokens=1000, output_tokens=200, sdk=True):
        self.reply = reply
        self.error = error
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.sdk = sdk
        self.requests = []
        self.keys = []

    def sdk_available(self):
        return self.sdk

    def complete(self, request, api_key):
        self.requests.append(request)
        self.keys.append(api_key)
        if self.error:
            raise ProviderError(self.error)
        reply = self.reply(request) if callable(self.reply) else self.reply
        text = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)
        return Reply(text=text, model=request.model, input_tokens=self.input_tokens,
                     output_tokens=self.output_tokens, request_id='req_fake')
