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
git fetch github
git reset --hard "$REV"
echo "E2E revision: $(git log --oneline -1)"
if [ "$NOSCHEMA" = "0" ]; then
  ./scripts/apply-postgres-schema.sh >/dev/null
  echo "PostgreSQL schema 已对齐"
fi
if [ frontend/package-lock.json -nt frontend/node_modules ] 2>/dev/null; then (cd frontend && npm ci --no-audit --no-fund); fi
if [ backend/package-lock.json -nt backend/node_modules ] 2>/dev/null; then (cd backend && npm ci --no-audit --no-fund); fi
if [ "$NOBUILD" = "0" ]; then (cd frontend && npm run build); fi
cd frontend
exec env E2E_SKIP_BUILD=1 npx playwright test "$@" --workers="${E2E_WORKERS:-1}"
