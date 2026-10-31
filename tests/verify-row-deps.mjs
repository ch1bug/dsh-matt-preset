/**
 * verify-row-deps.mjs — #105（开发机 ≠ 用户环境）：matt roster 每个 row 的能力档位
 * 机械审计——「开发机通过 ≠ 用户可用」的 roster 面防线。
 *
 * 为什么存在（票面根因，实测钉住）：开发机桌面 profile 装了 12 个 experimental bundle，
 * 验证永远在开发机上跑 → 「常驻 row 引用了用户环境没有的能力」这一类错误在开发机上
 * **永远照不出来**（tool-ralph 即实例）。本守卫把档位判定变成声明面的机械断言：
 *
 * 判据（row 级，#105 票面评论 2026-10-19 勘误口径——比「包是否 core」严，
 * tool-ralph 与 str-replace-editor 两条都被它一致判出）：
 *   - core-row：row id 在官方出货 preset（official-presets-roster-v1.json 的 official
 *     并集）**或**出货宿主组合（base / web-app 的 cordis.patch.yml，冻结快照
 *     official-runtime-deps-v1.json 的 hostRows）中有**同 id 声明**；
 *   - in-repo：name = `dsh-matt-preset/<file>.mjs`（随 preset 包分发）；
 *   - `cordis:group`：组合语法行，非包引用；
 *   - 其余 → 必须在 tierRegistry（同 fixture）登记，且逐条落 tier 断言：
 *     non-in-box 必须 disabled；mounted 且 docPath 的行必须有文档明示（Z5）。
 *
 * 判定输入 = **四份生成载体**（cordis.patch.yml + presets/matt-*.patch.yml），不读
 * agent.cordis.yml 源——扰动必须打在运行时真正读的那份上（#108 纪律，
 * verify-roster-alignment 同口径）。解析口径：`/^\s*- id: (\S+)\s*$/`（任意缩进，
 * 同族正则）+ 块内首个 `name:`。
 *
 * 判定层（honesty gate，SG 同款标注）：**静态声明面判定**——「门绿」不等于「用户
 * 环境一定可用」（#105 AC 边界原文）；运行时挂载判定归挂具实测面（verify-preset-modes
 * 的 simulated 先例）。数据是冻结快照（离线事实源，D48 先例）；上游版本线移动时按
 * fixture meta.recapture 重取——有意重取不是漂移。
 *
 * 非空洞扰动（#105 AC「引用一个不存在的 opt-in 包 → 审计面必须红」，本票实施时
 * 逐条真跑，红读数见 .scratch/verify105/）：
 *   - 载体加 `- id: tool-ghost` / `@deepseek-ai/dsh-tool-ghost` → R1 红（无档可归）；
 *   - tierRegistry 删 tool-ralph 条目 → R1 红（常驻 enabled 的 in-box opt-in 未登记）；
 *   - 删 docs/preset-runtime-deps.md 的 tool-ralph 段 → R3 红（文档明示缺席）；
 *   - fixture 把 tool-ralph 提进 publishedDependencies → R4 红（「默认未启用」前提漂移）；
 *   - 载体 tool-ralph 行翻 disabled: true → R2 红（常驻前提翻转，复审 F3 对称半边）；
 *   - fixture hostRows 加 tool-ralph → R4 红（evidence「宿主组合均无」半边，复审 F5）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

// ── G1: the frozen snapshot must exist and self-describe ────────────────────
let deps
try {
  deps = JSON.parse(readFileSync(join(repo, 'tests/fixtures/official-runtime-deps-v1.json'), 'utf8'))
} catch (error) {
  bad('G1. runtime-deps snapshot parses', String(error?.message ?? error))
  report('ROW DEPS VERIFY (#105)')
}
if (deps.meta?.sources?.length >= 4 && deps.meta?.capturedOn && deps.meta?.guard)
  ok('G1. runtime-deps snapshot parses with sources + capture date', `capturedOn=${deps.meta.capturedOn}`)
else bad('G1. runtime-deps snapshot meta incomplete', JSON.stringify(Object.keys(deps.meta ?? {})))

let snap
try {
  snap = JSON.parse(readFileSync(join(repo, 'tests/fixtures/official-presets-roster-v1.json'), 'utf8'))
} catch (error) {
  bad('G1b. official roster snapshot parses', String(error?.message ?? error))
  report('ROW DEPS VERIFY (#105)')
}
// 官方四档 row 并集（排除 preset-* 声明行——roster-alignment 同口径）
const officialRows = new Set()
for (const rows of Object.values(snap.official))
  for (const id of rows) if (!id.startsWith('preset-')) officialRows.add(id)
ok('G1c. official preset row union loaded', `${officialRows.size} rows from ${Object.keys(snap.official).length} presets`)

const hostRows = new Set([...(deps.hostRows?.base ?? []), ...(deps.hostRows?.webApp ?? deps.hostRows?.['web-app'] ?? [])])
if (hostRows.size > 0) ok('G1d. host composition rows loaded', `${hostRows.size} ids`)
else bad('G1d. hostRows empty', 'base + web-app both empty — snapshot corrupt?')

// ── G2: parse the four generated carriers (the runtime-read form) ───────────
const CARRIERS = ['cordis.patch.yml', 'presets/matt-ptc.patch.yml', 'presets/matt-minimal.patch.yml', 'presets/matt-cordis.patch.yml']
const ROW_ID = /^(\s*)- id: (\S+)\s*$/
const NAME = /^\s*name: (.+?)\s*$/
/** 一份载体的全部 row：{ id, name, disabled, line }。块内首个 name / disabled 归该 row。 */
function readRows(file) {
  const lines = readFileSync(join(repo, file), 'utf8').replace(/\r\n/g, '\n').split('\n')
  const rows = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const m = ROW_ID.exec(lines[i])
    if (m) { cur = { id: m[2], name: null, disabled: null, line: i + 1 }; rows.push(cur); continue }
    if (!cur) continue
    if (cur.name === null) { const nm = NAME.exec(lines[i]); if (nm) cur.name = nm[1].replace(/^'(.*)'$/, '$1') }
    if (cur.disabled === null) { const dis = /^\s*disabled: (.+?)\s*$/.exec(lines[i]); if (dis) cur.disabled = dis[1] }
  }
  return rows
}
const carriers = new Map()
for (const f of CARRIERS) {
  let rows
  try { rows = readRows(f) } catch (error) { bad('G2. carrier reads', `${f}: ${String(error?.message ?? error)}`); continue }
  carriers.set(f, rows)
  const declared = rows.some(r => r.id.startsWith('preset-dsh-matt-preset'))
  if (rows.length >= 30 && declared) ok('G2. carrier parsed', `${f}: ${rows.length} rows`)
  else bad('G2. carrier shape', `${f}: ${rows.length} rows, declared=${declared}`)
}

