#!/usr/bin/env bash
# npm 11/12 可能拦 esbuild 的安装脚本；不依赖 lifecycle，必要时直接安装其平台二进制。
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
