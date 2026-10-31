/**
 * verify-isolated-git-structure.mjs —— git 隔离守卫的**结构面**（I2 结构断言 + I3 挂具自检）。
 * 全部断言自 `tests/verify-isolated-git.mjs` **原样迁入**（断言标签 I2a–I2e / I3a–I3c 不变 ——
 * 文档与邻件注释按号引用）。**#110 立节，#169 拆层**。
 *
 * ── 为什么拆层（#169）────────────────────────────────────────────────────────────
 * I2/I3 原与 I1/I4 同居 `verify-isolated-git.mjs`，整文件被 @slow 切走后，结构守卫在快集 /
 * pre-commit 里**无人看守** —— #163 的 O4 违规（spawn `cwd:` 形态未走挂具）就是这样进库的：
 * 分层维度只有耗时，而**结构面是秒级纯扫描**（判"哪些代码行没走挂具"），与**机制实测**（真 git
 * 夹具，分钟级）混居一个文件，被整文件 @slow 切走。#169 把两半拆开：
 *   · **本文件 = 写法面**（秒级）：刻意**不标 @slow**，每票的快集 / pre-commit 都跑；防回漂
 *     由 `tests/verify-all-entry.mjs` 的 **E16** 钉住（结构文件被删 / 被标 @slow / 机制文件
 *     丢标记 —— 三个红分支各点名）；
 *   · **`tests/verify-isolated-git.mjs` = 行为面**（I1 机制对照 / I4 套件级证据，@slow，分钟级）：
 *     批末 / 推送前 / 交付前跑 `--all`。
 *
 * 拆层后「不扫自己」的自引用理由消失：本文件与 `verify-isolated-git.mjs` 都**不在 SKIP** ——
 * 两者都**真 import 且真调用**挂具（I3 调 `fixtureEnv`；I1/I4 调 `fixtureEnv`/`gitIn`），
 * `classify` 判 harness、留在观测面上；谁停止走挂具，I2d 即红 —— 这正是默认拒绝。
 * `isolated-git.mjs`（挂具自己）仍在 SKIP：它不是夹具用例。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CALLER_GIT_VARS, fixtureEnv } from './isolated-git.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TESTS = join(REPO, 'tests')

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))
const loud = (name, why) => results.push('  ⤼ SKIP (loud) ' + name + ' — ' + why)

// ══ I2: 结构断言 —— **默认拒绝**：碰 git ⇒ 走挂具或显式登记（#125 替换 #110 的"枚举自建仓写法"）════════
//
// ── 为什么换形态（D15；**后来者请先读这段，别退回加宽正则**）──────────────────────────
// #110 立的 I2 判据是 `CREATES_REPO = /(?:['"`]init['"`])/` —— 用「`init` 作为**带引号的**
// git 子命令出现」来认「自建仓的用例」。这个**方向**是错的（#125 的实测与替换）：
//   ① **漏**（假绿面）：`clone` / `worktree add` 自建仓的用例认不出；`sandcastle-e2e.mjs`
//      的 `git -C "$W" init` 写在模板字符串里、**没有引号**，同样认不出 —— 而它确实自建了仓
//      （历史 #127 债务；现已接入挂具并摘牌）。
//   ② **追不动**：把 `init` 加宽成 `init|clone|worktree` 只是把"下一个写法"往后推一格 ——
//      自建仓的写法是**开放集**（init / clone / worktree add / submodule / 将来任何一种），
//      正则永远差一条，这是 D15 点名的无收敛军备竞赛。
// ⇒ 新形态是**白名单/默认拒绝**：判据不再猜"用例怎么建仓"，而是要求用例**自己声明**分类：
//   (a) 走挂具（**代码面** import 挂具 **且** 真调用 `fixtureEnv`/`gitIn`）—— 默认允许；
//   (b) 不碰 git（`touchesGit === false`）—— 不在观测面上；
//   (c) 例外 —— 在 `REGISTRY` 里**逐文件显式登记**（只读调用方仓 / 已知债务）。**没有第四条路。**
//   于是"新增一个自建仓用例但忘了挂具"默认落进「未登记」⇒ **红**。判据因此不再需要认出
//   "建仓的写法"（开放集），只需要认出"碰没碰 git"（封闭集：`GIT_SPAWNERS`）。
//
// ── 第 1/2 轮复核堵掉的两个"一句话绕过"（记下来，别再退回）────────────────────────────
//   · **尾注释伪装**：按行剥注释时，`spawnSync('git',['clone']) // fixtureEnv()` 会被判"走挂具"。
//     ⇒ 改用 `codeOf()` 的**状态机**剥注释（字符串 / 模板串原样保留）。
//   · **反引号 argv**：观测面认 `` `git` `` 而解析器只认单双引号时，``spawnSync(`git`, argv)``
//     会从 I2b 的计数里消失 ⇒ 改用单一 `QUOTE` 常量给所有模式共用。
//
// ── 未覆盖面（AC6：如实写出，别让后来者以为它是全能的）────────────────────────────────
//   ① 观测面 = **六种** `child_process` 调用器（`GIT_SPAWNERS`）+ shell 串形态。**不覆盖**：
//      (i) 执行器 / 命令串**写成变量**（`execSync(cmd)` 而 `cmd = 'git clone …'`、`spawn(gitBin, …)`）
//      —— 判据看的是**字面量**；(ii) 把 git 路径**动态解析**出来再 spawn（`spawnSync(join(bin,'git'))`）；
//      (iii) **经 bash / heredoc 起的 git**（`sandcastle-e2e.mjs` 的搭台即此；#127 的实际隔离由 I4 opt-in 链验证）。
//   ② `REGISTRY` 是**人写的**白名单：只读登记若用到 `READ_ONLY_SUBCOMMANDS` 之外的子命令
//      ⇒ 红（默认拒绝），必须人来扩白名单并写理由。它不会静默放过，但也不会自己发现新用法。
//   ③ `readOnly` 只核对**字面** argv：**非字面** argv（`spawnSync('git', argv)` / `[...spread]`）
//      记为「不可解析」⇒ 红 —— I2b 用"调用点数 − 字面数组数"算它，不靠"看上去有没有"。
//   ④ `debt` 的票号只写在 `why` 里（I2a 核"是非空字符串且**含 `#NN`**"，但套件**不联网**核它是否
//      仍 OPEN）——「票关了但债没修」这一面靠人复核，属**显式未覆盖**。
//   ⑤ **文件级判定**：同一文件里既有挂具 import 又有裸 spawn 时按"走挂具"放行（`classify` 是文件级）
//      —— 存量边界，另立票；本判据只保证"整个文件没走挂具"这一面。
//   ⑥ `codeOf()` 剥注释但不做语法分析：`if (false) fixtureEnv()` 这类**死代码**仍算"真调用"，
//      属显式未覆盖（要判它得上 AST，代价远高于收益）。
//   ⑦ 本判据是**写法面**的结构锁，不是运行时防线 —— 真正的机制防线是 I1（挂具坏了 I1b 直接红，
//      I1 在 `tests/verify-isolated-git.mjs`，#169 拆层后在行为面文件）。
//      以上各点一律选「响亮失败」而非「静默放过」。
/** `child_process` 调用器 —— **单一来源**：下面三个模式都从这张表派生（两处各写一份会漂：
 *  Standards 轴实测抓到过"观测面只认三个 `Sync` 而解析器认六个" ⇒ 异步调用静默绿）。 */
