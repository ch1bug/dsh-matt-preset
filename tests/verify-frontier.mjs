/**
 * verify-frontier.mjs — ready frontier 纯逻辑的离线单测（scripts/frontier.mjs）。
 *
 * 为什么离线测纯函数：CLI 那半截要 `gh` + 网络，落不进默认套件；而 frontier 的判定规则
 * （label 命中 / open 阻塞 / assignee / 已满足的历史边）是纯逻辑，必须每次 `pnpm test`
 * 都验。最重要的一条断言是 **正文文字不影响结果**——那正是这个脚本存在的理由
 * （2026-10-16 曾据正文误判"缺边"）。
 */
import { DEFAULT_LABEL, parseArgs, readyFrontier } from '../scripts/frontier.mjs'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const eq = (name, got, want) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a === b) ok(name, a)
  else bad(name, `got ${a} want ${b}`)
}

const ISSUES = [
  // 正文声称被 #999 阻塞，但依赖图里没有边 → 必须进 frontier（正文不作数）
  // state 用大写 "OPEN"：`gh issue list --json state` 的真实形状（首版真跑时正是这里
  // 让小写比较把全部票丢掉——fixture 必须照抄线上形状）
  { number: 10, title: 'free', labels: ['enhancement', 'ready-for-agent'], assignees: [], state: 'OPEN', body: '正文乱写：Blocked by #999' },
  // 正文写 "None."，但依赖图里有 open 阻塞 #9 → 必须被 gate（正文不作数）
  { number: 11, title: 'blocked', labels: ['bug', 'ready-for-agent'], assignees: [], state: 'open', body: '## Blocked by\n\nNone.' },
  { number: 12, title: 'assigned', labels: ['ready-for-agent'], assignees: ['ch1bug'], state: 'open' },
  { number: 13, title: 'human-work', labels: ['ready-for-human'], assignees: [], state: 'open' },
  { number: 14, title: 'closed-one', labels: ['ready-for-agent'], assignees: [], state: 'CLOSED' },
  { number: 15, title: 'human-free', labels: ['ready-for-human'], assignees: [], state: 'open' },
]
/** 只放 **open** 阻塞；#11 有一条；其余票的历史边已满足 → 不在表里。 */
const OPEN_BLOCKERS = new Map([[11, [9]]])

const defaultRun = readyFrontier(ISSUES, OPEN_BLOCKERS)

eq('F1. 默认 label 的 frontier = 无 open 阻塞 + 无 assignee 的 ready-for-agent', defaultRun.frontier.map(i => i.number), [10])
eq('F2. 被 gate 的票与理由（blockers / assignees）', defaultRun.gated.map(i => [i.number, i.blockers, i.assignees]), [[11, [9], []], [12, [], ['ch1bug']]])
if (!defaultRun.frontier.some(i => i.number === 14) && !defaultRun.gated.some(i => i.number === 14)) ok('F3. 非 open 的票两边都不进')
else bad('F3. closed 票被算进结果')
if (!defaultRun.frontier.some(i => i.number === 13) && !defaultRun.gated.some(i => i.number === 13)) ok('F4. label 不命中的票不进任何一边')
else bad('F4. 非目标 label 被算进结果')

// F5：脚本存在的理由——正文文字不参与判定（两条相反方向的例子）
if (defaultRun.frontier.some(i => i.number === 10) && defaultRun.gated.some(i => i.number === 11))
  ok('F5. 正文的 "Blocked by" 文字不影响结果（权威是依赖图）')
else bad('F5. 正文文字影响了判定')

// F6：已满足的历史边（不在 open 集合里）不 gate；换 label 后语义一致
const humanRun = readyFrontier(ISSUES, OPEN_BLOCKERS, { label: 'ready-for-human' })
eq('F6. --label 切换：ready-for-human 的 frontier', humanRun.frontier.map(i => i.number), [13, 15])
eq('F6b. 切 label 后无人被 gate', humanRun.gated.map(i => i.number), [])

// F7：输入乱序时按票号升序输出
const shuffled = [ISSUES[1], ISSUES[4], ISSUES[0], ISSUES[3], ISSUES[2], ISSUES[5]]
eq('F7. 输出按票号升序（输入乱序）', readyFrontier(shuffled, OPEN_BLOCKERS).frontier.map(i => i.number), [10])

if (DEFAULT_LABEL === 'ready-for-agent') ok('F8. 默认 label 是 ready-for-agent')
else bad('F8. 默认 label', DEFAULT_LABEL)

eq('F9. parseArgs 解析 --repo/--label/--json', parseArgs(['--repo', 'o/r', '--label', 'ready-for-human', '--json']), { repo: 'o/r', label: 'ready-for-human', json: true })

// F10（#142）：P0 可见标记——`p0` 字段只反映标签存在与否，且不改变排序/成员判定。
// 非空洞对照：把 #10 的 P0 摘掉必须真红（p0 翻 false）。
const p0Issues = [
  { ...ISSUES[0], labels: ['enhancement', 'ready-for-agent', 'P0'] },
  { ...ISSUES[1], labels: ['bug', 'ready-for-agent'] },
  { ...ISSUES[2], labels: ['ready-for-agent', 'P0'] },
  { number: 2, title: 'p0-earlier', labels: ['ready-for-agent', 'P0'], assignees: [], state: 'open' },
  // 非 P0 夹层：若排序被改成「P0 优先再按票号」，输出会变 [2,10,5]——F10c 因此可红（byNumber 恒 [2,5,10]）
  { number: 5, title: 'not-p0', labels: ['ready-for-agent'], assignees: [], state: 'open' },
]
const p0Run = readyFrontier(p0Issues, OPEN_BLOCKERS)
eq('F10a. frontier 项带 p0=true（挂 P0）', p0Run.frontier.map(i => [i.number, i.p0]), [[2, true], [5, false], [10, true]])
eq('F10b. gated 项也带 p0 标记', p0Run.gated.map(i => [i.number, i.p0]), [[11, false], [12, true]])
eq('F10c. P0 不驱动排序——非 P0 的 #5 夹在两张 P0 票之间，仍按票号升序', p0Run.frontier.map(i => i.number), [2, 5, 10])
const noP0Run = readyFrontier([{ ...ISSUES[0], labels: ['enhancement', 'ready-for-agent'] }], OPEN_BLOCKERS)
eq('F10d. 摘掉 P0 后 p0=false（探针可红）', noP0Run.frontier.map(i => i.p0), [false])

console.log('\n=== FRONTIER VERIFY (offline, pure) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)