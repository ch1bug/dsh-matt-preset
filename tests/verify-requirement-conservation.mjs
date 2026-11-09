/**
 * verify-requirement-conservation.mjs — #148 需求守恒与接线移交：文本送达 + 必要入口 + 非空洞。
 *
 * 规约单源 = docs/agents/issue-tracker.md「需求守恒与接线移交」节（判据本体）；本用例钉住
 * 它的四张承载脸互相可达（AC5：文本送达 + 必要入口 + 既有机制回归）：
 *   D1 常驻注入面：batch 组件义务段经 profileBody 组装实际送达 standard / cordis / ptc；
 *      minimal 用自己的压缩义务句（其 delta 覆盖 batch-mode 节，组件默认文本被跳过——
 *      四档「实际注入与消费一致」= 每档注入面都含义务锚句 + 指针，不是同一段文本四处复制）。
 *   D2 规约节入口：tracker 文档的节在场（三值去向 / 双向移交 / 三形判红 / 排程≠验证）。
 *   D3 复核入口：code-review-brief §2 的 5d 条在场并指向判据与样例集。
 *   D4 样例集：匿名正反样例在场（2 正例 + 5 反例锚点；无裸票号——匿名面）。
 *   D5 常驻文本里的 docs 指针真实存在（.txt 注入源不在 verify-doc-pointers 的扫描面内，
 *      需要自己的存在性断言——同 verify-workflow-core L3 的分工）。
 *   T1–T8 非空洞（扰动在内存副本上做，零树写入；每个扰动前自检 needle 命中 > 0）：
 *      摘义务段 → D1 红；削义务句（删 disclosure-is-not-delivery 从句）→ D1 红；
 *      摘三值行 → D2 红；削弱双向判据（删三形判红句）→ D2 红；删「都不是去向」句 → D2 红；
 *      摘 5d → D3 红；摘反例锚 → D4 红。摘不掉守卫判据的文本手术就是假证据。
 *
 * 边界（显式声明，D16b 同族）：语义判断（某接收票的 AC 是否真承接、证据是否真覆盖）由评审
 * 承担，本用例不写自然语言完备判定，不新增运行态传感器。样例逐例内容只钉锚点在场，
 * 不判语义。
 *
 * 纯离线：读工作树文件 + 动态 import workflow-core 组装四档注入面。无网络、无环境依赖。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const lf = (t) => String(t).replace(/\r\n/g, '\n')

const trackerText = lf(readFileSync(new URL('../docs/agents/issue-tracker.md', import.meta.url), 'utf8'))
const briefText = lf(readFileSync(new URL('../docs/code-review-brief.md', import.meta.url), 'utf8'))
const examplesText = lf(readFileSync(new URL('../docs/requirement-conservation-examples.md', import.meta.url), 'utf8'))
const batchComponentText = lf(readFileSync(new URL('../workflow-component-batch.txt', import.meta.url), 'utf8'))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

/** 命中数（needle 是字面，无正则元字符歧义时用 includes 计数）。 */
const hits = (text, needle) => text.split(needle).length - 1

/** 从文本里截取「从 startNeedle 起到 endNeedle 前」的节（找不到返回 null）。 */
const sliceBetween = (text, startNeedle, endNeedle) => {
  const start = text.indexOf(startNeedle)
  if (start === -1) return null
  const end = endNeedle == null ? text.length : text.indexOf(endNeedle, start + startNeedle.length)
  return text.slice(start, end === -1 ? text.length : end)
}

// ---- 判据函数（正向 + 扰动共用同一实现；返回缺失锚句数组，空数组 = 绿） ----

/** D1：注入面送达判据。full = standard/cordis/ptc（组件义务段原文），minimal = 压缩义务句。
 *  锚词钉的是组件 / minimal 压缩句里的真实句子（不只是标题与指针）：三值里的承接去向
 *  （EXISTING ticket）、披露≠交付（disclosure is not delivery）——句子被删或改弱必须红。 */
const deliveryMissing = (text, profile) => {
  const need = profile === 'minimal'
    ? ['REQUIREMENT CONSERVATION:', 'EXISTING', 'bidirectional',
       'docs/agents/issue-tracker.md']
    : ['REQUIREMENT CONSERVATION & WIRE-OFF', 'BIDIRECTIONAL', 'EXISTING ticket',
       'disclosure is not delivery',
       'docs/agents/issue-tracker.md', 'docs/code-review-brief.md']
  return need.filter((n) => !text.includes(n))
}

