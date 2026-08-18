# CONTEXT — Matt 工作流模式 · 定时任务设计

单一语境：Matt 工作流模式（`~/.dsh/.agent-presets/matt/`）的配套工具设计。本文是术语表，不含实现细节；已定决策见 `docs/adr/`。

## 术语

- **定时任务 (scheduled job)** — 按时间表执行的 shell 命令；有副作用，结果记录进 DSH。当前第一个用例：技能同步（`sync-skills.sh`）。与"提醒"的边界：任务**执行命令**，提醒**递话给 agent**。
- **提醒 (reminder)** — `dsh-schedule` 的领域：到点把一段话递给某个 live 会话的 agent（`followup()` 开新轮）。会话级、模型建、冷会话不投递、`every_seconds` ≥ 5 分钟、无 cron 表达式。
- **系统 cron** — WSL 宿主 cron 守护进程（本机已在运行，systemd 正常）；不依赖 DSH 进程，恒常可跑。
- **job-runner 插件** — 拟在 matt preset 挂载的定时任务执行器（形态待访谈确定）。
- **standing mount** — preset 的常驻挂载，随 DSH 进程存活（首个会话加入时创建）；它存续期间插件可在进程内跑定时器。
- **两阶段 bootstrap（two-phase bootstrap）** — 会话首轮的输入表面按内置 `minimal` 预设裁剪：单行 persona + `bash` + `str_replace_editor`、无 runtime 上下文、只收直接 user 消息、输出封顶；首个持久化工具调用（或 `promoteAfterFirstResponse`）后 promote 到全量目录与全部 prompt section。理据：minimal 表面复现更高分的 "We/Let's" 思维链、抑制 DeepSeek 的 "Let me" 漂移（上游 dsh-anchored-standard 系）。
- **phase-1 锚点 persona** — 首轮显示的单行 persona（`You are a helpful software engineer assistant.`）；完整 ask-matt 工作流文本在独立 `matt:workflow` section，promote 后恢复。
- **handoff 首条提示词** — handoff 文档作为子会话的**第一个 user 消息**投递（`followup()` 立即触发首轮）；子会话随即非 blank、侧边栏立即可见。与旧"文档注入（inbox 合成上下文）"是两种机制。
- **工作区初始化（workspace initialization）** — 会话早期对无 CONTEXT.md 的 cwd 做自主探测（git/docs/语言信号），建 CONTEXT.md 骨架（"未初始化"标记 + 已核实事实）与空 docs/adr/；只做本地非破坏性步骤，领域决策与外部系统（issue tracker）仍问人。
- **进度快照（progress snapshot）** — 强制 setup 打断流程前写往 `.scratch/progress.md` 的当前进度摘要（状态/决策/指针），防压缩丢失。

## 已核实的环境事实

- cron 守护进程运行中；DSH 内 bash 可联网（github.com 可达）。
- `cordis-plugin-timer`（`ctx.timeout/interval/debounce/throttle`，随 fiber 释放）可用于插件内定时。
- `dsh-schedule` 已作为包存在但当前部署未挂载（本会话无 `schedule_*` 工具）。
- 宿主组成（base/web.cordis.yml）不可改：任何新能力只能进 preset 层。

## 决策

