#!/usr/bin/env node
/**
 * install.mjs — dsh-matt-preset installer（#21 copy-installer + #28 bundle 装载）。
 *
 * 两段式：
 *   1) 稳定存储：payload 整目录拷入 $DSH_HOME/.agent-presets/matt/，写版本戳
 *      （VERSION.json / manifest.json），运行时依赖 yaml 随副本走——回滚 = 用
 *      旧版本重新 install（--force 覆盖），旧 tag ↔ 旧 npm 版本一一对应
 *      （docs/RELEASE.md）。
 *   2) 装载挂载：rc.2 的 preset 注册表不做目录扫描（#28 根因），装载机制是
 *      bundle patch——把存储目录经 `dsh plugin --profile <p> add` 链入 profile，
 *      package.json 的 dsh.bundle.patch（→ cordis.patch.yml，由
 *      #6 载体生成/锁定）随之生效。
 *
 * 用法：
 *   dsh-preset-install install  [--profile <name>] [--from <tarball|dir>] [--force]
 *   dsh-preset-install upgrade  [--profile <name>] [--from <tarball|dir>]
 *   dsh-preset-install uninstall [--profile <name>]
 *   dsh-preset-install --version
 *   # 运行时覆盖（#47 方向 C / #86）：显式指出用哪个 dsh / pnpm
 *   dsh-preset-install install --dsh <path/to/dsh> --pnpm <path/to/pnpm>
 *
 * #21 的 --root（存储根覆盖）仍受支持，用于测试/非默认布局；profile 挂载
 * 一律走 DSH_HOME/profiles/<name>。
 *
 * 运行时探测（#47 + #86，契约见 lib/runtime-probe.mjs）：挂载前先解析 dsh 与 pnpm，
 * 顺序 = `--dsh`/`--pnpm` → `DSH_MATT_DSH`/`DSH_PNPM` → PATH → `DSH_DESKTOP_ROOT` 惯例
 * → `DSH_MATT_DSH_SRC` 惯例。**用解析到的 dsh** 调 `dsh plugin`（不是字面 `dsh`——桌面端
 * 的 dsh 可能不在 PATH 上，字面调用会落到另一个实例或根本没有）；pnpm 按字面找（rc.2
 * plugin-manager 就是字面 `pnpm`），命中的目录前置进子进程 PATH。
 * 两者**只在真要挂载**时才要求：`--version` / `--root` 纯 store 操作不受影响（#86 AC④）。
 *
 * 路径安全（2026-10-18 事故硬化，docs/dev-environment.md §1）：`DSH_HOME`、store 根、以及
 * 每一次 `rm` 的目标都先过 lib/safe-target.mjs 的**纯路径判定**——等于用户 profile、
 * 是它的祖先、或盘根，一律 die；`uninstall` / 覆盖安装前还要求目标带本包的归属标记，
 * 杜绝「删的不是我们的目录」。
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { payloadOf } from '../lib/payload.mjs'
import { dshRunner, probeDsh, probeFailureHint, probePnpm, pnpmPathInjection } from '../lib/runtime-probe.mjs'
import { homeRootProblem, targetProblem } from '../lib/safe-target.mjs'

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url))
const PKG_NAME = 'dsh-matt-preset'
/** Payload 插件在运行时 import 的依赖（workflow-enforcer → yaml）：随安装副本走。 */
const RUNTIME_DEPS = ['yaml']

function die(msg) {
  console.error(`dsh-preset-install: ${msg}`)
  process.exit(1)
}

/** 取选项值：缺值（末尾 / 紧跟着另一个选项）立即 die。
 *  旧实现是 `args.root = argv[++i]`——`--root` 落在命令行末尾时得到 `undefined`，
 *  于是 `args.root !== undefined` 为 false、静默回落到 `defaultStoreRoot()`（**真实 home**），
 *  「看起来隔离、实际打到真实 home」正是 2026-10-18 事故的一环。 */
