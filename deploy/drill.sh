#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SERVER_ROOT="$SOURCE_ROOT/server"
for command_name in sqlite3 python3; do
  command -v "$command_name" >/dev/null || {
    echo "error: required command is missing: $command_name" >&2
    exit 69
  }
done

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/commons-restore-drill.XXXXXX")"
cleanup() {
  case "$TMP_ROOT" in
    "${TMPDIR:-/tmp}"/commons-restore-drill.*) rm -rf -- "$TMP_ROOT" ;;
    *) echo "warning: refused to remove unexpected path: $TMP_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT

db="$TMP_ROOT/live.sqlite3"
withdrawal_log="$TMP_ROOT/withdrawals.log"
backup_root="$TMP_ROOT/backup"
env_file="$TMP_ROOT/drill.env"
health_bin="$TMP_ROOT/assert-restored.py"
export PYTHONPATH="$SERVER_ROOT"

python3 - "$db" <<'PY'
import sys

from app.db import Database
from app.migrate import migrate

path = sys.argv[1]
db = Database(path)
migrate(db, (), '')
now = '2026-10-27T00:00:00.000000Z'
conn = db.conn()
if conn.in_transaction:
    conn.execute('COMMIT')
conn.execute('BEGIN IMMEDIATE')
conn.execute(
    "INSERT INTO principal (id, kind, status, created_at) VALUES ('p1', 'human', 'active', ?)",
    (now,),
)
for object_id, doc_no in (('keep-me', 1), ('withdraw-me', 2)):
    conn.execute(
        '''INSERT INTO object_head (
             id, type, author_id, visibility, min_level, lifecycle,
             current_version, policy_epoch, doc_no, created_at, updated_at, published_at)
           VALUES (?, 'knowledge', 'p1', 'members', 1, 'active', 1, 1, ?, ?, ?, ?)''',
        (object_id, doc_no, now, now, now),
    )
conn.execute(
    '''INSERT INTO search_doc (object_id, object_version, title, body, indexed_at)
       VALUES ('withdraw-me', 1, '撤回丙丁', '必须消失', ?)''',
    (now,),
)
conn.execute("INSERT INTO search_fts (rowid, title, body) VALUES (2, '撤回 丙丁', '必须 消失')")
conn.execute('COMMIT')
conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
db.close()
PY

: >"$withdrawal_log"

cat >"$env_file" <<EOF
COMMONS_DB_PATH=$db
COMMONS_WITHDRAWAL_LOG=$withdrawal_log
COMMONS_BACKUP_ROOT=$backup_root
COMMONS_ALLOW_SAME_DEVICE=1
EOF

"$SCRIPT_DIR/backup.sh" --env "$env_file"
backup_db="$(find "$backup_root/hourly" -maxdepth 1 -type f -name 'commons-*.sqlite3' -print | sort -r | head -n 1)"
if [[ -z "$backup_db" ]]; then
  echo "error: drill did not create a database backup" >&2
  exit 1
fi

python3 - "$withdrawal_log" <<'PY'
import sys

from app.withdrawals import append

append(sys.argv[1], 'withdraw-me', 'p1', '2026-10-27T00:00:01.000000Z')
PY

export DRILL_DB="$db"
cat >"$health_bin" <<'PY'
#!/usr/bin/env python3
import os
import sqlite3
import sys

with sqlite3.connect(os.environ['DRILL_DB']) as connection:
    withdrawn = connection.execute(
        "SELECT lifecycle, withdrawn_at FROM object_head WHERE id = 'withdraw-me'"
    ).fetchone()
    retained = connection.execute(
        "SELECT lifecycle FROM object_head WHERE id = 'keep-me'"
    ).fetchone()
    indexed = connection.execute(
        "SELECT COUNT(*) FROM search_doc WHERE object_id = 'withdraw-me'"
    ).fetchone()[0]
if withdrawn != ('withdrawn', '2026-10-27T00:00:01.000000Z') or retained != ('active',) or indexed != 0:
    sys.exit(1)
print('drill_health_ok withdrawn_content_absent=1 retained_content_present=1 search_cleared=1')
PY
chmod 0755 "$health_bin"

PYTHONPATH="$SERVER_ROOT" "$SCRIPT_DIR/restore.sh" \
  --env "$env_file" \
  --backup "$backup_db" \
  --withdrawal-log "$withdrawal_log" \
  --database "$db" \
  --python-bin "$(command -v python3)" \
  --healthcheck-bin "$health_bin" \
  --no-systemd

revived="$(sqlite3 "$db" "SELECT COUNT(*) FROM object_head WHERE id = 'withdraw-me' AND (lifecycle != 'withdrawn' OR withdrawn_at IS NULL);")"
if [[ "$revived" != 0 ]]; then
  echo "error: withdrawn content revived after restore" >&2
  exit 1
fi

before="$(sqlite3 "$db" "SELECT id || ':' || lifecycle FROM object_head ORDER BY id;")"
bad_log="$TMP_ROOT/bad-withdrawals.log"
cp -- "$withdrawal_log" "$bad_log"
cp -- "${withdrawal_log}.chain" "${bad_log}.chain"
printf '%s\n' '{"seq":3,"object_id":"keep-me","at":"2026-10-27T00:00:02.000000Z","actor":"p1"}' >>"$bad_log"
set +e
PYTHONPATH="$SERVER_ROOT" "$SCRIPT_DIR/restore.sh" \
  --env "$env_file" \
  --backup "$backup_db" \
  --withdrawal-log "$bad_log" \
  --database "$db" \
  --python-bin "$(command -v python3)" \
  --healthcheck-bin "$health_bin" \
  --no-systemd
status=$?
set -e
after="$(sqlite3 "$db" "SELECT id || ':' || lifecycle FROM object_head ORDER BY id;")"
if [[ "$status" -eq 0 || "$before" != "$after" ]]; then
  echo "error: gapped withdrawal log changed the database (status=$status)" >&2
  exit 1
fi
echo "drill_ok withdrawn_content_did_not_revive=1 gap_rejected=1 temp_cleanup=armed"
