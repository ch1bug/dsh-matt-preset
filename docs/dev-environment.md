# 开发环境（源码部署 / 隔离 / 构建）

本文件是本仓**环境事实的唯一来源**：基准纪律、隔离契约、工具链结论、源码部署步骤、构建坑。
它存在的理由（retro 2026-10-16）：这些事实此前只落在某个 msys2 home 的 REGISTRY.md
里，**仓外、不可继承**，每个新会话/新机器都要从零试错（本会话大半长度花在这条链上）。

日常改动的验证走 `scripts/verify-all.mjs`（见 README「验证」）；本文件只管**起实例**。

## 0.0 本仓这一次的脱敏 / 历史重写（2026-10-16，#79 会话）

现场事实（**流程**见 [docs/agents/privacy.md](agents/privacy.md)）；基线 → 终态：

| 项 | 重写前 | 重写后 |
| --- | --- | --- |
| `main` tip | `ba1921d8`（远端 `12a2573`） | `29aff579` |
| `fix(#79)` 交付提交 | `12a2573` | `5c3f8da8` |
| tag `dsh-v0.2.0-rc.2-r1` | `c57bfba` | `091fa29` |

- **清除面**：文件内容 + 提交消息 + 提交身份（author / committer / tag tagger）。个人用户名 → `<user>`；
  旧散落副本根 → `<repo>/…`；旧工作布局 → `<work>/…`；个人邮箱与旧机用户名统一为
  `ch1bug <ch1bug@users.noreply.github.com>`（本仓局部 git 身份同形，后续提交不再写回个人邮箱）。
- **影响面**：个人用户名命中 **77 个提交 / 12 个路径**；旧机用户名是 **130 个提交的身份名**；
  提交消息 2 笔。完整性：131 提交 / 94 tracked 文件 / 文件名零差异。
- **退路**：本机仓外备份目录（`git bundle --all` + `.git` 全量副本 + tracker 原件）——
  含**未脱敏**原件，离线保管，确认无碍后再处置。
- **起手式教训**：`--path-glob` 是**只保留**语义（误用一次 → 94 文件滤成 35，已靠退路回滚）；
  探针一律大小写不敏感；tracker 一律 `--paginate`（只取第一页会给出"看起来干净"的假象）。
- **残留（human 2026-10-16 拍板不处理）**：GitHub 上旧对象仍可按旧 SHA 直接访问
  （本仓 0 fork / 0 PR）；彻底清除需向 GitHub Support 申请 purge。

## 0. 基准纪律：工作区是源，部署副本只是副本

- **唯一基准 = 工作区**（本仓 checkout，远端 `ch1bug/dsh-matt-preset`）。一切改动**只提交到工作区**。
- msys2 侧的源码树 / DSH_HOME / profile **只是部署副本**：可再生、可丢弃，**不承载唯一事实**。
  机器本地状态（端口、路径、profile 名）记在 `<DSH_HOME>/profiles/<p>/REGISTRY.md`；
  可继承的事实一律回仓（本文件 + [dsh-runtime-cheatsheet.md](dsh-runtime-cheatsheet.md)）。
- 副本要刷新时**重新部署**，不要在副本里手改后当基线（会漂移成第二份事实）。
- 同一 workspace 只保留**一份**部署副本；历史上的散落副本（早期 `<repo>/dsh-src`，与
  msys2 侧部署副本 `$HOME/dsh-matt-src` 重复）已清理。本文用 `$HOME` 表示 **msys 侧**
  用户目录（≠ Windows 用户目录，见 §0.1）、`%USERPROFILE%` 表示 Windows 用户目录。

## 0.1 msys2 会话引导（复用 Windows 侧配置）

msys 的 `HOME` 不是 Windows 用户目录，默认 PATH 也没有 Windows 的 node/gh ——
msys 里 `gh auth status`、`node tests/…` 会直接失败。source 一条命令解决：

