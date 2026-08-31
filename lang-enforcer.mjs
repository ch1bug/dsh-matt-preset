/**
 * lang-enforcer — language knowledge packs for the matt preset.
 *
 * Sibling to workflow-enforcer with a STRICTLY SEPARATE mandate: the
 * workflow persona (seven gates, phase flow) is untouched — this plugin only
 * injects KNOWLEDGE POINTERS ("which skill to consult") when the project
 * speaks a language that has a pack. It never emits process instructions;
 * process belongs to the seven gates, knowledge belongs to the pack.
 *
 * Packs are declarative YAML in `lang-packs/*.yml` (adding a language = adding
 * a file, zero code):
 *
 *   language: rust
 *   detect:            # any of these project files marks the language
 *     - Cargo.toml
 *   baseline: |        # injected once per session (config.baselineMode)
 *     LANG rust — …knowledge pointers…
 *   triggers:          # regex over the serialized tool call; note fires once
 *     - surface: '\\.rs\\b'
 *       note: |
 *         ⚠ lang:rust — …
 *
 * Injection points (same seams as workflow-enforcer):
 *   - `session/event` (type `tool/call`) — remember the latest raw call.
 *   - `system-prompt/assemble` (prepend) — resolve packs for the agent's cwd,
 *     inject one `lang:<language>` section: session baseline + matched
 *     trigger notes (consumed, so each fires once per matching call).
 *
 * Scope: by default only where the ask-matt persona is present (same marker
 * guard as workflow-enforcer). Project override: `lang-gates.yml` in the repo
 * root — `disable: [rust]` mutes a pack for that project.
 */
