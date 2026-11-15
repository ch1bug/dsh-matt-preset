/**
 * verify-session-archive-schedule.mjs —— session-archive.mjs「计划与触发」段(#197,会话
 * 归档 v1 子票 C)的**判据核心**与 verify-all 快集/全量入口(#180 双入口形态,#195 复审
 * 批注①同款收口:判据面只在本文件 CHECKS 数组;tests/session-archive-schedule.spec.ts
 * 为票面 AC5/AC6 的 vitest 薄入口,spec 侧零判据,import 即同源)。
 *
 * 为什么分文件:子票 A(#195 配置面)/B(#196 选择与执行)/C(#197 计划与触发)的判据各自
 * 自持,与实现段同文件分段的结构对齐——本文件 = 子票 C 段(tests/session-archive.spec.ts
 * = A 段,tests/session-archive-plan.spec.ts = B 段)。
 *
 * 覆盖段:M=单实例互斥(AC3)/ C=补跑上限(AC2:零次或一次)/ K=tick 决策状态机
 * (AC1/AC2 的判定面)/ R=触发面(AC4:立即运行+落账、dry-run 只算不执行、异常内聚)/
 * A=快照合成 adapter 与 apply 接线(真实 ctx 结构投影)/ T=三频率触发等价(AC1:
 * 触发面消费 nextRun 存储面,三形态同一路径)。
 *
 * 双向钉(AC5「单侧改必红」):实现侧改必红(M1 互斥三态/C2 catchup 置位/R2 dry-run
 * 零执行/R3 落账逐字段/A1 投影映射)+ 期望侧改必红(A3 形状非法必须始终被拒/R4 坏配置
 * 必须拒绝)。**扰动实证分档**(复审轮③,2026-11-15——消除「清单↔证据」读数歧义):
 *   - 扰动真红在案的钉:P1 补跑窗口摘除→C3 红/P2 互斥摘除→M2 死锁挂起红/P3 投影映射
 *     破坏→A1 红/P4 gate 摘除→R1 红/P5 dry-run 执行化→R2 红/P6 落账摘除→R3 红(+连带
 *     M2/R6/R7/T1)——各 perturbation-p1…p6 日志在 .scratch/verify197/;
 *   - 其余钉(C1/C2/C4/K1-K4/R4-R8/A2-A6/T1-T2)= 结构论证钉(断言直接对着语义边界,
 *     非单一开关位;改语义面必先过这些断言)——未逐条做单开关位扰动,如实分档不在案
 *     冒充实证。
 *
 * 隔离:需要盘面的用例自建自删 os.tmpdir() 下 mkdtemp 目录(每例独立,finally 收尾);
 * snapshot/archiveSession 全部内存 mock,**绝不**读写真实 home,不 import 上游包
 * (workspaceRegistry/sessionQuery 以结构契约 mock,#196 同款纪律)。
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  TICK_ACTIONS,
  TICK_MS,
  TRIGGER_KINDS,
  apply,
  buildSnapshotView,
  computeNextRun,
  createRunMutex,
  createScheduler,
  decideTick,
  emptyRunlog,
  hasMissedRun,
  normalizeConfig,
  readRunlog,
  recordRun,
  selectArchivePlan,
  synthesizeSnapshot,
  writeConfig,
  writeRunlog,
} from '../session-archive.mjs'

/** 非空洞下界:判据面误删(重构漏迁/循环被截)时快集响亮红而不是静默缩水。 */
export const MIN_CHECKS = 21

// ── 夹具 ──────────────────────────────────────────────────────────────────────

