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

## 需求守恒与接线移交（#148）

每条**已批准要求**（批准的 spec 条目、票面 AC、grill 拍板的结论）跨阶段守恒：从授权决策、
分诊与拆票，到实施、Spec 复核和关票，逐条可追踪到真实交付去向。本节是判据单源；常驻注入面
（batch 组件的 TICKET ENTRY CONTRACT 区）只留义务句与本节指针，复核消费入口在
`docs/code-review-brief.md` §2 的 5d 条，匿名正反样例集在
`docs/requirement-conservation-examples.md`。不建新平台、不改一票一会话、不引入第二套
依赖图或标签。

### 去向映射（分诊 / 拆票产物的判定判据）

拆票（/to-tickets 票组）与分诊产物对每条已批准要求给出**恰一个**去向，合法去向**恰为三值**：

| 去向 | 判据 |
| --- | --- |
| **本票兑现** | 本票 AC 含该要求，且实施证据（命令 + 退出码 + 证据路径）覆盖它 |
| **已存在的承接票** | 承接票**已存在**（不是「打算建」），且其 AC 文本明确含同一要求 |
| **获明确授权的目标变更** | human 已拍板改目标（gate 3 恒 L2 类：范围扩张 / AC 改写 / triage 三选一），授权记录在场（票面评论 / 决策日志），**不是实施者自行认定** |

「后续再说」「暂不处理」「已向相关方披露」**都不是去向**——未兑现的原目标**保留未完成状态**，
披露动作不免除交付义务。关票结论按同一映射自检，三值无一成立不得声称兑现
（样例集 F2 的责任归属同此）。

三种事实明确区分，不混用：**决策已定**（human 拍板了去向）≠ **单票关闭**（某张票走完自己的
出口）≠ **能力可用**（整条要求有真实验证证据）。子票全部关闭**不证明**整条能力可用——能力
结论只能来自承接要求的票的验证证据，缺了就如实报「未完成」。

### 接线移交（双向成立判据）

一张票把一条要求移交给另一张票，移交**双向成立**才算数：

- **发送侧**：票面明确指出接收票（票号在场）；
- **接收侧**：接收票的 AC 文本明确承接同一连接（AC 含该要求本身，不只是挂着一条依赖边）。

三形判红：只写「后续由某票处理」（接收侧未承接）；接收票不存在（或只是打算建）；接收票存在
但 AC 未承接该要求。单方移交 = 移交不存在 = 原目标仍由发送票负责。

**与原生阻塞边分工**：blocked-by 依赖边只表达**排程先后**（先 A 后 B），**不等于**功能连接
已验证——连接验证 = 接收票侧对该要求的 AC 证据（命令 + 退出码）。排程边照旧走 GitHub 原生
依赖（见 Ready frontier 节），本节不给它加新语义，也不新增第二套边或标签。

### 机械面与边界

- 机械守卫钉**文本送达与入口在场**：`tests/verify-requirement-conservation.mjs`（常驻义务段
  在四档组合注入面、本节三值与双向判据锚句、复核入口 5d、样例集指针互相可达；扰动摘除判红）。
- **语义判断由评审承担，显式声明不覆盖**（D16b 同族）：某张接收票的 AC 是否**真**承接了要求、
  实施证据是否**真**覆盖、一处改写算不算静默改目标——没有自然语言完备判定，不新增运行态
  传感器；分诊 / 拆票会话照本节判，Spec 复核照 `docs/code-review-brief.md` §2 5d 判。
- 与既有机制的分工：冲突归零（上文「分诊产出前置项」）管**冲突处置**，TICKET EXIT（gate 7）
  管**范围外工作转票**，本节管**已批准要求的去向与移交成立**——三者在分诊 / 拆票产物上交汇，
  互不替代。取消或改写需求永远走 gate 3 的 L2（human 拍板），实施者与复核者都不得自行取消。
- 与邻票分工：#136 泳道契约管**排批审计**（哪些票进 lane、怎么串并行），退役判据见本文
  「退役判据：未接通 ≠ 无职责」节（管**能力下线**）——排程先后与退役都不在本节；本节只
  消费已经获得授权的目标变更。

## 退役判据：未接通 ≠ 无职责（#149）

模块无数据源、无调用方时，先核对已批准目标与原定能力链，区分生产端和消费端断点；
涉及停用仍有职责的能力时，退役结论需要**正面依据**和**授权确认**。目标：防止把尚未
完成的能力误判为多余能力，**不是一概保留所有代码**。本节是判据单源；常驻注入面
（batch 组件的 TICKET ENTRY CONTRACT 区）只留义务句与本节指针，复核消费入口在
`docs/code-review-brief.md` §2 的 5e 条，匿名正反样例集在
`docs/retirement-criteria-examples.md`。

