/**
 * verify-workflow-profiles.mjs — #55: profile mechanism + cordis profile.
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
 * AC1: `profile: standard` is BYTE-IDENTICAL to the frozen baseline
 *      (tests/fixtures/workflow-body-v1.txt — captured before #55 and
 *      re-taken at #85 with the workflow text-policy change: an intentional
 *      baseline move, not drift; ADR-0010 precedent). #58: the baseline is
 *      the COMPONENT-ON standard render (default components = all registered),
 *      so the batch component being mounted by default keeps AC1 green with
 *      the SAME fixture bytes — no re-take.
 * AC2: `profile: cordis` injects the adapted text under a creator preset,
 *      with the seven gates present and unmodified in wording.
 * AC3: the delta structure duplicates no workflow section between profiles —
 *      the seven gates are edited in exactly one place (the skeleton).
 * C-series (#58): the batch component toggle — off = no batch sections reach
 *      the composed text (whatever carried them); on = byte-identical to the
 *      baseline; an unknown component name is loud.
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

/** The frozen baseline: the plugin's standard body (LF — what the plugin injects);
 *  captured before #55, re-taken at #85 with the workflow text-policy change. */
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

const seam = ['profileBody', 'parseSections', 'composeSections', 'joinSections', 'PROFILES', 'DEFAULT_PROFILE', 'COMPONENTS', 'DEFAULT_COMPONENTS']
const missingSeam = seam.filter(k => core[k] === undefined)
if (missingSeam.length === 0) ok('M. workflow-core.mjs exposes the profile seam', seam.join(', '))
else {
  bad('M. workflow-core.mjs exposes the profile seam', `missing: ${missingSeam.join(', ')}`)
  report('WORKFLOW-PROFILES VERIFY (mechanism + AC1)')
}

if (core.DEFAULT_PROFILE === 'standard') ok('P1. default profile is standard')
else bad('P1. default profile', String(core.DEFAULT_PROFILE))

if (Object.hasOwn(core.PROFILES ?? {}, 'standard') && Object.hasOwn(core.PROFILES ?? {}, 'cordis'))
  ok('P2. profiles registered', Object.keys(core.PROFILES).join(', '))
else bad('P2. profiles registered', JSON.stringify(core.PROFILES))

// #58: the batch component is registered and mounted by DEFAULT (the
// pre-#58 behavior — standard stays byte-identical to the frozen baseline).
if (Array.isArray(core.DEFAULT_COMPONENTS) && core.DEFAULT_COMPONENTS.length > 0 &&
    Object.hasOwn(core.COMPONENTS ?? {}, core.DEFAULT_COMPONENTS[0]) &&
    Array.isArray(core.COMPONENTS[core.DEFAULT_COMPONENTS[0]].sectionIds))
  ok('P2b. components registered and mounted by default', `${core.DEFAULT_COMPONENTS.join(', ')} (sectionIds: ${core.DEFAULT_COMPONENTS.map(n => core.COMPONENTS[n].sectionIds.join('|')).join(', ')})`)
else bad('P2b. component registry', JSON.stringify({ DEFAULT_COMPONENTS: core.DEFAULT_COMPONENTS, COMPONENTS: Object.keys(core.COMPONENTS ?? {}) }))

// ── AC1: standard == the frozen baseline (verbatim) ──────────────────────────
const standard = await core.profileBody('standard')
if (standard === BASELINE) ok('AC1. profile: standard verbatim-identical to the frozen baseline', `${standard.length} chars`)
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

// #58: the skeleton rejoins to the COMPONENT-OFF standard render — the batch
// section lives in the component file now, so the baseline bytes come from the
// composition, not the skeleton alone (C2 below pins component-on = baseline).
const componentOff = await core.profileBody('standard', [])
if (core.joinSections(parsed.sections, parsed.trailingNewline) === componentOff)
  ok('S3. skeleton format is lossless (markers strip back to the component-off standard bytes)')
else bad('S3. lossless rejoin', divergence(core.joinSections(parsed.sections, parsed.trailingNewline), componentOff))

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
if (shippedDeltas.includes('workflow-profile-cordis.txt'))
  ok('P3. cordis delta file exists next to the plugin')
