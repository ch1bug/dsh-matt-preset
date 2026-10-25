/**
 * verify-silence-guardrails.mjs — #157：静默类失败判据表（S1–S4）守卫 + 声明面⊆实现面
 * 一致性门 + S3 样板消费者（installer 降级输出断言）。
 *
 * 为什么存在（#157，2026-10-22 全景复盘）：静默是最大失败族（7+ 张），复发票（#113 ×3）
 * 证明逐实例追补赶不上新洞——故判据按「类」立（S1–S4 单一事实源 = docs/silence-guardrails.md，
 * 本用例 A 段钉它的锚与指针）；「声明面 ⊆ 实现面」一致性门（B 段）收 #116/#117 的复发面；
 * S3 的首个样板消费者（C 段）把 #80 修复的降级输出分岔钉成回归锁。
 *
 * 划界（勿双写，#157 拍板 + #116 让渡评论）：
 *   - #117 钉「模式描述 ↔ 实挂 roster」的对齐断言（差异表方向 (b)）——本门不做；
 *   - #116 执行方向 A（挂 tool-presentation 行让 run_code 成真 + 实测读数）——本门不动
 *     roster、不改正文；run_code 在本门只**显式登记为未兑现**（带票号与期望行）；
 *   - 本门只管「注入正文 / persona 声称的工具 ∈ 实挂 roster ∪ 显式登记」。
 *
 * ⚠ 判定层声明（simulated 口径，别删）：本门是**静态声明面判定**——读正文文本 + roster
 * 源文本，不挂载、不真调工具。「门绿」≠「工具运行时可用」（#116 的 M7c 教训：断言注入
 * 文本含 `run_code` 就绿，被读成能力断言）。运行时可达性归各工具的实测读数。
 *
 * 非空洞性（#108/#110 口径，四条硬约束）：
 *   - B1 出处正向钉：声称表里的锚句必须真在正文里（正文删掉声称 → 红）；
 *   - B2 provider 钉：roster 源（agent.cordis.yml）摘掉提供行 → 红（读**源**不读载体——
 *     载体是生成物，改源不 regen 时载体滞后，读载体会假绿）；
 *   - B3 反向钉：正文里新增 backtick 工具词形而不登记 → 红（提取式 canary 见 B0）；
 *   - B4 gap 防腐：登记的期望行一旦真挂上（#116 落地）→ 红，逼人回来把 gap 升级成
 *     provider——一张只会放宽的登记表最后会宽到把真缺口也放过去（P4 精神）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeDsh } from '../lib/runtime-probe.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const loudSkip = (name, detail = '') => {
  results.push(`  - SKIP (loud) ${name}${detail ? ' — ' + detail : ''}`)
}
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

// ── A 段：判据表锚 + 指针（S1–S4 的单一事实源必须在场，被删/漂移即红）──────────
const GUARDRAILS_DOC = 'docs/silence-guardrails.md'
const tableRows = [
  { id: 'S1', criterion: '缺席必响亮', counterExample: '#69' },
  { id: 'S2', criterion: '追加型工件禁存在性判定', counterExample: '#140' },
  { id: 'S3', criterion: '降级必显式声明', counterExample: '#80' },
  { id: 'S4', criterion: '复核委派必只读', counterExample: '#114' },
]

let doc = null
try { doc = read(GUARDRAILS_DOC) } catch { /* 表缺席由 SG1 红 */ }
if (doc === null) {
  bad('SG1. 判据表存在', `${GUARDRAILS_DOC} 读不到`)
  report('SILENCE GUARDRAILS VERIFY (#157)')
}

