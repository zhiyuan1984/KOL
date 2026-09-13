#!/usr/bin/env bash
# Linux 服务器入口：装依赖、编原生绑定、构建前端，再起 Host（默认 0.0.0.0:8765）。
# 密钥只从仓库根目录 .env 读入；不要把 API key / token 写进本脚本。
# git fetch / remote 由外层 wrapper 负责。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() {
  echo "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1。请先安装后再跑 ./scripts/start.sh。"
}

# 解析 KEY=VALUE，不覆盖已有环境变量，不打印值，不执行 $()。
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
    if [ -z "${!key+x}" ]; then
      export "$key=$val"
    fi
  done < "$file"
}

need_install() {
  local dir="$1" marker="$2"
  [ ! -e "$dir/node_modules/$marker" ] && return 0
  [ -f "$dir/package-lock.json" ] && [ "$dir/package-lock.json" -nt "$dir/node_modules" ] && return 0
  return 1
}

install_pkg() {
  local dir="$1"
  echo "安装依赖：$dir"
  if [ -f "$dir/package-lock.json" ]; then
    (cd "$dir" && npm ci --ignore-scripts=false --foreground-scripts)
  else
    (cd "$dir" && npm install --ignore-scripts=false --foreground-scripts)
  fi
}

frontend_stale() {
  [ ! -f "$ROOT/frontend/dist/index.html" ] && return 0
  local newer
  newer="$(find "$ROOT/frontend/src" "$ROOT/frontend/index.html" "$ROOT/frontend/package.json" "$ROOT/frontend/vite.config.ts" \
    -newer "$ROOT/frontend/dist/index.html" -print -quit 2>/dev/null || true)"
  [ -n "$newer" ]
}

[ -f "$ROOT/backend/package.json" ] && [ -f "$ROOT/frontend/package.json" ] \
  || die "未找到 backend/ 与 frontend/，请从仓库根目录运行 scripts/start.sh。"

require_cmd node
require_cmd npm
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[ "$node_major" -ge 22 ] || die "需要 Node.js 22+（当前 $(node -v)）。CI / Docker 使用 Node 22。"

if [ ! -f "$ROOT/.env" ]; then
  die "缺少仓库根目录 .env。请先执行：cp .env.example .env  填入密钥后再跑 ./scripts/start.sh"
fi
load_dotenv "$ROOT/.env"

export CODEX_MODE="${CODEX_MODE:-real}"
export AUTH_MODE="${AUTH_MODE:-enabled}"
export LINGONG_PORT="${LINGONG_PORT:-8765}"
export LINGONG_DATA="${LINGONG_DATA:-$ROOT/data}"

if [ "${CODEX_MODE,,}" = "real" ]; then
  if ! command -v "${CODEX_BIN:-codex}" >/dev/null 2>&1; then
    die "CODEX_MODE=real 需要本机有 codex。请执行：npm i -g @openai/codex && codex login"
  fi
fi

if need_install "$ROOT/backend" "tsx"; then
  install_pkg "$ROOT/backend"
fi
if need_install "$ROOT/frontend" "vite"; then
  install_pkg "$ROOT/frontend"
fi

# shellcheck source=native.sh
. "$ROOT/scripts/native.sh"
(cd "$ROOT/backend" && build_better_sqlite3 && build_esbuild)
(cd "$ROOT/frontend" && build_esbuild)

if frontend_stale; then
  echo "构建前端（后端静态托管 frontend/dist）…"
  (cd "$ROOT/frontend" && npm run build)
fi

mkdir -p "$LINGONG_DATA/uploads" "$LINGONG_DATA/boxes" "$LINGONG_DATA/published-skills"

echo "灵工启动 → 0.0.0.0:${LINGONG_PORT}  CODEX_MODE=${CODEX_MODE}  AUTH_MODE=${AUTH_MODE}"
cd "$ROOT/backend"
if [ -x "$ROOT/backend/node_modules/.bin/tsx" ]; then
  exec "$ROOT/backend/node_modules/.bin/tsx" src/index.ts
fi
exec npx tsx src/index.ts
