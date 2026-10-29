"""周期任务：按时间切换活动状态，幂等。"""

from app import worker

from . import service


def tick(db):
    return service.tick(db)


worker.register_periodic('events.status_tick', 60, tick)
