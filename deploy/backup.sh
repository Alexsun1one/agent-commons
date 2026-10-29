#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE=/etc/commons/env
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    *)
      echo "Usage: backup.sh [--env /path/to/commons.env]" >&2
      exit 64
      ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: environment file not found: $ENV_FILE" >&2
  exit 66
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${COMMONS_DB_PATH:?COMMONS_DB_PATH is required}"
: "${COMMONS_WITHDRAWAL_LOG:?COMMONS_WITHDRAWAL_LOG is required}"
: "${COMMONS_BACKUP_ROOT:?COMMONS_BACKUP_ROOT is required}"

for command_name in sqlite3 cp find sort tail python3; do
  command -v "$command_name" >/dev/null || {
    echo "error: required command is missing: $command_name" >&2
    exit 69
  }
done
if [[ ! -f "$COMMONS_DB_PATH" ]]; then
  echo "error: database does not exist: $COMMONS_DB_PATH" >&2
  exit 66
fi
if [[ ! -f "$COMMONS_WITHDRAWAL_LOG" ]]; then
  echo "error: withdrawal log does not exist: $COMMONS_WITHDRAWAL_LOG" >&2
  exit 66
fi
chain_src="${COMMONS_WITHDRAWAL_LOG}.chain"
if [[ -s "$COMMONS_WITHDRAWAL_LOG" && ! -f "$chain_src" ]]; then
  echo "error: withdrawal checksum chain is missing: $chain_src" >&2
  exit 66
fi
storage_dir="${COMMONS_STORAGE_DIR:-}"
if [[ -n "$storage_dir" && ! -d "$storage_dir" ]]; then
  echo "error: user-content directory does not exist: $storage_dir" >&2
  exit 66
fi

hash_file() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

device_id() {
  if stat -c '%d' "$1" >/dev/null 2>&1; then
    stat -c '%d' "$1"
  else
    stat -f '%d' "$1"
  fi
}

mkdir -p "$COMMONS_BACKUP_ROOT/hourly" "$COMMONS_BACKUP_ROOT/daily"
if [[ "${COMMONS_ALLOW_SAME_DEVICE:-0}" != 1 ]]; then
  db_device="$(device_id "$COMMONS_DB_PATH")"
  backup_device="$(device_id "$COMMONS_BACKUP_ROOT")"
  if [[ "$db_device" == "$backup_device" ]]; then
    echo "error: backup root must be on a different block device" >&2
    exit 78
  fi
  if [[ -n "$storage_dir" ]]; then
    storage_device="$(device_id "$storage_dir")"
    if [[ "$storage_device" == "$backup_device" ]]; then
      echo "error: backup root must be on a different block device" >&2
      exit 78
    fi
  fi
fi

lock_dir="$COMMONS_BACKUP_ROOT/.backup.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "error: another backup appears to be running: $lock_dir" >&2
  exit 75
