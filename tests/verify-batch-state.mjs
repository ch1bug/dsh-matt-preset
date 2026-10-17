/**
 * verify-batch-state.mjs —— #71 的**仓内载体面**守卫（C1–C6）。
 *
 * 为什么存在：#71 把「批末 retro」从一个靠人记性的动作变成**机制**，而机制散在三个
 * 仓内载体上——`.scratch/batch-state.md` 的**形状**（`docs/batch-state.md` 是单一事实源）、
 * 正文规则（`workflow-body.txt` 的 `@@ batch-mode` 节）、以及 enforcer 的**提醒文案**。
 * 三者是同一份契约的三张脸：任何一张被悄悄改掉（字段改名、路径改字、规则删句），
 * 另外两张就成了**指向空气的指针**——本用例把这种漂移变成红。这是 #85「AC1 基线重取」
 * 同族的纪律：有意变更必须**同时**改所有载体并可复核，不是让某一张脸自己漂走。
 *
 * 断言：
 *   C1 模板完整性：`docs/batch-state.md` 逐字段含每个必需字段（成员 / 结束点 /
 *      Progress 行三要素 / lane / 后继票 / `retro:` 标记）
 *   C2 enforcer↔docs 漂移守卫（**非空洞**，双向）：enforcer 的 `BATCH_STATE_TEMPLATE`
 *      与注入文案仍指向 `docs/batch-state.md` 与 `.scratch/retro/` 契约，**且**该文档
 *      仍含 BATCH_STATE_TEMPLATE 声明的每个字段名——任一边被删/改名都变红
 *   C3 正文规则关键词：`@@ batch-mode` 节含落盘路径、`retro:` 标记、去重合并、一次呈现、
 *      事实探测（`git log origin`）、批宣告初始化
 *   C4 负例守卫：正文**明确**写着「字词不触发」（防后人把触发面改回关键词匹配/文本面）
 *   C5 漂移守卫：`docs/batch-state.md` 的字段表与 `@@ batch-mode` 节**同名同义**
 *      （同一字段两边不同名 → 红）
 *   C6 节结构守卫：`@@ batch-mode` 节仍在骨架里、节 id 唯一（改动不得吃掉这一节）
 *
 * 零运行时依赖（可独立 `node tests/verify-batch-state.mjs`）：`workflow-enforcer.mjs` 本身只
 * 依赖 `node:*` / `yaml`（**不**依赖 `@deepseek-ai/*`），所以本用例直接 import 它的**稳定导出**
 * 做声明式断言（`RETRO_TRIGGER` / `BATCH_STATE_TEMPLATE` / `INJECTIONS`），照 V23c 的形状——
 * 正则扫源文本会被注释改写假红、也会在重构时假绿。不 boot harness。
 *
 * 非空洞自查（perturbation，同 V18/V21 的纪律）：任选一边做最小扰动后必须变红——
 *   ① `docs/batch-state.md` 删掉「后继票」一行 → C1/C2/C5 红；
 *   ② enforcer 文案里的 `docs/batch-state.md` 改成 `docs/state.md` → C2 红；
 *   ③ 正文删掉「字词不触发」口径句 → C4 红；
 *   ④ `RETRO_TRIGGER.retroMarker` 改名 → C2c 红；
 *   ⑤ persona-carried 基线换回旧 body → C8（及 L1/R4）红。
 * 五条均已实测（见回报）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

/** LF 归一，避免 CRLF 检出与 LF 检出的假红。 */
const lf = (s) => String(s).replace(/\r\n/g, '\n')

const read = (rel) => {
  try { return lf(readFileSync(resolve(REPO, rel), 'utf8')) } catch { return null }
}

// ── 输入面：三张脸一起读；任一张缺失都是**响亮**的红，不是静默跳过 ──────────────
const DOC = read('docs/batch-state.md')
const BODY = read('workflow-body.txt')
const ENFORCER = read('workflow-enforcer.mjs')

