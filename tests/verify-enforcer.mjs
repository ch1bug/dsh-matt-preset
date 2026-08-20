/**
 * verify-enforcer.mjs — V1–V4 acceptance for dsh-workflow-enforcer.
 *
 *  V1 mount smoke: a preset row mounting workflow-enforcer mounts clean.
 *  V2 baseline: every prompt assembly renders a WORKFLOW GATES section.
 *  V3 high-risk instant: after a tool/call matching the gates, the next
 *     assembly carries a one-shot "High-risk action detected" line.
 *  V4 no noise: a benign tool/call adds no ⚠ line; baseline stays single.
 *
 * Run with the same dep wiring as the deployment (node_modules/@deepseek-ai
 * pointing at the dsh install), like the matt-preset verify suite.
 */
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
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Commands from '@deepseek-ai/dsh-commands'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

const SHIPPED = process.env.DSH_SHIPPED_PRESETS ?? '/home/bh4gxf/.npm-global/lib/node_modules/@deepseek-ai/dsh/config/agent-presets'
const PLUGIN = fileURLToPath(new URL('../workflow-enforcer.mjs', import.meta.url))

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
await ctx.plugin(TokenMeter)

// V1: smoke preset with only the workflow-enforcer row, inside a temp root.
const root = await mkdtemp(join(tmpdir(), 'dsh-enforcer-'))
await mkdir(join(root, 'enforcersmoke'))
await writeFile(join(root, 'enforcersmoke', 'agent.cordis.yml'), [
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    text: probe persona running the ask-matt workflow',
  '- id: workflow-enforcer',
  `  name: ${PLUGIN}`,
  '',
].join('\n'))
await ctx.plugin(AgentPresets, { default: 'standard', roots: [{ path: root, trust: 'user' }], includeUserRoot: false })

try {
  await ctx.agentPresets.standingKeyFor('enforcersmoke')
  ok('V1. standingKeyFor(enforcersmoke) mounts clean')
} catch (error) {
  bad('V1. standingKeyFor', String(error?.message ?? error))
  throw error
}

const handle = await ctx.agents.create({
  sessionId: SessionId('enforcer-smoke'),
  meta: { cwd: '/tmp/dsh-enforcer-cwd' },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
const agent = handle.agent
const signal = new AbortController().signal

const render = async () => {
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent, signal))
  return renderPrompt(assembly)
}

// V2: baseline reminder present on a plain assembly.
const base = await render()
if (base.includes('WORKFLOW GATES')) ok('V2. baseline reminder injected on every assembly')
else bad('V2. baseline reminder', base.slice(0, 300))

// V3: a matched high-risk tool/call fires a one-shot ⚠ line on the next assembly.
await ctx.emit('session/event', agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 1, name: 'bash', arguments: JSON.stringify({ command: 'git push origin main' }) },
})
const afterHit = await render()
if (afterHit.includes('High-risk action detected') && afterHit.includes('git push origin main')) {
  ok('V3. matched call → one-shot ⚠ reminder on next assembly')
} else {
  bad('V3. high-risk reminder', afterHit.slice(0, 400))
}

// V3b: the ⚠ line is consumed — the next assembly shows baseline only.
const afterConsumed = await render()
if (!afterConsumed.includes('High-risk action detected')) ok('V3b. ⚠ reminder consumed after firing (no repeat)')
else bad('V3b. consumed once', afterConsumed.slice(0, 300))

// V4: a benign tool/call adds no ⚠ line.
await ctx.emit('session/event', agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 2, name: 'bash', arguments: JSON.stringify({ command: 'echo hello' }) },
})
const afterBenign = await render()
if (!afterBenign.includes('High-risk action detected')) ok('V4. benign call adds no ⚠ line')
else bad('V4. benign call', afterBenign.slice(0, 300))

// V5: scope — a session WITHOUT the ask-matt marker gets no reminder.
await mkdir(join(root, 'noscope'))
await writeFile(join(root, 'noscope', 'agent.cordis.yml'), [
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    text: plain minimal persona',
  '- id: workflow-enforcer',
  `  name: ${PLUGIN}`,
  '',
].join('\n'))
const handleNoScope = await ctx.agents.create({
  sessionId: SessionId('enforcer-noscope'),
  meta: { cwd: '/tmp/dsh-enforcer-cwd' },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'noscope'),
})
const noScopeAgent = handleNoScope.agent
const noScopeAssembly = await ctx.systemPrompt.assemble(assembleContextFor(noScopeAgent, signal))
const noScopeText = renderPrompt(noScopeAssembly)
if (!noScopeText.includes('WORKFLOW GATES')) ok('V5. sessions without the ask-matt marker get no reminder (scope)')
else bad('V5. scope', noScopeText.slice(0, 200))
await handleNoScope.dispose()

