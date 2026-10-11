/**
 * verify-installer.mjs — #28 preset 安装→装载整链的 installer 单测。
 *
 * #21 的 copy-installer 在 rc.2 上装完加载不了（preset 目录自动发现已死，
 * 装载机制 = bundle patch 经 `dsh plugin --profile <p> add <store>`）。
 * 覆盖：install（fresh：存储副本 + profile link + 版本戳 + 清单）、重复
 * install 拒绝、--force、upgrade（原地替换）、uninstall（连 profile link
 * 一起摘）、--version、--from tarball；外加整链 e2e：隔离 DSH_HOME 上
 * `dsh --dump-config` 出现 preset-matt 行 + 安装副本插件可 import。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(REPO, 'bin', 'install.mjs')
const tmp = await mkdtemp(join(tmpdir(), 'dsh-matt-installer-'))

let passed = 0
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`) }
  catch (e) { console.error(`  FAIL - ${name}\n${e?.stack ?? e}`); process.exitCode = 1 }
}

const pkg = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'))
const pkgVersion = pkg.version

/** dsh on PATH? The e2e (profile + dump-config) needs it; unit tests don't. */
const dshOnPath = spawnSync('dsh', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0

/** Run the installer CLI with args; each test gets its own DSH_HOME. */
function run(args, dshHome) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: dshHome },
  })
}

const storeOf = (dshHome) => join(dshHome, '.agent-presets', 'matt')
const readStamp = async (dshHome) => JSON.parse(await readFile(join(storeOf(dshHome), 'VERSION.json'), 'utf8'))
const profileDeps = async (dshHome, profile = 'web') =>
  JSON.parse(await readFile(join(dshHome, 'profiles', profile, 'package.json'), 'utf8')).dependencies ?? {}

/** Is the store linked into the profile (pnpm link: dependency)? */
const linked = async (dshHome, profile = 'web') =>
  String((await profileDeps(dshHome, profile))['dsh-matt-preset'] ?? '').includes('.')

await test('install: copies payload to the stable store, stamps version + manifest', async () => {
  const home = join(tmp, 'h1')
  const r = run(['install', '--profile', 'web'], home)
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  const stamp = await readStamp(home)
  assert.equal(stamp.version, pkgVersion)
  // payload 完整：bundle 载体、插件、skills、lang-packs、sandcastle
  for (const f of ['preset.yml', 'agent.cordis.yml', 'cordis.patch.yml',
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
  assert.ok(await linked(home), 'store not linked into profile deps')
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
  assert.ok(await linked(home))
})

await test('upgrade: in-place replace, stamp advances, stale files removed, link kept', async () => {
  const home = join(tmp, 'h5')
  assert.equal(run(['install', '--profile', 'web'], home).status, 0)
  await writeFile(join(storeOf(home), 'stale-old-plugin.mjs'), '// old')
  const r = run(['upgrade', '--profile', 'web'], home)
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  assert.ok(!existsSync(join(storeOf(home), 'stale-old-plugin.mjs')), 'stale file survived upgrade')
  assert.equal((await readStamp(home)).version, pkgVersion)
  assert.ok(await linked(home), 'link lost across upgrade')
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
  assert.ok(!(await linked(home)), 'profile link survived uninstall')
  assert.notEqual(run(['uninstall', '--profile', 'web'], home).status, 0)
})

await test('--version: prints package version', () => {
  const r = run(['--version'], tmp)
  assert.equal(r.status, 0)
  assert.ok(r.stdout.includes(pkgVersion), `stdout: ${r.stdout}`)
})

await test('--root: store-only mode — no profile touched even with dsh present', async () => {
  const home = join(tmp, 'h9')
  const root = join(tmp, 'custom-root')
  const r = run(['install', '--root', root], home) // dshAvailable()=true on this machine
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
  // 载体 cordis.patch.yml 在包内）——否则挂载虽 link 成功却无 patch 可装载。
  const tpkg = JSON.parse(await readFile(join(storeOf(home), 'package.json'), 'utf8'))
  assert.equal(tpkg.dsh?.bundle?.patch, './cordis.patch.yml', 'bundle patch declaration lost via tarball')
  assert.ok(existsSync(join(storeOf(home), 'cordis.patch.yml')), 'carrier lost via tarball')
})

if (dshOnPath) {
  await test('e2e: installed preset mounts on rc.2 (dump-config shows the row, plugin imports)', async () => {
    const home = join(tmp, 'e2e')
    const r = run(['install', '--profile', 'web'], home)
    assert.equal(r.status, 0, `install exit ${r.status}: ${r.stderr}`)
    // 1) 装载载体生效：composed tree 出现本 preset 的插件行
    const dump = spawnSync('dsh', ['--profile', 'web', '--dump-config'], {
      encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, shell: process.platform === 'win32',
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
  // AC1 的证明性 e2e 需要 dsh；缺席时响亮降级并计入汇总，绝不静默当 pass
  console.warn('  !! SKIP (loud) - e2e mount proof needs dsh on PATH; AC1 evidence absent on this machine')
}

console.log(`\n${process.exitCode ? 'FAILED' : `all ${passed} tests passed`}`)
if (process.exitCode) console.log(`tmp kept: ${tmp}`)
else await rm(tmp, { recursive: true, force: true })
