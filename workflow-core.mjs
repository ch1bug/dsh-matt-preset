/**
 * workflow-core — the ask-matt workflow as an injectable plugin (#54), now
 * carrying a per-profile delta mechanism (#55).
 *
 * The workflow BODY (MAIN FLOW + WORKFLOW ENFORCEMENT gates + BATCH MODE +
 * every auxiliary section) used to ride inside the matt persona prefix
 * (CONTEXT.md D18). This plugin carries it instead and injects it through
 * the `system-prompt/assemble` path — the mechanism workflow-enforcer
 * already proves out — so ANY preset can mount the workflow with a single
 * plugin row (`dsh-matt-preset/workflow-core.mjs`, resolved via the
 * package's own subpath exports, never a profile-directory-relative `./`
 * path — the same trap the enforcer row documents).
 *
 * Rendering contract (spike-proven, tests/verify-workflow-core.mjs S1):
 * the assemble waterfall runs BEFORE renderPrompt interpolates, and
 * agent-loop registers {{model}} per assembly — so the injected
 * section interpolates exactly like persona-carried text did. The body is
 * split from the persona prefix at a blank-line boundary, and the sections
 * join with "\n\n" exactly where that blank line was, so a preset that
 * mounts this plugin renders a prompt verbatim-identical to the old
 * persona-carried version (L1 assertion).
 *
 * Profiles (#55, ADR-0011; #56, ADR-0012): the body is one SHARED SKELETON
 * (workflow-body.txt) sectioned by `@@ <id>` marker lines, plus per-profile
 * DELTA files (workflow-profile-<name>.txt) written in the same marker
 * syntax. A marker carries exactly one optional clause — `tight` or
 * `after=<anchor>`:
 *   - a delta id matching a skeleton section REPLACES that section (keeping
 *     its skeleton position);
 *   - a new id is inserted where its `after=<anchor>` says, and appended
 *     when no anchor is given.
 * `standard` carries no delta — it is the skeleton verbatim, byte-identical
 * to the #54 body (AC1 in tests/verify-workflow-profiles.mjs). `cordis`
 * (creator preset), `ptc` (PTC execution shape) and `minimal` (compressed
 * token-budget text) each adapt the workflow from a delta. An adapting
 * profile therefore never copies shared text: the seven gates exist in
 * exactly one place, and the marker lines themselves never reach the model.
 *
 * Tight-joined sections (#56, ADR-0012): `@@ <id> tight` glues a section to
 * the PREVIOUS one with a single newline instead of the blank separator, so
 * text that #54 connected with single newlines (the enforcement block: the
 * seven gates, then DONE / TEST SCOPE TIERING / RECOVERY DISCIPLINE) can be
 * SPLIT without changing a byte of the standard render — and therefore
 * without copying the gates into a profile delta. The flag describes the
 * separator BEFORE the section, so it is a property of the skeleton POSITION:
 * a delta declaring `tight` is a bug (loud), because an override keeps its
 * skeleton position and an insert is always blank-separated. A line starting
 * with `@@` that does not match the grammar is loud too — a typo must never
 * turn into prompt prose.
 *
 * Scope guard: injection must never leak into non-workflow sessions, so the
 * default scope is marker-based — the section is only added when the
 * assembled prompt already carries the ask-matt marker. A preset that
 * mounts this row deliberately (its mount IS the opt-in) passes
 * `scope: 'all'` to receive the workflow text regardless of a marker.
 *
 * Config:
 *   - profile: 'standard' (default), 'cordis' (creator preset: plugin
 *              authoring adaptations), 'ptc' (PTC execution shape: program
 *              surface vocabulary, gates unchanged) or 'minimal' (compressed
 *              token-budget text, gates unchanged). An unknown name falls back
 *              to the default with one warn per mount — a typo must never cost
 *              a session its workflow text.
 *   - scope:  'marker' (default — inject only when the marker is present)
 *             or 'all' (inject on every assembly of a mounting preset).
 *   - marker: the scope-guard marker (default 'ask-matt').
 *   - order:  section placement (default 10 — right after the persona
 *             prefix at order 0, before plan policy at 500).
 *   - text:   override the body source (profile ignored).
 */
import { readFile } from 'node:fs/promises'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workflow-core'

/** The prompt registry this plugin contributes to. */
export const inject = ['systemPrompt']

