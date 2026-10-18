/**
 * verify-temp-home-guard.mjs — 隔离跑助手 `scripts/with-temp-home.mjs` 的验收
 * （2026-10-18 第三次 home 事故硬化，#113 A 面）。
 *
 * 事故（取证 `_forensics/INCIDENT3-2026-10-18.md`，现场另记于 `docs/dev-environment.md` §1）：
 * 手工 PowerShell「造沙箱 home」的一段命令里 `$home = …` 撞上 PowerShell **只读自动变量
 * `$HOME`** —— 赋值是**非终止错误**（stderr 一行、脚本照跑），紧接着 `New-Item $home` 因目标
 * 已存在而失败，于是**沙箱 home 从未建出来**，`Join-Path $home '.dsh'` / `$env:DSH_HOME`
 * 静默指向真实 home，收尾按环境变量展开的递归删除删掉了真实 `~/.dsh`。
 * 病根不是"某条命令写错"，而是**默认形态要求人（agent）手写一段容易静默写错的 PowerShell**。
 *
 * 本助手把那一段挪进 Node：路径由 `fs.mkdtemp` 生成、**建之前**先过 `assertSafeTempHome`、
 * **删之前**再过一次，且只删 `mkdtemp` 自己返回的那个绝对路径 —— 不是任何环境变量的**再解析**。
 *
 * 用例：
 *   T1 守卫纯函数（AC2）：homedir / dirname(homedir) / 盘根（含 Windows 盘根与 UNC 形态）/
 *      tmpdir 之外的路径 → **全部抛错**；tmpdir 之下的普通目录 → 放行。
 *   T2 正常闭环（AC1）：`node scripts/with-temp-home.mjs -- node -e "print $DSH_HOME"`
 *      打印的路径**在 `os.tmpdir()` 之内**，且**退出后该目录不存在**。
 *   T3 响亮失败（AC3）：缺 `--`、`--` 后为空 → exit≠0 **且** stderr 有话说（D47：不得静默
 *      什么都不做）。
 *   T4 退出码透传 + 收尾仍执行：子命令 exit 7 时助手也退 7，且临时 home 已被清掉。
 *   T5 注入的是那个路径（AC1 的判别）：子进程看到的 `DSH_HOME` **就是**助手 echo 的绝对路径，
 *      不是父进程继承来的值（本机父进程的 `DSH_HOME` 正是真实 `~/.dsh`）。
 *
 * 非空洞（扰动纪律，见 `docs/code-review-brief.md` §2）：把 `assertSafeTempHome` 改成恒不抛
 * → T1 全红（实测读数记在 #113 的交付评论里）；把 mkdtemp 之后的守卫调用删掉 → T1 不变
 * 而 T2 仍绿（守卫是"建之前先判"，它的红场景是**守卫函数本身**，故 T1 直测导出函数、
 * 不经 CLI —— 只有直测才不会因 CLI 封装而假绿）。
 *
 * 隔离：本用例自身只在 `os.tmpdir()` 下建目录，收尾统一删除（失败保留现场并响亮打印路径，
 * 与 #77 的收尾口径一致）。**绝不**读写真实 home。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, parse, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const SCRIPT = join(REPO, 'scripts', 'with-temp-home.mjs')
const { assertSafeTempHome } = await import(new URL('../scripts/with-temp-home.mjs', import.meta.url).href)

/** 用例自己借来的临时根（失败保留现场）。 */
const borrowed = []
const borrow = (dir) => { borrowed.push(dir); return dir }

let passed = 0
let failed = 0
const test = (name, fn) => {
  try {
    fn()
    passed++
    console.log(`  ok - ${name}`)
  } catch (e) {
    failed++
    console.error(`  FAIL - ${name}\n${e?.stack ?? e}`)
  }
}

