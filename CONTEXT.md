# CONTEXT — Matt 工作流模式 · 定时任务设计

单一语境：Matt 工作流模式（`~/.dsh/.agent-presets/matt/`）的配套工具设计。本文是术语表，不含实现细节；已定决策见 `docs/adr/`。
决策索引每条一行（D1–D57）：叙事细节看被指的 ADR 与 [docs/observations.md](docs/observations.md)（无 ADR 决策的详档 + 观察记录档案；#70 迁出，归档不再更新）。

## 术语

- **定时任务 (scheduled job)** — 按时间表执行的 shell 命令；有副作用，结果记录进 DSH。当前第一个用例：技能同步（`sync-skills.sh`）。与"提醒"的边界：任务**执行命令**，提醒**递话给 agent**。
- **提醒 (reminder)** — `dsh-schedule` 的领域：到点把一段话递给某个 live 会话的 agent（`followup()` 开新轮）。会话级、模型建、冷会话不投递、`every_seconds` ≥ 5 分钟、无 cron 表达式。
- **系统 cron** — WSL 宿主 cron 守护进程（本机已在运行，systemd 正常）；不依赖 DSH 进程，恒常可跑。
- **job-runner 插件** — 拟在 matt preset 挂载的定时任务执行器（形态待访谈确定）。
- **standing mount** — preset 的常驻挂载，随 DSH 进程存活（首个会话加入时创建）；它存续期间插件可在进程内跑定时器。
- **~~两阶段 bootstrap（two-phase bootstrap）~~（已废弃，见 D17）** — 曾试验：会话首轮按内置 minimal 预设裁剪（单行 persona + bash + str_replace_editor、输出封顶 1024），首个持久化工具调用后 promote 到全量。理据（上游 dsh-anchored-standard 系）不适用于本部署的模型面，2026-08-18 实测后取消。
- **完整人设 persona** — ~~persona（系统提示词）直接承载完整 ask-matt 工作流文本（{{model}}/{{cwd}} 渲染时插值）；不再有独立 workflow section（D18）~~——已被 D42/ADR-0010 取代：persona 只留导语句，工作流正文由 workflow-core 插件注入（verbatim-identical）。
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
- **handoff 快照化** — 交接文档的"环境事实快照"段由 tool 生成时自动填 git 探针实值（分支/HEAD + 工作树 status 短读数；探针失败写「探针失败：<原因>」响亮标记，零空壳），新会话一条命令验证快照而非重建上下文（D26；2026-10-31 #168 修订：环境结论禁裸结论等作者内容行移至 handoff_tool 的 document 参数说明，快照段只剩 tool 机械保证的探针行）。
- **persona 低频变更** — persona 每改一次 = 全部会话系统提示词缓存失效；工作流规则改动攒批、低频落地（D27）。
- **交接边界（handoff boundary）** — handoff 文档**工具级附加**的尾段（非模型自觉）：上文（含待办/下一步列表）是上下文与候选，**不是本会话任务指令**；子会话首轮契约 = 验证环境快照（起手式一条命令）→ 复述理解 → 问 human 要做什么，拍板前不自动开工（O6/O6b）。
- **bundle（预设分发载体）** — 能被 profile 以一层方式装入的分发包：它不提供功能，只提供"往组合里插哪些行"的补丁层。与"插件"是两个层级的词——一个 bundle 可以挂零行、一行或多行；"装了几个插件"不由包数决定。
- **插件行（plugin row）** — 组合树上的一个挂载点：声明"用哪个模块、带什么配置"。是否"是插件"由有没有行挂它决定，不由包的 manifest 决定。
- **挂载级独立 / 分发级独立 / 演进级独立（L1 / L2 / L3）** — 组件脱离宿主复用的三级强度：L1 = 行能被别的 preset 单独挂；L2 = 有独立包名、版本线与安装通道；L3 = 有独立仓与发布栈。本工作流组件停在 L1（D46）。
- **workflow bundle（本语境正名）** — 指本包内那组工作流组件行 + 承载它们的 preset 声明；**不是**独立包、**也不是**独立 preset（D46 / ADR-0014）。
- **PRODUCT.md / DESIGN.md** — impeccable 工作流的产品契约与视觉方向两个文件（product truth vs visual direction），与本文 + `docs/adr/` 的拆分同构，**并存不冲突**：目标仓带它们时，UI 审查门（`docs/code-review-brief.md` §9）把它们当输入读，本仓不因此改自己的单一语境载体（#32）。
- **泳道批（lane batch）** — batch 模式的并行扩展：多 lane 并行推进 touch-set 不相交的票。产品执行载体 = DSH 原生编排（Team Lead + `spawn_teammate` + agent-team 任务板 + `create_worktree` + forge CR 收口，ADR-0018）；ZCode workflow 是本仓开发自用载体、非交付物。
- **lane（泳道）** — 泳道批里一条并行工作线：一个 teammate 会话 + 一个 worktree + 任务板条目；lane 间隔离判据 = touch-set 两两不相交（机械审计 = `scripts/lane-audit.mjs`，#136 交付，排批维度——相交是「不并行」不是「不 ready」，`frontier.mjs` 的开工资格语义不变）。
- **teammate** — DSH agent-team 的持久队员会话（`spawn_teammate` 由 Team Lead 创建，fresh/fork context）；泳道批里即 lane implementer。
- **CR（变更请求）** — forge 词汇：代码托管平台 PR/MR 的 provider 无关抽象（open/closed/merged + checks + mergeability，`forge-github` 为 GitHub 驱动）；泳道批收口 = 整批一 PR，merge 恒 human 门（D21），ADR-0002 批末 push 门升级表述为批末 PR 就绪门。
## 已核实的环境事实

