# NOTICE

本仓库（dsh-matt-preset）的组成与归属：

- `agent.cordis.yml` — 改编自 DeepSeek Harness 内置 Minimal 与 Standard preset（MIT，DeepSeek）。
- ~~`tool-bootstrap.mjs`~~（已于 D17 移除）— 曾来自
  https://github.com/xiaobright/dsh-anchored-standard（MIT），含 dsh-liangshen 的
  两阶段隔离扩展思路；本仓库经 liangshen preset（`~/.dsh/.agent-presets/liangshen`）
  沿用同一上游。MIT 归属对 git 历史中的副本仍适用。
- `handoff-tool.mjs`、`scheduled-jobs.mjs`、persona 工作流文本（原 matt-workflow.md，已并入
  `agent.cordis.yml`）、`tests/` — 本仓库原创。
- 原始 DeepSeek 版权与 MIT 许可声明见上游仓库。

术语与决策记录见 `CONTEXT.md` 与 `docs/adr/`。
