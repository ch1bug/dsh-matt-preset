/**
 * verify-lang-asm — 真实 matt persona + lang 段的系统提示词组装验证。
 *
 * #23 适配：0.2.0-rc.2 挂载面（dsh-agent-preset(-registry) 声明式 preset +
 * registry mount）。旧版直接 ctx.plugin(SystemPrompt, { persona }) 并裸发
 * session/event，在 rc.2 下 persona 键（`text:`→`prefix:`）、事件驱动
 * （eager projection 需 seq）双重过时，persona 段恒为空、套件空转退出 0。
 *
 * 现挂载真实 dsh-matt-preset（同 verify-lang-count 的成熟挂载式），断言：
 *   - 真实 persona 段非空（>100 字符）；
 *   - WORKFLOW GATES 轮1注入恰 1 次；
 *   - .rs 工具调用后 "⚠ lang:rust" 触发注入恰 1 次；
 *   - LANG rust 基线全程仅 1 次（session 级）。
 */
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { bootHarness, emitSessionEvent, ensurePresetMountable, parsePlugins, resolveLocalNames, disableRows } from './preset-harness.mjs'

const PRESET_DIR = fileURLToPath(new URL('..', import.meta.url))

const root = await mkdtemp(join(tmpdir(), 'lang-asm-'))
const rustDir = join(root, 'rust-proj')
await mkdir(rustDir, { recursive: true })
await writeFile(join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n')

// 同 verify-lang-count：harness 缺 host 服务的行 disable（不携带提示词段，
// registry 拒绝带不可用行的 preset）。
const HARNESS_DISABLED = ['delegation', 'compaction', 'tool-pwsh', 'tool-fs', 'str-replace-editor', 'tool-jobs']
const mattPlugins = disableRows(resolveLocalNames(parsePlugins(
  await readFile(join(PRESET_DIR, 'agent.cordis.yml'), 'utf8'),
  pathToFileURL(PRESET_DIR).href + '/',
), PRESET_DIR), HARNESS_DISABLED)
const ctx = await bootHarness([{ id: 'dsh-matt-preset', plugins: mattPlugins }])
await ensurePresetMountable(ctx, 'dsh-matt-preset')

const signal = new AbortController().signal
const count = (text, needle) => text.split(needle).length - 1

const handle = await ctx.agents.create({
  sessionId: SessionId('lang-asm'),
  meta: { cwd: rustDir },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'dsh-matt-preset'),
})
const agent = handle.agent
const render = async () => renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent, signal)))

const failures = []
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures.push(name)
}

const r1 = await render()
check('真实 persona 组装非空（>100 字符）', r1.length > 100, `len=${r1.length}`)
check('persona 携带 ask-matt 标记', r1.includes('ask-matt'))
check('GATES 轮1注入恰 1 次', count(r1, 'WORKFLOW GATES') === 1, `GATES=${count(r1, 'WORKFLOW GATES')}`)
check('LANG rust 基线轮1注入（session 级一次）', count(r1, 'LANG rust') === 1, `LANGBASE=${count(r1, 'LANG rust')}`)

await emitSessionEvent(ctx, agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 1, name: 'str_replace_editor', arguments: JSON.stringify({ path: join(rustDir, 'src', 'main.rs') }) },
})
const r3 = await render()
check('⚠ lang:rust 触发注入恰 1 次（.rs 调用后）', count(r3, '⚠ lang:rust') === 1, `LANGTRIGGER=${count(r3, '⚠ lang:rust')}`)
check('LANG rust 基线不重复（session 级一次，触发轮只带触发注记）', count(r3, 'LANG rust') === 0, `LANGBASE=${count(r3, 'LANG rust')}`)

await handle.dispose()
console.log(`\n=== LANG-ASM VERIFY ${failures.length === 0 ? 'PASS' : 'FAIL'} ===`)
process.exit(failures.length === 0 ? 0 : 1)