### 四分类（断点判定，先分类再谈去留）

「无调用 / 无数据 / 暂未使用」只是**调查线索**，不单独证明模块无价值或目标已取消；
调查要写清四件事：**原定目标、缺失的连接、拟承接的责任、事实边界**（测了什么、
没测什么）。分类判据：

| 类 | 判据 | 对去留的含义 |
| --- | --- | --- |
| **生产端缺失** | 模块职责就绪，但其输入的数据源 / 上游生产链未接通（无数据是这一类的线索） | **不退役**——补生产链或立票承接（TICKET EXIT） |
| **消费端缺失** | 模块产出就绪，但原定消费方未接上（无调用方是这一类的线索） | **不退役**——查原定消费者与接线责任（移交成立判据见上节），接线缺口立票承接 |
| **目标已取消** | human 已拍板取消该目标（gate 3 恒 L2），**授权记录在场**（票面评论 / 决策日志，可回读） | **可退役**——按授权范围退役，原目标保持「已取消」状态，不是漏接 |
| **同职责实现已替代** | 另一实现对本模块职责**逐条**覆盖且有覆盖证据在场 | **可退役**——未覆盖的职责保留（部分覆盖 → 部分退役，见样例集 E3） |

「已向相关方披露」「后续再说」不构成目标取消（同上节去向封闭：三值之外无去向）。

### 退役结论的证据门槛（仍承担已批准职责的模块）

退役（删除 / 停用 / 摘出维护）一个**仍承担已批准职责**的模块，结论必须**三件齐全**：

1. **正面依据**：目标取消的授权记录（human 的 L2 拍板）**或**同职责替代的逐职责覆盖
   证据——二选一，缺席即不得退役；
2. **影响范围**：谁在消费它、退役后哪些链路断、上下游各自的承接去向；
3. **未覆盖职责**：替代面没接住的职责**逐条列明**，不许「已全部覆盖」一笔带过。

涉及取消**产品能力**（不只是内部实现去留）：取得项目授权决策者的明确确认后执行——
沿用现有决策边界（gate 3 L2）与外部动作门（D21）；建表 / 删表、批量删数据这类高风险
动作按其**本体**定性走对应门，**不包装成普通清理**。

### 正常清理保留（判据的另一半）

可证明**无职责损失**的清理照常走，**不新增人工确认轮**：

- 真实不可达分支（D12 同族：复核抓到即删）；
- 可证明冗余的重复实现（职责完全重复、无切换成本）；
- 内部重复代码的重构（既有重构纪律不动）。

判据问句区分两类对象——**「这块代码没有职责，还是它的职责还没人接？」**：前者的
证据是结构性的（没有生产者 / 没有出口 / 没有职责声明），后者的证据是历史性的
（有批准记录、有原定接线）。既有死分支清理与重构纪律（`docs/code-review-brief.md`
§8 D12 等）**不废除**，本节只补「未接通能力」与「无职责实现」的区分判据。

### 机械面与边界

- 机械守卫钉**文本送达与入口在场**：`tests/verify-retirement-criteria.mjs`（义务段
  四档送达、本节四分类与门槛锚句、复核入口 5e、样例集指针互相可达；扰动摘除判红）。
- **模块价值与替代等价性由事实调查和评审承担，显式声明不覆盖**（D16b 同族）：正则
  不能理解任意自然语言，不自动证明模块价值或替代等价；**不建全仓消费者扫描、不建
  自动价值评分、不新增运行态传感器**（票面 Out of scope 同款边界）。
- 与邻节分工：#148 需求守恒管**交付责任闭环**（批准要求跨阶段不丢失、去向映射三值），
  本节管**停用能力的事实与授权门槛**——目标取消是 #148 的第三去向（获明确授权的目标
  变更），本节只约束「取消已定之后」与「未接通时」的退役判定，不重复需求映射。
- 与既有机制的分工：gate 7（范围外转票）、冲突归零（分诊前置项）、D21 外部动作门
  照旧——本节给的是「退役 / 保留」的判定判据，不是第二套流程或第八门。

## 协作契约：项目显式启用的单票协作（#151）

