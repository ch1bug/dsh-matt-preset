/**
 * verify-preset-modes.mjs — #99-C: the four matt modes as a USER-REACHABLE form.
 *
 * Why this file exists (the ticket's root cause): a previous session checked
 * that `workflow-core.mjs` registered four `PROFILES` keys, that the four delta
 * files existed and that every assertion was green — and reported "all four
 * modes are there". That is a statement about CODE CAPABILITY, not about the
 * form a user can reach. The registry ROSTER is what the mode picker lists, and
 * nothing asserted that the four modes appear in it. This suite closes that gap:
 * M6 is the actual judgement — mount-level, not a configuration-file read.
 *
 * Carrier shape (ADR-0015, Q3 plan A): the DEFAULT mode gets NO separate
 * `presets/matt.patch.yml`. `cordis.patch.yml` already carries it (same
 * `config.id: dsh-matt-preset`), and listing both would declare one id twice —
 * `agent-preset-registry/src/index.ts` throws `Duplicate agent preset: <id>` at
 * registration, so the WHOLE bundle fails to mount and every mode disappears at
 * once. The array is therefore FOUR carriers: the default plus the three
 * non-default modes. M3b is the direct lock on that failure mode.
 *
 * Assertion labels are M<n> (Mode); `G<n>` marks a precondition guard — a
 * missing artifact stops the run with a named failure instead of quietly
 * failing an AC that never ran.
 *
 * Two things this file deliberately does NOT do, both learned the hard way:
 *
 *   1. It never asserts `broken === undefined`. The full matt roster cannot
 *      activate in this harness — it needs host-plane services (workingDirectory,
 *      shell, fs, subagents, …) the mount harness does not supply — so `broken`
 *      is non-undefined BY CONSTRUCTION. Asserting undefined would be a
 *      permanently red AC that says nothing about the carriers. M6 uses the
 *      repo's existing two-layer convention instead (see `tests/verify.mjs`
 *      Track B): layer A is the strict part that must be green (declarations
 *      resolve, ids unique, all four present in the roster, profiles bound);
 *      layer B is a DIAGNOSTIC bound — every failure line must be
 *      `: waiting for <host service>`, so it may report only host-plane
 *      absence and never a carrier/declaration defect (`never started`, a
 *      module-load failure, `Duplicate agent preset`, or one of our own rows
 *      being blamed).
 *
 *   2. It never resolves an id read back off disk. Evaluating a fixed
 *      expectation table is what makes a broken id FAIL: reading the id from
 *      the file and then resolving that same value passes even after the id is
 *      corrupted (measured — the first version of the carrier's probe had
 *      exactly this hole). Every M6 id comes from EXPECTED below.
 *
 * Rows are addressed by their patch `id`, never by the row's `name`: every
 * `@deepseek-ai/dsh-agent-preset` declaration row carries
 * `name: '@deepseek-ai/dsh-agent-preset'` (the plugin it mounts), so a lookup
 * by name is identically 0 — the measured lesson from desktop REGISTRY.md.
 *
 * Roster read contract (read from upstream, NOT guessed):
 *   packages/preset/agent-preset-registry/src/preset.ts — `AgentPreset` is
 *   `{ id, name?, description?, order?, broken? }`;
 *   src/index.ts — `async list(): Promise<AgentPreset[]>`, sorted by
 *   `(order ?? Infinity)` then `id`, including activation failures (`broken`).
 *   There is NO `roster()` method; `remoteExportList()` is the Remote-wrapped
 *   alias of `list()` (it adds `isDefault`), and `resolve(id)` is the
 *   single-preset read the harness's `ensurePresetMountable` already uses.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { bootHarness, resolveLocalNames } from './preset-harness.mjs'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const lf = (s) => s.replace(/\r\n/g, '\n')
/** Entry-list YAML dialect: `!!js` scalars round-trip as `{ __jsExpr }` nodes.
 *  Same tag the harness's `parsePlugins` uses — but we deliberately do NOT run
 *  `interpolate` over the result (see `insertRowsOf`). */
const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: (str) => ({ __jsExpr: str }) }

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

/**
 * The EXPECTED four modes — the fixed table every M6 lookup is evaluated
 * against. `carrier` is the patch file that declares the mode: the default
 * rides `cordis.patch.yml`, the other three ride `presets/`.
 */
