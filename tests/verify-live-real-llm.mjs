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
 *   凭据二选一：
 *     a) DEEPSEEK_API_KEY                —— 真 key，仅经 env 传给被测实例，不落文件；
 *     b) DSH_MATT_REAL_CREDENTIALS_SOURCE —— 一个含 `deepseek-account-platform/*`
 *        记录的 credentials.yaml 路径（账号设备授权路线，无需 API key）。测试只
 *        **只读**取出这两条记录写入临时 home（跑完随临时目录删除）。默认尝试
 *        当前用户的 home `~/.dsh/.credentials.yaml`（存在且含该记录时）。
 * 可选：DSH_MATT_REAL_MODEL 指定模型；DSH_MATT_REAL_PROMPT 覆盖任务文本。
 *
 * 隔离：临时 DSH_HOME（os.tmpdir）+ `--port 0`，不占用任何固定端口（19501/19502/19387）。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))

const CLI = process.env.DSH_MATT_LIVE_CLI
const KEY = process.env.DEEPSEEK_API_KEY
/** 账号授权路线：只读源（默认当前用户 home），只取 deepseek-account-platform/* 记录。 */
const CRED_SOURCE = process.env.DSH_MATT_REAL_CREDENTIALS_SOURCE
  ?? join(homedir(), '.dsh', '.credentials.yaml')
const ACCOUNT_PREFIX = 'deepseek-account-platform/'

/** 从源 credentials.yaml 只读取账号记录（不改源文件）。 */
const accountRecords = async () => {
  const text = await readFile(CRED_SOURCE, 'utf8').catch(() => null)
  if (text === null) return null
  const doc = parseYaml(text) ?? {}
  const records = doc.records ?? {}
  const picked = Object.fromEntries(Object.entries(records).filter(([k]) => k.startsWith(ACCOUNT_PREFIX)))
  return Object.keys(picked).length > 0 ? { version: doc.version ?? 1, records: picked } : null
}

const hasKey = typeof KEY === 'string' && KEY.trim() !== ''
const account = hasKey ? null : await accountRecords()

