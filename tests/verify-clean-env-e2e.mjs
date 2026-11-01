/**
 * verify-clean-env-e2e.mjs —— #75 纯净环境全链 e2e（套件成员）。
 *
 * 从零的**临时 DSH_HOME** 起，一条链走完：
 *   A 安装：DSH 标准 bootstrap（`--from-default-profile web`）→ 仓内安装器
 *          （`bin/install.mjs install --profile <p>`，走 store 路径 + profile 挂载）；
 *   B 启动：`--dump-config` 组合树 + 真实实例起在 `--port 0`；
 *   C 会话：RPC 真实建会话（带 matt preset）；
 *   D turn：mock LLM 驱动一轮真实请求 → 模型面含注入正文 + 门禁基线，工具调用真被执行。
 *
 * 与既有用例的分工（#75 票面的"分段覆盖"）：
 *   - verify-installer.mjs：装到 `--dump-config` + 插件可 import 为止，**不启动、无 turn**；
 *   - verify-live-tool-call.mjs：启动 + 建会话 + turn，但装法是 `dsh plugin add <仓目录>`，
 *     **绕过了我们的 installer**；
 *   - verify-workflow-core-render.mjs：读**已部署** home，不执行安装；
 *   - 本文件：唯一的"从零 home + 我们的 installer → 起得来 → 模型看到什么"闭环。
 *
 * 一环一断言，失败可定位到环节（A/B/C/D/Z 前缀）。前置环节已红时，后续环不再假装运行，
 * 但**一定会出声**（`– ` 行交代"未运行 + 因为谁红了"）：缺行是静默。
 *
 * 隔离（绝不碰 19501 / 19502 / 19387）：临时 DSH_HOME（os.tmpdir）+ 实例与 mock LLM
 * 都用 `--port 0`（OS 临时分配）；三个保留口在跑前/跑后各取一次**占用快照**，快照必须不变
 * （B5）。只断言"分到的端口不是保留口"是**恒真**的（端口 0 不会分到这些低位口），不会为红。
 * 跑完**一律**删临时 home（成功失败都删；失败定位靠逐环读数，与 verify-installer
 * 「失败保留 tmp」的旧口径不同——本票 AC 是"跑完清理"）。
 *
 * 门禁：未设 DSH_MATT_LIVE_CLI（源码检出的 CLI 入口）→ **响亮跳过**（`SKIP (loud)`、
 * exit 0，verify-all 记为 PASS*）。
 *
 * 挂具（SSE mock / runCli / rpc / cleanup，含 #75 的"等 stdio 管道关闭再退出"修法）自 #81
 * 起收进 tests/live-harness.mjs，本文件只留断言与门禁。
 *
 * 安装环的**挂载那半边**还需要 PATH 上有字面 `dsh`：`bin/install.mjs` 的 `mountOrWarn`
 * shell out 到它（#67 根因）。本文件**不造包装**（操作者按 docs/dev-environment §3.1
 * 预配 PATH），也**不自己再探一份** `dsh --version`（#78：测试 `dshOnPath` 与安装器
 * `dshAvailable()` 已是两份同构探针，漂移会重开 #67）——改为**消费安装器自己的降级告警**
 * （"dsh not found on PATH"）判定环境缺席：缺席时 store 侧断言照常实跑（与 #67 的
 * gating 同构），挂载及其后各环（B1–D4）响亮跳过。
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { payloadOf } from '../lib/payload.mjs'
import { assertTempHome, cleanup, createSseMock, rpc, runCli } from './live-harness.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(REPO, 'bin', 'install.mjs')
const PROFILE = 'matt-clean'
const TOOL_NAME = 'context_status' // 由 workflow-enforcer 注册；无需审批门
const PROMPT_TEXT = 'Run the context status tool once, then confirm.'
/** 本工作区管理的端口（隔离契约：docs/dev-environment.md §1 的表）。改那张表时这里要跟着改
 *  ——仓内没有这份清单的代码常量，快照探针只能就地手抄。 */
