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
 *   3. GRILL QUESTION CONTRACT — while a session is in grill/triage mode
 *      (skill call in the grill family, or a prompt starting /grill //
 *      /triage), inject the question-presentation recipe: one decision per
 *      message, status line, four-piece block, time estimate, opt-in batch.
 *      Validated by wording micro-test 2026-09-12 (control 5/5 batched 4+
 *      questions; recipe 5/5 converged, variance ≈ 0). Disable with
 *      `grillContract: false`.
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
 *
 * Gate matching is STRUCTURED (#79): the judgement reads a declared ACTION
 * field (shell tools → `arguments.command`; `plugin_manager` →
 * `arguments.action`) and matches the gate words at the COMMAND POSITION of
 * that action's argv — never as a substring over the whole serialized call.
 * The ticket-lifecycle nudges (关票 / 建票, #82) are judged on the SAME
 * structured surface: `TICKET_LIFECYCLE` declares their faces (command-position
 * word runs, plus the `gh api` face as an explicit declaration).
 * A tool with no declared action field (write / edit / pty_send / …) is
 * explicitly NOT covered, so prose that merely mentions `git push` can no
 * longer arm the gate (a false stop costs time and dilutes a reminder the
 * model must obey). The other face of the same root cause — indirect
 * execution that cannot be judged structurally (nested scripts, PTY writes) —
 * stays uncovered by design and is left to #71's fact probe, not to fuzzy
 * matching.
 *
 * PUSH-TRIGGERED RETRO (#71): a REAL push call arms the per-ticket retro
 * writing reminder, and a real push in a batch whose `.scratch/batch-state.md`
 * already carries the `retro:` completion marker arms the batch-end aggregation
 * reminder instead. The trigger face is the SAME structured core as the ⚠ gate
 * (`RETRO_TRIGGER.push` = the command-position word run `git push` over the
 * call's declared action field), and 宁严勿宽 holds: a false trigger burns a
 * retro run and pollutes the batch-end aggregation with junk candidates, which
 * costs more than a missed one — so the judgement stays narrow and never grows
 * a fallback. `write` / `edit` / `pty_send` and every other tool without a
 * declared action field NEVER arm it, and neither do the text events
 * (`assistant/message`, `user/message`, `text-chunks`, `agent/inbox/spliced`):
 * a session that merely discusses "推送/push" (a plan, a retro doc, a handoff
 * body) is inert.
 *
 * Two faces, deliberately different (not an inconsistency):
 *   - push is a TOOL event — it has a `(toolName, argv)` action surface, so it
 *     is judged there and ONLY there. The text layer is structurally excluded.
 *   - a batch declaration (攒批) is something the HUMAN SAYS — it has no tool
 *     call at all, so its only possible face is the text event layer, exactly
 *     like `BATCH_CLOSE_KEYWORDS`. Reading a declaration off a tool call would
 *     be inventing an action that does not exist; reading a push off free text
 *     would be the false positive #71 outlaws.
 *
 * 每批至多一次 (#71 fix): the aggregation PRESENTATION is suppressed
 * cross-session by a SECOND existence marker, `.scratch/retro/.aggregated`,
 * which the agent writes AFTER it presents. `retro:` alone cannot do this — it
 * is written before the batch-end push, so it selects the aggregation face for
 * every later session in the batch too (measured: 3 sessions → 3 aggregations).
 * The two markers answer different questions: `retro:` = "the batch-end retro
 * has run"; `.aggregated` = "the aggregation has already been PRESENTED". Once
 * `.aggregated` exists, later pushes fall back to the LANDING face — the
 * constraint is on the presentation, never on the material (不静默丢素材).
 *
 * FAIL-LOUD probing (#71 fix): the `.scratch/batch-state.md` probe keeps three
 * DISTINCT states — ok / absent / error. A read FAILURE (EISDIR, EACCES, IO
 * error) is reported in its own injected section and then treated as the landing
 * face, never flattened into "no marker": routing the batch-end face off an
 * unreadable file is exactly the silent degradation the ticket forbids. The
 * plugin still never throws out of the assemble hook — the existing try/catch
 * keeps "a filter bug must never brick every request".
 *
 * Indirect / PTY pushes (`node deploy.mjs` doing the push, `pty_send` fragment
 * writes, another workspace tool face) are NOT covered — declared rather than
 * guessed, the #79 口径. They are left to the FACT PROBE at wrap-up
 * (`git log origin/<branch>..HEAD` / `git status -sb`): 已推但无落盘 → 补跑或
 * 记 marker，不静默丢素材. This plugin never runs that probe itself — it is
 * reminder-only and writes no file.
 *
 * HOME-DELETE REMINDER (#113): a THIRD declared face on the same structured core
 * (`HOME_DELETE_TRIGGER`), for the 2026-10-18 third recurrence of the home-
 * deletion incident. That command reached the ⚠ gate's blind spot: the gate list
 * matches WORD RUNS at the command position (`rm -rf`), and a PowerShell cmdlet
 * form — `Remove-Item -Recurse -Force $env:DSH_HOME` — names no gate word at
 * all, so it was invisible. The new face is a COMBINATION, not a longer word
 * list: a delete verb (`Remove-Item` / `ri` / `rm` / `rmdir` / `del` / `erase` /
 * `rd`) at a command position AND a home-shaped target somewhere in that
 * command's argv. Judged by the same `actionSurface` + `matchesSurface` core, so
 * `write` / `edit` / `pty_send` / `str_replace_editor` bodies can never arm it
 * (`echo "Remove-Item -Recurse $env:DSH_HOME"` is text — the target rides
 * `echo`'s argv, whose command position names no delete verb), and `rm -rf
 * ./dist` / `Remove-Item ./build` carry no home target. Reminder-only, like
 * every other face here — nothing is intercepted (the honest boundary of #113:
 * a repository-side guard cannot physically stop a shell command the agent is
 * about to write).
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workflow-enforcer'

/** The prompt registry this plugin contributes to. */
export const inject = ['systemPrompt', 'tools']

/** Default gate list. Match = structured, over the call's declared ACTION
 * field only (see `gateMatches`): case-insensitive gate words at the command
 * position of a shell argv / the tool+action pair — never a substring over the
 * call's free text. */
export const DEFAULT_GATES = {
  external: [
    'git push', 'gh pr create', 'gh issue create',
    'gh release create', 'gh repo create', 'npm publish', 'cargo publish',
    'sandcastle', 'run-ticket',
    // plugin_manager MUTATIONS are profile-wide external actions (they load a
    // plugin for the whole profile and can run package build scripts). Word
    // pairs, so the read-only list_plugins / list_bundles calls never match.
    // #55's cordis profile declares install/enable as gate-6 events — this is
    // the one place the gate list lives (D23: high-risk details ride in the
    // plugin, the workflow text keeps the anchor).
    'plugin_manager install_bundle', 'plugin_manager set_plugin', 'plugin_manager set_bundle',
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

/** Sessions that just closed a ticket (`gh issue close`, or the declared
 * `gh api … state=closed` face). Armed by the tool/call event hook on the
 * call's structured action surface (#82), consumed by the next assemble, which
 * then nudges ONE fresh-subagent quality spot check: self-assessment runs
 * in the same context it would be judging, so it cannot see its own
 * degradation (O5). */
const ticketClosed = new WeakMap()

/** Sessions that just CREATED a ticket (`gh issue create`). Armed by the
 * tool/call event hook on the same structured surface (#82), consumed by the
 * next assemble, which then reminds the agent that a new ticket is its own
 * session's work (D20) — never chain it into the current session (observed:
 * #498 session built+fixed+closed #517 inline while its own ticket #498 was
 * still open). */
const ticketCreated = new WeakMap()

/** Sessions whose latest assistant text reports a batch ticket close-out
 * ("本地闭环完成/本会话收尾"). Armed by the text/assistant event hook,
 * consumed by the next assemble: when `.scratch/batch-state.md` exists in
 * the agent's cwd and names a successor, remind the agent to AUTO-HANDOFF
 * instead of stopping to wait for "开下一票" (observed: #500 session closed
 * its ticket, knew #501 was next, and still waited 9 min for the human to
 * say so). */
const batchClose = new WeakMap()

/** Sessions in grill/triage interview mode. Armed by a skill-tool call in
 * the grill family (grilling / grill-with-docs / grill-me / triage) or by
 * user/inbox text containing a /grill or /triage prompt prefix. Sticky for
 * the session — interviews span many turns and the question shape decays
 * like any soft prose, so the contract is re-injected on every assembly
 * (one issue per session keeps a session inside one phase anyway). */
const grillMode = new WeakMap()

/** Sessions whose latest call was a REAL push (#71) — armed by the tool/call
 * hook on the push trigger's structured surface, consumed by the next
 * assemble, which then injects the retro reminder inside the SAME
 * `workflow:gates` section as the ⚠ line: one assemble, one shot, no extra
 * section and no repeat. ONE armed state covers both faces — whether this push
 * is a per-ticket 落盘 or the batch-end 聚合 depends on `.scratch/batch-state.md`
 * at CONSUME time (see `reminderText`), because the arming hook is
 * fire-and-forget and cannot await a file read. */
const retroPush = new WeakMap()

/** Sessions where the human has declared a batch (#71) — armed by the TEXT
 * event hook (a declaration has no tool call; see `RETRO_TRIGGER`),
 * consumed by the next assemble, which then injects the batch-state
 * initialization reminder pointing at `docs/batch-state.md`. Per-session
 * one-shot: the declaration is an opening move, not a checkpoint to re-nag
 * on every assembly (the same one-shot shape as `batchClose`). */
const batchDeclared = new WeakMap()

/** Sessions whose latest call matched the home-delete face (#113) — armed by the
 * tool/call hook on that face's structured surface, consumed by the next
 * assemble, which then injects the one-shot reminder inside the SAME
 * `workflow:gates` section (one assemble, one shot, no extra section). */
const homeDelete = new WeakMap()

/** Skill-tool names that put a session into grill/triage interview mode. */
const GRILL_SKILL_NAMES = ['grilling', 'grill-with-docs', 'grill-me', 'triage']

/** Prompt prefixes that start a grill/triage session (directed handoffs). */
const GRILL_PROMPT_PREFIXES = ['/grill', '/triage']

/** Ticket-lifecycle nudge detections (#82): the arming decision for the 关票
 * (fresh-subagent spot check, O5) and 建票 (ONE ISSUE PER SESSION, D20) nudges.
 *
 * These are NOT ⚠ gates — a project's `dropExternal` must not silently switch
 * off the D20 reminder — but they are judged by the SAME structured core as the
 * gates: the call's declared action surface (#79 `actionSurface`), with word
 * runs matched at a command position (`matchesSurface`). Free text can never
 * arm a nudge: a `write` / `edit` / `str_replace_editor` body, an `echo`, a
 * commit message, `--grep`, an inline `--body` or an API-shaped note in a file
 * are all inert (#82 — the replaced `JSON.stringify(data)` scan armed on every
 * one of them).
 *
 * Every face is DECLARED:
 *   - `words` — word runs at a command position. Covers `sudo gh issue close
 *     429`, `cd repo && gh issue close 429` and `bash -c "gh issue create …"`
 *     (the same wrappers / separators / executed payloads as the gate list).
 *   - `api` — the 关票 API form. It still rides a shell tool's
 *     `arguments.command` (the `gh api …` command line); what is DECLARED here
 *     is its judgement face: command position `gh api` + a declared method flag
 *     (`-X` / `--method`, value PATCH) + a declared payload flag (`-f` /
 *     `--raw-field`, `-F` / `--field`, value `state=closed`) + an `issues/<n>`
 *     path token. Everything else about `gh api` is explicitly NOT covered — a
 *     stdin body (`--input -`), another method, another payload field, an
 *     endpoint that sits directly after an undeclared flag (it may be that
 *     flag's value, e.g. `--hostname`) — and is left to #71's fact probe, never
 *     to a fuzzy fallback.
 *
 * The flag lists live HERE (not in separate constants) so the documented 🗺 in
 * `docs/workflow-enforcer.md` can be asserted against them (V23c). */
export const TICKET_LIFECYCLE = {
  close: {
    words: ['gh issue close'],
    api: {
      command: 'gh',
      subcommand: 'api',
      methodFlags: ['-X', '--method'],
      method: 'PATCH',
      // `-f`/`--raw-field` (string) and `-F`/`--field` (typed) alike set one
      // body field; this judgement reads the field KEY=VALUE either way.
      fieldFlags: ['-f', '--raw-field', '-F', '--field'],
      field: 'state=closed',
      path: /issues\/\d+/,
    },
  },
  create: {
    words: ['gh issue create'],
  },
}

/** Armed-state flag per lifecycle kind; written by the arming judgement and
 * consumed by the next assembly. Keys mirror `TICKET_LIFECYCLE` (a kind without
 * a sink is warned about at runtime and reddens V23 — never silently dropped). */
const TICKET_ARMED = { close: ticketClosed, create: ticketCreated }

/** Retro-trigger detections (#71): the arming decision for the push-triggered
 * retro reminders (落盘 / 批末聚合) and the batch-declaration reminder.
 *
 * TWO FACES, ON PURPOSE — see the header note. The split is a property of the
 * events, not a stylistic choice:
 *   - `push.words` — a REAL push call. Judged on the SAME structured core as
 *     the ⚠ gates and the ticket-lifecycle nudges (#79 `actionSurface` +
 *     `matchesSurface`): word runs at the COMMAND POSITION of the call's
 *     declared action field. `write` / `edit` / `pty_send` have no action
 *     field → no surface → they can never arm it, by construction. Free text
 *     never reaches this judgement: a body, an `echo`, a commit message, a
 *     `--grep` pattern or an inline `--body` that merely says `git push` is
 *     inert (and so is the Chinese word 推送 — it is not an argv at all).
 *   - `batchDeclare.words` — a batch declaration by the HUMAN ("这批攒批 /
 *     系列处理 / 大系列"). A declaration has NO TOOL CALL: the only layer it
 *     can possibly arrive on is the text event layer, exactly like
 *     `BATCH_CLOSE_KEYWORDS`. This is the inverse of `push` — not an
 *     inconsistency: push is a tool event judged as an action, a declaration is
 *     a speech act judged as text. Judging a push from text would be #71's
 *     outlawed false positive; judging a declaration from a tool call would be
 *     inventing an action nobody took.
 *   - `retroMarker` — the batch-end completion marker, matched as EXISTENCE
 *     only: `.scratch/batch-state.md` mentioning `retro:` (however its Progress
 *     row spells the rest) means the batch-end wrap already ran, so the next
 *     real push in the same batch suppresses 聚合呈现 (每批至多一次, 跨会话 —
 *     the marker lives in the FILE, not in a session's WeakMap). The table is
 *     never parsed and no other field is validated: reading a shape here would
 *     couple the trigger to a format it does not own (that shape's single
 *     source of truth is `docs/batch-state.md`). */
export const RETRO_TRIGGER = {
  push: { words: ['git push'] },
  batchDeclare: {
    words: ['攒批', '批量模式', '系列处理', '大系列', '这批攒批'],
  },
  retroMarker: 'retro:',
  // The AGGREGATION-COMPLETED probe (#71 fix): a SECOND, independent existence
  // marker — `.scratch/retro/.aggregated` — that the agent writes per the body
  // rule AFTER it has presented the batch-end aggregation. The `retro:` marker
  // alone cannot suppress the aggregation ACROSS SESSIONS: it is written BEFORE
  // the batch-end push, so every later session in the same batch would re-take
  // the aggregation branch (measured: 3 sessions → 3 aggregations). `retro:`
  // answers "has the batch-end retro run"; `.aggregated` answers "has the
  // aggregation already been PRESENTED" — two different facts, so two markers.
  //
  // EXISTENCE ONLY, same shape as `retroMarker` (the file's content is never
  // read). Deliberately a DOT-FILE inside the retro dir rather than a row in
  // batch-state.md: the aggregation's completion is retro-MATERIAL state (it
  // lives with the candidate files, same lifecycle), not batch-status state —
  // and, critically, a `.md` name would be swept up by the aggregation's own
  // `read EVERY .scratch/retro/*.md` and be mistaken for a candidate file.
  aggregatedMarker: '.scratch/retro/.aggregated',
}

/** Home-delete detections (#113): the arming decision for the one-shot reminder
 * that fires when a command would recursively delete a home directory.
 *
 * WHY A NEW FACE, NOT A LONGER GATE WORD: the ⚠ gate list is word runs at a
 * command position, and the command that deleted the real `~/.dsh` on
 * 2026-10-18 (for the third time) was `Remove-Item -Recurse -Force
 * $env:DSH_HOME` — a PowerShell cmdlet that names NO gate word at all, so it
 * was structurally invisible to the gate. Appending `Remove-Item -Recurse` to
 * the gate list would fix that one spelling and stay blind to `ri` / `rd` / the
 * `del /s` form and to every future alias; worse, as a word run it would fire on
 * `Remove-Item ./build` (a routine cleanup of one's own output).
 *
 * So the face is a COMBINATION, declared in TWO lists and judged structurally:
 *   - `verbs` — the delete spellings, matched at a COMMAND POSITION (verbatim,
 *     or as a path/executable-suffix-normalized token: `Remove-Item.exe`,
 *     `/usr/bin/rm`).
 *   - `targets` — the home-shaped targets, matched anywhere in that command's
 *     argv as a path/name-equivalence test (`~/…`, an env-var expansion,
 *     `.dsh`, `%USERPROFILE%\…`, `$HOME`).
 * BOTH must hold in the SAME command segment, which is what keeps the negatives
 * clean: `echo "Remove-Item -Recurse $env:DSH_HOME"` puts the target on
 * `echo`'s argv while the delete verb is quoted payload — no segment satisfies
 * both; `rm -rf ./dist` has the verb but no home target; `Remove-Item ./build`
 * likewise. And `write` / `edit` / `pty_send` declare no action field at all
 * (#79), so a document that merely mentions such a command can never arm this.
 *
 * The declared limits are the SAME as every other face's (option-laden command
 * positions, PTY fragments, script-mediated deletes are uncovered by design) —
 * 宁严勿宽: a false trigger costs a stop and dilutes a reminder the model must
 * obey, so this never grows a substring fallback. */
export const HOME_DELETE_TRIGGER = {
  verbs: ['Remove-Item', 'ri', 'rm', 'rmdir', 'del', 'erase', 'rd'],
  targets: ['$env:DSH_HOME', '$HOME', '~/.dsh', '%USERPROFILE%\\.dsh'],
}

/** The field NAMES of `.scratch/batch-state.md` that this plugin's reminders
 * DEPEND on — the SUPERSET-free list, deliberately not a template.
 *
 * The SHAPE of that file lives in exactly ONE place: `docs/batch-state.md`. This
 * constant used to be a hand-copied skeleton, and it drifted (missing the
 * declaration/mode lines, the 结束点 criteria, the second member row and the
 * progress log) while its own comment claimed the two "cannot drift apart
 * unnoticed" — a second copy of a single source of truth is a second source of
 * truth. It is therefore reduced to what the reminders actually READ/POINT AT,
 * so there is no structure left to drift (D49: 口径与指针，不复述字段表).
 *
 * Every listed name is load-bearing for a REMINDER, never for parsing (nothing
 * here is parsed — the probe reads existence, the marker reads a substring):
 *   - 成员 / 结束点 — the declared batch boundary the declaration reminder asks
 *     for (D31 guardrail a/c);
 *   - 证明命令 / exit code / 证据路径 — the Progress row's three evidence
 *     elements; a row missing any is BLOCKED, not done (same rule as the
 *     batch-close nudge);
 *   - lane — which lane the ticket ran in (D38);
 *   - 后继票 — the successor the AUTO-HANDOFF nudge reads;
 *   - 关票确认方式 / 预授权清单 / 收口记录 — the three #128 faces the declaration
 *     reminder asks for: WHICH confirmation mode the batch runs on (a/b/c, and
 *     the loud line when the declaration names none), WHAT the declaration
 *     authorizes (write scope / create-only tickets / closing / one push), and
 *     the close-out read taken BEFORE declaring (classification + same-family
 *     merges + done-but-unclosed dropped);
 *   - `retro:` — the batch-end retro completion marker (#71).
 * Written by the AGENT (workflow-body rule), never by this plugin: the enforcer
 * is reminder-only and writes no file. */
export const BATCH_STATE_TEMPLATE = [
  '成员', '结束点',
  '证明命令', 'exit code', '证据路径',
  'lane', '后继票', 'retro:',
  // #128: 批宣告还定死两件事 + 宣告前先收口。缺任一项就没有「授权范围」可判：
  // 关票方式未声明时正文默认最保守（响亮），越界写与批外关票都会被当成"批内例行"。
  '关票确认方式', '预授权清单', '收口记录',
]

/** Keywords that mark a fold-in claim (lowercased match). */
/** Keywords that arm context evidence: fold-in claims (agent) or
 * context-capacity assessments (user asking how much window is left). */
export const FOLD_KEYWORDS = [
  '并入', '关联票', '一并', '顺带', '同时处理', '合并', '连带', 'merge', 'fold in',
  '评估', '容量', '还能装', '够不够', '可并入', '能不能继续', '上下文', '窗口',
  'assess', 'context capacity', 'window left', 'how much context',
]

/** Keywords that mark a batch-ticket close-out (agent text) — the moment a
 * session reports a batch ticket done ("本地闭环完成/本会话收尾") and might
 * stop to wait for the human to say "开下一票". Arms the next assembly to
 * check batch-state.md and, when a successor exists, remind the agent to
 * AUTO-HANDOFF (the batch declaration is the assignment). */
export const BATCH_CLOSE_KEYWORDS = [
  '本地闭环完成', '本地闭环', '本会话收尾', '会话收尾', '票完成', '本票交付',
  'batch 收尾', '批 A 收尾', '收尾报告',
]

/** The agent's working directory: header carries it (session.meta is not
 * populated in real runs — the create path puts cwd on the header). */
export function agentCwd(agent) {
  return agent?.session?.header?.cwd ?? agent?.session?.meta?.cwd
}

/** Whether the agent's cwd has a `.scratch/batch-state.md` (batch in
 * progress). Best-effort: any read failure degrades to false. */
async function hasBatchState(cwd) {
  if (!cwd) return false
  try {
    await readFile(join(cwd, '.scratch', 'batch-state.md'), 'utf8')
    return true
  } catch {
    return false
  }
}

/** The `.scratch/batch-state.md` probe result, as ONE of three DISTINCT states
 * — never a `string | null` that flattens a read failure into "no file":
 *
 *   - `{ kind: 'ok', content }` — read succeeded.
 *   - `{ kind: 'absent' }` — ENOENT: the file genuinely is not there (or there
 *     is no cwd at all). The normal "not in a batch" path.
 *   - `{ kind: 'error', code, message }` — the file is there but could NOT be
 *     read (EISDIR, EACCES, EPERM, IO error…). This MUST stay distinguishable:
 *     silently routing it to "no marker" would decide the batch-end face on a
 *     failed probe, which the ticket's fail-loud AC forbids.
 *
 * This function never throws — the caller decides how loud to be. */
async function probeBatchState(cwd) {
  if (!cwd) return { kind: 'absent' }
  try {
    return { kind: 'ok', content: await readFile(join(cwd, '.scratch', 'batch-state.md'), 'utf8') }
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'absent' }
    return { kind: 'error', code: String(error?.code ?? 'UNKNOWN'), message: String(error?.message ?? error) }
  }
}

/** Whether the `.scratch/retro/.aggregated` existence marker is present (#71's
 * 每批至多一次 suppressor for the AGGREGATION face). EXISTENCE ONLY — the
 * content is never read. `false` on any failure: a suppressor that cannot be
 * read must never SUPPRESS, because suppressing on a failed probe would drop the
 * aggregation silently; the loud reporting of a failed `batch-state.md` probe
 * covers the diagnostics (this probe's own failure only ever widens behaviour
 * back to the aggregation face, which the marker would have suppressed only if
 * it demonstrably existed). */
async function hasAggregatedMarker(cwd) {
  if (!cwd) return false
  try {
    await readFile(join(cwd, RETRO_TRIGGER.aggregatedMarker), 'utf8')
    return true
  } catch {
    return false
  }
}

/** Whether a tool call is a REAL push, judged on the declared action surface —
 * the same structured core as the ⚠ gate and the ticket-lifecycle nudges. The
 * face is declared in `RETRO_TRIGGER.push.words`; a tool with no action field
 * (write / edit / pty_send / …) has no surface and can never arm it. This is
 * deliberately the SAME judgement the ⚠ line's push follow-ups use — one
 * declaration, so the retro trigger and the gate cannot disagree. */
function pushTriggerHit(call) {
  const surface = actionSurface(call)
  if (surface === null) return false
  return RETRO_TRIGGER.push.words.some(word => matchesSurface(word, surface))
}

/** Parse a tool call's arguments (JSON string or object). */
function callArgs(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return {} }
  }
  return value ?? {}
}

/** Shell tools whose `arguments.command` is a shell command line. One source for
 * the declared shell set (the aliases share the shape; a preset may mount a
 * differently-named shell tool). */
const SHELL_TOOLS = ['bash', 'pwsh', 'sh', 'zsh', 'dash', 'powershell', 'cmd']

/** Which argument carries a tool's ACTION (never its free text). Declared per
 * tool, so a call that merely CARRIES a body mentioning a gate can never arm
 * it:
 *
 *   - shell tools → `arguments.command`, a shell command line. Gates match at
 *     the COMMAND POSITION of its argv (`argv[0] === 'git' && argv[1] ===
 *     'push'`), plus the executed payload of a declared `-c`/`-e`-style flag.
 *   - `plugin_manager` → `arguments.action`, the mutation verb; gate
 *     `plugin_manager install_bundle` reads as the tool+action pair.
 *
 * A tool NOT declared here (write / edit / str_replace_editor / pty_send /
 * pty_open / run_code / …) has NO action surface: nothing about it can match,
 * by construction. That is the deliberate "not covered" declaration of #79 — a
 * silent substring fallback is exactly the bug it replaces. */
export const ACTION_FIELDS = {
  ...Object.fromEntries(SHELL_TOOLS.map(tool => [tool, 'command'])),
  plugin_manager: 'action',
}

/** Leading wrappers, shell keywords and env assignments skipped before the
 * command position: `sudo git push`, `FOO=1 git push`, `env FOO=1 git push` and
 * `if git push; then …` all land on `git`. */
const TRANSPARENT_PREFIXES = new Set([
  'sudo', 'doas', 'command', 'nohup', 'env', 'time',
  'if', 'then', 'else', 'elif', 'while', 'until', 'do', 'done', 'fi', '!',
])

/** Commands that INVOKE another program: their non-flag arguments are
 * invocation targets, so a single-word script/path gate (`run-ticket`,
 * `sandcastle`) matches there — `npx tsx .sandcastle/run-ticket.mts` fires
 * while `echo ".sandcastle/run-ticket.mts"` (text) does not. */
const RUNNERS = new Set([
  'npx', 'bunx', 'pnpm', 'yarn', 'npm', 'tsx', 'ts-node', 'node', 'deno', 'bun',
  'python', 'python3', 'py', 'sh', 'bash', 'zsh', 'dash', 'pwsh', 'powershell',
  'cmd', 'dsh',
])

/** Flags whose VALUE is executed (code / SQL statement), per command: the
 * payload's primary position is matched recursively, so `bash -c "git push"`
 * and `psql -c "delete from users"` stay covered. Deliberately absent:
 * `echo -e` (escapes), `psql -e` (echo queries), `git commit -m` / `gh --body`
 * / `git log --grep` — their values are TEXT, and matching them is the false
 * positive #79 removes. Positional SQL (`sqlite3 db "delete from …"`) is not
 * covered — declared, with #71's fact probe as the fallback. */
const EXEC_FLAGS = {
  bash: ['-c'], sh: ['-c'], zsh: ['-c'], dash: ['-c'],
  pwsh: ['-c', '-command', '--command'], powershell: ['-c', '-command', '--command'],
  cmd: ['/c', '/k'],
  psql: ['-c', '--command'],
  mysql: ['-e', '--execute'], mariadb: ['-e', '--execute'],
}

/** Declared CAP on executed-payload recursion: 2 levels covers `bash -c "git
 * push"` (1) and `bash -c 'bash -c "git push"'` (2). Deeper indirection is
 * declared uncovered rather than guessed at. */
const MAX_PAYLOAD_DEPTH = 2

/** Shell control operators that START A NEW COMMAND: each side is judged at its
 * own command position, so `cd repo && git push` fires (a direct push — red if
 * only the line's first command were judged), while `echo a; git log
 * --grep="git push"` still does not. Quoted operators never reach here:
 * `shellWords` keeps a quoted payload as one token. */
const COMMAND_SEPARATORS = new Set(['&&', '||', ';', ';;', '|', '|&', '&'])

/** The single characters `shellWords` treats as operators while UNQUOTED (see
 * `COMMAND_SEPARATORS` for the token forms it emits). */
const COMMAND_OPERATOR_CHARS = new Set([';', '&', '|'])

/** Split a shell command line into words, honouring quotes so a quoted payload
 * stays ONE token (`--grep="git push"` is not two words). Quotes are dropped.
 * Unquoted control operators end the current word and become their own token
 * (`git status; git push` → `;` splits the line); unquoted redirects/`$`/
 * backticks/parens end or drop out of the word (`git push>log.txt` is still the
 * push it is, `$(git push)` still reads as the push it is). A QUOTED operator
 * stays inside its token — `echo "a; rm -rf /"` is text, not a second
 * command. */
function shellWords(text) {
  const words = []
  let cur = ''
  let quote = null
  const flush = () => { if (cur !== '') { words.push(cur); cur = '' } }
  for (const ch of String(text)) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (/\s/.test(ch)) { flush(); continue }
    if (COMMAND_OPERATOR_CHARS.has(ch)) {
      flush()
      const prev = words[words.length - 1]
      if (prev !== undefined && /^[;&|]+$/.test(prev)) words[words.length - 1] = prev + ch
      else words.push(ch)
      continue
    }
    // Redirects and command-substitution punctuation: terminate the word, stay
    // out of the word list (they never carry an action of their own).
    if (ch === '>' || ch === '<' || ch === '$' || ch === '`' || ch === '(' || ch === ')') { flush(); continue }
    cur += ch
  }
  flush()
  return words
}

/** argv[0] normalized for matching: basename, Windows executable suffix and a
 * leading path dropped — `/usr/bin/git push` and `git.exe push` are the same
 * command as `git push` (the raw form still reaches the display line). */
function commandToken(word) {
  const base = String(word ?? '').split(/[\\/]/).pop() ?? ''
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

/** Drop leading wrappers and `VAR=value` assignments. */
function skipPrefixes(words) {
  let i = 0
  while (i < words.length) {
    const tok = commandToken(words[i])
    if (TRANSPARENT_PREFIXES.has(tok) || /^[a-z_][a-z0-9_]*=/.test(tok)) { i++; continue }
    break
  }
  return words.slice(i)
}

/** Command position + invocation chain of one shell segment. */
function segment(words) {
  const head = skipPrefixes(words)
  if (head.length === 0) return { primary: [], chain: [], command: '' }
  const primary = [commandToken(head[0]), ...head.slice(1)]
  const command = primary[0]
  const chain = [command]
  let last = command
  let i = 1
  while (i < primary.length && RUNNERS.has(commandToken(last))) {
    const tok = primary[i]
    i++
    if (String(tok).startsWith('-')) continue // a flag is not an invocation target
    // The RAW token (not the basename): a single-word gate may legitimately
    // match a path component (`.sandcastle/run-ticket.mts`).
    chain.push(String(tok))
    last = tok
  }
  return { primary, chain, command }
}

/** The executed payload of the declared exec flag at `i`, or null. Handles
 * `-c "…"`, `--command="…"`, and clustered short flags (`bash -lc "…"` = `-l
 * -c`, whose value still executes). */
function execPayload(primary, i, execFlags) {
  const tok = String(primary[i])
  if (!tok.startsWith('-') && !tok.startsWith('/')) return null
  const eq = tok.indexOf('=')
  const flag = (eq === -1 ? tok : tok.slice(0, eq)).toLowerCase()
  const value = (() => {
    if (execFlags.includes(flag)) return eq === -1 ? primary[i + 1] : tok.slice(eq + 1)
    if (eq !== -1 || !/^-[a-z]{2,}$/i.test(tok)) return null
    const short = execFlags.find(f => f.length === 2 && f.startsWith('-') && tok.toLowerCase().includes(f[1].toLowerCase()))
    return short === undefined ? null : primary[i + 1]
  })()
  return typeof value === 'string' && value !== '' ? value : null
}

/** Every segment a gate may judge: each command of the line in turn, then the
 * executed payload of its declared exec flags, recursively (bounded depth). */
function addSegments(words, depth, out) {
  for (const part of splitCommands(words)) {
    const seg = segment(part)
    if (seg.primary.length === 0) continue
    out.push(seg)
    const execFlags = EXEC_FLAGS[String(seg.command).toLowerCase()] ?? []
    if (execFlags.length === 0 || depth >= MAX_PAYLOAD_DEPTH) continue
    // A SHELL reads its own options before the first operand, so `bash deploy.sh
    // -c "…"` is a script argument, not an executed payload (SQL clients keep
    // full scanning: `psql -h host -c "delete from …"` is real).
    const optionsFirst = SHELL_TOOLS.includes(String(seg.command).toLowerCase())
    for (let i = 1; i < seg.primary.length; i++) {
      const tok = String(seg.primary[i])
      if (optionsFirst && !tok.startsWith('-') && !tok.startsWith('/')) break
      const payload = execPayload(seg.primary, i, execFlags)
      if (payload !== null) addSegments(shellWords(payload), depth + 1, out)
    }
  }
  return out
}

/** Split a word list on shell control operators (`&&`, `;`, `|`, …). */
function splitCommands(words) {
  const out = []
  let cur = []
  for (const w of words) {
    if (COMMAND_SEPARATORS.has(String(w))) {
      if (cur.length > 0) out.push(cur)
      cur = []
      continue
    }
    cur.push(w)
  }
  if (cur.length > 0) out.push(cur)
  return out
}

/** Structured action surface of a call: `{ display, segments }`, or null when
 * the tool declares no action field (explicitly not covered). `display` is what
 * the ⚠ line shows — the real action, never the bare tool name. */
function actionSurface(call) {
  const name = String(call?.name ?? '').toLowerCase()
  const field = ACTION_FIELDS[name]
  if (field === undefined) return null
  const args = call?.arguments ?? {}
  const raw = args[field]
  if (field === 'action') {
    if (typeof raw !== 'string' || raw === '') return null
    const pair = [name, raw.toLowerCase()]
    return { display: `${name} ${raw}`, segments: [{ primary: pair, chain: pair, command: name }] }
  }
  if (typeof raw !== 'string' || raw === '') return null
  const segments = addSegments(shellWords(raw), 0, [])
  return segments.length === 0 ? null : { display: raw, segments }
}

/** A gate word matches an argv word: exact (case-insensitive), or — for flag
 * words — a prefix, so the declared `git clean -f` also reaches `git clean -fd`
 * (the same reach the old substring matcher had). */
function wordMatches(gateWord, argvWord) {
  const g = gateWord.toLowerCase()
  const a = String(argvWord ?? '').toLowerCase()
  if (a === g) return true
  return g.startsWith('-') && a.startsWith(g)
}

/** A script/path gate matches an invocation TARGET by NAME — the basename with
 * its extension stripped, or a path component: `sandcastle` covers
 * `.sandcastle/run-ticket.mts`, while `sandcastle-notes.mjs` and
 * `run-ticket-helpers.mjs` (which the old substring scan fired on) do not. */
function targetMatches(gateWord, token) {
  const raw = String(token ?? '').replace(/^["']|["']$/g, '')
  if (raw === '') return false
  const parts = raw.split(/[\\/]/).filter(p => p !== '' && p !== '.')
  const candidates = parts.length > 0 ? parts : [raw]
  const stem = candidates[candidates.length - 1].replace(/\.[^.]+$/, '')
  const want = gateWord.toLowerCase()
  return [...candidates, stem].some(c => c.toLowerCase().replace(/^\.+/, '') === want)
}

/** Whether a gate matches an already-built surface: its word run at a primary
 * position (command position of a command in the line, or the start of an
 * executed payload), or — for a single-word script/path gate — a name match on
 * an invocation target. */
function matchesSurface(gate, surface) {
  const words = String(gate).trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0 || surface === null) return false
  const single = words.length === 1
  return surface.segments.some(seg =>
    words.every((w, i) => wordMatches(w, seg.primary[i]))
    || (single && seg.chain.some(tok => targetMatches(words[0], tok))))
}

/** Whether one gate matches a call (structured; builds the surface itself). */
export function gateMatches(gate, call) {
  return matchesSurface(gate, actionSurface(call))
}

/** The value of the declared flag token at `i`: `--flag=value` inline, else the
 * next argv word (`skip` reports how many words the flag consumed). null when
 * the token names none of `names` (case-insensitive). */
function declaredFlagValue(argv, i, names) {
  const tok = String(argv[i])
  const eq = tok.indexOf('=')
  const flag = (eq === -1 ? tok : tok.slice(0, eq)).toLowerCase()
  if (!names.some(n => n.toLowerCase() === flag)) return null
  return eq === -1
    ? { value: String(argv[i + 1] ?? ''), skip: 1 }
    : { value: tok.slice(eq + 1), skip: 0 }
}

/** Whether one command segment IS the declared `gh api` face of a
 * ticket-lifecycle nudge — command position `gh api`, the declared method flag
 * carrying the declared method, the declared payload flag carrying the declared
 * field, and a path token matching the declared pattern. Read off argv
 * positions; never off the serialized call.
 *
 * An ENDPOINT candidate must not sit directly after an UNDECLARED flag: that
 * token may be the flag's value (`gh api --hostname H issues/429`), and reading
 * it would be reading an undeclared field. Such forms are declared uncovered
 * (see `TICKET_LIFECYCLE`), the established "declared rather than silent" 口径. */
function apiFaceMatches(seg, face) {
  if (seg.command !== face.command || commandToken(seg.primary[1]) !== face.subcommand) return false
  const argv = seg.primary
  let method = null
  let field = false
  let hasPath = false
  let afterUndeclaredFlag = false
  for (let i = 2; i < argv.length; i++) {
    const m = declaredFlagValue(argv, i, face.methodFlags ?? [])
    if (m !== null) { method = m.value; i += m.skip; afterUndeclaredFlag = false; continue }
    const f = declaredFlagValue(argv, i, face.fieldFlags ?? [])
    if (f !== null) {
      if (f.value.replace(/\s+/g, '').toLowerCase() === face.field) field = true
      i += f.skip
      afterUndeclaredFlag = false
      continue
    }
    const tok = String(argv[i])
    if (tok.startsWith('-') && tok !== '-') { afterUndeclaredFlag = true; continue }
    if (afterUndeclaredFlag || !face.path.test(tok)) { afterUndeclaredFlag = false; continue }
    hasPath = true
    afterUndeclaredFlag = false
  }
  return String(method ?? '').toLowerCase() === face.method.toLowerCase() && field && hasPath
}

/** Whether one command segment is a home-shaped TARGET: a path/name-equivalence
 * test that mirrors where a home directory can be named in argv.
 *
 * NOTE ON THE TOKEN VOCABULARY: this runs on the tokens `shellWords` produced,
 * and that tokenizer is SHARED with the ⚠ gate — it drops an UNQUOTED `$` (a
 * bare `$var` is command-substitution punctuation to it, `shellWords`'s
 * documented behaviour). So an unquoted `$env:DSH_HOME` arrives as
 * `env:DSH_HOME` and `$HOME` as `HOME`, while a QUOTED `"$HOME\.dsh"` keeps its
 * `$`. Matching the shell spelling alone would therefore have been blind to
 * EVERY unquoted form — which is exactly the incident command (measured: the
 * first draft of this face missed `Remove-Item … $env:DSH_HOME`, `rm -rf
 * $HOME`, and every alias carrying them). The predicates below therefore accept
 * both the shell spelling and its tokenizer residue.
 *
 *   - `~`-prefixed paths: any first component `~` (or `~user`) — `~/`, `~/.dsh`,
 *     `~\.dsh`;
 *   - a variable expansion naming a DECLARED home variable — `DSH_HOME` / `HOME` /
 *     `USERPROFILE` — in the `$env:NAME` / `${env:NAME}` / `$NAME` / `%NAME%`
 *     spellings or as the unquoted tokenizer residue `env:NAME` / `NAME`. The
 *     variable name is matched as a WHOLE token, deliberately: `$env:TEMP` and
 *     `%TEMP%` must NOT match (the temp directory is the SAFE target — the
 *     reminder's whole point is that the target must be a path this command
 *     created, and flagging the correct form would train the model to ignore it);
 *   - the `.dsh` home directory as a PATH COMPONENT, not a substring:
 *     `.dsh` / `.dsh/data` / `C:\Users\me\.dsh` hit, while `.dshbackup` and
 *     `dsh-temp-home-abc` do not (the `targetMatches` name discipline).
 *
 * Deliberately NOT matched: a bare `$env:TEMP` / `%TEMP%` path (that is the SAFE
 * target — the reminder's whole point is that the temp dir must be one this
 * command created, and flagging the correct form would train the model to ignore
 * it). */
function homeTargetMatches(word) {
  const raw = String(word ?? '').replace(/^["']|["']$/g, '')
  if (raw === '') return false
  // ~ / ~user prefix
  if (/^~[\\/]/.test(raw) || raw === '~') return true
  // A variable expansion naming a DECLARED home variable, in every spelling the
  // two shells here use plus the tokenizer's residue. The name is matched as a
  // WHOLE token so that `$env:TEMP` / `%TEMP%` stay unmatched (see the docblock).
  const HOME_VARS = '(?:DSH_HOME|HOME|USERPROFILE)'
  const expansion = new RegExp(
    `^(?:`
    + `\\$\\{?env:${HOME_VARS}\\}?`   // $env:DSH_HOME / ${env:DSH_HOME}
    + `|\\$${HOME_VARS}\\b`          // $DSH_HOME / $HOME
    + `|%${HOME_VARS}%`              // %USERPROFILE%
    + `|(?:env:)?${HOME_VARS}`       // env:DSH_HOME / HOME (unquoted tokenizer residue)
    + `)$`, 'i')
  if (expansion.test(raw)) return true
  // The same expansion carrying a path suffix: `env:DSH_HOME/data`,
  // `%DSH_HOME%\\x`, `$HOME\\.dsh`, `HOME/x`.
  const expansionPath = new RegExp(
    `^(?:`
    + `\\$\\{?env:${HOME_VARS}\\}?`
    + `|\\$${HOME_VARS}\\b`
    + `|%${HOME_VARS}%`
    + `|(?:env:)?${HOME_VARS}`
    + `)[\\\\/]`, 'i')
  if (expansionPath.test(raw)) return true
  // home directory named as a path component / bare token
  if (/^\.dsh$/i.test(raw)) return true
  const parts = raw.split(/[\\/]/).filter(p => p !== '' && p !== '.')
  return parts.some(p => /^\.dsh$/i.test(p))
}

/** Whether a call is a HOME-DELETE candidate (#113): a delete verb at a COMMAND
 * POSITION and a home-shaped target SOMEWHERE in that same command's argv.
 *
 * Both halves are required, and they must hold in the SAME segment — that is the
 * whole discrimination (see `HOME_DELETE_TRIGGER`). A tool without a declared
 * action field never reaches here.
 *
 * The VERB half rides the shared structured core (`matchesSurface`, the same
 * matcher the ⚠ gate, the ticket nudges and the push trigger use): a delete verb
 * is a word run at a COMMAND POSITION, which is exactly what that matcher
 * resolves — including the transparent-prefix (`sudo rm …`), command-separator
 * (`cd x && rm …`) and executed-payload (`bash -c "rm …"`) cases, for free and
 * consistently with every other face. The TARGET half cannot ride it: the
 * declaration is a list of *shapes* (a variable expansion, a `~` path, a `.dsh`
 * path component), not word runs, so it is a predicate over the segment's argv.
 * Both halves read the declaration; neither is a hand-copied second matcher. */
function homeDeleteHit(call) {
  const surface = actionSurface(call)
  if (surface === null) return false
  const verbHit = HOME_DELETE_TRIGGER.verbs.some(verb => matchesSurface(verb, surface))
  if (!verbHit) return false
  return surface.segments.some(seg => {
    // Only a segment whose command position IS a declared verb can carry the
    // action: the target must sit in the SAME command as the delete verb (an
    // `echo "… $env:DSH_HOME"` puts the target on `echo`'s argv — inert).
    const isDeleteVerb = HOME_DELETE_TRIGGER.verbs.some(v => commandToken(v) === seg.command)
    if (!isDeleteVerb) return false
    return seg.primary.some(tok => homeTargetMatches(tok))
  })
}

/** Which ticket-lifecycle nudges a tool call arms, judged on its declared
 * action surface (the #79 core). A tool WITHOUT an action field (write / edit /
 * str_replace_editor / pty_send / run_code / …) has no surface → arms nothing,
 * by construction — that is the deliberate "not covered" declaration, not a
 * silent fallback. */
function ticketLifecycleHits(call) {
  const surface = actionSurface(call)
  if (surface === null) return []
  const hits = []
  for (const [kind, face] of Object.entries(TICKET_LIFECYCLE)) {
    const wordHit = (face.words ?? []).some(word => matchesSurface(word, surface))
    const apiHit = face.api !== undefined && surface.segments.some(seg => apiFaceMatches(seg, face.api))
    if (wordHit || apiHit) hits.push(kind)
  }
  return hits
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
  const project = await projectGates(agentCwd(agent), config.gatesFile)
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
    'ROUTINE actions need NO confirmation: docker compose up, cargo build/test,',
    'local git commit, psql read-only queries, file edits — the gate list above',
    'is exhaustive; do not invent extra confirmation checkpoints beyond it.',
    'A human correction must be acknowledged and written down (propose the doc).',
    'One issue per session.',
    'BATCH MODE: when the human has declared a batch (攒批), the batch-end push',
    'follows the batch-end summary — list every issue, get the human\'s',
    'confirmation, then push and verify CI; mid-batch out-of-scope pushes WAIT.',
  ].join('\n')
}

/** Grill/triage question-presentation contract. Wording validated by the
 * 2026-09-12 micro-test (control 5/5 batched; recipe 5/5 converged, ≈0
 * variance). Chinese anchors are the validated output formats. */
function grillContractText() {
  return [
    'GRILL QUESTION CONTRACT — every message that asks the human to decide:',
    'ONE decision per message. First line = status line (已拍 Q1-Q2，现问 Q3(#643)).',
    'Four-piece block: one-line question numbered Q<n>(<ticket>) → 2-4 options,',
    'one line each (effect + cost) → ➡️ 推荐 X：<one-line reason> → last line',
    '可答：A / 按推荐 / 例外说明.',
    'Time estimate under the question: 按推荐 ≈10 秒；要看 #… 背景约 N 分钟.',
    'The last line is always this question\'s answer request — never a summary.',
    'Batch mode only on explicit human opt-in (批量模式): ≤5 questions, same',
    'four-piece block each, still one closing ask.',
    'Asked for background (前因后果)? Four-piece block first, background after.',
  ].join('\n')
}

/** renderPrompt treats `{{…}}` as prompt-variable references; tool-call text
 * may legitimately contain template syntax (issue bodies, shell snippets).
 * Neutralize braces at the single choke point so an injected command can
 * never break prompt rendering (malformed variable reference). */
function sanitizePrompt(text) {
  return String(text).replace(/\{\{/g, '[[').replace(/\}\}/g, ']]')
}

/** Every section `reminderText` can emit, as documentation metadata: the MARKER
 * phrase `docs/workflow-enforcer.md`「What it injects」must name, and the config
 * knob that switches it off (`null` = always on when it matches). One
 * declaration, so the user-facing list and the code cannot drift silently — the
 * #54-era list had lost the ticket nudges, the fold-in evidence and the grill
 * contract, and the per-row config block was missing seven knobs; V24 pins it. */
export const INJECTIONS = [
  { id: 'baseline', marker: 'WORKFLOW GATES', config: 'baseline' },
  { id: 'high-risk', marker: 'High-risk action', config: null },
  { id: 'ticket-closed', marker: 'fresh-subagent quality', config: 'ticketClosedCheck' },
  { id: 'ticket-created', marker: 'ONE ISSUE PER SESSION', config: 'ticketCreatedCheck' },
  { id: 'batch-close', marker: 'AUTO-HANDOFF', config: 'batchCloseCheck' },
  { id: 'context-evidence', marker: 'context:', config: 'contextEvidence' },
  { id: 'grill-contract', marker: 'GRILL QUESTION CONTRACT', config: 'grillContract' },
  // #71 — the push-triggered retro reminders. Two distinct sections on the same
  // config knob: exactly one of them fires per push (marker in the file →
  // aggregation, otherwise → 落盘), never both.
  { id: 'retro-push', marker: 'Retro candidate — file it now', config: 'retroTriggerCheck' },
  { id: 'retro-batch-end', marker: 'Batch-end retro aggregation', config: 'retroTriggerCheck' },
  // #71 fix — the fail-loud report for a batch-state probe that could NOT read
  // the file. Distinct marker (no `⚠` prefix: that prefix belongs to the
  // high-risk ACTION gate, and reusing it here would read as a false alarm),
  // same knob as the retro faces it guards.
  { id: 'batch-state-probe-failed', marker: 'Batch-state probe FAILED', config: 'retroTriggerCheck' },
  { id: 'batch-declared', marker: 'Batch declared', config: 'batchDeclareCheck' },
  // #113 — the home-delete reminder. Reminder-only, on its own knob: a project
  // that wants this face silent can switch it off without touching the ⚠ gate.
  { id: 'home-delete', marker: 'Home-delete candidate', config: 'homeDeleteCheck' },
]

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
  if (grillMode.get(agent.session) === true && config.grillContract !== false) {
    parts.push(grillContractText())
  }
  const call = lastCall.get(agent.session)
  if (call !== undefined) {
    lastCall.delete(agent.session) // consume: fires once per matched call
    // Structured judgement (#79): build the call's declared action surface ONCE
    // (display + gate matching + the push sub-judgement read the same object),
    // then match gate words at a command position — a body that mentions a gate
    // never matches. No surface (write/edit/pty_send/…) → nothing to judge.
    const surface = actionSurface(call)
    if (surface !== null) {
      const gates = await resolveGates(agent, config)
      const hit = [...gates.external, ...gates.destructive].find(gate => matchesSurface(gate, surface))
      if (hit !== undefined) {
        parts.push(`⚠ High-risk action detected: ${String(surface.display).slice(0, 120)} — report the outcome and WAIT for confirmation.`)
        // The push-specific follow-ups read the SAME surface (a document that
        // mentions `git push` must not drag them in).
        if (matchesSurface('git push', surface)) {
          parts.push('After the push, check the remote CI run for the pushed commit — done means local checks pass, pushed, AND CI green.')
          parts.push('If this is a batch-end push (BATCH MODE declared), it follows the batch-end summary — list every issue, get the human\'s confirmation, then push and verify CI.')
        }
      }
    }
  }
  if (homeDelete.get(agent.session) === true && config.homeDeleteCheck !== false) {
    homeDelete.delete(agent.session) // consume: one reminder per matched call
    parts.push([
      '⚠ Home-delete candidate — this command deletes a home-shaped target.',
      'A recursive delete may only ever target a path THIS command created itself',
      '(`mktemp` / `mkdtemp` output); never a path re-derived from an environment',
      'variable. `$HOME` and `$PID` are READ-ONLY automatic variables in',
      'PowerShell — assigning to `$home` is a NON-TERMINATING error, so the script',
      'keeps running with the REAL home and every derived path silently falls back',
      'to it (that is how `~/.dsh` was deleted on 2026-10-18, the third time this',
      'happened). Name temporary-directory variables something else (`$tmpHome`).',
      'To run something against an isolated home, use',
      '`node scripts/with-temp-home.mjs -- <cmd…>` instead of hand-writing the',
      'sandbox — it creates the home under `os.tmpdir()`, refuses unsafe targets',
      'before creating and again before deleting, and removes exactly the path it',
      'created. If you still write it by hand: echo the resolved absolute path',
      'first, and delete only that echoed path.',
    ].join(' '))
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
  if (ticketCreated.get(agent.session) === true && config.ticketCreatedCheck !== false) {
    ticketCreated.delete(agent.session) // consume: one nudge per create
    parts.push([
      '⚠ New ticket created in this session — ONE ISSUE PER SESSION (D20):',
      'the new ticket is its own session\'s work. Do NOT fix, close, or fold',
      'it into the current ticket here; leave it to a fresh session (TICKET',
      'EXIT — create the ticket, then continue the current ticket only).',
      'Read the labels back now (`gh issue view <n> --json labels --jq',
      '\'[.labels[].name]\'`): exactly one category (bug / enhancement) +',
      'exactly one state (needs-triage / needs-info / ready-for-agent /',
      'ready-for-human / wontfix). A ticket with no state is invisible on',
      'every state-filtered surface — see docs/agents/triage-labels.md.',
    ].join(' '))
  }
  if (batchClose.get(agent.session) === true && config.batchCloseCheck !== false) {
    batchClose.delete(agent.session) // consume: one nudge per close-out
    if (await hasBatchState(agentCwd(agent))) {
      parts.push([
        'Batch ticket closed out — if this batch has a successor in',
        '.scratch/batch-state.md, AUTO-HANDOFF to it now (fresh + directed',
        'section; the batch declaration is the assignment), do not stop and',
        'wait for the human to say "开下一票". Exceptions: the next ticket',
        'needs a human decision gate, the human asked to pause, or this was',
        'the batch end point → go to the batch-end wrap (summary → confirm →',
        'push). A "本会话收尾" is not a stop-and-wait when a successor is',
        'named. Close-out evidence is part of local closure: the ticket\'s',
        'batch-state Progress row records the three evidence elements —',
        'proving command, exit code, evidence path (the test output itself',
        'counts; no separate artifact needed). A row missing any element is',
        'BLOCKED, not done.',
      ].join(' '))
    }
  }
  if (config.retroTriggerCheck !== false && retroPush.get(agent.session) === true) {
    retroPush.delete(agent.session) // consume: one retro reminder per push
    // Which face this push gets is decided HERE, from `.scratch/batch-state.md`
    // in the agent's cwd — NOT at arm time. `session/event` is fire-and-forget
    // (the emitter never awaits a listener), so an async file read inside the
    // arming hook would land after the very assembly meant to consume it;
    // `reminderText` is already async and the assemble hook is awaited, so the
    // read belongs here. The marker is read from the FILE, which is what makes
    // the 每批至多一次 suppression hold ACROSS SESSIONS.
    const probe = await probeBatchState(agentCwd(agent))
    // A FAILED probe is reported loudly and then treated as the landing face.
    // It must never be flattened into "no marker": deciding the batch-end face
    // on an unreadable file is exactly the silent degradation the ticket's
    // fail-loud AC forbids (the file may well carry `retro:`).
    if (probe.kind === 'error') {
      parts.push([
        `Batch-state probe FAILED (${probe.code}): could not read`,
        '`.scratch/batch-state.md`, so the batch-end retro face cannot be decided',
        '— treating this push as the per-ticket landing face. Verify the file by',
        'hand (permissions / a corrupt path) and re-run the probe; do NOT assume',
        'the batch is unaggregated.',
      ].join(' '))
    }
    if (probe.kind === 'ok' && probe.content.includes(RETRO_TRIGGER.retroMarker)) {
      // batch-state.md WITH the `retro:` marker → the batch-end wrap has been
      // reached. The aggregation is injected ONLY while the batch has not been
      // aggregated yet: `.scratch/retro/.aggregated` (written by the agent after
      // it presents) is the CROSS-SESSION suppressor, so the SECOND and later
      // sessions of the same batch fall through to the landing face instead of
      // re-presenting. A later session still lands its own candidates — 每批至多
      // 一次 constrains the PRESENTATION, never the material (不静默丢素材).
      if (await hasAggregatedMarker(agentCwd(agent))) {
        parts.push([
          'Retro candidate — file it now: this batch\'s end aggregation has already',
          'been presented (`.scratch/retro/.aggregated`), so do NOT aggregate or',
          're-present it. Still run this session\'s retro and WRITE its candidates to',
          '`.scratch/retro/<batch>-<session>.md` so the material is not lost',
          '(re-running overwrites the same name, idempotent).',
        ].join(' '))
      } else {
        parts.push([
          'Batch-end retro aggregation — before presenting the wrap-up: run this',
          'session\'s retro first, then read EVERY `.scratch/retro/*.md` written by',
          'this batch, dedupe (merge the same issue and record its count), sort by',
          'severity, and present it to the human ONCE, each candidate naming its',
          'source ticket / session. Two markers answer two different facts: the',
          '`retro:` line in `.scratch/batch-state.md` says the batch-end retro has',
          'RUN (that is the trigger for this face); what suppresses a SECOND',
          'presentation is `.scratch/retro/.aggregated`, which YOU write after',
          'presenting — that is what stops every LATER session in this batch from',
          'aggregating again. Do NOT re-read the batch\'s old sessions wholesale:',
          'the per-session candidate files are the material.',
        ].join(' '))
      }
    } else if (probe.kind !== 'ok' || !probe.content.includes(RETRO_TRIGGER.retroMarker)) {
      // No batch, a batch that has not reached its end marker, or a failed
      // probe → the per-ticket 落盘 face.
      parts.push([
        'Retro candidate — file it now: this was a real push, so run this',
        'session\'s retro and WRITE the candidates to',
        '`.scratch/retro/<batch>-<session>.md` (candidates by severity + evidence',
        '— command / output — + source: session id and ticket, + why each stayed',
        'unlanded). It is a LOCAL file: no human confirmation needed and it never',
        'blocks the wrap-up, re-running the same session OVERWRITES the same name',
        '(idempotent), and it records CANDIDATES ONLY — landing them still goes',
        'through the human (D22/D27). In batch mode this is the per-ticket',
        '落盘 that the batch-end aggregation later reads.',
      ].join(' '))
    }
  }
  if (batchDeclared.get(agent.session) === true && config.batchDeclareCheck !== false) {
    batchDeclared.delete(agent.session) // consume: one initialization reminder per declaration
    parts.push([
      'Batch declared — write `.scratch/batch-state.md` now (members, end point,',
      'the closing-confirmation mode — (a) per-ticket / (b) in-batch',
      'pre-authorization / (c) batch-end once; if the declaration names none,',
      'say loudly that (a) applies — the pre-authorization list (write scope /',
      'create-only tickets / closing / one push at the batch end), the close-out',
      'record (classification + same-family merges + done-but-unclosed dropped),',
      'the Progress rows\' three evidence elements — proving command / exit code /',
      'evidence path — a lane marker per ticket, the successor ticket, and the',
      '`retro: done @ <commit>` completion marker at the batch end). Its shape is',
      '`docs/batch-state.md` — copy that template, do not invent fields. Update it',
      'after every ticket; the `retro:` line is the agent\'s to write (this plugin',
      'only reads the marker).',
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
    const call = { name: data.name, arguments: callArgs(data.arguments) }
    lastCall.set(session, call)
    // Ticket-lifecycle nudges (#82): judged on the call's declared action
    // surface — the same structured core as the ⚠ gates. The old
    // `JSON.stringify(data)` + CLOSE_PATTERNS/CREATE_PATTERNS scan armed on any
    // prose that mentioned the command (write/edit bodies, echo, commit
    // messages, --grep), i.e. on text that is not an action at all.
    for (const kind of ticketLifecycleHits(call)) {
      const armed = TICKET_ARMED[kind]
      // A declared kind without a sink is a bug in the declaration; warn
      // loudly instead of dropping it silently (and V23 reddens).
      if (armed === undefined) {
        ctx.logger(name).warn(`ticket-lifecycle kind "${kind}" has no armed-state sink`)
        continue
      }
      armed.set(session, true)
    }
    // Grill/triage family skill call → interview mode for the whole session.
    if (String(call.name ?? '').toLowerCase() === 'skill'
        && GRILL_SKILL_NAMES.includes(String(call.arguments?.name ?? '').toLowerCase())) {
      grillMode.set(session, true)
    }
    // Push-triggered retro (#71): a REAL push arms the per-ticket 落盘 reminder,
    // or the batch-end 聚合 reminder when `.scratch/batch-state.md` already
    // carries the `retro:` marker. Judged on the SAME structured surface as the
    // ⚠ gate (`pushTriggerHit` → `matchesSurface('git push', …)`), never on the
    // serialized call: a document body, an `echo` or an inline `--body` that
    // mentions the push stays inert, and so does every tool without a declared
    // action field (write / edit / pty_send / …). The marker is read HERE (the
    // hook has the session; only the assemble hook has the agent's cwd), so the
    // file read is best-effort and a read failure degrades to 落盘 — never to a
    // missing reminder. The cwd is REQUIRED for that read: without one there is
    // no file to look at, so the marker cannot be claimed (an undefined cwd must
    // never read as "marker present").
    if (pushTriggerHit(call)) {
      // `session/event` is a fire-and-forget notification: the emitter does NOT
      // await an async listener, so the WeakMap must be written SYNCHRONOUSLY,
      // before this callback returns — a read awaited inside the hook lands
      // after the assemble that was supposed to consume it (measured: the ⚠ line
      // fired while both retro branches stayed silent). The marker is therefore
      // resolved at CONSUME time instead, where `reminderText` is already async
      // and has the agent's cwd; arm BOTH here and let the assembly pick.
      retroPush.set(session, true)
    }
    // Home-delete reminder (#113): a command that would recursively delete a home
    // directory arms the one-shot warning. Judged on the SAME structured core as
    // the ⚠ gate and every other face here — the combination is declared in
    // `HOME_DELETE_TRIGGER`, so a tool without an action field (write / edit /
    // pty_send / …) can never arm it. Reminder-only: nothing is intercepted.
    if (homeDeleteHit(call)) homeDelete.set(session, true)
  })

  // Arm context evidence: assistant fold-in claims AND user assessments of
  // context capacity ("上下文容量怎么样", "评估能否并入") both arm the next
  // assembly, so the measured numbers are present while the model estimates.
  // Also arm the batch close-out nudge when assistant text reports a ticket
  // done in a batch (checked against batch-state.md at consume time).
  ctx.on('session/event', (session, event) => {
    if (!['text-chunks', 'assistant/message', 'user/message', 'agent/inbox/spliced'].includes(event?.type)) return
    const data = event.data ?? {}
    // Extract a text surface from whichever shape the event uses:
    //   - text-chunks: data.texts[] (may be undefined)
    //   - assistant/message: data.message.content[].text
    //   - user/message: data.content[] or data.text
    // JSON.stringify of the whole data is the fallback that never misses,
    // at the cost of matching on structured fields too (harmless for
    // keyword arming).
    const texts = data.texts ?? []
    let text = Array.isArray(texts) ? texts.join(' ') : ''
    if (!text) {
      const content = data.message?.content ?? data.content
      if (Array.isArray(content)) {
        text = content
          .map(part => (typeof part === 'string' ? part : (part?.text ?? '')))
          .filter(Boolean)
          .join(' ')
      } else if (typeof data.message?.text === 'string') {
        text = data.message.text
      }
    }
    text = text || JSON.stringify(data)
    text = text.toLowerCase()
    if (FOLD_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) foldIntent.set(session, true)
    if (BATCH_CLOSE_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) batchClose.set(session, true)
    // Batch declaration (#71): judge it HERE and ONLY here — a declaration is
    // something the HUMAN SAYS ("这批攒批 / 系列处理 / 大系列"), it has no tool
    // call to judge, so the text layer is its only possible face (the exact
    // inverse of the push trigger, which is judged on the action surface and
    // structurally excludes this layer). Keywords are matched as substrings over
    // the assembled text, the same shape as `BATCH_CLOSE_KEYWORDS`; the
    // reminder is injected whether or not `.scratch/batch-state.md` exists yet,
    // because creating it is precisely the declaration's job (an initialization
    // reminder gated on the file already existing would never fire once).
    if (RETRO_TRIGGER.batchDeclare.words.some(kw => text.includes(kw.toLowerCase()))) batchDeclared.set(session, true)
    // Directed handoff docs start with /grill… or /triage — arm interview
    // mode (inbox/spliced events carry the handoff as inserted user text;
    // the JSON.stringify fallback below guarantees the prefix is visible).
    if (GRILL_PROMPT_PREFIXES.some(p => text.includes(p))) grillMode.set(session, true)
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
