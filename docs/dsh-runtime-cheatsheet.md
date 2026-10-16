# DSH 运行时速查（驱动实例 / 读证据）

让 agent **不必再靠反复 grep 大文件**去发现运行时接口（retro 2026-10-16：本会话为此
花了 8+ 次大文件检索，并走 3 次 `gateway/arguments-invalid` 弯路）。可执行形态见
`tests/verify-live-tool-call.mjs`（mock 层）与 `tests/verify-live-real-llm.mjs`（真实层）。

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
| 会话是否在跑 / token 用量 / 加载了哪个 preset | `session/projections` → `{ running, values:{ tokenUsage, contextBreakdown, agentPreset, title } }` |
| 耐久事件（assistant 消息、tool/call、tool/result） | `session/page` → `{ address:{kind:'session',sessionId}, throughSeq:<投影 asOfSeq>, maxMessages:N }` |
| 该会话可见的技能目录 | `skills/list`（**冷读**：会话未 live 时走宿主注册表，live 时走 preset 作用域 —— 同一 session 前后可能不同） |

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

实例：[tests/verify-workflow-profiles-2.mjs](tests/verify-workflow-profiles-2.mjs) 的 ptc 形状。

## 权威来源（要更细就读这些）

- `packages/api/session-controller/src/index.ts`（`@Remote` 方法）、`.../types.ts`（请求/响应形状）
- `packages/api/session-controller/lib/typert.remote-client.d.ts`（生成的客户端声明）
- `apps/web/tests/smoke-real.e2e.ts`（token→cookie 交换 + mock provider + ws mux 的上游写法）
- 运行时版本对应的**源码检出**（版本锚见 [dev-environment.md](dev-environment.md)）