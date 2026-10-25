/**
 * verify-autonomy-orchestration.mjs — 自主化 L2 编排件守卫（O1–O8，#163）。
 *
 * 守什么：`lib/autonomy-orchestration.mjs`（唤醒编排正典）的行为面 + 它的消费面
 * （evals/autonomy/runner.mjs 不得回潮内嵌副本，155族 retro 候选 2）+ 文档同批
 * 落地（正文 batch-mode 节的唤醒编排条与批末审计读数锚、docs/batch-state.md 审计位节）。
 *
 * 每条断言的非空洞性（什么输入让它红）：
 * - O1 改/删编排件导出的常量或函数 → 红（import 真读那份文件）；
 * - O2 判据纯函数的行为：turnState 的 start/end seq 序、subagentsInFlight 的
 *   run2 实测形态（catalog continuable + settledMs=0）、pendingHumanQuestion 的
 *   chain3 实测形态（末尾 ask、无后续 turn/start）——改判定逻辑即红；
 * - O3 runWakeLoop 状态机（mock poll/sendPrompt + 小 policy 加速）：
 *   O3a 是**断链场景核心**——turn/end + 子代理在飞时即使宽限早超也不 nudge
 *   （删掉 subagentHolds 分支 → 旧 runner 行为 → nudges>0 → 红）；O3c 钉 nudge
 *   上限（MAX_NUDGE 改大 → 第二次 nudge 发出 → 红）；O3e/f 钉应答通道；
 * - O4 交付就绪判据在真实 git 夹具上（#50 口径三形态，缺任一要件 → false）；
 * - O5 verifyManifest 的失真复核（错哈希/缺文件/反引号装饰/注释行）；
 * - O6 renderAuditReading 的批末审计读数行格式（改格式 → 字符串比对红）；
 * - O7 单一事实源：runner.mjs 源文本 import 编排件且无内嵌副本字面（加回
 *   `const NUDGE_TEXT` 一类副本 → 红）；handoff-tool.mjs 执行面真消费
 *   `HANDOFF_BOUNDARY` 导出（改回内联数组 → 红）；
 * - O8 文档同批落地：正文批内唤醒编排条 + AUTONOMY DIGEST 的失真率读数锚 +
 *   docs/batch-state.md 批末审计位节在场（删任一 → 红）。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WAKE_POLICY,
  DELIVERABLE_CRITERIA,
  commitsSince,
  pendingHumanQuestion,
  renderAuditReading,
  runWakeLoop,
  subagentsInFlight,
  turnState,
  verifyManifest,
} from '../lib/autonomy-orchestration.mjs'
import { HANDOFF_BOUNDARY, CREDENTIAL_FORMATS } from '../handoff-tool.mjs'
import { fixtureEnv } from './isolated-git.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

// ── 事件流构造器（形状 = #50 实测 events.json 的 records[].event）──────────────
const ev = (seq, type, extra = {}) => ({ seq, type, data: extra })
const page = (...events) => ({ records: events.map((event) => ({ event })) })
const inFlightValues = { subagentCatalog: [{ mode: 'continuable', label: 'Spec review', id: 'a', createdAt: 1 }, { mode: 'continuable', label: 'Standards review', id: 'b', createdAt: 1 }], subagentTiming: { settledMs: 0 } }
const settledValues = { subagentCatalog: [], subagentTiming: { settledMs: 1792837900000 } }

// ── O1 编排件导出契约 ──────────────────────────────────────────────────────────
{
  const checks = [
    [WAKE_POLICY.TURN_END_GRACE_MS === 6 * 60_000, 'TURN_END_GRACE_MS=6min（#50 实测宽限）'],
    [WAKE_POLICY.MAX_NUDGE === 1, 'MAX_NUDGE=1'],
    [WAKE_POLICY.TURN_TIMEOUT_MS === 45 * 60_000, 'TURN_TIMEOUT_MS=45min'],
    [WAKE_POLICY.POLL_MS === 5_000, 'POLL_MS=5s'],
    [typeof WAKE_POLICY.NUDGE_TEXT === 'string' && WAKE_POLICY.NUDGE_TEXT.length > 20, 'NUDGE_TEXT 非空'],
    [typeof DELIVERABLE_CRITERIA.aGroup === 'function', '判据 aGroup 在位'],
    [typeof DELIVERABLE_CRITERIA.relayHop1 === 'function', '判据 relayHop1 在位'],
    [typeof DELIVERABLE_CRITERIA.relayHop2 === 'function', '判据 relayHop2 在位'],
  ]
  const failed = checks.filter(([pass]) => !pass).map(([, label]) => label)
  if (failed.length === 0) ok('O1. 编排件导出契约（常量 + 判据三形态）', 'WAKE_POLICY 5 常量 + DELIVERABLE_CRITERIA 3 形态')
  else bad('O1. 编排件导出面缺失/被改', failed.join(' / '))
}

// ── O2 判据纯函数 ──────────────────────────────────────────────────────────────
{
  // turnState：turn/end 晚于 turn/start → turn-ended；否则 running（含事件流为空）
  const a = turnState(page(ev(1, 'turn/start'), ev(2, 'turn/end'))) === 'turn-ended'
    && turnState(page(ev(1, 'turn/start'), ev(2, 'turn/end'), ev(3, 'turn/start'))) === 'running'
    && turnState(page()) === 'running'
    && turnState(page(ev(1, 'turn/end'), ev(2, 'turn/start'))) === 'running'
  a ? ok('O2a. turnState 按 start/end seq 序判定（#50 retro 候选 2 口径：别用 projections.running）')
    : bad('O2a. turnState 判定漂移')

  // subagentsInFlight：run2 实测形态（两项 continuable + settledMs=0）→ 在飞；
  // settledMs>0 / 空 catalog / 无 continuable 项 → 不在飞；subagentTiming 缺席 + continuable → 保守判在飞
  const b = subagentsInFlight(inFlightValues) === true
    && subagentsInFlight(settledValues) === false
    && subagentsInFlight({ subagentCatalog: [], subagentTiming: { settledMs: 0 } }) === false
    && subagentsInFlight({ subagentCatalog: [{ mode: 'settled', id: 'x' }], subagentTiming: { settledMs: 0 } }) === false
    && subagentsInFlight({ subagentCatalog: [{ mode: 'continuable', id: 'x' }] }) === true
  b ? ok('O2b. subagentsInFlight（run2 实测形态 + 落定/空/非 continuable 反例 + 缺席保守判在飞）')
    : bad('O2b. 子代理在飞判据漂移')

  // pendingHumanQuestion：chain3 实测形态（末尾 ask、无后续 turn/start）→ 问题文本；
  // ask 后有更大 seq 的 turn/start（已被应答续跑）→ null；无 ask → null
  const askArgs = JSON.stringify({ questions: [{ id: 'batch-end-push', header: '批次收尾', question: 'push 步无从执行，你想怎么收尾？', options: [] }] })
  const q = pendingHumanQuestion(page(ev(1, 'turn/start'), ev(2, 'assistant/message'), ev(3, 'tool/call', { name: 'ask_user_question', arguments: askArgs })))
  const c = q !== null && q.text.includes('push 步无从执行') && q.seq === 3
    && pendingHumanQuestion(page(ev(1, 'turn/start'), ev(2, 'tool/call', { name: 'ask_user_question', arguments: askArgs }), ev(3, 'turn/start'))) === null
    && pendingHumanQuestion(page(ev(1, 'turn/start'), ev(2, 'turn/end'))) === null
    && pendingHumanQuestion(page(ev(1, 'tool/call', { name: 'bash', arguments: 'ls' }))) === null
    // arguments 为对象形态（部分 runtime 不字符串化）也要能提取
    && pendingHumanQuestion(page(ev(1, 'tool/call', { name: 'ask_user_question', arguments: { questions: [{ question: '对象形态' }] } })))?.text === '对象形态'
  c ? ok('O2c. pendingHumanQuestion（chain3 实测末尾 ask 形态 + 已应答续跑不误报 + 对象形态兼容）')
    : bad('O2c. 问询挂起判据漂移')
}

// ── O3 runWakeLoop 状态机（mock poll/sendPrompt；小 policy 加速）───────────────
// Windows 计时器精度下 setTimeout(1) 实际 ~15ms，故 GRACE=40ms 约每 3 tick 超限。
const FAST = { POLL_MS: 1, TURN_TIMEOUT_MS: 8_000, TURN_END_GRACE_MS: 40, MAX_NUDGE: 1, NUDGE_TEXT: WAKE_POLICY.NUDGE_TEXT }
/** mock poll：按 tick 序返回 plan 项（末项重复）。 */
const planPoll = (plan) => { let i = 0; return async () => plan[Math.min(i++, plan.length - 1)] }

