/**
 * verify-live-harness.mjs — #81 守卫：live 挂具收进 tests/live-harness.mjs 后，
 * 钉住三件事：两个消费方不再各自内嵌四块挂具、harness 导出面稳定、#75 的
 * "kill → 等 exit → 等 stdout/stderr 管道关闭再退出"修法烘焙在 harness 里。
 *
 * 背景：两个 live 用例（verify-live-tool-call.mjs / verify-clean-env-e2e.mjs）的挂具
 * 近乎逐行同形且已"复制后走样"过一次——#75 修了 cleanup 的 stdio 等待，live-tool-call
 * 仍是旧写法（失败路径会撞 libuv UV_HANDLE_CLOSING 断言，退出码变崩溃码 -1073740791，
 * 埋掉"哪一环红"的读数）。#81 抽 tests/live-harness.mjs 收一处。
 *
 * 分层：
 *   W1 文本级（双向钉）：四块挂具的判据串在**两个消费方**必须缺席（内嵌回潮即红）、
 *      在 **harness** 必须在场（修法/判据被单方改掉即红）。消费文件里的实例 spawn
 *      （长命子进程，断言对象）不走 runCli，`--import tsx/esm` 在消费方仍应在场——
 *      故 runCli 的判据串取定义形态 `const runCli =`，不取 spawn 形态。
 *   W2 导出面 + 行为级：五导出皆 function（可 import、面稳定）；createSseMock / rpc
 *      用真 http server 冒烟（纯 node，无环境依赖）；runCli / cleanup 用**副本 import**
 *      （只换 spawn/rm 导入边，被测函数逐字节是仓内那份，手法同 verify-sandcastle-bash-probe
 *      W2 / verify-sandcastle-retro Y6）注入假执行器——断言 spawn 组装形态（tsx/args/cwd/
 *      env 注入/输出合并/exit 透传）与 cleanup 的 kill→exit→stdio→close→canary→rm 次序
 *      （本仓 node_modules 无 tsx，runCli 的 tsx 真跑由两个 live 用例带 DSH_MATT_LIVE_CLI
 *      门禁真跑覆盖，此处不重复）。
 *   W3 扰动真红：把 runCli 定义塞回消费文件文本，W1 判据必须报红（判据非恒真）。
 *   W4 登记钉：live-harness.mjs 在 scripts/verify-all.mjs 的 NOT_A_TEST 里
 *      （共享挂具不是用例；同 preset-harness.mjs 先例）。
 *
 * 不依赖 DSH_MATT_LIVE_CLI / dsh / tsx；纯快集用例。
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
/** 退出用 exitCode + 自然排空，不 process.exit：本守卫的行为级段真起了 server / 假 child，
 *  硬退会撞 libuv 的 UV_HANDLE_CLOSING 断言、退出码变崩溃码（#75 的教训，本守卫首跑实测
 *  exit 127）——这正是"等 handle 关干净再退出"这条纪律存在的理由。 */
const report = (title) => {
  console.log(`\n=== ${title} ===`)
  console.log(results.join('\n'))
  process.exitCode = results.some(r => r.startsWith('  ✗')) ? 1 : 0
}

/** LF 归一，避免 CRLF 检出与 LF 检出的假红。 */
const lf = (s) => String(s).replace(/\r\n/g, '\n')
const read = (rel) => {
  try { return lf(readFileSync(resolve(REPO, rel), 'utf8')) } catch { return null }
}

const HARNESS = 'tests/live-harness.mjs'
const CONSUMERS = ['tests/verify-live-tool-call.mjs', 'tests/verify-clean-env-e2e.mjs']

// ── W1 判据串（消费方缺席 + harness 在场，双向钉）────────────────────────────
// 每条写明它钉的是哪一块：改任何一侧（消费方抄回去 / harness 修法被改掉）守卫即红。
const MARKERS = [
  ['SSE mock 帧（content_block_start）', 'content_block_start'],
  ['SSE mock 响应头（text/event-stream）', 'text/event-stream'],
  ['RPC 壳 body（client-request）', 'client-request'],
  ['RPC 壳 request 包裹（payload.args）', 'args: { request: args }'],
  ['runCli 定义形态', 'const runCli ='],
  ['cleanup 的 SIGKILL', "kill('SIGKILL')"],
  ['cleanup 等 stdio 关闭（streamClosed）', 'streamClosed'],
  ['canary 判据（temp-home canary tripped）', 'temp-home canary tripped'],
  ['canary 定义形态', 'const assertTempHome ='],
]
// 只判"消费方缺席"的串（harness 本就不该有：cleanupChild 是被收编的旧名）。
const CONSUMER_ONLY_ABSENT = [['cleanupChild（旧收尾名，收编后不留）', 'cleanupChild']]
// 末尾退出姿势：process.exit 硬杀在失败路径会撞 libuv UV_HANDLE_CLOSING（#81 实测
// exit=127）——两消费文件末尾必须用 process.exitCode 自然排空（gate 段无 socket 的
// process.exit(0) 不在此列，判据只匹配末尾这两行的形态）。
const EXIT_MARKERS = [
  ['末尾硬退（process.exit(results…）', 'process.exit(results'],
  ['末尾硬退（process.exit(failed…）', 'process.exit(failed'],
]

