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

- 决策与术语：`CONTEXT.md`（D1–D44）、`docs/adr/`
- **验证**：`pnpm test`（== `scripts/verify-all.mjs`，唯一入口；首次 clone 先 `git config core.hooksPath .githooks` 启用 pre-commit 门禁——本地配置不随 clone 分发，`SKIP_HOOKS=1` 明确绕过）；汇总里的 `PASS*` 表示该用例含 loud skip，环境侧断言未验证
- 源码部署 / 隔离契约 / 构建坑（ucrt64、宿主锚、clean、端口冲突）：`docs/dev-environment.md`
- 驱动实例 / 读耐久证据 / RPC 参数名 / mock LLM：`docs/dsh-runtime-cheatsheet.md`
- 沙箱批跑（opt-in）：`sandcastle/README.md`