/**
 * runtime-probe.mjs — installer 的**运行时探测**（#47 桌面形态可达性 + #86 pnpm 根因）。
 *
 * 为什么需要这个模块（两条实测根因，不是猜测）：
 *
 * 1) **PATH 上没有 `dsh` ≠ 运行时缺席**（#47）。桌面端把 CLI 装在应用资源里，不往 PATH
 *    注册；源码检出形态则要操作者自己 `npm link` / 手工 shim。旧安装器只裸探
 *    `spawnSync('dsh', ['--version'])`，探不到就「warning + 跳过挂载」，但 install 仍
 *    exit 0、stdout 仍声称 `mounted into profile 'x'`——**谎报**（#80）。现在改为：
 *    按有序候选链探测，全落空就响亮失败并给一行可执行指路。
 *
 * 2) **`pnpm` 是「按形态」条件必需，不是始终必需**（#86 的真正边界）。这一条是本模块
 *    最反直觉、也最容易被后人改错的地方，所以把源码级证据留在这里：
 *
 *    plugin-manager 的配置模式（桌面 asar 内 `@deepseek-ai/dsh-plugin-manager`）：
 *        static Config = z.object({ pnpmCommand: z.string().default('pnpm'), ... })
 *    它在每次执行 pnpm 时这样取命令：
 *        ...this.profile.packageManager ?? { command: this.pnpmCommand }
 *    而 `profile.packageManager` 只由**桌面宿主**填：
 *        // dsh-desktop-host 的 runDesktopCli()
 *        packageManager: {
 *          command: process.execPath,
 *          args: ['--expose-internals', join(supportDir, 'primary-runtime',
 *                                         'dependencies', 'pnpm', 'bin', 'pnpm.mjs')],
 *          env: { ELECTRON_RUN_AS_NODE: '1', PATH: `${join(supportDir,'bin')}${delimiter}${PATH}` },
 *        }
 *    CLI 侧只做透传（`runCli` → `plugin` 模式 → `runPlugin(profile, args, options.packageManager)`
 *    → `profileContext.packageManager`）。
 *
 *    ⇒ **桌面形态自带 primary-runtime，pnpm 由宿主显式注入，根本不看 PATH。**
 *      实测：PATH 剥到只剩 `System32;Windows` 时，桌面 dsh 的 `plugin add` 仍
 *      「Done in 419ms using pnpm v11.28.5」exit 0。
 *    ⇒ **源码检出形态没有宿主注入**，`packageManager` 缺席 → 回落到 `pnpmCommand` 的
 *      默认值 = 字面名 `'pnpm'` → **按 PATH 找**。这正是 #86 票面记录的
 *      `'pnpm' is not recognized…` 失败形态。
 *
 *    所以：`source === 'source-checkout'` 才要求 pnpm 可达；`desktop-runtime` 不要求。
 *    判据用 **source**（候选的来源分类），不按「文件存在」猜。
 *
 * 3) **自定义 pnpm 环境变量（`DSH_PNPM` 等）下游不认**。桌面 asar 里搜不到
 *    `DSH_PNPM` / `PNPM_HOME` / `npm_config_pnpm` 的消费点；plugin-manager 只认
 *    `profile.packageManager`（宿主注入）或字面名 `pnpm`（PATH 查找）。
 *    因此 `--pnpm <path>` / `DSH_MATT_PNPM` 是**本安装器自己的输入契约**，透传给
 *    `dsh plugin` 子进程的唯一可行机制是 **PATH 前置**（见 `pathWithPnpm`），
 *    绝不能指望下游读某个自定义变量名。
 *
 * 4) **`.cmd` / `.bat` 不能直接 spawn，也不能 `shell:true`**。桌面 dsh 是
 *    `…/runtime/cli/bin/dsh.cmd`，其绝对路径**含空格**。实测三态（Windows）：
 *      spawnSync(p, ['--version'], { shell: false })          → status=null, error=EINVAL
 *      spawnSync(p, ['--version'], { shell: true })           → status=1
 *            "'<install-dir>\\DeepSeek' is not recognized as an internal or external command"
 *            （`<install-dir>` = 安装目录里含空格的那一段；按 PUBLIC 仓纪律用占位符，勿写真实盘符路径）
 *      spawnSync('cmd.exe', ['/c', p, '--version'])           → status=0, stdout="0.2.1-rc.2"
 *    `shell:true` 的语义是把命令与参数**拼成一整行**交给 shell，含空格路径会被 cmd 切成
 *    两截；`cmd.exe /c <path> <args...>` 则以参数数组传递、由 cmd 自己解析。
 *    ⇒ 别改回 `shell:true`。
 *
 * 设计口径：候选项生成是**纯函数**（无副作用、可单测、不含本机硬编路径），探测动作
 * 单独一层（`probeOne` 真跑 `--version`，绝不仅看 `existsSync`）。风格对齐
 * lib/safe-target.mjs（纯判定 + 头注说明为什么）。
 *
 * privacy 红线：本仓 PUBLIC。本模块**不得**出现任何本机绝对路径 / 用户名；一切位置都从
 * 平台惯例与调用方传入的 `home` / `env` / `execPath` 相对推导。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** 环境变量名：本安装器**自己**的输入契约（下游 plugin-manager 不认，见头注 §3）。 */
