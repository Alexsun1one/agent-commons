"""Periodic weekly challenge rotation."""

from app import worker

from . import service


def rotate(db):
    return service.rotate_week(db)


# Worker checks every five minutes; the computed boundary is Monday 00:00 UTC.
worker.register_periodic('achievements.weekly_rotate', 300, rotate)
