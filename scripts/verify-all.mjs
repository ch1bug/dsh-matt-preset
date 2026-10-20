/**
 * verify-all.mjs —— 本仓**唯一**检查入口（retro 2026-10-16 第 1 条）。
 *
 * 为什么存在：本仓不用 GitHub Actions，本地套件即唯一验收通道（CONTEXT 明文），
 * 但此前没有任何一条命令能跑它 —— README 手列 14 条 `node tests/*.mjs`，每个会话
 * 都要重新挑选、并靠记性排除环境依赖项。本脚本固化那份挑选。
 *
 * ── 分层：默认**快集**，`--all` 全量（#129）──────────────────────────────────
 * 为什么分层：全量单跑实测到过 **273.5s**（B 批 #125 会话），贴着外部运行器的 300s 上限；
 * 被截断的那次读数是 `exit=null` + 日志只有标题行 —— "没跑起来"被读成"跑了且失败"
 * （dev-environment §0.2 探针自检第 ③ 条的现场）。分层把**每次提交**的代价压到快集
 * （pre-commit 走默认层），把长跑留给**批末 / 推送前 / 交付前**（`--all`）。
 *
 * `@slow` 标记就是"哪一项归哪一层"的**单一事实源**：写在用例自己的**头部块注释**里，
 * 单起一行 ` * @slow <一句 why + 实测读数>`。本文件**不保存**名单 —— 名单会漂，标记不会
 * （新增慢用例的人在自己的文件里写下它，判据当场生效）。快集里逐行打印 `SLOW`，另有汇总
 * 计数 `N 项 slow 未跑（--all 补全）`：**默认跳过必须响亮**（D47），不静默。
 * 判据只扫**头部块注释**（文件开头那段，直到它的闭合符）：正文里出现 `@slow` 这个词不算标记。
 *
 * 用法：node scripts/verify-all.mjs                 # 快集（默认；pre-commit 用的就是它）
 *       node scripts/verify-all.mjs --all           # 全量（连 @slow 一起跑）
 *       node scripts/verify-all.mjs --timeout=<ms>  # 每项 watchdog（opt-in，默认不设）
 *       （等价别名：pnpm test / npm test —— 走默认快集）
 * 未知参数**响亮失败**（exit 2）：`--al` 这种拼错若被静默忽略，读数是"快集全绿"，而你以为
 * 跑的是全量 —— 这是最难发现的假绿，故不猜。
 *
 * 读数分档（行首 `label`）与退出码：
 *   PASS   用例 exit 0，且没有 loud skip
 *   PASS*  用例 exit 0，但自己打了 `SKIP (loud)`（其环境侧断言未验证）
 *   FAIL   用例 **exit≠0** —— 唯一一种"跑了且断言不过"
 *   NORUN  **没有退出码**（`status === null`：被信号杀掉 / watchdog 超时 / 进程根本起不来）。
 *          ⚠ 与 FAIL **分开读**：`exit=null` 是"没跑完"，不是"断言不过"。以前它被折进
 *          `FAIL`（行里只有 `exit null`），一台被打断的机器看起来像一堆用例坏了
 *   SKIP   环境门禁未开（`OPT_IN`），行里附开启命令
 *   SLOW   快集跳过（`@slow` 用例），行里附 `--all`
 * 退出码：0 = 全绿（含 loud skip / 缺环境跳过 / slow 未跑 —— 三者都在汇总行里显式计数）；
 *        1 = 有 FAIL；2 = 用法错误，或**没有 FAIL 但有 NORUN**（读数不成立 ⇒ 不能算绿）。
 *
 * 汇总行尾带 `hooks=<on|off|未设置>`（D47：提交前门禁是每 clone 一次的本地配置，缺席必须响亮；
 * git 不可用时静默不猜、不带该段，且不改 exit code）；失败输出含 `ERR_MODULE_NOT_FOUND` 时
 * 额外给一行指路（`node scripts/link-runtime-deps.mjs`，D47 高危①）。末段给**本次总耗时**
 * （分层前后的读数就是靠它对的）。
 * 环境变量（未设置时对应项响亮跳过，不阻塞常规套件）：
 *   DSH_MATT_INSTALLER=1   跑 verify-installer.mjs（store 侧离线实跑；profile-link 断言需本机 dsh）
 *   DSH_MATT_E2E=1         跑 sandcastle-e2e.mjs（需要 podman）
 *   DSH_MATT_LIVE_CLI      live 用例的门禁（见 README「环境侧用例的门禁」）
 *   DSH_MATT_LIVE_HOME     同上（安装/配置/会话环）
 *   DEEPSEEK_API_KEY       真实 LLM 层（或 DSH_MATT_REAL_CREDENTIALS_SOURCE）
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── 参数：分层开关 + 每项 watchdog（#129）。未知参数硬失败，见头注。 ──────────────
const USAGE = '用法: node scripts/verify-all.mjs [--all] [--timeout=<毫秒>]'
let runFull = false
let perTestTimeoutMs = null
const unknownArgs = []
for (const arg of process.argv.slice(2)) {
  if (arg === '--all') {
    runFull = true
    continue
  }
  const timeoutArg = /^--timeout=([1-9]\d*)$/.exec(arg)
  if (timeoutArg !== null) {
    perTestTimeoutMs = Number(timeoutArg[1])
    continue
  }
  unknownArgs.push(arg)
}
if (unknownArgs.length > 0) {
  console.error(`verify-all: 不认识的参数 ${unknownArgs.map(a => JSON.stringify(a)).join(' ')}`)
  console.error(`  ${USAGE}`)
  console.error('  拼错的开关若被静默忽略，读数就成了"快集全绿"而你以为跑了全量 —— 故硬失败（exit 2）。')
  process.exit(2)
}

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
const NOT_A_TEST = new Set(['preset-harness.mjs', 'isolated-git.mjs'])
const OPT_IN = new Map([
  ['verify-installer.mjs', { flag: 'DSH_MATT_INSTALLER', why: 'installer 用例（store 侧离线可跑；profile-link 断言需本机 dsh）' }],
  ['sandcastle-e2e.mjs', { flag: 'DSH_MATT_E2E', why: 'sandcastle 三命令 e2e（需 podman）' }],
])

/** 用例的**头部块注释**（文件开头那段，直到它的闭合符）。没有块注释 ⇒ 空串（不参与 slow 判定）。 */
const leadingComment = (file) => {
  const src = readFileSync(join(REPO, 'tests', file), 'utf8')
  const end = src.indexOf('*/')
  return end === -1 ? '' : src.slice(0, end)
}
/** `@slow` 标记 = 头部块注释里**以 `* @slow` 起头**的一行。正文里出现这个词不算标记
 *  （判据自检在 `tests/verify-all-entry.mjs` E13 的反向：把 `'@slow'` 写进用例正文 →
 *  默认跑**必须仍然执行它**，否则"谁引用了这个词谁就被跳过"）。 */
