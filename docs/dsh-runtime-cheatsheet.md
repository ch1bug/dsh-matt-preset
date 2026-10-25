# DSH 运行时速查（驱动实例 / 读证据）

让 agent **不必再靠反复 grep 大文件**去发现运行时接口（retro 2026-10-16：本会话为此
花了 8+ 次大文件检索，并走 3 次 `gateway/arguments-invalid` 弯路）。可执行形态见
`tests/verify-live-tool-call.mjs`（mock 层）、`tests/verify-live-real-llm.mjs`（真实层）与
`tests/verify-clean-env-e2e.mjs`（#75 全链：临时 home → `bin/install.mjs` → 启动 → 建会话 → turn）。

## 鉴权（完整 web 挂载路径，非 headless）

启动时 stdout 打印一行：

```
dsh web: http://127.0.0.1:<port>/?token=<token>
```

换取 cookie（不要用 `?token=` 重复请求）：

```js
const r = await fetch(launchUrl, { redirect: 'manual' })   // 303 + Set-Cookie
const cookie = r.headers.get('set-cookie').split(';', 1)[0]
```

> `.credentials.yaml` 里的 `client-connection/browser-session` secret **不是**这个 token
> （实测换 cookie 得 401）。

## RPC：typert Remote over HTTP

```
POST http://127.0.0.1:<port>/api/<endpoint>
body: { type:'client-request', rpcId:'…', method:'<endpoint>', payload:{ args:{…} } }
headers: { cookie, 'content-type':'application/json' }
→ { result: { ok:true, value } | { ok:false, error:{ code, message } } }
```

**参数名逐方法不同**（猜错报 `gateway/arguments-invalid`）：

| endpoint | args 形状（`payload.args`） |
| --- | --- |
| `session/create` / `session/prompt` / `session/selectModel` / `session/page` | `{ request: {…} }` |
| `session/list` | `{ _request: {} }` |
| `session/projections` | `{ request: { sessionId } }` |
| `session/initializeDefaultModel` / `session/modelCatalog` | `{}`（**无参**） |
| `skills/list` | `{ request: { sessionId } }` |

常用 endpoint：`session/create`（可带 `agentPreset`）、`session/prompt`
（`{requestId, sessionId, mode:'queue'|'steer', content:[{type:'text',text}]}`）、
`session/list`、`session/projections`、`session/page`、`skills/list`。

## 读证据：**别拿会话文件当实时证据**

会话日志在 `<home>/sessions/<cwd 编码>/session-<id>/session.v4.jsonl.zstd`
（zstd 压缩 JSONL；Node 24 用 `zlib.zstdDecompressSync`），但它是**批量落盘**的：
实测真实 turn 早已完成（25.5K 输入 token、模型已回话）时，文件里**只有 header 行**。

| 目的 | 用 |
| --- | --- |
| token 用量 / 加载了哪个 preset / 子代理目录 | `session/projections` → `{ running, values:{ tokenUsage, contextBreakdown, agentPreset, title, subagentCatalog } }`。⚠ **`running` 别当 turn 完成判据**（#50 实测 2026-10-24：turn 进行中可为 false，runner 据此截早把开头当完成）——判定 turn 结束用 `session/page` 事件流的 `turn/end` 且其后无 `turn/start`。0.2.1 起投影证据还要按**`kind: 'sequenced' \| 'migration-required'`** 判别——后者**无 `asOfSeq`**（#90 票面取证，勿在 `migration-required` 投影上读 `asOfSeq`） |
| 耐久事件（assistant 消息、tool/call、tool/result） | `session/page` → `{ address:{kind:'session',sessionId}, throughSeq:<投影 asOfSeq>, maxMessages:N }` |
| 该会话可见的技能目录 | `skills/list`（**冷读**：会话未 live 时走宿主注册表，live 时走 preset 作用域 —— 同一 session 前后可能不同）。0.2.1 起冷读 cwd 依次回退「投影 `workingDirectory` → `header.cwd` → 配置默认目录」，且不再抛 `gateway/internal` "has no project cwd"（#90 票面取证） |

## 无凭据驱动一个真实 turn（本地 mock LLM）

