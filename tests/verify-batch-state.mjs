/**
 * verify-batch-state.mjs —— batch-state 的守卫：**仓内载体面**（C1–C8）+ **活文件对账面**（C9）。
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
 * #115 新增（**活文件对账面** —— C1–C8 守的全是仓内载体，活文件从未被对账）：
 *   C9-live  读 `.scratch/batch-state.md` **最后一条**「未推送清单」的自称 N，与
 *            `git rev-list --count origin/<branch>..HEAD` 对账 → 不一致**响亮报两个数字**
 *            （声称 X / 实测 Y），**只报不阻断**；活文件缺席 loud SKIP；
 *            分支不可知 / 取数不可用 / 判据取不到 → ✗（防线缺席必须响亮，不静默绿）
 *   C9b      Impure 夹具仓（真 git，落 os.tmpdir()）演示**计数命令的差异** —— 结构性防线，
 *            替代"再加一条正则守文案"（D15：追开放集是无收敛军备竞赛）
 *   C9c      取数命令契约在场**且判据只认节内命中**（`headingSection` 切出契约节再匹配）
 *
 * #119 新增（**护栏的单位面** —— C9-live 对的是**笔**，护栏却是**票**）：
 *   C9-guardrail  护栏两侧**同为票**：票数 = 成员表「状态」列首词 `done` 的行数（**结构解析**，
 *            不新增手抄字段 —— 手抄会静默漂，正是 #115 治过一次的病）；判据 = **票数 > 5** 才喊
 *            （A 批实测口径：5 票全部完成时"正好 5、护栏未触发"）；**笔数只作展示、不参与比较**；
 *            票数取不到（缺节 / 缺表 / 缺「状态」列 / 行缺列）→ **✗**，绝不静默当 0
 *            （0 是"没超"方向，会把护栏整个废掉）；无活文件 / 分支不可知 → loud SKIP。
 *   C9d      票数解析器自检：仓内夹具文本（3 行 / 2 完成、6 行 / 6 完成）→ 票数正确；
 *            无表格 / 表头无「状态」列 → **解析失败**（响亮，不返回 0）
 *   C9e      护栏判据自检：`overGuardrail(5) === false`、`(6) === true` —— 把 brief AC
 *            「5 票不喊 / 6 票喊」钉成可跑事实（防后人把 `>` 悄悄改回 `>=` 或按笔判断）；
 *            同时钉**文档同口径句**「票数 **> 5** 才喊」（阈值在代码与 docs 两处载体上，
 *            单边漂移在第 1 轮复核里无人守 —— D6）
 *   C9f      护栏**发出去的那一面**：读数必须在场、**入口形状只收 `{done,total}`**（裸笔数被拒）、
 *            **读数等于本轮 `parseTickets(LIVE)` 的结果**（挡"同形状重贴标签"）、
 *            `fired == overGuardrail(done)` 自洽 —— 整块被删 / 调用点改拿笔数去喊，都在
 *            **任何活文件状态**下变红（不靠"此刻恰好 5 票"那种数据巧合）
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
 * 五条均已实测（见回报）。#115 追加的 C9 面另有两组镜像扰动：
 *   `.scratch/p115-nonempty.mjs`（P0–P9：不一致报两数且 exit 0 / ≥5 护栏 / 缺席 loud SKIP /
 *   判据哑掉转 ✗ / 取数不可用转 ✗ / 契约整节被删转 ✗ / 白名单换错命令转 ✗）；
 *   `.scratch/p115-c9c-regression.mjs`（B0–B4：C9c 收窄到节内后，节内命令规则被松动、
 *   危险侧措辞被删、整节被删 —— 三者都真红）。读数见 `.scratch/p115-nonempty.log`。
 * #119 的护栏面另有一组（`.scratch/p119-nonempty.mjs`：镜像活文件 5 票 / 14 笔 → **不喊**；
 * 6 票 → **喊**；缺成员表 → ✗；解析器改成恒返回 0 → C9d 真红；判据改回 `>=` → C9e 真红）。
 * 读数见 `.scratch/p119-nonempty.log`。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { fixtureEnv } from './isolated-git.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
/** **只报不阻断**：C9 的发现既不是 ✓ 也不是 ✗（不碰 exit code），但必须出现在读数里。 */
const warn = (name, detail = '') => results.push('  ⚠ ' + name + (detail ? ' — ' + detail : ''))
/** 终判：只认 ✗（⚠ 不阻断 —— working tree 在提交时点「领先」于状态文件是**正常态**）。 */
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
  // #119：成员表「状态」列的首词 `done` 是**票数**的机械取数面（C9-guardrail 读它）。
  // 文档若删掉这个字面量，读者的成员表就失去唯一可辨认的完成标记 → 护栏静默读 0。
  ['状态列完成标记 done', /`done`/],
  // #128：批宣告还定死「关票方式」并写下「授权清单 / 收口记录」。文档删掉任一字面量，
  // 读者就写不出完整体（关票方式缺席时正文默认最保守，授权范围则无从判）。
  ['关票确认方式', /关票确认方式/],
  ['预授权清单', /预授权清单/],
  ['收口记录', /收口记录/],
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
    ['状态列完成标记 done', /`done`/],
    ['关票确认方式（三选一）', /关票确认方式[\s\S]*逐票确认[\s\S]*批内预授权[\s\S]*批末一次/],
    ['预授权清单（四列）', /预授权清单[\s\S]*写域[\s\S]*只建不关[\s\S]*push/],
    ['收口记录', /收口记录/],
  ]
  const tmplMissing = wantInTemplate.filter(([, re]) => !re.test(tmpl)).map(([n]) => n)
  if (tmplMissing.length === 0)
    ok('C1b. 模板骨架本身可直接复制（表头 + 三要素 + lane + 后继票 + retro 标记）', `${tmpl.split('\n').length} 行`)
  else bad('C1b. 模板骨架缺元素', tmplMissing.join(', '))
} else {
  bad('C1b. 模板骨架', 'docs/batch-state.md 里找不到 ```markdown 模板块')
}

