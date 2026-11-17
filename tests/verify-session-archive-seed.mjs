/**
 * verify-session-archive-seed.mjs —— session-archive（#198，会话归档 v1 子票 D：
 * seed 验证与验收收口）的**判据核心**与 verify-all 快集/全量入口（#180 双入口形态，
 * #195 复审批注①同款收口：判据面只在本文件 CHECKS 数组；tests/session-archive-seed.spec.ts
 * 为票面 AC2 的 vitest 薄入口，spec 侧零判据，import 即同源）。
 *
 * 为什么分文件：子票 A(#195 配置面)/B(#196 选择与执行)/C(#197 计划与触发)/D(#198
 * seed 验证与接线收口)的判据各自自持，与实现段同文件分段的结构对齐——本文件 =
 * 子票 D 段（tests/session-archive.spec.ts = A 段，tests/session-archive-plan.spec.ts
 * = B 段，tests/session-archive-schedule.spec.ts = C 段）。
 *
 * 覆盖段：
 *   SE = seed 量级夹具（AC2）：合计 **1096** 会话 seed（#185 报告值量级，合计口径）
 *     + registry mock/夹具——验证选择算法在量级下的行为：保底/排除面/幂等（SE1–SE5）、
 *     cap 组级独立性（SE6）、runOnce 端到端落账与 seed 对账（SE7）、量级耗时上界
 *     smoke（SE8）。判定点全部在「量级 + 多组分布 + 全链路」，不与 #196 的纯函数
 *     边界（小组形态）/ #197 的投影映射（2 条记录）重复（D6：判定点不重复）。
 *   J  = 插件接线（AC1，mount 形态）：真挂具栈（preset-harness boot，dataRoot 隔离
 *     真栈）上 session-archive 行被 preset 分发面正确挂载并激活（J1 真行解析 /
 *     J2 行激活 broken settle / J3 真栈快照合成端到端——sqlite session-query 引擎
 *     + 真实 store 造会话 + synthesizeSnapshot 投影逐字段）。
 *
 * 双向钉：实现侧改必红（SE2 保底集合/SE5 幂等二轮/SE7 落账计数/J3 投影逐字段）+
 * 期望侧改必红（SE1 seed 形态自洽/SE3 排除原因词表/J1 行形态）。**扰动实证分档**：
 * 本票判据以量级夹具与真栈接线为主——未逐条做单开关位扰动（前三票已对同款实现面
 * 做过扰动真红 13 例），如实分档不在案冒充实证。
 *
 * loud 声明（票面 ②/AC3）：**真机前端复现（handoff 子会话前端不可见 + 1096 量级）
 * 不在 agent 环境**——本文件交付的是 preset 面验证（mock registry 夹具 + 真挂具栈）；
 * 真机窗口执行的实机验证操作清单见 .scratch/verify198/manual-verification-checklist.md
 * （证据件形态，随票交付）。
 *
 * 隔离：SE 段全内存 mock（#196/#197 同款纪律：registry 接口 mock 不触盘不读真实
 * home，不 import 上游包）；J 段用 preset-harness boot 真栈——dataRoot 与 DSH_HOME
 * 都显式落在 os.tmpdir() 下 mkdtemp 目录（挂载读 defaultStorageDir 只读不写，仍隔离
 * 杜绝任何路径误触），进程退出时统一自删（只删自建的这两个目录），上游包经
 * tests/node_modules 依赖链解析（link-runtime-deps 同款），绝不触真实 home。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import {
  ARCHIVE_REASONS,
  FLOOR_KEEP,
  SKIP_REASONS,
  buildSnapshotView,
  computeNextRun,
  createScheduler,
  normalizeConfig,
  readRunlog,
  runArchiveCycle,
  selectArchivePlan,
  synthesizeSnapshot,
  writeConfig,
} from '../session-archive.mjs'
import { bootHarness, parsePlugins } from './preset-harness.mjs'
import { SessionId } from '@deepseek-ai/dsh-session'

const REPO = dirname(dirname(fileURLToPath(import.meta.url))) // tests/ 的父目录 = 仓根

/** 非空洞下界:判据面误删(重构漏迁/循环被截)时快集响亮红而不是静默缩水。 */
export const MIN_CHECKS = 11

