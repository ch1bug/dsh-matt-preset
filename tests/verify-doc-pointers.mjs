/**
 * verify-doc-pointers.mjs — 文档**指针完整性**守卫（P1–P6）。issue #48。
 *
 * Why（与 tests/verify-doc-references.mjs 的分工，别做重复的一半）：`verify-doc-references.mjs`
 * （R1–R3，2026-10-17）守的是**带仓内前缀 + 扩展名**的字面引用（`docs/x.md`、`tests/y.mjs`），
 * 它对下面两类**结构上不可见**：
 *   (a) **markdown 相对链接** —— `[文字](target)` 里的 `target` 常常不以仓内前缀开头
 *       （`../tests/x.mjs`、`./foo.md`），且必须**按所在文件目录**解析：本票实测的那条真断链
 *       正是这种——`docs/dsh-runtime-cheatsheet.md` 写 `tests/verify-workflow-profiles-2.mjs`，
 *       按 markdown 规则解析成 `docs/tests/…`，在 GitHub 上是 404，而 R1 的匹配式看不见它
 *       （它扫的是**字面** `tests/…`，恰好命中真实存在的仓根路径 → R1 绿，链接却是坏的）。
 *   (b) **行内 code 的"路径形"引用** —— 文档用 `` `docs/adr/` `` 这类 token 指路（无扩展名，
 *       R1 的 `\.(md|mjs|…)` 尾锚不匹配）；其中真有指向不存在路径的。
 * 因此本用例是 R1–R3 的**补集**，不是替代：一个守字面引用，一个守链接与路径形 token。
 *
 *   P1 markdown 相对链接按所在目录解析后**全部存在**；缺失即红并给**双向定位**（文件:行 → 目标）
 *   P2 行内 code 的"路径形"token（含 `/` 且不属任何排除类）全部存在；缺失同上给双向定位
 *   P3 排除表每项**理由非空**（空理由 = 不合规，直接红）——排除是"声明"不是"放宽"
 *   P4 排除表**防腐烂**：每条排除项必须**仍命中当前树**（陈旧排除项即红）——与 verify-enforcer
 *      V17 双向断言同精神：一张只会放宽的排除表，最后会宽到把真断链也放过去
 *   P4b 声明例外（`ALLOW`，正值允许清单）防腐烂：每条**仍被文档引用**且**理由非空**
 *   P5 扫描面自检：**链接数**达阈值 —— 防链接匹配式静默失效
 *   P5b 扫描面自检：**存活 token 数**达阈值 —— 独立判据，防 token 面整片塌掉时被链接数兜住
 *   P5c/P5d 占比面自检：每份文档链接数、存活 token 占比不得**骤降**（抓"半失效"——
 *      绝对值仍过阈值但相对基线已塌；复核 Spec 轴 2026-10-18 指出纯绝对阈值的余量问题）
 *   P6 扫描面自检：文档数达阈值
 *
 * 本仓的排除表只有**一种**：`EXCLUSIONS`（9 类，各带理由）。**判定顺序**（主循环）：先
 * `ALLOW`（声明例外，理由最具体）→ 再 `EXCLUSIONS` 首命中。实测三条 ALLOW 当前**均**会被
 * EXCLUSIONS 命中，故 ALLOW 在现树上是**顺序遮蔽**（删掉它判定结果不变）——但它判的是**不同命题**
 * （"是仓内形状、但语义上不是指针"），且逼出逐条理由并单独防腐烂（P4b），故保留；
 * 复核 2026-10-18 已实测确认这不是漂移点。
 *
 * **非空洞的边界（显式声明，别当成它守住了）**：P3 与 P4b 的"理由非空"两半是**对硬编码字面量**
 * 的断言 —— 没有任何**树变化**能让它们红，只有人手工清空 `why` 才红。它们是**代码评审期的
 * 提醒装置**，不是守卫；真正的守卫是 P1/P2（存在性）、P4/P4b 的**引用面**（仍命中 / 仍被引用）、
 * P5/P5b/P6（扫描面非空）。这条边界由复核 Standards 轴 2026-10-18 指出，按本仓 §3.1「守卫空转」
 * 口径**写明覆盖边界**而非假装守住。
 *
 * 排除的两种形态（本票刻意区分）：**字形排除**（`EXCLUSIONS`，如"含空格 = 命令"）与**声明例外**
 * （`ALLOW`，形状像仓内路径、但文档明确说它不是指针）。后者**不能**退化成字形规则——初版把
 * `presets/matt.patch.yml` 靠 `dir/file.ext` 形状吞掉了，而 `presets/` 是本仓真目录；改成正值
 * 允许清单后，每条例外都得写明**为什么**，并且不再被引用时会自己变红（P4b）。
 *
 * 非空洞（票面 AC 明文）：把任一条指针改成不存在的路径，本用例必须变红。实测见文件末
 * 「NON-VACUITY」注释：`docs/dsh-runtime-cheatsheet.md:140` 那条断链在修复前**确实是红的**
 * （P1 逐条列出双向定位），修掉后转绿。
 *
 * 纯离线：只读工作树 + 一次 `git ls-files`（拿跟踪文件清单，避免 walk 进 `tests/node_modules`
 * 那个 junction —— 实测递归遍历会撞上一堆不存在的嵌套路径并逐条报错）。无网络、无环境变量依赖。
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** 仓内跟踪文件清单（正斜杠相对路径）。用 git 而不是 walk：`tests/node_modules` 是指向
 *  dsh 安装的 junction，递归遍历会走进一个大量嵌套路径不存在的镜像树（实测满屏 ENOENT）。
 *  "是不是仓内文件"本来就该由**索引**回答，而不是由文件系统回答。 */