// ── C10: 「缺字段必红」判据自检（#128 —— 非空洞，brief §3.1「守卫」面）─────
// 同一条判据（REQUIRED_FIELDS 的 regex 集合）喂两份输入：
//   ① 真的 docs —— 新字段必须全中（与 C1 同一判据，这里只再取一次读数）；
//   ② 「把新字段逐字删掉」的镜像副本 —— 必须把三个字段**逐个报缺**。
// ② 就是这条判据的伪装输入：字段被悄悄删掉时守卫必须红。若判据恒绿（说不出什么输入
// 能让它红），②这一项自己也红 —— 那才是断言空转。
const NEW_DECLARATION_FIELDS = ['关票确认方式', '预授权清单', '收口记录']
const strippedDoc = NEW_DECLARATION_FIELDS.reduce((text, name) => text.split(name).join(''), DOC)
const realMissingNew = REQUIRED_FIELDS
  .filter(([name]) => NEW_DECLARATION_FIELDS.includes(name))
  .filter(([, re]) => !re.test(DOC))
  .map(([name]) => name)
const strippedMissingNew = REQUIRED_FIELDS
  .filter(([name]) => NEW_DECLARATION_FIELDS.includes(name))
  .filter(([, re]) => !re.test(strippedDoc))
  .map(([name]) => name)
if (realMissingNew.length === 0 && strippedMissingNew.length === NEW_DECLARATION_FIELDS.length
  && strippedDoc !== DOC && strippedDoc.length > 0)
  ok('C10. 「缺字段必红」判据自检（删掉新字段的镜像副本 → 逐字段报缺）',
    `真 docs 缺 0 个；镜像副本缺 ${strippedMissingNew.length}/${NEW_DECLARATION_FIELDS.length}：${strippedMissingNew.join(' / ')}`)
else bad('C10. 缺字段判据空转或被绕过',
  `真 docs 缺: ${realMissingNew.join(', ') || '(无)'}；镜像副本报缺 ${strippedMissingNew.length}/${NEW_DECLARATION_FIELDS.length}（应报满）`)

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
const TMPL_FIELD_WORDS = ['成员', '结束点', '证明命令', 'exit code', '证据路径', 'lane', '后继票', 'retro:',
  '关票确认方式', '预授权清单', '收口记录']
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

/** 取 `## <id>…` 标题到下一个**同级或更高级**标题之间的正文（不含标题行本身）。
 *  标题按**前缀**匹配（允许标题带括注，如 `## 取数命令契约（…只许一条命令）`）——
 *  要求逐字相等会把"标题被补充说明"误判成"整节消失"，那是假红。
 *  与 `sectionText` 分开写而不是合一：前者钉骨架的 `@@ ` 标记、后者钉文档的 `## ` 标题，
 *  两者的"节边界"约定不同（合并会悄悄改掉 C3 的判据面 —— 有意变更必须显式，不顺手捎带）。 */
function headingSection(text, id) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^##\s/.test(l) && l.slice(3).startsWith(id))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) { end = i; break }
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
  // #128：票面契约 / 冲突归零 / 批宣告预授权 / 收口步（正文被改回旧版 → 这里红）。
  ['票面契约（RFA 判据清单）', /TICKET ENTRY CONTRACT/],
  ['四类冲突归零', /CONFLICT ZERO/],
  ['批宣告预授权清单', /BATCH DECLARATION PRE-AUTHORIZATION LIST/],
  ['收口步', /CLOSE-OUT STEP/],
  ['显式未覆盖声明（套件不联网核票面）', /EXPLICITLY NOT GUARDED/],
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
  ['关票确认方式', /关票确认方式|confirmation mode of closing/i],
  ['预授权清单', /预授权清单|PRE-AUTHORIZATION LIST/i],
  ['收口记录', /收口记录|CLOSE-OUT STEP/i],
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

// ── C9: 活文件「未推送清单」机械对账（#115；**只报不阻断**）──────────────────
// 为什么存在：#77 / #113 / #48 三次把「未推送清单」手抄错，而**批末 push 的输入**读它
// ——取错命令会把 5 笔读成 1 笔，**恰好漏报**（C9-live 只能 ⚠ 只报不阻断，于是错数会跟着 push 走）。
// （#119 起它**不再**喂护栏：护栏读**票数**，见下方 C9-guardrail —— 笔 ≠ 票，别混着比。）
// C1–C8 守的全是**仓内载体**（模板/文案/正文），活文件 `.scratch/batch-state.md` 从未被对账。
//
// 口径（三条，照票面 #115 的 AC）：
//   ① **判据窄**：只读**最后一条**「未推送清单」声称——该文件累积多轮记录是**有意的**，
//      不要求删历史行（票面 Out of scope 明确）；拿历史行判会假红。
//   ② **只报不阻断**：不一致 → `⚠`（不碰 exit code）。working tree **领先**于状态文件是
//      提交时点的**正常态**——把正常态变红就是造噪声，而噪声最终会被人忽略。
//   ③ **不猜分支**：对账分支取 `origin/<当前分支>`；当前分支不可知（detached / 非仓）→
//      响亮跳过，**不猜 `main`**（同 C2a 的"响亮"口径，也同 D47：防线缺席必须响亮）。
//   另：本节的任一**机械失灵**（读不到活文件、git 不可用、命令白名单不合规、夹具不红）
//   一律是 **✗** —— 全仓既有的"用 exit 0 记下一个空断言"之弊，不在这节重犯。
const COUNT_CMD = ['rev-list', '--count']
const COUNT_LABEL = 'git rev-list --count origin/<branch>..HEAD'

/** **测试缝**（扰动用例专用，见下方 `git()`）：覆盖 C9 的两个读数面。
 *  变量名带 `DSH_MATT_BATCHSTATE_` 前缀，不与任何真实环境变量撞；不设 = 零影响。
 *  为什么需要缝：扰动要在**镜像副本**上造"声称 ≠ 实测 / ≥5 笔 / 取数不可用"，而改调用方
 *  仓库的 origin/main 是破坏性的（本仓禁止）；"PATH 前置假 git"在 Windows 下也不通 ——
 *  实测 `spawnSync('git', …)` 不经 shell 解析 PATH 里的 `.cmd` 一律失败（129 / EINVAL）。
 *
 *  ⚠ 第 1 轮复核（Standards 轴 D-2）实测：缝替换的是**判据的输入事实本身**，于是任何残留的
 *  该变量（父 shell 泄漏 / CI 误设 / 调试后忘清）都会让 C9 报 `✓ 一致` 而**真 git 根本没跑**，
 *  且读数里没有一个字提示"实测值来自伪造"——这正是 D47 点名的第 ② 类（依赖环境门禁变量）
 *  的**静默通过**。⇒ 缝保留（扰动非空洞要靠它），但代价全都要**响亮**：
 *    ① 双变量门：`DSH_MATT_BATCHSTATE_COUNT` **单独设不生效**，必须同时设 `_SEAM_ACK=1`；
 *    ② 走了缝就在**每一条** C9-live 读数里标注，并在汇总区再喊一行。 */
