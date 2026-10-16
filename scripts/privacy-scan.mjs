#!/usr/bin/env node
/**
 * privacy-scan.mjs —— 个人 / 本机环境串守卫（**提交门与验收共用的一份判据**）。
 *
 * 口径与邻仓 `dsh-shell-host/scripts/privacy-scan.mjs` **对齐**：同命令名、同判据三面、
 * 同 denylist 路径、同样大小写不敏感、同样不回显 token。本仓在此之上多两块（本会话实测
 * 需要的）：**发布面全扫**（提交消息 / 提交身份 / ref 名 / 拟提交消息 —— 踩过"`git commit -m`
 * 里的 `$HOME` 被 pwsh 展开成真实家目录"）与 **tracker 面**（`--gh`，issue 正文/评论）。
 *
 * 为什么是检查而不是一条规则：脱敏机械可判（固定形态 + 固定词表）→ 落成确定性检查；
 * 写在文档里的"记得别写个人路径"是 no-op。
 *
 * 判据三面（1–3 对齐邻仓）：
 *   1. **本机运行时身份**：`userInfo().username` / `homedir()`（反斜杠与正斜杠两形）——
 *      不写死名单，换台机器就守那台机器的身份；
 *   2. **本机布局形态**：`<盘符>:\dsh-*`、`/<盘符>/dsh-*`、`<盘符>:\Work\`（`C:/msys64` 是
 *      **标准安装点**，保留）——本文用中性写法描述形态，避免守卫自指命中；
 *   3. **denylist**：`<DSH_HOME>/privacy-denylist.txt`（一行一个 token、`#` 注释，**永不进仓**）
 *      —— 运行时推不出来的那类（呼号、旧机用户名、个人邮箱、内网 host/IP、旧布局根）。
 *   4. 本仓扩展面：tracked 内容 / 全部提交消息 / 提交身份 / ref 名 / `.git/COMMIT_EDITMSG`，
 *      `--gh` 时再加 issue 正文与评论。
 *
 * 豁免：行内 `pii-allow`（要带理由）——比整仓 `SKIP_HOOKS=1` 细一档，且例外留在 diff 里可 review。
 * 输出**整行打码**（同一行多个 token 也全遮）：守卫的输出本身也是发布面。
 *
 * 用法：
 *   node scripts/privacy-scan.mjs [--verbose] [--gh] [--denylist <file>] [--no-history] [--root <dir>]
 * exit 0 = 净；1 = 有命中；缺 git / 缺 gh → **响亮跳过**（不把缺环境装成通过）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 规则类别标签（记进报告；值本身不落进报告）。 */
export const KINDS = {
  userName: '本机用户名',
  homeDir: '本机家目录',
  layoutWin: '本机布局(X:\\dsh-*)',
  layoutPosix: 'POSIX 布局(/x/dsh-*)',
  layoutWork: '旧工作布局(X:\\Work\\)',
  homePath: '字面家目录(/home|/Users|X:\\Users)',
  denylist: 'denylist',
}

/** 允许出现的用户名段：容器/CI/示例/共享账户/占位符，不是某个人的身份。
 *  `me` / `u` / `x` / `alice` 是邻仓（dsh-shell-host）既有的占位符写法——跨仓跑守卫时
 *  发现本表漏了它们会把对方**干净**的仓报红（2026-10-16）。 */
export const ALLOWED_USERS = new Set([
  'agent', 'runner', 'user', 'username', 'you', 'your-user', 'me', 'app', 'node', 'example',
  'name', 'your-name', 'yourname', 'foo', 'bar', 'baz', 'test', 'administrator', 'default',
  'public', 'shared', 'u', 'x', 'alice', 'bob',
])

/** 运行期派生形态（`$(whoami)` / `%USERNAME%` / `${USER}`）：不是硬编码身份。 */
const DYNAMIC_USER = /[$%{}()+*]/

/** 结构性规则（入仓部分）：字面家目录 + 本机布局形态（大小写不敏感）。 */
export const RULES = [
  {
    kind: KINDS.homePath,
    re: /(?<![\w.-])(?:\/home\/|\/Users\/)([A-Za-z0-9._-]+)(?=\/)/g,
    user: 1,
  },
  {
    kind: KINDS.homePath,
    re: /[A-Za-z]:[\\/]Users[\\/]([A-Za-z0-9._-]+)/g,
    user: 1,
  },
  { kind: KINDS.layoutWin, re: /[A-Za-z]:[\\/]dsh-[A-Za-z]/gi },
  { kind: KINDS.layoutPosix, re: /\/[a-z]\/dsh-[A-Za-z]/gi },
  { kind: KINDS.layoutWork, re: /[A-Za-z]:[\\/]Work[\\/]/gi },
]

/** 命中行内的显式豁免标记（带理由，留在 diff 里）。 */
export const ALLOW_MARKER = 'pii-allow'

