/**
 * verify-isolated-git.mjs —— 共享挂具 `tests/isolated-git.mjs` 的守卫（I1–I3）。**#110**。
 *
 * ── 票面与实测的关系（先读这段，别按票面字面理解本文件）────────────────────────
 * #110 票面写的是"夹具用例**没有**完全隔离 git 环境"，并给了一条 AC：
 * 「复现用例（非空洞）：模拟钩子上下文跑一次夹具 → 必须证明调用方分支/`core.bare` 未被改动；
 *   扰动（去掉隔离）→ 用例必红」。
 *
 * 本票实测（探针 `.scratch/p110-canary.mjs` / `p110-hookenv2.mjs` / `p110-mechanism.mjs`）：
 *   · **病根成立**：把任一处隔离拆掉，用真实 worktree 钩子上下文跑 → `core.bare` 真的被写成
 *     `true`（`.scratch/p110-canary.mjs` 读数：`false → true`，用例 exit 1）；
 *   · **但现役套件不炸**：因为 4 个夹具**各手写了一份** `GIT_*` 清理，隔离其实在位；
 *   · 于是真正缺的不是"隔离"，而是**没有任何断言在守这份隔离** —— 新写夹具的人漏掉那一行，
 *     全程静默，直到有人 `git status` 报 `fatal: this operation must be run in a work tree`。
 * ⇒ 本票的修法照 D15「别拿更宽的正则去追下一个反例，换**结构性**防线」：
 *   ① 把"怎么写"**收敛成一处**（`tests/isolated-git.mjs`）；
 *   ② 用 **I2 结构断言**守住"写没写"（凡 spawn git 的夹具用例都必须走挂具）；
 *   ③ 用 **I1 机制实测**守住"挂具真的管用"（扰动挂具 → 真红）。
 *
 * ── 断言 ──────────────────────────────────────────────────────────────────────
 *   I1 **机制**（非空洞的主体）：在 `os.tmpdir()` 自建 Impure 夹具仓，用**真实钩子上下文**
 *      （实测形态：`GIT_DIR` 指向 worktree 专属 gitdir）跑两次同样的 `git init`：
 *        ① 带挂具（`fixtureEnv`）→ 调用方仓 `core.bare` **不变**；
 *        ② 不带挂具（原样继承）→ 调用方仓 `core.bare` **被写成 true**（这条必须真红才说明
 *           挂具是承重的 —— 与 R3 的三态表同一种"把机制变成可跑的事实"手法）。
 *   I2 **结构**：扫描 `tests/*.mjs`，凡**调用 git 的夹具用例**必须 import 挂具。
 *     这是 D15 的结构性防线：不追"下一个漏写的文件"，而是让"漏写"本身可判。
 *   I3 **挂具自检**：`fixtureEnv()` 真的删掉了全部继承 `GIT_*`（含 `CALLER_GIT_VARS` 全表），
 *      且重名覆盖仍生效 —— 挂具自己先被测，免得"守卫守着一个坏的挂具"。
 *
 * ── 隔离纪律（本用例自己遵守它所守的纪律）──────────────────────────────────────
 * 全程落 `os.tmpdir()`；真树**只读**；夹具一律 `git -C <dir>`（**不用** spawn 的 `cwd:`）；
 * 还原用**副本回写**（#108 纪律，禁用 `git checkout --` / `git restore` 作还原手段）。
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { CALLER_GIT_VARS, fixtureEnv, gitIn } from './isolated-git.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TESTS = join(REPO, 'tests')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const loud = (name, why) => results.push('  ⤼ SKIP (loud) ' + name + ' — ' + why)

// ══ I1: 机制实测 —— 挂具到底挡不挡得住"夹具写进调用方仓" ══════════════════════════
// 构造照 #110 的事故面：base 仓 + linked worktree；GIT_DIR 取**实测形态**
// （`<base>/.git/worktrees/<name>`，不是票面推的 `<repo>/.git` —— 见 `.scratch/p110-hookenv2.mjs`）。
const ROOT = mkdtempSync(join(tmpdir(), 'dsh-matt-isolated-git-'))
let fixtureOk = false

/** 在给定的"调用方仓"里读一个键（用挂具自己的 `git -C`，读数不受被注入的上下文影响）。
 *  ⚠ `gitIn` 返回的是 **argv 展开式**调用器（`G('config', 'core.bare')`），不接数组 ——
 *    传数组会被拼成一个字面 argv（实测 `git: 'config,core.bare' is not a git command`）。 */
const callerCfg = (repo, ...args) => gitIn(repo, fixtureEnv())(...args)

