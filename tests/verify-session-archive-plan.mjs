/**
 * verify-session-archive-plan.mjs —— session-archive.mjs「归档选择与执行」段（#196,会话
 * 归档 v1 子票 B）的**判据核心**与 verify-all 快集/全量入口(#180 双入口形态,与
 * verify-session-archive.mjs(#195)同款:判据面只在本文件 CHECKS 数组;
 * tests/session-archive-plan.spec.ts 为票面 AC5 的 vitest 薄入口,import 即同源)。
 *
 * 覆盖段: S=选择算法(AC1:分组与虚拟组/保底/年龄严格边界/排除面/上限护栏/archived 幂等面/
 * 非法输入响亮抛) / E=执行(AC2:单参调用不带 stopActivity、活动拒绝跳过、幂等;AC3:失败
 * 记录后继续、计数 outcome 直喂 recordRun)。
 *
 * 双向钉(AC4「单侧改必红」):实现侧改必红(S0 词表集合相等/FLOOR_KEEP 锚、S1 组序、
 * S2 保底精确集合、S5 护栏精确集合与理由、E1 调用序与单参形态)+ 期望侧改必红(S7 非法
 * 输入必须被拒、E2/E3 活动拒绝与失败必须进 skipped/failed)。扰动真红记录见
 * .scratch/verify196/。
 *
 * registry 形态:**接口 mock**(票面机制事实节——registry 为上游包,preset 测试面不
 * import;真实 WorkspaceRegistry.archiveSession 无 stopActivity 时对活动会话先于写盘抛
 * WorkspaceActiveSessionError(name 判别)、已归档 id 幂等 no-op、归档同写清 pin——
 * 上游 packages/workspace/workspace/src/index.ts 核对,子票 D seed 留档真集成)。
 *
 * 隔离:纯函数面 + 内存 mock,不触盘、不读真实 home、不写 DSH_HOME。
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import {
  ARCHIVE_REASONS,
  FLOOR_KEEP,
  SKIP_REASONS,
  executeArchivePlan,
  isActiveSessionError,
  normalizeConfig,
  recordRun,
  runArchiveCycle,
  selectArchivePlan,
  emptyRunlog,
} from '../session-archive.mjs'

/** 非空洞下界:判据面误删(重构漏迁/循环被截)时快集响亮红而不是静默缩水。 */
export const MIN_CHECKS = 15

// ── 夹具:固定时刻 + 确定性会话构造(年龄整数天,无并列时避免排序歧义;需要并列的用例
//    显式给同龄并按 sessionId 码元序断言)──────────────────────────────────────────
const NOW = new Date(2026, 10, 15, 3, 30)
const DAY = 24 * 60 * 60 * 1000

/** A 的 normalizeConfig 产出形态(缺省:启用/保留 30/护栏关)。 */
const config = (over = {}) => normalizeConfig({ enabled: true, ...over }).config

/** 确定性会话:ageDays = 距 NOW 的整天数。flags 透传排除面标记。 */
const session = (sessionId, workspaceId, ageDays, flags = {}) => ({
  sessionId,
  workspaceId,
  lastActivityAt: NOW.getTime() - ageDays * DAY,
  ...flags,
})

/** 一组「从新到旧」编号会话:ids[i] 的年龄 = ageBase + i 天(ids[0] 最新)。 */
const ladder = (ids, workspaceId, ageBase, flags = {}) =>
  ids.map((id, i) => session(id, workspaceId, ageBase + i, flags))

const noActivityRegistry = () => {
  const calls = []
  return {
    calls,
    archiveSession: async (...args) => {
      calls.push(args)
    },
  }
}

