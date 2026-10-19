/**
 * verify-enforcer.mjs — acceptance for dsh-workflow-enforcer (V1–V34; the
 * structured gate-matching block added by #79 is V18–V20, the structured
 * ticket-lifecycle nudge arming added by #82 is V21–V23, V24 pins the doc's
 * 「What it injects」+ config block against `INJECTIONS`, the push-triggered
 * retro added by #71 is V25–V31, and the home-delete reminder added by #113 is
 * V32–V34).
 *
 *  V1 mount smoke: a preset row mounting workflow-enforcer mounts clean.
 *  V2 baseline: every prompt assembly renders a WORKFLOW GATES section.
 *  V3 high-risk instant: after a tool/call matching the gates, the next
 *     assembly carries a one-shot "High-risk action detected" line.
 *  V4 no noise: a benign tool/call adds no ⚠ line; baseline stays single.
 *
 * ── #71 perturbation discipline (NON-VACUITY, the hard requirement) ─────────
 * V25–V30 are only worth their lines if they go RED when #71's push judgement is
 * widened back to a substring over the serialized call. The recipe below is
 * REPRODUCIBLE — run it as written and you get real red, not false green.
 *
 * WHY IT NEEDS `DSH_MATT_ENFORCER`: this file's own `import` is NOT what gets
 * mounted. `tests/preset-harness.mjs` resolves the plugin path itself and
 * `smokePlugins()` mounts THAT module, so perturbing a copy and only repointing
 * this file's import leaves the real `workflow-enforcer.mjs` mounted — every
 * behavioural assertion then reads the UNPERTURBED plugin and stays green
 * (false evidence; `docs/code-review-brief.md` §2: 扰动要打在运行时真正读的那份上).
 * `preset-harness.mjs` therefore honours `DSH_MATT_ENFORCER`, and the recipe
 * below uses it. Unset → the harness behaves exactly as before.
 *
 * RECIPE (PowerShell; the copy lives in gitignored `.scratch/`, never under
 * `tests/` — a stray `tests/*.mjs` would be picked up as a test case by
 * `verify-all`):
 *
 *   $env:DSH_MATT_ENFORCER = "$PWD/.scratch/perturb/enforcer-substring.mjs"
 *   # copy workflow-enforcer.mjs there, then widen BOTH anchors:
 *   #   function actionSurface(call) {  → prepend a fallback returning
 *   #       { segments:[{ primary:[JSON.stringify({name,arguments})], … }], __blob }
 *   #       for tools that declare NO action field (the pre-#79 bug shape)
 *   #   function matchesSurface(gate, surface) { → if (surface.__blob)
 *   #       return surface.__blob.toLowerCase().includes(gate.toLowerCase())
 *   node tests/verify-enforcer.mjs
 *
 * Hard constraints from `docs/code-review-brief.md` §2 that this recipe obeys:
 *   (1) self-check the NEEDLE HITS before editing (`$src.Contains($anchor)`) —
 *       zero hits is false evidence, not "no drift";
 *   (2) the perturbation lives in a COPY, so the committed tree is never the
 *       perturbed tree (「标记死了才叫实验」) and `workflow-enforcer.mjs` is never
 *       mutated (it also happens to be under concurrent edit by another lane);
 *   (3) leave no experiment marker (the DEBUG- / MUTATION- bracketed form) in
 *       this file — the pre-commit hook rejects those in staged `tests/*`
 *       additions, and this recipe needs no marker at all: the perturbation
 *       lives entirely in the copy under `DSH_MATT_ENFORCER`.
 *
 * MEASURED RESULT (the copy widened as above, `DSH_MATT_ENFORCER` set):
 * V30a / V30a2 / V30a3 / V30c / V30c2 / V30e go RED — a `write` body, an
 * `edit`, an `echo`, a commit message, a `--grep` pattern and a PTY fragment
 * each arm the retro reminder, i.e. the very false positives #71 outlaws —
 * alongside the pre-existing V18–V23 false-positive cases (33 red total).
 * Remove the copy / unset the variable → all-green again.
 *
 * The case that keeps the FIX honest WITHOUT the perturbation is V30a3: it
 * asserts the push judgement and the ⚠ gate judgement agree case by case on the
 * same samples (they share `actionSurface` + `matchesSurface`), so a second,
 * drifting matcher reddens it.
 *
 * PROGRAMMATIC alternative (what CI-less review used): a scratch runner can
 * copy `workflow-enforcer.mjs` + `tests/preset-harness.mjs` into a mirror tree
 * and repoint the latter's plugin path — equivalent, but it must copy the
 * HARNESS too; repointing only the test file's import is the false-green trap.
 *
 * Run with the same dep wiring as the deployment (`tests/node_modules/@deepseek-ai`
 * is a junction to the dsh install's `node_modules/@deepseek-ai`; wire it with
 * `node scripts/link-runtime-deps.mjs`), like the matt-preset verify suite.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
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

/**
 * #77：临时根**创建即登记** —— 收尾块与进程级兜底都读这一份，不再手抄清单。
 * 病根正是"末尾清单会漏项"：#77 修的就是 9 处 `mkdtemp` 中漏在 8 项清单之外的
 * `batchRoot`；登记制让"漏一项"不可能发生。
 */
const tmpRoots = []
const tmpRoot = (dir) => { tmpRoots.push(dir); return dir }
let tmpSettled = false

/**
 * #77 AC② 的进程级兜底：收尾块挂在**线性流末端**，未捕获 throw（`bootHarness` 等）
 * 会绕过它 —— 那种情况下进程非 0 退出却**不打 `tmp kept`**，正是 AC② 明文要禁的
 * 静默留场。正常收尾跑过（`tmpSettled`）或正常退出（code 0）时本钩子什么都不做。
 */
process.on('exit', (code) => {
  if (tmpSettled || code === 0) return
  for (const root of tmpRoots) console.log(`tmp kept: ${root}`)
})

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
// V12c (#128): the SAME nudge carries the label read-back invariant — exactly one
// category + exactly one state. Guarded because docs/workflow-enforcer.md claims
// it, and an unguarded sentence is deletable while every test stays green
// (the D10 class this repo already registered).
if (v12.includes('labels back') && v12.includes('one category') && v12.includes('one state'))
  ok('V12c. the create nudge carries the label read-back invariant (#128)')
else bad('V12c. read-back invariant missing from the create nudge', v12.slice(-240))

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
const batchRoot = tmpRoot(await mkdtemp(join(tmpdir(), 'dsh-enforcer-batch-')))
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
// stay routine. The cordis profile DECLARES install/enable as gate-6 events,
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
// 口径 correction recorded on #79, not a regression of this change. The nudge
// arming that this comment used to flag as still reading the whole serialized
// call was collected in #82 and is judged on the same structured surface now —
// see V21–V23 below.)
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

// ── V21 (#82): the ticket-lifecycle nudges (关票 fresh-subagent 抽查 / 建票
// D20) arm on the SAME structured surface as the ⚠ gates — the #79 core
// (`actionSurface` + `matchesSurface`). A call that merely MENTIONS
// `gh issue close` / `gh issue create` / `state=closed` in its free text (doc
// body, `echo`, commit message, `--grep`, an API-shaped note in a file) must
// arm NEITHER nudge. Non-vacuous: V21a–V21g go red when the arming is widened
// back to the whole-string scan (`JSON.stringify(data)` + the old CLOSE /
// CREATE regex scans) — perturbation recorded on #82.
const NUDGE_TEXT = { close: 'fresh-subagent quality', create: 'New ticket created' }
const closesText = (text) => text.includes(NUDGE_TEXT.close)
const createsText = (text) => text.includes(NUDGE_TEXT.create)
const noNudge = (text) => !closesText(text) && !createsText(text)
const nudgeDown = (label, text) => bad(label, (text.split('\n').find(l =>
  closesText(l) || createsText(l)) ?? text.slice(-200)))

const q1 = await afterCall('write', { file_path: 'notes.md', content: '下一步 gh issue close 429，然后收尾' }, 201)
if (noNudge(q1)) ok('V21a. write body mentioning gh issue close → no 关票 nudge')
else nudgeDown('V21a. write body armed the close nudge', q1)

const q2 = await afterCall('edit', { file_path: 'notes.md', old_string: 'a', new_string: '跑 gh issue create --title x 建票' }, 202)
if (noNudge(q2)) ok('V21b. edit body mentioning gh issue create → no 建票 nudge')
else nudgeDown('V21b. edit body armed the create nudge', q2)

const q3 = await afterCall('str_replace_editor', { command: 'str_replace', path: 'notes.md', file_text: 'gh issue create --title x' }, 203)
if (noNudge(q3)) ok('V21c. str_replace_editor body mentioning gh issue create → no 建票 nudge')
else nudgeDown('V21c. str_replace_editor body armed the create nudge', q3)

const q4 = await afterCall('bash', { command: 'git commit -m "note: gh issue create 之后再谈"' }, 204)
if (noNudge(q4)) ok('V21d. git commit -m "…gh issue create…" → no 建票 nudge (message payload)')
else nudgeDown('V21d. commit message armed the create nudge', q4)