```bash
. <repo>/scripts/msys-env.sh      # 想常驻：写进 ~/.bashrc
```

它只**指向**Windows 的配置（不改、不复制）：`PATH` 加 Windows node / gh /
Windows git(GCM)，`GIT_CONFIG_GLOBAL` / `GH_CONFIG_DIR` 指向 Windows 用户目录，
`COREPACK_HOME` 指向 corepack 缓存。

**PATH 顺序是硬约束**：Windows node 必须优先于 msys 的 ucrt64 node —— 后者上报
`platform=win32-x64-gnu`，跑套件会以 `0xC06D007F`（过程/DLL 找不到）崩在原生依赖上
（实测 `verify.mjs` / `verify-dual-env.mjs`）。

## 0.2 agent shell 的工具链与内联脚本

跑命令的是**模型 shell**，它的 PATH 与登录 shell 不同——以下都是实测教训
（retro 2026-10-16、#56 会话）：

- **`pnpm` 未必在 PATH 上**（现场报 `术语 'pnpm' 不会被识别…`）。验证走
  `node scripts/verify-all.mjs`（唯一入口，不需要 pnpm）；确实要 pnpm / python / node 的
  绝对路径时，用 DSH harness 的 `load_workspace_dependencies`（返回随包分发的路径），
  别假设 PATH 里已有。
- **带正则或多行的 `node -e` 内联脚本别硬塞进 pwsh 参数**：PowerShell 的转义符是反引号，
  `\$` 不是转义（正则被原样传下去、静默不匹配），而 `@'…'@` here-string 里的 `$` 仍会被
  展开。写临时 `.mjs` 跑、自检通过后删掉——本会话为此白烧过一轮往返。
- **同一类陷阱：`\"` 也不是 pwsh 的转义**（反引号才是）。给 CLI 传含引号/空格的多词正文时，
  `gh issue close --comment "…\"six hard gates\"…"` 会被拆成多个参数
  （报 `accepts 1 arg(s), received 4`）；用 here-string 变量（`$c = @'…'@`）或 `--body-file`。
  **反引号与 `$` 在双引号里同样会被吃掉**：`gh issue create
  --title "…\`dir/**\`…"` 会把 markdown 反引号写成 `\`（#66 会话实测，随后用 `gh issue edit`
  的单引号标题修回，白一往返）——带反引号 / `$` 的标题或正文一律走**单引号**、here-string 或
  `--body-file`，写完**回读一遍**。
- **回读自检本身也可能撒谎：`Select-String` 的 `-SimpleMatch` 别与 `[regex]::Escape()` 拼用**——
  Escape 把 `#79` 变成 `\#79`，而 `-SimpleMatch` 按**字面**去找那个反斜杠串 → **静默 0 命中**。#75
  会话实测代价：探测刚写的交接文档标记时，3 个明明在的标记报"0 处"，差点把"文档缺内容"上报出去
  （换 grep 工具复核才发现是探测侧错）。纯字面探测别 Escape；要正则就别加 `-SimpleMatch`。
- **worktree 文本文件是 CRLF**（`core.autocrlf=true`，index 里存 LF）。**2026-10-16 复测更正：多行锚点可用**（在 230/230 CRLF 的 `tests/verify-installer.mjs` 上用两行锚点成功改注释，11 次 `edit` 后该文件仍 230/230 CRLF）。旧记的"多行
  `old_string`（`\n` 连接）匹配不到 CRLF 内容——**这条 2026-10-16 已复测证伪，别再为此退回单行锚点**；插入的新行是 LF，`git add`
  时归一化，仓库无碍。只有**逐字节敏感**的正文（骨架 `workflow-body.txt` 这类要被解析器
  逐字节复原的文件）才值得写一次性脚本并保持原行尾（`split('\n')` → 改 → `join(nl)`）。
