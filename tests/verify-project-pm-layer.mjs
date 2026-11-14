/**
 * verify-project-pm-layer.mjs — #53 PM 组合层：grill 落地清单形态在场 + 边界不回潮。
 *
 * 权威源 = 票面 **2026-10-20 grill 决策记录**（票面评论，owner 署名 *the decisions
 * below are the human's*；2026-11-14 本批实施中复审发现票面正文与 grill 冲突、上报后
 * human 裁决**维持 grill 口径**）。判据单源 = docs/agents/issue-tracker.md「forge
 * project 层（PM 组合层，#53）」节 + docs/adr/0019-pm-layer-on-forge-project.md +
 * CONTEXT.md D57 一行指针。本用例钉住承载脸互相可达：
 *   D1 L1 用法：原生 blocked-by 依赖边（指针到 Wayfinding/Ready frontier，不复述）+
 *      frontier.mjs 现算引用 + L0 延后（含 `gh auth refresh -s project` 前置）+
 *      L2/L3 待议 + 不采纳行。
 *   D2 三档映射表（口径，不造载体）：四行（票/状态列/里程碑·依赖/指派与审计线索）×
 *      三档列头 +「真出现 git-only 仓时再落文件，届时按此映射照做」句 + label 约定
 *      （batch:A / lane:2 / status:ready，最大公约数）。
 *   D3 优先级读票面 `P0`（#142 单档例外轴）：不另设字段 + project 侧当红旗列 + 词汇
 *      单源指针（triage-labels.md）+ 不发明多档——削弱为「设字段」必须红。
 *   D4 grill 边界四条：不建 Projects v2 板 / 不给 batch-state.md 增加任何 PM 职责 /
 *      不新建 docs/tickets/ 载体 / 不改 #142 与 frontier.mjs 行为。
 *   D5 ADR 决策面：Deciders（grill 拍板 + 裁决维持）/ 三层权责表 / 采纳表（L1 立即 /
 *      L0 延后含前置）/ 三档只钉口径不造载体 / 最小 PM 四概念 / **「任何 forge 均有
 *      对应物」句**（AC⑤ 前半句「PM 抽象不绑定单一 forge」的声明承载——削弱为单
 *      forge 表述必须红，T8）。
 *   D6 CONTEXT 指针：D57 行在场（指向 ADR-0019）——只指路不抄内容的入册形态。
 *   D7 负向锚（回潮防线——复审改判不得被后续改动悄悄撤回）：建板/字段定义命令序列
 *      （field-create / item-add）、batch-state.md 升格为 PM 层句、出板动作/digest 附
 *      Projects 链接惯例，在 tracker 节与 ADR 内**出现即红**。
 *   T1–T7 非空洞（扰动在内存副本上做，零树写入；每个扰动前自检 needle 命中 > 0；
 *      含削弱方向单侧可红——判据句被改弱不只整段摘除才红）。
 *
 * 边界（显式声明，D16b 同族）：线上是否真有板、L0 届时是否开板，由届时会话现查（gh
 * 读数）与届时拍板记录判——本用例不联网、不读线上项目；「映射表语义是否正确」由评审
 * 承担，正则不判语义；D7 负向锚只钉已知回潮形态，不能枚举任意改写（D16b）。
 *
 * 纯离线：读工作树文件。无网络、无环境依赖。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const lf = (t) => String(t).replace(/\r\n/g, '\n')

const trackerText = lf(readFileSync(new URL('../docs/agents/issue-tracker.md', import.meta.url), 'utf8'))
const adrText = lf(readFileSync(new URL('../docs/adr/0019-pm-layer-on-forge-project.md', import.meta.url), 'utf8'))
const contextText = lf(readFileSync(new URL('../CONTEXT.md', import.meta.url), 'utf8'))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

/** 命中数（needle 是字面，includes 计数）。 */
const hits = (text, needle) => text.split(needle).length - 1

/** 从文本里截取「从 startNeedle 起到 endNeedle 前」的节（endNeedle 为 null 时到文件尾）。 */
const sliceBetween = (text, startNeedle, endNeedle) => {
  const start = text.indexOf(startNeedle)
  if (start === -1) return null
  if (endNeedle == null) return text.slice(start)
  const end = text.indexOf(endNeedle, start + startNeedle.length)
  return text.slice(start, end === -1 ? text.length : end)
}

const SECTION_START = '## forge project 层（PM 组合层，#53）'
// 本节是 issue-tracker.md 的末节（#53 增补时追加在 Wayfinding operations 之后）——
// 新节插到其后时，这里同步追加新的 endNeedle（守卫对「节漂移」响亮）。
const SECTION_END = null

