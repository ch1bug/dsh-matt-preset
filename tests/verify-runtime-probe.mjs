/**
 * verify-runtime-probe.mjs — `lib/runtime-probe.mjs` 的纯逻辑用例（#47 方向 C + #86）。
 *
 * 覆盖（每条 AC 都落到一个可跑的判据上）：
 *   R1 探测顺序：explicit → env → PATH → 桌面惯例 → 源码检出惯例（**顺序本身是契约**）
 *   R2 显式优先：`--dsh`/`--pnpm` 命中时**不得**被 PATH/env 抢走；显式路径不存在 → 响亮未命中
 *   R3 注入面：`pathEntries` / `exists` / `env` / `platform` 全可注入，用例不动真实 PATH/磁盘
 *   R4 桌面惯例：`DSH_DESKTOP_ROOT` 下 `resources/runtime/cli/bin/dsh.cmd` 与
 *      `…/primary-runtime/dependencies/pnpm/bin/pnpm.cjs` 两形
 *   R5 源码检出惯例：`DSH_MATT_DSH_SRC` → `apps/cli/lib/bin.js`，且 `dshRunner` 说明它经 `node` 跑
 *   R6 pnpm 两形态注入：可执行 → 所在目录（`shim:false`）；`*.cjs` → mkdtemp shim 目录 + 转发内容
 *   R7 未命中 `detail` 逐条说明每个来源为何落空；`missingToolHint` 非空且**可执行**（含真变量名/命令）
 *   R8 **扰动会红**：把探测顺序改坏（env 抢 explicit）→ R2 必须红（见文件头「非空洞取证」）
 *   R9 CLI 面：解析到的 dsh 若在**含空格**的路径下（桌面端 `…\DeepSeek Harness\…` 形态），
 *      经 `shell:true` 必须仍起得来 —— 不修时 cmd.exe 从空格处截断（2026-10-18 实测缺陷）
 *   R10 CLI 面：挂载被响亮跳过时，install/upgrade/uninstall 的收尾文案**不得谎报成功**
 *      （D47）—— 对照组证明真挂载时照旧写 `mounted into profile`
 *   R11 两种未命中分开（Lead 2026-10-18 拍板）：**显式给错** → die 且点明显式路径；
 *      **环境缺席** → 保持 missing 一行指路。R11e 是对照（防 R11 把环境缺席误伤成 die）
 *   R12 `DSH_DESKTOP_ROOT` 的两种读法都吃：应用根（契约冻结）与 `<app>/resources`（口语常见）
 *      收敛到同一条路径；R12d/R12e 保证不越档、也不假命中
 *
 * 非空洞取证（实测记录，2026-10-18）：把 `probeTool` 的 explicit 分支挪到 env 之后
 * （即显式不再优先）→ R2a/R2b **真红**；把 `pnpmPathInjection` 的脚本形态改成「直接返回
 * 所在目录」→ R6b/R6c **真红**。还原后逐字节一致、全绿。R1 的顺序断言不是措辞检查：
 * 它比较**实际命中的 source**，不是读头注。
 *
 * 为什么全是纯函数用例而不断言 CLI：安装器那半边的 CLI 行为（`dsh plugin add` 真走解析到的
 * dsh、pnpm 目录真被前置进子进程 PATH）归 `tests/verify-installer.mjs`（teammate `assertions`）；
 * 本文件守的是「探测本身对不对」，两边合起来才是 #86 AC② 的完整面。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pnpmPathInjection, probeDsh, probePnpm, missingToolHint, probeFailureHint, dshRunner, isScriptForm } from '../lib/runtime-probe.mjs'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(REPO, 'bin', 'install.mjs')

let passed = 0
let skips = 0
/** 环境侧断言缺席的统一出口（`SKIP (loud)` 是 scripts/verify-all.mjs 识别 PASS* 的约定串）。 */
function loudSkip(what) {
  skips++
  console.warn(`  !! SKIP (loud) - ${what} — evidence absent on this machine`)
}
const test = (name, fn) => {
  try {
    fn()
    passed++
    console.log(`  ok - ${name}`)
  } catch (e) {
    console.error(`  FAIL - ${name}\n${e?.stack ?? e}`)
    process.exitCode = 1
  }
}

/** 假文件系统：`exists` 只认集合里的路径（用例不碰真实磁盘）。 */
const mkExists = (paths) => {
  const set = new Set(paths.map((p) => join(p)))
  return (p) => set.has(join(p))
}
const WIN = 'win32'
const NIX = 'linux'

