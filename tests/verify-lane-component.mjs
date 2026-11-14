/**
 * verify-lane-component.mjs — #137：泳道组件正文与运行手册的判据一致性守卫。
 *
 * 为什么单独一个守卫：lane 的判据有**两处承载**——组件正文
 * `workflow-component-lane.txt`（注入 Lead 会话的判据语义）与运行手册
 * `docs/lane-batch.md`（操作 runbook）。票面 AC3 要求「能力检测与降级语义，组件正文
 * 与手册各一处，判据一致」——两处各写一份就会漂，本守卫把一致性变成机械断言：
 * 关键判据词形在**两个**文件都必须在场（多 carrier 断言，#135 P135_CARRIERS 同款），
 * 组件引用的脚本/文档 target 必须存在（SG4 同款：引用必须是活的）。
 *
 * 断言面：
 *   L1  组件文件与两节标记（锚序：lane-batch 锚骨架节 enforcement-recovery，
 *       lane-orchestration 链在 lane-batch 后——lane 不依赖 batch 节在场）。
 *   L2  注册面：workflow-core.mjs 的 COMPONENTS.lane 指向该文件、sectionIds 与
 *       节标记一致（import 模块本身，不手抄注册表）。
 *   L3  能力检测与降级判据双承载（组件 + 手册）：#189 改判后判据 =
 *       `subagent`（或 `subagent_fork`）+ `create_worktree` 两件齐（spawn_teammate
 *       已于上游 rc.3 移除——判据句回潮旧 API 名即红）；实装探针（#186 候选 2：
 *       bundles 声明 vs node_modules 实装 = 安装断层，双承载）；forge-bundle 指称、
 *       串行 batch 降级 + D47、装不齐顺延不造假。判据句（组件 probe 句 / 手册
 *       「查什么」bullet）做**段级**断言——削成单工具也红。
 *   T   非空洞（内存扰动，零树写入）：判据句削成单工具、旧 API 名回潮（组件 +
 *       手册两侧）、摘 rc.3 移除注记、摘 upgrade-guide 指针、摘实装探针段——
 *       每个扰动都必须让 l3Missing 转 RED。
 *   L4  手册承载 AC1/AC3 操作要素：lane-audit 收敛、默认 3 上限 4、link-runtime-deps、
 *       lane-disk-guard、20 GB 默认 + lane-gates.yml 覆写、batch-reconcile、
 *       整批一 PR + merge 恒 human 门、npm alpha.2 不采、fresh context、notes 仓外、
 *       target/ 红线。
 *   L5  组件正文引用的文件 target 全部存在（缺席 = 死引用，响亮红）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (rel) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

let component
let manual
try {
  component = read('workflow-component-lane.txt')
} catch (error) {
  bad('L0. 组件文件可读', String(error?.message ?? error))
  report('LANE COMPONENT VERIFY (#137)')
}
try {
  manual = read('docs/lane-batch.md')
} catch (error) {
  bad('L0. 手册可读', String(error?.message ?? error))
  report('LANE COMPONENT VERIFY (#137)')
}

// ── L1: 组件结构与锚序 ────────────────────────────────────────────────────────
{
  const markers = [...component.matchAll(/^@@ (.+)$/gm)].map(m => m[1])
  const want = ['lane-batch after=enforcement-recovery', 'lane-orchestration after=lane-batch']
  if (markers.length === want.length && want.every((w, i) => markers[i] === w))
    ok('L1. 组件两节标记与锚序正确（lane 锚骨架节，不依赖 batch 节在场）', markers.join(' | '))
  else bad('L1. 组件节标记', `got: ${markers.join(' | ')}`)

  const banned = [...component.matchAll(/^@@ .*(tight).*$/gm)]
  if (banned.length === 0) ok('L1b. 组件 delta 不声明 tight（tight 属骨架位置，delta 声明即响亮抛）')
  else bad('L1b. 组件 delta 带 tight 标记', banned.map(m => m[0]).join(' / '))
}

// ── L2: 注册面（读模块，不手抄）──────────────────────────────────────────────
{
  let core = null
  try {
    core = await import(pathToFileURL(join(REPO, 'workflow-core.mjs')).href)
  } catch (error) {
    bad('L2. workflow-core 可导入', String(error?.message ?? error))
  }
  if (core !== null) {
    const lane = core.COMPONENTS?.lane
    const deltaName = lane?.delta instanceof URL ? lane.delta.pathname.split('/').at(-1) : String(lane?.delta)
    if (deltaName === 'workflow-component-lane.txt' && lane?.sectionIds?.join(',') === 'lane-batch,lane-orchestration')
      ok('L2. COMPONENTS.lane 注册面与组件文件/节 id 一致', `sectionIds: ${lane.sectionIds.join(', ')}`)
    else bad('L2. COMPONENTS.lane 注册面', JSON.stringify({ delta: deltaName, sectionIds: lane?.sectionIds }))
    if (core.DEFAULT_COMPONENTS?.includes('lane'))
      ok('L2b. lane 默认全开（DEFAULT_COMPONENTS 含 lane——注册即默认，#58 同款）')
    else bad('L2b. lane 未默认挂载', JSON.stringify(core.DEFAULT_COMPONENTS))
  }
}

// ── L3: 能力检测与降级判据双承载（组件 + 手册）─────────────────────────────────
// #189 改判：判据 = `subagent`（或 `subagent_fork`）+ `create_worktree` 两件齐；
// spawn_teammate 已于上游 rc.3 移除（连同 Team-scoped send_message/list_agents/
// interrupt_agent）——组件/手册的判据句（probe 句 / 「查什么」bullet）里回潮旧
// API 名即红。实装探针（#186 候选 2）：bundles 声明在 profile 而包未实装 =
// 「安装断层」，区别于笼统「工具缺席」——双承载锚在此钉住。

const componentNeeds = [
  ['判据工具 subagent（fresh 面）', /`subagent`|`subagent_fork`/],
  ['判据工具 create_worktree', /`create_worktree`/],
  ['工具面判据（非版本号猜测）', /SESSION TOOL SURFACE|tool names are callable|never a version/],
  ['rc.3 起 spawn_teammate 已移除（迁移注记）', /spawn_teammate[\s\S]{0,120}REMOVED|REMOVED[\s\S]{0,60}spawn_teammate/],
  ['旧判据在 rc.3 下永不满足（禁用句）', /must not be used/],
  ['迁移映射 fresh', /`subagent` for fresh teammates/],
  ['迁移映射 inherited', /`subagent_fork` for inherited/],
  ['迁移映射 by-id 消息', /send_message\(\{ agent_id, message \}\)/],
  ['upgrade-guide 指针', /upstream upgrade guide/],
  ['实装探针（install gap ≠ tool absent）', /INSTALL GAP/],
  ['实装探针声明面', /dsh\.profile\.bundles/],
  ['实装探针 lock/日志面', /lock file[\s\S]{0,200}deny lines|deny lines[\s\S]{0,200}lock file/],
  ['forge-bundle 指称', /forge-bundle/],
  ['串行 batch 降级 + D47', /serial batch mode[\s\S]{0,200}D47|D47[\s\S]{0,200}serial batch/],
  ['装不齐顺延不造假', /POSTPONED|fakes parallel lanes/],
]
const manualNeeds = [
  ['判据工具 subagent（fresh 面）', /`subagent`|`subagent_fork`/],
  ['判据工具 create_worktree', /`create_worktree`/],
  ['两件齐判据', /两件齐/],
  ['工具面判据（非版本号猜测）', /工具面/],
  ['rc.3 起 spawn_teammate 已移除（迁移注记）', /spawn_teammate[\s\S]{0,200}已移除/],
  ['迁移映射（fresh / fork / by-id）', /`subagent`[\s\S]{0,120}subagent_fork[\s\S]{0,200}send_message\(\{ agent_id, message \}\)/],
  ['upgrade-guide 路径指针', /upgrade-guide/],
  ['forge-bundle 指称', /forge-bundle/],
  ['串行 batch 降级 + D47', /串行 batch/],
  ['装不齐顺延不造假', /顺延/],
  ['安装 = D21 外部动作', /D21/],
]
// 实装探针四锚判在 §1 precheck 节切片上（#186 邻接适配，2026-11-14 编排授权）——
// #186 AC1 落地后安装节（§2）前置段合法引用「安装断层 / dsh.profile.bundles /
// pnpm-lock.yaml / deny」词形（引用 §1 不复制判据），成为第二承载副本：全文级锚 +
// T6「摘 §1 实装探针 bullet」扰动随之空洞（摘了 §1 bullet，§2 的引用词形仍命中
// 全文锚 → 削弱方向打不到）。四锚改判在 §1 切片：摘除 §1 bullet 后切片内必缺席
// → 可红。段级 = 更严（§2 的合法交叉引用不再充当承载），判据语义不放宽。切片切
// 不出（标题字面漂移）= 四锚全缺席 = 红——缺席必响亮，不静默。
const S1_SLICE = /## 1\.[\s\S]*?(?=\n## 2\.)/
const manualS1Needs = [
  ['实装探针（安装断层 ≠ 工具缺席）', /安装断层/],
  ['实装探针声明面', /dsh\.profile\.bundles/],
  ['实装探针 lock 面', /pnpm-lock\.yaml/],
  ['实装探针 deny 行', /deny 行|deny 行为|deny/],
]
const sliceS1 = (text) => (text.match(S1_SLICE) || [''])[0]

/** 判据句段级断言：组件 probe 句 / 手册「查什么」bullet 两件齐 + 旧 API 名禁入。
 *  段级而非全文级——全文锚只钉词形在场，钉不住「判据句削成单工具」这种削弱。 */
