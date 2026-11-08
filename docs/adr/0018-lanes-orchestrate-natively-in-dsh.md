# ADR-0018: 泳道批编排以 DSH 原生能力为产品靶心

Date: 2026-11-08
Status: Accepted
Deciders: human（#136/#137 grill，Q6–Q11 统拍）
Related: ADR-0002（批末 push 门）、ADR-0006（teams pipeline 分工线）、#52（泳道批决策记录）、#136（契约面）、#137（执行面）、#165（batch-state 机械对账）

## Context

#52 拍定泳道批（白天车道、worktree 隔离），拆出契约面 #136 与执行面 #137。grill 时的默认语境把执行载体当成 ZCode workflow（本仓历批 P→X 的编排形态）。human 在 grill 中纠正了靶心：

> 我们是给 DSH 做插件的，虽然（开发）用的 ZCode，但最终用户又不一定安装 ZCode。

同时 human 指示考虑用上 DSH 的**变更请求（forge）**与**工作树（worktree）**原生能力，终结长期的 DSH 串行开发。勘察证实（上游 66491b05 = dsh-v0.2.2-rc.1 树读）：

- `agent-team` + `tool-agent-team`：DSH 原生多 agent 编排。`spawn_teammate`（Team Lead 专属，fresh/fork context）创建持久队员；任务板条目原生携带 `writeScopes` / `ready` / `blockedBy` / `ownerName` / `status` 字段——与泳道契约的 touch-set / 就绪判定 / 阻塞边几乎一一对应。
- `worktree` 服务 + `tool-worktree`：`create_worktree` 模型工具——起 branch+worktree 并把会话工作目录切入；checkout pool、自动命名、被删可恢复；未提交文件留源检出。
- `forge` + `forge-github` + `forge-session`：CR = 平台 PR 的 provider 无关抽象（`open/closed/merged` + checks + mergeability）；forge-session = session↔CR 绑定投影。
- 装配载体 `forge-bundle` 把上述一并装齐；**均为 experimental、不在 DSH 默认装配**；npm 仅到 alpha.2（rc.1 源码未发 npm），版本对齐的获取路径 = 上游检出源码装。
- 本仓历批的编排载体 ZCode workflow：subagent 走 ZCode 工具面，**挂了 forge-bundle 也调不到 `create_worktree`**——DSH 工具面 ≠ ZCode 工具面。
- preset 的七门纪律正文（workflow-core）的宿主本来就是 **DSH 会话**——DSH lane 下纪律回归注入本位。

## Decision

1. **泳道批的产品执行载体 = DSH 原生编排**：Team Lead（matt preset 会话）`spawn_teammate` 起 lane implementer、agent-team 任务板承载票与契约字段、`create_worktree` 做 lane 隔离、forge CR 收口。
2. **ZCode workflow（CreateWorkflow）是本仓开发期的 dogfooding/验证载体，不是交付物**；lane-audit 脚本（#136 交付）等确定性脚本是仓内资产、两个载体共用。
3. **契约映射**：#136 四字段（touch-set / 接口契约 / 影响面 / proving）映射到任务板条目 `writeScopes` 等原生字段；机械审计 = lane-audit 脚本（#136 交付，落 `scripts/`，落地时回填本文路径引用；排批维度）；`frontier.mjs` 的 ready 语义（开工资格）保持三维不变——touch-set 相交是「不并行」不是「不 ready」。
4. **收口形态 = 整批一 PR**：lane 分支汇成一个 CR；`git push`（非 force）与 `gh pr create` 在 D21 pre-authorized 面内，**merge 恒为 human 门**；首跑 CR 开出不 merge（merge 时点 human 另拍）。ADR-0002 的「批末 push 门」升级表述为「批末 PR 就绪门」——内容不改。
5. **正文落 preset 组件** `workflow-component-lane.txt`（#58 batch 组件同款机制：`config.components` 控挂载、冻结基线逐字节一致、载体登记面守卫全套沿用）。能力前置不在默认装配 → **组件内环境检测 + loud 降级**（工具面缺席 → 显式提示装 forge-bundle，降级走既有串行 batch；D47，不静默）。
6. **experimental 面获取 = 上游检出源码装**（版本与 runtime 锚对齐；npm alpha.2 版本错位不采）。**首跑并行度 2**、票挑 touch-set 不相交的小-中票；装齐动作是首跑前置条件，装不齐顺延不降级造假。

## Consequences

- #137 执行面写域扩为 preset 组件 + 载体登记面（agent.cordis.yml row / regen-bundle / exports-audit / verify-row-deps 链）。
- #165 的权威载体坐实为 agent-team 任务板（票面原假设被证实）；batch-state.md 降级为批末投影。
- ZCode 侧的 workflow-enforcer hook / CreateWorkflow 编排不迁移、不废弃——它们服务**本仓开发**；DSH lane 的纪律由 preset 本位（workflow-core 七门正文 + 组件）承载。两个 harness 的门面各自维护，语义同源。
- experimental 成熟度风险由首跑形态控制（并行度 2、小票、全程记录）；首跑证据决定下一族是否扩大 DSH lane 面（#138 沙箱、#139 人在回路并行的设计输入）。
- 泳道批依赖 experimental 面 → preset 用户可见的采纳路径 = 装 forge-bundle；组件的降级语义保证未装用户不受影响（串行 batch 照旧）。
