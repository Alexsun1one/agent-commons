"""Hourly sweep: chunks of uploads nobody finished do not sit in the database forever."""

from app import clock, worker

ABANDON_AFTER = 24 * 3600


def sweep_abandoned(db):
    cutoff = clock.iso(clock.now_ts() - ABANDON_AFTER)
    with db.write() as conn:
        if conn.execute("SELECT 1 FROM schema_migration WHERE id = 'media/media_0001.sql'").fetchone() is None:
            return 0
        ids = [r[0] for r in conn.execute("SELECT id FROM media_upload WHERE state = 'receiving' AND updated_at < ?",
                                          (cutoff,))]
        for upload_id in ids:
            conn.execute('DELETE FROM media_chunk WHERE upload_id = ?', (upload_id,))
            conn.execute("UPDATE media_upload SET state = 'rejected', reject_code = 'abandoned', updated_at = ? "
                         'WHERE id = ?', (clock.now(), upload_id))
    return len(ids)


worker.register_periodic('media.sweep_abandoned', 3600, sweep_abandoned)
