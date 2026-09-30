/**
 * verify-bundle-sync.mjs — cordis.patch.yml is the bundle-mount carrier
 * (package.json dsh.bundle.patch); agent.cordis.yml stays the only
 * hand-edited source. This test regenerates the wrapper from
 * agent.cordis.yml + the fixed declaration meta and asserts the on-disk
 * file matches byte-for-byte, so the two can never drift.
 *
 * Text-level by design: the entry list carries `!!js` tags the yaml
 * package would reject; the loader parses them, we only guarantee the
 * bytes fed to it equal the source of truth.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))

const header = `# dsh-matt-preset bundle patch (GENERATED — do not hand-edit).
# Source of truth: agent.cordis.yml (plugin entry list, verbatim below) +
# the declaration meta. Regenerate/check with: node tests/verify-bundle-sync.mjs
# Mount shape per ADR-0001 (workspace docs/adr/0001) and DSH composition-
# reference's legacy-preset migration recipe: profiles link: this repo and
# list "dsh-matt-preset" in dsh.profile.bundles; this patch inserts the
# preset declaration row.
#
# Declaration meta (id/name/order) intentionally preserves the values the
# pre-migration profile patch insert carried live (name "Matt 工作流",
# order 0) — 换载体不改语义; preset.yml's display meta (Matt 工作流模式 /
# order 5) belonged to the legacy .agent-presets reader nothing reads any
# more and was never the live value.
- insert:
    - id: preset-dsh-matt-preset
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: dsh-matt-preset
        name: Matt 工作流
        order: 0
        plugins:
`

const src = readFileSync(join(repo, 'agent.cordis.yml'), 'utf8').replace(/\r\n/g, '\n')
const expected =
  header + src.split('\n').map(l => (l.trimEnd() === '' ? '' : '          ' + l)).join('\n')
const actual = readFileSync(join(repo, 'cordis.patch.yml'), 'utf8').replace(/\r\n/g, '\n')

if (actual !== expected) {
  const [a, e] = [actual, expected]
  let i = 0
  while (i < a.length && i < e.length && a[i] === e[i]) i++
  console.error(
    `bundle patch out of sync with agent.cordis.yml at offset ${i}:\n` +
      `  actual:   ${JSON.stringify(a.slice(i, i + 80))}\n` +
      `  expected: ${JSON.stringify(e.slice(i, i + 80))}\n` +
      `regenerate by editing tests/verify-bundle-sync.mjs's header constant or ` +
      `re-running its generator logic after changing agent.cordis.yml`,
  )
  process.exit(1)
}
console.log('bundle patch in sync with agent.cordis.yml (verbatim, 10-space nest)')
