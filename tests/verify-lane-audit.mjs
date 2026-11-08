/**
 * verify-lane-audit.mjs — lane-audit 纯逻辑的离线单测（scripts/lane-audit.mjs，#136）。
 *
 * 为什么离线测纯函数：CLI 那半截要 `gh` + frontier 子进程，落不进默认套件；而 lane-audit
 * 的判定规则（touch-set 解析 / 路径段前缀相交 / union-find 串行分组 / 四字段解析）是纯
 * 逻辑，必须每次都验。判据提纯自 sandcastle/templates/audit-ticket.mts 的 --touch-overlap
 * （它无测试——#136 补上这个缺口）。
 *
 * **非空洞扰动契约**：相交判定（pathsOverlap）若被摘掉/写死，L2/L3/L5 必红——测试对判定
 * 活性敏感。代码级扰动实录（摘判定 → 真 red → 复原 → 绿）落本票证据目录 perturb 文件。
 */
import { laneAudit, normalizePath, parseArgs, parseLaneFields, parseTouchSet, pathsOverlap, setsOverlap } from '../scripts/lane-audit.mjs'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const eq = (name, got, want) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a === b) ok(name, a)
  else bad(name, `got ${a} want ${b}`)
}

// ── L1：parseTouchSet（判据提纯自 audit-ticket.mts parseTouchSet + 反引号剥离）──────
eq('L1a. 逗号分隔 + 尾斜杠归一', parseTouchSet('docs/agents/, scripts/lane-audit.mjs/'), ['docs/agents', 'scripts/lane-audit.mjs'])
eq('L1b. 顿号/分号/换行/空白混分隔', parseTouchSet('docs/adr；tests/verify-lane-audit.mjs、CONTEXT.md\nREADME.md'), ['docs/adr', 'tests/verify-lane-audit.mjs', 'CONTEXT.md', 'README.md'])
eq('L1c. 列表符号剥离', parseTouchSet('- docs/agents/issue-tracker.md'), ['docs/agents/issue-tracker.md'])
eq('L1d. 反引号包裹的路径（票面行内代码形态）', parseTouchSet('`docs/agents/`, `scripts/lane-audit.mjs`'), ['docs/agents', 'scripts/lane-audit.mjs'])
eq('L1e. 反斜杠归一为斜杠', parseTouchSet('docs\\agents\\'), ['docs/agents'])
eq('L1f. 空输入 → 空数组（不是 undefined）', parseTouchSet(undefined), [])

// ── L2：pathsOverlap——路径**段**前缀，不是裸字符串前缀 ──────────────────────────
eq('L2a. 精确相等相交', pathsOverlap('docs/agents', 'docs/agents'), true)
eq('L2b. 目录声明与其中文件相交', pathsOverlap('docs/agents', 'docs/agents/issue-tracker.md'), true)
eq('L2c. 方向对称', pathsOverlap('docs/agents/issue-tracker.md', 'docs/agents'), true)
// 判据的正向负例：裸字符串前缀不算（差那根斜杠就不咬）——这是提纯源 pathsOverlap 的原义
eq('L2d. 裸字符串前缀不相交（docs-a/ vs docs/）', pathsOverlap('docs-a', 'docs'), false)
eq('L2e. 裸字符串前缀反向也不相交', pathsOverlap('docs', 'docs-a'), false)
eq('L2f. 同名不同树不相交（scripts/x.mjs vs tests/x.mjs）', pathsOverlap('scripts/x.mjs', 'tests/x.mjs'), false)

