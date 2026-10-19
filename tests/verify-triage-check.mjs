/**
 * verify-triage-check.mjs —— `scripts/triage-check.mjs` 的判据自检（#128 / 折叠自 #102）。
 *
 * 为什么需要这份自检（brief §3.1「守卫」面：判据空转 = 说不出什么输入能让它红）：
 * 「分诊收尾必须冲突归零」是一句散文，散文**不会红**。这里把它的机械面变成可判的，
 * 再喂**伪装输入**证明它真的会红——尤其 #128 AC7 点名的那个反例：
 * **票面含待决项（「草案，实现时可微调」）却标了 RFA**，分诊收尾清单必须红。
 *
 * 判据面四件套（与 `docs/agents/issue-tracker.md`「分诊产出前置项」逐字同源）：
 *   T1 慨词黑名单（机械面）：命中即红，且点名命中的词；
 *   T2 RFA 的四类核对：缺任一类即红，缺哪类说哪类；T2b/T2c RFA 互斥面
 *      （自认「要 human 决定 / 实现时再定」→ 标了 RFA 就红，非 RFA 不判）；
 *   T3 **清单只准有一份**：文档里的两张词表与代码的 `BLACKLIST` / `PENDING_DECISION`
 *      必须逐词相等（brief §3.1 问句①的机械版）；T9 再钉住**模型真读到的两份正文**
 *      只指向、不复制（第 1 轮复核实测：复制的那两份已经漂移）。
 * 另加 T5：**不是"全红判据"**——干净票面 / 非 RFA 票面必须绿（否则它只是恒红噪声）。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLACKLIST, CONFLICT_FACES, HUMAN_JUDGED, PENDING_DECISION, checkTicketBody, render } from '../scripts/triage-check.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = resolve(REPO, 'scripts/triage-check.mjs')
const DOC = readFileSync(resolve(REPO, 'docs/agents/issue-tracker.md'), 'utf8').replace(/\r\n/g, '\n')
/** 两份**模型真读到**的正文（profile 的 skeleton 与 minimal 压缩版）。 */
const MODEL_TEXTS = {
  'workflow-body.txt': readFileSync(resolve(REPO, 'workflow-body.txt'), 'utf8').replace(/\r\n/g, '\n'),
  'workflow-profile-minimal.txt': readFileSync(resolve(REPO, 'workflow-profile-minimal.txt'), 'utf8').replace(/\r\n/g, '\n'),
}

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

// ── 夹具：干净 RFA 票面（四类都在、无黑名单词）────────────────────────────────
const CLEAN_RFA = `## 背景
某某流程在批内反复停下来问人。

## 冲突核对
- ① 票面内部：AC 互不互斥，算术可行。
- ② 票面 vs 实测：已重测（一条命令 + 读数）。
- ③ 文档 vs 实测：\`git grep\` 逐条判「仍成立」。
- ④ 票级：与同批成员无写域交叉。

## AC
- [ ] 某条可判的断言
`

// ── 夹具：#128 AC7 的反例 —— 含待决项却标 RFA ────────────────────────────────
const COUNTEREXAMPLE = `## 背景
brief 称 \`sandcastle-e2e\`「只读调用方仓」。

## 显示名（草案，实现时可微调）
preset.yml（单份显示元数据）按新形态拆分或收敛。

## AC
- [ ] 建出四个档位的显示名
`

// ── T1: 措辞黑名单真的会红（并且点名命中的词）───────────────────────────────
{
  const r = checkTicketBody({ text: COUNTEREXAMPLE, rfa: true })
  const named = ['草案', '可微调'].every(t => r.findings.join(' ').includes(t))
  if (!r.pass && named) ok('T1. 含推诿措辞的票面 —— 判据红且点名命中的词', `findings=${r.findings.length}`)
  else bad('T1. 推诿措辞未拦住', JSON.stringify(r.findings))
}

// ── T2: RFA 缺「四类核对」必须红（缺哪类说哪类）─────────────────────────────
{
  const partial = CLEAN_RFA.replace(/- ③[^\n]*\n/, '')
  const r = checkTicketBody({ text: partial, rfa: true })
  const namesDocFace = r.missingFaces.some(face => face.includes('文档'))
  if (!r.pass && namesDocFace) ok('T2. 标了 RFA 却缺「③ 文档 vs 实测」—— 判据红并点名该面')
  else bad('T2. 四类核对缺口未拦住', JSON.stringify({ pass: r.pass, missing: r.missingFaces }))
}