{
  // O3a 断链场景核心（#50 两次实测断链形态：交付未齐 + 子代理在飞 + turn/end）：
  // 在飞期间宽限早超也不 nudge（hold 到子代理落定/续跑，交付才齐）
  const sent = []
  const subagentTick = { page: page(ev(1, 'turn/start'), ev(2, 'turn/end')), projections: { values: inFlightValues } }
  const resumeTick = { page: page(ev(1, 'turn/start'), ev(2, 'turn/end'), ev(3, 'turn/start'), ev(4, 'turn/end')), projections: { values: settledValues } }
  let tick = 0
  const HOLD_TICKS = 6 // 计时器精度 ~15ms/tick → hold 段 ~90ms，宽限 40ms 早已超而零 nudge
  const res = await runWakeLoop({
    poll: async () => { tick += 1; return tick <= HOLD_TICKS ? subagentTick : resumeTick },
    sendPrompt: async (t) => { sent.push(t) },
    deliverableReady: () => tick > HOLD_TICKS, // 交付在续跑后的 turn 里完成（断链原始形态）
    policy: FAST,
  })
  if (res.status === 'delivered' && res.nudges === 0 && res.subagentHolds >= HOLD_TICKS && sent.length === 0)
    ok('O3a. 断链场景：子代理在飞时 turn/end 不判死（hold≥6 tick、宽限 40ms 早已超、零 nudge）', `holds=${res.subagentHolds} status=${res.status}`)
  else
    bad('O3a. 子代理在飞时提前判死（唤醒编排核心失效）', `status=${res.status} nudges=${res.nudges} holds=${res.subagentHolds} sent=${sent.length}`)
}

