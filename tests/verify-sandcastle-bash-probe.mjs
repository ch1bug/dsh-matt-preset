/**
 * verify-sandcastle-bash-probe.mjs — #43 守卫：bash 工具链自检（night-run 预检 +
 * templates/setup.sh）与 e2e findBash() 判据同口径。
 *
 * 票面 AC（gh issue 43 评论 Agent Brief 2026-10-16 + 收口批 2026-10-19）：
 *   ① setup.sh 存在：能力探针 + 可行动报错 + 非 0 退出（fail-fast）；
 *   ② night-run.mts 起手预检，失败即退；
 *   ③ 探针判据与 tests/sandcastle-e2e.mjs findBash() 同口径，断言钉住（防两处漂移）；
 *   ④ 判别逻辑可导入 + 离线用例红/绿两态；非空洞（改坏判别应红）。
 *
 * 分层：
 *   W1 文本级：判据串（GCC 探针串单一常量）在 **三处**（e2e findBash / night-run
 *      bashToolchainProblem / setup.sh）逐字在场——**双向钉**：改任何一侧判据串守卫即红；
 *      另钉 main 预检调用 / 退出码 / WSL 分支 / 可行动指引。
 *   W2 行为级：副本 import（只换导入边，被测函数逐字节是仓内那份，手法同
 *      verify-sandcastle-retro.mjs Y6）注入假执行器，覆盖四分支 + 非 win32 不误杀。
 *   W3 真探针段：真 bash 里直跑两条探针脚本（uname 关断言可执行；gcc 关只打印读数
 *      不断言——本机工具链形态差异是合法状态，报它本来就是探针的职责）。
 *   W4 setup.sh 离线红/绿两态真跑（TOOLCHAIN_UNAME_S/R、TOOLCHAIN_GCC 注入钩子，
 *      见 setup.sh 头注释）：绿态 exit 0；WSL 红态 / gcc 不可达红态 exit 1 且报错
 *      含可行动关键词——改坏判别（红绿颠倒/分支漏）时本段变红。
 *
 * 不 import @deepseek-ai/* / @ai-hero/*；不依赖 podman；纯快集用例。
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
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

// gcc 判据串 = 判据的单一事实源在守卫里的锚（票面 AC③：判据一致 + 断言钉住防漂移）。
// e2e bashCapable、night-run bashToolchainProblem、setup.sh gcc_reachable 三处必须逐字含它。
const PROBE_GCC = 'command -v gcc >/dev/null 2>&1 || test -x /ucrt64/bin/gcc.exe'

const NIGHT = read('sandcastle/templates/night-run.mts')
const E2E = read('tests/sandcastle-e2e.mjs')
const SETUP = read('sandcastle/templates/setup.sh')
for (const [rel, text] of [
  ['sandcastle/templates/night-run.mts', NIGHT],
  ['tests/sandcastle-e2e.mjs', E2E],
  ['sandcastle/templates/setup.sh', SETUP],
]) {
  if (text === null) bad(`W0. ${rel} 可读`, '文件缺失或不可读 —— 探针面缺一张脸')
}
if (NIGHT === null || E2E === null || SETUP === null) report('SANDCASTLE-BASH-PROBE VERIFY (W1–W4)')

// ── W1: 文本级 —— 判据串三处双向钉 + main 预检消费 + 可行动指引 ─────────────
const W1_CHECKS = [
  ['判据串在 e2e findBash()（漂移即红）', E2E.includes(PROBE_GCC)],
  ['判据串在 night-run bashToolchainProblem（漂移即红）', NIGHT.includes(PROBE_GCC)],
  ['判据串在 setup.sh gcc_reachable（漂移即红）', SETUP.includes(PROBE_GCC)],
  ['探针纯函数已导出', NIGHT.includes('export function bashToolchainProblem(')],
  ['main 预检位真调用探针', NIGHT.includes('bashToolchainProblem(probeRun, process.platform)')],
  ['预检失败 exit 3（不带病发射）', /if \(toolchainProblem\) \{[\s\S]*?process\.exit\(3\)/.test(NIGHT)],
  ['头注释声明退出码 3', NIGHT.includes('3=bash 工具链自检失败')],
  ['uname 判据在场（uname -s）', NIGHT.includes('uname -s')],
  ['WSL 漂移分支（win32 + 非 msys 形态）', NIGHT.includes("platform === \"win32\" && !/MINGW|MSYS/i.test(s)")],
  ['可行动错误指明 msys2 安装', NIGHT.includes('https://www.msys2.org')],
  ['可行动错误指明设 PATH', NIGHT.includes('前置到 PATH')],
  ['setup.sh fail-fast 语义（die→exit 1）', /die\(\) \{[\s\S]*?exit "\$\{2:-1\}"/.test(SETUP)],
  ['setup.sh WSL 内核分支（microsoft）', /\*microsoft\*/.test(SETUP)],
  ['setup.sh System32 bash 分支（票面 AC① bash 直达）', /system32/i.test(SETUP)],
  ['setup.sh 离线注入钩子已声明', SETUP.includes('TOOLCHAIN_UNAME_S') && SETUP.includes('TOOLCHAIN_GCC')],
]
const w1Missing = W1_CHECKS.filter(([, pass]) => !pass).map(([n]) => n)
if (w1Missing.length === 0)
  ok('W1. 判据串三处双向钉 + 探针/预检/退出码/可行动指引全部在场', `${W1_CHECKS.length} 条`)
