# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label
strings used in this repo's issue tracker, and it is the **single** place where a label's meaning,
description and colour are written down (#128) — 别在别处再抄一份清单。

| Label in mattpocock/skills | Label in our tracker | 角色 | 含义（判据） | `--description` | `--color` |
| --- | --- | --- | --- | --- | --- |
| `needs-triage` | `needs-triage` | state | Maintainer needs to evaluate this issue | 待分诊评估 | `d93f0b` |
| `needs-info` | `needs-info` | state | Waiting on reporter for more information | 等报告者补信息 | `fbca04` |
| `ready-for-agent` | `ready-for-agent` | state | **可排批：拍板已齐、无 human 决策点，尚未锁定批次**（#141 对齐邻仓措辞；展开判据见下节） | 可排批：拍板已齐、无 human 决策点，尚未锁定批次 | `0e8a16` |
| `ready-for-human` | `ready-for-human` | state | RFA 任一条不满足 —— **≠ 需要 human 写代码**；**挂标签须附解冻条件**（照邻仓，#141） | 需 human 接入，挂标签须附解冻条件（≠ 亲手写代码） | `fbca04` |
| `wontfix` | `wontfix` | state（**判决标签**：记「为什么关」，非工作位置；关票随清时**保留**，见下） | Will not be actioned | 不予处理 | `ffffff` |
| `bug` | `bug` | category | 缺陷 / 契约缺口 | 缺陷 / 契约缺口 | `d73a4a` |
| `enhancement` | `enhancement` | category | 增强 / 新能力 | 增强 / 新能力 | `a2eeef` |
| `scheduled` | `scheduled` | **正交**：不参与「恰一个 state」判定 | 已排批锁定：`batch-state.md` 成员表有该票归属 | 已排批锁定（batch-state.md 有成员归属） | `5319e7` |
| `no-batch` | `no-batch` | **正交**：不参与「恰一个 state」判定 | 明确不可入批，排批会话跳过；适用面是 `ready-for-agent` 里明确不该进批的票（RFH 票本就不进批，**不挂**）；**摘除条件写在票内**——条件满足（票可入批 / 票关闭）时摘除 | 明确不可入批，排批跳过（摘除条件见票内） | `d4c5f9` |
| `tracking` | `tracking` | **正交**：不参与「恰一个 state」判定 | 追踪母票：子票完成即关，无需人类判断 | 追踪母票（子票完成即关） | `c5def5` |
| `P0` | `P0` | **正交**：单档例外轴，不参与「恰一个 state」判定 | **单档**：挂 = 例外，不挂 = 常规。判据口径：**用户或本仓主流程无法完成一次基本操作**（"某条可选路径跑不了""测试假红""文档认知过时"都不算）。作用面两处：① #136 插队规则的**输入判据**（规则本体在 #136，本票 #142 只写判据）；② `frontier.mjs` 可见标记（不驱动排序）。**谁设**：agent 举证（「建议 `P0`：<哪个可用性被阻断> · 依据 <失败证据>」）、human 裁定后才落标，取消同路径，留痕 = 票面评论两条。**关票 / `wontfix` 时摘除**（housekeeping，不升格为不变量）。拍板记录见 #142 评论区（2026-10-20 grill） | 阻断可用性（单档例外轴，判据见 #142） | `b60205` |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string
from this table.

**回读不变量**：每条票面建完 / 改完后核 `gh issue view <n> --json labels --jq '[.labels[].name]'` ——
**恰一个 category**（`bug` / `enhancement`）+ **恰一个 state**（上表五个 state 之一）。
缺 state 的票在任何按 state 过滤的面上都不可见。操作与理由见 `docs/agents/issue-tracker.md`。

**落法**：`gh label create <label> --description "<该行 --description>" --color <该行 --color>`
（既有标签用 `gh label edit`）——**命令从本表取，不另抄一份**（手抄的描述/颜色正是漂移的种子）。
**执行属外部动作**：改动 GitHub 标签前先报告，等确认。

## RFA / RFH 判据（展开清单，#101）

**RFA（`ready-for-agent`）= 完全不需要用户接入且无待决项。三条判据，全部满足才可打**：

1. **无待决项** —— 没有等 human 拍板的设计点 / 范围选择 / 口径选择；
2. **无 user-in-the-loop 步骤** —— 不需要实机验证、不需要 human 提供凭据或环境、不需要人在场观察；
3. **验证可在无人环境完成** —— 全部验收命令在 agent 环境可跑、可判。

**RFH（`ready-for-human`）= 三条任一不满足，一概 RFH。RFH ≠ 需要 human 写代码** —— human 的接入
可以是拍板、补信息、实机动作；「要 human 接入」与「要 human 亲手改代码」是两回事。
**挂 `ready-for-human` 须附解冻条件**（照邻仓口径，#141）：说明补齐什么 / 拍掉什么之后票才能回到
RFA——没有解冻条件的 RFH 是死票。

## scheduled ⇄ ready-for-agent 动态互斥切换（#141，human 2026-10-19 拍板）

`ready-for-agent` 与 `scheduled` **互斥**：一张票同刻只可有其一。RFA 的语义是「可排批……**尚未
锁定批次**」——一旦锁定（进批）即切 `scheduled`。四个时刻（正交轴标签，不参与「恰一个 state」判定）：

| 时刻 | 切换 | 动作 |
| --- | --- | --- |
| **进批** | `ready-for-agent` → `scheduled` | 批次宣告把票写进成员表时 |
| **改批 / 出批** | `scheduled` → **切回** `ready-for-agent` | 票被移出批次或换批（IRIS 口径：排批是动态的，改批会切回去） |
| **关票随清** | 一并摘除（`scheduled` 与 state 标签都摘） | 见下「关票随清」口径 |
| （`no-batch` / `tracking` 不参与切换） | — | `no-batch` 按票内摘除条件摘；`tracking` 随母票生命周期 |

- **切换责任在排批会话**：不是实现会话、不是收尾会话的事。
- **与 `batch-state.md` 成员表同一次动作完成**：挂/摘 `scheduled` 必须与成员表的增删是**同一个
  操作步骤**（先改标签再补表、或反之，中间隔会话 = 两边漂移）。
- **关票随清**（human 2026-10-20 拍 C）：任何关票动作**连带摘 state 位置标签**
  （`ready-for-agent` / `ready-for-human` / `needs-triage` / `needs-info` / `scheduled`）——
  票关了「位置」就不存在；**保留 `wontfix`**（判决标签，记「为什么关」，属历史事实）。
  否则死票污染 `gh issue list --label <state>` 读数（本仓反复在治的陷阱）。

**拍批不算 RFH 决策项**（human 原话口径，#101 票题）：批次宣告 / 排批是规划侧动作，不命中判据 1。
两个同族已拍例外一并记在这里：

- **D21 外部动作门不算 user-in-the-loop**（human 2026-10-19 拍 A）：关票 / 改标签 / push 前的
  「报告后确认」是确认闸，不命中判据 2；但「要不要做 / 走哪条路」仍算待决项（判据 1）。
- **三件实测例行自决**（#123 折叠进 #101 的 Z1）：① 交付评论发不发；② 批内 auto-handoff
  （D31「批内顺序固定，宣告即指派」）；③ 按标签表直推 label —— 三件都归**例行**，自决后留一行
  `decided X because Y` 进交付评论。⚠ **穷举会漏，规则是兜底**：点名不等于封闭清单，
  其余同类动作按判据本身判。

边界：本节与 #94（goal 适配性 / 等 human 介入类）同族不同面，**不合并**；小微票合并判据
（#122 裁定、由 #143 落地）在 `docs/agents/issue-tracker.md` 的「分诊产出前置项」——两票各改一处，
与本节不重叠。

**同步面声明（D16b 处置先例）**：本节三条判据与 `workflow-body.txt` 的 RFA 契约段（#123/#128
落地的实现侧正典：「pick a direction / supply a credential or environment / judge a real-UI run /
be present」）语义一一对应，但两边**不互钉**——本仓套件不钉本文件（漂移靠人肉比对）。

存量 RFA 票的逐票复核证据在 #101 的交付评论里（2026-10-19 起的历史记录，不随实现漂移）——
本文件不复述，同一份清单只准写一份。
