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

RELEASE_REV="$(git rev-parse HEAD)"
BUILD_DIR="dist.release-${RELEASE_REV:0:12}-$$"
BUILD_PATH="$ROOT/frontend/$BUILD_DIR"
cleanup_build() { [ ! -d "$BUILD_PATH" ] || rm -rf -- "$BUILD_PATH"; }
trap cleanup_build EXIT
[ ! -e "$BUILD_PATH" ] || die "构建目录已存在，停止发布"
echo "构建前端 → frontend/$BUILD_DIR（旧进程继续对外服务）"
(cd "$ROOT/frontend" && VITE_OUT_DIR="$BUILD_DIR" npm run build)
[ -f "$BUILD_PATH/index.html" ] || die "构建产物没有 index.html，保留原 dist，未重启"
[ "$(git rev-parse HEAD)" = "$RELEASE_REV" ] || die "构建期间提交版本变化，保留原 dist，未重启"
git diff --quiet && git diff --cached --quiet || die "构建期间工作区变化，保留原 dist，未重启"
printf '{"commit":"%s","build_dir":"%s"}\n' "$RELEASE_REV" "$BUILD_DIR" > "$BUILD_PATH/release.json"
if [ -d "$ROOT/frontend/dist" ]; then
  rm -rf "$ROOT/frontend/dist.prev"
  mv "$ROOT/frontend/dist" "$ROOT/frontend/dist.prev"
fi
mv "$BUILD_PATH" "$ROOT/frontend/dist"
echo "dist 已替换（上一版在 frontend/dist.prev；release.json绑定完整提交）"
echo "重启 lingong、Outbox、执行 Worker 与 Cron 入队服务"
# 后端、发布器和执行 Worker 都以常驻 Node 进程加载仓库源码。只重启
# lingong 会使 Worker 继续执行旧代码，而新技能清单可能已采用新契约。
sudo -n systemctl restart "${RUNTIME_UNITS[@]}"

for _ in $(seq 1 60); do
  if ! runtime_units_active; then
    sleep 1
    continue
  fi
  version_body="$(curl -fsS -m 2 "http://127.0.0.1:${PORT}/api/version" 2>/dev/null || true)"
  if [ -n "$version_body" ]; then
    echo "服务已恢复：$version_body"
    record_ontology_release
    exit 0
  fi
  # The PostgreSQL-only surface intentionally retires /api/version together
  # with legacy routes. Its explicit authority health contract is the release
  # proof in that mode; do not report a healthy formal service as a timeout.
  health_body="$(curl -fsS -m 2 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || true)"
  if printf '%s' "$health_body" | grep -q '"runtime_mode":"postgres-only"' \
    && printf '%s' "$health_body" | grep -q '"authority_store":"postgresql"'; then
    echo "PostgreSQL-only 服务已恢复：$health_body"
    record_ontology_release
    exit 0
  fi
  sleep 1
done
die "重启后 60 秒内服务健康探测未就绪，查看：sudo journalctl -u lingong -n 50"
