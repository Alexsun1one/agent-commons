"""Periodic Growth jobs registered with the core worker."""

from app import flags, worker

from . import engine


def recompute(db):
    """Recompute every active human; each member stays transaction-atomic."""
    flags.gate(db.conn(), 'growth.enabled')
    return engine.recompute_all(db)


worker.register_periodic('growth.recompute', 3600, recompute)
