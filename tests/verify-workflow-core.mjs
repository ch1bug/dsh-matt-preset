/**
 * verify-workflow-core.mjs — #54 workflow pluginization (workflow-core).
 *
 * The ask-matt workflow body moves out of the persona prefix into the
 * workflow-core plugin, injected through the system-prompt/assemble path.
 *
 * S1 (SPIKE — the ticket's one technical unknown, run FIRST): {{model}} and
 *     {{cwd}} interpolate inside a plugin-injected section. The assemble
 *     waterfall runs BEFORE renderPrompt interpolates, and agent-loop
 *     registers both variables per assembly — proven here end-to-end.
 * L1: with workflow-core mounted by the matt-shaped preset, the rendered
 *     model-facing system prompt is VERBATIM-IDENTICAL to the current
 *     persona-carried version (old prefix frozen in tests/fixtures/
 *     persona-prefix-v1.txt — captured from git HEAD at #54, NOT re-read
 *     from git, so the baseline survives this commit landing).
 * AC2: a preset other than matt mounts workflow-core with ONE plugin row
 *     (scope: 'all') and receives the workflow text.
 * G1: marker scope guard — with the default scope ('marker'), a session
 *     whose assembled prompt lacks the ask-matt marker receives nothing.
 * E1: the workflow-enforcer scope guard keeps working after the split — the
 *     persona intro (kept in the preset) still carries the marker, and the
 *     enforcer still injects WORKFLOW GATES on the new-style mount.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { bootHarness, ENFORCER_PLUGIN } from './preset-harness.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url))

const WORKFLOW_CORE = pathToFileURL(REPO + '/workflow-core.mjs').href

/** The OLD full persona prefix, frozen at #54 (the L1 baseline). */
const OLD_PREFIX = readFileSync(new URL('./fixtures/persona-prefix-v1.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Extract the `prefix: |` block scalar (same shape as verify-production). */
function personaPrefix(yml) {
  const lines = yml.split('\n')
  const start = lines.findIndex(line => /^\s*prefix:/.test(line))
  if (start < 0) throw new Error('no prefix: in composition')
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}/.test(lines[i]) || lines[i].trim() === '') out.push(lines[i].slice(6))
    else if (out.length > 0) break
  }
  return out.join('\n')
}

/** The NEW persona prefix from the working tree (must NOT carry the body). */
const newComposition = readFileSync(REPO + '/agent.cordis.yml', 'utf8').replace(/\r\n/g, '\n')

const NEW_PREFIX = personaPrefix(newComposition)

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

// The split contract: the new persona prefix must be a strict prefix of the
// old one, split at a blank-line boundary, and must still carry the marker.
if (OLD_PREFIX.startsWith(NEW_PREFIX)) ok('split: new persona prefix is a strict prefix of the old')
else bad('split: new persona prefix is a strict prefix of the old')
if (OLD_PREFIX.length > NEW_PREFIX.length) ok('split: workflow body left the persona prefix', `${OLD_PREFIX.length} → ${NEW_PREFIX.length} chars`)
else bad('split: workflow body left the persona prefix', `${OLD_PREFIX.length} → ${NEW_PREFIX.length} chars`)
if (NEW_PREFIX.includes('ask-matt')) ok('split: persona intro keeps the ask-matt marker')
else bad('split: persona intro keeps the ask-matt marker')