else bad('W1. 探针面缺失或判据漂移', w1Missing.join(', '))

// ── W2: 行为级 —— 副本 import + 假执行器注入，四分支 + 非 win32 不误杀 ────────
let scratch = null
try {
  scratch = mkdtempSync(join(REPO, '.scratch', 'verify-bash-probe-'))
} catch {
  scratch = mkdtempSync(join(tmpdir(), 'verify-bash-probe-'))
}
try {
  const stub = join(scratch, 'stub-run-ticket.mjs')
  writeFileSync(stub, 'export const EXIT_STATUS = { MERGED: 0, VERIFY_FAILED: 3, CONFLICT: 4, TIMEOUT: 5, EMPTY: 6, NEEDS_SIMPLIFY: 7 }\n')
  const src = NIGHT
    .replace('from "./lib.ts"', `from ${JSON.stringify(pathToFileURL(join(REPO, 'sandcastle', 'templates', 'lib.ts')).href)}`)
    .replace('from "./run-ticket.mts"', `from ${JSON.stringify(pathToFileURL(stub).href)}`)
  writeFileSync(join(scratch, 'night-run.mts'), src)
  const importEdgeRewritten = src !== NIGHT && src.includes('stub-run-ticket')
  if (!importEdgeRewritten) throw new Error('导入边未重写（替换静默失败）')

  const mod = await import(pathToFileURL(join(scratch, 'night-run.mts')).href)
  if (typeof mod.bashToolchainProblem !== 'function') throw new Error('bashToolchainProblem 未导出')

  /** 假执行器：按脚本内容返回预置读数（不碰真 bash）。 */
  const fakeRun = (map) => (script) => {
    for (const [needle, res] of map) if (script.includes(needle)) return res
    throw new Error('fakeRun 未覆盖脚本：' + script)
  }
  const okUname = { status: 0, stdout: 'MINGW64_NT-10.0-26300\n' }
  const wslUname = { status: 0, stdout: 'Linux\n' }
  const gccOk = { status: 0, stdout: '' }
  const gccMiss = { status: 1, stdout: '' }

  const w2 = []
  // a. msys 形态 + gcc 可达 → 通过
  w2.push(['msys 形态 + gcc 可达 → 放行', mod.bashToolchainProblem(fakeRun([['uname', okUname], ['gcc', gccOk]]), 'win32') === undefined])
  // b. WSL bash（uname=Linux）+ win32 → 报 WSL 漂移
  const wslProblem = mod.bashToolchainProblem(fakeRun([['uname', wslUname]]), 'win32')
  w2.push(['WSL bash（uname=Linux）→ 红且点名 WSL', typeof wslProblem === 'string' && wslProblem.includes('WSL')])
  // c. msys 形态但 gcc 缺 → 红且指明 msys2 / ucrt64 修复路径
  const gccProblem = mod.bashToolchainProblem(fakeRun([['uname', okUname], ['gcc', gccMiss]]), 'win32')
  w2.push(['gcc 不可达 → 红且指明 msys2/ucrt64 修复', typeof gccProblem === 'string' && gccProblem.includes('msys2') && gccProblem.includes('ucrt64')])
  // d. bash 缺失 → 红且可行动
  const noBash = mod.bashToolchainProblem(fakeRun([['uname', { status: null, stdout: '' }]]), 'win32')
  w2.push(['bash 缺失 → 红且指明 PATH/安装', typeof noBash === 'string' && noBash.includes('不在 PATH')])
  // e. 非 win32 宿主（原生 Linux）不因 uname=Linux 被误杀
  w2.push(['原生 Linux 宿主 → 不误杀 uname=Linux', mod.bashToolchainProblem(fakeRun([['uname', wslUname], ['gcc', gccOk]]), 'linux') === undefined])

  const w2Missing = w2.filter(([, pass]) => !pass).map(([n]) => n)
  if (w2Missing.length === 0)
    ok('W2. 行为级：注入执行器覆盖四分支 + 非 win32 不误杀', `${w2.length} 条`)
  else bad('W2. 探针判定分支行为不符', w2Missing.join(', '))
} catch (error) {
  bad('W2. 行为级探针', String(error?.message ?? error).split('\n')[0])
} finally {
  // 不泄漏临时目录（D7：夹具/探针残骸）。副本在 .scratch/ 下，不进 tests/*.mjs 扫描面。
  rmSync(scratch, { recursive: true, force: true })
}

