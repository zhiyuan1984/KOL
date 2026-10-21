#!/usr/bin/env bash
# Isolated nginx smoke/integration test for ops/nginx/app.conf.
# It never touches /etc/nginx, system nginx, /var/www, or a real API process.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_CONF="$ROOT/ops/nginx/app.conf"
NGINX_BIN="${NGINX_BIN:-nginx}"
LOG_DIR="${TEST_LOG_DIR:-${TMPDIR:-/tmp}}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/nginx-static-entry-test-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

die() {
  log "FAIL: $*"
  exit 1
}

command -v "$NGINX_BIN" >/dev/null 2>&1 || die "nginx command not found: $NGINX_BIN"
command -v curl >/dev/null 2>&1 || die "curl command not found"
command -v python3 >/dev/null 2>&1 || die "python3 command not found"
[ -f "$APP_CONF" ] || die "missing nginx config: $APP_CONF"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/lingong-nginx-static-entry.XXXXXX")"
NGINX_PREFIX="$TMP/nginx"
UI_ROOT="$TMP/ui"
UPSTREAM_DIR="$TMP/upstream"
NGINX_PID=""
UPSTREAM_PID=""

cleanup() {
  local status=$?
  if [ -n "$NGINX_PID" ]; then
    "$NGINX_BIN" -p "$NGINX_PREFIX" -c nginx.conf -s quit >/dev/null 2>&1 || kill "$NGINX_PID" >/dev/null 2>&1 || true
    wait "$NGINX_PID" 2>/dev/null || true
  fi
  if [ -n "$UPSTREAM_PID" ]; then
    kill "$UPSTREAM_PID" >/dev/null 2>&1 || true
    wait "$UPSTREAM_PID" 2>/dev/null || true
  fi
  if [ "${TEST_KEEP_TMP:-0}" = "1" ]; then
    log "retained isolated nginx files: $TMP"
  else
    # Test releases deliberately model immutable 0555/0444 production files.
    # Restore only the temporary fixture owner permission before cleanup.
    find "$TMP/ui/releases" -type d -exec chmod u+rwx {} + 2>/dev/null || true
    rm -rf "$TMP"
  fi
  log "log file: $LOG_FILE"
  exit "$status"
}
trap cleanup EXIT INT TERM

free_port() {
  python3 - <<'PY'
import socket
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
}

request() {
  local path="$1" headers="$2" body="$3"
  curl --path-as-is -sS --max-time 3 -D "$headers" -o "$body" -w '%{http_code}' "http://127.0.0.1:${NGINX_PORT}${path}"
}

assert_status() {
  local expected="$1" path="$2" label="$3"
  local headers="$TMP/${label}.headers" body="$TMP/${label}.body" code
  code="$(request "$path" "$headers" "$body")" || die "$label request failed"
  [ "$code" = "$expected" ] || die "$label expected HTTP $expected, got $code (body: $(tr '\n' ' ' < "$body" | head -c 180))"
  log "PASS $label: HTTP $code"
}

assert_status_one_of() {
  local expected="$1" path="$2" label="$3"
  local headers="$TMP/${label}.headers" body="$TMP/${label}.body" code
  code="$(request "$path" "$headers" "$body")" || die "$label request failed"
  [[ " $expected " == *" $code "* ]] \
    || die "$label expected one of [$expected], got $code (body: $(tr '\n' ' ' < "$body" | head -c 180))"
  log "PASS $label: HTTP $code"
}

assert_header() {
  local label="$1" expression="$2"
  grep -Eiq "$expression" "$TMP/${label}.headers" || die "$label missing header /$expression/: $(tr '\n' ';' < "$TMP/${label}.headers")"
  log "PASS $label header /$expression/"
}

assert_header_absent() {
  local label="$1" expression="$2"
  ! grep -Eiq "$expression" "$TMP/${label}.headers" \
    || die "$label unexpectedly contains header /$expression/: $(tr '\n' ';' < "$TMP/${label}.headers")"
  log "PASS $label omits header /$expression/"
}

assert_body_contains() {
  local label="$1" expected="$2"
  grep -Fq "$expected" "$TMP/${label}.body" || die "$label body does not contain $expected"
  log "PASS $label body contains expected marker"
}

assert_body_absent() {
  local label="$1" unexpected="$2"
  ! grep -Fq "$unexpected" "$TMP/${label}.body" || die "$label unexpectedly exposed $unexpected"
  log "PASS $label does not expose forbidden content"
}

