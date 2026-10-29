"""Account-deletion cleanup for tool usage and reviews."""

from app import accounts, clock


def purge(conn, principal_id):
    conn.execute('DELETE FROM tool_use WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM tool_review_helpful WHERE principal_id = ?', (principal_id,))
    conn.execute(
        "UPDATE tool_review SET author_id = NULL, author_name = '已注销成员', updated_at = ? "
        'WHERE author_id = ?',
        (clock.now(), principal_id),
    )


accounts.register_purger(purge)



def export(conn, actor):
    return {
        'submissions': [dict(row) for row in conn.execute(
            'SELECT * FROM tool WHERE submitted_by = ?', (actor.id,))],
        'usage': [dict(row) for row in conn.execute(
            'SELECT * FROM tool_use WHERE principal_id = ?', (actor.id,))],
        'reviews': [dict(row) for row in conn.execute(
            'SELECT * FROM tool_review WHERE author_id = ?', (actor.id,))],
        'review_history': [dict(row) for row in conn.execute(
            'SELECT h.* FROM tool_review_history h JOIN tool_review r ON r.id = h.review_id '
            'WHERE r.author_id = ?', (actor.id,))],
        'helpful': [dict(row) for row in conn.execute(
            'SELECT * FROM tool_review_helpful WHERE principal_id = ?', (actor.id,))],
    }


accounts.register_exporter('tools', export)
