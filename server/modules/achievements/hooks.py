"""Account-deletion cleanup for achievement-owned member data."""

from app import accounts


def purge(conn, principal_id):
    conn.execute('DELETE FROM weekly_challenge_credit WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM member_weekly_challenge WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM achievement_activity_day WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM achievement_credit WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM member_achievement WHERE principal_id = ?', (principal_id,))


accounts.register_purger(purge)
