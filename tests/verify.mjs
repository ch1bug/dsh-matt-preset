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
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { bootHarness, parsePlugins, resolveLocalNames } from './preset-harness.mjs'
import { childStarted, waitForFirstTurn, CREDENTIAL_FORMATS } from '../handoff-tool.mjs'

// Repo-relative: tests/verify.mjs -> the repo root, which IS the matt preset directory.
const MATT_DIR = fileURLToPath(new URL('..', import.meta.url))
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

/**
 * #77：handoff_tool 按契约把文档写到 `<TEMP>/handoff-<preset>-<stamp>.md`（它的返回文本里
 * 带着这个绝对路径）。真交接要留档，但**用例里写下的那几份只是垃圾** —— 收尾时一并清理。
 * 路径按工具契约复原（工具与本用例同进程、同一份 `tmpdir()`）：文件名就是从返回文本里
 * 抓到的那个 `handoff-*.md`，不另抄一份命名规则。
 */
const handoffDocs = []
function trackHandoffDoc(out) {
  const value = out?.value
  const text = typeof value === 'string' ? value : (value?.text ?? '')
  const m = /handoff-[\w-]+\.md/.exec(text)
  if (m !== null) handoffDocs.push(join(tmpdir(), m[0]))
}

// #77：Track D 的临时根声明在 try 外，成功与失败两条路径才能共用 try 之后的
// 统一收尾（try 内声明的话，抛错时收尾拿不到这个变量）。
let rootD
let tmpSettled = false

/**
 * #77 AC② 的进程级兜底：收尾块挂在**线性流末端**，未捕获 throw（`bootHarness` 等）
 * 会绕过它 —— 那种情况下进程非 0 退出却**不打 `tmp kept`**，正是 AC② 明文要禁的
 * 静默留场。正常收尾跑过（`tmpSettled`）或正常退出（code 0）时本钩子什么都不做。
 * 路径在**退出时**现算：`rootD` 要到 Track D 才赋值，提前取值只会拿到 undefined。
 */
