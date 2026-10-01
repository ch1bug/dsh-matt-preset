/**
 * verify-production.mjs — production-grade V-1/2/3 for dsh-workflow-enforcer,
 * runnable without a GUI session.
 *
 * Uses the REAL texts the production sessions will see:
 *   - the matt persona block, extracted from ~/.dsh/.agent-presets/matt/
 *     agent.cordis.yml (this is what makes the ask-matt marker match),
 *   - the REAL minimal persona from the shipped minimal preset (this is what
 *     scope must NOT touch),
 *   - the REAL bundle file (workflow-enforcer.mjs) this repo ships.
 *
 * V1: real matt persona + enforcer → WORKFLOW GATES baseline injected.
 * V2: real matt persona + a git push tool/call → one-shot ⚠ reminder.
 * V3: real minimal persona + enforcer → NO reminder (scope).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { AgentPreset, RUNTIME, bootHarness, smokePlugins, emitSessionEvent } from './preset-harness.mjs'

const MATT_COMPOSITION = process.env.MATT_COMPOSITION ?? fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))
const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

/** Extract the persona prefix: `prefix: |` block scalar or `prefix: <inline>`. */
async function personaPrefix(path) {
  const lines = (await readFile(path, 'utf8')).split('\n')
  const start = lines.findIndex(line => /^\s*prefix:/.test(line))
  if (start < 0) throw new Error(`no prefix: in ${path}`)
  const inline = lines[start].match(/^\s*prefix:\s*(.*)$/)?.[1]
  if (inline !== undefined && inline !== '|') return inline
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}/.test(lines[i]) || lines[i].trim() === '') out.push(lines[i].slice(6))
    else if (out.length > 0) break
  }
  return out.join('\n')
}

const MATT_PERSONA = await personaPrefix(MATT_COMPOSITION)

// The shipped minimal preset's persona: a `@deepseek-ai/dsh-persona` row
// inside the runtime's presets/minimal.patch.yml overlay.
const findPersona = (node) => {
  if (Array.isArray(node)) {
    for (const item of node) { const hit = findPersona(item); if (hit !== undefined) return hit }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  if (node.id === 'persona' && typeof node.config?.prefix === 'string') return node.config.prefix
  for (const value of Object.values(node)) {
    const hit = findPersona(value)
    if (hit !== undefined) return hit
  }
  return undefined
}
const minimalPatch = parse(await readFile(join(RUNTIME, 'dsh-web-app', 'presets', 'minimal.patch.yml'), 'utf8'))
const MINIMAL_PERSONA = findPersona(minimalPatch)

if (!MATT_PERSONA.includes('ask-matt')) bad('precondition: real matt persona carries the ask-matt marker')
else ok('precondition: real matt persona carries the ask-matt marker', `(${MATT_PERSONA.length} chars)`)

const ctx = await bootHarness()

const smoke = async (id, persona) => {
  await ctx.plugin(AgentPreset, { id, plugins: smokePlugins(persona) })
  const handle = await ctx.agents.create({
    sessionId: SessionId('prod-' + id),
    meta: { cwd: '/tmp/dsh-prod-cwd' },
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, id),
  })
  return handle
}
const signal = new AbortController().signal
const render = async (agent) => {
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent, signal))
  return renderPrompt(assembly)
}

// V1: real matt persona → baseline injected.
const matt = await smoke('mattsmoke', MATT_PERSONA)
const mattAgent = matt.agent
const v1 = await render(mattAgent)
if (v1.includes('WORKFLOW GATES')) ok('V1. real matt persona → WORKFLOW GATES baseline injected')
else bad('V1. baseline with real persona', v1.slice(0, 300))

// V2: real matt persona + git push call → one-shot ⚠ on next assembly.
await emitSessionEvent(ctx, mattAgent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 1, name: 'bash', arguments: JSON.stringify({ command: 'git push --dry-run origin main' }) },
})
const v2 = await render(mattAgent)
if (v2.includes('High-risk action detected') && v2.includes('git push --dry-run')) {
  ok('V2. real persona + git push call → one-shot ⚠ reminder')
} else {
  bad('V2. high-risk with real persona', v2.slice(0, 400))
}
const v2b = await render(mattAgent)
if (!v2b.includes('High-risk action detected')) ok('V2b. ⚠ consumed after firing (no repeat)')
else bad('V2b. consumed once', v2b.slice(0, 200))
await matt.dispose()

// V3: real minimal persona → scope excludes it.
const mini = await smoke('minismoke', MINIMAL_PERSONA)
const miniAgent = mini.agent
const v3 = await render(miniAgent)
if (!v3.includes('WORKFLOW GATES')) ok('V3. real minimal persona → no reminder (scope)')
else bad('V3. scope with minimal persona', v3.slice(0, 300))
await mini.dispose()

console.log('\n=== WORKFLOW-ENFORCER PRODUCTION-GRADE VERIFY ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
