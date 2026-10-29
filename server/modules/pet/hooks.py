"""Account deletion hook for PET-1."""
from app import accounts


def purge(conn, principal_id):
    conn.execute('DELETE FROM pet_action WHERE owner_id = ? OR target_owner_id = ?',
                 (principal_id, principal_id))
    conn.execute('DELETE FROM pet_diary WHERE owner_id = ?', (principal_id,))
    conn.execute('DELETE FROM pet_profile WHERE owner_id = ?', (principal_id,))


accounts.register_purger(purge)
