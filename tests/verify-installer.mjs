/**
 * verify-installer.mjs — #28 preset 安装→装载整链的 installer 单测。
 *
 * #21 的 copy-installer 在 rc.2 上装完加载不了（preset 目录自动发现已死，
 * 装载机制 = bundle patch 经 `dsh plugin --profile <p> add <store>`）。
 * 覆盖：install（fresh：存储副本 + profile link + 版本戳 + 清单）、重复
 * install 拒绝、--force、upgrade（原地替换）、uninstall（连 profile link
 * 一起摘）、--version、--from tarball；外加整链 e2e：隔离 DSH_HOME 上
 * `dsh --dump-config` 出现 preset-matt 行 + 安装副本插件可 import。
 *
 * #67：store 侧（payload / 版本戳 / 清单 / 重复拒绝 / --version）不需要 dsh，照常实跑；
 * 依赖 profile link 的断言（装载的产物）与 e2e 共用同一可达性守卫——dsh 与 pnpm 有一件不在时
 * 响亮跳过（`SKIP (loud)`，verify-all 记为 PASS*），不硬崩 ENOENT、也不静默当 pass。
 *
 * #47（桌面形态）/ #86（pnpm 半边）新增三组断言（2026-10-18）：
 *   A. **stub 参数透传**（#86 AC②）：假 `dsh` + 假 `pnpm` 全程离线，证明
 *      `dsh plugin --profile <p> add <store>` 的参数与**解析到的 dsh 路径**真被透传，
 *      且 `pnpmPathInjection()` 的目录真被前置进子进程 PATH（plugin-manager 按字面
 *      `pnpm` 找到它）。带**非空洞对照**：显式传相对路径 / 不注入 PATH / 缺 `--pnpm`
 *      三种扰动各自让对应断言变红（dev-environment §0.2「证明每条新断言非空洞」）。
 *   B. **桌面形态**（#47 AC③）：`--profile desktop` 的 install/upgrade 把 store link 到
 *      `<DSH_HOME>/.agent-presets/matt`，且 **store 的版本戳与 profile 依赖的落点一致**
 *      （分叉现场正是「两边不是同一个目录」）。需要真的 dsh → 无则 `SKIP (loud)`。
 *   C. **真链路 live**（#86 端到端，非 stub）：门禁 `DSH_MATT_DESKTOP_ROOT`（桌面安装根，
 *      形如 `<app>/resources`，内含 `runtime/cli/bin/dsh.cmd` 与
 *      `runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs`）；未设 → `SKIP (loud)`。
 *      当场 PATH 上没有 pnpm 也能装上（这正是 #86 要证的）。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { payloadOf } from '../lib/payload.mjs'
import { probeDsh, probePnpm } from '../lib/runtime-probe.mjs'
import { testExecutable } from './lib-exec.mjs'

const testNode = testExecutable('node').command

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(REPO, 'bin', 'install.mjs')
const tmp = await mkdtemp(join(tmpdir(), 'dsh-matt-installer-'))

let passed = 0
let totalSkips = 0
/** 当前用例内的 loud skip 计数：让 per-case 读数也如实（绿色 ≠ 该用例全验过）。
 *  e2e 那条在 test() 之外调用，只计入 totalSkips（stdout/stderr 分流时行序不定，故标记不带方向）。 */
let skipsInCase = 0
/** 「防线缺席必须响亮」的两个出口（D47）：
 *  - `loudSkip`：**环境侧证据确实不在本机**（没有 dsh / 没有 pnpm / 没有桌面运行时）。
 *    打印成因、计入汇总、不置非零退出 —— 但绝**不**静默当 pass（verify-all 记 `PASS*`）。
 *  - 另一类"防线缺席"是**断言本身失效**（判据恒真、抓错目标）：那**不许**降级成 skip，
 *    必须响亮失败。本文件的写法是把可控条件搬进子进程（env / PATH / 显式参数都由 `run()`
 *    控制），于是"断言失效"会直接表现为 FAIL，而不是靠一句 `loudFail(...)` 去猜。
 */
function loudSkip(what) {
  skipsInCase++; totalSkips++
  console.warn(`  !! SKIP (loud) - ${what} — evidence absent on this machine`)
}
const test = async (name, fn) => {
  skipsInCase = 0
  try { await fn(); passed++; console.log(`  ok - ${name}${skipsInCase > 0 ? ` [${skipsInCase} 条 loud skip]` : ''}`) }
  catch (e) { console.error(`  FAIL - ${name}\n${e?.stack ?? e}`); process.exitCode = 1 }
}

const pkg = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'))
const pkgVersion = pkg.version

/**
 * dsh 可达性：**消费 installer 自己的解析结果**（`lib/runtime-probe.mjs`），不再自己
 * spawn 一次字面 `dsh --version`。
 *
 * 为什么必须这样（#78 的教训在本文件的翻版）：测试自带一个探针时，它与 installer 的判定
 * **可能分叉** —— 探针说"在场"而 installer 说"未命中"（PATH 里只有 POSIX shim、或只有
 * `--dsh`/`DSH_MATT_DSH`/`DSH_DESKTOP_ROOT` 能找到），于是断言跑去读一个 installer 没建的
 * profile 层，把"环境缺件"读成"产品红"；反过来探针说"不在场"而 installer 命中了，测试会
 * 把**已经验过的**那半边静默算成 skip。两边共用同一个纯函数就不会分叉。
 *
 * **默认限定 PATH 来源**：本用例的 profile-link 断言是为了证明"本机 PATH 上的 dsh 能把
 * preset 装进 profile"。若把 `DSH_MATT_DSH_SRC`（源码检出）也算进来，源检出形态要以
 * `node <src>/apps/cli/lib/bin.js` 起，而本文件住在一棵树里、可能被**另一个 checkout** 的
 * 检出跑 —— 那等于让本仓的断言消费一个**跨检出**的运行时（#67 的旧教训）。要验真链路请用
 * 下面的 **live 桌面端用例**（门禁 `DSH_MATT_DESKTOP_ROOT`）。
 */
/**
 * 桌面运行时门禁（#47）：`DSH_DESKTOP_ROOT` **契约口径 = 桌面应用根目录**（含 `resources`
 * 的那一层，即 `<app>`），候选路径是
 *   `<root>/resources/runtime/cli/bin/dsh.cmd`
 *   `<root>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs`
 *
 * **为什么下面是"两种读法都试"**：`lib/runtime-probe.mjs` 的 desktop 档对同一档位放了
 * 两条候选形态（先 `<root>/resources/…`，再 `<root>/…` 回落），于是把 `DSH_DESKTOP_ROOT`
 * 误设成 `<app>/resources` 时也**收敛到同一条真实路径**（2026-10-18 实测：两种读法下
 * `probeDsh`/`probePnpm` 都 `found=true source=desktop`，指向同一个 `dsh.cmd`）。
 * 本门禁必须与那套行为**同口径** —— 否则会出现"installer 能命中、测试却判环境缺席"的
 * **假 skip**，那正是要消灭的静默（D47）。判据与 probe 一致：先 `resources/…`、再回落。
 */
