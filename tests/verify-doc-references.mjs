/**
 * verify-doc-references.mjs — 文档引用腐烂守卫（R1–R3）。
 *
 * Why（邻仓 #93/#94 的同族机械面，2026-10-17 对齐）：文档里的**仓内路径指针**是纯手写的，
 * 文件被改名/删除后没人管 —— 本会话已经手工撞过两条同类（全局 handoff 技能里裸 `#83`、
 * `dev-environment` 里的当日计数）。这里守**机械、零误报**的那一半：`AGENTS.md` /
 * `README.md` / `CONTEXT.md` / `docs/**` 里出现、且带下列仓内前缀 + 扩展名的引用必须存在。
 *
 *   R1 每个带前缀的仓内路径引用都存在（当前实测 0 条死引用）
 *   R2 扫描面自检：见到的引用数 ≥ 20 —— 防"匹配式静默失效"把红变成假绿
 *   R3 扫描面自检：实际扫到的文档数 ≥ 20
 *
 * 为什么**不**守裸文件名（邻仓 #94 那一半）：2026-10-17 勘察本仓 11 个"裸名不存在"候选，
 * **没有一个是烂引用** —— 它们分别是 skill 文件（`~/.dsh/skills/**`）、运行时文件
 * （`.scratch/batch-state.md`、`<DSH_HOME>/…/REGISTRY.md`）、模板示例（ADR 文件名示例）与
 * **历史提及**（`tool-bootstrap.mjs` 已取消的实验）。要守那一面，先得引入"历史提及"标记
 * 约定（邻仓用 `[History: …]`），属另一票；无约定就只会给散文添噪音。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const results = []
const ok = (name, detail = '') => results.push('  ✓ ' + name + (detail ? ' — ' + detail : ''))
const bad = (name, detail = '') => results.push('  ✗ ' + name + (detail ? ' — ' + detail : ''))

const REPO = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['.git', 'node_modules', '.scratch'])

/** 仓内文件索引（相对路径，正斜杠）。 */
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.githooks') continue
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else files.push(relative(REPO, path).replace(/\\/g, '/'))
  }
}
walk(REPO)
const fileSet = new Set(files)

/** 扫描面：仓级三份 + docs/**。 */
const docs = files.filter(f => /^(AGENTS|README|CONTEXT)\.md$/.test(f) || /^docs\/.*\.md$/.test(f))

/** 带仓内前缀 + 扩展名的引用，以及无扩展名的 `.githooks/*` 引用。
 *  负向环视只排除"更长路径的一部分"与 URL/占位符前缀（`\w / . - < > $ % :`）——
 *  **反引号必须在集合之外**：文档里的指针大多写在行内代码里，曾把它排除掉 → 整片引用
 *  静默漏扫（2026-10-17 自检抓到；R2 阈值当时抓不到，因为非行内引用仍够数）。 */
const PATH_REF = /(?<![\w/.<>$%-])((?:docs|tests|scripts|bin|lib|skills|lang-packs|sandcastle|evals)\/[\w./-]*\.(?:md|mjs|mts|js|ts|txt|yml|yaml|json))/gu
const HOOK_REF = /(?<![\w/.<>$%-])(\.githooks\/[\w./-]+)/gu

const refs = new Map()
for (const doc of docs) {
  const text = readFileSync(join(REPO, doc), 'utf8')
  for (const re of [PATH_REF, HOOK_REF]) {
    for (const m of text.matchAll(re)) {
      if (!refs.has(m[1])) refs.set(m[1], [])
      refs.get(m[1]).push(doc)
    }
  }
}

/** 声明例外（可 review 的允许清单，不是放宽匹配）：这些字形**不是仓内指针**。
 *  跨仓引用一律写成 `<repo>/path`（本仓己方则写 `<org>/<repo>/…`），形状上自然不匹配本条守卫
 *  —— 2026-10-17 被抓的两条死引用正是"把跨仓路径写成仓内形态"。 */
const ALLOW = new Map([
  ['lang-packs/go.yml', 'docs/lang-enforcer.md 在教「**新增**一个 pack」（detect: go.mod）—— 待创建文件，不是指针'],
  ['lang-packs/python.yml', '同上（教新增 pack）'],
])

const dead = [...refs.entries()].filter(([ref]) => !fileSet.has(ref) && !existsSync(join(REPO, ref)) && !ALLOW.has(ref))

// R1
if (dead.length === 0) ok('R1. 文档里的仓内路径引用全部存在', `${refs.size} 个引用 / ${docs.length} 份文档（声明例外 ${ALLOW.size} 条）`)
else bad('R1. 死引用（文件已改名或删除）', dead.map(([ref, where]) => `${ref} ← ${[...new Set(where)].join(', ')}`).join(' | '))

// R2：匹配式失效时 refs 会骤降到 0 → 这里亮红，而不是假绿。
if (refs.size >= 20) ok('R2. 扫描面自检：引用数达阈值（≥20）', String(refs.size))
else bad('R2. 引用数低于阈值 —— 匹配式可能静默失效', String(refs.size))

// R3：扫描面本身。
if (docs.length >= 20) ok('R3. 扫描面自检：文档数达阈值（≥20）', String(docs.length))
else bad('R3. 扫描到的文档数低于阈值', String(docs.length))

console.log('\n=== DOC REFERENCES VERIFY (R1–R3) ===')
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('  ✗')) ? 1 : 0)