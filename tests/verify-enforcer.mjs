/**
 * verify-enforcer.mjs — acceptance for dsh-workflow-enforcer (V1–V20; the
 * structured gate-matching block added by #79 is V18–V20).
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
import { readFileSync } from 'node:fs'
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
import { contextEvidence, DEFAULT_GATES, ACTION_FIELDS, gateMatches } from '../workflow-enforcer.mjs'
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
// C1/#35: the nudge must carry the evidence trio (command, exit code, evidence
// path) and the BLOCKED rule — evidence is part of local closure.
if (v14b.includes('exit code') && v14b.includes('evidence path') && v14b.includes('BLOCKED')) ok('V14b+. close-out nudge carries the evidence trio + BLOCKED rule')
else bad('V14b+. evidence trio missing from close-out nudge', v14b.slice(-240))
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

// V16 (#55): plugin_manager MUTATIONS are external-action events (they change
// the whole profile and can run build scripts), while read-only list_* calls
// stay routine. The creative profile DECLARES install/enable as gate-6 events,
// so the gate list itself must know them — otherwise the injected text and the
// per-turn reminders contradict each other ("this list is exhaustive").
await emitSessionEvent(ctx, agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 16, name: 'plugin_manager', arguments: JSON.stringify({ action: 'list_plugins' }) },
})
const v16a = await render()
if (!v16a.includes('High-risk action detected')) ok('V16a. read-only plugin_manager list → no ⚠ (routine)')
else bad('V16a. read-only plugin_manager gated', v16a.slice(-240))

await emitSessionEvent(ctx, agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 17, name: 'plugin_manager', arguments: JSON.stringify({ action: 'install_bundle', target: 'pkg@1.0.0' }) },
})
const v16b = await render()
if (v16b.includes('High-risk action detected') && v16b.includes('plugin_manager')) ok('V16b. plugin_manager install_bundle → external-action ⚠ (one-shot)')
else bad('V16b. plugin_manager mutation gate', v16b.slice(-240))
const v16c = await render()
if (!v16c.includes('High-risk action detected')) ok('V16c. plugin_manager ⚠ consumed after firing (no repeat)')
else bad('V16c. plugin_manager ⚠ repeated', v16c.slice(-160))

// V17: the docs gate table and DEFAULT_GATES must not drift. The table HAD
// already gone stale (missing `sandcastle`/`run-ticket`, found while wiring
// #55's plugin_manager entries) — a prose list next to a code list always
// drifts without a check. Offline, bidirectional: every documented gate is
// declared, and every declared gate is documented (each written in full).
const docGates = readFileSync(new URL('../docs/workflow-enforcer.md', import.meta.url), 'utf8')
  .split('\n')
  .filter(line => /^\|\s*(external|destructive)\s*\|/.test(line))
  .flatMap(line => [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]))
const declaredGates = [...DEFAULT_GATES.external, ...DEFAULT_GATES.destructive]
const undocumented = declaredGates.filter(g => !docGates.includes(g))
const invented = docGates.filter(g => !declaredGates.includes(g))
if (undocumented.length === 0 && invented.length === 0)
  ok('V17. docs gate table ↔ DEFAULT_GATES agree (bidirectional)', `${declaredGates.length} gates`)
else bad('V17. gate table drift', `undocumented: ${undocumented.join(', ') || '—'} | invented: ${invented.join(', ') || '—'}`)

// ── V18 (#79): the gate judgement is STRUCTURED — a call that merely MENTIONS
// a high-risk word (doc body, `echo`, commit message, `--grep`, inline
// `--body`) must NOT report ⚠, and must not pull the push-specific follow-ups
// either (the `git push` sub-judgement shares the same surface). Non-vacuous:
// V18a–V18e go red when the judgement is widened back to a word-wise substring
// over the serialized call (perturbation recorded on #79). V18f is a PIN, not a
// widening case: the text layer never armed the gate, so the only input that
// reddens it is text events arming tool/call — which #79's Out of scope keeps
// out of this change.
const afterCall = async (name, args, step) => {
  await emitSessionEvent(ctx, agent.session, {
    type: 'tool/call',
    data: { turn: 1, step, name, arguments: JSON.stringify(args) },
  })
  return render()
}
const clean = (text) => !text.includes('High-risk action detected')
  && !text.includes('remote CI run')
  && !text.includes('it follows the batch-end summary')
const caseDown = (label, text) => bad(label, (text.split('\n').find(l =>
  l.includes('High-risk action detected') || l.includes('remote CI run') || l.includes('batch-end summary')) ?? text.slice(-200)))

const n1 = await afterCall('write', { file_path: 'notes.md', content: '我们会 git push，然后 retro' }, 101)
if (clean(n1)) ok('V18a. write whose body mentions git push → no ⚠ (no push follow-ups)')
else caseDown('V18a. write body false positive', n1)

const n2 = await afterCall('bash', { command: 'echo "git push"' }, 102)
if (clean(n2)) ok('V18b. echo "git push" → no ⚠ (text argument, not an action)')
else caseDown('V18b. echo false positive', n2)

const n3 = await afterCall('bash', { command: 'git commit -m "note: git push 之后再 retro"' }, 103)
if (clean(n3)) ok('V18c. git commit -m "…git push…" → no ⚠ (message payload)')
else caseDown('V18c. commit message false positive', n3)

const n4 = await afterCall('bash', { command: 'git log --grep="git push"' }, 104)
if (clean(n4)) ok('V18d. git log --grep="git push" → no ⚠ (pattern payload)')
else caseDown('V18d. --grep false positive', n4)

// The ticket's vector is a call named `gh` carrying an inline `--body` — a tool
//面 this repo's roster does not have (gh rides bash/pwsh, covered below). A tool
// without a declared action field is explicitly NOT covered (#79 AC5): its
// bodies can never arm the gate.
const n5 = await afterCall('gh', { args: 'issue create --body "记得 git push"' }, 105)
if (clean(n5)) ok('V18e. undeclared tool surface with inline body → no ⚠ (declared not covered)')
else caseDown('V18e. inline-body false positive', n5)

await emitSessionEvent(ctx, agent.session, {
  type: 'assistant/message',
  data: { turn: 1, step: 106, message: { role: 'assistant', content: [{ type: 'text', text: '接下来会 push / 推送 到 main，然后 retro' }] } },
})
const n6 = await render()
if (clean(n6)) ok('V18f. assistant text mentioning push/推送 → no ⚠ (text layer never arms)')
else caseDown('V18f. text-layer false positive', n6)

// ── V19 (#79): the structured judgement must not OVER-tighten either. These
// pin the reach the declaration promises — the red scene for each is the
// opposite perturbation (judge at the command position only, or scan every
// argv token for a script/path gate).
// (a) a destructive SQL statement stays covered via a declared executed payload.
const p1 = await afterCall('bash', { command: 'psql -c "delete from users where id=1"' }, 107)
if (p1.includes('High-risk action detected') && p1.includes('delete from')) ok('V19a. psql -c "delete from …" → destructive gate covered (executed payload)')
else bad('V19a. executed SQL payload uncovered', p1.split('\n').find(l => l.includes('High-risk')) ?? '(no ⚠)')

// (b) a script/path gate must not match TEXT: echoing the runner path is inert.
const p2 = await afterCall('bash', { command: 'echo ".sandcastle/run-ticket.mts"' }, 108)
if (clean(p2)) ok('V19b. echo ".sandcastle/run-ticket.mts" → no ⚠ (path gate needs an invocation)')
else caseDown('V19b. path-gate text false positive', p2)

// (c) transparent prefixes keep the command position reachable.
const p3 = await afterCall('bash', { command: 'sudo git push origin main' }, 109)
if (p3.includes('High-risk action detected') && p3.includes('remote CI run')) ok('V19c. sudo git push → ⚠ + push follow-up (wrapper skipped)')
else bad('V19c. sudo prefix lost the command position', p3.split('\n').find(l => l.includes('High-risk')) ?? '(no ⚠)')

// (d) AC3 display attribution: a mutation names its ACTION, never the bare tool.
const p4 = await afterCall('plugin_manager', { action: 'set_bundle', enabled: true, target: 'pkg' }, 110)
const p4line = p4.split('\n').find(l => l.includes('High-risk action detected')) ?? ''
if (p4line.includes('plugin_manager set_bundle')) ok('V19d. ⚠ line names the action (plugin_manager set_bundle)')
else bad('V19d. display attribution', p4line)

// (e) AC5 declared "not covered": a fragmented PTY write cannot be judged and
// is not guessed at; the declaration is the ACTION_FIELDS map, not a fallback.
const p5 = await afterCall('pty_send', { id: 'p1', data: 'git push\n', submit: true }, 111)
if (clean(p5)) ok('V19e. pty_send data (fragmented write) → no ⚠ (declared not covered)')
else caseDown('V19e. pty_send matched by accident', p5)
const undeclared = ['write', 'edit', 'str_replace_editor', 'pty_send', 'pty_open', 'run_code', 'handoff_tool'].filter(t => t in ACTION_FIELDS)
if (undeclared.length === 0) ok('V19f. text/PTY/program tools declare no action field — not covered by construction')
else bad('V19f. undeclared tool gained an action field', undeclared.join(', '))

// (l) argv[0] is normalized for matching — an absolute path or a Windows
// executable suffix is still the same command (red if argv[0] must be spelled
// exactly as the gate word).
const p10 = await afterCall('bash', { command: '/usr/bin/git push origin main' }, 120)
const p11 = await afterCall('pwsh', { command: 'git.exe push origin main' }, 121)
if (p10.includes('High-risk action detected') && p11.includes('High-risk action detected'))
  ok('V19l. /usr/bin/git push · git.exe push → ⚠ (argv[0] basename + .exe normalized)')
else bad('V19l. path/exe argv[0] missed', (p10.includes('High-risk') ? p11 : p10).split('\n').find(l => l.includes('High-risk')) ?? '(no ⚠)')

// (m) constructs that still name the same direct command: an attached redirect,
// command substitution, a shell keyword prefix (red if the word list keeps the
// punctuation glued to the command, or the keyword owns the command position).
const p12 = await afterCall('bash', { command: 'git push>log.txt' }, 122)
const p13 = await afterCall('bash', { command: '$(git push origin main)' }, 123)
const p14 = await afterCall('bash', { command: 'if git push origin main; then echo ok; fi' }, 124)
if (p12.includes('High-risk action detected') && p13.includes('High-risk action detected') && p14.includes('High-risk action detected'))
  ok('V19m. git push>log.txt · $(git push) · if git push → ⚠ (attached punctuation/keyword does not hide the command)')
else bad('V19m. direct command hidden by punctuation/keyword', [p12, p13, p14].map(t => t.split('\n').find(l => l.includes('High-risk')) ?? '(no ⚠)').join(' | '))

// (n) a script's OWN `-c` is not an executed payload: a shell reads its options
// before the first operand, so `bash deploy.sh -c "…"` (red if every `-c` in the
// line is treated as executed code).
const p15 = await afterCall('bash', { command: 'bash deploy.sh -c "delete from users"' }, 125)
if (clean(p15)) ok('V19n. bash deploy.sh -c "delete from …" → no ⚠ (the script\'s flag is not executed code)')
else caseDown('V19n. script flag read as executed payload', p15)

// (g) the ticket's inline-body vector on its REAL surface: `gh issue create`
// with a body that mentions git push is a genuine external action → ⚠ on the
// ACTION, and the body must not drag in the push follow-ups.
const p6 = await afterCall('bash', { command: 'gh issue create --body "记得 git push"' }, 112)
if (p6.includes('High-risk action detected') && p6.includes('gh issue create') && !p6.includes('remote CI run'))
  ok('V19g. gh issue create carrying an inline body → ⚠ on the action, body adds no push lines')
else bad('V19g. inline-body gh call', p6.split('\n').find(l => l.includes('High-risk')) ?? '(no ⚠)')

// (h/i/k) a command LIST is judged per command position — `cd repo && git push`
// is a direct push (red if only the first command in the line is judged), and
// the same holds inside an executed payload.
const p7 = await afterCall('bash', { command: 'cd repo && git push origin main' }, 113)
if (p7.includes('High-risk action detected') && p7.includes('remote CI run')) ok('V19h. cd repo && git push → ⚠ + push follow-up (per-command judgement)')
else bad('V19h. command-list push missed', p7.split('\n').find(l => l.includes('High-risk')) ?? '(no ⚠)')

const p7b = await afterCall('bash', { command: 'git status; git push origin main' }, 118)
if (p7b.includes('High-risk action detected') && p7b.includes('remote CI run')) ok('V19h2. git status; git push → ⚠ (attached `;` still splits commands)')
else bad('V19h2. semicolon-list push missed', p7b.split('\n').find(l => l.includes('High-risk')) ?? '(no ⚠)')

const p7c = await afterCall('bash', { command: 'echo "note: git push; rm -rf /" > notes.md' }, 119)
if (clean(p7c)) ok('V19h3. quoted operator inside a body → no ⚠ (quotes are not command separators)')
else caseDown('V19h3. quoted operator treated as a command', p7c)

const p8 = await afterCall('bash', { command: 'bash -lc "git push origin main"' }, 114)
if (p8.includes('High-risk action detected') && p8.includes('remote CI run')) ok('V19i. bash -lc "git push" → ⚠ (clustered short flag executes its payload)')
else bad('V19i. clustered-flag push missed', p8.split('\n').find(l => l.includes('High-risk')) ?? '(no ⚠)')

const p9 = await afterCall('bash', { command: 'bash -c "cd x && git push"' }, 115)
if (p9.includes('High-risk action detected')) ok('V19j. bash -c "cd x && git push" → ⚠ (list inside executed payload)')
else bad('V19j. payload command-list push missed', p9.split('\n').find(l => l.includes('High-risk')) ?? '(no ⚠)')

// (k) a script/path gate matches a NAME (basename / path component), not a
// substring — the sandcastle runner fires, name lookalikes do not (red if the
// chain is substring-scanned).
const lookalike = await afterCall('bash', { command: 'npx tsx ./tmp/sandcastle-notes.mjs' }, 116)
const lookalike2 = await afterCall('bash', { command: 'node scripts/run-ticket-helpers.mjs' }, 117)
if (clean(lookalike) && clean(lookalike2)) ok('V19k. sandcastle-notes.mjs / run-ticket-helpers.mjs → no ⚠ (name match, not substring)')
else caseDown('V19k. path-gate name lookalike fired', lookalike.includes('High-risk') ? lookalike : lookalike2)

// ── V20 (#79): every DECLARED gate must be reachable from some real
// invocation. Turning a gate into a dead entry is not a tightening, it is lost
// coverage — and the SQL/path gates are exactly the ones a command-position-only
// matcher would kill. A future gate without a canonical case fails here too.
// (`gh issue close` is deliberately absent: it is NOT a declared gate in
// DEFAULT_GATES — measured on HEAD, `gh issue close 429` never fired the ⚠ gate
// (V11 asserts the close NUDGE only), so ticket AC2's positive listing is a
// 口径 correction to record on #79, not a regression of this change. Whether the
// missing 关票 gate — and the CLOSE_PATTERNS/CREATE_PATTERNS nudge arming, which
// still reads the whole serialized call — should be collected in this ticket is
// a scope decision for the human: both are reported, not silently extended.)
const CANONICAL = {
  'git push': { name: 'bash', arguments: { command: 'git push origin main' } },
  'git push --force': { name: 'bash', arguments: { command: 'git push --force origin main' } },
  'gh pr create': { name: 'bash', arguments: { command: 'gh pr create --title x --body y' } },
  'gh issue create': { name: 'bash', arguments: { command: 'gh issue create --title x --body y' } },
  'gh release create': { name: 'bash', arguments: { command: 'gh release create v1.0.0' } },
  'gh repo create': { name: 'bash', arguments: { command: 'gh repo create me/x --private' } },
  'npm publish': { name: 'bash', arguments: { command: 'npm publish --access public' } },
  'cargo publish': { name: 'bash', arguments: { command: 'cargo publish' } },
  'sandcastle': { name: 'bash', arguments: { command: 'npx tsx .sandcastle/run-ticket.mts --issue 1' } },
  'run-ticket': { name: 'bash', arguments: { command: 'npx tsx .sandcastle/run-ticket.mts --issue 1' } },
  'plugin_manager install_bundle': { name: 'plugin_manager', arguments: { action: 'install_bundle', target: 'x@1' } },
  'plugin_manager set_plugin': { name: 'plugin_manager', arguments: { action: 'set_plugin', enabled: true } },
  'plugin_manager set_bundle': { name: 'plugin_manager', arguments: { action: 'set_bundle', enabled: true } },
  'git reset --hard': { name: 'bash', arguments: { command: 'git reset --hard HEAD~1' } },
  'git clean -f': { name: 'bash', arguments: { command: 'git clean -fd' } },
  'rm -rf': { name: 'bash', arguments: { command: 'rm -rf build/' } },
  'docker compose down -v': { name: 'bash', arguments: { command: 'docker compose down -v' } },
  'docker volume rm': { name: 'bash', arguments: { command: 'docker volume rm myvol' } },
  'docker system prune': { name: 'bash', arguments: { command: 'docker system prune -af' } },
  'drop database': { name: 'bash', arguments: { command: 'psql -c "drop database prod"' } },
  'truncate table': { name: 'bash', arguments: { command: 'mysql -e "truncate table users"' } },
  'delete from': { name: 'bash', arguments: { command: 'psql -c "delete from users"' } },
}
const unreachable = declaredGates.filter(g => CANONICAL[g] !== undefined && !gateMatches(g, CANONICAL[g]))
const unproven = declaredGates.filter(g => CANONICAL[g] === undefined)
if (unreachable.length === 0 && unproven.length === 0)
  ok('V20. every declared gate is reachable from its canonical invocation', `${declaredGates.length} gates`)
else bad('V20. dead / unproven gate', `unreachable: ${unreachable.join(', ') || '—'} | unproven: ${unproven.join(', ') || '—'}`)

await handle.dispose()
console.log('\n=== WORKFLOW-ENFORCER VERIFY (V1–V20) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