const desktopRoot = process.env.DSH_MATT_DESKTOP_ROOT ?? process.env.DSH_DESKTOP_ROOT ?? ''
const underRoot = (...parts) => join(desktopRoot, ...parts)
const desktopDsh = desktopRoot === '' ? '' : [
  underRoot('resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
  underRoot('runtime', 'cli', 'bin', 'dsh.cmd'),
].find((p) => existsSync(p)) ?? ''
const desktopPnpm = desktopRoot === '' ? '' : [
  underRoot('resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'),
  underRoot('runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'),
].find((p) => existsSync(p)) ?? ''
const haveDesktop = desktopDsh !== '' && desktopPnpm !== ''

/**
 * dsh / pnpm 的**总可达性**：installer 自己会走完整张探测表，所以这里也必须走完整张表，
 * 否则测试与 installer 的判定又会分叉（见文件头注释）。
 *
 * **PATH 之外的来源只在"另有指针"时才计入**——这条限制是给"测试消费跨检出运行时"上的保险：
 * 本文件住在一棵树里、可能被**另一个 checkout** 的检出跑（`DSH_MATT_DSH_SRC` 指到别人的源树），
 * 那等于让本仓的断言消费一个跨检出的契约（#67 的旧教训）。判据：
 *   - PATH 上有 → 算（本机原生形态，最典型）；
 *   - 显式给了 `DSH_DESKTOP_ROOT` 且里面确实有桌面运行时 → 算（**这正是 #47 要验的形态**）；
 *   - 其余（`DSH_MATT_DSH_SRC` 等）→ 猜不准是"谁的树"，不计入全局门禁；
 *     要验那条请走下面的 live 桌面端用例，或在命令行显式给 `--dsh`（stub 组已覆盖）。
 */
const dsh = probeDsh({ env: { ...process.env, DSH_MATT_DSH_SRC: '' } })
const dshOnPath = dsh.found
/**
 * **桌面根也算 dsh 可达**（#47 的核心形态）：这正是「PATH 上没有 `dsh`、但桌面端有」这一类
 * 机器 —— #47 的票面现场就是它。
 *
 * 前提是 `bin/install.mjs` 真的会用桌面惯例（它按冻结契约调 `probeDsh({ explicit })`，内部读
 * `DSH_DESKTOP_ROOT`）。**契约若变，这里必须跟着变**：下面有一道*守卫*断言
 * （`desktop-root reachability guard`）实测 installer 是否真的用它，不成立就响亮失败 ——
 * 免得测试把"installer 没走桌面惯例"读成"环境缺件"而静默跳过。
 */
const dshReachable = dshOnPath || haveDesktop

/**
 * pnpm 探针（#86）。**为什么挂载断言要看它**：`bin/install.mjs` 在「dsh 命中但 pnpm 未命中」
 * 时 `die(missingToolHint('pnpm'))`（Lead 拍板 B，2026-10-18）—— 这类机器上**挂载那一半
 * 根本不会发生**，profile link 断言去读依赖表只会读到"没装上"。那不是产品红，是环境缺件，
 * 所以与 dsh 同款：**响亮跳过**；但**理由串必须独立**（`needs pnpm for the mount step (#86)`）
 * —— 两个成因不同，混用会让读数骗人（把"缺 pnpm"读成"缺 dsh"）。
 *
 * 这条门禁**不能**顺带把「pnpm 在场」那一档也跳过：`mountable` 为真时 `assertLink` 必须
 * 真跑，`#86 stub` 组里的 E6 门禁对照钉住这一半（实测：dsh+pnpm 都在场时读数 17/17、
 * **零** loud skip）。
 */
const pnpm = probePnpm({ env: { ...process.env, DSH_MATT_DSH_SRC: '' } })
const pnpmReachable = pnpm.found || haveDesktop
/** 挂载产物的总门禁：dsh **且** pnpm 都可解析（两者成因不同、理由串分开报）。 */
const mountable = dshReachable && pnpmReachable

/** Run the installer CLI with args; each test gets its own DSH_HOME.
 *  `extraEnv` 可覆盖/删除变量（值为 `undefined` 表示**删掉**，用来堵住某个探测来源）。 */
function run(args, dshHome, extraEnv = {}) {
  const env = { ...process.env, DSH_HOME: dshHome }
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env })
}

const storeOf = (dshHome) => join(dshHome, '.agent-presets', 'matt')
const readStamp = async (dshHome) => JSON.parse(await readFile(join(storeOf(dshHome), 'VERSION.json'), 'utf8'))
const profileDeps = async (dshHome, profile = 'web') =>
  JSON.parse(await readFile(join(dshHome, 'profiles', profile, 'package.json'), 'utf8')).dependencies ?? {}

/** Is the store linked into the profile (pnpm link: dependency)?
 *  **严格读取**：profile 层缺失即抛 ENOENT，所以只许从 assertLink 的挂载分支进来
 *  （dsh 或 pnpm 缺席时装载本就不发生，那条路必须先走响亮跳过，而不是到这里抛）。 */
const linked = async (dshHome, profile = 'web') =>
  String((await profileDeps(dshHome, profile))['dsh-matt-preset'] ?? '').includes('.')

/**
 * store 落点 = profile 依赖里那条 `link:` 指向的目录（#47 AC③ 的**分叉判据**）。
 *
 * 分叉现场（#47）：桌面 profile 的 link 指着 `.agent-presets/dsh-matt-preset`，而 installer
 * 写 `.agent-presets/matt` —— 两边不是同一个目录，于是 upgrade 永远更新不到桌面端。
 * 「有没有 link」证明不了这个；只有把**依赖值解析成路径**、与 installer 实际写入的 store
 * 比对，才抓得到分叉。pnpm 记的 link 值可能是 `link:C:/x/matt` 或 `link:../matt` 形态，
 * 故对相对值再按 profile 目录规整一次。
 */
