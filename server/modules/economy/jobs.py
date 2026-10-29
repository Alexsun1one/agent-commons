"""Idempotent UTC-day cleanup for Economy earning counters."""

from app import clock, worker

from . import service


def reset_daily(db):
    day = service._day(clock.now_ts())
    with db.write() as conn:
        return conn.execute('DELETE FROM wallet_daily_earning WHERE day < ?', (day,)).rowcount


# The core worker checks this task every five minutes; after 00:00 UTC the first
# successful run removes yesterday's counters. A repeated run is a no-op.
worker.register_periodic('economy.daily_reset', 300, reset_daily)

