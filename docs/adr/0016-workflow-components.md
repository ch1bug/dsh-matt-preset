# 0016 — workflow components：batch-mode 规则块组件化（#58）

状态：已采纳（2026-11-01）
前置：[0011-workflow-profiles.md](0011-workflow-profiles.md)（#55 骨架 + delta 机制）、[0012-workflow-profiles-2.md](0012-workflow-profiles-2.md)（#56 tight / ptc / minimal）

## 背景

票 #58 要求把 batch-mode 规则块（D31–D33 及其在节内的后续增量）从标准 profile
正文抽成**组件受控注入**（`components: [batch]`），落在 #55 的 delta 结构上；AC：

1. 组件关 = 注入文本无 batch 节；
2. 组件开 = 与原文本逐字等价；
3. handoff 全链回归通过；workflow-core 与 handoff-tool 都可独立于 matt preset 挂载。

## 决策

### 1. 组件 = 「节 id 集 + 默认文本载体」，物理抽出

`workflow-core.mjs` 新增注册表：

```js
export const COMPONENTS = {
  batch: { delta: new URL('./workflow-component-batch.txt', import.meta.url), sectionIds: ['batch-mode'] },
}
export const DEFAULT_COMPONENTS = Object.keys(COMPONENTS)
```

`@@ batch-mode` 节正文（骨架 16 节中的 1 节）搬进 `workflow-component-batch.txt`，
骨架剩 15 节。**不采用「骨架不动 + 注入时按 id 过滤」的开关式**：组件是注入单元，
有自己的载体文件（与 profile delta 同语法 `@@ batch-mode after=enforcement-recovery`），
否则「抽出来」没有发生、组件也无法独立演进文本。

### 2. 组合顺序：profile delta 先、组件 delta 后；同锚插入沿链尾

`profileBody(profile, components)` 的组装：

- 骨架 → `composeSections(skeleton, [...profileDeltas, ...componentDeltas])`；
- profile delta 与组件 delta 锚在同一骨架节（cordis `creator-context` 与 batch 组件
  都锚 `enforcement-recovery`）时，组件节必须落在 profile 插入链**之后**——组件化前
  batch-mode 是骨架原生节，位置在一切插入节之后。为此 `composeSections` 的同锚插入
  从「插在最后直接锚定者之后」精化为「沿 `lastInsertedAfter` 链走到链尾再插」。
  对链长 1（既有全部调用面，含 M2 断言的两节同锚）两种读法重合，delta 顺序保持
  语义不变——这是从链长 1 到 n 的推广，不是行为变更。
- profile delta 可覆盖组件的节 id（minimal 的压缩 `batch-mode`）：同 id 时组件默认
  文本跳过，profile 版本胜出。minimal 的 batch-mode 由此从「覆盖骨架节」变为
  「带锚插入」——D45 的「minimal 只覆盖、不新增」据此修订为「minimal 不新增
  **规则主题**；对搬进组件文件的节，其 delta 以带锚插入提供压缩版默认文本」。
- **组件关 = compose 之后按未挂载组件的 sectionIds 过滤**：无论节来自组件 delta
  还是 profile 的覆盖（minimal），都从注入文本消失。`components: []` 在任何
  profile 下都注入零 batch 节（C1/C5/C7 断言钉住）。

### 3. 默认全开，冻结基线零重取

`config.components` 缺省 = `DEFAULT_COMPONENTS`（全部注册组件）= 改动前行为。
因此 `profile: standard` 的注入文本与改动前**逐字节一致**，`tests/fixtures/
workflow-body-v1.txt`（42885 chars）**不需要重取**——AC1 原断言原字节继续绿。
`scripts/retake-workflow-fixtures.mjs` 升级为组件感知：重取对象 =
`profileBody('standard')`（机制自拼装），新增自证②b（组合无标记、比骨架往返长、
含 batch 节特征）。

未知组件名**响亮抛**（`profileBody` 与 `apply` 挂载两处）：profile 拼错回落默认
是「拿错文本仍可跑」，开关拼错静默无效是「配置撒谎」——按静默类失败判据 S3 必须响亮。

### 4. 已知边界（如实申报）

- 七门 `workflow-enforcement` 节内 gate 5/6 各有一句 `BATCH MODE (below)` 引用：
  该句属 enforcement 节、不属 batch 组件的 sectionIds，组件关时 `(below)` 指向
  缺席的节（AC 判据是节级「no batch sections」，此引用句不违反）。改写七门措辞
  = 动冻结基线（D48 文本政策流程 + 基线重取），超出本票授权，留待后续票；
  本边界由 C1 的读数（残留仅两行 gate 引用句）可见。
- handoff 全链（fork/fresh、定向/候选、凭据、skill 钉定、批次 auto-handoff）由
  `tests/verify-handoff-tool.mjs`（T0–T15）与 `tests/verify.mjs` Track A/F 承载，
  本票零改动零回归——handoff-tool 的批次 auto-handoff 文本锚在 batch 组件节内，
  字面守卫（Track F 副本计数、batch-state C3/C5/C6、enforcer V35h/V37、autonomy
  O8）的判据对象同步改为「骨架 + 组件文件」并集，注入文本本身不变。

## 验证

- `tests/verify-workflow-profiles.mjs`：AC1（基线零重取）、C1–C7（组件开关四态
  + 未知名响亮 + cordis/ptc/minimal 组合节序表——锚点表独立写在测试里）、P4b
  （payload 覆盖）。
- `tests/verify-workflow-profiles-2.mjs`：AC3a 对象改组件关字节；AC2e/f/g 判据
  对象升级为骨架 + 组件并集（minimal 的 batch 压缩面照钉）。
- `tests/verify-batch-state.mjs` C3/C5/C6、`tests/verify.mjs` Track F、
  `tests/verify-enforcer.mjs` V35h/V37c/V37d、`tests/verify-autonomy-orchestration.mjs`
  O8、`tests/verify-triage-check.mjs` T9、`tests/verify-silence-guardrails.mjs`
  SG3/SG5：判据对象 = 骨架 + 组件文件（注入文本的承载源并集）；SG/triage 的注入
  面清单补组件文件，词形集与检查面不变。
- 扰动取证：摘组件节正文一行 → AC1/C2 红；去掉关态过滤 → C1 红（非空洞）。

## 后果

- 加第二个组件 = 落一个 `workflow-component-<name>.txt` + `COMPONENTS` 一行 +
  `package.json files` 显式条目；共享文本仍一字不改。
- batch 规则块的后续演进（新增条目）改组件文件，标准/各 profile 的注入自动跟随；
  骨架 15 节与组件 1 节的分工在 `retake --check` 三自证下保持可核对。