const SEAM_ACK = process.env.DSH_MATT_BATCHSTATE_SEAM_ACK === '1'
const COUNT_OVERRIDE = SEAM_ACK ? process.env.DSH_MATT_BATCHSTATE_COUNT : undefined
const BRANCH_OVERRIDE = SEAM_ACK ? process.env.DSH_MATT_BATCHSTATE_BRANCH : undefined
/** 缝是否真的生效过（`git()` 里置位；收尾据此喊一行"本次读数有伪造成分"）。 */
let seamUsed = false
/** 设了 COUNT 却没给 ACK —— 响亮告知"缝被忽略"，不静默丢弃（否则扰动会以为自己在测）。 */
const seamIgnored = !SEAM_ACK && process.env.DSH_MATT_BATCHSTATE_COUNT !== undefined
const BRANCH = BRANCH_OVERRIDE !== undefined
  ? { status: 0, stdout: BRANCH_OVERRIDE }
  : spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' })
const branch = BRANCH.status === 0 ? (BRANCH.stdout ?? '').trim() : ''

/** 跑一条 git 子命令：返回 `{ status, out }`；抛错与错误码都如实回传（不猜）。
 *  测试缝只覆盖 `rev-list --count` 这一个读数（见 COUNT_OVERRIDE 的说明），默认零影响。 */
function git(args) {
  const isCount = args[0] === COUNT_CMD[0] && args[1] === COUNT_CMD[1]
  if (isCount && COUNT_OVERRIDE !== undefined) {
    seamUsed = true
    const [code, out = ''] = COUNT_OVERRIDE.split('|')
    return { status: Number(code), out }
  }
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' })
  return { status: r.status, out: (r.stdout ?? '').trim() }
}

/** 夹具子进程的 spawn 选项（`git -C <dir>` 由调用处拼 argv）：豁免本机 sysadmin 级的
 *  "原生命令 cwd 变更"行为（实测：`startup` 脚本族会在**每次**子进程启动时把 cwd 复位到
 *  Windows 用户目录，于是 `cwd: fixtureDir` 静默失效 → 夹具命令全打在**调用方仓库**上，
 *  而 `-C` 是 git 自己的参数，宿主改不了它）。这条也是 #110 同族的"夹具污染调用方仓库"防线。 */
const gitOpts = (env) => ({ encoding: 'utf8', env, windowsHide: true })

/** 判据：**最后一条**「未推送清单」+ 结尾 `（<N> 票…）`。三个设计点：
 *  ① `[\s\S]` 让一条清单可以跨多行（真实文件正是多行 + 行尾写数）；
 *  ② `（<N> 票` 之后**允许还有话**（实测踩到：`（4 票；实测 = git rev-list --count …）`
 *     这种写法完全合规，而要求 `票）` 紧邻会把它判成"没有声称"→ 守卫静默哑掉的**假红**）；
 *  ③ `(?![\s\S]*未推送清单)` 把 `matchAll` 天然锁在**最后一条**上：中途再出现一次清单则
 *     两条都不匹配 → **C9-claims 转 ✗** —— 响亮哑掉，好过静默取一条错的来对账。 */
const CLAIM_RE = /未推送清单：[\s\S]*?（(\d+)\s*票(?![\s\S]*未推送清单)/g
const LIVE_REL = '.scratch/batch-state.md'
const LIVE = read(LIVE_REL)
const claimCount = LIVE === null ? null : [...LIVE.matchAll(CLAIM_RE)].length
const CLAIM = LIVE === null ? null : LIVE.match(new RegExp(CLAIM_RE.source, ''))

// ── C9-guardrail 的**票数**取数（#119）：从成员表**结构解析**，不新增手抄字段 ─────
// 为什么不是"再加一个「已完成票数」字段"：手抄会静默漂 —— #115 的 C9-live 治过一次
// （笔数手抄），票数若也手抄就复制了同一个病（#119 票面的设计点①）。故票数**只**由成员表推导：
//   · 取 `## 成员与顺序` 一节里的**第一张**表（节内先出现的连续 `|` 行）；
//   · 按**列名**定位「状态」列（不写死列序 —— 列序是形状的一部分，会随模板演进而变）；
//   · 数据行该列去掉 `*` / `` ` `` 后的**首词** == `done` → 该票已完成。
// 任何一步取不到都返回 `{ status: '…', reason }`，由上层**响亮 ✗**：绝不静默当 0
// （0 是"没超"方向，会把护栏整个废掉 —— 同 C9 对"取数不可用"的处置口径）。
const DONE_TOKEN = 'done'
function parseTickets(live) {
  const section = headingSection(live, '成员与顺序')
  if (section === null) return { status: 'no-section', reason: '找不到 `## 成员与顺序` 一节' }
  const lines = section.split('\n')
  const start = lines.findIndex(l => /^\s*\|/.test(l))
  if (start < 0) return { status: 'no-table', reason: '「成员与顺序」节内没有表格' }
  const rows = []
  for (let i = start; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(lines[i])
  /** `| a | b |` → `['a','b']`（首尾空 cell 由边框产生，丢掉）。 */
  const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  if (rows.length < 3) return { status: 'no-table', reason: `表格只有 ${rows.length} 行（表头 + 分隔 + ≥1 数据行才成立）` }
  const header = cells(rows[0])
  const statusIdx = header.findIndex(c => c.replace(/[*`]/g, '').trim() === '状态')
  if (statusIdx < 0) return { status: 'no-status-column', reason: `表头 ${JSON.stringify(header)} 里没有「状态」列` }
  const isSeparator = (cs) => cs.every(c => c === '' || /^:?-{2,}:?$/.test(c))
  const data = rows.slice(1).map(cells).filter(cs => !isSeparator(cs))
  if (data.length === 0) return { status: 'no-rows', reason: '成员表没有数据行（成员 0 票）' }
  let done = 0
  for (const [i, cs] of data.entries()) {
    if (cs.length <= statusIdx) return { status: 'row-shape', reason: `第 ${i + 1} 个数据行缺「状态」列（${JSON.stringify(cs)}）` }
    if (cs[statusIdx].replace(/[*`]/g, '').trim().split(/\s+/)[0].toLowerCase() === DONE_TOKEN) done++
  }
  return { status: 'ok', total: data.length, done }
}

