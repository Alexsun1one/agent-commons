"""GAMES-1 每日题目轮换。"""

from app import worker

from . import service


def rotate(db):
    with db.write() as conn:
        return service.ensure_daily_rotation(conn)


worker.register_periodic('games.daily_rotation', 300, rotate)

