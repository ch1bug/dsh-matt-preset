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
  line on the next assembly (consumed after firing). For `git push` it adds a
  CI-verification reminder, with the batch-end summary-confirmation flow noted.
- A batch close-out (ticket reported done while `.scratch/batch-state.md`
  exists) gets a one-shot **AUTO-HANDOFF** nudge, plus the close-out evidence
  rule: the ticket's batch-state Progress row must carry the three evidence
  elements — proving command, exit code, evidence path (the test output itself
  counts); a row missing any element is BLOCKED, not done.

## Gate list

Default (see `DEFAULT_GATES` in `workflow-enforcer.mjs`):

| Group | Matches (substring over the tool call) |
| --- | --- |
| external | `git push`, `gh pr create`, `gh issue create`, `gh release create`, `gh repo create`, `npm publish`, `cargo publish`, `sandcastle`, `run-ticket`, `plugin_manager install_bundle`, `plugin_manager set_plugin`, `plugin_manager set_bundle` |
| destructive | `git reset --hard`, `git clean -f`, `rm -rf`, `docker compose down -v`, `docker volume rm`, `docker system prune`, `drop database`, `truncate table`, `delete from`, `git push --force` |

A gate matches as **space-separated word pairs** over the serialized tool call, so
`plugin_manager` + a mutation action fires (its install/enable events are gate-6
events — the read-only `list_plugins` / `list_bundles` calls stay routine, #55),
and a plain `plugin_manager` substring alone never does.

> This table is asserted against `DEFAULT_GATES` by `tests/verify-enforcer.mjs` V17
> (bidirectional): add a gate in one place only and the suite goes red. Write each
> gate in full — a shorthand like `set_plugin` alone is not a gate name.

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
