/**
 * verify-sandcastle-retro.mjs —— #73 的**沙箱夜批 Y 车道收尾面**守卫（Y1–Y8）。
 *
 * 为什么存在：#73 把 #71 的批末 retro 规则**推广到沙箱夜批 Y 车道**——但它是一个
 * **纯书面 + 喂料**的票：容器内**不跑 retro**（Q73-1，决策路径只在清晨主会话），
 * 夜间只把 digest 的「retro 素材」段当**喂料**。这带来两个会**静默腐烂**的地方：
 *
 *   ① **喂料**（`night-run.mts` 的 digest）与**判定**（enforcer 的 #71 触发面）是两
 *      件事，但长得像——后人在模板里加一行 push 关键词匹配就能把「容器内不判定」
 *      这条口径悄悄废掉，而所有既有用例照样绿（`.mts` 模板不随 `verify-all` 执行）。
 *   ② 车道适用范围散在三处（`docs/batch-state.md` 的「适用车道」节、`sandcastle/README.md`
 *      的接入说明、以及 `night-run.mts` 注释）——任一处漂走，读者就按错误的适用范围
 *      去用（这正是 D3「文档说谎」的同族）。
 *
 * 判据（**源码级 + 行为级**，#73 的模板是 `.mts`、跑了要 podman/沙箱，**不能真跑**）：
 *   Y1  读 `night-run.mts` 源文本：digest 有「retro 素材」段，且**四类素材**都在
 *   Y2  该段**明确标注不参与判定**（喂料 ≠ 判定输入）
 *   Y3  收口提醒含 retro 步骤关键词（主会话跑 / 聚合 `.scratch/retro/` / `.aggregated`
 *       / `retro: done @`）
 *   Y4  `docs/batch-state.md` 的「适用车道」节含 Y 车道，写明「复用 #71 标记、
 *       无需专用机制/专用状态文件」
 *   Y5  `sandcastle/README.md` 同写车道范围 + 指向 `docs/batch-state.md`（三处不漂移）
 *   Y6  **行为级**：把 `night-run.mts` 的两个纯函数渲染出来（拔掉 `@ch1bug/*` 依赖后
 *       在 `.scratch/` 里 import 副本），断言素材段真的产出四类、收口提醒真的点名步骤
 *   Y7  **负例硬守卫（本票最关键的一条，Q73-1）**：`night-run.mts` 里**没有**任何 retro
 *       **判定**逻辑——不出现 `matchesSurface` / `actionSurface` / `RETRO_TRIGGER` /
 *       判定关键词，也不出现 push 关键词**匹配**（`.includes()` / 正则 / `indexOf`）。
 *       匹配面=**剥注释后的代码**，由 Y7c 双向自检钉住（纯注释不误伤 + 真调用仍被抓）。
 *       **声明不覆盖（Y7d）**：间接持有 marker 路径（提取成常量 / `'.scratch/' + 'retro/…'`
 *       拼接 / 模板串 `${}`）**抓不住**，且**不打算**加宽正则去补——四种形态实测 **0/4**，
 *       正则追写法每版都能再绕一层（#79 废掉子串匹配的同一理由）。该面交给契约名禁令 +
 *       代码复核：边界写在代码里，不装成守住了。
 *   Y8  `night-run.mts` 可被 node 解析（`node --check`；语法坏了模板无从执行）
 *
 * **Y7 的判据形状（为什么不是"源文本里不许出现 git push"）**：那段文本**必须**是
 * 中文说明——车道节要告诉读者"只有真的 push 调用触发、字词不触发"，#71 的契约名
 * （`matchesSurface` 等）也要能被指出"判定在别处"。所以禁的是**判定动作**，不是
 * **出现字词**：#73 = "容器内不跑 retro"，不是"容器内不许提 retro"（后者会把文档写成
 * 哑巴）。Y7a 禁判定符号/调用，Y7b 禁"拿 push 词去做机械匹配"这一动作本身。
 *
 * 非空洞自查（perturbation，实测记录见回报）：
 *   ① 删掉 `renderRetroMaterial` 的调用/导出 → Y1/Y6 红；
 *   ② 摘掉「本段不参与判定」短语 → Y2 红；
 *   ③ 收口提醒删掉第 3、4 条 → Y3/Y6 红；
 *   ④ `docs/batch-state.md` 删掉 Y 车道那一行 → Y4/Y5 红；
 *   ⑤ `sandcastle/README.md` 删掉指针句 → Y5 红；
 *   ⑥ 在模板里加 `if (argv.includes('git push'))` → **Y7b 红**（本次实测的正是这一条）。
 * 六条均已实测（见 #73 回报），扰动一律在临时副本/还原后进行，提交树不留探针。
 *
 * 零运行时依赖（可独立 `node tests/verify-sandcastle-retro.mjs`）：只读文件 + 一个
 * `node --check` 子进程。**不 import `@deepseek-ai/*`**，也不 import enforcer
 * （判定面属于 #71 的用例面；本文件只断言"这边没有判定"）。
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
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

// ── 输入面：三张脸一起读；任一张缺失都是**响亮**的红，不是静默跳过 ────────────────
const NIGHT = read('sandcastle/templates/night-run.mts')
const DOC = read('docs/batch-state.md')
const README = read('sandcastle/README.md')

for (const [rel, text] of [
  ['sandcastle/templates/night-run.mts', NIGHT],
  ['docs/batch-state.md', DOC],
  ['sandcastle/README.md', README],
]) {
  if (text === null) bad(`Y0. ${rel} 可读`, '文件缺失或不可读 —— 收尾面缺一张脸')
}
if (NIGHT === null || DOC === null || README === null) report('SANDCASTLE-RETRO VERIFY (Y1–Y8)')

/** 取 `#/##` 标题到下一个同级标题之间的正文（按**前缀**匹配标题——标题常带括号副题，
 *  逐字相等匹配会在给标题补说明时假红）。 */
