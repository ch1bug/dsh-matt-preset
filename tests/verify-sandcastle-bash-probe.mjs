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
 *      另钉 main 预检调用（#191 起传候选表）/ 退出码 / WSL 分支（判据不放宽）/
 *      候选发现函数 / msys2 标准点候选 / 汇总文案 / 可行动指引。
 *   W2 行为级：副本 import（只换导入边，被测函数逐字节是仓内那份，手法同
 *      verify-sandcastle-retro.mjs Y6）注入假执行器 + 假候选表，覆盖四分支 +
 *      候选探测放行/汇总（#191）+ bashCandidates 发现面 + 非 win32 不误杀。
 *   W3 真探针段：真 bash 里直跑两条探针脚本（uname 关断言可执行；gcc 关只打印读数
 *      不断言——本机工具链形态差异是合法状态，报它本来就是探针的职责）。
 *   W4 setup.sh 离线红/绿两态真跑（TOOLCHAIN_UNAME_S/R、TOOLCHAIN_GCC 注入钩子，
 *      见 setup.sh 头注释）：绿态 exit 0；WSL 红态 / gcc 不可达红态 exit 1 且报错
 *      含可行动关键词——改坏判别（红绿颠倒/分支漏）时本段变红。
 *      W4 precheck（#190）：PATH 首个 bash 为 WSL shim（system32\bash.exe，无 MSYS
 *      路径转换）时，W4 递入的 Windows 反斜杠路径被 POSIX 解析吞掉反斜杠 → 恒红，
 *      且报错形态是环境侧异常非用例失败——此时 W4 整段 `SKIP (loud)` 降级（点名
 *      「PATH bash=WSL shim，W4 未验证」，verify-all 据此标 PASS*），W1–W3 照常跑，
 *      整体仍 exit 0。判据语义不变：非 shim 环境 W4 真跑面一字不动。
 *
 * #191（2026-11-15）：bashToolchainProblem 扩为候选探测（签名加 candidates 参数，
 *   BashProbeRunner 加 bash 参数）——PATH 首个 bash 不合格时依次探测 PATH 其余
 *   bash.exe 与 msys2 标准安装点，取第一个合格者；全部不合格才红且逐候选列出
 *   失败原因（判据不放宽：WSL bash 仍不放过）。W1 判据串按新形态对齐、W2 补
 *   候选探测用例；W3/W4 零改动。
 *
 * 不 import @deepseek-ai/* / @ai-hero/*；不依赖 podman；纯快集用例。
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
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

// ── W1: 文本级 —— 判据串三处双向钉 + main 预检消费（#191 候选表）+ 可行动指引 ──
const W1_CHECKS = [
  ['判据串在 e2e findBash()（漂移即红）', E2E.includes(PROBE_GCC)],
  ['判据串在 night-run bashToolchainProblem（漂移即红）', NIGHT.includes(PROBE_GCC)],
  ['判据串在 setup.sh gcc_reachable（漂移即红）', SETUP.includes(PROBE_GCC)],
  ['探针纯函数已导出', NIGHT.includes('export function bashToolchainProblem(')],
  ['候选发现函数已导出（#191）', NIGHT.includes('export function bashCandidates(')],
  ['main 预检位真调用探针并传候选表（#191）', NIGHT.includes('bashToolchainProblem(probeRun, process.platform, bashCandidates(')],
  ['预检失败 exit 3（不带病发射）', /if \(toolchainProblem\) \{[\s\S]*?process\.exit\(3\)/.test(NIGHT)],
  ['头注释声明退出码 3', NIGHT.includes('3=bash 工具链自检失败')],
  ['uname 判据在场（uname -s）', NIGHT.includes('uname -s')],
  ['WSL 漂移分支（win32 + 非 msys 形态，判据不放宽）', NIGHT.includes("platform === \"win32\" && !/MINGW|MSYS/i.test(s)")],
  ['WSL 候选红态点名不放过（判据不放宽，#191）', NIGHT.includes('WSL bash（uname -s = Linux')],
  ['可行动错误指明 msys2 安装', NIGHT.includes('https://www.msys2.org')],
  ['可行动错误指明设 PATH', NIGHT.includes('前置到 PATH')],
  ['msys2 标准点候选在场（e2e findBash 先例同款，#191）', NIGHT.includes('C:/msys64/usr/bin/bash.exe')],
  ['汇总报错列出已探测候选与各自失败原因（缺席必响亮，#191）', NIGHT.includes('已探测候选与各自失败原因')],
  ['setup.sh fail-fast 语义（die→exit 1）', /die\(\) \{[\s\S]*?exit "\$\{2:-1\}"/.test(SETUP)],
  ['setup.sh WSL 内核分支（microsoft）', /\*microsoft\*/.test(SETUP)],
  ['setup.sh System32 bash 分支（票面 AC① bash 直达）', /system32/i.test(SETUP)],
  ['setup.sh 离线注入钩子已声明', SETUP.includes('TOOLCHAIN_UNAME_S') && SETUP.includes('TOOLCHAIN_GCC')],
]
const w1Missing = W1_CHECKS.filter(([, pass]) => !pass).map(([n]) => n)
if (w1Missing.length === 0)
  ok('W1. 判据串三处双向钉 + 探针/预检/退出码/可行动指引全部在场', `${W1_CHECKS.length} 条`)
