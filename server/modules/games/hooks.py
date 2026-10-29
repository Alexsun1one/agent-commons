"""GAMES-1 账号注销清理。"""

from app import accounts


def purge(conn, principal_id):
    exam_ids = [row[0] for row in conn.execute(
        'SELECT id FROM game_exam WHERE principal_id = ?', (principal_id,)
    ).fetchall()]
    for exam_id in exam_ids:
        conn.execute('DELETE FROM game_exam_answer WHERE exam_id = ?', (exam_id,))
        conn.execute('DELETE FROM game_exam_question WHERE exam_id = ?', (exam_id,))
    conn.execute('DELETE FROM game_best_score WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM game_exam WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM game_guess_attempt WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM game_fortune WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM game_sofa_reply WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM game_reward WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM game_preference WHERE principal_id = ?', (principal_id,))


accounts.register_purger(purge)

