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

- Every prompt assembly gets a short **baseline** reminder (external/destructive
  actions → report + wait for confirmation; corrections → acknowledge + write down;
  batch mode → the batch-end push follows a batch-end summary confirmed by the
  human; mid-batch out-of-scope pushes still wait).
- A tool call matching the gate list gets a one-shot **⚠ High-risk action**
  line on the next assembly (consumed after firing), with the judgement made
  **structurally** on the call's declared action field (#79 — see 判定面 below).
  For `git push` it adds a CI-verification reminder, with the batch-end
  summary-confirmation flow noted.
- A batch close-out (ticket reported done while `.scratch/batch-state.md`
  exists) gets a one-shot **AUTO-HANDOFF** nudge, plus the close-out evidence
  rule: the ticket's batch-state Progress row must carry the three evidence
  elements — proving command, exit code, evidence path (the test output itself
  counts); a row missing any element is BLOCKED, not done.

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
> doc↔code drift guard, same idea as V17).

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
  baseline: true                 # baseline reminder on every assembly (default true)
  gatesFile: workflow-gates.yml  # project file name/path (default)
  includeDefault: false          # merge project file with the default list
  extraExternal: ["./release.sh"]
  extraDestructive: ["npm run reset"]
  dropExternal: ["npm publish"]
  dropDestructive: ["truncate table"]
```

## Notes

- Depends on the `yaml` package resolvable from the plugin (user-owned dir,
  e.g. `~/.dsh/node_modules`): `npm install --prefix ~/.dsh yaml`.
- Hooks: `session/event` (`tool/call`) + `system-prompt/assemble` (prepend).
  A filter bug degrades to no-reminder, never breaks a request.
