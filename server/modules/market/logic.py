"""R13 MARKET-1 · 市集的分类、字段、状态、限额和禁止品类。

这里只放纯规则：不碰数据库，也不读时钟。服务层和前端用同一份中文标签；
禁止品类先做 Unicode 归一化，再按大小写不敏感匹配。命中一律拒绝，不进待审。
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone, timedelta

CATEGORIES = {
    'sell': {
        'label': '闲置转让',
        'active': '在售',
        'glyph': 'workshop',
        'required': ('condition', 'price', 'city', 'shipping'),
        'fields': ('condition', 'price', 'city', 'shipping'),
    },
    'buy': {
        'label': '求购',
        'active': '求购中',
        'glyph': 'search',
        'required': ('budget',),
        'fields': ('budget', 'city'),
    },
    'collab': {
        'label': '合作与外包',
        'active': '招募中',
        'glyph': 'link',
        'required': ('budget', 'cycle'),
        'fields': ('budget', 'cycle'),
    },
    'jobs': {
        'label': '内推与招聘',
        'active': '招聘中',
        'glyph': 'briefcase',
        'required': ('company', 'position'),
        'fields': ('company', 'position', 'city', 'work_mode'),
    },
    'groupbuy': {
        'label': '拼车拼单',
        'active': '征集中',
        'glyph': 'people',
        'required': ('target', 'price', 'deadline'),
        'fields': ('target', 'price', 'deadline'),
    },
    'free': {
        'label': '免费送',
        'active': '可领取',
        'glyph': 'heart',
        'required': ('condition', 'city', 'shipping'),
        'fields': ('condition', 'city', 'shipping'),
    },
}

CATEGORY_ORDER = ('sell', 'buy', 'collab', 'jobs', 'groupbuy', 'free')

FIELD_LABELS = {
    'condition': '成色',
    'price': '价格',
    'city': '城市',
    'shipping': '邮寄',
    'budget': '预算',
    'cycle': '周期',
    'company': '公司',
    'position': '岗位',
    'work_mode': '方式',
    'target': '拼单目标',
    'deadline': '截止',
}

STATUSES = ('active', 'reserved', 'sold', 'expired')
STATUS_LABELS = {'active': '', 'reserved': '已预订', 'sold': '已成交', 'expired': '已过期'}

# 发布额度按 UTC 自然日计算；L1 只能 1 条/天。
DAILY_LIMITS = {1: 1, 2: 3, 3: 5, 4: 8, 5: 10}

REPORT_REASONS = {
    'forbidden': '禁止品类',
    'scam': '疑似诈骗',
    'counterfeit': '假货或仿品',
    'contact': '骚扰或泄露联系方式',
    'spam': '重复刷屏',
    'other': '其他',
}

# 统一成小写后匹配。只拦明确指向交易/服务的写法，避免把「账号安全」这类讨论误杀。
FORBIDDEN = (
    ('account_trade', re.compile(
        r'(账号|帐号|账户|游戏号|社交号|邮箱号).{0,12}(买卖|出售|收购|转让|出租|租用|交易|共享)'
        r'|(买卖|出售|收购|转让|出租|租用|交易|共享).{0,12}(账号|帐号|账户|游戏号|社交号|邮箱号)', re.I),
     '账号买卖'),
    ('key_resale', re.compile(
        r'(api\s*key|apikey|密钥|令牌|token|兑换码|激活码).{0,12}(出售|转售|倒卖|转让|出租|租用)', re.I),
     'API key 转售'),
    ('cracked', re.compile(
        r'(破解版|破解软件|注册机|激活工具|keygen|crack|绿色版|去限制版)', re.I),
     '破解软件'),
    ('gray', re.compile(
        r'(代充|代付|洗钱|刷单|接码|养号|黑产|灰产|博彩|赌博|色情|外挂|私彩|代开发票|代实名)'
        r'|(银行卡|信用卡|身份证|实名).{0,8}(出售|出租|买卖|代办)'
        r'|(出售|出租|买卖|代办).{0,8}(银行卡|信用卡|身份证|实名)', re.I),
     '灰产代充'),
)

MAX_IMAGES = 6
EXPIRY_DAYS = 30
EXPIRY_SECONDS = EXPIRY_DAYS * 86400
MAX_BODY = 5000


def normalize_text(value) -> str:
    text = unicodedata.normalize('NFKC', str(value or ''))
    return re.sub(r'\s+', ' ', text).strip()


def screen(text):
    """返回命中的禁止品类，没有命中返回 None。"""
    value = normalize_text(text).lower()
    if not value:
        return None
    for key, pattern, label in FORBIDDEN:
        if pattern.search(value):
            return {'rule': key, 'label': label}
    return None


def daily_limit(level: int, l1_override=None) -> int:
    value = DAILY_LIMITS.get(int(level or 1), DAILY_LIMITS[1])
    return int(l1_override) if int(level or 1) <= 1 and l1_override is not None else value


def seconds_to_midnight(now_text: str) -> int:
    try:
        now = datetime.strptime(now_text, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return 86400
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((nxt - now).total_seconds()))


def active_label(category: str) -> str:
    return CATEGORIES.get(category, {}).get('active', '在售')


def status_label(category: str, status: str) -> str:
    if status == 'active':
        return active_label(category)
    return STATUS_LABELS.get(status, status)


def field_label(key: str) -> str:
    return FIELD_LABELS.get(key, key)


def category_label(key: str) -> str:
    return CATEGORIES.get(key, {}).get('label', key)


def category_fields(key: str):
    return CATEGORIES.get(key, {}).get('fields', ())


def required_fields(key: str):
    return CATEGORIES.get(key, {}).get('required', ())


def glyph(key: str) -> str:
    return CATEGORIES.get(key, {}).get('glyph', 'spark')
