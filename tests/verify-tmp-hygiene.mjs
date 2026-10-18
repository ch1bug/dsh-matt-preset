/**
 * verify-tmp-hygiene — 临时目录卫生守卫（#77）。
 *
 * 为什么存在：#77 的四种（后扩到多处）用例在 `<TEMP>` 下 `mkdtemp` 出目录却从不清理，
 * 每次套件净增几个、常年累积（2026-10-17 实测 554 个；2026-10-18 又抓到脚本形态 pnpm 的
 * 转发 shim `dsh-matt-pnpm-*` **每次挂载 +1**）。这些泄漏没有任何自动防线 —— 它们是
 * "套件全绿但磁盘在长"的那一类缺陷。
 *
 * 判据为什么不是"按前缀计数"：前缀清单天生滞后（本轮就抓到票面没列的 `dsh-matt-pnpm-*`）。
 * 这里用更强的等价判据：**把用例跑在它自己的隔离 TEMP 里，跑完那个目录必须为空**
 * —— 不依赖前缀，任何"建了不删"的东西都逃不掉；而且与并发会话 / 本机其它进程互不干扰
 * （按全局计数会被别人的运行污染，"计数不增"会既漏报也误报）。
 *
 * ⚠ 全局计数还有一条**静默假绿**的陷阱（本票实测）：受限 shell 下列不了用户 `%TEMP%`，
 * 而 `Get-ChildItem $env:TEMP -Directory -Filter '<前缀>*' -ErrorAction SilentlyContinue`
 * 会把访问拒绝**吞成 0** —— "前后都是 0、计数不增"于是完全可能是"根本没读到"。
 * 所以本守卫不依赖任何全局计数；要用计数法取证时必须**去掉 SilentlyContinue**、让拒绝响亮。
 *
 * 覆盖面是**清单制**（已知泄漏面 + 同族），不是自动发现全仓用例：新用例不在 `CASES` 里
 * 就不会被检查 —— 这是**显式边界**，不是遗漏（自动发现等于把整套用例跑两遍，代价不成比例）。
 *
 * 为什么 `stdio: 'ignore'`：受限 shell 下 Node 起子进程走**具名管道**不可用（实测
 * `spawnSync(..., { encoding: 'utf8' })` 的子进程全部 `status=null`），而本守卫只需要
 * 退出码 + 沙箱目录清单，不需要子进程输出 —— 这样它在受限与不受限两种环境下都能跑。
 *
 * 非空洞（#77 AC④）：
 *   - C0 自检：自己往沙箱里种一个条目，检测器必须看得见它（检测器瞎了就红）；
 *   - 把任一用例的清理删掉 → 它的沙箱非空 → 对应那条红（红读数见 #77 交付评论）。
 *
 * 失败路径不在这儿管：#77 AC② 是"失败**保留现场并响亮打印** `tmp kept: <path>`"，
 * 那由各用例自己的收尾块负责（守卫只判成功路径的沙箱）。用例自身没跑绿时，沙箱判据
 * 不成立 —— 那时**响亮跳过**并报出它保留了什么，不静默。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const loud = (name, detail = '') => results.push('  !! SKIP (loud) ' + name + (detail ? ' — ' + detail : ''))

/**
 * 只放行**工具自己、且是固定名可复用**的缓存目录：`node-compile-cache` 是 Node 编译缓存的
 * 默认落点（内容寻址的缓存条目），由子进程里的 node 建立、**同名复用**（不随每次运行新增），
 * 不是本仓代码写的"现场"。实测：裸 `node -e` 与裸 `bin/install.mjs` 都不建它，只有整份
 * installer 用例那种重度运行会写；本守卫按它的名字放行，并在此写明理由 ——
 * 放行一个"像是我们的"泄漏，就等于把守卫弄瞎。
 */
const TOOL_OWNED = new Set(['node-compile-cache'])

