/**
 * runtime-probe.mjs — 运行时**可达性探测**（#47 方向 C + #86）。
 *
 * 为什么存在（两张票同一个死因）：
 *   - #86：装载挂载走 `dsh plugin --profile <p> add <store>`，而 plugin-manager 用的是
 *     **PATH 上的字面 `pnpm`**。新机器 PATH 里没有 pnpm 时整环红，而报错长得像
 *     「preset 坏了」——操作者去查 preset，真因却在「这台机器没把 pnpm 放进 PATH」。
 *   - #47：桌面端 store 路径分叉（`agent-presets/dsh-matt-preset` vs `agent-presets/matt`），
 *     装到桌面端跑的 dsh 上必须用**桌面端自己的** dsh/运行时，字面 `dsh` 会落到另一个实例
 *     （或根本没有），于是「装了但没生效」。
 *
 * 本模块只做**纯判定**：不 spawn、不写盘、不退出（唯一例外是 `pnpmPathInjection` 生成
 * shim 目录时需要 `mkdtemp`，且**由调用方注入**）。调用方决定 die 还是降级。
 * `options` 全部可注入，测试无需真的去动 PATH / 文件系统：
 *
 *   | 键            | 默认              | 说明                                        |
 *   |--------------|-------------------|---------------------------------------------|
 *   | `explicit`   | `null`            | `--dsh` / `--pnpm` 的显式路径；给了就必须命中 |
 *   | `env`        | `process.env`     | 读 DSH_MATT_DSH / DSH_PNPM / DSH_DESKTOP_ROOT / DSH_MATT_DSH_SRC |
 *   | `platform`   | `process.platform`| 决定 `.cmd` / `.exe` / 无后缀的候选名        |
 *   | `pathEntries`| 由 `env.PATH` 拆  | 测试注入                                    |
 *   | `exists`     | `existsSync`      | 测试注入                                    |
 *
 * 探测顺序（两条工具同构，**顺序本身是契约**，`tests/verify-runtime-probe.mjs` 钉住）：
 *   1. `explicit`（`--dsh` / `--pnpm`）—— 操作者说了算；
 *   2. 环境变量（`DSH_MATT_DSH` / `DSH_PNPM`）—— 脚本/CI 的稳定出口；
 *   3. PATH 查找；
 *   4. 桌面运行时惯例（仅当 `DSH_DESKTOP_ROOT` 给出时）——**`DSH_DESKTOP_ROOT` = 桌面应用根**
 *      （含 `resources` 的那一层，即 `<app>`），候选 `= <app>/resources/runtime/cli/bin/dsh.cmd|dsh`
 *      / `pnpm = <app>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs`。
 *      **兼容回落**：若使用者把 root 设成 `<app>/resources` 本身，也试 `<root>/runtime/…`
 *      （口语里「运行时根」两种叫法都常见；多试一条不改变档内顺序语义，只是别让人静默落空）。
 *   5. 源码检出惯例（仅当 `DSH_MATT_DSH_SRC` 给出时）。
 *
 * 结果形如 `{ found, path, source, detail, explicitProblem }`：**未命中时 `detail` 逐条说明每个
 * 来源为何落空**（D47：防线缺席必须响亮），让人一眼看出「哪几个来源试过了、下一次该设哪个变量」。
 *
 * **两种未命中必须分开**（Lead 2026-10-18 拍板）：
 *   - `explicitProblem === null` + `found === false` → **环境缺席**（到处都没有）：调用侧给
 *     `missingToolHint(tool)` 的一行可执行指路（说「PATH 上没有」，方向正确）；
 *   - `explicitProblem !== null` → **操作者错误**（`--dsh`/`--pnpm` 给了个不存在的路径）：调用侧
 *     必须说「**你给的显式路径不存在/不可用**」。若这里仍只说 `missing pnpm`，读者会把排查方向
 *     引到 PATH —— 而他明明给了参数，真因就在那个路径上（Lead 复跑实测的误导形态）。
 *
 * 命中时 `detail` 也保留走过的来源链（取证用）。
 *
 * 测试：tests/verify-runtime-probe.mjs（纯函数 + 扰动反例）。
 */
import { existsSync as fsExistsSync } from 'node:fs'
import { join } from 'node:path'

/** 来源标签（契约：`source` 只取这几个值之一，未命中为 null）。 */
export const SOURCES = ['explicit', 'env', 'path', 'desktop', 'checkout']