const SLOW_MARKER = /^[ \t]*\*[ \t]*@slow\b/m

const files = readdirSync(join(REPO, 'tests'))
  .filter(f => f.endsWith('.mjs') && !NOT_A_TEST.has(f))
  .sort()

const rows = []
for (const file of files) {
  const optIn = OPT_IN.get(file)
  if (optIn !== undefined && process.env[optIn.flag] !== '1') {
    rows.push({ file, status: 'SKIP', ms: 0, detail: `${optIn.why} —— 设 ${optIn.flag}=1 开启` })
    continue
  }
  // 快集：slow 组跳过，但**响亮**（行 + 汇总计数），不静默
  if (!runFull && SLOW_MARKER.test(leadingComment(file))) {
    rows.push({ file, status: 'SLOW', ms: 0, detail: 'slow 用例（文件头 @slow）—— 快集跳过，全量: --all' })
    continue
  }
  const started = Date.now()
  const run = spawnSync(process.execPath, [join(REPO, 'tests', file)], {
    cwd: REPO,
    encoding: 'utf8',
    env: childEnv,
    // watchdog 只在显式给了 `--timeout=` 时装上（默认不设 ⇒ 与分层前行为一致）
    ...(perTestTimeoutMs === null ? {} : { timeout: perTestTimeoutMs }),
  })
  const ms = Date.now() - started
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  // 用例自己用 SKIP (loud) 声明未验证的部分——如实照搬，不粉饰成通过
  const loud = /SKIP \(loud\)/.test(output)
  if (run.status === 0) {
    rows.push({ file, status: loud ? 'PASS*' : 'PASS', ms, detail: `${ms}ms` })
  } else if (run.status === null) {
    // `status === null` = **没有退出码**：被信号杀（watchdog 超时 / 外部 kill）或根本没起来。
    // 单列一档：它读作"没跑完"，不是"断言不过"（§0.2 第 ③ 条的现场就是这个混淆）。
    rows.push({
      file,
      status: 'NORUN',
      ms,
      detail: `未跑完（${ms}ms；signal=${run.signal ?? '无'}${run.error === undefined ? '' : ` / ${run.error.code ?? run.error.message}`}）—— 不是「用例失败」`,
      output,
    })
  } else {
    rows.push({ file, status: 'FAIL', ms, detail: `exit ${run.status}`, output })
  }
}

