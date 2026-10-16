# 0012 — workflow profiles（2）：紧连接分节 + ptc / minimal 两档（#56）

Status: accepted（2026-10-16，implement #56 落盘）

## Context

#55 落地了档位机制（[ADR-0011](0011-workflow-profiles.md)）：共享骨架 + 每 profile
delta，覆盖粒度 = **空行分块**（当时 12 节）。#56 要在同一机制上加两档：

- **ptc** —— 工具面引用适配 PTC 执行形态（`run_code` / 程序优先回路、workflow
  编排），**七门语义零改动**（D41 / [ADR-0009](0009-ptc-adoption-and-implement-spec.md)）；
- **minimal** —— 压到 standard 约 1/3 的正文（七门保留骨架、裁例子），兼作注入文本的
  token 预算探针。

票下的设计输入评论指出机制上的硬约束：`workflow-enforcement` 一节**内部**把
七门 / DONE / TEST SCOPE TIERING / RECOVERY DISCIPLINE 用**单换行**连在一起，是全文
最不可分的位置。minimal 要压掉后三块，只剩两条路——整节重述（必然把七门抄进 delta，
与「七门只此一处」的机械保证冲突），或先让该节可分。评论给了三个方向（节内分段 /
紧连接拆分 / 整节替换压缩版），并明说方向留给本票决定。

## Decision

1. **`tight`（紧连接）分节标志**（采纳方向 2）。marker 语法扩展为三种形态，
   **恰好一个**可选子句：`@@ <id>` / `@@ <id> tight` / `@@ <id> after=<anchor>`。
   `tight` 描述**该节之前**的分隔符——与前一节用单换行粘连而非空行。因此它是**位置**
   的属性（骨架所有），不是文本的属性：
   - delta 里声明 `tight` → 抛（覆盖保持骨架位置、插入恒为空行分隔，delta 无权移动分隔符）；
   - 首节带 `tight` → 抛（前面没有节可粘）；
   - `@@` 开头但不符合语法的行 → 抛（打字错误不得静默变成正文）。
2. **`workflow-enforcement` 拆成四节**：`workflow-enforcement`（七门）+ 紧连接的
   `enforcement-done` / `enforcement-tiering` / `enforcement-recovery`。拆分**逐字节
   无损**（`joinSections` 复原 #54 基线，AC3/AC3a 断言），故 standard 注入文本一字未
   动——这正是 minimal 能压后三块而七门留在唯一一处的前提。creative 档的插入锚点随之从
   `workflow-enforcement` 迁到 `enforcement-recovery`，否则创作者三节会插进七门与 DONE
   之间（AC3f 用「enforcement 组连续」断言把顺序钉住）。
3. **`ptc` = 只增不改**（沿用 creative 的形状，四节，锚在 `enforcement-recovery` 之后）：
   - `ptc-execution-shape` —— 工具面即程序面（写程序用 `run_code` 跑，注册表以生成
     SDK 交给程序）；地图与七门照旧；**不假设任何额外宿主插件**（D41：基于默认路径改出，
     不依赖 shell-host）；
   - `ptc-loop-surface` —— "one command that goes red" = 一个失败程序；程序 **one-shot**
     （每次调用是新 Node 进程、无跨调用状态）故状态落文件、状态文件仍是唯一事实源；
     证据行记程序与输出（捕获输出 + 返回值）而非 shell 退出码；嵌套工具调用走 SDK
     binding，保留注册表的可见性 / 排序 / 审批规则；
   - `ptc-orchestration` —— 编排用 `agent()` / `parallel()` / `pipeline()` / `phase()` /
     `log()`；`agent()` 的 model 覆盖必须 **provider+model 成对传**；编排面内 agent 不可
     再嵌套；schema 保持浅层；跨边界值须 lossless JSON；子失败 → `null`（父脚本决定，
     不得静默当成成功）；
   - `ptc-gate-scope` —— 门按**效果**判定而不按调用拼写：沙箱内跑程序本身不是外部动作，
     但效果是 push / publish / install / 破坏性删除即是；更宽的 sandbox 权限走工具自身
     的审批路径（开始前必须有 justification）；只读程序不确认；**不得新增清单外检查点**
     （D23：高危清单只此一处，正文只留锚点）。
   - **不改 enforcer**：PTC 下的嵌套调用是真实 `tool/call`，词对匹配与可见性照旧，故
     正文与机制同口径。
