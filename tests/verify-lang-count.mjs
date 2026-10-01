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
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'
import { bootHarness, emitSessionEvent, ensurePresetMountable, parsePlugins, resolveLocalNames, disableRows } from './preset-harness.mjs'

const PRESET_DIR = fileURLToPath(new URL('..', import.meta.url))
const PRESET_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const root = await mkdtemp(join(tmpdir(), 'lang-count-'))
const rustDir = join(root, 'rust-proj')
await mkdir(rustDir, { recursive: true })
await writeFile(join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n')

// Mount the REAL dsh-matt-preset: the repo's agent.cordis.yml body parsed in
// the entry-list dialect and registered as a preset declaration (#9: the
// registry no longer scans directory roots). Rows needing the real Host
// stack (delegation/compaction isolated groups; sandboxPolicy-confined
// fs/shell tools; jobs) cannot activate in this harness and carry no prompt
// sections — disable them for this prompt-count test (the new registry
// refuses presets with unusable rows).
const HARNESS_DISABLED = ['delegation', 'compaction', 'tool-pwsh', 'tool-fs', 'str-replace-editor', 'tool-jobs']
const mattPlugins = disableRows(resolveLocalNames(parsePlugins(
  await readFile(join(PRESET_DIR, 'agent.cordis.yml'), 'utf8'),
  pathToFileURL(PRESET_DIR).href + '/',
), PRESET_ROOT), HARNESS_DISABLED)
const ctx = await bootHarness([{ id: 'dsh-matt-preset', plugins: mattPlugins }])
await ctx.plugin(SessionProjectionCache)
await ensurePresetMountable(ctx, 'dsh-matt-preset')

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
await emitSessionEvent(ctx, agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 1, name: 'str_replace_editor', arguments: JSON.stringify({ path: join(rustDir, 'src', 'main.rs') }) },
})
stat('轮3(.rs调用后) ', await render())
stat('轮4(无新调用)  ', await render())

await handle.dispose()
