/**
 * verify-session-archive.mjs —— session-archive.mjs(#195,会话归档 v1 子票 A)的**判据核心**
 * 与 verify-all 快集/全量入口(复审批注①,2026-11-15)。
 *
 * 为什么本文件存在(缺口实录):票面 AC6 证明命令 `npx vitest run tests/session-archive.spec.ts`
 * 的判据面最初只写在 spec.ts 里,而 scripts/verify-all.mjs 只拾取 tests/*.mjs(readdirSync
 * 过滤 .endsWith('.mjs'),spec.ts 永不进快集也不进 --all)——批末门对本票 27 例双向钉**假绿**。
 * 收口形态照 #180 双入口先例(tests/exports-audit.mjs 头注明文「判据核心与快集入口是同一个…
 * 两入口共用…不另写第二份判据(D6:判定点重复)」):
 *   - **判据面只在本文件**:`CHECKS` 数组,每项 `{ id, name, run }`,run() 抛错=红;
 *   - `node tests/verify-session-archive.mjs` = verify-all 入口(scripts/verify-all.mjs
 *     自动拾取 tests/*.mjs),逐项执行、汇总、exit 0/1;
 *   - `tests/session-archive.spec.ts` = 票面 AC6 的 vitest 薄入口,逐项包装同一 CHECKS
 *     (import 即同源,spec 侧零判据)。
 *
 * 覆盖段(与 spec 薄入口同序):D=默认值 / N=配置校验(双向:合法放行+非法拒绝点名)/
 * F=配置读写与持久化 / L=运行记录面 / G=开关切换与调度 gate(AC4)+frequency 变更刷新
 * (复审批注③)/ T=下次运行计算(本地时区边界)/ P=插件骨架接线(含行 config 未知键
 * 白名单,复审批注②;#197 起 P1 另钉 timer tick 注册形态——apply 挂载即注册 60s
 * interval,mockCtx 桩在场)。
 *
 * 双向钉(AC5「单侧改必红」):实现侧改必红(D 默认值逐字段/D2 白名单集合相等/T 固定
 * after 断言具体日时刻/G 开关语义)+ 期望侧改必红(N 非法值必须被拒)。扰动真红记录:
 * 首轮三扰动(默认保留期 30→45=3 红/默认开关翻 true=7 红/weekly 严格语义 <= 放宽为 <
 * 致到点不排下轮=1 红,恢复后 27/27 绿)+ 复审轮再证(见 .scratch/verify195/ 复审日志)。
 *
 * 隔离:需要盘面的用例(F/L 段)自建自删 os.tmpdir() 下 mkdtemp 目录(每例独立,
 * finally 收尾);P3 的 DSH_HOME 探针 try/finally 还原环境;**绝不**读写真实 home。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DEFAULTS,
  FREQUENCY_KINDS,
  RETENTION_CHOICES,
  TICK_MS,
  WEEKDAY_NAMES,
  appendEvent,
  apply,
  applyConfigChange,
  computeNextRun,
  defaultStorageDir,
  effectiveSchedule,
  emptyRunlog,
  normalizeConfig,
  readConfig,
  readRunlog,
  recordRun,
  storagePaths,
  writeConfig,
  writeRunlog,
} from '../session-archive.mjs'

/** 非空洞下界:判据面误删(重构漏迁/循环被截)时快集响亮红而不是静默缩水。 */
export const MIN_CHECKS = 29

/** apply 挂载面 mock ctx:interval 桩记录注册形态(#197 子票 C 接线后 apply 在挂载时
 *  注册 60s tick——cordis-plugin-timer 的 ctx.mixin 面);get 桩返回 undefined(服务缺席,
 *  挂载本身不消费——快照合成/归档动作都在触发时惰性取)。 */
function mockCtx() {
  const intervals = []
  return {
    intervals,
    interval(callback, delay) {
      intervals.push({ callback, delay })
      return () => {}
    },
    get: () => undefined,
  }
}