const q5 = await afterCall('bash', { command: 'echo "gh issue close 429"' }, 205)
if (noNudge(q5)) ok('V21e. echo "gh issue close 429" → no 关票 nudge (text argument)')
else nudgeDown('V21e. echo armed the close nudge', q5)

const q6 = await afterCall('bash', { command: 'git log --grep="gh issue create"' }, 206)
if (noNudge(q6)) ok('V21f. git log --grep="gh issue create" → no 建票 nudge (pattern payload)')
else nudgeDown('V21f. --grep armed the create nudge', q6)

const q7 = await afterCall('write', { file_path: 'api.md', content: 'gh api -X PATCH repos/o/r/issues/429 -f state=closed' }, 207)
if (noNudge(q7)) ok('V21g. write body documenting the gh api close face → no 关票 nudge')
else nudgeDown('V21g. API-shaped prose armed the close nudge', q7)

// V21h is a PIN, not a widening case (same role as V18f): the text layer never
// armed these nudges, and #79/#82's Out of scope keeps `foldIntent` /
// `batchClose` / `grillMode` — the text-layer observations — out of the
// judgement. Only text events arming tool/call would redden it.
await emitSessionEvent(ctx, agent.session, {
  type: 'assistant/message',
  data: { turn: 1, step: 208, message: { role: 'assistant', content: [{ type: 'text', text: '我会 gh issue close 429，并 gh issue create 一张新票' }] } },
})
const q8 = await render()
if (noNudge(q8)) ok('V21h. assistant text mentioning close/create → no nudge (text layer never judged)')
else nudgeDown('V21h. text layer armed a nudge', q8)

// ── V22 (#82): the structured judgement must not OVER-tighten either — this
// pins the reach `TICKET_LIFECYCLE` declares (wrapper / command separator /
// executed payload / the DECLARED `gh api` face), and the faces it explicitly
// does NOT cover. Red scene for (a)–(c) is judging only a line's first command
// or reading the raw argument blob; for (d)–(e) it is dropping the API face;
// for (f)–(i) it is widening back to a substring / reading a payload as an
// action / accepting any method / any token as the endpoint.
const r1 = await afterCall('bash', { command: 'sudo gh issue close 429' }, 216)
if (closesText(r1)) ok('V22a. sudo gh issue close 429 → 关票 nudge (wrapper skipped)')
else bad('V22a. wrapper hid the close command', r1.slice(-200))

const r2 = await afterCall('bash', { command: 'cd repo && gh issue close 429 --comment done' }, 217)
if (closesText(r2)) ok('V22b. cd repo && gh issue close 429 → 关票 nudge (per-command position)')
else bad('V22b. command separator hid the close command', r2.slice(-200))

const r3 = await afterCall('bash', { command: 'bash -c "gh issue create --title x"' }, 218)
if (createsText(r3)) ok('V22c. bash -c "gh issue create …" → 建票 nudge (executed payload)')
else bad('V22c. executed payload lost the create command', r3.slice(-200))

const r4 = await afterCall('bash', { command: 'gh api -X PATCH repos/o/r/issues/429 -f state=closed' }, 219)
if (closesText(r4)) ok('V22d. gh api -X PATCH …issues/429 -f state=closed → 关票 nudge (declared API face)')
else bad('V22d. declared API face uncovered', r4.slice(-200))

const r5 = await afterCall('bash', { command: 'gh api --method=PATCH /repos/o/r/issues/429 --field state=closed' }, 220)
if (closesText(r5)) ok('V22e. gh api --method=PATCH … --field state=closed → 关票 nudge (inline = and long flags)')
else bad('V22e. long-flag API form uncovered', r5.slice(-200))

const r6 = await afterCall('bash', { command: 'gh issue create --title "记得 gh issue close 429"' }, 221)
if (createsText(r6) && !closesText(r6)) ok('V22f. gh issue create carrying a 关票-shaped title → 建票 only (payload is text)')
else bad('V22f. create payload dragged in the close nudge', r6.slice(-200))

const r7 = await afterCall('bash', { command: 'gh api -X PATCH repos/o/r/issues/429 --input -' }, 222)
if (!closesText(r7)) ok('V22g. gh api … --input - (stdin body) → no 关票 nudge (declared not covered)')
else bad('V22g. stdin-body API form matched', r7.slice(-200))

const r8 = await afterCall('bash', { command: 'gh api -X GET repos/o/r/issues/429 -f state=closed' }, 223)
if (!closesText(r8)) ok('V22h. gh api -X GET … → no 关票 nudge (method must be the declared PATCH)')
else bad('V22h. non-PATCH API call matched', r8.slice(-200))

// (i) the mirror of (f): a 关票 command whose --body mentions the 建票 command
// stays a 关票 nudge — the docs promise `--body`/`--title` are text.
const r9 = await afterCall('bash', { command: 'gh issue close 429 --body "记得 gh issue create --title x"' }, 224)
if (closesText(r9) && !createsText(r9)) ok('V22i. gh issue close … --body "…gh issue create…" → 关票 only (body is text)')
else bad('V22i. close payload dragged in the create nudge', r9.slice(-200))

// (j) the endpoint token must not be an UNDECLARED flag's value: `--header`
// takes a value, so `issues/429` there is not the API path (declared uncovered).
const r10 = await afterCall('bash', { command: 'gh api -X PATCH -f state=closed --header "issues/429"' }, 225)
if (!closesText(r10)) ok('V22j. endpoint-shaped value of an undeclared flag → no 关票 nudge (declared not covered)')
else bad('V22j. undeclared flag value read as the endpoint', r10.slice(-200))

// ── V23 (#82): every DECLARED ticket-lifecycle face must be reachable from a
// real invocation. Turning a face into a dead entry is not a tightening, it is
// lost coverage — and the declared `gh api` face is exactly the one a
// command-position-only judgement would kill. Driven through the REAL seam
// (the `apply` session/event hook → the next assembly), never through an
// exported thin wrapper: perturbing only a wrapper leaves this matrix green
// (perturbation discipline; the same trap #79 recorded). Iterates
// `TICKET_LIFECYCLE` itself, so a future face without a canonical invocation —
// or a declared kind without a known nudge — fails here.
import { TICKET_LIFECYCLE } from '../workflow-enforcer.mjs'
const NUDGE_CANONICAL = {
  'close/words:gh issue close': { name: 'bash', arguments: { command: 'gh issue close 7 --comment done' } },
  'close/api:gh api': { name: 'bash', arguments: { command: 'gh api -X PATCH repos/o/r/issues/7 -f state=closed' } },
  'create/words:gh issue create': { name: 'bash', arguments: { command: 'gh issue create --title t' } },
}
const faces = []
for (const [kind, decl] of Object.entries(TICKET_LIFECYCLE)) {
  for (const word of decl.words ?? []) faces.push({ kind, key: `${kind}/words:${word}`, label: `word run ${word}` })
  if (decl.api !== undefined) faces.push({ kind, key: `${kind}/api:${decl.api.command} ${decl.api.subcommand}`, label: `declared API face ${decl.api.command} ${decl.api.subcommand}` })
}
const unprovenFaces = faces.filter(f => NUDGE_CANONICAL[f.key] === undefined).map(f => f.label)
const unknownKind = Object.keys(TICKET_LIFECYCLE).filter(k => NUDGE_TEXT[k] === undefined)
const deadFaces = []
for (const [i, face] of faces.entries()) {
  const canonical = NUDGE_CANONICAL[face.key]
  if (canonical === undefined) continue
  const text = await afterCall(canonical.name, canonical.arguments, 220 + i)
  if (!text.includes(NUDGE_TEXT[face.kind])) deadFaces.push(face.label)
}
if (unprovenFaces.length === 0 && unknownKind.length === 0 && deadFaces.length === 0)
  ok('V23. every declared ticket-lifecycle face is reachable from its canonical invocation', `${faces.length} faces`)
else bad('V23. dead / unproven ticket-lifecycle face',
  `unproven: ${unprovenFaces.join(', ') || '—'} | unknown kind: ${unknownKind.join(', ') || '—'} | dead: ${deadFaces.join(', ') || '—'}`)

// V23b (#82 AC3): the arming READS that declaration — add a word run at runtime
// and it arms; remove it again and it stops. A hand-copied third matcher (or any
// hard-coded path that bypasses the declaration) leaves this green, so this is
// the non-vacuous pin for "single source of truth" — unlike a source-text scan
// for the retired identifier, whose only red scene was re-using that exact name.
TICKET_LIFECYCLE.close.words.push('echo lifecycle-probe')
const mutated = await afterCall('bash', { command: 'echo lifecycle-probe' }, 230)
TICKET_LIFECYCLE.close.words.pop()
const unmutated = await afterCall('bash', { command: 'echo lifecycle-probe' }, 231)
if (closesText(mutated) && !closesText(unmutated))
  ok('V23b. arming reads the declaration (runtime-added word arms, removal disarms — AC3)')
