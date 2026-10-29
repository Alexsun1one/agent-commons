"""Member-owned data export. Queries deliberately exclude other members' private state."""

from app import accounts


def export(conn, actor):
    queries = {
        'exams': 'SELECT * FROM game_exam WHERE principal_id = :pid',
        'answers': 'SELECT a.* FROM game_exam_answer a JOIN game_exam e ON e.id = a.exam_id WHERE e.principal_id = :pid',
        'best_score': 'SELECT * FROM game_best_score WHERE principal_id = :pid',
        'guesses': 'SELECT * FROM game_guess_attempt WHERE principal_id = :pid',
        'fortunes': 'SELECT * FROM game_fortune WHERE principal_id = :pid',
        'sofa_replies': 'SELECT * FROM game_sofa_reply WHERE principal_id = :pid',
        'rewards': 'SELECT * FROM game_reward WHERE principal_id = :pid',
        'preferences': 'SELECT * FROM game_preference WHERE principal_id = :pid',
    }
    return {key: [dict(row) for row in conn.execute(sql, {'pid': actor.id})]
            for key, sql in queries.items()}


accounts.register_exporter('games', export)