for (const [rel, text] of [['docs/batch-state.md', DOC], ['workflow-body.txt', BODY], ['workflow-enforcer.mjs', ENFORCER]]) {
  if (text === null) bad(`C0. ${rel} 可读`, '文件缺失或不可读 —— 载体面缺一张脸')
}
if (DOC === null || BODY === null || ENFORCER === null) report('BATCH-STATE VERIFY (C1–C6)')

// ── C1: 模板完整性 —— 逐字段断言 docs/batch-state.md ────────────────────────
// 字段名与 enforcer 的 BATCH_STATE_TEMPLATE 同名（C2 会双向钉住）。
const REQUIRED_FIELDS = [
  ['成员', /成员/],
  ['结束点', /结束点/],
  ['Progress 三要素：证明命令', /证明命令/],
  ['Progress 三要素：exit code', /exit code/],
  ['Progress 三要素：证据路径', /证据路径/],
  ['lane 标注', /lane/],
  ['后继票', /后继票/],
  ['retro: done 标记', /retro:\s*done\s*@\s*<commit>/],
]
const missingFields = REQUIRED_FIELDS.filter(([, re]) => !re.test(DOC)).map(([name]) => name)
if (missingFields.length === 0)
  ok('C1. docs/batch-state.md 是形状单一事实源（每个必需字段都在）', REQUIRED_FIELDS.map(([n]) => n).join(' / '))
else bad('C1. 必需字段缺失', `docs/batch-state.md 缺: ${missingFields.join(', ')}`)

