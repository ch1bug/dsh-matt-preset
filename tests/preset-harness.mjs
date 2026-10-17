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

/**
 * The `@deepseek-ai` package table the harness resolves rows against — that is
 * **this harness's own dependency table**, populated by
 * `scripts/link-runtime-deps.mjs` (per-package absolute junctions into the runtime).
 *
 * #88：旧实现从 loader 入口上溯三级（`realpath(loaderEntry + '/../../..')`），那**依赖安装布局**：
 * 旧锚是扁平安装，上溯正好落在 `<root>/node_modules/@deepseek-ai`；pnpm workspace 布局下
 * loader 包的真实路径在 `<src>/vendor/*`，上溯得到 `<src>/vendor`——**那里没有包表**，于是所有
 * 包名行 import 失败、注册表逐行报 `never started`（12/12 挂载型用例红，2026-10-17 实测）。
 * 直接用挂具自己的表，它同时满足两个用途：① `ctx.baseUrl` 的 node_modules 上溯能找到
 * `@deepseek-ai/*`；② `verify-production` 直接读 `RUNTIME/dsh-web-app/presets/*.patch.yml`。
 */
export const RUNTIME = await realpath(fileURLToPath(new URL('./node_modules/@deepseek-ai', import.meta.url)))
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
  // 0.2.1（#89）：本包改为函数插件——命名导出 `name`/`Config`/`apply`，**无默认导出**
  // （见 docs/upgrade-guide/v0.2.1-alpha.1/jsonl-persistence-plugin/guide.md）。
  // 旧写法 `const { default: X } = await import(…)` 在新版拿到 undefined，
  // dataRoot 分支会在 ctx.plugin(undefined) 抛错。直接传模块命名空间即合法挂载（上游迁移指南逐字如此）。
  const JsonlSessionPersistence = await import('@deepseek-ai/dsh-session-persistence-jsonl')
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
 * Rewrite preset-local plugin names into absolute file:// URLs.
 *
 * `pkgDir` is the CHECKOUT directory itself (the repo root) and `pkgName` the
 * package name production spells those rows with (`dsh-matt-preset/x.mjs`, the
 * installed bundle dir): the prefix is STRIPPED and the rest resolved inside
 * `pkgDir`. A relative row without the prefix still resolves against `pkgDir` —
 * the helper stays general, it just no longer assumes the checkout's basename
 * equals the package name. Loader builtins (`cordis:*`) and package names
 * (`@deepseek-ai/…`) pass through.
 *
 * Why the base is the package dir and not its parent (measured 2026-10-17):
 * resolving `pkgName/x.mjs` against `<repo>/..` made the checkout directory
 * name load-bearing — a renamed clone, a `git worktree` or an msys2 `<name>-src`
 * copy rewrote to a nonexistent sibling path and the loader blamed the plugin
 * rows (`… never started`). Pinned by `tests/verify-harness-paths.mjs`.
 */
export function resolveLocalNames(nodes, pkgDir, pkgName = 'dsh-matt-preset') {
  const pkgUrl = pathToFileURL(pkgDir).href + '/'
  const walk = (rows) => rows?.map((row) => {
    const name = row?.name
    if (typeof name !== 'string' || name.startsWith('@') || name.startsWith('cordis:') || name.includes('://')) return row
    const rel = name.startsWith(`${pkgName}/`) ? name.slice(pkgName.length + 1) : name
    return { ...row, name: new URL(rel, pkgUrl).href }
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
 * Inert service stub for mount-level harnesses: own props pass through,
 * anything else reads as a no-op function (rows calling
 * `ctx.<name>.register(…)` survive). Exported because a test sometimes must
 * PRE-SEED a stub before ensurePresetMountable stubs the rest (e.g. the PTC
 * shape, whose own row provides ptcRuntime — letting the stub round claim it
 * first makes the real provider's registration conflict); a second copy of
 * this shape would drift from the harness silently.
 */
export function inertService() {
  return new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}) })
}

/**
 * 组合内**自己提供**的服务名：绝不能被 inert stub 抢注。
 *
 * #88/#89：新注册表的 audit 会把「兄弟行还没起来」的等待报成 `waiting for <名>`，于是
 * 盲补循环会给 `workflowEngine` 打 inert stub——随后真 provider（`dsh-workflow-ptc`）注册时
 * 报 `service "workflowEngine" has been registered at <root>`，整棵子树挂不上
 * （`verify-workflow-profiles-2.mjs` 的 PTC 形状实测，2026-10-17）。
 * 清单与服务提供者来自 [docs/dsh-runtime-cheatsheet.md](../docs/dsh-runtime-cheatsheet.md)
 * 「挂载级测试的 stub 配方」：`dsh-ptc-runtime-node` 提供 `ptcRuntime`，`dsh-workflow-ptc`
 * 提供 `workflowEngine`。
 */
const SELF_PROVIDED = new Set(['workflowEngine', 'ptcRuntime'])

/**
 * Pre-flight a full-preset mount: the 0.2.0-rc registry refuses to mount a
 * preset whose rows still wait for Host services (old runtime tolerated
 * pending injects). The mount-level harness cannot supply the real host
 * stack (subagents, workflowEngine, sandboxPolicy, ptcRuntime, …), so stub
 * each still-missing service name with an inert object until the registry
 * audit is clean — **except** the services a row in this composition itself
 * provides (SELF_PROVIDED): stubbing one of those makes the real provider's
 * registration collide.
 * Rows that then fail activation surface as real errors.
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
      if (SELF_PROVIDED.has(name)) continue
      if (ctx.get(name) === undefined) {
        ctx.provide(name, inertService())
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
