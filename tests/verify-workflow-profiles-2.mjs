/**
 * verify-workflow-profiles-2.mjs — #56: tight-join sections + ptc/minimal.
 *
 * #55 (tests/verify-workflow-profiles.mjs) built the profile mechanism: a
 * shared skeleton sectioned by `@@ <id>` markers plus per-profile delta files
 * (override by matching id / insert by `after=<anchor>`). #56 adds two
 * profiles on that mechanism and, with them, ONE section-level addition:
 *
 *   `@@ <id> tight` — this section is GLUED to the previous one with a single
 *   newline instead of the blank separator. The #54 body connected the
 *   enforcement block (seven gates / DONE / TEST SCOPE TIERING / RECOVERY
 *   DISCIPLINE) with single newlines, so the minimal profile could not cut the
 *   three trailing blocks without restating the gates (the one piece of text
 *   that must stay in exactly one place, D41). `tight` makes the block
 *   splittable: the gates keep their own section, the other three become
 *   overridable.
 *
 * Seams under test (public, not internals):
 *   1. module exports — parseSections / composeSections / joinSections /
 *      profileBody / PROFILES (offline mechanism);
 *   2. the injection surface — agentPresets.mount → systemPrompt.assemble →
 *      renderPrompt (what the model reads), with each profile mounted by a
 *      preset shaped like its target.
 *
 * Target shapes: ptc's is the REAL row set ADR-0009 names (dsh-ptc-runtime-node
 * + dsh-workflow-ptc + dsh-tool-workflow). minimal has no execution shape of
 * its own by design — it is the SAME workflow under a token budget, so its
 * shape is a preset that mounts the profile; the probe therefore measures the
 * injected section text in CHARACTERS (the repo carries no tokenizer) and
 * asserts the rendered prompt shrinks with it.
 *
 * Assertion labels continue the #55 file's series across one run: P1–P4 live
 * there (default profile / registration / packaging), so registration and
 * packaging here are P5–P8. `G<n>` marks a precondition guard — a missing file
 * stops the run with a named failure instead of quietly failing an AC.
 *
 * AC1 (#56): ptc and minimal inject under their target shapes with all seven
 *      gates present; the ptc delta never assumes shell-host (D41).
 * AC2 (#56): minimal is roughly one third of standard (the token-budget probe).
 * AC3 (#56): standard is still byte-identical to the frozen baseline
 *      (re-taken at #85 with the workflow text-policy change).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { bootHarness, ensurePresetMountable, inertService } from './preset-harness.mjs'
import { expandEntry } from '../lib/payload.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const lf = (s) => s.replace(/\r\n/g, '\n')

/** The frozen baseline (LF — what the plugin injects), #55's AC1 fixture;
 *  captured before #55, re-taken at #85 with the workflow text-policy change. */
const BASELINE = lf(readFileSync(new URL('./fixtures/workflow-body-v1.txt', import.meta.url), 'utf8'))
/** The sectioned shared skeleton on disk (markers still in place). */
const SECTIONED = lf(readFileSync(REPO + '/workflow-body.txt', 'utf8'))
/** The plugin row the presets mount (the #54/#55 subpath-exports form). */
const CORE_URL = pathToFileURL(REPO + '/workflow-core.mjs').href
/** The enforcement block: the seven gates plus the three blocks #54 connected
 *  to them with single newlines (split into their own sections by #56). */
const ENFORCEMENT_GROUP = ['workflow-enforcement', 'enforcement-done', 'enforcement-tiering', 'enforcement-recovery']
/** Whether `ids` (a composed section list) holds the group consecutively. */
const groupIsContiguous = (all, group = ENFORCEMENT_GROUP) => {
  const at = group.map(id => all.indexOf(id))
  return at.every(v => v >= 0) && at.every((v, i) => i === 0 || v === at[i - 1] + 1)
}
/** The seven gate anchors the enforcer and every profile must keep in place. */
const GATE_ANCHORS = ['ENTRY ROUTING', 'IMPLEMENT GATE', 'DECISION BOUNDARY', 'PHASE DECLARATION',
  'ONE ISSUE PER SESSION', 'EXTERNAL-ACTION GATE', 'TICKET EXIT']