try {
  const BASE = join(ROOT, 'caller')
  const WT = join(ROOT, 'worktree')
  mkdirSync(BASE)
  const B = gitIn(BASE, fixtureEnv())
  B('init', '-q', '-b', 'main')
  writeFileSync(join(BASE, 'a.txt'), 'one\n')
  B('add', '-A')
  B('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'seed')
  const wtAdd = B('worktree', 'add', '-q', '-b', 'feat', WT)

  const bare0 = callerCfg(BASE, 'config', 'core.bare')
  if (wtAdd.status !== 0 || bare0.status !== 0) {
    bad('I1. 夹具不成立（真 linked worktree 可建）',
      `worktree add exit ${wtAdd.status} / config exit ${bare0.status} —— 演示无效，**不报假绿**`)
  } else {
    fixtureOk = true
    // 真实钩子上下文的**实测形态**（worktree 专属 gitdir）
    const WT_GITDIR = join(BASE, '.git', 'worktrees', 'worktree')
    const HOOK_CTX = { GIT_DIR: WT_GITDIR, GIT_INDEX_FILE: join(WT_GITDIR, 'index') }

    /**
     * 用给定 env 在**临时目录里**造一个新仓（= 夹具在做的事），返回调用方 `core.bare` 的**事后**读数。
     * 这正是事故形态：夹具的 `git init` 落在调用方仓的**共享 .git/config** 上。
     */
    const attempt = (withHarness) => {
      const sandbox = mkdtempSync(join(ROOT, 'sandbox-'))
      // 两臂的**唯一**差别就是挂具：关闭 = 原样继承钩子上下文；开启 = 走 fixtureEnv。
      // ⚠ 这里不做任何"额外清理" —— 否则两臂的差别就不只是一个变量，I1a/I1b 的对照失去意义
      //   （本臂初版多写了两行 delete，实测把"不带挂具"那一臂也清干净了，I1a 根本没有红的机会）。
      const env = withHarness ? fixtureEnv() : { ...process.env, ...HOOK_CTX }
      const r = spawnSync('git', ['-C', sandbox, 'init', '-q', '-b', 'main'], { encoding: 'utf8', env, windowsHide: true })
      const after = callerCfg(BASE, 'config', 'core.bare')
      return { exit: r.status, bare: after.status === 0 ? (after.stdout ?? '').trim() : `<读不到 exit ${after.status}>` }
    }

    // ── ① 不带挂具（= #110 的现场形态）→ 必须**真把调用方仓改坏** ────────────────
    const withoutHarness = attempt(false)
    if (withoutHarness.bare === 'true') {
      ok('I1a. **不带挂具**时调用方仓真被改坏（`core.bare` → true）—— 事故可复现，挂具确有存在理由',
        `exit ${withoutHarness.exit}；调用方 core.bare = "false" → "true"（` +
        '与 `.scratch/p110-canary.mjs` 的读数同形）')
    } else {
      bad('I1a. 不带挂具时**未能**复现污染（期望 core.bare → true）',
        `exit ${withoutHarness.exit}；调用方 core.bare = ${JSON.stringify(withoutHarness.bare)} —— ` +
        '夹具或上下文形态变了：I1b 的"挂具挡住了"就成了**无权声称**（先修本条的夹具，别改判据）')
    }
    // 现场复原（#110 票面末节的手法）：把被写坏的配置写回 false
    B('config', 'core.bare', 'false')
    const restored = callerCfg(BASE, 'config', 'core.bare')
    if ((restored.stdout ?? '').trim() !== 'false') {
      bad('I1 现场的 core.bare 未复原', `读数 ${JSON.stringify((restored.stdout ?? '').trim())}`)
    }

    // ── ② 带挂具 → 调用方仓必须**逐项不变** ──────────────────────────────────────
    const C = gitIn(BASE, fixtureEnv())
    const before = {
      bare: (callerCfg(BASE, 'config', 'core.bare').stdout ?? '').trim(),
      branch: (C('symbolic-ref', '--short', 'HEAD').stdout ?? '').trim(),
      head: (C('rev-parse', 'HEAD').stdout ?? '').trim(),
    }
    const withHarness = attempt(true)
    const after = {
      bare: (callerCfg(BASE, 'config', 'core.bare').stdout ?? '').trim(),
      branch: (C('symbolic-ref', '--short', 'HEAD').stdout ?? '').trim(),
      head: (C('rev-parse', 'HEAD').stdout ?? '').trim(),
    }
    // 三个信号**各自**断言（#108 R6 的教训：合取里一条恒真时，另一条失效无人察觉）
    const SIGNALS = [
      ['调用方 `core.bare` 未被写成 true', after.bare !== 'true', `${JSON.stringify(before.bare)} → ${JSON.stringify(after.bare)}`],
      ['调用方分支 ref 未被顶走', before.branch === after.branch, `${JSON.stringify(before.branch)} → ${JSON.stringify(after.branch)}`],
      ['调用方 HEAD 未变', before.head === after.head, `${before.head.slice(0, 7)} → ${after.head.slice(0, 7)}`],
    ]
    const failed = SIGNALS.filter(([, holds]) => !holds)
    if (withHarness.exit !== 0) {
      bad('I1b. 带挂具时夹具仓可 init', `exit ${withHarness.exit} —— 挂具把夹具自己弄坏了`)
    } else if (failed.length === 0) {
      ok('I1b. **带挂具**时调用方仓逐项不变（core.bare / 分支 ref / HEAD 三个信号各自断言）',
        `${SIGNALS.length} 条信号全部成立（对照 I1a 的同形输入被改坏 → 挂具是承重的）`)
    } else {
      bad('I1b. 带挂具时调用方仓仍被改（挂具没挡住）',
        failed.map(([n, , v]) => `${n} → 实测 ${v}`).join(' ｜ '))
    }
  }
} catch (error) {
  bad('I1. 机制实测可运行', String(error?.message ?? error))
} finally {
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 3 })
}

