"""注销清理与到期任务。"""
import logging

from app import accounts, worker

from . import service

log = logging.getLogger('commons.billing')


def purge(conn, principal_id):
    service.purge(conn, principal_id)


def expire_due(db):
    """试用和生效订阅到期转「过期」。每条单独一个短事务；读接口也会对本人懒处理。"""
    conn = db.conn()
    if not service.ready(conn):
        return 0
    done = 0
    for sub_id in service.due_ids(conn, limit=500):
        try:
            with db.write() as w:
                done += service.expire(w, sub_id) is not None
        except Exception:  # noqa: BLE001 — 单条失败只记日志，下一轮再试
            log.exception('billing expire failed subscription_id=%s', sub_id)
    return done


accounts.register_purger(purge)
worker.register_periodic('billing.expire', 3600, expire_due)