- **一次性编辑脚本的自校验要对「冻结基线」，不要对改前内容**：改前内容里还带着你正要删掉的
  marker，拿它比必然"失败"——#56 为此误报过一次 `rejoin is NOT byte-lossless`（实际无损），
  白烧一轮。仓库里已有注意源（`tests/fixtures/workflow-body-v1.txt`）就直接对，别另存备份。
- **证明每条新断言非空洞**（不只是"守卫"：隔离 / 清理这类辅助环同样算）：把被断言的输入换成反例，
  用例必须**红**——说不出"什么输入能让它红"就是同义反复（负债）。#75 实例：`--port 0` 下断言"分到的
  端口不是保留口"**恒真**（复核才抓到），改成保留口前后占用快照后才可红。
- **扰动要打在运行时真正读的那份上**：本仓 preset 装载读的是**生成的载体** `cordis.patch.yml`
  （源 `agent.cordis.yml` 改了要经 `tests/verify-bundle-sync.mjs` 同步才生效）。#75 实测：扰动源文件
  → **整跑全绿、零证明**，白一次实例跑 + 一次 52k 字符的载体通读。
- **回退扰动的机械坑**：回退用 `git show HEAD:<file>` 写进临时副本再换回；**别用
  `git stash push -- <file>`**——它同时重置 index（暂存态丢失）并按 autocrlf 把该文件重写成 CRLF
  （#66 会话实测：LF → 65 CRLF），事后要重新 `git add` 并核对行尾。用 `git checkout -- <file>` 回退后
  **编辑前要重新 `read`**（FS 版本守卫报 `file changed since it was read`）；`old_string` 在多处分叉处
  重复时（如 `mountOrWarn(profile, …)` 在 install/upgrade 两处同形），带上相邻行做锚点。
- **杀子进程后别立刻 `process.exit`**：等 `exit` 事件后再等 stdout/stderr 管道 `close`。否则 Windows 上
  会撞 libuv 断言 `!(handle->flags & UV_HANDLE_CLOSING)`，**退出码变成崩溃码**（#75 实测
  `-1073740791`），把"哪一环红"的读数埋掉；成功路径可能只因后面还有别的 `await` 而侥幸躲过。
  （`tests/verify-live-tool-call.mjs` 旧注释把这条断言当"噪音、不影响结论"——**已实测证伪**；
  收尾代码的修法随 #81 抽共享挂具时一并带过去。）
- **installer 的 CLI 用例可以完全离线**：`--root <tmp>` 是纯存储模式（不碰 profile、不需要
  `dsh`）；fixture 里放 `node_modules/yaml/package.json` stub 即可满足运行时依赖解析
  （`createRequire` 锚在**来源包自身**，走不到仓外 node_modules），并用 `manifest.json` 的
  `dependencies.yaml === <stub 版本>` 反证"走的是 stub，不是环境里恰好有的 yaml"。实例：
  `tests/verify-payload-manifest.mjs` 的 P9（反向：不落 store）/ P10（正向：命中的文件真落
  store）——#67 已修、方向同此：无 dsh 时 4 条 profile-link 断言响亮跳过（`SKIP (loud)`），store 侧照跑。

## 1. 隔离契约：两个工作区 + 桌面端互不干扰

启动器用 **`DSH_HOME`** 定位 home、用 **`--profile <name>`** 选择 `$DSH_HOME/profiles/<name>`。
两处都要独立，profile **名**也要不同（防误挂、防误读）。

| 资源 | 本工作区（matt 工作流） | 相邻工作区（shell-host） | 桌面端 |
| --- | --- | --- | --- |
| DSH_HOME | msys2 侧独立 home | 各自独立 home | `%USERPROFILE%\.dsh` |
| profile | `matt-dev` | `dsh-host-dev` | `desktop` |
| 端口 | 19501 | 19502 | 19387（GUI） |
| 源码树 | 各自 clone | 各自 clone | 安装版 |