const RESERVED_PORTS = [19501, 19502, 19387]

const results = []
let skips = 0
const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))
/** 前置环节已红、本环无从运行时的显式交代——"失败可定位到环节"不允许出现静默缺行。 */
const note = (s) => results.push('  – ' + s)
/** 环境侧断言缺席的统一出口：`SKIP (loud)` 是 scripts/verify-all.mjs 识别 PASS* 的约定串。 */
const loudSkip = (what) => {
  skips++
  console.warn(`  !! SKIP (loud) - ${what} — evidence absent on this machine`)
}

const CLI = process.env.DSH_MATT_LIVE_CLI
if (!CLI) {
  loudSkip(
    'clean-env e2e needs DSH_MATT_LIVE_CLI (source checkout CLI entry, e.g. ' +
      '<src>/apps/cli/src/bin.ts) — the whole install→start→session→turn chain is unverified',
  )
  console.log('\n=== CLEAN-ENV E2E (install → start → session → turn) ===')
  console.log(results.join('\n'))
  process.exit(0)
}

/** 门禁的 CLI 入口是**源码检出**形态（票面：需 tsx），故与 verify-live-tool-call 同形：
 *  统一 `--import tsx/esm`，且 cwd 必须在 checkout 内，否则 `tsx/esm` 解析不到。 */
const SRC_ROOT = resolve(CLI, '../../..') // 同 verify-live-tool-call：tsx 解析锚点
const NODE_ARGS = (args) => ['--import', 'tsx/esm', CLI, ...args]

const home = await mkdtemp(join(tmpdir(), 'dsh-matt-clean-'))
// canary（2026-10-18 事故硬化）：清理目标必须留在系统临时目录内（判据在 live-harness）。
assertTempHome(home)

/** 跑 CLI（bootstrap / dump-config）：DSH_HOME 一律指向临时 home（挂具在 live-harness）。 */
const runCliHere = (args, env = {}) => runCli(CLI, args, { cwd: SRC_ROOT, home, env })

/** 读 JSON；读不出返回 undefined，让所在环节自己报红，而不是把整条链炸成一个笼统的 bad。 */
const readJsonMaybe = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined }
}

const rpcHere = (origin, cookie, endpoint, args) => rpc(origin, cookie, endpoint, args, 'clean')

// ── 保留口占用快照（本用例**一切动作之前**取；跑之后在 finally 里再取一次比对）──────
// 覆盖范围 = 此后 mock LLM / bootstrap / 安装 / 实例的所有建连行为。

/** 保留口占用探针（TCP connect）：只回答"这一刻是否有人占着"，不判归属。 */
const portTaken = (port) => new Promise((resolveProbe) => {
  const socket = connect({ host: '127.0.0.1', port })
  const timer = setTimeout(() => finish(false), 1500)
  function finish(value) {
    clearTimeout(timer)
    socket.destroy()
    resolveProbe(value)
  }
  socket.once('connect', () => finish(true))
  socket.once('error', () => finish(false))
})
const reservedSnapshot = async () => Object.fromEntries(
  await Promise.all(RESERVED_PORTS.map(async (p) => [p, await portTaken(p)])))
const reservedBefore = await reservedSnapshot()

/** SSE mock LLM（#81 起挂具收进 tests/live-harness.mjs：捕获实例发出的真实请求）。 */
const mock = await createSseMock({ tag: 'clean', toolName: TOOL_NAME, finalText: 'clean-env-e2e-complete', promptText: PROMPT_TEXT })
const captured = mock.captured
const mockPort = mock.port

let child
let instancePort

