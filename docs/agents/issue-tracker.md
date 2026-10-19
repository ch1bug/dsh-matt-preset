# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## 标签回读不变量（建票 / 改票后必核）

**每条票面写完后回读一次标签**，不靠「我刚才好像加了」：

```sh
gh issue view <n> --json labels --jq '[.labels[].name]'
```

判据 = **恰一个 category**（`bug` / `enhancement`）+ **恰一个 state**（`needs-triage` /
`needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix` 之一）。缺了就用
`gh issue edit <n> --add-label` 补上，再回读一次。

**为什么是不变量而不是习惯**：没有 state 的票在**任何按 state 过滤的面**上都不可见——
`frontier`、`gh issue list --label`、批内盘点都读不到它。本仓 #126 / #127 就是这样建出来的
（只有 `bug`、无 state）；邻仓实测一次会话连建 4 张票**全漏 state**，一张都进不了面。

正交标签 `scheduled`（已排入批次）与 `P0`（阻断可用性）**正交于**五状态：`scheduled` **不参与**
「恰一个 state」判定，`P0` 只调优先级。词汇 / 描述 / 颜色在那份唯一落点上：
`docs/agents/triage-labels.md`。

## 分诊产出前置项（冲突归零）

分诊（triage）与 grill 的产出**不止**「票面写清 + 打标签」，还有一步：**冲突归零**。
「冲突」指下面四类，**每一类都要在票面里写出处置结论**，写不出就**不许打 RFA**：

| 类 | 判据 | 归零动作 |
| --- | --- | --- |
| **① 票面内部** | AC 之间互斥、正文与验收节矛盾、两处对同一事的口径不同 | 改到一致（算术可行性也在这里判） |
| **② 票面 vs 实测** | 票面写的现象 / 根因与 HEAD 不符 | **重测**（一条命令 + 读数，D9），或标注「未实测，按此假设」 |
| **③ 文档 vs 实测** | 票面引用的 ADR / CONTEXT 决策 / `docs/**` 与票面相反或已过期 | `git grep -n <票面关键词> -- docs/ *.md` 逐条判「仍成立 / 已过时」；不一致的**已改**或**票面显式声明以本票为准** |
| **④ 票级** | 与其它票重复、依赖边方向错、批次归属相冲 | 查重 / 修边 / 重新归批（与同批成员的写域与判据不得交叉） |

**三种出路**（每条冲突必须选一个，**不是记下来就算归零**）：

- **(a) 消解**：改票面或改文档，使两者一致 —— 给出改后的逐字口径；
- **(b) 拍板**：需要 human 决策的，**分诊 / grill 阶段就问掉**，把结论写进票面（问在开工前）；
- **(c) 显式声明**：确实无法在分诊期消解的，写**唯一口径 + 依据**，并标注「此项已定，实现时不得再问」。

**措辞黑名单**（出现即在推诿决策，等同「有一类冲突没读」）：

- **机械面**（`scripts/triage-check.mjs` 会红）：`草案` / `可微调` / `时微调` / `视情况` /
  `酌情` / `待定` / `TBD`。
- **RFA 互斥面**（标了 RFA 时出现即红）：`要 human 决定`（含「需 / 由」变体）/ `human 拍板` /
  `实现时再定`（含「到时再定 / 到时再问 / 实现时再问」变体）—— 这些句子是「还有待决项」的
  自认，而 RFA 的定义就是不待决。非 RFA 票写它们是对的，所以只在 `--rfa` 时判。
- **人判面**（工具判不了，**如实声明**不装成守卫）：`或`（并列选项语境）、`建议`（"要不要做"
  语境）、挂在决策上的裸 `?`。

**这份清单只有两处**：判据（`scripts/triage-check.mjs` 的 `BLACKLIST` / `PENDING_DECISION`）
与本节（口径），由 `tests/verify-triage-check.mjs` 的 T3 / T3b **逐词钉住**。正文与 minimal
档位**只指向、不复制**——T9 断言那两份模型真读到的文本里，**两张清单的任一个词**都不出现
（复制一份就会红）。

用法：`node scripts/triage-check.mjs <body-file | ->`（读票面正文；`--rfa` 时额外要求
「四类核对」声明在场）。**票面在 GitHub，套件不联网核**（D15）：这个脚本由分诊会话**手动**跑，
`tests/verify-triage-check.mjs` 只用夹具样例守它的判据，不去查线上票。

与 `docs/code-review-brief.md` **§2.5** 的关系：§2.5 是**复核期**的兜底（票面可证伪断言 + AC
互斥），本节要求**前移**——分诊期就做掉，复核期只验证「确实做过了」。**§2.5 不废除。**

## Ready frontier（可开工票集合）

排批 / 预检的输入 = **open + `ready-for-agent` + 无 open 阻塞 + 无 assignee**。现算，不读票面文字：

```sh
node scripts/frontier.mjs              # 默认 ready-for-agent（不印票数：数字会漂）
node scripts/frontier.mjs --label ready-for-human
node scripts/frontier.mjs --json       # 排批输入：frontier + gated(含理由)
```

它只走 **GitHub 原生依赖边**（`.../issues/<n>/dependencies/blocked_by`）。两个读图陷阱：

- `issue_dependencies_summary.blocked_by` **只计 open 阻塞**——已关闭的阻塞（历史边）读数是 0，
  但边仍在（看 `total_blocked_by`）。2026-10-16 曾据此把"已满足的历史边"误判成"缺边"。
- 正文里的 `## Blocked by` 段只是叙述，会过期（#61 曾正文写 `None.` 而边是 `← #59`）。
  改阻塞关系 = 改**边**，正文顺手对齐。
- **已 DONE 但未关的票仍算 open**：frontier 会把它们算进可开工（B 批读数 2026-10-19：
  28 vs 真实 25 —— 再引用前按 `gh issue list --state open` 重测，读数带命令与时点）。
  排批前先按 `docs/batch-state.md` 的「收口记录」把它们剔掉——否则排队数字永远虚高。
- `gh issue view <n> --json blockedBy` **读空数组（假）**：2026-10-17 实测 #57 / #58 / #59 / #60 全返回 `[]`，
  同一时刻 REST `.../dependencies/blocked_by` 有值（`#59 ← [56,57,58]`）。查边一律走上面那条 REST 命令——
  别把空数组读成"边已掉"（gh 2.96 实测）。

纯逻辑（label 命中 / open 阻塞 / assignee / 大小写 state）由 `tests/verify-frontier.mjs`
离线断言；CLI 那半截需要 PATH 上有已登录的 `gh`，任何 gh 失败都响亮退出——绝不把
"接口挂了"伪装成"没有阻塞"。

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
