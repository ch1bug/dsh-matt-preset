/**
 * verify-live-real-llm.mjs —— #62 **真实 LLM 层**（opt-in）：用真凭据跑一次真实
 * turn，证明"供应商接受 + 模型真实行为"这一层（mock 层证明不了的部分）。
 *
 * 为什么需要这一层（证据边界，human 2026-10-16 追问）：
 *   mock 层（verify-live-tool-call.mjs）证明的是**实例这一侧**到 wire 为止全通——
 *   真实组合树、真实建会话、真实发出的请求字节、真实工具执行。它**不能**证明：
 *     ① 真实端点是否接受该请求（鉴权 / 模型名 / 28K 系统提示词长度上限 / 字段兼容）；
 *     ② 真实模型是否按工作流走、是否真的发起工具调用（注入有效性）；
 *     ③ 真实凭据路径（mock 层塞的是假 key）。
 *   本文件补这三条：跑真端点、读真实模型回复、并在会话日志里确认模型**真的**
 *   发起了工具调用且实例**真的**执行了它。
 *
 * 门禁（未设置则响亮跳过，绝不静默当 pass）：
 *   DSH_MATT_LIVE_CLI  源码检出 CLI 入口（同 mock 层）
 *   DEEPSEEK_API_KEY   真实凭据（不会写入任何文件，仅经 env 传给被测实例）
 * 可选：DSH_MATT_REAL_MODEL 指定模型；DSH_MATT_REAL_PROMPT 覆盖任务文本。
 *
 * 隔离：临时 DSH_HOME（os.tmpdir）+ `--port 0`，不占用任何固定端口（19501/19502/19387）。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))

const CLI = process.env.DSH_MATT_LIVE_CLI
const KEY = process.env.DEEPSEEK_API_KEY

if (!CLI || !KEY) {
  console.warn(
    '  !! SKIP (loud) - real-LLM tier needs ' +
      [!CLI ? 'DSH_MATT_LIVE_CLI' : null, !KEY ? 'DEEPSEEK_API_KEY' : null].filter(Boolean).join(' + ') +
      '; provider-acceptance / real-model-behaviour evidence absent here',
  )
  console.log('\n=== LIVE REAL-LLM VERIFY ===')
  console.log(results.join('\n'))
  process.exit(0)
}

const SRC_ROOT = resolve(CLI, '../../..')
const PRESET_DIR = process.env.DSH_MATT_LIVE_PRESET_DIR ?? REPO
const PROFILE = 'matt-real'
const TASK = process.env.DSH_MATT_REAL_PROMPT
  ?? 'Run the context_status tool exactly once, then reply with the single word: done.'
const SESSION_DIR_OWNER = 'sessions'

const home = await mkdtemp(join(tmpdir(), 'dsh-matt-real-'))
let child
const cleanup = async () => {
  if (child !== undefined) {
    const exited = new Promise(r => child.once('exit', r))
    child.kill('SIGKILL')
    await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
  }
  await rm(home, { recursive: true, force: true }).catch(() => {})
}

const runCli = (args, env = {}) => new Promise((resolveRun) => {
  const p = spawn(process.execPath, ['--import', 'tsx/esm', CLI, ...args], {
    cwd: SRC_ROOT,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ...env },
  })
  let out = ''
  p.stdout.on('data', (c) => { out += c })
  p.stderr.on('data', (c) => { out += c })
  p.on('exit', (code) => resolveRun({ code, out }))
})

const rpc = async (origin, cookie, endpoint, args) => {
  const response = await fetch(`${origin}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `real-${endpoint}`, method: endpoint, payload: { args: { request: args } } }),
  })
  if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const body = await response.json()
  if (body.result?.ok !== true) throw new Error(`${endpoint}: ${JSON.stringify(body.result?.error ?? body).slice(0, 300)}`)
  return body.result.value
}

/** 读实例落盘的会话事件（JSONL）——真实 turn 的事件序列即证据。 */
const readSessionEvents = async () => {
  const dir = join(home, SESSION_DIR_OWNER)
  const files = await readdir(dir).catch(() => [])
  const all = []
  for (const f of files) {
    const text = await readFile(join(dir, f), 'utf8').catch(() => '')
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try { all.push(JSON.parse(line)) } catch { /* skip partial */ }
    }
  }
  return all
}