function requireValue(argv, i, flag) {
  const value = argv[i]
  if (value === undefined || value.startsWith('--')) die(`${flag} requires a value`)
  return value
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--version') args.version = true
    else if (a === '--force') args.force = true
    else if (a === '--root') args.root = requireValue(argv, ++i, a)
    else if (a === '--from') args.from = requireValue(argv, ++i, a)
    else if (a === '--profile') args.profile = requireValue(argv, ++i, a)
    else if (a === '--dsh') args.dsh = requireValue(argv, ++i, a)
    else if (a === '--pnpm') args.pnpm = requireValue(argv, ++i, a)
    else if (a.startsWith('--')) die(`unknown option: ${a}`)
    else args._.push(a)
  }
  return args
}

/** DSH_HOME：默认 `~/.dsh`，但**先过形态检查**——等于用户 profile / 它的祖先 / 盘根一律 die。
 *  事故现场：`DSH_HOME=C:\Users\<user>`（profile 根）下安装器照写不误，把 store 和 profile
 *  落到了用户主目录里（`~\\.agent-presets`、`~\\profiles`）。 */
function dshHome() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const problem = homeRootProblem(home)
  if (problem !== null) {
    die(`${problem} — refusing to use it as DSH_HOME。请显式指定隔离目录（docs/dev-environment.md §1 隔离契约）`)
  }
  return home
}

function defaultStoreRoot() {
  if (process.env.DSH_MATT_ROOT) return process.env.DSH_MATT_ROOT
  return join(dshHome(), '.agent-presets')
}

/** 走 shell 时的引号处理：含空格/制表符才加双引号（已是引号包裹的原样保留）。
 *  只处理路径类参数——它们不含 `"`，故不需要完整 cmd.exe 转义。#47 实测需要。 */
function quoteIfNeeded(value) {
  const s = String(value)
  if (s === '' || /^".*"$/.test(s)) return s
  return /[\s]/.test(s) ? `"${s}"` : s
}

/** Run dsh (or node) and die with its stderr on failure.
 *  `env` 可选：挂载/卸载要把 pnpm 目录前置进子进程 PATH（#86）——只有这两条
 *  `dsh plugin` 调用需要注入，其余调用原样继承父进程环境。
 *
 *  **带空格的路径必须显式加引号**（#47 实测）：Windows 上用 `shell:true` 起 `.cmd` 时
 *  Node 只把命令与参数**拼接**成一条命令行，不做转义；桌面端运行时常在
 *  `…\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd` 这类**含空格**的路径下，
 *  未加引号会被 cmd.exe 从空格处截断（实测报 `'<安装根>\DeepSeek' is not recognized…`，
 *  即命令行在第一个空格处被切断）。这里只在走 shell 时对命令与每个参数按需加引号。 */
function runOrDie(cmd, cmdArgs, what, env = null) {
  const useShell = process.platform === 'win32' && cmd !== process.execPath
  const spawnCmd = useShell ? quoteIfNeeded(cmd) : cmd
  const spawnArgs = useShell ? cmdArgs.map(quoteIfNeeded) : cmdArgs
  const r = spawnSync(spawnCmd, spawnArgs, {
    encoding: 'utf8',
    shell: useShell,
    ...(env === null ? {} : { env }),
  })
  if (r.status !== 0) die(`${what} failed (exit ${r.status}):\n${r.stderr || r.stdout}`)
  return r
}

/** 把目录前置进 PATH（生成子进程 env；不改本进程环境）。
 *  Windows 的键名惯用 `Path`，两个都写，避免子进程只读到一个。 */
function withPathPrefix(dir) {
  const env = { ...process.env }
  const sep = process.platform === 'win32' ? ';' : ':'
  const existing = env.PATH ?? env.Path ?? ''
  const merged = existing === '' ? dir : `${dir}${sep}${existing}`
  env.PATH = merged
  env.Path = merged
  return env
}

/**
 * 解析运行时（#47 方向 C + #86）：把「用哪个 dsh / 哪个 pnpm」算成一份结果，
 * 只算一次、挂载与卸载共用。返回 `{ dsh, pnpm, pnpmDir }`。
 *
 * `pnpm` 的命中判定推迟到**真要挂载**时（mountOrWarn）——`--version` / `--root` 纯 store
 * 操作不要求 pnpm（#86 AC④）。dsh 未命中时**不 die**：调用方要降级成一行响亮告警。
 */
function resolveRuntime({ dsh: explicitDsh, pnpm: explicitPnpm }) {
  const dsh = probeDsh({ explicit: explicitDsh ?? null })
  const pnpm = probePnpm({ explicit: explicitPnpm ?? null })
  return { dsh, pnpm, pnpmDir: null }
}

