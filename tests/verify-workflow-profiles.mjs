/**
 * verify-workflow-profiles.mjs — #55: profile mechanism + creative profile.
 *
 * The #54 plugin carried ONE workflow body (workflow-body.txt). #55 splits it
 * into a SHARED SKELETON (workflow-body.txt, sectioned by `@@ <id>` markers)
 * plus PER-PROFILE DELTA files (workflow-profile-<name>.txt):
 *
 *   - a delta section whose id matches a skeleton section REPLACES that
 *     section (override);
 *   - a new id is INSERTED with `@@ <id> after=<anchor>` (or appended when no
 *     anchor is given) — so a profile adapts the workflow without copying a
 *     single word of the shared text.
 *   - `standard` has no delta at all: it is the skeleton verbatim.
 *
 * Seams under test (public, not internals):
 *   1. module exports — profileBody / parseSections / composeSections /
 *      joinSections / PROFILES / DEFAULT_PROFILE (offline mechanism checks);
 *   2. the injection surface — agentPresets.mount → systemPrompt.assemble →
 *      renderPrompt (what the model actually reads), with the workflow-core
 *      plugin mounted by a synthetic creator preset.
 *
 * AC1: `profile: standard` is BYTE-IDENTICAL to the ticket-1 baseline
 *      (tests/fixtures/workflow-body-v1.txt — the #54 body, captured from
 *      this working tree BEFORE the restructure, so the freeze survives this
 *      commit landing; ADR-0010 precedent).
 * AC2: `profile: creative` injects the adapted text under a creator preset,
 *      with the seven gates present and unmodified in wording.
 * AC3: the delta structure duplicates no workflow section between profiles —
 *      the seven gates are edited in exactly one place (the skeleton).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { bootHarness } from './preset-harness.mjs'
import { expandEntry } from '../lib/payload.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const lf = (s) => s.replace(/\r\n/g, '\n')

/** The ticket-1 baseline: the #54 workflow body, frozen (LF — what the plugin injects). */
const BASELINE = lf(readFileSync(new URL('./fixtures/workflow-body-v1.txt', import.meta.url), 'utf8'))
/** The sectioned shared skeleton on disk (markers still in place). */
const SECTIONED = lf(readFileSync(REPO + '/workflow-body.txt', 'utf8'))
const PKG = JSON.parse(readFileSync(REPO + '/package.json', 'utf8'))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

/** First-divergence locator, so a red AC1 says WHERE it drifted. */
function divergence(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return `first divergence at ${i}: expected ${JSON.stringify(b.slice(i, i + 90))} got ${JSON.stringify(a.slice(i, i + 90))} (len ${a.length} vs ${b.length})`
}

// ── module seam ─────────────────────────────────────────────────────────────
let core
try {
  core = await import(pathToFileURL(REPO + '/workflow-core.mjs').href)
} catch (error) {
  bad('M. workflow-core.mjs imports', String(error?.message ?? error))
  report('WORKFLOW-PROFILES VERIFY')
}

const seam = ['profileBody', 'parseSections', 'composeSections', 'joinSections', 'PROFILES', 'DEFAULT_PROFILE']
const missingSeam = seam.filter(k => core[k] === undefined)
if (missingSeam.length === 0) ok('M. workflow-core.mjs exposes the profile seam', seam.join(', '))
else {
  bad('M. workflow-core.mjs exposes the profile seam', `missing: ${missingSeam.join(', ')}`)
  report('WORKFLOW-PROFILES VERIFY (mechanism + AC1)')
}

if (core.DEFAULT_PROFILE === 'standard') ok('P1. default profile is standard')
else bad('P1. default profile', String(core.DEFAULT_PROFILE))

if (Object.hasOwn(core.PROFILES ?? {}, 'standard') && Object.hasOwn(core.PROFILES ?? {}, 'creative'))
  ok('P2. profiles registered', Object.keys(core.PROFILES).join(', '))
else bad('P2. profiles registered', JSON.stringify(core.PROFILES))

