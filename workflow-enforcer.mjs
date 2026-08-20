/**
 * workflow-enforcer — hard-gate reminders for the ask-matt workflow.
 *
 * The WORKFLOW ENFORCEMENT gates in the matt persona are soft prose and decay
 * in long execution sessions (observed: 250 tool calls, zero
 * ask_user_question, AGENTS.md rules read only after a correction). This
 * plugin keeps the gates that fail most in the model's sight at the right
 * moment:
 *
 *   1. EXTERNAL/DESTRUCTIVE-ACTION GATE (D21) — before git push, gh
 *      pr/issue/release, npm publish, database reset/drop, rm -rf,
 *      force-push, docker volume/system prune… the model must report the
 *      outcome and WAIT for the human's confirmation. Injected as a baseline
 *      reminder on every prompt assembly, plus an immediate追加 reminder
 *      after a matching tool call.
 *   2. CORRECTION SEDIMENTATION (D22) — a human correction must be
 *      acknowledged and written down (propose the doc, get a nod, write).
 *
 * The high-risk list is the plugin default, overridable per project via
 * `workflow-gates.yml` (external:/destructive: lists) or per-row config
 * (extra/drop). Injection is reminder-only — nothing is intercepted; the
 * human stays in the loop.
 *
 * Hooks (agent-loop / system-prompt seams):
 *   - `session/event` (type `tool/call`) — remember the latest raw call per
 *     session (matching needs the agent's cwd, which only the assemble hook
 *     has).
 *   - `system-prompt/assemble` (prepend) — resolve gates for this agent,
 *     match the remembered call, and inject one `workflow:gates` section:
 *     baseline + the matched high-risk call (consumed, so it fires once).
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workflow-enforcer'

/** The prompt registry this plugin contributes to. */
export const inject = ['systemPrompt', 'tools']

/** Default gate list. Match = case-insensitive substring over the call. */
export const DEFAULT_GATES = {
  external: [
    'git push', 'gh pr create', 'gh issue create',
    'gh release create', 'gh repo create', 'npm publish', 'cargo publish',
  ],
  destructive: [
    'git reset --hard', 'git clean -f', 'rm -rf', 'docker compose down -v',
    'docker volume rm', 'docker system prune', 'drop database', 'truncate table',
    'delete from', 'git push --force',
  ],
}

/** Latest raw tool call per session, consumed by the next assemble. */
const lastCall = new WeakMap()

/** Sessions whose latest assistant text shows intent to fold in a related
 * ticket (并入/关联/一并/顺带…). Armed by the event hook, consumed by the
 * next assemble, which then attaches the measured context evidence so the
 * human can verify the claim. */
const foldIntent = new WeakMap()

/** Sessions that just closed a ticket (`gh issue close` / state=closed).
 * Armed by the tool/call event hook, consumed by the next assemble, which
 * then nudges ONE fresh-subagent quality spot check: self-assessment runs
 * in the same context it would be judging, so it cannot see its own
 * degradation (O5). */
const ticketClosed = new WeakMap()

/** Matches an issue-close tool call: `gh issue close N` or a PATCH that
 * sets state=closed on issues/N. */
const CLOSE_PATTERNS = [
  /\bgh\s+issue\s+close\b/,
  /issues\/\d+[^"]*state[=:]["']?closed["']?/i,
  /["']state["']\s*[:=]\s*["']closed["']/i,
]

/** Keywords that mark a fold-in claim (lowercased match). */
/** Keywords that arm context evidence: fold-in claims (agent) or
 * context-capacity assessments (user asking how much window is left). */
export const FOLD_KEYWORDS = [
  '并入', '关联票', '一并', '顺带', '同时处理', '合并', '连带', 'merge', 'fold in',
  '评估', '容量', '还能装', '够不够', '可并入', '能不能继续', '上下文', '窗口',
  'assess', 'context capacity', 'window left', 'how much context',
]

/** Parse a tool call's arguments (JSON string or object). */
function callArgs(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return {} }
  }
  return value ?? {}
}

/** Whether a gate (space-separated words) appears in the call surface. */
function gateHit(gate, surface) {
  const haystack = surface.toLowerCase()
  return gate.toLowerCase().split(' ').every(part => haystack.includes(part))
}

/**
 * Effective gates for one agent: project file wins (optionally merged with
 * the default), else default + row-config extras/drops.
 */
export function effectiveGates(config = {}) {
  const external = [...DEFAULT_GATES.external]
  const destructive = [...DEFAULT_GATES.destructive]
  const drop = (list, names) => (names ?? []).reduce((acc, n) => acc.filter(x => x !== n), list)
  return {
    external: drop(external, config.dropExternal).concat(config.extraExternal ?? []),
    destructive: drop(destructive, config.dropDestructive).concat(config.extraDestructive ?? []),
  }
}