{
  // O3b 闲置 nudge 一次后恢复：nudge 文本 = WAKE_POLICY.NUDGE_TEXT（编排件正典，非 runner 自带）
  const sent = []
  const idleTick = { page: page(ev(1, 'turn/start'), ev(2, 'turn/end')), projections: { values: settledValues } }
  const resumeTick = { page: page(ev(1, 'turn/start'), ev(2, 'turn/end'), ev(3, 'turn/start'), ev(4, 'turn/end')), projections: { values: settledValues } }
  const res = await runWakeLoop({
    poll: planPoll([idleTick, idleTick, idleTick, idleTick, idleTick, idleTick, resumeTick]),
    sendPrompt: async (t) => { sent.push(t) },
    deliverableReady: () => sent.includes(WAKE_POLICY.NUDGE_TEXT),
    policy: FAST,
  })
  if (res.status === 'delivered' && res.nudges === 1 && sent.filter((t) => t === WAKE_POLICY.NUDGE_TEXT).length === 1)
    ok('O3b. 闲置超宽限 + 交付未齐 → 恰 1 次 nudge，nudge 后交付齐 → delivered', `nudges=${res.nudges}`)
  else
    bad('O3b. nudge 触发/计量漂移', `status=${res.status} nudges=${res.nudges} sent=${sent.length}`)
}