else bad('V23b. declaration is not the arming single source',
  `add → ${closesText(mutated) ? 'armed' : 'did NOT arm'} | remove → ${closesText(unmutated) ? 'still armed' : 'disarmed'}`)

// V23c (#82): the documented 判定面 row must not drift from the declaration —
// the same doc↔code guard the gate table has (V17). One-directional by nature
// (that row is prose, not a list): every declared element must appear in it), so
// a newly declared word/flag/method/field that nobody documented reddens here.
const docTick = readFileSync(new URL('../docs/workflow-enforcer.md', import.meta.url), 'utf8')
  .split('\n').find(l => l.includes('TICKET_LIFECYCLE')) ?? ''
const declaredElements = Object.values(TICKET_LIFECYCLE).flatMap(face => [
  ...(face.words ?? []),
  ...(face.api === undefined ? [] : [
    face.api.command, face.api.subcommand, face.api.method, face.api.field,
    ...(face.api.methodFlags ?? []), ...(face.api.fieldFlags ?? []),
  ]),
])
const missingInDoc = declaredElements.filter(s => !docTick.includes(s))
if (docTick !== '' && missingInDoc.length === 0)
  ok('V23c. 判定面 row documents every declared lifecycle element (no doc↔code drift)', `${declaredElements.length} elements`)
else bad('V23c. doc/declaration drift',
  docTick === '' ? 'no 判定面 row mentioning TICKET_LIFECYCLE' : `missing from the row: ${missingInDoc.join(', ')}`)

// ── V24 (#82 review follow-up): 「What it injects」 is the user-facing contract
// of this plugin and it HAD gone stale — the ticket nudges, the fold-in evidence
// and the grill contract were all missing, and the per-row config block lacked
// seven knobs. Every declared injection must be named in that section, and every
// declared knob must appear in the config block. One-directional by nature (both
// are prose), the same shape as V17/V23c; the red scene is deleting a bullet or
// a knob line from the doc, or adding an injection nobody documented.
import { INJECTIONS } from '../workflow-enforcer.mjs'
import { RETRO_TRIGGER } from '../workflow-enforcer.mjs'
const docAll = readFileSync(new URL('../docs/workflow-enforcer.md', import.meta.url), 'utf8')
const injectSection = docAll.split(/^## /m).find(s => s.startsWith('What it injects')) ?? ''
const configSection = docAll.split(/^### /m).find(s => s.startsWith('Per-row config')) ?? ''
const missingInject = INJECTIONS.filter(i => !injectSection.includes(i.marker)).map(i => i.id)
const knobs = INJECTIONS.map(i => i.config).filter(Boolean)
const missingKnobs = knobs.filter(k => !configSection.includes(k))
if (injectSection !== '' && configSection !== '' && missingInject.length === 0 && missingKnobs.length === 0)
  ok('V24. 文档「What it injects」+ config block cover every declared injection', `${INJECTIONS.length} injections / ${knobs.length} knobs`)
else bad('V24. injection documentation drift',
  `${injectSection === '' ? 'no "What it injects" section' : ''}${configSection === '' ? ' no "Per-row config" section' : ''}` +
  ` | missing injections: ${missingInject.join(', ') || '—'} | missing knobs: ${missingKnobs.join(', ') || '—'}`)

// ═══════════════════════════════════════════════════════════════════════════
// ── V25–V29 (#71): push-triggered retro. A REAL push call arms the per-ticket
// 落盘 reminder; a real push in a batch whose `.scratch/batch-state.md` ALREADY
// carries the `retro:` marker arms the batch-end 聚合 presentation instead
// (每批至多一次, suppressed ACROSS SESSIONS by the file marker). A batch
// DECLARATION (攒批) is a thing the human SAYS, so its only face is the text
// event layer — the exact inverse of the push trigger, which is judged on the
// action surface and structurally excludes that layer.
//
// ── V30a–V30g (#71 非空洞性 / false-positive defence): the trigger face of
// #71 must be the SAME structured core #79 built (`actionSurface` +
// `matchesSurface`) — NOT a fresh text / whole-string judgement. Non-vacuous:
// V30a/a2/a3/c/c2/e go RED when the push judgement is widened back to a
// substring over the serialized call, with no fallback for tools that declare no
// action field. Measured through the reproducible `DSH_MATT_ENFORCER` copy
// recipe documented in the file header — NOT by editing the committed module.
//
// The high-value negative fixture is REAL text: this repo's own handoff docs,
// ticket bodies and retro docs are full of the words "推送/push", and none of
// them may trigger anything.
const RETRO_MARK = {
  push: 'Retro candidate — file it now',
  aggregate: 'Batch-end retro aggregation',
  declare: 'Batch declared',
}
const retroText = (text) => text.includes(RETRO_MARK.push)
const aggregateText = (text) => text.includes(RETRO_MARK.aggregate)
const declareText = (text) => text.includes(RETRO_MARK.declare)
const noRetro = (text) => !retroText(text) && !aggregateText(text) && !declareText(text)
const retroDown = (label, text) => bad(label, (text.split('\n').find(l =>
  retroText(l) || aggregateText(l) || declareText(l)) ?? text.slice(-200)))

// ── V25: a REAL push (`git push origin main`) injects the retro-filing
// instruction in the SAME assembly as the existing ⚠ line — one parts array,
// one section, no extra section. And it is ONE-SHOT: the next assembly is clean.
const v25 = await afterCall('bash', { command: 'git push origin main' }, 301)
if (v25.includes('High-risk action detected') && retroText(v25)
  && (v25.match(/Retro candidate — file it now/g) ?? []).length === 1) {
  ok('V25. real push → retro-filing instruction in the SAME ⚠ assembly (exactly once)')
} else {
  bad('V25. push did not inject the retro instruction alongside ⚠', v25.slice(-260))
}
const v25b = await render()
if (!retroText(v25b) && !aggregateText(v25b)) ok('V25b. retro instruction consumed after firing (no repeat)')
else bad('V25b. retro instruction repeated', v25b.slice(-200))

// ── V26: the per-ticket 落盘 reminder carries the WRITING CONTRACT — the exact
// landing path, 免确认/不阻断, and 只写候选不落地 (D22/D27: landing candidates
// still goes through the human).
const v26 = await afterCall('bash', { command: 'git push origin main' }, 307)
const v26path = v26.includes('.scratch/retro/<batch>-<session>.md')
const v26free = v26.includes('no human confirmation needed') && v26.includes('never')
  && v26.includes('blocks the wrap-up')
const v26cand = v26.includes('CANDIDATES ONLY')
if (v26path && v26free && v26cand)
  ok('V26. 落盘 reminder carries the path contract + 免确认/不阻断 + candidates-only')
else bad('V26. 落盘 contract incomplete',
  `path: ${v26path} | no-confirm/no-block: ${v26free} | candidates-only: ${v26cand}`)

// ── V27: batch-end push (cwd HAS batch-state.md WITH the `retro:` marker) →
// the AGGREGATION reminder: read every same-batch file, dedupe (merge + count),
// sort by severity, present ONCE, and name each candidate's source.
const batchEndRoot = tmpRoot(await mkdtemp(join(tmpdir(), 'dsh-enforcer-retroend-')))
await mkdir(join(batchEndRoot, '.scratch', 'retro'), { recursive: true })
await writeFile(join(batchEndRoot, '.scratch', 'batch-state.md'), [
  '# Batch state — 71',
  '',
  '| # | 票 | 状态 |',
  '| --- | --- | --- |',
  '| 1 | #71 | 进行中 |',
  '',
  '- retro: done @ deadbee',
  '',
].join('\n'))
const handleBE = await ctx.agents.create({
  sessionId: SessionId('enforcer-retroend'),
  meta: { cwd: batchEndRoot },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
const agentBE = handleBE.agent
const renderBE = async () => {
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agentBE, signal))
  return renderPrompt(assembly)
}
await emitSessionEvent(ctx, agentBE.session, {
  type: 'tool/call',
  data: { turn: 1, step: 302, name: 'bash', arguments: JSON.stringify({ command: 'git push origin feat/71' }) },
})
const v27 = await renderBE()
const v27parts = {
  'read every same-batch file': v27.includes('read EVERY `.scratch/retro/*.md`'),
  'dedupe + count': v27.includes('dedupe (merge the same issue and record its count)'),
  'sort by severity': v27.includes('sort by severity'),
  'present ONCE': v27.includes('present it to the human ONCE'),
  'source ticket/session': v27.includes('source ticket / session'),
}
const v27missing = Object.entries(v27parts).filter(([, hit]) => !hit).map(([k]) => k)
if (aggregateText(v27) && !retroText(v27) && v27missing.length === 0)
  ok('V27. batch-end push (retro: marker present) → 聚合呈现 reminder (dedupe/sort/once/source)')
else bad('V27. aggregation reminder incomplete',
  `marker: ${aggregateText(v27)} | per-ticket leaked: ${retroText(v27)} | missing: ${v27missing.join(', ') || '—'}`)
// and it is 每批至多一次: the same session does not re-present.
const v27b = await renderBE()
if (!aggregateText(v27b)) ok('V27b. 聚合呈现 consumed (no repeat)')
else bad('V27b. aggregation repeated', v27b.slice(-200))

// ── V28: a batch DECLARATION ("这批攒批 / 系列处理", a text event) injects EXACTLY
// ONE initialization reminder pointing at `docs/batch-state.md` — and it fires
// whether or not that file already exists (creating it IS the declaration's job;
// an init reminder gated on the file existing would never fire once).
const v28src = readFileSync(new URL('../workflow-enforcer.mjs', import.meta.url), 'utf8')
const v28decl = Array.isArray(RETRO_TRIGGER.batchDeclare?.words) && RETRO_TRIGGER.batchDeclare.words.length > 0
if (v28decl) ok('V28pre. RETRO_TRIGGER.batchDeclare.words declared (text-face declaration)', RETRO_TRIGGER.batchDeclare.words.join('/'))
else bad('V28pre. batchDeclare declaration missing')

// (a) cwd WITHOUT batch-state.md → still reminds (initialization).
const declRoot = tmpRoot(await mkdtemp(join(tmpdir(), 'dsh-enforcer-decl-')))
const handleDecl = await ctx.agents.create({
  sessionId: SessionId('enforcer-decl'),
  meta: { cwd: declRoot },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
const agentDecl = handleDecl.agent
const renderDecl = async () => {
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agentDecl, signal))
  return renderPrompt(assembly)
}
await emitSessionEvent(ctx, agentDecl.session, {
  type: 'user/message',
  data: { turn: 1, step: 303, source: { kind: 'user' }, message: { role: 'user', content: [{ type: 'text', text: '这批攒批，一起处理 #71 #73' }] } },
})
const v28a = await renderDecl()
if (declareText(v28a) && v28a.includes('docs/batch-state.md') && !retroText(v28a) && !aggregateText(v28a))
  ok('V28a. batch declaration without batch-state.md → initialization reminder → docs/batch-state.md')
else bad('V28a. declaration reminder missing/does not point at the template',
  `declare: ${declareText(v28a)} | points at docs/batch-state.md: ${v28a.includes('docs/batch-state.md')}`)
// exactly once: the next assembly is clean.
const v28b = await renderDecl()
if (!declareText(v28b)) ok('V28b. declaration reminder is one-shot (consumed, no repeat)')
else bad('V28b. declaration reminder repeated', v28b.slice(-200))
// (b) cwd WITH batch-state.md → same reminder (the file existing is not a gate).
const declRoot2 = tmpRoot(await mkdtemp(join(tmpdir(), 'dsh-enforcer-decl2-')))
await mkdir(join(declRoot2, '.scratch'), { recursive: true })
await writeFile(join(declRoot2, '.scratch', 'batch-state.md'), '# Batch state\n\n| 1 | #71 | ok |\n')
const handleDecl2 = await ctx.agents.create({
  sessionId: SessionId('enforcer-decl2'),
  meta: { cwd: declRoot2 },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
await emitSessionEvent(ctx, handleDecl2.agent.session, {
  type: 'assistant/message',
  data: { turn: 1, step: 304, message: { role: 'assistant', content: [{ type: 'text', text: '好，这批攒批我按模板开工' }] } },
})
const v28c = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handleDecl2.agent, signal)))
if (declareText(v28c)) ok('V28c. declaration reminder fires even with batch-state.md present (file is not the gate)')
else bad('V28c. declaration gated on the file existing', v28c.slice(-200))
// (c) the whole family of declared words arms, and NOTHING about push does.
const declProbe = RETRO_TRIGGER.batchDeclare.words.every(w =>
  typeof w === 'string' && w.length > 0 && v28src.includes(w))
if (declProbe) ok('V28d. every declared batch-declaration word is present in the source declaration')
else bad('V28d. declared batch words not found in source')

// ── V29 (#71 AC「每批至多一次」／跨会话抑制): TWO markers decide the face, BOTH
// read from FILES in the session's cwd (never a per-session WeakMap, which is
// what makes the suppression hold across sessions):
//   `retro:` in `.scratch/batch-state.md`        → the batch reached its end
//   `.scratch/retro/.aggregated` (agent-written) → the aggregation was PRESENTED
// The second one is written by the AGENT after presenting; the enforcer only
// READS it (this plugin writes no file). So the test must write it — expecting
// suppression WITHOUT writing it would be requiring the plugin to write a file.
//
// (a) `retro:` present, `.aggregated` ABSENT → aggregation is due. A FIRST
// session in that state gets 聚合呈现 (already asserted by V27 on the same root).
// (b) then the agent presents and writes `.aggregated` → every LATER session of
// the same batch must NOT aggregate again, and must fall through to the LANDING
// face rather than going silent (不静默丢素材: the material still lands).
await writeFile(join(batchEndRoot, '.scratch', 'retro', '.aggregated'), '2026-10-17T18:00:00Z\n')
const handleBE2 = await ctx.agents.create({
  sessionId: SessionId('enforcer-retroend-other-session'),
  meta: { cwd: batchEndRoot },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
await emitSessionEvent(ctx, handleBE2.agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 305, name: 'bash', arguments: JSON.stringify({ command: 'git push' }) },
})
const v29 = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handleBE2.agent, signal)))
if (!aggregateText(v29) && retroText(v29)
  && v29.includes('already') && v29.includes('.scratch/retro/.aggregated'))
  ok('V29. after the agent wrote `.aggregated`, a LATER session does not re-aggregate — it lands (每批至多一次, 素材不丢)')