for (const row of tableRows) {
  const line = doc.split('\n').find(l => l.includes(`**${row.id}**`))
  if (line === undefined) {
    bad(`SG1. 判据表 ${row.id} 行在场`, `docs/silence-guardrails.md 无 "| **${row.id}** |" 行`)
    continue
  }
  const hasCriterion = line.includes(row.criterion)
  const hasCounter = line.includes(row.counterExample)
  // 机械检验方式列：每行必须引用一条能跑的检查（scripts/ 或 tests/ 路径字面）。
  const hasMechanical = /`(node )?(scripts|tests)\/[\w./-]+`/.test(line)
  if (hasCriterion && hasCounter && hasMechanical)
    ok(`SG1. ${row.id} 行三要素齐：判据「${row.criterion}」+ 反例 ${row.counterExample} + 机械检验方式`,
      line.slice(0, 60) + '…')
  else bad(`SG1. ${row.id} 行三要素`, JSON.stringify({ hasCriterion, hasCounter, hasMechanical }))
}

// SG2：AGENTS.md 一行指针（判据表不是孤儿文档——新会话从 AGENTS.md 能找到它）。
const agents = read('AGENTS.md')
if (agents.includes(GUARDRAILS_DOC) && /S1[–-]S4/.test(agents))
  ok('SG2. AGENTS.md 指针在场（docs/silence-guardrails.md + S1–S4）')
else bad('SG2. AGENTS.md 指针', '缺指向 docs/silence-guardrails.md 的 S1–S4 行')

// SG3：enforcer 规则面只留锚点（D23 同构）——判据全文**不**进注入正文：正文里出现
// S1–S4 判据的完整复述（判据名出现在 workflow-body.txt / profile delta）即漂移。
// ⚠ 显式声明不覆盖（D13/Y7d 口径）：本判据只匹配**中文判据短语**字面——四份注入正文
// 是英文，判据表的**英文翻译版**复述进正文时此断言恒绿。跨语言复述是开放集（机械提取
// 必误抓），交人判/复核；威胁模型弱（正文作者就是本仓会话，判据表锚点纪律在同会话视野内）。
const injected = ['workflow-body.txt', 'workflow-profile-ptc.txt', 'workflow-profile-minimal.txt', 'workflow-profile-cordis.txt']
  .map(f => read(f)).join('\n')
const leaked = tableRows.filter(r => injected.includes(r.criterion))
if (leaked.length === 0)
  ok('SG3. 判据全文未进注入正文（enforcer/正文只留锚点，D23 同构——第二份全文复述是漂移种子；不覆盖英文翻译版复述，见上 declare）')
else bad('SG3. 注入正文里出现判据复述', leaked.map(r => `${r.id}「${r.criterion}」`).join(' / '))

// SG4：判据表「机械检验方式」列引用的守卫文件全部存在（表指向的检查必须真能跑——
// 引用不存在的守卫 = 散文承诺，正是本票要消灭的形态）。
// 提取正则与 SG1 的行级判据**同源**（`(?:node )?` 前缀）——两处各写一份会漂（#129「正则
// 照抄判据」同族：两轴复审视实测，第一版只吃裸路径形态，`node tests/…` 前缀引用全部漏检，
// S2/S4 行的唯一守卫引用逃过断链断言）。提取后剥掉 node 前缀再查存在性。
const citedGuards = [...doc.matchAll(/`(?:node )?(scripts|tests)\/[\w./-]+`/g)]
  .map(m => m[0].slice(1, -1).replace(/^node /, ''))
const missingGuards = [...new Set(citedGuards)].filter(g => !existsSync(join(REPO, g)))
if (missingGuards.length === 0 && citedGuards.length > 0)
  ok('SG4. 判据表引用的机械检验面全部存在', `${new Set(citedGuards).size} 个守卫 / 命令`)
else bad('SG4. 判据表引用的机械检验面', missingGuards.length > 0 ? `缺 ${missingGuards.join(' / ')}` : '一条引用都没有（表退化成散文）')

