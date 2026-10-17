/**
 * link-runtime-deps.mjs —— 一条命令补齐本仓跑测试所需的全部运行时链接。
 *
 * 为什么需要（retro 2026-10-16，本会话踩过）：本仓的检查面是 `node tests/*.mjs`，
 * 但它有两处**未文档化的依赖**，每个全新检出/新机器都要重踩：
 *   1. 仓根插件（workflow-enforcer.mjs / lang-enforcer.mjs）`import 'yaml'`
 *      → 需要 <repo>/node_modules/yaml；
 *   2. tests/*.mjs `import 'yaml'` 与 18 个 `@deepseek-ai/*`
 *      → 需要 <repo>/tests/node_modules/{yaml,@deepseek-ai}。
 * 运行时包从**已装的 dsh**（源码检出或桌面安装）取，只建链接、不复制。
 * ⚠ 桌面安装版**不能**当这个锚：它的 `@deepseek-ai` 包表在 `resources/app.asar` 内部，
 *   磁盘上没有 `node_modules/@deepseek-ai`（2026-10-17 实测，#88）。本机只有源码检出这条路。
 *
 * **#88 起两处守卫**（D47：防线缺席必须响亮）：
 *   1. **判指向**——链已存在但指向别处（含悬空）时**重指**并打印 `↻`，不再打 `= 已存在` 蒙混
 *      （旧版只判存在，于是重锚后测试静默打在旧包上 → `verify-all` 假绿）；
 *   2. **锚点核对**——用本仓 `package.json` 的 version 推出宿主锚（`0.2.1-rc.2-r1` → `0.2.1-rc.2`），
 *      与该运行时 `@deepseek-ai/dsh-llm` 的版本比对；不一致即**响亮失败（exit 1）**。
 *
 * 用法：
 *   node scripts/link-runtime-deps.mjs [--runtime <dir>] [--dry-run]
 *   DSH_RUNTIME=<dir> node scripts/link-runtime-deps.mjs
 *
 * <dir> = **包含 node_modules/@deepseek-ai 的目录**。缺省时按序尝试：
 *   DSH_RUNTIME → 在 PATH 上找 dsh → 已可解析的 @deepseek-ai/cordis-plugin-loader。
 */
import { existsSync, mkdirSync, symlinkSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const runtimeArg = argv.includes('--runtime') ? argv[argv.indexOf('--runtime') + 1] : undefined

/** 该目录是否可直接提供 @deepseek-ai 包表。 */
const isRuntime = (dir) => dir !== undefined && existsSync(join(dir, 'node_modules', '@deepseek-ai'))

/** 在 PATH 上找 dsh，回溯到它的 node_modules 宿主目录。 */
function runtimeFromPath() {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  try {
    const found = execFileSync(probe, ['dsh'], { encoding: 'utf8' }).split(/\r?\n/)[0]?.trim()
    if (!found) return undefined
    // <runtime>/node_modules/.bin/dsh → <runtime>
    return resolve(dirname(found), '..', '..')
  } catch {
    return undefined
  }
}

/** 已能解析时，从解析结果回溯运行时目录。 */
function runtimeFromResolve() {
  try {
    const entry = fileURLToPath(import.meta.resolve('@deepseek-ai/cordis-plugin-loader'))
    return dirname(dirname(dirname(entry)))
  } catch {
    return undefined
  }
}

const candidates = [runtimeArg, process.env.DSH_RUNTIME, runtimeFromPath(), runtimeFromResolve()]
const runtime = candidates.find(isRuntime)

if (runtime === undefined) {
  console.error(
    'link-runtime-deps: 找不到 dsh 运行时（需要含 node_modules/@deepseek-ai 的目录）。\n' +
      '  指定方式：node scripts/link-runtime-deps.mjs --runtime <dir>   或   DSH_RUNTIME=<dir>',
  )
  process.exit(1)
}
console.log(`runtime: ${runtime}`)

/** 路径等价比较（Windows 大小写不敏感、去尾分隔符）。 */
const samePath = (a, b) => {
  const norm = (p) => {
    const s = resolve(p).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? s.toLowerCase() : s
  }
  return norm(a) === norm(b)
}

/** 可解析的真实路径；不存在/悬空链接返回 undefined。 */
const realOrUndefined = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return undefined
  }
}

