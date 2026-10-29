"""Export only the member's messages and preferences, never another sender's body."""
from app import accounts


def export(conn, actor):
    queries = {
        'messages': 'SELECT id, thread_id, seq, kind, text, image_ref, sticker_ref, ref_json, '
                    'reply_to, recalled_at, edited_at, created_at FROM dm_message WHERE sender_id = :pid',
        'memberships': 'SELECT thread_id, role, state, joined_at FROM dm_member WHERE principal_id = :pid',
        'read_positions': 'SELECT thread_id, last_seq, updated_at FROM dm_read WHERE principal_id = :pid',
        'preferences': 'SELECT thread_id, pinned_at, muted, updated_at FROM dm_thread_pref WHERE principal_id = :pid',
        'settings': 'SELECT contact_policy, updated_at FROM dm_setting WHERE principal_id = :pid',
        'hidden_messages': 'SELECT message_id, hidden_at FROM dm_message_hidden WHERE principal_id = :pid',
        'reports': 'SELECT id, message_id, reason, created_at FROM dm_report WHERE reporter_id = :pid',
    }
    return {key: [dict(row) for row in conn.execute(sql, {'pid': actor.id})]
            for key, sql in queries.items()}


accounts.register_exporter('dm', export)
