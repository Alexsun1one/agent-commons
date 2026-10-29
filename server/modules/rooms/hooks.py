"""Remove mutable room participation; principal references retain the core tombstone."""
from app import accounts, clock, outbox
from . import service


def purge(conn, principal_id):
    stamp = clock.now()
    for room in conn.execute("SELECT * FROM room WHERE host_id = ? AND state != 'ended'",
                             (principal_id,)).fetchall():
        service.end_room(conn, room, principal_id)
    affected = [row[0] for row in conn.execute(
        'SELECT room_id FROM room_recording_consent WHERE principal_id = ? UNION '
        'SELECT room_id FROM room_recording_track_consent WHERE principal_id = ? UNION '
        'SELECT id FROM room WHERE host_id = ?', (principal_id, principal_id, principal_id))]
    keys = {row[0] for row in conn.execute(
        'SELECT storage_key FROM room_material WHERE added_by = ? AND storage_key IS NOT NULL', (principal_id,))}
    talk_ids = set()
    for room_id in affected:
        recording = conn.execute('SELECT talk_id FROM room_recording WHERE room_id = ?', (room_id,)).fetchone()
        if recording and recording['talk_id']:
            talk_ids.add(recording['talk_id'])
        for row in conn.execute('SELECT storage_key FROM room_recording WHERE room_id = ? UNION '
                                'SELECT transcript_key FROM room_minutes WHERE room_id = ? UNION '
                                'SELECT translation_key FROM room_minutes WHERE room_id = ?',
                                (room_id, room_id, room_id)):
            if row[0]:
                keys.add(row[0])
        conn.execute("UPDATE room_minutes SET state = 'none', transcript_key = NULL, translation_key = NULL, "
                     "chapters_json = '[]', highlights_json = '[]', todos_json = '[]', updated_at = ? WHERE room_id = ?",
                     (stamp, room_id))
    # Keep durable locators for the storage lane's post-commit, shared-reference-aware cleanup.
    if keys or talk_ids:
        outbox.emit(conn, 'rooms.storage_cleanup_requested', 'principal', principal_id,
                    {'keys': sorted(keys), 'talk_ids': sorted(talk_ids)})
    conn.execute("UPDATE room_recording SET state = 'stopped', storage_key = NULL, "
                 "screen_track_json = 'null', audio_tracks_json = '[]', talk_id = NULL, "
                 "reason_code = 'account_deleted', updated_at = ? WHERE room_id IN "
                 '(SELECT room_id FROM room_recording_consent WHERE principal_id = ? UNION '
                 'SELECT room_id FROM room_recording_track_consent WHERE principal_id = ? UNION '
                 'SELECT id FROM room WHERE host_id = ?)',
                 (stamp, principal_id, principal_id, principal_id))
    for table in ('join_grant', 'speak_queue', 'room_signup', 'room_invite', 'room_participant',
                  'room_screen_share', 'room_recording_track_consent', 'room_recording_consent'):
        conn.execute(f'DELETE FROM {table} WHERE principal_id = ?', (principal_id,))
    conn.execute('DELETE FROM room_message WHERE author_id = ?', (principal_id,))
    conn.execute('UPDATE room_message SET deleted_by = NULL WHERE deleted_by = ?', (principal_id,))
    conn.execute('DELETE FROM room_material WHERE added_by = ?', (principal_id,))
    for table in ('room_signup', 'speak_queue', 'room_screen_share'):
        conn.execute(f'UPDATE {table} SET decided_by = NULL WHERE decided_by = ?', (principal_id,))
    conn.execute('UPDATE room_participant SET removed_by = NULL WHERE removed_by = ?', (principal_id,))


accounts.register_purger(purge)
