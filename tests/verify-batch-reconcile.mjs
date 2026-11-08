/**
 * verify-batch-reconcile.mjs — batch-reconcile 纯逻辑离线单测 + 真夹具仓漂移实测
 * （scripts/batch-reconcile.mjs，#165）。
 *
 * 为什么双层：CLI 的判定规则（导出形状 / 投影解析 / 票集合与状态对齐 / 笔数与 sha 双向 diff /
 * 工作树对账）是纯逻辑，必须每次都验；票面验收②「人为制造一次漂移，验证响亮报错」要求对
 * **真脚本 CLI** 实测——C 组在 os.tmpdir() 下建真 git 夹具仓（照 tests/isolated-git.mjs 的
 * 隔离纪律：删全部 GIT_*、GIT_CONFIG_GLOBAL 指向夹具空文件、一律 `git -C <dir>`），
 * 逐类制造漂移（进度 / 笔数 / 假 sha / 工作树脏）断言 exit 1 且差异逐项出现在输出里，
 * 复原后 exit 0。
 *
 * 非空洞扰动契约：reconcile 的状态对齐判据（R3）若被摘掉/写死恒 true，R 组与漂移①必红；
 * 代码级扰动实录（摘判据 → 真 red → 复原 → 绿）落本票证据目录 perturb 文件。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseArgs,
  parseBoardExport,
  parseProjection,
  pickRange,
  reconcile,
  ShapeError,
  ticketNumbersFromTask,
} from '../scripts/batch-reconcile.mjs'
import { fixtureEnv, gitIn } from './isolated-git.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO, 'scripts', 'batch-reconcile.mjs')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const eq = (name, got, want) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a === b) ok(name, a)
  else bad(name, `got ${a} want ${b}`)
}
/** 断言 fn 抛 ShapeError 且 reason 含全部片段（形状校验的真红面）。 */
const throwsShape = (name, fn, ...fragments) => {
  try {
    fn()
    bad(name, '没有抛 ShapeError')
  } catch (e) {
    if (!(e instanceof ShapeError)) bad(name, `抛了 ${e.constructor.name} 而非 ShapeError：${e.message}`)
    else if (fragments.every((f) => e.message.includes(f))) ok(name, e.message)
    else bad(name, `消息缺片段 [${fragments.join('][')}]：${e.message}`)
  }
}

// ── B 组：parseBoardExport（导出形状 = 上游 TeamTaskView）───────────────────────

const GOOD_TASK = {
  id: 'task-1',
  revision: 1,
  subject: '#101 实现面',
  description: '改 scripts/ 与 tests/，关联 #101',
  status: 'completed',
  ownerName: 'lane-a',
  blockedBy: [],
  writeScopes: ['scripts/'],
  ready: false,
  writeScopeWarnings: [],
}

throwsShape('B1a. 坏 JSON → ShapeError', () => parseBoardExport('{ not json'), '不是合法 JSON')
throwsShape('B1b. 顶层数组 → ShapeError（应是 {tasks}）', () => parseBoardExport('[]'), '顶层应是')
throwsShape('B1c. 缺 tasks 数组 → ShapeError', () => parseBoardExport('{"foo":1}'), '缺 tasks 数组')
throwsShape(
  'B2. nextCursor 残留 = 截断导出 → ShapeError（S2：分页未取全禁被读成完整）',
  () => parseBoardExport(JSON.stringify({ tasks: [GOOD_TASK], nextCursor: 2 })),
  'nextCursor', '截断',
)
throwsShape(
  'B3a. 条目缺 status → ShapeError（点名缺的字段）',
  () => parseBoardExport(JSON.stringify({ tasks: [{ ...GOOD_TASK, status: undefined }] })),
  'tasks[0]', 'status',
)
throwsShape(
  'B3b. 条目未知 status 值 → ShapeError（枚举面）',
  () => parseBoardExport(JSON.stringify({ tasks: [{ ...GOOD_TASK, status: 'DONE' }] })),
  'status',
)
throwsShape(
  'B3c. 条目缺 ready → ShapeError（上游 schema 必需，宽松 = 假绿通道）',
  () => parseBoardExport(JSON.stringify({ tasks: [{ id: 'task-1', revision: 1, subject: 'x', description: 'y', status: 'pending' }] })),
  'tasks[0]', 'blockedBy, writeScopes, ready, writeScopeWarnings',
)
throwsShape('B3d. 条目非对象 → ShapeError', () => parseBoardExport(JSON.stringify({ tasks: ['task-1'] })), 'tasks[0]')
throwsShape(
  'B3e. 条目缺 description → ShapeError（上游 TASK_VIEW_SCHEMA required，#165 复审意见 3 补齐）',
  () => parseBoardExport(JSON.stringify({ tasks: [{ ...GOOD_TASK, description: undefined }] })),
  'tasks[0]', 'description',
)
throwsShape(
  'B3f. 条目缺 writeScopeWarnings → ShapeError（上游 required，与头注列出的必需面对齐）',
  () => parseBoardExport(JSON.stringify({ tasks: [{ ...GOOD_TASK, writeScopeWarnings: undefined }] })),
  'tasks[0]', 'writeScopeWarnings',
)