```bash
DEEPSEEK_BASE_URL=http://127.0.0.1:<mockPort> DEEPSEEK_API_KEY=<任意非空>
```

mock 说 Anthropic SSE：`message_start` → `content_block_start`（`text` 或
`tool_use`）→ `content_block_stop` → `message_delta`(`stop_reason`) → `message_stop`，
每帧 `data: {json}\n\n`。用它捕获**实例发出的真实请求**（系统提示词原文）并驱动
工具执行。真端点走 `https://api.deepseek.com/anthropic`。

**账号授权路线**（无 API key）：把 `deepseek-account-platform/*` 记录**只读**复制进
目标 home 的 `.credentials.yaml`，然后 **`session/modelCatalog` 取账号模型 →
`session/selectModel` 显式路由本会话**（只调 `initializeDefaultModel` 不够：会话已建、
路由不回溯 → turn 静默卡住、无错误、无事件落盘）。

## 探针卫生

临时实例一律 `--port 0`（OS 临时端口）+ `os.tmpdir()` 下的临时 `DSH_HOME`：零端口冲突、
零凭据残留；`kill` 后要等子进程 exit，否则 libuv 打 `UV_HANDLE_CLOSING` 断言噪音。

## 挂载级测试的 stub 配方（真实插件行 → mount harness）

要把**真实插件行**（不是 persona + workflow-core 这种自带服务的最小行）挂进
`tests/preset-harness.mjs`：`ensurePresetMountable(ctx, id)` 按诊断里的 `waiting for X`
**逐个盲补**惰性 stub，但一行**自己提供**某服务的插件不能等到被 stub——被 stub 过的服务
名再被真 provider 注册时报 `service "X" has been registered at <root>`，挂载失败。

- **不要预置该行自己提供的服务**：`dsh-ptc-runtime-node` 提供 `ptcRuntime`，
  `dsh-workflow-ptc` 提供 `workflowEngine`。
- **只预置宿主确实缺的服务**：PTC 形态（`dsh-ptc-runtime-node` + `dsh-workflow-ptc` +
  `dsh-tool-workflow`）实测先 `ctx.provide(name, inertService())` 补
  `fs` / `sandbox` / `sandboxPolicy` / `subagents` 四项，再交 `ensurePresetMountable` 即可。
- stub 形状用挂具导出的 **`inertService()`**（单一事实源），别就地再写一个 Proxy。
- **`inertService()` 是「浅」Proxy（`get` 只返回 no-op 函数，不递归）**：插件若访问
  `ctx.<svc>.<sub>.<method>()`，浅层会让 `.<sub>` 求值成一个**函数**，再取 `.method` 就是
  `undefined` → `TypeError`。实测（2026-10-18，#99）：`dsh-tool-jobs` 真调
  `ctx.jobs.events.subscribe(...)`，浅 stub 下 `ensurePresetMountable` 的第二轮诊断里
  **再也抓不到 `waiting for`**（错误换形了），于是循环 `break` 并抛
  `preset … not mountable in harness` —— 报的是"挂不上"，真因是 stub 太浅。
  **修法**：对这类服务预置**深一层**的 stub（仍以 `inertService()` 为底，例如
  `{ ...inertService(), events: inertService() }`），而**不是**去加大盲补轮数。

## 挂载级断言的判据：两层，不是 `broken === undefined`

全量 matt roster 在挂具里**必然**缺 host 侧能力（`subagents` / `sandboxPolicy` /
`model-selection-settings` 等），`resolve(id).broken` **恒非 `undefined`** ——
所以「激活干净」是一个**不可达**的判据，写成断言就是永远红。
本仓既有口径（`tests/verify.mjs` Track B）分两层，照它写：

- **A 层（严格，必须绿）**：声明**解析成功**、`config.id` 互不重复、roster 里在场、
  profile 亲子对应。
- **B 层（诊断）**：`broken` 的**每一行**都是 `: waiting for <host 服务>` ——
  **只含 host 面缺失**，不得出现任何**载体/声明缺陷**
  （`never started` / `Duplicate agent preset` / 模块加载失败 / 我们自己的行被点名）。

