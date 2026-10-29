"""Account-deletion cleanup for notification inboxes and preferences."""

import json

from app import accounts


def purge(conn, principal_id):
    profile = conn.execute('SELECT display_name FROM profile WHERE principal_id = ?', (principal_id,)).fetchone()
    display_name = profile[0] if profile else None
    conn.execute('DELETE FROM notification_source WHERE recipient_id = ? OR notification_id IN '
                 '(SELECT id FROM notification WHERE recipient_id = ?)', (principal_id, principal_id))
    conn.execute('DELETE FROM notification WHERE recipient_id = ?', (principal_id,))
    conn.execute('DELETE FROM notify_pref WHERE principal_id = ?', (principal_id,))
    for row in conn.execute('SELECT id, title, body, actor_ids_json FROM notification').fetchall():
        try:
            actor_ids = json.loads(row['actor_ids_json'] or '[]')
        except (TypeError, ValueError):
            actor_ids = []
        if principal_id not in actor_ids and not (display_name and (
                display_name in row['title'] or display_name in row['body'])):
            continue
        actor_ids = [value for value in actor_ids if value != principal_id]
        title = row['title'].replace(display_name, '已注销成员') if display_name else row['title']
        body = row['body'].replace(display_name, '已注销成员') if display_name else row['body']
        conn.execute('UPDATE notification SET title = ?, body = ?, actor_ids_json = ? WHERE id = ?',
                     (title, body, json.dumps(actor_ids, ensure_ascii=False), row['id']))


accounts.register_purger(purge)


def export(conn, actor):
    # Use the same redaction as the inbox when object visibility has changed.
    from .router import _view
    return {
        'notifications': [_view(conn, actor, row) for row in conn.execute(
            'SELECT * FROM notification WHERE recipient_id = ? ORDER BY created_at', (actor.id,))],
        'preferences': [dict(row) for row in conn.execute(
            'SELECT * FROM notify_pref WHERE principal_id = ?', (actor.id,))],
    }


accounts.register_exporter('notify', export)
