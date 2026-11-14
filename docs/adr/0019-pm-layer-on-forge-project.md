# ADR-0019: PM 组合层基座依赖反转——三层划分维持；优先级 = 票面 `P0` 标签；L1 立即 / L0 延后；三档降级梯度只钉口径不造载体

Date: 2026-11-14
Status: Accepted
Deciders: human（**2026-10-20 grill 拍板**，票面评论，owner 署名 *the decisions below are
the human's*；**2026-11-14 human 裁决维持 grill 口径**——本批实施中发现票面正文（10-12
决策节）与 grill 评论冲突、上报后拍板）
Related: ADR-0018（泳道批编排——执行层载体）、ADR-0002（批末 push 门——批协议层）、#142（P0 单档例外轴）、#141（state 标签治理）、#52（泳道批决策）、#49（digest）、#53（本票）

## Context

背景问题（#53 正文，2026-10-12 三段论述收敛）：DSH 任务板是**部署资产**（换部署 /
rc→release / 换机即可能消失），不宜作为 PM 组合层的事实源；forge（GitHub / GitLab /
Gitea / OpenProject）的 project 模块与 issue 同为仓库固有基础设施——**仓在哪，PM 层就
在哪**。PM 软件功能面更宽（看板、甘特图、依赖图、里程碑）。

grill 先行事实（2026-10-20 会话实测，逐条）：

1. **`batch-state.md` 只在批内存在**：K 批已归档 ⇒ 当时该文件**不存在**。而
   project/组合层要的是**永存** ⇒ 拿它当项目层会让「项目视图随批结束消失」。
2. **`gh` token 无 `project` scope**：`gh auth status` 实读 `gist / read:org / repo /
   workflow`；`gh project list` 报 `missing required scopes [read:project]` ⇒ L0
   （建 Projects v2 板）有**用户侧前置动作**。
3. **L1 零成本**：原生 `blocked-by` 边本仓**已在用**（`scripts/frontier.mjs` 就是靠它
   现算可开工集合），GitHub issue 页也会直接呈现。
4. **#142 当天已定**：优先级 = 票面**单档 `P0` 标签**（正交轴、不参与 state、不驱动
   排序、`frontier.mjs` 只做可见标记）。

前提刷新与裁决（2026-11-14）：运行时重锚 0.2.2-rc.3 后，Agent Teams 已毕业进上游
**base bundle**（随 base 出货）——#153 批 AA 存量复核发现「任务板波动性高」这一**论据
被部分刷新**（任务板仍属 runtime 侧资产、非仓内文件，但出货形态从实验面变为标准件）；
「仓在哪 PM 层就在哪」等其余论据不受影响。**human 裁决：维持 grill 口径**——三层权责
与采纳分层不依赖被刷新的单点论据，裁决成立。

权威源冲突与裁决记录（首版实施教训）：#53 票面**正文**（10-12 决策节）含「Priority
字段 + 建板序列 + batch-state.md 升格为 PM 层」等表述，与 10-20 grill 拍板评论冲突且无
推翻 grill 的记录；首版实施按正文落地后被复审发现，上报 human，**2026-11-14 拍板：维持
10-20 grill 口径**（正文相应段落被 grill 取代）。处置先例 = `docs/agents/issue-tracker.md`
「存量票据渐进复核」节的回填形态：**正文与批准评论冲突时，以较新的可回读拍板记录为准**。

## Decision

1. **三层划分维持**（正文 10-12 提出、grill 维持）：

   | 层 | 基座 | 职责 |
   |---|---|---|
   | 组合/项目层 | forge project 模块（永存） | 优先级、批次归属、lane 分组、roadmap——human 常看 |
   | 执行层 | DSH 任务板 / teamRun（可选） | 会话运行、权限门——agent 自维护 |
   | 批协议层 | batch-state.md（仓内，只管批生命周期） | 批宣告/证据三要素/未 push 清单——批生命周期 |

   一句话：Projects 管「排什么」，任务板管「怎么跑」，batch-state 管「批内协议」。

2. **优先级是同一件事（grill Q1=A）**：project 视图**读票面 `P0` 标签**，不另设字段。
   理由：单一事实源（issue label）+ 无需同步机制（D29）；`P0` 是**例外标记**而非排序
   维度，project 侧当「红旗列」呈现即可。不选 B（两处各存——必然需要同步机制，正是
   机制堆叠）；不选 C（只在 project 字段——直接推翻 #142 当天的结论）。

