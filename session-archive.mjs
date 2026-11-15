/**
 * session-archive — standing-mount 会话归档维护插件（会话归档 v1，#185 拆票）。
 *
 * 载体拍板（#185 分诊定盘评论 6890884333，第 2/3 项）：preset standing-mount 内轻量
 * 维护插件，缓解宿主会话列表膨胀（上游 1096 形态）；v1 的配置/运行载体 = preset 插件
 * 自身面（文件形态），DSH 设置页集成属上游协作、另立不并本链。
 *
 * 本文件承载子票 A（#195）与子票 B（#196）的实现。拆票分工：
 *   - 子票 A（#195，已落地）：插件注册（随 preset 分发）+ 配置面 v1（schema/读写/持久化）+
 *     运行记录面（上次运行/下次运行/归档数/跳过数/失败原因，可回读文件形态）+
 *     调度 gate（启用/停用语义，AC4）——全部为**导出纯函数面**，
 *     单测双向钉在 tests/verify-session-archive.mjs（判据核心 = CHECKS 数组，AC5/AC6；
 *     tests/session-archive.spec.ts 为 vitest 薄入口——#180 双入口形态，复审批注①）。
 *   - 子票 B（#196，已落地，本文件「归档选择与执行」段）：归档选择（per-workspace 分组 +
 *     「无 workspace」虚拟组、各自保底最近 10、保留期、排除面、上限护栏）与执行
 *     （调 registry.archiveSession 不带 stopActivity、活动拒绝跳过、幂等、失败继续）——
 *     零写盘、消费清点源快照（结构契约，真实 registry 适配 = 子票 C 接线 / 子票 D seed）；
 *     单测双向钉在 tests/verify-session-archive-plan.mjs（判据核心 = CHECKS 数组；
 *     tests/session-archive-plan.spec.ts 为 vitest 薄入口，同 #180 双入口形态）。
 *   - 子票 C（#197，已落地，本文件「计划与触发」段）：计划频率与触发面——tick + gate
 *     形态（cordis-plugin-timer 只当 ticker：`ctx.interval` 60s tick，随 fiber 释放；
 *     三频率语义全在子票 A 的 `computeNextRun`/`effectiveSchedule` 纯函数面，载体判定
 *     「tick + gate 可承载任意频率」——不升级上报）+ 补跑（错过不补多批、启动后最多
 *     补跑一次）+ 单实例互斥 + 触发面（立即运行一次 / dry-run 预览）+ 真实 registry
 *     快照合成（sessionQuery + workspaceRegistry 结构投影，buildSnapshotView 纯函数）。
 *     单测双向钉在 tests/verify-session-archive-schedule.mjs（判据核心 = CHECKS 数组；
 *     tests/session-archive-schedule.spec.ts 为 vitest 薄入口，同 #180 双入口形态）。
 *   - 子票 D：seed 验证（1096 复现形态夹具）+ 插件接线测试（mount 形态）。
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
 * 配置面 UI 同进程串行）出现时再升级，此处显式声明而非静默假设。子票 C 在此声明
 * 之上加了进程内单实例互斥（createRunMutex，AC3）——同一 fiber 上 tick 与手动触发
 * 的异步交错窗口共用同一互斥标志，重叠触发的第二方被拒绝并记录。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-archive'

/**
 * Cordis 服务注入声明（cordis Loader 把模块 namespace 当对象插件，vendor/cordis
 * registry.ts 的 `Inject.resolve(plugin.inject)` 直接消费本导出）：本插件挂载时注册
 * timer tick（apply 内 `ctx.interval`），timer 是 mixin 服务（vendor/timer：
 * `ctx.mixin('timer', […])`），**未经 inject 声明直接读 `ctx.interval` 会在 cordis 的
 * ctx proxy 处抛 `cannot get property "interval" without inject`**（reflect.ts get trap
 * ——verify-dual-env 真宿主挂载实测拦下的形态，#197）。声明后 timer 成为必需服务：
 * 宿主缺席 timer 时本插件不激活并响亮（比静默无调度好——调度面缺席必须现形）。
 */
export const inject = ['timer']

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
 * 记一次运行（子票 C 计划触发的落账入口；outcome 由子票 B 的 runArchiveCycle 产出、
 * 逐字段可直喂）：lastRun 四元读数 + totals 累计 + nextRun 刷新。
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

// ── 归档选择与执行（#196 子票 B：AC1 选择算法 / AC2 执行 / AC3 计数汇报）────────
// 消费面契约：本段**零写盘、不 import 上游包**——上游 workspaceRegistry（registry-global
// archivedSessionIds 只影响显示集合、archiveSession 无 stopActivity 时对有活动工作的会话
// 先于写盘抛 WorkspaceActiveSessionError、归档同写清 pin、已归档 id 幂等 no-op——#196 票面
// 机制事实节,上游 packages/workspace 源码核）以「清点源快照 + 归档动作」的**结构契约**注入
// （下方 JSDoc typedef）；真实 registry 适配 = 子票 C 的计划触发接线 / 子票 D 的 seed 形态
// 留档。单测以接口 mock 双向钉于 tests/verify-session-archive-plan.mjs（判据核心 = CHECKS；
// tests/session-archive-plan.spec.ts 为 vitest 薄入口,#180 双入口同款）。

/**
 * 清点源快照（子票 C 接线 / 子票 D seed 从宿主面合成）。字段语义对着上游 registry：
 * `lastActivityAt` = 排序与年龄判定用的时点毫秒数（adapter 决定取 header createdAt 还是
 * 其它时点——本段只消费有限数值）；`active`/`live`/`subagent` = 排除面标记（上游活动家族
 * turn/job/schedule/subagent 与 live 索引的布尔投影）；pinned/archived 既接受全局集合
 * （`pinnedSessionIds`/`archivedSessionIds`，照上游 registry-global 形态）也接受逐会话
 * 布尔标记，两处并集判定。archivedSessionIds 里的会话已从上游分组面隐藏（"sessions hidden
 * from every grouping surface"）——快照里出现属防御形态：不入可见池、记 skipped('archived')。
 * @typedef {object} ArchiveSnapshotView
 * @property {Array<{sessionId: string, workspaceId?: string|null, lastActivityAt: number,
 *   active?: boolean, live?: boolean, subagent?: boolean, pinned?: boolean, archived?: boolean}>} sessions
 * @property {readonly string[]} [pinnedSessionIds]
 * @property {readonly string[]} [archivedSessionIds]
 */

/**
 * 每组（workspace 与「无 workspace」虚拟组各自）保底保留的最近会话数——#185 归档选择
 * 第 1 条「每个 workspace 至少保留最近 10 个会话，无论年龄」；分诊定盘（#185 评论）：
 * 按 workspace 分组 + 「无 workspace」虚拟组**各自**保底，不按全局只留 10。
 */
