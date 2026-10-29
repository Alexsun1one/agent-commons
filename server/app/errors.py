CODES = {
    'malformed_request': (400, '请求格式不正确'),
    'unauthenticated': (401, '需要先登录'),
    'session_expired': (401, '登录已过期，请重新登录'),
    'invalid_credentials': (401, '账号或密码不正确'),
    'totp_required': (401, '需要动态验证码'),
    'action_not_allowed': (403, '没有权限执行这个操作'),
    'totp_setup_required': (403, '需要先开启动态验证码'),
    'csrf_failed': (403, '缺少请求校验头'),
    'origin_rejected': (403, '请求来源不被允许'),
    'resource_not_found': (404, '内容不存在或不可见'),
    'method_not_allowed': (405, '不支持这个请求方法'),
    'state_conflict': (409, '当前状态不允许这个操作'),
    'idempotency_conflict': (409, '同一个幂等键对应了不同的请求'),
    'cursor_stale': (409, '翻页位置已失效，请从第一页重新查询'),
    'version_conflict': (412, '内容已被更新，请刷新后再改'),
    'payload_too_large': (413, '请求体过大'),
    'unsupported_media_type': (415, '只接受 application/json'),
    'validation_failed': (422, '输入不符合要求'),
    'unknown_field': (422, '包含不认识的字段'),
    'invite_invalid': (422, '邀请码无效'),
    'reset_invalid': (422, '重置码无效'),
    'totp_invalid': (422, '动态验证码不正确'),
    'precondition_required': (428, '缺少 If-Match 版本'),
    'rate_limited': (429, '请求太频繁，请稍后再试'),
    'internal_error': (500, '服务器出错了'),
    'capability_unavailable': (501, '这个功能还没有开放'),
    'service_unavailable': (503, '服务暂时不可用'),
}

RETRYABLE = {'rate_limited', 'internal_error', 'service_unavailable'}


def register(code, status, message):
    if code in CODES and CODES[code] != (status, message):
        raise ValueError(f'error code {code} already registered')
    CODES[code] = (status, message)


class ApiError(Exception):
    def __init__(self, code, message=None, headers=None, **extra):
        status, default = CODES[code]
        super().__init__(code)
        self.code = code
        self.status = status
        self.message = message or default
        self.headers = headers or {}
        self.extra = extra


def error_body(code, message, request_id, **extra):
    body = {'code': code, 'message': message, 'request_id': request_id, 'retryable': code in RETRYABLE}
    body.update(extra)
    return {'error': body}
