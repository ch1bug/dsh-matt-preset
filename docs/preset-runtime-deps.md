# Preset 运行时依赖面：常驻 row 的能力档位（#105）

**这是什么**：matt 四档共用 roster 常驻引用的每个插件包，按「出处是否在出货面」归档的
**判据 + 归类登记 + opt-in 前提明示**落点。背景（human 2026-10-18 指令 + #105 实测）：
**开发机 ≠ 用户环境**——开发机桌面 profile 装了 12 个 `experimental-*` bundle，验证永远
在开发机上跑，「常驻 row 引用了用户环境没有的能力」这一类错误**照不出来**（`tool-ralph`
即实例）。

- **判据与机械守卫**：`tests/verify-row-deps.mjs`（R1–R4；四份生成载体的每个 row
  必须归档，否则红）。
- **数据（冻结快照，单一数据源）**：`tests/fixtures/official-runtime-deps-v1.json`
  （出货宿主组合 row id + 发布面依赖读数 + in-box opt-in 依赖链 + tier 登记表）；
  官方 preset row 差异在 `tests/fixtures/official-presets-roster-v1.json`（#117）。
- **判定层（honesty gate）**：静态声明面判定——**门绿 ≠ 用户环境一定可用**；本仓只
  保证**不再假设开发机能力**（#105 AC 边界原文）。不改上游 experimental 分发策略。

## 判据：什么算「出货 core 档」

**row 级**判据（#105 票面勘误口径——比「包是否 core」严：`str-replace-editor` 是
core 包 + opt-in row，`tool-ralph` 是 in-box opt-in，两条都被它一致判出）：

| tier | 判据 | 例 |
| --- | --- | --- |
| **core-row** | row `id` 在官方出货 preset（`@deepseek-ai/dsh-web-app` tarball `presets/{standard,ptc,minimal,cordis}.patch.yml`）**或**出货宿主组合（`dsh-base` / `dsh-web-app` 的 `cordis.patch.yml`）中有**同 id 声明** | `persona` / `tool-fs` / `workflow-ptc`（base）；`tool-cordis`（官方 cordis 档）；`tool-web`（官方 standard 档） |
| **in-box opt-in** | 能力包随发布面 `@deepseek-ai/dsh` 的 dependencies 默认安装，但由 OPTIONAL_BUNDLES 控制默认**未启用**（Plugins 页开）；官方 preset/宿主无同 id row | `tool-ralph`；`str-replace-editor` / `tool-presentation`（row 级） |
| **non-in-box** | 包不在发布面 dependencies，须另行安装 | `tool-subagent-codex` / `tool-subagent-claude-code`（常驻 `disabled: true` 声明位，opt-in 才激活）；`experimental-subagent-oar-codex` / `experimental-subagent-oar-claude` / `tool-subagent-oar`（同口径，#177） |
| **in-repo** | `name` = `dsh-matt-preset/<file>.mjs`，随本 preset 包分发 | `workflow-core` / `workflow-enforcer` / `lang-enforcer` / `handoff-tool` / `workflow-wrapup-card` |
| **local-only** | 仅开发机桌面 profile 有——**不得进 roster** | 12 个 `experimental-*` 中不在发布面 dependencies 的 7 个；`danger-full-access` 沙箱 |

**规约**：常驻（enabled）row 只允许 core-row；in-box opt-in 的常驻引用必须在本页
明示前提与缺席退化路径；non-in-box 只许 `disabled: true` 声明位。
**为什么「包是否在 dsh 的 dependencies」不作 row 级判据**：官方 preset 挂的
`@deepseek-ai/dsh-tool-subagent` 等包**不在**发布面 dependencies（依赖由桌面运行时 /
bundle 的包表提供）——按包判会误杀全部官方同形 row。

## tool-ralph（#92 口径：保留常驻，文档明示——Z5，human 2026-10-19 拍 A）

roster 里 `tool-ralph` 行（`agent.cordis.yml` 309–313，四档共用基线）是四档唯一的
**in-box opt-in 常驻**行。三件事：

1. **依赖**：`@deepseek-ai/dsh-experimental-ralph-bundle`（opt-in bundle）。它随发布面
   `@deepseek-ai/dsh` 的 dependencies **默认安装已装**（其依赖闭包含
   `@deepseek-ai/dsh-tool-ralph`；`dsh-tool-ralph` 本体在 `@deepseek-ai/dsh` 的
   devDependencies、不单独直装），但 bundle 默认**未启用**——不是"需先装 X"，是
   "已装未启用"。
2. **启用方式**：在 DSH 的 Plugins 页启用 `dsh-experimental-ralph-bundle`。
3. **缺席时的表现**：该 bundle 未启用时 `tool-ralph` 工具**不在工具目录**（ralph 循环
   执行器不可用），**工作流其余部分不受影响**——七门、批次模式、handoff、其余工具面
   全部照常。两半归属如实分开：`tests/verify-row-deps.mjs` 的 **R4 钉的是依赖链前提**
   （`tool-ralph` 在 devDependencies + bundle 闭包内、不在发布面 dependencies、官方
   四档与两个宿主组合无此 row——上游形态一变即红，逼人重取读数并更新本节）；
   **缺席行为本身属运行时挂载判定**，本守卫不做也不冒认——R5 每次运行打一行
   `SKIP (loud)` 显式声明该断言未验证（D47：loud skip ≠ 静默通过），等价条件读数
   （装了 matt preset 的 dsh 实例）由具备环境的会话补。

