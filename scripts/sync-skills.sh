#!/usr/bin/env bash
# sync-skills.sh — 上游 mattpocock/skills → ~/.dsh/skills 镜像同步（#1，Windows/msys bash 版）
#
# 用法：
#   bash scripts/sync-skills.sh [--dry-run]
# 环境变量：
#   SYNC_SKILLS_UPSTREAM  上游 clone 目录（默认 /c/Work/code/skills，不存在则自动 clone）
#   SYNC_SKILLS_TARGET    镜像目标（默认 ~/.dsh/skills；测试时指到临时目录）
#
# 本地适配层（#10/#1 纪律，同步后必须保住）：
#   1. GLOSSARY-MAP.md → CONTEXT-MAP.md、GLOSSARY.md → CONTEXT.md（内容替换）
#   2. GLOSSARY-FORMAT.md → CONTEXT-FORMAT.md（文件名 + 内容替换）
#   3. implement-spec 不同步（ADR-0005）
#   4. 行尾统一 LF（上游 clone 受 core.autocrlf 影响可能检出 CRLF；现存镜像为 LF）
#   5. fork 保护：scripts/sync-skills.exclude 列出的技能名不覆盖；上游有变更时打警告
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

UP="${SYNC_SKILLS_UPSTREAM:-/c/Work/code/skills}"
TARGET="${SYNC_SKILLS_TARGET:-$HOME/.dsh/skills}"
HERE="$(cd "$(dirname "$0")" && pwd)"
EXCLUDE_FILE="$HERE/sync-skills.exclude"
CATEGORIES="engineering productivity misc in-progress"
SKIP_SKILLS="implement-spec"   # ADR-0005：本地不采用

# —— 上游就绪（clone or pull；dry-run 只读不动上游也行，但 pull 保持新鲜）——
if [ ! -d "$UP/.git" ]; then
  [ $DRY_RUN = 1 ] && { echo "✗ 上游 clone 不存在（$UP）——先去掉 --dry-run 让脚本自动 clone"; exit 1; }
  git clone https://github.com/mattpocock/skills "$UP"
else
  git -C "$UP" pull --ff-only >/dev/null 2>&1 || echo "⚠ 上游 pull 失败（离线？），沿用现有内容"
fi

is_excluded() { # 技能名在 exclude 清单或硬跳过名单里
  echo "$SKIP_SKILLS" | tr ' ' '\n' | grep -qx "$1" && return 0
  [ -f "$EXCLUDE_FILE" ] && grep -vE '^\s*(#|$)' "$EXCLUDE_FILE" | grep -qx "$1"
}

apply_transforms() { # 适配层：GLOSSARY 家族 → CONTEXT 家族（内容 + 文件名）
                    # + implement-spec 路由剔除（ADR-0005，ask-matt 文本对齐 #10 金标）
  local dir="$1"
  { grep -rl 'GLOSSARY\|implement-spec' "$dir" 2>/dev/null || true; } | while read -r f; do
    sed -i -e 's/GLOSSARY-MAP\.md/CONTEXT-MAP.md/g' \
           -e 's/GLOSSARY-FORMAT\.md/CONTEXT-FORMAT.md/g' \
           -e 's/GLOSSARY\.md/CONTEXT.md/g' \
           -e '/- \*\*`\/implement-spec`\*\* for the whole spec/d' \
           -e 's/Then work the tickets one of two ways:/Then work the tickets:/' \
           -e 's/; `\/implement-spec`'"'"'s implementers each drive `\/tdd`, and it runs one `\/code-review` over the integration branch\././' \
           -e 's/\r$//' "$f"
  done
  find "$dir" -name 'GLOSSARY-FORMAT.md' | while read -r f; do
    mv "$f" "$(dirname "$f")/CONTEXT-FORMAT.md"
  done
  # 行尾归一 LF：所有文本文件（判定=首 4KB 无 NUL 字节；未触 transform 的也要归一）
  find "$dir" -type f | while read -r f; do
    if ! head -c 4096 "$f" | od -An -tx1 | grep -q ' 00 '; then
      sed -i 's/\r$//' "$f"
    fi
  done
}

mkdir -p "$TARGET"
changed=0; warned=0
for cat_dir in $CATEGORIES; do
  src_root="$UP/skills/$cat_dir"
  [ -d "$src_root" ] || continue
  for src in "$src_root"/*/; do
    name="$(basename "$src")"
    [ -d "$src" ] || continue
    dst="$TARGET/$name"
    if is_excluded "$name"; then
      # fork 保护：不覆盖；本地 fork 存在且与上游有内容差异时警告（提示人工 rebase）
      if [ -d "$dst" ] && ! git diff --no-index -w --quiet "$src" "$dst" 2>/dev/null; then
        echo "⚠ FORK-DRIFT $name：本地 fork 与上游有差异（不覆盖，人工核对后更新 fork 或移出排除清单）"
        warned=$((warned+1))
      fi
      continue
    fi
    if [ $DRY_RUN = 1 ]; then
      # 变换后比变换后：dry-run 对 src 也过一遍适配层，避免已同步状态永远误报
      scratch=$(mktemp -d)
      cp -r "$src" "$scratch/x"
      apply_transforms "$scratch/x"
      if [ ! -d "$dst" ] || ! git diff --no-index -w --quiet "$scratch/x" "$dst" 2>/dev/null; then
        echo "DRY-RUN will-sync $name"
        changed=$((changed+1))
      fi
      rm -rf "$scratch"
    else
      rm -rf "$dst.tmp-sync"
      cp -r "$src" "$dst.tmp-sync"
      apply_transforms "$dst.tmp-sync"
      if [ -d "$dst" ]; then
        rm -rf "$dst.old"
        mv "$dst" "$dst.old"
        mv "$dst.tmp-sync" "$dst"
        rm -rf "$dst.old"
      else
        mv "$dst.tmp-sync" "$dst"
      fi
      echo "✓ synced $name"
      changed=$((changed+1))
    fi
  done
done

if [ $DRY_RUN = 1 ]; then
  echo "—— dry-run 完：将同步 $changed 个技能（上游 → 适配层 → 镜像）"
else
  echo "—— 同步完：$changed 个技能，$warned 个 fork 警告"
fi