3. **采纳分层（grill Q2=B：L1 立即 / L0 延后）**：

   | 层 | 功能 | 数据来源 | 采纳 |
   |---|---|---|---|
   | L1 | 依赖关系图 | `blocked-by`/`blocking`（票面已在写，frontier.mjs 已现算） | **立即**——零新机制零新权限 |
   | L0 | 看板状态列、里程碑（批 = milestone） | issue 开关 + label（内置自动化） | **延后**——等真出现「跨仓一眼看 roadmap」的需求再开板；前置 = `gh auth refresh -s project`（用户侧动作） |
   | L2 | 甘特图/时间线 | L1 依赖边 + 批级粗时间框——**不手工维护日期** | 待议——L1 稳定后才谈；新推导逻辑先过 D29 |
   | L3 | 工作量/assignee 负载均衡 | lane 分配数据 | 待议——#52 泳道试跑后议 |
   | 不采纳 | 精确到天的人力排期、燃尽预测 | agent 工作流无可靠数据源 | — |

   L0 延后的理由：要 `project` scope + 建板 + **长期维护**，而它想回答的问题（票在哪
   一列）当前 state label 已答（#141 正在治这批标签）。

4. **三档降级梯度只钉口径，不造任何载体（grill Q3=C）**：三档映射（票 / 状态列 /
   里程碑·依赖 / 指派与审计线索）写进 `docs/agents/issue-tracker.md`「forge project 层」
   节——**映射表是口径不是载体**：真出现 git-only 仓时再落文件，届时按映射表照做。
   **不**把 `batch-state.md` 升格为 PM 层（先行事实 1：它只在批内存在）；**不**新建
   `docs/tickets/` 之类载体（为尚未出现的无-forge 场景造负担，D29）。

5. **最小 PM 抽象四概念保留**（与 forge 无关的可移植性子集）：`票 / 状态列 / 优先级 /
   批次·lane 归属`——任何 forge 均有对应物；#49 digest、#52 泳道只依赖此子集。

6. **结论落三处，各司其职（grill Q4=A）**：本 ADR（为什么这么分层 + 采纳表 + 四概念）；
   `docs/agents/issue-tracker.md`「forge project 层」节（操作口径：L1 怎么用原生依赖边、
   三档映射表、优先级读 `P0`）；`CONTEXT.md` **一行指针**（D57，只指路不抄内容）。

## Consequences

- **边界四条**（grill 边界）：**不建** Projects v2 板（L0 延后；需要时先
  `gh auth refresh -s project`）；**不给** `batch-state.md` 增加任何 PM 职责；**不新建**
  `docs/tickets/` 或同类载体；**不改** #142 的 `P0` 结论与 `frontier.mjs` 行为。
- L0 开板的触发条件是**需求侧**的（真出现跨仓 roadmap 需求），不是日历侧的——不预排
  日期；届时建板/入板授权走届时可回读的拍板记录（D21 同族外部动作门照旧）。
- verify 断言 = `tests/verify-project-pm-layer.mjs`：钉 L1 用法 / 三档映射表 /
  优先级读 `P0` / grill 边界 / ADR 决策面 / CONTEXT D57 指针的**文档形态在场**（非空洞
  扰动），并带**负向锚**（建板序列、Priority 字段定义、batch-state 升格句、出板动作
  惯例不得再现——复审改判的回潮防线）。
- D57 入册 CONTEXT.md 决策索引，三处手抄 D 区间指针（AGENTS.md / README.md /
  code-review-brief.md）随 R4 判据同步为 `D1–D57`。
- DSH 任务板的本位（ADR-0018 lane 批执行层）不动：它继续管「怎么跑」；rc.3 毕业进 base
  只提升执行层稳定性，不改变事实源归属的分层。
- 泳道模型的核心（分支 = lane、worktree 隔离、Lead 合并门、批协议）是 git-native 的，
  三档零损失（ADR-0018/#52）；forge 提供的是人机界面舒适度，丢掉它丢的是 UI，不是能力
  （实证 #38：评测全程无 forge 完整闭环）。
