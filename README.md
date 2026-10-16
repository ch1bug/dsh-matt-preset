# dsh-matt-preset — Matt 工作流模式（DeepSeek Harness agent preset）

按 [Matt Pocock 的 AI 编码工作流](https://github.com/mattpocock)（ask-matt）运转的
DSH agent preset：**grill 打磨想法 → 原型判定 → to-spec / to-tickets 拆票 →
implement（内嵌 tdd）→ code-review**，配 handoff 工具
与工作区自主初始化。

## 这是什么规范

- **DSH agent preset**（`@deepseek-ai/dsh-agent-preset` 插件行）：`preset.yml`
  （roster 元数据：`name`/`description`/`order`）随 `agent.cordis.yml` 一起构成
  bundle 载体 `cordis.patch.yml`。安装位 = `$DSH_HOME/.agent-presets/matt/`
  （installer 的稳定存储，#28）；装载经 bundle patch 挂进 profile
  （`dsh plugin add`），不靠目录扫描。
- 目录内的 `.mjs` 是 **cordis 插件**（导出 `name`/`apply`/`inject`），组合文件按
  相对路径 `./xxx.mjs` 引用——它们是这个 preset 的组成部分，不是独立发布的 npm 插件包。
- 与 **DSH 插件**（npm 包，作为 bundle 装进 profile，如 `dsh-llm-mimo`）的区别：
  插件扩展宿主能力，preset 组合能力并定义会话表面；本仓库是后者。

## 特性

| 组件 | 说明 |
| --- | --- |
| persona（`agent.cordis.yml`） | 系统提示词导语：identity + 路由前提（`{{model}}`/`{{cwd}}` 渲染时插值，`tests/verify-persona.mjs` 断言）+ `ask-matt` 标记（同时喂 workflow-core 与 workflow-enforcer 的 scope 守卫）。#54 起工作流正文不再承载在 persona（见下行 workflow-core）。 |
| `workflow-core.mjs`（+ `workflow-body.txt`） | ask-matt 工作流正文插件（#54）：MAIN FLOW（sharpen / prototype / build / **retro**，build 含 /pr model-invoked 路由，#10）+ **WORKFLOW ENFORCEMENT 七门**（见 `CONTEXT.md` D19–D38）+ **BATCH MODE（攒批）**（批次宣告 / 一票一会话 / 批末总结确认门 / issue 纪律 / **批内票完成自动 handoff 下一票** / 排批 model-lane 分级）。经 system-prompt/assemble 注入 `workflow:core` 节，渲染后与原 persona 承载版 **verbatim-identical**（`tests/verify-workflow-core.mjs` L1 断言）；`{{model}}`/`{{cwd}}` 在注入节内照常插值（spike 实证，ADR-0010）。**任何 preset 单行挂载** `dsh-matt-preset/workflow-core.mjs`（subpath exports 解析，随安装位可移植）即得工作流；scope 守卫默认 marker（`ask-matt`，绝不泄漏到非工作流会话），非 matt preset 显式 `config.scope: 'all'`（挂载即 opt-in）。 |
| `handoff-tool.mjs` | 写可移植交接文档 → 创建子会话（`fork` 带历史 / `fresh` 全新）→ 文档作为子会话**首条 user 提示词**，首轮立即开始；子会话自动 attach workspace。子会话**模型取部署默认选择**（`agentDefaultModel.currentSelection()`，不继承父会话当前路由——如需指定模型，在定向节写明让子会话对齐）。交接文档含工具保证的**交接边界段**：定向交接（「## 本会话任务（human 已定向）」节 → 子会话声明开工，免逐次确认，D35）/ 候选交接（无定向节 → 问 human）；外部操作定义固定对齐 enforcer 高危清单（容器 up 等常规操作不得列入「先报告等确认」）。 |
| `workflow-enforcer.mjs` | WORKFLOW GATES 提醒注入（D21 外部动作门）：每 turn 基线 + 高危 tool/call 后一次性 ⚠ 追加 + **常规操作白名单**（docker compose up / cargo build / 本地 commit / 只读查询**无需确认**）；关票后 fresh-subagent 质量抽查提醒（O5）；`gh issue create` → 一会话一 issue 提醒（D20）；批内收尾文本 + `.scratch/batch-state.md` → AUTO-HANDOFF 提醒；fold-in 上下文证据（`context_status` 工具）。项目可放 `workflow-gates.yml` 覆盖清单（见 `docs/workflow-enforcer.md`）。 |
| INITIALIZATION 人设段 | 工作区无 `CONTEXT.md` 时自主探测（git/docs/语言信号）并建**双骨架**：`CONTEXT.md`（领域）+ 空 `docs/adr/` + `AGENTS.md`（行为指南，含 Agent skills 段；与 CLAUDE.md 绝不双建）；tracker 首次用时由 setup 补齐。 |

> 曾试验两阶段 bootstrap（梁神模式，`tool-bootstrap.mjs`）：实测仅对 DeepSeek V4 Pro
> 有效，对其他模型（含 V4 Flash）是副作用，已取消（见 `CONTEXT.md` D17），恢复全量表面。

## 安装（bundle patch 装载，#28）

DSH 0.2.0-rc 起的 preset 注册表**不做目录扫描**——放进 `.agent-presets/` 不会再被
发现；装载机制是 **bundle patch**。安装/升级/回滚/卸载、`--profile`/`--root`、
版本戳、已知风险与两段式挂载说明的**单一事实源是 [docs/RELEASE.md](docs/RELEASE.md)「安装 / 升级 / 回滚 / 卸载」一节**（#41）。

一条命令（payload 拷入稳定存储 + 版本戳，再挂进 profile）：

```bash
npx --allow-git=all github:ch1bug/dsh-matt-preset install   # 默认挂到 profile web；参数与备选形式（clone / npm pack --from）见 docs/RELEASE.md
```

装完按 docs/RELEASE.md 提示重启生效，hero-chip 选择 "Matt 工作流"。

> 定时任务：`scheduled-jobs.mjs` 已退役（#4，ADR-0001）；提醒类需求用
> schedule-bundle 的 `schedule_create` 等工具。

## 沙箱批跑（sandcastle × DSH headless，opt-in）

攒批的票据可下放到 podman 沙箱由**沙箱内 DSH headless** AFK 执行，主会话只编排。三车道：
**Y（yolo：票据审计 → 沙箱验证门 → 波次合并）/ B（现行 batch）/ H（human）**；enforcer 默认门禁
已把 `sandcastle`/`run-ticket` 列为外部动作。决策记录见 [ADR-0003](docs/adr/0003-sandbox-batch-mode.md)，
脚手架与用法见 **[sandcastle/README.md](sandcastle/README.md)**（模板在 `sandcastle/templates/`）。

## 验证

```bash
# 依赖解析同部署：把测试的 @deepseek-ai 指到已装 dsh 运行时的包表
# （Windows 用 junction：cmd /c mklink /J tests\node_modules\@deepseek-ai <dsh>\node_modules\@deepseek-ai）
mkdir -p tests/node_modules
ln -s "$(dirname "$(dirname "$(readlink -f "$(which dsh)")")")/node_modules/@deepseek-ai" tests/node_modules/@deepseek-ai
# 0.2.0-rc 起 preset 走声明注册（不再扫目录 roots）；共享挂具 tests/preset-harness.mjs
# 自动从已装运行时解析 baseUrl，无需环境变量。
node tests/verify.mjs              # 挂载套件：handoff 子会话 + 文档首条提示词 + model 路由 + workspace attach
node tests/verify-persona.mjs      # persona 导语：{{model}}/{{cwd}} 渲染插值
node tests/verify-workflow-core.mjs  # workflow-core 插件（#54）：注入点插值 spike + L1 verbatim + 单行挂载 + scope 守卫
node tests/verify-workflow-core-render.mjs  # 真实 composition 渲染面：persona 无正文 / 注入节完整 / 插值 / verbatim + subpath 契约（R1–R5 离线可跑；L1–L2 环境侧需门禁，见下）
node tests/verify-enforcer.mjs     # workflow-enforcer V1–V15（基线/高危一次性/白名单/关票抽查/建票提醒/批内收尾 AUTO-HANDOFF/scope/无噪音/沙箱门禁）
node tests/verify-production.mjs   # 生产级：真实 persona 全文 + 真实 minimal persona
node tests/verify-lang-count.mjs   # 注入次数计数：GATES 每轮 1 / LANGBASE 会话 1 / LANGTRIGGER 触发 1
node tests/verify-lang-enforcer.mjs    # 语言知识包 V1–V5（命中注入/触发/会话一次/disable/非 matt 会话）
node tests/verify-lang-asm.mjs     # 语言包系统提示词组装（真实 matt persona + lang 段）
node tests/workflow-enforcer-grill-contract.mjs  # enforcer × grill 模式契约
node tests/verify-bundle-sync.mjs  # cordis.patch.yml 字节级锁（agent.cordis.yml 唯一手改源）
node tests/sandcastle-e2e.mjs      # sandcastle 三命令端到端（33 断言：审计/重叠/夜跑/幂等/simplify/model-lane）
```

**环境侧用例的门禁（loud skip）**：`verify-workflow-core-render.mjs` 的 L1–L2
断言需要真实 profile 实例；未设置门禁时**响亮跳过**（打印原因、不静默当 pass），
常规套件在无环境下仍全绿。开启方式（源码部署实例）：

```bash
export DSH_MATT_LIVE_HOME=/home/<user>/dsh-matt-home        # 独立 DSH_HOME
export DSH_MATT_LIVE_PROFILE=matt-dev                      # profile 名
export DSH_MATT_LIVE_CLI=/home/<user>/dsh-matt-src/apps/cli/src/bin.ts   # 源码检出 CLI 入口
node tests/verify-workflow-core-render.mjs                 # R1–R5 + L1–L2
```

## 目录

```
dsh-matt-preset/
├── preset.yml                    # roster 元数据（name/description/order）
├── agent.cordis.yml              # cordis 组合（persona 导语 + workflow-core/enforcer/lang-enforcer + 全量工具）
├── workflow-core.mjs             # ask-matt 工作流正文注入插件（#54，正文在 workflow-body.txt）
├── workflow-body.txt             # 工作流正文 verbatim（与 persona 导语在拆分点逐字节拼接，ADR-0010）
├── handoff-tool.mjs              # 交接工具（fork/fresh 子会话 + 环境快照段）
├── workflow-enforcer.mjs         # WORKFLOW GATES 提醒注入
├── workflow-gates.yml.example    # 项目级高危清单模板
├── scripts/                      # sync-skills（上游技能镜像同步：sh + ps1 双实现，#1）
├── sandcastle/                   # 沙箱批跑（opt-in）：模板 + 接入文档
│   ├── README.md
│   └── templates/                # Dockerfile / dsh.ts adapter / audit-ticket / run-ticket / night-run / lib / worker-context
├── CONTEXT.md                    # 术语表 + 决策（D1–D42）
├── docs/adr/                     # 架构决策记录
├── docs/workflow-enforcer.md     # enforcer 使用文档
├── docs/workflow-session-boundaries.md  # 会话边界与成本模型设计视图
└── tests/                        # 12 项：verify / persona / workflow-core / workflow-core-render / enforcer / production / lang-count / lang-enforcer / lang-asm / grill-contract / bundle-sync / sandcastle-e2e
```

## License

MIT。组合改编自 DeepSeek Harness 内置 preset（MIT，DeepSeek）；曾含的
`tool-bootstrap.mjs`（来自 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)，
MIT）已于 D17 移除，详见 [NOTICE](NOTICE.md)。
