#!/usr/bin/env node
/**
 * install.mjs — dsh-matt-preset installer（#21 copy-installer + #28 bundle 装载）。
 *
 * 两段式：
 *   1) 稳定存储：payload 整目录拷入 $DSH_HOME/.agent-presets/matt/，写版本戳
 *      （VERSION.json / manifest.json），运行时依赖 yaml 随副本走——回滚 = 用
 *      旧版本重新 install（--force 覆盖），旧 tag ↔ 旧 npm 版本一一对应
 *      （docs/RELEASE.md）。
 *   2) 装载挂载：rc.2 的 preset 注册表不做目录扫描（#28 根因），装载机制是
 *      bundle patch——把存储目录经 `dsh plugin --profile <p> add` 链入 profile，
 *      package.json 的 dsh.bundle.patch（→ cordis.patch.yml，由
 *      #6 载体生成/锁定）随之生效。
 *
 * 用法：
 *   dsh-preset-install install  [--profile <name>] [--from <tarball|dir>] [--force]
 *   dsh-preset-install upgrade  [--profile <name>] [--from <tarball|dir>]
 *   dsh-preset-install uninstall [--profile <name>]
 *   dsh-preset-install --version
 *
 * #21 的 --root（存储根覆盖）仍受支持，用于测试/非默认布局；profile 挂载
 * 一律走 DSH_HOME/profiles/<name>。
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { payloadOf } from '../lib/payload.mjs'

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url))
const PKG_NAME = 'dsh-matt-preset'
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
    else if (a === '--profile') args.profile = argv[++i]
    else if (a.startsWith('--')) die(`unknown option: ${a}`)
    else args._.push(a)
  }
  return args
}

function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function defaultStoreRoot() {
  if (process.env.DSH_MATT_ROOT) return process.env.DSH_MATT_ROOT
  return join(dshHome(), '.agent-presets')
}

/** Run dsh (or node) and die with its stderr on failure. */
function runOrDie(cmd, cmdArgs, what) {
  const r = spawnSync(cmd, cmdArgs, {
    encoding: 'utf8',
    shell: process.platform === 'win32' && cmd !== process.execPath,
  })
  if (r.status !== 0) die(`${what} failed (exit ${r.status}):\n${r.stderr || r.stdout}`)
  return r
}

/** Is the dsh CLI available? (装载挂载需要它；纯存储操作不需要。) */
function dshAvailable() {
  return spawnSync('dsh', ['--version'], {
    encoding: 'utf8', shell: process.platform === 'win32',
  }).status === 0
}

/** Link the store into the profile: the bundle-patch mount step (#28).
 *  `dsh plugin --profile <p> add` creates the profile layer when absent
 *  (shipped names like `web` included), so no template bootstrap is needed. */
function mount(profile, store) {
  runOrDie('dsh', ['plugin', '--profile', profile, 'add', store],
    `dsh plugin --profile ${profile} add`)
}

/** Remove the profile link. Pre-checks the profile's dependency table so a
 *  fresh profile without the link doesn't turn `dsh plugin rm` into an error;
 *  if the profile layout ever shifts, we warn and let `dsh plugin rm` decide. */
function unmount(profile) {
  let deps = {}
  try {
    deps = JSON.parse(readFileSync(join(dshHome(), 'profiles', profile, 'package.json'), 'utf8')).dependencies ?? {}
  } catch { /* profile layer absent/unreadable — nothing linked, fall through */ }
  if (!(PKG_NAME in deps)) return
  runOrDie('dsh', ['plugin', '--profile', profile, 'rm', PKG_NAME],
    `dsh plugin --profile ${profile} rm`)
}

/** Run the mount/unmount step, or degrade loudly when dsh is unavailable:
 *  the store copy still lands, but the profile keeps its previous state
 *  (stale link on uninstall) and the operator gets the manual command. */