/**
 * 本进程建过的 pnpm shim 目录（#77）。脚本形态下 `pnpmPathInjection` 只能给出一个
 * **随机名临时目录**，而它的契约是「调用方拥有 mkdtemp 出来的那个目录」（模块自己不
 * 隐式写盘）——清理责任因此落在调用方，不做就是**每次挂载漏一个** `dsh-matt-pnpm-*`
 * （2026-10-18 实测：79 个 / 一轮 installer 套件）。
 *
 * 两步保证不留垃圾：
 *   ① 步骤跑完就地删（`dropPnpmShim`，正常路径）；
 *   ② `process.on('exit')` 兜底 —— `die()` 走 `process.exit(1)`，**不会**展开 finally，
 *      而 shim 已经建出来了（例：`dsh plugin add` 失败）。
 * 清理失败一律吞掉：删垃圾失败不得把一次成功的安装改成失败。
 */
const pnpmShims = new Set()
let pnpmShimHookInstalled = false

function trackPnpmShim(dir) {
  pnpmShims.add(dir)
  if (!pnpmShimHookInstalled) {
    pnpmShimHookInstalled = true
    process.on('exit', () => {
      for (const d of pnpmShims) {
        try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }) } catch { /* best-effort */ }
      }
    })
  }
  return dir
}

/**
 * 用完即清：删掉 shim 目录并摘除跟踪（幂等；`pnpmDir` 归 null）。
 *
 * **删成功才摘跟踪**（两轴复核 J1）：先摘再删的话，一旦 `rmSync` 失败（子进程仍占着该目录
 * 为 cwd 等），这个目录就**永久脱离跟踪集** —— `process.on('exit')` 的第二道防线被自己
 * 毁掉，且失败被 catch 吞成静默。留在跟踪集里则最多是多试一次（幂等、无害）。
 */
function dropPnpmShim(runtime) {
  const dir = runtime.pnpmDir
  runtime.pnpmDir = null
  if (dir === null || !pnpmShims.has(dir)) return
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    pnpmShims.delete(dir)
  } catch { /* best-effort：本次失败 → 留在跟踪集，交给 exit 钩子再试一次 */ }
}

/** PNPM 在场时取出要前置的目录；脚本形态（harness 分发的 `pnpm.cjs`）在这里生成转发 shim。 */
function pnpmDirFor(pnpm) {
  const injected = pnpmPathInjection(pnpm, {
    mkdtemp: (prefix) => trackPnpmShim(mkdtempSync(join(tmpdir(), prefix))),
    writeFile: (p, content) => writeFileSync(p, content),
  })
  return injected.dir
}

/** Link the store into the profile: the bundle-patch mount step (#28).
 *  `dsh plugin --profile <p> add` creates the profile layer when absent
 *  (shipped names like `web` included), so no template bootstrap is needed.
 *  命令用**解析到的** dsh（`--dsh`/`DSH_MATT_DSH`/PATH/桌面/源码检出），不是字面 `dsh`（#47）。 */
function mount(profile, store, runtime) {
  const { cmd, prefix } = dshRunner(runtime.dsh)
  runOrDie(cmd, [...prefix, 'plugin', '--profile', profile, 'add', store],
    `dsh plugin --profile ${profile} add`, runtime.pnpmDir === null ? null : withPathPrefix(runtime.pnpmDir))
}

/** Remove the profile link. Pre-checks the profile's dependency table so a
 *  fresh profile without the link doesn't turn `dsh plugin rm` into an error;
 *  if the profile layout ever shifts, we warn and let `dsh plugin rm` decide. */
function unmount(profile, runtime) {
  let deps = {}
  try {
    deps = JSON.parse(readFileSync(join(dshHome(), 'profiles', profile, 'package.json'), 'utf8')).dependencies ?? {}
  } catch { /* profile layer absent/unreadable — nothing linked, fall through */ }
  if (!(PKG_NAME in deps)) return
  const { cmd, prefix } = dshRunner(runtime.dsh)
  runOrDie(cmd, [...prefix, 'plugin', '--profile', profile, 'rm', PKG_NAME],
    `dsh plugin --profile ${profile} rm`, runtime.pnpmDir === null ? null : withPathPrefix(runtime.pnpmDir))
}

