#!/usr/bin/env bash
# Applies idempotent PostgreSQL schema migrations without evaluating .env values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}";
    elif [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    if [ -z "${!key+x}" ]; then export "$key=$val"; fi
  done < "$file"
}

[ -f "$ROOT/.env" ] || { echo "missing $ROOT/.env" >&2; exit 1; }
load_dotenv "$ROOT/.env"
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is required" >&2; exit 1; }

cd "$ROOT/backend"
if [ -x "$ROOT/backend/node_modules/.bin/tsx" ]; then
  exec "$ROOT/backend/node_modules/.bin/tsx" scripts/apply-postgres-schema.ts
fi
exec npx tsx scripts/apply-postgres-schema.ts