## str-replace-editor（core 包 + opt-in row，matt 有意常驻）

包 `@deepseek-ai/dsh-tool-str-replace-editor` 是 core（发布面 dependencies），但
**任何出货 preset / 宿主组合都不挂该 row**——上游 base README 明写
"remains available as an explicit opt-in"。matt 四档共用基线**有意常驻挂它**（内建文件
编辑器，工作流采用；#117 拍板 b 保留增量，登记于
`official-presets-roster-v1.json` 的 `registeredDiff.reasons.matt-str-replace-editor`）。
包随默认安装提供、无额外启用步骤；若上游将来把该 row 收回 opt-in 分发，依赖链钉子
（R4 的 `officialRows` 断言）会红。

## tool-presentation（core 包 + opt-in row，matt-ptc 有意常驻）

包 `@deepseek-ai/dsh-agent-tool-presentation` 是 core（发布面 dependencies）。
**0.2.2-rc.1 起官方 ptc 档不再挂该 row**（原位换成 `tool-executor-ptc`——本包在 rc.1
的依赖恰为 `dsh-tool-executor-ptc` + `dsh-tool-executor-native`，两者均入出货宿主
组合 hostRows，故包能力随默认安装照常可用）；官方四档与宿主组合均无同 id row。
matt-ptc **有意常驻挂它**（#116 交付的方向 A；#117 拍板 b 保留增量，登记于
`official-presets-roster-v1.json` 的 `registeredDiff.reasons.matt-tool-presentation`
与 `official-tool-executor-ptc`——matt 经本行（`mode: ptc` config）间接持有同执行器
能力，不重复直挂官方新行）。若上游将来撤包或改依赖链，R1（无档可归）/ R4（依赖链
断言）会红。

## subagent_oar 一次性委派（non-in-box 声明位，#177）

delegation 组内三行 `experimental-subagent-oar-codex` / `experimental-subagent-oar-claude`
/ `tool-subagent-oar`（四档共用基线）是 0.2.2-rc.1 起上游实验性委派机制的**声明位**：
`@deepseek-ai/dsh-experimental-subagent-oar`（OAR provider，一次性委派本机 Codex /
Claude Code CLI——独立上下文、完成通知回父、不支持续聊）+
`@deepseek-ai/dsh-experimental-tool-subagent-oar`（`subagent_oar` 工具，按 providers
别名选 provider，toolName 用默认）。三行全部 `disabled: true`，形态照上游
`packages/experimental/subagent-oar/README.md` 的挂载样例。

1. **双启用前提**（缺一即不可用）：① Plugins 页（或显式安装）装
   `dsh-experimental-subagent-oar` 与 `dsh-experimental-tool-subagent-oar` 两包——
   它们**不在发布面 dependencies**（Production dsh 不预装，
   `official-runtime-deps-v1.json` 的 `publishedDependencies` 读数 90 项零命中，#177
   票面实测）；② 本机装/认证 Codex / Claude Code CLI（native 可执行文件须对 DSH
   Host 可见）——provider 不代装、代认证。`launchArgs` 沿上游样例的免审批权限参数
   （codex `workspace-write` 沙箱；claude `dontAsk` + `permission-prompts none`，
   无 DSH 审批 UI），启用前应复核。
2. **缺席退化**：两包未装时三行**不激活**（声明位），`subagent_oar` 工具**不可见**，
   roster 其余部分不受影响——与 `tool-subagent-codex` / `tool-subagent-claude-code`
   的缺席形态同族。机械守卫：`tests/verify-row-deps.mjs` R1（无档可归即红）+
   R2（`mustBeDisabled`——被翻 enabled 即红）；行集合差异登记于
   `official-presets-roster-v1.json` 的 `registeredDiff`（`matt-subagent-oar-optional`）。
3. **归属划界**：本票只交付声明位与登记；委派真跑（OAR 启动、权限、launchArgs
   生效性）归上游与用户实测，本仓不冒认。

## 批末收口卡 kind（in-repo 插件 + 外部服务前提，#182）

`workflow-wrapup-card` 行（四档共用基线，`dsh-matt-preset/workflow-wrapup-card.mjs`）
是 **in-repo** 行（随包分发，无安装前提），但它注册的卡 kind（`batch_wrap_up`）只在
**action-cards 服务在场**时激活——这是它唯一的外部能力前提：

1. **依赖**：`ctx.actionCards` 服务由 `@deepseek-ai/dsh-personalized-recommendations`
   bundle 提供（其依赖闭包含 `dsh-action-cards` 服务与浏览器半边）。该 bundle 在发布面
   `publishedDependencies`（90 项，#182 读数）——**默认安装、默认禁用**（上游
   README：「shipped profiles leave it disabled」，Plugins 页启用）。