/** A delta file's bytes, or null when it is missing (a clean named failure). */
const readOrNull = (path) => {
  try { return lf(readFileSync(path, 'utf8')) } catch { return null }
}
/** How many times `needle` occurs in `haystack`. */
const countOf = (haystack, needle) => (needle === '' ? 0 : haystack.split(needle).length - 1)
/** First line of a delta section — what a render assertion looks for. */
const heading = (delta, id) => delta.sections.find(s => s.id === id)?.text.split('\n')[0] ?? ''
/** The mountable preset shape every render assertion is built from. */
const personaRow = (prefix) => ({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix } })
const corePlugin = (config) => ({ id: 'workflow-core', name: CORE_URL, config })

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
}

/** First-divergence locator, so a red byte assertion says WHERE it drifted. */
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
  report('WORKFLOW-PROFILES-2 VERIFY')
}

const seam = ['profileBody', 'parseSections', 'composeSections', 'joinSections', 'PROFILES', 'DEFAULT_PROFILE']
const missingSeam = seam.filter(k => core[k] === undefined)
if (missingSeam.length === 0) ok('M. workflow-core.mjs exposes the profile seam', seam.join(', '))
else {
  bad('M. workflow-core.mjs exposes the profile seam', `missing: ${missingSeam.join(', ')}`)
  report('WORKFLOW-PROFILES-2 VERIFY (mechanism + AC1)')
}

// ── mechanism: tight-joined sections (#56's one format addition) ────────────
const synth = core.parseSections('@@ s0\nA\n@@ s1 tight\nB\n@@ s2\nC\n')
const flags = synth.sections.map(s => s.tight)
if (synth.sections.length === 3 && flags[0] === false && flags[1] === true && flags[2] === false)
  ok('T1. `@@ <id> tight` parses as a section flag (default: not tight)')
else bad('T1. tight parse', JSON.stringify(synth.sections.map(s => ({ id: s.id, tight: s.tight }))))

if (core.joinSections(synth.sections, true) === 'A\nB\n\nC\n')
  ok('T2. a tight section joins with ONE newline; the rest keep the blank separator')
else bad('T2. tight join', JSON.stringify(core.joinSections(synth.sections, true)))

// Nothing precedes the first section, so the flag is unresolvable there.
let firstTight = false
try { core.parseSections('@@ s0 tight\nA\n') } catch { firstTight = true }
if (firstTight) ok('T3. a tight flag on the FIRST section throws (nothing to glue to)')
else bad('T3. first-section tight', 'accepted silently')

// The separator belongs to the skeleton POSITION: a delta never declares it.
let overrideTight = false
try {
  core.composeSections(core.parseSections('@@ main-flow\nX\n').sections, [{ id: 'main-flow', tight: true, text: 'Y' }])
} catch { overrideTight = true }
if (overrideTight) ok('T4. a delta override carrying `tight` throws (the skeleton position owns the separator)')
else bad('T4. delta override with tight', 'accepted silently')

// A marker-shaped line that does not parse must never be swallowed as body
// text (a typo would otherwise become prose in the model's prompt).
let malformed = false
try {
  const r = core.parseSections('@@ s0\nA\n@@ s1 tight after=s0\nB\n')
  malformed = r.sections.length !== 2
} catch { malformed = true }
if (malformed) ok('T5. a `@@`-prefixed line outside the grammar is loud (never silent body text)')
else bad('T5. malformed marker', 'parsed as body text')

// ── AC3: standard is still the frozen #54 body, split section by section ────
const standard = await core.profileBody('standard')
if (standard === BASELINE) ok('AC3. profile: standard still verbatim-identical to the frozen baseline', `${standard.length} chars`)
else bad('AC3. standard vs baseline', divergence(standard, BASELINE))

const parsed = core.parseSections(SECTIONED)
const ids = parsed.sections.map(s => s.id)
if (core.joinSections(parsed.sections, parsed.trailingNewline) === BASELINE)
  ok('AC3a. the split skeleton rejoins to the baseline bytes (tight join is lossless)')
else bad('AC3a. lossless rejoin', divergence(core.joinSections(parsed.sections, parsed.trailingNewline), BASELINE))

