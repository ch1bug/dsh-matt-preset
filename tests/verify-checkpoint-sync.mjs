/**
 * verify-checkpoint-sync.mjs — #152 检查点同步（在飞决定的检查点同步、处理回执与合并前复核）：文本送达 + 必要入口 + 非空洞 + 匿名面。
 *
 * 规约单源 = docs/agents/issue-tracker.md「检查点同步、处理回执与合并前复核」节（判据本体；
 * 消费 #151 协作契约的启用判据与授权分层，本票不重定义）；本用例钉住它的承载脸互相可达
 * （票面 AC：文本送达 + 入口在场 + 样例可达 + 既有机制回归）：
 *   D0 组装自检：primitive re-composition == profileBody 逐字节（扰动才是单变量实验）。
 *   D1 常驻注入面：正文骨架 @@ checkpoint-sync 节（三检查点 + 回执三分类 + 保全 + 读取失败）
 *      经 profileBody 实际送达 standard / cordis / ptc；义务段（batch 组件 TICKET ENTRY
 *      CONTRACT 区）同面送达；minimal 用自己的两段压缩文本（@@ checkpoint-sync 覆盖节 +
 *      batch-mode 压缩义务句）——四档「实际注入与消费一致」= 每档注入面都含义务锚句 +
 *      指针，不是同一段文本四处复制。
 *   D2 规约节入口：tracker 节在场（权威记录面 / 阶段检查点 / 回执三分类 / 冲突保全 /
 *      合并前核对清单 / 分工 / 机械边界）。
 *   D3 样例集：纵向三任务闭环（P1 已采用 / P2 经核实不影响 / P3 存在冲突）+ 评审视角 +
 *      六反例（N1–N6）锚点在场；无裸票号——匿名面；样例集→规约/协作样例指针可达。
 *   D4 复核入口：code-review-brief §2 的 5g 条在场并指向判据与样例集。
 *   D5 常驻文本里的 docs 指针真实存在（.txt 注入源不在 verify-doc-pointers 的扫描面内，
 *      需要自己的存在性断言——同 verify-collaboration-contract D5 的分工）。
 *   D6 模板检查点小节（票面 AC「随分发可达」的模板面）：起步模板 §7「检查点同步与回执」
 *      在场（三检查点 / 三分类 / 合并前核对 / 读取失败锚；模板同为匿名面——无裸票号）。
 *      分发可达本身（files 白名单 + payloadOf 展开）由 verify-collaboration-contract
 *      D6b/D6c 钉住，本用例不重复断言同一分发面——模板条目缺席时那边红。
 *   T1–T11 非空洞（扰动在内存副本上做，零树写入；每个扰动前自检 needle 命中 > 0）：
 *      摘骨架节 → D1 红；削骨架判据句（never silently rewrite 反转）→ D1 红；
 *      摘义务段 → D1 红；削义务句 → D1 红；minimal 摘覆盖节 → 红；minimal 摘压缩义务句
 *      → 红；摘规约节 → D2 红；摘 5g → D4 红；摘样例组 → D3 红；样例注入裸票号 → D3 红；
 *      模板摘检查点小节 → D6 红。摘不掉守卫判据的文本手术就是假证据。
 *
 * 边界（显式声明，D16b 同族）：回执依据的真实性、核实是否真的做过由执行会话与评审承担，
 * 本用例不写自然语言语义判定；不新建决定理解器、不做持续监听、不建实时广播、不做自动
 * 权限判断、不建原子合并屏障、不代配 GitHub 保护配置、不读线上票。样例逐例与模板逐条
 * 内容只钉锚点在场，不判语义。
 *
 * 纯离线：读工作树文件 + 动态 import workflow-core 组装四档注入面。无网络、无环境依赖。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const lf = (t) => String(t).replace(/\r\n/g, '\n')

const trackerText = lf(readFileSync(new URL('../docs/agents/issue-tracker.md', import.meta.url), 'utf8'))
const briefText = lf(readFileSync(new URL('../docs/code-review-brief.md', import.meta.url), 'utf8'))
const examplesText = lf(readFileSync(new URL('../docs/checkpoint-sync-examples.md', import.meta.url), 'utf8'))
const templateText = lf(readFileSync(new URL('../docs/collaboration-starter-template.md', import.meta.url), 'utf8'))
const bodyText = lf(readFileSync(new URL('../workflow-body.txt', import.meta.url), 'utf8'))
const batchComponentText = lf(readFileSync(new URL('../workflow-component-batch.txt', import.meta.url), 'utf8'))
const laneComponentText = lf(readFileSync(new URL('../workflow-component-lane.txt', import.meta.url), 'utf8'))
const minimalProfileText = lf(readFileSync(new URL('../workflow-profile-minimal.txt', import.meta.url), 'utf8'))

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

/** D1a：骨架 @@ checkpoint-sync 节送达判据（standard/cordis/ptc 注入面）。锚词钉骨架节的
 *  真实行内短语：流程保证非实时（never live delivery / realtime claim）、无轮询无每轮
 *  联网（no background polling / per-turn network duty）、权威记录面（CONFIRMED record /
 *  private chat…not a new）、三检查点（READ AT THREE CHECKPOINTS / start-resume /
 *  request-review / pre-merge）、回执三分类（exactly ONE of three / ADOPTED /
 *  VERIFIED NOT AFFECTED / CONFLICT）、保全与局部暂停（checkpoint the work FIRST /
 *  pause only the AFFECTED part）、AC 不静默改（never silently rewrite the ACs）、
 *  已读非回执（is not a receipt）、读取失败如实（reported as failed）、合并前重判
 *  （re-queried, not from memory / old receipts never cover）、前提句（collaboration
 *  protocol (above)）、指针。句子被删或改弱必须红。 */
