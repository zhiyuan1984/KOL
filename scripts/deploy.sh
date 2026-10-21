#!/usr/bin/env bash
# Linux 服务器部署入口：先在旧进程仍在对外服务时构建前端，再重启 systemd 服务。
# 这样重启只花几秒（start.sh 不需要在启动路径里再构建前端），不会出现 60–90 秒的 502。
#
# 用法（服务器上，仓库根目录）：
#   ./scripts/deploy.sh           # 用当前工作区代码部署
#   ./scripts/deploy.sh --sync    # 仅安全快进 github/main；分叉时拒绝覆盖并停止发布
# 本机一条命令：
#   ssh ecs-user@47.88.94.205 "cd ~/kol && ./scripts/deploy.sh --sync"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
PORT="${LINGONG_PORT:-8765}"
# nginx intentionally serves only this tree, never the checkout under /home.
# Operators may override this for an isolated staging installation, but it must
# remain an absolute, pre-provisioned static root.
UI_ROOT="${LINGONG_UI_ROOT:-/var/www/lingong/ui}"
UI_RELEASES_DIR="$UI_ROOT/releases"
UI_ASSETS_DIR="$UI_ROOT/assets"
UI_CURRENT="$UI_ROOT/current"
UI_PREVIOUS="$UI_ROOT/previous"
CI_DIST_DIR="$ROOT/frontend/dist"
# A static release is copied once intact and its hashed assets may be copied once
# to the old-tab compatibility pool. Keep a modest fixed reserve for logs/OS.
STATIC_RELEASE_RESERVE_KB="${STATIC_RELEASE_RESERVE_KB:-262144}"

die() { echo "$*" >&2; exit 1; }
# Serialize releases, including --sync, across worktrees sharing this Git store.
command -v flock >/dev/null 2>&1 || die "缺少 flock，未修改代码或产物"
LOCK_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
LOCK_PATH="$LOCK_DIR/lingong-deploy.lock"
# A --sync re-exec inherits fd 9; an environment flag alone cannot own the lock.
if [ "$(readlink /proc/$$/fd/9 2>/dev/null || true)" != "$LOCK_PATH" ]; then
  exec 9>"$LOCK_PATH"
fi
flock -n 9 || die "已有发布正在执行，未修改代码或产物"
if [ "${1:-}" = "--sync" ] && [ -z "${DEPLOY_RESYNCED:-}" ]; then
  # 快进可能替换本脚本本身，而 bash 不能安全地边改边读同一个脚本，所以重新执行新版本。
  # 把仍在运行的工作树 HEAD 作为真实部署基线传给快进后的新脚本；这不是
  # 可跳过门禁的开关，后续仍会由 PG 发布账本核对其内容摘要。
  if [ -z "${ONTOLOGY_RELEASE_BASE:-}" ]; then
    ONTOLOGY_RELEASE_BASE="$(git rev-parse --verify HEAD)" || die "无法读取当前运行版本 Git commit，未 fetch/merge"
    export ONTOLOGY_RELEASE_BASE
  fi
  git diff --quiet && git diff --cached --quiet || die "工作区存在未提交变更，未同步、未构建、未重启"
  git fetch github
  # A parallel main must not erase a deployed native migration, owner hotfix,
  # or other production history. Never force-reset a divergent live checkout.
  git merge --ff-only github/main || die "远端主线与生产历史分叉；未覆盖代码，需先正常整合并通过本体发布门禁"
  export DEPLOY_RESYNCED=1
  [ -f "$SELF" ] || die "reset 后 $SELF 不存在：github/main 里缺少 scripts/deploy.sh"
  exec "$SELF" --sync
fi

command -v node >/dev/null 2>&1 || die "缺少 node"
command -v npm >/dev/null 2>&1 || die "缺少 npm"
[ -f "$ROOT/frontend/package.json" ] || die "未找到 frontend/，请从仓库根目录运行 scripts/deploy.sh"

# Runtime skill fingerprints include the resolved manifest path. Restarting a
# worker pinned to another release is not a deployment of this working tree.
RUNTIME_UNITS=(lingong lingong-outbox lingong-execution-worker@1 lingong-execution-worker@2 lingong-cron-tick)
for unit in "${RUNTIME_UNITS[@]}"; do
  working_dir="$(systemctl show "$unit" -p WorkingDirectory --value)"
  entry="start.sh"
  role=""
  case "$unit" in
    lingong-outbox) entry="worker.sh"; role=" outbox" ;;
    lingong-execution-worker@*) entry="worker.sh"; role=" execution" ;;
    lingong-cron-tick) entry="worker.sh"; role=" cron-tick" ;;
  esac
  actual_start="$(systemctl show "$unit" -p ExecStart --value)"
  [ "$working_dir" = "$ROOT" ] && [[ "$actual_start" == *"path=$ROOT/scripts/$entry ;"* ]] \
    && [[ "$actual_start" == *"argv[]=$ROOT/scripts/$entry$role ;"* ]] \
    || die "$unit 不使用本次发布路径 $ROOT；请先统一 WorkingDirectory 与 ExecStart，未构建、未重启"