/** Run the mount/unmount step, or degrade loudly when no dsh is reachable:
 *  the store copy still lands, but the profile keeps its previous state
 *  (stale link on uninstall) and the operator gets the manual command.
 *
 *  **返回值 = 这一步到底做了没有**（`true`/`false`）。收尾文案必须按它分岔：
 *  跳过时还打印 `mounted into profile '<p>'` 就是**谎报成功**（D47：防线缺席必须响亮，
 *  不得静默/误导——Lead 复跑实测踩到：无 dsh 时 store 落盘、profile 里根本没有 link，
 *  收尾行却写 `mounted into profile 'web'`）。
 *
 *  **dsh 未命中** → 保留既有前缀 `dsh not found on PATH — skipped profile `
 *  （tests/verify-clean-env-e2e.mjs:253 的正则依赖它）+ 一行可执行指路（D47）。
 *  **但 `--dsh` 给错路径是操作者错误**（非环境缺席）→ **die**，且文案点明显式路径本身
 *  （Lead 2026-10-18 拍板：若只说 `missing dsh`，读者会把方向引到 PATH——而他明明给了参数）。
 *  **pnpm 未命中** → 只在**真要挂载**时 die（#86 AC①：一行指路，不是「preset 坏了」），
 *  文案同样按 `probeFailureHint` 区分「显式给错」与「环境缺席」。 */
function mountOrWarn(profile, step, what, runtime) {
  if (!runtime.dsh.found) {
    // 显式 --dsh 指了个不存在的路径 → 操作者错误，不许降级成「跳过」（那会让人以为
    // 「环境里没有 dsh」，实际是他把路径写错了）。
    if (runtime.dsh.explicitProblem) die(probeFailureHint('dsh', runtime.dsh))
    const manual = what === 'unmount'
      ? `dsh plugin --profile ${profile} rm ${PKG_NAME}`
      : `dsh plugin --profile ${profile} add ${join(defaultStoreRoot(), 'matt')}`
    console.error(`dsh not found on PATH — skipped profile ${what} (装载需手动: ${manual})`)
    console.error(`  !! ${probeFailureHint('dsh', runtime.dsh)}`)
    return false
  }
  if (!runtime.pnpm.found) die(probeFailureHint('pnpm', runtime.pnpm))
  runtime.pnpmDir = pnpmDirFor(runtime.pnpm)
  try {
    step()
  } finally {
    // 挂载/卸载这一调用结束，shim 目录就没人再用了（#77：不留随机名垃圾）。
    // `die()` 走 process.exit 的路径不展开 finally —— 那条由 exit 钩子兜底。
    dropPnpmShim(runtime)
  }
  return true
}

/**
 * 解 tgz（Node 原生：gunzip + 最小 ustar/pax 读取）。
 *
 * 为什么不用系统 tar（#64 实测）：解包必须跨 tar 方言成立，而两条路都不通——
 *   - `shell:true` + 绝对路径：**GNU tar**（msys/Linux）把 `C:\…` 的冒号当远程主机
 *     （`无法连接至 C:`）；
 *   - 改成 `shell:false` + `-C <work>`：GNU tar 仍吃不下 msys 路径转换后的
 *     `C:\msys64\tmp\…`（`无法 open: No such file or directory`）。
 * 所以不赌宿主方言：npm pack 产出的是 gzip 包着的 ustar（长路径走 pax/GNU 扩展），
 * 这里自己读，任何平台行为一致。
 * 解包 `--from` 的 tgz：**只**写 dest 之内（名字按任一分隔符切段、拒收 `..`，并用规整后的
 * 相对路径兜底校验"仍在 dest 内"—— tar 规范用 `/`，伪造归档可以写 `\`，而 Windows 的
 * `join(dest, '..\\..\\x')` 会规整逃出 dest）。导出给 tests/verify-install-tarball.mjs 用。
 */