// ── R1: every roster row must classify (core-row / in-repo / group / registry) ──
const registry = deps.tierRegistry ?? {}
const IN_REPO = /^dsh-matt-preset\//
const violations = []
for (const [file, rows] of carriers) {
  for (const row of rows) {
    if (row.id.startsWith('preset-')) continue                       // 载体声明行，非 roster row
    if (row.name === 'cordis:group') continue                        // 组合语法行
    if (row.name && IN_REPO.test(row.name)) continue                 // in-repo（随 preset 分发）
    if (officialRows.has(row.id)) continue                           // core-row：官方 preset 同 id
    if (hostRows.has(row.id)) continue                               // core-row：出货宿主组合同 id
    if (registry[row.id]) continue                                   // 登记面（tier 断言在 R2/R3）
    violations.push(`${file}:${row.line} ${row.id} (${row.name ?? 'name?'})`)
  }
}
// 防腐（SG10 同族）：登记表里的行不能从 roster 消失——移出即登记过时，逼人更新。
const registryEntries = Object.entries(registry).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
const carrierIds = new Set()
for (const rows of carriers.values()) for (const r of rows) carrierIds.add(r.id)
for (const [id] of registryEntries)
  if (!carrierIds.has(id)) violations.push(`tierRegistry: ${id} 不在任何载体（登记过时——行已移出 roster？）`)

if (violations.length === 0)
  ok('R1. every roster row classifies (official preset ∪ host composition ∪ in-repo ∪ registry)', `${carrierIds.size} distinct ids`)
else bad('R1. unclassifiable roster rows', violations.join(' | '))

// ── R2: tier 断言（双向：non-in-box 必须 disabled；mounted 不得被翻 disabled——复审 F3 对称半边） ──
// mounted:true 是 Z6 有据差异面（tool-ralph / str-replace-editor 常驻）的前提，
// 被静默翻 disabled 时文档与 README 的前提即腐烂——须与 mustBeDisabled 同强度断言。
const disabledBad = []
const mountBad = []
for (const [file, rows] of carriers) {
  for (const [id, entry] of registryEntries) {
    const row = rows.find(r => r.id === id)
    if (!row) continue
    if (entry.mustBeDisabled && row.disabled !== 'true')
      disabledBad.push(`${file}:${row.line} ${id} disabled=${row.disabled ?? '（无）'}`)
    if (entry.mounted && row.disabled === 'true')
      mountBad.push(`${file}:${row.line} ${id} 被翻成 disabled: true——常驻前提翻转（Z6 有据差异面），先更新登记与 docs 前提再动 roster`)
  }
}
if (disabledBad.length === 0 && mountBad.length === 0)
  ok('R2. tier states hold both ways (non-in-box disabled; mounted not flipped)',
    `mustBeDisabled: ${registryEntries.filter(([, e]) => e.mustBeDisabled).map(([id]) => id).join(', ')} / mounted: ${registryEntries.filter(([, e]) => e.mounted).map(([id]) => id).join(', ')}`)