/** 本机运行时身份 tokens（对齐邻仓：不写死名单）。 */
export function identityTokens() {
  const user = userInfo().username
  const home = homedir()
  return [
    ...(user.trim() === '' ? [] : [{ kind: KINDS.userName, value: user }]),
    ...(home.trim() === '' ? [] : [
      { kind: KINDS.homeDir, value: home },
      { kind: KINDS.homeDir, value: home.replaceAll('\\', '/') },
    ]),
  ]
}

/** denylist 路径：`<DSH_HOME>/privacy-denylist.txt`（本机、永不进仓）——与邻仓同路径。 */
export function denylistPath(dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  return process.env.DSH_PII_DENYLIST ?? join(dshHome, 'privacy-denylist.txt')
}

/** denylist tokens；读不到 → 空（调用方据此说明"只跑了结构性与身份面"）。 */
export function denylistTokens(file = denylistPath()) {
  if (!existsSync(file)) return { tokens: [], source: null }
  const tokens = readFileSync(file, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
    .map(value => ({ kind: KINDS.denylist, value }))
  return { tokens, source: file }
}

/** 转义正则元字符（denylist token 可能含 `.` 等）。 */
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 整行打码：**所有**结构化命中与 token 都替换为 `<redacted>`。
 * 只遮"命中的那一个"会漏掉同一行里的第二个身份（本会话实测：输出回显了家目录另一形）。
 */
function redact(line, tokens = []) {
  let out = line
  for (const rule of RULES) out = out.replace(rule.re, (m, user) => (user === undefined ? m : m.slice(0, m.length - user.length) + '<redacted>'))
  for (const t of tokens) out = out.replace(new RegExp(escapeRe(t.value), 'gi'), '<redacted>')
  return out
}

/**
 * 扫一段文本（所有面共用这一个实现——守卫不得手抄被测语义）。
 * `tokens` = `[{ kind, value }]`；返回 `[{ kind, line, text }]`（`text` 为整行打码）。
 */
export function scanText(text, { tokens = [] } = {}) {
  const findings = []
  const lines = String(text).split('\n')
  const needles = tokens.map(t => ({ kind: t.kind, lower: t.value.toLowerCase() }))
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes(ALLOW_MARKER)) continue
    const kinds = []
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m
      while ((m = rule.re.exec(line)) !== null) {
        const user = rule.user === undefined ? undefined : m[rule.user]
        if (user !== undefined) {
          // 纯标点段（`C:/Users/...` 这类省略号缩写）不是身份：至少要有一个字母数字
          if (!/[A-Za-z0-9]/.test(user)) continue
          if (ALLOWED_USERS.has(user.toLowerCase()) || DYNAMIC_USER.test(user)) continue
        }
        kinds.push(rule.kind)
      }
    }
    const lower = line.toLowerCase()
    for (const n of needles) if (lower.includes(n.lower)) kinds.push(n.kind)
    if (kinds.length === 0) continue
    const shown = redact(line, tokens)
    for (const kind of [...new Set(kinds)]) findings.push({ kind, line: i + 1, text: shown })
  }
  return findings
}

/** git 薄封装（守卫的外部依赖之一）。 */
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

/**
 * 扫一个仓库的**发布面**。`history: false` 只扫 HEAD 的提交消息（大仓可选）。
 * 返回 `{ findings, surfaces }`；findings 带 `surface` 与 `file`。
 */
