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
 * 依赖 profile link 的断言（装载的产物）与 e2e 共用同一 `dshAvail` 守卫——拿不到运行时
 * 时响亮跳过（`SKIP (loud)`，verify-all 记为 PASS*），不硬崩 ENOENT、也不静默当 pass。
 *
 * #47 AC③（2026-10-18 重做）：**装载挂载需要 dsh，而 PATH 上没有 dsh ≠ 运行时缺席**。
 * 本仓的常态正是「PATH 无 dsh、但桌面运行时在盘上」——旧版只认 PATH（`spawnSync('dsh')`），
 * 于是桌面形态断言在本机**从未真跑过**（永远 loud skip，靠 skip 兜底出绿）。现在改为：
 *
 *   1. 运行时解析走 installer 自己的输入契约（`--dsh <path>` / `--pnpm <path>`），
 *      本套件经 **`DSH_MATT_DSH` 环境变量**把桌面 dsh 路径传给被测进程（同一优先级链，
 *      见 lib/runtime-probe.mjs 头注）。测试进程自己**不**复制探测逻辑——那是被测面，
 *      套件只负责「给路径」，给了就真跑、拿不到才 skip。
 *   2. 8 条非 store-only 用例（install / --force / upgrade / uninstall / --from）**必须**
 *      带运行时才能真跑：baseline `b36191f` 靠「dsh 缺席 → warning + 跳过挂载 + **仍 exit 0**」
 *      给它们兜底，那正是 #80 的谎报。现在全探测落空 → 响亮失败 exit≠0，所以这些用例
 *      要么给路径（真跑），要么在拿不到路径时**响亮跳过**（不是静默 pass）。
 *   3. 桌面形态证据**不**走 `--dump-config`：desktop 由 Electron 独占管理，
 *      `dsh --profile desktop --dump-config` 会报 managed exclusively 而失败；
 *      证据只从 profile 层 `package.json` 读回。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { payloadOf } from '../lib/payload.mjs'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(REPO, 'bin', 'install.mjs')
const tmp = await mkdtemp(join(tmpdir(), 'dsh-matt-installer-'))

let passed = 0
let totalSkips = 0
/** 当前用例内的 loud skip 计数：让 per-case 读数也如实（绿色 ≠ 该用例全验过）。
 *  e2e 那条在 test() 之外调用，只计入 totalSkips（stdout/stderr 分流时行序不定，故标记不带方向）。 */
let skipsInCase = 0
/** 环境侧断言缺席的统一出口：`SKIP (loud)` 是 scripts/verify-all.mjs 识别 PASS* 的约定字符串。 */
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

/** dsh on PATH? 旧版唯一的判据（#67）。保留它只为**报错信息里区分两种缺席**：
 *  「PATH 上没有」与「完全没有」在诊断上是两回事（前者可以靠 --dsh 救，后者要去查运行时）。 */
