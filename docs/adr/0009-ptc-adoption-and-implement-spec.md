# 0009 — PTC 采纳面与 implement-spec 复评（#39 合并拍板）

Status: accepted（2026-10-16，human 拍板，triage 会话落盘；合并关闭 #27/#26 评估线 → #39）

## Context

#39 合并两项评估的拍板：#27（PTC 模式）与 #26（上游 implement-spec）。
评估结论（2026-10-09 报告，.scratch 报告文件已不在工作副本，以票面摘要为
准）：PTC 批量验证循环全面占优（98s/9 步 vs 517s/37 步），小任务持平；
implement-spec 全量 port 被 sandcastle 覆盖且后者更严。

工作流插件化系列（#54–#59，2026-10-16）已把 PTC 部分实质化：PTC = DSH 沙箱
Node 程序执行形态（dsh-ptc-runtime-node / dsh-workflow-ptc），同一工作流以
preset/profile 适配（#56 ptc profile），七门语义不变。

## Decision

1. **PTC 采纳面**：不进默认路径；作为独立执行形态引入——
   dsh-ptc-runtime-node（执行形态）+ dsh-workflow-ptc（插件），matt 工作流经
   #56 的 ptc profile 适配挂载，七门语义零改动。
2. **PTC 依赖基线（human 修正，2026-10-16）**：**matt 工作流与 shell-host 是
   两个独立插件，不得默认用户具备 shell-host**——PTC profile 必须基于默认
   路径改出，不依赖 shell-host 在场；shell-host 用户的迁移路径由 shell-host
   侧主导，不属于本 preset 的 PTC 适配义务。
3. **implement-spec 复评**：维持 ADR-0005「不 port 全量」（sandcastle 覆盖其
   能力且更严）；**采纳两点**——「workflow 干跑预检」（补票间语义冲突维度）
   与 frontier 概念（ready frontier 点名入编排词汇）。

## Gotchas（评估实测，收入 CONTEXT.md D41）

- `plugins` 覆盖 = **整体替换**：patch overlay 只叠加非 plugins 字段，覆盖
  plugins 会产出 pending 残缺 entry——挂载组合必须走单源 patch 文件合并。
- workflow 编排面 `agent()` 的 model 覆盖必须 **provider+model 成对传**；
  编排面内 agent **不可再嵌套**；schema 子集保持浅层。

## Consequences

- #56（PTC profile）实现时的注入文本不得引用 shell-host 概念；PTC 适配
  验收 = 默认路径 preset 挂 dsh-workflow-ptc 可独立工作。
- 干跑预检 + ready frontier 已独立建票跟踪：**#61**（enhancement，待分诊定
  实现载体——sandcastle 模板侧或 workflow 插件编排侧，按 #54–#59 插件化落地
  后的形态选点）。
- #17（spawn_teammate 模型路由）与本 ADR 的 agent() 覆盖通路互补，不受影响。
