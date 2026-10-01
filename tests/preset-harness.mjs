/**
 * preset-harness.mjs — shared wiring for the mount-level verify tests,
 * migrated to the 0.2.0-rc runtime preset API (#9).
 *
 * Old model: `@deepseek-ai/dsh-agent-presets` scanned directory roots for
 * preset folders carrying agent.cordis.yml.
 * New model: `@deepseek-ai/dsh-agent-preset-registry` (service
 * `agentPresets`) collects definitions eagerly registered by
 * `@deepseek-ai/dsh-agent-preset` declaration rows; a declaration's
 * `plugins` list is the former agent.cordis.yml body. The registry
 * injects `loader` + `sessionProjections` (provided by
 * `@deepseek-ai/dsh-session-projection`).
 *
 * Preset activation is EAGER at registration: mount failures land in the
 * definition's diagnostic (read via `agentPresets.resolve(id).broken`),
 * they do not throw. Register presets only after the harness services.
 */
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { Context } from '@deepseek-ai/cordis'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Commands from '@deepseek-ai/dsh-commands'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

export { default as AgentPreset } from '@deepseek-ai/dsh-agent-preset'
export { default as AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
export { default as SessionProjection } from '@deepseek-ai/dsh-session-projection'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import SessionProjection from '@deepseek-ai/dsh-session-projection'

const loaderEntry = fileURLToPath(import.meta.resolve('@deepseek-ai/cordis-plugin-loader'))
/** The installed dsh runtime's @deepseek-ai package table (realpath, junction-safe). */
export const RUNTIME = await realpath(join(loaderEntry, '..', '..', '..'))
/** baseUrl for the harness Context: package-name rows resolve against it. */
export const RUNTIME_URL = pathToFileURL(RUNTIME).href + '/'
/** The repo's workflow-enforcer plugin, as a loader-resolvable file:// name. */
export const ENFORCER_PLUGIN = pathToFileURL(fileURLToPath(new URL('../workflow-enforcer.mjs', import.meta.url))).href

/**
 * Boot the shared cordis stack every mount-level verify test uses (loader +
 * runtime services + the preset registry), then register `presets` as
 * declaration rows. `dataRoot` additionally mounts the production
 * storage/workspace stack isolated under that directory.
 */
export async function bootHarness(presets = [], dataRoot) {
  const { Storage } = await import('@deepseek-ai/dsh-storage')
  const StorageJsonMod = await import('@deepseek-ai/dsh-storage-json')
  const StorageDomainMod = await import('@deepseek-ai/dsh-storage-domain')
  const { default: JsonlSessionPersistence } = await import('@deepseek-ai/dsh-session-persistence-jsonl')
  const { WorkspaceRegistry } = await import('@deepseek-ai/dsh-workspace')
  const StorageJsonPlugin = { name: StorageJsonMod.name, apply: StorageJsonMod.apply, Config: StorageJsonMod.Config, inject: StorageJsonMod.inject }
  const StorageDomainPlugin = { name: StorageDomainMod.name, apply: StorageDomainMod.apply, Config: StorageDomainMod.Config, inject: StorageDomainMod.inject }

  const ctx = new Context()
  ctx.baseUrl = RUNTIME_URL
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Commands)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  // Production resolves the default model route for every created agent;
  // the handoff child must receive it too. Mirror it with a fake route.
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(AgentPresetRegistry, { default: 'standard' })
  if (dataRoot !== undefined) {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJsonPlugin, { root: join(dataRoot, 'storages') })
    await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
    await ctx.plugin(JsonlSessionPersistence, { root: join(dataRoot, 'sessions') })
    await ctx.plugin(WorkspaceRegistry)
  }
  for (const { id, plugins } of presets) await ctx.plugin(AgentPreset, { id, plugins })
  return ctx
}

/** The two-row smoke shape shared by the enforcer/persona verify tests. */
export function smokePlugins(personaPrefix) {
  return [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: personaPrefix } },
    { id: 'workflow-enforcer', name: ENFORCER_PLUGIN },
  ]
}

