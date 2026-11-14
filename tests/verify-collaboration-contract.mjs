/**
 * verify-collaboration-contract.mjs — #151 协作契约（项目显式启用的单票协作）：文本送达 + 必要入口 + 非空洞 + 分发可达。
 *
 * 规约单源 = docs/agents/issue-tracker.md「协作契约：项目显式启用的单票协作」节（判据本体）；
 * 本用例钉住它的六张承载脸互相可达（票面 AC：文本送达 + 入口在场 + 模板分发 + 既有机制回归）：
 *   D0 组装自检：primitive re-composition == profileBody 逐字节（扰动才是单变量实验）。
 *   D1 常驻注入面：正文骨架 @@ collaboration 节（适用条件 + 判据分层）经 profileBody 实际送达
 *      standard / cordis / ptc；义务段（batch 组件 TICKET ENTRY CONTRACT 区）同面送达；
 *      minimal 用自己的两段压缩文本（@@ collaboration 覆盖节 + batch-mode 压缩义务句）——
 *      四档「实际注入与消费一致」= 每档注入面都含义务锚句 + 指针，不是同一段文本四处复制。
 *   D2 规约节入口：tracker 节在场（适用判据 / 授权分层 / 主责认领 / PR 验收 / 机械边界）。
 *   D3 复核入口：code-review-brief §2 的 5f 条在场并指向判据与样例集。
 *   D4 样例集：六组匿名样例在场（P1–P2 / N1–N4 锚点；无裸票号——匿名面）。
 *   D5 常驻文本里的 docs 指针真实存在（.txt 注入源不在 verify-doc-pointers 的扫描面内，
 *      需要自己的存在性断言——同 verify-requirement-conservation D5 的分工）。
 *   D6 模板分发可达（票面 AC「模板随消费者产物可达」+ 纵向证明反例「模板未随安装分发」）：
 *      package.json files 白名单含模板条目 + payloadOf 展开实际含模板文件 + 模板内容锚
 *      （默认 PR / 非作者批准 / 自报不替代批准 / 项目确认采用 / 不自动配置平台保护；模板
 *      同为匿名面——无裸票号）。
 *   T1–T12 非空洞（扰动在内存副本上做，零树写入；每个扰动前自检 needle 命中 > 0）：
 *      摘义务段 → D1 红；削义务句（never a lock 句）→ D1 红；minimal 摘压缩义务句 → 红；
 *      minimal 摘覆盖节 → 红；摘正文节 → 红；削正文节判据句（contributor count 反转）→ 红；
 *      摘规约节 → D2 红；摘 5f → D3 红；摘样例组 → D4 红；样例注入裸票号 → D4 红；
 *      模板摘批准锚 → D6 红；files 白名单摘模板条目 → D6 红。摘不掉守卫判据的文本手术就是假证据。
 *
 * 边界（显式声明，D16b 同族）：批准独立性、授权真实性与采用记录的真实性由项目与评审承担，
 * 本用例不写自然语言权限判定，不新建权限推断器、不读平台权限配置、不建跨机器权限服务、
 * 不新增运行态传感器。样例逐例与模板逐条内容只钉锚点在场，不判语义。
 *
 * 纯离线：读工作树文件 + 动态 import workflow-core 组装四档注入面 + payloadOf 读本仓
 * package.json。无网络、无环境依赖。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { payloadOf } from '../lib/payload.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const lf = (t) => String(t).replace(/\r\n/g, '\n')

const trackerText = lf(readFileSync(new URL('../docs/agents/issue-tracker.md', import.meta.url), 'utf8'))
const briefText = lf(readFileSync(new URL('../docs/code-review-brief.md', import.meta.url), 'utf8'))
const examplesText = lf(readFileSync(new URL('../docs/collaboration-contract-examples.md', import.meta.url), 'utf8'))
const templateText = lf(readFileSync(new URL('../docs/collaboration-starter-template.md', import.meta.url), 'utf8'))
const bodyText = lf(readFileSync(new URL('../workflow-body.txt', import.meta.url), 'utf8'))
const batchComponentText = lf(readFileSync(new URL('../workflow-component-batch.txt', import.meta.url), 'utf8'))
const laneComponentText = lf(readFileSync(new URL('../workflow-component-lane.txt', import.meta.url), 'utf8'))
const minimalProfileText = lf(readFileSync(new URL('../workflow-profile-minimal.txt', import.meta.url), 'utf8'))
const pkgText = lf(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

/** 命中数（needle 是字面）。 */
const hits = (text, needle) => text.split(needle).length - 1