function mountOrWarn(profile, step, what) {
  if (dshAvailable()) { step(); return }
  const manual = what === 'unmount'
    ? `dsh plugin --profile ${profile} rm ${PKG_NAME}`
    : `dsh plugin --profile ${profile} add ${join(defaultStoreRoot(), 'matt')}`
  console.error(`dsh not found on PATH — skipped profile ${what} (装载需手动: ${manual})`)
}

/**
 * 解 tgz（Node 原生：gunzip + 最小 ustar/pax 读取）。
 *
 * 为什么不用系统 tar（#64 实测）：解包必须跨 tar 方言成立，而两条路都不通——
 *   - `shell:true` + 绝对路径：**GNU tar**（msys/Linux）把 `C:\…` 的冒号当远程主机
 *     （`无法连接至 C:`）；
 *   - 改成 `shell:false` + `-C <work>`：GNU tar 仍吃不下 msys 路径转换后的
 *     `C:\msys64\tmp\…`（`无法 open: No such file or directory`）。
 * 所以不赌宿主方言：npm pack 产出的是 gzip 包着的 ustar（长路径走 pax/GNU 扩展），
 * 这里自己读，任何平台行为一致。
 */
async function extractTarball(tarball, dest) {
  const buf = gunzipSync(await readFile(tarball))
  /** tar 头字段：NUL 结尾、按八进制/字符串读取。 */
  const field = (header, start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0[\s\S]*$/u, '').trim()
  let offset = 0
  let pendingName
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const size = Number.parseInt(field(header, 124, 12) || '0', 8)
    const type = String.fromCharCode(header[156]) || '0'
    const prefix = field(header, 345, 155)
    const rawName = field(header, 0, 100)
    const dataStart = offset + 512
    const dataEnd = dataStart + size

    if (type === 'x' || type === 'g') {
      // pax 扩展头：记录形如 "<len> path=<value>\n"，长路径从这里来
      const body = buf.subarray(dataStart, dataEnd).toString('utf8')
      const hit = /(?:^|\n)\d+ path=([^\n]+)/u.exec(body)
      if (hit) pendingName = hit[1]
    } else if (type === 'L') {
      // GNU 长名头
      pendingName = buf.subarray(dataStart, dataEnd).toString('utf8').replace(/\0[\s\S]*$/u, '')
    } else {
      const full = (pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName)).replace(/^\.\//u, '')
      pendingName = undefined
      if (full !== '' && !full.split('/').includes('..')) {
        const target = join(dest, full)
        if (type === '5') await mkdir(target, { recursive: true })
        else if (type === '0' || type === '\0') {
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, buf.subarray(dataStart, dataEnd))
        }
      }
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return join(dest, 'package')
}

/**
 * Resolve the package payload: returns { pkgDir, pkg, source }.
 * --from tarball → extract with the in-process extractor (no host tar dialect);
 * --from dir → use as-is; default → this package's own checkout.
 */
async function resolveSource(from) {
  if (!from) return { pkgDir: PKG_DIR, source: 'source' }
  if (from.endsWith('.tgz') || from.endsWith('.tar.gz')) {
    const work = await mkdtemp(join(tmpdir(), 'dsh-preset-pkg-'))
    try {
      const pkgDir = await extractTarball(resolve(from), work)
      if (!existsSync(pkgDir)) throw new Error(`tarball has no package/ entry: ${from}`)
      return { pkgDir, source: 'tarball' }
    } catch (error) {
      await rm(work, { recursive: true, force: true })
      die(`tarball extract failed: ${String(error?.message ?? error)}`)
    }
  }
  const dir = resolve(from)
  if (!existsSync(join(dir, 'package.json'))) die(`--from is not a package directory (no package.json): ${dir}`)
  return { pkgDir: dir, source: 'dir' }
}

/** 白名单展开逻辑住在 lib/payload.mjs（安装器与离线守卫共用一份语义）。 */
async function payloadOfOrDie(pkgDir) {
  try {
    return await payloadOf(pkgDir)
  } catch (error) {
    die(String(error?.message ?? error))
  }
}