else bad('W1. 探针面缺失或判据漂移', w1Missing.join(', '))

// ── W2: 行为级 —— 副本 import + 假执行器/假候选表注入，四分支 + 候选探测（#191）──
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
  if (typeof mod.bashCandidates !== 'function') throw new Error('bashCandidates 未导出')

  /** 假执行器：按 (候选 bash, 脚本) 匹配返回预置读数（不碰真 bash）；未覆盖组合响亮 throw。 */
  const fakeRun = (map) => (bash, script) => {
    for (const [b, needle, res] of map) if (bash === b && script.includes(needle)) return res
    throw new Error(`fakeRun 未覆盖：bash=${bash} script=${script.slice(0, 40)}`)
  }
  const okUname = { status: 0, stdout: 'MINGW64_NT-10.0-26300\n' }
  const wslUname = { status: 0, stdout: 'Linux\n' }
  const gccOk = { status: 0, stdout: '' }
  const gccMiss = { status: 1, stdout: '' }
  const noExec = { status: null, stdout: '' }
  const MSYS2 = 'C:/msys64/usr/bin/bash.exe'

  const w2 = []
  // a. 单候选：msys 形态 + gcc 可达 → 通过
  w2.push(['msys 形态 + gcc 可达 → 放行',
    mod.bashToolchainProblem(fakeRun([['c1', 'uname', okUname], ['c1', 'gcc', gccOk]]), 'win32', ['c1']) === undefined])
  // b. 单候选 WSL bash（uname=Linux）+ win32 → 红且点名 WSL（判据不放宽）
  const wslProblem = mod.bashToolchainProblem(fakeRun([['c1', 'uname', wslUname]]), 'win32', ['c1'])
  w2.push(['WSL bash（uname=Linux）→ 红且点名 WSL', typeof wslProblem === 'string' && wslProblem.includes('WSL')])
  // c. 单候选 msys 形态但 gcc 缺 → 红且指明 msys2 / ucrt64 修复路径
  const gccProblem = mod.bashToolchainProblem(fakeRun([['c1', 'uname', okUname], ['c1', 'gcc', gccMiss]]), 'win32', ['c1'])
  w2.push(['gcc 不可达 → 红且指明 msys2/ucrt64 修复',
    typeof gccProblem === 'string' && gccProblem.includes('msys2') && gccProblem.includes('ucrt64')])
  // d. 单候选 bash 缺失 → 红且可行动
  const noBash = mod.bashToolchainProblem(fakeRun([['c1', 'uname', noExec]]), 'win32', ['c1'])
  w2.push(['bash 缺失 → 红且指明 PATH/安装', typeof noBash === 'string' && noBash.includes('不在 PATH')])
  // e. 非 win32 宿主（原生 Linux）不因 uname=Linux 被误杀
  w2.push(['原生 Linux 宿主 → 不误杀 uname=Linux',
    mod.bashToolchainProblem(fakeRun([['c1', 'uname', wslUname], ['c1', 'gcc', gccOk]]), 'linux', ['c1']) === undefined])
  // f. 候选探测（#191 票面核心场景）：PATH 首个 = WSL shim + msys2 标准点合格 → 放行
  w2.push(['PATH 首个 WSL shim + msys2 标准点合格 → 放行（不再因 PATH 顺序误杀）',
    mod.bashToolchainProblem(
      fakeRun([['bash', 'uname', wslUname], [MSYS2, 'uname', okUname], [MSYS2, 'gcc', gccOk]]),
      'win32', ['bash', MSYS2]) === undefined])
  // g. 候选探测：首个缺 gcc + 次候选 gcc 可达 → 放行
  w2.push(['首个缺 gcc + 次候选 gcc 可达 → 放行',
    mod.bashToolchainProblem(
      fakeRun([['c1', 'uname', okUname], ['c1', 'gcc', gccMiss], ['c2', 'uname', okUname], ['c2', 'gcc', gccOk]]),
      'win32', ['c1', 'c2']) === undefined])
  // h. 全部候选不合格 → 红且逐候选列出失败原因（缺席必响亮）
  const allRed = mod.bashToolchainProblem(
    fakeRun([['bash', 'uname', wslUname], [MSYS2, 'uname', noExec]]), 'win32', ['bash', MSYS2])
  w2.push(['全部候选不合格 → 红且列出各候选与各自失败原因',
    typeof allRed === 'string'
      && allRed.includes('全部不合格')
      && allRed.includes('已探测候选与各自失败原因')
      && allRed.includes('WSL')
      && allRed.includes(MSYS2)])
  // i. 空候选表 → 红且响亮（不静默放行）
  w2.push(['空候选表 → 红且响亮', typeof mod.bashToolchainProblem(fakeRun([]), 'win32', []) === 'string'])
  // j. 候选发现（win32）：bash + PATH 枚举（存在者、同目录去重）+ msys2 标准点
  const fakeBin = join(scratch, 'fake-path-bin')
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(join(fakeBin, 'bash.exe'), '')
  const cands = mod.bashCandidates(`${fakeBin};${fakeBin};C:\\no\\such\\dir`, 'win32')
  w2.push(['bashCandidates（win32）：bash + PATH 枚举 + msys2 标准点 + 同目录去重',
    cands[0] === 'bash'
      && cands.filter((c) => c.toLowerCase() === join(fakeBin, 'bash.exe').toLowerCase()).length === 1
      && cands[cands.length - 1] === MSYS2
      && !cands.some((c) => c.includes('no\\such'))])
  // k. 候选发现（非 win32）：单候选，与原 PATH 首个语义等价
  w2.push(['bashCandidates（非 win32）：单候选 ["bash"]',
    JSON.stringify(mod.bashCandidates('/usr/bin:/bin', 'linux')) === JSON.stringify(['bash'])])

  const w2Missing = w2.filter(([, pass]) => !pass).map(([n]) => n)
  if (w2Missing.length === 0)
    ok('W2. 行为级：注入执行器/候选表覆盖四分支 + 候选探测（#191）+ 非 win32 不误杀', `${w2.length} 条`)
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