/** 从文本里截取「从 startNeedle 起到 endNeedle 前」的节（找不到返回 null）。 */
const sliceBetween = (text, startNeedle, endNeedle) => {
  const start = text.indexOf(startNeedle)
  if (start === -1) return null
  const end = endNeedle == null ? text.length : text.indexOf(endNeedle, start + startNeedle.length)
  return text.slice(start, end === -1 ? text.length : end)
}

// ---- 判据函数（正向 + 扰动共用同一实现；返回缺失锚句数组，空数组 = 绿） ----

/** D1a：义务段送达判据（standard/cordis/ptc 注入面）。锚词钉的是 batch 组件义务段里的
 *  真实句子：一位主责（ONE owner per ticket）、回读（read back after claiming）、非锁
 *  （never a lock）、自报不替代批准（never substitutes for that approval）、非作者
 *  （at least one NON-AUTHOR）、暂停合并不全停（pauses the MERGE）、授权按事项
 *  （grades by SUBJECT）——句子被删或改弱必须红。 */
const dutyMissing = (text) => {
  const need = [
    'COLLABORATION CONTRACT (#151',
    'EXPLICITLY\n  enabled collaboration mode): ONE owner per ticket, many contributors',
    'claim is read back after claiming',
    'duplicate claims coordinate BEFORE',
    'assignment is a responsibility record, never a lock',
    'the owner\'s own "done" never',
    'substitutes for that approval (at least one NON-AUTHOR)',
    'pauses the MERGE, never unrelated local work',
    'grades by SUBJECT (requirement / cross-module interface / merge-and-release)',
    'never derived from chat presence, write access, or review duty',
    'docs/agents/issue-tracker.md',
    'docs/collaboration-starter-template.md',
  ]
  return need.filter((n) => !text.includes(n))
}

/** D1b：正文节送达判据（standard/cordis/ptc 注入面）。锚词钉骨架 @@ collaboration 节的
 *  真实句子：显式启用（EXPLICITLY enabled）、贡献者数量不推断（contributor count never
 *  implies）、个人路径（NO team-approval duty）、权威入口（own authority entry）、缺项
 *  呈现（presented as missing）、按事项三分（grades BY SUBJECT）、三不推导、只停相关
 *  （pauses only the RELATED decision）、非作者批准、指针。 */
const bodyMissing = (text) => {
  const need = [
    'COLLABORATION — cross-workspace work via issues and pull requests',
    'EXPLICITLY enabled collaboration mode',
    'A contributor count never implies it',
    'NO team-approval\nduty',
    'own authority entry — never a',
    'presented as missing',
    'Authorization grades BY SUBJECT —',
    'requirement acceptance / cross-module interfaces / merge-and-release',
    'derived from chat presence, repo write access, or',
    'pauses only the RELATED decision',
    'read back after claiming',
    'duplicate claims coordinate first',
    'never called a lock',
    'at least one NON-AUTHOR',
    'never substitutes for approval',
    'docs/agents/issue-tracker.md (协作契约)',
    'docs/collaboration-starter-template.md',
  ]
  return need.filter((n) => !text.includes(n))
}

