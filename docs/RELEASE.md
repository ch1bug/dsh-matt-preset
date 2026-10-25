# Release — 版本锚定与安装（#21）

## 版本锚定方案（family scheme `dsh-v<official>-<r|a><N>`，双通道，ADR-0008）

三段一一对应，同一 commit 上同时成立：

| 通道 | git tag | npm version（tag 去 `dsh-v` 前缀） | 例 |
|---|---|---|---|
| latest（跟 RC） | `dsh-v<official>-r<N>` | `<official>-r<N>` | `dsh-v0.2.1-rc.2-r1` ↔ `0.2.1-rc.2-r1` |
| next（跟 alpha） | `dsh-v<official>-a<N>` | `<official>-a<N>` | `dsh-v0.2.1-alpha.1-a1` ↔ `0.2.1-alpha.1-a1` |
| 打包产物 | `npm pack` → `dsh-matt-preset-<npm version>.tgz` | 同左 | `dsh-matt-preset-0.2.1-rc.2-r1.tgz` |

`<official>` 对齐 DSH 运行时版本（当前 0.2.1-rc.2）；同一 official 上的 preset
迭代递增 `<N>`。通道节奏参考上游 DSH 分发：latest 跟 RC（按需重锚，不做空转
bump），next 跟 alpha；next 版本不进 latest 升级路径。
安装副本的 `VERSION.json` 记录 npm version + 安装时间 + 来源（source/dir/tarball）。

## 发布流程

```bash
npm version <official>-r<N>   # 写 package.json
git tag dsh-v<official>-r<N>
git push --tags               # push 属外部操作，走批末/human 门
npm pack                      # 产物即安装源；npm publish 由 human 拍板（package.json 仍 private）
```

## 安装 / 升级 / 回滚 / 卸载（copy-installer，bin/install.mjs；#41 起本节为安装事实源）

```bash
npx --allow-git=all github:ch1bug/dsh-matt-preset install   # 新用户一条命令；npm 默认禁 git 源 fetch（EALLOWGIT，故需 allow-git；取值随 npm 版本而异，见 npm 文档），等价于以下任一形式
node bin/install.mjs install                 # 默认从本仓源码安装（包发布后可 npx .）
node bin/install.mjs install --from dsh-matt-preset-0.2.1-rc.2-r1.tgz   # 从 tarball
node bin/install.mjs install --from /path/to/checkout                   # 从源码目录
node bin/install.mjs install --root <dir>           # 默认 root = $DSH_HOME/.agent-presets
node bin/install.mjs install --profile <name>       # 默认挂到 profile web；layer 不存在时自动创建
node bin/install.mjs upgrade  [--from …]            # 原地替换（stale 文件清除，记录 previousVersion）
node bin/install.mjs uninstall [--profile <name>]   # 默认摘 profile web 的 link + 清 store（语义见下「卸载」条）
node bin/install.mjs --version
```

### 运行时从哪来（#47/#86：`--dsh` / `--pnpm`）

安装分**两段**：第一段把文件拷进 store（不需要任何外部工具），第二段经
`dsh plugin --profile <p> add <store>` 把 store 链进 profile —— 这一段要**两个工具**。
两者都按同一张顺序表解析（细节见 [dev-environment.md](dev-environment.md) §3.1）：

| 顺序 | dsh | pnpm |
| --- | --- | --- |
| 1 | `--dsh <path>` | `--pnpm <path>` |
| 2 | `DSH_MATT_DSH` | `DSH_PNPM`（别名 `DSH_MATT_PNPM` 亦认） |
| 3 | PATH（`dsh.cmd`/`dsh.exe`/`dsh`） | PATH（`pnpm.cmd`/`pnpm.exe`/`pnpm`） |
| 4 | `DSH_DESKTOP_ROOT` 下的 `<root>/resources/runtime/cli/bin/dsh.cmd` | `<root>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs` |
| 5 | `DSH_MATT_DSH_SRC` 下的 `<src>/apps/cli/lib/bin.js`（经 `node` 跑） | — |

```bash
# 显式覆盖（推荐给脚本 / 非默认布局）
node bin/install.mjs install --dsh "<dsh 可执行路径>" --pnpm "<pnpm 可执行或 pnpm.cjs>"
# 桌面安装版：一条命令覆盖桌面端。DSH_DESKTOP_ROOT = **应用根**（含 resources 的那一层）
node bin/install.mjs install --profile desktop --dsh "<app>/resources/runtime/cli/bin/dsh.cmd" \
  --pnpm "<app>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
```