/** Project-level gate file (workflow-gates.yml by default, relative to cwd). */
export async function projectGates(cwd, fileName = 'workflow-gates.yml') {
  if (!cwd) return null
  const path = isAbsolute(fileName) ? fileName : join(cwd, fileName)
  try {
    const doc = parseYaml(await readFile(path, 'utf8')) ?? {}
    const list = (key) => Array.isArray(doc[key]) ? doc[key].map(String) : []
    return { external: list('external'), destructive: list('destructive') }
  } catch {
    return null
  }
}

/** Resolve the final gates for an agent, preferring the project file. */
async function resolveGates(agent, config) {
  const project = await projectGates(agent?.session?.meta?.cwd, config.gatesFile)
  if (project !== null && (project.external.length > 0 || project.destructive.length > 0)) {
    if (config.includeDefault) {
      const base = effectiveGates(config)
      return {
        external: [...base.external, ...project.external],
        destructive: [...base.destructive, ...project.destructive],
      }
    }
    return project
  }
  return effectiveGates(config)
}

/** Measured context evidence for a fold-in decision: used / capacity /
 * cache-read share, from tokenMeter + session.requestContext(). Null when
 * nothing measurable — degrade to no line, never break rendering. */
export function contextEvidence(agent, ctx) {
  let used
  let cachePct
  let cacheKind
  try {
    const meter = ctx.get('tokenMeter')
    const m = meter?.measure(agent.session)
    used = m?.totalTokens
    // Cumulative cache-read share across the whole session: fold the usage
    // reported on each assistant/message event, replacing per turn/step (a
    // step's later sample supersedes its earlier one, never double-counts —
    // the same semantics as token-meter's tokenUsage projection). Answers
    // "how much of what we've consumed was served from cache". Fall back to
    // the latest-request baseline and label the anchor so the caller can
    // tell the two apart.
    let inputTotal = 0
    let cachedTotal = 0
    try {
      const perStep = new Map()
      for (const ev of agent.session.events ?? []) {
        if (ev?.type !== 'assistant/message') continue
        const u = ev?.data?.usage ?? ev?.usage
        if (!u) continue
        const key = `${ev.data?.turn}:${ev.data?.step}`
        perStep.set(key, u)
      }
      for (const u of perStep.values()) {
        inputTotal += u.inputTokens ?? 0
        cachedTotal += u.cacheReadTokens ?? 0
      }
    } catch { /* event iteration is best-effort */ }
    const denom = inputTotal + cachedTotal
    if (denom > 0) {
      cachePct = Math.round((cachedTotal / denom) * 100)
      cacheKind = 'cumulative'
    } else {
      const base = m?.baseline
      if (base?.kind === 'usage' && base.usage) {
        const input = base.usage.inputTokens ?? 0
        const cached = base.usage.cacheReadTokens ?? 0
        const bdenom = input + cached
        if (bdenom > 0) {
          cachePct = Math.round((cached / bdenom) * 100)
          cacheKind = 'latest-request'
        }
      }
    }
  } catch { /* measurement is best-effort */ }
  if (used === undefined || used <= 0) return null
  const capacity = agent.session.requestContext?.()?.contextWindow
  const shown = used >= 1000 ? `${Math.round(used / 1000)}k` : String(used)
  const parts = [`context: ${shown} used`]
  if (typeof capacity === 'number' && capacity > 0) {
    parts.push(`/ ${Math.round(capacity / 1000)}k (${Math.round((used / capacity) * 100)}%)`)
  }
  if (cachePct !== undefined) parts.push(`· cache-read ${cachePct}% (${cacheKind})`)
  return parts.join(' ')
}

/** Baseline reminder text (short — never dominates a request). */
function baselineText() {
  return [
    'WORKFLOW GATES — external/destructive actions (git push, gh pr/issue/release,',
    'publish, database reset/drop, rm -rf, force-push, docker volume/system prune):',
    'finish, report the outcome, and WAIT for the human\'s confirmation before running.',
    'A human correction must be acknowledged and written down (propose the doc).',
    'One issue per session.',
  ].join('\n')
}

/** renderPrompt treats `{{…}}` as prompt-variable references; tool-call text
 * may legitimately contain template syntax (issue bodies, shell snippets).
 * Neutralize braces at the single choke point so an injected command can
 * never break prompt rendering (malformed variable reference). */
function sanitizePrompt(text) {
  return String(text).replace(/\{\{/g, '[[').replace(/\}\}/g, ']]')
}

