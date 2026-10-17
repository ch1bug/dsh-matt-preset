/**
 * verify-workflow-core-render.mjs —— #54 真实 preset 渲染面验证（套件成员）。
 *
 * 与 verify-workflow-core.mjs（合成 preset，逐项 AC）互补：这里挂**仓库自身的
 * 生产 composition**（agent.cordis.yml 的真实 persona 前缀 + 真实
 * workflow-core.mjs + 真实 workflow-body.txt），渲染系统提示词，确认模型实际
 * 看到的面成立：
 *   R1. persona 前缀不含工作流正文（导语量级 450 chars，无 MAIN FLOW）；
 *   R2. 渲染结果含 workflow:core 注入节，正文完整（5 个标志段）；
 *   R3. {{model}}/{{cwd}} 已插值、无字面残留；
 *   R4. L1 等价：真实 composition 渲染 == persona 承载版（fixture 基线，于 #85 重取）渲染；
 *   R5. 离线挂载契约：composition 里存在 workflow-core 行，且用 package
 *       subpath 形式寻址（不得写成 profile 目录相对的 ./ 路径——enforcer 行
 *       注释记录的同款陷阱）。
 *   R6. #55：挂载显式声明 profile: standard（不靠插件默认值隐式选档）。
 *
 * 可移植：全部路径由 import.meta.url 推导，无绝对路径假设，可在纯源码检出下跑。
 *
 * ── 环境侧（门禁 DSH_MATT_LIVE_HOME，未设则 loud skip）────────────────────
 * 覆盖 human 要求的**全流程四环**，一环一断言，失败可定位到具体环节：
 *   N1/N2  安装：profile 注册 dsh-matt-preset 为 bundle + node_modules 链接
 *   L1/L2  配置：launcher --dump-config 成功 + 组合树含 workflow-core 行
 *   R1–R5  调用：渲染面（persona 无正文 / 注入节完整 / 插值 / verbatim / subpath）
 *   S1–S3  新建会话：真实建会话 + 该会话提示词含注入节 + 会话级插值
 *
 * 注：headless profile **不是**"新建会话"环的合格载体——其 bundle 不含
 * agentPresets 服务，preset 行会 `pending (waiting for service: agentPresets)`
 * （实测），故该环用宿主 harness 建会话（与 GUI/web 同一挂载路径）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { bootHarness } from './preset-harness.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const results = []
const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))

/** Extract the `prefix: |` block scalar (same shape as verify-production). */
const personaPrefix = (yml) => {
  const lines = yml.split('\n')
  const start = lines.findIndex(l => /^\s*prefix:/.test(l))
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}/.test(lines[i]) || lines[i].trim() === '') out.push(lines[i].slice(6))
    else if (out.length > 0) break
  }
  return out.join('\n')
}

const composition = readFileSync(REPO + '/agent.cordis.yml', 'utf8').replace(/\r\n/g, '\n')
const NEW_PREFIX = personaPrefix(composition)
const PERSONA_CARRIED = readFileSync(REPO + '/tests/fixtures/persona-prefix-v1.txt', 'utf8').replace(/\r\n/g, '\n')
const CORE = pathToFileURL(REPO + '/workflow-core.mjs').href

const ctx = await bootHarness([
  { id: 'matt-real', plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: NEW_PREFIX } },
    { id: 'workflow-core', name: CORE },
  ] },
  { id: 'matt-carried', plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: PERSONA_CARRIED } },
  ] },
])

const render = async (id, cwd, model) => {
  const h = await ctx.agents.create({
    sessionId: SessionId('render-' + id),
    meta: { cwd },
    agentOptions: { provider: 'mock', model },
    setup: async (ac) => void await ctx.agentPresets.mount(ac, id),
  })
  const a = await ctx.systemPrompt.assemble(assembleContextFor(h.agent, new AbortController().signal))
  const t = renderPrompt(a)
  await h.dispose()
  return t
}

const CWD = REPO
const real = await render('matt-real', CWD, 'render-check-model')
const carried = await render('matt-carried', CWD, 'render-check-model')

// R1: persona 前缀已瘦身
if (NEW_PREFIX.length < 800 && !NEW_PREFIX.includes('MAIN FLOW')) ok('R1. persona prefix carries no workflow body', NEW_PREFIX.length + ' chars')
else bad('R1. persona prefix slimmed', NEW_PREFIX.length + ' chars')

