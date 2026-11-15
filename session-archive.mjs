/**
 * session-archive — standing-mount 会话归档维护插件（会话归档 v1，#185 拆票）。
 *
 * 载体拍板（#185 分诊定盘评论 6890884333，第 2/3 项）：preset standing-mount 内轻量
 * 维护插件，缓解宿主会话列表膨胀（上游 1096 形态）；v1 的配置/运行载体 = preset 插件
 * 自身面（文件形态），DSH 设置页集成属上游协作、另立不并本链。
 *
 * 本文件是**子票 A（#195）：骨架与配置面**。拆票分工：
 *   - 子票 A（本票）：插件注册（随 preset 分发）+ 配置面 v1（schema/读写/持久化）+
 *     运行记录面（上次运行/下次运行/归档数/跳过数/失败原因，可回读文件形态）+
 *     调度 gate（启用/停用语义，AC4）——全部为**导出纯函数面**，
 *     单测双向钉在 tests/verify-session-archive.mjs（判据核心 = CHECKS 数组，AC5/AC6；
 *     tests/session-archive.spec.ts 为 vitest 薄入口——#180 双入口形态，复审批注①）。
 *   - 子票 B：归档执行（workspace registry 按组清点、保留期/保底消费、归档动作）。
 *   - 子票 C：计划触发——cordis-plugin-timer（`ctx.timeout/interval/debounce/throttle`，
 *     随 fiber 释放，CONTEXT.md 已核环境事实）挂到本文件的 `effectiveSchedule` gate 上：
 *     启用时注册 interval、停用即清（AC4 的运行时接线点）。
 *   - 子票 D：seed 验证（1096 复现形态夹具）。
 *
 * 边界（ADR-0001 口径，票面原文）：**不装 dsh-schedule**（会话级提醒服务，冷会话不投递；
 * D3/ADR-0001:26 先例——「本插件不装 dsh-schedule」）；**不恢复 scheduled-jobs.mjs 技能
 * 同步任务**（#4 退役，形态考古可读 git 历史，内容不复制）；不承诺 DSH 设置页 UI。
 *
 * 配置持久化形态（插件惯例，文件形态，重启保持）：`<DSH_HOME>/storages/session-archive/`
 * 下两个机器本地 JSON——`config.json`（配置面）与 `runs.json`（运行记录面）。
 * DSH_HOME 解析照宿主惯例 `process.env.DSH_HOME ?? homedir()/.dsh`
 * （dsh-shell-host src/terminal/index.ts customDir 同款）；部署/测试可用行 config
 * `storageDir`（绝对路径）覆盖。默认关闭：首装（无 config.json）= 全默认值 =
 * enabled:false——挂载零副作用（本文件 apply 不建目录不写文件，首次写盘才建目录）。
 *
 * 并发面（v1 声明）：standing mount 单实例、单 fiber（cordis 语义），写盘走
 * tmp+rename 原子替换；不做跨进程文件锁——第二份写入面（子票 C 的 tick 与将来的
 * 配置面 UI 同进程串行）出现时再升级，此处显式声明而非静默假设。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-archive'

// ── 配置面 v1（票面 AC2 的四项，逐字段对应）────────────────────────────────────
// schema 形态 = 校验器白名单（未知键/非法值响亮拒绝，点名问题——配置错拼静默失效是
// 最经典的静默类失败，docs/silence-guardrails.md S 同族）；缺字段 = 取默认补齐
// （partial 文件友好；空对象 {} 即全默认）。两档分开：「非法」拒绝，「缺」补齐。

/** 频率选择三形态（票面 AC2：每周/半月/每月）。 */
export const FREQUENCY_KINDS = ['weekly', 'semimonthly', 'monthly']
/** 保留期白名单（票面 AC2：14/30/60/90，默认 30）。 */
export const RETENTION_CHOICES = [14, 30, 60, 90]
/** weekday 命名（0=周日，JS Date.getDay() 同序；回读/文档用）。 */
export const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
/** `HH:mm` 两位严格形态（`3:00` 这种单数字小时也拒——机器面统一两位，歧义零容忍）。 */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** 配置面默认值（票面 AC2 括号内默认值的唯一事实源；spec 逐字段钉，改默认必红）。 */
export const DEFAULTS = Object.freeze({
  enabled: false,
  frequency: Object.freeze({ kind: 'weekly', weekday: 0, time: '03:00' }),
  retentionDays: 30,
  cap: null,
})

