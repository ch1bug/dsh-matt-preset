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
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { AgentPreset, bootHarness, smokePlugins, emitSessionEvent } from './preset-harness.mjs'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

// V1: smoke preset with only the persona + workflow-enforcer rows.
const ctx = await bootHarness([
  { id: 'enforcersmoke', plugins: smokePlugins('probe persona running the ask-matt workflow') },
])

try {
  const v1 = await ctx.agentPresets.resolve('enforcersmoke')
  if (v1.broken === undefined) ok('V1. enforcersmoke activates clean (registry resolve)')
  else throw new Error(v1.broken)
} catch (error) {
  bad('V1. enforcersmoke activation', String(error?.message ?? error))
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
await emitSessionEvent(ctx, agent.session, {
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
await emitSessionEvent(ctx, agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 2, name: 'bash', arguments: JSON.stringify({ command: 'echo hello' }) },
})
const afterBenign = await render()
if (!afterBenign.includes('High-risk action detected')) ok('V4. benign call adds no ⚠ line')
else bad('V4. benign call', afterBenign.slice(0, 300))

// V5: scope — a session WITHOUT the ask-matt marker gets no reminder.
await ctx.plugin(AgentPreset, { id: 'noscope', plugins: smokePlugins('plain minimal persona') })
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
await emitSessionEvent(ctx, agent.session, {
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
// V7a: fake agent WITHOUT usage events falls back to latest-request baseline.
const line = contextEvidence(fakeAgent(1000000), fakeCtx(62000, 40000, 24000))
const expected = 'context: 62k used / 1000k (6%) · cache-read 38% (latest-request)'
if (line === expected) ok('V7. contextEvidence fallback baseline', line)
else bad('V7. contextEvidence', `got: ${line} | want: ${expected}`)
// V7b: fake agent WITH usage events → cumulative share (105k cached / 120k
// billed = 87.5 → rounds to 88), replacing per step (never double-counts).
const fakeWithEvents = { session: { requestContext: () => ({ contextWindow: 1000000 }), events: [
  { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 10000, cacheReadTokens: 90000 } } },
  { type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 5000, cacheReadTokens: 15000 } } },
  { type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 5000, cacheReadTokens: 15000 } } },
] } }
const line2 = contextEvidence(fakeWithEvents, fakeCtx(1000, 0, 0))
const expect2 = 'context: 1k used / 1000k (0%) · cache-read 88% (cumulative)'
if (line2 === expect2) ok('V7b. contextEvidence cumulative share (per-step replace)', line2)
else bad('V7b. contextEvidence', `got: ${line2} | want: ${expect2}`)
if (contextEvidence(fakeAgent(1000000), fakeCtx(0, 0, 0)) === null) ok('V7c. unmeasurable → null (no noise)')
else bad('V7c. null degradation')
// fold-intent arming: harness event arms, assemble consumes (no crash, scope intact)
await emitSessionEvent(ctx, agent.session, {
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
await emitSessionEvent(ctx, agent.session, {
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
  callId: ToolCallId('v10-cs'), name: 'context_status', arguments: {}, agent, signal: new AbortController().signal,
})
const csText = cs.isError === false ? (cs.value?.text ?? '') : `error ${cs.error}`
if (csText.includes('context:') && csText.includes('used')) ok('V10. context_status tool returns measured context', csText.slice(0, 60))
else bad('V10. context_status', csText.slice(0, 120))

// V11: closing a ticket arms ONE fresh-subagent quality spot check on the
// next assembly (self-assessment cannot see its own degradation, O5).
await emitSessionEvent(ctx, agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 11, name: 'bash', arguments: JSON.stringify({ command: 'gh issue close 429 --comment "done"' }) },
})
const v11 = await render()
if (v11.includes('fresh-subagent quality') && v11.includes('O5')) ok('V11. issue close → fresh-subagent spot check nudge (one-shot)')
else bad('V11. close spot-check nudge', v11.slice(-240))
const v11b = await render()
if (!v11b.includes('fresh-subagent quality')) ok('V11b. close nudge consumed after firing (no repeat)')
else bad('V11b. close nudge consumed', v11b.slice(-160))