function section(text, headingPrefix) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^#{1,6} /.test(l) && l.replace(/^#{1,6} /, '').startsWith(headingPrefix))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6} /.test(lines[i])) { end = i; break }
  }
  return lines.slice(start + 1, end).join('\n')
}

// ── Y1: digest 有「retro 素材」段，四类素材都在 ──────────────────────────────
// 判据是**段本身**（渲染函数 + 四类字样），不是"哪儿提了一句 retro"。
const MATERIAL_CLASSES = [
  ['返工', /返工/],
  ['踩踏', /踩踏/],
  ['降级', /降级/],
  ['波次合并', /波次合并/],
]
const materialMissing = MATERIAL_CLASSES.filter(([, re]) => !re.test(NIGHT)).map(([n]) => n)
const hasMaterialRenderer = /export function renderRetroMaterial\s*\(/.test(NIGHT)
const hasMaterialHeading = /retro 素材/.test(NIGHT)
if (hasMaterialRenderer && hasMaterialHeading && materialMissing.length === 0)
  ok('Y1. night-run digest 有「retro 素材」段（返工 / 踩踏 / 降级 / 波次合并四类）',
    `renderRetroMaterial + ${MATERIAL_CLASSES.length} 类素材`)
else
  bad('Y1. retro 素材段缺失/残缺',
    `渲染函数=${hasMaterialRenderer} 段标题=${hasMaterialHeading} 缺: ${materialMissing.join(', ') || '(无)'}`)

// ── Y2: 该段**明确标注不参与判定**（喂料 ≠ 判定输入；防后人把它接进判定链）──────
const NOT_A_JUDGE = [
  ['不参与判定（段内自我声明）', /不参与判定/],
  ['素材 = 喂料', /喂料/],
  ['容器内不跑 retro', /容器内不跑 retro|容器内\*\*不跑 retro\*\*/],
  ['判定在别处（指向 enforcer / 判定面）', /workflow-enforcer\.mjs|\u5224\u5b9a\u9762\u6052\u4e3a/],
]
const notJudgeMissing = NOT_A_JUDGE.filter(([, re]) => !re.test(NIGHT)).map(([n]) => n)
if (notJudgeMissing.length === 0)
  ok('Y2. 素材段自我声明「不参与判定」（喂料），且点明容器内不跑 retro', `${NOT_A_JUDGE.length} 条口径`)
else bad('Y2. 「喂料不是判定」口径缺失（后人可把素材段接进判定链）', notJudgeMissing.join(', '))

// ── Y3: 收口提醒含 retro 步骤关键词 ─────────────────────────────────────────
// 这些是**主会话的动作**（容器内不跑）：主会话跑 / 聚合 `.scratch/retro/` /
// `.aggregated` / `retro: done @`。
const WRAPUP_STEPS = [
  ['在主会话跑（不是容器内）', /在清晨主会话跑|主会话跑/],
  ['聚合同批 .scratch/retro/*.md', /\.scratch\/retro\/\*\.md/],
  ['聚合已完成标记 .aggregated', /\.scratch\/retro\/\.aggregated/],
  ['写 retro: done @ <commit>', /retro: done @ <commit>/],
  ['去重合并（同一问题记次数）', /去重合并/],
  ['一次呈现', /一次呈现/],
]
const wrapupMissing = WRAPUP_STEPS.filter(([, re]) => !re.test(NIGHT)).map(([n]) => n)
if (wrapupMissing.length === 0)
  ok('Y3. 收口提醒点名 retro 步骤（主会话跑 / 聚合 / .aggregated / retro: done @）', `${WRAPUP_STEPS.length} 步`)
else bad('Y3. 收口提醒缺 retro 步骤', wrapupMissing.join(', '))

// ── Y4: docs/batch-state.md 的「适用车道」节含 Y 车道 ────────────────────────
const LANES_SECTION = section(DOC, '适用车道')
if (LANES_SECTION === null) {
  bad('Y4. docs/batch-state.md 的「适用车道」节', '找不到该节')
} else {
  const Y4_CHECKS = [
    ['含沙箱夜批 Y 车道一行', /沙箱夜批 Y/],
    ['三车道框架（matt 批 / 沙箱夜批 Y / Teams 流水线）', /matt 批/.test(LANES_SECTION) && /Teams 流水线/.test(LANES_SECTION)],
    ['写明复用 #71 的标记', /复用 #71 的标记/],
    ['写明无视专用机制/状态文件', /无专用状态文件|无专用机制/],
    ['写明容器内不跑 retro（决策只在清晨主会话）', /容器内\*\*不跑 retro\*\*|容器内不跑 retro/],
    ['写明 digest 素材段是喂料', /喂料/],
  ]
  const y4Missing = Y4_CHECKS.filter(([, pass]) => !(typeof pass === 'boolean' ? pass : pass.test(LANES_SECTION))).map(([n]) => n)
  if (y4Missing.length === 0)
    ok('Y4. 「适用车道」节含 Y 车道（复用 #71 标记 / 无专用机制 / 容器内不跑 retro）', `${LANES_SECTION.split('\n').length} 行`)
  else bad('Y4. 车道节缺 Y 车道口径', y4Missing.join(', '))
}

// ── Y5: README 与 docs 两处对车道范围的描述不漂移 ───────────────────────────
// 判据**锚在那条 bullet 上**（不是"README 里某处出现过这些词"——那会假绿：
// 实测把该 bullet 首行删掉后，散落的关键词仍全中，Y5 不红）。所以先切出那条
// bullet（`- **批末收尾适用 #71 的批末 retro 规则**` 起、到下一个顶层 bullet 止），
// 再在**它内部**断言口径；bullet 一旦被删/被改写，Y5 必红。
function readmeLaneBullet(text) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.startsWith('- **批末收尾适用 #71 的批末 retro 规则**'))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^- /.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}
const README_BULLET = readmeLaneBullet(README)
if (README_BULLET === null) {
  bad('Y5. README 的批末收尾 bullet', '找不到 `- **批末收尾适用 #71 的批末 retro 规则**` 这条接入说明')
} else {
  const README_CHECK = [
    ['bullet 写入「适用车道」指针', /适用车道/],
    ['bullet 指向 docs/batch-state.md', /docs\/batch-state\.md/],
    ['bullet 写明批末 push + CI 全绿 → 主会话跑 retro', /批末 push \+ CI 全绿[\s\S]*主会话跑 retro/],
    ['bullet 写明聚合步骤（.scratch/retro/*.md → 去重 → 一次呈现）', /\.scratch\/retro\/\*\.md[\s\S]*去重[\s\S]*一次呈现/],
    ['bullet 写明写 .aggregated + retro: done 标记', /\.scratch\/retro\/\.aggregated[\s\S]*retro: done @ <commit>/],
    ['bullet 写明容器内不跑 retro（喂料不参与判定）', /容器内不跑 retro[\s\S]*喂料/],
    ['bullet 写明复用 #71 标记、无专用机制/状态文件', /复用 #71 的标记[\s\S]*无专用机制|复用 #71 的标记[\s\S]*无专用状态文件/],
  ]
  const readmeMissing = README_CHECK.filter(([, re]) => !re.test(README_BULLET)).map(([n]) => n)
  // 双向：docs 的 Y 行也必须写「复用 #71 的标记」（两处同口径，无单边漂移）。
  const sharedLane = LANES_SECTION !== null && /复用 #71 的标记/.test(LANES_SECTION) && /复用 #71 的标记/.test(README_BULLET)
  if (readmeMissing.length === 0 && sharedLane)
    ok('Y5. README 接入 bullet 与 docs 车道节同口径（锚在 bullet 上，删即红）', `${README_CHECK.length} 条 + 共用「复用 #71 标记」措辞`)
  else
    bad('Y5. 车道范围两处漂移',
      `README bullet 缺: ${readmeMissing.join(', ') || '(无)'}；两处共用措辞=${sharedLane}`)
}

// ── Y6: 行为级 —— 拔掉不可达的 `@ch1bug/*` 依赖后，真的把两个渲染函数跑出来 ──────
// `.mts` 模板 import `./run-ticket.mts` → `@ch1bug/sandcastle-dsh`（本仓未安装，
// 需沙箱）。所以副本放在**仓内 `.scratch/`**（`lib.ts` 的 node:* 依赖可达）并把
// 那一行换成 stub —— 只换**导入边**，被测的两个渲染函数逐字节是仓内那份。
let scratch = null
try {
  scratch = mkdtempSync(join(REPO, '.scratch', 'verify-sandcastle-retro-'))
} catch {
  scratch = mkdtempSync(join(tmpdir(), 'verify-sandcastle-retro-'))
}
const stub = join(scratch, 'stub-run-ticket.mjs')
const copy = join(scratch, 'night-run.mts')
try {
  const stubSrc = 'export const EXIT_STATUS = { MERGED: 0, VERIFY_FAILED: 3, CONFLICT: 4, TIMEOUT: 5, EMPTY: 6, NEEDS_SIMPLIFY: 7 }\n'
  writeFileSync(stub, stubSrc)
  const src = NIGHT
    .replace('from "./lib.ts"', `from ${JSON.stringify(pathToFileURL(join(REPO, 'sandcastle', 'templates', 'lib.ts')).href)}`)
    .replace('from "./run-ticket.mts"', `from ${JSON.stringify(pathToFileURL(stub).href)}`)
  writeFileSync(copy, src)
  const importEdgeRewritten = src !== NIGHT && src.includes('stub-run-ticket')
  if (!importEdgeRewritten) throw new Error('导入边未重写（替换静默失败）')

  const mod = await import(pathToFileURL(copy).href)
  const results2 = [
    { id: '101', status: 'merged', note: 'ok' },
    { id: '103', status: 'needs-simplify', note: 'diff 超阈值 900 > 800' },
    { id: '104', status: 'parked-verify', note: 'cargo test FAILED: 3 errors' },
    { id: '105', status: 'merged', note: '返工一次后绿' },
  ]
  const groups = [['105', '106']]
  const waves = mod.planWaves(['101', '105', '106'], groups)
  const material = mod.renderRetroMaterial(results2, waves, groups)
  const wrapup = mod.renderWrapUpHints().join('\n')

  const Y6_CHECKS = [
    ['素材段真的产出（renderRetroMaterial 是函数）', typeof mod.renderRetroMaterial === 'function'],
    ['素材段含四类标题', ['返工：', '踩踏：', '降级：', '波次合并摘要：'].every(h => material.includes(h))],
    ['返工素材来自 note 信号（#105 返工）', material.includes('#105')],
    ['降级素材点名 parked/needs-simplify 票', material.includes('#103') && material.includes('#104')],
    ['踩踏素材来自 serial 组', material.includes('#105/#106')],
    ['波次摘要来自 planWaves 产物', /波次合并摘要：1 波/.test(material)],
    ['素材段仍自我声明不参与判定', material.includes('不参与判定')],
    ['收口提醒点名 retro 步骤', /在清晨主会话跑/.test(wrapup) && wrapup.includes('.scratch/retro/.aggregated') && wrapup.includes('retro: done @ <commit>')],
    ['收口提醒保留既有两票动作（ticket-audit / summary gate）', /ticket-audit/.test(wrapup) && /summary gate/.test(wrapup)],
  ]
  const y6Missing = Y6_CHECKS.filter(([, pass]) => !pass).map(([n]) => n)
  if (y6Missing.length === 0)
    ok('Y6. 行为级：素材段真的渲染出四类、收口提醒真的点名 retro 步骤（非纯源码字符串匹配）', `${Y6_CHECKS.length} 条`)
  else bad('Y6. 渲染行为不符', y6Missing.join(', '))
} catch (error) {
  bad('Y6. 渲染行为探针', String(error?.message ?? error).split('\n')[0])
} finally {
  // 不泄漏临时目录（D7：夹具/探针残骸）。`.scratch/` 是 gitignored 工作区、
  // 也**不是** `tests/*.mjs` 扫描面，故副本不会被 verify-all 当用例跑。
  rmSync(scratch, { recursive: true, force: true })
}

// ── Y7: 负例硬守卫 —— 模板里**没有**任何 retro 判定逻辑（本票最关键一条，Q73-1）──
//
// ⚠ 匹配面 = **剥掉注释后的代码**（`stripComments` 见下）。理由：Y7 的判据是
// 「**做了**判定这件事」，不是「**说了**判定这个词」。注释与文档字符串**必须**能点名
// `readFileSync('.scratch/batch-state.md')`、`RETRO_TRIGGER`、`.aggregated` 这些契约名
// ——否则读者不知道判定住在 enforcer、也不知道清晨主会话该动哪个文件。
// 早先版本对订阅原文本直接匹配，**实测把纯注释判成违规**：
//   `// 说明：readFileSync('.scratch/batch-state.md') 由主会话做。`
// 一行没有任何动作的注释也能让 Y7 变红 —— 这与它自己写的「禁"读"，不禁"说"」相反，
// 且会让未来**合法**的注释（说明主会话职责）被判 Q73-1 违规。复核实测抓到，故修。
// 反面保留：`existsSync(".scratch/batch-state.md")` 这类**真实调用**仍必须红（见 Y7 扰动）。
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')   // 块注释
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // 行注释（`[^:]` 避开 `https://`）
const NIGHT_CODE = stripComments(NIGHT)

// Y7a 判定符号/契约名：容器内不做 push 判定，判定面恒为 enforcer 的 `(toolName, argv)`。
const JUDGE_SYMBOLS = [
  'matchesSurface', 'actionSurface', 'ACTION_FIELDS', 'RETRO_TRIGGER',
  'retroMarker', 'aggregatedMarker', 'pushTriggerHit', 'probeBatchState',
]
const foundSymbols = JUDGE_SYMBOLS.filter(s => NIGHT_CODE.includes(s))
// Y7b 判定**动作**：拿 push 关键词去做机械匹配（`includes('git push')` /
// `/git push/.test(...)` / `indexOf('push')` …）。字词本身可以出现（中文说明里必须
// 出现——"字词不触发"这条口径就是靠说出字词来写的），**匹配动作**才是被禁的那个。
const PUSH_WORD = String.raw`(?:git\s+push|push|\u63a8\u9001)`
const JUDGE_ACTIONS = [
  ['includes(push 词)', new RegExp(String.raw`\.includes\s*\(\s*['"\`][^'"\`]*${PUSH_WORD}`, 'i')],
  ['正则 .test(push 词)', new RegExp(String.raw`\/[^/\n]*${PUSH_WORD}[^/\n]*\/[gimsuy]*\s*\.test\s*\(`, 'i')],
  ['indexOf(push 词)', new RegExp(String.raw`\.indexOf\s*\(\s*['"\`][^'"\`]*${PUSH_WORD}`, 'i')],
  ['push 关键词表/正则常量', new RegExp(String.raw`(?:const|let|var)\s+\w*(?:PUSH|RETRO)\w*(?:KEYWORDS?|WORDS?|RE|PATTERN)\w*\s*=`, 'i')],
  // 「读取标记文件」= 判定依据住 enforcer 那条路。判据是**读文件这个动作**
  // （`readFileSync`/`existsSync`/`readdirSync` 的实参里出现标记路径），**不是提到
  // 文件名**——模板的注释与收口提醒文案**必须**能指出 `.scratch/batch-state.md` 与
  // `.scratch/retro/*.md`（否则读者不知道清晨主会话该动哪个文件）。禁"读"，不禁"说"。
  ['读取标记文件（判定依据住 enforcer）', new RegExp(String.raw`(?:readFileSync|readFile|existsSync|readdirSync|statSync)\s*\([^)\n]*(?:batch-state\.md|retro|\.aggregated)`, 'i')],
]
const foundActions = JUDGE_ACTIONS.filter(([, re]) => re.test(NIGHT_CODE)).map(([n]) => n)

// Y7d 覆盖缺口 —— **显式声明不覆盖，不用模糊匹配去补**（与 #79 的 declared-not-covered 同口径）。
//
// 事实：marker 路径在模板里出现**两种位置** —— ① 收口提醒的**文案字符串**（合法且必需：
// 清晨主会话要靠它知道该动哪个文件）② **代码**里持有该路径去读（违规，判定依据住 enforcer）。
// 只用正则**无法可靠区分**这两者：#73 复核与 Lead 各实测四种间接形态
// （路径提取成常量 / `'.scratch/' + 'retro/.aggregated'` 拼接 / 模板串 `${}` 间接 / 裸常量），
// **0/4 被抓住** —— 因为路径字面量在这几种形态里**都在字符串里**，任何"先剥字符串再找路径"
// 的做法都会把证据一起剥掉；而"不剥字符串"又会把合法的收口提醒文案判成违规。
// 正则追着写法跑，每一版都能再绕一层（这正是 #79 当初废掉子串匹配的理由）。
//
// 因此本条的覆盖面**刻意停留在"字面形态"**（Y7a 契约名 / Y7b 直接匹配动作 / Y7c 注释不误伤），
// 间接持有路径这一类**声明不覆盖**，交给：① Y7a 的契约名禁令（判定符号进模板即红）
// ② 代码复核（`code-review-brief` 的两轴）③ 容器内根本没有读 `.scratch/` 的合法理由这一事实。
// 这不是"漏了一条断言"，而是一条**写明的边界**：与其留一条看起来在守、实际绕一层就过的锁，
// 不如把边界说清楚，让复核知道该看哪里。

if (foundSymbols.length === 0 && foundActions.length === 0)
  ok('Y7. 负例硬守卫：night-run.mts 无任何 retro 判定逻辑（容器内不判定）',
    `判定符号 ${JUDGE_SYMBOLS.length} / 判定动作 ${JUDGE_ACTIONS.length}，全未命中（匹配面=剥注释后的代码；间接持有路径见 Y7d 声明不覆盖）`)
else
  bad('Y7. 模板里出现 retro 判定逻辑（Q73-1 违规：容器内不跑 retro）',
    `判定符号: ${foundSymbols.join(', ') || '(无)'}；判定动作: ${foundActions.join(', ') || '(无)'}`)

// Y7c 反向自检：Y7 的匹配面**真的**剥掉了注释 —— 纯注释提到判定符号/标记路径不得红，
// 而同样的内容写成**真实调用**必须红。两个方向都钉住，Y7 才不会退化成"禁说词"的哑巴锁，
// 也不会退化成"注释也算违规"的误伤锁。
const commentOnly = stripComments(
  "// 说明：readFileSync('.scratch/batch-state.md') 与 RETRO_TRIGGER 住在 enforcer，本文件绝不读。\n"
  + '/* 块注释：exportsSync(".scratch/retro/.aggregated") 由主会话做。 */\n',
)
const realCall = stripComments('const s = existsSync(".scratch/batch-state.md")\n')
const commentInert = !JUDGE_SYMBOLS.some(s => commentOnly.includes(s))
  && !JUDGE_ACTIONS.some(([, re]) => re.test(commentOnly))
const callCaught = JUDGE_ACTIONS.some(([, re]) => re.test(realCall))
if (commentInert && callCaught)
  ok('Y7c. Y7 匹配面剥注释（纯注释不误伤）且真调用仍被抓（禁"读"不禁"说"）')
else
  bad('Y7c. Y7 匹配面失真', `注释被判违规=${!commentInert} | 真调用被抓=${callCaught}`)

// ── Y8: 模板仍可解析（语法坏了，Y1/Y3 的措辞再对也无从执行）────────────────
{
  const check = spawnSync(process.execPath, ['--check', resolve(REPO, 'sandcastle/templates/night-run.mts')], {
    cwd: REPO, encoding: 'utf8',
  })
  const out = `${check.stdout ?? ''}${check.stderr ?? ''}`
  if (check.status === 0) ok('Y8. night-run.mts 通过 node --check（模板可解析）')
  else bad('Y8. night-run.mts 语法错误', out.split('\n').slice(0, 3).join(' ').trim() || `exit ${check.status}`)
}

// ── Y9: 车道节**只留指针、不复述字段**（本文件是形状单一事实源，车道节是适用范围）──
// 车道节若开始重抄字段表（成员/结束点/三要素…），就变成第二份单一事实源（D6）。
if (LANES_SECTION === null) {
  bad('Y9. 车道节指针纪律', '找不到「适用车道」节')
} else {
  const FIELD_TABLE_WORDS = ['证明命令', 'exit code', '证据路径', '后继票']
  const echoed = FIELD_TABLE_WORDS.filter(w => LANES_SECTION.includes(w))
  if (echoed.length === 0)
    ok('Y9. 车道节只声明适用范围、不复述字段表（无第二份单一事实源）',
      `未出现 ${FIELD_TABLE_WORDS.join(' / ')}`)
  else bad('Y9. 车道节复述了字段表（字段漂移面被复制）', echoed.join(', '))
}

report('SANDCASTLE-RETRO VERIFY (Y1–Y9)')