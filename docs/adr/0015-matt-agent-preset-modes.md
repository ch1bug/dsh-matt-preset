# 0015 — matt 派生四个 agent preset 模式（一个 bundle → 四个模式，#99）

Status: accepted（2026-10-18，human 拍板，implement #99 落盘）
Supersedes: [0014](0014-matt-workflow-bundle-shape.md) **Decision 第 3 条的一句**（`不新增第二个 agent preset 声明`）——
0014 的**其余四条 Decision（第 1、2、4、5 条：L1≠L2 形态、术语正名、版本锚、复活触发条件）仍然全部有效**。

## Context

- human 装上桌面端后实测：hero-chip 里**只有 1 个** `Matt 工作流` 模式，`ptc` / `minimal` /
  `creative` 三档的 delta 文本**在桌面端从来没有消费者**——"档位"在使用时根本选不了。
- **根因**（实测三家：本仓 / 上游 / 官方 web-app）：
  | 事实 | 位置 |
  | --- | --- |
  | matt 只声明 **1 个** agent-preset 行，`profile:` 硬写 `standard` | `agent.cordis.yml`（`workflow-core` 行）|
  | "一个模式" = **一条 agent-preset 声明** | `@deepseek-ai/dsh-agent-preset` 的 Config schema |
  | 多模式装载机制 = `dsh.bundle.patch` **数组** | 官方 web-app 列 5 个文件；本仓当时只列 1 个 |
- 于是本仓**有机制、没形态**：`PROFILES` 四档齐全、delta 文件齐、断言全绿——但那证明的是
  **代码能力**，不是**用户可达形态**。上一会话据此下过"四档都在"的结论，**错了**：
  **"机制存在" ≠ "用户可达"**。本 ADR 的核心决策就是把这条区分变成结构的。
- **与 ADR-0014 的对撞**：0014 §3 明文写"**不新增第二个 agent preset 声明**（不做
  `presets/*.patch.yml`），保持单 patch 文件、单 preset 声明"，理由是"上游用多 preset 声明
  表达同一工作流的多个档位（roster 逐份重复），matt 已用 profile delta 以零重复表达同一件事"。
  该理由在 0014 的语境里成立（当时**没有**让档位被选中的需求），但它把**注入文本的适配**与
  **用户的可选性**当成了同一件事——本票正是证明这两件事必须分开表达。

## Decision

1. **一个 bundle → 四个模式**：`package.json` 的 `dsh.bundle.patch` 由单文件变数组
   （照抄上游 web-app 形态）：

   ```json
   "patch": ["./cordis.patch.yml", "./presets/matt-ptc.patch.yml",
             "./presets/matt-minimal.patch.yml", "./presets/matt-cordis.patch.yml"]
   ```

   `cordis.patch.yml`（matt 全量 roster）仍是数组第一项，**且它自己就承载第 1 档**
   （`dsh-matt-preset` / `Matt 工作流` / `order 0` / `profile: standard`）；
   另外三份 `presets/*.patch.yml` 各插一条声明。
   数组**共 4 项 → 四个模式**。第 1 档**复用既有的 `cordis.patch.yml`**，不另立文件
   ——理由见下面的实测注。

   > **原票面写的是"5 项"（多一份 `presets/matt.patch.yml`），实测不可行**：
   > `cordis.patch.yml` 的 `config.id` 已是 `dsh-matt-preset`，再声明一次同名 id 会撞上
   > 注册表的重名守卫（`agent-preset-registry/src/index.ts`：
   > `if (this.definitions.has(definition.id)) throw new Error('Duplicate agent preset: …')`）
   > ——**第二条注册直接抛错，整个 bundle 挂不上**，不是"少一个模式"。
   > 故第 1 档**复用既有的 `cordis.patch.yml`**，不另立一份。实测证据见 §Consequences。

2. **profile delta 与 preset 声明是两个正交的机制，各司其职**（本 ADR 最重要的一句）：
   - **profile delta** 决定**注入什么正文**（零重复：七门只此一处）；
   - **preset 声明**决定**用户在 roster 里选得到什么**。
   0014 §3 的错误不是"选了 delta"，而是**以为 delta 能替代声明**。四份 preset 的
   `plugins` 列表是**同一份 matt roster**，差异**只有四个字段**：`config.id` / `config.name` /
   `config.description` / `order`，加上其 `workflow-core` 行的 `config.profile`。

3. **四模式的身份与文案**（`id` / 显示名 / profile）：
   | id | 显示名 | profile |
   | --- | --- | --- |
   | `dsh-matt-preset` | `Matt 工作流` | `standard` |
   | `dsh-matt-preset-ptc` | `Matt 工作流 · PTC` | `ptc` |
   | `dsh-matt-preset-minimal` | `Matt 工作流 · 精简` | `minimal` |
   | `dsh-matt-preset-cordis` | `Matt 工作流 · Cordis` | `cordis` |

   **matt 的 id 与官方四档（`standard` / `ptc` / `minimal` / `cordis`）刻意不同** ——
   官方四模式**保留、不隐藏、不覆盖**（human 明确）。四条声明各带自己的 `name` 与
   `description`，故 roster **不做 locale 词典翻译**（`agent-preset-registry/src/display.ts`：
   声明带 `name` 即自有文案）——四段中文简介各自成立。

