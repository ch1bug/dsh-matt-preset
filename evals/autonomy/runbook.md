# 自主化 L2 前置评测 runbook — A 组（区分度）+ B 组（接力链）×N=3（#50）

复跑清单。骨架思路复用 [../passk-implement/runbook.md](../passk-implement/runbook.md)
（sandbox → 评一次 → 留档 → 按 rubric 评分 → 报告落盘），但**驱动架构不同**：
runner 起 **web 实例 + RPC 建会话**（`agentPreset=dsh-matt-preset`），不走
`dsh headless` 一次性任务——headless one-shot 没有 agentPresets 服务，preset 行全部
pending，会话是**裸模型**（2026-10-24 实测：system ~1196 tokens、无 `/implement`、
工具卡审批）。#38 的 smoke.mjs 走的是 headless 路线；本评测要评 preset 工作流
（决策门 / enforcer / 技能契约），必须带 preset 跑，故换驱动。

## 前置（预配细节见 docs/dev-environment.md §3.1「实机验证预配最小清单」，勿在此复述）

1. 本仓依赖与套件绿（`node scripts/verify-all.mjs` 快集）。
2. `DSH_MATT_LIVE_CLI=<src>/apps/cli/lib/bin.js`（dsh 构建产物入口，`--version` 现查）。
3. `DSH_HOME=<home>`，其中有一个 **web 面 profile 已挂 preset**（runner 默认取
   `DSH_EVAL_PROFILE`，缺省 `matt-dev`）。profile 现查（别抄本文的当前值）：
   `cat "$DSH_HOME/profiles/${DSH_EVAL_PROFILE:-matt-dev}/package.json"` 看
   `dsh.profile.bundles`——判据 = 含 `dsh-web-app`（web 面）与 `dsh-matt-preset`（preset）。
   挂载命令口径：`node bin/install.mjs install --profile <name>`
   （新名字的 web 模板 bootstrap 见 §3.1「profile 的面由初始化模板决定」）。
   **技能镜像**：`<home>/skills` 需在场（`scripts/sync-skills.sh`，`SYNC_SKILLS_TARGET`
   指到该 home）——镜像缺失时会话侧技能目录为空，且**测试看不出来**（dev-env 高危三类 #2）。
4. `gh` 已认证（A 组真实 tracker 读取用，评测会话只读）。

## 权限口径（runner 内建，非可选项）

runner 给实例注入 `DSH_PERMISSION_MODE=danger-full-access`（base bundle 的
approval 行按此 env 分支 → `approval: never`）。原因：RPC 驱动的无人值守 turn 没有
审批人，默认 `workspace-write + ask` 会把工具调用卡死（实测）。
**隔离面** = 每跑独立 `mkdtemp` sandbox（os.tmpdir）+ 任务文本明令禁 push/禁 tracker 写；
边界行为本身是评测对象（rubric 维 7），沙箱外的真实外部动作仍算 hard violation。
原始 transcript / sandbox 均在 `.scratch`（gitignored）与系统临时目录，不触碰仓与 home。

## A 组（区分度）三连跑

```bash
node evals/autonomy/runner.mjs a run1
node evals/autonomy/runner.mjs a run2
node evals/autonomy/runner.mjs a run3
```

任务规格（含两个决策门）内嵌在 [runner.mjs](runner.mjs) `TASK_A`：TOC 生成器中小票 +
真实 `gh issue view`（ch1bug/dsh-matt-preset#50，只读）+ slug 非 ASCII 读法门 +
交付评论落盘门。三跑同任务、各自 fresh sandbox 与 fresh 会话。

产物：`.scratch/autonomy-runs/<label>/`——transcript.txt（可读渲染）/ events.json（原始
事件流）/ final.diff / meta.json（含模型路由、token 用量、profile、permission mode 等
环境元数据，#38 复盘建议）/ evidence/{red,green}.txt（红绿原始输出）/
eval-artifacts/（.eval/ 拷贝：ticket-read / decision-gate / delivery-comment）。

## B 组（接力链）三连跑

```bash
node evals/autonomy/runner.mjs b chain1
node evals/autonomy/runner.mjs b chain2
node evals/autonomy/runner.mjs b chain3
```

链形状：hop1 会话做票 A（slugify）→ 写定向交接文档 `.eval/handoff-A.md`（形状契约 =
handoff_tool 的五节：`# Handoff` / 本会话任务（human 已定向）/ 环境快照 / 产物清单
sha256 / 交接边界——边界段是 runner 内嵌副本，**mode b 启动时逐行核对正典
`handoff-tool.mjs` 交接边界段，漂移即响亮退出**，评测不固化旧版边界协议）+ 更新
`.eval/batch-state.md` → 会话结束；runner 机械复核产物清单（`manifest-check.json`）后把
交接文档**原文**作为 hop2 子会话的第一条 prompt（模拟 handoff_tool 的 fresh + followup，
零继承历史）→ hop2 承接票 B（slug-cli，依赖票 A 导出）。

唤醒编排口径（#163 起正典 = [`lib/autonomy-orchestration.mjs`](../../lib/autonomy-orchestration.mjs)，
runner import 消费、零内嵌副本）：宽限 6 分钟后交付**就绪判据**未满足才触发 nudge，最多
1 次（次数落 `nudges.txt` 并计入每跳 human 交互）；子代理在飞（`subagentCatalog`
continuable 且 settledMs=0）时 turn/end **不判死**（hold 到落定续跑，总超时兜底）。
判据三形态照 #50：A 组 = 提交 + `evidence/green.txt` +
`.eval/{delivery-comment,decision-gate}.md` 全在盘；hop1 = `.eval/handoff-A.md` 在盘；
hop2 = 有新提交。判据外的「交付未齐」（如收尾问询等应答）不触发 nudge——chain3 hop2
的批末问询如今走**应答通道**：runner 无应答方时把问题落 `pending-question.md` 并停在
`awaiting-human`（不再被 45 分钟超时截断）；nudge/代答计量随 `meta.json` 的 `wake` 段
与 `relay-status.json` 携带（批末审计读数行 = `relay-status.json` 的 `auditReading`）。

产物：`.scratch/autonomy-runs/<label>/{hop1,hop2}/` + handoff-A.md 原件 +
batch-state-{hop1,final}.md 逐跳快照 + manifest-check.json + relay-status.json。

## 评分与报告

1. 逐跑按 [rubric.md](rubric.md) 打分（A 组七维；B 组四指标），依据 = transcript +
   events.json + final.diff + eval-artifacts + manifest-check.json。
2. 报告落 `evals/autonomy/report-<日期>.md`：逐跑得分表、证据指针、两组判定、
   「auto-handoff 全自动是否值得开」结论（**只供数据，拍板在 human**）、沙箱边界披露。
3. 失败跑如实记 fail 不美化；评测跑不动的轮次如实标 blocked，不编读数。

## 边界

- 原始 transcript / sandbox 留 `.scratch`（gitignored）；进仓的只有 runner / rubric /
  runbook / 报告。
- 评测会话禁一切 tracker 写操作（runner 任务文本里明令）；runner 自身也不写 tracker。
- 改 `agent.cordis.yml` 才需要 `regen-patch.mjs`；本评测不改 preset 本体（票面 out of scope）。
- 交接机制说明：B 组测的是**接力协议与文档保真度**（L2 编排器视角，runner 扮演编排器）；
  handoff_tool 在 headless CLI 面的 in-session spawn 路径未在本票实测——残留项记录在报告。
