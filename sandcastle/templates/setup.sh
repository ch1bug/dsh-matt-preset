#!/usr/bin/env bash
# setup.sh —— 消费者宿主侧 setup 入口（#43 新增；票面 AC①）：bash/gcc 工具链自检 +
# 可行动报错 + 非 0 退出（fail-fast）。消费者把自己的 setup 步骤接在本文件末尾的
# 「消费者步骤」段——模板只管工具链这一格，不预置任何具体步骤（票面 out of scope：
# 只做 bash/gcc 这条已实测的漂移面，不扩成通用环境体检）。
#
# 判据与 tests/sandcastle-e2e.mjs 的 findBash()（#30 修复先例）及 night-run.mts 的
# bashToolchainProblem 同源：gcc 直达（command -v gcc）或 msys2 标准位
# /ucrt64/bin/gcc.exe 存在。防的漂移形态（Windows 宿主实测，#18/#30）：
#   - PATH bash 解析到 C:\Windows\System32\bash.exe（WSL）：无 msys /c 路径映射，
#     Windows 路径与工具链全部不可见；
#   - Git Bash：bash 可用但 gcc 缺（gh shim 编译等会以含糊的编译失败呈现）。
#
# 离线测试钩子（tests/verify-sandcastle-bash-probe.mjs 注入）：TOOLCHAIN_UNAME_S /
# TOOLCHAIN_UNAME_R 覆盖 uname 读数、TOOLCHAIN_GCC=1/0 强制 gcc 可达/不可达读数；
# 生产路径不设这些变量，走真实 uname / gcc 探针。
#
# 退出码：0=自检通过（继续跑消费者步骤）  1=工具链自检失败（可行动错误，绝不带病继续）
set -u

die() {
  printf '✗ %s\n' "$1" >&2
  exit "${2:-1}"
}

# ── 第①关：uname 形态（bash 直达性；票面 AC①「不得解析到 WSL 的 System32\bash.exe」）──
UNAME_S="${TOOLCHAIN_UNAME_S:-$(uname -s)}"
UNAME_R="${TOOLCHAIN_UNAME_R:-$(uname -r 2>/dev/null || true)}"
case "$UNAME_S" in
  MINGW*|MSYS*)
    # msys 形态：再核一层 bash 解析——System32 的 bash.exe 是 WSL 启动器，混进
    # PATH 前排时「bash 可达」是假的。
    BASH_PATH="$(command -v bash || true)"
    case "$BASH_PATH" in
      *system32*|*System32*|*SYSTEM32*)
        die "bash 工具链自检失败：command -v bash 解析到 System32 的 bash.exe（$BASH_PATH，WSL 启动器）。
  修复方式之一：把 Git for Windows / msys2 的 usr/bin 前置到 PATH 后重跑。" 1 ;;
      *) : ;;
    esac ;;
  Linux)
    # uname=Linux 有两种：WSL（内核版本串含 microsoft，无 msys /c 映射——正是要抓的
    # 漂移形态）与原生 Linux 宿主（uname 关天然过）。
    case "$UNAME_R" in
      *microsoft*|*Microsoft*|*MICROSOFT*)
        die "bash 工具链自检失败：当前 bash 是 WSL bash（uname -r = $UNAME_R），无 msys /c 路径映射。
  修复方式之一：改用 Git for Windows / msys2 的 bash（把其 usr/bin 前置到 PATH），
  或安装 msys2（https://www.msys2.org）。" 1 ;;
      *) : ;;
    esac ;;
  Darwin) : ;;
  '')
    die "bash 工具链自检失败：uname 不可用（无法判定宿主形态）。
  修复方式之一：确认在 Git Bash / msys2 / 原生 unix shell 里运行本脚本。" 1 ;;
  *)
    die "bash 工具链自检失败：无法识别的 uname -s = $UNAME_S。
  修复方式之一：在 Git Bash / msys2 / 原生 unix shell 里运行本脚本。" 1 ;;
esac

# ── 第②关：gcc 可达（判据串与 e2e findBash()/night-run bashToolchainProblem 逐字同源，
#    tests/verify-sandcastle-bash-probe.mjs 双向钉住防漂移）──
# TOOLCHAIN_GCC 是离线测试注入钩子（同 UNAME 覆盖）：设为 1/0 强制可达/不可达读数；
# 未设（生产路径）走真探针。
gcc_reachable() {
  if [ -n "${TOOLCHAIN_GCC+x}" ]; then
    [ "$TOOLCHAIN_GCC" = "1" ]
    return
  fi
  command -v gcc >/dev/null 2>&1 || test -x /ucrt64/bin/gcc.exe
}
if gcc_reachable; then
  : # gcc 可达，过
else
  die "bash 工具链自检失败：gcc 不可达（PATH 上没有 gcc，msys2 标准位 /ucrt64/bin/gcc.exe 也不存在）。
  修复方式之一：安装 msys2（https://www.msys2.org）并 \`pacman -S mingw-w64-ucrt-x86_64-gcc\`，
  或把 msys2 的 usr/bin 与 ucrt64/bin 前置到 PATH 后重跑。" 1
fi

printf '✓ bash 工具链自检通过（uname -s = %s，gcc 可达）\n' "$UNAME_S"

# ── 消费者步骤（自检通过后执行；模板不预置任何具体步骤，按项目需要接在这里）──
# 常见形态（参照 tests/sandcastle-e2e.mjs 搭台脚手架）：git init / gh shim 编译等。
