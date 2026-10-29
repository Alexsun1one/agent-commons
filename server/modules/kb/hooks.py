"""Account-deletion cleanup for KB drafts and private reproduction facts."""

from app import accounts


def purge(conn, principal_id):
    conn.execute("DELETE FROM kb_capture WHERE requested_by = ? AND status = 'draft'", (principal_id,))
    conn.execute("UPDATE kb_capture SET requested_by = NULL WHERE requested_by = ? AND status = 'confirmed'",
                 (principal_id,))
    conn.execute('DELETE FROM kb_verification WHERE principal_id = ?', (principal_id,))
    # Public solutions and links remain attributable through the core's anonymised profile.


accounts.register_purger(purge)


def export(conn, actor):
    return {
        'environments': [dict(row) for row in conn.execute(
            'SELECT e.* FROM kb_env e JOIN object_head h ON h.id = e.problem_id '
            'WHERE h.author_id = ?', (actor.id,))],
        'captures': [dict(row) for row in conn.execute(
            'SELECT * FROM kb_capture WHERE requested_by = ?', (actor.id,))],
        'solutions': [dict(row) for row in conn.execute(
            'SELECT * FROM kb_solution WHERE author_id = ?', (actor.id,))],
        'verifications': [dict(row) for row in conn.execute(
            'SELECT * FROM kb_verification WHERE principal_id = ?', (actor.id,))],
        'links': [dict(row) for row in conn.execute(
            'SELECT * FROM kb_link WHERE created_by = ?', (actor.id,))],
    }


accounts.register_exporter('kb', export)