export function scanRepo({ root = process.cwd(), tokens = [], history = true } = {}) {
  const cwd = resolve(root)
  const findings = []
  const push = (surface, file, hits) => { for (const hit of hits) findings.push({ surface, file, ...hit }) }

  // 1. tracked 文件内容（二进制跳过）
  const files = git(cwd, ['ls-files', '-z']).split('\0').filter(Boolean)
  for (const file of files) {
    let text
    try { text = readFileSync(join(cwd, file), 'utf8') } catch { continue }
    if (text.includes('\0')) continue
    push('file', file, scanText(text, { tokens }))
  }

  // 2. 提交消息
  const logArgs = history ? ['log', '--all', '--format=%B%x00'] : ['log', '-1', '--format=%B%x00']
  const messages = git(cwd, logArgs).split('\0').filter(text => text.trim() !== '')
  messages.forEach((text, i) => push('message', `log#${i + 1}`, scanText(text, { tokens })))

  // 3. 提交身份（名字与邮箱都是发布面；本会话实测：旧机用户名在 130 个提交的身份里）
  const identities = [...new Set(git(cwd, ['log', '--all', '--format=%an <%ae>|%cn <%ce>']).split('\n').filter(Boolean))]
  identities.forEach((text, i) => push('identity', `identity#${i + 1}`, scanText(text, { tokens })))

  // 4. ref 名
  const refs = git(cwd, ['for-each-ref', '--format=%(refname:short)']).split('\n').filter(Boolean)
  for (const ref of refs) push('ref', ref, scanText(ref, { tokens }))

  // 5. 拟提交消息（pre-commit 窗口内存在）
  try {
    const editMsg = git(cwd, ['rev-parse', '--git-path', 'COMMIT_EDITMSG']).trim()
    const path = resolve(cwd, editMsg)
    if (existsSync(path)) push('pending-message', 'COMMIT_EDITMSG', scanText(readFileSync(path, 'utf8'), { tokens }))
  } catch { /* 非提交期，跳过 */ }

  const seen = new Set()
  const unique = findings.filter(f => {
    const key = `${f.surface}|${f.file}|${f.kind}|${f.line}|${f.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    findings: unique,
    surfaces: { files: files.length, messages: messages.length, identities: identities.length, refs: refs.length },
  }
}

/**
 * 轨迹面（issue 正文 / 评论）——**纯函数**：注入 `[{ surface, id, text }]` 即可离线测。
 * 判定与仓面共用 `scanText`；gh 只是取件薄壳（见 `trackerItems`）。
 */
export function scanTrackerItems(items, { tokens = [] } = {}) {
  const findings = []
  for (const item of items) {
    for (const hit of scanText(item.text, { tokens })) {
      findings.push({ surface: item.surface ?? 'tracker', file: item.id, ...hit })
    }
  }
  const seen = new Set()
  return findings.filter(f => {
    const key = `${f.surface}|${f.file}|${f.kind}|${f.line}|${f.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 从 GitHub 取轨迹面文本（issue 标题+正文、评论）。
 * 用 `--jq '.[] | {…}'` 拿 **JSONL**（逐行一个对象）：`--paginate` 会把数组拼起来，
 * 直接 `JSON.parse` 会炸（本会话实测坑）。**必须 `--paginate`**：只取第一页会漏出
 * "看起来干净"的假象（实测第一页 30 条全绿，实际第 100+ 条还有个人路径）。
 */
export function trackerItems() {
  const jsonl = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
  const issues = jsonl(['api', '--paginate', 'repos/{owner}/{repo}/issues?state=all&per_page=100',
    '--jq', '.[] | {number: .number, title: .title, body: .body}'])
  const comments = jsonl(['api', '--paginate', 'repos/{owner}/{repo}/issues/comments?per_page=100',
    '--jq', '.[] | {id: .id, issue: (.issue_url | split("/") | last), body: .body}'])
  return [
    ...issues.map(i => ({ surface: 'issue', id: `#${i.number}`, text: `${i.title ?? ''}\n${i.body ?? ''}` })),
    ...comments.map(c => ({ surface: 'comment', id: `comment ${c.id} (#${c.issue})`, text: c.body ?? '' })),
  ]
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  const root = arg('--root') ?? process.cwd()
  const file = arg('--denylist') ?? arg('--terms') ?? denylistPath()
  const { tokens, source } = denylistTokens(file)
  const all = [...tokens, ...identityTokens()]
  const history = !argv.includes('--no-history')

  if (argv.includes('--verbose')) {
    console.log(`privacy-scan: identity={userName, homeDir×2} denylist=${file}${source === null ? '（不存在/为空）' : `（${tokens.length} 条）`}`)
  }
  try {
    const { findings, surfaces } = scanRepo({ root, tokens: all, history })
    let hits = findings
    if (argv.includes('--gh')) {
      try {
        hits = [...hits, ...scanTrackerItems(trackerItems(), { tokens: all })]
      } catch (error) {
        console.log(`  !! SKIP (loud) - 轨迹面未核对（gh 不可用/未登录：${String(error?.message ?? error).split('\n')[0]}）`)
      }
    }
    if (source === null) {
      console.log(`  !! SKIP (loud) - denylist 缺失（${file}）：只跑了身份与结构性规则，运行期推不出的那类 token 未核对`)
      console.log('     格式：一行一个 token、# 注释、大小写不敏感；该文件在 <DSH_HOME> 下，**永不进仓**')
    }
    const scanned = `files=${surfaces.files} messages=${surfaces.messages} identities=${surfaces.identities} refs=${surfaces.refs}`
    if (hits.length === 0) {
      console.log(`  ✓ privacy-scan: clean (${scanned}; identity=3 + denylist=${source === null ? '缺席' : tokens.length})`)
      return 0
    }
    console.log(`  ✗ privacy-scan: ${hits.length} finding(s) (${scanned})`)
    for (const f of hits) {
      const where = f.file === undefined ? f.surface : `${f.surface}:${f.file}`
      console.log(`      [${f.kind}] ${where}:${f.line}  ${f.text}`)
    }
    console.log('      → 改占位符（`~` / `$HOME` / `%USERPROFILE%` / `<repo>` / `<user>`）；确属必需时在该行内联 `pii-allow` 并说明理由。')
    return 1
  } catch (error) {
    console.log(`  !! SKIP (loud) - 不是可扫的 git 仓库（${String(error?.message ?? error).split('\n')[0]}）`)
    console.log('     守卫未生效，本次未核对个人 / 本机环境串。')
    return 0
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}