if (groupIsContiguous(ids))
  ok('AC3b. the enforcement block is four consecutive sections', ENFORCEMENT_GROUP.join(', '))
else bad('AC3b. enforcement group', `${ENFORCEMENT_GROUP.map((id, i) => `${id}@${ids.indexOf(id)}`).join(', ')} among ${ids.length} sections`)

const tightIds = parsed.sections.filter(s => s.tight).map(s => s.id)
if (JSON.stringify(tightIds) === JSON.stringify(ENFORCEMENT_GROUP.slice(1)))
  ok('AC3c. only the enforcement tail sections are tight-joined', tightIds.join(', '))
else bad('AC3c. tight sections', tightIds.join(', '))

// The block must stay ONE paragraph in the render — the gates run straight into
// DONE, exactly as in #54. A blank line here would mean the split leaked.
const gatesText = parsed.sections.find(s => s.id === 'workflow-enforcement')?.text ?? ''
if (standard.includes(gatesText + '\nDONE — verification includes the remote CI.') &&
    !standard.includes(gatesText + '\n\n'))
  ok('AC3d. the gates run straight into DONE in the standard render (no blank line re-introduced)')
else bad('AC3d. enforcement block boundary', `gatesLen=${gatesText.length}`)

// HARD GATES is the one block D41 says may live in exactly one place, so the
// group is asserted from the SKELETON as well: no section may repeat another's
// body (a split that left a copy behind would show up here).
const duplicateBodies = parsed.sections
  .filter(s => s.text.length > 40 && standard.split(s.text).length - 1 !== 1)
  .map(s => s.id)
if (duplicateBodies.length === 0)
  ok('AC3e. every skeleton section appears exactly once in the standard render')
else bad('AC3e. duplicated skeleton bodies', duplicateBodies.join(', '))

// The cordis profile inserts after the WHOLE enforcement block: the split
// moved that anchor, so this guards the composed ORDER, not just presence.
const cordisDelta = core.parseSections(lf(readFileSync(REPO + '/workflow-profile-cordis.txt', 'utf8')))
const cordisIds = core.composeSections(parsed.sections, cordisDelta.sections).map(s => s.id)
if (groupIsContiguous(cordisIds) && cordisIds.indexOf('creator-context') === cordisIds.indexOf('enforcement-recovery') + 1)
  ok('AC3f. the cordis profile still lands AFTER the whole enforcement block (anchor migrated with the split)')
else bad('AC3f. cordis insertion point', cordisIds.join(', '))

// ── AC1: the ptc profile (program-first tool surface, gates unchanged) ──────
const PTC_DELTA_RAW = readOrNull(REPO + '/workflow-profile-ptc.txt')
if (PTC_DELTA_RAW === null) {
  bad('G1. workflow-profile-ptc.txt exists next to the plugin')
  report('WORKFLOW-PROFILES-2 VERIFY (mechanism + AC1/AC2/AC3)')
}
const ptcDelta = core.parseSections(PTC_DELTA_RAW)
const added = ptcDelta.sections.map(s => s.id).filter(id => !ids.includes(id))
const ptcIds = core.composeSections(parsed.sections, ptcDelta.sections).map(s => s.id)
const ptcText = core.joinSections(core.composeSections(parsed.sections, ptcDelta.sections), parsed.trailingNewline)

if (Object.keys(core.PROFILES).sort().join(',') === 'cordis,minimal,ptc,standard')
  ok('P5. all four profiles are registered', Object.keys(core.PROFILES).join(', '))
else bad('P5. profiles registered', JSON.stringify(Object.keys(core.PROFILES)))

if (added.length === ptcDelta.sections.length && added.length >= 2)
  ok('AC1a. the ptc profile ADDS sections and rewrites none', added.join(', '))
else bad('AC1a. ptc rewrites a shared section', ptcDelta.sections.map(s => s.id).filter(id => ids.includes(id)).join(', '))

if (groupIsContiguous(ptcIds) && ptcIds.indexOf(added[0]) === ptcIds.indexOf('enforcement-recovery') + 1)
  ok('AC1b. the ptc block lands after the whole enforcement block')
else bad('AC1b. ptc insertion point', ptcIds.join(', '))

