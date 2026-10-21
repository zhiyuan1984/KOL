#!/usr/bin/env bash
# Provision only nginx's static UI root. This is intentionally separate from
# deploy.sh so a normal release never uses sudo to alter filesystem ownership.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UI_ROOT="${LINGONG_UI_ROOT:-/var/www/lingong/ui}"
DEPLOY_USER="${DEPLOY_USER:-}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/bootstrap-nginx-static-entry.sh --deploy-user <user> [--apply]

Without --apply, print the exact restricted directory plan and make no changes.
With --apply, run as root (normally: sudo ./scripts/bootstrap-nginx-static-entry.sh
--apply --deploy-user ecs-user) to create only /var/www/lingong/ui and its
releases/assets children. It never chmods or chowns /home, the checkout, or
existing release contents.
EOF
}

die() {
  echo "$*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --deploy-user)
      [ "$#" -ge 2 ] || die "--deploy-user requires a user"
      DEPLOY_USER="$2"
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[ -n "$DEPLOY_USER" ] || die "--deploy-user is required (for example ecs-user)"
id "$DEPLOY_USER" >/dev/null 2>&1 || die "deploy user does not exist: $DEPLOY_USER"
case "$UI_ROOT" in
  /var/www/lingong/ui) ;;
  *) die "LINGONG_UI_ROOT is restricted to /var/www/lingong/ui for this production bootstrap" ;;
esac
[ -f "$ROOT/ops/nginx/app.conf" ] || die "run from a complete repository checkout"
DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"

cat <<EOF
Static-root bootstrap plan (no change made unless --apply is supplied):
  /var/www/lingong                       root:root 0755
  $UI_ROOT                               $DEPLOY_USER:$DEPLOY_GROUP 0755
  $UI_ROOT/releases                      $DEPLOY_USER:$DEPLOY_GROUP 0755
  $UI_ROOT/assets                        $DEPLOY_USER:$DEPLOY_GROUP 0755

The nginx worker needs only world-readable traversal/read permissions. No /home
or repository path will be changed. deploy.sh will reject symlinked roots and
will create the current symlink only after API health succeeds.
EOF

[ "$APPLY" -eq 1 ] || exit 0
[ "$(id -u)" -eq 0 ] || die "--apply must run as root; use sudo $0 --apply --deploy-user $DEPLOY_USER"

# Do not take ownership of a pre-existing populated UI tree. That could hide a
# mistaken production path or alter historical releases; require a clean first
# install or a structurally matching root instead.
if [ -e "$UI_ROOT" ] && [ ! -d "$UI_ROOT" ]; then
  die "$UI_ROOT exists but is not a directory"
fi
if [ -L "$UI_ROOT" ] || [ -L "$UI_ROOT/releases" ] || [ -L "$UI_ROOT/assets" ]; then
  die "UI root or child is a symlink; refusing to create a static-root escape"
fi

install -d -o root -g root -m 0755 /var/www/lingong
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0755 "$UI_ROOT"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0755 "$UI_ROOT/releases"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0755 "$UI_ROOT/assets"

echo "Static UI root is ready. Next, install ops/nginx/app.conf, run nginx -t/reload, then run scripts/deploy.sh."