独立工作区协作（外部协作者经 issue 认领 → 实现 → 提交 PR 供项目批准）只有在**项目显式
启用协作模式**后才生效；本节是判据单源。常驻注入面：正文骨架的 `@@ collaboration` 节
（适用条件与判据分层）+ batch 组件 TICKET ENTRY CONTRACT 区的义务段（每票义务句）；
复核消费入口在 `docs/code-review-brief.md` §2 的 5f 条；匿名正反样例集在
`docs/collaboration-contract-examples.md`；无既有规约的项目从随 preset 分发的起步模板
`docs/collaboration-starter-template.md` 采用（项目确认采用后才生效）。不建跨机器权限
服务、不自动配置平台保护、不改一票一会话。

### 适用判据（先定开关，再谈义务）

| 判据 | 内容 |
| --- | --- |
| **显式启用** | 启用 = 项目里有**可回读的采用记录**（项目自己的治理文档 / 协作节，或对起步模板的确认采用记录）。**不凭贡献者数量推断**——协作者多、PR 多、仓库公开都不构成启用。 |
| **未启用 → 个人路径** | 未启用的项目走单会话原路径，**不承担团队审批义务**——个人路径不变成强制团队审批，也不因「看起来像团队」而被加义务。 |
| **已有制度 → 权威入口** | 项目已有协作制度（CONTRIBUTING / 治理文档 / 现有规约）时，采用**其权威入口**，不复制第二套；本节判据只在项目无既有制度时作为起步参照。 |
| **缺项明确呈现** | 契约缺项（批准要求不明 / 验证要求不明）时**如实呈现为缺项**并暂停相关决定——不能自动虚构批准者或替项目补写授权。 |

### 授权分层（按事项分，不按在场者推）

授权按**事项**分三类，各类的授权人由项目契约指明；三类互不推导，也不从**在场属性**推导：

| 授权 | 判什么 | 不推导自 |
| --- | --- | --- |
| **需求授权** | 一条需求是否被接受、范围多大 | 当前聊天者 / 仓库写权限 / 代码审阅职责 |
| **跨模块接口授权** | 模块间接口与契约的变更 | 当前聊天者 / 仓库写权限 / 代码审阅职责 |
| **合并 / 发布授权** | 一次合并或发布是否放行 | 当前聊天者 / 仓库写权限 / 代码审阅职责 |

三个方向的自动推导一律不成立：能聊 ≠ 能写，能写 ≠ 能审，能审 ≠ 能放行合并。**授权不清
只暂停相关决定**——被暂停的只是依赖该授权的那件事，本地无关工作继续，不自动全停。

### 主责与认领（一位主责，多人参与）

- **每票一位主责**：一张票恰一位主责（owner），允许多人参与实现与讨论；主责对票的
  交付证据与 PR 陈述负责。
- **issue / PR 关联对应实现**：票与 PR 互相指向（PR 描述回指票号，票面记录 PR），实现
  不落在一张无人认领的票名下。
- **认领后回读**：认领动作完成后**重读票面**（票面可能已被项目方更新——AC、口径、
  授权依据以回读到的为准）。
- **重复认领先协调**：发现他人已认领同一票时**先协调**（谁接、怎么分），不抢注、不
  静默并行两张实现。
- **换人明确移交**：原主责声明移交 + 新主责接认（两步都在票面可回读），不静默换人。
- **指派是职责记录，不是锁**：assignee 表达「谁在负责」，**不宣称写权互斥**——写权
  互斥仍由既有机制管（#136 排批审计的 touch-set 相交即串行）；「我认领了所以别人都
  不能碰」是超权宣称。

### PR 验收（认领 → 合并的闭环）

认领到合并的每张协作 PR 至少列明四件事：**主责**（谁负责）、**授权依据**（票面授权
记录 / 项目契约条目）、**当前提交的验证**（命令 + 退出码 + 证据路径）、**项目要求的
批准**。判据：

1. **默认 PR**：协作模式下交付走 PR 形态（项目契约没有明说改用时）。
2. **至少一位非作者批准**：项目要求的批准落在**至少一位非作者**的审阅上——具体人数
   与权限形态由项目契约定；起步模板的默认是至少一位。
3. **主责自报完成不替代批准**：主责（或主责的另一个会话 / 身份）宣布「完成」不构成
   批准；批准是独立的审阅事件，不是进度报告。
4. **关键合并规则不明 → 暂停合并**：合并规则不明（谁有权放行 / 需要几个批准不明）时
   **暂停合并**，如实报缺项——本地无关实施继续，不自动全停。

### 机械面与边界

- 机械守卫钉**文本送达与入口在场**：`tests/verify-collaboration-contract.mjs`（正文节
  与义务段四档送达、本节适用判据与授权分层锚句、复核入口 5f、样例集匿名面、模板
  分发可达；扰动摘除判红）。