const bodyMissing = (text) => {
  const need = [
    'CHECKPOINT SYNC — in-flight decisions reach an independent workspace',
    'CHECKPOINT READS at phase boundaries, never live delivery: a process',
    'not a cross-machine realtime claim (no background polling service',
    'no per-turn network duty; a notification only speeds up discovery)',
    'what a CONFIRMED record ties down',
    'a private chat or a local projection is not a new',
    'READ AT THREE CHECKPOINTS — start/resume (with the',
    'request-review (latest decisions re-read before the ask)',
    "pre-merge (the current commit's evidence checked against the latest",
    'exactly ONE of three',
    'ADOPTED (the work changes accordingly; an AC adjustment takes',
    'VERIFIED NOT AFFECTED (one auditable line',
    'CONFLICT (checkpoint the work FIRST — preserve with a WIP',
    'pause only the AFFECTED part',
    'never silently rewrite the ACs, never stop unrelated tickets',
    'it" is not a receipt; a failed read is reported as failed',
    'Before merge, re-check the CURRENT commit',
    '(re-queried, not from memory)',
    'decision made after review re-opens applicability; old receipts never cover',
    'the collaboration protocol (above)',
    'docs/agents/issue-tracker.md (检查点同步)',
    'docs/checkpoint-sync-examples.md',
  ]
  return need.filter((n) => !text.includes(n))
}

/** D1b：义务段送达判据（standard/cordis/ptc 注入面，batch 组件条目）。 */
const dutyMissing = (text) => {
  const need = [
    'CHECKPOINT SYNC (#152',
    'phase boundaries — never live delivery, no background polling, no per-turn',
    'network duty; a failed read is reported as failed, never claimed as synced',
    'counts only from a confirmed record on the linked',
    'projection is not a new authority, and posting grades through the',
    'Read at start/resume, request-review and pre-merge',
    'every read ends in ONE receipt with its basis: ADOPTED / VERIFIED NOT',
    'CONFLICT (checkpoint the work FIRST, pause only the AFFECTED',
    'follow the subject authorization — never silently rewrite the ACs',
    '"Already read it" is not a receipt; a notification only speeds up',
    'Pre-merge re-checks the CURRENT commit',
    'LATEST decisions — a post-review decision re-opens applicability; old',
    'receipts never cover it, and this check is process, never a platform lock',
    'docs/agents/issue-tracker.md',
    'docs/checkpoint-sync-examples.md',
  ]
  return need.filter((n) => !text.includes(n))
}

