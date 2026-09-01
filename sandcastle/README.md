# 沙箱批跑（sandcastle × DSH headless）

把攒批里的票据下放到 podman 沙箱，由**沙箱内的 DSH headless**（`dsh --profile headless "<task>"`）
以 AFK 方式逐票执行；主会话只做编排。沙箱提供 worktree 隔离 + 独立分支 + 自动合并/响亮失败，
对应 persona 的 SANDBOX BATCH MODE 条款（opt-in，人类明确说"沙箱批跑"才启用）。

## 项目接入（一次性）

1. 把 `templates/` 三件套拷进项目 `.sandcastle/`（Dockerfile / dsh.ts / run-ticket.mts）
2. `npm i -D @ai-hero/sandcastle@0.12.0 tsx` —— **钉版本**（0.x API 周级变动）
3. 构建镜像：`podman build -f .sandcastle/Dockerfile -t localhost/<repo>:dsh .sandcastle`
   （Rust 项目把 Dockerfile 里 rustup 注释段打开）
4. 项目 `workflow-gates.yml` 的 `external:` 加 `sandcastle` 与 `run-ticket`
   （enforcer 默认清单已含这两条；项目文件存在时默认清单被替换，需显式带上）

## 单票用法

```bash
npx tsx .sandcastle/run-ticket.mts --issue 449 --image localhost/<repo>:dsh
npx tsx .sandcastle/run-ticket.mts "把 README 标题改成 X" --image localhost/<repo>:dsh
```

跑完输出 `RunResult`：`commits`（SHA）+ `completionSignal` + 日志路径。默认 merge-to-head
（跑完自动合并回宿主分支）；冲突/失败响亮报错，临时分支保留，按错误信息处理。

## 并行批跑（SANDBOX BATCH MODE）

- **并行执行、串行合并**：`--strategy branch --branch sandcastle/ticket-449` 让票据只落在
  自己分支（不自动合并）；全部跑完后由主会话逐票 `git rebase master` + merge 收口
- **touch-set 检查先于发射**：两票预期改动文件集相交 → 串行或合票，绝不并行
- 冲突票：在同一沙箱再发一个返工任务（"rebase 到 master，解决冲突，重跑验证，commit"）；
  解不动 → Bucket A 回炉
- 票据出口证据 = **commit SHA + 沙箱运行日志**，"worker 说做完了"不算闭环

## 已知边界（Windows 宿主实测）

- `copyToWorktree` 在宿主侧 spawn `cp`（ENOENT）——不要用；票据文件先 commit 进分支
- DSH 凭据要求 mode 600——模板钩子里已带 `chmod 600`
- podman machine 内存给足（每容器一份 DSH + 工具链；2GiB 只够并行 1–2 票）
- `PrintCommand` = `{ command, stdin }`，command 是完整 shell 串；DSH headless 不读 stdin

完整调研：工作区 `research/sandcastle-matt-workflow-integration.md`。