/** 护栏判据（两侧**同为票**）：**超过** 5 票才喊。
 *  `>` 不是 `>=` —— A 批实测的 human 口径：5 票全部完成时「**正好 5**、护栏**未触发**」。
 *  5 是**批的成员上限**（**D32**；护栏 (b)「未推送达 5 票」里的 5 见 **D31 (b)**）—— 所以这道闸
 *  真喊出来时，信号是「批超出宣告上限 / 成员表漂了」；动作仍按正文「暂停并报告、请求 push
 *  检查点」，但**闸不主张**"必须 push"（批末 push 仍走 D31 的总结门）。C9e 把两侧边界
 *  （5 不喊 / 6 喊）钉成可跑事实，防后人悄悄改回 `>=` 或改回按笔判断。 */
const overGuardrail = (tickets) => tickets > 5

/** 由**解析出来的票数**产出护栏读数。
 *  **输入形状本身就是一道结构防线**（第 1 轮复核 D6/C9f 实测：光靠 `fired === overGuardrail(done)`
 *  自洽，在"活文件 0 票 / 2 笔"时与"把笔数接进来"同值 ⇒ 那道判据是**数据依赖**的）。
 *  故入口只接受 `parseTickets()` 的成功返回形状 `{ done, total }`；喂裸 number（笔数）、
 *  字符串或别的东西 → `{ status: 'bad-input' }`，调用方**响亮 ✗**。
 *  为什么不写成"宽容地取一个数"：本票的病就是**笔数被当票数用**，一个能接受裸 number 的
 *  入口等于把这个错法请回来 —— 形状门把"**裸笔数**"这条路封死。
 *  ⚠ 它挡不住"同形状重贴标签"（`{done: 笔数, total: 笔数}`）；那一条由 C9f 的**就地对照**
 *  （发出去的 `done/total` 必须等于本轮 `parseTickets(LIVE)` 的结果）兜住，别把这个入口说成万能。 */
const guardrailOf = (parsed) => {
  const wrongShape = typeof parsed?.done !== 'number' || typeof parsed?.total !== 'number'
  return wrongShape
    ? { status: 'bad-input' }
    : { status: 'ok', done: parsed.done, total: parsed.total, fired: overGuardrail(parsed.done) }
}

/** 本轮护栏读数 —— C9f 用它守三面：读数**必须在场**、**入口形状合法**、**数字与活文件一致**。 */
let guardrailReading = null
/** 本轮从活文件解析出的票数（C9f 的就地对照基线：发出去的数字必须等于它）。 */
let liveTickets = null
/** 未推送**笔数**（C9-live 的实测值）。**只作展示，不参与护栏比较** —— #119 的核心。 */
let unpushed = null

if (LIVE === null) {
  // ③ 缺席 ≠ 红：非批会话本来就没有这个文件（票据 AC「响亮跳过，不报假红」）。
  console.log(`  ⚠ C9 SKIP (loud). ${LIVE_REL} 不存在 —— 非批会话，未推送清单无来源可对账；` +
    `批会话则由「批宣告初始化状态文件」保证它在场`)
} else {
  if (branch === '') {
    console.log('  ⚠ C9 SKIP (loud). 当前分支不可知（detached HEAD / 非 git 仓）—— 笔数对账分支不猜，跳过' +
      '（**票数护栏不依赖分支**，下面照常给读数）')
  } else if (CLAIM === null) {
    // 文件在、但"最后一条声称"这个**判据**取不到 —— 守卫哑了，必须响亮。
    bad('C9-claims. 活文件里能取到「未推送清单 …（<N> 票）」的最后一条声称',
      claimCount === 0
        ? `读到了 ${LIVE_REL} 但没有一条符合判据（缺「未推送清单：」前缀或结尾「（<N> 票）」）—— 守卫静默哑掉的形态`
        : `判据命中 ${claimCount} 条（>1）—— 不一致的文件形态；先修状态文件写法（见 docs/batch-state.md 模板）`)
  } else {
    const CLAIMED = Number(CLAIM[1])
    const rev = git([...COUNT_CMD, `origin/${branch}..HEAD`])
    if (rev.status !== 0 || !/^\d+$/.test(rev.out)) {
      // 「确定无法判」**不是**「锻炼出结论」：C9 的取数命令跑不动 = 防线缺席，必须响亮。
      bad('C9-live. 取数命令可用', `${COUNT_LABEL} → exit ${rev.status}${rev.out ? ` / ${rev.out}` : ''} —— ` +
        'origin ref 可能未取回（git fetch 后重跑）')
    } else {
      unpushed = Number(rev.out)
      // 缝生效过就在**每一条** C9-live 读数里标注：读者看到的"实测 Y"不是真 git 读数。
      const seam = seamUsed ? '【⚠ SEAM：实测值来自 DSH_MATT_BATCHSTATE_COUNT，真 git 未跑】' : ''
      if (CLAIMED === unpushed) {
        ok('C9-live. 活文件最后一条「未推送清单」与 git 事实一致',
          `声称 ${CLAIMED} == 实测 ${unpushed}（${COUNT_LABEL}）${seam}`)
      } else {
        // ② 只报不阻断 —— 两个数字都要出现（票面 AC 明文："含声称 X / 实测 Y"）。
        warn('C9-live. 未推送清单与 git 事实**不一致**',
          `声称 ${CLAIMED} / 实测 ${unpushed} ${seam}—— 把状态文件最后一条的「（<N> 票）」改成 ${unpushed}；` +
          '（工作树领先状态文件是提交时点的正常态，故只报不阻断）')
      }
    }
  }

  // ── C9-guardrail（#119）：护栏两侧**同为票** ──────────────────────────────
  // 与上面的**笔**数对账**解耦**：笔数取不到（或没有声称行）不该把票数护栏一起拖哑，
  // 反之亦然。两个量各自命名、各自响亮 —— 输出里不再出现「N 笔 … 超 M 票护栏」这种混单位句。
  const TICKETS = parseTickets(LIVE)
  if (TICKETS.status !== 'ok') {
    bad('C9-guardrail. 票数可解析（成员表结构取数）',
      `${TICKETS.reason} —— 护栏读不到票数时必须**响亮**；**绝不当 0**（0 是"没超"方向，会把护栏整个废掉）`)
  } else {
    const READING = guardrailOf(TICKETS)
    guardrailReading = READING
    if (READING.status === 'ok') liveTickets = TICKETS
    if (READING.status !== 'ok') {
      // 形状不对 = 有人把**笔数**或别的量喂进了护栏入口 —— 这正是本票的原始错法，必须响亮。
      bad('C9-guardrail. 票数入口的形状（只接受解析出来的 `{done,total}`，**不接受裸笔数**）',
        `实得 ${JSON.stringify(READING)} —— 入口只收 parseTickets() 的成功返回；喂裸 number 会被拒`)
    } else {
      const pen = unpushed === null ? '未知（本轮笔数取数未成功，见上）' : `${unpushed} 笔`
      const seamNote = seamUsed ? '【⚠ SEAM：笔数来自 DSH_MATT_BATCHSTATE_COUNT】' : ''
      if (READING.fired) {
        warn('C9-guardrail. 已完成票数**超 5 票护栏**',
          `已完成 ${READING.done}/${READING.total} 票 > 5 票（两侧同为**票**）—— 按 @@ batch-mode：` +
          `**暂停并报告**：5 是批的成员上限（D32），到第 6 票是**违规形态**（批超出宣告上限 / 成员表漂了）；` +
          `请 human 裁决：按 D31 (b) 收束并请求 push 检查点，或**拆批 / 修正成员表**` +
          `（"确认继续跑 6 票的批"不是合法选项——D32 的上限要 human 明确改写批宣告才动）。` +
          `未推送 ${pen}${seamNote}（笔数只作展示，**不参与**本次比较）`)
      } else {
        // 5 票是正文 D31 的暂停门，而本闸按「超过 5 票」才喊 —— 恰在 5 票时把这条边界明说出来，
        // 免得"闸没喊"被误读成"规则也不管"（闸不喊 ≠ 正文规则取消）。
        const boundary = READING.done === 5
          ? '；已达 5 票 —— 正文 D31「未推送达 5 票」的暂停门在此，本闸按「超过 5 票」才喊，'
            + '要不要 push 检查点请按正文规则自行决定'
          : ''
        ok('C9-guardrail. 护栏两侧同单位（票）：已完成票数未超 5 票护栏',
          `已完成 ${READING.done}/${READING.total} 票 ≤ 5 票（两侧同为**票**）；` +
          `未推送 ${pen}${seamNote}（笔数与票数是两个量，笔数只作展示、**不参与**比较${boundary}）`)
      }
    }
  }
}

