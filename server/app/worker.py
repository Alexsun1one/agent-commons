import argparse
import logging
import os
import re
import secrets
import time
from dataclasses import dataclass

from . import accounts, clock, discovery, idempotency, outbox
from .db import Database
from .settings import Settings
from .storage import LocalStorage

log = logging.getLogger('commons.worker')
HOUSEKEEPING_EVERY = 300
PERIODIC_LEASE_SECONDS = 3600
PERIODIC_NAME = re.compile(r'[a-z][a-z0-9_.-]{2,95}\Z')
PERIODIC = {}
PERIODIC_MODULE_PREFIXES = set()


@dataclass(frozen=True)
class PeriodicTask:
    name: str
    every_seconds: int
    fn: object


def register_periodic(name, every_seconds, fn):
    if not isinstance(name, str) or not PERIODIC_NAME.match(name):
        raise ValueError('periodic task name must be 3-96 lowercase characters')
    if isinstance(every_seconds, bool) or not isinstance(every_seconds, (int, float)) or every_seconds < 1:
        raise ValueError('every_seconds must be at least 1')
    if not callable(fn):
        raise TypeError('periodic task must be callable')
    task = PeriodicTask(name, int(every_seconds), fn)
    existing = PERIODIC.get(name)
    if existing is not None and existing != task:
        raise ValueError(f'periodic task {name} already registered')
    PERIODIC[name] = task


def bind_modules(db, package_name, modules):
    prefixes = tuple(f'{package_name}.{module.name}' for module in modules)
    PERIODIC_MODULE_PREFIXES.update(prefixes)
    db.periodic_module_prefixes = prefixes


def _belongs_to(module_name, prefix):
    return module_name == prefix or module_name.startswith(prefix + '.')


def _tasks_for(db):
    allowed = getattr(db, 'periodic_module_prefixes', None)
    if allowed is None:
        return tuple(PERIODIC.values())
    selected = []
    for task in PERIODIC.values():
        module_name = getattr(task.fn, '__module__', '')
        if any(_belongs_to(module_name, prefix) for prefix in allowed):
            selected.append(task)
        elif not any(_belongs_to(module_name, prefix) for prefix in PERIODIC_MODULE_PREFIXES):
            selected.append(task)
    return tuple(selected)


def _claim(db, task):
    now = int(clock.now_ts())
    lease_until = now + max(PERIODIC_LEASE_SECONDS, task.every_seconds)
    token = -(secrets.randbelow(2 ** 30) + 1)
    key = f'periodic:{task.name}'
    with db.write() as conn:
        row = conn.execute(
            'INSERT INTO rate_bucket (key, window_start, count) VALUES (?, ?, ?) '
            'ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count '
            'WHERE rate_bucket.window_start <= ? RETURNING key',
            (key, lease_until, token, now)).fetchone()
    return token if row is not None else None


def _release(db, task, token):
    next_due = int(clock.now_ts()) + task.every_seconds
    with db.write() as conn:
        conn.execute('UPDATE rate_bucket SET window_start = ?, count = 0 WHERE key = ? AND count = ?',
                     (next_due, f'periodic:{task.name}', token))


def run_periodic(db):
    ran = 0
    for task in _tasks_for(db):
        token = _claim(db, task)
        if token is None:
            continue
        started = time.monotonic()
        try:
            task.fn(db)
        except Exception:
            elapsed = int((time.monotonic() - started) * 1000)
            log.exception('periodic task=%s status=error elapsed_ms=%d', task.name, elapsed)
        else:
            elapsed = int((time.monotonic() - started) * 1000)
            log.info('periodic task=%s status=ok elapsed_ms=%d', task.name, elapsed)
            ran += 1
        finally:
            _release(db, task, token)
    return ran


def run_once(db, settings, housekeeping=True):
    app_context = getattr(db, 'outbox_app_context', None)
    if app_context is None:
        storage = LocalStorage(settings.storage_dir, settings.content_origin) if settings.storage_dir else None
        app_context = outbox.AppContext(db, settings, storage)
        db.outbox_app_context = app_context
    handled = outbox.dispatch(db, app_context=app_context)
    run_periodic(db)
    if housekeeping:
        accounts.purge_due(db, settings)
        with db.write() as conn:
            idempotency.purge(conn)
            conn.execute('DELETE FROM rate_bucket WHERE window_start < ?', (int(clock.now_ts()) - 86400,))
    return handled


def main(argv=None):
    parser = argparse.ArgumentParser(prog='python -m app.worker')
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--interval', type=float, default=2.0)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    settings = Settings.from_env(os.environ)
    modules = discovery.discover(settings.module_package)
    db = Database(settings.db_path)
    outbox.bind_modules(db, settings.module_package, modules)
    accounts.bind_modules(db, settings.module_package, modules)
    bind_modules(db, settings.module_package, modules)
    last = 0.0
    while True:
        due = time.monotonic() - last >= HOUSEKEEPING_EVERY
        try:
            run_once(db, settings, housekeeping=due)
            if due:
                last = time.monotonic()
        except Exception:
            log.exception('worker iteration failed')
        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == '__main__':
    raise SystemExit(main())