/** W1 判据本体：给定一个消费文件文本，返回违规列表（空 = 合格）。W3 也要用它。 */
const violations = (text) => {
  const found = []
  if (!text.includes("from './live-harness.mjs'")) found.push("missing import from './live-harness.mjs'")
  for (const [name, marker] of [...MARKERS, ...CONSUMER_ONLY_ABSENT, ...EXIT_MARKERS]) {
    if (text.includes(marker)) found.push(`violation: ${name} (${JSON.stringify(marker)})`)
  }
  return found
}

try {
  // ── W1 文本级：消费方四块不内嵌 + harness 修法在场（双向）──────────────────
  const harnessText = read(HARNESS)
  if (harnessText === null) bad('W1. harness readable', `${HARNESS} missing`)
  for (const rel of CONSUMERS) {
    const text = read(rel)
    if (text === null) { bad(`W1. ${rel} readable`, 'missing'); continue }
    const v = violations(text)
    if (v.length === 0) ok(`W1. ${rel} consumes the harness (no embedded blocks)`)
    else bad(`W1. ${rel} embeds harness blocks again`, v.join('; '))
  }
  if (harnessText !== null) {
    const missing = MARKERS.filter(([, marker]) => !harnessText.includes(marker))
      .map(([name, marker]) => `${name} (${JSON.stringify(marker)})`)
    if (missing.length === 0) ok('W1. harness carries all pinned markers (two-way pin)', `${MARKERS.length} markers`)
    else bad('W1. harness lost pinned markers', missing.join('; '))
  }

  // ── W2 导出面：五导出皆 function（harness 可被 import、面稳定）──────────────
  const harness = await import(pathToFileURL(resolve(REPO, HARNESS)))
  const EXPECTED_EXPORTS = ['assertTempHome', 'createSseMock', 'runCli', 'rpc', 'cleanup']
  const notFn = EXPECTED_EXPORTS.filter((k) => typeof harness[k] !== 'function')
  const extra = Object.keys(harness).filter((k) => !EXPECTED_EXPORTS.includes(k))
  if (notFn.length === 0 && extra.length === 0) {
    ok('W2. export surface stable (5 exports, all functions)', EXPECTED_EXPORTS.join(', '))
  } else {
    bad('W2. export surface drifted', `not functions: [${notFn.join(', ')}] extra: [${extra.join(', ')}]`)
  }

  // ── W2 行为级：createSseMock 真起（真 http，无环境依赖）─────────────────────
  {
    const mock = await harness.createSseMock({ tag: 'guard', toolName: 'guard_tool', finalText: 'guard-final-text', promptText: 'guard-prompt-needle' })
    try {
      const first = await fetch(`http://127.0.0.1:${mock.port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ system: 'guard-system', tools: [{ name: 'guard_tool' }], messages: [{ role: 'user', content: 'guard-prompt-needle' }] }),
      })
      const firstText = await first.text()
      const second = await fetch(`http://127.0.0.1:${mock.port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'tool_result', content: 'ok' }] }] }),
      })
      const secondText = await second.text()
      const [c1, c2] = mock.captured
      const shapesOk = c1?.system === 'guard-system'
        && c1.hasTools === true
        && c1.promptSeen === true
        && c1.sawToolResult === false
        && c2?.sawToolResult === true
        && Array.isArray(c2.messages)
      if (first.headers.get('content-type')?.includes('text/event-stream')
        && firstText.includes('toolu_guard_1') && firstText.includes('"tool_use"') && firstText.includes('guard_tool')
        && secondText.includes('guard-final-text') && secondText.includes('"end_turn"')
        && shapesOk && mock.captured.length === 2 && mock.port > 0) {
        ok('W2. createSseMock: two-round deterministic replay + capture shape', `port=${mock.port} captured=2`)
      } else {
        bad('W2. createSseMock behavior', `headers=${first.headers.get('content-type')} captured=${JSON.stringify(mock.captured).slice(0, 300)}`)
      }
    } finally {
      mock.server.closeIdleConnections?.()
      await new Promise(r => mock.server.close(r)) // 同上：等连接干净关闭再走
    }
  }

  // ── W2 行为级：rpc 真起一个 echo server（成功 / HTTP 错 / result.ok=false 三态）──
  {
    const { createServer } = await import('node:http')
    let seenBody = null
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        seenBody = JSON.parse(body)
        if (req.url.endsWith('/bad')) { res.writeHead(500); res.end('boom') }
        else if (req.url.endsWith('/nok')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result: { ok: false, error: { message: 'not ok' } } })) }
        else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result: { ok: true, value: { echoed: seenBody } } })) }
      })
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    try {
      const origin = `http://127.0.0.1:${server.address().port}`
      const value = await harness.rpc(origin, 'k=v', 'session/create', { a: 1 }, 'g')
      const seenRpcId = seenBody?.rpcId // 快照：后续错误路径请求会覆盖 seenBody
      const bodyOk = seenBody?.type === 'client-request'
        && seenRpcId === 'g-session/create'
        && seenBody?.method === 'session/create'
        && seenBody?.payload?.args?.request?.a === 1
      const httpErr = await harness.rpc(origin, 'k=v', 'bad', {}, 'g').then(() => null, (e) => e)
      const nokErr = await harness.rpc(origin, 'k=v', 'nok', {}, 'g').then(() => null, (e) => e)
      if (bodyOk && value?.echoed?.rpcId === 'g-session/create'
        && httpErr instanceof Error && /HTTP 500/.test(httpErr.message)
        && nokErr instanceof Error && /not ok/.test(nokErr.message)) {
        ok('W2. rpc: request envelope + ok/error paths', `rpcId=${seenRpcId}`)
      } else {
        bad('W2. rpc behavior', `body=${JSON.stringify(seenBody)} httpErr=${httpErr} nokErr=${nokErr}`)
      }
    } finally {
      server.closeIdleConnections?.()
      await new Promise(r => server.close(r)) // 等连接干净关闭：不等直接 exit 会撞 libuv UV_HANDLE_CLOSING（本次守卫首跑实测）
    }
  }

  // ── W2 行为级：runCli / cleanup（副本 import + 假 spawn/rm，被测函数逐字节仓内那份）──
  {
    const harnessSrc = readFileSync(resolve(REPO, HARNESS), 'utf8')
    const injected = `
import { EventEmitter } from 'node:events'
globalThis.__LIVE_GUARD = { spawnCalls: [], rmCalls: [] }
const makeFakeStream = (label) => ({
  destroyed: false,
  on: (ev, cb) => { if (ev === 'data') queueMicrotask(() => cb(label)) },
  once: (ev, cb) => { if (ev === 'close') queueMicrotask(cb) },
})
const makeFakeChild = (exitCode) => {
  const child = new EventEmitter()
  child.stdout = makeFakeStream('OUT')
  child.stderr = makeFakeStream('ERR')
  child.kill = (sig) => { globalThis.__LIVE_GUARD.spawnCalls.push({ kill: sig }); process.nextTick(() => child.emit('exit', exitCode)) }
  return child
}
const spawn = (exe, args, opts) => {
  globalThis.__LIVE_GUARD.spawnCalls.push({ exe, args, opts })
  const child = makeFakeChild(7)
  process.nextTick(() => child.emit('exit', 7)) // runCli 只等 exit 不 kill：spawn 后自动退出
  return child
}
const rm = async (p, opts) => { globalThis.__LIVE_GUARD.rmCalls.push({ p, opts }) }
`
    const patched = harnessSrc
      .replace("import { spawn } from 'node:child_process'", injected)
      .replace("import { rm } from 'node:fs/promises'", '')
    if (patched === harnessSrc) throw new Error('stub injection failed: import lines not found in harness source')
    const dir = mkdtempSync(join(tmpdir(), 'live-harness-guard-'))
    const copyPath = join(dir, 'live-harness.copy.mjs')
    writeFileSync(copyPath, patched)
    try {
      const copy = await import(pathToFileURL(copyPath))
      const { spawnCalls: __spawnCalls, rmCalls: __rmCalls } = globalThis.__LIVE_GUARD
      // runCli：spawn 组装形态（tsx + cwd + DSH_HOME 遥测关）+ 输出合并 + exit 透传。
      const run = await copy.runCli('/cli/entry.js', ['--profile', 'p'], { cwd: '/cwd', home: '/home', env: { EXTRA: '1' } })
      const call = __spawnCalls.find((c) => c.exe !== undefined && Array.isArray(c.args))
      const assembled = call !== undefined
        && call.exe === process.execPath
        && JSON.stringify(call.args) === JSON.stringify(['--import', 'tsx/esm', '/cli/entry.js', '--profile', 'p'])
        && call.opts?.cwd === '/cwd'
        && call.opts?.env?.DSH_HOME === '/home'
        && call.opts?.env?.DSH_TELEMETRY_DISABLED === '1'
        && call.opts?.env?.EXTRA === '1'
      if (assembled && run.code === 7 && run.out.includes('OUT') && run.out.includes('ERR')) {
        ok('W2. runCli: spawn assembly (tsx/args/cwd/env) + merged out + exit code')
      } else {
        bad('W2. runCli behavior', `call=${JSON.stringify(call)} run=${JSON.stringify(run)}`)
      }
      // cleanup 绿路：kill → 等 exit → 等 stdio → mock.close → canary 过 → rm(home)。
      const tmpHome = mkdtempSync(join(tmpdir(), 'live-harness-guard-home-'))
      const fakeServer = { closed: false, close() { this.closed = true } }
      await copy.cleanup() // 三段全缺省：不抛、不杀、不删
      const killLog = []
      await copy.cleanup({ child: guardFakeChild(killLog), mock: fakeServer, home: tmpHome })
      const rmCall = __rmCalls.find((c) => c.p === tmpHome)
      if (killLog.includes('SIGKILL')
        && fakeServer.closed === true
        && rmCall !== undefined
        && rmCall.opts?.recursive === true && rmCall.opts?.force === true) {
        ok('W2. cleanup: SIGKILL → exit → stdio close → mock.close → canary → rm(home)')
      } else {
        bad('W2. cleanup behavior', `killLog=${JSON.stringify(killLog)} closed=${fakeServer.closed} rm=${JSON.stringify(__rmCalls)}`)
      }
      // cleanup canary 红路：home 在临时根外 → 抛 canary 且绝不 rm。
      const rmCountBefore = __rmCalls.length
      let canaryErr = null
      try { await copy.cleanup({ home: resolve(REPO, 'tests') }) } catch (e) { canaryErr = e }
      if (canaryErr !== null && String(canaryErr.message).includes('temp-home canary tripped') && __rmCalls.length === rmCountBefore) {
        ok('W2. cleanup canary red path: outside tmp → throws, never rm')
      } else {
        bad('W2. cleanup canary red path', `err=${canaryErr} rmCalls=${__rmCalls.length}`)
      }
      rmSync(tmpHome, { recursive: true, force: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  // ── W3 扰动真红：把 runCli 定义塞回消费文本，判据必须报红（非恒真）──────────
  {
    const live = read(CONSUMERS[0])
    const polluted = live + '\nconst runCli = (args) => args\n'
    const v = violations(polluted)
    if (live !== null && v.some((s) => s.includes('runCli 定义形态'))) {
      ok('W3. perturbation red: re-embedding runCli is caught', `${v.length} violation(s)`)
    } else {
      bad('W3. perturbation not caught', JSON.stringify(v))
    }
  }

  // ── W4 登记钉：NOT_A_TEST 含 live-harness.mjs（共享挂具不是用例）────────────
  {
    const va = read('scripts/verify-all.mjs') ?? ''
    if (/const NOT_A_TEST = new Set\(\[[^\]]*'live-harness\.mjs'/u.test(va)) {
      ok('W4. live-harness.mjs registered in verify-all NOT_A_TEST')
    } else {
      bad('W4. NOT_A_TEST registration missing', 'live-harness.mjs not in scripts/verify-all.mjs NOT_A_TEST')
    }
  }
} catch (error) {
  bad('live-harness guard run', String(error?.stack ?? error))
}

report('LIVE HARNESS GUARD')

/** 守卫进程内的假 child：cleanup 会 kill 它、等 exit、等 stdout/stderr 的 close。 */
function guardFakeChild(killLog = []) {
  const child = new EventEmitter()
  child.stdout = { destroyed: false, on: () => {}, once: (ev, cb) => { if (ev === 'close') queueMicrotask(cb) } }
  child.stderr = { destroyed: false, on: () => {}, once: (ev, cb) => { if (ev === 'close') queueMicrotask(cb) } }
  child.kill = (sig) => { killLog.push(sig); process.nextTick(() => child.emit('exit', 0)); return sig }
  return child
}