import { access, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'lang-enforcer'

/** The prompt registry this plugin contributes to. */
export const inject = ['systemPrompt']

/** Latest raw tool call per session, consumed by the next assemble. */
const lastCall = new WeakMap()

/** Positive language detection is cached per session (re-checked while null). */
const detected = new WeakMap()

/** Languages whose baseline was already injected (session-once). */
const baselined = new WeakMap()

/** Load one pack file; returns null (with a logged warning) on bad shape. */
async function loadPack(file, logger) {
  try {
    const doc = parseYaml(await readFile(file, 'utf8'))
    if (!doc || typeof doc !== 'object') return null
    const language = String(doc.language ?? '').trim()
    const detect = (Array.isArray(doc.detect) ? doc.detect : []).map(String)
    if (!language || detect.length === 0) {
      logger.warn(`pack ${file}: missing language or detect — skipped`)
      return null
    }
    const triggers = (Array.isArray(doc.triggers) ? doc.triggers : [])
      .map(t => ({ surface: String(t?.surface ?? ''), note: String(t?.note ?? '') }))
      .filter(t => t.surface && t.note)
      .map(t => ({ ...t, re: new RegExp(t.surface) }))
    return { language, detect, baseline: String(doc.baseline ?? ''), triggers }
  } catch (error) {
    logger.warn(`pack ${file}: ${String(error?.stack ?? error)}`)
    return null
  }
}

/** Load all packs once per standing mount (packs are plugin-owned data). */
async function loadPacks(dir, logger) {
  try {
    const files = (await readdir(dir)).filter(f => /\.ya?ml$/i.test(f))
    const packs = []
    for (const f of files) packs.push(await loadPack(join(dir, f), logger))
    return packs.filter(Boolean)
  } catch (error) {
    logger.warn(`packs dir ${dir}: ${String(error?.stack ?? error)}`)
    return []
  }
}

/** Project-level override (lang-gates.yml): { disable: [rust], baseline: "off" }. */
export async function projectGates(cwd, fileName = 'lang-gates.yml') {
  if (!cwd) return null
  const path = isAbsolute(fileName) ? fileName : join(cwd, fileName)
  try {
    const doc = parseYaml(await readFile(path, 'utf8')) ?? {}
    return {
      disable: (Array.isArray(doc.disable) ? doc.disable : []).map(String),
      baselineOff: doc.baseline === 'off',
    }
  } catch {
    return null
  }
}

/** Packs whose detect files exist in the project (positive result cached). */
async function resolvePacks(agent, packs, logger) {
  const cached = detected.get(agent.session)
  if (cached !== undefined) return cached
  const cwd = agent?.session?.meta?.cwd
  if (!cwd || packs.length === 0) return []
  const hits = []
  for (const pack of packs) {
    for (const file of pack.detect) {
      try {
        await access(isAbsolute(file) ? file : join(cwd, file))
        hits.push(pack)
        break
      } catch { /* detect file absent — keep scanning */ }
    }
  }
  if (hits.length > 0) detected.set(agent.session, hits)
  return hits
}

/** renderPrompt treats `{{…}}` as prompt-variable references; neutralize at
 * the single choke point (same convention as workflow-enforcer). */
function sanitizePrompt(text) {
  return String(text).replace(/\{\{/g, '[[').replace(/\}\}/g, ']]')
}

/** The reminder section text for one request, or null when nothing applies. */
async function reminderText(agent, config, packs, logger, ctx, assembled) {
  // Scope guard: only sessions carrying the matt persona marker (defensive —
  // the bundle may be mounted more widely than this preset).
  if (config.scope !== 'all') {
    const marker = config.marker ?? 'ask-matt'
    const texts = (assembled?.sections ?? []).map(section => section?.text ?? '').join('\n')
    if (!texts.includes(marker)) return null
  }

  const cwd = agent?.session?.meta?.cwd
  const gates = await projectGates(cwd, config.gatesFile)
  const disabled = gates?.disable ?? []
  const hits = (await resolvePacks(agent, packs, logger))
    .filter(pack => !disabled.includes(pack.language))
  if (hits.length === 0) return null

  const parts = []

  // Baseline: session-once by default; every-turn only on explicit config.
  const baselinedSet = baselined.get(agent.session) ?? new Set()
  const wantBaseline = config.baselineMode !== 'every-turn'
    ? hits.some(p => !baselinedSet.has(p.language))
    : true
  if (config.baseline !== false && !gates?.baselineOff && wantBaseline) {
    for (const pack of hits) {
      if (config.baselineMode !== 'every-turn') baselinedSet.add(pack.language)
      if (pack.baseline) parts.push(pack.baseline.trim())
    }
    baselined.set(agent.session, baselinedSet)
  }

  // Trigger notes: consume the latest call first (fires once per call, matched
  // or not — same semantics as workflow-enforcer).
  const call = lastCall.get(agent.session)
  if (call !== undefined) {
    lastCall.delete(agent.session)
    const surface = JSON.stringify(call)
    for (const pack of hits) {
      for (const trigger of pack.triggers) {
        if (trigger.re.test(surface)) parts.push(trigger.note.trim())
      }
    }
  }

  const language = hits.map(p => p.language).join('+')
  return parts.length > 0
    ? sanitizePrompt(`[lang:${language}]\n\n${parts.join('\n\n')}`)
    : null
}

/** Register the hooks once per standing mount. */
export function apply(ctx, config = {}) {
  const cfg = { ...config }
  const packsDir = isAbsolute(cfg.packsDir ?? '')
    ? cfg.packsDir
    : join(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), cfg.packsDir ?? 'lang-packs')
  const logger = ctx.logger(name)
  const packsReady = loadPacks(packsDir, logger)

  // Remember the latest raw tool call per session; matching happens on the
  // next assemble (where the agent's cwd is available).
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'tool/call') return
    const data = event.data ?? {}
    let args = data.arguments
    if (typeof args === 'string') {
      try { args = JSON.parse(args) } catch { args = {} }
    }
    lastCall.set(session, { name: data.name, arguments: args ?? {} })
  })

  // Inject the lang section on every prompt assembly, AFTER the workflow
  // gates section (order 95) — knowledge is subordinate to process.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next() // downstream errors propagate untouched
    const agent = context.agent
    if (agent === undefined || agent.session === undefined) return assembled
    try {
      const packs = await packsReady
      if (packs.length === 0) return assembled
      const text = await reminderText(agent, cfg, packs, logger, ctx, assembled)
      if (text === null) return assembled
      const sections = Array.isArray(assembled.sections) ? assembled.sections : []
      return {
        ...assembled,
        sections: [...sections, { name: 'lang:packs', order: 96, text }],
      }
    } catch (error) {
      // A filter bug must never brick every request of a session.
      logger.warn(String(error?.stack ?? error))
      return assembled
    }
  }, { prepend: true })
}
