/**
 * matt-workflow — the full ask-matt workflow text as a NON-persona prompt
 * section.
 *
 * The complete Matt workflow map is registered as its own section
 * (`matt:workflow`) right after the persona slot, so the flow map reads
 * first and stays editable separately from the one-line persona.
 * `{{model}}`/`{{cwd}}` stay as prompt variables — renderPrompt
 * interpolates them per assembly like any other section.
 *
 * This plugin CONSUMES host services only and publishes nothing, so it needs
 * no isolate realm.
 */
import { readFile } from 'node:fs/promises'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'matt-workflow'

/** The prompt registry must exist before this section registers. */
export const inject = ['systemPrompt']

/** Register the workflow section once per standing mount. */
export async function apply(ctx) {
  const text = await readFile(new URL('./matt-workflow.md', import.meta.url), 'utf8')
  ctx.systemPrompt.section({
    name: 'matt:workflow',
    // Right after the persona slot (order 0) so the flow map reads first.
    order: 1,
    text,
  })
}