/** D2：tracker 规约节入口判据（只在节文本内判——摘节必红，节外漂移不误伤）。 */
const trackerSectionMissing = (text) => {
  const section = sliceBetween(text, '## 需求守恒与接线移交', '\n## Ready frontier')
  if (section == null) return ['## 需求守恒与接线移交（整节缺席）']
  const anchors = [
    '本票兑现', '已存在的承接票', '获明确授权的目标变更', // 三值去向
    '都不是去向', // 反例去向排除句（披露/搁置不构成去向——句子被删必须红）
    '双向成立', // 移交判据
    '后续由某票处理', '接收票不存在', '未承接', // 三形判红
    '排程先后', // 与阻塞边分工
    'requirement-conservation-examples.md', 'code-review-brief.md', // 指针
    'verify-requirement-conservation.mjs', // 机械面自指
  ]
  return anchors.filter((n) => !section.includes(n))
}

/** D3：brief 5d 复核入口判据（限 5d 段内）。 */
const briefEntryMissing = (text) => {
  const section = sliceBetween(text, '5d. 对照源不止当前票面', '\n6. **新增的每条断言')
  if (section == null) return ['5d. 对照源不止当前票面（条目缺席）']
  const anchors = ['权威授权结论', '本票兑现', '已存在的承接票', '获明确授权的目标变更',
    '接线责任', 'issue-tracker.md', 'requirement-conservation-examples.md']
  return anchors.filter((n) => !section.includes(n))
}