export const FLOOR_KEEP = 10

/** 跳过原因词表（封闭集合——skipped[].reason 只取这些值，测试逐值钉）：
 *  - `archived`：已在归档集合（幂等面——重复运行已归档跳过，AC2）；
 *  - `pinned`：用户手工置顶（上游归档会同写清 pin——自动任务不覆盖用户置顶，#185 第 3 条）；
 *  - `live`：当前 live 会话；
 *  - `subagent`：subagent 使用中；
 *  - `active`：registry 报告有活动工作（选择期标记或执行期 WorkspaceActiveSessionError）。
 *  排除判定按 pinned → live → subagent → active 序，命中即止（多标记会话取第一序原因——
 *  确定性，测试钉）；archived 在入池前判定，优先于一切。 */
export const SKIP_REASONS = Object.freeze({
  archived: 'archived',
  pinned: 'pinned',
  live: 'live',
  subagent: 'subagent',
  active: 'active',
})

/** 归档原因词表（plan 的 toArchive[].reason 封闭集合）：`retention` = 超保留期（年龄规则）；
 *  `cap` = 上限护栏触发（可见数超上限，从旧到新补选，绝不破保底）。 */
export const ARCHIVE_REASONS = Object.freeze({ retention: 'retention', cap: 'cap' })

const byNewestFirst = (a, b) =>
  b.lastActivityAt - a.lastActivityAt || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)
const byOldestFirst = (a, b) => byNewestFirst(b, a)

/** 「无 workspace」虚拟组判定：workspaceId 缺席 / null / 空串都落虚拟组（分诊定盘第 1 项：
 *  散落会话不排除在缓解外）。非串非 null 的 workspaceId 在快照形状断言处响亮拒绝。 */
const isVirtualWorkspace = (workspaceId) => workspaceId === null || workspaceId === undefined || workspaceId === ''

/** 快照形状断言（响亮，S1 同族：清点面缺席/坏形状不静默当作空会话跑）。 */
function assertSnapshotShape(view) {
  if (view === null || typeof view !== 'object' || Array.isArray(view)) {
    throw new Error(`selectArchivePlan：清点源快照必须是对象，收到 ${view === null ? 'null' : Array.isArray(view) ? 'array' : typeof view}。`)
  }
  if (!Array.isArray(view.sessions)) {
    throw new Error(`selectArchivePlan：清点源快照缺 sessions 数组（清点面缺席——响亮失败，不当作空会话跑），收到 ${typeof view.sessions}。`)
  }
  const seen = new Set()
  for (const [index, session] of view.sessions.entries()) {
    if (session === null || typeof session !== 'object') {
      throw new Error(`selectArchivePlan：sessions[${index}] 必须是对象，收到 ${session === null ? 'null' : typeof session}。`)
    }
    const id = session.sessionId
    if (typeof id !== 'string' || id === '') {
      throw new Error(`selectArchivePlan：sessions[${index}].sessionId 必须是非空字符串，收到 ${JSON.stringify(id)}。`)
    }
    if (seen.has(id)) {
      throw new Error(`selectArchivePlan：sessions[${index}] 的 sessionId '${id}' 重复（同一会话两次入快照会重复计数/重复归档——响亮拒绝）。`)
    }
    seen.add(id)
    if (!Number.isFinite(session.lastActivityAt)) {
      throw new Error(`selectArchivePlan：sessions[${index}]（sessionId '${id}'）的 lastActivityAt 必须是有限数值毫秒时点，收到 ${JSON.stringify(session.lastActivityAt)}。`)
    }
    const workspaceId = session.workspaceId
    if (!isVirtualWorkspace(workspaceId) && typeof workspaceId !== 'string') {
      throw new Error(`selectArchivePlan：sessions[${index}]（sessionId '${id}'）的 workspaceId 必须是字符串或 null/''（虚拟组），收到 ${JSON.stringify(workspaceId)}。`)
    }
  }
}

/** 配置形状断言（B 消费 A 的 normalizeConfig 产出——防御性再断言，非法响亮拒绝不带病跑）。 */
function assertCycleConfig(config) {
  if (config === null || typeof config !== 'object') {
    throw new Error(`selectArchivePlan：config 必须是对象（A 的 normalizeConfig 产出），收到 ${config === null ? 'null' : typeof config}。`)
  }
  if (!Number.isFinite(config.retentionDays) || config.retentionDays <= 0) {
    throw new Error(`selectArchivePlan：config.retentionDays 必须是正数（保留期档位），收到 ${JSON.stringify(config.retentionDays)}。`)
  }
  const cap = config.cap
  if (cap !== null && cap !== undefined && (!Number.isInteger(cap) || cap < 1)) {
    throw new Error(`selectArchivePlan：config.cap 必须是 null（关）或 ≥1 的整数（上限护栏），收到 ${JSON.stringify(cap)}。`)
  }
}

/** 排除面判定（#185 第 3 条 / #196 AC1）。判定序 pinned → live → subagent → active，
 *  命中即止；pinned 照上游 registry-global 形态吃全局集合，也吃逐会话标记（并集）。 */
function exclusionReason(session, pinned) {
  if (pinned.has(session.sessionId) || session.pinned === true) return SKIP_REASONS.pinned
  if (session.live === true) return SKIP_REASONS.live
  if (session.subagent === true) return SKIP_REASONS.subagent
  if (session.active === true) return SKIP_REASONS.active
  return undefined
}

