/**
 * workflow-wrapup-card — the batch-end wrap-up card kind (#182, ADR-0017 §4
 * axis B), mounted as its own plugin row so the workflow body (workflow-core)
 * never depends on the action-cards service.
 *
 * What it registers: one card kind `batch_wrap_up` whose skill is the bundled
 * `batch-wrap-up` skill (skills/batch-wrap-up/ — the propose_action pre-load;
 * upstream rule: a call is admitted only in a turn whose ROOT agent loaded the
 * kind's skill via its own `skill` tool). One card per turn is an upstream
 * invariant, so the wrap is one card per batch end — never per ticket.
 *
 * The five wrap sections (delivered / L0 ledger / open L1 questions / D21
 * pending / session↔PR bindings) live in the CARD FACE ONLY as content the
 * agent writes — the canonical structure and the dual-form degradation
 * (card ⇄ prose wrap section, S3: absence is declared loudly) are pinned by
 * the batch component's `batch-wrap-up` section and the skill text; the
 * guard tests/verify-wrapup-card.mjs asserts the two forms stay isomorphic.
 *
 * Deliberate design limits (each is a decision, not an omission):
 *   - `verbs: {}` — no custom user action. The card presents the wrap; the
 *     D21 push confirmation STAYS a conversational gate-6 event, so the card
 *     creates no new confirmation point (ADR-0017 §4(4) / 票面 AC1).
 *   - no client body row ships with this preset — the card frame folds a
 *     long brief and unfolds it verbatim, so `brief` IS the presentation
 *     surface and carries the five sections in full.
 *   - no `reconcile` — the wrap carries no state outside the Session to
 *     reconcile against.
 *
 * Absence semantics (cordis): `inject: ['actionCards']` keeps this plugin's
 * fiber INACTIVE while the action-cards service is missing (the
 * personalized-recommendations bundle is in the default install set but its
 * rows are disabled until enabled on the Plugins page; ptc presets never see
 * cards at all). Missing service ⇒ no kind, no propose_action eligibility ⇒
 * the prose form. When the service appears the fiber activates by itself —
 * no roster change either way.
 *
 * Config: none. The kind has nothing to tune; the service's
 * `queuedMessageLimit` stays the service's own field.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workflow-wrapup-card'

/** The action-cards service owns the propose_action tool, card state and user actions. */
export const inject = ['actionCards']

/** Card action this plugin registers (value of propose_action's `action` argument). */
export const ACTION = 'batch_wrap_up'

/** The skill whose in-turn load admits the call (must equal the SKILL.md name). */
export const KIND_SKILL = 'batch-wrap-up'

/** The five wrap sections, in canonical order — the isomorphism anchor shared
 * with the batch component's `batch-wrap-up` section and the skill text. */
export const WRAP_SECTIONS = ['delivered', 'l0Ledger', 'openQuestions', 'd21Pending', 'forgeBindings']

/**
 * Minimal `details` validator for the kind. Upstream types demand a zod
 * schema, but the service consumes exactly one protocol: `safeParse(input)`
 * → `{ success: true, data }` or `{ success: false, error: { issues: [{ path,
 * message }] } }` (dsh-action-cards src/index.ts — register() and
 * detailsIssues() only). Issue paths follow the zod convention the service
 * renders: its issuesOf() prepends the literal 'details.' itself, so a path
 * here is `[key]` (and `[]` for a non-object input) — emitting 'details'
 * inside the path would render as a doubled `details.details.<key>`. This
 * preset carries no zod dependency, so the validator implements the protocol
 * directly: every section is an optional array of strings; unknown keys and
 * non-conforming values are rejected so a malformed wrap fails loudly at
 * propose time instead of rendering as garbage.
 */
export const detailsSchema = {
  safeParse(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { success: false, error: { issues: [{ path: [], message: 'expected an object' }] } }
    }
    const data = {}
    for (const key of Object.keys(input)) {
      if (!WRAP_SECTIONS.includes(key)) {
        return { success: false, error: { issues: [{ path: [key], message: `unknown wrap section — expected: ${WRAP_SECTIONS.join(', ')}` }] } }
      }
      const value = input[key]
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        return { success: false, error: { issues: [{ path: [key], message: 'expected an array of strings' }] } }
      }
      data[key] = value
    }
    return { success: true, data }
  },
}

/**
 * Register the `batch_wrap_up` kind for this plugin's lifetime; unloading the
 * plugin removes the kind (upstream behavior — actions on its cards are then
 * refused, except Not now on an unstarted card).
 * @param {import('@deepseek-ai/cordis').Context} ctx - owning plugin context.
 */
export function apply(ctx) {
  ctx.actionCards.register({
    action: ACTION,
    skill: KIND_SKILL,
    details: detailsSchema,
    invitation: 'End with one short invitation in the user\'s language, in the first person: '
      + 'the batch-end wrap is on the card below — five sections (what landed, L0 self-decisions to audit, '
      + 'parked questions, pending confirmations, session↔PR bindings); confirmations and answers stay in the chat.',
    // No custom verbs: the card presents the wrap and offers only Not now.
    // The D21 push confirmation stays a conversational gate-6 event — the card
    // must never become a confirmation button (no new confirmation point).
    verbs: {},
    statusGuidance: 'The wrap card is presentation only: dismissing it or leaving it unacted confirms nothing '
      + '— every D21 external action still needs the conversational confirmation.',
    // verbs is empty, so the service routes nothing here; the contract still
    // requires a handler for every verb except dismiss. Refusing loudly keeps
    // an unknown verb from ever looking accepted.
    act: async () => ({ status: 'refused', reason: 'unavailable' }),
  })
}