// ── B 段：声明面 ⊆ 实现面一致性门 ─────────────────────────────────────────────
// 声称表 = 本文件的单一登记处。三种条目：
//   provider：声称的工具由 roster 行提供（rows ∈ agent.cordis.yml 行 id，或 mutation 注入）；
//   gap：声称了但 roster 无提供行——必须带票号与期望行（期望行挂上后 B4 红，逼人升级登记）；
//   meta：泛指声明（tool registry 整体）——只钉出处，无单一 provider 可断（显式豁免，不装成守住了）。
// prose 类（自然语言声称，如 "the handoff tool"）不在 backtick 提取面内——靠 B1 出处正向钉，
// 无反向兜底：自然语言声称是开放集，机械提取必误抓（D13/Y7d 口径：显式声明不覆盖）。
const CLAIMS = [
  {
    claim: 'run_code', kind: 'gap',
    anchor: { file: 'workflow-profile-ptc.txt', sentence: 'a program and runs it (`run_code`)' },
    gap: {
      ticket: '#116', expectedRow: 'tool-presentation',
      why: 'run_code 不是插件注册的工具（dsh-tools 注册表 mode: ptc 时的保留传输）；激活开关 = preset 挂 tool-presentation 行（#116 方向 A 已拍、行未挂，其让渡评论明写承诺↔roster 机械守卫归 #157）。本门要求该声称显式登记，不静默。',
    },
  },
  { claim: 'agent()', kind: 'provider', rows: ['workflow-ptc'], via: 'agent',
    anchor: { file: 'workflow-profile-ptc.txt', sentence: '(`agent()`, `parallel()`, `pipeline()`' },
    note: 'workflow hooks 由 roster 行 workflow-ptc（@deepseek-ai/dsh-workflow-ptc，delegation group 内）提供——其 README: "Scripts keep the `agent()`, `parallel()`, `pipeline()`, `phase()` and `log()` hooks"' },
  { claim: 'parallel()', kind: 'provider', rows: ['workflow-ptc'], via: 'agent', anchor: { file: 'workflow-profile-ptc.txt', sentence: '(`agent()`, `parallel()`, `pipeline()`' } },
  { claim: 'pipeline()', kind: 'provider', rows: ['workflow-ptc'], via: 'agent', anchor: { file: 'workflow-profile-ptc.txt', sentence: '(`agent()`, `parallel()`, `pipeline()`' } },
  { claim: 'phase()', kind: 'provider', rows: ['workflow-ptc'], via: 'agent', anchor: { file: 'workflow-profile-ptc.txt', sentence: '`phase()`, `log()`)' } },
  { claim: 'log()', kind: 'provider', rows: ['workflow-ptc'], via: 'agent', anchor: { file: 'workflow-profile-ptc.txt', sentence: '`phase()`, `log()`)' } },
  {
    claim: 'tools.<name>(...)', kind: 'meta',
    anchor: { file: 'workflow-profile-ptc.txt', sentence: '(`tools.<name>(...)`' },
    why: '泛指声明（tool registry 整体交给程序做 SDK）——提供面 = roster 全体，无单一行可断；显式豁免 provider 检查，只钉出处。',
  },
  { claim: 'cordis_inspect_list', kind: 'provider', rows: ['tool-cordis'], via: 'mutation',
    anchor: { file: 'workflow-profile-cordis.txt', sentence: 'Before writing or editing plugin code: `cordis_inspect_list`' },
    note: 'tool-cordis 行不在 agent.cordis.yml 源里——它由 lib/bundle-patch.mjs 的 CORDIS_EXTRA_ROWS 仅注入 matt-cordis 载体（ADR-0015 §4）' },
  { claim: 'cordis_inspect_query', kind: 'provider', rows: ['tool-cordis'], via: 'mutation',
    anchor: { file: 'workflow-profile-cordis.txt', sentence: 'then `cordis_inspect_query` to read the exact' } },
  { claim: 'the handoff tool', kind: 'provider', rows: ['handoff-tool'], via: 'agent', prose: true,
    anchor: { file: 'workflow-body.txt', sentence: 'the handoff tool writes a portable markdown' } },
  { claim: 'the goal tool', kind: 'provider', rows: ['command-goal', 'tool-goal'], via: 'agent', prose: true,
    anchor: { file: 'workflow-body.txt', sentence: 'if the goal tool rejects the change' } },
  { claim: 'the task list', kind: 'provider', rows: ['tool-todo'], via: 'agent', prose: true,
    anchor: { file: 'workflow-body.txt', sentence: 'Maintain the task list as work moves' } },
  { claim: 'the skill catalog', kind: 'provider', rows: ['skill-filesystem', 'tool-skill'], via: 'agent', prose: true,
    anchor: { file: 'agent.cordis.yml', face: 'persona', sentence: 'skill catalog, read its instructions' },
    note: 'persona prefix 的声称面（自然语言）：技能目录+加载器由 roster 两行提供；具体技能名是跨会话可变清单，不进登记（否则第二份清单必腐）' },
]