// ── C9d/C9e/C9f: 票数取数与护栏判据的**自检夹具**（#119 非空洞的结构性防线）──────
// 为什么需要：C9-guardrail 的输入是**活文件**——活文件此刻是什么，断言就只知道什么。
// 0 票时"没喊"与"解析器恒返回 0"两种世界的读数**完全一样**，那正是空洞。所以把**解析器**
// 与**判据**拿出来，喂**仓内夹具文本**（与活文件无关），让"几票 → 喊不喊"变成不依赖
// 活文件的可跑事实：扰动解析器（返回 0）→ C9d 红；扰动判据（`>` 改 `>=`）→ C9e 红；
// 摘掉整块护栏 → C9f 红。三条都随 `verify-all` 常驻（不只是 .scratch 的一次性取证）。
const wrapMembers = (body) => `## 成员与顺序\n\n${body}\n`
const TICKET_PARSE_CASES = [
  ['3 行 / 2 完成（`done` 与 `done @ <sha>` 都算完成）',
    '| # | 票 | 状态 | 说明 |\n| --- | --- | --- | --- |\n'
    + '| 1 | #901 | `done` | lane=A |\n| 2 | #902 | done @ abc1234 | lane=A |\n'
    + '| 3 | #903 | `ready-for-agent` | lane=A |', { total: 3, done: 2 }],
  ['6 行 / 6 完成',
    '| # | 票 | 状态 | 说明 |\n| --- | --- | --- | --- |\n'
    + '| 1 | #901 | `done` | x |\n| 2 | #902 | `done` | x |\n| 3 | #903 | `done` | x |\n'
    + '| 4 | #904 | `done` | x |\n| 5 | #905 | `done` | x |\n| 6 | #906 | `done` | x |',
    { total: 6, done: 6 }],
  ['无空格粘连不算完成（`done（#114）` / `done@sha` —— 口径是"**空白分隔的首词**"）',
    '| # | 票 | 状态 | 说明 |\n| --- | --- | --- | --- |\n'
    + '| 1 | #901 | done（#114） | x |\n| 2 | #902 | done@abc1234 | x |\n'
    + '| 3 | #903 | `ready-for-agent` | x |', { total: 3, done: 0 }],
  ['无表格 → 解析失败（响亮，不返回 0）', '本节没有表格，只有一句话。', null],
  ['表头无「状态」列 → 解析失败',
    '| # | 票 | 说明 |\n| --- | --- | --- |\n| 1 | #901 | lane=A |', null],
]
const parseFailures = []
for (const [name, body, want] of TICKET_PARSE_CASES) {
  const got = parseTickets(wrapMembers(body))
  const pass = want === null
    ? got.status !== 'ok'
    : got.status === 'ok' && got.total === want.total && got.done === want.done
  if (!pass) parseFailures.push(`${name}（实得 ${JSON.stringify(got)}）`)
}
if (parseFailures.length === 0)
  ok('C9d. 票数解析器自检（成员表 → 票数；含完成标记两侧与"解析不到"）',
    `${TICKET_PARSE_CASES.length} 个夹具：${TICKET_PARSE_CASES.map(([n]) => n).join(' / ')}`)
else bad('C9d. 票数解析器自检失败（票数取数面已失真）', parseFailures.join(' | '))

// C9e：brief AC 的两侧边界（5 票**不喊** / 6 票**喊**）—— 判据是纯函数，与笔数无关。
// ⚠ 本票的阈值与判据语义在**两处载体**上（代码 `overGuardrail` + 文档「笔与票」节），
// 单边漂移（改代码不改文档）此前无人守（第 1 轮复核 D6）。故这里同时钉**文档那侧的同一句话**：
// 文档必须写明「票数 **> 5** 才喊」，与代码判据同字面量（照 C2d `retroMarker` 的先例）。
const DOC_THRESHOLD_LINE = '票数 **> 5** 才喊'
const GUARD_CASES = [
  ['5 票 → 不喊（A 批实测：正好 5，护栏未触发）', 5, false],
  ['6 票 → 喊', 6, true],
  ['0 票 → 不喊', 0, false],
]
const guardFailures = GUARD_CASES.filter(([, n, want]) => overGuardrail(n) !== want).map(([name]) => name)
const docSaysSame = DOC.includes(DOC_THRESHOLD_LINE)
if (guardFailures.length === 0 && docSaysSame)
  ok('C9e. 护栏判据自检（**票** > 5 才喊：5 不喊 / 6 喊 —— 与笔数无关）且文档同口径',
    `${GUARD_CASES.length} 个边界：${GUARD_CASES.map(([n]) => n).join(' / ')}；docs 含 ${JSON.stringify(DOC_THRESHOLD_LINE)}`)
