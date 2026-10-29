"""Export own operator records; preserve immutable parameter history for audit."""
from app import accounts


def export(conn, actor):
    return {'parameter_changes': [dict(r) for r in conn.execute(
        'SELECT namespace, key, version, value, previous_value, kind, reason, created_at '
        'FROM admin_param_version WHERE actor_id = ? ORDER BY created_at', (actor.id,))]}


def purge(conn, principal_id):
    # Append-only version rows retain their tombstoned actor ID; do not alter evidence.
    conn.execute('UPDATE admin_param SET updated_by = NULL WHERE updated_by = ?', (principal_id,))


accounts.register_exporter('admin', export)
accounts.register_purger(purge)