const EXPECTED = [
  { carrier: 'cordis.patch.yml', id: 'dsh-matt-preset', patchId: 'preset-dsh-matt-preset', profile: 'standard', order: 0 },
  { carrier: 'presets/matt-ptc.patch.yml', id: 'dsh-matt-preset-ptc', patchId: 'preset-dsh-matt-preset-ptc', profile: 'ptc', order: 1 },
  { carrier: 'presets/matt-minimal.patch.yml', id: 'dsh-matt-preset-minimal', patchId: 'preset-dsh-matt-preset-minimal', profile: 'minimal', order: 2 },
  { carrier: 'presets/matt-cordis.patch.yml', id: 'dsh-matt-preset-cordis', patchId: 'preset-dsh-matt-preset-cordis', profile: 'cordis', order: 3 },
]
/** The modes carried by `presets/` (everything but the default carrier). */
const PRESET_CARRIERS = EXPECTED.filter(m => m.carrier.startsWith('presets/'))
/** The official four the runtime's own preset patches declare
 *  (display.ts BUILT_IN_PRESET_KEYS). They must SURVIVE our declarations. */
const OFFICIAL_IDS = ['standard', 'ptc', 'minimal', 'cordis']
const DECLARATION_NAME = '@deepseek-ai/dsh-agent-preset'
/** The plugin rows THIS REPO adds. A harness failure must never name one of
 *  them — that would mean the carrier is broken, not the harness incomplete. */
const MY_ROWS = ['workflow-core', 'workflow-enforcer', 'lang-enforcer', 'handoff-tool']

// ── guard: the manifest this suite reads must be the shipped one ────────────
const pkg = (() => {
  try { return JSON.parse(readFileSync(REPO + '/package.json', 'utf8')) } catch { return null }
})()
if (pkg === null) {
  bad('G1. package.json parses')
  report('PRESET MODES VERIFY (#99-C)')
}

/** A patch file's parsed top-level `insert` rows, or null when unreadable.
 *  A bundle patch document is a list of patch operations (`- insert: [...]`),
 *  so the declaration rows live one level down.
 *
 *  Read WITHOUT evaluating `!!js` expressions (#99, measured). These cases judge
 *  the SHAPE of the declaration — "this carrier declares exactly this one
 *  preset" — which is a property of the document, not of whether an expression
 *  can be evaluated in a test process. The harness's `parsePlugins` calls the
 *  loader's `interpolate`, whose ctx is `{ baseUrl, process }` — NOT a Context —
 *  so any row using `ctx.get(...)` (e.g. the upstream-shaped
 *  `disabled: !!js "!ctx.get('profileContext')"`) throws `ctx.get is not a
 *  function` there. That expression is legal and meaningful in production, where
 *  the loader passes the plugin row's real Context.
 *
 *  Corroboration that this is a reader limitation, not a carrier defect:
 *  upstream's OWN `web-app/presets/cordis.patch.yml` throws the same way under
 *  `parsePlugins` — the shipped official cordis preset is equally unreadable
 *  through that path. So `matt-cordis` is homomorphic with upstream here, and
 *  the fix belongs in the reader.
 *
 *  The `jsTag` below is the same dialect `parsePlugins` uses; it keeps `!!js`
 *  scalars as `{ __jsExpr }` nodes instead of resolving them. */
const insertRowsOf = (rel) => {
  try {
    const ops = parse(readFileSync(REPO + '/' + rel, 'utf8'), { customTags: [JS_TAG] })
    return ops.flatMap(op => op?.insert ?? [])
  } catch { return null }
}

// ── M1: the bundle declares an ARRAY of four carriers, in the fixed order ───
const declared = pkg.dsh?.bundle?.patch
const WANT_PATCHES = EXPECTED.map(m => './' + m.carrier)
if (Array.isArray(declared) && JSON.stringify(declared) === JSON.stringify(WANT_PATCHES))
  ok('M1. dsh.bundle.patch is an array of exactly four carriers in the fixed order', declared.join(', '))
else bad('M1. dsh.bundle.patch', `got ${JSON.stringify(declared)} want ${JSON.stringify(WANT_PATCHES)}`)

