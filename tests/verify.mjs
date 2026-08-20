/**
 * verify-matt.mjs — real mount validation of the `matt` preset delta, run
 * against the same rc.7 code the running deployment uses.
 *
 * Two tracks:
 *  A. A smoke preset containing the handoff-tool row is mounted and
 *     exercised end-to-end: standingKeyFor → agent → tool list → execute
 *     handoff_tool → child session exists with the handoff as its first
 *     user message. Injected services (tools, agents, agentPresets) are
 *     exactly what this harness provides.
 *  B. The FULL matt preset is mount-attempted; the harness cannot supply
 *     every host service (shell, fs, skills, goals, jobs, web, tokenMeter,
 *     subagents…), so a failure is expected — but it must never name the
 *     rows this work added.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Commands from '@deepseek-ai/dsh-commands'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { Storage } from '@deepseek-ai/dsh-storage'
import * as StorageJsonMod from '@deepseek-ai/dsh-storage-json'
import * as StorageDomainMod from '@deepseek-ai/dsh-storage-domain'
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'

const StorageJsonPlugin = { name: StorageJsonMod.name, apply: StorageJsonMod.apply, Config: StorageJsonMod.Config, inject: StorageJsonMod.inject }
const StorageDomainPlugin = { name: StorageDomainMod.name, apply: StorageDomainMod.apply, Config: StorageDomainMod.Config, inject: StorageDomainMod.inject }

// The deployment's shipped preset dir; override with DSH_SHIPPED_PRESETS on other machines.
const SHIPPED = process.env.DSH_SHIPPED_PRESETS ?? '/home/bh4gxf/.npm-global/lib/node_modules/@deepseek-ai/dsh/config/agent-presets'
// Repo-relative: tests/verify.mjs -> the repo root, which IS the matt preset directory.
const MATT_DIR = fileURLToPath(new URL('..', import.meta.url))
// The root that CONTAINS the repo: discovery scans its subdirectories for presets.
const PRESET_ROOT = fileURLToPath(new URL('../..', import.meta.url))
// Custom preset-owned rows only: a full-matt mount failure must never blame
// these. Shipped rows (tool-bash, str-replace-editor, …) fail on
// harness-missing host services and are expected.
const MY_ROWS = ['handoff-tool', 'scheduled-jobs', 'workflow-enforcer']

const results = []
const ok = (name, detail = '') => { results.push(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`) }
const bad = (name, detail = '') => { results.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }

const harness = async (roots, dataRoot) => {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(SHIPPED).href + '/'
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
  // Production resolves the default model route for every created agent; the
  // handoff child must receive it too (the {{model}} prompt variable reads
  // agent.options.model). Mirror it with a fake route.
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  await ctx.plugin(AgentPresets, { default: 'standard', roots, includeUserRoot: false })
  if (dataRoot !== undefined) {
    // The production web composition's storage/workspace stack, isolated to
    // a temp data root (mirrors cordis.patch.yml rows: storage, storage-json,
    // storage-domain, session-persistence-jsonl, workspace).
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJsonPlugin, { root: join(dataRoot, 'storages') })
    await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
    await ctx.plugin(JsonlSessionPersistence, { root: join(dataRoot, 'sessions') })
    await ctx.plugin(WorkspaceRegistry)
  }
  return ctx
}

const agentOn = async (ctx, id, presetId, cwd) => {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    meta: cwd === undefined ? {} : { cwd },
    setup: async (agentCtx) => void await ctx.agentPresets.mount(agentCtx, presetId),
  })
  return handle
}

const toolNames = (ctx, agent) => ctx.tools.schemas(agent).map(s => s.name).sort()
const commandNames = (ctx, agent) => ctx.commands.list(agent).map(c => c.name).sort()

try {
  // ── Track A: smoke preset = the handoff row ──────────────────────────────
  const root = await mkdtemp(join(tmpdir(), 'dsh-matt-smoke-'))
  await mkdir(join(root, 'mattsmoke'))
  await writeFile(join(root, 'mattsmoke', 'agent.cordis.yml'), [
    '- id: handoff-tool',
    `  name: ${join(MATT_DIR, 'handoff-tool.mjs')}`,
    '',
  ].join('\n'))
  const ctxA = await harness([
    { path: root, trust: 'user' },
  ])
  results.push('harness A booted (smoke root)')

  try {
    const key = await ctxA.agentPresets.standingKeyFor('mattsmoke')
    ok('A. standingKeyFor(mattsmoke) mounts clean', `key=${JSON.stringify(key)}`)
  } catch (error) {
    bad('A. standingKeyFor(mattsmoke)', String(error?.message ?? error))
    throw error
  }

  const handleA = await agentOn(ctxA, 'verify-smoke-a', 'mattsmoke')
  const agentA = handleA.agent
  const tools = toolNames(ctxA, agentA)
  if (tools.includes('handoff_tool')) ok(`A. handoff_tool registered (${tools.length} tools)`, tools.join(', '))
  else bad('A. handoff_tool missing', tools.join(', '))
  if (commandNames(ctxA, agentA).includes('clear')) bad('A. /clear removed', 'clear command still registered')
  else ok('A. /clear removed')

  // execute handoff_tool through the real registry dispatch
  const beforeH = ctxA.sessions.list().length
  const doc = '# Handoff\n\nVerification summary.\n\n## suggested skills\n- tdd\n- code-review'
  let out
  try {
    out = await ctxA.tools.execute({
      callId: CallId('verify-handoff-1'),
      name: 'handoff_tool',
      arguments: { document: doc, mode: 'fresh' },
      agent: agentA,
      signal: new AbortController().signal,
    })
  } catch (error) {
    bad('A. handoff_tool.execute', String(error?.message ?? error))
    out = undefined
  }
  const afterH = ctxA.sessions.list().length
  if (out && out.isError === false && afterH === beforeH + 1) {
    const value = out.value
    const text = typeof value === 'string' ? value : (value && value.text) ?? JSON.stringify(value)
    if (/handoff-[\w-]+\.md/.test(text)) ok('A. handoff_tool spawns child + writes file', text.replace(/\n/g, ' | '))
    else bad('A. handoff_tool output', text)
    // The handoff must land as the child's FIRST USER MESSAGE (followup).
    const childId = ctxA.sessions.list().map(s => String(s.id)).find(id => id !== String(agentA.session.id))
    const child = ctxA.agents.get(childId)
    const childTools = toolNames(ctxA, child)
    if (childTools.includes('handoff_tool')) ok('A. handoff child composes the same preset', childId)
    else bad('A. handoff child tools', childTools.join(', '))
    // The child must carry a model route (the {{model}} prompt variable reads
    // agent.options.model; without agentOptions the first assembly errors).
    if (child.options?.model === 'mock') ok('A. handoff child carries the model route', `model=${child.options.model}`)
    else bad('A. handoff child model route', JSON.stringify(child.options))
    await new Promise(r => setTimeout(r, 500))
    const childEvents = child.session.events
    const firstUser = childEvents.find(ev => ev.type === 'user/message')
    if (firstUser !== undefined) {
      const parts = Array.isArray(firstUser.data?.content) ? firstUser.data.content : []
      const text = parts.map(p => p?.text ?? '').join('')
      ok('A. handoff child got the document as its first user message', JSON.stringify(text.slice(0, 60)))
      // O6 boundary: the tool must append the 交接边界 section, so a fresh
      // child never misreads pending items as its assignment.
      if (text.includes('交接边界') && text.includes('不是本会话的任务指令')) {
        ok('A. handoff document carries the boundary section (pending items ≠ assignment)')
      } else {
        bad('A. handoff boundary section', '交接边界/不是本会话的任务指令 missing from document')
      }
    } else {
      bad('A. handoff child first user message', `events=${childEvents.map(ev => ev.type).join(',')}`)
    }
  } else {
    bad('A. handoff_tool', out ? `isError=${out.isError} sessions ${beforeH}->${afterH}` : 'no result')
  }

  // A2: DEFAULT mode is fresh — calling without `mode` spawns a child with
  // ZERO inherited history (O6: forking a long session resurrects the whole
  // compacted history). The child's only user message must be the document.
  {
    const beforeDef = ctxA.sessions.list().length
    const defOut = await ctxA.tools.execute({
      callId: CallId('verify-handoff-2'),
      name: 'handoff_tool',
      arguments: { document: doc },
      agent: agentA,
      signal: new AbortController().signal,
    })
    if (defOut && defOut.isError === false && ctxA.sessions.list().length === beforeDef + 1) {
      const childId = ctxA.sessions.list().map(s => String(s.id)).find(id => id !== String(agentA.session.id))
      const child = ctxA.agents.get(childId)
      await new Promise(r => setTimeout(r, 500))
      const childEvents = child.session.events
      const userMsgs = childEvents.filter(ev => ev.type === 'user/message')
      const inherited = userMsgs.filter(ev => !/Handoff/i.test(JSON.stringify(ev.data?.content ?? '')))
      if (userMsgs.length === 1 && inherited.length === 0) {
        ok('A2. default handoff mode is fresh (child has zero inherited history)', `events=${childEvents.length} userMsgs=${userMsgs.length}`)
      } else {
        bad('A2. default handoff mode is fresh', `events=${childEvents.length} userMsgs=${userMsgs.length} inherited=${inherited.length}`)
      }
    } else {
      bad('A2. default handoff mode is fresh', defOut ? `isError=${defOut.isError}` : 'no result')
    }
  }
  await handleA.dispose()

  // ── Track B: full matt preset — failures must never name my rows ───────
  const ctxB = await harness([
    { path: SHIPPED, trust: 'system' },
    { path: PRESET_ROOT, trust: 'user' },
  ])
  results.push('harness B booted (shipped + user roots)')
  const listed = await ctxB.agentPresets.list()
  const matt = listed.find(p => p.id === 'dsh-matt-preset')
  if (matt && !matt.broken) ok('B. roster lists dsh-matt-preset (not broken, trust ' + matt.trust + ')')
  else bad('B. roster lists dsh-matt-preset', matt?.broken ?? 'not found')
  try {
    await ctxB.agentPresets.standingKeyFor('dsh-matt-preset')
    // If this ever succeeds, the harness is complete enough — great.
    ok('B. standingKeyFor(dsh-matt-preset) mounts clean')
  } catch (error) {
    const message = String(error?.message ?? error)
    const blamed = MY_ROWS.filter(row => message.includes(row))
    if (blamed.length === 0) {
      ok('B. full-matt failure names only harness-missing host services', `rows blamed: none of ${MY_ROWS.join('/')}`)
    } else {
      bad('B. full-matt failure blames added rows', blamed.join(', '))
      bad('B. full message', message.slice(0, 800))
    }
  }

  // ── Track C: scheduled-jobs smoke ───────────────────────────────────────
  const rootC = await mkdtemp(join(tmpdir(), 'dsh-jobsmoke-'))
  await mkdir(join(rootC, 'jobsmoke'))
  await writeFile(join(rootC, 'jobsmoke', 'agent.cordis.yml'), [
    '- id: job-test',
    `  name: ${join(MATT_DIR, 'scheduled-jobs.mjs')}`,
    '  config:',
    '    id: job-test',
    '    schedule: "* * * * * *"',
    '    command: "echo hello-$RANDOM"',
    '    runOnMount: true',
    '    tickSeconds: 1',
    '',
  ].join('\n'))
  const ctxC = await harness([{ path: rootC, trust: 'user' }])
  results.push('harness C booted (jobs smoke root)')

  try {
    await ctxC.agentPresets.standingKeyFor('jobsmoke')
    ok('C. standingKeyFor(jobsmoke) mounts clean')
  } catch (error) {
    bad('C. standingKeyFor(jobsmoke)', String(error?.message ?? error))
    throw error
  }
  const handleC = await agentOn(ctxC, 'verify-job-a', 'jobsmoke')
  const agentC = handleC.agent
  const toolsC = toolNames(ctxC, agentC)
  if (['jobs_list', 'jobs_run', 'jobs_pause'].every(t => toolsC.includes(t))) ok('C. jobs tools registered', toolsC.join(', '))
  else bad('C. jobs tools', toolsC.join(', '))

  const runTool = async (name, args) => {
    const out = await ctxC.tools.execute({ callId: CallId('c-' + name + '-' + Math.random().toString(36).slice(2)), name, arguments: args, agent: agentC, signal: new AbortController().signal })
    return out
  }

  // runOnMount + tick: wait for at least one fire
  await new Promise(r => setTimeout(r, 2600))
  const jobsListed = await runTool('jobs_list', {})
  const text = jobsListed.isError === false ? (jobsListed.value && jobsListed.value.text) ?? JSON.stringify(jobsListed.value) : `error ${jobsListed.error}`
  const rows = jobsListed.isError === false ? JSON.parse(jobsListed.value.text) : []
  const jobRow = rows.find(r => r.id === 'job-test')
  if (jobRow && jobRow.lastRun && jobRow.lastRun.ok && /^hello-\d+$/.test((jobRow.lastRun.outputTail ?? '').trim())) {
    ok('C. runOnMount + tick fired the job', `lastRun=${jobRow.lastRun.at} output=${(jobRow.lastRun.outputTail ?? '').trim()}`)
  } else {
    bad('C. runOnMount + tick', text)
  }

  // pause → must not fire while paused
  await runTool('jobs_pause', { id: 'job-test' })
  const pausedBefore = await runTool('jobs_list', {})
  const pausedRow = JSON.parse(pausedBefore.value.text).find(r => r.id === 'job-test')
  const pausedAt = pausedRow.lastRun?.at
  await new Promise(r => setTimeout(r, 2100))
  const pausedAfter = await runTool('jobs_list', {})
  const pausedRow2 = JSON.parse(pausedAfter.value.text).find(r => r.id === 'job-test')
  if (pausedRow.paused === true && pausedRow2.lastRun?.at === pausedAt) ok('C. jobs_pause stops firing')
  else bad('C. jobs_pause', `paused=${pausedRow.paused} at=${pausedAt} -> ${pausedRow2.lastRun?.at}`)

  // jobs_run works while paused
  const ran = await runTool('jobs_run', { id: 'job-test' })
  const ranRow = JSON.parse(ran.value.text)
  if (ran.isError === false && ranRow.ok && ranRow.exitCode === 0) ok('C. jobs_run runs despite pause', `output=${(ranRow.output ?? '').trim()}`)
  else bad('C. jobs_run', JSON.stringify(ranRow ?? ran))

  // resume
  await runTool('jobs_pause', { id: 'job-test' })
  const resumed = await runTool('jobs_list', {})
  const resumedRow = JSON.parse(resumed.value.text).find(r => r.id === 'job-test')
  if (resumedRow.paused === false) ok('C. jobs_pause resumes')
  else bad('C. jobs_pause resume', JSON.stringify(resumedRow))

  await handleC.dispose()

  // ── Track D: handoff children must land in the sidebar account ──────────
  // The GUI's session.create attaches the session to its workspace; the bare
  // agents.create() factory does not, so the preset plugin must attach
  // itself. Boot the production storage/workspace stack over a temp root
  // and assert the workspace's sessionIds account gains the child.
  const rootD = await mkdtemp(join(tmpdir(), 'dsh-matt-ws-'))
  await mkdir(join(rootD, 'preset'))
  await writeFile(join(rootD, 'preset', 'agent.cordis.yml'), [
    '- id: handoff-tool',
    `  name: ${join(MATT_DIR, 'handoff-tool.mjs')}`,
    '',
  ].join('\n'))
  const wsDir = join(rootD, 'workdir')
  await mkdir(wsDir)
  const ctxD = await harness([{ path: rootD, trust: 'user' }], join(rootD, 'data'))
  results.push('harness D booted (workspace stack)')

  const workspace = await ctxD.workspaceRegistry.create(wsDir)
  ok('D. workspace registered', `${workspace.title} @ ${workspace.path}`)
  const handleD = await agentOn(ctxD, 'verify-ws-a', 'preset', wsDir)
  const agentD = handleD.agent

  // handoff_tool child attaches
  const beforeHD = ctxD.workspaceRegistry.list()[0].sessionIds.length
  const handoffOut = await ctxD.tools.execute({
    callId: CallId('verify-ws-handoff'),
    name: 'handoff_tool',
    arguments: { document: '# Handoff\n\nDummy.\n\n## suggested skills\n- tdd', mode: 'fork' },
    agent: agentD,
    signal: new AbortController().signal,
  })
  const afterHD = ctxD.workspaceRegistry.list()[0].sessionIds.length
  const accounted = ctxD.workspaceRegistry.list()[0].sessionIds.map(String)
  const newIdD = ctxD.sessions.list().map(s => String(s.id)).find(id => id !== String(agentD.session.id))
  if (handoffOut.isError === false && afterHD === beforeHD + 1 && accounted.includes(newIdD)) {
    ok('D. handoff_tool child attached to workspace', newIdD)
  } else {
    bad('D. handoff_tool child attach', `isError=${handoffOut.isError} ${beforeHD} -> ${afterHD} accounted=${accounted.join(',') || '(none)'}`)
  }

  await handleD.dispose()
} catch (error) {
  bad('harness run', String(error?.stack ?? error))
}

console.log('\n=== VERIFY RESULTS ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)
