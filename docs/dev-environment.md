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
- **本仓自己的 msys2 侧检出（2026-10-17 起）**：`$HOME/dsh-matt-preset` = 只读部署副本，只用于
  「拉取 + 在 msys 工具链下验证」；**提交永远只在权威树**。建立与单向同步：

  ```bash
  git clone https://github.com/ch1bug/dsh-matt-preset.git "$HOME/dsh-matt-preset"
  node scripts/link-runtime-deps.mjs --runtime <含 node_modules/@deepseek-ai 的目录>   # 依赖接线
  git config core.hooksPath .githooks                                                  # 每 clone 一次
  # 之后每次同步（权威 → 副本）：
  git -C "$HOME/dsh-matt-preset" fetch --prune --tags --force origin
  git -C "$HOME/dsh-matt-preset" merge --ff-only FETCH_HEAD
  ```

- **tag 必须一起同步，且要 `--force`**（本机 2026-10-17 两形态探针复核，git 2.55/2.56 一致）：两种
  "同步不到 tag" 的形态**行为不同，别混说**——
  - `fetch origin main`（无 `--tags`）：tag **根本不进同步面** —— 不报错、**退出码 0**、无任何 tag 提示，
    副本**静默**停在旧 tag。这才是"静默"的那一半。
  - `fetch --tags origin` 而本地已有同名 tag 且对象不同：打一行
    `! [rejected] <tag> -> <tag> (would clobber existing tag)` 略过该 ref，**且该次 fetch 退出码为 1**
    （同一 fetch 里 `main` 照常更新，看着像同步成功）→ 脚本里写成 `fetch … && merge …` 的会在此**断链**。
  - 升级口径（同步块里那两行、**各自独立执行**）实测：`fetch --prune --tags --force origin` → 退出码 0、
    tag 一次性落位；随后 `merge --ff-only FETCH_HEAD` 正常快进。

  后果：`main` 同提交、工作树干净，**只有 tag 落后** —— 落后的 tag 让**重写前**的提交仍经 `refs/tags/*`
  **可达**，而 `privacy-scan` 用 `git log --all` + `for-each-ref` 扫面（悬挂/不可达对象不在扫描面），
  于是副本侧判红（看着干净的副本判不出绿）。处置：`git tag -d <tag>` + `fetch --tags --force` 对齐，
  再按 [privacy.md](agents/privacy.md) 清本机悬挂对象。
- **副本目录名不必等于 `dsh-matt-preset`**（2026-10-17 修）：检出目录名曾是硬约束——
  `tests/verify.mjs` 把生产名 `dsh-matt-preset/x.mjs` 拼到 `<repo>/..` 上，取名 `…-src` 的副本会被
  改写成不存在的兄弟路径，而 loader 的报错把锅甩给插件行（`workflow-core … never started`）。
  现在 `resolveLocalNames` 按**包目录本身**解析前缀名，`tests/verify-harness-paths.mjs` P1–P3 钉住；
  实测改名副本与规范树逐项同结果（数字见 §0.1「msys2 侧全流程验证」）。
- **日常驱动升级的"活面"是 link 面，不是桌面端**：`<DSH_HOME>/profiles/<p>` 以 `link:` 直连权威检出
  （`matt-dev` / `headless`），升级 = 提交后重启该面；**桌面端 profile 由 Electron 应用独占管理，CLI
  装不了**（`error: profile "desktop" is managed exclusively by the Electron application`）——完整
  runbook（升级/检查点/回滚/桌面侧怎么装）见 [RELEASE.md](RELEASE.md)「升级 runbook（link 面）」。

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

### msys2 侧全流程验证（副本拉取之后；2026-10-17 实测）

在副本里跑；工具链组合 = **msys 的 git/sh/tar + Windows 的 node**（上一条的硬约束）：

| 口径 | 命令 | 实测结果 |
| --- | --- | --- |
| 默认套件 | `. ./scripts/msys-env.sh && node scripts/verify-all.mjs` | 与 Windows 默认基线**逐项一致**（25 项用例时 **23/25**） |
| 全流程：安装 → 配置 → 启动 → 建会话 → 真实调用 | 同上 + 下表三件 PATH 件 + `DSH_MATT_INSTALLER=1 DSH_MATT_LIVE_CLI=<src>/apps/cli/lib/bin.js` | **24/25**：`verify-installer` 与 `verify-clean-env-e2e` **零 loud skip**、`verify-live-tool-call` / `verify-live-real-llm` 全绿 |