const GIT_SPAWNERS = ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec']
/** 能接 shell 命令串的两种 —— **从同一张表筛**，不另写一份（第 2 轮复核的判断项）。 */
const SHELL_SPAWNERS = GIT_SPAWNERS.filter(n => n === 'execSync' || n === 'exec')
/** 引号集 —— **也单一来源**：观测面认反引号而解析器只认单双引号时，``spawnSync(`git`, argv)``
 *  会从 I2b 的计数里消失（第 2 轮复核实测）。 */
const QUOTE = `['"\`]`
const anyOf = (list) => `(?:${list.join('|')})`
const SPAWN_GIT = new RegExp(`${anyOf(GIT_SPAWNERS)}\\(\\s*${QUOTE}git${QUOTE}`)
/** shell 串形态：`execSync('git clone …')`。仍不覆盖「变量化命令串」（见未覆盖面①(i)）。 */
const SPAWN_GIT_SHELL = new RegExp(`${anyOf(SHELL_SPAWNERS)}\\(\\s*${QUOTE}[^'"\`]*\\bgit\\s`)
/** 走挂具的调用形态：`gitIn(...)`（挂具导出的 `git -C` 调用器）。
 *  ⚠ **为什么它也算观测信号**（#110 第 1 轮实测的反向盲区）：初版只用「直接 spawn git」认用例，
 *  于是**改用挂具的文件反而掉出观测面** —— `verify-review-fixed-point.mjs` 接了挂具之后不再
 *  直接 `spawnSync('git'`，I2 就看不见它了（实测：文件数从 6 掉回 5）。越是守规矩越不被检查，
 *  是方向错误的盲区；故"走挂具"本身也是观测信号（但它**不 import** 就仍是 offender）。 */
