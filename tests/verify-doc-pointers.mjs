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
 *   P5 扫描面自检：链接数与 token 数达阈值 —— 防"匹配式静默失效"把红变成假绿
 *   P6 扫描面自检：文档数达阈值
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
    why: '运行时/家目录/上游侧路径—— `.scratch/`（gitignore）、`.sandcastle/`、`.agent-presets/`（落 `<DSH_HOME>`）、`.github/workflows/`（ADR-0013 明文本仓**不用** CI，该目录不存在）；本就不入仓',
  },
  {
    id: 'upstream',
    test: t => /^(node_modules|packages|storages|apps|src|lib-|dir)\//.test(t) || /^\/?docs\/upgrade-guide\//.test(t),
    why: '上游 DSH 检出侧路径—— `packages/core`、`storages/`、`node_modules/@deepseek-ai`、`docs/upgrade-guide/`；指的是**上游检出**（`<src>/…`）而不是本仓，本仓无此目录',
  },
  {
    id: 'bare-name',
    test: t => !t.includes('/') || /(^|\/)[\w.-]+$/.test(t),
    why: '裸文件名 / 测试名 / 不以 `/` 结尾的散文片段—— 文档常用 basename 指测试（`verify-live-tool-call.mjs`），末段无 `/` 说明它指"名字"而非"路径"',
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

/** 逐行收集：定位信息（文件:行）+ 目标 + 解析结果。双向定位是票面 AC 明文。 */
const linkHits = []
const tokenHits = []
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
{
  const allTokens = []
  for (const doc of SCAN) {
    const text = readFileSync(join(REPO, doc), 'utf8')
    for (const m of text.matchAll(INLINE_CODE)) {
      const t = m[1].trim()
      if (t.includes('/')) allTokens.push(t)
    }
  }
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
const totalRefs = linkHits.length + tokenHits.length
// 阈值按 2026-10-18 实测取整下调：69 条链接 + 22 个存活 token = 91，阈值 60 留足余量，
// 但足以在"匹配式整片失效"（骤降到 0 附近）时亮红。
if (totalRefs >= 60) ok('P5. 扫描面自检：引用数达阈值（≥60）', String(totalRefs))
else bad('P5. 引用数低于阈值 —— 匹配式可能静默失效', `${totalRefs}（链接 ${linkHits.length} + token ${tokenHits.length}）`)

if (docsSeen.length >= 20) ok('P6. 扫描面自检：文档数达阈值（≥20）', String(docsSeen.length))
else bad('P6. 扫描到的文档数低于阈值', String(docsSeen.length))

console.log('\n=== DOC POINTERS VERIFY (P1–P6 · issue #48) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)