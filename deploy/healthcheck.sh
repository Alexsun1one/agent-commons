#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE=/etc/commons/env
BASE_URL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="${2:-}"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    *) echo "Usage: healthcheck.sh [--env FILE] [--base-url URL]" >&2; exit 64 ;;
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

: "${COMMONS_API_PORT:?COMMONS_API_PORT is required}"
: "${COMMONS_DATA_DIR:?COMMONS_DATA_DIR is required}"
: "${COMMONS_BACKUP_ROOT:?COMMONS_BACKUP_ROOT is required}"
: "${COMMONS_BACKUP_MAX_AGE_MINUTES:?COMMONS_BACKUP_MAX_AGE_MINUTES is required}"
BASE_URL="${BASE_URL:-http://127.0.0.1:$COMMONS_API_PORT}"

if ! curl --fail --silent --show-error --max-time 10 "$BASE_URL/api/health" >/dev/null; then
  echo "health_error api_unavailable endpoint=$BASE_URL/api/health" >&2
  exit 1
fi

used_percent="$(df -Pk "$COMMONS_DATA_DIR" | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')"
if [[ ! "$used_percent" =~ ^[0-9]+$ ]]; then
  echo "health_error disk_usage_unreadable path=$COMMONS_DATA_DIR" >&2
  exit 1
fi
free_percent=$((100 - used_percent))
if (( free_percent < 10 )); then
  echo "health_error disk_free_percent=$free_percent threshold=10" >&2
  exit 1
elif (( free_percent < 20 )); then
  echo "health_warning disk_free_percent=$free_percent threshold=20" >&2
fi

latest_backup="$(find "$COMMONS_BACKUP_ROOT/hourly" -maxdepth 1 -type f -name 'commons-*.sqlite3' -print 2>/dev/null | sort -r | head -n 1)"
if [[ -z "$latest_backup" ]]; then
  echo "health_error backup_missing root=$COMMONS_BACKUP_ROOT" >&2
  exit 1
fi
if stat -c '%Y' "$latest_backup" >/dev/null 2>&1; then
  backup_mtime="$(stat -c '%Y' "$latest_backup")"
else
  backup_mtime="$(stat -f '%m' "$latest_backup")"
fi
now="$(date '+%s')"
backup_age_minutes=$(((now - backup_mtime) / 60))
if (( backup_age_minutes > COMMONS_BACKUP_MAX_AGE_MINUTES )); then
  echo "health_error backup_stale age_minutes=$backup_age_minutes max=$COMMONS_BACKUP_MAX_AGE_MINUTES" >&2
  exit 1
fi

# 公网边缘冒烟。本机不可验：需要真实域名和证书。COMMONS_EDGE_SMOKE 不是 1 时跳过，
# 这样安装末尾的本机健康检查不会访问公网。
edge_state=skipped
if [[ "${COMMONS_EDGE_SMOKE:-}" == 1 ]]; then
  : "${COMMONS_SITE_DOMAIN:?COMMONS_SITE_DOMAIN is required for edge smoke}"
  : "${COMMONS_CONTENT_DOMAIN:?COMMONS_CONTENT_DOMAIN is required for edge smoke}"
  probe='0000000000000000000000000000000000000000000000000000000000000000'
  csp="$(curl -sI --max-time 15 "https://${COMMONS_SITE_DOMAIN}/" || true)"
  if ! printf '%s\n' "$csp" | grep -F "script-src 'self'" >/dev/null; then
    echo "health_error edge_csp missing script-src 'self'" >&2
    exit 1
  fi
  upload_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://${COMMONS_CONTENT_DOMAIN}/c/upload_raw/${probe}" || true)"
  if [[ "$upload_code" != 404 ]]; then
    echo "health_error edge_upload_raw code=${upload_code:-none}" >&2
    exit 1
  fi
  content_headers="$(curl -sI --max-time 15 "https://${COMMONS_CONTENT_DOMAIN}/" || true)"
  if printf '%s\n' "$content_headers" | grep -qi '^set-cookie:'; then
    echo "health_error edge_set_cookie" >&2
    exit 1
  fi
  edge_state=ok
fi

echo "health_ok api=ok disk_free_percent=$free_percent backup_age_minutes=$backup_age_minutes edge_smoke=$edge_state"
