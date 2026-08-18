/**
 * scheduled-jobs — a cron-like scheduled task runner for the matt preset.
 *
 * Each JOB is its own row in agent.cordis.yml sharing this plugin file:
 *
 *     - id: job-sync-skills
 *       name: ./scheduled-jobs.mjs
 *       config:
 *         id: job-sync-skills          # stable job id (row id is not passed to apply)
 *         schedule: "0 9 * * *"        # 5-field cron, evaluated in the HOST local timezone
 *         command: "~/.agents/upstreams/sync-skills.sh"   # run via `bash -c`
 *         runOnMount: true             # run once when the standing mount starts
 *         notifyOnFailure: true        # followup the configured session when the command exits non-zero
 *         notifySessionId: ""          # explicit session id; no default target
 *         # tickSeconds: 60            # scheduler tick granularity (default 60; shared per mount)
 *
 * Multiple rows share ONE module instance (Node module cache), so a
 * module-level registry holds every job and a per-mount guard registers the
 * tools exactly once per standing generation — the second row must not
 * re-register `jobs_list`/`jobs_run`/`jobs_pause` into the same tools layer.
 *
 * Engines: cron expressions via `cron-parser` (installed at ~/.dsh/node_modules —
 * a user-owned directory Node reaches by walking up from this file; the
 * deployment's own node_modules is never touched). A single tick timer per
 * standing mount (default 60 s, configurable) fires due jobs. `runJob` is
 * serialized per job (`running` flag), records lastRun into the registry, and
 * notifies via `agent.followup()` when configured and the target session is
 * live. Pause state is in-memory only (lost on restart).
 *
 * The standing mount lives while DSH runs and this preset has been joined;
 * editing agent.cordis.yml starts a NEW generation for later sessions while
 * joined ones keep theirs — briefly two schedulers may coexist. The sync job
 * is an idempotent full mirror, so a duplicate run is harmless (ADR 0001).
 */
import { randomUUID } from 'node:crypto'
import cron from 'cron-parser'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'scheduled-jobs'

/** The tool registry, the subprocess seam, and the AgentFactory registry. */
export const inject = ['tools', 'subprocess', 'agents']

/** Module-level shared registry: jobId -> live job. */
const jobs = new Map()

/** Per standing-mount state: which ctx registered the tools, and its tick timer. */
let toolsOwner = null
const timers = new Map()

const MAX_OUTPUT_CHARS = 2000
const DEFAULT_TICK_MS = 60000

/**
 * Next occurrence of `schedule` strictly after `after`, in the host's local
 * timezone (cron-parser defaults to the process zone). Exported for tests.
 */
export function computeNext(schedule, after = new Date()) {
  return cron.CronExpressionParser.parse(schedule, { currentDate: after }).next().toDate()
}

/** Run one job now: spawn `bash -c <command>`, record lastRun, notify on failure. */
async function runJob(job) {
  if (job.running) return
  job.running = true
  const started = new Date().toISOString()
  const ctx = job.ctx
  try {
    let stdout = ''
    let stderr = ''
    let exitCode = 0
    try {
      const shell = await ctx.subprocess.resolveExecutable('bash', undefined, undefined)
      const handle = ctx.subprocess.spawn({
        argv: [shell, '-c', job.config.command],
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 8192 },
          stderr: { maxBytes: 8192 },
        },
        graceMs: 3000,
      })
      try {
        const outcome = await handle.done
        exitCode = outcome.exitCode
      } catch (spawnError) {
        job.lastRun = { at: started, ok: false, error: String(spawnError?.message ?? spawnError) }
        await notifyFailure(job)
        return
      }
      try { stdout = handle.collected.stdout.readFrom(0).text } catch { /* collected readers may be unavailable */ }
      try { stderr = handle.collected.stderr.readFrom(0).text } catch { /* same */ }
    } catch (resolveError) {
      job.lastRun = { at: started, ok: false, error: `bash resolve/spawn failed: ${String(resolveError?.message ?? resolveError)}` }
      await notifyFailure(job)
      return
    }
    const output = [stdout, stderr].filter(part => part.length > 0).join('\n').slice(0, MAX_OUTPUT_CHARS)
    job.lastRun = { at: started, ok: exitCode === 0, exitCode, output }
    if (!job.lastRun.ok && job.config.notifyOnFailure) await notifyFailure(job)
  } finally {
    job.running = false
    job.nextRun = computeNext(job.config.schedule)
  }
}

/** Best-effort: followup the explicitly configured session when it is live. */
async function notifyFailure(job) {
  const target = job.config.notifySessionId
  if (typeof target !== 'string' || target.length === 0) return
  const last = job.lastRun ?? {}
  const detail = last.error ?? (last.output ?? '').slice(0, 500)
  try {
    // The service read itself can throw when the standing mount failed and the
    // plugin's context is already inactive (e.g. a harness that cannot supply
    // every host service). Notification must never take the process down.
    const agent = job.ctx.agents.get(target)
    if (!agent) return
    agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{
        type: 'text',
        text: `[定时任务失败] ${job.id} — ${last.exitCode !== undefined ? `exit ${last.exitCode}` : '执行错误'}\n${detail}`,
      }],
      source: { kind: 'plugin', plugin: 'scheduled-jobs' },
    })
  } catch { /* notification is best-effort */ }
}