/** backtick 内容里「工具样式」的判据：`tools.` 前缀 / `()` 结尾（函数形态）/ snake_case。
 *  排除形态（实测 2026-10-25 全集 51 种 backtick token）：skill 名（`grilling`）、
 *  节 id（`ptc-loop-surface`，连字符）、命令（`git push`）、路径（`docs/…`）、
 *  标记（`retro: done @ <commit>`）——都不含 `_` / `()` / `tools.`。 */
const isToolShaped = (t) =>
  t.startsWith('tools.') || /\(\)$/.test(t) || /^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(t)

/** 非「声称可用」的工具样式词形白名单：enforcer 外部动作门的 tool/call 事件名
 *  （plugin_manager 的动作面）。它们是**门监听的动作**，不是模型可调工具；正文与
 *  enforcer 清单的一致性由 V16 断言钉（D44），此处只防本门的提取面误伤。 */
const NON_TOOL = new Map([
  ['plugin_manager', 'enforcer 门事件名（cordis delta 的 gate 扩展），非模型工具；enforcer↔正文一致由 V16 钉'],
  ['install_bundle', '同上（plugin_manager 动作）'],
  ['set_plugin', '同上（plugin_manager 动作）'],
  ['set_bundle', '同上（plugin_manager 动作）'],
  ['list_plugins', '同上（plugin_manager 只读动作）'],
  ['list_bundles', '同上（plugin_manager 只读动作）'],
  // #163：正文 WAKE ORCHESTRATION 条叙述应答通道时指名的**运行时事件**（编排件
  // pendingHumanQuestion 的检测判据，chain3 实测形态）——它是编排器轮询面读到的
  // 事件，不是本 preset 提供的模型工具；其判据行为由
  // tests/verify-autonomy-orchestration.mjs O2c/O3e 钉（词形从提取面消失 →
  // 白名单陈旧 → SG9 红，防腐口径同上）。
  ['ask_user_question', '#163 唤醒编排检测的运行时事件名（编排件 pendingHumanQuestion 判据），非 preset 模型工具；行为由 verify-autonomy-orchestration O2c/O3e 钉'],
])

/** persona prefix 文本（agent.cordis.yml 的 `prefix: |` 块）——B3 的 persona 提取面。 */
const personaPrefixText = () => {
  const lines = read('agent.cordis.yml').split('\n')
  const start = lines.findIndex(l => /^\s*prefix: \|$/.test(l))
  if (start < 0) return null
  const indent = lines[start].match(/^\s*/)[0].length
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === '') { out.push(l); continue }
    if (l.match(/^\s*/)[0].length <= indent) break
    out.push(l)
  }
  return out.join('\n')
}

const INJECTED_FILES = ['workflow-body.txt', 'workflow-profile-ptc.txt', 'workflow-profile-minimal.txt', 'workflow-profile-cordis.txt']
const persona = personaPrefixText()
if (persona === null) bad('SG5. persona prefix 块可解析（agent.cordis.yml `prefix: |`）')
else ok('SG5. persona prefix 块可解析', `${persona.length} chars`)

/** 提取面 = 四份注入正文全文 + persona prefix（返回 Map<词形, Set<文件>>）。 */
const extractToolShaped = () => {
  const found = new Map()
  const feed = (text, label) => {
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      if (!isToolShaped(m[1])) continue
      if (!found.has(m[1])) found.set(m[1], new Set())
      found.get(m[1]).add(label)
    }
  }
  for (const f of INJECTED_FILES) feed(read(f), f)
  if (persona !== null) feed(persona, 'agent.cordis.yml#persona-prefix')
  return found
}
const extracted = extractToolShaped()

