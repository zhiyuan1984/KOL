#!/usr/bin/env bash
# Linux 服务器部署入口：先在旧进程仍在对外服务时构建前端，再重启 systemd 服务。
# 这样重启只花几秒（start.sh 不需要在启动路径里再构建前端），不会出现 60–90 秒的 502。
#
# 用法（服务器上，仓库根目录）：
#   ./scripts/deploy.sh           # 用当前工作区代码部署
#   ./scripts/deploy.sh --sync    # 先 git fetch github && git reset --hard github/main 再部署
# 本机一条命令：
#   ssh ecs-user@47.88.94.205 "cd ~/kol && ./scripts/deploy.sh --sync"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
PORT="${LINGONG_PORT:-8765}"

die() { echo "$*" >&2; exit 1; }

if [ "${1:-}" = "--sync" ] && [ -z "${DEPLOY_RESYNCED:-}" ]; then
  # reset 可能替换本脚本本身，而 bash 不能安全地边改边读同一个脚本，所以重新执行新版本。
  git fetch github
  git reset --hard github/main
  export DEPLOY_RESYNCED=1
  [ -f "$SELF" ] || die "reset 后 $SELF 不存在：github/main 里缺少 scripts/deploy.sh"
  exec "$SELF" --sync
fi

command -v node >/dev/null 2>&1 || die "缺少 node"
command -v npm >/dev/null 2>&1 || die "缺少 npm"
[ -f "$ROOT/frontend/package.json" ] || die "未找到 frontend/，请从仓库根目录运行 scripts/deploy.sh"

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

echo "构建前端 → frontend/dist.new（旧进程继续对外服务）"
rm -rf "$ROOT/frontend/dist.new"
(cd "$ROOT/frontend" && VITE_OUT_DIR=dist.new npm run build)
[ -f "$ROOT/frontend/dist.new/index.html" ] || die "构建产物没有 index.html，保留原 dist，未重启"

if [ -d "$ROOT/frontend/dist" ]; then
  rm -rf "$ROOT/frontend/dist.prev"
  mv "$ROOT/frontend/dist" "$ROOT/frontend/dist.prev"
fi
mv "$ROOT/frontend/dist.new" "$ROOT/frontend/dist"
echo "dist 已替换（上一版在 frontend/dist.prev；回滚：mv frontend/dist.prev frontend/dist && sudo systemctl restart lingong）"

echo "重启 lingong.service"
sudo -n systemctl restart lingong

for _ in $(seq 1 60); do
  body="$(curl -fsS -m 2 "http://127.0.0.1:${PORT}/api/version" 2>/dev/null || true)"
  if [ -n "$body" ]; then
    echo "服务已恢复：$body"
    exit 0
  fi
  sleep 1
done
die "重启后 60 秒内 http://127.0.0.1:${PORT}/api/version 仍未就绪，查看：sudo journalctl -u lingong -n 50"