/** #77 的四个前缀所在用例 + 同族（全部跑在隔离 TEMP 里）。 */
const CASES = [
  { file: 'verify.mjs', why: 'dsh-matt-ws-*' },
  { file: 'verify-lang-asm.mjs', why: 'lang-asm-*' },
  { file: 'verify-lang-count.mjs', why: 'lang-count-*' },
  { file: 'verify-enforcer.mjs', why: 'dsh-enforcer-batch-*' },
  { file: 'verify-payload-manifest.mjs', why: 'dsh-payload-*（exit 钩子清理的既有先例）' },
  { file: 'verify-installer-guards.mjs', why: 'dsh-matt-guards-*（与 verify-installer 同款收尾）' },
  { file: 'verify-runtime-probe.mjs', why: 'dsh-probe-*' },
  // opt-in 的口径跟 verify-all 一致：不设 DSH_MATT_INSTALLER 时它本来就不跑，
  // 这里也不替它跑（否则默认套件凭空多 18s）。
  { file: 'verify-installer.mjs', optIn: 'DSH_MATT_INSTALLER', why: 'dsh-matt-installer-*' },
]

/** 沙箱里"不是工具缓存"的条目 = 泄漏候选。 */
const leftoversIn = (sandbox) => readdirSync(sandbox).filter((n) => !TOOL_OWNED.has(n))

/**
 * 删掉守卫自己的沙箱。含 pnpm 建的 junction / 符号链接时，这里先走 Node 的 `rm`，
 * 删不掉再回落 `cmd /c rmdir /s /q`（Windows 对 reparse point 的可靠删法），仍删不掉就
 * 返回 false 让调用方**响亮**报出 —— 绝不接受"代码里写了 rm 但目录仍在"的假清理。
 * （2026-10-18 实测：含 junction 的 installer tmp 上 `Remove-Item -Recurse -Force` 与
 * Node `rm` 都能删掉，交接口径里的"删不掉"在本机**未复现**；本兜底是防御性的。）
 */
function prune(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) } catch { /* 下面兜底 */ }
  if (existsSync(dir) && process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', dir], { stdio: 'ignore' })
  }
  return !existsSync(dir)
}

/** 每个用例跑在自己的隔离 TEMP 里（`TEMP`/`TMP`/`TMPDIR` 三写，跨平台同义）。 */
function sandboxedRun(file, tmpRoot, extraEnv = {}) {
  return spawnSync(process.execPath, [join(REPO, 'tests', file)], {
    cwd: REPO,
    env: { ...process.env, TEMP: tmpRoot, TMP: tmpRoot, TMPDIR: tmpRoot, ...extraEnv },
    stdio: 'ignore',
  })
}

// ── C0 检测器自检：种一个条目，检测器必须看得见（否则整份守卫是空的） ──────────
{
  const control = mkdtempSync(join(tmpdir(), 'dsh-tmp-hygiene-control-'))
  writeFileSync(join(control, 'lang-asm-CONTROL'), 'x')
  const seen = leftoversIn(control)
  if (seen.length === 1 && seen[0] === 'lang-asm-CONTROL')
    ok('C0. detector sees a planted leftover (the assertion is not vacuous)')
  else bad('C0. detector self-check', `planted 1 entry, detector saw ${JSON.stringify(seen)}`)
  if (!prune(control)) loud('C0. control sandbox could not be removed', control)
}

