/**
 * verify-lang-count — 真机复现"系统提示词注入次数过多"（2026-09-02）。
 *
 * 挂载真实 dsh-matt-preset，同一 agent 连续四轮 system-prompt 渲染
 * （第 2、3 轮之间夹一次 .rs 工具调用），统计渲染文本中各注入标记的
 * 出现次数：
 *   - "WORKFLOW GATES"（enforcer 基线）：每轮 1 次是设计；
 *   - "LANG rust"（lang 基线）：应全程只 1 次（session 一次）；
 *   - "⚠ lang:rust"（lang 触发）：应只在工具调用后的那一轮 1 次。
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
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
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'

const PRESET_DIR = fileURLToPath(new URL('..', import.meta.url))
const SHIPPED = process.env.DSH_SHIPPED_PRESETS ?? 'C:/Users/lihao/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/config/agent-presets'

const root = await mkdtemp(join(tmpdir(), 'lang-count-'))
const rustDir = join(root, 'rust-proj')
await mkdir(rustDir, { recursive: true })
await writeFile(join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n')

const ctx = new Context()
ctx.baseUrl = pathToFileURL(SHIPPED).href + '/'
await ctx.plugin(Loader)
ctx.loader.builtins.include = Include
ctx.loader.builtins.group = Group
await ctx.plugin(LlmRuntime)
await ctx.plugin(SessionStore)
await ctx.plugin(SystemPrompt, { persona: '' })
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(SessionProjectionCache)
await ctx.plugin(AgentLoop, { agents: [] })
await new Promise(r => setTimeout(r, 300)) // alpha.4: factory 注册是异步的，立即 create 会 NO_FACTORY
await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })

const presetsRoot = join(root, 'presets')
await mkdir(presetsRoot)
const { symlink } = await import('node:fs/promises')
await symlink(PRESET_DIR, join(presetsRoot, 'dsh-matt-preset'), 'junction')
await ctx.plugin(AgentPresets, { default: 'standard', roots: [{ path: presetsRoot, trust: 'user' }], includeUserRoot: false })

const signal = new AbortController().signal
const count = (text, needle) => text.split(needle).length - 1
const stat = (label, text) => console.log(
  `${label}: GATES=${count(text, 'WORKFLOW GATES')} LANGBASE=${count(text, 'LANG rust')} LANGTRIGGER=${count(text, '⚠ lang:rust')} (len=${text.length})`)

const handle = await ctx.agents.create({
  sessionId: SessionId('lang-count'),
  meta: { cwd: rustDir },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'dsh-matt-preset'),
})
const agent = handle.agent
const render = async () => renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent, signal)))

stat('轮1(初始)      ', await render())
stat('轮2(无调用)    ', await render())
await ctx.emit('session/event', agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 1, name: 'str_replace_editor', arguments: JSON.stringify({ path: join(rustDir, 'src', 'main.rs') }) },
})
stat('轮3(.rs调用后) ', await render())
stat('轮4(无新调用)  ', await render())

await handle.dispose()
await ctx.stop()