const goodBoard = parseBoardExport(JSON.stringify({ tasks: [GOOD_TASK] }))
eq('B4a. 合法导出解析通过（非 deleted 任务 1 条）', goodBoard.tasks.length, 1)
eq('B4b. 合法导出 deleted 行 0 条', goodBoard.deletedRows.length, 0)
const withDeleted = parseBoardExport(JSON.stringify({
  tasks: [GOOD_TASK, { ...GOOD_TASK, id: 'task-2', status: 'deleted' }],
}))
eq('B4c. deleted 行被分出（不参与票进度对账）', [withDeleted.tasks.length, withDeleted.deletedRows.length], [1, 1])

// ── P 组：parseProjection（判据与 verify-batch-state C9 同源）───────────────────

const STATE_OK = [
  '# Batch state — fixture',
  '',
  '## 成员与顺序',
  '',
  '| # | 票 | 状态 | 说明 |',
  '| --- | --- | --- | --- |',
  '| 1 | #101 | done @ abc1234 | lane=a |',
  '| 2 | #102 | *done* | lane=b |',
  '',
  '## 进度日志（每票结束更新）',
  '',
  '- 2026-11-08：**#101 实现完成** → 本地提交 `abc1234`（**未 push**）。',
  '  **未推送清单：**`abc1234`（1 票）',
  '',
].join('\n')

const pOk = parseProjection(STATE_OK)
eq('P1a. 成员表解析（票号 + 首词 done，`done @ sha` / `*done*` 都算）',
  pOk.members.map((m) => [m.issue, m.status]), [[101, 'done'], [102, 'done']])
eq('P1b. 声称解析（加粗起头的「未推送清单：」 + sha 提取）',
  [pOk.claim.n, pOk.claim.shas], [1, ['abc1234']])
eq('P1c. ok 标记', pOk.ok, true)

const pSticky = parseProjection(STATE_OK.replace('| 2 | #102 | *done* |', '| 2 | #102 | done（#114）|'))
eq('P2. 粘连形态（done（#114））不算 done（C9 判据同源：无空格首词≠done）',
  pSticky.members.map((m) => [m.issue, m.status]), [[101, 'done'], [102, 'done（#114）'.toLowerCase()]])

// 多行清单 + 「（N 票；实测 …）」后缀容忍（照抄 CLAIM_RE 的三个设计点）
const STATE_MULTILINE = STATE_OK.replace(
  '  **未推送清单：**`abc1234`（1 票）',
  '  **未推送清单：**\n  未推送的 `abc1234` 逐条列出（1 票；实测 = git rev-list --count main..HEAD）',
)
const pMulti = parseProjection(STATE_MULTILINE)
eq('P3a. 多行清单 + 后缀容忍（claim 正常解析）', [pMulti.claim.n, pMulti.claim.shas], [1, ['abc1234']])

