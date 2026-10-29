"""Account export and deletion hooks owned by Economy."""

from app import accounts

from . import service


def purge(conn, principal_id):
    """Remove mutable personal state; immutable ledger/purchase audit stays anonymous with the core tombstone."""
    conn.execute('DELETE FROM wallet_daily_earning WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM economy_inventory WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM economy_checkin WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM wallet_balance WHERE principal_id = ?', (principal_id,))


accounts.register_exporter('economy', service.export)
accounts.register_purger(purge)