// R2: 注入节正文完整
const marks = ['MAIN FLOW — idea → ship', 'WORKFLOW ENFORCEMENT', 'BATCH MODE', 'INITIALIZATION', 'METHODOLOGY']
const missing = marks.filter(m => !real.includes(m))
if (missing.length === 0) ok('R2. injected workflow:core carries the full body', marks.length + ' sections')
else bad('R2. injected body incomplete', 'missing: ' + missing.join(', '))

// R3: 插值
if (real.includes('render-check-model') && real.includes(CWD) && !real.includes('{{model}}') && !real.includes('{{cwd}}'))
  ok('R3. {{model}}/{{cwd}} interpolate in the rendered prompt')
else bad('R3. interpolation', real.slice(0, 200))

// R4: L1 等价
if (real === carried) ok('R4. real-composition render verbatim-identical to persona-carried baseline', real.length + ' chars')
else {
  bad('R4. verbatim-identical')
  let i = 0
  while (i < real.length && i < carried.length && real[i] === carried[i]) i++
  console.error('  divergence at ' + i + '\n  real: ' + JSON.stringify(real.slice(i, i + 100)) + '\n  carried: ' + JSON.stringify(carried.slice(i, i + 100)))
}

// R5: 离线挂载契约（不依赖实例在跑）
const coreRow = /-\s+id:\s*workflow-core\s*\n\s+name:\s*(\S+)/.exec(composition)
if (coreRow === null) bad('R5. composition carries the workflow-core row', 'row not found')
else if (coreRow[1] === 'dsh-matt-preset/workflow-core.mjs') ok('R5. workflow-core addressed via package subpath export', coreRow[1])
else bad('R5. workflow-core entry path', coreRow[1] + ' (expected dsh-matt-preset/workflow-core.mjs — never a ./ profile-relative path)')