/** 事件上限：events 只作最近流水（超出丢最旧）——运行记录面是回读面不是审计账本，
 *  无界增长正是宿主 1096 形态的反面教材。 */
const MAX_EVENTS = 50
/** 失败原因截断（回读面不是日志面；全文进 events 的消费者侧）。 */
const ERROR_MAX_CHARS = 500

/**
 * 校验并规范化一 raw 配置（文件内容 / 将来 UI 提交体）。
 * @returns `{ ok: true, config }`（config = 补齐缺省后的完整规范化对象，含 version）
 * 或 `{ ok: false, problems: string[] }`（每条点名字段与原因，不静默）。
 */
export function normalizeConfig(raw) {
  const problems = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problems: [`配置必须是 JSON 对象，收到 ${raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw}。`] }
  }
  const KNOWN = ['version', 'enabled', 'frequency', 'retentionDays', 'cap']
  for (const key of Object.keys(raw)) {
    if (!KNOWN.includes(key)) problems.push(`未知配置键 '${key}'（已知键：${KNOWN.join(', ')}）——错拼的键会被拒绝而不是忽略，防止改配置静默失效。`)
  }
  if (raw.version !== undefined && raw.version !== 1) {
    problems.push(`version 必须是 1（当前 schema 版本），收到 ${JSON.stringify(raw.version)}。`)
  }
  let enabled
  if (typeof raw.enabled === 'boolean') enabled = raw.enabled
  else if (raw.enabled === undefined) enabled = DEFAULTS.enabled
  else problems.push(`enabled 必须是 boolean，收到 ${JSON.stringify(raw.enabled)}。`)

  let frequency
  if (raw.frequency === undefined) {
    frequency = { ...DEFAULTS.frequency }
  } else if (raw.frequency === null || typeof raw.frequency !== 'object' || Array.isArray(raw.frequency)) {
    problems.push(`frequency 必须是对象，收到 ${JSON.stringify(raw.frequency)}。`)
  } else {
    const f = raw.frequency
    const kind = f.kind
    if (!FREQUENCY_KINDS.includes(kind)) {
      problems.push(`frequency.kind 必须是 ${FREQUENCY_KINDS.join(' / ')} 之一，收到 ${JSON.stringify(kind)}。`)
    } else {
      const shape = { kind }
      const expectKeys = kind === 'weekly' ? ['kind', 'weekday', 'time'] : kind === 'semimonthly' ? ['kind', 'time'] : ['kind', 'day', 'time']
      for (const key of Object.keys(f)) {
        if (!expectKeys.includes(key)) problems.push(`frequency.${kind} 不接受键 '${key}'（该形态已知键：${expectKeys.join(', ')}）。`)
      }
      if (kind === 'weekly') {
        if (Number.isInteger(f.weekday) && f.weekday >= 0 && f.weekday <= 6) shape.weekday = f.weekday
        else if (f.weekday === undefined) shape.weekday = DEFAULTS.frequency.weekday
        else problems.push(`frequency.weekday 必须是 0–6 的整数（0=${WEEKDAY_NAMES[0]}，getDay() 同序），收到 ${JSON.stringify(f.weekday)}。`)
      }
      if (kind === 'monthly') {
        if (Number.isInteger(f.day) && f.day >= 1 && f.day <= 28) shape.day = f.day
        else if (f.day === undefined) shape.day = 1
        else problems.push(`frequency.day 必须是 1–28 的整数（1–28 每月都存在，29–31 在短月不存在——护栏面拒绝），收到 ${JSON.stringify(f.day)}。`)
      }
      if (typeof f.time === 'string' && TIME_RE.test(f.time)) shape.time = f.time
      else if (f.time === undefined) shape.time = DEFAULTS.frequency.time
      else problems.push(`frequency.time 必须是两位 'HH:mm'（00:00–23:59，宿主本地时区），收到 ${JSON.stringify(f.time)}。`)
      frequency = shape
    }
  }

  let retentionDays
  if (raw.retentionDays === undefined) retentionDays = DEFAULTS.retentionDays
  else if (RETENTION_CHOICES.includes(raw.retentionDays)) retentionDays = raw.retentionDays
  else problems.push(`retentionDays 必须是 ${RETENTION_CHOICES.join(' / ')} 之一（保留期档位），收到 ${JSON.stringify(raw.retentionDays)}。`)

  let cap
  if (raw.cap === undefined || raw.cap === null) cap = DEFAULTS.cap
  else if (Number.isInteger(raw.cap) && raw.cap >= 1) cap = raw.cap
  else problems.push(`cap 必须是 null（关）或 ≥1 的整数（会话总数阈值护栏，示例 900），收到 ${JSON.stringify(raw.cap)}。`)

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, config: { version: 1, enabled, frequency, retentionDays, cap } }
}

