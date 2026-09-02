# 0003 — 沙箱批跑（SANDBOX BATCH MODE）：Y 车道、票据审计与 PR 收口

Status: accepted

## Context

human 观察 IRIS backlog：大量 `ready-for-agent` 票是机械票（#588 截断日志、#581 同源恒等、#580 口径统一、#447 预留列接线），现行"一票一会话 + 批末人工确认"节奏对这类票是纯开销；同时 coding plan 夜间配额闲置，human 提出夜间 yolo 放量、"尽可能增加 token 利用比例"。

前置事实：

- (a) 官方 LSP 三件套已与本机 DSH 0.1.1-rc.2 精确配对装入 web profile（见 2026-09-01 调研）；
- (b) sandcastle 0.12.0 PoC 全链路通过：podman 沙箱内 DSH headless 完成"改文件 → commit → merge-to-head"（试验仓 sandcastle-poc，commit 7c18bc9）；
- (c) ADR-0002 的 Actions 分钟经济（2000/月 曾 90%）：push 频率必须克制；
- (d) 社区方案调研收敛出同一组决策：nightshift（夜间队列+digest）、mergetrain（gated train 串行收口）、Ralph Loop（fresh context 反复进场）、afk 插件（non-overlapping units + one PR per unit，同出 Matt Pocock grilling 血统）。

## Decision

**三车道 + 发射钥匙**：

- **Y（yolo，无人值守）**：`audit-ticket.mts` 机械审计（ready-for-agent 标签 / body 长度 / AC 关键词 / 验证命令 / touch-set / 禁区词）→ verdict=launch **且编排者补写判词** → `run-ticket.mts --yolo` 才发射（审计记录是发射钥匙，缺判词拒发）。
- **合并门 = 编排者在同一沙箱 exec 审计点名的验证命令**（exit code 说话，不信 worker 自述）；大 diff 先 simplify。`branch` 策略 + 波次（3–5）本地串行合并 + 批末一次 push（延续 ADR-0002 分钟经济）；PR-per-unit（`--pr --auto-merge`）仅在 CI 配额宽裕仓库启用。
- **B（现行 batch）/ H（ready-for-human）**：不变。
- **禁区降级**：正文命中 migrations / money-path / governance 等禁区词 → 机械判 demote，回白天 batch 车道。
- **worker 上下文注入**：task 前固定注入项目 principles/gotchas 摘要（`.sandcastle/worker-context.md`）。
- **出口证据四件套**：审计记录 + commit SHAs + 验证 exec 输出 + 沙箱运行日志。

即 afk 插件的设计格言："human judgment at the edges, agents in the middle"——人的角色从逐票守门变为**发射前审计判词 + 收口后 digest/PR 抽查**。

## Consequences

- 夜间放量前置条件：一次通过率 >80%（第一晚 3 票校准）；provider 配额错误 = 停止信号（persist 队列，非重试信号）。
- 机械审计可被措辞绕过——编排者判词是必要条件而非充分条件；深模块重构 / 治理 / money-path 票永不进 Y。
- `copyToWorktree` 在 Windows 宿主不可用（spawn cp ENOENT）——票据文件走"先 commit 进分支"。
- podman machine 资源是并行度上限（2GiB 只够 1–2 并行；放量前 `podman machine set` 扩容）。

## Amendment（2026-09-02）：四级门禁命名对齐 + 检查点/看门狗（吸收 dsh-punky-swarm 之设计，不引其引擎）

调研 [dsh-punky-swarm](https://github.com/Punky971210/dsh-punky-swarm)（0.3.6，582 测试，AGPL-3.0-only）后，
采纳其三个概念、拒绝引入其引擎本体（AGPL 传染 + peer 只到 0.1.1 未验证 0.1.2-alpha + 19-20 工具的
重量级面）。命名对齐其四级门禁，便于与社区语境互通：

| punky 术语 | 我们的实现 | 载体 |
| --- | --- | --- |
| Entry Gate | 票据审计（发射钥匙：verdict=launch + 编排者判词） | audit-ticket.mts + run-ticket --yolo 校验 |
| Plan Contract | AC 可判定 + touch-set 声明 + 验证命令点名 | 审计记录三声明 |
| Exit Gate | 编排者亲自 exec 验证命令 + ticket-audit 收口审计 | run-ticket --verify（同沙箱 exec） |
| Complete | 波次串行合并 + 批末一次 push 过 summary gate | night-run.mts + 七门 |

新增机制（落在模板脚本，非引擎）：

- **检查点续跑**：每票完成即写 `.sandcastle/state/<id>.json`（status/commits/verify/log）；
  `night-run.mts` 按队列幂等推进（已 merged/pr 自动跳过），崩溃/中断重跑同一命令即从断点继续。
- **墙钟看门狗**：`--max-minutes`（AbortSignal）每票上限，超时 = parked-timeout，夜间不烧整晚。
- **配额熔断**：provider 配额/认证错误 = 停止信号（persist 队列，exit 2），非重试信号。
- **清晨 digest**：`.sandcastle/digest/<stamp>.md` 逐票状态 + 抽查/收口提醒。
- **进程级崩溃隔离**：night-run 逐票 spawn run-ticket 子进程，单票崩不伤队列。
