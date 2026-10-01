# 0005 — /implement-spec 暂不采用（与 D20 一票一会话的取舍）

Status: accepted（2026-10-01，human 拍板"按建议来"）；**2026-10-01 修订**：
复评触发条件已被 ADR-0006 pilot 部分满足——上游 implement-spec 的流水线形态
经 Agent Teams 在会话内复刻成功（票 grain 降至 teammate 任务、决策仍在
human），见 ADR-0006。本 ADR 对**上游 /implement-spec 技能本身**的"暂不
采用"维持不变；其流水线思想由 ADR-0006 的 Teams 形态承接。

## Context

上游 mattpocock/skills 在主流程 step 3 新增 `/implement-spec`：整 spec 一跑——
tickets 当任务图，implementer 子代理并行消费 ready frontier，落在单一集成分支，
最后对集成分支跑一次 /code-review。盘点上游差距时发现我们从未路由它，也从未
记录这是有意还是遗漏。

## Decision

**暂不采用**。本 preset 的构建粒度维持 D20（ONE ISSUE PER SESSION：一票一个
fresh implement 会话 + 其验证，会话间经 handoff 交接）。理由：

- implement-spec 的"并行 frontier + 单集成分支"与 D20 的"逐票 fresh 上下文 +
  每票独立验证"在会话粒度上互斥；D20 是 IRIS 实证教训（单会话连做 7 票翻车，
  CONTEXT.md D20/O2/O5）换来的硬约束。
- 并行编排需求已有载体：有界 fan-out 用 dsh-tool-workflow，无人值守整批用
  sandcastle Y 车道（ADR-0003，票据审计 + 检查点 + 合并门），都比整 spec
  单分支编排更符合"human judgment at the edges"。

复评触发条件：若未来出现"spec 规模大到逐票会话交接成本压过收益"的实证，或
上游 implement-spec 进化出与 per-ticket 验证兼容的形态，再开 ADR 重议。

## Consequences

- 镜像保留 implement-spec 技能盘（不删除），persona 不路由；未来复评零成本。
- 上游 ask-matt 刷新时需人工剔除/保留该分歧（见接入票）。