else bad('V29. cross-session aggregation suppression lost',
  `aggregate: ${aggregateText(v29)} | lands: ${retroText(v29)} | names .aggregated: ${v29.includes('.scratch/retro/.aggregated')}`)
// A THIRD session (yet another session id, same batch) confirms it is the FILE
// that suppresses, not any one session's state.
const handleBE3 = await ctx.agents.create({
  sessionId: SessionId('enforcer-retroend-third-session'),
  meta: { cwd: batchEndRoot },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
await emitSessionEvent(ctx, handleBE3.agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 3051, name: 'bash', arguments: JSON.stringify({ command: 'git push' }) },
})
const v29c = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handleBE3.agent, signal)))
if (!aggregateText(v29c) && retroText(v29c)) ok('V29c. a THIRD session of the same batch also does not aggregate (the file is the suppressor)')
else bad('V29c. third-session suppression lost', v29c.slice(-240))
// The aggregation reminder must TELL the agent to write the marker — otherwise
// the suppression could never engage in a real run.
if (v27.includes('.scratch/retro/.aggregated') && /which YOU write after\s+'?\s*presenting|write after/.test(v27))
  ok('V29d. the aggregation reminder instructs the agent to write `.aggregated` (the suppressor is agent-written)')
else bad('V29d. aggregation reminder omits the .aggregated instruction', v27.slice(-260))

// V29f: the aggregation text must not carry the RETRACTED claim that `retro:` is
// the suppressor. This is the same negative lock C2f-2 applies to the body and
// docs — but C2f-2 reads ONLY those two surfaces, and the ENFORCER's injected
// prompt was left out. Measured on HEAD: the injected line still read "The
// `retro:` marker … is what keeps this to once per batch" while the sentence two
// lines later said `.aggregated` does the suppressing — a self-contradiction in
// the one text the model actually reads at the batch end (defect class D3,
// 文档说谎). Red for the fix is simply restoring that sentence.
//
// The retracted claim is matched by the PHRASE ALONE (not "retro: … phrase"):
// the perturbation that reddens this may leave the `retro:` mention far earlier
// in the joined string, so anchoring on proximity makes the lock vacuous —
// measured, first draft stayed green under a restored claim.
const RETRACTED = [
  /is what keeps (?:this|it) to once per batch/i,
  /(?:that|the) marker\s+is what stops every LATER session/i,
  /retro:`?\s+marker[^.]{0,80}is what keeps/i,
]
const retained = RETRACTED.filter(re => re.test(v27)).map(re => String(re))
if (retained.length === 0 && v27.includes('.aggregated') && /suppresses a SECOND/i.test(v27))
  ok('V29f. aggregation text names `.aggregated` as the suppressor and drops the retracted `retro:` claim (D3 guard)')
else bad('V29f. aggregation text still credits the retracted suppressor, or lost the correct one',
  `retained=${retained.join(' | ') || '—'} | has .aggregated=${v27.includes('.aggregated')}`)
// the inverse: batch-state.md WITHOUT `retro:` → 落盘, not 聚合.
const noMarkRoot = tmpRoot(await mkdtemp(join(tmpdir(), 'dsh-enforcer-nomark-')))
await mkdir(join(noMarkRoot, '.scratch'), { recursive: true })
await writeFile(join(noMarkRoot, '.scratch', 'batch-state.md'), '# Batch state\n\n| 1 | #71 | 进行中 |\n')
const handleNM = await ctx.agents.create({
  sessionId: SessionId('enforcer-nomark'),
  meta: { cwd: noMarkRoot },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
await emitSessionEvent(ctx, handleNM.agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 306, name: 'bash', arguments: JSON.stringify({ command: 'git push' }) },
})
const v29b = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handleNM.agent, signal)))
if (retroText(v29b) && !aggregateText(v29b)) ok('V29b. batch-state.md WITHOUT the `retro:` marker → 落盘 (the marker is the discriminator)')
else bad('V29b. marker discrimination lost', v29b.slice(-240))
// A batch that reached `retro:` but never aggregated (no `.aggregated`) still
// aggregates for EVERY session that runs — the marker, not the session count, is
// what gates it. (Guards against "only the first session ever" being hard-coded.)
const freshAggRoot = tmpRoot(await mkdtemp(join(tmpdir(), 'dsh-enforcer-freshagg-')))
await mkdir(join(freshAggRoot, '.scratch'), { recursive: true })
await writeFile(join(freshAggRoot, '.scratch', 'batch-state.md'), '# Batch state\n\n- retro: done @ abc123\n')
let freshAggMisses = []
for (const [i, sid] of ['fresh-a', 'fresh-b'].entries()) {
  const h = await ctx.agents.create({
    sessionId: SessionId(`enforcer-${sid}`),
    meta: { cwd: freshAggRoot },
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
  })
  await emitSessionEvent(ctx, h.agent.session, {
    type: 'tool/call',
    data: { turn: 1, step: 307 + i, name: 'bash', arguments: JSON.stringify({ command: 'git push' }) },
  })
  const text = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(h.agent, signal)))
  if (!aggregateText(text)) freshAggMisses.push(sid)
  await h.dispose()
}
if (freshAggMisses.length === 0)
  ok('V29e. without `.aggregated`, EVERY session of an ended batch aggregates (the marker gates it, not a session counter)')
else bad('V29e. aggregation suppressed without the `.aggregated` marker', freshAggMisses.join(', '))

// ── V30a: 层面断言 — the judgement input is ALWAYS `(toolName, argv)`, and the
// push trigger walks the SAME structured road as the ⚠ gate. Behavioural half:
// `write`/`edit` doc bodies full of "git push" arm NOTHING (not the retro
// reminders, and not the ⚠ push follow-up lines either).
const w1 = await afterCall('write', { file_path: 'docs/handoff.md', content: '下一步 git push origin feat/71，然后跑 retro 落盘' }, 401)
if (noRetro(w1) && clean(w1)) ok('V30a. write body carrying `git push` → no retro trigger, no ⚠ (tool layer, not text)')
else retroDown('V30a. write body armed the retro trigger', w1)
const w2 = await afterCall('edit', { file_path: 'notes.md', old_string: 'a', new_string: 'git push 之后再 retro' }, 402)
if (noRetro(w2) && clean(w2)) ok('V30a2. edit body carrying `git push` → no retro trigger, no ⚠')
else retroDown('V30a2. edit body armed the retro trigger', w2)
// Source-level half: the trigger reads the declaration's words through the
// structured core. The invariANT is not "gateMatches returns true" (that helper
// takes whatever gate string it is HANDED, so it can be true while the wiring is
// wrong) — it is that on the SAME samples, "the ⚠ gate hit `git push`" and "the
// retro reminder was injected" agree case by case, because both walk
// `actionSurface` + `matchesSurface`. `write`/`pty_send`/`echo` flip BOTH ways
// together under the substring perturbation.
const SAME_TRUTH = [
  ['bash', { command: 'git push origin main' }, true],
  ['bash', { command: 'write', file_path: 'x', content: 'git push' }, false],
  ['write', { file_path: 'x', content: 'git push' }, false],
  ['pty_send', { id: 'p', data: 'git push\n' }, false],
  ['bash', { command: 'echo "git push"' }, false],
  ['bash', { command: 'gh issue create --body "git push"' }, false],
]
const disagree = []
for (const [name, args, wantPush] of SAME_TRUTH) {
  const gate = gateMatches('git push', { name, arguments: args })
  const text = await afterCall(name, args, 500)
  const injected = text.includes(RETRO_MARK.push) || text.includes(RETRO_MARK.aggregate)
  if (gate !== wantPush || injected !== wantPush) disagree.push(`${name}: gate=${gate} retro=${injected} want=${wantPush}`)
}
if (disagree.length === 0)
  ok('V30a3. push judgement ≡ the ⚠ gate judgement on the same samples (both walk actionSurface+matchesSurface)')
else bad('V30a3. push judgement drifted from the structured core', disagree.join(' | '))

// ── V30b: merely DISCUSSING push/推送 in ANY text event is inert. Real fixture
// text: this repo's handoff/ticket/retro prose is full of the word.
const TEXT_NEGATIVES = [
  ['assistant/message', { turn: 1, step: 403, message: { role: 'assistant', content: [{ type: 'text', text: '接下来 git push origin main，推送后等 CI 全绿，再跑 retro 落盘' }] } }],
  ['user/message', { turn: 1, step: 404, source: { kind: 'user' }, message: { role: 'user', content: [{ type: 'text', text: 'push 之前先把 retro 候选落盘，推送别忘了' }] } }],
  ['text-chunks', { turn: 1, step: 405, texts: ['已完成 push，推送完成，可以 retro 了'] }],
  ['agent/inbox/spliced', { turn: 1, step: 406, target: 'next-turn', start: 0, removedCount: 0, inserted: [{ id: 'v30b-inbox', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'handoff：本票收尾需 push，推送后跑 retro；见 docs/handoff 正文里的 push 讨论' }] }] }],
]
let v30bBad = []
for (const [type, data] of TEXT_NEGATIVES) {
  await emitSessionEvent(ctx, agent.session, { type, data })
  const text = await render()
  if (!noRetro(text)) v30bBad.push(type)
}
if (v30bBad.length === 0) ok('V30b. discussion of push/推送 in every text-event shape → no trigger (text layer inert)')
else bad('V30b. text event armed the retro trigger', v30bBad.join(', '))

// ── V30c: a command that MENTIONS the push but does not EXECUTE it — the
// payload is text (doc body, commit message, issue body, --grep pattern).
const MENTION_ONLY = [
  ['bash', { command: 'echo "git push"' }, 407],
  ['bash', { command: 'git commit -m "note: git push 之后再 retro"' }, 408],
  ['bash', { command: 'git log --grep="git push"' }, 410],
]
let v30cBad = []
for (const [name, args, step] of MENTION_ONLY) {
  const text = await afterCall(name, args, step)
  if (!noRetro(text)) v30cBad.push(String(args.command))
}
if (v30cBad.length === 0) ok('V30c. mention-only commands (echo / -m / --grep) → no retro trigger')
else bad('V30c. mention-only command armed the retro trigger', v30cBad.join(' | '))
// The ticket's inline-body vector on its REAL surface: `gh issue create --body
// "…git push…"` IS a genuine external action, so the ⚠ GATE fires — but the
// mention inside its body must not arm the retro trigger, and must not drag in
// the push follow-up line either (V19g asserts the same on the ⚠ side).
const v30cBody = await afterCall('bash', { command: 'gh issue create --body "记得 git push"' }, 409)
if (v30cBody.includes('High-risk action detected') && noRetro(v30cBody) && !v30cBody.includes('remote CI run'))
  ok('V30c2. gh issue create --body "…git push…" → ⚠ on the ACTION, but no retro trigger / no push follow-up')
else bad('V30c2. inline-body gh call armed the retro trigger',
  `⚠: ${v30cBody.includes('High-risk action detected')} | retro: ${!noRetro(v30cBody)} | CI follow-up: ${v30cBody.includes('remote CI run')}`)

// ── V30d: the text layer NEVER arms — PIN (same shape as V18f/V21h). Arm every
// text-event shape with push words, then assemble TWICE; neither may carry a
// retro/aggregate line. (Red only if text events start arming tool/call.)
await emitSessionEvent(ctx, agent.session, {
  type: 'assistant/message',
  data: { turn: 1, step: 411, message: { role: 'assistant', content: [{ type: 'text', text: 'git push origin main 推送 push' }] } },
})
await emitSessionEvent(ctx, agent.session, { type: 'text-chunks', data: { turn: 1, step: 412, texts: ['git push origin main push 推送'] } })
const v30d1 = await render()
const v30d2 = await render()
if (noRetro(v30d1) && noRetro(v30d2)) ok('V30d. text events armed with push words, two assemblies → still nothing (never arm)')
else retroDown('V30d. text layer armed the retro trigger', noRetro(v30d1) ? v30d2 : v30d1)

// ── V30e: indirect / PTY pushes are DECLARED NOT COVERED (#79 口径) — the fact
// probe is the fallback, not a guess. `node deploy.mjs` (the push happens inside
// a script), a PTY fragment write, and an undeclared tool face are all inert.
const INDIRECT = [
  ['bash', { command: 'node deploy.mjs' }, 413],
  ['pty_send', { id: 'p1', data: 'git push\n', submit: true }, 414],
  ['gh', { args: 'issue create --body "git push"' }, 415],
]
let v30eBad = []
for (const [name, args, step] of INDIRECT) {
  const text = await afterCall(name, args, step)
  if (!noRetro(text)) v30eBad.push(name)
}
if (v30eBad.length === 0) ok('V30e. indirect script push / pty_send fragment / undeclared face → no trigger (declared not covered)')
else bad('V30e. uncovered face armed the retro trigger', v30eBad.join(', '))

// ── V30f (#71 AC「文本事件结构上永不 arm push」— STRUCTURAL, not symptomatic).
// V30b/V30d only pin the SYMPTOM (text carrying push words → no retro text). This
// pins the GUARD ITSELF through real harness behaviour, without a brittle
// "source contains this string" scan: the push arming hook is a `tool/call`
// handler that returns early for every other event type, so a text event can
// never CONSUME the one-shot either. Shown by contrast — a real push arms a
// reminder that the NEXT assembly consumes; if the text events had reached the
// same arming path, the reminder would be re-armed and reappear here.
await emitSessionEvent(ctx, agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 416, name: 'bash', arguments: JSON.stringify({ command: 'git push origin main' }) },
})
const v30fArmed = await render()   // consumes the one-shot
if (!retroText(v30fArmed)) {
  bad('V30f. setup: real push did not arm (cannot test the guard)', v30fArmed.slice(-200))
} else {
  // Re-send every text-event shape, with a FRESH inbox id each time (the inbox
  // projection rejects a repeated message id, so the shape must differ per use).
  for (const [type, data] of TEXT_NEGATIVES) {
    await emitSessionEvent(ctx, agent.session, {
      type,
      data: type === 'agent/inbox/spliced'
        ? { ...data, inserted: data.inserted.map(m => ({ ...m, id: 'v30f-inbox' })) }
        : data,
    })
  }
  const v30f = await render()
  const v30f2 = await render()
  if (noRetro(v30f) && noRetro(v30f2))
    ok('V30f. text events cannot re-arm the one-shot after a real push (non-`tool/call` events never reach the arming hook)')
  else retroDown('V30f. a text event reached the push arming hook', noRetro(v30f) ? v30f2 : v30f)
}

