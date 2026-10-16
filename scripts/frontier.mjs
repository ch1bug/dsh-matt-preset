#!/usr/bin/env node
/**
 * frontier.mjs — ready frontier（当前可开工票集合）现算，**不读票面文字**。
 *
 * 为什么（#61 的采纳面）：排批 / 预检要知道"现在能开哪几张票"。此前只能读每张票正文里的
 * "Blocked by" 段落人肉判断——2026-10-16 就踩过：把已关闭的阻塞（历史边）误判成"缺边"，
 * 因为 `issue_dependencies_summary.blocked_by` **只计 open 阻塞**，看那个数字读不出
 * "边存在但已满足"。原生依赖边是权威表示，正文文字只是叙述。
 *
 * 规则（与 docs/agents/issue-tracker.md「Ready frontier」一致）：
 *   frontier = open + label(默认 ready-for-agent) + **无 open 阻塞** + **无 assignee**
 * 数据源 = GitHub 原生依赖边（逐票 `dependencies/blocked_by`，带 state 自行过滤）。
 *
 * 用法：
 *   node scripts/frontier.mjs                    # 默认 ready-for-agent
 *   node scripts/frontier.mjs --label ready-for-human
 *   node scripts/frontier.mjs --json             # 机器可读（排批输入）
 *   node scripts/frontier.mjs --repo owner/name  # 默认经 gh 取当前仓库
 * 前置：PATH 上有 `gh` 且已登录。任何 gh 调用失败都**响亮退出**——绝不让"接口挂了"
 * 伪装成"没有阻塞"。
 *
 * 纯逻辑 `readyFrontier()` 与 gh I/O 分离：tests/verify-frontier.mjs 离线单测前者
 * （含"正文写满 Blocked by 也不影响结果"这条正是本脚本存在的理由）。
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 默认 frontier 的 label。 */
export const DEFAULT_LABEL = 'ready-for-agent'

/**
 * 纯函数：算出 frontier 与被 gate 的票。
 * @param issues        [{ number, title, labels: string[], assignees: string[], state?, body? }]
 *                      —— 只读 labels/assignees/state/number；`body` 一律忽略（本脚本的要点）。
 * @param openBlockers  Map<number, number[]>：每票的 **open** 阻塞票号（含已关闭阻塞的边不算）。
 * @returns { frontier, gated }（均按票号升序；gated 项附 blockers / assignees 作为理由）
 */
export function readyFrontier(issues, openBlockers, { label = DEFAULT_LABEL } = {}) {
  const frontier = []
  const gated = []
  for (const issue of issues) {
    // state 大小写不敏感：`gh issue list --json state` 返回 "OPEN"/"CLOSED"，
    // 而 `gh api` 返回 "open"/"closed"——归一在纯函数里做，边界不吃亏。
    if (issue.state !== undefined && String(issue.state).toLowerCase() !== 'open') continue
    const labels = issue.labels ?? []
    if (!labels.includes(label)) continue
    const blockers = openBlockers.get(issue.number) ?? []
    const assignees = issue.assignees ?? []
    if (blockers.length > 0 || assignees.length > 0) gated.push({ ...issue, blockers, assignees })
    else frontier.push(issue)
  }
  const byNumber = (a, b) => a.number - b.number
  return { frontier: frontier.sort(byNumber), gated: gated.sort(byNumber) }
}

/** 解析 CLI 参数（--repo/--label/--json/--help）。 */
export function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--repo') args.repo = argv[++i]
    else if (a === '--label') args.label = argv[++i]
    else if (a === '--json') args.json = true
    else if (a === '--help' || a === '-h') args.help = true
    else fail(`unknown argument: ${a}（--help 看用法）`)
  }
  return args
}

/** 跑一条 gh 命令并要求成功：失败即响亮退出。 */
function gh(args) {
  const run = spawnSync('gh', args, { encoding: 'utf8' })
  if (run.error !== undefined) fail(`gh 不可用（PATH 上要有已登录的 gh）：${run.error.message}`)
  if (run.status !== 0) fail(`gh ${args.join(' ')} exited ${run.status}: ${(run.stderr ?? '').trim()}`)
  return run.stdout
}

function fail(message) {
  console.error(`frontier: ${message}`)
  process.exit(1)
}

const USAGE = [
  'usage: node scripts/frontier.mjs [--label <label>] [--repo <owner/name>] [--json]',
  `  --label   frontier 的 label（默认 ${DEFAULT_LABEL}）`,
  '  --repo    目标仓库（默认经 gh 取当前仓库）',
  '  --json    输出机器可读 JSON（frontier + gated）',
].join('\n')

/** CLI 主体：取数据 → 纯函数 → 打印。 */
export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) { console.log(USAGE); return }
  const repo = args.repo ?? gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim()
  const label = args.label ?? DEFAULT_LABEL

  const raw = JSON.parse(gh([
    'issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200',
    '--json', 'number,title,labels,assignees,state',
  ]))
  const issues = raw.map((issue) => ({
    number: issue.number,
    title: issue.title,
    labels: (issue.labels ?? []).map((l) => l.name),
    assignees: (issue.assignees ?? []).map((a) => a.login),
    state: String(issue.state ?? 'open'), // gh list 给大写 OPEN/CLOSED——纯函数按大小写不敏感处理
    // body 故意不取：正文的 "Blocked by" 文字不是权威（见文件头注）。
  }))

  const openBlockers = new Map()
  for (const issue of issues) {
    const blockers = JSON.parse(gh([
      'api', `repos/${repo}/issues/${issue.number}/dependencies/blocked_by`,
      '--jq', '[.[] | select(.state == "open") | .number]',
    ]))
    if (blockers.length > 0) openBlockers.set(issue.number, blockers)
  }

  const { frontier, gated } = readyFrontier(issues, openBlockers, { label })

  if (args.json === true) {
    console.log(JSON.stringify({ repo, label, frontier, gated }, null, 2))
    return
  }

  console.log(`\n=== ready frontier（${label} · open · 无 open 阻塞 · 无 assignee）: ${frontier.length} ===`)
  for (const issue of frontier) console.log(`  #${issue.number}  ${issue.title}`)
  console.log(`\n=== 被 gate（${label} 但有 open 阻塞 / assignee）: ${gated.length} ===`)
  for (const issue of gated) {
    const reasons = [
      issue.blockers.length > 0 ? `← ${issue.blockers.map((b) => '#' + b).join(', ')}` : '',
      issue.assignees.length > 0 ? `assigned: ${issue.assignees.map((a) => '@' + a).join(', ')}` : '',
    ].filter(Boolean).join('   ')
    console.log(`  #${issue.number}  ${reasons}`)
  }
}

// 只有**直接执行**才跑 CLI：被 import（离线单测）时只暴露纯函数。
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()