/** D1 minimal：两段压缩文本的锚（@@ collaboration 覆盖节 + batch-mode 压缩义务句）。 */
const minimalMissing = (text) => {
  const need = [
    'COLLABORATION (cross-workspace issue/PR work) applies ONLY',
    'EXPLICITLY enabled it',
    'a contributor count\nnever implies it',
    'NO\nteam-approval duty',
    'adopted at its own entry, never',
    'grades by SUBJECT (requirement / interface / merge)',
    'never derived from chat presence, write access, or review duty',
    'pauses only the related decision',
    'ONE owner per ticket',
    'assignment is\nnever a lock',
    'NON-AUTHOR approval',
    'never substitutes',
    'COLLABORATION (enabled projects): ONE owner per ticket',
    'claim read back',
    'Details: docs/agents/issue-tracker.md',
    'docs/collaboration-starter-template.md',
  ]
  return need.filter((n) => !text.includes(n))
}

/** D2：tracker 规约节入口判据（只在节文本内判——摘节必红，节外漂移不误伤）。 */
const trackerSectionMissing = (text) => {
  const section = sliceBetween(text, '## 协作契约', '\n## Ready frontier')
  if (section == null) return ['## 协作契约（整节缺席）']
  const anchors = [
    '显式启用', '可回读的采用记录', '不凭贡献者数量推断', '个人路径不变成强制团队审批', // 适用判据
    '权威入口', '不复制第二套', '缺项明确呈现', '不能自动虚构批准者',
    '需求授权', '跨模块接口授权', '合并 / 发布授权', '互不推导', // 授权分层
    '能聊 ≠ 能写，能写 ≠ 能审，能审 ≠ 能放行合并', // 三不推导句
    '只暂停相关决定', '本地无关工作继续', // 授权不清只停相关（句跨行断，锚取行内短语）
    '每票一位主责', 'issue / PR 关联对应实现', '认领后回读', '重复认领先协调', // 主责与认领
    '换人明确移交', '指派是职责记录', '不宣称写权互斥', '#136',
    '默认 PR', '至少一位非作者', '主责自报完成不替代批准', // PR 验收
    '暂停合并', '本地无关实施继续',
    'verify-collaboration-contract.mjs', // 机械面自指
    '不新建自然语言权限推断器', '跨机器权限服务', '不自动配置平台保护',
    'Pull requests as a triage surface', // 与 PR-as-triage 分工
    'collaboration-contract-examples.md', 'collaboration-starter-template.md', 'code-review-brief.md', // 指针
  ]
  return anchors.filter((n) => !section.includes(n))
}

/** D3：brief 5f 复核入口判据（限 5f 段内）。 */
const briefEntryMissing = (text) => {
  const section = sliceBetween(text, '5f. 协作', '\n6. **新增的每条断言')
  if (section == null) return ['5f. 协作（条目缺席）']
  const anchors = ['显式启用', '贡献者数量', '个人路径', '授权分层', '主责闭环',
    '非作者', '自报', '不替代批准', 'issue-tracker.md', 'collaboration-contract-examples.md']
  return anchors.filter((n) => !section.includes(n))
}