// ══ I2: 结构断言 —— 凡**自建 git 仓的夹具用例**必须走挂具（D15 的结构性防线）════════
// 为什么是"结构"而不是"逐文件加正则"：本票的病灶正是"隔离有 4 份、靠每处自觉"。
// 追下一个漏写的文件是**无收敛的军备竞赛**；让"漏写"本身可判才是结构性防线。
//
// ⚠ 判据的**收窄**（本票实测，别按"凡 spawn git"理解）：初版把判据写成"凡直接 spawn git 的
//   用例"，实测一次扫出 5 个文件，其中 4 个是**假红** —— 它们只用 git **读调用方仓自己**
//   （`git ls-files` 取仓内文件清单 / `rev-parse` 探仓是否存在），**不建任何夹具仓**。
//   给它们套隔离是错的（隔离会清掉它们**故意要读的**那个仓库上下文）。真正的危险面是
//   **自建仓**：一旦 `git init` 继承了外层 `GIT_DIR`，它就会写到**调用方仓**上（I1a 已实测）。
//   ⇒ 判据 = "**自建仓库**的用例必须走挂具"，用 `git init` / `git -C <tmp> init` 一族认出来。
const SPAWN_GIT = /(?:spawnSync|execFileSync|execSync)\(\s*['"`]git['"`]/
/** **自建仓**的信号：`init` 作为 git 子命令出现在参数里（`G('init', …)` / `['init', …]` / `'init'` 直调）。
 *  这是"夹具会造出新仓"的可判形式 —— 也只有这种用例才可能把仓写到调用方身上。 */
const CREATES_REPO = /(?:['"`]init['"`])/
/** 自写的 `GIT_*` 清理：`for (... of Object.keys(env)) if (...startsWith('GIT_')) delete ...` 一族。 */
const HANDROLLED_CLEAN = /startsWith\(\s*['"]GIT_['"]\s*\)/
const IMPORT_HARNESS = /from\s+['"]\.\/isolated-git\.mjs['"]/

const files = readdirSync(TESTS).filter(f => f.endsWith('.mjs')).sort()
const offenders = []
const audit = []
/** 读数面自检（防"扫描面失效 → 空扫描报绿"）：这三个文件**必须**被认出来，否则判据本身坏了。 */
const MUST_MATCH = ['verify-all-entry.mjs', 'verify-precommit-hook.mjs', 'verify-restore-discipline.mjs', 'verify-batch-state.mjs']
const matched = []
for (const file of files) {
  if (file === 'isolated-git.mjs') continue          // 挂具自己不是夹具用例
  if (file === 'verify-isolated-git.mjs') continue   // 本文件是**守卫**：它自己建仓（I1 夹具），但它是判据的
                                                     // 持有者 —— 靠下面 MUST_MATCH 反向自检覆盖它的机制面，
                                                     // 而不是让它 import 自己（自引用无意义）
  const src = readFileSync(join(TESTS, file), 'utf8')
  // 观测面只看**代码行**：注释里叙述这套做法（本文件、brief、配方头注都会提）不该被自己拦下
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  if (!SPAWN_GIT.test(code) || !CREATES_REPO.test(code)) continue
  matched.push(file)
  const imports = IMPORT_HARNESS.test(src)
  const handrolled = HANDROLLED_CLEAN.test(code)
  audit.push(`${file}${imports ? ' ✓挂具' : ' ✗无挂具'}${handrolled ? ' ✗自写清理' : ''}`)
  if (!imports || handrolled) offenders.push({ file, imports, handrolled })
}

const missingProbe = MUST_MATCH.filter(f => !matched.includes(f))
if (audit.length === 0 || missingProbe.length > 0) {
  loud('I2. 结构断言（凡**自建仓**的夹具用例必走挂具）',
    audit.length === 0
      ? '没扫到任何自建仓的用例 —— 扫描面失效，**不报假绿**'
      : `判据没认出这些已知自建仓的用例: ${missingProbe.join(', ')} —— 观测面失效，**不报假绿**`)
} else if (offenders.length === 0) {
  ok(`I2. 凡**自建仓库**的用例都走共享挂具、且无自写 \`GIT_*\` 清理（${audit.length} 个文件）`,
    audit.join(' ｜ '))
} else {
  bad(`I2. 有用例绕过共享挂具（#110 病灶复发：隔离又变成"每处各写一份"）`,
    offenders.map(o => `${o.file}（${[!o.imports && '未 import 挂具', o.handrolled && '自写 GIT_* 清理'].filter(Boolean).join(' + ')}）`).join(' ｜ ') +
    ' —— 改成 `import { fixtureEnv } from \'./isolated-git.mjs\'` 并用它构造 env')
}

// ══ I3: 挂具自检 —— 守卫别守着一个坏的挂具 ═══════════════════════════════════════
{
  const probe = 'GIT_DIR'
  const saved = process.env[probe]
  process.env[probe] = '<sentinel>'
  for (const v of CALLER_GIT_VARS) process.env[v] = `sentinel-${v}`
  try {
    const env = fixtureEnv()
    const left = Object.keys(env).filter(k => k.startsWith('GIT_'))
    // ① 继承的 GIT_* 必须**一个不剩**（不只是表里那 8 个 —— 任何漏网变量都可能改变夹具里 git 的行为）
    if (left.length === 0) {
      ok('I3a. `fixtureEnv()` 清掉**全部**继承的 `GIT_*`（不只是 CALLER_GIT_VARS 那 8 个）',
        `注入 ${CALLER_GIT_VARS.length} 个哨兵 + GIT_DIR → 残留 0 个`)
    } else {
      bad('I3a. `fixtureEnv()` 有 `GIT_*` 漏网', `残留: ${left.join(', ')} —— 漏网变量仍会把夹具指向调用方仓`)
    }
    // ② 覆盖项必须**仍然生效**（清完再合，顺序错了会把刚给的配置一起删掉）
    const withOverride = fixtureEnv({ GIT_CONFIG_GLOBAL: join(tmpdir(), 'x') })
    if (withOverride.GIT_CONFIG_GLOBAL !== undefined) {
      ok('I3b. `fixtureEnv()` 的覆盖项生效（清完再合，不被同一次清理吃掉）',
        `GIT_CONFIG_GLOBAL = ${JSON.stringify(withOverride.GIT_CONFIG_GLOBAL)}`)
    } else {
      bad('I3b. `fixtureEnv()` 把调用方给的覆盖项也清掉了', '顺序反了 —— 先清、再合')
    }
    // ③ `gitIn` 必须**用 `-C`** 而不是 `cwd:`（本机 startup 脚本族会把 cwd 静默复位）
    // ⚠ 判据只看**代码行**：初版在整份源码上找 `cwd:`，实测被挂具自己注释里那句
    //   "不要用 spawn 的 `cwd:`" 判红 —— 判据读的是**措辞**而不是行为（本仓 §3.1 的形态）。
    //   剥掉注释行再匹配，与 R7 的"剥注释行"同法。
    const hSrc = readFileSync(join(TESTS, 'isolated-git.mjs'), 'utf8')
    const hCode = hSrc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    const usesC = /'git',\s*\[\s*'-C'/.test(hCode)
    const usesCwd = /cwd\s*:/.test(hCode)
    if (usesC && !usesCwd) {
      ok('I3c. `gitIn` 用 `git -C <dir>` 定位仓库（判据只看**代码行**，不读注释措辞）',
        'cwd: 在本机会被 startup 脚本族静默复位 → 夹具命令打到调用方仓')
    } else {
      bad('I3c. `gitIn` 未用 `-C`，或代码里引入了 `cwd:`',
        `用 -C: ${usesC} / 出现 cwd:: ${usesCwd} —— ` +
        '本机 startup 脚本族会复位子进程 cwd（#110 的另一条同族通路）')
    }
  } finally {
    for (const v of CALLER_GIT_VARS) delete process.env[v]
    if (saved === undefined) delete process.env[probe]
    else process.env[probe] = saved
  }
}

console.log('\n=== ISOLATED-GIT VERIFY (I1–I3) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)