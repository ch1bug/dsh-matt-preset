/**
 * ps7-reminder — Windows-only, once-per-session PowerShell 7 install notice (#60).
 *
 * Family: workflow-enforcer / lang-enforcer — reminder only, never blocks,
 * never auto-installs. When the host is Windows and the available PowerShell
 * is only the 5.x line (Windows PowerShell 5.1, powershell.exe) with NO
 * PowerShell 7+ (pwsh) present, inject one explicit reminder suggesting the
 * user install PowerShell 7.x from the Microsoft Store.
 *
 * Detection notes (each is a decision, not an omission):
 *   - Windows-only: on any other platform nothing is injected and no probe
 *     runs — the detector answers `not-windows` (the assemble listener itself
 *     is always registered; it exits before detection).
 *   - "Only 5.x" means pwsh 7+ is ABSENT — not merely that 5.1 exists
 *     alongside. `pwsh.exe` is the PowerShell 7+ binary name (5.1 is
 *     `powershell.exe`), so "pwsh.exe found on PATH" ⇔ "pwsh 7+ present".
 *   - PATH scan, not `existsSync`: the Microsoft Store install of PowerShell
 *     7 — precisely the install path this reminder suggests — places an app
 *     execution alias (IO_REPARSE_TAG_APPEXECLINK) at
 *     `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`, which is ON PATH but
 *     fails `fs.existsSync`/`fs.statSync` (measured 2026-11-08 on a Store
 *     install: existsSync=false, statSync EACCES, lstatSync OK). The default
 *     probe is therefore `lstatSync` — "a directory entry named pwsh.exe
 *     exists on PATH", which is true for both a real install and the alias.
 *   - Detection runs lazily on the session's FIRST prompt assembly and the
 *     result is consumed once per session (WeakMap keyed by session): a
 *     fresh session re-checks, so installing pwsh silences the reminder on
 *     the next session without restarting the host. No per-turn cost.
 *
 * Injection point (same seam as workflow-enforcer / lang-enforcer):
 *   `system-prompt/assemble` (prepend listener) — appends one `env:ps7`
 *   section (order 97, after lang:packs 96 — environment notices come last;
 *   process belongs to the gates, knowledge to the packs, environment facts
 *   here). Scope guard defaults to the ask-matt marker, same defensive
 *   default as the other bundle plugins; `config.scope: 'all'` opts a
 *   non-matt mount in explicitly.
 */
import { lstatSync } from 'node:fs'
import { join } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'ps7-reminder'

/** The prompt registry this plugin contributes to. */
export const inject = ['systemPrompt']

/** Injected section identity (name/order) — order 97 keeps it after the
 * workflow gates (95) and the lang packs (96). */
export const SECTION_NAME = 'env:ps7'
export const SECTION_ORDER = 97

/** The one-time reminder text. Reminder-only contract is part of the text:
 * no blocking, no retrying, no auto-install. The assertion matches the
 * detection criterion exactly ("no pwsh 7+ found on PATH" — not "only 5.x",
 * which the probe does not establish: pwsh may exist off-PATH). */
export const REMINDER = [
  '[env:ps7] One-time environment notice: no PowerShell 7+ (pwsh) was found on',
  'PATH on this Windows host. At a natural moment, let the user know that',
  'PowerShell 7.x can be installed from the Microsoft Store. This is a',
  'reminder only: do not block, do not retry, and do not install anything.',
].join('\n')

/** Default probe: does a directory entry exist at this path? `lstatSync`
 * (NOT existsSync/statSync) — see the detection notes for the Store-alias
 * measurement that pins this choice. Errors read as "absent". */
function defaultExists(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Scan a PATH-style variable for `pwsh.exe`. Returns the first directory
 * holding one, or null. Public for the guard's injected-environment tests. */
export function findPwshOnPath(pathVar, exists = defaultExists) {
  const dirs = String(pathVar ?? '').split(';').map(d => d.trim()).filter(d => d !== '')
  for (const dir of dirs) {
    const candidate = join(dir, 'pwsh.exe')
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * The detection verdict — pure function over an injectable environment so
 * the guard can test all three outcomes on any host:
 *   - non-Windows  → { remind: false, why: 'not-windows' }  (hook inert)
 *   - pwsh on PATH → { remind: false, why: 'pwsh-present', pwshPath }
 *   - pwsh absent  → { remind: true,  why: 'pwsh-absent' }  (only 5.x line)
 * @param {{ platform?: string, path?: string, exists?: (p: string) => boolean }} [env]
 */
export function detectPowerShellState(env = {}) {
  const platform = env.platform ?? process.platform
  if (platform !== 'win32') return { platform, remind: false, why: 'not-windows' }
  const pwshPath = findPwshOnPath(env.path ?? process.env.PATH, env.exists)
  if (pwshPath !== null) return { platform, remind: false, why: 'pwsh-present', pwshPath }
  return { platform, remind: true, why: 'pwsh-absent' }
}

/** Sessions already served their (possibly empty) one-time notice. */
const noticed = new WeakMap()

/** Register the once-per-session assemble hook. Config:
 *   - `scope` / `marker`: the defensive marker guard (defaults 'marker' /
 *     'ask-matt'; `'all'` opts a non-matt mount in explicitly).
 *   - `env`: injection seam for tests — the environment object passed to
 *     `detectPowerShellState` ({ platform, path, exists }). Production never
 *     sets it; undefined means the real host environment. */
export function apply(ctx, config = {}) {
  const cfg = { scope: 'marker', marker: 'ask-matt', ...config }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next() // downstream errors propagate untouched
    const agent = context.agent
    if (agent === undefined || agent.session === undefined) return assembled
    try {
      // Once per session: the FIRST assembly that passes the scope guard
      // consumes the session's notice, whether or not a reminder is due.
      // (A scope-failing assembly does NOT consume it — the marker is a
      // session-stable property, but consuming before it would turn a
      // marker-less first assembly into a silently missed reminder.)
      if (noticed.has(agent.session)) return assembled
      if (cfg.scope !== 'all') {
        const texts = (assembled?.sections ?? []).map(section => section?.text ?? '').join('\n')
        if (!texts.includes(cfg.marker)) return assembled
      }
      noticed.set(agent.session, true)
      const state = detectPowerShellState(cfg.env)
      if (!state.remind) return assembled
      const sections = Array.isArray(assembled.sections) ? assembled.sections : []
      return {
        ...assembled,
        sections: [...sections, { name: SECTION_NAME, order: SECTION_ORDER, text: REMINDER }],
      }
    } catch (error) {
      // A reminder bug must never brick every request of a session.
      ctx.logger(name).warn(String(error?.stack ?? error))
      return assembled
    }
  }, { prepend: true })
}