/** 频率语义（票面 AC2 括号内语义的唯一事实源）：
 *  - weekly：每 {weekday} 的 {time}（默认周日 03:00，星期与时刻均可改）；
 *  - semimonthly：每月 1 日与 15 日的 {time}（固定 1+15，无日选择）；
 *  - monthly：每月 {day}（1–28）的 {time}。全部按宿主本地时区求值（ADR-0001
 *    的 cron 同口径——时区语义沿退役先例，不另立）。 */

// ── 存储路径（机器本地，重启保持）──────────────────────────────────────────────

/** `<DSH_HOME|~/.dsh>/storages/session-archive/`——storages 是宿主数据命名空间
 *  （workspace.json / session_projcache 在场），插件数据落专属子目录，不与宿主
 *  键位互写。 */
export function defaultStorageDir(env = process.env) {
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'session-archive')
}

/** 两个文件的落点（导出给消费面与 spec，不再各处手拼文件名）。 */
export function storagePaths(dir) {
  return { dir, configFile: join(dir, 'config.json'), runlogFile: join(dir, 'runs.json') }
}

// ── 配置读写（AC2 持久化面）────────────────────────────────────────────────────

/**
 * 读配置。缺席（无 config.json）= 合法首装态 → `{ source: 'defaults', config: DEFAULTS }`
 * （source 字段显式声明读数来源——不是静默降级）；文件在但坏（解析失败 / 校验不过）
 * → `{ source: 'file', config: DEFAULTS, problems }`，**problems 非空**——坏配置不吞，
 * 消费面（子票 C 的 tick / 将来的配置面 UI）必须把 problems 响亮带出，配置面永远
 * 以 DEFAULTS（= 默认关）兜底而不是带着半份配置跑。
 */