// ── T2b: 四类核对齐备、但票面**自认**还有待决项 —— 标了 RFA 必须红 ─────────────
// 第 1 轮 Spec 轴实测的反例：只判「四类在场」时，这份票面会绿着通过。
{
  const selfAdmitted = CLEAN_RFA.replace('## AC', '## 待决项\n显示名用 A 还是 B —— 要 human 决定，实现时再定。\n\n## AC')
  const asRfa = checkTicketBody({ text: selfAdmitted, rfa: true })
  const asRfh = checkTicketBody({ text: selfAdmitted, rfa: false })
  if (!asRfa.pass && asRfa.pending.length > 0) ok('T2b. 标 RFA 却自认还有待决项 —— 判据红并点名该句', asRfa.pending.join(' / '))
  else bad('T2b. 自认待决项未拦住（RFA 互斥面空转）', JSON.stringify({ pass: asRfa.pass, pending: asRfa.pending }))
  if (asRfh.pass) ok('T2c. 同一票面在非 RFA 下不判 RFA 互斥面（RFH 票写它是对的）')
  else bad('T2c. 非 RFA 被越界要求', JSON.stringify(asRfh.findings))
}

// ── T3: 清单只准有一份 —— 文档的两张词表 == 代码的两个常量 ────────────────────
/** 文档里某个 `- **<label>**` bullet（含续行）内反引号包着的词。 */
function docList(label) {
  const lines = DOC.split('\n')
  const start = lines.findIndex(t => t.includes(label))
  if (start < 0) return []
  const block = []
  for (let i = start; i < lines.length; i++) {
    if (i > start && (/^\s*[-*]\s/.test(lines[i]) || lines[i].trim() === '')) break
    block.push(lines[i])
  }
  // 词表条目 = 纯词形（中文 / 字母 / 空格）；把同段里的命令路径（`scripts/triage-check.mjs`）剔掉。
  return [...block.join('\n').matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(w => /^[\u4e00-\u9fa5A-Za-z\s]+$/.test(w))
}
{
  const docMachine = docList('**机械面**')
  const codeMachine = BLACKLIST.map(([name]) => name)
  const sameMachine = docMachine.length === codeMachine.length && docMachine.every(w => codeMachine.includes(w))
  if (sameMachine) ok('T3. 文档机械面词表与代码 BLACKLIST 逐词相等（清单只有一份）', codeMachine.join(' / '))
  else bad('T3. 措辞黑名单两处各写一份（已漂移）', `docs=[${docMachine.join(',')}] code=[${codeMachine.join(',')}]`)
  const docPending = docList('**RFA 互斥面**')
  const codePending = PENDING_DECISION.map(([name]) => name)
  const samePending = docPending.length === codePending.length && docPending.every(w => codePending.includes(w))
  if (samePending) ok('T3b. 文档 RFA 互斥面词表与代码 PENDING_DECISION 逐词相等', codePending.join(' / '))
  else bad('T3b. RFA 互斥面两处各写一份（已漂移）', `docs=[${docPending.join(',')}] code=[${codePending.join(',')}]`)
  if (HUMAN_JUDGED.length > 0 && DOC.includes('人判面')) ok('T4. 判不了的那一半被**显式声明**为人判面（不装成覆盖）', HUMAN_JUDGED.join(' / '))
  else bad('T4. 人判面声明缺失', `HUMAN_JUDGED=${HUMAN_JUDGED.length}`)
}

// ── T9: 模型真读到的两份正文**只指向、不复制** ────────────────────────────────
// 第 1 轮复核抓到的真缺陷：正文与 minimal 各自复制了一份黑名单，且**已经漂移**
//（正文缺「时微调」、minimal 缺「酌情 / 时微调」），而 T3 只钉了文档↔代码。这里把
// 另外两张脸也钉死：它们一个词都不许出现 —— 复制一份就红，逼着改单源那份。
// 第 2 轮复核补正：文档曾声称**两张清单**都钉住，实际只钉了 BLACKLIST（假覆盖）。
// 现在两张都钉（T3/T3b 钉文档↔代码，T9 钉正文↔单源）。
{
  const ALL_WORDS = [
    ...BLACKLIST.map(([word]) => word),
    ...PENDING_DECISION.map(([word]) => word),
  ]
  const leakedBy = {}
  for (const [name, text] of Object.entries(MODEL_TEXTS)) {
    const leaked = ALL_WORDS.filter(word => text.includes(word))
    if (leaked.length > 0) leakedBy[name] = leaked
  }
  const names = Object.keys(leakedBy)
  if (names.length === 0) ok('T9. 正文与 minimal 不复制两张清单（只指向单源）', `${Object.keys(MODEL_TEXTS).length} 份文本 / ${ALL_WORDS.length} 词均未出现`)
  else bad('T9. 措辞清单又被复制进正文（复制即漂移）', names.map(n => `${n}: ${leakedBy[n].join('/')}`).join(' | '))
}

// ── T5: 不是"全红判据" —— 干净票面 / 非 RFA 票面必须绿 ───────────────────────
{
  const clean = checkTicketBody({ text: CLEAN_RFA, rfa: true })
  // 非 RFA：无四类核对、无黑名单词 —— 判据不越界要求「四类核对」。
  const nonRfaText = CLEAN_RFA.replace(/## 冲突核对[\s\S]*?## AC/, '## AC')
  const nonRfa = checkTicketBody({ text: nonRfaText, rfa: false })
  if (clean.pass) ok('T5a. 干净 RFA 票面 —— 绿（判据不是恒红噪声）')
  else bad('T5a. 干净票面被误判红', JSON.stringify(clean.findings))
  if (nonRfa.pass && nonRfa.missingFaces.length === 0) ok('T5b. 非 RFA 票面不要求四类核对 —— 只判黑名单（判据面不越界）')
  else bad('T5b. 非 RFA 票面被越界要求', JSON.stringify(nonRfa.findings))
}

// ── T6: 人判面**故意不判** —— 同一串字符在非决策语境里不误伤 ─────────────────
{
  const benign = CLEAN_RFA + '\n实现时可或走 A，或走 B（二选一，已定）。\n建议在注释里说明理由。\n'
  const r = checkTicketBody({ text: benign, rfa: true })
  if (r.pass) ok('T6. 「或 / 建议」在非决策语境不误伤 —— 语境词归人读，工具不装成判了')
  else bad('T6. 语境词被误判成推诿措辞', JSON.stringify(r.findings))
}

// ── T7: CLI 面（文档里写的用法真的可用）─────────────────────────────────────
{
  const good = spawnSync(process.execPath, [SCRIPT, '-', '--rfa'], { input: CLEAN_RFA, encoding: 'utf8' })
  const badRun = spawnSync(process.execPath, [SCRIPT, '-', '--rfa'], { input: COUNTEREXAMPLE, encoding: 'utf8' })
  const usage = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
  if (good.status === 0 && good.stdout.includes('✓')) ok('T7a. CLI（stdin + --rfa）干净票面 → exit 0')
  else bad('T7a. CLI 干净票面', `exit=${good.status} out=${(good.stdout ?? '').slice(0, 200)}`)
  if (badRun.status === 1 && badRun.stdout.includes('✗')) ok('T7b. CLI 反例 → exit 1 + 一行 ✗')
  else bad('T7b. CLI 反例', `exit=${badRun.status} out=${(badRun.stdout ?? '').slice(0, 200)}`)
  if (usage.status === 2) ok('T7c. CLI 缺输入 → exit 2（用法错与"票面不够格"分开）')
  else bad('T7c. CLI 用法错', `exit=${usage.status}`)
}

// ── T8: 渲染面（读数行与判据同源，不另写一份）───────────────────────────────
{
  const green = render(checkTicketBody({ text: CLEAN_RFA, rfa: true }), { rfa: true })
  const red = render(checkTicketBody({ text: COUNTEREXAMPLE, rfa: true }), { rfa: true })
  const faces = CONFLICT_FACES.length
  if (green.includes(`${faces} 类逐类在场`) && red.includes('✗')) ok('T8. 渲染行由同一份判据产出（绿 / 红两形都在）', `${faces} 类`)
  else bad('T8. 渲染面与判据脱节', JSON.stringify({ green: green.slice(0, 120), red: red.slice(0, 120) }))
}

report('TRIAGE-CHECK VERIFY (T1–T9)')