/** Entry-list YAML dialect: `!!js` scalars round-trip as { __jsExpr } nodes. */
const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (str) => ({ __jsExpr: str }) }

/**
 * Parse an agent.cordis.yml body into a plugins array. `!!js` expression
 * nodes are evaluated eagerly against `baseUrl` (same dialect the runtime
 * loader interpolates at mount).
 */
export function parsePlugins(yamlText, baseUrl) {
  const tree = parse(yamlText, { customTags: [jsTag] })
  return interpolate({ baseUrl, process }, tree)
}

/**
 * Rewrite preset-local plugin names (`dsh-matt-preset/x.mjs`, resolved in
 * production against the installed bundle dir) into absolute file:// URLs
 * rooted at `rootDir` — the directory that CONTAINS the repo. Loader
 * builtins (`cordis:*`) and package names (`@deepseek-ai/…`) pass through.
 */
export function resolveLocalNames(nodes, rootDir) {
  const rootUrl = pathToFileURL(rootDir).href + '/'
  const walk = (rows) => rows?.map((row) => {
    if (typeof row?.name !== 'string' || row.name.startsWith('@') || row.name.startsWith('cordis:') || row.name.includes('://')) return row
    return { ...row, name: new URL(row.name, rootUrl).href }
  })
  return (function rewrite(rows) {
    return walk(rows)?.map((row) => {
      if (Array.isArray(row.config)) return { ...row, config: rewrite(row.config) }
      if (row?.group && Array.isArray(row.config?.entries)) return row
      return row
    })
  })(nodes)
}

/** Mark rows (by id, recursing into group configs) `disabled: true`. */
export function disableRows(rows, ids) {
  return rows.map((row) => {
    const hit = { ...row }
    if (ids.includes(row.id)) hit.disabled = true
    if (Array.isArray(row.config)) hit.config = disableRows(row.config, ids)
    return hit
  })
}

/**
 * Pre-flight a full-preset mount: the 0.2.0-rc registry refuses to mount a
 * preset whose rows still wait for Host services (old runtime tolerated
 * pending injects). The mount-level harness cannot supply the real host
 * stack (subagents, workflowEngine, sandboxPolicy, ptcRuntime, …), so stub
 * each still-missing service name with an inert object until the registry
 * audit is clean. Rows that then fail activation surface as real errors.
 */
export async function ensurePresetMountable(ctx, id, maxRounds = 6) {
  let last = ''
  for (let round = 0; round < maxRounds; round++) {
    const { broken } = await ctx.agentPresets.resolve(id)
    if (broken === undefined) return
    last = broken
    const waiting = [...broken.matchAll(/waiting for ([^\n]+)/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()))
    const stubbed = new Set()
    for (const name of waiting) {
      if (ctx.get(name) === undefined) {
        // Inert service stub: own props pass through, anything else reads as
        // a no-op function (rows calling ctx.<name>.register(...) survive).
        const stub = new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}) })
        ctx.provide(name, stub)
        stubbed.add(name)
      }
    }
    if (stubbed.size === 0) break
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`preset ${id} not mountable in harness:\n${last}`)
}

/**
 * Emit a synthetic session event. The 0.2.0-rc runtime's session-projection
 * registry eagerly drives every `session/event` and requires a monotonic
 * `seq`; hand-built events (the old tests emitted bare payloads) must now
 * carry one. Sequences continue from the session's current event count.
 */
const syntheticSeq = new WeakMap()
export function emitSessionEvent(ctx, session, event) {
  const seq = syntheticSeq.get(session) ?? session.seq
  syntheticSeq.set(session, seq + 1)
  // token-meter's projection reads assistant/message usage via data.usage or
  // the raw data.stream chunks; bare synthetic settlements must carry an
  // empty stream so the eager drive does not crash.
  if (event.type === 'assistant/message' && event.data?.usage === undefined && event.data?.stream === undefined) {
    event = { ...event, data: { ...event.data, stream: [] } }
  }
  ctx.emit('session/event', session, { seq, ...event })
}