/** D4：样例集判据（锚点在场 + 匿名面无裸票号）。 */
const examplesMissing = (text) => {
  const anchors = ['匿名合成声明', 'docs/agents/issue-tracker.md',
    'P1 双向承接', 'P2 明确获准取消',
    'F1 旧语义回流', 'F2 消费票漏建', 'F3 单方移交', 'F4 披露代替交付',
    'F5 两端各自通过但连接未验证']
  const missing = anchors.filter((n) => !text.includes(n))
  const bareTicket = text.match(/#\d{2,}/) // 匿名面：#<n> 占位合法，#123 裸票号不允许
  if (bareTicket) missing.push(`匿名违规：裸票号 ${bareTicket[0]}`)
  return missing
}

// ---- 组装四档注入面（消费既有 profileBody 机制；组装失败即用例崩，响亮退出） ----
const core = await import(pathToFileURL(REPO + '/workflow-core.mjs').href)
const composed = {}
for (const p of ['standard', 'cordis', 'ptc', 'minimal']) composed[p] = lf(await core.profileBody(p))

/** 用 core 导出的组装原语对「给定组件 delta 文本」重拼 standard 注入面（T1 扰动专用：
 *  profileBody 带缓存且第二参数是组件名单，不能注入改写文本——扰动必须走同一套原语）。 */
const composeStandardFrom = async (componentTexts) => {
  const skeleton = core.parseSections(await core.skeletonText())
  const deltas = componentTexts.flatMap((t) => core.parseSections(t).sections)
  return lf(core.joinSections(core.composeSections(skeleton.sections, deltas), skeleton.trailingNewline))
}
// 组装自检（非空洞前置）：对未扰动组件文本，原语重拼必须与 profileBody('standard') 逐字节一致
// ——一致成立后，T1 的扰动组装才是单变量实验。
const laneText = lf(readFileSync(new URL('../workflow-component-lane.txt', import.meta.url), 'utf8'))
const composedByHand = await composeStandardFrom([batchComponentText, laneText])
if (composedByHand === composed.standard) ok('D0 compose preflight: primitive re-composition == profileBody("standard") byte-identical')
else bad('D0 compose preflight: primitive re-composition differs from profileBody("standard") — T1 perturbation would not be single-variable')

// ---- D1 文本送达（四档逐一） ----
for (const p of ['standard', 'cordis', 'ptc']) {
  const missing = deliveryMissing(composed[p], p)
  if (missing.length === 0) ok(`D1 ${p}: conservation duty delivered on the composed injection`, `${composed[p].length} chars`)
  else bad(`D1 ${p}: conservation duty MISSING from the composed injection`, missing.join(' | '))
}
{
  const missing = deliveryMissing(composed.minimal, 'minimal')
  if (missing.length === 0) ok('D1 minimal: compressed conservation duty delivered', `${composed.minimal.length} chars`)
  else bad('D1 minimal: compressed conservation duty MISSING', missing.join(' | '))
}

// ---- D2 规约节入口 ----
{
  const missing = trackerSectionMissing(trackerText)
  if (missing.length === 0) ok('D2 tracker: conservation section present with three-value + bidirectional anchors')
  else bad('D2 tracker: conservation section anchors missing', missing.join(' | '))
}

// ---- D3 复核入口 ----
{
  const missing = briefEntryMissing(briefText)
  if (missing.length === 0) ok('D3 brief: §2 5d review-side consumption entry present')
  else bad('D3 brief: §2 5d entry anchors missing', missing.join(' | '))
}

// ---- D4 样例集 ----
{
  const missing = examplesMissing(examplesText)
  if (missing.length === 0) ok('D4 examples: 2 positive + 5 negative anchors present, anonymous (no bare ticket numbers)')
  else bad('D4 examples: anchors missing / anonymity violated', missing.join(' | '))
}

// ---- D5 常驻文本里的 docs 指针真实存在（.txt 源不在 doc-pointers 扫描面内） ----
{
  const duty = sliceBetween(batchComponentText, '- REQUIREMENT CONSERVATION & WIRE-OFF', null) ?? ''
  const dutyBlock = duty.slice(0, duty.indexOf('\n- ') === -1 ? duty.length : duty.indexOf('\n- '))
  const paths = [...dutyBlock.matchAll(/(docs\/[\w./-]+\.md)/g)].map((m) => m[1])
  const dead = paths.filter((p) => !existsSync(new URL('../' + p, import.meta.url)))
  if (paths.length === 0) bad('D5 duty block: no docs pointers found (needle drift — the duty text changed shape)')
  else if (dead.length === 0) ok(`D5 duty block: ${paths.length} docs pointers all alive`, paths.join(', '))
  else bad('D5 duty block: dead docs pointers', dead.join(', '))
}

// ---- T1–T5 非空洞（内存扰动，零树写入；扰动前自检 needle > 0） ----
const expectRed = (label, baseMissing, mutatedMissing) => {
  if (mutatedMissing.length > 0 && baseMissing.length === 0) ok(`T ${label}: perturbation turns the check RED (non-vacuous)`)
  else bad(`T ${label}: perturbation did NOT turn the check red`, `base=[${baseMissing}] mutated=[${mutatedMissing}]`)
}

// T1 摘义务段（batch 组件文本删 REQUIREMENT CONSERVATION 条目 → standard 组装面判据红）
{
  const needle = '- REQUIREMENT CONSERVATION & WIRE-OFF'
  const needleEnd = 'review consumes it at docs/code-review-brief.md §2.'
  if (hits(batchComponentText, needle) < 1 || hits(batchComponentText, needleEnd) < 1) {
    bad('T1 preflight: needle 0 hits — the duty text changed shape, fix the perturbation first')
  } else {
    const mutatedComponent = batchComponentText.slice(0, batchComponentText.indexOf(needle)) +
      batchComponentText.slice(batchComponentText.indexOf(needleEnd) + needleEnd.length)
    const mutatedComposed = await composeStandardFrom([mutatedComponent, laneText])
    expectRed('T1 duty-block removed from component delta', deliveryMissing(composed.standard, 'standard'),
      deliveryMissing(mutatedComposed, 'standard'))
  }
}

// T2 摘三值表（tracker 删去向表 → D2 红）
{
  const needle = '| **本票兑现** |'
  if (hits(trackerText, needle) < 1) bad('T2 preflight: three-value row needle 0 hits')
  else {
    const mutated = trackerText.split('\n').filter((l) => !l.startsWith('| **')).join('\n')
    expectRed('T2 three-value table removed from tracker', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// T3 削弱双向判据（删三形判红段 → D2 红——判据削弱要红，不只是整段摘除才红）
{
  const needle = '三形判红：只写「后续由某票处理」'
  if (hits(trackerText, needle) < 1) bad('T3 preflight: three-failure-shapes needle 0 hits')
  else {
    const start = trackerText.indexOf(needle)
    const end = trackerText.indexOf('**与原生阻塞边分工**', start)
    const mutated = trackerText.slice(0, start) + trackerText.slice(end)
    expectRed('T3 bidirectional failure-shapes paragraph weakened', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// T7 削义务句（batch 组件义务段删 disclosure-is-not-delivery 从句 → standard 组装面判据红
// ——D1 锚词钉的是组件真实句子，句子被删/改弱必须红，不只整段摘除才红；仿 T3 形态）
{
  const needle = ' — disclosure is not delivery,'
  if (hits(batchComponentText, needle) < 1) {
    bad('T7 preflight: disclosure-is-not-delivery clause needle 0 hits — duty text changed shape')
  } else {
    const mutatedComponent = batchComponentText.replace(needle, ',')
    const mutatedComposed = await composeStandardFrom([mutatedComponent, laneText])
    expectRed('T7 duty-sentence weakened (disclosure-is-not-delivery clause removed)',
      deliveryMissing(composed.standard, 'standard'),
      deliveryMissing(mutatedComposed, 'standard'))
  }
}

// T8 删反例去向句（tracker 删「都不是去向」句 → D2 红——判据削弱要红；仿 T3 形态。
//  只删该句、保留同段关票自检句，扰动是单变量）
{
  const needle = '「后续再说」'
  const endNeedle = '披露动作不免除交付义务。'
  if (hits(trackerText, needle) < 1 || hits(trackerText, endNeedle) < 1) {
    bad('T8 preflight: destination-exclusion sentence needles 0 hits — section text changed shape')
  } else {
    const start = trackerText.indexOf(needle)
    const end = trackerText.indexOf(endNeedle, start) + endNeedle.length
    const mutated = trackerText.slice(0, start) + trackerText.slice(end)
    expectRed('T8 destination-exclusion sentence removed from tracker', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// T6 摘整节（tracker 删「需求守恒与接线移交」全节 → D2 红——规约文本摘掉必须红）
{
  const start = trackerText.indexOf('## 需求守恒与接线移交')
  const end = trackerText.indexOf('\n## Ready frontier', start)
  if (start === -1 || end === -1) bad('T6 preflight: section boundary needles 0 hits')
  else {
    const mutated = trackerText.slice(0, start) + trackerText.slice(end + 1)
    expectRed('T6 whole tracker section removed', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// T4 摘 5d 条目（brief 删 5d 段 → D3 红）
{
  const needle = '5d. 对照源不止当前票面'
  const endNeedle = '\n6. **新增的每条断言'
  if (hits(briefText, needle) < 1) bad('T4 preflight: 5d needle 0 hits')
  else {
    const start = briefText.indexOf(needle)
    const end = briefText.indexOf(endNeedle, start)
    const mutated = briefText.slice(0, start) + briefText.slice(end + 1)
    expectRed('T4 5d entry removed from brief', briefEntryMissing(briefText),
      briefEntryMissing(mutated))
  }
}

// T5 摘反例锚（样例删 F3 节 → D4 红）
{
  const needle = '### F3 单方移交'
  if (hits(examplesText, needle) < 1) bad('T5 preflight: F3 needle 0 hits')
  else {
    const start = examplesText.indexOf(needle)
    const end = examplesText.indexOf('### F4', start)
    const mutated = examplesText.slice(0, start) + examplesText.slice(end)
    expectRed('T5 negative example F3 removed', examplesMissing(examplesText),
      examplesMissing(mutated))
  }
}

// ---- 汇总（本仓 tests/*.mjs 既有形态：results 逐行 + 非零退出） ----
console.log('=== verify-requirement-conservation === (#148 需求守恒与接线移交)')
for (const line of results) console.log(line)
const failed = results.filter((r) => r.startsWith('  ✗')).length
if (failed > 0) {
  console.error(`\nFAILED: ${failed} 项红`)
  process.exit(1)
}
console.log('\nOK: 文本送达（四档）+ 必要入口（规约节 / 复核 5d / 样例集）+ 指针存活 + 扰动全红')