if (countOf(ptcText, gatesText) === 1 && GATE_ANCHORS.every(a => ptcText.includes(a)))
  ok('AC1c. ptc carries the seven-gate block once, byte-identical (wording unmodified)')
else bad('AC1c. ptc gates', `copies=${countOf(ptcText, gatesText)} missing=${GATE_ANCHORS.filter(a => !ptcText.includes(a)).join(', ')}`)

const ptcShadowed = ids.filter(id => countOf(ptcText, parsed.sections.find(s => s.id === id).text) !== 1)
if (ptcShadowed.length === 0) ok('AC1d. every shared section appears exactly once under ptc (nothing duplicated)')
else bad('AC1d. shared sections under ptc', ptcShadowed.join(', '))

// D41: the PTC profile is derived from the DEFAULT path — it must not lean on
// a shell-host plugin (ADR-0009). The token is the mechanical proxy, checked on
// the delta AND on the composed text (a shared section could carry it too); the
// mount below is the behavioural half (no shell-host row is mounted at all).
const shellHostHits = [['delta', PTC_DELTA_RAW], ['composed text', ptcText]]
  .filter(([, text]) => /shell[-_ ]?host/i.test(text)).map(([where]) => where)
if (shellHostHits.length === 0)
  ok('AC1e. neither the ptc delta nor the composed ptc text references shell-host (D41: default path)')
else bad('AC1e. shell-host reference', shellHostHits.join(', '))

const PTC_VOCAB = ['run_code', 'agent()', 'parallel()', 'pipeline()', 'provider AND model', 'lossless JSON']
const missingVocab = PTC_VOCAB.filter(v => !ptcText.includes(v))
if (missingVocab.length === 0)
  ok('AC1f. the ptc text carries the program-first surface vocabulary', PTC_VOCAB.join(', '))
else bad('AC1f. ptc vocabulary', `missing: ${missingVocab.join(', ')}`)

// ── AC1: the ptc profile under its target shape (the real PTC rows) ─────────
// ADR-0009's shape: dsh-ptc-runtime-node (execution) + dsh-workflow-ptc
// (orchestration) + dsh-tool-workflow (model-facing consumer), mounted by a
// preset that also carries the workflow. The mount harness cannot supply
// fs/sandbox/sandboxPolicy/subagents, so they are pre-seeded with the harness's
// own inert stub — but NOT ptcRuntime, which dsh-ptc-runtime-node provides
// itself (stubbing it first would make the real provider's registration
// conflict).
const ptcCtx = await bootHarness([
  {
    id: 'ptc-shape',
    plugins: [
      personaRow('You are a PTC agent powered by {{model}}.'),
      corePlugin({ profile: 'ptc', scope: 'all' }),
      { id: 'ptc-runtime', name: '@deepseek-ai/dsh-ptc-runtime-node' },
      { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc' },
      { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
    ],
  },
  // Same profile, no `scope: 'all'`: the marker guard must still hold.
  { id: 'ptc-markerless', plugins: [personaRow('You are a plain agent.'), corePlugin({ profile: 'ptc' })] },
])
for (const name of ['fs', 'sandbox', 'sandboxPolicy', 'subagents']) {
  if (ptcCtx.get(name) === undefined) ptcCtx.provide(name, inertService())
}
await ensurePresetMountable(ptcCtx, 'ptc-shape')

const render = async (ctx, id, cwd, model) => {
  const handle = await ctx.agents.create({
    sessionId: SessionId('wp2-' + id),
    meta: { cwd },
    agentOptions: { provider: 'mock', model },
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, id),
  })
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, new AbortController().signal))
  const text = renderPrompt(assembly)
  await handle.dispose()
  return text
}

const ptcRender = await render(ptcCtx, 'ptc-shape', '/tmp/wp2-ptc-cwd', 'ptc-model')
const missingOnMount = [...GATE_ANCHORS, ...added.map(id => heading(ptcDelta, id))].filter(a => !ptcRender.includes(a))
if (missingOnMount.length === 0)
  ok('AC1g. the PTC-shaped preset receives all seven gates and every ptc section', added.join(', '))
else bad('AC1g. ptc render', `missing: ${missingOnMount.join(', ')}`)

