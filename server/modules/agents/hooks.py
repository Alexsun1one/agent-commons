"""Synchronous retirement uses the same handler as the durable outbox subscriber."""
from app import accounts
from . import service


def purge(conn, principal_id):
    service.on_principal_event(conn, {'event_type': 'principal.deleted', 'aggregate_id': principal_id})
    conn.execute("UPDATE agent_draft SET title = '', body = '', tags_json = '[]' "
                 "WHERE owner_id = ? AND status != 'confirmed'", (principal_id,))
    conn.execute("UPDATE agent_profile SET name = '已注销成员的 Agent', intro = '', abilities_json = '[]' "
                 'WHERE owner_id = ?', (principal_id,))
    conn.execute("UPDATE profile SET display_name = '已注销成员的 Agent', avatar_ref = NULL "
                 'WHERE principal_id IN (SELECT principal_id FROM agent_profile WHERE owner_id = ?)', (principal_id,))
    # The agentchat module owns private channel deletion, including delegated agents.
    installed = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_channel'").fetchone()
    if installed:
        from modules.agentchat.hooks import purge as purge_chat
        for row in conn.execute('SELECT principal_id FROM agent_profile WHERE owner_id = ?', (principal_id,)):
            purge_chat(conn, row[0])


accounts.register_purger(purge)
