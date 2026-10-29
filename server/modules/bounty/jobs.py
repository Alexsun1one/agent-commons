"""悬赏到期结算：worker 每 5 分钟扫一次。每条悬赏单独一个短事务，一条出错不连累别的；读接口也会懒结算。"""
import logging

from app import clock, worker

from . import service

log = logging.getLogger('commons.bounty')


def settle(db):
    conn = db.conn()
    if not service.ready(conn):
        return 0
    done = 0
    for bounty_id in service.due_ids(conn, clock.now(), limit=200):
        try:
            with db.write() as w:
                row = w.execute('SELECT * FROM bounty WHERE id = ?', (bounty_id,)).fetchone()
                done += bool(service.settle(w, row))
        except Exception:  # noqa: BLE001 — 单条结算失败只记日志，下一轮再试
            log.exception('bounty settle failed bounty_id=%s', bounty_id)
    return done


worker.register_periodic('bounty.settle', 300, settle)