// ── L3：laneAudit 相交正例——判定摘掉（恒 false）时本组断言必红（非空洞扰动探针）──
const OVERLAP_TICKETS = [
  { number: 101, title: 'a', touchSet: ['docs/agents', 'scripts/lane-audit.mjs'] },
  { number: 102, title: 'b', touchSet: ['docs/agents/issue-tracker.md'] },
]
const overlapRun = laneAudit(OVERLAP_TICKETS)
eq('L3a. 相交票的 pairs 明细（含 shared 路径）', overlapRun.pairs, [{ a: 101, b: 102, shared: ['docs/agents'] }])
eq('L3b. 矩阵上三角格 = shared 路径数组', overlapRun.matrix[0][1], ['docs/agents'])
eq('L3c. 矩阵下三角与对角 = null', [overlapRun.matrix[1][0], overlapRun.matrix[1][1]], [null, null])
eq('L3d. 相交票进同一 serial 组', overlapRun.serialGroups.map((g) => [g.serial, g.tickets, g.overlapFiles]), [[true, [101, 102], ['docs/agents']]])
eq('L3e. serial 组存在时无 singleton', overlapRun.singletons, [])

// ── L4：laneAudit 不相交反例——无 pairs、无 serial 组、全部可并行 ─────────────────
// （fixture 路径刻意与 OVERLAP_TICKETS 独立——mixed 组合跑时不得制造幻影相交）
const DISJOINT_TICKETS = [
  { number: 201, title: 'a', touchSet: ['docs/adr'] },
  { number: 202, title: 'b', touchSet: ['scripts/regen-bundle.mjs'] },
  { number: 203, title: 'c', touchSet: ['tests/'] },
]
const disjointRun = laneAudit(DISJOINT_TICKETS)
eq('L4a. 不相交票零 pairs', disjointRun.pairs, [])
eq('L4b. 不相交票零 serial 组', disjointRun.serialGroups, [])
eq('L4c. 不相交票全部 singleton（可并行）', disjointRun.singletons, [201, 202, 203])
eq('L4d. 矩阵全空格（上三角 shared 皆空数组，第 i 行长 N-1-i）',
  disjointRun.matrix.map((row, i) => row.filter((_, j) => j > i)), [[[], []], [[]], []])

// ── L5：union-find 的**传递性**——A～B、B～C ⇒ 三票同组，但 A∩C 无直接明细 ─────────
const CHAIN_TICKETS = [
  { number: 301, title: 'a', touchSet: ['docs/agents'] },
  { number: 302, title: 'b', touchSet: ['docs/agents/issue-tracker.md', 'scripts/'] },
  { number: 303, title: 'c', touchSet: ['scripts/lane-audit.mjs'] },
]
const chainRun = laneAudit(CHAIN_TICKETS)
// 兜底取组（空组形态）：相交判定被摘掉时 serialGroups=[]，这里逐条 eq 红（不崩死整进程），
// 后面的不相交/解析用例照常跑——敏感性证据可见且不误伤。
const chainGroup = chainRun.serialGroups[0] ?? { tickets: [], overlapFiles: [] }
eq('L5a. 传递链三票进同一 serial 组', chainRun.serialGroups.map((g) => g.tickets), [[301, 302, 303]])
eq('L5b. pairs 只有直接相交的两条（A∩C 不存在）', chainRun.pairs.map((p) => [p.a, p.b]), [[301, 302], [302, 303]])
eq('L5c. 组 overlapFiles = 组内对间 shared 明细的并集（a 侧条目：docs/agents、scripts）', chainGroup.overlapFiles.slice().sort(), ['docs/agents', 'scripts'])

// ── L6：成员守恒——所有票都进 groups，不重不漏 ───────────────────────────────────
const mixed = laneAudit([...OVERLAP_TICKETS, ...DISJOINT_TICKETS])
eq('L6a. groups 覆盖全部票（serial 组 + singletons）',
  [...mixed.serialGroups.flatMap((g) => g.tickets), ...mixed.singletons].sort((a, b) => a - b),
  [101, 102, 201, 202, 203])
eq('L6b. 两个独立连通分量互不污染', mixed.serialGroups.map((g) => g.tickets), [[101, 102]])