/**
 * 建链接（Windows 用 junction，无需管理员；POSIX 用 symlink）。
 * **指向正确才跳过**；指向别处（含悬空）一律重指——「只判存在」会让测试静默打在旧包上
 * （D47：防线缺席必须响亮，静默通过视为缺陷；#88 实测：旧版对 rc.2 检出会打 `= 已存在`）。
 */
const link = (from, to) => {
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  const want = realOrUndefined(from)
  const present = existsSync(to) || lstatSync(to, { throwIfNoEntry: false }) !== undefined
  if (present) {
    const have = realOrUndefined(to)
    if (want !== undefined && have !== undefined && samePath(want, have)) {
      console.log(`  = 已存在（指向正确） ${to} -> ${have}`)
      return
    }
    const current = have ?? '（悬空/不可解析）'
    if (dryRun) {
      console.log(`  ↻ 将重指 ${to}（现 ${current}）-> ${want ?? from}`)
      return
    }
    rmSync(to, { recursive: true, force: true })
    mkdirSync(dirname(to), { recursive: true })
    symlinkSync(want ?? from, to, type)
    console.log(`  ↻ 重指 ${to} -> ${want ?? from}（原 ${current}）`)
    return
  }
  if (dryRun) {
    console.log(`  + 将建 ${to} -> ${want ?? from}`)
    return
  }
  mkdirSync(dirname(to), { recursive: true })
  // 一律用 realpath 后的**绝对**目标：指向另一个相对 symlink 会在链式解析下再踩同一个坑（#88）。
  symlinkSync(want ?? from, to, type)
  console.log(`  ✓ ${to} -> ${want ?? from}`)
}

/**
 * 运行时提供的 `@deepseek-ai` 包表 = **仓根表 ∪ pnpm hoist 表**（同名以仓根为准），
 * 逐条 realpath 成绝对路径；两边都解析不到的条目**响亮跳过**。
 *
 * 为什么必须合并（#88，2026-10-17 本机实测）：
 *   - 仓根 `node_modules/@deepseek-ai` 只有**仓根依赖**（本机 26 个），缺 `dsh-llm` 等运行时包；
 *   - `.pnpm/node_modules/@deepseek-ai` 是完整闭包（367 个），但含**上一版安装的悬空残留**
 *     （搬到 `packages/experimental/` 的 `dsh-tool-ralph`、已删的 `dsh-invariants` 等 12 个）；
 *     只用 hoist 表会让本 preset 的 `tool-ralph` 行加载不到 → 注册表报 `never started`（实测）。
 */
const packageTable = (runtimeDir) => {
  const moduleDirs = [
    join(runtimeDir, 'node_modules'),
    join(runtimeDir, 'node_modules', '.pnpm', 'node_modules'),
  ].filter((dir) => existsSync(dir))
  const roots = moduleDirs.map((dir) => join(dir, '@deepseek-ai')).filter((dir) => existsSync(dir))
  const names = new Set()
  for (const root of roots) for (const name of readdirSync(root)) names.add(name)
  const table = new Map()
  const dangling = []
  for (const name of [...names].sort()) {
    let real
    for (const root of roots) {
      real = realOrUndefined(join(root, name))
      if (real !== undefined) break
    }
    if (real === undefined) dangling.push(name)
    else table.set(name, real)
  }
  /**
   * 按名从同一批 module 目录取**真实路径**。`yaml` 这类不属于 @deepseek-ai 的直接依赖
   * 也走这里——它同样只在 hoist 表里（本机实测 `<src>/node_modules/yaml` 并不存在）。
   */
  const resolve = (name) => {
    for (const dir of moduleDirs) {
      const real = realOrUndefined(join(dir, name))
      if (real !== undefined) return real
    }
    return undefined
  }
  return { moduleDirs, roots, table, dangling, resolve }
}

/**
 * 逐包建**绝对 junction** 接进挂具（目标容器是真目录）。
 *
 * 为什么不能"一个 junction 指向运行时的 @deepseek-ai 容器"（#88，Windows 实测）：
 * pnpm 的 workspace 包是**相对 symlink**（如 `..\..\..\..\packages\llm\llm`）。经我们那个
 * junction 进去后，Windows 会按**访问路径**解析相对目标 → `<repo>\tests\node_modules\
 * @deepseek-ai\..\..\..\..\packages\llm\llm` = ENOENT（Node 实测 `dsh-llm` 读不到，而同路径直接读得到）。
 * 逐包 realpath 成**绝对** targets 后，每个包都落在真实目录上，解析恢复正常。
 * （POSIX 不受此影响，但统一走这条路更简单。）
 */