- **pnpm 只在真要挂载时要求**：`--version`、`--root`（纯存储）不需要它（#86 AC④）。
- **两个工具都缺席时的表现不同，别混说**：dsh 未命中 → **响亮降级**（store 照落、profile 不动，
  打印 `dsh not found on PATH — skipped profile mount` + 一行指路，**exit 0**）；pnpm 未命中 →
  一次**可执行的失败**（`missing pnpm …` + 一行指路），因为此时 dsh 已经在手、差的就是那一件（#86 AC①）。
- harness 分发的 `pnpm` 是 `*.cjs`（不是可执行）：installer 会在临时目录生成转发 shim
  （`pnpm.cmd` + `pnpm`）再把它前置进 `dsh` 子进程的 `PATH` —— 所以 `--pnpm` 直接指 `.cjs` 就行。
- 第 4 档的 `DSH_DESKTOP_ROOT` 按**桌面应用根目录**（含 `resources` 的那一层）写；设成
  `<app>/resources` 也能识别（该档对本档候选做了回落），但契约口径是前者。

- **fresh install**：一条命令把 payload（preset.yml / agent.cordis.yml / 插件 *.mjs /
  skills/ / lang-packs/ / sandcastle/）+ 运行时依赖（node_modules/yaml，插件
  `import 'yaml'` 的解析锚点是插件文件自身）拷入 `<root>/matt/`，写 VERSION.json +
  manifest.json。
- **升级**：`upgrade` 原地替换；manifest 记录被替换的旧版本。
- **回滚**：重装旧版本包（旧 tag ↔ 旧 npm 版本一一对应）：
  `install --force --from dsh-matt-preset-<旧版本>.tgz`。
- **卸载**：`uninstall [--profile <name>]`（默认 profile `web`，与 install/upgrade 同）先摘
  profile link 再清 store——摘 link 走 `dsh plugin --profile <p> rm dsh-matt-preset`
  （profile 层里本就没有该 link 时跳过、不报错）；dsh 未命中时**响亮降级**（exit 0）：
  store 照删、profile link 原样保留（stale），并打印手动命令
  `dsh plugin --profile <p> rm dsh-matt-preset` 收尾。`--root`（store-only）下只清 store、
  不碰任何 profile。桌面端完整卸载示例见下文「回滚」节（`uninstall --profile desktop`）。
- 已知风险：install/upgrade 先清空目标再拷入，拷贝中途失败会破坏旧安装（无原子
  swap）；此时用 `install --force --from <旧版本>.tgz` 重装即可恢复。

## 与 profile 挂载的关系（两段式）

installer 只负责把文件放到位（preset root 侧）；把装好的 preset 挂进 dsh 会话属
profile 侧（ADR-0001 形态）：profile 的 package.json 以 `link:` 依赖指向安装目录
（`"dsh-matt-preset": "link:<root>/matt"`），经 `dsh.profile.bundles` 挂载
cordis.patch.yml。DSH 0.2.0-rc 起 preset 注册表**不做目录扫描**——放进
`.agent-presets/` 不会被自动发现（旧「自动发现」约定仅对 `dsh-agent-presets`
宿主有效），必须走 bundle patch 挂载。插件行 `dsh-matt-preset/x.mjs` 按包名经该
link 解析——包名 `dsh-matt-preset` 与插件命名空间刻意一致，勿改。

安装/升级后重启 `dsh --profile <p>`（或新开会话）生效，hero-chip 选择
"Matt 工作流"。

## 升级 runbook（link 面：日常驱动的"活面"）

上两节讲的是 **payload 面**（installer 拷贝 + 版本戳，适合发布/冻结版本）。
日常"驱动后续升级"用的是另一条路：**profile 直接 `link:` 指向权威检出**，于是
每次提交都成为候选版本，升级 = 让该面重新装载。2026-10-17 实测的两个 live 面：

| 项 | 值（机器本地状态记在 `<DSH_HOME>/profiles/<p>/REGISTRY.md`） |
| --- | --- |
| 面 | profile `matt-dev`（web，端口 19501；另有 `headless` 一个无 web 面的同款 link 面）|
| DSH_HOME | `~/dsh-matt-home`（msys 侧；与桌面端 `%USERPROFILE%\.dsh`、邻仓 home 完全隔离）|
| 挂载 | `"dsh-matt-preset": "link:<repo>"`（**直连权威检出，无副本 → 无漂移**）|
| 启动 | `<DSH_HOME>/start-matt-dev.sh`（构建脚本 `build-matt-dev.sh`；日志 `<DSH_HOME>/instance.{out,err}.log`）|
| 运行时 | msys 侧源码部署 `<src>`（`<src>/apps/cli/lib/bin.js`，tag 见 REGISTRY.md）|

