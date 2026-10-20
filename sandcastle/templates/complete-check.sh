#!/usr/bin/env bash
# complete-check.sh —— 容器 COMPLETE 冒烟（#34 第 1 项，源自 #18 批末遗留；Q1 口径 = 本仓自建）。
#
# 证明的事（一条链，缺一不可）：
#   ① 模板 Dockerfile 能建出镜像（`build-image.sh` 用派生锚注入 `--build-arg DSH_VERSION`）；
#   ② 容器内 `dsh --profile headless "<task>"` 能**真的跑完一轮**并给出
#      `<promise>COMPLETE</promise>` —— 即 run-ticket 的 worker 形态在镜像里活着。
#
# ② 的**非空洞**设计（重要）：任务文本里只给两个随机因数，要求模型把**乘积**写进输出，收尾才是
#   completion 标记。断言同时要求「乘积出现」+「标记出现」⇒ 把 prompt 回显 / 模型复述指令统统排除
#   （只回显 prompt 拿不到乘积）。**不校验位置**（整段输出里出现即可）；因数取三位数，乘积落在
#   五到六位数，降低与 harness 自身数字（token 计数/耗时/行号）撞车的概率。
#   用 `--task` 自定义任务时该证伪自动失效，脚本会**响亮声明**它只断言 COMPLETE 契约。
#
# 硬约束（票面 AC②，违反即事故）：**只用现成的 podman machine**。
#   - 本脚本绝不 `podman machine init/set/stop/rm`，绝不 `podman system prune`，
#     绝不停/删别人的容器或镜像（本机 machine 是共享 WSL VM，内有另一项目数据库）。
#   - 自己的容器用带 PID 的唯一名 + `--rm`，跑完即消失；
#   - **前后各取一次快照**（容器名集合 + machine 列表）做**定向**比对：machine 列表必须不变、
#     冒烟前在场的容器必须**全部仍在**、自己的容器必须已消失。它证明「我们没删/没停别人的东西」，
#     不证明「别人没动」；窗口内他人**新建**的容器不计入。共享 machine 上若有人正在启停容器，
#     仍可能误报 —— 宁可报、不静默（这条边界是有意的，别读成"完全无误判"）。
#   - machine 没起时**只报告**，不代劳启动（启动是宿主侧决定）。
#
# 用法：
#   bash sandcastle/templates/complete-check.sh [选项]
#     --image <tag>       镜像名（默认 localhost/sandcastle-dsh:dsh）
#     --dockerfile <path> 默认本脚本同目录的 Dockerfile
#     --context <dir>     build 上下文（默认 Dockerfile 所在目录）
#     --no-build          镜像不存在时直接失败，不建（离线/复用场景）
#     --task <text>       容器内 headless 的任务文本（给了就关掉乘积证伪，见上）
#     --timeout <sec>     podman run 的墙钟上限（默认 600）
#     --dsh-home <dir>    宿主 DSH_HOME（默认 $DSH_HOME，缺省 $HOME/.dsh）
#     --network <mode>    构建与运行共用的 podman 网络模式（默认 host，见下）
#     --user <uid:gid>    容器内执行身份（默认 1000:1000，对齐 Dockerfile 里的 agent）
#     --expect-version <v> 版本期望值（消费者树拿不到派生锚时用它补版本核对；本仓内默认取派生锚）
#     --env KEY[=VALUE]   透传一个环境变量进容器（可重复；只写 KEY 时从启动环境取值）
#     -h | --help
#
# 凭据（实测 2026-10-20，#34）：**光拷 `.credentials.yaml` 不够** —— 容器里新引导的 headless
#   profile 仍报 `MISSING_CREDENTIAL`；把 `DEEPSEEK_API_KEY` 从启动环境透传进去就过。
#   因此本脚本**自动**透传启动环境里的 `DEEPSEEK_API_KEY`（有就透传），并允许 `--env` 追加。
#   两条路都留着：文件拷贝是 run-ticket 的现行形态，env 是本机实测可用的一条。
#
# --network 为什么默认 host：Windows 宿主 + TUN 代理（fake-IP）环境实测（2026-10-20）——
#   容器**自有 netns** 里 DNS 拿到的 fake-IP 路由不通（TCP 全超时），而 VM netns（host 模式）
#   出网正常。生产/无代理宿主可传 `--network podman` 用默认隔离网络。
#
# 为什么用 `--user` 而不是 `--userns=keep-id`：rootful machine 上 `keep-id` 与 `--network host`
#   同时用会 `crun: mount sysfs … Operation not permitted`（2026-10-20 三态实测：host+keep-id 失败，
#   其余两种成立）。`--user 1000:1000` 在 rootless/rootful 两种 machine 上都能拿到 worker 身份。
#
# 退出码：0=COMPLETE 已观测到且乘积在场  2=环境前置不满足（podman/machine/镜像/凭据）
#         3=镜像构建失败  4=运行失败 / 未观测到 COMPLETE / 乘积不在场 / 快照前后不一致
#         5=镜像内 dsh 版本 != 派生锚  64=用法错
set -u

