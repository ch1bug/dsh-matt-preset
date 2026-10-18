#!/bin/sh
# msys-env.sh —— msys2 会话引导：让 msys 复用 Windows 侧的 git / gh / node 配置。
#
# 为什么需要：msys 的 `HOME` 常常不是 Windows 用户目录（例如厂商工具链把 HOME 指到自己的
# 树下），且默认 PATH 里没有 Windows 的 node/gh —— 于是 msys 里 `gh auth status`、
# `node tests/...` 全部失败，而 Windows 侧一切就绪（gh 已登录 keyring、GCM 管凭据、node 在位）。
#
# 用法（source，不要执行）：  . <repo>/scripts/msys-env.sh
# 想每次自动生效：在 ~/.bashrc 里 source 本文件。
#
# 只**指向**Windows 的配置，不复制、不修改：凭据与登录态留在原处。
# 不覆盖 HOME（改动它会波及 msys 其它工具）——只覆盖 git/gh 的配置位置。
#
# —— 安装根由**输入契约**承载（本仓 PUBLIC：本机路径不进仓）——
# 标准安装根从 Windows 自带的 `%ProgramFiles%` 一族推出（不在仓里写死布局字面量），可用
# `MSYS_ENV_WIN_PROGRAM_FILES` 覆盖；**非标准**安装根（工具链装到自定义目录的那种）必须由
# 使用者显式给出。任何一项缺输入都**响亮说明并跳过那一项**（下面自检逐条报），绝不静默猜一条
# 在自己机器上凑巧存在的路径——换台机器会指到不存在的位置，比没有更坏（口径见本仓 D47）。
#   MSYS_ENV_WIN_PROGRAM_FILES  标准安装根（cygpath 形态，如 `/c/...`）；缺 → 由 `%ProgramFiles%` 一族推
#   MSYS_ENV_WIN_NODE_DIR       Windows node 目录（含 node.exe）；缺 → 用 `<标准根>/nodejs`
#   MSYS_ENV_WIN_GIT_ROOT       Windows git 安装根（其下须有 cmd/ 与 etc/）；缺 → 不指 git 安装面
#
# 用法示例（非标准安装根必须显式给）：
#   MSYS_ENV_WIN_GIT_ROOT='<git-install-dir>' . <repo>/scripts/msys-env.sh

# —— Windows 用户目录（cygpath 由 msys 提供）——
if command -v cygpath >/dev/null 2>&1 && [ -n "$USERPROFILE" ]; then
  WINHOME=$(cygpath -u "$USERPROFILE")
else
  WINHOME=/c/Users/$(whoami)
fi

# —— Windows 标准安装根（可覆盖）——
# 默认值由 Windows 自己导出的环境变量推出——不在仓里写死任何安装布局字面量。
# ⚠ 拼写**只有两条**，且这不是"多写几条更保险"的地方（**实测口径**，2026-10-18）：
#   · `ProgramFiles` 这条**从不成立** —— msys bash 不按该拼写暴露它（实测注入 `ProgramFiles=A`
#     之后，bash 里读 `$ProgramFiles` 仍是 unset，值出现在 **`PROGRAMFILES`** 名下）。
#     POSIX shell 区分大小写，故把它写进候选表是一条**永远不会命中的死项**（本票复核抓到的 J1）。
#   · `PROGRAMFILES` 是 msys 经 Windows API 推出的**实际可读名**，本环境实测**唯一生效**的那条。
#   · `ProgramW6432` 作为后备列出：在只导出它的 Windows 环境里顶上。**本环境实测它顶不上**
#     （msys 把该值映射到 `PROGRAMFILES` 名下），故用例**不声称测过它**（见
#     `tests/verify-msys-env.mjs` M4 的注）—— 留它是为了别的环境，不是为了让断言好看。
#   两者都不成立（非 Windows / 未导出）→ 留空，下面自检**响亮说明**，不猜。
for _pf in "${MSYS_ENV_WIN_PROGRAM_FILES:-}" "${PROGRAMFILES:-}" "${ProgramW6432:-}"; do
  [ -n "$_pf" ] || continue
  if command -v cygpath >/dev/null 2>&1; then
    WIN_PROGRAM_FILES=$(cygpath -u "$_pf" 2>/dev/null) && [ -n "$WIN_PROGRAM_FILES" ] && break
  fi
  WIN_PROGRAM_FILES="$_pf"
  break