if (countOf(ptcRender, gatesText) === 1)
  ok('AC1h. exactly one seven-gate block reaches the model on the ptc mount')
else bad('AC1h. ptc gate copies', String(countOf(ptcRender, gatesText)))

if (ptcRender.includes('ptc-model') && !ptcRender.includes('{{model}}'))
  ok('AC1i. {{model}} interpolates on the ptc mount')
else bad('AC1i. ptc interpolation', ptcRender.slice(0, 200))

const ptcMarkerless = await render(ptcCtx, 'ptc-markerless', '/tmp/wp2-ptc-cwd', 'ptc-model')
if (!ptcMarkerless.includes('MAIN FLOW') && !ptcMarkerless.includes(heading(ptcDelta, added[0])))
  ok('AC1j. the marker scope guard still holds with a ptc profile (no marker → nothing injected)')
else bad('AC1j. ptc marker scope guard', ptcMarkerless.slice(0, 200))

// ── AC2: the minimal profile (token-budget probe of the same workflow) ──────
const MIN_DELTA_RAW = readOrNull(REPO + '/workflow-profile-minimal.txt')
if (MIN_DELTA_RAW === null) {
  bad('G2. workflow-profile-minimal.txt exists next to the plugin')
  report('WORKFLOW-PROFILES-2 VERIFY (mechanism + AC1/AC2/AC3)')
}
const minDelta = core.parseSections(MIN_DELTA_RAW)
const minDeltaIds = minDelta.sections.map(s => s.id)
const minSections = core.composeSections(parsed.sections, minDelta.sections)
const minText = core.joinSections(minSections, parsed.trailingNewline)
const minimal = await core.profileBody('minimal')

// The gates are the ONE block no profile may restate (D41): minimal must leave
// the skeleton section alone rather than copy it — that is what makes the
// compression possible at all (the split in AC3b is what unblocked it).
if (!minDeltaIds.includes('workflow-enforcement'))
  ok('AC2a. minimal does NOT override the gates section (they stay in one place)')
else bad('AC2a. minimal overrides the gates section', 'workflow-enforcement in delta')

if (countOf(MIN_DELTA_RAW, gatesText) === 0 && countOf(minText, gatesText) === 1)
  ok('AC2b. the seven-gate block is neither copied into the delta nor duplicated in the text')
else bad('AC2b. gate copies', `delta=${countOf(MIN_DELTA_RAW, gatesText)} text=${countOf(minText, gatesText)}`)

if (GATE_ANCHORS.every(a => minimal.includes(a)))
  ok('AC2c. all seven gates are present in the minimal body', GATE_ANCHORS.join(', '))
else bad('AC2c. minimal gates', `missing: ${GATE_ANCHORS.filter(a => !minimal.includes(a)).join(', ')}`)

// AC2: the number the ticket asks for — "roughly one third". Asserted as a
// band (a third ± a healthy margin), with the measured numbers reported so a
// drift is visible in the evidence line rather than only in a red run.
const ratio = minimal.length / standard.length
if (ratio >= 0.25 && ratio <= 0.40)
  ok('AC2d. minimal is roughly one third of standard', `${minimal.length} / ${standard.length} chars = ${(ratio * 100).toFixed(1)}%`)
else bad('AC2d. minimal/standard ratio', `${minimal.length} / ${standard.length} = ${(ratio * 100).toFixed(1)}% (want 25–40%)`)

// Structural duplication check, in the shape an override-heavy profile needs:
// an untouched skeleton section appears once, a rewritten one is GONE (the
// override replaces it in place — nothing is left behind), and every delta
// body appears once.
const minUntouchedShadowed = ids
  .filter(id => !minDeltaIds.includes(id))
  .filter(id => countOf(minText, parsed.sections.find(s => s.id === id).text) !== 1)
const overriddenCount = ids.filter(id => minDeltaIds.includes(id)).length
const minLeftovers = ids
  .filter(id => minDeltaIds.includes(id))
  .filter(id => countOf(minText, parsed.sections.find(s => s.id === id).text) !== 0)
