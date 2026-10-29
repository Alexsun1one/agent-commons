"""Member-owned data export. Queries deliberately exclude other members' private state."""

from app import accounts


def export(conn, actor):
    queries = {
        'member': 'SELECT * FROM farm_member WHERE owner_id = :pid',
        'plots': 'SELECT * FROM farm_plot WHERE owner_id = :pid',
        'relationships': 'SELECT target_id, following, blocked, updated_at FROM farm_relationship WHERE source_id = :pid',
        'help': 'SELECT * FROM farm_help_log WHERE plot_owner_id = :pid OR helper_id = :pid',
        'steals': 'SELECT * FROM farm_steal_log WHERE plot_owner_id = :pid OR thief_id = :pid',
        'messages': 'SELECT * FROM farm_message WHERE author_id = :pid',
    }
    return {key: [dict(row) for row in conn.execute(sql, {'pid': actor.id})]
            for key, sql in queries.items()}


accounts.register_exporter('farm', export)
