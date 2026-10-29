#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE=/etc/commons/env
BACKUP_DB=""
WITHDRAWAL_LOG=""
TARGET_DB=""
HEALTHCHECK_BIN=/opt/commons/deploy/healthcheck.sh
PYTHON_BIN=/opt/commons/venv/bin/python
NO_SYSTEMD=0

usage() {
  echo "Usage: restore.sh --backup DB --withdrawal-log LOG [--env FILE] [--database DB] [--healthcheck-bin FILE] [--no-systemd --python-bin FILE]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="${2:-}"; shift 2 ;;
    --backup) BACKUP_DB="${2:-}"; shift 2 ;;
    --withdrawal-log) WITHDRAWAL_LOG="${2:-}"; shift 2 ;;
    --database) TARGET_DB="${2:-}"; shift 2 ;;
    --healthcheck-bin) HEALTHCHECK_BIN="${2:-}"; shift 2 ;;
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    --no-systemd) NO_SYSTEMD=1; shift ;;
    *) usage; exit 64 ;;
  esac
done

if [[ -z "$BACKUP_DB" || -z "$WITHDRAWAL_LOG" || ! -f "$BACKUP_DB" || ! -f "$WITHDRAWAL_LOG" ]]; then
  usage
  exit 66
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: environment file not found: $ENV_FILE" >&2
  exit 66
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

TARGET_DB="${TARGET_DB:-${COMMONS_DB_PATH:-}}"
if [[ -z "$TARGET_DB" ]]; then
  echo "error: database target is required" >&2
  exit 78
fi
if [[ "$PYTHON_BIN" != /opt/commons/venv/bin/python && $NO_SYSTEMD -ne 1 ]]; then
  echo "error: --python-bin is allowed only with --no-systemd" >&2
  exit 64
fi
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "error: Python executable is missing: $PYTHON_BIN" >&2
  exit 69
fi
command -v sqlite3 >/dev/null || {
  echo "error: sqlite3 is required" >&2
  exit 69
}

hash_file() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

preflight_withdrawal_log() {
  "$PYTHON_BIN" -c 'import sys
from app.withdrawals import LogError, read
try:
    read(sys.argv[1], fail_on_gap=True)
except LogError as exc:
    print("replay_error %s" % exc, file=sys.stderr)
    raise SystemExit(2)
' "$WITHDRAWAL_LOG"
}

backup_base=${BACKUP_DB%.sqlite3}
manifest="$backup_base.sha256"
if [[ ! -f "$manifest" ]]; then
  echo "error: checksum manifest is missing: $manifest" >&2
  exit 74
fi
backup_name="$(basename -- "$BACKUP_DB")"
expected_hash="$(awk -v name="$backup_name" '$2 == name {print $1}' "$manifest")"
if [[ -z "$expected_hash" || "$(hash_file "$BACKUP_DB")" != "$expected_hash" ]]; then
  echo "error: backup checksum mismatch" >&2
  exit 74
fi

target_dir="$(dirname -- "$TARGET_DB")"
mkdir -p "$target_dir"
staged_db="$(mktemp "$target_dir/.commons-restore.XXXXXX")"
staged_files=""
cleanup() {
  [[ ! -e "$staged_db" ]] || rm -f -- "$staged_db"
  if [[ -n "$staged_files" ]]; then
    local files_tmp="${TMPDIR:-/tmp}"
    files_tmp="${files_tmp%/}"
    case "$staged_files" in
      "$files_tmp"/commons-restore-files.*) rm -rf -- "$staged_files" ;;
      *) echo "warning: refused to remove unexpected path: $staged_files" >&2 ;;
    esac
  fi
}
trap cleanup EXIT
cp -- "$BACKUP_DB" "$staged_db"

if [[ "$(sqlite3 "$staged_db" 'PRAGMA quick_check;')" != ok ]]; then
  echo "error: restored backup failed SQLite quick_check" >&2
  exit 74
fi

