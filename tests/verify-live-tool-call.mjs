/**
 * verify-live-tool-call.mjs —— #62 调用侧（live call-side）验证：真实实例里
 * 跑一个真实 turn，抓到**真实模型请求**，并证明实例**真的执行了工具**。
 *
 * 与 verify-workflow-core-render.mjs 的分工：
 *   - render 版：宿主 harness 内建会话 → 断言系统提示词面（协议层）；
 *   - 本文件：**起真实 dsh web 实例**（源码部署）→ RPC 建会话 → 发消息 →
 *     本地 mock LLM 捕获实例发出的真实请求 → 让模型回一个工具调用 →
 *     验证下一轮请求里带着 tool_result（= 实例真的执行了工具，不是只看端口存活）。
 *
 * 隔离与端口（绝不与隔壁/桌面冲突）：
 *   - 临时 DSH_HOME（os.tmpdir 下），profile 名 `matt-live`；
 *   - mock LLM 与 web 实例都用 `--port 0`（OS 临时分配），不占用 19501/19502/19387。
 *
 * 门禁：未设 DSH_MATT_LIVE_CLI（源码检出的 CLI 入口）时**响亮跳过**。
 * 可选 DSH_MATT_LIVE_PRESET_DIR 覆盖 preset 目录（默认 = 本仓库根）。
 *
 * 挂具（SSE mock / runCli / rpc / cleanup）自 #81 起收进 tests/live-harness.mjs，
 * 本文件只留断言与门禁。
 *
 * 断言：
 *   T1 安装/初始化：web 模板 profile 建好 + preset 注册为 bundle
 *   T2 配置：--dump-config 组合树含 workflow-core 行
 *   T3 会话：RPC session/create 带 agentPreset=dsh-matt-preset 成功
 *   T4 调用（模型请求面）：真实请求的 system 含工作流正文（workflow:core 注入）且无字面 {{}}
 *   T5 调用（工具执行）：模型发的 tool_use 被执行，下一轮请求带该工具的 tool_result
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTempHome, cleanup, createSseMock, rpc, runCli } from './live-harness.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))

const CLI = process.env.DSH_MATT_LIVE_CLI
if (!CLI) {
  console.warn(
    '  !! SKIP (loud) - live call-side proof needs DSH_MATT_LIVE_CLI ' +
      '(source checkout CLI entry, e.g. <src>/apps/cli/src/bin.ts)',
  )
  console.log('\n=== LIVE TOOL-CALL VERIFY ===')
  console.log(results.join('\n'))
  process.exit(0)
}

const SRC_ROOT = resolve(CLI, '../../..')
const PRESET_DIR = process.env.DSH_MATT_LIVE_PRESET_DIR ?? REPO
const PROFILE = 'matt-live'
const TOOL_NAME = 'context_status' // 由 workflow-enforcer 注册；无需审批门

/** SSE mock LLM（#81 起挂具收进 tests/live-harness.mjs：两轮确定性应答 + 捕获真实请求）。 */
const mock = await createSseMock({ tag: 'live', toolName: TOOL_NAME, finalText: 'live-tool-call-complete' })
const captured = mock.captured
const mockPort = mock.port

const home = await mkdtemp(join(tmpdir(), 'dsh-matt-live-'))
// canary（2026-10-18 事故硬化）：清理目标必须留在系统临时目录内（判据在 live-harness）。
assertTempHome(home)
let child

const runCliHere = (args, env = {}) => runCli(CLI, args, { cwd: SRC_ROOT, home, env })

const rpcHere = (origin, cookie, endpoint, args) => rpc(origin, cookie, endpoint, args, 'live')

