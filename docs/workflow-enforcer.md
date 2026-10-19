# workflow-enforcer — DSH plugin

Hard-gate reminders for the ask-matt workflow (and any agent preset that wants
them): external/destructive actions must be reported and confirmed, human
corrections must be written down. **Reminder-only — nothing is intercepted.**

## Install

```sh
dsh plugin --profile web add /path/to/dsh-workflow-enforcer   # local link
# or, once published:  dsh plugin --profile web add dsh-workflow-enforcer
```

The bundle registers the plugin automatically (`cordis.patch.yml` insert) —
**no path to configure**: DSH resolves the package from the profile's
`node_modules`. For a preset-only mount instead of the global bundle:

```yaml
- id: workflow-enforcer
  name: dsh-workflow-enforcer   # resolvable when linked into the preset's node chain
  config:
    baseline: true
```

## Scope

Installed as a global bundle, the plugin injects **only into sessions whose
prompt carries the `ask-matt` marker** (the matt persona) — `minimal`/`code`
sessions are untouched. Set `scope: all` in the plugin config to inject
everywhere, or change `marker:`.

## What it injects

Twelve sections, each with its own switch in the per-row config below (the ⚠ line
has none; the three #71 retro faces share one). The baseline and the grill
contract re-render on every assembly; the rest fire once and are consumed.
**Seven judge an action** through the structured 判定面 below — the ⚠ high-risk
line, the ticket close, the ticket create, #71's three push-triggered retro
faces (the per-ticket 落盘 reminder, the batch-end aggregation when the batch
already carries the `retro:` marker, the loud probe-failure report when that
file could not be read), and #113's home-delete reminder — while **four are
conversation observations** armed by text keywords (batch close-out,
fold-in/capacity evidence, grill/triage mode, and the batch declaration), so
those never fire from a tool call **alone**; the baseline is unconditional.
The split is deliberate, not incidental: a push **has** a `(toolName, argv)`
action surface, so it is judged there and only there (the text layer is
structurally excluded — 宁严勿宽, #71); a batch declaration has no tool call at
all, so its only possible face is the text layer.

- Every prompt assembly gets a short **baseline** reminder (`WORKFLOW GATES`:
  external/destructive actions → report + wait for confirmation; corrections →
  acknowledge + write down; routine actions whitelisted; one issue per session;
  batch mode → the batch-end push follows a batch-end summary confirmed by the
  human; mid-batch out-of-scope pushes still wait).
- A tool call matching the gate list gets a one-shot **⚠ High-risk action**
  line on the next assembly (consumed after firing), with the judgement made
  **structurally** on the call's declared action field (#79 — see 判定面 below).
  For `git push` it adds a CI-verification reminder, with the batch-end
  summary-confirmation flow noted.
- A ticket **close** (`gh issue close`, or the declared `gh api … state=closed`
  face) gets a one-shot **fresh-subagent quality spot check** nudge (O5):
  self-assessment runs in the same context it would be judging, so it cannot see
  its own degradation — the fresh view can.
- A ticket **create** (`gh issue create`) gets a one-shot **ONE ISSUE PER SESSION**
  reminder (D20): the new ticket is its own session's work — create it
  and continue the current ticket only, never fix/close/fold it inline (TICKET
  EXIT). The same nudge carries the **label read-back invariant** (#128):
  read the labels back and require exactly one category + exactly one state —
  a ticket with no state is invisible on every state-filtered surface.
- A batch close-out (ticket reported done while `.scratch/batch-state.md`
  exists) gets a one-shot **AUTO-HANDOFF** nudge, plus the close-out evidence
  rule: the ticket's batch-state Progress row must carry the three evidence
  elements — proving command, exit code, evidence path (the test output itself
  counts); a row missing any element is BLOCKED, not done.
- A fold-in or context-capacity claim in the conversation (关键词：
  并入/评估/容量/上下文/窗口…, see `FOLD_KEYWORDS`) gets the **measured context
  evidence** line (`context: 62k used / 1000k (6%) · cache-read 38% (latest-request)`).
  The same numbers are available on demand: the model-invoked **`context_status`**
  tool returns them whenever the agent asks (or the human asks about the window).
- A grill/triage session (a skill call in the grill family, or a prompt starting
  `/grill` / `/triage`) gets the **GRILL QUESTION CONTRACT** re-injected on every
  assembly: one decision per message, status line, four-piece block, time
  estimate, opt-in batch only on request.
- A **real push call** (#71, structured — see 判定面 below) gets a one-shot
  **Retro candidate — file it now** reminder on the next assembly (consumed after
  firing, never a second section): run this session's retro and write the
  candidates to `` `.scratch/retro/<batch>-<session>.md` `` (candidates by
  severity + evidence — command / output — + source: session id and ticket, + why
  each stayed unlanded). It is a LOCAL file: `no human confirmation needed` and
  it never `blocks the wrap-up`, re-running the same session overwrites the same
  name (idempotent), and it records `CANDIDATES ONLY` — landing them still goes
  through the human (D22/D27). This is the per-ticket 落盘 the batch-end
  aggregation later reads.
- A real push whose `.scratch/batch-state.md` **already carries the `retro:`
  marker** gets the **Batch-end retro aggregation** reminder instead — but only
  while the batch has **not** been aggregated yet. The cross-session suppressor
  is a SECOND existence marker, `.scratch/retro/.aggregated`, which the agent
  writes after it presents; once it exists, later sessions fall back to the
  landing face (`Retro candidate — file it now`, with the "do NOT aggregate or
  re-present" wording) so the material is still landed and never silently
  dropped. The `retro:` marker alone cannot hold this: it is written **before**
  the batch-end push, so on its own every later session in the same batch would
  re-take the aggregation branch (measured: 3 sessions → 3 aggregations). Two
  different facts, so two markers — `retro:` answers "has the batch-end retro
  run", `.aggregated` answers "has the aggregation already been PRESENTED". The
  aggregation section itself: run this session's retro first, then
  `read EVERY `.scratch/retro/*.md`` written by this batch, `dedupe` (merge the
  same issue and `record its count`), `sort by severity`, and `present it to the
  human ONCE`, each candidate naming its `source ticket / session`; after
  presenting, write `.scratch/retro/.aggregated`. Do not re-read the batch's old
  sessions wholesale — the per-session candidate files are the material. Both
  markers are read as **existence only** (never parsed), and 每批至多一次
  constrains the **presentation**, never the material.
- A push whose `.scratch/batch-state.md` probe **failed to read** gets the
  one-shot **Batch-state probe FAILED** report — the loud path for a read failure
  (EISDIR / EACCES / EPERM / IO, `code` named in the text), deliberately distinct
  from `ENOENT` "the file is not there" (the normal not-in-a-batch path). It is
  pushed **without** a `⚠` prefix — that prefix belongs to the high-risk *action*
  gate, and reusing it here would read as a false alarm — and it treats the push
  as the per-ticket landing face (落盘), telling the agent to verify the file by
  hand and re-run the probe rather than assume the batch is unaggregated.
  Flattening a read failure into "no marker" would decide the batch-end face on a
  failed probe: that is exactly the silent degradation the fail-loud rule
  forbids (D47).
- A **batch declaration** in the conversation (关键词：攒批/批量模式/系列处理/
  大系列/这批攒批, see `RETRO_TRIGGER.batchDeclare`) gets a one-shot
  **Batch declared** reminder — a **text-layer observation**, deliberately unlike
  the push trigger above (the declaration is something the human says; it has no
  tool call at all): `` write `.scratch/batch-state.md` now `` (members, end point,
  the **closing-confirmation mode** — per-ticket / in-batch pre-authorized /
  batch-end once, with a loud line when the declaration names none — the
  **pre-authorization list** (write scope / create-only tickets / closing / one
  push at the batch end), the **close-out record** (classification + same-family
  merges + done-but-unclosed dropped), the Progress rows' three evidence
  elements — proving command / exit code / evidence path — a lane marker per
  ticket, the successor ticket, and the
  `` `retro: done @ <commit>` completion marker `` at the batch end). Its shape is
  `docs/batch-state.md` — copy that template, do not invent fields. The `retro:`
  line is the **agent's** to write; this plugin only reads the marker and is
  reminder-only (it writes no file).
- A command that would **recursively delete a home directory** (#113, structured
  — see 判定面 below) gets a one-shot **Home-delete candidate** `⚠` reminder on
  the next assembly (consumed after firing): the target may only ever be a path
  **this command created itself** (`mktemp` / `mkdtemp` output) and never one
  re-derived from an environment variable; **`$HOME` and `$PID` are READ-ONLY
  automatic variables in PowerShell**, so `$home = …` is a **non-terminating**
  error and every derived path silently falls back to the real home — name
  temporary-directory variables something else (`$tmpHome`); and for an isolated
  run, use `` `node scripts/with-temp-home.mjs -- <cmd…>` `` instead of
  hand-writing the sandbox. **Reminder-only — nothing is intercepted** (a
  repository-side guard cannot physically stop a shell command the agent is
  about to write; that is #113's declared boundary).

## Gate list

Default (see `DEFAULT_GATES` in `workflow-enforcer.mjs`):

| Group | Gate (matched structurally — see 判定面 below) |
| --- | --- |
| external | `git push`, `gh pr create`, `gh issue create`, `gh release create`, `gh repo create`, `npm publish`, `cargo publish`, `sandcastle`, `run-ticket`, `plugin_manager install_bundle`, `plugin_manager set_plugin`, `plugin_manager set_bundle` |
| destructive | `git reset --hard`, `git clean -f`, `rm -rf`, `docker compose down -v`, `docker volume rm`, `docker system prune`, `drop database`, `truncate table`, `delete from`, `git push --force` |

A gate matches as a **word run at a command position** of the call's declared
action field — never as a substring over the serialized call (#79). Flag words
match by prefix (`git clean -f` reaches `git clean -fd`). So
`plugin_manager install_bundle` fires on the tool+action pair (its install/enable
events are gate-6 events — the read-only `list_plugins` / `list_bundles` calls
stay routine, #55), and a plain `plugin_manager` substring alone never does. A
document body, an `echo`, a commit message, `--grep`, or an inline `--body` that
merely *mentions* `git push` fires nothing: a false ⚠ makes the agent stop and
wait for a confirmation on a high-risk action that never happened, and it dilutes
a reminder the model is supposed to obey.

### 判定面（#79：结构化，不做整串子串）

| Surface | Action field | Where the gate is matched |
| --- | --- | --- |
| `bash` / `pwsh` / `sh` / `zsh` / `dash` / `powershell` / `cmd` | `arguments.command` | argv[0] 先归一化（basename、去 `.exe`/`.cmd`/`.bat`/`.ps1`：`/usr/bin/git push`、`git.exe push` 同 `git push`）；按命令分隔符（`&&` `\|\|` `;` `\|` `&`）**逐条命令**判各自命令位置（`cd repo && git push`、`git status; git push` 命中）；跳过 `sudo` / `doas` / `command` / `nohup` / `env` / `time` 包装、shell 关键字（`if`/`while`/`!`…）与 `VAR=…` 赋值；附着的重定向与 `$(…)`/反引号不藏命令（`git push>log.txt`、`$(git push)` 命中）；**执行载荷** flag 值递归判定（`bash -c "git push"`、`bash -lc …`），shell 只读首个操作数之前的**前导选项簇**（`bash deploy.sh -c "…"` 是脚本参数、不算执行载荷），SQL 客户端全串扫描（`psql -h host -c "delete from …"`）；递归上限 2 层 |
| `plugin_manager` | `arguments.action` | 工具名 + action 两词序列（`plugin_manager install_bundle`） |
| 单个词的门（`sandcastle` / `run-ticket`） | 同上 | 调用链（`RUNNERS`：`npx`/`pnpm`/`tsx`/`node`/`python`/`sh`/`bash`/`pwsh`…）上目标的**名字**匹配：basename 去扩展名或任一路径组件等于该门——`.sandcastle/run-ticket.mts` 命中 `sandcastle`/`run-ticket`；`sandcastle-notes.mjs`、`run-ticket-helpers.mjs` 不命中（名字相等，不是子串） |
| **票生命周期 nudge**（关票 fresh-subagent 抽查 O5 / 建票 D20，`TICKET_LIFECYCLE`） | 同上（shell `arguments.command`） | 与 ⚠ 门**同一结构化核**（#82）：关票 = 命令位置词串 `gh issue close`；**关票的 API 形态**仍走 shell 的 `command` 字段，但其判定面**显式声明**为 `gh api`（命令位置 + 子命令）+ 声明的方法 flag（`-X`/`--method` = `PATCH`）+ 声明的载荷 flag（`-f`/`--raw-field`、`-F`/`--field` = `state=closed`）+ `issues/<n>` 路径 token；建票 = 命令位置词串 `gh issue create`。`write`/`edit`/`str_replace_editor` 正文、`echo`、commit 消息、`--grep`、`--body`/`--title` 里提到这些命令**永不** arm；`gh api` 的其余面显式不覆盖（`--input -` 读 stdin、非 `PATCH` 方法、其它字段、紧跟未声明 flag 的 endpoint——那个 token 可能是该 flag 的值——交 #71 事实探测） |
| **#71 push 触发面**（retro：每票落盘 / 批末聚合，`RETRO_TRIGGER`） | 同上（shell `arguments.command`） | 与 ⚠ 门**同一结构化核**：push = 命令位置词串 `git push`（`RETRO_TRIGGER.push.words`），判定输入**恒为** `(toolName, argv)`；工具层 + 命令层都经 `matchesSurface`，与 ⚠ 门的 push 追随行**同一次判定、同一个声明**（两者不可能分歧）。**文本事件层永不 arm push**（`assistant/message` / `user/message` / `text-chunks` / `agent/inbox/spliced` 结构上无动作字段；会话/思考里讨论"推送/push"、retro 文档、handoff 正文一律不触发——宁严勿宽）。**批宣告是唯一允许文本面的面**：`RETRO_TRIGGER.batchDeclare` 的关键词组（`攒批`/`批量模式`/`系列处理`/`大系列`/`这批攒批`）——宣告是**人说的话**，根本没有工具调用，文本层是它唯一可能的判定面（与 `BATCH_CLOSE_KEYWORDS` 同构），读成两个**存在性** marker——`RETRO_TRIGGER.retroMarker`（`retro:`）与 `RETRO_TRIGGER.aggregatedMarker`（`.scratch/retro/.aggregated`），都只判**存在性**、不解析任何表格/内容，两者组合决定落盘 vs 聚合（`retro:` 且无 `.aggregated` → 聚合；`retro:` 且有 `.aggregated` → 落盘，不聚合但不丢素材）。**探针失败是独立的响亮路径**：读 `` `.scratch/batch-state.md` `` 失败（非 `ENOENT`）走 `Batch-state probe FAILED` 节（**无 `⚠` 前缀**），绝不静默降级成"无 marker"。**声明不覆盖**：PTY 分片写（`pty_send`）、经脚本/`xargs`/`node deploy.mjs` 间接 push、其它工作区工具面（`write`/`edit` 无动作字段）一律不触发——与 #79 declared-not-covered 同口径，交**事实探测**兜底（`git log origin/<branch>..HEAD` / `git status -sb`），本插件**不为它长模糊匹配** |
| **#113 home-delete 提醒面**（`HOME_DELETE_TRIGGER`） | 同上（shell `arguments.command`） | 与 ⚠ 门**同一结构化核**（删除动词半边走 `matchesSurface`，与 ⚠ 门同一匹配器，故 `sudo rm …`、`cd x && rm …`、`bash -c "rm …"` 与其它面一致地免费覆盖），但判定是**组合**而非更长的词表：**删除动词**（`Remove-Item` / `ri` / `rm` / `rmdir` / `del` / `erase` / `rd`，取命令位置、经 `commandToken` 归一化）**且**该命令 argv 里有**home 形态目标**（`$env:DSH_HOME` / `$HOME` / `~/.dsh` / `%USERPROFILE%\.dsh`）。事故命令 `Remove-Item -Recurse -Force $env:DSH_HOME` 对旧 ⚠ 门**完全隐形**（cmdlet 形态不含任何门词），故新增此面。**两半必须落在同一条命令段**，这正是负例的判据：`echo "Remove-Item -Recurse $env:DSH_HOME"` 里 `echo` 占**命令位置**（删除动词只出现在 `echo` 的**参数**里，不是命令位置），`rm -rf ./dist` / `Remove-Item ./build` 无 home 目标 —— **均不触发**；`write`/`edit`/`pty_send` 正文结构上永不 arm。⚠ **token 口径**：本面读的是 `shellWords` 产出的 token，而该分词器（与 ⚠ 门共用）会**丢掉未加引号的 `$`**（`shellWords` 明文行为）——未加引号的 `$env:DSH_HOME` 到达时是 `env:DSH_HOME`、`$HOME` 是 `HOME`，加引号的 `"$HOME\.dsh"` 才保留 `$`；故 predicates 同时接受 shell 拼写与其分词残留（实测：只按 shell 拼写匹配会漏掉**全部未加引号形态**，正是事故命令那条）。目标里的 `$env:TEMP` / `%TEMP%` 之类**故意不匹配**（那是**安全**目标，提醒它等于教模型忽略本提醒）——变量名按**整 token** 匹配（`DSH_HOME`/`HOME`/`USERPROFILE`），不是"任意 `$env:` 展开"（第一版正是后者，实测 `$env:TEMP` 会触发）。**声明不覆盖**：选项在前的命令位置、PTY 分片、脚本间接触发一律不触发——与 #79 declared-not-covered 同口径，**不为它长模糊匹配** |
| `write` / `edit` / `str_replace_editor` / `pty_send` / `pty_open` / `run_code` / 其它工作区工具面 | — | **显式不覆盖**：带正文、分片写入或**程序正文**的参数永不命中，不用模糊匹配弥补（PTC 下经 SDK 的嵌套调用是真实 `tool/call`，仍按该调用的动作字段照常判定） |

Which flag values are executed is **declared** (`EXEC_FLAGS`: shell `-c`,
`psql -c`, `mysql -e`), not guessed: `echo -e` (escapes), `psql -e` (echo
queries) and `git commit -m` are absent because their values are text. Misses
that cannot be judged structurally stay uncovered **on purpose**, and the list is
declared rather than silent: positional SQL (`sqlite3 db "delete from …"`),
**option-laden command positions** — only `argv[0]`/`argv[1]`-style positions are
judged, so `docker compose -f prod.yml down -v`, `git -c k=v reset --hard`,
`gh --repo o/r issue create`, `git -C <dir> push` and `npm --prefix <dir> publish`
do not match (the flags are not modelled), executed-payload nesting past 2
levels, PTY fragment writes, and script/`xargs`-mediated pushes. The ticket
lifecycle nudges share these declared limits (they ride the same judgement), and
add their own: the `gh api` face needs the declared method flag and payload flag,
so a stdin body (`gh api … --input -`), another method or another payload key
does not arm it, and neither does an endpoint that sits directly after an
undeclared flag (that token may be the flag's value, e.g. `--hostname`). The fact
probe
that backstops those is #71's concern; this plugin does not grow a fuzzy matcher
to cover them.

> This table is asserted against `DEFAULT_GATES` by `tests/verify-enforcer.mjs` V17
> (bidirectional): add a gate in one place only and the suite goes red. Write each
> gate in full — a shorthand like `set_plugin` alone is not a gate name.
> V18 pins the false positives (#79 negatives), V19 the declared reach
> (executed payload / invocation target / wrapper / argv[0] normalization /
> attached punctuation), V20 that every declared gate is still reachable from a
> canonical invocation (no silently dead gate).
> V21 pins the ticket-lifecycle nudge false positives (#82 negatives: write/edit
> body, `echo`, commit message, `--grep`, an API-shaped note in a file),
> V22 the declared reach of `TICKET_LIFECYCLE` (wrapper / separator / executed
> payload / the declared `gh api` face) plus the faces it does not cover,
> V23 that every declared lifecycle face — including the `gh api` one — is still
> reachable from a canonical invocation through the real hook seam, V23b that the
> arming really reads `TICKET_LIFECYCLE` (a runtime-added word run arms, removing
> it disarms), V23c that this 判定面 row documents every declared element (the
> doc↔code drift guard, same idea as V17), V24 that 「What it injects」and the
> per-row config block cover every entry of `INJECTIONS` — the same discipline
> covers #71's `RETRO_TRIGGER`, whose declared elements (`push.words` /
> `batchDeclare.words` / `retroMarker` / `aggregatedMarker`) are written verbatim
> in the row above, so extending the guard to that declaration cannot drift.
> V32 pins #113's home-delete reach (the incident command + alias / quoted /
> `~`-form / wrapper / command-list / executed-payload), V33 the false positives
> the ticket outlaws (a quoted payload, a `write`/`edit`/`str_replace_editor`
> body, an ordinary clean-up of one's own output, and a **temp-directory**
> target — the safe form, flagging which would train the model to ignore the
> reminder), V33b the reminder's content contract (the read-only-variable trap,
> the `$tmpHome` naming rule, the `scripts/with-temp-home.mjs` pointer, the
> own-created-path rule), V33c the target VOCABULARY matrix (every declared home
> spelling fires; `$env:TEMP` / `%TEMP%` and other temp spellings never do — the
> unit-level pin for the deliberate temp exclusion, which the real-command
> negatives alone did not catch), V34 that the arming really reads
> `HOME_DELETE_TRIGGER`
> (a runtime-added verb arms, removing it disarms), V34b that every declared
> verb **and** target is reachable from a canonical invocation (a dead verb is
> lost coverage, not a tightening — the V20 discipline), and V34c that this row
> documents every declared element.

### Per-project override: `workflow-gates.yml`

Place it in the session's working directory (root of the project):

```yaml
# workflow-gates.yml — replaces the default list entirely.
# Set includeDefault: true in the plugin config to merge instead.
external:
  - "git push"
  - "my-publish-script.sh"
destructive:
  - "docker-dev.sh reset"     # project-specific reset/cold-start
  - "rm -rf"
```

Project items go through the **same structured judgement** as the defaults (判定面
above) — a project gate reaches a command position or an invocation target, never
free text.

### Per-row config

```yaml
config:
  scope: all                     # inject everywhere (default: only where the marker appears)
  marker: ask-matt               # the marker string that scopes injection (default)
  baseline: true                 # baseline reminder on every assembly (default true)
  grillContract: true            # GRILL QUESTION CONTRACT in grill/triage sessions (default true)
  contextEvidence: true          # measured context line on a fold-in / capacity claim (default true)
  ticketClosedCheck: true        # fresh-subagent spot check after a ticket close (default true)
  ticketCreatedCheck: true       # ONE ISSUE PER SESSION after a ticket create (default true)
  batchCloseCheck: true          # AUTO-HANDOFF nudge on a batch close-out (default true)
  retroTriggerCheck: true        # #71: per-ticket 落盘 / batch-end aggregation after a real push (default true)
  batchDeclareCheck: true        # #71: batch-state.md initialization on a batch declaration (default true)
  homeDeleteCheck: true          # #113: home-delete candidate warning after a delete-verb + home-target call (default true)
  gatesFile: workflow-gates.yml  # project file name/path (default)
  includeDefault: false          # merge project file with the default list
  extraExternal: ["./release.sh"]
  extraDestructive: ["npm run reset"]
  dropExternal: ["npm publish"]
  dropDestructive: ["truncate table"]
```

> The 「What it injects」 list above and this block are asserted against
> `INJECTIONS` by `tests/verify-enforcer.mjs` V24 — a new injection or knob that
> nobody documents goes red, the same doc↔code discipline as V17/V23c.

## Notes

- Depends on the `yaml` package resolvable from the plugin (user-owned dir,
  e.g. `~/.dsh/node_modules`): `npm install --prefix ~/.dsh yaml`.
- Hooks: `session/event` (`tool/call`) + `system-prompt/assemble` (prepend).
  A filter bug degrades to no-reminder, never breaks a request. The same hook
  also arms the **text-layer** observations — the batch declaration (#71) joins
  `foldIntent` / `batchClose` there; that is the *only* text-layer face in this
  plugin, and it never decides a push (see 判定面).
