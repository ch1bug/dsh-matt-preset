/**
 * verify-retirement-criteria.mjs — #149 退役判据（未接通 ≠ 无职责）：文本送达 + 必要入口 + 非空洞。
 *
 * 规约单源 = docs/agents/issue-tracker.md「退役判据：未接通 ≠ 无职责」节（判据本体）；本用例
 * 钉住它的四张承载脸互相可达（AC5：文本送达 + 必要入口 + 既有机制回归）：
 *   D1 常驻注入面：batch 组件义务段经 profileBody 组装实际送达 standard / cordis / ptc；
 *      minimal 用自己的压缩义务句（其 delta 覆盖 batch-mode 节，组件默认文本被跳过——
 *      四档「实际注入与消费一致」= 每档注入面都含义务锚句 + 指针，不是同一段文本四处复制）。
 *   D2 规约节入口：tracker 节在场（四分类 / 调查线索句 / 三件齐全门槛 / 正常清理半 / 判据问句）。
 *   D3 复核入口：code-review-brief §2 的 5e 条在场并指向判据与样例集。
 *   D4 样例集：六组匿名样例在场（E1–E6 锚点；无裸票号——匿名面）。
 *   D5 常驻文本里的 docs 指针真实存在（.txt 注入源不在 verify-doc-pointers 的扫描面内，
 *      需要自己的存在性断言——同 verify-requirement-conservation D5 的分工）。
 *   T1–T10 非空洞（扰动在内存副本上做，零树写入；每个扰动前自检 needle 命中 > 0）：
 *      摘义务段 → D1 红；削义务句（删 leads-never-verdicts 从句）→ D1 红；
 *      minimal 摘压缩句 → D1 minimal 红；摘四分类表 → D2 红；削证据门槛段 → D2 红；
 *      删判据问句 → D2 红；摘 5e → D3 红；摘样例组 → D4 红；样例注入裸票号 → D4 红；
 *      摘整节 → D2 红。摘不掉守卫判据的文本手术就是假证据。
 *
 * 边界（显式声明，D16b 同族）：模块价值与替代等价性由事实调查和评审承担，本用例不写
 * 自然语言完备判定，不新增运行态传感器、不建消费者扫描。样例逐例内容只钉锚点在场，
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
const examplesText = lf(readFileSync(new URL('../docs/retirement-criteria-examples.md', import.meta.url), 'utf8'))
const batchComponentText = lf(readFileSync(new URL('../workflow-component-batch.txt', import.meta.url), 'utf8'))
const minimalProfileText = lf(readFileSync(new URL('../workflow-profile-minimal.txt', import.meta.url), 'utf8'))
const laneComponentText = lf(readFileSync(new URL('../workflow-component-lane.txt', import.meta.url), 'utf8'))

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
 *  锚词钉的是组件 / minimal 压缩句里的真实句子（不只是标题与指针）：线索非判决
 *  （LEADS, never verdicts）、四分类之一（producer missing）、正面依据二选一
 *  （cancellation record / same-duty）——句子被删或改弱必须红。 */
const deliveryMissing = (text, profile) => {
  const need = profile === 'minimal'
    ? ['RETIREMENT BAR', 'a lead, not a verdict', 'producer / consumer / goal cancelled / superseded',
       'same-duty', 'docs/agents/issue-tracker.md']
    : ['RETIREMENT EVIDENCE BAR', 'are LEADS, never verdicts',
       'producer missing /', 'consumer missing /', 'goal cancelled /', 'superseded by a same-duty',
       'human-authorized cancellation record OR same-duty', 'uncovered duties listed',
       'never dressed up as cleanup', 'no extra confirmation round',
       'docs/agents/issue-tracker.md', 'docs/code-review-brief.md']
  return need.filter((n) => !text.includes(n))
}

/** D2：tracker 规约节入口判据（只在节文本内判——摘节必红，节外漂移不误伤）。 */
const trackerSectionMissing = (text) => {
  const section = sliceBetween(text, '## 退役判据', '\n## Ready frontier')
  if (section == null) return ['## 退役判据（整节缺席）']
  const anchors = [
    '生产端缺失', '消费端缺失', '目标已取消', '同职责实现已替代', // 四分类
    '调查线索', '不单独证明模块无价值', // 线索非判决句（句子被删必须红）
    '原定目标、缺失的连接、拟承接的责任、事实边界', // 调查四件事
    '三件齐全', '正面依据', '影响范围', '未覆盖职责', // 证据门槛
    '不包装成普通清理', // 高风险动作定性
    '正常清理保留', '不新增人工确认轮', '不废除', // 判据的另一半（AC3）
    '这块代码没有职责，还是它的职责还没人接', // 判据问句
    'retirement-criteria-examples.md', 'code-review-brief.md', // 指针
    'verify-retirement-criteria.mjs', // 机械面自指
  ]
  return anchors.filter((n) => !section.includes(n))
}