const sectionOf = (text) => sliceBetween(text, SECTION_START, SECTION_END)

const sectionMissing = (text) => {
  const section = sectionOf(text)
  if (section == null) return [SECTION_START + '（整节缺席）']
  return []
}

/** D1：L1 用法锚。 */
const l1UsageMissing = (text) => {
  const section = sectionOf(text)
  if (section == null) return [SECTION_START + '（整节缺席）']
  const anchors = [
    '原生 `blocked-by` 依赖边',
    'Wayfinding',
    'Ready frontier',
    '`node scripts/frontier.mjs`',
    '零新机制零新权限',
    '**L0（看板 + 里程碑）延后**',
    '`gh auth refresh -s project`',
    '不手工维护日期',
    '#52 泳道试跑后议',
    '燃尽预测',
  ]
  return anchors.filter((n) => !section.includes(n))
}

/** D2：三档映射表（口径，不造载体）。 */
const tiersMissing = (text) => {
  const section = sectionOf(text)
  if (section == null) return [SECTION_START + '（整节缺席）']
  const anchors = [
    '| 概念 | 全 forge | 仅 git 远端 | 完全本地 |',
    '| **票**',
    '| **状态列**',
    '| **里程碑·依赖**',
    '| **指派与审计线索**',
    '真出现 git-only 仓时再落文件',
    '届时按本表照做',
    '`batch:A`', '`lane:2`', '`status:ready`',
    'label 是所有 forge 的最大公约数',
    '三档**零损失**',
  ]
  return anchors.filter((n) => !section.includes(n))
}

/** D3：优先级读票面 P0（不另设字段——削弱方向必须红）。 */
const p0Missing = (text) => {
  const section = sectionOf(text)
  if (section == null) return [SECTION_START + '（整节缺席）']
  const anchors = [
    '优先级**不另设字段**',
    '单一事实源 = issue label',
    '**例外标记**而非\n  排序维度',
    '**红旗列**',
    '`docs/agents/triage-labels.md`',
    '不发明 `P1/P2` 一类多档',
  ]
  return anchors.filter((n) => !section.includes(n))
}

/** D4：grill 边界四条。 */
const boundariesMissing = (text) => {
  const section = sectionOf(text)
  if (section == null) return [SECTION_START + '（整节缺席）']
  const anchors = [
    '**不建** Projects v2 板',
    'L0 延后——「票在哪一列」当前 state label 已答',
    '**不给** `batch-state.md` 增加任何 PM 职责',
    '它**只在批内存在**',
    'project/组合层要的是**永存**',
    '**不新建** `docs/tickets/`',
    '**不改** #142 的 `P0` 结论与 `frontier.mjs`',
  ]
  return anchors.filter((n) => !section.includes(n))
}

/** D5：ADR 决策面（Deciders / 三层表 / 采纳表 / 口径不造载体 / 四概念）。 */
const adrMissing = (text) => {
  const anchors = [
    '2026-10-20 grill 拍板',
    "the decisions below are\nthe human's",
    '2026-11-14 human 裁决维持 grill 口径',
    '| 组合/项目层', '| 执行层', '| 批协议层',
    '**优先级是同一件事（grill Q1=A）**',
    '| L1 |', '| L0 |', '| L2 |', '| L3 |', '| 不采纳 |',
    '**立即**——零新机制零新权限',
    '**延后**——等真出现「跨仓一眼看 roadmap」的需求再开板',
    '**三档降级梯度只钉口径，不造任何载体（grill Q3=C）**',
    '最小 PM 抽象四概念保留',
    '批次·lane 归属',
    // AC⑤ 前半句（grill 钉死规则 4）「PM 抽象不绑定单一 forge」的声明承载：
    // ADR「任何 forge 均有对应物」句——削弱成单 forge 列举（T8）必红，不放宽。
    '与 forge 无关的可移植性子集',
    '任何 forge 均有对应物',
    '以较新的可回读拍板记录为准',
  ]
  return anchors.filter((n) => !text.includes(n))
}