{
  // O3c nudge 用尽仍闲置 → 如实停（不无限戳）
  const sent = []
  const idleTick = { page: page(ev(1, 'turn/start'), ev(2, 'turn/end')), projections: { values: settledValues } }
  const res = await runWakeLoop({
    poll: planPoll([idleTick]),
    sendPrompt: async (t) => { sent.push(t) },
    deliverableReady: () => false,
    policy: FAST,
  })
  if (res.status === 'idle-after-nudge' && res.nudges === 1 && sent.length === 1)
    ok('O3c. MAX_NUDGE=1 用尽后如实停（idle-after-nudge，不二次戳）')
  else
    bad('O3c. nudge 上限失效', `status=${res.status} nudges=${res.nudges} sent=${sent.length}`)
}

{
  // O3d 交付就绪的闲置 → 直接收场，不 nudge
  const sent = []
  const idleTick = { page: page(ev(1, 'turn/start'), ev(2, 'turn/end')), projections: { values: settledValues } }
  const res = await runWakeLoop({
    poll: planPoll([idleTick]),
    sendPrompt: async (t) => { sent.push(t) },
    deliverableReady: () => true,
    policy: FAST,
  })
  if (res.status === 'delivered' && res.nudges === 0 && sent.length === 0)
    ok('O3d. 交付就绪判据满足 → 直接收场零 nudge（判据外不触发）')
  else
    bad('O3d. 交付已齐仍 nudge', `status=${res.status} nudges=${res.nudges} sent=${sent.length}`)
}

{
  // O3e 应答通道（代答）：ask 挂起 → 转达 → 应答注入（sendPrompt 收到应答文本）→ 计量
  const sent = []
  const relayed = []
  const askArgs = JSON.stringify({ questions: [{ question: 'push 步无从执行，怎么收尾？' }] })
  const askTick = { page: page(ev(1, 'turn/start'), ev(2, 'tool/call', { name: 'ask_user_question', arguments: askArgs })), projections: { values: settledValues } }
  const idleTick = { page: page(ev(1, 'turn/start'), ev(2, 'turn/end')), projections: { values: settledValues } }
  const res = await runWakeLoop({
    poll: planPoll([askTick, askTick, askTick, idleTick]),
    sendPrompt: async (t) => { sent.push(t) },
    deliverableReady: () => true,
    onAwaitingHuman: async (q) => { relayed.push(q.text); return 'human 应答：按本地收尾结束' },
    policy: FAST,
  })
  if (res.status === 'delivered' && res.humanRelays === 1 && relayed.length === 1 && relayed[0].includes('push 步无从执行') && sent.includes('human 应答：按本地收尾结束'))
    ok('O3e. 应答通道：ask 挂起转达 onAwaitingHuman → 应答注入 prompt → humanRelays 计量（chain3 断点修复；同一挂起重复 tick 不重复注入）')
  else
    bad('O3e. 应答通道断/未计量/重复注入', `status=${res.status} relays=${res.humanRelays} relayed=${relayed.length} sent=${sent.length}`)

  // O3e2 防重入不误伤新问询：代答后新 turn 起来、又出现**新 seq** 的 ask → 允许再转达
  const sent2 = []
  const ask1 = { page: page(ev(1, 'turn/start'), ev(2, 'tool/call', { name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ question: '第一问' }] }) })), projections: { values: settledValues } }
  const resumed = { page: page(ev(1, 'turn/start'), ev(3, 'turn/start'), ev(4, 'turn/end')), projections: { values: settledValues } }
  const ask2 = { page: page(ev(1, 'turn/start'), ev(3, 'turn/start'), ev(5, 'tool/call', { name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ question: '第二问' }] }) })), projections: { values: settledValues } }
  const idle2 = { page: page(ev(1, 'turn/start'), ev(3, 'turn/start'), ev(6, 'turn/start'), ev(7, 'turn/end')), projections: { values: settledValues } }
  let relayCount = 0
  const res2 = await runWakeLoop({
    poll: planPoll([ask1, ask1, ask1, resumed, ask2, ask2, idle2]),
    sendPrompt: async (t) => { sent2.push(t) },
    deliverableReady: () => relayCount >= 2,
    onAwaitingHuman: async () => { relayCount += 1; return `应答 ${relayCount}` },
    policy: FAST,
  })
  if (res2.status === 'delivered' && res2.humanRelays === 2 && sent2.filter((t) => t.startsWith('应答')).length === 2)
    ok('O3e2. 同一挂起只转达一次，新 seq 问询可再转达（humanRelays=2）')
  else
    bad('O3e2. 防重入误伤新问询（或新问询漏转达）', `status=${res2.status} relays=${res2.humanRelays} answers=${sent2.filter((t) => t.startsWith('应答')).length}`)
}

