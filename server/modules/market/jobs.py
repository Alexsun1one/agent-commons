"""R13 MARKET-1 · 市集到期任务。worker 每 5 分钟检查一次；读接口也会惰性补一次。"""

from app import worker

from . import service


def expire(db):
    with db.write() as conn:
        service.expire_due(conn)


worker.register_periodic('market.expire', 300, expire)
