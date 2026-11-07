/**
 * exports-audit.mjs —— 上游子路径引用的 exports 键机械全量守卫（#180）。
 *
 * 为什么存在（#176 P0 0169e8a 的补课）：0.2.2 线起上游 exports **移除键**对载体引用
 * 上游子路径成**硬约束** —— P0 只人工核了 `list-agents` 单例（`dsh-tool-subagent-control`
 * 的 `./list-agents` 在 0.2.2-alpha.1 被移除，载体旧独立行 never started → 整个 preset
 * agent-preset/invalid）。本守卫把「其余引用未全面 grep 核对」变成**机械全量钉**：
 * 四载体（cordis.patch.yml + presets/ 三份 patch）+ preset-harness 里全部
 * `@deepseek-ai/dsh-*` 形式的上游引用（裸包名与子路径两种形态），逐条断言在**本仓锚**
 * 的 exports 键内。上游再摘键，快集当场红，不再等桌面端模式选择消失。
 *
 * 判据面（exports 实体从哪来）：
 *   `tests/node_modules/@deepseek-ai/<pkg>/package.json` 的 `exports` ——
 *   link-runtime-deps.mjs 建的逐包 junction 表，其锚（dsh-llm 版本）被
 *   verify-runtime-anchor.mjs R2 与本守卫 A2 双重钉死 == 本仓 package.json 派生的宿主锚。
 *   即「0.2.2-rc.1 的 exports 键面」不另抄一份快照（D4：守卫手抄被测实现是漂移种子），
 *   重锚后本守卫自动跟到新锚的键面。
 *
 * 检查项：
 *   A0  matcher 非空洞自检：负控 = 伪造 `dsh-tool-subagent-control/list-agents` 引用
 *       （rc.1 实测已移除的键）必须判 INVALID；正控 = `plugin-manager/tools` /
 *       `plugin-market/tools`（载体在用的子路径）与两个裸包名必须判 VALID。
 *   A1  扫描非空洞：五个被审文件各 ≥ MIN_PER_FILE 条引用、总计 ≥ MIN_TOTAL
 *       （当前实测 28/29/28/29/21 —— 扫描坏了或文件缺席就不是绿，是红）。
 *   A2  锚点门：包表在场（缺席 → loud skip，与 verify-runtime-anchor R1 同口径：
 *       套件其余项会以 ERR_MODULE_NOT_FOUND 响亮，别加噪音）且 dsh-llm 版本 ==
 *       本仓声明的宿主锚（否则打在错的 exports 面上 = 假绿，响亮红）。
 *   A3  每条引用逐条判：子路径引用 → 必须**精确命中或命中模式键**（Node exports
 *       语义：`*` 可跨 `/`）；裸包名引用 → `.` 键必须在。任一不中即红，
 *       每条失败带 `file:line` + 原因。
 *   A4  表污染检测：每个被引用包的版本必须 == 宿主锚（junction 表混进旧版本包 =
 *       打在错契约上）。
 *   A5  扰动真红（e2e）：往临时文件里写一条**真引用 + 一条伪引用** → 审计必须红、
 *       点名伪引用、不累及真引用；对照（只真引用）→ 绿。守卫不是空洞的绿。
 *
 * 注释行不扫（语义：非装载引用）：yml 的 `#` 行、mjs 的 `//` / `*` / `/*` 行。
 * 行内注释里的引用会**被扫到**（从严方向：多报的只会是注释里写了假引用这种自伤形态）。
 *
 * 双入口：
 *   node tests/exports-audit.mjs            —— 快集入口（verify-all 自动拾取 tests/*.mjs）
 *   vitest run tests/exports-audit.spec.ts  —— 票面证明命令（同一核心，见 exports-audit.spec.ts）
 */
import { isAbsolute, join } from 'node:path'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { anchorOf } from '../scripts/runtime-anchor.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
/** exports 键面的来源：link-runtime-deps.mjs 建的逐包 junction 表。 */
export const TABLE = join(REPO, 'tests', 'node_modules', '@deepseek-ai')

/** 被审文件（相对仓根）：四载体 + preset-harness。 */
export const AUDIT_FILES = [
  'cordis.patch.yml',
  'presets/matt-cordis.patch.yml',
  'presets/matt-minimal.patch.yml',
  'presets/matt-ptc.patch.yml',
  'tests/preset-harness.mjs',
]

/** A1 非空洞下界：读数只写区间（AGENTS 纪律——单次值进证据件 .scratch/verify180/）：
 *  当前每文件为两位数量级、总计 >100；取宽松下界防「扫描静默变空仍绿」。
 *  当次读数见 .scratch/verify180/verify-all-fast.log 同批的 exports-audit 行与 prove-mjs.txt。 */