- **D1（2026-08-18，访谈 R1）** — 做**通用 job-runner**：配置驱动的定时任务列表，每任务 = 时间表 + shell 命令；技能同步是第一个消费者。
- **D2（2026-08-18，访谈 R1）** — 挂 **matt preset 插件**（standing mount 生命周期）；不用系统 cron 兜底。
- **D3（2026-08-18，访谈 R1）** — **新建小 job-runner**；`dsh-schedule` 保留为"会话级提醒"的现成路径，本用例不装。
- **D4（2026-08-18，访谈 R2）** — 时间表用 **cron 表达式**（5 段）。
- **D5（2026-08-18，访谈 R2）** — 结果处理：记日志 + 可选 `notifyOnFailure`，不自动重试。
- **D6（2026-08-18，访谈 R2）** — 任务清单以 **agent.cordis.yml 行式配置**（每任务一行）。
- **D7（2026-08-18，访谈 R2）** — 提供模型工具：`jobs_list` + `jobs_run` + `jobs_pause`。
- **D8（2026-08-18，访谈 R3）** — cron 解析用 **cron-parser 库**（装 `~/.dsh/node_modules`，不碰部署目录）。
- **D9（2026-08-18，访谈 R3）** — 失败通知**只发给显式配置的会话**（`notifySessionId`），无默认目标。
- **D10（2026-08-18，访谈 R3）** — 首个任务：每天 **09:00** 跑 `sync-skills.sh`，开失败通知。
- **D11（2026-08-18，访谈 R4）** — 同步任务 **`runOnMount: true`**：新挂载时先跑一次。
- **D12（2026-08-18，访谈 R5）** — matt preset 挂**两阶段 bootstrap**（照梁神配置：`bash`+`str_replace_editor`、`anchorGate`、`bootstrapMaxTokens: 1024`、promote 后 Code Mode）。
- **D13（2026-08-18，访谈 R5）** — **persona 拆分**：行内 = minimal 单行锚点（不带 `complete`，否则锁死唯一 section）；完整 ask-matt 文本 = 独立 `matt:workflow` section（phase 1 剥、promote 恢复）。
- **D14（2026-08-18，访谈 R5）** — handoff_tool 改造：mode 收敛 **`fork`（带历史）| `fresh`（无历史）**，默认 `fork`；文档 = 子会话**首条 user 提示词**（followup 立即触发首轮，替代 inbox 注入）。
- **D15（2026-08-18，访谈 R5）** — **删除 `/clear`** 命令及其插件；"全新会话"走 GUI New Session（hero-chip 可选手动选 preset）。
- **D16（2026-08-18，访谈 R6）** — **工作区自主初始化**：会话早期无 CONTEXT.md 时自主探测并建骨架（Q1A/Q2A/Q3A）；实现载体 = 人设 INITIALIZATION 段（Q4A）；issue-tracker 缺失只顺带提一次，需用到 tracker 技能时**先存 .scratch/progress.md 进度快照再强制 setup**（Q5/Q6A）。

详见 [docs/adr/0001-scheduled-jobs.md](docs/adr/0001-scheduled-jobs.md)。

## 构建状态

- ✅ `scheduled-jobs.mjs` 已实现并挂载（`job-sync-skills` 行）；cron-parser 装在 `~/.dsh/node_modules`（用户自有，含 luxon）。
- ✅ 挂载验证全绿（真实 rc.7 运行时，15 项）：`standingKeyFor`、三工具注册、`runOnMount` + tick 实际触发、`jobs_pause` 停火、`jobs_run` 暂停中可跑、恢复。
- ✅ 两阶段 bootstrap + handoff 首条提示词改造已实现并验证（15/15）：handoff 子会话创建 + 文档作为首条 user 消息 + workspace attach + `/clear` 已移除。
- ✅ 工作区自主初始化（INITIALIZATION 段）已写入 matt-workflow.md；handoff child 的 model 路由修复已实现并验证（16/16，含 `child carries the model route` 断言）。
- ✅ 17/17 全套验证重跑全绿（track A handoff 子会话 + 文档首条提示词 + model 路由；track B 全量失败不归咎自定义行；track C jobs 全套；track D workspace attach）。
- ✅ 文案一致性修复：preset.yml 描述去除已删的 `/clear`（对齐 D15）；`notifySessionId` 已填真实会话 id（对齐 D9/D10；仓库版本默认留空 = 仅记日志，安装后自行填写）。
- ⏳ 待人工步骤（GUI 实测）：触发 `handoff_tool`，确认子会话首轮自动开始、无 `{{model}}` 报错、侧边栏立即可见（host 已于 21:18 重启，web 200 可达）。
