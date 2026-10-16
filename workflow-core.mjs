/**
 * workflow-core — the ask-matt workflow as an injectable plugin (#54).
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
 * agent-loop registers {{model}}/{{cwd}} per assembly — so the injected
 * section interpolates exactly like persona-carried text did. The body is
 * split from the persona prefix at a blank-line boundary, and the sections
 * join with "\n\n" exactly where that blank line was, so a preset that
 * mounts this plugin renders a prompt verbatim-identical to the old
 * persona-carried version (L1 assertion).
 *
 * Scope guard: injection must never leak into non-workflow sessions, so the
 * default scope is marker-based — the section is only added when the
 * assembled prompt already carries the ask-matt marker. A preset that
 * mounts this row deliberately (its mount IS the opt-in) passes
 * `scope: 'all'` to receive the workflow text regardless of a marker.
 *
 * Config:
 *   - scope:  'marker' (default — inject only when the marker is present)
 *             or 'all' (inject on every assembly of a mounting preset).
 *   - marker: the scope-guard marker (default 'ask-matt').
 *   - order:  section placement (default 10 — right after the persona
 *             prefix at order 0, before plan policy at 500).
 *   - text:   override the body source (e.g. a delta variant); default
 *             reads workflow-body.txt next to this file.
 */
import { readFile } from 'node:fs/promises'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workflow-core'

/** The prompt registry this plugin contributes to. */
export const inject = ['systemPrompt']

/** Injected section name (stable — diagnostics and dedupe key). */
export const SECTION_NAME = 'workflow:core'

/** The workflow body, read once next to this file (verbatim split point).
 * A failed read is retried on the next assembly — a transient EBUSY during
 * install must not disable the plugin for the process lifetime. */
let bodyPromise
export function workflowBody() {
  bodyPromise ??= readFile(new URL('./workflow-body.txt', import.meta.url), 'utf8')
    .catch((error) => { bodyPromise = undefined; throw error })
  return bodyPromise
}

/** Register the assemble filter once per mount. */
export function apply(ctx, config = {}) {
  const scope = config.scope ?? 'marker'
  const marker = config.marker ?? 'ask-matt'
  const order = config.order ?? 10

  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next() // downstream errors propagate untouched
    try {
      if (scope !== 'all') {
        const texts = (assembled?.sections ?? []).map(section => section?.text ?? '').join('\n')
        if (!texts.includes(marker)) return assembled
      }
      const sections = Array.isArray(assembled?.sections) ? assembled.sections : []
      if (sections.some(section => section?.name === SECTION_NAME)) return assembled
      const text = (config.text ?? (await workflowBody())).replace(/\r\n/g, '\n')
      return { ...assembled, sections: [...sections, { name: SECTION_NAME, order, text }] }
    } catch (error) {
      // A filter bug must never brick every request of a session.
      ctx.logger(name).warn(String(error?.stack ?? error))
      return assembled
    }
  }, { prepend: true })
}
