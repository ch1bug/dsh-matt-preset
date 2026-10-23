/**
 * verify-payload-manifest.mjs — package.json `files` 白名单的**离线**守卫
 * （retro 2026-10-16 第 1 项；对应 issue #66 那类"清单对、货少发"）。
 *
 * 为什么存在：展开规则原在 bin/install.mjs 内部，而该文件当时 import 即执行 CLI
 * （main 守卫是同一 retro 才补上的）→ 无法单测。于是 #55 实测到的缺陷默认套件全绿：
 * `workflow-profile-*.txt` 这类**文件名前缀通配**被 expandEntry 静默展开成空数组，
 * payload 少发货，而清单 / manifest / 安装日志全都正常；唯一的防线是环境门禁
 * （DSH_MATT_INSTALLER）下的 verify-installer，常规 `pnpm test` 看不到。
 *
 * 本用例用**安装器自己的实现**（lib/payload.mjs，单一事实源；不重写一份语义），
 * 离线断言每个白名单条目至少解析出一个现存文件——#66 落地前它保证缺陷变红，
 * 落地后它保证没有条目再被静默吞掉。
 *
 * #66 落地后分两层覆盖（都在临时包上离线复现，不需要环境门禁）：
 *   - 展开规则（P4–P6）：文件名前缀通配命中、目录通配、`*.mjs` 不回归；
 *   - 响亮失败（P7–P9）：零展开条目（通配没命中 / 显式条目不存在）报错并点名条目，
 *     安装器 CLI 退出非 0 且不落 store（宁可不装，也不装一半）；
 *   - 正向端到端（P10）：CLI 真装一次，通配命中的文件落进 store、manifest.files 一致
 *     （fixture 自带 `node_modules/yaml` stub，所以不依赖仓外依赖、fresh clone 也不会红）。
 *
 * #72 落地后加第三层（P11–P17）：语法收敛与通配命中逐文件——
 *   - 通配命中**逐文件**（P11 / P13）：命中目录递归枚举其下的文件进 payload，目录本身
 *     不再是条目（manifest.files 对通配条目保真为逐文件清单）；空目录不发货也不报错
 *     （P11 / P13），**只**命中空目录 = 零展开 → 仍响亮（P14）；
 *   - 显式目录条目仍是一条（P12）：manifest 保真但不膨胀（`skills` 这类不展开）；
 *   - 子集外语法具名拒绝（P15–P17）：`**` 任何位置、`?`/`{}`/`[]`/`!`（即使文件系统上
 *     真有同名文件）都在展开层抛 `unsupported files pattern: <条目>`；CLI 退出非 0、
 *     点名条目、不落 store——`dir/**` 静默退化成 `dir/*` 的旧病就此变红。
 *
 * 本文件的 P 编号是**自有序列**（P1–P17）：与 `tests/verify-workflow-profiles.mjs`
 * （P1–P4）和 `tests/verify-workflow-profiles-2.mjs`（P5–P8）各自独立，引用时带文件名。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandEntry, payloadOf } from '../lib/payload.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const PKG = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

// ── P1–P3: 本仓清单的断言（用安装器自己的实现，不重写一份语义） ─────────────
// payloadOf 已把"条目零展开"升级为抛错（#66），所以这里**不再手抄一遍检测逻辑**：
// 捕获到的错误就是 P1 的判据，消息里已列出全部未解析条目（诊断不丢；裸 await 会让
// 真回归以未捕获栈退出，连结果表和条目名一起丢掉）。
let payload = null
let payloadError = null
try { payload = await payloadOf(REPO) } catch (error) { payloadError = String(error?.message ?? error) }
if (payload !== null) {
  ok('P1. every files entry resolves to at least one existing file', `${PKG.files.length} entries`)
} else {
  bad('P1. files entry resolves to NOTHING (installer dies instead of shipping short)', payloadError)
}

const entries = payload?.entries ?? []
if (entries.length >= 10 && new Set(entries).size === entries.length) {
  ok('P2. payloadOf() yields a non-empty, duplicate-free payload', `${entries.length} paths`)
} else {
  bad('P2. payloadOf()', `${entries.length} paths, ${new Set(entries).size} unique`)
}

// ── P3: bundle 载体必须在 payload 里（否则挂载成功但无 patch 可装载，#28） ────
// #99：`dsh.bundle.patch` 由**字符串变数组**（一个 bundle 四个模式，ADR-0015），
// 断言随之从"取出那一条"变成"**每一条**都在 payload 内"——语义**加强**而非放宽：
// 声明里任何一份 patch 缺席，挂载都会少一个模式（或整包挂不上）。
const patch = PKG.dsh?.bundle?.patch
const patchPaths = (Array.isArray(patch) ? patch : [patch])
  .filter((p) => typeof p === 'string')
  .map((p) => p.replace(/^\.\//, ''))
const absentPatches = patchPaths.filter((p) => !entries.includes(p))
if (patchPaths.length > 0 && absentPatches.length === 0) {
  ok('P3. every declared bundle patch rides in the payload', patchPaths.join(', '))
} else {
  bad('P3. bundle patch in payload',
    `declared=${JSON.stringify(patchPaths)} absent=${JSON.stringify(absentPatches)}`)
}

// ── P4–P6: 展开规则本身（#66 的票面现象，在临时包上离线复现） ────────────────
// 为什么要临时包：本仓的 files 清单**不含文件名通配**（#66 明确不改清单；它唯一的通配
// 是根级 `*.mjs`），所以只有造一个写成通配的包，才能把"文件名前缀通配被静默展开成空"
// 变成默认套件下的红灯。
const FX = await mkdtemp(join(tmpdir(), 'dsh-payload-'))
// 中途抛出也要清干净（真回归时别把 tmp 留一地）：exit 钩子做同步 best-effort 清理。
process.on('exit', () => { try { rmSync(FX, { recursive: true, force: true }) } catch { /* already gone */ } })
await mkdir(join(FX, 'deltas'), { recursive: true })
for (const n of ['name-a.txt', 'name-b.txt', 'other.txt']) await writeFile(join(FX, 'deltas', n), n)
await writeFile(join(FX, 'root-a.mjs'), '')
// #72 fixture：trees/ 供"通配命中目录逐文件"（sub 两层 + 空目录 hollow）；bundle/ 供
// "显式目录条目仍是一条"；三个字面通配字符文件供 P16——`!`/`[]`/`{}` 在 Windows 上
// 合法、**真建出来**，证明拒绝先于文件系统访问（`?` 在 Windows 上建不出来，其拒绝
// 由语法检查先行保证，不依赖文件存在）。
await mkdir(join(FX, 'trees', 'sub', 'deeper'), { recursive: true })
await mkdir(join(FX, 'trees', 'hollow'), { recursive: true })
await mkdir(join(FX, 'bundle'), { recursive: true })
for (const n of ['trees/sub/c.txt', 'trees/sub/deeper/d.txt', 'bundle/x.txt', 'bundle/y.txt'])
  await writeFile(join(FX, n), n)