- **批准独立性与授权真实性由评审与项目承担，显式声明不覆盖**（D16b 同族）：正则不能
  判「批准者是否独立于作者」「授权记录是否真实」——**不新建自然语言权限推断器、不建
  跨机器权限服务、不读平台权限配置**；分诊 / 协作会话照本节判，Spec 复核照
  `docs/code-review-brief.md` §2 5f 判。
- 与既有机制的分工：**PR-as-triage-surface**（上文「Pull requests as a triage surface」）
  管**外部 PR 作为需求入口**的分诊开关；本节管**认领 → 实现 → PR 批准**的协作闭环——
  两面互补，不互替。Ready frontier 的「无 assignee = 可开工」与本节「指派是职责记录」
  同语义：assignee 在场 = 有人认了，不是锁。
- 与邻票分工：#136 泳道批 / #103 工作树隔离 / #104 同工作区登记管**本仓开发编排**
  （批内并行与写权隔离），本节管**跨工作区协作授权**；#148 需求守恒管交付责任闭环、
  #149 退役判据管能力下线，本节不重复其判据。gate 6（外部动作门）与 D21 照旧：建票、
  提 PR、合并仍是外部动作，本节规定**批准与授权的判据**，不放松任何确认门。
- **模板不自动配置平台保护**：起步模板是**可编辑起点**——项目确认采用后成为项目的
  协作契约；分支保护 / required reviews 一类平台设置由项目自行决定，preset 与 agent
  都不代配。

## Ready frontier（可开工票集合）

排批 / 预检的输入 = **open + `ready-for-agent` + 无 open 阻塞 + 无 assignee**。现算，不读票面文字：

```sh
node scripts/frontier.mjs              # 默认 ready-for-agent（不印票数：数字会漂）
node scripts/frontier.mjs --label ready-for-human
node scripts/frontier.mjs --json       # 排批输入：frontier + gated(含理由)
```

`P0` 票的读法（#142）：人读输出的 **frontier 段**带 `[P0]` 前缀（gated 段只印票号+理由，不带），`--json` 的条目带 `p0: true/false` 字段——
它只是**正交例外轴的可见标记**（插队输入判据见 #136；规则本体落本文「泳道批票面」节），不改变 frontier 的成员判定，
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

## 泳道批票面（lane batch，#136）

**适用面**：泳道批票（进 lane 并行）的**资格判定**；**普通批不强制**（拍板 Q3）。
四字段填不满 → `needs-triage`，不进 lane。权威叙述 = `docs/adr/0018-lanes-orchestrate-natively-in-dsh.md`。

与 frontier 的关系（ADR-0018 决策 3）：frontier 的 ready 三维（open + label + 无 open 阻塞 +
无 assignee）是**开工资格**；本节四字段是**进 lane 资格**，touch-set 相交是「**不并行**」
（排批维度）——不是 ready 的第四维，`scripts/frontier.mjs` 零改动。

### 四字段（泳道票进 lane 的资格字段）

