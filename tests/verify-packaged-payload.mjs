/**
 * verify-packaged-payload.mjs — 「发布面自身能跑」守卫（K1–K6），#84。
 *
 * 为什么存在（票面实测 2026-10-17）：`bin/install.mjs` 顶层 `import '../lib/payload.mjs'`，
 * 而 `lib/` **不在** `package.json` 的 `files` 里。`npm pack` 出的 tarball 只带
 * `bin/install.mjs`（`bin` 字段由 npm 自动包含），解包后跑 CLI 立刻
 * `ERR_MODULE_NOT_FOUND ... package/lib/payload.mjs`、**exit 1** —— 也就是"打包后的 CLI
 * 自身就跑不起来"。而当时整套用例**全绿**，原因不是断言写错，是**没有一条用例执行发布物**：
 *   · `tests/verify-install-tarball.mjs` 从**工作树** import `extractTarball`（工作树里 `lib/`
 *     在，所以那次 import 永远成功）；
 *   · `tests/verify-dual-env.mjs` 虽然真 `npm pack`，但用**工作树的** CLI 去装那个 tarball。
 * 形态归类：与"清单对、货少发"（#55/#66）同族 —— 清单、manifest、安装日志全都正常，
 * 坏的是**发布面里的 import 有断口**，而没有任何判据去看发布面。
 *
 * 判据分两层：廉价层常驻兜底（离线、不需要 npm），权威层定音（真打包、真跑）。
 *
 *   离线层
 *   ├ K1 机制自检：在临时夹具上验证"取闭包"这件事本身有效 —— 闭包必须真的从入口走到
 *   │     传递依赖、并且**不把 `node:` 内置算进来**。没有这一条，一个坏掉的闭包器会
 *   │     返回空集，而"空集 ⊆ 任何集合"让 K2 永远绿（`docs/code-review-brief.md` §8 D2
 *   │     "锁是空的"形态）。
 *   └ K2 闭包 ⊆ 离线建模的发布面（`payloadOf` 展开 ∪ `bin` 自动包含 ∪ `package.json`）。
 *         `payloadOf` 是安装器自己的 `files` 展开实现（单一事实源，§8 D4：不手抄语义）。
 *
 *   打包层（需要 npm）
 *   ├ K3 闭包 ⊆ **真实 tarball 文件表**（npm pack 的自报清单，AC② 的字面判据）
 *   ├ K4 解包后跑 `bin/install.mjs --version` → exit 0 且版本号 == package.json（AC①）
 *   ├ K5 打包保真：解包出来的闭包文件与工作树**逐字节相同** —— 这条把"工作树"和"发布物"
 *   │     焊在一起，`verify-install-tarball.mjs` 从工作树 import 才不是"测了另一个东西"
 *   └ K6 离线模型 ⊆ 真实 tarball：K2 用的那张"发布面"如果声称发了 npm 却没发，K2 会
 *        静默变弱；K6 是一条反向对齐（模型不撒谎）。
 *
 * 为什么闭包用 Node 自己的 resolver（`module.registerHooks`）而不是手写
 * `import ... from '...'` 正则：正则追的是**写法**，`export { x } from './a.mjs'`、多行
 * import、`import()` 各要一条，宽一次还能再绕一层（§8 D13：用正则追写法必输）。resolver
 * 见到的就是**真的**载入图 —— 入口 `await import()` 一次，等于让 Node 自己把断口找出来。
 *
 * 种子面 = `bin` 声明 + 离线模型里**每一个 `.mjs` 路径**（这里规则是"路径以 `.mjs` 结尾"，
 * 不是"根级"）：目录条目（`skills` / `lang-packs` / `sandcastle` / `lib`）由 `payloadOf` 原样
 * 返回、不展开，所以今天恰好是 5 个根级模块（4 个 root 插件 + CLI）；若将来 `files` 里出现
 * 深路径或通配，种子会随之增加 —— 那也是对的：凡是**被显式列进发布面**的模块都可能带着
 * 自己的相对 import，都该被走到。目录下的模块**不单独作种子**，只在**被 import 到**时进闭包，
 * 而那正是判据关心的方向（把没人 import 的文件也拉进来只会制造无关的红）。
 * 这不是为 #84 扩大范围：不变量本身是"发布面里任何相对 import 都必须也在发布面里"，
 * 只验 CLI 等于让插件侧的同族断口没人看。
 *
 * 显式声明**不覆盖**（D13 纪律：与其留一条看着在守、其实不覆盖的锁，不如写明边界）：
 *   · `.mts`（`sandcastle/templates/*`）—— TS 源，Node 不直接执行（那里**有**懒加载相对
 *     import，如 `run-ticket.mts` 的 `await import('./dsh.ts')`，正因不在覆盖内才要写明）；
 *   · 函数体内的懒加载 `await import()` —— 本用例只 `import` 入口、不执行里面的分支
 *     （发布面的 `.mjs` 里今天 0 处懒加载相对 import）；
 *   · `createRequire(...)('./x.mjs')` 这类 CJS 相对解析 —— 不走 ESM 的 resolve 钩子
 *     （今天只有裸包 `require('yaml')`，属 `dependencies` 面，不在 `files` 判据内）。
 *
 * `files` 为什么用**一条目录条目 `lib`** 而不是三条显式文件（#84 第 1 轮复核抓到的实测）：
 * npm 11 的 packlist 在"根 `*.mjs` + 一条深路径 `lib/x.mjs`"同时存在时，会把**整个 `lib/`
 * 的 `.mjs` 都带上**（实测：三条显式条目下 tarball 里仍有 4 个 lib 文件，含 `bundle-patch.mjs`）。
 * 也就是说三种写法**发的东西一样**（都是整个 `lib/`），差别只在清单是否说了实话：
 * 写三条显式路径会让离线模型（K2）与真实发布面**差一条**，将来谁把 `bundle-patch.mjs` 接进
 * 发布面就是**假红**。所以这里选"清单 = 现实"：一条 `lib`，K6 的单向对齐（模型 ⊆ tarball）
 * 也就不会被"npm 多发"绊住（多发方向不由本仓选择，见下）。
 * 代价要写明：`files` 在本仓是**双职**（`bin/install.mjs` 逐条 `cp` 进 store），所以相对
 * 修复前（`f16e541`，store 里一个 lib 文件都没有）安装副本多出 **4 个**文件 —— 其中 3 个是
 * CLI 载入期必需的（`payload` / `runtime-probe` / `safe-target`），第 4 个 `bundle-patch.mjs`
 * （18,810 B）是"npm 整目录发"带进来的副产物：它无消费者、无害，消费者仍是
 * `scripts/regen-bundle.mjs` 与用例。（相对第 1 轮那三条显式条目，本轮只多这 1 个。）
 *
 * 环境边界：npm 缺席（Node 发行版一般自带；也可能只有 corepack）→ 打包层四条
 * `SKIP (loud)`（`scripts/verify-all.mjs` 记 PASS*），**不静默当通过**；离线层照跑。
 *
 * 收尾：临时目录成功/失败都清（D7 / #77）。本文件的 K 编号是自有序列，与
 * `verify-payload-manifest.mjs`（P1–P10）、`verify-install-tarball.mjs`（T1–T4）各自独立。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { testExecutable } from './lib-exec.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_URL = pathToFileURL(REPO).href + '/'
const PKG = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
/** 环境侧断言缺席的统一出口：`SKIP (loud)` 是 scripts/verify-all.mjs 识别 PASS* 的约定串。 */
const skipLoud = (name, why) => {
  console.warn(`  !! SKIP (loud) - ${name} — ${why}`)
  results.push('  ~ ' + name + ' — SKIP (loud)')
}

