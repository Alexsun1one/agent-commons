"""Member-owned data export. Queries deliberately exclude other members' private state."""

from app import accounts


def export(conn, actor):
    queries = {
        'profile': 'SELECT * FROM pet_profile WHERE owner_id = :pid',
        'actions': 'SELECT * FROM pet_action WHERE owner_id = :pid',
        'diary': 'SELECT * FROM pet_diary WHERE owner_id = :pid',
    }
    return {key: [dict(row) for row in conn.execute(sql, {'pid': actor.id})]
            for key, sql in queries.items()}


accounts.register_exporter('pet', export)
