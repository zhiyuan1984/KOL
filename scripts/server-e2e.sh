#!/usr/bin/env bash
# PostgreSQL-only staging E2E. TEST_DATABASE_URL must be a test-maintenance URL;
# DATABASE_URL is never a substitute. The launcher clones and owns its test DB.
# Usage: ./scripts/server-e2e.sh [--rev <sha|ref>] [--no-build] [--no-schema] <spec...>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REV="github/main"
NOBUILD=0
NOSCHEMA=0
while [ $# -gt 0 ]; do
  case "$1" in
    --rev) REV="${2:?missing --rev value}"; shift 2 ;;
    --no-build) NOBUILD=1; shift ;;
    --no-schema) NOSCHEMA=1; shift ;;
    *) break ;;
  esac
done
if [ -n "$(git status --porcelain)" ]; then
  echo "Staging checkout has local changes; preserve and reconcile them before updating." >&2
  exit 1
fi
git fetch github
git reset --hard "$REV"
echo "E2E revision: $(git log --oneline -1)"
if [ -f "$ROOT/.env" ]; then
  set -a
  # Operator-owned staging configuration; keep credentials out of command output.
  source "$ROOT/.env"
  set +a
fi
: "${TEST_DATABASE_URL:?PostgreSQL staging E2E requires TEST_DATABASE_URL; production DATABASE_URL is not a fallback}"
export TEST_DB_TEMPLATE="${TEST_DB_TEMPLATE:-lingong_template}"
if [ frontend/package-lock.json -nt frontend/node_modules ] 2>/dev/null; then (cd frontend && npm ci --no-audit --no-fund); fi
if [ backend/package-lock.json -nt backend/node_modules ] 2>/dev/null; then (cd backend && npm ci --no-audit --no-fund); fi
if [ "$NOSCHEMA" = "0" ]; then
  TEMPLATE_URL="$(cd backend && node --input-type=module <<'JS'
import { Client } from 'pg';
const name=process.env.TEST_DB_TEMPLATE;
if(!/^[a-z_][a-z0-9_]*$/.test(name))throw new Error('Unsafe test-template identifier');
const url=new URL(process.env.TEST_DATABASE_URL);
if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Test maintenance URL must be PostgreSQL');
if(url.pathname.slice(1)===name)throw new Error('Test template must not be the maintenance database');
const client=new Client({connectionString:url.toString()});
await client.connect();
try {if(!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await client.query(`CREATE DATABASE "${name}"`);}
finally {await client.end();}
url.pathname='/'+name;console.log(url.toString());
JS
  )"
  (cd backend && DATABASE_URL="$TEMPLATE_URL" npm run db:apply:postgres-schema >/dev/null)
  (cd backend && DATABASE_URL="$TEMPLATE_URL" npm run db:seed:reference >/dev/null)
  echo "PostgreSQL test template schema and reference data are ready"
fi
if [ "$NOBUILD" = "0" ]; then (cd frontend && npm run build); fi
cd frontend
exec env E2E_MODE=stub E2E_SKIP_BUILD=1 npx playwright test "$@" --workers="${E2E_WORKERS:-1}"