/** D4：样例集判据（六组锚点在场 + 匿名面无裸票号 + 样例集→规约/模板指针可达）。 */
const examplesMissing = (text) => {
  const anchors = ['匿名合成声明', 'docs/agents/issue-tracker.md', 'docs/collaboration-starter-template.md',
    'P1 已有规约接入', 'P2 空白项目采用模板', 'N1 无授权启用', 'N2 缺主责',
    'N3 主责自批冒充独立批准', 'N4 模板未随安装分发']
  const missing = anchors.filter((n) => !text.includes(n))
  const bareTicket = text.match(/#\d{2,}/) // 匿名面：#<n> 占位合法，#123 裸票号不允许
  if (bareTicket) missing.push(`匿名违规：裸票号 ${bareTicket[0]}`)
  return missing
}

/** D6a：模板内容锚（默认 PR / 非作者批准 / 自报不替代 / 确认采用 / 不自动配置平台保护
 *  + 主责认领条目；模板同为匿名面——无裸票号）。 */
const templateMissing = (text) => {
  const anchors = [
    '确认采用', '采用记录', '不凭贡献者数量推断', '个人路径',
    '默认 PR', '至少一位非作者批准', '主责自报完成不替代批准',
    '主责', '认领后回读', '重复认领先协调', '指派是职责记录，不是锁',
    '授权不清时只暂停相关决定', '合并规则不明 → 暂停合并',
    '命令 + 退出码 + 证据路径',
    '不自动配置', '平台保护',
    'docs/agents/issue-tracker.md', 'docs/collaboration-contract-examples.md',
  ]
  const missing = anchors.filter((n) => !text.includes(n))
  const bareTicket = text.match(/#\d{2,}/) // 模板同为匿名面（消费者可见工件）
  if (bareTicket) missing.push(`匿名违规：裸票号 ${bareTicket[0]}`)
  return missing
}

/** D6b：分发条目判据（package.json files 白名单含模板）。 */
const templateFileEntry = 'docs/collaboration-starter-template.md'
const filesWhitelistMissing = (pkgJsonText) =>
  pkgJsonText.includes(`"${templateFileEntry}"`) ? [] : [`files 白名单缺 ${templateFileEntry}`]

// ---- 组装四档注入面（消费既有 profileBody 机制；组装失败即用例崩，响亮退出） ----
const core = await import(pathToFileURL(REPO + '/workflow-core.mjs').href)
const composed = {}
for (const p of ['standard', 'cordis', 'ptc', 'minimal']) composed[p] = lf(await core.profileBody(p))

/** 用 core 导出的组装原语重拼注入面（扰动专用：profileBody 带缓存且不能注入改写文本
 *  ——扰动必须走同一套原语）。full = 组件 delta 原样；minimal = profile delta 先行、
 *  组件里被 profile 覆盖的 id 跳过（照 profileBody 的组装顺序）。
 *  skeletonOverride 供 T5/T6 扰动骨架（正文节摘除 / 削句）——默认 null = 盘上骨架。 */
const composeFrom = async (profileText, componentTexts, skeletonOverride = null) => {
  const skeleton = core.parseSections(skeletonOverride ?? await core.skeletonText())
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
  const missBody = bodyMissing(composed[p])
  const missDuty = dutyMissing(composed[p])
  if (missBody.length === 0 && missDuty.length === 0)
    ok(`D1 ${p}: collaboration body section + duty block delivered on the composed injection`, `${composed[p].length} chars`)
  else bad(`D1 ${p}: collaboration text MISSING from the composed injection`,
    [...missBody, ...missDuty].join(' | '))
}
{
  const missing = minimalMissing(composed.minimal)
  if (missing.length === 0) ok('D1 minimal: compressed collaboration section + duty delivered', `${composed.minimal.length} chars`)
  else bad('D1 minimal: compressed collaboration text MISSING', missing.join(' | '))
}

// ---- D2 规约节入口 ----
{
  const missing = trackerSectionMissing(trackerText)
  if (missing.length === 0) ok('D2 tracker: collaboration section present with applicability + grading + ownership + PR anchors')
  else bad('D2 tracker: collaboration section anchors missing', missing.join(' | '))
}

// ---- D3 复核入口 ----
{
  const missing = briefEntryMissing(briefText)
  if (missing.length === 0) ok('D3 brief: §2 5f review-side consumption entry present')
  else bad('D3 brief: §2 5f entry anchors missing', missing.join(' | '))
}

// ---- D4 样例集 ----
{
  const missing = examplesMissing(examplesText)
  if (missing.length === 0) ok('D4 examples: six anchors present, anonymous (no bare ticket numbers)')
  else bad('D4 examples: anchors missing / anonymity violated', missing.join(' | '))
}

// ---- D5 常驻文本里的 docs 指针真实存在（.txt 源不在 doc-pointers 扫描面内） ----
{
  const duty = sliceBetween(batchComponentText, '- COLLABORATION CONTRACT', null) ?? ''
  const dutyBlock = duty.slice(0, duty.indexOf('\n- ') === -1 ? duty.length : duty.indexOf('\n- '))
  const bodySection = sliceBetween(bodyText, '@@ collaboration', '@@ workflow-enforcement') ?? ''
  const paths = [...new Set([
    ...[...dutyBlock.matchAll(/(docs\/[\w./-]+\.md)/g)].map((m) => m[1]),
    ...[...bodySection.matchAll(/(docs\/[\w./-]+\.md)/g)].map((m) => m[1].replace(/\.+$/, '')),
  ])]
  const dead = paths.filter((p) => !existsSync(new URL('../' + p, import.meta.url)))
  if (paths.length === 0) bad('D5 pointer blocks: no docs pointers found (needle drift — the duty/body text changed shape)')
  else if (dead.length === 0) ok(`D5 duty + body blocks: ${paths.length} docs pointers all alive`, paths.join(', '))
  else bad('D5 duty + body blocks: dead docs pointers', dead.join(', '))
}

// ---- D6 模板分发可达（files 白名单 + payloadOf 展开 + 内容锚 + 匿名面） ----
{
  const contentMissing = templateMissing(templateText)
  const whitelistMissing = filesWhitelistMissing(pkgText)
  let payloadHit = null
  let payloadError = null
  try {
    const { entries } = await payloadOf(REPO)
    payloadHit = entries.includes(templateFileEntry)
  } catch (error) {
    payloadError = String(error?.message ?? error)
  }
  if (contentMissing.length === 0) ok('D6a template: adoption + PR/non-author/self-report + evidence anchors present, anonymous')
  else bad('D6a template: anchors missing / anonymity violated', contentMissing.join(' | '))
  if (whitelistMissing.length === 0) ok('D6b package.json files: starter template whitelisted', templateFileEntry)
  else bad('D6b package.json files: template entry missing', whitelistMissing.join(' | '))
  if (payloadError !== null) bad('D6c payloadOf: expansion threw', payloadError)
  else if (payloadHit === true) ok('D6c payloadOf: expanded payload contains the starter template (shipped with the preset)', templateFileEntry)
  else bad('D6c payloadOf: expanded payload does NOT contain the starter template (the "template not shipped" counter-example is LIVE)', templateFileEntry)
}

// ---- T1–T12 非空洞（内存扰动，零树写入；扰动前自检 needle > 0） ----
const expectRed = (label, baseMissing, mutatedMissing) => {
  if (mutatedMissing.length > 0 && baseMissing.length === 0) ok(`T ${label}: perturbation turns the check RED (non-vacuous)`)
  else bad(`T ${label}: perturbation did NOT turn the check red`, `base=[${baseMissing}] mutated=[${mutatedMissing}]`)
}

// T1 摘义务段（batch 组件文本删 COLLABORATION CONTRACT 条目 → standard 组装面判据红）
{
  const needle = '- COLLABORATION CONTRACT (#151'
  const needleEnd = 'starter template: docs/collaboration-starter-template.md.'
  if (hits(batchComponentText, needle) < 1 || hits(batchComponentText, needleEnd) < 1) {
    bad('T1 preflight: needle 0 hits — the duty text changed shape, fix the perturbation first')
  } else {
    const mutatedComponent = batchComponentText.slice(0, batchComponentText.indexOf(needle)) +
      batchComponentText.slice(batchComponentText.indexOf(needleEnd) + needleEnd.length)
    const mutatedComposed = await composeFrom(null, [mutatedComponent, laneComponentText])
    expectRed('T1 duty-block removed from component delta', dutyMissing(composed.standard),
      dutyMissing(mutatedComposed))
  }
}

// T2 削义务句（组件义务段删 never-a-lock 从句 → standard 组装面判据红
// ——D1 锚词钉的是组件真实句子，句子被删/改弱必须红，不只整段摘除才红）
{
  const needle = ', never a lock.'
  if (hits(batchComponentText, needle) < 1) {
    bad('T2 preflight: never-a-lock clause needle 0 hits — duty text changed shape')
  } else {
    const mutatedComponent = batchComponentText.replace(needle, '.')
    const mutatedComposed = await composeFrom(null, [mutatedComponent, laneComponentText])
    expectRed('T2 duty-sentence weakened (never-a-lock clause removed)',
      dutyMissing(composed.standard), dutyMissing(mutatedComposed))
  }
}

// T3 minimal 摘压缩义务句（minimal delta 的 batch-mode 删 COLLABORATION 条目 → minimal 红）
{
  const needle = '- COLLABORATION (enabled projects): ONE owner per ticket'
  // needleEnd 取「Details: docs/…」同行形态——minimal delta 里 CONSERVATION / RETIREMENT 条目
  // 是「Details:\n  docs/…」换行形态，同行形态仅本条目独有（唯一，1 次命中即预检通过）
  const needleEnd = 'Details: docs/agents/issue-tracker.md.'
  if (hits(minimalProfileText, needle) < 1 || hits(minimalProfileText, needleEnd) < 1) {
    bad('T3 preflight: minimal compressed-duty needles 0 hits — delta text changed shape')
  } else {
    const start = minimalProfileText.indexOf(needle)
    const end = minimalProfileText.indexOf(needleEnd, start) + needleEnd.length
    const mutatedProfile = minimalProfileText.slice(0, start) + minimalProfileText.slice(end)
    const mutatedComposed = await composeFrom(mutatedProfile, [batchComponentText, laneComponentText])
    expectRed('T3 minimal compressed-duty sentence removed', minimalMissing(composed.minimal),
      minimalMissing(mutatedComposed))
  }
}

// T4 minimal 摘 collaboration 覆盖节（minimal delta 删 @@ collaboration 节 → minimal 红——
// 骨架全文回到注入面，压缩锚句缺失照样红：覆盖节的压缩义务不可静默缺席）
{
  const startNeedle = '@@ collaboration'
  const endNeedle = '@@ enforcement-done'
  if (hits(minimalProfileText, startNeedle) < 1 || hits(minimalProfileText, endNeedle) < 1) {
    bad('T4 preflight: minimal override-section needles 0 hits — delta text changed shape')
  } else {
    const start = minimalProfileText.indexOf(startNeedle)
    const end = minimalProfileText.indexOf(endNeedle, start)
    const mutatedProfile = minimalProfileText.slice(0, start) + minimalProfileText.slice(end)
    const mutatedComposed = await composeFrom(mutatedProfile, [batchComponentText, laneComponentText])
    expectRed('T4 minimal override section removed', minimalMissing(composed.minimal),
      minimalMissing(mutatedComposed))
  }
}

// T5 摘正文节（骨架删 @@ collaboration 节 → standard 组装面判据红）
{
  const startNeedle = '@@ collaboration'
  const endNeedle = '@@ workflow-enforcement'
  if (hits(bodyText, startNeedle) < 1 || hits(bodyText, endNeedle) < 1) {
    bad('T5 preflight: body-section needles 0 hits')
  } else {
    const start = bodyText.indexOf(startNeedle)
    const end = bodyText.indexOf(endNeedle, start)
    const mutatedSkeleton = bodyText.slice(0, start) + bodyText.slice(end)
    const mutatedComposed = await composeFrom(null, [batchComponentText, laneComponentText], mutatedSkeleton)
    expectRed('T5 body section removed from the skeleton', bodyMissing(composed.standard),
      bodyMissing(mutatedComposed))
  }
}

// T6 削正文节判据句（contributor-count 句反转 → standard 组装面判据红——判据削弱要红）
{
  const needle = 'A contributor count never implies it'
  if (hits(bodyText, needle) < 1) {
    bad('T6 preflight: contributor-count needle 0 hits — body text changed shape')
  } else {
    const mutatedSkeleton = bodyText.replace(needle, 'A contributor count may suggest it')
    const mutatedComposed = await composeFrom(null, [batchComponentText, laneComponentText], mutatedSkeleton)
    expectRed('T6 body criterion weakened (contributor-count clause inverted)',
      bodyMissing(composed.standard), bodyMissing(mutatedComposed))
  }
}

// T7 摘规约节（tracker 删「协作契约」全节 → D2 红——规约文本摘掉必须红）
{
  const start = trackerText.indexOf('## 协作契约')
  const end = trackerText.indexOf('\n## Ready frontier', start)
  if (start === -1 || end === -1) bad('T7 preflight: section boundary needles 0 hits')
  else {
    const mutated = trackerText.slice(0, start) + trackerText.slice(end + 1)
    expectRed('T7 whole tracker section removed', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// T8 摘 5f 条目（brief 删 5f 段 → D3 红）
{
  const needle = '5f. 协作'
  const endNeedle = '\n6. **新增的每条断言'
  if (hits(briefText, needle) < 1) bad('T8 preflight: 5f needle 0 hits')
  else {
    const start = briefText.indexOf(needle)
    const end = briefText.indexOf(endNeedle, start)
    const mutated = briefText.slice(0, start) + briefText.slice(end + 1)
    expectRed('T8 5f entry removed from brief', briefEntryMissing(briefText),
      briefEntryMissing(mutated))
  }
}

// T9 摘样例组（样例删 N3 节 → D4 红）
{
  const needle = '## N3 主责自批冒充独立批准'
  if (hits(examplesText, needle) < 1) bad('T9 preflight: N3 needle 0 hits')
  else {
    const start = examplesText.indexOf(needle)
    const end = examplesText.indexOf('## N4', start)
    const mutated = examplesText.slice(0, start) + examplesText.slice(end)
    expectRed('T9 example N3 removed', examplesMissing(examplesText),
      examplesMissing(mutated))
  }
}

// T10 样例注入裸票号（匿名判据反向自检：注入 #456 → D4 红——判据能抓匿名违规）
{
  const mutated = examplesText + '\n（扰动探针引用：#456）\n'
  expectRed('T10 bare ticket number injected into examples', examplesMissing(examplesText),
    examplesMissing(mutated))
}

// T11 模板摘批准锚（模板删「至少一位非作者批准」→ D6a 红）
{
  const needle = '至少一位非作者批准'
  if (hits(templateText, needle) < 1) bad('T11 preflight: template non-author needle 0 hits')
  else {
    const mutated = templateText.replace(needle, '作者自查即可')
    expectRed('T11 template non-author anchor removed', templateMissing(templateText),
      templateMissing(mutated))
  }
}

// T12 files 白名单摘模板条目（package.json 文本删模板条目 → D6b 红）
{
  const needle = `"${templateFileEntry}",\n    `
  if (hits(pkgText, needle) < 1) bad('T12 preflight: files-whitelist needle 0 hits — package.json changed shape')
  else {
    const mutated = pkgText.replace(needle, '')
    expectRed('T12 template entry removed from files whitelist', filesWhitelistMissing(pkgText),
      filesWhitelistMissing(mutated))
  }
}

// ---- 汇总（本仓 tests/*.mjs 既有形态：results 逐行 + 非零退出） ----
console.log('=== verify-collaboration-contract === (#151 协作契约：项目显式启用的单票协作)')
for (const line of results) console.log(line)
const failed = results.filter((r) => r.startsWith('  ✗')).length
if (failed > 0) {
  console.error(`\nFAILED: ${failed} 项红`)
  process.exit(1)
}
console.log('\nOK: 文本送达（四档）+ 必要入口（规约节 / 复核 5f / 样例集）+ 指针存活 + 模板分发可达 + 扰动全红')