const linkPackageTable = (table, toTable, dangling) => {
  if (table.size === 0) {
    console.error(`link-runtime-deps: 运行时里没有可用的 @deepseek-ai 包表`)
    process.exit(1)
  }
  if (dryRun) {
    console.log(`  + 将接 ${table.size} 个包 -> ${toTable}（悬空跳过 ${dangling.length}）`)
    return
  }
  const existing = lstatSync(toTable, { throwIfNoEntry: false })
  if (existing === undefined) {
    mkdirSync(toTable, { recursive: true })
    console.log(`  ✓ 新建 ${toTable}`)
  } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
    rmSync(toTable, { recursive: true, force: true })
    mkdirSync(toTable, { recursive: true })
    console.log(`  ↻ ${toTable}：由链接换成真目录（改为逐包接）`)
  }
  let created = 0, repointed = 0, kept = 0
  for (const [name, from] of table) {
    const to = join(toTable, name)
    const have = realOrUndefined(to)
    if (have !== undefined && samePath(have, from)) {
      kept++
      continue
    }
    if (have !== undefined) {
      rmSync(to, { recursive: true, force: true })
      repointed++
    } else created++
    symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir')
  }
  console.log(`  ✓ ${toTable}：新建 ${created} · 重指 ${repointed} · 已对 ${kept}（共 ${table.size}；悬空跳过 ${dangling.length}）`)
}

/** 本仓 package.json 声明的宿主锚（`<official>-r<N>` / `<official>-a<N>` → `<official>`）。 */
function declaredAnchor() {
  try {
    const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
    const m = /^(.+)-[ra]\d+$/.exec(String(version))
    return m === null ? undefined : m[1]
  } catch {
    return undefined
  }
}

/** 该包表里 `dsh-llm` 的版本；缺失/读不到即 undefined。 */
function tableAnchor(anchor) {
  const dir = anchor.table.get('dsh-llm')
  if (dir === undefined) return undefined
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

// 锚点公安（D47）：测试打在与本仓声明锚不一致的运行时上 = **假绿**。响亮失败，绝不静默。
const declared = declaredAnchor()
const anchor = packageTable(runtime)
const actual = tableAnchor(anchor)
console.log(
  `包表：合并 ${anchor.roots.length} 张表 -> ${anchor.table.size} 个包` +
    (anchor.dangling.length > 0 ? `；悬空跳过 ${anchor.dangling.length} 个：${anchor.dangling.join(', ')}` : '；无悬空'),
)
if (declared === undefined) {
  console.log('! 读不到本仓 package.json 的 version —— 跳过锚点核对（防线缺席已响亮）')
} else if (actual === undefined) {
  console.error(
    `link-runtime-deps: 该运行时里没有 @deepseek-ai/dsh-llm —— 无法核对锚点（本仓声明的锚是 ${declared}）。\n` +
      '  --runtime 要指向**包含 node_modules/@deepseek-ai 的目录**（源码检出的仓根，或已装的 dsh）。\n' +
      '  已知不可用：桌面安装版（包表在 resources/app.asar 内部，磁盘上没有）。',
  )
  process.exit(1)
} else if (actual !== declared) {
  console.error(
    `link-runtime-deps: 锚点不一致 —— 本仓声明 ${declared}，该运行时是 ${actual}。\n` +
      '  测试会打在错的契约上（D47：静默通过视为缺陷）。\n' +
      `  要么 --runtime 指向锚为 ${declared} 的检出，要么先完成版本线重锚。`,
  )
  process.exit(1)
} else {
  console.log(`anchor: ${actual}（与本仓声明一致）`)
}

linkPackageTable(anchor.table, join(REPO, 'tests', 'node_modules', '@deepseek-ai'), anchor.dangling)
const yamlDir = anchor.resolve('yaml')
if (yamlDir === undefined) {
  console.error('link-runtime-deps: 运行时里没有 yaml（插件与测试都 `import \'yaml\'`，缺它整片红）')
  process.exit(1)
}
link(yamlDir, join(REPO, 'tests', 'node_modules', 'yaml'))
link(yamlDir, join(REPO, 'node_modules', 'yaml'))

console.log(dryRun ? 'dry-run：未改动文件系统' : `完成。现在可以：node scripts/verify-all.mjs`)