缺任何一件 PATH 件，安装环就红（`dsh: plugin command failed` → preset 未注册 → 两条 live 报
`Unknown agent preset: dsh-matt-preset`）——**这是环境缺件，不是仓的缺陷**：

1. **Windows node 优先**（`scripts/msys-env.sh` 已覆盖）；
2. **pnpm 所在目录**：`<src>/node_modules/.bin`（`dsh plugin add` 要 shell out 到 pnpm；msys 默认
   PATH 上没有 pnpm）；
3. **Windows 可 spawn 的 `dsh` shim（`.cmd`）**，且 PATH 必须是 **Windows 形态**——实测 msys 形态
   PATH 下 Windows node 的 `spawn('dsh')` 直接 `ENOENT`；只用 POSIX `sh` 脚本 shim 也能到 23/24，但
   installer 的 5 条 profile-link 证明会**静默退化成 loud skip**（`PASS*`），「全流程」验收要用 `.cmd` 口径。

> 形态借自邻仓 `dsh-shell-host`：其 e2e 挂具把 node / 插件目录 / 宿主目录 / pnpm 目录全部走
> **显式 env 参数**（`DSH_E2E_NODE` / `DSH_E2E_PLUGIN_DIR` / `DSH_E2E_HOST_DIR` / `DSH_E2E_PNPM_DIR`），
> 宿主 CLI 直接 `node … apps/cli/src/bin.ts`，**从不依赖 PATH 上的 `dsh`**。本仓的安装环仍依赖字面
> `dsh`（`bin/install.mjs` 的 `mountOrWarn`；`tests/verify-installer.mjs` 的 `dshOnPath` 探针），所以
> msys 侧要 shim；把这份依赖也改成显式参数见 **#83**。

## 0.2 agent shell 的工具链与内联脚本

跑命令的是**模型 shell**，它的 PATH 与登录 shell 不同——以下都是实测教训
（retro 2026-10-16、#56 会话）：

- **`node tests/<file>.mjs` 的依赖锚点是 `tests/node_modules/`，不是仓根**：`@deepseek-ai`（+ `yaml`）
  是 junction → 本机 dsh 安装的 `node_modules/@deepseek-ai`；新 clone / 换机器用
  `node scripts/link-runtime-deps.mjs` 一条命令补齐（D43）。仓根 `node_modules` 只有 `yaml`
  （供插件自身的 `import 'yaml'`）——**据此判"套件跑不了"是误读**：#82 会话的复核轴就因此退化成只读码，
  4 条发现里 2 条本可自己跑用例钉死。
- **`pnpm` 未必在 PATH 上**（现场报 `术语 'pnpm' 不会被识别…`）。验证走
  `node scripts/verify-all.mjs`（唯一入口，不需要 pnpm）；确实要 pnpm / python / node 的
  绝对路径时，用 DSH harness 的 `load_workspace_dependencies`（返回随包分发的路径），
  别假设 PATH 里已有。
- **「本仓验证不需要 pnpm」与「installer 挂载半边需要 pnpm」是两件事，别互相外推**（#86，2026-10-18）：
  - **`node scripts/verify-all.mjs` 默认套件确实不需要 pnpm** —— 这是 #86 AC④ 的不变量，
    常规套件**不得**开始依赖它。`verify-installer.mjs` 里真正需要 pnpm 的只有**挂载产物**那几条
    （profile link / 桌面形态 / e2e），它们在 pnpm 缺席时 `SKIP (loud)` 并计入 `PASS*`；
    `#86 stub` 那组用**假件**（记录 argv 的假 dsh/假 pnpm）离线验参数透传，**任何**机器上都能跑。
  - **`bin/install.mjs` 的挂载那半边需要 pnpm** —— `dsh plugin --profile <p> add <store>` 会让
    plugin-manager 按**字面 `pnpm`** 起子进程（`packages/boot/plugin-manager/lib/index.js` 的
    `runProfilePnpm`：`execa(options.command ?? "pnpm")`，默认 `pnpmCommand: "pnpm"`）。
    所以"套件不需要 pnpm"**不能**读成"装 preset 也不需要"：缺 pnpm 时挂载会**响亮失败**
    （见 §3.1 那张缺件表 —— 其中「dsh 在、pnpm 不在」是独立的一格，硬红）。
  - 两者的桥是 `lib/runtime-probe.mjs`：它把 pnpm 的**四种来源**（`--pnpm` → `DSH_PNPM` → PATH →
    桌面惯例）解析成一条路径，并把「要前置的目录」算出来（脚本形态生成转发 shim）。
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