done
WIN_PROGRAM_FILES="${WIN_PROGRAM_FILES:-}"
unset _pf

# —— 工具链 PATH ——
# **Windows node 必须优先于 msys 的 ucrt64 node**：ucrt64 node 上报
# platform=win32-x64-gnu，原生件（rolldown / better-sqlite3 等）只发布 -msvc 绑定，
# 用它跑套件会以 0xC06D007F（过程/DLL 找不到）崩在原生依赖上（实测 verify.mjs /
# verify-dual-env.mjs）。gh / Windows git(GCM) 紧随其后，供凭据与登录态复用。
# 先拼前缀再一次 prepend，避免"逐个 prepend 把顺序倒过来"。
# 缺哪件就少拼哪段（下面自检逐个报缺），不阻断整条引导。
PREFIX=""
for d in \
  "${MSYS_ENV_WIN_NODE_DIR:-${WIN_PROGRAM_FILES:+$WIN_PROGRAM_FILES/nodejs}}" \
  "${WIN_PROGRAM_FILES:+$WIN_PROGRAM_FILES/GitHub CLI}" \
  "${MSYS_ENV_WIN_GIT_ROOT:+$MSYS_ENV_WIN_GIT_ROOT/cmd}" \
  "/ucrt64/bin" \
  "$HOME/.corepack/bin"
do
  [ -n "$d" ] && [ -d "$d" ] && PREFIX="$PREFIX$d:"
done
export PATH="$PREFIX$PATH"

# —— 复用 Windows 的 git / gh 配置与凭据 ——
export GIT_CONFIG_GLOBAL="$WINHOME/.gitconfig"
# 系统级 gitconfig 只在**给了安装根**时才指（缺输入 → 不设，git 用自己的默认链）
if [ -n "${MSYS_ENV_WIN_GIT_ROOT:-}" ] && [ -f "${MSYS_ENV_WIN_GIT_ROOT}/etc/gitconfig" ]; then
  export GIT_CONFIG_SYSTEM="${MSYS_ENV_WIN_GIT_ROOT}/etc/gitconfig"
fi
export GH_CONFIG_DIR="$WINHOME/AppData/Roaming/GitHub CLI"

# —— corepack：pnpm shim（PR#63 的 dsh plugin 依赖 PATH 上有 pnpm）——
export COREPACK_HOME="${COREPACK_HOME:-$HOME/.corepack}"

# —— 自检（缺哪个报哪个；不静默）——
for t in node git gh; do
  command -v "$t" >/dev/null 2>&1 || echo "msys-env: 警告：找不到 $t（PATH 可能仍不完整）" >&2
done
# 非标准 git 安装根缺席时**响亮说明**：Windows git 的 GCM 与系统级 gitconfig 这一面未复用
if [ -z "${MSYS_ENV_WIN_GIT_ROOT:-}" ]; then
  echo "msys-env: 未设 MSYS_ENV_WIN_GIT_ROOT —— 未复用 Windows git 的 GCM/系统级 gitconfig（PATH 默认面照常）" >&2
fi
# 标准安装根也推不出来时（既没有覆盖变量、也没有可用的 cygpath/ProgramFiles）**响亮说明**
if [ -z "$WIN_PROGRAM_FILES" ]; then
  echo "msys-env: 推不出 Windows 标准安装根（无 MSYS_ENV_WIN_PROGRAM_FILES、且 cygpath/\$ProgramFiles 不可用）—— 未复用该面" >&2
fi
