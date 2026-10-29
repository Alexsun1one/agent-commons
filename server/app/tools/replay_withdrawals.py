import argparse
import sqlite3
import sys

from .. import fts
from ..withdrawals import LogError, read


def apply(conn, records):
    changed = 0
    for record in records:
        row = conn.execute('SELECT lifecycle FROM object_head WHERE id = ?', (record['object_id'],)).fetchone()
        if row is None:
            continue
        if row[0] != 'withdrawn':
            conn.execute("UPDATE object_head SET lifecycle = 'withdrawn', withdrawn_at = ?, updated_at = ?, "
                         'policy_epoch = policy_epoch + 1 WHERE id = ?',
                         (record['at'], record['at'], record['object_id']))
            changed += 1
        fts.unindex(conn, record['object_id'])
    return changed


def replay(database, log, fail_on_gap=True):
    records, problems = read(log, fail_on_gap)
    conn = sqlite3.connect(database, isolation_level=None)
    try:
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('BEGIN IMMEDIATE')
        try:
            changed = apply(conn, records)
        except Exception:
            conn.execute('ROLLBACK')
            raise
        conn.execute('COMMIT')
    finally:
        conn.close()
    return len(records), changed, problems


def main(argv=None):
    parser = argparse.ArgumentParser(prog='python -m app.tools.replay_withdrawals')
    parser.add_argument('--database', required=True)
    parser.add_argument('--log', required=True)
    parser.add_argument('--fail-on-gap', action='store_true')
    args = parser.parse_args(argv)
    try:
        total, changed, problems = replay(args.database, args.log, args.fail_on_gap)
    except LogError as exc:
        print(f'replay_error {exc}', file=sys.stderr)
        return 2
    for problem in problems:
        print(f'replay_warning {problem}', file=sys.stderr)
    print(f'replay_ok records={total} newly_withdrawn={changed}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