/** 单组计划：保底 → 年龄候选 → 排除面跳过 → 护栏补选（见各步注释）。 */
function planGroup(workspaceId, sessions, { retentionMs, cap, pinned, now }) {
  // 从新到旧（#185 归档选择第 1 条）；同时刻并列按 sessionId 码元序升序（非 localeCompare
  // ——码元序跨环境确定，不随宿主 locale 漂）。执行序（byOldestFirst）= 本比较器的逐对
  // 取反：不另立第二排序语义，「从旧到新」就是「从新到旧」总序的反转——同龄并列在执行序
  // 中呈码元序降序（S8 用例两向都钉）。
  const sorted = [...sessions].sort(byNewestFirst)
  const floorCount = Math.min(FLOOR_KEEP, sorted.length)
  const floorIds = sorted.slice(0, floorCount).map((session) => session.sessionId)
  const floorSet = new Set(floorIds)
  const visibleCount = sorted.length

  const toArchive = []
  const skipped = []
  const excludedIds = new Set()
  let keptYoung = 0

  // 年龄规则（#185 第 2 条）+ 排除面（#185 第 3 条）：**排除面判定先行**——保底外会话
  // 命中排除面即记 skipped（**无论年龄**：超龄排除位是「候选被排除」，年轻排除位也显式
  // 记录而非静默保留——运行记录 totals.skipped 因此含年轻排除位，S4 young-pin 与 E5
  // report.skipped 断言钉此口径）；年轻且未命中排除面的会话保留、不记跳过（keptYoung）；
  // 超龄且未命中排除面的才构成归档候选（「超过」= 严格大于，恰好到点不归档）；保底内
  // 不判排除面（保底无论年龄，排除面对它无意义）。
  for (const session of sorted.slice(floorCount)) {
    const reason = exclusionReason(session, pinned)
    if (reason !== undefined) {
      excludedIds.add(session.sessionId)
      skipped.push({ sessionId: session.sessionId, reason })
      continue
    }
    if (now.getTime() - session.lastActivityAt > retentionMs) {
      toArchive.push({ sessionId: session.sessionId, reason: ARCHIVE_REASONS.retention })
    } else {
      keptYoung++
    }
  }

  // 上限护栏（#185 第 6 条 / #196 AC1「超限从旧到新归档但绝不破保底」）：可见会话数（含
  // 排除面会话——它们可见只是不可归档）超过 cap 时，把「本轮已选之后仍超出 cap」的余量
  // 从旧到新补选。补选**年龄不设限**：年龄规则的候选在此前已全部选尽，若补选也要求超龄，
  // 护栏与年龄规则完全重合、永不生效，票面「归档超出部分」无从谈起——护栏是防复发的第二
  // 触发面。保底与排除面照旧成立：floorSet 不可选、排除面会话不可选（占着可见数选不走，
  // 护栏到不了就把可选的选完，如实呈现而不是静默装平）。
  if (cap !== null && visibleCount > cap) {
    let need = visibleCount - toArchive.length - cap
    if (need > 0) {
      const selected = new Set(toArchive.map((entry) => entry.sessionId))
      for (const session of [...sorted].sort(byOldestFirst)) {
        if (need <= 0) break
        const id = session.sessionId
        if (floorSet.has(id) || selected.has(id) || excludedIds.has(id)) continue
        selected.add(id)
        toArchive.push({ sessionId: id, reason: ARCHIVE_REASONS.cap })
        need--
        keptYoung-- // 补选池 = 未超保留期的非排除候选（超龄者已在年龄步选尽），逐个从保留位转出
      }
    }
  }

  // 执行序从旧到新（护栏语义「从旧到新归档」；retention 选出者同序无碍——统一按时间升序；
  // 同龄并列呈码元序降序——byOldestFirst 是「从新到旧」比较器的逐对取反，见函数头注释）。
  const byId = new Map(sorted.map((session) => [session.sessionId, session]))
  toArchive.sort((a, b) => byOldestFirst(byId.get(a.sessionId), byId.get(b.sessionId)))

  return { workspaceId, visibleCount, floorCount, floorIds, toArchive, skipped, keptYoung }
}

/**
 * 归档选择（#196 AC1，纯函数零副作用零写盘——单独调用即 dry-run 预览形态，#185 定盘 3
 * 「预览将归档 N 个」）：per-workspace 分组 + 「无 workspace」虚拟组（各自独立）；
 *   1. 各组保底最近 `FLOOR_KEEP` 个（无论年龄，不判排除面）；
 *   2. 只把超保留期（`config.retentionDays`，严格大于）的会话作为归档候选；
 *   3. 排除面判定先行：保底外会话命中 active / pinned / live / subagent 即记 skipped
 *      原因（**无论年龄**——skipped 含年轻排除位，运行记录 totals.skipped 同口径；
 *      年轻且未命中的保留不记跳过，keptYoung）；
 *   4. 上限护栏 `config.cap`（null = 关）：组可见数（未归档，含排除面会话）超 cap 时，
 *      从旧到新补选余量（年龄不设限——理由见 planGroup 注释），绝不破保底。
 * 组序：非空 workspaceId 字典序升序、虚拟组殿后（确定性）；每组 toArchive 从旧到新。
 * @param view  清点源快照（ArchiveSnapshotView，形状非法响亮抛）
 * @param config A 的 normalizeConfig 产出（retentionDays/cap 再断言）
 * @param now   计龄基准（缺省 now；测试注入固定时刻）
 * @returns plan：`{ now, retentionDays, cap, groups: [{ workspaceId(虚拟组=null),
 *   visibleCount, floorCount, floorIds, toArchive: [{sessionId, reason}], skipped:
 *   [{sessionId, reason}], keptYoung }], toArchive: string[], skipped: [{sessionId, reason}] }`
 */
export function selectArchivePlan(view, config, now = new Date()) {
  assertCycleConfig(config)
  assertSnapshotShape(view)
  const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000
  const cap = config.cap ?? null
  const pinned = new Set(view.pinnedSessionIds ?? [])
  const archived = new Set(view.archivedSessionIds ?? [])

  // 分组（#196 AC1）：per-workspace + 「无 workspace」虚拟组；已在归档集合的会话不入池
  // （幂等面：重复运行已归档跳过，AC2），记 skipped('archived')。
  const pool = new Map()
  const preSkipped = []
  for (const session of view.sessions) {
    if (session.archived === true || archived.has(session.sessionId)) {
      preSkipped.push({ sessionId: session.sessionId, reason: SKIP_REASONS.archived })
      continue
    }
    const key = isVirtualWorkspace(session.workspaceId) ? null : session.workspaceId
    let list = pool.get(key)
    if (list === undefined) pool.set(key, (list = []))
    list.push(session)
  }

  const groupKeys = [...pool.keys()].sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    return a < b ? -1 : a > b ? 1 : 0
  })
  const groups = groupKeys.map((key) =>
    planGroup(key, pool.get(key), { retentionMs, cap, pinned, now }),
  )

  return {
    now: now.toISOString(),
    retentionDays: config.retentionDays,
    cap,
    groups,
    toArchive: groups.flatMap((group) => group.toArchive.map((entry) => entry.sessionId)),
    skipped: [...preSkipped, ...groups.flatMap((group) => group.skipped)],
  }
}

/** 上游 `WorkspaceActiveSessionError` 的结构判别：真实类把 `name` 设为该串
 *  （packages/workspace/workspace/src/index.ts，#196 机制事实），接口 mock 同串即同判
 *  ——本仓不 import 上游包（registry 为上游包，preset 测试面以 mock 落）。 */
export function isActiveSessionError(error) {
  return error?.name === 'WorkspaceActiveSessionError'
}

