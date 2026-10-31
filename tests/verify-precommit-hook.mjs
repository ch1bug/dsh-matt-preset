/**
 * verify-precommit-hook.mjs — acceptance for `.githooks/pre-commit` (H1–H6).
 *
 * Why: the hook is this repo's only gate (no CI), and it runs
 * `scripts/verify-all.mjs` against the WORKING TREE while `git commit` records
 * the INDEX. When the two diverge — the review round edits files after the
 * pre-review staging that `docs/code-review-brief.md` §1 prescribes (CONDITIONAL
 * since #103: `git add -A` only when this session is the sole writer; otherwise
 * explicit paths / pathspec commit, per docs/dev-environment.md §0.4) — the
 * gate reports OK for content the commit will NOT contain. Measured in the #82
 * session: the commit recorded 283/30 while the tree held 347/32; caught only by
 * a post-commit `git status`, then fixed with two amends. H1 pins the guard.
 *
 * Runs the REAL hook file inside a throwaway repo (with a stub
 * `scripts/verify-all.mjs`, so no runtime deps are needed):
 *   H1 unstaged tracked changes → commit refused, the file is named, and the
 *      checker never ran (fail fast, before the expensive suite).
 *   H2 a clean index → the hook runs the checker and the commit lands.
 *   H3 `SKIP_HOOKS=1` → the documented escape hatch still bypasses. This is the
 *      guard-placement pin: move the new check above the skip block and H3 goes
 *      red (perturbation recorded in the retro session that added it).
 *   H4 detached HEAD → refused (branch form is load-bearing for `--ff-only`
 *      copy sync and for "commits only in the authority tree"; 邻仓 ADR-0014).
 *   H5 an experiment marker (`[MUTATION…` / `[DEBUG…`, see brief §2.6) left in a staged
 *      `tests/*` new line → refused, marker named.
 *   H6 the same marker outside `tests/*` → not blocked (the scope is tests/*
 *      new lines, so docs describing the practice don't trip it).
 *   H7 (#158 AC3) a pathspec commit (`git commit -- <paths>`, the §0.4 shared-
 *      tree discipline shape) makes git hang an ABSOLUTE-path temp index
 *      (GIT_INDEX_FILE) on the hook. The two index checks above need it, but
 *      verify-all and the suites it spawns inherit it and their git calls then
 *      read the PARENT repo's objects — measured 46/50 → 43/50 in #158 (H3
 *      "invalid object … Error building trees" / F16 install-root probe empty /
 *      F3 dirty-tree guard dead). Since c41de61 the hook unsets GIT_INDEX_FILE
 *      before verify-all: H7 pins that the hook-inner checker reads like
 *      standalone, and H7R flips the mutation (strips the unset line from the
 *      FIXTURE's hook copy — the real hook is never touched) to prove H7 is
 *      not vacuous: without the unset, the temp index leaks and the probe
 *      inside the stub checker fails the same way #158 measured.
 */
import { mkdtemp, mkdir, writeFile, copyFile, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fixtureEnv } from './isolated-git.mjs'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

const REPO = fileURLToPath(new URL('..', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'dsh-precommit-'))
// Probe outputs live OUTSIDE the throwaway repo: anything written inside it is
// tree state the hook's own divergence guard (①) reasons about — a tracked
// unstaged probe file would block H7 for the right guard at the wrong trigger.
const out = await mkdtemp(join(tmpdir(), 'dsh-precommit-out-'))
const marker = join(out, 'checker-ran.txt')
// Structured probe written by the stub checker (see the stub source below).
const stubPayload = join(out, 'checker-payload.json')

/** Env for the throwaway-repo git calls: git exports `GIT_DIR` /
 * `GIT_INDEX_FILE` / `GIT_WORK_TREE` to hooks, so when this test runs under the
 * real pre-commit hook (verify-all does exactly that), an inherited `GIT_DIR`
 * would point the probe's `git add` / `git commit` at THIS repo. Strip every
 * `GIT_*` so the probe can only ever touch its own temp repo.
 *
 * ⚠ This cleanup now lives in the shared harness `tests/isolated-git.mjs` (#110):
 * four fixtures each hand-rolled a copy and NOTHING asserted it, so a new fixture
 * that forgot the line stayed silent until someone's `git status` broke. Measured
 * cost of forgetting: the fixture's `git init` writes `core.bare=true` into the
 * CALLER's shared `.git/config` (probe `.scratch/p110-canary.mjs`).
 * The harness itself is pinned by `tests/verify-isolated-git.mjs` (I1 mechanism) and
 * `tests/verify-isolated-git-structure.mjs` (I2 structural, fast set since #169). */