for (const n of ['bang!.txt', 'brack[0].txt', 'brace{a}.txt']) await writeFile(join(FX, n), n)

const filenameGlob = (await expandEntry(FX, 'deltas/name-*.txt')).sort()
if (JSON.stringify(filenameGlob) === JSON.stringify(['deltas/name-a.txt', 'deltas/name-b.txt']))
  ok('P4. a file-name prefix glob expands to the files it matches (#66)', filenameGlob.join(', '))
else bad('P4. file-name prefix glob', `got ${JSON.stringify(filenameGlob)} — #66: npm 语义下应为 name-a/name-b`)

const rootGlob = (await expandEntry(FX, '*.mjs')).sort()
if (JSON.stringify(rootGlob) === JSON.stringify(['root-a.mjs']))
  ok('P5. the root `*.mjs` glob still expands (AC: existing behaviour unchanged)')
else bad('P5. root glob regression', JSON.stringify(rootGlob))

const dirGlob = (await expandEntry(FX, 'deltas/*')).sort()
if (JSON.stringify(dirGlob) === JSON.stringify(['deltas/name-a.txt', 'deltas/name-b.txt', 'deltas/other.txt']))
  ok('P6. a directory glob lists that directory (npm semantics; name prefix may be empty)')
else bad('P6. directory glob', JSON.stringify(dirGlob))