// 模板骨架必须真的可复制：带 ``` 代码块，且块内含表头与 Progress 三要素行。
const fenced = DOC.match(/```markdown\n([\s\S]*?)```/)
if (fenced !== null) {
  const tmpl = fenced[1]
  const wantInTemplate = [
    ['成员与顺序表头', /\|\s*#\s*\|\s*票\s*\|\s*状态\s*\|/],
    ['Progress 三要素行', /证明命令[\s\S]*exit[\s\S]*证据路径/],
    ['lane 标注', /lane=/],
    ['后继票', /后继票=/],
    ['retro: done 标记', /retro:\s*done\s*@\s*<commit>/],
  ]
  const tmplMissing = wantInTemplate.filter(([, re]) => !re.test(tmpl)).map(([n]) => n)
  if (tmplMissing.length === 0)
    ok('C1b. 模板骨架本身可直接复制（表头 + 三要素 + lane + 后继票 + retro 标记）', `${tmpl.split('\n').length} 行`)
  else bad('C1b. 模板骨架缺元素', tmplMissing.join(', '))
} else {
  bad('C1b. 模板骨架', 'docs/batch-state.md 里找不到 ```markdown 模板块')
}

// ── C2: enforcer↔docs 漂移守卫（非空洞，双向）────────────────────────────────
// 声明式面：直接 import enforcer 的稳定导出（V23c 同形）。import 失败 = 契约面塌了 → 响亮红。
let ENFORCER_MOD = null
try {
  ENFORCER_MOD = await import(pathToFileURL(resolve(REPO, 'workflow-enforcer.mjs')).href)
} catch (error) {
  bad('C2. workflow-enforcer.mjs 可 import（稳定导出面）', String(error?.message ?? error))
}

// 半边一：注入文案仍指向文档与落盘契约（逐字，源文本级——文案字符串不在导出里）。
const ENFORCER_POINTERS = [
  ['注入文案指向 docs/batch-state.md', /docs\/batch-state\.md/],
  ['落盘契约路径 .scratch/retro/', /\.scratch\/retro\//],
  ['retro 完成标记 retro:', /retro:/],
  ['批宣告文本面（关键词组）', /batchDeclare/],
  ['push 触发面（结构化核）', /RETRO_TRIGGER/],
]
const missingPointers = ENFORCER_POINTERS.filter(([, re]) => !re.test(ENFORCER)).map(([n]) => n)
if (missingPointers.length === 0)
  ok('C2a. enforcer 仍指向 docs/batch-state.md + 落盘契约 + retro 标记', ENFORCER_POINTERS.length + ' 个指针')
else bad('C2a. enforcer 指针漂移', `workflow-enforcer.mjs 缺: ${missingPointers.join(', ')}`)

// 半边二：声明式断言 —— BATCH_STATE_TEMPLATE 声明的每个字段名，文档都还在。
// （enforcer 改了字段名而文档没跟 → 必然变红；反向由 C1 的逐字段断言守住。）
// 导出形状：A 线 task-5 把它从「模板字符串」收敛为**字段名数组**（Standards 轴实测：
// 字符串形态是 docs 模板的第二份手抄且**已实际漂移**，头注却自称 "cannot drift apart"；
// 收敛成字段名清单后结构漂移无处可生）。两种形状都接受——本断言的**判据**本就是
// 「字段名双向钉住」，数组更贴合其本意；覆盖面（TMPL_FIELD_WORDS 逐字全中）不放宽。
const TMPL_FIELD_WORDS = ['成员', '结束点', '证明命令', 'exit code', '证据路径', 'lane', '后继票', 'retro:']
const TMPL = ENFORCER_MOD?.BATCH_STATE_TEMPLATE
/** `string` 或 `string[]` → 一段可 `includes` 的声明文本（数组逐项拼回）。 */
const tmplText = typeof TMPL === 'string' ? TMPL
  : Array.isArray(TMPL) && TMPL.every(x => typeof x === 'string') ? TMPL.join('\n')
  : null
if (tmplText !== null) {
  const declared = TMPL_FIELD_WORDS.filter(w => tmplText.includes(w))
  const docMissing = declared.filter(w => !DOC.includes(w))
  if (declared.length === TMPL_FIELD_WORDS.length && docMissing.length === 0)
    ok('C2b. 文档仍含 BATCH_STATE_TEMPLATE 声明的每个字段名（双向钉住）',
      `${Array.isArray(TMPL) ? `${TMPL.length} 个字段名（数组形态）` : '字符串形态'}：${declared.join(' / ')}`)
  else
    bad('C2b. 字段名漂移（enforcer 声明 vs docs）',
      `模板声明 ${declared.length}/${TMPL_FIELD_WORDS.length} 个；docs 缺: ${docMissing.join(', ') || '(无)'}；模板未含: ${TMPL_FIELD_WORDS.filter(w => !tmplText.includes(w)).join(', ') || '(无)'}`)
} else if (ENFORCER_MOD !== null) {
  bad('C2b. BATCH_STATE_TEMPLATE 导出形状', `期望 string 或 string[]，实得 ${JSON.stringify(TMPL)} —— 漂移守卫失去半边`)
}

// 半边三：新注入节必须仍登记在 INJECTIONS（D 线的文档漂移守卫也依赖它；漏登记 = 文案发出但无人守）。
const NEW_INJECTION_IDS = ['retro-push', 'retro-batch-end', 'batch-declared']
if (ENFORCER_MOD !== null && Array.isArray(ENFORCER_MOD.INJECTIONS)) {
  const byId = new Map(ENFORCER_MOD.INJECTIONS.map(i => [i?.id, i]))
  const missing = NEW_INJECTION_IDS.filter(id => !byId.has(id))
  const noMarker = NEW_INJECTION_IDS.filter(id => byId.has(id) && typeof byId.get(id).marker !== 'string')
  if (missing.length === 0 && noMarker.length === 0)
    ok('C2c. #71 的三个注入节仍登记在 INJECTIONS（含稳定 marker）', `${ENFORCER_MOD.INJECTIONS.length} 节 / ${NEW_INJECTION_IDS.join(', ')}`)
  else bad('C2c. INJECTIONS 登记缺失', `缺 id: ${missing.join(', ') || '(无)'}；缺 marker: ${noMarker.join(', ') || '(无)'}`)
} else if (ENFORCER_MOD !== null) {
  bad('C2c. INJECTIONS 导出', 'INJECTIONS 不是数组')
}

// 半边四：retro 标记判据与文档口径逐字一致（存在性判据，文档必须写同一个字面量）。
if (ENFORCER_MOD !== null && ENFORCER_MOD.RETRO_TRIGGER?.retroMarker === 'retro:' && DOC.includes('retro:'))
  ok('C2d. RETRO_TRIGGER.retroMarker 与文档同字面量', `retroMarker=${JSON.stringify(ENFORCER_MOD.RETRO_TRIGGER.retroMarker)}`)
else bad('C2d. retroMarker 漂移', `enforcer=${JSON.stringify(ENFORCER_MOD?.RETRO_TRIGGER?.retroMarker)}、docs 含 retro: = ${DOC.includes('retro:')}`)

// 半边四之二：**两个标记、两件事**（#71 的 spec 回归锁；body 面在 `batchSection` 定义后于 C2f 断言）。
// 实测过的违规：`retro:` 单独当抑制依据时，3 个会话 → 3 次聚合呈现。所以存在性标记必须有两个、
// 且语义分开，三张脸（enforcer / body / docs）都要写明——任一张脸被改回「`retro:` 即抑制」→ 变红。
const AGG_MARKER = ENFORCER_MOD?.RETRO_TRIGGER?.aggregatedMarker
if (typeof AGG_MARKER === 'string' && AGG_MARKER.startsWith('.scratch/retro/'))
  ok('C2f-1. enforcer 声明第二个存在性标记（聚合已完成）', `aggregatedMarker=${JSON.stringify(AGG_MARKER)}`)
else bad('C2f-1. aggregatedMarker 缺失/漂移', JSON.stringify(AGG_MARKER))

// 半边五：push 触发面必须是**结构化命令位置词串**（不是文本面/整串子串）；批宣告才是文本面。
if (ENFORCER_MOD !== null && ENFORCER_MOD.RETRO_TRIGGER?.push?.words?.includes('git push') && Array.isArray(ENFORCER_MOD.RETRO_TRIGGER?.batchDeclare?.words) && ENFORCER_MOD.RETRO_TRIGGER.batchDeclare.words.length > 0)
  ok('C2e. push 面 = 命令位置词串 `git push`；批宣告面另行声明（两面不混）',
    `push=${JSON.stringify(ENFORCER_MOD.RETRO_TRIGGER.push.words)} batchDeclare=${ENFORCER_MOD.RETRO_TRIGGER.batchDeclare.words.length} 词`)
else bad('C2e. 触发面形状漂移', JSON.stringify(ENFORCER_MOD?.RETRO_TRIGGER ?? null))

// ── C3: `@@ batch-mode` 节含规则关键词 ──────────────────────────────────────
/** 取 `@@ batch-mode` 到下一个 `@@ ` 标记之间的正文（下一个标记前不留空行）。 */
function sectionText(text, id) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l === `@@ ${id}`)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('@@')) { end = i; break }
  }
  return lines.slice(start + 1, end).join('\n')
}

