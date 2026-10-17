# 复核 brief（/code-review 专用）

**谁读**：审阅阶段（`/code-review` 的两个轴 subagent）。实现阶段不必读——实现 agent 的
上下文压力最大，标准不该压给它；审阅 agent 拿到 diff，没有探索成本，由它承担标准。

**入口**：`/code-review` 技能；本文只定"本仓怎么组装那两份 brief"。

## 1. 定固定点

- 默认固定点 = **`HEAD`**（起手快照）。
- 工作还没提交：先 `git add -A`，再用 `git diff --staged`——否则**新增文件不出现**在 diff 里
  （本次 #55 有 4 个新增文件，漏掉就等于审了个残缺面）。
- **复核后必须重新 `git add -A` 再 commit**：index 是"复核前"的快照，复核产生的修改只落在工作树，
  而 pre-commit 的 verify-all 跑的是**工作树**——它会为提交里根本没有的内容背书。`#82` 实测：
  提交记 `283/30`、树里是 `347/32`，只有事后 `git status` 才发现，靠两次 amend 补救。
  `.githooks/pre-commit` 现在会**响亮拒绝**这种脱节（`tests/verify-precommit-hook.mjs` H1）。
- 已提交：`git diff <fixed-point>...HEAD`（三点，对 merge-base）。
- 先验固定点可解析、diff 非空，再派 subagent——坏 ref 要在这一层炸，不要炸在两个 subagent 里。

## 2. 定 spec 源

1. 提交信息里的票号 → `gh issue view <NN> --repo ch1bug/dsh-matt-preset`（当前票 = 提交信息首个 `#NN`）；
2. 否则问 human 要 spec；
3. 都没有 → Spec 轴跳过并明说"无 spec"，不要猜 AC。
4. **票面 AC 之间是否互斥（算术可行性）**：AC 一边要求"压到 X"、一边要求"某块一字不动"时，
   先算一遍能不能同时成立（#56：七门 verbatim 已占 10%，与 "~1/3" 不可兼得）。冲突须显式
   上报：要么回票面改口径，要么实现方记录取的口径并请 human 裁决——不得静默选一个 AC 满足。
5. **票面的「现象 / 根因 / 实测」段是可证伪断言——先实测再判 AC**：对 HEAD 跑一遍票面描述的
   输入，再决定 AC 怎么算满足。票面与实际不符时**报告口径修正**并写进交付记录（ADR / 票面
   评论），不要静默按票面文字实现。#66 实测：票面称"`prefix` 以 `/` 结尾的目录通配可用"，
   而 HEAD 上 `dir/*`、`dir/name-*.txt`、`a*.mjs` **全部恒空**，AC2 因此建在错误前提上。
6. **新增的每条断言都要证明非空洞**（不只是"守卫"——隔离 / 清理这类辅助环同样算）：把被断言的输入换成
   反例（回退实现用 `git show HEAD:<file>` 到临时副本，手法与陷阱见
   [dev-environment §0.2](dev-environment.md)），用例必须**红**；说不出"什么输入能让它红"就是同义反复
   （负债）。#66 实例：回退 `lib/payload.mjs` 后 P4/P6/P7/P9/P10 全红，P10 复现票面症状
   （`exit=0`、store 少发）。#75 实例：`--port 0` 下"分到的端口不是保留口"**恒真**（复核才抓到），改为
   保留口前后占用快照才可红；**扰动要打在运行时真正读的那份上**（生成载体，不是源文件）。
   **三条硬约束（#82 会话踩过全部三条）**：① 扰动前先自检 **needle 命中数 > 0**
   （`$src.Contains()` / `grep -c`）——0 命中是**假证据**，不是"没漂移"（本次一条文档探针静默 0 命中，
   差点把"守卫有效"当结论）；② 回退用 `git show HEAD:<file>` 写临时副本
   （`git stash push` 会重置 index 并按 autocrlf 改行尾），回退后**编辑前重新 `read`**
   （FS 版本守卫报 `file changed since it was read`，本次白读两次）；③ 探针里拼 `\n` 会撞 CRLF
   工作树（`-Raw` 读进的是 `\r\n`）——按 `\r?\n` 切分或用显式 `$nl`，否则替换静默不生效。
   **实验标记（2026-10-17 起，机械拦）**：调试/扰动探针一律带唯一前缀 —— `[DEBUG-<唯一串>]` /
   `[MUTATION-<唯一串>]`，提交前必须清掉。理由：**标记死了才叫实验**，留下的标记意味着"被跑过的
   那棵树"与提交物不是同一份（而 verify-all 照样绿）。`.githooks/pre-commit` 已机械拦 staged 的
   `tests/*` **新增行**（`grep -E '^\+.*\[(DEBUG|MUTATION)-'`，只看 tests/：文档里叙述这套做法不算）；
   判据由 `tests/verify-precommit-hook.mjs` H5/H6 钉住。