IMAGE="localhost/sandcastle-dsh:dsh"
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
CONTEXT=""
NO_BUILD=0
CUSTOM_TASK=0
TIMEOUT=600
DSH_HOME_HOST="${DSH_HOME:-$HOME/.dsh}"
NETWORK="host"
USER_SPEC="1000:1000"
EXPECT_VERSION=""
ENV_ARGS=()

# 默认任务：随机因数 → 乘积（证伪 prompt 回显）+ completion 标记（worker 契约）。
# 因数取三位数：乘积落在五到六位数，降低与 harness 自身数字（token/耗时/行号）撞车的概率。
A=$(( (RANDOM % 800) + 100 ))
B=$(( (RANDOM % 800) + 100 ))
EXPECT=$(( A * B ))
TASK="只回复两行：第一行只写算式 ${A} × ${B} 的结果（一个数字，不要别的内容），第二行写 <promise>COMPLETE</promise>"

say() { printf '%s\n' "$*"; }
# 消息取 $1、退出码取 $2（**必须显式传**）：用 `$*` 会把退出码拼进正文，默认值又会变成死码。
die() {
  printf '✗ %s\n' "$1" >&2
  exit "${2:?die 需要显式退出码}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="${2:?--image 需要值}"; shift 2 ;;
    --dockerfile) DOCKERFILE="${2:?--dockerfile 需要值}"; shift 2 ;;
    --context) CONTEXT="${2:?--context 需要值}"; shift 2 ;;
    --no-build) NO_BUILD=1; shift ;;
    --task) TASK="${2:?--task 需要值}"; CUSTOM_TASK=1; shift 2 ;;
    --timeout) TIMEOUT="${2:?--timeout 需要值}"; shift 2 ;;
    --dsh-home) DSH_HOME_HOST="${2:?--dsh-home 需要值}"; shift 2 ;;
    --network) NETWORK="${2:?--network 需要值}"; shift 2 ;;
    --user) USER_SPEC="${2:?--user 需要值}"; shift 2 ;;
    --expect-version) EXPECT_VERSION="${2:?--expect-version 需要值}"; shift 2 ;;
    --env) ENV_ARGS+=(-e "${2:?--env 需要值}"); shift 2 ;;
    -h|--help) sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数：$1（--help 看用法）" 64 ;;
  esac
done

[ -f "$DOCKERFILE" ] || die "Dockerfile 不存在：$DOCKERFILE" 64
[ -d "$DSH_HOME_HOST" ] || die "宿主 DSH_HOME 不是目录：$DSH_HOME_HOST" 2
if [ -f "$DSH_HOME_HOST/.credentials.yaml" ]; then
  say "✓ 凭据文件：$DSH_HOME_HOST/.credentials.yaml（只读挂入，容器内拷进 ~/.dsh）"
else
  [ -n "${DEEPSEEK_API_KEY:-}" ] || die "既无 $DSH_HOME_HOST/.credentials.yaml，启动环境也没有 DEEPSEEK_API_KEY —— 容器内 headless 无凭据" 2
fi
# 环境变量通道（实测比文件拷贝可靠，见头注）：启动环境有 DEEPSEEK_API_KEY 就透传
if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  ENV_ARGS+=(-e DEEPSEEK_API_KEY)
  say "✓ 凭据：透传启动环境的 DEEPSEEK_API_KEY（长度 ${#DEEPSEEK_API_KEY}）"
fi

command -v podman >/dev/null 2>&1 || die "podman 不在 PATH 上" 2

# ── 快照（前后各一次）：让「没碰别人的容器/machine」成为**定向**可判读数 ──────
before_containers() { podman ps -a --format '{{.Names}}' 2>/dev/null | sort; }
machine_list() { podman machine list --format '{{.Name}}|{{.Running}}' 2>/dev/null | sort; }
BEFORE_CONTAINERS="$(before_containers)"
BEFORE_MACHINES="$(machine_list)"
BEFORE_CONTAINER_COUNT="$(printf '%s' "$BEFORE_CONTAINERS" | grep -c . || true)"