export async function readConfig(dir) {
  const { configFile } = storagePaths(dir)
  const fallback = normalizeConfig({}).config // 全默认（含 version）——兜底面与首装态同一对象形状
  let text
  try {
    text = await readFile(configFile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { source: 'defaults', config: fallback, problems: [] }
    return { source: 'file', config: fallback, problems: [`config.json 读取失败：${String(error?.message ?? error)}`] }
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { source: 'file', config: fallback, problems: [`config.json 不是合法 JSON：${String(error?.message ?? error).slice(0, 200)}`] }
  }
  const verdict = normalizeConfig(raw)
  if (!verdict.ok) return { source: 'file', config: fallback, problems: verdict.problems }
  return { source: 'file', config: verdict.config, problems: [] }
}

/**
 * 写配置（tmp + rename 原子替换，防半写）。入参先过同一校验器：非法配置**抛错拒写**
 * （坏配置宁可不落盘，也不让下一次 readConfig 读到半份）。写前确保目录存在（惰性
 * 初始化——首写才建目录，挂载零副作用）。
 */
export async function writeConfig(dir, config) {
  const verdict = normalizeConfig(config)
  if (!verdict.ok) {
    throw new Error(`session-archive 拒绝写入非法配置（坏配置不落盘）：${verdict.problems.join('；')}`)
  }
  const { dir: _d, configFile } = storagePaths(dir)
  await mkdir(dir, { recursive: true })
  const tmp = `${configFile}.tmp`
  await writeFile(tmp, `${JSON.stringify(verdict.config, null, 2)}\n`, 'utf8')
  await rename(tmp, configFile)
  return verdict.config
}

// ── 运行记录面（AC3：上次运行/下次运行/归档数/跳过数/失败原因，可回读文件形态）──
// 结构（runs.json；插件自写文件，读面宽松校验、坏则重置回空并带 problems 显式声明）：
//   { version, lastRun: {at, ok, archived, skipped, error?} | null, nextRun: ISO|null,
//     totals: {runs, archived, skipped, failures}, events: [{at, kind, ...}] }
// 计数语义：lastRun = 最近一次计划/手动运行的四元读数；totals = 累计（append-only，
// 停用不回滚——AC4 的「已归档不回滚」在记录面上就是 totals 只增不减）。
// nextRun 由本文件派生（enabled + frequency + now），enable/disable、启用态 frequency
// 变更（复审批注③方案①）与每次运行后刷新——applyConfigChange / recordRun 两处落点。

/** 空运行记录（首装/重置态）。 */
export function emptyRunlog() {
  return {
    version: 1,
    lastRun: null,
    nextRun: null,
    totals: { runs: 0, archived: 0, skipped: 0, failures: 0 },
    events: [],
  }
}

const NUMERIC_TOTALS = ['runs', 'archived', 'skipped', 'failures']

/** 读运行记录。不存在 = 合法首装态（source: 'defaults'）；坏（解析失败/形状错）
 *  = 重置回空 + problems 非空（显式声明，不静默吞）。 */
export async function readRunlog(dir) {
  const { runlogFile } = storagePaths(dir)
  let text
  try {
    text = await readFile(runlogFile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { source: 'defaults', runlog: emptyRunlog(), problems: [] }
    return { source: 'file', runlog: emptyRunlog(), problems: [`runs.json 读取失败：${String(error?.message ?? error)}`] }
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { source: 'file', runlog: emptyRunlog(), problems: [`runs.json 不是合法 JSON：${String(error?.message ?? error).slice(0, 200)}`] }
  }
  const problems = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) problems.push('runs.json 顶层必须是 JSON 对象——已重置为空运行记录。')
  else {
    if (raw.version !== 1) problems.push(`runs.json version 必须是 1，收到 ${JSON.stringify(raw.version)}——已重置为空运行记录。`)
    if (raw.totals === null || typeof raw.totals !== 'object') problems.push('runs.json totals 缺失或非对象——已重置为空运行记录。')
    else for (const key of NUMERIC_TOTALS) {
      if (!Number.isInteger(raw.totals[key]) || raw.totals[key] < 0) problems.push(`runs.json totals.${key} 必须是非负整数，收到 ${JSON.stringify(raw.totals[key])}——已重置为空运行记录。`)
    }
    if (!Array.isArray(raw.events)) problems.push('runs.json events 缺失或非数组——已重置为空运行记录。')
    if (problems.length > 0) return { source: 'file', runlog: emptyRunlog(), problems }
    return {
      source: 'file',
      runlog: {
        version: 1,
        lastRun: raw.lastRun ?? null,
        nextRun: raw.nextRun ?? null,
        totals: { ...raw.totals },
        events: [...raw.events],
      },
      problems: [],
    }
  }
  return { source: 'file', runlog: emptyRunlog(), problems }
}

/** 写运行记录（tmp + rename 原子替换；轻形状自检防把记录面写坏）。 */
export async function writeRunlog(dir, runlog) {
  if (runlog === null || typeof runlog !== 'object' || Array.isArray(runlog)) {
    throw new Error('session-archive 拒绝写入非法运行记录：runlog 必须是对象。')
  }
  for (const key of NUMERIC_TOTALS) {
    if (!Number.isInteger(runlog.totals?.[key]) || runlog.totals[key] < 0) {
      throw new Error(`session-archive 拒绝写入非法运行记录：totals.${key} 必须是非负整数，收到 ${JSON.stringify(runlog.totals?.[key])}。`)
    }
  }
  if (!Array.isArray(runlog.events)) throw new Error('session-archive 拒绝写入非法运行记录：events 必须是数组。')
  const { runlogFile } = storagePaths(dir)
  await mkdir(dir, { recursive: true })
  const tmp = `${runlogFile}.tmp`
  await writeFile(tmp, `${JSON.stringify(runlog, null, 2)}\n`, 'utf8')
  await rename(tmp, runlogFile)
  return runlog
}

/** 追加一条事件（纯函数返回新 runlog；超出 MAX_EVENTS 丢最旧）。 */
export function appendEvent(runlog, event) {
  return {
    ...runlog,
    totals: { ...runlog.totals },
    events: [...runlog.events, { ...event }].slice(-MAX_EVENTS),
  }
}

// ── 下次运行计算（本地时区；AC3「下次运行」的派生源）──────────────────────────

function atTime(base, hhmm) {
  const [hh, mm] = TIME_RE.exec(hhmm).slice(1).map(Number)
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0)
}

function nextDay(base) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)
}

