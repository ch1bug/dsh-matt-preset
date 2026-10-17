# 0008 — 版本锚定双通道：latest 跟 RC，next 跟 alpha（#42 拍板）

Status: accepted（2026-10-16，human 拍板，triage 会话落盘）

## Context

#42（#22 残余）指出票面锚点 dsh-v0.2.1-alpha.1 已过时：运行时现为 0.2.0-rc.2
（本仓 tag `dsh-v0.2.0-rc.2-r1`，npm `0.2.0-rc.2-r1`）。待决策三项：下一锚点
版本线、升版节奏、tag 命名是否延续（票面误引 ADR-0005，实为
[ADR-0007](0007-changelog-release-convention.md) 的 family scheme
`dsh-v<official>-r<N>`，与 docs/RELEASE.md 一致）。

## Decision

1. **版本线**：跟随 DSH 运行时 rc 线（rc.2 → rc.3 起跟），不等 stable。
   `r<N>` 后缀本就是为跟随上游 rc 设计的；rc 间 harness 行为可能漂移，
   preset 需锚定实际行为而非等正式版。
2. **节奏 / 双通道**：参考上游 DSH 的分发通道——**latest 跟 RC，next 跟
   alpha**。rc 锚点（latest 线）按需跟随、不做空转 bump；dsh 发 alpha 构建时，
   本仓可在 next 通道发对应的 alpha 锚点预览版。
3. **命名**：延续 family scheme，后缀由 `-r<N>` 扩展为 **`-<r|a><N>`**：
   - `r<N>` = rc 锚定（latest 通道），如 `dsh-v0.2.0-rc.2-r1`；
   - `a<N>` = alpha 锚定（next 通道），如官方 alpha `0.2.1-alpha.1` 上的
     第一次迭代为 `dsh-v0.2.1-alpha.1-a1` ↔ npm `0.2.1-alpha.1-a1`。

## Consequences

- docs/RELEASE.md 方案节同步为双通道表述（tag ↔ npm ↔ 产物三段映射不变，
  仅后缀字符集扩为 r|a）。
- next 通道版本不进 latest 升级路径；安装/回滚逻辑不变（旧 tag ↔ 旧 npm
  版本仍一一对应）。
- 下一锚点：dsh 出 rc.3 后按需重锚为 `dsh-v0.2.0-rc.3-r1`。
- ADR-0007 的 changelog 模板条目形态相应容许 `a<N>` 后缀。

## 注记（不改正文的历史陈述）

- **2026-10-17（#88 落地）**：下一锚点已落地为 **tag `dsh-v0.2.1-rc.1-r1` ↔ npm
  `0.2.1-rc.1-r1`**，宿主 tag `dsh-v0.2.1-rc.1`（commit `1600d8a1`）。版本线政策本身
  **未变**——`Decision` 第 3 条里预写的 "rc.3" 只是当时的版本号猜测，family scheme
  照旧；本注记只登记事实。
