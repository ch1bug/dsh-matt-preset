# 沙箱批跑（sandcastle × DSH headless）

把攒批里的票据下放到 podman 沙箱，由**沙箱内的 DSH headless**（`dsh --profile headless "<task>"`）
AFK 执行；主会话只编排。三条车道：**Y（yolo，审计后无人值守）/ B（现行 batch）/ H（human）**，
对应 persona 的 SANDBOX BATCH MODE 条款与 [ADR-0003](../docs/adr/0003-sandbox-batch-mode.md)
（opt-in，人类明确说"沙箱批跑"才启用）。

核心格言（afk 插件）：**human judgment at the edges, agents in the middle** —— 发射前票据审计、
收口后 digest 抽查，中间全交 agent。

## 项目接入（一次性）

1. 把 `templates/` 拷进项目 `.sandcastle/`（Dockerfile / dsh.ts / audit-ticket.mts / run-ticket.mts / night-run.mts / lib.ts——lib.ts 与模板同目录、相对导入 `./lib.ts`，别漏拷）
2. `npm i -D @ai-hero/sandcastle@0.12.0 tsx` —— **钉版本**（0.x API 周级变动）
3. `npm i ./ch1bug-sandcastle-dsh-<ver>.tgz` —— DSH provider 包（#18 正式化：
   dshHeadless / patchAgentDefaultModelCmd / 沙箱接入件；`dsh.ts` 与 run-ticket
   均从该包导入。发布后可直接 `npm i @ch1bug/sandcastle-dsh`；版本锚定见包内 docs/RELEASE.md）
4. 构建镜像：`podman build -f .sandcastle/Dockerfile -t localhost/<repo>:dsh .sandcastle`
   （Rust 项目把 Dockerfile 里 rustup 注释段打开）
5. 项目 `workflow-gates.yml` 的 `external:` 加 `sandcastle` 与 `run-ticket`
   （enforcer 默认清单已含这两条；项目文件存在时默认清单被替换，需显式带上）
