/**
 * verify-wrapup-card.mjs — 批末收口卡判据面守卫（#182 / ADR-0017 §4 轴 B）。
 *
 * 为什么存在：收口卡是「卡 + 正文双形态降级」——卡形态由本仓 kind 插件注册
 * （workflow-wrapup-card.mjs），正文形态由 batch 组件的 batch-wrap-up 节承载，
 * minimal 档再覆盖压缩版。三个载体（组件节 / 收口 skill / minimal 覆盖节）各自
 * 手写五段结构，**同构**（换载体不换内容）是这个票的 AC3——三份文本若无守卫，
 * 漂移是静默的：某天组件加了第六段，skill 与 minimal 不知道。本守卫把同构、
 * 降级显式（S3）、kind 契约、roster/exports 登记面全部钉成机械断言。
 *
 * 断言（W = Wrap-up）：
 *   W1  kind 注册契约：mock ctx 捕获 register() 的 kind —— action 名、skill 名
 *       （必须等于收口 skill 的 frontmatter name）、verbs 空（不新建确认点）、
 *       invitation/statusGuidance/act 在场。
 *   W2  details validator 协议：合法五段数组通过；未知键 / 非字符串数组 / 非对象
 *       拒绝，issues path 形态 ['details', <key>]（上游消费面只读 safeParse）。
 *   W3  双形态同构：组件 batch-wrap-up 节与 skills/batch-wrap-up/SKILL.md 的五段
 *       段名**同序**出现（DELIVERED → L0 LEDGER → OPEN → D21 PENDING →
 *       SESSION↔PR BINDINGS）——顺序漂移也是漂移。
 *   W4  降级显式（S3）：组件节与 skill 文本都带显式降级句形态
 *       「收口卡缺席（…）——降级为正文收口段」；skill 带 ptc 恒正文形态事实。
 *   W5  minimal 压缩覆盖节在场且含五段锚（覆盖 wins 机制由 profiles 守卫钉，
 *       这里钉内容面）。
 *   W6  roster 面：四份生成载体各有 workflow-wrapup-card 行，name =
 *       dsh-matt-preset/workflow-wrapup-card.mjs（in-repo 判据的前半由
 *       verify-row-deps 断，这里断行本身在）。
 *   W7  exports 面：package.json 有 workflow-wrapup-card 的 locale/icon 子路径导出
 *       （plugin-meta 挂载面，#54 先例）。
 *   W8  注入面集成：profileBody('standard') 含五段锚（组件节注入）；
 *       profileBody('standard', []) 不含（components:[] 连带裁掉）；
 *       profileBody('minimal') 含压缩版锚。
 *
 * 判定层：静态声明面 + 模块级动态验证（插件文件零依赖，mock ctx 直接调
 * apply——不装 action-cards 服务也能验 kind 全契约）。运行时激活
 * (propose_action 注册可见与否) 属环境侧事实，本守卫不做也不冒认
 * （组件/ skill 的 FORM SELECTION 显式覆盖缺席路径）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

const lf = (text) => String(text).replace(/\r\n/g, '\n')

// ── W1/W2: the kind plugin under a mock context ──────────────────────────────
let kind = null
let registerCalls = 0
try {
  const wrapup = await import(pathToFileURL(join(repo, 'workflow-wrapup-card.mjs')).href)
  const fakeCtx = { actionCards: { register(input) { registerCalls += 1; kind = input } } }
  wrapup.apply(fakeCtx)
  if (kind === null) bad('W1. kind registration', 'apply() did not call ctx.actionCards.register')
  else if (registerCalls !== 1) bad('W1. kind registration', `register called ${registerCalls} times, expected 1`)
} catch (error) {
  bad('W1. kind plugin imports and applies', String(error?.stack ?? error))
  report('WRAP-UP CARD VERIFY (#182)')
}

const SECTION_ANCHORS = ['DELIVERED', 'L0 LEDGER', 'OPEN', 'D21 PENDING', 'SESSION↔PR BINDINGS']

// skill 文本在 W1（frontmatter 断言）与 W3（同构）都要用——提前到两段之前。
const skillRaw = lf(readFileSync(join(repo, 'skills/batch-wrap-up/SKILL.md'), 'utf8'))

if (kind !== null) {
  const problems = []
  if (kind.action !== 'batch_wrap_up') problems.push(`action=${JSON.stringify(kind.action)}`)
  if (kind.skill !== 'batch-wrap-up') problems.push(`skill=${JSON.stringify(kind.skill)}`)
  if (kind.verbs === undefined || Object.keys(kind.verbs).length !== 0) {
    problems.push(`verbs=${JSON.stringify(kind.verbs)} — 必须为空：卡只呈现不承载确认（不新建确认点）`)
  }
  // 显式类型白名单（复审 F4b）：非空 string / function / 带 safeParse 的对象——
  // 畸形值（数字、数组、空串）逐一红，不靠「非 undefined」的宽松兜底。
  if (typeof kind.invitation !== 'string' || kind.invitation.trim() === '') {
    problems.push(`invitation=${JSON.stringify(kind.invitation)} — 须为非空 string`)
  }
  if (typeof kind.statusGuidance !== 'string' || kind.statusGuidance.trim() === '') {
    problems.push(`statusGuidance=${JSON.stringify(kind.statusGuidance)} — 须为非空 string`)
  }
  if (typeof kind.act !== 'function') problems.push(`act=${typeof kind.act} — 须为 function（服务契约对每个非 dismiss 动词要求 handler）`)
  if (kind.details === null || typeof kind.details !== 'object' || typeof kind.details.safeParse !== 'function') {
    problems.push('details 须为带 safeParse 函数的对象（上游唯一消费面）')
  }
  // F4a：kind.skill 必须等于收口 skill 的 frontmatter name——上游 propose 在
  // index.ts:433-434 校验 loads.skills.has(kind.skill)，frontmatter 改名即
  // eligibility 断裂（propose 被拒 ACTION_CARD_SKILL），只靠降级兜底、守卫不响。
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillRaw)
  if (front === null) problems.push('skills/batch-wrap-up/SKILL.md 无 YAML frontmatter')
  else {
    let fm
    try { fm = parseYaml(front[1]) } catch (error) { fm = { __parseError: String(error) } }
    if (fm?.__parseError !== undefined) problems.push(`SKILL.md frontmatter 解析失败: ${fm.__parseError}`)
    else if (fm?.name !== kind.skill) problems.push(`SKILL.md frontmatter name=${JSON.stringify(fm?.name)} ≠ kind.skill=${JSON.stringify(kind.skill)}（装载名断裂，propose 将被拒 ACTION_CARD_SKILL）`)
  }
  if (problems.length === 0) ok('W1. kind contract (action/skill==frontmatter/empty verbs/typed invitation/statusGuidance/act/details)', `action=${kind.action} skill=${kind.skill}`)
  else bad('W1. kind contract', problems.join(' | '))

  // W2: details validator protocol (the only surface the service consumes).
  // details 畸形时 W1 已红；此处不重复崩栈——防护跳过（响亮在 W1，不在崩溃里）。
  const schema = kind.details !== null && typeof kind.details === 'object' && typeof kind.details.safeParse === 'function' ? kind.details : null
  if (schema === null) {
    // W1 已点名 details 畸形；W2 无从断言——响亮记录后跳过，不靠崩溃表达失败。
    bad('W2. details validator protocol', 'details 缺 safeParse（见 W1）——无法断言协议')
  } else {
  const pass = schema.safeParse({ delivered: ['a'], l0Ledger: [], forgeBindings: ['x → y'] })
  const unknownKey = schema.safeParse({ delivered: ['a'], extraSection: ['b'] })
  const badValue = schema.safeParse({ delivered: 'one string' })
  const badElement = schema.safeParse({ delivered: ['ok', 42] })
  const notObject = schema.safeParse('nope')
  const w2 = []
  if (pass.success !== true || pass.data.delivered[0] !== 'a') w2.push('valid input rejected: ' + JSON.stringify(pass))
  if (unknownKey.success !== false || !unknownKey.error.issues[0].path.includes('extraSection')) {
    w2.push('unknown key accepted: ' + JSON.stringify(unknownKey))
  }
  if (badValue.success !== false || !badValue.error.issues[0].path.includes('delivered')) {
    w2.push('non-array value accepted: ' + JSON.stringify(badValue))
  }
  if (badElement.success !== false) w2.push('non-string element accepted')
  if (notObject.success !== false) w2.push('non-object accepted')
  if (w2.length === 0) ok('W2. details validator protocol (optional string[] sections; unknown keys and bad values rejected)', `${WRAP_SECTION_COUNT(schema)} sections accepted`)
  else bad('W2. details validator protocol', w2.join(' | '))
  }
}

function WRAP_SECTION_COUNT(schema) {
  let count = 0
  for (const key of ['delivered', 'l0Ledger', 'openQuestions', 'd21Pending', 'forgeBindings']) {
    if (schema.safeParse({ [key]: [] }).success) count += 1
  }
  return count
}

// ── W3/W4: the two forms stay isomorphic (component section vs skill text) ──
const componentRaw = lf(readFileSync(join(repo, 'workflow-component-batch.txt'), 'utf8'))
const componentDelta = componentRaw.split(/^@@ /m).find((block) => block.startsWith('batch-wrap-up'))
if (componentDelta === undefined) {
  bad('W3. component delta', 'workflow-component-batch.txt has no batch-wrap-up section')
  report('WRAP-UP CARD VERIFY (#182)')
}
const componentText = componentDelta.split('\n').slice(1).join('\n')

function anchorOrder(text, anchors) {
  let at = -1
  for (const anchor of anchors) {
    const found = text.indexOf(anchor, at + 1)
    if (found < 0) return { missing: anchor, order: null }
    at = found
  }
  return { missing: null, order: anchors.join(' → ') }
}

for (const [name, text] of [['component section', componentText], ['skill', skillRaw]]) {
  const { missing, order } = anchorOrder(text, SECTION_ANCHORS)
  if (missing === null) ok(`W3. ${name}: five wrap sections present in canonical order`, order)
  else bad(`W3. ${name} isomorphism`, `missing or out-of-order anchor: ${missing}`)
}

const DEGRADE = '收口卡缺席'
for (const [name, text] of [['component section', componentText], ['skill', skillRaw]]) {
  const hasLine = text.includes(DEGRADE) && text.includes('降级为正文收口段')
  if (hasLine) ok(`W4. ${name}: explicit degradation line present (S3)`, DEGRADE)
  else bad(`W4. ${name} degradation is silent`, `missing「${DEGRADE}…降级为正文收口段」`)
}
if (skillRaw.includes('ptc')) ok('W4b. skill: ptc prose-only fact carried', 'cards impossible under ptc')
else bad('W4b. skill missing the ptc fact', 'cards are impossible under ptc (upstream invariant) — the skill must say so')

// ── W5: minimal's compressed override section ────────────────────────────────
const minimalRaw = lf(readFileSync(join(repo, 'workflow-profile-minimal.txt'), 'utf8'))
const minimalDelta = minimalRaw.split(/^@@ /m).find((block) => block.startsWith('batch-wrap-up'))
if (minimalDelta === undefined) {
  bad('W5. minimal override section', 'workflow-profile-minimal.txt has no batch-wrap-up section')
} else {
  const minimalText = minimalDelta.split('\n').slice(1).join('\n')
  const { missing } = anchorOrder(minimalText, SECTION_ANCHORS)
  if (missing === null) ok('W5. minimal compressed override carries all five anchors', `${minimalText.length} chars`)
  else bad('W5. minimal override isomorphism', `missing anchor: ${missing}`)
}

// ── W6: the roster row in all four generated carriers ────────────────────────
const CARRIERS = ['cordis.patch.yml', 'presets/matt-ptc.patch.yml', 'presets/matt-minimal.patch.yml', 'presets/matt-cordis.patch.yml']
const w6 = []
for (const carrier of CARRIERS) {
  const text = readFileSync(join(repo, carrier), 'utf8')
  const rowOk = /- id: workflow-wrapup-card\s*\n\s*name: dsh-matt-preset\/workflow-wrapup-card\.mjs\s*$/m.test(lf(text))
  if (rowOk) continue
  w6.push(carrier)
}
if (w6.length === 0) ok('W6. roster row present in all four carriers with the in-repo name', CARRIERS.join(', '))
else bad('W6. roster row missing', w6.join(', '))

// ── W7: package.json exports face ─────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const exportsMissing = [
  ['./workflow-wrapup-card.mjs/locale/*.json', './plugin-meta/workflow-wrapup-card/locale/*.json'],
  ['./workflow-wrapup-card.mjs/icon', './plugin-meta/workflow-wrapup-card/icon.svg'],
].filter(([key, want]) => pkg.exports?.[key] !== want)
if (exportsMissing.length === 0) ok('W7. package.json exports carry the plugin-meta subpaths', 'locale + icon')
else bad('W7. exports face incomplete', exportsMissing.map(([key]) => key).join(', '))

// ── W8: injection-face integration (profileBody) ──────────────────────────────
try {
  const core = await import(pathToFileURL(join(repo, 'workflow-core.mjs')).href)
  const standard = lf(await core.profileBody('standard'))
  const off = lf(await core.profileBody('standard', []))
  const minimal = lf(await core.profileBody('minimal'))
  const w8 = []
  if (anchorOrder(standard, SECTION_ANCHORS).missing !== null) w8.push('standard injection lacks the five anchors')
  if (!standard.includes('BATCH WRAP-UP CARD')) w8.push('standard injection lacks the BATCH WRAP-UP CARD header')
  if (SECTION_ANCHORS.some((a) => off.includes(a))) w8.push('components:[] still carries wrap-up anchors (sectionIds filter not applied)')
  if (anchorOrder(minimal, SECTION_ANCHORS).missing !== null) w8.push('minimal injection lacks the five anchors')
  if (w8.length === 0) ok('W8. profileBody integration (standard carries the section; components:[] strips it; minimal carries the override)', `${standard.length} / ${off.length} / ${minimal.length} chars`)
  else bad('W8. injection-face integration', w8.join(' | '))
} catch (error) {
  bad('W8. profileBody integration', String(error?.stack ?? error))
}

report('WRAP-UP CARD VERIFY (#182)')