// 隔离 home 用完即删（成功失败都删；Windows 上偶有句柄延迟，maxRetries 兜住）。
rmSync(ISOLATED_HOME, { recursive: true, force: true, maxRetries: 3 })

const label = { PASS: 'PASS', 'PASS*': 'PASS*', FAIL: 'FAIL', NORUN: 'NORUN', SKIP: 'SKIP', SLOW: 'SLOW' }
const slowRows = rows.filter(r => r.status === 'SLOW')
console.log(`\n=== verify-all === ${runFull ? '全量（--all）' : '快集（默认）'}`)
if (slowRows.length > 0) {
  // D47：默认跳过必须响亮 —— 一行点名跳到哪几项、以及补全命令
  console.log(`  ⤼ ${slowRows.length} 项 slow 未跑：${slowRows.map(r => r.file).join(' / ')} —— 全量: node scripts/verify-all.mjs --all`)
}

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
// NORUN 单独一节：读者要能一眼看出"这段是没跑完，不是断言不过"
const unreadable = rows.filter(r => r.status === 'NORUN')
for (const n of unreadable) {
  console.log(`\n--- ${n.file} (未跑完：没有退出码) ---`)
  const tail = (n.output ?? '').split('\n').slice(-15).join('\n').trim()
  console.log(tail === '' ? '(无输出 —— 进程未及输出即被信号杀掉 / 未起来)' : tail)
}
// D47 高危①（`<DSH_HOME>` 运行时依赖）：`tests/node_modules` 的 junction 没补齐时用例只能报裸
// `ERR_MODULE_NOT_FOUND` —— 报错不指路，新 clone 会把它读成"套件坏了"。一行指路，不改 exit code。
if (failures.some(f => /ERR_MODULE_NOT_FOUND/.test(f.output ?? ''))) {
  console.log('  !! 运行时依赖缺失（ERR_MODULE_NOT_FOUND）—— 跑一次补齐: node scripts/link-runtime-deps.mjs（docs/dev-environment.md §0.3）')
}

const passed = rows.filter(r => r.status === 'PASS' || r.status === 'PASS*').length
const skipped = rows.filter(r => r.status === 'SKIP').length
const partial = rows.filter(r => r.status === 'PASS*').length
const totalMs = rows.reduce((sum, r) => sum + r.ms, 0)
// 三种"非绿"读法各有一个词：FAILED（有断言不过）/ INCOMPLETE（没有退出码，读数不成立）/ OK
const verdict = failures.length > 0 ? 'FAILED' : unreadable.length > 0 ? 'INCOMPLETE' : 'OK'
console.log(
  `\n${verdict} — ${passed}/${rows.length} 通过` +
    (partial > 0 ? `（其中 ${partial} 项含 loud skip：其环境侧断言未验证）` : '') +
    (slowRows.length > 0 ? `，${slowRows.length} 项 slow 未跑（--all 补全）` : '') +
    (skipped > 0 ? `，${skipped} 项因缺环境跳过（见上）` : '') +
    (unreadable.length > 0 ? `，${unreadable.length} 项未跑完/被中断（见上：没有退出码 ≠ 用例失败）` : '') +
    (hooks !== undefined ? `，hooks=${hooks}` : '') +
    `，共 ${(totalMs / 1000).toFixed(1)}s`,
)
process.exit(failures.length > 0 ? 1 : unreadable.length > 0 ? 2 : 0)