// ── P7–P8: 零展开必须响亮（#66 修法②：files 是唯一发货契约） ────────────────
// 两个入口都要覆盖：文件名通配没命中、以及显式条目不存在——后者 #66 之前是
// payloadOf 按条目名 existsSync 后**静默丢弃**，正是"清单对、货少发"。
await writeFile(join(FX, 'package.json'),
  JSON.stringify({ files: ['root-a.mjs', 'deltas/gone-*.txt', 'missing.txt'] }))
let loud = null
try { await payloadOf(FX) } catch (error) { loud = String(error?.message ?? error) }
const bothNamed = loud !== null && loud.includes('deltas/gone-*.txt') && loud.includes('missing.txt')
if (bothNamed)
  ok('P7. every entry resolving to nothing is a loud error naming the entry (#66)')
else bad('P7. zero-resolution entry',
  loud === null ? 'payloadOf() returned silently — the payload would ship short' : `message incomplete: ${loud}`)

await writeFile(join(FX, 'package.json'), JSON.stringify({ files: ['root-a.mjs', 'deltas/name-*.txt'] }))
let good = null
try { good = (await payloadOf(FX)).entries.slice().sort() } catch (error) { good = `threw: ${String(error?.message ?? error)}` }
if (Array.isArray(good) && JSON.stringify(good) === JSON.stringify(['deltas/name-a.txt', 'deltas/name-b.txt', 'root-a.mjs']))
  ok('P8. a fully-resolving whitelist still yields exactly its payload (no false alarm)')
else bad('P8. payloadOf on a good whitelist', JSON.stringify(good))

// ── P9: 安装器 CLI 上的可见失败（真正的"货不对板"防线） ─────────────────────
// 库层抛错只是手段；契约是**安装器不能再静默少发货**。`--root` = 纯存储模式（不碰
// profile、也不需要 dsh），所以离线套件里就能断言：退出码非 0、消息点名那条条目、
// 且 store 根本没落盘（宁可不装，也不装一半）。
// 这条断言依赖 installTo 的语句顺序——先 `payloadOfOrDie`、后 `rm/mkdir(target)`
// （bin/install.mjs 里 payload 解析在清空目标之前）；若顺序变了，"不落 store" 会失效。
const store = join(FX, 'store')
await writeFile(join(FX, 'package.json'), JSON.stringify({ files: ['root-a.mjs', 'deltas/gone-*.txt'] }))
const cli = spawnSync(process.execPath, [join(REPO, 'bin', 'install.mjs'), 'install', '--root', store, '--from', FX], { encoding: 'utf8' })
if (cli.status !== 0 && /deltas\/gone-\*\.txt/.test(cli.stderr ?? '') && !existsSync(store))
  ok('P9. the installer CLI dies loudly (no store written) on an unresolved files entry (#66)')
else bad('P9. installer CLI loudness', `exit=${cli.status} store=${existsSync(store)} stderr=${(cli.stderr ?? '').trim().slice(0, 160)}`)

// ── P10: 正向端到端——通配命中的文件**真的落进 store**（#66 症状的正面证明） ──
// P4/P8 只证明"规则层"能展开；票面症状是"装完 store 里没有那个文件"，所以这里真装一次。
// fixture 自带 `node_modules/yaml` stub：安装器的运行时依赖解析锚在来源包自身，有 stub
// 就走不到仓外 node_modules——因此这条用例在 fresh clone 上也成立（不引入环境门禁）。
// `manifest.dependencies.yaml` 等于 stub 版本，同时证明"用的正是 fixture 里的 stub"。
await mkdir(join(FX, 'node_modules', 'yaml'), { recursive: true })
await writeFile(join(FX, 'node_modules', 'yaml', 'package.json'),
  JSON.stringify({ name: 'yaml', version: '0.0.0-stub' }))
