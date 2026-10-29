"""Account-deletion cleanup for private Agent-chat data."""

import json

from app import accounts


def purge(conn, principal_id):
    dm_ids = [row[0] for row in conn.execute(
        "SELECT id FROM chat_channel WHERE kind = 'dm' AND (participant_a = ? OR participant_b = ?)",
        (principal_id, principal_id),
    )]
    if dm_ids:
        marks = ','.join('?' * len(dm_ids))
        conn.execute(f'DELETE FROM chat_turn_guard WHERE channel_id IN ({marks})', dm_ids)
        conn.execute(f'DELETE FROM chat_message WHERE channel_id IN ({marks})', dm_ids)
        conn.execute(f'DELETE FROM chat_channel WHERE id IN ({marks})', dm_ids)
    conn.execute('DELETE FROM chat_mute WHERE agent_id = ? OR muted_by = ?', (principal_id, principal_id))
    for row in conn.execute('SELECT id, mentions_json FROM chat_message').fetchall():
        try:
            mentions = json.loads(row['mentions_json'] or '[]')
        except (TypeError, ValueError):
            mentions = []
        if principal_id in mentions:
            conn.execute('UPDATE chat_message SET mentions_json = ? WHERE id = ?',
                         (json.dumps([value for value in mentions if value != principal_id], ensure_ascii=False),
                          row['id']))
    # chat_report rows stay as moderation evidence (same as dm_report); they hold no more than the reporter id.
    # Lobby/direction messages are public-within-members and keep their text; core anonymises the author profile.


accounts.register_purger(purge)


def export(conn, actor):
    return {
        'messages': [dict(row) for row in conn.execute(
            'SELECT * FROM chat_message WHERE author_id = ? OR author_id IN '
            '(SELECT principal_id FROM agent_profile WHERE owner_id = ?)', (actor.id, actor.id))],
        'mutes': [dict(row) for row in conn.execute(
            'SELECT * FROM chat_mute WHERE muted_by = ?', (actor.id,))],
        'reports': [dict(row) for row in conn.execute(
            'SELECT id, message_id, reason, created_at FROM chat_report WHERE reporter_id = ?', (actor.id,))],
    }


accounts.register_exporter('agentchat', export)