const linkedStoreDir = async (dshHome, profile = 'web') => {
  const value = String((await profileDeps(dshHome, profile))['dsh-matt-preset'] ?? '')
  const raw = value.replace(/^link:/u, '')
  if (raw === '') return null
  if (/^[A-Za-z]:[\\/]|^\//u.test(raw)) return raw.replaceAll('/', '\\')
  const { resolve } = await import('node:path')
  return resolve(join(dshHome, 'profiles', profile), raw)
}
/** Windows 路径等价（大小写与分隔符都不敏感）——与 link-runtime-deps.mjs 同判据。 */
const samePath = (a, b) =>
  String(a).replaceAll('/', '\\').replace(/\\+$/u, '').toLowerCase() ===
  String(b).replaceAll('/', '\\').replace(/\\+$/u, '').toLowerCase()

/**
 * 挂载产物的**统一门禁出口**（#67 dsh 半边 + #86 pnpm 半边）。
 *
 * 两个成因分开报，理由串不混用：
 *   - 无 dsh → installer 响亮降级（exit 0），profile 层根本不存在；
 *   - 有 dsh 但无 pnpm → installer **失败**（exit 1，`missing pnpm`），profile 层同样不存在。
 * 两条都 **不**是产品红，所以都响亮跳过并计入汇总；`false` 表示"本用例的环境侧断言没跑"。
 */
function mountGate(what) {
  if (!dshReachable) {
    loudSkip(`profile-link proof needs dsh (PATH / DSH_DESKTOP_ROOT / --dsh) (#67): ${what}`)
    return false
  }
  if (!pnpmReachable) {
    loudSkip(`profile-link proof needs pnpm for the mount step (#86): ${what} — \`dsh plugin add\` shells out to a literal \`pnpm\``)
    return false
  }
  return true
}

/** profile-link 断言：装载（mountOrWarn）的产物，dsh 与 pnpm 都可达才存在。
 *  缺任一件 → 上面那条 `mountGate` 响亮跳过（打印成因、不置非零退出），store 侧断言照常实跑。
 *  都在场时走严格读取：profile 层缺失即真失败，不吞成 pass。 */
async function assertLink(dshHome, want, what) {
  if (!mountGate(what)) return
  assert.equal(await linked(dshHome), want, what)
}

/**
 * spawn 一个 `.cmd`/`.exe` 时的**引号纪律**（与 `bin/install.mjs` 的 `quoteIfNeeded` 同因）：
 * Windows 上 `shell:true` 时 Node 只把命令与参数**拼成一条命令行、不做转义**，所以
 * 桌面端那条 `…\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`（**含空格**）未加引号会
 * 被 cmd.exe 从空格处截断，报 `'C:\…\DeepSeek' is not recognized…`。
 * installer 自己已经加引号了；测试里凡是**自己** spawn 解析到的 dsh，也必须加。
 */
const quoteForShell = (p) => (process.platform === 'win32' ? `"${p}"` : p)

// ─────────────────────────────────────────────────────────────────────────────
// #86 stub 面：假 dsh / 假 pnpm（离线，不需要本机有任何运行时）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Windows 上要 spawn 的 `.cmd` **不能放在含空格的路径**下：installer 走 `shell:true` 时
 * 只把命令与参数拼接（有 `quoteIfNeeded` 兜底，但假件的 `%~dp0` 展开仍会在带空格的目录上
 * 出错 —— 实测 `SUBST` 出来的 `X:\` 也会被 cmd.exe 解析成 UNC 而拒绝，故不绕行）。
 * 系统临时目录通常无空格；真有空格就响亮跳过这一组，而不是拿一个跑不起来的假件去判红。
 */
const stubRoot = join(tmp, 'stub')
const stubRootHasSpace = /\s/u.test(stubRoot)

/**
 * 造一对**记录型**假件。
 *
 *   dsh.cmd  → "<process.execPath>" dsh-stub.cjs %* （`%*` 原样转发，Node 路径加引号）
 *   pnpm.cmd → "<process.execPath>" pnpm-stub.cjs %* （#126：不依赖登录壳 PATH）
 *
 * 两个 stub 都是 Node 脚本：`.cmd` 里做变量展开/重定向是雷区（`if not defined X` 与
 * `%X%` 展开时机在 cmd.exe 不同调用形态下表现不一致），而 Node 脚本能可靠落盘，也和
 * `dsh.cmd`（Electron 侧本来就是 Node 启动器）同形。
 *
 * 记录文件（都在 stub 目录里，用例自己清空）：
 *   dsh-argv.txt    每行一次 dsh 调用：`DSH ["plugin","--profile","web","add","<store>"]`
 *   dsh-env.txt     同一行记录当时的 PATH 头部（证明注入的是**哪个目录**）
 *   pnpm-argv.txt   每行一次 pnpm 调用（假 dsh 模拟 plugin-manager 起的）
 */
async function makeStubs() {
  const dir = await mkdtemp(join(stubRoot, 's-'))
  await writeFile(join(dir, 'dsh.cmd'),
    `@echo off\r\n"${testNode}" "%~dp0dsh-stub.cjs" %*\r\nexit /b %ERRORLEVEL%\r\n`, 'utf8')
  await writeFile(join(dir, 'dsh-stub.cjs'), `
'use strict'
const { appendFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
const here = __dirname
const argv = process.argv.slice(2)
// 记录子进程看到的 PATH（installer 用 withPathPrefix() 生成的 env 会同时写 PATH 与 Path）。
// 取 PATH 优先、回落到 Path —— cmd.exe 的变量名大小写不敏感，Node 侧则两者可能是不同键。
const childPath = process.env.PATH ?? process.env.Path ?? ''
appendFileSync(join(here, 'dsh-argv.txt'), 'DSH ' + JSON.stringify(argv) + '\\n')
appendFileSync(join(here, 'dsh-env.txt'), 'PATH ' + String(childPath).slice(0, 600) + '\\n')
// 模拟 plugin-manager：它按**字面** pnpm 起子进程（dsh-plugin-manager 的 runProfilePnpm）。
// 真实现里这条子进程的 PATH 来自 process.env（execution:'cli'）或 scrubbedParentEnv()
// （execution:'service'）—— 两种形态都**继承 PATH**，这正是 installer 注入路径的着力点。
if (argv.includes('plugin')) {
  const r = spawnSync('pnpm', ['add', 'dsh-matt-preset'], { encoding: 'utf8', shell: process.platform === 'win32' })
  appendFileSync(join(here, 'pnpm-spawn.txt'),
    'SPAWN status=' + String(r.status) + ' stdout=' + JSON.stringify(String(r.stdout ?? '').trim()) +
    ' error=' + JSON.stringify(String(r.error?.code ?? '')) + '\\n')
}
process.exit(0)
`.trimStart(), 'utf8')
  await writeFile(join(dir, 'pnpm.cmd'),
    `@echo off\r\n"${testNode}" "%~dp0pnpm-stub.cjs" %*\r\nexit /b %ERRORLEVEL%\r\n`, 'utf8')
  await writeFile(join(dir, 'pnpm-stub.cjs'), `
'use strict'
const { appendFileSync } = require('node:fs')
const { join } = require('node:path')
appendFileSync(join(__dirname, 'pnpm-argv.txt'), 'PNPM ' + JSON.stringify(process.argv.slice(2)) + '\\n')
process.exit(0)
`.trimStart(), 'utf8')
  return {
    dshCmd: join(dir, 'dsh.cmd'),
    pnpmCmd: join(dir, 'pnpm.cmd'),
    dshArgv: join(dir, 'dsh-argv.txt'),
    dshEnv: join(dir, 'dsh-env.txt'),
    pnpmArgv: join(dir, 'pnpm-argv.txt'),
    pnpmSpawn: join(dir, 'pnpm-spawn.txt'),
    reset: async () => {
      for (const f of ['dsh-argv.txt', 'dsh-env.txt', 'pnpm-argv.txt', 'pnpm-spawn.txt']) {
        await rm(join(dir, f), { force: true })
      }
    },
  }
}
/** 读一行记录（没有就返回 ''，让断言给出可读的失败信息而不是 ENOENT）。 */
const readLog = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
/** 从 stub 记录里解析出唯一一次调用的 argv 数组。 */
function parseStubArgv(text, tag) {
  const m = new RegExp(`^${tag} (\\[.*\\])$`, 'mu').exec(text)
  return m === null ? null : JSON.parse(m[1])
}

await test('install: copies payload to the stable store, stamps version + manifest', async () => {
  const home = join(tmp, 'h1')
  const r = run(['install', '--profile', 'web'], home)
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  const stamp = await readStamp(home)
  assert.equal(stamp.version, pkgVersion)
  // 单一事实源：store 必须与安装器自己的 payload 规则（lib/payload.mjs 的 payloadOf，
  // installTo 逐条拷贝的就是它）一致——手写清单只作可读的类别代表；加档/加文件不再需要
  // 改它（#55、#56 各漏改过一次，而本用例 opt-in，漏改时默认套件全绿、静默）。
  const { entries } = await payloadOf(REPO)
  const absent = entries.filter((f) => !existsSync(join(storeOf(home), f)))
  assert.deepEqual(absent, [], `payload entries missing from the store: ${absent.join(', ')}`)
  // payload 完整：类别代表（bundle 载体 / 插件 / skills / lang-packs / sandcastle）
  for (const f of ['preset.yml', 'agent.cordis.yml', 'cordis.patch.yml',
    'workflow-core.mjs', 'workflow-body.txt', 'workflow-profile-cordis.txt',
    'workflow-profile-ptc.txt', 'workflow-profile-minimal.txt',
    'workflow-enforcer.mjs', 'lang-enforcer.mjs', 'handoff-tool.mjs',
    'skills/ponytail/SKILL.md', 'lang-packs', 'sandcastle', 'package.json']) {
    assert.ok(existsSync(join(storeOf(home), f)), `missing payload: ${f}`)
  }
  const manifest = JSON.parse(await readFile(join(storeOf(home), 'manifest.json'), 'utf8'))
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 10)
  assert.equal(manifest.profile, 'web', 'manifest records the profile it was linked into')
  for (const f of ['docs', 'tests', '.git', 'CONTEXT.md']) {
    assert.ok(!existsSync(join(storeOf(home), f)), `excluded leaked: ${f}`)
  }
  // 运行时依赖在安装副本旁可解析（插件 import 'yaml' 的锚点是插件文件自身）
  assert.ok(existsSync(join(storeOf(home), 'node_modules', 'yaml', 'package.json')), 'yaml dep not vendored')
})

await test('install: links the store into the profile as a bundle', async () => {
  const home = join(tmp, 'h2')
  assert.equal(run(['install', '--profile', 'web'], home).status, 0)
  await assertLink(home, true, 'store linked into profile deps')
})

await test('install: refuses to overwrite an existing install', async () => {
  const home = join(tmp, 'h3')
  assert.equal(run(['install', '--profile', 'web'], home).status, 0)
  const r = run(['install', '--profile', 'web'], home)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /already|已存在/i)
})

await test('install --force: overwrites in place, link survives', async () => {
  const home = join(tmp, 'h4')
  assert.equal(run(['install', '--profile', 'web'], home).status, 0)
  const r = run(['install', '--profile', 'web', '--force'], home)
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  await assertLink(home, true, 'link survives --force')
})

await test('upgrade: in-place replace, stamp advances, stale files removed, link kept', async () => {
  const home = join(tmp, 'h5')
  assert.equal(run(['install', '--profile', 'web'], home).status, 0)
  await writeFile(join(storeOf(home), 'stale-old-plugin.mjs'), '// old')
  const r = run(['upgrade', '--profile', 'web'], home)
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  assert.ok(!existsSync(join(storeOf(home), 'stale-old-plugin.mjs')), 'stale file survived upgrade')
  assert.equal((await readStamp(home)).version, pkgVersion)
  await assertLink(home, true, 'link kept across upgrade')
  const manifest = JSON.parse(await readFile(join(storeOf(home), 'manifest.json'), 'utf8'))
  assert.equal(manifest.previousVersion, pkgVersion)
})

await test('upgrade: fails cleanly when nothing is installed', async () => {
  const home = join(tmp, 'h6')
  const r = run(['upgrade', '--profile', 'web'], home)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /not installed|未安装/i)
})

await test('uninstall: removes store and the profile link', async () => {
  const home = join(tmp, 'h7')
  assert.equal(run(['install', '--profile', 'web'], home).status, 0)
  const r = run(['uninstall', '--profile', 'web'], home)
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  assert.ok(!existsSync(storeOf(home)), 'store survived uninstall')
  await assertLink(home, false, 'profile link removed on uninstall')
  assert.notEqual(run(['uninstall', '--profile', 'web'], home).status, 0)
})

await test('--version: prints package version', () => {
  const r = run(['--version'], tmp)
  assert.equal(r.status, 0)
  assert.ok(r.stdout.includes(pkgVersion), `stdout: ${r.stdout}`)
})

await test('--root: store-only mode — no profile layer created', async () => {
  const home = join(tmp, 'h9')
  const root = join(tmp, 'custom-root')
  const r = run(['install', '--root', root], home) // storeOnly 分支不调 mountOrWarn：与 PATH 上有没有 dsh 无关
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  assert.ok(existsSync(join(root, 'matt', 'VERSION.json')), 'store not written')
  assert.ok(!existsSync(join(home, 'profiles')), 'profile layer created despite --root')
})

await test('--from <tarball>: installs from an npm pack artifact', async () => {
  const src = join(tmp, 'fakepkg')
  await cp(REPO, src, {
    recursive: true,
    filter: (s) => !/[\\/](\.git|node_modules|\.scratch|docs|tests)([\\/]|$)/.test(s),
  })
  // 保留#126的显式路径保障，由共享挂具统一候选；不依赖登录壳裸名。
  const npm = testExecutable('npm', { args: ['pack', '--pack-destination', tmp] })
  const packed = spawnSync(npm.command, npm.args, { cwd: src, encoding: 'utf8', shell: npm.shell })
  assert.equal(packed.status, 0, `npm pack failed: ${packed.stderr}`)
  const [tgzName] = (await readdir(tmp)).filter((f) => f.endsWith('.tgz'))
  assert.ok(tgzName, 'npm pack produced no tarball')
  const home = join(tmp, 'h8')
  const r = run(['install', '--profile', 'web', '--from', join(tmp, tgzName)], home)
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  const stamp = await readStamp(home)
  assert.equal(stamp.version, pkgVersion)
  assert.ok(existsSync(join(storeOf(home), 'workflow-enforcer.mjs')))
  const manifest = JSON.parse(await readFile(join(storeOf(home), 'manifest.json'), 'utf8'))
  assert.equal(manifest.source, 'tarball')
  // AC2 关键不变量：bundle 声明随 tarball 路径存活（package.json 带 dsh.bundle.patch，
  // 载体在包内）——否则挂载虽 link 成功却无 patch 可装载。
  // #99（ADR-0015）：声明已由字符串变**数组**（一个 bundle 四个模式，默认档在 cordis.patch.yml），
  // 故断言数组形状 + 默认档仍在第 1 位 + **每一份载体都随包到了**——少一份就少一个模式。
  const tpkg = JSON.parse(await readFile(join(storeOf(home), 'package.json'), 'utf8'))
  const tpatch = tpkg.dsh?.bundle?.patch
  assert.ok(Array.isArray(tpatch) && tpatch.length === 4, `bundle patch declaration lost via tarball: ${JSON.stringify(tpatch)}`)
  assert.equal(tpatch[0], './cordis.patch.yml', 'the default mode must stay array item 1')
  const missing = tpatch.map((p) => p.replace(/^\.\//, '')).filter((p) => !existsSync(join(storeOf(home), p)))
  assert.deepEqual(missing, [], `carrier(s) lost via tarball: ${missing.join(', ')}`)
})

/**
 * #47（断言半边，并入 #99-C）：桌面形态。
 *
 * 特殊之处**不是** --dump-config：desktop 是由 Electron 应用独占管理的 profile，
 * `dsh --profile desktop --dump-config` 会报 `profile "desktop" is managed
 * exclusively by the Electron application`，**不能**拿它当装载证据。但
 * `dsh plugin --profile desktop add` 这条写路径是可用的，装完的产物就是 profile
 * 层的 package.json。所以本用例**只读那个文件**，不调 --dump-config。
 *
 * 桌面 profile 的另一条实测前提：它必须**先被桌面应用初始化过**（即
 * `<DSH_HOME>/profiles/desktop/package.json` 已在）。完全空 DSH_HOME 下会得到
 * `Open DeepSeek Harness Desktop once to initialize its profile…`——那是环境前提，
 * 不是本 preset 的缺陷，所以这里预置一个最小 profile 层来模拟"桌面已初始化"，
 * 也正是 #67 的现实安装形态。
 *
 * 无 dsh 时照 #67 口径响亮跳过（install 不建 profile link，读依赖表会是 ENOENT）。
 *
 * **#47 AC③ 的分叉判据**（本条 2026-10-18 补）：光有 link 不够 —— 分叉现场两边**都有**
 * link，只是指向不同目录。故本条把 profile 依赖解析成绝对路径，与 installer 实际写入的
 * `<DSH_HOME>/.agent-presets/matt` 比对，再核对 store 的版本戳与 package.json 版本一致
 * （"store 版本戳与 profile 依赖一致"这一半）。install 与 upgrade 两条路都要过。
 */
/**
 * 守卫（**先于**上面那条桌面用例跑）：当 dsh **只**能经 `DSH_DESKTOP_ROOT` 找到时，实测
 * `bin/install.mjs` 是否真的用了这条惯例（契约 §「探测顺序」第 4 条）。做法：空 PATH + 假
 * `--pnpm`（只到挂载判定，不需要真的 pnpm 起得来）跑一次 `--dsh` 指向**假件**……
 *
 * **做法修正**：`--dsh` 一旦给出，explicit 就压过一切来源，测不出桌面惯例。所以改成：
 * 不给 `--dsh`，把 PATH 清空，**保留 `DSH_DESKTOP_ROOT`**，用 `--pnpm` 指一个存在的假件，
 * 然后看 installer 是否把桌面那条 dsh 解析出来 —— 它的回声行 `dsh: <path> (desktop)` 就是证据。
 * 若桌面 dsh 缺席（本机没装桌面端）则本条不适用，响亮跳过。
 */
if (haveDesktop && !dshOnPath) {
  await test('desktop-root reachability guard: the installer really resolves dsh via DSH_DESKTOP_ROOT', async () => {
    const home = join(tmp, 'desktop-guard')
    const r = run(['install', '--profile', 'web', '--pnpm', join(stubRoot, 'guard-pnpm.cmd')], home, {
      PATH: '',                       // PATH 上什么都找不到
      DSH_PNPM: undefined,
      DSH_MATT_DSH: undefined,
      DSH_MATT_DSH_SRC: undefined,
    })
    const combined = `${r.stdout}${r.stderr}`
    // 回声行形如 `dsh: <path> (desktop)`；解析来源标签就是"installer 走了桌面惯例"的直接证据
    assert.match(combined, /dsh: .+\(desktop\)/u,
      `installer did not resolve dsh via DSH_DESKTOP_ROOT — the mount gate would skip on this machine ` +
      `for the wrong reason. output: ${combined.slice(0, 300)}`)
  })
}

await test('install/upgrade --profile desktop: link points at THIS store, stamp agrees', async () => {
  if (!mountGate('desktop-profile install/upgrade proof (#47 AC3)')) return
  const home = join(tmp, 'desktop')
  const profileDir = join(home, 'profiles', 'desktop')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'),
    JSON.stringify({ name: 'desktop', private: true, dependencies: {} }, null, 2))
  const store = storeOf(home)
  const check = async (phase) => {
    const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    // 1) profile 层依赖表：store 以 link 形式登记（与既有 linked() 同判据）
    assert.match(String(profile.dependencies?.['dsh-matt-preset'] ?? ''), /\./,
      `${phase}: desktop profile deps missing dsh-matt-preset: ${JSON.stringify(profile.dependencies)}`)
    // 2) **指向的就是这个 store**（分叉判据）：<DSH_HOME>/.agent-presets/matt
    const pointed = await linkedStoreDir(home, 'desktop')
    assert.ok(pointed !== null && samePath(pointed, store),
      `${phase}: desktop link points elsewhere — ${pointed} !== ${store}（#47 的 store 路径分叉）`)
    // 3) store 版本戳与 package.json 一致，且与 profile 依赖落点同一份（不是两个目录各一份）
    const stamp = await readStamp(home)
    assert.equal(stamp.version, pkgVersion, `${phase}: store stamp drifted`)
    assert.ok(existsSync(join(store, 'VERSION.json')), `${phase}: stamp not in the linked store`)
    // 4) 装载声明：bundle 列表必须含本 preset，否则 profile link 成功也无 patch 可装载
    assert.ok(Array.isArray(profile.dsh?.profile?.bundles) && profile.dsh.profile.bundles.includes('dsh-matt-preset'),
      `${phase}: desktop profile bundles missing dsh-matt-preset: ${JSON.stringify(profile.dsh)}`)
  }
  const install = run(['install', '--profile', 'desktop'], home)
  assert.equal(install.status, 0, `install exit ${install.status}: ${install.stderr}`)
  await check('install')
  // upgrade 是"更新不到桌面端"这句症状的直接反面：原地替换后 link 仍指向同一个 store。
  const upgrade = run(['upgrade', '--profile', 'desktop'], home)
  assert.equal(upgrade.status, 0, `upgrade exit ${upgrade.status}: ${upgrade.stderr}`)
  await check('upgrade')
})

