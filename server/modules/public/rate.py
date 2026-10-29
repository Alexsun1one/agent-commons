"""公开层限流：按 IP 和 User-Agent 各分一桶，自称 AI 爬虫的给更高配额。

键名只存 HMAC 摘要，库里不落 IP 和 UA 原串；爬虫计数只记「哪个爬虫、哪天、几次」。
"""
import hmac

from app import clock, security

from . import config, store

WINDOW = 60


def digest(ctx, value):
    return hmac.new(ctx.settings.secret_key, (value or '').encode('utf-8'), 'sha256').hexdigest()[:24]


def enforce(ctx, bucket='page'):
    conn = ctx.db.conn()
    cfg = config.load(conn)
    ip_limit = config.as_int(cfg, 'rate.page_per_min' if bucket == 'page' else 'rate.api_per_min')
    ua_limit = config.as_int(cfg, 'rate.ua_per_min')
    user_agent = ctx.request.headers.get('user-agent', '')
    claimed = store.match_ua(conn, user_agent)
    if claimed:
        ip_limit = max(ip_limit, config.as_int(cfg, 'rate.ai_per_min'))
    ip_key = 'public:ip:' + digest(ctx, ctx.ip or 'unknown')
    ua_key = 'public:ua:' + digest(ctx, user_agent)
    day = clock.now()[:10]
    with ctx.db.write():
        security.hit(ctx.db, ip_key, ip_limit, WINDOW)
        security.hit(ctx.db, ua_key, ua_limit, WINDOW)
        for key in claimed:
            store.count_crawler(conn, key, day)