- cron 守护进程运行中；DSH 内 bash 可联网（github.com 可达）。
- `cordis-plugin-timer`（`ctx.timeout/interval/debounce/throttle`，随 fiber 释放）可用于插件内定时。
- 提醒/定时三分事实（0.2.1，#90 复核）：**服务层**——`dsh-schedule` + `ui-schedule` 由出货 `web-app` bundle 内建提供；**出货面**——`tool-schedule` 行由 `standard` / `ptc` / `cordis` 各自声明（`minimal` 不声明）；**本仓面**——本仓四档 preset 目前都未声明该行，matt 会话拿不到 `schedule_*` 工具（#117 拍板不回补：方向 b 有意接受该缺口，理由登记于官方 roster 快照 `tests/fixtures/official-presets-roster-v1.json` 的 `registeredDiff`）。
- 宿主组成（base/web.cordis.yml）不可改：任何新能力只能进 preset 层。

- `npm install --prefix ~/.dsh` 会按 ~/.dsh/package.json 重建 node_modules——曾误删 cron-parser/luxon（2026-08-19，装 yaml 时）。现 ~/.dsh/package.json 固定 cron-parser/luxon/yaml 三个依赖；装新依赖务必显式列全或先读 package.json。
- **DSH 测试/升级通道分工（human 指令，2026-10-01）**：日常测试一律用**源代码检出 + 网页端**（`pnpm run dev:web` / 现有 web URL）；**桌面端（安装版）只用于稳定后的版本升级**——开发中的改动不得先行装上桌面端。任何"装新版本试试"的动作先问自己走的是哪条通道。

## 决策索引（D1–D57）

> 每条一行：**Dn（日期，来源）** — 一句决策 → 指针。有 ADR 的决策以 ADR 为权威叙述；无 ADR 的决策细节与**全部决策行的原文快照**（含历次修订注记）在 [docs/observations.md](docs/observations.md) 决策详档节（#70 迁出，归档不再更新）。