4. **模式可以差异化 roster，不只是差异化文本**（复核阶段补，2026-10-18）。
   四份 `plugins` 的共同基线是同一份 matt roster，但**允许按模式增删行**——
   当前唯一的差异在 `matt-cordis`：

   | roster 行 | `matt` / `matt-ptc` / `matt-minimal` | `matt-cordis` |
   | --- | --- | --- |
   | `tool-cordis`（提供 `cordis_inspect_*`） | **无** | **有** |
   | `tool-plugin-manager` | `disabled: true` | `disabled: !!js "!ctx.get('profileContext')"`（与官方第四档同形）|
   | `tool-plugin-market` | `disabled: true` | `disabled: !!js "!ctx.get('profileContext')"`（**逐份跟 manager 同款**）|

   `tool-plugin-market` 行 2026-10 由 **#117 补入**（折叠自 #97）：上游
   `standard`/`ptc`/`cordis` 三档都在 manager 紧后挂 market 行且 `disabled`
   **从不单独设值**（永远与 manager 同款）——本仓照此（Z1/Z2），否则重现
   「manager 活的、market 关着」的单边缺口。与官方对应模式的**全量差异**
   （多与少逐行带理由）登记于 `tests/fixtures/official-presets-roster-v1.json`
   并由 `tests/verify-roster-alignment.mjs` 钉住（#117 拍板方向 b：有据差异；
   取证配方与版本锚见 `docs/preset-roster-alignment.md`）。

   **为什么必须有这条**：`cordis` 档的注入文本（`creator-inspect-first`）**要求**模型
   先 `cordis_inspect_list` → `cordis_inspect_query` 读契约再写插件代码。若 roster 里没有
   `tool-cordis`，这段指令就是**教模型调它调不到的工具**——属本仓 D3（文档说谎）那一类，
   而不是"文本风格差异"。官方第四档 `cordis` 正是同时声明这两行
   （`<src>/packages/bundle/web-app/presets/cordis.patch.yml`）；本模式**与它对齐**。
   差异是**双向锁定**的（`verify-bundle-sync` 断言"只有 cordis 有"**且**"其余三份没有"），
   否则"全都补上"或"全都没补"都会过关。

   同理，`tool-ralph` 等**常驻行**仍按 #92 口径保留（**不移出常驻**），其依赖在文档里明示
   —— 见 handoff §11「开发机 ≠ 用户环境」与 `#105`/`#92`。

5. **形态红线：matt 是"模式"，但安装/卸载/管理一律按插件方式**（human 明确）：
   四份 preset patch **同属一个 npm 包 / 一个 bundle**，装一次全有、卸一次全清。
   **禁止**拆成四个可独立安装的包；**禁止**新增安装旁路——仍走
   `dsh plugin --profile <p> add|rm` + `dsh.bundle.patch` + `.agent-presets/matt` + `VERSION.json`。
   这条与 0014 §1（L1≠L2）**同向**：模式 ≠ 安装单元。

6. **四份 roster 由生成器从单一源合成，禁止手抄**（0014 §5(d) 已经写下的要求，本票兑现）：
   `cordis.patch.yml` 与三份 `presets/*.patch.yml` 同由 `lib/bundle-patch.mjs`（单一构造事实源）
   产出、`scripts/regen-bundle.mjs` 写盘，`tests/verify-bundle-sync.mjs` 对**四份**文件做逐字节锁定。
   手抄三份的代价不是"三份会漂移"这么抽象：三份 roster 内容相同而只在四个字段上不同，
   任何一次 roster 变更都要改三遍，且没有任何机械保证它们真的一致。

   **同一条锁定里还必须断言"任何两条声明不共享 `config.id`"** —— §1 的实测事故正是漏了这条：
   去重不能靠人记住，要靠断言。第 4 条的**按模式差异化 roster**（`tool-cordis` 只在 cordis 那份）
   同样必须由生成器施加并**双向锁定**，不得手改产物。

7. **第 4 档内部键 `creative` → `cordis`**（human 拍板）：profile 键、delta 文件名
   （`workflow-profile-creative.txt` → `workflow-profile-cordis.txt`）与全部引用面一并改名，
   与官方第四档命名对齐。**ADR-0011 / ADR-0012 的历史陈述也按新名回写**（human 2026-10-18 拍），
   改名事实在两份 ADR 的 `Status:` 下各留一行注记，不静默改写历史。

## Alternatives rejected