switch_current() {
  local release="$1" link previous_link old_target
  link="$UI_ROOT/.current.${release}.$$"
  previous_link="$UI_ROOT/.previous.${release}.$$"
  old_target="$(readlink "$UI_ROOT/current")"
  ln -s "$old_target" "$previous_link"
  mv -Tf "$previous_link" "$UI_ROOT/previous"
  ln -s "releases/$release" "$link"
  mv -Tf "$link" "$UI_ROOT/current"
  [ "$(readlink "$UI_ROOT/current")" = "releases/$release" ] || die "atomic current switch target mismatch"
}

rollback_previous() {
  local target link
  target="$(readlink "$UI_ROOT/previous")"
  link="$UI_ROOT/.current.rollback.$$"
  ln -s "$target" "$link"
  mv -Tf "$link" "$UI_ROOT/current"
  [ "$(readlink "$UI_ROOT/current")" = "$target" ] || die "previous rollback target mismatch"
}

NGINX_PORT="$(free_port)"
UPSTREAM_PORT="$(free_port)"
mkdir -p "$NGINX_PREFIX/logs" "$NGINX_PREFIX/temp/client_body" "$NGINX_PREFIX/temp/proxy" "$NGINX_PREFIX/temp/fastcgi" "$NGINX_PREFIX/temp/uwsgi" "$NGINX_PREFIX/temp/scgi" "$UI_ROOT/releases/rev-a/assets" "$UI_ROOT/releases/rev-b/assets" "$UI_ROOT/assets" "$UPSTREAM_DIR/api" "$UPSTREAM_DIR/mock"
printf '{"ok":true}\n' > "$UPSTREAM_DIR/api/health"
printf '<!doctype html><title>OLD-SPA</title>OLD-SPA\n' > "$UI_ROOT/releases/rev-a/index.html"
printf '<!doctype html><title>NEW-SPA</title>NEW-SPA\n' > "$UI_ROOT/releases/rev-b/index.html"
printf '{"commit":"rev-a"}\n' > "$UI_ROOT/releases/rev-a/release.json"
printf '{"commit":"rev-b"}\n' > "$UI_ROOT/releases/rev-b/release.json"
printf 'old favicon\n' > "$UI_ROOT/releases/rev-a/favicon.ico"
printf 'new favicon\n' > "$UI_ROOT/releases/rev-b/favicon.ico"
printf 'console.log("old asset")\n' > "$UI_ROOT/releases/rev-a/assets/app-old-a1b2.js"
printf 'console.log("new asset")\n' > "$UI_ROOT/releases/rev-b/assets/app-new-c3d4.js"
cp "$UI_ROOT/releases/rev-a/assets/app-old-a1b2.js" "$UI_ROOT/assets/app-old-a1b2.js"
cp "$UI_ROOT/releases/rev-b/assets/app-new-c3d4.js" "$UI_ROOT/assets/app-new-c3d4.js"
# Model immutable releases and nginx-readable traversal permissions.
find "$UI_ROOT/releases" -type d -exec chmod 0555 {} +
find "$UI_ROOT/releases" -type f -exec chmod 0444 {} +
chmod 0755 "$UI_ROOT" "$UI_ROOT/assets"
chmod 0644 "$UI_ROOT/assets"/*.js
ln -s releases/rev-a "$UI_ROOT/current"
[ -L "$UI_ROOT/current" ] || die "current is not a symlink"
[ "$(readlink "$UI_ROOT/current")" = "releases/rev-a" ] || die "initial current target is wrong"
[ "$(stat -Lc '%a' "$UI_ROOT/current")" = "555" ] || die "current target is not immutable/readable (expected 555)"
[ "$(stat -c '%a' "$UI_ROOT/assets/app-old-a1b2.js")" = "644" ] || die "asset pool is not nginx-readable"
log "PASS current permissions: symlink target is immutable/readable and asset pool is readable"

python3 - "$APP_CONF" "$TMP/app.conf" "$NGINX_PORT" "$UPSTREAM_PORT" "$UI_ROOT" <<'PY'
from pathlib import Path
import sys
source, destination, nginx_port, upstream_port, ui_root = sys.argv[1:]
config = Path(source).read_text()
config = config.replace("listen 80;", f"listen {nginx_port};", 1)
config = config.replace("127.0.0.1:8765", f"127.0.0.1:{upstream_port}")
config = config.replace("/var/www/lingong/ui", ui_root)
if "/var/www/lingong/ui" in config or "127.0.0.1:8765" in config:
    raise SystemExit("test substitution did not replace static root or upstream")
Path(destination).write_text(config)
PY
cat > "$NGINX_PREFIX/nginx.conf" <<EOF
worker_processes 1;
error_log logs/error.log info;
pid logs/nginx.pid;
events { worker_connections 32; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log logs/access.log;
    client_body_temp_path temp/client_body;
    proxy_temp_path temp/proxy;
    fastcgi_temp_path temp/fastcgi;
    uwsgi_temp_path temp/uwsgi;
    scgi_temp_path temp/scgi;
    include $TMP/app.conf;
}
EOF

"$NGINX_BIN" -p "$NGINX_PREFIX" -c nginx.conf -t >> "$LOG_FILE" 2>&1 || die "isolated nginx configuration test failed"
python3 -m http.server "$UPSTREAM_PORT" --bind 127.0.0.1 --directory "$UPSTREAM_DIR" >> "$LOG_FILE" 2>&1 &
UPSTREAM_PID="$!"
"$NGINX_BIN" -p "$NGINX_PREFIX" -c nginx.conf >> "$LOG_FILE" 2>&1 &
NGINX_PID="$!"
sleep 0.2
curl -fsS --max-time 2 "http://127.0.0.1:${UPSTREAM_PORT}/" >/dev/null || die "test upstream did not start"
log "isolated nginx started on $NGINX_PORT; upstream available on $UPSTREAM_PORT"

# Static root/deep links work regardless of upstream state; HTML is never cached.
assert_status 200 / root-upstream-up
assert_body_contains root-upstream-up OLD-SPA
assert_header root-upstream-up '^Cache-Control:.*no-store'
assert_status 200 /business-map/instances/instance-42 deep-upstream-up
assert_body_contains deep-upstream-up OLD-SPA
assert_header deep-upstream-up '^Cache-Control:.*no-store'
assert_status 200 /assets/app-old-a1b2.js asset-upstream-up
assert_body_contains asset-upstream-up 'old asset'
assert_header asset-upstream-up '^Content-Type:.*(application|text)/javascript'
assert_header asset-upstream-up '^Cache-Control:.*max-age=31536000.*immutable'
assert_status 404 /assets/missing-404.js missing-static
assert_body_absent missing-static OLD-SPA
assert_status 404 /missing-static.json missing-json
assert_body_absent missing-json OLD-SPA
assert_header missing-json '^Cache-Control:.*no-cache'
assert_status 200 /favicon.ico public-favicon
assert_header public-favicon '^Cache-Control:.*no-cache'
assert_header_absent public-favicon '^Cache-Control:.*immutable'
assert_status 200 /release.json release-metadata
assert_header release-metadata '^Cache-Control:.*no-store'
assert_status 200 /api/health api-upstream-up
assert_status 200 /mock/ mock-upstream-up

# The source/repository tree is outside nginx root; traversal must not disclose it.
printf 'REPOSITORY-SECRET-MUST-NOT-LEAK\n' > "$TMP/private-repo-secret.txt"
# nginx normally rejects this malformed traversal before location dispatch (400);
# a static 404 is also safe. Either result must contain no host/repository bytes.
assert_status_one_of '400 404' /../../private-repo-secret.txt traversal
assert_body_absent traversal REPOSITORY-SECRET-MUST-NOT-LEAK

# Simulate a real backend outage. Root/deep links stay static, API/mock retain 502.
kill "$UPSTREAM_PID" >/dev/null 2>&1 || true
wait "$UPSTREAM_PID" 2>/dev/null || true
UPSTREAM_PID=""
sleep 0.1
assert_status 200 / root-upstream-down
assert_body_contains root-upstream-down OLD-SPA
assert_status 200 /business-map/instances/instance-42 deep-upstream-down
assert_body_contains deep-upstream-down OLD-SPA
assert_status 502 /api api-no-slash-down
assert_status 502 /api/health api-slash-down
assert_status 502 /mock mock-no-slash-down
assert_status 502 /mock/ mock-slash-down

# current replacement is a rename, so no request observes a partially copied build.
switch_current rev-b
[ "$(readlink "$UI_ROOT/previous")" = "releases/rev-a" ] || die "previous does not preserve the pre-switch release"
log "PASS previous pointer atomically records releases/rev-a before current moves"
assert_status 200 /business-map/instances/instance-42 deep-after-switch
assert_body_contains deep-after-switch NEW-SPA
assert_status 200 /assets/app-old-a1b2.js old-tab-asset-after-switch
assert_body_contains old-tab-asset-after-switch 'old asset'
rollback_previous
assert_status 200 /business-map/instances/instance-42 deep-after-rollback
assert_body_contains deep-after-rollback OLD-SPA
log "PASS atomic current switch and manual static rollback; backend/database were not touched"
log "ALL PASS: static entry, cache policy, 404 behavior, real proxy failures, compatibility assets, permissions, and atomic rollback"