const dshOnPath = spawnSync('dsh', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0

/**
 * 运行时解析（#47 AC③）：被测进程经 `DSH_MATT_DSH` 拿 dsh 路径。
 *
 * 为什么本套件用 **env** 而不是每次拼 `--dsh` flag：优先级链是 flag > env > 探测，
 * 两者等价；但 `run()` 是所有用例的公共入口，注入一次 env 就让**全部**用例
 * （含 4 条 assertLink、desktop、e2e）统一走真跑，不必逐个改命令行——
 * 漏改一条就会退回 skip 兜底，而那种漏改在绿灯下看不出来。
 *
 * 路径从哪来：**外部显式给**（`DSH_MATT_DSH`，与 installer 的契约同名，见
 * lib/runtime-probe.mjs 头注 §1）。套件**不**自己实现探测链——那是被测面。
 * 本机运行时在桌面安装目录，测试进程的 `execPath` 是 node（不是 Electron），
 * 探测链里的 `desktop-runtime` 候选按 `execPath` 推导，**必然落空**：实测
 * `dshCandidates({})` → `[{path:'dsh.cmd',source:'path'},
 * {path:'<nodeDir>/resources/runtime/cli/bin/dsh.cmd',source:'desktop-runtime'}]`，两条都不可用。
 * 所以这里只认显式输入，拿不到就响亮跳过——绝不假装探测。
 */
const dshPath = process.env.DSH_MATT_DSH ?? null
const pnpmPath = process.env.DSH_MATT_PNPM ?? null

/** 能真跑装载的证据是否存在：显式给了 dsh 路径，或 PATH 上就有 dsh。 */
const dshAvail = dshPath !== null || dshOnPath
/** 拿不到 dsh 时，诊断里说清是哪种缺席（见 dshOnPath 注释）。 */
const dshMissingWhy = dshAvail
  ? null
  : 'PATH 上没有 dsh，也没有 DSH_MATT_DSH 显式指路（#47：PATH 无 dsh ≠ 运行时缺席）'

/** Run the installer CLI with args; each test gets its own DSH_HOME.
 *  非 store-only 的用例要真跑装载，所以把运行时路径一并注入子进程环境：
 *  `DSH_MATT_DSH`/`DSH_MATT_PNPM` 是 installer 自己的输入契约（lib/runtime-probe.mjs）。 */
function run(args, dshHome) {
  const env = { ...process.env, DSH_HOME: dshHome }
  if (dshPath !== null) env.DSH_MATT_DSH = dshPath
  if (pnpmPath !== null) env.DSH_MATT_PNPM = pnpmPath
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env })
}

const storeOf = (dshHome) => join(dshHome, '.agent-presets', 'matt')
const readStamp = async (dshHome) => JSON.parse(await readFile(join(storeOf(dshHome), 'VERSION.json'), 'utf8'))
const profilePkg = async (dshHome, profile = 'web') =>
  JSON.parse(await readFile(join(dshHome, 'profiles', profile, 'package.json'), 'utf8'))
const profileDeps = async (dshHome, profile = 'web') => (await profilePkg(dshHome, profile)).dependencies ?? {}

/**
 * `cmdFor(path)` / `argvFor(path, args)` —— 起 dsh 用的 argv 头（本套件自己 spawn dsh 时用，
 * 见 e2e 的 --dump-config）。
 *
 * 为什么不能直接 `spawnSync(dsh, args, {shell:true})`：桌面 dsh 是 `.cmd` 且绝对路径**含空格**，
 * `shell:true` 把命令与参数拼成一整行交给 cmd，空格会把路径切成两截。实测三态（Windows）：
 *   shell:false → status=null, error=EINVAL（`.cmd` 不是可执行体）
 *   shell:true  → status=1  "'C:\<install-dir>\DeepSeek' is not recognized…"（路径首个空格处被切断）
 *   cmd.exe /c  → status=0  ✅
 * 与 lib/runtime-probe.mjs 的 `spawnCandidate` 同口径（那是 installer 侧的同一规则）；
 * 本套件不 import 它——e2e 要走**独立**的起进程路径，否则 installer 的 bug 会同时
 * 污染被测面和取证面。
 */
function cmdFor(path) {
  return process.platform === 'win32' && /\.(cmd|bat)$/iu.test(path) ? 'cmd.exe' : path
}
/** 配 `cmdFor` 用的 argv 前置（`.cmd` 需 `cmd.exe /c <path> …`）。 */
function argvFor(path, args) {
  return cmdFor(path) === 'cmd.exe' ? ['/c', path, ...args] : args
}

/**
 * 把 profile 层记的依赖值归一成**可比较的 store 路径**。
 *
 * 为什么不直接 `assert.equal(dep, join(home, '.agent-presets', 'matt'))`（会假红）：
 * pnpm 写进 `package.json` 的是 `link:` 前缀 + **正斜杠**的路径（实测：
 * `"link:C:/…/.agent-presets/matt"`），而 `join()` 在 Windows 产出**反斜杠**
 * （`C:\…\.agent-presets\matt`）。严格比较于是永远不等 —— 那是假红，不是真缺陷。
 * 归一口径：剥 `link:` / `file:` 前缀 → `\` 与 `/` 统一成正斜杠 → 去掉尾部 `/`。
 * 归一后**仍要逐个比字符串**（不做 realpath 解析：link 的目标可以尚不存在，
 * 而「指向哪」正是本断言要钉的东西）。
 */