const minDeltaCopies = minDeltaIds.filter(id => countOf(minText, minDelta.sections.find(s => s.id === id).text) !== 1)
if (minUntouchedShadowed.length === 0 && minLeftovers.length === 0 && minDeltaCopies.length === 0)
  ok('AC2e. nothing is duplicated and nothing is left behind', `${ids.filter(id => !minDeltaIds.includes(id)).length} untouched, ${overriddenCount} rewritten`)
else bad('AC2e. minimal structure', `shadowed: ${minUntouchedShadowed.join(', ') || 'none'}; leftover skeleton: ${minLeftovers.join(', ') || 'none'}; delta copies: ${minDeltaCopies.join(', ') || 'none'}`)

// "examples cut": every overridden section must actually SHRINK, and the
// example-heavy ones must shrink hard.
const overriddenIds = minDeltaIds.filter(id => ids.includes(id))
const grew = overriddenIds.filter(id => {
  const was = parsed.sections.find(s => s.id === id).text.length
  const now = minDelta.sections.find(s => s.id === id).text.length
  return now >= was
})
if (overriddenIds.length >= 8 && grew.length === 0)
  ok('AC2f. every section minimal rewrites is shorter than the skeleton', `${overriddenIds.length} overridden`)
else bad('AC2f. minimal overrides', `${overriddenIds.length} overridden, not shrunk: ${grew.join(', ') || 'none'}`)

const exampleHeavy = ['batch-mode', 'context-hygiene', 'initialization']
const notCut = exampleHeavy.filter(id => {
  const was = parsed.sections.find(s => s.id === id).text.length
  return minDelta.sections.find(s => s.id === id).text.length > was * 0.6
})
if (notCut.length === 0)
  ok('AC2g. the example-heavy sections are cut by more than 40%', exampleHeavy.join(', '))
else bad('AC2g. example-heavy sections', notCut.join(', '))

// Distinctive example strings from the skeleton must be GONE, not merely
// shortened — a name-listing inside a longer paragraph would sneak past AC2f.
const EXAMPLES = ['sandcastle/templates/', '/setup-ts-deep-modules', '~100–150K', 'to-questionnaire', 'ponytail']
const leakedExamples = EXAMPLES.filter(e => minText.includes(e))
if (leakedExamples.length === 0)
  ok('AC2h. the cut examples are absent from the minimal text', EXAMPLES.join(', '))
else bad('AC2h. example leakage', leakedExamples.join(', '))

// The other half of "examples cut": the compression may not become DELETION.
// Every section must keep an anchor a reader (and the gates' cross-references
// — gate 5/6 point at BATCH MODE, DONE at RECOVERY-style state files) can
// navigate by, and the load-bearing batch rules must survive their own
// compression. The list is written here on purpose, independent of the delta:
// deriving it from the delta would make the check tautological.
const RULE_ANCHORS = ['MINIMAL FLOW', 'DONE — verification includes the remote CI', 'TEST SCOPE TIERING',
  'RECOVERY DISCIPLINE', 'BATCH MODE', 'ONE TICKET PER SESSION', 'AUTO-HANDOFF', 'ISSUE DISCIPLINE',
  // #128：压缩不等于删除 —— 票面契约 / 冲突归零 / 预授权清单 / 收口步必须仍在 minimal 里，
  // 否则 minimal 档位的会话会退回「什么问题都停下来问」的老病灶。
  'ENTRY CONTRACT', 'CONFLICT ZERO', 'PRE-AUTHORIZATION', 'CLOSE-OUT STEP',
  'TEXT PUSHES EXCLUDE ACTIONS', 'CONTEXT HYGIENE', 'METHODOLOGY', 'ON-RAMPS', 'HEALTH',
  'STANDALONE', 'UTILITIES', 'PRECONDITION', 'INITIALIZATION']
const lostAnchors = RULE_ANCHORS.filter(anchor => !minText.includes(anchor))
if (lostAnchors.length === 0)
  ok('AC2i. the compression keeps every rule anchor (compressed, not deleted)', `${RULE_ANCHORS.length} anchors`)
else bad('AC2i. lost rule anchors', lostAnchors.join(', '))

