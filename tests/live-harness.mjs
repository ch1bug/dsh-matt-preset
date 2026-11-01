/**
 * live-harness.mjs —— 两个 live 用例（verify-live-tool-call.mjs / verify-clean-env-e2e.mjs）
 * 的共享挂具（#81）。这两处挂具此前近乎逐行同形且已"复制后走样"过一次：
 * #75 的 cleanup 修了"等 stdout/stderr 管道关闭"，verify-live-tool-call 仍是旧写法
 * （成功路径靠后面的 await 侥幸躲过 libuv 断言，失败路径会踩）。本模块把四块收一处：
 *
 *   1. `createSseMock` — Anthropic-协议 SSE mock LLM 工厂（`--port 0`，捕获真实请求）；
 *   2. `runCli`        — 源码检出 CLI 跑法（`node --import tsx/esm <cli>`，cwd=检出根，
 *                         `DSH_HOME` 指向临时 home）；
 *   3. `rpc`           — typert RPC 壳（命名参数 `request` 包裹）；
 *   4. `cleanup`       — kill → 等 exit → **等 stdout/stderr 管道关闭**（#75 的修法，烘焙在
 *                         此处，两个消费方不再各写一份）→ `mock.close()` → canary 后删临时
 *                         home。不等管道关：失败路径（保留现场 / 直接 process.exit）会撞
 *                         libuv `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`，
 *                         退出码变成崩溃码（#75 实测 -1073740791），把"哪一环红"的读数埋掉。
 *
 * 另导出 `assertTempHome`（2026-10-18 事故硬化的临时 home canary）：cleanup 内部删前断言
 * 用它，两个消费方在 home 建好时也各断言一次。除这五个导出外不增导出面——形状守卫
 * （tests/verify-live-harness.mjs）钉住导出面与"消费方不再各自内嵌四块"。
 *
 * 本文件是**共享挂具，不是用例**：已在 scripts/verify-all.mjs 的 `NOT_A_TEST` 登记
 * （同 tests/preset-harness.mjs 先例），不会被汇总当用例执行。
 *
 * 门禁与断言语义都在两个消费方文件里，本模块不带任何断言；两个用例的门禁
 * （`DSH_MATT_LIVE_CLI`）、`SKIP (loud)` 文案、退出码语义不因抽取而变（#81 out-of-scope）。
 */
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** canary（2026-10-18 事故硬化）：清理目标必须留在系统临时目录内——`rm(home)` 的 home 一旦
 *  解析错（如继承到真实 `DSH_HOME`），删的就是真实 home。删前再断言一次，把「错路径」变成
 *  显式失败而不是静默事故。 */
const TMP_ROOT = resolve(tmpdir())
export const assertTempHome = (p) => {
  const rel = relative(TMP_ROOT, resolve(p))
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`temp-home canary tripped: ${p} is outside ${TMP_ROOT}`)
  }
}

/** Anthropic-协议 SSE 帧（同上游 apps/web smoke 的 mock provider 形状）。 */
const sse = (events) => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')

/**
 * SSE mock LLM 工厂。起在 `127.0.0.1:0`（OS 临时分配，不占保留口），两轮确定性应答：
 * 没见过 `tool_result` → 发一个 `toolName` 的 tool_use（驱动实例真的执行工具）；
 * 见过 → 发 `finalText` 的 end_turn。每个真实请求都被**捕获**进 `captured`
 * （agent 主请求带工具面；会话标题请求不带——消费方按结构定位，别靠内容自证）。
 *
 * @param {{
 *   tag: string,          // 帧内 id 前缀（消费方各自取名，如 'live' / 'clean'）
 *   toolName: string,     // 第一轮 tool_use 的工具名
 *   finalText: string,    // 第二轮 end_turn 的文本
 *   promptText?: string,  // 给了则捕获记录带 promptSeen（该提示词是否出现在 messages 里）
 * }} options
 * @returns {Promise<{server: import('node:http').Server, port: number,
 *                     captured: object[], close: () => void}>}
 */