const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean)
const trackedSet = new Set(tracked)

/** 扫描面（票面第 1 条）：仓级三份 + `docs/**`。目录存在性也认（指针常指向目录）。 */
const SCAN = tracked.filter(f => /^(AGENTS|README|CONTEXT)\.md$/.test(f) || /^docs\/.*\.md$/.test(f)).sort()

/** 目标存在判定：目录也算存在（`docs/adr/` 这种指针是合法的）。
 *  用 `existsSync` 而不是 `trackedSet`：ADR 里会指 `.githooks/` 一类**已跟踪但目录形态**的路径，
 *  以及 gitignore 之外的实在文件；`trackedSet` 只含文件，会把目录误判成缺失。 */
const exists = (rel) => trackedSet.has(rel) || existsSync(join(REPO, rel))

/**
 * 行内 code token 的**排除表**：每项 = 匹配式 + **理由串**（P3 要求非空）。
 * 口径（票面第 3 条）：只有「含 `/` 且不属任何排除类」的 token 才被当作仓库指针。
 * 排除不是放宽 —— 每一项都写明"为什么这个字形不是仓内指针"，且 P4 会验证它**仍命中当前树**。
 */
/** 声明例外（**正值允许清单**，与 tests/verify-doc-references.mjs 的 `ALLOW` 同惯例）：
 *  这些 token 有**仓内顶层的形状**（`presets/`、`lang-packs/` 确实是本仓目录），因此**不能**靠
 *  字形排除（那会把"看着像包 subpath"的真指针一起放掉——2026-10-18 初版实测：`pkg` 规则靠
 *  `dir/file.ext` 形状连 `presets/matt.patch.yml` 一起吞了）。它们各自有**明确理由**：
 *  - `presets/matt.patch.yml`：D50 记载它**因 `config.id` 与第一档重名被撤掉**（注册表 `Duplicate
 *    agent preset` 会整包拒绝挂载），文档提到它是**历史陈述**，不是指针。
 *    （`presets/matt{-ptc,-minimal,-cordis}.patch.yml` 存在，故它确实是"历史上曾有、现已删"。）
 *  - `lang-packs/go.yml` / `python.yml`：`docs/lang-enforcer.md` §未来语言在教「**新增**一个 pack」，
 *    是**待创建**文件（`verify-doc-references.mjs` 的 ALLOW 同两条、同理由）。 */
const ALLOW = new Map([
  ['presets/matt.patch.yml', 'D50 记载该文件因 config.id 与第一档重名被撤（注册表 Duplicate agent preset 整包拒绝挂载）—— 文档提及是历史陈述，不是指针'],
  ['lang-packs/go.yml', 'docs/lang-enforcer.md §未来语言在教「新增一个 pack」（detect: go.mod）—— 待创建文件，不是指针'],
  ['lang-packs/python.yml', '同上（教新增 pack: detect pyproject.toml / requirements.txt）'],
])