try {
  // ── T1 安装：web 模板 profile + preset 注册 ─────────────────────────────
  const init = await runCliHere(['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'])
  if (init.code !== 0) bad('T1. profile init', init.out.slice(-300))
  const add = await runCliHere(['plugin', '--profile', PROFILE, 'add', PRESET_DIR.replace(/\\/g, '/')])
  const manifest = JSON.parse(await readFile(join(home, 'profiles', PROFILE, 'package.json'), 'utf8'))
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  if (add.code === 0 && bundles.includes('dsh-matt-preset')) ok('T1. install: preset registered as a bundle', bundles.join(', '))
  else bad('T1. install: preset registered', `code=${add.code} bundles=${JSON.stringify(bundles)} ${add.out.slice(-200)}`)

  // ── T2 配置：组合树含 workflow-core 行 ──────────────────────────────────
  const dump = await runCliHere(['--profile', PROFILE, '--dump-config'])
  if (dump.out.includes('dsh-matt-preset/workflow-core.mjs')) ok('T2. config: workflow-core row in the live composed tree')
  else bad('T2. config: workflow-core row', dump.out.slice(-300))

  // ── 起真实实例（mock LLM，端口 0）───────────────────────────────────────
  child = spawn(process.execPath, ['--import', 'tsx/esm', CLI, '--profile', PROFILE, '--no-open', '--port', '0'], {
    cwd: SRC_ROOT,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockPort}`,
      DEEPSEEK_API_KEY: 'live-call-side-test-key',
    },
  })
  let instOut = ''
  let instErr = ''
  child.stdout.on('data', (c) => { instOut += c })
  child.stderr.on('data', (c) => { instErr += c })
  const launch = await new Promise((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => rejectUrl(new Error(`instance not ready in 120s\nstdout:${instOut.slice(-300)}\nstderr:${instErr.slice(-600)}`)), 120_000)
    child.stdout.on('data', () => {
      const m = /dsh web: (http:\/\/\S+)/.exec(instOut)
      if (m) { clearTimeout(timer); resolveUrl(m[1]) }
    })
    child.on('exit', (code) => { clearTimeout(timer); rejectUrl(new Error(`instance exited ${code}: ${instErr.slice(-400)}`)) })
  })
  ok('L0. live instance is up (web surface)', launch.replace(/token=[^&]+/, 'token=<redacted>'))
  if (instErr.trim() === '') ok('L0b. instance stderr is empty')
  else bad('L0b. instance stderr empty', instErr.slice(-300))

  // ── 鉴权：printed token → cookie ────────────────────────────────────────
  const exchange = await fetch(launch, { redirect: 'manual' })
  const setCookie = exchange.headers.get('set-cookie')
  if (exchange.status === 303 && setCookie !== null) ok('L0c. token exchange works (full web mount, not headless)')
  else throw new Error(`auth exchange failed: HTTP ${exchange.status}`)
  const cookie = setCookie.split(';', 1)[0]
  const origin = new URL(launch).origin

  // ── T3 会话：真实建会话（带 matt preset）────────────────────────────────
  const created = await rpcHere(origin, cookie, 'session/create', { agentPreset: 'dsh-matt-preset', cwd: SRC_ROOT.replace(/\\/g, '/') })
  if (created?.sessionId !== undefined) ok('T3. live session created with the matt preset', `${created.sessionId} preset=${created.agentPreset ?? '(default)'}`)
  else bad('T3. live session created', JSON.stringify(created))

  // ── 发消息，驱动真实 turn ───────────────────────────────────────────────
  await rpcHere(origin, cookie, 'session/prompt', {
    requestId: 'live-request-1',
    sessionId: created.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: 'Run the context status tool once, then confirm.' }],
    clientTimeZone: 'Asia/Shanghai',
  })

  // 等两轮请求（第二轮必然带 tool_result）
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline && !captured.some(c => c.sawToolResult)) await new Promise(r => setTimeout(r, 500))

  // ── T4 调用（模型请求面）：真实 system 含注入的工作流正文 ───────────────
  // 注意：实例会另发一次"会话标题"请求，它不是 agent 主请求——按内容定位
  // 携带工作流正文的那一次（而不是盲目取 captured[0]）。
  const agentReq = captured.find(c => typeof c.system === 'string' && c.system.includes('MAIN FLOW — idea → ship'))
  if (agentReq !== undefined && agentReq.system.includes('WORKFLOW ENFORCEMENT')) {
    ok('T4. the live model request carries the injected workflow body', `${agentReq.system.length} chars`)
  } else {
    bad('T4. live model request carries workflow body',
      `agent request not found among ${captured.length} request(s); systems: ` +
      JSON.stringify(captured.map(c => String(c.system ?? '').slice(0, 60))))
  }
  if (agentReq !== undefined && !agentReq.system.includes('{{model}}')) {
    ok('T4b. no literal {{…}} left in the live agent system prompt')
  } else {
    bad('T4b. live system prompt interpolation', JSON.stringify(String(agentReq?.system ?? '')).slice(0, 300))
  }

  // ── T5 调用（工具执行）：tool_use 被执行，下一轮带 tool_result ──────────
  const withResult = captured.find(c => c.sawToolResult)
  if (withResult !== undefined) {
    const text = JSON.stringify(withResult.messages)
    if (text.includes(TOOL_NAME) && text.includes('tool_result')) {
      ok('T5. the live instance EXECUTED the model\'s tool call', `${TOOL_NAME} → tool_result observed`)
    } else {
      bad('T5. tool executed', text.slice(0, 300))
    }
  } else {
    bad('T5. tool executed', `no second request with tool_result within 90s; requests=${captured.length}`)
  }
} catch (error) {
  bad('live call-side run', String(error?.message ?? error))
} finally {
  // 收尾四合一在 live-harness（kill → 等 exit → 等 stdio 管道关闭 → mock.close → canary 后
  // 删临时 home；#75 的 libuv 修法烘焙在 harness，失败路径不会再把退出码变成崩溃码）。
  await cleanup({ child, mock: mock.server, home })
}

console.log('\n=== LIVE TOOL-CALL VERIFY (call side) ===')
console.log(results.join('\n'))
// 退出用 exitCode 自然排空，不 process.exit 硬杀：失败路径上父进程还有 socket
// （undici keep-alive 连着刚被 kill 的实例、mock 侧连接）在关闭中，硬退会撞 libuv 的
// UV_HANDLE_CLOSING 断言、退出码变崩溃码（#81 实测 exit=127，--trace-exit 定位 exit 时
// 仍挂 2 个 Socket）。#75 的 stdio 等待只兜住 child 半边；退出码语义不变（0/1）。
process.exitCode = results.some(r => r.startsWith('  ✗')) ? 1 : 0