/** 两条工具各自的「惯例位置」描述——un 命中时用来生成指路，改这里就同时改了探测与文案。 */
const TOOLS = {
  dsh: {
    envVar: 'DSH_MATT_DSH',
    explicitFlag: '--dsh',
    /** PATH 上的候选名（按平台的 PATHEXT 惯例；不含扩展名的裸脚本放最后）。 */
    pathNames: (platform) => platform === 'win32'
      ? ['dsh.cmd', 'dsh.exe', 'dsh.bat', 'dsh']
      : ['dsh'],
    /** 桌面运行时惯例候选：**首取** `<root>/resources/runtime/cli/bin/…`（契约冻结形态：
     *  `DSH_DESKTOP_ROOT` = 桌面**应用根**，即含 `resources` 的那一层）。
     *  **回落**：再试 `<root>/runtime/cli/bin/…` —— 有人会把 `DSH_DESKTOP_ROOT` 设成
     *  `<app>/resources` 本身（口语里「运行时根」两种叫法都常见，2026-10-18 teammate 实测踩到）。
     *  多试一条**不改变冻结的顺序语义**（仍在同一「桌面」档内，只是该档的候选多了个形态），
     *  却省得使用者去记到底该给哪一层（D47：能响亮命中就别让它静默落空）。 */
    desktop: (root, platform) => [
      ...prefixNames(join(root, 'resources', 'runtime', 'cli', 'bin'), 'dsh', platform),
      ...prefixNames(join(root, 'runtime', 'cli', 'bin'), 'dsh', platform),
    ],
    /** 源码检出惯例：`<src>/apps/cli/lib/bin.js`（用 node 跑）。 */
    checkout: (src) => [join(src, 'apps', 'cli', 'lib', 'bin.js')],
    /** 源码检出形态不是可执行文件，调用方要用 `node <path>` 起。 */
    runner: (p, source) => source === 'checkout' ? { cmd: process.execPath, prefix: [p] } : { cmd: p, prefix: [] },
  },
  pnpm: {
    envVar: 'DSH_PNPM',
    explicitFlag: '--pnpm',
    pathNames: (platform) => platform === 'win32'
      ? ['pnpm.cmd', 'pnpm.exe', 'pnpm.bat', 'pnpm']
      : ['pnpm'],
    // 桌面端把 pnpm 作为 harness 依赖分发，形态是 **.cjs**（不是可执行）——
    // 直接 exec 会失败，必须经 shim 转发（见 pnpmPathInjection）。
    // 两条形态同 dsh：首取应用根，回落 `<root>/runtime/…`（有人把 root 设成 `resources` 本身）。
    desktop: (root) => [
      join(root, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'),
      join(root, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.js'),
      join(root, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'),
      join(root, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.js'),
    ],
    checkout: () => [],
    runner: (p) => ({ cmd: process.execPath, prefix: [p] }),
  },
}

/** 平台候选名：Win 上 `x.cmd` / `x.exe` 优先，再裸 `x`；其余平台只有裸名。 */
function prefixNames(dir, base, platform) {
  const names = platform === 'win32' ? [`${base}.cmd`, `${base}.exe`, base] : [base]
  return names.map((n) => join(dir, n))
}

/** `env.PATH` 拆分（Windows 用 `;`、POSIX 用 `:`；两边都容忍，便于跨平台注入测试）。 */
export function pathEntriesOf(env, platform) {
  const raw = env?.PATH ?? env?.Path ?? ''
  const sep = platform === 'win32' ? ';' : ':'
  return String(raw).split(sep).map((s) => s.trim()).filter((s) => s !== '')
}

/** 探测选项归一化（全部可注入；默认取真实环境）。 */
function normalize(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  return {
    explicit: options.explicit ?? null,
    env,
    platform,
    pathEntries: options.pathEntries ?? pathEntriesOf(env, platform),
    exists: options.exists ?? fsExistsSync,
  }
}

/**
 * 通用探测：按冻结顺序逐个来源试，命中即返回（`detail` 记录走过的来源链）。
 * `tool` 为 `'dsh' | 'pnpm'`（未知名字按空惯例处理，只保留 explicit/env/PATH 三段）。
 */
export function probeTool(tool, options = {}) {
  const spec = TOOLS[tool]
  const { explicit, env, platform, pathEntries, exists } = normalize(options)
  const detail = []
  const envVar = spec?.envVar
  const flag = spec?.explicitFlag

  /** 命中即返回；失败时把原因塞进 detail。
   *  `noExplicitProblem` = 显式参数本身没问题（没给 / 给了且命中）——落空是**环境缺席**；
   *  反之（给了却没命中）是**操作者错误**，调用侧文案必须分开（Lead 2026-10-18 拍板）。 */
  const hit = (source, path, explicitProblem = null) => {
    detail.push(`命中 ${source}: ${path}`)
    return { found: true, path, source, detail, explicitProblem }
  }
  const miss = (why) => detail.push(why)

  // ── 1. 显式参数：给了就必须命中（响亮失败，不静默回落其它来源）──────────────
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    if (exists(explicit)) return hit('explicit', explicit)
    const problem = `显式 ${flag} 给出的路径不存在或不可用: ${explicit}`
    miss(problem)
    // 关键区分：这里未命中**不是**「环境里没有 pnpm/dsh」，而是操作者给错了路径。
    // 调用侧据此选文案（`missingToolHint` 会把排查方向引到 PATH，对这种情况是误导）。
    return { found: false, path: null, source: null, detail, explicitProblem: problem }
  }

  // ── 2. 环境变量 ──────────────────────────────────────────────────────────
  const fromEnv = envVar === undefined ? undefined : env?.[envVar]
  if (fromEnv !== undefined && fromEnv !== null && fromEnv !== '') {
    if (exists(fromEnv)) return hit('env', fromEnv)
    miss(`${envVar} 指向的路径不存在: ${fromEnv}`)
  } else if (envVar !== undefined) {
    miss(`${envVar} 未设置`)
  }

  // ── 3. PATH 查找 ────────────────────────────────────────────────────────
  const names = spec?.pathNames?.(platform) ?? []
  /** 面向上层的最小描述：命中的是哪一个候选名（证据里看得出平台形态）。 */
  let pathHit = null
  for (const dir of pathEntries) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (exists(candidate)) { pathHit = candidate; break }
    }
    if (pathHit !== null) break
  }
  if (pathHit !== null) return hit('path', pathHit)
  miss(`PATH 的 ${pathEntries.length} 个目录里没有 ${names.join(' / ') || tool}`)

  // ── 4. 桌面运行时惯例（仅当 DSH_DESKTOP_ROOT 给出）──────────────────────
  const desktopRoot = env?.DSH_DESKTOP_ROOT
  if (desktopRoot !== undefined && desktopRoot !== null && desktopRoot !== '') {
    for (const candidate of spec?.desktop?.(desktopRoot, platform) ?? []) {
      if (exists(candidate)) return hit('desktop', candidate)
    }
    miss(`DSH_DESKTOP_ROOT(${desktopRoot}) 下没有桌面运行时惯例路径`)
  } else {
    miss('DSH_DESKTOP_ROOT 未设置（桌面端运行时惯例未探测）')
  }

  // ── 5. 源码检出惯例（仅当 DSH_MATT_DSH_SRC 给出）────────────────────────
  const srcRoot = env?.DSH_MATT_DSH_SRC
  if (srcRoot !== undefined && srcRoot !== null && srcRoot !== '') {
    for (const candidate of spec?.checkout?.(srcRoot) ?? []) {
      if (exists(candidate)) return hit('checkout', candidate)
    }
    if ((spec?.checkout?.(srcRoot) ?? []).length === 0) miss(`${tool} 没有源码检出惯例路径`)
    else miss(`DSH_MATT_DSH_SRC(${srcRoot}) 下没有源码检出惯例路径`)
  } else {
    miss('DSH_MATT_DSH_SRC 未设置（源码检出惯例未探测）')
  }

  // 到处都没有（无显式 / 无 env / PATH 无 / 惯例无）= **环境缺席**，不是操作者给错。
  return { found: false, path: null, source: null, detail, explicitProblem: null }
}

/** 探测 dsh CLI（装载挂载要用它）。 */
export function probeDsh(options = {}) {
  return probeTool('dsh', options)
}

/** 探测 pnpm（plugin-manager 在 PATH 上找它）。 */
export function probePnpm(options = {}) {
  return probeTool('pnpm', options)
}

/**
 * 取「用哪个命令起这个 dsh」——源码检出形态（`apps/cli/lib/bin.js`）不是可执行文件，
 * 必须经 `node` 跑。其余来源直接用它自己。返回 `{ cmd, prefix }`，调用方拼成
 * `[...prefix, ...args]`。
 */
export function dshRunner(result) {
  return TOOLS.dsh.runner(result?.path, result?.source)
}

/**
 * 一行**可执行**指路（D47：防线缺席必须响亮，且要给「下一步打什么」）。
 * 文案里出现的变量名 / 命令都必须是真能复制粘贴的形态；不得含本机绝对路径。
 */
export function missingToolHint(tool) {
  if (tool === 'pnpm') {
    return 'missing pnpm — `dsh plugin add` 由 plugin-manager 起 pnpm, PATH 上没有它就整环红（不是 preset 坏了）。'
      + '给一条即可: `--pnpm <path/to/pnpm.cjs>` | `set DSH_PNPM=<path>` | `export DSH_PNPM=<path>`'
      + ' | 装 pnpm 并让 `pnpm --version` 在当前 shell 可跑。'
  }
  if (tool === 'dsh') {
    return 'missing dsh — 给一条即可: `--dsh <path/to/dsh>` | `set DSH_MATT_DSH=<path>`'
      + ' | `export DSH_MATT_DSH=<path>` | 让 `dsh --version` 在当前 shell 可跑'
      + '（桌面端可设 `DSH_DESKTOP_ROOT`，源码检出可设 `DSH_MATT_DSH_SRC`）。'
  }
  return `missing ${tool} — 把它放进 PATH，或用显式参数 / 环境变量指出路径。`
}

/**
 * 未命中时的**统一出口**：按「为什么未命中」选文案（Lead 2026-10-18 拍板要把两者分开）。
 *   - 显式路径给错 → 点明「你给的显式路径不存在/不可用」（**不要**说 missing，那会把方向
 *     引到 PATH，而操作者明明给了参数）；
 *   - 环境缺席 → `missingToolHint(tool)` 的一行可执行指路。
 * 调用侧一律用这个，不要自己拼 `missingX`。
 */
export function probeFailureHint(tool, result) {
  if (result !== null && result !== undefined && result.explicitProblem) {
    const flag = tool === 'pnpm' ? '--pnpm' : tool === 'dsh' ? '--dsh' : `--${tool}`
    return `${result.explicitProblem} — 这是**显式参数给错了**（不是 PATH 上没有 ${tool}）。`
      + `核对路径后重给 \`${flag} <path>\`，或去掉该参数让它按 PATH/惯例自动探测。`
  }
  return missingToolHint(tool)
}

/** `*.cjs` / `*.js` 形态：不是可执行文件，需要转发 shim。 */
export function isScriptForm(p) {
  return typeof p === 'string' && /\.(cjs|mjs|js)$/i.test(p)
}

/**
 * 把探测结果变成「一个目录 + 该目录里有名为 `pnpm` 的可执行」——调用方把这个目录
 * **前置**进子进程的 `PATH`，plugin-manager 就能按字面 `pnpm` 找到它。
 *
 * 两种形态（#86 实测都要支持）：
 *   - 可执行（`.cmd`/`.exe`/无后缀）：直接返回它**所在目录**；
 *   - `*.cjs`（harness 分发的 `pnpm.cjs`）/ `*.js`：在临时目录生成转发 shim
 *     （`pnpm.cmd` + `pnpm`），内容转发到 `node <path>`，返回 shim 目录。
 *     经 shim 后统一的对外表现仍是「一个目录里有个叫 pnpm 的可执行」。
 *
 * `mkdtemp` **必须注入**（默认 `null` → 遇脚本形态直接抛）——本模块不隐式写盘，
 * 测试可拿假 `mkdtemp` 断言生成的 shim 内容而不落任何真实文件。
 */
export function pnpmPathInjection(result, { mkdtemp = null, writeFile = null } = {}) {
  if (result === null || result === undefined || result.found !== true) {
    throw new Error('pnpmPathInjection: expects a found probe result')
  }
  if (!isScriptForm(result.path)) {
    // 可执行形态：它的所在目录本来就在「一个叫 pnpm 的可执行」上。
    return { dir: dirOf(result.path), shim: false }
  }
  if (typeof mkdtemp !== 'function') {
    throw new Error('pnpmPathInjection: script form needs an injected mkdtemp() (no implicit disk writes)')
  }
  const dir = mkdtemp('dsh-matt-pnpm-')
  const target = result.path
  const write = typeof writeFile === 'function' ? writeFile : null
  if (write !== null) {
    // 允许测试注入 writeFile 断言内容（不落真实文件）。
    write(join(dir, 'pnpm.cmd'), cmdShim(target))
    write(join(dir, 'pnpm'), shShim(target))
  }
  return { dir, shim: true, target }
}

/** POSIX shell 转发脚本内容。 */
export function shShim(target) {
  return `#!/bin/sh\nexec node "${target}" "$@"\n`
}

/** cmd.exe 转发脚本内容（`%~dp0` 只对 .cmd 有语义，这里不需要——目标是绝对路径）。 */
export function cmdShim(target) {
  return `@echo off\r\nnode "${target}" %*\r\n`
}

/** 取路径所在目录（不引 node:path 的 dirname 以便在此微小处保持无副作用语义一致）。 */
function dirOf(p) {
  const s = String(p)
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i === -1 ? '.' : s.slice(0, i)
}