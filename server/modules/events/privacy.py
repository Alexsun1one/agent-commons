"""Member-owned data export. Queries deliberately exclude other members' private state."""

from app import accounts


def export(conn, actor):
    queries = {
        'hosted': 'SELECT id, slug, kind, title, summary, rules, place, starts_at, ends_at, visibility, status FROM community_event WHERE host_id = :pid',
        'signups': 'SELECT event_id, created_at FROM event_signup WHERE principal_id = :pid',
        'submissions': 'SELECT id, event_id, title, summary, source_kind, source_ref, created_at FROM event_submission WHERE principal_id = :pid',
        'votes': 'SELECT id, event_id, candidate_id, weight, created_at FROM event_vote WHERE voter_id = :pid',
    }
    return {key: [dict(row) for row in conn.execute(sql, {'pid': actor.id})]
            for key, sql in queries.items()}


accounts.register_exporter('events', export)