/**
 * 执行归档计划（#196 AC2/AC3）：逐会话调 `registry.archiveSession(sessionId)`——**单参
 * 调用、不带 `stopActivity`**（票面机制事实：无 stopActivity 时上游对有活动工作的会话
 * 先于写盘拒绝，无人值守默认路径绝不停止用户正在做的工作；已归档 id 上游幂等 no-op）。
 * 活动拒绝（isActiveSessionError）记 skipped（原因 active + 上游 message 摘要）；其余
 * 抛错记 failed 后**继续处理其余候选**（AC3）；archiveSession 缺席/非函数响亮抛（归档
 * 动作面缺席不静默跳过）。
 * @param plan selectArchivePlan 的产出
 * @param registry 归档动作面：`{ archiveSession(sessionId: string): Promise<void> }`（结构最小契约）
 * @returns `{ archived: string[], skipped: [{sessionId, reason, detail?}], failed: [{sessionId, error}] }`
 */
export async function executeArchivePlan(plan, registry) {
  if (plan === null || typeof plan !== 'object' || !Array.isArray(plan.groups) || !Array.isArray(plan.toArchive)) {
    throw new Error('executeArchivePlan：plan 必须是 selectArchivePlan 的产出（缺 groups/toArchive 数组）。')
  }
  if (typeof registry?.archiveSession !== 'function') {
    throw new Error(`executeArchivePlan：registry.archiveSession 必须是函数（归档动作面缺席——响亮失败不静默跳过），收到 ${typeof registry?.archiveSession}。`)
  }
  const archived = []
  const skipped = []
  const failed = []
  // 执行序 = 组序（实体组字典序、虚拟组殿后）× 组内从旧到新——与 plan.toArchive（扁平
  // 执行序,dry-run 面）同序。
  for (const entry of plan.groups.flatMap((group) => group.toArchive)) {
    const sessionId = entry?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new Error(`executeArchivePlan：plan.toArchive 条目缺非空 sessionId，收到 ${JSON.stringify(entry)}。`)
    }
    try {
      await registry.archiveSession(sessionId)
      archived.push(sessionId)
    } catch (error) {
      if (isActiveSessionError(error)) {
        skipped.push({ sessionId, reason: SKIP_REASONS.active, detail: String(error?.message ?? '') })
      } else {
        failed.push({ sessionId, error: String(error?.message ?? error) })
      }
    }
  }
  return { archived, skipped, failed }
}

/**
 * 归档一轮（#196 AC1–AC3 组合入口）：选择 → 执行 → 汇总。**零写盘**——落账与运行记录
 * 持久化由消费面（子票 C 计划触发）经 recordRun/writeRunlog 做；本函数的 `outcome` 即
 * recordRun 的 outcome 形状（{ok, archived, skipped, error?}，**计数面**），逐字段可直喂
 * （recordRun 的 failures 计数 = ok 取反，error 为失败汇总串、其内截断 500 字符）。
 * @returns `{ plan, report, outcome }`——report = **明细面**：{ archivedIds: string[],
 *   skipped: [{sessionId, reason, detail?}], failed: [{sessionId, error}] }（skipped =
 *   选择期排除面 + archived 幂等面 + 执行期活动拒绝的并集）；outcome = **计数面**：
 *   { ok: 本轮无归档失败, archived, skipped, error? }。
 */
export async function runArchiveCycle(view, config, registry, now = new Date()) {
  const plan = selectArchivePlan(view, config, now)
  const execution = await executeArchivePlan(plan, registry)
  const skipped = [...plan.skipped.map((entry) => ({ ...entry })), ...execution.skipped]
  const report = {
    archivedIds: [...execution.archived],
    skipped,
    failed: execution.failed.map((entry) => ({ ...entry })),
  }
  const ok = execution.failed.length === 0
  return {
    plan,
    report,
    outcome: {
      ok,
      archived: execution.archived.length,
      skipped: skipped.length,
      ...(ok ? {} : { error: `归档失败 ${execution.failed.length} 个：${execution.failed.map((f) => `'${f.sessionId}'（${f.error}）`).join('；')}` }),
    },
  }
}

// ── 计划与触发（#197 子票 C：AC1 三频率接线 / AC2 补跑 / AC3 单实例互斥 / AC4 触发面）
// 形态总述：**tick + gate**——cordis-plugin-timer（`ctx.interval`，vendor/timer/src/index.ts
// 在场：`interval(callback, delay): () => void`，mixin 到 ctx、随 fiber 释放自动清，
// CONTEXT.md:41 已核环境事实）只当固定间隔 ticker（TICK_MS），**三频率语义全在子票 A
// 的纯函数面**（computeNextRun 排班 / effectiveSchedule gate 判停）——tick 内消费
// runlog.nextRun 存储面判定到点/错过。载体能力判定（票面 AC1 升级上报判据）：interval
// tick + gate 判定可承载任意频率形态，**载体能力足够，不升级上报**；D3/ADR-0001 边界
// 照旧——不装 dsh-schedule（会话级提醒服务，冷会话不投递），不 import 宿主 schedule 服务。
//
// 错过判定（AC2）的语义源 = **runlog.nextRun 存储面**（上次排定的计划时点，runs.json
// 持久锚），不是 effectiveSchedule 的派生面——派生面严格晚于 now、永远不会「已过」，
// 用它判定补跑则补跑永不触发。错过不补多批由 recordRun 刷 nextRun 机械保证：补跑
// （或到点运行）落账后 nextRun 重算到未来，不管错过几个周期也只跑本轮这一批。
// 「启动后最多补跑一次」由 decideTick 的 catchupDone 决策面置位保证：第一次判到错过
// 即消耗补跑窗口（原因标 catchup），此后错过一律按 scheduled 到点运行——补跑窗口
// 零次或一次，不会因互斥拒绝等原因反复重试补跑。
//
// 触发面（AC4）：立即运行一次（runOnce，手动入口）+ dry-run 预览（dryRun，调 #196
// selectArchivePlan 只算不执行）。gate 消费面照 #195 注释口径「任何触发点（timer tick /
// 手动运行入口）」：runOnce 也判 gate（停用拒绝）；dry-run 是只读审计面不判 gate（停用
// 下允许预览——启用前审计是它的本职），取舍在案。落账（recordRun + writeRunlog）在本
// 段接线内做——#196 runArchiveCycle 零写盘留给消费面的声明在此兑现。

/** tick 周期（毫秒）：60s——三频率语义的最小粒度是分钟（`HH:mm`），60s tick 的触发
 *  延迟上限 ≤1 分钟；到点判定看 nextRun 时点而非 tick 计数，tick 只影响延迟不积累
 *  漂移。导出为常量供判据钉（apply 接线消费同一常量，不另写第二份）。 */
export const TICK_MS = 60_000

