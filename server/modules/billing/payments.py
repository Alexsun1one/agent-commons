"""支付适配器接口。只定义形状，不接任何真实支付渠道。

默认渠道是 `disabled`：任何下单都返回 `billing_provider_unavailable`。
将来接渠道时，在独立文件里实现 PaymentAdapter 并调用 register()；
`billing_config.payments.provider` 指向它的名字，`billing.payments` 开关打开后才会被调用。
回调（webhook）要绕过核心层的 Origin/CSRF 检查，需要主控在核心层加窄例外，见回执。
"""
from typing import Protocol

from app.errors import ApiError


class PaymentAdapter(Protocol):
    name: str

    def create_checkout(self, order: dict) -> dict:
        """为订单生成收银台参数。返回 {'provider_ref': str, 'checkout_url': str | None}。
        在写事务里调用，所以只能在本地签名、拼参数，不能发网络请求。"""

    def parse_webhook(self, headers: dict, body: bytes) -> dict:
        """校验签名并解析回调。返回 {'provider_ref': str, 'status': 'paid' | 'failed' | 'refunded'}。"""

    def refund(self, order: dict, amount_fen: int) -> dict:
        """发起退款。返回 {'provider_ref': str, 'status': 'refunded' | 'pending'}。"""


class DisabledAdapter:
    name = 'disabled'

    def create_checkout(self, order):
        raise ApiError('billing_provider_unavailable')

    def parse_webhook(self, headers, body):
        raise ApiError('billing_provider_unavailable')

    def refund(self, order, amount_fen):
        raise ApiError('billing_provider_unavailable')


ADAPTERS = {'disabled': DisabledAdapter()}


def register(adapter):
    if not getattr(adapter, 'name', None) or not adapter.name.replace('_', '').isalnum():
        raise ValueError('payment adapter needs a lowercase name')
    ADAPTERS[adapter.name] = adapter


def unregister(name):
    if name != 'disabled':
        ADAPTERS.pop(name, None)


def get(name):
    return ADAPTERS.get(name) or ADAPTERS['disabled']
