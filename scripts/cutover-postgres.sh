#!/usr/bin/env bash
# One-way production cutover: verified SQLite snapshot -> PostgreSQL authority.
# This script is intentionally invoked only by the protected manual GitHub
# workflow. It never prints environment values or generated database secrets.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_REVISION="${DEPLOY_REVISION:-}"
POSTGRES_DB="${LINGONG_POSTGRES_DB:-lingong}"
POSTGRES_USER="${LINGONG_POSTGRES_USER:-lingong}"
SERVICE="lingong"
OUTBOX_SERVICE="lingong-outbox"
WORKER_A="lingong-execution-worker@1"
WORKER_B="lingong-execution-worker@2"

say() { printf '[postgres-cutover] %s\n' "$*"; }
die() { printf '[postgres-cutover] ERROR: %s\n' "$*" >&2; exit 1; }

# Mirrors scripts/start.sh: it does not execute .env content and never prints it.
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

env_has_key() {
  local key="$1"
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ROOT/.env"
}

upsert_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$ROOT/.env.cutover.XXXXXX")"
  grep -Ev "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ROOT/.env" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ROOT/.env"
}

[ -n "$DEPLOY_REVISION" ] || die "DEPLOY_REVISION is required"
[ -f "$ROOT/.env" ] || die "missing production .env"
sudo -n true || die "passwordless sudo is required"
command -v git >/dev/null || die "git is required"
command -v node >/dev/null || die "node is required"
command -v npm >/dev/null || die "npm is required"

# A configured DATABASE_URL means this server has already been cut over or is
# under manual database administration. Never overwrite it blindly.
if env_has_key DATABASE_URL; then
  die "DATABASE_URL already exists in .env; refusing a second cutover"
fi

cd "$ROOT"
say "preparing verified revision ${DEPLOY_REVISION:0:12} while the SQLite service remains online"
git fetch github "$DEPLOY_REVISION"
git reset --hard "$DEPLOY_REVISION"

# The migration runner depends on pg and better-sqlite3. Build before stopping
# writes so the production interruption is limited to snapshot + cutover time.
(cd backend && npm ci --ignore-scripts=false --foreground-scripts)
(cd frontend && npm ci --ignore-scripts=false --foreground-scripts)
rm -rf frontend/dist.new
(cd frontend && VITE_OUT_DIR=dist.new npm run build)
[ -f frontend/dist.new/index.html ] || die "frontend build did not produce index.html"
if [ -d frontend/dist ]; then
  rm -rf frontend/dist.prev
  mv frontend/dist frontend/dist.prev
fi
mv frontend/dist.new frontend/dist

# Resolve paths through the actual application config after the target revision
# is installed. This emits only filesystem paths, never secret values.
mapfile -t runtime_paths < <(
  cd "$ROOT/backend"
  "$ROOT/backend/node_modules/.bin/tsx" -e 'import { dbPath, dataDir } from "./src/config.ts"; console.log(dbPath()); console.log(dataDir());'
)
SOURCE_DB="${runtime_paths[0]:-}"
DATA_DIR="${runtime_paths[1]:-}"
[ -n "$SOURCE_DB" ] && [ -n "$DATA_DIR" ] || die "could not resolve SQLite paths"
[ -f "$SOURCE_DB" ] || die "SQLite source does not exist: $SOURCE_DB"
[ -r "$SOURCE_DB" ] || die "SQLite source is not readable"

source_bytes="$(stat -c '%s' "$SOURCE_DB")"
avail_bytes="$(df -PB1 "$DATA_DIR" | awk 'NR==2 {print $4}')"
# Source backup + PostgreSQL data + SQL dump + SQLite journal headroom.
required_bytes=$((source_bytes * 4 + 268435456))
[ "$avail_bytes" -ge "$required_bytes" ] || die "insufficient free space for verified cutover"

was_active=false
if sudo systemctl is-active --quiet "$SERVICE"; then was_active=true; fi
BACKUP_DIR="$DATA_DIR/backups/postgres-cutover-$(date -u +%Y%m%dT%H%M%SZ)"
ENV_BACKUP="$BACKUP_DIR/.env.before"
cutover_committed=false
workers_started=false

rollback() {
  local exit_code=$?
  trap - EXIT
  if [ "$cutover_committed" != "true" ]; then
    say "cutover failed; restoring legacy SQLite service configuration"
    if [ -f "$ENV_BACKUP" ]; then
      cp -p "$ENV_BACKUP" "$ROOT/.env" || true
    fi
    if "$workers_started"; then
      sudo systemctl stop "$OUTBOX_SERVICE" "$WORKER_A" "$WORKER_B" || true
    fi
    if "$was_active"; then
      sudo systemctl restart "$SERVICE" || true
    fi
  fi
  exit "$exit_code"
}
trap rollback EXIT

say "installing PostgreSQL, Redis, and SQLite verification tooling"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql redis-server sqlite3
sudo systemctl enable --now postgresql redis-server
sudo -u postgres psql -v ON_ERROR_STOP=1 -tAc 'SELECT 1' >/dev/null

# A hex secret needs no URL escaping and is only written to the mode-600 .env.
PG_PASSWORD="$(openssl rand -hex 32)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${POSTGRES_USER}') THEN
    CREATE ROLE ${POSTGRES_USER} LOGIN;
  END IF;
END
\$\$;
ALTER ROLE ${POSTGRES_USER} PASSWORD '${PG_PASSWORD}';
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1; then
  sudo -u postgres createdb -O "$POSTGRES_USER" "$POSTGRES_DB"
fi
DATABASE_URL="postgresql://${POSTGRES_USER}:${PG_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"