files_archive="$backup_base.files.tar"
if [[ -f "$files_archive" ]]; then
  if [[ -z "${COMMONS_STORAGE_DIR:-}" ]]; then
    echo "error: backup contains user files but COMMONS_STORAGE_DIR is unset" >&2
    exit 78
  fi
  files_name="$(basename -- "$files_archive")"
  expected_files="$(awk -v name="$files_name" '$2 == name {print $1}' "$manifest")"
  if [[ -z "$expected_files" || "$(hash_file "$files_archive")" != "$expected_files" ]]; then
    echo "error: user-content archive checksum mismatch" >&2
    exit 74
  fi
  files_tmp="${TMPDIR:-/tmp}"
  files_tmp="${files_tmp%/}"
  staged_files="$(mktemp -d "$files_tmp/commons-restore-files.XXXXXX")"
  "$PYTHON_BIN" - "$files_archive" "$staged_files" <<'PY'
import sys
import tarfile

archive, dest = sys.argv[1], sys.argv[2]
with tarfile.open(archive, 'r') as bundle:
    bundle.extractall(dest, filter='data')
PY
fi

if [[ $NO_SYSTEMD -eq 0 ]]; then
  if [[ $EUID -ne 0 ]]; then
    echo "error: production restore must run as root" >&2
    exit 77
  fi
  if [[ ! -d /opt/commons/current/server ]]; then
    echo "error: deployed server directory is missing" >&2
    exit 66
  fi
  (
    cd /opt/commons/current/server
    preflight_withdrawal_log
  )
else
  preflight_withdrawal_log
fi

if [[ $NO_SYSTEMD -eq 0 ]]; then
  systemctl stop commons-worker.service commons-api.service
fi

if [[ $NO_SYSTEMD -eq 0 ]]; then
  if [[ ! -d /opt/commons/current/server ]]; then
    echo "error: deployed server directory is missing; services remain stopped" >&2
    exit 66
  fi
  (
    cd /opt/commons/current/server
    "$PYTHON_BIN" -m app.tools.replay_withdrawals --database "$staged_db" --log "$WITHDRAWAL_LOG" --fail-on-gap
  )
else
  "$PYTHON_BIN" -m app.tools.replay_withdrawals --database "$staged_db" --log "$WITHDRAWAL_LOG" --fail-on-gap
fi
if [[ "$(sqlite3 "$staged_db" 'PRAGMA quick_check;')" != ok ]]; then
  echo "error: database failed quick_check after withdrawal replay; services remain stopped" >&2
  exit 74
fi

restore_stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
if [[ -e "$TARGET_DB" ]]; then
  mv -- "$TARGET_DB" "$TARGET_DB.pre-restore-$restore_stamp"
fi
for sidecar in "$TARGET_DB-wal" "$TARGET_DB-shm"; do
  if [[ -e "$sidecar" ]]; then
    mv -- "$sidecar" "$sidecar.pre-restore-$restore_stamp"
  fi
done
mv -- "$staged_db" "$TARGET_DB"
staged_db=""

if [[ -n "$staged_files" ]]; then
  if [[ -e "$COMMONS_STORAGE_DIR" ]]; then
    mv -- "$COMMONS_STORAGE_DIR" "$COMMONS_STORAGE_DIR.pre-restore-$restore_stamp"
  fi
  mkdir -p -- "$(dirname -- "$COMMONS_STORAGE_DIR")"
  mv -- "$staged_files" "$COMMONS_STORAGE_DIR"
  staged_files=""
  if [[ $NO_SYSTEMD -eq 0 ]]; then
    chown -R commons:commons-content "$COMMONS_STORAGE_DIR"
    chmod 2750 "$COMMONS_STORAGE_DIR"
  fi
fi

if [[ $NO_SYSTEMD -eq 0 ]]; then
  chown commons:commons "$TARGET_DB"
  chmod 0640 "$TARGET_DB"
  if ! systemctl start commons-api.service commons-worker.service; then
    systemctl stop commons-worker.service commons-api.service >/dev/null 2>&1 || true
    echo "error: services failed to start after restore; services are stopped" >&2
    exit 70
  fi
fi

if ! "$HEALTHCHECK_BIN"; then
  if [[ $NO_SYSTEMD -eq 0 ]]; then
    systemctl stop commons-worker.service commons-api.service
  fi
  echo "error: post-restore health check failed; services are stopped" >&2
  exit 70
fi

echo "restore_ok database=$(basename -- "$TARGET_DB") withdrawal_replay=complete"