- **只加 preset 声明、不改 `dsh.bundle.patch` 形态**：不可行——多份 patch 的唯一声明处就是
  这个数组；单文件里塞四条声明虽语法可行，但与上游形态分叉，且失去"一个文件一个模式"的
  可读对应。
- **保持 ADR-0014 §3（不做 preset 声明），改让 GUI 暴露 profile 选择**：改的是上游 DSH 的
  形态（本票 Out of scope 明文排除），且 roster 的可选单元在 DSH 里**就是** preset 声明。
- **四个模式拆四个可独立安装的包**：直接违反 human 的形态红线（第 4 条）。
- **三份 roster 各写一份（手抄）**：与 0014 §5(d) 的既有要求冲突，且无一致性保证。
- **第 1 档另立 `presets/matt.patch.yml`（票面原方案，数组 5 项）**：**实测不可行**——
  它与既有的 `cordis.patch.yml` 声明**同一个 `config.id: dsh-matt-preset`**，注册表重名守卫
  直接抛错（见下 §Consequences 的实测），整个 bundle 挂不上。改该份的 id（如
  `dsh-matt-preset-standard`）虽能挂上，但会让 roster 出现**两个同名"Matt 工作流"**，
  等于把本票要修的"选不到 / 选不清"换个形状留下。

## Consequences

- **roster 从 1 条 matt 声明变 4 条**；官方四档不受影响（id 空间不相交）。
- **安装面完全不变**：仍是 `dsh plugin --profile <p> add|rm` 一个包。`dsh-matt-preset` 在插件
  视角仍是**一个**条目。
- **payload 面变化**：`presets/*.patch.yml` 进 `package.json` 的 `files`（安装器发货运载面）。
- **实测：重名 id 会让整包挂不上**（本票实现中实测，非推断）。证据链：
  1. 直接 dump 四份声明 → `cordis.patch.yml` 与 `presets/matt.patch.yml` 的
     `insert-id` 与 `config.id` **完全相同**（都是 `preset-dsh-matt-preset` / `dsh-matt-preset`）；
  2. 挂具实测（`tests/preset-harness.mjs`）第二条注册抛
     `Error: Duplicate agent preset: dsh-matt-preset`；
  3. 上游源码即守卫本身：`packages/preset/agent-preset-registry/src/index.ts`
     `if (this.definitions.has(definition.id)) throw new Error('Duplicate agent preset: …')`。
  后果不是"少一个模式"而是**整个 bundle 装载失败**——这属于"机制存在 ≠ 用户可达"的同一族：
  形态错了，能力再全也到不了用户。故 §6 要求把"无重名 id"写成机械断言。
- **"roster 列出四条"的判据是两层，不是 `broken === undefined`**（实测修正）：
  全量 matt roster 在挂具里**必然**缺 host 侧能力（`subagents` / `sandboxPolicy` /
  `model-selection-settings` 等），`broken` 恒非 `undefined`，故"激活干净"是不可达的判据。
  正确口径沿用 `tests/verify.mjs` Track B：
  ① **A 层（严格）**四条声明解析成功、id 互不重复、roster 四条在场、profile 亲子对应；
  ② **B 层（诊断）**每条 `broken` 的每一行都必须是 `: waiting for <host 服务>` ——
  **只含 host 面缺失，不得出现任何载体/声明缺陷**（`never started` / `Duplicate agent preset` /
  模块加载失败）。"机制存在 ≠ 用户可达"要求 A 层为真；B 层则保证失败**不指向我们自己的行**。
- 验证：`tests/verify-preset-modes.mjs`（新建，M1–M8：数组形态 / 四条声明存在 /
  **id 与官方四档无交集** / **id 两两不重复** / 文案两两不同 / profile 绑定一一对应 /
  **roster 真的列出四条（A/B 两层）** / 注入文本随档位真的变 / `PROFILES` 注册）
  + `tests/verify-bundle-sync.mjs`（四份文件逐字节锁定 + 无重名 id）
  + 既有 `verify-workflow-profiles*.mjs` 改名后端到端不变。
- **0014 §3 就此作废**，标注见该文件原地指针；其余条款继续有效，故 0014 不必整体 supersede。
- 0014 的**复活触发条件 (d)**（"真有人要只带工作流、不含 matt 人设的独立 preset 声明"）
  在本票被**部分**触发：新增的三条声明确实各自独立，但它们**共用同一份 matt roster 与人设**，
  与 (d) 设想的"不含 matt 人设"不是同一件事 —— (d) 仍未触发。

## See also

- [0014-matt-workflow-bundle-shape.md](0014-matt-workflow-bundle-shape.md)
  （本 ADR supersede 其 §3 一句；L1≠L2 形态与术语正名仍然有效）
- [0011-workflow-profiles.md](0011-workflow-profiles.md) /
  [0012-workflow-profiles-2.md](0012-workflow-profiles-2.md)
  （profile delta 机制本体；本票为它补上"用户可达"的形态，机制一字未改）
- `CONTEXT.md` D50（本决策的登记行）