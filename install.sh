#!/usr/bin/env bash
# dsh-matt-preset 一键安装。
#
# dsh 没有内置的 preset 安装命令（dsh plugin 只管 npm 插件）；preset 的官方安装位
# 就是 $DSH_HOME/.agent-presets/<id>/ —— 放进去 dsh 启动时自动发现（user trust）。
# 本脚本做的正是这件事：clone 仓库到安装位 + 装 scheduled-jobs 的 cron-parser 依赖。
set -euo pipefail

REPO_URL="${DSH_MATT_PRESET_URL:-https://github.com/ch1bug/dsh-matt-preset.git}"
HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
TARGET="$HOME_DIR/.agent-presets/dsh-matt-preset"

if [ -e "$TARGET" ]; then
  echo "已存在: $TARGET —— 不覆盖。要更新请先删除，或 cd 进去 git pull。" >&2
  exit 1
fi

mkdir -p "$HOME_DIR/.agent-presets"
git clone "$REPO_URL" "$TARGET"
npm install --prefix "$HOME_DIR" cron-parser luxon

echo
echo "已安装到 $TARGET"
echo "重启 dsh web（或新开会话），在 hero-chip 选择 \"Matt 工作流模式\"。"
