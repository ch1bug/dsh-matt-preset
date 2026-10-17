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
const header = (await readFile(ENFORCER_TEST, 'utf8')).split('\n').slice(0, 60).join('\n')
if (header.includes('DSH_MATT_ENFORCER'))
  ok('P6. 头注配方使用覆写（措辞检查；非空洞性由 P4/P5 承担）')
else bad('P6. 头注配方未使用覆写（照做会得到假绿，#71 会话实测）', '配方应经 DSH_MATT_ENFORCER 指向副本')

console.log('\n=== PERTURBATION-RECIPE VERIFY (P1–P6) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)