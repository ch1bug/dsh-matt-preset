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
 * 种子面 = `bin` 声明 + 发布面里所有 `.mjs`（四个 root 插件模块 + CLI）。这不是为 #84 扩大
 * 范围：不变量本身是"发布面里任何相对 import 都必须也在发布面里"，只验 CLI 等于让插件
 * 侧的同族断口没人看。`.mts`（`sandcastle/templates/*`）不在种子面：它们是 TS 源，Node 不
 * 直接执行，**显式声明不覆盖**（同一 D13 纪律：与其留一条看着在守、其实不覆盖的锁，不如
 * 写明边界）。
 *
 * `files` 里刻意**没有** `lib/bundle-patch.mjs`：它的消费者是 `scripts/regen-bundle.mjs`
 * 与用例（仓内构建面），发布物不 import 它。所以判据不是"`lib/` 全发"，而是"**发布面
 * import 到的必须发**"——正是 K2/K3 判的那条（谁把它接进发布面，谁的红灯就亮）。
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
      // 只记包内文件边：`node:` 内置与裸包（node_modules）不是 `files` 白名单的问题面。
      if (context.parentURL !== undefined && typeof resolved?.url === 'string' && resolved.url.startsWith('file:')) {
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
  // ── K1: 机制自检（临时夹具：传递依赖必须被走到、内置必须被排除） ─────────────
  const fx = await mkdtemp(join(tmpdir(), 'dsh-closure-fx-'))
  process.on('exit', () => { try { rmSync(fx, { recursive: true, force: true }) } catch { /* already gone */ } })
  try {
    await mkdir(join(fx, 'nested'), { recursive: true })
    await writeFile(join(fx, 'entry.mjs'), "import './dep.mjs'\nimport './nested/deep.mjs'\nimport { readFileSync } from 'node:fs'\nexport const entry = typeof readFileSync\n")
    await writeFile(join(fx, 'dep.mjs'), 'export const dep = 1\n')
    await writeFile(join(fx, 'nested', 'deep.mjs'), "import '../dep.mjs'\nexport const deep = 2\n")
    const fxClosure = (await closureOf(fx, 'entry.mjs')).sort()
    const expectedFixture = ['dep.mjs', 'entry.mjs', 'nested/deep.mjs']
    if (JSON.stringify(fxClosure) === JSON.stringify(expectedFixture)) {
      ok('K1. 闭包器有效：走到传递依赖、排除 node: 内置（夹具自检）', fxClosure.join(', '))
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
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const npmViaNode = existsSync(npmCli)
  // 直接 `npm` + shell:true 在 Node 24 会触发 DEP0190；能走 npm-cli.js 就走它。
  const npmRun = (args) => (npmViaNode
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd: REPO, encoding: 'utf8' })
    : spawnSync('npm', args, { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32' }))
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
        if (cli.status === 0 && version === PKG.version) {
          ok('K4. 解包后的 CLI 能跑（`bin/install.mjs --version`）', `exit 0，输出 ${version}`)
        } else {
          bad('K4. 解包后的 CLI 跑不起来',
            `exit=${cli.status} stdout=${JSON.stringify(version)} stderr=${(cli.stderr ?? '').trim().split('\n').filter(Boolean).slice(1, 3).join(' ')}`)
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