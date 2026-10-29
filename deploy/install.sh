#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: sudo ./deploy/install.sh --env /absolute/path/to/commons.env" >&2
}

normalize_host() {
  local host
  host="$(printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
  host="${host%.}"
  printf '%s' "$host"
}

ENV_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

if [[ -z "$ENV_FILE" || "$ENV_FILE" != /* || ! -f "$ENV_FILE" ]]; then
  usage
  exit 66
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required_vars=(
  COMMONS_SITE_DOMAIN COMMONS_CONTENT_DOMAIN COMMONS_LIVEKIT_DOMAIN
  COMMONS_API_PORT COMMONS_DATA_DIR COMMONS_DB_PATH COMMONS_WITHDRAWAL_LOG
  COMMONS_BACKUP_ROOT COMMONS_BACKUP_MAX_AGE_MINUTES
)
for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "error: $name is required in the deployment environment file" >&2
    exit 78
  fi
done
if [[ ! "$COMMONS_API_PORT" =~ ^[0-9]+$ ]] || (( COMMONS_API_PORT < 1 || COMMONS_API_PORT > 65535 )); then
  echo "error: COMMONS_API_PORT must be an integer from 1 to 65535" >&2
  exit 78
fi
if [[ ! "$COMMONS_BACKUP_MAX_AGE_MINUTES" =~ ^[0-9]+$ ]] || (( COMMONS_BACKUP_MAX_AGE_MINUTES < 1 )); then
  echo "error: COMMONS_BACKUP_MAX_AGE_MINUTES must be a positive integer" >&2
  exit 78
fi
for path_name in COMMONS_DATA_DIR COMMONS_DB_PATH COMMONS_WITHDRAWAL_LOG COMMONS_BACKUP_ROOT; do
  if [[ "${!path_name}" != /* || "${!path_name}" == / ]]; then
    echo "error: $path_name must be an absolute, non-root path" >&2
    exit 78
  fi
done
ssh_port="${COMMONS_SSH_PORT:-22}"
if [[ ! "$ssh_port" =~ ^[0-9]+$ ]] || (( ssh_port < 1 || ssh_port > 65535 )); then
  echo "error: COMMONS_SSH_PORT must be blank or an integer from 1 to 65535" >&2
  exit 78
fi
if [[ -z "${COMMONS_STORAGE_DIR:-}" ]]; then
  COMMONS_STORAGE_DIR=/srv/commons-user-content
fi
if [[ "$COMMONS_STORAGE_DIR" != /srv/commons-user-content ]]; then
  echo "error: COMMONS_STORAGE_DIR must be /srv/commons-user-content so the content site and the app share one directory" >&2
  exit 78
fi
if [[ "${COMMONS_BACKUP_DISK_ENCRYPTION:-}" != 1 ]]; then
  echo "error: backups rely on disk-volume encryption; set COMMONS_BACKUP_DISK_ENCRYPTION=1 only after that volume encryption is enabled" >&2
  exit 78
fi
site_host="$(normalize_host "$COMMONS_SITE_DOMAIN")"
content_host="$(normalize_host "$COMMONS_CONTENT_DOMAIN")"
if [[ -z "$site_host" || -z "$content_host" || "$site_host" == "$content_host" \
    || "$site_host" == *."$content_host" || "$content_host" == *."$site_host" ]]; then
  echo "error: main and user-content domains must be different registrable domains, not the same host or a subdomain of each other" >&2
  exit 78
fi

if [[ $EUID -ne 0 ]]; then
  echo "error: install.sh must run as root" >&2
  exit 77
fi
if [[ ! -r /etc/os-release ]] || ! grep -q '^ID=ubuntu$' /etc/os-release; then
  echo "error: this installer supports Ubuntu 24.04 only" >&2
  exit 69
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
INSTALL_ROOT=/opt/commons
CURRENT_ROOT=$INSTALL_ROOT/current
VENV_ROOT=$INSTALL_ROOT/venv
UV_BOOTSTRAP=$INSTALL_ROOT/uv-bootstrap

if [[ ! -f "$SOURCE_ROOT/server/requirements.txt" || ! -f "$SOURCE_ROOT/server/app/main.py" ]]; then
  echo "error: BE-0 output is missing server/requirements.txt or server/app/main.py" >&2
  exit 66
fi
if [[ ! -f "$SOURCE_ROOT/engine/pipeline/deid.py" ]]; then
  echo "error: engine/pipeline/deid.py is missing; refusing to install without contact detection" >&2
  exit 66
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates caddy curl python3 python3-venv rsync sqlite3 ufw

if ! getent group commons >/dev/null; then
  groupadd --system commons
fi
if ! getent group commons-content >/dev/null; then
  groupadd --system commons-content
fi
if ! id commons >/dev/null 2>&1; then
  useradd --system --gid commons --home-dir /var/lib/commons --shell /usr/sbin/nologin commons
fi
usermod -a -G commons-content commons
usermod -a -G commons-content caddy

install -d -o root -g root -m 0755 "$INSTALL_ROOT" "$CURRENT_ROOT"
install -d -o commons -g commons -m 0750 "$COMMONS_DATA_DIR" "$(dirname -- "$COMMONS_DB_PATH")"
install -d -o commons -g commons -m 0700 "$COMMONS_BACKUP_ROOT"
install -d -o commons -g commons-content -m 2750 /srv/commons-user-content
install -d -o root -g commons -m 0750 /etc/commons

rsync -a "$SOURCE_ROOT/server/" "$CURRENT_ROOT/server/"
rsync -a "$SOURCE_ROOT/preview/" "$CURRENT_ROOT/preview/"
rsync -a "$SOURCE_ROOT/deploy/" "$INSTALL_ROOT/deploy/"
# pii.py resolves parents[3]/engine/pipeline/deid.py from server/modules/governance/pii.py.
install -d -o root -g root -m 0755 "$CURRENT_ROOT/engine/pipeline"
rsync -a "$SOURCE_ROOT/engine/pipeline/deid.py" "$CURRENT_ROOT/engine/pipeline/deid.py"
chown -R root:root "$CURRENT_ROOT" "$INSTALL_ROOT/deploy"

python3 -m venv "$UV_BOOTSTRAP"
if [[ -n "${COMMONS_UV_VERSION:-}" ]]; then
  "$UV_BOOTSTRAP/bin/pip" install --disable-pip-version-check --upgrade "uv==$COMMONS_UV_VERSION"
else
  "$UV_BOOTSTRAP/bin/pip" install --disable-pip-version-check --upgrade uv
fi
if [[ ! -x "$VENV_ROOT/bin/python" ]]; then
  "$UV_BOOTSTRAP/bin/uv" venv "$VENV_ROOT"
fi
"$UV_BOOTSTRAP/bin/uv" pip install --python "$VENV_ROOT/bin/python" -r "$CURRENT_ROOT/server/requirements.txt"

install -o root -g commons -m 0640 "$ENV_FILE" /etc/commons/env
if ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?COMMONS_STORAGE_DIR=/srv/commons-user-content[[:space:]]*$' /etc/commons/env; then
  printf '\nCOMMONS_STORAGE_DIR=/srv/commons-user-content\n' >>/etc/commons/env
fi
install -o root -g root -m 0644 "$SCRIPT_DIR/Caddyfile" /etc/caddy/Caddyfile
{
  printf 'COMMONS_SITE_DOMAIN=%s\n' "$COMMONS_SITE_DOMAIN"
  printf 'COMMONS_CONTENT_DOMAIN=%s\n' "$COMMONS_CONTENT_DOMAIN"
  printf 'COMMONS_LIVEKIT_DOMAIN=%s\n' "$COMMONS_LIVEKIT_DOMAIN"
  printf 'COMMONS_API_PORT=%s\n' "$COMMONS_API_PORT"
} >/etc/caddy/commons.env
chown root:caddy /etc/caddy/commons.env
chmod 0640 /etc/caddy/commons.env
install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
cat >/etc/systemd/system/caddy.service.d/commons-env.conf <<'EOF'
[Service]
EnvironmentFile=/etc/caddy/commons.env
EOF

for unit in commons-api.service commons-worker.service commons-backup.service commons-backup.timer livekit.service; do
  install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/$unit" "/etc/systemd/system/$unit"
done
install -o root -g root -m 0755 "$SCRIPT_DIR/backup.sh" "$INSTALL_ROOT/deploy/backup.sh"
install -o root -g root -m 0755 "$SCRIPT_DIR/restore.sh" "$INSTALL_ROOT/deploy/restore.sh"
install -o root -g root -m 0755 "$SCRIPT_DIR/healthcheck.sh" "$INSTALL_ROOT/deploy/healthcheck.sh"

ufw default deny incoming
ufw default allow outgoing
if [[ "${COMMONS_SKIP_SSH_RULE:-0}" == 1 ]]; then
  echo "warning: COMMONS_SKIP_SSH_RULE=1; no SSH firewall rule was added before enabling UFW" >&2
else
  ufw limit "${COMMONS_SSH_PORT:-22}"/tcp
fi
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

install -d -o root -g root -m 0755 /etc/systemd/journald.conf.d
install -o root -g root -m 0644 "$SCRIPT_DIR/journald/commons.conf" /etc/systemd/journald.conf.d/commons.conf
systemctl restart systemd-journald

systemctl daemon-reload
systemctl disable --now livekit.service >/dev/null 2>&1 || true
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable --now caddy.service commons-api.service commons-worker.service commons-backup.timer
systemctl start commons-backup.service
"$INSTALL_ROOT/deploy/healthcheck.sh"

echo "Commons deployment installed. LiveKit remains disabled."