## 0.3 防线缺席必须响亮（D47）

**规则**：防线缺席时 —— 要么失败、要么打印一行说明；**静默通过视为缺陷**。依据：#55 收尾后 human 指出
`core.hooksPath` 不随 clone 分发、钩子会静默失效（`SKIP_HOOKS=1` 另有显式打印）。

两类会**整体缺席而应用逻辑照常**的防线：

1. 依赖**每 clone 一次的本地配置**：`.githooks/pre-commit` ← `core.hooksPath`；
2. 依赖**环境门禁变量**：`DSH_MATT_INSTALLER` / `DSH_MATT_E2E` / `DSH_MATT_LIVE_*` / `DEEPSEEK_API_KEY`。

**逐条口径**（现状已定，别再逐个重新判断）：

| 防线 | 缺席时的表现 | 口径 |
| --- | --- | --- |
| `core.hooksPath` 未指向 `.githooks` | 此前**完全静默** | **响亮**：`verify-all` 汇总行带 `hooks=<on\|off\|未设置>`（非 on 再加一行补救命令；git 不可用时静默不猜，不改 exit code） |
| `SKIP_HOOKS=1` 主动绕过 | 打印 `pre-commit: SKIP_HOOKS set — 跳过 verify-all` | 已响亮 |
| 环境门禁变量未设 | 汇总 `SKIP` 行 + "N 项因缺环境跳过" | 已显式 |
| 用例内 loud skip | 汇总标 `PASS*` | 已显式 |
| `scripts/link-runtime-deps.mjs` 未跑 | `ERR_MODULE_NOT_FOUND` 硬失败 | 已响亮 + **报错指路**（#69：失败输出含 `ERR_MODULE_NOT_FOUND` 时 `verify-all` 追一行 `node scripts/link-runtime-deps.mjs`；判据 `tests/verify-all-entry.mjs` E7） |
| `package.json files` 条目零展开 | 此前**完全静默**（payload 少发货） | 已立 #66 并修 |

**高危三类**（依赖仓外状态、会真红且难诊断 —— 本清单到这三条为止，其余后议，D29）——
#69 已逐条定口径，现状与守卫落点如下（**别再逐个重新判断**）：

1. **`<DSH_HOME>` 运行时依赖**（插件运行时 node_modules，如 `yaml`）—— 缺失时插件在挂载期抛，
   表象是"安装成功但不用"。**落地**：`ERR_MODULE_NOT_FOUND` 本就是硬失败，再补一行**报错指路**
   （`verify-all` 指到 `scripts/link-runtime-deps.mjs`；判据 `tests/verify-all-entry.mjs` E7）；
2. **技能镜像**（`<DSH_HOME>/skills`）—— 缺失时会话侧技能目录为空，测试看不出来。**落地**：
   镜像不在场时 `tests/verify-skills-mirror.mjs` 打 `SKIP (loud)` → 汇总标 `PASS*`（**响亮**，
   不是静默绿；这条在 #69 之前就已到位）；M1/M2 只在镜像在场时跑，镜像在而无可用技能则硬红。
   #69 补 **M4** 守卫把「响亮」钉住（自跑子进程给一个不存在的镜像路径 → 必须打出 `SKIP (loud)`
   且 exit 0）；
3. **端口 / 实例假设**（3080 / 3090 / 19501 等）—— 占用或未起时用例是**超时**而不是报错。
   **落地**：现役用例一律 `--port 0`（OS 分配）；实例未就绪是 120s 超时**响亮失败**（消息带实例
   stdout/stderr）；turn / 工具等待的 deadline 过后也各自落到 `bad(…)`（带 `within Ns` 或
   projections 读数，不静默）。#69 由 `tests/verify-instance-assumptions.mjs` 静态钉住：
   A1 无非 0 端口 / A2 未就绪必须有响亮出口（**只看代码行，注释不算**）/ A3 扫描面自检 /
   A4 判据自检。

