#!/usr/bin/env bash
# Playwright / CI：Stub E2E 自动克隆测试 PostgreSQL，不借用生产连接或数据目录。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export E2E_MODE=stub
export CODEX_MODE=stub
export LINGONG_PORT="${LINGONG_PORT:-8876}"
: "${TEST_DATABASE_URL:?Stub E2E requires TEST_DATABASE_URL; no production DATABASE_URL fallback}"
exec node "$ROOT/scripts/e2e-server.mjs"