{
  // O3f 无应答方 → 停在 awaiting-human，问题全文随结论携带（不再被总超时截断）
  const askArgs = JSON.stringify({ questions: [{ question: '需要你拍板 X' }] })
  const askTick = { page: page(ev(1, 'turn/start'), ev(2, 'tool/call', { name: 'ask_user_question', arguments: askArgs })), projections: { values: settledValues } }
  const res = await runWakeLoop({
    poll: planPoll([askTick]),
    sendPrompt: async () => {},
    deliverableReady: () => false,
    onAwaitingHuman: async () => null,
    policy: FAST,
  })
  if (res.status === 'awaiting-human' && res.lastQuestion !== null && res.lastQuestion.text.includes('需要你拍板 X'))
    ok('O3f. onAwaitingHuman 回 null → 停在 awaiting-human 且携带问题全文')
  else
    bad('O3f. 挂起问询被静默截断', `status=${res.status} lastQuestion=${JSON.stringify(res.lastQuestion)?.slice(0, 60)}`)
}

{
  // O3g 总超时兜底（子代理在飞永不落定等场景）
  const runningTick = { page: page(ev(1, 'turn/start')), projections: { values: inFlightValues } }
  const res = await runWakeLoop({
    poll: planPoll([runningTick]),
    sendPrompt: async () => {},
    deliverableReady: () => false,
    policy: { ...FAST, TURN_TIMEOUT_MS: 20 },
  })
  if (res.status === 'timeout') ok('O3g. 总超时兜底（TURN_TIMEOUT_MS）仍管 hold 场景')
  else bad('O3g. 总超时失效', `status=${res.status}`)
}

{
  // O3h run163 真跑实测形态：交付已齐 + 子代理在飞（评审 continuable 不落定）+ 无续跑
  // → 宽限后 delivered 收场（hold 兜「交付未齐的提前死亡」，不是无限白等到总超时）
  const sent = []
  const holdTick = { page: page(ev(1, 'turn/start'), ev(2, 'turn/end')), projections: { values: inFlightValues } }
  const res = await runWakeLoop({
    poll: planPoll([holdTick]),
    sendPrompt: async (t) => { sent.push(t) },
    deliverableReady: () => true,
    policy: FAST,
  })
  if (res.status === 'delivered' && res.nudges === 0 && res.subagentHolds >= 3 && sent.length === 0)
    ok('O3h. 交付齐 + 子代理在飞 + 无续跑 → 宽限后 delivered（run163 形态：不拖到总超时、不 nudge）', `holds=${res.subagentHolds}`)
  else
    bad('O3h. 交付齐的 hold 场景劣化为白等/误 nudge', `status=${res.status} nudges=${res.nudges} holds=${res.subagentHolds} sent=${sent.length}`)
}