/** The reminder section text for one request, or null when nothing applies. */
async function reminderText(agent, config, ctx, assembled) {
  // Scope: by default inject only where the ask-matt workflow persona is
  // present (the marker is found in the assembled sections). The bundle is
  // installed globally via `dsh plugin add`, so this keeps minimal/code/…
  // sessions untouched without needing a reliable preset id on the session.
  if (config.scope !== 'all') {
    const marker = config.marker ?? 'ask-matt'
    const texts = (assembled?.sections ?? []).map(section => section?.text ?? '').join('\n')
    if (!texts.includes(marker)) return null
  }
  const parts = []
  if (config.baseline !== false) parts.push(baselineText())
  const call = lastCall.get(agent.session)
  if (call !== undefined) {
    lastCall.delete(agent.session) // consume: fires once per matched call
    const gates = await resolveGates(agent, config)
    const surface = JSON.stringify(call)
    const hit = [...gates.external, ...gates.destructive].find(gate => gateHit(gate, surface))
    if (hit !== undefined) {
      const cmd = call.arguments.command ?? call.name
      parts.push(`⚠ High-risk action detected: ${String(cmd).slice(0, 120)} — report the outcome and WAIT for confirmation.`)
      if (gateHit('git push', surface)) {
        parts.push('After the push, check the remote CI run for the pushed commit — done means local checks pass, pushed, AND CI green.')
      }
    }
  }
  if (foldIntent.get(agent.session) === true && config.contextEvidence !== false) {
    foldIntent.delete(agent.session) // consume: one evidence line per claim
    const evidence = contextEvidence(agent, ctx)
    if (evidence !== null) parts.push(evidence)
  }
  if (ticketClosed.get(agent.session) === true && config.ticketClosedCheck !== false) {
    ticketClosed.delete(agent.session) // consume: one nudge per close
    parts.push([
      'Ticket closed — before reporting done, run ONE fresh-subagent quality',
      'spot check: compare an early vs a late reasoning sample (depth,',
      'constraint adherence, drift). Self-assessment cannot see its own',
      'degradation — the fresh view can (O5).',
    ].join(' '))
  }
  return parts.length > 0 ? sanitizePrompt(parts.join('\n\n')) : null
}

/** Register the hooks once per standing mount. */
export function apply(ctx, config = {}) {
  const cfg = { ...config }

  // Remember the latest raw tool call per session; matching happens on the
  // next assemble (where the agent's cwd is available).
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'tool/call') return
    const data = event.data ?? {}
    lastCall.set(session, { name: data.name, arguments: callArgs(data.arguments) })
    const surface = JSON.stringify(data)
    if (CLOSE_PATTERNS.some(re => re.test(surface))) ticketClosed.set(session, true)
  })

  // Arm context evidence: assistant fold-in claims AND user assessments of
  // context capacity ("上下文容量怎么样", "评估能否并入") both arm the next
  // assembly, so the measured numbers are present while the model estimates.
  ctx.on('session/event', (session, event) => {
    if (!['text-chunks', 'assistant/message', 'user/message'].includes(event?.type)) return
    const data = event.data ?? {}
    const texts = data.texts ?? []
    const text = (Array.isArray(texts) ? texts.join(' ') : JSON.stringify(data)).toLowerCase()
    if (FOLD_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) foldIntent.set(session, true)
  })

  // Model-driven context query: the agent calls this when the user asks about
  // context/window/capacity (or before folding in a related ticket). This
  // bypasses the arm-timing dead end where user/message events land after the
  // first assembly of the turn.
  ctx.tools.register({
    name: 'context_status',
    description: [
      'Query the current session context usage: tokens used, capacity, and',
      'cache-read share. Call this when the user asks about context, window,',
      'capacity, or token usage — answer with the measured numbers, not an',
      'estimate. Also call it before deciding whether to fold in a related ticket.',
    ].join(' '),
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(_args, exec) {
      const agent = exec?.agent
      if (agent === undefined || agent.session === undefined) return { text: 'context status unavailable: no agent' }
      const evidence = contextEvidence(agent, ctx)
      return { text: evidence ?? 'context usage not measurable (tokenMeter unavailable)' }
    },
  })

  // Inject the reminder section on every prompt assembly.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next() // downstream errors propagate untouched
    const agent = context.agent
    if (agent === undefined || agent.session === undefined) return assembled
    try {
      const text = await reminderText(agent, cfg, ctx, assembled)
      if (text === null) return assembled
      const sections = Array.isArray(assembled.sections) ? assembled.sections : []
      return {
        ...assembled,
        sections: [...sections, { name: 'workflow:gates', order: 95, text }],
      }
    } catch (error) {
      // A filter bug must never brick every request of a session.
      ctx.logger(name).warn(String(error?.stack ?? error))
      return assembled
    }
  }, { prepend: true })
}