const EXCLUSIONS = [
  {
    id: 'command',
    test: t => /\s/.test(t),
    why: '命令（含空格）—— `node scripts/verify-all.mjs`、`Remove-Item ./build`；空格是命令的标志，路径里不会出现',
  },
  {
    id: 'var-abs',
    test: t => /^[$~]/.test(t) || /^[A-Za-z]:[\\/]/.test(t) || /^[/\\]/.test(t),
    why: '环境变量 / home / 绝对路径—— `$DSH_HOME/…`、`~/.dsh/…`、`/usr/bin/git`、`C:/msys64`；落点在本机而不在仓',
  },
  {
    id: 'placeholder',
    test: t => /[<>*]|xxx|\{|\}|…/.test(t),
    why: '占位符 / 通配—— `<DSH_HOME>`、`<repo>/…`、`./xxx.mjs`、`dir/**`；本仓 PUBLIC，占位符是**刻意**的写法（AGENTS.md §隐私）',
  },
  {
    id: 'spdx-pkg',
    test: t => /^@[\w-]+\//.test(t),
    why: 'scoped 包名—— `@deepseek-ai/dsh-agent-preset`；那是 npm 包身份，不是仓库路径（无 scoped 前缀的包 subpath 见下一条）',
  },
  {
    id: 'pkg-subpath',
    // 只认**包名形态的顶段**（`dsh-matt-preset/…` 这类无扩展名的裸包名作首段）+ 有扩展名的末段。
    // **不能**写成宽松的 `^[\w-]+/[\w.-]+\.(js|…)$`：那会把 `presets/matt.patch.yml` 一类
    // **真实仓内顶层目录**下的 token 一起吞掉（初版实测就撞上；`presets/` 是本仓真目录）。
    test: t => /^[\w-]+\/[\w.-]+\.(mjs|mts|js|ts|json|yml|yaml)$/.test(t) && t.split('/')[0].includes('-'),
    why: '包 subpath—— `dsh-matt-preset/workflow-core.mjs`、`dsh-matt-preset/x.mjs`；首段是**包名**（带连字符，非仓内目录），指包的 exports 面而非仓库路径',
  },
  {
    id: 'runtime-dir',
    test: t => /^\.(scratch|sandcastle|agent-presets|github)\//.test(t),
    why: '不入仓 / 本仓不存在的运行时侧目录—— `.scratch/`（gitignore，本机状态）、`.sandcastle/`（沙箱批跑的运行时面，同 gitignore）、`.agent-presets/`（落 `<DSH_HOME>`，家目录侧）、`.github/`（**本仓不存在此目录**：ADR-0013 明文本仓不用 CI，该目录从未建立——旧理由串误写成"不入仓"，2026-10-18 复核实测 `Test-Path .github` = False 后更正）',
  },
  {
    id: 'upstream',
    test: t => /^(node_modules|packages|storages|apps|src|lib-|dir)\//.test(t) || /^\/?docs\/upgrade-guide\//.test(t),
    why: '上游 DSH 检出侧路径—— `packages/core`、`storages/`、`node_modules/@deepseek-ai`、`docs/upgrade-guide/`；指的是**上游检出**（`<src>/…`）而不是本仓，本仓无此目录',
  },
  {
    id: 'bare-name',
    // 只有第二半支可能为真：进入本表的 token 已由主循环 `if (!t.includes('/')) continue` 筛过，
    // 故首半支 `!t.includes('/')` 恒假 —— 那是 D12「永假分支」（复核 2026-10-18 实测指出），已删。
    test: t => /(^|\/)[\w.-]+$/.test(t),
    why: '末段不以 `/` 结尾 —— 指"名字"而非"路径"：文档常用 basename 指测试（`verify-live-tool-call.mjs`），或以目录形态（`docs/adr/`）指路；两者都不该被当作"文件必须存在"的断言对象',
  },
  {
    id: 'regex-prose',
    test: t => /[|^]/.test(t) || /[（）、，。：]|经脚本|且含/.test(t),
    why: '正则片段与散文残片—— `^packages/(core|preset|llm)/`、`src/|tests/`、`）、经脚本/`；是叙述里被反引号括住的**语法**，不是指针',
  },
]

