# NOTICE

本仓库（dsh-matt-preset）的组成与归属：

- `agent.cordis.yml` — 改编自 DeepSeek Harness 内置 Minimal 与 Standard preset（MIT，DeepSeek）。
- ~~`tool-bootstrap.mjs`~~（已于 D17 移除）— 曾来自
  https://github.com/xiaobright/dsh-anchored-standard（MIT），含 dsh-liangshen 的
  两阶段隔离扩展思路；本仓库经 liangshen preset（`~/.dsh/.agent-presets/liangshen`）
  沿用同一上游。MIT 归属对 git 历史中的副本仍适用。
- persona 的工作流地图（MAIN FLOW / METHODOLOGY / CONTEXT HYGIENE / ON-RAMPS /
  STANDALONE / UTILITIES / PRECONDITION）改编自
  [mattpocock/skills](https://github.com/mattpocock/skills)（MIT，Copyright 2026 Matt
  Pocock）；WORKFLOW ENFORCEMENT 七门与 INITIALIZATION 为本仓库增补。
- `handoff-tool.mjs`、persona 增补文本（WORKFLOW ENFORCEMENT /
  INITIALIZATION，原 matt-workflow.md）、`tests/` — 本仓库原创。
- 原始 DeepSeek 版权与 MIT 许可声明见上游仓库。

术语与决策记录见 `CONTEXT.md` 与 `docs/adr/`。
- `skills-fork/grilling/SKILL.md` — fork 自
  [mattpocock/skills](https://github.com/mattpocock/skills) `skills/productivity/grilling/SKILL.md`
  （MIT，Copyright 2026 Matt Pocock；批 DD #174 落地）——增补「决策前提实测」检查项；
  fork 隔离机制见 `scripts/sync-skills.exclude`（FORK-DRIFT 警告保底）。
- 借用/派生面**单一登记册**：`docs/vendored-registry.md`（lic 归属与上游同步策略的
  逐模块登记——新增借用面先走确认通道再入册）。