// ── AC1: standard == ticket-1 baseline (verbatim) ────────────────────────────
const standard = await core.profileBody('standard')
if (standard === BASELINE) ok('AC1. profile: standard verbatim-identical to the ticket-1 baseline', `${standard.length} chars`)
else bad('AC1. profile: standard vs baseline', divergence(standard, BASELINE))

if (!standard.includes('@@')) ok('AC1b. section markers never reach the injected text')
else bad('AC1b. section markers leaked into the injected text')

// The mechanism must actually strip something: the on-disk file is sectioned.
if (SECTIONED !== BASELINE && SECTIONED.includes('@@')) ok('S1. the on-disk body carries section markers (standard strips them)')
else bad('S1. sectioned skeleton', 'workflow-body.txt is not sectioned')

// ── mechanism seam: parse → compose → join ──────────────────────────────────
const parsed = core.parseSections(SECTIONED)
const ids = parsed.sections.map(s => s.id)
if (parsed.sections.length >= 10 && new Set(ids).size === ids.length)
  ok('S2. shared skeleton declares unique sections', `${ids.length}: ${ids.join(', ')}`)
else bad('S2. skeleton sections unique', JSON.stringify(ids))

if (core.joinSections(parsed.sections, parsed.trailingNewline) === BASELINE)
  ok('S3. skeleton format is lossless (markers strip back to the baseline bytes)')
else bad('S3. lossless rejoin', divergence(core.joinSections(parsed.sections, parsed.trailingNewline), BASELINE))

const mainBody = parsed.sections.find(s => s.id === 'main-flow')?.text ?? ''
const overridden = core.composeSections(parsed.sections, [{ id: 'main-flow', after: null, text: 'OVERRIDE MAIN FLOW' }])
const overriddenText = core.joinSections(overridden, true)
if (overriddenText.includes('OVERRIDE MAIN FLOW') && !overriddenText.includes(mainBody) && overridden.length === parsed.sections.length)
  ok('M1. an id-matching delta section REPLACES the skeleton section (no duplicate left behind)')
else bad('M1. override semantics', `containsOverride=${overriddenText.includes('OVERRIDE MAIN FLOW')} skeletonLeft=${overriddenText.includes(mainBody)} count=${overridden.length}`)

const inserted = core.composeSections(parsed.sections, [
  { id: 'probe-a', after: 'main-flow', text: 'PROBE A' },
  { id: 'probe-b', after: 'main-flow', text: 'PROBE B' },
])
const insertedIds = inserted.map(s => s.id)
if (insertedIds.indexOf('probe-a') === insertedIds.indexOf('main-flow') + 1 &&
    insertedIds.indexOf('probe-b') === insertedIds.indexOf('probe-a') + 1)
  ok('M2. `after=<anchor>` inserts at the anchor and keeps delta order (two inserts, one anchor)')
else bad('M2. insert-after order', insertedIds.join(', '))

let anchorThrew = false
try { core.composeSections(parsed.sections, [{ id: 'x', after: 'nope', text: 'x' }]) } catch { anchorThrew = true }
if (anchorThrew) ok('M3. an anchor naming an unknown section throws (loud, never silent misplacement)')
else bad('M3. unknown anchor', 'composeSections accepted an unknown anchor')

// Unknown profile name must never cost the session its workflow text.
const fallback = await core.profileBody('does-not-exist')
if (fallback === BASELINE) ok('M4. unknown profile falls back to standard (workflow text never lost)')
else bad('M4. unknown profile fallback', divergence(fallback, BASELINE))

// ── packaging contract: the deltas ship with the plugin ─────────────────────
// Coverage is checked with the INSTALLER'S OWN rule (lib/payload.mjs) rather
// than a hand-rolled scan, so it stays true if #66 teaches expandEntry to
// handle file-name globs. The general "no entry may resolve to nothing" guard
// is tests/verify-payload-manifest.mjs (offline — the #55 near-miss: a
// `workflow-profile-*.txt` entry looked right and shipped nothing).
const shippedDeltas = readdirSync(REPO).filter(f => /^workflow-profile-.+\.txt$/.test(f))
if (shippedDeltas.includes('workflow-profile-creative.txt'))
  ok('P3. creative delta file exists next to the plugin')
