#!/usr/bin/env node
/**
 * lane-audit.mjs — 泳道批排批审计（#136）：消费 frontier --json + 票面 touch-set 字段，
 * 输出 lane 间**两两相交矩阵**与**串行分组建议**。
 *
 * 语义边界（ADR-0018 决策 3，拍板 Q2）：touch-set 相交是「**不并行**」（排批维度，
 * Lead 分配 lane 时的判据），**不是**「不 ready」——`frontier.mjs` 的 ready 三维
 * （open + label + 无 open 阻塞 + 无 assignee）保持不变，本脚本不改它、也不重复它：
 * 它把 frontier 的票集合当输入，再加票面四字段的 touch-set 做写域相交检查。
 *
 * 判据提纯自 `sandcastle/templates/audit-ticket.mts` 的 `--touch-overlap` 一维扫描
 * （AFK 夜批票级载体；无测试——既有缺口，#136 补上）：
 *   pathsOverlap = 精确相等，或一方是另一方的前缀（**路径段**前缀——
 *   `docs/` 与 `docs/agents/x.md` 相交；`docs-a/` 与 `docs/` 不咬，差那根斜杠就不算）；
 *   parseTouchSet = 逗号/顿号/分号/换行/空白分隔，剥列表符号，反斜杠归一、去尾斜杠。
 * 相交分组照抄其 union-find（**传递**的：A～B、B～C ⇒ 三票同组，但组内两两未必直接相交
 * ——「同组」只说明存在相交链，判相交仍看 pairs 的 shared 明细）。
 * 并行合法性判据借 VERA ADR-084（#136 评论已采纳）：touch-set 不相交 + 各自验收线；
 * 本脚本是 **git 路径前缀粗判**，最终排批由 Lead + human 终审。
 *
 * 票面四字段（进 lane 资格，普通批不强制——拍板 Q3；格式见 docs/agents/issue-tracker.md
 * 「泳道批票面」节）：touch-set / 接口契约 / 影响面 / proving。四字段**只在票面「泳道票面」
 * 标题节内解析**（先剥代码围栏再切节——引用样板的票不算声明票面，见 parseLaneFields 头注）。
 * **点名**（--issues）审计的票缺任一字段 → 响亮 exit 1（不进 lane，回炉 needs-triage）
 * ——缺席必须响亮（S1/D47）。
 *
 * 用法：
 *   node scripts/lane-audit.mjs                      # 子进程跑 scripts/frontier.mjs --json
 *                                                    #   + gh 逐票取正文，扫全部带泳道票面的票
 *   node scripts/lane-audit.mjs --issues 136,137     # 点名泳道批候选（缺票面字段 → exit 1）
 *   node scripts/lane-audit.mjs --frontier-json f.json
 *                                                    # 注入等价数据：frontier --json 的原样输出，
 *                                                    #   允许每票带可选 body 字段（离线/预演；
 *                                                    #   给了它就不跑 frontier 子进程、不碰 gh）
 *   node scripts/lane-audit.mjs --json               # 机器可读（排批输入）
 *   --repo owner/name 透传 frontier（默认经 gh 取当前仓库）
 * 退出码：0 = 扫描成功（**有相交也 0**——输出是排批建议不是硬门，决策在 Lead + human 终审）；
 *         1 = 信息不足（frontier/gh 取数失败，或**点名**票缺字段/不在 frontier）；
 *         2 = 用法错误。
 * 前置（默认模式）：PATH 上有 `gh` 且已登录。任何 gh/frontier 失败**响亮退出**——
 * 绝不让「取数挂了」伪装成「没有相交」。
 *
 * 纯逻辑（parseTouchSet / pathsOverlap / parseLaneFields / laneAudit）与 I/O 分离：
 * tests/verify-lane-audit.mjs 离线单测前者（含相交/不相交正反例与四字段解析）。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FRONTIER = join(REPO, 'scripts', 'frontier.mjs')

// ── 纯函数（判据提纯自 sandcastle/templates/audit-ticket.mts --touch-overlap）──────

/** 路径归一：去空白、反斜杠 → 斜杠、去尾斜杠（trim 在前——尾空白会挡住尾斜杠剥离）。 */
export function normalizePath(p) {
  return String(p).trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

/** touch-set 字段值 → 路径/前缀列表（逗号/顿号/分号/**空白**分隔；剥列表符号与反引号）。
 *  判据与 audit-ticket.mts 的 parseTouchSet 同源（其 split 漏了 `\s`——注释声称空白分隔但
 *  实现不含，本脚本修实现而非改声明：假阴性方向 = 「A 票真相交被读成伪路径永不相交」，
 *  brief 三档里最重的假绿）；多了反引号剥离——票面值多写作 `docs/agents/`（行内代码），
 *  不剥就成了带引号的路径、永远不相交。空白即分隔符 ⇒ 含空格的路径不支持（声明的语义）。 */
export function parseTouchSet(raw) {
  if (raw === undefined || raw === null) return []
  const cleaned = String(raw).replace(/`/g, ' ')
  return cleaned
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim().replace(/^[-*•\s]+/, ''))
    .filter(Boolean)
    .map(normalizePath)
}

/** 两个 touch-set 条目是否写域相交：精确相等，或一方是另一方的前缀（目录声明）。
 *  前缀必须带 `/` 边界（路径**段**前缀，不是裸字符串前缀）。 */
export function pathsOverlap(a, b) {
  if (a === b) return true
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/** 两组 touch-set 条目的相交明细：a 中与 b 任一条目相交的条目。 */
export function setsOverlap(a, b) {
  return a.filter((x) => b.some((y) => pathsOverlap(x, y)))
}

/** 字段值清理：剥首尾空白、包裹的反引号与 `**` 加粗。 */
function cleanFieldValue(raw) {
  let v = String(raw ?? '').trim()
  v = v.replace(/^\*\*(.+)\*\*$/, '$1').trim()
  v = v.replace(/^`(.*)`$/, '$1').trim()
  return v
}

/**
 * 票面正文 → 泳道票面四字段。**解析域 = 「泳道票面」标题节内**（与头注及
 * docs/agents/issue-tracker.md「样板票面…按此解析」的已声明契约对齐）：
 *   ① 先剥代码围栏（``` 与 ~~~ 成对内容整体剥除）——引用样板的票不是声明票面；
 *   ② 再找 ATX 标题行 `#{1,6} <泳道票面|泳道批票面>…`（级别与行尾文字容错），
 *      节体 = 该行之后到下一个 ATX 标题（或正文结束）；
 *   ③ 四字段只在节体内扫。正文没有该节 → 四字段全缺（missing 指出）——
 *      票面散文/定义行里出现四字段字样（如 #136 票面自身）不算声明票面。
 * 字段名容错：大小写不敏感、`-` 可省、`**加粗**` 与反引号装饰都接受、中英文别名都认
 * （接口契约/interface、影响面/impact、proving/证明命令）。
 * @param body 票面正文（string | null | undefined）
 * @returns { touchSet, interface, impact, proving, missing }
 *          missing = 缺失/为空的字段名列表（touchSet 是解析结果数组，空数组 = 缺 touch-set）
 */
export function parseLaneFields(body) {
  const text = laneFaceSection(String(body ?? ''))
  const pick = (names) => {
    const re = new RegExp(
      `^[ \\t]*[-*][ \\t]*(?:\\*{0,2})(?:${names})(?:\\*{0,2})[ \\t]*[:：](.*)$`,
      'im',
    )
    const m = re.exec(text)
    return m === null ? '' : cleanFieldValue(m[1])
  }
  const touchSet = parseTouchSet(pick('touch-?set|touchset'))
  const fields = {
    touchSet,
    interface: pick('接口契约|interface'),
    impact: pick('影响面|impact'),
    proving: pick('proving|证明命令'),
  }
  const missing = []
  if (touchSet.length === 0) missing.push('touch-set')
  if (!fields.interface) missing.push('接口契约')
  if (!fields.impact) missing.push('影响面')
  if (!fields.proving) missing.push('proving')
  return { ...fields, missing }
}

/** 泳道票面节提取（见 parseLaneFields 头注的解析域契约）：先剥代码围栏，再切标题节。 */
function laneFaceSection(body) {
  // 围栏剥除（成对整体剥）：引用样板票面的票不算声明票面——围栏里的标题/字段全部无效
  const unfenced = body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
  const m = /^#{1,6}[ \t]*泳道(?:批)?票面.*$/m.exec(unfenced)
  if (m === null) return ''
  const rest = unfenced.slice(m.index + m[0].length)
  const next = /^#{1,6}[ \t]*\S/m.exec(rest)
  return next === null ? rest : rest.slice(0, next.index)
}

/**
 * 纯函数：泳道票数组 → 两两相交矩阵 + pairs 明细 + 串行分组建议。
 * 输入**按票号升序归一**（一处 sort，matrix/pairs/展示三个消费端自动一致）——
 * 点名序/frontier 注入序不保证有序，不归一会让 matrix 上三角判定撞 null。
 * @param tickets [{ number, title?, touchSet: string[] }]
 * @returns { tickets, matrix, pairs, groups, serialGroups, singletons }
 *   matrix   N×N 上三角（i<j 时为 shared 路径数组，其余 null）——「两两相交矩阵」本体
 *   pairs    [{a, b, shared}]（按票号序，shared 非空）
 *   groups   union-find 连通分量（**传递**的，size ≥ 1；组内两两未必直接相交）
 *   serialGroups   size > 1 的组（组内必须串行或合并成一票）
 *   singletons     无任何相交的票（可并行）
 */
export function laneAudit(tickets) {
  // 照提纯源 --touch-overlap 的消费形态：入口对 touchSet **再归一一遍**
  // （`rec.touchSet.map(normalizePath).filter(Boolean)`）——归一责任放在消费点，判据输入不吃生值。
  const ticketsNorm = tickets.map((t) => ({ ...t, touchSet: (t.touchSet ?? []).map(normalizePath).filter(Boolean) }))
  tickets = ticketsNorm.sort((a, b) => a.number - b.number)
  const n = tickets.length
  const matrix = tickets.map((ti) =>
    tickets.map((tj) => {
      if (ti.number >= tj.number) return null
      return setsOverlap(ti.touchSet, tj.touchSet)
    }),
  )
  const pairs = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const shared = matrix[i][j]
      if (shared.length > 0) pairs.push({ a: tickets[i].number, b: tickets[j].number, shared })
    }
  }
  // union-find 分组（照提纯源）：有交集的票进同一组
  const parent = tickets.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const union = (i, j) => {
    parent[find(i)] = find(j)
  }
  for (const p of pairs) {
    const i = tickets.findIndex((t) => t.number === p.a)
    const j = tickets.findIndex((t) => t.number === p.b)
    union(i, j)
  }
  const byRoot = new Map()
  tickets.forEach((_, i) => {
    const r = find(i)
    if (!byRoot.has(r)) byRoot.set(r, [])
    byRoot.get(r).push(i)
  })
  const groups = [...byRoot.values()].map((members) => {
    const memberTickets = members.map((i) => tickets[i])
    // overlapFiles = 组内两两相交路径的并集（传递组里可能不是全连接，逐对算）
    const files = new Set()
    for (let i = 0; i < memberTickets.length; i++) {
      for (let j = i + 1; j < memberTickets.length; j++) {
        setsOverlap(memberTickets[i].touchSet, memberTickets[j].touchSet).forEach((f) => files.add(f))
      }
    }
    return { tickets: memberTickets.map((t) => t.number), overlapFiles: [...files] }
  })
  const serialGroups = groups.filter((g) => g.tickets.length > 1).map((g) => ({ serial: true, ...g }))
  const singletons = groups.filter((g) => g.tickets.length === 1).flatMap((g) => g.tickets)
  return { tickets, matrix, pairs, groups, serialGroups, singletons }
}

// ── I/O 半截 ───────────────────────────────────────────────────────────────────────

function fail(message, code = 1) {
  console.error(`lane-audit: ${message}`)
  process.exit(code)
}

/** 解析 CLI 参数。 */
export function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--issues') args.issues = argv[++i]
    else if (a === '--frontier-json') args.frontierJson = argv[++i]
    else if (a === '--repo') args.repo = argv[++i]
    else if (a === '--json') args.json = true
    else if (a === '--help' || a === '-h') args.help = true
    else fail(`unknown argument: ${a}（--help 看用法）`, 2)
  }
  return args
}