await writeFile(join(FX, 'package.json'),
  JSON.stringify({ name: 'fx', version: '9.9.9', files: ['root-a.mjs', 'deltas/name-*.txt'] }))
const okRoot = join(FX, 'store-ok')
const fresh = spawnSync(process.execPath, [join(REPO, 'bin', 'install.mjs'), 'install', '--root', okRoot, '--from', FX], { encoding: 'utf8' })
const okStore = join(okRoot, 'matt')
const landed = ['deltas/name-a.txt', 'deltas/name-b.txt'].every((f) => existsSync(join(okStore, f)))
const manifest = existsSync(join(okStore, 'manifest.json'))
  ? JSON.parse(await readFile(join(okStore, 'manifest.json'), 'utf8')) : {}
const expectedFiles = ['deltas/name-a.txt', 'deltas/name-b.txt', 'root-a.mjs']
const manifestMatches = JSON.stringify((manifest.files ?? []).slice().sort()) === JSON.stringify(expectedFiles.slice().sort())
if (fresh.status === 0 && landed && manifestMatches && manifest.dependencies?.yaml === '0.0.0-stub')
  ok('P10. the installer really ships every glob-matched file (store + manifest.files agree)', (manifest.files ?? []).join(', '))
else bad('P10. installer positive glob case',
  `exit=${fresh.status} landed=${landed} files=${JSON.stringify(manifest.files)} yaml=${String(manifest.dependencies?.yaml)} stderr=${(fresh.stderr ?? '').trim().slice(0, 160)}`)

// ── P11–P14: 通配命中逐文件、空目录不发货、显式目录仍是一条（#72 拍板口径） ────
// 旧实现把命中到的目录**当条目**进 payload（store 里的子树靠安装器递归 cp 带上），
// manifest.files 因此不是逐文件的发货清单；空目录也会被当条目发货。#72 后：
// 命中目录 → 递归枚举其下的文件（npm 对命中目录递归的语义）；空目录 → 贡献零个文件。
const treeGlob = (await expandEntry(FX, 'trees/*')).sort()
if (JSON.stringify(treeGlob) === JSON.stringify(['trees/sub/c.txt', 'trees/sub/deeper/d.txt']))
  ok('P11. a glob hitting directories expands per-file, recursively (#72: no dir entries; empty dir ships nothing)', treeGlob.join(', '))
else bad('P11. per-file wildcard expansion', JSON.stringify(treeGlob))

await writeFile(join(FX, 'package.json'), JSON.stringify({ files: ['root-a.mjs', 'bundle'] }))
let explicitDir = null
try { explicitDir = (await payloadOf(FX)).entries.slice().sort() } catch (error) { explicitDir = `threw: ${String(error?.message ?? error)}` }
if (JSON.stringify(explicitDir) === JSON.stringify(['bundle', 'root-a.mjs']))
  ok('P12. an explicit directory entry stays ONE payload entry (#72: manifest stays faithful without inflating)', explicitDir.join(', '))
else bad('P12. explicit directory entry', JSON.stringify(explicitDir))

await writeFile(join(FX, 'package.json'), JSON.stringify({ files: ['root-a.mjs', 'trees/*'] }))
let perFile = null
try { perFile = (await payloadOf(FX)).entries.slice().sort() } catch (error) { perFile = `threw: ${String(error?.message ?? error)}` }
if (JSON.stringify(perFile) === JSON.stringify(['root-a.mjs', 'trees/sub/c.txt', 'trees/sub/deeper/d.txt']))
  ok('P13. payloadOf lists files only for wildcard entries; a matched empty dir ships nothing, no error (#72)', perFile.join(', '))
else bad('P13. payloadOf per-file wildcard', JSON.stringify(perFile))

