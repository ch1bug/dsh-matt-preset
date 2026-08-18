/**
 * verify-persona.mjs — the preset persona IS the system prompt: the full
 * ask-matt workflow text lives in the persona row, and {{model}}/{{cwd}}
 * must interpolate at render time. Mounts a smoke preset with the persona
 * row, creates an agent with a model route + cwd, renders the prompt, and
 * asserts both variables resolved and the workflow marker is present.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

const SHIPPED = process.env.DSH_SHIPPED_PRESETS ?? '/home/bh4gxf/.npm-global/lib/node_modules/@deepseek-ai/dsh/config/agent-presets'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

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

const root = await mkdtemp(join(tmpdir(), 'dsh-persona-'))
await mkdir(join(root, 'personasmoke'))
const personaText = [
  'You are a coding agent powered by the {{model}} model.',
  'Working directory: {{cwd}}.',
  '',
  'ask-matt-workflow-marker: route work through the workflow map.',
].join('\n')
await writeFile(join(root, 'personasmoke', 'agent.cordis.yml'), [
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    text: |',
  ...personaText.split('\n').map(line => '      ' + line),
  '',
].join('\n'))
await ctx.plugin(AgentPresets, { default: 'standard', roots: [{ path: root, trust: 'user' }], includeUserRoot: false })

const sel = ctx.agentDefaultModel.currentSelection()
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