4. **`minimal` = 覆盖压缩，不新增 `drop` 语法**：十四节给压缩版 + 一节框定插入
   （`minimal-note`，说明「同一工作流、压缩版、短不等于可以跳门」）；七门节**不覆盖**
   （verbatim，且断言 delta 里不出现七门文本）。实测 **7266 / 20892 = 34.8%**（票面
   ~1/3；断言取 25–40% 区间并打印实测值，避免脆断言）。被重写的每一节都必须**变短**
   （AC2f），例子密集的三节必须**砍掉 40% 以上**（AC2g），若干特征性例子串必须**消失**
   （AC2h），而**每一节的规则锚点必须存活**（AC2i：`ONE TICKET PER SESSION` /
   `AUTO-HANDOFF` / `ISSUE DISCIPLINE` / `TEST SCOPE TIERING` / `RECOVERY DISCIPLINE` 等
   17 个；锚点表**独立写在测试里**而非从 delta 反推——从 delta 反推就是自证）。
5. **口径诚实说明（留给 human 复核的判断项）**：票面写 "gates keep their skeleton,
   examples cut"，但**算术上不可能只删例子**——七门 verbatim 已占 10%（2096 字符），要落到
   1/3（≈6964）就必须压**规则本身的详述**（batch-mode 的排批分配、context-hygiene 的判据、
   initialization 的探测都从详述压成骨架句，规则语义保留、展开与例子删除）。故本档的实际
   口径是**「七门逐字 + 其余保锚点、砍详述」**；AC2f/g/h/i 四条把「压缩」与「删除」分开
   断言。若 human 要的是「除例子外一字不动」，则 1/3 的 AC 与「七门只此一处」不可同时
   成立，需回票面改口径——本票按能同时满足三条 AC 的口径实现并在此记录。

## Alternatives rejected

- **节内分段（方向 1）**：为「节内子标题」再定义一套子分隔符与连接规则，机制面更大，
  且骨架里只有这一处真正需要；`tight` 用同一套 marker 语法解决同一问题。
- **整节替换为压缩版（方向 3）**：minimal 必须把七门抄进 delta，直接放弃 D41 的机械
  保证（七门变成两处可编辑）。评审时无法机械证明两处一致。
- **给 minimal 加 `drop`（删节）**：删掉 on-ramps / health / standalone / utilities /
  precondition 能省约 250 字符（1.2%），省下的 token 不足以换取一个新的不可逆语法语义；
  保留一行指针还让 minimal 会话不失技能入口。故 #56 的机制增量**只有 `tight` 一个**。

## Consequences

- 骨架从 12 节变 **15 节**（`workflow-body.txt` 只多了 3 行 marker）；`standard`（默认档）
  仍是 #54 基线的逐字节副本 —— 加档零漂移（AC3）。
