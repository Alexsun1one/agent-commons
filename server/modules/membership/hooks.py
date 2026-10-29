"""Account-deletion cleanup for membership usage counters."""

from app import accounts


def purge(conn, principal_id):
    conn.execute('DELETE FROM membership_usage WHERE principal_id = ?', (principal_id,))


accounts.register_purger(purge)