export async function extractTarball(tarball, dest) {
  const buf = gunzipSync(await readFile(tarball))
  /** tar 头字段：NUL 结尾、按八进制/字符串读取。 */
  const field = (header, start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0[\s\S]*$/u, '').trim()
  let offset = 0
  let pendingName
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const size = Number.parseInt(field(header, 124, 12) || '0', 8)
    const type = String.fromCharCode(header[156]) || '0'
    const prefix = field(header, 345, 155)
    const rawName = field(header, 0, 100)
    const dataStart = offset + 512
    const dataEnd = dataStart + size

    if (type === 'x' || type === 'g') {
      // pax 扩展头：记录形如 "<len> path=<value>\n"，长路径从这里来
      const body = buf.subarray(dataStart, dataEnd).toString('utf8')
      const hit = /(?:^|\n)\d+ path=([^\n]+)/u.exec(body)
      if (hit) pendingName = hit[1]
    } else if (type === 'L') {
      // GNU 长名头
      pendingName = buf.subarray(dataStart, dataEnd).toString('utf8').replace(/\0[\s\S]*$/u, '')
    } else {
      const full = (pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName)).replace(/^\.\//u, '')
      pendingName = undefined
      // 段切分按**任一分隔符**：tar 规范用 `/`，但伪造归档可以写 `\`，而 Windows 上
      // `join(dest, '..\\..\\x')` 会规整逃出 dest（原过滤只 `split('/')`，抓不到）。
      // 空段与 `.` 丢弃，`..` 一律拒收。
      const parts = full.split(/[\\/]/u).filter((p) => p !== '' && p !== '.')
      if (parts.length > 0 && !parts.includes('..')) {
        const target = join(dest, ...parts)
        // 兜底：规整后的相对路径必须仍在 dest 之内（同时挡住绝对名与跨盘名）。
        const rel = relative(resolve(dest), resolve(target))
        if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) {
          if (type === '5') await mkdir(target, { recursive: true })
          else if (type === '0' || type === '\0') {
            await mkdir(dirname(target), { recursive: true })
            await writeFile(target, buf.subarray(dataStart, dataEnd))
          }
        }
      }
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return join(dest, 'package')
}

/**
 * Resolve the package payload: returns { pkgDir, pkg, source }.
 * --from tarball → extract with the in-process extractor (no host tar dialect);
 * --from dir → use as-is; default → this package's own checkout.
 */
async function resolveSource(from) {
  if (!from) return { pkgDir: PKG_DIR, source: 'source' }
  if (from.endsWith('.tgz') || from.endsWith('.tar.gz')) {
    const work = await mkdtemp(join(tmpdir(), 'dsh-preset-pkg-'))
    try {
      const pkgDir = await extractTarball(resolve(from), work)
      if (!existsSync(pkgDir)) throw new Error(`tarball has no package/ entry: ${from}`)
      return { pkgDir, source: 'tarball' }
    } catch (error) {
      await rm(work, { recursive: true, force: true })
      die(`tarball extract failed: ${String(error?.message ?? error)}`)
    }
  }
  const dir = resolve(from)
  if (!existsSync(join(dir, 'package.json'))) die(`--from is not a package directory (no package.json): ${dir}`)
  return { pkgDir: dir, source: 'dir' }
}

/** 白名单展开逻辑住在 lib/payload.mjs（安装器与离线守卫共用一份语义）。 */
async function payloadOfOrDie(pkgDir) {
  try {
    return await payloadOf(pkgDir)
  } catch (error) {
    die(String(error?.message ?? error))
  }
}

/** 目标看起来是不是「我们的 store」：VERSION.json / manifest.json，或 package.json 的
 *  name 是本包。`uninstall` / `--force` / `upgrade` 只许动这种目录——旧实现只
 *  `existsSync` 就 `rm`，任何 `<root>/matt` 都会被当成我们的货删掉（2026-10-18 教训：
 *  「删的不是我们的目录」必须响亮，不许静默）。 */
function looksLikeOurStore(target) {
  if (!existsSync(target)) return false
  if (existsSync(join(target, 'VERSION.json')) || existsSync(join(target, 'manifest.json'))) return true
  try {
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    return pkg?.name === PKG_NAME
  } catch { return false }
}

/** 空目录可以安全接管（上次安装半途失败、或操作者预建）。 */
function isEmptyDir(target) {
  try { return readdirSync(target).length === 0 } catch { return false }
}

