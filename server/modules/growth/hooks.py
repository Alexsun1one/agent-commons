"""Account-deletion cleanup for Growth-owned personal data."""

from app import accounts


def purge(conn, principal_id):
    conn.execute('UPDATE growth_rule SET updated_by = NULL WHERE updated_by = ?', (principal_id,))
    conn.execute('UPDATE growth_season SET created_by = NULL WHERE created_by = ?', (principal_id,))
    conn.execute('UPDATE growth_review SET decided_by = NULL WHERE decided_by = ?', (principal_id,))
    conn.execute('DELETE FROM growth_review WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM growth_token_report WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM growth_entry_meta WHERE subject_id = ? OR counterparty_id = ?',
                 (principal_id, principal_id))
    conn.execute('DELETE FROM growth_counter WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM growth_activity WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM growth_state WHERE principal_id = ?', (principal_id,))


accounts.register_purger(purge)
