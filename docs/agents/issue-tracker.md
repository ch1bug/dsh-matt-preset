# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **空输出 ≠ 命令失败**：`--jq '.comments[]'` 对「无评论」返回**空串**（原始 `--json comments` 是
  `{"comments":[]}`，一个空数组）——别据此判"gh 坏了"去查 `gh --version`（2026-10-20 #129 实测白一次往返）。
  判据：**先看 `--json` 的原始结构**，再决定"空"是数据还是故障（同 `docs/code-review-brief.md` §8 的 D16：
  探针的"空结果"与"失败"必须能区分）。
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

### D21 确认通道（headless / 无人值守场景）

外部动作门（D21）要求的「human 确认」在 headless / 无人值守会话里：**结构化提问工具
（AskUserQuestion 一类）的明确应答 = 合法确认形态**（156族批 #141 建标签实测走通）；确认必须
落在**可回读的记录面**（工具问答记录或票面评论）——agent 自述「human 已同意」不算（与 #156/D52
同族口径：不用 agent 自述证明 human 授权）。等不到确认通道时如实 **blocked**，不跳门、不降级为
「先做了再说」。

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

**票内指针先跑存在性**（写票与分诊同规）：票面里指向文档落点 / 先例 / 现查值的每一句，
落笔前先跑一条**存在性命令**（`git grep -n` / 现查命令），查无实据就不写死——`#103` 实测票面
称 `--ff-only` 先例在 `docs/RELEASE.md`，grep 零命中（实际在 `dev-environment.md` 与
`privacy.md`）；实施者被迫做 D9 口径修正，修正成本落在实施期。**同规两条（161族批 retro）**：
① **引用他票状态（「已落地 / 已拍板」）= 现查动作**——`gh issue view <n> --json state` 当场跑，
写票时不许凭记忆断言他票状态（#157 票面称「#117 已落地」，实测 OPEN——同族第 3 次复发）；
② **判据输入（锚句 / 正则 needle / includes 字面）写进票面或断言前先 grep 实测**——确认单行
可达、跨行断句不咬（#157 声称表首跑 SG7 三处锚句失配）；**写「行集合」类判据先问嵌套行算不算**
（#117 实测：YAML 顶层数组元素 ≠ 全部 `- id:` 行，嵌套 `cordis:group` 子行漏计产生幻影缺口——
#129 同族再犯）。

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

**两条写作纪律**（都来自实测，不是洁癖）：

- **描述缺陷时不复述被禁字样**：票面要说明「该改哪个词」时，写「跑 `scripts/triage-check.mjs` 即见」+ 引票号，别把词抄进正文——抄进来就是命中（#130 的第一版草稿就这么红了两次）。
- **空正文不是「没有冲突」，是取数失败**：判据对空输入**响亮**（exit 2 并点名取数写法），先修命令再重跑。取票面正文用 `gh issue view <n> --json body --jq .body`——`--jq` 只收一个参数，写成 `--jq -r .body` 会被 gh 拒（`accepts 1 arg(s), received 2`），于是变量为空、判据报「四类核对全缺」，把人骗去追不存在的编码问题（2026-10-19 实测）。

与 `docs/code-review-brief.md` **§2.5** 的关系：§2.5 是**复核期**的兜底（票面可证伪断言 + AC
互斥），本节要求**前移**——分诊期就做掉，复核期只验证「确实做过了」。**§2.5 不废除。**

分诊产出除了**冲突归零**，还有一步**判粒度**：这张票够不够小到能和邻票**合成一张**。判据由
**#122** 拍定（本节只落地口径，论证在 #122 的决策记录里，不复述）。下面四小节都是**判据**，
不是机制。

### 小微判据（四条并列，全部成立才算「小微」）

「小微」是**合取**，不是打分：四条**全部成立**才算，任一条不成立就不是。

| # | 判据 | 判法（输入 → 判红条件） |
| --- | --- | --- |
| ① | touch-set ≤ 2 个文件 | 取票面声明的写域文件集（与 `sandcastle/templates/audit-ticket.mts` 的 `touchSet` 同源）。**数文件，不数条目**：目录声明（形如 `docs/agents/`）先**展开成它包含的文件**再数；**总数 > 2 即判红**。（「目录按 1 条计」会放过「目录里 2 文件 + 另 1 文件」这种 3 文件 / 2 条目的票——那正好是该判红的那张） |
| ② | 无未决项 | `node scripts/triage-check.mjs <body-file> --rfa` → **exit 0** 才算成立。⚠ 该脚本把「自认还有待决项」与「词表命中 / 四类核对缺类」**一起**判，所以 exit 0 是**三项合成的绿**（刻意取严：缺四类核对的票本来也不该进 RFA 面）；只想单看 ② 一项，看红行「✗ … 自认还有待决项：<名>」那句（绿行是「无待决项自认（N 条）」）。**exit 2 是取数失败，不是「无未决项」** |
| ③ | 证明命令（proving）唯一 | 票面恰 **1 条**最小证明命令（字段名以 `docs/batch-state.md` 的「证明命令」为准，本节也用它）。0 条 = 票面没写完（不是小微，是没写完）；≥ 2 条 = 验证面分叉，判红 |
| ④ | 不跨模块接口 | 票面**不新增、不删除、不变更任一导出**。判法：写域计划里出现「加导出 / 改导出」即不成立；复核期机械兜底 —— `git diff -U0 <fixed-point> -- <touch-set>` 里出现**行首为 `export` 的增删行**即判红（`grep -E '^[+-]\s*export\b'`）。**`---`/`+++` 头行与注释里的 `export` 都不算**（否则文件名带 `export` 或一句「本次不改导出」的注释就假红），改函数体 / 内部常量也不算。**只对代码文件判**（`.mjs` / `.mts` / `.js` / `.ts`）—— `.md` 里行首的 `export` 是 shell 示例，不算。**不覆盖**：CommonJS 的 `module.exports`（本仓是 ESM）与行首不是 `export` 的间接变更 |