**升级（link 面）**：权威树 `verify-all` + `privacy-scan` 绿（pre-commit 已强制）→ `git push` →
`<DSH_HOME>/start-matt-dev.sh` 重启该面 → 检查点：

```bash
DSH_HOME=~/dsh-matt-home node <src>/apps/cli/lib/bin.js --profile matt-dev --dump-config \
  | grep -n 'dsh-matt-preset'      # 期望见 `# == dsh-matt-preset` 与 `preset-dsh-matt-preset` 行
```

（`--dump-config` 是只读组合树 dump，实测 exit 0 / 1479 行、含 workflow-core 行即为装好。）

**回滚（link 面）**：把权威树切回上一个绿提交再重启该面。**注意**：权威树同时是 agent 的
工作树，切提交会打断正在写它的会话 —— 回滚要么在无会话写它时做，要么改用 payload 面
（上一节的 `install --force --from <旧版本>.tgz`）。

**桌面端（`desktop`）的 `--dump-config` 用不了，但 `plugin add` 能用**：profile 由 Electron 应用
独占管理，CLI 的**只读 dump** 被直接拒绝 ——

```text
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

但**写入路径（`dsh plugin --profile desktop add|rm`）不被独占**，`bin/install.mjs` 走的正是这条
（见下节「桌面端（`desktop` profile）：迁移与回滚」——**一条命令**即可覆盖桌面端）。
日常 GUI 里还有另一条路（Plugins 页 / `plugin_manager` 工具的 `install_bundle` / `set_bundle`），
形态与桌面既有的 `link:` 依赖一致；装完用应用自述确认活行（Host Inspect 的
`Config.listConfigs`, `patchId: "preset-dsh-matt-preset"`，`total: 0` = 没装上）。
那条路是**外部动作**（改的是日常 profile）。0.2.1 起，在**跑 HMR 的 profile** 上（本机桌面
profile 实测确认：活组合树 `include:hmr` = `schema`，#90 票面取证）`install_bundle` 对**已装**包
直接 `application: 'failed'` + `error.code: 'already-installed'`（旧版是 `restart-required` 后旧版本
继续跑），故重装（覆盖已装包，如 bundle 形态按 #76 拍板改变后）必须先 `remove_bundle` 再
`install_bundle`。另一条可继承的桌面行为（2026-10-17 实机，#88）：桌面端更新会自动清理**退休的
experimental bundle 选择**——schedule 的实验档（`dsh-experimental-…`）已从
`dsh.profile.bundles` 消失，任务数据保留。

**只让绿树成为 live**：link 面没有"安装"这道闸，权威树的任何状态都会直达该面。故约定
升级前跑唯一入口（`node scripts/verify-all.mjs`）与 `privacy-scan`——`.githooks/pre-commit`
已经把二者绑在提交上，绕过它（`SKIP_HOOKS=1`）就意味着把未验证的树推给 live 面。

## 桌面端（`desktop` profile）：迁移与回滚（#47 AC，2026-10-18 #99 落盘）

本节是桌面形态的**迁移 runbook**（此前只有上一节的"不能 CLI 装"一句，没有可执行步骤）。

### 形态事实（实测，勿再假设）

| 项 | 事实 |
| --- | --- |
| `--dump-config` | **不可用**：`dsh --profile desktop --dump-config` → `error: profile "desktop" is managed exclusively by the Electron application` |
| `dsh plugin --profile desktop add|rm` | **可用** —— 装载的写入路径不被独占；`bin/install.mjs` 走的正是这条 |
| profile 层 | `<DSH_HOME>/profiles/desktop/package.json`（`dependencies` + `dsh.profile.bundles`）|
| 稳定存储 | `<DSH_HOME>/.agent-presets/matt`（与 web/headless 面**同一路径**，已统一）|
| 认行 | 按 **`patchId: "preset-dsh-matt-preset"`** 认，**不要按 `name`** —— 该行 `name` 恒为 `@deepseek-ai/dsh-agent-preset`（与内置 preset 同包），按 `dsh-matt-preset` 查**恒返回 0**（实测踩过）|

### 迁移（一条命令）