// V6: a high-risk command containing template braces ({{.Name}}) must not
// break prompt rendering — the injected reminder neutralizes them.
await ctx.emit('session/event', agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 3, name: 'bash', arguments: JSON.stringify({ command: 'gh issue create --body "{{.Name}} template"' }) },
})
let v6ok = true
let v6text = ''
try {
  v6text = await render()
  if (v6text.includes('{{') || v6text.includes('}}')) v6ok = false
} catch (error) {
  v6ok = false
  v6text = String(error?.message ?? error)
}
if (v6ok && v6text.includes('High-risk action detected')) ok('V6. {{…}} in a matched command does not break rendering (braces neutralized)')
else bad('V6. template-brace injection', v6text.slice(0, 300))

// V7: contextEvidence pure-function — real numbers shape a verifiable line;
// unmeasurable sessions degrade to null (no line, no noise).
import { contextEvidence } from '../workflow-enforcer.mjs'
const fakeCtx = (total, input, cached, window) => ({
  get: () => ({ measure: () => ({
    totalTokens: total,
    baseline: { kind: 'usage', usage: { inputTokens: input, cacheReadTokens: cached } },
  }) }),
})
const fakeAgent = (window) => ({ session: { requestContext: () => ({ contextWindow: window }) } })
const line = contextEvidence(fakeAgent(1000000), fakeCtx(62000, 40000, 24000))
const expected = 'context: 62k used / 1000k (6%) · cache-read 38%'
if (line === expected) ok('V7. contextEvidence shapes used/capacity/cache-read', line)
else bad('V7. contextEvidence', `got: ${line} | want: ${expected}`)
if (contextEvidence(fakeAgent(1000000), fakeCtx(0, 0, 0)) === null) ok('V7b. unmeasurable → null (no noise)')
else bad('V7b. null degradation')
// fold-intent arming: harness event arms, assemble consumes (no crash, scope intact)
await ctx.emit('session/event', agent.session, {
  type: 'text-chunks',
  data: { texts: ['确认存量清理范围，#408 独立票一并处理，窗口健康可并入'] },
})
const v7c = await render()
const v7d = await render()
if (!v7d.includes('context:') && v7d.includes('WORKFLOW GATES')) ok('V7c. fold-in arming consumes cleanly (degraded, no crash)')
else bad('V7c. fold-in arming', v7d.slice(-150))

// V8: user assessment queries arm context evidence (source-level: the
// keyword set covers assessment language, and the event branch accepts
// user/message — real user messages arrive via agent-loop, not manual emit).
import { FOLD_KEYWORDS } from '../workflow-enforcer.mjs'
const assessmentWords = ['评估', '容量', '上下文', '还能装']
const covered = assessmentWords.every(w => FOLD_KEYWORDS.includes(w))
if (covered) ok('V8. assessment keywords armed for user queries', assessmentWords.join('/'))
else bad('V8. assessment keywords', FOLD_KEYWORDS.join(','))

// V9: a matched git push carries the remote-CI follow-up ("done means CI green").
await ctx.emit('session/event', agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 9, name: 'bash', arguments: JSON.stringify({ command: 'git push origin develop' }) },
})
const v9 = await render()
if (v9.includes('remote CI run') && v9.includes('CI green')) ok('V9. git push → remote-CI reminder (done means CI green)')
else bad('V9. push CI reminder', v9.slice(-220))

// V10: context_status tool (model-driven) returns measured numbers.
agent.session.append('turn/start', { turn: 9 })
agent.session.append('step/start', { turn: 9, step: 1 })
agent.session.append('assistant/message', { turn: 9, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'some measurable context content for the meter' }] } }, { surfaceOp: 'append' })
const cs = await ctx.tools.execute({
  callId: CallId('v10-cs'), name: 'context_status', arguments: {}, agent, signal: new AbortController().signal,
})
const csText = cs.isError === false ? (cs.value?.text ?? '') : `error ${cs.error}`
if (csText.includes('context:') && csText.includes('used')) ok('V10. context_status tool returns measured context', csText.slice(0, 60))
else bad('V10. context_status', csText.slice(0, 120))

await handle.dispose()
console.log('\n=== WORKFLOW-ENFORCER VERIFY (V1–V10) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