try {
  // 安装环（同 mock 层，真实安装）
  await runCli(['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'])
  const add = await runCli(['plugin', '--profile', PROFILE, 'add', PRESET_DIR.replace(/\\/g, '/')])
  if (add.code !== 0) bad('R0. install', add.out.slice(-200))
  else ok('R0. preset installed into an isolated temp profile')

  // 起真实实例（真端点，真凭据只经 env 传入）
  child = spawn(process.execPath, ['--import', 'tsx/esm', CLI, '--profile', PROFILE, '--no-open', '--port', '0'], {
    cwd: SRC_ROOT,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: KEY,
    },
  })
  let instOut = ''
  let instErr = ''
  child.stdout.on('data', (c) => { instOut += c })
  child.stderr.on('data', (c) => { instErr += c })
  const launch = await new Promise((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => rejectUrl(new Error(`instance not ready in 120s: ${instErr.slice(-400)}`)), 120_000)
    child.stdout.on('data', () => {
      const m = /dsh web: (http:\/\/\S+)/.exec(instOut)
      if (m) { clearTimeout(timer); resolveUrl(m[1]) }
    })
    child.on('exit', (code) => { clearTimeout(timer); rejectUrl(new Error(`instance exited ${code}: ${instErr.slice(-400)}`)) })
  })
  ok('R1. live instance is up against the REAL endpoint', launch.replace(/token=[^&]+/, 'token=<redacted>'))
  if (instErr.trim() === '') ok('R1b. instance stderr is empty at startup')
  else bad('R1b. instance stderr empty', instErr.slice(-300))

  const exchange = await fetch(launch, { redirect: 'manual' })
  const setCookie = exchange.headers.get('set-cookie')
  if (exchange.status !== 303 || setCookie === null) throw new Error(`auth exchange failed: HTTP ${exchange.status}`)
  const cookie = setCookie.split(';', 1)[0]
  const origin = new URL(launch).origin

  // 真实会话 + 真实 turn
  const created = await rpc(origin, cookie, 'session/create', { agentPreset: 'dsh-matt-preset', cwd: SRC_ROOT.replace(/\\/g, '/') })
  ok('R2. real session created with the matt preset', String(created.sessionId))
  const model = process.env.DSH_MATT_REAL_MODEL
  if (model !== undefined) {
    await rpc(origin, cookie, 'session/selectModel', { sessionId: created.sessionId, provider: 'deepseek', model })
  }
  await rpc(origin, cookie, 'session/prompt', {
    requestId: 'real-request-1',
    sessionId: created.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: TASK }],
    clientTimeZone: 'Asia/Shanghai',
  })

  // 等真实 turn 落盘（供应商往返 + 可能的多步工具循环）
  const deadline = Date.now() + 180_000
  let events = []
  while (Date.now() < deadline) {
    events = await readSessionEvents()
    if (events.some(e => e.type === 'turn/end')) break
    await new Promise(r => setTimeout(r, 1000))
  }

  const turnEnd = events.find(e => e.type === 'turn/end')
  if (turnEnd === undefined) {
    bad('R3. the real turn finished', `no turn/end within 180s; ${events.length} event(s): ${events.map(e => e.type).join(',')}`)
  } else {
    const reason = turnEnd.data?.reason ?? turnEnd.reason
    const kind = typeof reason === 'string' ? reason : reason?.kind ?? reason?.error?.code ?? JSON.stringify(reason)
    if (kind === 'completed') ok('R3. the REAL provider accepted the request and the turn completed', 'turn/end reason=completed')
    else bad('R3. real turn completed', `reason=${String(kind)} ${JSON.stringify(reason).slice(0, 300)}`)
  }

  // 真实模型回复非空
  const assistantText = events
    .filter(e => e.type === 'assistant/message')
    .map(e => (e.data?.message?.content ?? e.data?.content ?? []))
    .flat()
    .map(p => (typeof p === 'string' ? p : p?.text ?? ''))
    .join('')
  if (assistantText.trim() !== '') ok('R4. the REAL model produced assistant text', `${assistantText.trim().length} chars: ${JSON.stringify(assistantText.trim().slice(0, 80))}`)
  else bad('R4. real assistant text', `events: ${events.map(e => e.type).join(',')}`)

  // 真实模型**发起**工具调用 + 实例**执行**（这才是"LLM 实际调用工具"）
  const callEvents = events.filter(e => e.type === 'tool/call')
  const resultEvents = events.filter(e => e.type === 'tool/result' || e.type === 'tool/call/result')
  if (callEvents.length > 0) {
    const names = callEvents.map(e => e.data?.name ?? e.data?.toolName).filter(Boolean)
    ok('R5. the REAL model issued a tool call', names.join(', ') || '(name not in event)')
  } else {
    bad('R5. real model issued a tool call', `no tool/call event; events: ${events.map(e => e.type).join(',')}`)
  }
  if (resultEvents.length > 0) {
    ok('R6. the live instance EXECUTED the real model\'s tool call', `${resultEvents.length} tool result event(s)`)
  } else {
    bad('R6. real tool executed', `no tool result event; events: ${events.map(e => e.type).join(',')}`)
  }
} catch (error) {
  bad('real-LLM run', String(error?.message ?? error))
} finally {
  await cleanup()
}

console.log('\n=== LIVE REAL-LLM VERIFY (provider + model behaviour) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)