// SG6（B0 canary）：提取式自检——已知声称必须被抓到（提取式坏 = 后面全部假绿），
// 提取集不空且有下界（防 isToolShaped 被改成恒假）。
const canaries = ['run_code', 'agent()', 'tools.<name>(...)']
const canaryMissed = canaries.filter(c => !extracted.has(c))
if (canaryMissed.length === 0 && extracted.size >= 10)
  ok('SG6. 提取式 canary：已知声称全部命中、提取集达下界', `${extracted.size} 个工具样式词形（canary: ${canaries.join(' / ')}）`)
else bad('SG6. 提取式 canary', `漏 ${canaryMissed.join(' / ') || '无'}；提取集 ${extracted.size} 个（阈值 10）——提取式静默失效，B 段读数不可信`)

// SG7（B1 出处正向钉）：每条声称的锚句必须真在出处里（表↔正文，防表空转/漂移）。
// agent.cordis.yml 的锚句钉 **persona prefix 块**（注入面）——不是文件任意处（注释里
// 出现同句不算声称）。正文文件（workflow-body / profile delta）全文即注入面。
const anchorMissed = CLAIMS.filter(c => {
  const face = c.anchor.face === 'persona' ? persona : read(c.anchor.file)
  return face === null || !face.includes(c.anchor.sentence)
})
if (anchorMissed.length === 0)
  ok('SG7. 声称表出处正向钉：全部锚句在正文/persona 里', `${CLAIMS.length} 条`)
else bad('SG7. 声称表出处锚句失配', anchorMissed.map(c => `${c.claim} → ${c.anchor.file} 不含「${c.anchor.sentence}」`).join(' | '))

/** roster 源的行块表：Map<行id, {disabled: boolean, at: number}>。读 agent.cordis.yml
 *  （源）而非 4 份载体（生成物）——改源不 regen 时载体滞后，读载体会假绿。 */
const rosterRows = () => {
  const lines = read('agent.cordis.yml').split('\n')
  const rows = new Map()
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*- id: (\S+)\s*$/.exec(lines[i])
    if (m === null) continue
    let disabled = false
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*- id: \S+\s*$/.test(lines[j])) break
      if (/^\s*disabled: true\s*$/.test(lines[j])) { disabled = true; break }
    }
    rows.set(m[1], { disabled })
  }
  return rows
}
const ROSTER = rosterRows()

// SG8（B2 provider 钉）：provider 行必须在 roster 源里且非 disabled（mutation 类钉
// lib/bundle-patch.mjs 的注入声明——CORDIS_EXTRA_ROWS）。
const bundlePatch = read('lib/bundle-patch.mjs')
const providerFailures = []
for (const c of CLAIMS) {
  if (c.kind !== 'provider') continue
  for (const row of c.rows) {
    if (c.via === 'mutation') {
      if (!bundlePatch.includes(`- id: ${row}`)) providerFailures.push(`${c.claim}: mutation 注入行 ${row} 不在 lib/bundle-patch.mjs`)
    } else {
      const hit = ROSTER.get(row)
      if (hit === undefined) providerFailures.push(`${c.claim}: roster 行 ${row} 不在 agent.cordis.yml`)
      else if (hit.disabled) providerFailures.push(`${c.claim}: roster 行 ${row} disabled: true（提供的工具不可用）`)
    }
  }
}
if (providerFailures.length === 0) {
  const viaMutation = CLAIMS.filter(c => c.kind === 'provider' && c.via === 'mutation').flatMap(c => c.rows)
  ok('SG8. 声称工具的 provider 全在实挂 roster（源行在场、非 disabled；mutation 行钉 bundle-patch）',
    `${new Set(CLAIMS.filter(c => c.kind === 'provider').flatMap(c => c.rows)).size} 行${viaMutation.length > 0 ? `（其中 mutation: ${viaMutation.join(', ')}）` : ''}`)
} else bad('SG8. provider roster 钉', providerFailures.join(' | '))

