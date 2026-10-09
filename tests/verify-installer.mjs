/**
 * verify-installer.mjs — #21 preset 插件化安装的 installer 单测。
 *
 * 覆盖：install（fresh，版本戳 + 清单 + payload 完整）、重复 install 拒绝、
 * upgrade（原地替换）、uninstall、--version、--from tarball（npm pack 产物）。
 * installer 以 lib 形态导出（bin/install.mjs），CLI 行为另经 spawn 抽测。
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

const pkgVersion = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8')).version

/** Run the installer CLI with args against an isolated root. */
function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
}

const readStamp = async (root) => JSON.parse(await readFile(join(root, 'matt', 'VERSION.json'), 'utf8'))

await test('install: fresh install copies payload, stamps version + manifest', async () => {
  const root = join(tmp, 'r1')
  const r = run(['install', '--root', root])
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  // 版本戳
  const stamp = await readStamp(root)
  assert.equal(stamp.version, pkgVersion)
  // payload 完整：preset 声明、bundle 载体、插件、skills、lang-packs、sandcastle
  for (const f of ['preset.yml', 'agent.cordis.yml', 'cordis.patch.yml',
    'workflow-enforcer.mjs', 'lang-enforcer.mjs', 'handoff-tool.mjs',
    'skills/ponytail/SKILL.md', 'lang-packs', 'sandcastle']) {
    assert.ok(existsSync(join(root, 'matt', f)), `missing payload: ${f}`)
  }
  // 清单：记录来源与文件数
  const manifest = JSON.parse(await readFile(join(root, 'matt', 'manifest.json'), 'utf8'))
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 10)
  // 白名单排除项不进包（node_modules 例外：运行时依赖 yaml 由安装器补齐）
  for (const f of ['docs', 'tests', '.git', 'CONTEXT.md']) {
    assert.ok(!existsSync(join(root, 'matt', f)), `excluded leaked: ${f}`)
  }
  // 运行时依赖在安装副本旁可解析（插件 import 'yaml' 的锚点是插件文件自身）
  assert.ok(existsSync(join(root, 'matt', 'node_modules', 'yaml', 'package.json')), 'yaml dep not vendored')
})

await test('install: refuses to overwrite an existing install', async () => {
  const root = join(tmp, 'r2')
  assert.equal(run(['install', '--root', root]).status, 0)
  const r = run(['install', '--root', root])
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /already|已存在/i)
})

await test('install --force: overwrites in place', async () => {
  const root = join(tmp, 'r3')
  assert.equal(run(['install', '--root', root]).status, 0)
  assert.equal(run(['install', '--root', root, '--force']).status, 0)
})

await test('upgrade: in-place replace, stamp advances, stale files removed', async () => {
  const root = join(tmp, 'r4')
  assert.equal(run(['install', '--root', root]).status, 0)
  // 造一个上一版遗留文件，upgrade 后应被清掉（原地替换语义）
  await writeFile(join(root, 'matt', 'stale-old-plugin.mjs'), '// old')
  const r = run(['upgrade', '--root', root])
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  assert.ok(!existsSync(join(root, 'matt', 'stale-old-plugin.mjs')), 'stale file survived upgrade')
  const stamp = await readStamp(root)
  assert.equal(stamp.version, pkgVersion)
  // upgrade 记录被替换的旧版本（回滚线索）
  const manifest = JSON.parse(await readFile(join(root, 'matt', 'manifest.json'), 'utf8'))
  assert.equal(manifest.previousVersion, pkgVersion)
})

await test('upgrade: fails cleanly when nothing is installed', async () => {
  const root = join(tmp, 'r5')
  const r = run(['upgrade', '--root', root])
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /not installed|未安装/i)
})

await test('uninstall: removes the install directory', async () => {
  const root = join(tmp, 'r6')
  assert.equal(run(['install', '--root', root]).status, 0)
  assert.equal(run(['uninstall', '--root', root]).status, 0)
  assert.ok(!existsSync(join(root, 'matt')))
  // 再次 uninstall 幂等报错或提示不存在
  const r = run(['uninstall', '--root', root])
  assert.notEqual(r.status, 0)
})

await test('--version: prints package version', () => {
  const r = run(['--version'])
  assert.equal(r.status, 0)
  assert.ok(r.stdout.includes(pkgVersion), `stdout: ${r.stdout}`)
})

await test('--from <tarball>: installs from an npm pack artifact', async () => {
  // 在临时目录打一个最小包（不真跑整仓 npm pack，避免网络/生命周期钩子依赖），
  // 结构与发布产物一致：package.json + payload 文件。
  const src = join(tmp, 'fakepkg')
  await cp(REPO, src, {
    recursive: true,
    filter: (s) => !/[\\/](\.git|node_modules|\.scratch|docs|tests)([\\/]|$)/.test(s),
  })
  const packed = spawnSync('npm', ['pack', '--pack-destination', tmp], { cwd: src, encoding: 'utf8', shell: process.platform === 'win32' })
  assert.equal(packed.status, 0, `npm pack failed: ${packed.stderr}`)
  const [tgzName] = (await readdir(tmp)).filter((f) => f.endsWith('.tgz'))
  assert.ok(tgzName, 'npm pack produced no tarball')
  const root = join(tmp, 'r7')
  const r = run(['install', '--root', root, '--from', join(tmp, tgzName)])
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`)
  const stamp = await readStamp(root)
  assert.equal(stamp.version, pkgVersion)
  assert.ok(existsSync(join(root, 'matt', 'workflow-enforcer.mjs')))
  // tarball 安装的 manifest 记录来源形态
  const manifest = JSON.parse(await readFile(join(root, 'matt', 'manifest.json'), 'utf8'))
  assert.equal(manifest.source, 'tarball')
})

console.log(`\n${process.exitCode ? 'FAILED' : `all ${passed} tests passed`}`)
if (process.exitCode) console.log(`tmp kept: ${tmp}`)
else await rm(tmp, { recursive: true, force: true })
