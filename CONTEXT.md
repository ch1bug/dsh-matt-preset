# CONTEXT — Matt 工作流模式 · 定时任务设计

单一语境：Matt 工作流模式（`~/.dsh/.agent-presets/matt/`）的配套工具设计。本文是术语表，不含实现细节；已定决策见 `docs/adr/`。

## 术语

- **定时任务 (scheduled job)** — 按时间表执行的 shell 命令；有副作用，结果记录进 DSH。当前第一个用例：技能同步（`sync-skills.sh`）。与"提醒"的边界：任务**执行命令**，提醒**递话给 agent**。
- **提醒 (reminder)** — `dsh-schedule` 的领域：到点把一段话递给某个 live 会话的 agent（`followup()` 开新轮）。会话级、模型建、冷会话不投递、`every_seconds` ≥ 5 分钟、无 cron 表达式。
- **系统 cron** — WSL 宿主 cron 守护进程（本机已在运行，systemd 正常）；不依赖 DSH 进程，恒常可跑。
- **job-runner 插件** — 拟在 matt preset 挂载的定时任务执行器（形态待访谈确定）。
- **standing mount** — preset 的常驻挂载，随 DSH 进程存活（首个会话加入时创建）；它存续期间插件可在进程内跑定时器。
- **~~两阶段 bootstrap（two-phase bootstrap）~~（已废弃，见 D17）** — 曾试验：会话首轮按内置 minimal 预设裁剪（单行 persona + bash + str_replace_editor、输出封顶 1024），首个持久化工具调用后 promote 到全量。理据（上游 dsh-anchored-standard 系）不适用于本部署的模型面，2026-08-18 实测后取消。
- **完整人设 persona** — persona（系统提示词）直接承载完整 ask-matt 工作流文本（{{model}}/{{cwd}} 渲染时插值）；不再有独立 workflow section（D18）。
- **handoff 首条提示词** — handoff 文档作为子会话的**第一个 user 消息**投递（`followup()` 立即触发首轮）；子会话随即非 blank、侧边栏立即可见。与旧"文档注入（inbox 合成上下文）"是两种机制。
- **工作区初始化（workspace initialization）** — 会话早期对无 CONTEXT.md 的 cwd 做自主探测（git/docs/语言信号），建 CONTEXT.md 骨架（"未初始化"标记 + 已核实事实）与空 docs/adr/；只做本地非破坏性步骤，领域决策与外部系统（issue tracker）仍问人。
- **进度快照（progress snapshot）** — 强制 setup 打断流程前写往 `.scratch/progress.md` 的当前进度摘要（状态/决策/指针），防压缩丢失。

- **外部动作门（external-action gate）** — WORKFLOW ENFORCEMENT 第 6 门：外部可见/难恢复的动作（push 公开仓库、提第三方 issue/PR、发版、删数据、重置数据库、强推）必须先报告结果再等确认。细节清单在插件（默认 + 项目 workflow-gates.yml 增删），persona 只留锚点（D21）。
- **纠正沉淀（correction sedimentation）** — 收到用户纠正时当场提出写入点（事实/偏好 → 项目 CONTEXT.md/AGENTS.md；流程 → matt 决策），用户点头才写，防止同类错误反复（D22）。
- **workflow-enforcer（提醒注入插件）** — 独立 repo 的 cordis 插件：每 turn 经 system-prompt/assemble 注入基线提醒，监听 tool/call 对高危动作即时追加提醒；不硬拦截（human in the loop）（D23）。
- **workflow-gates.yml** — 项目根的高危动作清单文件（external/destructive 两组），存在时替代插件默认清单；插件 config 可增删默认项。
- **票据出口（TICKET EXIT）** — 元规则：任何技能会话结束前，把产出物中可执行但不属于当前会话范围的工作转成票（gh issue create）写入待办；当前会话只做一件事，绝不顺手吞额外工作（D24）。
- **会话成本模型** — 每会话成本 = 系统提示词（全局缓存≈1/10 价，拆票不受影响）+ 会话内增量（前缀缓存，越走越便宜）+ 冷启动 prefill（零缓存）+ 事实核查（handoff 精简导致的重查）+ 交接读写；最优拆票粒度 = 总成本最小（D25）。
- **缓存感知拆票** — 拆票判据加一条：与相邻票共享的知识越多越倾向合（省冷启动与核查），独立面越大越倾向拆；尺子 = 一个窗口（wayfinder 100K 先例）。（D25）
- **handoff 快照化** — 交接文档固定带"环境事实快照"段（分支/工作树/关键文件状态/已确认决策/下一步），新会话一条命令验证快照而非重建上下文（D26）。
- **persona 低频变更** — persona 每改一次 = 全部会话系统提示词缓存失效；工作流规则改动攒批、低频落地（D27）。
## 已核实的环境事实

