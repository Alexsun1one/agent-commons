"""注销时清掉本人的报名、提交与投票。投票表禁 UPDATE，清理走 DELETE。"""

from app import accounts


def purge(conn, principal_id):
    conn.execute(
        'DELETE FROM event_vote WHERE voter_id = ? OR candidate_id IN '
        '(SELECT id FROM event_submission WHERE principal_id = ?)',
        (principal_id, principal_id),
    )
    conn.execute('DELETE FROM event_submission WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM event_signup WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM event_acl WHERE principal_id = ?', (principal_id,))
    conn.execute(
        'UPDATE community_event SET host_id = NULL WHERE host_id = ?',
        (principal_id,),
    )


accounts.register_purger(purge)
