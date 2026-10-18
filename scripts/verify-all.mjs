/**
 * verify-all.mjs —— 本仓**唯一**检查入口（retro 2026-10-16 第 1 条）。
 *
 * 为什么存在：本仓不用 GitHub Actions，本地套件即唯一验收通道（CONTEXT 明文），
 * 但此前没有任何一条命令能跑它 —— README 手列 14 条 `node tests/*.mjs`，每个会话
 * 都要重新挑选、并靠记性排除环境依赖项。本脚本固化那份挑选。
 *
 * 用法：node scripts/verify-all.mjs   （等价：pnpm test / npm test）
 * 汇总行尾带 `hooks=<on|off|未设置>`（D47：提交前门禁是每 clone 一次的本地配置，缺席必须响亮；
 * git 不可用时静默不猜、不带该段，且不改 exit code）；失败输出含 `ERR_MODULE_NOT_FOUND` 时
 * 额外给一行指路（`node scripts/link-runtime-deps.mjs`，D47 高危①）。
 * 环境变量（未设置时对应项响亮跳过，不阻塞常规套件）：
 *   DSH_MATT_INSTALLER=1   跑 verify-installer.mjs（store 侧离线实跑；profile-link 断言需本机 dsh）
 *   DSH_MATT_E2E=1         跑 sandcastle-e2e.mjs（需要 podman）
 *   DSH_MATT_LIVE_CLI      live 用例的门禁（见 README「环境侧用例的门禁」）
 *   DSH_MATT_LIVE_HOME     同上（安装/配置/会话环）
 *   DEEPSEEK_API_KEY       真实 LLM 层（或 DSH_MATT_REAL_CREDENTIALS_SOURCE）
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 汇总期的**隔离 home**（2026-10-18 事故硬化）：agent shell / 桌面端常把 `DSH_HOME`
 *  导出成**真实** home，子进程会原样继承；某个用例一旦漏写自己的隔离 home，清理动作就
 *  会落到真实 home 上（事故现场正是这种继承 + 一条按 `$env:DSH_HOME` 展开的递归删除）。
 *  这里统一把子进程的 `DSH_HOME` 换成本次汇总的临时目录——用例自己的 `mkdtemp` 覆盖仍是
 *  首选，本行只是兜底：漏写最多写进垃圾箱。用完即删（成功失败都删）。 */
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), 'dsh-matt-verify-all-'))
const childEnv = { ...process.env, DSH_HOME: ISOLATED_HOME }
// #115 复核（Standards 轴 D-2）：`verify-batch-state.mjs` 的 C9 有一条**测试缝**
// （`DSH_MATT_BATCHSTATE_COUNT` / `_BRANCH`，扰动用例专用）。它会替换"取数命令的读数"这个
// **判据输入事实本身**，所以残留（父 shell 泄漏 / CI 误设 / 调试后忘清）会让 C9 报绿而真 git
// 没跑 —— D47「防线缺席必须响亮」点名的静默通过形态。汇总层在这里**主动清掉**，
// 汇总跑的就是真读数；扰动用例自己设（且必须带 `_SEAM_ACK=1` 双变量门）。
for (const k of ['DSH_MATT_BATCHSTATE_COUNT', 'DSH_MATT_BATCHSTATE_BRANCH', 'DSH_MATT_BATCHSTATE_SEAM_ACK']) {
  delete childEnv[k]
}

/** 非用例文件（共享挂具）与需要外部环境、默认跳过的用例。
 *  `why` 口径（retro 2026-10-16）：写清这门禁**挡住哪条链 / 哪半边**——缺环境时读者才知道
 *  暗掉的是什么（#67 会话里 `SKIP verify-installer.mjs` 一行看不出 installer→启动→turn 整条链没测）。 */
const NOT_A_TEST = new Set(['preset-harness.mjs'])
const OPT_IN = new Map([
  ['verify-installer.mjs', { flag: 'DSH_MATT_INSTALLER', why: 'installer 用例（store 侧离线可跑；profile-link 断言需本机 dsh）' }],
  ['sandcastle-e2e.mjs', { flag: 'DSH_MATT_E2E', why: 'sandcastle 三命令 e2e（需 podman）' }],
])

const files = readdirSync(join(REPO, 'tests'))
  .filter(f => f.endsWith('.mjs') && !NOT_A_TEST.has(f))
  .sort()