// Also assert the three presets/* carriers actually SHIP: a declared carrier
// that never reaches the installed bundle is the same unreachable-mode failure
// one layer down. Coverage is checked with the INSTALLER'S OWN rule
// (lib/payload.mjs `payloadOf` — installTo copies exactly those entries), not
// by matching `files` literals: the repo ships `presets/*.patch.yml` as a GLOB
// and #66 made a glob expand correctly, so a literal-entry assertion would be
// red against a correct manifest.
const { entries: payloadEntries } = await import('../lib/payload.mjs')
  .then(m => m.payloadOf(REPO)).catch(() => ({ entries: null }))
if (payloadEntries === null) bad('M1. lib/payload.mjs payloadOf() runs')
else {
  const unshipped = PRESET_CARRIERS.map(m => m.carrier).filter(f => !payloadEntries.includes(f))
  if (unshipped.length === 0)
    ok('M1. every presets/* carrier is covered by the installer payload rule', PRESET_CARRIERS.map(m => m.carrier).join(', '))
  else bad('M1. payload coverage', `not covered: ${unshipped.join(', ')}`)
}

// ── M2: each carrier parses to EXACTLY one declaration row ─────────────────
// Row identity is the patch `id` (Host Inspect's `patchId`, e.g.
// `preset-dsh-matt-preset-cordis`) — NOT `name`, which is the PLUGIN
// (`@deepseek-ai/dsh-agent-preset`) on every row of every carrier and therefore
// cannot identify a mode. The same key/label pairing is what
// tests/verify-bundle-sync.mjs asserts as N2/N9b.
const carriers = new Map()
for (const mode of EXPECTED) {
  const rows = insertRowsOf(mode.carrier)
  if (rows === null) { bad(`M2. ${mode.carrier} parses as a patch document`); continue }
  const declarations = rows.filter(r => r?.name === DECLARATION_NAME)
  if (declarations.length !== 1) {
    bad(`M2. ${mode.carrier} holds exactly one ${DECLARATION_NAME} row`, `found ${declarations.length} of ${rows.length} rows`)
    continue
  }
  // The row must BE the mode: its patchId is the mode's own, so a carrier that
  // parses cleanly but declares the WRONG mode is caught here rather than
  // passing on "exactly one row" alone.
  const row = declarations[0]
  if (row.id === mode.patchId) {
    ok(`M2b. ${mode.carrier} declares patchId ${mode.patchId}`, `name=${row.name} config.id=${row.config?.id}`)
  } else {
    bad(`M2b. ${mode.carrier} patchId`, `got ${JSON.stringify(row.id)} want ${mode.patchId}`)
  }
  carriers.set(mode.id, { mode, declaration: row, config: row.config ?? {} })
}
if (carriers.size === EXPECTED.length)
  ok('M2. each of the four carriers holds exactly one agent-preset declaration',
    EXPECTED.map(m => `${m.carrier}→${m.id}`).join(', '))
else {
  bad('G2. all four declarations parsed', `${carriers.size}/${EXPECTED.length}`)
  report('PRESET MODES VERIFY (#99-C)')
}
const all = EXPECTED.map(m => carriers.get(m.id))

// ── M3: ids are exactly the matt four; pairwise unique; disjoint from official
const gotIds = all.map(p => p.config.id)
const idSet = new Set(gotIds)
if (idSet.size === EXPECTED.length && EXPECTED.every(m => idSet.has(m.id)))
  ok('M3a. the four config.ids are exactly the matt four', [...idSet].sort().join(', '))
else bad('M3a. matt config.ids', `got ${JSON.stringify(gotIds)} want ${JSON.stringify(EXPECTED.map(m => m.id))}`)

// The duplicate-id lock. Two declarations sharing one id are not "an extra
// mode": `register()` throws `Duplicate agent preset: <id>` and the whole
// bundle fails to mount, so every mode disappears at once. This is the exact
// defect plan A fixed (calling out a second carrier for the default id).
const dupIds = gotIds.filter((id, i) => gotIds.indexOf(id) !== i)
if (dupIds.length === 0)
  ok('M3b. the four config.ids are pairwise unique (a duplicate makes the registry throw and the whole bundle unmount)')
else bad('M3b. duplicate config.ids', `${[...new Set(dupIds)].join(', ')} declared more than once`)

const overlap = OFFICIAL_IDS.filter(id => idSet.has(id))
if (overlap.length === 0)
  ok('M3c. no matt id collides with the official four (official modes survive, not overridden)', OFFICIAL_IDS.join(', '))