// ── 夹具（SE 段：全内存 mock）────────────────────────────────────────────────

/** 固定时钟基准（本地时区 2026-11-15 12:00——周日；#197 同款基准时点）。 */
const NOW = new Date(2026, 10, 15, 12, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000
const RETENTION_DAYS = 14

/** seed 分布（合计恰 1096，#185 报告值量级——合计口径，单工作区计数上游未定案，
 *  见 .scratch/verify198/upstream-gap-dossier.md）：7 个命名 workspace 非均匀分布 +
 *  「无 workspace」散落虚拟组。键序即断言用组序（实体字典序、loose 殿后）。 */
const SEED_LAYOUT = Object.freeze({
  'w-alpha': 200,
  'w-beta': 150,
  'w-delta': 90,
  'w-eps': 80,
  'w-gamma': 120,
  'w-heavy': 250,
  'w-zeta': 60,
})

const LOOSE_COUNT = 146 // 200+150+90+80+120+250+60+146 = 1096

/** 组内铺法：全超龄（对 RETENTION_DAYS=14）且组内年龄唯一——组内第 j 个（0 = 最老）
 *  的 age = 14 + (n - j) 天，∈ [15, 14+n]，全部严格大于保留期；唯一 age 使保底
 *  「最新 10 个」的集合断言无并列歧义（并列破序语义 #196 S8 已钉，不在此重复）。 */
function seedCreatedAt(index, count) {
  return NOW.getTime() - (RETENTION_DAYS + count - index) * DAY_MS
}

/** 1096 量级 seed 的原始三面（records/memberships/pinned 集）+ 排除位布局
 *  （`withExclusions: false` 时全部退化为无标记普通位——SE2 钉纯保底量级语义）：
 *  - 每组（含 loose）j=0 撒 pinned（registry-global 全局集合——真实 registry 形态）；
 *  - 实体组 j=1 撒 live、j=2 撒 subagent（origin 标记）；
 *  - loose 组 j=1 撒 subagent（origin）、j=4 撒 pinned+live **多标记**（排除判定
 *    第一序 pinned，#196 S4 钉过小组形态，量级下取一组对账）——loose 的 live 位由
 *    多标记位兼任，故 live 总数 = 7（实体组各 1）。
 *  排除位全在保底外（最小组 loose n=146 ≫ 10）且全超龄（原候选位）。总排除位
 *  = 9 pinned + 7 live + 8 subagent = 24。 */
export function makeSeed1096({ withExclusions = true } = {}) {
  const records = []
  const memberships = []
  const pinnedIds = []
  const groups = new Map()
  const layout = () => [...Object.entries(SEED_LAYOUT), [null, LOOSE_COUNT]]
  for (const [workspaceId, count] of layout()) {
    const ids = []
    for (let j = 0; j < count; j++) {
      const id = (workspaceId === null ? 'loose' : workspaceId.slice(2)) + '-' + String(j).padStart(3, '0')
      const isPinned = withExclusions && (j === 0 || (workspaceId === null && j === 4))
      const isLive = withExclusions && ((workspaceId !== null && j === 1) || (workspaceId === null && j === 4))
      const isSubagent = withExclusions && ((workspaceId === null && j === 1) || (workspaceId !== null && j === 2))
      const header = { id, createdAt: seedCreatedAt(j, count) }
      if (isSubagent) header.origin = 'subagent'
      records.push({ header, live: isLive })
      if (isPinned) pinnedIds.push(id)
      ids.push(id)
      groups.set(id, workspaceId)
    }
    if (workspaceId !== null) memberships.push({ workspaceId, sessionIds: ids })
  }
  return { records, memberships, pinnedIds, groups }
}

/** seed 读数自洽（SE1 与各用例共用的不变量）：合计 1096、逐组计数、id 唯一、时点有限。 */
function assertSeedShape(seed) {
  const ids = seed.records.map((record) => record.header.id)
  assert.strictEqual(ids.length, 1096, 'seed 合计必须恰 1096（#185 报告值量级）')
  assert.strictEqual(new Set(ids).size, 1096, 'seed 的 sessionId 必须全唯一')
  for (const record of seed.records) {
    assert.ok(Number.isFinite(record.header.createdAt) && record.header.createdAt >= 0)
    assert.strictEqual(typeof record.header.id, 'string')
  }
  let total = 0
  for (const [workspaceId, count] of Object.entries(SEED_LAYOUT)) {
    const inGroup = seed.memberships.find((m) => m.workspaceId === workspaceId)
    assert.strictEqual(inGroup.sessionIds.length, count, `组 ${workspaceId} 计数`)
    total += count
  }
  assert.strictEqual(total + LOOSE_COUNT, 1096)
  // pinned 位恰 9（每组 j=0 共 8 组 + loose j=4 多标记位——多标记 = pinned(集合) + live）
  assert.strictEqual(seed.pinnedIds.length, 9)
}

/** 全量 seed 的 view 合成（buildSnapshotView 直喂——真实投影面，J3 用真栈复核同款）。 */
export function seedView(seed) {
  return buildSnapshotView({
    records: seed.records,
    memberships: seed.memberships,
    pinnedSessionIds: seed.pinnedIds,
    archivedSessionIds: [],
  })
}

/** 带状态 registry mock（#196 makeDeps 的量级版）：archiveSession 调用写入 archived
 *  集 + `filterArchived` 打开后（真 adapter 承诺形态：归档集从快照滤除）合成 view 时
 *  滤除已归档会话——第二轮幂等的机械面。 */
function makeStatefulRegistry(seed) {
  const archived = new Set()
  const calls = []
  return {
    calls,
    archived,
    archiveSession: async (sessionId) => {
      calls.push(sessionId)
      archived.add(sessionId)
    },
    /** 二轮 view：已归档会话从 records 滤除（adapter 层滤除形态，session-archive.mjs
     *  synthesizeSnapshot 头注承诺——归档显示层仍列举，不滤则每轮 skipped 全量增长）。 */
    filteredView: () => {
      const records = seed.records.filter((record) => !archived.has(record.header.id))
      return buildSnapshotView({
        records,
        memberships: seed.memberships,
        pinnedSessionIds: seed.pinnedIds,
        archivedSessionIds: [...archived],
      })
    },
  }
}

/** 全超龄配置（规范化产出——与 A 段 normalizeConfig 同源）。 */
export function overdueConfig() {
  return normalizeConfig({ enabled: true, retentionDays: RETENTION_DAYS }).config
}

/** 量级期望值（SE2–SE5/SE7 共享的算术锚，改动布局时先改这里再改断言）：
 *  保底 8 组 × 10 = 80；排除位 = 9 pinned（每组 j=0 共 8 + loose j=4 多标记）
 *  + 7 live（7 实体组 j=1；loose 的 live 位由多标记位兼任）+ 8 subagent（7 实体组
 *  j=2 + loose j=1）= 24；总归档 = 1096 - 80 - 24 = 992。 */
const SEED_GROUPS = 8
const FLOOR_TOTAL = SEED_GROUPS * FLOOR_KEEP // 80
const EXCLUDED_TOTAL = 9 + 7 + 8 // 24
const ARCHIVE_TOTAL = 1096 - FLOOR_TOTAL - EXCLUDED_TOTAL // 992

// ── J 段：真挂具栈单例（boot 一次，J2/J3 共享；进程退出统一清理）──────────────

let mountState = null
let cleanupArmed = false

async function mountOnce() {
  if (mountState) return mountState
  const prevHome = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'session-archive-seed-home-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'session-archive-seed-data-'))
  process.env.DSH_HOME = home // 挂载读 defaultStorageDir 只读不写——仍隔离杜绝任何路径误触
  try {
    // J1 同款：真 yml 分发面行解析 + 绝对 file URL 重写（verify-dual-env resolveInstalled
    // 单行同款——name 解析必须走生产同构路径）
    const ymlText = readFileSync(join(REPO, 'agent.cordis.yml'), 'utf8')
    const base = pathToFileURL(REPO + '/').href
    const rows = parsePlugins(ymlText, base)
    const row = rows.find((r) => r?.id === 'session-archive')
    assert.ok(row, 'agent.cordis.yml 必须声明 session-archive 行（preset 分发面）')
    const resolved = { ...row, name: new URL(row.name.replace(/^dsh-matt-preset\//, './'), base).href }
    const ctx = await bootHarness([{ id: 'seed-mount', plugins: [resolved] }], dataRoot)
    // 补挂 sqlite session-query 引擎（node:sqlite 内置，无原生编译；SessionQueryEngine
    // abstract 的 concrete 后端——inject ['sessions'] 由挂具 SessionStore 供给）
    const SqliteQueryMod = await import('@deepseek-ai/dsh-session-query-sqlite')
    await ctx.plugin(SqliteQueryMod.SqliteSessionQueryEngine, { path: join(dataRoot, 'query-index.sqlite') })
    assert.ok(ctx.get('sessionQuery') !== undefined, 'sqlite session-query 引擎挂载后 ctx.sessionQuery 必须在场')
    assert.ok(ctx.get('workspaceRegistry') !== undefined, 'dataRoot 真栈必须提供 workspaceRegistry')
    mountState = { ctx, home, dataRoot, prevHome, row, resolved }
  } catch (error) {
    process.env.DSH_HOME = prevHome
    await rm(home, { recursive: true, force: true }).catch(() => {})
    await rm(dataRoot, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  if (!cleanupArmed) {
    cleanupArmed = true
    const state = mountState
    process.on('exit', () => {
      try { rmSync(state.dataRoot, { recursive: true, force: true }) } catch { /* 自删失败不掩盖主判据 */ }
      try { rmSync(state.home, { recursive: true, force: true }) } catch { /* 同上 */ }
      if (state.prevHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = state.prevHome
    })
  }
  return mountState
}

// ── 判据面唯一事实源:每项 run() 抛错=红 ────────────────────────────────────────
export const CHECKS = [
  // ── 段 SE:seed 量级夹具(AC2)──
  {
    id: 'SE1',
    name: 'seed 形态自洽:合计恰 1096、8 组分布逐组计数、id 唯一、pinned 位 9(量级锚,改布局先红)',
    run: () => {
      const seed = makeSeed1096()
      assertSeedShape(seed)
      // 期望算术锚与布局自洽:保底/排除/归档三元等式在改任何分布时同时失效
      assert.strictEqual(FLOOR_TOTAL, 80)
      assert.strictEqual(EXCLUDED_TOTAL, 24)
      assert.strictEqual(ARCHIVE_TOTAL, 992)
      // 无排除位形态(withExclusions:false)同样自洽——SE2 纯保底语义的夹具前提
      const plain = makeSeed1096({ withExclusions: false })
      assert.strictEqual(plain.pinnedIds.length, 0)
      assert.strictEqual(plain.records.every((r) => !r.live && r.header.origin === undefined), true)
      // view 合成后逐组 membership 投影:loose 组全落虚拟组(null)
      const view = seedView(seed)
      assert.strictEqual(view.sessions.length, 1096)
      const looseView = view.sessions.filter((s) => s.workspaceId === null)
      assert.strictEqual(looseView.length, LOOSE_COUNT)
      const byId = new Map(view.sessions.map((s) => [s.sessionId, s]))
      assert.strictEqual(byId.get('alpha-000').workspaceId, 'w-alpha')
      assert.strictEqual(byId.get('zeta-059').workspaceId, 'w-zeta')
    },
  },
  {
    id: 'SE2',
    name: '量级保底:全超龄 1096 seed(无排除位形态) → 每组恰好归档 n-10、总 1016、每组最新 10 个永不在 plan(保底无论年龄)',
    run: () => {
      const seed = makeSeed1096({ withExclusions: false })
      const plan = selectArchivePlan(seedView(seed), overdueConfig(), NOW)
      assert.strictEqual(plan.groups.length, SEED_GROUPS) // 7 实体 + 1 虚拟
      // 组序:实体组字典序升序、虚拟组殿后(#196 S1 小组钉过;量级下复核对账)
      assert.deepStrictEqual(
        plan.groups.map((g) => g.workspaceId),
        ['w-alpha', 'w-beta', 'w-delta', 'w-eps', 'w-gamma', 'w-heavy', 'w-zeta', null],
      )
      let total = 0
      for (const group of plan.groups) {
        const n = group.workspaceId === null ? LOOSE_COUNT : SEED_LAYOUT[group.workspaceId]
        assert.strictEqual(group.toArchive.length, n - FLOOR_KEEP, `组 ${group.workspaceId} 归档 n-10`)
        assert.strictEqual(group.floorCount, FLOOR_KEEP)
        assert.strictEqual(group.keptYoung, 0) // 全超龄:保底外无年轻位
        // 保底精确集合:组内最新 10 个(j = n-10..n-1)全在 floorIds、不在 toArchive
        const prefix = group.workspaceId === null ? 'loose' : group.workspaceId.slice(2)
        const newest10 = Array.from({ length: FLOOR_KEEP }, (_, i) => `${prefix}-${String(n - 1 - i).padStart(3, '0')}`)
        assert.deepStrictEqual([...group.floorIds], newest10, `组 ${group.workspaceId} 保底 = 最新 10`)
        const archivedSet = new Set(group.toArchive.map((e) => e.sessionId))
        for (const id of newest10) assert.ok(!archivedSet.has(id), `保底位 ${id} 被归档=破保底`)
        for (const entry of group.toArchive) assert.strictEqual(entry.reason, ARCHIVE_REASONS.retention)
        total += group.toArchive.length
      }
      assert.strictEqual(total, 1016) // 1096 - 8×10
      assert.strictEqual(plan.toArchive.length, 1016)
      assert.strictEqual(plan.skipped.length, 0) // SE2 seed 无排除位
    },
  },
  {
    id: 'SE3',
    name: '量级排除面:8 组各撒 pinned/live/subagent + loose 多标记 → 24 位全 skipped 带词表原因、零入 plan;多标记取第一序',
    run: () => {
      const seed = makeSeed1096()
      const view = seedView(seed)
      const plan = selectArchivePlan(view, overdueConfig(), NOW)
      // skipped = 排除位全集:9 pinned(8 单 + loose 多标记)/7 live(实体组 j=1)/8 subagent
      assert.strictEqual(plan.skipped.length, EXCLUDED_TOTAL)
      const byReason = { [SKIP_REASONS.pinned]: 0, [SKIP_REASONS.live]: 0, [SKIP_REASONS.subagent]: 0 }
      const skippedIds = new Set()
      for (const entry of plan.skipped) {
        byReason[entry.reason]++
        skippedIds.add(entry.sessionId)
        assert.ok(!plan.toArchive.includes(entry.sessionId), `排除位 ${entry.sessionId} 不得入归档计划`)
      }
      assert.strictEqual(byReason[SKIP_REASONS.pinned], 9)
      assert.strictEqual(byReason[SKIP_REASONS.live], 7)
      assert.strictEqual(byReason[SKIP_REASONS.subagent], 8)
      // 排除位位置核对:每组 j=0(pinned)/实体组 j=1(live)/实体组 j=2 + loose j=1(subagent);
      // loose j=4 = pinned+live 多标记 → 取第一序 pinned(不是 live)
      const pinnedExpected = [...Object.keys(SEED_LAYOUT), 'loose'].map((g) =>
        (g === 'w-alpha' ? 'alpha' : g === 'w-beta' ? 'beta' : g === 'w-delta' ? 'delta' : g === 'w-eps' ? 'eps' : g === 'w-gamma' ? 'gamma' : g === 'w-heavy' ? 'heavy' : g === 'w-zeta' ? 'zeta' : g) + '-000')
      for (const id of pinnedExpected) {
        const entry = plan.skipped.find((e) => e.sessionId === id)
        assert.ok(entry && entry.reason === SKIP_REASONS.pinned, `j=0 位 ${id} 应 skipped(pinned)`)
      }
      const looseMulti = plan.skipped.find((e) => e.sessionId === 'loose-004')
      assert.ok(looseMulti && looseMulti.reason === SKIP_REASONS.pinned, 'loose 多标记位(pinned+live)取第一序 pinned')
      assert.strictEqual(plan.skipped.find((e) => e.sessionId === 'loose-001')?.reason, SKIP_REASONS.subagent, 'loose j=1 = subagent 位')
      // loose j=2 无标记普通候选位(布局声明:不在排除面)
      assert.ok(plan.toArchive.includes('loose-002'), 'loose-002 无标记必须仍是候选')
      // 归档总量:1016 - 24(排除位全原候选)= 992
      assert.strictEqual(plan.toArchive.length, ARCHIVE_TOTAL)
    },
  },
  {
    id: 'SE4',
    name: '量级全链路:SessionRecord+成员面投影 → buildSnapshotView → runArchiveCycle → outcome 逐字段对账(992/24)',
    run: async () => {
      const seed = makeSeed1096()
      const registry = makeStatefulRegistry(seed)
      const { plan, report, outcome } = await runArchiveCycle(seedView(seed), overdueConfig(), registry, NOW)
      assert.strictEqual(outcome.ok, true)
      assert.strictEqual(outcome.archived, ARCHIVE_TOTAL) // 992
      assert.strictEqual(outcome.skipped, EXCLUDED_TOTAL) // 24
      assert.strictEqual(outcome.error, undefined)
      assert.strictEqual(registry.calls.length, ARCHIVE_TOTAL)
      assert.strictEqual(report.archivedIds.length, ARCHIVE_TOTAL)
      assert.strictEqual(report.failed.length, 0)
      assert.strictEqual(report.skipped.length, EXCLUDED_TOTAL)
      // 执行序抽查:第一条 = 实体组序第一(w-alpha)的最老候选(j=0/1/2 被排除 → j=3);
      // 最后一条 = 虚拟组(loose 殿后)的最新候选(j = n-11)
      assert.strictEqual(registry.calls[0], 'alpha-003')
      assert.strictEqual(registry.calls[registry.calls.length - 1], 'loose-135')
      // plan/report 同源:archivedIds 集合 = plan.toArchive 集合
      assert.deepStrictEqual([...report.archivedIds].sort(), [...plan.toArchive].sort())
      // 排除位零执行
      for (const entry of plan.skipped) assert.ok(!registry.calls.includes(entry.sessionId))
    },
  },
  {
    id: 'SE5',
    name: '量级幂等二轮:第一轮 992 落账后(adapter 滤除形态)重新合成 → 二轮零归档、排除位持续排除(E4 形态 a 的量级版)',
    run: async () => {
      const seed = makeSeed1096()
      const registry = makeStatefulRegistry(seed)
      const first = await runArchiveCycle(seedView(seed), overdueConfig(), registry, NOW)
      assert.strictEqual(first.outcome.archived, ARCHIVE_TOTAL)
      const callsAfterFirst = registry.calls.length
      // 第二轮:filteredView = 真实 adapter 承诺形态(已归档会话从快照滤除)
      const secondPlan = selectArchivePlan(registry.filteredView(), overdueConfig(), NOW)
      assert.strictEqual(secondPlan.toArchive.length, 0)
      // 排除位(pinned/live/subagent)二轮仍被排除——幂等面 = 归档位不再归档、排除位持续排除
      assert.strictEqual(secondPlan.skipped.length, EXCLUDED_TOTAL)
      const second = await runArchiveCycle(registry.filteredView(), overdueConfig(), registry, NOW)
      assert.strictEqual(second.outcome.archived, 0)
      assert.strictEqual(second.outcome.skipped, EXCLUDED_TOTAL)
      assert.strictEqual(second.outcome.ok, true)
      assert.strictEqual(registry.calls.length, callsAfterFirst) // 二轮零执行
    },
  },
  {
    id: 'SE6',
    name: '量级 cap 组级独立:950+30+5 分布 cap=900 → 仅 950 组触发归档 50(cap,从旧到新)、其余组零归档;cap 不吃跨组合计',
    run: () => {
      // 全年轻铺法(分钟粒度,组内唯一):age < 90 天 ⇒ 年龄规则零候选,护栏是唯一触发面
      const records = []
      const memberships = []
      const layout = [['w-big', 950], ['w-other', 30]]
      for (const [workspaceId, count] of layout) {
        const prefix = workspaceId.slice(2)
        const ids = []
        for (let j = 0; j < count; j++) {
          const id = `${prefix}-${String(j).padStart(3, '0')}`
          records.push({ header: { id, createdAt: NOW.getTime() - (count - j) * 60_000 }, live: false })
          ids.push(id)
        }
        memberships.push({ workspaceId, sessionIds: ids })
      }
      for (let j = 0; j < 5; j++) records.push({ header: { id: `loose-${j}`, createdAt: NOW.getTime() - (5 - j) * 60_000 }, live: false })
      const view = buildSnapshotView({ records, memberships, pinnedSessionIds: [], archivedSessionIds: [] })
      const config = normalizeConfig({ enabled: true, retentionDays: 90, cap: 900 }).config
      const plan = selectArchivePlan(view, config, NOW)
      const big = plan.groups.find((g) => g.workspaceId === 'w-big')
      const other = plan.groups.find((g) => g.workspaceId === 'w-other')
      const loose = plan.groups.find((g) => g.workspaceId === null)
      // 只有 950 组超 cap(950>900):归档 50 个——从旧到新补选(big-000 最老,age 公式 count-j)
      assert.strictEqual(big.toArchive.length, 950 - 900)
      for (const entry of big.toArchive) assert.strictEqual(entry.reason, ARCHIVE_REASONS.cap)
      // 补选序从旧到新:big-000(最老)…big-049
      assert.deepStrictEqual(big.toArchive.map((e) => e.sessionId),
        Array.from({ length: 50 }, (_, i) => `big-${String(i).padStart(3, '0')}`))
      // 保底(big 最新 10 = j=940..949,分钟粒度最新)不在归档
      const bigArchived = new Set(big.toArchive.map((e) => e.sessionId))
      for (let j = 940; j <= 949; j++) assert.ok(!bigArchived.has(`big-${String(j).padStart(3, '0')}`))
      // 组级独立:other 30 / loose 5 都 < 900 ⇒ 零归档——cap 不吃跨组合计(985>900)
      assert.strictEqual(other.toArchive.length, 0)
      assert.strictEqual(loose.toArchive.length, 0)
      assert.strictEqual(plan.toArchive.length, 50)
    },
  },
  {
    id: 'SE7',
    name: '量级 runOnce 端到端落账:createScheduler → runs.json 计数与 seed 对账(992/24)、nextRun 刷新、events 记 manual',
    run: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'session-archive-seed-run-'))
      try {
        const seed = makeSeed1096()
        const registry = makeStatefulRegistry(seed)
        const config = overdueConfig()
        await writeConfig(dir, config)
        const scheduler = createScheduler({
          storageDir: dir,
          snapshot: () => seedView(seed),
          archiveSession: registry.archiveSession,
          now: () => NOW,
        })
        const result = await scheduler.runOnce('manual')
        assert.strictEqual(result.started, true)
        assert.strictEqual(result.trigger, 'manual')
        assert.deepStrictEqual(result.outcome, { ok: true, archived: ARCHIVE_TOTAL, skipped: EXCLUDED_TOTAL })
        const { runlog } = await readRunlog(dir)
        assert.strictEqual(runlog.totals.runs, 1)
        assert.strictEqual(runlog.totals.archived, ARCHIVE_TOTAL) // 与 seed 对账:992
        assert.strictEqual(runlog.totals.skipped, EXCLUDED_TOTAL) // 24
        assert.strictEqual(runlog.lastRun.ok, true)
        assert.strictEqual(runlog.lastRun.archived, ARCHIVE_TOTAL)
        assert.strictEqual(runlog.lastRun.skipped, EXCLUDED_TOTAL)
        assert.strictEqual(runlog.nextRun, computeNextRun(config, NOW).toISOString())
        const lastEvent = runlog.events[runlog.events.length - 1]
        assert.strictEqual(lastEvent.kind, 'run')
        assert.strictEqual(lastEvent.trigger, 'manual')
        assert.strictEqual(lastEvent.archived, ARCHIVE_TOTAL)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
  {
    id: 'SE8',
    name: '量级耗时 smoke 上界:全链路(合成→选择→执行→幂等二轮)1096 seed < 10s(防复杂度回归;实测值进证据)',
    run: async () => {
      const seed = makeSeed1096()
      const registry = makeStatefulRegistry(seed)
      const started = performance.now()
      const view = seedView(seed)
      const plan = selectArchivePlan(view, overdueConfig(), NOW)
      await runArchiveCycle(view, overdueConfig(), registry, NOW)
      selectArchivePlan(registry.filteredView(), overdueConfig(), NOW)
      const elapsed = performance.now() - started
      console.log(`  [seed-1096] 合成+选择+执行+二轮幂等耗时 ${elapsed.toFixed(1)}ms(plan ${plan.toArchive.length} 项)`)
      assert.ok(elapsed < 10_000, `量级全链路耗时 ${elapsed.toFixed(0)}ms 超上界 10s——复杂度回归(如 O(n²) 排序)`)
    },
  },

  // ── 段 J:插件接线(AC1,mount 形态——真挂具栈)──
  {
    id: 'J1',
    name: '真 yml 分发面行解析:agent.cordis.yml 声明 session-archive 行(name=dsh-matt-preset/session-archive.mjs、零业务 config 键)',
    run: () => {
      const ymlText = readFileSync(join(REPO, 'agent.cordis.yml'), 'utf8')
      const rows = parsePlugins(ymlText, pathToFileURL(REPO + '/').href)
      const row = rows.find((r) => r?.id === 'session-archive')
      assert.ok(row, 'agent.cordis.yml 必须声明 session-archive 行')
      assert.strictEqual(row.name, 'dsh-matt-preset/session-archive.mjs')
      // 行面零业务配置键(业务配置走文件面,#195 拍板):无 config 或 config 只有
      // storageDir 注入缝——本 yml 当前无 config,两者皆合法
      const configKeys = Object.keys(row.config ?? {})
      for (const key of configKeys) assert.strictEqual(key, 'storageDir', `行 config 出现业务键 ${key}(业务配置必须走文件面)`)
    },
  },
  {
    id: 'J2',
    name: '真挂具行激活:boot 真栈(dataRoot+timer)挂真行 → settle 后 broken 无 session-archive 行(apply 执行无错=挂载成功)',
    run: async () => {
      const state = await mountOnce()
      // bootHarness 内部已等 preset 注册;broken 读数 = 行激活形态(preset-harness
      // ensurePresetMountable 同款语义:broken === undefined = 干净、无 broken 行)
      let broken
      for (let i = 0; i < 50; i++) {
        broken = (await state.ctx.agentPresets.resolve('seed-mount')).broken
        if (broken === undefined || !broken.split('\n').filter(Boolean).length) break
        await new Promise((r) => setTimeout(r, 100))
      }
      const brokenLines = (broken ?? '').split('\n').filter(Boolean)
      assert.ok(!brokenLines.some((l) => l.includes('session-archive')), `broken 含 session-archive 行:${broken}`)
      assert.ok(brokenLines.every((l) => /: waiting for /.test(l)), `broken 有非 waiting-for 行(挂载失败):${broken}`)
    },
  },
  {
    id: 'J3',
    name: '真栈快照合成端到端:sqlite session-query + 真实 store 造会话 → synthesizeSnapshot 投影逐字段(实测上限=真栈空态+单会话;1096 量级真宿主留实机窗口)',
    run: async () => {
      const state = await mountOnce()
      const store = state.ctx.get('sessions')
      const sessionId = SessionId('seed-mount-live-1')
      await store.create(sessionId)
      const view = await synthesizeSnapshot(state.ctx)
      assert.ok(Array.isArray(view.sessions))
      const projected = view.sessions.find((s) => s.sessionId === 'seed-mount-live-1')
      assert.ok(projected, `新造真会话必须在快照投影内(实际 ${view.sessions.length} 个)`)
      assert.strictEqual(projected.workspaceId, null) // 不在任何 workspace 成员面 → 虚拟组
      assert.strictEqual(typeof projected.lastActivityAt, 'number')
      assert.ok(Number.isFinite(projected.lastActivityAt) && projected.lastActivityAt > 0)
      assert.strictEqual(projected.subagent, false)
      assert.strictEqual(projected.live, true) // 刚创建未 flush → live(store live 面,probe 实测形态)
      // 投影面字段封闭:无计划面外的额外键(A5 投影契约的量级复核)
      assert.deepStrictEqual(
        Object.keys(projected).sort(),
        ['lastActivityAt', 'live', 'sessionId', 'subagent', 'workspaceId'],
      )
      // registry 面:真 WorkspaceRegistry.list() 在场且形状合法(成员面空 = 全部落虚拟组)
      const list = await state.ctx.get('workspaceRegistry').list()
      assert.ok(Array.isArray(list))
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