/** 触发原因词表（触发面运行与事件记录的 trigger 封闭集合）：`scheduled` = 计划到点；
 *  `catchup` = 错过后的补跑窗口（AC2，本轮启动最多一次）；`manual` = 手动立即运行。 */
export const TRIGGER_KINDS = Object.freeze({ scheduled: 'scheduled', catchup: 'catchup', manual: 'manual' })

/** tick 决策动作词表（decideTick 产出 kind 封闭集合）：
 *  - `none`：不动（停用无残留 / 启用未到点）；
 *  - `clear-next-run`：停用但 runs.json 残留 nextRun——清盘写回 null（停用态回读面一致；
 *    #195 applyConfigChange 只覆盖 UI 面切换，文件面手改 config.json 的残留在此清理）；
 *  - `init-schedule`：启用但无有效排班（首装 / 记录面重置）——排定首班（nextRun 严格
 *    未来），随 tick 写盘；
 *  - `run`：到点或错过——触发一轮归档（trigger 指明 scheduled/catchup）。 */
export const TICK_ACTIONS = Object.freeze({
  none: 'none',
  clearNextRun: 'clear-next-run',
  initSchedule: 'init-schedule',
  run: 'run',
})

/**
 * 错过判定（AC2）：上次排定的计划时点（`runlog.nextRun` 存储面）已到或已过 → true。
 * enabled=false → false（gate 权威，停用没有「错过」）；nextRun 缺席或坏串 → false
 * （从没排过班 / 记录面重置态——排班由 init-schedule 分支重建，不在此判错过）。
 * 到点即算错过（`<=`）：nextRun 是「计划时点」，now 恰好等于它就该跑——#195 weekly
 * 严格语义（到点不排下一轮）的对偶面，两者合起来才是完整的一轮语义。
 */
export function hasMissedRun(config, runlog, now = new Date()) {
  if (!config?.enabled) return false
  const nextRun = runlog?.nextRun
  if (typeof nextRun !== 'string' || nextRun === '') return false
  const scheduledAt = Date.parse(nextRun)
  if (!Number.isFinite(scheduledAt)) return false
  return scheduledAt <= now.getTime()
}

/**
 * tick 决策（纯函数状态机；IO 由接线面执行）。入参 catchupDone = 本轮启动（mount
 * 生命周期）补跑窗口是否已消耗；返回 `{ kind, catchupDone, trigger?, nextRun?, problem? }`
 * ——catchupDone 是**新状态**（调用方用它更新，决策面置位 = 窗口消耗按「判到」计，
 * 不按「执行成功」计，故互斥拒绝后也不会反复重试补跑）。
 * @param config 规范化配置（normalizeConfig 产出；坏配置由 readConfig 兜底成默认关，
 *   gate 判定自然停——坏配置不带半份跑）
 * @param runlog 运行记录（readRunlog 产出；坏文件已重置空 + problems）
 * @param opts `now`（判定基准）与 `catchupDone`（窗口状态）
 */
export function decideTick(config, runlog, { now = new Date(), catchupDone = false } = {}) {
  if (!config?.enabled) {
    const stale = typeof runlog?.nextRun === 'string' && runlog.nextRun !== ''
    return { kind: stale ? TICK_ACTIONS.clearNextRun : TICK_ACTIONS.none, catchupDone }
  }
  const nextRun = runlog?.nextRun
  if (typeof nextRun !== 'string' || nextRun === '' || !Number.isFinite(Date.parse(nextRun))) {
    // 启用但无有效排班（首装 / 记录面重置）：排首班。computeNextRun 在规范化配置启用态
    // 恒有未来时点（weekly/semimonthly/monthly 三形态各自的下一候选必在未来）；null 是
    // 理论不可达的防御形态——不写盘不刷屏（每 tick 重写同一 null 才是真风险），problem
    // 字段响亮带出。
    const scheduled = computeNextRun(config, now)
    if (scheduled === null) {
      return { kind: TICK_ACTIONS.none, catchupDone, problem: '排班计算返回空（规范化配置启用态理论不可达——防御形态不写盘）' }
    }
    return { kind: TICK_ACTIONS.initSchedule, catchupDone, nextRun: scheduled.toISOString() }
  }
  if (!hasMissedRun(config, runlog, now)) return { kind: TICK_ACTIONS.none, catchupDone }
  // 错过：补跑窗口未消耗 → catchup（本轮启动唯一一次补跑）；已消耗 → scheduled 到点运行
  // （不是补跑——落账后 nextRun 刷新回未来，正常运行序）。
  return {
    kind: TICK_ACTIONS.run,
    trigger: catchupDone ? TRIGGER_KINDS.scheduled : TRIGGER_KINDS.catchup,
    catchupDone: true,
  }
}

/**
 * 单实例互斥（AC3）：同一时刻只允许一个归档任务实例。进程内闭包标志——standing mount
 * 单 fiber 串行（#195 并发面声明），tick 与手动触发的**异步交错窗口**（runArchiveCycle
 * 的 await 点）共用同一标志；tryBegin 失败 = 重叠触发的第二方被拒（不执行不落账），
 * 调用方 tryBegin 后必须 finally end（接线面内聚，外部不直接消费 mutex）。
 */
export function createRunMutex() {
  let running = false
  return {
    isRunning: () => running,
    tryBegin: () => {
      if (running) return false
      running = true
      return true
    },
    end: () => {
      running = false
    },
  }
}

/**
 * 快照合成纯函数（真实 adapter 的投影面）：把 `sessionQuery.listSessions()` 的
 * SessionRecord 最小面（`{ header: { id, createdAt, origin? }, live }`——上游
 * packages/session-query/session-query/src/index.ts:169 与 session-format/src/types.ts:16
 * 在案：createdAt 毫秒时点、origin 'subagent' 标记）与 workspace 成员面
 * （registry.list() 的 `{ id, sessionIds }` 投影）合成 #196 的 ArchiveSnapshotView。
 * 投影语义：
 *   - `lastActivityAt` ← `header.createdAt`——**保守取舍**：只有创建时点可用（updatedAt
 *     需逐会话读投影，1096 量级下不可承受）；createdAt 低估年龄 = 少归档——宁可漏归档
 *     不可误归档，取舍在案（#196 契约注释「adapter 决定取 header createdAt 还是其它
 *     时点」的裁决）。
 *   - `subagent` ← `header.origin === 'subagent'`；`live` ← `record.live`（live store
 *     在场即 live 会话）。
 *   - `active` 选择期投影 **v1 缺席**（显式降级声明，S3）：上游活动家族（turn/job/
 *     schedule/subagent waterfall）无低成本批量投影面——活动会话由执行期兜底：上游
 *     `archiveSession` 无 stopActivity 时先于写盘抛 WorkspaceActiveSessionError，#196
 *     executeArchivePlan 记 skipped(active) 继续（E2 已钉）。选择期少排除 = 预览计数
 *     可能偏高，不产生破坏性后果。
 *   - `workspaceId` ← 成员面匹配；不在任何 workspace 成员面的会话落「无 workspace」
 *     虚拟组（null，散落会话不排除在缓解外，#185 定盘）；同一会话重复出现在多个
 *     workspace 成员面 = 上游形状异常，响亮抛（跨组重复归档不可静默容忍）。
 *   - `archivedSessionIds` 里的会话**不入 sessions**（adapter 层滤除）——归档是显示层
 *     操作，sessionQuery 仍会列举已归档会话，不滤则每轮 totals.skipped 全量增长误导；
 *     #196 选择算法的 archived 幂等面保留作防御形态（快照仍含已归档会话时正确跳过）。
 *   - `pinnedSessionIds` 全局集合原样透传（#196 双形态并集判定消费）。
 * 形状非法（records 非数组 / 条目缺 header / createdAt 非法 / 成员面条目坏）响亮抛
 * 点名——快照是清点面，缺席/坏形状不静默当作空会话跑（S1）。
 * @returns ArchiveSnapshotView（#196 selectArchivePlan 直喂形态）
 */