// ── 载入图记录：注册同步 resolve 钩子，记录每一条真实的 (父模块 → 已解析 URL) 边 ──────
// 必须在**任何** `import()` 之前注册：静态 import 已被提升，故本文件对仓内模块一律走
// 动态 import（否则那些边早已解析完，记录不到）。
const edges = new Map()
const hookAvailable = typeof registerHooks === 'function'
if (hookAvailable) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      // 只记**包内源码**边：`node:` 内置与裸包（node_modules）不是 `files` 白名单的问题面
      // （裸包由 package.json `dependencies` 负责，发布面之外）。
      // ⚠ node_modules 必须在**这里**排除，不能只靠 `closureOf` 的 `anchored` 前缀：
      // 本仓 `node_modules/yaml` 是指向仓外的 junction，realpath 天然在仓外，于是真树看着
      // 干净；而在 `node_modules` 是实体目录的环境里（fresh `npm install` / `git archive`
      // 镜像），上百个 `yaml/**` 会混进闭包 → K2/K3/K5 齐红，把环境布局误报成发布面缺陷
      // （#84 第 1 轮复核实测约 90 个文件）。
      const isPackageSource = typeof resolved?.url === 'string'
        && resolved.url.startsWith('file:')
        && !resolved.url.includes('/node_modules/')
      if (context.parentURL !== undefined && isPackageSource) {
        if (!edges.has(context.parentURL)) edges.set(context.parentURL, new Set())
        edges.get(context.parentURL).add(resolved.url)
      }
      return resolved
    },
  })
}
const repoRelOf = (url) => relative(REPO, fileURLToPath(url)).split(sep).join('/')
/** 指向 `url` 的父模块（**只算闭包内的**：本用例自己也会 import `lib/`，那不是发布面的断口）。 */
const importersOf = (url, within) => [...edges]
  .filter(([, kids]) => kids.has(url))
  .map(([parent]) => parent)
  .filter((parent) => within === undefined || within.includes(repoRelOf(parent)))
  .map((parent) => (parent.startsWith(REPO_URL) ? repoRelOf(parent) : parent))