- cron 守护进程运行中；DSH 内 bash 可联网（github.com 可达）。
- `cordis-plugin-timer`（`ctx.timeout/interval/debounce/throttle`，随 fiber 释放）可用于插件内定时。
- `dsh-schedule` 已作为包存在但当前部署未挂载（本会话无 `schedule_*` 工具）。
- 宿主组成（base/web.cordis.yml）不可改：任何新能力只能进 preset 层。

- `npm install --prefix ~/.dsh` 会按 ~/.dsh/package.json 重建 node_modules——曾误删 cron-parser/luxon（2026-08-19，装 yaml 时）。现 ~/.dsh/package.json 固定 cron-parser/luxon/yaml 三个依赖；装新依赖务必显式列全或先读 package.json。
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
- **D12（2026-08-18，访谈 R5）** — ~~matt preset 挂**两阶段 bootstrap**（照梁神配置）~~ —— **已被 D17 取代**。
- **D13（2026-08-18，访谈 R5）** — ~~**persona 拆分**：行内 = 单行 persona；完整 ask-matt 文本 = 独立 matt:workflow section~~ —— **已被 D18 取代**。
- **D14（2026-08-18，访谈 R5）** — handoff_tool 改造：mode 收敛 **`fork`（带历史）| `fresh`（无历史）**，默认 `fork`；文档 = 子会话**首条 user 提示词**（followup 立即触发首轮，替代 inbox 注入）。
- **D15（2026-08-18，访谈 R5）** — **删除 `/clear`** 命令及其插件；"全新会话"走 GUI New Session（hero-chip 可选手动选 preset）。
- **D16（2026-08-18，访谈 R6）** — **工作区自主初始化**：会话早期无 CONTEXT.md 时自主探测并建骨架（Q1A/Q2A/Q3A）；实现载体 = 人设 INITIALIZATION 段（Q4A）；issue-tracker 缺失只顺带提一次，需用到 tracker 技能时**先存 .scratch/progress.md 进度快照再强制 setup**（Q5/Q6A）。
- **D17（2026-08-18，实测后）** — **取消两阶段 bootstrap**：梁神模式（tool-bootstrap.mjs）仅对 DeepSeek V4 Pro 有效，对其他模型（含 V4 Flash）是副作用；恢复全量输入表面（全部工具、全部 prompt section、默认呈现）。实现：删除 agent.cordis.yml 的 tool-bootstrap 行与 tool-bootstrap.mjs 文件。
- **D18（2026-08-18）** — **完整 ask-matt 人设并入 persona（系统提示词）**：既然无 phase 1 特判，persona 拆分失去理由——删除 matt-workflow 插件与 md，工作流全文（含 INITIALIZATION 段）直接作为 persona text（{{model}}/{{cwd}} 插值已用渲染冒烟验证）。
- **D19（2026-08-19，访谈）** — **工作流强制约束（WORKFLOW ENFORCEMENT）**：persona 加四个硬 gate——① 任务入口路由（非琐碎任务首轮先分类并声明/启动对应流程）；② implement 前置（无 CONTEXT.md 决策/docs/adr/spec/tickets 产物不写大改代码，先提议 to-spec/to-tickets 并等确认）；③ 决策边界（真决策必须停下问人，不许替人决定）；④ 阶段声明（跨阶段一句话声明 + 流程技能加载先跑前置检查）。实现载体 = persona 文本（档位 1）；技能本体不改——`sync-skills.sh` 每次全量重拷会覆盖本地改动，前置检查以 persona 形式声明（档位 2 等效）；档位 3（插件级 gate）留作后手。**（2026-08-19 下午修订，依据 IRIS 会话复盘：250 次工具调用 0 次 ask_user_question、验证重置数据库未先确认、AGENTS.md 冷启动规则事后才查——③ 补"破坏性/高成本操作（重置数据库/删数据/强制 push）执行前必问 + 会话早期必读并遵守 AGENTS.md/CLAUDE.md"；④ 补"每阶段一句话开场"。）**
- **D20（2026-08-19）** — **一轮会话一个 issue（ONE ISSUE PER SESSION）**：persona WORKFLOW ENFORCEMENT 加第 5 门——一个会话只做一个 issue/票 + 其验证；同根因紧密批次（如 #395/#396）算一个单元但需入口声明；handoff/队列带多个时只做第一个，完成后把其余 handoff 到新会话，禁止同会话连续处理下一 issue；新发现 issue 只建票留给后续会话，不内联修。依据：IRIS 11:39 会话单会话处理 #400→#397→triage→#401→#402→#398→#399，违反 MAIN FLOW 3 的 one ticket per fresh session。 **（2026-08-19 晚修订：单票 + 可核验并入三条件——当前票完成 / 关联声明 / 实测窗口健康（context evidence）；Continue 仅限 phase 内，不跨任务。依据观察 O2。）**
- **D21（2026-08-19，grill）** — **外部动作门（WORKFLOW ENFORCEMENT 第 6 门）**：外部/破坏性动作执行前必须"验证完 → 报告 → 等确认"。触发条件 = 动作的可逆成本与外部可见性（不列穷举清单）。依据：mimo-agent-tools 收录未经确认直接 push 公开仓库 + 提第三方 PR/issue（skill-fuzzy #1863/#1864、mimo #1865/#1866 全部关闭）。
- **D22（2026-08-19，grill）** — **纠正沉淀**：收到用户纠正 → 当场提出写入点（事实/偏好 → 项目 CONTEXT.md 或 AGENTS.md；流程类 → matt 决策记录），用户点头才写；不做自动大改文档。依据：IRIS 两次纠正（重置数据库成本、tickflow 降级链）无沉淀、反复再犯。
- **D23（2026-08-19，grill）** — **workflow-enforcer 插件**：独立 repo（ch1bug/dsh-workflow-enforcer），提醒注入（不硬拦截）；repo 自带 cordis.patch.yml（可 dsh plugin add 装全局）+ matt preset 行引用同一文件（单源）；persona 的 WORKFLOW ENFORCEMENT 精简为每门一句话锚点，细节（高危清单等）进插件；注入 = 每 turn 基线 + 高危 tool/call 后即时追加；状态机 B 登记 issue 待分析。节奏：本地实现 → 挂载 matt → dsh-src 测试环境（3090）验证 V1–V4 全过 → 报告确认 → 上生产 + 推 GitHub → 稳定后收录 awesome。 **（2026-08-19 晚修订：应用户要求并回 preset 仓库——dsh-matt-preset 内置 workflow-enforcer.mjs 相对路径引用，独立 repo 由用户删除；plugin add 全局安装方案弃用，scope 过滤保留为防御。）**
- **D24（2026-08-19，grill）** — **票据出口（TICKET EXIT）**：任何技能会话结束前，把产出物中可执行、但不属于当前会话范围的工作转成票（gh issue create）写入待办；当前会话只做一件事，绝不顺手吞额外工作。依据：18 个工作流技能审计——仅 wayfinder/prototype 有专属产出规则，code-review（findings 报完即止）、research、improve-codebase-architecture、triage、tdd、grilling 等 14 个断点靠人设 D20 兜底效果差；一条元规则统一覆盖。
- **D25（2026-08-19，grill）** — **会话成本模型与缓存感知拆票**：每会话成本 = 系统提示词（全局缓存，拆票不受影响）+ 会话内增量（前缀缓存）+ 冷启动 prefill（零缓存，拆票 = N 次）+ 事实核查 + 交接读写；最优拆票粒度 = 总成本最小——拆太细 = N×(冷启动+核查+交接)，拆太粗 = compact/handoff lossy + 前缀缓存全失效。规则：尺子 = 一个窗口（wayfinder 100K 先例，扩展到执行类票）；缓存感知（与相邻票共享知识越多越倾向合）；执行期水位（tokenMeter 黄/红线）语义 = 规划失败检测信号 + 复盘输入，不是兜底（handoff = lossy 不可常态化）。依据：IRIS 会话 40k 事件/1400 steps/2-4 次 compaction 的大票 + 新会话起手式重查环境（事实核查成本）。 **（2026-08-19 晚修订：黄/红线比例定为 70%/90%——按物理 contextWindow 计算，config 可调；质量退化点 smart zone 靠方向 2 工作量分析提前兜底。）** **（2026-08-19 收敛注记：成本模型保留为定性认知——会话成本来自冷启动/事实核查/lossy，用于理解"边界处该问什么"；70/90 水位、缓存感知公式、100K 尺子降级为参考，不实现传感器，见 D29。）**
- **D26（2026-08-19，grill）** — **handoff 快照化 + 起手式标准化**：交接文档固定带"环境事实快照"段（分支 / 工作树残留 / 关键文件状态 / 已确认决策 / 下一步），新会话一条命令（git log+status+branch+快照对照）验证而非重建上下文；起手式命令集写入交接模板。治"handoff 精简 → 新会话事实核查成本"。
- **D27（2026-08-19，grill）** — **persona 低频变更**：persona 每改一次 = 所有会话系统提示词缓存失效（全量重 prefill）；工作流规则改动攒批、低频落地，避免一天改 N 次。依据：08-19 连续 5 次 persona 改动（D18/D19/D20/D21-23/精简）。
- **D28（2026-08-19，grill）** — **起手式工作量分析与阻碍 bug 处理**：① 方向 2——会话入口（起手式）对任务清单做**工作面分类**（problem class，如"封口函数的外部调用点"算一类统一完成），≥2 个不同工作面 → 提醒用户拆票（不自动拆）；按命中计数（≥2 条）判据被否。② 方向 3——发现阻碍 bug：自动立阻碍票（TICKET EXIT 一致性）；按阻塞程度决定优先（完全阻塞→停下处理；可绕行→记录+继续）；按深度决定修法（小 bug 本会话 inline 修+立票记录；深 bug 新会话修，当前任务快照暂停）；修完**回本会话**继续（快照恢复，不重复付交接成本）；代码快照默认 **git WIP（不丢）**，丢弃是用户决策。 **（2026-08-19 收敛注记：保留为定性规则——入口问一句"这活一个窗口装得下吗"、发现阻碍 bug 立票并按深度处理；判据阈值（≥2 类/steps 数）降级不量化，见 D29。）**
- **D29（2026-08-19，收敛）** — **停止机制堆叠，量化降级为定性**：matt 的 PHASE-BOUNDARIES 明言边界判断是 judgement call，价值在"按顺序问"，不在精确测量。收敛：① **保留行为规则**——D20 一会话一 issue、D21 外部动作门、D22 纠正沉淀、D24 票据出口、D26 交接快照、D27 低频变更；② **量化项降级为定性参考（不实现传感器）**——D25 的 70/90 水位 / 缓存公式 / 100K 尺子、D28 的工作面判据阈值，一律回到"边界处问一句：够不够下个 phase 装（~150k）"；③ workflow-enforcer 保持现状（基线 + 高危即时提醒），方向 1/2/3 的自动化实现**不做**，除非实测 IRIS 真实出问题再针对补一条规则；④ persona 不再加第七门（TICKET EXIT 作为规则保留在 CONTEXT，需要时一句话并入）。依据：两阶段 bootstrap 教训（机制堆叠→实测→删除）+ 本日连续 5 次 persona 改动（D27 自我警示）。
- **D30（2026-08-19）** — **INITIALIZATION 扩展：init 同时建 AGENTS.md 骨架**（对齐 Codex init 心智：init 建行为指南、setup 补 tracker）。骨架阶段若 AGENTS.md/CLAUDE.md 都不存在 → 创建最小 AGENTS.md（"## Agent skills"：matt 工作流一句话 + CONTEXT.md/docs/adr 指针 + tracker 待 setup 占位）；存在其一则不建（沿用 setup 的"绝不双建"规则）。CONTEXT.md（领域）+ AGENTS.md（行为）= 完整初始化双骨架。