/** 固定时钟基准(本地时区 2026-11-15 12:00——周日;判定/落账用同一时点)。 */
const NOW = new Date(2026, 10, 15, 12, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000

/** 独立临时目录(每用例自建自删,finally 收尾;绝不触真实 home)。 */
async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'session-archive-schedule-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 内存快照 + 归档动作 mock(#196 同款:registry 接口 mock 不触盘不读真实 home)。 */
function makeDeps({ sessions = [], pinnedSessionIds = [], archivedSessionIds = [] } = {}) {
  const calls = []
  return {
    calls,
    snapshot: async () => ({
      sessions: [...sessions],
      pinnedSessionIds: [...pinnedSessionIds],
      archivedSessionIds: [...archivedSessionIds],
    }),
    archiveSession: async (sessionId) => {
      calls.push(sessionId)
    },
  }
}

/** 标准夹具:11 会话(10 年轻保底 + 1 最老超期 31 天)——FLOOR_KEEP=10 之上唯一超期候选。 */
function fixtureSessions() {
  const sessions = []
  for (let i = 0; i < 10; i++) {
    sessions.push({ sessionId: `young-${String(i).padStart(2, '0')}`, lastActivityAt: NOW.getTime() - DAY_MS })
  }
  sessions.push({ sessionId: 'old-overdue', lastActivityAt: NOW.getTime() - 31 * DAY_MS })
  return sessions
}

/** 启用态规范化配置(weekly 周日 03:00)。 */
function enabledConfig() {
  return normalizeConfig({ enabled: true }).config
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── 判据面唯一事实源:每项 run() 抛错=红 ────────────────────────────────────────
export const CHECKS = [
  // ── 段 M:单实例互斥(AC3)──
  {
    id: 'M1',
    name: 'createRunMutex 三态(初始可入/占用中拒绝/释放后可入;isRunning 反映)',
    run: () => {
      const mutex = createRunMutex()
      assert.strictEqual(mutex.isRunning(), false)
      assert.strictEqual(mutex.tryBegin(), true)
      assert.strictEqual(mutex.isRunning(), true)
      assert.strictEqual(mutex.tryBegin(), false) // 占用中:第二触发拒绝
      assert.strictEqual(mutex.tryBegin(), false)
      mutex.end()
      assert.strictEqual(mutex.isRunning(), false)
      assert.strictEqual(mutex.tryBegin(), true) // 释放后可再入
      mutex.end()
    },
  },
  {
    id: 'M2',
    name: '重叠触发被互斥拒绝:占用中 runOnce 返回 busy,不执行不落账(AC3)',
    run: () =>
      withTempDir(async (dir) => {
        await writeConfig(dir, enabledConfig()) // M2 需要启用态——否则 gate 先判 disabled 轮不到互斥
        let release
        const gate = new Promise((resolve) => {
          release = resolve
        })
        const calls = []
        const scheduler = createScheduler({
          storageDir: dir,
          snapshot: () => gate,
          archiveSession: async (sessionId) => {
            calls.push(sessionId)
          },
          now: () => NOW,
        })
        const pending = scheduler.runOnce(TRIGGER_KINDS.manual) // 第一触发:在 snapshot 处挂起,mutex 已占
        await sleep(10) // 等第一触发走完 gate 判定、tryBegin、进入 await snapshot
        const busy = await scheduler.runOnce(TRIGGER_KINDS.manual) // 第二触发
        assert.deepStrictEqual(busy, { started: false, reason: 'busy' })
        release({ sessions: [], pinnedSessionIds: [], archivedSessionIds: [] })
        const first = await pending
        assert.strictEqual(first.started, true)
        assert.deepStrictEqual(calls, []) // busy 的第二触发零归档调用
        const { runlog } = await readRunlog(dir)
        assert.strictEqual(runlog.totals.runs, 1) // 只有第一触发落账
      }),
  },
  // ── 段 C:补跑上限(AC2:错过不补多批;启动后最多补跑一次)──
  {
    id: 'C1',
    name: 'hasMissedRun 三态:停用/无排班/未来=否,已过=是(存储面是判定源,到点即算错过)',
    run: () => {
      const config = enabledConfig()
      assert.strictEqual(hasMissedRun(normalizeConfig({}).config, { nextRun: NOW.toISOString() }, NOW), false) // 停用 gate
      assert.strictEqual(hasMissedRun(config, emptyRunlog(), NOW), false) // nextRun null
      assert.strictEqual(hasMissedRun(config, { nextRun: '' }, NOW), false)
      assert.strictEqual(hasMissedRun(config, { nextRun: 'not-a-date' }, NOW), false) // 坏串不判错过
      const future = new Date(NOW.getTime() + DAY_MS).toISOString()
      const past = new Date(NOW.getTime() - DAY_MS).toISOString()
      assert.strictEqual(hasMissedRun(config, { nextRun: future }, NOW), false)
      assert.strictEqual(hasMissedRun(config, { nextRun: past }, NOW), true)
      assert.strictEqual(hasMissedRun(config, { nextRun: NOW.toISOString() }, NOW), true) // <= 对偶 #195 weekly 严格语义
    },
  },
  {
    id: 'C2',
    name: 'decideTick 首次错过 → catchup 且窗口置位(启动后最多一次的决策面)',
    run: () => {
      const config = enabledConfig()
      const past = new Date(NOW.getTime() - DAY_MS).toISOString()
      const decision = decideTick(config, { nextRun: past }, { now: NOW, catchupDone: false })
      assert.strictEqual(decision.kind, TICK_ACTIONS.run)
      assert.strictEqual(decision.trigger, TRIGGER_KINDS.catchup)
      assert.strictEqual(decision.catchupDone, true) // 决策面置位:窗口按「判到」计
    },
  },
  {
    id: 'C3',
    name: '补跑窗口已消耗 → 后续错过一律 scheduled(不再 catchup——上限一次)',
    run: () => {
      const config = enabledConfig()
      const past = new Date(NOW.getTime() - DAY_MS).toISOString()
      const decision = decideTick(config, { nextRun: past }, { now: NOW, catchupDone: true })
      assert.strictEqual(decision.kind, TICK_ACTIONS.run)
      assert.strictEqual(decision.trigger, TRIGGER_KINDS.scheduled)
      assert.strictEqual(decision.catchupDone, true)
    },
  },
  {
    id: 'C4',
    name: '错过多个周期只补一批:补跑落账后 nextRun 刷新未来,hasMissedRun 归零(不重放历史批次)',
    run: () => {
      const config = enabledConfig()
      const longPast = new Date(NOW.getTime() - 8 * DAY_MS).toISOString() // weekly 错过两个周期
      assert.strictEqual(hasMissedRun(config, { nextRun: longPast }, NOW), true)
      // 补跑一轮的机械后果 = recordRun 刷 nextRun(recordRun 是 #195 落账面,直喂 outcome)
      const afterCatchup = recordRun(emptyRunlog(), config, { ok: true, archived: 0, skipped: 0 }, NOW)
      assert.strictEqual(hasMissedRun(config, afterCatchup, NOW), false) // 不再判错过
      assert.strictEqual(decideTick(config, afterCatchup, { now: NOW, catchupDone: true }).kind, TICK_ACTIONS.none)
    },
  },
  // ── 段 K:tick 决策状态机(AC1/AC2 的判定面)──
  {
    id: 'K1',
    name: '停用 + 残留 nextRun → clear-next-run;停用无残留 → none(文件面残留清理)',
    run: () => {
      const disabled = normalizeConfig({}).config
      const stale = decideTick(disabled, { nextRun: NOW.toISOString() }, { now: NOW, catchupDone: false })
      assert.strictEqual(stale.kind, TICK_ACTIONS.clearNextRun)
      assert.strictEqual(stale.catchupDone, false) // 停用不动窗口状态
      const clean = decideTick(disabled, { nextRun: null }, { now: NOW, catchupDone: true })
      assert.strictEqual(clean.kind, TICK_ACTIONS.none)
    },
  },
  {
    id: 'K2',
    name: '启用 + 无有效排班(首装/坏串)→ init-schedule,nextRun 严格未来',
    run: () => {
      const config = enabledConfig()
      for (const runlog of [emptyRunlog(), { nextRun: null }, { nextRun: '' }, { nextRun: 'garbage' }]) {
        const decision = decideTick(config, runlog, { now: NOW, catchupDone: false })
        assert.strictEqual(decision.kind, TICK_ACTIONS.initSchedule)
        assert.strictEqual(Date.parse(decision.nextRun) > NOW.getTime(), true)
      }
    },
  },
  {
    id: 'K3',
    name: '启用 + 未来排班 → none(未到点不动)',
    run: () => {
      const config = enabledConfig()
      const future = new Date(NOW.getTime() + DAY_MS).toISOString()
      assert.strictEqual(decideTick(config, { nextRun: future }, { now: NOW, catchupDone: false }).kind, TICK_ACTIONS.none)
    },
  },
  {
    id: 'K4',
    name: 'init-schedule 的首班 = computeNextRun(config, now)(三频率各一;AC1 触发面消费一致)',
    run: () => {
      for (const frequency of [
        { kind: 'weekly', weekday: 0, time: '03:00' },
        { kind: 'semimonthly', time: '03:00' },
        { kind: 'monthly', day: 27, time: '03:00' },
      ]) {
        const config = normalizeConfig({ enabled: true, frequency }).config
        const decision = decideTick(config, emptyRunlog(), { now: NOW, catchupDone: false })
        assert.strictEqual(decision.kind, TICK_ACTIONS.initSchedule, frequency.kind)
        assert.strictEqual(decision.nextRun, computeNextRun(config, NOW).toISOString(), frequency.kind)
      }
    },
  },
  // ── 段 R:触发面(AC4:立即运行一次 + dry-run 预览;落账;异常内聚)──
  {
    id: 'R1',
    name: 'runOnce gate 判停:停用态手动运行也被拒(#195 口径——手动入口消费同一 gate)',
    run: () =>
      withTempDir(async (dir) => {
        const deps = makeDeps({ sessions: fixtureSessions() })
        const scheduler = createScheduler({ storageDir: dir, snapshot: deps.snapshot, archiveSession: deps.archiveSession, now: () => NOW })
        const result = await scheduler.runOnce(TRIGGER_KINDS.manual)
        assert.deepStrictEqual(result, { started: false, reason: 'disabled' })
        assert.deepStrictEqual(deps.calls, []) // 零归档调用
      }),
  },
  {
    id: 'R2',
    name: 'dry-run 只算不执行:count 精确、archiveSession 零调用、runs.json 零写盘;停用态允许预览(审计面不判 gate)',
    run: () =>
      withTempDir(async (dir) => {
        // 停用态(无 config.json = 默认关)下预览:启用前审计是 dry-run 本职
        const deps = makeDeps({ sessions: fixtureSessions() })
        const scheduler = createScheduler({ storageDir: dir, snapshot: deps.snapshot, archiveSession: deps.archiveSession, now: () => NOW })
        const preview = await scheduler.dryRun()
        assert.strictEqual(preview.ok, true)
        assert.strictEqual(preview.count, 1) // 10 保底 + 1 超期 → 归档 1
        assert.deepStrictEqual(preview.plan.toArchive, ['old-overdue'])
        assert.deepStrictEqual(deps.calls, []) // 只算不执行
        // 落账面零写盘:运行记录读回仍是首装空态(totals.runs=0,无 lastRun)
        const { runlog } = await readRunlog(dir)
        assert.deepStrictEqual(runlog, emptyRunlog())
      }),
  },
  {
    id: 'R3',
    name: 'runOnce 全链路:选择+执行+落账逐字段(lastRun/totals/nextRun 刷新/events 记 trigger)',
    run: () =>
      withTempDir(async (dir) => {
        await writeConfig(dir, enabledConfig())
        const deps = makeDeps({ sessions: fixtureSessions() })
        const scheduler = createScheduler({ storageDir: dir, snapshot: deps.snapshot, archiveSession: deps.archiveSession, now: () => NOW })
        const result = await scheduler.runOnce(TRIGGER_KINDS.manual)
        assert.strictEqual(result.started, true)
        assert.strictEqual(result.trigger, TRIGGER_KINDS.manual)
        assert.deepStrictEqual(deps.calls, ['old-overdue']) // 从旧到新:唯一超期候选
        assert.deepStrictEqual(result.outcome, { ok: true, archived: 1, skipped: 0 })
        const { runlog } = await readRunlog(dir)
        assert.strictEqual(runlog.totals.runs, 1)
        assert.strictEqual(runlog.totals.archived, 1)
        assert.strictEqual(runlog.totals.skipped, 0)
        assert.strictEqual(runlog.lastRun.ok, true)
        assert.strictEqual(runlog.lastRun.archived, 1)
        assert.strictEqual(runlog.nextRun, computeNextRun(enabledConfig(), NOW).toISOString()) // 落账刷新(AC2「回正常计划」机械面)
        const lastEvent = runlog.events[runlog.events.length - 1]
        assert.strictEqual(lastEvent.kind, 'run')
        assert.strictEqual(lastEvent.trigger, TRIGGER_KINDS.manual)
      }),
  },
  {
    id: 'R4',
    name: '坏配置不带半份跑:config.json 写非法值 → runOnce config-invalid 拒绝,零归档;dry-run 同拒(#195 兜底的消费面)',
    run: () =>
      withTempDir(async (dir) => {
        await mkdir(dir, { recursive: true })
        // writeConfig 会拒绝非法值(宁可不落盘)——坏文件只能手写,模拟外部坏化/手改拼错
        await writeFile(join(dir, 'config.json'), JSON.stringify({ enabled: true, retentionDays: 45 }), 'utf8')
        const deps = makeDeps({ sessions: fixtureSessions() })
        const scheduler = createScheduler({ storageDir: dir, snapshot: deps.snapshot, archiveSession: deps.archiveSession, now: () => NOW })
        const result = await scheduler.runOnce(TRIGGER_KINDS.manual)
        assert.strictEqual(result.started, false)
        assert.strictEqual(result.reason, 'config-invalid')
        assert.ok(result.problems.length > 0)
        assert.match(result.problems.join(), /retentionDays/)
        assert.deepStrictEqual(deps.calls, [])
        const preview = await scheduler.dryRun()
        assert.strictEqual(preview.ok, false)
        assert.ok(preview.problems.length > 0) // 坏配置不给预览——计数面不可信
      }),
  },
  {
    id: 'R5',
    name: 'tick 异常内聚不抛出:snapshot 抛错 → tick resolve + error 事件出 onEvent(无人值守面不炸 fiber)',
    run: () =>
      withTempDir(async (dir) => {
        await writeConfig(dir, enabledConfig())
        const events = []
        const scheduler = createScheduler({
          storageDir: dir,
          snapshot: async () => {
            throw new Error('boom: snapshot failed')
          },
          archiveSession: async () => {},
          now: () => NOW,
          onEvent: (event) => events.push(event),
        })
        await writeRunlog(dir, { ...emptyRunlog(), nextRun: new Date(NOW.getTime() - DAY_MS).toISOString() })
        await assert.doesNotReject(() => scheduler.tick()) // 不向上抛
        const errorEvents = events.filter((event) => event.kind === 'error')
        assert.ok(errorEvents.length > 0)
        assert.match(errorEvents[0].detail, /boom/)
      }),
  },
  {
    id: 'R6',
    name: 'tick 全链路 catchup:nextRun 已过 → 补跑落账(trigger=catchup 记 events)+ 下一 tick none',
    run: () =>
      withTempDir(async (dir) => {
        await writeConfig(dir, enabledConfig())
        const deps = makeDeps({ sessions: fixtureSessions() })
        const scheduler = createScheduler({ storageDir: dir, snapshot: deps.snapshot, archiveSession: deps.archiveSession, now: () => NOW })
        await writeRunlog(dir, { ...emptyRunlog(), nextRun: new Date(NOW.getTime() - DAY_MS).toISOString() })
        await scheduler.tick()
        assert.deepStrictEqual(deps.calls, ['old-overdue'])
        const { runlog } = await readRunlog(dir)
        assert.strictEqual(runlog.totals.runs, 1)
        assert.strictEqual(runlog.events[runlog.events.length - 1].trigger, TRIGGER_KINDS.catchup)
        const refreshed = runlog.nextRun
        assert.strictEqual(Date.parse(refreshed) > NOW.getTime(), true)
        // 下一 tick:窗口已耗 + nextRun 未来 → none,events 不再增长
        const countBefore = runlog.events.length
        await scheduler.tick()
        const { runlog: after } = await readRunlog(dir)
        assert.strictEqual(after.events.length, countBefore)
        assert.strictEqual(after.totals.runs, 1)
        assert.strictEqual(after.nextRun, refreshed) // 未被重排
      }),
  },
  {
    id: 'R7',
    name: 'tick 触发被互斥拒绝 → refused 事件,不落账;窗口不回滚(决策面置位语义)',
    run: () =>
      withTempDir(async (dir) => {
        await writeConfig(dir, enabledConfig())
        const events = []
        let release
        const gate = new Promise((resolve) => {
          release = resolve
        })
        const scheduler = createScheduler({
          storageDir: dir,
          snapshot: () => gate,
          archiveSession: async () => {},
          now: () => NOW,
          onEvent: (event) => events.push(event),
        })
        await writeRunlog(dir, { ...emptyRunlog(), nextRun: new Date(NOW.getTime() - DAY_MS).toISOString() })
        const pending = scheduler.runOnce(TRIGGER_KINDS.manual) // 占住互斥(挂起在 snapshot)
        await sleep(10)
        await scheduler.tick() // catchup 判定 → runOnce → busy → refused 事件
        const refused = events.filter((event) => event.kind === 'refused')
        assert.ok(refused.length > 0)
        assert.match(refused[refused.length - 1].detail, /互斥/)
        release({ sessions: [], pinnedSessionIds: [], archivedSessionIds: [] })
        await pending
        // 窗口不回滚:手动那轮落账刷新 nextRun → 再 tick none
        const { runlog } = await readRunlog(dir)
        assert.strictEqual(runlog.totals.runs, 1) // 只有手动那轮落账
        const countBefore = runlog.events.length
        await scheduler.tick()
        const { runlog: after } = await readRunlog(dir)
        assert.strictEqual(after.events.length, countBefore)
      }),
  },
  {
    id: 'R8',
    name: '停用态残留清盘:tick 将 runs.json 的残留 nextRun 置 null + schedule-clear 事件(文件面手改 config 的清理路径)',
    run: () =>
      withTempDir(async (dir) => {
        // 无 config.json = 默认关;runs.json 手工塞一个残留 nextRun(模拟停用前残留)
        await writeRunlog(dir, { ...emptyRunlog(), nextRun: NOW.toISOString() })
        const events = []
        const scheduler = createScheduler({
          storageDir: dir,
          snapshot: async () => ({ sessions: [], pinnedSessionIds: [], archivedSessionIds: [] }),
          archiveSession: async () => {},
          now: () => NOW,
          onEvent: (event) => events.push(event),
        })
        await scheduler.tick()
        const { runlog } = await readRunlog(dir)
        assert.strictEqual(runlog.nextRun, null)
        assert.strictEqual(events.some((event) => event.kind === 'schedule-clear'), true)
      }),
  },
  // ── 段 A:快照合成 adapter 与 apply 接线 ──
  {
    id: 'A1',
    name: 'buildSnapshotView 投影:createdAt→lastActivityAt/origin→subagent/live→live/成员面→workspaceId/未匹配→虚拟组/archived 集合滤除',
    run: () => {
      const view = buildSnapshotView({
        records: [
          { header: { id: 's-archived', createdAt: NOW.getTime() - 40 * DAY_MS }, live: false },
          { header: { id: 's-subagent', createdAt: NOW.getTime() - 3 * DAY_MS, origin: 'subagent' }, live: true },
          { header: { id: 's-loose', createdAt: NOW.getTime() - 50 * DAY_MS }, live: false },
          { header: { id: 's-member', createdAt: NOW.getTime() - 2 * DAY_MS }, live: false },
        ],
        memberships: [{ workspaceId: 'ws-a', sessionIds: ['s-member', 's-archived'] }],
        pinnedSessionIds: ['s-loose'],
        archivedSessionIds: ['s-archived', 's-gone'],
      })
      const byId = new Map(view.sessions.map((session) => [session.sessionId, session]))
      assert.strictEqual(view.sessions.length, 3) // archived 滤除(显示层归档不入清点)
      assert.strictEqual(byId.has('s-archived'), false)
      assert.strictEqual(byId.get('s-member').workspaceId, 'ws-a') // 成员面投影
      assert.strictEqual(byId.get('s-loose').workspaceId, null) // 未匹配 → 虚拟组
      assert.strictEqual(byId.get('s-loose').pinned, undefined) // pinned 走全局集合(逐会话标记不重复投影)
      assert.strictEqual(byId.get('s-subagent').subagent, true)
      assert.strictEqual(byId.get('s-subagent').live, true)
      assert.strictEqual(byId.get('s-loose').live, false)
      assert.strictEqual(byId.get('s-loose').lastActivityAt, NOW.getTime() - 50 * DAY_MS)
      assert.deepStrictEqual([...view.pinnedSessionIds], ['s-loose'])
      assert.deepStrictEqual([...view.archivedSessionIds], ['s-archived', 's-gone'])
    },
  },
  {
    id: 'A2',
    name: 'buildSnapshotView 直喂 selectArchivePlan(#196 契约贯通):pinned 排除 + 超期候选 + 保底成立',
    run: () => {
      const view = buildSnapshotView({
        records: [
          { header: { id: 's-pinned-old', createdAt: NOW.getTime() - 40 * DAY_MS }, live: false },
          { header: { id: 's-overdue', createdAt: NOW.getTime() - 31 * DAY_MS }, live: false },
          { header: { id: 's-young', createdAt: NOW.getTime() - DAY_MS }, live: false },
        ],
        memberships: [],
        pinnedSessionIds: ['s-pinned-old'],
        archivedSessionIds: [],
      })
      const config = normalizeConfig({ enabled: true, retentionDays: 30, cap: null }).config
      const plan = selectArchivePlan(view, config, NOW)
      // 3 会话全部在保底(FLOOR_KEEP=10)内——超期候选也不归档;但 pinned 排除面照记
      // (保底外才判排除面——3 个全保底,skipped 为空,keptYoung 计超期那位)
      assert.deepStrictEqual(plan.toArchive, [])
      assert.deepStrictEqual(plan.skipped, [])
    },
  },
  {
    id: 'A3',
    name: 'buildSnapshotView 形状非法响亮点名(records 非数组/条目缺 header/createdAt 非法/坏成员/跨组重复/坏集合)',
    run: () => {
      assert.throws(() => buildSnapshotView({ records: 'nope', memberships: [] }), /records/)
      assert.throws(() => buildSnapshotView({ records: [], memberships: 'nope' }), /memberships/)
      assert.throws(() => buildSnapshotView({ records: [null], memberships: [] }), /records\[0\]/)
      assert.throws(() => buildSnapshotView({ records: [{ header: null }], memberships: [] }), /header/)
      assert.throws(() => buildSnapshotView({ records: [{ header: { id: 'x', createdAt: 'yesterday' } }], memberships: [] }), /createdAt/)
      assert.throws(() => buildSnapshotView({ records: [{ header: { id: 'x', createdAt: 5 } }], memberships: [{ workspaceId: '', sessionIds: [] }] }), /memberships\[0\]/)
      assert.throws(
        () =>
          buildSnapshotView({
            records: [{ header: { id: 'dup', createdAt: 1 } }],
            memberships: [
              { workspaceId: 'ws-a', sessionIds: ['dup'] },
              { workspaceId: 'ws-b', sessionIds: ['dup'] },
            ],
          }),
        /dup/,
      ) // 跨组重复成员:上游形状异常,响亮不容忍
      assert.throws(() => buildSnapshotView({ records: [], memberships: [], archivedSessionIds: [42] }), /archivedSessionIds\[0\]/)
      assert.throws(() => buildSnapshotView({ records: [], memberships: [], pinnedSessionIds: [null] }), /pinnedSessionIds\[0\]/)
    },
  },
  {
    id: 'A4',
    name: 'synthesizeSnapshot:服务缺席或形状不完整响亮点名(registry 缺 list/缺全局集合/id 非串洗值/sessionIds 非数组/sessionQuery 缺席——复审轮①对称化)',
    run: async () => {
      assert.rejects(() => synthesizeSnapshot({}), /workspaceRegistry/)
      assert.rejects(() => synthesizeSnapshot(undefined), /workspaceRegistry/)
      assert.rejects(
        () => synthesizeSnapshot({ get: (name) => (name === 'workspaceRegistry' ? { list: () => [], pinnedSessionIds: [], archivedSessionIds: [] } : undefined) }),
        /sessionQuery/,
      )
      assert.rejects(
        () => synthesizeSnapshot({ get: (name) => (name === 'workspaceRegistry' ? { list: () => [], pinnedSessionIds: [], archivedSessionIds: [] } : {}) }),
        /sessionQuery/, // sessionQuery 在场但无 listSessions 方法——同样响亮
      )
      // 复审轮①:registry 在场但形状不完整——与 sessionQuery 同款响亮,不再静默容忍
      const fullRegistry = (overrides) => ({ list: () => [], pinnedSessionIds: [], archivedSessionIds: [], ...overrides })
      assert.rejects(
        () => synthesizeSnapshot({ get: (name) => (name === 'workspaceRegistry' ? {} : { listSessions: async () => [] }) }),
        /list\(\)/, // registry 缺 list()——静默置空会丢 per-workspace 保底语义
      )
      assert.rejects(
        () => synthesizeSnapshot({ get: (name) => (name === 'workspaceRegistry' ? { list: () => [] } : { listSessions: async () => [] }) }),
        /pinnedSessionIds/, // 排除面全局集合缺席——静默清空会让 pinned 被归档且上游清 pin
      )
      assert.rejects(
        () => synthesizeSnapshot({ get: (name) => (name === 'workspaceRegistry' ? { list: () => [], pinnedSessionIds: [] } : { listSessions: async () => [] }) }),
        /archivedSessionIds/, // 幂等面全局集合缺席——同族响亮
      )
      assert.rejects(
        () => synthesizeSnapshot({ get: (name) => (name === 'workspaceRegistry' ? fullRegistry({ list: () => [{ id: 42, sessionIds: [] }] }) : { listSessions: async () => [] }) }),
        /id 必须是非空字符串/, // 非 String() 洗值——任意值洗成串会造假实体组
      )
      assert.rejects(
        () => synthesizeSnapshot({ get: (name) => (name === 'workspaceRegistry' ? fullRegistry({ list: () => [{ id: 'ws-1' }] }) : { listSessions: async () => [] }) }),
        /sessionIds/, // 成员面缺 sessionIds 数组——形状不完整响亮
      )
      // 对照:形状完整的 registry 全绿(投影正常)
      await assert.doesNotReject(() => synthesizeSnapshot({ get: (name) => (name === 'workspaceRegistry' ? fullRegistry() : { listSessions: async () => [] }) }))
    },
  },
  {
    id: 'A5',
    name: 'synthesizeSnapshot 全链路 mock ctx:registry+sessionQuery 投影 → buildSnapshotView 形状正确(成员面/虚拟组/live)',
    run: async () => {
      const records = [
        { header: { id: 's-1', createdAt: NOW.getTime() - 40 * DAY_MS, cwd: '/tmp/a' }, live: false },
        { header: { id: 's-2', createdAt: NOW.getTime() - 2 * DAY_MS }, live: true },
      ]
      const fakeRegistry = {
        list: () => [{ id: 'ws-uuid-1', sessionIds: ['s-2'] }],
        pinnedSessionIds: ['s-2'],
        archivedSessionIds: [],
      }
      const ctx = {
        get: (name) =>
          name === 'workspaceRegistry'
            ? fakeRegistry
            : name === 'sessionQuery'
              ? { listSessions: async () => records }
              : undefined,
      }
      const view = await synthesizeSnapshot(ctx)
      assert.strictEqual(view.sessions.length, 2)
      const byId = new Map(view.sessions.map((session) => [session.sessionId, session]))
      assert.strictEqual(byId.get('s-1').workspaceId, null) // 不在任何成员面 → 虚拟组
      assert.strictEqual(byId.get('s-2').workspaceId, 'ws-uuid-1')
      assert.strictEqual(byId.get('s-2').live, true)
      assert.deepStrictEqual([...view.pinnedSessionIds], ['s-2'])
    },
  },
  {
    id: 'A6',
    name: 'apply 接线回调安全:interval 回调同步调用不抛(tick 内聚);停用态默认关 → tick none 零写盘',
    run: () =>
      withTempDir(async (dir) => {
        const intervals = []
        const ctx = {
          interval(callback, delay) {
            intervals.push({ callback, delay })
            return () => {}
          },
          get: () => undefined,
        }
        apply(ctx, { storageDir: dir }) // 停用态(无 config.json):tick 走 none
        assert.strictEqual(intervals.length, 1)
        assert.strictEqual(intervals[0].delay, TICK_MS)
        await assert.doesNotReject(() => Promise.resolve(intervals[0].callback())) // 回调同步不抛
        // 停用态零写盘:目录内无 config.json/runs.json(withTempDir 建了空目录;默认关
        // none 分支无 IO 写——readConfig ENOENT 走 defaults 不落盘)
        assert.deepStrictEqual(await readdir(dir), [])
      }),
  },
  // ── 段 T:三频率触发等价(AC1:weekly/semimonthly/monthly 走同一触发面)──
  {
    id: 'T1',
    name: '三频率到点触发等价:各自 nextRun 过去 → runOnce 落账,nextRun 刷回该频率未来时点(computeNextRun 一致)',
    run: () =>
      withTempDir(async (dir) => {
        const deps = makeDeps({ sessions: fixtureSessions() })
        const scheduler = createScheduler({ storageDir: dir, snapshot: deps.snapshot, archiveSession: deps.archiveSession, now: () => NOW })
        for (const frequency of [
          { kind: 'weekly', weekday: 0, time: '03:00' },
          { kind: 'semimonthly', time: '03:00' },
          { kind: 'monthly', day: 27, time: '03:00' },
        ]) {
          const config = normalizeConfig({ enabled: true, frequency }).config
          await writeConfig(dir, config)
          await writeRunlog(dir, { ...emptyRunlog(), nextRun: new Date(NOW.getTime() - DAY_MS).toISOString() })
          const result = await scheduler.runOnce(TRIGGER_KINDS.scheduled)
          assert.strictEqual(result.started, true, frequency.kind)
          assert.deepStrictEqual(deps.calls, ['old-overdue'], frequency.kind)
          deps.calls.length = 0 // 每频率轮独立断言(calls 数组跨轮累计)
          const { runlog } = await readRunlog(dir)
          assert.strictEqual(runlog.nextRun, computeNextRun(config, NOW).toISOString(), frequency.kind)
          assert.strictEqual(Date.parse(runlog.nextRun) > NOW.getTime(), true, frequency.kind)
          assert.strictEqual(runlog.totals.runs, 1, frequency.kind) // 每轮自建独立记录(上轮 writeRunlog 重置),触发等价看行为不看累计
        }
      }),
  },
  {
    id: 'T2',
    name: '词表封闭:TRIGGER_KINDS/TICK_ACTIONS 集合相等(增删即红)+ TICK_MS 常量钉(60s)',
    run: () => {
      assert.deepStrictEqual([...Object.values(TRIGGER_KINDS)].sort(), ['catchup', 'manual', 'scheduled'])
      assert.deepStrictEqual([...Object.values(TICK_ACTIONS)].sort(), ['clear-next-run', 'init-schedule', 'none', 'run'])
      assert.strictEqual(TICK_MS, 60_000)
    },
  },
]

/** verify-all 入口:逐项执行、汇总、exit 0/1(快集与 --all 都经此跑判据面)。
 *  直接被 node 执行才跑 main;被 spec 薄入口 import 时不跑(exports-audit.mjs 同款
 *  isMain 判别——判据核心只算一次,两个入口共用)。 */
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const started = Date.now()
  if (CHECKS.length < MIN_CHECKS) {
    console.error(`FAIL - 判据面非空洞门:CHECKS.length=${CHECKS.length} < MIN_CHECKS=${MIN_CHECKS}(判据核心被误删/截断——响亮红,不静默缩水)`)
    process.exit(1)
  }
  let passed = 0
  const failedIds = []
  for (const check of CHECKS) {
    try {
      await check.run()
      passed++
      console.log(`  ok - ${check.id}. ${check.name}`)
    } catch (error) {
      failedIds.push(check.id)
      console.error(`  FAIL - ${check.id}. ${check.name}\n${error?.stack ?? error}`)
    }
  }
  const ms = Date.now() - started
  console.log(`\n${passed}/${CHECKS.length} checks pass${failedIds.length > 0 ? `;failed: ${failedIds.join(', ')}` : ''} (${ms}ms)`)
  process.exit(failedIds.length > 0 ? 1 : 0)
}