export function buildSnapshotView({ records, memberships, pinnedSessionIds = [], archivedSessionIds = [] }) {
  if (!Array.isArray(records)) {
    throw new Error(`buildSnapshotView：records 必须是数组（sessionQuery.listSessions() 投影），收到 ${Array.isArray(records) ? 'array' : typeof records}。`)
  }
  if (!Array.isArray(memberships)) {
    throw new Error(`buildSnapshotView：memberships 必须是数组（registry.list() 成员投影），收到 ${Array.isArray(memberships) ? 'array' : typeof memberships}。`)
  }
  const memberOf = new Map()
  for (const [index, membership] of memberships.entries()) {
    if (membership === null || typeof membership !== 'object' || typeof membership.workspaceId !== 'string' || membership.workspaceId === '' || !Array.isArray(membership.sessionIds)) {
      throw new Error(`buildSnapshotView：memberships[${index}] 必须是 { workspaceId: 非空字符串, sessionIds: 数组 }（registry.list() 成员投影），收到 ${JSON.stringify(membership)}。`)
    }
    for (const sessionId of membership.sessionIds) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error(`buildSnapshotView：memberships[${index}]（workspace '${membership.workspaceId}'）的 sessionIds 条目必须是非空字符串，收到 ${JSON.stringify(sessionId)}。`)
      }
      if (memberOf.has(sessionId)) {
        throw new Error(`buildSnapshotView：sessionId '${sessionId}' 同时出现在两个 workspace 成员面（'${memberOf.get(sessionId)}' 与 '${membership.workspaceId}'）——上游形状异常（成员面应唯一），跨组重复归档不可静默容忍。`)
      }
      memberOf.set(sessionId, membership.workspaceId)
    }
  }
  const archived = new Set()
  for (const [index, id] of (archivedSessionIds ?? []).entries()) {
    if (typeof id !== 'string' || id === '') {
      throw new Error(`buildSnapshotView：archivedSessionIds[${index}] 必须是非空字符串，收到 ${JSON.stringify(id)}。`)
    }
    archived.add(id)
  }
  const pinned = new Set()
  for (const [index, id] of (pinnedSessionIds ?? []).entries()) {
    if (typeof id !== 'string' || id === '') {
      throw new Error(`buildSnapshotView：pinnedSessionIds[${index}] 必须是非空字符串，收到 ${JSON.stringify(id)}。`)
    }
    pinned.add(id)
  }
  const sessions = []
  for (const [index, record] of records.entries()) {
    if (record === null || typeof record !== 'object' || record.header === null || typeof record.header !== 'object') {
      throw new Error(`buildSnapshotView：records[${index}] 必须是 { header: { id, createdAt, ... }, live }（SessionRecord 投影），收到 ${JSON.stringify(record)}。`)
    }
    const { header } = record
    const sessionId = header.id
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new Error(`buildSnapshotView：records[${index}].header.id 必须是非空字符串，收到 ${JSON.stringify(sessionId)}。`)
    }
    if (archived.has(sessionId)) continue // 归档显示层仍列举——adapter 层滤除（理由见函数头注释）
    if (!Number.isFinite(header.createdAt) || header.createdAt < 0) {
      throw new Error(`buildSnapshotView：records[${index}]（sessionId '${sessionId}'）的 header.createdAt 必须是非负毫秒时点（SessionFormatHeader 校验面同款），收到 ${JSON.stringify(header.createdAt)}。`)
    }
    sessions.push({
      sessionId,
      workspaceId: memberOf.get(sessionId) ?? null,
      lastActivityAt: header.createdAt,
      live: record.live === true,
      subagent: header.origin === 'subagent',
    })
  }
  return { sessions, pinnedSessionIds: [...pinned], archivedSessionIds: [...archived] }
}

/**
 * 真实 ctx 快照合成（接线面）：从宿主 ctx 取 `workspaceRegistry`（上游 Service，super(ctx,
 * 'workspaceRegistry')，本仓 handoff-tool.mjs:615 同款先例——ctx.get 缺席返回 undefined）
 * 与 `sessionQuery`（上游 SessionQueryEngine，listSessions(signal?) 全量 live-preferred
 * corpus），合成 ArchiveSnapshotView。服务缺席**或形状不完整****响亮抛**——触发面与
 * handoff-tool 的机会性 skip（undefined → 零字段不告警）不同：归档触发面拿着空清单或
 * 缺面清单跑 = 一次假运行，响亮失败让 gate/事件面现形，不静默跑空（复审轮①，2026-11-15：
 * registry.list 缺席静默置空 = 全部会话落虚拟组、per-workspace 保底语义静默丢失；
 * pinnedSessionIds/archivedSessionIds 缺席静默清空排除面 = pinned 会话被选中归档且上游
 * 归档同写清 pin = 用户置顶被静默清除——与同函数 sessionQuery 的响亮契约对称化）。
 * @param ctx cordis ctx（apply 挂载面传入；测试给 provide 缝的 mock ctx）
 */
