/**
 * verify-perturbation-recipe.mjs —— 「扰动配方真能跑出真红」的守卫（P1–P5）。
 *
 * 为什么存在（retro 2026-10-17 候选 5，#71 会话）：本仓把「新增断言必须非空洞、扰动要打在
 * 运行时真正读的那份上」写成硬约束（`docs/code-review-brief.md` §2），但**没有任何守卫验证
 * 那条配方本身能不能跑通**。#71 会话实测踩到：`tests/verify-enforcer.mjs` 头注给了一份
 * 「复制插件 → 改副本 → 跑本文件对副本」的配方，而 `tests/preset-harness.mjs` **自己解析并挂载**
 * 插件路径（`ENFORCER_PLUGIN`），**照那份配方做只会得到假绿** —— 被挂载的仍是未扰动的真模块，
 * 于是每条行为断言都读不到扰动，全绿收场。这类「守卫的元层无人检查」是 review 轴每次都要人肉
 * 重做的事；本用例把它机械化。
 *
 * 判据（关键）：不是"头注里写了配方"（那是文档措辞，改字就红/就绿，属同义反复），而是
 * **把配方真的跑一遍**：
 *   1. 取当前 `workflow-enforcer.mjs` 的副本，在副本上做**最小扰动**（把 push 判定放宽成
 *      #79 之前的整串子串形态）；
 *   2. 用 `DSH_MATT_ENFORCER` 指向副本，跑**真实的** `tests/verify-enforcer.mjs`；
 *   3. 断言它**真的变红**，且红的正是那几条非空洞负例（V30a/V30c/V30e 一类）；
 *   4. 清掉变量跑一次，断言**恢复全绿**。
 *
 * 非空洞性：把 `DSH_MATT_ENFORCER` 覆写这一环去掉（即回到"只改测试文件 import"的旧配方）
 * P3/P4 必红 —— 那正是 #71 会话实测到的假绿形态（见 P2 的对照断言）。扰动全程只发生在
 * 系统临时目录，**提交树永不成为扰动态**（`docs/code-review-brief.md` §2：「标记死了才叫实验」）；
 * 也不在 `tests/` 下留任何副本（否则会被 `verify-all` 的 `tests/*.mjs` 扫描当用例跑）。
 *
 * 成本：本用例要跑三次完整 enforcer 套件（~0.8s/次），故只在**配方守卫**这一条上花；它守的
 * 是"所有其它扰动取证可信"这个前提，值得。
 *
 * 本用例自身的非空洞取证（实测记录）：把 `tests/preset-harness.mjs` 的覆写分支停用
 * （即退回"只改测试 import"的旧配方）→ **P4 变红，报 `exit=0`** —— 正是 #71 会话那次假绿的
 * 形态（扰动后套件照样全绿）。还原后逐字节一致、P4 恢复绿。P6 是措辞检查（改字可骗），
 * 故非空洞性只由 P4/P5 承担，已在断言名里标明。
 *
 * ── 还原纪律（**#108**；配方最后一步"还原"的硬约束）────────────────────────────────
 *
 * **还原一律用「副本回写」：扰动前 `cp <path> <backup>`，还原时 `cp <backup> <path>`。**
 * **禁用 `git checkout -- <path>` / `git restore <path>` 作为还原手段。**
 *
 * 为什么是**禁用**而不是"尽量别用"——**未提交工作没有 git 级副本**：
 *
 *   · `git checkout -- <path>` 是从 **index** 回填工作树。对 **tracked 且改动未 staged** 的
 *     文件，index == HEAD，于是它把工作树**静默**打回 **HEAD**，而那份未提交的改写版
 *     **从未进过任何 git 对象** —— 打回即永久丢失，没有任何命令能找回来。
 *   · **哈希不能替代副本**：SHA256 是**单向**的，它证明"内容变了"，**不承载"变回什么"**。
 *     事故当时正是"算了 SHA256 但没留副本" → 知道丢了哪一版，却恢复不出那一版。
 *     **唯一可恢复的载体是副本。**
 *   · 本仓批内**逐票本地提交**（D31），"文件已改但尚未提交"是**长期存在**的正常窗口，
 *     所以这不是边角情况，而是取证手法的**常态处境**。
 *
 * **已发生的真实事故**（本票来源）：teammate 扰动取证后用 `git checkout --` 还原，把已验证的
 * **436 行改写版打回 274 行 HEAD 旧版**（该改写版从未 `git add`/`commit`，工作树副本是其唯一
 * 载体）；同族事故在本仓已多次（跨会话 retro 聚合记为 3/3 复发）。
 *
 * **危险窗口的准确边界**（2026-10-18 实测，见 `tests/verify-restore-discipline.mjs` R3；
 * 注意此处**比 #108 票面的措辞更窄**——票面把 untracked 也算进危险支，实测不成立）：
 *
 *   | 被扰动文件的状态        | `git checkout -- <path>`            | 未提交工作 |
 *   |------------------------|-------------------------------------|-----------|
 *   | tracked + **unstaged** | exit 0，内容**静默**变回 HEAD      | **丢失** ← 唯一的危险支 |
 *   | tracked + **staged**   | exit 0，回填的是**我的暂存版**      | 保住（index 里有副本） |
 *   | **untracked**          | exit **1**（`pathspec … did not match`） | 保住（git 不认它） |
 *
 * ⇒ 判据不是"文件没提交就危险"，而是"**tracked 且改动只在 unstaged 面**才危险"。
 * 但**纪律不按状态分档**：无论哪一支，还原都只用副本回写 —— 状态是会变的（一个 `git add`
 * 就换了支），把安全性寄托在"此刻恰好 staged"上是把纪律建在易变前提上。
 *
 * **守卫**：`tests/verify-restore-discipline.mjs`（R0–R7）把上表**逐态**跑出来（Impure 夹具仓，
 * 真 git，落 `os.tmpdir()`），并做**对照组**（副本回写保住同一份工作）与**哈希反模式**复刻；
 * 本文件另加 **P7** 钉住上面这段口径**在场**（措辞面，非空洞性由该用例 R3/R4 承担）。
 */
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
const ENFORCER = join(REPO, 'workflow-enforcer.mjs')
const ENFORCER_TEST = join(REPO, 'tests', 'verify-enforcer.mjs')