process.on('exit', (code) => {
  if (tmpSettled || code === 0) return
  for (const p of [rootD, ...handoffDocs].filter((v) => v !== undefined)) console.log(`tmp kept: ${p}`)
})
try {
  // ── Track A: smoke preset = the handoff row ──────────────────────────────
  const smokePlugins = [{ id: 'handoff-tool', name: pathToFileURL(join(MATT_DIR, 'handoff-tool.mjs')).href }]
  const ctxA = await harness([
    { id: 'mattsmoke', plugins: smokePlugins },
  ])
  results.push('harness A booted (smoke root)')

  // ── C2/#36: persona carries test-scope tiering + recovery discipline ────
  // (#54: the workflow body moved to workflow-core — check the injected
  // workflow text alongside the persona intro.)
  {
    // #55: check the INJECTED body (profile-composed), not the sectioned
    // skeleton file — a check grepping raw markers could pass while the
    // composed text drifted.
    const { profileBody } = await import(pathToFileURL(join(MATT_DIR, 'workflow-core.mjs')).href)
    const [yml, body] = await Promise.all([
      readFile(join(MATT_DIR, 'agent.cordis.yml'), 'utf8'),
      profileBody('standard'),
    ])
    const flat = (yml + '\n' + body).replace(/\r\n/g, '\n').replace(/\s+/g, ' ')
    const has = s => flat.includes(s.replace(/\s+/g, ' '))
    if (has('TEST SCOPE TIERING') && has('RECOVERY DISCIPLINE') && has('not run locally') && has('per-issue done still = local verification + code-review'))
      ok('A0. persona/workflow carries TEST SCOPE TIERING + RECOVERY DISCIPLINE (no-conflict clause intact)')
    else
      bad('A0. persona tiering/recovery sections', 'missing TEST SCOPE TIERING / RECOVERY DISCIPLINE / not-run declaration / no-conflict clause')
  }

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
  // #168: the artifact manifest is machine-filled — declare one real artifact
  // (absolute path, cwd-independent) and compare the tool's sha256 against a
  // digest the test computes independently.
  const artifactAbs = join(MATT_DIR, 'package.json')
  const artifactSha = createHash('sha256').update(readFileSync(artifactAbs)).digest('hex')
  let out
  try {
    out = await ctxA.tools.execute({
      callId: ToolCallId('verify-handoff-1'),
      name: 'handoff_tool',
      arguments: { document: doc, mode: 'fresh', artifacts: [artifactAbs] },
      agent: agentA,
      signal: new AbortController().signal,
    })
  } catch (error) {
    bad('A. handoff_tool.execute', String(error?.message ?? error))
    out = undefined
  }
  const afterH = ctxA.sessions.list().length
  trackHandoffDoc(out)
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
      // #168：产物清单 = 有声明才生成整节、sha256 由 tool 对声明 path 现算——这里声明的
      // 绝对路径产物，哈希与测试独立现算的摘要逐字对照（占位行字面的绝迹由
      // tests/verify-handoff-tool.mjs T4 钉）。
      if (text.includes('产物清单') && text.includes(`sha256:${artifactSha}`)) {
        ok('A. handoff manifest carries the tool-computed sha256 of the declared artifact (#168)', artifactSha.slice(0, 12) + '…')
      } else {
        bad('A. handoff artifact manifest (#168)', `产物清单 / tool-computed sha256 missing (expected ${artifactSha.slice(0, 12)}…)`)
      }
      // #168：快照节由 tool 机械填——值行要么探针实值、要么「探针失败：<原因>」响亮标记，
      // 唯独不允许空壳（带标签的空值行）。探针实值语义的对照（受控夹具仓）在
      // tests/verify-handoff-tool.mjs T2；D26 的「环境结论带 `命令 → 输出`」规则随旧模板
      // 空值行拆除，权威落点 = document 参数说明 + workflow-body 写法规约（#168）。
      {
        const snapStart = text.indexOf('## 环境快照')
        const snapEnd = snapStart < 0 ? -1 : text.indexOf('\n## ', snapStart)
        const snapshot = snapStart < 0 ? '' : text.slice(snapStart, snapEnd < 0 ? text.length : snapEnd)
        const shells = snapshot.split('\n').filter((l) => /^- [^:]+:\s*$/.test(l))
        const valueOf = (label) => snapshot.split('\n').find((l) => l.startsWith(label))
        const valuesFilled = snapshot !== '' && shells.length === 0
          && ['- 分支/HEAD: ', '- 工作树: '].every((label) => {
            const line = valueOf(label)
            return line !== undefined && line.slice(label.length).trim().length > 0
          })
        if (valuesFilled) {
          ok('A. snapshot section is machine-filled (#168): value lines non-empty (probe value or loud 探针失败)', (valueOf('- 分支/HEAD: ') ?? '').slice(0, 80))
        } else {
          bad('A. snapshot section machine-filled (#168)', JSON.stringify({ snapshot, shells }))
        }
      }
      // #133 的快照「下一步」指针行已随旧模板拆除（快照节只剩 tool 机械保证的探针行，
      // 快照段不再复述边界契约）；候选判据契约的正典 = 交接边界行，由下一条断言钉住。
      // #133（K 批 6 票「疑似已完成」0 张真完成的反例）：候选/待办清单必须
      // 带判据 + 读数，判不了的标「未核」——这句契约在工具拼的交接边界里，
      // 删掉它本断言红。同样行锚定（D2：快照指针行也有「判据 + 读数」「未核」，
      // 全文级子串会互相兜底）。
      if (/^- 候选 \/ 待办清单[^\n]*判据 \+ 读数[^\n]*未核/m.test(text)) {
        ok('A. handoff boundary requires 判据+读数 / 未核 on candidate lists (#133)')
      } else {
        bad('A. handoff boundary candidate-criteria rule (#133)', '候选 / 待办清单 判据+读数/未核 contract missing from boundary section')
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
    // #168 同批修正：此前用「第一个非父会话 id」找子会话——前一次调用已留下子会话，
    // find 会拿到别人的 child（旧断言只数 userMsgs 恰好不炸；新断言读文档文本就串台了）。
    // 改照 A3 形态：调用前拍 id 集，取本次调用新增的那个。
    const idsBeforeDef = new Set(ctxA.sessions.list().map(s => String(s.id)))
    const defOut = await ctxA.tools.execute({
      callId: ToolCallId('verify-handoff-2'),
      name: 'handoff_tool',
      arguments: { document: doc },
      agent: agentA,
      signal: new AbortController().signal,
    })
    trackHandoffDoc(defOut)
    if (defOut && defOut.isError === false && ctxA.sessions.list().length === beforeDef + 1) {
      const childId = ctxA.sessions.list().map(s => String(s.id)).find(id => !idsBeforeDef.has(id))
      const child = ctxA.agents.get(childId)
      await new Promise(r => setTimeout(r, 500))
      const childEvents = child.session.snapshotEvents()
      const userMsgs = childEvents.filter(ev => ev.type === 'user/message')
      const inherited = userMsgs.filter(ev => !/Handoff/i.test(JSON.stringify(ev.data?.content ?? '')))
      // #168: this call declares NO artifacts → the 产物清单 section must be absent
      // entirely (structural omission, not a placeholder).
      const a2Text = userMsgs.map(ev => (Array.isArray(ev.data?.content) ? ev.data.content : []).map(p => p?.text ?? '').join('')).join('')
      const a2Manifest = a2Text.includes('产物清单') || a2Text.includes('sha256:')
      if (userMsgs.length === 1 && inherited.length === 0 && !a2Manifest) {
        ok('A2. default handoff mode is fresh (zero inherited history) + no artifacts → no manifest section (#168)', `events=${childEvents.length} userMsgs=${userMsgs.length}`)
      } else {
        bad('A2. default handoff mode is fresh / no manifest without artifacts (#168)', `events=${childEvents.length} userMsgs=${userMsgs.length} inherited=${inherited.length} manifest=${a2Manifest}`)
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
    const assignedDoc = doc + '\n\n## 本会话任务（human 已定向）\n\n- verify-ticket-A3\n- 凭据：#156（已落票，票 open）'
    const pOut = await ctxA.tools.execute({
      callId: ToolCallId('verify-handoff-3'),
      name: 'handoff_tool',
      arguments: { document: assignedDoc, skill: 'implement' },
      agent: agentA,
      signal: new AbortController().signal,
    })
    const newIdP = ctxA.sessions.list().map(s => String(s.id)).find(id => !idsBeforeP.has(id))
    trackHandoffDoc(pOut)
    if (pOut && pOut.isError === false && newIdP !== undefined) {
      const childP = ctxA.agents.get(newIdP)
      await new Promise(r => setTimeout(r, 500))
      const firstUserP = childP.session.snapshotEvents().find(ev => ev.type === 'user/message')
      const pText = Array.isArray(firstUserP?.data?.content) ? firstUserP.data.content.map(p => p?.text ?? '').join('') : ''
      const idxP = pText.indexOf('交接边界')
      const dualRule = pText.includes('定向交接') && pText.includes('声明开工') && pText.includes('候选交接') && pText.includes('不得自动开工')
      const scoped = pText.includes('仅限定向节所指派的当前票') && pText.includes('TICKET EXIT')
      // #156/D52：边界必须承载凭据核对规则（定向节带可核凭据行；核对不过降级候选），
      // 且父会话注承载「范围认可 ≠ 派单」。删掉对应行本断言红（非空洞）。
      const credentialed = pText.includes('凭据：批次 <宣告id>') && pText.includes('凭据：#<已落票票号>')
        && pText.includes('自动降级为候选交接')
      const ackNotDispatch = pText.includes('范围认可 ≠ 派单')
      const markerPassed = pText.includes('## 本会话任务（human 已定向）')
      const skillPinned = pText.includes('/implement')
      // #172 item1：票号凭据 → tool 在拼装前真调 gh 回读（缺省 reader，本挂具 cwd = 仓根）
      // ——产出必须含「票面回读」节：值行要么 tracker 实值、要么「回读失败：<原因>」（两态
      // 都响亮、零空壳；断言不钉 tracker 内容逐字值——那属于守卫注入面 tests/verify-handoff-tool.mjs
      // T9，钉在这里会随 tracker 内容演进把执行面打成假红）。
      {
        const tStart = pText.indexOf('## 票面回读')
        const tEnd = tStart < 0 ? -1 : pText.indexOf('\n## ', tStart)
        const ticketSection = tStart < 0 ? '' : pText.slice(tStart, tEnd < 0 ? pText.length : tEnd)
        const contentLines = ticketSection.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('<!--'))
        const allFilled = contentLines.length >= 3 && contentLines.slice(1).every((l) => /^- .+[:：]\s*\S/.test(l))
        const twoStates = (ticketSection.includes('- 标题: ') && ticketSection.includes('以本节为准') && ticketSection.includes('生成后漂移'))
          || (ticketSection.includes('- 回读失败：') && ticketSection.includes('实读'))
        if (allFilled && twoStates) {
          ok('A3b. ticket-credential handoff carries the tracker read-back section (#172): tracker values or loud 回读失败 — zero silent shells', ticketSection.split('\n').find(l => l.startsWith('- 标题') || l.startsWith('- 回读失败'))?.slice(0, 90))
        } else {
          bad('A3b. tracker read-back section (#172)', JSON.stringify({ tStart, allFilled, twoStates, sample: ticketSection.slice(0, 200) }))
        }
      }
      if (dualRule && scoped && credentialed && ackNotDispatch && markerPassed && skillPinned) {
        ok('A3. boundary carries D35 dual rules + D37 scope + #156 credential rule; 定向 marker passes through; /implement pinned', JSON.stringify(pText.slice(idxP, idxP + 120)))
      } else {
        bad('A3. D35/D37 boundary', JSON.stringify({ dualRule, scoped, credentialed, ackNotDispatch, markerPassed, skillPinned, sample: pText.slice(idxP, idxP + 240) }))
      }
    } else {
      bad('A3. D35/D37 boundary', pOut ? `isError=${pOut.isError} err=${JSON.stringify(pOut.error)?.slice(0, 400)} newId=${newIdP}` : 'no result')
    }
  }
  // A4 (#156/D52): a directed section WITHOUT a credential line must be
  // rejected LOUDLY by the tool — no child spawned, error names the fix.
  // Structural check only: the tool judges the line's PRESENCE, never
  // authorization semantics (that boundary is declared in the landing doc).
  {
    const beforeNoCred = ctxA.sessions.list().length
    const noCredDoc = doc + '\n\n## 本会话任务（human 已定向）\n\n- verify-ticket-A4（无凭据行）'
    let noCredError = ''
    let noCredOut
    try {
      noCredOut = await ctxA.tools.execute({
        callId: ToolCallId('verify-handoff-4'),
        name: 'handoff_tool',
        arguments: { document: noCredDoc, skill: 'implement' },
        agent: agentA,
        signal: new AbortController().signal,
      })
      noCredError = String(noCredOut?.error?.message ?? noCredOut?.error ?? '')
    } catch (error) {
      noCredError = String(error?.message ?? error)
    }
    trackHandoffDoc(noCredOut)
    const spawned = ctxA.sessions.list().length > beforeNoCred
    if (!spawned && /凭据/.test(noCredError)) {
      ok('A4. directed handoff without credential line rejected loudly, no child spawned (#156)', noCredError.slice(0, 80))
    } else {
      bad('A4. directed handoff without credential line (#156)', `spawned=${spawned} err=${noCredError.slice(0, 200) || '(none)'}`)
    }
  }
  // A5 (#156 复审③): the credential line must live INSIDE the directed
  // section — one placed in the doc body (before the marker) does not count:
  // directedSection extraction cuts from the marker to the next heading, so
  // this input must be rejected exactly like A4.
  {
    const beforeA5 = ctxA.sessions.list().length
    const outsideDoc = doc + '\n\n- 凭据：#156（写错位置：在定向节之外）\n\n## 本会话任务（human 已定向）\n\n- verify-ticket-A5'
    let a5Error = ''
    let a5Out
    try {
      a5Out = await ctxA.tools.execute({
        callId: ToolCallId('verify-handoff-5'),
        name: 'handoff_tool',
        arguments: { document: outsideDoc, skill: 'implement' },
        agent: agentA,
        signal: new AbortController().signal,
      })
      a5Error = String(a5Out?.error?.message ?? a5Out?.error ?? '')
    } catch (error) {
      a5Error = String(error?.message ?? error)
    }
    trackHandoffDoc(a5Out)
    const spawnedA5 = ctxA.sessions.list().length > beforeA5
    if (!spawnedA5 && /凭据/.test(a5Error)) {
      ok('A5. credential line outside the directed section does not count (#156)', a5Error.slice(0, 80))
    } else {
      bad('A5. credential line outside the directed section (#156)', `spawned=${spawnedA5} err=${a5Error.slice(0, 200) || '(none)'}`)
    }
  }
  await handleA.dispose()

  // ── Track B: full matt preset — failures must never name my rows ───────
  const ctxB = await harness([
    { id: 'dsh-matt-preset', plugins: resolveLocalNames(parsePlugins(
      await readFile(join(MATT_DIR, 'agent.cordis.yml'), 'utf8'),
      pathToFileURL(MATT_DIR).href + '/',
    ), MATT_DIR) },
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
  rootD = await mkdtemp(join(tmpdir(), 'dsh-matt-ws-'))
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
  trackHandoffDoc(handoffOut)
  const accounted = ctxD.workspaceRegistry.list()[0].sessionIds.map(String)
  const newIdD = ctxD.sessions.list().map(s => String(s.id)).find(id => id !== String(agentD.session.id))
  if (handoffOut.isError === false && afterHD === beforeHD + 1 && accounted.includes(newIdD)) {
    ok('D. handoff_tool child attached to workspace', newIdD)
  } else {
    bad('D. handoff_tool child attach', `isError=${handoffOut.isError} ${beforeHD} -> ${afterHD} accounted=${accounted.join(',') || '(none)'}`)
  }

  await handleD.dispose()
  // The handoff child is a separate producer: disposing the parent does not
  // join its turn or its buffered JSONL writes. Stop producing, then drain
  // persistence before cleanup may remove the borrowed root (#154).
  await ctxD.agents.get(newIdD).whenIdle()
  await ctxD.sessionPersistence.flush()
} catch (error) {
  bad('harness run', String(error?.stack ?? error))
}

// ── Track E: first-turn verification helpers (#44, 2026-10-11 IRIS stall) ──
// A healthy child shows turn/start; a stalled one (driver wake lost) shows
// only the session header — waitForFirstTurn must time out and childStarted
// must stay false.
try {
  const fakeStarted = []
  const fakeHandle = (events) => ({ agent: { session: { snapshotEvents: () => events } } })
  const started = { type: 'turn/start', seq: 2 }
  if (childStarted(fakeHandle([started]))) ok('E. childStarted true on turn/start')
  else bad('E. childStarted true on turn/start')
  if (!childStarted(fakeHandle([{ type: 'session', seq: 1 }]))) ok('E. childStarted false on header-only (stall shape 0fee327b)')
  else bad('E. childStarted false on header-only')
  // timeoutMs=0 → single check against the (empty) live events → stall path.
  if ((await waitForFirstTurn(fakeHandle([]), 0)) === false) ok('E. waitForFirstTurn times out on stall (timeoutMs=0)')
  else bad('E. waitForFirstTurn times out on stall')
  // A turn appearing after a later poll flips the verdict (healthy path).
  setTimeout(() => fakeStarted.push(started), 100)
  const polling = { agent: { session: { snapshotEvents: () => fakeStarted } } }
  if (await waitForFirstTurn(polling, 2000)) ok('E. waitForFirstTurn true once turn appears')
  else bad('E. waitForFirstTurn true once turn appears')
} catch (error) {
  bad('track E', String(error?.stack ?? error))
}

// ── Track F: 凭据格式正典同源守卫（#162/D52）────────────────────────────────
// workflow-body.txt 是散文，无法 import handoff-tool.mjs 的正典导出 —— 这里以
// 「读文件 + 字面对照」代替。判据 = **逐字面的副本计数**（#128 口径：副本数量
// 本身是判据的一部分，文件级 includes 只钉一半 —— 同一字面两处承载、漂移其一
// 时另一处会兜底成假绿）。字面取自正典对象本身，不手写副本（#129 教训）。
// 非空洞（brief §3.1）：探针敲掉**一个**副本（只 replace 首次出现），同一判据
// 必须翻红 —— 单处漂移探不出来，说明守卫空转，本项自己红。
try {
  const bodyF = readFileSync(join(MATT_DIR, 'workflow-body.txt'), 'utf8').replace(/\r\n/g, '\n')
  const countF = (text, lit) => text.split(lit).length - 1
  // 每个字面的承载副本清单（现文三处：batch-mode 段、父端段、child 段——
  // 增删副本时这里同步改计数，改漏 = 本项红，正是守卫要拦的漂移）。
  const canonicalF = [
    { lit: CREDENTIAL_FORMATS.batch, copies: 3, where: 'batch-mode 段 + 父端段 + child 段' },
    { lit: CREDENTIAL_FORMATS.ticket, copies: 2, where: '父端段 + child 段' },
  ]
  const driftedF = canonicalF.filter(({ lit, copies }) => countF(bodyF, lit) !== copies)
  if (driftedF.length === 0) {
    ok('F. workflow-body credential literals match handoff-tool canonical exports, per-copy (#162)', canonicalF.map(({ lit, copies }) => `${lit} x${copies}`).join(' / '))
  } else {
    bad('F. workflow-body credential literal copy-count drift (#162)', driftedF.map(({ lit, copies }) => `"${lit}" expected x${copies}, found x${countF(bodyF, lit)}`).join(' | '))
  }
  // 非空洞对照：敲掉批次字面的**首个**副本（模拟单处漂移）→ 主判据必须红。
  const knockedF = bodyF.replace(CREDENTIAL_FORMATS.batch, '')
  const driftKnockedF = canonicalF.filter(({ lit, copies }) => countF(knockedF, lit) !== copies)
  if (driftKnockedF.length > 0) {
    ok('F. non-hollow: knocking out ONE copy of the batch literal flips the same check red (#162)')
  } else {
    bad('F. non-hollow probe (#162)', 'single-copy drift still passes the copy-count check — guard would not fire')
  }
} catch (error) {
  bad('track F', String(error?.stack ?? error))
}

console.log('\n=== VERIFY RESULTS ===')
console.log(results.join('\n'))
// ── #77 临时条目收尾：成功清除，失败保留现场并响亮打印绝对路径 ─────────────
// 判据与下面的退出码同源（同一个 results 扫描），保证「非 0 退出」与「现场还在」永远一致。
// 条目 = Track D 的临时根 + 本用例触发的 handoff_tool 写下的那几份 `handoff-*.md`
// （工具的契约是把文档写进 OS 临时目录 —— 真交接要留档，测试触发的那几份只是垃圾）。
// 必须放在 Track D 的生产者空闲与持久化屏障之后（#154）：仅 dispose 父agent
// 不会等待另一个子会话的延迟写；未join就rm会与落地交错，甚至抛ENOTEMPTY。
// `tmpSettled` 让上面那个进程级兜底不再重复打印。
tmpSettled = true
const verdictFail = results.some(r => r.startsWith('  ✗'))
const tmpPaths = [rootD, ...handoffDocs].filter((p) => p !== undefined)
if (verdictFail) {
  for (const p of tmpPaths) console.log(`tmp kept: ${p}`)
} else {
  for (const p of tmpPaths) await rm(p, { recursive: true, force: true })
}
process.exit(verdictFail ? 1 : 0)