else bad('M3c. official id collision', overlap.join(', '))

// ── M4: names and descriptions are pairwise distinct ───────────────────────
const names = all.map(p => p.config.name)
const descriptions = all.map(p => p.config.description)
console.log('\n  · the four published name/description pairs:')
for (const p of all) console.log(`      ${p.config.id}  [order ${p.config.order}]  ${p.config.name} — ${p.config.description}`)

if (names.every(n => typeof n === 'string' && n !== '') && new Set(names).size === EXPECTED.length)
  ok('M4a. the four display names are non-empty and pairwise distinct', names.join(' | '))
else bad('M4a. display names', JSON.stringify(names))

if (descriptions.every(d => typeof d === 'string' && d !== '') && new Set(descriptions).size === EXPECTED.length)
  ok('M4b. the four descriptions are non-empty and pairwise distinct', `${descriptions.map(d => d.length).join('/')} chars`)
else bad('M4b. descriptions', JSON.stringify(descriptions))

// ── M5: each carrier's core row profile matches; rosters share one baseline ─
// The four rosters are the SAME matt roster with per-mode differences applied
// (ADR-0015 §4). Today exactly one mode differs — `matt-cordis` adds
// `tool-cordis` — so the assertion is "three share one length, and the differing
// one is exactly one row longer", not "all four are equal" (which Q4 made false)
// and not "any lengths at all" (which would be no assertion).
const lengths = []
const orderSeen = []
for (const p of all) {
  const plugins = p.config.plugins
  const core = Array.isArray(plugins) ? plugins.find(r => r?.id === 'workflow-core') : undefined
  const profile = core?.config?.profile
  lengths.push(Array.isArray(plugins) ? plugins.length : -1)
  orderSeen.push(p.config.order)
  if (profile === p.mode.profile)
    ok(`M5. ${p.config.id} mounts workflow-core with profile: ${p.mode.profile}`)
  else bad(`M5. ${p.config.id} profile`, `got ${JSON.stringify(profile)} want ${JSON.stringify(p.mode.profile)}`)
}

// Three modes share the baseline length; `matt-cordis` carries the one extra
// `tool-cordis` row ADR-0015 §4 requires. Both halves are asserted so neither
// "nobody is differentiated" nor "everybody is" passes.
const CORDIS_INDEX = EXPECTED.findIndex(m => m.id === 'dsh-matt-preset-cordis')
const baselineLengths = lengths.filter((_, i) => i !== CORDIS_INDEX)
const baselineOk = baselineLengths.length === EXPECTED.length - 1
  && baselineLengths.every(n => n === baselineLengths[0]) && baselineLengths[0] > 0
const cordisLength = lengths[CORDIS_INDEX]
if (baselineOk && cordisLength === baselineLengths[0] + 1)
  ok('M5. three modes share one roster baseline; matt-cordis adds exactly one row (its tool-cordis)',
    `${baselineLengths[0]} rows ×3 + ${cordisLength} rows for matt-cordis`)
else bad('M5. roster lengths', `${JSON.stringify(lengths)} (want three equal + cordis exactly one more)`)

// Order drives the picker's sequence (the registry sorts by it): default 0 then
// 1/2/3 keeps the four matt modes contiguous and in ADR-0015's order.
const wantOrders = EXPECTED.map(m => m.order)
if (JSON.stringify(orderSeen) === JSON.stringify(wantOrders))
  ok('M5. the four modes carry orders 0/1/2/3 (one contiguous group in the picker)', orderSeen.join(', '))
else bad('M5. mode orders', `got ${JSON.stringify(orderSeen)} want ${JSON.stringify(wantOrders)}`)