// ── C1–C7：每个用例的沙箱必须跑空 ─────────────────────────────────────────────
for (const c of CASES) {
  if (c.optIn !== undefined && process.env[c.optIn] !== '1') {
    loud(c.file, `${c.why} —— 用例本身 opt-in（设 ${c.optIn}=1 开启），默认套件里不跑`)
    continue
  }
  const sandbox = mkdtempSync(join(tmpdir(), 'dsh-tmp-hygiene-'))
  const started = Date.now()
  const run = sandboxedRun(c.file, sandbox)
  const ms = Date.now() - started
  const leftovers = leftoversIn(sandbox)
  const cleaned = prune(sandbox)
  if (run.error !== undefined || run.status !== 0) {
    const how = run.error !== undefined ? `spawn failed: ${run.error.code}` : `exit ${run.status}`
    // 用例自身失败 → 沙箱判据不成立（它按设计保留现场）。不掩盖：报出保留了哪些。
    loud(`${c.file} (${how})`,
      `用例自身没跑绿，泄漏判据不成立${leftovers.length > 0 ? `；它保留的现场: ${leftovers.join(', ')}` : ''}`)
  } else if (leftovers.length === 0) {
    ok(`${c.file} — sandbox empty after a green run`, `${ms}ms`)
  } else {
    bad(`${c.file} — leaked ${leftovers.length} temp entr${leftovers.length === 1 ? 'y' : 'ies'}`, leftovers.join(', '))
  }
  if (!cleaned) bad(`${c.file} — our own sandbox survived cleanup`, 'junction removal obstacle?')
}

// ── C8：脚本形态 pnpm 的转发 shim（`dsh-matt-pnpm-*`）─────────────────────────
// 环境里 pnpm 是不是**脚本形态**不可控（可执行形态**不建 shim**），所以这里自己造一对桩：
// `pnpm.cjs`（脚本形态 → 走 shim 分支）+ `dsh.cmd`（exit 0 → 挂载步骤成功）。
// 于是在不依赖本机 pnpm 的前提下，确定性地走一遍「每次挂载建一个随机名 shim 目录」那条路。
// 桩与 store 都放在 fixture 里，只有 `tmp/` 被当成 TEMP —— 跑完它必须是空的。
{
  const fixture = mkdtempSync(join(tmpdir(), 'dsh-tmp-hygiene-shim-'))
  const tmpRoot = join(fixture, 'tmp')
  const stubDir = join(fixture, 'stubs')
  mkdirSync(tmpRoot, { recursive: true })
  mkdirSync(stubDir, { recursive: true })
  writeFileSync(join(stubDir, 'dsh.cmd'), '@echo off\r\nexit /b 0\r\n', 'ascii')
  writeFileSync(join(stubDir, 'pnpm.cjs'), 'process.exit(0)\n', 'ascii')
  const run = spawnSync(process.execPath, [
    join(REPO, 'bin', 'install.mjs'), 'install',
    '--dsh', join(stubDir, 'dsh.cmd'), '--pnpm', join(stubDir, 'pnpm.cjs'),
  ], {
    cwd: REPO,
    env: { ...process.env, TEMP: tmpRoot, TMP: tmpRoot, TMPDIR: tmpRoot, DSH_HOME: join(fixture, 'home') },
    stdio: 'ignore',
  })
  const leftovers = readdirSync(tmpRoot)
  if (run.status !== 0) {
    loud('C8. script-form pnpm shim (installer did not run green)', `exit ${run.status}${run.error ? ` (${run.error.code})` : ''}`)
  } else if (leftovers.length === 0) {
    ok('C8. a script-form pnpm mount leaves no `dsh-matt-pnpm-*` shim behind')
  } else {
    bad('C8. script-form pnpm shim leaked', leftovers.join(', '))
  }
  if (!prune(fixture)) loud('C8. shim fixture could not be removed', fixture)
}

console.log('\n=== TMP HYGIENE VERIFY (#77) ===')
console.log(results.join('\n'))
const bads = results.filter((r) => r.startsWith('  ✗')).length
const oks = results.filter((r) => r.startsWith('  ✓')).length
const skips = results.filter((r) => r.includes('SKIP (loud)')).length
console.log(`\n${bads > 0 ? 'FAIL' : 'PASS'} — ${oks} ok, ${bads} bad${skips > 0 ? `, ${skips} loud skip` : ''}`)
process.exit(bads > 0 ? 1 : 0)