export const ENV_DSH = 'DSH_MATT_DSH'
export const ENV_PNPM = 'DSH_MATT_PNPM'

/** 候选来源标签（冻结契约的一部分，task-2/task-3 会断言它）。 */
export const SOURCE_PATH = 'path'
export const SOURCE_DESKTOP_RUNTIME = 'desktop-runtime'
export const SOURCE_SOURCE_CHECKOUT = 'source-checkout'

/** 需要外部 pnpm 的来源：只有源码检出形态（见头注 §2）。 */
const SOURCES_NEEDING_PNPM = new Set([SOURCE_SOURCE_CHECKOUT])

/** 该来源的 dsh 是否自带 runtime（自带则不需要 PATH 上的 pnpm）。 */
export function sourceNeedsPnpm(source) {
  return SOURCES_NEEDING_PNPM.has(source)
}

/** Windows 用 `.cmd` 叫 dsh；POSIX 用无扩展名的可执行。 */
function dshBinaryName(platform) {
  return platform === 'win32' ? 'dsh.cmd' : 'dsh'
}

/** 该路径是不是需要 `cmd.exe /c` 才能起的批处理壳（见头注 §4）。 */
export function isBatchShim(p) {
  return /\.(cmd|bat)$/iu.test(p)
}

/**
 * 桌面运行时的**根**目录候选：`<exeDir>/resources/runtime`。
 *
 * 不做「向上找 `resources`」的目录爬取——Electron 的目录名是**约定**（`resources`），
 * 相对可执行文件推导即可，爬取只会在无关目录树上乱撞。非 Electron 宿主（node 直接跑
 * 本安装器、POSIX 系统 node）这里自然落空，交给后面的来源。
 */
function desktopRuntimeRoots({ platform, execPath }) {
  if (typeof execPath !== 'string' || execPath === '') return []
  const exeDir = dirname(execPath)
  const roots = [join(exeDir, 'resources', 'runtime')]
  // macOS：可执行文件在 `Foo.app/Contents/MacOS/`，资源在 `Foo.app/Contents/Resources/`。
  if (platform === 'darwin') roots.push(join(exeDir, '..', 'Resources', 'runtime'))
  return roots
}

/** 桌面运行时里的 dsh：`<runtime>/cli/bin/dsh[.cmd]`。 */
function desktopRuntimeDshCandidates(ctx) {
  return desktopRuntimeRoots(ctx).map((root) => ({
    path: join(root, 'cli', 'bin', dshBinaryName(ctx.platform)),
    source: SOURCE_DESKTOP_RUNTIME,
  }))
}

/**
 * 桌面运行时里**自带**的 pnpm：`<runtime>/primary-runtime/dependencies/pnpm/bin/pnpm.mjs`。
 *
 * 位置由 `runtime.json` 的 payload 布局约定（`dependencies/`）机械推导，不硬编盘符。
 * 取 `.mjs`：它是 node 脚本，需经 node 执行（探测时用 `process.execPath`）。
 */