async function installTo(target, { pkgDir, source }, { previousVersion, profile } = {}) {
  const { pkg, entries } = await payloadOfOrDie(pkgDir)
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
  // 安装目录旁必须有 node_modules/yaml。解析锚定**来源包自身**（回滚装旧 tag
  // 时 vendor 旧包声明的依赖版本），来源目录无 node_modules 时（tarball 解压
  // 目录）才回退到安装器自身环境。
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
    JSON.stringify({ version: pkg.version, source, previousVersion: previousVersion ?? null, profile: profile ?? null, files: entries, dependencies: deps }, null, 2) + '\n')
  return { version: pkg.version, files: entries.length }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const pkg = JSON.parse(await readFile(join(PKG_DIR, 'package.json'), 'utf8'))
  const cmd = args._[0]

  if (args.version) { console.log(pkg.version); return }

  const profile = args.profile ?? 'web'
  // 显式 --root = 纯存储模式（测试/非默认布局）：只落 store，不碰任何 profile
  const storeOnly = args.root !== undefined
  const storeRoot = resolve(args.root ?? defaultStoreRoot())
  const target = join(storeRoot, 'matt')
  const previousVersionOf = async () => existsSync(join(target, 'VERSION.json'))
    ? JSON.parse(await readFile(join(target, 'VERSION.json'), 'utf8')).version
    : null

  if (cmd === 'uninstall') {
    if (!existsSync(target)) die(`not installed: ${target} (未安装)`)
    if (!storeOnly) mountOrWarn(profile, () => unmount(profile), 'unmount')
    await rm(target, { recursive: true, force: true })
    console.log(`uninstalled: ${target} (profile '${profile}' unmounted)`)
    return
  }

  if (cmd === 'upgrade') {
    if (!existsSync(join(target, 'VERSION.json'))) die(`not installed: ${target} (未安装——请先用 install)`)
    const prev = await previousVersionOf()
    const src = await resolveSource(args.from)
    const res = await installTo(target, src, { previousVersion: prev, profile })
    if (src.source === 'tarball') await rm(dirname(src.pkgDir), { recursive: true, force: true })
    // link 指向的是存储目录本身，文件已原地替换；重挂一次刷新 pnpm 元数据
    if (!storeOnly) mountOrWarn(profile, () => mount(profile, target), 'mount')
    console.log(`upgraded ${prev} -> ${res.version} (${res.files} entries) at ${target}`)
    console.log(`重启 dsh --profile ${profile}（或新开会话）生效；回滚：重新 install 旧版本包。`)
    return
  }

  if (cmd === 'install') {
    if (existsSync(target) && !args.force) {
      die(`already installed: ${target} (已存在——升级用 upgrade，覆盖用 --force)`)
    }
    const prev = await previousVersionOf()
    const src = await resolveSource(args.from)
    const res = await installTo(target, src, { previousVersion: prev, profile })
    if (src.source === 'tarball') await rm(dirname(src.pkgDir), { recursive: true, force: true })
    if (!storeOnly) mountOrWarn(profile, () => mount(profile, target), 'mount')
    console.log(`installed ${res.version} (${res.files} entries) at ${target}${storeOnly ? '' : `, mounted into profile '${profile}'`}`)
    console.log(`重启 dsh --profile ${profile}（或新开会话），在 hero-chip 选择 "Matt 工作流"。`)
    return
  }

  die(`usage: install | upgrade | uninstall | --version (got: ${cmd ?? '(none)'})`)
}

// 只有**直接执行**才跑 CLI：被 import（测试 / 复用 lib）时不得产生安装副作用。
// 白名单展开逻辑在 lib/payload.mjs，离线守卫 tests/verify-payload-manifest.mjs 用它。
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main().catch((e) => die(e?.stack ?? String(e)))
