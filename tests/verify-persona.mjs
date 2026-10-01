/**
 * verify-persona.mjs — the preset persona IS the system prompt: the full
 * ask-matt workflow text lives in the persona row, and {{model}}/{{cwd}}
 * must interpolate at render time. Mounts a smoke preset with the persona
 * row, creates an agent with a model route + cwd, renders the prompt, and
 * asserts both variables resolved and the workflow marker is present.
 */
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { bootHarness } from './preset-harness.mjs'

const personaText = [
  'You are a coding agent powered by the {{model}} model.',
  'Working directory: {{cwd}}.',
  '',
  'ask-matt-workflow-marker: route work through the workflow map.',
].join('\n')
const ctx = await bootHarness([
  { id: 'personasmoke', plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: personaText } },
  ] },
])

const sel = ctx.agentDefaultModel.currentSelection()

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const handle = await ctx.agents.create({
  sessionId: SessionId('persona-smoke'),
  meta: { cwd: '/tmp/persona-cwd' },
  agentOptions: { provider: sel.provider, model: sel.model },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'personasmoke'),
})
const agent = handle.agent

const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent, new AbortController().signal))
const text = renderPrompt(assembly)

if (text.includes('ask-matt-workflow-marker')) ok('persona renders the workflow text')
else bad('persona renders the workflow text', text.slice(0, 200))
if (text.includes('powered by the mock model')) ok('{{model}} interpolated', 'model=mock')
else bad('{{model}} interpolated', text.slice(0, 300))
if (text.includes('/tmp/persona-cwd')) ok('{{cwd}} interpolated', 'cwd=/tmp/persona-cwd')
else bad('{{cwd}} interpolated', text.slice(0, 300))
if (!text.includes('{{model}}') && !text.includes('{{cwd}}')) ok('no literal {{…}} remains')
else bad('no literal {{…}} remains', text.slice(0, 300))

await handle.dispose()
console.log('\n=== PERSONA RENDER RESULTS ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