/**
 * 下一次计划运行（严格晚于 `after`；宿主本地时区）。enabled=false → null（AC4：
 * 停用态没有「下次运行」）。频率语义见上方注释块。
 * @param config 规范化配置（normalizeConfig 的产出）
 * @param after 计算基准（缺省 now；spec 注入固定时刻断言边界）
 */
export function computeNextRun(config, after = new Date()) {
  if (!config.enabled) return null
  const { kind } = config.frequency
  if (kind === 'weekly') {
    const { weekday, time } = config.frequency
    const [hh, mm] = TIME_RE.exec(time).slice(1).map(Number)
    // 先推进到目标 weekday（getDay() 0=周日），再判时刻：目标日的时刻若已过则 +7 天。
    // 用日期分量构造而非毫秒加法——毫秒步进在 DST 切换日会偏移一小时。
    const delta = (weekday - after.getDay() + 7) % 7
    let candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate() + delta, hh, mm, 0, 0)
    if (candidate.getTime() <= after.getTime()) {
      candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate() + delta + 7, hh, mm, 0, 0)
    }
    return candidate
  }
  if (kind === 'semimonthly') {
    const { time } = config.frequency
    // 固定 1+15：当月 1 日 → 当月 15 日 → 下月 1 日，取第一个严格晚于 after 的。
    const monthStart = new Date(after.getFullYear(), after.getMonth(), 1)
    const candidates = [
      atTime(monthStart, time),
      atTime(new Date(after.getFullYear(), after.getMonth(), 15), time),
      atTime(new Date(after.getFullYear(), after.getMonth() + 1, 1), time),
    ]
    return candidates.find((c) => c.getTime() > after.getTime()) ?? null
  }
  // monthly（day 1–28，校验器已保证下月必然存在该日）
  const { day, time } = config.frequency
  const candidate = atTime(new Date(after.getFullYear(), after.getMonth(), day), time)
  if (candidate.getTime() > after.getTime()) return candidate
  return atTime(new Date(after.getFullYear(), after.getMonth() + 1, day), time)
}

// ── 调度 gate 与开关切换（AC4：开关取消 → 立即停止后续计划运行，已归档不回滚）──

/**
 * 调度 gate（**config 是唯一权威**）：enabled=false → `active: false`——不论 runs.json
 * 里残留什么 nextRun，任何触发点（子票 C 的 timer tick / 手动运行入口）消费本 gate
 * 都立即停：这就是 AC4「立即停止后续计划运行」的判定面，不等待残留 nextRun 到点。
 * enabled=true → `active: true` + 派生 nextRun（Date）。
 */
export function effectiveSchedule(config, after = new Date()) {
  if (!config.enabled) return { active: false, stopReason: 'disabled', nextRun: null }
  return { active: true, nextRun: computeNextRun(config, after) }
}

/**
 * 开关切换（纯函数返回新 runlog；写盘由调用方做）：
 *   - enabled 未变且 frequency 未变 → 原样返回（引用相等，调用方可据此跳过写盘）；
 *   - enabled 未变而 frequency 变更 → 仅重算 nextRun 返回**新对象**（零事件、totals 与
 *     lastRun 不动——引用不等，调用方**必须写盘**，跳过写盘会丢刷新后的 nextRun）；
 *   - 翻到关 → nextRun 置 null + `disabled` 事件（「已停」从回读面可见）；totals 与
 *     lastRun 一字不动（**已归档不回滚**——记录面 append-only，AC4 后半句的机械面）；
 *   - 翻到开 → `enabled` 事件（带当时派生的 nextRun）+ nextRun 写入。
 */
export function applyConfigChange(prevConfig, nextConfig, runlog, now = new Date()) {
  const sameEnabled = prevConfig.enabled === nextConfig.enabled
  const frequencyChanged = JSON.stringify(prevConfig.frequency) !== JSON.stringify(nextConfig.frequency)
  if (!nextConfig.enabled) {
    // 停用态:开着→关才清算+事件;一直关着(即便 frequency 改了)原样返回——停用态没有
    // 「下次运行」可变,造事件是噪音。
    if (sameEnabled) return runlog
    return appendEvent({ ...runlog, nextRun: null }, { at: now.toISOString(), kind: 'disabled' })
  }
  const nextRun = computeNextRun(nextConfig, now)?.toISOString() ?? null
  if (sameEnabled) {
    // 启用态下 frequency(星期/时刻/形态)变更:重算 nextRun,回读面与当前配置一致
    // (复审③方案①,2026-11-15);totals/lastRun 不动、不造事件噪音。frequency 未变
    // 才是真正的 no-op(引用相等,调用方可据此跳过写盘)。
    if (!frequencyChanged) return runlog
    return { ...runlog, nextRun }
  }
  return appendEvent({ ...runlog, nextRun }, { at: now.toISOString(), kind: 'enabled', nextRun })
}