| 字段 | 定义 | 格式（机械核判据） |
| --- | --- | --- |
| **touch-set** | 预期改动文件/目录；Lead 审计 lane 间**两两不相交** | 路径/目录前缀列表，逗号/顿号/分号/换行/空白分隔，反引号或裸路径都认；解析与相交判据与 `sandcastle/templates/audit-ticket.mts` 的 `parseTouchSet`/`pathsOverlap` 同源（精确相等，或一方是另一方的前缀——**路径段**前缀，`docs/` 与 `docs/agents/issue-tracker.md` 相交、`docs-a` 与 `docs` 不咬）。机械审计 = `scripts/lane-audit.mjs` |
| **接口契约** | 本票暴露/变更的导出、API、消息格式 | 一句话声明（「无变更」也是声明）；并行票只允许经此耦合；**接口变更 = 阻塞边**（GitHub 原生依赖边，自动串行化消费方——加边用本文「Blocking」节的命令） |
| **影响面** | 消费方 + 守护测试 | 列消费方与守护测试；声明该票**自带**的跨模块集成用例（集成测试所有权显式，不默认归属 lane 外任何人） |
| **proving** | 单票最小验证命令；**跑不了不进 lane** | 恰 1 条可直接跑的命令（tier ① 最小相关 / ② 单模块层，D39 测试分级——[详档](../observations.md#d39)）；与 `docs/batch-state.md` 的「证明命令」同口径 |

### 样板票面（四字段节的原样形态，`scripts/lane-audit.mjs` 按此解析）

```markdown
## 泳道票面

- **touch-set**: `scripts/lane-audit.mjs`, `tests/verify-lane-audit.mjs`
- **接口契约**: 新增独立 CLI 脚本，不改既有导出
- **影响面**: 消费方 = Lead 排批流程；守护测试 = tests/verify-lane-audit.mjs；无跨模块集成用例
- **proving**: `node tests/verify-lane-audit.mjs`
```

字段名容错：大小写不敏感、`-` 可省（`touchSet`）、`**加粗**` 与反引号装饰、中文冒号、
英文别名（接口契约/interface、影响面/impact、proving/证明命令）都接受——判据在
`scripts/lane-audit.mjs` 的 `parseLaneFields`，由 `tests/verify-lane-audit.mjs` 钉住。

**解析域**（引用 ≠ 声明）：四字段**只在「泳道票面」标题节内解析**（ATX 标题，级别与
`泳道批票面` 变体名容错；节体到下一个 ATX 标题截断）；解析前**先剥代码围栏**——正文引用
本文样板的票不算声明票面，票面散文/定义行里出现四字段字样（如 #136 票面自身）同样不算。
正文没有该节 = 四字段全缺。空白即 touch-set 的分隔符（含空格的路径不支持——声明的语义）。

### 排批审计（lane-audit）

```sh
node scripts/lane-audit.mjs --issues 136,137        # Lead 点名本批候选（缺四字段 → exit 1 响亮回炉）
node scripts/lane-audit.mjs --frontier-json f.json  # 注入等价数据（frontier --json 原样输出，离线/预演）
node scripts/lane-audit.mjs --json                  # 机器可读：两两相交矩阵 + pairs + 串行分组
```

它消费 frontier `--json`（默认子进程跑 `scripts/frontier.mjs --json` + 逐票取正文解析四字段）
+ 票面 touch-set，输出 lane 间**两两相交矩阵**与**串行分组建议**（union-find 分组——**传递**的，
组内两两未必直接相交，判相交看 pairs 明细）。**建议 ≠ 判定**：扫描成功恒 exit 0（有相交也是
0——输出是排批建议不是硬门）；exit 1 = 取数失败或**点名票**缺字段/不在 frontier；
exit 2 = 用法错误。判据提纯自 `sandcastle/templates/audit-ticket.mts` 的 `--touch-overlap`
（AFK 夜批载体，无测试）；`sandcastle/README.md` 有回指。纯函数由 `tests/verify-lane-audit.mjs`
离线断言（含**非空洞扰动**：摘相交判定 → 相交正例必红）。

### Lead 排批审计 + 插队三规则

1. **跨 lane 关联由 Lead 排票前核实并留痕**：结论 + 依据写进票面（命中哪条关联判据、
   相交/验证面证据读数），**口头调度禁止**。
2. **touch-set 相交 → 串行化或合并成一票**：分派判据 = VERA ADR-084「touch-set 不相交 +
   各自验收线」（#136 评论已采纳）；`lane-audit` 的相交矩阵是 **git 路径前缀粗判**，
   最终排批 Lead 拟案 + **human 终审**。
3. **插队只发生在票边界**：在跑票跑完、或 WIP-checkpoint 后让出；**中途裸抢禁止**
   （反面教材 = 2026-10-11 IRIS `0fee327b`：总结门等待期裸插 → 重复派单）。插队的代价
   **显式计价并回报**。

**插队的输入判据 = `P0`**：判据本体（单档例外轴，挂 `P0` = 阻断可用性/不挂 = 常规；谁设、
如何裁定）在 **#142**，不在此复制第二份——frontier 输出的 `p0` 标记只是它的可见读数。
优先级**不驱动**机械排序：插队**只在票边界由人判**（#142 结论），`frontier.mjs` 排序不变。

**嵌套深度帽 = 2**（#136 评论已采纳）：Lead → lane → subagent；lane 会话不得再开 lane。

**代价计价的回报格式**（插队回报一行样板，三要素 = 票边界依据 + 计价项 + 谁拍板）：

```markdown
插队回报: #<b> 插到 #<a> 前（票边界：#<a> 已 merge / WIP-checkpoint 让出）——代价 = lane 重排
<lane-n> 延后；合并序 <#c,#d> 互换；验证重跑 <命令>；拍板 = <human/Lead+留痕>
```

三要素缺任一 = 不算有效回报（与 `docs/batch-state.md` Progress 行三要素同纪律：缺要素的
行是 BLOCKED，不是 done）。

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
