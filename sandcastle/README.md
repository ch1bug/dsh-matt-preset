# 沙箱批跑（sandcastle × DSH headless）

把攒批里的票据下放到 podman 沙箱，由**沙箱内的 DSH headless**（`dsh --profile headless "<task>"`）
AFK 执行；主会话只编排。三条车道：**Y（yolo，审计后无人值守）/ B（现行 batch）/ H（human）**，
对应 persona 的 SANDBOX BATCH MODE 条款与 [ADR-0003](../docs/adr/0003-sandbox-batch-mode.md)
（opt-in，人类明确说"沙箱批跑"才启用）。

核心格言（afk 插件）：**human judgment at the edges, agents in the middle** —— 发射前票据审计、
收口后 digest 抽查，中间全交 agent。

## 项目接入（一次性）

1. 把 `templates/` 四件套拷进项目 `.sandcastle/`（Dockerfile / dsh.ts / audit-ticket.mts / run-ticket.mts）
2. `npm i -D @ai-hero/sandcastle@0.12.0 tsx` —— **钉版本**（0.x API 周级变动）
3. 构建镜像：`podman build -f .sandcastle/Dockerfile -t localhost/<repo>:dsh .sandcastle`
   （Rust 项目把 Dockerfile 里 rustup 注释段打开）
4. 项目 `workflow-gates.yml` 的 `external:` 加 `sandcastle` 与 `run-ticket`
   （enforcer 默认清单已含这两条；项目文件存在时默认清单被替换，需显式带上）
5. `.sandcastle/worker-context.md`（可选）：项目 principles/gotchas 摘要，worker 开工前必读；
   缺省用模板内置的 ponytail 阶梯（ vendored 自 [ponytail](https://github.com/DietrichGebert/ponytail)）。
   主会话同样可用——skill 目录已带 `ponytail`（说 "ponytail" 或 "be lazy" 唤醒，"stop ponytail" 退出）。

## Y 车道流程（yolo）

```bash
# ① 票据审计（机械预检：标签/AC 关键词/验证命令/touch-set/禁区词）
npx tsx .sandcastle/audit-ticket.mts --issue 449          # exit 0=launch 2=demote 1=rework
#   → 编排者（主会话）在 .sandcastle/audits/449.json 补写 orchestratorNote 判词

# ② 发射（--yolo 校验审计记录；缺判词拒发）
npx tsx .sandcastle/run-ticket.mts --issue 449 --yolo --image localhost/<repo>:dsh

# ③ 合并门（编排者执行，不信 worker 自述）——在同一个沙箱里 exec 审计点名的验证命令
#    绿 → 波次串行合并（rebase onto master，3–5 票一波）；红 → 同沙箱返工一次或 Bucket A
# ③.5 收口审计：对每票跑 `ticket-audit` 技能（对抗式清单：AC 覆盖/测试真实性/
#    验证重放/skip 主张核查/touch-set 合规/禁区/诚实性——阶梯豁免）

# ④ 批末一次 push 过 summary gate（Actions 分钟经济，ADR-0002）
#    CI 配额宽裕的仓库可改 --pr --auto-merge（PR-per-unit，GitHub 当合并队列）
```

出口证据四件套：**审计记录 + commit SHAs + 验证 exec 输出 + 沙箱运行日志**。"worker 说做完了"不算闭环。

## 已知边界（Windows 宿主实测）

- `copyToWorktree` 在宿主侧 spawn `cp`（ENOENT）——不要用；票据文件先 commit 进分支
- DSH 凭据要求 mode 600——模板钩子里已带 `chmod 600`
- podman machine 内存是并行度上限（2GiB 只够 1–2 并行；放量先 `podman machine set` 扩容）
- `PrintCommand` = `{ command, stdin }`，command 是完整 shell 串；DSH headless 不读 stdin
- 官方 node 镜像已占 uid 1000（node 用户）——Dockerfile 里先删后建 agent 用户

完整调研：工作区 `research/sandcastle-matt-workflow-integration.md`。
