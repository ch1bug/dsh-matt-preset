#!/usr/bin/env bash
# build-image.sh —— 模板镜像的构建包装器（#34 的 Q2 口径：版本经 ARG 注入，派生规则单一实现）。
#
# 做两件事：
#   1. 用 `scripts/runtime-anchor.mjs`（宿主锚派生规则的**唯一实现**）从本包 `package.json`
#      的 version 推出锚（`0.2.1-rc.2-r1` → `0.2.1-rc.2`）——**本脚本不另写一份派生逻辑**；
#   2. `podman build --build-arg DSH_VERSION=<那个锚> …`。
#
# `--print-version` 只打印派生锚、不建镜像：complete-check.sh 用它核对「镜像里真装的版本」，
# 于是「从 Dockerfile 里 sed 钉版」这条**第二份解析逻辑**没有存在的必要（D6）。
#
# 为什么 Dockerfile 仍带默认值：模板必须能**裸 `podman build`**（消费者树里没有本仓的
# `scripts/`）。默认值与派生锚的一致性由 `tests/verify-sandcastle-pins.mjs` 钉住；重锚时
# 它会把「忘了改 Dockerfile 默认值」变成红灯，而不是安静的旧版本。
#
# 消费者树的边界（`sandcastle/` 被拷进项目 `.sandcastle/` 的形态）：拿不到本仓
# `scripts/runtime-anchor.mjs` 时本脚本**响亮失败**并给出显式用法，绝不猜一个版本。
#
# 用法：
#   bash build-image.sh [选项] [-- <额外 podman build 参数>]
#     --image <tag>        镜像名（默认 localhost/sandcastle-dsh:dsh）
#     --dockerfile <path>  默认本脚本同目录的 Dockerfile
#     --context <dir>      build 上下文（默认 Dockerfile 所在目录）
#     --network <mode>     podman 网络模式（默认 host；Windows+TUN 宿主下必需，见 complete-check.sh）
#     --print-version      只打印派生锚（不建镜像）
#     -h | --help
#
# 退出码：0=成功  2=用法错  3=派生锚拿不到（消费者树 / package.json 形态不符）  4=构建失败
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
IMAGE="localhost/sandcastle-dsh:dsh"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
CONTEXT=""
NETWORK="host"
PRINT_VERSION=0
EXTRA_ARGS=()

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit "${2:-2}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="${2:?--image 需要值}"; shift 2 ;;
    --dockerfile) DOCKERFILE="${2:?--dockerfile 需要值}"; shift 2 ;;
    --context) CONTEXT="${2:?--context 需要值}"; shift 2 ;;
    --network) NETWORK="${2:?--network 需要值}"; shift 2 ;;
    --print-version) PRINT_VERSION=1; shift ;;
    --) shift; EXTRA_ARGS=("$@"); break ;;
    -h|--help) sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数：$1（--help 看用法）" 64 ;;
  esac
done

# ── 派生锚：唯一实现 = scripts/runtime-anchor.mjs（消费者树里不存在 → 响亮失败，绝不猜）──
DERIVE="$SCRIPT_DIR/../../scripts/runtime-anchor.mjs"
[ -f "$DERIVE" ] || die "拿不到派生规则的唯一实现：$DERIVE
  消费者树（sandcastle/ 被拷进项目 .sandcastle/）没有本仓 scripts/ —— 请显式给版本：
  podman build --build-arg DSH_VERSION=<宿主锚> -f $DOCKERFILE -t $IMAGE ${CONTEXT:-$SCRIPT_DIR}" 3
command -v node >/dev/null 2>&1 || die "node 不在 PATH 上（派生锚要用 node 跑 $DERIVE）" 3
DSH_VERSION="$(node "$DERIVE" 2>&1)" || die "派生锚失败：$DSH_VERSION" 3
case "$DSH_VERSION" in
  *[!0-9A-Za-z.\-]*) die "派生锚形态可疑（含空白/异常字符）：$DSH_VERSION" 3 ;;
  '') die "派生锚为空" 3 ;;
esac
[ "$PRINT_VERSION" = "1" ] && { say "$DSH_VERSION"; exit 0; }

[ -f "$DOCKERFILE" ] || die "Dockerfile 不存在：$DOCKERFILE" 64
BUILD_CONTEXT="${CONTEXT:-$(cd -- "$(dirname -- "$DOCKERFILE")" && pwd)}"

say "… podman build --build-arg DSH_VERSION=$DSH_VERSION（image=$IMAGE，context=$BUILD_CONTEXT，network=$NETWORK）"
podman build --network "$NETWORK" --build-arg DSH_VERSION="$DSH_VERSION" \
  ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} -f "$DOCKERFILE" -t "$IMAGE" "$BUILD_CONTEXT" || die "镜像构建失败" 4
say "✓ 镜像：$IMAGE（dsh $DSH_VERSION）"