## 3. standards 源（本仓）

- [AGENTS.md](../AGENTS.md)（导航 + 沟通语言）、[CONTEXT.md](../CONTEXT.md)（决策 D1–D45 与术语）、
  [docs/adr/](adr/)（尤其 0010 workflow-core、0011 profiles、0012 profiles-2）、[README.md](../README.md)（验证段 / 组件表）
- 邻近文件的既有风格：`tests/*.mjs`（results 数组 + `ok()`/`bad()` + loud skip + 非零退出）、
  `bin/install.mjs` + `lib/*.mjs`、`workflow-core.mjs` 的重"为什么"文档头注
- 本仓**没有** `CODING_STANDARDS.md`、没有 lint：判断类标准散在上面这些文件里。优先级固定为
  **文档化标准（可判硬）> Fowler smell 基线（永远判断项）**，工具已强制的跳过。

## 4. smell 基线

从 `code-review` 技能正文取（Fowler *Refactoring* ch.3 的 12 条），**整段粘进 subagent prompt**——
subagent 没有你的上下文（不会自带基线）。别复述成一句话摘要，摘要会让基线失效。

## 5. 两轴 brief 模板

两个 subagent **同时**发（一条消息两个调用），各给"diff 命令 + 提交列表 + 该轴材料 + 它的 brief"：

- **两轴都要真跑被测用例**：reviewer 收到 diff、没有探索成本，正是该自己确认"这条断言非空洞"的一轴。
  `node tests/<file>.mjs`。依赖接线锚在 **`tests/node_modules/`**（`@deepseek-ai` junction → 本机 dsh
  安装；一条 `node scripts/link-runtime-deps.mjs` 补齐，D43）——仓根 `node_modules` 只有 `yaml`，
  **别据此判"套件跑不了"**（#82 会话的 Standards 轴就这么退化成只读码，4 条发现里 2 条本可自证）。

- **Standards 轴**：diff 命令 + 第 3 节清单 + 粘好的 smell 基线 + 要求
  "逐文件/逐 hunk 报：违反哪条文档化标准（指名文件 + 规则）；命中哪条 smell（引用 hunk）；
  区分硬违规与判断项；工具已强制的跳过；<400 词"。
- **Spec 轴**：diff 命令 + spec 原文 + 要求
  "(a) 缺失或只实现了一半的需求；(b) 票面没要求的行为（scope creep）；(c) 看似实现实则错的地方；
  每条引用 spec 原文；<400 词"。

## 6. 出报告

两轴**分开**呈现（`## Standards` / `## Spec`），**不合并、不重排、不跨轴选一个最优**——
两轴故意隔离：合标准的可能实现错了，实现对的可能坏了约定，合并正好让一轴掩盖另一轴。

## 7. 本仓已修过的复核发现（回归样例）

- 判定点重复（回落决策两处）；跨 entry 的正则误命中；文档表 ↔ 代码清单漂移（→ V17 守卫）；
  票面外行为（显式 `profile:`、未知档名回落）要在报告里点出"这是拍板过的额外约束"。
- **守卫手抄被测实现的语义**（#66：`verify-payload-manifest` 的 P1 又自己写了一遍"展开 +
  存在性过滤"，而该文件头注明写"用安装器自己的实现、不重写一份"）→ 改成就地消费 `payloadOf`
  （捕获它的错误即判据）。这是本仓"单一事实源"口径在测试里的同一件事。
- **口径漂移落在 diff 之外**（#66：一处行为改动同时使 `docs/adr/0012` 正文、
  `verify-workflow-profiles-2.mjs` 的注释与 P7 标签变成假话）→ 两轴都要在 diff 之外搜一遍
  "引用了被改行为"的文档、注释与断言标签（`grep` 行为关键词，不止看 diff）。