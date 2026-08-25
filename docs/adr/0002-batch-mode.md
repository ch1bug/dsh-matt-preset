# 0002 — 批次模式（BATCH MODE / 攒批）+ 文本推送排除 Actions

Status: accepted

## Context

IRIS 2026-08-25 会话收到 GitHub Actions 分钟告警：ch1bug 账户私有仓库免费额度 2000 分钟/月已用 90%（1800/2000），根因是约 7 次 push/天 × 每次全量 CI（check/test/clippy/fmt 4 job，`ubuntu-latest`，无路径过滤）。human 先在本仓库 AGENTS.md 定下攒批策略（commit `6afe4c0`，本地未推），随后拍板：**把批次模式并入 matt 工作流本体**（而非每个仓库各自打补丁），并追加"文本推送排除 Actions"规范。动机原文："把 matt 工作流模式改成攒批吧，然后加强批次理解，否则一定会在本地攒一大批的"——批次理解的核心是**显式批次状态 + 防堆积护栏**，防止 agent 无脑把票续进批次导致本地 commit 无限堆积。

## Decision

**批次模式（宣告触发，非默认）**：

- human 宣告"这批攒批 / 系列处理 / 大系列"时进入批次模式；单票任务维持逐票 push 节奏。
- 批次内：逐票实施 → 本地 commit + 本地验证（L1/L2/clippy/fmt/code-review）→ 不单独 push；关票可先于远程 CI（基于本地验证 + code-review），远程 CI 在批次末一次性确认。
- 批次末：**批末总结确认门**——收尾前总结列出过程中所有 issue（A/B/C 全量）→ human 确认 → 才一次性 push 全部 commit（2026-08-25 晚修订：取代最初"宣告预授权"语义，批末 push 走正常 report→确认→push）+ 远程 CI 全绿为收尾门禁（红 = 批次未完工作）。
- **批次内 issue 纪律（防偷懒）**：一切发现先落 issue（新建或更新）→ 处理 → 再更新 issue（记录修复与验证证据），绝不静默顺手修/静默忽略。三桶：A 阻塞（新建 issue + 整批暂停等 human）；B 非阻塞票外（落票→修复→更新→继续）；C 验证期 CI 红（定位→更新→修复→复验→更新）。计划/范围更改同走"更新 issue→处理→再更新 issue"闭环。
- 文档（CHANGELOG/docs/AGENTS.md）只本地提交，随下次代码一起推送。
- **批次状态显式化**：批次宣告时写 `.scratch/batch-state.md`（成员/结束点/进度/未推送 commit 清单），每票结束更新。
- **防堆积护栏**：(a) 批次只含宣告成员，扩员须 human 明确；(b) 未推送达 5 票或 1 周须暂停报告、请求 push 检查点；(c) 批次必须收尾于 push。

**批次分配（BATCH ALLOCATION，2026-08-25 补）**：

- 存量 backlog 的分批要求：绝不整库一批，按既有系列分组，每批上限 5 票（与防堆积护栏同高）。
- triage 先于分批：needs-triage 票不得进批次（批次计划需可测 AC + 已决优先级）。
- ready-for-human 票不进 agent 批次；零散单票维持逐票；批次是工具非义务。
- 会话打开未分批 backlog 时主动分类（系列/triage/human/零散）并向 human 提案批，而非默认逐票漂移。
- 批次宣告 = 成员 + 结束点 + AC 检查，是自主执行的许可证。

**文本推送排除 Actions（批次内外均适用）**：

- 仅含文本/文档改动（CHANGELOG.md、docs/**、AGENTS.md、*.md、.github/**）的 push 不得触发 CI——目标仓库 ci.yml 应配 `paths-ignore`，文档-only push 零分钟。
- 仓库缺该过滤时，作为当前批次/票的一部分补上（或立票），不得放任文档-only push 跑全量 CI。

落地位置：`agent.cordis.yml`（gate 6 例外、DONE 双模式、BATCH MODE 节、TEXT PUSHES EXCLUDE ACTIONS 规范）+ `workflow-enforcer.mjs`（基线提醒与 push 后提醒补批次例外，保持无状态）+ CONTEXT.md D31。

## Considered Options

- **本地部署自托管 runner**（把远程 CI 变免费）——评估过：机器是 8 核 i7-1065G7 / 7.6G 内存 / WSL2 / 会重启（uptime 2h56m），只能串行 1 job、可用性不稳定；纯省钱角度不成立（超量费率 $0.006/分，月超 1000 分钟才 ~$6）。**否**，除非未来要恢复逐票 push + 远程 CI 门禁才值得再议。
- **攒批只留在 IRIS AGENTS.md**——每个仓库各自打补丁，matt 工作流本体继续与攒批语义冲突（DONE 含远程 CI 与"关票先于远程 CI"矛盾）。**否**，改为并入工作流本体。
- **批次默认全开**——单票任务也被迫攒批，交付延迟且改变单票节奏。**否**，宣告触发。

## Consequences

- 批次模式下逐票"完成"不再含远程 CI（本地验证 + code-review 即完成），远程 CI 全绿推迟到批次末——DONE 规则双模式化；批次拖长时远程验证积压，跨 commit 追根成本上升，靠护栏 (b) 控制。
- 批次宣告即预授权批末 push：~~减少逐次确认摩擦~~（**2026-08-25 晚修订：预授权语义被批末总结确认门取代**——human 拍板"用户确认之后才能推送"，每批收尾都出全量 issue 清单等确认，防止 B/C 修复偷懒未被审计）；enforcer 的 push 提醒文本已同步（无状态，语义由 persona 承担）。
- 文本推送排除 Actions 依赖目标仓库 ci.yml 配置 `paths-ignore`；工作流只承载规范要求，实际配置需各仓库落地（IRIS ci.yml 尚无路径过滤，属待办）。
- persona 改动对新会话生效（系统提示词缓存全量失效一次，D27 低频变更纪律——本次为单次批量落地）。
- 与 IRIS AGENTS.md 攒批策略（`6afe4c0`）语义对齐：IRIS 仓库侧措辞可保持，preset 侧成为通用规范。