export const MIN_PER_FILE = 5
export const MIN_TOTAL = 40

/** 包表缺席的 loud skip 文案（三处共用）：必须含 `SKIP (loud)` 字样 —— verify-all 靠它记
 *  PASS*（复审 #180 意见 1：matcherSelfCheck/perturbationProbe 的缺席分支曾丢该字样，被
 *  汇总误记纯 PASS）。 */
export const TABLE_SKIP_REASON =
  `SKIP (loud) — harness @deepseek-ai 包表缺席/不可读（${TABLE}）；` +
  '跑 node scripts/link-runtime-deps.mjs --runtime <含 node_modules/@deepseek-ai 的目录> 补齐。' +
  '套件其余项会以 ERR_MODULE_NOT_FOUND 响亮。'

/** `@deepseek-ai/dsh-<pkg>[/subpath]`：包名段 `[a-z0-9-]*`，子路径段不含引号/空白/`*`。
 *  declare（复审 #180 意见 4）：子路径段只匹配**单段**（不含 `/`）——多段引用
 *  `@deepseek-ai/dsh-x/a/b` 会被截成 `/a` 整段判。当前五个被审文件实测无多段形态
 *  （本轮 git grep 多段仅命中 fixture 的 tgz URL，不在被审面）；若未来出现多段引用，
 *  应把截断语义改为贪到引号/空白边界再整段判，而非依赖本条。 */
const REF_RE = /@deepseek-ai\/(dsh-[a-z0-9][a-z0-9-]*)(\/[A-Za-z0-9._-]+)?/g

/** 注释行判据：yml 的 `#` 行；mjs 的 `//`、`*`、`/*` 行。行内注释不在此列（从严扫到）。 */
function isCommentLine(file, line) {
  const t = line.trimStart()
  if (file.endsWith('.yml') || file.endsWith('.yaml')) return t.startsWith('#')
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/** 从一段文本抽出全部上游引用（带行号）。 */
export function extractUpstreamRefs(text, file) {
  const refs = []
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (isCommentLine(file, line)) continue
    for (const m of line.matchAll(REF_RE)) {
      refs.push({ file, line: i + 1, pkg: m[1], subpath: m[2] ?? '', raw: line.trim() })
    }
  }
  return refs
}

/** exports 字段 → 子路径键数组；无 exports 字段返回 undefined（legacy 面）。 */
export function exportsKeys(exportsField) {
  if (exportsField === undefined || exportsField === null) return undefined
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) return ['.']
  const keys = Object.keys(exportsField)
  // 对象键若全不是 `./` 形，它是 "." 的条件映射（types/default/…）而非子路径表
  return keys.some((k) => k.startsWith('.')) ? keys : ['.']
}

/**
 * 子路径是否命中 exports 键（Node 语义：精确键或模式键，模式 `*` 可跨 `/`）。
 * subpath='' 表示裸包名（只看 `.` 键）。返回命中的键，不中返回 null。
 */
