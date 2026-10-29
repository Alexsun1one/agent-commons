"""测试用的假 anthropic SDK：类名和调用形状照 claude-api 技能的 Python 文档，不联网。"""
from types import SimpleNamespace

FAKE_KEY = 'sk-ant-test-FAKEKEY-0000-do-not-use'
ENV = {'COMMONS_AI_ANTHROPIC_KEY': FAKE_KEY}


def message(text, stop='end_turn', model='claude-opus-5-5', usage=(1200, 300), category=None):
    return SimpleNamespace(
        content=[SimpleNamespace(type='thinking', thinking=''), SimpleNamespace(type='text', text=text)],
        stop_reason=stop, stop_details=SimpleNamespace(type='refusal', category=category) if stop == 'refusal' else None,
        model=model, _request_id='req_test_1',
        usage=SimpleNamespace(input_tokens=usage[0], output_tokens=usage[1], cache_creation_input_tokens=0,
                              cache_read_input_tokens=0))


def fake_sdk(reply=None, error=None):
    """reply: message 对象或 fn(params)->message；error: fn(sdk)->Exception。calls 记录 (路径, 参数)。"""
    calls = []

    class APIError(Exception):
        pass

    class APIStatusError(APIError):
        def __init__(self, msg, status_code=500):
            super().__init__(msg)
            self.status_code = status_code

    class BadRequestError(APIStatusError):
        pass

    class AuthenticationError(APIStatusError):
        pass

    class PermissionDeniedError(APIStatusError):
        pass

    class NotFoundError(APIStatusError):
        pass

    class RateLimitError(APIStatusError):
        pass

    class APIConnectionError(APIError):
        pass

    class APITimeoutError(APIConnectionError):
        pass

    sdk = SimpleNamespace(APIError=APIError, APIStatusError=APIStatusError, BadRequestError=BadRequestError,
                          AuthenticationError=AuthenticationError, PermissionDeniedError=PermissionDeniedError,
                          NotFoundError=NotFoundError, RateLimitError=RateLimitError,
                          APIConnectionError=APIConnectionError, APITimeoutError=APITimeoutError, calls=calls)

    class Stream:
        def __init__(self, msg):
            self.msg = msg

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def get_final_message(self):
            return self.msg

    class Messages:
        def __init__(self, path):
            self.path = path

        def _reply(self, params):
            if error is not None:
                raise error(sdk)
            return reply(params) if callable(reply) else reply

        def create(self, **params):
            calls.append((self.path + '.create', params))
            return self._reply(params)

        def stream(self, **params):
            calls.append((self.path + '.stream', params))
            return Stream(self._reply(params))

    class Anthropic:
        def __init__(self, **kwargs):
            calls.append(('client', kwargs))
            self.messages = Messages('messages')
            self.beta = SimpleNamespace(messages=Messages('beta.messages'))

    sdk.Anthropic = Anthropic
    return sdk
