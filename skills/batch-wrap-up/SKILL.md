---
name: batch-wrap-up
description: >
  Batch-end wrap-up card（批末收口卡）。Loads the propose_action eligibility for
  the batch_wrap_up kind (#182 / ADR-0017 §4 axis B): present the batch end ONCE
  as one card — or, when the card service is absent, as the prose wrap section
  with the SAME five sections. Load this skill ONLY at a batch end (after the
  summary gate, before the push confirmation); never per ticket. Card absence
  is declared loudly (S3), never silently skipped.
argument-hint: "[<批次标识>]"
license: MIT
---

# Batch Wrap-Up Card（批末收口卡）

批末收口的**呈现层**：一批一张卡（或等构正文段），五段结构两形态同构
（换载体不换内容）。本 skill 只是 `propose_action` 的前置装载件——装载后
工具面出现 `propose_action` 才有卡形态；收口卡是可选增强，缺席不构成
工作流回归（ADR-0017 §4）。

## 何时装载

仅当**批末**（summary gate 之后、push 确认之前）。单票模式没有批末收口。
一回合一卡（上游不变量）——收口回合只 propose 一次，绝不逐票出卡。

## 形态判定（显式，绝不静默 — S3 降级必声明）

1. **ptc 档** → 正文形态，写一行声明（卡工具在 ptc 恒不可激活：skill
   装载由 code 派发，上游机制事实）。
2. **装载本 skill 后查工具面**：`propose_action` 可见 → **卡形态**。
3. `propose_action` 不可见（personalized-recommendations 服务被禁用/未装
   ——默认安装集携带但默认不启用），或调用被拒（排队消息达
   `queuedMessageLimit`、本回合已出过卡）→ **正文形态**，且先写响亮降级行：
   「收口卡缺席（<原因>）——降级为正文收口段」，随后正文内联五段。

## 五段结构（两形态同构；顺序固定）

1. **DELIVERED** — 本批落了什么：每票一行，带三证据要素
   （命令 → exit code → 证据路径）。**分支留档票（`wip/<票号>-<slug>`）不计入
   本批收官数**——其工作不进批末 CI（修正案），resume 并复验后才回到收官数。
   **委派完成聚合**（#177/轴 D）并入本段：批内 subagent 委派的完成，一委派一行
   （做了什么、验证、证据路径）——长跑期间不逐条插播。
2. **L0 LEDGER** — 本批全部 L0 自决，每条一行 "decided X because Y"，
   供人一眼审计；空清单也写成显式一行「（无 L0 自决）」，绝不静默。
3. **OPEN** — 攒下的 L1 题在这里**一次问清**（本卡就是 L1 的阶段边界落点）；
   每题走 grill contract 四件套；未答的攒批问题绝不静默丢弃。
4. **D21 PENDING** — 待确认外部动作清单，固定顺序：summary gate → CI 全绿
   → 再确认 push（该顺序正典，#179 §6②——绝不倒置）。批末 CI 红时，
   **commit 边界二分的结果在这里呈现**（肇事票 + 其证据）再确认重推；
   积压护栏触发的 checkpoint 带计数呈现（10 未推票或 3 天）。本段只
   **呈现**清单，**不承载确认**——每个 D21 确认仍是会话内的门 6 事件，
   收口卡不新建确认点。
5. **SESSION↔PR BINDINGS**（#178 Q2）— 本批每个已推分支 → 其 PR/change
   request 一行，**只写本批自己的 push 记录能确认的**；无法确认的绑定如实写
   unconfirmed，绝不猜。forge-session 服务（Host 侧）从同一批 shell 结果派生
   同样绑定，但 agent **没有该投影的模型侧读取面**（上游事实：绑定从不进模型
   请求、无模型工具）——两者的对照由 human 在 forge 面板完成；本段不得声称
   agent 执行不了的 mismatch 核对。

## 卡形态的调用契约

`propose_action` 一次调用，参数：

- `action`: `"batch_wrap_up"`（固定值）
- `title`: 「批末收口 · <批次标识>」
- `brief`: **五段全文**（每段以段名开头，空清单写显式空行说明）。本 kind
  不随卡分发浏览器 body 行——卡帧折叠长 brief、展开可见全文，brief 就是
  唯一呈现面，五段一字不省。
- `details`: 五个可选数组字段（值必须是字符串数组；缺省段落省略键）：
  - `delivered`: 第 1 段逐票/逐委派行；
  - `l0Ledger`: 第 2 段自决行；
  - `openQuestions`: 第 3 段问题行；
  - `d21Pending`: 第 4 段外部动作行；
  - `forgeBindings`: 第 5 段绑定行。

卡在回合结束后出现在答案下方，用户不动作则什么都不执行。卡上的唯一动作
是 Not now（本 kind 无自定义动词——D21 确认留在对话流）。之后照常在对话里
走 summary gate → CI → push 确认的既有流程。

## 批末状态面（随卡/随正文呈现，语义不变）

- 分支 WIP 票不进批末 CI，也不计入本批收官数（修正案：分支留档不污染二分归因）；
- 批末 CI 红时，commit 边界二分结果在第 4 段呈现（肇事票 + 证据）再确认重推；
- 积压护栏 checkpoint 行（10 未推票或 3 天）在收口里带计数重申。