```bash
node bin/install.mjs install --profile desktop            # fresh
node bin/install.mjs upgrade --profile desktop            # 已有安装，原地替换
node bin/install.mjs install --profile desktop --dsh "<dsh 路径>" --pnpm "<pnpm 路径>"   # 运行时不在 PATH 上时
```

装完**重启应用**（或新开会话）生效，在 hero-chip 选择模式。

> 运行时（dsh / pnpm）不在 PATH 上时**不要**手工拼 `dsh plugin` 命令：`--dsh`/`--pnpm` 就是为这件事
> 准备的，缺件时 installer 会给一行可执行的指路（#86）。探测顺序见本节上文「运行时从哪来」。

> **#99 起 hero-chip 有 4 个 matt 模式**（`Matt 工作流` / `· PTC` / `· 精简` / `· Cordis`）——
> 一个插件（`dsh-matt-preset`）、四份 preset patch（`presets/*.patch.yml`），
> 装一次全有、卸一次全清（ADR-0015）。从 #99 之前的版本升级时，**必须用 `upgrade`
> 重装一次**：`dsh.bundle.patch` 由单文件变数组属**载体形态变化**，旧的 profile 层缓存
> 不会自己重新解析。

### 旧 store 分叉的迁移（#47 AC④，2026-10-18）

**症状**：桌面 profile 的 link 指向 `<DSH_HOME>/.agent-presets/dsh-matt-preset`，而 installer 写的是
`<DSH_HOME>/.agent-presets/matt` —— 两边不是同一个目录，于是 **installer 怎么升级都更新不到桌面端**
（`upgrade` 报成功，桌面端却一直是旧的那份）。

**形态自 2026-10-17 起已统一**（两边都是 `.agent-presets/matt`），但旧机器上那个分叉 store 目录
**不会自己消失**；桌面 link 若仍指着它，`upgrade` 依旧写不进去。故迁移分三步，**先读后改再删**。

#### 第 1 步：判定是否分叉（只读）

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh"        # 桌面端 home（显式写出，不要靠继承）
node -e "const p=require(process.env.DSH_HOME+'/profiles/desktop/package.json');console.log(p.dependencies['dsh-matt-preset'])"
```

- 输出 `link:<DSH_HOME>/.agent-presets/matt` → **未分叉**，跳到第 3 步收尾。
- 输出 `link:<DSH_HOME>/.agent-presets/dsh-matt-preset` → **分叉现场**，继续第 2 步。

#### 第 2 步：重装，让 link 改指正确 store

```powershell
# 一条命令覆盖桌面端（运行时按 §「运行时从哪来」那张表解析；也可显式 --dsh/--pnpm）
node bin/install.mjs install --profile desktop --force
```

`--force` 是必须的：store 目录已存在时 installer 会拒绝覆盖（`already installed`）。

#### 第 3 步：复验 + 清理遗留目录

```powershell
# 3a) 复验 link 已改指（期望 …\.agent-presets\matt）
node -e "const p=require(process.env.DSH_HOME+'/profiles/desktop/package.json');console.log(p.dependencies['dsh-matt-preset'])"
# 3b) 确认 store 的版本戳与 package.json 一致
node -e "console.log(require(process.env.DSH_HOME+'/.agent-presets/matt/VERSION.json').version)"
node -e "console.log(require('./package.json').version)"
```

**判据**：3a 的输出是 `link:<DSH_HOME>/.agent-presets/matt`，3b 两个版本号相同，重启应用后
hero-chip 出现 4 个 matt 模式。

遗留目录的删除是**外部动作**（`rm -rf`），**必须人工确认路径后再执行** —— installer 的
`uninstall` 只清自己的 store，不管这个旧目录。下方脚本是**自守卫的 dry-run**：`DSH_HOME` 未设置
就报错退出；默认只打印解析后的绝对路径，加 `CONFIRM=1` 才真删。2026-10-18 事故的教训是：
手工 `rm -rf <DSH_HOME>/…` 模板一旦把占位符展开错（例如展开成用户 profile 根），删掉的就是真实数据。

```powershell
node -e "const {rmSync,existsSync}=require('node:fs');const {join}=require('node:path');const h=process.env.DSH_HOME;if(!h)throw new Error('DSH_HOME not set — stop');const p=join(h,'.agent-presets','dsh-matt-preset');console.log('legacy store:',p);if(process.env.CONFIRM!=='1'){console.log('dry-run — 人眼确认路径后加 CONFIRM=1 重跑');process.exit(0)}if(existsSync(p))rmSync(p,{recursive:true,force:true});console.log('removed')"
# 确认打印的路径无误后：$env:CONFIRM='1'; 再跑同一条命令
```

**机械断言**：`tests/verify-installer.mjs` 的
`install/upgrade --profile desktop: link points at THIS store, stamp agrees` 用例把本条第 1 步与
第 3a 步的判据钉死 —— 它把 profile 依赖值**解析成绝对路径**，与 installer 实际写入的 store 比对
（光看"有没有 link"抓不到分叉，两条路都有 link，只是指向不同目录），install 与 upgrade 各验一遍。
该用例与其他 profile-link 断言共用 `#67`/`#86` 的口径：**PATH 上没有 `dsh` 时响亮跳过**
（`SKIP (loud)`，verify-all 记为 `PASS*`），不硬崩、也不静默当通过。