{
  // O3h2 对照组：交付未齐 + 子代理在飞 + 无续跑 → 维持 hold 到总超时（不 nudge——
  // nudge 的设计场景是「子代理已落定但没有新 turn」，NUDGE_TEXT 同口径）
  const sent = []
  const holdTick = { page: page(ev(1, 'turn/start'), ev(2, 'turn/end')), projections: { values: inFlightValues } }
  const res = await runWakeLoop({
    poll: planPoll([holdTick]),
    sendPrompt: async (t) => { sent.push(t) },
    deliverableReady: () => false,
    policy: { ...FAST, TURN_TIMEOUT_MS: 60 },
  })
  if (res.status === 'timeout' && res.nudges === 0 && res.subagentHolds >= 3 && sent.length === 0)
    ok('O3h2. 交付未齐 + 子代理在飞 → hold 到总超时、零 nudge（在飞期间不戳）', `holds=${res.subagentHolds}`)
  else
    bad('O3h2. 在飞期间误 nudge 或提前死', `status=${res.status} nudges=${res.nudges} holds=${res.subagentHolds} sent=${sent.length}`)
}

// ── O4 交付就绪判据（真实 git 夹具，#50 口径三形态）───────────────────────────
{
  const cwd = mkdtempSync(join(tmpdir(), 'orch-criteria-'))
  try {
    // #164：夹具 git 调用一律走 fixtureEnv（#110 挂具）——裸跑无差；真 pre-commit 钩子上下文里
    // 不隔离会把 GIT_DIR 泄给夹具（git init 重初始化 worktree gitdir → 共享 .git/config 被写
    // bare=true + 夹具提交顶掉 worktree 分支，2026-10-25 worktree 试点现场实证，同 #110 I1a）。
    // 配置面指向夹具自己的空文件（挂具注释：只删不覆盖会回落本机 ~/.gitconfig，身份变机器相关量）。
    writeFileSync(join(cwd, '.gitconfig-fixture'), '')
    const FX = () => fixtureEnv({ GIT_CONFIG_GLOBAL: join(cwd, '.gitconfig-fixture') })
    const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env: FX(), encoding: 'utf8' })
    git('init', '-q')
    writeFileSync(join(cwd, 'seed.txt'), 'seed')
    git('add', '-A')
    git('commit', '-qm', 'seed')
    const seed = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, env: FX(), encoding: 'utf8' }).stdout.trim()

    // 未交付基线：三种判据全 false
    const before = DELIVERABLE_CRITERIA.aGroup(cwd, seed) === false
      && DELIVERABLE_CRITERIA.relayHop1(cwd, join(cwd, '.eval', 'handoff-A.md')) === false
      && DELIVERABLE_CRITERIA.relayHop2(cwd, seed) === false

    // 造齐 A 组交付物：新提交 + evidence/green.txt + .eval/{delivery-comment,decision-gate}.md
    mkdirSync(join(cwd, 'evidence'), { recursive: true })
    mkdirSync(join(cwd, '.eval'), { recursive: true })
    writeFileSync(join(cwd, 'evidence', 'green.txt'), 'all pass')
    writeFileSync(join(cwd, '.eval', 'delivery-comment.md'), 'comment')
    writeFileSync(join(cwd, '.eval', 'decision-gate.md'), 'gate')
    git('add', '-A')
    git('commit', '-qm', 'feat: deliver')

    // 缺件矩阵：逐个移走任一要件 → aGroup 必须翻 false（#50 复审口径：只查提交偏宽）
    const full = DELIVERABLE_CRITERIA.aGroup(cwd, seed) === true
    const missingCases = []
    for (const [name, path] of [['green.txt', join(cwd, 'evidence', 'green.txt')], ['delivery-comment', join(cwd, '.eval', 'delivery-comment.md')], ['decision-gate', join(cwd, '.eval', 'decision-gate.md')]]) {
      const backup = readFileSync(path, 'utf8')
      rmSync(path)
      if (DELIVERABLE_CRITERIA.aGroup(cwd, seed) !== false) missingCases.push(name)
      writeFileSync(path, backup)
    }
    const hop1Ok = DELIVERABLE_CRITERIA.relayHop1(cwd, join(cwd, '.eval', 'handoff-A.md')) === false
      && (writeFileSync(join(cwd, '.eval', 'handoff-A.md'), '# Handoff'), DELIVERABLE_CRITERIA.relayHop1(cwd, join(cwd, '.eval', 'handoff-A.md')) === true)
    const hop2Ok = DELIVERABLE_CRITERIA.relayHop2(cwd, seed) === true && commitsSince(cwd, spawnSync('git', ['rev-parse', 'HEAD'], { cwd, env: FX(), encoding: 'utf8' }).stdout.trim()) === false

    if (before && full && missingCases.length === 0 && hop1Ok && hop2Ok)
      ok('O4. 交付就绪判据三形态（真实 git 夹具；缺任一要件 → false）', 'aGroup 4 要件 / relayHop1 文档在盘 / relayHop2 新提交')
    else
      bad('O4. 判据漂移', `before=${before} full=${full} 缺件未翻false=${missingCases.join(',')} hop1=${hop1Ok} hop2=${hop2Ok}`)
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 3 })
  }
}