// ── W3: 真探针段 —— 两条探针脚本在真 bash 里可执行（brief 验证②的机械面）──────
// uname 关：bash+uname 是夜跑硬前置（探针第一关语义），可执行且非空 → 断言。
// gcc 关：只执行 + 打印读数，**不断言**——本机有无 gcc 是合法形态差异，
//         报「gcc 不可达」正是探针的职责，不是守卫的职责。
const unameProbe = spawnSync('bash', ['-c', 'uname -s'], { encoding: 'utf8' })
const unameOut = (unameProbe.stdout ?? '').trim()
if (unameProbe.status === 0 && unameOut !== '') {
  ok('W3. 真探针段：uname -s 在真 bash 可执行', `uname -s = ${unameOut}；platform = ${process.platform}`)
} else {
  bad('W3. 真探针段：uname -s 不可执行',
    `status=${unameProbe.status} ${(unameProbe.stderr ?? '').split('\n')[0]}`)
}
const gccProbe = spawnSync('bash', ['-c', PROBE_GCC], { encoding: 'utf8' })
console.log(
  `  ℹ gcc 关真读数（不断言）：exit=${gccProbe.status}` +
  (gccProbe.status === 0 ? '（gcc 可达）' : '（gcc 不可达——真环境跑 night-run 会 exit 3、setup.sh 会 exit 1，均给可行动错误）'),
)

// ── W4: setup.sh 离线红/绿两态真跑（票面 AC①⑤：fail-fast + 非空洞）────────────
// 注入钩子（setup.sh 头注释声明）：TOOLCHAIN_UNAME_S/R 覆盖 uname、TOOLCHAIN_GCC=1/0
// 强制 gcc 读数——红/绿两态完全离线确定，不依赖本机工具链形态。
// 非空洞判据：判别逻辑被注入读数真跑——改坏判别（红绿颠倒 / 分支漏）时本段红。
const SETUP_PATH = resolve(REPO, 'sandcastle', 'templates', 'setup.sh')
const syntax = spawnSync('bash', ['-n', SETUP_PATH], { encoding: 'utf8' })
if (syntax.status === 0) {
  ok('W4. setup.sh 通过 bash -n（模板可解析）')
} else {
  bad('W4. setup.sh 语法错误', `exit=${syntax.status} ${(syntax.stderr ?? '').split('\n')[0]}`)
}

