/**
 * #154: the REAL verify CLI must join child persistence before removing its
 * borrowed root. A scheduling preload makes the old call site fail with native
 * ENOTEMPTY data/sessions; it neither replaces the writer nor fakes the error.
 * The public verdict is exit 0 AND an empty private TEMP after a green run.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'dsh-session-cleanup-'))
const sandbox = join(root, 'tmp')
mkdirSync(sandbox)
let passed = false
try {
  const run = spawnSync(process.execPath, [
    'scripts/with-temp-home.mjs', '--', process.execPath,
    '--import', './tests/fixtures/session-cleanup-preload.mjs', 'tests/verify.mjs',
  ], {
    cwd: repo,
    env: { ...process.env, TEMP: sandbox, TMP: sandbox, TMPDIR: sandbox },
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 2 * 1024 * 1024,
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  writeFileSync(join(root, 'child.log'), output)
  assert.ifError(run.error)
  assert.notEqual(run.status, null, `NORUN: child did not exit (signal=${run.signal})`)
  const symptom = /ENOTEMPTY/.test(output) && /data[\\/]+sessions/.test(output)
  assert.equal(run.status, 0, `verify CLI exit=${run.status}; native ENOTEMPTY data/sessions=${symptom}`)
  assert.match(output, /\[session-cleanup\] real compression held/, 'probe must reach REAL persistence')
  assert.match(output, /\[session-cleanup\] completion released before cleanup/, 'write must settle without cleanup releasing it')
  assert.match(output, /\[session-cleanup\] pending=0 overlaps=0/, 'no deletion may overlap the pinned writer')
  assert.equal(symptom, false, 'original cleanup symptom must not recur')
  // Node's own stable content-addressed cache is not a test-owned artifact.
  const leftovers = readdirSync(sandbox).filter(name => name !== 'node-compile-cache')
  assert.deepEqual(leftovers, [], 'successful CLI must leave no borrowed root or handoff document')
  passed = true
  console.log('PASS #154: real verify CLI joins delayed persistence; isolated TEMP empty')
} catch (error) {
  console.error(`FAIL #154: ${error.message}`)
  process.exitCode = 1
} finally {
  // Only the path returned by our own mkdtemp is ever removed. Failures retain
  // both the exact child output and remaining artifacts for diagnosis.
  if (passed) rmSync(root, { recursive: true, force: true })
  else console.log(`tmp kept: ${root}`)
}
