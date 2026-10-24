# AGENTS.md

## 沟通语言

**与 human 沟通一律用中文**：回复、提问、阶段声明、总结、报告、交接文档正文都用中文；
代码、标识符、命令、上游英文术语保留原文，引用英文原文时附一句中文说明。
这是 human 对本仓库 agent 的明确要求（2026-10-16），不因任务语言、上下文语言或工具
输出的语言而改变。

## Agent skills

### Issue tracker

Issues are tracked on GitHub (ch1bug/dsh-matt-preset) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

Orthogonal batch-side labels: `scheduled` / `no-batch` / `tracking` (#141); `P0` is **not yet implemented** (see #142). Their semantics live in `docs/agents/triage-labels.md`.
分诊产出还有两步：**冲突归零**（四类冲突 + 三种出路 + 措辞黑名单）与**判粒度**（小微四条 /
关联三条 / 「可合并」提案格式）：见 `docs/agents/issue-tracker.md` 的「分诊产出前置项」——
这里只留指针。

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Repo docs（导航指针；细节在各文件里，勿在此复述）

- **项目层（跨两仓）**：本工作区 = preset 仓 + 邻仓 `dsh-shell-host`；跨仓 tracker 路由、
  triage 标签映射、双域文档地图在 `.zcode/agents/`（项目作用域，git 排除，不进仓）
- 决策与术语：`CONTEXT.md`（D1–D51）、`docs/adr/`
- **会变的东西别抄当前值**：成员名单 / 当前读数 / 编号这类跨会话会变的东西，文档里写**现查命令**（或区间、
  指针），不抄当前值 —— 抄一份就是第二份清单，它一定会腐。现查命令的正则**照抄判据的正则**（手写简化
  版会静默漏报：#129 实测 `^ \* @slow` 比判据 `^[ \t]*\*[ \t]*@slow` 窄，标记写成 `  * @slow` 就漏掉）。
  同理，**时长/性能读数只写区间**，单次值进证据文件（否则每修一次实现就要再改一次文档）。
- **验证**：`node scripts/verify-all.mjs`（唯一入口；`pnpm test` 是同一脚本的别名，但 agent shell 里 pnpm 未必在 PATH 上——工具链路径见 `docs/dev-environment.md` §0.2）。首次 clone 先 `git config core.hooksPath .githooks` 启用 pre-commit 门禁——本地配置不随 clone 分发（`SKIP_HOOKS=1` 明确绕过）；汇总里的 `PASS*` 表示该用例含 loud skip，环境侧断言未验证。**分层（#129）**：直接跑 = **快集**（跳过头部标了 `@slow` 的长跑用例；pre-commit 走这一层），`--all` = 全量 —— **批末 / 推送前 / 交付前必须跑 `--all`**（本仓无 CI，全量即最终验收）；快集每次都逐行列出跳过的 slow 用例，**快集绿 ≠ 全量绿**。另有 `NORUN` 一档 = **没有退出码**（被信号杀 / watchdog 超时），读作"没跑完"，**不是**用例失败。何时该跑哪一层见 `docs/dev-environment.md` §0.2「分层」
- **复核**：`docs/code-review-brief.md`（/code-review 两轴 brief 组装口径 + 本仓「失败长什么样 / 挑刺设限」+ 收敛纪律 + 缺陷类登记；审阅阶段读，实现阶段不必读）
- **并行会话 / 暂存纪律**：多会话共享检出时 `main` 不当工作分支——**一票一分支**（#103）；
  暂存/提交三条纪律与「唯一写者」判据（显式路径代替 `-A`、pathspec 提交、提交后 `git show --stat` 核对）：
  `docs/dev-environment.md` §0.4
- **个人 / 本机环境串不进仓**（本仓 PUBLIC）：家目录、检出/旧布局路径、署名与邮箱一律用占位符
  （`$HOME` / `%USERPROFILE%` / `<repo>` / `<user>` / `<work>`）；机械守卫 `scripts/privacy-scan.mjs`
  随 `verify-all` 进 pre-commit（denylist 在 `<DSH_HOME>/privacy-denylist.txt`，**不进仓**）。
  何时要历史重写、怎么一遍跑齐、飞行前后检查、tracker 口径：`docs/agents/privacy.md`
- 源码部署 / 运行时可达性（`dsh` 从哪来；PATH 无 dsh ≠ 运行时缺席）/ **读上游源码查契约与先例**（系统提示里的 `app.asar\dsh\` 读不了；可读检出与 live 面的第二个 DSH_HOME 见 §3.1）/ 隔离契约 / 构建坑（ucrt64、宿主锚、clean、端口冲突）：`docs/dev-environment.md`
- 驱动实例 / 读耐久证据 / RPC 参数名 / mock LLM：`docs/dsh-runtime-cheatsheet.md`
- 沙箱批跑（opt-in）：`sandcastle/README.md`

## home 安全（硬规则）

桌面端 shell 里 `DSH_HOME` 已导出为**真实** home（`%USERPROFILE%\.dsh`），子进程原样继承。
任何会写/删 home 的命令必须先把 `DSH_HOME` 显式覆盖到 `%TEMP%` 下的目录，并 echo 解析后的
绝对路径；**禁止** `Remove-Item -Recurse -Force $env:DSH_HOME` 一类展开。安装器自带路径守卫
（`lib/safe-target.mjs`，`tests/verify-installer-guards.mjs` 钉住），`scripts/verify-all.mjs`
会给子进程注入临时 `DSH_HOME`；但守卫不覆盖手工命令。事故现场与隔离契约见
`docs/dev-environment.md` §1。

**只读自动变量陷阱（2026-10-18 第三次事故的直接机制）**：PowerShell 里 `$HOME` / `$PID`
是**只读自动变量**（`$home` 与 `$HOME` 不区分大小写），`$home = …` 是**非终止错误** ——
stderr 打一行、脚本继续跑，`$home` 仍是真实 profile，后续 `New-Item` 因目标已存在而失败，
于是**沙箱 home 从未建出来**、`Join-Path $home '.dsh'` 静默指向真实 home，收尾的递归删除就
删掉了真实 `~/.dsh`。因此：

- 临时目录变量一律**换名**（`$tmpHome`），不要用 `$home` / `$HOME`；
- 删除/覆盖目标**只能是本条命令自己建出来的路径**（`mktemp` / `mkdtemp` 的输出），
  **禁止**按 `$env:DSH_HOME` / `$HOME` 的展开结果再解析一遍当目标；
- 需要隔离跑一条命令时，**不要手搓 shell 造沙箱 home**（PowerShell / bash / 临时脚本同罪——
  2026-10-23 实机验证时 bash 手搓 `DSH_HOME=<temp>` 就绕过了守卫），走
  `node scripts/with-temp-home.mjs -- <cmd…>`（在 `os.tmpdir()` 下建、建前与删前各断言一次、
  只删自己建的那一个路径；缺失 `--` 或空命令时**响亮失败**）。守卫纯函数
  `assertSafeTempHome` 由 `tests/verify-temp-home-guard.mjs` 钉住；
- `workflow-enforcer` 认得「删除动词 + home 目标」的组合（`HOME_DELETE_TRIGGER`）并在下一轮
  **提醒一次** —— 它**只提醒、不拦截**，别把它当物理防线。