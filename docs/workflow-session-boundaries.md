# 会话边界与成本模型 — 完整设计视图（2026-08-19）

> grill 产物。决策见 CONTEXT.md D24–D28；本文 = 框架映射 + 断点清单 + 三方向定稿 +
> 技能文档见解，是后续实现的地图。

## 0. 框架基础：PHASE-BOUNDARIES（matt 原生，ask-matt 技能）

**phase** = 会话内的一块工作（grilling/implementation/QA）；phase 边界 = "ok we're
done with that" 的时刻，**唯一该做边界决策的地方**（mid-phase 不决策，除非 fork 旁支）。

五选项树（第一个 yes 生效）：
1. **Continue** — 下个 phase 需要当前 phase 作 primary source，或 smart zone（~150k）
   还够装下（成本最低，先排除）；
2. **/clear** — 上下文与下一步无关（可弃）；
3. **/handoff** — 窄：换 harness / 换目录 / 交同事 / **mid-phase fork 旁支**；
4. **Subagent** — 任务够小可 AFK；
5. **/compact** — 默认但不是首选（lossy，摘要扁平化后 fresh session 可能 confidently wrong）。

primary/secondary：除 Continue 外都 lossy（primary=全量/噪音多/空间少；secondary=lossy/空间多）。

**关键澄清——两层边界**：
| 层级 | 定义 | matt 覆盖 |
| --- | --- | --- |
| phase 边界 | 同一任务内阶段切换 | ✅ 五选项树 |
| 任务边界 | issue 之间 | ❌ 未覆盖 → 我们的 D20/D24 |

## 1. 全部问题 → 框架映射

| 讨论项 | 框架位置 | 关系 |
| --- | --- | --- |
| D20 ONE ISSUE PER SESSION | 任务边界（框架未覆盖） | **扩展** |
| D24 TICKET EXIT | 任务边界（技能产出→票） | **扩展** |
| 方向 1 水位（70/90） | 问题 1 的 smart zone 判定 | **实例化**（边界处实测，非每请求注入） |
| 方向 2 起手式分析 | 会话入口的 phase 预演（wayfinder 100K 同类） | **扩展**（入口预判 + 边界实测校准） |
| 方向 3 阻碍 bug | 问题 3 的 mid-phase fork | **实例化**（"forking a side task mid-phase"） |
| 修完回本会话（3d） | handoff 是单向的 | **新扩展**（需 D26 快照恢复支撑） |
| D25 成本模型 | primary/secondary 表 | **量化补充**（加缓存维度） |
| D26 handoff 快照化 | 问题 3 的强化 | **改进**（portability + 可验证） |
| B4 欠债断点 | 诊断技能 → 任务边界 | **扩展** |
| D27 persona 低频 | 工程约束 | 独立 |

**三个关键修正**：
① 方向 1 在 **phase 边界处实测** smart zone（不是每请求刷）；仅超红线才持续轻提醒；
② 方向 2 = 入口预演（粗切），边界实测（校准）——层次不同，互补；
③ 方向 3 = mid-phase fork 实例 + **"暂停-恢复"扩展**（matt 只有单向 handoff）。

## 2. 决策清单（D20–D28，含修订）

- **D20** ONE ISSUE PER SESSION（任务边界）：一个会话一个 issue + 验证；同根因批次算一个单元；新发现只建票。
- **D21** EXTERNAL-ACTION GATE（第 6 门）：外部/破坏性动作报告→确认。
- **D22** 纠正沉淀：纠正→当场提出写入点，点头才写。
- **D23** workflow-enforcer 插件（晚修订：并回 preset 仓库，相对路径，plugin add 弃用，scope 过滤保留）。
- **D24** TICKET EXIT：技能产出可执行但超范围的工作→建票，不吞。
- **D25** 会话成本模型 + 缓存感知拆票（晚修订：黄 70% / 红 90%，按物理 contextWindow；smart zone 由方向 2 兜底）。
- **D26** handoff 快照化 + 起手式标准化（**扩展：票面标准并入 AGENT-BRIEF 原则**——行为契约优先，不写路径/行号）。
- **D27** persona 低频变更（攒批）。
- **D28** 起手式工作量分析（工作面分类，≥2 不同类→提醒）+ 阻碍 bug 处理（自动立阻碍票 / 按阻塞程度优先 / 按深度修法 / 修完回本会话 / git WIP 快照）。（**扩展：拆票否决记录进 .out-of-scope 式持久化**）

