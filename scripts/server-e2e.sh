#!/usr/bin/env bash
# 服务器端 E2E 运行器（stub + PostgreSQL 测试库）。
# 用法：./scripts/server-e2e.sh [--rev <sha|ref>] [--no-build] [--no-schema] <spec...>
#   --rev 默认 github/main；E2E_WORKERS 默认 1（预发机 2 核，稳妥起见）。
# 前置：本 checkout 的 .env 指向测试库（如 lingong_e2e）；Playwright 浏览器已安装。
# 说明：测试进程与预发/生产实例相互隔离（独立端口 8876、独立库、CODEX_MODE=stub），
#       运行结束即退出；不会触碰 lingong.service 或其 frontend/dist。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REV="github/main"
NOBUILD=0
NOSCHEMA=0
while [ $# -gt 0 ]; do
  case "$1" in
    --rev) REV="${2:?缺少 --rev 的值}"; shift 2 ;;
    --no-build) NOBUILD=1; shift ;;
    --no-schema) NOSCHEMA=1; shift ;;
    *) break ;;
  esac
done
PLAYWRIGHT_ARGS=("$@")
RUNTIME_CONFIG=0
for ((arg_index = 0; arg_index < ${#PLAYWRIGHT_ARGS[@]}; arg_index += 1)); do
  config_arg="${PLAYWRIGHT_ARGS[$arg_index]}"
  case "$config_arg" in
    --config=*) config_path="${config_arg#--config=}" ;;
    --config)
      if (( arg_index + 1 >= ${#PLAYWRIGHT_ARGS[@]} )); then
        echo "--config 缺少配置文件" >&2
        exit 1
      fi
      arg_index=$((arg_index + 1))
      config_path="${PLAYWRIGHT_ARGS[$arg_index]}"
      ;;
    *) continue ;;
  esac
  case "$config_path" in
    playwright.runtime.config.ts|./playwright.runtime.config.ts|*/playwright.runtime.config.ts) RUNTIME_CONFIG=1 ;;
  esac
done
[ -f "$ROOT/.env" ] || { echo "缺少 $ROOT/.env（需指向测试库 DATABASE_URL）" >&2; exit 1; }
SOURCE_DB_URL="$(sed -n 's/^DATABASE_URL=//p' "$ROOT/.env" | head -1 | sed 's/^"//; s/"$//')"
[ -n "$SOURCE_DB_URL" ] || { echo "$ROOT/.env 缺少 DATABASE_URL" >&2; exit 1; }
export DATABASE_URL="$SOURCE_DB_URL" DB_URL="$SOURCE_DB_URL"
if [ -z "${TEST_DB_PREFIX:-}" ]; then
  # Only the documented disposable staging database has a default. Never
  # derive broad authority from an arbitrary production database's prefix.
  TEST_DB_PREFIX="$(node --input-type=module -e 'const db=decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));if(db!=="lingong_e2e")throw new Error("TEST_DB_PREFIX must explicitly identify an isolated test database");process.stdout.write("lingong")')"
fi
export TEST_DB_PREFIX
export E2E_MODE=stub NODE_ENV=test
if [ "$RUNTIME_CONFIG" = "1" ]; then
  export E2E_AUTH_MODE=enabled
else
  export E2E_AUTH_MODE=disabled
fi
node --input-type=module -e '
  const prefix = process.env.TEST_DB_PREFIX || "";
  const database = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
  const protectedName = new Set(["postgres", "template0", "template1", "prod", "production", "lingong"]);
  if (process.env.NODE_ENV !== "test" || process.env.E2E_MODE !== "stub" || !/^[a-z_][a-z0-9_]+$/.test(prefix)
    || !/^[a-z_][a-z0-9_]+$/.test(database) || !database.startsWith(`${prefix}_`)
    || protectedName.has(database) || /(?:^|_)(?:prod|production)(?:_|$)/.test(database)) {
    throw new Error("E2E requires an explicitly prefixed isolated PostgreSQL database; refusing fixture writes");
  }
'

# Revision selection replaces this script on disk. Re-exec the selected revision
# once, and verify its immutable HEAD on return; all guards run again and no DB is
# created until after that selection.
if [ -z "${SERVER_E2E_REEXEC_REV:-}" ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "E2E checkout has local changes; preserve them before selecting a revision." >&2
    exit 1
  fi
  git fetch github
  git switch --detach "$REV"
  selected_rev="$(git rev-parse HEAD)"
  echo "E2E revision: $(git log --oneline -1)"
  reexec_args=(--rev "$REV")
  if [ "$NOBUILD" = "1" ]; then reexec_args+=(--no-build); fi
  if [ "$NOSCHEMA" = "1" ]; then reexec_args+=(--no-schema); fi
  reexec_args+=("${PLAYWRIGHT_ARGS[@]}")
  SERVER_E2E_REEXEC_REV="$selected_rev" exec "$ROOT/scripts/server-e2e.sh" "${reexec_args[@]}"
fi
if [ "$(git rev-parse HEAD)" != "$SERVER_E2E_REEXEC_REV" ]; then
  echo "E2E selected revision changed before re-exec; refusing to continue." >&2
  exit 1
fi

# The helper imports pg from backend/node_modules, so install backend dependencies
# before it can attempt any connection. Keep the existing frontend dependency gate.
if [ ! -d backend/node_modules ] || [ backend/package-lock.json -nt backend/node_modules ] 2>/dev/null; then (cd backend && npm ci --no-audit --no-fund); fi
if [ ! -d frontend/node_modules ] || [ frontend/package-lock.json -nt frontend/node_modules ] 2>/dev/null; then (cd frontend && npm ci --no-audit --no-fund); fi

if [ "$RUNTIME_CONFIG" = "1" ]; then
  safe_revision="$(git rev-parse --short=12 HEAD | tr -cd 'a-f0-9')"
  [ -n "$safe_revision" ] || { echo "无法生成安全的 E2E revision 标识" >&2; exit 1; }
  runtime_token="${safe_revision}_$(date -u +%Y%m%d%H%M%S)_$$_$(node --input-type=module -e 'import { randomBytes } from "node:crypto";process.stdout.write(randomBytes(5).toString("hex"))')"
  runtime_database="$(NODE_ENV=test E2E_MODE=stub E2E_AUTH_MODE=enabled DATABASE_URL="$SOURCE_DB_URL" TEST_DB_PREFIX="$TEST_DB_PREFIX" RUNTIME_E2E_DB_TOKEN="$runtime_token" node "$ROOT/scripts/prepare-runtime-e2e-database.mjs")"
  RUNTIME_DB_URL="$(DATABASE_URL="$SOURCE_DB_URL" RUNTIME_E2E_DATABASE="$runtime_database" node --input-type=module - <<'NODE'
const url = new URL(process.env.DATABASE_URL);
url.pathname = `/${process.env.RUNTIME_E2E_DATABASE}`;
process.stdout.write(url.toString());
NODE
)"
  export DATABASE_URL="$RUNTIME_DB_URL" DB_URL="$RUNTIME_DB_URL"
  # A runtime database is always new. --no-schema only applies to the legacy
  # partition and must never leave this native-auth partition without schema or
  # reference data.
  ./scripts/apply-postgres-schema.sh >/dev/null
  (cd backend && DATABASE_URL="$RUNTIME_DB_URL" DB_URL="$RUNTIME_DB_URL" npm run db:seed:reference >/dev/null)
  echo "PostgreSQL schema + 参考数据已对齐：$runtime_database"
elif [ "$NOSCHEMA" = "0" ]; then
  ./scripts/apply-postgres-schema.sh >/dev/null
  (cd backend && DATABASE_URL="$SOURCE_DB_URL" DB_URL="$SOURCE_DB_URL" npm run db:seed:reference >/dev/null)
  echo "PostgreSQL schema + 参考数据已对齐"
fi
if [ "$NOBUILD" = "0" ]; then (cd frontend && VITE_E2E_FIXTURES=1 npm run build); fi
cd frontend
exec env E2E_SKIP_BUILD=1 npx playwright test "${PLAYWRIGHT_ARGS[@]}" --workers="${E2E_WORKERS:-1}"