/** markdown 相对链接：`[文字](target)`，跳过外链与纯锚点，剥掉 `#fragment`。 */
const MD_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
/** 行内 code：单反引号内的 token（跨行不取—— token 都在一行内）。 */
const INLINE_CODE = /`([^`\n]+)`/g
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i

/** 逐行收集：定位信息（文件:行）+ 目标 + 解析结果。双向定位是票面 AC 明文。
 *  `allTokens` 是**同一趟**收集的、含被排除项的**全量** token —— P4/P4b 的防腐烂判据读它。
 *  刻意**不**在 P4 里重扫一遍：重扫等于把 token 口径写两份（改一处漏一处），
 *  正是本仓 D6「判定点重复」的形状（复核 Standards 轴实测指出）。 */
const linkHits = []
const tokenHits = []
const allTokens = []
const docsSeen = []

for (const doc of SCAN) {
  const text = readFileSync(join(REPO, doc), 'utf8')
  docsSeen.push(doc)
  const dir = posix.dirname(doc)
  text.split('\n').forEach((line, idx) => {
    const at = `${doc}:${idx + 1}`
    for (const m of line.matchAll(MD_LINK)) {
      const raw = m[1]
      if (EXTERNAL.test(raw) || raw.startsWith('#')) continue
      const target = raw.split('#')[0]
      if (target === '') continue
      const resolved = posix.normalize(posix.join(dir, target))
      linkHits.push({ at, raw, resolved, exists: exists(resolved) })
    }
    for (const m of line.matchAll(INLINE_CODE)) {
      const t = m[1].trim()
      if (!t.includes('/')) continue
      // 全量留档**在排除判定之前**：P4/P4b 判的是"排除项还命中不命中当前树"，必须看被排除的那些。
      allTokens.push(t)
      // 声明例外优先于字形排除：两者都"不看存在性"，但 ALLOW 的理由更具体，且 P4b 单独防腐烂。
      if (ALLOW.has(t)) continue
      const hit = EXCLUSIONS.find(e => e.test(t))
      if (hit !== undefined) continue
      tokenHits.push({ at, token: t, exists: exists(t) })
    }
  })
}

// ── P1：markdown 相对链接 ────────────────────────────────────────────────────
const deadLinks = linkHits.filter(l => !l.exists)
if (deadLinks.length === 0) {
  ok('P1. markdown 相对链接全部可解析', `${linkHits.length} 条链接 / ${docsSeen.length} 份文档`)
} else {
  bad('P1. 断链（按所在目录解析后目标不存在）', deadLinks
    .map(l => `${l.at} → ${l.raw}（解析为 ${l.resolved}）`).join(' | '))
}

// ── P2：行内 code 的路径形 token ─────────────────────────────────────────────
const deadTokens = tokenHits.filter(t => !t.exists)
if (deadTokens.length === 0) {
  ok('P2. 路径形行内 code 引用全部存在', `${tokenHits.length} 个 token（排除表 ${EXCLUSIONS.length} 类）`)
} else {
  bad('P2. 路径形引用指向不存在的路径', deadTokens
    .map(t => `${t.at} → ${t.token}`).join(' | '))
}

// ── P3：排除表每项必须带理由 ─────────────────────────────────────────────────
const reasonless = EXCLUSIONS.filter(e => typeof e.why !== 'string' || e.why.trim() === '')
if (reasonless.length === 0) {
  ok('P3. 排除表每项都带理由串', `${EXCLUSIONS.length}/${EXCLUSIONS.length}`)
} else {
  bad('P3. 排除项缺理由（排除是声明，不是放宽）', reasonless.map(e => e.id).join(', '))
}

// ── P4：排除表防腐烂 —— 每条排除项必须仍命中当前树的某个 token ───────────────
// 这正是 V17 的双向断言精神：排除表只会变宽，宽到最后连真断链也放过去。要求"每条都还在
// 干活"（在当前树里至少命中一个真实 token），陈旧的排除项当场变红，逼人删掉它。
// 读的是主循环同一趟收集的 `allTokens`（**不重扫**：重扫即 token 口径两份，D6）。
{
  const stale = EXCLUSIONS.filter(e => !allTokens.some(t => e.test(t)))
  if (stale.length === 0) {
    ok('P4. 排除表无腐烂项（每条仍命中当前树）',
      EXCLUSIONS.map(e => `${e.id}=${allTokens.filter(t => e.test(t)).length}`).join(' '))
  } else {
    bad('P4. 陈旧排除项（已不再命中任何 token —— 删掉它，别留着放宽匹配）',
      stale.map(e => `${e.id}（${e.why}）`).join(' | '))
  }

  // ── P4b：声明例外（ALLOW）防腐烂 —— 同精神，且**每项理由非空** ─────────────
  // 双向：① 允许清单里每条必须**仍被文档引用**（不再被提到的例外该删）；② 理由非空。
  const reasonless2 = [...ALLOW.entries()].filter(([, why]) => typeof why !== 'string' || why.trim() === '')
  const unused = [...ALLOW.keys()].filter(k => !allTokens.includes(k))
  if (reasonless2.length === 0 && unused.length === 0) {
    ok('P4b. 声明例外无腐烂项（每条仍被引用、理由非空）', `${ALLOW.size} 条`)
  } else {
    bad('P4b. 声明例外腐烂或理由缺失',
      [...unused.map(k => `${k}（已不再被文档引用）`), ...reasonless2.map(([k]) => `${k}（缺理由）`)].join(' | '))
  }
}

// ── P5 / P6：扫描面自检（匹配式静默失效时亮红，而不是假绿）──────────────────
// **三条面各自一个阈值**，刻意**不**用一个合计阈值：实测 69 条链接**单独就已超过**任何
// 合计阈值，于是"token 面整片归零"会被链接数兜住、照样全绿 —— 那正是本仓 §3.1「守卫空转」
// 的形态（复核 Standards 轴 2026-10-18 实测指出，初版合计阈值 60 即此病）。
// 阈值口径：**绝对值下限**（防整片归零）+ **相对占比下限**（防"退化到只剩零头"）。
// 复核 Spec 轴 2026-10-18 指出"84→50 不响"的余量问题：绝对值面确实拦不住**半失效**，
// 故补一条**占比面**——链接 / 文档数、存活 token / 全量 token 各须 ≥ 基线占比。
// 占比面自动随文档增长放宽（数值不必手改），只在**骤降**时红。
const LINK_MIN = 50
const TOKEN_MIN = 8
const LINK_PER_DOC_MIN = 1.5   // 实测 69/30 = 2.30；阈值取 ~65%（"半塌"时红，见 P5c 实测）
const TOKEN_RATIO_MIN = 0.025  // 实测 15/498 = 0.030 —— 须**贴近实测**才有覆盖面：
                               // 取 0.015 时，"匹配式只找到 2/3 存活 token"仍会绿（实测 2.4% > 1.5%），
                               // 那条 P5d 就只是 P5b 的同义反复；取 0.025 才能在绝对面仍过时抓住半失效。

const linkPerDoc = docsSeen.length === 0 ? 0 : linkHits.length / docsSeen.length
// 全量 token 含被排除项（`allTokens`），故它随文档稳定增长；存活 token 只占其中很小一撮。
const tokenRatio = allTokens.length === 0 ? 0 : tokenHits.length / allTokens.length

if (linkHits.length >= LINK_MIN) ok('P5. 扫描面自检：链接数达阈值', `${linkHits.length}（≥${LINK_MIN}）`)
else bad('P5. 链接数低于阈值 —— 链接匹配式可能静默失效', `${linkHits.length}（阈值 ${LINK_MIN}）`)

// 独立阈值：token 面自己塌掉时必须自己红（链接仍在也兜不住它）。
if (tokenHits.length >= TOKEN_MIN) ok('P5b. 扫描面自检：存活 token 数达阈值', `${tokenHits.length}（≥${TOKEN_MIN}）`)
else bad('P5b. 存活 token 数低于阈值 —— token 匹配式或排除表可能整片失效（链接数兜不住它）',
  `${tokenHits.length}（阈值 ${TOKEN_MIN}；链接 ${linkHits.length} 仍在，故这是独立判据）`)

// 占比面：抓"半失效"（绝对值仍过、但相对基线已骤降 —— Spec 轴 c3 指出的余量问题）。
if (linkPerDoc >= LINK_PER_DOC_MIN) {
  ok('P5c. 占比面：每份文档链接数未骤降', `${linkPerDoc.toFixed(2)}（≥${LINK_PER_DOC_MIN}）`)
} else {
  bad('P5c. 每份文档链接数骤降（绝对值可能仍过阈值）', `${linkPerDoc.toFixed(2)}（阈值 ${LINK_PER_DOC_MIN}）`)
}
if (tokenRatio >= TOKEN_RATIO_MIN) {
  ok('P5d. 占比面：存活 token 占比未骤降',
    `${(tokenRatio * 100).toFixed(1)}%（≥${(TOKEN_RATIO_MIN * 100).toFixed(1)}%）`)
} else {
  bad('P5d. 存活 token 占比骤降（绝对值可能仍过阈值）',
    `${(tokenRatio * 100).toFixed(1)}%（阈值 ${(TOKEN_RATIO_MIN * 100).toFixed(1)}%，全量 ${allTokens.length}）`)
}

if (docsSeen.length >= 20) ok('P6. 扫描面自检：文档数达阈值（≥20）', String(docsSeen.length))
else bad('P6. 扫描到的文档数低于阈值', String(docsSeen.length))

console.log('\n=== DOC POINTERS VERIFY (P1–P6 · issue #48) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)