const judgeFaceMissing = (componentText, manualText) => {
  const missing = []
  const probe = componentText.match(/probe the SESSION TOOL SURFACE for[^.]*\./)
  if (!probe) missing.push('L3a 组件: 判据句（probe the SESSION TOOL SURFACE for …）缺席')
  else {
    const s = probe[0]
    if (/spawn_teammate/.test(s)) missing.push('L3a 组件: 旧 API 名 spawn_teammate 回潮进判据句')
    if (!/`subagent`|`subagent_fork`/.test(s)) missing.push('L3a 组件: 判据句缺 subagent（削成单工具或漂移）')
    if (!/`create_worktree`/.test(s)) missing.push('L3a 组件: 判据句缺 create_worktree（削成单工具）')
  }
  const q = manualText.match(/- \*\*查什么\*\*：[\s\S]*?(?=\n- )/)
  if (!q) missing.push('L3b 手册: 判据段（**查什么** bullet）缺席')
  else {
    const s = q[0]
    if (/spawn_teammate/.test(s)) missing.push('L3b 手册: 旧 API 名 spawn_teammate 回潮进判据段')
    if (!/`subagent`|`subagent_fork`/.test(s)) missing.push('L3b 手册: 判据段缺 subagent')
    if (!/`create_worktree`/.test(s)) missing.push('L3b 手册: 判据段缺 create_worktree（削成单工具）')
  }
  return missing
}

