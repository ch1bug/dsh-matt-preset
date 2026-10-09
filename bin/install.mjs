#!/usr/bin/env node
/**
 * install.mjs — dsh-matt-preset copy-installer (#21)。
 *
 * 把 preset 包（npm pack tarball 或源码/本地包目录）resolve 出 payload，
 * 整目录拷入配置 root（默认 $DSH_HOME/.agent-presets/matt/），并写版本戳。
 * DSH 的 preset 发现是纯文件系统 roots（显式配置），无 npm 安装机制——
 * 本安装器只负责把文件放到位；bundle 挂载属 profile 侧（ADR-0001 形态）。
 *
 * 用法：
 *   dsh-preset-install install  [--from <tarball|dir>] [--root <dir>] [--force]
 *   dsh-preset-install upgrade  [--from <tarball|dir>] [--root <dir>]
 *   dsh-preset-install uninstall [--root <dir>]
 *   dsh-preset-install --version
 *
 * 回滚 = 用旧版本重新 install（--force 覆盖）：旧 tag ↔ 旧 npm 版本一一对应
 * （release docs 见 docs/RELEASE.md）。
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url))
/** Payload 插件在运行时 import 的依赖（workflow-enforcer → yaml）：随安装副本走。 */
const RUNTIME_DEPS = ['yaml']

function die(msg) {
  console.error(`dsh-preset-install: ${msg}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--version') args.version = true
    else if (a === '--force') args.force = true
    else if (a === '--root') args.root = argv[++i]
    else if (a === '--from') args.from = argv[++i]
    else if (a.startsWith('--')) die(`unknown option: ${a}`)
    else args._.push(a)
  }
  return args
}

function defaultRoot() {
  if (process.env.DSH_MATT_ROOT) return process.env.DSH_MATT_ROOT
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, '.agent-presets')
}

/** Expand one package.json `files` entry (dirs recurse; `*.mjs` globs) against srcDir. */
async function expandEntry(srcDir, entry) {
  if (!entry.includes('*')) return [entry]
  const prefix = entry.slice(0, entry.indexOf('*'))
  const dir = join(srcDir, prefix)
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  const pattern = new RegExp('^' + entry.replaceAll('.', '\\.').replaceAll('*', '[^/]*') + '$')
  return names.filter((n) => pattern.test(n)).map((n) => prefix + n)
}

/**
 * Resolve the package payload: returns { pkgDir, pkg, source }.
 * --from tarball → extract with system tar; --from dir → use as-is;
 * default → this package's own checkout.
 */
async function resolveSource(from) {
  if (!from) return { pkgDir: PKG_DIR, source: 'source' }
  if (from.endsWith('.tgz') || from.endsWith('.tar.gz')) {
    const work = await mkdtemp(join(tmpdir(), 'dsh-preset-pkg-'))
    const r = spawnSync('tar', ['-xzf', resolve(from), '-C', work], { encoding: 'utf8', shell: process.platform === 'win32' })
    if (r.status !== 0) { await rm(work, { recursive: true, force: true }); die(`tar extract failed: ${r.stderr}`) }
    return { pkgDir: join(work, 'package'), source: 'tarball' }
  }
  const dir = resolve(from)
  if (!existsSync(join(dir, 'package.json'))) die(`--from is not a package directory (no package.json): ${dir}`)
  return { pkgDir: dir, source: 'dir' }
}

/** The whitelisted payload paths of a package dir, from its package.json `files`. */
async function payloadOf(pkgDir) {
  const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) die(`package.json has no files whitelist: ${pkgDir}`)
  const entries = (await Promise.all(pkg.files.map((e) => expandEntry(pkgDir, e)))).flat()
  const present = []
  for (const e of entries) if (existsSync(join(pkgDir, e))) present.push(e)
  return { pkg, entries: present }
}

async function installTo(target, { pkgDir, source }, { previousVersion } = {}) {
  const { pkg, entries } = await payloadOf(pkgDir)
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
  // 安装目录旁必须有 node_modules/yaml（旧 install.sh 的 npm install --prefix 等价物）。
  // 解析锚定**来源包自身**（回滚装旧 tag 时 vendor 旧包声明的依赖版本），
  // 来源目录无 node_modules 时（tarball 解压目录）才回退到安装器自身环境。
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
    JSON.stringify({ version: pkg.version, source, previousVersion: previousVersion ?? null, files: entries, dependencies: deps }, null, 2) + '\n')
  return { version: pkg.version, files: entries.length }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const pkg = JSON.parse(await readFile(join(PKG_DIR, 'package.json'), 'utf8'))
  const cmd = args._[0]

  if (args.version) { console.log(pkg.version); return }

  const root = resolve(args.root ?? defaultRoot())
  const target = join(root, 'matt')
  const previousVersionOf = async () => existsSync(join(target, 'VERSION.json'))
    ? JSON.parse(await readFile(join(target, 'VERSION.json'), 'utf8')).version
    : null

  if (cmd === 'uninstall') {
    if (!existsSync(target)) die(`not installed: ${target} (未安装)`)
    await rm(target, { recursive: true, force: true })
    console.log(`uninstalled: ${target}`)
    return
  }

  if (cmd === 'upgrade') {
    if (!existsSync(join(target, 'VERSION.json'))) die(`not installed: ${target} (未安装——请先用 install)`)
    const prev = await previousVersionOf()
    const src = await resolveSource(args.from)
    const res = await installTo(target, src, { previousVersion: prev })
    if (src.source === 'tarball') await rm(dirname(src.pkgDir), { recursive: true, force: true })
    console.log(`upgraded ${prev} -> ${res.version} (${res.files} entries) at ${target}`)
    console.log('重启 dsh（或新开会话）生效；回滚：重新 install 旧版本包。')
    return
  }

  if (cmd === 'install') {
    if (existsSync(target) && !args.force) {
      die(`already installed: ${target} (已存在——升级用 upgrade，覆盖用 --force)`)
    }
    const prev = await previousVersionOf()
    const src = await resolveSource(args.from)
    const res = await installTo(target, src, { previousVersion: prev })
    if (src.source === 'tarball') await rm(dirname(src.pkgDir), { recursive: true, force: true })
    console.log(`installed ${res.version} (${res.files} entries) at ${target}`)
    console.log('重启 dsh web（或新开会话），在 hero-chip 选择 "Matt 工作流模式"。')
    return
  }

  die(`usage: install | upgrade | uninstall | --version (got: ${cmd ?? '(none)'})`)
}

main().catch((e) => die(e?.stack ?? String(e)))
