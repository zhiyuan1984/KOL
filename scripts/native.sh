#!/usr/bin/env bash
# npm 11/12 会拦依赖的 install 脚本（better-sqlite3 / esbuild）。
# 不依赖 lifecycle：直接跑 prebuild-install / node-gyp / esbuild/install.js。
set -euo pipefail

need_toolchain() {
  echo "需要 gcc-c++ make python3（yum install -y gcc-c++ make python3），然后重跑。" >&2
  return 1
}

approve_pkg() {
  local pkg="$1"
  npm approve-scripts "$pkg" --no-allow-scripts-pin >/dev/null 2>&1 \
    || npm install-scripts approve "$pkg" >/dev/null 2>&1 \
    || npm approve-scripts "$pkg" >/dev/null 2>&1 \
    || true
}

build_better_sqlite3() {
  local dir="$PWD/node_modules/better-sqlite3"
  if [[ ! -d "$dir" ]]; then
    echo "better-sqlite3 未装进 node_modules" >&2
    return 1
  fi
  if node -e "require('better-sqlite3')(':memory:').close()" >/dev/null 2>&1; then
    return 0
  fi
  echo "正在编译 / 拉取 better-sqlite3 原生绑定…"
  approve_pkg better-sqlite3
  npm rebuild better-sqlite3 --ignore-scripts=false --foreground-scripts >/dev/null 2>&1 || true
  (
    cd "$dir"
    npx --yes prebuild-install || npx --yes node-gyp rebuild --release
  ) || true
  if node -e "require('better-sqlite3')(':memory:').close()" >/dev/null 2>&1; then
    return 0
  fi
  echo "better-sqlite3 原生绑定仍不可用。产品会尝试 node:sqlite（仍是 SQLite 文件）。"
  echo "需要 gcc-c++ make python3（yum install -y gcc-c++ make python3），然后重跑。"
  return 0
}

build_esbuild() {
  local dir="$PWD/node_modules/esbuild"
  [[ -d "$dir" ]] || return 0
  if node -e "require('esbuild')" >/dev/null 2>&1; then
    return 0
  fi
  echo "正在安装 esbuild 平台二进制…"
  approve_pkg esbuild
  npm rebuild esbuild --ignore-scripts=false --foreground-scripts >/dev/null 2>&1 || true
  if [[ -f "$dir/install.js" ]]; then
    node "$dir/install.js" || true
  fi
  node -e "require('esbuild')" >/dev/null 2>&1 || need_toolchain
}