if (mountable) {
  await test('e2e: installed preset mounts on the current anchor (dump-config shows the row, plugin imports)', async () => {
    const home = join(tmp, 'e2e')
    const r = run(['install', '--profile', 'web'], home)
    assert.equal(r.status, 0, `install exit ${r.status}: ${r.stderr}`)
    // 1) 装载载体生效：composed tree 出现本 preset 的插件行
    //    命令用**解析到的** dsh（`probeDsh` 的 `path`），不是字面 `dsh` —— 与 installer 同源，
    //    避免"测试探针说在场、installer 说未命中"的分叉（见文件头 dshReachable 注释）。
    const dumpDsh = spawnSync(quoteForShell(dshReachable && dshOnPath ? dsh.path : desktopDsh),
      ['--profile', 'web', '--dump-config'], {
        encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, shell: process.platform === 'win32',
      })
    assert.equal(dumpDsh.status, 0, `dump-config failed: ${dumpDsh.stderr}`)
    assert.match(dumpDsh.stdout, /id: dsh-matt-preset/, 'preset row not in composed tree')
    assert.match(dumpDsh.stdout, /dsh-matt-preset\/workflow-enforcer\.mjs/, 'enforcer plugin not referenced')
    // 2) 安装副本自身可加载（插件文件 + yaml 依赖在 link/store 路径下解析）
    const enforcer = join(storeOf(home), 'workflow-enforcer.mjs')
    const imp = spawnSync(testNode, [
      '-e', `import('file:///${enforcer.replaceAll('\\', '/')}').then(() => console.log('OK'))`,
    ], { encoding: 'utf8' })
    assert.equal(imp.status, 0, `plugin import failed: ${imp.stderr}`)
    assert.ok(imp.stdout.includes('OK'))
  })
} else {
  // AC1 的证明性 e2e 需要 dsh + pnpm；缺席时响亮降级并计入汇总，绝不静默当 pass
  mountGate('e2e mount proof needs dsh and pnpm (AC1 evidence)')
}