say "stopping legacy API writes and taking immutable source backup"
sudo systemctl stop "$SERVICE"
! sudo systemctl is-active --quiet "$SERVICE" || die "legacy API did not stop"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -p "$ROOT/.env" "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP"
cp --reflink=auto --preserve=mode,timestamps "$SOURCE_DB" "$BACKUP_DIR/lingong.sqlite3"
chmod 600 "$BACKUP_DIR/lingong.sqlite3"
sqlite3 "$BACKUP_DIR/lingong.sqlite3" 'PRAGMA integrity_check;' | grep -qx 'ok' || die "SQLite integrity_check failed"
SOURCE_SHA256="$(sha256sum "$BACKUP_DIR/lingong.sqlite3" | awk '{print $1}')"

say "migrating all SQLite tables and verifying PostgreSQL fingerprints"
# DATABASE_URL was checked absent before the write stop. Any existing target
# tables are therefore an abandoned target from an earlier failed cutover, not
# the active authority; replace them so the rollback path is retryable.
(
  cd "$ROOT/backend"
  DATABASE_URL="$DATABASE_URL" npx tsx scripts/migrate-sqlite-to-postgres.ts --replace --source "$BACKUP_DIR/lingong.sqlite3"
) > "$BACKUP_DIR/migration-report.json"
(
  cd "$ROOT/backend"
  DATABASE_URL="$DATABASE_URL" npx tsx scripts/migrate-sqlite-to-postgres.ts --verify-only --source "$BACKUP_DIR/lingong.sqlite3"
) > "$BACKUP_DIR/verification-report.json"
node -e '
  const fs = require("node:fs");
  const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!result.verified || !Array.isArray(result.tables) || !result.tables.length) process.exit(1);
  console.log(`[postgres-cutover] verified ${result.tables.length} tables and ${result.total_rows} rows`);
' "$BACKUP_DIR/verification-report.json"

say "persisting PostgreSQL authority configuration and installing multi-worker services"
upsert_env DATABASE_URL "$DATABASE_URL"
upsert_env REDIS_URL "redis://127.0.0.1:6379"
upsert_env LINGONG_POSTGRES_DB "$POSTGRES_DB"
upsert_env LINGONG_POSTGRES_USER "$POSTGRES_USER"
upsert_env LINGONG_POSTGRES_PASSWORD "$PG_PASSWORD"
EXPECTED_VERSION="$(git rev-parse --short HEAD)"
# The health contract must identify the exact authority revision even when the
# service is started from a detached SHA by the cutover workflow.
upsert_env LINGONG_VERSION "$EXPECTED_VERSION"
chmod 600 "$ROOT/.env"

sudo install -m 644 "$ROOT/ops/systemd/lingong.service" /etc/systemd/system/lingong.service
sudo install -m 644 "$ROOT/ops/systemd/lingong-outbox.service" /etc/systemd/system/lingong-outbox.service
sudo install -m 644 "$ROOT/ops/systemd/lingong-execution-worker@.service" /etc/systemd/system/lingong-execution-worker@.service
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" "$OUTBOX_SERVICE" "$WORKER_A" "$WORKER_B"

# Bring up the API alone first. Starting two BullMQ consumers at the same time
# as the sync-bridge API creates an avoidable boot-time memory and connection
# burst on the production VM, and it obscures whether the authority itself is
# healthy. Workers start only after the API reports the expected revision.
sudo systemctl restart "$SERVICE"
last_actual="unavailable"
for attempt in $(seq 1 48); do
  response="$(curl --fail --silent --show-error --connect-timeout 3 --max-time 8 http://127.0.0.1:8765/api/version || true)"
  actual="$(printf '%s' "$response" | node -e 'let b=""; process.stdin.on("data",x=>b+=x).on("end",()=>{try { console.log(JSON.parse(b).version || ""); } catch { console.log(""); }})')"
  last_actual="${actual:-unavailable}"
  if [ "$actual" = "$EXPECTED_VERSION" ]; then break; fi
  if [ "$attempt" -eq 48 ]; then
    say "API version probe expected $EXPECTED_VERSION but observed $last_actual"
    sudo systemctl --no-pager --full status "$SERVICE" || true
    sudo journalctl --no-pager -u "$SERVICE" -n 120 || true
    die "API did not report expected revision $EXPECTED_VERSION"
  fi
  sleep 5
done
sudo systemctl is-active --quiet "$SERVICE"

say "API is healthy; starting Outbox publisher and execution workers"
sudo systemctl restart "$OUTBOX_SERVICE" "$WORKER_A" "$WORKER_B"
workers_started=true
sudo systemctl is-active --quiet "$OUTBOX_SERVICE"
sudo systemctl is-active --quiet "$WORKER_A"
sudo systemctl is-active --quiet "$WORKER_B"
PGPASSWORD="$PG_PASSWORD" psql "$DATABASE_URL" -Atc "SELECT count(*) FROM execution_worker_heartbeats WHERE status='running'" | awk '$1 >= 2 {ok=1} END {exit ok ? 0 : 1}'
PGPASSWORD="$PG_PASSWORD" pg_dump --format=custom --file="$BACKUP_DIR/lingong.postgres.dump" "$DATABASE_URL"
chmod 600 "$BACKUP_DIR/lingong.postgres.dump"

cat > "$BACKUP_DIR/cutover-report.txt" <<REPORT
revision=$EXPECTED_VERSION
source_db=$SOURCE_DB
source_sha256=$SOURCE_SHA256
postgres_db=$POSTGRES_DB
verified_at=$(date -u +%FT%TZ)
REPORT
chmod 600 "$BACKUP_DIR/cutover-report.txt"
cutover_committed=true
say "cutover complete; source and PostgreSQL backups retained in $BACKUP_DIR"