// V12: creating a ticket arms ONE one-issue-per-session reminder on the next
// assembly — a new ticket is its own session's work, never chained inline
// (observed: #498 session built+fixed+closed #517 while #498 was still open).
await emitSessionEvent(ctx, agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 12, name: 'bash', arguments: JSON.stringify({ command: 'gh issue create --title "new ticket" --body "body" --label needs-triage' }) },
})
const v12 = await render()
if (v12.includes('New ticket created') && v12.includes('ONE ISSUE PER SESSION')) ok('V12. issue create → one-issue-per-session reminder (one-shot)')
else bad('V12. create nudge', v12.slice(-240))
const v12b = await render()
if (!v12b.includes('New ticket created')) ok('V12b. create nudge consumed after firing (no repeat)')
else bad('V12b. create nudge consumed', v12b.slice(-160))

// V13: the baseline carries the routine-actions whitelist — docker compose up,
// cargo build, local commit, read-only queries are NOT external actions and
// need no confirmation (observed: 容器 up 被误列导致 #501 子会话僵等 66 分钟).
const v13 = await render()
if (v13.includes('ROUTINE actions need NO confirmation') && v13.includes('docker compose up')) ok('V13. baseline whitelists routine actions (容器 up / cargo build / local commit)')
else bad('V13. routine whitelist', v13.slice(-240))

// V14: a batch ticket close-out ("本地闭环完成/本会话收尾") arms an
// AUTO-HANDOFF nudge on the next assembly WHEN `.scratch/batch-state.md`
// exists and names a successor — the session must not stop and wait for
// "开下一票" (observed: #500 closed its ticket, knew #501 was next, waited
// 9 min for the human to say so).
// (a) without batch-state.md in the cwd → silent.
await emitSessionEvent(ctx, agent.session, {
  type: 'assistant/message',
  data: { turn: 1, step: 14, message: { role: 'assistant', content: [{ type: 'text', text: '#500 本地闭环完成，本会话收尾。' }] } },
})
const v14a = await render()
if (!v14a.includes('AUTO-HANDOFF')) ok('V14a. close-out without batch-state.md → no nudge')
else bad('V14a. no-batch nudge leaked', v14a.slice(-200))

// (b) with a batch-state.md naming a successor → nudge (one-shot).
const batchRoot = await mkdtemp(join(tmpdir(), 'dsh-enforcer-batch-'))
await mkdir(join(batchRoot, '.scratch'), { recursive: true })
await writeFile(join(batchRoot, '.scratch', 'batch-state.md'), [
  '# Batch State',
  '| 1 | #501 | 本地闭环 |',
  '| 2 | #499 | 待开工 |',
  '',
].join('\n'))
const handle2 = await ctx.agents.create({
  sessionId: SessionId('enforcer-batch'),
  meta: { cwd: batchRoot },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
const agent2 = handle2.agent
const render2 = async () => {
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent2, signal))
  return renderPrompt(assembly)
}
await emitSessionEvent(ctx, agent2.session, {
  type: 'assistant/message',
  data: { turn: 1, step: 14, message: { role: 'assistant', content: [{ type: 'text', text: '本地闭环完成，本会话收尾。' }] } },
})
const v14b = await render2()
if (v14b.includes('AUTO-HANDOFF') && v14b.includes('batch-state.md')) ok('V14b. close-out with batch-state.md → AUTO-HANDOFF nudge (one-shot)')
else bad('V14b. batch nudge missing', v14b.slice(-240))
const v14c = await render2()
if (!v14c.includes('AUTO-HANDOFF')) ok('V14c. batch nudge consumed after firing (no repeat)')
else bad('V14c. batch nudge repeated', v14c.slice(-160))
await handle2.dispose()

// V15: a sandcastle AFK launch (.sandcastle/run-ticket.mts) is an EXTERNAL
// action — the gate ⚠ fires once on the next assembly (sandboxed ticket
// workers stay behind the external-action gate).
await emitSessionEvent(ctx, agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 15, name: 'bash', arguments: JSON.stringify({ command: 'npx tsx .sandcastle/run-ticket.mts --issue 449' }) },
})
const v15 = await render()
if (v15.includes('High-risk action detected') && v15.includes('run-ticket.mts')) ok('V15. sandcastle launch → external-action ⚠ (one-shot)')
else bad('V15. sandcastle gate', v15.slice(-240))
const v15b = await render()
if (!v15b.includes('High-risk action detected')) ok('V15b. sandcastle ⚠ consumed (no repeat)')
else bad('V15b. sandcastle ⚠ repeated', v15b.slice(-160))

await handle.dispose()
console.log('\n=== WORKFLOW-ENFORCER VERIFY (V1–V15) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