else bad('C9e. 护栏判据自检失败',
  `${guardFailures.length ? '判据被改回 `>=` 或换回笔数？→ ' + guardFailures.join(' / ') : ''}` +
  `${docSaysSame ? '' : `${guardFailures.length ? '；' : ''}docs 缺同口径句 ${JSON.stringify(DOC_THRESHOLD_LINE)}（代码改了文档没跟 = D6 单边漂移）`}`)

// C9f：护栏的**发出去**的那一面 —— 三条一起判：
//   ① 缺席判据：把护栏整块删掉时，"没超所以没喊"与"防线被摘掉"读数完全一样（只能靠这条抓）；
//   ② 形状判据：`guardrailOf` 只收 `{done,total}`，**裸笔数必须被拒** —— 第 1 轮复核实测：
//      只靠 `fired === overGuardrail(done)` 自洽在"活文件 0 票 / 2 笔"时是**数据依赖**的空转
//      （把调用点改成拿笔数，仍绿）；形状判据不依赖活文件，任何活文件状态下都能红；
//   ③ 决策判据：发出去的 `fired` 必须等于 `overGuardrail(发出去的 done)`（防"读数改了决策没改"）。
const SHAPE_CASES = [
  ['{done:5,total:5} → 不喊', { done: 5, total: 5 }, false],
  ['{done:6,total:6} → 喊', { done: 6, total: 6 }, true],
]
const shapeFailures = SHAPE_CASES.filter(([, input, want]) => guardrailOf(input).fired !== want).map(([n]) => n)
// 裸数字 / 字符串（= 笔数被误当票数）都必须被入口拒掉：这是本票原始 bug 的形状。
const rejectsNonTickets = [14, '6', null, undefined].every(v => guardrailOf(v).status === 'bad-input')
if (LIVE === null) {
  // 无活文件：C9 整体 loud SKIP，护栏按构造不出声 —— 不判红（非批会话）。
} else if (shapeFailures.length > 0 || !rejectsNonTickets) {
  bad('C9f. 护栏入口形状自检失败（**票数入口把笔数放进来了**）',
    `fixture 失败: ${shapeFailures.join(' / ') || '(无)'}；裸 number/字符串被拒 = ${rejectsNonTickets}`)
} else if (guardrailReading === null) {
  bad('C9f. 护栏读数缺席', '活文件在，却没有 C9-guardrail 读数 —— 护栏被摘掉了（防线缺席必须响亮）')
} else if (guardrailReading.status !== 'ok') {
  bad('C9f. 护栏读数的输入形状非法（可能被喂了**笔数**）',
    `本轮读数 ${JSON.stringify(guardrailReading)} —— 只接受解析出来的 {done,total}`)
} else if (liveTickets !== null && (guardrailReading.done !== liveTickets.done || guardrailReading.total !== liveTickets.total)) {
  // 形状门挡得住"裸笔数"，挡不住"同形状重贴标签"（`{done: 笔数, total: 笔数}`）——
  // 这一条就地对照：**发出去的数字**必须等于本轮从活文件解析出来的票数。
  bad('C9f. 护栏读数与活文件票数不一致（数字被改写了 / 被换成了别的量）',
    `读数 ${JSON.stringify(guardrailReading)} vs parseTickets(LIVE) ${JSON.stringify(liveTickets)}`)
} else if (guardrailReading.fired !== overGuardrail(guardrailReading.done)) {
  bad('C9f. 护栏决策与票数不符（决策可能被接到了**笔数**上）',
    `本轮读数 ${JSON.stringify(guardrailReading)} —— fired 必须是 overGuardrail(已完成票数) 的函数`)
} else {
  ok('C9f. 读数在场 + **输入形状只收票数** + 数字与活文件一致 + 决策自洽',
    `活文件 ${guardrailReading.done}/${guardrailReading.total} 票 → fired=${guardrailReading.fired}` +
    `（== parseTickets(LIVE)）；fixture：${SHAPE_CASES.map(([n]) => n).join(' / ')}；裸 number/字符串被入口拒掉`)
}

