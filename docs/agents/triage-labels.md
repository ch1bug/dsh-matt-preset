# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label
strings used in this repo's issue tracker, and it is the **single** place where a label's meaning,
description and colour are written down (#128) — 别在别处再抄一份清单。

| Label in mattpocock/skills | Label in our tracker | 角色 | 含义（判据） | `--description` | `--color` |
| --- | --- | --- | --- | --- | --- |
| `needs-triage` | `needs-triage` | state | Maintainer needs to evaluate this issue | 待分诊评估 | `d93f0b` |
| `needs-info` | `needs-info` | state | Waiting on reporter for more information | 等报告者补信息 | `fbca04` |
| `ready-for-agent` | `ready-for-agent` | state | **完全不需要用户接入、无任何待决项** | 可交给 AFK agent（无待决项、无 user-in-the-loop） | `0e8a16` |
| `ready-for-human` | `ready-for-human` | state | RFA 任一条不满足 —— **≠ 需要 human 写代码** | 需 human 接入（≠ 亲手写代码） | `1d76db` |
| `wontfix` | `wontfix` | state | Will not be actioned | 不予处理 | `6a737d` |
| `bug` | `bug` | category | 缺陷 / 契约缺口 | 缺陷 / 契约缺口 | `d73a4a` |
| `enhancement` | `enhancement` | category | 增强 / 新能力 | 增强 / 新能力 | `a2eeef` |
| `scheduled` | `scheduled` | **正交**：不参与「恰一个 state」判定 | 已排入某个批次 | 已排入批次（正交于五状态） | `5319e7` |
| `P0` | `P0` | **正交**：只调优先级 | 阻断可用性 | 阻断可用性，优先于普通前沿票 | `b60205` |

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