function normalizeLinkTarget(value) {
  return String(value ?? '')
    .replace(/^(link|file):/iu, '')
    .replaceAll('\\', '/')
    .replace(/\/+$/u, '')
}

/**
 * 该依赖值是不是**旧分叉**形态（`<store 根>/dsh-matt-preset`）。
 *
 * #47 的原始症状：装载指向旧的分叉目录名而不是稳定 store `…/.agent-presets/matt`。
 * 旧断言只查 `includes('.')`（`linked()`），这个判据对**任何**含点的路径都成立，
 * 包括旧分叉 —— 属同义反复，钉不住 #47。所以单独一条断言把它排除。
 */
function isOldForkTarget(value) {
  return /\/\.agent-presets\/dsh-matt-preset$/u.test(normalizeLinkTarget(value))
}

/**
 * 非 store-only 用例的前置：**装载挂载需要运行时**（#47/#80）。
 *
 * 为什么这些用例不能无视运行时：它们不带 `--root`，所以走挂载分支。baseline `b36191f`
 * 在 dsh 缺席时「warning + 跳过挂载 + **仍 exit 0**」——用例因此绿得毫无根据（#80 的谎报
 * 在给套件兜底）。人类已拍板：全探测落空必须**响亮失败 exit≠0**。于是这些用例现在只有
 * 两种诚实出路：给路径（真跑），或拿不到路径时**响亮跳过**。
 *
 * 断言对象是**被跳过用例的 store 语义**，不是运行时本身——运行时缺席已由 installer 侧
 * 的专门用例覆盖（`--dsh` 指路、exit≠0），这里再断言一次只会在缺环境时制造噪声红。
 * @returns {boolean} true = 已响亮跳过，调用方应立刻 return。
 */
function skipUnlessRuntime(what) {
  if (dshAvail) return false
  loudSkip(`${what} needs a runtime (#47/#80): ${dshMissingWhy}`)
  return true
}

/** profile-link 断言：装载的产物，只有运行时可用时才存在（#67/#47）。
 *  拿不到运行时 → install 不建 link、profile 层根本不存在，读依赖表是 ENOENT 而非断言失败；
 *  所以这里**响亮跳过**（打印原因、不置非零退出），store 侧断言照常实跑。
 *  能真跑时走严格读取：profile 层缺失即真失败，不吞成 pass。 */
async function assertLink(dshHome, want, what) {
  if (!dshAvail) {
    loudSkip(`profile-link proof needs a runtime (#67/#47): ${what} — ${dshMissingWhy}`)
    return
  }
  assert.equal(await linked(dshHome), want, what)
}

/** Is the store linked into the profile (pnpm link: dependency)?
 *  **严格读取**：profile 层缺失即抛 ENOENT，所以只许从 assertLink 的可用分支进来
 *  （拿不到运行时装载本就不建 link，那条路必须先走响亮跳过，而不是到这里抛）。 */
const linked = async (dshHome, profile = 'web') =>
  String((await profileDeps(dshHome, profile))['dsh-matt-preset'] ?? '').includes('.')

await test('install: copies payload to the stable store, stamps version + manifest', async () => {
  if (skipUnlessRuntime('install (store + mount)')) return
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
  if (skipUnlessRuntime('install (profile link)')) return
  const home = join(tmp, 'h2')
  assert.equal(run(['install', '--profile', 'web'], home).status, 0)
  await assertLink(home, true, 'store linked into profile deps')
})

await test('install: refuses to overwrite an existing install', async () => {
  if (skipUnlessRuntime('install (repeat refusal)')) return
  const home = join(tmp, 'h3')
  assert.equal(run(['install', '--profile', 'web'], home).status, 0)
  const r = run(['install', '--profile', 'web'], home)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /already|已存在/i)
})

await test('install --force: overwrites in place, link survives', async () => {
  if (skipUnlessRuntime('install --force')) return
  const home = join(tmp, 'h4')
  assert.equal(run(['install', '--profile', 'web'], home).status, 0)
  const r = run(['install', '--profile', 'web', '--force'], home)
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  await assertLink(home, true, 'link survives --force')
})

