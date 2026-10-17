# 0011 — workflow profiles：共享骨架 + 每 profile delta（#55）

Status: accepted（2026-10-16，implement #55 落盘）

## Context

#54 把工作流正文抽成单文件（`workflow-body.txt`），由 `workflow-core.mjs` 经
system-prompt/assemble 注入。系列下一票 #55 要让**同一份工作流**服务不同 preset
（standard = matt；creative = 创作者 preset），#56 还要加 ptc/minimal。每档复制一份
正文的代价是七门出现 N 份副本：一处改动改 N 遍，且 D41 要求的"七门语义零改动"无法
机械保证。

票面约束：① `profile: standard` 的注入输出与 #54 基线**逐字节一致**（证明重构零内容
漂移）；② creative 挂在创作者 preset 下注入适配文本，七门在场且**措辞未改**；
③ 结构上**不得有任一工作流节在两个 profile 间重复**。

## Decision

1. **骨架分节**：`workflow-body.txt` 仍是唯一正文源，按 `@@ <id>` 行分节（12 节：
   `main-flow` / `workflow-enforcement` / `batch-mode` / … / `initialization`）。
   marker 行**占据原本的空行分隔位**（不新增空行），因此永不出现在注入文本里；
   解析器对"节尾空行"与"重复 id"响亮报错——格式错误要炸在打包期，不能静默多出一个
   换行。
2. **delta 语法**：profile 文件（`workflow-profile-<name>.txt`）用同一 marker 语法——
   **同 id = 覆盖该节**（保持骨架位置）；**新 id = 按 `after=<anchor>` 插入**
   （无 anchor 则追加；同 anchor 的多个新节保持 delta 文件内的顺序）。锚点指向不存在的
   节 → 抛错（响亮，不许静默错位）。
3. **档位注册表**：`workflow-core.mjs` 的 `PROFILES` = 档名 → delta 文件 URL
   （`null` = 骨架 verbatim）。`standard: null`，所以重构零漂移由
   `tests/fixtures/workflow-body-v1.txt`（#54 正文，落地前冻结；#85 随文本政策重取，
   见 CONTEXT D48）逐字节断言（AC1）。
   加档 = 落一个 delta 文件 + 注册表一行，共享文本一字不改。
4. **creative 档**（创作者 preset 适配，**只增不改**，三节）：`creator-context`（框定：
   产物是运行时扩展，地图与七门照旧）；`creator-gate-extension`
   （`plugin_manager` 的 `install_bundle` / `set_plugin`(enable/disable) / `set_bundle`
   属**外部动作门**事件——报目标与风险字段后等确认；只读 `list_*` 不需确认）；
   `creator-inspect-first`（写插件代码前先 `cordis_inspect_list` →
   `cordis_inspect_query` 读准契约：Service 方法 / Event 模式 / Config schema /
   Tool schema / 主题 token / Slot 树与 props；只读，不触发也不替代任何门）。
5. **未知档名响亮回落 standard**（每挂载告警一次）：拼错档名不该让会话丢掉工作流文本。
   `config.text` 保留为整段覆盖逃生门（#54 契约不变）。

## Consequences

- 七门只此一处（AC3 用结构断言证明：每个共享节在合成输出里恰好出现一次；creative
  delta 文件不含七门块；覆盖语义下骨架正文不残留）。
- #56（ptc/minimal）与 #58（batch 组件抽取）落在同一 delta 机制上，不需要新的拼装点。
- matt preset 显式挂载 `profile: standard`（不靠插件默认值隐式选档，R6 断言）。
- 验证：`tests/verify-workflow-profiles.mjs`（AC1 逐字节 / AC2 创作者 preset 端到端渲染
  + 七门措辞逐字节相同 / AC3 去重 + 机制 M1–M4、打包 P1–P4）；`tests/verify-enforcer.mjs`
  V16（`plugin_manager` 变更触发外部动作门、只读 `list_*` 不触发）；#54 的
  `tests/verify-workflow-core.mjs` L1 与 `verify-workflow-core-render.mjs` R4
  verbatim 断言保持全绿——重构对渲染面零影响。
- **文本与机制同口径**：creative 文本声明的 gate 事件必须真的在 enforcer 的
  `DEFAULT_GATES` 里（D23：高危清单归插件、工作流文本只留锚点）——故 #55 把
  `plugin_manager install_bundle` / `set_plugin` / `set_bundle` 加进默认外部清单
  （词对匹配，只读 `list_*` 不触发）。否则"清单是穷举的"那句基线提醒会与注入文本
  自相矛盾。
- 打包面：`workflow-profile-*.txt` 进 package `files`（安装器 payload 断言覆盖）。
- **已处置（#85，2026-10-17）**：基线首行由 "six hard gates" 改为 "seven hard gates"，其下枚举
  1–7 自洽；修它即改变 AC1 的逐字节基线，故 fixture（body 与 persona 载体两份）同批重取，
  L1/AC1 断言语义不变（CONTEXT D48）。

## See also

- [0010-workflow-core-plugin.md](0010-workflow-core-plugin.md)（#54：正文抽离 persona、
  注入点与插值 spike 结论；本 ADR 取代其中"delta 以 `config.text` 为拼装点"的假设）
- [0009-ptc-adoption-and-implement-spec.md](0009-ptc-adoption-and-implement-spec.md)
  （D41：后续 ptc profile 的七门语义零改动约束）