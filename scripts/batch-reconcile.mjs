#!/usr/bin/env node
/**
 * batch-reconcile.mjs — 泳道批批末机械对账（#165）：batch-state.md 投影 × 任务板导出 × git 层事实。
 *
 * ── 载体归属（ADR-0018 + 票面 #165）─────────────────────────────────────────────
 * 泳道批（DSH Agent Teams lane）下，同一事实只在一个载体上可写，其他面只读投影：
 *   · 票进度（每票完成态）  权威 = 任务板（TeamTaskView.status）；
 *   · 停驻登记（阻塞边）    权威 = 任务板（blockedBy / ready）——投影面不承载停驻，无双写面；
 *   · 未推清单（未推送笔）  权威 = git（rev-list / log 实测）。
 * `.scratch/batch-state.md` 在泳道批是**批末从任务板导出的投影**，不再是在飞状态的权威
 * （#115 手抄漂移两次复发；泳道批多 lane 并发手抄必死——它是并行前置件，不是并行的一部分）。
 * 串行批（非泳道）不受影响：C9（tests/verify-batch-state.mjs）照旧只报不阻断。
 *
 * ── 任务板导出面（输入之一）──────────────────────────────────────────────────
 * 可编程读取通道勘察结论（上游树读 66491b05 = dsh-v0.2.2-rc.1）：
 *   · 任务板唯一原生可编程读面 = **Lead 会话内模型工具 `team_task_list`**（输出即
 *     TeamTaskView JSON；packages/experimental/tool-agent-team/src/index.ts TASK_VIEW_SCHEMA）；
 *   · 上游 agent-team / tool-agent-team **无 RPC 端点**（src 内无 rpc/Remote 注册面）；
 *   · 进程外直读 session 文件不可靠：session-persistence-jsonl 默认 zstd 压缩 + **批量落盘**
 *     （docs/dsh-runtime-cheatsheet.md「别拿会话文件当实时证据」），且任务板态 = session log
 *     里 `team/task` 事件的累积投影——直读原始日志等于在仓内复刻上游投影器（造轮子）。
 * ⇒ 批末流程：DSH Team Lead 会话跑 `team_task_list`（翻页取全），把**工具输出 JSON 原样**
 *   落盘成导出文件，本脚本消费之。导出形态权威 = 上游 TeamTaskView（id/revision/subject/
 *   description/status/ownerName?/blockedBy/writeScopes/ready/writeScopeWarnings）；
 *   `nextCursor` 残留 = 导出**截断**，禁被读成完整（响亮）——追加型工件禁存在性判定（S2）。
 *
 * ── 对账判据（不一致 → exit 1 + 逐项差异；绝不静默）──────────────────────────
 *   R2 票集合  成员表票 ↔ 任务板任务 **subject** 里的 `#N`，双向 diff（单边缺席 = 漂移）。
 *              关联面 = subject（建板约定：任务由票派生、subject 带票号）；description 是
 *              自由文本，里面的 #N（「关联 #115」类交叉引用）不参与关联——否则收口杂务的
 *              描述引用票号就把不相关票拖进双向 diff 假红（#165 复审意见 2）。
 *   R3 状态    成员表首词 `done` ↔ 任务板 completed（判据与 C9-guardrail 的 done 取数同源）；
 *   R4 笔数    最后一条「未推送清单：（N 票）」声称 vs `git rev-list --count <range>` 实测；
 *   R5 逐笔    声称 sha 集合 vs `git log --format=%H <range>` 集合，双向 diff；
 *   R6 工作树  `git status --porcelain -uall` 非空 = 逐项列出（批末应净；.scratch 不进 porcelain）；
 *   R7 投影面  活文件缺席 / 成员表解析失败 / 无合规声称 → 响亮（缺席必响亮，S1）；
 *   报告级（不非零）：板上无票号任务、deleted 行、未完任务清单——显式出现，不静默吞。
 *
 * ── 对账基准 range（develop 批未首推的缺席口径）──────────────────────────────
 *   `--range` 显式给 → 用之；否则 `origin/<branch>..HEAD`；`origin/<branch>` 缺席
 *   （lane 分支 / develop 未首推常态）→ fallback `main..HEAD`（同「未推送 = 未合并」量，
 *   docs/batch-state.md「取数命令契约」的 range 替代规则），**输出里显式声明**；
 *   两个基准都缺席 → 响亮 exit 1（批末收口连基准都没有，不是"没有差异"）。
 *
 * 用法：
 *   node scripts/batch-reconcile.mjs --board-export <file> [--state <file>] [--repo <dir>]
 *                                    [--range <a>..<b>] [--json]
 *     --board-export  任务板导出文件（team_task_list 输出原样落盘）——必填
 *     --state         投影面（默认 <repo>/.scratch/batch-state.md）
 *     --repo          仓目录（默认 cwd；git 一律 `git -C <repo>`，不用 spawn cwd）
 *     --range         覆盖对账 range（默认逻辑见上节）
 *     --json          机器可读输出
 * 退出码：0 = 对账一致（报告项显式列出）；1 = 对账不一致（逐项差异）/ 取数失败；
 *         2 = 用法错误。
 * 纯逻辑（parseBoardExport / parseProjection / ticketNumbersFromTask / pickRange / reconcile）
 * 与 I/O 分离：tests/verify-batch-reconcile.mjs 离线单测前者 + 真夹具仓 CLI 漂移实测（验收②）。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 纯函数 ──────────────────────────────────────────────────────────────────────

/** 形状错误（带 reason）——调用方转响亮退出，绝不静默读成空集合。 */
export class ShapeError extends Error {}