const cleanEnv = (extra = {}) => fixtureEnv(extra)
// `git -C <dir>` rather than spawn's `cwd:` — a host `startup` script family resets
// a child's cwd to the Windows user dir, so `cwd:` silently fails and the fixture's
// commands land on the CALLER's repo (the same failure path #110 is about).
const run = (args, extra) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: cleanEnv(extra) })
const tail = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-4).join(' | ')

try {
  // A throwaway repo carrying the REAL hook and a stub checker, so the test
  // needs neither the runtime deps nor the real suite.
  run(['init', '-q'])
  run(['config', 'user.name', 'hook-probe'])
  run(['config', 'user.email', 'hook-probe@example.invalid'])
  run(['config', 'core.autocrlf', 'false'])
  run(['config', 'commit.gpgsign', 'false'])
  run(['config', 'core.hooksPath', '.githooks'])
  await mkdir(join(root, '.githooks'), { recursive: true })
  await mkdir(join(root, 'scripts'), { recursive: true })
  await copyFile(join(REPO, '.githooks', 'pre-commit'), join(root, '.githooks', 'pre-commit'))
  // The stub checker records WHAT IT SAW. Its git reads run in a NESTED fixture
  // repo (below) — that is the #158 shape: suites spawn git inside their OWN
  // repos, and a leaked GIT_INDEX_FILE points those reads at the HOST's temp
  // index, whose blobs don't exist in the nested store — `cat-file -e` fails
  // exactly the way #158's H3 "invalid object … Error building trees" did.
  // READ-ONLY ops only: the committing process still holds index.lock for
  // writable ones (measured). The env strips only the HOST-repo anchors
  // (GIT_DIR etc.); GIT_INDEX_FILE is deliberately KEPT — it is the thing
  // under test. The stub always touches `marker` so the H1–H6
  // `existsSync(marker)` contract ("did the checker run at all?") keeps its
  // old meaning.
  const nested = join(out, 'nested')
  await mkdir(nested, { recursive: true })
  const runN = (args, extra) => spawnSync('git', ['-C', nested, ...args], { encoding: 'utf8', env: cleanEnv(extra) })
  runN(['init', '-q'])
  runN(['config', 'user.name', 'hook-probe'])
  runN(['config', 'user.email', 'hook-probe@example.invalid'])
  await writeFile(join(nested, 'seed.txt'), 'nested\n')
  runN(['add', '-A'])
  runN(['commit', '-q', '-m', 'nested seed'])
  await writeFile(join(root, 'scripts', 'verify-all.mjs'), [
    `import { spawnSync } from 'node:child_process'`,
    `import { writeFileSync } from 'node:fs'`,
    `const env = { ...process.env }`,
    `for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[k]`,
    `const ls = spawnSync('git', ['-C', ${JSON.stringify(nested)}, 'ls-files', '-s'], { encoding: 'utf8', env })`,
    `const first = (ls.stdout.match(/^[0-7]{6} ([0-9a-f]{40}) /m) || [])[1]`,
    `const blobOk = first ? spawnSync('git', ['-C', ${JSON.stringify(nested)}, 'cat-file', '-e', first], { encoding: 'utf8', env }).status === 0 : false`,
    `writeFileSync(${JSON.stringify(marker)}, 'ran')`,
    `writeFileSync(${JSON.stringify(stubPayload)}, JSON.stringify({`,
    `  tmpIndexInEnv: 'GIT_INDEX_FILE' in process.env,`,
    `  gitIndexFile: process.env.GIT_INDEX_FILE ?? null,`,
    `  blobOk,`,
    `  detail: first ? first.slice(0, 8) : (ls.stderr || '').trim().split('\\n').slice(-1).join(' | ')`,
    `}))`,
    `process.exit(blobOk ? 0 : 1)`,
    ``,
  ].join('\n'))
  await writeFile(join(root, 'tracked.txt'), 'first\n')
  run(['add', '-A'])
  run(['commit', '-q', '-m', 'seed'])

  // H1: the real divergence shape — something IS staged (a real change vs
  // HEAD), and a further edit sits unstaged on top of it. Without the guard the
  // commit lands and silently records the STAGED content while the worktree (the
  // thing the suite just verified) holds something else.
  const diverge = async (staged, worktree) => {
    await writeFile(join(root, 'tracked.txt'), staged)
    run(['add', 'tracked.txt'])
    await writeFile(join(root, 'tracked.txt'), worktree)
  }
  await diverge('second\n', 'third\n')
  await rm(marker, { force: true })
  const h1 = run(['commit', '-m', 'h1'])
  const h1out = tail(h1)
  if (h1.status !== 0 && h1out.includes('tracked.txt') && h1out.includes('未 staged') && !existsSync(marker)) {
    ok('H1. unstaged tracked change → commit refused, file named, checker not run (fail fast)')
  } else {
    bad('H1. index/worktree divergence not guarded',
      `exit=${h1.status} checkerRan=${existsSync(marker)} | ${h1out}`)
  }

  // H2: everything staged → the hook proceeds to the checker and the commit lands.
  run(['add', '-A'])
  await rm(marker, { force: true })
  const h2 = run(['commit', '-m', 'h2'])
  if (h2.status === 0 && existsSync(marker)) {
    ok('H2. clean index → hook runs the checker, commit lands')
  } else {
    bad('H2. clean-index commit blocked', `exit=${h2.status} checkerRan=${existsSync(marker)} | ${tail(h2)}`)
  }

  // H3: SKIP_HOOKS is the documented escape hatch and must stay effective
  // (it is checked BEFORE the new guard).
  await diverge('fourth\n', 'fifth\n')
  await rm(marker, { force: true })
  const h3 = run(['commit', '-m', 'h3'], { ...process.env, SKIP_HOOKS: '1' })
  if (h3.status === 0 && !existsSync(marker)) {
    ok('H3. SKIP_HOOKS=1 still bypasses the gate (escape hatch above the guard)')
  } else {
    bad('H3. SKIP_HOOKS bypass broken', `exit=${h3.status} checkerRan=${existsSync(marker)} | ${tail(h3)}`)
  }
// H4: detached HEAD —— `--ff-only` 副本同步与"提交只在权威树"都依赖分支形态
  // （邻仓 ADR-0014 的钩子第一项；他们记过同类事故）。
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
  run(['checkout', '-q', '--detach'])
  await diverge('sixth\n', 'sixth\n')
  await rm(marker, { force: true })
  const h4 = run(['commit', '-m', 'h4'])
  const h4out = tail(h4)
  if (h4.status !== 0 && h4out.includes('detached') && !existsSync(marker)) {
    ok('H4. detached HEAD → commit refused, checker not run (fail fast)')
  } else {
    bad('H4. detached HEAD not guarded', `exit=${h4.status} checkerRan=${existsSync(marker)} | ${h4out}`)
  }
  run(['switch', '-q', branch])

  // H5: 实验标记（[DEBUG… / [MUTATION…，见 brief §2.6）留在 staged 的 tests/* 新增行里 → 拒绝。
  // 标记死了才叫实验：留下的标记意味着"被跑过的那棵树"与提交物不是同一份。
  // 夹具标记**运行时拼接**：字面串不进提交（本仓 pre-commit 机械拦 staged tests/* 新增行里的实验标记；	ests/ 里一个字都不留是约定，邻仓同形）。
  const MARKER_H5 = '[' + 'MUTATION' + '-probe-h5]'
  await mkdir(join(root, 'tests'), { recursive: true })
  await writeFile(join(root, 'tests', 'probe.mjs'), `const x = 1 // ${MARKER_H5}\n`)
  run(['add', 'tests/probe.mjs'])
  await rm(marker, { force: true })
  const headBeforeH5 = run(['rev-parse', 'HEAD']).stdout.trim()
  const h5 = run(['commit', '-m', 'h5'])
  const h5out = tail(h5)
  if (h5.status !== 0 && h5out.includes(MARKER_H5) && !existsSync(marker)) {
    ok('H5. experiment marker in staged tests/* → commit refused, marker named, checker not run')
  } else {
    bad('H5. experiment marker not guarded', `exit=${h5.status} checkerRan=${existsSync(marker)} | ${h5out}`)
  }
  // 不论拦没拦到，都回到 H5 之前的状态：被拦时 index 里仍留着 staged 文件，
  // 未加固时那个提交则真落进了 HEAD —— 两种世界都要让 H6 从一个干净树起跑。
  run(['reset', '-q', '--hard', headBeforeH5])

  // H6: 同一标记出现在**非 tests/** 文件里不拦 —— 判据只看 tests/* 新增行，
  // 文档里叙述这套做法（如本测试与 brief）不该被自己拦下。
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'docs', 'notes.md'), '文档里叙述 `[MUTATION…]` 做法\n')
  run(['add', 'docs/notes.md'])
  await rm(marker, { force: true })
  const h6 = run(['commit', '-m', 'h6'])
  if (h6.status === 0 && existsSync(marker)) {
    ok('H6. same marker outside tests/ → not blocked (scope is tests/* new lines)')
  } else {
    bad('H6. marker scope too wide (docs blocked)', `exit=${h6.status} checkerRan=${existsSync(marker)} | ${tail(h6)}`)
  }

  // H7 (#158 AC3): pathspec 提交 —— §0.4 共享树纪律的形态(`git commit -- <paths>`)。
  // git 给钩子挂**绝对路径的临时 index**(GIT_INDEX_FILE 指向它):钩子前段两项检查
  // 需要它(判的就是"本次提交的面"),但 verify-all 及其套件 spawn 的 git 若继承它,
  // 会读到父仓的对象——#158 实测 46/50 → 43/50(H3 invalid object / F16 探针空 /
  // F3 脏树拦截失效)。c41de61 在 verify-all 前 unset:本用例断言钩内 stub(= standalone
  // 形态下同一个 stub)看到的环境里**没有**临时 index、且套件读到的 index 自洽
  // (blob 都在本仓对象库)—— 即钩内与 standalone 同读数。本测试自身在真钩子下
  // (经 verify-all)与 standalone 各跑一次,断言都成立,读数天然与形态无关。
  const readProbe = async () => {
    try { return JSON.parse(await readFile(stubPayload, 'utf8')) } catch { return null }
  }
  await writeFile(join(root, 'tracked.txt'), 'seventh\n')
  await rm(marker, { force: true })
  await rm(stubPayload, { force: true })
  const h7 = run(['commit', '-m', 'h7', '--', 'tracked.txt'])
  const p7 = await readProbe()
  if (h7.status === 0 && p7 && p7.tmpIndexInEnv === false && p7.blobOk === true) {
    ok('H7. pathspec commit → hook-inner verify-all reads like standalone (temp index unset before the suite)')
  } else {
    bad('H7. pathspec commit leaked temp index into verify-all',
      `exit=${h7.status} probe=${JSON.stringify(p7)} | ${tail(h7)}`)
  }
  // 常规 index 追上 HEAD:pathspec 提交走临时 index,常规 index 还停在 h6 ——
  // 给 H7R 一个自洽的起跑树,别让它的红来自这里而不是泄漏本身。
  run(['add', '-A'])

  // H7R(非空洞翻转):把 unset 行从 **fixture 内的钩子副本**摘掉(真钩子不动),
  // 同样的 pathspec 提交必须复现 #158:临时 index 泄漏进 stub 环境、index 引用的
  // blob 不在本仓对象库、提交被拒。若摘行后这里仍绿(或泄漏没发生),说明 H7
  // 区分不出两个世界 —— 用例空洞,当场红。钩子副本是 tracked 文件且 pathspec 临时
  // index = HEAD + pathspec(不看常规 index),所以它必须**进 pathspec** 才能过 ①。
  const hookCopy = join(root, '.githooks', 'pre-commit')
  const hookSrc = await readFile(hookCopy, 'utf8')
  if (!hookSrc.includes('unset GIT_INDEX_FILE')) {
    bad('H7R. fixture hook copy has no unset line — hook shape changed, flip probe is vacuous')
  } else {
    await writeFile(hookCopy, hookSrc.replace('unset GIT_INDEX_FILE', ''))
    await writeFile(join(root, 'tracked.txt'), 'eighth\n')
    await rm(marker, { force: true })
    await rm(stubPayload, { force: true })
    const h7r = run(['commit', '-m', 'h7r', '--', 'tracked.txt', '.githooks/pre-commit'])
    const p7r = await readProbe()
    if (h7r.status !== 0 && p7r && p7r.tmpIndexInEnv === true && p7r.blobOk === false) {
      ok('H7R. mutation flip: without the unset the temp index leaks (blob missing from this object store) — H7 is non-vacuous')
    } else {
      bad('H7R. flip did NOT reproduce the #158 leak — H7 cannot tell the two worlds apart',
        `exit=${h7r.status} probe=${JSON.stringify(p7r)} | ${tail(h7r)}`)
    }
  }
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(out, { recursive: true, force: true })
}

console.log('\n=== PRE-COMMIT HOOK VERIFY (H1–H7) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)