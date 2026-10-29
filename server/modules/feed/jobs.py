"""Lease-backed periodic enqueueing for Feed workers."""

from datetime import datetime, timezone

from app import clock, outbox, worker


def _emit_once(db, event_type, bucket, now):
    aggregate_id = f'periodic:{bucket}'
    with db.write() as conn:
        exists = conn.execute(
            'SELECT 1 FROM outbox_event WHERE event_type = ? AND aggregate_type = ? AND aggregate_id = ?',
            (event_type, 'feed_periodic', aggregate_id),
        ).fetchone()
        if exists:
            return False
        event_id = outbox.emit(conn, event_type, 'feed_periodic', aggregate_id, {'now': now})
    # A periodic run is a complete unit: do not leave its event (or the fetch-triggered
    # cluster event) pending for an arbitrary later worker iteration.
    while outbox.dispatch(db):
        pass
    state = db.conn().execute('SELECT state FROM outbox_event WHERE id = ?', (event_id,)).fetchone()
    if state is None or state['state'] != 'done':
        raise RuntimeError(f'{event_type} periodic dispatch did not complete')
    return True


def enqueue_fetch(db, now=None):
    stamp = now or clock.now()
    bucket = int(clock.parse(stamp) // 1800)
    return _emit_once(db, 'feed.fetch', f'fetch:{bucket}', stamp)


def enqueue_cluster(db, now=None):
    stamp = now or clock.now()
    bucket = int(clock.parse(stamp) // 600)
    return _emit_once(db, 'feed.cluster', f'cluster:{bucket}', stamp)


def enqueue_digest(db, now=None):
    stamp = now or clock.now()
    current = datetime.fromtimestamp(clock.parse(stamp), timezone.utc)
    if current.hour < 8:
        return False
    day = current.date().isoformat()
    if db.conn().execute(
            "SELECT 1 FROM feed_digest WHERE date = ? AND direction = '_all'", (day,)).fetchone():
        return False
    return _emit_once(db, 'feed.digest', f'digest:{day}', stamp)


worker.register_periodic('feed.fetch', 1800, enqueue_fetch)
worker.register_periodic('feed.cluster', 600, enqueue_cluster)
# Check frequently enough to hit 08:00 UTC without anchoring to deployment time.
worker.register_periodic('feed.digest', 300, enqueue_digest)