// ── R1 探测顺序 ──────────────────────────────────────────────────────────────
test('R1a. explicit 优先于 env/PATH/桌面/检出（同时在场时取 explicit）', () => {
  const r = probeDsh({
    explicit: join('X:', 'explicit', 'dsh.cmd'),
    env: { DSH_MATT_DSH: join('X:', 'env', 'dsh.cmd'), DSH_DESKTOP_ROOT: 'X:\\desktop', DSH_MATT_DSH_SRC: 'X:\\src' },
    platform: WIN,
    pathEntries: ['X:\\onpath'],
    exists: mkExists([
      join('X:', 'explicit', 'dsh.cmd'), join('X:', 'env', 'dsh.cmd'), join('X:\\onpath', 'dsh.cmd'),
      join('X:\\desktop', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      join('X:\\src', 'apps', 'cli', 'lib', 'bin.js'),
    ]),
  })
  assert.equal(r.found, true)
  assert.equal(r.source, 'explicit')
})

test('R1b. 无 explicit 时 env 优先于 PATH/桌面/检出', () => {
  const r = probeDsh({
    env: { DSH_MATT_DSH: join('X:', 'env', 'dsh.cmd'), DSH_DESKTOP_ROOT: 'X:\\desktop', DSH_MATT_DSH_SRC: 'X:\\src' },
    platform: WIN,
    pathEntries: ['X:\\onpath'],
    exists: mkExists([
      join('X:', 'env', 'dsh.cmd'), join('X:\\onpath', 'dsh.cmd'),
      join('X:\\desktop', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      join('X:\\src', 'apps', 'cli', 'lib', 'bin.js'),
    ]),
  })
  assert.equal(r.source, 'env')
})

test('R1c. env 落空时 PATH 优先于桌面惯例', () => {
  const r = probeDsh({
    env: { DSH_DESKTOP_ROOT: 'X:\\desktop', DSH_MATT_DSH_SRC: 'X:\\src' },
    platform: WIN,
    pathEntries: ['X:\\onpath'],
    exists: mkExists([
      join('X:\\onpath', 'dsh.cmd'),
      join('X:\\desktop', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      join('X:\\src', 'apps', 'cli', 'lib', 'bin.js'),
    ]),
  })
  assert.equal(r.source, 'path')
})

test('R1d. PATH 落空时桌面惯例优先于源码检出', () => {
  const r = probeDsh({
    env: { DSH_DESKTOP_ROOT: 'X:\\desktop', DSH_MATT_DSH_SRC: 'X:\\src' },
    platform: WIN,
    pathEntries: ['X:\\empty'],
    exists: mkExists([
      join('X:\\desktop', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      join('X:\\src', 'apps', 'cli', 'lib', 'bin.js'),
    ]),
  })
  assert.equal(r.source, 'desktop')
})

test('R1e. 只有源码检出在场时取检出（顺序末位）', () => {
  const r = probeDsh({
    env: { DSH_MATT_DSH_SRC: 'X:\\src' },
    platform: WIN,
    pathEntries: ['X:\\empty'],
    exists: mkExists([join('X:\\src', 'apps', 'cli', 'lib', 'bin.js')]),
  })
  assert.equal(r.source, 'checkout')
  assert.equal(r.path, join('X:\\src', 'apps', 'cli', 'lib', 'bin.js'))
})

test('R1f. pnpm 与 dsh 同构：explicit → env → PATH 三段顺序一致', () => {
  const order = probePnpm({
    env: { DSH_PNPM: join('X:', 'env', 'pnpm.cmd') },
    platform: WIN,
    pathEntries: ['X:\\onpath'],
    exists: mkExists([join('X:', 'env', 'pnpm.cmd'), join('X:\\onpath', 'pnpm.cmd')]),
  })
  assert.equal(order.source, 'env')
  const viaPath = probePnpm({
    env: {},
    platform: WIN,
    pathEntries: ['X:\\onpath'],
    exists: mkExists([join('X:\\onpath', 'pnpm.cmd')]),
  })
  assert.equal(viaPath.source, 'path')
})

// ── R2 显式优先 + 显式落空的响亮 ────────────────────────────────────────────
test('R2a. explicit 命中即取 explicit（不被 PATH 上的另一个抢走）', () => {
  const r = probeDsh({
    explicit: join('X:', 'chosen', 'dsh.cmd'),
    env: {},
    platform: WIN,
    pathEntries: ['X:\\onpath'],
    exists: mkExists([join('X:', 'chosen', 'dsh.cmd'), join('X:\\onpath', 'dsh.cmd')]),
  })
  assert.equal(r.source, 'explicit')
  assert.equal(r.path, join('X:', 'chosen', 'dsh.cmd'))
})

test('R2b. explicit 指向不存在的路径 → 未命中（不静默回落 PATH）', () => {
  const r = probeDsh({
    explicit: join('X:', 'nope', 'dsh.cmd'),
    env: {},
    platform: WIN,
    pathEntries: ['X:\\onpath'],
    exists: mkExists([join('X:\\onpath', 'dsh.cmd')]),
  })
  assert.equal(r.found, false, 'explicit 落空必须响亮未命中，不得回落到 PATH 上的另一个 dsh')
  assert.equal(r.path, null)
  assert.ok(r.detail.some((d) => d.includes('显式')), `detail 应指出显式路径不存在: ${r.detail.join(' | ')}`)
})

test('R2c. pnpm 的 explicit 同样优先且落空即未命中', () => {
  const ok = probePnpm({
    explicit: join('X:', 'chosen', 'pnpm.cjs'),
    env: { DSH_PNPM: join('X:', 'env', 'pnpm.cmd') },
    platform: WIN,
    pathEntries: [],
    exists: mkExists([join('X:', 'chosen', 'pnpm.cjs'), join('X:', 'env', 'pnpm.cmd')]),
  })
  assert.equal(ok.source, 'explicit')
  const miss = probePnpm({
    explicit: join('X:', 'nope', 'pnpm.cjs'),
    env: { DSH_PNPM: join('X:', 'env', 'pnpm.cmd') },
    platform: WIN,
    pathEntries: [],
    exists: mkExists([join('X:', 'env', 'pnpm.cmd')]),
  })
  assert.equal(miss.found, false)
})

// ── R3 注入面 ────────────────────────────────────────────────────────────────
test('R3a. platform 决定候选名：Win 认 dsh.cmd，POSIX 不认', () => {
  const exists = mkExists([join('X:\\onpath', 'dsh.cmd')])
  assert.equal(probeDsh({ env: {}, platform: WIN, pathEntries: ['X:\\onpath'], exists }).found, true)
  assert.equal(probeDsh({ env: {}, platform: NIX, pathEntries: ['X:\\onpath'], exists }).found, false)
})

test('R3b. pathEntries 注入生效（注入一个真实不存在的目录也能命中）', () => {
  const r = probeDsh({
    env: {},
    platform: WIN,
    pathEntries: ['X:\\injected-only'],
    exists: mkExists([join('X:\\injected-only', 'dsh.cmd')]),
  })
  assert.equal(r.found, true)
  assert.equal(r.source, 'path')
})

test('R3c. env 全空时三个惯例来源都如实记为未设置', () => {
  const r = probeDsh({ env: {}, platform: NIX, pathEntries: [], exists: () => false })
  assert.equal(r.found, false)
  const joined = r.detail.join(' | ')
  assert.ok(joined.includes('DSH_MATT_DSH 未设置'), joined)
  assert.ok(joined.includes('DSH_DESKTOP_ROOT 未设置'), joined)
  assert.ok(joined.includes('DSH_MATT_DSH_SRC 未设置'), joined)
})

test('R3d. env 键存在但路径不存在 → detail 指明该来源为何落空', () => {
  const r = probeDsh({
    env: { DSH_MATT_DSH: 'X:\\ghost\\dsh.cmd', DSH_DESKTOP_ROOT: 'X:\\ghost-desktop', DSH_MATT_DSH_SRC: 'X:\\ghost-src' },
    platform: WIN,
    pathEntries: ['X:\\empty'],
    exists: () => false,
  })
  const joined = r.detail.join(' | ')
  assert.ok(/DSH_MATT_DSH 指向的路径不存在/.test(joined), joined)
  assert.ok(/DSH_DESKTOP_ROOT.*没有桌面运行时惯例路径/.test(joined), joined)
  assert.ok(/DSH_MATT_DSH_SRC.*没有源码检出惯例路径/.test(joined), joined)
  assert.ok(/PATH 的 1 个目录里没有/.test(joined), joined)
})

// ── R13 pnpm 的环境变量别名（合并 226aabe 时保留的兼容）──────────────────────
// 契约名是 `DSH_PNPM`（#86 建议的写法）；同票另一份实现用了 `DSH_MATT_PNPM`（与
// `DSH_MATT_DSH` 同前缀）。两个都认，且 `DSH_PNPM` 优先——合并后不许只认其中一个。
test('R13a. DSH_MATT_PNPM 作为别名可命中；两个都设时 DSH_PNPM 优先', () => {
  const aliasOnly = probePnpm({
    env: { DSH_MATT_PNPM: 'X:\\env\\pnpm.cmd' },
    platform: WIN,
    pathEntries: [],
    exists: mkExists(['X:\\env\\pnpm.cmd']),
  })
  assert.equal(aliasOnly.found, true, aliasOnly.detail.join(' | '))
  assert.equal(aliasOnly.source, 'env')
  assert.equal(aliasOnly.path, 'X:\\env\\pnpm.cmd')

  const both = probePnpm({
    env: { DSH_PNPM: 'X:\\a\\pnpm.cmd', DSH_MATT_PNPM: 'X:\\b\\pnpm.cmd' },
    platform: WIN,
    pathEntries: [],
    exists: mkExists(['X:\\a\\pnpm.cmd', 'X:\\b\\pnpm.cmd']),
  })
  assert.equal(both.path, 'X:\\a\\pnpm.cmd', 'DSH_PNPM 必须优先于别名')
})

test('R13b. 两个名字都没设时，detail 如实说「未设置」（不静默）', () => {
  const r = probePnpm({ env: {}, platform: WIN, pathEntries: [], exists: () => false })
  assert.equal(r.found, false)
  assert.ok(/DSH_PNPM \/ DSH_MATT_PNPM 未设置/.test(r.detail.join(' | ')), r.detail.join(' | '))
})

// ── R12 DSH_DESKTOP_ROOT 的两种读法都吃（teammate 实测的口径歧义）────────────
// 契约（冻结 §2）写的是 `<root>/resources/runtime/cli/bin/dsh.cmd` ⇒ **root = 应用根**（含
// `resources` 那层）。但口语里「桌面运行时根」也常被读成 `<app>/resources` 本身，assertions
// 2026-10-18 实测把 root 设成 `resources` → 首取路径变成 `…/resources/resources/…` 而落空。
// 硬化：同一档内加一条回落 `<root>/runtime/…`（**不改变档间顺序**，只是多试一个形态）。
test('R12a. root=应用根（含 resources）→ 命中，且路径含 resources 段', () => {
  const r = probeDsh({
    env: { DSH_DESKTOP_ROOT: 'X:\\app' },
    platform: WIN,
    pathEntries: [],
    exists: mkExists([join('X:\\app', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')]),
  })
  assert.equal(r.found, true)
  assert.equal(r.source, 'desktop')
  assert.equal(r.path, join('X:\\app', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
})

test('R12b. root=resources 目录本身（口语另一种读法）→ 同样命中，落回同一路径', () => {
  const r = probeDsh({
    env: { DSH_DESKTOP_ROOT: join('X:\\app', 'resources') },
    platform: WIN,
    pathEntries: [],
    exists: mkExists([join('X:\\app', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')]),
  })
  assert.equal(r.found, true, 'root 设成 resources 时不该静默落空（D47）')
  assert.equal(r.source, 'desktop')
  // 两种读法必须收敛到**同一条**真实路径（否则就是两条不同的候选在各自命中）
  assert.equal(r.path, join('X:\\app', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
})

test('R12c. pnpm 的 desktop 分支同样吃两种读法（落回同一个 pnpm.cjs）', () => {
  const cjs = join('X:\\app', 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs')
  for (const root of ['X:\\app', join('X:\\app', 'resources')]) {
    const r = probePnpm({ env: { DSH_DESKTOP_ROOT: root }, platform: WIN, pathEntries: [], exists: mkExists([cjs]) })
    assert.equal(r.found, true, `root=${root} 时 pnpm 不该落空`)
    assert.equal(r.path, cjs, `root=${root} 应收敛到同一个 pnpm.cjs`)
  }
})

test('R12d. 回落不改变档间顺序：PATH 命中时仍不落到 desktop 档', () => {
  const r = probeDsh({
    env: { DSH_DESKTOP_ROOT: join('X:\\app', 'resources') },
    platform: WIN,
    pathEntries: ['X:\\onpath'],
    exists: mkExists([
      join('X:\\onpath', 'dsh.cmd'),
      join('X:\\app', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
    ]),
  })
  assert.equal(r.source, 'path', '新增回落候选不得越过 PATH 档（冻结顺序不变）')
})

test('R12e. 对照：两种读法都落空时仍如实未命中（不是硬凑命中）', () => {
  const r = probeDsh({
    env: { DSH_DESKTOP_ROOT: 'X:\\ghost' },
    platform: WIN,
    pathEntries: [],
    exists: () => false,
  })
  assert.equal(r.found, false, '回落不得把「真的没有」变成假命中')
  assert.match(r.detail.join(' | '), /DSH_DESKTOP_ROOT.*没有桌面运行时惯例路径/)
})

// ── R4 桌面端惯例 ───────────────────────────────────────────────────────────
test('R4a. DSH_DESKTOP_ROOT 下桌面 dsh 惯例可命中（dsh.cmd）', () => {
  const r = probeDsh({
    env: { DSH_DESKTOP_ROOT: 'X:\\desktop' },
    platform: WIN,
    pathEntries: [],
    exists: mkExists([join('X:\\desktop', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')]),
  })
  assert.equal(r.found, true)
  assert.equal(r.source, 'desktop')
})

test('R4b. 桌面 pnpm 惯例是 *.cjs（harness 分发形态）', () => {
  const r = probePnpm({
    env: { DSH_DESKTOP_ROOT: 'X:\\desktop' },
    platform: WIN,
    pathEntries: [],
    exists: mkExists([join('X:\\desktop', 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs')]),
  })
  assert.equal(r.found, true)
  assert.equal(r.source, 'desktop')
  assert.ok(isScriptForm(r.path), `桌面 pnpm 惯例应是脚本形态: ${r.path}`)
})

// ── R5 源码检出惯例 ─────────────────────────────────────────────────────────
test('R5a. DSH_MATT_DSH_SRC 下 apps/cli/lib/bin.js 可命中', () => {
  const r = probeDsh({
    env: { DSH_MATT_DSH_SRC: 'X:\\src' },
    platform: WIN,
    pathEntries: [],
    exists: mkExists([join('X:\\src', 'apps', 'cli', 'lib', 'bin.js')]),
  })
  assert.equal(r.source, 'checkout')
})

test('R5b. dshRunner：检出形态经 node 起，其余形态直接起', () => {
  const checkout = dshRunner({ found: true, path: 'X:\\src\\apps\\cli\\lib\\bin.js', source: 'checkout' })
  assert.equal(checkout.cmd, process.execPath)
  assert.deepEqual(checkout.prefix, ['X:\\src\\apps\\cli\\lib\\bin.js'])
  const direct = dshRunner({ found: true, path: 'X:\\bin\\dsh.cmd', source: 'path' })
  assert.equal(direct.cmd, 'X:\\bin\\dsh.cmd')
  assert.deepEqual(direct.prefix, [])
})

// ── R6 pnpm 两形态注入 ──────────────────────────────────────────────────────
test('R6a. 可执行形态 → 所在目录，shim=false（不生成任何文件）', () => {
  let mkCalled = false
  const r = pnpmPathInjection(
    { found: true, path: join('X:\\tools', 'pnpm.cmd'), source: 'path' },
    { mkdtemp: () => { mkCalled = true; return 'X:\\tmp' } },
  )
  assert.equal(r.dir, 'X:\\tools')
  assert.equal(r.shim, false)
  assert.equal(mkCalled, false, '可执行形态不得生成 shim 目录')
})

test('R6b. *.cjs 形态 → mkdtemp shim 目录，shim=true 且内容转发到 node <path>', () => {
  const written = {}
  const r = pnpmPathInjection(
    { found: true, path: 'X:\\rp\\pnpm.cjs', source: 'desktop' },
    { mkdtemp: (prefix) => { assert.ok(prefix, 'mkdtemp 应收到前缀'); return 'X:\\shimdir' }, writeFile: (p, c) => { written[p] = c } },
  )
  assert.equal(r.shim, true)
  assert.equal(r.dir, 'X:\\shimdir')
  // 统一的对外表现：shim 目录里有一个叫 `pnpm` 的可执行 + Win 侧 `pnpm.cmd`
  assert.ok(written[join('X:\\shimdir', 'pnpm.cmd')], 'shim 目录里应有 pnpm.cmd')
  assert.ok(written[join('X:\\shimdir', 'pnpm')], 'shim 目录里应有 pnpm（POSIX 壳）')
  assert.match(written[join('X:\\shimdir', 'pnpm.cmd')], /node "X:\\rp\\pnpm\.cjs"/)
  assert.ok(written[join('X:\\shimdir', 'pnpm')].includes('exec node "X:\\rp\\pnpm.cjs"'), 'POSIX shim 应转发到 node <path>')
})

test('R6c. 脚本形态缺 mkdtemp 注入 → 抛（本模块不隐式写盘）', () => {
  assert.throws(
    () => pnpmPathInjection({ found: true, path: 'X:\\rp\\pnpm.cjs' }),
    /mkdtemp/,
  )
})

test('R6d. 未命中的结果不许进注入（调用方 bug 要响亮）', () => {
  assert.throws(() => pnpmPathInjection({ found: false, path: null }), /found/)
})

// ── R7 hint 非空且可执行 ────────────────────────────────────────────────────
test('R7a. missingToolHint(pnpm) 非空、含真变量名/命令、且点明「不是 preset 坏了」', () => {
  const hint = missingToolHint('pnpm')
  assert.ok(hint.trim().length > 0)
  assert.ok(hint.includes('--pnpm'), '指路里必须有可复制的显式参数')
  assert.ok(hint.includes('DSH_PNPM'), '指路里必须有可复制的环境变量')
  assert.ok(/preset/.test(hint), '必须点明误诊方向（看起来像 preset 坏了）')
  assert.ok(!/[\r\n]/.test(hint), '必须是一行可执行指路')
})

test('R7b. missingToolHint(dsh) 非空、含 --dsh/DSH_MATT_DSH 与两条惯例变量', () => {
  const hint = missingToolHint('dsh')
  assert.ok(hint.includes('--dsh'))
  assert.ok(hint.includes('DSH_MATT_DSH'))
  assert.ok(hint.includes('DSH_DESKTOP_ROOT'))
  assert.ok(hint.includes('DSH_MATT_DSH_SRC'))
  assert.ok(!/[\r\n]/.test(hint))
})

test('R7c. 未知工具也给一行非空指路（不返回 undefined）', () => {
  const hint = missingToolHint('whatever')
  assert.equal(typeof hint, 'string')
  assert.ok(hint.includes('whatever'))
})

// ── R8 探测顺序的**契约**断言（改坏顺序必红）────────────────────────────────
// 与 R1a 同判据但写成「顺序表」形态：把三个来源都摆好，只按契约顺序期望 explicit。
// 扰动实测（见文件头）：把 explicit 分支挪到 env 之后 → 本条红（source 变成 env）。
test('R8. 顺序契约：三来源全在场时，命中顺序必须是 explicit（扰动顺序即红）', () => {
  const r = probeDsh({
    explicit: join('X:', 'a', 'dsh.cmd'),
    env: { DSH_MATT_DSH: join('X:', 'b', 'dsh.cmd') },
    platform: WIN,
    pathEntries: ['X:\\c'],
    exists: mkExists([join('X:', 'a', 'dsh.cmd'), join('X:', 'b', 'dsh.cmd'), join('X:\\c', 'dsh.cmd')]),
  })
  assert.equal(r.source, 'explicit', 'explicit 必须压过 env 与 PATH')
})

// ── R9 CLI：解析到的 dsh 从**含空格**的路径起得来（#47 实测缺陷）────────────
// 为什么这条必须在 CLI 层：`runOrDie` 走 `shell:true` 时 Node 只把命令与参数**拼接**、
// 不转义；桌面端运行时就在 `…\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd` 这种
// 含空格的路径下。不修时 cmd.exe 从空格处截断，报
// `'…\DeepSeek' is not recognized as an internal or external command`（2026-10-18 实测）。
// 判据：fake dsh 落在**带空格的目录**里，跑一次 install，断言它**真被调用**（argv 记录到文件）。
test('R9. 含空格的 dsh 路径经 shell 起得来（fake dsh 真被调用）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-probe-space-'))
  try {
    // 目录名里带空格——正是桌面端 `DeepSeek Harness` 的形态
    const binDir = join(dir, 'DeepSeek Harness', 'resources', 'cli', 'bin')
    mkdirSync(binDir, { recursive: true })
    const record = join(dir, 'record.txt')
    writeFileSync(record, '')
    // fake dsh：把 argv 追加进 record，再 exit 0（挂载那步只要求 status 0）。
    // ⚠ 假件里**不许**写裸 `node`：手工登录 shell（`-lc`）下 cmd.exe 解析不到它，用例就会红在
    // **夹具的工具链假设**上而不是本条判据（成因与读数见 docs/dev-environment.md §0.2 的
    // `node` 那一行）。用**正在跑本用例的** node 绝对路径；夹具侧对它的引号是 cmd 语法，不是被测对象。
    writeFileSync(join(binDir, 'dsh.cmd'),
      `@echo off\r\n"${process.execPath}" "%~dp0fake.mjs" %*\r\n`)
    writeFileSync(join(binDir, 'fake.mjs'),
      'import { appendFileSync } from "node:fs"\n'
      + 'appendFileSync(process.env.PROBE_RECORD, JSON.stringify(process.argv.slice(2)) + "\\n")\n')
    // fake pnpm 也必须命中，否则会先 die(missingToolHint('pnpm')) 而走不到 dsh
    const pnpmDir = join(dir, 'pnpm tools')
    mkdirSync(pnpmDir, { recursive: true })
    writeFileSync(join(pnpmDir, 'pnpm.cmd'), '@echo off\r\nexit /b 0\r\n')

    const home = join(dir, 'home')
    const r = spawnSync(process.execPath, [BIN, 'install', '--profile', 'web',
      '--dsh', join(binDir, 'dsh.cmd'), '--pnpm', join(pnpmDir, 'pnpm.cmd')], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: home, PROBE_RECORD: record },
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    const calls = readFileSync(record, 'utf8').trim()
    assert.equal(r.status, 0, `installer 应成功（含空格路径）：exit ${r.status}\n${out}`)
    assert.ok(calls !== '', `fake dsh 未被调用 —— 含空格路径被 shell 截断了？\n${out}`)
    assert.match(calls, /"plugin","--profile","web","add"/)
    assert.ok(!/is not recognized as an internal or external command/.test(out),
      `cmd.exe 在空格处截断了命令：\n${out}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── R11 两种未命中必须分开（Lead 2026-10-18 拍板）────────────────────────────
// 区分：**显式给错**（`--pnpm/--dsh <不存在>`）= 操作者错误 → die 且文案必须点明显式路径；
// **环境缺席**（到处都没有）= 保持 `missingX` 一行可执行指路（方向是 PATH）。
// 若统一说 `missing pnpm/dsh`，读者会把排查方向引到 PATH——而他明明给了参数，真因在那个路径上。
test('R11a. probeTool 暴露 explicitProblem：显式落空非 null，环境缺席为 null', () => {
  const wrong = probePnpm({
    explicit: 'X:\\nope\\pnpm.cmd', env: {}, platform: WIN, pathEntries: [],
    exists: mkExists(['X:\\onpath\\pnpm.cmd']),
  })
  assert.equal(wrong.found, false)
  assert.ok(wrong.explicitProblem, `显式落空应暴露 explicitProblem: ${JSON.stringify(wrong)}`)
  assert.match(wrong.explicitProblem, /--pnpm/, '应点明是哪个参数')
  // 对照：环境缺席（没给显式）→ explicitProblem 必须是 null
  const absent = probePnpm({ env: {}, platform: WIN, pathEntries: [], exists: () => false })
  assert.equal(absent.found, false)
  assert.equal(absent.explicitProblem, null, '环境缺席不该被当成「显式给错」')
})

test('R11b. probeFailureHint 两种文案不同：显式给错点明参数，环境缺席给 PATH 指路', () => {
  const wrong = probeDsh({
    explicit: 'X:\\nope\\dsh.cmd', env: {}, platform: WIN, pathEntries: [], exists: () => false,
  })
  const explicitHint = probeFailureHint('dsh', wrong)
  assert.match(explicitHint, /显式/, `显式给错必须点明「显式参数」:\n${explicitHint}`)
  assert.match(explicitHint, /--dsh/, '要指出是哪个参数')
  assert.ok(!/^missing dsh/.test(explicitHint), '显式给错不该套用 missing 文案（方向会跑偏）')

  const absent = probeDsh({ env: {}, platform: WIN, pathEntries: [], exists: () => false })
  const absentHint = probeFailureHint('dsh', absent)
  assert.match(absentHint, /^missing dsh/, `环境缺席应保持 missing 一行指路:\n${absentHint}`)
  assert.equal(absentHint, missingToolHint('dsh'), '环境缺席走 missingToolHint 原文')
  assert.notEqual(explicitHint, absentHint, '两种未命中的文案必须不同（这正是本条的判据）')
})

test('R11c. CLI：--pnpm <不存在> → exit 1 且文案点明显式路径（不是 missing pnpm）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-probe-exp-'))
  try {
    const binDir = join(dir, 'bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'dsh.cmd'), '@echo off\r\nexit /b 0\r\n')
    const r = spawnSync(process.execPath, [BIN, 'install', '--profile', 'web',
      '--dsh', join(binDir, 'dsh.cmd'), '--pnpm', join(dir, 'no-such-pnpm.cmd')], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: join(dir, 'home') },
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    assert.equal(r.status, 1, `显式给错必须 die:\n${out}`)
    assert.match(out, /--pnpm/, `文案要点明是 --pnpm 给错了:\n${out}`)
    assert.match(out, /显式/, `文案要点明「显式参数」语义:\n${out}`)
    assert.ok(!/missing pnpm/.test(out),
      `显式给错不该说 missing pnpm（会把方向引到 PATH）:\n${out}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('R11d. CLI：--dsh <不存在> → exit 1 且文案点明显式路径（不降级成 skip）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-probe-exp-dsh-'))
  try {
    const r = spawnSync(process.execPath, [BIN, 'install', '--profile', 'web',
      '--dsh', join(dir, 'no-such-dsh.cmd')], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: join(dir, 'home') },
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    assert.equal(r.status, 1, `--dsh 给错必须 die（不能降级成响亮跳过）:\n${out}`)
    assert.match(out, /--dsh/, `文案要点明是 --dsh 给错了:\n${out}`)
    assert.match(out, /显式/, `文案要点明「显式参数」语义:\n${out}`)
    assert.ok(!/skipped profile mount/.test(out),
      `显式给错不该走「跳过」路径（那会让人以为环境里没有 dsh）:\n${out}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('R11e. 对照：环境缺席（无显式）→ 仍是 skip + missing 指路，exit 0（不被 R11 误伤）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-probe-exp-none-'))
  try {
    const nodeDir = dirname(process.execPath)
    const barePath = process.platform === 'win32' ? `${nodeDir};C:\\Windows\\System32` : nodeDir
    const r = spawnSync(process.execPath, [BIN, 'install', '--profile', 'web'], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: join(dir, 'home'), PATH: barePath, Path: barePath,
        DSH_MATT_DSH: '', DSH_MATT_DSH_SRC: '', DSH_DESKTOP_ROOT: '' },
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    assert.equal(r.status, 0, `环境缺席应响亮跳过而非 die:\n${out}`)
    assert.match(out, /missing dsh/, `环境缺席应给 PATH 向的 missing 指路:\n${out}`)
    assert.ok(!/显式参数给错了/.test(out), `环境缺席不该说「显式给错了」:\n${out}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── R10 CLI：挂载被跳过时收尾**不得谎报成功**（D47，Lead 复跑实测缺陷）────────
// 缺陷形态（2026-10-18 Lead 独立复跑踩到）：dsh/pnpm 都不在 PATH 时 mountOrWarn 响亮跳过，
// 但 install 收尾行仍无条件写 `mounted into profile 'web'` —— store 落了盘、profile 里**没有
// link**，读者会以为装好了、去重启一个不会生效的实例。upgrade（`重启…生效`）与 uninstall
// （`profile 'web' unmounted`）同病。
// 判据（非空洞）：跳过分支跑一次真 CLI，断言 ①出现 skip 行 ②收尾**不含** `mounted into profile`
// ③**含** 如实的分岔文案；happy 分支对照组必须含 `mounted into profile`（否则「改成永不打印」
// 也能骗过上面三条）。
test('R10a. 挂载跳过（无 dsh）→ install 收尾不得出现 `mounted into profile`', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-probe-lie-'))
  try {
    const home = join(dir, 'home')
    // PATH 只留 node 所在目录 → 没有 dsh、没有 pnpm（Windows 上还要 System32 才能起进程）
    const nodeDir = dirname(process.execPath)
    const barePath = process.platform === 'win32' ? `${nodeDir};C:\\Windows\\System32` : nodeDir
    const r = spawnSync(process.execPath, [BIN, 'install', '--profile', 'web'], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: home, PATH: barePath, Path: barePath,
        DSH_MATT_DSH: '', DSH_MATT_DSH_SRC: '', DSH_DESKTOP_ROOT: '' },
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    assert.ok(/dsh not found on PATH — skipped profile mount/u.test(out),
      `应出现响亮跳过（前缀是既有约定）:\n${out}`)
    assert.ok(!/mounted into profile/.test(out),
      `挂载被跳过却谎报成功（D47）：收尾出现 "mounted into profile"\n${out}`)
    assert.match(out, /NOT mounted/, '收尾应如实说明未挂载')
    // 旁证：profile 层确实没建（谎报的实证）
    assert.ok(!existsSync(join(home, 'profiles', 'web', 'package.json')),
      'profile 层不该存在——存在则「跳过」本身有假')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('R10b. 对照组：真挂载时收尾必须出现 `mounted into profile`（防"永不打印"骗过 R10a）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-probe-lie-ok-'))
  try {
    const binDir = join(dir, 'bin')
    mkdirSync(binDir, { recursive: true })
    // fake dsh/pnpm：只求 exit 0（挂载那步只校验 status）
    writeFileSync(join(binDir, 'dsh.cmd'), '@echo off\r\nexit /b 0\r\n')
    writeFileSync(join(binDir, 'pnpm.cmd'), '@echo off\r\nexit /b 0\r\n')
    const r = spawnSync(process.execPath, [BIN, 'install', '--profile', 'web',
      '--dsh', join(binDir, 'dsh.cmd'), '--pnpm', join(binDir, 'pnpm.cmd')], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: join(dir, 'home') },
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    assert.equal(r.status, 0, `对照组应成功:\n${out}`)
    assert.match(out, /mounted into profile 'web'/, `真挂载时必须如实写 mounted:\n${out}`)
    assert.ok(!/NOT mounted/.test(out), `真挂载时不该出现 NOT mounted:\n${out}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('R10c. 跳过分支的 upgrade / uninstall 收尾同样不得谎报', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-probe-lie-ug-'))
  try {
    const home = join(dir, 'home')
    const nodeDir = dirname(process.execPath)
    const barePath = process.platform === 'win32' ? `${nodeDir};C:\\Windows\\System32` : nodeDir
    const env = { ...process.env, DSH_HOME: home, PATH: barePath, Path: barePath,
      DSH_MATT_DSH: '', DSH_MATT_DSH_SRC: '', DSH_DESKTOP_ROOT: '' }
    const run = (args) => {
      const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env })
      return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    }
    // 必须走**非 store-only**（不带 --root）：`--root` 是纯 store 模式，本就不碰 profile，
    // 那时不给「重启生效」是对的（不算谎报）。谎报只发生在**真要挂载但被跳过**时。
    const seeded = run(['install', '--profile', 'web'])
    assert.equal(seeded.status, 0, `seed 安装应成功:\n${seeded.out}`)
    assert.match(seeded.out, /NOT mounted/, `seed 阶段就该如实（前提）:\n${seeded.out}`)
    const up = run(['upgrade', '--profile', 'web'])
    assert.equal(up.status, 0)
    assert.ok(/NOT remounted/.test(up.out), `upgrade 跳过时应如实写 NOT remounted:\n${up.out}`)
    assert.ok(!/重启 dsh/.test(up.out), `upgrade 跳过时不得给「重启生效」空头支票:\n${up.out}`)
    const un = run(['uninstall', '--profile', 'web'])
    assert.equal(un.status, 0)
    assert.ok(!/' unmounted/.test(un.out), `uninstall 跳过时不得写 unmounted:\n${un.out}`)
    assert.ok(/NOT unmounted/.test(un.out), `uninstall 跳过时应如实写 NOT unmounted:\n${un.out}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`\n=== verify-runtime-probe (R1–R13) ===`)
console.log(`${process.exitCode ? 'FAILED' : `all ${passed} tests passed`}${skips > 0 ? ` (${skips} 条 loud skip)` : ''}`)
if (process.exitCode) loudSkip('存在失败用例，环境侧结论不可用')