**与 `lane`（D38）正交，不是同一维度的第二份**：`lane` 量「**用哪个模型**」（决策/架构/治理 vs
docs-only），这四条量「**写面规模 + 判断量**」—— 一张 docs-only 的票可以很大，一张代码票可以极小。
**不设 XS/S/M/L、不设 1–3**：分档没有判据来源，本仓也没有任何决定消费这个排序 —— 排批吃的是
**依赖边 + 写域不相交**（边见本文「Ready frontier」节；写域见 `sandcastle/templates/audit-ticket.mts`
的 `--touch-overlap`），不吃粒度排序。

### 关联判据（三条，任一命中即「有关联」）

关联靠**结构化输入**判，不靠「看着相关」。三条**任一命中**即有关联：

| # | 判据 | 判法（命令 / 输入 → 命中条件） |
| --- | --- | --- |
| ① | 写域相交 | 判据 = 两票的 touchSet **直接相交**，规则以 `sandcastle/templates/audit-ticket.mts` 的 `pathsOverlap` 为准：**精确相等，或一方以「另一方 + `/`」开头**（路径**段**前缀，不是裸字符串前缀——差那根斜杠就不算）。现成扫描器：逐票 `npx tsx sandcastle/templates/audit-ticket.mts --issue <n>` 落 `.sandcastle/audits/<n>.json`，再跑 `--touch-overlap`；⚠ 它给的是**串行分组**，并查集是**传递**的（A～B、B～C ⇒ A 与 C 同组，但可能毫无交集），所以「同组」只说明存在相交链 —— **判相交仍要两票互比**，`overlapFiles` 只用来定位相撞路径。扫描器需 `tsx` + 逐票 audit 记录，两者缺席时按同一规则手工比 |
| ② | 验证面相同 | 两票的证明命令**逐字相同**，或两者落在**同一个用例文件**（`tests/*.mjs` 同一路径）。前者字符串比对，后者路径比对 |
| ③ | 同一 umbrella 子票组 | GitHub **原生 sub-issue 边**（不是正文里的 `Part of` 文本）：`gh issue view <n> --json parent --jq .parent.number`（无父票时 `null`）；两票的父票号**相等且非 null** 即命中。批量版：`gh issue list --state open --json number,parent` 后按 `.parent.number` 分组 |

**关联命中 ≠ 可出提案**：关联回答「和谁**一起**」，小微回答「够不够格」——#122 Q1 的提案本体
就是「**N 张小票** → 1 张」（「小」的判据就是 Q2 那四条），所以成员必须**全部**过小微；大票不因相关
而合并（否则「关联」会把两张 L 票焊成一张，D33 的会话粒度也就名存实亡）。

### 「可合并」提案格式

分诊收尾**可以**产出**一条文本**（提案不是动作）：**不自动合并、不自动关票** —— 建合并票与关
原票都是 D21 外部动作，要 human 确认；合并后仍是「一票一会话」（D33 不动）。**五件齐全**才算提案
（漏掉「代价」= 照抄的人静默丢一条强制项）：

```markdown
## 可合并提案：<N> 张 → 1 张

- **成员**：#<a>、#<b>（每张都过小微四条；逐张给 `triage-check --rfa` 的 exit 0 读数）
- **命中判据**：关联① / ② / ③ —— <判据名>；依据 = `touch-overlap.json` 的 groups / 同一用例
  文件路径 / 同一父票号。多命中逐条列，不合并成一句「都相关」
- **合并票写域**：<并集>
- **Z 映射（原票 AC → 合并票 AC，逐条，不许「同上」）**：

  | 原票 | 原 AC（逐字摘） | 合并票 AC（改写后的落点） |
  | --- | --- | --- |
  | #<a> | <AC 原文> | <合并票第 1 条> |
  | #<b> | <AC 原文> | <合并票第 2 条> |

- **代价（合并前必须写下）**：证据链（漏一条 Z 映射 = 那张原票关不得）/ 失败面（一张的异常
  路径会吞同组的时间）/ 复核面（一次复核覆盖 N 张原票）/ 批次面（batch-state 的 Progress 行
  要能指回原票号）
```

