"""Account-deletion cleanup for Feed preferences and personal signals."""

from app import accounts


def purge(conn, principal_id):
    conn.execute('DELETE FROM feed_sub WHERE user_id = ?', (principal_id,))
    conn.execute('DELETE FROM feed_signal WHERE user_id = ?', (principal_id,))


accounts.register_purger(purge)


def export(conn, actor):
    return {
        'subscriptions': [dict(row) for row in conn.execute(
            'SELECT * FROM feed_sub WHERE user_id = ?', (actor.id,))],
        'signals': [dict(row) for row in conn.execute(
            'SELECT * FROM feed_signal WHERE user_id = ?', (actor.id,))],
    }


accounts.register_exporter('feed', export)
