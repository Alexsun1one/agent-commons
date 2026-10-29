"""Member-owned data export. Queries deliberately exclude other members' private state."""

from app import accounts


def export(conn, actor):
    queries = {
        'owned': 'SELECT id, slug, name, intro, kind, website, banner, join_policy, status, verified, created_at, updated_at FROM org WHERE owner_id = :pid',
        'memberships': 'SELECT org_id, role, state, show_on_profile, note, created_at, updated_at FROM org_member WHERE principal_id = :pid',
        'follows': 'SELECT org_id, created_at FROM org_follow WHERE principal_id = :pid',
        'attachments': 'SELECT org_id, object_id, kind, created_at FROM org_object WHERE attached_by = :pid',
    }
    return {key: [dict(row) for row in conn.execute(sql, {'pid': actor.id})]
            for key, sql in queries.items()}


accounts.register_exporter('orgs', export)
