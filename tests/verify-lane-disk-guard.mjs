/**
 * verify-lane-disk-guard.mjs — #137 AC2：泳道批磁盘软守卫的判据面测试。
 *
 * 被测件 scripts/lane-disk-guard.mjs（纯函数与 I/O 分离，照 lane-audit 先例）：
 *   - G 组（纯函数，离线）：formatBytes 档位与坏值、parseThresholdGb 正反例、
 *     parseLaneGates 一键解析（注释剥 / 坏值响亮 / 未知键响亮 / 缺席回落）、
 *     evaluatePoolSize 边界（等于阈值 = 未超；+1 字节 = 超）与 ⚠/✓ digest 行形状。
 *   - C 组（CLI 真跑，spawnSync node scripts/lane-disk-guard.mjs）：真临时目录
 *     撒真字节，实测三条阈值链（--threshold-gb / lane-gates.yml / 默认 20 GB）、
 *     优先级（CLI > config）、超限 exit 1 + ⚠ 行、未超 exit 0 + ✓ 行、
 *     符号链接/junction 不跟随不累计（du 口径）、全部用法错误响亮 exit 2。
 *
 * 票面判据（#137 第 4 项）：默认 20 GB、按仓覆写；超阈值 → 停手 + GC + digest 一行
 * ⚠，不静默继续（D47）。测试纪律：临时目录全部 mkdtemp 自建，finally 只删自己
 * 建的那一个路径；不碰仓内任何既有文件。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const SCRIPT = join(REPO, 'scripts', 'lane-disk-guard.mjs')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

// ── 模块 seam ─────────────────────────────────────────────────────────────────
let guard
try {
  guard = await import(pathToFileURL(SCRIPT).href)
} catch (error) {
  bad('M. lane-disk-guard.mjs imports', String(error?.message ?? error))
  report('LANE DISK GUARD VERIFY (#137 AC2)')
}
const seam = ['DEFAULT_THRESHOLD_GB', 'formatBytes', 'parseThresholdGb', 'parseLaneGates', 'evaluatePoolSize', 'measureDirSize']
const missingSeam = seam.filter(k => guard[k] === undefined)
if (missingSeam.length === 0) ok('M. exposes the guard seam', seam.join(', '))
else {
  bad('M. exposes the guard seam', `missing: ${missingSeam.join(', ')}`)
  report('LANE DISK GUARD VERIFY (#137 AC2)')
}

const throws = (fn) => { try { fn(); return false } catch { return true } }

// ── G 组：纯函数 ──────────────────────────────────────────────────────────────
{
  const cases = [[0, '0 B'], [1023, '1023 B'], [1024, '1.0 KiB'], [1536, '1.5 KiB'], [1048576, '1.0 MiB'], [20 * 1024 ** 3, '20.0 GiB']]
  const wrong = cases.filter(([bytes, want]) => guard.formatBytes(bytes) !== want)
  if (wrong.length === 0) ok('G1. formatBytes unit ladder', cases.map(([b, s]) => `${s}`).join(' / '))
  else bad('G1. formatBytes unit ladder', wrong.map(([b, want]) => `${b} → ${guard.formatBytes(b)} (want ${want})`).join(' / '))

  if (throws(() => guard.formatBytes(-1)) && throws(() => guard.formatBytes(Number.NaN)))
    ok('G2. formatBytes rejects negative / NaN loudly')
  else bad('G2. formatBytes rejects bad input', 'negative/NaN did not throw')
}
{
  const gb = 1024 ** 3
  const checks = [
    [() => guard.parseThresholdGb(20, 't') === 20 * gb, '20 → bytes'],
    [() => guard.parseThresholdGb('5', 't') === 5 * gb, "'5' (string) → bytes"],
    [() => guard.parseThresholdGb(1.5, 't') === Math.round(1.5 * gb), '1.5 → rounded bytes'],
    [() => throws(() => guard.parseThresholdGb(0, 't')), '0 throws'],
    [() => throws(() => guard.parseThresholdGb(-3, 't')), 'negative throws'],
    [() => throws(() => guard.parseThresholdGb('abc', 't')), "'abc' throws"],
    [() => throws(() => guard.parseThresholdGb(Number.POSITIVE_INFINITY, 't')), 'Infinity throws'],
  ]
  const failed = checks.filter(([run]) => !run())
  if (failed.length === 0) ok('G3. parseThresholdGb positive-number contract (bad values throw)', `${checks.length} checks`)
  else bad('G3. parseThresholdGb contract', `${failed.length}/${checks.length} failed`)
}
{
  const checks = [
    [() => guard.parseLaneGates('thresholdGb: 5\n')?.thresholdGb === 5, 'plain key (numeric)'],
    [() => guard.parseLaneGates('# 泳道批磁盘阈值\nthresholdGb: 2.5 # 按仓覆写\n')?.thresholdGb === 2.5, 'comments stripped (numeric)'],
    [() => guard.parseLaneGates('') === null, 'empty file → null (fall back to default)'],
    [() => guard.parseLaneGates(null) === null, 'no file → null'],
    [() => throws(() => guard.parseLaneGates('thresholdGb: 5\nthresholdGb: 6\n')), 'double declaration throws'],
    [() => throws(() => guard.parseLaneGates('thresholdGb: abc\n')), 'non-numeric value throws (S3: present-but-broken is loud)'],
    [() => throws(() => guard.parseLaneGates('thresholdGB: 5\n')), 'unknown key throws (typo must never silently no-op)'],
    [() => throws(() => guard.parseLaneGates('thresholdGb 5\n')), 'unparseable line throws'],
  ]
  const failed = checks.filter(([run]) => !run())
  if (failed.length === 0) ok('G4. parseLaneGates one-key contract (absent → fallback; broken → loud)', `${checks.length} checks`)
  else bad('G4. parseLaneGates contract', `${failed.length}/${checks.length} failed`)
}
{
  const GB = 1024 ** 3
  const equalCase = guard.evaluatePoolSize({ poolPath: 'P', bytes: 20 * GB, thresholdBytes: 20 * GB })
  const overCase = guard.evaluatePoolSize({ poolPath: 'P', bytes: 20 * GB + 1, thresholdBytes: 20 * GB })
  const underCase = guard.evaluatePoolSize({ poolPath: 'P', bytes: 1, thresholdBytes: 20 * GB })
  const checks = [
    [equalCase.over === false, 'equal to threshold = NOT over (judgement is >)'],
    [overCase.over === true, '+1 byte = over'],
    [underCase.over === false, 'under = not over'],
    [overCase.digestLine.startsWith('⚠ worktree pool P ') && overCase.digestLine.includes('20.0 GiB') && overCase.digestLine.includes('lane 停手') && overCase.digestLine.includes('GC'), '⚠ line: path + sizes + 停手 + GC'],
    [underCase.digestLine.startsWith('✓ worktree pool P ') && underCase.digestLine.includes('≤ threshold 20.0 GiB'), '✓ line: path + threshold'],
  ]
  const failed = checks.filter(([pass]) => !pass)
  if (failed.length === 0) ok('G5. evaluatePoolSize boundary + digest-line shape', `${checks.length} checks`)
  else bad('G5. evaluatePoolSize contract', `${failed.length}/${checks.length} failed`)
}

// ── C 组：CLI 真跑（真临时目录 + 真字节）────────────────────────────────────────
const tmpRoot = mkdtempSync(join(tmpdir(), 'lane-disk-guard-'))
try {
  const run = (args, cwd) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: cwd ?? REPO })
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }
  const seedPool = (dir, files) => {
    mkdirSync(dir, { recursive: true })
    for (const [name, size] of files) {
      const full = join(dir, name)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, Buffer.alloc(size, 1))
    }
  }

  // C1: 超限路径 —— 300 bytes pool，阈值 1.8e-7 GB（≈193 bytes < 300）→ exit 1 + ⚠。
  const poolA = join(tmpRoot, 'pool-a')
  seedPool(poolA, [['a1.bin', 100], ['a2.bin', 100], ['sub/a3.bin', 100]])
  const over = run(['--pool', poolA, '--threshold-gb', '1.8e-7'])
  if (over.code === 1 && over.stdout.includes('⚠') && over.stdout.includes('lane 停手') && over.stdout.includes('300 bytes'))
    ok('C1. over threshold → exit 1 + ⚠ digest line (300 real bytes measured)', over.stdout.trim().split('\n')[0].slice(0, 110))
  else bad('C1. over-threshold path', `exit=${over.code} stdout=${over.stdout.trim().slice(0, 160)}`)

  // C2: 未超路径 —— 同一 pool，阈值 1 GB → exit 0 + ✓。
  const under = run(['--pool', poolA, '--threshold-gb', '1'])
  if (under.code === 0 && under.stdout.includes('✓') && under.stdout.includes('≤ threshold 1.0 GiB'))
    ok('C2. under threshold → exit 0 + ✓ digest line', under.stdout.trim().split('\n')[0].slice(0, 110))
  else bad('C2. under-threshold path', `exit=${under.code} stdout=${under.stdout.trim().slice(0, 160)}`)

  // C3: lane-gates.yml 覆写 + CLI 优先级。config 1e-6 → 超限；CLI 1 压过 config → 未超。
  const gatesPath = join(tmpRoot, 'lane-gates.yml')
  writeFileSync(gatesPath, 'thresholdGb: 1.8e-7\n', 'utf8')
  const viaConfig = run(['--pool', poolA, '--config', gatesPath])
  const cliWins = run(['--pool', poolA, '--config', gatesPath, '--threshold-gb', '1'])
  if (viaConfig.code === 1 && cliWins.code === 0)
    ok('C3. lane-gates.yml override works; --threshold-gb outranks it', `config exit=${viaConfig.code} → cli exit=${cliWins.code}`)
  else bad('C3. config chain', `config exit=${viaConfig.code} cli exit=${cliWins.code}`)

  // C4: 默认阈值 20 GB（无 CLI、无 config —— cwd 指向无 lane-gates.yml 的临时目录）
  // 小 pool 必然未超，digest 行必须亮出 20.0 GiB（默认值真的进了评估）；
  // stderr 必须点名「repo override NOT applied」（复审意见 3：cwd 不在仓根时覆写静默
  // 失效是 S3 邻族形态——点名让它可事后归因，不改退出码）。
  const bareCwd = join(tmpRoot, 'bare-cwd')
  mkdirSync(bareCwd, { recursive: true })
  const byDefault = run(['--pool', poolA], bareCwd)
  if (byDefault.code === 0 && byDefault.stdout.includes('threshold 20.0 GiB') &&
      /repo override NOT applied/.test(byDefault.stderr))
    ok('C4. default threshold 20 GB applied when nothing overrides + stderr names the unapplied override', byDefault.stdout.trim().split('\n')[0].slice(0, 110))
  else bad('C4. default threshold', `exit=${byDefault.code} stdout=${byDefault.stdout.trim().slice(0, 160)} stderr=${byDefault.stderr.trim().slice(0, 160)}`)

  // C5: 符号链接/junction 不跟随不累计（du 口径 —— link-runtime-deps 的 node_modules
  // 链接不得把同一份依赖在每个 lane 重复计一遍）。pool B：直有 50 bytes + 一个指向
  // 外部目录（含 500 bytes）的链接；测得必须 = 50，而非 550。
  const poolB = join(tmpRoot, 'pool-b')
  const outside = join(tmpRoot, 'outside-b')
  seedPool(poolB, [['direct.bin', 50]])
  seedPool(outside, [['heavy.bin', 500]])
  try {
    symlinkSync(outside, join(poolB, 'linked-node_modules'), 'junction')
    const measured = run(['--pool', poolB, '--threshold-gb', '1'])
    if (measured.code === 0 && measured.stdout.includes('50 bytes') && !measured.stdout.includes('550 bytes'))
      ok('C5. symlinks/junctions are not followed (du semantics) — 50 counted, 550 not', measured.stdout.trim().split('\n')[0].slice(0, 110))
    else bad('C5. symlink not followed', `exit=${measured.code} stdout=${measured.stdout.trim().slice(0, 160)}`)
  } catch (error) {
    bad('C5. symlink not followed', `junction create failed (${String(error?.message ?? error)}) — 用例未跑成，如实红`)
  }

  // C6: 用法错误全部响亮 exit 2（D47：缺席必响亮，不猜默认）。
  const usageChecks = [
    [[], 'no --pool'],
    [['--pool', join(tmpRoot, 'does-not-exist')], 'pool dir missing'],
    [['--pool', poolA, '--threshold-gb', 'abc'], 'threshold not a number'],
    [['--pool', poolA, '--threshold-gb', '0'], 'threshold zero'],
    [['--pool', poolA, '--config', join(tmpRoot, 'nope.yml')], '--config named but missing'],
    [['--pool', poolA, '--wat'], 'unknown argument'],
  ]
  const usageRuns = usageChecks.map(([args, label]) => ({ label, r: run(args) }))
  const usageBad = usageRuns.filter(({ r }) => r.code !== 2)
  if (usageBad.length === 0) ok('C6. usage errors all loud exit 2', usageRuns.map(({ label }) => label).join(' / '))
  else bad('C6. usage errors', usageBad.map(({ label, r }) => `${label} → exit ${r.code}`).join(' / '))

  // C7: config 在场但坏值 → 响亮 exit 2（S3：写了配置就要写对，静默回落是降级形态）。
  const brokenGates = join(tmpRoot, 'lane-gates-broken.yml')
  writeFileSync(brokenGates, 'thresholdGb: abc\n', 'utf8')
  const brokenRun = run(['--pool', poolA, '--config', brokenGates])
  if (brokenRun.code === 2 && /thresholdGb must be a positive number/.test(brokenRun.stderr))
    ok('C7. present-but-broken lane-gates.yml is loud exit 2 (never a silent fallback)', brokenRun.stderr.trim().split('\n')[0].slice(0, 110))
  else bad('C7. broken config', `exit=${brokenRun.code} stderr=${brokenRun.stderr.trim().slice(0, 160)}`)
} finally {
  rmSync(tmpRoot, { recursive: true, force: true })
}

report('LANE DISK GUARD VERIFY (#137 AC2 — G 纯函数 + C CLI 真跑)')
