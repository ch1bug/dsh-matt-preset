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

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Repo docs（导航指针；细节在各文件里，勿在此复述）

- 决策与术语：`CONTEXT.md`（D1–D50）、`docs/adr/`
- **验证**：`node scripts/verify-all.mjs`（唯一入口；`pnpm test` 是同一脚本的别名，但 agent shell 里 pnpm 未必在 PATH 上——工具链路径见 `docs/dev-environment.md` §0.2）。首次 clone 先 `git config core.hooksPath .githooks` 启用 pre-commit 门禁——本地配置不随 clone 分发（`SKIP_HOOKS=1` 明确绕过）；汇总里的 `PASS*` 表示该用例含 loud skip，环境侧断言未验证
- **复核**：`docs/code-review-brief.md`（/code-review 两轴 brief 组装口径 + 本仓「失败长什么样 / 挑刺设限」+ 收敛纪律 + 缺陷类登记；审阅阶段读，实现阶段不必读）
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