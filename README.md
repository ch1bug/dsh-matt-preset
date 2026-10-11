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
| persona（`agent.cordis.yml`） | 系统提示词即完整 ask-matt 工作流地图（MAIN FLOW 四步：sharpen / prototype / build / **retro**——build 含 /pr model-invoked 路由，#10）+ **WORKFLOW ENFORCEMENT 七门**（入口路由 / implement 前置 / 决策边界 / 阶段声明 / 一会话一 issue / 外部动作门 / 票据出口，见 `CONTEXT.md` D19–D38）+ **BATCH MODE（攒批）**（批次宣告 / 一票一会话 / 批末总结确认门 / issue 纪律 / **批内票完成自动 handoff 下一票** / 排批 model-lane 分级）；`{{model}}`/`{{cwd}}` 渲染时插值（`tests/verify-persona.mjs` 断言）。 |
| `handoff-tool.mjs` | 写可移植交接文档 → 创建子会话（`fork` 带历史 / `fresh` 全新）→ 文档作为子会话**首条 user 提示词**，首轮立即开始；子会话自动 attach workspace。子会话**模型取部署默认选择**（`agentDefaultModel.currentSelection()`，不继承父会话当前路由——如需指定模型，在定向节写明让子会话对齐）。交接文档含工具保证的**交接边界段**：定向交接（「## 本会话任务（human 已定向）」节 → 子会话声明开工，免逐次确认，D35）/ 候选交接（无定向节 → 问 human）；外部操作定义固定对齐 enforcer 高危清单（容器 up 等常规操作不得列入「先报告等确认」）。 |
| `workflow-enforcer.mjs` | WORKFLOW GATES 提醒注入（D21 外部动作门）：每 turn 基线 + 高危 tool/call 后一次性 ⚠ 追加 + **常规操作白名单**（docker compose up / cargo build / 本地 commit / 只读查询**无需确认**）；关票后 fresh-subagent 质量抽查提醒（O5）；`gh issue create` → 一会话一 issue 提醒（D20）；批内收尾文本 + `.scratch/batch-state.md` → AUTO-HANDOFF 提醒；fold-in 上下文证据（`context_status` 工具）。项目可放 `workflow-gates.yml` 覆盖清单（见 `docs/workflow-enforcer.md`）。 |
| INITIALIZATION 人设段 | 工作区无 `CONTEXT.md` 时自主探测（git/docs/语言信号）并建**双骨架**：`CONTEXT.md`（领域）+ 空 `docs/adr/` + `AGENTS.md`（行为指南，含 Agent skills 段；与 CLAUDE.md 绝不双建）；tracker 首次用时由 setup 补齐。 |

> 曾试验两阶段 bootstrap（梁神模式，`tool-bootstrap.mjs`）：实测仅对 DeepSeek V4 Pro
> 有效，对其他模型（含 V4 Flash）是副作用，已取消（见 `CONTEXT.md` D17），恢复全量表面。

## 安装（bundle patch 装载，#28）

DSH 0.2.0-rc 起的 preset 注册表**不做目录扫描**——放进 `.agent-presets/` 不会再被
发现（旧「自动发现」约定仅对 `dsh-agent-presets` 宿主有效）。装载机制是 **bundle
patch**：本包 `package.json` 声明 `dsh.bundle.patch`（→ 生成的 `cordis.patch.yml`，
内含 preset 插件行 `dsh-matt-preset`），经 `dsh plugin --profile <p> add` 链入
profile 生效。

一条命令（payload 拷入 `$DSH_HOME/.agent-presets/matt/` 作稳定存储 + 版本戳，
再挂进 profile）：

```bash
npx github:ch1bug/dsh-matt-preset install          # 默认挂到 profile web
# 或：git clone 后 node bin/install.mjs install / npm pack 后 install --from <tgz>
```

- 指定 profile：`--profile <name>`（layer 不存在时 `dsh plugin add` 自动创建）。
- 升级/回滚/卸载：`upgrade`（原地替换；回滚 = 重装旧版本包）/ `uninstall`
  （存储与 profile link 一起摘）。版本戳在 `.agent-presets/matt/VERSION.json`。
- 旧 `install.sh`（纯目录拷贝）在 rc.2 上**装完加载不了**，仅为兼容保留，#31 移除。

然后重启 `dsh --profile <p>`（或新开会话），hero-chip 选择 "Matt 工作流"。

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
node tests/verify-persona.mjs      # persona 即系统提示词：{{model}}/{{cwd}} 渲染插值
node tests/verify-enforcer.mjs     # workflow-enforcer V1–V15（基线/高危一次性/白名单/关票抽查/建票提醒/批内收尾 AUTO-HANDOFF/scope/无噪音/沙箱门禁）
node tests/verify-production.mjs   # 生产级：真实 persona 全文 + 真实 minimal persona
node tests/verify-lang-count.mjs   # 注入次数计数：GATES 每轮 1 / LANGBASE 会话 1 / LANGTRIGGER 触发 1
node tests/verify-lang-enforcer.mjs    # 语言知识包 V1–V5（命中注入/触发/会话一次/disable/非 matt 会话）
node tests/verify-lang-asm.mjs     # 语言包系统提示词组装（真实 matt persona + lang 段）
node tests/workflow-enforcer-grill-contract.mjs  # enforcer × grill 模式契约
node tests/verify-bundle-sync.mjs  # cordis.patch.yml 字节级锁（agent.cordis.yml 唯一手改源）
node tests/sandcastle-e2e.mjs      # sandcastle 三命令端到端（33 断言：审计/重叠/夜跑/幂等/simplify/model-lane）
```

## 目录

```
dsh-matt-preset/
├── preset.yml                    # roster 元数据（name/description/order）
├── agent.cordis.yml              # cordis 组合（persona=七门工作流人设 + 全量工具 + 三个内置插件）
├── handoff-tool.mjs              # 交接工具（fork/fresh 子会话 + 环境快照段）
├── workflow-enforcer.mjs         # WORKFLOW GATES 提醒注入
├── workflow-gates.yml.example    # 项目级高危清单模板
├── scripts/                      # sync-skills（上游技能镜像同步：sh + ps1 双实现，#1）
├── sandcastle/                   # 沙箱批跑（opt-in）：模板 + 接入文档
│   ├── README.md
│   └── templates/                # Dockerfile / dsh.ts adapter / audit-ticket / run-ticket / night-run / lib / worker-context
├── CONTEXT.md                    # 术语表 + 决策（D1–D38）
├── docs/adr/                     # 架构决策记录
├── docs/workflow-enforcer.md     # enforcer 使用文档
├── docs/workflow-session-boundaries.md  # 会话边界与成本模型设计视图
└── tests/                        # 10 项：verify / persona / enforcer / production / lang-count / lang-enforcer / lang-asm / grill-contract / bundle-sync / sandcastle-e2e
```

## License

MIT。组合改编自 DeepSeek Harness 内置 preset（MIT，DeepSeek）；曾含的
`tool-bootstrap.mjs`（来自 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)，
MIT）已于 D17 移除，详见 [NOTICE](NOTICE.md)。
