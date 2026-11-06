/**
 * verify-0222rc1-roster.mjs — #176 AC2/AC3 证明件：四档 matt preset 在 0.2.2-rc.1
 * runtime 下各自可 `session/create`（`agent-preset/invalid` 零出现）。
 *
 * 背景（#176 票面）：0.2.2-alpha.1 起上游移除
 * `@deepseek-ai/dsh-tool-subagent-control` 的 `./list-agents` 子路径 exports，载体旧
 * 引用行 never started → 整个 preset `agent-preset/invalid` → 桌面端模式选择消失。
 * 离线门禁（roster-alignment / row-deps / bundle-sync）只证声明面；本用例证**运行时**
 * ——真起一次 0.2.2-rc.1 实例、走 RPC 建会话。故障读数（修复前）实录：
 * `session/create {agentPreset:'dsh-matt-preset'}` →
 * `{"ok":false,"code":"agent-preset/invalid","message":"tool-subagent-list-agents … never started"}`。
 *
 * 门禁（与 verify-clean-env-e2e 同规，防线缺席必须响亮 / D47）：
 * - 未设 `DSH_MATT_LIVE_CLI`（0.2.2-rc.1 源码检出 CLI 入口 `<src>/apps/cli/lib/bin.js`）
 *   → **SKIP (loud)**，整条运行时链在本机不构成证据；
 * - `DSH_PNPM`（字面 `pnpm` 转发源，挂载半边 plugin-manager spawn 它）缺席 → SKIP (loud)；
 * - **版本钉**：CLI `--version` 必须恰为 `0.2.2-rc.1`，否则 **FAIL 硬红**不静默——
 *   跑在旧 rc.2 上会因 exports 还在而假绿（正是 #176 的故障盲区），证据无效。
 *
 * 挂载形态：临时 home → shipped web 模板 bootstrap → `dsh plugin --profile <p> add <仓>`
 * （与 verify-live-tool-call 同法；不走 bin/install.mjs——本用例不证 installer 面）。
 * 探针卫生：`--port 0` + `os.tmpdir()` 临时 home + 收尾走挂具 cleanup（#81 stdio 修法）。
 *
 * 证据目录约定：读数全文由 verify-all 汇总采集；票证证据手工归档 `.scratch/verify176/`。
 */
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTempHome, cleanup, rpc, runCli } from './live-harness.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE = 'matt-roster'
const PRESET_IDS = ['dsh-matt-preset', 'dsh-matt-preset-ptc', 'dsh-matt-preset-minimal', 'dsh-matt-preset-cordis']
const PINNED_VERSION = '0.2.2-rc.1'
const BOOT_DEADLINE_MS = 120_000

const results = []
const ok = (name, detail = '') => results.push(`  ✓ ${name}${detail ? ' — ' + detail : ''}`)
const bad = (name, detail = '') => results.push(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)

/** 环境侧断言缺席的统一出口：`SKIP (loud)` 是 scripts/verify-all.mjs 识别 PASS* 的约定串。 */
const skipLoud = (what) => {
  console.log(`\n=== 0.2.2-RC.1 ROSTER (four presets create via live RPC) ===`)
  console.warn(`  !! SKIP (loud) - ${what} — evidence absent on this machine`)
  console.log(results.join('\n'))
  process.exit(0)
}

const CLI = process.env.DSH_MATT_LIVE_CLI
if (!CLI || !existsSync(CLI)) {
  skipLoud('0.2.2-rc.1 roster probe needs DSH_MATT_LIVE_CLI (0.2.2-rc.1 source checkout CLI entry, e.g. <src>/apps/cli/lib/bin.js) — the runtime create chain is unverified')
}
const SRC_ROOT = resolve(CLI, '../../..')

