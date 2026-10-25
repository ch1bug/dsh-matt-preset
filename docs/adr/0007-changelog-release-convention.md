# 0007 — Changelog/RELEASE 规范：版本条目只写 tag 间 diff（升级用户视角，comet 借入）

Status: accepted（2026-10-11，human 已拍立票 #29 候选 C3）

## Context

#29 comet 调研（rpamis/comet 的 release 实践）候选 C3：changelog 的**每个版本条目
只描述与上一个 tag 的差异**，判断标准是**升级用户是否会注意到**。本仓此前没有
CHANGELOG，也没有成文的版本条目规范；RELEASE.md（#21 建立、#41 收敛）覆盖了
版本锚定与安装，但不含条目写法。三个现状约束：

- 本仓发布形态是 family scheme tag（`dsh-v<official>-r<N>` ↔ npm version，见
  RELEASE.md），"一个版本"的天然边界就是相邻 tag。
- 读者是升级中的 preset 用户（重装/upgrade 后会话行为变化），不是源码读者——
  commit 史、重构过程对升级决策无信息量。
- 批次模式下 docs 只本地 commit、随批末统一 push（ADR-0002），changelog 写法
  不能假设"每票即时 push/关票"。

## Decision

采纳 comet C3 标准，并落为 docs/RELEASE.md 的模板条款：

1. **条目边界 = 相邻 tag**：一个版本条目只写 `git diff <上一 tag>..<本 tag>` 中
   对**升级用户可见**的变化。
2. **收录标准（唯一问句）**：升级用户是否会注意到？会注意到 → 写；不会 → 不写。
3. **正例（要写）**：
   - 新增/删除的命令、插件行为、skill、安装方式变化（如 #41 的安装入口收敛）；
   - persona/工作流门禁对会话行为的变化（如 #36 的测试分级、恢复纪律）；
   - 破坏性变化与迁移路径（必写，并指向 RELEASE.md 对应节）；
   - 版本锚定 scheme 本身的变化。
4. **反例（不写）**：
   - 分支迭代过程（哪个分支、多少票、会话内部往来）；
   - 重构史与内部实现细节（renumber、文件搬运、测试挂具内部调整——除非用户
     可见）；
   - **已发布内容重写**：旧版本条目一经 tag 发布不改写（纠正写进新条目，标注
     影响版本）；
   - 未包含在该 tag 内的工作（批次中未推送的后续票不提前预告）。
5. **与批次模式的一致性（AC③）**：changelog 条目只在**打 tag 的发布动作**时写
   或更新，写的是 tag 间 diff，因此天然与 ADR-0002 "docs 只本地提交，随下次
   代码一起推送"兼容（批次模式下该推送即批末总结门后的一次推送）——不产生
   "每票更新 changelog 即时 push"的压力；docs-only 的 changelog 提交同样受
   ADR-0002 文本推送排除 Actions 约束。
6. 模板见 [docs/RELEASE.md](../RELEASE.md)「版本条目（Changelog）模板」节。

## Consequences

- 本仓暂无 CHANGELOG.md 文件：标准先行，首次发版（首个 tag）时按模板创建，
  不在本 ADR 范围内预建空文件。
  - **#91 更新（2026-10-25）**：落点已定 RELEASE.md 支——条目落 docs/RELEASE.md
    「版本条目（Changelog 落地区）」节（模板节下一节），**不另建 CHANGELOG.md**。
    首个 tag `dsh-v0.2.0-rc.2-r1` 打在本 ADR 拍板（2026-10-11）之前，未曾按上文
    「首个 tag 时创建」执行；为免两处条目副本漂移，落点收敛为一处（D40/RELEASE.md
    模板节已同步同一口径）。
- "是否注意到"是判断题而非机械 diff 转储：agent 写条目时保留取舍裁量，拿不准
  的条目倾向写入并一句话说明（宁可多一行，不让升级用户漏看破坏性变化）。
- 旧条目不可改写意味着写错 tag 条目的成本由新条目吸收——打 tag 前的批末总结
  门是条目的最后审读点。
