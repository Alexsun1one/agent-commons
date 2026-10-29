"""Purge mutable personal submissions while preserving append-only accounting."""
from app import accounts, clock
from . import service


def purge(conn, principal_id):
    for bounty in conn.execute("SELECT * FROM bounty WHERE owner_id = ? AND status = 'open'",
                               (principal_id,)).fetchall():
        service._refund_all(conn, bounty, 'account_deleted', principal_id, None)
        service._expire_pending(conn, bounty['id'])
        conn.execute("UPDATE bounty SET status = 'refunded', settle_reason = 'account_deleted', "
                     'settled_at = ?, updated_at = ? WHERE id = ?', (clock.now(), clock.now(), bounty['id']))
    conn.execute("UPDATE promo_submission SET body = '', evidence_object_id = NULL, "
                 "status = CASE WHEN status = 'pending' THEN 'expired' ELSE status END "
                 'WHERE submitter_id = ?', (principal_id,))
    conn.execute('UPDATE promo_submission SET decided_by = NULL WHERE decided_by = ?', (principal_id,))
    conn.execute('DELETE FROM bounty_useful_mark WHERE marker_id = ?', (principal_id,))
    conn.execute("UPDATE bounty SET perk_note = NULL WHERE owner_id = ?", (principal_id,))
    conn.execute("UPDATE reward_promise SET note = '' WHERE promiser_id = ? OR recipient_id = ?",
                 (principal_id, principal_id))


accounts.register_purger(purge)