export async function synthesizeSnapshot(ctx) {
  const registry = ctx?.get?.('workspaceRegistry')
  const sessionQuery = ctx?.get?.('sessionQuery')
  if (registry === undefined) {
    throw new Error('synthesizeSnapshot：workspaceRegistry 服务缺席（ctx.get 返回 undefined）——归档动作面与成员面不可用，响亮失败不静默跑空。')
  }
  if (typeof registry.list !== 'function') {
    throw new Error('synthesizeSnapshot：workspaceRegistry 缺 list()（成员面不可用——静默置空会让全部会话落「无 workspace」虚拟组、per-workspace 保底语义静默丢失），响亮失败不静默跑空。')
  }
  if (registry.pinnedSessionIds === undefined || registry.archivedSessionIds === undefined) {
    throw new Error(`synthesizeSnapshot：workspaceRegistry 缺 pinnedSessionIds/archivedSessionIds 全局集合（排除面不可用——静默清空会让 pinned 会话被选中归档，而上游归档同写清 pin = 用户置顶被静默清除），收到 pinned=${JSON.stringify(registry.pinnedSessionIds)} archived=${JSON.stringify(registry.archivedSessionIds)}，响亮失败不静默跑空。`)
  }
  if (sessionQuery === undefined || typeof sessionQuery.listSessions !== 'function') {
    throw new Error('synthesizeSnapshot：sessionQuery 服务缺席或无 listSessions（ctx.get 返回 undefined）——清点面不可用，响亮失败不静默跑空。')
  }
  const records = await sessionQuery.listSessions()
  const memberships = registry.list().map((workspace) => {
    if (typeof workspace?.id !== 'string' || workspace.id === '') {
      throw new Error(`synthesizeSnapshot：registry.list() 条目的 id 必须是非空字符串（不 String() 洗值——任意值洗成串会造出假实体组绕过成员面校验），收到 ${JSON.stringify(workspace?.id)}。`)
    }
    if (!Array.isArray(workspace.sessionIds)) {
      throw new Error(`synthesizeSnapshot：registry.list() 条目（workspace '${workspace.id}'）缺 sessionIds 数组（成员面形状不完整——响亮失败不静默当空成员跑），收到 ${JSON.stringify(workspace.sessionIds)}。`)
    }
    return { workspaceId: workspace.id, sessionIds: [...workspace.sessionIds] }
  })
  return buildSnapshotView({
    records,
    memberships,
    pinnedSessionIds: [...registry.pinnedSessionIds],
    archivedSessionIds: [...registry.archivedSessionIds],
  })
}

/**
 * 调度器（触发面组合入口）：闭包持有互斥（AC3）与补跑窗口状态（AC2），runOnce /
 * dryRun / tick 三入口共读同一状态。全部 IO 经 deps 注入——单测以内存夹具 / mock
 * registry 双向钉（#196 同款纪律：不触盘不读真实 home），apply 接线用真实 deps。
 * @param deps
 *   - `storageDir`：配置与运行记录读写目录（#195 读写面消费）；
 *   - `snapshot`：`async () => ArchiveSnapshotView`——真实 = synthesizeSnapshot(ctx)，
 *     测试 = 内存夹具；
 *   - `archiveSession`：`async (sessionId) => void`——真实 = registry.archiveSession 绑定
 *     （单参形态，#196 E1），测试 = mock 计数；
 *   - `now`（可选）：时钟注入缝（缺省 () => new Date()；判定/落账用同一时点快照）；
 *   - `onEvent`（可选）：`(event) => void` 事件侧出口（真实 = ctx.logger；测试收集断言；
 *     出口本身抛错不回传进触发面——logger 故障不阻断归档）。
 * @returns `{ tick, runOnce, dryRun }`：
 *   - `runOnce(trigger)`：立即运行一轮（AC4）。gate 判定（停用拒绝——#195「任何触发点
 *     消费本 gate」含手动入口）→ 互斥 tryBegin（占用拒绝）→ 合成快照 → runArchiveCycle
 *     （#196：选择+执行）→ readRunlog → recordRun → writeRunlog（落账）。返回
 *     `{ started: true, trigger, outcome, report }` 或 `{ started: false, reason,
 *     problems? }`（reason ∈ disabled / busy / config-invalid）。
 *   - `dryRun()`：dry-run 预览（AC4）——readConfig → 合成快照 → selectArchivePlan 只算
 *     不执行（archiveSession 零调用、runs.json 零写盘）。**不判 gate**（停用下允许
 *     预览——启用前审计是 dry-run 的本职，取舍见段头）。返回 `{ ok: true, count, plan }`
 *     或 `{ ok: false, problems }`。
 *   - `tick()`：计划心跳（AC1/AC2）——readConfig → readRunlog → decideTick → 按 kind
 *     执行（none / 清残留 / 排首班 / runOnce）。**不抛出**：无人值守面（interval 回调）
 *     异常一律记 error 事件走 onEvent 出口，不向上炸（cordis fiber 上抛行为不确定，
 *     防御性内聚）；手动入口 runOnce/dryRun 照常抛（调用方在场，响亮优先）。
 */
