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
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { bootHarness, parsePlugins, resolveLocalNames } from './preset-harness.mjs'

// Repo-relative: tests/verify.mjs -> the repo root, which IS the matt preset directory.
const MATT_DIR = fileURLToPath(new URL('..', import.meta.url))
// The root that CONTAINS the repo: preset-local plugin names resolve under it.
const PRESET_ROOT = fileURLToPath(new URL('../..', import.meta.url))
// Custom preset-owned rows only: a full-matt mount failure must never blame
// these. Shipped rows (tool-bash, str-replace-editor, …) fail on
// harness-missing host services and are expected.
const MY_ROWS = ['handoff-tool', 'workflow-enforcer']

const results = []
const ok = (name, detail = '') => { results.push(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`) }
const bad = (name, detail = '') => { results.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }

// `dataRoot` mounts the production storage/workspace stack isolated under a
// temp dir (mirrors cordis.patch.yml rows: storage, storage-json,
// storage-domain, session-persistence-jsonl, workspace).
const harness = (presets, dataRoot) => bootHarness(presets, dataRoot)

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
  const smokePlugins = [{ id: 'handoff-tool', name: pathToFileURL(join(MATT_DIR, 'handoff-tool.mjs')).href }]
  const ctxA = await harness([
    { id: 'mattsmoke', plugins: smokePlugins },
  ])
  results.push('harness A booted (smoke root)')

  try {
    const resolved = await ctxA.agentPresets.resolve('mattsmoke')
    if (resolved.broken === undefined) ok('A. mattsmoke activates clean (registry resolve)')
    else throw new Error(resolved.broken)
  } catch (error) {
    bad('A. mattsmoke activation', String(error?.message ?? error))
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
      callId: ToolCallId('verify-handoff-1'),
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
    const childEvents = child.session.snapshotEvents()
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
      callId: ToolCallId('verify-handoff-2'),
      name: 'handoff_tool',
      arguments: { document: doc },
      agent: agentA,
      signal: new AbortController().signal,
    })
    if (defOut && defOut.isError === false && ctxA.sessions.list().length === beforeDef + 1) {
      const childId = ctxA.sessions.list().map(s => String(s.id)).find(id => id !== String(agentA.session.id))
      const child = ctxA.agents.get(childId)
      await new Promise(r => setTimeout(r, 500))
      const childEvents = child.session.snapshotEvents()
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
  // A3: D35 dual-rule boundary + D37 per-hop scope (merged 2026-08-31).
  // The boundary is static and tool-guaranteed: it must carry BOTH rules
  // (定向交接 declares start / 候选交接 asks) and the D37 scope sentence;
  // a document WITH the 「## 本会话任务（human 已定向）」 marker must pass
  // through to the child untouched.
  {
    const idsBeforeP = new Set(ctxA.sessions.list().map(s => String(s.id)))
    const assignedDoc = doc + '\n\n## 本会话任务（human 已定向）\n\n- verify-ticket-A3'
    const pOut = await ctxA.tools.execute({
      callId: ToolCallId('verify-handoff-3'),
      name: 'handoff_tool',
      arguments: { document: assignedDoc, skill: 'implement' },
      agent: agentA,
      signal: new AbortController().signal,
    })
    const newIdP = ctxA.sessions.list().map(s => String(s.id)).find(id => !idsBeforeP.has(id))
    if (pOut && pOut.isError === false && newIdP !== undefined) {
      const childP = ctxA.agents.get(newIdP)
      await new Promise(r => setTimeout(r, 500))
      const firstUserP = childP.session.snapshotEvents().find(ev => ev.type === 'user/message')
      const pText = Array.isArray(firstUserP?.data?.content) ? firstUserP.data.content.map(p => p?.text ?? '').join('') : ''
      const idxP = pText.indexOf('交接边界')
      const dualRule = pText.includes('定向交接') && pText.includes('声明开工') && pText.includes('候选交接') && pText.includes('不得自动开工')
      const scoped = pText.includes('仅限定向节所指派的当前票') && pText.includes('TICKET EXIT')
      const markerPassed = pText.includes('## 本会话任务（human 已定向）')
      const skillPinned = pText.includes('/implement')
      if (dualRule && scoped && markerPassed && skillPinned) {
        ok('A3. boundary carries D35 dual rules + D37 per-hop scope; 定向 marker passes through; /implement pinned', JSON.stringify(pText.slice(idxP, idxP + 120)))
      } else {
        bad('A3. D35/D37 boundary', JSON.stringify({ dualRule, scoped, markerPassed, skillPinned, sample: pText.slice(idxP, idxP + 240) }))
      }
    } else {
      bad('A3. D35/D37 boundary', pOut ? `isError=${pOut.isError} err=${JSON.stringify(pOut.error)?.slice(0, 400)} newId=${newIdP}` : 'no result')
    }
  }
  await handleA.dispose()

  // ── Track B: full matt preset — failures must never name my rows ───────
  const ctxB = await harness([
    { id: 'dsh-matt-preset', plugins: resolveLocalNames(parsePlugins(
      await readFile(join(MATT_DIR, 'agent.cordis.yml'), 'utf8'),
      pathToFileURL(MATT_DIR).href + '/',
    ), PRESET_ROOT) },
  ])
  results.push('harness B booted (full matt declaration)')
  const listed = await ctxB.agentPresets.list()
  const matt = listed.find(p => p.id === 'dsh-matt-preset')
  if (!matt) bad('B. roster lists dsh-matt-preset', 'not found')
  else if (matt.broken === undefined) ok('B. roster lists dsh-matt-preset (activates clean)')
  else if (matt.broken.split('\n').every(l => /: waiting for /.test(l))) ok('B. roster lists dsh-matt-preset', `harness-missing services only: ${matt.broken.split('\n')[0]}…`)
  else bad('B. roster lists dsh-matt-preset', matt.broken)
  {
    const resolved = await ctxB.agentPresets.resolve('dsh-matt-preset')
    if (resolved.broken === undefined) {
      // If this ever succeeds, the harness is complete enough — great.
      ok('B. dsh-matt-preset activates clean in harness')
    } else {
      const message = resolved.broken
      const blamed = MY_ROWS.filter(row => message.includes(row))
      if (blamed.length === 0) {
        ok('B. full-matt failure names only harness-missing host services', `rows blamed: none of ${MY_ROWS.join('/')}`)
      } else {
        bad('B. full-matt failure blames added rows', blamed.join(', '))
        bad('B. full message', message.slice(0, 800))
      }
    }
  }

  // ── Track D: handoff children must land in the sidebar account ──────────
  // The GUI's session.create attaches the session to its workspace; the bare
  // agents.create() factory does not, so the preset plugin must attach
  // itself. Boot the production storage/workspace stack over a temp root
  // and assert the workspace's sessionIds account gains the child.
  const rootD = await mkdtemp(join(tmpdir(), 'dsh-matt-ws-'))
  const wsDir = join(rootD, 'workdir')
  await mkdir(wsDir)
  const ctxD = await harness([{ id: 'preset', plugins: [{ id: 'handoff-tool', name: pathToFileURL(join(MATT_DIR, 'handoff-tool.mjs')).href }] }], join(rootD, 'data'))
  results.push('harness D booted (workspace stack)')

  const workspace = await ctxD.workspaceRegistry.create(wsDir)
  ok('D. workspace registered', `${workspace.title} @ ${workspace.path}`)
  const handleD = await agentOn(ctxD, 'verify-ws-a', 'preset', wsDir)
  const agentD = handleD.agent

  // handoff_tool child attaches
  const beforeHD = ctxD.workspaceRegistry.list()[0].sessionIds.length
  const handoffOut = await ctxD.tools.execute({
    callId: ToolCallId('verify-ws-handoff'),
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