### 回滚

1. **回滚到 #99 之前的形态**：`node bin/install.mjs install --force --from dsh-matt-preset-<旧版本>.tgz --profile desktop`
   （旧 tag ↔ 旧 npm 版本一一对应，见上文"升级/回滚"节）→ 重启应用。
2. **只回滚到上一个绿提交（payload 面）**：同上，换成该提交打的 tarball。
3. **完全卸下桌面端**（四模式同时消失、无残留）：

   ```bash
   node bin/install.mjs uninstall --profile desktop      # 摘 profile link + 清存储目录
   ```

   验收：`plugin_manager` / 插件视角**不再有** `dsh-matt-preset` 条目，roster 里**四个 matt 模式同时消失**；
   官方四个模式（`standard`/`ptc`/`minimal`/`cordis`）**仍在**（本 preset 从不改它们）。

### 桌面形态的机械断言

`tests/verify-installer.mjs` 有对应用例：

- `install/upgrade --profile desktop: link points at THIS store, stamp agrees`（#47 AC③）——
  `--profile desktop` 跑 install **与** upgrade，断言 profile 的
  `dependencies` 与 `dsh.profile.bundles` 都含 `dsh-matt-preset`，且 **link 解析出的目录 ==
  `<DSH_HOME>/.agent-presets/matt`**（分叉判据）+ store 版本戳与 `package.json` 版本一致。
- `#86 stub: dsh plugin add receives the resolved dsh path + injected pnpm dir on PATH`（#86 AC②）——
  用**记录 argv 的假 dsh / 假 pnpm**（离线，不需要本机有任何运行时）断言
  `plugin --profile web add <store>` 逐项透传、用的 dsh 是 `--dsh` 给的那个、以及
  `pnpmPathInjection()` 的目录真被前置进子进程 PATH；假 dsh 还会模拟 plugin-manager
  按字面 `pnpm` 起子进程，断言那一步真的命中假 pnpm。
- `#86 live: real dsh + real pnpm.cjs (a *.cjs through the forwarding shim) mounts the store`——
  真运行时端到端；门禁 `DSH_MATT_DESKTOP_ROOT=<app>/resources`，未设则 `SKIP (loud)`。

这些用例与其他 profile-link 断言共用 `#67` 的口径：**PATH 上没有 `dsh` 时响亮跳过**
（`SKIP (loud)`，verify-all 记为 `PASS*`），不硬崩、也不静默当通过。

## 版本条目（Changelog）模板（ADR-0007）

规范：每个版本条目只描述与上一个 tag 的 diff，收录标准 = **升级用户是否会注意
到**。正反例与批次模式一致性见 [adr/0007-changelog-release-convention.md](adr/0007-changelog-release-convention.md)。条目在打 tag 时写，不逐票更新。

```markdown
## dsh-v<official>-r<N>（<npm version>）

### 注意到（升级用户视角）
- <破坏性变化 + 迁移路径>（如有，必写并指向对应 RELEASE.md 节）
- <新增/删除的命令、插件行为、skill、安装方式变化>
- <persona/工作流门禁对会话行为的变化>

### 锚
tag `dsh-v<official>-r<N>` · npm `<official>-r<N>` · 产物 `dsh-matt-preset-<npm version>.tgz`
```

不写：分支迭代过程、重构史、已发布内容重写、未随本 tag 推送的工作。条目落点 =
下一节「版本条目（Changelog 落地区）」，**不另建 CHANGELOG.md**（#91 起落点已选
RELEASE.md 支，D40/ADR-0007 同步；一处落地区，避免第二份条目副本漂移）。

## 版本条目（Changelog 落地区，ADR-0007/D40）