**不做**：汇总行不加 `gates=` 等传感器字段（门禁状态看 `SKIP` / `PASS*` 行即可，D29）。

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
- **`DSH_HOME` 可能就是真实 home**：桌面端把 `%USERPROFILE%\.dsh` 导出进 agent shell，子进程
  原样继承。任何「隔离 / 清理 / 清空 home」的命令都必须先把 `DSH_HOME` 显式覆盖到 `%TEMP%`
  下的目录、并 echo 解析后的绝对路径；**禁止** `Remove-Item -Recurse -Force $env:DSH_HOME`
  这类展开。2026-10-18 事故：一轮命令按 `$env:DSH_HOME` 递归删除，把真实 `~/.dsh` 的用户
  数据整片删掉（会话日志追加写 ENOENT → 宿主退出 → App 用空 home 重建 = 「重置」）。
  安装器现在对 `DSH_HOME` / store 根 / 删除目标做纯路径守卫（`lib/safe-target.mjs`，
  `tests/verify-installer-guards.mjs` 钉住），`scripts/verify-all.mjs` 也会给子进程注入
  临时 `DSH_HOME`；但守卫只覆盖安装器与套件，**手工命令仍靠上面的纪律**。
- **只读自动变量陷阱（第三次事故的直接机制，2026-10-18）**：手工造沙箱 home 的那段
  PowerShell 用了 `$home` 作变量名，而 `$HOME` 是 PowerShell 的**只读自动变量**（大小写不敏感）
  ——赋值是**非终止错误**（stderr 一行，脚本继续），`$home` 仍是真实 profile；随后
  `New-Item $home` 因目标已存在而失败，**沙箱 home 从未建出来**，`Join-Path $home '.dsh'` /
  `$env:DSH_HOME` 静默指向真实 home，收尾按环境变量展开的递归删除删掉了真实 `~/.dsh`。
  所以：临时目录变量**换名**（`$tmpHome`），删除目标只能是**本条命令自己建出来的路径**。
  这个坑相邻工作区（`dsh-ops`）的 CI 工作流里早已写明并留了注释（该仓
  `.github/workflows/ci.yml` 的 hermetic 步骤）：
  「Not `$home`: that name is PowerShell's own read-only variable for the user profile, so
  assigning to it fails this step before the suite ever runs」——即"别用 `$home` 这个名字：
  它是 PowerShell 自己的只读变量，赋值会让这一步在套件跑起来之前就失败"），同一处还提醒
  `[System.IO.Path]::GetTempPath()` 可能与 Node 的 `os.tmpdir()` 不一致、应改用两边都认的
  `$env:RUNNER_TEMP`。
- **别手写这段 PowerShell**：需要一条命令跑在隔离 home 里时，用
  `node scripts/with-temp-home.mjs -- <cmd…>` —— 它在 `os.tmpdir()` 下 `mkdtemp`、**建之前**
  过 `assertSafeTempHome`、**删之前再过一次**、且只删自己建的那一个路径（不是任何环境变量的
  再解析）；子进程拿到 `DSH_HOME=<那个路径>`、stdio 继承、退出码透传，缺 `--` / 空命令时
  **响亮失败**。守卫纯函数由 `tests/verify-temp-home-guard.mjs` 钉住。
  `workflow-enforcer` 另认「删除动词 + home 目标」的组合（`HOME_DELETE_TRIGGER`）并提醒一次
  —— **只提醒、不拦截**，不是物理防线（真正的拦截要 harness 侧 pre-tool hook，#113 边界）。

## 2. 宿主锚点（ADR-0008）

跟随 DSH 运行时 **rc 线**（latest 通道）：本仓 `0.2.1-rc.2-r1` ↔ 宿主 tag
`dsh-v0.2.1-rc.2`。**浅克隆默认分支会落到 alpha 系**（实测 `dsh-v0.2.1-alpha.4`），
与锚不符 —— 必须显式 checkout tag。

| 锚 | 宿主 tag | tag 指向的 commit | 落地 |
| --- | --- | --- | --- |
| **当前** | `dsh-v0.2.1-rc.2` | `687f282e` | 本条（2026-10-17，rc.2 追加） |
| 上一锚 | `dsh-v0.2.1-rc.1` | `1600d8a1` | #88（2026-10-17） |
| 上二锚 | `dsh-v0.2.0-rc.2` | `639ed015` | #42/#22 线 |