// 多条「未推送清单」并存 = 历史行累积的**常态**（每票一行，C9 头注「不要求删历史行」）：
// 实测行为 = 读**末条**（N 与 sha 都来自末条；跨界 match 会吞中途行，所以取值面走末条起点
// 单切）。#115 复测教训：契约按复测后的机制书写，不照抄旧注释的说法。
const pTwo = parseProjection(STATE_OK + '\n- 另一行 **未推送清单：`deadbee`（1 票）**\n')
eq('P3b. 多条清单并存（历史行累积常态）→ 读末条（N 与 sha 都来自末条）', [pTwo.ok, pTwo.claim.n, pTwo.claim.shas], [true, 1, ['deadbee']])
const pLastBroken = parseProjection(STATE_OK + '\n- 另一行 **未推送清单：`deadbee`（没写笔数）\n')
eq('P3c. 末条形态漂（无「（N 票」收尾）→ claim=null 响亮哑掉（不静默退回历史行）',
  [pLastBroken.ok, pLastBroken.claim], [true, null])

const pNoClaim = parseProjection(STATE_OK.replace(/  \*\*未推送清单[\s\S]*?1 票）\n/, ''))
eq('P4a. 无声称 → ok:true 但 claim=null（R7-claim-absent 在 reconcile 里响亮）',
  [pNoClaim.claim, pNoClaim.ok], [null, true])
const pBrokenTail = parseProjection(STATE_OK.replace(/  \*\*未推送清单[\s\S]*?1 票）\n/, '  **未推送清单：**\`abc1234\`（没写笔数）\n'))
eq('P4b. 声称存在但无「（N 票」收尾 → claim=null（合规 0 条，C9-claims 同判）',
  [pBrokenTail.claim, pBrokenTail.reason !== undefined], [null, true])

// P6：关联面 = subject（#165 复审意见 2 收窄）——description 里的 #N 是交叉引用，不建映射
eq('P6a. ticketNumbersFromTask 只扫 subject（description 的 #N 不参与）',
  ticketNumbersFromTask({ subject: '#101 实现面', description: '收口杂务，关联 #999 与被 #137 阻塞' }), [101])
eq('P6b. subject 多票号照常识别', ticketNumbersFromTask({ subject: '#101+#102 联合收口', description: '' }), [101, 102])