// ── AC1/AC2: both profiles mount under their own shape ─────────────────────
// minimal's shape IS a preset mounting the profile (it has no execution shape
// of its own — see the header); the standard mount is the control it is
// measured against, and the markerless one proves the scope guard holds.
const profilesCtx = await bootHarness([
  { id: 'minimal-shape', plugins: [personaRow('You are an agent powered by {{model}}.'), corePlugin({ profile: 'minimal', scope: 'all' })] },
  { id: 'minimal-markerless', plugins: [personaRow('You are a plain agent.'), corePlugin({ profile: 'minimal' })] },
  { id: 'standard-shape', plugins: [personaRow('You are an agent powered by {{model}}.'), corePlugin({ profile: 'standard', scope: 'all' })] },
])
const minimalRender = await render(profilesCtx, 'minimal-shape', '/tmp/wp2-min-cwd', 'min-model')
const standardRender = await render(profilesCtx, 'standard-shape', '/tmp/wp2-min-cwd', 'min-model')

const missingMinSections = [...GATE_ANCHORS, ...minDeltaIds.filter(id => !ids.includes(id)).map(id => heading(minDelta, id))]
  .filter(a => !minimalRender.includes(a))
if (missingMinSections.length === 0)
  ok('AC2j. the minimal mount receives all seven gates and the minimal framing note')
else bad('AC2j. minimal render', `missing: ${missingMinSections.join(', ')}`)

if (minimalRender.length < standardRender.length * 0.75)
  ok('AC2k. the rendered prompt shrinks with the profile', `${minimalRender.length} vs ${standardRender.length} chars`)
else bad('AC2k. rendered shrink', `${minimalRender.length} vs ${standardRender.length}`)

if (minimalRender.includes('min-model') &&
    !minimalRender.includes('{{model}}') && minimalRender.includes('MINIMAL FLOW'))
  ok('AC2l. {{model}} interpolates on the minimal mount')
else bad('AC2l. minimal interpolation', minimalRender.slice(0, 200))

const minimalMarkerless = await render(profilesCtx, 'minimal-markerless', '/tmp/wp2-min-cwd', 'min-model')
if (!minimalMarkerless.includes('MAIN FLOW') && !minimalMarkerless.includes('MINIMAL FLOW'))
  ok('AC2m. the marker scope guard still holds with a minimal profile (no marker → nothing injected)')
else bad('AC2m. minimal marker scope guard', minimalMarkerless.slice(0, 200))

// ── packaging: every profile delta ships with the plugin ───────────────────
// Coverage is checked with the INSTALLER'S OWN rule (lib/payload.mjs), and the
// two new files are required as EXPLICIT entries: a literal shipping manifest is
// this repo's convention for `files`. #66 has since made a file-name glob expand
// correctly AND made a zero-match entry a loud error, so the explicit entry these
// assertions require is now a convention (P7), not a workaround for a silent bug.
const PKG = JSON.parse(readFileSync(REPO + '/package.json', 'utf8'))
const shipped = readdirSync(REPO).filter(f => /^workflow-profile-.+\.txt$/.test(f)).sort()
const expectedDeltas = ['workflow-profile-cordis.txt', 'workflow-profile-minimal.txt', 'workflow-profile-ptc.txt']
if (JSON.stringify(shipped) === JSON.stringify(expectedDeltas))
  ok('P6. every profile delta sits next to the plugin', shipped.join(', '))
else bad('P6. shipped delta files', `found: ${shipped.join(', ') || 'none'}`)

const literal = expectedDeltas.filter(f => (PKG.files ?? []).includes(f))
if (literal.length === expectedDeltas.length)
  ok('P7. every delta is an explicit package.json files entry (repo convention; #66 fixed the silent glob)')
else bad('P7. explicit files entries', `missing: ${expectedDeltas.filter(f => !literal.includes(f)).join(', ')}`)

const covered = new Set((await Promise.all((PKG.files ?? []).map(entry => expandEntry(REPO, entry)))).flat())
const uncovered = shipped.filter(f => !covered.has(f))
if (shipped.length > 0 && uncovered.length === 0)
  ok('P8. every shipped delta is covered by the payload rule (installer expandEntry)', shipped.join(', '))
else bad('P8. payload coverage', uncovered.length > 0 ? `not covered: ${uncovered.join(', ')}` : 'no delta files found')

report('WORKFLOW-PROFILES-2 VERIFY (mechanism + AC1/AC2/AC3)')