// ── O5 verifyManifest（失真复核 ground truth）────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'orch-manifest-'))
  try {
    mkdirSync(join(root, 'utils'), { recursive: true })
    writeFileSync(join(root, 'utils', 'slug.js'), 'export const slugify = () => 1')
    writeFileSync(join(root, 'utils', 'slug.test.js'), 'import test from "node:test"')
    const sha = (p) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex')
    const wrongHash = '0'.repeat(64)
    const doc = [
      '## 产物清单（子会话逐条机械校验）',
      `<!-- \`utils/ghost.js sha256:${wrongHash} —— 注释行不算清单 -->`,
      `\`utils/slug.js\` sha256:${sha('utils/slug.js')}`,           // 对（反引号装饰，#50 缺陷②回归）
      `- \`utils/slug.test.js\` sha256:${sha('utils/slug.test.js')}`, // 对
      `utils/missing.js sha256:${wrongHash}`,                        // 文件缺失 → 失真
      `utils/slug.js sha256:${wrongHash}`,                           // 错哈希 → 失真
    ].join('\n')
    const docPath = join(root, 'handoff.md')
    writeFileSync(docPath, doc)

    const r = verifyManifest(docPath, root)
    if (r.entries === 4 && r.mismatches === 2 && r.detail.filter((e) => e.match).length === 2)
      ok('O5. verifyManifest：反引号剥装饰 / 注释行不算 / 缺文件与错哈希都计失真', `entries=${r.entries} mismatches=${r.mismatches}`)
    else
      bad('O5. manifest 复核漂移', `entries=${r.entries} mismatches=${r.mismatches} matched=${r.detail.filter((e) => e.match).length}`)
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  }
}

// ── O6 renderAuditReading（批末异步审计读数行）────────────────────────────────
{
  const line = renderAuditReading([
    { hop: 'hop1', manifestEntries: 3, mismatches: 0, nudges: 1, humanRelays: 0 },
    { hop: 'hop2', manifestEntries: 3, mismatches: 1, nudges: 0, humanRelays: 1 },
  ])
  const a = line === '失真 1/6 · 2 跳 · nudge 1 · 代答 1'
  const b = renderAuditReading([]) === null && renderAuditReading(undefined) === null
  if (a && b) ok('O6. 批末审计读数行格式（Σ 失真/条目 + 跳数 + nudge/代答计量；无跳 → null）', line)
  else bad('O6. 读数行格式漂移', String(line))
}

