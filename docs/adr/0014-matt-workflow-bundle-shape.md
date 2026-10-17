# 0014 — `dsh-matt-workflow` 形态：组件不独立分包，追认同包 row（#76 拍板）

Status: accepted（2026-10-17，human 拍板，决策会话落盘）

## Context

- #57 / #58 / #59 / #60 的票面都要求组件落进 **the workflow bundle（`dsh-matt-workflow`）**，
  但该 bundle 不存在、形态未定，派工第一步就撞墙。#76 即那个可指的阻塞对象；票面给 A（本仓新
  package）/ B（独立仓）/ C（暂不拆）三选项 + 三项"拍板时一并定"。
- **历史事实（本 ADR 补记）**：#54 的票面原文要求 *"a new, independently installable plugin package
  (`dsh-matt-workflow`, workflow-core) … The matt preset switches to mounting the new package."* ——
  但落地（commit `ee859ab`，ADR-0010）改成了**本仓同包 plugin row**（`workflow-core.mjs` + 包
  subpath exports）。包名 `dsh-matt-workflow` 在本仓**全历史不存在**（`git grep` / `git log -S` 均无
  输出），**ADR-0010 未记录这次改道**；#55 / #56 沿同形态继续。本 ADR 追认该改道并写明理由。
- **机制事实（本轮实测）**：DSH 里 **bundle = 在 `package.json` 声明 `dsh.bundle.patch` 的 npm 包**，
  产物是**补丁层**；**plugin row = patch `insert` 出来的一行**（manifest 无 plugin 字段）。
  `dsh.bundle.patch` 可以是**文件数组**，故"一个 bundle 挂多个 preset"是上游原生形态——
  `@deepseek-ai/dsh-web-app` 列 5 个 patch 文件，其中 `presets/{standard,ptc,minimal,cordis}.patch.yml`
  各插一行 preset 声明；它的"共享层"`cordis.patch.yml` 内容是 **host 面**（webserver / UI /
  controllers），**agent 面不存在共享组件层**，每个 preset 各自抄一份完整 roster。
- **一仓多 bundle 的先例**不在本仓/邻仓，但在两处：上游 DSH 自身（`packages/bundle/*`、
  `packages/experimental/*`，各自 `package.json` + patch）与本账号的 `ch1bug/deepseek-design`
  （根无 `package.json`、无 workspaces，`packages/` 下三个包各有 `dsh.bundle.patch`，**三个都已发
  npm**，用 registry spec 安装，"Installing one package never downloads the other two"）。
- **收益面**：今天**不存在非 matt 消费者**——两个 live 面（web / headless）都挂 matt 全量，桌面端
  未装 matt。
- 邻仓 `dsh-shell-host` ADR-0007 = *single package, multi entry*（一个包、多入口、一个 release
  train、每入口独立 settings namespace）；其 `dsh-shell-remote` 在**需要独立发布**时是**拆独立仓**。

## Decision

1. **形态 = C（追认挂载级独立）**：组件**不独立分包、不独立建仓**。`dsh-matt-preset/<file>.mjs`
   的 subpath exports 同包形态**认作既定基线**；确立 **"独立可挂载（L1）≠ 独立包（L2）"**。
   L1 已由 #54 实测达成（非 matt preset 单行挂载 `dsh-matt-preset/workflow-core.mjs` 即得工作流）。
   L2（独立包名/版本/安装通道）与 L3（独立仓/发布栈）**不做**。
2. **术语正名**：**bundle = 预设分发载体**（`dsh.bundle.patch` → 补丁层）；**"the workflow bundle"
   自本 ADR 起指本包内那四个组件行**（`workflow-core` / `workflow-enforcer` / `lang-enforcer` /
   `handoff-tool`）**+ 承载它们的 preset 声明**——不是独立包，也不是独立 preset。术语入 `CONTEXT.md`。
3. **不引入第二套档位机制**：上游用"多 preset 声明"表达同一工作流的多个档位（roster 逐份重复），
   matt 已用 **profile delta**（ADR-0011 / ADR-0012）以**零重复**表达同一件事。故**不新增第二个
   agent preset 声明**（不做 `presets/*.patch.yml`），保持单 patch 文件、单 preset 声明。
4. **附带三项**（票面要求一并定）：
   - **npm 包名与版本锚**：无新包 → 无新包名、无第二条版本线；沿用单锚 ADR-0008 的
     **`0.2.0-rc.2-r1`**（跟宿主 rc 线）。**（2026-10-17，#88 更新：锚点已前移为
      `0.2.1-rc.1-r1`；本条**形态结论不变**——仍无新包名、无第二条版本线。）**
   - **与安装器的关系**：**不变**——单目录 payload 拷进 `<DSH_HOME>/.agent-presets/matt/`
     （`bin/install.mjs` 本次不动）。
   - **`cordis.patch.yml` 生成/锁定**：**不变**——`scripts/regen-bundle.mjs` 生成、
     `tests/verify-bundle-sync.mjs` 双向逐字节锁定、`tests/verify-payload-manifest.mjs` P3 保证
     载体在 payload 内。
5. **复活触发条件**（任一成立才重开本决策，届时不必重新论证形态）：
   (a) 出现**第二个真实消费者**（非 matt 的 preset / 仓）要挂这些组件；
   (b) 组件需要**脱离 matt preset 的版本节奏**发布；
   (c) 包名语义成为**实际阻碍**（第三方文档/命名冲突）；
   (d) 真有人要**"只带工作流、不含 matt 人设"的独立 preset 声明**。
   (a)–(c) → 走 **L2**：本仓子包 + 发 npm（`deepseek-design` 已证模式，registry spec 分发成立）；
   (d) → 加 `presets/*.patch.yml`，roster **必须由生成器从单一源合成，禁止手抄**。

## Considered Options（留档，防止将来重复讨论）

- **A 本仓新 package**：机制可行（DSH 不要求 workspaces、不要求目录名=包名；子目录包 `file:` / `link:`
  实测可装），但代价集中在**跨包**：主包自写安装器只拷单目录 payload、组件行名前缀要换、守卫要双份；
  且 `file:` 是硬链接快照并尊重 `files`（patch 与入口必须列进子包 `files`）、DSH 的 git spec
  **不支持子目录**（分发只能走 npm）。今天零消费者，不值。
- **B 独立仓**：分发优势被 npm 通道抹平（A 也能发 npm），只剩 L3；而本仓**无 CI**（ADR-0004 /
  ADR-0013），跨仓版本锚一致**没有守卫先例**。
- **D 照 web-app 分层**：核实后其"共享层"是 host 面、preset 层是各自完整 roster；照抄到 matt 只会得到
  "再抄一份 roster 的第二个 preset 声明"，与已验证的 profile 机制重复，撞 D29（不为未出现的问题堆机制）。

## Consequences

- #57 / #58 / #59 / #60 的"移进 the new bundle"改写为**"抽成/保持本包内的独立可挂载组件行"**；
  #76 的阻塞边移除，四票恢复可直接派工；#59 的"安装器 / patch 生成闭合到新 package 布局"改为
  闭合到**现有布局**。
- 省下一整套跨包迁移与守卫面；代价是接受**包名 `dsh-matt-preset` 承载工作流组件**（对外命名不够
  自解释）——由 #59 的 README composition 段缓解。
- 三条邻居先例的方向记录在案：上游（一仓多 bundle / 一 bundle 多 preset）、本账号 `deepseek-design`
  （子包 + npm 分发）、邻仓 `dsh-shell-host`（单包多入口；需要独立发布即拆仓）。
- 本 ADR 不产生实现票；#76 的结论即本 ADR。