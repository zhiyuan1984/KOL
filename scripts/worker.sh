#!/usr/bin/env bash
# Worker 进程入口：与 start.sh 使用相同的非执行式 .env 解析，避免 systemd
# 直接解释带特殊字符的运行时密钥。用法：scripts/worker.sh outbox|execution
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  echo "usage: $0 outbox|execution" >&2
  exit 2
}

load_dotenv() {
  local file="$1" line key val
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*export[[:space:]]+ ]] && line="${line#*export }"
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then
      val="${BASH_REMATCH[1]}"
    elif [[ "$val" =~ ^\'(.*)\'$ ]]; then
      val="${BASH_REMATCH[1]}"
    fi
    if [ -z "${!key+x}" ]; then export "$key=$val"; fi
  done < "$file"
}

[ -f "$ROOT/.env" ] || { echo "缺少 $ROOT/.env" >&2; exit 1; }
load_dotenv "$ROOT/.env"
export LINGONG_DATA="${LINGONG_DATA:-$ROOT/data}"

case "${1:-}" in
  outbox) entry="src/outbox-publisher.ts" ;;
  execution) entry="src/execution-worker.ts" ;;
  *) usage ;;
esac

cd "$ROOT/backend"
if [ -x "$ROOT/backend/node_modules/.bin/tsx" ]; then
  exec "$ROOT/backend/node_modules/.bin/tsx" "$entry"
fi
exec npx tsx "$entry"
