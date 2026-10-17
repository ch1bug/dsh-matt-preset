# 0010 — workflow-core：ask-matt 工作流抽出 persona，改为可挂载插件（#54）

Status: accepted（2026-10-16，implement #54 落盘）

## Context

工作流插件化系列首票（#54）。此前（D18）完整 ask-matt 工作流文本
（MAIN FLOW + 七门 + BATCH MODE + 全部辅助节）整体承载在 matt persona 前缀里，
只有 matt preset 能携带工作流；任何其他 preset 想要同一工作流只能整段复制
persona。工作流正文与"人设导语"的变更频率也不同（D27：persona 变更 = 全部
会话缓存失效），耦合在一节里放大缓存代价。

票内唯一技术未知数 = `{{model}}`/`{{cwd}}` 插值在 assemble 注入点是否可用，
spike 先行（AC 纪律，D20 验证通道）。

## Spike 结论（给 #55 的输入）

`renderPrompt`（@deepseek-ai/dsh-system-prompt）在 `systemPrompt.assemble()`
**之后**运行：waterfall（`system-prompt/assemble` 过滤器，workflow-enforcer
已证明的注入路径）先改写 sections，再对返回 assembly 的**全部 section**（含
插件注入的）统一做 `{{var}}` 插值；`model`/`cwd` 两个变量由 dsh-agent-loop
在每次组装时注册（`agent.options.model` / `session.header.cwd`）。因此注入节
内的插值与 persona 承载文本完全同构，可用性成立（tests/verify-workflow-core.mjs
S1 端到端实证）。注意：注入文本含**任何** `{{…}}` 都会走严格校验（malformed/
unknown 引用直接抛错），正文里的示例代码若带双花括号需转义或避开。

## Decision

1. **拆分**：persona 前缀只留导语句（identity + 路由前提 + `ask-matt` 标记）；
   工作流正文移入本仓新插件 `workflow-core.mjs`（正文 verbatim 存
   `workflow-body.txt`，在拆分点逐字节拼接）。
2. **注入机制**：经 `system-prompt/assemble` 注入 `workflow:core` 节
   （order 10，紧随 persona 前缀 order 0、先于 plan policy 500）；渲染后与
   persona 承载版 **verbatim-identical**（L1 断言，tests/verify-workflow-core.mjs）。
3. **入口解析**：插件行 = `dsh-matt-preset/workflow-core.mjs`，经包 subpath
   exports 解析（不用 profile 目录相对 `./` 路径——enforcer 行已记录的同陷阱）；
   任何 preset 单行挂载即得工作流（非 matt preset 显式 `config.scope: 'all'`，
   挂载即 opt-in）。
4. **scope 守卫保留**：默认 `scope: 'marker'`——仅当组装结果含 `ask-matt`
   标记才注入，绝不泄漏到非工作流会话（导语留在 persona 里正是为了让这个
   守卫与 workflow-enforcer 的守卫共用同一标记）。

## Consequences

- matt preset 渲染面零变化（L1 verbatim）；persona 变更面缩小为导语句（D27
  缓存语义改善）。
- #55 的 delta 结构设计以本插件的 text 覆盖 config 为拼装点（`config.text`
  可传变体正文）。**（#55 落地后更新：最终形态是分节骨架 + `PROFILES` 注册表，
  见 ADR-0011；`config.text` 保留为整段覆盖逃生门。）**
- `workflow-body.txt` 进 package `files` 白名单；bundle 载体
  （cordis.patch.yml）随 agent.cordis.yml 重新生成并字节级锁定。
- 验证：tests/verify-workflow-core.mjs（spike S1 / L1 / AC2 / G1 / E1；L1 基线
  冻结在 tests/fixtures/persona-prefix-v1.txt——从 #54 前的 git HEAD 捕获，
  不随本提交落地失效）+ tests/verify.mjs A0（改读 persona+workflow-body
  拼接文本）。**（#85 更新：该基线随 workflow 文本政策变更重取——仍逐字节
  冻结、断言不变，见 CONTEXT D48；persona 导语本身未动。）**
   **（#89 更新：persona 导语**动了**——上游 0.2.1 删掉了 agent-loop 的
   `variable('cwd', …)`，导语里 "Your working directory is {{cwd}}." 子句已删，
   `tests/fixtures/persona-prefix-v1.txt` 随 #89 再次重取（导语换、正文逐字节保留）。
   spike S1 的样本从 `{{model}}/{{cwd}}` 收窄为 `{{model}}`；`tests/verify-persona.mjs`
   新增「含 `{{cwd}}` 的 persona 必须渲染前抛错」的反向锚。）**