**rc.1 → rc.2 的漂移面（2026-10-17 实测，避免下次重锚重复取证）**：rc.2 相对 rc.1
是**纯追加**，对本仓**零影响** ——
- 内容仅两项：适配 `DeepSeek-V4.1-Flash-1017` + 适配 DeepSeek Search/Fetch API
  （`gh release view dsh-v0.2.1-rc.2`）。
- **本仓依赖的包（`packages/core` / `preset` / `llm`）零 src 改动**：`gh api …/compare/dsh-v0.2.1-rc.1...dsh-v0.2.1-rc.2` 过滤 `^packages/(core|preset|llm)/` 且含 `src/|tests/` → **空**；
  整个 delta 里这些包只有 `package.json` 版本号 bump。
- 新增面是**上游自己的**：`packages/client/ui-deepseek-model-label-1017`（新 UI 包）、
  `ui-settings-web-search` 改动、`docs/persistence-changes/2026-10-13-deepseek-search-thinking`。
- ⇒ 本仓**无契约适配工作**（无 persona/挂具/enforcer 改动）；重锚只是版本线三段同步。

**上游 upgrade-guide 取证的边界（实测，勿再假设）**：截至 rc.2，`docs/upgrade-guide/` 下
**最新只到 `v0.2.1-alpha.4`** —— **没有 rc.1 / rc.2 的 guide**（master 与两个 rc tag 上列的
都是同一份清单）。#87 票面写的「0.2.1 线 34 篇」在 rc 线上**不成立**，rc 间的漂移取证应改用
**release notes + compare API**（本条即按此取证）。

（§0.0 那张 tag↔hash 表记的是 2026-10-16 隐私重写时的**历史对象**，与本表是两回事，勿混用。）

## 3. 源码部署步骤（msys2 侧）

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git <src>
cd <src> && git fetch --depth 1 origin tag dsh-v0.2.1-rc.2 && git checkout tags/dsh-v0.2.1-rc.2
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
（该 tag 已于 2026-10-17 前移至 `dsh-v0.2.1-rc.1`，当日再前移至 `dsh-v0.2.1-rc.2`，见 §2；本条其余结论是当时实测，仍然成立。）
把"PATH 无 dsh"读成"本机没有 dsh / 有 dsh 那半边无法验证"是**错的**：#67 会话据此把
`verify-installer` 的 4 条 link 断言判成"本机不可验证"，写进了已 push 的 commit。

| 用途 | 命令 |
| --- | --- |
| 起实例（与仓外 `start-matt-dev.sh` 同口径） | `cd <src> && node --import tsx/esm apps/cli/src/bin.ts --profile <p> …`（**cwd 必须是 `<src>`**，否则 `--import tsx/esm` 解析不到 tsx） |
| 跑 CLI（构建产物，cwd 无关） | `node <src>/apps/cli/lib/bin.js --profile <p> …`；`--version` 应为 `0.2.1-rc.2` |

**PATH 型工具**（`bin/install.mjs`、测试里的 dsh 探针）现在走**运行时探测**（`lib/runtime-probe.mjs`，
#47/#86），不再硬依赖字面 `dsh`：

```powershell
$env:DSH_MATT_INSTALLER='1'; node tests/verify-installer.mjs   # → 15/15、exit 0
```

**探测顺序（dsh 与 pnpm 同构，`lib/runtime-probe.mjs` 的纯函数、可注入测试）**：

| 顺序 | dsh | pnpm | 说明 |
| --- | --- | --- | --- |
| 1 | `--dsh <path>` | `--pnpm <path>` | 显式参数说了算；给了就不回落其它来源 |
| 2 | `DSH_MATT_DSH` | `DSH_PNPM`（别名 `DSH_MATT_PNPM` 亦认） | 脚本 / CI 的稳定出口 |
| 3 | PATH（`dsh.cmd`/`dsh.exe`/`dsh`） | PATH（`pnpm.cmd`/`pnpm.exe`/`pnpm`） | 平台候选名按 PATHEXT 惯例 |
| 4 | `DSH_DESKTOP_ROOT` → `<root>/resources/runtime/cli/bin/dsh.cmd` | `<root>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs` | 桌面安装版惯例；**`DSH_DESKTOP_ROOT` = 桌面应用根目录**（含 `resources` 的那一层）。设成 `<app>/resources` 也认 —— 该档对每个候选都试「先 `<root>/resources/…`、再 `<root>/…` 回落」两种读法，实测两种读法收敛到**同一条真实路径**（2026-10-18）；档位顺序不变，回落只在**本档内**发生 |
| 5 | `DSH_MATT_DSH_SRC` → `<src>/apps/cli/lib/bin.js`（**经 `node` 跑**） | — | 源码检出惯例 |