const ctx = await bootHarness([
  // old-style: the workflow rides in the persona prefix (git HEAD shape).
  { id: 'matt-old', plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: OLD_PREFIX } },
  ] },
  // new-style: persona intro + workflow-core injection (the #54 shape).
  { id: 'matt-new', plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: NEW_PREFIX } },
    { id: 'workflow-core', name: WORKFLOW_CORE },
  ] },
  // AC2: another preset mounts workflow-core with ONE row.
  { id: 'other-preset', plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a minimal agent.' } },
    { id: 'workflow-core', name: WORKFLOW_CORE, config: { scope: 'all' } },
  ] },
  // Spike fixture: an injected section that itself references the prompt
  // variables — proves interpolation happens at the injection point.
  { id: 'spike-vars', plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a minimal agent.' } },
    { id: 'workflow-core', name: WORKFLOW_CORE, config: {
      scope: 'all',
      text: 'Spike session on {{model}} in {{cwd}}.\n\nMAIN FLOW — idea → ship:',
    } },
  ] },
  // G1: default marker scope, marker-less persona → nothing injected.
  { id: 'markerless', plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a plain agent.' } },
    { id: 'workflow-core', name: WORKFLOW_CORE },
  ] },
  // E1: new-style mount + enforcer — gates must still flow.
  { id: 'matt-new-enforced', plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: NEW_PREFIX } },
    { id: 'workflow-core', name: WORKFLOW_CORE },
    { id: 'workflow-enforcer', name: ENFORCER_PLUGIN, config: { baseline: true } },
  ] },
])

const render = async (id, cwd) => {
  const handle = await ctx.agents.create({
    sessionId: SessionId('wc-' + id),
    meta: { cwd },
    agentOptions: { provider: 'mock', model: 'mock-model-1' },
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, id),
  })
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, new AbortController().signal))
  const text = renderPrompt(assembly)
  await handle.dispose()
  return text
}

const signal = new AbortController().signal

// ── S1: spike — interpolation at the injection point ────────────────────────
const spike = await render('spike-vars', '/tmp/wc-spike-cwd')
if (spike.includes('Spike session on mock-model-1 in /tmp/wc-spike-cwd.')) {
  ok('S1. {{model}}/{{cwd}} interpolate inside the plugin-injected section (spike proven)')
} else {
  bad('S1. spike: interpolation at injection point', spike.slice(0, 300))
}
if (spike.includes('{{model}}') || spike.includes('{{cwd}}')) bad('S1b. no literal {{…}} remains', spike.slice(0, 300))
else ok('S1b. no literal {{…}} remains in the injected text')

// ── L1: verbatim-identical injection diff ───────────────────────────────────
const oldPrompt = await render('matt-old', '/tmp/wc-l1-cwd')
const newPrompt = await render('matt-new', '/tmp/wc-l1-cwd')
if (oldPrompt === newPrompt) {
  ok('L1. model-facing prompt verbatim-identical (old persona-carried vs new plugin-injected)', `${oldPrompt.length} chars`)
} else {
  bad('L1. verbatim-identical prompt')
  let i = 0
  while (i < oldPrompt.length && i < newPrompt.length && oldPrompt[i] === newPrompt[i]) i++
  console.error(`  first divergence at offset ${i}:\n    old: ${JSON.stringify(oldPrompt.slice(i, i + 120))}\n    new: ${JSON.stringify(newPrompt.slice(i, i + 120))}`)
  console.error(`  lengths old=${oldPrompt.length} new=${newPrompt.length}`)
}

// ── AC2: one-row mount for a non-matt preset ────────────────────────────────
const other = await render('other-preset', '/tmp/wc-other-cwd')
if (other.includes('WORKFLOW ENFORCEMENT') && other.includes('BATCH MODE')) ok('AC2. non-matt preset receives the workflow text via one plugin row')
else bad('AC2. one-row mount text', other.slice(0, 200))

// ── G1: marker scope guard ──────────────────────────────────────────────────
const markerless = await render('markerless', '/tmp/wc-plain-cwd')
if (!markerless.includes('MAIN FLOW — idea → ship')) ok('G1. marker-less session receives nothing (default scope)')
else bad('G1. marker scope guard', markerless.slice(0, 200))

// ── E1: enforcer still works on the new-style mount ─────────────────────────
const enforced = await render('matt-new-enforced', '/tmp/wc-enf-cwd')
if (enforced.includes('WORKFLOW GATES')) ok('E1. workflow-enforcer still injects gates on the new-style mount')
else bad('E1. enforcer scope after the split', enforced.slice(0, 300))

console.log('\n=== WORKFLOW-CORE VERIFY RESULTS ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