/** 任务板导出文本 → { tasks, deletedRows }。
 *  形态契约 = 上游 TeamTaskView（team_task_list 的 TASK_VIEW_SCHEMA，必需字段：
 *  id/revision/subject/description/status/blockedBy/writeScopes/ready/writeScopeWarnings；
 *  ownerName 可选）——与上游 schema required 面一一对齐，宽松 = 假绿通道。
 *  nextCursor 残留 → ShapeError（team_task_list 分页未取全 = 截断导出，S2）。 */
export function parseBoardExport(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch (e) {
    throw new ShapeError(`导出文件不是合法 JSON：${e.message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ShapeError('导出形状不对：顶层应是 { tasks: [...] }（team_task_list 的原样输出）')
  }
  if (!Array.isArray(parsed.tasks)) {
    throw new ShapeError('导出形状不对：缺 tasks 数组（team_task_list 的原样输出）')
  }
  if (parsed.nextCursor !== undefined) {
    throw new ShapeError(`导出带 nextCursor=${JSON.stringify(parsed.nextCursor)} —— 分页未取全，导出被截断；回 Lead 会话继续翻页（limit 100 / cursor）后再导出`)
  }
  const REQUIRED = {
    id: (v) => typeof v === 'string' && v.length > 0,
    revision: (v) => Number.isSafeInteger(v) && v > 0,
    subject: (v) => typeof v === 'string' && v.length > 0,
    description: (v) => typeof v === 'string' && v.length > 0,
    status: (v) => ['pending', 'in_progress', 'completed', 'deleted'].includes(v),
    blockedBy: (v) => Array.isArray(v),
    writeScopes: (v) => Array.isArray(v),
    ready: (v) => typeof v === 'boolean',
    writeScopeWarnings: (v) => Array.isArray(v),
  }
  const tasks = []
  for (const [i, t] of parsed.tasks.entries()) {
    if (typeof t !== 'object' || t === null) {
      throw new ShapeError(`tasks[${i}] 不是对象：${JSON.stringify(t)}`)
    }
    const missing = Object.keys(REQUIRED).filter((k) => !REQUIRED[k](t[k]))
    if (missing.length > 0) {
      throw new ShapeError(`tasks[${i}]（${JSON.stringify(t.id ?? '(无 id)')}）缺/坏必需字段: ${missing.join(', ')} —— 形态权威 = 上游 TeamTaskView（tool-agent-team TASK_VIEW_SCHEMA）`)
    }
    tasks.push(t)
  }
  const deletedRows = tasks.filter((t) => t.status === 'deleted')
  return { tasks: tasks.filter((t) => t.status !== 'deleted'), deletedRows }
}

/** 「未推送清单」判据——与 tests/verify-batch-state.mjs 的 CLAIM_RE 同源（#129：判据
 *  正则手写简化版会静默漏报）：`[\s\S]` 允许多行清单；`（N 票` 后允许还有话（实测合规写法
 *  「（4 票；实测 = …）」）；`(?![\s\S]*未推送清单)` 锁最后一条。
 *  ⚠ 消费形态 differs from C9：活文件进度日志**每票一行「未推送清单」**（历史行累积是有意的
 *  —— C9 头注「不要求删历史行」），多行常态下 lookahead 版会跨界吞掉中途行（match 从第一条
 *  起点一直扩到末条的「（N 票」）——C9 只读 N 所以跨界无害，本脚本还要从清单体**提取 sha**，
 *  跨界会把历史行的 sha 混进来。故 sha/N 的取值面 = CLAIM_ONE 从**最后一个起点**切单条
 *  （=「最后一条」语义，与 C9 的 N 同源）；CLAIM_RE 保留做「至少一条合规声称」的缺席检测
 *  （matchAll 空 = 没有任何一条以「（N 票」收尾 → 响亮哑掉，与 C9-claims 同形）。 */
const CLAIM_RE = /未推送清单：[\s\S]*?（(\d+)\s*票(?![\s\S]*未推送清单)/g
const CLAIM_HEAD = /未推送清单：/g
const CLAIM_ONE = /未推送清单：([\s\S]*?)（(\d+)\s*票/

/** 成员表「成员与顺序」节提取（headingSection 同形判据）。 */
function headingSection(text, id) {
  const m = new RegExp(`^##\\s+${id}\\s*$`, 'm').exec(text)
  if (m === null) return null
  const rest = text.slice(m.index + m[0].length)
  const next = /^##\s+/m.exec(rest)
  return next === null ? rest : rest.slice(0, next.index)
}

const DONE_TOKEN = 'done'

/** 投影面文本 → { members: [{ issue, status, statusRaw }], claim: { n, shas } | null, reason? }。
 *  成员表判据与 C9-guardrail 同源：节内第一张表、按**列名**定位（不写死列序）、
 *  状态列去装饰后**首词** == done（`done（#114）`/`done@sha` 粘连不算）。
 *  票号列 = 表头含「票」的列，cell `#(\d+)`。解析失败 → { ok:false, reason }（上层响亮）。 */
export function parseProjection(md) {
  const text = String(md).replace(/\r\n/g, '\n')
  const section = headingSection(text, '成员与顺序')
  if (section === null) return { ok: false, members: [], claim: null, reason: '找不到 `## 成员与顺序` 一节' }
  const lines = section.split('\n')
  const start = lines.findIndex((l) => /^\s*\|/.test(l))
  if (start < 0) return { ok: false, members: [], claim: null, reason: '「成员与顺序」节内没有表格' }
  const rows = []
  for (let i = start; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(lines[i])
  const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  if (rows.length < 3) return { ok: false, members: [], claim: null, reason: `表格只有 ${rows.length} 行（表头 + 分隔 + ≥1 数据行才成立）` }
  const header = cells(rows[0])
  const strip = (c) => c.replace(/[*`]/g, '').trim()
  const statusIdx = header.findIndex((c) => strip(c) === '状态')
  if (statusIdx < 0) return { ok: false, members: [], claim: null, reason: `表头 ${JSON.stringify(header)} 里没有「状态」列` }
  const issueIdx = header.findIndex((c) => c.includes('票'))
  if (issueIdx < 0) return { ok: false, members: [], claim: null, reason: `表头 ${JSON.stringify(header)} 里没有票号列（列名须含「票」）` }
  const isSeparator = (cs) => cs.every((c) => c === '' || /^:?-{2,}:?$/.test(c))
  const data = rows.slice(1).map(cells).filter((cs) => !isSeparator(cs))
  if (data.length === 0) return { ok: false, members: [], claim: null, reason: '成员表没有数据行（成员 0 票）' }
  const members = []
  for (const [i, cs] of data.entries()) {
    if (cs.length <= statusIdx || cs.length <= issueIdx) {
      return { ok: false, members: [], claim: null, reason: `第 ${i + 1} 个数据行缺票号/状态列（${JSON.stringify(cs)}）` }
    }
    const issueM = /#(\d+)/.exec(cs[issueIdx])
    if (issueM === null) {
      return { ok: false, members: [], claim: null, reason: `第 ${i + 1} 个数据行票号列读不出 #N（${JSON.stringify(cs[issueIdx])}）` }
    }
    const statusRaw = cs[statusIdx]
    members.push({ issue: Number(issueM[1]), statusRaw, status: strip(statusRaw).split(/\s+/)[0].toLowerCase() })
  }
  // 「未推送清单」声称：判据同源（见 CLAIM_RE 注）。历史行累积常态 → 取**最后一条**；
  // 一条都没有（前缀缺席或没有任何一条以「（N 票」收尾）→ claim=null（R7 响亮）。
  const starts = [...text.matchAll(CLAIM_HEAD)]
  const compliant = [...text.matchAll(CLAIM_RE)].length
  let claim = null
  let claimReason
  if (starts.length === 0) {
    claimReason = '活文件里没有一条「未推送清单：」——批末投影必带该行（模板初始行即有）'
  } else {
    const one = CLAIM_ONE.exec(text.slice(starts.at(-1).index))
    if (one !== null) {
      const shas = [...new Set([...one[1].matchAll(/\b[0-9a-f]{7,40}\b/gi)].map((m) => m[0].toLowerCase()))]
      claim = { n: Number(one[2]), shas }
    } else {
      claimReason = compliant === 0
        ? `有 ${starts.length} 处「未推送清单：」但没有任何一条以「（N 票」收尾——合规声称 0 条，照 C9-claims 响亮哑掉`
        : '最后一条「未推送清单：」切不出单条声称（末条形态漂）——响亮哑掉'
    }
  }
  return { ok: true, members, claim, reason: claimReason }
}

/** 任务条目 → 关联票号集合。关联面 = **subject**（建板约定：任务由票派生、subject 带票号）；
 *  description 是自由文本，里面的 `#N`（「关联 #115」「被 #137 阻塞」类交叉引用）**不参与**
 *  关联——否则一条收口杂务任务的描述引用票号，就会把成员表没有的票拖进 R2 双向 diff 假红
 *  （#165 复审意见 2；P 组/R 组用例钉住两侧）。 */
export function ticketNumbersFromTask(task) {
  return [...new Set([...String(task.subject ?? '').matchAll(/#(\d+)/g)].map((m) => Number(m[1])))]
}

/** 对账基准 range（纯函数）。见头注「对账基准 range」节。
 *  @returns { range, note } | { error } */
export function pickRange({ rangeArg, originExists, mainExists, branch }) {
  if (rangeArg !== undefined && rangeArg !== '') return { range: rangeArg, note: `显式 --range ${rangeArg}` }
  if (originExists) return { range: `origin/${branch}..HEAD`, note: `基准 origin/${branch} 在场` }
  if (mainExists) return { range: 'main..HEAD', note: `origin/${branch} 缺席（未首推常态）→ fallback main..HEAD（「未推送 = 未合并」同量，显式声明）` }
  return { error: `对账基准缺席：origin/${branch} 与 main 都不在场 —— 批末收口没有基准可对账，这不是「没有差异」，响亮拒绝` }
}

/**
 * 纯对账核心。输入全部为已解析数据（I/O 半截负责取数与形状校验）。
 * @param {object} board        parseBoardExport 的产物 { tasks, deletedRows }
 * @param {object} projection   parseProjection 的产物 { ok, members, claim, reason }
 * @param {object} git          git 层事实 { rangeUsed, rangeNote, count, shas, porcelain }
 * @returns {{ ok: boolean, hard: Array<{code,message}>, report: Array<{code,message}> }}
 *   hard = 不一致（exit 1 驱动）；report = 显式报告项（不非零）。
 */
export function reconcile({ board, projection, git }) {
  const hard = []
  const report = []

  // R7 投影面解析失败 → 响亮
  if (!projection.ok) {
    hard.push({ code: 'R7-projection-unreadable', message: `投影面解析失败：${projection.reason}` })
  }

  // R2/R3 票集合与状态对齐（投影可解析才比）
  if (projection.ok) {
    const boardByIssue = new Map()
    for (const t of board.tasks) {
      for (const n of ticketNumbersFromTask(t)) {
        if (!boardByIssue.has(n)) boardByIssue.set(n, [])
        boardByIssue.get(n).push(t)
      }
    }
    const noTicket = board.tasks.filter((t) => ticketNumbersFromTask(t).length === 0)
    for (const t of noTicket) {
      report.push({ code: 'I-board-task-no-issue', message: `板上任务 ${t.id}（${t.subject}）subject 不含 #N 票号 —— 泳道批任务应带票号上板（报告项，不判漂移）` })
    }
    for (const d of board.deletedRows) {
      report.push({ code: 'I-board-deleted-row', message: `板上 deleted 行 ${d.id}（${d.subject}）—— team_task_list 不导出 deleted，出现即导出面被手造过，显式列出` })
    }
    for (const m of projection.members) {
      const tasks = boardByIssue.get(m.issue)
      if (tasks === undefined) {
        hard.push({ code: 'R2-member-missing-on-board', message: `成员表 #${m.issue} 在任务板上找不到对应任务（subject 含 #${m.issue}）—— 票没上板或导出面漂了` })
        continue
      }
      const doneOnProjection = m.status === DONE_TOKEN
      const allCompleted = tasks.every((t) => t.status === 'completed')
      const anyCompleted = tasks.some((t) => t.status === 'completed')
      if (doneOnProjection && !allCompleted) {
        hard.push({
          code: 'R3-status-mismatch',
          message: `#${m.issue} 投影标 done，任务板读数 = [${tasks.map((t) => `${t.id}:${t.status}`).join(', ')}] —— 票进度权威在任务板，投影与权威说不同的故事`,
        })
      } else if (!doneOnProjection && anyCompleted) {
        hard.push({
          code: 'R3-status-mismatch',
          message: `#${m.issue} 投影未标 done（状态列 = ${JSON.stringify(m.statusRaw)}），任务板读数 = [${tasks.map((t) => `${t.id}:${t.status}`).join(', ')}] —— 板上已完成而投影没跟上`,
        })
      }
    }
    const memberIssues = new Set(projection.members.map((m) => m.issue))
    for (const [n] of boardByIssue) {
      if (!memberIssues.has(n)) {
        hard.push({ code: 'R2-board-task-missing-in-projection', message: `任务板上有 #${n} 的任务，成员表没有这一票 —— 权威有票而投影缺行` })
      }
    }
    const unfinished = board.tasks.filter((t) => t.status !== 'completed')
    if (unfinished.length > 0) {
      report.push({ code: 'I-board-unfinished', message: `未完任务 ${unfinished.length} 条: ${unfinished.map((t) => `${t.id}(${t.status})`).join(', ')} —— 批末收口判据另有结束点门，对账只显式列出` })
    }
  }

  // R4/R5 未推清单（claim 缺 = 硬，投影可解析才比）
  if (projection.ok && projection.claim === null) {
    hard.push({ code: 'R7-claim-absent', message: projection.reason })
  }
  if (projection.ok && projection.claim !== null) {
    if (git.count === null || !Number.isSafeInteger(git.count)) {
      hard.push({ code: 'R4-count-unavailable', message: `git rev-list --count ${git.rangeUsed} 取不到数值 —— 取数面失灵 = 防线缺席，响亮` })
    } else {
      if (projection.claim.n !== git.count) {
        hard.push({ code: 'R4-claim-vs-count', message: `未推送笔数声称 ≠ 实测：声称 ${projection.claim.n} / 实测（git rev-list --count ${git.rangeUsed}）${git.count}` })
      }
      // sha 比对按 git 短 sha 语义：声称里的 sha 是实测长 sha 的**唯一前缀**即命中
      //（清单里手抄的通常是 %h 短形；实测 log --format=%H 是长形——逐字集合比对会把
      // 每一笔都误读成漂移）。声称比实测长（整长 sha 照抄）也命中（逐字相等）。
      const claimed = [...new Set(projection.claim.shas)]
      const actual = git.shas.map((s) => s.toLowerCase())
      const claimedHit = (s) => actual.some((a) => a === s || a.startsWith(s))
      const claimedOnly = claimed.filter((s) => !claimedHit(s))
      const actualOnly = actual.filter((a) => !claimed.some((s) => a === s || a.startsWith(s)))
      if (claimedOnly.length > 0) {
        hard.push({ code: 'R5-sha-listed-not-in-range', message: `声称列出但不在实测 range ${git.rangeUsed} 里: ${claimedOnly.join(', ')}` })
      }
      if (actualOnly.length > 0) {
        hard.push({ code: 'R5-sha-in-range-not-listed', message: `实测 range ${git.rangeUsed} 里有但声称未列: ${actualOnly.join(', ')}` })
      }
    }
  }

  // R6 工作树
  if (git.porcelain === null) {
    hard.push({ code: 'R6-status-unavailable', message: 'git status --porcelain 取不到 —— 取数面失灵，响亮' })
  } else if (git.porcelain.length > 0) {
    hard.push({ code: 'R6-worktree-dirty', message: `工作树非净（批末应已逐票提交）:\n      ${git.porcelain.join('\n      ')}` })
  }

  return { ok: hard.length === 0, hard, report }
}

// ── I/O 半截 ────────────────────────────────────────────────────────────────────

function fail(message, code = 1) {
  console.error(`batch-reconcile: ${message}`)
  process.exit(code)
}

/** 解析 CLI 参数。 */
export function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--board-export') args.boardExport = argv[++i]
    else if (a === '--state') args.state = argv[++i]
    else if (a === '--repo') args.repo = argv[++i]
    else if (a === '--range') args.range = argv[++i]
    else if (a === '--json') args.json = true
    else if (a === '--help' || a === '-h') args.help = true
    else fail(`unknown argument: ${a}（--help 看用法）`, 2)
  }
  return args
}

/** git 子命令（一律 `git -C <repo>`——本机 startup 脚本族会复位 spawn cwd，-C 是 git 自参）。 */
function gitIn(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true })
  return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

/** git 层事实取数。任何取数失灵都由 reconcile 的 hard 项或此处响亮表达，不静默。 */
function collectGitFacts(repo, rangeArg) {
  const head = gitIn(repo, ['symbolic-ref', '--short', 'HEAD'])
  if (head.status !== 0) fail(`当前分支不可知（非仓 / detached HEAD）：${head.err || head.out} —— 不猜分支（同 C9 的响亮口径）`)
  const branch = head.out
  const refExists = (ref) => gitIn(repo, ['rev-parse', '--verify', '--quiet', ref]).status === 0
  const originExists = refExists(`origin/${branch}`)
  const mainExists = refExists('main')
  const picked = pickRange({ rangeArg, originExists, mainExists, branch })
  if (picked.error !== undefined) fail(picked.error)
  const count = gitIn(repo, ['rev-list', '--count', picked.range])
  if (count.status !== 0) fail(`git rev-list --count ${picked.range} 失败（exit ${count.status}）：${count.err}`)
  const countNum = Number(count.out)
  if (!Number.isSafeInteger(countNum)) fail(`git rev-list --count 输出不是整数：${JSON.stringify(count.out)} —— 不猜`)
  const log = gitIn(repo, ['log', '--format=%H', picked.range])
  if (log.status !== 0) fail(`git log --format=%%H ${picked.range} 失败（exit ${log.status}）：${log.err}`)
  const porcelain = gitIn(repo, ['status', '--porcelain', '-uall'])
  if (porcelain.status !== 0) fail(`git status --porcelain 失败（exit ${porcelain.status}）：${porcelain.err}`)
  return {
    rangeUsed: picked.range,
    rangeNote: picked.note,
    count: countNum,
    shas: log.out === '' ? [] : log.out.split('\n').map((s) => s.trim()).filter(Boolean),
    porcelain: porcelain.out === '' ? [] : porcelain.out.split('\n').map((s) => s.trim()).filter(Boolean),
  }
}

const USAGE = [
  'usage: node scripts/batch-reconcile.mjs --board-export <file> [--state <file>] [--repo <dir>] [--range <a>..<b>] [--json]',
  '  --board-export  任务板导出文件（Lead 会话 team_task_list 输出原样落盘）——必填',
  '  --state         投影面（默认 <repo>/.scratch/batch-state.md）',
  '  --repo          仓目录（默认 cwd）',
  '  --range         覆盖对账 range（默认 origin/<branch>..HEAD，缺席 fallback main..HEAD）',
  '  --json          机器可读输出',
].join('\n')

/** CLI 主体：取 git 事实 + 读两面 → reconcile → 打印 → exit code。 */
export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(USAGE)
    return
  }
  if (args.boardExport === undefined) fail('--board-export 必填（任务板导出面没有输入源，对账无从谈起）', 2)
  const repo = args.repo !== undefined ? resolve(args.repo) : process.cwd()

  // 投影面（缺席 = R7 响亮，不静默当"无投影"）
  const statePath = args.state !== undefined
    ? (isAbsolute(args.state) ? args.state : join(repo, args.state))
    : join(repo, '.scratch', 'batch-state.md')
  let stateText = null
  try {
    stateText = readFileSync(statePath, 'utf8')
  } catch (e) {
    fail(`投影面读不了 ${statePath}：${e.message} —— 泳道批批末收口要求投影先行落盘（batch-state.md = 批末投影，缺席即响亮）`)
  }
  const projection = parseProjection(stateText)

  // 任务板导出面
  let board
  try {
    board = parseBoardExport(readFileSync(args.boardExport, 'utf8'))
  } catch (e) {
    fail(e instanceof ShapeError
      ? `任务板导出面形状不对 ${args.boardExport}：${e.message}`
      : `任务板导出面读不了 ${args.boardExport}：${e.message}`)
  }

  const git = collectGitFacts(repo, args.range)
  const result = reconcile({ board, projection, git })

  if (args.json === true) {
    console.log(JSON.stringify({
      ok: result.ok,
      git: { rangeUsed: git.rangeUsed, rangeNote: git.rangeNote, count: git.count, shaCount: git.shas.length, porcelain: git.porcelain },
      projection: { ok: projection.ok, members: projection.members.map((m) => ({ issue: m.issue, statusRaw: m.statusRaw })), claim: projection.claim },
      board: { taskCount: board.tasks.length, deletedCount: board.deletedRows.length },
      hard: result.hard,
      report: result.report,
    }, null, 2))
  } else {
    console.log(`\n=== batch-reconcile（#165：batch-state.md = 批末投影，权威在任务板 + git）===`)
    console.log(`  对账基准: ${git.rangeUsed}（${git.rangeNote}）`)
    console.log(`  投影面: ${statePath}（成员 ${projection.ok ? projection.members.length : '?'} 票；未推声称 ${projection.claim === null ? '无' : `${projection.claim.n} 笔 / ${projection.claim.shas.length} sha`})`)
    console.log(`  导出面: ${args.boardExport}（任务 ${board.tasks.length} 条${board.deletedRows.length > 0 ? `；deleted ${board.deletedRows.length} 条` : ''}）`)
    for (const f of result.hard) console.log(`  ✗ [${f.code}] ${f.message}`)
    for (const f of result.report) console.log(`  ⚠ [${f.code}] ${f.message}`)
    if (result.ok) console.log('  ✓ 投影 × 任务板 × git 三源一致（或仅报告级差异，如上显式列出）')
  }

  if (!result.ok) process.exit(1)
}

// 只有**直接执行**才跑 CLI：被 import（离线单测）时只暴露纯函数。
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
