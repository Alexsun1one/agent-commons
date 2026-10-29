"""悬赏模块的纯函数：等级封顶、展示状态、分奖、自动评选、推广任务筛查、赛季。不碰数据库。"""
import re
from datetime import datetime, timezone

GRACE_SECONDS = 72 * 3600
DAY = 86400
CAPS = {2: 50, 3: 200, 4: 500, 5: 1000}
CONCURRENT = {2: 1, 3: 3, 4: 5, 5: 5}
SEASON_GRANT = 100
SEASON_GRANT_MIN_LEVEL = 2
MIN_CREDITS = 5
MAX_SPLIT = 3
PROMO_PER_WEEK = 1
PAIR_REVIEW_AFTER = 2
USEFUL_MIN_LEVEL = 2
USEFUL_MIN_ACCOUNT_DAYS = 7

REWARD_TYPES = ('credits', 'cosmetic', 'perk', 'cash', 'goods')
UNAVAILABLE_REWARDS = ('cash', 'goods')
HELP_TYPES = ('discussion', 'question')
PROMO_TYPES = ('work', 'discussion')
TASK_KINDS = {
    'feedback': '试用后提问题',
    'bug': '报 bug',
    'review': '写体验',
    'recording': '录一段使用过程',
}
REJECT_REASONS = ('off_topic', 'low_effort', 'duplicate', 'not_reproducible', 'other')
DISPUTE_REASONS = ('not_received', 'not_as_promised', 'other')
COSMETICS = {
    'first-bug-hunter': ('badge', '首个 bug 猎人'),
    'deep-reviewer': ('badge', '深度体验官'),
    'early-tester': ('badge', '首批试用'),
    'lifeline': ('badge', '及时雨'),
    'panda-ink': ('palette', '熊猫配色 · 墨蓝'),
    'panda-frost': ('palette', '熊猫配色 · 霜银'),
    'panda-bamboo': ('palette', '熊猫配色 · 青竹'),
}
CODE_LIKE = re.compile(r'[A-Za-z0-9]{4,}(?:[-_ ][A-Za-z0-9]{4,}){2,}|(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{12,}')


def cap(level):
    return CAPS.get(level, 0)


def concurrent_limit(level):
    return CONCURRENT.get(level, 0)


def display_status(status, deadline_at, settle_after, now):
    """active 进行中 / judging 待评选 / closed 已结束。到了结算点但还没结算的也算已结束。"""
    if status != 'open':
        return 'closed'
    if now < deadline_at:
        return 'active'
    if now < settle_after:
        return 'judging'
    return 'closed'


def split(pool, shares):
    """按百分比分 pool，整数积分，余数给小数部分最大的（同大按顺序）。总和恒等于 pool。"""
    raw = [pool * s for s in shares]
    base = [r // 100 for r in raw]
    rest = pool - sum(base)
    order = sorted(range(len(shares)), key=lambda i: (-(raw[i] % 100), i))
    for i in order[:rest]:
        base[i] += 1
    return base


def valid_shares(shares):
    return (1 <= len(shares) <= MAX_SPLIT and all(isinstance(s, int) and 1 <= s <= 100 for s in shares)
            and sum(shares) == 100)


def auto_pick(answers, owner_id):
    """answers: [{id, author_id, created_at, useful}]。「有用」最多且至少 1 次；同票取更早的回答。没有就 None。"""
    eligible = [a for a in answers if a['author_id'] != owner_id and a['useful'] >= 1]
    if not eligible:
        return None
    return min(eligible, key=lambda a: (-a['useful'], a['created_at'], a['id']))['id']


def decide(bounty, object_lifecycle, now, answers=()):
    """结算决定。返回 (动作, 参数)：
    none 已结算 · wait 还不到 · cancel 原帖隐藏或撤回（参数是原因）· close 推广到期 ·
    auto_award 自动发给哪条回答 · refund 没有合格回答。"""
    if bounty['status'] != 'open':
        return 'none', None
    if object_lifecycle in (None, 'withdrawn'):
        return 'cancel', 'withdrawn'
    if object_lifecycle == 'hidden':
        return 'cancel', 'hidden'
    if now < bounty['settle_after']:
        return 'wait', None
    if object_lifecycle == 'pending_review':
        return 'wait', None
    if bounty['kind'] == 'promo':
        return 'close', 'expired'
    pick = auto_pick(answers, bounty['owner_id'])
    return ('auto_award', pick) if pick else ('refund', 'no_qualified')


def marker_qualifies(level, account_created_ts, marked_ts):
    return level >= USEFUL_MIN_LEVEL and account_created_ts <= marked_ts - USEFUL_MIN_ACCOUNT_DAYS * DAY


def normalize(text):
    return re.sub(r'\s+', ' ', str(text or '')).strip().lower()


def screen(text, rules):
    """rules: [{id, pattern, message, enabled}]，按顺序第一条命中的规则；都不命中返回 None。"""
    norm = normalize(text)
    for rule in rules:
        if rule['enabled'] and re.search(rule['pattern'], norm):
            return rule
    return None


def looks_like_code(text):
    return bool(CODE_LIKE.search(str(text or '')))


def quarter_season(ts):
    d = datetime.fromtimestamp(ts, timezone.utc)
    return f's{d.year}q{(d.month - 1) // 3 + 1}'
