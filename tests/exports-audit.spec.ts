// @ts-nocheck —— 本仓无 tsconfig/type 面（tests/*.mjs 为唯一实现，无 .d.ts）；
// vitest 只转译不查型，此标注仅为避免任何未来 typecheck 工具误扫本文件。
//
// exports-audit.spec.ts —— #180 票面证明入口：
//   node node_modules/vitest/vitest.mjs run tests/exports-audit.spec.ts --project unit
// 判据核心与快集入口（node tests/exports-audit.mjs）是**同一个** exports-audit.mjs ——
// 两入口共用 matcher / audit / 扰动探针，不另写第二份判据（D6：判定点重复）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { anchorOf } from '../scripts/runtime-anchor.mjs'
import {
  AUDIT_FILES,
  MIN_PER_FILE,
  MIN_TOTAL,
  auditFiles,
  exportsKeys,
  faceOf,
  matcherSelfCheck,
  perturbationProbe,
  subpathMatch,
} from './exports-audit.mjs'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')

it('A0. matcher 非空洞 —— 已移除的 /list-agents 判 INVALID，在用键判 VALID', (ctx) => {
  const self = matcherSelfCheck()
  if (self.skipped) return ctx.skip() // 包表缺席：loud skip 口径，与 .mjs 入口一致（复审 #180 意见 1）
  expect(self.ok, self.problems.join('\n')).toBe(true)
})

it('A1–A4. 四载体 + preset-harness 全量审计绿（每条引用在锚定 exports 键内）', (ctx) => {
  const audit = auditFiles()
  if (audit.skipped) return ctx.skip() // 包表缺席：loud skip 口径，与 .mjs 入口一致
  expect(audit.ok, audit.problems.join('\n')).toBe(true)
  // 非空洞门显式复核（audit.ok 已含 A1，这里把读数钉在断言里）
  for (const file of AUDIT_FILES) {
    expect(audit.perFile[file], `非空洞：${file}`).toBeGreaterThanOrEqual(MIN_PER_FILE)
  }
  expect(audit.refs.length).toBeGreaterThanOrEqual(MIN_TOTAL)
  expect(Object.keys(audit.packages).length).toBeGreaterThan(0)
  // A2 独立核对（复审 #180 意见 5：audit.anchor 字段即 declared 本身，断它恒真无意义；
  // 真核对在这里——直接读包表 dsh-llm 的版本与声明锚比）：判据面 == 本仓宿主锚，
  // 重锚后自动跟随，不手抄版本串。
  const declared = anchorOf(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version)
  expect(faceOf('dsh-llm')?.version).toBe(declared)
})

it('A5. 扰动真红 —— 伪造子路径引用 → 红 + 点名；真引用不累及；对照绿', (ctx) => {
  const pert = perturbationProbe()
  if (pert.skipped) return ctx.skip() // 包表缺席：loud skip 口径，与 .mjs 入口一致（复审 #180 意见 1）
  expect(pert.ok, pert.problems.join('; ')).toBe(true)
})

it('matcher 语义钉子 —— 模式键 `*` 跨 `/`、条件映射当 "."、无 exports 字段判 null', () => {
  expect(subpathMatch({ '.': './x.js', './locale/*.json': './l/*.json' }, '/locale/a/b.json')).toBe('./locale/*.json')
  expect(subpathMatch({ types: './x.d.ts', default: './x.js' }, '')).toBe('.')
  expect(subpathMatch(undefined, '')).toBe(null)
  expect(subpathMatch({ '.': './x.js', './tools': './t.js' }, '/nope')).toBe(null)
  expect(exportsKeys('./x.js')).toEqual(['.'])
})
