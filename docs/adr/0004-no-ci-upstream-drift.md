# 0004 — 插件仓不设 CI（上游漂移，钉版本前不可行）

Status: accepted（2026-10-01，human 拍板）

## Context

ADR-0002 的"文本推送排除 Actions"要求目标仓库 ci.yml 配 `paths-ignore`；盘点
ADR 落地差距时自然引出"插件仓自己的 CI 呢"。事实：

- 本仓（dsh-matt-preset）**没有也不需要 CI**：`gh run list` 为空，文本推送零
  Actions 分钟——ADR-0002 的分钟经济对插件仓天然满足，paths-ignore 欠账属于
  **目标仓**（IRIS 等），不属于这里。
- 测试挂具（tests/preset-harness.mjs + tests/node_modules junction）全部锚定
  "本机已装 dsh 运行时"：包表面向 0.2.0-rc，上游 rc 重组即断（#9 整票就是在修
  这种断裂）。CI 里跑这套测试，上游一漂就红——**环境红，不是改动红**，持续
  产生假信号。

## Decision

插件仓**不设 CI**。验收标准 = 本地 tests/ 9/9 全绿 + /code-review 双轴，即现行
节奏。

将来若要上 CI，前置条件是**CI 内钉版本装固定 dsh**（如
`npm i @deepseek-ai/dsh@<ver>` 后指向其包表），把上游升级变成显式的一次性 CI
维护动作而非被动漂移——这与 #9 否掉的"本地钉住运行时"（方向 2，治标）相反：
本地跟装（贴近真实部署），CI 钉版（本分是确定性）。建议等上游 0.2.0 正式版
API 稳定后再议。

## Consequences

- push 不触发任何 Actions 分钟消耗；DONE 门禁不引用远程 CI（与 ADR-0002 批内
  单票语义一致）。
- 上游 rc 断裂时失败在本地第一时间暴露（跑 tests/ 即见），不依赖 CI 兜底。
- 本 ADR 存在的意义是防止未来会话重复提议"给插件仓建 CI"重踩上游漂移坑。