2. **启用方式**：Plugins 页启用 Personalized recommendations；随后在 ask-matt 会话的
   批末装载随包分发的 `batch-wrap-up` skill（经 `skill-filesystem` 的
   `customSkillDirs` 进 catalog），根 Agent 的 `propose_action` 即可出卡。
3. **缺席退化（双形态，S3）**：服务缺席/禁用时本插件 fiber 保持 INACTIVE（cordis
   inject 语义，不报错、不影响 roster 其余行）；工作流正文（workflow-core）零依赖
   此服务。ptc 档卡工具**恒不可激活**（skill 装载由 code 派发，上游不变量）。缺席
   时批末收口走正文形态——batch 组件 `batch-wrap-up` 节的五段结构在两形态同构，
   缺席显式声明（「收口卡缺席（<原因>）——降级为正文收口段」），判据面守卫
   `tests/verify-wrapup-card.mjs`（W1–W8）。卡上的确认语义：kind `verbs` 为空，
   卡只呈现不承载确认——D21 外部动作确认留在会话内门 6，不新建确认点。

## cordis 档正文的能力前提（B 层：不得让缺能力 = 做不到）

`workflow-profile-cordis.txt`（仅 matt-cordis 档注入）引用两组工具面，前提与退化
路径**已写进正文本身**（文本即单一事实源，此处只登记出处，不抄正文）：

| 正文引用 | 提供 row / 包 | 前提 | 缺席退化（正文内声明） |
| --- | --- | --- | --- |
| `cordis_inspect_list` / `cordis_inspect_query`（creator-inspect-first 节） | `tool-cordis`（`@deepseek-ai/dsh-tool-cordis`，core，官方 cordis 档同款；**勘误评论①**：不是 Inspector——`dsh-experimental-inspector` 是 Chrome DevTools 调试 overlay） | 该行由 `lib/bundle-patch.mjs` 的 `CORDIS_EXTRA_ROWS` 仅注入 matt-cordis 载体；宿主侧 inspect provider（`cordis-inspect-providers`）在 web-app 宿主组合 | 无 inspect provider 的宿主上改读包自带的发布契约（README / Config schema / 上游源码检出），cite 来源不变 |
| `plugin_manager` 动作面（`install_bundle` / `set_plugin` / `set_bundle` / 只读 `list_plugins` / `list_bundles`，creator-gate-extension 节） | `tool-plugin-manager`（`@deepseek-ai/dsh-plugin-manager`，core；行在 matt-cordis 档条件启用=官方 cordis 同形） | 宿主带 `profileContext` | 无 profileContext 时该行禁用——同一变更走宿主 CLI（`dsh plugin`），确认语义不变 |

其他开发者工具（`spawn_teammate` / team / worktree / `dsh-experimental-inspector`）在
matt 的常驻 roster 与正文里**零假设**（机械守卫 R1 的分类面 + `tests/**` 对这些名字
零引用共同钉住）。

## 有意不跟随上游 roster（Z6 反漂移记录）

**显式结论**：上游把 `tool-ralph` 当 opt-in experimental bundle（官方四档无一挂它）、
把 `str_replace_editor` 的 row 留作 explicit opt-in；**本 preset 都当默认件常驻挂载**
——这是**有据的登记差异**，不是漂移。依据：

- human 2026-10-18 口径（#105 票面评论）：「`tool-ralph` 是必要的，属于需要在文档
  明确启用的」+ 2026-10-19 拍 A（#92 关票，文档 AC 折进本票）；
- ADR-0015 §4（`tool-ralph` 等常驻行按 #92 口径保留，不移出常驻）；
- #117 拍板 b（有据差异逐行登记：`official-presets-roster-v1.json`）。

后续会话若重新发现「官方没有这两行」，先读本节与上述登记面，**不要**当新发现重拍。

## 划界（勿双写）

- **#117**（`verify-roster-alignment.mjs`）：matt roster ↔ 官方 preset 的**行集合差异**
  登记（added/omitted + reasons）。
- **#157**（`verify-silence-guardrails.mjs` B 段）：**正文声称的工具 ∈ roster ∪ 显式登记**。
- **本守卫**（`verify-row-deps.mjs`）：**roster row 的出处档位**（官方 preset / 宿主 /
  in-repo / tier 登记）+ 非 core 常驻行的文档明示。三张脸各守一段，谁也不重复实现谁。
- 完全权限面：preset 声明面零假设（`agent.cordis.yml` 自述 "a preset must not own …
  the sandbox and approval stack"）；本仓 docs / 档位文本经核查无「免确认/全权限」暗示。

## 相关

- 票：#105（本票）、#92（已由 human 拍 A 关票，口径见上 Z6 节）、#117（登记差异）、
  #97（market 跟 manager）、#177（subagent_oar 声明位）
- 判据派生：S1（缺席必响亮——R4 的前提漂移红 + 重取配方）、S3（降级必显式——
  B 层退化路径显式声明）
- 官方取证配方与版本锚现查口径：[preset-roster-alignment.md](preset-roster-alignment.md)
  （本页 fixture 的 recapture 同配方）