**pnpm 的那半边与 dsh 不同，三点必须分清**：

1. **形态可能是 `.cjs` 而不是可执行**：harness 把 pnpm 作为依赖分发
   （`<root>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs`，与 `pnpm.mjs` 同目录），
   直接 exec 会失败。故 `pnpmPathInjection()` 对脚本形态**在临时目录生成转发 shim**
   （`pnpm.cmd` + `pnpm`，内容转发到 `node <path>`），把 shim 目录前置进 `dsh` 子进程的 `PATH`；
   对本来就是可执行（`.cmd`/`.exe`/无后缀）的形态，直接前置它**所在目录**。
   两者对外统一成「一个目录 + 该目录里有名为 `pnpm` 的可执行」。
2. **只要求「真要挂载」那一步**：`--version` / `--root`（纯 store）**不**需要 pnpm（#86 AC④）；
   `dsh plugin add|rm` 才需要（plugin-manager 按字面 `pnpm` 起子进程）。
3. **注入的是子进程 `PATH`，不是环境变量**：`DSH_PNPM` 只是**探测来源**。经 `dsh plugin add` 往下走的
   pnpm 子进程 env 由 plugin-manager 组装（`packages/boot/plugin-manager/lib/index.js` 的
   `runProfilePnpm`：`execution:'cli'`（CLI 安装）用 `{...process.env, ...options.env}`；
   `execution:'service'`（GUI / 服务侧的 `install_bundle`）用 `scrubbedParentEnv()`），
   而 `scrubbedParentEnv()`（`@deepseek-ai/dsh-subprocess`）会**过滤掉所有 `DSH_*` 前缀的键** ——
   所以「把路径塞进 `DSH_PNPM` 就能一层层传下去」在**服务路径上不成立**；
   **`--pnpm` 与 `PATH` 前缀注入是两条路径都活的**做法。（`DSH_PNPM` 对**我们这一层**仍然有效：
   它是 installer 自己解析 pnpm 用的来源之一。）

**缺件时的表现（D47：防线缺席必须响亮，且不与「preset 坏了」混淆）**：

| 缺谁 | installer 的行为 | 退出码 |
| --- | --- | --- |
| dsh 未命中 | 保留前缀 `dsh not found on PATH — skipped profile mount` + 一行 `missing dsh — 给一条即可: --dsh … \| DSH_MATT_DSH …`；store 照落、profile 不动 | **0**（响亮降级，不是失败） |
| dsh 命中、pnpm 未命中 | 一次可执行的失败：`missing pnpm — …（不是 preset 坏了）` + `--pnpm` / `DSH_PNPM` 指路 | **1** |

**「dsh 在、pnpm 不在」是一个独立的格子，别与上面第一行混**（2026-10-18 Lead 拍板 B）：

- 它是**真实存在的机器形态** —— 实测 `dsh --version` / `dsh plugin --list` 都**不需要**同级 pnpm，
  只有 `dsh plugin add` 内部起 pnpm 才需要（`packages/boot/plugin-manager/lib/index.js` 的
  `runProfilePnpm`，`execa(options.command ?? "pnpm")`）。
- installer 在这里**硬红（exit 1 + 一行指路）** 是**有意为之**：此时 dsh 已经在手、差的就是那一件，
  静默落 store 会让用户以为装上了。**store 侧仍然落盘**（失败点只在挂载那半边）。
- 对应地，`tests/verify-installer.mjs` 的**挂载断言**在这个格子上**响亮跳过**（`SKIP (loud)`，
  理由串独立写 `needs pnpm for the mount step (#86)` —— 与缺 dsh 的理由串分开，成因不同、混用会让
  读数骗人）。套件**不**替 installer 兜底判红：installer 自己的行为已经被
  `#86 stub perturbation: with no pnpm reachable at all the installer dies with a runnable hint` 钉住。