const USES_HARNESS_CALL = /\bgitIn\s*\(/
const IMPORT_HARNESS = /from\s+['"]\.\/isolated-git\.mjs['"]/
/** 挂具的**使用**信号：import 了却不用 ≠ 隔离（D11：只验 import 文本等于验措辞 —— 注释里写一行
 *  import、或 import 后从不调用，都能骗过"只认文本"的判据）。必须"**代码面**真 import **且**真调用"。 */
const USES_FIXTURE = /\b(?:fixtureEnv|gitIn)\s*\(/
/** 自写的 `GIT_*` 清理：`startsWith('GIT_')` 一族 —— 与登记册并行的**第二条禁忌**（走挂具的
 *  清理是唯一来源，"每处各写一份"正是 #110 的病灶）。
 *  ⚠ **声明边界（D13/D15 先例）**：这是**写法面**的锁，抓的是"代码长什么样"而不是"行为如何"。
 *  故它有两面：① 换体裁（抽函数、走 shell 变量、`filter`+`Object.fromEntries`）可绕 ——
 *  **显式声明不覆盖开放集**，真正的防线是 I1 的机制实测；② 反过来它**可能假红**：任何用
 *  `startsWith('GIT_')` 做别的事的源码（例如路径前缀判定）会被判成"自写清理"。这个方向**宁可响亮**：
 *  它只会让人多看一眼并写一句豁免说明，不会静默放过真问题（对比 #108 R7 的同类声明）。 */
const HANDROLLED_CLEAN = /startsWith\(\s*['"]GIT_['"]\s*\)/

/** 只读子命令**白名单**（闭合集，默认拒绝）—— `readOnly` 登记的核对面。
 *  故意**不含** `config`（`git config k v` 是写）与 `checkout`/`add`/`commit`/`init`/`clone` 一族：
 *  要用到白名单之外的子命令 ⇒ 登记理由不成立 ⇒ 红，由人来扩并写理由。 */
const READ_ONLY_SUBCOMMANDS = new Set([
  'ls-files', 'rev-parse', 'status', 'log', 'show', 'diff', 'symbolic-ref',
  'for-each-ref', 'cat-file', 'ls-tree', 'grep', 'describe', 'merge-base', 'count-objects',
])

/**
 * 例外登记册 —— **I2 的唯一放行通道**。新增一条 = 一次**显式决定**（必须写 `why`，I2a 校验；
 * `debt` 的 `why` 还必须含票号 `#NN`）。
 *   `readOnly` —— 只用 git **读调用方仓自己**、不建仓。断言：它的**字面** argv 子命令全在
 *                `READ_ONLY_SUBCOMMANDS` 里；核不到字面调用 / argv 不可解析 ⇒ 红（默认拒绝）。
 *                ⇒ brief 那句「登记在册的文件确实没有自建仓」**只对 readOnly 成立，且是被断言出来的**。
 *   `debt`     —— 已知**未走挂具**的债务，**显式豁免**（不是"证明它没有自建仓"）。断言：它**确实仍
 *                未走挂具**（修好后本条会红 → 逼人摘牌），并在读数里逐条响亮列出（I2c）。
 *                登记债务不是"允许"，是**记账**：让缺口可见、有票号（写在 `why` 里）、有摘牌条件。
 */
const REGISTRY = {
  'verify-doc-pointers.mjs': {
    kind: 'readOnly',
    why: '用 `git ls-files` 取**本仓**跟踪文件清单（`tests/node_modules` 是 junction 森林，walk 会爆）',
  },
  'verify-review-brief-readonly.mjs': {
    kind: 'readOnly',
    why: '同上：`git ls-files` 取本仓跟踪文件清单，核对 brief 的只读面',
  },
}

/**
 * 把源码里的**注释**剥掉、**字符串与模板串原样保留** —— 这是 I2 的判据面（注释里的 `'git'` /
 * `fixtureEnv()` 不是代码）。**必须走状态机**，不能按行正则：`//` 会出现在字符串里（URL），
 * 按行剥会把字符串后半截的**真调用**一起剥掉（假阴性，D11 的另一个方向）；而只剥**行首**注释
 * 又会被"行尾注释写一句 `fixtureEnv()`"骗过（第 2 轮复核的实测绕过）。
 */
function codeOf(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      out += c
      i++
      while (i < src.length) {
        const ch = src[i]
        out += ch
        if (ch === '\\') { i++; if (i < src.length) { out += src[i]; i++ } continue }
        i++
        if (ch === q) break
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/** 观测面：这份代码**碰没碰 git**（封闭问题）。
 *  认的是"怎么调 git"（三种可识别写法），**不是**"用 git 做什么" —— 后者是开放集，正是
 *  本票从判据里删掉的那条错路（`CREATES_REPO`）。 */
const touchesGit = (code) =>
  SPAWN_GIT.test(code) || SPAWN_GIT_SHELL.test(code) || USES_HARNESS_CALL.test(code)

/**
 * 单文件分类（**纯函数**：真扫描与 I2e 自检共用同一份判据 —— "判据一套、自检另一套"
 * 是这类守卫最常见的腐烂方式）。
 * @param {string} name 文件名（相对 `tests/`）
 * @param {string} src 源码全文
 * @param {Record<string, {kind?: string}>} [registry] 登记册（自检可传合成登记册）
 * @returns {'irrelevant'|'harness'|'registered'|'offender'}
 */
function classify(name, src, registry = REGISTRY) {
  const code = codeOf(src)
  if (!touchesGit(code)) return 'irrelevant'
  // 走挂具 = **代码面** import **且**真调用（D11：只看 import 文本会被注释或死 import 骗过）
  if (IMPORT_HARNESS.test(code) && USES_FIXTURE.test(code)) return 'harness'
  if (Object.hasOwn(registry, name)) return 'registered'
  return 'offender'
}

/** 登记册的**纯**问题集（文件在不在 / 类目合不合法 / 有没有写 `why` / debt 有没有票号）。
 *  拆成纯函数是为了让 I2e 能用**合成**登记册钉住每条红路径（不依赖真登记册的内容）。 */
function registryProblems(registry, fileList) {
  const names = Object.keys(registry)
  const isStr = (v) => typeof v === 'string'
  return {
    missing: names.filter(f => !fileList.includes(f)),
    badKind: names.filter(f => !['readOnly', 'debt'].includes(registry[f].kind)),
    noWhy: names.filter(f => !isStr(registry[f].why) || registry[f].why.trim() === ''),
    debtNoTicket: names.filter(f => registry[f].kind === 'debt' && !/#\d+/.test(String(registry[f].why ?? ''))),
  }
}

/**
 * I2a 的判定（**纯函数**：分类器可注入 ⇒ I2e 能用合成登记册/桩分类器钉住每条红路径）。
 * 第 2 轮复核指出"只测 helper 不测分支 ⇒ 删掉分支套件仍绿"，故把**整条判定**收进这里。
 * @param {Record<string, {kind?: string, why?: string}>} registry
 * @param {string[]} fileList
 * @param {(name: string) => 'irrelevant'|'harness'|'registered'|'offender'} kindOf
 */
function registryReport(registry, fileList, kindOf) {
  const names = Object.keys(registry)
  const { missing, badKind, noWhy, debtNoTicket } = registryProblems(registry, fileList)
  const invisible = names.filter(f => fileList.includes(f) && kindOf(f) === 'irrelevant')
  const masked = names.filter(f => fileList.includes(f) && kindOf(f) === 'harness')
  const problems = []
  if (missing.length > 0) {
    problems.push(`登记在册但文件**不存在**：${missing.join(', ')} —— 登记 ≠ 永久豁免：要么恢复文件，要么摘掉这条登记`)
  }
  if (invisible.length > 0) {
    problems.push(`登记在册但判据**看不见它碰 git**：${invisible.join(', ')} —— 要么该文件的 git 用法已移除（摘牌），要么观测面失效`)
  }
  if (masked.length > 0) {
    problems.push(`已走挂具却仍在登记册：${masked.join(', ')} —— 该文件已合规，摘掉这条登记`)
  }
  if (badKind.length > 0) {
    problems.push(`登记类目只能是 readOnly / debt：${badKind.map(f => `${f}=${registry[f].kind}`).join(', ')}`)
  }
  if (noWhy.length > 0) {
    problems.push(`缺 why：${noWhy.join(', ')} —— 补一句"为什么允许它不走挂具"`)
  }
  if (debtNoTicket.length > 0) {
    problems.push(`debt 的 why 必须含票号（#NN）：${debtNoTicket.join(', ')} —— 否则"修好后摘牌"没有去处`)
  }
  return {
    ok: problems.length === 0,
    problems,
    total: names.length,
    readOnly: names.filter(f => registry[f].kind === 'readOnly').length,
    debt: names.filter(f => registry[f].kind === 'debt').length,
  }
}

/** 抽**字面** git argv 的首词（子命令）：`['ls-files']` → `ls-files`；`[...a]` → 不可解析。
 *  ⚠ **不可解析的算法**（两轴都抓到过旧版）：`调用点数 − 字面数组数`。旧版只数"看起来像字面
 *  数组"的调用点，于是 `spawnSync('git', argv)`（数组变量）**既不计数也不判红** —— 一个
 *  readOnly 文件用字面 `ls-files` 掩护一条动态 `init` 就能过。现在不猜：有调用点却不是字面
 *  数组 ⇒ 记 `unresolved` ⇒ I2b 红。引号集与调用器表都从**单一来源**派生（含反引号）。
 *  @returns {{found: string[], unresolved: number}} */
function literalGitSubcommands(code) {
  const literal = new RegExp(`${anyOf(GIT_SPAWNERS)}\\(\\s*${QUOTE}git${QUOTE}\\s*,\\s*\\[([^\\]]*)\\]`, 'g')
  const callStart = new RegExp(`${anyOf(GIT_SPAWNERS)}\\(\\s*${QUOTE}git${QUOTE}\\s*,`, 'g')
  const found = []
  let literals = 0
  let unresolved = 0
  for (const m of code.matchAll(literal)) {
    literals++
    const first = m[1].split(',')[0].trim()
    const lit = new RegExp(`^(${QUOTE})([^'"\`]*)\\1$`).exec(first)
    if (lit) found.push(lit[2]); else unresolved++
  }
  unresolved += [...code.matchAll(callStart)].length - literals   // 有调用点但不是字面数组
  return { found, unresolved }
}

/**
 * I2b 的判定（**纯函数**：reader 可注入 ⇒ I2e 能用合成源码钉住"不可解析 / 不在白名单 ⇒ 红"）。
 * @param {string[]} names readOnly 登记的文件名
 * @param {(name: string) => string|null} read 读源码；返回 `null` 表示文件不存在（跳过，由 I2a 报）
 */
function readOnlyReport(names, read) {
  const problems = []
  const okList = []
  for (const file of names) {
    const src = read(file)
    if (src === null) continue
    const { found, unresolved } = literalGitSubcommands(codeOf(src))
    const uniq = [...new Set(found)]
    const outOfList = uniq.filter(s => !READ_ONLY_SUBCOMMANDS.has(s))
    if (uniq.length === 0 && unresolved === 0) {
      problems.push(`${file}（核不到任何**字面** git 调用 ⇒ 无法证明只读，默认拒绝）`)
    } else if (unresolved > 0) {
      problems.push(`${file}（${unresolved} 处 argv 不可静态解析 ⇒ 无法证明只读，默认拒绝）`)
    } else if (outOfList.length > 0) {
      problems.push(`${file}（子命令不在只读白名单：${outOfList.join(', ')}）`)
    } else {
      okList.push(`${file}: ${uniq.join('/')}`)
    }
  }
  return { problems, okList }
}

const files = readdirSync(TESTS).filter(f => f.endsWith('.mjs')).sort()
const readSrc = (f) => readFileSync(join(TESTS, f), 'utf8')
/** 读数面自检（防"扫描面失效 → 空扫描报绿"）：这些文件**必须**被认出来，否则判据本身坏了。
 *  ⚠ 名单**含 `verify-review-fixed-point.mjs`**（它走挂具、不直接 spawn git）——
 *  正是用来钉住"接挂具 ⇒ 掉出观测面"那个盲区不回退的反向自检（见 `USES_HARNESS_CALL` 的注）。
 *  #169 另追加 `verify-isolated-git.mjs` 作**金丝雀**：它是全仓最重的 git 夹具文件（机制面、
 *  属 @slow 层）—— 判据若看不见它，说明观测面坏了（**响亮**，不报假绿）。
 *  ⚠ 本文件任何一行（**含注释续行**）都不得写出「行首 `*` + 空白 + `@slow`」的形状：
 *    E15/E16 的全文件朴素扫描分不清标记与注释（快集首跑就抓到本注释自己的初稿，扰动
 *    复现读数 `.scratch/verify169/e16-nonhollow.log`）—— 初稿那行写的是
 *    "机制面、@slow）——"，行首恰好是标记形状，E15/E16 双双真红。 */
const MUST_MATCH = [
  'verify-all-entry.mjs', 'verify-precommit-hook.mjs', 'verify-restore-discipline.mjs',
  'verify-batch-state.mjs', 'verify-review-fixed-point.mjs', 'verify-privacy-scan.mjs',
  'verify-isolated-git.mjs',
]
const SKIP = new Set([
  'isolated-git.mjs',        // 挂具自己不是夹具用例
  'verify-isolated-git-structure.mjs', // **本文件**：判据的持有者，不扫自己（自引用）—— 与 #110
                             // 原始理由同形。#169 拆层实测这条对**结构文件依然成立**（对机制
                             // 文件则不成立，它已回到观测面）：本文件的判据 regex 自带引号字符
                             // （`['"]` 一族），`codeOf` 的朴素引号状态机会被它们打偏，于是
                             // **必须引述禁写形状的文档注释**（上面 HANDROLLED_CLEAN 的说明本身
                             // 就写着 `startsWith('GIT_')`）会成段存活进 code 面 ⇒ 自判
                             // "自写 GIT_* 清理"永久红（拆层当日实测，读数
                             // `.scratch/verify169/selftrip.log` 与 probe-codeof 读数）。判
                             // harness 的文件进不了 REGISTRY（I2a 判"已走挂具"）；为喂饱状态机
                             // 去 scrub 判据 regex / 文档 = 腐蚀判据本体（D15 的反面），不取。
                             // 本文件**无任何运行时 git 执行**（无 child_process import）：
                             // 结构守卫盯的"碰 git 的夹具"在此没有对象；判据自身的正确性由
                             // I2e（判据自检）钉住。
  // #169 拆层后**不再 SKIP** `verify-isolated-git.mjs`：拆层前"不扫自己（自引用无意义）"的
  // 理由已消失 —— 它 import 且**真调用**挂具（I1/I4 走 `fixtureEnv`/`gitIn`），`classify`
  // 判 harness、留在观测面上；它若停止走挂具，I2d 即红（默认拒绝）。MUST_MATCH 里有它的金丝雀位。
])
const matched = []
const audit = []
const offenders = []
for (const file of files) {
  if (SKIP.has(file)) continue
  const src = readSrc(file)
  const kind = classify(file, src)
  if (kind === 'irrelevant') continue
  matched.push(file)
  const handrolled = HANDROLLED_CLEAN.test(codeOf(src))
  const tag = kind === 'harness' ? '✓挂具'
    : kind === 'offender' ? '✗未登记'
    : REGISTRY[file].kind === 'debt' ? '⤼债务' : '✓登记(只读)'
  audit.push(`${file} ${tag}${handrolled ? ' ✗自写清理' : ''}`)
  if (kind === 'offender' || handrolled) offenders.push({ file, kind, handrolled })
}

// ── I2a 登记册一致性（AC4 反向自检：登记在册的文件被删除/改名 → 响亮，不静默放过）──────
const registryNames = Object.keys(REGISTRY)
const readOnlyNames = registryNames.filter(f => REGISTRY[f].kind === 'readOnly')
const debtNames = registryNames.filter(f => REGISTRY[f].kind === 'debt')
const REGISTRY_REPORT = registryReport(REGISTRY, files, (n) => classify(n, readSrc(n)))
if (!REGISTRY_REPORT.ok) {
  bad('I2a. 登记册一致（文件在 / 在观测面 / 未走挂具 / 类目合法 / 有 why / debt 带票号）',
    REGISTRY_REPORT.problems.join(' ｜ '))
} else {
  ok(`I2a. 登记册一致：${REGISTRY_REPORT.total} 条登记逐条有文件、落在观测面上、且都未走挂具`,
    `readOnly ${REGISTRY_REPORT.readOnly} / debt ${REGISTRY_REPORT.debt} —— 删除或改名任何一条登记文件，本行即红`)
}

// ── I2b readOnly 登记的「确实没有自建仓」核对（只读子命令白名单，闭合集）───────────────
const READ_ONLY_REPORT = readOnlyReport(readOnlyNames, (f) => (files.includes(f) ? readSrc(f) : null))
if (READ_ONLY_REPORT.problems.length > 0) {
  bad('I2b. readOnly 登记的文件**确实没有自建仓**（只读子命令白名单）',
    READ_ONLY_REPORT.problems.join(' ｜ '))
} else {
  const notChecked = readOnlyNames.length - READ_ONLY_REPORT.okList.length
  ok(`I2b. readOnly 登记的 ${READ_ONLY_REPORT.okList.length} 个文件逐条核对：字面 argv 子命令全在只读白名单内`,
    READ_ONLY_REPORT.okList.join(' ｜ ') +
    (notChecked > 0 ? `（另 ${notChecked} 条登记的文件不存在、未核 —— 见 I2a）` : ''))
}

// ── I2c 债务逐条**响亮**列出（登记债务不是放行，是记账）──────────────────────────────
for (const file of debtNames) {
  loud(`I2c·债务 ${file}（碰 git、未走挂具、已登记）`, REGISTRY[file].why)
}

// ── I2d 主体：白名单外零放行 ─────────────────────────────────────────────────────────
const missingProbe = MUST_MATCH.filter(f => !matched.includes(f))
if (audit.length === 0 || missingProbe.length > 0) {
  loud('I2d. 结构断言（默认拒绝：碰 git ⇒ 走挂具或显式登记）',
    audit.length === 0
      ? '没扫到任何碰 git 的用例 —— 扫描面失效，**不报假绿**'
      : `判据没认出这些已知碰 git 的用例: ${missingProbe.join(', ')} —— 观测面失效，**不报假绿**`)
} else if (offenders.length === 0) {
  ok(`I2d. 碰 git 的用例全部**走挂具或显式登记**（${audit.length} 个文件；白名单外零放行）`,
    audit.join(' ｜ '))
} else {
  bad('I2d. 有用例**既不走挂具也没登记**（#125 病灶：碰 git 却不声明分类 ⇒ 默认拒绝）',
    offenders.map(o => `${o.file}（${[o.kind === 'offender' && '未登记', o.handrolled && '自写 GIT_* 清理'].filter(Boolean).join(' + ')}）`).join(' ｜ ') +
    ' —— 改成 `import { fixtureEnv } from \'./isolated-git.mjs\'`；确属"只读调用方仓"的，' +
    '在 REGISTRY 里登记 `readOnly` 并写 `why`')
}

// ── I2e 判据自检（**非空洞**，AC5）────────────────────────────────────────────────
// 把判据本身当被测对象：构造违规 / 合规输入，逐条断言 `classify()` 的裁决。
// **合成登记册**：自检不依赖真 `REGISTRY` 的内容（登记册会变，机制不该跟着变）。
// 若有人把判据改回"只认 `init`"，则除"不碰 git"外全部变红 —— 判据自带回归测试。
const SYNTH_REGISTRY = { 'synthetic-readonly.mjs': { kind: 'readOnly', why: '自检用' } }
const SELF_CASES = [
  ['clone 自建仓、未走挂具', "spawnSync('git', ['clone', 'src', 'dst'])", 'unregistered-clone.mjs', 'offender'],
  ['worktree add 自建仓、未走挂具', "spawnSync('git', ['worktree', 'add', '../wt'])", 'unregistered-worktree.mjs', 'offender'],
  ['shell 串自建仓、未走挂具', "execSync('git clone src dst')", 'unregistered-shell.mjs', 'offender'],
  ['异步 spawn 自建仓、未走挂具', "spawn('git', ['clone', 'a', 'b'])", 'unregistered-async.mjs', 'offender'],
  ['异步 execFile 自建仓、未走挂具', "execFile('git', ['worktree', 'add', 'x'])", 'unregistered-execfile.mjs', 'offender'],
  ['只读调用方仓 + 登记在册', "execFileSync('git', ['ls-files'], { cwd: REPO })", 'synthetic-readonly.mjs', 'registered'],
  ['只读调用方仓但**未**登记', "execFileSync('git', ['ls-files'], { cwd: REPO })", 'unregistered-readonly.mjs', 'offender'],
  ['走挂具（代码面 import + fixtureEnv 调用）', "import { fixtureEnv } from './isolated-git.mjs'\nspawnSync('git', ['clone', 'a', 'b'], { env: fixtureEnv() })", 'with-harness.mjs', 'harness'],
  ['import 只写在**注释**里（不算走挂具）', "// import { fixtureEnv } from './isolated-git.mjs'\nspawnSync('git', ['clone', 'a', 'b'])", 'comment-import.mjs', 'offender'],
  ['import 了但**从不调用**（不算走挂具）', "import { fixtureEnv } from './isolated-git.mjs'\nspawnSync('git', ['clone', 'a', 'b'])", 'unused-import.mjs', 'offender'],
  ['**行尾注释**伪装 fixtureEnv()（不算走挂具）', "import { fixtureEnv } from './isolated-git.mjs'\nspawnSync('git', ['clone', 'a', 'b']) // fixtureEnv()", 'trailing-comment.mjs', 'offender'],
  ['**块注释**伪装 fixtureEnv()（不算走挂具）', "import { fixtureEnv } from './isolated-git.mjs'\nspawnSync('git', ['clone', 'a', 'b']) /* fixtureEnv() */", 'block-comment.mjs', 'offender'],
  ['字符串里的 `//` 不吞掉同行真调用', "const u = 'http://x'; spawnSync('git', ['clone', 'a', 'b'])", 'url-string.mjs', 'offender'],
  ['不碰 git', 'const x = 1', 'no-git.mjs', 'irrelevant'],
]
const selfBad = []
for (const [label, src, name, expect] of SELF_CASES) {
  const got = classify(name, src, SYNTH_REGISTRY)
  if (got !== expect) selfBad.push(`${label}：期望 ${expect}，实测 ${got}`)
}
if (selfBad.length > 0) {
  bad(`I2e. 判据自检（${SELF_CASES.length} 条裁决）`, selfBad.join(' ｜ ') + ' —— 判据本身坏了')
} else {
  ok(`I2e. 判据自检：${SELF_CASES.length} 条合成输入的裁决全部符合预期`,
    SELF_CASES.map(([l, , , e]) => `${l}→${e}`).join(' ｜ '))
}
// 纯函数/整条判定自检：把 I2b 与 I2a 的**消费分支**也钉住（第 2 轮复核指出"只测 helper、
// 删掉分支套件仍绿"—— 故这里测的是 registryReport / readOnlyReport 本身的裁决，不是 helper 字段）。
const PURE_CASES = [
  ['字面 argv 可解析', literalGitSubcommands("execFileSync('git', ['ls-files'])"),
    (r) => r.found.includes('ls-files') && r.unresolved === 0],
  ['非字面 argv 记为不可解析', literalGitSubcommands("spawnSync('git', argv)"),
    (r) => r.found.length === 0 && r.unresolved === 1],
  ['**反引号**调用的非字面 argv 也记为不可解析', literalGitSubcommands('spawnSync(`git`, argv)'),
    (r) => r.found.length === 0 && r.unresolved === 1],
  ['spread argv 记为不可解析', literalGitSubcommands("spawnSync('git', [...a])"),
    (r) => r.unresolved === 1],
  ['readOnly 动态 argv ⇒ 有问题', readOnlyReport(['x.mjs'], () => "spawnSync('git', argv)"),
    (r) => r.problems.length === 1],
  ['readOnly 子命令不在白名单 ⇒ 有问题', readOnlyReport(['x.mjs'], () => "execFileSync('git', ['clone', 'a'])"),
    (r) => r.problems.length === 1],
  ['readOnly 字面只读子命令 ⇒ 通过', readOnlyReport(['x.mjs'], () => "execFileSync('git', ['ls-files'])"),
    (r) => r.problems.length === 0 && r.okList.length === 1],
  ['登记缺 `why` ⇒ 不 ok', registryReport({ 'x.mjs': { kind: 'readOnly' } }, ['x.mjs'], () => 'registered'),
    (r) => r.ok === false && r.problems.some(p => p.includes('缺 why'))],
  ['debt 的 why 不含票号 ⇒ 不 ok', registryReport({ 'x.mjs': { kind: 'debt', why: '没有票号' } }, ['x.mjs'], () => 'registered'),
    (r) => r.ok === false && r.problems.some(p => p.includes('票号'))],
  ['debt 的 why 含 #NN ⇒ ok', registryReport({ 'x.mjs': { kind: 'debt', why: '#9 跟踪' } }, ['x.mjs'], () => 'registered'),
    (r) => r.ok === true],
  ['登记类目非法 ⇒ 不 ok', registryReport({ 'x.mjs': { kind: 'nope', why: 'y' } }, ['x.mjs'], () => 'registered'),
    (r) => r.ok === false && r.problems.some(p => p.includes('类目'))],
  ['登记文件不存在 ⇒ 不 ok', registryReport({ 'gone.mjs': { kind: 'readOnly', why: 'y' } }, [], () => 'registered'),
    (r) => r.ok === false && r.problems.some(p => p.includes('不存在'))],
  ['登记已走挂具 ⇒ 不 ok（逼摘牌）', registryReport({ 'x.mjs': { kind: 'readOnly', why: 'y' } }, ['x.mjs'], () => 'harness'),
    (r) => r.ok === false && r.problems.some(p => p.includes('已走挂具'))],
  ['登记看不见碰 git ⇒ 不 ok', registryReport({ 'x.mjs': { kind: 'readOnly', why: 'y' } }, ['x.mjs'], () => 'irrelevant'),
    (r) => r.ok === false && r.problems.some(p => p.includes('看不见'))],
]
const pureBad = PURE_CASES.filter(([, input, holds]) => !holds(input))
if (pureBad.length > 0) {
  bad(`I2e·纯函数自检（${PURE_CASES.length} 条）`, pureBad.map(([l]) => l).join(' ｜ '))
} else {
  ok(`I2e·纯函数自检：${PURE_CASES.length} 条按预期判定`,
    '字面/非字面（含反引号）/spread argv ⇒ 不可解析；readOnly 三态；登记册六种红路径逐条可判')
}
// 与**旧判据**（#110 的"只认 init"）对照：前五条输入在旧判据下**判不出 offender**（假绿面），
// 而本票的判据能判出（I2e 主体逐条断言）。⚠ 本行只证明"旧判据漏、新判据不漏"；"把真判据改回去
// 会长红"由 I2e 主体承担（改回只认 init ⇒ 除"不碰 git"外全部红；扰动读数 .scratch/p125-nonhollow-B.log，
// 按本仓"扰动证据落 .scratch、套件内由 I2e 承担回归"的惯例）。
const OLD_CREATES_REPO = /(?:['"`]init['"`])/
const oldVerdict = (src) => {
  const code = codeOf(src)
  return SPAWN_GIT.test(code) && OLD_CREATES_REPO.test(code)
}
const oldMissed = SELF_CASES.slice(0, 5).filter(([, src]) => !oldVerdict(src))
if (oldMissed.length === 5) {
  ok('I2e·对照. 五条自建仓违规（clone / worktree / shell 串 / 异步 spawn / 异步 execFile）在**旧判据**下判不出 offender',
    '旧判据漏掉的正是这五条 —— 加宽它只是把"下一个写法"往后推一格（D15）；"改回去会长红"由 I2e 主体担保')
} else {
  bad('I2e·对照. 旧判据对照失效',
    `旧判据只漏了 ${oldMissed.length}/5 条 —— 自检输入或旧判据形态变了，复核本节点`)
}

// ══ I3: 挂具自检 —— 守卫别守着一个坏的挂具 ═══════════════════════════════════════
{
  const probe = 'GIT_DIR'
  const saved = process.env[probe]
  process.env[probe] = '<sentinel>'
  for (const v of CALLER_GIT_VARS) process.env[v] = `sentinel-${v}`
  try {
    const env = fixtureEnv()
    const left = Object.keys(env).filter(k => k.startsWith('GIT_'))
    // ① 继承的 GIT_* 必须**一个不剩**（不只是表里那 8 个 —— 任何漏网变量都可能改变夹具里 git 的行为）
    if (left.length === 0) {
      ok('I3a. `fixtureEnv()` 清掉**全部**继承的 `GIT_*`（不只是 CALLER_GIT_VARS 那 8 个）',
        `注入 ${CALLER_GIT_VARS.length} 个哨兵 + GIT_DIR → 残留 0 个`)
    } else {
      bad('I3a. `fixtureEnv()` 有 `GIT_*` 漏网', `残留: ${left.join(', ')} —— 漏网变量仍会把夹具指向调用方仓`)
    }
    // ② 覆盖项必须**仍然生效**（清完再合，顺序错了会把刚给的配置一起删掉）
    const withOverride = fixtureEnv({ GIT_CONFIG_GLOBAL: join(tmpdir(), 'x') })
    if (withOverride.GIT_CONFIG_GLOBAL !== undefined) {
      ok('I3b. `fixtureEnv()` 的覆盖项生效（清完再合，不被同一次清理吃掉）',
        `GIT_CONFIG_GLOBAL = ${JSON.stringify(withOverride.GIT_CONFIG_GLOBAL)}`)
    } else {
      bad('I3b. `fixtureEnv()` 把调用方给的覆盖项也清掉了', '顺序反了 —— 先清、再合')
    }
    // ③ `gitIn` 必须**用 `-C`** 而不是 `cwd:`（本机 startup 脚本族会把 cwd 静默复位）
    // ⚠ 判据只看**代码面**（`codeOf` 剥注释）：初版在整份源码上找 `cwd:`，实测被挂具自己注释里
    //   那句"不要用 spawn 的 `cwd:`"判红 —— 判据读的是**措辞**而不是行为（本仓 §3.1 的形态）。
    //   剥注释再匹配，与 R7 的"剥注释"同法；`codeOf` 是同一份实现（不另写一份剥法）。
    const hSrc = readFileSync(join(TESTS, 'isolated-git.mjs'), 'utf8')
    const hCode = codeOf(hSrc)
    const usesC = /'git',\s*\[\s*'-C'/.test(hCode)
    const usesCwd = /cwd\s*:/.test(hCode)
    if (usesC && !usesCwd) {
      ok('I3c. `gitIn` 用 `git -C <dir>` 定位仓库（判据只看**代码行**，不读注释措辞）',
        'cwd: 在本机会被 startup 脚本族静默复位 → 夹具命令打到调用方仓')
    } else {
      bad('I3c. `gitIn` 未用 `-C`，或代码里引入了 `cwd:`',
        `用 -C: ${usesC} / 出现 cwd:: ${usesCwd} —— ` +
        '本机 startup 脚本族会复位子进程 cwd（#110 的另一条同族通路）')
    }
  } finally {
    for (const v of CALLER_GIT_VARS) delete process.env[v]
    if (saved === undefined) delete process.env[probe]
    else process.env[probe] = saved
  }
}

console.log('\n=== ISOLATED-GIT STRUCTURE VERIFY (I2-I3) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)