await test('upgrade: in-place replace, stamp advances, stale files removed, link kept', async () => {
  if (skipUnlessRuntime('upgrade (in-place)')) return
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

/**
 * 本用例的语义取舍（Lead 采纳，2026-10-18）：**传运行时让它回到 store 语义**。
 *
 * 断言目标是 `/not installed|未安装/i`——它检的是 **store 分支**（upgrade 时
 * `<target>/VERSION.json` 缺席）。但 task-1 之后「运行时解析」**先于** store 检查执行，
 * 所以不传 `--dsh` 时先报的是 dsh 指路，断言目标被重排。
 *
 * 另一条路是「承认无运行时优先」并改断言——**不采纳**：那样这条会从「store 分支的守卫」
 * 退化成「运行时守卫的重复」，而运行时失败面已由 installer 侧的专门用例覆盖
 * （`--dsh`/`DSH_MATT_DSH` 指路 + exit≠0），**重复覆盖 = 丢掉 store 分支的覆盖**。
 * 所以：显式给运行时，让 store 语义可测。
 */
await test('upgrade: fails cleanly when nothing is installed', async () => {
  if (skipUnlessRuntime('upgrade (not-installed refusal)')) return
  const home = join(tmp, 'h6')
  const r = run(['upgrade', '--profile', 'web'], home)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /not installed|未安装/i)
})

await test('uninstall: removes store and the profile link', async () => {
  if (skipUnlessRuntime('uninstall (store + unmount)')) return
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
  if (skipUnlessRuntime('install --from <tarball> (store + mount)')) return
  const src = join(tmp, 'fakepkg')
  await cp(REPO, src, {
    recursive: true,
    filter: (s) => !/[\\/](\.git|node_modules|\.scratch|docs|tests)([\\/]|$)/.test(s),
  })
  const packed = spawnSync('npm', ['pack', '--pack-destination', tmp], { cwd: src, encoding: 'utf8', shell: process.platform === 'win32' })
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
 * #47 AC③（2026-10-18 重做）：桌面形态 —— **一条命令覆盖桌面端**。
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
 * 无运行时（PATH 无 dsh 且无 `DSH_MATT_DSH`）时照 #67 口径**响亮跳过**——install 不建
 * profile link，读依赖表会是 ENOENT；绝不静默当 pass。
 *
 * 断言面（对齐 #47 AC③ 与 batch-state 的「用户可达」口径）：
 *   D1 store 落盘（AC② 的可达性半边）
 *   D2 link **规范化后等于** `<home>/.agent-presets/matt`（**不是**只查含 `.`）
 *   D3 link **不是**旧分叉 `<store 根>/dsh-matt-preset`（#47 原始症状，单独一条）
 *   D4 `dsh.profile.bundles` 含 `dsh-matt-preset`（否则 link 成功也无 patch 可装载）
 *   D5 **一条命令同时覆盖** store 与 link（AC②「用户可达」的完整形态）
 */
await test('install --profile desktop: one command reaches store + profile link', async () => {
  if (!dshAvail) {
    loudSkip(`desktop-profile install proof needs a runtime (#47/#67): ${dshMissingWhy}`)
    return
  }
  const home = join(tmp, 'desktop')
  const profileDir = join(home, 'profiles', 'desktop')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'),
    JSON.stringify({ name: 'desktop', private: true, dependencies: {} }, null, 2))
  const r = run(['install', '--profile', 'desktop'], home)
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)

  // D1: store 落盘（AC② 的可达性半边）
  assert.ok(existsSync(join(storeOf(home), 'VERSION.json')), `store not written: ${storeOf(home)}`)

  const profile = await profilePkg(home, 'desktop')
  const dep = String(profile.dependencies?.['dsh-matt-preset'] ?? '')
  const want = join(home, '.agent-presets', 'matt')
  // D2: 归一后**等于**稳定 store 路径。旧断言只 `match(/\./)`——那个判据对任何含点的
  //     路径都成立（含旧分叉），属同义反复，钉不住 #47 的「指向哪」。
  assert.equal(normalizeLinkTarget(dep), normalizeLinkTarget(want),
    `desktop profile link must point at the stable store ${want}; got ${JSON.stringify(profile.dependencies)}`)
  // D3: 显式排除旧分叉（#47 原始症状，单独一条——D2 若被后人放宽成子串匹配，这条仍守得住）
  assert.ok(!isOldForkTarget(dep),
    `desktop profile link points at the OLD fork (…/.agent-presets/dsh-matt-preset): ${JSON.stringify(dep)}`)
  // D4: 装载声明——bundle 列表必须含本 preset，否则 profile link 成功也无 patch 可装载
  assert.ok(Array.isArray(profile.dsh?.profile?.bundles) && profile.dsh.profile.bundles.includes('dsh-matt-preset'),
    `desktop profile bundles missing dsh-matt-preset: ${JSON.stringify(profile.dsh)}`)
  // D5: 一条命令同时覆盖（AC②）——store 与 link 都在同一次 install 后到位。
  //     与 D1/D2 重复的部分是本意：这条把「可达性」当**联合**不变量钉住，
  //     任何一半缺失都会红（扰动 B 走的就是这条）。
  assert.ok(existsSync(join(storeOf(home), 'VERSION.json')) && await linked(home, 'desktop'),
    'AC②: one `install --profile desktop` must land BOTH the store and the profile link')
})

if (dshAvail) {
  await test('e2e: installed preset mounts on the current anchor (dump-config shows the row, plugin imports)', async () => {
    const home = join(tmp, 'e2e')
    const r = run(['install', '--profile', 'web'], home)
    assert.equal(r.status, 0, `install exit ${r.status}: ${r.stderr}`)
    // 1) 装载载体生效：composed tree 出现本 preset 的插件行。
    //    走**解析出的** dsh（#47 AC③）：旧版用字面 `'dsh'` + shell:true，PATH 无 dsh 时
    //    这条永远不可能跑；而桌面 dsh 的绝对路径**含空格**，shell:true 会被 cmd 切成两截
    //    （实测 `'C:\<install-dir>\DeepSeek' is not recognized`）。
    //    ⇒ 经 `cmdFor`/`argvFor` 以参数数组传递（`.cmd` → `cmd.exe /c`）。
    //    这条仍用 `web` profile：desktop 被 Electron 独占，--dump-config 会被拒。
    const dshExe = dshPath ?? 'dsh'
    const dump = spawnSync(cmdFor(dshExe), argvFor(dshExe, ['--profile', 'web', '--dump-config']), {
      encoding: 'utf8', env: { ...process.env, DSH_HOME: home },
    })
    assert.equal(dump.status, 0, `dump-config failed: ${dump.stderr}`)
    assert.match(dump.stdout, /id: dsh-matt-preset/, 'preset row not in composed tree')
    assert.match(dump.stdout, /dsh-matt-preset\/workflow-enforcer\.mjs/, 'enforcer plugin not referenced')
    // 2) 安装副本自身可加载（插件文件 + yaml 依赖在 link/store 路径下解析）
    const enforcer = join(storeOf(home), 'workflow-enforcer.mjs')
    const imp = spawnSync(process.execPath, [
      '-e', `import('file:///${enforcer.replaceAll('\\', '/')}').then(() => console.log('OK'))`,
    ], { encoding: 'utf8' })
    assert.equal(imp.status, 0, `plugin import failed: ${imp.stderr}`)
    assert.ok(imp.stdout.includes('OK'))
  })
} else {
  // AC1 的证明性 e2e 需要运行时；缺席时响亮降级并计入汇总，绝不静默当 pass
  loudSkip(`e2e mount proof needs a runtime (AC1 evidence): ${dshMissingWhy}`)
}

console.log(`\n${process.exitCode ? 'FAILED' : `all ${passed} tests passed${totalSkips > 0 ? `（含 ${totalSkips} 条 loud skip：其环境侧断言未验证）` : ''}`}`)
if (process.exitCode) console.log(`tmp kept: ${tmp}`)
else await rm(tmp, { recursive: true, force: true })