/** 判据面唯一事实源:每项 run() 抛错=红。需要盘面的用例自建自删临时目录。 */
export const CHECKS = [
  // ── 段 D:默认值(票面 AC2 括号内默认值的钉;实现侧改任何一项必红)──
  {
    id: 'D1',
    name: 'DEFAULTS 逐字段 = 票面 AC2 的默认值(启用关/每周周日03:00/保留30/护栏关)',
    run: () => {
      assert.strictEqual(DEFAULTS.enabled, false)
      assert.deepStrictEqual(DEFAULTS.frequency, { kind: 'weekly', weekday: 0, time: '03:00' })
      assert.strictEqual(DEFAULTS.retentionDays, 30)
      assert.strictEqual(DEFAULTS.cap, null)
    },
  },
  {
    id: 'D2',
    name: '频率三形态与保留期四档是封闭白名单(集合相等:增删即红)',
    run: () => {
      assert.deepStrictEqual([...FREQUENCY_KINDS], ['weekly', 'semimonthly', 'monthly'])
      assert.deepStrictEqual([...RETENTION_CHOICES], [14, 30, 60, 90])
      assert.strictEqual(WEEKDAY_NAMES[0], '周日')
    },
  },
  {
    id: 'D3',
    name: '空对象补齐 = 全默认(缺字段补齐,{} 即首装默认关)',
    run: () => {
      const verdict = normalizeConfig({})
      assert.strictEqual(verdict.ok, true)
      assert.deepStrictEqual(verdict.config, { version: 1, ...DEFAULTS, frequency: { ...DEFAULTS.frequency } })
    },
  },
  // ── 段 N:配置校验(双向——合法放行 / 非法拒绝并点名)──
  {
    id: 'N1',
    name: '合法配置放行且规范化补全(weekly/semimonthly/monthly 各一)',
    run: () => {
      const weekly = normalizeConfig({ enabled: true, frequency: { kind: 'weekly', weekday: 3, time: '05:30' }, retentionDays: 60, cap: 900 })
      assert.strictEqual(weekly.ok, true)
      assert.deepStrictEqual(weekly.config, { version: 1, enabled: true, frequency: { kind: 'weekly', weekday: 3, time: '05:30' }, retentionDays: 60, cap: 900 })
      const semi = normalizeConfig({ enabled: true, frequency: { kind: 'semimonthly', time: '22:00' } })
      assert.strictEqual(semi.ok, true)
      assert.deepStrictEqual(semi.config.frequency, { kind: 'semimonthly', time: '22:00' })
      const monthly = normalizeConfig({ frequency: { kind: 'monthly', day: 28, time: '23:59' }, cap: 1 })
      assert.strictEqual(monthly.ok, true)
      assert.deepStrictEqual(monthly.config.frequency, { kind: 'monthly', day: 28, time: '23:59' })
      assert.strictEqual(monthly.config.retentionDays, 30) // 缺省补齐
      assert.strictEqual(monthly.config.enabled, false) // 缺省补齐
    },
  },
  {
    id: 'N2',
    name: '非法开关/保留期/护栏被拒并点名(期望侧:这些必须始终是红)',
    run: () => {
      assert.strictEqual(normalizeConfig({ enabled: 'yes' }).ok, false)
      assert.strictEqual(normalizeConfig({ enabled: 1 }).ok, false)
      assert.match(normalizeConfig({ retentionDays: 45 }).problems.join(), /retentionDays/)
      assert.strictEqual(normalizeConfig({ retentionDays: 14.5 }).ok, false)
      assert.strictEqual(normalizeConfig({ retentionDays: '30' }).ok, false)
      assert.strictEqual(normalizeConfig({ cap: 0 }).ok, false)
      assert.strictEqual(normalizeConfig({ cap: -1 }).ok, false)
      assert.strictEqual(normalizeConfig({ cap: 900.5 }).ok, false)
      assert.strictEqual(normalizeConfig({ cap: '900' }).ok, false)
      assert.strictEqual(normalizeConfig({ cap: 900 }).ok, true) // 对照:护栏开启合法
      assert.strictEqual(normalizeConfig({ cap: null }).ok, true) // 对照:护栏关合法
    },
  },
  {
    id: 'N3',
    name: '频率白名单拒绝未知 kind;各形态拒绝非法参数(day 29 上限 / weekday 0-6 / 两位 HH:mm)',
    run: () => {
      assert.match(normalizeConfig({ frequency: { kind: 'daily', time: '03:00' } }).problems.join(), /frequency\.kind/)
      for (const bad of [0, 29, 30, 31, 1.5, '15']) {
        assert.strictEqual(normalizeConfig({ frequency: { kind: 'monthly', day: bad, time: '03:00' } }).ok, false)
      }
      assert.strictEqual(normalizeConfig({ frequency: { kind: 'monthly', day: 28, time: '03:00' } }).ok, true)
      for (const bad of [-1, 7, 'mon', 1.5]) {
        assert.strictEqual(normalizeConfig({ frequency: { kind: 'weekly', weekday: bad, time: '03:00' } }).ok, false)
      }
      assert.strictEqual(normalizeConfig({ frequency: { kind: 'weekly', weekday: 6, time: '03:00' } }).ok, true)
      for (const bad of ['3:00', '03:0', '24:00', '12:60', '0300', 300, '']) {
        assert.strictEqual(normalizeConfig({ frequency: { kind: 'weekly', time: bad } }).ok, false)
      }
      assert.strictEqual(normalizeConfig({ frequency: { kind: 'weekly', time: '00:00' } }).ok, true)
      assert.strictEqual(normalizeConfig({ frequency: { kind: 'weekly', time: '23:59' } }).ok, true)
    },
  },
  {
    id: 'N4',
    name: '未知键拒绝并点名(错拼键静默失效的防线:enbled/frequency 内多余键)',
    run: () => {
      const typo = normalizeConfig({ enbled: true })
      assert.strictEqual(typo.ok, false)
      assert.match(typo.problems.join(), /enbled/)
      const extra = normalizeConfig({ frequency: { kind: 'semimonthly', time: '03:00', weekday: 1 } })
      assert.strictEqual(extra.ok, false)
      assert.match(extra.problems.join(), /weekday/)
      assert.strictEqual(normalizeConfig({ frequency: 'weekly' }).ok, false)
      assert.strictEqual(normalizeConfig('enabled').ok, false)
    },
  },
  {
    id: 'N5',
    name: 'version 锚钉 1(schema 版本漂移即红)',
    run: () => {
      assert.strictEqual(normalizeConfig({ version: 1 }).ok, true)
      assert.strictEqual(normalizeConfig({ version: 2 }).ok, false)
    },
  },
  // ── 段 F:配置读写与持久化(AC2:文件形态,重启保持;临时目录每例自建自删)──
  {
    id: 'F1',
    name: '首装态(无 config.json)= 全默认且 source: defaults(默认关,缺席是合法态)',
    run: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'session-archive-verify-'))
      try {
        const read = await readConfig(dir)
        assert.strictEqual(read.source, 'defaults')
        assert.deepStrictEqual(read.problems, [])
        assert.strictEqual(read.config.enabled, false)
        assert.deepStrictEqual(read.config, { version: 1, ...DEFAULTS, frequency: { ...DEFAULTS.frequency } })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
  {
    id: 'F2',
    name: 'roundtrip:写→读逐字段相等(持久化形态落盘真实成立)',
    run: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'session-archive-verify-'))
      try {
        const config = await writeConfig(dir, { enabled: true, frequency: { kind: 'monthly', day: 15, time: '04:30' }, retentionDays: 90, cap: 900 })
        const read = await readConfig(dir)
        assert.strictEqual(read.source, 'file')
        assert.deepStrictEqual(read.problems, [])
        assert.deepStrictEqual(read.config, config)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
  {
    id: 'F3',
    name: '非法配置拒写(抛错点名)→ 落盘面保持原状;坏 JSON/坏内容读回 = problems 非空 + 默认兜底',
    run: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'session-archive-verify-'))
      try {
        await writeConfig(dir, { enabled: true })
        await assert.rejects(() => writeConfig(dir, { retentionDays: 45 }), /retentionDays/)
        const intact = await readConfig(dir)
        assert.strictEqual(intact.config.enabled, true) // 拒写不损伤原值
        const { configFile } = storagePaths(dir)
        await writeFile(configFile, '{ not json', 'utf8')
        const bad = await readConfig(dir)
        assert.strictEqual(bad.source, 'file')
        assert.ok(bad.problems.length > 0)
        assert.match(bad.problems.join(), /config\.json/)
        assert.strictEqual(bad.config.enabled, false) // 坏配置以默认(关)兜底,不带半份配置跑
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
  // ── 段 L:运行记录面(AC3:上次运行/下次运行/归档数/跳过数/失败原因)──
  {
    id: 'L1',
    name: '首装态运行记录 = 空账(lastRun null / totals 全 0 / nextRun null)',
    run: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'session-archive-verify-'))
      try {
        const read = await readRunlog(dir)
        assert.strictEqual(read.source, 'defaults')
        assert.deepStrictEqual(read.runlog, emptyRunlog())
        assert.deepStrictEqual(read.runlog.totals, { runs: 0, archived: 0, skipped: 0, failures: 0 })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
  {
    id: 'L2',
    name: 'recordRun 落账四元读数并累计(AC3 字段逐项在场;失败带失败原因)',
    run: () => {
      const config = normalizeConfig({ enabled: true }).config
      const now1 = new Date(2026, 10, 1, 3, 0)
      const r1 = recordRun(emptyRunlog(), config, { ok: true, archived: 3, skipped: 1 }, now1)
      assert.deepStrictEqual(r1.lastRun, { at: now1.toISOString(), ok: true, archived: 3, skipped: 1 })
      assert.deepStrictEqual(r1.totals, { runs: 1, archived: 3, skipped: 1, failures: 0 })
      assert.notStrictEqual(r1.nextRun, null) // 启用态:运行后刷新下次运行
      const now2 = new Date(2026, 10, 15, 3, 0)
      const r2 = recordRun(r1, config, { ok: false, archived: 0, skipped: 0, error: 'registry 不可达' }, now2)
      assert.strictEqual(r2.lastRun.ok, false)
      assert.strictEqual(r2.lastRun.error, 'registry 不可达') // 失败原因可回读
      assert.deepStrictEqual(r2.totals, { runs: 2, archived: 3, skipped: 1, failures: 1 })
    },
  },
  {
    id: 'L3',
    name: 'recordRun 非法 outcome 响亮抛(内部 API 契约不静默兜)',
    run: () => {
      const config = normalizeConfig({}).config
      assert.throws(() => recordRun(emptyRunlog(), config, { ok: true, archived: -1, skipped: 0 }), /archived/)
      assert.throws(() => recordRun(emptyRunlog(), config, { ok: true, archived: 1, skipped: 'x' }), /skipped/)
    },
  },
  {
    id: 'L4',
    name: 'roundtrip 运行记录 + 坏文件重置回空并 problems 点名(不静默吞)',
    run: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'session-archive-verify-'))
      try {
        const config = normalizeConfig({ enabled: true }).config
        const log = recordRun(emptyRunlog(), config, { ok: true, archived: 2, skipped: 0 }, new Date(2026, 10, 1, 3, 0))
        await writeRunlog(dir, log)
        const read = await readRunlog(dir)
        assert.strictEqual(read.source, 'file')
        assert.deepStrictEqual(read.runlog, log)
        const { runlogFile } = storagePaths(dir)
        await writeFile(runlogFile, '[]', 'utf8')
        const bad = await readRunlog(dir)
        assert.ok(bad.problems.length > 0)
        assert.strictEqual(bad.runlog.totals.runs, 0)
        await assert.rejects(() => writeRunlog(dir, { ...log, totals: { ...log.totals, runs: -1 } }), /totals\.runs/)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
  {
    id: 'L5',
    name: 'appendEvent 封顶(超出丢最旧)——运行记录是回读面不是无界账本',
    run: () => {
      let log = emptyRunlog()
      for (let i = 0; i < 60; i++) log = appendEvent(log, { at: `t${i}`, kind: 'run' })
      assert.strictEqual(log.events.length, 50)
      assert.strictEqual(log.events[0].at, 't10') // 最旧十条已丢
      assert.strictEqual(log.events.at(-1).at, 't59')
    },
  },
  // ── 段 G:开关切换与调度 gate(AC4:开关取消 → 立即停止后续计划运行,已归档不回滚)──
  {
    id: 'G1',
    name: '开→关:nextRun 立即清空 + disabled 事件 + totals/lastRun 一字不动(已归档不回滚)',
    run: () => {
      const nowOff = new Date(2026, 10, 10, 12, 0)
      const configOn = normalizeConfig({ enabled: true }).config
      const configOff = normalizeConfig({ enabled: false }).config
      const log = recordRun(emptyRunlog(), configOn, { ok: true, archived: 7, skipped: 2 }, new Date(2026, 10, 1, 3, 0))
      assert.notStrictEqual(log.nextRun, null)
      const stopped = applyConfigChange(configOn, configOff, log, nowOff)
      assert.strictEqual(stopped.nextRun, null) // 「下次运行」从回读面立即消失
      assert.deepStrictEqual(stopped.totals, log.totals) // 不回滚
      assert.deepStrictEqual(stopped.lastRun, log.lastRun) // 不回滚
      assert.strictEqual(stopped.events.at(-1).kind, 'disabled')
      assert.strictEqual(stopped.events.at(-1).at, nowOff.toISOString())
    },
  },
  {
    id: 'G2',
    name: '关→开:enabled 事件 + nextRun 派生写入;同值切换 no-op(不造事件噪音)',
    run: () => {
      const nowOn = new Date(2026, 10, 14, 10, 0) // 周六
      const configOff = normalizeConfig({}).config
      const configOn = normalizeConfig({ enabled: true }).config
      const log = applyConfigChange(configOff, configOn, emptyRunlog(), nowOn)
      assert.strictEqual(log.nextRun, computeNextRun(configOn, nowOn).toISOString())
      assert.strictEqual(log.events.length, 1)
      assert.strictEqual(log.events[0].kind, 'enabled')
      const same = applyConfigChange(configOn, normalizeConfig({ enabled: true, retentionDays: 30 }).config, log, nowOn)
      assert.strictEqual(same, log) // 引用相等:enabled 与 frequency 均未变即原样返回
    },
  },
  {
    id: 'G3',
    name: 'gate 以 config 为权威(AC4「立即」):残留 nextRun 不影响停用判定',
    run: () => {
      const configOff = normalizeConfig({}).config
      const stale = { ...emptyRunlog(), nextRun: new Date(2099, 0, 1).toISOString() }
      assert.strictEqual(effectiveSchedule(configOff).active, false)
      assert.strictEqual(effectiveSchedule(configOff).stopReason, 'disabled')
      assert.strictEqual(effectiveSchedule(configOff).nextRun, null)
      assert.notStrictEqual(stale.nextRun, null) // 残留读数仍在文件里(记录面不改写历史)…
      assert.strictEqual(effectiveSchedule(configOff).active, false) // …但 gate 仍判停——不等残留 nextRun 到点
      const configOn = normalizeConfig({ enabled: true }).config
      const gate = effectiveSchedule(configOn, new Date(2026, 10, 14, 10, 0))
      assert.strictEqual(gate.active, true)
      assert.strictEqual(gate.nextRun.getTime(), computeNextRun(configOn, new Date(2026, 10, 14, 10, 0)).getTime())
    },
  },
  {
    id: 'G4',
    name: '启用态 frequency 变更 → nextRun 重算(回读面与当前配置一致),totals/lastRun/events 不动、零事件(复审批注③)',
    run: () => {
      const now = new Date(2026, 10, 14, 10, 0) // 周六
      const weekly = normalizeConfig({ enabled: true, frequency: { kind: 'weekly', weekday: 0, time: '03:00' } }).config
      const monthly = normalizeConfig({ enabled: true, frequency: { kind: 'monthly', day: 28, time: '22:00' } }).config
      const log = recordRun(emptyRunlog(), weekly, { ok: true, archived: 5, skipped: 1 }, new Date(2026, 10, 1, 3, 0))
      const eventsBefore = JSON.stringify(log.events)
      const refreshed = applyConfigChange(weekly, monthly, log, now)
      // 新 nextRun = 新频率(monthly 28 日 22:00)的派生值,不再指向旧 weekly 周日 03:00
      assert.strictEqual(refreshed.nextRun, computeNextRun(monthly, now).toISOString())
      assert.notStrictEqual(refreshed.nextRun, computeNextRun(weekly, now).toISOString())
      assert.deepStrictEqual(refreshed.totals, log.totals) // 不回滚
      assert.deepStrictEqual(refreshed.lastRun, log.lastRun) // 不回滚
      assert.strictEqual(JSON.stringify(refreshed.events), eventsBefore) // 零事件噪音
      // 对照:关着改频率 = 停用态没有「下次运行」可变,原样返回
      const offWeekly = normalizeConfig({ enabled: false, frequency: { kind: 'weekly', weekday: 0, time: '03:00' } }).config
      const offMonthly = normalizeConfig({ enabled: false, frequency: { kind: 'monthly', day: 28, time: '22:00' } }).config
      assert.strictEqual(applyConfigChange(offWeekly, offMonthly, log, now), log)
    },
  },
  // ── 段 T:下次运行计算(本地时区;固定 after 断言具体日时刻,频率语义改动即红)──
  // 固定基准全部用本地时间分量构造(不比较 UTC 串,任何宿主时区等价)。
  // 2026-11-14 是周六,2026-11-15 是周日(本链拆票当日,日历事实)。
  {
    id: 'T1',
    name: 'weekly 默认(周日 03:00):周六 10:00 → 当周周日;周日 04:00 → 下周日;恰逢到点 → 排下一轮',
    run: () => {
      const config = normalizeConfig({ enabled: true }).config // 周日 03:00
      const sat = new Date(2026, 10, 14, 10, 0)
      const next = computeNextRun(config, sat)
      assert.strictEqual(next.getDay(), 0)
      assert.strictEqual(next.getHours(), 3)
      assert.strictEqual(next.getMinutes(), 0)
      assert.strictEqual(next.getDate(), 15)
      const sunAfter = new Date(2026, 10, 15, 4, 0)
      const next2 = computeNextRun(config, sunAfter)
      assert.strictEqual(next2.getDay(), 0)
      assert.strictEqual(next2.getDate(), 22) // 整整 +7 天
      assert.ok(next2.getTime() > sunAfter.getTime())
      const sunExact = new Date(2026, 10, 15, 3, 0)
      const next3 = computeNextRun(config, sunExact) // 恰好等于到点时刻:严格「晚于」语义
      assert.strictEqual(next3.getDate(), 22)
    },
  },
  {
    id: 'T2',
    name: 'weekly 可改星期与时刻:周三 05:30,从周六出发 → 下周三',
    run: () => {
      const config = normalizeConfig({ enabled: true, frequency: { kind: 'weekly', weekday: 3, time: '05:30' } }).config
      const next = computeNextRun(config, new Date(2026, 10, 14, 10, 0))
      assert.strictEqual(next.getDay(), 3)
      assert.strictEqual(next.getHours(), 5)
      assert.strictEqual(next.getMinutes(), 30)
    },
  },
  {
    id: 'T3',
    name: 'semimonthly 固定 1+15:1 日 04:00(过了 03:00)→ 15 日;16 日 → 下月 1 日',
    run: () => {
      const config = normalizeConfig({ enabled: true, frequency: { kind: 'semimonthly', time: '03:00' } }).config
      const first = computeNextRun(config, new Date(2026, 10, 1, 4, 0))
      assert.strictEqual(first.getMonth(), 10)
      assert.strictEqual(first.getDate(), 15)
      assert.strictEqual(first.getHours(), 3)
      const mid = computeNextRun(config, new Date(2026, 10, 16, 0, 0))
      assert.strictEqual(mid.getMonth(), 11)
      assert.strictEqual(mid.getDate(), 1)
      const eve = computeNextRun(config, new Date(2026, 9, 31, 23, 0))
      assert.strictEqual(eve.getMonth(), 10)
      assert.strictEqual(eve.getDate(), 1)
    },
  },
  {
    id: 'T4',
    name: 'monthly 选日:day 28 过点 → 下月 28 日;day 1 未到点 → 当月当天;day 15 → 当月 15 日',
    run: () => {
      const d28 = normalizeConfig({ enabled: true, frequency: { kind: 'monthly', day: 28, time: '03:00' } }).config
      const rolled = computeNextRun(d28, new Date(2026, 10, 28, 3, 30))
      assert.strictEqual(rolled.getMonth(), 11)
      assert.strictEqual(rolled.getDate(), 28)
      const d1 = normalizeConfig({ enabled: true, frequency: { kind: 'monthly', day: 1, time: '03:00' } }).config
      const sameDay = computeNextRun(d1, new Date(2026, 10, 1, 0, 30))
      assert.strictEqual(sameDay.getDate(), 1)
      assert.strictEqual(sameDay.getHours(), 3)
      const d15 = normalizeConfig({ enabled: true, frequency: { kind: 'monthly', day: 15, time: '22:00' } }).config
      const nov15 = computeNextRun(d15, new Date(2026, 10, 10, 0, 0))
      assert.strictEqual(nov15.getDate(), 15)
      assert.strictEqual(nov15.getHours(), 22)
    },
  },
  {
    id: 'T5',
    name: '停用态无下次运行(AC4 的派生面:enabled=false → null)',
    run: () => {
      assert.strictEqual(computeNextRun(normalizeConfig({}).config, new Date(2026, 10, 14, 10, 0)), null)
    },
  },
  // ── 段 P:插件骨架接线(AC1:行 config 注入缝双向——合法放行 / 非法响亮拒绝)──
  {
    id: 'P1',
    name: 'apply 合法 storageDir 放行(绝对路径注入缝)+ timer tick 注册(#197:60s interval 挂 cordis-plugin-timer)',
    run: () => {
      const ctx = mockCtx()
      assert.doesNotThrow(() => apply(ctx, { storageDir: join(tmpdir(), 'session-archive-anywhere') }))
      assert.strictEqual(ctx.intervals.length, 1)
      assert.strictEqual(ctx.intervals[0].delay, TICK_MS)
      const ctxBare = mockCtx()
      assert.doesNotThrow(() => apply(ctxBare)) // 缺省 = <DSH_HOME>/storages/session-archive
      assert.strictEqual(ctxBare.intervals.length, 1)
    },
  },
  {
    id: 'P2',
    name: 'apply 非法 storageDir 响亮拒绝(相对路径/非串——挂载审计防线不静默)',
    run: () => {
      assert.throws(() => apply(mockCtx(), { storageDir: 'relative/dir' }), /storageDir/)
      assert.throws(() => apply(mockCtx(), { storageDir: 42 }), /storageDir/)
    },
  },
  {
    id: 'P3',
    name: 'defaultStorageDir 尊重 DSH_HOME(宿主惯例 DSH_HOME ?? ~/.dsh;env 注入即隔离)',
    run: () => {
      const prev = process.env.DSH_HOME
      try {
        process.env.DSH_HOME = join(tmpdir(), 'session-archive-home-probe')
        assert.strictEqual(defaultStorageDir(), join(process.env.DSH_HOME, 'storages', 'session-archive'))
        delete process.env.DSH_HOME
        assert.strictEqual(defaultStorageDir(), join(homedir(), '.dsh', 'storages', 'session-archive'))
      } finally {
        if (prev === undefined) delete process.env.DSH_HOME
        else process.env.DSH_HOME = prev
      }
    },
  },
  {
    id: 'P4',
    name: 'apply 行 config 未知键响亮拒绝(拼错键不再静默吞——复审批注②,与 normalizeConfig 同哲学)',
    run: () => {
      assert.throws(() => apply(mockCtx(), { storageDir: join(tmpdir(), 'x'), typo: 1 }), /typo/)
      assert.throws(() => apply(mockCtx(), { storage_dir: join(tmpdir(), 'x') }), /storage_dir/)
      // 对照:合法单键仍放行(白名单双向的两半)
      assert.doesNotThrow(() => apply(mockCtx(), { storageDir: join(tmpdir(), 'x') }))
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