// R6: the shipped mount names its profile explicitly (#55) — relying on the
// plugin default to mean "standard" would hide the contract from the composition.
// Scope the search to the workflow-core ENTRY (up to the next row or top-level
// comment), so a later entry's `profile:` can never satisfy it by accident.
const coreEntry = /-\s+id:\s*workflow-core\s*\n([\s\S]*?)(?=\n\s*-\s+id:|\n#|$)/.exec(composition)?.[1] ?? ''
const profileRow = /^\s+profile:\s*(\S+)/m.exec(coreEntry)
if (profileRow?.[1] === 'standard') ok('R6. composition mounts workflow-core with an explicit profile: standard')
else bad('R6. explicit profile row', profileRow?.[1] ?? 'no profile: inside the workflow-core entry')

// ── LIVE 段（环境侧，门禁开启）─────────────────────────────────────────────
// 环境侧验证：在真实 profile home 上跑 launcher 的 --dump-config，确认
// workflow-core 行真的进了**实例组合树**（不是靠 "pnpm add 成功" 推断）。
// 门禁与仓库既有的 loud-skip 惯例同构：未设置 DSH_MATT_LIVE_HOME 时响亮
// 跳过（打印原因，绝不静默当 pass），常规 `pnpm test` 在无环境时仍全绿。
const liveHome = process.env.DSH_MATT_LIVE_HOME
const liveProfile = process.env.DSH_MATT_LIVE_PROFILE ?? 'matt-dev'
const liveCli = process.env.DSH_MATT_LIVE_CLI

if (!liveHome) {
  console.warn(
    '  !! SKIP (loud) - live instance proof needs DSH_MATT_LIVE_HOME ' +
      '(e.g. $HOME/dsh-matt-home); instance-side dump evidence absent here',
  )
} else if (!liveCli) {
  console.warn(
    '  !! SKIP (loud) - DSH_MATT_LIVE_HOME is set but DSH_MATT_LIVE_CLI is not ' +
      '(path to the source checkout CLI entry, e.g. <src>/apps/cli/src/bin.ts)',
  )
} else {
  const { spawnSync } = await import('node:child_process')
  const dump = spawnSync(process.execPath, ['--import', 'tsx/esm', liveCli, '--profile', liveProfile, '--dump-config'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: liveHome },
    cwd: liveCli.replace(/[\\/]apps[\\/]cli[\\/]src[\\/]bin\.ts$/, ''),
  })
  if (dump.status !== 0) {
    bad('L1. live --dump-config succeeds', `exit ${dump.status}: ${(dump.stderr ?? '').slice(0, 300)}`)
  } else {
    ok('L1. live --dump-config succeeds', `profile ${liveProfile} @ ${liveHome}`)
    if (dump.stdout.includes('dsh-matt-preset/workflow-core.mjs')) {
      ok('L2. workflow-core row present in the LIVE composed tree')
    } else {
      bad('L2. workflow-core row in live composed tree', 'row missing — mount did not take effect')
    }
  }

  // ── 新建会话（session-create）──────────────────────────────────────────
  // 真实建一个会话并把工作流挂上去，读**该会话的系统提示词断面**——证明
  // "新建会话"这一环里模型真的看到注入的 workflow:core 节（不是只有配置文件
  // 层面正确）。headless profile 不是本环的合格载体：其 bundle 不含
  // agentPresets 服务，preset 行会 pending（实测），故用宿主 harness。
  const { bootHarness } = await import('./preset-harness.mjs')
  const { SessionId } = await import('@deepseek-ai/dsh-session')
  const { renderPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const { assembleContextFor } = await import('@deepseek-ai/dsh-agent')
  const sctx = await bootHarness([
    { id: 'session-live', plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: NEW_PREFIX } },
      { id: 'workflow-core', name: CORE },
    ] },
  ])
  const session = await sctx.agents.create({
    sessionId: SessionId('workflow-core-session-create'),
    meta: { cwd: REPO },
    agentOptions: { provider: 'mock', model: 'session-create-model' },
    setup: async (ac) => void await sctx.agentPresets.mount(ac, 'session-live'),
  })
  const sessionText = renderPrompt(
    await sctx.systemPrompt.assemble(assembleContextFor(session.agent, new AbortController().signal)),
  )
  const events = session.agent.session.snapshotEvents()
  if (events.some(e => e.type === 'session') || session.agent.session.id !== undefined) {
    ok('S1. a NEW session is created and carries its own prompt', String(session.agent.session.id))
  } else {
    bad('S1. new session created', 'no session header')
  }
  if (sessionText.includes('WORKFLOW ENFORCEMENT') && sessionText.includes('MAIN FLOW — idea → ship')) {
    ok('S2. the new session\'s model-facing prompt carries the injected workflow:core section')
  } else {
    bad('S2. new session prompt carries workflow:core', sessionText.slice(0, 200))
  }
  if (sessionText.includes('session-create-model') && !sessionText.includes('{{model}}')) {
    ok('S3. the new session\'s {{model}} interpolates (per-session variable binding)')
  } else {
    bad('S3. new session interpolation', sessionText.slice(0, 200))
  }
  await session.dispose()

  // ── 安装环（install）──────────────────────────────────────────────────
  // 断言 profile 的注册记录真的把 preset 列为 bundle（安装环的落地点），
  // 并确认 node_modules 链接存在——这两条合起来才是"装上了"。
  const { readFileSync: rf, existsSync } = await import('node:fs')
  const { join: pjoin } = await import('node:path')
  const profileDir = pjoin(liveHome, 'profiles', liveProfile)
  try {
    const manifest = JSON.parse(rf(pjoin(profileDir, 'package.json'), 'utf8'))
    const bundles = manifest?.dsh?.profile?.bundles ?? []
    if (bundles.includes('dsh-matt-preset')) {
      ok('N1. install: profile registers dsh-matt-preset as a bundle', bundles.join(', '))
    } else {
      bad('N1. install: bundle registered', `bundles = ${JSON.stringify(bundles)}`)
    }
    const linked = existsSync(pjoin(profileDir, 'node_modules', 'dsh-matt-preset'))
    if (linked) ok('N2. install: profile node_modules carries the preset link')
    else bad('N2. install: node_modules link', pjoin(profileDir, 'node_modules', 'dsh-matt-preset'))
  } catch (error) {
    bad('N1/N2. install ring', String(error?.message ?? error))
  }
}

console.log('\n=== WORKFLOW-CORE RENDER VERIFY (real composition) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)