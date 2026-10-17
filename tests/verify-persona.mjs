/**
 * verify-persona.mjs — the preset persona IS the system prompt: the full
 * ask-matt workflow text lives in the persona row, and {{model}}
 * must interpolate at render time. Mounts a smoke preset with the persona
 * row, creates an agent with a model route + cwd, renders the prompt, and
 * asserts the variable resolved, the workflow marker is present, and that a
 * `{{cwd}}` reference is **refused** (upstream 0.2.1 no longer registers it).
 */
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { bootHarness } from './preset-harness.mjs'

const personaText = [
  'You are a coding agent powered by the {{model}} model.',
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
if (!text.includes('{{model}}')) ok('no literal {{…}} remains')
else bad('no literal {{…}} remains', text.slice(0, 300))

// 0.2.1（#89）契约锚：`cwd` **不再是**内置变量——上游只注册 `provider` / `model`
// （0.2.1 删掉了 agent-loop 里的 `variable('cwd', …)`）。含 {{cwd}} 的 persona 必须在
// **渲染前响亮失败**：这正是 #89 把导语里那句 "Your working directory is {{cwd}}." 删掉的原因。
// 这条断言若反过来（不抛了），说明上游又把变量加回来了 → 必须重查 #89 的前提。
let cwdRefused = false
try {
  const trapCtx = await bootHarness([
    { id: 'cwd-trap', plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'Working directory is {{cwd}}.' } },
    ] },
  ])
  const trap = await trapCtx.agents.create({
    sessionId: SessionId('persona-cwd-trap'),
    meta: { cwd: '/tmp/persona-cwd' },
    agentOptions: { provider: sel.provider, model: sel.model },
    setup: async (agentCtx) => void await trapCtx.agentPresets.mount(agentCtx, 'cwd-trap'),
  })
  const trapAssembly = await trapCtx.systemPrompt.assemble(assembleContextFor(trap.agent, new AbortController().signal))
  renderPrompt(trapAssembly)
  await trap.dispose()
} catch (error) {
  cwdRefused = /unknown prompt variable/i.test(String(error?.message ?? error))
}
if (cwdRefused) ok('{{cwd}} 已不是内置变量：含它的 persona 在渲染前响亮失败（0.2.1 契约）')
else bad('{{cwd}} 渲染没有抛错 —— 上游契约可能又变了，重查 #89')

await handle.dispose()
console.log('\n=== PERSONA RENDER RESULTS ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