// SG9（B3 反向钉）：提取面里每个工具样式词形 ⊆ 声称表 ∪ 白名单（新增声称不登记 → 红）；
// 白名单每条必须仍在提取面里（陈旧白名单 = 只会放宽的表，P4 精神）。
const claimedWords = new Set(CLAIMS.map(c => c.claim))
const unregistered = [...extracted.keys()].filter(w => !claimedWords.has(w) && !NON_TOOL.has(w))
const staleWhitelist = [...NON_TOOL.keys()].filter(w => !extracted.has(w))
if (unregistered.length === 0 && staleWhitelist.length === 0)
  ok('SG9. 反向钉：工具样式词形全部登记（声称 ∪ 白名单），白名单无陈旧项',
    `提取 ${extracted.size} = 声称 ${[...extracted.keys()].filter(w => claimedWords.has(w)).length} + 门事件白名单 ${[...extracted.keys()].filter(w => NON_TOOL.has(w)).length}`)
else bad('SG9. 反向钉',
  [...unregistered.map(w => `未登记的声称「${w}」（出处：${[...(extracted.get(w) ?? [])].join(', ')}）`),
   ...staleWhitelist.map(w => `白名单陈旧「${w}」（正文已不再引用）`)].join(' | '))

// SG10（B4 gap 防腐）：登记的期望行一旦真挂上（任何提供面出现 `id: tool-presentation`）
// → 登记过时 → 红，逼人把 gap 升级成 provider。判定面盖三处（源 / mutation / ptc 载体），
// #116 无论走源+regen 还是直改载体都会被抓到。
const gaps = CLAIMS.filter(c => c.kind === 'gap')
const staleGaps = []
for (const g of gaps) {
  const row = g.gap.expectedRow
  const surfaces = { 'agent.cordis.yml': ROSTER.has(row), 'lib/bundle-patch.mjs': bundlePatch.includes(`- id: ${row}`), 'presets/matt-ptc.patch.yml': read('presets/matt-ptc.patch.yml').includes(`id: ${row}`) }
  const hitAt = Object.entries(surfaces).filter(([, v]) => v).map(([k]) => k)
  if (hitAt.length > 0) staleGaps.push(`${g.claim}: 期望行 ${row} 已挂上（${hitAt.join(', ')}）——gap 登记过时，升级成 provider`)
}
if (staleGaps.length === 0)
  ok('SG10. gap 登记防腐：期望行均未挂（挂上即红，逼人更新登记）', gaps.map(g => `${g.claim} → ${g.gap.ticket}`).join('; '))
else bad('SG10. gap 登记过时', staleGaps.join(' | '))

// SG11：gap 条目必须带票号与理由（无票号的 gap 是无限期豁免——正是静默缺口的形态）。
const nakedGaps = gaps.filter(g => !/^#\d+$/.test(g.gap.ticket ?? '') || (g.gap.why ?? '').trim() === '')
if (nakedGaps.length === 0)
  ok('SG11. gap 条目全带票号+理由', gaps.map(g => `${g.claim}@${g.gap.ticket}`).join('; '))
else bad('SG11. gap 条目缺票号/理由', nakedGaps.map(g => g.claim).join(' | '))

// ── C 段：S3 样板消费者——installer 装载降级的输出断言（#80 修复的回归锁）─────────
// S3 判据：降级必显式声明（stdout 与事实一致；真话不得只住在 stderr）。#80 之前 stdout
// 在降级时仍打印 `mounted into profile '<p>'`——谎报成功。此处**离线实跑** installer 的
// install 分支（DSH_HOME=临时目录、探测面收窄 → 确定性走降级），断言输出如实分岔。
// 成功分支（真挂载）的输出面归 DSH_MATT_INSTALLER=1 的 tests/verify-installer.mjs 环境面。
const C0ENV_KEYS = ['DSH_MATT_DSH', 'DSH_DESKTOP_ROOT', 'DSH_MATT_DSH_SRC', 'DSH_PNPM', 'DSH_MATT_PNPM']
let c1Env
{
  const home = mkdtempSync(join(tmpdir(), 'dsh-sg-s3-'))
  c1Env = { ...process.env, DSH_HOME: home }
  for (const k of C0ENV_KEYS) delete c1Env[k]
  // PATH 收窄到 node 目录 + 系统目录：probeDsh 的 PATH 档扫不到 dsh，Windows 子进程仍能起。
  const narrow = [dirname(process.execPath), join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), process.env.SystemRoot ?? 'C:\\Windows']
    .filter(Boolean).join(';')
  c1Env.PATH = narrow
  c1Env.Path = narrow
}