// ── V30g (#71 AC「落盘不触外部动作门」): the retro reminders are REMINDER-ONLY —
// a session whose push armed a retro reminder must not thereby show the
// external-action gate for anything else. Same `clean()` semantics as V18/V19
// (⚠ line absent), so this cannot be satisfied by weakening those.
const v30g = await afterCall('bash', { command: 'git push origin main' }, 417)
const v30gretro = retroText(v30g) || aggregateText(v30g)
if (v30gretro && v30g.includes('High-risk action detected'))
  ok('V30g. retro reminder rides the SAME assembly as the ⚠ for the push itself (no extra gate)')
else bad('V30g. retro assembly shape unexpected', v30g.slice(-220))
// the discrimination: a non-push action that carries retro wording in its TEXT
// must show NEITHER the retro reminder NOR a ⚠.
const v30g2 = await afterCall('bash', { command: 'echo "retro 落盘 .scratch/retro/x.md"' }, 418)
if (noRetro(v30g2) && clean(v30g2))
  ok('V30g2. retro wording in a command\'s text → no retro reminder and no ⚠ (reminder-only, gate untouched)')
else bad('V30g2. retro wording armed a gate or the retro reminder', v30g2.slice(-220))

// ── V31 (#71 fail-loud AC): an UNREADABLE `.scratch/batch-state.md` must not be
// flattened into "no marker". A failed probe reports LOUDLY and then treats the
// push as the per-ticket landing face — deciding the batch-end face on a file it
// could not read is precisely the silent degradation the AC forbids (the file
// may well carry `retro:`).
// The loud section carries NO ⚠ prefix — that prefix belongs to the high-risk
// action gate, and borrowing it here would train the model to treat a local
// bookkeeping failure as a dangerous action.
if (RETRO_TRIGGER.aggregatedMarker === '.scratch/retro/.aggregated')
  ok('V31pre. RETRO_TRIGGER.aggregatedMarker declares the aggregation suppressor path')