done

ticker_environment="$(systemctl show lingong-cron-tick -p Environment --value)"
[[ "$ticker_environment" =~ (^|[[:space:]\"])CRON_MISSED_RUN_POLICY=(coalesce|replay)($|[[:space:]\"]) ]] \
  || die "Cron 恢复策略尚未显式配置；未构建、未重启"

runtime_units_active() {
  local unit
  for unit in "${RUNTIME_UNITS[@]}"; do
    systemctl is-active --quiet "$unit" || return 1
  done
}

need_install() {
  local dir="$1" marker="$2"
  [ ! -e "$dir/node_modules/$marker" ] && return 0
  [ -f "$dir/package-lock.json" ] && [ "$dir/package-lock.json" -nt "$dir/node_modules" ] && return 0
  return 1
}

install_pkg() {
  local dir="$1"
  echo "安装依赖：$dir"
  if [ -f "$dir/package-lock.json" ]; then
    (cd "$dir" && npm ci --ignore-scripts=false --foreground-scripts)
  else
    (cd "$dir" && npm install --ignore-scripts=false --foreground-scripts)
  fi
}

if need_install "$ROOT/backend" "tsx"; then
  install_pkg "$ROOT/backend"
fi
if need_install "$ROOT/frontend" "vite"; then
  install_pkg "$ROOT/frontend"
fi

# 本体 registry 发布检查是提醒，不是阻断（2026-10-15 qiyou 决策，ADR-2026-10-15）：
# 部署时系统正在替换，审批人无法在系统里审批；部署等审批是死锁。
# 审批是治理留痕，不是部署前置条件。缺失审批只警告、不拦部署。
# 首次治理安装会明确输出 bootstrap/approval_not_claimed，并只在服务健康后写入事实基线。
ONTOLOGY_GATE="$ROOT/backend/node_modules/.bin/tsx"
[ -x "$ONTOLOGY_GATE" ] || die "缺少 backend/node_modules/.bin/tsx，未构建、未重启"
echo "检查本体 registry 发布状态（提醒，不阻断部署）"
"$ONTOLOGY_GATE" "$ROOT/backend/scripts/check-ontology-release.ts"

record_ontology_release() {
  echo "服务健康，记录本体 registry 发布事实基线"
  "$ONTOLOGY_GATE" "$ROOT/backend/scripts/check-ontology-release.ts" --record
}

require_static_ui_root() {
  case "$UI_ROOT" in
    /*) ;;
    *) die "LINGONG_UI_ROOT 必须是绝对路径，未构建、未重启" ;;
  esac
  [ -d "$UI_ROOT" ] && [ ! -L "$UI_ROOT" ] \
    || die "静态 UI 根目录 $UI_ROOT 未安装或是符号链接；未构建、未重启。请按 docs/nginx-static-entry-release-20261021.md 创建仅供 nginx 使用的 /var/www/lingong/ui。"
  [ -d "$UI_RELEASES_DIR" ] && [ -d "$UI_ASSETS_DIR" ] \
    || die "静态 UI 根目录缺少 releases/ 或 assets/；未构建、未重启。请按 docs/nginx-static-entry-release-20261021.md 安装。"
  [ ! -L "$UI_RELEASES_DIR" ] && [ ! -L "$UI_ASSETS_DIR" ] \
    || die "静态 releases/ 或 assets/ 不能是符号链接；未构建、未重启"
  [ -w "$UI_ROOT" ] && [ -w "$UI_RELEASES_DIR" ] && [ -w "$UI_ASSETS_DIR" ] \
    || die "静态 UI 根目录不可写；未构建、未重启。只授权部署用户写 $UI_ROOT，不要放宽 /home 或仓库权限。"
  [ ! -e "$UI_CURRENT" ] || [ -L "$UI_CURRENT" ] \
    || die "$UI_CURRENT 不是符号链接；为保护已发布静态文件，未构建、未重启"
  [ ! -e "$UI_PREVIOUS" ] || [ -L "$UI_PREVIOUS" ] \
    || die "$UI_PREVIOUS 不是符号链接；为保护已发布静态文件，未构建、未重启"
  local managed_link current_target releases_real
  releases_real="$(realpath -e "$UI_RELEASES_DIR")"
  for managed_link in "$UI_CURRENT" "$UI_PREVIOUS"; do
    [ -L "$managed_link" ] || continue
    current_target="$(realpath -e "$managed_link" 2>/dev/null || true)"
    case "$current_target" in
      "$releases_real"/*) ;;
      *) die "$managed_link 未指向受管 releases/，为避免公开非静态路径，未构建、未重启" ;;
    esac
    [ -d "$current_target" ] && [ ! -L "$current_target" ] \
      || die "$managed_link 目标无效或是符号链接；未构建、未重启"
  done
}

validate_static_release() {
  local release_dir="$1"
  [ -d "$release_dir" ] && [ ! -L "$release_dir" ] || return 1
  [ -z "$(find "$release_dir" -type l -print -quit)" ] || return 1
  [ -f "$release_dir/index.html" ] || return 1
  [ -f "$release_dir/release.json" ] || return 1
  [ -f "$release_dir/manifest.sha256" ] || return 1
  node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.exit(manifest.commit === process.argv[2] && manifest.manifest === "manifest.sha256" ? 0 : 1);
  ' "$release_dir/release.json" "$RELEASE_REV" || return 1
  (cd "$release_dir" && sha256sum -c manifest.sha256 >/dev/null)
}

asset_parent_without_symlink() {
  local relative="$1" directory="$UI_ASSETS_DIR" part
  local -a parts
  IFS=/ read -r -a parts <<< "$relative"
  # All but the final filename must be ordinary directories beneath assets/.
  for ((i = 0; i < ${#parts[@]} - 1; i++)); do
    part="${parts[$i]}"
    [ -n "$part" ] && [ "$part" != "." ] && [ "$part" != ".." ] \
      || die "非法静态 asset 相对路径：$relative"
    directory="$directory/$part"
    if [ -e "$directory" ]; then
      [ -d "$directory" ] && [ ! -L "$directory" ] \
        || die "静态 assets 路径包含非目录或符号链接：$directory"
    else
      mkdir "$directory"
      chmod 0755 "$directory"
    fi
  done
  printf '%s\n' "$directory"
}

publish_hashed_assets() {
  local release_stage="$1" source relative destination destination_dir
  [ -d "$release_stage/assets" ] && [ ! -L "$release_stage/assets" ] || return 0
  while IFS= read -r -d '' source; do
    relative="${source#"$release_stage/assets/"}"
    destination_dir="$(asset_parent_without_symlink "$relative")"
    destination="$destination_dir/${relative##*/}"
    [ ! -L "$destination" ] \
      || die "静态 assets 文件不能以符号链接复用：$destination"
    if [ -e "$destination" ]; then
      [ -f "$destination" ] && cmp -s "$source" "$destination" \
        || die "静态 assets 哈希文件冲突：$destination 已存在但内容不同；保留历史资源，未切换 current"
    else
      install -m 0644 "$source" "$destination"
    fi
  done < <(find "$release_stage/assets" -type f -print0)
}

require_static_release_space() {
  local build_kb available_kb required_kb
  build_kb="$(du -sk "$BUILD_PATH" | awk '{print $1}')"
  available_kb="$(df -Pk "$UI_ROOT" | awk 'NR == 2 {print $4}')"
  required_kb=$((build_kb * 2 + STATIC_RELEASE_RESERVE_KB))
  [ "$available_kb" -ge "$required_kb" ] \
    || die "静态发布空间不足：$UI_ROOT 可用 ${available_kb}KiB，完整 release + assets 兼容池至少需 ${required_kb}KiB；未切换 current"
}

write_ci_release_marker() {
  mkdir -p "$CI_DIST_DIR"
  printf '{"commit":"%s","static_release":"%s","manifest":"manifest.sha256"}\n' \
    "$RELEASE_REV" "$UI_RELEASES_DIR/$RELEASE_REV" > "$CI_DIST_DIR/release.json"
  echo "已保留 CI 部署核对文件：frontend/dist/release.json"
}

create_static_release() {
  local release_dir="$UI_RELEASES_DIR/$RELEASE_REV"
  local release_stage="$UI_RELEASES_DIR/.${RELEASE_REV}.$$.tmp"
  local built_at
  if [ -e "$release_dir" ] || [ -L "$release_dir" ]; then
    validate_static_release "$release_dir" \
      || die "已有静态 release $release_dir 不完整或与提交不符；不可覆写历史 release，未切换 current"
    echo "复用不可变静态 release：$release_dir"
    return 0
  fi

  [ ! -e "$release_stage" ] || die "静态 release 临时目录已存在：$release_stage"
  mkdir "$release_stage"
  # Copy before asset-pool publication: release itself is a complete, inspectable
  # build, while /assets is an append-only compatibility pool for old tabs.
  cp -a "$BUILD_PATH/." "$release_stage/"
  [ -z "$(find "$release_stage" -type l -print -quit)" ] \
    || die "构建产物包含符号链接；不能发布到 nginx 静态根目录"
  [ -f "$release_stage/index.html" ] || die "静态 release 缺少 index.html；未切换 current"
  (
    cd "$release_stage"
    find . -type f ! -name manifest.sha256 ! -name release.json -printf '%P\0' \
      | sort -z | xargs -0 -r sha256sum
  ) > "$release_stage/manifest.sha256"
  built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"commit":"%s","built_at":"%s","manifest":"manifest.sha256"}\n' \
    "$RELEASE_REV" "$built_at" > "$release_stage/release.json"
  publish_hashed_assets "$release_stage"
  # Releases must stay readable by nginx but cannot be modified in place.
  find "$release_stage" -type d -exec chmod 0555 {} +
  find "$release_stage" -type f -exec chmod 0444 {} +
  mv "$release_stage" "$release_dir"
  validate_static_release "$release_dir" \
    || die "静态 release 校验失败；未切换 current"
  echo "已创建不可变静态 release：$release_dir（完整提交 SHA + manifest）"
}

switch_current_to_release() {
  local next_link="$UI_ROOT/.current.${RELEASE_REV}.$$"
  local previous_link="$UI_ROOT/.previous.${RELEASE_REV}.$$"
  local old_target
  [ ! -e "$next_link" ] && [ ! -L "$next_link" ] || die "current 临时链接已存在：$next_link"
  [ ! -e "$previous_link" ] && [ ! -L "$previous_link" ] || die "previous 临时链接已存在：$previous_link"
  if [ -L "$UI_CURRENT" ]; then
    old_target="$(readlink "$UI_CURRENT")"
    case "$old_target" in
      releases/*) ;;
      *) die "current 不是受管 releases 相对链接；拒绝覆盖 previous" ;;
    esac
    # Preserve a rollback pointer before changing current. Both names are
    # replaced by same-directory rename, never by an in-place symlink edit.
    ln -s "$old_target" "$previous_link"
    mv -Tf "$previous_link" "$UI_PREVIOUS"
  fi
  ln -s "releases/$RELEASE_REV" "$next_link"
  # Rename within UI_ROOT is atomic: nginx sees either the old complete release
  # or the new complete release, never a partially copied directory.
  mv -Tf "$next_link" "$UI_CURRENT"
  [ "$(readlink "$UI_CURRENT")" = "releases/$RELEASE_REV" ] \
    || die "current 切换校验失败；请人工检查 $UI_CURRENT"
  echo "已原子切换 nginx 静态 current → releases/$RELEASE_REV"
}

RELEASE_REV="$(git rev-parse HEAD)"
BUILD_DIR="dist.release-${RELEASE_REV}-$$"
BUILD_PATH="$ROOT/frontend/$BUILD_DIR"
cleanup_build() { [ ! -d "$BUILD_PATH" ] || rm -rf -- "$BUILD_PATH"; }
trap cleanup_build EXIT
[ ! -e "$BUILD_PATH" ] || die "构建目录已存在，停止发布"
require_static_ui_root
echo "构建前端 → frontend/$BUILD_DIR（旧进程继续对外服务）"
(cd "$ROOT/frontend" && VITE_OUT_DIR="$BUILD_DIR" npm run build)
[ -f "$BUILD_PATH/index.html" ] || die "构建产物没有 index.html，保留原 dist，未重启"
[ "$(git rev-parse HEAD)" = "$RELEASE_REV" ] || die "构建期间提交版本变化，保留原 dist，未重启"
git diff --quiet && git diff --cached --quiet || die "构建期间工作区变化，保留原 dist，未重启"
require_static_release_space
create_static_release
echo "重启 lingong、Outbox、执行 Worker 与 Cron 入队服务"
# 后端、发布器和执行 Worker 都以常驻 Node 进程加载仓库源码。只重启
# lingong 会使 Worker 继续执行旧代码，而新技能清单可能已采用新契约。
sudo -n systemctl restart "${RUNTIME_UNITS[@]}"

for _ in $(seq 1 60); do
  if ! runtime_units_active; then
    sleep 1
    continue
  fi
  # Native production retires legacy version routes. A nonempty HTML/login
  # response is not proof of readiness; require the real PG/engine contract.
  health_body="$(curl -H "Accept-Encoding: identity" -fsS -m 2 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || true)"
  if printf '%s' "$health_body" | node "$ROOT/scripts/check-production-health.mjs"; then
    echo "原生 PostgreSQL 服务已恢复：$health_body"
    record_ontology_release
    switch_current_to_release
    write_ci_release_marker
    exit 0
  fi
  sleep 1
done
die "重启后 60 秒内服务健康探测未就绪；current 未切换，旧 SPA 继续提供；未自动回滚数据库。查看：sudo journalctl -u lingong -n 50"