async function installTo(target, { pkgDir, source }, { previousVersion, profile, storeRoot } = {}) {
  // 破坏性目标守卫：target 必须是合法 store 下的 `matt/`（见 lib/safe-target.mjs）。
  const problem = targetProblem(target, storeRoot)
  if (problem !== null) die(`${problem} — refusing to wipe/replace it`)
  // 非空且不像我们的目录 → 拒绝覆盖（先删后拷的语义意味着这一步会真删）。
  if (existsSync(target) && !isEmptyDir(target) && !looksLikeOurStore(target)) {
    die(`refusing to wipe ${target}: it does not look like a dsh-matt-preset store ` +
      '(no VERSION.json / manifest.json / package.json). 手工核对后再处理。')
  }
  // 先回声再删：2026-10-18 事故纪律——破坏动作前先让绝对路径出现在输出里。
  console.error(`store: ${target}`)
  const { pkg, entries } = await payloadOfOrDie(pkgDir)
  // 原地替换语义：先清空目标（stale 文件不残留），再整目录拷入
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const e of entries) {
    const s = join(pkgDir, e)
    const isDir = (await stat(s)).isDirectory()
    await cp(s, join(target, e), { recursive: isDir })
  }
  const now = new Date().toISOString()
  // 运行时依赖随安装副本走：插件 import 'yaml' 的解析锚点是插件文件自身，
  // 安装目录旁必须有 node_modules/yaml。解析锚定**来源包自身**（回滚装旧 tag
  // 时 vendor 旧包声明的依赖版本），来源目录无 node_modules 时（tarball 解压
  // 目录）才回退到安装器自身环境。
  let req = createRequire(join(pkgDir, 'package.json'))
  try { req.resolve(RUNTIME_DEPS[0] + '/package.json') }
  catch { req = createRequire(join(PKG_DIR, 'package.json')) }
  const deps = {}
  for (const dep of RUNTIME_DEPS) {
    let depDir
    try { depDir = dirname(req.resolve(dep + '/package.json')) }
    catch { die(`runtime dependency '${dep}' is not resolvable — run npm install in the package first: ${pkgDir}`) }
    await cp(depDir, join(target, 'node_modules', dep), { recursive: true })
    deps[dep] = JSON.parse(await readFile(join(depDir, 'package.json'), 'utf8')).version
  }
  await writeFile(join(target, 'VERSION.json'),
    JSON.stringify({ version: pkg.version, installedAt: now, source }, null, 2) + '\n')
  await writeFile(join(target, 'manifest.json'),
    JSON.stringify({ version: pkg.version, source, previousVersion: previousVersion ?? null, profile: profile ?? null, files: entries, dependencies: deps }, null, 2) + '\n')
  return { version: pkg.version, files: entries.length }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const pkg = JSON.parse(await readFile(join(PKG_DIR, 'package.json'), 'utf8'))
  const cmd = args._[0]

  if (args.version) { console.log(pkg.version); return }

  const profile = args.profile ?? 'web'
  // 显式 --root = 纯存储模式（测试/非默认布局）：只落 store，不碰任何 profile
  const storeOnly = args.root !== undefined
  const storeRoot = resolve(args.root ?? defaultStoreRoot())
  const target = join(storeRoot, 'matt')
  // 破坏性目标守卫（2026-10-18 事故硬化）：store 根 / target 先过纯路径判定——
  // 等于用户 profile、是它的祖先、盘根，一律 die，绝不进入任何 rm 分支。
  const targetIssue = targetProblem(target, storeRoot)
  if (targetIssue !== null) die(`${targetIssue} — refusing to continue`)
  const previousVersionOf = async () => existsSync(join(target, 'VERSION.json'))
    ? JSON.parse(await readFile(join(target, 'VERSION.json'), 'utf8')).version
    : null
  // 运行时解析（#47/#86）：只算一次，挂载与卸载共用；缺 pnpm 的判定推迟到真要挂载时。
  const runtime = resolveRuntime(args)
  // 命中的来源与路径先回声（取证纪律：破坏/外部调用前让读者看到用的是哪一个运行时）。
  if (!storeOnly) {
    console.error(runtime.dsh.found
      ? `dsh: ${runtime.dsh.path} (${runtime.dsh.source})`
      : 'dsh: 未命中（将响亮降级，见下）')
  }

  if (cmd === 'uninstall') {
    if (!existsSync(target)) die(`not installed: ${target} (未安装)`)
    // 只删带归属标记的目录：`<root>/matt` 恰好是别人的目录时，宁可响亮失败。
    if (!looksLikeOurStore(target)) {
      die(`refusing to delete ${target}: it does not look like a dsh-matt-preset store ` +
        '(no VERSION.json / manifest.json / package.json). 手工核对后再处理。')
    }
    // `--root` = 纯 store 模式，本就不碰 profile：收尾**不得**提 profile（那会是谎报）。
    const unmounted = storeOnly ? null : mountOrWarn(profile, () => unmount(profile, runtime), 'unmount', runtime)
    console.error(`store: ${target}`)
    await rm(target, { recursive: true, force: true })
    console.log(`uninstalled: ${target}` +
      (unmounted === null
        ? ' (store-only mode: profile untouched)'
        : unmounted
          ? ` (profile '${profile}' unmounted)`
          // unmount 中途返回（profile 里本就没 link）不等于「摘掉了」——
          // 旧文案无条件写 unmounted，同样是谎报。如实分岔。
          : ` (profile '${profile}' NOT unmounted — dsh 未命中或本就未挂载，见上)`))
    return
  }

  if (cmd === 'upgrade') {
    if (!existsSync(join(target, 'VERSION.json'))) die(`not installed: ${target} (未安装——请先用 install)`)
    const prev = await previousVersionOf()
    const src = await resolveSource(args.from)
    const res = await installTo(target, src, { previousVersion: prev, profile, storeRoot })
    if (src.source === 'tarball') await rm(dirname(src.pkgDir), { recursive: true, force: true })
    // link 指向的是存储目录本身，文件已原地替换；重挂一次刷新 pnpm 元数据
    const remounted = storeOnly ? null : mountOrWarn(profile, () => mount(profile, target, runtime), 'mount', runtime)
    console.log(`upgraded ${prev} -> ${res.version} (${res.files} entries) at ${target}`)
    if (remounted === false) {
      // 响亮跳过 → 不得说「重启生效」（profile 里没有 link，重启也不会生效）。
      console.error(`profile '${profile}' NOT remounted (dsh 未命中，见上) — 存储已更新，但 profile 未刷新。`)
    } else {
      console.log(`重启 dsh --profile ${profile}（或新开会话）生效；回滚：重新 install 旧版本包。`)
    }
    return
  }

  if (cmd === 'install') {
    if (existsSync(target) && !args.force) {
      die(`already installed: ${target} (已存在——升级用 upgrade，覆盖用 --force)`)
    }
    const prev = await previousVersionOf()
    const src = await resolveSource(args.from)
    const res = await installTo(target, src, { previousVersion: prev, profile, storeRoot })
    if (src.source === 'tarball') await rm(dirname(src.pkgDir), { recursive: true, force: true })
    const mounted = storeOnly ? null : mountOrWarn(profile, () => mount(profile, target, runtime), 'mount', runtime)
    // 收尾文案按**实际结果**分岔（D47：不得谎报成功）——旧版无条件写 `mounted into profile '<p>'`，
    // 响亮跳过时 profile 里根本没有 link，读者会以为装好了并去重启一个不会生效的实例。
    console.log(`installed ${res.version} (${res.files} entries) at ${target}` +
      (mounted === null
        ? ''
        : mounted
          ? `, mounted into profile '${profile}'`
          : `, profile '${profile}' NOT mounted (dsh 未命中，见上)`))
    if (mounted === false) {
      // 未挂载 → 「重启生效 / 在 hero-chip 选择」都是空头支票，改成指路。
      console.error(`装载未完成（store 已落盘）—— 用 --dsh/DSH_MATT_DSH 指出 dsh 后重跑，或按上面那行手动挂载。`)
    } else {
      console.log(`重启 dsh --profile ${profile}（或新开会话），在 hero-chip 选择 "Matt 工作流"。`)
    }
    return
  }

  die(`usage: install | upgrade | uninstall | --version (got: ${cmd ?? '(none)'})`)
}

// 只有**直接执行**才跑 CLI：被 import（测试 / 复用 lib）时不得产生安装副作用。
// 白名单展开逻辑在 lib/payload.mjs，离线守卫 tests/verify-payload-manifest.mjs 用它。
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main().catch((e) => die(e?.stack ?? String(e)))