export const createSseMock = ({ tag, toolName, finalText, promptText } = {}) => new Promise((resolveMock) => {
  /** 捕获到的请求（实例发出的真实模型请求）与 mock 的应答策略。 */
  const captured = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let parsed = {}
      try { parsed = JSON.parse(body) } catch { /* keep raw */ }
      const messages = Array.isArray(parsed.messages) ? parsed.messages : []
      const text = JSON.stringify(messages)
      const sawToolResult = text.includes('tool_result')
      captured.push({
        system: typeof parsed.system === 'string' ? parsed.system : undefined,
        // agent 主请求带工具面；会话标题请求不带——用结构定位，别靠内容自证（否则
        // "模型面含正文"的断言会变成同义反复）。
        hasTools: Array.isArray(parsed.tools) && parsed.tools.length > 0,
        promptSeen: promptText === undefined ? false : text.includes(promptText),
        sawToolResult,
        messages,
      })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      if (!sawToolResult) {
        // 第一轮：让模型发起一次工具调用（证明调用侧真的能打到工具面）。
        res.write(sse([
          { type: 'message_start', message: { id: `${tag}-1`, model: 'mock', usage: { input_tokens: 1, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${tag}_1`, name: toolName, input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ]))
      } else {
        res.write(sse([
          { type: 'message_start', message: { id: `${tag}-2`, model: 'mock', usage: { input_tokens: 1, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: finalText } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ]))
      }
      res.end()
    })
  })
  server.listen(0, '127.0.0.1', () => resolveMock({
    server,
    port: server.address().port,
    captured,
    close: () => server.close(),
  }))
})

/**
 * 跑源码检出的 CLI（bootstrap / dump-config / plugin add）：`node --import tsx/esm <cli>`。
 * cwd 必须在检出内（否则 `tsx/esm` 解析不到）；`DSH_HOME` 一律指向临时 home，
 * `DSH_TELEMETRY_DISABLED=1` 固定注入，`env` 追加/覆盖其余变量。
 * stdout 与 stderr 合并进 `out`（诊断够用；实例类长命子进程不走这里——那是断言对象，
 * 由消费方自己 spawn）。
 *
 * @returns {Promise<{code: number|null, out: string}>}
 */
export const runCli = (cli, args, { cwd, home, env = {} } = {}) => new Promise((resolveRun) => {
  const p = spawn(process.execPath, ['--import', 'tsx/esm', cli, ...args], {
    cwd,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ...env },
  })
  let out = ''
  p.stdout.on('data', (c) => { out += c })
  p.stderr.on('data', (c) => { out += c })
  p.on('exit', (code) => resolveRun({ code, out }))
})

/**
 * typert RPC 壳：POST `<origin>/api/<endpoint>`。typert descriptor 的命名参数是
 * `request`（session/create|prompt 的签名是 (request, signal)），故 args 必须包成
 * `{ request: … }`。非 2xx 或 `result.ok !== true` 都抛错（消费方决定哪一环报红）。
 *
 * @param {string} rpcIdPrefix 进 RPC id 的前缀（消费方各自取名，便于日志归因；无断言消费）
 * @returns {Promise<object>} `result.value`
 */
export const rpc = async (origin, cookie, endpoint, args, rpcIdPrefix) => {
  const response = await fetch(`${origin}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `${rpcIdPrefix}-${endpoint}`, method: endpoint, payload: { args: { request: args } } }),
  })
  if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const body = await response.json()
  if (body.result?.ok !== true) throw new Error(`${endpoint}: ${JSON.stringify(body.result?.error ?? body).slice(0, 300)}`)
  return body.result.value
}

/** 等 stdio 管道真正关闭（null/destroyed 视为已关闭）。 */
const streamClosed = (stream) => (stream === null || stream.destroyed === true)
  ? Promise.resolve()
  : new Promise((r) => { stream.once('close', r); setTimeout(r, 2000) })

/**
 * 收尾（kill → 等 exit → 等 stdio 关闭 → mock.close → canary 后删临时 home）。
 * 三段都可选：传了 `child` 才 kill；传了 `mock` 才 close；传了 `home` 才删。
 *
 * kill 后必须等子进程真正退出**再等 stdout/stderr 管道关闭**：不等时，失败路径
 * （保留现场 / 不再 await 别的东西后直接 process.exit）会撞 libuv 的
 * `UV_HANDLE_CLOSING` 断言，退出码变成崩溃码（#75 实测 -1073740791），把"哪一环红"
 * 的读数埋掉——成功路径靠后面的 await 侥幸躲过不算修好。本修法随 #81 烘焙在此，
 * 两个消费方不再各写一份（dev-environment §0.2 记了配方）。
 *
 * @param {{child?: import('node:child_process').ChildProcess,
 *          mock?: import('node:http').Server,
 *          home?: string}} targets
 */
export const cleanup = async ({ child, mock, home } = {}) => {
  if (child !== undefined) {
    const exited = new Promise(r => child.once('exit', r))
    child.kill('SIGKILL')
    await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
    await Promise.race([
      Promise.all([streamClosed(child.stdout), streamClosed(child.stderr)]),
      new Promise(r => setTimeout(r, 3000)),
    ])
  }
  mock?.close()
  if (home !== undefined) {
    assertTempHome(home)
    await rm(home, { recursive: true, force: true }).catch(() => {})
  }
}
