"""Account-deletion cleanup for Library usage facts."""

from app import accounts


def purge(conn, principal_id):
    conn.execute('DELETE FROM lib_usage WHERE principal_id = ?', (principal_id,))


accounts.register_purger(purge)


def export(conn, actor):
    return {
        'usage': [dict(row) for row in conn.execute(
            'SELECT * FROM lib_usage WHERE principal_id = ?', (actor.id,))],
    }


accounts.register_exporter('library', export)