export function subpathMatch(exportsField, subpath) {
  const keys = exportsKeys(exportsField)
  if (keys === undefined) return null
  // 归一：引用面子路径是 `/tools` 形，exports 键是 `./tools` 形
  const want = subpath === '' ? '.' : '.' + subpath
  if (keys.includes(want)) return want
  for (const key of keys) {
    if (!key.includes('*')) continue
    const re = new RegExp(
      '^' +
        [...key].map((ch) => (ch === '*' ? '(.*)' : ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('') +
        '$',
    )
    if (re.test(want)) return key
  }
  return null
}

/** 读包表里某包的 package.json；读不到返回 undefined。 */
export function faceOf(pkg) {
  try {
    return JSON.parse(readFileSync(join(TABLE, pkg, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 对一批引用逐条判（A3 的 matcher 面）：返回 verdicts（含 ok/reason/matchedKey）。
 * 包读不到 = INVALID（表缺该包 = 引根本解析不了）。
 */
export function judgeRefs(refs) {
  return refs.map((ref) => {
    const pkgJson = faceOf(ref.pkg)
    if (pkgJson === undefined) {
      return { ...ref, ok: false, reason: `包不在锚定包表里（${TABLE} 下无 ${ref.pkg}）—— 引根解析不了` }
    }
    const hit = subpathMatch(pkgJson.exports, ref.subpath)
    if (hit === null) {
      const keys = exportsKeys(pkgJson.exports)
      const shown = keys === undefined ? '（无 exports 字段）' : keys.join(' | ')
      return {
        ...ref,
        ok: false,
        reason:
          ref.subpath === ''
            ? `裸包名引用但 exports 无 "." 键 —— 现有键：${shown}`
            : `子路径 ${ref.subpath} 不在 exports 键内 —— 现有键：${shown}`,
      }
    }
    return { ...ref, ok: true, matchedKey: hit }
  })
}

/**
 * 读文件 → 抽引用 → 逐条判 + 锚点门（A2）+ 版本核对（A4）。**不含** A1 非空洞门
 * （A5 扰动探针也走这里，探针文件只有一两条引用）。返回
 * { ok, skipped, reason, anchor, refs, verdicts, failures, problems, packages, perFile }。
 * skipped=true 表示包表缺席（loud skip 口径），此时 ok 无意义。
 */
export function collectAndJudge(files) {
  const declared = anchorOf(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version)
  const llm = faceOf('dsh-llm')
  if (llm === undefined) {
    return {
      ok: false,
      skipped: true,
      reason: TABLE_SKIP_REASON,
      anchor: declared,
      refs: [],
      verdicts: [],
      failures: [],
      problems: [],
      packages: {},
      perFile: {},
    }
  }
  const anchor = llm.version
  const refs = []
  const perFile = {}
  for (const file of files) {
    const abs = isAbsolute(file) ? file : join(REPO, file)
    const found = extractUpstreamRefs(readFileSync(abs, 'utf8'), file)
    perFile[file] = found.length
    refs.push(...found)
  }
  const verdicts = judgeRefs(refs)
  const packages = {}
  for (const v of verdicts) {
    if (packages[v.pkg] === undefined) packages[v.pkg] = faceOf(v.pkg)?.version ?? null
  }
  const versionDrift = Object.entries(packages).filter(([, ver]) => ver !== anchor)
  const failures = verdicts.filter((v) => !v.ok)
  const problems = []
  if (anchor !== declared) {
    problems.push(
      `A2. 锚点不一致 —— 本仓声明 ${declared}，包表 dsh-llm 是 ${anchor}；` +
        '测试会打在错的 exports 面上（跑 node scripts/link-runtime-deps.mjs 重指）',
    )
  }
  for (const f of failures) {
    problems.push(`A3. ${f.file}:${f.line} ${f.pkg}${f.subpath} —— ${f.reason}`)
  }
  for (const [pkg, ver] of versionDrift) {
    problems.push(`A4. 包表版本漂移 —— ${pkg} 是 ${ver}，锚是 ${anchor}（junction 表混进旧版本 = 打在错契约上）`)
  }
  return { ok: problems.length === 0, skipped: false, reason: '', anchor: declared, refs, verdicts, failures, problems, packages, perFile }
}

/**
 * 全量审计（A1–A4）= collectAndJudge + A1 非空洞门。对缺省的五文件跑。
 */
export function auditFiles(files = AUDIT_FILES) {
  const audit = collectAndJudge(files)
  if (audit.skipped) return audit
  const hollow = Object.entries(audit.perFile).filter(([, n]) => n < MIN_PER_FILE)
  if (audit.refs.length < MIN_TOTAL) {
    audit.problems.push(`A1. 扫描非空洞失败 —— 总引用 ${audit.refs.length} < ${MIN_TOTAL}（扫描坏了或文件被清空）`)
  }
  for (const [file, n] of hollow) {
    audit.problems.push(`A1. ${file} 只抽出 ${n} 条引用（< ${MIN_PER_FILE}）—— 文件缺席/被清空/扫描判据坏了`)
  }
  audit.ok = audit.problems.length === 0
  return audit
}

/** A0：matcher 非空洞自检（负控 = rc.1 实测已移除的键；正控 = 载体在用的键）。 */
export function matcherSelfCheck() {
  const problems = []
  const llm = faceOf('dsh-llm')
  if (llm === undefined) return { ok: false, problems: [TABLE_SKIP_REASON], skipped: true }
  // 负控：`./list-agents` 在 0.2.2-alpha.1 被上游移除（P0 现场）。先核键面确实没有它——
  // 若上游哪天把键加回来，这条负控失去「伪造」资格，A0 会要求换一个真实缺席的键。
  const sac = faceOf('dsh-tool-subagent-control')
  const removedKey = '/list-agents'
  if (sac !== undefined && subpathMatch(sac.exports, removedKey) !== null) {
    problems.push(`A0. 负控失效 —— dsh-tool-subagent-control 的 exports 现在有 ${removedKey}（上游加回来了？换一个真实缺席的键当负控）`)
  } else {
    const fake = judgeRefs([{ file: '(self-check)', line: 0, pkg: 'dsh-tool-subagent-control', subpath: removedKey, raw: '(A0 负控)' }])
    if (fake[0].ok) problems.push('A0. matcher 对已移除的 /list-agents 引用判了 VALID —— matcher 坏了（空洞绿）')
  }
  // 正控：载体在用的两条子路径 + 两个裸包名必须 VALID。
  const positives = [
    { pkg: 'dsh-plugin-manager', subpath: '/tools' },
    { pkg: 'dsh-plugin-market', subpath: '/tools' },
    { pkg: 'dsh-agent-preset', subpath: '' },
    { pkg: 'dsh-tool-executor-native', subpath: '' },
  ]
  for (const p of positives) {
    const v = judgeRefs([{ file: '(self-check)', line: 0, pkg: p.pkg, subpath: p.subpath, raw: '(A0 正控)' }])
    if (!v[0].ok) problems.push(`A0. 正控失败 —— ${p.pkg}${p.subpath} 被判 INVALID：${v[0].reason}`)
  }
  return { ok: problems.length === 0, problems, skipped: false }
}

/**
 * A5：扰动真红（e2e）。往临时文件写「真引用 + 伪引用」→ 审计必须红且只点名伪引用；
 * 对照（只真引用）→ 绿。临时目录用完即删；不触碰任何载体文件。
 */
export function perturbationProbe() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-matt-exports-audit-'))
  try {
    const real = "    - id: tool-plugin-manager\n      name: '@deepseek-ai/dsh-plugin-manager/tools'\n"
    const fake = "    - id: tool-fake\n      name: '@deepseek-ai/dsh-plugin-manager/tools-gone-fake'\n"
    const realRef = 'dsh-plugin-manager/tools'
    const fakeRef = 'dsh-plugin-manager/tools-gone-fake'
    // 对照：只有真引用 → 绿
    writeFileSync(join(dir, 'ok.yml'), real)
    const okRun = collectAndJudge([join(dir, 'ok.yml')])
    if (okRun.skipped) return { ok: false, problems: [TABLE_SKIP_REASON], skipped: true }
    const problems = []
    if (!okRun.ok) problems.push(`A5. 对照（只真引用）没有绿：${okRun.problems.join('; ')}`)
    // 扰动：真 + 伪 → 必须红，且点名伪引用、不点名真引用
    writeFileSync(join(dir, 'bad.yml'), real + fake)
    const badRun = collectAndJudge([join(dir, 'bad.yml')])
    if (badRun.ok) problems.push('A5. 扰动没有红 —— 守卫是空洞的绿（伪引用被放行）')
    const flaggedFake = badRun.failures.some((f) => `${f.pkg}${f.subpath}` === fakeRef)
    const flaggedReal = badRun.failures.some((f) => `${f.pkg}${f.subpath}` === realRef)
    if (!flaggedFake) problems.push('A5. 扰动红了但没点名伪引用 ' + fakeRef)
    if (flaggedReal) problems.push('A5. 扰动连真引用 ' + realRef + ' 也点名了 —— 判据面越界')
    return { ok: problems.length === 0, problems, skipped: false }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  }
}

/** CLI 入口（快集）：A0 + A1–A4 + A5，✓/✗ 行，exit 0/1；包表缺席 → SKIP (loud) exit 0。 */
export function runCli() {
  const results = []
  const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
  const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))

  const self = matcherSelfCheck()
  if (self.skipped) {
    console.log(self.problems[0])
    process.exit(0)
  }
  if (self.ok) ok('A0. matcher 非空洞（负控 /list-agents 判 INVALID；4 正控判 VALID）')
  else for (const p of self.problems) bad('A0. matcher 自检', p)

  const audit = auditFiles()
  if (audit.skipped) {
    console.log(audit.reason)
    process.exit(0)
  }
  const perFileShown = Object.entries(audit.perFile).map(([f, n]) => `${f}=${n}`).join(', ')
  if (audit.ok) {
    ok(`A1. 扫描非空洞（${audit.refs.length} 条引用：${perFileShown}）`)
    ok(`A2. 锚点一致（本仓声明 = 包表 dsh-llm = ${audit.anchor}）`)
    ok(`A3. 全部引用在 exports 键内（子路径命中精确/模式键，裸包名命中 "."；覆盖 ${Object.keys(audit.packages).length} 个上游包）`)
    ok('A4. 被引用包版本 == 宿主锚（无表污染）')
  } else {
    bad(`A1–A4. 审计红（${audit.refs.length} 条引用：${perFileShown}）`)
    for (const p of audit.problems) console.log('       ' + p)
  }

  const pert = perturbationProbe()
  if (pert.skipped) {
    console.log(pert.problems[0])
    process.exit(0)
  }
  if (pert.ok) ok('A5. 扰动真红（伪引用点名、真引用不累及；对照绿）')
  else for (const p of pert.problems) bad('A5. 扰动探针', p)

  console.log('\n=== EXPORTS-AUDIT RESULTS ===')
  console.log(results.join('\n'))
  process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) runCli()