const runSetup = (env) => {
  const e = { ...process.env, ...env }
  // 空值=未注入：清掉空串与父 shell 残留，让 setup.sh 的 `:-`（默认读数）与 `+x`
  // （注入开关）都走生产路径语义——TOOLCHAIN_GCC='' 会被 gcc_reachable 的 [ -n +x ]
  // 误判成「注入了不可达」。
  for (const k of ['TOOLCHAIN_UNAME_S', 'TOOLCHAIN_UNAME_R', 'TOOLCHAIN_GCC']) {
    if (e[k] === undefined || e[k] === '') delete e[k]
  }
  return spawnSync('bash', [SETUP_PATH], { encoding: 'utf8', env: e })
}
const w4 = []
const green = runSetup({ TOOLCHAIN_UNAME_S: 'MINGW64_NT-10.0-26300', TOOLCHAIN_GCC: '1' })
w4.push(['绿态（msys + gcc 可达）→ exit 0', green.status === 0])
const wsl = runSetup({ TOOLCHAIN_UNAME_S: 'Linux', TOOLCHAIN_UNAME_R: '5.15.167.4-microsoft-standard-WSL2', TOOLCHAIN_GCC: '1' })
w4.push(['WSL 红态（uname -r 含 microsoft）→ exit 1 且点名 WSL',
  wsl.status === 1 && (wsl.stderr ?? '').includes('WSL')])
const gccRed = runSetup({ TOOLCHAIN_UNAME_S: 'MINGW64_NT-10.0-26300', TOOLCHAIN_GCC: '0' })
w4.push(['gcc 不可达红态 → exit 1 且指明 msys2',
  gccRed.status === 1 && (gccRed.stderr ?? '').includes('msys2')])
// System32 bash 漂移分支（票面 AC①「bash 可直达」）：仅 Windows 宿主真跑——需要
// cmd.exe 做假 bash.exe。外层 bash 必须**绝对路径**：PATH 前置 fake 后，'bash' 会被
// node 解析到假 bash.exe（实测 cmd.exe 顶替跑出 banner）——先在无污染时经 cygpath
// 把真 bash 固定成 Windows 绝对路径。
const BASH_WIN = (spawnSync('bash', ['-c', 'cygpath -w "$(command -v bash)"'], { encoding: 'utf8' }).stdout ?? '').trim()
if (process.platform === 'win32') {
  if (BASH_WIN === '') {
    bad('W4. System32 漂移态：真 bash 绝对路径解析失败（cygpath 不可用？）', '环境侧异常，非用例失败')
  } else {
    const fakeDir = join(mkdtempSync(join(tmpdir(), 'verify-bash-probe-s32-')), 'fake-system32')
    mkdirSync(fakeDir, { recursive: true })
    copyFileSync(join(process.env.WINDIR ?? 'C:/Windows', 'System32', 'cmd.exe'), join(fakeDir, 'bash.exe'))
    const s32 = spawnSync(BASH_WIN, [SETUP_PATH], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeDir};${process.env.PATH ?? ''}`, TOOLCHAIN_UNAME_S: 'MINGW64_NT-10.0-26300', TOOLCHAIN_GCC: '1' },
    })
    w4.push(['System32 bash 漂移红态 → exit 1 且点名 System32',
      s32.status === 1 && /system32/i.test(s32.stderr ?? '')])
    rmSync(join(fakeDir, '..'), { recursive: true, force: true })
  }
} else {
  console.log('  ℹ System32 bash 漂移分支真跑：非 Windows 宿主不做（该形态仅在 win32 存在）—— loud skip')
}

const w4Missing = w4.filter(([, pass]) => !pass).map(([n]) => n)
if (w4Missing.length === 0) {
  ok('W4. setup.sh 离线红/绿两态真跑（注入读数）', `${w4.length} 态`)
} else {
  bad('W4. setup.sh 判别行为不符（改坏判别/分支漏会在此红）', w4Missing.join(', '))
}
// 本机真跑读数（不注入）：只打印不断言——本机 bash 形态差异是探针职责，不是守卫断言面。
const real = runSetup({})
console.log(`  ℹ setup.sh 本机真跑读数（不断言）：exit=${real.status}`)

report('SANDCASTLE-BASH-PROBE VERIFY (W1–W4)')