// 边界：通配**只**命中空目录 = 零展开 → 仍按 #66 的口径响亮（不是新语义的静默逃生阀）。
await writeFile(join(FX, 'package.json'), JSON.stringify({ files: ['trees/hollow/*'] }))
let hollowLoud = null
try { await payloadOf(FX) } catch (error) { hollowLoud = String(error?.message ?? error) }
if (hollowLoud !== null && hollowLoud.includes('trees/hollow/*'))
  ok('P14. a wildcard matching ONLY an empty dir is still the loud zero-resolution error (#72 boundary)')
else bad('P14. empty-dir-only wildcard',
  hollowLoud === null ? 'payloadOf() returned silently — empty dirs would ship as entries' : `message incomplete: ${hollowLoud}`)

// ── P15–P17: 子集外语法一律具名拒绝（#72：`dir/**` 静默退化成 `dir/*` 变响） ───
// `**` 无论落在哪一段都曾静默退化（`dir/**` ≡ `dir/*`）或零命中；#72 后在展开层
// 抛 `unsupported files pattern: <条目>`，先于一切文件系统访问。
const doubleStar = []
for (const entry of ['trees/**', '**/*.mjs', 'trees/**/*.txt']) {
  let msg = null
  try { await expandEntry(FX, entry) } catch (error) { msg = String(error?.message ?? error) }
  if (msg === null || !msg.includes('unsupported files pattern') || !msg.includes(entry)) doubleStar.push(`${entry}(${msg ?? 'no throw'})`)
}
if (doubleStar.length === 0)
  ok('P15. `**` in any position is a named error at the expansion layer (#72)', 'trees/**, **/*.mjs, trees/**/*.txt')
else bad('P15. `**` must throw unsupported files pattern', `not rejected: ${doubleStar.join(', ')}`)

// 字面通配字符同理——且 bang!/brack/brace 三个文件**真实存在**于 fixture 根上：
// 旧实现把它们当字面量，在允许这些字符的文件系统上会静默命中（Linux 实测路径）；
// #72 的判据先于存在性，条目本身被具名拒绝。
const literalChars = []
for (const entry of ['bang!.txt', 'brack[0].txt', 'brace{a}.txt', 'trees/q?.txt', 'trees/x?*.txt']) {
  let msg = null
  try { await expandEntry(FX, entry) } catch (error) { msg = String(error?.message ?? error) }
  if (msg === null || !msg.includes('unsupported files pattern') || !msg.includes(entry)) literalChars.push(`${entry}(${msg ?? 'no throw'})`)
}
if (literalChars.length === 0)
  ok('P16. `?`/`{}`/`[]`/`!` are named errors even when same-named files exist on disk (#72)', 'bang!.txt, brack[0].txt, brace{a}.txt, trees/q?.txt, trees/x?*.txt')
else bad('P16. literal glob metacharacters must throw', `not rejected: ${literalChars.join(', ')}`)

// CLI 收口（同 P9 的语义，换成子集外语法）：退出非 0、stderr 点名 pattern、store 没落盘。
// 同样依赖 installTo 的语句顺序——payload 解析（payloadOfOrDie）先于 rm/mkdir(target)。
const patternStore = join(FX, 'store-pattern')
await writeFile(join(FX, 'package.json'), JSON.stringify({ files: ['root-a.mjs', 'trees/**'] }))
const cliPattern = spawnSync(process.execPath, [join(REPO, 'bin', 'install.mjs'), 'install', '--root', patternStore, '--from', FX], { encoding: 'utf8' })
if (cliPattern.status !== 0 && /unsupported files pattern/.test(cliPattern.stderr ?? '')
  && (cliPattern.stderr ?? '').includes('trees/**') && !existsSync(patternStore))
  ok('P17. the installer dies loudly (exit≠0, no store) on an unsupported files pattern (#72)')
else bad('P17. installer loudness on unsupported pattern',
  `exit=${cliPattern.status} store=${existsSync(patternStore)} stderr=${(cliPattern.stderr ?? '').trim().slice(0, 160)}`)

console.log('\n=== PAYLOAD MANIFEST VERIFY (offline) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)