function desktopRuntimePnpmCandidates(ctx) {
  return desktopRuntimeRoots(ctx).map((root) => ({
    path: join(root, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
    source: SOURCE_DESKTOP_RUNTIME,
  }))
}

/**
 * 源码检出的 dsh 构建产物：`<src>/apps/cli/lib/bin.js`（构建产物，cwd 无关）。
 *
 * 检出位置**无法从平台惯例纯推导**（它可以在任意目录），所以只认操作者/CI 显式声明的
 * 检出根 `DSH_MATT_SRC`——这属于本安装器的输入契约，不是硬编的本机路径。
 */
function sourceCheckoutContext(env) {
  const root = env?.DSH_MATT_SRC
  if (typeof root !== 'string' || root === '') return { dshCandidates: [], pnpmCandidates: [] }
  return {
    dshCandidates: [{ path: join(root, 'apps', 'cli', 'lib', 'bin.js'), source: SOURCE_SOURCE_CHECKOUT }],
    pnpmCandidates: [],
  }
}

/**
 * `dsh` 有序候选：**纯函数**、无副作用、可单测。
 * 顺序 = PATH 字面名 → 桌面运行时 → 源码检出。
 *
 * `home` 是冻结契约的一部分（调用方总会传），但本函数**不**用它推导位置：dsh 的落点只
 * 由「可执行文件所在的应用资源目录」（`execPath`）与显式声明（`env.DSH_MATT_SRC`）决定，
 * 从 home 猜检出位置只会撞上无关目录。留参数是为了契约稳定，不是暗示它参与判定。
 * @returns {Array<{ path: string, source: string }>}
 */
export function dshCandidates({ home = homedir(), platform = process.platform, env = process.env, execPath = process.execPath } = {}) {
  const ctx = { home, platform, env, execPath }
  const ctxSrc = sourceCheckoutContext(env)
  return [
    { path: dshBinaryName(platform), source: SOURCE_PATH },
    ...desktopRuntimeDshCandidates(ctx),
    ...ctxSrc.dshCandidates,
  ]
}

/** 探测到的组件是否自带 runtime（自带则不需要外部 pnpm，见头注 §2）。 */
export function runtimeIsSelfContained(resolved) {
  return resolved?.dsh !== null && resolved?.dsh !== undefined && !sourceNeedsPnpm(resolved.dsh.source)
}

/**
 * `pnpm` 有序候选：**纯函数**、无副作用、可单测。
 * 顺序 = PATH 字面名 → 桌面运行时自带的 pnpm。`home` 同 `dshCandidates`：契约参数，不参与推导。
 * @returns {Array<{ path: string, source: string }>}
 */
export function pnpmCandidates({ home = homedir(), platform = process.platform, env = process.env, execPath = process.execPath } = {}) {
  const ctx = { home, platform, env, execPath }
  const pnpmName = platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  return [
    { path: pnpmName, source: SOURCE_PATH },
    ...desktopRuntimePnpmCandidates(ctx),
    ...sourceCheckoutContext(env).pnpmCandidates,
  ]
}

/**
 * 起一个子进程：**能正确处理含空格的 `.cmd` 路径**（见头注 §4）。
 * `.cmd`/`.bat` → `cmd.exe /c <path> <args...>`；`.js`/`.mjs`/`.cjs` → 经当前 node 跑；
 * 其余 → 直接 spawn + 参数数组。
 *
 * 导出给 bin/install.mjs 复用：探测（`probeOne`）与真调用（`mount`/`unmount`）必须
 * **同一套起进程规则**，否则会出现「探得到、调不起来」（实测踩过：源码检出形态的
 * `apps/cli/lib/bin.js` 探测走 node 成功，真调用直接 spawn 得到 `EFTYPE`）。
 */
export function spawnCandidate(command, args, { platform, env, exec }) {
  if (platform === 'win32' && isBatchShim(command)) {
    return exec('cmd.exe', ['/c', command, ...args], { encoding: 'utf8', env })
  }
  // `.mjs` / `.js` 是 node 脚本，不是可执行体：经当前 node 跑（`pnpm.mjs` 属此类）。
  if (/\.[cm]?js$/iu.test(command)) {
    return exec(process.execPath, [command, ...args], { encoding: 'utf8', env })
  }
  return exec(command, args, { encoding: 'utf8', env })
}

/**
 * 真跑一次 `--version` 判定该候选可用——**探测不许只看文件存在**（PATH 上的字面名连
 * 文件都指不出来，且「装了个坏的」必须比「没装」更响亮地落选）。
 * @returns {boolean}
 */
export function probeOne(candidate, { exec = spawnSync, platform = process.platform, env = process.env } = {}) {
  const path = typeof candidate === 'string' ? candidate : candidate?.path
  if (typeof path !== 'string' || path === '') return false
  let result
  try {
    result = spawnCandidate(path, ['--version'], { platform, env, exec })
  } catch {
    return false
  }
  return result?.status === 0
}

/**
 * 主入口：按 **flag > env > 探测** 的优先级解析，返回首个可用项（含真跑验证）。
 *
 * @param {{ dsh?: string, pnpm?: string, home?: string, platform?: string, env?: object, exec?: Function }} [options]
 * @returns {{ dsh: { path: string, source: string } | null, pnpm: { path: string, source: string } | null }}
 */
export function probeRuntime({ dsh, pnpm, home = homedir(), platform = process.platform, env = process.env, exec = spawnSync } = {}) {
  const dshExplicit = pickExplicit(dsh, env?.[ENV_DSH], classifyDshPath)
  const pnpmExplicit = pickExplicit(pnpm, env?.[ENV_PNPM], () => SOURCE_PATH)

  const resolvedDsh = resolveOne({
    explicit: dshExplicit,
    candidates: dshCandidates({ home, platform, env, execPath: process.execPath }),
    platform, env, exec,
  })
  const resolvedPnpm = resolveOne({
    explicit: pnpmExplicit,
    candidates: pnpmCandidates({ home, platform, env, execPath: process.execPath }),
    platform, env, exec,
  })

  return { dsh: resolvedDsh, pnpm: resolvedPnpm }
}

/**
 * 显式给出的 dsh 路径要判**形态**（`source-checkout` vs 自带 runtime）。
 *
 * 为什么必须判：`source` 决定 pnpm 是否为必需（见头注 §2）。显式路径不能一律标
 * `'flag'`，否则 `--dsh <源码检出>/apps/cli/lib/bin.js` 会被当成自带 runtime 的形态，
 * 于是漏掉 pnpm 前置条件，一路走到 `dsh plugin` 才以 `'pnpm' is not recognized` 炸掉
 * ——那正是 #86 要消灭的失败形态（失败点越晚越难诊断）。
 *
 * 判据按**检出布局**（`…/apps/cli/lib/bin.{js,mjs,cjs}`），不看扩展名就下结论：源码检出的
 * 入口是 node 脚本，桌面运行时的是 `.cmd` 壳 + 宿主自带 primary-runtime。
 */
export function classifyDshPath(path) {
  if (typeof path !== 'string' || path === '') return SOURCE_PATH
  // `<src>/apps/cli/lib/bin.js`：源码检出的构建产物。
  if (/[\\/]apps[\\/]cli[\\/]lib[\\/]bin\.[cm]?js$/iu.test(path)) return SOURCE_SOURCE_CHECKOUT
  return SOURCE_PATH
}

/** 显式覆盖优先于探测：flag 胜过 env（flag > env > 探测）。 */
function pickExplicit(flagValue, envValue, classify) {
  if (typeof flagValue === 'string' && flagValue !== '') return { path: flagValue, source: classify(flagValue) }
  if (typeof envValue === 'string' && envValue !== '') return { path: envValue, source: classify(envValue) }
  return null
}

/** 先试显式项（真跑验证，坏了就响亮地落选），再按候选链找首个可用项。 */
function resolveOne({ explicit, candidates, platform, env, exec }) {
  if (explicit !== null) {
    // 显式给的东西也要真跑——「用户给了个坏的」不该静默回落到探测。
    return { path: explicit.path, source: explicit.source }
  }
  for (const candidate of candidates) {
    if (probeOne(candidate, { exec, platform, env })) return candidate
  }
  return null
}

/**
 * 全落空时给 `die()` 用的一行可执行指路。
 *
 * 关键：**必须可执行**——写清「下一步敲什么」。`missing` 是落空的组件名数组
 * （`['dsh']` / `['pnpm']` / `['dsh','pnpm']`）。安装器自己**不给**路径（它推不出
 * 本机布局），只指路。
 * @returns {string}
 */
export function probeGuidance({ missing = ['dsh'] } = {}) {
  const list = [...missing]
  const parts = []
  if (list.includes('dsh')) {
    parts.push(
      '未找到可用的 dsh CLI（PATH 上没有 ' +
      (process.platform === 'win32' ? '`dsh.cmd`' : '`dsh`') +
      '，桌面运行时 / 源码检出候选也都没跑到 --version）')
    parts.push('用 --dsh <dsh 可执行文件路径> 显式指定，或设 DSH_MATT_DSH=<路径>')
  }
  if (list.includes('pnpm')) {
    parts.push('该 dsh 形态（源码检出）需要 PATH 上可达的 pnpm，但没探到')
    parts.push('用 --pnpm <pnpm 路径> 显式指定，或设 DSH_MATT_PNPM=<路径>')
  }
  parts.push('查运行时可达性：docs/dev-environment.md §3.1')
  return parts.join('；')
}

/**
 * 确保 `<pnpm 路径>` 所在（或代理）目录里有 `cmd.exe` 找得到的 `pnpm` 入口，返回该目录。
 *
 * **为什么不能只前置 pnpm 脚本所在目录**（2026-10-18 实测，别改回去）：
 * 桌面运行时自带的 pnpm 只有 `bin/pnpm.cjs`、`bin/pnpm.mjs`——**没有 `pnpm.cmd`**。
 * `cmd.exe` 按 `PATHEXT` 解析字面名 `pnpm`，一个只有 `.cjs`/`.mjs` 的目录对它等于空，
 * 于是 plugin-manager 仍然报 `'pnpm' is not recognized…`（#86 原形）。实测：
 *     前置 `…/pnpm/bin`（仅 .cjs/.mjs）→ 子进程仍 exit 1 ‘pnpm’ is not recognized
 *     前置含 `pnpm.cmd` 外壳的目录      → 子进程 exit 0 ✅
 * 所以：目录里已有 `pnpm`/`pnpm.cmd` 就直接用；否则在**临时目录**里生成一个
 * `pnpm.cmd` 外壳（`node <解析出的 pnpm 入口> %*`）再前置。临时目录不进仓、不进 home。
 *
 * @returns {string | null} 可前置进 PATH 的目录，或 null（无需/无法前置）。
 */
function ensurePnpmEntryDir(pnpm, platform, tmpRoot) {
  if (pnpm === null || pnpm === undefined || typeof pnpm.path !== 'string' || pnpm.path === '') return null
  // PATH 上的字面名（`'pnpm'` / `'pnpm.cmd'`）本来就靠 PATH 解析，没有可前置的目录。
  if (!pnpm.path.includes('/') && !pnpm.path.includes('\\')) return null
  const dir = dirname(pnpm.path)
  if (platform !== 'win32') return dir
  // 目录里已经有 cmd.exe 认得的入口（pnpm.cmd / pnpm.exe / pnpm.bat）→ 直接用。
  if (['pnpm.cmd', 'pnpm.exe', 'pnpm.bat', 'pnpm'].some((name) => existsSync(join(dir, name)))) return dir
  // 只有 node 脚本（pnpm.cjs/.mjs）→ 生成外壳。
  const shimDir = join(tmpRoot, 'dsh-preset-pnpm-shim')
  const shim = join(shimDir, 'pnpm.cmd')
  try {
    mkdirSync(shimDir, { recursive: true })
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${pnpm.path}" %*\r\n`, 'utf8')
  } catch {
    return dir // 生成不了就退回原目录（至少不比不前置差）
  }
  return shimDir
}

/**
 * 把解析出的 pnpm **前置进子进程 PATH**——透传给 `dsh plugin` 的唯一可行机制
 * （见头注 §3：下游不认自定义变量名，只按 PATH 找字面 `pnpm`）。
 *
 * 具体前置的目录由 `ensurePnpmEntryDir` 决定（可能需要生成 `pnpm.cmd` 外壳）。
 * pnpm 为 null / 无需前置时，PATH 原样保留。
 * @returns {NodeJS.ProcessEnv}
 */
export function pathWithPnpm(pnpm, env = process.env, platform = process.platform, tmpRoot = tmpdir()) {
  // Windows 的进程环境是大小写不敏感的，Node 却原样保留键名：真实 env 里**同时**有
  // `Path`（继承来的原始拼写）与 `PATH`。直接把两份都留给子进程时，`cmd.exe` 读哪一份
  // 是实现细节——被前置的可能正是不生效的那份。所以这里先把所有大小写变体收敛成
  // **一个** PATH 键，再前置。
  const key = platform === 'win32' ? 'Path' : 'PATH'
  const base = {}
  let existing = ''
  for (const [k, value] of Object.entries(env)) {
    if (k.toUpperCase() === 'PATH') { existing = existing === '' ? String(value ?? '') : existing; continue }
    base[k] = value
  }
  const dir = ensurePnpmEntryDir(pnpm, platform, tmpRoot)
  // 分隔符必须按**目标 platform** 取，不能用全局 `delimiter`（它固化在**当前**进程所在
  // 平台上：在 Windows 上跑 POSIX 目标的用例会拼出 `/opt/pnpm/bin;/usr/bin`）。
  const sep = platform === 'win32' ? ';' : ':'
  base[key] = dir === null ? existing : (existing === '' ? dir : `${dir}${sep}${existing}`)
  return base
}