/** gh 取单票正文：失败响亮退出（接口挂了不伪装成「没有票面」）。 */
function ghBody(number) {
  const run = spawnSync('gh', ['issue', 'view', String(number), '--json', 'body'], { encoding: 'utf8' })
  if (run.error !== undefined) fail(`gh 不可用（PATH 上要有已登录的 gh）：${run.error.message}`)
  if (run.status !== 0) fail(`gh issue view ${number} exited ${run.status}: ${(run.stderr ?? '').trim()}`)
  return JSON.parse(run.stdout).body
}

/** 票集合来源（二选一，见头注）：frontier 子进程（gh 在线）或 --frontier-json 注入。 */
function loadFrontierTickets(args) {
  if (args.frontierJson !== undefined) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(args.frontierJson, 'utf8'))
    } catch (e) {
      fail(`--frontier-json ${args.frontierJson} 读不了/不是 JSON：${e.message}`)
    }
    const list = parsed.frontier
    // 形状坏必须响亮（S1）：合法 JSON 但缺 frontier 键/顶层数组 → 静默读作空集合 = 「文件坏了」
    // 被伪装成「没有泳道批要排」的假缺席。JSON.parse 失败已响亮，唯形状校验补在这里。
    if (!Array.isArray(list)) fail(`--frontier-json ${args.frontierJson} 形状不对：缺 frontier 数组（应是 frontier --json 的原样输出）`)
    for (const t of list) {
      if (typeof t.number !== 'number') fail(`--frontier-json 里出现缺 number 的票项：${JSON.stringify(t)}`)
    }
    return list
  }
  const frontierArgs = ['--json']
  if (args.repo !== undefined) frontierArgs.push('--repo', args.repo)
  const run = spawnSync(process.execPath, [FRONTIER, ...frontierArgs], { encoding: 'utf8' })
  if (run.error !== undefined) fail(`frontier 子进程起不来：${run.error.message}`)
  if (run.status !== 0) fail(`scripts/frontier.mjs --json exited ${run.status}: ${(run.stderr ?? '').trim()}`)
  const parsed = JSON.parse(run.stdout)
  return parsed.frontier ?? []
}