另：写「某个 id 可解析」这类断言时，**用固定期望表里的常量去 `resolve`，不要用"从文件里
读出来的 id"** —— 后者是空洞的：id 被改坏时它跟着坏，断言照样绿（2026-10-18 #99 实测抓到）。

### 两个诊断面不是一回事（实测 2026-10-18，#99）

对**全量 roster**（`cordis.patch.yml` 那一族，24 行）实测，两个面读数**不同**：

| 面 | 读数 |
| --- | --- |
| `ctx.agentPresets.resolve(id).broken` | **20 行，全部是 `: waiting for <host 服务>`**（0 条其它） |
| `ensurePresetMountable(ctx, id)` | **抛错**，且正文里另有 **2 条非 waiting**：<br>`tool-jobs: ctx.jobs.events.subscribe is not a function`<br>`tool-subagent: \`modelSelectionSettings\` requires …model-selection-settings in the Host scope` |

**关键：这两条在 pre-#99 的载体上完全相同**（拿 `git show HEAD:cordis.patch.yml` 实测），
所以它们是**挂具自身的缺陷**，不是任何载体改动引入的回归。

推论（写断言时直接照用）：
- **`ensurePresetMountable` 对全量 roster 恒抛**，不能当绿门；要用它就得写成
  "允许抛、但断言正文只含 `waiting for`"。
- **`resolve().broken` 是正确的那一面**：它把"载体缺陷"与"host 面缺失"分开，
  且不会被上面两条挂具缺陷污染。**判"我们的行没问题"就读它。**
- 上面那条 `jobs` 报错正是 `inertService()` 太浅导致的；但因为**它在 pre-#99 就存在**，
  修它是挂具的事，不是某张票的事。

实例：[tests/verify-workflow-profiles-2.mjs](../tests/verify-workflow-profiles-2.mjs) 的 ptc 形状。

## 工具坑（实测，费过一整轮的那种）

- **`gh api --jq` 输出形状**：`--jq '.[] | {…}'` 是 **JSONL**（逐行一个对象）——
  直接 `ConvertFrom-Json` 会报 "Additional text encountered after finished JSON content"。
  要整体解析就包数组 `--jq '[.[] | {…}]'`；要分页就保持 JSONL 并**逐行**解析
  （`--paginate` 会把数组拼起来，`JSON.parse` 整体一定炸）。
- **看旧版文件别整份 dump**：`git show HEAD:<file>` 会把你整份源码打进上下文（实测一次
  ~50K 字符）。要核对某几行就 `git show HEAD:<path> | Select-String -Pattern '…'`。
  顺带：`Set-Content -NoNewline` 会把管道里的多行**拼成一行**（写旧版副本时会毁掉内容）。
- **`gh api` 别忘了 `--paginate`**：不带它只有第一页。实测"30 条评论全绿"是假象——
  第 100+ 条里还有个人路径（见 [docs/agents/privacy.md](agents/privacy.md) §0）。
- **改 goal 状态可能被运行器拒（观察项，#155）**：#127 会话实测，自动续跑轮内 agent
  调 `update_goal` 暂停被拒，理由是「需要 top-level direct human turn」——即 goal
  生命周期迁移可能只在 human 直发的那一轮被允许，agent 轮内调用会被拒。这是上游
  DSH 工具契约的**待考古口径**（具体判定在运行器哪一层、版本锚，未核实——用前先对
  当前运行时实测或读上游源码确认；版本锚见 [dev-environment.md](dev-environment.md)）。
  agent 侧出口：工具拒绝后换最小输入重试或如实报告「goal 未同步」，不重复同型调用、
  不伪报成功（#155 正文规约）。需 human 介入也可主动切 blocked（`blocked_reason` 写
  阻塞事实/等待什么/解除条件）；真正完成应 complete，不用 blocked 代替。

## 权威来源（要更细就读这些）

- `packages/api/session-controller/src/index.ts`（`@Remote` 方法）、`.../types.ts`（请求/响应形状）
- `packages/api/session-controller/lib/typert.remote-client.d.ts`（生成的客户端声明）
- `apps/web/tests/smoke-real.e2e.ts`（token→cookie 交换 + mock provider + ws mux 的上游写法）
- 运行时版本对应的**源码检出**（版本锚见 [dev-environment.md](dev-environment.md)）