// C0：降级前提自检（S1 精神：不静默假设环境）——probeDsh 纯函数先判：收窄后的探测面
// 若仍命中 dsh（意外环境，如 System32 里真有 dsh.exe），降级分支不可达 → loud skip。
// 清理在 finally：loud-skip 分支同样要删 home（复审实测：mkdtemp 无条件建、skip 分支
// 不删 = 每次意外环境跑漏一个 dsh-sg-s3-* 临时目录）。
const probe = probeDsh({ env: c1Env })
try {
if (probe.found) {
  loudSkip('C. installer 降级输出断言', `收窄后的探测面仍解析到 dsh（source=${probe.source}）——降级分支不可达，环境侧断言未验证`)
} else {
  ok('C0. 降级前提：收窄探测面后 probeDsh 不命中（降级分支可达）', `source=${probe.source}`)
  const run = spawnSync(process.execPath, [join(REPO, 'bin', 'install.mjs'), 'install', '--profile', 'matt-sg-s3'], {
    cwd: REPO, encoding: 'utf8', env: c1Env,
  })
  const stdout = run.stdout ?? ''
  const stderr = run.stderr ?? ''
  const store = join(c1Env.DSH_HOME, '.agent-presets', 'matt')

  if (run.status === 0) ok('C1. install exit 0（降级不是失败——store 侧照常完成）')
  else bad('C1. install exit', `exit ${run.status}：降级分支应当落盘成功（S3 钉的是输出如实，不是把降级改成失败）\n${stderr.split('\n').slice(-5).join('\n')}`)

  if (!stdout.includes('mounted into profile')) ok('C2. 降级时 stdout 不谎报「mounted into profile」（#80 形态不再复发）')
  else bad('C2. 降级时 stdout 谎报已挂载', stdout.trim().split('\n').filter(l => l.includes('mounted')).join(' | '))

  if (stdout.includes('NOT mounted')) ok('C3. 降级在 stdout 显式声明 NOT mounted（真话上 stdout，不住 stderr）')
  else bad('C3. 降级未在 stdout 声明 NOT mounted', stdout.trim().split('\n').slice(-3).join(' | '))

  if (stderr.includes('dsh not found on PATH — skipped profile mount'))
    ok('C4. stderr 响亮降级告警 + 指路（D47）')
  else bad('C4. stderr 降级告警', stderr.trim().split('\n').slice(-3).join(' | '))

  if (existsSync(join(store, 'VERSION.json')))
    ok('C5. store 侧真落盘（VERSION.json 在）——C2/C3 读的是真安装的输出，不是早退残句')
  else bad('C5. store 未落盘', 'VERSION.json 缺——installer 没真跑完，C2/C3 的读数不作数')
}
} finally {
  // 清理：只删本段自己 mkdtemp 出来的那个 DSH_HOME（home 安全纪律）；
  // loud-skip 分支与断言分支同删——mkdtemp 是无条件建的。
  rmSync(c1Env.DSH_HOME, { recursive: true, force: true, maxRetries: 3 })
}

report('SILENCE GUARDRAILS VERIFY (#157: S1–S4 判据表锚 + 声明面⊆实现面门 + S3 样板)')