/** D3：brief 5e 复核入口判据（限 5e 段内）。 */
const briefEntryMissing = (text) => {
  const section = sliceBetween(text, '5e. 退役', '\n6. **新增的每条断言')
  if (section == null) return ['5e. 退役（条目缺席）']
  const anchors = ['四分类', '调查线索', '正面依据', '不误报为漏接',
    'issue-tracker.md', 'retirement-criteria-examples.md']
  return anchors.filter((n) => !section.includes(n))
}

/** D4：样例集判据（六组锚点在场 + 匿名面无裸票号 + 样例集→规约/复核指针可达）。 */
const examplesMissing = (text) => {
  const anchors = ['匿名合成声明', 'docs/agents/issue-tracker.md',
    'E1 缺消费者仍需保留', 'E2 缺数据源须补生产链', 'E3 仅部分职责被替代不得整体退役',
    'E4 目标已获准取消可退役', 'E5 同职责替代已覆盖可退役', 'E6 真实不可达分支可清理']
  const missing = anchors.filter((n) => !text.includes(n))
  const bareTicket = text.match(/#\d{2,}/) // 匿名面：#<n> 占位合法，#123 裸票号不允许
  if (bareTicket) missing.push(`匿名违规：裸票号 ${bareTicket[0]}`)
  return missing
}

// ---- 组装四档注入面（消费既有 profileBody 机制；组装失败即用例崩，响亮退出） ----
const core = await import(pathToFileURL(REPO + '/workflow-core.mjs').href)
const composed = {}
for (const p of ['standard', 'cordis', 'ptc', 'minimal']) composed[p] = lf(await core.profileBody(p))

/** 用 core 导出的组装原语重拼注入面（扰动专用：profileBody 带缓存且不能注入改写文本
 *  ——扰动必须走同一套原语）。full = 组件 delta 原样；minimal = profile delta 先行、
 *  组件里被 profile 覆盖的 id 跳过（照 profileBody 的组装顺序）。 */
const composeFrom = async (profileText, componentTexts) => {
  const skeleton = core.parseSections(await core.skeletonText())
  const profileDeltas = profileText == null ? [] : core.parseSections(profileText).sections
  const profileIds = new Set(profileDeltas.map((s) => s.id))
  const deltas = [...profileDeltas]
  for (const t of componentTexts) {
    for (const s of core.parseSections(t).sections) {
      if (!profileIds.has(s.id)) deltas.push(s)
    }
  }
  return lf(core.joinSections(core.composeSections(skeleton.sections, deltas), skeleton.trailingNewline))
}
// 组装自检（非空洞前置）：对未扰动文本，原语重拼必须与 profileBody 逐字节一致
// ——一致成立后，扰动的组装才是单变量实验。
{
  const standardByHand = await composeFrom(null, [batchComponentText, laneComponentText])
  const minimalByHand = await composeFrom(minimalProfileText, [batchComponentText, laneComponentText])
  if (standardByHand === composed.standard && minimalByHand === composed.minimal) {
    ok('D0 compose preflight: primitive re-composition == profileBody byte-identical (standard + minimal)')
  } else {
    bad('D0 compose preflight: primitive re-composition differs from profileBody — perturbations would not be single-variable')
  }
}

// ---- D1 文本送达（四档逐一） ----
for (const p of ['standard', 'cordis', 'ptc']) {
  const missing = deliveryMissing(composed[p], p)
  if (missing.length === 0) ok(`D1 ${p}: retirement duty delivered on the composed injection`, `${composed[p].length} chars`)
  else bad(`D1 ${p}: retirement duty MISSING from the composed injection`, missing.join(' | '))
}
{
  const missing = deliveryMissing(composed.minimal, 'minimal')
  if (missing.length === 0) ok('D1 minimal: compressed retirement duty delivered', `${composed.minimal.length} chars`)
  else bad('D1 minimal: compressed retirement duty MISSING', missing.join(' | '))
}

// ---- D2 规约节入口 ----
{
  const missing = trackerSectionMissing(trackerText)
  if (missing.length === 0) ok('D2 tracker: retirement section present with four-way + evidence-bar + cleanup anchors')
  else bad('D2 tracker: retirement section anchors missing', missing.join(' | '))
}

// ---- D3 复核入口 ----
{
  const missing = briefEntryMissing(briefText)
  if (missing.length === 0) ok('D3 brief: §2 5e review-side consumption entry present')
  else bad('D3 brief: §2 5e entry anchors missing', missing.join(' | '))
}

// ---- D4 样例集 ----
{
  const missing = examplesMissing(examplesText)
  if (missing.length === 0) ok('D4 examples: six anchors present, anonymous (no bare ticket numbers)')
  else bad('D4 examples: anchors missing / anonymity violated', missing.join(' | '))
}

// ---- D5 常驻文本里的 docs 指针真实存在（.txt 源不在 doc-pointers 扫描面内） ----
{
  const duty = sliceBetween(batchComponentText, '- RETIREMENT EVIDENCE BAR', null) ?? ''
  const dutyBlock = duty.slice(0, duty.indexOf('\n- ') === -1 ? duty.length : duty.indexOf('\n- '))
  const paths = [...dutyBlock.matchAll(/(docs\/[\w./-]+\.md)/g)].map((m) => m[1])
  const dead = paths.filter((p) => !existsSync(new URL('../' + p, import.meta.url)))
  if (paths.length === 0) bad('D5 duty block: no docs pointers found (needle drift — the duty text changed shape)')
  else if (dead.length === 0) ok(`D5 duty block: ${paths.length} docs pointers all alive`, paths.join(', '))
  else bad('D5 duty block: dead docs pointers', dead.join(', '))
}

// ---- T1–T10 非空洞（内存扰动，零树写入；扰动前自检 needle > 0） ----
const expectRed = (label, baseMissing, mutatedMissing) => {
  if (mutatedMissing.length > 0 && baseMissing.length === 0) ok(`T ${label}: perturbation turns the check RED (non-vacuous)`)
  else bad(`T ${label}: perturbation did NOT turn the check red`, `base=[${baseMissing}] mutated=[${mutatedMissing}]`)
}

// T1 摘义务段（batch 组件文本删 RETIREMENT EVIDENCE BAR 条目 → standard 组装面判据红）
{
  const needle = '- RETIREMENT EVIDENCE BAR (#149'
  const needleEnd = 'review consumes\n  it at docs/code-review-brief.md §2.'
  if (hits(batchComponentText, needle) < 1 || hits(batchComponentText, needleEnd) < 1) {
    bad('T1 preflight: needle 0 hits — the duty text changed shape, fix the perturbation first')
  } else {
    const mutatedComponent = batchComponentText.slice(0, batchComponentText.indexOf(needle)) +
      batchComponentText.slice(batchComponentText.indexOf(needleEnd) + needleEnd.length)
    const mutatedComposed = await composeFrom(null, [mutatedComponent, laneComponentText])
    expectRed('T1 duty-block removed from component delta', deliveryMissing(composed.standard, 'standard'),
      deliveryMissing(mutatedComposed, 'standard'))
  }
}

// T2 削义务句（组件义务段删 leads-never-verdicts 从句 → standard 组装面判据红
// ——D1 锚词钉的是组件真实句子，句子被删/改弱必须红，不只整段摘除才红）
{
  const needle = ' are LEADS, never verdicts.'
  if (hits(batchComponentText, needle) < 1) {
    bad('T2 preflight: leads-never-verdicts clause needle 0 hits — duty text changed shape')
  } else {
    const mutatedComponent = batchComponentText.replace(needle, '.')
    const mutatedComposed = await composeFrom(null, [mutatedComponent, laneComponentText])
    expectRed('T2 duty-sentence weakened (leads-never-verdicts clause removed)',
      deliveryMissing(composed.standard, 'standard'),
      deliveryMissing(mutatedComposed, 'standard'))
  }
}

// T9 minimal 摘压缩句（minimal delta 删 RETIREMENT BAR 条目 → minimal 组装面判据红）
{
  const needle = '- RETIREMENT BAR: "no callers / no data" is a lead'
  // needleEnd 拆拼接写：连写形态 'Details:\n' 的 "s:\" 序列会被 privacy-scan 盘符规则误判（F10 实测）
  const needleEnd = 'Details:' + '\n' + '  docs/agents/issue-tracker.md.'
  if (hits(minimalProfileText, needle) < 1 || hits(minimalProfileText, needleEnd) < 2) {
    bad('T9 preflight: minimal compressed-sentence needles 0 hits — delta text changed shape')
  } else {
    // needleEnd 在 minimal delta 里出现两次（REQUIREMENT CONSERVATION 条目 + 本条目），
    // 删本条目要找 RETIREMENT BAR 之后的那个
    const start = minimalProfileText.indexOf(needle)
    const end = minimalProfileText.indexOf(needleEnd, start) + needleEnd.length
    const mutatedProfile = minimalProfileText.slice(0, start) + minimalProfileText.slice(end)
    const mutatedComposed = await composeFrom(mutatedProfile, [batchComponentText, laneComponentText])
    expectRed('T9 minimal compressed-sentence removed', deliveryMissing(composed.minimal, 'minimal'),
      deliveryMissing(mutatedComposed, 'minimal'))
  }
}

// T3 摘四分类表（tracker 删分类表 → D2 红）
{
  const needle = '| **生产端缺失** |'
  if (hits(trackerText, needle) < 1) bad('T3 preflight: four-way row needle 0 hits')
  else {
    // 单变量扰动：只删四分类 4 行（'| **' 前缀会波及节外表格行——首跑实测误删 11 行非单变量）
    const rows = ['| **生产端缺失**', '| **消费端缺失**', '| **目标已取消**', '| **同职责实现已替代**']
    const mutated = trackerText.split('\n').filter((l) => !rows.some((p) => l.startsWith(p))).join('\n')
    expectRed('T3 four-way table removed from tracker', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// T4 削证据门槛段（tracker 删三件齐全清单 → D2 红——判据削弱要红，不只整段摘除才红）
{
  const needle = '退役（删除 / 停用 / 摘出维护）'
  const endNeedle = '**不包装成普通清理**。'
  if (hits(trackerText, needle) < 1 || hits(trackerText, endNeedle) < 1) {
    bad('T4 preflight: evidence-bar paragraph needles 0 hits — section text changed shape')
  } else {
    const start = trackerText.indexOf(needle)
    const end = trackerText.indexOf(endNeedle, start) + endNeedle.length
    const mutated = trackerText.slice(0, start) + trackerText.slice(end)
    expectRed('T4 evidence-bar paragraph (three-piece list) removed', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// T5 删判据问句（tracker 判据问句行删去 → D2 红——AC3 清理半的判据削弱同样要红）
{
  const needle = '判据问句区分两类对象'
  const endNeedle = '（有批准记录、有原定接线）。'
  if (hits(trackerText, needle) < 1 || hits(trackerText, endNeedle) < 1) {
    bad('T5 preflight: criterion-question needles 0 hits — section text changed shape')
  } else {
    const start = trackerText.indexOf(needle)
    const end = trackerText.indexOf(endNeedle, start) + endNeedle.length
    const mutated = trackerText.slice(0, start) + trackerText.slice(end)
    expectRed('T5 criterion question removed from tracker', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// T6 摘 5e 条目（brief 删 5e 段 → D3 红）
{
  const needle = '5e. 退役 / 清理类改动'
  const endNeedle = '\n6. **新增的每条断言'
  if (hits(briefText, needle) < 1) bad('T6 preflight: 5e needle 0 hits')
  else {
    const start = briefText.indexOf(needle)
    const end = briefText.indexOf(endNeedle, start)
    const mutated = briefText.slice(0, start) + briefText.slice(end + 1)
    expectRed('T6 5e entry removed from brief', briefEntryMissing(briefText),
      briefEntryMissing(mutated))
  }
}

// T7 摘样例组（样例删 E5 节 → D4 红）
{
  const needle = '## E5 同职责替代已覆盖可退役'
  if (hits(examplesText, needle) < 1) bad('T7 preflight: E5 needle 0 hits')
  else {
    const start = examplesText.indexOf(needle)
    const end = examplesText.indexOf('## E6', start)
    const mutated = examplesText.slice(0, start) + examplesText.slice(end)
    expectRed('T7 example E5 removed', examplesMissing(examplesText),
      examplesMissing(mutated))
  }
}

// T10 样例注入裸票号（匿名判据反向自检：注入 #123 → D4 红——判据能抓匿名违规）
{
  const mutated = examplesText + '\n（扰动探针引用：#123）\n'
  expectRed('T10 bare ticket number injected into examples', examplesMissing(examplesText),
    examplesMissing(mutated))
}

// T8 摘整节（tracker 删「退役判据」全节 → D2 红——规约文本摘掉必须红）
{
  const start = trackerText.indexOf('## 退役判据')
  const end = trackerText.indexOf('\n## Ready frontier', start)
  if (start === -1 || end === -1) bad('T8 preflight: section boundary needles 0 hits')
  else {
    const mutated = trackerText.slice(0, start) + trackerText.slice(end + 1)
    expectRed('T8 whole tracker section removed', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// ---- 汇总（本仓 tests/*.mjs 既有形态：results 逐行 + 非零退出） ----
console.log('=== verify-retirement-criteria === (#149 退役判据：未接通 ≠ 无职责)')
for (const line of results) console.log(line)
const failed = results.filter((r) => r.startsWith('  ✗')).length
if (failed > 0) {
  console.error(`\nFAILED: ${failed} 项红`)
  process.exit(1)
}
console.log('\nOK: 文本送达（四档）+ 必要入口（规约节 / 复核 5e / 样例集）+ 指针存活 + 扰动全红')