// ── M6: mount-level — the four modes are visible in the ROSTER ─────────────
// The point of the ticket: a declaration that parses is not a mode a user can
// pick. `list()` is what the roster surface reads, so that is what is asserted.
//
// Why the roster is read through `resolve()`/`list()` and NOT through
// `ensurePresetMountable` (measured, Lead-reproduced): the full matt roster can
// never mount in this harness — `ensurePresetMountable` throws on it, and two of
// its lines are non-`waiting-for` (`tool-jobs`: ctx.jobs.events.subscribe is not
// a function; `tool-subagent`: modelSelectionSettings needs
// model-selection-settings in the Host scope). The PRE-#99 single-patch carrier
// produces the identical two lines, so this is a HARNESS limitation, not
// something #99 introduced — using that helper as the gate here would be a
// permanently red AC that says nothing about the carriers. The `resolve()` face
// is the one that separates a CARRIER defect from host-plane absence, which is
// exactly the evidence this ticket needs. (Teaching the harness a deeper jobs
// stub and a model-selection-settings provider is a harness fix for another
// day; M6d/M6e below bound the failure instead.)
//
// Each declaration is mounted as the RUNTIME sees it: the `plugins` rows first
// get `resolveLocalNames` (production spells them `dsh-matt-preset/x.mjs`;
// without the rewrite the loader blames every row for `never started`, which
// would be a FALSE carrier defect — pinning the assertion to the wrong cause).
const mounted = all.map(p => ({
  ...p.config,
  plugins: resolveLocalNames(p.config.plugins, REPO),
}))
const ctx = await bootHarness([])
// The official four are simulated so the "they survive alongside ours" AC is
// exercised in one roster, not asserted from a different run.
const officials = OFFICIAL_IDS.map(id => ({ id, order: 1, plugins: [] }))
for (const decl of [...mounted, ...officials]) {
  try { await ctx.plugin(AgentPreset, decl) } catch (e) { bad(`M6. register ${decl.id}`, String(e?.message ?? e)) }
}

// Ids here come from EXPECTED, never from what was read off disk: resolving a
// value echoed back from the file would pass even with the id corrupted.
const mattIds = EXPECTED.map(m => m.id)
const roster = await ctx.agentPresets.list()
const byId = new Map(roster.map(r => [r.id, r]))
console.log(`\n  · roster ids (${roster.length}): ${roster.map(r => r.id).join(', ')}`)

// Layer A (strict): the declaration resolves at all — an unknown id or a
// failed registration throws here rather than appearing as `broken`.
const resolveThrew = []
const resolved = new Map()
for (const id of [...mattIds, ...OFFICIAL_IDS]) {
  try { resolved.set(id, await ctx.agentPresets.resolve(id)) } catch (e) { resolveThrew.push(`${id}: ${e?.message ?? e}`) }
}
if (resolveThrew.length === 0)
  ok('M6a. every one of the eight declared ids resolves (no unknown/duplicate declaration)', `${mattIds.length} matt + ${OFFICIAL_IDS.length} official`)
else bad('M6a. resolve threw', resolveThrew.join(' | '))

// Layer A (strict): every EXPEXTED matt id is actually IN the roster.
const absent = mattIds.filter(id => !byId.has(id))
if (absent.length === 0) ok('M6b. all four matt modes are listed in the roster', mattIds.join(', '))
else bad('M6b. missing from roster', absent.join(', '))

// Layer A (strict): the official four survive next to ours.
const goneOfficials = OFFICIAL_IDS.filter(id => !byId.has(id))
if (goneOfficials.length === 0 && roster.length === mattIds.length + OFFICIAL_IDS.length)
  ok('M6c. the official four are still in the roster alongside the matt four', `${roster.length} rows`)
else bad('M6c. official survival', `missing ${goneOfficials.join(', ') || 'none'}; roster=${roster.length}`)

// Layer B (diagnostic bound): a non-undefined `broken` is EXPECTED here — the
// harness lacks host-plane services. What must hold is that every line reports
// host absence, and that none of OUR rows is blamed for a carrier defect.
const layerB = []
const clean = []
for (const id of mattIds) {
  const broken = resolved.get(id)?.broken
  if (broken === undefined) { clean.push(id); continue }
  const lines = broken.split('\n')
  const notWaiting = lines.filter(l => !/: waiting for /.test(l))
  const blamed = MY_ROWS.filter(row => broken.includes(row))
  if (notWaiting.length === 0 && blamed.length === 0) layerB.push(id)
  else bad(`M6d. ${id} reports only host-plane absence`,
    `non-"waiting for" lines: ${notWaiting.join(' | ') || 'none'}; blamed rows: ${blamed.join(', ') || 'none'}`)
}
if (layerB.length + clean.length === mattIds.length)
  ok('M6d. all four matt rows fail ONLY on harness-missing host services (no carrier defect named)',
    clean.length > 0 ? `${clean.length} activated clean; rest: waiting-for only` : `all ${layerB.length} report ": waiting for <host service>" only`)