else bad('R2. tier state flipped', [...disabledBad, ...mountBad].join(' | '))

// ── R3: mounted 的登记行必须有文档明示（Z5：依赖/启用方式/缺席表现） ──────────
const docBad = []
const docSeen = new Map()
for (const [id, entry] of registryEntries) {
  if (!entry.mounted || !entry.docPath) continue
  const path = join(repo, entry.docPath)
  let text = null
  try { text = readFileSync(path, 'utf8') } catch { /* existsSync 之外的读错也算缺席 */ }
  if (text === null) { docBad.push(`${id}: ${entry.docPath} 不存在或不可读`); continue }
  docSeen.set(entry.docPath, (docSeen.get(entry.docPath) ?? 0) + 1)
  const missing = (entry.docMustMention ?? []).filter(k => !text.includes(k))
  if (missing.length > 0) docBad.push(`${id}: ${entry.docPath} 缺字样 ${missing.join('/')}`)
  if (!text.includes(id)) docBad.push(`${id}: ${entry.docPath} 未提及该 row id`)
}
if (docBad.length === 0)
  ok('R3. mounted registry rows have their dependency documented', [...docSeen.keys()].join(', '))
else bad('R3. documentation gap for mounted registry rows', docBad.join(' | '))

// ── R4: 依赖链读数自洽（上游漂移钉——in-box opt-in 的判据根据） ───────────────
const pub = new Set(deps.publishedDependencies ?? [])
const dev = new Set(deps.publishedDevDependencies ?? [])
const ralph = deps.bundleDeps?.['@deepseek-ai/dsh-experimental-ralph-bundle'] ?? []
const RALPH_BUNDLE = '@deepseek-ai/dsh-experimental-ralph-bundle'
const RALPH_TOOL = '@deepseek-ai/dsh-tool-ralph'
const chainBad = []
if (pub.has(RALPH_TOOL)) chainBad.push(`${RALPH_TOOL} 进了发布面 dependencies——「默认未启用」前提变了，重取读数并复核 docs/preset-runtime-deps.md`)
if (!dev.has(RALPH_TOOL)) chainBad.push(`${RALPH_TOOL} 不在 devDependencies——依赖链形态变了，重取`)
if (!pub.has(RALPH_BUNDLE)) chainBad.push(`${RALPH_BUNDLE} 不在发布面 dependencies——「默认安装提供」前提变了，重取`)
if (!ralph.includes(RALPH_TOOL)) chainBad.push('ralph-bundle 的依赖闭包不含 tool-ralph——bundle 链变了，重取')
if (officialRows.has('tool-ralph')) chainBad.push('官方 preset 出现 tool-ralph row——tier 前提变了（in-box opt-in → core-row），复核登记与文档')
if (officialRows.has('str-replace-editor')) chainBad.push('官方 preset 出现 str-replace-editor row——tier 前提变了，复核登记与文档')
// 复审 F5：evidence 的「两个宿主组合均无此 row」半边同强度钉住（对称性缺口）。
for (const rid of ['tool-ralph', 'str-replace-editor'])
  if (hostRows.has(rid)) chainBad.push(`出货宿主组合出现 ${rid} row——tier 前提变了（fixture evidence 漂移），复核登记与文档`)
if (chainBad.length === 0)
  ok('R4. in-box opt-in dependency chain reads hold (frozen 0.2.1-rc.2)', `${pub.size} deps / ${dev.size} devDeps`)
else bad('R4. dependency-chain premise drifted', chainBad.join(' | '))

// ── R5: tool-ralph 缺席表现的运行时探针——显式 loud skip（D47；复审 F4） ─────
// 「未启用 ralph-bundle ⇒ tool-ralph 工具缺席、其余不受影响」是**运行时挂载判定**：
// 真探需要装了 matt preset 的 dsh 实例（重，且涉及用户 home 面），本守卫不做、
// 也不冒认。无论本机有无运行时锚，这一步都**响亮声明未验证**——不是静默绿；
// 等价条件的事实源 = R4 的冻结依赖链读数（前提钉住 ≠ 行为复现，docs/preset-runtime-deps.md
// §tool-ralph 两半归属如实分开）。环境侧断言由有 dsh 实例的会话补（Z5 复核提醒的常驻答案）。
console.log('  SKIP (loud): R5 tool-ralph 缺席表现的运行时探针未跑（需要装了 matt preset 的 dsh 实例；依赖链前提已由 R4 钉住）——环境侧断言未验证')
ok('R5. absence probe declared not-run (loud, D47)', 'runtime-mount verdict belongs to harness / live runs')

console.log('  ℹ 判定层：静态声明面判定（冻结快照 + 载体行）——门绿 ≠ 用户环境一定可用（#105 AC 边界）')
report('ROW DEPS VERIFY (#105)')