/** D1 minimal：两段压缩文本的锚（@@ checkpoint-sync 覆盖节 + batch-mode 压缩义务句）。 */
const minimalMissing = (text) => {
  const need = [
    // 覆盖节
    'CHECKPOINT SYNC (enabled projects): in-flight decisions arrive by checkpoint',
    'never live delivery (no background polling, no',
    'a failed read is reported as failed, never claimed as',
    'counts only from a confirmed record on the linked',
    'a private chat is not a new authority',
    'ADOPTED / VERIFIED NOT AFFECTED / CONFLICT (checkpoint the work first, pause',
    '"Already read it"',
    'a post-review decision re-opens applicability',
    // batch-mode 压缩义务句
    'CHECKPOINT SYNC (enabled projects): decisions arrive by checkpoint reads',
    '(start/resume, request-review, pre-merge), each read ends in one receipt',
    '(ADOPTED / VERIFIED NOT AFFECTED / CONFLICT with basis); a failed read is',
    'reported as failed and "already read" is not a receipt',
    'docs/agents/issue-tracker.md',
  ]
  return need.filter((n) => !text.includes(n))
}

/** D2：tracker 规约节入口判据（只在节文本内判——摘节必红，节外漂移不误伤）。 */
const trackerSectionMissing = (text) => {
  const section = sliceBetween(text, '## 检查点同步', '\n## 存量票据渐进复核')
  if (section == null) return ['## 检查点同步（整节缺席）']
  const anchors = [
    '流程保证', '不宣称跨机器实时送达', '没有后台轮询服务或每轮联网义务', // 定性
    '以项目实际采用协作规约为前提', '本节不重定义', // 前提（消费 #151，不重定义）
    '关联 issue 或 PR 的可回读记录', '依据、影响范围、受影响任务', '缺任一项 = 记录不完整',
    '私人聊天 / 本地投影不是新的团队权威库', '发文与改票仍守外部动作门', // 记录面
    '开工 / 恢复', '请求复核', '**合并前**', // 三检查点（表）
    '读取失败不宣称已同步', '「读不到」不是「已同步」', // 读取失败
    '回执', '三选一', // 回执总则
    '**已采用**', '**经核实不影响**', '**存在冲突**', // 三分类（表）
    '已读不代替回执', '通知成功、评论已发送同样不是', '回执落在可回读面', // 已读非回执
    'checkpoint 保全工作', '暂停受影响部分', '沿事项授权处理', // 冲突三步
    '不单方面让所有无关票停工', '不静默修改', '当前实施 AC', '「自选出路」', // 冲突边界
    '**当前提交证据**', '冒充当前提交的证据', // 合并前核对清单
    '最新相关决定现查', '回执齐全', '只有已读 = 缺回执',
    '批准符合项目政策', '至少一位非作者', '主责自报不替代',
    '复核后新增决定重新判断适用性', '不能只引用复核完成时的旧回执',
    '不是原子锁', '不是平台物理阻断', '不声称拦截已发生', // 声明边界
    '协作契约（#151）', '#139（同工作区 inbox）', '#148 需求守恒', '不另写需求映射标准', // 分工
    'verify-checkpoint-sync.mjs', // 机械面自指
    '不新建决定理解器', '持续监听、不建实时广播、不做自动权限判断、不建原子合并屏障、不代配 GitHub 保护配置',
    '样例集与规约不随 npm 包', // 分发口径（#151 同形）
    'checkpoint-sync-examples.md', // 指针
  ]
  return anchors.filter((n) => !section.includes(n))
}

