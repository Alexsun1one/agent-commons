"""Member-owned data export. Queries deliberately exclude other members' private state."""

from app import accounts


def export(conn, actor):
    queries = {
        'achievements': 'SELECT * FROM member_achievement WHERE principal_id = :pid',
        'credits': 'SELECT * FROM achievement_credit WHERE principal_id = :pid',
        'activity_days': 'SELECT * FROM achievement_activity_day WHERE principal_id = :pid',
        'challenges': 'SELECT * FROM member_weekly_challenge WHERE principal_id = :pid',
        'challenge_credits': 'SELECT * FROM weekly_challenge_credit WHERE principal_id = :pid',
    }
    return {key: [dict(row) for row in conn.execute(sql, {'pid': actor.id})]
            for key, sql in queries.items()}


accounts.register_exporter('achievements', export)
