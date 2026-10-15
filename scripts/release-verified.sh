#!/usr/bin/env bash
# CI-only verified revision release. Never force-reset or discard server evidence.
set -euo pipefail
ROOT="${LINGONG_RELEASE_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
: "${DEPLOY_REVISION:?A fully verified commit is required}"
[[ "$DEPLOY_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 1; }
umask 077
LOCK_PATH="$(git rev-parse --path-format=absolute --git-common-dir)/lingong-deploy.lock"
exec 9>"$LOCK_PATH"
flock -n 9 || { echo 'Another release owns the deployment lock' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo 'Tracked server changes must be reconciled first' >&2; exit 1; }
BASE="$(git rev-parse HEAD)"
git fetch github "$DEPLOY_REVISION"
git merge-base --is-ancestor "$BASE" "$DEPLOY_REVISION" || { echo 'Verified candidate does not preserve the current deployed history' >&2; exit 1; }
# Untracked evidence stays in place; git's normal merge refuses any colliding file.
# Do not execute .env as shell code or print credentials.
DATABASE_URL="$(node --input-type=module - <<'JS'
import fs from 'node:fs';
const text=fs.readFileSync('.env','utf8');
const line=text.split(/\r?\n/).find(l=>/^DATABASE_URL=/.test(l));
if(!line) throw new Error('DATABASE_URL missing');
let value=line.slice('DATABASE_URL='.length).trim();
if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
const url=new URL(value); if(!['postgres:','postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL URL required');
process.stdout.write(value);
JS
)"
export DATABASE_URL
command -v pg_dump >/dev/null
command -v pg_restore >/dev/null
BACKUP_DIR="${LINGONG_RELEASE_BACKUP_DIR:-$HOME/kol-release-backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-${DEPLOY_REVISION:0:12}"
DUMP="$BACKUP_DIR/$STAMP.dump"
[ ! -e "$DUMP" ] || { echo 'Backup already exists; do not overwrite it' >&2; exit 1; }
pg_dump --format=custom --file="$DUMP" "$DATABASE_URL"
pg_restore --list "$DUMP" > "$BACKUP_DIR/$STAMP.toc"
[ -s "$DUMP" ] && [ -s "$BACKUP_DIR/$STAMP.toc" ]
printf '%s\n' "$BASE" > "$BACKUP_DIR/$STAMP.previous-commit"
git status --porcelain=v1 > "$BACKUP_DIR/$STAMP.server-worktree-status"
[ "$(git rev-parse HEAD)" = "$BASE" ] || { echo 'Server revision changed during backup' >&2; exit 1; }
git merge --ff-only "$DEPLOY_REVISION"
[ "$(git rev-parse HEAD)" = "$DEPLOY_REVISION" ]
export ONTOLOGY_RELEASE_BASE="$BASE"
bash scripts/apply-postgres-schema.sh
bash scripts/deploy.sh
EXPECTED="$(git rev-parse --short "$DEPLOY_REVISION")"
ACTUAL="$(curl --fail --silent --max-time 10 http://127.0.0.1:8765/api/version | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).version||""))')"
[ "$ACTUAL" = "$EXPECTED" ] || { echo 'Running API does not match the verified revision' >&2; exit 1; }
curl --fail --silent --max-time 10 http://127.0.0.1:8765/api/health >/dev/null
printf 'Verified release %s; previous commit %s; backup %s\n' "$DEPLOY_REVISION" "$BASE" "$DUMP"
