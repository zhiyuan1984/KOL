#!/usr/bin/env bash
# Test-host PG16 compatibility fix. No daemon/security/data-volume modifications.
# Called under deploy-docker.sh's release lock, before PostgreSQL is started.
set -Eeuo pipefail
[[ "${CONFIG_TYPE:-}" == 'test' ]] || { echo '[FAIL] PG compatibility repair is test-only' >&2; exit 1; }
DEPLOY_DIR="${1:-/mnt/starrywork}"
[[ "$DEPLOY_DIR" == '/mnt/starrywork' && -d "$DEPLOY_DIR" && ! -L "$DEPLOY_DIR" ]] \
  || { echo '[FAIL] Unexpected PG repair deployment directory' >&2; exit 1; }
command -v docker >/dev/null
command -v python3 >/dev/null
cd "$DEPLOY_DIR"
TARGET_IMAGE='postgres:16-bookworm@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4'
PG_DATA="$DEPLOY_DIR/postgres-data"
OVERRIDE="$DEPLOY_DIR/docker-compose.override.yml"
COMPOSE=(docker compose --project-directory "$DEPLOY_DIR")
umask 077
TMP_DIR="$(mktemp -d "$DEPLOY_DIR/.pg-runtime-compat.XXXXXX")"
installed=0
validated=0
cleanup() {
  rc=$?
  trap - EXIT
  # Roll back only the exact new override inode we installed, never existing files.
  if [[ "$installed" == 1 && "$validated" != 1 && -f "$OVERRIDE" && ! -L "$OVERRIDE" ]]; then
    if [[ "$(stat -c '%d:%i' "$OVERRIDE")" == "$(stat -c '%d:%i' "$TMP_DIR/override.yml")" ]] \
      && cmp -s "$OVERRIDE" "$TMP_DIR/override.yml"; then rm -- "$OVERRIDE"; fi
  fi
  rm -rf -- "$TMP_DIR"
  exit "$rc"
}
trap cleanup EXIT
"${COMPOSE[@]}" config --format json > "$TMP_DIR/before.json"
CURRENT_IMAGE="$(python3 - "$TMP_DIR/before.json" "$PG_DATA" <<'PY'
import json, sys
config=json.load(open(sys.argv[1])); pg=(config.get('services') or {}).get('postgres')
if not pg: raise SystemExit('Missing postgres Compose service')
mounts=pg.get('volumes') or []
if not any(v.get('type')=='bind' and v.get('source')==sys.argv[2] and v.get('target')=='/var/lib/postgresql/data' for v in mounts):
    raise SystemExit('Unexpected PostgreSQL data mount; no changes made')
print(pg.get('image') or '')
PY
)"
case "$CURRENT_IMAGE" in
  postgres:16-bookworm|postgres:16-bookworm@sha256:*)
    echo '[PG-COMPAT] PG16 Bookworm already selected; existing configuration preserved'
    exit 0
    ;;
  postgres:16-alpine|postgres:16-alpine@sha256:*) ;;
  *) echo '[FAIL] Unexpected PG image/major; no automatic migration or configuration change' >&2; exit 1 ;;
esac
[[ -d "$PG_DATA" && ! -L "$PG_DATA" ]] \
  || { echo '[FAIL] PG data directory missing or symlink; no changes made' >&2; exit 1; }
if [[ -f "$PG_DATA/PG_VERSION" ]]; then
  [[ "$(cat "$PG_DATA/PG_VERSION")" == '16' ]] \
    || { echo '[FAIL] Existing PG data major is not 16; no migration or deletion' >&2; exit 1; }
elif [[ -n "$(find "$PG_DATA" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo '[FAIL] Unversioned nonempty PG directory; refusing initialization or cleanup' >&2
  exit 1
fi
# Compose's normal override preserves the base file, bind paths and all credentials.
# Never replace a pre-existing override, even if it is not currently loaded.
[[ ! -e "$OVERRIDE" && ! -L "$OVERRIDE" ]] \
  || { echo '[FAIL] Existing Compose override requires explicit merge; not overwritten' >&2; exit 1; }
cat > "$TMP_DIR/override.yml" <<EOF
# Managed by scripts/install-postgres-runtime-compat.sh; PG16 only.
# Root cause: PG16 Alpine initdb fails on this CentOS7/libseccomp2.3.1 host.
# Same-major Bookworm initdb verified in isolated no-network tmpfs.
services:
  postgres:
    image: $TARGET_IMAGE
EOF
# Atomic create-if-absent: no blind overwrite if another actor creates an override.
ln "$TMP_DIR/override.yml" "$OVERRIDE"
installed=1
"${COMPOSE[@]}" config --format json > "$TMP_DIR/after.json"
python3 - "$TMP_DIR/before.json" "$TMP_DIR/after.json" "$TARGET_IMAGE" <<'PY'
import json, sys
before=json.load(open(sys.argv[1])); after=json.load(open(sys.argv[2]))
before['services']['postgres']['image']=sys.argv[3]
if before != after:
    raise SystemExit('Compose changed beyond the PG image; new override will be rolled back')
print('[PG-COMPAT] Validated: only PG image changed; data binds, env, ports and security options preserved')
PY
validated=1
echo '[PG-COMPAT] PG16 Bookworm digest pinned. No data files/volumes deleted; no security policy changes.'