// The failure really is the host plane, not a mounting accident. `waiting for`
// is the registry's audit of ROW ACTIVATION, so a service name here means "the
// row declaring it has not finished", which is ordinary for a row whose own
// dependencies are missing. The invariant is therefore about the ROOT realm:
// the harness must never have been able to stub the services a row PROVIDES
// (SELF_PROVIDED in preset-harness.mjs) — a stubbed `workflowEngine` /
// `ptcRuntime` would make the real provider's registration collide, which is
// exactly the regression #88/#89 documented. So: after the mounts, neither is
// a function-shaped inert stub sitting in the root context.
if (layerB.length > 0) {
  const sample = resolved.get(layerB[0]).broken
  const services = [...new Set([...sample.matchAll(/waiting for ([^\n]+)/g)].flatMap(m => m[1].split(',').map(s => s.trim())))]
  const HOST_PLANE = ['workingDirectory', 'shell', 'shellEnv', 'fs', 'jobs', 'skills', 'goals', 'userQuestions', 'web', 'subagents', 'sandboxPolicy']
  const hostReported = HOST_PLANE.filter(s => services.includes(s))
  if (services.length > 0 && hostReported.length > 0)
    ok('M6e. the missing services are host-plane ones (the harness has no host stack, the carriers do not defect)',
      `${hostReported.join(', ')}${services.length > hostReported.length ? ` + ${services.length - hostReported.length} more` : ''}`)
  else bad('M6e. missing services', `no host-plane service reported; services=${services.join(', ') || 'none'}`)

  // The self-provided pair must be supplied by their OWNING rows, never by a
  // harness stub that would collide with the real provider (#88/#89).
  const stubbed = []
  for (const svc of ['workflowEngine', 'ptcRuntime']) {
    const got = ctx.get(svc)
    // An inertService() is a Proxy over an empty target: no own keys at all.
    if (got !== undefined && Object.getOwnPropertyNames(Object.getPrototypeOf(got) ?? {}).length === 0 &&
        Object.keys(got).length === 0) stubbed.push(svc)
  }
  if (stubbed.length === 0)
    ok('M6e2. neither self-provided service was inert-stubbed into the root realm (no provider collision)', 'workflowEngine, ptcRuntime')
  else bad('M6e2. self-provided service stubbed', stubbed.join(', '))
}

// The roster must carry the decided copy through, not just the ids: a row
// without name/description does not satisfy the "naming and blurbs" AC.
const copyMissing = mattIds.filter(id => {
  const row = byId.get(id)
  return typeof row?.name !== 'string' || typeof row?.description !== 'string'
})
if (copyMissing.length === 0)
  ok('M6f. each matt roster row carries its own name + description', mattIds.map(id => byId.get(id).name).join(' | '))
else bad('M6f. roster copy', copyMissing.join(', '))

// The roster's own order is the picker's order — assert the ADR-0015 sequence
// rather than trusting the manifest's `order` fields alone.
const mattRosterOrder = roster.filter(r => mattIds.includes(r.id)).map(r => r.id)
if (JSON.stringify(mattRosterOrder) === JSON.stringify(mattIds))
  ok('M6g. the roster lists the four matt modes in the declared order', mattRosterOrder.join(' → '))
else bad('M6g. roster order', `${mattRosterOrder.join(', ')} want ${mattIds.join(', ')}`)

// ── M7: the injected TEXT really differs per profile (a mode is not a label) ─
const core = await import(pathToFileURL(REPO + '/workflow-core.mjs').href)
const bodies = {}
for (const m of EXPECTED) bodies[m.profile] = lf(await core.profileBody(m.profile))
const countOf = (hay, needle) => hay.split(needle).length - 1
const GATE_BLOCK = core.parseSections(lf(readFileSync(REPO + '/workflow-body.txt', 'utf8')))
  .sections.find(s => s.id === 'workflow-enforcement')?.text ?? ''
const GATE_ANCHORS = ['ENTRY ROUTING', 'IMPLEMENT GATE', 'DECISION BOUNDARY', 'PHASE DECLARATION',
  'ONE ISSUE PER SESSION', 'EXTERNAL-ACTION GATE', 'TICKET EXIT']