else bad('V31pre. aggregatedMarker declaration', String(RETRO_TRIGGER.aggregatedMarker))

const ERR_MARK = 'Batch-state probe FAILED'
const errRoot = tmpRoot(await mkdtemp(join(tmpdir(), 'dsh-enforcer-probeerr-')))
await mkdir(join(errRoot, '.scratch'), { recursive: true })
// A DIRECTORY masquerading as the file → EISDIR. Portable (chmod 000 is a no-op
// on Windows, which is why this is the fixture A-line measured as stable).
await mkdir(join(errRoot, '.scratch', 'batch-state.md'), { recursive: true })
const handleErr = await ctx.agents.create({
  sessionId: SessionId('enforcer-probeerr'),
  meta: { cwd: errRoot },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
await emitSessionEvent(ctx, handleErr.agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 421, name: 'bash', arguments: JSON.stringify({ command: 'git push origin main' }) },
})
const v31 = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handleErr.agent, signal)))
const v31loud = v31.includes(ERR_MARK)
const v31code = /Batch-state probe FAILED \(([A-Z]+)\)/.exec(v31)?.[1] ?? ''
const v31lands = retroText(v31) && !aggregateText(v31)
if (v31loud && v31code === 'EISDIR' && v31lands
  && v31.includes('could not read') && v31.includes('per-ticket landing face')
  && !v31.includes('⚠ ' + ERR_MARK))
  ok('V31. unreadable batch-state.md → loud probe-failure section (EISDIR) + landing face, no ⚠ prefix')
else bad('V31. fail-loud probe reporting incomplete',
  `loud: ${v31loud} | code: ${v31code || '—'} | lands: ${v31lands} | ⚠-prefixed: ${v31.includes('⚠ ' + ERR_MARK)}`)

// The DISCRIMINATION the AC turns on: absent (ENOENT) must NOT report a failure.
// A missing file is a normal non-batch session, not a broken one — flattening the
// two together would either cry wolf on every ordinary push or hide a real fault.
const absentRoot = tmpRoot(await mkdtemp(join(tmpdir(), 'dsh-enforcer-probeabsent-')))
await mkdir(join(absentRoot, '.scratch'), { recursive: true })
const handleAbsent = await ctx.agents.create({
  sessionId: SessionId('enforcer-probeabsent'),
  meta: { cwd: absentRoot },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
await emitSessionEvent(ctx, handleAbsent.agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 422, name: 'bash', arguments: JSON.stringify({ command: 'git push origin main' }) },
})
const v31b = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handleAbsent.agent, signal)))
if (!v31b.includes(ERR_MARK) && retroText(v31b) && !aggregateText(v31b))
  ok('V31b. ABSENT batch-state.md (ENOENT) → no failure section, plain landing face (absent ≠ error)')
else bad('V31b. absent/error discrimination lost',
  `loud: ${v31b.includes(ERR_MARK)} | lands: ${retroText(v31b)}`)

// A `.aggregated` probe that itself FAILS (here: a directory in its place) must
// NOT suppress — failing open to the aggregation face is the safe direction, the
// opposite of the batch-state probe (which must not fail open to "no batch").
const aggErrRoot = tmpRoot(await mkdtemp(join(tmpdir(), 'dsh-enforcer-aggerr-')))
await mkdir(join(aggErrRoot, '.scratch', 'retro', '.aggregated'), { recursive: true })
await writeFile(join(aggErrRoot, '.scratch', 'batch-state.md'), '# Batch state\n\n- retro: done @ abc123\n')
const handleAggErr = await ctx.agents.create({
  sessionId: SessionId('enforcer-aggerr'),
  meta: { cwd: aggErrRoot },
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, 'enforcersmoke'),
})
await emitSessionEvent(ctx, handleAggErr.agent.session, {
  type: 'tool/call',
  data: { turn: 1, step: 423, name: 'bash', arguments: JSON.stringify({ command: 'git push origin main' }) },
})
const v31c = await renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handleAggErr.agent, signal)))
if (aggregateText(v31c) && !retroText(v31c))
  ok('V31c. an UNREADABLE `.aggregated` probe does not suppress (fails open to the aggregation face)')
else bad('V31c. unreadable .aggregated suppressed the aggregation',
  `aggregate: ${aggregateText(v31c)} | lands: ${retroText(v31c)}`)