// ── L7：parseLaneFields——样板票面四字段齐 + 缺字段响亮 ──────────────────────────
const SAMPLE_FACE = [
  '## 泳道票面',
  '',
  '- **touch-set**: `scripts/lane-audit.mjs`, `tests/verify-lane-audit.mjs`',
  '- **接口契约**: 新增独立 CLI 脚本，不改既有导出',
  '- **影响面**: 消费方 = Lead 排批流程；守护测试 = tests/verify-lane-audit.mjs；无跨模块集成用例',
  '- **proving**: `node tests/verify-lane-audit.mjs`',
].join('\n')
const fullFace = parseLaneFields(SAMPLE_FACE)
eq('L7a. 样板票面 touch-set 解析', fullFace.touchSet, ['scripts/lane-audit.mjs', 'tests/verify-lane-audit.mjs'])
eq('L7b. 样板票面四字段齐全（missing 空）', fullFace.missing, [])
eq('L7c. 接口契约值（剥反引号/加粗）', fullFace.interface, '新增独立 CLI 脚本，不改既有导出')
eq('L7d. proving 值', fullFace.proving, 'node tests/verify-lane-audit.mjs')

const bareFace = parseLaneFields('## 其它内容\n\n没有泳道票面节。')
eq('L7e. 无泳道票面节 → 四字段全缺', bareFace.missing, ['touch-set', '接口契约', '影响面', 'proving'])
eq('L7f. touchSet 为空数组（不是 undefined）', bareFace.touchSet, [])

const partialFace = parseLaneFields('## 泳道票面\n\n- touch-set: docs/agents/\n- 接口契约: 无')
eq('L7g. 部分票面 → missing 只列缺的字段', partialFace.missing, ['影响面', 'proving'])

// ── L8：字段名容错（加粗/反引号/大小写/中英文别名）────────────────────────────────
const aliasFace = parseLaneFields([
  '## 泳道票面',
  '',
  '* touchSet: docs/agents/',
  '* **interface**: 无',
  '* 影响面：消费方 = 排批流程',
  '* 证明命令: node tests/verify-lane-audit.mjs',
].join('\n'))
eq('L8a. touchSet 无连字符也认', aliasFace.touchSet, ['docs/agents'])
eq('L8b. interface 英文别名', aliasFace.interface, '无')
eq('L8c. 中文冒号 + 影响面', aliasFace.impact, '消费方 = 排批流程')
eq('L8d. 证明命令别名归 proving', aliasFace.proving, 'node tests/verify-lane-audit.mjs')
eq('L8e. 别名形态下四字段齐', aliasFace.missing, [])

// L8f：有节但行不在列表项字段形态——正文中间提到 touch-set 的散文行不误配
const midLine = parseLaneFields('## 泳道票面\n\n正文里说 touch-set 字段要有格式，但不是列表项字段行。')
eq('L8f. 节内非列表项行的 touch-set 字样不误配', midLine.missing.includes('touch-set'), true)

// ── L12（复审 #1）：解析域 = 「泳道票面」标题节内——围栏引用与散文定义都不算声明 ──
// 反例①：引用 issue-tracker.md 样板票面（代码围栏内）的普通批票 ≠ 声明票面
const fencedQuote = [
  '引用 docs/agents/issue-tracker.md 的样板：',
  '',
  '```markdown',
  '## 泳道票面',
  '',
  '- **touch-set**: `scripts/lane-audit.mjs`, `tests/verify-lane-audit.mjs`',
  '- **接口契约**: 新增独立 CLI 脚本，不改既有导出',
  '- **影响面**: 消费方 = Lead 排批流程；守护测试 = tests/verify-lane-audit.mjs；无跨模块集成用例',
  '- **proving**: `node tests/verify-lane-audit.mjs`',
  '```',
].join('\n')
const fencedFace = parseLaneFields(fencedQuote)
eq('L12a. 围栏内引用样板票面 ≠ 声明票面（四字段全缺）', fencedFace.missing, ['touch-set', '接口契约', '影响面', 'proving'])
eq('L12b. 围栏引用票的 touchSet 为空（不进相交审计）', fencedFace.touchSet, [])

