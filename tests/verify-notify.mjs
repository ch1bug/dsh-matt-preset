import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Commands from '@deepseek-ai/dsh-commands'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'

// The deployment's shipped preset dir; override with DSH_SHIPPED_PRESETS on other machines.
const SHIPPED = process.env.DSH_SHIPPED_PRESETS ?? '/home/bh4gxf/.npm-global/lib/node_modules/@deepseek-ai/dsh/config/agent-presets'
// Repo-relative: tests/verify-notify.mjs -> the repo root, which IS the matt preset directory.
const MATT_DIR = fileURLToPath(new URL('..', import.meta.url))

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

const root = await mkdtemp(join(tmpdir(), 'dsh-notify-'))
await mkdir(join(root, 'notifysmoke'))
await writeFile(join(root, 'notifysmoke', 'agent.cordis.yml'), [
  '- id: job-fail',
  '  name: ' + join(MATT_DIR, 'scheduled-jobs.mjs'),
  '  config:',
  '    id: job-fail',
  '    schedule: "* * * * * *"',
  '    command: "exit 3"',
  '    runOnMount: false',
  '    notifyOnFailure: true',
  '    notifySessionId: "notify-target-session"',
  '    tickSeconds: 1',
  '',
].join('\n'))
await ctx.plugin(AgentPresets, { default: 'standard', roots: [{ path: root, trust: 'user' }], includeUserRoot: false })

const handle = await ctx.agents.create({
  sessionId: SessionId('notify-target-session'),
  meta: {},
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'notifysmoke'),
})
const agent = handle.agent

let found = false
for (let i = 0; i < 12; i++) {
  await new Promise(r => setTimeout(r, 500))
  const events = agent.session.events
  const userMsg = events.find(ev => ev.type === 'user/message')
  const parts = userMsg ? (Array.isArray(userMsg.data?.content) ? userMsg.data.content : []) : []
  const text = parts.map(p => p?.text ?? '').join('')
  if (/\[定时任务失败\] job-fail/.test(text)) {
    found = true
    console.log('✓ failing job delivered followup to live session:', JSON.stringify(text.slice(0, 120)))
    break
  }
}
if (!found) {
  console.log('✗ no failure followup; events=', agent.session.events.map(ev => ev.type).join(','))
  process.exitCode = 1
}
await handle.dispose()
console.log('notify test done')