/**
 * `files` 条目 → 它覆盖的发布路径：等于条目本身、位于**目录条目**之下，或本身是**目录条目
 * 的父目录**（K6 的方向：模型里写的是 `skills`，tarball 里写的是 `skills/ponytail/SKILL.md`）。
 * npm 的目录条目（`skills` / `lang-packs` / `sandcastle`）发的是整棵子树，判据按前缀覆盖走；
 * 否则"发布面里 import 了 `skills/x.mjs`"会被误判成断口（假红）。
 */
const coveredBy = (entries, file) => [...entries].some((entry) =>
  entry === file || file.startsWith(entry + '/') || entry.startsWith(file + '/'))
const coveredBySet = (set, file) => coveredBy([...set], file)

/**
 * 取 `rootDir/entryRel` 的**载入期**包内闭包（含入口自身），路径为相对 `rootDir` 的 posix 串。
 * 真载入一次：Node 解析出来的边就是发布物上会发生的边。
 */
async function closureOf(rootDir, entryRel) {
  const entryUrl = pathToFileURL(join(rootDir, entryRel)).href
  await import(entryUrl)
  const anchored = pathToFileURL(rootDir).href.replace(/\/?$/u, '/')
  const seen = new Set([entryUrl])
  const queue = [entryUrl]
  for (let i = 0; i < queue.length; i++) {
    for (const next of edges.get(queue[i]) ?? []) {
      if (next.startsWith(anchored) && !seen.has(next)) { seen.add(next); queue.push(next) }
    }
  }
  return [...seen].map((url) => relative(rootDir, fileURLToPath(url)).split(sep).join('/'))
}