/** D6：CONTEXT.md D57 一行指针（只指路：含 ADR 链接，不整段复制采纳表）。 */
const contextPointerMissing = (text) => {
  const missing = []
  if (!text.includes('- **D57（2026-10-20 grill 拍板，2026-11-14 裁决维持，#53 落地）**')) {
    missing.push('CONTEXT.md 缺 D57 入册行')
  }
  const line = text.split('\n').find((l) => l.includes('**D57（'))
  if (!line) missing.push('CONTEXT.md 缺 D57 行')
  else if (!line.includes('docs/adr/0019-pm-layer-on-forge-project.md')) missing.push('D57 行缺 ADR-0019 指针')
  else if (!line.includes('不另设字段')) missing.push('D57 行缺「不另设字段」口径词')
  return missing
}

/** D7：负向锚（回潮防线）——tracker 节与 ADR 内出现已改判掉的形态即红。 */
const REGRESSION_NEEDLES = [
  'gh project field-create',
  'gh project item-add',
  'gh project create',
  '--name "Priority"',
  '**batch-state.md 是 git-only 档的正式 PM 层**',
  '新票顺手入板',
  'Projects 板链接',
]
const regressionPresent = (trackerSection, adr) => {
  const present = []
  for (const n of REGRESSION_NEEDLES) {
    if (trackerSection && trackerSection.includes(n)) present.push('tracker 节回潮: ' + n)
    if (adr.includes(n)) present.push('ADR 回潮: ' + n)
  }
  return present
}

// ---- D1 L1 用法 ----
{
  const missing = l1UsageMissing(trackerText)
  if (missing.length === 0) ok('D1 tracker: L1 usage anchors present (native blocked-by + frontier.mjs + L0 deferred + L2/L3 pending + rejected)')
  else bad('D1 tracker: L1 usage anchors missing', missing.join(' | '))
}

// ---- D2 三档映射表 ----
{
  const missing = tiersMissing(trackerText)
  if (missing.length === 0) ok('D2 tracker: three-tier mapping table present (口径 not carrier; git-only falls back per the table)')
  else bad('D2 tracker: three-tier mapping anchors missing', missing.join(' | '))
}

// ---- D3 优先级读 P0 ----
{
  const missing = p0Missing(trackerText)
  if (missing.length === 0) ok('D3 tracker: priority reads ticket P0 label (single-tier exception axis, red-flag column, no field)')
  else bad('D3 tracker: P0 priority anchors missing / weakened', missing.join(' | '))
}

// ---- D4 grill 边界 ----
{
  const missing = boundariesMissing(trackerText)
  if (missing.length === 0) ok('D4 tracker: grill boundaries present (no board / no batch-state PM duty / no docs/tickets / no #142 or frontier change)')
  else bad('D4 tracker: boundary anchors missing', missing.join(' | '))
}

// ---- D5 ADR 决策面 ----
{
  const missing = adrMissing(adrText)
  if (missing.length === 0) ok('D5 ADR-0019: deciders (grill + ruling) / three-layer table / adoption table (L1 now, L0 deferred) / 口径-not-carrier / four concepts present')
  else bad('D5 ADR-0019: decision anchors missing', missing.join(' | '))
}

// ---- D6 CONTEXT 指针 ----
{
  const missing = contextPointerMissing(contextText)
  if (missing.length === 0) ok('D6 CONTEXT.md: D57 entry present (pointer to ADR-0019, no content copy)')
  else bad('D6 CONTEXT.md: D57 pointer missing', missing.join(' | '))
}

// ---- D7 负向锚（回潮防线） ----
{
  const present = regressionPresent(sectionOf(trackerText), adrText)
  if (present.length === 0) ok('D7 regression guard: no board-ingest sequence / no Priority field definition / no batch-state PM promotion / no digest-Projects-link convention')
  else bad('D7 regression guard: reversed decisions re-appeared', present.join(' | '))
}

// ---- T1–T7 非空洞（内存扰动，零树写入；扰动前自检 needle > 0；含削弱方向） ----
const expectRed = (label, baseMissing, mutatedMissing) => {
  if (mutatedMissing.length > 0 && baseMissing.length === 0) ok(`T ${label}: perturbation turns the check RED (non-vacuous)`)
  else bad(`T ${label}: perturbation did NOT turn the check red`, `base=[${baseMissing}] mutated=[${mutatedMissing}]`)
}

// T1 摘整节（tracker 删「forge project 层」全节 → D1/D2/D3/D4 红）
{
  const section = sectionOf(trackerText)
  if (section == null || section.length === 0) bad('T1 preflight: section needle 0 hits')
  else {
    const start = trackerText.indexOf(SECTION_START)
    const mutated = trackerText.slice(0, start)
    expectRed('T1 whole section removed', l1UsageMissing(trackerText), l1UsageMissing(mutated))
    for (const [name, fn] of [['T1b tiers', tiersMissing], ['T1c P0', p0Missing], ['T1d boundaries', boundariesMissing]]) {
      if (fn(mutated).length > 0) ok(`${name} check also red on removal`)
      else bad(`${name}: stayed green after whole-section removal`)
    }
  }
}

