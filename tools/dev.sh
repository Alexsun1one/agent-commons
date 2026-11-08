#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：tools/dev.sh [--seed] [--worker]

从仓库根准备 .venv 与 tools/vendor 依赖，构建到新的
.local-data/site-<时间戳>，迁移数据库，并在 127.0.0.1:${PORT:-8000} 启动。
还没有用户时打印邀请码。

--seed    空库调用 python3 -m app seed-demo；子命令不存在时提示并继续
--worker  同时启动 python3 -m app.worker，脚本退出时停掉它
EOF
}

seed=0
with_worker=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed) seed=1 ;;
    --worker) with_worker=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."
ROOT=$(pwd -P)
PORT="${PORT:-8000}"
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || [[ "$PORT" -lt 1 || "$PORT" -gt 65535 ]]; then
  echo "PORT 必须是 1–65535 的端口号" >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "需要 Python 3.11 或更高，未找到 python3" >&2
  exit 1
fi
if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "需要 Python 3.11 或更高，当前：$(python3 --version 2>&1)" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "需要 Node.js 20 或更高，未找到 node 或 npm" >&2
  exit 1
fi
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
if [[ "$node_major" -lt 20 ]]; then
  echo "需要 Node.js 20 或更高，当前：$(node -v)" >&2
  exit 1
fi

if [[ ! -x "$ROOT/.venv/bin/python" ]] || ! "$ROOT/.venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
  python3 -m venv "$ROOT/.venv"
fi
PY="$ROOT/.venv/bin/python"
req_hash=$("$PY" -c 'import hashlib, pathlib, sys
h = hashlib.sha256()
h.update(sys.version.encode())
for name in ("server/requirements.txt", "requirements-build.txt"):
    h.update(pathlib.Path(name).read_bytes())
print(h.hexdigest())')
req_stamp="$ROOT/.venv/.dev-req.sha256"
if [[ -f "$req_stamp" && "$(cat "$req_stamp")" == "$req_hash" ]]; then
  echo "Python 依赖已安装，跳过"
else
  "$PY" -m pip install -r "$ROOT/server/requirements.txt" -r "$ROOT/requirements-build.txt"
  printf '%s\n' "$req_hash" > "$req_stamp"
fi

lock_hash=$("$PY" -c 'import hashlib, pathlib; print(hashlib.sha256(pathlib.Path("tools/vendor/package-lock.json").read_bytes()).hexdigest())')
lock_stamp="$ROOT/tools/vendor/node_modules/.dev-lock.sha256"
if [[ -d "$ROOT/tools/vendor/node_modules" && -f "$lock_stamp" && "$(cat "$lock_stamp")" == "$lock_hash" ]]; then
  echo "vendor 依赖未变，跳过 npm ci"
else
  npm ci --prefix "$ROOT/tools/vendor" --ignore-scripts --no-audit --no-fund
  printf '%s\n' "$lock_hash" > "$lock_stamp"
fi

site_rel=".local-data/site-$(date +%Y%m%d-%H%M%S)"
if [[ -e "$ROOT/$site_rel" ]]; then
  site_rel="${site_rel}-$$"
fi
site="$ROOT/$site_rel"
"$PY" "$ROOT/tools/build-delivery.py" --live --output "$site"
echo "静态目录：$site"

export COMMONS_DATA_DIR="$ROOT/.local-data"
export COMMONS_STATIC_DIR="$site"
export COMMONS_ORIGIN="http://127.0.0.1:${PORT}"
export COMMONS_INSECURE_COOKIE=1

( cd "$ROOT/server" && "$PY" -m app migrate )

principal_count() {
  "$PY" - "$1" <<'PY'
import sqlite3, sys
from pathlib import Path
db = Path(sys.argv[1])
if not db.is_file():
    print(0)
    raise SystemExit(0)
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
try:
    n = con.execute("SELECT COUNT(*) FROM principal").fetchone()[0]
except sqlite3.Error:
    n = 0
print(n)
PY
}

count=$(principal_count "$COMMONS_DATA_DIR/commons.db")
if [[ "$seed" -eq 1 ]]; then
  if [[ "$count" != "0" ]]; then
    echo "库里已有用户，跳过 seed-demo"
  else
    set +e
    seed_out=$(cd "$ROOT/server" && "$PY" -m app seed-demo 2>&1)
    seed_status=$?
    set -e
    if [[ "$seed_status" -eq 0 ]]; then
      printf '%s\n' "$seed_out"
    elif [[ "$seed_status" -eq 2 && "$seed_out" == *"invalid choice"* && "$seed_out" == *"seed-demo"* ]]; then
      echo "python3 -m app seed-demo 还不存在，跳过演示数据，继续启动。"
    else
      printf '%s\n' "$seed_out" >&2
      exit "$seed_status"
    fi
    count=$(principal_count "$COMMONS_DATA_DIR/commons.db")
  fi
fi

if [[ "$count" == "0" ]]; then
  set +e
  invite_out=$(cd "$ROOT/server" && "$PY" -m app issue-invite 2>&1)
  invite_status=$?
  set -e
  if [[ "$invite_status" -eq 0 ]]; then
    echo "邀请码："
    printf '%s\n' "$invite_out"
  elif [[ "$invite_out" == *"已有有效的首个账号邀请码"* ]]; then
    echo "已有未使用的邀请码，请使用上次打印的邀请码注册。"
  else
    printf '%s\n' "$invite_out" >&2
    exit "$invite_status"
  fi
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 ${PORT} 已被占用" >&2
  exit 1
fi

worker_pid=""
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$worker_pid" ]]; then
    kill "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

if [[ "$with_worker" -eq 1 ]]; then
  (
    cd "$ROOT/server"
    exec "$PY" -m app.worker
  ) &
  worker_pid=$!
fi

echo "http://127.0.0.1:${PORT}"
cd "$ROOT/server"
"$PY" -m app serve --port "$PORT"