if (!hookAvailable) {
  bad('K1–K2. 载入图闭包（本机 Node 无 module.registerHooks）',
    `node ${process.version}: 无法取真实 import 图 —— 离线层未验证（不是通过）`)
} else {
  // ── K1: 机制自检（临时夹具：传递依赖必须被走到；`node:` 内置与 `node_modules` 裸包必须
  // 被排除）。裸包这一支不是装饰：闭包的 node_modules 排除**在记录处**做，而真树里
  // `node_modules/yaml` 是指向仓外的 junction（realpath 天然在仓外），所以只有让夹具自带一个
  // **实体的** `node_modules/<pkg>` 才能证伪那行排除 —— 删掉它，K1 必红（#84 第 2 轮复核
  // 指出"该修法无法被任何断言证伪"，这里补上自检）。
  const fx = await mkdtemp(join(tmpdir(), 'dsh-closure-fx-'))
  process.on('exit', () => { try { rmSync(fx, { recursive: true, force: true }) } catch { /* already gone */ } })
  try {
    await mkdir(join(fx, 'nested'), { recursive: true })
    await mkdir(join(fx, 'node_modules', 'fakepkg'), { recursive: true })
    await writeFile(join(fx, 'node_modules', 'fakepkg', 'package.json'),
      JSON.stringify({ name: 'fakepkg', version: '1.0.0', main: 'index.mjs', type: 'module' }))
    await writeFile(join(fx, 'node_modules', 'fakepkg', 'index.mjs'), 'export const fake = 1\n')
    await writeFile(join(fx, 'entry.mjs'),
      "import './dep.mjs'\nimport './nested/deep.mjs'\nimport 'fakepkg'\nimport { readFileSync } from 'node:fs'\nexport const entry = typeof readFileSync\n")
    await writeFile(join(fx, 'dep.mjs'), 'export const dep = 1\n')
    await writeFile(join(fx, 'nested', 'deep.mjs'), "import '../dep.mjs'\nexport const deep = 2\n")
    const fxClosure = (await closureOf(fx, 'entry.mjs')).sort()
    const expectedFixture = ['dep.mjs', 'entry.mjs', 'nested/deep.mjs']
    if (JSON.stringify(fxClosure) === JSON.stringify(expectedFixture)) {
      ok('K1. 闭包器有效：走到传递依赖，排除 node: 内置与实体 node_modules 裸包（夹具自检）',
        fxClosure.join(', '))
    } else {
      bad('K1. 闭包器自检失败（此时 K2 的"绿"没有意义）',
        `got ${JSON.stringify(fxClosure)} expected ${JSON.stringify(expectedFixture)}`)
    }
  } finally {
    await rm(fx, { recursive: true, force: true })
  }

  // ── K2: 发布面的相对 import 闭包 ⊆ 离线建模的发布面 ─────────────────────────
  const { payloadOf } = await import(pathToFileURL(join(REPO, 'lib', 'payload.mjs')).href)
  const payload = await payloadOf(REPO) // 零展开即抛错（installer 同款语义）
  const binPaths = Object.values(PKG.bin ?? {}).map((p) => p.replace(/^\.\//u, ''))
  // 离线模型 = files 展开 ∪ npm 的 `bin` 自动包含 ∪ package.json。**只建模我们依赖的
  // 自动包含规则**（bin / package.json）—— 模型本身由 K6 对着真实 tarball 校准。
  const modeled = new Set([...payload.entries, ...binPaths, 'package.json'])
  const seeds = [...modeled].filter((p) => p.endsWith('.mjs'))
  const closure = [...new Set((await Promise.all(seeds.map((seed) => closureOf(REPO, seed)))).flat())].sort()
  const dangling = closure.filter((p) => !coveredBySet(modeled, p))
  if (closure.length >= 2 && dangling.length === 0) {
    ok('K2. 发布面里每个相对 import 都在 files 白名单内（离线，不需要 npm）',
      `${seeds.length} 个种子 / ${closure.length} 个模块`)
  } else {
    bad('K2. 发布面的 import 有断口（打包后 ERR_MODULE_NOT_FOUND 的形态）',
      closure.length < 2
        ? `闭包退化成 ${JSON.stringify(closure)} —— 闭包器或种子面坏了，这条判据此时无效`
        : dangling.map((p) => `${p} ← ${importersOf(pathToFileURL(join(REPO, p)).href, closure).join(', ')}`).join(' | '))
  }

  // ── K3–K6: 真实打包布局（权威层） ───────────────────────────────────────────
  let npm
  try { npm = testExecutable('npm') } catch (error) { console.warn(error.message) }
  const npmRun = (args) => {
    if (!npm) return { status: null }
    const invocation = testExecutable('npm', { args })
    return spawnSync(invocation.command, invocation.args, { cwd: REPO, encoding: 'utf8', shell: invocation.shell })
  }
  const probe = npmRun(['--version'])
  if (probe.status !== 0) {
    skipLoud('K3–K6. 打包层（npm pack + 解包实跑）', '本机找不到可用的 npm —— 发布物本身未验证')
  } else {
    const work = await mkdtemp(join(tmpdir(), 'dsh-packaged-'))
    process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* already gone */ } })
    try {
      const packed = npmRun(['pack', '--pack-destination', work, '--json'])
      if (packed.status !== 0) {
        bad('K3–K6. npm pack 失败', `exit=${packed.status} ${(packed.stderr ?? '').trim().slice(0, 200)}`)
      } else {
        const info = JSON.parse(packed.stdout)[0]
        // npm pack 自报的文件表 = 权威发布面（不再自己实现一遍 npm 的 files/自动包含语义）。
        const packedSet = new Set(info.files.map((f) => f.path))

        // K3: 闭包在真实 tarball 里一个不缺（AC② 的字面判据）
        const missingPacked = closure.filter((p) => !coveredBySet(packedSet, p))
        if (missingPacked.length === 0) {
          ok('K3. import 闭包每一项都在 npm pack 的文件表里（发布布局，非工作树）',
            `${closure.length} 项 / tarball ${packedSet.size} 项`)
        } else {
          bad('K3. 发布物缺模块（解包即 ERR_MODULE_NOT_FOUND）',
            missingPacked.map((p) => `${p} ← ${importersOf(pathToFileURL(join(REPO, p)).href, closure).join(', ')}`).join(' | '))
        }

        // K4: 解包后真跑一次 CLI —— AC① 的端到端证明
        const { extractTarball } = await import(pathToFileURL(join(REPO, 'bin', 'install.mjs')).href)
        const pkgDir = await extractTarball(join(work, info.filename), join(work, 'unpack'))
        const cli = spawnSync(process.execPath, [join(pkgDir, 'bin', 'install.mjs'), '--version'], { encoding: 'utf8' })
        const version = (cli.stdout ?? '').trim()
        // 红时的诊断要**点名断口**（`Cannot find module '<abs>' …` 那行），只贴栈头没有价值。
        // 取法有次序（第 2 轮复核判为硬违规后定的）：① 含 `Cannot find module` 的行——那是
        // **点出缺失模块**的唯一一行；② 以 `*Error` 开头的行（YAMLParseError 一类没有
        // "Cannot find module" 的失败）；③ 兜底贴前两行非空 stderr（否则非 ERR 类失败的诊断
        // 会退化成空串，比原来更差）。**不要**先匹配 `ERR_[A-Z_]+`：Node 的栈头
        // `throw new ERR_MODULE_NOT_FOUND(` 会先命中它，而那行不含模块名——第 1 版的错就在这。
        const stderrLines = (cli.stderr ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
        const errLine = stderrLines.find((line) => /Cannot find (?:module|package)/u.test(line))
          ?? stderrLines.find((line) => /^[\w$.]*Error\b/u.test(line))
          ?? stderrLines.slice(0, 2).join(' ')
        if (cli.status === 0 && version === PKG.version) {
          ok('K4. 解包后的 CLI 能跑（`bin/install.mjs --version`）', `exit 0，输出 ${version}`)
        } else {
          bad('K4. 解包后的 CLI 跑不起来',
            `exit=${cli.status} stdout=${JSON.stringify(version)} stderr=${JSON.stringify((errLine ?? '').trim())}`)
        }

        // K5: 打包保真 —— 解包出来的闭包文件与工作树逐字节相同
        // 这条是 verify-install-tarball.mjs（从工作树 import）与发布物之间的焊缝。
        const shipped = closure.filter((p) => existsSync(join(pkgDir, p)))
        const differing = []
        for (const p of shipped) {
          const [a, b] = await Promise.all([readFile(join(REPO, p)), readFile(join(pkgDir, p))])
          if (!a.equals(b)) differing.push(p)
        }
        if (shipped.length === closure.length && differing.length === 0) {
          ok('K5. 解包出来的模块与工作树逐字节相同（工作树用例才是对发布物取证）', `${shipped.length} 项`)
        } else {
          bad('K5. 解包内容与工作树不一致（工作树上的绿说明不了发布物）',
            `missing=${JSON.stringify(closure.filter((p) => !shipped.includes(p)))} differing=${JSON.stringify(differing)}`)
        }

        // K6: 离线模型 ⊆ 真实 tarball（模型不撒谎，K2 才不是空锁）
        // 方向是**单向**的：只判"模型说发了的是否真发了"。反方向（npm 比清单多发）不在本判据内
        // —— 那是 npm packlist 的语义，不是本仓能选择的东西；能做的只是让清单别与它打架
        // （所以 `files` 用目录条目 `lib`，见头注）。
        const overClaimed = [...modeled].filter((p) => !coveredBySet(packedSet, p))
        if (overClaimed.length === 0) {
          ok('K6. 离线建模的发布面每一项都真的在 tarball 里（模型对齐）', `${modeled.size} 项`)
        } else {
          bad('K6. 离线模型高估了发布面（K2 会因此变弱）', overClaimed.join(', '))
        }
      }
    } finally {
      await rm(work, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}

console.log('\n=== PACKAGED PAYLOAD VERIFY (K1–K6) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)