// 反例②：票面散文/嵌套定义里出现四字段字样（#136 票面自身形态）≠ 声明票面
const proseDef = [
  '## 要落的东西',
  '',
  '1. 契约化票面四字段：',
  '   - **touch-set**：预期改动文件/目录；Lead 审计 lane 间**两两不相交**；',
  '   - **接口契约**：本票暴露/变更的导出、API、消息格式；',
  '   - **影响面**：消费方 + 守护测试；',
  '   - **proving 命令**：单票最小验证命令（tier ①/②），跑不了不进 lane。',
].join('\n')
const proseFace = parseLaneFields(proseDef)
eq('L12c. 散文/定义 bullet 里的四字段字样 ≠ 声明票面（#136 自身形态）', proseFace.missing, ['touch-set', '接口契约', '影响面', 'proving'])

// 反例③：四字段写进别的节（泳道票面节之外的标题下）不算——节体到下一个 ATX 标题截断
const wrongSection = parseLaneFields('## 其它节\n\n- touch-set: docs/agents/\n\n## 泳道票面\n\n- 接口契约: 无')
eq('L12d. 泳道票面节外的字段行不算（节体按标题截断）', wrongSection.missing, ['touch-set', '影响面', 'proving'])

// 标题容错：`泳道批票面` 名与行尾补充文字、任意级别标题都认
const tolerantTitle = parseLaneFields('### 泳道批票面（格式见 issue-tracker.md）\n\n- touch-set: docs/agents/\n- 接口契约: 无\n- 影响面: 无\n- proving: node tests/verify-lane-audit.mjs')
eq('L12e. 标题容错（级别/批字/行尾文字）', tolerantTitle.missing, [])

// ── L13（复审 #2）：空白分隔——文档与头注声称「空白分隔」，实现必须为真 ───────────
eq('L13a. 空格分隔两路径', parseTouchSet('docs/agents scripts/x.mjs'), ['docs/agents', 'scripts/x.mjs'])
eq('L13b. tab 分隔', parseTouchSet('docs/agents\tscripts/x.mjs'), ['docs/agents', 'scripts/x.mjs'])
eq('L13c. 反引号+空格授权形态（`docs/` `scripts/`）', parseTouchSet('`docs/` `scripts/`'), ['docs', 'scripts'])
eq('L13d. 空格分隔的相交判定成立（A 票空格串 ∩ B 票目录声明）',
  setsOverlap(parseTouchSet('docs/agents scripts/x.mjs'), ['docs/agents']), ['docs/agents'])

// ── L14（复审 #3）：输入乱序 → 输出按票号升序归一（matrix 上三角不撞 null）────────
const shuffledAudit = laneAudit([
  { number: 202, title: 'b', touchSet: ['docs'] },
  { number: 201, title: 'a', touchSet: ['docs'] },
])
eq('L14a. 乱序输入的 pairs 按票号升序', shuffledAudit.pairs, [{ a: 201, b: 202, shared: ['docs'] }])
eq('L14b. 乱序输入的 matrix 上三角格 = shared（201 < 202）', shuffledAudit.matrix[0][1], ['docs'])
eq('L14c. 乱序输入不产生 null 格读数（serial 组齐全）',
  shuffledAudit.serialGroups.map((g) => g.tickets), [[201, 202]])

// ── L9：setsOverlap 明细 ─────────────────────────────────────────────────────────
eq('L9a. a 中相交条目明细', setsOverlap(['docs/agents', 'scripts/'], ['docs/agents/x.md', 'other']), ['docs/agents'])
eq('L9b. 无交集 → 空明细', setsOverlap(['docs/'], ['scripts/']), [])

// ── L10：normalizePath 边界 ──────────────────────────────────────────────────────
eq('L10. normalizePath 三合一（反斜杠/尾斜杠/空白）', normalizePath(' docs\\agents\\ '), 'docs/agents')

eq('L11. parseArgs 解析 --issues/--frontier-json/--repo/--json',
  parseArgs(['--issues', '136,137', '--frontier-json', 'f.json', '--repo', 'o/r', '--json']),
  { issues: '136,137', frontierJson: 'f.json', repo: 'o/r', json: true })

console.log('\n=== LANE AUDIT VERIFY (offline, pure) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)
