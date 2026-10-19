#!/usr/bin/env node
/**
 * review-fixed-point.mjs —— **复核入口的可判检查**：派两轴 subagent **之前**跑一次。
 *
 * ── 为什么存在（A 批 retro 的第一条，合并计数 4 次）──────────────────────────────
 * 「先提交再复核」是本仓复核纪律的**主防线**（`docs/code-review-brief.md` §5 末"边界"明写：
 * 基线冻结 > 整段粘进 prompt > 人判）。但 A 批实测它被**反复违反四次**：
 *
 *   · #114：复核进行中边提交边改（39 行未提交）→ 两轴各自报"移动靶"，
 *     **而本票正在写的 AC 就是"先提交再复核"**（作者写它的时候还没被它约束）；
 *   · #108：复核期间提交并继续改 → 两轴**各自独立**报"树在动"，只能重跑第 2 轮；
 *   · #115：为冻结固定点做过一次副本回写 → Standards 轴读成"改动被外部丢弃"。
 *
 * 三次的**共同机制**：这条纪律是**流程约定**，没有任何一处机械检查它 ——
 * 每票都得靠作者自觉，而"我还能再改一处"的诱惑在当场总是成立。
 * 本脚本把它变成**一条命令能判的事**：工作树 != 固定点 → **非零退出并说清差在哪**。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────
 *   node scripts/review-fixed-point.mjs <fixed-point>      # 例：node scripts/review-fixed-point.mjs 0b582ef
 *   node scripts/review-fixed-point.mjs HEAD               # 固定点就是当前 HEAD（已提交完备的情形）
 *
 * 退出码：0 = 可派两轴；1 = 不可派（工作树与固定点不一致 / 固定点不可解析 / 有未跟踪的测试残骸）。
 *
 * ⚠ **本脚本只报不改**（与 C9 的"只报不阻断"不同：这里是**入口前的闸**，非零退出即"先别派"）。
 *   它**不**替你 commit / add / stash —— 那些是作者的判断（D22：决策归 human/作者）。
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixedPoint = process.argv[2]

if (fixedPoint === undefined) {
  console.error('用法: node scripts/review-fixed-point.mjs <fixed-point>')
  console.error('  <fixed-point> = 你打算 `git diff <fp>...HEAD` 的那个点（提交信息首个 `#NN` 那笔的前一点）')
  process.exit(1)
}

const git = (args) => {
  const r = spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', windowsHide: true })
  return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

// ① 固定点必须可解析（坏 ref 要在这一层炸，不要炸在两个 subagent 里 —— §1）
const fp = git(['rev-parse', '--verify', `${fixedPoint}^{commit}`])
if (fp.status !== 0) {
  console.error(`✗ 固定点不可解析: ${fixedPoint}`)
  console.error(`  git rev-parse → exit ${fp.status}${fp.err ? ` / ${fp.err}` : ''}`)
  process.exit(1)
}
const FP_SHA = fp.out

// ② 复核实跑的是"fixed point 那棵树" —— 工作树必须干净、index 必须与工作树一致
const dirty = git(['status', '--porcelain'])
const lines = dirty.out === '' ? [] : dirty.out.split('\n')
if (lines.length > 0) {
  console.error('✗ 工作树不干净 —— **先别派两轴**（复核期间任何未提交改动都会被读成"移动靶"）')
  console.error('')
  for (const l of lines.slice(0, 20)) console.error(`    ${l}`)
  if (lines.length > 20) console.error(`    … 另有 ${lines.length - 20} 项`)
  console.error('')
  console.error('  处置（二选一，都是你的判断）：')
  console.error('    · 这些改动属于本票 → `git add -A && git commit` 后再跑本脚本；')
  console.error('    · 属于下一票/无关 → 先收走再利用（注意 #108：**别用 `git checkout --` 当还原手段**）。')
  process.exit(1)
}

// ③ 固定点与 HEAD 的关系要说清楚 —— 派单者据此写 `git diff <fp>...HEAD`
const head = git(['rev-parse', 'HEAD']).out
const ahead = git(['rev-list', '--count', `${FP_SHA}..HEAD`]).out
const diffStat = git(['diff', '--stat', `${FP_SHA}...HEAD`])
const diffLines = diffStat.out === '' ? 0 : diffStat.out.split('\n').length
if (FP_SHA === head) {
  console.error('✗ 固定点 == HEAD 且工作树干净 —— **没有可复核的 diff**（空 diff 会在两轴里炸成假发现）')
  console.error(`  固定点 = HEAD = ${head.slice(0, 7)}。先把本票提交上去，再拿提交前的那个点当固定点。`)
  process.exit(1)
}
if (diffLines === 0) {
  console.error(`✗ \`git diff ${fixedPoint}...HEAD\` 为空 —— 空 diff 不要派两轴`)
  process.exit(1)
}

console.log('✓ 可派两轴复核')
console.log(`  固定点   ${fixedPoint} → ${FP_SHA.slice(0, 7)}`)
console.log(`  HEAD     ${head.slice(0, 7)}（领先固定点 ${ahead} 笔）`)
console.log(`  diff     git diff ${fixedPoint}...HEAD  → ${diffStat.out.split('\n').at(-1)}`)
console.log('  工作树   干净（复核期间请勿再改 —— 这正是本脚本要防的那件事）')