const batchSection = sectionText(BODY, 'batch-mode')
if (batchSection === null) {
  bad('C3. @@ batch-mode 节', '骨架里找不到该节')
  report('BATCH-STATE VERIFY (C1–C6)')
}

// C2f-2: 「两个标记、两件事」在 body 与 docs 两张脸上的口径（enforcer 半边见 C2f-1）。
// 反例守卫：正文/doc 若退回「`retro:` 即抑制」，这里必红。
const C2F2 = [
  ['body 写明 `.aggregated` 是跨会话抑制者', /\.scratch\/retro\/\.aggregated/.test(batchSection) && /CROSS-SESSION suppressor/i.test(batchSection)],
  ['body 写明已聚合批次仍落盘（约束呈现，不约束素材）', /runs its own retro and LANDS|LANDS its candidates/i.test(batchSection)],
  ['docs 写明 `.aggregated` 与「呈现」抑制的关系', /\.scratch\/retro\/\.aggregated/.test(DOC) && /呈现/.test(DOC)],
  ['docs 已修正「`retro:` 即抑制」的旧口径（非空洞负例）', !/呈现由 `retro:` 标记抑制/.test(DOC) && !/that marker\s+is what suppresses a second aggregate/i.test(batchSection)],
]
const c2f2Missing = C2F2.filter(([, pass]) => !pass).map(([n]) => n)
if (c2f2Missing.length === 0)
  ok('C2f-2. body + docs 同写「两标记两件事」（`retro:` = 已跑；`.aggregated` = 已呈现）', C2F2.length + ' 条口径')
