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

RFA 判据的**展开清单**（三条判据的逐条说明）与**存量 RFA 票的逐票复核**仍在 #101 ——
本文件只给词汇与判据的一句话定义，不复述那份清单（同一份清单只准写一份）。