详见 [docs/adr/0001-scheduled-jobs.md](docs/adr/0001-scheduled-jobs.md)。

## 观察记录（2026-08-19，IRIS ef2ef0b5 会话复盘）

- **O1 — D21 口头豁免倾向**：用户预先授权（"完成提交推送"）被 agent 当作对**连带动作**（push 含跨会话遗留 #415/ADR-0022 的 4 commits）的永久授权——D21 的"报告→等确认→执行"压缩为"授权依据→执行→报告"。⚠ 提醒真实注入（机制 ✓），但 agent 跳过"等确认"。
- **O2 — 无实测时的跨任务继续倾向**：会话在**无上下文实测（纯估算 70-90k）**时，建议列表默认倾向 Continue **做下一票 #418**（任务边界），仅把 /handoff 标为"推荐"。两层问题：① 估算代替实测（context evidence 未覆盖"用户主动问评估"场景，机制晚一拍）；② **Continue 偏好侵蚀任务边界**——PHASE-BOUNDARIES 的"Continue 优先"是 phase 内规则，被误用为"跨任务继续"（D20 边界）。

- **O3 — 完成定义缺远程 CI**：IRIS 会话完成定义 = 本地验证 + 推送 + issue 关闭，缺"远程 CI 通过"（AGENTS.md 第 44/72 行有 CI 规则但 agent 未执行）→ CI 连续 6 次失败无人察觉，用户发现后 agent"顺手修"（trivial 豁免）。根因：完成定义没延伸验证边界。处置：persona 加 DONE 定义（本地+推送+CI 绿；CI 红=当前票未完成，修复须声明）+ enforcer push 后追加 CI 提醒。