// ── W4 precheck（#190）：PATH 首个 bash 是否 WSL shim —— 是则 W4 环境侧 loud skip ──
// 机制：PATH 首个 bash = C:\WINDOWS\system32\bash.exe（WSL shim）时，W4 递给 bash 的
// 是 Windows 反斜杠路径，WSL bash 按 POSIX 解析把反斜杠当转义吞掉 → 报
// `D:…setup.sh: No such file or directory`；且 shim 无 cygpath，System32 漂移分支的
// 真 bash 绝对路径固定解析失败——三 ✗ 全是环境侧异常，非用例失败（#190 症状）。
// 降级口径：W4 整段 `SKIP (loud)` + 点名「PATH bash=WSL shim，W4 未验证」+ 整体仍
// exit 0（verify-all 据此标 PASS*，与 M4「镜像缺失 loud skip」同形态）；W1–W3 照常跑。
// 判据语义不变：非 shim 环境下 W4 真跑面一字不动（下面的 else 分支就是原逻辑）。
//
// shim 判据（票面候选三选二，取可实现者组合，命中任一即判 shim；仅 win32 宿主判）：
//   a. uname -s 读数恰为 `Linux` —— WSL shim 的 uname 恒输出 Linux（msys 形态输出
//      MINGW*_NT-*）。读数复用 W3 的 uname 探针（同一 spawnSync('bash', ['-c',
//      'uname -s'])，不重复起进程）。注意「恰为 Linux」而非「非 MINGW|MSYS」：
//      Cygwin bash（CYGWIN_NT-*）有 cygpath 与路径转换，W4 能真跑，不误降级——
//      降级口径宁窄勿宽，能真跑就真跑。
//   b. PATH 解析首个 bash.exe 位于 System32 目录 —— WSL shim 的固定安装位置形态。
//   票面候选「无 cygpath」未采：shim 环境 cygpath 缺席是 a/b 的派生现象，单独判它
//   反而会误伤真 cygwin 环境。
const firstBashDir = (() => {
  if (process.platform !== 'win32') return null
  for (const raw of (process.env.PATH ?? '').split(';')) {
    const dir = raw.trim().replace(/^"|"$/g, '')
    if (dir === '') continue
    try {
      if (existsSync(join(dir, 'bash.exe'))) return dir
    } catch { /* 不可读目录跳过，继续找 */ }
  }
  return null
})()
const shimByUname = unameProbe.status === 0 && unameOut === 'Linux'
const shimBySystem32 = firstBashDir !== null && /system32/i.test(firstBashDir)
const IS_WSL_SHIM = process.platform === 'win32' && (shimByUname || shimBySystem32)

