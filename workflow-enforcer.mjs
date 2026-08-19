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
export const inject = ['systemPrompt']

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

/** Keywords that mark a fold-in claim (lowercased match). */
const FOLD_KEYWORDS = ['并入', '关联票', '一并', '顺带', '同时处理', '合并', '连带', 'merge', 'fold in']

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
  try {
    const meter = ctx.get('tokenMeter')
    const m = meter?.measure(agent.session)
    used = m?.totalTokens
    const base = m?.baseline
    if (base?.kind === 'usage' && base.usage) {
      const input = base.usage.inputTokens ?? 0
      const cached = base.usage.cacheReadTokens ?? 0
      const denom = input + cached
      if (denom > 0) cachePct = Math.round((cached / denom) * 100)
    }
  } catch { /* measurement is best-effort */ }
  if (used === undefined || used <= 0) return null
  const capacity = agent.session.requestContext?.()?.contextWindow
  const parts = [`context: ${Math.round(used / 1000)}k used`]
  if (typeof capacity === 'number' && capacity > 0) {
    parts.push(`/ ${Math.round(capacity / 1000)}k (${Math.round((used / capacity) * 100)}%)`)
  }
  if (cachePct !== undefined) parts.push(`· cache-read ${cachePct}%`)
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
    }
  }
  if (foldIntent.get(agent.session) === true && config.contextEvidence !== false) {
    foldIntent.delete(agent.session) // consume: one evidence line per claim
    const evidence = contextEvidence(agent, ctx)
    if (evidence !== null) parts.push(evidence)
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
  })

  // Fold-in intent: assistant text mentioning merging/attaching a related
  // ticket arms the next assembly with measured context evidence.
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'text-chunks' && event?.type !== 'assistant/message') return
    const data = event.data ?? {}
    const texts = data.texts ?? []
    const text = (Array.isArray(texts) ? texts.join(' ') : JSON.stringify(data)).toLowerCase()
    if (FOLD_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) foldIntent.set(session, true)
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
