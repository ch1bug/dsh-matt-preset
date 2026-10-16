/**
 * verify-precommit-hook.mjs — acceptance for `.githooks/pre-commit` (H1–H3).
 *
 * Why: the hook is this repo's only gate (no CI), and it runs
 * `scripts/verify-all.mjs` against the WORKING TREE while `git commit` records
 * the INDEX. When the two diverge — the review round edits files after the
 * pre-review `git add -A` that `docs/code-review-brief.md` §1 prescribes — the
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
 */
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

const REPO = fileURLToPath(new URL('..', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'dsh-precommit-'))
const marker = join(root, 'checker-ran.txt')

/** Env for the throwaway-repo git calls: git exports `GIT_DIR` /
 * `GIT_INDEX_FILE` / `GIT_WORK_TREE` to hooks, so when this test runs under the
 * real pre-commit hook (verify-all does exactly that), an inherited `GIT_DIR`
 * would point the probe's `git add` / `git commit` at THIS repo. Strip every
 * `GIT_*` so the probe can only ever touch its own temp repo. */
const cleanEnv = (extra = {}) => {
  const env = { ...process.env, ...extra }
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  return env
}
const run = (args, extra) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv(extra) })
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
  await writeFile(join(root, 'scripts', 'verify-all.mjs'),
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'ran')\n`)
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
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('\n=== PRE-COMMIT HOOK VERIFY (H1–H3) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)