/** Fire every due job of THIS standing mount (jobs from other mounts are skipped). */
function tick(ctx) {
  const now = Date.now()
  for (const job of jobs.values()) {
    if (job.ctx !== ctx) continue
    if (job.paused || job.running) continue
    if (job.nextRun.getTime() <= now) runJob(job).catch(err => { job.lastRun = { at: new Date().toISOString(), ok: false, error: String(err?.message ?? err) } })
  }
}

const textOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

const idParam = {
  type: 'object',
  additionalProperties: false,
  properties: { id: { type: 'string', description: 'Job id (config.id).' } },
  required: ['id'],
}

/** Register the three model-facing tools once per standing mount. */
function registerTools(ctx) {
  ctx.tools.register({
    name: 'jobs_list',
    description: [
      'List the scheduled jobs configured in this mode: id, cron schedule, paused state,',
      'next/last run time, and a short last-run summary.',
    ].join(' '),
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput,
    async execute() {
      const rows = [...jobs.values()].map(job => ({
        id: job.id,
        schedule: job.config.schedule,
        paused: job.paused,
        running: job.running,
        nextRun: job.nextRun?.toISOString() ?? null,
        lastRun: job.lastRun
          ? {
              at: job.lastRun.at,
              ok: job.lastRun.ok,
              ...(job.lastRun.exitCode !== undefined ? { exitCode: job.lastRun.exitCode } : {}),
              ...(job.lastRun.error ? { error: job.lastRun.error } : {}),
              outputTail: (job.lastRun.output ?? '').slice(0, 200),
            }
          : null,
      }))
      return { text: JSON.stringify(rows, null, 2) }
    },
  })

  ctx.tools.register({
    name: 'jobs_run',
    description: [
      'Run one scheduled job immediately and return its output.',
      'Works even while the job is paused; does not change the paused state.',
    ].join(' '),
    parameters: idParam,
    output: textOutput,
    async execute(args) {
      const job = jobs.get(args.id)
      if (!job) throw new Error(`unknown job: ${args.id} (known: ${[...jobs.keys()].join(', ')})`)
      await runJob(job)
      return { text: JSON.stringify(job.lastRun, null, 2) }
    },
  })

  ctx.tools.register({
    name: 'jobs_pause',
    description: [
      'Toggle one scheduled job between paused and active.',
      'Paused jobs keep their schedule but do not fire; jobs_run still works.',
    ].join(' '),
    parameters: idParam,
    output: textOutput,
    async execute(args) {
      const job = jobs.get(args.id)
      if (!job) throw new Error(`unknown job: ${args.id}`)
      job.paused = !job.paused
      return { text: JSON.stringify({ id: job.id, paused: job.paused }) }
    },
  })
}

/** One row = one job (shared module instance across rows). */
export function apply(ctx, config) {
  const cfg = config ?? {}
  if (typeof cfg.id !== 'string' || cfg.id.length === 0) {
    throw new Error('scheduled-jobs row requires config.id (the row id is not passed to the plugin)')
  }
  if (typeof cfg.schedule !== 'string' || cfg.schedule.length === 0) {
    throw new Error(`scheduled-jobs row ${cfg.id} requires config.schedule (5-field cron)`)
  }
  if (typeof cfg.command !== 'string' || cfg.command.length === 0) {
    throw new Error(`scheduled-jobs row ${cfg.id} requires config.command`)
  }

  const job = {
    id: cfg.id,
    ctx,
    config: cfg,
    paused: false,
    running: false,
    lastRun: undefined,
    nextRun: computeNext(cfg.schedule),
  }
  // Replace any same-id job from an earlier generation; the stale disposer
  // below only deletes if the registry still holds THIS job object.
  jobs.set(job.id, job)
  ctx.effect(() => () => {
    if (jobs.get(job.id) === job) jobs.delete(job.id)
  })

  // Tools once per standing mount (per-layer uniqueness; other generations
  // register on their own layers, which is safe).
  if (toolsOwner !== ctx) {
    registerTools(ctx)
    toolsOwner = ctx
  }

  // One tick timer per standing mount; the first row's tickSeconds wins.
  if (!timers.has(ctx)) {
    const tickMs = Number.isFinite(cfg.tickSeconds) && cfg.tickSeconds > 0
      ? cfg.tickSeconds * 1000
      : DEFAULT_TICK_MS
    const timer = setInterval(() => tick(ctx), tickMs)
    timers.set(ctx, timer)
    ctx.effect(() => () => {
      clearInterval(timer)
      timers.delete(ctx)
    })
  }

  if (cfg.runOnMount) runJob(job).catch(err => { job.lastRun = { at: new Date().toISOString(), ok: false, error: String(err?.message ?? err) } })
}