## 3. 三方向定稿

| 方向 | 载体 | 触发 | 行为 | 参数 |
| --- | --- | --- | --- | --- |
| 1 水位 | workflow-enforcer 插件 | phase 边界实测（tokenMeter） | ⚠ 70% / ⛔ 90%（物理窗口） | 黄 70/红 90，config |
| 2 起手式分析 | 指令层（交接模板）+ 插件首次请求提醒清单 | 会话入口 | 任务清单→工作面归并（意图/验证/接触面三选交叉，意图同=一类）→≥2 不同类提醒拆票（不自动拆） | 依赖≠同类；否决进 out-of-scope |
| 3 阻碍 bug | 指令层（D28） | 发现阻碍 | 自动立票→全阻停下/可绕行继续→小 bug inline/深 bug 新会话（快照暂停）→修完回本会话→git WIP 不丢 | 已定稿 |

## 4. 技能文档见解（非 SKILL.md，直接可用）

1. **triage/AGENT-BRIEF.md — 耐久优于精确**：票面写接口/类型/行为契约，不写路径/行号
   （会过时）；Behavioral not procedural。→ 并进 D26（票面防核查）。
2. **triage/OUT-OF-SCOPE.md — 否决持久化**：`.out-of-scope/` 存拒绝理由 + dedup。
   → 并进 D28（拆票否决记录，防重复提醒/争论）。
3. **writing-for-agents/SKILL-MECHANICS.md — 上下文负载是显式成本**：每行常驻文本
   都有 load。→ 方向 2 规则宜放交接模板而非 persona（省常驻 + 守 D27）。
4. **PHASE-BOUNDARIES.md**：骨架（上文）。
5. codebase-design/DESIGN-IT-TWICE.md：并行 subagent 设计——印证 subagent=独立窗口用法，无新冲突。

## 5. 会话成本模型（D25 公式）

```
每会话成本 = 系统提示词(全局缓存≈1/10价, 拆票不受影响)
            + 会话内增量(前缀缓存, 拆票=清零)
            + 冷启动 prefill(零缓存, 拆票=N次)
            + 事实核查(handoff/票面精简 → 重查, 新会话必付; AGENT-BRIEF+快照化减支)
            + 交接读写
            + 风险: compact/handoff lossy(前缀失效+信息丢失, 拆太粗)
```
最优拆票粒度 = 总成本最小；缓存感知（共享知识越多越合）+ 100K 尺子（wayfinder 先例）。

## 6. 收敛决定（D29，2026-08-19）

**停止机制堆叠**。对照 matt 原版（PHASE-BOUNDARIES：*"These are judgement calls... the value is in asking them in order"*），量化仪表盘违背设计哲学——判断归人，不归传感器。

**保留（行为规则）**：
- D20 一会话一 issue · D21 外部动作门 · D22 纠正沉淀 · D24 票据出口 · D26 交接快照 · D27 persona 低频；
- workflow-enforcer 现状（基线 + 高危即时提醒）——轻机制，留。

**降级为定性参考（不实现传感器）**：
- 方向 1 水位（70/90）→ 回到 PHASE-BOUNDARIES 问题 1："边界处问一句：~150k 够不够下个 phase 装"；
- D25 成本模型公式 / 缓存感知拆票 / 100K 尺子 → 定性认知（理解为什么边界决策重要），不装仪表盘；
- D28 工作面判据阈值 → 定性："入口问一句这活一个窗口装得下吗"。

**不做**（除非实测 IRIS 真出问题再补）：workflow-enforcer 的自动化水位/起手式/阻碍检测。

**停手条件**：当前状态（六门 + enforcer 基线 + D20-24 规则）按 matt 原版节奏跑 1–2 周，看 IRIS；出问题针对那一个补一条规则。

## 7. 剩余可做（非仪表盘，规则类）

- [ ] B4（无 seam → 欠债 → to-tickets）——定性规则，写进 diagnosing-bugs 衔接；
- [ ] A4（突发阻碍 bug 另立票）——D20 细化，一句话；
- [ ] D24 TICKET EXIT ——需要时一句话并入 persona（D27 攒批原则下不急着改）。
