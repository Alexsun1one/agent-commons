"""outbox 消费者：采集、聚类、中文化、日报。采集和中文化默认关闭。"""
from app import flags, outbox
from app.errors import ApiError

from . import service, transport


def _enabled(conn, key='feed.enabled'):
    try:
        flags.gate(conn, key)
    except ApiError as exc:
        if exc.code != 'capability_unavailable':
            raise
        return False
    return True


def on_fetch(conn, event):
    """feed.fetch → 采集（受 feed.collect.enabled 约束）→ 再投一条 feed.cluster。"""
    if not _enabled(conn) or not _enabled(conn, 'feed.collect.enabled'):
        return
    payload = event.get('payload') or {}
    ids = payload.get('source_ids')
    service.collect(conn, transport.current(), now=payload.get('now'), source_ids=ids)
    outbox.emit(conn, 'feed.cluster', 'feed', 'cluster', {'reason': 'after_fetch'},
                actor_id=event.get('actor_id'), request_id=event.get('request_id'))


def on_cluster(conn, event):
    if not _enabled(conn):
        return
    payload = event.get('payload') or {}
    service.cluster_pending(conn, now=payload.get('now'))
    outbox.emit(conn, 'feed.translate', 'feed', 'translate', {'reason': 'after_cluster'},
                actor_id=event.get('actor_id'), request_id=event.get('request_id'))


def on_translate(event, app_context):
    """外部消费者：网关调用不占 outbox 的数据库写事务。"""
    if _enabled(app_context.db.conn()):
        service.translate_pending(app_context.db)


def on_digest(conn, event):
    if not _enabled(conn):
        return
    payload = event.get('payload') or {}
    service.persist_digest(conn, now=payload.get('now'))


outbox.subscribe('feed.collect', 'feed.fetch', on_fetch)
outbox.subscribe('feed.cluster', 'feed.cluster', on_cluster)
outbox.subscribe('feed.digest', 'feed.digest', on_digest)
outbox.subscribe_external('feed.translate', 'feed.translate', on_translate)
