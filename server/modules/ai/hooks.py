"""Remove private preferences/cache; retain de-identified operational accounting."""
from app import accounts


def purge(conn, principal_id):
    conn.execute('DELETE FROM ai_member_pref WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM ai_cache WHERE object_id IN '
                 '(SELECT id FROM object_head WHERE author_id = ?)', (principal_id,))
    conn.execute('UPDATE ai_call SET actor_id = NULL WHERE actor_id = ?', (principal_id,))


accounts.register_purger(purge)