// ── V1 版本钉：恰好 0.2.2-rc.1 才构成 #176 的证明面 ──────────────────────────
const versionRun = spawnSync(process.execPath, ['--import', 'tsx/esm', CLI, '--version'], { cwd: SRC_ROOT, encoding: 'utf8' })
const liveVersion = versionRun.status === 0 ? versionRun.stdout.trim() : `(exit ${versionRun.status})`
if (liveVersion !== PINNED_VERSION) {
  console.log('\n=== 0.2.2-RC.1 ROSTER (four presets create via live RPC) ===')
  bad(`V1. version pin: DSH_MATT_LIVE_CLI is exactly ${PINNED_VERSION}`, `got ${liveVersion} — 跑在其它版本上不构成 #176 证据（旧 rc.2 会因 exports 还在而假绿）`)
  console.log(results.join('\n'))
  process.exitCode = 1
  process.exit(1)
}
ok('V1. version pin', `DSH_MATT_LIVE_CLI --version = ${liveVersion}`)

// 挂载半边需要字面 pnpm（plugin-manager spawn 它）；给 DSH_PNPM 就地造转发 shim 目录。
const pnpmSource = process.env.DSH_PNPM
if (!pnpmSource || !existsSync(pnpmSource)) {
  skipLoud('0.2.2-rc.1 roster probe needs DSH_PNPM (pnpm.cjs 原件路径) — the plugin add (mount) step is unverified')
}
const pnpmShimDir = await mkdtemp(join(tmpdir(), 'dsh-matt-roster-shim-'))
mkdirSync(pnpmShimDir, { recursive: true })
// 生成的 shim 一律走 process.execPath（#124：裸 `node` 在登录 shell 的 cmd.exe 侧起不来，
// tests/verify-test-exec.mjs 的归属守卫也按此钉）。
writeFileSync(join(pnpmShimDir, 'pnpm.cmd'), `@echo off\r\n"${process.execPath}" "${pnpmSource}" %*\r\n`)
writeFileSync(join(pnpmShimDir, 'pnpm'), `#!/bin/sh\nexec "${process.execPath}" "${pnpmSource}" "$@"\n`)
chmodSync(join(pnpmShimDir, 'pnpm'), 0o755)
const mountEnv = { PATH: `${pnpmShimDir};${process.env.PATH ?? ''}` }

const home = await mkdtemp(join(tmpdir(), 'dsh-matt-roster-'))
assertTempHome(home)
const runCliHere = (args, env = {}) => runCli(CLI, args, { cwd: SRC_ROOT, home, env })