else bad('C2f-2. 抑制语义漂移（body/docs 面）', c2f2Missing.join(' | '))

const RULE_KEYWORDS = [
  ['落盘路径 .scratch/retro/', /\.scratch\/retro\//],
  ['retro: done 完成标记', /retro:\s*done\s*@\s*<commit>/],
  ['去重合并（记次数）', /DEDUPE AND MERGE[\s\S]*COUNT/i],
  ['一次呈现', /present ONCE/i],
  ['事实探测兜底 git log origin', /git log\s*\n?\s*origin|git log origin/],
  ['跑一次 retro 的义务措辞', /run this session's retro/i],
  ['批宣告初始化状态文件', /BATCH DECLARATION INITIALIZES THE STATE FILE/],
  ['免确认 / 不阻断', /CONFIRMATION-FREE and\s*\n?\s*NON-BLOCKING|CONFIRMATION-FREE/],
  ['宁严勿宽（误触发更贵）', /宁严勿宽/],
]
const missingRules = RULE_KEYWORDS.filter(([, re]) => !re.test(batchSection)).map(([n]) => n)
if (missingRules.length === 0)
  ok('C3. @@ batch-mode 节含全部 retro 规则关键词', `${RULE_KEYWORDS.length} 条 / ${batchSection.split('\n').length} 行`)
else bad('C3. 正文规则关键词缺失', missingRules.join(', '))

// ── C4: 负例守卫 —— 触发面口径（字词不触发）────────────────────────────────
// 若后人把规则改回关键词匹配（讨论里出现"推送"就跑 retro），这句口径会先消失。
const NEGATIVE_GUARDS = [
  ['字词不触发（会话/思考/文档）', /Words in a\s*\n?\s*session, in thinking, or in a document NEVER trigger/],
  ['handoff 正文是反例', /handoff\s*\n?\s*body/],
  ['间接/PTY push 声明不覆盖', /Indirect pushes[\s\S]*PTY fragment writes[\s\S]*NOT trigger|Indirect pushes[\s\S]*PTY/],
  ['判定面 = (toolName, argv) 二元组', /\(toolName, argv\)/],
  ['命令位置判定（不是子串）', /COMMAND POSITION/],
]
const missingGuards = NEGATIVE_GUARDS.filter(([, re]) => !re.test(batchSection)).map(([n]) => n)
if (missingGuards.length === 0)
  ok('C4. 正文写明触发面口径（字词/文本层永不触发 —— 防回退成关键词匹配）', NEGATIVE_GUARDS.length + ' 条')
else bad('C4. 触发面口径缺失（规则可能被改回关键词匹配）', missingGuards.join(', '))

// ── C5: docs 字段表 ↔ body 规则 同名同义 ────────────────────────────────────
// 同一字段两边不同名 = 读者按正文写出来的文件不满足 docs 的字段表。
const SHARED_VOCAB = [
  ['成员', /成员/],
  ['结束点', /结束点/],
  ['证明命令', /证明命令|proving command/i],
  ['exit code', /exit code/i],
  ['证据路径', /证据路径|evidence path/i],
  ['lane', /lane/i],
  ['后继票', /后继票|successor/i],
  ['retro:', /retro:/],
]
const drift = SHARED_VOCAB.filter(([, re]) => !re.test(DOC) || !re.test(batchSection)).map(([n]) => n)
if (drift.length === 0)
  ok('C5. docs 字段表与 @@ batch-mode 节同名同义（无单边漂移）', SHARED_VOCAB.map(([n]) => n).join(' / '))
else bad('C5. 字段表↔正文漂移', drift.join(', '))

// ── C6: 节结构守卫（改动不得吃掉 batch-mode 节）──────────────────────────────
const markerIds = BODY.split('\n').filter(l => l.startsWith('@@ ')).map(l => l.slice(3).trim().split(/\s+/)[0])
const dupes = markerIds.filter((id, i) => markerIds.indexOf(id) !== i)
if (!dupes.length && markerIds.includes('batch-mode'))
  ok('C6. 骨架节 id 唯一且含 batch-mode', `${markerIds.length} 节`)
else bad('C6. 节结构', dupes.length ? `重复 id: ${[...new Set(dupes)].join(', ')}` : '缺 batch-mode 节')

// ── C7: 文档自洽 —— retro 标记的写入者归属必须写明是 agent（enforcer 只读）────
if (/agent/.test(DOC) && /只读|READS it and writes no file|不写文件/.test(DOC))
  ok('C7. 文档写明「写 retro: 的是 agent，enforcer 只读不写」')
else bad('C7. 写入者归属', 'docs/batch-state.md 未写明 retro 标记由 agent 写、enforcer 只读')

// ── C8: 两份 body 耦合的冻结基线同步（Lead 批准的写权扩展）──────────────────
// `tests/fixtures/persona-prefix-v1.txt` 形如 `NEW_PREFIX + "\n\n" + body`：它不是
// 单纯的 persona intro，**整篇正文裹在里面**。#71 改了正文，所以这份基线也必须同步
// 重取——L1/R4（`verify-workflow-core.mjs` / `verify-workflow-core-render.mjs`）断言的
// 「persona-carried 渲染 == plugin 注入渲染」正是靠它成立。属 D48/#85 同族「有意变更不是漂移」。
// 本守卫钉住**结构关系**（追平两条基线 + 载体前缀），不重算 L1/R4 的渲染（那是它们的职责）。
const PERSONA_FIXTURE = read('tests/fixtures/persona-prefix-v1.txt')
const CARRIED_BASELINE = read('tests/fixtures/workflow-body-v1.txt')
const COMPOSITION = read('agent.cordis.yml')

/** 取 `prefix: |` 块标量（与 verify-workflow-core / verify-production 同形）。 */
function personaPrefix(yml) {
  const lines = yml.split('\n')
  const start = lines.findIndex(line => /^\s*prefix:/.test(line))
  if (start < 0) return null
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}/.test(lines[i]) || lines[i].trim() === '') out.push(lines[i].slice(6))
    else if (out.length > 0) break
  }
  return out.join('\n')
}

if (PERSONA_FIXTURE === null) {
  bad('C8. persona-carried 基线可读', 'tests/fixtures/persona-prefix-v1.txt 缺失')
} else {
  const prefix = personaPrefix(COMPOSITION)
  const expected = prefix === null ? null : prefix + '\n\n' + CARRIED_BASELINE
  const structural = expected !== null && PERSONA_FIXTURE === expected
  const startsRight = prefix !== null && PERSONA_FIXTURE.startsWith(prefix)
  const endsRight = PERSONA_FIXTURE.endsWith(CARRIED_BASELINE)
  if (structural && startsRight && endsRight)
    ok('C8. persona-carried 基线与新正文同步（= NEW_PREFIX + "\\n\\n" + body 基线）', `${PERSONA_FIXTURE.length} chars / prefix 417`)
  else
    bad('C8. body 耦合基线漂移', `startsWith(prefix)=${startsRight} endsWith(body)=${endsRight} 合成相等=${structural} —— 改 body 必须同步重取该 fixture（L1/R4 会红）`)
}

report('BATCH-STATE VERIFY (C1–C8)')