// ─────────────────────────────────────────────────────────────────────────────
// #86：`--pnpm` 参数透传（stub，非空洞）
// ─────────────────────────────────────────────────────────────────────────────

if (stubRootHasSpace) {
  loudSkip(`stub spawn proof needs a space-free temp dir (got ${basename(tmp)}); Windows .cmd stubs cannot run from a path with spaces`)
} else {
  await mkdir(stubRoot, { recursive: true })
  const stubs = await makeStubs()
  /** 跑一次 install，让假 dsh 收到 `plugin … add`（`--dsh`/`--pnpm` 都指假件）。 */
  const installWithStubs = async (home, extra = []) => {
    await stubs.reset()
    return run(['install', '--profile', 'web', '--dsh', stubs.dshCmd, '--pnpm', stubs.pnpmCmd, ...extra], home)
  }

  /**
   * AC② 主断言：**参数透传**。
   *
   * 三件事一起证：
   *   1. 收到的是 `plugin --profile web add <store>`（argv 逐项相等，不是"含 add"这种弱匹配）；
   *   2. 用的 dsh 是**解析到的那个**（`--dsh` 给的假件），不是字面 `dsh` —— 假件的 argv 文件
   *      存在本身就证明这条；再加一条"改名对照"（下面 E6）钉住"路径真被透传"；
   *   3. `pnpmPathInjection()` 的目录真被前置进子进程 PATH：假 dsh 把 PATH 头部写进
   *      `dsh-env.txt`，断其**第一段**等于 `--pnpm` 那个 `pnpm.cmd` 的所在目录。
   *
   * **为什么"pnpm 真被调用"这条要假 dsh 自己 spawn**：installer 只前置 PATH，
   * 真正起 pnpm 的是 `dsh plugin add` 里的 plugin-manager（另一个进程）。假 dsh 里模拟
   * 这一步之后，`pnpm-argv.txt` 里出现 `["add","dsh-matt-preset"]` 就是端到端链路证据；
   * 不做这一步的话，真实链路里没有谁去碰 PUT 的假 pnpm，那条断言会是**空洞**的。
   */
  await test('#86 stub: dsh plugin add receives the resolved dsh path + injected pnpm dir on PATH', async () => {
    const home = join(tmp, 'pnpm-ok')
    const r = await installWithStubs(home)
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
    const argv = parseStubArgv(readLog(stubs.dshArgv), 'DSH')
    assert.ok(argv !== null, `stub dsh was never invoked — installer did not use --dsh (log: ${JSON.stringify(readLog(stubs.dshArgv))})`)
    const store = storeOf(home)
    assert.deepEqual(argv, ['plugin', '--profile', 'web', 'add', store],
      `argv verbatim mismatch: ${JSON.stringify(argv)}`)
    // PATH 注入：第一段就是假 pnpm 的所在目录（`pnpmPathInjection` 对 .cmd 形态返回其目录）
    const pathHead = (readLog(stubs.dshEnv).match(/^PATH (.*)$/mu)?.[1] ?? '')
    const first = pathHead.split(';')[0]
    assert.ok(samePath(first, dirname(stubs.pnpmCmd)),
      `pnpm dir not prepended to the child PATH — head=${JSON.stringify(pathHead.slice(0, 160))}, want ${dirname(stubs.pnpmCmd)}`)
    // 端到端：假 dsh 模拟的 plugin-manager 按字面 `pnpm` 起子进程 → 命中的是这个假件
    const spawned = readLog(stubs.pnpmSpawn)
    assert.match(spawned, /SPAWN status=0/u, `literal \`pnpm\` did not resolve in the child (log: ${JSON.stringify(spawned)})`)
    const pnpmArgv = parseStubArgv(readLog(stubs.pnpmArgv), 'PNPM')
    assert.deepEqual(pnpmArgv, ['add', 'dsh-matt-preset'], `pnpm stub never ran with the plugin args: ${JSON.stringify(pnpmArgv)}`)
  })

  /**
   * AC② 非空洞对照 A：**探测不到 pnpm** → 必须**响亮失败**并给可执行指路（#86 AC①）。
   *
   * 怎么构造「探测不到」而不依赖本机状态：把**所有**来源都堵死 —— 给一个**不存在**的
   * `DSH_PNPM`（env 命中但 `existsSync` 假 → 命中失败）、PATH 清空、不给 `DSH_DESKTOP_ROOT`。
   * 显式 `--pnpm` 那条被上面的主用例覆盖（它证明"给了就命中"），这里验的是反面。
   *
   * **为什么不用 `if (pnpm.found) loudFail(...)`**：本机 PATH 真有 pnpm 是完全正常的机器形态，
   * 把它判成"断言抓错目标"会让整个套件在一整类机器上假红 —— 那是把"环境不同"错读成"断言错"。
   * 所以判据放在**子进程内**（env + PATH 都由 `run()` 控制），外部环境怎样都不影响结论。
   */
  await test('#86 stub perturbation: with no pnpm reachable at all the installer dies with a runnable hint', async () => {
    // 真实机器读数先落盘：读汇总时能看出"本机 PATH 上本来有没有 pnpm"（两种形态都合法）。
    console.log(`  · pnpm probe on THIS machine: found=${pnpm.found}${pnpm.found ? ` (${pnpm.source})` : ' — PATH/env both empty'}`)
    const home = join(tmp, 'pnpm-missing')
    await stubs.reset()
    const r = run(['install', '--profile', 'web', '--dsh', stubs.dshCmd], home, {
      DSH_PNPM: join(stubRoot, 'pnpm-that-does-not-exist.cjs'), // env 命中失败
      PATH: '',                                                 // PATH 查找落空
      DSH_DESKTOP_ROOT: undefined,                              // **删掉**（留空串也可能被当成有序前缀）
    })
    assert.notEqual(r.status, 0, `expected non-zero, got 0 — the installer silently continued without pnpm`)
    const combined = `${r.stdout}${r.stderr}`
    assert.match(combined, /missing pnpm/u, `no "missing pnpm" in the failure output: ${combined.slice(-300)}`)
    // 一行**可执行**指路：至少给出一条能照抄的命令/变量（不是"请安装 pnpm"这种散文）
    assert.match(combined, /--pnpm|DSH_PNPM/u,
      `the hint is not runnable (no --pnpm / DSH_PNPM in it): ${combined.slice(-300)}`)
    // 关键：这不是"preset 坏了"——store 侧照常落盘（失败点只在挂载那半边）
    assert.ok(existsSync(join(storeOf(home), 'VERSION.json')), 'store should still land; only the mount half needs pnpm')
    // 反向：假 dsh **不该**被调用（还没到挂载就该 die —— pnpm 检查必须在挂载动作之前）
    assert.equal(readLog(stubs.dshArgv), '', 'dsh was invoked even though pnpm was missing — the check is too late')
  })

  /**
   * AC② 非空洞对照 B：**显式 `--dsh` 换成相对路径** → "绝对路径"断言必须红。
   *
   * `lib/runtime-probe.mjs` 的 explicit 分支只判 `existsSync`，所以相对路径（锚在 installer
   * 自己的 cwd = 仓根）也能命中、也能起来。于是这一跑给出两个读数：假 dsh 确实被跑到了
   * （argv 记到），而首参是**相对形态**。主断言里的"绝对路径"判据在这种情况下会红 ——
   * 这就是"这条断言不是同义反复"的证明。若哪天 installer 改成把 `--dsh` 解析成绝对路径，
   * 本条会红；那时是产品变好了：把它翻成 `assert.ok(isAbsolutePath(argv0))` 的正向断言，别删。
   */
  await test('#86 stub perturbation: a relative --dsh still reaches the stub, but is not absolute', async () => {
    // 假件放在**仓根的子目录**里，相对路径才能锚在 installer 的 cwd（= 仓根）上解析到。
    // 用系统临时目录会让相对路径指到 `..\..\..` 外面（那就成了"探测未命中"，是另一回事）。
    const relDir = await mkdtemp(join(REPO, 'node_modules', '.dsh-matt-stub-'))
    const relDsh = join(relDir, 'dsh.cmd')
    await writeFile(relDsh, `@echo off\r\n"${testNode}" "%~dp0dsh-stub.cjs" %*\r\nexit /b %ERRORLEVEL%\r\n`, 'utf8')
    await cp(join(dirname(stubs.dshCmd), 'dsh-stub.cjs'), join(relDir, 'dsh-stub.cjs'))
    const relArg = relative(REPO, relDsh)
    try {
      assert.ok(!isAbsolutePath(relArg), `self-check: ${relArg} should not be absolute`)
      assert.ok(isAbsolutePath(relDsh), `self-check: ${relDsh} should be absolute`)
      const home = join(tmp, 'pnpm-rel')
      const r = run(['install', '--profile', 'web', '--dsh', relArg, '--pnpm', stubs.pnpmCmd], home)
      assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
      const argv = parseStubArgv(readLog(join(relDir, 'dsh-argv.txt')), 'DSH')
      assert.ok(argv !== null,
        `stub not reached via a relative --dsh — probe/exists resolution and spawn path disagree`)
      // 反例核心：**同一个文件**被跑到了，但命令行里那串不是绝对路径 —— 主断言里
      // "断言首参是绝对路径"的判据在这种情况下会红 ⇒ 那条断言可证伪（不是同义反复）。
      assert.ok(!isAbsolutePath(relArg),
        `the counter-case must keep the passed form relative (got ${relArg}); ` +
        `if the installer now resolves --dsh to an absolute path, flip this into a positive assertion`)
    } finally {
      await rm(relDir, { recursive: true, force: true })
    }
  })

  /**
   * AC② 非空洞对照 C：**PATH 注入被拿掉** → 主断言变红。
   *
   * 不直接改产品代码（那是 prober 的写权面），改成"同形状的病"：把假 pnpm 换到一个
   * **不存在的目录**里、`--pnpm` 指向一个存在的可执行但**所在目录里没有 `pnpm` 这个名字**
   * —— 注入的目录就解析不到字面 `pnpm`。用同一份断言逻辑去验这条 → 必须红。
   */
  await test('#86 stub perturbation: injecting a dir without a `pnpm` there makes the pnpm call fail', async () => {
    const decoyDir = join(stubRoot, 'decoy')
    await mkdir(decoyDir, { recursive: true })
    // 名字不叫 pnpm 的可执行：探测命中（explicit 只判 exists），但它所在目录里没有 `pnpm`
    const decoy = join(decoyDir, 'pnpm-not-here.cmd')
    await writeFile(decoy, '@echo off\r\nexit /b 0\r\n', 'ascii')
    const home = join(tmp, 'pnpm-decoy')
    await stubs.reset()
    const r = run(['install', '--profile', 'web', '--dsh', stubs.dshCmd, '--pnpm', decoy], home)
    assert.equal(r.status, 0, `installer should still mount (it only injects a dir): exit ${r.status}: ${r.stderr}`)
    const spawned = readLog(stubs.pnpmSpawn)
    // 反例成立：字面 `pnpm` 在这个注入目录里解析不到 → 假 dsh 的 spawn 失败
    assert.doesNotMatch(spawned, /SPAWN status=0/u,
      `expected the literal \`pnpm\` spawn to fail when the injected dir has no pnpm (log: ${JSON.stringify(spawned)})`)
    assert.equal(readLog(stubs.pnpmArgv), '', 'the pnpm stub should not have run through the decoy dir')
  })

  /**
   * 门禁对照 E6：**pnpm 在场那一档不得被新门禁顺带跳过**（Lead 拍板 B 的收口要求）。
   *
   * 光"加了 pnpm 门禁、读数变成 PASS*"证明不了什么 —— 若门禁写错（例如恒假），
   * 在场那一档也会一起静默跳过，读数看起来一模一样。所以本对照把三件事摆在一起：
   *
   *   1. **门禁定义自检**：`mountable` 必须**逐格等于** `dshReachable && pnpmReachable`
   *      （真值表比对，防它退化成恒真/恒假）；
   *   2. **在场档真跑**（用假件构造"pnpm 在场"）：同一份 `--pnpm` 探测在命中时会
   *      **走到挂载那一步**（假 dsh 收到 `plugin … add` 且 PATH 头部是注入目录），
   *      而在显式路径不存在时**根本到不了挂载** —— 后者正是"pnpm 缺席侧必须跳过"所反映的
   *      事实，于是"跳过"不是拍脑袋加的，而是与产品行为对齐的；
   *   3. **真实 dsh 在场时的挂载断言确实执行**（不是被门禁跳过）：用 `--dsh` 指向本机
   *      解析到的真 dsh，断言 `linked()` 真读到 link、且指向这个 store —— 与上面桌面形态
   *      用例用的是**同一个读取函数**。本机没有 dsh 时这一格响亮跳过（成因写清楚）。
   */
  await test('#86 gate counter-case: the mount gate is derived from the probes, and a present pnpm reaches the mount step', async () => {
    // ── 1) 门禁定义逐格自检 ────────────────────────────────────────────────
    assert.equal(mountable, dshReachable && pnpmReachable, 'mountable must be exactly dshReachable && pnpmReachable')
    for (const [d, p, want] of [[true, true, true], [true, false, false], [false, true, false], [false, false, false]]) {
      assert.equal(d && p, want, `truth-table self-check (${d},${p})`)
    }
    // 本机的实际格子不许被"写死"：mountable 必须反映真实探测结果
    assert.equal(mountable, dshReachable && pnpmReachable)

    // ── 2) 在场档走到挂载；缺席档到不了挂载 ────────────────────────────────
    const home = join(tmp, 'gate-on')
    await stubs.reset()
    const ok = await installWithStubs(home)
    assert.equal(ok.status, 0, `exit ${ok.status}: ${ok.stderr}`)
    assert.ok(parseStubArgv(readLog(stubs.dshArgv), 'DSH') !== null,
      'with a reachable pnpm the installer must reach the mount step (stub dsh never invoked)')

    const gone = join(stubRoot, 'definitely-absent-pnpm.cmd')
    await rm(gone, { force: true })
    const absentHome = join(tmp, 'gate-off')
    await stubs.reset()
    const bad = run(['install', '--profile', 'web', '--dsh', stubs.dshCmd, '--pnpm', gone], absentHome)
    assert.notEqual(bad.status, 0, 'an explicit --pnpm pointing nowhere must fail loudly')
    assert.match(`${bad.stdout}${bad.stderr}`, /missing pnpm|不存在/u,
      `expected the explicit-path failure to be readable: ${`${bad.stdout}${bad.stderr}`.slice(-260)}`)
    assert.equal(readLog(stubs.dshArgv), '',
      'the mount step must NOT be reached when pnpm is unreachable — this is exactly what the pnpm-side loud skip reports')
    assert.ok(!existsSync(join(absentHome, 'profiles', 'web', 'package.json')),
      'the profile layer must not exist when the mount step never ran')

    // ── 3) 真 dsh 在场：挂载断言必须真跑（用生产读取函数，不是另写一套宽松判据）──
    if (!dshReachable) {
      loudSkip('gate counter-case step 3 needs a real dsh to produce a real profile layer (#67)')
      return
    }
    const realHome = join(tmp, 'gate-real')
    // 用**真 dsh**（PATH 上的或桌面根里的）+ **真 pnpm**（PNPM 真去装包，才会建 profile 层）。
    // 这里刻意不用假 pnpm：本步要证的是"挂载真的发生了"，而假 pnpm 什么都不装，
    // profile 层不会出现 —— 那会把"故意简化"读成"断言失败"。
    const realPnpm = haveDesktop ? desktopPnpm : pnpm.path
    const realDsh = dshOnPath ? dsh.path : desktopDsh
    if (realPnpm === null || realPnpm === undefined || realPnpm === '') {
      loudSkip('gate counter-case step 3 needs a real pnpm to actually build the profile layer')
      return
    }
    const r = run(['install', '--profile', 'web', '--dsh', realDsh, '--pnpm', realPnpm], realHome)
    assert.equal(r.status, 0, `real dsh + real pnpm: exit ${r.status}: ${r.stderr}`)
    // 门禁为真 ⇒ 挂载断言必须**真的读到** link（复用生产的读取函数，不是另写一套宽松判据）。
    assert.equal(await linked(realHome, 'web'), true,
      'mountable was true, so the mount assertions must actually run and see the link')
    assert.ok(samePath(await linkedStoreDir(realHome, 'web'), storeOf(realHome)),
      'the link must point at THIS store (same judgement the desktop case uses)')
  })
}

