# 0001 — Matt 模式挂载定时任务执行器（scheduled-jobs）

Status: accepted

Matt 模式需要一个"cron 类似的插件"来定时跑技能同步（`sync-skills.sh`）等任务。我们决定在 matt preset 里挂载一个 `scheduled-jobs` 插件：任务以 agent.cordis.yml 行式配置（每任务 = cron 表达式 + 命令 + 可选 `notifyOnFailure`/`notifySessionId`/`runOnMount`），cron 表达式用 `cron-parser` 库解析（装在 `~/.dsh/node_modules` 用户自有目录，不碰部署包），单一分钟 tick 驱动，配 `jobs_list`/`jobs_run`/`jobs_pause` 三个模型工具；第一个任务是每天 09:00 跑 `sync-skills.sh`（`runOnMount`，失败时通知显式配置的会话）。

## Considered Options

- **系统 cron（WSL）** — 守护进程已在运行，但它是非插件的宿主机制：结果不进 DSH 视野、无会话通知、也违背"插件"的直觉。
- **复用 dsh-schedule** — 它是会话级提醒（模型建 `schedule_create`、到点 `followup()` 递话给 live 会话的 agent），`every_seconds` ≥ 5 分钟、无 cron 表达式、冷会话不投递——解决不了"宿主级定时跑 shell 命令"。保留为提醒领域的现成路径，本插件不装它。
- **内置迷你 cron 解析器** — 被否：用户选择完整 `cron-parser` 语法（`?`、`L`、`W`、名称等），零依赖方案只覆盖 `* , - /` 子集。

## Consequences

- 调度器随 preset 的 standing mount 存活（DSH 运行且用过该模式期间）；DSH 未运行时任务不跑——技能同步恰好只在使用 DSH 时有意义。
- 编辑 agent.cordis.yml 换代：新会话/新挂载用新配置，已加入的会话保留旧代——可能短暂新旧两个调度器并存，`sync-skills.sh` 幂等（全量镜像），重复运行无害。
- cron 按宿主进程本地时区求值；`jobs_pause` 状态仅存于内存（重启丢失）；`notifyOnFailure` 必须显式配 `notifySessionId` 才通知，无人时静默记日志。
