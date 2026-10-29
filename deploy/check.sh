#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
required=(
  README.md env.example install.sh Caddyfile backup.sh restore.sh drill.sh
  healthcheck.sh loadtest.py check.sh
  systemd/commons-api.service systemd/commons-worker.service
  systemd/commons-backup.service systemd/commons-backup.timer systemd/livekit.service
  journald/commons.conf
)
for relative_path in "${required[@]}"; do
  if [[ ! -f "$SCRIPT_DIR/$relative_path" ]]; then
    echo "error: missing required file: $relative_path" >&2
    exit 1
  fi
done

for script in install.sh backup.sh restore.sh drill.sh healthcheck.sh check.sh; do
  bash -n "$SCRIPT_DIR/$script"
done
python3 - "$SCRIPT_DIR/loadtest.py" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
compile(path.read_text(encoding="utf-8"), str(path), "exec")
PY

if awk '
  /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
  /^COMMONS_STORAGE_DIR=\/srv\/commons-user-content$/ { allowed=1; next }
  /^[A-Za-z_][A-Za-z0-9_]*=$/ { next }
  { print "non-empty or invalid env.example line " NR ": " $0; bad=1 }
  END {
    if (!allowed) {
      print "env.example is missing COMMONS_STORAGE_DIR=/srv/commons-user-content"
      bad=1
    }
    exit bad
  }
' "$SCRIPT_DIR/env.example"; then
  echo "env_example_ok storage_default=/srv/commons-user-content"
else
  exit 1
fi

grep -Fq 'ExecStart=/opt/commons/venv/bin/uvicorn app.main:create_app --factory' "$SCRIPT_DIR/systemd/commons-api.service"
grep -Fq 'ExecStart=/opt/commons/venv/bin/python -m app.worker' "$SCRIPT_DIR/systemd/commons-worker.service"
# shellcheck disable=SC2016
grep -Fq '"$PYTHON_BIN" -m app.tools.replay_withdrawals' "$SCRIPT_DIR/restore.sh"
# shellcheck disable=SC2016
grep -Fq 'ufw limit "${COMMONS_SSH_PORT:-22}"/tcp' "$SCRIPT_DIR/install.sh"
# shellcheck disable=SC2016
grep -Fq 'if [[ "${COMMONS_SKIP_SSH_RULE:-0}" == 1 ]]' "$SCRIPT_DIR/install.sh"
grep -Fq 'COMMONS_SSH_PORT=' "$SCRIPT_DIR/env.example"
grep -Fq 'COMMONS_SKIP_SSH_RULE=' "$SCRIPT_DIR/env.example"
grep -Fq 'engine/pipeline/deid.py' "$SCRIPT_DIR/install.sh"
grep -Fq 'withdrawal checksum chain is missing' "$SCRIPT_DIR/backup.sh"
grep -Fq 'preflight_withdrawal_log' "$SCRIPT_DIR/restore.sh"
grep -Fq 'from app.migrate import migrate' "$SCRIPT_DIR/drill.sh"
grep -Fq 'from app.withdrawals import append' "$SCRIPT_DIR/drill.sh"
if grep -Fq 'invalid withdrawal log at record' "$SCRIPT_DIR/drill.sh"; then
  echo "error: drill.sh must call the real replay module, not embed a stub" >&2
  exit 1
fi
grep -Fq 'COMMONS_STORAGE_DIR=/srv/commons-user-content' "$SCRIPT_DIR/env.example"
grep -Fq 'install -d -o commons -g commons-content -m 2750 /srv/commons-user-content' "$SCRIPT_DIR/install.sh"
grep -Fq 'COMMONS_BACKUP_DISK_ENCRYPTION' "$SCRIPT_DIR/install.sh"
grep -Fq 'subdomain of each other' "$SCRIPT_DIR/install.sh"
grep -Fq 'MaxRetentionSec=14day' "$SCRIPT_DIR/journald/commons.conf"
grep -Fq '架构提议值，待拍板' "$SCRIPT_DIR/journald/commons.conf"
grep -Fq 'encryption=disk_volume_only' "$SCRIPT_DIR/backup.sh"
grep -Fq 'policy=48-hourly/14-daily' "$SCRIPT_DIR/backup.sh"
grep -Fq '.files.tar' "$SCRIPT_DIR/backup.sh"
grep -Fq 'COMMONS_EDGE_SMOKE' "$SCRIPT_DIR/healthcheck.sh"
grep -Fq "script-src 'self'" "$SCRIPT_DIR/healthcheck.sh"
grep -Fq '/c/upload_raw/' "$SCRIPT_DIR/healthcheck.sh"
grep -Fq '本机不可验' "$SCRIPT_DIR/healthcheck.sh"
grep -Fq "filter='data'" "$SCRIPT_DIR/restore.sh"
if grep -Eq '35day|keep 35|35-daily' "$SCRIPT_DIR/backup.sh"; then
  echo "error: backup retention must stay 48 hourly / 14 daily" >&2
  exit 1
fi
# shellcheck disable=SC2016
ssh_rule_line="$(grep -nF 'ufw limit "${COMMONS_SSH_PORT:-22}"/tcp' "$SCRIPT_DIR/install.sh" | cut -d: -f1)"
ufw_enable_line="$(grep -nF 'ufw --force enable' "$SCRIPT_DIR/install.sh" | cut -d: -f1)"
if (( ssh_rule_line >= ufw_enable_line )); then
  echo "error: SSH rule must be installed before UFW is enabled" >&2
  exit 1
fi
echo "r2_contract_ok"

if command -v shellcheck >/dev/null; then
  shellcheck "$SCRIPT_DIR"/*.sh
  echo "shellcheck_ok"
else
  echo "跳过 shellcheck（未安装）"
fi

if command -v caddy >/dev/null; then
  COMMONS_SITE_DOMAIN=main.example.test \
  COMMONS_CONTENT_DOMAIN=content.example.invalid \
  COMMONS_LIVEKIT_DOMAIN=rtc.example.test \
  COMMONS_API_PORT=8000 \
    caddy validate --config "$SCRIPT_DIR/Caddyfile" --adapter caddyfile
  echo "caddy_validate_ok"
else
  echo "跳过 caddy validate（未安装）"
fi

if command -v systemd-analyze >/dev/null; then
  systemd-analyze verify "$SCRIPT_DIR/systemd/"*.service "$SCRIPT_DIR/systemd/"*.timer
  echo "systemd_verify_ok"
else
  echo "跳过 systemd-analyze verify（未安装）"
fi

echo "static_contract_ok"
echo "check_ok"