/** Injected section name (stable — diagnostics and dedupe key). */
export const SECTION_NAME = 'workflow:core'

/** The profile a mount gets when it does not name one. */
export const DEFAULT_PROFILE = 'standard'

/** Profile registry: name → delta file URL (`null` = the skeleton verbatim).
 * Adding a profile = dropping one delta file here; the shared text is never
 * touched. */
export const PROFILES = {
  standard: null,
  cordis: new URL('./workflow-profile-cordis.txt', import.meta.url),
  ptc: new URL('./workflow-profile-ptc.txt', import.meta.url),
  minimal: new URL('./workflow-profile-minimal.txt', import.meta.url),
}

/** `@@ <id>`, `@@ <id> tight` or `@@ <id> after=<anchor>` — a delimiter line.
 * Exactly one optional clause: `tight` describes the separator before the
 * section (skeleton only), `after=` where a delta section is inserted. */
const DELIMITER = /^@@\s+([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s+(tight|after=([A-Za-z0-9][A-Za-z0-9._-]*)))?\s*$/

/** Whether `name` names a registered profile. */
function knownProfile(name) {
  return typeof name === 'string' && Object.hasOwn(PROFILES, name)
}

/**
 * Split a sectioned text into `{ id, after, tight, text }` sections.
 * Line endings are normalized; the caller keeps `trailingNewline` so the
 * recomposition can reproduce the source bytes exactly. Loud on malformed
 * input: text before the first marker, a `@@`-prefixed line the grammar does
 * not accept, a duplicate id, or a tight flag on the first section is a
 * packaging bug, not something to paper over.
 */
export function parseSections(text) {
  const normalized = String(text).replace(/\r\n/g, '\n')
  const trailingNewline = normalized.endsWith('\n')
  const lines = (trailingNewline ? normalized.slice(0, -1) : normalized).split('\n')
  const collected = []
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const hit = DELIMITER.exec(lines[i])
    if (hit !== null) {
      const tight = hit[2] === 'tight'
      // The flag says "glue me to the previous section"; section 0 has none.
      if (tight && collected.length === 0) {
        throw new Error(`workflow section "${hit[1]}" is tight-joined but is the FIRST section — there is nothing to glue it to (line ${i + 1})`)
      }
      current = { id: hit[1], after: hit[3] ?? null, tight, body: [] }
      collected.push(current)
      continue
    }
    // A marker-shaped line that does not parse is a typo, never body text.
    if (lines[i].startsWith('@@')) {
      throw new Error(`malformed workflow section marker (line ${i + 1}): ${JSON.stringify(lines[i])} — expected "@@ <id>", "@@ <id> tight" or "@@ <id> after=<anchor>"`)
    }
    if (current === null) {
      throw new Error(`workflow text before the first "@@ <id>" marker (line ${i + 1}): ${JSON.stringify(lines[i])}`)
    }
    current.body.push(lines[i])
  }
  const seen = new Set()
  for (const section of collected) {
    if (seen.has(section.id)) throw new Error(`duplicate workflow section id "${section.id}"`)
    seen.add(section.id)
    // The marker line occupies the blank separator's place: a body ending in a
    // blank line would silently add a third newline at the boundary.
    if (section.body.at(-1) === '') {
      throw new Error(`workflow section "${section.id}" ends with a blank line — sections are separated by the "@@ <id>" marker line, not by a blank line`)
    }
  }
  return {
    sections: collected.map(section => ({ id: section.id, after: section.after, tight: section.tight, text: section.body.join('\n') })),
    trailingNewline,
  }
}

/**
 * Apply `deltas` to `skeleton` sections. Overrides keep their skeleton
 * position (and with it the position's separator); inserts land right after
 * their anchor, in delta order.
 */