/**
 * 记一次运行（子票 B/C 的落账入口）：lastRun 四元读数 + totals 累计 + nextRun 刷新。
 * `outcome = { ok, archived, skipped, error? }`——archived/skipped 是非负整数计数，
 * 失败时 error 为失败原因字符串（截断到 ${ERROR_MAX_CHARS} 字符）。纯函数，写盘由
 * 调用方做。outcome 缺数字/负数 → 抛错（内部 API 契约，响亮不静默兜）。
 */
export function recordRun(runlog, config, outcome, now = new Date()) {
  const archived = outcome?.archived
  const skipped = outcome?.skipped
  if (!Number.isInteger(archived) || archived < 0) throw new Error(`recordRun：archived 必须是非负整数，收到 ${JSON.stringify(archived)}。`)
  if (!Number.isInteger(skipped) || skipped < 0) throw new Error(`recordRun：skipped 必须是非负整数，收到 ${JSON.stringify(skipped)}。`)
  const ok = outcome.ok === true
  const lastRun = {
    at: now.toISOString(),
    ok,
    archived,
    skipped,
    ...(ok ? {} : { error: String(outcome.error ?? '未提供失败原因').slice(0, ERROR_MAX_CHARS) }),
  }
  const totals = {
    runs: runlog.totals.runs + 1,
    archived: runlog.totals.archived + archived,
    skipped: runlog.totals.skipped + skipped,
    failures: runlog.totals.failures + (ok ? 0 : 1),
  }
  const nextRun = computeNextRun(config, now)?.toISOString() ?? null
  return { ...runlog, lastRun, totals, nextRun }
}

// ── cordis 插件注册面（AC1 骨架）───────────────────────────────────────────────
// v1 骨架 = 只注册，无运行时副作用（不建目录、不写文件、不注册服务/工具）：配置与
// 运行记录的读写、调度 gate 全在本文件的导出纯面（上方），单测双向钉于
// tests/verify-session-archive.mjs（判据核心；tests/session-archive.spec.ts 为 vitest 薄入口，#180 双入口）。子票 C 在 mount 上把 cordis-plugin-timer 接到
// effectiveSchedule gate（启用注册 interval、停用即清）；行 config `storageDir`
// 是部署/测试注入缝（挂具经 DSH_HOME 临时目录隔离，与本缝等价可互换）。

/**
 * @param config 插件行 config；仅认 `storageDir`（绝对路径，部署/测试注入缝），未知键
 *   响亮拒绝（白名单，复审②）。业务配置不在行 config——在 storages/session-archive/
 *   config.json（运行时可改、重启保持；行 config 改动要换代重挂，不是运行时配置面）。
 */
export function apply(ctx, config = {}) {
  // 行 config 白名单(复审②,2026-11-15):未知键点名抛错,与 normalizeConfig 同一哲学
  // ——拼错的键('storage_dir'/'storageDir ')若被静默吞掉,注入缝失效且零读数,
  // 恰是「配置错拼静默失效」的经典形态在部署缝上的复刻。
  const KNOWN_ROW_KEYS = ['storageDir']
  for (const key of Object.keys(config ?? {})) {
    if (!KNOWN_ROW_KEYS.includes(key)) {
      throw new Error(
        `session-archive 行 config 不接受键 '${key}'（已知键：${KNOWN_ROW_KEYS.join(', ')}）——错拼的键会被拒绝而不是忽略，防止注入缝静默失效（与 normalizeConfig 同一哲学）。`,
      )
    }
  }
  const cfg = { storageDir: defaultStorageDir(), ...config }
  if (typeof cfg.storageDir !== 'string' || !isAbsolute(cfg.storageDir)) {
    throw new Error(
      `session-archive 行 config.storageDir 必须是绝对路径（部署/测试注入缝；缺省 <DSH_HOME>/storages/session-archive），收到 ${JSON.stringify(cfg.storageDir)}。`,
    )
  }
  // 无副作用声明（v1）：挂载即 started（loader 的挂载审计锚），任何实际工作都在
  // 消费面（子票 B/C）首次调用读写函数时惰性发生。
  void ctx
}
