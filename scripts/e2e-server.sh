#!/usr/bin/env bash
# Playwright / CI：CODEX_MODE=stub，独立端口，不碰产品默认 real Codex。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CODEX_MODE=stub
export LINGONG_PORT="${LINGONG_PORT:-8876}"
export LINGONG_DATA="${LINGONG_DATA:-$ROOT/data-e2e}"
mkdir -p "$LINGONG_DATA"
# Always rebuild so Playwright does not serve a stale frontend/dist from the snapshot.
(cd "$ROOT/frontend" && npm run build)
cd "$ROOT/backend"
exec npx tsx src/index.ts
