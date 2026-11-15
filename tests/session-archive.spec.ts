// @ts-nocheck —— 本仓无 tsconfig/type 面（判据核心为 tests/*.mjs，无 .d.ts）；
// vitest 只转译不查型，此标注仅为避免任何未来 typecheck 工具误扫本文件。
//
// session-archive.spec.ts —— #195 票面证明入口（AC6）：
//   npx vitest run tests/session-archive.spec.ts
//
// **薄入口**：本文件零判据（D6：判定点重复——不另写第二份）。判据核心与快集入口是
// **同一个** tests/verify-session-archive.mjs 的 CHECKS 数组（复审批注①，2026-11-15
// 收口：spec 不被 scripts/verify-all.mjs 拾取曾致批末门对本票双向钉假绿，#180 双入口
// 先例同形态——exports-audit.mjs 头注明文「判据核心与快集入口是同一个…两入口共用」）。
//   - verify-all（快集 + --all）：node tests/verify-session-archive.mjs 逐项跑 CHECKS；
//   - 票面 AC6：本文件把同一 CHECKS 逐项包装成 vitest it（此处的 A0 只包装非空洞门）。
// 扰动真红（AC5「单侧改必红」的实证）见 verify-session-archive.mjs 头注与
// .scratch/verify195/。
import { expect, it } from 'vitest'
import { CHECKS, MIN_CHECKS } from './verify-session-archive.mjs'

it('A0. 判据核心非空洞 —— CHECKS 数量 ≥ MIN_CHECKS，薄入口与快集入口同源同量', () => {
  expect(CHECKS.length).toBeGreaterThanOrEqual(MIN_CHECKS)
})

for (const check of CHECKS) {
  it(`${check.id}. ${check.name}`, async () => {
    await check.run() // 抛错 = 红（与 node tests/verify-session-archive.mjs 同一判据）
  })
}