const rows = []
for (const file of files) {
  const optIn = OPT_IN.get(file)
  if (optIn !== undefined && process.env[optIn.flag] !== '1') {
    rows.push({ file, status: 'SKIP', detail: `${optIn.why} —— 设 ${optIn.flag}=1 开启` })
    continue
  }
  const started = Date.now()
  const run = spawnSync(process.execPath, [join(REPO, 'tests', file)], {
    cwd: REPO,
    encoding: 'utf8',
    env: childEnv,
  })
  const ms = Date.now() - started
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  // 用例自己用 SKIP (loud) 声明未验证的部分——如实照搬，不粉饰成通过
  const loud = /SKIP \(loud\)/.test(output)
  rows.push({
    file,
    status: run.status === 0 ? (loud ? 'PASS*' : 'PASS') : 'FAIL',
    detail: run.status === 0 ? `${ms}ms` : `exit ${run.status}`,
    output: run.status === 0 ? undefined : output,
  })
}

// 隔离 home 用完即删（成功失败都删；Windows 上偶有句柄延迟，maxRetries 兜住）。
rmSync(ISOLATED_HOME, { recursive: true, force: true, maxRetries: 3 })

const label = { PASS: 'PASS', 'PASS*': 'PASS*', FAIL: 'FAIL', SKIP: 'SKIP' }
console.log('\n=== verify-all ===')

// 提交前门禁是**每 clone 一次**的本地配置：没配就是静默没有，而套件照样全绿（D47：防线缺席
// 必须响亮）。汇总行带 `hooks=<on|off|未设置>`（git 不可用时**静默不猜**、不带这一段），非 on
// 时再给一行可执行的补救命令 —— 汇总段给状态，advisory 给动作。不改 exit code（与 loud skip 同口径）。
// 先确认"在仓里"：`git config` 在**非仓目录**下也退 1（与"键未设置"不可区分），拿它当判据会把
// "没仓库"说成"钩子未设置"（复核实测：非仓下 `config` exit 1 / `rev-parse` exit 128）。
const inRepoProbe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: REPO, encoding: 'utf8' })
const hooksProbe = spawnSync('git', ['config', 'core.hooksPath'], { cwd: REPO, encoding: 'utf8' })
// `git config <key>`：0 = 取到值、1 = 键**未设置**（正常分支）；其余状态与 spawn 失败同属"git 不可用"
// —— 那时静默不猜，不带这一段。
const gitUsable = inRepoProbe.error === undefined && inRepoProbe.status === 0
  && hooksProbe.error === undefined && (hooksProbe.status === 0 || hooksProbe.status === 1)
const hooksPath = (hooksProbe.stdout ?? '').trim()
// 字面比较：`.githooks` 之外的值都算 off（同义路径如绝对路径宁可响亮，也不静默猜）。
const hooks = !gitUsable ? undefined
  : hooksPath === '.githooks' ? 'on'
  : hooksPath === '' ? '未设置' : 'off'
// "显示什么"只在这里决定一次：off 显示实际值、未设置显示字面词（汇总段用状态词，advisory 用这个）。
const hooksShown = hooks === 'off' ? hooksPath : hooks
if (hooks !== undefined && hooks !== 'on') {
  console.log(`  !! pre-commit 钩子未启用（core.hooksPath = ${hooksShown}）—— 首次 clone 跑一次: git config core.hooksPath .githooks`)
}

for (const r of rows) console.log(`  ${label[r.status].padEnd(6)} ${r.file.padEnd(38)} ${r.detail}`)

const failures = rows.filter(r => r.status === 'FAIL')
for (const f of failures) {
  console.log(`\n--- ${f.file} (${f.detail}) ---`)
  console.log((f.output ?? '').split('\n').slice(-25).join('\n'))
}
// D47 高危①（`<DSH_HOME>` 运行时依赖）：`tests/node_modules` 的 junction 没补齐时用例只能报裸
// `ERR_MODULE_NOT_FOUND` —— 报错不指路，新 clone 会把它读成"套件坏了"。一行指路，不改 exit code。
if (failures.some(f => /ERR_MODULE_NOT_FOUND/.test(f.output ?? ''))) {
  console.log('  !! 运行时依赖缺失（ERR_MODULE_NOT_FOUND）—— 跑一次补齐: node scripts/link-runtime-deps.mjs（docs/dev-environment.md §0.3）')
}

const passed = rows.filter(r => r.status === 'PASS' || r.status === 'PASS*').length
const skipped = rows.filter(r => r.status === 'SKIP').length
const partial = rows.filter(r => r.status === 'PASS*').length
console.log(
  `\n${failures.length === 0 ? 'OK' : 'FAILED'} — ${passed}/${rows.length} 通过` +
    (partial > 0 ? `（其中 ${partial} 项含 loud skip：其环境侧断言未验证）` : '') +
    (skipped > 0 ? `，${skipped} 项因缺环境跳过（见上）` : '') +
    (hooks !== undefined ? `，hooks=${hooks}` : ''),
)
process.exit(failures.length > 0 ? 1 : 0)