# ── ① machine 形态：只读探测，绝不改动 ──────────────────────────────────────
MACHINES="$(podman machine list --format '{{.Name}}|{{.Running}}' 2>&1)" || die "podman machine list 失败：$MACHINES" 2
RUNNING="$(printf '%s\n' "$MACHINES" | awk -F'|' '$2 == "true" { print $1; exit }')"
if [ -z "$RUNNING" ]; then
  die "没有正在运行的 podman machine（读到的：$(printf '%s' "$MACHINES" | tr '\n' ' '))。
  本脚本**不创建/不启动/不重建** machine（票面 AC②：不得触碰共享 WSL 容器）。
  需要 machine 时由宿主侧自行决定：podman machine start <name>" 2
fi
say "✓ podman machine：$RUNNING（复用现有实例，未做任何变更）"
say "✓ 现有容器：${BEFORE_CONTAINER_COUNT} 个（本次冒烟自己的容器跑完即 --rm 消失）"

# ── ② 派生锚（版本核对用；消费者树拿不到就响亮跳过，或用 --expect-version 显式给）──
PINNED=""
if [ -f "$SCRIPT_DIR/build-image.sh" ] && PINNED="$(bash "$SCRIPT_DIR/build-image.sh" --print-version 2>/dev/null)"; then
  say "✓ 派生锚（build-image.sh --print-version，规则唯一实现 scripts/runtime-anchor.mjs）：$PINNED"
elif [ -n "$EXPECT_VERSION" ]; then
  PINNED="$EXPECT_VERSION"
  say "✓ 版本期望值（--expect-version）：$PINNED"
else
  PINNED=""
  say "! 拿不到派生锚（消费者树？）—— 跳过「镜像内版本 == 期望」的核对；可传 --expect-version <锚> 补上"
fi

BUILD_CONTEXT="${CONTEXT:-$(cd -- "$(dirname -- "$DOCKERFILE")" && pwd)}"

# ── ③ 镜像：有就复用，没有才建（--no-build 时不建） ──────────────────────────
if podman image exists "$IMAGE"; then
  say "✓ 复用镜像：$IMAGE"
else
  if [ "$NO_BUILD" = "1" ]; then
    die "镜像不存在且指定了 --no-build：$IMAGE" 2
  fi
  START_TS=$SECONDS
  if [ -f "$SCRIPT_DIR/build-image.sh" ] \
     && bash "$SCRIPT_DIR/build-image.sh" --image "$IMAGE" --dockerfile "$DOCKERFILE" --context "$BUILD_CONTEXT" --network "$NETWORK"; then
    say "✓ 镜像构建完成（$((SECONDS - START_TS))s）"
  else
    # 消费者树（没有本仓 scripts/runtime-anchor.mjs）拿不到派生锚 → 回退为「用 Dockerfile 的
    # ARG 默认值直接构建」：这样冒烟在消费者项目里仍然可用；版本核对请配 --expect-version。
    say "! 构建包装器不可用（消费者树 / 派生锚拿不到）—— 回退为用 Dockerfile 的 ARG 默认值直接构建"
    say "! 版本核对请传 --expect-version <宿主锚>，或显式 podman build --build-arg DSH_VERSION=<锚>"
    podman build --network "$NETWORK" -f "$DOCKERFILE" -t "$IMAGE" "$BUILD_CONTEXT" || die "镜像构建失败" 3
    say "✓ 镜像构建完成（$((SECONDS - START_TS))s，用 Dockerfile 默认 ARG）"
  fi
fi

# ── ④ 容器内跑 headless，断言乘积 + COMPLETE ───────────────────────────────
read -r -d '' INNER <<'EOS'
set -u
mkdir -p "$HOME/.dsh"
for f in .credentials.yaml settings.yaml; do
  if [ -f "/host-dsh/$f" ]; then cp "/host-dsh/$f" "$HOME/.dsh/$f"; fi
done
chmod 600 "$HOME/.dsh/.credentials.yaml" 2>/dev/null || true
echo "dsh-version: $(dsh --version 2>&1 | head -n 1)"
dsh --profile headless "$1"
EOS

CONTAINER="sandcastle-complete-check-$$"
say "… 容器内 headless 冒烟（${TIMEOUT}s 上限，容器名 $CONTAINER）"
if [ "$CUSTOM_TASK" = "1" ]; then
  say "! 用了 --task 自定义任务：乘积证伪失效 —— 本次**只**断言 <promise>COMPLETE</promise> 契约"
else
  say "… 证伪输入：${A} × ${B} = ${EXPECT}（prompt 里只有因数，乘积必须由模型算出来；只回显 prompt 拿不到它）"
fi
# 墙钟守卫：有 coreutils timeout 就用；没有就退化为不设上限（并响亮提示）
if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD=(timeout "$TIMEOUT"); else
  TIMEOUT_CMD=(); say "! 本机没有 timeout 命令 —— 容器无墙钟上限（${TIMEOUT}s 设置被忽略）"