for (const [name, mutate] of [
  ['P5a. 缺「成员与顺序」节 → 解析失败', (s) => s.replace('## 成员与顺序', '## 别的节')],
  ['P5b. 节内无表格 → 解析失败', (s) => s.replace(/\| # \| 票 [\s\S]*?lane=b \|/, '')],
  ['P5c. 表头无「状态」列 → 解析失败', (s) => s.replace('状态', '状况')],
  ['P5d. 数据行缺列 → 解析失败', (s) => s.replace('| 2 | #102 | *done* | lane=b |', '| 2 | #102 |')],
  ['P5e. 票号列读不出 #N → 解析失败', (s) => s.replace('| 2 | #102 |', '| 2 | 一百零二 |')],
]) {
  const r = parseProjection(mutate(STATE_OK))
  eq(name, [r.ok, r.reason !== undefined], [false, true])
}

// ── G 组：pickRange（对账基准三态）───────────────────────────────────────────────

eq('G1. 显式 --range 直通', pickRange({ rangeArg: 'develop~3..HEAD', originExists: true, mainExists: true, branch: 'develop' }),
  { range: 'develop~3..HEAD', note: '显式 --range develop~3..HEAD' })
eq('G2. origin/<branch> 在场 → 常态基准', pickRange({ rangeArg: undefined, originExists: true, mainExists: true, branch: 'develop' }),
  { range: 'origin/develop..HEAD', note: '基准 origin/develop 在场' })
eq('G3. origin 缺席 → fallback main..HEAD（显式声明）',
  pickRange({ rangeArg: undefined, originExists: false, mainExists: true, branch: 'develop' }).range, 'main..HEAD')
eq('G3b. fallback note 显式声明', pickRange({ rangeArg: undefined, originExists: false, mainExists: true, branch: 'develop' }).note.includes('fallback'), true)
eq('G4. 两基准全缺席 → error（响亮拒绝，不是「没有差异」）',
  'error' in pickRange({ rangeArg: undefined, originExists: false, mainExists: false, branch: 'lane-x' }), true)

// ── R 组：reconcile 判定面（hard=非零驱动；report=显式报告项）────────────────────

const boardOf = (tasks) => parseBoardExport(JSON.stringify({ tasks }))
const projOf = (md) => parseProjection(md)
const GIT_CLEAN = { rangeUsed: 'main..HEAD', rangeNote: 'fallback', count: 1, shas: ['abc1234'], porcelain: [] }
/** STATE_OK 的成员表是两票（#101/#102）——R 组一致态的板要两票任务都给足。 */
const GOOD_TASK2 = { ...GOOD_TASK, id: 'task-2', subject: '#102 实现面', description: 'b.txt', status: 'completed' }
const BOARD_BOTH = boardOf([GOOD_TASK, GOOD_TASK2])

const rAllGood = reconcile({
  board: BOARD_BOTH,
  projection: projOf(STATE_OK),
  git: GIT_CLEAN,
})
eq('R1. 全一致 → ok（两票 done ↔ completed，笔数 1=1，sha 双向命中，工作树净）', rAllGood.ok, true)
eq('R1b. 无 hard 项', rAllGood.hard, [])

const rProg = reconcile({
  board: boardOf([{ ...GOOD_TASK, status: 'in_progress' }, GOOD_TASK2]),
  projection: projOf(STATE_OK),
  git: GIT_CLEAN,
})
eq('R2a. 投影 done ↔ 板上 in_progress → hard（票进度漂移）', rProg.ok, false)
eq('R2b. hard 项点名 R3-status-mismatch 与票号、两侧读数',
  rProg.hard.some((h) => h.code === 'R3-status-mismatch' && h.message.includes('#101') && h.message.includes('in_progress')), true)

const rStale = reconcile({
  board: BOARD_BOTH,
  projection: projOf(STATE_OK.replace('| 1 | #101 | done @ abc1234 |', '| 1 | #101 | ready-for-agent |')),
  git: GIT_CLEAN,
})
eq('R2c. 板上 completed ↔ 投影未标 done → hard（反向漂移）', rStale.hard.some((h) => h.code === 'R3-status-mismatch'), true)

const rNoBoard = reconcile({
  board: boardOf([GOOD_TASK]),
  projection: projOf(STATE_OK),
  git: GIT_CLEAN,
})
eq('R3a. 成员表有票但板上无 #102 任务 → hard', rNoBoard.hard.some((h) => h.code === 'R2-member-missing-on-board' && h.message.includes('#102')), true)

const rNoProj = reconcile({
  board: boardOf([GOOD_TASK, GOOD_TASK2]),
  projection: projOf(STATE_OK.replace('| 2 | #102 | *done* | lane=b |', '')),
  git: GIT_CLEAN,
})
eq('R3b. 板上有 #102 任务但成员表缺行 → hard（权威有票投影缺行）', rNoProj.hard.some((h) => h.code === 'R2-board-task-missing-in-projection'), true)

const rCount = reconcile({
  board: BOARD_BOTH,
  projection: projOf(STATE_OK.replace('（1 票）', '（3 票）')),
  git: GIT_CLEAN,
})
eq('R4a. 笔数声称 3 ≠ 实测 1 → hard +「声称 X / 实测 Y」双数字', rCount.hard.some((h) => h.code === 'R4-claim-vs-count' && h.message.includes('声称 3') && h.message.includes('实测')), true)

const rSha = reconcile({
  board: BOARD_BOTH,
  projection: projOf(STATE_OK.replace('abc1234`（1 票', 'deadbee0000`（1 票')),
  git: GIT_CLEAN,
})
eq('R4b. 声称 sha 不在实测 range → hard（假 sha 漂移）', rSha.hard.some((h) => h.code === 'R5-sha-listed-not-in-range'), true)

const rUnlisted = reconcile({
  board: BOARD_BOTH,
  projection: projOf(STATE_OK),
  git: { ...GIT_CLEAN, count: 2, shas: ['abc1234567', 'bcdef01abcdef'] },
})
eq('R4c. 实测 range 里有但声称未列 → hard（漏报方向，S1）', rUnlisted.hard.some((h) => h.code === 'R5-sha-in-range-not-listed' && h.message.includes('bcdef01')), true)

const rShortHit = reconcile({
  board: BOARD_BOTH,
  projection: projOf(STATE_OK),
  git: { ...GIT_CLEAN, shas: ['abc1234deadbeef00'] },
})
eq('R4d. 声称 7 位短 sha = 实测长 sha 前缀 → 命中（git 短 sha 语义）', rShortHit.hard.filter((h) => h.code.startsWith('R5')), [])

const rNoClaim = reconcile({
  board: BOARD_BOTH,
  projection: projOf(STATE_OK.replace(/  \*\*未推送清单[\s\S]*?1 票）\n/, '')),
  git: GIT_CLEAN,
})
eq('R5. 投影无合规声称 → hard（R7-claim-absent：缺席必响亮）', rNoClaim.hard.some((h) => h.code === 'R7-claim-absent'), true)

const rUnreadable = reconcile({
  board: BOARD_BOTH,
  projection: projOf('# Batch state — x\n\n没有成员表'),
  git: GIT_CLEAN,
})
eq('R6a. 投影面解析失败 → hard（R7-projection-unreadable）', rUnreadable.hard.some((h) => h.code === 'R7-projection-unreadable'), true)

const rDirty = reconcile({
  board: BOARD_BOTH,
  projection: projOf(STATE_OK),
  git: { ...GIT_CLEAN, porcelain: ['?? stray.md'] },
})
eq('R6b. 工作树非净 → hard 且逐项列出（stray.md 在消息里）', rDirty.hard.some((h) => h.code === 'R6-worktree-dirty' && h.message.includes('stray.md')), true)

const rReportOnly = reconcile({
  board: boardOf([GOOD_TASK, GOOD_TASK2, { ...GOOD_TASK, id: 'task-9', subject: '批末收口杂务', description: '不含票号', status: 'pending' }]),
  projection: projOf(STATE_OK),
  git: GIT_CLEAN,
})
eq('R7a. 板上无票号任务 = 报告级（不非零）', [rReportOnly.ok, rReportOnly.report.some((f) => f.code === 'I-board-task-no-issue')], [true, true])
eq('R7b. 报告项显式出现 ≠ 静默吞（未完任务列出）', rReportOnly.report.some((f) => f.code === 'I-board-unfinished'), true)

// R8：关联面 = subject 的正反例（#165 复审意见 2）——description 交叉引用不拖进 R2 双向 diff
const rXref = reconcile({
  board: boardOf([
    { ...GOOD_TASK, subject: '#101 实现面', description: '批末收口杂务，关联 #999 与被 #137 阻塞' },
    GOOD_TASK2,
  ]),
  projection: projOf(STATE_OK),
  git: GIT_CLEAN,
})
eq('R8a. description 里的 #N（#999/#137）是交叉引用不参与关联 → 无 R2 假红',
  rXref.hard.some((h) => h.code.startsWith('R2')), false)
eq('R8b. 其余判据不受影响 → ok', rXref.ok, true)
const rSubjStill = reconcile({
  board: boardOf([{ ...GOOD_TASK, subject: '#101 实现面（关联 #999）', description: 'x' }]),
  projection: projOf(STATE_OK),
  git: GIT_CLEAN,
})
eq('R8c. subject 里的 #N 仍参与关联（板上无 #102 任务 → R2 硬照触发）',
  rSubjStill.hard.some((h) => h.code === 'R2-member-missing-on-board' && h.message.includes('#102')), true)

// ── C 组：真夹具仓 CLI 漂移实测（票面验收②）────────────────────────────────────

const TMP = mkdtempSync(join(tmpdir(), 'dsh-matt-reconcile-'))
const FIX = join(TMP, 'repo')
mkdirSync(FIX, { recursive: true })
const GITCFG = join(TMP, '.gitconfig')
writeFileSync(GITCFG, '')
const env = fixtureEnv({ GIT_CONFIG_GLOBAL: GITCFG, GIT_CONFIG_SYSTEM: GITCFG })
const G = gitIn(FIX, env)
const g = (...args) => {
  const r = G(...args)
  if (r.status !== 0) throw new Error(`夹具 git ${args.join(' ')} 失败: ${r.stderr}`)
  return (r.stdout ?? '').trim()
}

let fixtureReady = true
try {
  // 夹具仓：main 1 笔 + develop 2 笔（无 origin → 对账基准走 fallback main..HEAD）
  // ⚠ init -b 的效力随宿主调用面而变（verify-batch-state C9b 实测教训）：unborn 分支名
  // 在首次提交时才落成引用，首次提交前显式 `symbolic-ref HEAD refs/heads/main` 才是与
  // 宿主无关的写法——否则 HEAD 落到 master，`main..HEAD` fallback 的两端成无关根，
  // fallback 基准缺席 → 全组假红。
  g('init', '-q', '-b', 'main')
  writeFileSync(join(FIX, '.gitignore'), '.scratch/\n')
  writeFileSync(join(FIX, 'README.md'), 'fixture\n')
  g('add', '.gitignore', 'README.md')
  g('symbolic-ref', 'HEAD', 'refs/heads/main')
  g('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'base')
  if (g('symbolic-ref', '--short', 'HEAD') !== 'main') throw new Error('夹具 base 分支不是 main（init -b 未生效）')
  g('checkout', '-q', '-b', 'develop')
  writeFileSync(join(FIX, 'a.txt'), 'a\n')
  g('add', 'a.txt')
  g('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'fix(#101): a')
  writeFileSync(join(FIX, 'b.txt'), 'b\n')
  g('add', 'b.txt')
  g('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'fix(#102): b')
  // 检查点：unborn 分支名陷阱（verify-batch-state C9b 教训）——init 后分支必须是 develop
  if (g('symbolic-ref', '--short', 'HEAD') !== 'develop') throw new Error('夹具分支不是 develop')
  const shas = g('log', '--format=%h', 'main..HEAD').split('\n')
  if (shas.length !== 2) throw new Error(`夹具 develop 上应有 2 笔，实得 ${shas.length}`)

  mkdirSync(join(FIX, '.scratch'), { recursive: true })
  const boardPath = join(TMP, 'board-export.json')
  const statePath = join(FIX, '.scratch', 'batch-state.md')

  const writeState = (row2Status, claimN, shaOverride) => {
    const [s1, s2] = shas
    const first = shaOverride !== undefined ? shaOverride : s1
    writeFileSync(statePath, [
      '# Batch state — fixture',
      '',
      '## 成员与顺序',
      '',
      '| # | 票 | 状态 | 说明 |',
      '| --- | --- | --- | --- |',
      `| 1 | #101 | done @ ${s1} | lane=a；后继票=#102 |`,
      `| 2 | #102 | ${row2Status} | lane=b |`,
      '',
      '## 进度日志（每票结束更新）',
      '',
      `- 2026-11-08：**#101 实现完成** → 本地提交 \`${s1}\`（**未 push**）。`,
      `  **未推送清单：**\`${first}\` \`${s2}\`（${claimN} 票）`,
      '',
      'retro: done @ ' + s2,
      '',
    ].join('\n'))
  }
  const writeBoard = (task2Status) => {
    writeFileSync(boardPath, JSON.stringify({
      tasks: [
        { id: 'task-1', revision: 2, subject: '#101 实现面', description: 'a.txt', status: 'completed', blockedBy: [], writeScopes: ['a.txt'], ready: false, writeScopeWarnings: [] },
        { id: 'task-2', revision: 3, subject: '#102 实现面', description: 'b.txt', status: task2Status, ownerName: 'lane-b', blockedBy: [], writeScopes: ['b.txt'], ready: false, writeScopeWarnings: [] },
      ],
    }, null, 2))
  }

  /** 跑真 CLI（子进程），拼 stdout+stderr 与 exit code。 */
  const runCli = () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--board-export', boardPath, '--repo', FIX], { encoding: 'utf8', env, windowsHide: true })
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }

  // 一致态：投影（2 票 done，声称 2 笔 = 2 个真 sha）× 导出（两任务 completed）× git（main..HEAD 2 笔）
  writeState('done', 2)
  writeBoard('completed')
  const c0 = runCli()
  eq('C0a. 夹具一致态 → exit 0（对账一致）', c0.code, 0)
  eq('C0b. 输出显式声明 fallback 基准（main..HEAD）', c0.out.includes('main..HEAD') && c0.out.includes('fallback'), true)

  // 漂移①：进度漂移——投影标 done 而板上 in_progress → 响亮 exit 1 + 两侧读数
  writeBoard('in_progress')
  const c1 = runCli()
  eq('C1a. 漂移①进度（done vs in_progress）→ exit 1', c1.code, 1)
  eq('C1b. 差异逐项出现（票号 + R3 码 + 板上读数）', c1.out.includes('#102') && c1.out.includes('R3-status-mismatch') && c1.out.includes('in_progress'), true)

  // 漂移②：笔数漂移——声称 3 笔 / 实测 2 笔 → 响亮 exit 1 + 双数字
  writeState('done', 3)
  writeBoard('completed')
  const c2 = runCli()
  eq('C2a. 漂移②笔数（声称 3 / 实测 2）→ exit 1', c2.code, 1)
  eq('C2b. 「声称 3 / 实测 2」双数字出现（R4-claim-vs-count）', c2.out.includes('声称 3') && c2.out.includes('2'), true)

  // 漂移③：假 sha——声称列出的 sha 不在实测 range → 响亮 exit 1
  writeState('done', 2, 'deadbee0000')
  const c3 = runCli()
  eq('C3a. 漂移③假 sha → exit 1', c3.code, 1)
  eq('C3b. R5 码 + 假 sha 出现', c3.out.includes('R5-sha-listed-not-in-range') && c3.out.includes('deadbee0000'), true)

  // 漂移④：工作树漂移——夹具仓落一个未跟踪文件 → 响亮 exit 1 + 逐项列出
  writeState('done', 2)
  writeFileSync(join(FIX, 'stray.md'), 'stray\n')
  const c4 = runCli()
  eq('C4a. 漂移④工作树非净 → exit 1', c4.code, 1)
  eq('C4b. R6 码 + stray.md 出现', c4.out.includes('R6-worktree-dirty') && c4.out.includes('stray.md'), true)
  rmSync(join(FIX, 'stray.md'), { force: true })

  // 复原 → 绿
  const c5 = runCli()
  eq('C5. 全部漂移复原 → exit 0（复绿）', c5.code, 0)
} catch (e) {
  fixtureReady = false
  bad('C. 夹具仓/CLI 漂移实测可跑', e.message)
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

// C 组整组缺席时响亮（不静默当绿）：上面 catch 已 bad，这里再补一条总闸
if (!fixtureReady) bad('C6. 夹具实测整组在场', '夹具跑挂——验收②没有实测，见上一条 ✗ 的原因')

// ── 参数解析 ─────────────────────────────────────────────────────────────────────

eq('X1. parseArgs 全量',
  parseArgs(['--board-export', 'b.json', '--state', 's.md', '--repo', 'r', '--range', 'a..b', '--json']),
  { boardExport: 'b.json', state: 's.md', repo: 'r', range: 'a..b', json: true })

console.log('\n=== BATCH RECONCILE VERIFY (offline pure + fixture CLI drift) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)