- ✅ O3 处置：persona DONE 定义（验证含远程 CI）+ enforcer push→CI 提醒（V9）。
- **O4 — 流程技能未加载**：IRIS triage #428（16:35）按人设一句话 + AGENTS.md 自行分诊，未加载 triage 技能（skill 工具零调用）——OUT-OF-SCOPE/AGENT-BRIEF/状态机细节全被跳过。根因：persona 只对 grilling 写了强制加载。处置：gate 4 补"执行流程技能必须先加载 SKILL.md"。

- ✅ O4 处置：gate 4 补"流程技能必须先加载 SKILL.md"。
- **smart zone 认知修正**：Matt 的 100K（AI Engineer Podcast 2026 workshop）是针对 Claude 系（Claude Code 1M 窗口）的经验值；本地技能 150K 是更早版本。依据 quadratic attention 退化悬崖，但悬崖位置**模型相关**——deepseek-v4-flash 不适用 Claude 的经验数字。处置：persona 概念化（不写死数字，标注模型相关）；context_status 实测驱动判断。

- ✅ smart zone 概念化（persona 不写死 150K，标注模型相关）。
## 构建状态
- ✅ 已升级 DSH 0.1.0-rc.7 → **rc.8**（2026-08-19，A 方案接受现状）：依赖包几乎零源码改动；matt 套件（verify 17 + enforcer V1–V9 + production + persona）全绿；mimo TTS/ASR 闭环 + wsl-bridge win_ls 冒烟通过；生产 3080 与测试 3090 均运行 rc.8。
- ✅ 规则类实现一次落地（D27 攒批）：persona 第 7 门 TICKET EXIT（D24+A4+B4 并入）；handoff-tool.mjs 附环境快照模板段（D26）；验证全绿。
- 🛑 已按 D29 收敛：量化仪表盘降级为定性参考，停止机制堆叠；规则类（D20/21/22/24/26/27）保留。
- 📝 2026-08-19 晚 grill：会话边界与成本模型讨论记录（D24–D27 + 断点清单）→ docs/workflow-session-boundaries.md。

