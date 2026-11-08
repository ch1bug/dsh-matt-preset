#!/usr/bin/env node
/**
 * lane-disk-guard.mjs — 泳道批磁盘软守卫（#137 / ADR-0018）。
 *
 * 为什么是「软」守卫：Windows 没有目录级硬配额——worktree pool（DSH `create_worktree`
 * 服务的 checkout pool，每条 lane 一棵隔离工作树）只能靠**量一次 + 响亮报**来兜。
 * 判据（票面第 4 项）：lane 收尾量一次 pool 目录大小；默认阈值 20 GB、按仓覆写；
 * 超阈值 → 该 lane **停手** + GC + digest 一行 `⚠`，**不静默继续**（D47）。
 *
 * 职责边界：本脚本只**量与判**，从不删任何东西——GC（删已收口的 worktree / 让
 * worktree 服务回收 checkout pool）是 Lead 会话的动作（删除属 D21 面，且「只删
 * 自己建的路径」纪律在这里同样适用）。超限退出码 1 就是「停手」信号：lane 收尾
 * 流程读到非零必须停下，先 GC 再重跑本脚本确认，然后才继续。
 *
 * 阈值解析链（先到先得）：`--threshold-gb`（CLI 覆写）→ `lane-gates.yml`
 * （`thresholdGb:` 一键；`--config` 指路径，缺省 `<cwd>/lane-gates.yml`）→ 默认 20。
 * 配置文件缺席 = 回落默认（正常形态——大多数仓不覆写）；配置文件**在场但坏值** =
 * 响亮 exit 2（写了配置就要写对，静默回落是 S3 形态）。
 *
 * 测量口径：递归累计文件字节；**符号链接 / junction 不跟随不累计**（与 du 默认一致
 * ——link-runtime-deps.mjs 建的 node_modules 链接指向运行时源，跟过去会把同一份
 * 依赖在每个 lane 里重复计一遍）。
 *
 * 用法：
 *   node scripts/lane-disk-guard.mjs --pool <dir>            # 阈值 = 覆写链解析
 *   node scripts/lane-disk-guard.mjs --pool <dir> --threshold-gb 5
 *   node scripts/lane-disk-guard.mjs --pool <dir> --config <path>/lane-gates.yml
 *
 * 退出码：0 = 未超阈值（digest 一行 ✓）；1 = 超阈值（digest 一行 ⚠ ——停手 + GC）；
 *         2 = 用法错误 / 输入坏值（--pool 缺席或不存在、阈值非正数等，全响亮）。
 *
 * 纯逻辑（formatBytes / parseThresholdGb / parseLaneGates / evaluatePoolSize）
 * 与 I/O（measureDirSize / 参数解析 / 落地输出）分离：tests/verify-lane-disk-guard.mjs
 * 离线单测前者 + 真目录/真字节实测 CLI 三条链。
 */
import { lstatSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 默认阈值（GB）——票面判据：20 GB，按仓覆写（lane-gates.yml / --threshold-gb）。 */
export const DEFAULT_THRESHOLD_GB = 20

// ── 纯函数 ────────────────────────────────────────────────────────────────────

/** 字节数 → 可读量（B / KiB / MiB / GiB，1024 进制，一位小数；整数不带小数点）。 */
export function formatBytes(n) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = Number(n)
  if (!Number.isFinite(value) || value < 0) throw new Error(`formatBytes: not a non-negative finite number: ${n}`)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  const rounded = unit === 0 ? String(value) : (Math.round(value * 10) / 10).toFixed(1)
  return `${rounded} ${units[unit]}`
}

/** 阈值解析：正有限数，否则响亮（source 只为报错可归因）。返回字节数。 */
export function parseThresholdGb(raw, source) {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error(`lane-disk-guard: threshold must be a positive number, got ${JSON.stringify(raw)} (${source})`)
  }
  return Math.round(n * 1024 * 1024 * 1024)
}

/**
 * lane-gates.yml 的**一键**解析：`thresholdGb: <正数>`。只认这一键（本守卫唯一
 * 可覆写项）；`#` 注释剥到行尾。返回 `{ thresholdGb }` 或 null（文件缺席 / 空文件
 * ——回落默认是正常形态）。在场但坏值（键在、值不是正数）→ throw，调用方落地为
 * exit 2：写了配置就要写对，静默回落是 S3 形态。
 */
export function parseLaneGates(text) {
  if (text === undefined || text === null) return null
  const lines = String(text).split(/\r?\n/)
  let found
  for (const line of lines) {
    const bare = line.replace(/#.*$/, '').trim()
    if (bare === '') continue
    const hit = /^thresholdGb\s*:\s*(.+)$/.exec(bare)
    if (hit !== null) {
      if (found !== undefined) throw new Error('lane-disk-guard: lane-gates.yml declares thresholdGb twice')
      found = hit[1].trim()
      continue
    }
    // 识别得出键名的行才允许出现——别的键（未来的覆写项）先响亮，防止拼错键名静默失效。
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(bare)) {
      throw new Error(`lane-disk-guard: unknown key in lane-gates.yml: ${JSON.stringify(bare)} — recognized: thresholdGb`)
    }
    throw new Error(`lane-disk-guard: unparseable line in lane-gates.yml: ${JSON.stringify(line)}`)
  }
  if (found === undefined) return null
  const n = Number(found)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`lane-disk-guard: lane-gates.yml thresholdGb must be a positive number, got ${JSON.stringify(found)}`)
  }
  return { thresholdGb: n }
}

