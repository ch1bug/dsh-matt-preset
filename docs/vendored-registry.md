# Vendored / 借用面登记册（dsh-matt-preset）

> 目的：lic 归属管理与上游同步的单一登记面。每条记录：载体 / 来源 / 版本锚 / license /
> 修改形态 / 同步策略。**登记 ≠ 授权复制**——新增借用面先走确认通道再入册。
> host 侧姊妹册：`dsh-shell-host/docs/vendored-registry.md`（互指）。
> 依据票：#180（preset 半边盘点）/ host #194（host 半边盘点，S1–S6 决策项在册）。

## 1. DeepSeek Harness 改编面（MIT，DeepSeek）

| 载体 | 来源 | 修改形态 | 同步策略 |
| --- | --- | --- | --- |
| `agent.cordis.yml` / `preset.yml` / `cordis.patch.yml` / `presets/*.patch.yml` | Harness 内置 Minimal 与 Standard preset | 深度改编（roster / 组件 / enforcer 全重排，四档形态） | 官方 preset 变更经 **registeredDiff 机制**评估（#117 方向 b 有据差异——不追平，差异逐条登记于 `tests/fixtures/official-presets-roster-v1.json` 的 registeredDiff） |
| `lib/types/pty/*.d.ts`（terminal-sanitizer.d.ts 等） | 本仓姊妹仓 dsh-shell-host 的构建产物声明拷贝（跨仓同源，MIT） | 类型声明转录（跟随 host 构建面） | 跟随 host 构建；host 半边盘点 = host 仓 #194（互指）；preset 半边盘点 = #180（exports-audit 守卫钉上游子路径引用面） |
| `tests/fixtures/official-presets-roster-v1.json` | 官方 presets roster 冻结快照（official-preset 面） | 冻结快照（registeredDiff 单一数据源） | 官方 preset 面变更时按 #117 配方重取（meta.sourceVersion 坑注在案） |
| `tests/node_modules/**`（约 32 包，@deepseek-ai/dsh-llm 等） | 上游检出经 **link-runtime-deps 生成**的宿主包同步面 | 生成面（非手工 vendored——脚本机制） | **脚本同步**：`node scripts/link-runtime-deps.mjs --runtime <src>` 重指/重建；锚派生 = `scripts/runtime-anchor.mjs` 单源（ADR-0008） |

## 2. mattpocock/skills 借用面（MIT，Copyright 2026 Matt Pocock）

| 载体 | 来源 | 修改形态 | 同步策略 |
| --- | --- | --- | --- |
| persona 工作流地图（MAIN FLOW / METHODOLOGY / CONTEXT HYGIENE / ON-RAMPS / STANDALONE） | mattpocock/skills | 改编（WORKFLOW ENFORCEMENT 七门与 INITIALIZATION 为本仓增补） | NOTICE 已登记；上游变更人工评估（无自动同步） |
| `skills-fork/grilling/SKILL.md` | mattpocock/skills 的 productivity/grilling 技能（上游仓库；本仓 fork 载体为本路径，批 DD #174 落地） | fork + 「决策前提实测」检查项增补（finding facts 段后） | **fork 隔离**：`scripts/sync-skills.exclude` 保护（FORK-DRIFT 警告保底可见）——上游 grilling 更新不自动跟进，人工评估 |

## 3. 自源重建面（无外部上游可跟）

| 载体 | 来源 | 说明 | 同步策略 |
| --- | --- | --- | --- |
| `sandcastle/templates/`（Dockerfile / run-ticket.mts / dsh.ts / audit-ticket.mts） | @ch1bug/sandcastle-dsh 不可获取后**自包含重建**（#146） | 自源（本仓自有的原包设计） | 自包含维护；验证面 = `test:release`（host 侧）/ verify-install-tarball（preset 侧）；run-ticket 全链 = #147 |
| `handoff-tool.mjs` / `plugin-meta/handoff-tool` | 本仓原创 | NOTICE 已登记 | — |

## 4. License 归属汇总

- DeepSeek Harness（runtime / 官方 preset 面）：**MIT，Copyright 2026 DeepSeek**（上游 LICENSE 实读）。
- mattpocock/skills（persona 地图 / grilling fork）：**MIT，Copyright 2026 Matt Pocock**（上游 LICENSE 实读）。
- microsoft/vscode（host detect.ts 借源）：**MIT**（host 侧册登记，借源仓不在本机检出——loud 申报）。
- 本仓原创面（tests/ / handoff-tool / 组件增补）：本仓 LICENSE。

## 5. 维护纪律

- 新增借用面：先走确认通道（D21）→ 本册入册 → NOTICE.md 补 lic 归属 → 分发面（files 白名单）核对。
- 上游同步：逐模块按上表策略；漂移评估走盘点票形态（host #194 / preset #180 先例——三栏结论：上游改了什么 / 我们改了什么 / 要不要跟）。
- 词表/锚形态类机制变更（如版本族扩展）：ADR 追记 + 单源实现（不手抄）。