- **`DSH_PROFILE` / `DSH_PROFILE_DIR` 不是启动选择器**：它们是 `dsh-shell-env` 每次
  模型 shell 调用**注入给模型的输出事实**。拿它们做隔离判断是错的。
- 桌面端是**稳定升级通道**：开发中的改动不得先装桌面端（CONTEXT「DSH 测试/升级通道分工」）。
- pnpm store 与 corepack shim 可共享（内容寻址、只读复用），**并发 install 不要共享**。

## 2. 宿主锚点（ADR-0008）

跟随 DSH 运行时 **rc 线**（latest 通道）：本仓 `0.2.0-rc.2-r1` ↔ 宿主 tag
`dsh-v0.2.0-rc.2`。**浅克隆默认分支会落到 alpha 系**（实测 `dsh-v0.2.1-alpha.4`），
与锚不符 —— 必须显式 checkout tag。

## 3. 源码部署步骤（msys2 侧）

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git <src>
cd <src> && git fetch --depth 1 origin tag dsh-v0.2.0-rc.2 && git checkout tags/dsh-v0.2.0-rc.2
pnpm install --ignore-scripts --package-import-method=copy     # 见 §4 工具链
pnpm run clean                                                 # 见 §4 切 tag
pnpm run build                                                 # 必须经 pnpm，见 §4
DSH_HOME=<home> node <src>/apps/cli/lib/bin.js --profile <profile> --no-open --port <port>   # 构建产物入口（cwd 无关）；旧口径 `pnpm exec dsh` 在本机不通，见 §3.1
```

首次启动会自动初始化 profile（生成 `cordis.yml`、`.credentials.yaml`、`storages/`）。

### 3.1 运行时可达性：`dsh` 从哪来（PATH 无 `dsh` ≠ 运行时缺席）

**2026-10-16 实测**：Windows 侧 agent shell 与 msys 登录 shell 的 PATH 上**都没有** `dsh`
（`Get-Command dsh` / `which -a dsh` 均空），但**运行时是可达的**——msys 侧部署副本
`$HOME/dsh-matt-src`（tag `dsh-v0.2.0-rc.2`）与 DSH_HOME `$HOME/dsh-matt-home` 都在位。
把"PATH 无 dsh"读成"本机没有 dsh / 有 dsh 那半边无法验证"是**错的**：#67 会话据此把
`verify-installer` 的 4 条 link 断言判成"本机不可验证"，写进了已 push 的 commit。

| 用途 | 命令 |
| --- | --- |
| 起实例（与仓外 `start-matt-dev.sh` 同口径） | `cd <src> && node --import tsx/esm apps/cli/src/bin.ts --profile <p> …`（**cwd 必须是 `<src>`**，否则 `--import tsx/esm` 解析不到 tsx） |
| 跑 CLI（构建产物，cwd 无关） | `node <src>/apps/cli/lib/bin.js --profile <p> …`；`--version` 应为 `0.2.0-rc.2` |

**PATH 型工具**（`bin/install.mjs`、测试里的 `dsh --version` 探针）shell out 到字面 `dsh`，需要一个
包装（临时放 `%TEMP%`，跑完可弃；`<src>\node_modules\.bin` 提供 `dsh plugin` 需要的 pnpm，见 §4.5）：

```bat
@echo off
node "<src>\apps\cli\lib\bin.js" %*
exit /b %ERRORLEVEL%
```

```powershell
$env:PATH = "<shim 目录>;<src>\node_modules\.bin;$env:PATH"
dsh --version                                                  # → 0.2.0-rc.2
$env:DSH_MATT_INSTALLER='1'; node tests/verify-installer.mjs   # → 11/11、exit 0、零 loud skip
$env:DSH_MATT_LIVE_CLI='<src>\apps\cli\lib\bin.js'; node tests/verify-clean-env-e2e.mjs   # #75 全链：临时 home → bin/install.mjs → 启动 → 建会话 → turn（16 环）
```

实测结果（2026-10-16，装上包装后）：`verify-installer.mjs` **11/11、零 loud skip**（此前 4 条 link
断言 + e2e 全是 loud skip）；`node scripts/verify-all.mjs` 里 `verify-installer` 由 `PASS*` 变
**`PASS`**（#67 时基线 20/21；#75 加入 `verify-clean-env-e2e.mjs` 后为 **21/22**，无 dsh 时 20/22）。
`verify-clean-env-e2e.mjs` **16 环全绿、exit 0、零 loud skip**（#75）。非空洞四处（均已回退）：store
路径偏差 → 安装环 A1/A2/A3 红；去掉 profile link → A3/B1/C1 红；去掉载体的 workflow-core loader row →
B1/D1 红；把实例改到保留口 → B5 红。
**有 dsh 那半边在本机可验证——别再默认"跳过了事"。**

**profile 的"面"由初始化模板决定**（2026-10-16 实测，#75）：起 **web 面**的 profile 必须由 shipped
web 模板初始化（`--profile <p> --from-default-profile web …`）。`dsh plugin --profile <p> add <store>`
给**自建新名字**的 profile 只建出 `@deepseek-ai/dsh-base`（+ 挂进去的 preset），实例**不会**打印
`dsh web:`（实测 60s 无该行 → 会被误读成"起不来"），stderr 出
`preset-…: pending (waiting for service: agentPresets)`。用 shipped 名（如 `web`）时自建 layer 自带该
模板的 bundles（`dsh-base` + `dsh-web-app`）——所以 `bin/install.mjs install`（默认 profile `web`）一条
命令就能起 web 面（#75 的用例仍显式 bootstrap：它要的是**新名字** `matt-clean` 上的 web 面）。

## 4. 工具链结论（全部实测，别重复试错）

1. **ucrt64 node 跑 pnpm 装 DSH 本体不可行**：pnpm 加载 N-API 原生件即
   `napi-sys … Node-API symbol has not been loaded` → panic abort（`--ignore-scripts`
   也一样）。绕行 = `--package-import-method=copy`（关硬链接），且用 Windows node 装。
   *（相邻工作区的插件包几乎纯 JS，纯 ucrt64 能过 —— 结论不可类推。）*
2. **构建期原生件缺口**：ucrt64 node 上报 `platform=win32-x64-gnu`，而 rolldown 等
   只发布 `-msvc` 绑定 → 构建必须走 **Windows node**。
3. **RC2 的构建接口**：`scripts/build.ts` 用 `--profile`（alpha HEAD 是
   `--scope artifacts`），且**必须经 pnpm 调用**（脚本读 `npm_execpath`）→ `pnpm run build`。
4. **切 tag 后必须 `pnpm run clean`**：`lib/` 被 `.gitignore` 忽略，`git status` 看着
   干净，实际残留上一 tag 的产物（实测 358 个 `lib/`）→ RC2 构建报
   `MISSING_EXPORT "principalOf"`（该符号只存在于 alpha 源码）。clean 清掉 369 路径后通过。
5. **`dsh plugin` 需要 PATH 上有 pnpm**：`corepack enable --install-directory <dir>`
   装 shim（写 Program Files 会 EPERM）；`dsh plugin --profile <p> add <绝对路径>`。
6. **msys 的 `pkill` 杀不掉 Windows node 进程**：端口占用报
   `EADDRINUSE 127.0.0.1:<port>` 时，用 `netstat -ano` 找 pid + `Stop-Process -Id <pid> -Force`。

## 5. 实例相关文档

- 驱动实例 / 读证据 / mock LLM：[dsh-runtime-cheatsheet.md](dsh-runtime-cheatsheet.md)
- 隔离与构建的**本地落地记录**（每个 home 各一份，机器相关，不入库）：
  `<DSH_HOME>/profiles/<profile>/REGISTRY.md`
- 验证入口与门禁：[README「验证」](../README.md)