export function composeSections(skeleton, deltas = []) {
  if (!Array.isArray(skeleton)) throw new TypeError('composeSections: skeleton must be a section array')
  if (!Array.isArray(deltas)) throw new TypeError('composeSections: deltas must be a section array')
  const composed = skeleton.map(section => ({ id: section.id, text: section.text, tight: section.tight === true }))
  const byId = new Map(composed.map(section => [section.id, section]))
  const overridden = new Set()
  /** anchor id → id of the last section inserted after it (keeps delta order). */
  const lastInsertedAfter = new Map()
  for (const delta of deltas) {
    const id = delta?.id
    if (typeof id !== 'string' || id === '') throw new TypeError('composeSections: every delta section needs an id')
    // `tight` describes a skeleton position; a delta neither owns nor moves one.
    if (delta.tight === true) {
      throw new Error(`workflow delta "${id}" declares tight — the tight-join flag belongs to the skeleton section it sits at, not to a delta`)
    }
    const target = byId.get(id)
    if (target !== undefined) {
      if (delta.after != null) throw new Error(`workflow delta "${id}" both overrides a skeleton section and declares after=${delta.after}`)
      if (overridden.has(id)) throw new Error(`workflow delta overrides section "${id}" twice`)
      overridden.add(id)
      target.text = delta.text
      continue
    }
    const anchor = delta.after ?? null
    let at
    if (anchor === null) {
      at = composed.length
    } else {
      const previous = lastInsertedAfter.get(anchor) ?? anchor
      const found = composed.findIndex(section => section.id === previous)
      if (found < 0) throw new Error(`workflow delta "${id}" anchors on unknown section "${anchor}"`)
      at = found + 1
      lastInsertedAfter.set(anchor, id)
    }
    composed.splice(at, 0, { id, text: delta.text, tight: false })
  }
  return composed
}

/** Join sections back into one text: a blank line between sections, or the
 * single newline a `tight` section was split out of (#56). */
export function joinSections(sections, trailingNewline = true) {
  return sections
    .map((section, i) => (i === 0 ? '' : section.tight === true ? '\n' : '\n\n') + section.text)
    .join('') + (trailingNewline ? '\n' : '')
}

/**
 * Read-once cache with retry-on-failure: a failed read is retried on the next
 * assembly — a transient EBUSY during install must not disable the plugin for
 * the process lifetime. Keyed by profile so each profile is composed once.
 */
const cache = new Map()
function cached(key, load) {
  let promise = cache.get(key)
  if (promise === undefined) {
    promise = Promise.resolve().then(load).catch((error) => { cache.delete(key); throw error })
    cache.set(key, promise)
  }
  return promise
}

/** The shared skeleton, read once next to this file. */
export function skeletonText() {
  return cached('skeleton', () => readFile(new URL('./workflow-body.txt', import.meta.url), 'utf8'))
}

/** The injected body for `profile` (unknown names fall back to the default). */
export function profileBody(profile = DEFAULT_PROFILE) {
  const key = knownProfile(profile) ? profile : DEFAULT_PROFILE
  return cached('profile:' + key, async () => {
    const skeleton = parseSections(await skeletonText())
    const delta = PROFILES[key]
    if (delta === null) return joinSections(skeleton.sections, skeleton.trailingNewline)
    const deltas = parseSections(await readFile(delta, 'utf8'))
    return joinSections(composeSections(skeleton.sections, deltas.sections), skeleton.trailingNewline)
  })
}

/** #54 compat alias: the standard (skeleton) body. */
export function workflowBody() {
  return profileBody(DEFAULT_PROFILE)
}

/** Register the assemble filter once per mount. */
export function apply(ctx, config = {}) {
  const scope = config.scope ?? 'marker'
  const marker = config.marker ?? 'ask-matt'
  const order = config.order ?? 10
  const requested = config.profile ?? DEFAULT_PROFILE
  // Single decision point for the fallback: apply resolves the profile once at
  // mount (profileBody only guards its own direct callers — M4). The warn fires
  // once per mount on the first assembly, never once per request.
  const selected = knownProfile(requested) ? requested : DEFAULT_PROFILE
  let warned = false

  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next() // downstream errors propagate untouched
    try {
      if (scope !== 'all') {
        const texts = (assembled?.sections ?? []).map(section => section?.text ?? '').join('\n')
        if (!texts.includes(marker)) return assembled
      }
      const sections = Array.isArray(assembled?.sections) ? assembled.sections : []
      if (sections.some(section => section?.name === SECTION_NAME)) return assembled
      if (selected !== requested && !warned) {
        warned = true
        ctx.logger(name).warn(`unknown profile "${String(requested)}" — falling back to "${selected}"`)
      }
      const text = (config.text ?? (await profileBody(selected))).replace(/\r\n/g, '\n')
      return { ...assembled, sections: [...sections, { name: SECTION_NAME, order, text }] }
    } catch (error) {
      // A filter bug must never brick every request of a session.
      ctx.logger(name).warn(String(error?.stack ?? error))
      return assembled
    }
  }, { prepend: true })
}