// ── O7 单一事实源（runner 消费编排件 / handoff-tool 执行面消费导出）────────────
{
  const runner = readFileSync(join(REPO, 'evals/autonomy/runner.mjs'), 'utf8')
  const consumes = runner.includes('from "../../lib/autonomy-orchestration.mjs"')
    && runner.includes('from "../../handoff-tool.mjs"')
    && runner.includes('HANDOFF_BOUNDARY')
  // 内嵌副本回潮检测：这些字面在 #163 前是 runner 的内嵌实现，import 化后不得再出现定义形态
  const noCopies = !/const (NUDGE_TEXT|TURN_END_GRACE_MS|MAX_NUDGE|TURN_TIMEOUT_MS|POLL_MS)\s*=/.test(runner)
    && !/const BOUNDARY_SECTION\s*=\s*\[/.test(runner)
    && !/function assertBoundarySynced/.test(runner)
  if (consumes && noCopies)
    ok('O7a. runner 消费编排件与 HANDOFF_BOUNDARY，零内嵌副本（155族候选 2 治理面）')
  else
    bad('O7a. runner 出现内嵌副本回潮或 import 断链', `consumes=${consumes} noCopies=${noCopies}`)

  const tool = readFileSync(join(REPO, 'handoff-tool.mjs'), 'utf8')
  const toolConsumes = /const boundary = HANDOFF_BOUNDARY\.join/.test(tool)
    && /export const HANDOFF_BOUNDARY = \[/.test(tool)
    && !/const boundary = \[/.test(tool) // 执行面不得再有第二份字面
  const boundaryHas159 = HANDOFF_BOUNDARY.some((l) => l.includes('未验面') && l.includes('#159'))
  const boundaryHasCredential = HANDOFF_BOUNDARY.some((l) => l.includes(CREDENTIAL_FORMATS.batch) && l.includes(CREDENTIAL_FORMATS.ticket))
  if (toolConsumes && boundaryHas159 && boundaryHasCredential)
    ok('O7b. handoff-tool 执行面消费 HANDOFF_BOUNDARY 导出（含 #159 写法三条行 + #156/D52 凭据行），无第二份字面')
  else
    bad('O7b. 边界正典与执行面脱钩', `toolConsumes=${toolConsumes} #159行=${boundaryHas159} 凭据行=${boundaryHasCredential}`)
}

// ── O8 文档同批落地（正文条 + 审计位节 + minimal 压缩面）───────────────────────
{
  const body = readFileSync(join(REPO, 'workflow-body.txt'), 'utf8')
  const batchState = readFileSync(join(REPO, 'docs/batch-state.md'), 'utf8')
  const minimal = readFileSync(join(REPO, 'workflow-profile-minimal.txt'), 'utf8')
  const a = body.includes('WAKE ORCHESTRATION') && body.includes('subagentCatalog') && body.includes('lib/autonomy-orchestration.mjs')
  // 单锚（复审收敛：原三选一 OR 弱于同组——删掉 renderAuditReading 引用、保留「失真」
  // 字样仍绿 = 只钉一半）：正文 AUTONOMY DIGEST 条必须引用格式正典 renderAuditReading
  const b = body.includes('renderAuditReading') && body.includes('AUTONOMY DIGEST') && body.includes('#163')
  const c = batchState.includes('批末异步审计位') && batchState.includes('#163') && batchState.includes('lib/autonomy-orchestration.mjs')
  const d = minimal.includes('WAKE ORCHESTRATION')
  if (a && b && c && d)
    ok('O8. 文档同批落地：正文唤醒编排条 + AUTONOMY DIGEST 失真率读数锚 + batch-state 审计位节 + minimal 压缩面')
  else
    bad('O8. 文档面缺节', `正文编排条=${a} 正文失真读数锚=${b} batch-state 审计位节=${c} minimal=${d}`)
}

console.log('\n=== AUTONOMY ORCHESTRATION VERIFY (O1–O8, #163) ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)