else bad('P3. cordis delta file', `found: ${shippedDeltas.join(', ') || 'none'}`)

const covered = new Set((await Promise.all(PKG.files.map(entry => expandEntry(REPO, entry)))).flat())
const uncovered = shippedDeltas.filter(f => !covered.has(f))
if (shippedDeltas.length > 0 && uncovered.length === 0)
  ok('P4. every shipped delta is covered by the payload rule (installer expandEntry)', shippedDeltas.join(', '))
else bad('P4. payload coverage', uncovered.length > 0 ? `not covered: ${uncovered.join(', ')}` : 'no delta files found')

// #58: the component file ships with the same payload rule.
if (covered.has('workflow-component-batch.txt'))
  ok('P4b. the batch component file is covered by the payload rule')
else bad('P4b. component payload coverage', 'workflow-component-batch.txt not covered by package.json files')

// #137: the lane component file ships under the same rule.
if (covered.has('workflow-component-lane.txt'))
  ok('P4c. the lane component file is covered by the payload rule')
else bad('P4c. lane component payload coverage', 'workflow-component-lane.txt not covered by package.json files')

// ── AC3: the delta structure duplicates nothing ─────────────────────────────
// (Mechanism-level, independent of the render: compose the shipped cordis
// delta onto the skeleton and count bodies. A profile that copied a shared
// section would show the skeleton body twice — or leave the skeleton body
// behind an override. #58: the SHARED text = skeleton + the batch component
// file — its section is composed in by default, so it is judged with the
// skeleton sections.)
const CORDIS_DELTA_RAW = lf(readFileSync(REPO + '/workflow-profile-cordis.txt', 'utf8'))
const COMPONENT_RAW = lf(readFileSync(REPO + '/workflow-component-batch.txt', 'utf8'))
const LANE_COMPONENT_RAW_EARLY = lf(readFileSync(REPO + '/workflow-component-lane.txt', 'utf8'))
const delta = core.parseSections(CORDIS_DELTA_RAW)
const componentDelta = core.parseSections(COMPONENT_RAW)
const laneComponentDelta = core.parseSections(LANE_COMPONENT_RAW_EARLY)
const skeletonIds = ids
const deltaIds = delta.sections.map(s => s.id)
const cordisSections = core.composeSections(parsed.sections, [...delta.sections, ...componentDelta.sections, ...laneComponentDelta.sections])
const cordisText = core.joinSections(cordisSections, parsed.trailingNewline)
const countOf = (haystack, needle) => (needle === '' ? 0 : haystack.split(needle).length - 1)

const composedIds = cordisSections.map(s => s.id)
if (new Set(composedIds).size === composedIds.length)
  ok('AC3a. composed cordis sections carry unique ids', `${composedIds.length} sections`)
else bad('AC3a. composed ids unique', JSON.stringify(composedIds))

const sharedSections = [...parsed.sections, ...componentDelta.sections, ...laneComponentDelta.sections]
const shadowed = sharedSections.filter(s => countOf(cordisText, s.text) !== 1).map(s => s.id)
if (shadowed.length === 0) ok('AC3b. every shared section appears exactly once (override or untouched — never both)')
else bad('AC3b. shared sections duplicated/shadowed', shadowed.join(', '))

const deltaBodiesUnique = deltaIds.filter(id => countOf(cordisText, delta.sections.find(s => s.id === id).text) !== 1)
if (deltaBodiesUnique.length === 0) ok('AC3c. every delta section appears exactly once', deltaIds.join(', '))
else bad('AC3c. delta sections', deltaBodiesUnique.join(', '))

const gateSection = parsed.sections.find(s => s.id === 'workflow-enforcement')
if (!CORDIS_DELTA_RAW.includes(gateSection.text))
  ok('AC3d. the seven-gate block is not copied into the cordis delta (one place to edit)')
else bad('AC3d. cordis delta copies the gate block')

const offSkeleton = deltaIds.filter(id => !skeletonIds.includes(id))
if (deltaIds.length === offSkeleton.length)
  ok('AC3e. the cordis profile ADDS sections and rewrites none', offSkeleton.join(', '))
