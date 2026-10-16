# 开发环境（源码部署 / 隔离 / 构建）

本文件是本仓**环境事实的唯一来源**：基准纪律、隔离契约、工具链结论、源码部署步骤、构建坑。
它存在的理由（retro 2026-10-16）：这些事实此前只落在某个 msys2 home 的 REGISTRY.md
里，**仓外、不可继承**，每个新会话/新机器都要从零试错（本会话大半长度花在这条链上）。

日常改动的验证走 `scripts/verify-all.mjs`（见 README「验证」）；本文件只管**起实例**。

## 0. 基准纪律：工作区是源，部署副本只是副本

- **唯一基准 = 工作区**（本仓 checkout，远端 `ch1bug/dsh-matt-preset`）。一切改动**只提交到工作区**。
- msys2 侧的源码树 / DSH_HOME / profile **只是部署副本**：可再生、可丢弃，**不承载唯一事实**。
  机器本地状态（端口、路径、profile 名）记在 `<DSH_HOME>/profiles/<p>/REGISTRY.md`；
  可继承的事实一律回仓（本文件 + [dsh-runtime-cheatsheet.md](dsh-runtime-cheatsheet.md)）。
- 副本要刷新时**重新部署**，不要在副本里手改后当基线（会漂移成第二份事实）。
- 同一 workspace 只保留**一份**部署副本；历史上的散落副本（早期 `<repo>/dsh-src`，与
  `/home/<user>/dsh-matt-src` 重复）已清理。

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
- **worktree 文本文件是 CRLF**（`core.autocrlf=true`，index 里存 LF）：`edit` 的**多行**
  `old_string`（`\n` 连接）匹配不到 CRLF 内容——用**单行锚点**；插入的新行是 LF，`git add`
  时归一化，仓库无碍。只有**逐字节敏感**的正文（骨架 `workflow-body.txt` 这类要被解析器
  逐字节复原的文件）才值得写一次性脚本并保持原行尾（`split('\n')` → 改 → `join(nl)`）。
- **一次性编辑脚本的自校验要对「冻结基线」，不要对改前内容**：改前内容里还带着你正要删掉的
  marker，拿它比必然"失败"——#56 为此误报过一次 `rejoin is NOT byte-lossless`（实际无损），
  白烧一轮。仓库里已有注意源（`tests/fixtures/workflow-body-v1.txt`）就直接对，别另存备份。
- **证明新守卫非空洞**：回退被守卫的实现，用例必须**红**（同义反复的用例是负债）。回退用
  `git show HEAD:<file>` 写进临时副本再换回；**别用 `git stash push -- <file>`**——它同时重置
  index（暂存态丢失）并按 autocrlf 把该文件重写成 CRLF（#66 会话实测：LF → 65 CRLF），事后要
  重新 `git add` 并核对行尾。
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
| DSH_HOME | msys2 侧独立 home | 各自独立 home | `C:\Users\<user>\.dsh` |
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
DSH_HOME=<home> pnpm exec dsh --profile <profile> --no-open --port <port>
```

首次启动会自动初始化 profile（生成 `cordis.yml`、`.credentials.yaml`、`storages/`）。

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