export function createScheduler({ storageDir, snapshot, archiveSession, now = () => new Date(), onEvent = null }) {
  if (typeof storageDir !== 'string' || storageDir === '') {
    throw new Error('createScheduler：storageDir 必须是非空字符串（配置与运行记录读写目录），收到 ' + JSON.stringify(storageDir) + '。')
  }
  if (typeof snapshot !== 'function') {
    throw new Error('createScheduler：snapshot 必须是函数（async () => ArchiveSnapshotView），收到 ' + typeof snapshot + '。')
  }
  if (typeof archiveSession !== 'function') {
    throw new Error('createScheduler：archiveSession 必须是函数（async (sessionId) => void），收到 ' + typeof archiveSession + '。')
  }
  const mutex = createRunMutex()
  let catchupDone = false // 本轮启动补跑窗口（AC2）：decideTick 决策面置位，最多消耗一次

  const emit = (event) => {
    if (typeof onEvent !== 'function') return
    try {
      onEvent(event)
    } catch {
      // 事件出口故障不阻断归档（logger 挂了不能连带归档挂）
    }
  }

  /** 读配置；坏配置（problems 非空）返回 null 并带 event——默认关兜底由 gate 自然判停。 */
  async function readConfigOrEmit() {
    const { config, problems } = await readConfig(storageDir)
    if (problems.length > 0) {
      emit({ at: now().toISOString(), kind: 'error', detail: `config.json 校验问题（默认关兜底，不带半份配置跑）：${problems.join('；')}` })
      return { config, problems }
    }
    return { config, problems }
  }

  /**
   * 运行一轮并落账（gate 与互斥判定后调用；trigger ∈ TRIGGER_KINDS）。
   * 落账失败照常抛（手动入口响亮；tick 内被捕获记 error）。
   */
  async function runCycle(trigger, config, at) {
    const view = await snapshot()
    const { report, outcome } = await runArchiveCycle(view, config, { archiveSession }, at)
    const { runlog, problems } = await readRunlog(storageDir)
    if (problems.length > 0) {
      emit({ at: at.toISOString(), kind: 'error', detail: `runs.json 读取问题（已重置空继续落账）：${problems.join('；')}` })
    }
    let next = recordRun(runlog, config, outcome, at)
    next = appendEvent(next, {
      at: at.toISOString(),
      kind: 'run',
      trigger,
      archived: outcome.archived,
      skipped: outcome.skipped,
      ...(outcome.ok ? {} : { error: outcome.error }),
    })
    await writeRunlog(storageDir, next)
    return { started: true, trigger, outcome, report }
  }

  return {
    /**
     * 立即运行一轮（AC4 手动入口）。gate：停用拒绝（#195 口径——手动入口也是触发点）。
     */
    async runOnce(trigger = TRIGGER_KINDS.manual) {
      if (!TRIGGER_KINDS[trigger]) {
        throw new Error(`runOnce：trigger 必须是 ${Object.values(TRIGGER_KINDS).join(' / ')} 之一，收到 ${JSON.stringify(trigger)}。`)
      }
      const at = now()
      const { config, problems } = await readConfigOrEmit()
      if (problems.length > 0) return { started: false, reason: 'config-invalid', problems }
      if (!config.enabled) {
        emit({ at: at.toISOString(), kind: 'refused', detail: 'gate 判停：enabled=false（手动运行入口同样消费调度 gate）' })
        return { started: false, reason: 'disabled' }
      }
      if (!mutex.tryBegin()) {
        emit({ at: at.toISOString(), kind: 'refused', detail: `单实例互斥：已有归档任务实例在运行（AC3），本次 ${trigger} 触发被拒` })
        return { started: false, reason: 'busy' }
      }
      try {
        return await runCycle(trigger, config, at)
      } finally {
        mutex.end()
      }
    },

    /**
     * dry-run 预览（AC4）：调 #196 selectArchivePlan 计算将归档 N 个，不执行不落账。
     */
    async dryRun() {
      const { config, problems } = await readConfigOrEmit()
      if (problems.length > 0) return { ok: false, problems }
      const view = await snapshot()
      const plan = selectArchivePlan(view, config, now())
      return { ok: true, count: plan.toArchive.length, plan }
    },

    /**
     * 计划心跳（interval 回调消费）：决策 → 执行。不抛出（无人值守面，异常记事件）。
     */
    async tick() {
      try {
        const at = now()
        const { config, problems } = await readConfigOrEmit()
        if (problems.length > 0) return // 默认关兜底：gate 自然判停，本轮不动
        const { runlog, problems: runlogProblems } = await readRunlog(storageDir)
        const decision = decideTick(config, runlog, { now: at, catchupDone })
        if (runlogProblems.length > 0) {
          emit({ at: at.toISOString(), kind: 'error', detail: `runs.json 读取问题（已重置空，排班将重建）：${runlogProblems.join('；')}` })
        }
        if (decision.kind === TICK_ACTIONS.none) return
        if (decision.kind === TICK_ACTIONS.clearNextRun) {
          await writeRunlog(storageDir, { ...runlog, nextRun: null })
          emit({ at: at.toISOString(), kind: 'schedule-clear', detail: '停用态残留 nextRun 已清盘（回读面一致）' })
          return
        }
        if (decision.kind === TICK_ACTIONS.initSchedule) {
          await writeRunlog(storageDir, { ...runlog, nextRun: decision.nextRun })
          emit({ at: at.toISOString(), kind: 'schedule-init', detail: `排定首班 nextRun=${decision.nextRun}` })
          return
        }
        // kind === run：catchupDone 决策面已置位（decideTick 产出），先更新状态再执行——
        // 互斥拒绝也不回滚窗口（补跑上限按「判到」计，见 decideTick 注释）。
        catchupDone = decision.catchupDone
        const result = await this.runOnce(decision.trigger)
        if (!result.started && result.reason === 'busy') {
          emit({ at: at.toISOString(), kind: 'refused', detail: `tick 触发（${decision.trigger}）被单实例互斥拒绝（AC3）——不落账不重试，下一 tick 按新状态重判` })
        }
      } catch (error) {
        emit({ at: new Date().toISOString(), kind: 'error', detail: `tick 异常（已捕获，下一 tick 继续）：${String(error?.message ?? error).slice(0, 500)}` })
      }
    },
  }
}

// ── cordis 插件注册面（AC1 骨架 + #197 子票 C 计划触发接线）────────────────────
// 配置与运行记录的读写、调度 gate、归档选择与执行、计划与触发的导出纯面见上方各段，
// 单测双向钉于 tests/verify-session-archive.mjs（A 段）/ verify-session-archive-plan.mjs
// （B 段）/ verify-session-archive-schedule.mjs（C 段，判据核心 = CHECKS 数组；tests/
// session-archive-*.spec.ts 为 vitest 薄入口，#180 双入口同款）。
// mount 接线：ctx.interval（cordis-plugin-timer mixin，随 fiber 释放自动清——timer 是
// fiber effect，插件停载即清，无需手动 dispose）注册 60s tick；gate 判定在 tick 内
// （effectiveSchedule/decideTick 消费 config——停用立即停，AC4 语义面）。
// 行 config `storageDir`
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
  // 计划触发接线（#197 子票 C）：调度器依赖真实 ctx 面——快照从 workspaceRegistry +
  // sessionQuery 合成（synthesizeSnapshot），归档动作绑 registry.archiveSession（单参，
  // #196 E1 形态）。timer tick（60s）由 cordis-plugin-timer mixin 注册，随 fiber 释放
  // 自动清（vendor/timer/src/index.ts 在场：interval 是 fiber effect）；停用语义在
  // tick 内的 gate/decideTick 判定面（AC4「立即停止后续计划运行」），不靠定时器拆除。
  // 挂载即 started（loader 审计锚）但零写盘副作用不变——首次 tick 才可能惰性读写盘
  // （enabled=false 时 tick 为 none，连目录都不建）。
  const scheduler = createScheduler({
    storageDir: cfg.storageDir,
    snapshot: () => synthesizeSnapshot(ctx),
    archiveSession: (sessionId) => {
      const registry = ctx.get('workspaceRegistry')
      if (registry === undefined) {
        throw new Error('session-archive：workspaceRegistry 服务缺席（ctx.get 返回 undefined）——归档动作面不可用，响亮失败不静默跳过。')
      }
      return registry.archiveSession(sessionId)
    },
    onEvent: (event) => {
      try {
        ctx.logger?.warn(`session-archive: ${event.kind}${event.detail ? ` ${event.detail}` : ''}`)
      } catch {
        // 日志面缺席/故障不阻断触发面
      }
    },
  })
  ctx.interval(() => {
    // tick 自身不抛出（createScheduler 内聚捕获）；void 掉 promise 防 unhandled rejection
    void scheduler.tick()
  }, TICK_MS)
}