const minLen = bodies.minimal.length
const stdLen = bodies.standard.length
console.log(`\n  · body sizes: ${EXPECTED.map(m => `${m.profile}=${bodies[m.profile].length}`).join(', ')}`)
if (minLen < stdLen * 0.5)
  ok('M7a. minimal is under half of standard', `${minLen} / ${stdLen} = ${(minLen / stdLen * 100).toFixed(1)}%`)
else bad('M7a. minimal size', `${minLen} / ${stdLen} = ${(minLen / stdLen * 100).toFixed(1)}% (want <50%)`)

if (bodies.cordis.includes('CREATOR CONTEXT'))
  ok('M7b. the cordis mode injects its CREATOR CONTEXT framing')
else bad('M7b. cordis framing', 'CREATOR CONTEXT absent')

if (bodies.ptc.includes('run_code'))
  ok('M7c. the ptc mode injects the program-first surface (run_code present)')
else bad('M7c. ptc surface', 'run_code absent')

// D41's mechanical guarantee: the seven-gate block lives in exactly ONE place,
// so every mode must carry it exactly once, byte-identical.
const gateCopies = EXPECTED.map(m => `${m.profile}=${countOf(bodies[m.profile], GATE_BLOCK)}`)
const gateGone = EXPECTED.filter(m => !GATE_ANCHORS.every(a => bodies[m.profile].includes(a))).map(m => m.profile)
if (gateCopies.every(s => s.endsWith('=1')) && gateGone.length === 0)
  ok('M7d. the seven-gate block appears exactly once in all four modes', gateCopies.join(', '))
else bad('M7d. gate block', `${gateCopies.join(', ')}; missing anchors in ${gateGone.join(', ') || 'none'}`)

// ── M8: every mode profile is registered in the plugin's PROFILES map ──────
const missingProfile = EXPECTED.filter(m => core.PROFILES[m.profile] === undefined).map(m => m.profile)
if (missingProfile.length === 0)
  ok('M8. all four mode profiles are registered in workflow-core PROFILES', Object.keys(core.PROFILES).join(', '))
else bad('M8. PROFILES keys', `missing: ${missingProfile.join(', ')}`)

// ── M9: the red-line shape — ONE bundle link carries all FOUR modes ────────
// ADR-0015 §4 / the ticket's hard constraint: "装一次全有、卸一次全清".
// This is the mechanical half of that AC: every mode's carrier is resolved by
// the SAME package (so one profile link supplies them all), and dropping that
// one package drops every mode at once. The behavioural half — the profile
// actually losing all four after `uninstall` — is the batch-end human item
// (docs/RELEASE.md §桌面端), because it needs a real DSH profile; what can be
// proven here is that no mode is reachable through any OTHER channel.
const bundleName = pkg.name
// (a) every declared carrier is package-relative — none points outside the one
//     bundle, so no mode has an install path of its own.
const outsideBundle = declared.filter(f => !f.startsWith('./'))
if (outsideBundle.length === 0)
  ok('M9a. every carrier lives inside the one bundle (no mode has its own install path)', `${declared.length} carriers in ${bundleName}`)
else bad('M9a. carriers outside the bundle', outsideBundle.join(', '))

// (b) the package declares exactly ONE install unit: one name, one bin, one
//     bundle entry. A second `dsh.bundle` or a second bin would be the
//     "four independently installable packages" the red line forbids.
const binCount = Object.keys(pkg.bin ?? {}).length
const bundleEntries = pkg.dsh?.bundle === undefined ? 0 : 1
if (binCount === 1 && bundleEntries === 1 && typeof bundleName === 'string' && bundleName !== '')
  ok('M9b. exactly one install unit: one package name, one bin, one dsh.bundle', `${bundleName} / ${binCount} bin / ${bundleEntries} bundle`)
else bad('M9b. install-unit shape', `name=${bundleName} bins=${binCount} bundles=${bundleEntries}`)

// (c) the four modes share ONE carrier chain: they are inserted by patch files
//     of the same bundle, not by four separately-versioned sources. Asserted
//     structurally — all four carriers are listed in the SAME array.
if (new Set(declared).size === declared.length && declared.length === EXPECTED.length)
  ok('M9c. the four modes ride ONE patch array (no second declaration channel)', declared.join(', '))
else bad('M9c. patch array shape', `unique=${new Set(declared).size} declared=${declared.length}`)

report('PRESET MODES VERIFY (#99-C: roster reachability + per-mode injection)')