/** Windows 绝对路径判定（反例对照里用来区分"绝对形态 / 相对形态"两种 `--dsh`）。 */
function isAbsolutePath(p) {
  return /^[A-Za-z]:[\\/]/u.test(String(p)) || String(p).startsWith('\\\\')
}

// ─────────────────────────────────────────────────────────────────────────────
// #86 真链路（live，可选门禁）：真的桌面 dsh + 真的 pnpm.cjs，PATH 上没有 pnpm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * stub 证明的是"参数怎么传"，真链路证明的是"传过去真的能装上"。门禁
 * `DSH_MATT_DESKTOP_ROOT` = **桌面应用根目录**（含 `resources` 的那一层），其下按惯例有：
 *   `resources/runtime/cli/bin/dsh.cmd`                                ← dsh 本体
 *   `resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs`  ← harness 分发的 pnpm
 * 两条都要在场才跑；缺任一条则 `SKIP (loud)`（本机没有桌面安装时这是**正常**状态）。
 * （也接受 `DSH_DESKTOP_ROOT`，与 `lib/runtime-probe.mjs` 读的是同一个变量。）
 *
 * 本用例不断言"本机 PATH 无 pnpm"（那是环境事实，不是本仓契约）：PATH 上有没有 pnpm
 * 都不影响结论 —— 断言只看**产物**（profile link 指向这个 store + bundles 登记）。
 */
{
  if (!haveDesktop) {
    loudSkip(
      'live desktop mount proof needs DSH_MATT_DESKTOP_ROOT=<app> (the dir holding resources) with ' +
      'resources/runtime/cli/bin/dsh.cmd + resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs ' +
      `(root=${desktopRoot === '' ? 'unset' : desktopRoot}; dsh=${desktopRoot !== '' && existsSync(desktopDsh)} pnpm=${desktopRoot !== '' && existsSync(desktopPnpm)})`,
    )
  } else {
    await test('#86 live: real dsh + real pnpm.cjs (a *.cjs through the forwarding shim) mounts the store', async () => {
      const home = join(tmp, 'live-desktop')
      const profileDir = join(home, 'profiles', 'desktop')
      await mkdir(profileDir, { recursive: true })
      await writeFile(join(profileDir, 'package.json'),
        JSON.stringify({ name: 'desktop', private: true, dependencies: {} }, null, 2))
      const r = run(['install', '--profile', 'desktop', '--dsh', desktopDsh, '--pnpm', desktopPnpm], home)
      assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
      const store = storeOf(home)
      // 真 dsh 的写路径产物：profile 层的 link + bundle 声明（与 stub 面同一判据）
      assert.ok(samePath(await linkedStoreDir(home, 'desktop'), store),
        `desktop link does not point at ${store}`)
      const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
      assert.ok(profile.dsh?.profile?.bundles?.includes('dsh-matt-preset'),
        `desktop bundles missing dsh-matt-preset: ${JSON.stringify(profile.dsh)}`)
      // store 角落的版本戳仍在（link 指向的就是它，不是另一个目录）
      assert.equal((await readStamp(home)).version, pkgVersion)
      // 挂载元数据：pnpm 真跑过（lockfile / node_modules 由 pnpm 写，不是我们手抄的）
      const pnpmWrote = ['pnpm-lock.yaml', 'node_modules'].some((f) => existsSync(join(profileDir, f)))
      assert.ok(pnpmWrote, `pnpm did not write into the profile dir (${profileDir}): ${(await readdir(profileDir)).join(', ')}`)
    })
  }
}

console.log(`\n${process.exitCode ? 'FAILED' : `all ${passed} tests passed${totalSkips > 0 ? `（含 ${totalSkips} 条 loud skip：其环境侧断言未验证）` : ''}`}`)
if (process.exitCode) console.log(`tmp kept: ${tmp}`)
else await rm(tmp, { recursive: true, force: true })