/**
 * 量与判：`{ over, digestLine }`。digest 行是唯一输出形态（贴批 digest 一行）：
 * ✓ = 未超（含两个可读量）；⚠ = 超限（含两个可读量 + 停手 + GC 指令，D47 不静默）。
 * 等于阈值 = 未超（判据是 `>`，不是 `>=`）。
 */
export function evaluatePoolSize({ poolPath, bytes, thresholdBytes }) {
  const size = formatBytes(bytes)
  const threshold = formatBytes(thresholdBytes)
  if (bytes > thresholdBytes) {
    return {
      over: true,
      digestLine: `⚠ worktree pool ${poolPath} ${size} > threshold ${threshold} (${bytes} bytes / ${thresholdBytes} bytes) — lane 停手：GC worktree pool 后重跑 lane-disk-guard 确认，再继续`,
    }
  }
  return {
    over: false,
    digestLine: `✓ worktree pool ${poolPath} ${size} ≤ threshold ${threshold} (${bytes} bytes / ${thresholdBytes} bytes)`,
  }
}

// ── I/O ───────────────────────────────────────────────────────────────────────

/** 递归累计目录字节；符号链接 / junction 不跟随不累计（du 口径，见头注释）。 */
export function measureDirSize(dir) {
  let total = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`lane-disk-guard: cannot read pool directory ${dir}: ${error?.message ?? error}`)
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      total += measureDirSize(full)
      continue
    }
    try {
      total += statSync(full).size
    } catch {
      // 竞态删除（量的时候文件被收走）：跳过该文件，量得到的部分仍如实累计。
    }
  }
  return total
}

function usage() {
  console.error('usage: node scripts/lane-disk-guard.mjs --pool <dir> [--threshold-gb <n>] [--config <lane-gates.yml>]')
}

async function main(argv) {
  let pool
  let thresholdGbArg
  let configPath
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--pool') pool = argv[++i]
    else if (arg === '--threshold-gb') thresholdGbArg = argv[++i]
    else if (arg === '--config') configPath = argv[++i]
    else {
      console.error(`lane-disk-guard: unknown argument ${JSON.stringify(arg)}`)
      usage()
      return 2
    }
  }
  if (pool === undefined || pool === '') {
    console.error('lane-disk-guard: --pool is required — name the worktree pool directory to measure (loud, never a guessed default)')
    usage()
    return 2
  }
  const { existsSync, readFileSync } = await import('node:fs')
  const poolPath = resolve(pool)
  if (!existsSync(poolPath)) {
    console.error(`lane-disk-guard: pool directory does not exist: ${poolPath}`)
    return 2
  }

  // 阈值解析链：CLI > config > 默认。config 在场但坏值 = 响亮 exit 2（S3）。
  let thresholdBytes
  let thresholdSource
  if (thresholdGbArg !== undefined) {
    try {
      thresholdBytes = parseThresholdGb(thresholdGbArg, '--threshold-gb')
    } catch (error) {
      console.error(String(error?.message ?? error))
      return 2
    }
    thresholdSource = '--threshold-gb'
  } else {
    const config = configPath !== undefined ? resolve(configPath) : join(process.cwd(), 'lane-gates.yml')
    let gatesText = null
    if (existsSync(config)) {
      gatesText = readFileSync(config, 'utf8')
    } else if (configPath !== undefined) {
      // 显式点名了配置文件却没有它——响亮，不静默当「没覆写」。
      console.error(`lane-disk-guard: --config file does not exist: ${config}`)
      return 2
    }
    let gates
    try {
      gates = parseLaneGates(gatesText)
    } catch (error) {
      console.error(String(error?.message ?? error))
      return 2
    }
    if (gates !== null) {
      thresholdBytes = parseThresholdGb(gates.thresholdGb, 'lane-gates.yml')
      thresholdSource = 'lane-gates.yml'
    } else {
      thresholdBytes = parseThresholdGb(DEFAULT_THRESHOLD_GB, 'default')
      thresholdSource = 'default 20 GB'
      // 缺省 config 从 cwd 解析（文档口径是「仓根」）——落到 default 时点名一次，
      // 让「仓里写了覆写但 cwd 不在仓根导致没读到」可事后归因（stderr 提示，不改退出码：
      // 仓根本来就没写覆写也是正常形态，不构成错误）。
      console.error(`lane-disk-guard: note — cwd=${process.cwd()} has no lane-gates.yml; repo override NOT applied (run from the repo root or pass --config explicitly)`)
    }
  }

  let bytes
  try {
    bytes = measureDirSize(poolPath)
  } catch (error) {
    console.error(String(error?.message ?? error))
    return 2
  }
  const { over, digestLine } = evaluatePoolSize({ poolPath, bytes, thresholdBytes })
  console.log(digestLine)
  console.error(`lane-disk-guard: threshold source = ${thresholdSource}`)
  return over ? 1 : 0
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(await main(process.argv.slice(2)))