6. `.sandcastle/worker-context.md`（可选）：项目 principles/gotchas 摘要，worker 开工前必读；
   缺省用模板内置的 ponytail 阶梯（ vendored 自 [ponytail](https://github.com/DietrichGebert/ponytail)）。
   主会话同样可用——skill 目录已带 `ponytail`（说 "ponytail" 或 "be lazy" 唤醒，"stop ponytail" 退出）。

### 构建后自检：容器 COMPLETE 冒烟（`complete-check.sh`）

镜像建好**先跑一遍冒烟**，别等夜批才发现 worker 形态起不来（#34 第 1 项，源自 #18 批末遗留）：

```bash
bash .sandcastle/complete-check.sh --image localhost/<repo>:dsh
# exit 0 = 容器内 `dsh --profile headless` 真的回了 <promise>COMPLETE</promise>
```

它做三件事：**复用现有** podman machine（**绝不** init/set/stop/rm，也不停不删别人的容器与镜像
——machine 是共享 WSL VM，内有别的项目数据）、按需建镜像（`--no-build` 可禁）、在容器内跑一轮
headless 并断言收尾契约。同时把「Dockerfile 钉的版本」与「镜像里真装的版本」比一次，
陈旧镜像会在这里红，而不是在夜批里红。宿主 `$DSH_HOME` **只读**挂入，只拷
`.credentials.yaml`（有 `settings.yaml` 一并带上）。

常用开关：`--network host|podman`（默认 host，见下「已知边界」）、`--user 1000:1000`（默认，
对齐镜像里的 agent；rootful machine 下 `--userns=keep-id` 与 host 网络冲突）、
`--env KEY[=VALUE]`（可重复，只写 KEY 时从启动环境取值）。

**凭据这一格的实测（2026-10-20）**：容器里**只拷 `.credentials.yaml` 不够** —— 新引导的
headless profile 仍报 `MISSING_CREDENTIAL: llm-deepseek`；把 `DEEPSEEK_API_KEY` 从启动环境
透传进去就过（本脚本**自动**透传，前提是它在你启动脚本的那个 shell 里存在）。两条路都保留：
文件拷贝是 run-ticket 的现行形态，env 是本机实测可靠的一条。

退出码：`0` 通过 / `2` 环境前置不满足（podman、machine 未起、镜像缺失、凭据缺失）/
`3` 镜像构建失败 / `4` 运行失败或未观测到 COMPLETE / `5` 镜像内 dsh 版本 ≠ 钉版。

### 钉版策略：DSH 版本只认一处（#34 第 3 项）

`templates/Dockerfile` 里 `npm i -g @deepseek-ai/dsh@<ver>` 的版本**单一事实源是本包
`package.json` 的 `version`**（去掉 `-r<N>` 后缀即宿主锚：`0.2.1-rc.2-r1` → `0.2.1-rc.2`；
口径见 [docs/dev-environment.md](../docs/dev-environment.md) §2 与 ADR-0008）。
Dockerfile 必须写死字面量（镜像构建期读不到本仓的 package.json），因此由
`tests/verify-sandcastle-pins.mjs` 机械校验两处逐字一致——**别在 Dockerfile 里手改版本**：
重锚只改 `package.json` 的 `version`，再 `podman build --no-cache` 重建镜像。
`complete-check.sh` 补第二道：比对「Dockerfile 写的」与「镜像里真装的」。

## Y 车道流程（yolo）

```bash
# ① 票据审计（机械预检：标签/AC 关键词/验证命令/touch-set/禁区词）
npx tsx .sandcastle/audit-ticket.mts --issue 449          # exit 0=launch 2=demote 1=rework
#   → 审计记录落盘 touchSet 数组（跨票重叠扫描的数据源）
#   → 编排者（主会话）在 .sandcastle/audits/449.json 补写 orchestratorNote 判词
#   → 跨票扫描：npx tsx .sandcastle/audit-ticket.mts --touch-overlap
#     读全部 audits 的 touchSet（精确相等或目录前缀都算交集），union-find 归并
#     重叠票 → 写 .sandcastle/audits/touch-overlap.json（serial:true 分组建议，
#     night-run 波次分组消费）；exit 0=扫描成功（含建议输出） 1=信息不足（缺记录/
#     缺 touchSet/JSON 损坏 → 回炉重审）

# ② 发射（--yolo 校验审计记录；缺判词拒发）
npx tsx .sandcastle/run-ticket.mts --issue 449 --yolo --image localhost/<repo>:dsh

# ③ 合并门（编排者执行，不信 worker 自述）——在同一个沙箱里 exec 审计点名的验证命令
#    绿 → 先过大 diff simplify 门（已落地：diff 行数 > 阈值默认 800，可配
#    --simplify-threshold；超限 → exit 7 + checkpoint 为 needs-simplify，分支保留，
#    simplify pass 后重跑或 --no-simplify 显式豁免）→ 波次串行合并
#    （rebase onto master，3–5 票一波；serial 组强制同波、波内串行——分组建议由
#    night-run digest 的波次提示段给出，写域重叠票也可并入或直接合并）；红 → 同沙箱
#    返工一次或 Bucket A
# ③.5 收口审计：对每票跑 `ticket-audit` 技能（对抗式清单：AC 覆盖/测试真实性/
#    验证重放/skip 主张核查/touch-set 合规/禁区/诚实性——阶梯豁免）

# ④ 批末一次 push 过 summary gate（Actions 分钟经济，ADR-0002）
#    CI 配额宽裕的仓库可改 --pr --auto-merge（PR-per-unit，GitHub 当合并队列）
```

出口证据四件套：**审计记录 + commit SHAs + 验证 exec 输出 + 沙箱运行日志**。"worker 说做完了"不算闭环。

## 夜间批跑（检查点续跑 + 看门狗 + 清晨 digest）

```bash
# ① 编排会话构建队列（已过票据审计的 Y 车道票，按依赖排序）
#    .sandcastle/night-queue.json: { "tickets": [449, 452, { "issue": 455, "verify": "cargo test -p iris-agent --lib" }] }

# ② 发车（每票独立子进程：单票崩不伤队列；检查点幂等，中断后重跑同命令即续命）
npx tsx .sandcastle/night-run.mts --image localhost/<repo>:dsh \
  --verify "cargo test -p iris-api --lib" --max-minutes 60

# ③ 早晨：读 .sandcastle/digest/<stamp>.md → ticket-audit 抽查 → 批末 push 过 summary gate
```

- **批末收尾适用 #71 的批末 retro 规则**（车道适用范围见
  [docs/batch-state.md](../docs/batch-state.md) 的「适用车道」节）：**批末 push + CI 全绿 → 在清晨
  主会话跑 retro**（读齐同批 `.scratch/retro/*.md` → 去重合并 → 一次呈现 → 写
  `.scratch/retro/.aggregated` → 把 `retro: done @ <commit>` 写进 `.scratch/batch-state.md`）。
  **容器内不跑 retro**：夜批只把 digest 的「retro 素材」段（返工 / 踩踏 / 降级 / 波次合并摘要）
  当**喂料**——候选交 human 的决策路径只在清晨主会话，喂料不参与判定
  （**复用 #71 的标记，无专用机制 / 无专用状态文件**）
- **检查点**：每票完成写 `.sandcastle/state/<id>.json`（status/commits/verify/log），
  merged/pr 的票重跑自动跳过——崩溃从断点继续，不从头再来
- **波次合并提示**（已落地）：digest 末尾附 merged 票的 3–5 票一波分组建议（纯提示，
  真执行归编排者）；消费 `audit-ticket --touch-overlap` 写出的 serial 组——重叠票强制
  拉进同一波并在波内串行（组大小可溢出 5），无 serial 标记则按默认贪心分组
- **needs-simplify**：run-ticket exit 7（diff 超阈值 parked 为 needs-simplify，
  分支保留）——night-run 已登记 exit 7 → needs-simplify，幂等跳过与 parked 同等对待；
  diff 统计本身失败（git diff 非 0）时告警放行，checkpoint 记 `simplifyStatFailed:true`，不触发 needs-simplify
- **看门狗**：`--max-minutes` 每票墙钟上限（AbortSignal），超时 = parked-timeout
- **配额熔断**：provider 配额/认证错误 = 停止信号，持久化队列退出（exit 2），明晚续跑
- gitignore 建议：`.sandcastle/state/`、`.sandcastle/digest/`、`.sandcastle/audits/`

## 模型路由（model-lane，#16）

不是所有票都值得最好的模型。排批/审计时分级，worker 按档路由：

| Lane | 判据（机械提示） | 典型 |
| --- | --- | --- |
| **A** 顶配 | 标题/正文命中决策/架构/ADR/money/治理/迁移语义（机械只提示，编排者 `--lane A` 拍板） | 架构改造、money-path |
| **B** 常规 | 默认 | 一般 implement 票 |
| **C** 低配 | touch-set 全为 docs/ 或 *.md | docs-only、模板填充 |

- 审计记录 `modelLane: {lane, suggested, source, reason}`（`--lane A|B|C` 覆盖，source 记来源）
- 映射配置 `.sandcastle/model-lanes.json`（项目自定，缺省不路由）：
  `{ "A": "zai-coding-cn/glm-5.3", "B": "zai-coding-cn/glm-5.3-flash", "C": "zai-coding-cn/glm-5.3-air" }`
- 生效机制：run-ticket 解析路由（`--model provider/model` > lane 映射 > 宿主默认），命中后
  onSandboxReady 钩子在容器内 sed 替换 `~/.dsh/settings.yaml` 的 `agent-default-model:` 块——
  headless worker 的 `agentDefaultModel` 即改（DSH headless 无 CLI 模型参数，settings 是唯一缝）
- checkpoint 记 `modelRoute`（cli/lane/default + note）；night-run 队列项可带 `"model"` 透传
- **白天批（非沙箱）**：batch-state.md 成员行标 lane；批内 handoff 定向节写明"本票跑 X 模型"
  （规避 handoff 子会话模型固化为部署默认的限制）；批末总结回收 lane 判断准确率（retro 素材）
  - batch-state 成员行示例：`- #503 T2：implement 分片（lane B，zai-coding-cn/glm-5.3-flash）`
  - handoff 定向节示例（正文内加一行）：`本票模型：zai-coding-cn/glm-5.3-flash（lane B）——子会话起手把模型选择器对齐到此`
  - 批末回收示例：digest/总结加一列 `lane 预判 vs 实际`（A 预判跑成常规难度 → 下次降 B）

## 已知边界（Windows 宿主实测）

- PATH 上 `bash` 解析到 `C:\WINDOWS\system32\bash.exe`（WSL）时，`sandcastle-e2e.mjs`
  搭台必挂（msys 路径映射 + gcc 缺失）——跑 e2e 前把 `Git\bin`（与 `msys64\ucrt64\bin`
  的 gcc）前置到 PATH（2026-10-09 实测，#18）
- `copyToWorktree` 在宿主侧 spawn `cp`（ENOENT）——不要用；票据文件先 commit 进分支
- DSH 凭据要求 mode 600——模板钩子里已带 `chmod 600`
- podman machine 内存是并行度上限（2GiB 只够 1–2 并行；放量先 `podman machine set` 扩容）
- `PrintCommand` = `{ command, stdin }`，command 是完整 shell 串；DSH headless 不读 stdin
- 官方 node 镜像已占 uid 1000（node 用户）——Dockerfile 里先删后建 agent 用户
- **TUN 代理（fake-IP）宿主出网**：容器**自有 netns** 里 DNS 拿到 `198.18.x` fake-IP、TCP 全超时，
  而 VM netns 正常 —— 构建与冒烟都要 `--network host`（`complete-check.sh` 默认即 host；无代理
  宿主可 `--network podman` 用默认隔离网络）。2026-10-20 实测（apt 与 npm 两条都验证）
- **DSH provider 包缺口（#146）**：`@ch1bug/sandcastle-dsh` 目前**不可获取**（npm 404、上游仓已不在），
  而 `dsh.ts` / `run-ticket.mts` 是薄引用它 —— `audit-ticket.mts` 之外的模板会
  `ERR_MODULE_NOT_FOUND`。本仓 `sandcastle-e2e` 因此全红（opt-in 掩盖至今），修法待 #146 拍板

完整调研：工作区 `research/sandcastle-matt-workflow-integration.md`。