else bad('AC3e. cordis profile rewrites a shared section', deltaIds.filter(id => skeletonIds.includes(id)).join(', '))

// ── AC2: cordis mounts under a creator preset (model-facing surface) ──────
const CORE = pathToFileURL(REPO + '/workflow-core.mjs').href
const GATE_ANCHORS = ['ENTRY ROUTING', 'IMPLEMENT GATE', 'DECISION BOUNDARY', 'PHASE DECLARATION',
  'ONE ISSUE PER SESSION', 'EXTERNAL-ACTION GATE', 'TICKET EXIT']
const plain = 'You are a plain agent.'
const personaRow = (prefix) => ({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix } })
const corePlugin = (config) => ({ id: 'workflow-core', name: CORE, ...(config === undefined ? {} : { config }) })
const ctx = await bootHarness([
  { id: 'creator', plugins: [personaRow('You are a creator agent powered by {{model}}.'), corePlugin({ profile: 'cordis', scope: 'all' })] },
  { id: 'creator-markerless', plugins: [personaRow(plain), corePlugin({ profile: 'cordis' })] },
  { id: 'standard-explicit', plugins: [personaRow(plain), corePlugin({ profile: 'standard', scope: 'all' })] },
  { id: 'standard-default', plugins: [personaRow(plain), corePlugin({ scope: 'all' })] },
  { id: 'text-override', plugins: [personaRow(plain), corePlugin({ profile: 'cordis', scope: 'all', text: 'CUSTOM {{model}}.' })] },
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

if (countOf(cordisText, gateSection.text) === 1)
  ok('AC2c. the seven-gate block is byte-identical to the shared skeleton (wording unmodified)')
else bad('AC2c. gate wording', `${countOf(cordisText, gateSection.text)} copies`)

if (creatorText.includes('creator-model') && !creatorText.includes('{{model}}'))
  ok('AC2d. {{model}} interpolates on the cordis mount (persona + injected section render together)')
else bad('AC2d. cordis interpolation', creatorText.slice(0, 200))

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
  ok('AC2g. the standard mount carries no cordis delta')
else bad('AC2g. standard mount leaked cordis deltas')

const override = await render('text-override', '/tmp/wp-custom-cwd', 'custom-model')
if (override.includes('CUSTOM custom-model.') && !override.includes('MAIN FLOW'))
  ok('AC2h. config.text still overrides the profile entirely (#54 escape hatch intact)')
else bad('AC2h. config.text override', override.slice(0, 200))

// ── C: the component toggles (#58 batch + #137 lane) ────────────────────────
// The batch-mode rule block (D31–D33) moved out of the skeleton into
// workflow-component-batch.txt, injected as a COMPONENT: off = no batch
// sections in the composed text (whatever carried them — the component delta
// or a profile's override). #137 registers a second component (`lane`) the
// same way: the default mount (and the frozen baseline) is skeleton + BOTH
// components; a single-component list renders that component's sections on
// the component-off bytes.
const batchSectionText = componentDelta.sections.find(s => s.id === 'batch-mode')?.text ?? ''
const laneSectionText = laneComponentDelta.sections.find(s => s.id === 'lane-batch')?.text ?? ''

// C1: OFF = neither component reaches the text (the component section bodies
// are absent wholesale — judged on the full section text, not a keyword).
const componentOffAgain = await core.profileBody('standard', [])
if (batchSectionText !== '' && !componentOffAgain.includes(batchSectionText) &&
    !componentOffAgain.includes('STYLE PREFERENCE LAYER') && !componentOffAgain.includes('WAKE ORCHESTRATION') &&
    !componentOffAgain.includes('BATCH WRAP-UP CARD') &&
    laneSectionText !== '' && !componentOffAgain.includes(laneSectionText) &&
    !componentOffAgain.includes('CAPABILITY PRECHECK') && !componentOffAgain.includes('LANE ORCHESTRATION'))
  ok('C1. components:[] strips the batch AND lane sections from the standard text', `${componentOffAgain.length} chars (batch section ${batchSectionText.length} + lane section ${laneSectionText.length} chars absent)`)
else bad('C1. component-off text', batchSectionText === '' || laneSectionText === '' ? 'component delta unreadable' : 'component section content still present')

// C2: ON = verbatim-equivalent to the frozen baseline. Since #137 the default
// mount is skeleton + batch + lane, so naming BOTH explicitly must render
// identically to the default mount (and to `standard`).
const componentOn = await core.profileBody('standard', ['batch', 'lane'])
if (componentOn === BASELINE && componentOn === standard)
  ok('C2. components:[batch,lane] is verbatim-identical to the frozen baseline (and to the default mount)', `${componentOn.length} chars`)
else bad('C2. component-on text', divergence(componentOn, BASELINE))

// C2b (#137): a single-component list rides the component-off bytes plus that
// component's sections — `['batch']` = batch sections present, lane sections
// absent (and vice versa; C8 below).
const componentBatchOnly = await core.profileBody('standard', ['batch'])
if (componentBatchOnly.includes(batchSectionText) && laneSectionText !== '' &&
    !componentBatchOnly.includes(laneSectionText))
  ok('C2b. components:[batch] = batch sections on the component-off bytes, lane sections absent', `${componentBatchOnly.length} chars`)
else bad('C2b. batch-only mount', `batchPresent=${componentBatchOnly.includes(batchSectionText)} laneLeaked=${laneSectionText !== '' && componentBatchOnly.includes(laneSectionText)}`)

// C3: an unknown component name is LOUD (a typoed switch must never silently
// do nothing) — profileBody, resolveComponents AND the apply mount all throw
// (apply resolves components before registering the handler, so the mount
// fails loudly instead of degrading to an assembly warn).
let c3BodyThrew = false
let c3ResolveThrew = false
let c3ApplyThrew = false
try { await core.profileBody('standard', ['nope']) } catch { c3BodyThrew = true }
try { core.resolveComponents(['nope']) } catch { c3ResolveThrew = true }
try { core.apply({ on() {} }, { components: ['nope'] }) } catch { c3ApplyThrew = true }
if (c3BodyThrew && c3ResolveThrew && c3ApplyThrew)
  ok('C3. an unknown component name throws at all three seams incl. the apply mount (loud, never a silent no-op)')
else bad('C3. unknown component name', `profileBody threw=${c3BodyThrew} resolveComponents threw=${c3ResolveThrew} apply threw=${c3ApplyThrew}`)

// C4/C5/C6: the toggle applies under EVERY profile, and the composed section
// ORDER is unchanged from the pre-#58 text — the batch section lands after a
// profile's insert chain (same anchor), never between its links. The order
// tables are written here on purpose, independent of the delta files
// (deriving them from the deltas would make the check tautological).
const expectedOrder = (inserted) => [
  'main-flow', 'orchestration', 'workflow-enforcement', 'enforcement-done', 'enforcement-tiering', 'enforcement-recovery',
  ...inserted, 'batch-mode', 'batch-wrap-up', 'lane-batch', 'lane-orchestration',
  'text-pushes-exclude-actions', 'context-hygiene', 'methodology',
  'human-communication', 'on-ramps', 'health', 'standalone', 'utilities', 'precondition', 'initialization',
]

const cordisComposed = core.composeSections(parsed.sections, [...delta.sections, ...componentDelta.sections, ...laneComponentDelta.sections])
const cordisOrder = cordisComposed.map(s => s.id)
if (cordisOrder.join(',') === expectedOrder(['creator-context', 'creator-gate-extension', 'creator-inspect-first']).join(','))
  ok('C4. cordis + batch component: section order unchanged (component lands after the creator chain)', `${cordisOrder.length} sections`)
else bad('C4. cordis composed order', cordisOrder.join(', '))

const cordisOffText = core.joinSections(cordisComposed.filter(s => s.id !== 'batch-mode'), parsed.trailingNewline)
if (batchSectionText !== '' && !cordisOffText.includes(batchSectionText) && cordisOffText.includes('CREATOR CONTEXT'))
  ok('C5. components:[] under cordis: creator sections stay, batch section goes')
else bad('C5. cordis component-off', batchSectionText === '' ? 'component delta unreadable' : 'batch content present / creator content lost')

const PTC_DELTA_RAW = lf(readFileSync(REPO + '/workflow-profile-ptc.txt', 'utf8'))
const ptcDelta = core.parseSections(PTC_DELTA_RAW)
const ptcComposed = core.composeSections(parsed.sections, [...ptcDelta.sections, ...componentDelta.sections, ...laneComponentDelta.sections])
const ptcOrder = ptcComposed.map(s => s.id)
if (ptcOrder.join(',') === expectedOrder(['ptc-execution-shape', 'ptc-loop-surface', 'ptc-orchestration', 'ptc-gate-scope']).join(','))
  ok('C6. ptc + batch component: section order unchanged (component lands after the ptc chain)', `${ptcOrder.length} sections`)
else bad('C6. ptc composed order', ptcOrder.join(', '))

const MIN_DELTA_RAW = lf(readFileSync(REPO + '/workflow-profile-minimal.txt', 'utf8'))
const minDeltaRaw = core.parseSections(MIN_DELTA_RAW)
const minBatchText = minDeltaRaw.sections.find(s => s.id === 'batch-mode')?.text ?? ''
const minimalOff = await core.profileBody('minimal', [])
if (minBatchText !== '' && !minimalOff.includes(minBatchText))
  ok('C7. components:[] under minimal: the profile\'s own batch override disappears too', `${minimalOff.length} chars`)
else bad('C7. minimal component-off', minBatchText === '' ? 'minimal delta unreadable' : 'minimal batch section still present')

// ── C8: the lane component toggle (#137 — symmetric to C2b) ─────────────────
// `['lane']` renders the lane sections on the component-off bytes with the
// batch sections stripped — and it must RESOLVE at all: lane-batch anchors at
// the skeleton's enforcement-recovery (never at a batch section), so mounting
// lane without batch cannot hit an unknown-anchor throw.
const componentLaneOnly = await core.profileBody('standard', ['lane'])
if (componentLaneOnly.includes(laneSectionText) && batchSectionText !== '' &&
    !componentLaneOnly.includes(batchSectionText) &&
    !componentLaneOnly.includes('BATCH WRAP-UP CARD'))
  ok('C8. components:[lane] = lane sections on the component-off bytes, batch sections absent (anchor resolves without batch)', `${componentLaneOnly.length} chars`)
else bad('C8. lane-only mount', `lanePresent=${componentLaneOnly.includes(laneSectionText)} batchLeaked=${batchSectionText !== '' && componentLaneOnly.includes(batchSectionText)}`)

// C9: both components registered with their section ids, default = all.
if (core.DEFAULT_COMPONENTS.join(',') === 'batch,lane' &&
    core.COMPONENTS.lane?.sectionIds?.join(',') === 'lane-batch,lane-orchestration' &&
    core.COMPONENTS.batch?.sectionIds?.join(',') === 'batch-mode,batch-wrap-up')
  ok('C9. components registry: batch + lane, default mount = both', core.DEFAULT_COMPONENTS.join(', '))
else bad('C9. components registry', JSON.stringify({ DEFAULT_COMPONENTS: core.DEFAULT_COMPONENTS, lane: core.COMPONENTS.lane?.sectionIds, batch: core.COMPONENTS.batch?.sectionIds }))

// C10 (#137, 复审意见 5): minimal × lane composition is INTENTIONAL — minimal
// compresses the batch sections (pre-#58 text existed to preserve) but ships
// the lane sections at full length (no pre-#137 text to compress). The
// composition must therefore carry the lane sections VERBATIM into the
// token-budget profile — asserted here on the real render, not derived from
// the deltas (deriving would make the check tautological).
const minimalLane = await core.profileBody('minimal')
if (laneSectionText !== '' && minimalLane.includes(laneSectionText))
  ok('C10. minimal render carries the lane sections verbatim (intentional no-compress, declared in workflow-core.mjs)', `${minimalLane.length} chars`)
else bad('C10. minimal × lane composition', 'lane section text missing from the minimal render')

report('WORKFLOW-PROFILES VERIFY (mechanism + AC1/AC2/AC3 + components)')