- ✅ `scheduled-jobs.mjs` 已实现并挂载（`job-sync-skills` 行）；cron-parser 装在 `~/.dsh/node_modules`（用户自有，含 luxon）。
- ✅ 挂载验证全绿（真实 rc.7 运行时，15 项）：`standingKeyFor`、三工具注册、`runOnMount` + tick 实际触发、`jobs_pause` 停火、`jobs_run` 暂停中可跑、恢复。
- ✅ 两阶段 bootstrap + handoff 首条提示词改造已实现并验证（15/15）：handoff 子会话创建 + 文档作为首条 user 消息 + workspace attach + `/clear` 已移除。
- ✅ 工作区自主初始化（INITIALIZATION 段）已写入 matt-workflow.md；handoff child 的 model 路由修复已实现并验证（16/16，含 `child carries the model route` 断言）。
- ✅ 17/17 全套验证重跑全绿（track A handoff 子会话 + 文档首条提示词 + model 路由；track B 全量失败不归咎自定义行；track C jobs 全套；track D workspace attach）。
- ✅ 文案一致性修复：preset.yml 描述去除已删的 `/clear`（对齐 D15）；`notifySessionId` 已填真实会话 id（matt-session-7a5993c2-f65c-453c-896c-042d90f5b658，对齐 D9/D10）。
- ✅ 已发布为 GitHub 公开仓库 ch1bug/dsh-matt-preset（preset.yml + agent.cordis.yml + 插件 + tests/，按 dsh-agent-presets 规范；notifySessionId 仓库版留空，会话 id 不外泄；tests 改为仓库相对路径并全绿）。
- ✅ 测试服务器已部署：http://127.0.0.1:3090（DSH_HOME=/home/bh4gxf/dsh-src/.dsh-test，隔离数据根 + 符号链接同一 ~/.dsh/.agent-presets，读取全部修复后的文件；生产 3080 未动）。
- ✅ 已按 D17 取消两阶段 bootstrap：删除 tool-bootstrap 行与文件，persona / matt-workflow / handoff-tool / README / NOTICE / verify 同步清理；验证 17/17 仍绿。
- ✅ 已按 D18 把完整人设并入 persona（删除 matt-workflow 插件与 md）；新增 tests/verify-persona.mjs（{{model}}/{{cwd}} 渲染插值冒烟）全绿。
- ✅ 已按 D19 在 persona 加 WORKFLOW ENFORCEMENT 四个硬 gate（入口路由 / implement 前置 / 决策边界 / 阶段声明）；技能本体未改（sync 覆盖），前置检查以 persona 形式声明。
- ✅ workflow-enforcer 已并回 preset 仓库（原独立 repo 由用户删除）；挂载行改相对路径 ./workflow-enforcer.mjs；源码环境验证全绿（verify-production 5/5 + V1-V5 6/6 + matt track B/C）。
- ✅ 已按 D20 加 ONE ISSUE PER SESSION（第 5 门）：一轮会话一个 issue，多任务由 handoff 链推进。
- ⏳ 待人工步骤（GUI 实测，可在 3090 测试实例上做）：触发 handoff_tool，确认子会话首轮自动开始、无 {{model}} 报错、侧边栏立即可见；新开会话感受 WORKFLOW ENFORCEMENT 生效。