/** 挂载那半边的环境判定：消费安装器自己的降级告警，不另探一份 dsh（#78）。 */
let mountDegraded = false
let installOut = ''
/** 安装器输出剔掉 node 自己的弃用警告（`shell:true` 触发），失败详情才看得见安装器的话。 */
const installDetail = () => installOut
  .split('\n')
  .filter((l) => !/^\(node:\d+\)|^\(Use `node --trace-deprecation/u.test(l))
  .join('\n')
  .trim()
  .slice(-300)
const seenSystems = () => JSON.stringify(captured.map(c =>
  (c.system ?? '').slice(0, 60) + (c.hasTools ? ' [tools]' : '')))

// 保留口占用快照（跑之前，见上）；跑之后在 finally 里再取一次比对（那时实例还活着）。

try {
  // ── A0 安装（DSH 标准 bootstrap）：临时 home 上从 shipped web 模板起 profile ──
  const boot = await runCliHere(['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'])
  const profileDir = join(home, 'profiles', PROFILE)
  const profilePkg = boot.code === 0 ? await readJsonMaybe(join(profileDir, 'package.json')) : undefined
  const bundlesBefore = profilePkg?.dsh?.profile?.bundles ?? []
  if (boot.code === 0 && bundlesBefore.includes('@deepseek-ai/dsh-web-app')) {
    ok('A0. bootstrap: profile initialized from the shipped web default (full web mount)', PROFILE)
  } else {
    bad('A0. bootstrap from the shipped web default', `exit ${boot.code} bundles=${JSON.stringify(bundlesBefore)} ${boot.out.slice(-200)}`)
  }

  // ── A1 安装（我们的 installer）：store 落盘（VERSION + manifest 逐条一致）──
  const install = spawnSync(process.execPath, [BIN, 'install', '--profile', PROFILE], {
    encoding: 'utf8',
    cwd: REPO,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  })
  installOut = `${install.stdout ?? ''}${install.stderr ?? ''}`
  mountDegraded = /dsh not found on PATH — skipped profile mount/u.test(installOut)
  const store = join(home, '.agent-presets', 'matt')
  const repoPkg = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'))
  // 单一事实源：清单比对就地消费安装器自己的 payload 规则（lib/payload.mjs），不手抄第二份
  // 展开语义（code-review-brief §7 的既有发现）。这条同源比对抓的是"store 不是本次安装的
  // 产物"；payload 语义本身的独立防线是 A2 的落盘存在性与离线 verify-payload-manifest.mjs。
  const { entries } = await payloadOf(REPO)
  const stamp = await readJsonMaybe(join(store, 'VERSION.json'))
  const manifest = await readJsonMaybe(join(store, 'manifest.json'))
  if (stamp === undefined || manifest === undefined) {
    bad('A1. install: store stamped (VERSION + manifest == payload)',
      `no VERSION.json/manifest.json at ${store} — installer exit ${install.status}: ${installDetail()}`)
  } else {
    try {
      assert.equal(install.status, 0, `installer exit ${install.status}: ${installDetail()}`)
      assert.equal(stamp.version, repoPkg.version, 'VERSION.json version')
      assert.equal(manifest.profile, PROFILE, 'manifest records the profile it was linked into')
      assert.deepEqual(manifest.files, entries, 'manifest.files must be the installer payload verbatim')
      ok('A1. install: store stamped (VERSION + manifest == payload)', `${stamp.version}, ${entries.length} entries`)
    } catch (error) {
      bad('A1. install: store stamped (VERSION + manifest == payload)', String(error?.message ?? error))
    }
  }

  // ── A2 安装：payload 逐条落盘 + 排除项不泄漏 + 运行时依赖随副本走 ─────────
  // 不依赖 A1 的成败：store 路径偏差（如 DSH_MATT_ROOT 指到别处）时本环必须自己红，
  // 而不是静默消失（票面"对应环必须红"）。
  {
    const absent = entries.filter((e) => !existsSync(join(store, e)))
    const leaked = ['docs', 'tests', '.git', 'CONTEXT.md'].filter((f) => existsSync(join(store, f)))
    // 插件 import 'yaml' 的解析锚点是插件文件自身 → 依赖必须随安装副本走
    const yaml = existsSync(join(store, 'node_modules', 'yaml', 'package.json'))
    if (absent.length === 0 && leaked.length === 0 && yaml) {
      ok('A2. install: payload landed verbatim (no leak, yaml vendored)', `${entries.length} entries`)
    } else {
      bad('A2. install: payload landed verbatim',
        `missing ${absent.length}/${entries.length} (e.g. ${absent.slice(0, 3).join(', ') || '-'}) leaked=[${leaked.join(', ')}] yaml=${yaml} — store=${store}`)
    }
  }

  // ── A3 安装：profile 把 store 注册为 bundle（挂载产物，需要 PATH 上的 dsh）──
  if (mountDegraded) {
    loudSkip(
      'install: profile bundle registration needs dsh on PATH (#67 root cause) — the installer reported ' +
        '"dsh not found on PATH — skipped profile mount"; rings B1–D4 (start → session → turn) are dark for the same reason',
    )
  } else {
    try {
      const after = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
      const bundles = after?.dsh?.profile?.bundles ?? []
      const link = String(after?.dependencies?.['dsh-matt-preset'] ?? '')
      assert.ok(bundles.includes('dsh-matt-preset'), `preset not registered as a bundle: ${JSON.stringify(bundles)}`)
      // 机械联系（#47 正是靠人肉才发现的那一环）：profile 的 link 必须指向 A1/A2 断言的那个 store。
      assert.ok(
        /^link:/u.test(link) && resolve(link.slice('link:'.length)) === resolve(store),
        `profile link does not point at the asserted store: ${link} (want ${store})`,
      )
      ok('A3. install: store linked into the profile as a bundle', `${bundles.join(', ')}`)
    } catch (error) {
      bad('A3. install: store linked into the profile as a bundle', `${String(error?.message ?? error)} — installer: ${installDetail()}`)
    }
  }

  if (!mountDegraded) {
    // ── B1 启动：组合树含 workflow-core 行（subpath 寻址）──────────────────
    const dump = await runCliHere(['--profile', PROFILE, '--dump-config'])
    if (dump.code === 0 && dump.out.includes('dsh-matt-preset/workflow-core.mjs')) {
      ok('B1. start: composed tree carries the dsh-matt-preset/workflow-core.mjs row')
    } else {
      bad('B1. start: workflow-core row in the composed tree', `exit ${dump.code}: ${dump.out.slice(-300)}`)
    }

    // ── B2 启动：真实实例起在 --port 0（OS 临时分配）────────────────────────
    child = spawn(process.execPath, NODE_ARGS(['--profile', PROFILE, '--no-open', '--port', '0']), {
      cwd: SRC_ROOT,
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockPort}`,
        DEEPSEEK_API_KEY: 'clean-env-e2e-test-key',
      },
    })
    let instOut = ''
    let instErr = ''
    child.stdout.on('data', (c) => { instOut += c })
    child.stderr.on('data', (c) => { instErr += c })
    let launch
    try {
      launch = await new Promise((resolveUrl, rejectUrl) => {
        const timer = setTimeout(() => rejectUrl(new Error(`instance not ready in 120s\nstdout:${instOut.slice(-300)}\nstderr:${instErr.slice(-600)}`)), 120_000)
        child.stdout.on('data', () => {
          const m = /dsh web: (http:\/\/\S+)/u.exec(instOut)
          if (m) { clearTimeout(timer); resolveUrl(m[1]) }
        })
        child.on('exit', (code) => { clearTimeout(timer); rejectUrl(new Error(`instance exited ${code}: ${instErr.slice(-400)}`)) })
      })
      instancePort = Number(new URL(launch).port)
      ok('B2. start: live instance is up on an OS-assigned port (--port 0)', launch.replace(/token=[^&]+/u, 'token=<redacted>'))
    } catch (error) {
      bad('B2. start: live instance is up', String(error?.message ?? error))
    }

    // ── B3 启动：preset 行真的激活（不是 pending waiting for service）────────
    if (launch === undefined) {
      bad('B3. start: preset row activated in the instance', 'instance never came up')
    } else if (/did not activate|pending \(waiting for service/u.test(instErr)) {
      bad('B3. start: preset row activated in the instance', instErr.slice(-300))
    } else {
      ok('B3. start: the matt preset row activated in the live instance')
    }

    // ── B4 鉴权：printed token → cookie（建会话的前置，证明是完整 web 挂载）──
    let cookie
    let origin
    if (launch !== undefined) {
      try {
        const exchange = await fetch(launch, { redirect: 'manual' })
        const setCookie = exchange.headers.get('set-cookie')
        if (exchange.status === 303 && setCookie !== null) {
          ok('B4. start: token → cookie exchange works (full web mount)')
          cookie = setCookie.split(';', 1)[0]
          origin = new URL(launch).origin
        } else {
          bad('B4. start: token → cookie exchange', `HTTP ${exchange.status}`)
        }
      } catch (error) {
        bad('B4. start: token → cookie exchange', String(error?.message ?? error))
      }
    }

    if (cookie !== undefined) {
      // ── C1 会话：真实建会话（带 matt preset）──────────────────────────────
      let created
      try {
        created = await rpcHere(origin, cookie, 'session/create', { agentPreset: 'dsh-matt-preset', cwd: REPO.replace(/\\/g, '/') })
        if (created?.sessionId !== undefined) ok('C1. session: live session created with the matt preset', String(created.sessionId))
        else bad('C1. session: live session created', JSON.stringify(created))
      } catch (error) {
        bad('C1. session: live session created', String(error?.message ?? error))
      }

      if (created?.sessionId !== undefined) {
        // ── C2 会话：该会话的模型面断面被捕获（靠发出的提示词文本归属）────────
        try {
          await rpcHere(origin, cookie, 'session/prompt', {
            requestId: 'clean-env-request-1',
            sessionId: created.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: PROMPT_TEXT }],
            clientTimeZone: 'Asia/Shanghai',
          })
        } catch (error) {
          bad('C2. session: model-facing snapshot captured', `session/prompt failed: ${String(error?.message ?? error)}`)
        }
        let deadline = Date.now() + 90_000
        while (Date.now() < deadline && !captured.some(c => c.promptSeen)) await new Promise(r => setTimeout(r, 500))
        if (captured.some(c => c.promptSeen)) {
          ok('C2. session: the session\'s model-facing request was captured', `${captured.length} request(s)`)

          // ── D1 turn：模型面含注入的工作流正文（workflow-core）──────────────
          const agentReq = captured.find(c => c.hasTools)
          if (agentReq?.system?.includes('MAIN FLOW — idea → ship') && agentReq.system.includes('WORKFLOW ENFORCEMENT')) {
            ok('D1. turn: the live agent request carries the injected workflow body', `${agentReq.system.length} chars`)
          } else {
            bad('D1. turn: injected workflow body in the agent request', agentReq === undefined
              ? `no tool-carrying request among ${captured.length}: ${seenSystems()}`
              : agentReq.system.slice(0, 300))
          }
          // ── D2 turn：模型面含门禁基线（workflow-enforcer 的 workflow:gates）──
          if (agentReq?.system?.includes('WORKFLOW GATES')) {
            ok('D2. turn: the live agent request carries the enforcer gates baseline')
          } else {
            bad('D2. turn: enforcer gates baseline in the agent request', JSON.stringify(String(agentReq?.system ?? '').slice(0, 200)))
          }
          // ── D3 turn：注入节插值完毕（无字面 {{…}} 残留）────────────────────
          if (agentReq?.system !== undefined && !agentReq.system.includes('{{model}}')) {
            ok('D3. turn: no literal {{…}} left in the live agent system prompt')
          } else {
            bad('D3. turn: system-prompt interpolation', JSON.stringify(String(agentReq?.system ?? '').slice(0, 300)))
          }

          // ── D4 turn：工具调用真被执行（下一轮请求带 tool_result）────────────
          deadline = Date.now() + 90_000
          while (Date.now() < deadline && !captured.some(c => c.sawToolResult)) await new Promise(r => setTimeout(r, 500))
          const withResult = captured.find(c => c.sawToolResult)
          const resultText = withResult === undefined ? '' : JSON.stringify(withResult.messages)
          if (withResult !== undefined && resultText.includes(TOOL_NAME) && resultText.includes('tool_result')) {
            ok('D4. turn: the live instance EXECUTED the model\'s tool call', `${TOOL_NAME} → tool_result observed`)
          } else {
            bad('D4. turn: tool call executed', withResult === undefined
              ? `no request with tool_result within 90s; requests=${captured.length}`
              : resultText.slice(0, 300))
          }
        } else {
          bad('C2. session: the session\'s model-facing request was captured', `no request carried the prompt within 90s; requests=${captured.length} ${seenSystems()}`)
          note('D1–D4 not run: no model-facing snapshot to assert (C2 red above)')
        }
      } else {
        note('C2–D4 not run: no session to drive (C1 red above)')
      }
    } else if (launch !== undefined) {
      note('C1–D4 not run: no authenticated connection (B4 red above)')
    } else {
      note('B4–D4 not run: the instance never came up (B2 red above)')
    }
  }
} catch (error) {
  bad('clean-env e2e run', String(error?.message ?? error))
} finally {
  // ── B5 隔离：保留口占用快照前后一致（AC「不触碰 19501/19502/19387」）──────
  // 快照要在实例还活着时取：真占了保留口，这一刻才看得见。断言只看**漂移**——被别的东西
  // 占着的保留口（如桌面端 19387）看不到归属，本环只保证"状态不被我们改变"。
  const reservedAfter = await reservedSnapshot()
  const drifted = RESERVED_PORTS.filter((p) => reservedBefore[p] !== reservedAfter[p])
  if (drifted.length === 0) {
    ok('B5. isolation: reserved ports untouched (snapshot before == after)',
      `reserved=${RESERVED_PORTS.join('/')} instance=${instancePort ?? '-'} mock=${mockPort}`)
  } else {
    bad('B5. isolation: reserved ports untouched',
      `drifted=[${drifted.map((p) => `${p}: ${reservedBefore[p] ? 'taken' : 'free'} → ${reservedAfter[p] ? 'taken' : 'free'}`).join(', ')}] instance=${instancePort ?? '-'}`)
  }
  // 收尾四合一在 live-harness（kill → 等 exit → 等 stdio 管道关闭 → mock.close → canary 后
  // 删临时 home；#75 的 libuv 修法烘焙在 harness，失败路径不会再把退出码变成崩溃码）。
  await cleanup({ child, mock: mock.server, home })
}

// 清理（AC「跑完清理」）：成功失败都删（rm 已在 harness cleanup 内、canary 删前断言）——
// 失败现场靠上面的逐环读数定位；这里只复核删除确曾发生。
if (!existsSync(home)) ok('Z1. cleanup: temp home removed')
else bad('Z1. cleanup: temp home removed', home)

const failed = results.some(r => r.startsWith('  ✗'))
console.log('\n=== CLEAN-ENV E2E (install → start → session → turn) ===')
console.log(results.join('\n'))
console.log(failed
  ? '\nFAILED — tmp home removed (see the ring lines above)'
  : `\nall clean-env rings passed${skips > 0 ? `（含 ${skips} 条 loud skip：其环境侧断言未验证）` : ''}`)
// 退出用 exitCode 自然排空，不 process.exit 硬杀（同 verify-live-tool-call 尾注：失败路径
// 上父进程还有 socket 在关闭中，硬退撞 libuv UV_HANDLE_CLOSING 断言）。退出码语义不变。
process.exitCode = failed ? 1 : 0