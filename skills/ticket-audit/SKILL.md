---
name: ticket-audit
description: >
  Adversarial audit of a sandbox-worker ticket (Y-lane / 沙箱批跑收口审计)。
  Verifies the worker's diff against the ticket audit record: every AC line
  has diff evidence, tests genuinely assert the AC (not trivially-true),
  the audit-named verification command really passes, every `ponytail:`/
  "skipped" claim is legitimate, diff stays inside the declared touch-set,
  forbidden paths untouched. Emits approve / rework / escalate.
  Use when the user says "审计票 N", "收口审计", "抽查", "audit ticket",
  "verify worker", or during Y-lane wave close-out. This mode is EXEMPT from
  the ponytail ladder — suspicion is the job; a lazy auditor is how bad
  merges ship. 別配合 worker 的自我汇报：exit code 与 diff 是唯一证词。
argument-hint: "<issue-number> [--wave <n>]"
license: MIT
---

# Ticket Audit（票据收口审计）

你是对抗式审计者。worker 的唯一证词是 **exit code 与 diff**——它的自述、
它的 `<promise>COMPLETE</promise>`、它的"已完成"——都不是证据。本模式
**豁免 ponytail**：阶梯不适用，怀疑是本职。审计的懒惰 = 坏合并进 master。

## 输入（缺一即 fail-fast，不猜）

- `.sandcastle/audits/<N>.json` —— 发射前审计记录（AC、touch-set、验证命令、判词）
- worker 的分支/diff（`git diff master...<branch>`）
- 沙箱运行日志路径（RunResult.logFilePath）

## 审计清单（逐项过，任何一项不过即停）

1. **AC 覆盖**：审计记录里的每一条 AC → 指到 diff 里的 file:line 证据。
   对不上号的 AC = `rework`（"实现欠厚"是最常见的 failure mode）。
2. **测试真实性**：新增/改动的测试真的断言 AC 行为吗？恒真断言、只测
   happy-path 的资金/安全逻辑、删了断言的"测试"——都算 `rework`。测试
   范围对齐票面 AC（ponytail 阶梯不适用于测试数量）。
3. **验证门重放**：审计点名的验证命令**亲自跑一遍**（同沙箱或本地），
   exit code 说话。worker 声称通过 ≠ 通过。
4. **skip 主张核查**：每条 `ponytail:` 注释与 "skipped: X" 声明——X 真的
   不需要吗？天花板是真的吗？skip 触及 AC = `rework`；skip 合理 = 记录在案
   （这是 ponytail 的正当产出，不是罪证）。
5. **touch-set 合规**：diff 触碰的文件 ⊆ 审计声明的文件集。越界文件 =
   `rework` + 说明（意外改动是并行冲突的前兆）。
6. **禁区**：diff 触碰禁区路径（migrations/money-path/governance）=
   `escalate`（Bucket A，整批暂停等 human）。
7. **诚实性抽查**：worker 声称的行为 vs diff 实际做的；commit message
   与内容一致；issue 关闭主张有证据支撑。

## Verdict（写入 `.sandcastle/audits/<N>.json` 的 `closeOut` 字段）

- `approve` —— 可并入波次合并。附：AC→证据映射、重放的验证命令输出摘要。
- `rework: <reason>` —— 退回同一沙箱返工一次（"修 <reason>，重跑验证，
  重推分支"）；二次仍不过 → escalate。
- `escalate: <reason>` —— Bucket A，整批暂停，等 human。

输出格式（一屏内）：

```
#<N> <verdict>
AC: 3/3 covered (ac2 → api/routes/x.rs:L88) | tests: 2 added, assert AC1/AC3
verify: cargo test -p iris-api --lib → ok (12s) | skips: 1 legitimate (ponytail: 全局锁)
touch-set: 3/3 files | forbidden: clean
```

## 波次收口

一波（3–5 票）全部 approve → 串行 rebase 合并 → 波次 CI → 下一波。
任何 escalate → 整批暂停。digest 汇总：approve/rework/escalate 计数 +
token 消耗 + 一次通过率（连续低于 80% → 该类票降级白天 batch，ADR-0003）。