- **D1（2026-08-18，访谈 R1）** — 做通用 job-runner：配置驱动的定时任务列表（每任务 = 时间表 + shell 命令），技能同步是第一个消费者 → [详档](docs/observations.md#d1)
- **D2（2026-08-18，访谈 R1）** — 挂 matt preset 插件（standing mount 生命周期）；不用系统 cron 兜底 → [详档](docs/observations.md#d2)
- **D3（2026-08-18，访谈 R1）** — 新建小 job-runner；`dsh-schedule` 保留为会话级提醒的现成路径，本用例不装（2026-10-24 注：0.2.1 起服务层已内建、出货 preset 已声明 `tool-schedule`，本仓面现状见上文三分事实） → [详档](docs/observations.md#d3)
- **D4（2026-08-18，访谈 R2）** — 时间表用 cron 表达式（5 段） → [详档](docs/observations.md#d4)
- **D5（2026-08-18，访谈 R2）** — 结果处理：记日志 + 可选 `notifyOnFailure`，不自动重试 → [详档](docs/observations.md#d5)
- **D6（2026-08-18，访谈 R2）** — 任务清单以 agent.cordis.yml 行式配置（每任务一行） → [详档](docs/observations.md#d6)
- **D7（2026-08-18，访谈 R2）** — 提供模型工具：`jobs_list` + `jobs_run` + `jobs_pause` → [详档](docs/observations.md#d7)
- **D8（2026-08-18，访谈 R3）** — cron 解析用 cron-parser 库（装 `~/.dsh/node_modules`，不碰部署目录） → [详档](docs/observations.md#d8)
- **D9（2026-08-18，访谈 R3）** — 失败通知只发给显式配置的会话（`notifySessionId`），无默认目标 → [详档](docs/observations.md#d9)
- **D10（2026-08-18，访谈 R3）** — 首个任务：每天 09:00 跑 `sync-skills.sh`，开失败通知 → [详档](docs/observations.md#d10)
- **D11（2026-08-18，访谈 R4）** — 同步任务 `runOnMount: true`：新挂载时先跑一次 → [详档](docs/observations.md#d11)
- **D12（2026-08-18，访谈 R5）** — ~~matt preset 挂两阶段 bootstrap~~ 已被 D17 取代 → [详档](docs/observations.md#d12)
- **D13（2026-08-18，访谈 R5）** — ~~persona 拆分：行内单行 persona + 完整 ask-matt 文本独立 section~~ 已被 D18 取代 → [详档](docs/observations.md#d13)
- **D14（2026-08-18，访谈 R5）** — handoff_tool：mode 收敛 `fork`（带历史）|`fresh`（无历史）、文档 = 子会话首条 user 提示词（followup 立即触发首轮）（2026-08-19 修订：默认改 `fresh`——fork 复活已压缩历史，见 O6；交接边界段由工具强制，见 O6b） → [详档](docs/observations.md#d14)
- **D15（2026-08-18，访谈 R5）** — 删除 `/clear` 命令及其插件；「全新会话」走 GUI New Session（hero-chip 可选手动选 preset） → [详档](docs/observations.md#d15)
- **D16（2026-08-18，访谈 R6）** — 工作区自主初始化：无 CONTEXT.md 时自主探测（git/docs/语言信号）建双骨架（CONTEXT.md + 空 docs/adr/）；issue-tracker 缺失只顺带提一次，用到时先存进度快照再强制 setup → [详档](docs/observations.md#d16)
- **D17（2026-08-18，实测后）** — 取消两阶段 bootstrap：梁神模式仅对 DeepSeek V4 Pro 有效、对其他模型（含 V4 Flash）是副作用；恢复全量输入表面，删 tool-bootstrap 行与文件 → [详档](docs/observations.md#d17)
- **D18（2026-08-18）** — 完整 ask-matt 人设并入 persona（删 matt-workflow 插件与 md，{{model}}/{{cwd}} 渲染插值冒烟验证）——后续被 D42/ADR-0010 进一步取代为 workflow-core 注入 → [详档](docs/observations.md#d18)
- **D19（2026-08-19，访谈）** — WORKFLOW ENFORCEMENT 四硬门：任务入口路由 / implement 前置 / 决策边界（真决策停下问人 + 破坏性高成本操作执行前必问 + 会话早期必读 AGENTS.md）/ 阶段声明；实现载体 = persona 文本，技能本体不改 → [详档](docs/observations.md#d19)
- **D20（2026-08-19）** — ONE ISSUE PER SESSION（第 5 门）：一会话一票 + 其验证，同根因紧密批次算一个单元；晚修订并入三条件（当前票完成 / 关联声明 / 实测窗口健康），Continue 仅限 phase 内（依据 O2） → [详档](docs/observations.md#d20)
- **D21（2026-08-19，grill）** — 外部动作门（第 6 门）：外部/破坏性动作执行前「验证完 → 报告 → 等确认」；触发条件 = 动作的可逆成本与外部可见性，不列穷举清单 → [详档](docs/observations.md#d21)
- **D22（2026-08-19，grill）** — 纠正沉淀：收到纠正当场提出写入点（事实/偏好 → 项目 CONTEXT.md/AGENTS.md；流程 → matt 决策），用户点头才写 → [详档](docs/observations.md#d22)
- **D23（2026-08-19，grill）** — workflow-enforcer 插件：提醒注入不硬拦截，每 turn 基线 + 高危 tool/call 即时追加；细节（高危清单）进插件、persona 只留每门一句话锚点（晚修订：并回本仓内置相对路径引用，独立 repo 弃用） → [详档](docs/observations.md#d23)
- **D24（2026-08-19，grill）** — TICKET EXIT：任何技能会话结束前把范围外可执行工作转票（gh issue create）写入待办；当前会话只做一件事 → [详档](docs/observations.md#d24)
- **D25（2026-08-19，grill）** — 会话成本模型与缓存感知拆票：每会话成本 = 系统提示词（缓存）+ 会话内增量 + 冷启动 prefill + 事实核查 + 交接读写，最优拆票粒度 = 总成本最小（收敛注记：保留为定性认知，量化项降级见 D29） → [详档](docs/observations.md#d25)
- **D26（2026-08-19，grill）** — handoff 快照化 + 起手式标准化：交接文档带环境事实快照段，新会话一条命令验证而非重建上下文（历次修订：2026-10-16 加「环境结论」行；2026-10-31 #168 快照段改 handoff_tool 生成时自动填 git 探针、零空壳；#172 定向凭据为票号时 tool 机械生成「票面回读」节；2026-11-01 #144 调用前防呆——ticketClosed/duplicateTicket/ticketCheckUnverified 三告警不阻断） → [详档](docs/observations.md#d26)
- **D27（2026-08-19，grill）** — persona 低频变更：persona 每改一次 = 所有会话系统提示词缓存失效；工作流规则改动攒批、低频落地 → [详档](docs/observations.md#d27)
- **D28（2026-08-19，grill）** — 起手式工作量分析 + 阻碍 bug 处理：入口问一句「这活一个窗口装得下吗」；阻碍 bug 自动立票、按阻塞程度与深度决定优先与修法、修完回本会话（收敛注记：判据阈值降级为定性，见 D29） → [详档](docs/observations.md#d28)
- **D29（2026-08-19，收敛）** — 停止机制堆叠，量化降级为定性：保留 D20/21/22/24/26/27 行为规则，量化项（70/90 水位、缓存公式、100K 尺子、工作面阈值）一律不实现传感器、回到「边界处问一句」；enforcer 保持基线 + 高危即时提醒；persona 不加第七门 → [详档](docs/observations.md#d29)
- **D30（2026-08-19）** — init 同时建 AGENTS.md 骨架（对齐 Codex init 心智）：CONTEXT.md（领域）+ AGENTS.md（行为）双骨架，存在其一不双建（绝不双建沿用 setup 规则） → [详档](docs/observations.md#d30)
- **D31（2026-08-25，IRIS Actions 分钟告警后 human 拍板）** — 批次模式（BATCH MODE）成为工作流一等模式（宣告触发）：批内逐票本地提交 + 本地验证、批末总结确认门（列全 issue → human 确认才 push）+ CI 全绿收尾、发现先落 issue → 处理 → 再更新、文本推送排除 Actions、batch-state.md 显式化 + 防堆积护栏（只含宣告成员 / 5 票或 1 周暂停 / 收尾于 push） → [ADR-0002](docs/adr/0002-batch-mode.md)
- **D32（2026-08-25）** — 批次分配（BATCH ALLOCATION）：绝不整库一批、按既有系列分组、每批上限 5 票、triage 先于分批（needs-triage 不进批）、ready-for-human 不进 agent 批、零散单票维持逐票、会话打开 backlog 主动提案批 → [ADR-0002](docs/adr/0002-batch-mode.md)
- **D33（2026-08-25）** — 批次不改变会话粒度（一票一会话）：攒批只改 push/验证节奏，批内每票仍一个独立 implement 会话，gate 5 fold-in 三条件不因批次放宽 → [ADR-0002](docs/adr/0002-batch-mode.md)
- **D34（2026-08-25）** — playbook 系统暂不实现（按 D29 维持现状）：配方层纪律 matt 已有等价物（tdd/diagnosing-bugs/DONE/code-review）；候选路径留档——真实痛点出现先试 bug-fix playbook，实测有效再攒批推广 → [详档](docs/observations.md#d34)
- **D35（2026-08-25）** — handoff 定向/候选交接：文档含「## 本会话任务（human 已定向）」节 = 验证快照 + 复述理解后声明开工、不再确认；无定向节 = 候选交接问 human（O6 保留）；父会话只在 human 明确指定时写定向节；快照不一致仍停下报告 → [详档](docs/observations.md#d35)
- **D36（2026-08-29，用户需求）** — 语言知识包层（lang-enforcer）：独立 sibling 插件按项目语言注入知识指针（detect 命中 → 会话级基线 + tool/call 一次性提醒，只发「该查哪个 skill」永不发流程指令——流程归七门、知识归语言包）；lang-packs/*.yml 声明式扩展、lang-gates.yml 可 disable（编号注：原编 D31，两机合并时让位顺延） → [详档](docs/observations.md#d36)
- **D37（2026-08-31，IRIS 口径差复盘）** — 链式授权逐跳限定（并入 D35 定向分支）：授权仅限定向节所指派的当前票，逐跳显式传递、不默认外溢到队列外工作（队列外一律 TICKET EXIT）；`preauthorized` 参数由文档标记机制取代并删除（#156 更新：定向节须携带可核凭据，见 D52；依据 O7） → [详档](docs/observations.md#d37)
- **D38（2026-10-01，#16）** — 排批模型路由推荐（model-lane）：票分级 A（顶配：决策/架构/money/治理语义）/ B（默认）/ C（docs-only），worker 路由顺序 `--model` > lane×`.sandcastle/model-lanes.json` 映射 > 宿主默认（命中映射时容器钩子 sed 替换 settings 的 agent-default-model） → [详档](docs/observations.md#d38)
- **D39（2026-10-11，#36）** — 测试分级 + 恢复纪律（comet 借入 adopt C2）：TEST SCOPE TIERING 三级（跳过层级被 CI 覆盖须声明 "not run locally"——声明未跑项是证据的一部分）+ RECOVERY DISCIPLINE（恢复会话以状态文件为唯一事实源，快照与环境不符停下问 human） → [详档](docs/observations.md#d39)
- **D40（2026-10-11，#37）** — Changelog/RELEASE 条目规范（comet 借入 adopt C3）：条目只述与上一个 tag 的 diff（收录标准 = 升级用户是否会注意到）、打 tag 时写不逐票更新；落 docs/RELEASE.md（#91：不另建 CHANGELOG.md，ADR-0007 同款注记） → [ADR-0007](docs/adr/0007-changelog-release-convention.md)
- **D41（2026-10-16，#39 拍板）** — PTC 采纳面与 implement-spec 复评：PTC 独立执行形态不进默认路径（workflow 经 #56 ptc profile 适配、七门语义零改动）；matt 工作流与 shell-host 是两个独立插件、PTC profile 必须基于默认路径改出；implement-spec 维持 ADR-0005 不 port 全量（Gotchas：`plugins` 覆盖 = 整体替换须单源 patch 合并、model 覆盖须 provider+model 成对、编排面 agent 不可嵌套） → [ADR-0009](docs/adr/0009-ptc-adoption-and-implement-spec.md)
- **D42（2026-10-16，#54 落地）** — workflow-core 插件化：ask-matt 正文（MAIN FLOW + 七门 + BATCH MODE）抽出 persona，改由 workflow-core.mjs 经 system-prompt/assemble 注入（渲染后 verbatim-identical），persona 只留导语；任何 preset 单行挂载即得工作流（#89 更新：{{cwd}} 已被上游 0.2.1 删除、当前目录由 working-directory 服务提供） → [ADR-0010](docs/adr/0010-workflow-core-plugin.md)
- **D43（2026-10-16，retro 落地）** — 环境自检三件套：verify-all.mjs 唯一检查入口（PASS/PASS*/FAIL/SKIP 分档 + 环境门禁变量）+ link-runtime-deps.mjs 补齐隐依赖 + verify-skills-mirror.mjs 技能镜像完整性守卫（UTF-8 + 编码回归锁）；环境事实与接口速查落 docs/dev-environment.md 与 docs/dsh-runtime-cheatsheet.md；沉淀纪律：仓外只留机器相关落地记录 → [详档](docs/observations.md#d43)
- **D44（2026-10-16，#55 落地）** — workflow profile 机制（共享骨架 + 每 profile delta）：正文按 `@@ <id>` 分节、marker 永不进注入文本；delta 同 id 覆盖（保位置）/ 新 id `after=<anchor>` 插入；standard = 冻结基线逐字节一致；cordis 三节只增不改、七门措辞零改动（#96 修订：外部动作门补 remove_bundle/set_version_exemption——现况清单现查 workflow-enforcer.mjs 的 DEFAULT_GATES，V17 双向等值守护） → [ADR-0011](docs/adr/0011-workflow-profiles.md)
- **D45（2026-10-16，#56 落地）** — profile 加 ptc/minimal 两档 + `tight` 紧连接分节（骨架 12→15 节）：ptc 四节只增不改（基于默认路径改出、不引用 shell-host，D41）；minimal 只覆盖不新增（七门 verbatim 唯一、其余压缩至 ~1/3） → [ADR-0012](docs/adr/0012-workflow-profiles-2.md)
- **D46（2026-10-17，#76 拍板）** — `dsh-matt-workflow` 形态：不独立分包、不独立建仓（L1 ≠ L2；追认 #54 由独立包改道同包 row，留四条复活触发条件；#99 更新：「不引入第二套档位机制」表述被 D50/ADR-0015 取代，其余结论不变） → [ADR-0014](docs/adr/0014-matt-workflow-bundle-shape.md)
- **D47（2026-10-17，#69 拍板）** — 静默通过的防线等于没有防线：防线缺席必须响亮——要么失败、要么打印一行说明；落地 = verify-all 汇总行带 `hooks=<on|off|未设置>` + 高危清单只收真红三类 + 不做传感器堆叠（D29）；逐条口径在 docs/dev-environment.md §0.3 → [详档](docs/observations.md#d47)
- **D48（2026-10-17，#85 落地）** — workflow 文本政策一次改完（D27 攒批）：七门自洽（six→seven）+ gate 1 入口路由按形状分类（真·形状未定 → grill，spec 已定 → to-spec → to-tickets，形状已定 → 直接 implement；O8）+ frontier 澄清（依赖进行中事实/子代理未回报的问题不属于当前轮）+ 新增 `@@ human-communication` 节（对 human 默认 2–3 句因果链；O9）；AC1 逐字节基线有意重取（不是漂移） → [详档](docs/observations.md#d48)
- **D49（2026-10-17，#71 落地）** — push 触发 retro：每票落盘免确认不阻断 + 批末聚合去重一次呈现；`retro:` 与 `.scratch/retro/.aggregated` 双 marker（存在性判定，不解析内容）；`git commit`（#121 原位修订）也 arm **落盘面**、聚合面只由真 push 驱动、commit 落盘面带**每会话一次** guard；batch-state 探针失败走独立注入节（无 ⚠ 前缀）绝不扁平化；文本面永不 arm（假触发比漏触发贵）；声明不覆盖交事实探测兜底、enforcer reminder-only → [详档](docs/observations.md#d49)
- **D50（2026-10-18，#99 拍板）** — matt 派生四个 agent preset 模式（一个 bundle → 四个模式）——机制存在 ≠ 用户可达：`dsh.bundle.patch` 变数组共 4 项（票面 5 项含与第 1 档重名 `config.id` 的 `presets/matt.patch.yml`，实测整包挂不上，Q3=A 撤）、profile delta 与 preset 声明是两个正交机制、官方四模式保留无交集、形态红线（human 明确）：安装/卸载/管理一律按插件方式（禁拆四包禁旁路）、roster 由生成器单源合成 + cordis 档差异化 roster（补 `tool-cordis` + 条件启用，差异双向锁定，Q4=A） → [ADR-0015](docs/adr/0015-matt-agent-preset-modes.md)
- **D51（2026-10-18，#113 拍板）** — home 安全防复发：`scripts/with-temp-home.mjs`（mkdtemp 建在 os.tmpdir() 下 + assertSafeTempHome 纯函数复用 lib/safe-target.mjs 单一事实源 + 只删自建路径 + 响亮失败）把手写沙箱从默认形态去掉；enforcer 新增 HOME_DELETE_TRIGGER（删除动词 + home 目标落在同一条命令段的组合判定，接受 shell 分词残留形态；只提醒不拦截；足尺负例一律不触发） → [详档](docs/observations.md#d51)
- **D52（2026-10-24，#156 grill 拍板）** — 定向交接凭据机制（D35/D37 张力收口）：标记机制保留，但定向节必须携带可核凭据——批次定向 = 批次宣告 id、非批定向 = 已落票的票号（先落票才有定向资格）；child 开工前核对、缺凭据或对不上自动降级候选交接；`preauthorized` 参数不恢复；handoff-tool 只做结构校验不做语义判断 → [详档](docs/observations.md#d52)
- **D53（2026-10-25，#49 落地）** — 自主化 L1：Bucket B 免确认授权 = 批宣告授权延伸 + human 独占写权的仓外**风格偏好层**（保守[缺省]/标准两档；标准 = 已登记批外票清单的票可免确认改标 + 关票、登记写权在 human；逐条加减例外；两档都不含 push——push 预授权属 L3）+ 事后 digest 审计（`自主 <动作>` 固定格式清单行、批内不重抄只留指针、缺证据标未验证并升格异常、`⚠ 无授权依据的动作` 段越界置顶；下游 #163/#135——L3 #135 已落地 GATE_AUTHORIZATION 门打标 + ticketFacePrecheck 票面双层前置 + OVERREACH_STOPGAP 越界三步止损） → [详档](docs/observations.md#d53)
- **D54（2026-10-25，#163 落地）** — 自主化 L2：批内 auto-handoff 唤醒编排（lib/autonomy-orchestration.mjs 的 runWakeLoop：page 事件流 turn 序判、子代理在飞 hold 到落定、闲置宽限 + 1 次 nudge、onAwaitingHuman 转达/应答注入一次防风暴）+ 收尾人工确认位（交付全自动、push/关票停问 human，#160 拍板）+ 批末异步审计位（失真率读数进 wrap AUTONOMY DIGEST，与 D53 越界率不同读数互不替代）+ 协议固化（eval runner import 编排件零内嵌副本、HANDOFF_BOUNDARY 正典导出） → [详档](docs/observations.md#d54)
- **D55（2026-11-01，#58 落地）** — batch-mode 规则块组件化（workflow components）：`@@ batch-mode` 节物理抽为 workflow-component-batch.txt + `COMPONENTS` 注册表（组件关 = 注入零 batch 节；组件开 = 与冻结基线逐字节等价、基线零重取；未知组件名响亮抛；profile 同 id 覆盖压过组件默认文本） → [ADR-0016](docs/adr/0016-workflow-components.md)
- **D56（2026-11-06 拍板，#179 入册）** — 注意力经济学作为工作流优化目标轴：门 3 内部改三层分级（L0 自决 / L1 攒批 / L2 立即问，四类恒 L2：D21 外部动作、recovery STOP-and-ask、隐私面、范围扩张/AC 改写/triage 三选一）+ 批末收口卡与委派完成卡双形态（action-cards 缺席时降级为正文收口段、降级显式）；实施分两波 → [ADR-0017](docs/adr/0017-attention-economy.md)
- **D57（2026-10-20 grill 拍板，2026-11-14 裁决维持，#53 落地）** — PM 组合层基座依赖反转：三层划分维持（forge project = 组合层永存 / DSH 任务板 = 可选执行层 / batch-state.md = 批协议层只管批生命周期不担 PM 职责）；优先级 = 票面 `P0` 标签（#142 单档例外轴，project 侧当红旗列，不另设字段）；L1（依赖关系图，吃原生 blocked-by 边 + frontier.mjs 现算）立即 / L0（看板+里程碑）延后（真出现跨仓 roadmap 需求再开板，前置 = `gh auth refresh -s project`）/ L2、L3 待议；三档降级梯度只钉口径不造载体（不建板、不新建 docs/tickets/、不升格 batch-state.md） → [ADR-0019](docs/adr/0019-pm-layer-on-forge-project.md)

## 观察记录与历史（迁出指针）

观察记录 O1–O9（IRIS 会话复盘）、Persona 批改队列、构建状态与决策详档已迁出至 [docs/observations.md](docs/observations.md)（#70，2026-11-08；归档不再更新，决策现状以上文决策索引与 ADR 为准）。