> 落地时机 = 打 tag 时（不逐票更新，D40）。下方 `dsh-v0.2.1-rc.2-r1` 条目文本已备齐
> （#91，2026-10-25，锚从 `package.json` 推导 = `0.2.1-rc.2`）；tag/push 属外部动作，
> 由 human 执行。打 tag 时若树上又有升级用户可见的新变化，按同一收录标准补行。

### dsh-v0.2.1-rc.2-r1（0.2.1-rc.2-r1）

#### 注意到（升级用户视角）

- **锚点变更（先升运行时）**：本 preset 锚定的 DSH 运行时从 `0.2.0-rc.2` 升到
  `0.2.1-rc.2`（family scheme 见上文「版本锚定方案」）。升级 preset 前先把桌面端/
  运行时升到 0.2.1-rc.2（守卫侧的锚不一致响亮退出见下方「开发者可见」条）。
- **hero-chip 出现 4 个 matt 模式**（`Matt 工作流` / `· PTC` / `· 精简` / `· Cordis`，
  #99 / ADR-0015）：一个插件、四份 preset patch，装一次全有、卸一次全清。**从 #99
  之前的版本升级必须用 `upgrade` 重装一次**——`dsh.bundle.patch` 由单文件变数组属
  载体形态变化，旧 profile 层缓存不会自己重新解析（见上文「桌面端」节）。
- **破坏性：`tool-subagent` / `tool-subagent-fork` 的 `backgroundMode` 配置键删除**
  （上游 0.2.1 契约，#89）：后台/延续语义由上游托管 activation 承担；配置里带该键的
  行需删掉，无迁移路径（上游未提供等价键）。
- **persona 导语变化（会话表面）**：上游 0.2.1 删除 `{{cwd}}` 变量，preset 导语随之
  去掉「Your working directory is {{cwd}}.」子句（#89）——新会话系统提示不再含工作
  目录展开值；在 persona 里自行写 `{{cwd}}` 会在渲染前报错（反向锚钉住）。
- **桌面端重装行为变化（0.2.1 起）**：跑 HMR 的 profile 上 `install_bundle` 对**已装**包
  直接失败（`already-installed`；旧版是 `restart-required` 后旧版本继续跑）——重装必须
  先 `remove_bundle` 再 `install_bundle`，或直接 `node bin/install.mjs upgrade --profile
  desktop`（见上文「桌面端」节）。
- **桌面端更新会自动清理退休的 experimental bundle**：schedule 的实验档
  （`dsh-experimental-…`）从 `dsh.profile.bundles` 消失、任务数据保留（上游行为，
  2026-10-17 实机观测，#88）。
- **安装方式收敛**（#41/#47/#86）：新用户一条命令
  `npx --allow-git=all github:ch1bug/dsh-matt-preset install`；运行时不在 PATH 时用
  `--dsh` / `--pnpm` 显式指路（探测顺序见上文「运行时从哪来」），桌面端一条命令
  `install --profile desktop`。
- **工作流面**：新增风格偏好层（保守/标准两档，存 `<DSH_HOME>` 仓外、human 独占
  写权，#49）；测试分级与恢复纪律进工作流门禁（#36）；`wrap` 产出带自主 digest
  格式（含「无授权依据」警示段，#49）。
- **开发者可见：测试挂具接线守卫修复**（#88）：挂具链接指向其他检出时**重指并响亮
  提示**（旧版报「已存在」蒙混）；`package.json` 锚 ≠ 运行时 `dsh-llm` 版本时直接
  exit 1。验证入口收敛为 `node scripts/verify-all.mjs`（默认快集 / `--all` 全量，#129）。

#### 锚
tag `dsh-v0.2.1-rc.2-r1` · npm `0.2.1-rc.2-r1` · 产物 `dsh-matt-preset-0.2.1-rc.2-r1.tgz`

## 验证（本票 AC 证据，2026-10-09）

- 单测：`node tests/verify-installer.mjs`（8 项：fresh/重复拒绝/--force/upgrade/
  未装 upgrade/卸载/--version/tarball）。
- 双环境活体（`node tests/verify-dual-env.mjs`）：**源码目录安装**与 **npm pack
  tarball 安装**各自完整走「安装 →（harness 真实 boot）启动 → 使用」——全量声明
  注册无 payload 错误（仅 harness 缺 host 服务的 waiting-for）、安装副本 persona
  注入 ask-matt、WORKFLOW GATES 基线在场、安装副本 workflow-enforcer 对
  `git push` 实弹触发一次性 ⚠。
