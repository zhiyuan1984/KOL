#!/usr/bin/env bash
# Isolated stub + native PostgreSQL staging runner. Never touches production.
# --no-schema remains accepted for compatibility, but each fresh owned DB needs
# the current schema even when the previous invocation already prepared its DB.
set -Eeuo pipefail
ROOT="${LINGONG_E2E_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"
REV="github/main"
NOBUILD=0
AUTH_KIND=disabled
while [ $# -gt 0 ]; do
  case "$1" in
    --rev) REV="${2:?missing --rev value}"; shift 2 ;;
    --no-build) NOBUILD=1; shift ;;
    --no-schema) shift ;;
    --authenticated) AUTH_KIND=enabled; shift ;;
    *) break ;;
  esac
done
[ -f "$ROOT/.env" ] || { echo 'Dedicated staging .env with a local test DATABASE_URL is required' >&2; exit 1; }
# Serialize the checkout/build/port owner; independent CI runs cannot replace a
# revision while another browser test is using it. Do not lock the live checkout.
exec 9>"$ROOT/.git/lingong-e2e.lock"
flock -n 9 || { echo 'Another staging E2E run owns this checkout' >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo 'Refusing to replace tracked staging edits' >&2; exit 1; }
git fetch github
git checkout --detach "$REV"
echo "E2E revision: $(git rev-parse HEAD)"
node "$ROOT/scripts/check-staging-headroom.mjs" "$ROOT" "${TMPDIR:-/tmp}"
if [ frontend/package-lock.json -nt frontend/node_modules ] 2>/dev/null; then (cd frontend && npm ci --no-audit --no-fund); fi
if [ backend/package-lock.json -nt backend/node_modules ] 2>/dev/null; then (cd backend && npm ci --no-audit --no-fund); fi

RECORD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lingong-e2e-owner-XXXXXX")"
RECORD="$RECORD_DIR/database.json"
OWNER="$$"
cleanup() {
  code=$?
  trap - EXIT
  removed=1
  if [ -f "$RECORD" ]; then
    if ! node "$ROOT/backend/scripts/e2e-database.mjs" drop "$RECORD" "$OWNER"; then
      echo 'Owned staging E2E cleanup failed; no forced disconnect or production write performed' >&2
      code=1
      removed=0
      echo "Private owner record retained at $RECORD" >&2
    fi
  fi
  if [ "$removed" = 1 ]; then rm -rf "$RECORD_DIR"; fi
  exit "$code"
}
trap cleanup EXIT
node "$ROOT/backend/scripts/e2e-database.mjs" create "$RECORD" "$OWNER"
DATABASE_URL="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).url)' "$RECORD")"
export DATABASE_URL
export TEST_DB_PREFIX=lingong_t_server_e2e NODE_ENV=test
export E2E_MODE=stub CODEX_MODE=stub CLAW_MODE=mock
export E2E_AUTH_MODE="$AUTH_KIND" AUTH_MODE="$AUTH_KIND" LIVE_REMOTE_SIDE_EFFECTS=0
export KNOWLEDGE_ENGINE_MODE=stub
export RUNTIME_CREDENTIAL_MASTER_KEY="$(printf '%064d' 0)"
export PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-$ROOT/artifacts/e2e-$(git rev-parse --short HEAD)-$OWNER}"
# Always initialize a NEW database; never migrate/reset the configured reference
# test DB and never clone production facts or credentials.
FIXTURE_SCRIPT=prepare-e2e-runtime.ts
if [ "$AUTH_KIND" = enabled ]; then FIXTURE_SCRIPT=prepare-authenticated-e2e.ts; fi
(cd backend && npm run db:apply:postgres-schema >/dev/null && npm run db:seed:reference >/dev/null && node_modules/.bin/tsx "scripts/$FIXTURE_SCRIPT")
# Backend fixtures require test; static assets must match the production bundle.
if [ "$NOBUILD" = 0 ]; then (cd frontend && NODE_ENV=production npm run build); fi
node "$ROOT/scripts/check-staging-headroom.mjs" "$ROOT" "${TMPDIR:-/tmp}"
cd frontend
E2E_SKIP_BUILD=1 npx playwright test "$@" --workers="${E2E_WORKERS:-1}" --retries=0
