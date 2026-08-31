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
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Commands from '@deepseek-ai/dsh-commands'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'

const SHIPPED = process.env.DSH_SHIPPED_PRESETS ?? 'C:/Users/lihao/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/config/agent-presets'
const MATT_COMPOSITION = process.env.MATT_COMPOSITION ?? fileURLToPath(new URL('../agent.cordis.yml', import.meta.url))
const PLUGIN = fileURLToPath(new URL('../workflow-enforcer.mjs', import.meta.url))

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

/** Extract the persona text: `text: |` block scalar or `text: <inline>`. */
async function personaText(path) {
  const lines = (await readFile(path, 'utf8')).split('\n')
  const start = lines.findIndex(line => line.includes('text:'))
  if (start < 0) throw new Error(`no text: in ${path}`)
  const inline = lines[start].match(/^\s*text:\s*(.*)$/)?.[1]
  if (inline !== undefined && inline !== '|') return inline
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}/.test(lines[i]) || lines[i].trim() === '') out.push(lines[i].slice(6))
    else if (out.length > 0) break
  }
  return out.join('\n')
}

const MATT_PERSONA = await personaText(MATT_COMPOSITION)
const MINIMAL_PERSONA = await personaText(join(SHIPPED, 'minimal', 'agent.cordis.yml'))

if (!MATT_PERSONA.includes('ask-matt')) bad('precondition: real matt persona carries the ask-matt marker')
else ok('precondition: real matt persona carries the ask-matt marker', `(${MATT_PERSONA.length} chars)`)

const ctx = new Context()
ctx.baseUrl = pathToFileURL(SHIPPED).href + '/'
await ctx.plugin(Loader)
ctx.loader.builtins.include = Include
ctx.loader.builtins.group = Group
await ctx.plugin(LlmRuntime)
await ctx.plugin(SessionStore)
await ctx.plugin(SystemPrompt, { persona: '' })
await ctx.plugin(ToolRuntime)
await ctx.plugin(Commands)
await ctx.plugin(SubprocessLocal)
await ctx.plugin(AgentRegistry)
await ctx.plugin(AgentLoop, { agents: [] })
await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })

const root = await mkdtemp(join(tmpdir(), 'dsh-prod-'))
const smoke = async (id, persona) => {
  await mkdir(join(root, id))
  await writeFile(join(root, id, 'agent.cordis.yml'), [
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    text: |',
    ...persona.split('\n').map(line => '      ' + line),
    '- id: workflow-enforcer',
    `  name: ${PLUGIN}`,
    '',
  ].join('\n'))
  const handle = await ctx.agents.create({
    sessionId: SessionId('prod-' + id),
    meta: { cwd: '/tmp/dsh-prod-cwd' },
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, id),
  })
  return handle
}
await ctx.plugin(AgentPresets, { default: 'standard', roots: [{ path: root, trust: 'user' }], includeUserRoot: false })
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
await ctx.emit('session/event', mattAgent.session, {
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