// ═══════════════════════════════════════════════════════════════════════════
// ── V32–V34 (#113): the HOME-DELETE reminder. The third recurrence of the
// home-deletion incident (2026-10-18) reached the ⚠ gate's blind spot: the gate
// list matches WORD RUNS at the command position (`rm -rf`), so the PowerShell
// cmdlet form `Remove-Item -Recurse -Force $env:DSH_HOME` — which names no gate
// word at all — was structurally invisible to it. The new face is a
// COMBINATION declared in `HOME_DELETE_TRIGGER` (a delete verb at a command
// position AND a home-shaped target in that same command's argv), judged on the
// SAME structured core (`actionSurface` + `matchesSurface`) as every other face
// here. Reminder-only: nothing is intercepted (#113's honest boundary — a
// repository-side guard cannot physically stop a shell command).
//
// V32 is the POSITIVE matrix (AC4): the three spellings the ticket names, plus
// the verb/alias and wrapper reach the declaration promises.
// V33 is the NEGATIVE matrix (AC5, 宁严勿宽): the exact false positives the
// ticket outlaws — a quoted payload, a `write` body, an ordinary clean-up of
// one's own output, and a temp-directory target (the SAFE form — flagging it
// would train the model to ignore the reminder).
// V34 pins that the arming READS the declaration (runtime-added verb arms,
// removal disarms) and that the whole verb/alias family is reachable — a
// hand-copied matcher or a dead declared verb reddens it.
//
// Non-vacuous: deleting the `homeDeleteHit` wiring (or the injected section)
// reddens V32 wholesale; widening the judgement to a substring over the
// serialized call — the pre-#79 bug shape — reddens V33.
const HOME_MARK = 'Home-delete candidate'
const homeText = (text) => text.includes(HOME_MARK)
const homeDown = (label, text) => bad(label, (text.split('\n').find(l => l.includes(HOME_MARK)) ?? text.slice(-200)))

// V32 (#113 AC4): the ticket's own command, verbatim — the exact spelling that
// was invisible to the gate.
const h1 = await afterCall('pwsh', { command: 'Remove-Item -Recurse -Force $env:DSH_HOME' }, 601)
if (homeText(h1)) ok('V32a. Remove-Item -Recurse -Force $env:DSH_HOME → home-delete reminder (AC4)')
else homeDown('V32a. the incident command stayed invisible', h1)

const h2 = await afterCall('bash', { command: 'rm -rf $HOME' }, 602)
if (homeText(h2)) ok('V32b. rm -rf $HOME → home-delete reminder (AC4)')
else homeDown('V32b. rm -rf $HOME missed', h2)

const h3 = await afterCall('cmd', { command: 'del /s %USERPROFILE%\\.dsh' }, 603)
if (homeText(h3)) ok('V32c. del /s %USERPROFILE%\\.dsh → home-delete reminder (AC4)')
else homeDown('V32c. del /s home form missed', h3)

// One-shot: consumed by the assembly that fires it, like every other face. The
// assertion is CONJUNCTIVE on purpose — "no repeat" alone is satisfied by an
// implementation that never fires at all (measured: with `homeDeleteHit` disabled
// this case stayed green while V32a–V32c went red, i.e. it was vacuous). It now
// requires that the first render DID carry the line and the next did NOT.
const h1b = await render()
if (homeText(h1) && !homeText(h1b)) ok('V32d. home-delete reminder fires once then is consumed (no repeat)')
else homeDown('V32d. consumed-once contract broken', `first fired: ${homeText(h1)} | second fired: ${homeText(h1b)}`)

// The declared reach — aliases, `~`-forms, the unix rmdir, wrappers and a
// command list (red if the verb list is reduced to one spelling, or if only a
// line's FIRST command is judged).
const HOME_REACH = [
  ['pwsh', { command: 'ri -Recurse -Force $env:DSH_HOME' }, 'alias ri'],
  ['pwsh', { command: 'Remove-Item -Recurse -Force "$HOME\\.dsh"' }, 'quoted $HOME'],
  ['bash', { command: 'rm -rf ~/.dsh' }, '~/.dsh'],
  ['bash', { command: 'rmdir -p ~/.dsh' }, 'rmdir'],
  ['bash', { command: 'sudo rm -rf $HOME/.dsh' }, 'sudo wrapper'],
  ['bash', { command: 'cd x && Remove-Item -Recurse -Force $env:DSH_HOME' }, 'command list'],
  ['bash', { command: 'bash -c "rm -rf $HOME/.dsh"' }, 'executed payload'],
]
const homeReachMisses = []
for (const [i, [name, args, label]] of HOME_REACH.entries()) {
  const text = await afterCall(name, args, 610 + i)
  if (!homeText(text)) homeReachMisses.push(label)
}
if (homeReachMisses.length === 0)
  ok('V32e. declared reach: alias / quoted $HOME / ~/.dsh / rmdir / wrapper / command-list / payload all fire', `${HOME_REACH.length} cases`)
else bad('V32e. declared home-delete reach lost', homeReachMisses.join(', '))

// V33 (#113 AC5, 宁严勿宽): the false positives the ticket outlaws. Each of
// these is a REAL shape from this repo's daily work — a cleanup of one's own
// build output, a doc/body mentioning the incident command, and (critically)
// the SAFE sandbox form whose target is the temp directory.
const HOME_FALSE_POSITIVES = [
  ['bash', { command: 'echo "Remove-Item -Recurse $env:DSH_HOME"' }, 'echo of the incident command'],
  ['bash', { command: 'rm -rf ./dist' }, 'ordinary build cleanup'],
  ['bash', { command: 'Remove-Item ./build -Recurse' }, 'ordinary PowerShell cleanup'],
  ['bash', { command: 'rm -rf /tmp/dsh-enforcer-x' }, 'temp-dir target (the SAFE form)'],
  ['bash', { command: 'rm -rf $env:TEMP/dsh-x' }, 'temp-VARIABLE target (the SAFE form — must not be flagged)'],
  ['cmd', { command: 'rmdir /s %TEMP%\\dsh-x' }, 'temp-VARIABLE target, cmd spelling'],
  ['bash', { command: 'rm -rf node_modules' }, 'dependency cleanup'],
  ['bash', { command: 'git commit -m "note: rm -rf $HOME 的事故"' }, 'commit message'],
  ['bash', { command: 'git log --grep="Remove-Item -Recurse $env:DSH_HOME"' }, '--grep pattern'],
  ['write', { file_path: 'docs/x.md', content: '事故命令是 Remove-Item -Recurse -Force $env:DSH_HOME' }, 'write body (AC5 verbatim)'],
  ['edit', { file_path: 'x.md', old_string: 'a', new_string: 'rm -rf $HOME' }, 'edit body'],
  ['str_replace_editor', { command: 'create', path: 'x.md', file_text: 'rm -rf ~/.dsh' }, 'str_replace_editor body'],
  ['pty_send', { id: 'p', data: 'rm -rf $HOME\n' }, 'PTY fragment (declared not covered)'],
]
const homeFalsePositives = []
for (const [i, [name, args, label]] of HOME_FALSE_POSITIVES.entries()) {
  const text = await afterCall(name, args, 630 + i)
  if (homeText(text)) homeFalsePositives.push(label)
}
if (homeFalsePositives.length === 0)
  ok('V33. AC5 negatives: quoted payload / own-output cleanup / temp target / text bodies → no reminder', `${HOME_FALSE_POSITIVES.length} cases`)
else bad('V33. home-delete false positive', homeFalsePositives.join(' | '))

// The reminder's content contract: it must name the read-only-variable trap, the
// remedy (`scripts/with-temp-home.mjs`), and the "only a path this command
// created" rule. A reminder that merely says "careful" is not the fix.
const h4 = await afterCall('pwsh', { command: 'Remove-Item -Recurse -Force $env:DSH_HOME' }, 650)
const h4parts = {
  'names the read-only trap': /READ-ONLY/.test(h4),
  'names $HOME': h4.includes('$HOME'),
  'names $tmpHome guidance': h4.includes('$tmpHome'),
  'points at the helper': h4.includes('scripts/with-temp-home.mjs'),
  'own-created-path rule': h4.includes('THIS command created'),
}
const h4missing = Object.entries(h4parts).filter(([, hit]) => !hit).map(([k]) => k)
if (homeText(h4) && h4missing.length === 0)
  ok('V33b. reminder carries the read-only-variable trap + helper pointer + own-path rule')
else bad('V33b. reminder content incomplete', `fired: ${homeText(h4)} | missing: ${h4missing.join(', ') || '—'}`)

// V33c: the target VOCABULARY itself — a direct matrix over the spellings that
// must fire and the ones that must not. This is the case that pins the
// deliberate exclusion of `$env:TEMP` / `%TEMP%`: the temp directory is the SAFE
// target, and flagging it would train the model to ignore the reminder. It is a
// UNIT-level pin on top of V33's behavioural negatives because the first draft of
// this face matched ANY `$env:` expansion (measured: `$env:TEMP` fired) — a
// widening that V33's real-command samples alone did not catch.
const HOME_TARGET_POSITIVES = [
  '~/.dsh', '~\\.dsh', '~', '$env:DSH_HOME', '${env:DSH_HOME}', 'env:DSH_HOME',
  '$HOME', '$DSH_HOME', '$HOME/x', '%USERPROFILE%\\.dsh', '%DSH_HOME%',
  'HOME', 'USERPROFILE', 'env:USERPROFILE', '.dsh', 'C:\\Users\\me\\.dsh',
  '/home/me/.dsh', 'foo/.dsh/bar', '$HOME\\.dsh', 'env:DSH_HOME/x',
]
const HOME_TARGET_NEGATIVES = [
  '$env:TEMP', '%TEMP%', 'env:TEMP/x', '$env:TEMP\\x', '$env:RUNNER_TEMP',
  '/tmp/dsh-enforcer-x', './dist', 'node_modules', 'build', 'dsh-temp-home-abc',
  '.dshbackup', 'mydsh', 'C:\\Users\\me\\projects', 'HOME_DIR', 'HOMEDRIVE',
]
const targetMisses = []
const targetFalsePositives = []
for (const [i, probe] of [...HOME_TARGET_POSITIVES, ...HOME_TARGET_NEGATIVES].entries()) {
  const want = i < HOME_TARGET_POSITIVES.length
  const text = await afterCall('bash', { command: `rm -rf "${probe}"` }, 700 + i)
  const fired = homeText(text)
  if (want && !fired) targetMisses.push(probe)
  if (!want && fired) targetFalsePositives.push(probe)
}
if (targetMisses.length === 0 && targetFalsePositives.length === 0)
  ok('V33c. target vocabulary: declared home spellings fire, temp-directory spellings never do', `${HOME_TARGET_POSITIVES.length} pos / ${HOME_TARGET_NEGATIVES.length} neg`)