const USAGE = [
  'usage: node scripts/lane-audit.mjs [--issues <n,n,…>] [--frontier-json <file>] [--repo <owner/name>] [--json]',
  '  --issues         点名泳道批候选票号（缺票面字段 → exit 1；不在 frontier → exit 1）',
  '  --frontier-json  注入等价数据（frontier --json 的原样输出，允许每票带可选 body）——离线/预演',
  '  --repo           透传 frontier（默认经 gh 取当前仓库）',
  '  --json           机器可读输出（矩阵 + pairs + 串行分组 + missing）',
].join('\n')

/** CLI 主体：取票集合 → 解析四字段 → 纯函数 → 打印。 */
export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(USAGE)
    return
  }
  const wanted = args.issues === undefined
    ? null
    : args.issues.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const n = Number(s)
        if (!Number.isInteger(n) || n <= 0) fail(`--issues 的票号必须是正整数：${s}`, 2)
        return n
      })

  const frontierTickets = loadFrontierTickets(args)
  const byNumber = new Map(frontierTickets.map((t) => [t.number, t]))

  // 点名票必须都在 frontier（gated/closed 票没有开工资格，谈不上 lane）
  if (wanted !== null) {
    const notReady = wanted.filter((n) => !byNumber.has(n))
    if (notReady.length > 0) {
      fail(`点名票不在 frontier（open + ready-for-agent + 无 open 阻塞 + 无 assignee）：${notReady.map((n) => '#' + n).join(', ')} —— 排批只审可开工票`)
    }
  }

  const withBody = frontierTickets.map((t) => ({ ...t, body: t.body ?? (args.frontierJson === undefined ? ghBody(t.number) : null) }))
  const parsedAll = withBody.map((t) => ({ number: t.number, title: t.title, ...parseLaneFields(t.body) }))

  // 审计面：点名 = 点名子集（缺字段响亮 exit 1——点名即声明「要进 lane」，缺资格就回炉）；
  // 未点名 = 全部 frontier 票里带泳道票面的（普通批不强制四字段，缺了不算错、只注明）。
  let audited
  let noLaneFace
  // 审计序 = 票号升序（一处 sort）：点名序（--issues 137,136）与注入序都不保证有序，
  // 不归一会让 laneAudit 的 matrix 上三角判定与展示循环撞 null（复审 #3）。
  if (wanted !== null) {
    audited = wanted.map((n) => parsedAll.find((t) => t.number === n)).sort((a, b) => a.number - b.number)
    const lacking = audited.filter((t) => t.missing.length > 0)
    if (lacking.length > 0) {
      for (const t of lacking) {
        console.error(`lane-audit: #${t.number} 泳道票面四字段不全，缺: ${t.missing.join(', ')} —— 填不满 → needs-triage，不进 lane（docs/agents/issue-tracker.md「泳道批票面」）`)
      }
      process.exit(1)
    }
    noLaneFace = []
  } else {
    audited = parsedAll.filter((t) => t.touchSet.length > 0)
    noLaneFace = parsedAll.filter((t) => t.touchSet.length === 0).map((t) => t.number)
    if (audited.length === 0) {
      console.log('lane-audit: frontier 里没有带泳道票面（touch-set 字段）的票 —— 无泳道批要排（普通批不强制四字段）')
      if (args.json === true) console.log(JSON.stringify({ audited: [], matrix: [], pairs: [], serialGroups: [], singletons: [], skippedNoLaneFace: noLaneFace }, null, 2))
      return
    }
  }

  const result = laneAudit(audited.map((t) => ({ number: t.number, title: t.title, touchSet: t.touchSet })))

  if (args.json === true) {
    console.log(JSON.stringify({
      audited: audited.map((t) => ({ number: t.number, title: t.title, touchSet: t.touchSet, interface: t.interface, impact: t.impact, proving: t.proving, missing: t.missing })),
      matrix: result.matrix,
      pairs: result.pairs,
      serialGroups: result.serialGroups,
      singletons: result.singletons,
      skippedNoLaneFace: noLaneFace,
    }, null, 2))
    return
  }

  const nums = audited.map((t) => '#' + t.number)
  console.log(`\n=== lane-audit（排批维度：touch-set 相交 = 不并行，不是不 ready）: ${audited.length} 票 ${nums.join(', ')} ===`)
  if (noLaneFace.length > 0) {
    console.log(`  （未带泳道票面、不参与相交审计的 frontier 票: ${noLaneFace.map((n) => '#' + n).join(', ')} —— 普通批不强制四字段）`)
  }
  console.log('\n两两相交矩阵（✓ = 写域相交，格内是 shared 路径）:')
  const header = '        ' + audited.map((t) => `#${t.number}`).join('  ')
  console.log(header)
  for (let i = 0; i < audited.length; i++) {
    const row = audited.map((_, j) => {
      if (j < i) return '   '
      if (j === i) return ' — '
      const shared = result.matrix[i][j]
      return shared.length > 0 ? ' ✓ ' : ' · '
    })
    console.log(`  #${audited[i].number}  ${row.join('  ')}`)
  }
  if (result.pairs.length > 0) {
    console.log('\n相交明细:')
    for (const p of result.pairs) console.log(`  #${p.a} ∩ #${p.b} → [${p.shared.join(', ')}]`)
  }
  if (result.serialGroups.length > 0) {
    console.log('\n⚠ 串行分组建议（同组票必须串行或合并成一票；组是传递的——判相交仍看上面的明细）:')
    for (const g of result.serialGroups) {
      console.log(`  serial: 票 [${g.tickets.map((n) => '#' + n).join(', ')}] 相交链重叠于 [${g.overlapFiles.join(', ')}]`)
    }
    console.log(`  singletons（无相交、可并行）: ${result.singletons.map((n) => '#' + n).join(', ') || '（无）'}`)
  } else {
    console.log(`\n✓ 无跨票写域相交 —— 全部票可并行（lane 分派还须各自验收线 + human 终审，VERA ADR-084 判据）`)
  }
  console.log('\n→ 建议 ≠ 判定：排批决策在 Lead（留痕进票面）+ human 终审；插队规则见 docs/agents/issue-tracker.md「泳道批票面」节')
}

// 只有**直接执行**才跑 CLI：被 import（离线单测）时只暴露纯函数。
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
