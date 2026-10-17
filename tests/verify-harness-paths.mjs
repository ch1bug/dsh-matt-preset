/**
 * verify-harness-paths.mjs — contract for `resolveLocalNames` (P1–P3).
 *
 * Why: production spells preset rows `dsh-matt-preset/x.mjs` (the installed
 * bundle dir). The harness rewrote them against `rootDir` = the repo's PARENT,
 * which silently required the checkout directory to be named exactly
 * `dsh-matt-preset`. Measured 2026-10-17 on an msys2 copy named
 * `dsh-matt-preset-src`: `tests/verify.mjs` B went red with
 * `file:///<user-home>//dsh-matt-preset/workflow-core.mjs: never started` — a
 * path that cannot exist, blamed on the plugin rows. Renamed clones,
 * `git worktree` checkouts and any `<name>-src` copy all hit it; the
 * neighbouring workspace avoids the class by taking explicit paths instead of
 * deriving them.
 *
 *   P1 a package-prefixed row resolves INSIDE the given package dir, and the
 *      resolved file exists — red before the fix (prefix kept, parent used).
 *   P2 the package prefix is stripped, never doubled (`…/pkg/pkg/x.mjs`).
 *   P3 a non-prefixed relative row still resolves against the given dir (the
 *      helper's generality: preset-local paths, not only package-prefixed ones).
 *
 * The seam is the exported helper, not a copy of its rules: the red scene for
 * P1/P2 is the pre-fix implementation, which this file exercised on 2026-10-17.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveLocalNames } from './preset-harness.mjs'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const resolveOne = (name, dir) => resolveLocalNames([{ id: 'row', name }], dir)?.[0]?.name ?? ''

const root = await mkdtemp(join(tmpdir(), 'dsh-harness-paths-'))
// A deliberately NON-canonical package dir name: this is the whole point.
const pkg = join(root, 'dsh-matt-preset-src')
try {
  await mkdir(join(pkg, 'sub'), { recursive: true })
  await writeFile(join(pkg, 'workflow-core.mjs'), 'export const name = "probe"\n')
  await writeFile(join(pkg, 'sub', 'plugin.mjs'), 'export const name = "probe-sub"\n')

  // P1: the production spelling resolves to a file that really exists.
  const p1 = resolveOne('dsh-matt-preset/workflow-core.mjs', pkg)
  if (fileURLToPath(p1) === join(pkg, 'workflow-core.mjs') && existsSync(fileURLToPath(p1))) {
    ok('P1. package-prefixed row resolves inside the given package dir (file exists)', 'dsh-matt-preset/*')
  } else {
    bad('P1. package-prefixed row landed outside the checkout', p1)
  }

  // P2: prefix stripped, not doubled.
  if (!p1.includes('/dsh-matt-preset/') && p1.endsWith('/workflow-core.mjs')) {
    ok('P2. the package prefix is stripped, never doubled')
  } else {
    bad('P2. package prefix doubled in the rewritten href', p1)
  }

  // P3: the helper's generality — a preset-local relative path.
  const p3 = resolveOne('sub/plugin.mjs', pkg)
  if (fileURLToPath(p3) === join(pkg, 'sub', 'plugin.mjs') && existsSync(fileURLToPath(p3))) {
    ok('P3. non-prefixed relative row still resolves against the given dir')
  } else {
    bad('P3. preset-local relative row broken', p3)
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('\n=== HARNESS PATHS VERIFY (P1–P3) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)