if (!CLI || (!hasKey && account === null)) {
  console.warn(
    '  !! SKIP (loud) - real-LLM tier needs ' +
      [!CLI ? 'DSH_MATT_LIVE_CLI' : null,
        !hasKey && account === null ? 'DEEPSEEK_API_KEY or a credentials source with deepseek-account-platform/*' : null,
      ].filter(Boolean).join(' + ') +
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

/**
 * typert descriptor 的参数名**逐方法不同**，必须按签名给：
 *   create/prompt/selectModel(request) → { request }
 *   list(_request)                     → { _request }
 *   initializeDefaultModel()/modelCatalog() 无参 → {}
 * 猜错会得到 gateway/arguments-invalid（实测三种都踩过）。
 */
const rpc = async (origin, cookie, endpoint, args, argName = 'request') => {
  const wrapped = argName === null ? {} : { [argName]: args ?? {} }
  const response = await fetch(`${origin}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `real-${endpoint}`, method: endpoint, payload: { args: wrapped } }),
  })
  if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const body = await response.json()
  if (body.result?.ok !== true) throw new Error(`${endpoint}: ${JSON.stringify(body.result?.error ?? body).slice(0, 300)}`)
  return body.result.value
}

/**
 * 读实例落盘的会话事件——真实 turn 的事件序列即证据。
 * 布局：<home>/sessions/<cwd 编码>/session-<id>/session.v4.jsonl.zstd（zstd 压缩 JSONL）。
 */
const readSessionEvents = async () => {
  const root = join(home, 'sessions')
  const all = []
  const cwds = await readdir(root).catch(() => [])
  for (const cwdDir of cwds) {
    const sessions = await readdir(join(root, cwdDir)).catch(() => [])
    for (const sessionDir of sessions) {
      const files = await readdir(join(root, cwdDir, sessionDir)).catch(() => [])
      for (const f of files) {
        if (!f.endsWith('.jsonl.zstd')) continue
        const raw = await readFile(join(root, cwdDir, sessionDir, f)).catch(() => null)
        if (raw === null) continue
        let text = ''
        try { text = zstdDecompressSync(raw).toString('utf8') } catch { continue }
        for (const line of text.split('\n')) {
          if (line.trim() === '') continue
          try { all.push(JSON.parse(line)) } catch { /* skip partial */ }
        }
      }
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

  // 凭据：key 路线只走 env；账号路线把只读取到的记录写进临时 home（跑完删除）
  if (account !== null) {
    await writeFile(join(home, '.credentials.yaml'), stringifyYaml(account), 'utf8')
    ok('R0b. account credentials seeded into the temp home (read-only copy of the source records)', Object.keys(account.records).join(', '))
  } else {
    ok('R0b. API key supplied via environment only (nothing written to disk)')
  }

  // 起真实实例（真端点）
  child = spawn(process.execPath, ['--import', 'tsx/esm', CLI, '--profile', PROFILE, '--no-open', '--port', '0'], {
    cwd: SRC_ROOT,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
      ...(hasKey ? { DEEPSEEK_API_KEY: KEY } : {}),
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
  // 账号授权路线：宿主默认模型 + **显式把本会话路由到账号 provider**。
  // 实测教训：只调 initializeDefaultModel 不够——会话已创建，其路由不会回溯更新，
  // 结果 turn 卡在凭据解析（无错误、无事件落盘）。必须 selectModel 到账号模型。
  if (account !== null) {
    try {
      await rpc(origin, cookie, 'session/initializeDefaultModel', undefined, null)
      const catalog = await rpc(origin, cookie, 'session/modelCatalog', undefined, null)
      const groups = catalog?.groups ?? []
      const pick = groups.find(g => g.id === 'deepseek-account') ?? groups[0]
      const modelId = pick?.models?.[0]?.id
      if (modelId === undefined) throw new Error(`no model in catalog; groups=${JSON.stringify(groups.map(g => g.id))}`)
      await rpc(origin, cookie, 'session/selectModel', { sessionId: created.sessionId, provider: pick.id, model: modelId })
      ok('R2b. session routed to the account provider', `${pick.id}/${modelId}`)
    } catch (error) {
      bad('R2b. account route model selection', String(error?.message ?? error).slice(0, 300))
    }
  }
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

  // 等真实 turn 结束：用**投影读**判断（会话文件是批量落盘的，不能当实时证据——实测踩过：
  // 真实 turn 早已完成（25.5K 输入 token、模型已回话），文件里却只有 header 行）。
  const deadline = Date.now() + 180_000
  let proj = null
  let page = null
  const pageFor = async () => {
    const asOf = proj?.asOfSeq
    // throughSeq 需要与投影前进量一致；日志前进后旧 cut 会失效，故用最新 asOfSeq。
    return rpc(origin, cookie, 'session/page', {
      address: { kind: 'session', sessionId: created.sessionId },
      throughSeq: typeof asOf === 'number' ? asOf : 4096,
      maxMessages: 200,
    }, 'request').catch(e => ({ __error: String(e.message) }))
  }
  while (Date.now() < deadline) {
    proj = await rpc(origin, cookie, 'session/projections', { sessionId: created.sessionId }, 'request').catch(() => null)
    const pvNow = proj?.values ?? {}
    if ((pvNow.tokenUsage?.outputTokens ?? 0) > 0) {
      page = await pageFor()
      const pageStr = JSON.stringify(page)
      if (pageStr.includes('assistant') || pageStr.includes('tool')) break
    }
    await new Promise(r => setTimeout(r, 1500))
  }
  if (page === null) page = await pageFor()

  const pv = proj?.values ?? {}
  const outputTokens = pv.tokenUsage?.outputTokens ?? 0
  if (pv.agentPreset === 'dsh-matt-preset') ok('R3a. the live session runs the matt preset', pv.agentPreset)
  else bad('R3a. session agent preset', JSON.stringify(pv.agentPreset))
  if (outputTokens > 0) {
    ok('R3. the REAL provider accepted the request and produced output',
      `outputTokens=${outputTokens}, uncachedInput=${pv.tokenUsage?.uncachedInputTokens}, ` +
      `cacheRead=${pv.tokenUsage?.cacheReadTokens}, systemTokens=${pv.contextBreakdown?.systemTokens}, ` +
      `toolsTokens=${pv.contextBreakdown?.toolsTokens}`)
  } else {
    bad('R3. real provider produced output', `projections=${JSON.stringify(pv).slice(0, 400)}`)
  }

  // 耐久事件（session/page）：真实模型回复 + 工具活动
  const pageJson = JSON.stringify(page)
  const types = [...new Set([...pageJson.matchAll(/"type":"([a-z][a-z0-9/_-]*)"/g)].map(m => m[1]))]
  const hasAssistant = types.some(t => t.startsWith('assistant/')) || pageJson.includes('"assistant"')
  const toolTypes = types.filter(t => t.startsWith('tool/'))
  if (hasAssistant) ok('R4. the durable log carries a real assistant message', types.filter(t => t.startsWith('assistant/')).join(', ') || 'assistant present')
  else bad('R4. real assistant message', `types=${types.join(',')} | json=${pageJson.slice(0, 300)}`)
  if (toolTypes.length > 0) {
    ok('R5. real tool activity in the durable log', toolTypes.join(', '))
  } else {
    // 模型这次可能没发起工具调用——如实标注，不当成通过
    bad('R5. real tool activity', `no tool/* events; types=${types.join(',')} | json=${pageJson.slice(0, 300)}`)
  }
} catch (error) {
  bad('real-LLM run', String(error?.message ?? error))
} finally {
  await cleanup()
}

console.log('\n=== LIVE REAL-LLM VERIFY (provider + model behaviour) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)