else bad('V33c. target vocabulary drifted',
  `missed: ${targetMisses.join(', ') || '—'} | false positives: ${targetFalsePositives.join(', ') || '—'}`)

// V34 (#113 AC「声明式、非子串」): the arming READS the declaration — add a verb
// at runtime and it arms; remove it again and it stops. A hand-copied matcher
// (or any hard-coded path that bypasses `HOME_DELETE_TRIGGER`) leaves this
// green, so this is the non-vacuous single-source-of-truth pin (same shape as
// V23b for `TICKET_LIFECYCLE`).
import { HOME_DELETE_TRIGGER } from '../workflow-enforcer.mjs'
// `try/finally` (not a bare push/pop pair): the runtime mutation below is shared
// module state, so an assertion that throws between them would leave the
// declaration polluted for every LATER case in this file — a flake that would
// read as someone else's failure.
let homeMutated
let homeUnmutated
// Truncate back to the ORIGINAL LENGTH rather than `pop()`: `pop()` removes the
// LAST element, which is only the pushed one while nothing else appended in
// between — a length snapshot is order-independent and exception-safe.
const homeVerbCount = HOME_DELETE_TRIGGER.verbs.length
try {
  HOME_DELETE_TRIGGER.verbs.push('wipe-home-probe')
  homeMutated = await afterCall('bash', { command: 'wipe-home-probe -rf $HOME' }, 660)
} finally {
  HOME_DELETE_TRIGGER.verbs.length = homeVerbCount
}
homeUnmutated = await afterCall('bash', { command: 'wipe-home-probe -rf $HOME' }, 661)
if (homeText(homeMutated) && !homeText(homeUnmutated))
  ok('V34. arming reads HOME_DELETE_TRIGGER.verbs (runtime-added verb arms, removal disarms — #113 single source)')
else bad('V34. home-delete declaration is not the arming single source',
  `add → ${homeText(homeMutated) ? 'armed' : 'did NOT arm'} | remove → ${homeText(homeUnmutated) ? 'still armed' : 'disarmed'}`)

// Every DECLARED verb must be reachable from a real invocation — a dead verb is
// lost coverage, not a tightening (the V20 discipline). `rd` and `erase` are the
// two the incident's family implies but nobody would think to test.
const HOME_VERB_CANONICAL = {
  'Remove-Item': { name: 'pwsh', arguments: { command: 'Remove-Item -Recurse -Force $env:DSH_HOME' } },
  'ri': { name: 'pwsh', arguments: { command: 'ri -Recurse -Force $HOME' } },
  'rm': { name: 'bash', arguments: { command: 'rm -rf $HOME' } },
  'rmdir': { name: 'bash', arguments: { command: 'rmdir ~/.dsh' } },
  'del': { name: 'cmd', arguments: { command: 'del /s %USERPROFILE%\\.dsh' } },
  'erase': { name: 'cmd', arguments: { command: 'erase /s %USERPROFILE%\\.dsh' } },
  'rd': { name: 'cmd', arguments: { command: 'rd /s %USERPROFILE%\\.dsh' } },
}
const deadVerbs = []
const unprovenVerbs = []
// Step numbers come from the ITERATION INDEX, not `verbs.indexOf(verb)`: with a
// duplicated declaration entry `indexOf` returns the FIRST match for both, so two
// cases would share one step number (and the numbering would silently depend on
// array order rather than on the loop).
for (const [i, verb] of HOME_DELETE_TRIGGER.verbs.entries()) {
  const canonical = HOME_VERB_CANONICAL[verb]
  if (canonical === undefined) { unprovenVerbs.push(verb); continue }
  const text = await afterCall(canonical.name, canonical.arguments, 670 + i)
  if (!homeText(text)) deadVerbs.push(verb)
}
// Every declared TARGET must likewise be reachable (a target nobody can write is
// a declaration the model can never benefit from). The probe is DERIVED from the
// declaration — `probe(target)` builds the command that carries exactly that
// declared target — so the correspondence is checked, not assumed: a hand-written
// parallel list would let both sides drift together (and a bare
// `probes.length === targets.length` count is near-tautological).
const targetProbeCall = (target) => {
  // The declared spellings are shell syntax; each is carried into a real command
  // for the shell that actually writes it that way.
  if (target.startsWith('%')) return { name: 'cmd', arguments: { command: `del /s ${target}` } }
  if (target.startsWith('$env:')) return { name: 'pwsh', arguments: { command: `Remove-Item -Recurse -Force ${target}` } }
  if (target.startsWith('$')) return { name: 'bash', arguments: { command: `rm -rf ${target}` } }
  return { name: 'bash', arguments: { command: `rm -rf ${target}` } }
}
const deadTargets = []
for (const [i, target] of HOME_DELETE_TRIGGER.targets.entries()) {
  const call = targetProbeCall(target)
  // Self-check the probe really carries the declared target (the needle must hit).
  if (!String(call.arguments.command).includes(target)) {
    deadTargets.push(`${target} (probe does not carry it)`)
    continue
  }
  const text = await afterCall(call.name, call.arguments, 680 + i)
  if (!homeText(text)) deadTargets.push(target)
}
if (deadVerbs.length === 0 && unprovenVerbs.length === 0 && deadTargets.length === 0)
  ok('V34b. every declared verb and target is reachable from a canonical invocation', `${HOME_DELETE_TRIGGER.verbs.length} verbs / ${HOME_DELETE_TRIGGER.targets.length} targets`)
else bad('V34b. dead / unproven home-delete declaration',
  `unproven: ${unprovenVerbs.join(', ') || '—'} | dead verbs: ${deadVerbs.join(', ') || '—'} | dead targets: ${deadTargets.join(', ') || '—'}`)

// V34c: the documented 判定面 row must not drift from the declaration — the same
// doc↔code guard V17/V23c apply (one-directional by nature: that row is prose).
const docHome = readFileSync(new URL('../docs/workflow-enforcer.md', import.meta.url), 'utf8')
  .split('\n').find(l => l.includes('HOME_DELETE_TRIGGER')) ?? ''
const declaredHomeElements = [...HOME_DELETE_TRIGGER.verbs, ...HOME_DELETE_TRIGGER.targets]
const missingHomeInDoc = declaredHomeElements.filter(s => !docHome.includes(s))
if (docHome !== '' && missingHomeInDoc.length === 0)
  ok('V34c. 判定面 row documents every declared home-delete element (no doc↔code drift)', `${declaredHomeElements.length} elements`)
else bad('V34c. home-delete doc/declaration drift',
  docHome === '' ? 'no 判定面 row mentioning HOME_DELETE_TRIGGER' : `missing from the row: ${missingHomeInDoc.join(', ')}`)

// Fixture teardown — every borrowed cwd is removed, not just disposed (#77 is
// the same class of defect; `dispose()` frees the session, NOT the temp dir).
await handleBE3.dispose()
await handleAggErr.dispose()
await handleAbsent.dispose()
await handleErr.dispose()
await handleNM.dispose()
await handleBE2.dispose()
await handleDecl2.dispose()
await handleDecl.dispose()
await handleBE.dispose()
// #77: 临时根统一收尾 —— 失败全部保留现场并逐个响亮打印绝对路径，成功才全部清除。
// 清单来自**创建即登记**的 `tmpRoots`（不再手抄；先前正是手抄漏了 batchRoot 那一项）。
// 判据与文件末尾的 process.exit 同源（同一个 results 扫描），保证「非 0 退出」与
// 「目录还在」永远一致；`tmpSettled` 让前面那个进程级兜底不再重复打印。
tmpSettled = true
if (results.some(r => r.startsWith('  ✗'))) {
  for (const root of tmpRoots) console.log(`tmp kept: ${root}`)
} else {
  for (const root of tmpRoots) await rm(root, { recursive: true, force: true })
}

await handle.dispose()
console.log('\n=== WORKFLOW-ENFORCER VERIFY (V1–V34) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