else bad('P3. creative delta file', `found: ${shippedDeltas.join(', ') || 'none'}`)

const covered = new Set((await Promise.all(PKG.files.map(entry => expandEntry(REPO, entry)))).flat())
const uncovered = shippedDeltas.filter(f => !covered.has(f))
if (shippedDeltas.length > 0 && uncovered.length === 0)
  ok('P4. every shipped delta is covered by the payload rule (installer expandEntry)', shippedDeltas.join(', '))
else bad('P4. payload coverage', uncovered.length > 0 ? `not covered: ${uncovered.join(', ')}` : 'no delta files found')

// ── AC3: the delta structure duplicates nothing ─────────────────────────────
// (Mechanism-level, independent of the render: compose the shipped creative
// delta onto the skeleton and count bodies. A profile that copied a shared
// section would show the skeleton body twice — or leave the skeleton body
// behind an override.)
const CREATIVE_DELTA_RAW = lf(readFileSync(REPO + '/workflow-profile-creative.txt', 'utf8'))
const delta = core.parseSections(CREATIVE_DELTA_RAW)
const skeletonIds = ids
const deltaIds = delta.sections.map(s => s.id)
const creativeSections = core.composeSections(parsed.sections, delta.sections)
const creativeText = core.joinSections(creativeSections, parsed.trailingNewline)
const countOf = (haystack, needle) => (needle === '' ? 0 : haystack.split(needle).length - 1)

const composedIds = creativeSections.map(s => s.id)
if (new Set(composedIds).size === composedIds.length)
  ok('AC3a. composed creative sections carry unique ids', `${composedIds.length} sections`)
else bad('AC3a. composed ids unique', JSON.stringify(composedIds))

const shadowed = skeletonIds.filter(id => countOf(creativeText, parsed.sections.find(s => s.id === id).text) !== 1)
if (shadowed.length === 0) ok('AC3b. every shared section appears exactly once (override or untouched — never both)')
else bad('AC3b. shared sections duplicated/shadowed', shadowed.join(', '))

const deltaBodiesUnique = deltaIds.filter(id => countOf(creativeText, delta.sections.find(s => s.id === id).text) !== 1)
if (deltaBodiesUnique.length === 0) ok('AC3c. every delta section appears exactly once', deltaIds.join(', '))
else bad('AC3c. delta sections', deltaBodiesUnique.join(', '))

const gateSection = parsed.sections.find(s => s.id === 'workflow-enforcement')
if (!CREATIVE_DELTA_RAW.includes(gateSection.text))
  ok('AC3d. the seven-gate block is not copied into the creative delta (one place to edit)')
else bad('AC3d. creative delta copies the gate block')

const offSkeleton = deltaIds.filter(id => !skeletonIds.includes(id))
if (deltaIds.length === offSkeleton.length)
  ok('AC3e. the creative profile ADDS sections and rewrites none', offSkeleton.join(', '))
else bad('AC3e. creative profile rewrites a shared section', deltaIds.filter(id => skeletonIds.includes(id)).join(', '))

// ── AC2: creative mounts under a creator preset (model-facing surface) ──────
const CORE = pathToFileURL(REPO + '/workflow-core.mjs').href
const GATE_ANCHORS = ['ENTRY ROUTING', 'IMPLEMENT GATE', 'DECISION BOUNDARY', 'PHASE DECLARATION',
  'ONE ISSUE PER SESSION', 'EXTERNAL-ACTION GATE', 'TICKET EXIT']
