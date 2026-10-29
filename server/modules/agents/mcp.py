"""MCP 端点（Streamable HTTP，只用 POST + application/json 响应，不开 SSE 流，不发会话号）。

手写 JSON-RPC 2.0，不加依赖。支持：initialize、ping、tools/list、tools/call，以及客户端发来的通知
（notifications/initialized 等，回 202 无正文）。协议版本按 2025-06-18 写，同时接受 2025-03-26 和 2024-11-05
（版本协商和 401 时客户端的行为在回执里标「待核」）。

鉴权：Authorization: Bearer <令牌>。HTTP 层错误（未授权、限流、开关关）用 HTTP 状态码 + JSON-RPC error 正文；
工具执行中的业务错误（scope 不够、参数业务上不成立、写开关关）放在 tools/call 的 result 里，isError=true。
"""
import json

from app.errors import ApiError

from . import tools

SUPPORTED_VERSIONS = ('2025-06-18', '2025-03-26', '2024-11-05')
LATEST = SUPPORTED_VERSIONS[0]
SERVER_INFO = {'name': 'vanguard-commons', 'title': '智能体先锋队', 'version': '0.1.0'}

PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS = -32700, -32600, -32601, -32602
APP_CODES = {
    'unauthenticated': -32001, 'agent_scope_missing': -32003, 'action_not_allowed': -32003,
    'origin_rejected': -32003, 'rate_limited': -32029, 'capability_unavailable': -32050,
}

INSTRUCTIONS = (
    '这是智能体先锋队（一个 AI 实践者的邀请制社区）给成员个人 Agent 的接口。'
    '想知道「最近发生了什么」就调 whats_new，把 summary_zh 转述给主人。'
    '别的成员的非公开内容默认不提供，只给条数；遇到 withheld=true 的条目，请主人到网站查看。'
    '草稿工具只会存成草稿，主人在网页上确认后才会发出。'
    ' / Member-agent interface of an invite-only AI practitioners community. Call whats_new for a digest and '
    'relay summary_zh to your owner. Other members\' non-public content is withheld by default.'
)


class Reply:
    """HTTP 状态、JSON 正文（None 表示无正文）和额外响应头。"""

    def __init__(self, status=200, body=None, headers=None):
        self.status = status
        self.body = body
        self.headers = headers or {}


def error(msg_id, code, message, data=None, status=200, headers=None):
    err = {'code': code, 'message': message}
    if data is not None:
        err['data'] = data
    return Reply(status, {'jsonrpc': '2.0', 'id': msg_id, 'error': err}, headers)


def from_api_error(msg_id, err, request_id):
    data = {'code': err.code, 'request_id': request_id, 'retryable': err.code in ('rate_limited', 'internal_error')}
    data.update({k: v for k, v in err.extra.items() if k in ('retry_after_seconds',)})
    headers = dict(err.headers)
    if err.status == 401:
        headers['WWW-Authenticate'] = 'Bearer realm="vanguard-commons-agents"'
    return error(msg_id, APP_CODES.get(err.code, -32000), err.message, data, err.status, headers)


def result(msg_id, payload):
    return Reply(200, {'jsonrpc': '2.0', 'id': msg_id, 'result': payload})


def _valid_id(value):
    return isinstance(value, str) or (isinstance(value, int) and not isinstance(value, bool))


def parse(raw):
    """-> (message dict, None) 或 (None, Reply)。"""
    try:
        message = json.loads(raw.decode('utf-8') if isinstance(raw, (bytes, bytearray)) else raw)
    except (ValueError, UnicodeDecodeError):
        return None, error(None, PARSE_ERROR, 'JSON 解析失败 / parse error', status=400)
    if isinstance(message, list):
        return None, error(None, INVALID_REQUEST, '不支持批量请求 / batch requests are not supported', status=400)
    if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
        return None, error(None, INVALID_REQUEST, '不是 JSON-RPC 2.0 请求 / invalid request', status=400)
    if 'id' in message and not _valid_id(message['id']):
        return None, error(None, INVALID_REQUEST, 'id 必须是字符串或整数 / invalid id', status=400)
    is_response = 'method' not in message and ('result' in message or 'error' in message)
    if not is_response and not isinstance(message.get('method'), str):
        return None, error(message.get('id'), INVALID_REQUEST, '缺少 method / missing method', status=400)
    if 'params' in message and not isinstance(message['params'], (dict, type(None))):
        return None, error(message.get('id'), INVALID_REQUEST, 'params 必须是对象 / params must be an object',
                           status=400)
    return message, None


def tool_result(data, text, is_error=False):
    return {'content': [{'type': 'text', 'text': text}], 'structuredContent': data, 'isError': is_error}


def handle(db, settings, agent, message, request_id):
    """已鉴权的一条消息。返回 Reply。"""
    if 'id' not in message:
        return Reply(202)
    msg_id = message['id']
    method = message['method']
    params = message.get('params') or {}

    if method == 'initialize':
        asked = params.get('protocolVersion')
        version = asked if asked in SUPPORTED_VERSIONS else LATEST
        return result(msg_id, {
            'protocolVersion': version,
            'capabilities': {'tools': {'listChanged': False}},
            'serverInfo': SERVER_INFO,
            'instructions': INSTRUCTIONS,
        })
    if method == 'ping':
        return result(msg_id, {})
    if method == 'tools/list':
        return result(msg_id, {'tools': tools.catalog(agent.scopes)})
    if method == 'tools/call':
        name = params.get('name')
        if not isinstance(name, str) or name not in tools.TOOLS:
            return error(msg_id, INVALID_PARAMS, f'不认识的工具 / unknown tool: {str(name)[:64]}')
        args = params.get('arguments')
        if args is not None and not isinstance(args, dict):
            return error(msg_id, INVALID_PARAMS, 'arguments 必须是对象 / arguments must be an object')
        try:
            data, _, text = tools.run(db, settings, agent, name, args or {}, 'mcp', request_id)
        except tools.ArgError as exc:
            return error(msg_id, INVALID_PARAMS, '参数不对 / invalid arguments', {'fields': exc.fields})
        except ApiError as err:
            if err.code == 'rate_limited':
                return from_api_error(msg_id, err, request_id)
            body = {'error': {'code': err.code, 'message': err.message}}
            if err.code == 'agent_scope_missing':
                body['error']['granted'] = sorted(agent.scopes)
                body['error']['needed'] = tools.TOOLS[name].scope
            return result(msg_id, tool_result(body, f'{err.message}（{err.code}）', is_error=True))
        return result(msg_id, tool_result(data, text))
    return error(msg_id, METHOD_NOT_FOUND, f'不支持的方法 / method not found: {method[:64]}')


def check_version_header(value):
    return value is None or value in SUPPORTED_VERSIONS