fi
partial_db=""
partial_log=""
partial_chain=""
partial_files=""
cleanup() {
  [[ -z "$partial_db" ]] || rm -f -- "$partial_db"
  [[ -z "$partial_log" ]] || rm -f -- "$partial_log"
  [[ -z "$partial_chain" ]] || rm -f -- "$partial_chain"
  [[ -z "$partial_files" ]] || rm -f -- "$partial_files"
  rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT

timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
day="$(date -u '+%Y%m%d')"
hourly_base="$COMMONS_BACKUP_ROOT/hourly/commons-$timestamp"
hourly_db="$hourly_base.sqlite3"
hourly_log="$hourly_base.withdrawals"
hourly_chain="$hourly_base.withdrawals.chain"
hourly_files="$hourly_base.files.tar"
hourly_manifest="$hourly_base.sha256"
partial_db="$hourly_db.partial.$$"
partial_log="$hourly_log.partial.$$"
partial_chain="$hourly_chain.partial.$$"

escaped_target="${partial_db//\'/\'\'}"
sqlite3 "$COMMONS_DB_PATH" "VACUUM INTO '$escaped_target';"
if [[ "$(sqlite3 "$partial_db" 'PRAGMA quick_check;')" != ok ]]; then
  echo "error: SQLite quick_check failed for the new backup" >&2
  exit 74
fi
cp -- "$COMMONS_WITHDRAWAL_LOG" "$partial_log"
if [[ -f "$chain_src" ]]; then
  cp -- "$chain_src" "$partial_chain"
fi
mv -- "$partial_db" "$hourly_db"
partial_db=""
mv -- "$partial_log" "$hourly_log"
partial_log=""
if [[ -f "$partial_chain" ]]; then
  mv -- "$partial_chain" "$hourly_chain"
  partial_chain=""
fi
if [[ -n "$storage_dir" ]]; then
  partial_files="$hourly_files.partial.$$"
  python3 - "$storage_dir" "$partial_files" <<'PY'
import os
import sys
import tarfile
from pathlib import Path

root = Path(sys.argv[1]).resolve()
out = sys.argv[2]
with tarfile.open(out, 'w') as bundle:
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(name for name in dirnames if not Path(dirpath, name).is_symlink())
        for name in sorted(filenames):
            path = Path(dirpath, name)
            if path.is_symlink() or not path.is_file():
                continue
            bundle.add(path, arcname=path.relative_to(root).as_posix(), recursive=False)
PY
  mv -- "$partial_files" "$hourly_files"
  partial_files=""
fi

{
  printf '%s  %s\n' "$(hash_file "$hourly_db")" "$(basename -- "$hourly_db")"
  printf '%s  %s\n' "$(hash_file "$hourly_log")" "$(basename -- "$hourly_log")"
  if [[ -f "$hourly_chain" ]]; then
    printf '%s  %s\n' "$(hash_file "$hourly_chain")" "$(basename -- "$hourly_chain")"
  fi
  if [[ -f "$hourly_files" ]]; then
    printf '%s  %s\n' "$(hash_file "$hourly_files")" "$(basename -- "$hourly_files")"
  fi
} >"$hourly_manifest"

daily_base="$COMMONS_BACKUP_ROOT/daily/commons-$day"
if [[ ! -e "$daily_base.sqlite3" ]]; then
  cp -- "$hourly_db" "$daily_base.sqlite3"
  cp -- "$hourly_log" "$daily_base.withdrawals"
  if [[ -f "$hourly_chain" ]]; then
    cp -- "$hourly_chain" "$daily_base.withdrawals.chain"
  fi
  if [[ -f "$hourly_files" ]]; then
    cp -- "$hourly_files" "$daily_base.files.tar"
  fi
  {
    printf '%s  %s\n' "$(hash_file "$daily_base.sqlite3")" "$(basename -- "$daily_base.sqlite3")"
    printf '%s  %s\n' "$(hash_file "$daily_base.withdrawals")" "$(basename -- "$daily_base.withdrawals")"
    if [[ -f "$daily_base.withdrawals.chain" ]]; then
      printf '%s  %s\n' "$(hash_file "$daily_base.withdrawals.chain")" "$(basename -- "$daily_base.withdrawals.chain")"
    fi
    if [[ -f "$daily_base.files.tar" ]]; then
      printf '%s  %s\n' "$(hash_file "$daily_base.files.tar")" "$(basename -- "$daily_base.files.tar")"
    fi
  } >"$daily_base.sha256"
fi

prune_generations() {
  local directory=$1
  local keep=$2
  local stale base
  find "$directory" -maxdepth 1 -type f -name 'commons-*.sqlite3' -print \
    | sort -r \
    | tail -n "+$((keep + 1))" \
    | while IFS= read -r stale; do
        [[ -n "$stale" ]] || continue
        base=${stale%.sqlite3}
        rm -f -- "$base.sqlite3" "$base.withdrawals" "$base.withdrawals.chain" "$base.files.tar" "$base.sha256"
      done
}

# 保留 48 份小时 + 14 份日，与 LG-2 表一致。不采用架构 §12 的「加密备份 35 天」提议。
# 本脚本不加密文件。备份依赖磁盘卷加密；安装器要求 COMMONS_BACKUP_DISK_ENCRYPTION=1 作为确认。
prune_generations "$COMMONS_BACKUP_ROOT/hourly" 48
prune_generations "$COMMONS_BACKUP_ROOT/daily" 14

files_state=skipped
if [[ -f "$hourly_files" ]]; then
  files_state=included
fi
echo "backup_ok database=$(basename -- "$hourly_db") policy=48-hourly/14-daily encryption=disk_volume_only files=$files_state"