const plain = 'You are a plain agent.'
const personaRow = (prefix) => ({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix } })
const corePlugin = (config) => ({ id: 'workflow-core', name: CORE, ...(config === undefined ? {} : { config }) })
const ctx = await bootHarness([
  { id: 'creator', plugins: [personaRow('You are a creator agent powered by {{model}}, working in {{cwd}}.'), corePlugin({ profile: 'creative', scope: 'all' })] },
  { id: 'creator-markerless', plugins: [personaRow(plain), corePlugin({ profile: 'creative' })] },
  { id: 'standard-explicit', plugins: [personaRow(plain), corePlugin({ profile: 'standard', scope: 'all' })] },
  { id: 'standard-default', plugins: [personaRow(plain), corePlugin({ scope: 'all' })] },
  { id: 'text-override', plugins: [personaRow(plain), corePlugin({ profile: 'creative', scope: 'all', text: 'CUSTOM {{model}} on {{cwd}}.' })] },
])
const render = async (id, cwd, model) => {
  const handle = await ctx.agents.create({
    sessionId: SessionId('wp-' + id),
    meta: { cwd },
    agentOptions: { provider: 'mock', model },
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, id),
  })
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, new AbortController().signal))
  const text = renderPrompt(assembly)
  await handle.dispose()
  return text
}

const creatorText = await render('creator', '/tmp/wp-creator-cwd', 'creator-model')
const heading = (id) => delta.sections.find(s => s.id === id).text.split('\n')[0]
const missingAdaptations = offSkeleton.filter(id => !creatorText.includes(heading(id)))
if (missingAdaptations.length === 0) ok('AC2a. the creator preset receives the adapted sections', offSkeleton.map(heading).join(' / '))
else bad('AC2a. adapted sections in the injected text', `missing: ${missingAdaptations.join(', ')}`)

const missingGates = GATE_ANCHORS.filter(anchor => !creatorText.includes(anchor))
if (missingGates.length === 0) ok('AC2b. all seven gates present under the creator preset', GATE_ANCHORS.join(', '))
else bad('AC2b. seven gates', `missing: ${missingGates.join(', ')}`)

if (countOf(creativeText, gateSection.text) === 1)
  ok('AC2c. the seven-gate block is byte-identical to the shared skeleton (wording unmodified)')
else bad('AC2c. gate wording', `${countOf(creativeText, gateSection.text)} copies`)

if (creatorText.includes('creator-model') && creatorText.includes('/tmp/wp-creator-cwd') &&
    !creatorText.includes('{{model}}') && !creatorText.includes('{{cwd}}'))
  ok('AC2d. {{model}}/{{cwd}} interpolate on the creative mount (persona + injected section render together)')
else bad('AC2d. creative interpolation', creatorText.slice(0, 200))

const markerless = await render('creator-markerless', '/tmp/wp-plain-cwd', 'plain-model')
if (!markerless.includes('MAIN FLOW — idea → ship'))
  ok('AC2e. marker scope guard still applies with a profile (no marker → nothing injected)')
else bad('AC2e. marker scope guard with a profile', markerless.slice(0, 200))

const standardExplicit = await render('standard-explicit', '/tmp/wp-std-cwd', 'std-model')
const standardDefault = await render('standard-default', '/tmp/wp-std-cwd', 'std-model')
if (standardExplicit === standardDefault)
  ok('AC2f. explicit `profile: standard` renders identically to the default mount')
else bad('AC2f. explicit standard vs default', `${standardExplicit.length} vs ${standardDefault.length}`)
if (countOf(standardExplicit, gateSection.text) === 1 && !standardExplicit.includes('CREATOR'))
  ok('AC2g. the standard mount carries no creative delta')
else bad('AC2g. standard mount leaked creative deltas')

const override = await render('text-override', '/tmp/wp-custom-cwd', 'custom-model')
if (override.includes('CUSTOM custom-model on /tmp/wp-custom-cwd.') && !override.includes('MAIN FLOW'))
  ok('AC2h. config.text still overrides the profile entirely (#54 escape hatch intact)')
else bad('AC2h. config.text override', override.slice(0, 200))

report('WORKFLOW-PROFILES VERIFY (mechanism + AC1/AC2/AC3)')