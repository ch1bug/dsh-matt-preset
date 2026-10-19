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

**描述与颜色统一**（`gh label` 的落点；**执行是外部动作**，改动 GitHub 标签前先报告）：

| Label | 角色 | 描述（`--description`） | 颜色（`--color`） |
| --- | --- | --- | --- |
| `bug` | category | 缺陷 / 契约缺口 | `d73a4a` |
| `enhancement` | category | 增强 / 新能力 | `a2eeef` |
| `needs-triage` | state | 待分诊评估 | `d93f0b` |
| `needs-info` | state | 等报告者补信息 | `fbca04` |
| `ready-for-agent` | state | 可交给 AFK agent（无待决项、无 user-in-the-loop） | `0e8a16` |
| `ready-for-human` | state | 需 human 接入（≠ 亲手写代码） | `1d76db` |
| `wontfix` | state | 不予处理 | `6a737d` |
| `scheduled` | 正交 | 已排入批次（不参与 state 判定） | `5319e7` |
| `P0` | 正交 | 阻断可用性，优先于普通前沿票 | `b60205` |

```sh
# 新建（本仓尚不存在的两个正交标签）
gh label create scheduled --description "已排入批次（正交于五状态）" --color 5319e7
gh label create P0        --description "阻断可用性，优先于普通前沿票" --color b60205
# 既有标签的描述 / 颜色统一（逐条照上表；改动前先报告 —— 外部动作）
gh label edit needs-triage     --description "待分诊评估" --color d93f0b
gh label edit ready-for-agent  --description "可交给 AFK agent（无待决项、无 user-in-the-loop）" --color 0e8a16
gh label edit ready-for-human  --description "需 human 接入（≠ 亲手写代码）" --color 1d76db
```

**RFA 判据**（三条：无待决项 / 无 user-in-the-loop 步骤 / 验证可在无人环境完成）与
**反向的存量复核**（现行 RFA 票逐票重判）在 **#101** ——本文件只管标签词汇映射，
不复述那份判据清单（同一份清单只准写一份）。

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.
