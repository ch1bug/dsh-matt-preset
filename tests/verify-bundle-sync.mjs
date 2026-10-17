/**
 * verify-bundle-sync.mjs — the bundle's patch layer is generated, never
 * hand-written (#6, extended to four modes by #99).
 *
 * package.json's `dsh.bundle.patch` declares FOUR files: `cordis.patch.yml`
 * (the matt DEFAULT mode, array item 1) plus `presets/matt-{ptc,minimal,cordis}.patch.yml`
 * (the other three modes, ADR-0015). agent.cordis.yml stays the only hand-edited
 * source: every one of the four is `header + agent.cordis.yml nested 10
 * spaces`, with only the declaration meta and the `workflow-core` row's
 * `profile:` differing per mode. This test composes the expected bytes with
 * the SAME module the generator writes with (lib/bundle-patch.mjs) and asserts
 * each on-disk file matches byte-for-byte, so a roster change can never reach
 * some modes and miss others.
 *
 * Why the default mode has no separate file: the registry throws on a second
 * declaration of the same `config.id` (`Duplicate agent preset: …`), so a
 * `presets/matt.patch.yml` alongside `cordis.patch.yml` made the whole bundle
 * unmountable — measured, #99. N9 below is the mechanical lock against it.
 *
 * Text-level by design: the entry list carries `!!js` tags the yaml package
 * would reject; the loader parses them, we only guarantee the bytes fed to it
 * equal the source of truth.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ALL_PRESETS, DEFAULT_PRESET, expectedPatches, NEST, PRESETS, PROFILES } from '../lib/bundle-patch.mjs'
import { expandEntry } from '../lib/payload.mjs'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const normalize = (text) => text.replace(/\r\n/g, '\n')
const parsePatch = (rel) => {
  // Same dialect the runtime loader speaks. Structured only enough to read the
  // declaration meta back; the byte lock (N7) is what guards the whole body.
  const text = normalize(readFileSync(join(repo, rel.replace(/^\.\//, '')), 'utf8'))
  const pick = (re) => text.match(re)?.[1]
  return {
    insertId: pick(/^ {4}- id: (\S+)[ \t]*$/m),
    name: pick(/^ {6}name: '?([^'\n]+)'?[ \t]*$/m),
    presetId: pick(/^ {8}id: (\S+)[ \t]*$/m),
    displayName: pick(/^ {8}name: (.+?)[ \t]*$/m),
    description: pick(/^ {8}description: (.+?)[ \t]*$/m),
    order: pick(/^ {8}order: (\S+)[ \t]*$/m),
    profile: pick(/^ {14}profile: (\S+)[ \t]*$/m),
  }
}

// N1–N4: the identity table itself is self-consistent.
{
  const ids = ALL_PRESETS.map((p) => p.id)
  const official = new Set(PROFILES)
  const overlap = ids.filter((id) => official.has(id))
  if (ids.length === 4 && new Set(ids).size === 4 && overlap.length === 0) {
    ok('N1. four matt preset ids, unique, disjoint from the shipped presets', ids.join(', '))
  } else {
    bad('N1. preset id table', `ids=${ids.join(', ')} overlap=${overlap.join(', ')}`)
  }
  const names = new Set(ALL_PRESETS.map((p) => p.name))
  const descs = new Set(ALL_PRESETS.map((p) => p.description))
  const patchIds = new Set(ALL_PRESETS.map((p) => p.patchId))
  if (names.size === 4 && descs.size === 4 && patchIds.size === 4) {
    ok('N2. four distinct display names, descriptions and insert ids')
  } else {
    bad('N2. display copy uniqueness', `names=${names.size} descs=${descs.size} patchIds=${patchIds.size}`)
  }
  const profiles = ALL_PRESETS.map((p) => p.profile)
  if (JSON.stringify(profiles) === JSON.stringify(['standard', 'ptc', 'minimal', 'cordis'])) {
    ok('N3. mode → profile binding', profiles.join(' → '))
  } else {
    bad('N3. mode → profile binding', profiles.join(' → '))
  }
  if (JSON.stringify(ALL_PRESETS.map((p) => p.order)) === JSON.stringify([0, 1, 2, 3])) {
    ok('N4. roster order 0/1/2/3')
  } else {
    bad('N4. roster order', ALL_PRESETS.map((p) => p.order).join(','))
  }
}

// N5–N8: every declared patch file exists and matches the composed bytes.
const expected = await expectedPatches(repo)
const declared = [`./${DEFAULT_PRESET.file}`, ...PRESETS.map((p) => `./${p.file}`)]
{
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  const actual = pkg.dsh?.bundle?.patch
  if (JSON.stringify(actual) === JSON.stringify(declared)) {
    ok('N5. package.json dsh.bundle.patch lists exactly four files, default first', declared.join(' '))
  } else {
    bad('N5. dsh.bundle.patch array', `actual=${JSON.stringify(actual)} expected=${JSON.stringify(declared)}`)
  }
  if (Array.isArray(actual) && actual.length === 4) ok('N5b. the array has exactly four items')
  else bad('N5b. array length', `length=${Array.isArray(actual) ? actual.length : 'not an array'}`)
  // The whitelist is what the installer actually ships. Do NOT re-implement the
  // glob semantics here: `presets/*.patch.yml` is the entry, and lib/payload.mjs
  // (the installer's own single source of truth) owns what it expands to —
  // re-writing the rule in this file is how the two silently diverge.
  for (const rel of declared) {
    const bare = rel.replace(/^\.\//, '')
    const covered = (await Promise.all(pkg.files.map((entry) => expandEntry(repo, entry)))).flat().includes(bare)
    if (covered) ok(`N6. files whitelist expands to ${bare}`)
    else bad(`N6. files whitelist does not reach ${bare}`, `files=${JSON.stringify(pkg.files)}`)
  }
}

// N7: byte-for-byte lock, one assertion per file (a per-mode diff must name the
// file, not a single opaque failure).
for (const [rel, want] of expected) {
  let have
  try {
    have = normalize(readFileSync(join(repo, rel), 'utf8'))
  } catch (error) {
    bad(`N7. ${rel} is missing`, String(error?.message ?? error))
    continue
  }
  if (have === want) {
    ok(`N7. ${rel} matches agent.cordis.yml byte-for-byte`, `${want.length} chars, nest ${NEST.length}`)
    continue
  }
  let i = 0
  while (i < have.length && i < want.length && have[i] === want[i]) i++
  bad(
    `N7. ${rel} out of sync with agent.cordis.yml at offset ${i}`,
    `actual=${JSON.stringify(have.slice(i, i + 80))} expected=${JSON.stringify(want.slice(i, i + 80))}`,
  )
}

// N8: every mode file really carries its own profile (guards a generator
// regression that composes four identical files), read back from disk.
for (const preset of ALL_PRESETS) {
  const text = normalize(readFileSync(join(repo, preset.file), 'utf8'))
  const hit = new RegExp(`^ {14}profile: ${preset.profile}\\s*$`, 'm').test(text)
  if (hit) ok(`N8. ${preset.file} binds profile: ${preset.profile}`)
  else bad(`N8. ${preset.file} lost its profile binding`, preset.profile)
}

// N9 (the lock for this ticket's own accident): read all four declarations back
// from DISK and assert no two share a `config.id`. A second declaration of the
// same id makes the registry throw (`Duplicate agent preset: …`), which made the
// whole bundle unmountable — so this must fail mechanically, not by review.
{
  const disk = declared.map((rel) => ({ rel, ...parsePatch(rel) }))
  for (const row of disk) {
    if (row.insertId === undefined || row.presetId === undefined || row.profile === undefined) {
      bad(`N9 account. could not read the declaration back from ${row.rel}`, JSON.stringify(row))
    }
  }
  const byId = new Map()
  for (const row of disk) byId.set(row.presetId, [...(byId.get(row.presetId) ?? []), row.rel])
  const duplicates = [...byId.entries()].filter(([, files]) => files.length > 1)
  if (duplicates.length === 0) {
    ok('N9. no two patch files declare the same config.id (registry would throw)', [...byId.keys()].join(', '))
  } else {
    bad('N9. duplicate preset declaration across patch files',
      duplicates.map(([id, files]) => `${id} ← ${files.join(' + ')}`).join('; '))
  }
  const insertByKey = new Map()
  for (const row of disk) insertByKey.set(row.insertId, [...(insertByKey.get(row.insertId) ?? []), row.rel])
  const dupInserts = [...insertByKey.entries()].filter(([, files]) => files.length > 1)
  if (dupInserts.length === 0) ok('N9b. no two patch files share an insert id')
  else bad('N9b. duplicate insert id', dupInserts.map(([id, f]) => `${id} ← ${f.join(' + ')}`).join('; '))
}

// N10: `cordis.patch.yml` really is mode 1 (the default) — its declaration meta
// must read back as the ticket's first row, not merely "some preset".
{
  const row = parsePatch(`./${DEFAULT_PRESET.file}`)
  const want = { presetId: 'dsh-matt-preset', displayName: 'Matt 工作流', order: '0', profile: 'standard' }
  const got = { presetId: row.presetId, displayName: row.displayName, order: row.order, profile: row.profile }
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok('N10. cordis.patch.yml is mode 1 (default)', `id=${got.presetId} name=${got.displayName} order=${got.order} profile=${got.profile}`)
  } else {
    bad('N10. cordis.patch.yml default-mode meta', `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  }
}

// N11: the roster is DIFFERENTIATED per mode — and both directions are locked
// (#99-D). `workflow-profile-cordis.txt` tells the model to call
// `cordis_inspect_list` / `cordis_inspect_query`, but `cordis_inspect_*` is
// declared per preset: without a `tool-cordis` row on THIS mode's roster, the
// mode teaches the model a tool it cannot reach (D3, documentation that lies).
// Upstream's `cordis` preset carries the row and keeps `tool-plugin-manager`
// conditionally enabled; the other matt modes must NOT gain either.
//
// Locking only one direction would let "nobody got it" and "everybody got it"
// both pass — so this reads every carrier from disk and asserts BOTH halves.
{
  const CORDIS_CARRIER = PRESETS.find((p) => p.id === 'dsh-matt-preset-cordis')?.file
  const rowsOf = (rel) => normalize(readFileSync(join(repo, rel.replace(/^\.\//, '')), 'utf8'))
    .split('\n')
    .map((l) => l.trim())
  const hasRow = (rel, id) => rowsOf(rel).some((l) => l === `- id: ${id}`)
  const disabledValueOf = (rel, id) => {
    const lines = rowsOf(rel)
    const at = lines.findIndex((l) => l === `- id: ${id}`)
    if (at < 0) return undefined
    for (let i = at + 1; i < lines.length; i++) {
      if (/^- id: /.test(lines[i])) break
      const m = /^disabled:\s*(.+)$/.exec(lines[i])
      if (m !== null) return m[1]
    }
    return undefined
  }
  const CONDITIONAL = '!!js "!ctx.get(\'profileContext\')"'

  if (CORDIS_CARRIER === undefined) {
    bad('N11 account. no matt-cordis carrier in the identity table')
  } else {
    const cordisHasRow = hasRow(CORDIS_CARRIER, 'tool-cordis')
    const cordisDisabled = disabledValueOf(CORDIS_CARRIER, 'tool-plugin-manager')
    if (cordisHasRow && cordisDisabled === CONDITIONAL) {
      ok(`N11. ${CORDIS_CARRIER} reaches its own profile's tools`,
        `tool-cordis present; tool-plugin-manager disabled=${cordisDisabled}`)
    } else {
      bad(`N11. ${CORDIS_CARRIER} must declare tool-cordis and keep tool-plugin-manager conditional`,
        `tool-cordis=${cordisHasRow} disabled=${String(cordisDisabled)} want=${CONDITIONAL}`)
    }

    // The other direction: every OTHER carrier must stay exactly as it was.
    for (const preset of ALL_PRESETS.filter((p) => p.file !== CORDIS_CARRIER)) {
      const strayRow = hasRow(preset.file, 'tool-cordis')
      const disabled = disabledValueOf(preset.file, 'tool-plugin-manager')
      if (!strayRow && disabled === 'true') {
        ok(`N11b. ${preset.file} stays unchanged`, `no tool-cordis; tool-plugin-manager disabled=true`)
      } else {
        bad(`N11b. ${preset.file} must NOT be differentiated`,
          `tool-cordis=${strayRow} tool-plugin-manager disabled=${String(disabled)} want absent/true`)
      }
    }
  }
}

console.log('\n=== BUNDLE PATCH SYNC VERIFY (#99: four modes, default rides cordis.patch.yml) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)