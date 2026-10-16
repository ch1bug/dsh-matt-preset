#!/bin/sh
# msys-env.sh —— msys2 会话引导：让 msys 复用 Windows 侧的 git / gh / node 配置。
#
# 为什么需要：msys 的 `HOME=/c/Cadence/SPB_Data`（非用户目录），且默认 PATH 里没有
# Windows 的 node/gh —— 于是 msys 里 `gh auth status`、`node tests/...` 全部失败，
# 而 Windows 侧一切就绪（gh 已登录 keyring、GCM 管凭据、node 24 在位）。
#
# 用法（source，不要执行）：  . <repo>/scripts/msys-env.sh
# 想每次自动生效：在 ~/.bashrc 里 source 本文件。
#
# 只**指向**Windows 的配置，不复制、不修改：凭据与登录态留在原处。
# 不覆盖 HOME（改动它会波及 msys 其它工具）——只覆盖 git/gh 的配置位置。

# —— Windows 用户目录（cygpath 由 msys 提供）——
if command -v cygpath >/dev/null 2>&1 && [ -n "$USERPROFILE" ]; then
  WINHOME=$(cygpath -u "$USERPROFILE")
else
  WINHOME=/c/Users/$(whoami)
fi

# —— 工具链 PATH ——
# **Windows node 必须优先于 msys 的 ucrt64 node**：ucrt64 node 上报
# platform=win32-x64-gnu，原生件（rolldown / better-sqlite3 等）只发布 -msvc 绑定，
# 用它跑套件会以 0xC06D007F（过程/DLL 找不到）崩在原生依赖上（实测 verify.mjs /
# verify-dual-env.mjs）。gh / Windows git(GCM) 紧随其后，供凭据与登录态复用。
# 先拼前缀再一次 prepend，避免"逐个 prepend 把顺序倒过来"。
PREFIX=""
for d in \
  "/c/Program Files/nodejs" \
  "/c/Program Files/GitHub CLI" \
  "/c/Other_Program_Files/Git/cmd" \
  "/ucrt64/bin" \
  "$HOME/.corepack/bin"
do
  [ -d "$d" ] && PREFIX="$PREFIX$d:"
done
export PATH="$PREFIX$PATH"

# —— 复用 Windows 的 git / gh 配置与凭据 ——
export GIT_CONFIG_GLOBAL="$WINHOME/.gitconfig"
[ -f /c/Other_Program_Files/Git/etc/gitconfig ] && export GIT_CONFIG_SYSTEM=/c/Other_Program_Files/Git/etc/gitconfig
export GH_CONFIG_DIR="$WINHOME/AppData/Roaming/GitHub CLI"

# —— corepack：pnpm shim（PR#63 的 dsh plugin 依赖 PATH 上有 pnpm）——
export COREPACK_HOME="${COREPACK_HOME:-$HOME/.corepack}"

# —— 自检（缺哪个报哪个；不静默）——
for t in node git gh; do
  command -v "$t" >/dev/null 2>&1 || echo "msys-env: 警告：找不到 $t（PATH 可能仍不完整）" >&2
done