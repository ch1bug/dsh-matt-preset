# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | 完全不需要用户接入、无任何待决项（判据清单与存量复核见 #101） |
| `ready-for-human`          | `ready-for-human`    | RFA 任一条不满足——**≠ 需要 human 写代码**（展开见 #101）   |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

**回读不变量**：每条票面建完 / 改完后核 `gh issue view <n> --json labels --jq '[.labels[].name]'` ——
**恰一个 category**（`bug` / `enhancement`）+ **恰一个 state**（上表五角色之一）。
缺 state 的票在任何按 state 过滤的面上都不可见。操作与理由见 `docs/agents/issue-tracker.md`。

**正交标签**（不参与「恰一个 state」判定）：

| Label | 含义 |
| --- | --- |
| `scheduled` | 已排入某个批次——**正交于五状态**，一张票可以同时是 `ready-for-agent` + `scheduled` |
| `P0` | 阻断可用性，优先级高于普通前沿票（与 state 正交） |

**RFA 判据**（三条：无待决项 / 无 user-in-the-loop 步骤 / 验证可在无人环境完成）与
**反向的存量复核**（现行 RFA 票逐票重判）在 **#101** ——本文件只管标签词汇映射，
不复述那份判据清单（同一份清单只准写一份）。

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.
