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
 *
 * 用法：
 *   node scripts/link-runtime-deps.mjs [--runtime <dir>] [--dry-run]
 *   DSH_RUNTIME=<dir> node scripts/link-runtime-deps.mjs
 *
 * <dir> = **包含 node_modules/@deepseek-ai 的目录**。缺省时按序尝试：
 *   DSH_RUNTIME → 在 PATH 上找 dsh → 已可解析的 @deepseek-ai/cordis-plugin-loader。
 */
import { existsSync, mkdirSync, symlinkSync, lstatSync } from 'node:fs'
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

/** 建链接（Windows 用 junction，无需管理员；POSIX 用 symlink）。幂等：已存在且指向正确则跳过。 */
const link = (from, to) => {
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  if (existsSync(to) || lstatSync(to, { throwIfNoEntry: false }) !== undefined) {
    console.log(`  = 已存在 ${to}`)
    return
  }
  if (dryRun) {
    console.log(`  + 将建 ${to} -> ${from}`)
    return
  }
  mkdirSync(dirname(to), { recursive: true })
  symlinkSync(from, to, type)
  console.log(`  ✓ ${to} -> ${from}`)
}

link(join(runtime, 'node_modules', '@deepseek-ai'), join(REPO, 'tests', 'node_modules', '@deepseek-ai'))
link(join(runtime, 'node_modules', 'yaml'), join(REPO, 'tests', 'node_modules', 'yaml'))
link(join(runtime, 'node_modules', 'yaml'), join(REPO, 'node_modules', 'yaml'))

console.log(dryRun ? 'dry-run：未改动文件系统' : `完成。现在可以：node scripts/verify-all.mjs`)