**三档读数（2026-10-18 实测，`DSH_MATT_INSTALLER=1 node tests/verify-installer.mjs`）**：

| 档 | 机器形态 | 读数 |
| --- | --- | --- |
| 1 | 无 dsh、无 pnpm（默认） | **16/16 通过、exit 0、无 FAIL**；loud skip 逐条打印（profile-link / 桌面形态 / e2e / live 桌面端） |
| 2 | pnpm 在场（`DSH_PNPM`）、无 dsh | 同上；`· pnpm probe on THIS machine: found=true (env)` |
| 3 | dsh（PATH shim）+ pnpm 都在场 | **17/17 通过、exit 0、零 loud skip** —— 挂载断言**真的全跑了**（这是"门禁没有过度跳过"的证明） |
| 4 | `DSH_DESKTOP_ROOT` 指桌面安装版（dsh+pnpm 都由它提供） | **18/18 通过、exit 0、零 loud skip**，含 live 桌面端用例（真 `dsh.cmd` + 真 `pnpm.cjs` 走转发 shim 挂载成功） |

档 3/4 的"零 loud skip"是关键：若门禁写错（例如恒假），档 1 的读数看起来一样 —— 所以
`#86 gate counter-case` 用例把 `mountable` 逐格对齐两个探测结果，并断言"pnpm 在场 ⇒ 挂载步骤真的走到"。旧口径的 shim 写法仍然可用（PATH 上加一个临时目录放 `dsh.cmd`，`<src>\node_modules\.bin` 提供 pnpm）；
新口径下更省事的是直接给显式参数：

```powershell
$env:PATH = "<shim 目录>;$env:PATH"                     # 或用 --dsh / DSH_MATT_DSH 代替
dsh --version                                           # → 0.2.1-rc.2
$env:DSH_MATT_INSTALLER='1'; node tests/verify-installer.mjs
$env:DSH_DESKTOP_ROOT='<app>'                          # 桌面应用根（含 resources 的那一层）→ 开 live 桌面端用例；设成 <app>\resources 也认
$env:DSH_MATT_LIVE_CLI='<src>\apps\cli\lib\bin.js'; node tests/verify-clean-env-e2e.mjs   # #75 全链：临时 home → bin/install.mjs → 启动 → 建会话 → turn（16 环）
```

实测结果（2026-10-16，装上包装后）：`verify-installer.mjs` **11/11、零 loud skip**（此前 4 条 link
断言 + e2e 全是 loud skip）；`node scripts/verify-all.mjs` 里 `verify-installer` 由 `PASS*` 变
**`PASS`**（#67 时基线 20/21；#75 加入 `verify-clean-env-e2e.mjs` 后为 **21/22**，无 dsh 时 20/22）。
`verify-clean-env-e2e.mjs` **16 环全绿、exit 0、零 loud skip**（#75）。非空洞四处（均已回退）：store
路径偏差 → 安装环 A1/A2/A3 红；去掉 profile link → A3/B1/C1 红；去掉载体的 workflow-core loader row →
B1/D1 红；把实例改到保留口 → B5 红。
**有 dsh 那半边在本机可验证——别再默认"跳过了事"。**
（#47/#86 之后用例数与门禁口径变了：见下面这条的当前读数。）

**#86 起 pnpm 半边也能离线验**（2026-10-18）：`verify-installer.mjs` 用**记录 argv 的假 dsh / 假 pnpm**
（`dsh.cmd` → `node dsh-stub.cjs %*`，两者都落在系统临时目录里 —— 注意 Windows 上 `.cmd` shim **不能**
放在含空格的路径下）断言参数透传与 PATH 注入，不需要本机有任何运行时；另有**非空洞对照**
（探测不到 pnpm → 必须 die 且给可执行指路；相对 `--dsh` → 证明"绝对路径"判据可红；注入目录里没有
`pnpm` 这个名字 → 假 dsh 的 `spawn('pnpm')` 必须失败；**门禁对照** → `mountable` 逐格对齐两个探测结果）。
当前读数见上文「三档读数」表（无 dsh 基线 16/16；dsh+pnpm 都在场 17/17；桌面根 18/18，后两档**零 loud skip**）。

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
3. **RC2 的构建接口**：**DSH 源码树**的 `<src>/scripts/build.ts` 用 `--profile`（alpha HEAD 是
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