# 0013 — 本地守卫允许、CI 服务不允许（ADR-0004 的边界）

Status: accepted（2026-10-17）

## Context

ADR-0004 决定"插件仓不设 CI"，但**只说了结果，没说边界**。于是每次会话遇到"要不要再加一道
自动检查"都要重新判断一次，并可能得出相反结论。本仓已经走到这一步：

- `#79` 会话 retro 起，`.githooks/pre-commit` 开始跑 `scripts/verify-all.mjs`（唯一检查入口）；
- `#82` 会话 retro 又加了「index / 工作树脱节」拦截（提交记录的是 index，套件跑的是工作树）；
- `#82` 会话的相邻工作区复核带来两项待补：**detached HEAD** 与**实验标记**拦截。

这些都不是"CI"，但 ADR-0004 的文字读不出它们是否被禁。邻仓 `dsh-shell-host` 因为同一困惑立了
ADR-0014（`dsh-shell-host/docs/adr/0014-local-guardrails-not-ci.md`，其 Context 明确引本仓
ADR-0004 为"同向理由"）——本 ADR 是他们那一步在本仓的对应物，判据同形。

两件被同一短语盖住的东西：

- **CI 服务**：`.github/workflows/*.yml`，在 GitHub 托管的干净 runner 上跑。
- **本地守卫**：`core.hooksPath` 指向的 hook（`.githooks/pre-commit`），在开发者本机、提交前跑。

失败面完全不同：runner 上没有本机 msys2 布局、没有已装 DSH 运行时、没有账号凭据，
**上游 rc 一漂就红，且红的不是本次改动**——正是 ADR-0004 要躲的假信号。本地守卫跑在同一台机器上，
环境齐全，**红即代表改动或本机状态有问题**。

## Decision

- **禁止**：为本仓新增 CI 服务（`.github/workflows/` 下任何文件、任何托管 runner）。理由不变
  （上游漂移造环境假红）；重议的前置条件 ADR-0004 已写明（CI 内钉版本装固定 dsh）。
- **允许并鼓励**本地守卫，条件是它只依赖**仓库自身或本机已有**的东西：
  - 允许：`node scripts/verify-all.mjs`（唯一入口，含 privacy 验收）/ `typecheck` 类静态检查 /
    `git symbolic-ref -q HEAD`（detached HEAD）/ `git diff` 类 index 与 staged 面检查 /
    文件编码与行尾检查
  - 允许但**必须响亮跳过**（`!! SKIP (loud)`）而非阻断提交：需要**本机 DSH 布局**的环境侧检查
    （安装 / 启动 / 建会话 / 真实端点）
  - 禁止：任何需要外部网络服务、托管 runner 或第三方账号的检查
- 守卫**必须可按需绕过**（`SKIP_HOOKS=1 git commit …`），且绕过时**打印说明**——与套件的 loud-skip
  惯例一致：未验证就说未验证，不要装作验过。
- 守卫与唯一检查入口**共用同一份判据**（`node scripts/verify-all.mjs`），不得各写一套。
- 现有守卫的**清单是 `.githooks/pre-commit` 自身**（唯一来源，不在本文复述以免漂移）；
  每条守卫的判据由 `tests/verify-precommit-hook.mjs`（H1–H6）钉住。

## Consequences

- 未来会话不必再逐个判断"这道检查算不算 CI"：看它是否落在 `.github/workflows/`、或是否依赖外部
  服务/账号，即可判定。
- 提交前能自动挡住本会话家族真实踩过的几类：index 与工作树脱节、detached HEAD、实验标记泄漏、
  发布面隐私串（后者由套件里的 privacy 验收承担）。
- 代价：hook 是**每 clone 一次**的配置（`git config core.hooksPath .githooks`），未配置的 clone
  不受保护；`scripts/verify-all.mjs` 已对此出 advisory（#69）。故守卫只作**辅助**，验收标准仍是
  唯一入口全绿 + `/code-review` 双轴。
- 上游若未来 API 稳定（0.2.0 正式版），可重议是否把守卫搬到 CI —— 届时需新 ADR 推翻本条的
  "禁止"部分，理由须正面上游漂移问题（ADR-0004 已给出前置条件）。