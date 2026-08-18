# dsh-matt-preset — Matt 工作流模式（DeepSeek Harness agent preset）

按 [Matt Pocock 的 AI 编码工作流](https://github.com/mattpocock)（ask-matt）运转的
DSH agent preset：**grill 打磨想法 → 原型判定 → to-spec / to-tickets 拆票 →
implement（内嵌 tdd）→ code-review**，配 handoff 工具、定时任务
与工作区自主初始化。

## 这是什么规范

- **DSH agent preset**（`@deepseek-ai/dsh-agent-presets` 规范）：一个 preset 目录 =
  `preset.yml`（roster 元数据：`name`/`description`/`order`）+ `agent.cordis.yml`
  （cordis 组合，即发现器认的 `COMPOSITION_FILE`）。安装位 =
  `$DSH_HOME/.agent-presets/<id>/`（user trust）；preset id 必须匹配
  `/^[a-z0-9][a-z0-9-]*$/`。
- 目录内的 `.mjs` 是 **cordis 插件**（导出 `name`/`apply`/`inject`），组合文件按
  相对路径 `./xxx.mjs` 引用——它们是这个 preset 的组成部分，不是独立发布的 npm 插件包。
- 与 **DSH 插件**（npm 包，作为 bundle 装进 profile，如 `dsh-llm-mimo`）的区别：
  插件扩展宿主能力，preset 组合能力并定义会话表面；本仓库是后者。

## 特性

| 组件 | 说明 |
| --- | --- |
| `matt-workflow.mjs` + `.md` | 完整 ask-matt 工作流地图，注册为独立 `matt:workflow` prompt section（紧跟 persona 之后）；`{{model}}`/`{{cwd}}` 插值。 |
| `handoff-tool.mjs` | 写可移植交接文档 → 创建子会话（`fork` 带历史 / `fresh` 全新）→ 文档作为子会话**首条 user 提示词**，首轮立即开始；子会话自动 attach workspace、携带 model 路由。 |
| `scheduled-jobs.mjs` | cron 定时任务（`cron-parser`）：`jobs_list`/`jobs_run`/`jobs_pause`；失败可选通知显式配置的会话（`notifySessionId`，空 = 仅记日志）。 |
| INITIALIZATION 人设段 | 工作区无 `CONTEXT.md` 时自主探测（git/docs/语言信号）并建骨架 + 空 `docs/adr/`。 |

> 曾试验两阶段 bootstrap（梁神模式，`tool-bootstrap.mjs`）：实测仅对 DeepSeek V4 Pro
> 有效，对其他模型（含 V4 Flash）是副作用，已取消（见 `CONTEXT.md` D17），恢复全量表面。

## 安装

DSH 的 preset 没有包管理器：`dsh plugin` 只管 profile 的 **npm 插件**，GUI 设置里的
"复制 preset" 也只能复制 roster 上已有的 preset。preset 的官方安装位就是 user root 的
一个目录——**放进去 dsh 启动时自动发现**（`$DSH_HOME/.agent-presets/<id>/`，id 匹配
`/^[a-z0-9][a-z0-9-]*$/`），不需要任何注册或配置。所以"安装"= 把本仓库放进那个位：

```bash
git clone https://github.com/ch1bug/dsh-matt-preset.git ~/.dsh/.agent-presets/dsh-matt-preset
npm install --prefix ~/.dsh cron-parser luxon   # scheduled-jobs 的依赖（用户自有目录，不碰部署包）
```

或一键（等价，含依赖）：

```bash
curl -fsSL https://raw.githubusercontent.com/ch1bug/dsh-matt-preset/main/install.sh | bash
```

然后重启 `dsh web`（或新开会话），hero-chip 选择 "Matt 工作流模式"（没有就刷新一下页面）。

> `notifySessionId` 仓库版本默认 `""`（失败仅记日志）；需要通知就填一个真实会话 id。

## 验证

```bash
# 依赖解析同部署：把测试的 @deepseek-ai 指到 dsh 安装的 node_modules
mkdir -p tests/node_modules
ln -s "$(dirname "$(dirname "$(readlink -f "$(which dsh)")")")/node_modules/@deepseek-ai" tests/node_modules/@deepseek-ai
node tests/verify.mjs          # 17 项：handoff 子会话 + 文档首条提示词 + model 路由 + /clear 已移除 + jobs 全套 + workspace attach
node tests/verify-notify.mjs   # 失败通知端到端（live followup）
# 其它机器部署路径不同时：
DSH_SHIPPED_PRESETS=<shipped agent-presets 目录> node tests/verify.mjs
```

## 目录

```
dsh-matt-preset/
├── preset.yml            # roster 元数据（name/description/order）
├── agent.cordis.yml      # cordis 组合（persona + matt-workflow + 全量工具 + handoff-tool + scheduled-jobs）
├── *.mjs                 # preset 内 cordis 插件（matt-workflow / handoff-tool / scheduled-jobs）
├── matt-workflow.md      # 完整 ask-matt 人设文本
├── CONTEXT.md            # 术语表 + 决策（D1–D17）
├── docs/adr/             # 架构决策记录
└── tests/                # 挂载验证（verify.mjs / verify-notify.mjs）
```

## License

MIT。组合改编自 DeepSeek Harness 内置 preset（MIT，DeepSeek）；曾含的
`tool-bootstrap.mjs`（来自 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)，
MIT）已于 D17 移除，详见 [NOTICE](NOTICE.md)。