// ── W4: setup.sh 离线红/绿两态真跑（票面 AC①⑤：fail-fast + 非空洞）────────────
// 注入钩子（setup.sh 头注释声明）：TOOLCHAIN_UNAME_S/R 覆盖 uname、TOOLCHAIN_GCC=1/0
// 强制 gcc 读数——红/绿两态完全离线确定，不依赖本机工具链形态。
// 非空洞判据：判别逻辑被注入读数真跑——改坏判别（红绿颠倒 / 分支漏）时本段红。
const SETUP_PATH = resolve(REPO, 'sandcastle', 'templates', 'setup.sh')
if (IS_WSL_SHIM) {
  // S1 缺席必响亮：W4 本轮**未验证**显式点名——不静默绿，也不记 FAIL（环境侧异常）。
  const why = [
    shimByUname ? `uname -s=${unameOut}（win32 宿主）` : null,
    shimBySystem32 ? `PATH 首个 bash.exe 在 ${firstBashDir}` : null,
  ].filter(Boolean).join('；')
  console.log(`  !! SKIP (loud) - PATH bash=WSL shim，W4 未验证 —— 环境侧降级（#190），非用例失败；命中判据：${why}`)
  console.log('  ℹ W1–W3 照常跑；W4 真读数需在 msys2（或含 cygpath 的 bash）前置 PATH 的环境重跑本守卫')
} else {
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
}

report('SANDCASTLE-BASH-PROBE VERIFY (W1–W4)')
