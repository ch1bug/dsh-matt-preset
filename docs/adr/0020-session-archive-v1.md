# 0020 — 会话归档 v1：standing-mount 维护插件（session-archive）

Status: accepted（2026-11-17，#185 拆票链 #195–#198 落地；#198 收口）

## Context

宿主会话列表膨胀（#185 现象：合计 ≈1096 会话后 `handoff` 子会话前端侧边栏不显示，
手动归档旧会话并重启后才出现）。上游归档能力已核实在场（`archiveSession` /
registry-global `archivedSessionIds` 显示层耐久集合、活动拒绝 `WorkspaceActiveSessionError`、
归档同写清 pin）——本仓缺的是「无人值守、按计划把旧会话压回可见集」的定时执行面。

定时执行载体的仓内现状（三分事实，CONTEXT.md「已核实的环境事实」）：`tool-schedule`
行未声明（#117 拍板不回补）；`dsh-schedule` 是会话级提醒（冷会话不投递，解决不了
宿主级定时任务）；`scheduled-jobs.mjs` 已随 #4 / ADR-0001 退役。

## Decision

**standing-mount 维护插件 `session-archive`**（随 preset 分发，`agent.cordis.yml` 行 +
`session-archive.mjs`，默认关）：

- **载体**：cordis-plugin-timer 只当 60s ticker（`ctx.interval`，随 fiber 释放）；
  三频率（每周/半月/每月，宿主本地时区）语义全在 `computeNextRun`/`effectiveSchedule`
  纯函数面——「tick + gate 可承载任意频率」载体判定成立（#197），不引入第二套调度器。
  错过不补多批：补跑窗口每次启动最多消耗一次；单实例互斥（进程内闭包标志）。
- **选择算法**（`selectArchivePlan` 纯函数）：per-workspace 分组 + 「无 workspace」
  虚拟组（散落会话不排除在缓解外），**各自**保底最近 10（无论年龄）；只归档超保留期
  候选（14/30/60/90 天，默认 30）；排除面 pinned/live/subagent/active 判定序命中即止；
  上限护栏 `cap`（默认关，示例 900）组级独立——超限从旧到新补选、绝不破保底。
- **执行**（`executeArchivePlan`）：逐会话单参调 `registry.archiveSession`，**不带
  `stopActivity`**（无人值守不停用户正在做的工作）；活动拒绝记 skipped 继续；归档是
  **显示层**操作——不删除会话日志、不自动取消归档、不自动清理 pinned。
- **配置**：业务配置走文件面 `<DSH_HOME>/storages/session-archive/`（config.json /
  runs.json，重启保持；坏文件 problems 非空 + 默认关兜底）；行 config 只认 `storageDir`
  绝对路径注入缝。**默认关**：首装无 config.json = enabled:false，挂载零副作用。
- **v1 无 UI 触发面**：模块导出面（`createScheduler` 的 runOnce/dryRun）即手动入口，
  **仅在进程内可用**——snapshot 面消费 `synthesizeSnapshot(ctx)`，其依赖的
  `workspaceRegistry` / `sessionQuery` 只在运行中的 DSH 进程内存在：seed 夹具（挂具/
  判据面）消费该导出面；**实机窗口走 tick 排班触发路径**（写 config 排班到临近时刻，
  60s tick 消费 `runs.json` 的 nextRun 到点执行）。DSH 设置页集成属上游协作、另立不并本链。

## 边界（明确不做）

- **不恢复 `scheduled-jobs.mjs` 技能同步任务**（#4 / ADR-0001 退役口径照旧）——会话归档
  与技能同步是两件事，后者无新消费者，不因本票复活；形态考古读 git 历史，内容不复制。
- **不装 `dsh-schedule`**（ADR-0001:26 先例）：会话级提醒冷会话不投递，与本维护任务
  的「宿主级定时 + 直接调 workspace registry」形态不同源。
- **不修上游前端列表分页**：1096 根因归属（上游列表/快照）待实机取证（#198 AC3 清单），
  本插件是**运营缓解**；缺口留档见 `.scratch/verify198/upstream-gap-dossier.md`（立票
  待实机复现证据，human 拍板）。
- 不承诺 DSH 设置页 UI；不改宿主组成（base/web.cordis.yml 不可改，CONTEXT 环境事实）。

## Consequences

- 会话归档随 preset 的 standing mount 存活；DSH 未运行时排班不跑（错过的按补跑口径
  处理，最多一批）。
- 配置/运行记录是机器本地文件（`normalizeConfig` 校验非法值响亮拒绝）；`runs.json`
  的 lastRun/totals/nextRun/events（封顶 50）是运行记录的回读面。
- 量级行为钉在 seed 夹具判据（`tests/verify-session-archive-seed.mjs`：合计 1096
  8 组分布全链路 992/24 对账、全链路毫秒级、cap 组级独立、幂等二轮）；真机前端复现
  与可见性恢复验证留实机窗口（`manual-verification-checklist.md`）。
- 后续若 1096 根因在上游修复（前端分页/快照），本插件降级为可选的卫生维护面，
  默认关的拍板让「关掉零成本」。
