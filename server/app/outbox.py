import fnmatch
import json
import uuid
from dataclasses import dataclass

from . import clock

MAX_ATTEMPTS = 8
CONSUMERS = []
CONSUMER_MODULES = {}
EXTERNAL_CONSUMERS = []
EXTERNAL_CONSUMER_MODULES = {}
KNOWN_MODULE_PREFIXES = set()


@dataclass(frozen=True)
class AppContext:
    db: object
    settings: object
    storage: object


def emit(conn, event_type, aggregate_type, aggregate_id, payload=None, *, version=None, space_id=None,
         actor_id=None, request_id=None, policy_epoch=None, schema_version=1):
    event_id = str(uuid.uuid4())
    now = clock.now()
    conn.execute(
        'INSERT INTO outbox_event (id, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, '
        'space_id, actor_id, request_id, policy_epoch, payload_json, occurred_at, available_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (event_id, event_type, schema_version, aggregate_type, aggregate_id, version, space_id, actor_id,
         request_id, policy_epoch, json.dumps(payload or {}, ensure_ascii=False, sort_keys=True), now, now))
    return event_id


def subscribe(consumer, pattern, handler):
    for name, _, fn in CONSUMERS:
        if name == consumer:
            if fn is not handler:
                raise ValueError(f'consumer {consumer} already registered')
            return
    CONSUMERS.append((consumer, pattern, handler))
    CONSUMER_MODULES[consumer] = getattr(handler, '__module__', '')


def subscribe_external(consumer, pattern, handler):
    """Register a consumer that performs heavy work outside the database write transaction.

    The handler receives ``(event, app_context)`` and must use short transactions for its own writes.
    """
    for name, _, fn in EXTERNAL_CONSUMERS:
        if name == consumer:
            if fn is not handler:
                raise ValueError(f'consumer {consumer} already registered')
            return
    EXTERNAL_CONSUMERS.append((consumer, pattern, handler))
    EXTERNAL_CONSUMER_MODULES[consumer] = getattr(handler, '__module__', '')


def bind_modules(db, package_name, modules):
    prefixes = tuple(f'{package_name}.{module.name}' for module in modules)
    KNOWN_MODULE_PREFIXES.update(prefixes)
    db.outbox_module_prefixes = prefixes


def _belongs_to(module_name, prefix):
    return module_name == prefix or module_name.startswith(prefix + '.')


def _filtered_consumers(db, consumers, modules):
    allowed = getattr(db, 'outbox_module_prefixes', None)
    if allowed is None:
        return consumers
    selected = []
    for entry in consumers:
        module_name = modules.get(entry[0], getattr(entry[2], '__module__', ''))
        if any(_belongs_to(module_name, prefix) for prefix in allowed):
            selected.append(entry)
            continue
        if any(_belongs_to(module_name, prefix) for prefix in KNOWN_MODULE_PREFIXES):
            continue
        selected.append(entry)
    return selected


def _consumers_for(db):
    return _filtered_consumers(db, CONSUMERS, CONSUMER_MODULES)


def _external_consumers_for(db):
    return _filtered_consumers(db, EXTERNAL_CONSUMERS, EXTERNAL_CONSUMER_MODULES)


def _event(row):
    event = dict(row)
    event['payload'] = json.loads(event.pop('payload_json'))
    return event


def dispatch(db, limit=100, app_context=None):
    app_context = app_context or getattr(db, 'outbox_app_context', None)
    with db.read() as conn:
        rows = conn.execute("SELECT * FROM outbox_event WHERE state = 'pending' AND available_at <= ? "
                            'ORDER BY occurred_at, id LIMIT ?', (clock.now(), limit)).fetchall()
    handled = 0
    for row in rows:
        event = _event(row)
        error = None
        for consumer, pattern, handler in _consumers_for(db):
            if not fnmatch.fnmatchcase(event['event_type'], pattern):
                continue
            try:
                with db.write() as conn:
                    if conn.execute('SELECT 1 FROM outbox_receipt WHERE consumer = ? AND event_id = ?',
                                    (consumer, event['id'])).fetchone():
                        continue
                    handler(conn, event)
                    conn.execute('INSERT INTO outbox_receipt (consumer, event_id, processed_at) VALUES (?, ?, ?)',
                                 (consumer, event['id'], clock.now()))
            except Exception as exc:
                error = f'{consumer}: {type(exc).__name__}'
        for consumer, pattern, handler in _external_consumers_for(db):
            if not fnmatch.fnmatchcase(event['event_type'], pattern):
                continue
            try:
                with db.read() as conn:
                    if conn.execute('SELECT 1 FROM outbox_receipt WHERE consumer = ? AND event_id = ?',
                                    (consumer, event['id'])).fetchone():
                        continue
                if app_context is None:
                    raise RuntimeError('external consumer requires app context')
                handler(event, app_context)
                with db.write() as conn:
                    conn.execute('INSERT OR IGNORE INTO outbox_receipt (consumer, event_id, processed_at) '
                                 'VALUES (?, ?, ?)', (consumer, event['id'], clock.now()))
            except Exception as exc:
                error = f'{consumer}: {type(exc).__name__}'
        with db.write() as conn:
            if error is None:
                conn.execute("UPDATE outbox_event SET state = 'done', last_error = NULL WHERE id = ?", (event['id'],))
                handled += 1
            else:
                attempts = event['attempts'] + 1
                delay = min(3600, 2 ** attempts)
                state = 'dead' if attempts >= MAX_ATTEMPTS else 'pending'
                conn.execute('UPDATE outbox_event SET attempts = ?, state = ?, last_error = ?, available_at = ? '
                             'WHERE id = ?',
                             (attempts, state, error, clock.iso(clock.now_ts() + delay), event['id']))
    return handled
