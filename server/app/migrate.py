import hashlib
import re
import sqlite3
from pathlib import Path

from . import clock

CORE_DIR = Path(__file__).resolve().parent.parent / 'migrations' / 'core'
TXN = re.compile(r'^\s*(BEGIN\s+(DEFERRED|IMMEDIATE|EXCLUSIVE|TRANSACTION)\b|BEGIN\s*;|COMMIT\b|ROLLBACK\b|END\s+TRANSACTION\b)',
                 re.I | re.M)


class MigrationError(RuntimeError):
    pass


def plan(modules=()):
    items = [(f'core/{p.name}', p) for p in sorted(CORE_DIR.glob('*.sql'))]
    for module in sorted(modules, key=lambda m: m.name):
        items += [(f'{module.name}/{p.name}', p) for p in module.migrations]
    return items


def applied(conn):
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if 'schema_migration' not in tables:
        if tables:
            raise MigrationError('refusing to migrate a database this app did not create')
        return None
    return {r[0]: r[1] for r in conn.execute('SELECT id, checksum FROM schema_migration')}


def backup(db, folder, label):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    stamp = clock.iso().replace(':', '').replace('-', '').replace('.', '')
    safe = re.sub(r'[^A-Za-z0-9_]+', '_', label)
    target = folder / f'{Path(db.path).stem}-{stamp}-pre-{safe}.db'
    db.conn().execute('VACUUM INTO ?', (str(target),))
    return target


def migrate(db, modules=(), backup_dir=''):
    if sqlite3.sqlite_version_info < (3, 43, 0):
        raise MigrationError(f'SQLite {sqlite3.sqlite_version} is too old; need 3.43+ for STRICT and contentless_delete')
    conn = db.conn()
    done = applied(conn)
    pending = []
    for mid, path in plan(modules):
        sql = path.read_text(encoding='utf-8')
        checksum = hashlib.sha256(sql.encode()).hexdigest()
        if done is not None and mid in done:
            if done[mid] != checksum:
                raise MigrationError(f'{mid} was edited after it was applied; add a new migration instead')
            continue
        if TXN.search(sql):
            raise MigrationError(f'{mid} must not contain transaction statements')
        pending.append((mid, sql, checksum))
    if not pending:
        return [], None
    snapshot = None
    if done is not None and backup_dir:
        snapshot = backup(db, backup_dir, pending[0][0])
    if done is None:
        conn.execute('CREATE TABLE schema_migration (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT')
    for mid, sql, checksum in pending:
        with db.lock:
            try:
                conn.executescript('BEGIN IMMEDIATE;\n' + sql)
                conn.execute('INSERT INTO schema_migration (id, checksum, applied_at) VALUES (?, ?, ?)',
                             (mid, checksum, clock.now()))
                conn.execute('COMMIT')
            except Exception:
                if conn.in_transaction:
                    conn.execute('ROLLBACK')
                raise
    return [p[0] for p in pending], snapshot