const l3Missing = (componentText, manualText) => [
  ...componentNeeds.filter(([, re]) => !re.test(componentText)).map(([label]) => `L3a 组件: ${label}`),
  ...manualNeeds.filter(([, re]) => !re.test(manualText)).map(([label]) => `L3b 手册: ${label}`),
  ...manualS1Needs.filter(([, re]) => !re.test(sliceS1(manualText))).map(([label]) => `L3b 手册(§1 切片): ${label}`),
  ...judgeFaceMissing(componentText, manualText),
]

{
  const missing = l3Missing(component, manual)
  if (missing.length === 0)
    ok('L3. 双承载能力检测与降级判据（判据句两件齐 + 实装探针 + rc.3 迁移注记，全部词形在场）',
      `组件 ${componentNeeds.length} 项 + 手册 ${manualNeeds.length} 项 + §1 切片 ${manualS1Needs.length} 项 + 判据句段级 6 断言`)
  else bad('L3. 判据缺词形或判据句回潮/削弱', missing.join(' / '))
}

// ── L4: 手册操作要素（AC1/AC3 的承载点）──────────────────────────────────────
{
  const needs = [
    ['lane-audit 收敛判据', /lane-audit\.mjs/],
    // 判据绑不可删的具体 token（复审意见 2）：fallback 到标题词/常用词会把「内容删光仍绿」
    // 的恒真分支藏进断言——冷启动只认实测区间数字、源码装法只认 rc.1、lane 数不设宽松分支。
    ['默认 3 上限 4', /默认 3，硬上限 4/],
    ['依赖补齐脚本', /link-runtime-deps\.mjs/],
    ['冷启动成本区间（实测数字）', /1\.8–2\.2 s/],
    ['磁盘守卫脚本', /lane-disk-guard\.mjs/],
    ['默认 20 GB', /20 GB/],
    ['lane-gates.yml 覆写', /lane-gates\.yml/],
    ['批末对账', /batch-reconcile\.mjs/],
    ['整批一 PR', /整批一 PR|一个 CR/],
    ['merge 恒 human 门', /merge 恒为 human 门|merge 恒 human 门/],
    ['ADR-0002 升级表述', /批末 PR 就绪门/],
    ['npm alpha.2 不采', /alpha\.2/],
    ['fresh context', /fresh context/i],
    ['notes 仓外', /仓外/],
    ['构建产物目录红线', /不共享构建产物目录|不共享 `target/],
    ['experimental 面源码装法', /rc\.1/],
  ]
  const missing = needs.filter(([, re]) => !re.test(manual)).map(([label]) => label)
  if (missing.length === 0) ok('L4. 手册承载 AC1/AC3 全部操作要素', `${needs.length} 项`)
  else bad('L4. 手册缺要素', missing.join(' / '))

  // 组件与手册的数字判据必须一致（3/4 与 20GB 两处各写一份，写漏/写岔即红）。
  const consistent = /default 3 lanes, hard cap 4/.test(component) && /默认 3，硬上限 4/.test(manual) &&
    /20 GB/.test(component) && /20 GB/.test(manual)
  if (consistent) ok('L4b. 数字判据两处一致（lane 数 3/4、磁盘 20 GB）')
  else bad('L4b. 数字判据两处不一致或缺席', '组件与手册的 3/4 与 20 GB 逐处核对')
}

// ── L5: 组件正文引用的 target 全部存在（死引用 = 响亮红）─────────────────────
{
  const refs = [...component.matchAll(/`(docs\/[\w./-]+|scripts\/[\w./-]+)`/g)].map(m => m[1])
  const unique = [...new Set(refs)]
  const dead = unique.filter(rel => !existsSync(join(REPO, rel)))
  if (unique.length > 0 && dead.length === 0)
    ok('L5. 组件正文引用的文件全部存在', unique.join(', '))
  else if (unique.length === 0)
    bad('L5. 组件正文没有可检验的引用（指针面退化成无锚散文）')
  else
    bad('L5. 组件正文死引用', dead.join(' / '))
}

// ── T: 非空洞（内存扰动，零树写入；扰动前自检 needle > 0）─────────────────────
// 削弱方向必须可红（#189 AC4）：判据句削成单工具、旧 API 名回潮（组件 + 手册两侧）、
// 摘 rc.3 移除注记、摘 upgrade-guide 指针、摘实装探针段——每个扰动都让 l3Missing 红。
{
  const hits = (text, needle) => text.split(needle).length - 1
  const expectRed = (label, preflight, mutated) => {
    if (preflight === 0) bad(`T ${label}: preflight needle 0 hits（扰动没打到目标，断言是空洞的）`)
    else if (l3Missing(mutated, manual).length > 0) ok(`T ${label}: 扰动转红（非空洞）`)
    else bad(`T ${label}: 扰动未转红`, '守卫对这个削弱方向是空洞的')
  }
  const expectRedManual = (label, preflight, mutated) => {
    if (preflight === 0) bad(`T ${label}: preflight needle 0 hits（扰动没打到目标，断言是空洞的）`)
    else if (l3Missing(component, mutated).length > 0) ok(`T ${label}: 扰动转红（非空洞）`)
    else bad(`T ${label}: 扰动未转红`, '守卫对这个削弱方向是空洞的')
  }

  // T1 组件判据句削成单工具（probe 句摘 create_worktree）
  {
    const needle = 'and\n  `create_worktree` — the check'
    expectRed('T1 component judge sentence thinned to one tool', hits(component, needle),
      component.replace(needle, ' — the check'))
  }
  // T2 组件判据句旧 API 名回潮（subagent → spawn_teammate）
  {
    const needle = 'probe the SESSION TOOL SURFACE for `subagent`'
    expectRed('T2 component judge sentence regresses to spawn_teammate', hits(component, needle),
      component.replace(needle, 'probe the SESSION TOOL SURFACE for `spawn_teammate`'))
  }
  // T3 组件摘 rc.3 移除注记（REMOVED 句改写）
  {
    const needle = 'spawn_teammate was REMOVED upstream in rc.3'
    expectRed('T3 component rc.3 removal note rewritten away', hits(component, needle),
      component.replace(needle, 'the old API was dropped upstream in rc.3'))
  }
  // T4 组件摘 upgrade-guide 指针
  {
    const needle = 'upstream upgrade guide'
    expectRed('T4 component upgrade-guide pointer removed', hits(component, needle),
      component.replace(needle, 'upstream upgrade handbook'))
  }
  // T5 手册判据段旧 API 名回潮（subagent → spawn_teammate）
  {
    const needle = '`subagent`（或 `subagent_fork`）与 `create_worktree`'
    expectRedManual('T5 manual judge paragraph regresses to spawn_teammate', hits(manual, needle),
      manual.replace(needle, '`spawn_teammate` 与 `create_worktree`'))
  }
  // T6 手册摘实装探针段（安装断层判据整 bullet 摘除）——preflight 与扰动判据均在
  // §1 切片上（#186 邻接适配）：摘除后切片内四锚缺席 → 可红；全文锚不再被 §2
  // 前置段的合法引用词形垫绿。
  {
    const needle = '- **实装探针（安装断层 ≠ 工具缺席'
    expectRedManual('T6 manual install-gap paragraph removed', hits(sliceS1(manual), needle),
      manual.replace(/- \*\*实装探针（安装断层[\s\S]*?(?=\n- )/, ''))
  }
}

report('LANE COMPONENT VERIFY (#137/#189 — 组件 × 手册判据一致性)')
