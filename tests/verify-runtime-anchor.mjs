/**
 * verify-runtime-anchor.mjs —— 挂具运行时锚点守卫（#88 的 D47 面）。
 *
 * 为什么存在（2026-10-17 本仓亲历的假绿）：`scripts/link-runtime-deps.mjs` 只在**被运行时**
 * 才重指 junction。如果没人跑它，`tests/node_modules/@deepseek-ai` 可以一直指着**另一个检出**
 * （当时指着 rc.2 的第二个检出），于是整个套件打在**旧契约**上——照样全绿。D47：防线缺席必须
 * 响亮。这里把「锚点正确」变成**套件里的一条**，不依赖任何人记得跑接线脚本。
 *
 * R0  比较器非空洞自检（拿旧锚必须判为不等——否则 R2 永远绿）
 * R1  包表在场且能解析（整表缺失 → loud skip：套件别处会以 ERR_MODULE_NOT_FOUND 响亮，别加噪音）
 * R2  **harness 的 dsh-llm 版本 == package.json 声明的宿主锚**（假绿的唯一判据）
 * R3  抽查的运行时包，链接必须**指向可解析的真实路径**（悬空链接会让 preset 行 `never started`；
 *     #88 实测 `dsh-tool-ralph` 就是这种）
 * R4  `yaml` 能解析（插件与测试都 `import 'yaml'`）
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// 派生规则（`0.2.1-rc.1-r1` → `0.2.1-rc.1`）的**唯一实现**在 scripts/runtime-anchor.mjs ——
// #34 起此处不再手抄一份正则（手抄的副本是漂移的种子，D4/D6）。
import { anchorOf } from '../scripts/runtime-anchor.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
const TABLE = join(REPO, 'tests', 'node_modules', '@deepseek-ai')
const rel = (p) => p.slice(REPO.length + 1).replace(/\\/g, '/')

const results = []
const ok = (n, d = '') => results.push('  ✓ ' + n + (d ? ' — ' + d : ''))
const bad = (n, d = '') => results.push('  ✗ ' + n + (d ? ' — ' + d : ''))

/** `0.2.1-rc.1-r1` → `0.2.1-rc.1`；实现见文件头 import 的 runtime-anchor.mjs。 */

/** 读某个包表的 package.json 版本；读不到返回 undefined。 */
const versionOf = (table, name) => {
  try {
    return JSON.parse(readFileSync(join(table, name, 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

const declared = anchorOf(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version)
const harnessLlm = versionOf(TABLE, 'dsh-llm')

// ── R0: 比较器非空洞 ────────────────────────────────────────────────────────
const oldAnchor = anchorOf('0.2.0-rc.2-r1')
if (declared !== undefined && oldAnchor !== undefined && oldAnchor !== declared) {
  ok('R0. anchor comparator is non-vacuous', `0.2.0-rc.2-r1 -> ${oldAnchor} != ${declared}`)
} else {
  bad('R0. anchor comparator degenerate', `declared=${declared ?? '?'} old=${oldAnchor ?? '?'} —— R2 会永远绿`)
}

// ── R1: 包表在场 ────────────────────────────────────────────────────────────
if (harnessLlm === undefined) {
  console.log(`SKIP (loud) — harness @deepseek-ai table absent/unreadable (${rel(TABLE)}); 跑 node scripts/link-runtime-deps.mjs --runtime <含 node_modules/@deepseek-ai 的目录> 补齐。套件其余项会以 ERR_MODULE_NOT_FOUND 响亮。`)
  console.log('\n=== RUNTIME-ANCHOR VERIFY RESULTS ===')
  console.log(results.join('\n'))
  process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)
}
ok('R1. harness @deepseek-ai table resolves', rel(join(TABLE, 'dsh-llm', 'package.json')))

// ── R2: 锚点一致（假绿判据） ────────────────────────────────────────────────
if (harnessLlm === declared) {
  ok('R2. harness anchor matches the declared host anchor', harnessLlm)
} else {
  bad(
    'R2. harness anchor mismatch —— 套件打在错的契约上（D47：静默通过视为缺陷）',
    `declared=${declared ?? '?'} harness=${harnessLlm}；跑 node scripts/link-runtime-deps.mjs --runtime <src> 重指`,
  )
}

// ── R3: 抽查包链接指向可解析的真实路径 ──────────────────────────────────────
const SAMPLE = [
  'dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop',
  'dsh-agent-default-model', 'dsh-agent-preset', 'dsh-agent-preset-registry', 'dsh-persona',
  'dsh-commands', 'dsh-subprocess-local', 'dsh-token-meter', 'dsh-session-projection',
  'dsh-session-projection-cache', 'dsh-session-persistence-jsonl', 'dsh-storage',
  'dsh-storage-json', 'dsh-storage-domain', 'dsh-workspace', 'dsh-tool-subagent',
  'dsh-tool-subagent-control', 'dsh-workflow-ptc', 'dsh-ptc-runtime-node', 'dsh-tool-workflow',
  'dsh-web-app', 'dsh-working-directory', 'dsh-tool-working-directory', 'dsh-tool-ralph',
  'cordis-plugin-loader', 'cordis-plugin-group', 'cordis-plugin-include',
]
const unresolved = []
for (const name of SAMPLE) {
  try {
    realpathSync(join(TABLE, name))
  } catch {
    unresolved.push(name)
  }
}
if (unresolved.length === 0) ok('R3. every sampled runtime package link resolves', `${SAMPLE.length} packages`)
else bad('R3. dangling/unresolvable package links', `${unresolved.join(', ')} —— 悬空链接会让 preset 行 never started`)

// ── R4: yaml ────────────────────────────────────────────────────────────────
const yamlVersion = versionOf(join(REPO, 'tests', 'node_modules'), 'yaml')
if (yamlVersion !== undefined) ok('R4. yaml resolves under tests/node_modules', yamlVersion)
else bad('R4. yaml missing under tests/node_modules', "插件与测试都 import 'yaml'，缺它整片红")

console.log('\n=== RUNTIME-ANCHOR VERIFY RESULTS ===')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('  ✗')) ? 1 : 0)