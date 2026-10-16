# 复核 brief（/code-review 专用）

**谁读**：审阅阶段（`/code-review` 的两个轴 subagent）。实现阶段不必读——实现 agent 的
上下文压力最大，标准不该压给它；审阅 agent 拿到 diff，没有探索成本，由它承担标准。

**入口**：`/code-review` 技能；本文只定"本仓怎么组装那两份 brief"。

## 1. 定固定点

- 默认固定点 = **`HEAD`**（起手快照）。
- 工作还没提交：先 `git add -A`，再用 `git diff --staged`——否则**新增文件不出现**在 diff 里
  （本次 #55 有 4 个新增文件，漏掉就等于审了个残缺面）。
- 已提交：`git diff <fixed-point>...HEAD`（三点，对 merge-base）。
- 先验固定点可解析、diff 非空，再派 subagent——坏 ref 要在这一层炸，不要炸在两个 subagent 里。

## 2. 定 spec 源

1. 提交信息里的票号 → `gh issue view <NN> --repo ch1bug/dsh-matt-preset`（当前票 = 提交信息首个 `#NN`）；
2. 否则问 human 要 spec；
3. 都没有 → Spec 轴跳过并明说"无 spec"，不要猜 AC。

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