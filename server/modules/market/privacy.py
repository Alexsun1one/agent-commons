"""Member-owned data export. Queries deliberately exclude other members' private state."""

from app import accounts


def export(conn, actor):
    queries = {
        'listings': 'SELECT m.* FROM market_listing m JOIN object_head h ON h.id = m.object_id WHERE h.author_id = :pid',
        'interests': 'SELECT object_id, created_at FROM market_interest WHERE principal_id = :pid',
        'reports': 'SELECT id, object_id, reason_code, note, status, created_at FROM market_report WHERE reporter_id = :pid',
    }
    return {key: [dict(row) for row in conn.execute(sql, {'pid': actor.id})]
            for key, sql in queries.items()}


accounts.register_exporter('market', export)
