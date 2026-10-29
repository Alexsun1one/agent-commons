"""Export publication history and anonymise its cached publisher name on deletion."""
from app import accounts


def export(conn, actor):
    return {'snapshots': [dict(row) for row in conn.execute(
        'SELECT * FROM public_snapshot WHERE publisher_id = ? ORDER BY created_at, id', (actor.id,))]}


def purge(conn, principal_id):
    conn.execute("UPDATE public_snapshot SET publisher_name = '已注销成员' WHERE publisher_id = ?",
                 (principal_id,))


accounts.register_exporter('public', export)
accounts.register_purger(purge)