/** 助手 CLI：照实传 argv，拿回 status / stdout / stderr。 */
const runHelper = (args, env = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

// ── T1（AC2）守卫纯函数：危险目标一律抛错，合法临时目录放行 ────────────────────
//
// BRANCH ISOLATION (the reason this section passes `opts`): every case below pins
// ONE of the guard's three refusals — filesystem root / the real home and its
// ancestors / not-strictly-inside tmpdir — and asserts the ERROR MESSAGE that
// branch produces. Calling the guard with the machine's real `tmpdir()`/`homedir()`
// would let the branches cover for each other: on this host `dirname(homedir())`
// (`C:\Users`) is refused by the *ancestor* branch, but it is ALSO outside tmpdir,
// so deleting the ancestor branch left the case green (measured by mutation — the
// whole point of AC6). A case that cannot fail when the behaviour it names is
// removed is not evidence. Injecting `tmpRoot`/`userHome` makes each case exercise
// exactly one branch, and matching the message keeps it honest if the branches are
// ever reordered.
const refusesWith = (target, re, opts = {}) => {
  assert.throws(() => assertSafeTempHome(target, opts), re)
}
const allowsWith = (target, opts = {}) => {
  assert.doesNotThrow(() => assertSafeTempHome(target, opts))
}
// The guard checks in a fixed order — filesystem root, then the real home and its
// ancestors, then containment — so a fixture must satisfy ONLY the branch under
// test; otherwise an earlier branch answers and the case silently proves the wrong
// thing. `TMP_LIKE` is inside the real tmpdir and NOT an ancestor of FAKE_HOME.
const FAKE_TMP = join(resolve(tmpdir()), 'dsh-temp-home-fake-tmp')
const FAKE_HOME = join(parse(resolve(tmpdir())).root, 'dsh-temp-home-fake-users', 'user')
// fake home and fake temp root are siblings on the SAME drive root; neither
// contains the other, and neither is the other's ancestor.
const ISOLATED = { tmpRoot: FAKE_TMP, userHome: FAKE_HOME }

test('T1a. 真实 home 本身 → 抛错（事故形态一）', () => {
  // FAKE_HOME is not a filesystem root and not inside FAKE_TMP, so ONLY the
  // "real user home" branch can refuse it.
  refusesWith(FAKE_HOME, /real user home/, ISOLATED)
  refusesWith(homedir(), /real user home|ancestor of the user home|strictly inside/)
})
test('T1b. home 的**祖先**（profile 根，事故 stderr 里被误当沙箱 home 的那层）→ 抛错', () => {
  // `dirname(FAKE_HOME)` is not a filesystem root and not inside FAKE_TMP, so ONLY
  // the ancestor branch can refuse it — this is the case that reddens when the
  // ancestor check is deleted.
  refusesWith(dirname(FAKE_HOME), /ancestor of the user home/, ISOLATED)
})
test('T1c. 盘根 → 抛错（平台无关 + Windows 盘根 + 正斜杠 + UNC 形态）', () => {
  for (const root of [parse(homedir()).root, parse(dirname(homedir())).root, 'C:\\', 'D:\\', 'C:/', '\\\\server\\share']) {
    refusesWith(root, /filesystem root/, ISOLATED)
  }
})
test('T1d. tmpdir() 之外的普通路径 → 抛错（含"看起来像临时目录"的同级邻居）', () => {
  const outside = { tmpRoot: FAKE_TMP, userHome: FAKE_HOME }
  refusesWith(join(resolve(tmpdir()), 'somewhere-else', 'home'), /strictly inside/, outside)
  // The classic prefix-comparison trap: a directory whose NAME starts with the
  // temp root's name but is not inside it.
  refusesWith(`${FAKE_TMP}-elsewhere`, /strictly inside/, outside)
  // A `..`-escape that a naive `startsWith(root + sep)` comparison would ACCEPT:
  // `…/fake-tmp/../../evil` is outside the temp root, and the guard must use a
  // path-relationship judgement (it delegates to `lib/safe-target.mjs`).
  refusesWith(join(FAKE_TMP, '..', '..', 'evil'), /strictly inside/, outside)
  refusesWith(dirname(FAKE_TMP), /strictly inside/, outside)
})
test('T1e. tmpdir() 之下的普通目录 → 放行（守卫不能误伤正常临时 home）', () => {
  allowsWith(join(FAKE_TMP, 'home-1'), ISOLATED)
  allowsWith(join(FAKE_TMP, 'nested', 'home-2'), ISOLATED)
  const real = borrow(mkdtempSync(join(tmpdir(), 'dsh-temp-home-allow-')))
  allowsWith(real)   // the real mkdtemp output, against the real tmpdir/homedir
})
test('T1f. 非字符串 / 空串 / 纯空白 → 抛错（响亮，不静默当成"没目标"）', () => {
  for (const bad of [undefined, null, '', '   ', 42, {}, []]) {
    assert.throws(() => assertSafeTempHome(bad, ISOLATED), /non-path safety target/)
  }
})
test('T1g. 真实 tmpdir 下但等于 tmpdir 本身 → 抛错（严格包含，不含相等）', () => {
  refusesWith(resolve(tmpdir()), /strictly inside/, { tmpRoot: resolve(tmpdir()), userHome: FAKE_HOME })
})

// ── T2（AC1）正常闭环：打印的路径在 tmpdir 之内，退出后不存在 ─────────────────
/**
 * Is `target` strictly inside the system temp directory?
 *
 * DELIBERATELY INDEPENDENT of the module under test (`assertSafeTempHome` delegates
 * its containment judging to `lib/safe-target.mjs`): a T2/T5 assertion that reused
 * the same comparator could not catch a bug in it — the two would agree by
 * construction. This is the "independent oracle" kind of duplication, not the
 * accidental kind, and it compares on a SEPARATOR so that `…\Temp-other` (a legal
 * directory whose name merely starts with `Temp`) is not mistaken for "inside
 * `…\Temp`" (the classic prefix-comparison bug).
 */
const isInsideTmpdir = (target) => {
  const t = resolve(target)
  const tmp = resolve(tmpdir())
  if (t === tmp) return true
  const prefix = tmp.endsWith('\\') || tmp.endsWith('/') ? tmp : tmp + sep
  return t.startsWith(prefix)
}

test('T2. AC1 — 子进程 DSH_HOME 在 os.tmpdir() 之内，退出后目录不存在', () => {
  // 子命令把路径打到 stdout 的固定前缀行，便于断言"打印的就是注入的那个"。
  const probe = "console.log('DSH_HOME=' + process.env.DSH_HOME)"
  const r = runHelper(['--', process.execPath, '-e', probe])
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`)
  const out = String(r.stdout ?? '')
  const printed = /DSH_HOME=(.+)/.exec(out)?.[1]?.trim()
  assert.ok(printed, `子进程没有打印 DSH_HOME：\n${out}`)
  const resolved = resolve(printed)
  assert.ok(isInsideTmpdir(resolved), `打印的路径不在 os.tmpdir() 之内: ${resolved} vs ${resolve(tmpdir())}`)
  // 助手自己也会 echo 绝对路径（D47 响亮）——同一路径必须在 stdout 里出现。
  assert.ok(out.includes(resolved), `助手没有 echo 绝对路径 ${resolved}:\n${out}`)
  assert.ok(!existsSync(resolved), `退出后临时 home 仍然存在: ${resolved}`)
})

// ── T3（AC3）缺 -- / 空命令 → 响亮失败 ────────────────────────────────────────
test('T3a. 缺 `--` → exit≠0 且 stderr 有话说（不得静默）', () => {
  const r = runHelper(['node', '-e', 'console.log(1)'])
  assert.notEqual(r.status, 0, 'missing -- must fail loudly')
  assert.ok(String(r.stderr ?? '').trim().length > 0, 'missing -- produced no diagnostic')
  assert.match(`${r.stdout}${r.stderr}`, /--/)
})
test('T3b. `--` 后为空 → exit≠0 且 stderr 有话说', () => {
  const r = runHelper(['--'])
  assert.notEqual(r.status, 0, 'empty command must fail loudly')
  assert.ok(String(r.stderr ?? '').trim().length > 0, 'empty command produced no diagnostic')
})
test('T3c. 两者都不会建出临时 home（失败要早于建目录；stdout 保持干净）', () => {
  for (const args of [['--'], ['node', '-e', 'console.log(1)']]) {
    const r = runHelper(args)
    assert.notEqual(r.status, 0, `expected loud failure for: ${args.join(' ')}`)
    // Argument validation must run BEFORE the temp home is created, so a failing
    // invocation prints nothing on stdout. (The previous form of this case matched
    // /^created /m, a string the helper NEVER prints — a dead assertion. Asserting
    // stdout is EMPTY is the real, falsifiable form of "it did not create one".)
    assert.equal(String(r.stdout ?? '').trim(), '', `a failed invocation wrote to stdout: ${r.stdout}`)
  }
})

// ── T4 退出码透传 + 收尾仍然执行 ──────────────────────────────────────────────
test('T4. 子命令 exit 7 → 助手退 7，且临时 home 已被清掉', () => {
  const child = "console.log('H=' + process.env.DSH_HOME); process.exit(7)"
  const r = runHelper(['--', process.execPath, '-e', child])
  assert.equal(r.status, 7, `expected exit 7, got ${r.status}`)
  const home = /H=(.+)/.exec(String(r.stdout ?? ''))?.[1]?.trim()
  assert.ok(home, `子进程没有打印 home：\n${r.stdout}`)
  assert.ok(!existsSync(resolve(home)), `退出码透传路径下临时 home 仍在: ${home}`)
})

// ── T5 注入判别：子进程看到的必须是助手建的那个路径 ───────────────────────────
test('T5. 注入的 DSH_HOME 是助手建出的路径，不是父进程继承值', () => {
  const parent = process.env.DSH_HOME
  const probe = "console.log('P=' + process.env.DSH_HOME)"
  const r = runHelper(['--', process.execPath, '-e', probe])
  assert.equal(r.status, 0, r.stderr)
  const injected = /P=(.+)/.exec(String(r.stdout ?? ''))?.[1]?.trim()
  assert.ok(injected, 'no DSH_HOME seen by the child')
  assert.notEqual(injected, parent, `子进程继承了父进程的 DSH_HOME（真实 home）: ${injected}`)
  assert.ok(isInsideTmpdir(injected), `注入值不在 tmpdir 下: ${injected}`)
  assert.ok(!existsSync(resolve(injected)), 'child kept the temp home alive')
})

// 收尾：全绿才清；有失败则保留现场并逐个响亮打印绝对路径（#77 口径）。
const allGreen = failed === 0
console.log(`\n=== TEMP-HOME GUARD VERIFY (T1–T5) ===`)
console.log(`  ${allGreen ? 'OK' : 'FAILED'} — ${passed} passed, ${failed} failed`)
if (!allGreen) {
  for (const dir of borrowed) console.log(`tmp kept: ${dir}`)
} else {
  for (const dir of borrowed) rmSync(dir, { recursive: true, force: true })
}
process.exit(failed === 0 ? 0 : 1)