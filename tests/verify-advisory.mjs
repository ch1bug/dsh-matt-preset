import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises'
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
import { Storage } from '@deepseek-ai/dsh-storage'
import * as StorageJsonMod from '@deepseek-ai/dsh-storage-json'
import * as StorageDomainMod from '@deepseek-ai/dsh-storage-domain'
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'

const SHIPPED = '/home/bh4gxf/.npm-global/lib/node_modules/@deepseek-ai/dsh/config/agent-presets'
const MATT = fileURLToPath(new URL('..', import.meta.url))
const StorageJsonPlugin = { name: StorageJsonMod.name, apply: StorageJsonMod.apply, Config: StorageJsonMod.Config, inject: StorageJsonMod.inject }
const StorageDomainPlugin = { name: StorageDomainMod.name, apply: StorageDomainMod.apply, Config: StorageDomainMod.Config, inject: StorageDomainMod.inject }

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
const root = await mkdtemp(join(tmpdir(), 'dsh-advisory-'))
await mkdir(join(root, 'ws'))
await mkdir(join(root, 'preset'))
const flag = join(root, 'ws', '.has-changes')
const changelog = join(root, 'ws', 'CHANGELOG.md')
await writeFile(changelog, '## 2026-08-19 — mattpocock/skills: abc123..def456\n- feat: new skill X\n- fix: em-dash cleanup\n')
await writeFile(flag, '')
await writeFile(join(root, 'preset', 'agent.cordis.yml'), [
  '- id: job-adv',
  `  name: ${MATT}/scheduled-jobs.mjs`,
  '  config:',
  '    id: job-adv',
  '    schedule: "* * * * * *"',
  '    command: "echo sync-ok"',
  '    runOnMount: false',
  '    advisory:',
  `      dir: ${root}/ws`,
  '      title: 上游技能更新待跟进',
  `      flagFile: ${flag}`,
  `      messageFile: ${changelog}`,
  '      preset: preset',
  '      tickSeconds: 1',
  '',
].join('\n'))
await ctx.plugin(Storage)
await ctx.plugin(StorageJsonPlugin, { root: join(root, 'storages') })
await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
await ctx.plugin(WorkspaceRegistry)
const workspace = await ctx.workspaceRegistry.create(join(root, 'ws'))
await ctx.plugin(AgentPresets, { default: 'standard', roots: [{ path: root, trust: 'user' }], includeUserRoot: false })

const handle = await ctx.agents.create({
  sessionId: SessionId('advisory-host'),
  meta: { cwd: join(root, 'ws') },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'preset'),
})
const agent = handle.agent

// run the job → advisory should spawn a session, consume the flag
const out = await ctx.tools.execute({ callId: CallId('adv-run'), name: 'jobs_run', arguments: { id: 'job-adv' }, agent, signal: new AbortController().signal })
const runRow = JSON.parse(out.value.text)
const adv = runRow.advisory
let flagGone = true
try { await access(flag); flagGone = false } catch {}
const sessions = ctx.sessions.list().map(s => String(s.id))
const childId = sessions.find(id => id !== String(agent.session.id))
console.log('job advisory field:', JSON.stringify(adv))
console.log('flag consumed:', flagGone)
console.log('child session created:', childId ?? 'NONE')
if (adv && flagGone && childId) {
  const child = ctx.agents.get(childId)
  const firstUser = child.session.events.find(ev => ev.type === 'user/message')
  const parts = Array.isArray(firstUser?.data?.content) ? firstUser.data.content : []
  const text = parts.map(p => p?.text ?? '').join('')
  console.log('first prompt has summary:', text.includes('mattpocock/skills') && text.includes('跟进'))
  console.log('workspace accounts child:', workspace.sessionIds.map(String).includes(childId))
  console.log('RESULT: PASS')
} else {
  console.log('RESULT: FAIL')
  process.exitCode = 1
}
await handle.dispose()
process.exit(process.exitCode ?? 0)