// ── C9b: 计数机制的**机械演示夹具**（#115 的非空洞硬要求 + D15 的结构性防线）────────
// 为什么是夹具而不是"再加一条正则守文案"：D15 —— 用更宽的正则去追下一个反例是无收敛军备竞赛。
// 这里换**结构性**防线：把 `rev-list --count` 与 `Measure-Object` 一族放进**同一个 Impure
// 夹具仓**，同时喂**同一份输入**（同一个 `git log` 输出），直接断言两条路给出**不同的数字**。
// 于是「错的取数命令长什么样」变成**可跑的事实**，而不是文档里的一句话——
// 后人若把契约改回"用 Measure-Object 也行"，这条断言照样指着那个夹具说"不行"。
// 全程落在 os.tmpdir()：仓内临时件会进 git 状态并踩 pre-commit 的"工作树有未 staged 改动"闸门。
// 显式脱离父 git 环境（GIT_DIR 等）：否则夹具里的 `git init` 会写进调用方仓库（#110 同族教训）。
const TMPFIX = mkdtempSync(join(tmpdir(), 'dsh-matt-c9-count-'))
try {
  // 清理走共享挂具 `tests/isolated-git.mjs`（#110）：把"怎么写"收敛成一处，"写没写"由
  // `tests/verify-isolated-git.mjs` 的 I2 结构断言守住（此前 4 个夹具各手写一份、无守卫）。
  const env = fixtureEnv({ GIT_CONFIG_GLOBAL: join(TMPFIX, '.gitconfig'), GIT_CONFIG_SYSTEM: join(TMPFIX, '.gitconfig') })
  const G = (args) => spawnSync('git', ['-C', TMPFIX, ...args], gitOpts(env))
  if (G(['init', '-q', '-b', 'main']).status !== 0) {
    bad('C9b. 夹具仓可 init', JSON.stringify(G(['init', '-q', '-b', 'main']).stdout))
  }
  // 夹具路径直接用宿主原生形式：本节的机制演示要**再起一个 PowerShell 子进程**去跑同样的命令，
  // 而 `git -C` **不接受 `file://` URL**（实测 `fatal: cannot change to 'file:///…': Invalid argument`
  // —— 那会让两条读数静默变成 0，看起来像"演示失败"）。带空格/盘符的路径在单引号里安全（路径只可能含单引号才会破）。
  const q = TMPFIX
  // ⚠ 夹具**不能靠 `init -b main`**：unborn 分支名在首次提交时才落成引用，而"首次提交前
  // 有一条 `git symbolic-ref` 把 HEAD 显式绑到 main"才是与宿主无关的写法（本节实测踩到过：
  // `init -b` 的效力随宿主调用面而变，HEAD 落到 `master` 后 `origin/main..HEAD` 的两端
  // 各成一个**无关根提交**，计数正确地给出 1 而不是 3 —— 一个看起来像"演示失败"的假红）。
  for (const [i, file] of ['a.txt', 'b.txt', 'c.txt', 'd.txt'].entries()) {
    writeFileSync(join(TMPFIX, file), file + '\n')
    G(['add', file])
    // 身份**显式给**：夹具把 GIT_CONFIG_GLOBAL 指到空文件（不读本机 ~/.gitconfig），
    // 不显式给身份就会被 git 拒掉（`Author identity unknown` → 一次提交都没有，
    // 后面的计数全成了"夹具坏了"的假红）。
    G(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', `fix: ${file}`])
    if (i === 0) G(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  }
  const countHead = G(['rev-list', '--count', 'HEAD'])
  if (countHead.status !== 0 || countHead.stdout.trim() !== '4') {
    bad('C9b. 夹具仓提交可达性', `rev-list --count HEAD → ${JSON.stringify(countHead.stdout)}（期望 "4"）`)
  }
  const base = G(['rev-list', '--max-parents=0', 'HEAD']).stdout.trim()
  // 把夹具伪装成"本地领先远端 3 笔"：远端 ref 指向第 1 笔（真实批状态文件面对的同形输入）。
  G(['update-ref', 'refs/remotes/origin/main', base])

  const count = G([...COUNT_CMD, `origin/main..HEAD`])
  const fixtureActual = count.stdout.trim()
  const fixtureActualNum = Number(fixtureActual)
  if (fixtureActual !== '3') {
    bad('C9b. 夹具仓可造「本地领先远端 3 笔」', `rev-list 实测 ${JSON.stringify(fixtureActual)}（期望 "3"）—— 夹具不成立，演示无效`)
  } else {
    ok('C9b-1. 夹具仓自身可信（Impure 夹具：真 git，本地领先 origin/main 3 笔）', `rev-list --count → ${fixtureActual}`)

    // ── 真正要钉的那条事实：**度量面依赖宿主 shell**，而错法朝向危险侧 ──────────────
    // 两条命令与 handoff 配方**同形**（`git log origin/main..HEAD --oneline | Measure-Object…`），
    // 只把工具面换成夹具的 git —— cwd 与"调用方仓库"都与我无关，读数是**结构**而不是本机 git 状态。
    //
    // ⚠ 探针**不得**再写 `$env:GIT_DIR=''`（Standards 轴 D-4 实测）：pwsh 会把**空串**真的导出给
    // 子进程 → 夹具 git 收到 `GIT_DIR=''` → `fatal: not a git repository`（exit 128），于是
    // "宿主跑得动"的判定被探针自己打挂、pwsh 被静默剔除（而它可能正是能复现场景的那个宿主）。
    // 守卫本就用 `git -C <dir>` 指定仓，**不需要**清 GIT_DIR（spawnSync 也不继承调用方的该变量）。
    const EXES = [['PowerShell 7', 'pwsh'], ['Windows PowerShell', 'powershell']]
    const PWSH_A = `(git -C '${q}' log origin/main..HEAD --oneline | Measure-Object).Count`
    const PWSH_L = `(git -C '${q}' log origin/main..HEAD --oneline | Measure-Object -Line).Lines`
    // `-InputObject` 形态：把同一份输出作为**单个参数**交给 Measure-Object（不是逐行送管道）。
    // 复核独立实测（Spec 轴）：它**恒报 1**（3 笔报 1、8 笔仍报 1）—— 比默认形态更顽固，
    // 且与默认形态**同向**（朝向"把 ≥5 读成 1"的危险侧）。这是契约要钉的那个机制里
    // **可稳定复现**的那一支（默认形态随宿主是否折叠而变化，这一支不随）。
    const PWSH_I = `(Measure-Object -InputObject (git -C '${q}' log origin/main..HEAD --oneline)).Count`
    const probe = (exe) => {
      const a = spawnSync(exe, ['-NoProfile', '-Command', PWSH_A], { encoding: 'utf8' })
      const l = spawnSync(exe, ['-NoProfile', '-Command', PWSH_L], { encoding: 'utf8' })
      const io = spawnSync(exe, ['-NoProfile', '-Command', PWSH_I], { encoding: 'utf8' })
      return {
        a: (a.stdout ?? '').trim(), l: (l.stdout ?? '').trim(), io: (io.stdout ?? '').trim(),
        aNum: Number((a.stdout ?? '').trim()), lNum: Number((l.stdout ?? '').trim()), ioNum: Number((io.stdout ?? '').trim()),
        err: (a.stderr ?? '').trim() + (l.stderr ?? '').trim(),
      }
    }
    /** 两条读数都是**数字**才算宿主跑得动（0/'' 是命令根本没跑成的形态，不是机制读数）。 */
    const ran = (r) => /^\d+$/.test(r.a) && /^\d+$/.test(r.l) && r.a !== '0' && r.l !== '0'
    const probes = EXES.map(([name, exe]) => ({ name, ...probe(exe) }))
    const usable = probes.filter(p => ran(p))
    if (usable.length === 0) {
      console.log('  ⚠ C9b SKIP (loud). 没有可用的 PowerShell 宿主 —— 计数面演示未验证：' +
        `本机读数 ${probes.map(p => `${p.name}: Count=${JSON.stringify(p.a)}`).join(' / ')}；不猜、不报假绿`)
      // 宿主缺席是**环境侧**的事（Linux/CI 上两个名字本就不存在）—— 归 loud SKIP，**不报红**。
      // （初版在这里对 CommandNotFound 报 bad，实测会在 Linux 上**必然假红** —— Standards 轴 D-4。）
    } else {
      const shots = usable.map(p => `${p.name}: 默认 Count=${p.aNum} / -Line=${p.lNum} / -InputObject=${p.ioNum}`).join(' ｜ ')
      // **可稳定复现的那一支**：`-InputObject` 恒报 1，而真值（`rev-list`）是 3。
      // 这一条**必须绿**——它不依赖"宿主是否把多行折叠"（那个随宿主变，见下），
      // 且它正是契约要防的那个方向（1 < 3：把 ≥5 笔读成 1 笔）。⚠ #119 起护栏读**票数**，
      // 所以这条错法的影响面是「未推送清单本身」与批末 push 的输入（C9-live 会对账），
      // **不再**是"绕过护栏"——那句是 #115 时代（护栏当时读笔数）的形态，别写回来。
      const ioWrong = usable.find(p => p.ioNum === 1 && fixtureActualNum > 1)
      const differ = usable.find(p => p.aNum === 1 && p.lNum === fixtureActualNum)
      const agree = usable.filter(p => p.aNum === fixtureActualNum && p.lNum === fixtureActualNum)
      if (ioWrong !== undefined) {
        ok('C9b-2. 计数机制演示（结构性防线）：同一份 git 输出 —— ' +
          `\`Measure-Object -InputObject\` 恒报 **1**，而 \`rev-list --count\` 报 **${fixtureActualNum}**`,
          `逐宿主读数：${shots} —— 1 < ${fixtureActualNum} 正是"把 ≥5 **笔**读成 1 **笔**"的方向` +
          '（失真落在未推送清单与批末 push 输入上；护栏 #119 起读票数，不受影响）；' +
          '（默认形态是否同错随宿主变，故不予断言）')
      } else {
        bad('C9b-2. 计数机制演示失灵（`-InputObject` 未报出 1）',
          `逐宿主读数：${shots} / rev-list=${fixtureActualNum} —— 期望至少一个宿主给出 -InputObject=1；夹具或命令串坏了`)
      }
      if (differ !== undefined) {
        console.log(`  ✓ C9b-3.（附注）默认 \`Measure-Object\` 在 ${differ.name} 下也报 ${differ.aNum}` +
          ' —— 与 `-InputObject` 同向，但随宿主变，故只作观测不作断言')
      } else if (agree.length === usable.length) {
        warn('C9b-3. 默认 `Measure-Object` 本宿主**复现不出现场**（也报同数）—— 观测项，不作断言',
          `逐宿主读数：${shots} / rev-list=${fixtureActualNum} —— 默认形态是否折叠随宿主变，` +
          '契约钉的是**命令白名单**（`rev-list --count`），可稳定复现的错法由 C9b-2 用 `-InputObject` 钉')
      }
    }
  }
} catch (error) {
  bad('C9b. 计数机制演示夹具可运行', String(error?.message ?? error))
} finally {
  rmSync(TMPFIX, { recursive: true, force: true, maxRetries: 3 })
}

// ── C9c: **取数命令契约**必须真的在**契约节内**（#115 AC「钉死取数命令 + 写明为何」）─────
// 为什么单列一条：C9 只对账**数字**、C9b 只演示**机制**，两者都不会因为"契约整节被删掉"
// 而变红。于是"契约存在"必须有自己的断言——缺了它，本票的契约面就是**没被守着的**。
//
// ⚠ 第 1 轮复核实测（Standards 轴 D-3）：本断言最初在**整篇文档**上匹配，实测 4 条判据
// 收成 1 条 —— 删掉整个契约节只有「理由」一条红，另三条被**节外**的模板行 / 字段表行满足；
// 更糟的是把节内命令规则松成「`Measure-Object` 也行」，**C9c 全绿**（锁是空的）。
// ⇒ 修法不是"把正则写紧"，而是**收窄匹配域**：先切出契约节，再在节内匹配（D15：换防线形态）。
// `headingSection` 的约定（`## ` 起、下一个同级/更高级标题止）这里兑现到文档面。
const CONTRACT_SECTION = headingSection(DOC, '取数命令契约')
if (CONTRACT_SECTION === null) {
  bad('C9c. 文档里有 `## 取数命令契约` 一节', '找不到该节 —— 契约的**载体**不在了（判据无从谈起）')
} else {
  const CONTRACT_POINTS = [
    ['命令原文：`git rev-list --count`（唯一许可）', /git rev-list --count/],
    ['理由：`Measure-Object` 一族**逐对象**计数（不是逐行）', /逐\s*\*\*对象\*\*计数|逐对象计数/],
    ['为何贵：把 ≥5 **笔**读成 1 笔 → 未推送清单失真，且 C9-live **只报不阻断**',
      /未推送清单[\s\S]{0,60}不阻断|只报不阻断[\s\S]{0,60}未推送清单/],
    ['命令白名单被测例钉住（只许 / 一律用）', /只许|一律用/],
  ]
  const missingContract = CONTRACT_POINTS.filter(([, re]) => !re.test(CONTRACT_SECTION)).map(([n]) => n)
  if (missingContract.length === 0)
    ok('C9c. 取数命令契约在场且**在契约节内**（命令 + 为何 + 危险侧同现）',
      `${CONTRACT_POINTS.length} 条判据 / 节内 ${CONTRACT_SECTION.split('\n').length} 行`)
  else bad('C9c. 取数命令契约缺失/被削弱（判据只认**节内**命中）',
    `节内缺: ${missingContract.join(' / ')}`)
}

// 缝生效过就**在汇总区**再喊一行：C9 的这一轮读数含伪造成分，别当成"验过了"（D47 响亮口径）。
if (seamUsed) {
  console.log('  ⚠ C9-SEAM (loud). DSH_MATT_BATCHSTATE_COUNT 生效过 —— 本轮 C9-live 的"实测"值' +
    '**不是真 git 读数**；生产 / 批末对账请在不设该变量的环境下重跑')
}
// 设了 COUNT 却没给 ACK → 缝被忽略（双变量门）。**响亮**告知，不静默丢弃。
if (seamIgnored) {
  console.log('  ⚠ C9-SEAM (loud). 检测到 DSH_MATT_BATCHSTATE_COUNT，但未设 ' +
    'DSH_MATT_BATCHSTATE_SEAM_ACK=1 —— 缝**未生效**，C9-live 走的是真 git（这是有意设的门，' +
    '防残留变量造成假绿）；要开缝请把两个变量一起设')
}

report('BATCH-STATE VERIFY (C1–C9)')