**Z 映射两条硬规矩**：**不许丢**（原票每条 AC 都有落点，可改写不可删）；**不许加**（合并票不得
有原票没有的新 AC —— 新 AC 是新决策，另立票，D24 票据出口）。

**格式样板**（票号占位，**不是**真实提案）：

```markdown
## 可合并提案：2 张 → 1 张
- 成员：#<A>、#<B>（各自 `triage-check --rfa` → exit 0）
- 命中判据：关联① 写域相交（两票 touchSet 同含 `docs/agents/issue-tracker.md`）
- 合并票写域：`docs/agents/issue-tracker.md`
- Z 映射：
  | 原票 | 原 AC（逐字摘） | 合并票 AC（改写后的落点） |
  | --- | --- | --- |
  | #<A> | 把小微四条写进 tracker 文档 | 1. tracker 文档的小微表含四条，每条带「判法」列 |
  | #<B> | 文档补关联三条、提案格式与可判性扰动表 | 2. 同文档含关联三条（任一命中）与提案五件；3. 含可判性扰动表 |
- 代价：证据链 = 上面 2 条原 AC 折成 3 条落点、无遗漏；失败面 = #<B> 的异常路径会吞 #<A> 的时间；
  复核面 = 一次复核覆盖 2 张原票；批次面 = Progress 行要能指回 #<A> / #<B>
```

**照抄样板里的占位格 = 没写 Z 映射**：每一格都要换成真实 AC 原文。样板第二行还示范了另一件事
——**一条原 AC 可以拆成两条落点**（「可改写」），但**不许**反过来把原 AC 丢掉。

### 判据的可判性（扰动用例：任一条不命中就别把它算进提案）

| 扰动输入 | 期望读数 |
| --- | --- |
| touch-set 3 个文件 | ① 判红 |
| 票面跑 `triage-check --rfa` 有红（含自认还有待决项） | ② 判红 |
| 证明命令 2 条 | ③ 判红 |
| 写域计划含新增 / 变更导出 | ④ 判红 |

**这一节是判据，不是机制（D29）**：不新增字段、不新增脚本、不新增注入。它只读已经存在的输入
—— 票面 touch-set / `scripts/triage-check.mjs` / 票面的证明命令 / audit 记录的 `touchSet` /
GitHub 原生 sub-issue 边。**没有新传感器。**

⚠ **声明边界（不装成守卫）**：**小微四条与关联三条这两张表没有守卫** —— 删掉其中任一行判据，
`verify-all` 仍**绿**（实测见 `.scratch/verify143/perturb.txt`：删掉小微 ① 整行 → exit 0）。
同节上半的**三张清单**（机械面 / RFA 互斥面 / 人判面）**不在**这个边界内：T3 / T3b / T4 逐词钉着
它们，删一个词就红。能机械判的只有两件**输入**：小微 ② 的 `triage-check` 退出码、关联 ① 的
相交分组；「这张是否 ≤ 2 文件」「这张算不算小微」**都没有守卫**。这是刻意的：AC 面不新增脚本
（D29），判据靠分诊会话**照上表跑**；所以上表是**配方，不是证据** —— 证据是跑出来的读数，
本仓套件里没有它。要给这两张表加机械守卫，先想清守卫长什么样 —— 新脚本 = 新机制，D29 另议。

## Ready frontier（可开工票集合）

排批 / 预检的输入 = **open + `ready-for-agent` + 无 open 阻塞 + 无 assignee**。现算，不读票面文字：

```sh
node scripts/frontier.mjs              # 默认 ready-for-agent（不印票数：数字会漂）
node scripts/frontier.mjs --label ready-for-human
node scripts/frontier.mjs --json       # 排批输入：frontier + gated(含理由)
```

`P0` 票的读法（#142）：人读输出的 **frontier 段**带 `[P0]` 前缀（gated 段只印票号+理由，不带），`--json` 的条目带 `p0: true/false` 字段——
它只是**正交例外轴的可见标记**（插队输入判据见 #136），不改变 frontier 的成员判定，
也不改变排序（仍按票号升序）。

它只走 **GitHub 原生依赖边**（`.../issues/<n>/dependencies/blocked_by`）。读图陷阱（逐条并列，新增追加在后）：

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
- **计数陷阱**：`gh issue list` **默认 `--limit 30`** —— 2026-10-19 实测 open 51 张，裸命令
  `gh issue list --state open --json number --jq length` 只回 30，差点被判成"环境快照不符"而停工。
  计数一律加 `--limit 200`（或 `gh api --paginate`）；裸命令回的 30 是**分页**，不是事实。

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