fi
START_TS=$SECONDS
OUT="$(${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} podman run --rm --name "$CONTAINER" --network "$NETWORK" --user "$USER_SPEC" \
        ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} \
        -v "$DSH_HOME_HOST:/host-dsh:ro" \
        "$IMAGE" bash -c "$INNER" complete-check "$TASK" 2>&1)"
RC=$?
ELAPSED=$((SECONDS - START_TS))
printf '%s\n' "$OUT" | tail -n 40

[ "$RC" -eq 0 ] || die "容器运行失败（exit $RC，${ELAPSED}s）；上方为输出尾部" 4

# ── ⑤ 快照复核（定向）：machine 列表不变 + 冒烟前的容器全部仍在 + 自己的容器已消失 ──
# 只证「我们没删/没停别人的东西」，不证「别人没动」；窗口内他人新建的容器不计入。
AFTER_CONTAINERS="$(before_containers)"
AFTER_MACHINES="$(machine_list)"
SNAPSHOT_PROBLEMS=""
[ "$BEFORE_MACHINES" = "$AFTER_MACHINES" ] || SNAPSHOT_PROBLEMS="${SNAPSHOT_PROBLEMS}
- machine 列表变了：前=$(printf '%s' "$BEFORE_MACHINES" | tr '\n' ' ') 后=$(printf '%s' "$AFTER_MACHINES" | tr '\n' ' ')"
if printf '%s\n' "$AFTER_CONTAINERS" | grep -qx "$CONTAINER"; then
  SNAPSHOT_PROBLEMS="${SNAPSHOT_PROBLEMS}
- 本次冒烟的容器没有消失：$CONTAINER"
fi
while IFS= read -r name; do
  [ -n "$name" ] || continue
  printf '%s\n' "$AFTER_CONTAINERS" | grep -qx "$name" || SNAPSHOT_PROBLEMS="${SNAPSHOT_PROBLEMS}
- 冒烟前存在的容器不见了：$name"
done <<EOF3
$BEFORE_CONTAINERS
EOF3
if [ -z "$SNAPSHOT_PROBLEMS" ]; then
  say "✓ 快照（定向）：machine 未变；冒烟前 ${BEFORE_CONTAINER_COUNT} 个容器全部仍在；本次容器已 --rm 消失"
else
  printf '%s\n' "$SNAPSHOT_PROBLEMS" >&2
  die "容器/machine 快照在本次冒烟前后发生了变化（见上）—— 我们不该动别人的容器；若确系他人并发操作，重跑一次" 4
fi

# ── ⑥ 版本核对（有期望值才做；精确相等，不用前缀通配）──────────────────────
GOT="$(printf '%s\n' "$OUT" | sed -n 's/^dsh-version: *//p' | head -n 1 | tr -d '[:space:]')"
if [ -z "$PINNED" ]; then
  say "! 镜像内 dsh 版本：${GOT:-未读到}（无期望值，未核对）"
elif [ "$GOT" = "$PINNED" ]; then
  say "✓ 镜像内 dsh 版本 == 期望：$GOT"
else
  # 换镜像不会被自动重建：镜像存在即复用，必须显式 podman rmi（或换 --image tag）。
  die "镜像内 dsh 版本与期望不一致：容器=$GOT 期望=$PINNED —— 镜像陈旧？先 podman rmi $IMAGE 再重跑（或换 --image tag）" 5
fi

# ── ⑦ 断言：乘积在场（证伪回显）+ COMPLETE 契约 ────────────────────────────
if [ "$CUSTOM_TASK" = "0" ]; then
  if printf '%s\n' "$OUT" | grep -qE "(^|[^0-9])${EXPECT}([^0-9]|$)"; then
    say "✓ 观测到乘积 ${EXPECT}（证明模型真跑了一轮，不是 prompt 回显）"
  else
    die "未观测到乘积 ${EXPECT} —— 容器里那一轮没有真的跑起来（或输出格式异常）；上方为输出尾部" 4
  fi
fi

if printf '%s\n' "$OUT" | grep -q '<promise>COMPLETE</promise>'; then
  say "✓ 观测到 <promise>COMPLETE</promise>（${ELAPSED}s）"
else
  cat >&2 <<EOF2
✗ 未观测到 <promise>COMPLETE</promise>（${ELAPSED}s）。
  常见原因：容器内 ~/.dsh 无可用模型/凭据；镜像里的 dsh 与宿主 settings 不匹配。
  重跑取全量输出：bash $0 --image $IMAGE
EOF2
  exit 4
fi

say "=== COMPLETE-CHECK 通过：$IMAGE（dsh ${PINNED:-未核对}）==="