/** 跑真实 enforcer 套件；返回 { status, out }。`override` 非空时经 `DSH_MATT_ENFORCER` 指向它。 */
function runEnforcerSuite(override) {
  const env = { ...process.env }
  // 本用例自己可能跑在 pre-commit 钩子下（verify-all 就在钩子里）——剥掉继承来的
  // DSH_MATT_ENFORCER，避免外层扰动泄漏进这里的对照组。
  if (override === undefined) delete env.DSH_MATT_ENFORCER
  else env.DSH_MATT_ENFORCER = override
  const r = spawnSync(process.execPath, [ENFORCER_TEST], { cwd: REPO, encoding: 'utf8', env })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** 失败的用例编号（`✗ V30a. …` → `V30a`）。 */
const redIds = (out) => [...out.matchAll(/✗\s+([A-Za-z0-9]+)\./g)].map(m => m[1])

// ── P1: 配方所依赖的覆写点真的存在（读挂具源码，不读头注措辞）。
// 这是"配方的前提"而非"配方的措辞"：harness 必须自己解析插件路径并可被覆写，
// 否则「扰动打在运行时真正读的那份上」在机制上不可能。
const harness = await readFile(join(REPO, 'tests', 'preset-harness.mjs'), 'utf8')
const hasOverride = /DSH_MATT_ENFORCER/.test(harness) && /export const ENFORCER_PLUGIN/.test(harness)
const mountsIt = /ENFORCER_PLUGIN/.test(harness)
if (hasOverride && mountsIt) ok('P1. harness 暴露 ENFORCER_PLUGIN 覆写点且真的挂载它（配方前提成立）')
else bad('P1. 覆写点缺失', `DSH_MATT_ENFORCER=${hasOverride} | ENFORCER_PLUGIN 被挂载=${mountsIt}`)

// ── P2: 不设覆写 → 基线全绿（否则下面的"变红"无从归因）。
const base = runEnforcerSuite(undefined)
const baseRed = redIds(base.out)
if (base.status === 0 && baseRed.length === 0) ok('P2. 未扰动基线全绿（对照组）')
else bad('P2. 基线非绿，扰动结论不可归因', `exit=${base.status} red=${baseRed.join(',') || '—'}`)

// ── P3: 按配方做副本 + 最小扰动，并先做 needle 自检（brief §2 硬约束①）。
// 副本位置**必须**在仓内可达 `node_modules` 的路径下（配方的 `.scratch/`）：插件 `import 'yaml'`，
// 放在系统临时目录会 `ERR_MODULE_NOT_FOUND` 而以 "never started" 挂载失败 —— 那是**无效扰动**
// （红得不是判据），不是"配方跑通"。#71 会话实测踩过这一脚。
const SCRATCH = join(REPO, '.scratch', 'perturb')
if (existsSync(join(REPO, '.gitignore'))) ok('P3pre. 扰动副本放在仓内 `.scratch/`（插件 import 可达 node_modules）')
else bad('P3pre. 仓根 .gitignore 缺席', REPO)

const root = SCRATCH
const copy = join(root, 'enforcer-perturbed.mjs')
await mkdir(root, { recursive: true })
try {
  // ── P3: 按配方做副本 + 最小扰动，并先做 needle 自检（brief §2 硬约束①）。
  const src = await readFile(ENFORCER, 'utf8')
  const ANCHOR_FALLBACK = 'function actionSurface(call) {'
  const ANCHOR_MATCH = 'function matchesSurface(gate, surface) {'
  const hits = [ANCHOR_FALLBACK, ANCHOR_MATCH].map(a => src.split(a).length - 1)
  if (hits.every(h => h > 0)) ok('P3a. needle 自检：两个扰动锚点命中数 > 0', hits.join(' / '))
  else bad('P3a. needle 未命中 = 假证据（不是"没漂移"）', `hits=${hits.join(' / ')}`)

  // 扰动形态 = #79 之前的 bug：动作面无声明时退回整串 JSON 子串匹配。
  const perturbed = src
    .replace(ANCHOR_FALLBACK, [
      'function actionSurface(call) {',
      "  { const blob = JSON.stringify({ name: call?.name, arguments: call?.arguments })",
      "    if (typeof blob === 'string') return { display: blob.slice(0, 120), __blob: blob, segments: [{ primary: [blob], chain: [blob], command: blob }] } }",
    ].join('\n'))
    .replace(ANCHOR_MATCH, [
      'function matchesSurface(gate, surface) {',
      '  if (surface !== null && typeof surface.__blob === \'string\') {',
      "    return surface.__blob.toLowerCase().includes(String(gate).trim().toLowerCase()) }",
    ].join('\n'))
  const mutated = perturbed !== src && perturbed.includes('__blob')
  if (mutated) ok('P3b. 副本扰动已生效（__blob 兜底已注入）')
  else bad('P3b. 扰动未生效（替换静默失败）', 'perturbed === src 或 __blob 缺席')

  await writeFile(copy, perturbed)

  // ── P4: 经覆写跑真实套件 → 必须真红，且红在非空洞负例上。
  // 对照 #71 会话实测的假绿形态：只改测试文件 import（不设覆写）时套件全绿。
  const pert = runEnforcerSuite(copy)
  const pertRed = redIds(pert.out)
  const nonVacuous = ['V30a', 'V30c', 'V30e'].filter(id => pertRed.includes(id))
  if (pert.status !== 0 && nonVacuous.length === 3)
    ok('P4. 配方真能跑出真红 —— 覆盖 V30a / V30c / V30e 三条非空洞负例', `red=${pertRed.length} 条`)
  else bad('P4. 配方跑不出真红（假证据）', `exit=${pert.status} | V30a/c/e 命中 ${nonVacuous.join(',') || '—'} | red=${pertRed.slice(0, 8).join(',') || '—'}`)

  // ── P5: 摘掉覆写 → 恢复全绿。证明"变红"确由覆写指向的那份造成，
  // 而不是本用例在别处留下了全局副作用。
  const restored = runEnforcerSuite(undefined)
  if (restored.status === 0 && redIds(restored.out).length === 0)
    ok('P5. 摘掉覆写后恢复全绿（变红可归因于覆写，无全局副作用）')
  else bad('P5. 摘掉覆写未恢复', `exit=${restored.status} red=${redIds(restored.out).join(',') || '—'}`)

  // ── P5b: 提交树从未被扰动（扰动只住临时副本）。
  const now = await readFile(ENFORCER, 'utf8')
  if (now === src) ok('P5b. workflow-enforcer.mjs 逐字节未变（扰动只住临时副本）')
  else bad('P5b. 提交树被扰动污染', 'workflow-enforcer.mjs 与读取时不一致')
} finally {
  // 清掉副本本身（只删这个文件，不动 `.scratch/` 下别人的东西）。
  await rm(copy, { force: true }).catch(() => {})
}

// P5c: 副本文件真的清掉了（不留扰动残骸）。
if (!existsSync(copy)) ok('P5c. 扰动副本已清理（不留残骸）')
else bad('P5c. 扰动副本残留', copy)

// P6: 配方文档指向覆写。**这一条是措辞检查，不是非空洞断言** —— 它防的是"头注被改回
// 只改 import 的旧配方"（#71 会话实测的假绿形态），但改一个字就能骗过它。真正的非空洞
// 判据在上面 P4/P5：配方**跑不跑得出真红**由机械执行证明，与文档怎么写无关。
// 明确标注这条的性质，免得后人把它的绿灯读成"配方已被验证"。
// ⚠ **实测抓到的判据错位**（本轮，记下别再犯）：P6/P7 读"头注"时用的是 `ENFORCER_TEST`
// —— 那是 **`tests/verify-enforcer.mjs`**，**不是本文件**。P6 之所以看起来在守，纯属巧合：
// 两个文件都提到 `DSH_MATT_ENFORCER`，于是它**从未真正检查过背离它的那份配方**。
// 这正是本仓 §3.1「守卫空转」的一种形态：判据读错了输入事实，绿灯不承载它声称的语义。
// 修法：头注一律从 `import.meta.url` 取**本文件**（配方就写在下面那段块注释里）。
const SELF = fileURLToPath(import.meta.url)
const RECIPE_SRC = await readFile(SELF, 'utf8')
// P6 读"头注"的一窗口（配方措辞在这 90 行里）；P7 的还原纪律口径**更靠后**，
// 故 P7 单独扫**整段块注释**——两个判据的匹配域不同是有意的：P6 钉的是"配方开头那段"，
// P7 钉的是"头注里有没有这条口径"（位置不敏感）。用同一个窗口会让后加的口径静默漏判。
const header = RECIPE_SRC.split('\n').slice(0, 90).join('\n')
if (header.includes('DSH_MATT_ENFORCER'))
  ok('P6. 头注配方使用覆写（措辞检查；非空洞性由 P4/P5 承担）')
else bad('P6. 头注配方未使用覆写（照做会得到假绿，#71 会话实测）', '配方应经 DSH_MATT_ENFORCER 指向副本')

// ── P7: **还原纪律口径在场**（#108 AC1/AC2：「口径落地」+「断言面能证明它在场，不是只有注释」）
// 判据 = 头注里**同现**四件事：禁令（checkout/restore 不得作还原手段）、前提（未提交工作没有
// git 级副本）、**哈希不能替代副本**、以及合规手法（副本回写）。
//
// ⚠ 性质**同 P6**：这是**措辞面**的在场面检查（改字可骗），**不是**"纪律已被验证"——
//   #108 的 AC 明文点破了这一点（"注释里的规则没有守卫时会被静默改回"，本仓 §3.1）。
//   真正的非空洞证据在 **`tests/verify-restore-discipline.mjs`**：它把 `git checkout --` 的
//   三态语义用**真 git 夹具仓跑一遍**（R3/R4/R5），并与副本回写做对照。故本条的绿灯只说明
//   "口径还写在那里"，说明不了"照做就能保住工作"——**别把这条的绿灯读成验证过**。
//   之所以仍要它：口径**整体被删掉**时，R0–R7 那一边不会红（它读的是同一个头注）——
//   需要一个钉在**配方本身**的在场断言，否则"口径落地"这条 AC 无人守（D8：治理措施会退化）。
const RESTORE_POINTS = [
  // ⚠ 判据写法的一处**实测教训**（本轮抓到，记下）：初版写 `禁用\s*`git checkout --``，
  // 实测**恒红**——头注里那两处之间夹着 markdown 标记（`**禁用 \`git …`），
  // "禁用"与短语**并不相邻**。判据于是变成"追**排版间距**"而不是"追**语义在场**"。
  // 修法：锚在**短语本身**（禁令的语义载体），不锚它与动词的排版相邻——
  // 同 #79 废掉子串匹配、C9c 收窄匹配域的教训：判据要钉**语义**，别追**排版**。
  //
  // ⚠ **第 2 轮复核实测报出的一处不一致（本轮修）**：上面那条 `git checkout --` 是**语义判据**
  // （短语 + 禁令动词），而 `git restore` 那条初版却是**裸词** `/`git restore/` —— 同一张判据表里
  // 两种强度。当时"看起来在守"纯属幸运：整个块注释域内 `git restore` **只出现 1 次**（那处正是禁令）。
  // 依赖"该词恰好只出现一次"是**易变前提**（下次有人在叙述里提一句 restore 就失效），
  // 故把 restore 那条**对齐 `git checkout --` 的语义判据形态**——不是把门放松，而是钉同一件事。
  // （`tests/verify-restore-discipline.mjs` 的 R0 跑的是同一条收窄后的形态；两处一致。）
  ['禁令：`git checkout --` 不得作还原手段（短语在场 + 有禁令动词）',
    /`git checkout --`[\s\S]{0,40}(不得|禁用|禁)\s*作|(禁用|不得|禁)\s*[^\n]{0,20}`git checkout --/],
  ['禁令：`git restore` 不得作还原手段（同 `git checkout --` 的语义判据，非裸词）',
    /禁用[\s\S]{0,120}`git restore|`git restore[\s\S]{0,120}(作为还原手段|不得作还原|禁用作还原)/],
  ['前提：未提交工作**没有 git 级副本**', /没有\s*git\s*级副本/],
  ['前提：**哈希不能替代副本**（只证"变了"，不承载"变回什么"）', /哈希不能替代副本/],
  ['合规手法：还原一律用**副本回写**', /副本回写/],
]
// 匹配域 = **整段块注释头注**（文件开头 `/** … */`），不设行窗口——口径的位置不该影响判据，
// 而一个会随行数漂移的窗口正是"守卫静默空转"的常见成因（#115 C9c 的教训：收窄要收在**语义域**
// 上，不是收在一个恰好够用的行数上）。
const restoreScope = RECIPE_SRC.slice(0, RECIPE_SRC.indexOf('*/') + 2)
const missedRestore = RESTORE_POINTS.filter(([, re]) => !re.test(restoreScope)).map(([n]) => n)
if (missedRestore.length === 0)
  ok('P7. 头注含还原纪律口径（禁令 + 前提 + 哈希≠副本 + 副本回写）',
    `${RESTORE_POINTS.length} 条判据（措辞检查；机制证据在 tests/verify-restore-discipline.mjs R3/R4/R5）`)
else bad('P7. 还原纪律口径缺失（#108 AC1：口径落地）', `头注缺: ${missedRestore.join(' / ')}`)

console.log('\n=== PERTURBATION-RECIPE VERIFY (P1–P7) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)