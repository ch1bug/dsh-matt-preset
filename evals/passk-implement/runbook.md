# pass^k 冒烟 runbook — 单 skill（implement）×N=3（#38）

复跑清单。前置：本仓已安装依赖（`npm i`）；`dsh` CLI 在 PATH；本仓本地测试全绿。

## 一次基线评测的完整序列

1. **挂 profile**（幂等，升级即 `node bin/install.mjs install --profile headless` 重跑）：
   ```bash
   node bin/install.mjs install --profile headless
   ```
2. **三连跑**（同一任务，fresh 会话；label 唯一）：
   ```bash
   node evals/passk-implement/smoke.mjs run1
   node evals/passk-implement/smoke.mjs run2
   node evals/passk-implement/smoke.mjs run3
   ```
   每跑产物：`.scratch/passk-runs/<label>/`（transcript / stderr / final.diff / meta）。
3. **逐跑评分**：按 [rubric.md](rubric.md) 七维打分，依据 = transcript + final.diff
   （必要时在 sandbox 重建验证）。hard violation 清单见 rubric。
4. **落盘报告**：`evals/passk-implement/report-<日期>.md`——逐跑得分表、
   证据指针、pass^k 判定、是否值得扩面的结论（AC②③）。
5. **卸载（评测结束恢复环境，可选）**：`node bin/install.mjs uninstall`（安装/回滚事实源见 docs/RELEASE.md「安装 / 升级 / 回滚 / 卸载」；指定 profile 的卸载形状以 bin/install.mjs 为准）。

## 边界

- 不建 Docker 平台，不做多 agent 适配（票面 scope）。
- 原始 transcript 留 .scratch（gitignored）；进仓的只有脚本/rubric/runbook/报告。
- 改 `agent.cordis.yml` 才需要 `regen-patch.mjs`；本评测不改 preset 本体。