let child
let launchUrl
try {
  // ── A1 web bootstrap：shipped web 模板整体替换建 profile（含 dsh-web-app 面）──
  const boot = await runCliHere(['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'])
  if (boot.code !== 0) {
    bad('A1. bootstrap web template profile', boot.out.slice(-300))
    throw new Error('bootstrap failed')
  }
  const profilePkg = JSON.parse(await readFile(join(home, 'profiles', PROFILE, 'package.json'), 'utf8'))
  if (!profilePkg?.dsh?.profile?.bundles?.includes('@deepseek-ai/dsh-web-app')) {
    bad('A1. bootstrap web template profile', `bundles 缺 dsh-web-app: ${JSON.stringify(profilePkg?.dsh?.profile?.bundles)?.slice(0, 200)}`)
    throw new Error('bootstrap incomplete')
  }
  ok('A1. bootstrap web template profile', `${profilePkg.dsh.profile.bundles.length} bundles incl. web-app`)

  // ── A2 挂载：plugin add 本仓（字面 pnpm 在 shim PATH 上）──────────────────
  const mount = await runCliHere(['plugin', '--profile', PROFILE, 'add', REPO], mountEnv)
  if (mount.code !== 0 || /dsh not found on PATH|missing pnpm/u.test(mount.out)) {
    bad('A2. mount: dsh plugin add <repo>', mount.out.slice(-300))
    throw new Error('mount failed')
  }
  ok('A2. mount: dsh plugin add <repo>', 'exit 0，无 dsh/pnpm 缺件降级')

  // ── B1 起实例：--port 0，等 `dsh web:` 行（≤BOOT_DEADLINE_MS）─────────────
  child = spawn(process.execPath, ['--import', 'tsx/esm', CLI, '--profile', PROFILE, '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    cwd: SRC_ROOT,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  })
  let instErr = ''
  child.stderr.on('data', (c) => { instErr += c })
  child.stdout.on('data', (c) => { instErr += c })
  launchUrl = await new Promise((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => rejectUrl(new Error(`instance not ready in ${BOOT_DEADLINE_MS / 1000}s — no 'dsh web:' line`)), BOOT_DEADLINE_MS)
    child.stdout.on('data', (c) => {
      const m = /dsh web: (http:\/\/\S+)/u.exec(c.toString())
      if (m) { clearTimeout(timer); resolveUrl(m[1]) }
    })
    child.on('exit', (code) => { clearTimeout(timer); rejectUrl(new Error(`instance exited ${code}: ${instErr.slice(-400)}`)) })
  })
  ok('B1. start: live 0.2.2-rc.1 instance up (--port 0)', launchUrl.replace(/token=[^&]+/u, 'token=<redacted>'))

  // preset 级激活告警按名点检（mcp 凭据 ENOENT 是临时 home 的已知噪声，不在此列）。
  const presetFailure = instErr.match(/.*(dsh-matt|preset-dsh-matt).*(did not activate|never started|pending \(waiting)/u)
  if (presetFailure) bad('B1b. matt preset rows activated (by name)', presetFailure[0].slice(0, 200))
  else ok('B1b. matt preset rows: no by-name activation failure in boot output')

  // ── B2 鉴权：printed token → cookie（RPC 用干净 origin——token 只换一次 cookie，
  //    带 ?token= 的 URL 拼 /api/ 路径会打到静态兜底座上吃 405，cheatsheet 同款坑）──
  const exchange = await fetch(launchUrl, { redirect: 'manual' })
  const cookie = (exchange.headers.get('set-cookie') ?? '').split(';', 1)[0]
  if (!cookie) { bad('B2. auth: token→cookie exchange', `status ${exchange.status}`); throw new Error('no cookie') }
  const origin = new URL(launchUrl).origin
  ok('B2. auth: token→cookie exchange', `status ${exchange.status}`)

  // ── C1–C4 四档 preset 各建一次会话（#176 的核心证明面）──────────────────
  for (const id of PRESET_IDS) {
    try {
      const value = await rpc(origin, cookie, 'session/create', { agentPreset: id }, 'roster')
      if (value?.agentPreset === id) ok(`C. session/create ${id}`, 'ok:true，preset 回读一致')
      else bad(`C. session/create ${id}`, `ok 但 agentPreset=${JSON.stringify(value?.agentPreset)}`)
    } catch (error) {
      bad(`C. session/create ${id}`, String(error?.message ?? error).slice(0, 300))
    }
  }

  // ── C5 负例对照：不存在的 preset 必须报错（探针能红，读数才有效）──────────
  try {
    await rpc(origin, cookie, 'session/create', { agentPreset: 'no-such-preset-0222rc1-roster' }, 'roster')
    bad('C5. negative control: unknown preset rejected', 'create 反而成功——探针失去判红能力')
  } catch (error) {
    ok('C5. negative control: unknown preset rejected', String(error?.message ?? error).slice(0, 120))
  }
} catch (error) {
  bad('probe aborted', String(error?.message ?? error).slice(0, 300))
} finally {
  await cleanup({ child, home })
  await rm(pnpmShimDir, { recursive: true, force: true }).catch(() => {})
}

console.log('\n=== 0.2.2-RC.1 ROSTER (four presets create via live RPC) ===')
console.log(results.join('\n'))
process.exitCode = results.some((r) => r.startsWith('  ✗')) ? 1 : 0
