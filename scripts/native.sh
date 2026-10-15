#!/usr/bin/env bash
# esbuild 平台二进制安装；PostgreSQL 原生 pg 驱动不需要本地数据库绑定。
# 不启动、编译或回退任何嵌入式数据库。
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