// T2 摘映射表「指派与审计线索」行（单变量：只删概念行）
{
  const needle = '| **指派与审计线索**'
  if (hits(trackerText, needle) < 1) bad('T2 preflight: assignment-row needle 0 hits')
  else {
    const mutated = trackerText.split('\n').filter((l) => !l.startsWith(needle)).join('\n')
    expectRed('T2 mapping row removed', tiersMissing(trackerText), tiersMissing(mutated))
  }
}

// T3 削「不另设字段」句（改成 project 侧设字段 → D3 红——削弱方向单侧可红）
{
  const needle = '优先级**不另设字段**（grill Q1=A）'
  if (hits(trackerText, needle) < 1) bad('T3 preflight: no-field sentence needle 0 hits')
  else {
    const mutated = trackerText.replace(needle, 'project 侧另设 Priority 字段')
    expectRed('T3 weakened into field-based priority', p0Missing(trackerText), p0Missing(mutated))
  }
}

// T4 摘「不建板」边界条（→ D4 红）
{
  const needle = '**不建** Projects v2 板'
  if (hits(trackerText, needle) < 1) bad('T4 preflight: no-board boundary needle 0 hits')
  else {
    const start = trackerText.indexOf(needle)
    const end = trackerText.indexOf('\n', trackerText.indexOf('（L0 延后', start)) + 1
    const mutated = trackerText.slice(0, start) + trackerText.slice(end)
    expectRed('T4 no-board boundary removed', boundariesMissing(trackerText), boundariesMissing(mutated))
  }
}

// T5 摘 ADR 采纳表 L0 行（决策面残缺 → D5 红；ADR 表格带缩进，按 trim 后行首判）
{
  const needle = '| L0 |'
  if (hits(adrText, needle) < 1) bad('T5 preflight: ADR L0-row needle 0 hits')
  else {
    const mutated = adrText.split('\n').filter((l) => !l.trim().startsWith(needle)).join('\n')
    expectRed('T5 ADR L0 row removed', adrMissing(adrText), adrMissing(mutated))
  }
}

// T6 摘 CONTEXT D57 行（入册缺席 → D6 红）
{
  const line = contextText.split('\n').find((l) => l.includes('**D57（'))
  if (!line) bad('T6 preflight: D57 line 0 hits')
  else {
    const mutated = contextText.split('\n').filter((l) => !l.includes('**D57（')).join('\n')
    expectRed('T6 CONTEXT D57 line removed', contextPointerMissing(contextText), contextPointerMissing(mutated))
  }
}

// T7 回潮注入（把建板命令塞回节内 → D7 红——负向判据的非空洞验证）
{
  const mutated = trackerText.replace(
    SECTION_START,
    SECTION_START + '\n\n<!-- regression: run `gh project item-add` to reseed the board -->'
  )
  expectRed('T7 board-ingest command re-injected', regressionPresent(sectionOf(trackerText), adrText),
    regressionPresent(sectionOf(mutated), adrText))
}

// T8 削弱「任何 forge 均有对应物」为单 forge 表述（→ D5 红——AC⑤ 前半句的
// 非空洞检验：抽象被绑死到 GitHub 一个 forge 时守卫必须变红，N1）
{
  const needle = '任何 forge 均有对应物'
  if (hits(adrText, needle) < 1) bad('T8 preflight: any-forge sentence needle 0 hits')
  else {
    const mutated = adrText.replace(needle, 'GitHub Projects 有对应物')
    expectRed('T8 weakened into single-forge binding', adrMissing(adrText), adrMissing(mutated))
  }
}

// ---- 汇总（本仓 tests/*.mjs 既有形态：results 逐行 + 非零退出） ----
console.log('=== verify-project-pm-layer === (#53 PM 组合层：grill 落地清单形态 + 边界不回潮)')
for (const line of results) console.log(line)
const failed = results.filter((r) => r.startsWith('  ✗')).length
if (failed > 0) {
  console.error(`\nFAILED: ${failed} 项红`)
  process.exit(1)
}
console.log('\nOK: L1 用法 + 三档映射表 + 优先级读 P0 + grill 边界 + ADR 决策面 + CONTEXT D57 指针在场（扰动全红）+ 回潮形态零再现')