/** 判据面唯一事实源:每项 run() 抛错=红。 */
export const CHECKS = [
  // ── 段 S0:词表与常量锚(实现侧改任何一项必红)──
  {
    id: 'S0',
    name: 'FLOOR_KEEP=10;跳过/归档原因词表封闭(集合相等:增删改名即红)',
    run: () => {
      assert.strictEqual(FLOOR_KEEP, 10)
      assert.deepStrictEqual({ ...SKIP_REASONS }, {
        archived: 'archived',
        pinned: 'pinned',
        live: 'live',
        subagent: 'subagent',
        active: 'active',
      })
      assert.deepStrictEqual({ ...ARCHIVE_REASONS }, { retention: 'retention', cap: 'cap' })
      assert.strictEqual(typeof isActiveSessionError, 'function')
    },
  },
  // ── 段 S1:分组与「无 workspace」虚拟组(AC1;分诊定盘:按组不按全局)──
  {
    id: 'S1',
    name: 'per-workspace 分组 + 虚拟组(workspaceId 缺/null/\'\'),组序字典序+虚拟组殿后;虚拟组各自保底',
    run: () => {
      const view = {
        sessions: [
          session('a-old', 'ws-a', 40), // 超保留期
          session('a-new', 'ws-a', 1),
          session('b-old', 'ws-b', 40),
          session('v-und', undefined, 50), // 无 workspace 三形态:undefined
          session('v-null', null, 60), // null
          session('v-empty', '', 70), // 空串
        ],
      }
      const plan = selectArchivePlan(view, config(), NOW)
      assert.deepStrictEqual(plan.groups.map((g) => g.workspaceId), ['ws-a', 'ws-b', null])
      assert.strictEqual(plan.now, NOW.toISOString())
      // 虚拟组只有 3 个会话(全超龄)→ 保底各自生效:全保,不归档(「各自保底最近 10」)
      const virtual = plan.groups[2]
      assert.strictEqual(virtual.visibleCount, 3)
      assert.strictEqual(virtual.floorCount, 3)
      assert.deepStrictEqual(virtual.toArchive, [])
      assert.deepStrictEqual(virtual.floorIds, ['v-und', 'v-null', 'v-empty']) // 从新到旧
      // 实体组:ws-a 2 个(1 老超龄但 2<10 全保)、ws-b 1 个同理——各自保底,零归档
      for (const g of plan.groups.slice(0, 2)) {
        assert.deepStrictEqual(g.toArchive, [])
        assert.strictEqual(g.floorCount, g.visibleCount)
      }
      assert.deepStrictEqual(plan.toArchive, [])
      assert.deepStrictEqual(plan.skipped, [])
    },
  },
  // ── 段 S2:保底最近 10(AC1;无论年龄)──
  {
    id: 'S2',
    name: '保底:15 个全超龄 → 只归档第 11-15 旧(精确集合与从旧到新序);不足 10 个的组全保',
    run: () => {
      const ids = Array.from({ length: 15 }, (_, i) => `w1-s${String(i + 1).padStart(2, '0')}`)
      // ids[0] 最新(ageBase 32)…ids[14] 最老(46):全超 30 保留期
      const plan = selectArchivePlan({ sessions: ladder(ids, 'w1', 32) }, config(), NOW)
      const g = plan.groups[0]
      assert.strictEqual(g.visibleCount, 15)
      assert.deepStrictEqual(g.floorIds, ids.slice(0, 10)) // 最近 10 个,全超龄也保(无论年龄)
      assert.deepStrictEqual(
        plan.toArchive,
        ['w1-s15', 'w1-s14', 'w1-s13', 'w1-s12', 'w1-s11'], // 最老 5 个,从旧到新
      )
      assert.deepStrictEqual(g.toArchive.map((e) => e.reason), Array(5).fill(ARCHIVE_REASONS.retention))
      assert.strictEqual(g.keptYoung, 0)
      // 保底不足 10:7 个全超龄的组 → 全保零归档
      const small = selectArchivePlan({ sessions: ladder(['t1', 't2', 't3', 't4', 't5', 't6', 't7'], 't', 40) }, config(), NOW)
      assert.deepStrictEqual(small.toArchive, [])
      assert.strictEqual(small.groups[0].floorCount, 7)
    },
  },
  // ── 段 S3:年龄严格边界(「超过保留期」= 严格大于;恰好到点不归档)──
  {
    id: 'S3',
    name: '年龄边界:恰满 30 天不归档(keptYoung),30 天+1ms 归档——严格大于',
    run: () => {
      const view = {
        sessions: [
          ...ladder(Array.from({ length: 10 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`), 'w', 1), // 凑保底
          { sessionId: 'exact', workspaceId: 'w', lastActivityAt: NOW.getTime() - 30 * DAY },
          { sessionId: 'over', workspaceId: 'w', lastActivityAt: NOW.getTime() - 30 * DAY - 1 },
        ],
      }
      const plan = selectArchivePlan(view, config({ retentionDays: 30 }), NOW)
      assert.deepStrictEqual(plan.toArchive, ['over'])
      const g = plan.groups[0]
      assert.strictEqual(g.keptYoung, 1) // exact 留在保留位
      assert.ok(g.floorIds.includes('f01'))
      assert.ok(!plan.toArchive.includes('exact'))
    },
  },
  // ── 段 S4:排除面(AC1;#185 第 3 条)──
  {
    id: 'S4',
    name: '排除面:pinned(全局集与逐会话两形态)/live/subagent/active 各记原因,多标记取第一序(live>subagent>active);年轻排除位也记录;保底内不判排除面',
    run: () => {
      const floorSessions = ladder(['f01', 'f02', 'f03', 'f04', 'f05', 'f06', 'f07', 'f08', 'f09', 'f10'], 'w1', 1)
      floorSessions[9] = { ...floorSessions[9], pinned: true } // f10 pinned:在保底内 → 不判排除面
      const view = {
        sessions: [
          ...floorSessions,
          session('e-pin-global', 'w1', 31),
          session('e-pin-flag', 'w1', 32, { pinned: true }),
          session('e-live', 'w1', 33, { live: true }),
          session('e-sub', 'w1', 34, { subagent: true }),
          session('e-active', 'w1', 35, { active: true }),
          session('e-multi', 'w1', 36, { live: true, subagent: true, active: true }),
          // 年轻 + 排除位(候选位但未超龄):也记排除原因(候选位因排除面保留的显式记录)
          session('young-pin', 'w1', 20, { pinned: true }),
        ],
        pinnedSessionIds: ['e-pin-global'],
      }
      const plan = selectArchivePlan(view, config(), NOW)
      assert.deepStrictEqual(plan.toArchive, [])
      // 遍历序 = 候选位从新到旧(young-pin 20d 最新)
      assert.deepStrictEqual(plan.skipped, [
        { sessionId: 'young-pin', reason: SKIP_REASONS.pinned }, // 年轻排除位也记录(显式不静默)
        { sessionId: 'e-pin-global', reason: SKIP_REASONS.pinned },
        { sessionId: 'e-pin-flag', reason: SKIP_REASONS.pinned },
        { sessionId: 'e-live', reason: SKIP_REASONS.live },
        { sessionId: 'e-sub', reason: SKIP_REASONS.subagent },
        { sessionId: 'e-active', reason: SKIP_REASONS.active },
        { sessionId: 'e-multi', reason: SKIP_REASONS.live }, // 多标记取第一序:pinned 缺席 → live
      ])
      const g = plan.groups[0]
      assert.strictEqual(g.keptYoung, 0)
      assert.ok(g.floorIds.includes('f10')) // 保底内 pinned 不产生任何 skip 记录
      assert.strictEqual(plan.skipped.filter((s) => s.sessionId === 'f10').length, 0)
    },
  },
  // ── 段 S5:上限护栏(AC1;#185 第 6 条「超限从旧到新归档但绝不破保底」)──
  {
    id: 'S5a',
    name: '护栏:25 个全年轻 cap=12 → 从旧到新补选 13 个(reason=cap),余量恰回 cap,保底不动',
    run: () => {
      const ids = Array.from({ length: 25 }, (_, i) => `w1-s${String(i + 1).padStart(2, '0')}`)
      // 全年轻(ages 1..25),retention 30 选不到任何——护栏是唯一触发面
      const plan = selectArchivePlan({ sessions: ladder(ids, 'w1', 1) }, config({ cap: 12 }), NOW)
      assert.deepStrictEqual(
        plan.toArchive,
        Array.from({ length: 13 }, (_, i) => `w1-s${String(25 - i).padStart(2, '0')}`), // 最老 13 个,从旧到新
      )
      for (const entry of plan.groups[0].toArchive) assert.strictEqual(entry.reason, ARCHIVE_REASONS.cap)
      assert.strictEqual(25 - plan.toArchive.length, 12) // 归档后恰回 cap
      assert.strictEqual(plan.groups[0].keptYoung, 2) // 15 个年轻候选位 - 13 补选
      const remaining = ids.filter((id) => !plan.toArchive.includes(id))
      for (const id of plan.groups[0].floorIds) assert.ok(remaining.includes(id)) // 保底未被破
    },
  },
  {
    id: 'S5b',
    name: '护栏 1096 量级:1096 个全年轻 cap=900 → 精确归档最老 196 个、余 900、保底在内(报告值量级形态)',
    run: () => {
      // 1096 = #185 报告值(票面:不当作固定常量,此处只作量级形态)。保留期直给 2000
      // (B 的契约 = 正数;档位白名单 14/30/60/90 是 A 的 normalizeConfig 面)使全会话年轻。
      const ids = Array.from({ length: 1096 }, (_, i) => `bulk-${String(i).padStart(4, '0')}`)
      const sessions = ids.map((id, i) => session(id, 'w', 1096 - i)) // ids[0] 最老(1096d)…ids[1095] 最新(1d)
      const plan = selectArchivePlan({ sessions }, { enabled: true, retentionDays: 2000, cap: 900 }, NOW)
      assert.strictEqual(plan.toArchive.length, 196)
      assert.deepStrictEqual(
        plan.toArchive,
        ids.slice(0, 196), // 最老 196 个,从旧到新
      )
      for (const entry of plan.groups[0].toArchive) assert.strictEqual(entry.reason, ARCHIVE_REASONS.cap)
      const remaining = new Set(ids.slice(196))
      assert.strictEqual(remaining.size, 900)
      for (const id of plan.groups[0].floorIds) assert.ok(remaining.has(id)) // 保底 10 个未被破
    },
  },
  {
    id: 'S5c',
    name: '护栏与年龄规则合流:retention 先选尽超龄,护栏只补「仍超 cap」余量(年轻,从旧到新);retention 已够则护栏零补选',
    run: () => {
      // 25 会话:最新 10 个 ages 1..10(保底)、11..15 年轻(ages 11..15)、16..25 超龄(ages 31..40)
      const ids = Array.from({ length: 25 }, (_, i) => `w1-s${String(i + 1).padStart(2, '0')}`)
      const ages = [...Array.from({ length: 10 }, (_, i) => i + 1), ...Array.from({ length: 5 }, (_, i) => i + 11), ...Array.from({ length: 10 }, (_, i) => i + 31)]
      const sessions = ids.map((id, i) => session(id, 'w1', ages[i]))
      const cap12 = selectArchivePlan({ sessions }, config({ cap: 12 }), NOW)
      // retention 先选尽 10 个超龄;need = 25-10-12 = 3 → 补选 3 个最老年轻位(s15,s14,s13)
      assert.deepStrictEqual(cap12.toArchive, [
        ...Array.from({ length: 10 }, (_, i) => `w1-s${String(25 - i).padStart(2, '0')}`), // 超龄 10 个从旧到新
        'w1-s15', 'w1-s14', 'w1-s13', // 护栏补选 3 个(余量),从旧到新
      ])
      const reasons = cap12.groups[0].toArchive.map((e) => e.reason)
      assert.deepStrictEqual(reasons, [...Array(10).fill(ARCHIVE_REASONS.retention), ...Array(3).fill(ARCHIVE_REASONS.cap)])
      assert.strictEqual(cap12.groups[0].keptYoung, 2)
      // 对照:cap=5 时 need = 25-10-5 = 10,但护栏可选池只剩 5 个年轻位 → 全部选完,
      // 最终可见 10(= 保底)> cap 5:保底为底、可选位选尽,如实呈现不硬凑
      const cap5 = selectArchivePlan({ sessions }, config({ cap: 5 }), NOW)
      assert.deepStrictEqual(cap5.toArchive, [
        ...Array.from({ length: 10 }, (_, i) => `w1-s${String(25 - i).padStart(2, '0')}`), // retention 10 个
        'w1-s15', 'w1-s14', 'w1-s13', 'w1-s12', 'w1-s11', // 护栏把年轻位选尽(cap)
      ])
      const reasons5 = cap5.groups[0].toArchive.map((e) => e.reason)
      assert.deepStrictEqual(reasons5, [...Array(10).fill(ARCHIVE_REASONS.retention), ...Array(5).fill(ARCHIVE_REASONS.cap)])
      assert.strictEqual(25 - cap5.toArchive.length, 10) // 停在保底
    },
  },
  {
    id: 'S5d',
    name: '护栏 cap < 保底:绝不破保底——只归档保底外可选位,最终可见数停在保底',
    run: () => {
      const ids = Array.from({ length: 12 }, (_, i) => `w1-s${String(i + 1).padStart(2, '0')}`)
      const plan = selectArchivePlan({ sessions: ladder(ids, 'w1', 1) }, config({ cap: 5 }), NOW)
      assert.deepStrictEqual(plan.toArchive, ['w1-s12', 'w1-s11']) // 保底外只有 2 个可选位
      assert.strictEqual(12 - plan.toArchive.length, 10) // 停在保底 10,不破 cap=5 的更深层
    },
  },
  {
    id: 'S5e',
    name: '护栏被排除面挡住:pinned 占位不可选,护栏到不了 cap 就把可选的选完(如实呈现)',
    run: () => {
      const ids = Array.from({ length: 20 }, (_, i) => `w1-s${String(i + 1).padStart(2, '0')}`)
      // 20 个全年轻;最老 5 个(ages 16..20)pinned
      const sessions = ids.map((id, i) => session(id, 'w1', i + 1, i + 1 > 15 ? { pinned: true } : {}))
      const plan = selectArchivePlan({ sessions }, config({ cap: 10 }), NOW)
      assert.strictEqual(plan.toArchive.length, 5) // 只归档 5 个非 pinned 可选位
      for (const entry of plan.groups[0].toArchive) assert.strictEqual(entry.reason, ARCHIVE_REASONS.cap)
      assert.strictEqual(plan.skipped.length, 5)
      assert.ok(plan.skipped.every((s) => s.reason === SKIP_REASONS.pinned))
      assert.strictEqual(20 - plan.toArchive.length, 15) // > cap 10:pinned 挡住,如实呈现
    },
  },
  // ── 段 S6:archived 幂等面(AC2「重复运行已归档跳过」)──
  {
    id: 'S6',
    name: '已在归档集合(全局集/逐会话标记)不入可见池:visibleCount 不含、记 skipped(archived)、零归档',
    run: () => {
      const ids = Array.from({ length: 12 }, (_, i) => `w1-s${String(i + 1).padStart(2, '0')}`)
      // 保底 10 个 ages 1..10;候选位 2 个 ages 15,16(> 保留期 14——A 档位白名单内的取值)
      const sessions = [...ladder(ids.slice(0, 10), 'w1', 1), session(ids[10], 'w1', 15), session(ids[11], 'w1', 16)]
      sessions[10] = { ...sessions[10], archived: true } // w1-s11:逐会话标记
      const view = { sessions, archivedSessionIds: ['w1-s12'] } // w1-s12:全局集合
      const plan = selectArchivePlan(view, config({ retentionDays: 14 }), NOW)
      assert.deepStrictEqual(plan.toArchive, [])
      assert.deepStrictEqual(plan.skipped, [
        { sessionId: 'w1-s11', reason: SKIP_REASONS.archived },
        { sessionId: 'w1-s12', reason: SKIP_REASONS.archived },
      ])
      const g = plan.groups[0]
      assert.strictEqual(g.visibleCount, 10) // 归档集合会话不入可见池
      assert.strictEqual(g.floorCount, 10)
    },
  },
  // ── 段 S7:非法输入响亮抛(期望侧:这些必须始终是红)──
  {
    id: 'S7',
    name: '非法快照/配置/计划响亮拒绝并点名(view 非对象/sessions 缺/空 id/重复 id/非有限时间戳/坏 workspaceId/坏 retentionDays/坏 cap/坏 plan/缺 archiveSession)',
    run: async () => {
      const cfg = config()
      assert.throws(() => selectArchivePlan(null, cfg, NOW), /清点源快照/)
      assert.throws(() => selectArchivePlan({}, cfg, NOW), /sessions/)
      assert.throws(() => selectArchivePlan({ sessions: ['x'] }, cfg, NOW), /sessions\[0\]/)
      assert.throws(() => selectArchivePlan({ sessions: [{ sessionId: '', lastActivityAt: 1 }] }, cfg, NOW), /sessionId/)
      assert.throws(
        () => selectArchivePlan({ sessions: [{ sessionId: 'dup', workspaceId: 'w', lastActivityAt: 1 }, { sessionId: 'dup', workspaceId: 'w', lastActivityAt: 2 }] }, cfg, NOW),
        /重复/,
      )
      assert.throws(() => selectArchivePlan({ sessions: [{ sessionId: 's', workspaceId: 'w', lastActivityAt: Number.NaN }] }, cfg, NOW), /lastActivityAt/)
      assert.throws(() => selectArchivePlan({ sessions: [{ sessionId: 's', workspaceId: 'w', lastActivityAt: undefined }] }, cfg, NOW), /lastActivityAt/)
      assert.throws(() => selectArchivePlan({ sessions: [{ sessionId: 's', workspaceId: 42, lastActivityAt: 1 }] }, cfg, NOW), /workspaceId/)
      assert.throws(() => selectArchivePlan({ sessions: [{ sessionId: 's', workspaceId: 'w', lastActivityAt: 1 }] }, { enabled: true, retentionDays: 0 }, NOW), /retentionDays/)
      assert.throws(() => selectArchivePlan({ sessions: [{ sessionId: 's', workspaceId: 'w', lastActivityAt: 1 }] }, { enabled: true, retentionDays: 30, cap: 0.5 }, NOW), /cap/)
      // 执行面契约(executeArchivePlan 是 async:用 assert.rejects 逮 Promise rejection)
      await assert.rejects(() => executeArchivePlan({}, noActivityRegistry()), /groups\/toArchive/)
      await assert.rejects(() => executeArchivePlan({ toArchive: [], groups: [] }, {}), /archiveSession/)
      await assert.rejects(() => executeArchivePlan({ toArchive: [], groups: [] }, { archiveSession: 'x' }), /archiveSession/)
      await assert.rejects(() => executeArchivePlan({ toArchive: [], groups: [{ toArchive: [{ reason: 'cap' }] }] }, noActivityRegistry()), /sessionId/)
    },
  },
  // ── 段 S8:同龄并列 tie-break(实现注释承诺「同时刻并列按 sessionId 码元序升序」——
  //    本用例把承诺钉进回归:复审③,2026-11-15)──
  {
    id: 'S8',
    name: '同龄并列 tie-break:同时刻会话排序确定——保底选取(从新到旧)并列=码元序升序、执行序(从旧到新=该总序逐对取反)并列=码元序降序(快照数组序打乱仍确定,丢 tie-break 即红)',
    run: () => {
      // 11 条同龄(age 40,超 30 保留期)+2 条年轻;同龄组在快照里**乱序**给出——sort 稳定
      // 的引擎上,比较器若丢 tie-break(并列返回 0)输出=输入乱序,本用例即红(码元序承诺
      // 由此有回归保护,不再是「注释承诺了却没钉」)。并列方向不另立第二排序语义:执行序
      // = 「从新到旧」总序的逐对取反(实现 byOldestFirst = byNewestFirst(b,a)),故同龄在
      // 执行序中呈码元序降序。
      const tieIds = ['tie-07', 'tie-03', 'tie-11', 'tie-01', 'tie-09', 'tie-05', 'tie-02', 'tie-10', 'tie-04', 'tie-08', 'tie-06']
      const sessions = [
        session('young-2', 'w', 2),
        ...tieIds.map((id) => session(id, 'w', 40)),
        session('young-1', 'w', 1),
      ]
      const plan = selectArchivePlan({ sessions }, config(), NOW)
      const g = plan.groups[0]
      // 保底选取:同龄时 id 码元序小者视为「新」——young 2 条 + 码元序最小的 8 条
      assert.deepStrictEqual(g.floorIds, ['young-1', 'young-2', 'tie-01', 'tie-02', 'tie-03', 'tie-04', 'tie-05', 'tie-06', 'tie-07', 'tie-08'])
      // 执行序:同龄并列 = 码元序降序(「从旧到新」总序的取反方向)
      assert.deepStrictEqual(plan.toArchive, ['tie-11', 'tie-10', 'tie-09'])
      assert.deepStrictEqual(g.toArchive.map((e) => e.reason), Array(3).fill(ARCHIVE_REASONS.retention))
    },
  },
  // ── 段 E:执行(AC2 单参调用不带 stopActivity / 活动拒绝跳过 / AC3 失败继续与计数)──
  {
    id: 'E1',
    name: '执行逐会话单参调用 archiveSession(不带 stopActivity),调用序 = plan 执行序(从旧到新)',
    run: async () => {
      const ids = Array.from({ length: 15 }, (_, i) => `w1-s${String(i + 1).padStart(2, '0')}`)
      const plan = selectArchivePlan({ sessions: ladder(ids, 'w1', 32) }, config(), NOW)
      const registry = noActivityRegistry()
      const execution = await executeArchivePlan(plan, registry)
      assert.deepStrictEqual(execution.archived, plan.toArchive)
      assert.deepStrictEqual(execution.skipped, [])
      assert.deepStrictEqual(execution.failed, [])
      assert.strictEqual(registry.calls.length, 5)
      for (const args of registry.calls) assert.strictEqual(args.length, 1) // 单参:不带 stopActivity(AC2)
      assert.deepStrictEqual(registry.calls.map((args) => args[0]), plan.toArchive)
    },
  },
  {
    id: 'E2',
    name: '活动拒绝(WorkspaceActiveSessionError 形态)记 skipped(active)+detail,其余候选继续',
    run: async () => {
      const plan = selectArchivePlan(
        {
          sessions: [
            ...ladder(Array.from({ length: 10 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`), 'w', 1), // 凑保底
            session('a1', 'w', 31),
            session('a2', 'w', 32),
            session('a3', 'w', 33),
          ],
        },
        config(),
        NOW,
      )
      assert.deepStrictEqual(plan.toArchive, ['a3', 'a2', 'a1']) // 从旧到新
      const calls = []
      const registry = {
        archiveSession: async (id) => {
          calls.push(id)
          if (id === 'a2') {
            const error = new Error("cannot archive session 'a2': turn still running")
            error.name = 'WorkspaceActiveSessionError'
            throw error
          }
        },
      }
      const execution = await executeArchivePlan(plan, registry)
      assert.deepStrictEqual(execution.archived, ['a3', 'a1']) // a2 被拒,a1 在其后继续被调
      assert.deepStrictEqual(execution.skipped, [{ sessionId: 'a2', reason: SKIP_REASONS.active, detail: "cannot archive session 'a2': turn still running" }])
      assert.deepStrictEqual(execution.failed, [])
      assert.deepStrictEqual(calls, ['a3', 'a2', 'a1']) // 失败不中断后续候选(AC3)
    },
  },
  {
    id: 'E3',
    name: '一般失败记录后继续;outcome 直喂 recordRun:failures 累计、lastRun.ok=false、失败原因可回读(喂 A 运行记录面)',
    run: async () => {
      const sessions = [
        ...ladder(Array.from({ length: 10 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`), 'w', 1),
        session('x1', 'w', 31),
        session('x2', 'w', 32),
        session('x3', 'w', 33),
      ]
      const registry = {
        archiveSession: async (id) => {
          if (id === 'x1') throw new Error('boom')
          if (id === 'x3') throw 'weird-string' // 非 Error 抛出物也要如实记录
        },
      }
      const { outcome, report } = await runArchiveCycle({ sessions }, config(), registry, NOW)
      assert.deepStrictEqual(report.archivedIds, ['x2'])
      assert.deepStrictEqual(report.failed, [
        { sessionId: 'x3', error: 'weird-string' }, // 执行序最前(x3 最老),先失败先记录
        { sessionId: 'x1', error: 'boom' },
      ])
      assert.strictEqual(outcome.ok, false)
      assert.strictEqual(outcome.archived, 1)
      assert.strictEqual(outcome.skipped, 0)
      assert.ok(outcome.error.includes('x1') && outcome.error.includes('boom'))
      assert.ok(outcome.error.includes('x3') && outcome.error.includes('weird-string'))
      // 直喂 A 的 recordRun(#196 AC3「喂 A 的运行记录面」)
      const runlog = recordRun(emptyRunlog(), config(), outcome, NOW)
      assert.deepStrictEqual(runlog.totals, { runs: 1, archived: 1, skipped: 0, failures: 1 })
      assert.strictEqual(runlog.lastRun.ok, false)
      assert.ok(runlog.lastRun.error.includes('boom'))
    },
  },
  {
    id: 'E4',
    name: '幂等(AC2 重复运行已归档跳过):忠实快照(归档面隐藏)全零;原始快照记 skipped(archived);陈旧快照重调由上游幂等 no-op 兜底',
    run: async () => {
      const ids = Array.from({ length: 12 }, (_, i) => `w1-s${String(i + 1).padStart(2, '0')}`)
      // 保底 10 个 ages 1..10;候选位 2 个 ages 15,16(> 保留期 14——A 档位白名单内的取值)
      const allSessions = [...ladder(ids.slice(0, 10), 'w1', 1), session(ids[10], 'w1', 15), session(ids[11], 'w1', 16)]
      const archivedSet = []
      const registry = {
        archiveSession: async (id) => {
          archivedSet.push(id) // 上游形态:写入归档集合;对已归档 id 幂等 no-op(resolve)
        },
      }
      // 第一轮:2 个候选归档
      const first = await runArchiveCycle({ sessions: allSessions }, config({ retentionDays: 14 }), registry, NOW)
      assert.deepStrictEqual(first.report.archivedIds, ['w1-s12', 'w1-s11'])
      assert.strictEqual(first.outcome.ok, true)
      // 第二轮·忠实适配(归档集合会话已从分组面隐藏——上游 archivedSessionIds 语义):
      const faithful = await runArchiveCycle(
        { sessions: allSessions.filter((s) => !archivedSet.includes(s.sessionId)) },
        config({ retentionDays: 14 }),
        registry,
        NOW,
      )
      assert.deepStrictEqual(faithful.plan.toArchive, [])
      assert.deepStrictEqual(faithful.report.archivedIds, [])
      assert.deepStrictEqual(faithful.report.skipped, [])
      assert.deepStrictEqual(faithful.report.failed, [])
      assert.deepStrictEqual(faithful.outcome, { ok: true, archived: 0, skipped: 0 })
      // 第二轮·原始适配(快照仍含已归档会话+归档集合):记 skipped(archived),零归档
      const raw = await runArchiveCycle(
        { sessions: allSessions, archivedSessionIds: [...archivedSet] },
        config({ retentionDays: 14 }),
        registry,
        NOW,
      )
      assert.deepStrictEqual(raw.plan.toArchive, [])
      assert.deepStrictEqual(raw.report.skipped, [
        { sessionId: 'w1-s11', reason: SKIP_REASONS.archived }, // preSkipped 按快照会话序(s11 在前)
        { sessionId: 'w1-s12', reason: SKIP_REASONS.archived },
      ])
      // 第二轮·陈旧适配(快照不知道归档集合):重调 archiveSession——上游对已归档 id
      // 幂等 no-op(resolve 不写),执行面不预检、由上游幂等兜 race(机制事实节)
      const stale = await runArchiveCycle({ sessions: allSessions }, config({ retentionDays: 14 }), registry, NOW)
      assert.deepStrictEqual(stale.report.archivedIds, ['w1-s12', 'w1-s11'])
      assert.strictEqual(stale.outcome.ok, true)
    },
  },
  {
    id: 'E5',
    name: 'runArchiveCycle 组合:plan/report/outcome 形状;组序(实体组字典序+虚拟组殿后);report.skipped = 选择期+执行期并集;outcome 直喂 recordRun 计成功与跳过',
    run: async () => {
      const sessions = [
        ...ladder(['f01', 'f02', 'f03', 'f04', 'f05', 'f06', 'f07', 'f08', 'f09', 'f10'], 'w1', 1),
        session('w1-pin', 'w1', 31, { pinned: true }), // 选择期排除
        session('w1-act', 'w1', 32), // 执行期活动拒绝
        session('w1-ok', 'w1', 33), // 成功
        session('v-old', null, 40), // 虚拟组(保底 1 个,全保)
      ]
      const registry = {
        archiveSession: async (id) => {
          if (id === 'w1-act') {
            const error = new Error('activity: turn')
            error.name = 'WorkspaceActiveSessionError'
            throw error
          }
        },
      }
      const { plan, report, outcome } = await runArchiveCycle({ sessions }, config(), registry, NOW)
      assert.deepStrictEqual(plan.groups.map((g) => g.workspaceId), ['w1', null]) // 虚拟组殿后
      assert.deepStrictEqual(plan.toArchive, ['w1-ok', 'w1-act']) // 从旧到新;虚拟组全保
      assert.deepStrictEqual(report.archivedIds, ['w1-ok'])
      assert.deepStrictEqual(report.skipped, [
        { sessionId: 'w1-pin', reason: SKIP_REASONS.pinned }, // 选择期
        { sessionId: 'w1-act', reason: SKIP_REASONS.active, detail: 'activity: turn' }, // 执行期
      ])
      assert.deepStrictEqual(report.failed, [])
      assert.deepStrictEqual(outcome, { ok: true, archived: 1, skipped: 2 })
      const runlog = recordRun(emptyRunlog(), config(), outcome, NOW)
      assert.deepStrictEqual(runlog.totals, { runs: 1, archived: 1, skipped: 2, failures: 0 })
    },
  },
]

/** verify-all 入口:逐项执行、汇总、exit 0/1(与 verify-session-archive.mjs 同款 isMain 判别
 *  ——被 spec 薄入口 import 时不跑)。 */
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
