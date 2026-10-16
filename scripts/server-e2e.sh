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
[ -f "$ROOT/.env" ] || { echo "缺少 $ROOT/.env（需指向测试库 DATABASE_URL）" >&2; exit 1; }
DB_URL="$(sed -n 's/^DATABASE_URL=//p' "$ROOT/.env" | head -1 | sed 's/^"//; s/"$//')"
export DATABASE_URL="$DB_URL"
if [ -z "${TEST_DB_PREFIX:-}" ]; then
  # Only the documented disposable staging database has a default. Never
  # derive broad authority from an arbitrary production database's prefix.
  TEST_DB_PREFIX="$(node --input-type=module -e 'const db=decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));if(db!=="lingong_e2e")throw new Error("TEST_DB_PREFIX must explicitly identify an isolated test database");process.stdout.write("lingong")')"
fi
export TEST_DB_PREFIX
export E2E_MODE=stub E2E_AUTH_MODE=disabled NODE_ENV=test
node --input-type=module -e '
  const prefix = process.env.TEST_DB_PREFIX || "";
  const database = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
  if (!/^[a-z_][a-z0-9_]+$/.test(prefix) || !database.startsWith(`${prefix}_`)) {
    throw new Error("E2E requires an explicitly prefixed isolated PostgreSQL database; refusing fixture writes");
  }
'
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "E2E checkout has local changes; preserve them before selecting a revision." >&2
  exit 1
fi
git fetch github
git switch --detach "$REV"
echo "E2E revision: $(git log --oneline -1)"
if [ "$NOSCHEMA" = "0" ]; then
  ./scripts/apply-postgres-schema.sh >/dev/null
  (cd backend && DATABASE_URL="$DB_URL" npm run db:seed:reference >/dev/null)
  echo "PostgreSQL schema + 参考数据已对齐"
fi
if [ frontend/package-lock.json -nt frontend/node_modules ] 2>/dev/null; then (cd frontend && npm ci --no-audit --no-fund); fi
if [ backend/package-lock.json -nt backend/node_modules ] 2>/dev/null; then (cd backend && npm ci --no-audit --no-fund); fi
if [ "$NOBUILD" = "0" ]; then (cd frontend && VITE_E2E_FIXTURES=1 npm run build); fi
cd frontend
exec env E2E_SKIP_BUILD=1 npx playwright test "$@" --workers="${E2E_WORKERS:-1}"
