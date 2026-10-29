"""模型层：经 AI-1 的模型网关（modules.ai.gateway）做文字和图片初筛。本模块不直接调用任何服务商。

两道闸都开才会真的外发：
  1. 治理侧 gov.model_egress（默认关，迁移里写死 0；管理员 + 动态验证码在 /api/admin/flags 打开，记 flag.set 审计）；
  2. 网关侧 ai.enabled + ai.governance.screen_text.enabled / ai.governance.screen_image.enabled（AI-1 管）。
网关没部署时检测器是「unavailable」，任务记为跳过；网关降级（预算超限、开关关、SDK 缺失）时不产生建议。
模型结论只进复核队列当建议（FZ-06），对应规则 agent.* 的 auto_action 被约束为 none，永远不会自动处罚。
发出去的是去标识后的文字（联系方式已在本机规则里识别过，不需要模型再看原值），不带作者身份和本机文件路径。
"""
import importlib
import json

from . import detectors
from .detectors import Signal

SUGGESTIONS = frozenset({'hide', 'pending_review', 'rate_limit', 'require_source', 'delete', 'ban', 'deduct',
                         'demote', 'restore'})
MAX_FINDINGS = 10
MAX_OUTPUT = 4000


def gateway():
    try:
        return importlib.import_module('modules.ai.gateway')
    except ImportError:
        return None


def _get(obj, *names, default=None):
    for name in names:
        if isinstance(obj, dict) and name in obj:
            return obj[name]
        if not isinstance(obj, dict) and hasattr(obj, name):
            return getattr(obj, name)
    return default


def _num(value, default):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return max(0.0, min(1.0, float(value)))
    return default


def _findings(output):
    if isinstance(output, str):
        try:
            output = json.loads(output)
        except ValueError:
            return []
    if not isinstance(output, dict):
        return []
    found = output.get('findings')
    if isinstance(found, list):
        return [f for f in found if isinstance(f, dict)][:MAX_FINDINGS]
    return [output]


def _trim(value):
    text = json.dumps(value, ensure_ascii=False, default=str)
    return value if len(text) <= MAX_OUTPUT else {'truncated': text[:MAX_OUTPUT]}


class GatewayDetector:
    """经模型网关的治理 Agent。kind 不是 'rule'，所以在事务外的 gov_agent_job 里跑。"""
    version = '1'
    kind = 'agent'
    egress = True
    model = None
    model_version = None

    def __init__(self, name, modalities, feature, task):
        self.name = name
        self.modalities = set(modalities)
        self.feature = feature
        self.task = task

    def available(self):
        return gateway() is not None

    def inputs(self, item):
        media = [{'kind': m.kind, 'mime': m.mime, 'size': m.size, 'width': m.width, 'height': m.height,
                  'index': m.index} for m in item.media]
        if self.feature.endswith('screen_image'):
            data = {'target_type': item.target_type, 'media': [m for m in media if m['kind'] == 'image']}
            if item.target_type == 'upload':
                data['asset_id'] = item.target_id
            return data
        return {'object_type': item.object_type, 'title': item.title, 'text': item.text, 'html': item.html,
                'pii_found': sorted({p.category for p in item.pii})}

    def check(self, item):
        gw = gateway()
        if gw is None:
            raise detectors.Unavailable('modules.ai.gateway')
        result = gw.run(detectors.call_conn(), feature=self.feature, task=self.task, inputs=self.inputs(item),
                        actor_id=None, object_id=item.target_id if item.target_type == 'object' else None)
        if _get(result, 'fallback', 'fell_back', 'degraded', default=False):
            return []
        output = _get(result, 'output', 'data', 'result', default=None)
        model = _get(result, 'model', default=None)
        model_version = _get(result, 'model_version', 'provider', default=None)
        out = []
        for f in _findings(output):
            confidence = _num(_get(f, 'confidence'), 0.5)
            score = _num(_get(f, 'score', 'risk'), confidence)
            suggestion = _get(f, 'suggested_action', 'suggestion', 'action')
            category = str(_get(f, 'category', default='agent') or 'agent')[:40]
            reason = str(_get(f, 'reason', 'summary', default='') or '')[:200]
            locator = _get(f, 'locator', default={})
            if not isinstance(locator, dict):
                locator = {}
            locator = {k: v for k, v in locator.items() if k in ('field', 'start', 'end', 'line', 'paragraph', 'index')}
            out.append(Signal('agent.default', category, score, confidence, {'field': 'agent', **locator}, reason,
                              suggestion if suggestion in SUGGESTIONS else None,
                              {'model': str(model)[:80] if model else None,
                               'model_version': str(model_version)[:80] if model_version else None,
                               'feature': self.feature, 'finding': _trim(f)}))
        return out


TEXT = GatewayDetector('agent.gateway.text', {'text', 'html'}, 'governance.screen_text', 'screen')
IMAGE = GatewayDetector('agent.gateway.image', {'image'}, 'governance.screen_image', 'screen')
for _d in (TEXT, IMAGE):
    detectors.register(_d)