- 加档成本保持 #55 的三件套：一个 `workflow-profile-<name>.txt` + `PROFILES` 一行 +
  `package.json files` **显式条目**（`verify-workflow-profiles-2.mjs` P7 断言「显式」、
  P8 用安装器自身的 `expandEntry` 校验覆盖）。
  > 更新（2026-10-16，**#66**）：上面括号原写的理由是"文件名通配会被安装器静默展开成空"。
  > #66 已修——`lib/payload.mjs` 按 npm 最小语义支持**文件名前缀通配**（`dir/name-*.txt`），
  > 且任何零展开条目都响亮报错（安装器 die、不落 store）；守卫在
  > `tests/verify-payload-manifest.mjs`（**该文件自有**的 P4–P10，与 profiles 系列的
  > P5–P8 不同号）。
  > 复核时实测修正了票面口径：旧实现**只有通配符占满第一段**的写法能用（`*.mjs`）——
  > 拿 HEAD 版对临时包实测，`a*.mjs`、`dir/*`、`dir/name-*.txt` **全部**展开成空；
  > 票面"目录前缀通配（前缀以 `/` 结尾）可用"并不成立，修法①按 dirname 取目录时顺带
  > 把它们一并修正（`verify-payload-manifest.mjs` P6 因此断言的是**修正后**的目录通配，
  > 不是"现有行为不变"）。
  > 另一处票面 AC 冲突（本票按票面 Desired behavior 取 AC3）：显式条目**不存在**时，
  > 行为从"静默丢弃"变成"响亮 die"——AC2 字面要求"精确路径的现有行为不变"，与修法②/
  > AC3"任何解析出 0 个文件的条目都要响亮"互斥；取后者（`files` 是唯一发货契约）。
  > 两条已知残余面（均实测）：①判据是"零展开"而非"少于预期"——部分命中的条目仍可能
  > 发货不全（`files` 表达不了预期数量）；②最小子集以外的写法偏差各异：通配落在**目录段**
  > （`dir*/a.txt`、`**/*.mjs`）与 `?`/`{a,b}`（被当字面量、展开成不存在的路径）都零命中 →
  > **响亮装不上**（无逃生阀；`files` 由本仓自己维护），而 `dir/**` 会**静默退化成
  > `dir/*`**（不递归、不报错，直接把直接子目录当条目一起发货）——这一条才是静默的语义
  > 偏差。显式条目仍是本仓的约定与断言（P7），但不再是绕开缺陷的手段。
- 验证：`tests/verify-workflow-profiles-2.mjs`（T1–T5 机制 / AC3 标准零漂移与拆分组连续 /
  AC1 ptc 结构与 **PTC 目标形态挂载** + marker 守卫 / AC2 minimal 比例、结构与 marker 守卫 /
  P5–P8 注册与打包）。目标形态是**真实行**：`dsh-ptc-runtime-node` + `dsh-workflow-ptc` +
  `dsh-tool-workflow` 挂在同一 preset 上；harness 缺的 fs / sandbox / sandboxPolicy /
  subagents 用 `ensurePresetMountable` 的同一份惰性 stub（`preset-harness.mjs` 的
  `inertService()`，本票从挂具内联提升为导出，避免第二份副本静默漂移）预置，但**不预置
  ptcRuntime**（它由 ptc-runtime-node 自己提供，抢注会与 stub 冲突）。
- #55 的 `tests/verify-workflow-profiles.mjs` **未改动**即保持全绿（其 P4 用安装器自身的
  `expandEntry` 扫盘，新 delta 自动纳入覆盖断言）；`verify-installer.mjs` 的 payload 清单补上
  两个新文件（该用例 opt-in，本机无 dsh 时 4 条 profile-link 用例按 #67 既有缺陷硬崩，
  payload 那条已实跑通过）。

## Known leftovers（不在本票）

- 基线正文第 26 行仍写 "six hard gates" 而其下枚举七门 —— #65 跟踪（改它要连 AC1 fixture
  一起重取）。minimal 因不覆盖七门节，该文案一并继承，未在 #56 顺手修。
- PTC 的**运行时**组合本身（`dsh-workflow-ptc` + sandbox policy 的真实装配）不在本仓
  组件化范围内：#56 只交付档位文本与其注入面。

## See also

- [0011-workflow-profiles.md](0011-workflow-profiles.md)（#55：骨架 + delta 机制，本 ADR
  在其上增加 `tight` 一个标志）
- [0009-ptc-adoption-and-implement-spec.md](0009-ptc-adoption-and-implement-spec.md)
  （D41：PTC 采纳面与七门语义零改动约束）