/** D3：样例集判据（纵向三任务 + 评审视角 + 六反例锚点在场 + 匿名面无裸票号 + 指针可达）。 */
const examplesMissing = (text) => {
  const anchors = ['匿名合成声明', 'docs/agents/issue-tracker.md', 'docs/collaboration-contract-examples.md',
    'docs/code-review-brief.md',
    'P1 票甲「已采用」', 'P2 票乙「经核实不影响」', 'P3 票丙「存在冲突」',
    '评审视角（纵向闭环的收口）',
    'N1 只发评论不当处理', 'N2 回执只有已读', 'N3 缺授权的「决定」',
    'N4 复核后新增方向决定只引旧回执', 'N5 读取失败宣称已同步', 'N6 旧提交测试冒充当前提交证据']
  const missing = anchors.filter((n) => !text.includes(n))
  const bareTicket = text.match(/#\d{2,}/) // 匿名面：#<n> 占位合法，#123 裸票号不允许
  if (bareTicket) missing.push(`匿名违规：裸票号 ${bareTicket[0]}`)
  return missing
}

/** D4：brief 5g 复核入口判据（限 5g 段内）。 */
const briefEntryMissing = (text) => {
  const section = sliceBetween(text, '5g. 在飞决定同步', '\n6. **新增的每条断言')
  if (section == null) return ['5g. 在飞决定同步（条目缺席）']
  const anchors = ['三检查点回执', '开工/恢复', '请求复核', '合并前',
    '已采用 / 经核实不影响 / 存在冲突', '「已读」', '不是回执',
    'checkpoint 保全', '只暂停受影响部分', '不静默改 AC',
    '当前提交证据', '现查', '批准符合项目政策', '重新判断适用性',
    '读取失败不宣称已同步', '检查点同步、处理回执与合并前复核', 'checkpoint-sync-examples.md',
    '不是原子锁或平台物理阻断', '项目实际采用协作规约为前提']
  return anchors.filter((n) => !section.includes(n))
}

/** D6a：模板检查点小节锚（§7 在场 + §6 实时排除句已改指检查点；模板同为匿名面）。 */
const templateMissing = (text) => {
  const anchors = [
    '## 7. 检查点同步与回执',
    '变更同步走 §7 的检查点流程', '没有后台轮询服务 / 每轮联网义务', // §6 排除句微调
    '开工 / 恢复、请求复核、合并前',
    '关联 issue / PR 上的可回读记录', '私人聊天不是新的团队权威库',
    '三选一回执', '**已采用**', '**经核实不影响**', '**存在冲突**',
    'checkpoint 保全', '不静默改 AC',
    '旧提交的测试结果不冒充当前提交的证据', '复核后新增决定重新判断适用性',
    '「读不到」不是「已同步」',
    'checkpoint-sync-examples.md',
  ]
  const missing = anchors.filter((n) => !text.includes(n))
  const bareTicket = text.match(/#\d{2,}/) // 模板同为匿名面（消费者可见工件）
  if (bareTicket) missing.push(`匿名违规：裸票号 ${bareTicket[0]}`)
  return missing
}

// ---- 组装四档注入面（消费既有 profileBody 机制；组装失败即用例崩，响亮退出） ----
const core = await import(pathToFileURL(REPO + '/workflow-core.mjs').href)
const composed = {}
for (const p of ['standard', 'cordis', 'ptc', 'minimal']) composed[p] = lf(await core.profileBody(p))

/** 用 core 导出的组装原语重拼注入面（扰动专用：profileBody 带缓存且不能注入改写文本
 *  ——扰动必须走同一套原语）。full = 组件 delta 原样；minimal = profile delta 先行、
 *  组件里被 profile 覆盖的 id 跳过（照 profileBody 的组装顺序）。
 *  skeletonOverride 供 T1/T2 扰动骨架（正文节摘除 / 削句）——默认 null = 盘上骨架。 */
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
    ok(`D1 ${p}: checkpoint-sync body section + duty block delivered on the composed injection`, `${composed[p].length} chars`)
  else bad(`D1 ${p}: checkpoint-sync text MISSING from the composed injection`,
    [...missBody, ...missDuty].join(' | '))
}
{
  const missing = minimalMissing(composed.minimal)
  if (missing.length === 0) ok('D1 minimal: compressed checkpoint-sync section + duty delivered', `${composed.minimal.length} chars`)
  else bad('D1 minimal: compressed checkpoint-sync text MISSING', missing.join(' | '))
}

// ---- D2 规约节入口 ----
{
  const missing = trackerSectionMissing(trackerText)
  if (missing.length === 0) ok('D2 tracker: checkpoint-sync section present with record-face + checkpoints + receipts + conflict + pre-merge anchors')
  else bad('D2 tracker: checkpoint-sync section anchors missing', missing.join(' | '))
}

// ---- D3 样例集 ----
{
  const missing = examplesMissing(examplesText)
  if (missing.length === 0) ok('D3 examples: longitudinal P1-P3 + reviewer view + N1-N6 present, anonymous (no bare ticket numbers)')
  else bad('D3 examples: anchors missing / anonymity violated', missing.join(' | '))
}

// ---- D4 复核入口 ----
{
  const missing = briefEntryMissing(briefText)
  if (missing.length === 0) ok('D4 brief: §2 5g review-side consumption entry present')
  else bad('D4 brief: §2 5g entry anchors missing', missing.join(' | '))
}

// ---- D5 常驻文本里的 docs 指针真实存在（.txt 源不在 doc-pointers 扫描面内） ----
{
  const duty = sliceBetween(batchComponentText, '- CHECKPOINT SYNC (#152', null) ?? ''
  const dutyBlock = duty.slice(0, duty.indexOf('\n- ') === -1 ? duty.length : duty.indexOf('\n- '))
  const bodySection = sliceBetween(bodyText, '@@ checkpoint-sync', '@@ workflow-enforcement') ?? ''
  const paths = [...new Set([
    ...[...dutyBlock.matchAll(/(docs\/[\w./-]+\.md)/g)].map((m) => m[1]),
    ...[...bodySection.matchAll(/(docs\/[\w./-]+\.md)/g)].map((m) => m[1].replace(/\.+$/, '')),
  ])]
  const dead = paths.filter((p) => !existsSync(new URL('../' + p, import.meta.url)))
  if (paths.length === 0) bad('D5 pointer blocks: no docs pointers found (needle drift — the duty/body text changed shape)')
  else if (dead.length === 0) ok(`D5 duty + body blocks: ${paths.length} docs pointers all alive`, paths.join(', '))
  else bad('D5 duty + body blocks: dead docs pointers', dead.join(', '))
}

// ---- D6 模板检查点小节（内容锚 + 匿名面；分发可达由 verify-collaboration-contract D6b/D6c 钉） ----
{
  const missing = templateMissing(templateText)
  if (missing.length === 0) ok('D6 template: §7 checkpoint section + §6 realtime exclusion rewording present, anonymous')
  else bad('D6 template: checkpoint anchors missing / anonymity violated', missing.join(' | '))
}

// ---- T1–T11 非空洞（内存扰动，零树写入；扰动前自检 needle > 0） ----
const expectRed = (label, baseMissing, mutatedMissing) => {
  if (mutatedMissing.length > 0 && baseMissing.length === 0) ok(`T ${label}: perturbation turns the check RED (non-vacuous)`)
  else bad(`T ${label}: perturbation did NOT turn the check red`, `base=[${baseMissing}] mutated=[${mutatedMissing}]`)
}

// T1 摘骨架节（骨架删 @@ checkpoint-sync 节 → standard 组装面判据红）
{
  const startNeedle = '@@ checkpoint-sync'
  const endNeedle = '@@ workflow-enforcement'
  if (hits(bodyText, startNeedle) < 1 || hits(bodyText, endNeedle) < 1) {
    bad('T1 preflight: body-section needles 0 hits')
  } else {
    const start = bodyText.indexOf(startNeedle)
    const end = bodyText.indexOf(endNeedle, start)
    const mutatedSkeleton = bodyText.slice(0, start) + bodyText.slice(end)
    const mutatedComposed = await composeFrom(null, [batchComponentText, laneComponentText], mutatedSkeleton)
    expectRed('T1 body section removed from the skeleton', bodyMissing(composed.standard),
      bodyMissing(mutatedComposed))
  }
}

// T2 削骨架节判据句（AC 不静默改句反转 → standard 组装面判据红——判据削弱要红）
{
  const needle = 'never silently rewrite the ACs, never stop unrelated tickets'
  if (hits(bodyText, needle) < 1) {
    bad('T2 preflight: never-silently-rewrite needle 0 hits — body text changed shape')
  } else {
    const mutatedSkeleton = bodyText.replace(needle, 'may rewrite the ACs and stop any tickets as needed')
    const mutatedComposed = await composeFrom(null, [batchComponentText, laneComponentText], mutatedSkeleton)
    expectRed('T2 body criterion weakened (no-silent-AC-rewrite clause inverted)',
      bodyMissing(composed.standard), bodyMissing(mutatedComposed))
  }
}

// T3 摘义务段（batch 组件文本删 CHECKPOINT SYNC 条目 → standard 组装面判据红）
{
  const needle = '- CHECKPOINT SYNC (#152'
  const needleEnd = 'anonymous walkthrough: docs/checkpoint-sync-examples.md.'
  if (hits(batchComponentText, needle) < 1 || hits(batchComponentText, needleEnd) < 1) {
    bad('T3 preflight: needle 0 hits — the duty text changed shape, fix the perturbation first')
  } else {
    const mutatedComponent = batchComponentText.slice(0, batchComponentText.indexOf(needle)) +
      batchComponentText.slice(batchComponentText.indexOf(needleEnd) + needleEnd.length)
    const mutatedComposed = await composeFrom(null, [mutatedComponent, laneComponentText])
    expectRed('T3 duty-block removed from component delta', dutyMissing(composed.standard),
      dutyMissing(mutatedComposed))
  }
}

// T4 削义务句（组件义务段删已读非回执句 → standard 组装面判据红）
{
  const needle = '"Already read it" is not a receipt; a notification only speeds up\n  discovery.'
  if (hits(batchComponentText, needle) < 1) {
    bad('T4 preflight: already-read needle 0 hits — duty text changed shape')
  } else {
    const mutatedComponent = batchComponentText.replace(needle, '')
    const mutatedComposed = await composeFrom(null, [mutatedComponent, laneComponentText])
    expectRed('T4 duty-sentence removed (already-read / notification clause)',
      dutyMissing(composed.standard), dutyMissing(mutatedComposed))
  }
}

// T5 minimal 摘覆盖节（minimal delta 删 @@ checkpoint-sync 节 → minimal 红——
// 骨架全文回到注入面，压缩锚句缺失照样红：覆盖节的压缩义务不可静默缺席）
{
  const startNeedle = '@@ checkpoint-sync'
  const endNeedle = '@@ enforcement-done'
  if (hits(minimalProfileText, startNeedle) < 1 || hits(minimalProfileText, endNeedle) < 1) {
    bad('T5 preflight: minimal override-section needles 0 hits — delta text changed shape')
  } else {
    const start = minimalProfileText.indexOf(startNeedle)
    const end = minimalProfileText.indexOf(endNeedle, start)
    const mutatedProfile = minimalProfileText.slice(0, start) + minimalProfileText.slice(end)
    const mutatedComposed = await composeFrom(mutatedProfile, [batchComponentText, laneComponentText])
    expectRed('T5 minimal override section removed', minimalMissing(composed.minimal),
      minimalMissing(mutatedComposed))
  }
}

// T6 minimal 摘压缩义务句（minimal delta 的 batch-mode 删 CHECKPOINT SYNC 条目 → minimal 红）
{
  const needle = '- CHECKPOINT SYNC (enabled projects): decisions arrive by checkpoint reads'
  // 条目结尾 = 本条目自己的「docs/agents/issue-tracker.md.」——indexOf 从 needle 起
  // 找，先命中本条目结尾（COLLABORATION 条目在同节更前，其 Details 不在本条目内）
  const endNeedle = 'docs/agents/issue-tracker.md.'
  if (hits(minimalProfileText, needle) < 1) {
    bad('T6 preflight: minimal compressed-duty needle 0 hits — delta text changed shape')
  } else {
    const start = minimalProfileText.indexOf(needle)
    const end = minimalProfileText.indexOf(endNeedle, start) + endNeedle.length
    const mutatedProfile = minimalProfileText.slice(0, start) + minimalProfileText.slice(end)
    const mutatedComposed = await composeFrom(mutatedProfile, [batchComponentText, laneComponentText])
    expectRed('T6 minimal compressed-duty sentence removed', minimalMissing(composed.minimal),
      minimalMissing(mutatedComposed))
  }
}

// T7 摘规约节（tracker 删「检查点同步」全节 → D2 红——规约文本摘掉必须红）
{
  const start = trackerText.indexOf('## 检查点同步')
  const end = trackerText.indexOf('\n## 存量票据渐进复核', start)
  if (start === -1 || end === -1) bad('T7 preflight: section boundary needles 0 hits')
  else {
    const mutated = trackerText.slice(0, start) + trackerText.slice(end + 1)
    expectRed('T7 whole tracker section removed', trackerSectionMissing(trackerText),
      trackerSectionMissing(mutated))
  }
}

// T8 摘 5g 条目（brief 删 5g 段 → D4 红）
{
  const needle = '5g. 在飞决定同步'
  const endNeedle = '\n6. **新增的每条断言'
  if (hits(briefText, needle) < 1) bad('T8 preflight: 5g needle 0 hits')
  else {
    const start = briefText.indexOf(needle)
    const end = briefText.indexOf(endNeedle, start)
    const mutated = briefText.slice(0, start) + briefText.slice(end + 1)
    expectRed('T8 5g entry removed from brief', briefEntryMissing(briefText),
      briefEntryMissing(mutated))
  }
}

// T9 摘样例组（样例删 P3 节 → D3 红）
{
  const needle = '## P3 票丙「存在冲突」'
  if (hits(examplesText, needle) < 1) bad('T9 preflight: P3 needle 0 hits')
  else {
    const start = examplesText.indexOf(needle)
    const end = examplesText.indexOf('## 评审视角', start)
    const mutated = examplesText.slice(0, start) + examplesText.slice(end)
    expectRed('T9 example P3 removed', examplesMissing(examplesText),
      examplesMissing(mutated))
  }
}

// T10 样例注入裸票号（匿名判据反向自检：注入 #456 → D3 红——判据能抓匿名违规）
{
  const mutated = examplesText + '\n（扰动探针引用：#456）\n'
  expectRed('T10 bare ticket number injected into examples', examplesMissing(examplesText),
    examplesMissing(mutated))
}

// T11 模板摘检查点小节（模板删 §7 全节 → D6 红）
{
  const startNeedle = '## 7. 检查点同步与回执'
  const endNeedle = '---'
  if (hits(templateText, startNeedle) < 1) bad('T11 preflight: template §7 needle 0 hits')
  else {
    const start = templateText.indexOf(startNeedle)
    const end = templateText.indexOf(endNeedle, start)
    const mutated = templateText.slice(0, start) + templateText.slice(end)
    expectRed('T11 template checkpoint section removed', templateMissing(templateText),
      templateMissing(mutated))
  }
}

// ---- 汇总（本仓 tests/*.mjs 既有形态：results 逐行 + 非零退出） ----
console.log('=== verify-checkpoint-sync === (#152 检查点同步：在飞决定的检查点同步、处理回执与合并前复核)')
for (const line of results) console.log(line)
const failed = results.filter((r) => r.startsWith('  ✗')).length
if (failed > 0) {
  console.error(`\nFAILED: ${failed} 项红`)
  process.exit(1)
}
console.log('\nOK: 文本送达（四档）+ 必要入口（规约节 / 复核 5g / 样例集）+ 指针存活 + 模板检查点小节 + 扰动全红')
